/**
 * Quai 1.2.10, contrôleur avec le vrai moteur du guidage (core/guide.ts, équipe A) : seuls les écrans du guidage sont
 * des doubles (équipe C1). Trajet du PRD sur des lieux publics (fixtures de l'équipe A) : Parc d'Avroy à pied jusqu'à
 * Monument Gramme, bus 6, IC, bus 71 jusqu'à Flagey, à pied. Vérifie la boucle de bout en bout : positions continues
 * selon le moteur, chemin à pied demandé puis suivi (virage annoncé, image dessinée), « Partir maintenant » effacé d'un
 * toucher, nouveau trajet (IC supprimé), réglage éteint, « j'y descends », fin donnée par le moteur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Core, Departure, DepartureStops, Endpoint, Journey, LatLon, SearchItem } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { TRIP_KEY, parseTrip } from '../../src/glasses/controller';
import { CLOCK_EVENT } from '../../src/platform/clock';
import type { ImageSpec, Intent } from '../../src/glasses/types';
import { P, at, firstWalkRoute, lerp, offset, prdTrip, toward } from '../core/guide-fixtures';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { views } from './controller-guide-doubles';
import { busStops, cleanupKit, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, dep, settingsWith } from './helpers';

const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const settings = (guide = true) => settingsWith([], { seenVersion: '1.3.0', display: { ...settingsWith([]).display, guide } });
const ETANGS: Endpoint = { type: 'address', label: 'Étangs d’Ixelles', lat: P.etangs.lat, lon: P.etangs.lon };

/** Le moment montré (genre), d'après le journal de l'écran du guidage. */
const shown = (h: Kit): string | null => {
  const s = h.last();
  return s.screen === 'guide' && s.show === 'moment' ? (s.moment ?? '').split(':')[0] : null;
};

/** Guidage du trajet du PRD lancé à `now` depuis l'écran du trajet (« y aller »). */
async function launched(o: Partial<KitOptions> & { now: number; journey?: Journey; ends?: boolean }): Promise<Kit> {
  const h = await guideSetup({ settings: settings(), pos: P.avroy, ...o });
  const j = o.journey ?? prdTrip();
  await h.c.show({ screen: 'steps', key: 'k-prd', label: '', title: 'Bureau', journeys: [j], index: 0, ...(o.ends === false ? {} : { from: { type: 'here' } as Endpoint, to: ETANGS }) });
  await h.settle();
  await intent(h, { kind: 'goGuide' });
  await h.settle();
  expect(h.c.followed?.guide?.kind).toBe('trip');
  return h;
}

beforeEach(() => views.reset());
afterEach(() => cleanupKit());

describe('vrai moteur : de l’heure de partir au premier virage', () => {
  it('position moyenne 10 min avant de partir, chemin demandé ; « Partir maintenant » à l’heure de partir du trajet (07:05), effacé d’un toucher ; ligne « Maintenant » du téléphone', async () => {
    const asks: [LatLon, LatLon][] = [];
    const h = await launched({
      now: at('06:55'),
      walkRoute: async (from, to) => {
        asks.push([from, to]);
        return firstWalkRoute();
      },
    });
    // 10 min avant de partir : positions moyennes ; le chemin de la première marche demandé (une fois) et gardé
    expect(h.watching()?.opts).toEqual({ accuracy: 'medium', intervalMs: 30_000, distanceM: 50 });
    expect(asks).toHaveLength(1);
    expect(asks[0][1]).toEqual({ lat: P.gramme.lat, lon: P.gramme.lon });
    expect(h.c.followed!.guide!.walk).toMatchObject({ leg: 0, journeyId: 'jprd', route: { source: 'osm' } });
    // 1.3.1 (« 7h12 partout ») : l'heure de partir est celle que porte le trajet. Le cœur de ce banc est un double : il
    // ne pose pas les minutes du vrai chemin sur le trajet (le vrai cœur le fait : v131-vrai-chemin.test.ts, partie B),
    // et le guidage ne corrige plus rien lui-même, même avec ce chemin de 803 m sous la main : 07:05, partout
    expect(h.c.guideStatus()).toMatchObject({ kind: 'trip', title: 'Bureau', now: 'partir à 07:05', guided: true, then: true });
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
    // pas avant 07:05
    await h.settle(9 * MIN);
    expect(h.screens().some((s) => s.show === 'moment')).toBe(false);
    // 07:05 : « Partir maintenant »
    await h.settle(MIN + 1_000);
    expect(shown(h)).toBe('leave');
    const id = h.last().moment;
    // 1.3.1 (A7) : masqué d'un toucher, affiché depuis au moins 1,5 s
    await h.settle(1_000);
    await h.gesture('tap');
    expect(h.last().show).not.toBe('moment');
    expect(h.c.followed!.guide!.mem.dismissed).toContain(id);
    // il ne revient pas
    await h.settle(30_000);
    expect(h.screens().filter((s) => s.moment === id && s.show === 'moment')).toHaveLength(1);
  });

  it('en marchant : positions précises, virage annoncé à 40 m avec sa flèche (reconstruction puis dessin)', async () => {
    const h = await launched({ now: at('07:05'), walkRoute: async () => firstWalkRoute() });
    const t0 = h.clock.now();
    await h.push(P.avroy);
    await h.settle(15_000);
    // la marche commence : 60 m vers le sud ; puis 170 m (30 m avant le virage à droite)
    await h.push(offset(P.avroy, 0, -60), { speed: 1.4 });
    expect(h.watching()?.opts.accuracy).toBe('high');
    await h.settle(60_000);
    const n = h.calls.length;
    await h.push(offset(P.avroy, 0, -170), { speed: 1.4 });
    await h.settle();
    expect(h.clock.now() - t0).toBeLessThan(2 * MIN);
    expect(shown(h)).toBe('turn');
    const built = h.since(n);
    expect(built.find((x) => x.op === 'rebuild')?.extra?.images?.[0].image).toEqual({ kind: 'turn', turn: 'right' });
    expect((built.find((x) => x.op === 'paint')?.arg as ImageSpec).image).toEqual({ kind: 'turn', turn: 'right' });
    // 1.3.1 (B10) : « Voir tout le trajet », « Voir les arrêts », « Arrêter le guidage »
    expect(built.find((x) => x.op === 'rebuild')?.extra?.menu?.map((m) => m.id)).toEqual([2, 3, 1]);
  });
});

describe('vrai moteur : horloge simulée du mode test (window.__quaiClock.set)', () => {
  it('l’horloge réglée plus loin : le guidage est recalculé tout de suite (« Partir maintenant » sans position utilisable, sans attendre la minuterie)', async () => {
    // l'événement de l'horloge passe par window (ici un EventTarget de Node)
    const g = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown; dispatchEvent?: unknown };
    const saved = { add: g.addEventListener, remove: g.removeEventListener, dispatch: g.dispatchEvent };
    const target = new EventTarget();
    g.addEventListener = target.addEventListener.bind(target);
    g.removeEventListener = target.removeEventListener.bind(target);
    g.dispatchEvent = target.dispatchEvent.bind(target);
    try {
      const h = await launched({ now: at('06:50'), pos: null });
      await h.settle(16_000);
      expect(shown(h)).toBeNull();
      // 06:50 → 07:05:05 d'un coup (comme le simulateur) : sans recalcul, rien avant la minuterie (jusqu'à 60 s)
      h.clock.restore({ now: at('07:05:05') });
      target.dispatchEvent(new CustomEvent(CLOCK_EVENT, { detail: { now: at('07:05:05') } }));
      await h.settle(50);
      expect(shown(h)).toBe('leave');
      // le flux de position n'est pas relancé par le saut (une seule demande, celle du lancement ou aucune)
      const watches = h.watches.length;
      target.dispatchEvent(new CustomEvent(CLOCK_EVENT, { detail: { now: at('07:05:10') } }));
      await h.settle(50);
      expect(h.watches.length).toBe(watches);
      h.c.stop();
      target.dispatchEvent(new CustomEvent(CLOCK_EVENT, { detail: { now: at('07:06') } }));
    } finally {
      g.addEventListener = saved.add;
      g.removeEventListener = saved.remove;
      g.dispatchEvent = saved.dispatch;
    }
  });
});

describe('vrai moteur : arrêts suivants du véhicule (genre trip, arrêt dépassé)', () => {
  const N2 = (fr: string, nl = fr) => ({ fr, nl });
  /** Arrêts de l'IC du trajet du PRD, de Liège-Guillemins à Gand-Saint-Pierre (Bruxelles-Central : la descente). */
  function icStops(): DepartureStops {
    const c = (areaId: string, name: string, hm: string) => ({ areaId, name: N2(name), sched: at(hm), est: at(hm), rt: true, delayMin: 0 });
    return {
      op: 'sncb', mode: 'train', line: 'IC', head: N2('Ostende', 'Oostende'), anyPlanned: false, state: 'ok', at: 0,
      stops: [c('sncb:8841004', 'Liège-Guillemins', '07:30'), c('sncb:8841202', 'Ans', '07:37'), c('sncb:8833001', 'Louvain', '08:05'), c('sncb:8812005', 'Bruxelles-Nord', '08:22'), c('sncb:8813003', 'Bruxelles-Central', '08:27'), c('sncb:8814001', 'Bruxelles-Midi', '08:31'), c('sncb:8892007', 'Gand-Saint-Pierre', '09:00')],
    };
  }

  it('lus une fois au début de l’étape à bord, gardés avec le guidage (pas relus à chaque position ni à la reprise) ; échec : comme avant', async () => {
    const asked: { areaId: string; dep: Departure }[] = [];
    const kv = createKV(memoryBackend());
    let fail = false;
    const coreExtra = (): Partial<Core> => ({
      async departureStops(areaId: string, dep: Departure) {
        asked.push({ areaId, dep });
        if (fail) throw new Error('réseau');
        return icStops();
      },
    });
    const h = await launched({ now: at('07:20'), pos: null, coreExtra, kv });
    await h.settle(5 * MIN);
    expect(asked).toEqual([]);
    // 07:31 : à bord de l'IC (étape 3, d'après l'heure) : une lecture, depuis Liège-Guillemins, ce voyage-là
    await h.settle(7 * MIN);
    expect(asked).toHaveLength(1);
    expect(asked[0].areaId).toBe('sncb:8841004');
    expect(asked[0].dep).toMatchObject({ op: 'sncb', mode: 'train', line: 'IC', sched: at('07:30') });
    const g = h.c.followed!.guide!;
    expect(g.beyondByLeg?.journeyId).toBe('jprd');
    expect(g.beyondByLeg?.legs['3'].map((x) => x.name.fr)).toEqual(['Bruxelles-Midi', 'Gand-Saint-Pierre']);
    // positions et minutes qui passent : pas de nouvelle lecture
    for (let i = 0; i < 5; i++) {
      await h.push(offset(P.ans, 2_000 * i, 0), { speed: 30 });
      await h.settle(30_000);
    }
    expect(asked).toHaveLength(1);
    // reprise (page rechargée) pendant l'étape : les arrêts suivants sont relus avec le trajet suivi, pas redemandés
    h.c.stop();
    cleanupKit();
    const b = await guideSetup({ now: at('07:50'), settings: settings(), kv, pos: null, coreExtra });
    await b.settle(2 * MIN);
    expect(asked).toHaveLength(1);
    expect(b.c.followed!.guide!.beyondByLeg?.legs['3'][0].name.fr).toBe('Bruxelles-Midi');
    // l'étape suivante (bus 71) : nouvelle lecture ; échec réseau : rien gardé pour elle, le guidage continue, une seule fois
    fail = true;
    await b.settle(45 * MIN);
    expect(asked.map((x) => x.areaId)).toEqual(['sncb:8841004', 'stib:1180']);
    // ceux de l'IC restent (étape d'avant, pas remplacés par l'étape suivante)
    expect(Object.keys(b.c.followed?.guide?.beyondByLeg?.legs ?? {})).toEqual(['3']);
  });

  it('l’étape suivante lue (le bus 71) ne remplace pas les arrêts de l’IC : chaque étape garde les siens', async () => {
    const bus71 = (): DepartureStops => {
      const c = (areaId: string, name: string, hm: string) => ({ areaId, name: N2(name), sched: at(hm), est: at(hm), rt: true, delayMin: 0 });
      return { op: 'stib', mode: 'bus', line: '71', head: N2('Delta'), anyPlanned: false, state: 'ok', at: 0, stops: [c('stib:1180', 'Gare Centrale', '08:34'), c('stib:1250', 'Porte de Namur', '08:39'), c('stib:3517', 'Flagey', '08:48'), c('stib:3520', 'Cimetière d’Ixelles', '08:52')] };
    };
    const coreExtra = (): Partial<Core> => ({ departureStops: async (areaId: string) => (areaId === 'stib:1180' ? bus71() : icStops()) });
    const h = await launched({ now: at('07:20'), pos: null, coreExtra });
    await h.settle(12 * MIN);
    expect(Object.keys(h.c.followed!.guide!.beyondByLeg?.legs ?? {})).toEqual(['3']);
    await h.settle(65 * MIN);
    const legs = h.c.followed!.guide!.beyondByLeg!.legs;
    expect(Object.keys(legs)).toEqual(['3', '5']);
    expect(legs['3'][0].name.fr).toBe('Bruxelles-Midi');
    expect(legs['5'][0].name.fr).toBe('Cimetière d’Ixelles');
  });

  it('arrêt dépassé (Bruxelles-Central), arrêts suivants lus : le nouveau trajet garde l’IC jusqu’à Bruxelles-Midi ; « Descends au prochain arrêt » la dernière minute ; jamais « Partir maintenant »', async () => {
    const midi = { lat: 50.8357, lon: 4.3359 }; // gare de Bruxelles-Midi
    const places: Record<string, LatLon> = { 'sncb:8813003': P.central, 'sncb:8814001': midi, 'sncb:8892007': { lat: 51.0357, lon: 3.7106 } };
    const asked: { from: Endpoint; after: number }[] = [];
    const coreExtra = (): Partial<Core> => ({
      departureStops: async () => icStops(),
      async search(q: string) {
        const ds = icStops().stops.find((x) => x.name.fr === q);
        const p = ds?.areaId ? places[ds.areaId] : undefined;
        return p && ds?.areaId ? [{ id: ds.areaId, op: 'sncb', n: ds.name, modes: ['train'], lat: p.lat, lon: p.lon, kindLabel: 'gare SNCB' } as SearchItem] : [];
      },
      async route(from: Endpoint, _to: Endpoint, after: number) {
        if (from.type !== 'area' || from.areaId !== 'sncb:8814001') return { journeys: [prdTrip()] };
        asked.push({ from, after });
        // depuis Bruxelles-Midi : à pied jusqu'aux étangs d'Ixelles
        const w = { kind: 'walk' as const, from: { name: N2('Bruxelles-Midi', 'Brussel-Zuid'), ...midi, areaId: 'sncb:8814001' }, to: { name: N2('Étangs d’Ixelles'), ...P.etangs }, dep: after, arr: after + 40 * MIN, schedDep: after, schedArr: after + 40 * MIN, walkMin: 40 };
        return { journeys: [{ id: 'jmidi', legs: [w], dep: after, arr: after + 40 * MIN, leaveAt: after, transfers: 0, rt: true, alerts: [] }] };
      },
    });
    const h = await launched({ now: at('07:24'), pos: P.guillemins, coreExtra });
    // à la gare, puis dans l'IC (montée constatée), arrêts suivants lus au début de l'étape
    await h.push(P.guillemins, { speed: 0 });
    await h.settle(7 * MIN);
    await h.push(toward(P.guillemins, P.ans, 300), { speed: 20 });
    await h.settle(MIN);
    expect(h.c.followed!.guide!.beyondByLeg?.legs['3'].map((x) => [x.name.fr, x.lat])).toEqual([['Bruxelles-Midi', midi.lat], ['Gand-Saint-Pierre', 51.0357]]);
    await h.settle(at('08:26:30') - h.clock.now());
    // l'IC passe Bruxelles-Central sans que la personne descende, et file vers Bruxelles-Midi
    await h.push(lerp(P.nord, P.central, 0.8), { speed: 12 });
    await h.settle(at('08:27:30') - h.clock.now());
    await h.push(P.central, { speed: 12 });
    await h.settle(30_000);
    await h.push(toward(P.central, midi, 400), { speed: 12 });
    await h.settle(30_000);
    await h.push(toward(P.central, midi, 700), { speed: 12 });
    await h.settle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ from: { type: 'area', areaId: 'sncb:8814001' }, after: at('08:31') });
    const j2 = h.c.followed!.journey;
    expect(j2.legs.map((l) => l.kind)).toEqual(['walk', 'ride', 'walk', 'ride', 'walk']);
    expect(j2.legs[3]).toMatchObject({ line: 'IC', schedDep: at('07:30'), to: { name: { fr: 'Bruxelles-Midi' }, areaId: 'sncb:8814001' }, arr: at('08:31') });
    expect(j2.legs[4].from.areaId).toBe('sncb:8814001');
    expect(shown(h)).toBe('passed');
    // la dernière minute avant Bruxelles-Midi : « Descends au prochain arrêt » de l'IC gardé
    await h.settle(at('08:30:05') - h.clock.now());
    await h.push(toward(P.central, midi, 1_500), { speed: 12 });
    expect(h.last().moment).toBe(`alight:${j2.id}:3`);
    expect(h.screens().some((x) => x.screen === 'guide' && /^leave:/.test(x.moment ?? ''))).toBe(false);
  });

  it('guidage arrêté pendant la lecture : la réponse est oubliée', async () => {
    let answer: (v: DepartureStops) => void = () => undefined;
    const coreExtra = (): Partial<Core> => ({ departureStops: () => new Promise<DepartureStops>((r) => (answer = r)) });
    const h = await launched({ now: at('07:29'), pos: null, coreExtra });
    await h.settle(2 * MIN);
    await h.c.stopGuide();
    answer(icStops());
    await h.settle(100);
    expect(h.c.followed).toBeNull();
  });
});

describe('vrai moteur : imprévus et fin', () => {
  function routing(list: (now: number) => Journey[]) {
    const asked: { from: Endpoint; after: number }[] = [];
    const coreExtra = (now: () => number): Partial<Core> => ({
      async route(from: Endpoint, _to: Endpoint, after: number) {
        asked.push({ from, after });
        const journeys = list(now());
        return journeys.length ? { journeys } : { journeys, empty: 'noTrip' as const };
      },
    });
    return { asked, coreExtra };
  }

  it('IC supprimé : nouveau trajet cherché tout de suite, adopté ; le moteur montre « replan », puis suit le nouveau trajet', async () => {
    const r = routing(() => [prdTrip({ id: 'jnew' })]);
    const h = await launched({ now: at('07:00'), journey: prdTrip({ icCancelled: true }), coreExtra: r.coreExtra });
    await h.settle();
    expect(r.asked).toHaveLength(1);
    expect(h.c.followed!.journey.id).toBe('jnew');
    expect(shown(h)).toBe('replan');
    expect(h.last().moment).toMatch(/^replan:jprd:cancelled:3:jnew$/);
    // une seule recherche ; 60 s plus tard le moment est fini, le guidage suit le nouveau trajet
    await h.settle(61_000);
    expect(r.asked).toHaveLength(1);
    expect(shown(h)).not.toBe('replan');
    expect(parseTrip(await h.kv.get(TRIP_KEY))?.journey.id).toBe('jnew');
  });

  it('IC supprimé, aucun autre trajet : « Pas d’autre trajet trouvé » (replanNone), le guidage continue, plus de recherche', async () => {
    const r = routing(() => []);
    const h = await launched({ now: at('07:00'), journey: prdTrip({ icCancelled: true }), coreExtra: r.coreExtra });
    await h.settle();
    expect(r.asked).toHaveLength(1);
    expect(h.c.followed!.journey.id).toBe('jprd');
    expect(h.last().moment).toMatch(/:none$/);
    await h.settle(90_000);
    expect(r.asked).toHaveLength(1);
    expect(h.c.followed?.guide).toBeDefined();
  });

  it('fin donnée par le moteur (arrivée + 5 min, sans position) : le guidage s’arrête, retour à l’accueil', async () => {
    const h = await launched({ now: at('08:50'), pos: null, ends: false });
    expect(h.last().screen).toBe('guide');
    await h.settle(10 * MIN);
    expect(h.c.followed).toBeNull();
    expect(h.last().screen).toBe('home');
    expect(await h.kv.get(TRIP_KEY)).toBeFalsy();
  });
});

describe('vrai moteur : réglage éteint et « j’y descends »', () => {
  it('réglage éteint : aucun moment, aucun chemin demandé, positions au plus medium ; la carte du téléphone suit quand même', async () => {
    const asks: number[] = [];
    const h = await guideSetup({ now: at('07:00'), settings: settings(false), pos: P.avroy, walkRoute: async () => (asks.push(1), firstWalkRoute() as WalkRoute) });
    await h.c.show({ screen: 'steps', key: 'k-prd', label: '', title: 'Bureau', journeys: [prdTrip()], index: 0, from: { type: 'here' }, to: ETANGS });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle(10 * MIN);
    expect(h.c.followed?.guide?.kind).toBe('trip');
    expect(asks).toEqual([]);
    expect(views.calls).toEqual([]);
    expect(h.watches.every((w) => w.opts.accuracy === 'medium')).toBe(true);
    expect(h.c.guideStatus()).toMatchObject({ guided: false, title: 'Bureau' });
  });

  it('« j’y descends » : trajet du véhicule seul (rideJourney), arrêts après la descente gardés, guidé jusqu’à la descente', async () => {
    const h = await guideSetup({ now: at('07:00'), settings: settings(), pos: P.gramme, stub: { departureStops: (_a, _d, now) => busStops(now) } });
    await h.c.show({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: dep(at('07:00'), 4, { op: 'tec', mode: 'bus', line: '6', head: { fr: 'Gare des Guillemins', nl: 'Gare des Guillemins' }, tripId: 't6' }) });
    await h.until((s) => typeof (s as { stops?: unknown }).stops === 'number');
    await intent(h, { kind: 'alight', index: 2 });
    await h.settle();
    const t = h.c.followed!;
    expect(t.guide!.kind).toBe('ride');
    expect(t.title).toBe('Vers Gare des Guillemins');
    expect(t.journey.legs).toHaveLength(1);
    expect(t.journey.legs[0]).toMatchObject({ kind: 'ride', line: '6', tripId: 't6', from: { name: { fr: 'Monument Gramme' } }, to: { name: { fr: 'Gare des Guillemins' } } });
    expect(t.guide!.beyond?.map((x) => x.name.fr)).toEqual(['Fragnée']);
    // à l'arrêt, départ dans 4 min : « Monter » passe avant « Où tu en es »
    expect(h.last().screen).toBe('guide');
    expect(['where', 'moment']).toContain(h.last().show);
    expect(h.c.guideStatus()).toMatchObject({ kind: 'ride', guided: true });
    // à l'heure de la descente puis 5 min après : « Tu y es » (genre ride : descente faite), puis la fin
    await h.settle(15 * MIN);
    expect(h.c.followed).toBeNull();
    expect(h.screens().some((s) => s.screen === 'guide' && s.show === 'moment' && /^(alight|arrived)/.test(s.moment ?? ''))).toBe(true);
  });
});
