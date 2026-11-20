/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : sorties du métro et du prémétro.
 * - Fichier publié data/exits.json (format : app/src/core/walk/exits-format.ts) : fait par writeExits avec l'extrait
 *   et les tuiles de la semaine (weekly.ts), copié par publishWalk ; jamais bloquant, ignoré par la 1.3.0.
 * - Mesure (commande « exits » de cli.ts), lancée seulement par une branche de vérification (flux « Données de nuit »,
 *   verification=true) : rien n'est publié, le bilan va dans le journal, avec les sorties retenues de chaque station.
 *
 * - Arrêts : éléments OSM (nœuds et voies) qui portent ref:STIB_MIVB (plusieurs numéros séparés par « ; »), arrêts ou
 *   quais (public_transport=stop_position|platform, railway=stop|tram_stop|platform), sous terre : location=underground,
 *   ou les mêmes règles que les voies (tunnel, couloir, indoor, couche ou niveau négatifs : filter.ts). Un numéro STIB
 *   compte une fois, avec le meilleur résultat de ses éléments.
 * - Chemins : les tuiles piétonnes de la nuit (celles du téléphone), raccordées par leurs nœuds partagés.
 * - Pour chaque élément : le quai est la voie sous terre (F_UNDER) la plus proche, à 30 m au plus ; on suit seulement
 *   les voies sous terre (sens uniques respectés) jusqu'à 600 m ; un nœud qui touche une voie de surface est une
 *   sortie ; son nom : la première voie de surface au nom de rue ou de place (isStreetName : jamais le nom de la
 *   station) à 60 m au plus le long des voies de surface, sinon la plus proche à 40 m au plus. Une sortie par nom,
 *   3 au plus par numéro STIB, de la plus proche du quai à la plus lointaine.
 * - Classes : A aucune voie piétonne à 30 m ; B voies de surface seulement (quai non marqué sous terre) ; C couloirs
 *   sans sortie à 600 m ; D sorties sans rue ni place nommée (isStreetName) ; E sortie nommée.
 * - Contrôle avec les données officielles : stations STIB de métro publiées (data/tiles, mode metro) avec un arrêt OSM
 *   sous terre à 150 m, et avec une sortie nommée.
 */
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeTile, F_BWD, F_FWD, F_UNDER, isWalkIndex, isWalkTile, leafKeysForBox, WALK_UNIT, type DecodedTile } from '../../../app/src/core/walk/format.ts';
import { isExitsFile, MAX_EXITS, type ExitsFile, type ExitTuple } from '../../../app/src/core/walk/exits-format.ts';
import { tagsOf, underground, wayName } from './filter.ts';
import { firstBlockWithoutNodes, PbfFile, readKeyedNodes, readWays, type Tags } from './pbf.ts';
import { ATTRIBUTION, LICENCE, SOURCE } from './tiles.ts';

export const STIB_KEY = 'ref:STIB_MIVB';
/** Quai : voie sous terre à cette distance au plus de l'arrêt. */
export const SNAP_UNDER_M = 30;
/** Couloirs suivis jusqu'à cette distance. */
export const MAX_UNDER_M = 600;
/** Nom d'une sortie : première voie nommée à cette distance le long des voies de surface… */
export const NAME_ALONG_M = 60;
/** … sinon voie de surface nommée la plus proche, à cette distance au plus. */
export const NAME_NEAR_M = 40;
/** Station officielle et arrêt OSM : à cette distance au plus. */
export const OFFICIAL_M = 150;
/** Tuiles chargées autour de chaque arrêt. */
export const AROUND_M = 900;
/** Seuil du propriétaire (PRD-1.3.1 § 14). */
export const THRESHOLD = 0.8;

const R = 6371000;
const RAD = Math.PI / 180;
/** Mètres par unité de latitude (1e-5 degré). */
const M_PER_U = R * RAD * WALK_UNIT;
const KEEP = ['name', 'name:fr', 'name:nl', 'railway', 'public_transport', 'location', 'layer', 'level', 'tunnel', 'indoor', 'highway', 'subway', 'tram', 'bus', 'station', 'entrance'];

export type ExitClass = 'A' | 'B' | 'C' | 'D' | 'E';
const RANK: Record<ExitClass, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

export interface StibFeature {
  /** « n123 » (nœud) ou « w456 » (voie) */
  osm: string;
  lat: number;
  lon: number;
  codes: string[];
  name: string;
  role: 'stop' | 'platform' | 'station' | 'entrance' | 'other';
  mode: 'metro' | 'tram' | 'bus' | 'other';
  under: boolean;
}

/* ------------------------------ Arrêts STIB d'OSM ------------------------------ */

function pick(t: Tags, key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [...KEEP, key]) {
    const v = t.get(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Élément OSM porteur d'un numéro STIB : rôle, mode, sous terre ou non. */
export function featureOf(osm: string, lat: number, lon: number, tags: Record<string, string>, key = STIB_KEY): StibFeature {
  const t = tagsOf(tags);
  const rw = tags.railway;
  const pt = tags.public_transport;
  const role: StibFeature['role'] =
    rw === 'subway_entrance' || rw === 'train_station_entrance' || tags.entrance !== undefined
      ? 'entrance'
      : pt === 'platform' || rw === 'platform' || tags.highway === 'platform' || tags.highway === 'bus_stop'
        ? 'platform'
        : pt === 'stop_position' || rw === 'stop' || rw === 'tram_stop' || rw === 'halt'
          ? 'stop'
          : pt === 'station' || pt === 'stop_area' || rw === 'station'
            ? 'station'
            : 'other';
  const mode: StibFeature['mode'] =
    tags.subway === 'yes' || tags.station === 'subway' || rw === 'subway_entrance'
      ? 'metro'
      : tags.tram === 'yes' || rw === 'tram_stop' || tags.station === 'light_rail'
        ? 'tram'
        : tags.bus === 'yes' || tags.highway === 'bus_stop'
          ? 'bus'
          : 'other';
  const codes = (tags[key] ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return { osm, lat, lon, codes, name: wayName(t), role, mode, under: tags.location === 'underground' || underground(t) };
}

/** Arrêt ou quai sous terre : ce que mesure R1 (stations, entrées et autres éléments sont seulement comptés). */
export const isUnderStop = (f: StibFeature) => f.under && (f.role === 'stop' || f.role === 'platform') && f.codes.length > 0;

/**
 * Éléments OSM d'un extrait PBF qui portent `key` : nœuds (étiquettes lues seulement dans les blocs qui ont la clé) et
 * voies (position : moyenne de leurs nœuds). Deux passages, comme le graphe piéton.
 */
export function readStibFeatures(path: string, key = STIB_KEY): { features: StibFeature[]; timestamp?: number } {
  const f = new PbfFile(path);
  try {
    const split = firstBlockWithoutNodes(f);
    const nodeEnd = split === null ? f.blobs.length : split;
    const wayStart = split === null ? 0 : Math.max(0, split - 1);
    const ways: { id: number; tags: Record<string, string>; refs: number[] }[] = [];
    for (let i = wayStart; i < f.blobs.length; i++) {
      readWays(f.block(i), (t) => t.has(key), (id, t, refs, n) => {
        ways.push({ id, tags: pick(t, key), refs: Array.from(refs.subarray(0, n)) });
      });
    }
    const wanted = new Set<number>();
    for (const w of ways) for (const r of w.refs) wanted.add(r);
    const coords = new Map<number, [number, number]>();
    const features: StibFeature[] = [];
    for (let i = 0; i < nodeEnd; i++) {
      readKeyedNodes(
        f.block(i),
        key,
        (id, lat, lon, tags) => {
          const rec: Record<string, string> = {};
          for (const k of [...KEEP, key]) {
            const v = tags.get(k);
            if (v !== undefined) rec[k] = v;
          }
          features.push(featureOf(`n${id}`, lat, lon, rec, key));
        },
        wanted.size ? (id) => wanted.has(id) : undefined,
        (id, lat, lon) => coords.set(id, [lat, lon]),
      );
    }
    for (const w of ways) {
      let la = 0;
      let lo = 0;
      let n = 0;
      for (const r of w.refs) {
        const c = coords.get(r);
        if (!c) continue;
        la += c[0];
        lo += c[1];
        n++;
      }
      if (n) features.push(featureOf(`w${w.id}`, la / n, lo / n, w.tags, key));
    }
    return { features, timestamp: f.header.timestamp };
  } finally {
    f.close();
  }
}

/* ------------------------------ Graphe des tuiles ------------------------------ */

export interface ExitGraph {
  lat: Int32Array;
  lon: Int32Array;
  eFrom: Int32Array;
  eTo: Int32Array;
  eLen: Float64Array;
  eFlags: Uint8Array;
  eName: string[];
  geoStart: Int32Array;
  ptLat: Int32Array;
  ptLon: Int32Array;
  adjStart: Int32Array;
  adj: Int32Array;
  cells: Map<number, number[]>;
  tiles: number;
  version: string;
}

const CELL_LAT_U = 100;
const CELL_LON_U = 150;
const cellKey = (cy: number, cx: number) => cy * 1_000_000 + cx;

/** Tuiles raccordées par leurs nœuds partagés (identifiant global), avec voisins et grille de 100 m. */
export function mergeForExits(tiles: readonly DecodedTile[], version = ''): ExitGraph {
  const lat: number[] = [];
  const lon: number[] = [];
  const shared = new Map<number, number>();
  const eFrom: number[] = [];
  const eTo: number[] = [];
  const eFlags: number[] = [];
  const eName: string[] = [];
  const geoStart: number[] = [0];
  const ptLat: number[] = [];
  const ptLon: number[] = [];
  for (const t of tiles) {
    const local = new Int32Array(t.nodeLat.length);
    const glob = new Map<number, number>();
    for (let i = 0; i < t.sharedLocal.length; i++) glob.set(t.sharedLocal[i], t.sharedGlobal[i]);
    for (let i = 0; i < t.nodeLat.length; i++) {
      const g = glob.get(i);
      let m = g === undefined ? undefined : shared.get(g);
      if (m === undefined) {
        m = lat.length;
        lat.push(t.nodeLat[i]);
        lon.push(t.nodeLon[i]);
        if (g !== undefined) shared.set(g, m);
      }
      local[i] = m;
    }
    for (let e = 0; e < t.edgeFrom.length; e++) {
      eFrom.push(local[t.edgeFrom[e]]);
      eTo.push(local[t.edgeTo[e]]);
      eFlags.push(t.edgeFlags[e]);
      eName.push(t.edgeName[e] >= 0 ? (t.names[t.edgeName[e]] ?? '') : '');
      for (let i = t.geoStart[e]; i < t.geoStart[e + 1]; i++) {
        ptLat.push(t.ptLat[i]);
        ptLon.push(t.ptLon[i]);
      }
      geoStart.push(ptLat.length);
    }
  }
  const g: ExitGraph = {
    lat: Int32Array.from(lat),
    lon: Int32Array.from(lon),
    eFrom: Int32Array.from(eFrom),
    eTo: Int32Array.from(eTo),
    eLen: new Float64Array(eFrom.length),
    eFlags: Uint8Array.from(eFlags),
    eName,
    geoStart: Int32Array.from(geoStart),
    ptLat: Int32Array.from(ptLat),
    ptLon: Int32Array.from(ptLon),
    adjStart: new Int32Array(lat.length + 1),
    adj: new Int32Array(0),
    cells: new Map(),
    tiles: tiles.length,
    version,
  };
  const deg = new Int32Array(lat.length + 1);
  for (let e = 0; e < g.eFrom.length; e++) {
    const pts = polyline(g, e);
    let len = 0;
    let la0 = Infinity;
    let la1 = -Infinity;
    let lo0 = Infinity;
    let lo1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (i) len += metres(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
      la0 = Math.min(la0, pts[i]);
      la1 = Math.max(la1, pts[i]);
      lo0 = Math.min(lo0, pts[i + 1]);
      lo1 = Math.max(lo1, pts[i + 1]);
    }
    g.eLen[e] = len;
    for (let cy = Math.floor(la0 / CELL_LAT_U); cy <= Math.floor(la1 / CELL_LAT_U); cy++) {
      for (let cx = Math.floor(lo0 / CELL_LON_U); cx <= Math.floor(lo1 / CELL_LON_U); cx++) {
        const k = cellKey(cy, cx);
        const list = g.cells.get(k);
        if (list) list.push(e);
        else g.cells.set(k, [e]);
      }
    }
    deg[g.eFrom[e] + 1]++;
    if (g.eTo[e] !== g.eFrom[e]) deg[g.eTo[e] + 1]++;
  }
  for (let i = 1; i <= lat.length; i++) deg[i] += deg[i - 1];
  g.adjStart = deg.slice();
  g.adj = new Int32Array(deg[lat.length]);
  const fill = deg.slice();
  for (let e = 0; e < g.eFrom.length; e++) {
    g.adj[fill[g.eFrom[e]]++] = e;
    if (g.eTo[e] !== g.eFrom[e]) g.adj[fill[g.eTo[e]]++] = e;
  }
  return g;
}

/** Points d'un tronçon, en unités : [lat, lon, lat, lon, …] du nœud de départ au nœud d'arrivée. */
function polyline(g: ExitGraph, e: number): number[] {
  const out = [g.lat[g.eFrom[e]], g.lon[g.eFrom[e]]];
  for (let i = g.geoStart[e]; i < g.geoStart[e + 1]; i++) out.push(g.ptLat[i], g.ptLon[i]);
  out.push(g.lat[g.eTo[e]], g.lon[g.eTo[e]]);
  return out;
}

function metres(la0: number, lo0: number, la1: number, lo1: number): number {
  const dy = (la1 - la0) * M_PER_U;
  const dx = (lo1 - lo0) * M_PER_U * Math.cos((la0 + la1) * 0.5 * WALK_UNIT * RAD);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Tuiles de `tilesDir` autour des points (AROUND_M), décodées et raccordées ; null sans index valide. */
export async function loadExitGraph(tilesDir: string, points: readonly { lat: number; lon: number }[]): Promise<ExitGraph | null> {
  let idx: unknown;
  try {
    idx = JSON.parse(await readFile(join(tilesDir, 'index.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isWalkIndex(idx)) return null;
  const split = new Set(idx.split);
  const keys = new Set<string>();
  const dLat = AROUND_M / M_PER_U;
  for (const p of points) {
    const la = p.lat / WALK_UNIT;
    const lo = p.lon / WALK_UNIT;
    const dLon = AROUND_M / (M_PER_U * Math.max(0.1, Math.cos(p.lat * RAD)));
    for (const k of leafKeysForBox({ lat0: Math.floor(la - dLat), lat1: Math.ceil(la + dLat), lon0: Math.floor(lo - dLon), lon1: Math.ceil(lo + dLon) }, split)) keys.add(k);
  }
  const tiles: DecodedTile[] = [];
  for (const k of [...keys].sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(tilesDir, `${k}.json`), 'utf8'));
    } catch {
      continue; // pas de voie dans cette tuile
    }
    if (isWalkTile(raw)) tiles.push(decodeTile(raw));
  }
  return mergeForExits(tiles, idx.version);
}

/* ------------------------------ Mesure ------------------------------ */

interface Snap {
  e: number;
  along: number;
  dist: number;
}

/** Tronçon le plus proche d'un point (unités), à `maxM` au plus, parmi ceux qu'accepte `ok`. */
function nearest(g: ExitGraph, latU: number, lonU: number, maxM: number, ok: (e: number) => boolean): Snap | null {
  const kx = M_PER_U * Math.cos(latU * WALK_UNIT * RAD);
  const ry = Math.ceil(maxM / (CELL_LAT_U * M_PER_U)) + 1;
  const rx = Math.ceil(maxM / (CELL_LON_U * kx)) + 1;
  const cy0 = Math.floor(latU / CELL_LAT_U);
  const cx0 = Math.floor(lonU / CELL_LON_U);
  const seen = new Set<number>();
  let best: Snap | null = null;
  for (let cy = cy0 - ry; cy <= cy0 + ry; cy++) {
    for (let cx = cx0 - rx; cx <= cx0 + rx; cx++) {
      for (const e of g.cells.get(cellKey(cy, cx)) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (!ok(e)) continue;
        const pts = polyline(g, e);
        let along = 0;
        for (let i = 2; i < pts.length; i += 2) {
          const ax = (pts[i - 1] - lonU) * kx;
          const ay = (pts[i - 2] - latU) * M_PER_U;
          const bx = (pts[i + 1] - lonU) * kx;
          const by = (pts[i] - latU) * M_PER_U;
          const dx = bx - ax;
          const dy = by - ay;
          const l2 = dx * dx + dy * dy;
          const u = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
          const d = Math.hypot(ax + u * dx, ay + u * dy);
          const seg = Math.sqrt(l2);
          if (d <= maxM && (!best || d < best.dist)) best = { e, along: along + u * seg, dist: d };
          along += seg;
        }
      }
    }
  }
  return best;
}

/** Petit tas binaire (distance, nœud). */
class Heap {
  d: number[] = [];
  v: number[] = [];
  push(d: number, v: number): void {
    this.d.push(d);
    this.v.push(v);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      [this.d[p], this.d[i]] = [this.d[i], this.d[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): [number, number] | null {
    if (!this.d.length) return null;
    const top: [number, number] = [this.d[0], this.v[0]];
    const ld = this.d.pop() as number;
    const lv = this.v.pop() as number;
    if (this.d.length) {
      this.d[0] = ld;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.d.length && this.d[l] < this.d[m]) m = l;
        if (r < this.d.length && this.d[r] < this.d[m]) m = r;
        if (m === i) break;
        [this.d[m], this.d[i]] = [this.d[i], this.d[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

const under = (g: ExitGraph, e: number) => (g.eFlags[e] & F_UNDER) !== 0;

/** Sorties atteintes par les couloirs depuis le quai : nœud → distance sous terre (m), MAX_UNDER_M au plus. */
export function exitsFrom(g: ExitGraph, s: Snap): Map<number, number> {
  const dist = new Map<number, number>();
  const exits = new Map<number, number>();
  const heap = new Heap();
  const f = g.eFlags[s.e];
  // vers le nœud de départ du tronçon : à rebours de la chaîne (interdit si sens unique F_FWD), et inversement
  if (!(f & F_FWD)) heap.push(s.along, g.eFrom[s.e]);
  if (!(f & F_BWD)) heap.push(Math.max(0, g.eLen[s.e] - s.along), g.eTo[s.e]);
  for (let top = heap.pop(); top; top = heap.pop()) {
    const [d, u] = top;
    if (dist.has(u) || d > MAX_UNDER_M) continue;
    dist.set(u, d);
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const e = g.adj[k];
      if (!under(g, e)) {
        if (!exits.has(u)) exits.set(u, d);
        continue;
      }
      const fwd = g.eFrom[e] === u;
      if (fwd ? g.eFlags[e] & F_BWD : g.eFlags[e] & F_FWD) continue;
      const v = fwd ? g.eTo[e] : g.eFrom[e];
      if (!dist.has(v)) heap.push(d + g.eLen[e], v);
    }
  }
  return exits;
}

/* ------------------------------ Noms des sorties ------------------------------ */

/** Mots qui ouvrent un nom de rue ou de place (minuscules, sans accents). */
const STREET_HEADS = new Set([
  'rue', 'avenue', 'boulevard', 'place', 'chaussee', 'square', 'quai', 'parvis', 'allee', 'cours', 'passage', 'impasse',
  'esplanade', 'rond-point', 'carrefour', 'chemin', 'clos', 'dreve', 'venelle', 'ruelle', 'pont', 'promenade', 'montagne',
  'marche', 'mont', 'grand-place',
]);
/** Débuts en deux mots (« Petite rue des Bouchers », « Vieux Marché aux Grains »). */
const STREET_HEADS_2 = new Set(['petite rue', 'vieux marche', 'grand place']);

/** Nom replié pour comparer : minuscules, sans accents, apostrophes droites, espaces simples. */
export function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1.3.1 (R1, consigne du 20/11) : nom montré pour une sortie : une rue ou une place (le premier mot le dit : « Rue »,
 * « Avenue », « Place », « Chaussée »…), jamais le nom de la station elle-même (« Parc », « Louise », « Gare de
 * l'Ouest », « Heysel »), ni un sentier, un quai de gare ou un parc.
 */
export function isStreetName(name: string, station = ''): boolean {
  const n = fold(name);
  if (!n) return false;
  const st = fold(station);
  if (st && n === st) return false;
  const words = n.split(' ');
  return STREET_HEADS.has(words[0]) || (words.length > 1 && STREET_HEADS_2.has(`${words[0]} ${words[1]}`));
}

/**
 * Nom d'une sortie : la première voie de surface dont le nom convient (`ok`), à NAME_ALONG_M au plus le long des voies
 * de surface, sinon la voie de surface au nom qui convient la plus proche, à NAME_NEAR_M au plus ; '' sinon.
 */
export function exitName(g: ExitGraph, node: number, ok: (name: string) => boolean = () => true): string {
  const dist = new Map<number, number>();
  const heap = new Heap();
  heap.push(0, node);
  for (let top = heap.pop(); top; top = heap.pop()) {
    const [d, u] = top;
    if (dist.has(u) || d > NAME_ALONG_M) continue;
    dist.set(u, d);
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const e = g.adj[k];
      if (under(g, e)) continue;
      if (g.eName[e] && ok(g.eName[e])) return g.eName[e];
      const v = g.eFrom[e] === u ? g.eTo[e] : g.eFrom[e];
      if (!dist.has(v)) heap.push(d + g.eLen[e], v);
    }
  }
  const s = nearest(g, g.lat[node], g.lon[node], NAME_NEAR_M, (e) => !under(g, e) && g.eName[e] !== '' && ok(g.eName[e]));
  return s ? g.eName[s.e] : '';
}

/** Une sortie retenue : nom, point en surface (degrés), mètres de couloir depuis le quai. */
export interface FoundExit {
  name: string;
  lat: number;
  lon: number;
  m: number;
}

export interface FeatureResult {
  f: StibFeature;
  cls: ExitClass;
  /** distance sous terre jusqu'à la première sortie nommée (E) */
  underM?: number;
  /** rues des sorties nommées, de la plus proche à la plus lointaine (4 au plus) */
  names: string[];
  /** sorties nommées, une par nom, de la plus proche à la plus lointaine */
  exits: FoundExit[];
}

/** Classe d'un arrêt ou quai sous terre (voir l'en-tête) ; noms : rues et places seulement (isStreetName). */
export function measureFeature(g: ExitGraph, f: StibFeature): FeatureResult {
  const latU = f.lat / WALK_UNIT;
  const lonU = f.lon / WALK_UNIT;
  const any = nearest(g, latU, lonU, SNAP_UNDER_M, () => true);
  if (!any) return { f, cls: 'A', names: [], exits: [] };
  const s = nearest(g, latU, lonU, SNAP_UNDER_M, (e) => under(g, e));
  if (!s) return { f, cls: 'B', names: [], exits: [] };
  const found = [...exitsFrom(g, s).entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!found.length) return { f, cls: 'C', names: [], exits: [] };
  const exits: FoundExit[] = [];
  const ok = (n: string) => isStreetName(n, f.name);
  for (const [node, d] of found) {
    const name = exitName(g, node, ok);
    if (!name || exits.some((x) => x.name === name)) continue;
    exits.push({ name, lat: round5(g.lat[node] * WALK_UNIT), lon: round5(g.lon[node] * WALK_UNIT), m: Math.round(d) });
  }
  if (!exits.length) return { f, cls: 'D', names: [], exits: [] };
  return { f, cls: 'E', underM: exits[0].m, names: exits.slice(0, 4).map((x) => x.name), exits };
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

export interface CodeResult {
  code: string;
  name: string;
  mode: StibFeature['mode'];
  cls: ExitClass;
  underM?: number;
  names: string[];
  /** sorties de tous ses éléments, une par nom (la plus courte), de la plus proche à la plus lointaine */
  exits: FoundExit[];
}

/** Un résultat par numéro STIB : le meilleur de ses arrêts et quais sous terre ; leurs sorties réunies. */
export function byCode(results: readonly FeatureResult[]): CodeResult[] {
  const out = new Map<string, CodeResult>();
  for (const r of results) {
    for (const code of r.f.codes) {
      const cur = out.get(code);
      const merged = mergeExits(cur?.exits ?? [], r.exits);
      if (!cur || RANK[r.cls] > RANK[cur.cls] || (r.cls === cur.cls && (r.underM ?? Infinity) < (cur.underM ?? Infinity))) {
        out.set(code, { code, name: r.f.name || cur?.name || '', mode: r.f.mode !== 'other' ? r.f.mode : (cur?.mode ?? 'other'), cls: r.cls, ...(r.underM !== undefined ? { underM: r.underM } : {}), names: r.names, exits: merged });
      } else {
        if (!cur.name && r.f.name) cur.name = r.f.name;
        cur.exits = merged;
      }
    }
  }
  for (const c of out.values()) if (c.exits.length) c.names = c.exits.slice(0, 4).map((x) => x.name);
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/** Sorties réunies : une par nom (la plus courte en couloir), de la plus proche à la plus lointaine. */
function mergeExits(a: readonly FoundExit[], b: readonly FoundExit[]): FoundExit[] {
  const best = new Map<string, FoundExit>();
  for (const x of [...a, ...b]) {
    const cur = best.get(x.name);
    if (!cur || x.m < cur.m) best.set(x.name, x);
  }
  return [...best.values()].sort((x, y) => x.m - y.m || x.name.localeCompare(y.name, 'fr'));
}

/* ------------------------------ Fichier publié (data/exits.json) ------------------------------ */

/** Fichier des sorties : les numéros STIB sous terre avec au moins une sortie (rue ou place), 3 au plus. */
export function exitsFile(codes: readonly CodeResult[], meta: { version: string; builtAt: string }): ExitsFile {
  const stops: ExitsFile['stops'] = {};
  for (const c of codes) {
    if (c.cls !== 'E' || !c.exits.length) continue;
    stops[c.code] = { s: c.name, x: c.exits.slice(0, MAX_EXITS).map((e): ExitTuple => [e.name, e.lat, e.lon, e.m]) };
  }
  return { v: 1, version: meta.version, builtAt: meta.builtAt, source: SOURCE, licence: LICENCE, attribution: ATTRIBUTION, stops };
}

/**
 * 1.3.1 (R1) : construit data/exits.json (écrit dans `out`, par un fichier temporaire renommé) avec l'extrait et les
 * tuiles de la semaine. Ne lève jamais : renvoie une phrase pour le journal (« … arrêts sous terre avec une sortie »).
 */
export async function writeExits(o: { pbf: string; tilesDir: string; out: string; version: string; builtAt: string; key?: string }): Promise<{ ok: boolean; message: string; stops?: number }> {
  try {
    const { features } = readStibFeatures(o.pbf, o.key ?? STIB_KEY);
    const targets = features.filter(isUnderStop);
    const g = await loadExitGraph(o.tilesDir, targets);
    if (!g) return { ok: false, message: 'sorties du métro non faites (tuiles illisibles)' };
    const codes = byCode(targets.map((f) => measureFeature(g, f)));
    const file = exitsFile(codes, { version: o.version, builtAt: o.builtAt });
    if (!isExitsFile(file)) return { ok: false, message: 'sorties du métro non faites (fichier incohérent)' };
    const n = Object.keys(file.stops).length;
    const tmp = `${o.out}.tmp`;
    await writeFile(tmp, JSON.stringify(file), 'utf8');
    await rename(tmp, o.out);
    return { ok: true, message: `sorties du métro : ${n} arrêts STIB sous terre sur ${codes.length} avec une sortie`, stops: n };
  } catch (e) {
    return { ok: false, message: `sorties du métro non faites (${e instanceof Error ? e.message : String(e)})` };
  }
}

/* ------------------------------ Données officielles ------------------------------ */

export interface OfficialStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Stations STIB de métro publiées (data/tiles/*.json, zones de la STIB avec le mode metro). */
export async function officialMetroStations(dataDir: string): Promise<OfficialStation[]> {
  const dir = join(dataDir, 'tiles');
  const out: OfficialStation[] = [];
  let files: string[];
  try {
    files = (await readdir(dir)).filter((x) => x.endsWith('.json')).sort();
  } catch {
    return out;
  }
  for (const n of files) {
    try {
      const t = JSON.parse(await readFile(join(dir, n), 'utf8')) as { areas?: { id?: unknown; op?: unknown; n?: { fr?: unknown }; lat?: unknown; lon?: unknown; modes?: unknown }[] };
      for (const a of t.areas ?? []) {
        if (a.op !== 'stib' || !Array.isArray(a.modes) || !a.modes.includes('metro')) continue;
        if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
        out.push({ id: String(a.id), name: typeof a.n?.fr === 'string' ? a.n.fr : String(a.id), lat: a.lat, lon: a.lon });
      }
    } catch {
      /* tuile illisible : ignorée */
    }
  }
  return out;
}

const groundM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => metres(a.lat / WALK_UNIT, a.lon / WALK_UNIT, b.lat / WALK_UNIT, b.lon / WALK_UNIT);

/* ------------------------------ Bilan ------------------------------ */

export interface ExitReport {
  lines: string[];
  /** part des numéros STIB sous terre avec une sortie nommée (0 à 1) */
  rate: number;
  codes: CodeResult[];
  official?: { stations: number; covered: number; named: number };
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1).replace('.', ',')} %` : '-');
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** Mesure complète et lignes du journal (préfixe « Sorties du métro »). */
export function exitReport(g: ExitGraph, features: readonly StibFeature[], stations: readonly OfficialStation[] | null, meta: { osmDate?: string; key?: string } = {}): ExitReport {
  const key = meta.key ?? STIB_KEY;
  const P = 'Sorties du métro';
  const lines: string[] = [];
  const roles = new Map<string, number>();
  for (const f of features) roles.set(`${f.role}${f.under ? ' sous terre' : ''}`, (roles.get(`${f.role}${f.under ? ' sous terre' : ''}`) ?? 0) + 1);
  const targets = features.filter(isUnderStop);
  const results = targets.map((f) => measureFeature(g, f));
  const codes = byCode(results);
  const count = (c: ExitClass) => codes.filter((x) => x.cls === c).length;
  const named = count('E');
  const rate = codes.length ? named / codes.length : 0;
  const stationNames = new Set(codes.map((c) => c.name).filter(Boolean));
  const modes = (m: StibFeature['mode']) => codes.filter((c) => c.mode === m).length;
  lines.push(`${P} : extrait OSM du ${meta.osmDate ?? '?'}, tuiles piétonnes ${g.version || '?'} (${g.tiles} tuiles autour des arrêts)`);
  lines.push(`${P} : ${features.length} éléments OSM avec ${key} (${[...roles.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  lines.push(`${P} : ${codes.length} numéros STIB sous terre (arrêts et quais : métro ${modes('metro')}, tram ${modes('tram')}, bus ${modes('bus')}, autre ${modes('other')}), ${stationNames.size} noms de station`);
  lines.push(`${P} : sortie nommée par les couloirs pour ${named} sur ${codes.length} (${pct(named, codes.length)}) ; seuil de 80 % ${rate >= THRESHOLD ? 'atteint' : 'NON atteint'}`);
  lines.push(`${P} : A pas de voie piétonne à ${SNAP_UNDER_M} m ${count('A')} ; B quai seulement en surface ${count('B')} ; C couloirs sans sortie à ${MAX_UNDER_M} m ${count('C')} ; D sortie sans rue ni place ${count('D')} ; E sortie nommée ${named}`);
  const dists = codes.filter((c) => c.cls === 'E' && c.underM !== undefined).map((c) => c.underM as number);
  if (dists.length) lines.push(`${P} : marche sous terre jusqu'à la première sortie nommée : médiane ${Math.round(quantile(dists, 0.5))} m, 90e centile ${Math.round(quantile(dists, 0.9))} m, au plus ${Math.round(Math.max(...dists))} m`);
  // sorties retenues, une ligne par station (noms de station et de rue seulement) : ce que publie data/exits.json
  const byStation = new Map<string, FoundExit[]>();
  for (const c of codes) {
    if (c.cls !== 'E' || !c.name) continue;
    byStation.set(c.name, mergeExits(byStation.get(c.name) ?? [], c.exits.slice(0, MAX_EXITS)));
  }
  const ex = [...byStation.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  lines.push(`${P} : sorties retenues pour ${ex.length} stations (rue ou place, 3 au plus par arrêt, la plus proche du quai d'abord) :`);
  for (const [st, xs] of ex) lines.push(`${P} : ${st} → ${xs.map((x) => `${x.name} (${x.m} m)`).join(', ')}`);
  const fails = codes.filter((c) => c.cls !== 'E');
  const failLine = (cls: ExitClass[], label: string) => {
    const xs = fails.filter((c) => cls.includes(c.cls)).map((c) => `${c.name || '?'} (${c.code}, ${c.cls})`);
    for (let i = 0; i < xs.length; i += 12) lines.push(`${P} : ${label} : ${xs.slice(i, i + 12).join(', ')}`);
  };
  failLine(['A', 'B', 'C'], 'sans couloir jusqu’à la rue');
  failLine(['D'], 'sortie sans rue ni place');
  let official: ExitReport['official'];
  if (stations) {
    let covered = 0;
    let ok = 0;
    const missing: string[] = [];
    const notNamed: string[] = [];
    const resultOf = new Map(codes.map((c) => [c.code, c]));
    for (const st of stations) {
      const near = targets.filter((f) => groundM(f, st) <= OFFICIAL_M);
      if (!near.length) {
        missing.push(st.name);
        continue;
      }
      covered++;
      const best = near.flatMap((f) => f.codes).map((c) => resultOf.get(c)).filter((x): x is CodeResult => !!x).sort((a, b) => RANK[b.cls] - RANK[a.cls])[0];
      if (best?.cls === 'E') ok++;
      else notNamed.push(`${st.name} (${best?.cls ?? '?'})`);
    }
    official = { stations: stations.length, covered, named: ok };
    lines.push(`${P} : données officielles : ${stations.length} stations STIB de métro publiées ; avec un arrêt OSM sous terre à ${OFFICIAL_M} m ${covered} (${pct(covered, stations.length)}) ; avec une sortie nommée ${ok} (${pct(ok, stations.length)})`);
    for (let i = 0; i < missing.length; i += 12) lines.push(`${P} : stations de métro sans arrêt OSM sous terre : ${missing.slice(i, i + 12).join(', ')}`);
    for (let i = 0; i < notNamed.length; i += 12) lines.push(`${P} : stations de métro sans sortie nommée : ${notNamed.slice(i, i + 12).join(', ')}`);
  }
  return { lines, rate, codes, ...(official ? { official } : {}) };
}
