/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : calcul d'un chemin à pied sur un graphe fusionné (graph.ts), sans réseau ni attente.
 *
 * - Accroche : départ et arrivée posés sur la voie la plus proche, à 100 m au plus (une voie sous terre ou à
 *   l'intérieur compte 25 m de plus). Deux points de réseaux séparés (petite composante isolée) : on reprend la voie la
 *   plus proche du grand réseau.
 * - A* (heuristique : distance à vol d'oiseau), départ et arrivée au milieu d'un tronçon, sens uniques respectés.
 * - Virages seulement aux carrefours (3 voies ou plus) : direction d'arrivée et de départ mesurées sur 10 m le long du
 *   chemin ; moins de 30° : rien ; 30 à 60° : légèrement ; 60 à 135° : à gauche ou à droite ; 135 à 170° : en
 *   épingle ; au-delà : demi-tour. Rond-point : ni l'entrée sur l'anneau ni la suite de l'anneau ne sont des virages ;
 *   à la sortie, le virage se mesure depuis la direction d'entrée (sortie en face : rien). Rien dans les 20 derniers
 *   mètres ; deux virages à moins de 15 m : un seul, le plus marqué (le premier à égalité).
 */
import type { LatLon } from '../api';
import type { Maneuver, TurnKind, WalkRoute } from '../guide-types';
import { F_BWD, F_FWD, F_RING, F_STEPS, F_UNDER, WALK_UNIT } from './format';
import { degree, edgeName, edgePolyline, M_PER_U, STEPS_COST, unitsM, type RoutingGraph } from './graph';

export const SNAP_MAX_M = 100;
/**
 * Accroche : une voie sous terre ou à l'intérieur (couloir du prémétro, tunnel piéton) compte 25 m de plus qu'une rue ;
 * un arrêt posé au-dessus d'un couloir s'accroche à la rue, un quai sans rue proche à son couloir. Le calcul du
 * chemin, lui, emprunte ces voies normalement.
 */
export const UNDER_SNAP_M = 25;
/** Distance le long du chemin sur laquelle se mesure une direction, de part et d'autre d'un carrefour. */
export const BEARING_M = 10;
export const MERGE_M = 15;
export const LAST_M = 20;
/** Nœuds visités au plus par un calcul (garde-fou : bien au-delà d'une marche de 2 km en ville dense). */
export const MAX_SETTLED = 400_000;
/** Écart plus petit qu'un mètre entre le point demandé et la voie : pas de raccord droit. */
const JOIN_M = 1;
const RAD = Math.PI / 180;

export interface Snap {
  e: number;
  seg: number;
  t: number;
  /** position accrochée (unités, flottantes) */
  lat: number;
  lon: number;
  /** distance depuis le nœud from du tronçon, le long de sa géométrie (m) */
  along: number;
  /** distance du point demandé à la voie (m) */
  dist: number;
  /** distance comparée entre voies (sous terre : + UNDER_SNAP_M) */
  score: number;
}

/** Voie la plus proche (toutes) et la plus proche du grand réseau, à maxM au plus. */
export function snapPoint(g: RoutingGraph, latU: number, lonU: number, maxM = SNAP_MAX_M): { any: Snap | null; giant: Snap | null } {
  let any: Snap | null = null;
  let giant: Snap | null = null;
  const dLat = maxM / M_PER_U;
  // 1.3.1 (R4) : graphe sans marches (graph.ts, withoutSteps) : ses tronçons écartés ne sont pas des accroches
  const skip = g.skip ?? 0;
  for (let ti = 0; ti < g.tiles.length; ti++) {
    const tg = g.tiles[ti];
    const t = tg.t;
    const kx = M_PER_U * tg.cos;
    const dLon = maxM / kx;
    const bb = tg.bbox;
    const ne = t.edgeFrom.length;
    for (let k = 0; k < ne; k++) {
      if (t.edgeFlags[k] & skip) continue;
      if (latU < bb[4 * k] - dLat || latU > bb[4 * k + 1] + dLat || lonU < bb[4 * k + 2] - dLon || lonU > bb[4 * k + 3] + dLon) continue;
      const e = g.edgeBase[ti] + k;
      const comp = t.edgeComp[k];
      const pen = t.edgeFlags[k] & F_UNDER ? UNDER_SNAP_M : 0;
      let ax = (t.nodeLon[t.edgeFrom[k]] - lonU) * kx;
      let ay = (t.nodeLat[t.edgeFrom[k]] - latU) * M_PER_U;
      let along = 0;
      const start = t.geoStart[k];
      const end = t.geoStart[k + 1];
      for (let i = start; i <= end; i++) {
        const bla = i < end ? t.ptLat[i] : t.nodeLat[t.edgeTo[k]];
        const blo = i < end ? t.ptLon[i] : t.nodeLon[t.edgeTo[k]];
        const bx = (blo - lonU) * kx;
        const by = (bla - latU) * M_PER_U;
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const u = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const px = ax + u * dx;
        const py = ay + u * dy;
        const d = Math.sqrt(px * px + py * py);
        const segLen = Math.sqrt(l2);
        if (d <= maxM) {
          const score = d + pen;
          const betterAny = !any || score < any.score;
          const betterGiant = comp === 0 && (!giant || score < giant.score);
          if (betterAny || betterGiant) {
            const s: Snap = { e, seg: i - start, t: u, lat: latU + py / M_PER_U, lon: lonU + px / kx, along: along + u * segLen, dist: d, score };
            if (betterAny) any = s;
            if (betterGiant) giant = s;
          }
        }
        along += segLen;
        ax = bx;
        ay = by;
      }
    }
  }
  return { any, giant };
}

/* ------------------------------ A* ------------------------------ */

class Heap {
  key = new Float64Array(1024);
  val = new Int32Array(1024);
  size = 0;
  push(k: number, v: number): void {
    if (this.size === this.key.length) {
      const nk = new Float64Array(this.size * 2);
      nk.set(this.key);
      this.key = nk;
      const nv = new Int32Array(this.size * 2);
      nv.set(this.val);
      this.val = nv;
    }
    let i = this.size++;
    const key = this.key;
    const val = this.val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (key[p] <= k) break;
      key[i] = key[p];
      val[i] = val[p];
      i = p;
    }
    key[i] = k;
    val[i] = v;
  }
  /** Retire le plus petit ; renvoie sa valeur (sa clé reste dans `top`). */
  top = 0;
  pop(): number {
    const key = this.key;
    const val = this.val;
    const v = val[0];
    this.top = key[0];
    const n = --this.size;
    if (n > 0) {
      const k = key[n];
      const x = val[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && key[c + 1] < key[c]) c++;
        if (key[c] >= k) break;
        key[i] = key[c];
        val[i] = val[c];
        i = c;
      }
      key[i] = k;
      val[i] = x;
    }
    return v;
  }
}

const START_FWD = -2;
const START_BWD = -3;
const DIRECT = -4;

export interface PathResult {
  cost: number;
  /** chemin sur le seul tronçon de départ, sans passer par un nœud */
  direct: boolean;
  /** sortie du tronçon de départ : 0 vers son nœud to, 1 vers son nœud from */
  startDir: 0 | 1;
  /** tronçons entiers parcourus : tronçon × 2 + sens */
  edges: number[];
  /** entrée sur le tronçon d'arrivée : 0 depuis son nœud from, 1 depuis son nœud to */
  endDir: 0 | 1;
  settled: number;
}

const factor = (g: RoutingGraph, e: number) => (g.eFlags[e] & F_STEPS ? STEPS_COST : 1);

/** Chemin le moins coûteux entre deux points accrochés ; null s'il n'y en a pas dans le graphe chargé. */
export function shortestPath(g: RoutingGraph, s: Snap, t: Snap, maxSettled = MAX_SETTLED): PathResult | null {
  if (!g.scratch || g.scratch.g.length < g.n) {
    g.scratch = { g: new Float64Array(g.n), parent: new Int32Array(g.n), seen: new Uint32Array(g.n), closed: new Uint32Array(g.n), sid: 0 };
  }
  const sc = g.scratch;
  if (sc.sid >= 0xfffffff0) {
    sc.seen.fill(0);
    sc.closed.fill(0);
    sc.sid = 0;
  }
  const sid = ++sc.sid;
  const gs = sc.g;
  const parent = sc.parent;
  const seen = sc.seen;
  const closed = sc.closed;
  const heap = new Heap();
  // heuristique : distance plane jusqu'au point d'arrivée (un peu réduite : longueurs mesurées tuile par tuile)
  const tx = (t.lon - g.refLon) * g.kx;
  const ty = (t.lat - g.refLat) * M_PER_U;
  const h = (v: number) => 0.999 * Math.sqrt((g.x[v] - tx) ** 2 + (g.y[v] - ty) ** 2);
  let best = Infinity;
  let bestNode = -1;
  let bestEnd: 0 | 1 = 0;
  // même tronçon : directement
  if (s.e === t.e) {
    const fl = g.eFlags[s.e];
    const f = factor(g, s.e);
    if (t.along >= s.along && !(fl & F_BWD)) {
      best = (t.along - s.along) * f;
      bestNode = DIRECT;
    }
    if (t.along <= s.along && !(fl & F_FWD) && (s.along - t.along) * f < best) {
      best = (s.along - t.along) * f;
      bestNode = DIRECT;
    }
  }
  const relax = (v: number, cost: number, from: number) => {
    if (closed[v] === sid) return;
    if (seen[v] !== sid || cost < gs[v]) {
      seen[v] = sid;
      gs[v] = cost;
      parent[v] = from;
      heap.push(cost + h(v), v);
    }
  };
  {
    const e = s.e;
    const fl = g.eFlags[e];
    const f = factor(g, e);
    if (!(fl & F_FWD)) relax(g.eFrom[e], s.along * f, START_BWD);
    if (!(fl & F_BWD)) relax(g.eTo[e], (g.eLen[e] - s.along) * f, START_FWD);
  }
  const tf = g.eFrom[t.e];
  const tt = g.eTo[t.e];
  const tfl = g.eFlags[t.e];
  const tfac = factor(g, t.e);
  const exitFrom = tfl & F_BWD ? Infinity : t.along * tfac;
  const exitTo = tfl & F_FWD ? Infinity : (g.eLen[t.e] - t.along) * tfac;
  let settled = 0;
  while (heap.size) {
    const u = heap.pop();
    if (closed[u] === sid) continue;
    if (heap.top >= best) break;
    closed[u] = sid;
    const gu = gs[u];
    if (u === tf && gu + exitFrom < best) {
      best = gu + exitFrom;
      bestNode = u;
      bestEnd = 0;
    }
    if (u === tt && gu + exitTo < best) {
      best = gu + exitTo;
      bestNode = u;
      bestEnd = 1;
    }
    if (++settled > maxSettled) return null;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const packed = g.adj[k];
      const e = packed >> 1;
      const dir = packed & 1;
      const fl = g.eFlags[e];
      if (dir === 0 ? fl & F_BWD : fl & F_FWD) continue;
      relax(dir === 0 ? g.eTo[e] : g.eFrom[e], gu + g.eCost[e], packed);
    }
  }
  if (bestNode === -1) return null;
  if (bestNode === DIRECT) return { cost: best, direct: true, startDir: 0, edges: [], endDir: 0, settled };
  const edges: number[] = [];
  let v = bestNode;
  for (let guard = 0; parent[v] >= 0; guard++) {
    if (guard > g.m) return null;
    const p = parent[v];
    edges.push(p);
    v = p & 1 ? g.eTo[p >> 1] : g.eFrom[p >> 1];
  }
  edges.reverse();
  return { cost: best, direct: false, startDir: parent[v] === START_FWD ? 0 : 1, edges, endDir: bestEnd, settled };
}

/* ------------------------------ Chemin ------------------------------ */

interface Junction {
  /** rang dans les points du chemin */
  ci: number;
  v: number;
  ein: number;
  eout: number;
}

const bearing = (la0: number, lo0: number, la1: number, lo1: number) =>
  Math.atan2((lo1 - lo0) * Math.cos((la0 + la1) * 0.5 * WALK_UNIT * RAD), la1 - la0) / RAD;

const RANK: Record<TurnKind, number> = { straight: 0, slightLeft: 1, slightRight: 1, left: 2, right: 2, sharpLeft: 3, sharpRight: 3, uturn: 4 };

/** Sens d'un virage d'après l'angle (degrés, positif à droite) ; null sous 30°. */
export function turnOf(angle: number): TurnKind | null {
  const a = Math.abs(angle);
  if (a < 30) return null;
  if (a > 170) return 'uturn';
  const right = angle > 0;
  if (a < 60) return right ? 'slightRight' : 'slightLeft';
  if (a < 135) return right ? 'right' : 'left';
  return right ? 'sharpRight' : 'sharpLeft';
}

/** Virages filtrés : rien dans les 20 derniers mètres, puis un seul (le plus marqué) par groupe à moins de 15 m. */
export function cleanManeuvers(list: readonly Maneuver[], lengthM: number): Maneuver[] {
  const out: Maneuver[] = [];
  for (const m of list) {
    if (m.distM > lengthM - LAST_M) continue;
    const last = out[out.length - 1];
    if (last && m.distM - last.distM < MERGE_M) {
      if (RANK[m.turn] > RANK[last.turn]) out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }
  return out;
}

/** Chemin droit (pas de données, ou extrémités sans voie proche) : aucun virage. */
export function straightRoute(from: LatLon, to: LatLon, builtAt: number): WalkRoute {
  const lengthM = unitsM(from.lat / WALK_UNIT, from.lon / WALK_UNIT, to.lat / WALK_UNIT, to.lon / WALK_UNIT);
  return { from, to, coords: [from, to], lengthM, maneuvers: [], source: 'straight', builtAt };
}

const round7 = (x: number) => Math.round(x * 1e7) / 1e7;

/** Assemble le chemin trouvé : points, longueur, virages. */
export function assemble(g: RoutingGraph, from: LatLon, to: LatLon, s: Snap, t: Snap, p: PathResult, builtAt: number): WalkRoute {
  const lat: number[] = [];
  const lon: number[] = [];
  const junctions: Junction[] = [];
  const add = (la: number, lo: number): number => {
    const n = lat.length;
    if (n && Math.abs(lat[n - 1] - la) < 0.01 && Math.abs(lon[n - 1] - lo) < 0.01) return n - 1;
    lat.push(la);
    lon.push(lo);
    return n;
  };
  const fu = { lat: from.lat / WALK_UNIT, lon: from.lon / WALK_UNIT };
  const tu = { lat: to.lat / WALK_UNIT, lon: to.lon / WALK_UNIT };
  const joinFrom = unitsM(fu.lat, fu.lon, s.lat, s.lon) >= JOIN_M;
  if (joinFrom) add(fu.lat, fu.lon);
  const sIdx = add(s.lat, s.lon);
  const sp = edgePolyline(g, s.e);
  if (p.direct) {
    if (t.along >= s.along) for (let i = s.seg + 1; i <= t.seg; i++) add(sp.lat[i], sp.lon[i]);
    else for (let i = s.seg; i > t.seg; i--) add(sp.lat[i], sp.lon[i]);
  } else {
    // sortie du tronçon de départ
    let exitNode: number;
    if (p.startDir === 0) {
      for (let i = s.seg + 1; i < sp.lat.length; i++) add(sp.lat[i], sp.lon[i]);
      exitNode = g.eTo[s.e];
    } else {
      for (let i = s.seg; i >= 0; i--) add(sp.lat[i], sp.lon[i]);
      exitNode = g.eFrom[s.e];
    }
    let ein = s.e;
    let v = exitNode;
    let ci = lat.length - 1;
    for (const packed of p.edges) {
      const e = packed >> 1;
      junctions.push({ ci, v, ein, eout: e });
      const pl = edgePolyline(g, e);
      if (packed & 1) for (let i = pl.lat.length - 2; i >= 0; i--) add(pl.lat[i], pl.lon[i]);
      else for (let i = 1; i < pl.lat.length; i++) add(pl.lat[i], pl.lon[i]);
      v = packed & 1 ? g.eFrom[e] : g.eTo[e];
      ein = e;
      ci = lat.length - 1;
    }
    junctions.push({ ci, v, ein, eout: t.e });
    // entrée sur le tronçon d'arrivée
    const tp = edgePolyline(g, t.e);
    if (p.endDir === 0) for (let i = 1; i <= t.seg; i++) add(tp.lat[i], tp.lon[i]);
    else for (let i = tp.lat.length - 2; i > t.seg; i--) add(tp.lat[i], tp.lon[i]);
  }
  const tIdx = add(t.lat, t.lon);
  let joinTo = unitsM(tu.lat, tu.lon, t.lat, t.lon) >= JOIN_M && add(tu.lat, tu.lon) > tIdx;
  if (lat.length < 2) {
    // départ et arrivée au même point : deux points quand même (un segment pour suivre la marche)
    lat.push(tu.lat);
    lon.push(tu.lon);
    joinTo = true;
  }
  // le chemin commence et finit exactement aux points demandés (accroche à moins d'un mètre : le point lui-même)
  const n = lat.length;
  if (!joinFrom) {
    lat[0] = fu.lat;
    lon[0] = fu.lon;
  }
  if (!joinTo && n > 1) {
    lat[n - 1] = tu.lat;
    lon[n - 1] = tu.lon;
  }
  // distances cumulées
  const cd = new Float64Array(n);
  for (let i = 1; i < n; i++) cd[i] = cd[i - 1] + unitsM(lat[i - 1], lon[i - 1], lat[i], lon[i]);
  const lengthM = cd[n - 1];
  const pointAt = (d: number): [number, number] => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cd[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = cd[hi] - cd[lo];
    const f = span > 0 ? Math.max(0, Math.min(1, (d - cd[lo]) / span)) : 0;
    return [lat[lo] + f * (lat[hi] - lat[lo]), lon[lo] + f * (lon[hi] - lon[lo])];
  };
  const raw: Maneuver[] = [];
  /** direction à l'entrée d'un rond-point : la sortie se mesure par rapport à elle */
  let ringIn: number | null = null;
  for (const j of junctions) {
    if (degree(g, j.v) < 3) continue;
    const inRing = (g.eFlags[j.ein] & F_RING) !== 0;
    const outRing = (g.eFlags[j.eout] & F_RING) !== 0;
    if (inRing && outRing) continue;
    const din = Math.min(BEARING_M, cd[j.ci] - cd[sIdx]);
    const dout = Math.min(BEARING_M, cd[tIdx] - cd[j.ci]);
    if (din < 2 || dout < 2) {
      if (outRing) ringIn = null;
      continue;
    }
    const [ala, alo] = pointAt(cd[j.ci] - din);
    const [bla, blo] = pointAt(cd[j.ci] + dout);
    const bin = bearing(ala, alo, lat[j.ci], lon[j.ci]);
    const bout = bearing(lat[j.ci], lon[j.ci], bla, blo);
    if (outRing) {
      // entrée sur l'anneau : pas de virage ; la sortie dira de quel côté on repart
      ringIn = bin;
      continue;
    }
    let angle = bout - (inRing && ringIn !== null ? ringIn : bin);
    if (inRing) ringIn = null;
    while (angle > 180) angle -= 360;
    while (angle <= -180) angle += 360;
    const turn = turnOf(angle);
    if (!turn) continue;
    const street = edgeName(g, j.eout);
    raw.push({ at: j.ci, distM: Math.round(cd[j.ci] * 10) / 10, turn, ...(street ? { street } : {}) });
  }
  const coords: LatLon[] = [];
  for (let i = 0; i < n; i++) coords.push({ lat: round7(lat[i] * WALK_UNIT), lon: round7(lon[i] * WALK_UNIT) });
  coords[0] = { lat: from.lat, lon: from.lon };
  if (n > 1) coords[n - 1] = { lat: to.lat, lon: to.lon };
  // 1.3.1 (A6, correctif du 21/11) : le raccord de départ (du point demandé à la voie) est signalé au guidage
  const joinAt = joinFrom && sIdx > 0 && sIdx < n ? { joinAt: sIdx } : {};
  return { from, to, coords, lengthM: Math.round(lengthM * 10) / 10, maneuvers: cleanManeuvers(raw, lengthM), source: 'osm', ...joinAt, builtAt };
}

export type RouteFail = 'nosnap' | 'nopath';

/** Chemin entre deux points sur un graphe chargé ; 'nosnap' : un bout sans voie à 100 m ; 'nopath' : pas de chemin. */
export function routeOn(g: RoutingGraph, from: LatLon, to: LatLon, builtAt: number): WalkRoute | RouteFail {
  const a = snapPoint(g, from.lat / WALK_UNIT, from.lon / WALK_UNIT);
  const b = snapPoint(g, to.lat / WALK_UNIT, to.lon / WALK_UNIT);
  if (!a.any || !b.any) return 'nosnap';
  const tries: [Snap, Snap][] = [];
  if (g.eComp[a.any.e] === g.eComp[b.any.e]) tries.push([a.any, b.any]);
  if (a.giant && b.giant && (a.giant !== a.any || b.giant !== b.any)) tries.push([a.giant, b.giant]);
  for (const [s, t] of tries) {
    const p = shortestPath(g, s, t);
    if (p) return assemble(g, from, to, s, t, p, builtAt);
  }
  return 'nopath';
}
