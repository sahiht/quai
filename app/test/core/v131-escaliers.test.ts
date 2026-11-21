// @vitest-environment happy-dom
/**
 * Quai 1.3.1 (PRD-1.3.1 § 14, R4) : réglage « Éviter les escaliers ».
 *
 * - Routeur (core/walk/router.ts, graph.ts withoutSteps) sur de petits graphes codés au vrai format des tuiles : escalier
 *   et détour, pas de chemin sans marches (le chemin habituel), escalier mécanique (highway=steps + conveying : F_STEPS,
 *   pipeline/test/walk-graph.test.ts), ascenseur dessiné et relié (un nœud où se rejoignent le couloir et le trottoir),
 *   accroche jamais sur une marche ; réglage éteint : rien ne change, et le chemin sans marches ne touche pas au graphe
 *   partagé.
 * - Vraies tuiles (centre d'Helsinki, © les contributeurs d'OpenStreetMap, ODbL) : aucun chemin sans marches ne prend un
 *   escalier ; chiffres et temps de calcul.
 * - Durées de marche du guidage (core/guide.ts) : minutes restantes et marge suivent le chemin choisi.
 * - Réglages (settings.ts) : champ facultatif, éteint par défaut, anciens réglages lus sans perte ; contrôleur : le
 *   chemin est demandé avec le réglage ; téléphone : l'interrupteur dans Réglages, « Tes trajets ».
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Endpoint, type LatLon, type Settings } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { F_FWD, F_STEPS, F_UNDER, WALK_UNIT, decodeTile, type WalkTileFile } from '../../src/core/walk/format';
import { mergeTiles, prepareTile, withoutSteps, type RoutingGraph } from '../../src/core/walk/graph';
import { routeOn, shortestPath, snapPoint, type Snap } from '../../src/core/walk/route';
import { WalkRouter } from '../../src/core/walk/router';
import { settingsScreen } from '../../src/phone/screens/settings';
import { validateSettings } from '../../src/settings';
import { walkMinutes } from '../../src/core/util';
import type { Intent } from '../../src/glasses/types';
import { at as atTime, firstWalkRoute, guide, journeyOf, P, prdTrip, rideLeg, stop, step, walkLeg, fix as guideFix } from './guide-fixtures';
import { cleanupKit, guideSetup } from '../glasses/controller-guide-kit';
import { settingsWith } from '../glasses/helpers';
import { makeEnv } from './support/env';
import { at, checkRoute, diskSource, indexOf, memorySource, metres, prng, tileOf, type GraphDef } from './walk-helpers';
import { defaults, harness, mount, textOf, until } from '../phone/helpers';

const NOW = 1000;
type XY = [number, number];

/** Chemin habituel, chemin avec le réglage éteint (false et {}) et chemin sans marches, sur le même routeur. */
async function routes(def: GraphDef, from: XY, to: XY) {
  const r = new WalkRouter(memorySource([tileOf(def)]), { now: () => NOW });
  const usual = (await r.route(at(...from), at(...to))) as WalkRoute;
  const off = (await r.route(at(...from), at(...to), { avoidSteps: false })) as WalkRoute;
  const empty = (await r.route(at(...from), at(...to), {})) as WalkRoute;
  const free = (await r.route(at(...from), at(...to), { avoidSteps: true })) as WalkRoute;
  // après le chemin sans marches, le chemin habituel du même routeur (graphe gardé) n'a pas bougé
  const again = (await r.route(at(...from), at(...to))) as WalkRoute;
  return { usual, off, empty, free, again };
}
/** Le chemin passe-t-il par ce point (à 1,5 m près) ? */
const passes = (r: WalkRoute, p: XY, tol = 1.5) => r.coords.some((c) => metres(c, at(...p)) < tol);
const between = (x: number, lo: number, hi: number) => {
  expect(x).toBeGreaterThan(lo);
  expect(x).toBeLessThan(hi);
};

/** Rue basse, escalier de 60 m, rampe en détour par x = rampX, rue haute. */
const hill = (rampX: number): GraphDef => ({
  nodes: { S: [0, -100], A: [0, 0], B: [0, 60], N: [0, 160], R1: [rampX, 10], R2: [rampX, 50] },
  ways: [
    { nodes: ['S', 'A'], name: 'Rue Basse' },
    { nodes: ['A', 'B'], flags: F_STEPS },
    { nodes: ['A', 'R1', 'R2', 'B'], name: 'Rampe' },
    { nodes: ['B', 'N'], name: 'Rue Haute' },
  ],
});

describe('R4 : escalier et détour', () => {
  it('éteint, l’escalier (marches comptées 1,5 fois) ; allumé, la rampe : un vrai chemin plus long, avec son virage', async () => {
    const { usual, free } = await routes(hill(60), [0, -50], [0, 110]);
    // habituel : 50 m de rue, 60 m d'escalier, 50 m de rue
    between(usual.lengthM, 157, 163);
    expect(passes(usual, [60, 10])).toBe(false);
    // sans marches : la rampe (2 × 60,8 m + 40 m) entre les deux rues
    expect(free.source).toBe('osm');
    between(free.lengthM, 258, 266);
    expect(passes(free, [60, 10]) && passes(free, [60, 50])).toBe(true);
    checkRoute(free, at(0, -50), at(0, 110));
    // le guidage suit ce chemin : virage vers la rampe, puis vers la rue haute
    expect(free.maneuvers.map((m) => m.street)).toContain('Rampe');
    expect(usual.maneuvers.map((m) => m.street)).not.toContain('Rampe');
  });

  it('une rampe déjà préférée réglage éteint : le même chemin, allumé ou non', async () => {
    const { usual, free } = await routes(hill(20), [0, -50], [0, 110]);
    expect(passes(usual, [20, 10])).toBe(true);
    expect(free).toEqual(usual);
  });

  it('pas de chemin sans marches : le chemin habituel, exactement (escalier compris)', async () => {
    const only: GraphDef = {
      nodes: { S: [0, -100], A: [0, 0], B: [0, 60], N: [0, 160] },
      ways: [
        { nodes: ['S', 'A'], name: 'Rue Basse' },
        { nodes: ['A', 'B'], flags: F_STEPS },
        { nodes: ['B', 'N'], name: 'Rue Haute' },
      ],
    };
    const { usual, free } = await routes(only, [0, -50], [0, 110]);
    between(usual.lengthM, 157, 163);
    expect(free).toEqual(usual);
  });

  it('escalier mécanique (highway=steps et conveying : F_STEPS) : une marche comme une autre, le détour par l’allée', async () => {
    const E: GraphDef = {
      nodes: { S: [0, -100], A: [0, 0], B: [0, 40], N: [0, 140], C: [50, 20] },
      ways: [
        { nodes: ['S', 'A'], name: 'Rue' },
        { nodes: ['A', 'B'], flags: F_STEPS | F_FWD },
        { nodes: ['A', 'C', 'B'], name: 'Allée' },
        { nodes: ['B', 'N'], name: 'Rue' },
      ],
    };
    const { usual, free } = await routes(E, [0, -90], [0, 130]);
    between(usual.lengthM, 217, 223);
    expect(passes(usual, [50, 20])).toBe(false);
    between(free.lengthM, 284, 292);
    expect(passes(free, [50, 20])).toBe(true);
  });

  // quai d'une station souterraine (couloir du niveau -1) relié au trottoir par un escalier, et par un ascenseur : dans
  // OpenStreetMap, l'ascenseur est un nœud (highway=elevator) où se rejoignent le couloir et le trottoir ; le pipeline en
  // fait un nœud du graphe comme un autre. Dessiné mais pas relié (le trottoir finit à 3 m) : aucun passage.
  const station = (linked: boolean): GraphDef => ({
    nodes: { Q1: [0, 0], Q2: [0, 80], H: [40, 80], L: [0, -40], L2: [3, -40], T1: [40, -60], T2: [40, 220] },
    ways: [
      { nodes: ['Q1', 'Q2'], name: 'Quai', flags: F_UNDER },
      { nodes: ['Q2', 'H'], flags: F_STEPS },
      { nodes: ['T1', 'H', 'T2'], name: 'Boulevard' },
      { nodes: ['Q1', 'L'], flags: F_UNDER },
      { nodes: [linked ? 'L' : 'L2', 'T1'] },
    ],
  });

  it('ascenseur dessiné et relié : un passage ; le chemin sans marches le prend', async () => {
    const { usual, free } = await routes(station(true), [0, 40], [40, 150]);
    expect(passes(usual, [40, 80])).toBe(true);
    expect(passes(usual, [0, -40])).toBe(false);
    expect(passes(free, [0, -40])).toBe(true);
    expect(free.lengthM).toBeGreaterThan(usual.lengthM + 100);
    checkRoute(free, at(0, 40), at(40, 150));
  });

  it('ascenseur pas relié aux voies : pas de chemin sans marches, le chemin habituel', async () => {
    const { usual, free } = await routes(station(false), [0, 40], [40, 150]);
    expect(passes(usual, [40, 80])).toBe(true);
    expect(free).toEqual(usual);
  });

  it('accroche : jamais sur une marche (point plus près de l’escalier que de la rampe)', async () => {
    const { usual, free } = await routes(hill(60), [8, 15], [0, 110]);
    // habituel : accroché à l'escalier (8 m), puis il le monte
    expect(metres(usual.coords[1], at(0, 15))).toBeLessThan(1.5);
    // sans marches : accroché à la rampe (13,5 m), jamais à l'escalier (x = 0, de y = 0 à y = 60)
    const snapped = free.coords[1];
    expect(metres(snapped, at(0, 15))).toBeGreaterThan(5);
    expect(passes(free, [60, 10])).toBe(true);
    checkRoute(free, at(8, 15), at(0, 110));
  });
});

describe('R4 : réglage éteint, rien ne change', () => {
  const cases: [GraphDef, XY, XY][] = [
    [hill(60), [0, -50], [0, 110]],
    [hill(20), [0, -50], [0, 110]],
    [hill(60), [8, 15], [0, 110]],
  ];
  it('sans option, avec false ou {} : le même chemin ; après un chemin sans marches, le chemin habituel du même routeur est intact', async () => {
    for (const [def, a, b] of cases) {
      const { usual, off, empty, again } = await routes(def, a, b);
      expect(off).toEqual(usual);
      expect(empty).toEqual(usual);
      expect(again).toEqual(usual);
      // et celui d'un routeur neuf
      const fresh = await new WalkRouter(memorySource([tileOf(def)]), { now: () => NOW }).route(at(...a), at(...b));
      expect(fresh).toEqual(usual);
    }
  });

  it('le graphe sans marches est gardé et partage tout sauf le coût ; le graphe habituel garde ses coûts', () => {
    const g = mergeTiles([prepareTile(tileOf(hill(60)))]);
    const before = Float64Array.from(g.eCost);
    const v = withoutSteps(g);
    expect(withoutSteps(g)).toBe(v);
    expect([v.adj, v.adjStart, v.eFlags, v.eLen, v.tiles].every((x, i) => x === [g.adj, g.adjStart, g.eFlags, g.eLen, g.tiles][i])).toBe(true);
    expect(g.eCost).toEqual(before);
    expect(g.skip).toBeUndefined();
    expect(v.skip).toBe(F_STEPS);
    for (let e = 0; e < g.m; e++) expect(v.eCost[e]).toBe(g.eFlags[e] & F_STEPS ? Infinity : g.eCost[e]);
    // tableaux de travail de A* communs : un calcul sur l'un les prête à l'autre
    routeOn(v, at(0, -50), at(0, 110), NOW);
    expect(g.scratch).toBeDefined();
    expect(v.scratch).toBe(g.scratch);
  });
});

/* ------------------------------ Du cœur au routeur, mêmes tuiles ------------------------------ */

describe('R4 : le cœur passe le réglage au routeur (Core.walkRoute), sans une tuile de plus', () => {
  // contrôle du 20/11 : sans ce passage (core/index.ts), l'interrupteur ne changerait rien dans l'appli
  it('Core.walkRoute : allumé, la rampe ; éteint ou absent, l’escalier ; les mêmes demandes au serveur', async () => {
    const calls = async (opts?: { avoidSteps?: boolean }) => {
      const e = makeEnv({ now: '2026-11-10T12:10' });
      e.server.overrides.set('/quai/data/walk/index.json', () => new Response(JSON.stringify(indexOf({ version: '2026-11-09' })), { status: 200 }));
      e.server.overrides.set('/quai/data/walk/2541_145.json', () => new Response(JSON.stringify(tileOf(hill(60), { ver: '2026-11-09' })), { status: 200 }));
      const r = (await (opts ? e.core.walkRoute!(at(0, -50), at(0, 110), opts) : e.core.walkRoute!(at(0, -50), at(0, 110)))) as WalkRoute;
      return { r, walk: e.server.calls.filter((u) => u.includes('/walk/')) };
    };
    const usual = await calls();
    const off = await calls({ avoidSteps: false });
    const on = await calls({ avoidSteps: true });
    expect(usual.r.source).toBe('osm');
    expect(passes(usual.r, [60, 10])).toBe(false);
    expect(off.r).toEqual(usual.r);
    expect(passes(on.r, [60, 10]) && passes(on.r, [60, 50])).toBe(true);
    between(on.r.lengthM, 258, 266);
    expect(on.walk.length).toBeGreaterThan(1);
    expect(on.walk).toEqual(usual.walk);
    expect(off.walk).toEqual(usual.walk);
  });

  it('routeur, marche à cheval sur deux tuiles : les mêmes tuiles demandées, dans le même ordre, avec ou sans le réglage', async () => {
    const dir = join(__dirname, 'walk-data', 'kotka');
    const nodes = (key: string) => {
      const t = decodeTile(JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as WalkTileFile);
      const out: LatLon[] = [];
      for (let e = 0; e < t.edgeFrom.length; e++) if (t.edgeComp[e] === 0) out.push({ lat: t.nodeLat[t.edgeTo[e]] * WALK_UNIT, lon: t.nodeLon[t.edgeTo[e]] * WALK_UNIT });
      return out;
    };
    const KOTKA_A = nodes('3026_897')[0];
    const KOTKA_B = nodes('3026_898').find((b) => metres(KOTKA_A, b) > 200 && metres(KOTKA_A, b) < 1500)!;
    const keys = async (opts: { avoidSteps?: boolean }) => {
      const disk = diskSource(dir);
      const asked: string[] = [];
      const r = await new WalkRouter({ index: () => disk.index(), tile: (k, v) => (asked.push(`${v}|${k}`), disk.tile(k, v)) }, { now: () => NOW }).route(KOTKA_A, KOTKA_B, opts);
      return { r, asked };
    };
    const usual = await keys({});
    const on = await keys({ avoidSteps: true });
    expect(usual.r?.source).toBe('osm');
    expect(new Set(usual.asked.map((k) => k.split('|')[1])).size).toBeGreaterThan(1);
    expect(on.asked).toEqual(usual.asked);
  });
});

/* ------------------------------ Vraies tuiles (Helsinki) ------------------------------ */

/** Tronçons parcourus par le chemin que choisirait routeOn (mêmes accroches, même ordre des essais). */
function pathEdges(g: RoutingGraph, from: LatLon, to: LatLon): number[] | null {
  const a = snapPoint(g, from.lat / WALK_UNIT, from.lon / WALK_UNIT);
  const b = snapPoint(g, to.lat / WALK_UNIT, to.lon / WALK_UNIT);
  if (!a.any || !b.any) return null;
  const tries: [Snap, Snap][] = [];
  if (g.eComp[a.any.e] === g.eComp[b.any.e]) tries.push([a.any, b.any]);
  if (a.giant && b.giant && (a.giant !== a.any || b.giant !== b.any)) tries.push([a.giant, b.giant]);
  for (const [s, t] of tries) {
    const p = shortestPath(g, s, t);
    if (p) return [s.e, ...p.edges.map((x) => x >> 1), t.e];
  }
  return null;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

describe('R4 : vraies tuiles (centre d’Helsinki)', () => {
  const dir = join(__dirname, 'walk-data', 'helsinki');
  const file = JSON.parse(readFileSync(join(dir, '3008_831.json'), 'utf8')) as WalkTileFile;

  it('300 marches de 200 m à 1,5 km : aucun chemin sans marches ne prend un escalier ; réglage éteint identique ; chiffres', async () => {
    const t = decodeTile(file);
    const pts: LatLon[] = [];
    for (let e = 0; e < t.edgeFrom.length; e++) if (t.edgeComp[e] === 0) pts.push({ lat: t.nodeLat[t.edgeFrom[e]] * WALK_UNIT, lon: t.nodeLon[t.edgeFrom[e]] * WALK_UNIT });
    const g = mergeTiles([prepareTile(file)]);
    const v = withoutSteps(g);
    const steps = (edges: number[] | null) => !!edges && edges.some((e) => g.eFlags[e] & F_STEPS);
    const router = new WalkRouter(diskSource(dir), { now: () => NOW });
    const rnd = prng(1310);
    let n = 0;
    let withSteps = 0;
    let freed = 0;
    let plain = 0;
    let same = 0;
    const detours: number[] = [];
    const late: number[] = [];
    const lateUsual: number[] = [];
    const warm: number[] = [];
    while (n < 300) {
      const a = pts[Math.floor(rnd() * pts.length)];
      const b = pts[Math.floor(rnd() * pts.length)];
      const d = metres(a, b);
      if (d < 200 || d > 1500) continue;
      n++;
      const usual = (await router.route(a, b)) as WalkRoute;
      const off = await router.route(a, b, { avoidSteps: false });
      expect(off).toEqual(usual);
      const free = (await router.route(a, b, { avoidSteps: true })) as WalkRoute;
      const t0 = performance.now();
      await router.route(a, b, { avoidSteps: true });
      warm.push(performance.now() - t0);
      // le graphe des tuiles est celui du routeur (une seule tuile) : chemin habituel, chemin sans marches
      const usualEdges = pathEdges(g, a, b);
      const freeEdges = pathEdges(v, a, b);
      expect(steps(freeEdges)).toBe(false);
      if (!steps(usualEdges)) {
        // sans marche réglage éteint : un chemin de même longueur (le même, à une égalité près)
        expect(Math.abs(free.lengthM - usual.lengthM)).toBeLessThan(1);
        if (JSON.stringify(free) === JSON.stringify(usual)) same++;
        plain++;
        continue;
      }
      withSteps++;
      if (!freeEdges) {
        expect(free).toEqual(usual);
        continue;
      }
      freed++;
      expect(free.source).toBe('osm');
      checkRoute(free, a, b);
      // détour (négatif quand l'accroche sans marches tombe mieux que celle de l'escalier)
      detours.push(free.lengthM - usual.lengthM);
      // minutes de la marche prévue par le trajet (vol d'oiseau × 1,3, util.ts walkMinutes) : « Partir maintenant » s'y fie
      const planned = walkMinutes(d);
      late.push(Math.ceil(free.lengthM / 80) - planned);
      lateUsual.push(Math.ceil(usual.lengthM / 80) - planned);
    }
    expect(withSteps).toBeGreaterThan(0);
    expect(freed).toBeGreaterThan(0);
    expect(same).toBeGreaterThanOrEqual(plain * 0.95);
    expect(p95(warm)).toBeLessThan(250);
    console.log(
      `Helsinki, « Éviter les escaliers » : ${withSteps}/${n} marches prennent un escalier ; ${freed} ont un chemin sans marches ` +
        `(détour médian ${Math.round(median(detours))} m, p95 ${Math.round(p95(detours))} m, de ${Math.round(Math.min(...detours))} à ${Math.round(Math.max(...detours))} m) ; sans escalier : ${same}/${plain} chemins identiques ; ` +
        `calcul p95 ${p95(warm).toFixed(1)} ms ; plus long que la marche prévue du trajet : ${late.filter((x) => x > 0).length}/${freed} sans marches ` +
        `(jusqu'à ${Math.max(0, ...late)} min), ${lateUsual.filter((x) => x > 0).length}/${freed} avec l'escalier (jusqu'à ${Math.max(0, ...lateUsual)} min)`,
    );
  });
});

/* ------------------------------ Durées de marche du guidage ------------------------------ */

describe('R4 : les durées de marche du guidage suivent le chemin choisi', () => {
  it('minutes restantes, mètres et marge avant le bus : ceux du chemin sans marches quand il est choisi', async () => {
    // marche de la place jusqu'à l'arrêt en haut de l'escalier (rampe en grand détour), puis le bus
    const def = hill(150);
    const from = at(0, -50);
    const to = at(0, 115);
    const r = new WalkRouter(memorySource([tileOf(def)]), { now: () => NOW });
    const usual = (await r.route(from, to)) as WalkRoute;
    const free = (await r.route(from, to, { avoidSteps: true })) as WalkRoute;
    expect(free.lengthM).toBeGreaterThan(usual.lengthM + 250);
    const t = (hm: string) => Date.parse(`2026-11-16T${hm}:00+01:00`);
    const place = stop('Place Flagey', from);
    const haut = stop('Flagey', to, 'stib:3517');
    const fin = stop('Étangs d’Ixelles', at(300, 600), 'stib:3518');
    const j = journeyOf([walkLeg(place, haut, t('07:05'), 4), rideLeg({ op: 'stib', mode: 'bus', line: '71', head: 'Delta', stops: [{ p: haut, t: t('07:20') }, { p: fin, t: t('07:24') }] })], 'jr4', t('07:05'));
    const where = (route: WalkRoute) => {
      const run = guide(j, { origin: from, startedAt: t('07:00') });
      return step(run, t('07:05') + 30_000, guideFix(from, t('07:05') + 29_000), { walk: { leg: 0, route } }).where.walk!;
    };
    const a = where(usual);
    const b = where(free);
    // les minutes restantes sont celles du chemin (80 m par minute) ; la marge avant le bus suit
    expect(a.remainingMin).toBe(Math.ceil(usual.lengthM / 80));
    expect(b.remainingMin).toBe(Math.ceil(free.lengthM / 80));
    expect(b.remainingMin).toBeGreaterThan(a.remainingMin);
    expect(b.remainingM! - a.remainingM!).toBeGreaterThan(250);
    expect(a.marginMin! - b.marginMin!).toBe(b.remainingMin - a.remainingMin);
  });
});

/* ------------------------------ Contrôleur ------------------------------ */

describe('R4 : le guidage demande son chemin à pied avec le réglage (contrôleur)', () => {
  afterEach(() => cleanupKit());
  const ETANGS: Endpoint = { type: 'address', label: 'Étangs d’Ixelles', lat: P.etangs.lat, lon: P.etangs.lon };
  /** Options reçues par Core.walkRoute quand le guidage du trajet d'essai est lancé 5 min avant de partir. */
  async function asked(avoidSteps?: boolean): Promise<unknown[]> {
    const seen: unknown[] = [];
    const base = settingsWith([], { seenVersion: '1.3.1' });
    const settings: Settings = avoidSteps === undefined ? base : { ...base, avoidSteps };
    const h = await guideSetup({
      settings,
      pos: P.avroy,
      now: atTime('07:00'),
      walkRoute: async (_from, _to, opts?: { avoidSteps?: boolean }) => {
        seen.push(opts);
        return firstWalkRoute();
      },
    });
    await h.c.show({ screen: 'steps', key: 'k-prd', label: '', title: 'Bureau', journeys: [prdTrip()], index: 0, from: { type: 'here' }, to: ETANGS });
    await h.settle();
    await (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent({ kind: 'goGuide' });
    await h.settle();
    expect(h.c.followed?.guide?.kind).toBe('trip');
    return seen;
  }

  it('allumé : { avoidSteps: true } ; éteint ou absent : { avoidSteps: false } (le cœur calcule alors le chemin de toujours)', async () => {
    expect(await asked(true)).toEqual([{ avoidSteps: true }]);
    expect(await asked(false)).toEqual([{ avoidSteps: false }]);
    expect(await asked()).toEqual([{ avoidSteps: false }]);
  });
});

/* ------------------------------ Réglages ------------------------------ */

describe('R4 : réglage enregistré (settings.ts)', () => {
  it('éteint par défaut : aucun champ, réglages par défaut inchangés', () => {
    const s = validateSettings({});
    expect('avoidSteps' in s).toBe(false);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('seul true est gardé ; toute autre valeur est retirée (éteint)', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, avoidSteps: true }).avoidSteps).toBe(true);
    for (const bad of [false, 'true', 1, 'oui', null, {}]) expect('avoidSteps' in validateSettings({ ...DEFAULT_SETTINGS, avoidSteps: bad })).toBe(false);
  });

  it('anciens réglages (1.3.0, et une version antérieure migrée) lus sans perte ; le réglage survit à l’enregistrement', () => {
    const old: Settings = validateSettings({
      ...DEFAULT_SETTINGS,
      onboarded: true,
      maxWalkMin: 14,
      seenVersion: '1.3.1',
      favorites: [{ kind: 'place', id: 'fav-gare', label: 'Gare', lat: 50.8455, lon: 4.3571, src: 'stop', propose: 'morning' }],
      display: { ...DEFAULT_SETTINGS.display, guide: false, alert: 'headUp', headUp: { axis: 'y', sign: 1, delta: 0.4, rest: 0.1 } },
      alerts: { ...DEFAULT_SETTINGS.alerts, leaveBeforeMin: 5 },
    });
    const again = validateSettings(JSON.parse(JSON.stringify(old)));
    expect(again).toEqual(old);
    expect('avoidSteps' in again).toBe(false);
    const on = validateSettings(JSON.parse(JSON.stringify({ ...old, avoidSteps: true })));
    expect(on).toEqual({ ...old, avoidSteps: true });
    // réglages v3 (1.2.1) : migrés, sans le réglage
    expect('avoidSteps' in validateSettings({ v: 3, maxWalkMin: 12 })).toBe(false);
  });
});

/* ------------------------------ Téléphone : Réglages, « Tes trajets » ------------------------------ */

describe('R4 : interrupteur « Éviter les escaliers » (Réglages, « Tes trajets »)', () => {
  afterEach(() => document.body.replaceChildren());
  const HELP = 'Un chemin sans marches quand il existe (poussette, valise).';
  const tripsGroup = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('section.group')].find((g) => textOf(g.querySelector('h2')) === 'Tes trajets')!;

  it('avec la marche maximale et la marge, avant « Position et langue » ; éteint par défaut ; nommé par son libellé, décrit par la ligne pâle', () => {
    const el = mount(settingsScreen(harness({ settings: defaults() }).ctx));
    const box = tripsGroup(el).querySelector('.box')!;
    const parts = [...box.children].map((c) => (c.classList.contains('stepper-row') ? textOf(c.querySelector('.c1')) : c.querySelector('.switch-row') ? textOf(c.querySelector('.c1')) : textOf(c.querySelector('.t1'))));
    expect(parts).toEqual(['Marche maximale', 'Marge avant de partir', 'Éviter les escaliers', 'Position et langue']);
    const row = box.querySelector<HTMLElement>('.switch-row')!;
    expect(textOf(row.querySelector('.c1'))).toBe('Éviter les escaliers');
    expect(textOf(row.querySelector('.c2'))).toBe(HELP);
    // apostrophes et tirets : rien à corriger dans ces textes (aucun tiret long ni moyen)
    expect(row.textContent).not.toMatch(/[—–']/);
    const input = row.querySelector<HTMLInputElement>('input')!;
    expect([input.type, input.getAttribute('role'), input.checked]).toEqual(['checkbox', 'switch', false]);
    expect(textOf(document.getElementById(input.getAttribute('aria-labelledby')!))).toBe('Éviter les escaliers');
    expect(textOf(document.getElementById(input.getAttribute('aria-describedby')!))).toBe(HELP);
    expect(input.closest('label')).toBe(row);
  });

  it('allumé d’un toucher : enregistré tout de suite ; éteint : le champ disparaît ; un écran rouvert le montre allumé', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(settingsScreen(hz.ctx));
    const input = tripsGroup(el).querySelector<HTMLInputElement>('.switch-row input')!;
    input.click();
    await until(() => hz.settings.get().avoidSteps === true);
    await hz.settings.flush();
    expect(JSON.parse(hz.kv.data.get('quai.settings')!).avoidSteps).toBe(true);
    const again = tripsGroup(mount(settingsScreen(hz.ctx))).querySelector<HTMLInputElement>('.switch-row input')!;
    expect(again.checked).toBe(true);
    again.click();
    await until(() => !('avoidSteps' in hz.settings.get()));
    // les autres réglages n'ont pas bougé
    expect(hz.settings.get()).toEqual(defaults());
  });
});
