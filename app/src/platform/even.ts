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
 *
 * 1.3.0 (PRD-1.3.0 § 6.2, § 6.3, § 10) :
 *  - capteur de mouvement : `imu(on, paceMs)` → imuControl(isOpen, ImuReportPace), allure du SDK la plus proche (le SDK
 *    envoie la valeur telle quelle) ; vrai seulement si l'hôte répond vrai ; jamais d'exception ; fermer est toujours sûr
 *    (rien n'est envoyé si le capteur est déjà fermé, une fermeture en cours sert aux appels suivants) ; dans la file du
 *    pont comme l'affichage ;
 *  - mesures : signal `imu` daté par l'horloge de l'appli, livré tout de suite (ni dédoublonnage, ni boîte de sortie, ni
 *    file, ni minuterie, ni promesse par mesure) et seulement entre imu(true) et imu(false) : une mesure que personne
 *    n'attend (page rechargée pendant que le capteur était ouvert, ouverture refusée mais faite) est écartée et le
 *    capteur refermé ;
 *  - le SDK écrit chaque événement reçu dans la console, sans réglage : ses lignes qui portent une mesure sont écartées
 *    (quietImuLogs), toutes les autres passent ;
 *  - état des lunettes : batterie et charge dans le signal `device` (glasses/gestures.ts : DeviceSignals).
 */
import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  ImuReportPace,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
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

/**
 * 1.2.10 : couleur de bordure du SDK (gris de 0 à 16 pour un conteneur texte, d'après even-g2-notes : 5 discret,
 * 13 vif) pour chaque luminosité de Quai.
 */
export const BORDER_COLOR: Record<ContainerSpec['level'], number> = { 0: 2, 1: 4, 2: 6, 3: 10, 4: 13 };

export function toTextProperty(c: ContainerSpec): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: c.x,
    yPosition: c.y,
    width: c.w,
    height: c.h,
    borderWidth: c.border ? c.border.width : 0,
    borderColor: c.border ? BORDER_COLOR[c.border.level] : 0,
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

/**
 * Le pont, réduit à ce que la plateforme utilise (tests : un faux pont). 1.3.0 : imuControl peut manquer (hôte ou pont
 * sans capteur de mouvement) : `imu` rend alors faux.
 */
export type EvenBridge = Pick<
  EvenAppBridge,
  | 'createStartUpPageContainer'
  | 'rebuildPageContainer'
  | 'textContainerUpgrade'
  | 'updateImageRawData'
  | 'onEvenHubEvent'
  | 'onDeviceStatusChanged'
  | 'shutDownPageContainer'
> &
  Partial<Pick<EvenAppBridge, 'imuControl'>>;

/* ------------------------------ 1.3.0 : capteur de mouvement ------------------------------ */

/** 1.3.0 : allures du capteur de mouvement acceptées par le SDK (ImuReportPace : 100 à 1000 ms, par 100). */
export const IMU_PACES: readonly ImuReportPace[] = [
  ImuReportPace.P100,
  ImuReportPace.P200,
  ImuReportPace.P300,
  ImuReportPace.P400,
  ImuReportPace.P500,
  ImuReportPace.P600,
  ImuReportPace.P700,
  ImuReportPace.P800,
  ImuReportPace.P900,
  ImuReportPace.P1000,
];

/**
 * 1.3.0 : allure du SDK la plus proche de `paceMs` (imuControl transmet sa valeur sans la vérifier) ; à égale distance,
 * la plus lente (moins de mesures) ; absente ou invalide : P100, la valeur par défaut du SDK.
 */
export function imuPace(paceMs?: number): ImuReportPace {
  if (typeof paceMs !== 'number' || !Number.isFinite(paceMs)) return ImuReportPace.P100;
  let best = IMU_PACES[0];
  for (const p of IMU_PACES) if (Math.abs(p - paceMs) <= Math.abs(best - paceMs)) best = p;
  return best;
}

/**
 * 1.3.0 : après une fermeture du capteur, les mesures encore en vol sont écartées sans renvoyer de fermeture pendant ce
 * délai ; au-delà, une mesure que personne n'attend fait refermer le capteur (une fois par délai au plus).
 */
export const IMU_STRAY_CLOSE_MS = 2000;

/** OsEventTypeList.IMU_DATA_REPORT : événement système qui porte une mesure du capteur. */
const IMU_EVENT_TYPE = 8;

/**
 * 1.3.0 (PRD-1.3.0 § 6.2, § 10) : vrai pour une ligne de console du SDK qui porte une mesure du capteur de mouvement
 * (« [EvenAppBridge] EvenHub event: » suivi de l'événement : le SDK l'écrit pour chaque événement reçu, sans réglage pour
 * l'éteindre ; capteur ouvert à 100 ms, 10 lignes par seconde, chacune avec sa mesure, gardées par la console).
 */
export function isSdkImuLog(args: readonly unknown[]): boolean {
  if (typeof args[0] !== 'string' || !args[0].startsWith('[EvenAppBridge]')) return false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const sys = a && typeof a === 'object' ? (a as { sysEvent?: unknown }).sysEvent : undefined;
    if (!sys || typeof sys !== 'object') continue;
    const s = sys as { eventType?: unknown; imuData?: unknown };
    if (s.imuData != null || s.eventType === IMU_EVENT_TYPE) return true;
  }
  return false;
}

const QUIET_IMU = Symbol.for('quai.quietImuLogs');

/**
 * 1.3.0 : écarte de la console les lignes du SDK qui portent une mesure du capteur (isSdkImuLog) ; toutes les autres
 * passent telles quelles, dans le même ordre. Une seule fois par console (un second appel ne change rien).
 */
export function quietImuLogs(c: Pick<Console, 'log'> = console): void {
  const current = c.log as Console['log'] & { [QUIET_IMU]?: true };
  if (current[QUIET_IMU]) return;
  c.log = Object.assign(
    (...args: unknown[]): void => {
      if (!isSdkImuLog(args)) current.apply(c, args);
    },
    { [QUIET_IMU]: true as const },
  );
}

/**
 * Port des lunettes de l'appli Even. `clock` : horloge des doublons et des délais (monotone) ; 1.3.0 : `now`, horloge de
 * l'appli (celle de Fix.at) qui date les mesures du capteur de mouvement.
 */
export function evenGlassesPort(bridge: EvenBridge, queue: SerialQueue, clock: () => number = nowMs, now: () => number = Date.now): GlassesPort {
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

  /** 1.3.0 : une seule trace pour un abonné qui lève sur les mesures (pas 10 par seconde) */
  let imuErrorLogged = false;
  const dispatch = (s: HubSignal | null): void => {
    if (!s) return;
    let out = s;
    // 1.3.0 : les mesures du capteur passent sans dédoublonnage ni boîte de sortie (rien n'est gardé par mesure)
    if (s.kind !== 'imu') {
      const t = clock();
      if (!dedup.accept(s, t)) return;
      out = dialog.map(s, t);
    }
    for (const l of [...listeners]) {
      try {
        l(out);
      } catch (e) {
        if (out.kind === 'imu') {
          if (imuErrorLogged) continue;
          imuErrorLogged = true;
        }
        console.error('[Quai] signal', e);
      }
    }
  };

  /* ------------------------------ 1.3.0 : capteur de mouvement ------------------------------ */

  /** Numéro de la dernière demande (ouvrir ou fermer). */
  let imuSeq = 0;
  /** Le contrôleur attend des mesures (entre imu(true) et imu(false) ; faux après une ouverture refusée). */
  let imuWanted = false;
  /** L'hôte a peut-être le capteur ouvert : une fermeture lui sera envoyée. */
  let imuOpen = false;
  /** Fermeture en cours ; si rien n'a été demandé depuis, une autre fermeture attend la même réponse. */
  let imuClosing: { seq: number; p: Promise<boolean> } | null = null;
  /** Fin de la dernière fermeture (horloge `clock`). */
  let imuClosedAt = -Infinity;

  const setImu = (on: boolean, paceMs?: number): Promise<boolean> => {
    if (typeof bridge.imuControl !== 'function') return Promise.resolve(false);
    if (!on) {
      imuWanted = false;
      // déjà fermé : rien à envoyer ; fermeture déjà partie : même réponse
      if (!imuOpen) return Promise.resolve(true);
      if (imuClosing && imuClosing.seq === imuSeq) return imuClosing.p;
    }
    const seq = ++imuSeq;
    if (on) {
      imuWanted = true;
      imuOpen = true;
    }
    const pace = imuPace(paceMs);
    const p: Promise<boolean> = queue
      .run(
        'imuControl',
        async () => {
          const ok = (await (on ? bridge.imuControl?.(true, pace) : bridge.imuControl?.(false))) === true;
          // fermeture confirmée par l'hôte (même après le délai de la file) et rien demandé depuis
          if (!on && ok && seq === imuSeq) imuOpen = false;
          return ok;
        },
        false,
      )
      .then((ok) => {
        if (on && !ok && seq === imuSeq) {
          // refusée, sans réponse ou en échec : le contrôleur n'attend aucune mesure ; celles qui viendraient quand même
          // sont écartées et le capteur refermé
          imuWanted = false;
        }
        if (!on) {
          imuClosedAt = clock();
          if (imuClosing?.p === p) imuClosing = null;
        }
        return ok;
      });
    if (!on) imuClosing = { seq, p };
    return p;
  };

  /**
   * Mesure que personne n'attend : écartée. Le capteur est resté ouvert sans demande (page rechargée pendant qu'il
   * l'était, ouverture refusée mais faite) : il est refermé, une fois par IMU_STRAY_CLOSE_MS au plus ; les mesures
   * encore en vol pendant ou juste après une fermeture n'en déclenchent pas d'autre.
   */
  const strayImu = (): void => {
    const t = clock();
    if (imuClosing || t - imuClosedAt < IMU_STRAY_CLOSE_MS || typeof bridge.imuControl !== 'function') return;
    imuClosedAt = t;
    imuOpen = true;
    void setImu(false);
  };

  const onHub = (e: EvenHubEvent): void => {
    const s = readHubEvent(e, now());
    if (s?.kind === 'imu' && !imuWanted) return strayImu();
    dispatch(s);
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
        const offHub = bridge.onEvenHubEvent(onHub);
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
    imu: setImu,
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
  // 1.3.0 : pas une ligne de console par mesure du capteur (le SDK en écrit une par événement reçu)
  quietImuLogs();
  const bridge = await waitForEvenAppBridge();
  const queue = new SerialQueue(4000);
  return {
    kind: 'even',
    glasses: evenGlassesPort(bridge, queue, nowMs, now),
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
