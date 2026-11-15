/**
 * 1.2.10 : trajets et positions d'essai du moteur du guidage. Lieux publics seulement (gares, arrêts, parcs) ;
 * positions approchées, cohérentes entre elles.
 *
 * Trajet du PRD : à pied jusqu'à l'arrêt Monument Gramme, bus 6 jusqu'à Gare des Guillemins, IC 07:30 voie 3 jusqu'à
 * Bruxelles-Central 08:27 par Ans, Louvain et Bruxelles-Nord, à pied, bus 71 jusqu'à Flagey, à pied.
 */
import type { Journey, LatLon, Leg, Names, Settings, Stopover } from '../../src/core/api';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import type { GuideFix, GuideMemory, GuideState, Maneuver, TurnKind, WalkRoute } from '../../src/core/guide-types';
import { guideStep, newGuideMemory, type GuideInput } from '../../src/core/guide';
import { distanceM } from '../../src/core/util';

export const MIN = 60_000;
export const SEC = 1_000;

/** Lundi 16/11/2026, heure d'hiver (UTC+1). */
export const DAY = '2026-11-16';
export const at = (hm: string, day = DAY, off = '+01:00'): number => Date.parse(`${day}T${hm.length === 5 ? `${hm}:00` : hm}${off}`);

export const N = (fr: string, nl = fr): Names => ({ fr, nl });

/** Lieux publics (positions approchées). */
export const P = {
  avroy: { lat: 50.634, lon: 5.5697 }, // départ : parc public
  gramme: { lat: 50.634, lon: 5.564 }, // arrêt Monument Gramme
  leman: { lat: 50.629, lon: 5.5655 }, // arrêt Place Général Leman
  guilleminsBus: { lat: 50.6252, lon: 5.566 }, // arrêt Gare des Guillemins
  guillemins: { lat: 50.6245, lon: 5.5668 }, // gare de Liège-Guillemins
  ans: { lat: 50.6612, lon: 5.5106 },
  louvain: { lat: 50.8814, lon: 4.7157 },
  nord: { lat: 50.8603, lon: 4.3617 },
  central: { lat: 50.8455, lon: 4.3571 },
  gareCentrale: { lat: 50.846, lon: 4.3585 }, // arrêt du bus 71
  porteNamur: { lat: 50.8382, lon: 4.3624 },
  flagey: { lat: 50.8274, lon: 4.3723 },
  etangs: { lat: 50.824, lon: 4.3735 }, // arrivée : étangs d'Ixelles
} satisfies Record<string, LatLon>;

/** Point à `east` m à l'est et `north` m au nord de `p`. */
export function offset(p: LatLon, east: number, north: number): LatLon {
  return { lat: p.lat + north / 111_320, lon: p.lon + east / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}
/** Point à la fraction `f` du segment a → b. */
export function lerp(a: LatLon, b: LatLon, f: number): LatLon {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}
/** Point à `m` mètres de `a` vers `b` (au-delà de b si m > |ab|). */
export function toward(a: LatLon, b: LatLon, m: number): LatLon {
  return lerp(a, b, m / distanceM(a, b));
}

export function fix(p: LatLon, t: number, extra: Partial<GuideFix> = {}): GuideFix {
  return { lat: p.lat, lon: p.lon, at: t, accuracy: 8, ...extra };
}

type Pt = LatLon & { name: Names; areaId?: string };
export const stop = (name: string, p: LatLon, areaId?: string): Pt => ({ name: N(name), ...p, ...(areaId ? { areaId } : {}) });

export const S = {
  avroy: stop('Parc d’Avroy', P.avroy),
  gramme: stop('Monument Gramme', P.gramme, 'tec:LGgram'),
  leman: stop('Place Général Leman', P.leman, 'tec:LGlema'),
  guilleminsBus: stop('Gare des Guillemins', P.guilleminsBus, 'tec:LGguil'),
  guillemins: stop('Liège-Guillemins', P.guillemins, 'sncb:8841004'),
  ans: stop('Ans', P.ans, 'sncb:8841202'),
  louvain: { name: N('Louvain', 'Leuven'), ...P.louvain, areaId: 'sncb:8833001' },
  nord: { name: N('Bruxelles-Nord', 'Brussel-Noord'), ...P.nord, areaId: 'sncb:8812005' },
  central: { name: N('Bruxelles-Central', 'Brussel-Centraal'), ...P.central, areaId: 'sncb:8813003' },
  gareCentrale: stop('Gare Centrale', P.gareCentrale, 'stib:1180'),
  porteNamur: stop('Porte de Namur', P.porteNamur, 'stib:1250'),
  flagey: stop('Flagey', P.flagey, 'stib:3517'),
  etangs: stop('Étangs d’Ixelles', P.etangs),
};

const end = (p: Pt): Leg['from'] => ({ name: p.name, lat: p.lat, lon: p.lon, ...(p.areaId ? { areaId: p.areaId } : {}) });

/** Marche de `min` minutes partie à `dep` ; `sched` : son départ prévu (l'arrivée prévue de l'étape d'avant). */
export function walkLeg(from: Pt, to: Pt, dep: number, min: number, sched = dep): Leg {
  return { kind: 'walk', from: end(from), to: end(to), dep, arr: dep + min * MIN, schedDep: sched, schedArr: sched + min * MIN, walkMin: min };
}

export interface RideSpec {
  op: Leg['op'];
  mode: Leg['mode'];
  line: string;
  cat?: string;
  head: string | Names;
  /** arrêts : point, heure prévue, retard (min) facultatif, voie facultative */
  stops: { p: Pt; t: number; delay?: number; platform?: string }[];
  rt?: boolean;
  delayMin?: number;
  platform?: string;
  newPlatform?: string;
  cancelled?: boolean;
  tripId?: string;
  rtKept?: boolean;
  /** arrêts sans position (Stopover sans lat/lon) */
  noStopPoints?: boolean;
}

export function rideLeg(r: RideSpec): Leg {
  const first = r.stops[0];
  const last = r.stops[r.stops.length - 1];
  const stops: Stopover[] = r.stops.map((s) => {
    const so: Stopover = { name: s.p.name, sched: s.t, est: s.t + (s.delay ?? r.delayMin ?? 0) * MIN };
    if (s.p.areaId) so.areaId = s.p.areaId;
    if (s.platform) so.platform = s.platform;
    if (!r.noStopPoints) {
      so.lat = s.p.lat;
      so.lon = s.p.lon;
    }
    return so;
  });
  const leg: Leg = {
    kind: 'ride',
    from: end(first.p),
    to: end(last.p),
    dep: stops[0].est,
    arr: stops[stops.length - 1].est,
    schedDep: first.t,
    schedArr: last.t,
    op: r.op,
    mode: r.mode,
    line: r.line,
    head: typeof r.head === 'string' ? N(r.head) : r.head,
    rt: r.rt ?? true,
    delayMin: r.delayMin ?? 0,
    cancelled: r.cancelled ?? false,
    stops,
    tripId: r.tripId ?? `${r.op}-${r.line}-${first.t}`,
  };
  if (r.cat) leg.cat = r.cat;
  if (r.platform) leg.platform = r.platform;
  if (r.newPlatform) leg.newPlatform = r.newPlatform;
  if (r.rtKept) leg.rtKept = true;
  return leg;
}

export function journeyOf(legs: Leg[], id = 'jprd', leaveAt?: number): Journey {
  const rides = legs.filter((l) => l.kind === 'ride');
  return {
    id,
    legs,
    dep: legs[0].dep,
    arr: legs[legs.length - 1].arr,
    leaveAt: leaveAt ?? legs[0].dep,
    transfers: Math.max(0, rides.length - 1),
    rt: rides.every((l) => l.rt === true),
    alerts: [],
  };
}

export interface TripOpts {
  bus6Delay?: number;
  bus6Rt?: boolean;
  bus6RtKept?: boolean;
  icDelay?: number;
  icPlatform?: string;
  icNewPlatform?: string;
  icCancelled?: boolean;
  icRtKept?: boolean;
  bus71Delay?: number;
  noStopPoints?: boolean;
  id?: string;
}

export const BUS6 = (o: TripOpts = {}): Leg =>
  rideLeg({
    op: 'tec', mode: 'bus', line: '6', head: 'Gare des Guillemins', rt: o.bus6Rt ?? true, delayMin: o.bus6Delay ?? 0, noStopPoints: o.noStopPoints, rtKept: o.bus6RtKept,
    stops: [{ p: S.gramme, t: at('07:12') }, { p: S.leman, t: at('07:16') }, { p: S.guilleminsBus, t: at('07:20') }],
  });

export const IC = (o: TripOpts = {}): Leg =>
  rideLeg({
    op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Ostende', delayMin: o.icDelay ?? 0, platform: o.icPlatform ?? '3', newPlatform: o.icNewPlatform,
    cancelled: o.icCancelled, rtKept: o.icRtKept, noStopPoints: o.noStopPoints,
    stops: [
      { p: S.guillemins, t: at('07:30'), platform: o.icPlatform ?? '3' },
      { p: S.ans, t: at('07:37') },
      { p: S.louvain, t: at('08:05') },
      { p: S.nord, t: at('08:22') },
      { p: S.central, t: at('08:27') },
    ],
  });

export const BUS71 = (o: TripOpts = {}): Leg =>
  rideLeg({
    op: 'stib', mode: 'bus', line: '71', head: 'Delta', delayMin: o.bus71Delay ?? 0, noStopPoints: o.noStopPoints,
    stops: [{ p: S.gareCentrale, t: at('08:34') }, { p: S.porteNamur, t: at('08:39') }, { p: S.flagey, t: at('08:48') }],
  });

/**
 * Trajet du PRD : 07:05 → 08:54. Rangs : 0 marche, 1 bus 6, 2 marche (gare), 3 IC, 4 marche, 5 bus 71, 6 marche.
 * Les marches suivent les véhicules comme recompute() du cœur (départ = arrivée de l'étape d'avant).
 */
export function prdTrip(o: TripOpts = {}): Journey {
  const b6 = BUS6(o);
  const ic = IC(o);
  const b71 = BUS71(o);
  const legs = [
    walkLeg(S.avroy, S.gramme, at('07:05'), 5),
    b6,
    walkLeg(S.guilleminsBus, S.guillemins, b6.arr, 3, b6.schedArr),
    ic,
    walkLeg(S.central, S.gareCentrale, ic.arr, 3, ic.schedArr),
    b71,
    walkLeg(S.flagey, S.etangs, b71.arr, 6, b71.schedArr),
  ];
  return journeyOf(legs, o.id ?? 'jprd', at('07:05'));
}

/** Chemin à pied d'essai : une polyligne et des virages à des points donnés. */
export function route(coords: LatLon[], turns: { at: number; turn: TurnKind; street?: string }[] = [], source: WalkRoute['source'] = 'osm', builtAt = 1): WalkRoute {
  let d = 0;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push((d += distanceM(coords[i - 1], coords[i])));
  const maneuvers: Maneuver[] = turns.map((t) => ({ at: t.at, distM: cum[t.at], turn: t.turn, ...(t.street ? { street: t.street } : {}) }));
  return { from: coords[0], to: coords[coords.length - 1], coords, lengthM: d, maneuvers, source, builtAt };
}

/**
 * Chemin de la première marche (Parc d'Avroy → Monument Gramme), en U : 200 m vers le sud, à droite, environ 400 m
 * vers l'ouest, à droite, 200 m vers le nord jusqu'à l'arrêt (≈ 800 m). Virages à 200 m et à ≈ 602 m.
 */
export function firstWalkRoute(builtAt = 1): WalkRoute {
  const a = P.avroy;
  const b = offset(a, 0, -200);
  const d = P.gramme;
  const c = { lat: b.lat, lon: d.lon };
  return route([a, b, c, d], [{ at: 1, turn: 'right', street: 'Boulevard d’Avroy' }, { at: 2, turn: 'right', street: 'Rue Darchis' }], 'osm', builtAt);
}

export const settings = (guide = true): Settings => ({ ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, guide } });

export interface Run {
  j: Journey;
  mem: GuideMemory;
  input: Omit<GuideInput, 'now' | 'fixes' | 'journey'> & { journey?: Journey };
  fixes: GuideFix[];
  last?: GuideState;
}

/** Guidage d'essai : on avance pas à pas (positions gardées 5 min, la mémoire passe d'un pas à l'autre). */
export function guide(j: Journey, o: Partial<Run['input']> = {}): Run {
  return {
    j,
    mem: newGuideMemory(),
    input: { kind: 'trip', title: 'Bureau', settings: settings(), startedAt: o.startedAt ?? j.dep - 30 * MIN, origin: P.avroy, ...o },
    fixes: [],
  };
}

export function step(r: Run, now: number, f?: GuideFix | GuideFix[], extra: Partial<GuideInput> = {}): GuideState {
  if (f) r.fixes.push(...(Array.isArray(f) ? f : [f]));
  r.fixes = r.fixes.filter((x) => now - x.at <= 5 * MIN && x.at <= now);
  const input: GuideInput = { ...(r.input as GuideInput), journey: r.j, now, fixes: [...r.fixes], ...extra };
  const out = guideStep(input, r.mem);
  r.mem = out.mem;
  r.last = out.state;
  return out.state;
}

/** Le moment montré (genre et id), ou null. */
export const kindOf = (s: GuideState): string | null => s.moment?.kind ?? null;
