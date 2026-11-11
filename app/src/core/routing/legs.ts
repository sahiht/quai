/**
 * Étapes d'un trajet trouvé (design-routing.md § 4.6, reconstitution) : marches, trains (trains/{date}.json) et
 * bus, trams, métros (fichiers de ligne) avec arrêts intermédiaires et heures (écran « Dans le bus », C1),
 * identifiant du voyage (De Lijn, TEC : LineFile.trips ; SNCB) et arrêts physiques de montée et de descente
 * (`fromStop`, `toStop` : identifiants temps réel, pointid pour la STIB).
 */
import type { Names } from '../../../../shared/types';
import type { Leg, Stopover } from '../api';
import { indexDay, trainLeg } from '../trains';
import type { Net, RRoute } from './network';
import { trainTripOf } from './network';
import type { Cand, RideRef } from './raptor';

/** Extrémité d'un trajet : nom affiché, position, zone éventuelle. */
export interface EndPoint {
  name: Names;
  lat: number;
  lon: number;
  areaId?: string;
}

const MIN = 60_000;

export function stopRef(net: Net, i: number): Leg['from'] {
  return { name: net.names[i], lat: net.lat[i], lon: net.lon[i], areaId: net.ids[i] };
}

export function endRef(p: EndPoint): Leg['from'] {
  return { name: p.name, lat: p.lat, lon: p.lon, ...(p.areaId ? { areaId: p.areaId } : {}) };
}

export function walkLeg(from: Leg['from'], to: Leg['from'], minutes: number, t0: number): Leg {
  return { kind: 'walk', from, to, dep: t0, arr: t0 + minutes * MIN, schedDep: t0, schedArr: t0 + minutes * MIN, walkMin: minutes };
}

/** Étape en bus, tram ou métro d'un motif de fichier de ligne. */
function lineLeg(net: Net, r: RRoute, ride: RideRef): Leg | null {
  if (r.src.kind !== 'line') return null;
  const { part, pat } = r.src;
  const f = part.file;
  const p = f.pats[pat];
  const tIdx = part.pats[pat].t[ride.trip];
  const t = p.t[tIdx];
  const n = r.n;
  const at = (pos: number) => net.base0 + r.dep[ride.trip * n + pos] * MIN;
  const stops: Stopover[] = [];
  for (let pos = ride.bpos; pos <= ride.apos; pos++) {
    const area = f.areas[p.a[pos]];
    const time = at(pos);
    stops.push({ name: area?.[3] ?? { fr: '', nl: '' }, ...(area ? { areaId: area[0] } : {}), sched: time, est: time });
  }
  const dep = at(ride.bpos);
  const arr = at(ride.apos);
  const leg: Leg = {
    kind: 'ride',
    from: stopRef(net, r.stops[ride.bpos]),
    to: stopRef(net, r.stops[ride.apos]),
    dep,
    arr,
    schedDep: dep,
    schedArr: arr,
    op: f.op,
    mode: f.mode,
    line: f.line,
    head: p.head,
    rt: false,
    delayMin: 0,
    cancelled: false,
    stops,
  };
  const tripId = t && t.length > 3 && f.trips ? f.trips[t[3]] : undefined;
  if (tripId) leg.tripId = tripId;
  const fromStop = p.s?.[ride.bpos];
  const toStop = p.s?.[ride.apos];
  if (fromStop) leg.fromStop = fromStop;
  if (toStop) leg.toStop = toStop;
  return leg;
}

/** Étape en véhicule d'un trajet trouvé. */
export function rideLeg(net: Net, ride: RideRef): Leg | null {
  const r = net.routes[ride.route];
  if (r.src.kind === 'line') return lineLeg(net, r, ride);
  const t = trainTripOf(r, ride.trip);
  if (!t) return null;
  return trainLeg({ day: indexDay(t.day.file), trip: t.ti, i: ride.bpos, k: ride.apos });
}

/** Étapes complètes (marches comprises) d'un trajet trouvé, aux horaires prévus. */
export function candLegs(net: Net, c: Cand, O: EndPoint, D: EndPoint): Leg[] | null {
  const legs: Leg[] = [];
  const rides: Leg[] = [];
  for (const r of c.rides) {
    const l = rideLeg(net, r);
    if (!l) return null;
    rides.push(l);
  }
  if (c.accessWalk > 0) legs.push(walkLeg(endRef(O), stopRef(net, c.accessStop), c.accessWalk, rides[0].schedDep - c.accessWalk * MIN));
  rides.forEach((l, i) => {
    if (i > 0) {
      const h = c.hops[i - 1];
      const prev = rides[i - 1];
      if (h && h.walk > 0) legs.push(walkLeg(stopRef(net, h.from), l.from, h.walk, prev.schedArr));
    }
    legs.push(l);
  });
  if (c.egressWalk > 0) legs.push(walkLeg(stopRef(net, c.egressStop), endRef(D), c.egressWalk, rides[rides.length - 1].schedArr));
  return legs;
}

/** Marche seule de O à D. */
export function walkOnlyLegs(O: EndPoint, D: EndPoint, minutes: number, t0: number): Leg[] {
  return [walkLeg(endRef(O), endRef(D), minutes, t0)];
}
