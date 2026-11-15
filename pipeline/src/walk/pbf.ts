/**
 * 1.2.10 : lecteur minimal du format OSM PBF (https://wiki.openstreetmap.org/wiki/PBF_Format), sans dépendance :
 * blocs lus un par un (lecture synchrone, zlib de Node), protobuf décodé à la main. Suffisant pour les extraits
 * Geofabrik : blocs bruts ou zlib, DenseNodes et Nodes, Ways (les relations sont ignorées).
 *
 * Deux lectures du fichier : les voies d'abord (pour savoir quels nœuds garder), puis les nœuds. Dans un fichier trié
 * (« Sort.Type_then_ID », cas des extraits Geofabrik), les blocs de nœuds précèdent ceux des voies : une recherche par
 * dichotomie trouve la frontière et chaque bloc n'est décompressé qu'une fois.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export class PbfError extends Error {}

/* ------------------------------ Protobuf ------------------------------ */

class Pb {
  buf: Uint8Array;
  pos: number;
  end: number;
  constructor(buf: Uint8Array, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }

  /** Varint non signé (jusqu'à 2^53 exactement, au-delà approché). */
  varint(): number {
    const b = this.buf;
    let p = this.pos;
    let c = b[p++];
    let v = c & 0x7f;
    if (c < 0x80) {
      this.pos = p;
      return v;
    }
    c = b[p++];
    v |= (c & 0x7f) << 7;
    if (c < 0x80) {
      this.pos = p;
      return v;
    }
    c = b[p++];
    v |= (c & 0x7f) << 14;
    if (c < 0x80) {
      this.pos = p;
      return v;
    }
    c = b[p++];
    v |= (c & 0x7f) << 21;
    if (c < 0x80) {
      this.pos = p;
      return v;
    }
    let mul = 268435456;
    for (let i = 0; i < 6; i++) {
      c = b[p++];
      if (c === undefined) throw new PbfError('varint tronqué');
      v += (c & 0x7f) * mul;
      if (c < 0x80) {
        this.pos = p;
        return v;
      }
      mul *= 128;
    }
    throw new PbfError('varint trop long');
  }

  /** int64 (complément à deux sur 10 octets pour un négatif), exact jusqu'à 2^53 en valeur absolue. */
  int64(): number {
    const b = this.buf;
    let lo = 0;
    let hi = 0;
    let c = 0;
    for (let shift = 0; shift < 28; shift += 7) {
      c = b[this.pos++];
      lo |= (c & 0x7f) << shift;
      if (c < 0x80) return lo >>> 0;
    }
    c = b[this.pos++];
    lo |= (c & 0x0f) << 28;
    hi = (c & 0x7f) >> 4;
    if (c >= 0x80) {
      for (let shift = 3; shift < 32; shift += 7) {
        c = b[this.pos++];
        if (c === undefined) throw new PbfError('varint tronqué');
        hi |= (c & 0x7f) << shift;
        if (c < 0x80) break;
      }
      if (c >= 0x80) throw new PbfError('varint trop long');
    }
    return (hi | 0) * 4294967296 + (lo >>> 0);
  }

  /** sint64 (zigzag). */
  sint(): number {
    const v = this.varint();
    if (v < 2147483648) return (v >>> 1) ^ -(v & 1);
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  bytes(): [number, number] {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new PbfError('message tronqué');
    return [start, this.pos];
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.pos += 4;
    else throw new PbfError(`type protobuf inconnu (${wire})`);
    if (this.pos > this.end) throw new PbfError('message tronqué');
  }
}

const utf8 = new TextDecoder('utf-8');

/* ------------------------------ Fichier ------------------------------ */

export interface PbfHeader {
  required: string[];
  optional: string[];
  writingProgram?: string;
  /** osmosis_replication_timestamp, en secondes */
  timestamp?: number;
  sorted: boolean;
}

export interface BlobRef {
  type: string;
  /** position et taille du message Blob */
  offset: number;
  size: number;
}

const SUPPORTED = new Set(['OsmSchema-V0.6', 'DenseNodes']);

function readExact(fd: number, len: number, pos: number): Buffer {
  const buf = Buffer.allocUnsafe(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, buf, got, len - got, pos + got);
    if (n === 0) throw new PbfError('fichier tronqué');
    got += n;
  }
  return buf;
}

/** Contenu décompressé d'un message Blob. */
function inflateBlob(raw: Uint8Array): Uint8Array {
  const pb = new Pb(raw);
  let rawData: [number, number] | null = null;
  let zlib: [number, number] | null = null;
  let rawSize = -1;
  let other = 0;
  while (pb.pos < pb.end) {
    const tag = pb.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) rawData = pb.bytes();
    else if (field === 2 && wire === 0) rawSize = pb.varint();
    else if (field === 3 && wire === 2) zlib = pb.bytes();
    else if (field >= 4 && field <= 7 && wire === 2) {
      pb.bytes();
      other = field;
    } else pb.skip(wire);
  }
  if (rawData) return raw.subarray(rawData[0], rawData[1]);
  if (zlib) {
    const out = inflateSync(raw.subarray(zlib[0], zlib[1]));
    if (rawSize >= 0 && out.length !== rawSize) throw new PbfError('bloc décompressé de taille inattendue');
    return out;
  }
  throw new PbfError(other ? `compression non prise en charge (champ ${other})` : 'bloc vide');
}

export class PbfFile {
  readonly path: string;
  readonly header: PbfHeader;
  readonly blobs: BlobRef[];
  readonly bytes: number;
  private fd: number;

  constructor(path: string) {
    this.path = path;
    this.fd = openSync(path, 'r');
    try {
      this.bytes = fstatSync(this.fd).size;
      this.blobs = [];
      let pos = 0;
      let header: PbfHeader | null = null;
      while (pos < this.bytes) {
        const len = readExact(this.fd, 4, pos).readUInt32BE(0);
        if (len <= 0 || len > 65536) throw new PbfError('en-tête de bloc invalide (fichier PBF ?)');
        const hb = new Pb(readExact(this.fd, len, pos + 4));
        let type = '';
        let size = -1;
        while (hb.pos < hb.end) {
          const tag = hb.varint();
          const field = tag >>> 3;
          if (field === 1 && (tag & 7) === 2) {
            const [s, e] = hb.bytes();
            type = utf8.decode(hb.buf.subarray(s, e));
          } else if (field === 3 && (tag & 7) === 0) size = hb.varint();
          else hb.skip(tag & 7);
        }
        if (size < 0 || size > 64 * 1048576) throw new PbfError('taille de bloc invalide');
        const offset = pos + 4 + len;
        if (offset + size > this.bytes) throw new PbfError('fichier tronqué');
        if (type === 'OSMHeader') {
          if (header) throw new PbfError('deux en-têtes OSM');
          header = decodeHeader(inflateBlob(readExact(this.fd, size, offset)));
        } else if (type === 'OSMData') {
          if (!header) throw new PbfError('données avant l’en-tête OSM');
          this.blobs.push({ type, offset, size });
        }
        pos = offset + size;
      }
      if (!header) throw new PbfError('en-tête OSM absent');
      this.header = header;
    } catch (e) {
      closeSync(this.fd);
      throw e;
    }
  }

  /** Bloc de données décompressé. */
  block(i: number): Uint8Array {
    const b = this.blobs[i];
    return inflateBlob(readExact(this.fd, b.size, b.offset));
  }

  close(): void {
    closeSync(this.fd);
  }
}

function decodeHeader(buf: Uint8Array): PbfHeader {
  const pb = new Pb(buf);
  const h: PbfHeader = { required: [], optional: [], sorted: false };
  while (pb.pos < pb.end) {
    const tag = pb.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if ((field === 4 || field === 5 || field === 16) && wire === 2) {
      const [s, e] = pb.bytes();
      const text = utf8.decode(buf.subarray(s, e));
      if (field === 4) h.required.push(text);
      else if (field === 5) h.optional.push(text);
      else h.writingProgram = text;
    } else if (field === 32 && wire === 0) h.timestamp = pb.int64();
    else pb.skip(wire);
  }
  for (const f of h.required) if (!SUPPORTED.has(f)) throw new PbfError(`fonction PBF non prise en charge : ${f}`);
  h.sorted = h.optional.includes('Sort.Type_then_ID');
  return h;
}

/* ------------------------------ Blocs ------------------------------ */

export const HAS_NODES = 1;
export const HAS_WAYS = 2;
export const HAS_RELATIONS = 4;

interface BlockInfo {
  strings: string[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
  groups: [number, number][];
}

function blockInfo(buf: Uint8Array, withStrings = true): BlockInfo {
  const pb = new Pb(buf);
  const info: BlockInfo = { strings: [], granularity: 100, latOffset: 0, lonOffset: 0, groups: [] };
  while (pb.pos < pb.end) {
    const tag = pb.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const [s, e] = pb.bytes();
      if (!withStrings) continue;
      const st = new Pb(buf, s, e);
      while (st.pos < st.end) {
        const t = st.varint();
        if (t >>> 3 === 1 && (t & 7) === 2) {
          const [a, b] = st.bytes();
          info.strings.push(utf8.decode(buf.subarray(a, b)));
        } else st.skip(t & 7);
      }
    } else if (field === 2 && wire === 2) info.groups.push(pb.bytes());
    else if (field === 17 && wire === 0) info.granularity = pb.varint();
    else if (field === 19 && wire === 0) info.latOffset = pb.int64();
    else if (field === 20 && wire === 0) info.lonOffset = pb.int64();
    else pb.skip(wire);
  }
  return info;
}

/** Ce que contient un bloc (HAS_NODES, HAS_WAYS, HAS_RELATIONS), sans le décoder. */
export function classifyBlock(buf: Uint8Array): number {
  const info = blockInfo(buf, false);
  let out = 0;
  for (const [s, e] of info.groups) {
    const pb = new Pb(buf, s, e);
    while (pb.pos < pb.end) {
      const tag = pb.varint();
      const field = tag >>> 3;
      if (field === 1 || field === 2) out |= HAS_NODES;
      else if (field === 3) out |= HAS_WAYS;
      else if (field === 4) out |= HAS_RELATIONS;
      pb.skip(tag & 7);
    }
  }
  return out;
}

/** Étiquettes d'une voie ou d'un nœud, lues sans copie. */
export interface Tags {
  get(key: string): string | undefined;
  has(key: string): boolean;
}

class TagView implements Tags {
  strings: string[] = [];
  keys: number[] = [];
  vals: number[] = [];
  get(key: string): string | undefined {
    const s = this.strings;
    for (let i = 0; i < this.keys.length; i++) if (s[this.keys[i]] === key) return s[this.vals[i]];
    return undefined;
  }
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

/**
 * Voies d'un bloc : `onWay(id, tags, refs, n)` ; `refs` (identifiants des nœuds, n premiers) est réutilisé d'une voie
 * à l'autre. `wanted(tags)` : filtre rapide avant le décodage des nœuds de la voie.
 */
export function readWays(buf: Uint8Array, wanted: (t: Tags) => boolean, onWay: (id: number, tags: Tags, refs: Float64Array, n: number) => void): void {
  const info = blockInfo(buf);
  const tags = new TagView();
  tags.strings = info.strings;
  let refs = new Float64Array(2048);
  for (const [gs, ge] of info.groups) {
    const g = new Pb(buf, gs, ge);
    while (g.pos < g.end) {
      const tag = g.varint();
      if (tag >>> 3 !== 3 || (tag & 7) !== 2) {
        g.skip(tag & 7);
        continue;
      }
      const [ws, we] = g.bytes();
      const w = new Pb(buf, ws, we);
      let id = 0;
      let refsAt: [number, number] | null = null;
      tags.keys.length = 0;
      tags.vals.length = 0;
      while (w.pos < w.end) {
        const t = w.varint();
        const field = t >>> 3;
        const wire = t & 7;
        if (field === 1 && wire === 0) id = w.varint();
        else if ((field === 2 || field === 3) && wire === 2) {
          const [s, e] = w.bytes();
          const p = new Pb(buf, s, e);
          const into = field === 2 ? tags.keys : tags.vals;
          while (p.pos < p.end) into.push(p.varint());
        } else if (field === 8 && wire === 2) refsAt = w.bytes();
        else w.skip(wire);
      }
      if (tags.keys.length !== tags.vals.length) throw new PbfError('étiquettes de voie incohérentes');
      for (let i = 0; i < tags.keys.length; i++) {
        if (tags.keys[i] >= info.strings.length || tags.vals[i] >= info.strings.length) throw new PbfError('étiquette hors de la table');
      }
      if (!refsAt || !wanted(tags)) continue;
      const p = new Pb(buf, refsAt[0], refsAt[1]);
      let n = 0;
      let ref = 0;
      while (p.pos < p.end) {
        if (n >= refs.length) {
          const bigger = new Float64Array(refs.length * 2);
          bigger.set(refs);
          refs = bigger;
        }
        ref += p.sint();
        refs[n++] = ref;
      }
      onWay(id, tags, refs, n);
    }
  }
}

/**
 * Nœuds d'un bloc, par lots : `onNodes(ids, lat, lon, n)` (degrés). Les tableaux sont réutilisés d'un lot à l'autre.
 */
export function readNodes(buf: Uint8Array, onNodes: (ids: Float64Array, lat: Float64Array, lon: Float64Array, n: number) => void): void {
  const info = blockInfo(buf, false);
  const scale = info.granularity * 1e-9;
  const latOff = info.latOffset * 1e-9;
  const lonOff = info.lonOffset * 1e-9;
  let ids = new Float64Array(8000);
  let lat = new Float64Array(8000);
  let lon = new Float64Array(8000);
  const grow = (n: number) => {
    if (n <= ids.length) return;
    const size = Math.max(n, ids.length * 2);
    const a = new Float64Array(size);
    a.set(ids);
    ids = a;
    const b = new Float64Array(size);
    b.set(lat);
    lat = b;
    const c = new Float64Array(size);
    c.set(lon);
    lon = c;
  };
  for (const [gs, ge] of info.groups) {
    const g = new Pb(buf, gs, ge);
    while (g.pos < g.end) {
      const tag = g.varint();
      const field = tag >>> 3;
      const wire = tag & 7;
      if (field === 2 && wire === 2) {
        const [ds, de] = g.bytes();
        const d = new Pb(buf, ds, de);
        let idAt: [number, number] | null = null;
        let latAt: [number, number] | null = null;
        let lonAt: [number, number] | null = null;
        while (d.pos < d.end) {
          const t = d.varint();
          const f = t >>> 3;
          if (f === 1 && (t & 7) === 2) idAt = d.bytes();
          else if (f === 8 && (t & 7) === 2) latAt = d.bytes();
          else if (f === 9 && (t & 7) === 2) lonAt = d.bytes();
          else d.skip(t & 7);
        }
        if (!idAt) continue;
        if (!latAt || !lonAt) throw new PbfError('nœuds sans coordonnées');
        const pi = new Pb(buf, idAt[0], idAt[1]);
        const pa = new Pb(buf, latAt[0], latAt[1]);
        const po = new Pb(buf, lonAt[0], lonAt[1]);
        let n = 0;
        let id = 0;
        let la = 0;
        let lo = 0;
        while (pi.pos < pi.end) {
          if (pa.pos >= pa.end || po.pos >= po.end) throw new PbfError('nœuds incohérents');
          if (n >= ids.length) grow(n + 1);
          id += pi.sint();
          la += pa.sint();
          lo += po.sint();
          ids[n] = id;
          lat[n] = latOff + scale * la;
          lon[n] = lonOff + scale * lo;
          n++;
        }
        onNodes(ids, lat, lon, n);
      } else if (field === 1 && wire === 2) {
        const [ns, ne] = g.bytes();
        const p = new Pb(buf, ns, ne);
        let id = 0;
        let la = 0;
        let lo = 0;
        while (p.pos < p.end) {
          const t = p.varint();
          const f = t >>> 3;
          if (f === 1 && (t & 7) === 0) id = p.sint();
          else if (f === 8 && (t & 7) === 0) la = p.sint();
          else if (f === 9 && (t & 7) === 0) lo = p.sint();
          else p.skip(t & 7);
        }
        ids[0] = id;
        lat[0] = latOff + scale * la;
        lon[0] = lonOff + scale * lo;
        onNodes(ids, lat, lon, 1);
      } else g.skip(wire);
    }
  }
}

/** Dans un fichier trié, rang du premier bloc sans nœuds (dichotomie) ; sans tri : null. */
export function firstBlockWithoutNodes(f: PbfFile): number | null {
  if (!f.header.sorted) return null;
  let lo = 0;
  let hi = f.blobs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (classifyBlock(f.block(mid)) & HAS_NODES) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
