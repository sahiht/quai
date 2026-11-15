/**
 * Plateforme « appli Even » : pont du SDK @evenrealities/even_hub_sdk 0.0.16.
 * Démarrage (createStartUpPageContainer une seule fois), pages (rebuildPageContainer), mises à jour
 * sans clignotement (textContainerUpgrade avec textColor 0..4), événements, stockage du téléphone
 * (setLocalStorage / getLocalStorage), position (getAppLocation, permission `location`), sortie
 * (shutDownPageContainer(1) : boîte de confirmation système).
 *
 * 1.2.10 (PRD-1.2.10 § 3.4, 3.7, 3.9) :
 *  - conteneurs d'image (imageObject, 4 au plus, 288 × 144 au plus) et choix du menu système (menuObject, 10 au plus,
 *    32 octets UTF-8) donnés par `extra` ; sans `menu`, la reconstruction efface le menu de Quai ;
 *  - `paint` : rend l'image (glasses/images.ts), l'envoie en PNG gris par updateImageRawData, une à la fois dans la
 *    file du pont (jamais deux en même temps, jamais pendant une reconstruction) ; faux en cas d'échec, sans lever ;
 *    une image déjà envoyée telle quelle depuis la dernière reconstruction n'est pas renvoyée ;
 *  - signaux : menu (menuItemClickEvent), lunettes (onDeviceStatusChanged), doublons du micrologiciel écartés, boîte
 *    de sortie corrigée (son « Non » arrive comme `foreground`, la page est reconstruite) ;
 *  - positions continues : startAppLocationUpdates et onAppLocationChanged (platform/location.ts).
 */
import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { ContainerSpec, ImageSpec, MenuItem } from '../glasses/types';
export { menuLabel, pageImages, pageMenu, PAGE_LIMITS } from './page';
import { DeviceSignals, ExitDialog, readHubEvent, SignalDedup, type HubSignal } from '../glasses/gestures';
import { imageKey, renderImage } from '../glasses/images';
import { createKV, type KVBackend } from './kv';
import { deviceLocation, type SdkLocationSource } from './location';
import { pageImages, pageMenu } from './page';
import { grayPng } from './png';
import { SerialQueue } from './queue';
import type { GlassesPort, PageExtra, Platform } from './types';

/** Vrai si la page tourne dans l'appli Even (ou le simulateur), qui injecte flutter_inappwebview. */
export function hasEvenHost(): boolean {
  const w = globalThis as unknown as { flutter_inappwebview?: { callHandler?: unknown } };
  return typeof w.flutter_inappwebview?.callHandler === 'function';
}

/** Attend l'injection du pont par l'hôte (quelques centaines de ms au plus). */
export async function detectEvenHost(timeoutMs = 1500): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (hasEvenHost()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return hasEvenHost();
}

export function toTextProperty(c: ContainerSpec): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: c.x,
    yPosition: c.y,
    width: c.w,
    height: c.h,
    borderWidth: 0,
    borderColor: 0,
    borderRadius: 0,
    paddingLength: 0,
    containerID: c.id,
    containerName: c.name,
    isEventCapture: c.capture ? 1 : 0,
    content: c.content,
    textColor: c.level,
  });
}

/* ------------------------------ 1.2.10 : images et menu de la page ------------------------------ */

export function toImageProperty(img: ImageSpec): ImageContainerProperty {
  return new ImageContainerProperty({ xPosition: img.x, yPosition: img.y, width: img.w, height: img.h, containerID: img.id, containerName: img.name });
}

export function toMenuProperty(items: readonly MenuItem[]): MenuContainerProperty {
  return new MenuContainerProperty({ menuItems: items.map((m) => new MenuItemProperty({ itemID: m.id, itemName: m.label })) });
}

/** Contenu d'une page pour createStartUpPageContainer et rebuildPageContainer. */
export function pagePayload(cs: readonly ContainerSpec[], images: readonly ImageSpec[], menu: readonly MenuItem[]) {
  return {
    containerTotalNum: cs.length + images.length,
    textObject: cs.map(toTextProperty),
    ...(images.length ? { imageObject: images.map(toImageProperty) } : {}),
    ...(menu.length ? { menuObject: toMenuProperty(menu) } : {}),
  };
}

/** Données d'une image pour updateImageRawData : PNG gris (niveau × 17), que l'hôte ramène à 4 bits. */
export function imageData(img: ImageSpec): number[] {
  return Array.from(grayPng(renderImage(img), img.w, img.h));
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Le pont, réduit à ce que la plateforme utilise (tests : un faux pont). */
export type EvenBridge = Pick<
  EvenAppBridge,
  | 'createStartUpPageContainer'
  | 'rebuildPageContainer'
  | 'textContainerUpgrade'
  | 'updateImageRawData'
  | 'onEvenHubEvent'
  | 'onDeviceStatusChanged'
  | 'shutDownPageContainer'
>;

export function evenGlassesPort(bridge: EvenBridge, queue: SerialQueue, clock: () => number = nowMs): GlassesPort {
  /** Page demandée en dernier (images créées vides) ; `seq` change à chaque page. */
  let page = { seq: 0, images: new Map<number, ImageSpec>() };
  /** Image envoyée avec succès dans chaque conteneur depuis la dernière page. */
  const painted = new Map<number, string>();
  const dedup = new SignalDedup();
  const dialog = new ExitDialog();
  const devices = new DeviceSignals();
  const listeners = new Set<(s: HubSignal) => void>();
  let offBridge: (() => void) | null = null;

  const newPage = (images: ImageSpec[]): number => {
    page = { seq: page.seq + 1, images: new Map(images.map((i) => [i.id, i])) };
    painted.clear();
    return page.seq;
  };
  /** Page refusée par l'hôte : ses conteneurs d'image n'existent pas. */
  const failed = (seq: number): void => {
    if (page.seq === seq) page.images.clear();
  };

  const dispatch = (s: HubSignal | null): void => {
    if (!s) return;
    const t = clock();
    if (!dedup.accept(s, t)) return;
    const out = dialog.map(s, t);
    for (const l of [...listeners]) {
      try {
        l(out);
      } catch (e) {
        console.error('[Quai] signal', e);
      }
    }
  };

  return {
    start: (cs, extra?: PageExtra) => {
      const images = pageImages(cs, extra?.images);
      const menu = pageMenu(extra?.menu);
      const seq = newPage(images);
      return queue.run(
        'createStartUpPageContainer',
        async () => {
          const r = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(pagePayload(cs, images, menu)));
          if (r !== StartUpPageCreateResult.success) {
            console.error('[Quai] createStartUpPageContainer :', r);
            failed(seq);
          }
          return r === StartUpPageCreateResult.success;
        },
        false,
        { timeoutMs: 8000 },
      );
    },
    rebuild: (cs, extra?: PageExtra) => {
      const images = pageImages(cs, extra?.images);
      const menu = pageMenu(extra?.menu);
      const seq = newPage(images);
      return queue.run(
        'rebuildPageContainer',
        async () => {
          const ok = !!(await bridge.rebuildPageContainer(new RebuildPageContainer(pagePayload(cs, images, menu))));
          if (!ok) failed(seq);
          return ok;
        },
        false,
        { timeoutMs: 6000 },
      );
    },
    paint(img: ImageSpec): Promise<boolean> {
      const spec = page.images.get(img.id);
      // seulement dans un conteneur de la page en cours, de même nom et de même taille (sinon imageSizeInvalid)
      if (!spec || spec.name !== img.name || spec.w !== img.w || spec.h !== img.h) return Promise.resolve(false);
      const key = imageKey(img);
      if (painted.get(img.id) === key) return Promise.resolve(true);
      const seq = page.seq;
      return queue.run(
        'updateImageRawData',
        async () => {
          // page changée pendant l'attente : ce conteneur n'existe plus
          if (page.seq !== seq || !page.images.has(img.id)) return false;
          const r = await bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: img.id, containerName: img.name, imageData: imageData(img) }));
          const ok = ImageRawDataUpdateResult.isSuccess(ImageRawDataUpdateResult.normalize(r));
          if (page.seq === seq) {
            if (ok) painted.set(img.id, key);
            else painted.delete(img.id);
          }
          if (!ok) console.warn('[Quai] updateImageRawData :', r);
          return ok;
        },
        false,
        { timeoutMs: 5000 },
      );
    },
    upgrade: (c, o) =>
      queue.run(
        'textContainerUpgrade',
        () =>
          bridge.textContainerUpgrade(
            new TextContainerUpgrade({ containerID: c.id, containerName: c.name, content: c.content, ...(o.level ? { textColor: c.level } : {}) }),
          ),
        false,
      ),
    onSignal(cb) {
      listeners.add(cb);
      if (!offBridge) {
        const offHub = bridge.onEvenHubEvent((e) => dispatch(readHubEvent(e)));
        let offDevice: () => void = () => undefined;
        try {
          offDevice = bridge.onDeviceStatusChanged((st) => dispatch(devices.next(st)));
        } catch {
          /* hôte sans état des lunettes */
        }
        offBridge = () => {
          offHub();
          offDevice();
        };
      }
      return () => {
        listeners.delete(cb);
        if (!listeners.size && offBridge) {
          offBridge();
          offBridge = null;
        }
      };
    },
    async exit(mode) {
      if (mode === 1) dialog.arm(clock());
      await queue.run('shutDownPageContainer', () => bridge.shutDownPageContainer(mode), false);
    },
  };
}

/** Stockage du téléphone, écritures regroupées par clé (le pont partage le canal de l'affichage). */
function bridgeStorage(bridge: EvenAppBridge, queue: SerialQueue): KVBackend {
  const pending = new Map<string, string>();
  let flushing: Promise<void> | null = null;
  const flush = async (): Promise<void> => {
    while (pending.size) {
      const [k, v] = pending.entries().next().value as [string, string];
      pending.delete(k);
      await queue.run('setLocalStorage', () => bridge.setLocalStorage(k, v), false, { lane: 'low', timeoutMs: 5000 });
    }
  };
  return {
    async get(k) {
      if (pending.has(k)) return pending.get(k) ?? null;
      const v = await queue.run('getLocalStorage', () => bridge.getLocalStorage(k), '', { lane: 'low', timeoutMs: 5000 });
      return v || null;
    },
    set(k, v) {
      pending.set(k, v);
      if (!flushing) flushing = flush().finally(() => (flushing = null));
      return flushing;
    },
  };
}

/** Position du SDK : une mesure (getAppLocation) et, 1.2.10, les positions continues. */
export function evenLocationSource(
  bridge: Pick<EvenAppBridge, 'getAppLocation' | 'startAppLocationUpdates' | 'stopAppLocationUpdates' | 'onAppLocationChanged'>,
): SdkLocationSource {
  return {
    getAppLocation: (o) => bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: o.timeoutMs }),
    startUpdates: (o) =>
      bridge.startAppLocationUpdates({
        accuracy: o.accuracy === 'medium' ? AppLocationAccuracy.Medium : AppLocationAccuracy.High,
        intervalMs: o.intervalMs,
        distanceFilter: o.distanceFilter,
      }),
    stopUpdates: () => bridge.stopAppLocationUpdates(),
    onUpdate: (cb) => bridge.onAppLocationChanged(cb),
  };
}

export async function createEvenPlatform(now: () => number): Promise<Platform> {
  const bridge = await waitForEvenAppBridge();
  const queue = new SerialQueue(4000);
  return {
    kind: 'even',
    glasses: evenGlassesPort(bridge, queue),
    kv: createKV(bridgeStorage(bridge, queue)),
    location: deviceLocation(evenLocationSource(bridge), now),
    closeWebView() {
      // L'appli Even ferme la WebView du module quand la page demande sa fermeture.
      try {
        window.close();
      } catch {
        /* rien */
      }
    },
  };
}
