/**
 * Trains d'une gare à une autre, direct ou avec une correspondance, sur les fichiers trains/{date}.json
 * des deux jours couverts (heures absolues : un voyage de la veille après minuit est pris en compte).
 *
 * Balayage des connexions par profil : pour la gare d'arrivée B, on construit pour chaque gare X la liste
 * (départ de X, arrivée à B) de tous les trains qui desservent X puis B, triée par départ, avec le minimum
 * suffixe des arrivées. Pour chaque train au départ de A, chaque arrêt X suivant donne en une recherche
 * dichotomique la meilleure correspondance (au moins 4 min en gare, autre voyage).
 * Puis filtre de Pareto sur (départ plus tard, arrivée plus tôt, moins de correspondances).
 */
import type { Names, TrainsDay } from '../../../shared/types';
import type { Leg, Stopover } from './api';
import { serviceDayBase } from './util';

export const MIN_TRANSFER_MS = 4 * 60_000;
/**
 * Trajets proposés : ceux qui partent dans les 23 h ; sinon le premier trouvé. Moins de 24 h : un trajet du
 * lendemain a toujours une heure de départ antérieure à l'heure actuelle (pas de confusion avec ceux du jour).
 */
export const JOURNEY_HORIZON_MS = 23 * 3_600_000;

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

interface Profile {
  dep: number[];
  arr: number[];
  day: DayIndex[];
  trip: number[];
  posX: number[];
  posB: number[];
  best: number[]; // index du minimum suffixe des arrivées
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

export class TrainEngine {
  private profiles: { days: DayIndex[]; to: string; prof: Map<string, Profile> }[] = [];

  search(days: DayIndex[], fromId: string, toId: string, after: number, limit: number): TrainOption[] {
    if (!fromId || !toId || fromId === toId || limit <= 0) return [];
    const prof = this.profileTo(days, toId);
    const cands: TrainOption[] = [];
    for (const d of days) {
      const ev = d.byStation.get(fromId);
      if (!ev) continue;
      for (let e = 0; e < ev.length; e += 2) {
        const ti = ev[e];
        const i = ev[e + 1];
        const s = d.file.trips[ti].s;
        const dep = ms(d, s[i][2]);
        if (dep < after) continue;
        let best: TrainOption | null = null;
        let bestBuf = -1;
        for (let k = i + 1; k < s.length; k++) {
          const sid = d.file.stations[s[k][0]]?.id;
          if (!sid) continue;
          if (sid === fromId) break;
          const arrK = ms(d, s[k][1]);
          if (sid === toId) {
            cands.push({ dep, arr: arrK, rides: [{ day: d, trip: ti, i, k }] });
            break;
          }
          const P = prof.get(sid);
          if (!P) continue;
          const at = lowerBound(P.dep, arrK + MIN_TRANSFER_MS);
          if (at >= P.dep.length) continue;
          const b = P.best[at];
          if (P.day[b] === d && P.trip[b] === ti) continue; // même voyage : le direct le couvre
          const arr = P.arr[b];
          const buf = P.dep[b] - arrK;
          if (!best || arr < best.arr || (arr === best.arr && buf > bestBuf)) {
            best = { dep, arr, rides: [{ day: d, trip: ti, i, k }, { day: P.day[b], trip: P.trip[b], i: P.posX[b], k: P.posB[b] }] };
            bestBuf = buf;
          }
        }
        if (best) cands.push(best);
      }
    }
    const unique = uniqueBy(pareto(cands), optionIdentity, (a, b) => a.arr < b.arr || (a.arr === b.arr && a.dep > b.dep));
    return withinHorizon(unique, after, JOURNEY_HORIZON_MS).slice(0, limit);
  }

  private profileTo(days: DayIndex[], toId: string): Map<string, Profile> {
    const hit = this.profiles.find((p) => p.to === toId && p.days.length === days.length && p.days.every((d, i) => d === days[i]));
    if (hit) return hit.prof;
    const tmp = new Map<string, { dep: number; arr: number; day: DayIndex; trip: number; posX: number; posB: number }[]>();
    for (const d of days) {
      const ev = d.byStation.get(toId);
      if (!ev) continue;
      for (let e = 0; e < ev.length; e += 2) {
        const ti = ev[e];
        const j = ev[e + 1];
        const s = d.file.trips[ti].s;
        const arrB = ms(d, s[j][1]);
        for (let m = 0; m < j; m++) {
          const sid = d.file.stations[s[m][0]]?.id;
          if (!sid || sid === toId) continue;
          let list = tmp.get(sid);
          if (!list) tmp.set(sid, (list = []));
          list.push({ dep: ms(d, s[m][2]), arr: arrB, day: d, trip: ti, posX: m, posB: j });
        }
      }
    }
    const prof = new Map<string, Profile>();
    for (const [sid, list] of tmp) {
      list.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
      const n = list.length;
      const P: Profile = { dep: new Array(n), arr: new Array(n), day: new Array(n), trip: new Array(n), posX: new Array(n), posB: new Array(n), best: new Array(n) };
      list.forEach((x, i) => {
        P.dep[i] = x.dep;
        P.arr[i] = x.arr;
        P.day[i] = x.day;
        P.trip[i] = x.trip;
        P.posX[i] = x.posX;
        P.posB[i] = x.posB;
      });
      for (let i = n - 1; i >= 0; i--) {
        // à arrivée égale, on garde le départ le plus tardif (plus de marge pour changer)
        P.best[i] = i === n - 1 || P.arr[i] < P.arr[P.best[i + 1]] ? i : P.best[i + 1];
      }
      prof.set(sid, P);
    }
    this.profiles.unshift({ days, to: toId, prof });
    if (this.profiles.length > 6) this.profiles.length = 6;
    return prof;
  }
}

function lowerBound(arr: number[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ne garde que les trajets non dominés (départ ≥, arrivée ≤, correspondances ≤), triés par départ. */
export function pareto(list: TrainOption[]): TrainOption[] {
  const tr = (o: TrainOption) => o.rides.length - 1;
  const sorted = [...list].sort((a, b) => b.dep - a.dep || a.arr - b.arr || tr(a) - tr(b));
  let best0 = Infinity;
  let bestAny = Infinity;
  const keep: TrainOption[] = [];
  for (const o of sorted) {
    const t = tr(o);
    if ((t === 0 ? best0 : bestAny) <= o.arr) continue;
    keep.push(o);
    if (t === 0) best0 = Math.min(best0, o.arr);
    bestAny = Math.min(bestAny, o.arr);
  }
  return keep.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

/** Trajet en train (montée → descente) sous forme d'étape, horaires prévus (temps réel appliqué ensuite). */
export function trainLeg(r: TrainRide): Leg {
  const d = r.day;
  const trip = d.file.trips[r.trip];
  const s = trip.s;
  const station = (p: number) => d.file.stations[s[p][0]];
  const names = (p: number): Names => station(p)?.n ?? { fr: '', nl: '' };
  const dep = ms(d, s[r.i][2]);
  const arr = ms(d, s[r.k][1]);
  const stops: Stopover[] = [];
  for (let p = r.i; p <= r.k; p++) {
    const t = ms(d, p === r.i ? s[p][2] : s[p][1]);
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
    if (p >= 0 && ms(d, s[p][2]) === leg.schedDep) return { day: d, trip: ti };
  }
  return null;
}
