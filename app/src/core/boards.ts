/**
 * Tableaux de départs : horaires statiques + temps réel (par lots, pour plusieurs zones à la fois).
 */
import type { Mode, Names, Op } from '../../../shared/types';
import { normalizeForSearch, prettyName } from '../../../shared/names';
import { normalizeId } from '../../../shared/types';
import type { Board, Departure, Leg, LineFilter } from './api';
import { lowerBound, type PreparedArea } from './areas';
import { addDays } from './freshness';
import { isSncbBus } from './means';
import type { RealtimeClient, RtTrip, StibEntry } from './realtime';
import { stibPoint } from './realtime';
import { delayMinutes, headKey, headScore, platformOfStopId, rtAtStop, rtOccurrence, sameStop } from './rtmerge';
import { DAY_START_HOUR } from './text';
import type { DayIndex } from './trains';
import { brusselsParts, gtfsTime, serviceDayBase } from './util';

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
  /**
   * 1.2.3 (tableau complet, PRD-1.2.3 § 1) : tous les départs jusqu'à cet instant (ms ; heure estimée, un supprimé à
   * son heure prévue), `limit` au plus ; aucun : le prochain départ, même plus tard.
   */
  until?: number;
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

function candidates(prep: PreparedArea, now: number, limit: number, ok: (pi: number) => boolean, until?: number): Candidate[] {
  const gtfsRt = prep.file.op !== 'stib';
  const from = now - PAST_MS;
  const start = gtfsRt ? now - LOOKBACK_MS : from;
  const out: Candidate[] = [];
  let ahead = 0;
  let beyond = 0;
  for (let k = lowerBound(prep, start); k < prep.order.length && ahead < limit + EXTRA; k++) {
    const di = prep.order[k];
    const t = prep.times[di];
    if (t > now + BOARD_HORIZON_MS) break;
    // 1.2.3 : tableau complet, jusqu'à `until` puis quelques départs de plus (le prochain, si l'horizon est vide)
    if (until !== undefined && t > until && beyond > EXTRA) break;
    const dep = prep.file.deps[di];
    if (!ok(dep[2])) continue;
    out.push({ di, t });
    if (t >= from) ahead++;
    if (until !== undefined && t > until) beyond++;
  }
  return out;
}

/** 1.2.3 : départs d'un tableau complet (`until`) : ceux de l'horizon, sinon le prochain qui part. */
function withinUntil(deps: Departure[], until: number | undefined): Departure[] {
  if (until === undefined) return deps;
  const inside = deps.filter((d) => (d.cancelled ? d.sched : d.est) <= until);
  return inside.length ? inside : deps.filter((d) => !d.cancelled).slice(0, 1);
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
    out.push(withPattern(withScheduleLast(prep, c.di, staticDeparture(prep, c.di, c.t)), dep[2]));
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
  const cands = reqs.map((r) => candidates(r.prep, now, r.limit, requestFilter(r), r.until));

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
        deps.push(withPattern(withScheduleLast(prep, c.di, d), prep.file.deps[c.di][2]));
      }
    }
    deps.sort(byEst);
    const unique = uniqueDepartures(deps);
    settleLast(prep, unique);
    const departures = withinUntil(unique, r.until).slice(0, Math.max(0, r.limit));
    return {
      area: prep.summary,
      departures,
      anyPlanned: departures.some((d) => !d.rt),
      rtErrors,
      updatedAt: now,
    };
  });
}

/* ------------------------------ 1.3.1 (R3) : « , dernier » d'après l'horaire ------------------------------ */

/**
 * « Ligne » d'un départ pour « , dernier » : le numéro sans casse, espaces ni zéros de tête (« 036 » = « 36 »), quel que
 * soit le mode. Tous les trains de la SNCB n'en font qu'une (IC, L, P, S… : quand un L suit le dernier IC, l'IC n'est
 * pas le dernier train), ses bus à part. Les variantes d'un numéro (lettres ou barre après les chiffres : « 20a » et
 * « 20b » de De Lijn, « 27 » et « 27/ », « 86A » et « 86C » du TEC) n'en font qu'une : quand un 20b suit le dernier
 * 20a dans le même sens, le 20a n'est pas le dernier (contrôle du 20/11 : 1 857 marques des vraies données). Une lettre
 * devant le numéro (N10 de nuit, X64 express, T39) reste une autre ligne.
 */
export function lastLineKey(op: Op, mode: Mode, line: string): string {
  if (op === 'sncb' && mode === 'train') return 'sncb:train';
  const key = String(line ?? '').replace(/\s+/g, '').toLowerCase().replace(/^0+(?=.)/, '');
  return `${op}:${key.replace(/^(\d+)[a-z/]+$/, '$1')}`;
}

/** Début de « demain » pour un départ à `t` : 04:00 (heure belge) qui suit ; avant, c'est la nuit en cours (dayWord). */
export function tomorrowAt(t: number): number {
  const p = brusselsParts(t);
  return gtfsTime(p.h < DAY_START_HOUR ? p.date : addDays(p.date, 1), DAY_START_HOUR * 60);
}

/** Fenêtre des départs connus : de `from` à `to` ; `ends` : les 04:00 (débuts de « demain ») des jours, dans l'ordre. */
export interface LastCover {
  from: number;
  to: number;
  ends: number[];
}

/**
 * Instants dont tous les départs sont connus, d'après les jours publiés (ou chargés) `dates`, consécutifs depuis le
 * premier : de 04:00 du premier (avant, les voyages de la veille après minuit manquent) au début du jour qui suit le
 * dernier (ses voyages d'avant 04:00, écrits sur ce jour-là, manquent). null : aucun jour.
 */
export function lastCover(dates: readonly string[] | undefined): LastCover | null {
  const sorted = [...new Set(dates ?? [])].sort();
  if (!sorted.length) return null;
  let last = sorted[0];
  for (const d of sorted.slice(1)) {
    if (d !== addDays(last, 1)) break;
    last = d;
  }
  const ends: number[] = [];
  for (let d = sorted[0]; d <= addDays(last, 1); d = addDays(d, 1)) ends.push(gtfsTime(d, DAY_START_HOUR * 60));
  return { from: ends[0], to: serviceDayBase(addDays(last, 1)), ends };
}

/** Un départ du même sens moins de 2 h plus tard, même après 04:00 : la ligne roule encore, jamais « dernier ». */
export const LAST_QUIET_MS = 2 * 3_600_000;

/** Un départ vu par « , dernier » : instant, sens (même nombre : même ligne, même sens), identité (`same`, doublons). */
interface WayDep {
  t: number;
  way: number;
  /** Ligne et destination : à la même minute, le même départ (voyage en double, doublon SNCB), jamais un « suivant ». */
  same: number;
}

/**
 * Pour chaque départ, 1 s'il est le dernier de son sens avant demain (04:00 qui suit), d'après l'horaire : toute la
 * fenêtre jusqu'à demain dans les départs connus (`cover`), et aucun autre départ du même sens dans [t, demain), même
 * ligne et même destination à la même minute exceptées (le même départ). Deux départs différents du même sens à la même
 * minute : aucun des deux n'est le dernier.
 *
 * 04:00 n'est pas une coupure pour une ligne qui roule (contrôle du 20/11, vraies données : le N62 de De Lijn passe
 * toute la nuit, 03:48 puis 04:18 ; le premier bus du matin part parfois à 03:48). Jamais la marque non plus quand le
 * départ suivant du même sens, après 04:00, part moins de 2 h plus tard (LAST_QUIET_MS) ; ni, pour un départ de la nuit
 * (avant 04:00), quand ce suivant est aussi proche ou plus proche que le précédent, ou qu'aucun ne le précède depuis
 * 04:00 la veille : c'est le premier du matin, pas le dernier de la nuit.
 */
function lastFlags(deps: readonly WayDep[], cover: LastCover | null): Uint8Array {
  const out = new Uint8Array(deps.length);
  if (!cover) return out;
  const byWay = new Map<number, number[]>();
  deps.forEach((d, i) => {
    if (d.way < 0 || !Number.isFinite(d.t) || d.t < cover.from) return;
    const list = byWay.get(d.way);
    if (list) list.push(i);
    else byWay.set(d.way, [i]);
  });
  for (const list of byWay.values()) {
    list.sort((a, b) => deps[a].t - deps[b].t || a - b);
    for (let j = 0; j < list.length; j++) {
      const d = deps[list[j]];
      const end = cover.ends.find((e) => e > d.t) ?? Infinity;
      if (!(end <= cover.to)) continue;
      let alone = true;
      for (let k = j - 1; k >= 0 && alone && deps[list[k]].t === d.t; k--) if (deps[list[k]].same !== d.same) alone = false;
      let k = j + 1;
      for (; k < list.length && alone; k++) {
        const o = deps[list[k]];
        if (o.t >= end) break;
        if (o.t !== d.t || o.same !== d.same) alone = false;
      }
      if (!alone) continue;
      // le premier départ du même sens de demain (à 04:00 ou après), s'il est connu
      const next = k < list.length ? deps[list[k]] : undefined;
      if (next) {
        const gap = next.t - d.t;
        if (gap < LAST_QUIET_MS) continue;
        if (end - d.t <= DAY_START_HOUR * 3_600_000) {
          let p = j - 1;
          while (p >= 0 && deps[list[p]].t === d.t) p--;
          if (p < 0 || gap <= d.t - deps[list[p]].t) continue;
        }
      }
      out[list[j]] = 1;
    }
  }
  return out;
}

/** Union de proche en proche : `keys(i)` de chaque élément ; deux éléments qui partagent une clé ont le même sens. */
function unionWays(n: number, keys: (i: number) => Iterable<string>): Int32Array {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const first = new Map<string, number>();
  for (let i = 0; i < n; i++)
    for (const k of keys(i)) {
      const j = first.get(k);
      if (j === undefined) first.set(k, i);
      else parent[find(i)] = find(j);
    }
  return Int32Array.from({ length: n }, (_, i) => find(i));
}

/** Numéro de chaque valeur distincte (même ligne et même destination : même numéro). */
function numbering(): (key: string) => number {
  const ids = new Map<string, number>();
  return (key) => {
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
}

const WAYS = new WeakMap<PreparedArea, Int32Array>();
const LAST = new WeakMap<PreparedArea, Uint8Array>();

/**
 * Sens des motifs d'une zone pour « , dernier » : même ligne (lastLineKey), et même destination ou une zone suivante en
 * commun (toute la liste : un express qui saute les premiers arrêts, une variante qui rejoint le tronc), de proche en
 * proche. Une boucle parcourue dans les deux sens n'a qu'un sens : moins de « dernier », jamais un faux.
 */
export function lastWays(prep: PreparedArea): Int32Array {
  const hit = WAYS.get(prep);
  if (hit) return hit;
  const op = prep.file.op;
  const pats = prep.file.patterns;
  const ways = unionWays(pats.length, (i) => {
    const p = pats[i];
    if (!p) return [];
    const line = lastLineKey(op, p.mode, p.line);
    return [`${line}|>${prep.headKeys[i]}`, ...(p.next ?? []).map(([z]) => `${line}|@${z}`)];
  });
  WAYS.set(prep, ways);
  return ways;
}

/** 1 pour chaque départ de la zone (rang dans deps) qui est le dernier de sa ligne dans son sens avant demain. */
export function scheduleLastFlags(prep: PreparedArea): Uint8Array {
  const hit = LAST.get(prep);
  if (hit) return hit;
  const ways = lastWays(prep);
  const pats = prep.file.patterns;
  const id = numbering();
  const same = pats.map((p, i) => id(`${p?.line ?? ''}|${prep.headKeys[i] ?? ''}`));
  const flags = lastFlags(
    prep.file.deps.map((d, i) => ({ t: prep.times[i], way: pats[d[2]] ? ways[d[2]] : -1, same: same[d[2]] ?? -1 })),
    lastCover(prep.dates),
  );
  LAST.set(prep, flags);
  return flags;
}

/**
 * 1.3.1 (R3, PRD-1.3.1 § 14) : le départ `di` de la zone est le dernier de sa ligne dans son sens avant demain, d'après
 * l'horaire : aucun départ du même sens (lastWays) entre lui et 04:00 qui suit, quel que soit son jour de service (un
 * voyage de la veille après minuit, un voyage du jour écrit « 00:30 ») ; toute cette fenêtre dans les jours publiés.
 */
export function scheduleLast(prep: PreparedArea, di: number): boolean {
  return scheduleLastFlags(prep)[di] === 1;
}

/** 1.3.1 (R3) : départs marqués d'après l'horaire (le « Dernier passage » de la STIB n'y est pas). */
const SCHEDULE_LAST = new WeakSet<Departure>();

/** Marque « dernier » d'après l'horaire d'un départ prévu (rang `di` dans le fichier de zone). */
function withScheduleLast(prep: PreparedArea, di: number, d: Departure): Departure {
  if (!d.last && scheduleLast(prep, di)) {
    d.last = true;
    SCHEDULE_LAST.add(d);
  }
  return d;
}

/**
 * 1.3.1 (R3) : la marque de l'horaire reste seulement si rien ne la contredit dans le tableau : aucun départ du même
 * sens, pas supprimé, à la même heure estimée ou après, avant demain (un voyage en retard qui passe après le dernier,
 * un passage STIB sans horaire), et aucun « Dernier passage » de la STIB dans ce sens (une seule marque par sens). Un
 * passage STIB sans motif connu vaut pour tous les sens de sa ligne.
 */
function settleLast(prep: PreparedArea, deps: readonly Departure[]): void {
  const marked = deps.filter((d) => d.last && SCHEDULE_LAST.has(d));
  if (!marked.length) return;
  const ways = lastWays(prep);
  const wayOf = (d: Departure): number => {
    const pi = PATTERN_OF.get(d);
    return pi !== undefined && pi >= 0 && pi < ways.length ? ways[pi] : -1;
  };
  const lineOf = (d: Departure): string => lastLineKey(d.op, d.mode, d.line);
  const same = (d: Departure): string => `${d.line}|${headKey(d.head?.fr ?? '')}|${d.sched}`;
  for (const d of marked) {
    const w = wayOf(d);
    const end = tomorrowAt(d.sched);
    const clash = deps.some((e) => {
      if (e === d) return false;
      const ew = wayOf(e);
      if (ew >= 0 ? ew !== w : lineOf(e) !== lineOf(d)) return false;
      if (e.last && !SCHEDULE_LAST.has(e)) return true;
      return !e.cancelled && e.est >= d.est && e.est < end && same(e) !== same(d);
    });
    if (w < 0 || clash) {
      delete d.last;
      SCHEDULE_LAST.delete(d);
    }
  }
}

/**
 * 1.3.1 (R3) : départ d'une étape en véhicule dans le fichier de sa zone de montée (rang dans deps) : à sa minute prévue,
 * même ligne ; puis le même voyage, sinon le même arrêt physique et un motif qui dessert l'arrêt de descente. -1 :
 * introuvable, ou plusieurs sens possibles.
 */
export function legDepartureIn(prep: PreparedArea, leg: Pick<Leg, 'op' | 'mode' | 'line' | 'schedDep' | 'tripId' | 'fromStop' | 'to'>): number {
  if (!leg.op || leg.op !== prep.file.op || !leg.line) return -1;
  const key = lastLineKey(leg.op, leg.mode ?? 'bus', leg.line);
  const { deps, patterns, stops } = prep.file;
  let cands: number[] = [];
  for (let k = lowerBound(prep, leg.schedDep - 30_000); k < prep.order.length; k++) {
    const di = prep.order[k];
    if (prep.times[di] > leg.schedDep + 30_000) break;
    const p = patterns[deps[di][2]];
    if (p && lastLineKey(prep.file.op, p.mode, p.line) === key) cands.push(di);
  }
  const trip = leg.tripId ? normalizeId(leg.tripId) : '';
  const byTrip = trip ? cands.filter((di) => !!deps[di][4] && normalizeId(deps[di][4]) === trip) : [];
  if (byTrip.length) cands = byTrip;
  else {
    const byStop = leg.fromStop ? cands.filter((di) => sameStop(stops[deps[di][3]]?.rt || stops[deps[di][3]]?.id, leg.fromStop)) : [];
    if (byStop.length) cands = byStop;
    const to = leg.to?.areaId;
    const byTo = to ? cands.filter((di) => (patterns[deps[di][2]]?.next ?? []).some(([z]) => z === to)) : [];
    if (byTo.length) cands = byTo;
  }
  if (!cands.length) return -1;
  const ways = lastWays(prep);
  const w = ways[deps[cands[0]][2]];
  return cands.every((di) => ways[deps[di][2]] === w) ? cands[0] : -1;
}

/** Départs d'une gare dans les jours de trains chargés : voyage (identifiant normalisé) → rangs ; instants ; marques. */
interface StationLast {
  byTrip: Map<string, number[]>;
  t: number[];
  flags: Uint8Array;
}
const STATION_LAST = new WeakMap<DayIndex, Map<string, StationLast>>();

/**
 * 1.3.1 (R3) : départs de la gare `station` dans les trains des jours chargés (trains/{date}.json), là où l'on peut
 * monter : même règle que les fichiers de zone (tous les trains, sens par destination ou gare suivante commune où l'on
 * peut descendre, de proche en proche), fenêtre couverte par les jours chargés. Une fois par gare et par jeu de jours.
 */
function stationLast(days: readonly DayIndex[], station: string): StationLast {
  const sorted = [...days].sort((a, b) => a.base - b.base);
  const memoKey = `${sorted.map((d) => d.file.date).join(',')}|${station}`;
  const holder = sorted[0];
  let memo = holder ? STATION_LAST.get(holder) : undefined;
  const hit = memo?.get(memoKey);
  if (hit) return hit;
  // tout en nombres (une gare très chargée : 8 000 départs, 50 000 gares suivantes) : ligne, destination, gare
  const K = 1 << 20;
  const lineNum = numbering();
  const headNum = numbering();
  const catNum = numbering();
  const stationNum = numbering();
  const lines = new Map<string, number>();
  const heads = new Map<string, number>();
  const t: number[] = [];
  const same: number[] = [];
  const trips: string[] = [];
  const parent: number[] = [];
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const firstOf = new Map<number, number>();
  const join = (i: number, key: number): void => {
    const j = firstOf.get(key);
    if (j === undefined) firstOf.set(key, i);
    else parent[find(i)] = find(j);
  };
  const here = stationNum(station);
  for (const d of sorted) {
    const at = d.byStation.get(station) ?? [];
    const sid = new Int32Array(d.file.stations.length).fill(-1);
    for (let i = 0; i + 1 < at.length; i += 2) {
      const trip = d.file.trips[at[i]];
      const p = at[i + 1];
      const s = trip?.s;
      if (!s || !s[p] || s[p][2] < 0) continue;
      let line = lines.get(trip.cat);
      if (line === undefined) lines.set(trip.cat, (line = lineNum(lastLineKey('sncb', isSncbBus({ op: 'sncb', cat: trip.cat }) ? 'bus' : 'train', trip.cat))));
      const fr = trip.head?.fr ?? '';
      let head = heads.get(fr);
      if (head === undefined) heads.set(fr, (head = headNum(headKey(fr))));
      const k = t.length;
      parent.push(k);
      let next = 0;
      for (let q = p + 1; q < s.length; q++) {
        if (s[q][1] < 0) continue;
        const x = s[q][0];
        if (sid[x] < 0) sid[x] = d.file.stations[x]?.id ? stationNum(d.file.stations[x].id) : here;
        if (sid[x] === here) continue;
        join(k, (2 * line + 1) * K + sid[x]);
        next++;
      }
      if (!next) {
        parent.pop();
        continue;
      }
      join(k, 2 * line * K + head);
      t.push(d.base + s[p][2] * 60_000);
      same.push(catNum(trip.cat) * K + head);
      trips.push(normalizeId(trip.id));
    }
  }
  const deps: WayDep[] = t.map((x, i) => ({ t: x, way: find(i), same: same[i] }));
  const byTrip = new Map<string, number[]>();
  trips.forEach((id, i) => {
    const list = byTrip.get(id);
    if (list) list.push(i);
    else byTrip.set(id, [i]);
  });
  const out: StationLast = { byTrip, t, flags: lastFlags(deps, lastCover(sorted.map((d) => d.file.date))) };
  if (holder) {
    if (!memo) STATION_LAST.set(holder, (memo = new Map()));
    memo.set(memoKey, out);
  }
  return out;
}

/**
 * 1.3.1 (R3) : une étape en train (ou en bus SNCB) est le dernier train de son sens avant demain, d'après les trains des
 * jours chargés : son voyage à sa gare de montée, à sa minute prévue. Faux s'il est introuvable.
 */
export function trainLegLast(days: readonly DayIndex[], leg: Pick<Leg, 'op' | 'from' | 'tripId' | 'schedDep'>): boolean {
  const station = leg.from?.areaId;
  if (leg.op !== 'sncb' || !station || !leg.tripId || !days.length) return false;
  const x = stationLast(days, station);
  for (const i of x.byTrip.get(normalizeId(leg.tripId)) ?? []) if (Math.abs(x.t[i] - leg.schedDep) <= 30_000) return x.flags[i] === 1;
  return false;
}
