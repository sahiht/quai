/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : format des tuiles piétonnes publiées sous data/walk/, commun au pipeline (écriture,
 * pipeline/src/walk/) et au téléphone (lecture, core/walk/). Fichier autonome, sans aucun import : le pipeline le lit
 * tel quel avec Node (--experimental-strip-types).
 *
 * Grille : tuiles de base de 0,02° × 0,03° (environ 2,2 km × 2,1 km en Belgique), clé « {ty}_{tx} » calculée en
 * entiers (unité 1e-5 degré, jamais de division flottante en bordure). Une tuile trop lourde (plus de 300 ko) est
 * coupée en 4 (quart sud-ouest 0, sud-est 1, nord-ouest 2, nord-est 3), récursivement : « {ty}_{tx}_{q…} » ; l'index
 * liste les tuiles coupées (`split`).
 *
 * Contenu d'une tuile : des chaînes (morceaux de voies OSM entre carrefours, même nom et mêmes attributs), chacune une
 * suite de nœuds (carrefours, bouts de voie, points de coupe au bord des tuiles) reliés par des tronçons dont la
 * géométrie est simplifiée (environ 2 m). Un nœud est écrit une fois (coordonnées à sa première apparition), puis
 * repris par un renvoi. Les nœuds partagés avec une autre tuile portent un identifiant global (`s`) : 2 × id OSM pour
 * un vrai nœud, 2 × n + 1 pour un point de coupe ; deux tuiles se raccordent par ces identifiants.
 *
 * Codage des nombres : entiers en base mixte sur 91 caractères ASCII sûrs en JSON (ni « " » ni « \ ») : chiffres
 * « non terminaux » en base 46 ('#'..'P'), dernier chiffre en base 45 ('Q'..'~' sans '\'). Signés : zigzag.
 */

export const WALK_FORMAT = 1;
/** Taille d'une tuile de base, en degrés. */
export const WALK_TILE = { lat: 0.02, lon: 0.03 } as const;
/** Unité des coordonnées entières : 1e-5 degré (1,1 m en latitude, 0,7 m en longitude à Bruxelles). */
export const WALK_UNIT = 1e-5;
/** Taille d'une tuile de base, en unités. */
export const TILE_LAT_U = 2000;
export const TILE_LON_U = 3000;
/** Profondeur maximale de coupe d'une tuile (2000 et 3000 restent entiers jusqu'à 1/8). */
export const MAX_SPLIT_DEPTH = 3;

/** Attributs d'une chaîne. */
export const F_STEPS = 1;
/** Sens unique à pied, dans le sens de la chaîne (oneway:foot, escalier mécanique…). */
export const F_FWD = 2;
/** Sens unique à pied, à rebours de la chaîne. */
export const F_BWD = 4;
/** Anneau d'un rond-point (junction=roundabout) : continuer sur l'anneau n'est pas un virage. */
export const F_RING = 8;
/** La chaîne n'appartient pas au grand réseau connexe : son numéro de composante suit. */
export const F_COMP = 16;

/** data/walk/index.json */
export interface WalkIndex {
  v: 1;
  /** Date des données OpenStreetMap (AAAA-MM-JJ) : aussi la version des tuiles. */
  version: string;
  /** Instant de la construction (ISO 8601). */
  builtAt: string;
  source: string;
  licence: string;
  attribution: string;
  tile: { lat: number; lon: number };
  unit: number;
  /** Tuiles coupées en 4 (clés de base ou de quart). */
  split: string[];
  tiles: number;
  bytes: number;
  maxTileBytes: number;
  /** Voies gardées seulement à cette distance (m) des arrêts publiés, si le budget l'a demandé. */
  nearStopsM?: number;
}

/** data/walk/{clé}.json */
export interface WalkTileFile {
  v: 1;
  /** clé de la tuile */
  k: string;
  /** version des données (WalkIndex.version) */
  ver: string;
  /** noms de rue de la tuile */
  names: string[];
  /** chaînes codées */
  w: string;
  /** nœuds partagés codés */
  s: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function isWalkIndex(x: unknown): x is WalkIndex {
  return (
    isObj(x) &&
    x.v === 1 &&
    typeof x.version === 'string' &&
    x.version.length > 0 &&
    isObj(x.tile) &&
    x.tile.lat === WALK_TILE.lat &&
    x.tile.lon === WALK_TILE.lon &&
    x.unit === WALK_UNIT &&
    Array.isArray(x.split) &&
    x.split.every((k) => typeof k === 'string')
  );
}

export function isWalkTile(x: unknown): x is WalkTileFile {
  return (
    isObj(x) &&
    x.v === 1 &&
    typeof x.k === 'string' &&
    typeof x.ver === 'string' &&
    Array.isArray(x.names) &&
    x.names.every((n) => typeof n === 'string') &&
    typeof x.w === 'string' &&
    typeof x.s === 'string'
  );
}

/* ------------------------------ Nombres ------------------------------ */

const NT = 46;
const TB = 45;
const NT0 = 0x23;
const TB0 = 0x51;
/** Caractère → chiffre non terminal (0..45), 100 + chiffre terminal (100..144), -1 invalide. */
const DEC = new Int16Array(128).fill(-1);
const ENC_NT: number[] = [];
const ENC_TB: number[] = [];
for (let i = 0; i < NT; i++) {
  ENC_NT.push(NT0 + i);
  DEC[NT0 + i] = i;
}
for (let c = TB0, i = 0; c <= 0x7e; c++) {
  if (c === 0x5c) continue;
  ENC_TB.push(c);
  DEC[c] = 100 + i++;
}

export class TileFormatError extends Error {
  constructor(msg: string) {
    super(`tuile piétonne illisible : ${msg}`);
    this.name = 'TileFormatError';
  }
}

/** Écrit des entiers dans une chaîne (pipeline, tests). */
export class VarWriter {
  private buf: number[] = [];
  private readonly parts: string[] = [];

  /** Entier positif ou nul (jusqu'à 2^53). */
  uint(v: number): void {
    if (!(v >= 0) || !Number.isInteger(v) || v > Number.MAX_SAFE_INTEGER) throw new RangeError(`entier invalide : ${v}`);
    while (v >= TB) {
      this.buf.push(ENC_NT[v % NT]);
      v = Math.floor(v / NT);
    }
    this.buf.push(ENC_TB[v]);
    if (this.buf.length >= 8192) this.spill();
  }

  /** Entier signé (zigzag). */
  sint(v: number): void {
    this.uint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  private spill(): void {
    this.parts.push(String.fromCharCode(...this.buf));
    this.buf = [];
  }

  toString(): string {
    if (this.buf.length) this.spill();
    return this.parts.join('');
  }
}

/** Lit les entiers d'une chaîne codée. */
export class VarReader {
  private i = 0;
  private readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  get done(): boolean {
    return this.i >= this.s.length;
  }

  uint(): number {
    const s = this.s;
    let v = 0;
    let m = 1;
    for (;;) {
      if (this.i >= s.length) throw new TileFormatError('fin inattendue');
      const c = s.charCodeAt(this.i++);
      const d = c < 128 ? DEC[c] : -1;
      if (d < 0) throw new TileFormatError('caractère inattendu');
      if (d >= 100) return v + (d - 100) * m;
      v += d * m;
      m *= NT;
      if (m > 1e16) throw new TileFormatError('nombre trop long');
    }
  }

  sint(): number {
    const u = this.uint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
}

/* ------------------------------ Tuiles ------------------------------ */

/** Cadre d'une tuile, en unités entières : [lat0, lat1) × [lon0, lon1). */
export interface UnitBox {
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
}

const KEY_RE = /^(-?\d{1,5})_(-?\d{1,5})(?:_([0-3]{1,3}))?$/;

/** Vrai si `key` est une clé de tuile bien formée (base ou quart). */
export function isTileKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** Clé de la tuile de base qui contient le point (unités entières). */
export function baseKeyOf(latU: number, lonU: number): string {
  return `${Math.floor(latU / TILE_LAT_U)}_${Math.floor(lonU / TILE_LON_U)}`;
}

/** Cadre d'une tuile (base ou quart) en unités ; null si la clé est invalide. */
export function boxOf(key: string): UnitBox | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const ty = Number(m[1]);
  const tx = Number(m[2]);
  let b: UnitBox = { lat0: ty * TILE_LAT_U, lat1: (ty + 1) * TILE_LAT_U, lon0: tx * TILE_LON_U, lon1: (tx + 1) * TILE_LON_U };
  for (const q of m[3] ?? '') b = quarter(b, Number(q));
  return b;
}

/** Quart d'un cadre : 0 sud-ouest, 1 sud-est, 2 nord-ouest, 3 nord-est. */
export function quarter(b: UnitBox, q: number): UnitBox {
  const midLat = (b.lat0 + b.lat1) / 2;
  const midLon = (b.lon0 + b.lon1) / 2;
  return {
    lat0: q & 2 ? midLat : b.lat0,
    lat1: q & 2 ? b.lat1 : midLat,
    lon0: q & 1 ? midLon : b.lon0,
    lon1: q & 1 ? b.lon1 : midLon,
  };
}

/** Clé de la tuile publiée (feuille) qui contient le point, compte tenu des tuiles coupées. */
export function leafKeyOf(latU: number, lonU: number, split: ReadonlySet<string>): string {
  let key = baseKeyOf(latU, lonU);
  let b = boxOf(key) as UnitBox;
  for (let d = 0; d < MAX_SPLIT_DEPTH && split.has(key); d++) {
    const q = (latU >= (b.lat0 + b.lat1) / 2 ? 2 : 0) + (lonU >= (b.lon0 + b.lon1) / 2 ? 1 : 0);
    key = `${key}${key.split('_').length === 2 ? '_' : ''}${q}`;
    b = quarter(b, q);
  }
  return key;
}

/** Tuiles publiées (feuilles) qui touchent un cadre en unités (bornes comprises), triées. */
export function leafKeysForBox(box: UnitBox, split: ReadonlySet<string>, maxTiles = 64): string[] {
  const out: string[] = [];
  const y0 = Math.floor(box.lat0 / TILE_LAT_U);
  const y1 = Math.floor(box.lat1 / TILE_LAT_U);
  const x0 = Math.floor(box.lon0 / TILE_LON_U);
  const x1 = Math.floor(box.lon1 / TILE_LON_U);
  if ((y1 - y0 + 1) * (x1 - x0 + 1) > maxTiles) return out;
  const visit = (key: string, b: UnitBox, depth: number) => {
    if (b.lat0 > box.lat1 || b.lat1 < box.lat0 || b.lon0 > box.lon1 || b.lon1 < box.lon0) return;
    if (depth < MAX_SPLIT_DEPTH && split.has(key)) {
      const sep = depth === 0 ? '_' : '';
      for (let q = 0; q < 4; q++) visit(`${key}${sep}${q}`, quarter(b, q), depth + 1);
      return;
    }
    out.push(key);
  };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visit(`${y}_${x}`, boxOf(`${y}_${x}`) as UnitBox, 0);
  return out.sort();
}

/* ------------------------------ Écriture ------------------------------ */

/** Une chaîne à écrire : `nodes` (identifiants de l'appelant) et, pour chaque tronçon, ses points intermédiaires. */
export interface ChainIn {
  /** rang dans `names`, -1 sans nom */
  name: number;
  flags: number;
  /** 0 : grand réseau ; sinon numéro de composante (F_COMP ajouté à l'écriture) */
  comp: number;
  nodes: number[];
  /** par tronçon : [lat, lon, lat, lon, …] en unités entières, sans les nœuds des bouts */
  pts: number[][];
}

/**
 * Code une tuile. `coord(id)` : [lat, lon] entiers d'un nœud ; `global(id)` : identifiant global d'un nœud partagé
 * avec une autre tuile (undefined sinon). Les nœuds sont numérotés dans l'ordre de leur première apparition.
 */
export function encodeTile(
  key: string,
  ver: string,
  names: string[],
  chains: readonly ChainIn[],
  coord: (id: number) => readonly [number, number],
  global: (id: number) => number | undefined,
): WalkTileFile {
  const box = boxOf(key);
  if (!box) throw new RangeError(`clé de tuile invalide : ${key}`);
  const w = new VarWriter();
  const local = new Map<number, number>();
  let prevLat = box.lat0;
  let prevLon = box.lon0;
  const ref = (id: number) => {
    const known = local.get(id);
    const [lat, lon] = coord(id);
    if (known === undefined) {
      local.set(id, local.size);
      w.uint(0);
      w.sint(lat - prevLat);
      w.sint(lon - prevLon);
    } else {
      w.uint(local.size - known);
    }
    prevLat = lat;
    prevLon = lon;
  };
  w.uint(chains.length);
  for (const c of chains) {
    const edges = c.nodes.length - 1;
    if (edges < 1 || c.pts.length !== edges) throw new RangeError('chaîne invalide');
    w.uint(c.name + 1);
    const flags = (c.flags & ~F_COMP) | (c.comp ? F_COMP : 0);
    w.uint(flags);
    if (c.comp) w.uint(c.comp);
    w.uint(edges);
    ref(c.nodes[0]);
    for (let e = 0; e < edges; e++) {
      const p = c.pts[e];
      if (p.length % 2) throw new RangeError('points invalides');
      w.uint(p.length / 2);
      for (let i = 0; i < p.length; i += 2) {
        w.sint(p[i] - prevLat);
        w.sint(p[i + 1] - prevLon);
        prevLat = p[i];
        prevLon = p[i + 1];
      }
      ref(c.nodes[e + 1]);
    }
  }
  const shared: [number, number][] = [];
  for (const [id, li] of local) {
    const g = global(id);
    if (g !== undefined) shared.push([li, g]);
  }
  shared.sort((a, b) => a[0] - b[0]);
  const s = new VarWriter();
  s.uint(shared.length);
  let prev = 0;
  for (const [li, g] of shared) {
    s.uint(li - prev);
    s.uint(g);
    prev = li;
  }
  return { v: 1, k: key, ver, names, w: w.toString(), s: s.toString() };
}

/* ------------------------------ Lecture ------------------------------ */

/** Tuile décodée : nœuds et tronçons en tableaux typés (unités entières). */
export interface DecodedTile {
  key: string;
  ver: string;
  names: string[];
  nodeLat: Int32Array;
  nodeLon: Int32Array;
  /** nœuds partagés : rang local (croissant) et identifiant global */
  sharedLocal: Int32Array;
  sharedGlobal: Float64Array;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeFlags: Uint8Array;
  /** rang dans `names`, -1 sans nom */
  edgeName: Int32Array;
  /** 0 : grand réseau */
  edgeComp: Int32Array;
  /** points intermédiaires du tronçon e : ptLat/ptLon[geoStart[e] .. geoStart[e + 1]) */
  geoStart: Int32Array;
  ptLat: Int32Array;
  ptLon: Int32Array;
}

/** Décode une tuile (exception TileFormatError si elle est illisible ou incohérente). */
export function decodeTile(f: WalkTileFile): DecodedTile {
  const box = boxOf(f.k);
  if (!box) throw new TileFormatError('clé invalide');
  const r = new VarReader(f.w);
  // bornes : un nœud nouveau coûte au moins 3 caractères, un renvoi ou un tronçon au moins 1
  const cap = f.w.length + 1;
  const nodeLat = new Int32Array(Math.ceil(cap / 3) + 1);
  const nodeLon = new Int32Array(nodeLat.length);
  const edgeFrom = new Int32Array(Math.ceil(cap / 2) + 1);
  const edgeTo = new Int32Array(edgeFrom.length);
  const edgeFlags = new Uint8Array(edgeFrom.length);
  const edgeName = new Int32Array(edgeFrom.length);
  const edgeComp = new Int32Array(edgeFrom.length);
  const geoStart = new Int32Array(edgeFrom.length + 1);
  const ptLat = new Int32Array(Math.ceil(cap / 2) + 1);
  const ptLon = new Int32Array(ptLat.length);
  let nodes = 0;
  let edges = 0;
  let pts = 0;
  let prevLat = box.lat0;
  let prevLon = box.lon0;
  const ref = (): number => {
    const back = r.uint();
    if (back === 0) {
      prevLat += r.sint();
      prevLon += r.sint();
      if (nodes >= nodeLat.length) throw new TileFormatError('trop de nœuds');
      nodeLat[nodes] = prevLat;
      nodeLon[nodes] = prevLon;
      return nodes++;
    }
    if (back > nodes) throw new TileFormatError('renvoi hors de la tuile');
    const id = nodes - back;
    prevLat = nodeLat[id];
    prevLon = nodeLon[id];
    return id;
  };
  const chains = r.uint();
  for (let c = 0; c < chains; c++) {
    const name = r.uint() - 1;
    if (name >= f.names.length) throw new TileFormatError('nom inconnu');
    const flags = r.uint();
    if (flags > 31) throw new TileFormatError('attributs inconnus');
    const comp = flags & F_COMP ? r.uint() : 0;
    const n = r.uint();
    if (n < 1) throw new TileFormatError('chaîne vide');
    let from = ref();
    for (let e = 0; e < n; e++) {
      if (edges >= edgeFrom.length) throw new TileFormatError('trop de tronçons');
      geoStart[edges] = pts;
      const k = r.uint();
      if (pts + k > ptLat.length) throw new TileFormatError('trop de points');
      for (let i = 0; i < k; i++) {
        prevLat += r.sint();
        prevLon += r.sint();
        ptLat[pts] = prevLat;
        ptLon[pts] = prevLon;
        pts++;
      }
      const to = ref();
      edgeFrom[edges] = from;
      edgeTo[edges] = to;
      edgeFlags[edges] = flags & ~F_COMP;
      edgeName[edges] = name;
      edgeComp[edges] = comp;
      edges++;
      from = to;
    }
  }
  if (!r.done) throw new TileFormatError('données en trop');
  geoStart[edges] = pts;
  const s = new VarReader(f.s);
  const ns = s.uint();
  if (ns > nodes) throw new TileFormatError('trop de nœuds partagés');
  const sharedLocal = new Int32Array(ns);
  const sharedGlobal = new Float64Array(ns);
  let li = 0;
  for (let i = 0; i < ns; i++) {
    li += s.uint();
    if (li >= nodes || (i > 0 && li <= sharedLocal[i - 1])) throw new TileFormatError('nœud partagé invalide');
    sharedLocal[i] = li;
    sharedGlobal[i] = s.uint();
  }
  if (!s.done) throw new TileFormatError('données en trop');
  return {
    key: f.k,
    ver: f.ver,
    names: f.names,
    nodeLat: nodeLat.slice(0, nodes),
    nodeLon: nodeLon.slice(0, nodes),
    sharedLocal,
    sharedGlobal,
    edgeFrom: edgeFrom.slice(0, edges),
    edgeTo: edgeTo.slice(0, edges),
    edgeFlags: edgeFlags.slice(0, edges),
    edgeName: edgeName.slice(0, edges),
    edgeComp: edgeComp.slice(0, edges),
    geoStart: geoStart.slice(0, edges + 1),
    ptLat: ptLat.slice(0, pts),
    ptLon: ptLon.slice(0, pts),
  };
}
