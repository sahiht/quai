/**
 * Tableaux de départs : horaires statiques + temps réel (par lots, pour plusieurs zones à la fois).
 */
import type { Mode, Names, Op } from '../../../shared/types';
import { normalizeForSearch, prettyName } from '../../../shared/names';
import { normalizeId } from '../../../shared/types';
import type { Board, Departure, LineFilter } from './api';
import { lowerBound, type PreparedArea } from './areas';
import type { RealtimeClient, RtTrip, StibEntry } from './realtime';
import { stibPoint } from './realtime';
import { delayMinutes, headKey, headScore, platformOfStopId, rtAtStop, rtOccurrence, sameStop } from './rtmerge';

/** Fenêtre : départs depuis maintenant - 1 min ; voyages GTFS-RT déjà partis en théorie mais en retard : 30 min. */
const PAST_MS = 60_000;
const LOOKBACK_MS = 30 * 60_000;
/** Passages STIB acceptés : de maintenant - 1 min à maintenant + 2 h (garde-fou contre des heures absurdes). */
const STIB_AHEAD_MS = 2 * 3_600_000;
const EXTRA = 10;
/**
 * Horizon d'un tableau : au-delà de 3 h on complète jusqu'à `limit`, mais jamais plus de 23 h après maintenant.
 * Moins de 24 h : un même voyage (même trip_id chaque jour) ne peut pas figurer deux fois, et un départ du
 * lendemain a toujours une heure antérieure à l'heure actuelle (pas de confusion avec « IC 12:22 » du jour).
 */
export const BOARD_HORIZON_MS = 23 * 3_600_000;

export interface BoardRequest {
  prep: PreparedArea;
  limit: number;
  filter?: LineFilter[];
  /**
   * 1.2.2 (lineBoard, core/linepicks.ts) : motifs retenus (rangs dans le fichier de zone), à la place de `filter`.
   * Un passage STIB sans motif connu, d'une des lignes `lines`, est gardé si `unknown(destination)` le dit.
   */
  pick?: { patterns: ReadonlySet<number>; lines: ReadonlySet<string>; unknown: (head: Names) => boolean };
}

interface Candidate {
  di: number; // index dans deps
  t: number;
}

/** 1.2.2 : motif (rang dans le fichier de zone, -1 si inconnu) de chaque départ rendu par buildBoards. */
const PATTERN_OF = new WeakMap<Departure, number>();
export function patternOfDeparture(d: Departure): number | undefined {
  return PATTERN_OF.get(d);
}
const withPattern = (d: Departure, pi: number): Departure => {
  PATTERN_OF.set(d, pi);
  return d;
};

/** Motifs retenus par une demande : `pick` (lineBoard), sinon le filtre de ligne. */
const requestFilter = (r: BoardRequest): ((pi: number) => boolean) => {
  const pick = r.pick;
  return pick ? (pi) => pick.patterns.has(pi) : patternFilter(r.prep, r.filter);
};

/** Vrai si le motif passe le filtre (absent ou vide = tout). */
export function patternFilter(prep: PreparedArea, filter: LineFilter[] | undefined): (pi: number) => boolean {
  if (!filter || !filter.length) return () => true;
  const keys = filter.map((f) => ({ line: f.line, head: headKey(f.head) }));
  return (pi) => {
    const p = prep.file.patterns[pi];
    if (!p) return false;
    return keys.some((f) => f.line === p.line && headScore(f.head, prep.headKeys[pi]) > 0);
  };
}

function candidates(prep: PreparedArea, now: number, limit: number, ok: (pi: number) => boolean): Candidate[] {
  const gtfsRt = prep.file.op !== 'stib';
  const from = now - PAST_MS;
  const start = gtfsRt ? now - LOOKBACK_MS : from;
  const out: Candidate[] = [];
  let ahead = 0;
  for (let k = lowerBound(prep, start); k < prep.order.length && ahead < limit + EXTRA; k++) {
    const di = prep.order[k];
    const t = prep.times[di];
    if (t > now + BOARD_HORIZON_MS) break;
    const dep = prep.file.deps[di];
    if (!ok(dep[2])) continue;
    out.push({ di, t });
    if (t >= from) ahead++;
  }
  return out;
}

export function staticDeparture(prep: PreparedArea, di: number, t: number): Departure {
  const dep = prep.file.deps[di];
  const p = prep.file.patterns[dep[2]];
  const st = prep.file.stops[dep[3]];
  const d: Departure = {
    op: prep.file.op,
    mode: p?.mode ?? 'bus',
    line: p?.line ?? '',
    head: p?.head ?? { fr: '', nl: '' },
    sched: t,
    est: t,
    rt: false,
    delayMin: 0,
    cancelled: false,
  };
  if (st?.platform) d.platform = st.platform;
  if (dep[4]) d.tripId = dep[4];
  d.stopSeq = dep[5];
  if (st) d.stopId = st.id;
  return d;
}

/** Applique le temps réel GTFS-RT à un départ statique. */
export function applyTripToDeparture(d: Departure, trip: RtTrip | null | undefined, stopRt: string | undefined): Departure {
  const r = rtAtStop(trip, { seq: d.stopSeq, stopId: stopRt ?? d.stopId, sched: d.sched, platform: d.platform });
  const out: Departure = { ...d, rt: r.rt, est: r.est, cancelled: r.cancelled, delayMin: r.cancelled ? 0 : delayMinutes(r.est, d.sched) };
  if (r.newPlatform && !r.cancelled) out.newPlatform = r.newPlatform;
  else delete out.newPlatform;
  return out;
}

/** Motif STIB correspondant à une entrée temps réel (même ligne, destination proche), -1 sinon. */
export function matchStibPattern(prep: PreparedArea, stopIdx: number, e: StibEntry): number {
  const pats = (prep.patternsAtStop[stopIdx] ?? []).filter((pi) => prep.file.patterns[pi]?.line === e.line);
  if (!pats.length) return -1;
  const fr = headKey(e.dest.fr);
  const nl = headKey(e.dest.nl);
  let best = -1;
  let bestScore = 0;
  for (const pi of pats) {
    const s = Math.max(headScore(fr, prep.headKeys[pi]), headScore(nl, prep.headKeysNl[pi]), headScore(fr, prep.headKeysNl[pi]), headScore(nl, prep.headKeys[pi]));
    if (s > bestScore) {
      bestScore = s;
      best = pi;
    }
  }
  if (best < 0 && pats.length === 1) return pats[0];
  return best;
}

function modeOfLine(prep: PreparedArea, line: string): Mode {
  return prep.file.patterns.find((p) => p.line === line)?.mode ?? 'bus';
}

/** Écart maximal entre un passage sans destination et le départ prévu qui la lui donne. */
const BLANK_HEAD_MS = 2 * 3_600_000;

/**
 * Motif d'un passage STIB sans destination (cas réel) : celui du départ prévu le plus proche de la même ligne
 * à cet arrêt (2 h au plus) ; sinon la direction la plus fréquente de la ligne à cet arrêt, puis dans la zone ;
 * -1 si la ligne est inconnue ici.
 */
export function patternForLine(prep: PreparedArea, stopIdx: number, line: string, t: number): number {
  const ofLine = (pi: number): boolean => prep.file.patterns[pi]?.line === line;
  const here = (di: number): boolean => {
    const dep = prep.file.deps[di];
    return dep[3] === stopIdx && ofLine(dep[2]);
  };
  let best = -1;
  let bestGap = Infinity;
  const k0 = lowerBound(prep, t);
  for (let k = k0; k < prep.order.length; k++) {
    const di = prep.order[k];
    const gap = prep.times[di] - t;
    if (gap > BLANK_HEAD_MS) break;
    if (here(di)) {
      best = prep.file.deps[di][2];
      bestGap = gap;
      break;
    }
  }
  for (let k = k0 - 1; k >= 0; k--) {
    const di = prep.order[k];
    const gap = t - prep.times[di];
    if (gap > BLANK_HEAD_MS || gap >= bestGap) break;
    if (here(di)) {
      best = prep.file.deps[di][2];
      break;
    }
  }
  if (best >= 0) return best;
  for (const atStop of [true, false]) {
    const count = new Map<number, number>();
    for (const dep of prep.file.deps) if ((!atStop || dep[3] === stopIdx) && ofLine(dep[2])) count.set(dep[2], (count.get(dep[2]) ?? 0) + 1);
    let top = -1;
    let n = 0;
    for (const [pi, c] of count) if (c > n || (c === n && pi < top)) [top, n] = [pi, c];
    if (top >= 0) return top;
  }
  return prep.file.patterns.findIndex((p) => p.line === line);
}

/** Passage STIB prêt à afficher : jamais de « Ne pas embarquer », destination toujours connue. */
export interface StibPassage {
  t: number;
  line: string;
  /** Motif statique correspondant, -1 si aucun (ligne ou destination inconnue des horaires). */
  pi: number;
  head: Names;
  /** Faux pour un « Temps théorique » : horaire prévu (~). */
  rt: boolean;
  last: boolean;
  msg?: string;
}

/**
 * Passages d'un point d'arrêt (index `stopIdx` de la zone) entre `from` et `to` : les véhicules qui terminent ici
 * (« Ne pas embarquer ») sont retirés ; une destination vide prend celle du motif statique (patternForLine), et
 * un passage dont la destination reste introuvable est ignoré.
 */
export function stibPassages(prep: PreparedArea, stopIdx: number, entries: readonly StibEntry[], from: number, to: number): StibPassage[] {
  const out: StibPassage[] = [];
  for (const e of entries) {
    if (e.noBoarding) continue;
    const times = e.times.filter((t) => t >= from && t <= to);
    if (!times.length) continue;
    const blank = !e.dest.fr.trim() && !e.dest.nl.trim();
    const matched = blank ? -1 : matchStibPattern(prep, stopIdx, e);
    for (const t of times) {
      const pi = blank ? patternForLine(prep, stopIdx, e.line, t) : matched;
      const p = pi >= 0 ? prep.file.patterns[pi] : undefined;
      if (!p && blank) continue;
      const x: StibPassage = { t, line: e.line, pi, head: p?.head ?? { fr: prettyName(e.dest.fr), nl: prettyName(e.dest.nl) }, rt: !e.planned, last: !!e.last };
      if (e.msg) x.msg = e.msg;
      out.push(x);
    }
  }
  return out;
}

/**
 * STIB : les passages annoncés (ligne + destination) remplacent les départs prévus du même motif
 * jusqu'au dernier passage annoncé ; au-delà, l'horaire prévu reste (~). Lignes absentes : prévu.
 * Un « Temps théorique » compte comme passage annoncé mais reste un horaire prévu (rt faux, « ~ »).
 */
export function mergeStib(
  prep: PreparedArea,
  statics: Candidate[],
  points: Map<string, StibEntry[] | null> | null,
  now: number,
  filter: LineFilter[] | undefined,
  pick?: BoardRequest['pick'],
): Departure[] {
  const out: Departure[] = [];
  const horizon = new Map<string, number>(); // `${stopIdx}|${pattern}` → dernier passage annoncé
  const ok = requestFilter({ prep, limit: 0, filter, pick });
  const fkeys = (filter ?? []).map((f) => ({ line: f.line, head: headKey(f.head) }));
  if (points) {
    prep.file.stops.forEach((st, stopIdx) => {
      const entries = points.get(stibPoint(st.rt || st.id));
      if (!entries) return;
      for (const x of stibPassages(prep, stopIdx, entries, now - PAST_MS, now + STIB_AHEAD_MS)) {
        const p = x.pi >= 0 ? prep.file.patterns[x.pi] : undefined;
        if (p) {
          if (!ok(x.pi)) continue;
          const key = `${stopIdx}|${x.pi}`;
          horizon.set(key, Math.max(horizon.get(key) ?? 0, x.t));
        } else if (pick) {
          if (!pick.lines.has(x.line) || !pick.unknown(x.head)) continue;
        } else if (fkeys.length) {
          const hk = headKey(x.head.fr);
          if (!fkeys.some((f) => f.line === x.line && headScore(f.head, hk) > 0)) continue;
        }
        const d: Departure = {
          op: 'stib',
          mode: p?.mode ?? modeOfLine(prep, x.line),
          line: x.line,
          head: x.head,
          sched: x.t,
          est: x.t,
          rt: x.rt,
          delayMin: 0,
          cancelled: false,
          stopId: st.id,
        };
        if (x.msg) d.msg = x.msg;
        if (x.last) d.last = true;
        out.push(withPattern(d, p ? x.pi : -1));
      }
    });
  }
  for (const c of statics) {
    if (c.t < now - PAST_MS) continue;
    const dep = prep.file.deps[c.di];
    const h = horizon.get(`${dep[3]}|${dep[2]}`);
    if (h !== undefined && c.t <= h) continue;
    out.push(withPattern(staticDeparture(prep, c.di, c.t), dep[2]));
  }
  return out;
}

const byEst = (a: Departure, b: Departure) => a.est - b.est || a.sched - b.sched || a.line.localeCompare(b.line);

/**
 * Garde-fou M8.2 (le pipeline 1.1 dédoublonne déjà) : un départ par voyage dans la zone, et un seul départ de même
 * ligne, même destination et même heure prévue (doublons SNCB de trip_id différents) ; le premier (trié) l'emporte,
 * en préférant celui qui a du temps réel.
 */
export function uniqueDepartures(deps: readonly Departure[]): Departure[] {
  const out: Departure[] = [];
  const byTrip = new Map<string, number>();
  const byKey = new Map<string, number>();
  for (const d of deps) {
    const tk = d.tripId ? normalizeId(d.tripId) : '';
    const key = `${d.line}|${normalizeForSearch(d.head.fr)}|${d.sched}`;
    const prev = (tk ? byTrip.get(tk) : undefined) ?? byKey.get(key);
    if (prev !== undefined) {
      if (!out[prev].rt && d.rt) out[prev] = d;
      continue;
    }
    if (tk) byTrip.set(tk, out.length);
    byKey.set(key, out.length);
    out.push(d);
  }
  return out;
}

/** Pendant une panne : suppression, arrêt sauté ou voie modifiée déjà connus, sans retard (horaire prévu, « ~ »). */
export function applyMemory(d: Departure, mem: RtTrip, stopRt: string | undefined): Departure {
  const out: Departure = { ...d, rt: false, est: d.sched, delayMin: 0 };
  if (mem.cancelled) return { ...out, cancelled: true };
  const u = mem.u.find((x) => (x[0] !== null && d.stopSeq !== undefined && x[0] === d.stopSeq) || sameStop(x[1], stopRt ?? d.stopId));
  if (u?.[4] === 1) return { ...out, cancelled: true };
  const p = platformOfStopId(u?.[1]);
  const planned = d.platform || platformOfStopId(d.stopId);
  if (p && planned && p !== planned) out.newPlatform = p;
  return out;
}

/** Calcule plusieurs tableaux en groupant les appels au relais (un lot par opérateur). */
export async function buildBoards(reqs: BoardRequest[], rt: RealtimeClient, now: number): Promise<Board[]> {
  const cands = reqs.map((r) => candidates(r.prep, now, r.limit, requestFilter(r)));

  const tripIds = new Map<Op, Set<string>>();
  const points = new Set<string>();
  reqs.forEach((r, i) => {
    const op = r.prep.file.op;
    if (op === 'stib') {
      for (const st of r.prep.file.stops) points.add(stibPoint(st.rt || st.id));
    } else {
      let set = tripIds.get(op);
      if (!set) tripIds.set(op, (set = new Set()));
      for (const c of cands[i]) {
        const id = r.prep.file.deps[c.di][4];
        if (id && rtOccurrence(c.t, now)) set.add(id);
      }
    }
  });

  const [tripRes, stibRes] = await Promise.all([
    Promise.all([...tripIds].map(async ([op, ids]) => [op, await rt.trips(op, [...ids])] as const)),
    points.size ? rt.stib([...points]) : Promise.resolve(null),
  ]);
  const byOp = new Map(tripRes);

  return reqs.map((r, i): Board => {
    const prep = r.prep;
    const op = prep.file.op;
    const rtErrors: Op[] = [];
    let deps: Departure[];
    if (op === 'stib') {
      if (stibRes?.error) rtErrors.push('stib');
      deps = mergeStib(prep, cands[i], stibRes ? stibRes.map : null, now, r.filter, r.pick);
    } else {
      const res = byOp.get(op);
      if (res?.error) rtErrors.push(op);
      deps = [];
      for (const c of cands[i]) {
        const base = staticDeparture(prep, c.di, c.t);
        const st = prep.file.stops[prep.file.deps[c.di][3]];
        // le flux est indexé par trip_id sans date : seulement pour l'occurrence proche de maintenant
        const live = !!base.tripId && rtOccurrence(c.t, now);
        const trip = live ? res?.map.get(normalizeId(base.tripId!)) : undefined;
        let d = applyTripToDeparture(base, trip, st?.rt);
        // panne (M8.5) : suppressions et voies modifiées déjà connues, horaire prévu
        const mem = live && !trip ? res?.remembered?.get(normalizeId(base.tripId!)) : undefined;
        if (mem) d = applyMemory(d, mem, st?.rt);
        if (d.est < now - PAST_MS) continue;
        if (!d.rt && d.sched < now - PAST_MS) continue;
        if (d.cancelled && d.sched < now - PAST_MS) continue;
        deps.push(withPattern(d, prep.file.deps[c.di][2]));
      }
    }
    deps.sort(byEst);
    const departures = uniqueDepartures(deps).slice(0, Math.max(0, r.limit));
    return {
      area: prep.summary,
      departures,
      anyPlanned: departures.some((d) => !d.rt),
      rtErrors,
      updatedAt: now,
    };
  });
}
