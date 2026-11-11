/**
 * Correspondance devenue impossible par un retard (design-routing.md § 4.9, point 2) : le reste du trajet est
 * recalculé depuis la zone de correspondance, à l'heure d'arrivée estimée, sur le petit réseau de la recherche encore
 * en mémoire (quelques millisecondes), avec l'alerte « ! Correspondance recalculée ».
 *
 * Le réseau des deux dernières recherches est gardé avec l'arrivée et la marche maximale ; un trajet le retrouve par
 * son identifiant (refresh() d'un trajet affiché), toujours dans la même génération de données.
 */
import type { Alert, Journey, Leg } from '../api';
import { brokenConnection } from '../journeys';
import { endRef, rideLeg, stopRef, walkLeg, type EndPoint } from './legs';
import { accessMap, type Net } from './network';
import { P } from './params';
import { raptor } from './raptor';

const MIN = 60_000;
export const RECALC_TEXT = '! Correspondance recalculée';

interface Memo {
  gen: string;
  net: Net;
  D: EndPoint;
  maxWalk: number;
  ids: Set<string>;
}

const memos: Memo[] = [];

/** Garde le réseau d'une recherche et les trajets proposés (deux recherches au plus). */
export function rememberNet(gen: string, net: Net, D: EndPoint, maxWalk: number, ids: readonly string[]): void {
  const old = memos.findIndex((m) => m.net === net);
  if (old >= 0) memos.splice(old, 1);
  memos.unshift({ gen, net, D, maxWalk, ids: new Set(ids) });
  if (memos.length > 2) memos.length = 2;
}

/** Réseau en mémoire d'un trajet proposé (même génération de données), sinon null. */
export function netOf(gen: string | undefined, id: string): Memo | null {
  return memos.find((m) => m.gen === gen && m.ids.has(id)) ?? null;
}

const isRide = (l: Leg) => l.kind === 'ride';
const urbanPairs = (rides: { urban: boolean }[]) => rides.reduce((n, r, i) => n + (i > 0 && r.urban && rides[i - 1].urban ? 1 : 0), 0);

/**
 * Étapes du trajet recalculé à partir de la correspondance manquée (les étapes d'avant, heures estimées, sont
 * gardées), ou null si aucune correspondance ne marche (3 véhicules au plus, attente de 60 min au plus, une seule
 * correspondance entre lignes urbaines).
 */
export function repairLegs(j: Journey, net: Net, D: EndPoint, maxWalk: number): Leg[] | null {
  const b = brokenConnection(j);
  if (b < 0) return null;
  let p = b - 1;
  while (p >= 0 && j.legs[p].kind !== 'ride') p--;
  if (p < 0) return null;
  const prev = j.legs[p];
  const s = prev.to.areaId ? net.idx.get(prev.to.areaId) : undefined;
  if (s === undefined) return null;
  const before = j.legs.slice(0, p + 1);
  const ridesBefore = before.filter(isRide).map((l) => ({ urban: l.op !== 'sncb' }));
  const rounds = P.rounds - ridesBefore.length;
  if (rounds < 1) return null;
  const t = (prev.arr - net.base0) / MIN;
  // accès : même zone (temps de correspondance) ou zones voisines à pied
  const walkOf = new Map<number, number>([[s, 0]]);
  const access = new Map<number, number>([[s, net.station[s] ? P.mctStation : P.mctUrban]]);
  const f = net.foot[s];
  for (let i = 0; i < f.length; i += 2) {
    const v = f[i + 1] + (net.station[f[i]] ? P.footBufStation : P.footBufUrban);
    if (v < (access.get(f[i]) ?? Infinity)) {
      access.set(f[i], v);
      walkOf.set(f[i], f[i + 1]);
    }
  }
  const egress = accessMap(net, D, Math.floor(P.longWalkFactor * maxWalk), 2 * maxWalk);
  if (!egress.size) return null;
  const uuBefore = urbanPairs(ridesBefore);
  const found = raptor(net, { access, egress, after: t, windowMin: 0, rounds, urbanUrbanMax: Math.max(0, P.urbanUrbanMax - uuBefore) })
    .filter((c) => {
      const r0 = net.routes[c.rides[0].route];
      const firstWait = r0.dep[c.rides[0].trip * r0.n + c.rides[0].bpos] - t - (walkOf.get(c.accessStop) ?? 0);
      const all = [...ridesBefore, ...c.rides.map((r) => ({ urban: net.routes[r.route].urban }))];
      return c.maxWait <= P.maxWaitMin && firstWait <= P.maxWaitMin && urbanPairs(all) <= P.urbanUrbanMax;
    })
    .sort((x, y) => x.arr - y.arr || x.rides.length - y.rides.length);
  const c = found[0];
  if (!c) return null;
  const rides = c.rides.map((r) => rideLeg(net, r));
  if (rides.some((l) => !l)) return null;
  const legs: Leg[] = before.map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to }, ...(l.stops ? { stops: l.stops.map((x) => ({ ...x })) } : {}) }));
  const w = walkOf.get(c.accessStop) ?? 0;
  if (c.accessStop !== s && w > 0) legs.push(walkLeg(stopRef(net, s), stopRef(net, c.accessStop), w, prev.arr));
  (rides as Leg[]).forEach((l, i) => {
    const h = i > 0 ? c.hops[i - 1] : undefined;
    if (h && h.walk > 0) legs.push(walkLeg(stopRef(net, h.from), l.from, h.walk, (rides[i - 1] as Leg).schedArr));
    legs.push(l);
  });
  if (c.egressWalk > 0) legs.push(walkLeg(stopRef(net, c.egressStop), endRef(D), c.egressWalk, (rides[rides.length - 1] as Leg).schedArr));
  return legs;
}

/** Alerte « ! Correspondance recalculée » (en tête des alertes du trajet). */
export function recalcAlert(now: number): Alert {
  return { kind: 'delay', text: RECALC_TEXT, at: now };
}
