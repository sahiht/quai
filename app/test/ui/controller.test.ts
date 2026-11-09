/**
 * Contrôleur des lunettes avec le faux cœur et un faux port SDK qui enregistre les appels :
 * démarrage sans écran noir, mises à jour sans reconstruction, gestes, sortie, arrière-plan.
 */
import { describe, expect, it, vi } from 'vitest';
import { GlassesController } from '../../src/glasses/controller';
import type { HubSignal } from '../../src/glasses/gestures';
import type { ContainerSpec } from '../../src/glasses/types';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { mockLocation } from '../../src/platform/location';
import type { GlassesPort, Platform } from '../../src/platform/types';
import { SettingsStore } from '../../src/settings';
import { dataFreshness } from '../../src/dev/fake-core';
import type { Core } from '../../src/core/api';
import { fakeCore, preset, SCENARIO } from './helpers';

interface Call { op: 'start' | 'rebuild' | 'upgrade' | 'exit'; arg?: unknown }

function recorder() {
  const calls: Call[] = [];
  let listener: ((s: HubSignal) => void) | null = null;
  const port: GlassesPort = {
    async start(cs: ContainerSpec[]) {
      calls.push({ op: 'start', arg: cs });
      return true;
    },
    async rebuild(cs: ContainerSpec[]) {
      calls.push({ op: 'rebuild', arg: cs });
      return true;
    },
    async upgrade(c: ContainerSpec) {
      calls.push({ op: 'upgrade', arg: c });
      return true;
    },
    onSignal(cb) {
      listener = cb;
      return () => (listener = null);
    },
    async exit(mode) {
      calls.push({ op: 'exit', arg: mode });
    },
  };
  return { calls, port, emit: (s: HubSignal) => listener?.(s) };
}

async function setup(opts: { scenario?: keyof typeof SCENARIO; onboarded?: boolean; configured?: boolean; stale?: boolean; wrap?: (core: Core) => Core } = {}) {
  const sc = SCENARIO[opts.scenario ?? 's1'];
  let t = 0;
  const clock = createClock({ mockNow: sc.now, perfNow: () => t });
  const rec = recorder();
  const closeWebView = vi.fn();
  const kv = createKV(memoryBackend());
  const platform: Platform = { kind: 'even', glasses: rec.port, kv, location: mockLocation(sc.lat, sc.lon, clock.now), closeWebView };
  const s = preset();
  const settings = new SettingsStore(kv, { ...s, onboarded: opts.onboarded ?? true });
  const logs: string[] = [];
  const base = fakeCore(clock.now, { stale: opts.stale });
  const core = opts.wrap ? opts.wrap(base) : base;
  const c = new GlassesController({ platform, core, settings, clock, configured: opts.configured ?? true, freshness: dataFreshness, e2e: true, log: (l) => logs.push(l) });
  await c.start();
  await new Promise((r) => setTimeout(r, 20));
  const screens = () => logs.filter((l) => l.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.slice(12)) as { screen: string; title: string; lines: string[] });
  const last = () => screens()[screens().length - 1];
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const advance = (ms: number) => (t += ms);
  return { c, rec, logs, last, screens, settle, closeWebView, settings, advance };
}

describe('contrôleur des lunettes', () => {
  it('démarre par une page de chargement puis l’accueil (jamais d’écran noir)', async () => {
    const { rec, logs, screens, c } = await setup();
    expect(rec.calls[0].op).toBe('start');
    expect(rec.calls.filter((x) => x.op === 'start')).toHaveLength(1);
    expect(screens()[0]).toMatchObject({ screen: 'message', lines: ['Chargement…'] });
    expect(logs).toContain('QUAI_READY');
    expect(screens().at(-1)?.screen).toBe('home');
    c.stop();
  });

  it('mises à jour sans clignotement : textContainerUpgrade pour les changements de texte', async () => {
    const { rec, c, settle } = await setup();
    const before = rec.calls.length;
    c.onGesture('down');
    await settle();
    const after = rec.calls.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((x) => x.op === 'upgrade')).toBe(true);
    expect((after[0].arg as ContainerSpec).name).toBe('cursor');
    c.stop();
  });

  it('toucher ouvre, double toucher revient, puis demande la sortie système', async () => {
    const { c, last, settle, rec, closeWebView } = await setup();
    c.onGesture('tap');
    await settle();
    expect(last().screen).toBe('steps');
    expect(last().title).toBe('Vers le bureau : 07:33 ▶ 08:58');
    c.onGesture('double');
    await settle();
    expect(last().screen).toBe('home');
    c.onGesture('double');
    await settle();
    expect(rec.calls.at(-1)).toEqual({ op: 'exit', arg: 1 });
    // Annulation : l'appli reste active. Confirmation : SYSTEM_EXIT_EVENT → arrêt et fermeture de la page.
    c.onSignal({ kind: 'exit', abnormal: false });
    expect(closeWebView).toHaveBeenCalledTimes(1);
    const n = rec.calls.length;
    await c.render();
    expect(rec.calls.length).toBe(n);
  });

  it('Aller à… depuis la maison : « ici », même si le cœur ne propose aucun trajet sur place', async () => {
    // Le vrai cœur renvoie [] quand départ et arrivée sont à moins de 100 m ; l'écran affichait « Maison   aucun trajet ».
    const sameAsRealCore = (core: Core): Core =>
      Object.assign(Object.create(core) as Core, {
        plan: (...a: Parameters<Core['plan']>) => (a[1].type === 'place' && a[1].placeId === 'maison' ? Promise.resolve([]) : core.plan(...a)),
      });
    const { c, last, settle } = await setup({ wrap: sameAsRealCore });
    for (let i = 0; i < 3; i++) c.onGesture('down');
    await settle();
    c.onGesture('tap');
    for (let i = 0; i < 5 && !(last().screen === 'places' && last().lines.some((l) => l.startsWith('Bureau   arrivée'))); i++) await settle();
    expect(last().screen).toBe('places');
    expect(last().lines[0]).toBe('Maison   ici');
    c.stop();
  });

  it('« ★ Retiré des favoris » ne suit pas l’utilisateur sur l’écran suivant', async () => {
    const { c, last, settle } = await setup({ scenario: 's2' });
    await settle();
    c.onGesture('tap');
    await settle();
    expect(last().lines.at(-1)).toBe('★ Retiré des favoris');
    c.onGesture('double');
    await settle();
    expect(last().screen).toBe('home');
    expect(last().lines).not.toContain('★ Retiré des favoris');
    expect(last().lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir');
    c.stop();
  });

  it('Aller à… Maison depuis la maison : « Tu es déjà à la maison. »', async () => {
    const { c, last, settle } = await setup();
    for (let i = 0; i < 3; i++) c.onGesture('down');
    await settle();
    c.onGesture('tap');
    await settle();
    expect(last().screen).toBe('places');
    c.onGesture('tap'); // Maison (premier lieu)
    for (let i = 0; i < 5 && last().screen !== 'message'; i++) await settle();
    expect(last()).toMatchObject({ screen: 'message', title: 'Vers la maison', lines: ['Tu es déjà à la maison.', 'double toucher : retour'] });
    c.stop();
  });

  it('horaires périmés : le message remplace « Aucun départ… » sur un tableau et s’affiche dans Autour de moi', async () => {
    // le vrai cœur ne renvoie aucun départ quand les horaires sont périmés
    const noDeps = (core: Core): Core => Object.assign(Object.create(core) as Core, { board: async (id: string, o?: Parameters<Core['board']>[1]) => ({ ...(await core.board(id, o)), departures: [] }) });
    const { c, last, settle } = await setup({ scenario: 's2', stale: true, wrap: noDeps });
    await c.show({ screen: 'board', areaId: 'stib:6357F' });
    for (let i = 0; i < 5 && !/Horaires/.test(last().lines[0] ?? ''); i++) await settle();
    expect(last().screen).toBe('board');
    expect(last().lines[0]).toMatch(/^Horaires périmés : mise à jour arrêtée le /);
    await c.show({ screen: 'nearby' });
    for (let i = 0; i < 5 && last().screen !== 'nearby'; i++) await settle();
    expect(last().lines.some((l) => /^Horaires périmés : /.test(l))).toBe(true);
    c.stop();
  });

  it('scénario 2 : le favori proche s’ouvre seul, double toucher revient à l’accueil', async () => {
    const { c, last, settle } = await setup({ scenario: 's2' });
    await settle();
    expect(last().screen).toBe('board');
    expect(last().title).toBe('Gare du Nord, tram (STIB)');
    expect(last().lines[0]).toBe('T3   Churchill   2 min');
    c.onGesture('double');
    await settle();
    expect(last().screen).toBe('home');
    expect(last().lines[0]).toBe('Près de Bruxelles-Nord');
    c.stop();
  });

  it('toucher sur un tableau : favori ajouté puis retiré', async () => {
    const { c, last, settle, settings } = await setup({ scenario: 's2' });
    await settle();
    const before = settings.get().favorites.length;
    c.onGesture('tap');
    await settle();
    expect(settings.get().favorites.length).toBe(before - 1);
    expect(last().lines.at(-1)).toBe('★ Retiré des favoris');
    c.stop();
  });

  it('premier lancement : explication dans les lunettes, toucher pour continuer', async () => {
    const { c, last, settle } = await setup({ onboarded: false });
    expect(last()).toMatchObject({ screen: 'message', title: 'Quai' });
    expect(last().lines[0]).toBe('Bienvenue dans Quai !');
    c.onGesture('tap');
    await settle();
    expect(last().screen).toBe('home');
    c.stop();
  });

  it('appli non configurée : message, pas d’écran noir', async () => {
    const { last, c } = await setup({ configured: false });
    expect(last().lines[0]).toBe('Quai n’est pas encore configuré.');
    c.stop();
  });

  it('horaires périmés : une ligne sur l’accueil', async () => {
    const { last, c, settle } = await setup({ stale: true });
    await settle();
    expect(last().screen).toBe('home');
    expect(last().lines[0]).toMatch(/^Horaires périmés : mise à jour arrêtée le/);
    c.stop();
  });

  it('arrière-plan : pause puis reprise avec reconstruction de la page', async () => {
    const { c, rec, settle } = await setup();
    c.onSignal({ kind: 'background' });
    const n = rec.calls.length;
    await c.refreshCurrent();
    expect(rec.calls.length).toBe(n);
    c.onSignal({ kind: 'foreground' });
    await settle();
    await settle();
    expect(rec.calls.slice(n).some((x) => x.op === 'rebuild')).toBe(true);
    c.stop();
  });

  it('instantané et restauration (WebView migrée quand le téléphone se verrouille)', async () => {
    const a = await setup();
    a.c.onGesture('tap');
    await a.settle();
    const snap = JSON.stringify(a.c.snapshot());
    a.c.stop();
    const b = await setup();
    b.c.restore(snap);
    await b.settle();
    await b.settle();
    expect(b.last().screen).toBe('steps');
    b.c.stop();
  });

  it('suivi : départ du train → « Dans le train » (scénario 1, horloge accélérée)', async () => {
    const { c, last, settle, advance } = await setup();
    c.onGesture('tap');
    await settle();
    advance(15 * 60_000);
    await c.refreshCurrent();
    await settle();
    expect(last().screen).toBe('train');
    expect(last().title).toBe('IC vers Bruxelles-Midi, +2 min');
    expect(last().lines[0]).toMatch(/^Namur   07:44/);
    c.stop();
  });

  it('« Afficher dans les lunettes » depuis le téléphone (scénario 3)', async () => {
    const { c, last, settle } = await setup({ scenario: 's3' });
    await c.show({
      screen: 'trip',
      from: { areaId: 'sncb:8813003', op: 'sncb', name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 50.8454, lon: 4.3571 },
      to: { areaId: 'sncb:8892007', op: 'sncb', name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters', l: 'nl' }, lat: 51.0359, lon: 3.7107 },
    });
    await settle();
    expect(last().screen).toBe('trip');
    expect(last().lines[0]).toBe('14:10   voie 4, arrivée 14:39   à l’heure');
    c.onGesture('double');
    await settle();
    expect(last().screen).toBe('home');
    c.stop();
  });

  it('réglages modifiés sur le téléphone : l’écran suit tout de suite', async () => {
    const { c, last, settle, settings } = await setup({ scenario: 's2' });
    await settle();
    c.onGesture('double');
    await settle();
    c.onGesture('tap');
    await settle();
    expect(last().screen).toBe('nearby');
    expect(last().lines).toContain('~ horaire prévu, sans temps réel');
    await settings.update((s) => ({ ...s, display: { ...s.display, markPlanned: false, gestureHints: false } }));
    await settle();
    expect(last().screen).toBe('nearby');
    expect(last().lines.some((l) => l.includes('~'))).toBe(false);
    expect(last().lines.some((l) => l.startsWith('▲▼'))).toBe(false);
    c.stop();
  });
});
