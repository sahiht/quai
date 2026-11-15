/**
 * Quai 1.2.10, contrôleur avec le vrai moteur du guidage (core/guide.ts, équipe A) : seuls les écrans du guidage sont
 * des doubles (équipe C1). Trajet du PRD sur des lieux publics (fixtures de l'équipe A) : Parc d'Avroy à pied jusqu'à
 * Monument Gramme, bus 6, IC, bus 71 jusqu'à Flagey, à pied. Vérifie la boucle de bout en bout : positions continues
 * selon le moteur, chemin à pied demandé puis suivi (virage annoncé, image dessinée), « Partir maintenant » effacé d'un
 * toucher, nouveau trajet (IC supprimé), réglage éteint, « j'y descends », fin donnée par le moteur.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Core, Endpoint, Journey, LatLon } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { TRIP_KEY, parseTrip } from '../../src/glasses/controller';
import { CLOCK_EVENT } from '../../src/platform/clock';
import type { ImageSpec, Intent } from '../../src/glasses/types';
import { P, at, firstWalkRoute, offset, prdTrip } from '../core/guide-fixtures';
import { views } from './controller-guide-doubles';
import { busStops, cleanupKit, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, dep, settingsWith } from './helpers';

const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const settings = (guide = true) => settingsWith([], { seenVersion: '1.2.10', display: { ...settingsWith([]).display, guide } });
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
  it('position moyenne 10 min avant de partir, chemin demandé ; « Partir maintenant » à 07:05, effacé d’un toucher ; ligne « Maintenant » du téléphone', async () => {
    const asks: [LatLon, LatLon][] = [];
    const h = await launched({
      now: at('07:00'),
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
    expect(h.c.guideStatus()).toMatchObject({ kind: 'trip', title: 'Bureau', now: 'partir à 07:05', guided: true });
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
    // 07:05 : « Partir maintenant »
    await h.settle(5 * MIN + 1_000);
    expect(shown(h)).toBe('leave');
    const id = h.last().moment;
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
    expect(built.find((x) => x.op === 'rebuild')?.extra?.menu?.map((m) => m.id)).toEqual([1, 2]);
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
