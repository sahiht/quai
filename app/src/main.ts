/**
 * Quai : point d'entrée. La page web est l'interface du téléphone ; les lunettes sont pilotées par le SDK.
 * Le vrai cœur (createCore de ./core/index) est utilisé, le faux cœur seulement avec ?fake=1 (dév. ou e2e).
 */
import './phone/styles.css';
import type { CoreOptions } from './core/api';
import { applyTestSettings, loadCore, prefixed, type CoreModule } from './boot';
import { parseEnv } from './env';
import { CONFIGURED, DATA_BASE, RELAY_BASE } from './generated/config';
import { GlassesController } from './glasses/controller';
import { messageView } from './glasses/views';
import { layoutPage } from './glasses/layout';
import { mountPhone } from './phone/app';
import { h } from './phone/dom';
import { setPreviewPainter } from './phone/ui';
import { GlassesCanvas } from './web/display';
import { createBrowserPlatform } from './platform/browser';
import { createClock } from './platform/clock';
import { createEvenPlatform, detectEvenHost } from './platform/even';
import { mockLocation } from './platform/location';
import type { Fix, Platform } from './platform/types';
import { loadSettings, SettingsStore } from './settings';
import { DEFAULT_SETTINGS } from './core/api';
import { fitScreen } from './phone/dom';

/* État d'arrière-plan : l'hôte Even appelle ces fonctions (migration vers une WebView sans écran quand
 * le téléphone se verrouille). Enregistrées au chargement du module, avant tout await. */
const bg: { controller: GlassesController | null; pending: unknown } = { controller: null, pending: null };
const w = window as unknown as Record<string, unknown>;
w.__getStateSnapshot = () => JSON.stringify(bg.controller ? bg.controller.snapshot() : {});
w.__restoreState = (snap: unknown) => {
  if (bg.controller) bg.controller.restore(snap);
  else bg.pending = snap;
};

async function main(): Promise<void> {
  const env = parseEnv(location.search, import.meta.env.DEV);
  const clock = createClock({ mockNow: env.mockNow, speed: env.mockSpeed });
  const root = document.getElementById('app')!;
  const emulatorMount = document.getElementById('glasses-emulator')!;
  const even = !env.browser && (await detectEvenHost(1200));
  const platform: Platform = even ? await createEvenPlatform(clock.now) : createBrowserPlatform(clock.now, emulatorMount);
  if (!even) document.querySelectorAll<HTMLElement>('.g-screen-wrap').forEach((wrap) => fitScreen(wrap, wrap.querySelector('.g-screen')!));
  if (env.mockLat !== undefined && env.mockLon !== undefined) {
    platform.location = mockLocation(env.mockLat, env.mockLon, clock.now);
    // Mode test : position simulée qui suit un trajet (?mockPath=13:50.4686,4.8625;20:50.6727,4.5694 : minutes après
    // mockNow, puis la position), pour que le suivi automatique voie l'utilisateur partir (PRD M6.3).
    const path = env.e2e && env.mockNow !== undefined ? parseMockPath(new URLSearchParams(location.search).get('mockPath'), env.mockNow) : [];
    if (path.length) {
      const start = { lat: env.mockLat, lon: env.mockLon };
      const fix = (): Fix => {
        const p = [start, ...path.filter((x) => x.at <= clock.now())].pop()!;
        return { lat: p.lat, lon: p.lon, accuracy: 5, at: clock.now(), source: 'mock' };
      };
      platform.location = { current: async () => fix(), last: () => fix() };
    }
  }

  // Écran des lunettes dès le départ : jamais d'écran noir.
  const loading = layoutPage(messageView('Quai', ['Chargement…'], { now: clock.now(), settings: DEFAULT_SETTINGS }), { sel: 0, top: 0 });
  const started = platform.glasses.start(loading.containers);

  // Aperçus des réglages (Affichage, Alertes) : dessinés au pixel comme dans les lunettes (en texte HTML, la police
  // du téléphone est plus large que celle des G2 et coupait la colonne de droite, « partir dans 4 mi »).
  setPreviewPainter((box, cs) => {
    const c = h('canvas', { class: 'w-preview-canvas', 'aria-hidden': 'true' });
    box.appendChild(c);
    new GlassesCanvas(c, undefined, false).paint(cs);
  });

  // Réglages (mode test : remise à zéro, réglages de démonstration).
  await applyTestSettings(env, platform.kv);
  const settings = new SettingsStore(platform.kv, await loadSettings(platform.kv));

  const dataBase = env.data ?? DATA_BASE;
  const relayBase = env.relay ?? RELAY_BASE;
  const configured = env.fake || (CONFIGURED && !!dataBase && !!relayBase) || (!!env.data && !!env.relay);

  let mod: CoreModule;
  try {
    mod = await loadCore(env.fake);
  } catch (e) {
    console.error('[Quai] cœur absent', e);
    await started;
    const msg = layoutPage(messageView('Quai', ['Le cœur de l’appli est absent\u00a0:', 'app/src/core/index.ts (équipe cœur).', 'En développement\u00a0: ajouter ?fake=1.'], { now: clock.now(), settings: settings.get() }), { sel: 0, top: 0 });
    await platform.glasses.rebuild(msg.containers);
    root.replaceChildren(Object.assign(document.createElement('p'), { className: 'warn', textContent: 'Le cœur de l’appli est absent (app/src/core/index.ts). En développement, ajoutez ?fake=1 à l’adresse.' }));
    return;
  }
  const opts: CoreOptions = { dataBase, relayBase, now: clock.now, storage: prefixed(platform.kv, 'quai.cache.') };
  const core = env.fake ? (await import('./dev/fake-core')).createFakeCore(opts, { stale: env.stale, noRt: env.noRt }) : mod.createCore(opts);

  await started;
  const controller = new GlassesController({
    platform,
    core,
    settings,
    clock,
    configured,
    freshness: mod.dataFreshness,
    e2e: env.e2e,
    pageStarted: true,
  });
  bg.controller = controller;
  if (bg.pending) controller.restore(bg.pending);

  mountPhone({
    root,
    settings,
    core: () => controller.ensureInit().then(() => core),
    coreNow: () => core,
    location: platform.location,
    clock,
    glasses: () => controller,
    meta: () => controller.currentMeta,
    freshness: () => controller.freshness,
    coreError: () => controller.error,
    configured,
  });

  window.addEventListener('beforeunload', () => {
    void settings.flush();
    controller.stop();
  });
  await controller.start();
}

/** Étapes d'un parcours simulé : « minutes:lat,lon » séparées par « ; » (lecture tolérante, étapes invalides ignorées). */
function parseMockPath(raw: string | null, start: number): { at: number; lat: number; lon: number }[] {
  const out: { at: number; lat: number; lon: number }[] = [];
  for (const part of (raw ?? '').split(';')) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(part);
    if (m && Math.abs(Number(m[2])) <= 90 && Math.abs(Number(m[3])) <= 180) out.push({ at: start + Number(m[1]) * 60_000, lat: Number(m[2]), lon: Number(m[3]) });
  }
  return out.sort((a, b) => a.at - b.at);
}

void main().catch((e) => {
  console.error('[Quai] démarrage', e);
  const root = document.getElementById('app');
  if (root) root.textContent = `Quai n’a pas pu démarrer\u00a0: ${e instanceof Error ? e.message : String(e)}`;
});
