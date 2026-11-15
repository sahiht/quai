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

  it('réglage éteint (suivi sans message) : positions continues au plus medium', async () => {
    out = { location: 'high' };
    const h = await guided({ settings: settings({ display: { ...settingsWith([]).display, guide: false } }) });
    expect(h.c.followed?.guide).toBeDefined();
    expect(h.watches).toHaveLength(1);
    expect(h.watches[0].opts).toEqual({ accuracy: 'medium', intervalMs: 30_000, distanceM: 50 });
    await engineSays(h, { location: 'off' });
    expect(h.watching()).toBeUndefined();
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

  it('moment tenu au-delà de sa fin (« Descends », bus en retard sans temps réel) : recalcul à wakeAt, pas chaque seconde', async () => {
    const h = await guided({ pos: null, coreExtra: () => ({ refresh: () => Promise.reject(new Error('relais muet')) }) });
    await h.settle(16_000);
    const t0 = h.clock.now();
    // comme le vrai moteur : « Descends » tenu par la position, sa fin (arrivée + 2 min) déjà passée ; prochain réveil 30 s
    engine.script = (input) => ({ wakeAt: input.now + 30_000, moment: moment('alight', 'alight:j-bureau:1', t0 - 4 * MIN, t0 - 30_000) });
    // prochain recalcul (minuterie du guidage, 60 s au plus) : le moment est à l'écran
    await h.settle(61_000);
    expect(h.last()).toMatchObject({ show: 'moment' });
    const n = engine.calls.length;
    const t1 = engine.last().input.now;
    await h.settle(t1 + 10_000 - h.clock.now());
    expect(engine.calls.length).toBe(n);
    await h.settle(t1 + 31_000 - h.clock.now());
    expect(engine.calls.length).toBe(n + 1);
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

  it('un trajet guidé finit quand le moteur le dit (state.ended), pas par la règle de la 1.2.x seule', async () => {
    out = { location: 'medium' };
    const h = await guided();
    const w = h.watching()!;
    // arrivée + 5 min passée : tant que le moteur ne dit pas « fini » (encore en route d'après la position), il continue
    await h.settle(81 * MIN);
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.c.followed?.guide).toBeDefined();
    expect(w.stopped).toBe(false);
    await engineSays(h, { location: 'medium', ended: true });
    expect(h.c.followed).toBeNull();
    expect(w.stopped).toBe(true);
    expect(await h.kv.get(TRIP_KEY)).toBeFalsy();
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

  it('chemin quitté (le moteur redemande un chemin depuis la position) : nouveau chemin, sans message ; jamais deux en 10 s', async () => {
    const asks: [LatLon, LatLon][] = [];
    const route = walkRouteOf(SPOTS.flagey, SPOTS.merbraine);
    const h = await guided({
      walkRoute: async (from, to) => {
        asks.push([from, to]);
        return asks.length === 1 ? route : walkRouteOf(from, to, 'osm', Date.now());
      },
    });
    await engineSays(h, { location: 'high', phase: { kind: 'walk', leg: 0 }, needRoute: { leg: 0, from: route.from, to: route.to } });
    expect(asks).toHaveLength(1);
    // le moteur constate 10 s hors du chemin : il redemande depuis la position
    const away = { lat: SPOTS.flagey.lat + 0.001, lon: SPOTS.flagey.lon + 0.0008 };
    await h.settle(3_000);
    out = { location: 'high', phase: { kind: 'walk', leg: 0 }, needRoute: { leg: 0, from: away, to: route.to } };
    await h.push(away);
    // tout juste reçu (moins de 10 s) : pas encore
    expect(asks).toHaveLength(1);
    await h.settle(7_500);
    await h.push(away);
    await h.settle();
    expect(asks).toHaveLength(2);
    expect(asks[1]).toEqual([away, route.to]);
    expect(h.c.followed!.guide!.walk!.route.from).toEqual(away);
    expect(engine.last().input.walk?.route.from).toEqual(away);
    // le moteur le redemande aussitôt (encore hors du chemin) : pas avant 10 s
    await h.push(away);
    await h.settle(2_000);
    await h.push(away);
    expect(asks).toHaveLength(2);
    expect(h.last().show).not.toBe('moment');
  });

  it('cœur sans chemin à pied : rien demandé, le moteur guide sans chemin', async () => {
    const h = await guided();
    await engineSays(h, { needRoute: need });
    expect(engine.last().input.walk).toBeUndefined();
    expect(h.last().screen).toBe('guide');
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
  const replan = (reason: 'missed' | 'cancelled' | 'passed', from: Partial<LatLon & { areaId: string; name: { fr: string; nl: string } }> = {}, at = NOW + 3 * MIN) => ({
    replan: { from: { ...nord, areaId: 'sncb:8812005', name: { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' }, ...from }, reason, at },
  });

  function routing(list: (now: number) => Journey[]) {
    const asked: { from: Endpoint; to: Endpoint; after: number; here: LatLon | null | undefined }[] = [];
    const coreExtra = (now: () => number): Partial<Core> => ({
      async route(from: Endpoint, to: Endpoint, after: number, _s: unknown, here?: LatLon | null) {
        asked.push({ from, to, after, here });
        const journeys = list(now());
        return journeys.length ? { journeys } : { journeys, empty: 'noTrip' as const };
      },
    });
    return { asked, coreExtra };
  }

  it('genre trip : depuis `from` à partir de `at`, jusqu’à la destination ; adopté avec replanJourney, la mémoire du moteur gardée', async () => {
    const r = routing((now) => [door('j-new', now + 4 * MIN, now + 60 * MIN), door('j-new-2', now + 14 * MIN, now + 70 * MIN)]);
    const h = await guided({ coreExtra: r.coreExtra });
    const mem0 = h.c.followed!.guide!.mem;
    const key0 = h.c.followed!.key;
    engine.script = (input) => (input.journey.id === 'j-bureau' ? replan('missed') : {});
    await h.c.refreshCurrent();
    await h.settle();
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0]).toMatchObject({ after: NOW + 3 * MIN, here: nord, to: { type: 'place', placeId: 'fav-bureau' } });
    expect(r.asked[0].from).toEqual({ type: 'area', areaId: 'sncb:8812005', op: 'sncb', name: { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' }, lat: nord.lat, lon: nord.lon });
    expect(engine.swaps).toEqual([expect.objectContaining({ old: 'j-bureau', fresh: 'j-new' })]);
    const t = h.c.followed!;
    expect(t.journey.id).toBe('j-new');
    expect(t.journeys.map((j) => j.id)).toEqual(['j-new', 'j-new-2']);
    expect(t.key).not.toBe(key0);
    expect(t).toMatchObject({ title: 'Vers le bureau', favoriteId: 'fav-bureau', guide: { kind: 'trip', mem: mem0 } });
    expect(t.guide!.walk).toBeUndefined();
    // le moteur reçoit le nouveau trajet (il donne lui-même le moment « replan »)
    expect(engine.last().input.journey.id).toBe('j-new');
    expect(engine.nones).toEqual([]);
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

  it('la demande reste là avec le même `at` : une seule recherche, une à la fois ; une autre demande (autre `at`) : une autre', async () => {
    let release: () => void = () => {};
    const asked: number[] = [];
    const h = await guided({
      coreExtra: (now) => ({
        route: (_f: Endpoint, _t: Endpoint, after: number) => {
          asked.push(after);
          return new Promise((r) => (release = () => r({ journeys: [] })));
        },
      }),
    });
    await engineSays(h, replan('missed'));
    await engineSays(h, replan('missed'));
    await engineSays(h, replan('cancelled', {}, NOW + 9 * MIN));
    expect(asked).toEqual([NOW + 3 * MIN]);
    release();
    await h.settle();
    // rien trouvé pour la première ; la seconde (autre cause, autre `at`) part au calcul suivant
    await engineSays(h, replan('cancelled', {}, NOW + 9 * MIN));
    expect(asked).toEqual([NOW + 3 * MIN, NOW + 9 * MIN]);
    await engineSays(h, replan('missed'));
    expect(asked).toHaveLength(2);
  });

  it('rien trouvé : replanNone (« Pas d’autre trajet trouvé ») ; le guidage continue sur l’ancien trajet ; pas de nouvel essai', async () => {
    const r = routing(() => []);
    const h = await guided({ coreExtra: r.coreExtra });
    await engineSays(h, replan('cancelled'));
    await h.settle();
    expect(h.c.followed!.journey.id).toBe('j-bureau');
    expect(engine.nones).toHaveLength(1);
    expect(engine.swaps).toEqual([]);
    // la mémoire marquée par replanNone est celle que le moteur reçoit ensuite, et celle qui est gardée
    expect((engine.last().mem as { noneAt?: number }).noneAt).toBe(engine.nones[0]);
    await h.settle(6_000);
    expect((parseTrip(await h.kv.get(TRIP_KEY))?.guide?.mem as { noneAt?: number }).noneAt).toBe(engine.nones[0]);
    await engineSays(h, replan('cancelled'));
    expect(r.asked).toHaveLength(1);
  });

  it('le même trajet retrouvé : replanNone aussi', async () => {
    const r = routing(() => [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)]);
    const h = await guided({ coreExtra: r.coreExtra });
    await engineSays(h, replan('late' as 'missed'));
    await h.settle();
    expect(engine.nones).toHaveLength(1);
    expect(h.c.followed!.journey.id).toBe('j-bureau');
  });

  it('sans zone connue : depuis la position ; trajet sans destination gardée : l’arrivée de sa dernière étape', async () => {
    const r = routing((now) => [door('j-new', now + MIN, now + 60 * MIN)]);
    const h = await guideSetup({ settings: settings(), coreExtra: r.coreExtra });
    await h.until(homeReady);
    const j = door('j-x', NOW + 2 * MIN, NOW + 60 * MIN);
    j.legs[j.legs.length - 1].to = { name: { fr: 'Flagey', nl: 'Flagey' }, lat: SPOTS.flagey.lat, lon: SPOTS.flagey.lon };
    await h.c.show({ screen: 'steps', key: 'k-x', label: '', title: 'Vers Flagey', journeys: [j], index: 0 });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    await engineSays(h, { replan: { from: { lat: 50.85, lon: 4.36 }, reason: 'passed', at: NOW + 5 * MIN } });
    await h.settle();
    expect(r.asked[0]).toMatchObject({ from: { type: 'here' }, to: { type: 'address', label: 'Flagey', lat: SPOTS.flagey.lat, lon: SPOTS.flagey.lon }, here: { lat: 50.85, lon: 4.36 }, after: NOW + 5 * MIN });
    expect(h.c.followed!.journey.id).toBe('j-new');
  });

  it('arrêté pendant la recherche, ou réglage éteint : rien n’est adopté ni cherché', async () => {
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
    await h.c.stopGuide();
    release();
    await h.settle();
    expect(h.c.followed).toBeNull();
    expect(engine.swaps).toEqual([]);
    cleanupKit();
    engine.reset();
    engine.script = (() => out) as Script;
    const b = await guided({ settings: settings({ display: { ...settingsWith([]).display, guide: false } }), coreExtra: () => ({ route: async () => (asked.push(2), { journeys: [] }) }) });
    await engineSays(b, replan('missed'));
    expect(asked).toEqual([1]);
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

    it('véhicule raté : le suivant de la même ligne vers la même destination, jusqu’au même arrêt ; arrêts après la descente gardés', async () => {
      const h = await ride((now) => [six(now, -2, { tripId: 't1' }), six(now, 9, { tripId: 't9', head: { fr: 'Ans', nl: 'Ans' } }), six(now, 12, { tripId: 't2' })]);
      await engineSays(h, replan('missed', { areaId: 'tec:MonumentGramme', name: { fr: 'Monument Gramme', nl: 'Monument Gramme' } }, NOW + 6 * MIN));
      await h.settle();
      const last = engine.rides.at(-1)!;
      expect(last).toMatchObject({ dep: { tripId: 't2' }, board: 0, alight: 2 });
      expect(last.coords).toHaveLength(4);
      expect(engine.swaps).toHaveLength(1);
      expect(h.c.followed!.journey.id).toBe(`ride:6:${last.dep.est}:2`);
      expect(h.c.followed!.title).toBe('Vers Gare des Guillemins');
      expect(h.c.followed!.guide!.beyond?.map((x) => x.name.fr)).toEqual(['Fragnée']);
      expect(engine.last().input.beyond?.map((x) => x.name.fr)).toEqual(['Fragnée']);
    });

    it('pas de suivant au tableau : replanNone ; arrêt dépassé : rien à chercher au tableau, arrêt pas dans les arrêts suivants gardés : replanNone (le moteur garde « Descends à … »)', async () => {
      const h = await ride((now) => [six(now, -2, { tripId: 't1' }), six(now, 30, { cancelled: true, tripId: 't3' })]);
      await engineSays(h, replan('cancelled'));
      await h.settle();
      expect(engine.nones).toHaveLength(1);
      const n = engine.rides.length;
      await engineSays(h, replan('passed', {}, NOW + 8 * MIN));
      await h.settle();
      expect(engine.rides.length).toBe(n);
      expect(engine.kept).toHaveLength(1);
      expect(engine.nones).toHaveLength(2);
    });

    it('arrêt dépassé, l’arrêt suivant dans les arrêts suivants gardés : le même bus prolongé jusqu’à lui (rideOnJourney), adopté sans rien chercher, titre « Vers Fragnée »', async () => {
      const h = await ride((now) => [six(now, -2, { tripId: 't1' })]);
      const n = engine.rides.length;
      const next = h.c.followed!.guide!.beyond![0];
      const old = h.c.followed!.journey.id;
      // le moteur demande tant que le trajet est l'ancien (le vrai moteur se tait une fois le nouveau adopté)
      const ask = replan('passed', { lat: 50.62, lon: 5.57, areaId: next.areaId, name: next.name }, next.est);
      engine.script = ((input) => (input.journey.id === old ? ask : {})) as Script;
      await h.c.refreshCurrent();
      await h.settle();
      expect(engine.rides.length).toBe(n);
      expect(engine.nones).toEqual([]);
      expect(engine.kept).toHaveLength(1);
      const t = h.c.followed!;
      expect(t.journey.legs[0]).toMatchObject({ to: { name: { fr: 'Fragnée' } }, arr: next.est });
      expect(t.title).toBe('Vers Fragnée');
      // plus d'arrêt gardé après Fragnée
      expect(t.guide?.kind).toBe('ride');
      expect(t.guide?.beyond ?? []).toEqual([]);
      expect(engine.last().input.journey.id).toBe(t.journey.id);
    });
  });
});
