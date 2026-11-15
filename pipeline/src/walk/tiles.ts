/**
 * 1.2.10 : tuiles piétonnes (format : app/src/core/walk/format.ts). Chaque tronçon est coupé aux bords des tuiles
 * (point de coupe : nœud partagé par les deux tuiles, identifiant global déterministe), chaque morceau simplifié
 * (Douglas-Peucker, 2 m, bouts gardés) puis écrit dans la tuile qui le contient. Une tuile de plus de 300 ko est
 * coupée en 4, récursivement (3 niveaux au plus). Index : data/walk/index.json.
 */
import {
  boxOf, encodeTile, MAX_SPLIT_DEPTH, quarter, TILE_LAT_U, TILE_LON_U, WALK_TILE, WALK_UNIT,
  type ChainIn, type UnitBox, type WalkIndex, type WalkTileFile,
} from '../../../app/src/core/walk/format.ts';
import type { WalkGraph } from './graph.ts';

export const MAX_TILE_BYTES = 300_000;
export const BUDGET_BYTES = 80_000_000;
export const SIMPLIFY_M = 2;
export const SOURCE = 'OpenStreetMap, extrait Geofabrik belgium-latest.osm.pbf';
export const LICENCE = 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)';
export const ATTRIBUTION = '© les contributeurs d’OpenStreetMap';

const R = 6371000;
const RAD = Math.PI / 180;
/** mètres par unité de latitude (1e-5 degré) */
const M_LAT = R * RAD * WALK_UNIT;
/**
 * Identifiants des points de coupe des tuiles coupées en 4, au-delà de ceux des bords des tuiles de base
 * ((voie × 4096 + segment) × 16 + coupe, moins de 2^48 : identifiants de voie OSM sous 2^32).
 */
const SPLIT_CUT_BASE = 2 ** 49;

export interface TileBuildOptions {
  version: string;
  builtAt: string;
  maxTileBytes?: number;
  simplifyM?: number;
  /** garder un tronçon ? (limite autour des arrêts) */
  keepEdge?: (lat: number, lon: number) => boolean;
  nearStopsM?: number;
  /** source annoncée dans l'index (par défaut l'extrait Geofabrik) */
  source?: string;
  log?: (m: string) => void;
}

export interface BuiltTiles {
  files: { key: string; json: string; bytes: number }[];
  index: WalkIndex;
  stats: { tiles: number; bytes: number; maxTile: { key: string; bytes: number }; split: number; pieces: number; points: number; overLimit: string[] };
}

/** Morceau de tronçon dans une tuile : nœuds des bouts (carrefour ≥ 0, point de coupe < 0) et points (unités, flottants). */
interface Piece {
  way: number;
  comp: number;
  a: number;
  b: number;
  /** tous les points, bouts compris : [lat, lon, lat, lon, …] en unités flottantes */
  pts: number[];
  /** rang du tronçon puis du morceau, pour reformer les chaînes */
  edge: number;
  part: number;
}

/** Point de coupe : position (unités flottantes) et identifiant global. */
interface Cut {
  lat: number;
  lon: number;
  global: number;
}

interface CutAt {
  seg: number;
  t: number;
  lat: number;
  lon: number;
}

/** Coupes d'un segment par des droites lat = k·stepLat et lon = k·stepLon (strictement à l'intérieur). */
function segmentCuts(seg: number, la0: number, lo0: number, la1: number, lo1: number, latLines: (a: number, b: number) => number[], lonLines: (a: number, b: number) => number[], out: CutAt[]): void {
  const found: CutAt[] = [];
  for (const line of latLines(Math.min(la0, la1), Math.max(la0, la1))) {
    if ((la0 - line) * (la1 - line) < 0) {
      const t = (line - la0) / (la1 - la0);
      found.push({ seg, t, lat: line, lon: lo0 + t * (lo1 - lo0) });
    }
  }
  for (const line of lonLines(Math.min(lo0, lo1), Math.max(lo0, lo1))) {
    if ((lo0 - line) * (lo1 - line) < 0) {
      const t = (line - lo0) / (lo1 - lo0);
      found.push({ seg, t, lat: la0 + t * (la1 - la0), lon: line });
    }
  }
  found.sort((x, y) => x.t - y.t);
  for (const c of found) {
    const last = out[out.length - 1];
    if (last && last.seg === seg && Math.abs(last.t - c.t) < 1e-9) {
      // coin de tuile : une seule coupe, sur les deux droites
      if (Number.isInteger(c.lat)) last.lat = c.lat;
      if (Number.isInteger(c.lon)) last.lon = c.lon;
      continue;
    }
    out.push(c);
  }
}

const gridLines = (step: number) => (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let k = Math.ceil(a / step); k * step <= b; k++) out.push(k * step);
  return out;
};
const latGrid = gridLines(TILE_LAT_U);
const lonGrid = gridLines(TILE_LON_U);

/** Morceaux d'une polyligne coupée : bornes (nœuds) et points, bouts compris. */
function splitPolyline(pts: number[], cuts: CutAt[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [pts[0], pts[1]];
  let ci = 0;
  const nseg = pts.length / 2 - 1;
  for (let s = 0; s < nseg; s++) {
    while (ci < cuts.length && cuts[ci].seg === s) {
      cur.push(cuts[ci].lat, cuts[ci].lon);
      out.push(cur);
      cur = [cuts[ci].lat, cuts[ci].lon];
      ci++;
    }
    cur.push(pts[2 * s + 2], pts[2 * s + 3]);
  }
  out.push(cur);
  return out;
}

/** Clé (feuille parmi `leaf`) du point milieu du premier segment non nul d'un morceau. */
function pieceAnchor(p: number[]): [number, number] {
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (p[i] !== p[i + 2] || p[i + 1] !== p[i + 3]) return [(p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2];
  }
  return [p[0], p[1]];
}

const inBox = (b: UnitBox, lat: number, lon: number) => lat >= b.lat0 && lat < b.lat1 && lon >= b.lon0 && lon < b.lon1;

/** Douglas-Peucker en mètres (projection locale) : rangs des points gardés, bouts compris. */
export function simplify(pts: number[], tolM: number, cosLat: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return n === 2 ? [0, 1] : [0];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const kx = M_LAT * cosLat;
  while (stack.length) {
    const j = stack.pop() as number;
    const i = stack.pop() as number;
    if (j - i < 2) continue;
    const ay = pts[2 * i] * M_LAT;
    const ax = pts[2 * i + 1] * kx;
    const by = pts[2 * j] * M_LAT;
    const bx = pts[2 * j + 1] * kx;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tolM * tolM;
    for (let k = i + 1; k < j; k++) {
      const py = pts[2 * k] * M_LAT;
      const px = pts[2 * k + 1] * kx;
      let d2: number;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(i, best, best, j);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(k);
  return out;
}

export function buildTiles(g: WalkGraph, o: TileBuildOptions): BuiltTiles {
  const log = o.log ?? (() => undefined);
  const maxBytes = o.maxTileBytes ?? MAX_TILE_BYTES;
  const tol = o.simplifyM ?? SIMPLIFY_M;
  const d = g.data;
  const latU = (j: number) => d.nodeLat[j] / WALK_UNIT;
  const lonU = (j: number) => d.nodeLon[j] / WALK_UNIT;
  const nodeU = (j: number): readonly [number, number] => [Math.round(latU(j)), Math.round(lonU(j))];

  // tronçons gardés, rangés par tuile de base touchée (cadre de leur géométrie)
  const buckets = new Map<string, number[]>();
  let kept = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeComp[e] < 0) continue;
    let la0 = Infinity;
    let la1 = -Infinity;
    let lo0 = Infinity;
    let lo1 = -Infinity;
    let near = !o.keepEdge;
    for (let i = g.edgeA[e]; i <= g.edgeB[e]; i++) {
      const j = d.refs[i];
      const la = latU(j);
      const lo = lonU(j);
      if (la < la0) la0 = la;
      if (la > la1) la1 = la;
      if (lo < lo0) lo0 = lo;
      if (lo > lo1) lo1 = lo;
      if (!near && o.keepEdge && o.keepEdge(d.nodeLat[j], d.nodeLon[j])) near = true;
    }
    if (!near) continue;
    kept++;
    for (let ty = Math.floor(la0 / TILE_LAT_U); ty <= Math.floor(la1 / TILE_LAT_U); ty++) {
      for (let tx = Math.floor(lo0 / TILE_LON_U); tx <= Math.floor(lo1 / TILE_LON_U); tx++) {
        const k = `${ty}_${tx}`;
        const list = buckets.get(k);
        if (list) list.push(e);
        else buckets.set(k, [e]);
      }
    }
  }
  if (o.keepEdge) log(`Chemins à pied : ${kept} tronçons à moins de ${o.nearStopsM ?? '?'} m d'un arrêt`);

  const files: BuiltTiles['files'] = [];
  const skipped = new Set<number>();
  const split: string[] = [];
  const overLimit: string[] = [];
  let splitSeq = 0;
  let pieceCount = 0;
  let pointCount = 0;
  const keys = [...buckets.keys()].sort((x, y) => {
    const [ay, ax] = x.split('_').map(Number);
    const [by, bx] = y.split('_').map(Number);
    return ay - by || ax - bx;
  });

  for (const key of keys) {
    const box = boxOf(key) as UnitBox;
    const cosLat = Math.cos(((box.lat0 + box.lat1) / 2) * WALK_UNIT * RAD);
    const cuts = new Map<number, Cut>();
    const pieces: Piece[] = [];
    for (const e of buckets.get(key) as number[]) {
      // polyligne du tronçon (nœuds répétés aussitôt retirés) et rang de chaque point dans sa voie
      const w = g.edgeWay[e];
      const pts: number[] = [];
      const pos: number[] = [];
      let prev = -1;
      for (let i = g.edgeA[e]; i <= g.edgeB[e]; i++) {
        const j = d.refs[i];
        if (j === prev) continue;
        pts.push(latU(j), lonU(j));
        pos.push(i - d.wayStart[w]);
        prev = j;
      }
      const at: CutAt[] = [];
      for (let s = 0; s + 3 < pts.length; s += 2) {
        // même case de la grille aux deux bouts : aucune coupe possible
        if (Math.floor(pts[s] / TILE_LAT_U) === Math.floor(pts[s + 2] / TILE_LAT_U) && Math.floor(pts[s + 1] / TILE_LON_U) === Math.floor(pts[s + 3] / TILE_LON_U)) continue;
        segmentCuts(s / 2, pts[s], pts[s + 1], pts[s + 2], pts[s + 3], latGrid, lonGrid, at);
      }
      // identifiant stable d'un point de coupe : voie OSM, rang du segment dans la voie, rang de la coupe sur le segment
      const ids = at.map((c, i) => {
        let k = 0;
        while (i - k - 1 >= 0 && at[i - k - 1].seg === c.seg) k++;
        return k > 15 || pos[c.seg] > 4095 ? NaN : -((d.wayId[w] * 4096 + pos[c.seg]) * 16 + k);
      });
      // segment de plus de 30 km (erreur de dessin) : tronçon écarté plutôt que toute la construction
      if (ids.some(Number.isNaN)) {
        if (!skipped.has(e)) log(`Chemins à pied : voie ${d.wayId[w]} écartée (segment trop long pour les tuiles)`);
        skipped.add(e);
        continue;
      }
      const parts = splitPolyline(pts, at);
      const a = d.refs[g.edgeA[e]];
      const b = d.refs[g.edgeB[e]];
      parts.forEach((p, k) => {
        const [mla, mlo] = pieceAnchor(p);
        if (!inBox(box, mla, mlo)) return;
        const endA = k === 0 ? a : ids[k - 1];
        const endB = k === parts.length - 1 ? b : ids[k];
        for (const [id, x] of [[endA, 0], [endB, p.length - 2]] as const) {
          if (id < 0 && !cuts.has(id)) cuts.set(id, { lat: p[x], lon: p[x + 1], global: 2 * -id + 1 });
        }
        pieces.push({ way: w, comp: g.edgeComp[e], a: endA, b: endB, pts: p, edge: e, part: k });
      });
    }
    emitLeaf(key, box, pieces, cuts, cosLat, 0);
  }

  /** Écrit une feuille, ou la coupe en 4 si elle est trop lourde. */
  function emitLeaf(key: string, box: UnitBox, pieces: Piece[], cuts: Map<number, Cut>, cosLat: number, depth: number): void {
    if (!pieces.length) return;
    const tile = encodeLeaf(key, box, pieces, cuts, cosLat);
    const bytes = Buffer.byteLength(tile.json);
    if (bytes > maxBytes && depth < MAX_SPLIT_DEPTH) {
      split.push(key);
      const midLat = (box.lat0 + box.lat1) / 2;
      const midLon = (box.lon0 + box.lon1) / 2;
      const kids: Piece[][] = [[], [], [], []];
      for (const p of pieces) {
        const at: CutAt[] = [];
        for (let s = 0; s + 3 < p.pts.length; s += 2) {
          segmentCuts(s / 2, p.pts[s], p.pts[s + 1], p.pts[s + 2], p.pts[s + 3], (a, b) => (midLat >= a && midLat <= b ? [midLat] : []), (a, b) => (midLon >= a && midLon <= b ? [midLon] : []), at);
        }
        const parts = splitPolyline(p.pts, at);
        let prevEnd = p.a;
        parts.forEach((q, k) => {
          let end = p.b;
          if (k < parts.length - 1) {
            end = -(SPLIT_CUT_BASE + splitSeq++);
            cuts.set(end, { lat: q[q.length - 2], lon: q[q.length - 1], global: 2 * -end + 1 });
          }
          const [mla, mlo] = pieceAnchor(q);
          const qd = (mla >= midLat ? 2 : 0) + (mlo >= midLon ? 1 : 0);
          kids[qd].push({ ...p, a: prevEnd, b: end, pts: q, part: p.part * 16 + k });
          prevEnd = end;
        });
      }
      const sep = depth === 0 ? '_' : '';
      for (let q = 0; q < 4; q++) emitLeaf(`${key}${sep}${q}`, quarter(box, q), kids[q], cuts, cosLat, depth + 1);
      return;
    }
    if (bytes > maxBytes) overLimit.push(key);
    files.push({ key, json: tile.json, bytes });
    pieceCount += pieces.length;
    pointCount += tile.points;
  }

  /** Code une feuille : morceaux simplifiés, regroupés en chaînes (même voie, bout à bout). */
  function encodeLeaf(key: string, box: UnitBox, pieces: Piece[], cuts: Map<number, Cut>, cosLat: number): { json: string; points: number } {
    const coordOf = (id: number): readonly [number, number] => {
      if (id >= 0) return nodeU(id);
      const c = cuts.get(id) as Cut;
      return [Math.round(c.lat), Math.round(c.lon)];
    };
    // nœud partagé : point de coupe, ou carrefour posé exactement sur le bord de la feuille
    const onEdge = (id: number) => {
      if (id < 0) return true;
      const la = latU(id);
      const lo = lonU(id);
      const near = (x: number, v: number) => Math.abs(x - v) < 1e-6;
      return near(la, box.lat0) || near(la, box.lat1) || near(lo, box.lon0) || near(lo, box.lon1);
    };
    const global = (id: number): number | undefined => {
      if (!onEdge(id)) return undefined;
      return id < 0 ? (cuts.get(id) as Cut).global : 2 * d.nodeId[id];
    };
    const sorted = [...pieces].sort((x, y) => x.way - y.way || x.edge - y.edge || x.part - y.part);
    const names: string[] = [];
    const nameIdx = new Map<number, number>();
    const chains: ChainIn[] = [];
    let points = 0;
    let cur: ChainIn | null = null;
    let curWay = -1;
    let curEnd = NaN;
    for (const p of sorted) {
      const keepIdx = simplify(p.pts, tol, cosLat);
      const inner: number[] = [];
      let [pl, po] = coordOf(p.a);
      const [bl, bo] = coordOf(p.b);
      for (let k = 1; k < keepIdx.length - 1; k++) {
        const la = Math.round(p.pts[2 * keepIdx[k]]);
        const lo = Math.round(p.pts[2 * keepIdx[k] + 1]);
        if ((la === pl && lo === po) || (la === bl && lo === bo)) continue;
        inner.push(la, lo);
        pl = la;
        po = lo;
      }
      points += inner.length / 2;
      const wn = d.wayName[p.way];
      let name = -1;
      if (wn > 0) {
        let ni = nameIdx.get(wn);
        if (ni === undefined) {
          ni = names.length;
          names.push(d.names[wn]);
          nameIdx.set(wn, ni);
        }
        name = ni;
      }
      if (cur && curWay === p.way && curEnd === p.a && cur.comp === p.comp) {
        cur.nodes.push(p.b);
        cur.pts.push(inner);
      } else {
        cur = { name, flags: d.wayFlags[p.way], comp: p.comp, nodes: [p.a, p.b], pts: [inner] };
        chains.push(cur);
        curWay = p.way;
      }
      curEnd = p.b;
    }
    // chaînes rangées par position (codage plus court : écarts plus petits)
    const z = (c: ChainIn) => {
      const [la, lo] = coordOf(c.nodes[0]);
      return interleave(Math.max(0, la - box.lat0), Math.max(0, lo - box.lon0));
    };
    const zs = new Map(chains.map((c) => [c, z(c)] as const));
    chains.sort((x, y) => (zs.get(x) as number) - (zs.get(y) as number));
    const file: WalkTileFile = encodeTile(key, o.version, names, chains, coordOf, global);
    return { json: JSON.stringify(file), points };
  }

  files.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const biggest = files.reduce((m, f) => (f.bytes > m.bytes ? { key: f.key, bytes: f.bytes } : m), { key: '', bytes: 0 });
  const index: WalkIndex = {
    v: 1,
    version: o.version,
    builtAt: o.builtAt,
    source: o.source ?? SOURCE,
    licence: LICENCE,
    attribution: ATTRIBUTION,
    tile: { lat: WALK_TILE.lat, lon: WALK_TILE.lon },
    unit: WALK_UNIT,
    split: split.sort(),
    tiles: files.length,
    bytes: total,
    maxTileBytes: biggest.bytes,
    ...(o.nearStopsM ? { nearStopsM: o.nearStopsM } : {}),
  };
  return { files, index, stats: { tiles: files.length, bytes: total, maxTile: biggest, split: split.length, pieces: pieceCount, points: pointCount, overLimit } };
}

/** Code de Morton (ordre en Z) de deux entiers positifs (16 bits chacun suffisent pour une tuile). */
function interleave(x: number, y: number): number {
  let z = 0;
  for (let i = 0; i < 16; i++) z += (((x >> i) & 1) * 2 + ((y >> i) & 1)) * 4 ** i;
  return z;
}
