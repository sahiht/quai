/**
 * Plateforme « appli Even » : pont du SDK @evenrealities/even_hub_sdk 0.0.16.
 * Démarrage (createStartUpPageContainer une seule fois), pages (rebuildPageContainer), mises à jour
 * sans clignotement (textContainerUpgrade avec textColor 0..4), événements, stockage du téléphone
 * (setLocalStorage / getLocalStorage), position (getAppLocation, permission `location`), sortie
 * (shutDownPageContainer(1) : boîte de confirmation système).
 */
import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import type { ContainerSpec } from '../glasses/types';
import { readHubEvent } from '../glasses/gestures';
import { createKV, type KVBackend } from './kv';
import { deviceLocation } from './location';
import { SerialQueue } from './queue';
import type { GlassesPort, Platform } from './types';

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

function glassesPort(bridge: EvenAppBridge, queue: SerialQueue): GlassesPort {
  return {
    start: (cs) =>
      queue.run(
        'createStartUpPageContainer',
        async () => {
          const r = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: cs.length, textObject: cs.map(toTextProperty) }));
          if (r !== StartUpPageCreateResult.success) console.error('[Quai] createStartUpPageContainer :', r);
          return r === StartUpPageCreateResult.success;
        },
        false,
        { timeoutMs: 8000 },
      ),
    rebuild: (cs) =>
      queue.run('rebuildPageContainer', () => bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: cs.length, textObject: cs.map(toTextProperty) })), false, {
        timeoutMs: 6000,
      }),
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
      return bridge.onEvenHubEvent((e) => {
        const s = readHubEvent(e);
        if (s) cb(s);
      });
    },
    async exit(mode) {
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

export async function createEvenPlatform(now: () => number): Promise<Platform> {
  const bridge = await waitForEvenAppBridge();
  const queue = new SerialQueue(4000);
  return {
    kind: 'even',
    glasses: glassesPort(bridge, queue),
    kv: createKV(bridgeStorage(bridge, queue)),
    location: deviceLocation(
      {
        getAppLocation: (o) => bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: o.timeoutMs }),
      },
      now,
    ),
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
