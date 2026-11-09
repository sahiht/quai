/**
 * Trajets porte à porte (portée v1.0, SPEC § 5.4) :
 *  1. lignes directes urbaines (STIB, De Lijn, TEC) entre les zones à distance de marche du départ et de
 *     l'arrivée, via patterns.next ;
 *  2. trains (direct ou une correspondance) entre gares à distance de marche, avec marche au début et à la fin.
 *     Sans gare à distance de marche, on prend au mieux la ou les gares les plus proches jusqu'à 2 × maxWalkMin
 *     (ex. le bureau à 12 min de Bruxelles-Central pour une marche maximale de 10 min) ;
 *  3. au mieux, une ligne urbaine directe pour rejoindre la gare de départ ou pour finir après la gare
 *     d'arrivée, quand la marche dépasse maxWalkMin.
 * Marche : départ et arrivée à moins de 100 m → aucun trajet ; arrivée à moins de maxWalkMin à pied → une seule
 * étape à pied ; jamais un trajet en véhicule plus lent que d'y aller à pied (sinon on propose la marche).
 * Sélection sur les horaires prévus : un seul trajet par identité (voyages + montée/descente, sans la date),
 * départ dans les 23 h, trajets dominés retirés ; puis temps réel, tri par arrivée, 3 au plus.
 */
import type { AreaSummary, Meta, Names, Op } from '../../../shared/types';
import { normalizeId } from '../../../shared/types';
import type { Endpoint, Journey, Leg, Settings } from './api';
import { lastDepartureOfPattern, nextDeparturesOfPattern, tileReachM, type PreparedArea } from './areas';
import { QuaiError } from './errors';
import { skeleton } from './journeys';
import { mapPool } from './net';
import { JOURNEY_HORIZON_MS, trainLeg, uniqueBy, withinHorizon, type DayIndex, type TrainEngine } from './trains';
import { distanceM, localMinutes, walkMinutes } from './util';

export interface NearArea {
  a: AreaSummary;
  d: number; // mètres
}

export interface PlanEnv {
  meta: Meta;
  areasAround(lat: number, lon: number, radiusM: number): Promise<NearArea[]>;
  area(id: string): Promise<PreparedArea | null>;
  trainDays(): Promise<DayIndex[]>;
  engine: TrainEngine;
  refresh(j: Journey): Promise<Journey>;
}

interface Point {
  name: Names;
  lat: number;
  lon: number;
  areaId?: string;
  op?: Op;
}

interface Access {
  a: AreaSummary;
  d: number;
  walk: number; // minutes de marche entre l'extrémité et la zone (0 : la zone elle-même)
}

interface Cand {
  legs: Leg[];
  dep: number;
  arr: number;
  transfers: number;
  walk: number;
}

export const HERE_NAME: Names = { fr: 'Ma position', nl: 'Mijn positie' };
const MAX_RESULTS = 3;
const KEEP_BEFORE_RT = 5;
const FAR_MAX_M = 2000;
const STATION_ACCESS_M = 400;
const TRANSFER_BUFFER_MS = 2 * 60_000;
const MAX_URBAN_ORIGINS = 12;
const MIN = 60_000;
/** Départ et arrivée plus proches : rien à proposer. */
export const SAME_PLACE_M = 100;
/** Jusqu'à cette durée, la marche directe sert de référence : aucun véhicule plus lent n'est proposé. */
const WALK_REFERENCE_MAX_MIN = 60;

function resolve(e: Endpoint, settings: Settings, here?: { lat: number; lon: number }): Point {
  if (e.type === 'here') {
    if (!here || !Number.isFinite(here.lat) || !Number.isFinite(here.lon)) throw new QuaiError('hereMissing');
    return { name: HERE_NAME, lat: here.lat, lon: here.lon };
  }
  if (e.type === 'place') {
    const p = settings.places.find((x) => x.id === e.placeId);
    if (!p) throw new QuaiError('placeUnknown');
    return { name: { fr: p.label, nl: p.label }, lat: p.lat, lon: p.lon };
  }
  return { name: e.name, lat: e.lat, lon: e.lon, areaId: e.areaId, op: e.op };
}

const at = (x: Point | Access) =>
  'a' in x ? { name: x.a.n, lat: x.a.lat, lon: x.a.lon, areaId: x.a.id } : { name: x.name, lat: x.lat, lon: x.lon, ...(x.areaId ? { areaId: x.areaId } : {}) };

function walkLeg(from: Point | Access, to: Point | Access, minutes: number, t0: number): Leg {
  return { kind: 'walk', from: at(from), to: at(to), dep: t0, arr: t0 + minutes * MIN, schedDep: t0, schedArr: t0 + minutes * MIN, walkMin: minutes };
}

function urbanLeg(prep: PreparedArea, di: number, to: AreaSummary, minutes: number): Leg {
  const dep = prep.file.deps[di];
  const p = prep.file.patterns[dep[2]];
  const st = prep.file.stops[dep[3]];
  const t = prep.times[di];
  const arr = t + minutes * MIN;
  const leg: Leg = {
    kind: 'ride',
    from: { name: prep.file.n, lat: prep.file.lat, lon: prep.file.lon, areaId: prep.file.id },
    to: { name: to.n, lat: to.lat, lon: to.lon, areaId: to.id },
    dep: t,
    arr,
    schedDep: t,
    schedArr: arr,
    op: prep.file.op,
    mode: p.mode,
    line: p.line,
    head: p.head,
    fromSeq: dep[5],
    rt: false,
    delayMin: 0,
    cancelled: false,
    stops: [
      { name: prep.file.n, areaId: prep.file.id, sched: t, est: t },
      { name: to.n, areaId: to.id, sched: arr, est: arr },
    ],
  };
  if (dep[4]) leg.tripId = dep[4];
  if (st?.platform) leg.platform = st.platform;
  return leg;
}

/** Assemble des étapes : marche initiale juste avant le 1er véhicule, marches suivantes après le véhicule précédent. */
function assemble(parts: (Leg | { walkFrom: Point | Access; walkTo: Point | Access; minutes: number })[]): Cand | null {
  const legs: Leg[] = [];
  parts.forEach((x, i) => {
    if ('kind' in x) {
      legs.push(x);
      return;
    }
    if (x.minutes <= 0) return;
    if (i === 0) {
      const next = parts.find((y): y is Leg => 'kind' in y);
      if (!next) return;
      legs.push(walkLeg(x.walkFrom, x.walkTo, x.minutes, next.schedDep - x.minutes * MIN));
    } else {
      const prev = legs[legs.length - 1];
      legs.push(walkLeg(x.walkFrom, x.walkTo, x.minutes, prev ? prev.schedArr : 0));
    }
  });
  const rides = legs.filter((l) => l.kind === 'ride');
  if (!rides.length) return null;
  // cohérence des correspondances (marche comprise)
  for (let i = 1; i < legs.length; i++) {
    if (legs[i].kind === 'ride' && legs[i].schedDep < legs[i - 1].schedArr) return null;
  }
  return {
    legs,
    dep: legs[0].schedDep,
    arr: legs[legs.length - 1].schedArr,
    transfers: rides.length - 1,
    walk: legs.reduce((s, l) => s + (l.kind === 'walk' ? (l.walkMin ?? 0) : 0), 0),
  };
}

/** Identité d'un trajet : véhicules (trip_id, ou ligne + direction + heure pour la STIB) et zones de montée/descente. */
function candidateIdentity(c: Cand): string {
  return c.legs
    .filter((l) => l.kind === 'ride')
    .map((l) => {
      const vehicle = l.tripId ? normalizeId(l.tripId) : `${l.line}>${l.head?.fr ?? ''}@${localMinutes(l.schedDep)}`;
      return `${l.op}/${vehicle}:${l.from.areaId ?? ''}>${l.to.areaId ?? ''}`;
    })
    .join('|');
}

const betterCand = (a: Cand, b: Cand) =>
  a.arr < b.arr || (a.arr === b.arr && (a.transfers < b.transfers || (a.transfers === b.transfers && (a.walk < b.walk || (a.walk === b.walk && a.dep > b.dep)))));

/** Retire les trajets dominés (part plus tôt et arrive plus tard, sans moins de correspondances). */
export function selectCandidates<T extends { dep: number; arr: number; transfers: number; walk: number }>(cands: T[], max: number): T[] {
  const sorted = [...cands].sort((a, b) => b.dep - a.dep || a.arr - b.arr || a.transfers - b.transfers || a.walk - b.walk);
  const keep: T[] = [];
  for (const c of sorted) {
    if (keep.some((k) => k.dep >= c.dep && k.arr <= c.arr && k.transfers <= c.transfers)) continue;
    keep.push(c);
  }
  keep.sort((a, b) => a.arr - b.arr || a.transfers - b.transfers || a.walk - b.walk || b.dep - a.dep);
  return keep.slice(0, max);
}

async function accessAround(env: PlanEnv, pt: Point, radiusM: number): Promise<Access[]> {
  const list = await env.areasAround(pt.lat, pt.lon, radiusM);
  const out: Access[] = list.map(({ a, d }) => ({ a, d, walk: a.id === pt.areaId ? 0 : walkMinutes(d) }));
  if (pt.areaId && !out.some((x) => x.a.id === pt.areaId)) {
    const prep = await env.area(pt.areaId);
    if (prep) out.unshift({ a: prep.summary, d: 0, walk: 0 });
  }
  return out.sort((x, y) => x.walk - y.walk || x.d - y.d);
}

export async function planJourneys(
  from: Endpoint,
  to: Endpoint,
  after: number,
  settings: Settings,
  here: { lat: number; lon: number } | undefined,
  env: PlanEnv,
): Promise<Journey[]> {
  const O = resolve(from, settings, here);
  const D = resolve(to, settings, here);
  const maxWalk = Math.min(30, Math.max(1, Math.round(settings.maxWalkMin || 10)));

  // Marche directe : déjà sur place, ou destination à distance de marche
  const directM = distanceM(O, D);
  if (directM <= SAME_PLACE_M) return [];
  const directWalk = walkMinutes(directM);
  const walkOnly = () => env.refresh(skeleton([walkLeg(O, D, directWalk, after)]));
  if (directWalk <= maxWalk) return [await walkOnly()];
  const farO = Math.min(FAR_MAX_M, tileReachM(O.lat, env.meta.tile));
  const farD = Math.min(FAR_MAX_M, tileReachM(D.lat, env.meta.tile));

  const [allO, allD] = await Promise.all([accessAround(env, O, farO), accessAround(env, D, farD)]);
  const nearO = allO.filter((x) => x.walk <= maxWalk);
  const nearD = allD.filter((x) => x.walk <= maxWalk);
  const isSncb = (x: Access) => x.a.op === 'sncb';

  const stationsO = O.op === 'sncb' ? allO.filter((x) => x.a.id === O.areaId) : nearO.filter(isSncb);
  const stationsD = D.op === 'sncb' ? allD.filter((x) => x.a.id === D.areaId) : nearD.filter(isSncb);
  const longO = stationsO.length ? [] : allO.filter((x) => isSncb(x) && x.walk <= 2 * maxWalk).slice(0, 2);
  const longD = stationsD.length ? [] : allD.filter((x) => isSncb(x) && x.walk <= 2 * maxWalk).slice(0, 2);
  const trainFrom = [...stationsO, ...longO];
  const trainTo = [...stationsD, ...longD];

  const urbanO = nearO.filter((x) => !isSncb(x)).slice(0, MAX_URBAN_ORIGINS);
  const preps = new Map<string, PreparedArea>();
  await mapPool(urbanO, 4, async (x) => {
    const p = await env.area(x.a.id).catch(() => null);
    if (p) preps.set(x.a.id, p);
  });

  const cands: Cand[] = [];
  const push = (c: Cand | null) => {
    if (c) cands.push(c);
  };
  const destMap = new Map(nearD.map((x) => [x.a.id, x]));

  // 1. lignes directes urbaines
  for (const o of urbanO) {
    const prep = preps.get(o.a.id);
    if (!prep) continue;
    prep.file.patterns.forEach((p, pi) => {
      let best: { acc: Access; m: number } | null = null;
      for (const [id, m] of p.next) {
        const acc = destMap.get(id);
        if (!acc || id === o.a.id) continue;
        if (!best || m + acc.walk < best.m + best.acc.walk) best = { acc, m };
      }
      if (!best) return;
      const b = best;
      for (const di of nextDeparturesOfPattern(prep, pi, after + o.walk * MIN, 3)) {
        push(assemble([{ walkFrom: O, walkTo: o, minutes: o.walk }, urbanLeg(prep, di, b.acc.a, b.m), { walkFrom: b.acc, walkTo: D, minutes: b.acc.walk }]));
      }
    });
  }

  // 2. trains entre gares à distance de marche
  let days: DayIndex[] = [];
  if (trainFrom.length || (!stationsO.length && allO.some(isSncb))) days = await env.trainDays();
  for (const so of trainFrom) {
    for (const sd of trainTo) {
      if (so.a.id === sd.a.id) continue;
      for (const opt of env.engine.search(days, so.a.id, sd.a.id, after + so.walk * MIN, 3)) {
        push(assemble([{ walkFrom: O, walkTo: so, minutes: so.walk }, ...opt.rides.map(trainLeg), { walkFrom: sd, walkTo: D, minutes: sd.walk }]));
      }
    }
  }

  // 3a. ligne urbaine pour rejoindre une gare trop loin à pied
  if (!stationsO.length && trainTo.length) {
    for (const f of allO.filter(isSncb).slice(0, 3)) {
      const around = (await env.areasAround(f.a.lat, f.a.lon, STATION_ACCESS_M)).filter((x) => x.a.op !== 'sncb');
      const accessF = new Map(around.map((x) => [x.a.id, x]));
      for (const o of urbanO) {
        const prep = preps.get(o.a.id);
        if (!prep) continue;
        prep.file.patterns.forEach((p, pi) => {
          let best: { u: NearArea; m: number } | null = null;
          for (const [id, m] of p.next) {
            const u = accessF.get(id);
            if (!u || id === o.a.id) continue;
            if (!best || m + walkMinutes(u.d) < best.m + walkMinutes(best.u.d)) best = { u, m };
          }
          if (!best) return;
          const b = best;
          const walkUF = walkMinutes(b.u.d);
          const earliestDep = after + o.walk * MIN;
          const first = nextDeparturesOfPattern(prep, pi, earliestDep, 1)[0];
          if (first === undefined) return;
          // trains possibles à partir de la première arrivée en gare, puis le dernier véhicule urbain qui les attrape
          const access = b.m * MIN + walkUF * MIN + TRANSFER_BUFFER_MS;
          const uAcc: Access = { a: b.u.a, d: b.u.d, walk: walkUF };
          for (const sd of trainTo) {
            if (sd.a.id === f.a.id) continue;
            for (const opt of env.engine.search(days, f.a.id, sd.a.id, prep.times[first] + access, 2)) {
              const di = lastDepartureOfPattern(prep, pi, opt.dep - access, earliestDep);
              if (di === undefined) continue;
              const ride = urbanLeg(prep, di, b.u.a, b.m);
              push(assemble([{ walkFrom: O, walkTo: o, minutes: o.walk }, ride, { walkFrom: uAcc, walkTo: f, minutes: walkUF }, ...opt.rides.map(trainLeg), { walkFrom: sd, walkTo: D, minutes: sd.walk }]));
            }
          }
        });
      }
    }
  }

  // 3b. ligne urbaine pour finir après une gare trop loin à pied
  if (!stationsD.length && trainFrom.length) {
    if (!days.length) days = await env.trainDays();
    for (const g of allD.filter(isSncb).slice(0, 3)) {
      const around = (await env.areasAround(g.a.lat, g.a.lon, STATION_ACCESS_M)).filter((x) => x.a.op !== 'sncb').slice(0, 4);
      for (const u of around) {
        const prep = await env.area(u.a.id).catch(() => null);
        if (!prep) continue;
        const walkGU = walkMinutes(u.d);
        prep.file.patterns.forEach((p, pi) => {
          let best: { acc: Access; m: number } | null = null;
          for (const [id, m] of p.next) {
            const acc = destMap.get(id);
            if (!acc || acc.a.op === 'sncb' || id === u.a.id) continue;
            if (!best || m + acc.walk < best.m + best.acc.walk) best = { acc, m };
          }
          if (!best) return;
          const b = best;
          for (const so of trainFrom) {
            if (so.a.id === g.a.id) continue;
            for (const opt of env.engine.search(days, so.a.id, g.a.id, after + so.walk * MIN, 2)) {
              const di = nextDeparturesOfPattern(prep, pi, opt.arr + walkGU * MIN + TRANSFER_BUFFER_MS, 1)[0];
              if (di === undefined) continue;
              const uAcc: Access = { a: u.a, d: u.d, walk: walkGU };
              push(assemble([{ walkFrom: O, walkTo: so, minutes: so.walk }, ...opt.rides.map(trainLeg), { walkFrom: g, walkTo: uAcc, minutes: walkGU }, urbanLeg(prep, di, b.acc.a, b.m), { walkFrom: b.acc, walkTo: D, minutes: b.acc.walk }]));
            }
          }
        });
      }
    }
  }

  // jamais un véhicule plus lent que d'y aller à pied maintenant
  let usable = cands;
  if (directWalk <= WALK_REFERENCE_MAX_MIN) {
    usable = cands.filter((c) => c.arr <= after + directWalk * MIN);
    if (!usable.length) return [await walkOnly()];
  }
  // un seul trajet par identité (le même train circule chaque jour), puis départ dans l'horizon
  const unique = uniqueBy(usable, candidateIdentity, betterCand).sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  const chosen = selectCandidates(withinHorizon(unique, after, JOURNEY_HORIZON_MS), KEEP_BEFORE_RT);
  const journeys = await Promise.all(chosen.map((c) => env.refresh(skeleton(c.legs))));
  const cancelled = (j: Journey) => j.legs.some((l) => l.kind === 'ride' && l.cancelled);
  journeys.sort((a, b) => Number(cancelled(a)) - Number(cancelled(b)) || a.arr - b.arr || a.transfers - b.transfers || b.dep - a.dep);
  return journeys.slice(0, MAX_RESULTS);
}
