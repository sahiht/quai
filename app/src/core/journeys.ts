/**
 * Trajets : identifiant stable, application du temps réel aux étapes, marche, heure de départ conseillée
 * et alertes (« ! Voie modifiée : … », retard, suppression, « Partir maintenant », travaux).
 *
 * 1.1 : étapes en bus, tram et métro issues des fichiers de ligne (`fromStop`, `toStop`, sans stop_sequence) :
 * De Lijn et TEC par /api/rt (trip_id de LineFile.trips, arrêt reconnu par son identifiant, sinon retard de la
 * dernière mise à jour qui le précède dans l'horaire) ; STIB par /api/stib sur le seul point de montée. Le temps
 * réel de plusieurs trajets est demandé en un appel par opérateur (refreshJourneys).
 */
import type { Op } from '../../../shared/types';
import { normalizeId } from '../../../shared/types';
import { prettyName } from '../../../shared/names';
import type { Alert, Journey, Leg, Settings } from './api';
import type { PreparedArea } from './areas';
import { stibPassages, type StibPassage } from './boards';
import type { RealtimeClient, RtTrip, StibEntry } from './realtime';
import { stibPoint } from './realtime';
import { delayMinutes, headKey, headScore, platformOfStopId, RT_MAX_SHIFT_MS, rtAtStop, rtAtStopShown, rtOccurrence, sameStop, type TripContext } from './rtmerge';
import { locateTrip, type DayIndex } from './trains';
import { hhmm, fit } from './util';
import { cancelAlert, delayAlert, leaveAlert, platformAlert, vehicleLabel, vehicleLabelStart, worksAlert } from './text';

export interface RefreshEnv {
  rt: RealtimeClient;
  now: () => number;
  trainDays: () => Promise<DayIndex[]>;
  area: (id: string) => Promise<PreparedArea | null>;
  works: (op: Op, routes: string[], stops: string[]) => Promise<string[]>;
}

/** Passages STIB acceptés autour de l'horaire prévu d'une étape. */
const STIB_BEFORE_MS = 3 * 60_000;
const STIB_AFTER_MS = 15 * 60_000;

const isRide = (l: Leg) => l.kind === 'ride';

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Identifiant stable d'un trajet (ne dépend que des horaires prévus des véhicules et des marches). */
export function journeyId(legs: Leg[]): string {
  const desc = legs
    .map((l) =>
      l.kind === 'walk'
        ? `w${l.walkMin ?? 0}:${l.to.areaId ?? ''}`
        : `${l.op}/${l.tripId || `${l.line}>${l.head?.fr ?? ''}`}/${l.from.areaId ?? ''}/${l.to.areaId ?? ''}/${l.schedDep}`,
    )
    .join('|');
  return `j${fnv(desc)}${legs.length}`;
}

/** Trajet à partir d'étapes aux horaires prévus (les marches sont recalculées par refreshJourney). */
export function skeleton(legs: Leg[]): Journey {
  const rides = legs.filter(isRide);
  return {
    id: journeyId(legs),
    legs,
    dep: legs[0]?.dep ?? 0,
    arr: legs[legs.length - 1]?.arr ?? 0,
    leaveAt: legs[0]?.dep ?? 0,
    transfers: Math.max(0, rides.length - 1),
    rt: false,
    alerts: [],
  };
}

const cloneLeg = (l: Leg): Leg => ({
  ...l,
  from: { ...l.from },
  to: { ...l.to },
  ...(l.stops ? { stops: l.stops.map((s) => ({ ...s })) } : {}),
});

function resetPlanned(l: Leg): void {
  delete l.rtKept;
  l.dep = l.schedDep;
  l.arr = l.schedArr;
  l.rt = false;
  l.delayMin = 0;
  l.cancelled = false;
  delete l.newPlatform;
  delete l.last;
  for (const s of l.stops ?? []) s.est = s.sched;
}

const stopIdOf = (areaId: string | undefined, platform: string | undefined): string | undefined => {
  if (!areaId) return undefined;
  const key = areaId.slice(areaId.indexOf(':') + 1);
  return platform ? `${key}_${platform}` : key;
};

function applyTrip(l: Leg, trip: RtTrip | null | undefined, days: DayIndex[]): void {
  if (!trip) {
    resetPlanned(l);
    return;
  }
  const loc = l.op === 'sncb' ? locateTrip(days, l) : null;
  const ctx: TripContext = {};
  let s: [number, number, number, string, number][] | undefined;
  let i0 = -1;
  /**
   * 1.2.3 (revue) : départ prévu (ms) d'un arrêt du train, que le flux donne quand il existe (l'arrivée au terminus) ;
   * référence du temps réel de l'arrivée montrée (core/rtmerge.ts, rtAtStopShown), l'arrêt en gare n'est pas du retard.
   */
  let refOfSeq: (seq: number | undefined, shown: number) => number = (_seq, shown) => shown;
  if (loc) {
    const d = loc.day;
    s = d.file.trips[loc.trip].s;
    const stations = d.file.stations;
    const seqs = s;
    ctx.seqOfStop = (stopId) => {
      const base = normalizeId(stopId).replace(/_[^_]+$/, '');
      const p = seqs.findIndex((x) => stations[x[0]]?.id === `sncb:${base}`);
      return p >= 0 ? seqs[p][4] : undefined;
    };
    ctx.schedOfSeq = (seq) => {
      const p = seqs.findIndex((x) => x[4] === seq);
      return p >= 0 ? d.base + seqs[p][2] * 60_000 : undefined;
    };
    refOfSeq = (seq, shown) => {
      const p = seqs.findIndex((x) => x[4] === seq);
      return p >= 0 && p < seqs.length - 1 && seqs[p][2] >= 0 ? d.base + seqs[p][2] * 60_000 : shown;
    };
    i0 = s.findIndex((x) => x[4] === l.fromSeq);
  }
  const lastStop = l.stops?.[l.stops.length - 1];
  const dep = rtAtStop(trip, { seq: l.fromSeq, stopId: l.op === 'sncb' ? stopIdOf(l.from.areaId, l.platform) : undefined, sched: l.schedDep, platform: l.platform }, ctx);
  const arr =
    l.toSeq !== undefined
      ? rtAtStopShown(
          trip,
          { seq: l.toSeq, stopId: l.op === 'sncb' ? stopIdOf(l.to.areaId, lastStop?.platform) : undefined, sched: refOfSeq(l.toSeq, l.schedArr), platform: lastStop?.platform },
          l.schedArr,
          ctx,
        )
      : { rt: dep.rt, est: l.schedArr + (dep.est - l.schedDep), cancelled: false, delaySec: dep.delaySec };
  l.rt = dep.rt;
  l.cancelled = dep.cancelled || arr.cancelled;
  l.dep = dep.est;
  l.arr = Math.max(arr.est, dep.est);
  l.delayMin = l.cancelled ? 0 : delayMinutes(dep.est, l.schedDep);
  if (dep.newPlatform && !l.cancelled) l.newPlatform = dep.newPlatform;
  else delete l.newPlatform;
  const stops = l.stops ?? [];
  stops.forEach((so, q) => {
    if (q === 0) so.est = l.dep;
    else if (q === stops.length - 1) so.est = l.arr;
    else if (s && i0 >= 0 && s[i0 + q]) {
      const x = s[i0 + q];
      so.est = rtAtStopShown(trip, { seq: x[4], stopId: stopIdOf(so.areaId, x[3] || undefined), sched: refOfSeq(x[4], so.sched), platform: x[3] || undefined }, so.sched, ctx).est;
    } else so.est = so.sched + (dep.est - l.schedDep);
  });
}

/**
 * Passage STIB le plus proche de l'horaire prévu (même ligne, destination proche). Un « Temps théorique »
 * laisse l'étape en horaire prévu ; « Dernier passage » est retenu dans les deux cas.
 */
function applyStib(l: Leg, passages: StibPassage[]): void {
  const want = headKey(l.head?.fr ?? '');
  const wantNl = headKey(l.head?.nl ?? '');
  let best: StibPassage | undefined;
  for (const x of passages) {
    if (x.line !== l.line) continue;
    const score = Math.max(headScore(headKey(x.head.fr), want), headScore(headKey(x.head.nl), wantNl));
    if (score <= 0) continue;
    if (x.t < l.schedDep - STIB_BEFORE_MS || x.t > l.schedDep + STIB_AFTER_MS) continue;
    if (!best || Math.abs(x.t - l.schedDep) < Math.abs(best.t - l.schedDep)) best = x;
  }
  if (!best || !best.rt) {
    resetPlanned(l);
    if (best?.last) l.last = true;
    return;
  }
  const shift = best.t - l.schedDep;
  l.rt = true;
  l.cancelled = false;
  l.dep = best.t;
  l.arr = l.schedArr + shift;
  l.delayMin = delayMinutes(best.t, l.schedDep);
  delete l.newPlatform;
  if (best.last) l.last = true;
  else delete l.last;
  const stops = l.stops ?? [];
  stops.forEach((so, q) => {
    so.est = q === 0 ? l.dep : q === stops.length - 1 ? l.arr : so.sched + shift;
  });
}

/** Passages STIB autour de l'horaire prévu d'une étape, sur tous les points d'arrêt de sa zone de départ. */
function legPassages(l: Leg, prep: PreparedArea | null, map: Map<string, StibEntry[] | null>): StibPassage[] {
  if (!prep) return [];
  return prep.file.stops.flatMap((st, i) => stibPassages(prep, i, map.get(stibPoint(st.rt || st.id)) ?? [], l.schedDep - STIB_BEFORE_MS, l.schedDep + STIB_AFTER_MS));
}

/**
 * Passages STIB du point de montée d'une étape 1.1 (`fromStop`) autour de son horaire prévu : même ligne ; une
 * destination vide vaut celle de l'étape (le point d'arrêt est propre à un sens) ; « Ne pas embarquer » écarté.
 */
function pointPassages(l: Leg, entries: readonly StibEntry[]): StibPassage[] {
  const out: StibPassage[] = [];
  for (const e of entries) {
    if (e.noBoarding || e.line !== l.line) continue;
    const blank = !e.dest.fr.trim() && !e.dest.nl.trim();
    const head = blank ? (l.head ?? { fr: '', nl: '' }) : { fr: prettyName(e.dest.fr), nl: prettyName(e.dest.nl) };
    for (const t of e.times) {
      if (t < l.schedDep - STIB_BEFORE_MS || t > l.schedDep + STIB_AFTER_MS) continue;
      const x: StibPassage = { t, line: e.line, pi: -1, head, rt: !e.planned, last: !!e.last };
      if (e.msg) x.msg = e.msg;
      out.push(x);
    }
  }
  return out;
}

interface UrbanAt {
  rt: boolean;
  est: number;
  cancelled: boolean;
  /** Heure tirée du flux (mise à jour de l'arrêt, ou d'un arrêt qui le précède dans l'horaire). */
  known: boolean;
}

/**
 * Temps réel GTFS-RT d'un arrêt d'une étape 1.1 (bus, tram De Lijn ou TEC), sans stop_sequence : mise à jour de
 * l'arrêt (identifiant temps réel), sinon retard de la dernière mise à jour dont l'horaire prévu (heure estimée moins
 * retard) précède celui de l'arrêt ; rien d'utilisable : à l'heure, `known` faux.
 */
function urbanAt(trip: RtTrip | null | undefined, stopId: string | undefined, sched: number): UrbanAt {
  if (!trip) return { rt: false, est: sched, cancelled: false, known: false };
  if (trip.cancelled) return { rt: true, est: sched, cancelled: true, known: true };
  const plausible = (est: number): UrbanAt =>
    Math.abs(est - sched) > RT_MAX_SHIFT_MS ? { rt: false, est: sched, cancelled: false, known: false } : { rt: true, est, cancelled: false, known: true };
  const match = stopId ? trip.u.find((u) => sameStop(u[1], stopId)) : undefined;
  if (match) {
    if (match[4] === 1) return { rt: true, est: sched, cancelled: true, known: true };
    if (match[3] !== null) return plausible(match[3] * 1000);
    if (match[2] !== null) return plausible(sched + match[2] * 1000);
  }
  let best: { at: number; delay: number } | null = null;
  for (const u of trip.u) {
    if (u[4] === 1 || u[2] === null || u[3] === null) continue;
    const at = (u[3] - u[2]) * 1000;
    if (at <= sched + 30_000 && (!best || at > best.at)) best = { at, delay: u[2] };
  }
  return best ? plausible(sched + best.delay * 1000) : { rt: true, est: sched, cancelled: false, known: false };
}

/** Applique le temps réel GTFS-RT à une étape 1.1 en bus, tram ou métro (De Lijn, TEC). */
function applyUrbanTrip(l: Leg, trip: RtTrip | null | undefined): void {
  if (!trip) {
    resetPlanned(l);
    return;
  }
  const dep = urbanAt(trip, l.fromStop, l.schedDep);
  const arr0 = urbanAt(trip, l.toStop, l.schedArr);
  // rien de connu à la descente : le retard de la montée se propage (règle GTFS-RT)
  const arr = arr0.known ? arr0 : { ...arr0, est: l.schedArr + (dep.est - l.schedDep) };
  l.rt = dep.rt;
  l.cancelled = dep.cancelled || arr.cancelled;
  l.dep = dep.est;
  l.arr = Math.max(arr.est, dep.est);
  l.delayMin = l.cancelled ? 0 : delayMinutes(dep.est, l.schedDep);
  delete l.newPlatform;
  const d0 = l.dep - l.schedDep;
  const d1 = l.arr - l.schedArr;
  const span = l.schedArr - l.schedDep;
  const stops = l.stops ?? [];
  stops.forEach((so, q) => {
    if (q === 0) so.est = l.dep;
    else if (q === stops.length - 1) so.est = l.arr;
    else so.est = so.sched + Math.round(span > 0 ? d0 + ((d1 - d0) * (so.sched - l.schedDep)) / span : d0);
  });
}

/**
 * Panne du temps réel (PRD M8.5), trajets autres que le suivi : suppression, arrêt sauté ou voie modifiée connus depuis
 * 15 min au plus (RealtimeClient `remembered`) ; horaire prévu.
 */
function applyMemoryLeg(l: Leg, mem: RtTrip): void {
  resetPlanned(l);
  if (mem.cancelled) {
    l.cancelled = true;
    return;
  }
  const sncb = l.op === 'sncb';
  const lastStop = l.stops?.[l.stops.length - 1];
  const find = (seq: number | undefined, stopId: string | undefined) =>
    mem.u.find((x) => (x[0] !== null && seq !== undefined && x[0] === seq) || sameStop(x[1], stopId));
  const dep = find(l.fromSeq, sncb ? stopIdOf(l.from.areaId, l.platform) : l.fromStop);
  const arr = find(l.toSeq, sncb ? stopIdOf(l.to.areaId, lastStop?.platform) : l.toStop);
  if (dep?.[4] === 1 || arr?.[4] === 1) {
    l.cancelled = true;
    return;
  }
  const p = platformOfStopId(dep?.[1]);
  if (p && l.platform && p !== l.platform) l.newPlatform = p;
}

/**
 * 1.2.5 (PRD-1.2.5 § 5) : trajet suivi pendant une panne : le dernier état connu du voyage, depuis 15 min au plus, le
 * retard compris ; l'étape reste « ~ » (pas en direct) et porte `rtKept` (« Temps réel coupé : derniers retards
 * connus »). Un retard gardé ne recule jamais l'heure de départ à pied (recompute) ni ne casse une correspondance
 * (brokenConnection) : il informe, il ne décide pas.
 */
function applyKept(l: Leg, mem: RtTrip, days: DayIndex[], urban: boolean): void {
  if (urban) applyUrbanTrip(l, mem);
  else applyTrip(l, mem, days);
  l.rt = false;
  if (l.cancelled || l.delayMin || l.newPlatform) l.rtKept = true;
}

/**
 * Applique le temps réel aux étapes en véhicule (en place), un appel par opérateur. Source en erreur → horaire prévu,
 * avec l'état gardé (M8.5) ; `followed` (1.2.5) : trajet suivi, ses retards gardés compris.
 */
export async function applyRealtime(legs: Leg[], env: RefreshEnv, followed = false): Promise<void> {
  const rides = legs.filter(isRide);
  const now = env.now();
  // flux indexé par trip_id sans date : seules les étapes proches de maintenant reçoivent le temps réel
  const live = (l: Leg) => rtOccurrence(l.schedDep, now);
  const tripIds = new Map<Op, Set<string>>();
  for (const l of rides) {
    if (!l.op || l.op === 'stib' || !l.tripId || !live(l)) continue;
    let set = tripIds.get(l.op);
    if (!set) tripIds.set(l.op, (set = new Set()));
    set.add(normalizeId(l.tripId));
  }
  const stibLegs = rides.filter((l) => l.op === 'stib' && live(l));
  const stibAreaOf = new Map<Leg, PreparedArea | null>();
  // étapes 1.0 (sans point de montée) : tous les points de la zone de montée
  await Promise.all(
    stibLegs
      .filter((l) => !l.fromStop)
      .map(async (l) => {
        let prep: PreparedArea | null = null;
        try {
          prep = l.from.areaId ? await env.area(l.from.areaId) : null;
        } catch {
          prep = null;
        }
        stibAreaOf.set(l, prep);
      }),
  );
  const points = new Set<string>();
  for (const l of stibLegs) {
    if (l.fromStop) {
      const p = stibPoint(l.fromStop);
      if (p) points.add(p);
    }
  }
  for (const prep of stibAreaOf.values()) for (const st of prep?.file.stops ?? []) points.add(stibPoint(st.rt || st.id));
  const allPoints = [...points].filter(Boolean);
  const [tripRes, stibRes, days] = await Promise.all([
    Promise.all([...tripIds].map(async ([op, ids]) => [op, await env.rt.trips(op, [...ids])] as const)),
    allPoints.length ? env.rt.stib(allPoints) : Promise.resolve(null),
    rides.some((l) => l.op === 'sncb') ? env.trainDays().catch(() => [] as DayIndex[]) : Promise.resolve([] as DayIndex[]),
  ]);
  const byOp = new Map(tripRes);
  for (const l of rides) {
    delete l.rtKept;
    if (!live(l)) {
      resetPlanned(l);
      continue;
    }
    if (l.op === 'stib') {
      const ok = stibRes && !stibRes.error;
      if (!ok) applyStib(l, []);
      else if (l.fromStop) applyStib(l, pointPassages(l, stibRes.map.get(stibPoint(l.fromStop)) ?? []));
      else applyStib(l, legPassages(l, stibAreaOf.get(l) ?? null, stibRes.map));
      continue;
    }
    const res = l.op ? byOp.get(l.op) : undefined;
    const id = l.tripId ? normalizeId(l.tripId) : '';
    const trip = res && id ? res.map.get(id) : undefined;
    const mem = !trip && res?.error && id ? res.remembered?.get(id) : undefined;
    const urban = l.op !== 'sncb' && l.fromSeq === undefined && !!(l.fromStop || l.toStop);
    if (mem && followed) applyKept(l, mem, days, urban);
    else if (mem) applyMemoryLeg(l, mem);
    else if (urban) applyUrbanTrip(l, trip);
    else applyTrip(l, trip, days);
  }
}

/** Recalcule les marches, l'heure de départ conseillée et les champs du trajet. */
export function recompute(j: Journey, legs: Leg[], settings: Settings, now: number, fresh: boolean): Journey {
  const margin = Math.max(0, settings.alerts.leaveBeforeMin) * 60_000;
  const firstRide = legs.find(isRide);
  // 1.2.5 : un retard gardé (temps réel coupé) ne recule jamais le départ à pied : le véhicule a pu le rattraper
  const goBy = firstRide ? (firstRide.rtKept ? Math.min(firstRide.dep, firstRide.schedDep) : firstRide.dep) : 0;
  legs.forEach((l, i) => {
    if (l.kind !== 'walk') return;
    const w = (l.walkMin ?? 0) * 60_000;
    if (i === 0) {
      if (!firstRide) return;
      const leave = goBy - w - margin;
      const schedLeave = firstRide.schedDep - w - margin;
      const started = !fresh && Number.isFinite(l.dep) && now >= l.dep && l.dep <= firstRide.dep;
      l.dep = started ? l.dep : leave;
      l.arr = l.dep + w;
      l.schedDep = schedLeave;
      l.schedArr = schedLeave + w;
    } else {
      const prev = legs[i - 1];
      l.dep = prev.arr;
      l.arr = l.dep + w;
      l.schedDep = prev.schedArr;
      l.schedArr = l.schedDep + w;
    }
  });
  const firstWalk = legs[0]?.kind === 'walk' ? legs[0] : undefined;
  const leaveAt = firstRide ? goBy - (firstWalk ? (firstWalk.walkMin ?? 0) * 60_000 : 0) - margin : (legs[0]?.dep ?? j.leaveAt);
  const rides = legs.filter(isRide);
  return {
    ...j,
    legs,
    dep: legs[0]?.dep ?? j.dep,
    arr: legs[legs.length - 1]?.arr ?? j.arr,
    leaveAt,
    transfers: Math.max(0, rides.length - 1),
    rt: rides.every((l) => l.rt === true), // vrai aussi pour un trajet entièrement à pied
    alerts: [],
  };
}

/** Alertes dans l'ordre d'importance : voie, retard, suppression, départ à pied, travaux. */
export function buildAlerts(j: Journey, settings: Settings, now: number, works: string[]): Alert[] {
  const A = settings.alerts;
  const rides = j.legs.filter(isRide);
  const out: Alert[] = [];
  const push = (kind: Alert['kind'], text: string) => out.push({ kind, text: fit(text, 48), at: now });
  if (A.platform) {
    for (const l of rides) {
      if (l.newPlatform && !l.cancelled && now < l.dep) push('platform', platformAlert(vehicleLabel(l), l.newPlatform));
    }
  }
  if (A.delay) {
    for (const l of rides) {
      if (!l.cancelled && (l.delayMin ?? 0) >= Math.max(1, A.delayMin) && now < l.arr) push('delay', delayAlert(vehicleLabelStart(l), hhmm(l.schedDep), l.delayMin ?? 0));
    }
  }
  if (A.cancel) {
    for (const l of rides) {
      if (l.cancelled && now < l.schedArr) push('cancel', cancelAlert(vehicleLabelStart(l), hhmm(l.schedDep)));
    }
  }
  const firstWalk = j.legs[0]?.kind === 'walk' ? j.legs[0] : undefined;
  const firstRide = rides[0];
  if (A.leave && firstWalk && firstRide && !firstRide.cancelled && now >= j.leaveAt && now < firstRide.dep) {
    push('leave', leaveAlert(firstWalk.walkMin ?? 0));
  }
  if (A.works) for (const w of works) push('works', worksAlert(w));
  return out;
}

async function worksFor(j: Journey, env: RefreshEnv): Promise<string[]> {
  const texts: string[] = [];
  for (const l of j.legs.filter(isRide)) {
    if (!l.op) continue;
    let stops: string[] = [];
    let routes: string[] = [];
    if (l.op === 'sncb') {
      stops = (l.stops ?? []).map((s) => s.areaId).filter((x): x is string => !!x).map((id) => id.slice(id.indexOf(':') + 1));
    } else {
      for (const id of [l.from.areaId, l.to.areaId]) {
        if (!id) continue;
        try {
          const prep = await env.area(id);
          if (!prep) continue;
          stops.push(...prep.file.stops.map((s) => s.rt || s.id));
          routes.push(...prep.file.patterns.filter((p) => p.line === l.line).map((p) => p.route));
        } catch {
          /* rien */
        }
      }
      routes = [...new Set(routes)];
    }
    try {
      texts.push(...(await env.works(l.op, routes, [...new Set(stops)])));
    } catch {
      /* rien */
    }
  }
  return [...new Set(texts)];
}

/**
 * Applique le temps réel à plusieurs trajets (un appel au relais par opérateur pour tous) et recalcule heure de
 * départ conseillée et alertes. Étiquette et raison sont gardées.
 */
export async function refreshJourneys(js: readonly Journey[], settings: Settings, env: RefreshEnv, fresh = false, followed = false): Promise<Journey[]> {
  const legs = js.map((j) => j.legs.map(cloneLeg));
  await applyRealtime(legs.flat(), env, followed);
  const now = env.now();
  return Promise.all(
    js.map(async (j, i) => {
      const out = recompute(j, legs[i], settings, now, fresh);
      const works = settings.alerts.works ? await worksFor(out, env) : [];
      out.alerts = buildAlerts(out, settings, now, works);
      return out;
    }),
  );
}

/** Applique le temps réel à un trajet et recalcule heure de départ conseillée et alertes (`followed` : trajet suivi). */
export async function refreshJourney(j: Journey, settings: Settings, env: RefreshEnv, fresh = false, followed = false): Promise<Journey> {
  return (await refreshJourneys([j], settings, env, fresh, followed))[0];
}

/**
 * Rang de la première étape en véhicule partie avant l'arrivée du véhicule précédent (marche comprise), -1 sinon.
 * 1.2.5 : un retard gardé (temps réel coupé, `rtKept`) n'y compte pas : seul le temps réel en direct fait recalculer.
 */
export function brokenConnection(j: Journey): number {
  let prev: Leg | undefined;
  let walk = 0;
  for (let i = 0; i < j.legs.length; i++) {
    const l = j.legs[i];
    if (l.kind === 'walk') {
      walk += (l.walkMin ?? 0) * 60_000;
      continue;
    }
    if (prev && (l.rtKept ? l.schedDep : l.dep) < (prev.rtKept ? prev.schedArr : prev.arr) + walk) return i;
    prev = l;
    walk = 0;
  }
  return -1;
}
