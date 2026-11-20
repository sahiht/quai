// @vitest-environment happy-dom
/**
 * Quai 1.3.1, R2 (PRD-1.3.1 § 14 ; docs/v1.3.1/experts/06-rd.md) : « Essayer en accéléré », dans Quai Web seulement
 * (web/essai.ts). Banc : les vraies lunettes (contrôleur, port derrière gatedPort comme dans web/main.ts, stockage en
 * mémoire, journal des trajets) et l'essai, chacun dessinant dans le même écran (dessins notés « vraies » ou « essai ») ;
 * minuteries simulées de Vitest. Trajet de test sur des lieux publics (Liège) : 9 min à pied du parc d'Avroy à l'arrêt
 * Monument Gramme (deux virages), bus 6 jusqu'à Gare des Guillemins (07:12 → 07:20, 3 min de retard en temps réel),
 * 3 min à pied jusqu'à la gare de Liège-Guillemins.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey, LatLon, Settings } from '../../src/core/api';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { createJournal, JOURNAL_KEY } from '../../src/core/journal';
import { distanceM } from '../../src/core/util';
import { dataFreshness } from '../../src/dev/fake-core';
import { GlassesController, TRIP_KEY } from '../../src/glasses/controller';
import type { ContainerSpec } from '../../src/glasses/types';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { messageHub } from '../../src/phone/ui';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix, GlassesPort, LocationPort } from '../../src/platform/types';
import { SettingsStore } from '../../src/settings';
import { APP_VERSION } from '../../src/version';
import { createEssai, ESSAI_LEAD_MS, ESSAI_TEXT, gatedPort, plannedJourney, simulatedFix, type Essai } from '../../src/web/essai';
import { createWebGlassesPort } from '../../src/web/port';
import { BUS6, MIN, P, S, at, firstWalkRoute, journeyOf, offset, route, walkLeg } from '../core/guide-fixtures';
import { stubCore } from '../glasses/helpers';
import { harness, mount, plain, preset11, SCENARIO, textOf, withGuide } from '../phone/helpers';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  resetAnswers();
});

/** Favori lieu public : la gare de Liège-Guillemins (trajet depuis la position, au parc d'Avroy). */
const GARE = { kind: 'place', id: 'fav-gare', label: 'Gare', lat: P.guillemins.lat, lon: P.guillemins.lon, propose: 'never' } as Favorite;

/** Le trajet tel que le cœur le donne (temps réel : bus 6 à 07:15 au lieu de 07:12). */
function trip(): Journey {
  const b6 = BUS6({ bus6Delay: 3 });
  const walk0 = walkLeg(S.avroy, S.gramme, b6.dep - 11 * MIN, 9, b6.schedDep - 11 * MIN);
  return journeyOf([walk0, b6, walkLeg(S.guilleminsBus, S.guillemins, b6.arr, 3, b6.schedArr)], 'jessai', walk0.dep);
}

const answerOf = (now: number): FavoriteAnswer => ({ favoriteId: GARE.id, kind: 'trip', state: 'ok', plan: { journeys: [trip()] }, updatedAt: now });

interface Frame {
  by: 'vraies' | 'essai';
  text: string;
  clock: string;
}

/** Vraies lunettes et essai, comme web/main.ts (sans le canvas : chaque dessin est noté). */
async function bench(o: { realNow?: number } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'], now: o.realNow ?? at('06:40') });
  const clock = createClock({ mockNow: Date.now(), perfNow: () => performance.now(), e2e: false });
  const backend = memoryBackend();
  const writes: string[] = [];
  const kv = createKV({
    ...backend,
    async set(k, v) {
      writes.push(k);
      await backend.set(k, v);
    },
  });
  const settings = new SettingsStore(kv, { ...structuredClone(DEFAULT_SETTINGS), onboarded: true, seenVersion: APP_VERSION, favorites: [GARE], display: { ...DEFAULT_SETTINGS.display, opening: 'home' } } as Settings);
  const here: Fix = { lat: P.avroy.lat, lon: P.avroy.lon, accuracy: 10, at: clock.now(), source: 'browser' };
  const location: LocationPort = { current: async () => here, last: () => here };
  const frames: Frame[] = [];
  const screen = (by: Frame['by']) => ({
    paint(cs: readonly ContainerSpec[]) {
      frames.push({ by, text: cs.map((c) => c.content).join('\n').replace(/ /g, ' '), clock: (cs.find((c) => c.name === 'clock')?.content ?? '').trim() });
    },
  });
  const walks: [LatLon, LatLon][] = [];
  const core = Object.assign(stubCore(clock.now, { answers: (f, now) => (f.id === GARE.id ? answerOf(now) : undefined) }), {
    async walkRoute(from: LatLon, to: LatLon) {
      walks.push([from, to]);
      // la première marche : le chemin en U du parc d'Avroy à Monument Gramme (deux virages à droite) ; ensuite tout droit
      return distanceM(to, P.gramme) < 30 ? firstWalkRoute() : route([from, to]);
    },
  });
  let essai: Essai | null = null;
  const realPort = gatedPort(createWebGlassesPort(screen('vraies')), () => !essai?.active());
  const logs: string[] = [];
  const controller = new GlassesController({ platform: { kind: 'web', glasses: realPort, kv, location, closeWebView: () => undefined }, core, settings, clock, configured: true, freshness: dataFreshness, e2e: true, log: (l) => logs.push(l), web: true, pageStarted: true });
  await controller.start();
  const journal = await createJournal(kv, { now: clock.now });
  controller.attachJournal(journal);
  const trialLogs: string[] = [];
  const shown: string[] = [];
  essai = createEssai({
    controller,
    realSignal: (s) => realPort.emit(s),
    port: () => createWebGlassesPort(screen('essai')),
    core: async () => {
      await controller.ensureInit();
      return core;
    },
    freshness: dataFreshness,
    settings,
    kv,
    location,
    clock,
    showGlasses: () => shown.push('lunettes'),
    e2e: true,
    log: (l) => trialLogs.push(l),
  });
  const trial = essai;
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  await advance(50);
  /** Moments montrés par l'écran du guidage de l'essai, dans l'ordre de leur première apparition (sorte). */
  const moments = (): string[] => {
    const seen = new Map<string, string>();
    for (const l of trialLogs) {
      if (!l.startsWith('QUAI_SCREEN ')) continue;
      const s = JSON.parse(l.slice(12)) as { screen: string; show?: string; moment?: { kind: string; id: string } | null };
      if (s.screen === 'guide' && s.show === 'moment' && s.moment && !seen.has(s.moment.id)) seen.set(s.moment.id, s.moment.kind);
    }
    return [...seen.values()];
  };
  /** L'essai jusqu'à sa fin (au plus `maxS` secondes réelles). */
  const runToEnd = async (maxS = 400): Promise<number> => {
    let s = 0;
    while (trial.active() && s < maxS) {
      await advance(1_000);
      s++;
    }
    return s;
  };
  return { essai: trial, controller, clock, kv, backend, writes, frames, logs, trialLogs, moments, runToEnd, advance, location, here, journal, walks, shown };
}

type Bench = Awaited<ReturnType<typeof bench>>;

const lastFrame = (b: Bench): Frame => b.frames[b.frames.length - 1];
const hhmm = (t: number): string => new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(t);

/** `sub` apparaît dans `all` dans cet ordre (d'autres éléments peuvent s'intercaler). */
function inOrder(all: string[], sub: string[]): boolean {
  let i = 0;
  for (const x of all) if (x === sub[i]) i++;
  return i === sub.length;
}

describe('trajet aux heures prévues et positions simulées (fonctions pures)', () => {
  it('le temps réel est retiré : bus 6 à son horaire, marches recalculées autour de lui (2 min de marge), plus d’alerte', () => {
    const j = { ...trip(), alerts: [{ kind: 'delay' as const, text: 'Bus 6 : +3 min', at: at('07:00') }] };
    expect(j.legs[1]).toMatchObject({ dep: at('07:15'), rt: true, delayMin: 3 });
    const p = plannedJourney(j, 2);
    expect(p.legs.map((l) => [hhmm(l.dep), hhmm(l.arr)])).toEqual([
      ['07:01', '07:10'],
      ['07:12', '07:20'],
      ['07:20', '07:23'],
    ]);
    expect(p.legs[1]).toMatchObject({ rt: false, delayMin: 0, cancelled: false });
    expect(p.legs[1].stops!.every((s) => s.est === s.sched)).toBe(true);
    expect(p).toMatchObject({ id: 'jessai', leaveAt: at('07:01'), dep: at('07:01'), arr: at('07:23'), rt: false, alerts: [] });
    // le trajet donné n'est pas touché
    expect(j.legs[1].dep).toBe(at('07:15'));
  });

  it('positions sur le vrai chemin : départ, le long du chemin à pied au rythme prévu, à l’arrêt, d’arrêt en arrêt, arrivée', () => {
    const j = plannedJourney(trip(), 2);
    const walk = { leg: 0, route: firstWalkRoute() };
    const near = (f: Fix | null, p: LatLon, m: number) => expect(distanceM(f!, p)).toBeLessThan(m);
    near(simulatedFix(j, at('07:00'), walk), P.avroy, 1);
    expect(simulatedFix(j, at('07:00'), walk)).toMatchObject({ speed: 0, source: 'mock', at: at('07:00') });
    // le premier virage du chemin (200 m au sud) est atteint à la part prévue de la marche (9 min pour tout le chemin)
    const turnAt = at('07:01') + Math.round((9 * MIN * 200) / walk.route.lengthM);
    near(simulatedFix(j, turnAt, walk), offset(P.avroy, 0, -200), 2);
    const mid = simulatedFix(j, at('07:05'), walk)!;
    expect(mid.speed).toBeGreaterThan(1);
    expect(mid.speed).toBeLessThanOrEqual(2.2);
    expect(mid.heading).toBeTypeOf('number');
    // sans chemin à pied : tout droit
    near(simulatedFix(j, at('07:05:30'), null), { lat: (P.avroy.lat + P.gramme.lat) / 2, lon: (P.avroy.lon + P.gramme.lon) / 2 }, 2);
    // à l'arrêt en attendant le bus, puis à bord entre deux arrêts (vitesse de véhicule), puis à l'arrivée
    near(simulatedFix(j, at('07:11'), walk), P.gramme, 1);
    near(simulatedFix(j, at('07:14'), walk), { lat: (P.gramme.lat + P.leman.lat) / 2, lon: (P.gramme.lon + P.leman.lon) / 2 }, 2);
    expect(simulatedFix(j, at('07:14'), walk)!.speed).toBeGreaterThan(2);
    near(simulatedFix(j, at('07:30'), walk), P.guillemins, 1);
  });

  it('gatedPort : rien n’est dessiné tant que la porte est fermée ; gestes et signaux passent', async () => {
    const painted: number[] = [];
    let open = false;
    const port = gatedPort(createWebGlassesPort({ paint: (cs) => painted.push(cs.length) }), () => open);
    const signals: string[] = [];
    port.onSignal((s) => signals.push(s.kind));
    await port.rebuild([{ id: 1, name: 'title', x: 0, y: 0, w: 10, h: 10, content: 'a', level: 4, capture: true }]);
    expect(painted).toEqual([]);
    port.emit({ kind: 'background' });
    expect(signals).toEqual(['background']);
    open = true;
    await port.rebuild([{ id: 1, name: 'title', x: 0, y: 0, w: 10, h: 10, content: 'a', level: 4, capture: true }]);
    expect(painted).toEqual([1]);
    const bare: GlassesPort = { start: async () => true, rebuild: async () => true, upgrade: async () => true, onSignal: () => () => undefined, exit: async () => undefined };
    expect(gatedPort(bare, () => true).paint).toBeUndefined();
  });
});

describe('l’essai dans Quai Web (vrai contrôleur, vrai moteur, vrais écrans)', () => {
  it('10 fois plus vite : 6 s réelles = 1 min de l’essai ; il commence 1 min avant de partir, à l’heure prévue (07:01, pas 07:04)', async () => {
    const b = await bench();
    const r = await b.essai.tryFavorite(GARE.id);
    expect(r).toEqual({ text: ESSAI_TEXT.started, ok: true });
    expect(b.essai.active()).toBe(true);
    expect(b.shown).toEqual(['lunettes']);
    expect(b.essai.banner.hidden).toBe(false);
    expect(textOf(b.essai.banner.querySelector('[role="status"]'))).toBe(plain(ESSAI_TEXT.banner));
    expect(textOf(b.essai.banner.querySelector('button'))).toBe('Arrêter l’essai');
    expect(ESSAI_TEXT.banner).toBe('Essai en accéléré : positions simulées, rien n’est enregistré.');
    const t0 = b.essai.now()!;
    expect(t0).toBe(at('07:01') - ESSAI_LEAD_MS);
    const real0 = b.clock.now();
    await b.advance(50);
    expect(lastFrame(b)).toMatchObject({ by: 'essai', clock: '07:00' });
    expect(b.moments()).toEqual([]);
    await b.advance(6_000);
    expect(b.clock.now() - real0).toBe(6_050);
    expect(b.essai.now()! - t0).toBe(60_500);
    // 07:01 : « Partir maintenant », dessiné dans l'écran des lunettes de la page
    expect(b.moments()).toEqual(['leave']);
    expect(lastFrame(b).by).toBe('essai');
    expect(lastFrame(b).clock).toBe('07:01');
    expect(lastFrame(b).text).toMatch(/Partir maintenant/);
    // l'heure vraie n'a pas bougé plus que le temps réel
    expect(b.clock.now()).toBe(at('06:40') + 50 + 6_050);
    b.essai.stop();
  });

  it('les messages du guidage dans l’ordre : partir, virages, monter, descendre, « Tu y es » ; positions sur le chemin à pied du guidage', async () => {
    const b = await bench();
    await b.essai.tryFavorite(GARE.id);
    const seconds = await b.runToEnd();
    // 07:00 → fin du guidage (« Tu y es » vers 07:23, plus 2 min) : environ 150 s réelles
    expect(b.essai.active()).toBe(false);
    expect(seconds).toBeGreaterThan(130);
    expect(seconds).toBeLessThan(200);
    const ms = b.moments();
    expect(inOrder(ms, ['leave', 'turn', 'board', 'alight', 'arrived'])).toBe(true);
    expect(ms.filter((m) => m === 'turn').length).toBeGreaterThanOrEqual(1);
    // le chemin de la première marche a été demandé depuis le départ du trajet, puis celui de la dernière marche
    expect(distanceM(b.walks[0][0], P.avroy)).toBeLessThan(1);
    expect(distanceM(b.walks[0][1], P.gramme)).toBeLessThan(1);
    expect(b.walks.some(([, to]) => distanceM(to, P.guillemins) < 1)).toBe(true);
    const texts = b.frames.filter((f) => f.by === 'essai').map((f) => f.text);
    expect(texts.some((t) => /Partir maintenant/.test(t))).toBe(true);
    expect(texts.some((t) => /Tu y es/.test(t))).toBe(true);
    // fin du guidage de l'essai : les vraies lunettes reprennent l'écran
    expect(lastFrame(b).by).toBe('vraies');
    expect(b.essai.banner.hidden).toBe(true);
  });

  it('rien n’est enregistré : ni trajet suivi (quai.trip) ni journal des trajets (quai.journal), réglages intacts', async () => {
    const b = await bench();
    const before = { trip: b.backend.data.get(TRIP_KEY), journal: b.backend.data.get(JOURNAL_KEY), settings: b.backend.data.get('quai.settings'), list: b.journal.list().length };
    b.writes.length = 0;
    await b.essai.tryFavorite(GARE.id);
    await b.advance(60_000);
    // en plein guidage de l'essai (à bord ou à pied) : il a un trajet suivi, guidé, dans son propre stockage
    expect(b.essai.sandbox()!.followed?.guide?.kind).toBe('trip');
    await b.runToEnd();
    await b.journal.flush();
    expect(b.writes.filter((k) => k.startsWith(TRIP_KEY) || k.startsWith(JOURNAL_KEY) || k.startsWith('quai.settings'))).toEqual([]);
    expect({ trip: b.backend.data.get(TRIP_KEY), journal: b.backend.data.get(JOURNAL_KEY), settings: b.backend.data.get('quai.settings'), list: b.journal.list().length }).toEqual(before);
    expect(b.controller.followed).toBeNull();
  });

  it('« Arrêter l’essai » : les vraies lunettes reviennent telles quelles (trajet suivi, position, heure vraie), plus rien de l’essai', async () => {
    const b = await bench();
    // un vrai trajet suivi (bouton « Lunettes »), sans guidage : il n'empêche pas l'essai et n'est pas touché
    await b.controller.showTrip({ title: 'Gare', from: { type: 'here' }, to: { type: 'place', placeId: GARE.id }, favoriteId: GARE.id, result: { journeys: [trip()] }, index: 0 });
    await b.advance(50);
    const followed = JSON.stringify(b.controller.followed);
    const saved = b.backend.data.get(TRIP_KEY);
    expect(saved).toBeTruthy();
    expect(lastFrame(b).by).toBe('vraies');
    await b.essai.tryFavorite(GARE.id);
    await b.advance(20_000);
    expect(lastFrame(b).by).toBe('essai');
    // pendant l'essai, les vraies lunettes n'envoient rien à l'écran
    const n = b.frames.length;
    await b.advance(40_000);
    expect(b.frames.slice(n).every((f) => f.by === 'essai')).toBe(true);
    const stop = b.essai.banner.querySelector<HTMLButtonElement>('button')!;
    expect(textOf(stop)).toBe('Arrêter l’essai');
    stop.click();
    expect(b.essai.active()).toBe(false);
    expect(b.essai.now()).toBeNull();
    expect(b.essai.banner.hidden).toBe(true);
    await b.advance(50);
    // l'écran d'avant, redessiné par les vraies lunettes, à l'heure vraie
    expect(lastFrame(b).by).toBe('vraies');
    expect(lastFrame(b).clock).toBe(hhmm(b.clock.now()));
    expect(b.clock.now()).toBe(at('06:40') + 50 + 50 + 20_000 + 40_000 + 50);
    expect(JSON.stringify(b.controller.followed)).toBe(followed);
    expect(b.backend.data.get(TRIP_KEY)).toBe(saved);
    expect(b.location.last()).toBe(b.here);
    // plus rien de l'essai ensuite
    const m = b.frames.length;
    await b.advance(60_000);
    expect(b.frames.slice(m).every((f) => f.by === 'vraies')).toBe(true);
  });

  it('un vrai guidage en cours empêche l’essai (texte simple) ; le vrai guidage n’est pas touché', async () => {
    const b = await bench();
    await b.controller.goFavorite(GARE.id);
    await b.advance(50);
    expect(b.controller.followed?.guide?.kind).toBe('trip');
    const saved = b.backend.data.get(TRIP_KEY);
    const n = b.frames.length;
    const hub = messageHub();
    const slot = hub.slot();
    const button = b.essai.button(GARE.id, 'Vers la gare', hub, slot);
    document.body.append(button, slot);
    button.click();
    await b.advance(50);
    expect(slot.textContent).toBe(ESSAI_TEXT.busy);
    expect(ESSAI_TEXT.busy).toBe('Un guidage est en cours : pas d’essai en même temps.');
    expect(slot.classList.contains('err')).toBe(true);
    expect(b.essai.active()).toBe(false);
    expect(b.frames.slice(n).every((f) => f.by === 'vraies')).toBe(true);
    expect(b.controller.followed?.guide?.kind).toBe('trip');
    expect(b.backend.data.get(TRIP_KEY)).toBe(saved);
  });

  it('« Y aller » du téléphone pendant l’essai : l’essai s’arrête d’abord, puis le vrai guidage commence ; double toucher sur le guidage de l’essai : retour', async () => {
    const b = await bench();
    await b.essai.tryFavorite(GARE.id);
    await b.advance(10_000);
    expect(b.essai.active()).toBe(true);
    const phone = b.essai.glasses(b.controller);
    expect(b.essai.glasses(b.controller)).toBe(phone);
    expect(typeof phone.goFavorite).toBe('function');
    await phone.goFavorite!(GARE.id);
    expect(b.essai.active()).toBe(false);
    expect(b.controller.followed?.guide?.kind).toBe('trip');
    await b.advance(50);
    expect(lastFrame(b).by).toBe('vraies');
    // autre essai, quitté d'un double toucher sur l'écran du guidage (après l'arrêt du vrai guidage)
    await b.controller.stopGuide();
    await b.essai.tryFavorite(GARE.id);
    await b.advance(3_000);
    expect(b.essai.sandbox()!.state.nav.stack.at(-1)?.route.screen).toBe('guide');
    b.essai.gesture('tap');
    await b.advance(50);
    expect(b.essai.active()).toBe(true);
    b.essai.gesture('double');
    expect(b.essai.active()).toBe(false);
  });
});

describe('le bouton, seulement dans Quai Web', () => {
  const essai = (): Essai =>
    createEssai({
      controller: { followed: null, error: null },
      realSignal: () => undefined,
      port: () => createWebGlassesPort({ paint: () => undefined }),
      core: () => Promise.reject(new Error('pas de cœur')),
      freshness: dataFreshness,
      settings: new SettingsStore(createKV(memoryBackend()), preset11()),
      kv: createKV(memoryBackend()),
      location: { current: async () => null, last: () => null },
      clock: createClock({ mockNow: SCENARIO.s1.now }),
    });

  it('accueil : « Essayer en accéléré » sous « Y aller » de chaque favori, nommé avec lui ; sans le crochet (appli Even), rien', () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    withGuide(hz.glasses);
    const e = essai();
    hz.ctx.tryButton = (id, title, hub, slot) => e.button(id, title, hub, slot);
    const el = mount(homeScreen(hz.ctx));
    const rows = [...el.querySelectorAll<HTMLElement>('.fav-card .fav-row')];
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const name = textOf(r.querySelector('.t1'));
      // dans l'ordre de la rangée : le nom, « Lunettes » et « Y aller », puis l'essai sous eux, puis le message
      expect([...r.children].map((c) => c.className)).toEqual(['txt', 'fav-actions', 'btn btn-link w-try', 'msg']);
      const tryIt = r.querySelector<HTMLButtonElement>('.w-try')!;
      expect([textOf(tryIt), tryIt.type, plain(tryIt.getAttribute('aria-label'))]).toEqual(['Essayer en accéléré', 'button', `Essayer en accéléré : ${name}`]);
      expect(tryIt.getAttribute('aria-label')).toContain('accéléré :');
    }
    // appli Even : le téléphone n'a pas le crochet, donc pas de bouton
    const even = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    withGuide(even.glasses);
    expect(mount(homeScreen(even.ctx)).querySelector('.w-try')).toBeNull();
    // ni sans « Y aller » (lunettes qui ne savent pas guider)
    const old = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    old.ctx.tryButton = (id, title, hub, slot) => e.button(id, title, hub, slot);
    expect(mount(homeScreen(old.ctx)).querySelector('.w-try')).toBeNull();
  });

  it('« Mes favoris » : sous « Y aller » aussi ; le bouton rend son message dans la rangée', async () => {
    const hz = harness({ settings: preset11() });
    withGuide(hz.glasses);
    const e = essai();
    hz.ctx.tryButton = (id, title, hub, slot) => e.button(id, title, hub, slot);
    const el = mount(favoritesScreen(hz.ctx));
    const rows = [...el.querySelectorAll<HTMLElement>('li.fav-go')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const kids = [...r.children];
      const go = kids.findIndex((c) => c.classList.contains('btn-go'));
      expect(kids[go + 1].classList.contains('w-try')).toBe(true);
      expect(kids[go + 2].classList.contains('msg')).toBe(true);
    }
    // sans cœur : le message d'erreur dans la rangée, pas d'essai
    rows[0].querySelector<HTMLButtonElement>('.w-try')!.click();
    await vi.waitFor(() => expect(textOf(rows[0].querySelector('.msg'))).not.toBe(''));
    expect(e.active()).toBe(false);
    const even = harness({ settings: preset11() });
    withGuide(even.glasses);
    expect(mount(favoritesScreen(even.ctx)).querySelector('.w-try')).toBeNull();
  });

  it('paquet des lunettes : ni le module de l’essai ni ses textes dans ce qu’importe main.ts ; Quai Web les a', () => {
    const APP = fileURLToPath(new NodeURL('../../', import.meta.url));
    /** Fichiers atteints depuis `entry` par les imports relatifs (statiques et dynamiques), types compris. */
    const graph = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const visit = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+['"](\.[^'"]+)['"]/g)) {
          const spec = m[1] ?? m[2] ?? m[3];
          const base = resolve(dirname(file), spec);
          const hit = [base, `${base}.ts`, join(base, 'index.ts')].find((p) => /\.(ts|mjs|js)$/.test(p) && existsSync(p));
          if (hit) visit(hit);
        }
      };
      visit(join(APP, entry));
      return seen;
    };
    const even = graph('src/main.ts');
    const web = graph('src/web/main.ts');
    const essaiFile = join(APP, 'src/web/essai.ts');
    expect(even.size).toBeGreaterThan(50);
    expect(even.has(essaiFile)).toBe(false);
    expect(web.has(essaiFile)).toBe(true);
    // le code seulement (les commentaires disparaissent au build)
    const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of even) {
      const src = code(f);
      for (const t of ['Essayer en accéléré', 'Essai en accéléré', 'Arrêter l’essai', 'createEssai']) expect(src.includes(t), `${f} : ${t}`).toBe(false);
    }
    // l'appli Even ne donne pas le crochet du bouton au téléphone ; Quai Web le donne
    expect(readFileSync(join(APP, 'src/main.ts'), 'utf8')).not.toMatch(/tryButton/);
    expect(readFileSync(join(APP, 'src/web/main.ts'), 'utf8')).toMatch(/tryButton: \(id, title, hub, slot\) => trial\.button\(id, title, hub, slot\)/);
  });
});
