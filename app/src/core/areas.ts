/**
 * Zones d'arrêt : préparation des fichiers (horaires absolus triés), résumés, tuiles autour d'un point.
 */
import type { AreaFile, AreaSummary, Meta, Mode } from '../../../shared/types';
import { gtfsTime } from './util';
import { headKey } from './rtmerge';

const MODE_ORDER: Mode[] = ['train', 'metro', 'tram', 'bus'];

export interface PreparedArea {
  file: AreaFile;
  summary: AreaSummary;
  /** Instant (ms) de chaque départ (NaN si le jour n'est pas couvert). */
  times: Float64Array;
  /** Index des départs triés par instant. */
  order: Uint32Array;
  /** Clé de destination de chaque motif (normalizeForSearch(prettyName(head.fr))). */
  headKeys: string[];
  headKeysNl: string[];
  /** Motifs au départ de chaque arrêt physique (index dans stops). */
  patternsAtStop: number[][];
}

const prepared = new WeakMap<AreaFile, { dates: string; prep: PreparedArea }>();

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

export function summaryOf(f: AreaFile): AreaSummary {
  const modes = MODE_ORDER.filter((m) => f.patterns.some((p) => p.mode === m));
  const lines = [...new Set(f.patterns.map((p) => p.line))].sort(naturalCompare).slice(0, 12);
  return { id: f.id, op: f.op, n: f.n, lat: f.lat, lon: f.lon, modes, lines };
}

export function prepareArea(file: AreaFile, meta: Meta): PreparedArea {
  const dates = meta.serviceDates.join(',');
  const hit = prepared.get(file);
  if (hit && hit.dates === dates) return hit.prep;
  const n = file.deps.length;
  const times = new Float64Array(n);
  const bases = meta.serviceDates.map((d) => gtfsTime(d, 0));
  for (let i = 0; i < n; i++) {
    const d = file.deps[i];
    const base = bases[d[0]];
    times[i] = base === undefined ? NaN : base + d[1] * 60_000;
  }
  const idx = Array.from({ length: n }, (_, i) => i).filter((i) => !Number.isNaN(times[i]));
  idx.sort((a, b) => times[a] - times[b] || a - b);
  const patternsAtStop: number[][] = file.stops.map(() => []);
  for (const d of file.deps) {
    const list = patternsAtStop[d[3]];
    if (list && !list.includes(d[2])) list.push(d[2]);
  }
  const prep: PreparedArea = {
    file,
    summary: summaryOf(file),
    times,
    order: Uint32Array.from(idx),
    headKeys: file.patterns.map((p) => headKey(p.head?.fr ?? '')),
    headKeysNl: file.patterns.map((p) => headKey(p.head?.nl ?? '')),
    patternsAtStop,
  };
  prepared.set(file, { dates, prep });
  return prep;
}

/** Premier rang k (dans order) dont l'instant est ≥ t. */
export function lowerBound(prep: PreparedArea, t: number): number {
  let lo = 0;
  let hi = prep.order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (prep.times[prep.order[mid]] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Prochains départs (index dans deps) d'un motif à partir de t. */
export function nextDeparturesOfPattern(prep: PreparedArea, pattern: number, t: number, count: number): number[] {
  const out: number[] = [];
  for (let k = lowerBound(prep, t); k < prep.order.length && out.length < count; k++) {
    const i = prep.order[k];
    if (prep.file.deps[i][2] === pattern) out.push(i);
  }
  return out;
}

/** Dernier départ (index dans deps) d'un motif entre tMin et tMax compris, ou undefined. */
export function lastDepartureOfPattern(prep: PreparedArea, pattern: number, tMax: number, tMin: number): number | undefined {
  for (let k = lowerBound(prep, tMax + 1) - 1; k >= 0; k--) {
    const i = prep.order[k];
    if (prep.times[i] < tMin) return undefined;
    if (prep.file.deps[i][2] === pattern) return i;
  }
  return undefined;
}

/**
 * Clés des tuiles couvrant un rayon autour d'un point : au plus 2 tuiles de part et d'autre de celle du point (5 × 5,
 * environ 4 km garantis). Les rayons de la marche (moins d'une tuile) en prennent 3 × 3 au plus, comme avant ;
 * 1.2.2 : « Autour de moi » vide cherche l'arrêt le plus proche à 3 km (nearby léger, tuiles seules).
 */
export function tileKeysAround(lat: number, lon: number, radiusM: number, tile: Meta['tile']): string[] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const cy = Math.floor(lat / tile.lat);
  const cx = Math.floor(lon / tile.lon);
  const y0 = Math.max(cy - 2, Math.floor((lat - dLat) / tile.lat));
  const y1 = Math.min(cy + 2, Math.floor((lat + dLat) / tile.lat));
  const x0 = Math.max(cx - 2, Math.floor((lon - dLon) / tile.lon));
  const x1 = Math.min(cx + 2, Math.floor((lon + dLon) / tile.lon));
  const keys: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keys.push(`${y}_${x}`);
  return keys;
}

/** Rayon (m) garanti par les 3 × 3 tuiles autour d'un point. */
export function tileReachM(lat: number, tile: Meta['tile']): number {
  return Math.min(tile.lat * 111_320, tile.lon * 111_320 * Math.cos((lat * Math.PI) / 180));
}
