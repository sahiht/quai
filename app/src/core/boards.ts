/**
 * Tableaux de départs : horaires statiques + temps réel (par lots, pour plusieurs zones à la fois).
 */
import type { Mode, Op } from '../../../shared/types';
import { prettyName } from '../../../shared/names';
import type { Board, Departure, LineFilter } from './api';
import { lowerBound, type PreparedArea } from './areas';
import type { RealtimeClient, RtTrip, StibEntry } from './realtime';
import { stibPoint } from './realtime';
import { delayMinutes, headKey, headScore, rtAtStop, rtOccurrence } from './rtmerge';

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
}

interface Candidate {
  di: number; // index dans deps
  t: number;
}

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

/**
 * STIB : les passages en direct (ligne + destination) remplacent les départs prévus du même motif
 * jusqu'au dernier passage annoncé ; au-delà, l'horaire prévu reste (~). Lignes absentes : prévu.
 */
export function mergeStib(
  prep: PreparedArea,
  statics: Candidate[],
  points: Map<string, StibEntry[] | null> | null,
  now: number,
  filter: LineFilter[] | undefined,
): Departure[] {
  const out: Departure[] = [];
  const horizon = new Map<string, number>(); // `${stopIdx}|${pattern}` → dernier passage annoncé
  const ok = patternFilter(prep, filter);
  const fkeys = (filter ?? []).map((f) => ({ line: f.line, head: headKey(f.head) }));
  if (points) {
    prep.file.stops.forEach((st, stopIdx) => {
      const entries = points.get(stibPoint(st.rt || st.id));
      if (!entries) return;
      for (const e of entries) {
        const times = e.times.filter((t) => t >= now - PAST_MS && t <= now + STIB_AHEAD_MS);
        if (!times.length) continue;
        const pi = matchStibPattern(prep, stopIdx, e);
        const p = pi >= 0 ? prep.file.patterns[pi] : undefined;
        if (p) {
          if (!ok(pi)) continue;
          const key = `${stopIdx}|${pi}`;
          horizon.set(key, Math.max(horizon.get(key) ?? 0, ...times));
        } else if (fkeys.length) {
          const hk = headKey(e.dest.fr);
          if (!fkeys.some((f) => f.line === e.line && headScore(f.head, hk) > 0)) continue;
        }
        const head = p?.head ?? { fr: prettyName(e.dest.fr), nl: prettyName(e.dest.nl) };
        for (const t of times) {
          const d: Departure = {
            op: 'stib',
            mode: p?.mode ?? modeOfLine(prep, e.line),
            line: e.line,
            head,
            sched: t,
            est: t,
            rt: true,
            delayMin: 0,
            cancelled: false,
            stopId: st.id,
          };
          if (e.msg) d.msg = e.msg;
          out.push(d);
        }
      }
    });
  }
  for (const c of statics) {
    if (c.t < now - PAST_MS) continue;
    const dep = prep.file.deps[c.di];
    const h = horizon.get(`${dep[3]}|${dep[2]}`);
    if (h !== undefined && c.t <= h) continue;
    out.push(staticDeparture(prep, c.di, c.t));
  }
  return out;
}

const byEst = (a: Departure, b: Departure) => a.est - b.est || a.sched - b.sched || a.line.localeCompare(b.line);

/** Calcule plusieurs tableaux en groupant les appels au relais (un lot par opérateur). */
export async function buildBoards(reqs: BoardRequest[], rt: RealtimeClient, now: number): Promise<Board[]> {
  const cands = reqs.map((r) => candidates(r.prep, now, r.limit, patternFilter(r.prep, r.filter)));

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
      deps = mergeStib(prep, cands[i], stibRes ? stibRes.map : null, now, r.filter);
    } else {
      const res = byOp.get(op);
      if (res?.error) rtErrors.push(op);
      deps = [];
      for (const c of cands[i]) {
        const base = staticDeparture(prep, c.di, c.t);
        const st = prep.file.stops[prep.file.deps[c.di][3]];
        // le flux est indexé par trip_id sans date : seulement pour l'occurrence proche de maintenant
        const trip = base.tripId && rtOccurrence(c.t, now) ? res?.map.get(base.tripId) : undefined;
        const d = applyTripToDeparture(base, trip, st?.rt);
        if (d.est < now - PAST_MS) continue;
        if (!d.rt && d.sched < now - PAST_MS) continue;
        if (d.cancelled && d.sched < now - PAST_MS) continue;
        deps.push(d);
      }
    }
    deps.sort(byEst);
    const departures = deps.slice(0, Math.max(0, r.limit));
    return {
      area: prep.summary,
      departures,
      anyPlanned: departures.some((d) => !d.rt),
      rtErrors,
      updatedAt: now,
    };
  });
}
