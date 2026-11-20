/**
 * Quai 1.3.1 (PRD-1.3.1 § 14, R4 ; contrôle du 20/11, remarque 1) : l'heure de partir suit le vrai chemin de la première
 * marche quand il est plus long que la marche prévue, avec ou sans « Éviter les escaliers » (le moteur lit la longueur
 * du chemin rendu par Core.walkRoute, GuideInput.walk). L'exemple du contrôle : marche prévue 3 min, chemin de 446 m
 * (6 min), bus 71 à 07:20, marge 2 min : il faut partir à 07:12, pas à 07:15. Vrai moteur, vraies vues, au pixel.
 * Lieux publics seulement (étangs d'Ixelles, place Flagey, arrêts et gares de Bruxelles).
 */
import { describe, expect, it } from 'vitest';
import type { Journey, LatLon } from '../../src/core/api';
import { guideStatusOf } from '../../src/core/guide';
import type { GuideFix, GuideState, Moment, WalkRoute } from '../../src/core/guide-types';
import { distanceM } from '../../src/core/util';
import { guideView, type GuideShow } from '../../src/glasses/guide-views';
import type { ViewCtx } from '../../src/glasses/views';
import { at, fix, guide, journeyOf, MIN, offset, P, rideLeg, route, S, SEC, step, stop, toward, walkLeg, type Run } from '../core/guide-fixtures';
import { nb, overflowing, page, settingsWith } from './helpers';

const m = <K extends Moment['kind']>(x: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(x?.kind).toBe(kind);
  return x as Extract<Moment, { kind: K }>;
};

/** Départ : au bord des étangs d'Ixelles, 180 m au sud de l'arrêt Flagey (marche prévue : 180 m × 1,3 à 80 m/min, 3 min). */
const START = offset(P.flagey, 0, -180);
const ETANGS = stop('Étangs d’Ixelles', START);
const BUS = () => rideLeg({ op: 'stib', mode: 'bus', line: '71', head: 'De Brouckère', stops: [{ p: S.flagey, t: at('07:20') }, { p: S.porteNamur, t: at('07:29') }, { p: S.gareCentrale, t: at('07:34') }] });
/** 07:15 à pied 3 min jusqu'à Flagey (marge 2 min), bus 71 de 07:20, à pied 3 min jusqu'à la gare de Bruxelles-Central. */
function trip(): Journey {
  const b = BUS();
  return journeyOf([walkLeg(ETANGS, S.flagey, at('07:15'), 3), b, walkLeg(S.gareCentrale, S.central, b.arr, 3)], 'jr4', at('07:15'));
}
/** Le vrai chemin, sans marches : 133 m vers l'est, 180 m vers le nord, 133 m vers l'ouest : 446 m, 6 min. */
function longRoute(from: LatLon = START): WalkRoute {
  const b = offset(from, 133.4, 0);
  return route([from, b, { lat: P.flagey.lat, lon: b.lon }, P.flagey], [{ at: 1, turn: 'left' }, { at: 2, turn: 'left', street: 'Place Eugène Flagey' }]);
}
/** Un vrai chemin pas plus long que la marche prévue : tout droit, 180 m, 3 min. */
const shortRoute = (): WalkRoute => route([START, P.flagey]);
const MISSED = { arr: at('08:07'), laterMin: 30 };
const run = (walk?: WalkRoute, o: Parameters<typeof guide>[1] = {}): Run => guide(trip(), { origin: START, startedAt: at('07:00'), missed: MISSED, ...(walk ? { walk: { leg: 0, route: walk } } : {}), ...o });
const here = (t: number, p: LatLon = START, speed = 0): GuideFix => fix(p, t, { speed });

const ctx = (now: number): ViewCtx => ({ now, settings: settingsWith([]) });
/** Les rangées d'un écran, après contrôle au pixel (rien ne dépasse) ; l'aide retirée. */
function screen(s: GuideState, show: GuideShow, now: number): { lines: string[]; image?: unknown } {
  const v = guideView(s, show, trip(), ctx(now));
  const p = page(v);
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  return { lines: p.lines.map(nb).filter((l) => !/^toucher/.test(l)), image: v.images?.[0]?.image };
}

describe('1.3.1, R4 : l’heure de partir suit le vrai chemin de la première marche', () => {
  it('l’exemple du contrôle : chemin de 446 m (6 min) pour 3 min prévues : partir à 07:12, « 6 min à pied », marge 2 min', () => {
    expect(Math.round(longRoute().lengthM)).toBe(446);
    const r = run(longRoute());
    // avant de partir : « Où tu en es » et la carte « En cours » disent 07:12 et 6 min
    const s10 = step(r, at('07:10'), here(at('07:10')));
    expect(s10.phase).toEqual({ kind: 'before', leg: 0 });
    expect(s10.where.walk).toMatchObject({ remainingMin: 6, leaveAt: at('07:12'), depAt: at('07:20'), marginMin: 4 });
    expect(s10.wakeAt).toBeLessThanOrEqual(at('07:12'));
    expect(screen(s10, 'where', at('07:10')).lines.slice(0, 4)).toEqual(['Jusqu’au bureau', 'Ensuite : partir à 07:12', '6 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20']);
    expect(guideStatusOf(s10, trip(), 'Bureau', true, 'fr')).toMatchObject({ now: 'partir à 07:12', then: true });
    expect(step(r, at('07:11:58'), here(at('07:11:58'))).phase.kind).toBe('before');
    // 07:12 : « Partir maintenant », 6 min, la marge du trajet (2 min) : pas « très juste »
    const s12 = step(r, at('07:12'), here(at('07:12')));
    expect(s12.phase).toEqual({ kind: 'walk', leg: 0 });
    const leave = m(s12.moment, 'leave');
    expect(leave).toMatchObject({ walkMin: 6, depAt: at('07:20'), marginMin: 2, since: at('07:12'), until: at('07:15') });
    expect(leave.tight).toBeUndefined();
    const sc = screen(s12, 'moment', at('07:12'));
    expect(sc.lines).toEqual(['Partir maintenant', '6 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20']);
    expect(sc.image).toEqual({ kind: 'sign', label: 'à pied', value: '6', foot: 'min' });
    // dès le premier pas, la position dit la marche restante (comme avant) : rien ne saute
    const p1 = toward(START, offset(START, 133, 0), 30);
    step(r, at('07:12:20'), here(at('07:12:20'), p1, 1.3));
    const s = step(r, at('07:12:25'), here(at('07:12:25'), toward(START, offset(START, 133, 0), 36), 1.3));
    expect(s.where.walk).toMatchObject({ remainingMin: 6, depAt: at('07:20') });
    expect(s.where.walk?.leaveAt).toBeUndefined();
  });

  it('sans le vrai chemin (1.3.0) : 07:15 et 3 min ; le défaut que la règle corrige', () => {
    const r = run();
    const s10 = step(r, at('07:10'), here(at('07:10')));
    expect(s10.where.walk).toMatchObject({ remainingMin: 3, marginMin: 7 });
    expect(s10.where.walk?.leaveAt).toBeUndefined();
    expect(screen(s10, 'where', at('07:10')).lines.slice(1, 3)).toEqual(['Ensuite : partir à 07:15', '3 min à pied jusqu’à l’arrêt Flagey']);
    expect(guideStatusOf(s10, trip(), 'Bureau', true, 'fr').now).toBe('partir à 07:15');
    expect(step(r, at('07:12'), here(at('07:12'))).phase.kind).toBe('before');
    expect(m(step(r, at('07:15'), here(at('07:15'))).moment, 'leave')).toMatchObject({ walkMin: 3, marginMin: 2, since: at('07:15') });
  });

  it('rien ne change : chemin pas plus long, ligne droite (pas de données, hors de Belgique), chemin qui ne part pas du départ ou ne mène pas à l’arrêt', () => {
    const far = longRoute(offset(START, 0, -100));
    const elsewhere = route([START, offset(START, 133, 0), offset(P.flagey, 200, 0)]);
    const straight: WalkRoute = { ...longRoute(), source: 'straight' };
    for (const [name, walk] of [['court', shortRoute()], ['droit', straight], ['parti d’ailleurs', far], ['vers ailleurs', elsewhere]] as const) {
      const r = run(walk);
      const s10 = step(r, at('07:10'), here(at('07:10')));
      expect(s10.phase.kind, name).toBe('before');
      expect(s10.where.walk?.remainingMin, name).toBe(3);
      expect(s10.where.walk?.leaveAt, name).toBeUndefined();
      expect(step(r, at('07:12'), here(at('07:12'))).phase.kind, name).toBe('before');
      expect(m(step(r, at('07:15'), here(at('07:15'))).moment, 'leave'), name).toMatchObject({ walkMin: 3, marginMin: 2, since: at('07:15') });
      expect(r.mem, name).not.toHaveProperty('walk0');
    }
    // pas plus long : exactement les états de la 1.3.0 (seul le chemin à calculer n'est plus demandé)
    const a = run(shortRoute());
    const b = run();
    for (const hm of ['07:05', '07:10', '07:14:30', '07:15', '07:15:30']) {
      const sa = step(a, at(hm), here(at(hm)));
      const sb = step(b, at(hm), here(at(hm)));
      delete sb.needRoute;
      expect(sa, hm).toEqual(sb);
    }
  });

  it('jamais plus tôt que maintenant : chemin connu à 07:13:40, « Partir maintenant » tout de suite, stable ensuite (mémoire gardée)', () => {
    const r = run(undefined, { startedAt: at('07:13:30') });
    const s0 = step(r, at('07:13:30'), here(at('07:13:30')));
    expect(s0.phase.kind).toBe('before');
    expect(s0.needRoute).toMatchObject({ leg: 0 });
    // le chemin arrive : 6 min pour un bus dans 6 min 20 : très juste, « Si tu le rates »
    r.input.walk = { leg: 0, route: longRoute() };
    const s1 = step(r, at('07:13:40'), here(at('07:13:40')));
    expect(s1.phase).toEqual({ kind: 'walk', leg: 0 });
    const leave = m(s1.moment, 'leave');
    expect(leave).toMatchObject({ walkMin: 6, marginMin: 0, tight: true, missed: MISSED, since: at('07:13:40'), until: at('07:16:40') });
    expect(screen(s1, 'moment', at('07:13:40')).lines).toEqual(['Partir maintenant', '6 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20, très juste', 'Si tu le rates : arrivée 08:07']);
    // la mémoire relue (reprise de l'appli) : la même heure de partir, le même message jusqu'à sa fin
    r.mem = JSON.parse(JSON.stringify(r.mem));
    const s2 = step(r, at('07:14:30'), here(at('07:14:30')));
    expect(m(s2.moment, 'leave')).toMatchObject({ id: leave.id, since: at('07:13:40'), until: at('07:16:40'), walkMin: 6 });
    expect(step(r, at('07:16:41'), here(at('07:16:41'))).moment?.kind).not.toBe('leave');
  });

  it('l’heure de partir ne saute pas : chemin recalculé en route (à 35 m du départ, une minute de moins ; puis depuis la position, position perdue) : toujours 07:12 et 6 min', () => {
    // à 35 m du départ (pas encore « parti », 40 m), hors du chemin 10 s : le contrôleur donne un chemin depuis la position,
    // de 345 m (5 min). Avant : l'heure passait à 07:13, la phase revenait à « avant », « 6 min » devenait « 5 min »
    const r = run(longRoute());
    const leave = m(step(r, at('07:12'), here(at('07:12'))).moment, 'leave');
    const p = offset(START, 35, 0);
    const c = offset(START, 100, 0);
    r.input.walk = { leg: 0, route: route([p, c, { lat: P.flagey.lat, lon: c.lon }, P.flagey], [], 'osm', 2) };
    expect(Math.ceil(r.input.walk.route.lengthM / 80)).toBe(5);
    for (const hm of ['07:12:20', '07:12:40']) {
      const s = step(r, at(hm), here(at(hm), p, hm === '07:12:20' ? 1 : 0));
      expect(s.phase, hm).toEqual({ kind: 'walk', leg: 0 });
      expect(m(s.moment, 'leave'), hm).toMatchObject({ id: leave.id, walkMin: 6, since: at('07:12'), until: at('07:15') });
    }
    // parti (60 m), chemin recalculé depuis la position (il ne part plus du départ), puis plus de position (téléphone en
    // poche, passage couvert) : avant, retour à la phase « avant » avec « Ensuite : partir à 07:15 » et « 3 min à pied »
    const r2 = run(longRoute());
    step(r2, at('07:12'), here(at('07:12')));
    const q = offset(START, 60, 0);
    step(r2, at('07:13'), here(at('07:13'), q, 1.3));
    r2.input.walk = { leg: 0, route: longRoute(q) };
    step(r2, at('07:13:05'), here(at('07:13:05'), q, 1.3));
    r2.mem = JSON.parse(JSON.stringify(r2.mem));
    for (const hm of ['07:14:10', '07:14:40', '07:15']) {
      const s = step(r2, at(hm));
      expect(s.phase, hm).toEqual({ kind: 'walk', leg: 0 });
      expect(s.where.walk?.leaveAt, hm).toBeUndefined();
      expect(s.moment?.kind, hm).not.toBe('leave');
    }
    // le chemin absent un instant (double du contrôleur) : la même heure aussi
    const r3 = run(longRoute());
    expect(step(r3, at('07:10'), here(at('07:10'))).where.walk).toMatchObject({ leaveAt: at('07:12'), remainingMin: 6 });
    delete r3.input.walk;
    expect(step(r3, at('07:10:30'), here(at('07:10:30'))).where.walk).toMatchObject({ leaveAt: at('07:12'), remainingMin: 6 });
  });

  it('jamais plus tard que l’heure prévue : le chemin n’arrive qu’à 07:16:30 (calcul retardé), « Partir maintenant » de 07:15 garde son heure et sa fin (contrôle du moteur)', () => {
    const r = run();
    const s15 = step(r, at('07:15'), here(at('07:15')));
    expect(m(s15.moment, 'leave')).toMatchObject({ walkMin: 3, since: at('07:15'), until: at('07:18') });
    r.input.walk = { leg: 0, route: longRoute() };
    const s16 = step(r, at('07:16:30'), here(at('07:16:30')));
    // les vraies minutes et la marge vraie (« très juste »), mais l'heure de partir reste 07:15 : le message ne dure pas
    // jusqu'à 07:19:30 et la marche ne « part » pas à 07:16:30
    expect(s16.phase).toEqual({ kind: 'walk', leg: 0 });
    expect(m(s16.moment, 'leave')).toMatchObject({ walkMin: 6, since: at('07:15'), until: at('07:18'), tight: true });
    expect(step(r, at('07:18:01'), here(at('07:18:01'))).moment?.kind).not.toBe('leave');
  });

  it('correspondance devenue impossible : le départ raté d’aujourd’hui (« très juste », « Si tu le rates », puis « Ton bus 71 de 07:20 est parti »)', () => {
    const r = run(longRoute(), { startedAt: at('07:16') });
    const s0 = step(r, at('07:16'), here(at('07:16')));
    // lancé après l'heure prévue : l'heure de partir ne recule ni n'avance, les minutes et la marge sont les vraies
    expect(m(s0.moment, 'leave')).toMatchObject({ walkMin: 6, marginMin: -2, tight: true, missed: MISSED, since: at('07:16') });
    expect(s0.replan).toBeUndefined();
    // en marche à 0,8 m/s sur le chemin ; le bus (temps réel) part à 07:20 : raté 2 min après, depuis la position
    const pts = longRoute().coords;
    const along = (d: number): LatLon => (d <= 133 ? toward(pts[0], pts[1], d) : d <= 313 ? toward(pts[1], pts[2], d - 133) : toward(pts[2], pts[3], d - 313));
    let last: GuideState = s0;
    for (let t = at('07:16:10'); t <= at('07:22:10'); t += 10 * SEC) {
      last = step(r, t, here(t, along(((t - at('07:16:10')) / SEC) * 0.8), 0.8));
      if (t < at('07:22')) expect(last.replan, new Date(t).toISOString()).toBeUndefined();
      expect(last.phase, new Date(t).toISOString()).toEqual({ kind: 'walk', leg: 0 });
    }
    // encore à plus de 100 m de l'arrêt : en marche vers lui, pas en attente
    expect(distanceM(along(288), P.flagey)).toBeGreaterThan(100);
    expect(m(last.moment, 'replan')).toMatchObject({ reason: 'missed', lost: { vehicle: { line: '71' }, depAt: at('07:20') } });
    expect(last.replan).toMatchObject({ reason: 'missed' });
    expect(last.replan?.from).not.toHaveProperty('areaId');
  });

  it('pas pour un trajet à pied seul, ni pour une marche de correspondance (minutes prévues gardées)', () => {
    // à pied seul : aucun véhicule à prendre, l'heure et les minutes du trajet restent
    const solo = guide(journeyOf([walkLeg(ETANGS, S.flagey, at('07:15'), 3)], 'jsolo', at('07:15')), { origin: START, startedAt: at('07:00'), walk: { leg: 0, route: longRoute() } });
    const s = step(solo, at('07:12'), here(at('07:12')));
    expect(s.phase.kind).toBe('before');
    expect(s.where.walk).toMatchObject({ remainingMin: 3 });
    expect(s.where.walk?.leaveAt).toBeUndefined();
    // marche de correspondance (du bus 71 à la gare) : son chemin plus long (500 m) ne change pas « ensuite : 3 min à pied »
    const b = BUS();
    const long2 = route([P.gareCentrale, offset(P.gareCentrale, 0, 200), offset(P.central, 0, 200), P.central]);
    expect(long2.lengthM).toBeGreaterThan(400);
    const r = guide(trip(), { origin: START, startedAt: at('07:00'), walk: { leg: 2, route: long2 } });
    const al = m(step(r, b.arr - MIN).moment, 'alight');
    expect(al.then).toMatchObject({ kind: 'walk', min: 3 });
  });
});
