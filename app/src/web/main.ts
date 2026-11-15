/**
 * Quai Web : la même appli (vrai cœur, mêmes écrans des lunettes, même interface du téléphone) dans un
 * navigateur, sans lunettes. Page publiée sur GitHub Pages (https://<compte>.github.io/<dépôt>/app/) ;
 * les adresses des données et du relais sont fixées au build (npm run build:web). Aucun paramètre d'URL
 * n'est nécessaire ; ceux du mode test (?e2e=1&mockLat=…&data=…&relay=…&preset=…&reset=1) restent acceptés.
 */
import '../phone/styles.css';
import './web.css';
import { applyTestSettings, loadCore, prefixed, type CoreModule } from '../boot';
import type { CoreOptions } from '../core/api';
import { DEFAULT_SETTINGS } from '../core/api';
import { createJournal, type JournalStore } from '../core/journal';
import { parseEnv } from '../env';
import { GlassesController } from '../glasses/controller';
import { layoutPage } from '../glasses/layout';
import type { Gesture } from '../glasses/nav';
import { messageView } from '../glasses/views';
import { mountPhone } from '../phone/app';
import { h } from '../phone/dom';
import { setPreviewPainter } from '../phone/ui';
import { createClock } from '../platform/clock';
import { createKV } from '../platform/kv';
import type { Platform } from '../platform/types';
import { loadSettings, SettingsStore } from '../settings';
import { describeContainers, GlassesCanvas, withCanvasImages } from './display';
import { attachKeyboard, attachScreenGestures, GESTURES } from './gestures';
import { createWebLocation, type WebLocationState } from './location';
import { createWebGlassesPort } from './port';
import { positionCard } from './position';
import { mountShell, type Panel } from './shell';
import { webStorageBackend } from './storage';
import { screenWakeLock } from './wakelock';

/** Remplacé au build par vite.web.config.ts (adresses https validées, version de app.json). */
declare const __QUAI_WEB__: { dataBase: string; relayBase: string; version: string };

async function main(): Promise<void> {
  const env = parseEnv(location.search, import.meta.env.DEV);
  const clock = createClock({ mockNow: env.mockNow, speed: env.mockSpeed });
  const kv = createKV(webStorageBackend());

  // Réglages (localStorage) avant tout : le premier lancement s'ouvre sur l'onglet Réglages.
  await applyTestSettings(env, kv);
  const settings = new SettingsStore(kv, await loadSettings(kv));
  const initial: Panel = !settings.get().onboarded || /^#\/./.test(location.hash) ? 'reglages' : 'lunettes';
  const shell = mountShell(document.getElementById('w-root')!, initial);

  const screen = new GlassesCanvas(shell.canvas, (cs, images) => shell.canvas.setAttribute('aria-label', `Écran des lunettes. ${describeContainers(cs, images)}`));
  // 1.2.10 : images du guidage dessinées dans le canvas (pixels mêmes des lunettes)
  const port = withCanvasImages(createWebGlassesPort(screen), screen);
  const loc = createWebLocation(clock.now);
  if (env.mockLat !== undefined && env.mockLon !== undefined) loc.useMock(env.mockLat, env.mockLon);
  const platform: Platform = { kind: 'web', glasses: port, kv, location: loc, closeWebView() {} };
  // 1.3.0 (PRD-1.3.0 § 6.4) : journal des trajets guidés, dans la page ; ouvert en arrière-plan à la fin du démarrage
  // (plus bas), jamais attendu : null pour l'onglet Réglages tant qu'il n'est pas prêt.
  let journal: JournalStore | null = null;

  // Écran des lunettes dès le départ : jamais d'écran noir.
  const loading = layoutPage(messageView('Quai', ['Chargement…'], { now: clock.now(), settings: DEFAULT_SETTINGS }), { sel: 0, top: 0 });
  await port.start(loading.containers);

  // Aperçus des réglages (Affichage, Alertes) : même rendu que l'écran des lunettes.
  setPreviewPainter((box, cs) => {
    const c = h('canvas', { class: 'w-preview-canvas', 'aria-hidden': 'true' });
    box.appendChild(c);
    new GlassesCanvas(c, undefined, false).paint(cs);
  });

  const dataBase = env.data ?? __QUAI_WEB__.dataBase;
  const relayBase = env.relay ?? __QUAI_WEB__.relayBase;
  const configured = env.fake || (!!dataBase && !!relayBase);

  let mod: CoreModule;
  try {
    mod = await loadCore(env.fake);
  } catch (e) {
    console.error('[Quai] cœur absent', e);
    const msg = layoutPage(messageView('Quai', ['Quai n’a pas pu se charger.', 'Recharge la page dans un instant.'], { now: clock.now(), settings: settings.get(), web: true }), { sel: 0, top: 0 });
    await port.rebuild(msg.containers);
    shell.reglages.replaceChildren(h('p', { class: 'warn', role: 'alert' }, 'Quai n’a pas pu se charger. Recharge la page dans un instant.'));
    return;
  }
  const opts: CoreOptions = { dataBase, relayBase, now: clock.now, storage: prefixed(kv, 'quai.cache.') };
  const core = env.fake ? (await import('../dev/fake-core')).createFakeCore(opts, { stale: env.stale, noRt: env.noRt }) : mod.createCore(opts);

  const openPhone = (hash: string): void => {
    shell.show('reglages');
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
  };
  const controller = new GlassesController({
    platform,
    core,
    settings,
    clock,
    configured,
    freshness: mod.dataFreshness,
    e2e: env.e2e,
    pageStarted: true,
    web: true,
    openPhone,
  });
  const coreReady = () => controller.ensureInit().then(() => core);
  const picker = (id: string) => positionCard({ location: loc, core: coreReady, settings, changed: () => void controller.relocate(), id, now: clock.now });

  shell.extra.append(h('section', { class: 'box pad w-pos-box', 'aria-labelledby': 'w-pos-title' }, h('h2', { id: 'w-pos-title' }, 'Position'), picker('w-pos')));

  mountPhone({
    root: shell.reglages,
    themeTarget: shell.reglagesPanel,
    settings,
    core: coreReady,
    coreNow: () => core,
    location: loc,
    clock,
    glasses: () => controller,
    meta: () => controller.currentMeta,
    freshness: () => controller.freshness,
    coreError: () => controller.error,
    configured,
    web: true,
    showGlasses: () => shell.show('lunettes'),
    positionPicker: () => picker(`w-pos-${Math.random().toString(36).slice(2, 7)}`),
    journal: () => journal,
  });

  // Gestes : boutons (1.2.10 : « Appui long » compris), écran (glisser, toucher, double toucher, molette, doigt gardé),
  // clavier.
  const emit = (g: Gesture): void => port.emit({ kind: 'gesture', gesture: g });
  shell.gestures.querySelectorAll<HTMLButtonElement>('button[data-g]').forEach((b) => {
    const g = b.dataset.g as Gesture;
    if (GESTURES.includes(g)) b.addEventListener('click', () => emit(g));
  });
  attachScreenGestures(shell.canvas, emit);
  attachKeyboard(window, emit, () => shell.glassesVisible());

  // Page cachée : comme les lunettes en arrière-plan (plus de temps réel ni de position) ; visible : reprise.
  document.addEventListener('visibilitychange', () => port.emit({ kind: document.visibilityState === 'hidden' ? 'background' : 'foreground' }));
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) port.emit({ kind: 'foreground' });
  });

  // Position obtenue plus tard (permission accordée, signal retrouvé) ou perdue : les lunettes suivent.
  let lastKind: WebLocationState['kind'] = loc.state().kind;
  loc.subscribe((s) => {
    const was = lastKind;
    lastKind = s.kind;
    if (s.kind !== was && (s.kind === 'gps' || s.kind === 'denied')) void controller.relocate();
  });

  // Écran du téléphone gardé allumé tant que l'écran des lunettes est visible.
  const wake = screenWakeLock();
  const sync = (): void => {
    wake.set(shell.glassesVisible());
    if (shell.glassesVisible()) screen.draw();
  };
  shell.onChange(sync);
  sync();

  window.addEventListener('pagehide', () => void settings.flush());
  // le journal regroupe ses enregistrements (2 s) : tout de suite quand la page se cache ou se ferme
  const saveJournal = (): void => void journal?.flush();
  window.addEventListener('pagehide', saveJournal);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveJournal());
  await controller.start();
  // 1.3.0, contrôle technique : le journal n'est jamais attendu au démarrage ; il s'ouvre en arrière-plan une fois l'écran
  // d'ouverture affiché ; le contrôleur (attachJournal) et l'onglet Réglages le reçoivent dès qu'il est prêt ; s'il ne
  // s'ouvre pas, Quai continue sans lui.
  void createJournal(platform.kv, { now: clock.now }).then(
    (j) => {
      journal = j;
      controller.attachJournal(j);
    },
    (e: unknown) => console.warn('[Quai] journal des trajets indisponible', e),
  );
}

void main().catch((e) => {
  console.error('[Quai] démarrage', e);
  const root = document.getElementById('w-root');
  if (root) root.textContent = `Quai n’a pas pu démarrer : ${e instanceof Error ? e.message : String(e)}`;
});
