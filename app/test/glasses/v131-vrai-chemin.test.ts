/**
 * Quai 1.3.1, décision du propriétaire du 20/11 à 21:59 : « 7h12 partout ». L'heure de partir, les minutes de la première
 * marche et la marge sont celles du vrai chemin, portées par le trajet lui-même (core/firstwalk.ts) : le guidage lit ce
 * trajet, comme l'accueil, les favoris, l'écran du trajet et le téléphone, et ne corrige plus rien lui-même.
 *
 * Partie A, moteur du guidage et vraies vues, au pixel (l'exemple du contrôle : marche prévue 3 min, chemin de 446 m,
 * 6 min, bus 71 à 07:20, marge 2 min : partir à 07:12, pas à 07:15) ; les preuves du contrôle du moteur y sont gardées
 * (heure qui ne saute pas, jamais plus tard que prévu, départ raté), avec les deux traces de sa remarque 8 (chemin faux
 * de 5 km, guidage lancé à 1,5 km du départ).
 * Partie B, vrai contrôleur des lunettes sur le vrai cœur (calcul des trajets, favoris, tuiles piétonnes au vrai format,
 * test/core/vrai-chemin-scene.ts : arrêt Esplanade, tram 3 de 07:20, la Bourse) : la même heure sur l'accueil, le favori
 * ouvert, l'écran du trajet, « Autres trajets », le guidage, « Voir tout le trajet », la carte « En cours », Quai Web.
 * Lieux publics seulement.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Journey, LatLon } from '../../src/core/api';
import { firstWalkMin, realWalkMin, setFirstWalk } from '../../src/core/firstwalk';
import { guideStatusOf } from '../../src/core/guide';
import type { GuideFix, GuideState, Moment, WalkRoute } from '../../src/core/guide-types';
import { withFirstWalk } from '../../src/core/journeys';
import { distanceM } from '../../src/core/util';
import { guideView, type GuideShow } from '../../src/glasses/guide-views';
import { stepsPage, type ViewCtx } from '../../src/glasses/views';
import type { Intent } from '../../src/glasses/types';
import { guideNowLine } from '../../src/phone/text';
import { at, fix, guide, journeyOf, MIN, offset, P, rideLeg, route, S, SEC, step, stop, toward, walkLeg, type Run } from '../core/guide-fixtures';
import { at as hm, BOURSE, scene, START as HERE, type PathKind } from '../core/vrai-chemin-scene';
import { lines, nb, overflowing, page, settingsWith, setup } from './helpers';

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
const SETTINGS = settingsWith([]);
/**
 * Le trajet tel que le cœur le rend quand le vrai chemin de sa première marche mesure `lengthM` : les fonctions mêmes du
 * cœur (firstwalk.ts : 80 m par minute, 5 min d'avance au plus ; journeys.ts : heure de partir recalculée).
 */
function fixed(lengthM = 446, j: Journey = trip()): Journey {
  return withFirstWalk(j, SETTINGS, at('07:00'), (legs) => setFirstWalk(legs, firstWalkMin(legs[0], realWalkMin(lengthM))));
}
const MISSED = { arr: at('08:07'), laterMin: 30 };
const run = (j: Journey, walk?: WalkRoute, o: Parameters<typeof guide>[1] = {}): Run => guide(j, { origin: START, startedAt: at('07:00'), missed: MISSED, ...(walk ? { walk: { leg: 0, route: walk } } : {}), ...o });
const here = (t: number, p: LatLon = START, speed = 0): GuideFix => fix(p, t, { speed });

const ctx = (now: number): ViewCtx => ({ now, settings: SETTINGS });
/** Les rangées d'un écran du guidage, après contrôle au pixel (rien ne dépasse) ; l'aide retirée. */
function screen(s: GuideState, show: GuideShow, now: number, j: Journey = trip()): { lines: string[]; image?: unknown } {
  const v = guideView(s, show, j, ctx(now));
  const p = page(v);
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  return { lines: p.lines.map(nb).filter((l) => !/^toucher/.test(l)), image: v.images?.[0]?.image };
}

describe('A. le guidage lit l’heure de partir du trajet (vrai moteur, vraies vues)', () => {
  it('le trajet tel que le cœur le rend : 3 min estimées, chemin de 446 m : 6 min, partir à 07:12, la marche de 07:12 à 07:18', () => {
    expect(Math.round(longRoute().lengthM)).toBe(446);
    const j = fixed();
    expect(j).toMatchObject({ id: 'jr4', leaveAt: at('07:12'), dep: at('07:12'), arr: trip().arr });
    expect(j.legs[0]).toMatchObject({ walkMin: 6, walkEst: 3, dep: at('07:12'), arr: at('07:18') });
    expect(j.legs.slice(1)).toEqual(trip().legs.slice(1));
    // appliquée une deuxième fois, la correction ne s'empile pas
    expect(fixed(446, j)).toBe(j);
  });

  it('l’exemple du contrôle : « Ensuite : partir à 07:12 », « 6 min à pied », puis « Partir maintenant » à 07:12, marge 2 min', () => {
    const j = fixed();
    const r = run(j, longRoute());
    // avant de partir : « Où tu en es » et la carte « En cours » disent 07:12 et 6 min
    const s10 = step(r, at('07:10'), here(at('07:10')));
    expect(s10.phase).toEqual({ kind: 'before', leg: 0 });
    expect(s10.where.walk).toMatchObject({ remainingMin: 6, leaveAt: at('07:12'), depAt: at('07:20'), marginMin: 4 });
    expect(s10.wakeAt).toBeLessThanOrEqual(at('07:12'));
    expect(screen(s10, 'where', at('07:10'), j).lines.slice(0, 4)).toEqual(['Jusqu’au bureau', 'Ensuite : partir à 07:12', '6 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20']);
    expect(guideStatusOf(s10, j, 'Bureau', true, 'fr')).toMatchObject({ now: 'partir à 07:12', then: true });
    expect(step(r, at('07:11:58'), here(at('07:11:58'))).phase.kind).toBe('before');
    // 07:12 : « Partir maintenant », 6 min, la marge du trajet (2 min) : pas « très juste »
    const s12 = step(r, at('07:12'), here(at('07:12')));
    expect(s12.phase).toEqual({ kind: 'walk', leg: 0 });
    const leave = m(s12.moment, 'leave');
    expect(leave).toMatchObject({ walkMin: 6, depAt: at('07:20'), marginMin: 2, since: at('07:12'), until: at('07:15') });
    expect(leave.tight).toBeUndefined();
    const sc = screen(s12, 'moment', at('07:12'), j);
    expect(sc.lines).toEqual(['Partir maintenant', '6 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20']);
    expect(sc.image).toEqual({ kind: 'sign', label: 'à pied', value: '6', foot: 'min' });
    // dès le premier pas, la position dit la marche restante (comme avant) : rien ne saute
    const p1 = toward(START, offset(START, 133, 0), 30);
    step(r, at('07:12:20'), here(at('07:12:20'), p1, 1.3));
    const s = step(r, at('07:12:25'), here(at('07:12:25'), toward(START, offset(START, 133, 0), 36), 1.3));
    expect(s.where.walk).toMatchObject({ remainingMin: 6, depAt: at('07:20') });
    expect(s.where.walk?.leaveAt).toBeUndefined();
  });

  it('remarque 9 du contrôle : pendant le guidage, « Voir tout le trajet » montre la même heure et les mêmes minutes (le même trajet)', () => {
    const j = fixed();
    const v = stepsPage({ title: 'Bureau', label: '' }, { journeys: [j], index: 0, followedId: j.id, leaveAt0: j.leaveAt, fresh: true }, { ...ctx(at('07:05')), guidedJourneyId: j.id });
    const rows = lines(v).map(nb);
    expect(rows.some((l) => l.startsWith('Départ 07:12'))).toBe(true);
    expect(rows.some((l) => /^07:12 à pied 6 min → Flagey/.test(l))).toBe(true);
    expect(rows.join('\n')).not.toMatch(/07:15|à pied 3 min → Flagey/);
  });

  it('le moteur ne corrige plus rien lui-même : trajet estimé (pas de tuiles, 1.3.0) : 07:15 et 3 min, même avec un chemin plus long sous la main', () => {
    for (const walk of [undefined, longRoute(), shortRoute(), { ...longRoute(), source: 'straight' as const }]) {
      const r = run(trip(), walk);
      const s10 = step(r, at('07:10'), here(at('07:10')));
      expect(s10.where.walk).toMatchObject({ remainingMin: 3, marginMin: 7 });
      expect(s10.where.walk?.leaveAt).toBeUndefined();
      expect(screen(s10, 'where', at('07:10')).lines.slice(1, 3)).toEqual(['Ensuite : partir à 07:15', '3 min à pied jusqu’à l’arrêt Flagey']);
      expect(guideStatusOf(s10, trip(), 'Bureau', true, 'fr').now).toBe('partir à 07:15');
      expect(step(r, at('07:12'), here(at('07:12'))).phase.kind).toBe('before');
      expect(m(step(r, at('07:15'), here(at('07:15'))).moment, 'leave')).toMatchObject({ walkMin: 3, marginMin: 2, since: at('07:15') });
      expect(r.mem).not.toHaveProperty('walk0');
    }
    // sans chemin : exactement les états de la 1.3.0 (seul le chemin à calculer n'est plus demandé quand il est là)
    const a = run(trip(), shortRoute());
    const b = run(trip());
    for (const t of ['07:05', '07:10', '07:14:30', '07:15', '07:15:30']) {
      const sa = step(a, at(t), here(at(t)));
      const sb = step(b, at(t), here(at(t)));
      delete sb.needRoute;
      expect(sa, t).toEqual(sb);
    }
  });

  it('règle 4 : les vraies minutes arrivent à 07:13:40, pendant le guidage : il fallait partir à 07:12, « Partir maintenant » tout de suite, stable ensuite (mémoire gardée)', () => {
    const r = run(trip(), undefined, { startedAt: at('07:13:30') });
    const s0 = step(r, at('07:13:30'), here(at('07:13:30')));
    expect(s0.phase.kind).toBe('before');
    // le cœur vient de connaître le chemin : le trajet suivi porte 6 min et 07:12 (heure passée) ; bus dans 6 min 20 :
    // très juste, « Si tu le rates »
    const j = fixed();
    r.j = j;
    r.input.walk = { leg: 0, route: longRoute() };
    const s1 = step(r, at('07:13:40'), here(at('07:13:40')));
    expect(s1.phase).toEqual({ kind: 'walk', leg: 0 });
    const leave = m(s1.moment, 'leave');
    expect(leave).toMatchObject({ walkMin: 6, marginMin: 0, tight: true, missed: MISSED, since: at('07:13:40'), until: at('07:16:40') });
    expect(screen(s1, 'moment', at('07:13:40'), j).lines).toEqual(['Partir maintenant', '6 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20, très juste', 'Si tu le rates : arrivée 08:07']);
    // la mémoire relue (reprise de l'appli) : la même heure de partir, le même message jusqu'à sa fin
    r.mem = JSON.parse(JSON.stringify(r.mem));
    const s2 = step(r, at('07:14:30'), here(at('07:14:30')));
    expect(m(s2.moment, 'leave')).toMatchObject({ id: leave.id, since: at('07:13:40'), until: at('07:16:40'), walkMin: 6 });
    expect(step(r, at('07:16:41'), here(at('07:16:41'))).moment?.kind).not.toBe('leave');
  });

  it('l’heure de partir ne saute pas (contrôle du moteur) : chemin recalculé en route (à 35 m du départ, puis depuis la position), position perdue : toujours 07:12 et 6 min', () => {
    const j = fixed();
    const r = run(j, longRoute());
    const leave = m(step(r, at('07:12'), here(at('07:12'))).moment, 'leave');
    const p = offset(START, 35, 0);
    const c = offset(START, 100, 0);
    r.input.walk = { leg: 0, route: route([p, c, { lat: P.flagey.lat, lon: c.lon }, P.flagey], [], 'osm', 2) };
    expect(Math.ceil(r.input.walk.route.lengthM / 80)).toBe(5);
    for (const t of ['07:12:20', '07:12:40']) {
      const s = step(r, at(t), here(at(t), p, t === '07:12:20' ? 1 : 0));
      expect(s.phase, t).toEqual({ kind: 'walk', leg: 0 });
      expect(m(s.moment, 'leave'), t).toMatchObject({ id: leave.id, walkMin: 6, since: at('07:12'), until: at('07:15') });
    }
    // parti (60 m), chemin recalculé depuis la position, puis plus de position (téléphone en poche, passage couvert)
    const r2 = run(j, longRoute());
    step(r2, at('07:12'), here(at('07:12')));
    const q = offset(START, 60, 0);
    step(r2, at('07:13'), here(at('07:13'), q, 1.3));
    r2.input.walk = { leg: 0, route: longRoute(q) };
    step(r2, at('07:13:05'), here(at('07:13:05'), q, 1.3));
    r2.mem = JSON.parse(JSON.stringify(r2.mem));
    for (const t of ['07:14:10', '07:14:40', '07:15']) {
      const s = step(r2, at(t));
      expect(s.phase, t).toEqual({ kind: 'walk', leg: 0 });
      expect(s.where.walk?.leaveAt, t).toBeUndefined();
      expect(s.moment?.kind, t).not.toBe('leave');
    }
    // le chemin absent un instant : la même heure aussi (elle est dans le trajet)
    const r3 = run(j, longRoute());
    expect(step(r3, at('07:10'), here(at('07:10'))).where.walk).toMatchObject({ leaveAt: at('07:12'), remainingMin: 6 });
    delete r3.input.walk;
    expect(step(r3, at('07:10:30'), here(at('07:10:30'))).where.walk).toMatchObject({ leaveAt: at('07:12'), remainingMin: 6 });
  });

  it('jamais plus tard que l’heure prévue (contrôle du moteur) : les vraies minutes n’arrivent qu’à 07:16:30, « Partir maintenant » de 07:15 garde son heure et sa fin', () => {
    const r = run(trip());
    const s15 = step(r, at('07:15'), here(at('07:15')));
    expect(m(s15.moment, 'leave')).toMatchObject({ walkMin: 3, since: at('07:15'), until: at('07:18') });
    r.j = fixed();
    r.input.walk = { leg: 0, route: longRoute() };
    const s16 = step(r, at('07:16:30'), here(at('07:16:30')));
    // les vraies minutes et la marge vraie (« très juste »), mais le message ne dure pas jusqu'à 07:19:30
    expect(s16.phase).toEqual({ kind: 'walk', leg: 0 });
    expect(m(s16.moment, 'leave')).toMatchObject({ walkMin: 6, since: at('07:15'), until: at('07:18'), tight: true });
    expect(step(r, at('07:18:01'), here(at('07:18:01'))).moment?.kind).not.toBe('leave');
  });

  it('véhicule devenu impossible à attraper : le départ raté d’aujourd’hui (« très juste », « Si tu le rates », puis « Ton bus 71 de 07:20 est parti »)', () => {
    const r = run(fixed(), longRoute(), { startedAt: at('07:16') });
    const s0 = step(r, at('07:16'), here(at('07:16')));
    // lancé après l'heure de partir : les minutes et la marge sont les vraies
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
    expect(distanceM(along(288), P.flagey)).toBeGreaterThan(100);
    expect(m(last.moment, 'replan')).toMatchObject({ reason: 'missed', lost: { vehicle: { line: '71' }, depAt: at('07:20') } });
    expect(last.replan).toMatchObject({ reason: 'missed' });
    expect(last.replan?.from).not.toHaveProperty('areaId');
  });

  it('plafond, trace du contrôle : chemin faux de 5 km (65 min) : 5 min d’avance, « 8 min à pied », partir à 07:10 ; jamais « 65 min à pied » ni « Partir maintenant » dès 07:00', () => {
    expect(realWalkMin(5200)).toBe(65);
    const j = fixed(5200);
    // les minutes affichées avant le départ : la marche prévue plus l'avance ; départ + minutes = la même arrivée à l'arrêt
    expect(j.legs[0]).toMatchObject({ walkMin: 8, walkEst: 3, dep: at('07:10'), arr: at('07:18') });
    expect(j.leaveAt).toBe(at('07:10'));
    const r = run(j);
    const s0 = step(r, at('07:00'), here(at('07:00')));
    expect(s0.phase).toEqual({ kind: 'before', leg: 0 });
    expect(s0.moment).toBeNull();
    expect(screen(s0, 'where', at('07:00'), j).lines.slice(1, 3)).toEqual(['Ensuite : partir à 07:10', '8 min à pied jusqu’à l’arrêt Flagey']);
    expect(step(r, at('07:09:58'), here(at('07:09:58'))).phase.kind).toBe('before');
    const s10 = step(r, at('07:10'), here(at('07:10')));
    expect(m(s10.moment, 'leave')).toMatchObject({ walkMin: 8, marginMin: 2, since: at('07:10'), until: at('07:13') });
    expect(screen(s10, 'moment', at('07:10'), j).lines).toEqual(['Partir maintenant', '8 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:20']);
  });

  it('trace du contrôle : guidage lancé à 1,5 km du départ du trajet : le chemin depuis là (21 min) ne change ni l’heure ni les minutes du trajet', () => {
    const far = offset(START, 0, -1500);
    const fromFar = route([far, START, offset(START, 133.4, 0), { lat: P.flagey.lat, lon: offset(START, 133.4, 0).lon }, P.flagey]);
    expect(realWalkMin(fromFar.lengthM)).toBeGreaterThanOrEqual(21);
    for (const [j, leave, min] of [[trip(), '07:15', 3], [fixed(), '07:12', 6]] as const) {
      const r = run(j, fromFar, { origin: far });
      const s = step(r, at('07:00'), here(at('07:00'), far));
      expect(s.phase).toEqual({ kind: 'before', leg: 0 });
      expect(screen(s, 'where', at('07:00'), j).lines.slice(1, 3)).toEqual([`Ensuite : partir à ${leave}`, `${min} min à pied jusqu’à l’arrêt Flagey`]);
      expect(guideStatusOf(s, j, 'Bureau', true, 'fr').now).toBe(`partir à ${leave}`);
    }
  });

  it('pas pour un trajet à pied seul, ni pour une marche de correspondance (minutes prévues gardées)', () => {
    // à pied seul : aucun véhicule à prendre, le cœur ne touche pas le trajet
    const walkOnly = journeyOf([walkLeg(ETANGS, S.flagey, at('07:15'), 3)], 'jsolo', at('07:15'));
    expect(fixed(446, walkOnly)).toBe(walkOnly);
    const solo = guide(walkOnly, { origin: START, startedAt: at('07:00'), walk: { leg: 0, route: longRoute() } });
    const s = step(solo, at('07:12'), here(at('07:12')));
    expect(s.phase.kind).toBe('before');
    expect(s.where.walk).toMatchObject({ remainingMin: 3 });
    expect(s.where.walk?.leaveAt).toBeUndefined();
    // marche de correspondance (du bus 71 à la gare) : son chemin plus long (500 m) ne change pas « ensuite : 3 min à pied »
    const b = BUS();
    const long2 = route([P.gareCentrale, offset(P.gareCentrale, 0, 200), offset(P.central, 0, 200), P.central]);
    expect(long2.lengthM).toBeGreaterThan(400);
    const j = fixed();
    expect(j.legs[2]).toEqual(trip().legs[2]);
    const r = guide(j, { origin: START, startedAt: at('07:00'), walk: { leg: 2, route: long2 } });
    const al = m(step(r, b.arr - MIN).moment, 'alight');
    expect(al.then).toMatchObject({ kind: 'walk', min: 3 });
  });
});

/* ------------------------------ B. vrai contrôleur, vrai cœur ------------------------------ */

type Kit = Awaited<ReturnType<typeof setup>>;
const kits: Kit[] = [];
afterEach(() => {
  for (const k of kits.splice(0)) k.c.stop();
});

/** Les lunettes à `t`, à 180 m au sud de l'arrêt Esplanade, un favori : la Bourse. Vrai cœur sur la scène `path`. */
async function glasses(path: PathKind | null, t: string, o: { web?: boolean; hold?: boolean } = {}) {
  const sc = scene(path);
  if (o.hold) sc.hold();
  const h = await setup({ now: hm(t), settings: settingsWith([BOURSE], { seenVersion: '1.3.1' }), pos: HERE, core: (now) => sc.core(now), web: o.web });
  kits.push(h);
  await h.until((s) => s.screen === 'home' && s.lines.some((l) => /Bourse .*→/.test(l)));
  const intent = (i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
  /** Rangées de l'écran affiché. */
  const rows = (): string[] => h.last().lines.map(nb);
  /** Tout ce qui a été écrit sur les lunettes depuis le début. */
  const everything = (): string => h.screens().flatMap((s) => s.lines).map(nb).join('\n');
  return { h, sc, intent, rows, everything };
}

describe('B. la même heure partout (vrai contrôleur des lunettes, vrai cœur, vraies vues)', () => {
  for (const web of [false, true]) {
    it(`${web ? 'Quai Web' : 'lunettes'} : 07:12 et 6 min sur l’accueil, le favori ouvert, l’écran du trajet, « Autres trajets », le guidage, « Voir tout le trajet », la carte « En cours », « Partir maintenant »`, async () => {
      const { h, intent, rows, everything } = await glasses('long', '07:10', { web });
      // accueil : il est 07:10, partir à 07:12
      expect(rows()).toContain('Bourse   dans 2 min → 07:37');
      // « Favoris », le favori ouvert (accordéon)
      await h.gesture('down', 'tap');
      await h.until((s) => s.screen === 'favorites');
      expect(rows().slice(0, 3)).toEqual(['Bourse   dans 2 min → 07:37', 'à pied 6 min → Esplanade', 'tram 3 ~07:20, direct']);
      // écran du trajet
      await h.gesture('tap');
      await h.until((s) => s.screen === 'steps');
      await h.settle(150);
      expect(rows().slice(1, 3)).toEqual(['07:12 à pied 6 min → Esplanade', '~07:20 Tram 3 → Bourse   07:37']);
      const id = h.last();
      expect(id).toMatchObject({ page: 1, pages: 3, label: 'short' });
      // « Autres trajets » : même départ, même arrêt, même chemin
      await h.gesture('down', 'down', 'down');
      await h.until((s) => s.screen === 'others');
      await h.settle(150);
      expect(rows().slice(0, 4)).toEqual(['Le suivant   07:20 → 07:45', 'tram 3, à pied 6 min', 'Plus tard   07:28 → 07:53', 'tram 3, à pied 6 min']);
      await h.gesture('double');
      await h.until((s) => s.screen === 'steps');
      // « Y aller » : le guidage et la carte « En cours » du téléphone
      await h.gesture('tap');
      await h.until((s) => s.screen === 'guide');
      await h.settle(150);
      expect(rows().slice(0, 4)).toEqual(['Jusqu’à Bourse', 'Ensuite : partir à 07:12', '6 min à pied jusqu’à l’arrêt Esplanade', 'tram 3 à ~07:20']);
      const status = h.c.guideStatus()!;
      expect(status).toMatchObject({ kind: 'trip', now: 'partir à 07:12', then: true, guided: true });
      expect(nb(guideNowLine(status))).toBe('Ensuite : partir à 07:12');
      // « Voir tout le trajet » pendant le guidage (remarque 9 du contrôle du moteur) : la même heure
      await intent({ kind: 'menu', id: 2 });
      await h.until((s) => s.screen === 'steps');
      expect(h.last().followed).toBe(true);
      expect(rows().slice(1, 3)).toEqual(['07:12 à pied 6 min → Esplanade', '~07:20 Tram 3 → Bourse   07:37']);
      await h.gesture('double');
      await h.until((s) => s.screen === 'guide');
      // 07:12 : « Partir maintenant »
      h.advance(2 * MIN + 1000);
      await h.c.refreshCurrent();
      await h.until((s) => s.screen === 'guide' && s.lines[0] === 'Partir maintenant');
      expect(rows().slice(0, 3)).toEqual(['Partir maintenant', '6 min à pied jusqu’à l’arrêt Esplanade', 'tram 3 à ~07:20']);
      expect(h.last().clock).toBe('07:12');
      // nulle part l'estimation
      expect(everything()).not.toMatch(/07:15|dans 5 min|3 min à pied|à pied 3 min/);
    });
  }

  it('sans tuiles piétonnes (hors de Belgique, pas de chemins publiés) : l’estimation partout, comme en 1.3.0 (07:15, 3 min)', async () => {
    const { h, rows, everything, sc } = await glasses(null, '07:10');
    expect(rows()).toContain('Bourse   dans 5 min → 07:37');
    await h.gesture('down', 'tap');
    await h.until((s) => s.screen === 'favorites');
    expect(rows().slice(0, 3)).toEqual(['Bourse   dans 5 min → 07:37', 'à pied 3 min → Esplanade', 'tram 3 ~07:20, direct']);
    await h.gesture('tap');
    await h.until((s) => s.screen === 'steps');
    await h.settle(150);
    expect(rows().slice(1, 3)).toEqual(['07:15 à pied 3 min → Esplanade', '~07:20 Tram 3 → Bourse   07:37']);
    await h.gesture('tap');
    await h.until((s) => s.screen === 'guide');
    await h.settle(150);
    expect(rows().slice(1, 3)).toEqual(['Ensuite : partir à 07:15', '3 min à pied jusqu’à l’arrêt Esplanade']);
    expect(h.c.guideStatus()).toMatchObject({ now: 'partir à 07:15' });
    expect(everything()).not.toMatch(/07:12|6 min à pied|à pied 6 min/);
    // aucune tuile demandée
    expect(sc.walkCalls().filter((u) => u !== 'walk/index.json')).toEqual([]);
  });

  it('règle 3 : tuile lente : l’accueil montre l’estimation tout de suite ; le chemin connu, la ligne change une fois, seule, et ne revient pas', async () => {
    const { h, sc, rows } = await glasses('long', '07:10', { hold: true });
    expect(rows()).toContain('Bourse   dans 5 min → 07:37');
    sc.release();
    await h.until((s) => s.screen === 'home' && s.lines.some((l) => nb(l) === 'Bourse   dans 2 min → 07:37'));
    await h.settle(300);
    const seen = h.screens().filter((s) => s.screen === 'home').map((s) => nb(s.lines.find((l) => l.startsWith('Bourse')) ?? ''));
    const changes = seen.filter((l, i) => i === 0 || l !== seen[i - 1]);
    expect(changes).toEqual(['Bourse   …', 'Bourse   dans 5 min → 07:37', 'Bourse   dans 2 min → 07:37']);
    // rien de plus n'a été demandé au cœur pour les favoris que ce rafraîchissement : une tuile, une fois
    expect(sc.walkCalls().filter((u) => u.includes('2544_144'))).toHaveLength(1);
  });

  it('règles 4 et 5 : chemin connu trop tard (07:15) : l’écran du trajet garde son trajet (heure passée, comme en 1.3.0) ; l’accueil passe au suivant, comme après un départ raté', async () => {
    const { h, sc, rows } = await glasses('long', '07:15', { hold: true });
    // l'estimation : « maintenant » pour le tram de 07:20
    expect(rows()).toContain('Bourse   maintenant → 07:37');
    await h.gesture('down', 'tap', 'tap');
    await h.until((s) => s.screen === 'steps');
    await h.settle(150);
    expect(rows().slice(0, 2)).toEqual(['Partir maintenant : 3 min à pied', '07:15 à pied 3 min → Esplanade']);
    // le chemin arrive : même écran, même trajet (page 1 sur 3), l'heure de partir est passée (07:12)
    sc.release();
    await h.until((s) => s.screen === 'steps' && s.lines.some((l) => nb(l).startsWith('07:12 à pied 6 min')));
    expect(h.last()).toMatchObject({ page: 1, pages: 3, label: 'short' });
    expect(rows().slice(0, 3)).toEqual(['Partir maintenant : 6 min à pied', '07:12 à pied 6 min → Esplanade', '~07:20 Tram 3 → Bourse   07:37']);
    // « Y aller » sur un trajet qu'on ne peut plus attraper : le suivant est guidé (règle de la 1.3.0)
    await h.gesture('tap');
    await h.until((s) => s.screen === 'guide');
    await h.settle(150);
    expect(rows().slice(1, 4)).toEqual(['Ensuite : partir à 07:20', '6 min à pied jusqu’à l’arrêt Esplanade', 'tram 3 à ~07:28']);
  });

  it('règles 4 et 5, accueil : chemin connu trop tard (07:15) : le favori passe seul au tram suivant (07:28, partir à 07:20), sans « … » ni « aucun trajet »', async () => {
    const { h, sc } = await glasses('long', '07:15', { hold: true });
    sc.release();
    await h.until((s) => s.screen === 'home' && s.lines.some((l) => nb(l) === 'Bourse   dans 5 min → 07:45'));
    const seen = h.screens().filter((s) => s.screen === 'home').map((s) => nb(s.lines.find((l) => l.startsWith('Bourse')) ?? ''));
    const changes = seen.filter((l, i) => i === 0 || l !== seen[i - 1]);
    expect(changes).toEqual(['Bourse   …', 'Bourse   maintenant → 07:37', 'Bourse   dans 5 min → 07:45']);
  });

  it('plafond sur les écrans : chemin de 1 000 m (13 min) : « à pied 8 min », jamais 13', async () => {
    const { h, rows, everything } = await glasses('huge', '07:05');
    await h.gesture('down', 'tap');
    await h.until((s) => s.screen === 'favorites');
    expect(rows()[1]).toBe('à pied 8 min → Esplanade');
    expect(everything()).not.toMatch(/13 min/);
  });
});
