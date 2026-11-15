/**
 * 1.2.10 « Y aller » : moteur du guidage (docs/v1.2.10/PRD-1.2.10.md § 3). Contrat : core/guide-types.ts.
 *
 * Le moteur décide QUOI montrer (GuideState : étape, moment, « Où tu en es », recalcul, chemin à pied à calculer,
 * précision de position, prochain réveil, fin) ; les écrans décident COMMENT (glasses/guide-views.ts). Seul texte
 * rédigé ici : guideNowText, la ligne « Maintenant : … » du téléphone.
 *
 * Fonctions pures et déterministes : même entrée, même sortie ; la mémoire d'entrée n'est jamais modifiée. Sans
 * position utilisable (refusée, sous terre, précision au-delà de 75 m, plus vieille que 60 s), tout se fait à l'heure
 * et au temps réel : pas de virage, pas d'arrêt dépassé, pas de véhicule raté.
 *
 * Mémoire (GuideMemory, gardée avec le trajet suivi) : le contrat, plus quelques champs internes (trajet de la mémoire,
 * moment affiché au dernier pas, recalcul demandé, arrivée constatée). Le contrôleur la garde telle quelle (JSON).
 */
import type { Departure, DepartureStops, Journey, LatLon, Leg, NameLang, Names, Settings, Stopover } from './api';
import type {
  GuideFix,
  GuideKind,
  GuideMemory,
  GuidePhase,
  GuideState,
  GuideStatus,
  LocationNeed,
  Moment,
  Then,
  VehicleRef,
  WalkRoute,
  WhereAmI,
} from './guide-types';
import { journeyId } from './journeys';
import { isSncbBus, rideName } from './means';
import { headName, placeNoun, vers } from './text';
import { displayName, distanceM, hhmm } from './util';
import { bearingDeg, cumulative, knownPoint, projectOn, relativeDeg, routePoints, turnsOf, walkProgress } from './guide-walk';

const SEC = 1_000;
const MIN = 60_000;

/** Seuils du guidage (PRD § 3.2, § 3.3, § 3.7, § 3.8). Distances en mètres, durées en ms, vitesses en m/s. */
export const GUIDE = {
  /** virage annoncé à 40 m, ou 15 s à la vitesse de marche si elle est plus grande ; fini 10 m après */
  turnM: 40,
  turnS: 15,
  turnAfterM: 10,
  /** chemin quitté : plus de 30 m pendant 10 s (nouveau chemin demandé, sans message) */
  offRouteM: 30,
  offRouteMs: 10 * SEC,
  /** « Partir maintenant » : fini quand la marche a commencé (40 m) ou 3 min après */
  leaveM: 40,
  leaveMs: 3 * MIN,
  /** « Monter » : à 60 m de l'arrêt et départ dans 15 min ou moins ; fini à la montée ou au départ + 1 min */
  stopM: 60,
  boardAheadMs: 15 * MIN,
  boardAfterMs: 1 * MIN,
  /** « Voie modifiée » : 2 min */
  platformMs: 2 * MIN,
  /** « Prochain arrêt » : trains, trajet de 10 min ou plus, 1 min avant, au plus un toutes les 10 min, jamais dans les
   *  5 min avant « Descends », fini au départ de la gare + 1 min (arrêt d'environ 1 min compté) */
  nextStopRideMs: 10 * MIN,
  nextStopBeforeMs: 1 * MIN,
  nextStopGapMs: 10 * MIN,
  nextStopQuietMs: 5 * MIN,
  nextStopAfterMs: 2 * MIN,
  /** « Descends au prochain arrêt » : à la sortie de l'arrêt d'avant (sinon son heure + 30 s), pas avant 4 min de
   *  l'arrivée ; fini à la descente ou à l'arrivée + 2 min */
  alightEstMs: 30 * SEC,
  alightNotBeforeMs: 4 * MIN,
  alightAfterMs: 2 * MIN,
  /** recalcul : 60 s ; véhicule raté : encore à l'arrêt 2 min après son départ (10 min sans temps réel) */
  replanMs: 60 * SEC,
  missedMs: 2 * MIN,
  missedPlannedMs: 10 * MIN,
  /** arrêt dépassé : plus de 300 m au-delà, en s'éloignant, après son heure ; 3 min */
  passedM: 300,
  passedMs: 3 * MIN,
  /** « Tu y es » : à 50 m de la destination ; 2 min, puis fin */
  arrivedM: 50,
  arrivedMs: 2 * MIN,
  /** fin d'un trajet (règle 1.2.x) : arrivée + 5 min ; pas parti : encore à 300 m du départ 3 min après le 1er départ */
  endAfterMs: 5 * MIN,
  notLeftM: 300,
  notLeftAfterMs: 3 * MIN,
  /** positions : précision au-delà de 75 m ou plus vieille que 60 s ignorée ; liste des 5 dernières minutes */
  accuracyM: 75,
  freshMs: 60 * SEC,
  fixesMs: 5 * MIN,
  /** « Où tu en es » : 30 s (15 s au lancement) ; affiché par le contrôleur */
  whereMs: 30 * SEC,
  whereLaunchMs: 15 * SEC,
  /**
   * précision demandée : high en marchant (approche de l'arrêt comprise), à l'arrêt dans les 15 min avant le départ
   * (boardAheadMs), à bord avant la descente ; medium 10 min avant de partir et à bord autrement
   */
  mediumBeforeMs: 10 * MIN,
  /** recalcul sans position : au plus toutes les 60 s */
  wakeMaxMs: 60 * SEC,
  wakeMinMs: 1 * SEC,
  /** vitesses : véhicule à partir de 4 m/s, marche jusqu'à 2,5 m/s ; marche comptée à 80 m/min */
  vehicleMs: 4,
  walkMaxMs: 2.5,
  walkMPerMin: 80,
  /** encore à l'arrêt (véhicule raté, pas monté) : 100 m d'un arrêt, 200 m d'une gare */
  atStopM: 100,
  atStationM: 200,
  /** montée constatée : à 100 m au moins de l'arrêt, 50 m sur le trajet, 500 m au plus du trajet */
  boardLeftM: 100,
  boardAlongM: 50,
  onLineM: 500,
  /** véhicule sorti de l'arrêt d'avant la descente : 100 m au-delà */
  leftStopM: 100,
  /** descente constatée : à 150 m de l'arrêt, au pas, au plus tôt 2 min avant l'heure d'arrivée */
  alightNearM: 150,
  alightFromMs: 2 * MIN,
  /** « très juste » : marge de 1 min ou moins */
  tightMin: 1,
} as const;

/** Entrée du moteur, recalculé à chaque position, à `wakeAt` et à chaque rafraîchissement du temps réel. */
export interface GuideInput {
  kind: GuideKind;
  journey: Journey;
  title: string;
  now: number;
  /** positions récentes (5 min au plus), la plus récente en dernier */
  fixes: GuideFix[];
  /** chemin de la marche en cours ou prochaine (calculé par le contrôleur à la demande `needRoute`) */
  walk?: { leg: number; route: WalkRoute };
  settings: Settings;
  /** lancement du guidage (epoch ms) */
  startedAt: number;
  /** position au lancement (fin anticipée : pas parti) */
  origin?: LatLon;
  /** « Si tu le rates » (règle 1.2.5), si connu */
  missed?: { arr: number; laterMin: number };
  /**
   * Facultatif : arrêts du véhicule en cours après la descente (DepartureStops du départ), pour « Descends à … »
   * quand l'arrêt est dépassé, et (genre trip) pour chercher le nouveau trajet depuis cet arrêt, à son heure. Sans eux :
   * l'arrêt où commence le nouveau trajet.
   */
  beyond?: Stopover[];
  /** Genre trip : rang de l'étape en véhicule dont `beyond` donne les arrêts suivants ; absent : toute étape (genre ride). */
  beyondLeg?: number;
}

/* ------------------------------ Mémoire ------------------------------ */

type ReplanReason = 'missed' | 'cancelled' | 'late' | 'passed';

/** Recalcul demandé (correspondance ratée, supprimé, raté, arrêt dépassé), gardé jusqu'au nouveau trajet. */
interface Pending {
  reason: ReplanReason;
  /** trajet et étape en cause */
  jid: string;
  leg: number;
  /** constaté à (epoch ms) */
  t: number;
  /** nouveau trajet à chercher depuis `from` à partir de `at` */
  from: LatLon & { areaId?: string; name?: Names };
  at: number;
  lost: { vehicle: VehicleRef; depAt: number };
  /** arrivée du trajet perdu (« 33 min plus tard ») */
  oldArr: number;
  /** arrêt dépassé, et le voyage du véhicule (« Descends à » : il continue dans le nouveau trajet) */
  passed?: Names;
  /** arrêt dépassé : l'arrêt suivant du véhicule, où descendre, et son heure (arrêts suivants connus) */
  getOff?: Names;
  getOffAt?: number;
  tripId?: string;
  /** genre ride, arrêt dépassé : aucun recalcul demandé */
  local?: boolean;
  /** véhicule où l'on est (montée constatée), retrouvé dans le nouveau trajet s'il le garde (replanJourney) */
  onBoard?: { tripId?: string; schedDep: number; at: number };
  /** aucun autre trajet trouvé (replanNone), epoch ms */
  none?: number;
  /** nouveau trajet adopté par le contrôleur */
  swap?: { jid: string; at: number };
}

/** La mémoire du moteur : le contrat et ses champs internes. */
interface Mem extends GuideMemory {
  /** trajet auquel se rapportent boarded, alighted, cur */
  jid?: string;
  /** moment affiché au dernier pas (sa fin le range dans `dismissed`) */
  cur?: string;
  re?: Pending;
  /** arrivée constatée (epoch ms) et par la position ? */
  arrivedAt?: number;
  arrivedByFix?: boolean;
}

const MEM_MAX = 400;

/** Minutes entières, sans « -0 ». */
const roundMin = (ms: number): number => Math.round(ms / MIN) || 0;

/** Mémoire neuve, à chaque nouveau guidage (jamais reprise d'un autre trajet guidé). */
export function newGuideMemory(): GuideMemory {
  return { v: 1, dismissed: [], shown: {} };
}

/** Copie défensive d'une mémoire gardée (champs absents ou abîmés tolérés). */
function readMem(mem: GuideMemory | null | undefined): Mem {
  const x = (mem && typeof mem === 'object' ? mem : {}) as Partial<Mem>;
  const out: Mem = {
    v: 1,
    dismissed: Array.isArray(x.dismissed) ? x.dismissed.filter((s): s is string => typeof s === 'string') : [],
    shown: {},
  };
  if (x.shown && typeof x.shown === 'object') for (const [k, v] of Object.entries(x.shown)) if (Number.isFinite(v)) out.shown[k] = v;
  if (Number.isFinite(x.lastNextStopAt)) out.lastNextStopAt = x.lastNextStopAt;
  if (x.boarded && Number.isInteger(x.boarded.leg) && Number.isFinite(x.boarded.at)) out.boarded = { ...x.boarded };
  if (x.alighted && Number.isInteger(x.alighted.leg) && Number.isFinite(x.alighted.at)) out.alighted = { ...x.alighted };
  if (typeof x.jid === 'string') out.jid = x.jid;
  if (typeof x.cur === 'string') out.cur = x.cur;
  if (x.re && typeof x.re === 'object' && typeof x.re.jid === 'string') {
    out.re = { ...x.re, from: { ...x.re.from }, lost: { ...x.re.lost, vehicle: { ...x.re.lost?.vehicle } } };
    if (x.re.swap) out.re.swap = { ...x.re.swap };
  }
  if (Number.isFinite(x.arrivedAt)) out.arrivedAt = x.arrivedAt;
  if (x.arrivedByFix) out.arrivedByFix = true;
  return out;
}

/** Garde la mémoire bornée : au-delà de MEM_MAX entrées, les plus anciennes partent (moments d'autres trajets d'abord). */
function prune(m: Mem, jid: string): void {
  const ids = Object.keys(m.shown);
  if (ids.length + m.dismissed.length <= MEM_MAX) return;
  const mine = (id: string) => id.includes(jid);
  for (const id of ids) if (!mine(id)) delete m.shown[id];
  m.dismissed = m.dismissed.filter(mine).slice(-MEM_MAX / 2);
  const rest = Object.entries(m.shown).sort((a, b) => a[1] - b[1]);
  while (rest.length > MEM_MAX / 2) delete m.shown[rest.shift()![0]];
}

/**
 * Effacer un moment d'un toucher : il ne revient pas (un contenu qui oblige à agir, nouvelle voie ou nouveau trajet,
 * vient avec un nouvel id).
 */
export function dismissMoment(mem: GuideMemory, id: string, now: number): GuideMemory {
  const m = readMem(mem);
  if (!m.dismissed.includes(id)) m.dismissed.push(id);
  if (m.shown[id] === undefined) m.shown[id] = now;
  if (m.cur === id) delete m.cur;
  return m;
}

/**
 * Le contrôleur n'a trouvé aucun autre trajet après une demande `state.replan` : moment « Pas d'autre trajet trouvé »
 * (60 s), le guidage continue sur l'ancien trajet, sans nouvelle demande pour la même cause.
 */
export function replanNone(mem: GuideMemory, now: number): GuideMemory {
  const m = readMem(mem);
  if (m.re && !m.re.swap && m.re.none === undefined) m.re.none = now;
  return m;
}

/* ------------------------------ Étapes ------------------------------ */

const isRide = (l: Leg): boolean => l.kind === 'ride';
/** Un vrai train (pas un bus de remplacement de la SNCB) : voies, « Prochain arrêt ». */
const isTrain = (l: Leg): boolean => l.mode === 'train' && !isSncbBus(l);
/** Voie en vigueur et voie modifiée. */
const platformOf = (l: Leg): string | undefined => l.newPlatform || l.platform || undefined;
const platformChanged = (l: Leg): boolean => !!l.newPlatform && l.newPlatform !== l.platform;

export function vehicleRef(l: Pick<Leg, 'op' | 'mode' | 'line' | 'cat'>): VehicleRef {
  const v: VehicleRef = {};
  if (l.op) v.op = l.op;
  if (l.mode) v.mode = l.mode;
  if (l.line) v.line = l.line;
  if (l.cat) v.cat = l.cat;
  return v;
}

/** Minutes d'une marche (au moins 1). */
function walkMinOf(l: Leg): number {
  return Math.max(1, Math.round(l.walkMin ?? (l.arr - l.dep) / MIN));
}

/** Arrêts d'une étape en véhicule (montée et descente au moins). */
function stopsOf(l: Leg): Stopover[] {
  if (l.stops && l.stops.length >= 2) return l.stops;
  return [
    { name: l.from.name, ...(l.from.areaId ? { areaId: l.from.areaId } : {}), sched: l.schedDep, est: l.dep, lat: l.from.lat, lon: l.from.lon },
    { name: l.to.name, ...(l.to.areaId ? { areaId: l.to.areaId } : {}), sched: l.schedArr, est: l.arr, lat: l.to.lat, lon: l.to.lon },
  ];
}

/** Position de chaque arrêt d'une étape (la montée et la descente : celles de l'étape si l'arrêt n'en a pas). */
function stopPoints(l: Leg, stops: Stopover[]): (LatLon | undefined)[] {
  return stops.map((s, i) => {
    if (knownPoint(s)) return { lat: s.lat, lon: s.lon };
    if (i === 0 && knownPoint(l.from)) return { lat: l.from.lat, lon: l.from.lon };
    if (i === stops.length - 1 && knownPoint(l.to)) return { lat: l.to.lat, lon: l.to.lon };
    return undefined;
  });
}

const place = (p: Leg['from']): LatLon & { areaId?: string; name?: Names } => ({
  lat: p.lat,
  lon: p.lon,
  ...(p.areaId ? { areaId: p.areaId } : {}),
  name: p.name,
});

/* ------------------------------ Contexte ------------------------------ */

interface Ctx {
  in: GuideInput;
  j: Journey;
  legs: Leg[];
  now: number;
  m: Mem;
  guided: boolean;
  /** dernière position utilisable, la précédente (5 s à 2 min avant), vitesse (m/s) */
  fix: GuideFix | null;
  prev: GuideFix | null;
  speed?: number;
  /** marche de départ commencée (40 m du point de départ) */
  started: boolean;
  /** progression sur le chemin à pied fourni, si la position et le chemin sont là */
  walkPr?: { leg: number; alongM: number; offM: number; remainingM: number; route: WalkRoute };
}

function fixesOf(input: GuideInput): GuideFix[] {
  return (input.fixes ?? [])
    .filter((f) => !!f && Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.at) && input.now - f.at <= GUIDE.fixesMs && f.at <= input.now + 5 * SEC)
    .filter((f) => (f.accuracy ?? 0) <= GUIDE.accuracyM)
    .sort((a, b) => a.at - b.at);
}

function context(input: GuideInput, m: Mem): Ctx {
  const j = input.journey;
  const now = input.now;
  const good = fixesOf(input);
  const last = good[good.length - 1];
  const fix = last && now - last.at <= GUIDE.freshMs ? last : null;
  let prev: GuideFix | null = null;
  if (fix) for (let i = good.length - 2; i >= 0; i--) if (fix.at - good[i].at >= 5 * SEC) { prev = fix.at - good[i].at <= 2 * MIN ? good[i] : null; break; }
  let speed: number | undefined;
  if (fix && Number.isFinite(fix.speed) && (fix.speed as number) >= 0) speed = fix.speed;
  else if (fix && prev) speed = distanceM(prev, fix) / ((fix.at - prev.at) / SEC);
  const legs = j.legs;
  const start = knownPoint(input.origin) ? input.origin : legs[0] && knownPoint(legs[0].from) ? legs[0].from : undefined;
  const started = !!(fix && start && distanceM(fix, start) >= GUIDE.leaveM);
  const c: Ctx = { in: input, j, legs, now, m, guided: input.settings?.display?.guide !== false, fix, prev, speed, started };
  const w = input.walk;
  if (fix && w && w.route && legs[w.leg]?.kind === 'walk') {
    const pr = walkProgress(w.route, fix);
    c.walkPr = { leg: w.leg, alongM: pr.alongM, offM: pr.offRouteM, remainingM: pr.remainingM, route: w.route };
  }
  return c;
}

const slow = (c: Ctx): boolean => (c.speed ?? 0) < GUIDE.walkMaxMs;
const fast = (c: Ctx): boolean => (c.speed ?? 0) >= GUIDE.vehicleMs;
const atStopM = (l: Leg): number => (isTrain(l) ? GUIDE.atStationM : GUIDE.atStopM);

/** Distance de la position à un point connu (Infinity sinon). */
function distTo(c: Ctx, p: { lat: number; lon: number } | undefined): number {
  return c.fix && knownPoint(p) ? distanceM(c.fix, p) : Infinity;
}

/** Projection de la position sur les arrêts d'une étape en véhicule ; `all` : tous les arrêts ont une position. */
function rideProj(c: Ctx, l: Leg): { alongM: number; offM: number; totalM: number; stopAlong: number[]; all: boolean } | null {
  if (!c.fix) return null;
  const stops = stopsOf(l);
  const pts = stopPoints(l, stops);
  const keep = pts.map((p, i) => ({ p, i })).filter((x): x is { p: LatLon; i: number } => !!x.p);
  if (keep.length < 2) return null;
  const line = keep.map((x) => x.p);
  const cum = cumulative(line);
  const pr = projectOn(line, c.fix, cum);
  const stopAlong = stops.map(() => NaN);
  keep.forEach((x, k) => (stopAlong[x.i] = cum[k]));
  return { alongM: pr.alongM, offM: pr.offM, totalM: pr.totalM, stopAlong, all: keep.length === stops.length };
}

/** Position sur la ligne du véhicule, avant l'arrêt de descente : encore à bord. */
function riding(c: Ctx, k: number): boolean {
  const l = c.legs[k];
  const p = rideProj(c, l);
  if (!p || p.offM > GUIDE.onLineM / 2) return false;
  return p.alongM < p.totalM - GUIDE.alightNearM && distTo(c, l.to) > GUIDE.alightNearM;
}

/** Encore à l'arrêt de montée, au pas (pas dans le véhicule). */
function stillAtStop(c: Ctx, k: number): boolean {
  const l = c.legs[k];
  return !!c.fix && slow(c) && distTo(c, l.from) <= atStopM(l);
}

/* ------------------------------ Constatations (position) ------------------------------ */

const boardedOn = (m: Mem, k: number): boolean => m.boarded?.leg === k && !(m.alighted && m.alighted.leg >= k);
const alightedFrom = (m: Mem, k: number): boolean => !!m.alighted && m.alighted.leg >= k;

/** Rang de l'étape en véhicule précédente (-1 sinon). */
function prevRide(legs: Leg[], k: number): number {
  for (let i = k - 1; i >= 0; i--) if (legs[i].kind === 'ride') return i;
  return -1;
}
function nextRide(legs: Leg[], from: number): number {
  for (let i = Math.max(0, from); i < legs.length; i++) if (legs[i].kind === 'ride') return i;
  return -1;
}

/** Arrêts du véhicule de l'étape `k` après sa descente (GuideInput.beyond), s'ils sont donnés pour elle. */
function beyondOf(c: Ctx, k: number): Stopover[] {
  const b = c.in.beyond;
  if (!b?.length || (c.in.beyondLeg !== undefined && c.in.beyondLeg !== k)) return [];
  return b;
}

/** Une position récente (depuis `since`) à l'arrêt de montée de l'étape (60 m), ou rien si l'arrêt n'a pas de position. */
function seenAtStop(c: Ctx, l: Leg, since: number): boolean {
  if (!knownPoint(l.from)) return false;
  return fixesOf(c.in).some((f) => f.at >= since && distanceM(f, l.from) <= GUIDE.stopM);
}

/** Montée et descente constatées par la position (vitesse le long du trajet), gardées dans la mémoire. */
function observe(c: Ctx): void {
  const { legs, now, m } = c;
  if (!c.fix) return;
  // montée : la première étape en véhicule pas encore faite, l'étape d'avant finie
  const after = Math.max(m.alighted?.leg ?? -1, m.boarded?.leg ?? -1);
  for (let k = nextRide(legs, after + 1); k >= 0; k = nextRide(legs, k + 1)) {
    const l = legs[k];
    if (l.cancelled || now > l.arr + 10 * MIN) continue;
    if (now < l.dep - 3 * MIN) break;
    const p = prevRide(legs, k);
    if (p >= 0 && !alightedFrom(m, p) && now < legs[p].arr) break;
    // correspondance : monté seulement après être passé à l'arrêt de montée depuis l'arrivée du véhicule d'avant ; sinon
    // une position encore prise dans ce véhicule (en retard, traitée en retard, ou qui continue au-delà de l'arrêt), qui
    // roule près de la ligne suivante, passait pour la montée (descente jamais constatée, arrêt dépassé jamais vu)
    if (p >= 0 && !seenAtStop(c, l, legs[p].arr - GUIDE.alightFromMs)) break;
    if (fast(c) && distTo(c, l.from) >= GUIDE.boardLeftM) {
      const pr = rideProj(c, l);
      const ok = pr ? pr.offM <= GUIDE.onLineM && pr.alongM >= GUIDE.boardAlongM : knownPoint(l.from);
      if (ok) {
        m.boarded = { leg: k, at: now };
        if (m.alighted && m.alighted.leg >= k) delete m.alighted;
      }
    }
    break;
  }
  // descente : l'étape où l'on est monté, sinon celle en cours d'après l'heure
  let b = m.boarded && !alightedFrom(m, m.boarded.leg) ? m.boarded.leg : -1;
  if (b < 0) b = legs.findIndex((l, i) => l.kind === 'ride' && !alightedFrom(m, i) && !l.cancelled && now >= l.dep && now < l.arr + 10 * MIN);
  if (b >= 0) {
    const l = legs[b];
    if (now >= l.arr - GUIDE.alightFromMs && slow(c) && distTo(c, l.to) <= GUIDE.alightNearM) m.alighted = { leg: b, at: now };
  }
}

/* ------------------------------ Où l'on est ------------------------------ */

interface Loc {
  phase: GuidePhase;
  /** étape en cours (rang dans legs), -1 une fois arrivé */
  leg: number;
}

/** Arrivée : à 50 m de la destination (sans position : heure d'arrivée) ; dernière étape en véhicule : descente faite. */
function arrivedNow(c: Ctx): { yes: boolean; byFix: boolean } {
  const { legs, now, m, j } = c;
  const L = legs.length;
  if (!L) return { yes: true, byFix: false };
  const last = legs[L - 1];
  if (last.kind === 'ride') {
    if (alightedFrom(m, L - 1)) return { yes: true, byFix: true };
    // encore à bord d'après la position (véhicule en retard, ou emporté au-delà de l'arrêt) : pas arrivé
    const aboard = boardedOn(m, L - 1) && (riding(c, L - 1) || (fast(c) && distTo(c, last.to) > GUIDE.alightNearM));
    if (now >= last.arr && !aboard) return { yes: true, byFix: false };
    return { yes: false, byFix: false };
  }
  if (c.fix && knownPoint(last.to) && distanceM(c.fix, last.to) <= GUIDE.arrivedM) {
    // pas avant d'avoir quitté le départ (trajet à pied d'une rue) ni avant la dernière marche
    const before = nextRide(legs, 0) >= 0 && !(alightedFrom(m, prevRide(legs, L - 1)) || now >= legs[prevRide(legs, L - 1)].arr);
    if (!before) return { yes: true, byFix: true };
  }
  if (now >= j.arr && !(c.fix && c.walkPr?.leg === L - 1 && c.walkPr.remainingM > GUIDE.arrivedM)) {
    if (!c.fix || !knownPoint(last.to) || distanceM(c.fix, last.to) <= GUIDE.arrivedM) return { yes: true, byFix: false };
    // position connue, loin de la destination : on marche encore (fin au plus tard par la règle 1.2.x)
    return { yes: false, byFix: false };
  }
  return { yes: false, byFix: false };
}

/**
 * La marche `w` n'est pas finie d'après la position : encore loin de son arrivée (à vol d'oiseau). Jamais d'après le
 * chemin gardé : le contrôleur n'en garde qu'un ; si la phase en dépendait, deux marches se le disputaient (avec le
 * chemin de l'une, on se croit arrivé et on demande celui de la suivante ; sans lui, on se croit encore en marche).
 */
function walkingStill(c: Ctx, w: number): boolean {
  const l = c.legs[w];
  if (!c.fix || !knownPoint(l.to)) return false;
  const next = c.legs[w + 1];
  return distanceM(c.fix, l.to) > (next ? atStopM(next) : GUIDE.arrivedM);
}

/** Prochain arrêt à bord (le premier non passé) : par la position si les arrêts ont tous une position, sinon l'heure. */
function nextStopOf(c: Ctx, k: number): number {
  const l = c.legs[k];
  const stops = stopsOf(l);
  const n = stops.length;
  const p = rideProj(c, l);
  if (p && p.all && p.offM <= GUIDE.onLineM / 2) {
    for (let s = 1; s < n - 1; s++) if (p.stopAlong[s] > p.alongM + 30) return s;
    return n - 1;
  }
  for (let s = 1; s < n - 1; s++) if (stops[s].est > c.now) return s;
  return n - 1;
}

function locate(c: Ctx): Loc {
  const { legs, now, m, j } = c;
  const L = legs.length;
  const kind = c.in.kind;
  // 1. l'heure : la première étape pas finie
  let i = legs.findIndex((l) => l.arr > now);
  if (i < 0) i = L - 1;
  // 2. constatations
  if (m.alighted && m.alighted.leg + 1 > i) i = Math.min(L - 1, m.alighted.leg + 1);
  if (m.boarded && !alightedFrom(m, m.boarded.leg)) {
    const b = m.boarded.leg;
    if (b > i) i = b;
    else if (b < i && (riding(c, b) || (fast(c) && distTo(c, legs[b].to) > GUIDE.alightNearM))) i = b;
  }
  // jamais monté, encore à l'arrêt de montée d'un véhicule déjà passé d'après l'heure : on y attend (raté ou en retard)
  const k0 = nextRide(legs, Math.max(m.alighted?.leg ?? -1, m.boarded?.leg ?? -1) + 1);
  if (k0 >= 0 && k0 < i && !boardedOn(m, k0) && now >= legs[k0].dep && stillAtStop(c, k0)) i = k0;
  const l = legs[i];
  if (l.kind === 'walk') {
    const k = legs[i + 1]?.kind === 'ride' ? i + 1 : -1;
    if (i === 0 && kind === 'trip' && now < j.leaveAt && !c.started) return { phase: { kind: 'before', leg: 0 }, leg: 0 };
    // déjà à l'arrêt d'après la position (à vol d'oiseau, jamais d'après le chemin gardé : voir walkingStill) : on attend
    if (k >= 0 && c.fix && !walkingStill(c, i) && (distTo(c, l.to) <= GUIDE.stopM || now >= l.arr)) {
      return { phase: { kind: 'wait', leg: k }, leg: k };
    }
    return { phase: { kind: 'walk', leg: i }, leg: i };
  }
  // étape en véhicule
  const started = boardedOn(m, i) || (now >= l.dep && !l.cancelled && !stillAtStop(c, i));
  if (started) return { phase: { kind: 'ride', leg: i, next: nextStopOf(c, i) }, leg: i };
  // pas encore monté : la marche d'avant continue-t-elle (position) ?
  if (i > 0 && legs[i - 1].kind === 'walk' && now < l.dep && walkingStill(c, i - 1) && !boardedOn(m, i)) {
    if (i - 1 === 0 && kind === 'trip' && now < j.leaveAt && !c.started) return { phase: { kind: 'before', leg: 0 }, leg: 0 };
    return { phase: { kind: 'walk', leg: i - 1 }, leg: i - 1 };
  }
  // trajet qui commence par un véhicule : avant, tant que le départ est loin et qu'on n'est pas à l'arrêt
  if (i === 0 && kind === 'trip' && now < l.dep - GUIDE.boardAheadMs && !(c.fix && distTo(c, l.from) <= atStopM(l))) {
    return { phase: { kind: 'before', leg: 0 }, leg: 0 };
  }
  return { phase: { kind: 'wait', leg: i }, leg: i };
}

/* ------------------------------ Recalcul ------------------------------ */

/** Correspondance devenue impossible (même règle que brokenConnection : un retard gardé n'y compte pas). */
function brokenAt(legs: Leg[], k: number): boolean {
  const p = prevRide(legs, k);
  if (p < 0) return false;
  const a = legs[p];
  const b = legs[k];
  let walk = 0;
  for (let i = p + 1; i < k; i++) if (legs[i].kind === 'walk') walk += (legs[i].walkMin ?? 0) * MIN;
  return (b.rtKept ? b.schedDep : b.dep) < (a.rtKept ? a.schedArr : a.arr) + walk;
}

/** D'où chercher un nouveau trajet : là où l'on est (à bord : là où le véhicule nous dépose). */
function replanFrom(c: Ctx, loc: Loc, k: number): { from: Pending['from']; at: number } {
  const { legs, now } = c;
  const ph = loc.phase;
  if (ph.kind === 'ride' && ph.leg < k) return { from: place(legs[ph.leg].to), at: Math.max(now, legs[ph.leg].arr) };
  const l = legs[k];
  if (c.fix) {
    if (distTo(c, l.from) <= atStopM(l)) return { from: place(l.from), at: now };
    return { from: { lat: c.fix.lat, lon: c.fix.lon }, at: now };
  }
  if (ph.kind === 'before') {
    const o = c.in.origin;
    if (knownPoint(o)) return { from: { lat: o.lat, lon: o.lon }, at: now };
    return { from: place(legs[0].from), at: now };
  }
  if (ph.kind === 'walk') return { from: place(legs[ph.leg].to), at: now };
  if (ph.kind === 'wait') return { from: place(legs[ph.leg].from), at: now };
  return { from: place(l.from), at: now };
}

function pending(c: Ctx, loc: Loc, reason: ReplanReason, k: number): Pending {
  const l = c.legs[k];
  const { from, at } = replanFrom(c, loc, k);
  const p: Pending = { reason, jid: c.j.id, leg: k, t: c.now, from, at, lost: { vehicle: vehicleRef(l), depAt: l.schedDep }, oldArr: c.j.arr };
  const b = c.m.boarded;
  if (b && boardedOn(c.m, b.leg) && loc.phase.kind === 'ride' && loc.phase.leg === b.leg) {
    const r = c.legs[b.leg];
    p.onBoard = { ...(r.tripId ? { tripId: r.tripId } : {}), schedDep: r.schedDep, at: b.at };
  }
  return p;
}

/** Arrêt de descente dépassé (à bord, plus de 300 m au-delà, en s'éloignant, après son heure). */
function passedAt(c: Ctx, loc: Loc): number {
  const { m } = c;
  if (!c.fix) return -1;
  const cands: number[] = [];
  if (loc.phase.kind === 'ride') cands.push(loc.phase.leg);
  // descente constatée (immobile à quai), puis on roule : peut-être resté dans ce véhicule, même quand l'heure dit déjà
  // le véhicule suivant (pas encore monté dedans)
  if (m.alighted && fast(c) && !cands.includes(m.alighted.leg) && !(loc.phase.kind === 'ride' && boardedOn(m, loc.phase.leg))) cands.push(m.alighted.leg);
  for (const k of cands) if (passedLeg(c, k)) return k;
  return -1;
}

/** L'arrêt de descente de l'étape `k` est-il dépassé (voir passedAt) ? */
function passedLeg(c: Ctx, k: number): boolean {
  const { legs, now, m } = c;
  const fix = c.fix as GuideFix;
  const l = legs[k];
  if (!knownPoint(l.to) || now < l.arr) return false;
  const d = distanceM(fix, l.to);
  if (d <= GUIDE.passedM) return false;
  // au-delà : de l'autre côté de l'arrêt, dans le sens de la marche du véhicule
  const stops = stopsOf(l);
  const pts = stopPoints(l, stops);
  let before: LatLon | undefined;
  for (let s = pts.length - 2; s >= 0 && !before; s--) before = pts[s];
  if (before) {
    const kx = Math.cos(l.to.lat * (Math.PI / 180));
    const vx = (l.to.lon - before.lon) * kx;
    const vy = l.to.lat - before.lat;
    const wx = (fix.lon - l.to.lon) * kx;
    const wy = fix.lat - l.to.lat;
    if (vx * wx + vy * wy <= 0) {
      // pas dans le sens d'arrivée : encore le long de la ligne avant l'arrêt (véhicule en retard), ou bien le véhicule
      // a tourné après l'arrêt (Schuman → Bruxelles-Nord, puis Bruxelles-Central) : au-delà s'il est loin de la ligne
      const pr = rideProj(c, l);
      if (!pr || pr.offM <= GUIDE.passedM) return false;
    }
  }
  // en s'éloignant
  const away = c.prev ? distanceM(c.prev, l.to) < d - 5 : fast(c);
  if (!away) return false;
  // pas monté dans le véhicule suivant (il s'éloigne aussi)
  const nk = nextRide(legs, k + 1);
  if (nk >= 0 && boardedOn(m, nk)) return false;
  return true;
}

/** Causes d'un nouveau trajet, dans l'ordre : supprimé, correspondance ratée, raté, arrêt dépassé. */
function detect(c: Ctx, loc: Loc): void {
  const { legs, now, m, j } = c;
  if (!c.guided) return;
  if (loc.phase.kind === 'arrived' || loc.phase.kind === 'ended') return;
  const kind = c.in.kind;
  const done = (k: number) => alightedFrom(m, k) || (now >= legs[k].arr && !boardedOn(m, k));
  const firstOpen = (() => {
    const cur = loc.phase.kind === 'ride' ? loc.phase.leg + 1 : loc.leg;
    return nextRide(legs, Math.max(0, cur));
  })();
  let found: Pending | null = null;
  // supprimé : un véhicule à venir (pas encore monté)
  for (let k = firstOpen; k >= 0 && !found; k = nextRide(legs, k + 1)) {
    if (legs[k].cancelled && !boardedOn(m, k) && now < legs[k].schedArr) found = pending(c, loc, 'cancelled', k);
  }
  // correspondance devenue impossible (retard)
  if (!found && kind === 'trip') {
    for (let k = firstOpen; k >= 0 && !found; k = nextRide(legs, k + 1)) {
      // déjà à l'arrêt d'après la position (attente) : la correspondance est faite
      const there = loc.phase.kind === 'wait' && loc.phase.leg === k;
      if (!there && !boardedOn(m, k) && !done(k) && now < legs[k].dep + GUIDE.boardAfterMs && brokenAt(legs, k)) found = pending(c, loc, 'late', k);
    }
  }
  // véhicule raté : encore à l'arrêt 2 min après son départ (10 min sans temps réel)
  if (!found && c.fix && loc.phase.kind === 'wait') {
    const k = loc.phase.leg;
    const l = legs[k];
    const wait = l.rt ? GUIDE.missedMs : GUIDE.missedPlannedMs;
    if (!l.cancelled && !boardedOn(m, k) && now >= l.dep + wait && stillAtStop(c, k)) found = pending(c, loc, 'missed', k);
  }
  // arrêt dépassé
  if (!found) {
    const k = passedAt(c, loc);
    if (k >= 0) {
      found = pending(c, loc, 'passed', k);
      // l'arrêt suivant du véhicule (arrêts suivants connus) : où descendre, et d'où chercher le nouveau trajet, à son
      // heure ; sans lui, depuis la position (jamais mieux que l'arrêt : elle est dans le véhicule)
      const nx = beyondOf(c, k).find((s) => s.est >= now - 30 * SEC);
      if (nx) {
        found.getOff = nx.name;
        found.getOffAt = nx.est;
      }
      if (nx && knownPoint(nx)) {
        found.from = { lat: nx.lat, lon: nx.lon, ...(nx.areaId ? { areaId: nx.areaId } : {}), name: nx.name };
        found.at = Math.max(now, nx.est);
      } else {
        found.from = { lat: c.fix!.lat, lon: c.fix!.lon };
        found.at = now;
      }
      found.passed = legs[k].to.name;
      if (legs[k].tripId) found.tripId = legs[k].tripId;
      if (kind === 'ride') found.local = true;
      if (m.alighted && m.alighted.leg >= k) delete m.alighted;
      m.boarded = { leg: k, at: m.boarded?.leg === k ? m.boarded.at : now };
    }
  }
  const same = (a: Pending, b: Pending) => a.jid === b.jid && a.reason === b.reason && a.leg === b.leg;
  if (found) {
    if (!(m.re && same(m.re, found))) m.re = found;
    return;
  }
  // cause disparue avant le nouveau trajet (temps réel revenu) : oubliée
  if (m.re && m.re.jid === j.id && !m.re.swap && m.re.none === undefined && (m.re.reason === 'cancelled' || m.re.reason === 'late')) delete m.re;
}

/* ------------------------------ Moments ------------------------------ */

const PRIO: Record<Moment['kind'], number> = { replan: 0, passed: 1, alight: 2, platform: 3, board: 4, turn: 5, leave: 6, nextStop: 7, arrived: 8 };

interface Cand {
  id: string;
  kind: Moment['kind'];
  /** le déclencheur tient maintenant (un moment déjà montré reste jusqu'à sa fin) */
  trig: boolean;
  /** fin automatique atteinte */
  end: boolean;
  make: (since: number) => Moment;
}

/** Prochaine étape en véhicule à prendre (pas encore montée). */
function rideToBoard(c: Ctx, loc: Loc): number {
  const ph = loc.phase;
  if (ph.kind === 'wait') return ph.leg;
  if (ph.kind === 'walk' || ph.kind === 'before') return nextRide(c.legs, ph.leg);
  if (ph.kind === 'ride') return nextRide(c.legs, ph.leg + 1);
  return -1;
}

/** Étape en véhicule arrivée il y a moins de 2 min (d'après l'heure), descente pas encore constatée ; -1 sinon. */
function justArrived(c: Ctx): number {
  const { legs, now, m } = c;
  for (let k = legs.length - 1; k >= 0; k--) {
    const l = legs[k];
    if (l.kind !== 'ride') continue;
    if (l.arr > now) continue;
    if (now >= l.arr + GUIDE.alightAfterMs || alightedFrom(m, k) || l.cancelled) return -1;
    const nk = nextRide(legs, k + 1);
    return nk >= 0 && boardedOn(m, nk) ? -1 : k;
  }
  return -1;
}

/** Heure où « Descends au prochain arrêt » apparaît (Infinity : pas encore, d'après la position). */
function alightTrigAt(c: Ctx, k: number): number {
  const l = c.legs[k];
  const stops = stopsOf(l);
  const n = stops.length;
  const floor = l.arr - GUIDE.alightNotBeforeMs;
  if (n <= 2) return Math.max(l.dep + GUIDE.alightEstMs, floor);
  const p = rideProj(c, l);
  if (p && p.all && p.offM <= GUIDE.onLineM / 2) {
    const left = p.alongM > p.stopAlong[n - 2] + GUIDE.leftStopM && !slowAt(c, p);
    return left ? Math.max(c.now, floor) : Infinity;
  }
  return Math.max(stops[n - 2].est + GUIDE.alightEstMs, floor);
}
/** Arrêté à un arrêt intermédiaire (position au pas, tout près d'un arrêt) : le véhicule n'est pas encore reparti. */
function slowAt(c: Ctx, p: { alongM: number; stopAlong: number[] }): boolean {
  if (c.speed === undefined || c.speed >= GUIDE.walkMaxMs) return false;
  return p.stopAlong.some((a, s) => s > 0 && Math.abs(a - p.alongM) <= GUIDE.leftStopM && s < p.stopAlong.length - 1);
}

function thenOf(legs: Leg[], k: number): Then {
  const a = legs[k + 1];
  if (!a) return { kind: 'none' };
  const rideThen = (r: Leg, walkMin: number): Then => {
    const t: Then = { kind: 'ride', vehicle: vehicleRef(r), depAt: r.dep, rt: !!r.rt, walkMin };
    const p = platformOf(r);
    if (p && isTrain(r)) t.platform = p;
    return t;
  };
  if (a.kind === 'ride') return rideThen(a, 0);
  const b = legs[k + 2];
  if (b && b.kind === 'ride') return rideThen(b, walkMinOf(a));
  return { kind: 'walk', min: walkMinOf(a), toward: a.to.name, last: !b };
}

/** Marche restante en minutes (80 m/min sur le chemin, détours comptés sur une ligne droite). */
function minutesFor(m: number, straight: boolean): number {
  if (m <= 0) return 0;
  return Math.ceil((straight ? m * 1.3 : m) / GUIDE.walkMPerMin);
}

function candidates(c: Ctx, loc: Loc): Cand[] {
  const { legs, now, m, j } = c;
  const jid = j.id;
  const out: Cand[] = [];
  const shown = (id: string) => m.shown[id] !== undefined;
  const ph = loc.phase;

  // recalcul : supprimé, correspondance ratée, raté ; puis arrêt dépassé
  const re = m.re;
  if (re && re.reason !== 'passed') {
    const base = `replan:${re.jid}:${re.reason}:${re.leg}`;
    const lost = re.lost;
    const reason = re.reason as 'missed' | 'cancelled' | 'late';
    if (re.swap && re.swap.jid === jid) {
      // premier véhicule du nouveau trajet (pas celui où l'on est encore, gardé devant par replanJourney)
      let k = nextRide(legs, 0);
      while (k >= 0 && (boardedOn(m, k) || legs[k].dep < re.at - GUIDE.boardAfterMs)) k = nextRide(legs, k + 1);
      const r = k >= 0 ? legs[k] : undefined;
      const swapAt = re.swap.at;
      out.push({
        id: `${base}:${jid}`, kind: 'replan', trig: now < swapAt + GUIDE.replanMs, end: now >= swapAt + GUIDE.replanMs,
        make: (since) => ({
          kind: 'replan', id: `${base}:${jid}`, since, until: swapAt + GUIDE.replanMs, leg: Math.max(0, k), reason, lost,
          ...(r ? { next: { vehicle: vehicleRef(r), depAt: r.dep, ...(isTrain(r) && platformOf(r) ? { platform: platformOf(r) } : {}) } } : {}),
          arr: j.arr, laterMin: roundMin(j.arr - re.oldArr),
        }),
      });
    } else if (re.jid === jid && re.none !== undefined) {
      const none = re.none;
      out.push({
        id: `${base}:none`, kind: 'replan', trig: now < none + GUIDE.replanMs, end: now >= none + GUIDE.replanMs,
        make: (since) => ({ kind: 'replan', id: `${base}:none`, since, until: none + GUIDE.replanMs, leg: re.leg, reason, lost, none: true }),
      });
    } else if (re.jid === jid) {
      const until = re.t + GUIDE.replanMs;
      out.push({
        id: base, kind: 'replan', trig: now < until, end: now >= until,
        make: (since) => ({ kind: 'replan', id: base, since, until, leg: re.leg, reason, lost }),
      });
    }
  }
  if (re && re.reason === 'passed' && (re.jid === jid || re.swap?.jid === jid) && re.passed) {
    const id = `passed:${re.jid}:${re.leg}`;
    const since0 = m.shown[id] ?? now;
    const until = since0 + GUIDE.passedMs;
    let getOff: Names = { fr: '', nl: '' };
    let at = 0;
    const next = re.swap ? undefined : beyondOf(c, re.leg).find((s) => s.est >= now - 30 * SEC);
    if (re.getOff) {
      // l'arrêt suivant noté à la détection (arrêts suivants du véhicule) : le même, avant et après le nouveau trajet
      getOff = re.getOff;
      at = re.getOffAt ?? 0;
    } else if (next) {
      getOff = next.name;
      at = next.est;
    } else if (re.swap?.jid === jid && legs[0]) {
      // nouveau trajet : il commence là où descendre (ou par le même véhicule, jusqu'à là où descendre) ; cherché depuis
      // la position (« Ma position », sans zone), sa marche de départ ne dit pas où descendre : rien plutôt qu'un faux nom
      const l0 = legs[0];
      const same = l0.kind === 'ride' && !!re.tripId && l0.tripId === re.tripId;
      if (same || l0.kind === 'ride' || l0.from.areaId) {
        getOff = same ? l0.to.name : l0.from.name;
        at = same ? l0.arr : l0.dep;
      }
    }
    const passedName = re.passed;
    out.push({
      id, kind: 'passed', trig: now < re.t + GUIDE.passedMs, end: now >= until,
      make: (since) => ({ kind: 'passed', id, since, until: since + GUIDE.passedMs, leg: re.leg, passed: passedName, getOff, at, ...(re.swap?.jid === jid ? { arr: j.arr } : {}) }),
    });
  }

  // à bord : « Descends au prochain arrêt » (jusqu'à l'arrivée + 2 min, l'heure passée comprise), « Prochain arrêt »
  const ak = ph.kind === 'ride' ? ph.leg : justArrived(c);
  if (ak >= 0) {
    const k = ak;
    const l = legs[k];
    const id = `alight:${jid}:${k}`;
    const trigAt = alightTrigAt(c, k);
    const holdOn = boardedOn(m, k) && riding(c, k);
    const end = alightedFrom(m, k) || (now >= l.arr + GUIDE.alightAfterMs && !holdOn);
    out.push({
      id, kind: 'alight', trig: now >= trigAt, end,
      make: (since) => ({ kind: 'alight', id, since, until: Math.max(l.arr + GUIDE.alightAfterMs, since), leg: k, stop: l.to.name, at: l.arr, rt: !!l.rt, then: thenOf(legs, k) }),
    });
  }
  if (ph.kind === 'ride') {
    const k = ph.leg;
    const l = legs[k];
    const trigAt = alightTrigAt(c, k);
    if (isTrain(l) && l.arr - l.dep >= GUIDE.nextStopRideMs) {
      const stops = stopsOf(l);
      const n = stops.length;
      const quietFrom = (Number.isFinite(trigAt) ? Math.min(trigAt, l.arr - GUIDE.alightNotBeforeMs) : l.arr - GUIDE.alightNotBeforeMs) - GUIDE.nextStopQuietMs;
      for (let s = Math.max(1, ph.next - 1); s < n - 1; s++) {
        const st = stops[s];
        const from = st.est - GUIDE.nextStopBeforeMs;
        const until = st.est + GUIDE.nextStopAfterMs;
        const sid = `nextStop:${jid}:${k}:${s}`;
        if (now < from - 1 && !shown(sid)) break;
        const gapOk = m.lastNextStopAt === undefined || now - m.lastNextStopAt >= GUIDE.nextStopGapMs;
        out.push({
          id: sid, kind: 'nextStop', trig: now >= from && now < until && gapOk && now < quietFrom, end: now >= until,
          // arrêts jusqu'à la descente, le prochain compris (comme « Où tu en es » et l'exemple du PRD : « Prochain
          // arrêt : Louvain », « descente dans 3 arrêts, à Bruxelles-Central »)
          make: (since) => ({ kind: 'nextStop', id: sid, since, until, leg: k, stop: st.name, at: st.est, rt: !!l.rt, stopsToAlight: n - s, alight: l.to.name }),
        });
      }
    }
  }

  // monter (jusqu'au départ + 1 min, même parti d'après l'heure tant que la montée n'est pas constatée), voie modifiée
  const toBoard = rideToBoard(c, loc);
  const boardLegs = toBoard >= 0 ? [toBoard] : [];
  if (ph.kind === 'ride' && !boardedOn(m, ph.leg) && now < legs[ph.leg].dep + GUIDE.boardAfterMs) boardLegs.unshift(ph.leg);
  for (const k of boardLegs) {
    if (legs[k].cancelled) continue;
    const l = legs[k];
    const plat = platformOf(l);
    const id = `board:${jid}:${k}:${plat ?? ''}`;
    const trig = ph.kind === 'wait' && ph.leg === k && l.dep - now <= GUIDE.boardAheadMs && now < l.dep + GUIDE.boardAfterMs;
    const end = boardedOn(m, k) || now >= l.dep + GUIDE.boardAfterMs;
    const p = prevRide(legs, k);
    const stops = l.stops && l.stops.length >= 2 ? l.stops.length - 1 : 0;
    const board: Cand = {
      id, kind: 'board', trig, end,
      make: (since) => {
        const mo: Moment = { kind: 'board', id, since, until: l.dep + GUIDE.boardAfterMs, leg: k, vehicle: vehicleRef(l), head: l.head ?? l.to.name, depAt: l.dep, rt: !!l.rt, alight: l.to.name, stopsToAlight: stops };
        // voie : trains seulement (panneau « voie » ; un quai de bus n'en est pas une)
        if (plat && isTrain(l)) mo.platform = plat;
        if (platformChanged(l) && isTrain(l)) mo.platformChanged = true;
        if (p >= 0) {
          const w = legs[k - 1].kind === 'walk' && k - 1 > p ? legs[k - 1] : undefined;
          const walkMin = w && now < w.arr ? walkMinOf(w) : undefined;
          if (walkMin !== undefined) mo.walkMin = walkMin;
          mo.marginMin = Math.floor((l.dep - Math.max(now, legs[p].arr)) / MIN) - (walkMin ?? 0);
        }
        return mo;
      },
    };
    out.push(board);
    const boardLive = !board.end && (board.trig || shown(id));
    if (k === toBoard && isTrain(l) && platformChanged(l) && !boardLive && !m.dismissed.includes(id) && !boardedOn(m, k) && now < l.dep) {
      const pid = `platform:${jid}:${k}:${l.newPlatform}`;
      const since0 = m.shown[pid] ?? now;
      out.push({
        id: pid, kind: 'platform', trig: true, end: now >= since0 + GUIDE.platformMs,
        make: (since) => ({ kind: 'platform', id: pid, since, until: since + GUIDE.platformMs, leg: k, vehicle: vehicleRef(l), depAt: l.dep, platform: l.newPlatform as string, ...(l.platform ? { was: l.platform } : {}) }),
      });
    }
  }

  // virages de la marche en cours ; en attente (à 60 m de l'arrêt à vol d'oiseau), ceux qui restent sur le chemin de la
  // marche d'avant, derrière « monter » (priorité inchangée)
  const tw = ph.kind === 'walk' ? ph.leg : ph.kind === 'wait' && ph.leg > 0 && legs[ph.leg - 1].kind === 'walk' ? ph.leg - 1 : -1;
  if (tw >= 0 && c.fix && c.walkPr && c.walkPr.leg === tw && c.walkPr.offM <= GUIDE.offRouteM) {
    const w = tw;
    const wl = legs[w];
    const route = c.walkPr.route;
    const along = c.walkPr.alongM;
    const reach = Math.max(GUIDE.turnM, (c.speed ?? 0) * GUIDE.turnS);
    const until = c.fix.at + GUIDE.freshMs;
    for (const t of turnsOf(route, cumulative(routePoints(route)))) {
      const id = `turn:${jid}:${w}:${t.i}:${route.builtAt}`;
      const end = along >= t.alongM + GUIDE.turnAfterM;
      const trig = !end && t.alongM - along <= reach;
      if (!trig && !shown(id)) continue;
      out.push({
        id, kind: 'turn', trig, end,
        make: (since) => ({ kind: 'turn', id, since, until, leg: w, turn: t.m.turn, distM: Math.max(0, Math.round(t.alongM - along)), ...(t.m.street ? { street: t.m.street } : {}), toward: wl.to.name, final: w === legs.length - 1 }),
      });
    }
  }

  // partir
  if (c.in.kind === 'trip' && legs[0]?.kind === 'walk' && (ph.kind === 'before' || (ph.kind === 'walk' && ph.leg === 0))) {
    const w = legs[0];
    const at = Math.max(j.leaveAt, c.in.startedAt);
    const id = `leave:${jid}`;
    const r = legs[1]?.kind === 'ride' ? legs[1] : undefined;
    out.push({
      id, kind: 'leave', trig: now >= at, end: c.started || now >= at + GUIDE.leaveMs,
      make: (since) => {
        const walkMin = walkMinOf(w);
        const mo: Moment = { kind: 'leave', id, since, until: at + GUIDE.leaveMs, leg: 0, walkMin, toward: w.to.name };
        if (r) {
          // marge exacte (en minutes, avec les secondes) : 2 min de marge ne deviennent pas « très juste » une seconde
          // après l'apparition (1,98 arrondi à 1) ; très juste : 60 s au plus
          const exact = (r.dep - now) / MIN - walkMin;
          const margin = Math.floor(exact);
          mo.vehicle = vehicleRef(r);
          mo.depAt = r.dep;
          mo.rt = !!r.rt;
          mo.marginMin = margin;
          if (exact <= GUIDE.tightMin) {
            mo.tight = true;
            if (c.in.missed) mo.missed = { ...c.in.missed };
          }
        }
        return mo;
      },
    });
  }

  // arrivée
  if (ph.kind === 'arrived') {
    const id = `arrived:${jid}`;
    const since0 = m.shown[id] ?? now;
    const lastArr = legs[legs.length - 1]?.schedArr ?? j.arr;
    out.push({
      id, kind: 'arrived', trig: true, end: now >= since0 + GUIDE.arrivedMs,
      make: (since) => {
        const at = m.arrivedByFix ? (m.arrivedAt ?? since) : j.arr;
        return { kind: 'arrived', id, since, until: since + GUIDE.arrivedMs, leg: legs.length - 1, title: c.in.title, at, diffMin: roundMin(at - lastArr) };
      },
    });
  }
  return out;
}

/** Choisit le moment : le plus prioritaire de ceux qui tiennent, ni effacés ni finis ; range ceux qui sont finis. */
function pick(c: Ctx, cands: Cand[]): Moment | null {
  const m = c.m;
  const live = cands.filter((x) => !x.end && (x.trig || m.shown[x.id] !== undefined));
  const liveIds = new Set(live.map((x) => x.id));
  if (m.cur && !liveIds.has(m.cur) && !m.dismissed.includes(m.cur)) m.dismissed.push(m.cur);
  const vis = live.filter((x) => !m.dismissed.includes(x.id));
  vis.sort((a, b) => PRIO[a.kind] - PRIO[b.kind]);
  const top = vis[0];
  if (!top) {
    delete m.cur;
    return null;
  }
  const fresh = m.shown[top.id] === undefined;
  if (fresh) m.shown[top.id] = c.now;
  if (fresh && top.kind === 'nextStop') m.lastNextStopAt = c.now;
  m.cur = top.id;
  return top.make(m.shown[top.id]);
}

/* ------------------------------ Où tu en es ------------------------------ */

function chainOf(c: Ctx, loc: Loc): WhereAmI['chain'] {
  const { legs } = c;
  const ph = loc.phase;
  const out: WhereAmI['chain'] = [];
  const doneAll = ph.kind === 'arrived' || ph.kind === 'ended';
  const rides = legs.map((l, i) => (l.kind === 'ride' ? i : -1)).filter((i) => i >= 0);
  if (legs[0]?.kind === 'walk') {
    const state = doneAll || loc.leg > 0 ? 'done' : ph.kind === 'walk' ? 'now' : 'next';
    out.push({ label: 'à pied', state });
  }
  // véhicule en cours : celui où l'on est, qu'on attend, ou vers lequel on marche (correspondance)
  let now = -1;
  if (ph.kind === 'ride' || ph.kind === 'wait') now = ph.leg;
  else if (ph.kind === 'walk' && ph.leg > 0) now = nextRide(legs, ph.leg);
  for (const k of rides) {
    const state = doneAll || (now >= 0 ? k < now : false) || (now < 0 && ph.kind === 'walk' && ph.leg > k) ? 'done' : k === now ? 'now' : 'next';
    out.push({ label: rideName(legs[k]), state });
  }
  return out;
}

function whereOf(c: Ctx, loc: Loc): WhereAmI {
  const { legs, now, j } = c;
  const w: WhereAmI = { title: c.in.title, arr: j.arr, rt: !!j.rt, chain: chainOf(c, loc) };
  const ph = loc.phase;
  const waitOf = (k: number): NonNullable<WhereAmI['wait']> => {
    const l = legs[k];
    const out: NonNullable<WhereAmI['wait']> = { stop: l.from.name, vehicle: vehicleRef(l), head: l.head ?? l.to.name, depAt: l.dep, rt: !!l.rt };
    const p = platformOf(l);
    if (p && isTrain(l)) out.platform = p;
    if (platformChanged(l) && isTrain(l)) out.platformChanged = true;
    return out;
  };
  if ((ph.kind === 'before' || ph.kind === 'walk') && legs[ph.leg]?.kind === 'walk') {
    const i = ph.leg;
    const wl = legs[i];
    const r = legs[i + 1]?.kind === 'ride' ? legs[i + 1] : undefined;
    const toKind: NonNullable<WhereAmI['walk']>['toKind'] = !r ? 'dest' : isTrain(r) ? (i > 0 && legs[i - 1].kind === 'ride' && platformOf(r) ? 'platform' : 'station') : 'stop';
    let remainingM: number | undefined;
    let remainingMin: number;
    const pr = c.walkPr?.leg === i ? c.walkPr : undefined;
    if (c.fix && ph.kind === 'walk' && pr) {
      remainingM = pr.remainingM;
      remainingMin = minutesFor(pr.remainingM, pr.route.source === 'straight');
    } else if (c.fix && ph.kind === 'walk' && knownPoint(wl.to)) {
      remainingM = distanceM(c.fix, wl.to);
      remainingMin = minutesFor(remainingM, true);
    } else if (ph.kind === 'before') {
      remainingMin = walkMinOf(wl);
    } else {
      remainingMin = Math.max(0, Math.ceil((wl.arr - now) / MIN));
    }
    const walk: NonNullable<WhereAmI['walk']> = { toward: wl.to.name, toKind, remainingMin };
    if (remainingM !== undefined) walk.remainingM = Math.round(remainingM);
    if (r) {
      walk.vehicle = vehicleRef(r);
      walk.depAt = r.dep;
      walk.rt = !!r.rt;
      walk.marginMin = Math.floor((r.dep - now) / MIN) - remainingMin;
    }
    if (pr && pr.route.source === 'osm' && c.fix) {
      const nx = walkProgress(pr.route, c.fix).next;
      if (nx) walk.next = { turn: nx.m.turn, distM: Math.round(nx.distM) };
    }
    if (c.fix && ph.kind === 'walk' && (!pr || pr.route.source === 'straight') && Number.isFinite(c.fix.heading) && knownPoint(wl.to)) {
      walk.bearingDeg = Math.round(relativeDeg(bearingDeg(c.fix, wl.to), c.fix.heading as number));
    }
    w.walk = walk;
  } else if (ph.kind === 'before' && legs[ph.leg]?.kind === 'ride') {
    w.wait = waitOf(ph.leg);
  } else if (ph.kind === 'wait') {
    w.wait = waitOf(ph.leg);
  } else if (ph.kind === 'ride') {
    const l = legs[ph.leg];
    const stops = stopsOf(l);
    const n = stops.length;
    const next = Math.min(n - 1, Math.max(1, ph.next));
    w.ride = {
      vehicle: vehicleRef(l),
      ...(l.head ? { head: l.head } : {}),
      total: n,
      next,
      nextStop: stops[next].name,
      nextAt: stops[next].est,
      alight: l.to.name,
      alightAt: l.arr,
      stopsToAlight: n - next,
      rt: !!l.rt,
    };
  }
  return w;
}

/* ------------------------------ Position, réveil, chemin ------------------------------ */

function locationOf(c: Ctx, loc: Loc): LocationNeed {
  const { legs, now, j } = c;
  const ph = loc.phase;
  let need: LocationNeed = 'off';
  if (ph.kind === 'before') {
    const at = legs[0]?.kind === 'walk' ? j.leaveAt : legs[0] ? legs[0].dep - GUIDE.boardAheadMs : j.leaveAt;
    need = now >= at - GUIDE.mediumBeforeMs ? 'medium' : 'off';
  } else if (ph.kind === 'walk') need = 'high';
  else if (ph.kind === 'wait') {
    const l = legs[ph.leg];
    need = l.dep - now <= GUIDE.boardAheadMs || now >= l.dep ? 'high' : 'medium';
  } else if (ph.kind === 'ride') {
    const n = stopsOf(legs[ph.leg]).length;
    need = ph.next >= n - 1 ? 'high' : 'medium';
  }
  // suivi sans messages (réglage éteint) : jamais la plus haute précision
  if (!c.guided && need === 'high') need = 'medium';
  return need;
}

function needRouteOf(c: Ctx, loc: Loc): GuideState['needRoute'] {
  if (!c.guided) return undefined;
  const { legs } = c;
  const ph = loc.phase;
  if (ph.kind === 'arrived' || ph.kind === 'ended') return undefined;
  // en attente, encore sur le chemin de la marche d'avant avec un virage devant : ce chemin reste (ses virages derrière
  // « monter ») ; celui de la marche suivante attendra
  if (ph.kind === 'wait' && ph.leg > 0 && legs[ph.leg - 1].kind === 'walk' && turnAhead(c, ph.leg - 1)) return undefined;
  const from = ph.kind === 'ride' ? ph.leg + 1 : loc.leg;
  let w = -1;
  for (let i = Math.max(0, from); i < legs.length; i++) {
    if (legs[i].kind === 'walk') {
      w = i;
      break;
    }
    if (i > from && legs[i].kind === 'ride') break;
  }
  if (w < 0) return undefined;
  const wl = legs[w];
  if (!knownPoint(wl.to)) return undefined;
  const walking = ph.kind === 'walk' && ph.leg === w;
  const start = walking && c.fix ? { lat: c.fix.lat, lon: c.fix.lon } : w === 0 && knownPoint(c.in.origin) ? { lat: c.in.origin.lat, lon: c.in.origin.lon } : knownPoint(wl.from) ? { lat: wl.from.lat, lon: wl.from.lon } : undefined;
  if (!start) return undefined;
  const have = c.in.walk;
  const haveIt = !!have && have.leg === w && !!have.route && distanceM(have.route.to, wl.to) <= 30;
  if (haveIt && walking && offRouteLong(c, have!.route)) return { leg: w, from: start, to: { lat: wl.to.lat, lon: wl.to.lon } };
  if (haveIt) return undefined;
  return { leg: w, from: start, to: { lat: wl.to.lat, lon: wl.to.lon } };
}

/** Sur le chemin gardé de la marche `w` (30 m au plus), avec un virage encore devant (pas fini). */
function turnAhead(c: Ctx, w: number): boolean {
  const pr = c.walkPr;
  if (!c.fix || !pr || pr.leg !== w || pr.offM > GUIDE.offRouteM) return false;
  return turnsOf(pr.route, cumulative(routePoints(pr.route))).some((t) => t.alongM + GUIDE.turnAfterM > pr.alongM);
}

/** Hors du chemin de plus de 30 m pendant 10 s (toutes les positions de ces 10 s, la plus ancienne il y a 10 s ou plus). */
function offRouteLong(c: Ctx, route: WalkRoute): boolean {
  if (!c.fix) return false;
  const good = fixesOf(c.in).filter((f) => f.at <= c.fix!.at);
  const pts = routePoints(route);
  const cum = cumulative(pts);
  let oldest = Infinity;
  for (let i = good.length - 1; i >= 0; i--) {
    const f = good[i];
    if (projectOn(pts, f, cum).offM <= GUIDE.offRouteM) return false;
    oldest = f.at;
    if (c.fix.at - f.at >= GUIDE.offRouteMs) return true;
  }
  return c.fix.at - oldest >= GUIDE.offRouteMs;
}

function wakeOf(c: Ctx, moment: Moment | null): number {
  const { legs, now, j, m } = c;
  let best = now + GUIDE.wakeMaxMs;
  const add = (t: number | undefined) => {
    if (t !== undefined && Number.isFinite(t) && t > now && t < best) best = t;
  };
  add(j.leaveAt - GUIDE.mediumBeforeMs);
  add(j.leaveAt);
  add(Math.max(j.leaveAt, c.in.startedAt) + GUIDE.leaveMs);
  for (const l of legs) {
    add(l.dep);
    add(l.arr);
    if (l.kind !== 'ride') continue;
    for (const t of [l.dep - GUIDE.boardAheadMs, l.dep + GUIDE.boardAfterMs, l.dep + GUIDE.missedMs, l.dep + GUIDE.missedPlannedMs, l.dep + GUIDE.alightEstMs, l.arr - GUIDE.alightNotBeforeMs, l.arr + GUIDE.alightAfterMs]) add(t);
    for (const s of l.stops ?? []) {
      add(s.est - GUIDE.nextStopBeforeMs);
      add(s.est + GUIDE.alightEstMs);
      add(s.est + GUIDE.nextStopAfterMs);
    }
  }
  add(j.arr + GUIDE.endAfterMs);
  if (moment) {
    add(moment.until);
    const dep = moment.kind === 'leave' || moment.kind === 'board' ? moment.depAt : undefined;
    if (dep !== undefined && dep > now) add(now + ((dep - now) % MIN || MIN));
  }
  if (m.re) {
    add(m.re.t + GUIDE.replanMs);
    add(m.re.t + GUIDE.passedMs);
    if (m.re.swap) add(m.re.swap.at + GUIDE.replanMs);
    if (m.re.none !== undefined) add(m.re.none + GUIDE.replanMs);
  }
  if (m.arrivedAt !== undefined) add(m.arrivedAt + GUIDE.arrivedMs);
  for (const t of Object.values(m.shown)) {
    add(t + GUIDE.platformMs);
    add(t + GUIDE.arrivedMs);
  }
  return Math.max(now + GUIDE.wakeMinMs, best);
}

/* ------------------------------ Pas du moteur ------------------------------ */

/** Prend en compte un changement de trajet : nouveau trajet adopté après une demande de recalcul, ou autre trajet. */
function adopt(m: Mem, j: Journey, now: number): void {
  prune(m, j.id);
  if (m.jid === j.id) return;
  if (m.jid !== undefined) {
    let keep: Mem['boarded'];
    if (m.re && m.re.jid === m.jid && m.re.jid !== j.id && !m.re.swap && m.re.none === undefined) {
      m.re.swap = { jid: j.id, at: now };
      const ob = m.re.onBoard;
      const k = ob ? j.legs.findIndex((l) => l.kind === 'ride' && l.schedDep === ob.schedDep && (l.tripId ?? '') === (ob.tripId ?? '')) : -1;
      if (ob && k >= 0) keep = { leg: k, at: ob.at };
    }
    delete m.boarded;
    if (keep) m.boarded = keep;
    delete m.alighted;
    delete m.arrivedAt;
    delete m.arrivedByFix;
    delete m.cur;
    delete m.lastNextStopAt;
  }
  m.jid = j.id;
}

/** Fin du guidage : « Tu y es » + 2 min, arrivée + 5 min (règle 1.2.x), pas parti (règle 1.2.x). */
function endedNow(c: Ctx, loc: Loc): boolean {
  const { legs, now, m, j } = c;
  if (!legs.length) return true;
  if (m.arrivedAt !== undefined) {
    const since = m.shown[`arrived:${j.id}`] ?? (c.guided ? undefined : m.arrivedAt);
    if (since !== undefined && now >= since + GUIDE.arrivedMs) return true;
  }
  if (now >= j.arr + GUIDE.endAfterMs) {
    // encore en route d'après la position (véhicule en retard sans temps réel, marche plus lente) : 30 min au plus
    const ph = loc.phase;
    const last = legs[legs.length - 1];
    const nearing = !!c.fix && !!c.prev && knownPoint(last.to) && distanceM(c.fix, last.to) <= 2_000 && distanceM(c.fix, last.to) < distanceM(c.prev, last.to) - 5;
    const going = now < j.arr + 30 * MIN && ((ph.kind === 'ride' && boardedOn(m, ph.leg) && riding(c, ph.leg)) || (ph.kind === 'walk' && ph.leg === legs.length - 1 && walkingStill(c, ph.leg) && nearing));
    if (!going) return true;
  }
  const r0 = nextRide(legs, 0);
  if (c.in.kind === 'trip' && r0 >= 0 && c.fix && knownPoint(c.in.origin)) {
    const late = legs[r0].dep + GUIDE.notLeftAfterMs;
    const waiting = m.re && m.re.jid === j.id && !m.re.swap && m.re.none === undefined;
    // parti du lancement (40 m) et à l'arrêt de montée : on attend un véhicule en retard (sans temps réel, il n'est
    // « raté » qu'après 10 min, detect), ce n'est pas « pas parti »
    const atStop = c.started && stillAtStop(c, r0);
    if (now >= late && c.fix.at >= late && distanceM(c.fix, c.in.origin) < GUIDE.notLeftM && !waiting && !atStop && !m.boarded && !m.alighted) return true;
  }
  return false;
}

/**
 * Un pas du moteur : l'état du guidage maintenant, et la mémoire à garder. Pur, déterministe ; à rappeler à chaque
 * position, à `wakeAt` et à chaque rafraîchissement du temps réel du trajet suivi.
 */
export function guideStep(input: GuideInput, mem: GuideMemory): { state: GuideState; mem: GuideMemory } {
  const m = readMem(mem);
  const j = input.journey;
  adopt(m, j, input.now);
  const c = context(input, m);
  const now = c.now;
  observe(c);
  let loc: Loc;
  const arr = arrivedNow(c);
  if (arr.yes) {
    if (m.arrivedAt === undefined) {
      m.arrivedAt = now;
      if (arr.byFix) m.arrivedByFix = true;
    }
    loc = { phase: { kind: 'arrived' }, leg: -1 };
  } else loc = locate(c);
  if (endedNow(c, loc)) loc = { phase: { kind: 'ended' }, leg: -1 };
  detect(c, loc);
  let moment: Moment | null = null;
  if (c.guided && loc.phase.kind !== 'ended') moment = pick(c, candidates(c, loc));
  else if (c.guided && m.cur && !m.dismissed.includes(m.cur)) {
    m.dismissed.push(m.cur);
    delete m.cur;
  }
  const ended = loc.phase.kind === 'ended';
  const state: GuideState = {
    kind: input.kind,
    journeyId: j.id,
    phase: loc.phase,
    moment,
    where: whereOf(c, loc),
    location: ended ? 'off' : locationOf(c, loc),
    wakeAt: wakeOf(c, moment),
    ended,
  };
  const re = m.re;
  if (c.guided && !ended && re && re.jid === j.id && !re.swap && re.none === undefined && !re.local && (input.kind === 'trip' || re.reason === 'missed' || re.reason === 'cancelled')) {
    state.replan = { from: { ...re.from }, reason: re.reason === 'late' ? 'missed' : re.reason, at: re.at };
  }
  const need = ended ? undefined : needRouteOf(c, loc);
  if (need) state.needRoute = need;
  return { state, mem: m };
}

/* ------------------------------ Nouveau trajet ------------------------------ */

/**
 * Nouveau trajet après une demande `state.replan` : encore dans un véhicule de l'ancien trajet (recalcul depuis sa
 * descente, correspondance ratée), les étapes jusqu'à ce véhicule compris restent devant le nouveau trajet (« Descends »
 * de ce véhicule, chaîne de « Où tu en es ») ; sinon le nouveau trajet tel quel.
 */
export function replanJourney(old: Journey, fresh: Journey, now: number): Journey {
  const start = fresh.legs[0]?.from;
  if (!start) return fresh;
  for (let k = 0; k < old.legs.length; k++) {
    const l = old.legs[k];
    if (l.kind !== 'ride' || l.cancelled || now >= l.arr || now < l.dep - GUIDE.boardAfterMs) continue;
    const same = (!!l.to.areaId && l.to.areaId === start.areaId) || (knownPoint(l.to) && knownPoint(start) && distanceM(l.to, start) <= 50);
    if (!same) continue;
    const legs = [...old.legs.slice(0, k + 1), ...fresh.legs];
    const rides = legs.filter(isRide);
    return { ...fresh, id: journeyId(legs), legs, dep: old.dep, arr: fresh.arr, leaveAt: old.leaveAt, transfers: Math.max(0, rides.length - 1), rt: rides.every((x) => x.rt === true) };
  }
  return fresh;
}

/* ------------------------------ Genre ride (« J'y descends ») ------------------------------ */

/**
 * Trajet d'un seul véhicule, du départ choisi (`board`, rang dans `stops.stops`, en général `stops.at ?? 0`) jusqu'à
 * l'arrêt touché (`alight`). Facultatif : `coords`, la position de chaque arrêt de `stops.stops` (même rang), pour la
 * descente constatée et l'arrêt dépassé ; sans elle, le guidage se fait à l'heure.
 */
export function rideJourney(dep: Departure, stops: DepartureStops, board: number, alight: number, coords?: ReadonlyArray<LatLon | null | undefined>): Journey {
  const list = stops.stops.length ? stops.stops : [{ name: dep.head, sched: dep.sched, est: dep.est, rt: dep.rt, delayMin: dep.delayMin }];
  const n = list.length;
  const b = Math.max(0, Math.min(Number.isInteger(board) ? board : 0, Math.max(0, n - 2)));
  const a = Math.max(Math.min(n - 1, b + 1), Math.min(n - 1, Number.isInteger(alight) ? alight : n - 1));
  const at = stops.at ?? 0;
  const s0 = list[b];
  const s1 = list[a];
  const pt = (i: number): LatLon | undefined => {
    const p = coords?.[i];
    return knownPoint(p) ? { lat: p.lat, lon: p.lon } : undefined;
  };
  const so: Stopover[] = [];
  for (let i = b; i <= a; i++) {
    const s = list[i];
    if (i !== b && i !== a && s.cancelled) continue;
    const x: Stopover = { name: s.name, sched: s.sched, est: s.est };
    if (s.areaId) x.areaId = s.areaId;
    const p = s.newPlatform || s.platform;
    if (p) x.platform = p;
    const q = pt(i);
    if (q) {
      x.lat = q.lat;
      x.lon = q.lon;
    }
    so.push(x);
  }
  const end = (s: (typeof list)[number], i: number): Leg['from'] => {
    const q = pt(i);
    return { name: s.name, lat: q?.lat ?? 0, lon: q?.lon ?? 0, ...(s.areaId ? { areaId: s.areaId } : {}) };
  };
  const op = stops.op ?? dep.op;
  const line = stops.line ?? dep.line;
  const depAt = b === at ? s0.est : (s0.leave ?? s0.est);
  const leg: Leg = {
    kind: 'ride',
    from: end(s0, b),
    to: end(s1, a),
    dep: depAt,
    arr: s1.est,
    schedDep: s0.sched,
    schedArr: s1.sched,
    op,
    mode: stops.mode ?? dep.mode,
    line,
    head: stops.head ?? dep.head,
    rt: !!(s0.rt || (b === at && dep.rt)),
    delayMin: s0.delayMin ?? 0,
    cancelled: !!(s0.cancelled || (b === at && dep.cancelled)),
    stops: so,
  };
  if (op === 'sncb' && leg.mode === 'train') leg.cat = line;
  if (dep.tripId) leg.tripId = dep.tripId;
  if (b === at) {
    if (dep.stopId) leg.fromStop = dep.stopId;
    if (dep.stopSeq !== undefined) leg.fromSeq = dep.stopSeq;
    if (dep.last) leg.last = true;
  }
  const plat = s0.platform || (b === at ? dep.platform : undefined);
  const np = s0.newPlatform || (b === at ? dep.newPlatform : undefined);
  if (plat) leg.platform = plat;
  if (np && np !== plat) leg.newPlatform = np;
  const legs = [leg];
  return { id: journeyId(legs), legs, dep: leg.dep, arr: leg.arr, leaveAt: leg.dep, transfers: 0, rt: leg.rt === true, alerts: [] };
}

/* ------------------------------ Téléphone ------------------------------ */

/**
 * « Maintenant : … » de la carte « En cours » du téléphone : « bus 6 vers Gare des Guillemins », « à pied vers l’arrêt
 * du bus 6 », « IC vers Courtrai, voie 3 », « partir à 07:05 », « à pied, arrivée 08:54 », « tu y es ».
 */
export function guideNowText(state: GuideState, journey: Journey, lang: NameLang, title?: string): string {
  const legs = journey.legs;
  const ph = state.phase;
  const toward = (l: Leg): string => `${rideName(l)} vers ${headName({ op: l.op, head: l.head ?? l.to.name }, lang)}`;
  switch (ph.kind) {
    case 'before': {
      const l = legs[ph.leg];
      if (!l) return '';
      if (l.kind === 'walk') return `partir à ${hhmm(journey.leaveAt)}`;
      return `${rideName(l)} à ${hhmm(l.dep)}`;
    }
    case 'walk': {
      const r = legs[ph.leg + 1];
      // dernière marche : vers où (la ligne du dessus de la carte dit déjà l'arrivée) ; sans titre, l'arrivée
      if (!r || r.kind !== 'ride') return title?.trim() ? `à pied ${towardText(title)}` : `à pied, arrivée ${hhmm(journey.arr)}`;
      if (isTrain(r)) {
        const p = platformOf(r);
        if (ph.leg > 0 && legs[ph.leg - 1].kind === 'ride' && p) return `à pied vers la voie ${p}`;
        return `à pied vers ${displayName(r.from.name, lang)}`;
      }
      return `à pied vers l’arrêt du ${rideName(r)}`;
    }
    case 'wait': {
      const l = legs[ph.leg];
      if (!l) return '';
      const p = isTrain(l) ? platformOf(l) : undefined;
      return `${toward(l)}${p ? `, voie ${p}` : ''}`;
    }
    case 'ride': {
      const l = legs[ph.leg];
      return l ? toward(l) : '';
    }
    case 'arrived':
      return 'tu y es';
    default:
      return 'trajet terminé';
  }
}

/** Carte « En cours » du téléphone (PRD § 4.3). `guided` : réglage « Me guider pendant un trajet ». */
export function guideStatusOf(state: GuideState, journey: Journey, title: string, guided: boolean, lang: NameLang): GuideStatus {
  return { kind: state.kind, title, arr: journey.arr, now: guideNowText(state, journey, lang, title), guided };
}

/** « vers le bureau », « vers Gand-Saint-Pierre », « vers chez Karim » (titre du trajet, « Vers … » gardé). */
function towardText(title: string): string {
  const t = title.trim();
  const v = /^Vers\s/.test(t) ? t : vers(placeNoun(t));
  return v.charAt(0).toLowerCase() + v.slice(1);
}
