/**
 * Quai 1.2.10, contrôleur (PRD-1.2.10 § 3.6 à 3.8) : la boucle du guidage. Le moteur recalculé à chaque position (positions
 * continues selon son besoin : high, medium, off), à `wakeAt` (60 s au plus), au rafraîchissement du temps réel ; positions
 * gardées 5 min ; chemin à pied demandé (une demande à la fois, nouvel essai après un échec, nouveau chemin hors du
 * chemin) ; nouveau trajet quand le moteur le demande (genre trip : depuis `replan.from` jusqu'à la destination ; genre
 * ride : le suivant au tableau de l'arrêt) ; fin du guidage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Board, Core, Departure, Endpoint, Favorite, FavoriteAnswer, Journey, LatLon } from '../../src/core/api';
import type { GuideState, WalkRoute } from '../../src/core/guide-types';
import { TRIP_KEY, WATCH_OPTS, parseTrip } from '../../src/glasses/controller';
import type { Intent } from '../../src/glasses/types';
import { engine, moment, views, type Script } from './controller-guide-doubles';
import { NOW, SPOTS, busStops, cleanupKit, door, guideSetup, walkRouteOf, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, dep, settingsWith } from './helpers';

const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)] }, updatedAt: now } : undefined;
const settings = (patch: Record<string, unknown> = {}) => settingsWith([PLACES.bureau], { seenVersion: '1.2.10', ...patch });
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);

/** Ce que le moteur double rend, modifiable pendant le test. */
let out: Partial<GuideState> = {};

async function guided(o: Partial<KitOptions> = {}): Promise<Kit> {
  const h = await guideSetup({ settings: settings(), stub: { answers, ...(o.stub ?? {}) }, ...o });
  await h.until(homeReady);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  return h;
}

/** Le moteur rend `o` au prochain calcul. */
async function engineSays(h: Kit, o: Partial<GuideState>): Promise<void> {
  out = o;
  await h.c.refreshCurrent();
  await h.settle();
}

beforeEach(() => {
  engine.reset();
  views.reset();
  out = {};
  engine.script = (() => out) as Script;
});
afterEach(() => cleanupKit());

describe('PRD-1.2.10 § 3.7 : positions continues selon le besoin du moteur', () => {
  it('high (5 m, 2 s), medium (50 m, 30 s), off ; une seule demande en cours ; arrêtées à la fin', async () => {
    out = { location: 'high' };
    const h = await guided();
    expect(h.watches).toHaveLength(1);
    expect(h.watches[0].opts).toEqual({ accuracy: 'high', intervalMs: 2_000, distanceM: 5 });
    expect(WATCH_OPTS.medium).toEqual({ accuracy: 'medium', intervalMs: 30_000, distanceM: 50 });
    // même besoin : pas de nouvelle demande
    await engineSays(h, { location: 'high' });
    expect(h.watches).toHaveLength(1);
    await engineSays(h, { location: 'medium' });
    expect(h.watches).toHaveLength(2);
    expect(h.watches[0].stopped).toBe(true);
    expect(h.watches[1].opts).toEqual({ accuracy: 'medium', intervalMs: 30_000, distanceM: 50 });
    await engineSays(h, { location: 'off' });
    expect(h.watches[1].stopped).toBe(true);
    expect(h.watching()).toBeUndefined();
    await engineSays(h, { location: 'high' });
    expect(h.watching()?.opts.accuracy).toBe('high');
    await h.c.stopGuide();
    expect(h.watching()).toBeUndefined();
  });

  it('chaque position recalcule le moteur ; il reçoit les positions des 5 dernières minutes (vitesse, cap, précision)', async () => {
    out = { location: 'high' };
    const h = await guided();
    const n = engine.calls.length;
    await h.push(SPOTS.merbraine, { speed: 1.3, heading: 45, accuracy: 8 });
    expect(engine.calls.length).toBe(n + 1);
    const f = engine.last().input.fixes.at(-1)!;
    expect(f).toMatchObject({ lat: SPOTS.merbraine.lat, lon: SPOTS.merbraine.lon, speed: 1.3, heading: 45, accuracy: 8 });
    expect(f).not.toHaveProperty('source');
    await h.settle(2_000);
    await h.push(SPOTS.flagey);
    expect(engine.last().input.fixes).toHaveLength(2);
    // 5 min plus tard, la première n'y est plus (les positions du rafraîchissement de 30 s y sont aussi)
    await h.settle(5 * 60_000 - 1_000);
    await h.push(SPOTS.central);
    const lats = engine.last().input.fixes.map((x) => x.lat);
    expect(lats).not.toContain(SPOTS.merbraine.lat);
    expect(lats).toContain(SPOTS.flagey.lat);
    expect(lats.at(-1)).toBe(SPOTS.central.lat);
    const at = engine.last().input.now;
    expect(engine.last().input.fixes.every((x, i, a) => x.at >= at - 5 * 60_000 && (i === 0 || a[i - 1].at <= x.at))).toBe(true);
  });

  it('positions en double, illisibles ou choisies à la main (Quai Web) : écartées', async () => {
    out = { location: 'high' };
    const h = await guided();
    const w = h.watching()!;
    const n = engine.calls.length;
    const at = h.clock.now();
    w.cb({ lat: 50.8, lon: 4.3, at, source: 'sdk' });
    w.cb({ lat: 50.8, lon: 4.3, at, source: 'sdk' });
    w.cb({ lat: Number.NaN, lon: 4.3, at, source: 'sdk' });
    w.cb({ lat: 50.81, lon: 4.31, at: at + 1, source: 'manual' });
    await h.settle(5);
    expect(engine.calls.length).toBe(n + 1);
    expect(engine.last().input.fixes).toHaveLength(1);
  });

  it('sans positions continues (plateforme ancienne) : la position du rafraîchissement de 30 s nourrit le moteur', async () => {
    out = { location: 'high' };
    const h = await guided({ noWatch: true });
    expect(h.watches).toHaveLength(0);
    h.location.set(SPOTS.merbraine);
    await h.settle(30_500);
    expect(engine.calls.some((c) => c.input.fixes.some((f) => f.lat === SPOTS.merbraine.lat))).toBe(true);
  });

  it('réglage éteint : jamais de positions continues', async () => {
    out = { location: 'high' };
    const h = await guided({ settings: settings({ display: { ...settingsWith([]).display, guide: false } }) });
    expect(h.c.followed?.guide).toBeDefined();
    expect(h.watches).toHaveLength(0);
  });
});

describe('PRD-1.2.10 § 3.7 : recalcul à wakeAt et au temps réel', () => {
  it('à wakeAt (ici 20 s), puis au plus tard toutes les 60 s ; jamais en boucle serrée', async () => {
    // seule la minuterie du guidage recalcule ici : pas de position, temps réel en panne
    engine.script = (input) => ({ wakeAt: input.now + 20_000 });
    const h = await guided({ pos: null, coreExtra: () => ({ refresh: () => Promise.reject(new Error('relais muet')) }) });
    // lancement : « Où tu en es » s'efface à 15 s (avant wakeAt) : recalcul, puis wakeAt 20 s plus tard
    await h.settle(15_500);
    let n = engine.calls.length;
    await h.settle(19_000);
    expect(engine.calls.length).toBe(n);
    await h.settle(1_000);
    expect(engine.calls.length).toBe(n + 1);
    await h.settle(20_000);
    expect(engine.calls.length).toBe(n + 2);
    // wakeAt lointain : 60 s au plus (à partir du calcul suivant)
    engine.script = (input) => ({ wakeAt: input.now + 3_600_000 });
    await h.settle(20_000);
    n = engine.calls.length;
    await h.settle(59_000);
    expect(engine.calls.length).toBe(n);
    await h.settle(1_500);
    expect(engine.calls.length).toBe(n + 1);
    // wakeAt déjà passé : au plus une fois par seconde ; illisible : comme absent (60 s)
    for (const [bad, min, max] of [
      [0, 9, 10],
      [Number.NaN, 0, 1],
      [Number.POSITIVE_INFINITY, 0, 1],
    ]) {
      engine.script = () => ({ wakeAt: bad });
      await h.settle(61_000);
      n = engine.calls.length;
      await h.settle(10_000);
      expect(engine.calls.length - n, String(bad)).toBeLessThanOrEqual(max);
      expect(engine.calls.length - n, String(bad)).toBeGreaterThanOrEqual(min);
    }
  });

  it('un moment se termine à son heure (until) sans attendre la minuterie suivante', async () => {
    const h = await guided();
    await h.settle(16_000);
    const t0 = h.clock.now();
    engine.script = (input) => ({ wakeAt: input.now + 60_000, moment: input.now < t0 + 5_000 ? moment('platform', 'platform:j-bureau:1', t0, t0 + 5_000) : null });
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.last()).toMatchObject({ show: 'moment' });
    await h.settle(5_500);
    expect(h.last()).toMatchObject({ show: 'empty' });
  });

  it('le temps réel du trajet suivi rafraîchi recalcule le moteur avec le trajet à jour', async () => {
    let delay = 0;
    const h = await guided({
      coreExtra: () => ({
        async refresh(j: Journey) {
          return { ...j, legs: j.legs.map((l) => (l.kind === 'ride' ? { ...l, delayMin: delay } : l)) };
        },
      }),
    });
    delay = 4;
    await h.c.refreshCurrent();
    await h.settle();
    expect(engine.last().input.journey.legs[1].delayMin).toBe(4);
    expect(h.c.followed!.journey.legs[1].delayMin).toBe(4);
  });

  it('moteur en panne : rien ne casse, il est recalculé ensuite', async () => {
    const h = await guided();
    engine.throwNext = true;
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.last().screen).toBe('guide');
    const n = engine.calls.length;
    await h.settle(61_000);
    expect(engine.calls.length).toBeGreaterThan(n);
  });

  it('trajet fini par la règle de la 1.2.x (arrivée + 5 min) : le guidage s’arrête aussi', async () => {
    out = { location: 'medium' };
    const h = await guided();
    const w = h.watching()!;
    await h.settle(81 * MIN);
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.c.followed).toBeNull();
    expect(w.stopped).toBe(true);
  });
});

describe('PRD-1.2.10 § 3.8 : chemin à pied', () => {
  const need = { leg: 0, from: SPOTS.flagey, to: SPOTS.merbraine };

  it('demandé quand le moteur le dit ; une demande à la fois ; donné au moteur et gardé avec le trajet', async () => {
    const asks: [LatLon, LatLon][] = [];
    let release: (r: WalkRoute | null) => void = () => {};
    const h = await guided({
      walkRoute: (from, to) => {
        asks.push([from, to]);
        return new Promise((r) => (release = r));
      },
    });
    await engineSays(h, { needRoute: need });
    await engineSays(h, { needRoute: need });
    expect(asks).toEqual([[SPOTS.flagey, SPOTS.merbraine]]);
    release(walkRouteOf(SPOTS.flagey, SPOTS.merbraine));
    await h.settle();
    expect(engine.last().input.walk).toEqual({ leg: 0, route: expect.objectContaining({ source: 'osm', to: SPOTS.merbraine }) });
    expect(parseTrip(await h.kv.get(TRIP_KEY))?.guide?.walk).toMatchObject({ leg: 0, journeyId: 'j-bureau', route: { source: 'osm' } });
    // le moteur le redemande pour la même étape : déjà là, pas de nouvelle demande
    await engineSays(h, { needRoute: need });
    expect(asks).toHaveLength(1);
  });

  it('impossible (null ou erreur) : nouvel essai pour la même étape au plus tôt 2 min après', async () => {
    let fail: 'null' | 'throw' = 'null';
    const asks: number[] = [];
    const h = await guided({
      walkRoute: async () => {
        asks.push(Date.now());
        if (fail === 'throw') throw new Error('tuile absente');
        return null;
      },
    });
    out = { needRoute: need };
    await engineSays(h, out);
    expect(asks).toHaveLength(1);
    expect(engine.last().input.walk).toBeUndefined();
    await engineSays(h, out);
    expect(asks).toHaveLength(1);
    await h.settle(110_000);
    expect(asks).toHaveLength(1);
    await h.settle(40_000);
    expect(asks).toHaveLength(2);
    fail = 'throw';
    await h.settle(150_000);
    expect(asks).toHaveLength(3);
    await engineSays(h, out);
    expect(asks).toHaveLength(3);
    // jamais deux essais à moins de 2 min l'un de l'autre
    expect(asks.every((t, i) => i === 0 || t - asks[i - 1] >= 2 * MIN)).toBe(true);
  });

  it('hors du chemin plus de 30 m pendant 10 s : nouveau chemin depuis là, sans message ; près du chemin : rien', async () => {
    const asks: [LatLon, LatLon][] = [];
    const route = walkRouteOf(SPOTS.flagey, { lat: SPOTS.flagey.lat + 0.004, lon: SPOTS.flagey.lon });
    const h = await guided({
      walkRoute: async (from, to) => {
        asks.push([from, to]);
        return asks.length === 1 ? route : walkRouteOf(from, to);
      },
    });
    out = { location: 'high', phase: { kind: 'walk', leg: 0 }, needRoute: { leg: 0, from: route.from, to: route.to } };
    await engineSays(h, out);
    out = { location: 'high', phase: { kind: 'walk', leg: 0 } };
    expect(asks).toHaveLength(1);
    const on = { lat: SPOTS.flagey.lat + 0.001, lon: SPOTS.flagey.lon + 0.0001 };
    const away = { lat: SPOTS.flagey.lat + 0.001, lon: SPOTS.flagey.lon + 0.0008 };
    // sur le chemin (8 m) : rien
    for (let i = 0; i < 8; i++) {
      await h.push(on);
      await h.settle(2_000);
    }
    expect(asks).toHaveLength(1);
    // 56 m à côté, mais pas 10 s : rien ; une position imprécise ne compte pas
    await h.push(away);
    await h.settle(4_000);
    await h.push(away, { accuracy: 120 });
    await h.settle(4_000);
    await h.push(on);
    await h.settle(4_000);
    await h.push(away);
    expect(asks).toHaveLength(1);
    await h.settle(6_000);
    await h.push(away);
    await h.settle(4_100);
    await h.push(away);
    await h.settle();
    expect(asks).toHaveLength(2);
    expect(asks[1]).toEqual([away, route.to]);
    expect(h.c.followed!.guide!.walk!.route.from).toEqual(away);
    expect(h.last().show).not.toBe('moment');
  });

  it('chemin droit (sans données) : pas de nouveau chemin hors du chemin ; cœur sans chemin à pied : rien demandé', async () => {
    const asks: number[] = [];
    const straight = walkRouteOf(SPOTS.flagey, { lat: SPOTS.flagey.lat + 0.004, lon: SPOTS.flagey.lon }, 'straight');
    const h = await guided({
      walkRoute: async () => {
        asks.push(1);
        return straight;
      },
    });
    out = { location: 'high', phase: { kind: 'walk', leg: 0 }, needRoute: { leg: 0, from: straight.from, to: straight.to } };
    await engineSays(h, out);
    out = { location: 'high', phase: { kind: 'walk', leg: 0 } };
    const away = { lat: SPOTS.flagey.lat + 0.001, lon: SPOTS.flagey.lon + 0.002 };
    for (let i = 0; i < 10; i++) {
      await h.push(away);
      await h.settle(2_000);
    }
    expect(asks).toHaveLength(1);
    cleanupKit();
    engine.reset();
    engine.script = (() => out) as Script;
    const b = await guided();
    await engineSays(b, { needRoute: need });
    expect(engine.last().input.walk).toBeUndefined();
  });

  it('réglage éteint : aucun chemin demandé', async () => {
    const asks: number[] = [];
    const h = await guided({
      settings: settings({ display: { ...settingsWith([]).display, guide: false } }),
      walkRoute: async () => {
        asks.push(1);
        return null;
      },
    });
    await engineSays(h, { needRoute: need });
    expect(asks).toHaveLength(0);
  });
});

describe('PRD-1.2.10 § 3.6 : nouveau trajet', () => {
  const nord = { lat: 50.8605, lon: 4.3615 };
  const replan = (reason: 'missed' | 'cancelled' | 'passed', from: Partial<LatLon & { areaId: string; name: { fr: string; nl: string } }> = {}) => ({
    replan: { from: { ...nord, areaId: 'sncb:8812005', name: { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' }, ...from }, reason, at: NOW },
  });

  function routing(list: (now: number) => Journey[]) {
    const asked: { from: Endpoint; to: Endpoint; here: LatLon | null | undefined }[] = [];
    const coreExtra = (now: () => number): Partial<Core> => ({
      async route(from: Endpoint, to: Endpoint, _after: number, _s: unknown, here?: LatLon | null) {
        asked.push({ from, to, here });
        const journeys = list(now());
        return journeys.length ? { journeys } : { journeys, empty: 'noTrip' as const };
      },
    });
    return { asked, coreExtra };
  }

  it('genre trip : depuis l’arrêt donné par le moteur jusqu’à la destination ; le guidage bascule sur le premier trajet', async () => {
    const r = routing((now) => [door('j-new', now + 1 * MIN, now + 60 * MIN), door('j-new-2', now + 11 * MIN, now + 70 * MIN)]);
    const h = await guided({ coreExtra: r.coreExtra });
    const mem0 = h.c.followed!.guide!.mem;
    const key0 = h.c.followed!.key;
    engine.script = (input) => (input.journey.id === 'j-bureau' ? replan('missed') : {});
    await h.c.refreshCurrent();
    await h.settle();
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].from).toEqual({ type: 'area', areaId: 'sncb:8812005', op: 'sncb', name: { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' }, lat: nord.lat, lon: nord.lon });
    expect(r.asked[0].to).toEqual({ type: 'place', placeId: 'fav-bureau' });
    expect(r.asked[0].here).toEqual(nord);
    const t = h.c.followed!;
    expect(t.journey.id).toBe('j-new');
    expect(t.journeys.map((j) => j.id)).toEqual(['j-new', 'j-new-2']);
    expect(t.key).not.toBe(key0);
    expect(t).toMatchObject({ title: 'Vers le bureau', favoriteId: 'fav-bureau', guide: { kind: 'trip', mem: mem0 } });
    // le moteur reçoit le nouveau trajet et l'issue (ce qui est perdu), pour le moment « replan »
    const input = engine.last().input;
    expect(input.journey.id).toBe('j-new');
    expect(input.replanned).toMatchObject({ reason: 'missed', from: { id: 'j-bureau' } });
    expect(input.replanned?.none).toBeUndefined();
    expect(parseTrip(await h.kv.get(TRIP_KEY))?.journey.id).toBe('j-new');
    // le moteur ne demande plus rien : pas d'autre recherche
    await h.settle(61_000);
    expect(r.asked).toHaveLength(1);
    // une demande sur le nouveau trajet : une nouvelle recherche
    engine.script = (input) => (input.journey.id === 'j-new' ? replan('cancelled') : {});
    await h.c.refreshCurrent();
    await h.settle();
    expect(r.asked).toHaveLength(2);
  });

  it('une seule demande par trajet et par raison, une à la fois', async () => {
    let release: () => void = () => {};
    const asked: number[] = [];
    const h = await guided({
      coreExtra: (now) => ({
        route: () => {
          asked.push(1);
          return new Promise((r) => (release = () => r({ journeys: [door('j-new', now() + MIN, now() + 60 * MIN)] })));
        },
      }),
    });
    await engineSays(h, replan('missed'));
    await engineSays(h, replan('missed'));
    await engineSays(h, replan('cancelled'));
    expect(asked).toHaveLength(1);
    release();
    await h.settle();
    expect(h.c.followed!.journey.id).toBe('j-new');
  });

  it('rien trouvé : le guidage continue sur l’ancien trajet, le moteur le sait (none) ; pas de nouvel essai pour la même raison', async () => {
    const r = routing(() => []);
    const h = await guided({ coreExtra: r.coreExtra });
    await engineSays(h, replan('cancelled'));
    await h.settle();
    expect(h.c.followed!.journey.id).toBe('j-bureau');
    expect(engine.last().input.replanned).toMatchObject({ reason: 'cancelled', none: true, from: { id: 'j-bureau' } });
    await engineSays(h, replan('cancelled'));
    expect(r.asked).toHaveLength(1);
    // l'issue est donnée 2 min, puis oubliée (aussi dans quai.trip)
    out = {};
    await h.settle(100_000);
    expect(engine.last().input.replanned).toBeDefined();
    await h.settle(61_000);
    expect(engine.last().input.replanned).toBeUndefined();
    await h.settle(6_000);
    expect(parseTrip(await h.kv.get(TRIP_KEY))?.guide?.replanned).toBeUndefined();
  });

  it('arrêt dépassé, sans zone connue : depuis la position ; trajet sans destination gardée : l’arrivée de sa dernière étape', async () => {
    const r = routing((now) => [door('j-new', now + MIN, now + 60 * MIN)]);
    const h = await guideSetup({ settings: settings(), coreExtra: r.coreExtra });
    await h.until(homeReady);
    const j = door('j-x', NOW + 2 * MIN, NOW + 60 * MIN);
    j.legs[j.legs.length - 1].to = { name: { fr: 'Flagey', nl: 'Flagey' }, lat: SPOTS.flagey.lat, lon: SPOTS.flagey.lon };
    await h.c.show({ screen: 'steps', key: 'k-x', label: '', title: 'Vers Flagey', journeys: [j], index: 0 });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    await engineSays(h, { replan: { from: { lat: 50.85, lon: 4.36 }, reason: 'passed', at: NOW } });
    await h.settle();
    expect(r.asked[0]).toMatchObject({ from: { type: 'here' }, to: { type: 'address', label: 'Flagey', lat: SPOTS.flagey.lat, lon: SPOTS.flagey.lon }, here: { lat: 50.85, lon: 4.36 } });
    expect(h.c.followed!.journey.id).toBe('j-new');
  });

  it('arrêté pendant la recherche : la réponse est ignorée', async () => {
    let release: () => void = () => {};
    const h = await guided({
      coreExtra: (now) => ({ route: () => new Promise((r) => (release = () => r({ journeys: [door('j-new', now() + MIN, now() + 60 * MIN)] }))) }),
    });
    await engineSays(h, replan('missed'));
    await h.c.stopGuide();
    release();
    await h.settle();
    expect(h.c.followed).toBeNull();
  });

  describe('genre ride (« j’y descends »)', () => {
    const six = (now: number, minutes: number, p: Partial<Departure> = {}): Departure =>
      dep(now, minutes, { op: 'tec', mode: 'bus', line: '6', head: { fr: 'Gare des Guillemins', nl: 'Gare des Guillemins' }, ...p });
    const area = { id: 'tec:MonumentGramme', op: 'tec' as const, n: { fr: 'Monument Gramme', nl: 'Monument Gramme' }, lat: 50.8, lon: 4.3, modes: ['bus' as const], lines: ['6'] };

    async function ride(boardDeps: (now: number) => Departure[]): Promise<Kit> {
      const h = await guideSetup({
        settings: settings(),
        stub: {
          departureStops: (_a, d, now) => {
            const s = busStops(now);
            const shift = d.est - (now + 4 * MIN);
            return { ...s, stops: s.stops.map((c) => ({ ...c, sched: c.sched + shift, est: c.est + shift })) };
          },
          board: (id, now): Board | undefined => (id === 'tec:MonumentGramme' ? { area, departures: boardDeps(now), anyPlanned: false, rtErrors: [], updatedAt: now } : undefined),
        },
      });
      await h.until(homeReady);
      await h.c.show({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: six(NOW, 4, { tripId: 't1' }) });
      await h.until((s) => typeof (s as { stops?: unknown }).stops === 'number');
      await intent(h, { kind: 'alight', index: 2 });
      await h.settle();
      expect(h.c.followed?.guide?.kind).toBe('ride');
      return h;
    }

    it('véhicule raté : le suivant de la même ligne vers la même destination, jusqu’au même arrêt', async () => {
      const h = await ride((now) => [six(now, -2, { tripId: 't1' }), six(now, 9, { tripId: 't9', head: { fr: 'Ans', nl: 'Ans' } }), six(now, 12, { tripId: 't2' })]);
      await engineSays(h, replan('missed', { areaId: 'tec:MonumentGramme', name: { fr: 'Monument Gramme', nl: 'Monument Gramme' } }));
      await h.settle();
      const last = engine.rides.at(-1)!;
      expect(last).toMatchObject({ dep: { tripId: 't2' }, board: 0, alight: 2 });
      expect(h.c.followed!.journey.id).toBe(`ride:6:${last.dep.est}:2`);
      expect(h.c.followed!.title).toBe('Vers Gare des Guillemins');
      expect(engine.last().input.replanned).toMatchObject({ reason: 'missed', from: { id: expect.stringMatching(/^ride:6:/) } });
    });

    it('pas de suivant au tableau : none ; arrêt dépassé : rien à demander (le moteur dit « Descends à … »)', async () => {
      const h = await ride((now) => [six(now, -2, { tripId: 't1' }), six(now, 30, { cancelled: true, tripId: 't3' })]);
      await engineSays(h, replan('cancelled'));
      await h.settle();
      expect(engine.last().input.replanned).toMatchObject({ reason: 'cancelled', none: true });
      const n = engine.rides.length;
      await engineSays(h, replan('passed'));
      await h.settle();
      expect(engine.rides.length).toBe(n);
      expect(engine.last().input.replanned?.reason).toBe('cancelled');
    });
  });
});
