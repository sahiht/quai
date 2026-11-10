/**
 * Trajets : identifiant stable, application du temps réel aux étapes, marche, heure de départ conseillée
 * et alertes (« ! Voie modifiée : … », retard, suppression, « Partir maintenant », travaux).
 */
import type { Op } from '../../../shared/types';
import { normalizeId } from '../../../shared/types';
import type { Alert, Journey, Leg, Settings } from './api';
import type { PreparedArea } from './areas';
import { stibPassages, type StibPassage } from './boards';
import type { RealtimeClient, RtTrip, StibEntry } from './realtime';
import { stibPoint } from './realtime';
import { delayMinutes, headKey, headScore, rtAtStop, rtOccurrence, type TripContext } from './rtmerge';
import { locateTrip, type DayIndex } from './trains';
import { hhmm, fit } from './util';
import { cancelAlert, delayAlert, leaveAlert, platformAlert, vehicleLabel, worksAlert } from './text';

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
    i0 = s.findIndex((x) => x[4] === l.fromSeq);
  }
  const lastStop = l.stops?.[l.stops.length - 1];
  const dep = rtAtStop(trip, { seq: l.fromSeq, stopId: l.op === 'sncb' ? stopIdOf(l.from.areaId, l.platform) : undefined, sched: l.schedDep, platform: l.platform }, ctx);
  const arr =
    l.toSeq !== undefined
      ? rtAtStop(trip, { seq: l.toSeq, stopId: l.op === 'sncb' ? stopIdOf(l.to.areaId, lastStop?.platform) : undefined, sched: l.schedArr, platform: lastStop?.platform }, ctx)
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
      so.est = rtAtStop(trip, { seq: x[4], stopId: stopIdOf(so.areaId, x[3] || undefined), sched: so.sched, platform: x[3] || undefined }, ctx).est;
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

/** Applique le temps réel aux étapes en véhicule (en place). Une source en erreur → horaire prévu. */
export async function applyRealtime(legs: Leg[], env: RefreshEnv): Promise<void> {
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
  await Promise.all(
    stibLegs.map(async (l) => {
      let prep: PreparedArea | null = null;
      try {
        prep = l.from.areaId ? await env.area(l.from.areaId) : null;
      } catch {
        prep = null;
      }
      stibAreaOf.set(l, prep);
    }),
  );
  const allPoints = [...new Set([...stibAreaOf.values()].flatMap((prep) => (prep ? prep.file.stops.map((st) => stibPoint(st.rt || st.id)) : [])))];
  const [tripRes, stibRes, days] = await Promise.all([
    Promise.all([...tripIds].map(async ([op, ids]) => [op, await env.rt.trips(op, [...ids])] as const)),
    allPoints.length ? env.rt.stib(allPoints) : Promise.resolve(null),
    rides.some((l) => l.op === 'sncb') ? env.trainDays().catch(() => [] as DayIndex[]) : Promise.resolve([] as DayIndex[]),
  ]);
  const byOp = new Map(tripRes);
  for (const l of rides) {
    if (!live(l)) {
      resetPlanned(l);
      continue;
    }
    if (l.op === 'stib') {
      applyStib(l, stibRes && !stibRes.error ? legPassages(l, stibAreaOf.get(l) ?? null, stibRes.map) : []);
      continue;
    }
    const res = l.op ? byOp.get(l.op) : undefined;
    const trip = res && l.tripId ? res.map.get(normalizeId(l.tripId)) : undefined;
    applyTrip(l, trip, days);
  }
}

/** Recalcule les marches, l'heure de départ conseillée et les champs du trajet. */
export function recompute(j: Journey, legs: Leg[], settings: Settings, now: number, fresh: boolean): Journey {
  const margin = Math.max(0, settings.alerts.leaveBeforeMin) * 60_000;
  const firstRide = legs.find(isRide);
  legs.forEach((l, i) => {
    if (l.kind !== 'walk') return;
    const w = (l.walkMin ?? 0) * 60_000;
    if (i === 0) {
      if (!firstRide) return;
      const leave = firstRide.dep - w - margin;
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
  const leaveAt = firstRide ? firstRide.dep - (firstWalk ? (firstWalk.walkMin ?? 0) * 60_000 : 0) - margin : (legs[0]?.dep ?? j.leaveAt);
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
      if (!l.cancelled && (l.delayMin ?? 0) >= Math.max(1, A.delayMin) && now < l.arr) push('delay', delayAlert(vehicleLabel(l), hhmm(l.schedDep), l.delayMin ?? 0));
    }
  }
  if (A.cancel) {
    for (const l of rides) {
      if (l.cancelled && now < l.schedArr) push('cancel', cancelAlert(vehicleLabel(l), hhmm(l.schedDep)));
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

/** Applique le temps réel à un trajet et recalcule heure de départ conseillée et alertes. */
export async function refreshJourney(j: Journey, settings: Settings, env: RefreshEnv, fresh = false): Promise<Journey> {
  const legs = j.legs.map(cloneLeg);
  await applyRealtime(legs, env);
  const now = env.now();
  const out = recompute(j, legs, settings, now, fresh);
  const works = settings.alerts.works ? await worksFor(out, env) : [];
  out.alerts = buildAlerts(out, settings, now, works);
  return out;
}
