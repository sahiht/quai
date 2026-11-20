/**
 * 1.2.10 : graphe piéton du téléphone. Une tuile décodée (TileGraph) garde ses tableaux typés, la longueur de chaque
 * tronçon et son cadre (accroche). Plusieurs tuiles se fusionnent en un graphe de calcul (RoutingGraph) : nœuds
 * partagés réunis par leur identifiant global, voisins en tableaux compacts (CSR), coordonnées planes en mètres pour
 * l'heuristique de A*.
 */
import { decodeTile, F_STEPS, WALK_UNIT, type DecodedTile, type WalkTileFile } from './format';

const R = 6371000;
const RAD = Math.PI / 180;
/** Mètres par unité de latitude (1e-5 degré). */
export const M_PER_U = R * RAD * WALK_UNIT;
/** Coût d'un mètre d'escalier (plus lent qu'un mètre à plat) ; tout le reste vaut 1. */
export const STEPS_COST = 1.5;

/** Distance en mètres entre deux points en unités (projection locale ; mêmes valeurs que le pipeline). */
export function unitsM(lat0: number, lon0: number, lat1: number, lon1: number): number {
  const dy = (lat1 - lat0) * M_PER_U;
  const dx = (lon1 - lon0) * M_PER_U * Math.cos((lat0 + lat1) * 0.5 * WALK_UNIT * RAD);
  return Math.sqrt(dx * dx + dy * dy);
}

export interface TileGraph {
  key: string;
  ver: string;
  t: DecodedTile;
  /** cos de la latitude du centre de la tuile */
  cos: number;
  edgeLen: Float64Array;
  /** cadre de chaque tronçon en unités : latMin, latMax, lonMin, lonMax */
  bbox: Int32Array;
  /** poids en mémoire (nœuds + points + tronçons), pour le cache */
  weight: number;
}

/** Décode une tuile et calcule longueurs et cadres. */
export function prepareTile(f: WalkTileFile): TileGraph {
  const t = decodeTile(f);
  const n = t.edgeFrom.length;
  let latSum = 0;
  for (let i = 0; i < t.nodeLat.length; i++) latSum += t.nodeLat[i];
  const cos = Math.cos((t.nodeLat.length ? latSum / t.nodeLat.length : 0) * WALK_UNIT * RAD);
  const kx = M_PER_U * cos;
  const edgeLen = new Float64Array(n);
  const bbox = new Int32Array(4 * n);
  for (let e = 0; e < n; e++) {
    let la = t.nodeLat[t.edgeFrom[e]];
    let lo = t.nodeLon[t.edgeFrom[e]];
    let la0 = la;
    let la1 = la;
    let lo0 = lo;
    let lo1 = lo;
    let len = 0;
    const end = t.geoStart[e + 1];
    for (let i = t.geoStart[e]; i <= end; i++) {
      const nla = i < end ? t.ptLat[i] : t.nodeLat[t.edgeTo[e]];
      const nlo = i < end ? t.ptLon[i] : t.nodeLon[t.edgeTo[e]];
      const dy = (nla - la) * M_PER_U;
      const dx = (nlo - lo) * kx;
      len += Math.sqrt(dx * dx + dy * dy);
      la = nla;
      lo = nlo;
      if (la < la0) la0 = la;
      if (la > la1) la1 = la;
      if (lo < lo0) lo0 = lo;
      if (lo > lo1) lo1 = lo;
    }
    edgeLen[e] = len;
    bbox[4 * e] = la0;
    bbox[4 * e + 1] = la1;
    bbox[4 * e + 2] = lo0;
    bbox[4 * e + 3] = lo1;
  }
  return { key: t.key, ver: t.ver, t, cos, edgeLen, bbox, weight: t.nodeLat.length + t.ptLat.length + 2 * n };
}

/** Graphe de calcul : les tuiles chargées autour d'une marche, fusionnées. */
export interface RoutingGraph {
  tiles: TileGraph[];
  /** premier tronçon fusionné de chaque tuile */
  edgeBase: Int32Array;
  n: number;
  lat: Int32Array;
  lon: Int32Array;
  /** coordonnées planes (m) autour du point de référence, pour l'heuristique */
  x: Float64Array;
  y: Float64Array;
  refLat: number;
  refLon: number;
  kx: number;
  /** voisins du nœud v : adj[adjStart[v] .. adjStart[v + 1]) ; valeur = tronçon × 2 + sens (0 : de from à to) */
  adjStart: Int32Array;
  adj: Int32Array;
  m: number;
  eFrom: Int32Array;
  eTo: Int32Array;
  eLen: Float64Array;
  eCost: Float64Array;
  eFlags: Uint8Array;
  eComp: Int32Array;
  eTile: Uint16Array;
  eLocal: Int32Array;
  /** tableaux de travail de A* (réutilisés d'un calcul à l'autre) */
  scratch?: {
    g: Float64Array;
    parent: Int32Array;
    seen: Uint32Array;
    closed: Uint32Array;
    sid: number;
  };
  /**
   * 1.3.1 (R4) : attributs des tronçons écartés de ce graphe, ni accroche ni passage (seul le graphe sans marches de
   * withoutSteps en a : F_STEPS) ; absent : aucun.
   */
  skip?: number;
  /** 1.3.1 (R4) : le même graphe sans marches, gardé dès qu'il a servi (withoutSteps) */
  noSteps?: RoutingGraph;
}

/** Fusionne des tuiles (au moins une). */
export function mergeTiles(tiles: TileGraph[]): RoutingGraph {
  let nodes = 0;
  let m = 0;
  for (const tg of tiles) {
    nodes += tg.t.nodeLat.length;
    m += tg.t.edgeFrom.length;
  }
  const lat = new Int32Array(nodes);
  const lon = new Int32Array(nodes);
  const maps: Int32Array[] = [];
  const byGlobal = new Map<number, number>();
  let n = 0;
  for (const tg of tiles) {
    const t = tg.t;
    const map = new Int32Array(t.nodeLat.length);
    let k = 0;
    for (let i = 0; i < map.length; i++) {
      if (k < t.sharedLocal.length && t.sharedLocal[k] === i) {
        const gid = t.sharedGlobal[k++];
        const known = byGlobal.get(gid);
        if (known !== undefined) {
          map[i] = known;
          continue;
        }
        byGlobal.set(gid, n);
      }
      lat[n] = t.nodeLat[i];
      lon[n] = t.nodeLon[i];
      map[i] = n++;
    }
    maps.push(map);
  }
  const eFrom = new Int32Array(m);
  const eTo = new Int32Array(m);
  const eLen = new Float64Array(m);
  const eCost = new Float64Array(m);
  const eFlags = new Uint8Array(m);
  const eComp = new Int32Array(m);
  const eTile = new Uint16Array(m);
  const eLocal = new Int32Array(m);
  const edgeBase = new Int32Array(tiles.length);
  const deg = new Int32Array(n + 1);
  let e = 0;
  tiles.forEach((tg, ti) => {
    const t = tg.t;
    const map = maps[ti];
    edgeBase[ti] = e;
    for (let k = 0; k < t.edgeFrom.length; k++, e++) {
      const a = map[t.edgeFrom[k]];
      const b = map[t.edgeTo[k]];
      eFrom[e] = a;
      eTo[e] = b;
      eLen[e] = tg.edgeLen[k];
      eFlags[e] = t.edgeFlags[k];
      eCost[e] = tg.edgeLen[k] * (t.edgeFlags[k] & F_STEPS ? STEPS_COST : 1);
      eComp[e] = t.edgeComp[k];
      eTile[e] = ti;
      eLocal[e] = k;
      deg[a]++;
      deg[b]++;
    }
  });
  const adjStart = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) adjStart[v + 1] = adjStart[v] + deg[v];
  const fill = adjStart.slice(0, n);
  const adj = new Int32Array(adjStart[n]);
  for (let k = 0; k < m; k++) {
    adj[fill[eFrom[k]]++] = k * 2;
    adj[fill[eTo[k]]++] = k * 2 + 1;
  }
  let la0 = Infinity;
  let la1 = -Infinity;
  let lo0 = Infinity;
  let lo1 = -Infinity;
  for (let v = 0; v < n; v++) {
    if (lat[v] < la0) la0 = lat[v];
    if (lat[v] > la1) la1 = lat[v];
    if (lon[v] < lo0) lo0 = lon[v];
    if (lon[v] > lo1) lo1 = lon[v];
  }
  const latN = lat.slice(0, n);
  const lonN = lon.slice(0, n);
  const refLat = n ? (la0 + la1) / 2 : 0;
  const refLon = n ? (lo0 + lo1) / 2 : 0;
  const kx = M_PER_U * Math.cos(refLat * WALK_UNIT * RAD);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    x[v] = (lonN[v] - refLon) * kx;
    y[v] = (latN[v] - refLat) * M_PER_U;
  }
  return { tiles, edgeBase, n, lat: latN, lon: lonN, x, y, refLat, refLon, kx, adjStart, adj, m, eFrom, eTo, eLen, eCost, eFlags, eComp, eTile, eLocal };
}

/**
 * 1.3.1 (PRD-1.3.1 § 14, R4, « Éviter les escaliers ») : le même graphe, marches interdites. Un tronçon marqué F_STEPS
 * (escalier, et escalier mécanique : highway=steps dans OpenStreetMap, avec ou sans conveying, pipeline/src/walk/filter.ts)
 * n'est ni une accroche (`skip`) ni un passage (coût infini : A* ne le prend jamais). Un ascenseur dessiné et relié dans
 * OpenStreetMap est un nœud qui joint ses voies : un passage comme un autre. Tout le reste est partagé avec le graphe :
 * seul le coût change, calculé une fois ; les tableaux de travail de A* sont communs (un calcul à la fois).
 */
export function withoutSteps(g: RoutingGraph): RoutingGraph {
  if (g.noSteps) return g.noSteps;
  const eCost = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) eCost[e] = g.eFlags[e] & F_STEPS ? Infinity : g.eCost[e];
  const v: RoutingGraph = { ...g, eCost, skip: F_STEPS };
  Object.defineProperty(v, 'scratch', {
    enumerable: true,
    get: () => g.scratch,
    set: (s: RoutingGraph['scratch']) => {
      g.scratch = s;
    },
  });
  g.noSteps = v;
  return v;
}

/** Points d'un tronçon fusionné, du nœud from au nœud to compris (unités). */
export function edgePolyline(g: RoutingGraph, e: number): { lat: number[]; lon: number[] } {
  const tg = g.tiles[g.eTile[e]];
  const t = tg.t;
  const k = g.eLocal[e];
  const lat = [g.lat[g.eFrom[e]]];
  const lon = [g.lon[g.eFrom[e]]];
  for (let i = t.geoStart[k]; i < t.geoStart[k + 1]; i++) {
    lat.push(t.ptLat[i]);
    lon.push(t.ptLon[i]);
  }
  lat.push(g.lat[g.eTo[e]]);
  lon.push(g.lon[g.eTo[e]]);
  return { lat, lon };
}

/** Nom de la rue d'un tronçon fusionné, s'il est connu. */
export function edgeName(g: RoutingGraph, e: number): string | undefined {
  const t = g.tiles[g.eTile[e]].t;
  const i = t.edgeName[g.eLocal[e]];
  return i >= 0 ? t.names[i] || undefined : undefined;
}

/** Nombre de voies qui partent d'un nœud (carrefour : 3 ou plus). */
export function degree(g: RoutingGraph, v: number): number {
  return g.adjStart[v + 1] - g.adjStart[v];
}

export type { DecodedTile };
