/**
 * Trains d'une gare à une autre (direct, une ou deux correspondances, PRD M5c) sur les fichiers trains/{date}.json
 * des jours couverts (heures absolues : un voyage de la veille après minuit est pris en compte).
 *
 * 1.1 : même calcul que les trajets porte à porte (RAPTOR par rondes sur une plage de départs, routing/raptor.ts),
 * sur les seuls trains : trois trains au plus, au moins 4 min de correspondance dans une gare, attente de 60 min au
 * plus, montée et descente seulement là où elles sont permises (TrainsDay : -1 = interdit ; un fichier sans -1, celui
 * de la 1.0, permet tout), jamais une correspondance qui ne fait gagner que moins de 5 min sur le même premier train.
 * Puis filtre de Pareto (départ plus tard, arrivée plus tôt, moins de correspondances), un trajet par identité.
 */
import type { Names, TrainsDay } from '../../../shared/types';
import type { Leg, Stopover } from './api';
import { Net, trainPart, trainTimes, trainTripOf, type TrainPart } from './routing/network';
import { P } from './routing/params';
import { raptor, type Cand } from './routing/raptor';
import { serviceDayBase } from './util';

export const MIN_TRANSFER_MS = P.mctStation * 60_000;
/**
 * Trajets proposés : ceux qui partent dans les 23 h ; sinon le premier trouvé. Moins de 24 h : un trajet du
 * lendemain a toujours une heure de départ antérieure à l'heure actuelle (pas de confusion avec ceux du jour).
 */
export const JOURNEY_HORIZON_MS = 23 * 3_600_000;
/** Plage de départs parcourue d'abord (puis tout l'horizon s'il manque des trajets). */
const FIRST_WINDOW_MIN = 4 * 60;

/** Un seul élément par identité, le meilleur selon `better` ; l'ordre de la liste est conservé. */
export function uniqueBy<T>(list: readonly T[], key: (x: T) => string, better: (a: T, b: T) => boolean): T[] {
  const best = new Map<string, T>();
  for (const x of list) {
    const k = key(x);
    const cur = best.get(k);
    if (cur === undefined || better(x, cur)) best.set(k, x);
  }
  return list.filter((x) => best.get(key(x)) === x);
}

/** Ce qui part au plus `horizonMs` après `after` ; si rien, le premier élément (liste triée par départ). */
export function withinHorizon<T extends { dep: number }>(list: readonly T[], after: number, horizonMs: number): T[] {
  const inside = list.filter((x) => x.dep <= after + horizonMs);
  return inside.length ? inside : list.slice(0, 1);
}

export interface DayIndex {
  file: TrainsDay;
  base: number; // origine GTFS du jour (ms)
  /** id de gare → [voyage, position, voyage, position…] */
  byStation: Map<string, number[]>;
  tripById: Map<string, number>;
}

export interface TrainRide {
  day: DayIndex;
  trip: number;
  i: number; // position de montée
  k: number; // position de descente
}

export interface TrainOption {
  dep: number;
  arr: number;
  rides: TrainRide[];
}

/** Identité d'une option : voyages et gares de montée/descente, sans la date (un même train circule chaque jour). */
export function optionIdentity(o: TrainOption): string {
  return o.rides
    .map((r) => {
      const t = r.day.file.trips[r.trip];
      const st = (p: number) => r.day.file.stations[t.s[p][0]]?.id ?? '';
      return `${t.id}@${st(r.i)}>${st(r.k)}`;
    })
    .join('|');
}

const indexes = new WeakMap<TrainsDay, DayIndex>();

export function indexDay(file: TrainsDay): DayIndex {
  const hit = indexes.get(file);
  if (hit) return hit;
  const byStation = new Map<string, number[]>();
  const tripById = new Map<string, number>();
  file.trips.forEach((t, ti) => {
    tripById.set(t.id, ti);
    for (let p = 0; p < t.s.length; p++) {
      const id = file.stations[t.s[p][0]]?.id;
      if (!id) continue;
      let list = byStation.get(id);
      if (!list) byStation.set(id, (list = []));
      list.push(ti, p);
    }
  });
  const idx: DayIndex = { file, base: serviceDayBase(file.date), byStation, tripById };
  indexes.set(file, idx);
  return idx;
}

const ms = (d: DayIndex, minutes: number) => d.base + minutes * 60_000;
const trainNets = new WeakMap<TrainPart, Net>();

/** Réseau des seuls trains (sans marche entre gares), gardé en mémoire pour les mêmes fichiers. */
function trainNet(days: DayIndex[]): Net | null {
  if (!days.length) return null;
  const base0 = Math.min(...days.map((d) => d.base));
  const part = trainPart(
    days.map((d) => d.file),
    base0,
  );
  let net = trainNets.get(part);
  if (!net) {
    net = new Net(base0, part).finish(false);
    trainNets.set(part, net);
  }
  return net;
}

/** Ne garde que les trajets non dominés (départ ≥, arrivée ≤, correspondances ≤), triés par départ. */
export function pareto(list: TrainOption[]): TrainOption[] {
  const tr = (o: TrainOption) => o.rides.length - 1;
  const sorted = [...list].sort((a, b) => b.dep - a.dep || a.arr - b.arr || tr(a) - tr(b));
  const keep: TrainOption[] = [];
  for (const o of sorted) {
    if (keep.some((k) => k.dep >= o.dep && k.arr <= o.arr && tr(k) <= tr(o))) continue;
    keep.push(o);
  }
  return keep.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

export class TrainEngine {
  /** Trains de `fromId` à `toId` partant à `after` ou après, `limit` au plus, triés par départ. */
  search(days: DayIndex[], fromId: string, toId: string, after: number, limit: number): TrainOption[] {
    if (!fromId || !toId || fromId === toId || limit <= 0) return [];
    const net = trainNet(days);
    if (!net) return [];
    const from = net.idx.get(fromId);
    const to = net.idx.get(toId);
    if (from === undefined || to === undefined) return [];
    const dayOf = new Map(days.map((d) => [d.file, d]));
    const afterMin = (after - net.base0) / 60_000;
    const run = (windowMin: number): TrainOption[] => {
      const cands = raptor(net, { access: new Map([[from, 0]]), egress: new Map([[to, 0]]), after: afterMin, windowMin, urbanUrbanMax: P.rounds });
      const opts: { o: TrainOption; first: string; arr: number; n: number }[] = [];
      for (const c of cands) {
        if (c.maxWait > P.maxWaitMin) continue;
        const o = toOption(net, c, dayOf);
        if (o) opts.push({ o, first: `${c.rides[0].route}/${c.rides[0].trip}/${c.rides[0].bpos}`, arr: c.arr, n: c.rides.length });
      }
      // jamais une correspondance qui ne fait gagner que moins de 5 min sur le même premier train
      const useful = opts.filter((x) => !opts.some((y) => y !== x && y.first === x.first && y.n < x.n && y.arr < x.arr + P.uselessTransferMin)).map((x) => x.o);
      const unique = uniqueBy(pareto(useful), optionIdentity, (a, b) => a.arr < b.arr || (a.arr === b.arr && a.dep > b.dep));
      return withinHorizon(unique, after, JOURNEY_HORIZON_MS);
    };
    let out = run(FIRST_WINDOW_MIN);
    if (out.length < limit) out = run(JOURNEY_HORIZON_MS / 60_000);
    return out.slice(0, limit);
  }
}

function toOption(net: Net, c: Cand, dayOf: Map<TrainsDay, DayIndex>): TrainOption | null {
  const rides: TrainRide[] = [];
  for (const r of c.rides) {
    const route = net.routes[r.route];
    const t = trainTripOf(route, r.trip);
    const day = t ? dayOf.get(t.day.file) : undefined;
    if (!t || !day) return null;
    rides.push({ day, trip: t.ti, i: r.bpos, k: r.apos });
  }
  const first = rides[0];
  const last = rides[rides.length - 1];
  const s0 = first.day.file.trips[first.trip].s;
  const sl = last.day.file.trips[last.trip].s;
  return { dep: ms(first.day, trainTimes(s0, first.i).dep), arr: ms(last.day, trainTimes(sl, last.k).arr), rides };
}

/** Trajet en train (montée → descente) sous forme d'étape, horaires prévus (temps réel appliqué ensuite). */
export function trainLeg(r: TrainRide): Leg {
  const d = r.day;
  const trip = d.file.trips[r.trip];
  const s = trip.s;
  const station = (p: number) => d.file.stations[s[p][0]];
  const names = (p: number): Names => station(p)?.n ?? { fr: '', nl: '' };
  const dep = ms(d, trainTimes(s, r.i).dep);
  const arr = ms(d, trainTimes(s, r.k).arr);
  const stops: Stopover[] = [];
  for (let p = r.i; p <= r.k; p++) {
    // arrêt sans montée ni descente (passage) : pas dans la liste
    if (p !== r.i && p !== r.k && s[p][1] < 0 && s[p][2] < 0) continue;
    const x = trainTimes(s, p);
    const t = ms(d, p === r.i ? x.dep : x.arr);
    const so: Stopover = { name: names(p), sched: t, est: t };
    const st = station(p);
    if (st) so.areaId = st.id;
    if (s[p][3]) so.platform = s[p][3];
    stops.push(so);
  }
  const from = station(r.i);
  const to = station(r.k);
  const leg: Leg = {
    kind: 'ride',
    from: { name: names(r.i), lat: from?.lat ?? 0, lon: from?.lon ?? 0, areaId: from?.id },
    to: { name: names(r.k), lat: to?.lat ?? 0, lon: to?.lon ?? 0, areaId: to?.id },
    dep,
    arr,
    schedDep: dep,
    schedArr: arr,
    op: 'sncb',
    mode: 'train',
    line: trip.cat,
    cat: trip.cat,
    head: trip.head,
    tripId: trip.id,
    fromSeq: s[r.i][4],
    toSeq: s[r.k][4],
    rt: false,
    delayMin: 0,
    cancelled: false,
    stops,
  };
  if (trip.num) leg.num = trip.num;
  if (s[r.i][3]) leg.platform = s[r.i][3];
  return leg;
}

/** Retrouve le voyage d'une étape train (par identifiant et heure de montée prévue). */
export function locateTrip(days: DayIndex[], leg: Leg): { day: DayIndex; trip: number } | null {
  if (!leg.tripId) return null;
  for (const d of days) {
    const ti = d.tripById.get(leg.tripId);
    if (ti === undefined) continue;
    const s = d.file.trips[ti].s;
    const p = s.findIndex((x) => x[4] === leg.fromSeq);
    if (p >= 0 && ms(d, trainTimes(s, p).dep) === leg.schedDep) return { day: d, trip: ti };
  }
  return null;
}
