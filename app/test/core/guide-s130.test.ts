/**
 * 1.3.0 : moteur du guidage et chemin à pied (docs/v1.3.0/PRD-1.3.0.md § 4 et § 6.3).
 *
 * - Routeur : raison d'un chemin droit (outside quand la tuile d'un bout est absente de la publication, nosnap, nopath,
 *   far) ; un vrai chemin n'en a pas.
 * - Marche hors de Belgique : moment offMap une fois au début de la marche, aucun virage, fin 30 s ou toucher ; « Où tu
 *   en es » à vol d'oiseau (walk.offMap, walk.crowM).
 * - Vérification : batterie des lunettes sous 20 % et pas de position au départ, position perdue depuis 3 min en route
 *   (moment check, deux lignes au plus, fin 20 s ou toucher, jamais devant une action) ; GuideState.issues.
 *
 * Lieux publics seulement : gares de Lille-Flandres et de Tournai, Grand-Place de Lille, trajet du PRD 1.2.10 (Liège,
 * Bruxelles), tuiles d'essai autour de Flagey.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CheckIssue, GuideState, Moment, WalkRoute } from '../../src/core/guide-types';
import type { Departure, DepartureStops } from '../../src/core/api';
import { dismissMoment, GUIDE, guideStep, rideJourney, type GuideInput } from '../../src/core/guide';
import { MAX_WALK_M, WalkRouter } from '../../src/core/walk/router';
import { distanceM } from '../../src/core/util';
import { at, fix, guide, journeyOf, kindOf, lerp, MIN, N, offset, P, prdTrip, rideLeg, route, S, SEC, settings, step, stop, toward, walkLeg } from './guide-fixtures';
import { at as atM, diskSource, indexOf, memorySource, tileOf, type GraphDef } from './walk-helpers';
import { makeEnv } from './support/env';

const m = <K extends Moment['kind']>(mo: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(mo?.kind).toBe(kind);
  return mo as Extract<Moment, { kind: K }>;
};

/* ------------------------------ Routeur : raison d'un chemin droit (§ 4) ------------------------------ */

/** Une rue en T dans la tuile 2541_145 (Ixelles, quartier de Flagey), comme les tests du routeur de la 1.2.10. */
const street: GraphDef = {
  nodes: { S: [0, -400], J: [0, 0], N: [0, 400], E: [400, 0] },
  ways: [{ nodes: ['S', 'J', 'N'], name: 'Avenue Louise' }, { nodes: ['J', 'E'], name: 'Rue du Bailli' }],
};
const TILE = tileOf(street);

describe('1.3.0 routeur : raison d’un chemin droit (PRD-1.3.0 § 4)', () => {
  it('vrai chemin : pas de raison', async () => {
    const r = await new WalkRouter(memorySource([TILE])).route(atM(0, -300), atM(300, 0));
    expect(r?.source).toBe('osm');
    expect(r).not.toHaveProperty('reason');
  });

  it('tuile de l’arrivée absente de la publication (hors de l’extrait de Belgique) : outside', async () => {
    // 1,3 km au nord : tuile 2542_145, absente (la source rend null, comme un 404 du serveur)
    const src = memorySource([TILE]);
    const r = await new WalkRouter(src, { now: () => 7 }).route(atM(0, -300), atM(0, 1300));
    expect(r).toMatchObject({ source: 'straight', reason: 'outside', maneuvers: [], builtAt: 7 });
    expect(r?.coords).toEqual([atM(0, -300), atM(0, 1300)]);
    expect(src.calls).toContain('test|2542_145');
  });

  it('tuile du départ absente : outside aussi', async () => {
    const r = await new WalkRouter(memorySource([TILE])).route(atM(0, 1300), atM(0, -300));
    expect(r).toMatchObject({ source: 'straight', reason: 'outside' });
  });

  it('tuile coupée en 4 : le quart du bout absent compte (outside), pas la tuile de base', async () => {
    const north = tileOf(street, { key: '2541_145_2', loose: true });
    const src = memorySource([north], indexOf({ split: ['2541_145'] }));
    // départ dans le quart nord-ouest (publié), arrivée à 900 m au sud-est : quart 1, absent
    const r = await new WalkRouter(src).route(atM(-100, 300), atM(500, -900));
    expect(r).toMatchObject({ source: 'straight', reason: 'outside' });
    expect(src.calls).toContain('test|2541_145_1');
    expect(src.calls).not.toContain('test|2541_145');
  });

  it('les tuiles des deux bouts sont là, un bout sans voie à 100 m : nosnap', async () => {
    const r = await new WalkRouter(memorySource([TILE])).route(atM(0, -300), atM(800, 0));
    expect(r).toMatchObject({ source: 'straight', reason: 'nosnap', maneuvers: [] });
  });

  it('deux voies sans lien dans des tuiles présentes : nopath, après le second essai plus large', async () => {
    const def: GraphDef = {
      nodes: { A: [0, -300], B: [0, -50], C: [0, 50], D: [0, 300] },
      ways: [{ nodes: ['A', 'B'], name: 'Rue Sud' }, { nodes: ['C', 'D'], name: 'Rue Nord' }],
    };
    const r = await new WalkRouter(memorySource([tileOf(def)])).route(atM(0, -200), atM(0, 200));
    expect(r).toMatchObject({ source: 'straight', reason: 'nopath' });
  });

  it('plus de 5 km : far, rien de chargé', async () => {
    const src = memorySource([TILE]);
    const r = await new WalkRouter(src).route(atM(0, 0), atM(0, MAX_WALK_M + 100));
    expect(r).toMatchObject({ source: 'straight', reason: 'far' });
    expect(src.indexCalls).toBe(0);
    expect(src.calls).toEqual([]);
  });

  it('tuile d’une autre semaine (présente, pas encore utilisable) : chemin droit, jamais outside', async () => {
    const r = await new WalkRouter({ index: async () => indexOf({ version: '2026-11-02' }), tile: async () => tileOf(street, { ver: '2026-11-09' }) }).route(atM(0, -300), atM(300, 0));
    expect(r?.source).toBe('straight');
    expect(r?.reason).not.toBe('outside');
  });

  it('vraies tuiles du pipeline (extrait du centre d’Helsinki, une tuile) : au-delà de l’extrait, outside ; dedans, le vrai chemin', async () => {
    const src = diskSource(join(__dirname, 'walk-data', 'helsinki'));
    const gare = { lat: 60.1712, lon: 24.9436 };
    const marche = { lat: 60.1675, lon: 24.9525 };
    // parc de Kaivopuisto, à 1,8 km au sud : tuile 3007_832, hors de l'extrait
    const kaivopuisto = { lat: 60.1566, lon: 24.9563 };
    const router = new WalkRouter(src);
    expect(await router.route(gare, kaivopuisto)).toMatchObject({ source: 'straight', reason: 'outside', maneuvers: [] });
    expect(await router.route(kaivopuisto, marche)).toMatchObject({ source: 'straight', reason: 'outside' });
    const inside = await router.route(gare, marche);
    expect(inside?.source).toBe('osm');
    expect(inside?.reason).toBeUndefined();
  });

  it('Core.walkRoute : la tuile de l’arrivée manque sur le serveur (404) : outside', async () => {
    const e = makeEnv({ now: '2026-11-10T12:10' });
    e.server.overrides.set('/quai/data/walk/index.json', () => new Response(JSON.stringify(indexOf({ version: '2026-11-09' })), { status: 200 }));
    e.server.overrides.set('/quai/data/walk/2541_145.json', () => new Response(JSON.stringify(tileOf(street, { ver: '2026-11-09' })), { status: 200 }));
    expect(await e.core.walkRoute!(atM(0, -300), atM(0, 1300))).toMatchObject({ source: 'straight', reason: 'outside' });
    expect((await e.core.walkRoute!(atM(0, -300), atM(300, 0)))?.reason).toBeUndefined();
  });
});

/* ------------------------------ Marche hors de Belgique (§ 4) ------------------------------ */

/** Lieux publics de Lille et de Tournai (positions approchées). */
const LILLE = stop('Grand-Place de Lille', { lat: 50.6372, lon: 3.0633 });
const FLANDRES = { name: N('Lille-Flandres', 'Rijsel-Vlaanderen'), lat: 50.6366, lon: 3.07, areaId: 'sncb:8728600' };
const TOURNAI = { name: N('Tournai', 'Doornik'), lat: 50.6131, lon: 3.3967, areaId: 'sncb:8885001' };

/** Chemin droit d'une marche hors de l'extrait de Belgique (raison outside), comme le rend le routeur. */
const outsideRoute = (a: { lat: number; lon: number }, b: { lat: number; lon: number }, builtAt = 1): WalkRoute => straightOf(a, b, 'outside', builtAt);
/** Chemin droit d'une marche, avec sa raison (sans raison : comme en 1.2.10). */
function straightOf(a: { lat: number; lon: number }, b: { lat: number; lon: number }, reason: WalkRoute['reason'], builtAt = 1): WalkRoute {
  const r = route([{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], [], 'straight', builtAt);
  return reason ? { ...r, reason } : r;
}

/** De la Grand-Place de Lille à pied jusqu'à Lille-Flandres (7 min, partir à 07:48), IC de 08:02 jusqu'à Tournai. */
function lilleTrip() {
  const ic = rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Tournai', platform: '5', stops: [{ p: FLANDRES, t: at('08:02'), platform: '5' }, { p: TOURNAI, t: at('08:30') }] });
  return journeyOf([walkLeg(LILLE, FLANDRES, at('07:48'), 7), ic], 'jlille', at('07:48'));
}

/** IC de 08:00 de Tournai jusqu'à Lille-Flandres (08:28), puis 7 min à pied jusqu'à la Grand-Place de Lille. */
function tournaiTrip() {
  const ic = rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Lille-Flandres', platform: '3', stops: [{ p: TOURNAI, t: at('08:00'), platform: '3' }, { p: FLANDRES, t: at('08:28') }] });
  return journeyOf([ic, walkLeg(FLANDRES, LILLE, ic.arr, 7)], 'jtournai', at('08:00'));
}

/** Positions de la marche Grand-Place → Lille-Flandres, vers l'est (cap 85°), toutes les 10 s à partir de `t0`. */
const walking = (t0: number, metres: number) => fix(toward(LILLE, FLANDRES, metres), t0, { speed: 1.3, heading: 85 });

describe('1.3.0 moteur : marche hors de Belgique (PRD-1.3.0 § 4)', () => {
  it('marche de départ : « Partir maintenant » d’abord, puis « Hors de Belgique » une fois, jamais de virage, fin 30 s', () => {
    const j = lilleTrip();
    const r = guide(j, { origin: LILLE, startedAt: at('07:30'), walk: { leg: 0, route: outsideRoute(LILLE, FLANDRES) } });
    const before = step(r, at('07:30'), fix(LILLE, at('07:30')));
    expect(before.phase.kind).toBe('before');
    expect(before.moment).toBeNull();
    const kinds: (string | null)[] = [];
    // à l'heure de partir : « Partir maintenant » (priorité), « Hors de Belgique » derrière lui
    expect(kindOf(step(r, at('07:48'), fix(LILLE, at('07:48'))))).toBe('leave');
    // la marche commence (40 m) : « Partir maintenant » fini, « Hors de Belgique » tout de suite
    let s = step(r, at('07:48:40'), walking(at('07:48:40'), 50));
    const mo = m(s.moment, 'offMap');
    expect(mo).toMatchObject({ id: 'offMap:jlille:0', since: at('07:48:40'), until: at('07:49:10'), leg: 0, toward: FLANDRES.name });
    expect(mo.distM).toBe(Math.round(distanceM(toward(LILLE, FLANDRES, 50), FLANDRES)));
    expect(mo.walkMin).toBe(Math.ceil((mo.distM! * 1.3) / 80));
    // la cible est devant (cap de la marche vers l'est, gare un peu au sud de l'est)
    expect(Math.abs(mo.bearingDeg!)).toBeLessThan(20);
    for (let t = 50; t <= 300; t += 10) kinds.push(kindOf(step(r, at('07:48:40') + (t - 40) * SEC, walking(at('07:48:40') + (t - 40) * SEC, 50 + t - 40))));
    // 30 s : fini (07:49:10), ne revient pas, aucun virage
    expect(kinds.slice(0, 2)).toEqual(['offMap', 'offMap']);
    expect(kinds.slice(3)).toEqual(kinds.slice(3).map(() => null));
    expect(kinds).not.toContain('turn');
    expect(r.mem.dismissed).toContain('offMap:jlille:0');
    // un nouveau chemin droit (chemin quitté, demandé de nouveau) ne le rappelle pas
    s = step(r, at('07:53'), walking(at('07:53'), 300), { walk: { leg: 0, route: outsideRoute(toward(LILLE, FLANDRES, 300), FLANDRES, 2) } });
    expect(s.moment).toBeNull();
  });

  it('sans cap : pas de direction ; sans position : les minutes à l’heure, ni distance ni direction', () => {
    const j = lilleTrip();
    const r = guide(j, { origin: LILLE, startedAt: at('07:00'), walk: { leg: 0, route: outsideRoute(LILLE, FLANDRES) } });
    step(r, at('07:48'));
    const noHeading = m(step(r, at('07:49'), fix(toward(LILLE, FLANDRES, 60), at('07:49'))).moment, 'offMap');
    expect(noHeading.bearingDeg).toBeUndefined();
    expect(noHeading.distM).toBeGreaterThan(400);
    const r2 = guide(j, { origin: LILLE, startedAt: at('07:00'), walk: { leg: 0, route: outsideRoute(LILLE, FLANDRES) } });
    step(r2, at('07:48'));
    // sans position, « Partir maintenant » finit 3 min après : la marche suit l'heure
    const blind = m(step(r2, at('07:51')).moment, 'offMap');
    expect(blind).toMatchObject({ walkMin: 4, toward: FLANDRES.name });
    expect(blind.distM).toBeUndefined();
    expect(blind.bearingDeg).toBeUndefined();
  });

  it('effacé d’un toucher : ne revient pas', () => {
    const r = guide(lilleTrip(), { origin: LILLE, startedAt: at('07:00'), walk: { leg: 0, route: outsideRoute(LILLE, FLANDRES) } });
    step(r, at('07:48'), fix(LILLE, at('07:48')));
    const s = step(r, at('07:48:40'), walking(at('07:48:40'), 50));
    r.mem = dismissMoment(r.mem, m(s.moment, 'offMap').id, at('07:48:45'));
    expect(step(r, at('07:48:50'), walking(at('07:48:50'), 60)).moment).toBeNull();
    expect(step(r, at('07:50'), walking(at('07:50'), 120)).moment).toBeNull();
  });

  it('dernière marche, guidage lancé en marchant : au lancement, vers la Grand-Place', () => {
    const j = tournaiTrip();
    const here = toward(FLANDRES, LILLE, 80);
    const r = guide(j, { origin: here, startedAt: at('08:30'), walk: { leg: 1, route: outsideRoute(here, LILLE) } });
    const s = step(r, at('08:30'), fix(here, at('08:30'), { heading: 275 }));
    expect(s.phase).toEqual({ kind: 'walk', leg: 1 });
    expect(m(s.moment, 'offMap')).toMatchObject({ id: 'offMap:jtournai:1', leg: 1, toward: LILLE.name, since: at('08:30') });
  });

  it('dernière marche après le train : « Descends » d’abord, puis « Hors de Belgique » au début de la marche', () => {
    const j = tournaiTrip();
    const r = guide(j, { origin: TOURNAI, startedAt: at('07:00'), walk: { leg: 1, route: outsideRoute(FLANDRES, LILLE) } });
    step(r, at('07:58'), fix(TOURNAI, at('07:58')));
    expect(kindOf(step(r, at('08:26'), fix(offset(FLANDRES, 3000, -800), at('08:26'), { speed: 25 })))).toBe('alight');
    // à quai, au pas : descente constatée, la marche commence
    const s = step(r, at('08:28'), fix(FLANDRES, at('08:28'), { speed: 0.5 }));
    expect(s.phase).toEqual({ kind: 'walk', leg: 1 });
    expect(m(s.moment, 'offMap')).toMatchObject({ leg: 1, toward: LILLE.name });
  });

  it('chemin droit pour une autre raison (nosnap, nopath, far) ou sans raison : comme en 1.2.10, pas de « Hors de Belgique »', () => {
    for (const reason of ['nosnap', 'nopath', 'far', undefined] as const) {
      const r = guide(lilleTrip(), { origin: LILLE, startedAt: at('07:00'), walk: { leg: 0, route: straightOf(LILLE, FLANDRES, reason) } });
      step(r, at('07:48'), fix(LILLE, at('07:48')));
      const s = step(r, at('07:48:40'), walking(at('07:48:40'), 50));
      expect(s.moment).toBeNull();
      expect(s.where.walk?.offMap).toBeUndefined();
      expect(s.where.walk?.crowM).toBeUndefined();
    }
  });

  it('« Où tu en es » : hors de Belgique, distance à vol d’oiseau et ses minutes ; avant de partir, la longueur du chemin droit', () => {
    const j = lilleTrip();
    const r = guide(j, { origin: LILLE, startedAt: at('07:00'), walk: { leg: 0, route: outsideRoute(LILLE, FLANDRES) } });
    const before = step(r, at('07:40'));
    expect(before.where.walk).toMatchObject({ offMap: true, crowM: Math.round(distanceM(LILLE, FLANDRES)), remainingMin: 7 });
    // en marchant, à 30 m au nord de la ligne droite : la distance à vol d'oiseau, pas le long de la ligne
    const p = offset(toward(LILLE, FLANDRES, 150), 0, 30);
    const s = step(r, at('07:50'), fix(p, at('07:50'), { heading: 90 }));
    const crow = distanceM(p, FLANDRES);
    expect(s.where.walk).toMatchObject({ offMap: true, crowM: Math.round(crow), remainingM: Math.round(crow), remainingMin: Math.ceil((crow * 1.3) / 80) });
    expect(s.where.walk?.next).toBeUndefined();
    expect(typeof s.where.walk?.bearingDeg).toBe('number');
    // marge du train comptée avec ces minutes
    expect(s.where.walk?.marginMin).toBe(Math.floor((at('08:02') - at('07:50')) / MIN) - s.where.walk!.remainingMin);
  });
});

/* ------------------------------ Vérification au départ et en route (§ 6.3) ------------------------------ */

const issues = (s: GuideState): CheckIssue[] => s.issues ?? [];

/** Positions dans l'IC entre Ans et Louvain (à bord, 30 m/s). */
const inIc = (f: number, t: number) => fix(lerp(S.ans, S.louvain, f), t, { speed: 30 });

describe('1.3.0 moteur : vérification au départ et en route (PRD-1.3.0 § 6.3)', () => {
  it('batterie des lunettes sous 20 % au lancement : « check » 30 s après, 20 s, une fois ; problème vrai tant qu’elle est basse', () => {
    const r = guide(prdTrip(), { startedAt: at('06:40'), battery: 12 });
    const s0 = step(r, at('06:40'));
    expect(s0.moment).toBeNull();
    expect(issues(s0)).toEqual([{ kind: 'battery', level: 12 }]);
    expect(s0.wakeAt).toBe(at('06:40:30'));
    const s1 = step(r, at('06:40:30'));
    expect(m(s1.moment, 'check')).toEqual({ kind: 'check', id: 'check:battery', since: at('06:40:30'), until: at('06:40:50'), leg: 0, issues: [{ kind: 'battery', level: 12 }] });
    expect(kindOf(step(r, at('06:40:49')))).toBe('check');
    expect(step(r, at('06:40:50')).moment).toBeNull();
    expect(r.mem.dismissed).toContain('check:battery');
    const s2 = step(r, at('06:42'));
    expect(s2.moment).toBeNull();
    expect(issues(s2)).toEqual([{ kind: 'battery', level: 12 }]);
    // batterie remontée : plus de problème
    expect(step(r, at('06:43'), undefined, { battery: 35 }).issues).toBeUndefined();
  });

  it('batterie à 20 % ou inconnue : rien', () => {
    for (const battery of [20, undefined, Number.NaN]) {
      const r = guide(prdTrip(), { startedAt: at('06:40'), battery });
      step(r, at('06:40'));
      const s = step(r, at('06:40:30'));
      expect(s.moment).toBeNull();
      expect(s.issues).toBeUndefined();
    }
  });

  it('aucune position dans les 30 s alors que la phase en demande : « Pas de position » ; avec la batterie : deux lignes', () => {
    // lancé dans le bus 6 (position moyenne demandée), aucune position
    const r = guide(prdTrip(), { startedAt: at('07:13'), battery: 12 });
    expect(step(r, at('07:13')).moment).toBeNull();
    const s = step(r, at('07:13:30'));
    expect(m(s.moment, 'check')).toMatchObject({ id: 'check:battery+noPosition', issues: [{ kind: 'battery', level: 12 }, { kind: 'noPosition' }] });
    expect(issues(s)).toEqual([{ kind: 'battery', level: 12 }, { kind: 'noPosition' }]);
    // une position arrive : « Pas de position » réglé ; le moment reste pour la batterie
    const s2 = step(r, at('07:13:40'), fix(lerp(P.gramme, P.leman, 0.5), at('07:13:40'), { speed: 8 }));
    expect(m(s2.moment, 'check').issues).toEqual([{ kind: 'battery', level: 12 }]);
    expect(issues(s2)).toEqual([{ kind: 'battery', level: 12 }]);
  });

  it('une position arrive pendant « Pas de position » : le moment finit tout de suite, plus de problème', () => {
    const r = guide(prdTrip(), { startedAt: at('07:13') });
    step(r, at('07:13'));
    expect(m(step(r, at('07:13:30')).moment, 'check').issues).toEqual([{ kind: 'noPosition' }]);
    const s = step(r, at('07:13:35'), fix(lerp(P.gramme, P.leman, 0.5), at('07:13:35'), { speed: 8 }));
    expect(s.moment).toBeNull();
    expect(s.issues).toBeUndefined();
  });

  it('une position dans les 30 s : rien', () => {
    const r = guide(prdTrip(), { startedAt: at('07:13') });
    step(r, at('07:13'));
    step(r, at('07:13:20'), fix(lerp(P.gramme, P.leman, 0.4), at('07:13:20'), { speed: 8 }));
    const s = step(r, at('07:13:30'));
    expect(s.moment).toBeNull();
    expect(s.issues).toBeUndefined();
  });

  it('lancé tôt (position pas encore demandée) : rien au lancement ; « Pas de position » 30 s après que la phase en demande', () => {
    const r = guide(prdTrip(), { startedAt: at('06:30') });
    step(r, at('06:30'));
    expect(step(r, at('06:30:30')).moment).toBeNull();
    const s0 = step(r, at('06:55'));
    expect(s0.location).toBe('medium');
    expect(s0.moment).toBeNull();
    expect(s0.issues).toBeUndefined();
    expect(s0.wakeAt).toBe(at('06:55:30'));
    const s = step(r, at('06:55:30'));
    expect(m(s.moment, 'check').issues).toEqual([{ kind: 'noPosition' }]);
  });

  it('position perdue depuis 3 min en route : « check » une fois par guidage ; revenue : plus de problème', () => {
    const r = guide(prdTrip(), { startedAt: at('07:40') });
    step(r, at('07:40'), inIc(0.2, at('07:40')));
    step(r, at('07:40:10'), inIc(0.21, at('07:40:10')));
    for (let t = at('07:40:30'); t < at('07:43:10'); t += 30 * SEC) {
      const s = step(r, t);
      expect(s.moment).toBeNull();
      expect(s.issues).toBeUndefined();
    }
    const lost = step(r, at('07:43:10'));
    expect(m(lost.moment, 'check')).toMatchObject({ id: 'check:positionLost', since: at('07:43:10'), until: at('07:43:30'), issues: [{ kind: 'positionLost', minutes: 3 }] });
    expect(issues(lost)).toEqual([{ kind: 'positionLost', minutes: 3 }]);
    expect(step(r, at('07:43:30')).moment).toBeNull();
    expect(issues(step(r, at('07:44:10')))).toEqual([{ kind: 'positionLost', minutes: 4 }]);
    // revenue : vide
    expect(step(r, at('07:45'), inIc(0.3, at('07:45'))).issues).toBeUndefined();
    // perdue de nouveau : le problème, sans nouveau moment
    for (let t = at('07:45:30'); t <= at('07:49'); t += 30 * SEC) expect(step(r, t).moment).toBeNull();
    expect(issues(r.last!)).toEqual([{ kind: 'positionLost', minutes: 4 }]);
  });

  it('téléphone en veille (aucun pas pendant plus de 2 min) : l’attente repart du réveil, pas de fausse perte', () => {
    const r = guide(prdTrip(), { startedAt: at('07:40') });
    step(r, at('07:40'), inIc(0.2, at('07:40')));
    const woke = step(r, at('07:50'));
    expect(woke.moment).toBeNull();
    expect(woke.issues).toBeUndefined();
    for (let t = at('07:50:30'); t < at('07:53'); t += 30 * SEC) expect(step(r, t).issues).toBeUndefined();
    expect(m(step(r, at('07:53')).moment, 'check').issues).toEqual([{ kind: 'positionLost', minutes: 3 }]);
  });

  it('jamais devant une action : derrière « Partir maintenant », puis montré quand elle finit', () => {
    const r = guide(prdTrip(), { startedAt: at('07:05'), battery: 12 });
    expect(kindOf(step(r, at('07:05')))).toBe('leave');
    for (const t of ['07:05:30', '07:06', '07:07:59']) expect(kindOf(step(r, at(t)))).toBe('leave');
    expect(issues(r.last!)).toEqual([{ kind: 'battery', level: 12 }, { kind: 'noPosition' }]);
    const s = step(r, at('07:08'));
    expect(m(s.moment, 'check')).toMatchObject({ since: at('07:08'), until: at('07:08:20'), issues: [{ kind: 'battery', level: 12 }, { kind: 'noPosition' }] });
  });

  it('jamais devant une action : derrière « Monter » ; montré à la montée', () => {
    const r = guide(prdTrip(), { startedAt: at('07:21'), battery: 12 });
    // à quai à Liège-Guillemins, l'IC de 07:30 dans 9 min
    for (let t = at('07:21'); t <= at('07:29'); t += 30 * SEC) expect(kindOf(step(r, t, fix(P.guillemins, t, { speed: 0 })))).toBe('board');
    expect(issues(r.last!)).toEqual([{ kind: 'battery', level: 12 }]);
    // montée constatée : « Monter » fini, la vérification passe
    const s = step(r, at('07:30:40'), fix(toward(P.guillemins, P.ans, 600), at('07:30:40'), { speed: 20 }));
    expect(m(s.moment, 'check').issues).toEqual([{ kind: 'battery', level: 12 }]);
  });

  it('sur tout le trajet du PRD : un moment « check » ne prend jamais la place d’une action ; le reste comme en 1.2.10', () => {
    // lancé tôt (06:40) : la batterie 30 s après le lancement, « Pas de position » 30 s après que la phase en demande
    const expected: Record<string, string[]> = { '06:40': ['check:battery', 'check:noPosition'] };
    for (const start of ['06:40', '07:05', '07:10', '07:23', '07:31']) {
      // a : lancement vu, batterie basse, aucune position ; b : même trajet, rien à vérifier (guidage repris)
      const a = guide(prdTrip(), { startedAt: at(start), battery: 12 });
      const b = guide(prdTrip(), { startedAt: at(start) - 10 * MIN });
      const checks = new Set<string>();
      for (let t = at(start); t <= at('09:00'); t += 15 * SEC) {
        const sa = step(a, t);
        const sb = step(b, t);
        if (sa.moment?.kind === 'check') {
          checks.add(sa.moment.id);
          expect(sb.moment === null || sb.moment.kind === 'nextStop' || sb.moment.kind === 'arrived', `${start} → ${new Date(t).toISOString()} : ${sb.moment?.kind}`).toBe(true);
        } else expect(sa.moment, `${start} → ${new Date(t).toISOString()}`).toEqual(sb.moment);
        expect(sb.issues?.filter((i) => i.kind !== 'battery')).toBeUndefined();
      }
      expect([...checks], start).toEqual(expected[start] ?? ['check:battery+noPosition']);
    }
  });

  it('arrivé : « Tu y es » n’attend pas derrière une vérification ; aucune vérification à l’arrivée', () => {
    // lancé 10 s avant d'arriver aux étangs d'Ixelles (dernière marche), batterie basse : la vérification tombe à
    // l'arrivée, « Tu y es » passe
    const r = guide(prdTrip(), { startedAt: at('08:53:20'), battery: 12 });
    step(r, at('08:53:20'), fix(toward(P.flagey, P.etangs, 300), at('08:53:20')));
    const s = step(r, at('08:53:50'), fix(P.etangs, at('08:53:50')));
    expect(s.phase.kind).toBe('arrived');
    expect(kindOf(s)).toBe('arrived');
    expect(issues(s)).toEqual([{ kind: 'battery', level: 12 }]);
    // montrée juste avant d'arriver : elle s'arrête à l'arrivée
    const r2 = guide(prdTrip(), { startedAt: at('08:53:00'), battery: 12 });
    step(r2, at('08:53:00'), fix(toward(P.flagey, P.etangs, 200), at('08:53:00')));
    expect(kindOf(step(r2, at('08:53:30'), fix(toward(P.flagey, P.etangs, 250), at('08:53:30'))))).toBe('check');
    expect(kindOf(step(r2, at('08:53:40'), fix(P.etangs, at('08:53:40'))))).toBe('arrived');
  });

  it('effacé d’un toucher : ne revient pas', () => {
    const r = guide(prdTrip(), { startedAt: at('06:40'), battery: 12 });
    step(r, at('06:40'));
    const s = step(r, at('06:40:30'));
    r.mem = dismissMoment(r.mem, m(s.moment, 'check').id, at('06:40:35'));
    expect(step(r, at('06:40:40')).moment).toBeNull();
    expect(step(r, at('06:45')).moment).toBeNull();
  });

  it('« J’y descends » lancé à l’arrêt sans position : « Pas de position » 30 s après, avant « Monter »', () => {
    const call = (areaId: string, name: string, hm: string) => ({ areaId, name: N(name), sched: at(hm), est: at(hm), rt: true, delayMin: 0 });
    const dep: Departure = { op: 'tec', mode: 'bus', line: '6', head: N('Gare des Guillemins'), sched: at('07:12'), est: at('07:12'), rt: true, delayMin: 0, cancelled: false, tripId: 'T6-07:12', stopId: 'LGgram1', stopSeq: 4 };
    const ds: DepartureStops = {
      op: 'tec', mode: 'bus', line: '6', head: N('Gare des Guillemins'), anyPlanned: false, state: 'ok',
      stops: [call('tec:LGgram', 'Monument Gramme', '07:12'), call('tec:LGlema', 'Place Général Leman', '07:16'), call('tec:LGguil', 'Gare des Guillemins', '07:20')],
    };
    const j = rideJourney(dep, ds, 0, 2, [P.gramme, P.leman, P.guilleminsBus]);
    const r = guide(j, { kind: 'ride', title: 'Vers Gare des Guillemins', origin: P.gramme, startedAt: at('06:50') });
    const s0 = step(r, at('06:50'));
    expect(s0.phase).toEqual({ kind: 'wait', leg: 0 });
    expect(s0.moment).toBeNull();
    expect(m(step(r, at('06:50:30')).moment, 'check').issues).toEqual([{ kind: 'noPosition' }]);
    expect(step(r, at('06:50:50')).moment).toBeNull();
    for (let t = at('06:51'); t < at('06:57'); t += MIN) expect(step(r, t).moment).toBeNull();
    expect(kindOf(step(r, at('06:57')))).toBe('board');
  });

  it('suivi sans messages (réglage éteint) : ni moment ni problème, comme en 1.2.10', () => {
    const r = guide(prdTrip(), { startedAt: at('07:13'), battery: 12, settings: settings(false) });
    for (const t of ['07:13', '07:13:30', '07:14']) {
      const s = step(r, at(t));
      expect(s.moment).toBeNull();
      expect(s.issues).toBeUndefined();
    }
  });

  it('guidage repris longtemps après son lancement (mémoire sans vérification) : rien vérifié au départ', () => {
    const r = guide(prdTrip(), { startedAt: at('07:00'), battery: 12 });
    step(r, at('07:13'));
    const s = step(r, at('07:14'));
    expect(s.moment).toBeNull();
    expect(issues(s)).toEqual([{ kind: 'battery', level: 12 }]);
  });

  it('nouveau trajet adopté : la vérification ne se refait pas (une fois par guidage)', () => {
    const r = guide(prdTrip(), { startedAt: at('06:40'), battery: 12 });
    step(r, at('06:40'));
    expect(kindOf(step(r, at('06:40:30')))).toBe('check');
    step(r, at('06:41'));
    r.j = prdTrip({ id: 'jnew' });
    const s = step(r, at('06:41:30'));
    expect(s.journeyId).toBe('jnew');
    expect(s.moment).toBeNull();
    expect(issues(s)).toEqual([{ kind: 'battery', level: 12 }]);
  });

  it('mémoire gardée en JSON : même état, vérification comprise ; mémoire de vérification abîmée tolérée', () => {
    const r = guide(prdTrip(), { startedAt: at('07:40') });
    step(r, at('07:40'), inIc(0.2, at('07:40')));
    for (let t = at('07:40:30'); t <= at('07:42:30'); t += 30 * SEC) step(r, t);
    const input = { ...(r.input as GuideInput), journey: r.j, now: at('07:43'), fixes: [] };
    const a = guideStep(input, r.mem);
    const b = guideStep(input, JSON.parse(JSON.stringify(r.mem)));
    expect(b).toEqual(a);
    expect(a.state.moment?.kind).toBe('check');
    const bad = guideStep(input, { ...r.mem, chk: { t0: 'x', told: 3 } } as never);
    expect(bad.state.moment).toBeNull();
  });

  it('seuils de la vérification et de « Hors de Belgique »', () => {
    expect(GUIDE).toMatchObject({ offMapMs: 30 * SEC, checkAfterMs: 30 * SEC, checkMs: 20 * SEC, checkBattery: 20, lostMs: 3 * MIN });
  });
});

