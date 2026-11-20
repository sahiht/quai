/**
 * 1.3.1 (pôle Guidage, moteur) : défauts et améliorations du moteur du guidage, rejoués sur des traces simulées
 * (positions datées, vitesse, bruit déterministe), comme l'expert du guidage à pied et l'expert innovation l'ont fait.
 * Chaque test d'un défaut échoue sur le moteur d'avant (commit faaff9c) : il reproduit le défaut.
 *
 * A2 (P1) bus raté en marchant ; A3 (I1) véhicule gardé sans temps réel ; A5 (P2) « Partir maintenant » devant le premier
 * virage ; A6 (P3) « Fais demi-tour » ; A8 (I4) sous terre ; B9 prochain arrêt qui ne recule pas ; B16 (U4) correspondance
 * très juste ; B17 (P7) la marche après la descente ; B18 (P6, P8) deux virages proches, distance stable.
 * Lieux publics seulement (parc d'Avroy, arrêts et gares du trajet du PRD 1.2.10).
 */
import { describe, expect, it } from 'vitest';
import type { LatLon } from '../../src/core/api';
import type { GuideFix, GuideState, Moment, VehicleRef } from '../../src/core/guide-types';
import { dismissMoment, GUIDE, replanNone } from '../../src/core/guide';
import { pointAlong, projectAlong } from '../../src/core/guide-walk';
import { distanceM } from '../../src/core/util';
import { at, fix, firstWalkRoute, guide, journeyOf, kindOf, lerp, MIN, N, offset, P, prdTrip, rideLeg, route, S, SEC, step, toward, walkLeg, type Run } from './guide-fixtures';

const m = <K extends Moment['kind']>(x: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(x?.kind).toBe(kind);
  return x as Extract<Moment, { kind: K }>;
};
const hm = (t: number): string => new Date(t).toISOString().slice(11, 19);
const isUturn = (s: GuideState): boolean => s.moment?.kind === 'turn' && s.moment.turn === 'uturn';

/* ------------------------------ Traces simulées ------------------------------ */

/** Pseudo-aléatoire déterministe (mulberry32) : le même bruit à chaque essai. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Point à `d` m du début d'une polyligne ; avant son début ou après sa fin : prolongée en ligne droite. */
function alongPath(path: LatLon[], d: number): LatLon {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceM(path[i - 1], path[i]));
  const n = path.length;
  if (d <= 0) return toward(path[0], path[1], d);
  if (d >= cum[n - 1]) return toward(path[n - 2], path[n - 1], distanceM(path[n - 2], path[n - 1]) + d - cum[n - 1]);
  for (let i = 1; i < n; i++) if (cum[i] >= d) return toward(path[i - 1], path[i], d - cum[i - 1]);
  return path[n - 1];
}

/**
 * Marche le long de `path`, de `fromM` à `toM` m (à rebours si toM < fromM), à `v` m/s (1,3), une position toutes les
 * `every` s (2), à partir de `t0` ; bruit facultatif de ± `noise` m sur chaque axe ; vitesse donnée par le téléphone.
 */
function trace(path: LatLon[], o: { t0: number; toM: number; fromM?: number; v?: number; every?: number; noise?: number; seed?: number }): GuideFix[] {
  const v = o.v ?? 1.3;
  const every = o.every ?? 2;
  const from = o.fromM ?? 0;
  const dir = o.toM >= from ? 1 : -1;
  const steps = Math.floor(Math.abs(o.toM - from) / (v * every) + 1e-9);
  const rnd = rng(o.seed ?? 1);
  const out: GuideFix[] = [];
  for (let k = 0; k <= steps; k++) {
    let p = alongPath(path, from + dir * k * v * every);
    if (o.noise) p = offset(p, (rnd() * 2 - 1) * o.noise, (rnd() * 2 - 1) * o.noise);
    out.push(fix(p, o.t0 + k * every * SEC, { speed: v }));
  }
  return out;
}

/** Le moteur à chaque position (comme le contrôleur) ; les états, avec l'heure et la position. */
function play(r: Run, fixes: GuideFix[]): { t: number; f: GuideFix; s: GuideState }[] {
  return fixes.map((f) => ({ t: f.at, f, s: step(r, f.at, f) }));
}

/** Immobile à `p` de `from` à `to` (une position toutes les `everyS` s, vitesse 0). */
function stay(r: Run, p: LatLon, from: number, to: number, everyS = 30): GuideState[] {
  const out: GuideState[] = [];
  for (let t = from; t <= to; t += everyS * SEC) out.push(step(r, t, fix(p, t, { speed: 0 })));
  return out;
}

/* ------------------------------ Géométrie (guide-walk) ------------------------------ */

describe('1.3.1 : géométrie du demi-tour', () => {
  it('pointAlong : point le long d’une polyligne, borné à ses bouts ; projectAlong : derrière le départ, distance négative', () => {
    const a = P.avroy;
    const b = offset(a, 0, -100);
    const c = offset(b, -100, 0);
    const pts = [a, b, c];
    const cum = [0, distanceM(a, b), distanceM(a, b) + distanceM(b, c)];
    expect(distanceM(pointAlong(pts, cum, 150), offset(b, -50, 0))).toBeLessThan(0.5);
    expect(pointAlong(pts, cum, -20)).toEqual(a);
    expect(pointAlong(pts, cum, 999)).toEqual(c);
    // 20 m au nord du départ (le chemin part vers le sud) : -20 m, sur le prolongement
    const behind = projectAlong(pts, offset(a, 2, 20), cum);
    expect(behind.alongM).toBeGreaterThan(-20.5);
    expect(behind.alongM).toBeLessThan(-19.5);
    expect(behind.offM).toBeLessThan(2.5);
    // sur le chemin : comme projectOn
    const on = projectAlong(pts, offset(b, -30, 3), cum);
    expect(on.alongM).toBeGreaterThan(129);
    expect(on.alongM).toBeLessThan(131);
  });
});

/* ------------------------------ A2 (P1) ------------------------------ */

describe('A2 (P1) : bus raté en marchant', () => {
  // chemin de la première marche, en U (≈ 803 m) : 200 m au sud, à droite, ≈ 403 m à l'ouest, à droite, 200 m au nord
  const rt = firstWalkRoute();

  it('parti 6 min en retard (temps réel) : à pied après l’heure du bus, virages annoncés, « est parti » 2 min après depuis la position, jamais « pas parti »', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    stay(r, P.avroy, at('07:05'), at('07:10:30'));
    const seen: { t: number; s: GuideState }[] = [];
    let asked: { t: number; s: GuideState; f: GuideFix } | undefined;
    for (const f of trace(rt.coords, { t0: at('07:11'), toM: 790, every: 5, noise: 3 })) {
      const s = step(r, f.at, f);
      seen.push({ t: f.at, s });
      if (s.replan && !asked) {
        asked = { t: f.at, s, f };
        // le contrôleur ne trouve pas d'autre trajet : le guidage continue sur l'ancien
        r.mem = replanNone(r.mem, f.at + SEC);
      }
    }
    const after = seen.filter((x) => x.t >= at('07:12'));
    // défaut : dès l'heure du bus, « à bord » (écran vide, aucun virage), puis fin sans un mot (règle « pas parti »)
    for (const x of after) expect(x.s.phase.kind === 'walk' || x.s.phase.kind === 'wait', hm(x.t)).toBe(true);
    expect(seen.some((x) => x.s.ended)).toBe(false);
    expect(seen.some((x) => x.s.moment?.kind === 'alight')).toBe(false);
    const w = after.find((x) => x.t >= at('07:12:30'))!.s;
    expect(w.phase).toEqual({ kind: 'walk', leg: 0 });
    expect(w.where.walk?.vehicle).toMatchObject({ line: '6' });
    expect(w.where.ride).toBeUndefined();
    // le premier virage (vers 07:13:05, à 40 m ; bruit de 3 m) puis, après « est parti », le second
    const t1 = after.find((x) => x.s.moment?.kind === 'turn');
    expect(t1?.s.moment).toMatchObject({ kind: 'turn', turn: 'right', street: 'Boulevard d’Avroy' });
    expect(t1!.t).toBeLessThanOrEqual(at('07:13:20'));
    expect(after.some((x) => x.s.moment?.kind === 'turn' && x.s.moment.street === 'Rue Darchis')).toBe(true);
    // « Ton bus 6 de 07:12 est parti » à 07:14 (2 min après, temps réel), nouveau trajet depuis la position
    expect(asked?.t).toBe(at('07:14'));
    expect(m(asked!.s.moment, 'replan')).toMatchObject({ reason: 'missed', lost: { vehicle: { line: '6' }, depAt: at('07:12') } });
    expect(asked!.s.moment).not.toHaveProperty('planned');
    expect(asked!.s.replan).toEqual({ from: { lat: asked!.f.lat, lon: asked!.f.lon }, reason: 'missed', at: at('07:14') });
  });

  it('sans temps réel : parti dès que l’arrivée à pied dépasse sa garde (10 min après son heure) ; toujours à pied', () => {
    const r = guide(prdTrip({ bus6Rt: false }), { walk: { leg: 0, route: rt } });
    stay(r, P.avroy, at('07:05'), at('07:13'));
    // partie à 07:13:30 : ≈ 763 m après les 40 premiers, arrivée vers 07:23:30, au-delà de 07:22
    const seen = play(r, trace(rt.coords, { t0: at('07:13:30'), toM: 120, every: 5 }));
    const first = seen.find((x) => x.s.replan)!;
    expect(hm(first.t)).toBe(hm(at('07:14:05')));
    expect(first.s.phase).toEqual({ kind: 'walk', leg: 0 });
    expect(m(first.s.moment, 'replan')).toMatchObject({ reason: 'missed', lost: { depAt: at('07:12') } });
    expect(first.s.moment).not.toHaveProperty('planned');
    expect(first.s.replan?.from.areaId).toBeUndefined();
    expect(seen.some((x) => x.s.ended)).toBe(false);
  });

  it('sans temps réel, sans chemin calculé (ligne droite), le suivant à 07:40 : à pied jusqu’à l’arrêt, gardé jusqu’à 07:25, « Nouveau trajet » sans « est parti »', () => {
    const r = guide(prdTrip({ bus6Rt: false }), { nextByLeg: { 1: { vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('07:40'), rt: false } } });
    stay(r, P.avroy, at('07:05'), at('07:13'));
    const seen = play(r, trace([P.avroy, P.gramme], { t0: at('07:13:30'), toM: distanceM(P.avroy, P.gramme), every: 5 }));
    for (const x of seen.filter((y) => y.t >= at('07:14:01'))) {
      expect(x.s.ended, hm(x.t)).toBe(false);
      expect(x.s.replan, hm(x.t)).toBeUndefined();
      expect(['walk', 'wait'], hm(x.t)).toContain(x.s.phase.kind);
    }
    expect(seen.find((x) => x.t >= at('07:15'))!.s.phase).toEqual({ kind: 'walk', leg: 0 });
    // à l'arrêt : gardé jusqu'à 15 min avant le suivant (07:25)
    for (const s of stay(r, P.gramme, at('07:19'), at('07:24:30'))) {
      expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
      expect(s.replan).toBeUndefined();
    }
    const s = step(r, at('07:25'), fix(P.gramme, at('07:25'), { speed: 0 }));
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed', planned: true });
    expect(s.replan).toMatchObject({ reason: 'missed', from: { areaId: 'tec:LGgram' } });
  });

  it('pas parti (règle 1.2.x) : toujours vrai pour qui reste chez soi', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    expect(stay(r, P.avroy, at('07:05'), at('07:14:30')).some((s) => s.ended)).toBe(false);
    expect(step(r, at('07:15:30'), fix(P.avroy, at('07:15:30'), { speed: 0 })).ended).toBe(true);
  });
});

/* ------------------------------ A3 (I1) ------------------------------ */

describe('A3 (I1) : sans temps réel, le véhicule gardé jusqu’à 15 min avant le suivant', () => {
  const ic742 = () =>
    rideLeg({
      op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Ostende', rt: false, platform: '3',
      stops: [{ p: S.guillemins, t: at('07:42'), platform: '3' }, { p: S.ans, t: at('07:49') }, { p: S.louvain, t: at('08:17') }, { p: S.nord, t: at('08:34') }, { p: S.central, t: at('08:39') }],
    });
  /** à pied jusqu'à la gare de Liège-Guillemins, IC de 07:42 sans temps réel jusqu'à Bruxelles-Central, à pied */
  const icTrip = () => {
    const ic = ic742();
    return journeyOf([walkLeg(S.avroy, S.guillemins, at('07:25'), 13), ic, walkLeg(S.central, S.gareCentrale, ic.arr, 3)], 'jic742', at('07:25'));
  };
  const IC: VehicleRef = { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' };
  const next842 = { 1: { vehicle: IC, depAt: at('08:42'), rt: false } };
  const missed = { arr: at('09:45'), laterMin: 60 };

  it('IC de 07:42 en retard de 12 min : pas « parti » à 07:52 ; « Où tu en es » : son heure et « Si tu le rates » ; monté à 07:54, le guidage continue', () => {
    const r = guide(icTrip(), { nextByLeg: next842, missed, startedAt: at('07:20') });
    const before = step(r, at('07:40'), fix(P.guillemins, at('07:40'), { speed: 0 }));
    expect(before.where.wait).toMatchObject({ depAt: at('07:42'), rt: false });
    expect(before.where.wait?.missed).toBeUndefined();
    for (const s of stay(r, P.guillemins, at('07:43'), at('07:53:30'))) {
      expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
      expect(s.replan).toBeUndefined();
      expect(s.moment?.kind).not.toBe('replan');
    }
    const s52 = step(r, at('07:53:40'), fix(P.guillemins, at('07:53:40'), { speed: 0 }));
    expect(s52.where.wait).toMatchObject({ depAt: at('07:42'), rt: false, missed });
    // le train arrive à 07:54 : montée constatée, le guidage le suit
    step(r, at('07:54:40'), fix(toward(P.guillemins, P.ans, 300), at('07:54:40'), { speed: 15 }));
    const s = step(r, at('07:55:10'), fix(toward(P.guillemins, P.ans, 800), at('07:55:10'), { speed: 22 }));
    expect(r.mem.boarded?.leg).toBe(1);
    expect(s.phase).toMatchObject({ kind: 'ride', leg: 1 });
    expect(s.replan).toBeUndefined();
    expect(s.ended).toBe(false);
  });

  it('resté sur le quai : à 08:27 (15 min avant l’IC de 08:42), « Nouveau trajet » sans « est parti », depuis la gare', () => {
    const r = guide(icTrip(), { nextByLeg: next842, missed, startedAt: at('07:20') });
    for (const s of stay(r, P.guillemins, at('07:38'), at('08:26:30'), 60)) {
      expect(s.replan).toBeUndefined();
      expect(s.moment?.kind).not.toBe('alight');
    }
    const s = step(r, at('08:27'), fix(P.guillemins, at('08:27'), { speed: 0 }));
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed', planned: true, lost: { vehicle: IC, depAt: at('07:42') } });
    expect(s.replan).toMatchObject({ reason: 'missed', from: { areaId: 'sncb:8841004' } });
    expect(s.wakeAt).toBeLessThanOrEqual(at('08:28'));
  });

  it('sans départ suivant connu : gardé 10 min, comme avant ; « Nouveau trajet » sans « est parti »', () => {
    const r = guide(icTrip(), { startedAt: at('07:20') });
    stay(r, P.guillemins, at('07:38'), at('07:51:30'));
    expect(step(r, at('07:51:50'), fix(P.guillemins, at('07:51:50'), { speed: 0 })).replan).toBeUndefined();
    const s = step(r, at('07:52'), fix(P.guillemins, at('07:52'), { speed: 0 }));
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed', planned: true });
  });

  it('bus d’heure en heure sur un trajet court : attendu à l’arrêt sans fin du guidage ni « Descends », puis « Nouveau trajet »', () => {
    const b6 = rideLeg({ op: 'tec', mode: 'bus', line: '6', head: 'Gare des Guillemins', rt: false, stops: [{ p: S.gramme, t: at('07:12') }, { p: S.leman, t: at('07:16') }, { p: S.guilleminsBus, t: at('07:20') }] });
    const j = journeyOf([walkLeg(S.avroy, S.gramme, at('07:05'), 5), b6, walkLeg(S.guilleminsBus, S.guillemins, b6.arr, 3)], 'jcourt', at('07:05'));
    const r = guide(j, { nextByLeg: { 1: { vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('08:12'), rt: false } } });
    for (const s of stay(r, P.gramme, at('07:10'), at('07:56'), 60)) {
      expect(s.ended).toBe(false);
      expect(s.replan).toBeUndefined();
      expect(s.moment?.kind).not.toBe('alight');
      expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    }
    const s = step(r, at('07:57'), fix(P.gramme, at('07:57'), { speed: 0 }));
    expect(s.ended).toBe(false);
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed', planned: true });
    expect(step(r, at('07:59'), fix(P.gramme, at('07:59'), { speed: 0 })).ended).toBe(false);
  });

  it('avec temps réel : rien ne change (raté 2 min après son départ)', () => {
    const ic = { ...ic742(), rt: true };
    const r = guide(journeyOf([walkLeg(S.avroy, S.guillemins, at('07:25'), 13), ic, walkLeg(S.central, S.gareCentrale, ic.arr, 3)], 'jicrt', at('07:25')), { nextByLeg: next842 });
    stay(r, P.guillemins, at('07:38'), at('07:43:30'));
    const s = step(r, at('07:44'), fix(P.guillemins, at('07:44'), { speed: 0 }));
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed' });
    expect(s.moment).not.toHaveProperty('planned');
  });
});

/* ------------------------------ A5 (P2) ------------------------------ */

describe('A5 (P2) : « Partir maintenant » devant le premier virage', () => {
  it('porte à 30 m d’un carrefour : « Partir maintenant » d’abord, la flèche après 15 m de marche sur le chemin (deux positions)', () => {
    const a = P.avroy;
    const b = offset(a, 0, -30);
    const c = { lat: b.lat, lon: P.gramme.lon };
    const rt = route([a, b, c, P.gramme], [{ at: 1, turn: 'right', street: 'Boulevard d’Avroy' }, { at: 2, turn: 'right', street: 'Rue Darchis' }]);
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    step(r, at('07:04:50'), fix(a, at('07:04:50'), { speed: 0 }));
    const s0 = step(r, at('07:05'), fix(a, at('07:05'), { speed: 0 }));
    expect(m(s0.moment, 'leave')).toMatchObject({ walkMin: 5, depAt: at('07:12'), vehicle: { line: '6' } });
    // en marche : 3,9 m toutes les 3 s ; 15,6 m à 07:05:32 (une seule position au-delà de 15 m), 19,5 m à 07:05:35
    const seen = play(r, trace([a, b, c], { t0: at('07:05:20'), toM: 40, every: 3 }));
    for (const x of seen.filter((y) => y.t < at('07:05:35'))) expect(x.s.moment?.kind, hm(x.t)).toBe('leave');
    const t = seen.find((x) => x.t === at('07:05:35'))!.s;
    expect(m(t.moment, 'turn')).toMatchObject({ turn: 'right', street: 'Boulevard d’Avroy' });
    expect(m(t.moment, 'turn').distM).toBeLessThanOrEqual(15);
    // la flèche montrée : « Partir maintenant » ne revient pas
    expect(seen.filter((x) => x.t >= at('07:05:35')).some((x) => x.s.moment?.kind === 'leave')).toBe(false);
  });
});

/* ------------------------------ A6 (P3) ------------------------------ */

describe('A6 (P3) : « Fais demi-tour »', () => {
  // porte du parc d'Avroy à 6 m de la rue (raccord, comme assemble() le fait), la rue vers l'ouest jusqu'à l'arrêt
  const D = P.avroy;
  const Sn = offset(D, 0, -6);
  const W = { lat: Sn.lat, lon: P.gramme.lon };
  const street = (builtAt = 1) => route([D, Sn, W, P.gramme], [], 'osm', builtAt);
  /**
   * parti du mauvais côté (vers l'est) : 33,8 m de marche à 1,3 m/s (jusqu'à 27,8 m après la rue, avant d'en être à
   * plus de 30 m), une position toutes les 2 s, précision 8 m
   */
  const wrongWay = (r: Run) => {
    step(r, at('07:05'), fix(D, at('07:05'), { speed: 0 }));
    return play(r, trace([D, Sn, offset(Sn, 200, 0)], { t0: at('07:05:10'), toM: 34, every: 2 }));
  };

  it('parti du mauvais côté : « Fais demi-tour » (vers l’arrêt Monument Gramme) après 15 m ; fini dans le bon sens ; une fois par chemin', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: street() } });
    const out = wrongWay(r);
    const k = out.findIndex((x) => isUturn(x.s));
    expect(k, 'demi-tour').toBeGreaterThan(0);
    for (const x of out.slice(0, k)) expect(x.s.moment?.kind, hm(x.t)).toBe('leave');
    // 15 m au moins dans le mauvais sens (deux fois la précision, positions lissées sur trois, trois de suite) : entre
    // 16 et 28 m après la rue
    expect(distanceM(out[k].f, Sn)).toBeGreaterThanOrEqual(16);
    expect(distanceM(out[k].f, Sn)).toBeLessThanOrEqual(28);
    const u = m(out[k].s.moment, 'turn');
    expect(u).toMatchObject({ id: 'turn:jprd:0:u:1', turn: 'uturn', distM: 0, toward: N('Monument Gramme'), final: false, leg: 0 });
    expect(u.street).toBeUndefined();
    // demi-tour fait : la flèche reste jusqu'à 10 m dans le bon sens (deux positions), puis plus rien
    const last = out[out.length - 1];
    const back = play(r, trace([last.f, Sn, W], { t0: last.t + 2 * SEC, toM: 40, every: 2 }));
    const end = back.findIndex((x) => !isUturn(x.s));
    expect(end).toBeGreaterThanOrEqual(1);
    expect(end).toBeLessThanOrEqual(6);
    for (const x of back.slice(end)) expect(x.s.moment, hm(x.t)).toBeNull();
    // de nouveau vers l'est : plus de demi-tour sur ce chemin, ni « Partir maintenant »
    const b = back[back.length - 1];
    const again = play(r, trace([b.f, offset(b.f, 200, 0)], { t0: b.t + 2 * SEC, toM: 30, every: 2 }));
    expect(again.some((x) => x.s.moment !== null)).toBe(false);
  });

  it('effacé d’un toucher : ne revient pas', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: street() } });
    const out = wrongWay(r);
    const k = out.findIndex((x) => isUturn(x.s));
    r.mem = dismissMoment(r.mem, m(out[k].s.moment, 'turn').id, out[k].t + SEC);
    const last = out[out.length - 1];
    const more = play(r, trace([last.f, offset(last.f, 200, 0)], { t0: last.t + 2 * SEC, toM: 8, every: 2 }));
    expect(more.some((x) => isUturn(x.s))).toBe(false);
  });

  it('virage raté : le nouveau chemin, calculé depuis la position, repart en arrière ; continuer tout droit : « Fais demi-tour », puis son virage', () => {
    const C = offset(P.avroy, 0, -200);
    const P0 = offset(C, 0, -40);
    const r = guide(prdTrip(), { walk: { leg: 0, route: firstWalkRoute() } });
    // de la porte vers le sud, virage à droite manqué à 200 m, 40 m plus loin (hors du chemin) : nouveau chemin demandé
    const way = [P.avroy, C, offset(C, 0, -300)];
    play(r, trace(way, { t0: at('07:02'), toM: 240, every: 3 }));
    // le contrôleur donne le nouveau chemin (depuis P0 : au nord jusqu'au carrefour, puis à gauche)
    r.input.walk = { leg: 0, route: route([P0, C, { lat: C.lat, lon: P.gramme.lon }, P.gramme], [{ at: 1, turn: 'left', street: 'Boulevard d’Avroy' }], 'osm', 2) };
    const t1 = at('07:02') + Math.round((240 / 1.3) * SEC) + 3 * SEC;
    const on = play(r, trace(way, { t0: t1, fromM: 244, toM: 262, every: 3 }));
    const u = on.find((x) => isUturn(x.s));
    expect(u, 'demi-tour').toBeDefined();
    expect(u!.s.moment?.id).toBe('turn:jprd:0:u:2');
    // demi-tour fait : vers le nord, la flèche s'efface et le virage à gauche vient
    const back = play(r, trace([alongPath(way, 262), C], { t0: on[on.length - 1].t + 3 * SEC, toM: 40, every: 3 }));
    expect(back.some((x) => x.s.moment?.kind === 'turn' && x.s.moment.turn === 'left')).toBe(true);
    expect(isUturn(back[back.length - 1].s)).toBe(false);
  });

  it('jamais à l’arrêt : positions qui sautent (± 9 m) à la porte, vitesse inconnue ou nulle', () => {
    for (const speed of [undefined, 0]) {
      const r = guide(prdTrip(), { walk: { leg: 0, route: street() } });
      const rnd = rng(7);
      for (let k = 0; k < 90; k++) {
        const t = at('07:05') + k * 2 * SEC;
        const p = offset(Sn, (rnd() * 2 - 1) * 9, (rnd() * 2 - 1) * 9);
        const s = step(r, t, fix(p, t, { accuracy: 12, ...(speed === undefined ? {} : { speed }) }));
        expect(isUturn(s), `${speed} ${hm(t)}`).toBe(false);
      }
    }
  });

  it('jamais à l’arrêt d’attente ni avant de partir', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: street() } });
    // avant l'heure, à la porte puis 25 m du mauvais côté : phase « avant », rien
    const early = play(r, trace([D, Sn, offset(Sn, 200, 0)], { t0: at('06:50'), toM: 30, every: 3 }));
    expect(early.some((x) => isUturn(x.s))).toBe(false);
  });
});

/* ------------------------------ A8 (I4) ------------------------------ */

describe('A8 (I4) : sous terre, rien sur la position à l’arrêt ni à bord', () => {
  it('lancé dans le train sans aucune position : ni « Pas de position » ni problème pour la carte « En cours »', () => {
    const r = guide(prdTrip(), { startedAt: at('07:40') });
    for (let t = at('07:40'); t <= at('07:50'); t += 30 * SEC) {
      const s = step(r, t);
      expect(s.phase.kind).toBe('ride');
      expect(s.moment, hm(t)).toBeNull();
      expect(s.issues, hm(t)).toBeUndefined();
    }
  });

  it('position perdue à bord : rien ; à la sortie, l’attente repart de zéro (pas de « Position perdue depuis 47 min »)', () => {
    const r = guide(prdTrip(), { startedAt: at('07:35') });
    step(r, at('07:40'), fix(lerp(S.ans, S.louvain, 0.2), at('07:40'), { speed: 30 }));
    step(r, at('07:40:10'), fix(lerp(S.ans, S.louvain, 0.21), at('07:40:10'), { speed: 30 }));
    for (let t = at('07:40:30'); t <= at('08:26:30'); t += 30 * SEC) {
      const s = step(r, t);
      expect(s.moment?.kind, hm(t)).not.toBe('check');
      expect(s.issues, hm(t)).toBeUndefined();
    }
    for (let t = at('08:27'); t < at('08:30'); t += 30 * SEC) {
      const s = step(r, t);
      expect(s.phase).toEqual({ kind: 'walk', leg: 4 });
      expect(s.issues, hm(t)).toBeUndefined();
    }
  });

  it('à pied : la batterie et la position restent dites (comme en 1.3.0)', () => {
    const r = guide(prdTrip(), { startedAt: at('07:05'), battery: 12 });
    for (const t of ['07:05', '07:06', '07:07:59']) expect(kindOf(step(r, at(t)))).toBe('leave');
    expect(m(step(r, at('07:08')).moment, 'check').issues).toEqual([{ kind: 'battery', level: 12 }, { kind: 'noPosition' }]);
  });
});

/* ------------------------------ B9 ------------------------------ */

describe('B9 : à bord, le prochain arrêt ne recule pas avec le bruit de la position', () => {
  it('bus 71 autour de Porte de Namur, positions bruitées (± 40 m) : phase.next ne recule jamais', () => {
    const r = guide(prdTrip());
    step(r, at('08:33:30'), fix(P.gareCentrale, at('08:33:30'), { speed: 0 }));
    const line = [P.gareCentrale, P.porteNamur, P.flagey];
    const dPN = distanceM(P.gareCentrale, P.porteNamur);
    const rnd = rng(11);
    const nexts: number[] = [];
    for (let k = 0; k < 40; k++) {
      const t = at('08:37') + k * 5 * SEC;
      const p = alongPath(line, dPN - 100 + k * 5 + (rnd() * 2 - 1) * 40);
      const s = step(r, t, fix(p, t, { speed: 6 }));
      expect(s.phase.kind).toBe('ride');
      if (s.phase.kind === 'ride') nexts.push(s.phase.next);
    }
    expect(nexts[0]).toBe(1);
    expect(nexts[nexts.length - 1]).toBe(2);
    for (let i = 1; i < nexts.length; i++) expect(nexts[i], `${i}`).toBeGreaterThanOrEqual(nexts[i - 1]);
    // « Où tu en es » suit la même étape
    expect(r.last?.where.ride?.next).toBe(2);
  });
});

/* ------------------------------ B16 (U4) ------------------------------ */

describe('B16 (U4) : correspondance très juste dite avant', () => {
  const bus71 = (depAt: number) => ({ 5: { vehicle: { op: 'stib' as const, mode: 'bus' as const, line: '71' }, depAt, rt: true } });

  it('IC en retard de 3 min : « Descends » dit « très juste » ; « Monter » du bus 71 : « Si tu le rates : bus 71 à 08:41 »', () => {
    const r = guide(prdTrip({ icDelay: 3 }), { nextByLeg: bus71(at('08:41')) });
    expect(m(step(r, at('08:26:30')).moment, 'alight').then).toMatchObject({ kind: 'ride', tight: true, from: S.gareCentrale.name });
    const s = step(r, at('08:33'), fix(P.gareCentrale, at('08:33'), { speed: 0 }));
    expect(m(s.moment, 'board')).toMatchObject({ stop: S.gareCentrale.name, depAt: at('08:34'), ifMissed: { vehicle: { line: '71' }, depAt: at('08:41'), rt: true } });
  });

  it('pas très juste (4 min), suivant inconnu ou pas plus tard : pas de « Si tu le rates »', () => {
    const ok = guide(prdTrip(), { nextByLeg: bus71(at('08:41')) });
    expect(m(step(ok, at('08:31'), fix(P.gareCentrale, at('08:31'), { speed: 0 })).moment, 'board').ifMissed).toBeUndefined();
    const unknown = guide(prdTrip({ icDelay: 3 }));
    expect(m(step(unknown, at('08:33'), fix(P.gareCentrale, at('08:33'), { speed: 0 })).moment, 'board').ifMissed).toBeUndefined();
    const same = guide(prdTrip({ icDelay: 3 }), { nextByLeg: bus71(at('08:34')) });
    expect(m(step(same, at('08:33'), fix(P.gareCentrale, at('08:33'), { speed: 0 })).moment, 'board').ifMissed).toBeUndefined();
  });

  it('premier véhicule : jamais (son « Si tu le rates » est celui de « Partir maintenant »)', () => {
    const r = guide(prdTrip(), { nextByLeg: { 1: { vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('07:24'), rt: true } } });
    expect(m(step(r, at('07:10'), fix(P.gramme, at('07:10'), { speed: 0 })).moment, 'board').ifMissed).toBeUndefined();
  });
});

/* ------------------------------ B17 (P7) ------------------------------ */

describe('B17 (P7) : après la descente, la marche suivante', () => {
  it('IC descendu à Bruxelles-Central : « 3 min à pied jusqu’à l’arrêt Gare Centrale », bus 71 à 08:34 ; fini après 40 m', () => {
    const r = guide(prdTrip());
    step(r, at('08:26'), fix(toward(P.nord, P.central, 1200), at('08:26'), { speed: 12 }));
    const s = step(r, at('08:27:20'), fix(P.central, at('08:27:20'), { speed: 0.4 }));
    expect(r.mem.alighted?.leg).toBe(3);
    expect(m(s.moment, 'walk')).toMatchObject({ id: 'walk:jprd:4', leg: 4, walkMin: 3, toward: S.gareCentrale.name, final: false, vehicle: { op: 'stib', mode: 'bus', line: '71' }, depAt: at('08:34'), rt: true });
    expect(kindOf(step(r, at('08:27:40'), fix(toward(P.central, P.gareCentrale, 20), at('08:27:40'), { speed: 1.2 })))).toBe('walk');
    expect(step(r, at('08:28'), fix(toward(P.central, P.gareCentrale, 45), at('08:28'), { speed: 1.2 })).moment).toBeNull();
    expect(kindOf(step(r, at('08:28:20'), fix(toward(P.central, P.gareCentrale, 60), at('08:28:20'), { speed: 1.2 })))).not.toBe('walk');
  });

  it('dernière marche après le bus 71 : « 6 min à pied », l’arrivée 08:54', () => {
    const r = guide(prdTrip());
    step(r, at('08:46'), fix(toward(P.porteNamur, P.flagey, 1000), at('08:46'), { speed: 8 }));
    const s = step(r, at('08:47:40'), fix(offset(P.flagey, 0, 20), at('08:47:40'), { speed: 0.3 }));
    expect(r.mem.alighted?.leg).toBe(5);
    const w = m(s.moment, 'walk');
    expect(w).toMatchObject({ leg: 6, walkMin: 6, toward: S.etangs.name, final: true, arr: at('08:54') });
    expect(w.vehicle).toBeUndefined();
  });

  it('fini au premier virage', () => {
    const near = offset(P.central, 25, 0);
    const r = guide(prdTrip(), { walk: { leg: 4, route: route([P.central, near, P.gareCentrale], [{ at: 1, turn: 'left', street: 'Rue Ravenstein' }]) } });
    step(r, at('08:26'), fix(toward(P.nord, P.central, 1200), at('08:26'), { speed: 12 }));
    // le virage est à 25 m de la descente : la flèche d'abord, jamais la marche
    const s = step(r, at('08:27:20'), fix(P.central, at('08:27:20'), { speed: 0.4 }));
    expect(m(s.moment, 'turn')).toMatchObject({ turn: 'left', street: 'Rue Ravenstein' });
    expect(step(r, at('08:27:30'), fix(P.central, at('08:27:30'), { speed: 0.4 })).moment?.kind).toBe('turn');
  });

  it('sans position : après « Descends », jusqu’à 5 min après l’arrivée du véhicule ; jamais avant la première marche', () => {
    const r = guide(prdTrip());
    expect(kindOf(step(r, at('08:28')))).toBe('alight');
    expect(m(step(r, at('08:29:10')).moment, 'walk')).toMatchObject({ leg: 4, depAt: at('08:34') });
    const r0 = guide(prdTrip());
    for (const t of ['07:05', '07:06', '07:09']) expect(kindOf(step(r0, at(t)))).not.toBe('walk');
  });
});

/* ------------------------------ B18 (P6, P8) ------------------------------ */

describe('B18 (P6, P8) : deux virages proches annoncés ensemble, distance stable', () => {
  // depuis le parc d'Avroy : 100 m vers l'ouest, à gauche (traversée de 20 m), à droite, 280 m vers l'ouest
  const a = P.avroy;
  const b = offset(a, -100, 0);
  const c = offset(b, 0, -20);
  const d = offset(c, -280, 0);
  const crossing = () => route([a, b, c, d], [{ at: 1, turn: 'left' }, { at: 2, turn: 'right', street: 'Boulevard d’Avroy' }]);

  it('traversée aux trottoirs séparés : « à gauche … puis à droite, Boulevard d’Avroy », une seule flèche jusqu’après le second virage', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: crossing() } });
    const seen = play(r, trace([a, b, c, d], { t0: at('07:00'), toM: 160, every: 2 }));
    const turns = seen.filter((x) => x.s.moment?.kind === 'turn').map((x) => x.s.moment as Extract<Moment, { kind: 'turn' }>);
    expect([...new Set(turns.map((t) => t.id))]).toEqual(['turn:jprd:0:0:1']);
    expect(turns[0]).toMatchObject({ turn: 'left', then: 'right', street: 'Boulevard d’Avroy' });
    expect(turns[0].distM).toBeGreaterThanOrEqual(38);
    // pendant la traversée (de 100 à 130 m), rien ne change : la même flèche, « maintenant » (10 m ou moins), puis à droite
    const crossingNow = seen.filter((x) => x.t >= at('07:00') + (100 / 1.3) * SEC && x.t <= at('07:00') + (128 / 1.3) * SEC);
    expect(crossingNow.length).toBeGreaterThan(8);
    for (const x of crossingNow) {
      expect(x.s.moment, hm(x.t)).toMatchObject({ kind: 'turn', id: 'turn:jprd:0:0:1', then: 'right' });
      expect((x.s.moment as Extract<Moment, { kind: 'turn' }>).distM).toBeLessThanOrEqual(10);
    }
    // fini après deux positions 10 m après le second virage
    expect(seen[seen.length - 1].s.moment).toBeNull();
  });

  it('position bruitée (± 6 m) : la distance ne remonte jamais ; une position isolée au-delà du virage ne le finit pas', () => {
    const rt = firstWalkRoute();
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    const fixes = trace(rt.coords, { t0: at('07:06'), fromM: 130, toM: 196, every: 2, noise: 6, seed: 3 });
    const ds = play(r, fixes).filter((x) => x.s.moment?.kind === 'turn').map((x) => (x.s.moment as Extract<Moment, { kind: 'turn' }>).distM);
    expect(ds.length).toBeGreaterThan(10);
    for (let i = 1; i < ds.length; i++) expect(ds[i], `${i} : ${ds.join(' ')}`).toBeLessThanOrEqual(ds[i - 1]);
    // à 4 m du virage, une position isolée 13 m après lui : la flèche reste ; la suivante, revenue avant lui, aussi
    const t = fixes[fixes.length - 1].at + 2 * SEC;
    expect(kindOf(step(r, t, fix(alongPath(rt.coords, 213), t, { speed: 1.3 })))).toBe('turn');
    expect(kindOf(step(r, t + 2 * SEC, fix(alongPath(rt.coords, 200), t + 2 * SEC, { speed: 1.3 })))).toBe('turn');
    // deux positions au-delà : fini
    step(r, t + 4 * SEC, fix(alongPath(rt.coords, 212), t + 4 * SEC, { speed: 1.3 }));
    expect(step(r, t + 6 * SEC, fix(alongPath(rt.coords, 215), t + 6 * SEC, { speed: 1.3 })).moment).toBeNull();
  });
});

/* ------------------------------ Seuils ------------------------------ */

describe('1.3.1 : seuils ajoutés du moteur', () => {
  it('valeurs des notes des experts', () => {
    expect(GUIDE).toMatchObject({ keepBeforeNextMs: 15 * MIN, missedPlannedMs: 10 * MIN, leaveHoldM: 15, uturnM: 15, uturnSpeedMs: 0.5, uturnBackM: 10, turnThenM: 30, turnMedianN: 3 });
  });
});
