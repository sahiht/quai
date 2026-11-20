/**
 * 1.2.10 : aides des tests du graphe piéton : extraits OSM XML écrits à la main (positions en mètres autour d'un
 * point public), petit écrivain PBF (pour éprouver le lecteur sur des cas choisis), lecture des tuiles produites.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { decodeTile, type DecodedTile, type WalkIndex, type WalkTileFile } from '../../app/src/core/walk/format.ts';
import { ROOT_DIR } from './helpers.ts';

export const WALK_DATA = join(ROOT_DIR, 'pipeline', 'test', 'walk-data');
export const APP_WALK_DATA = join(ROOT_DIR, 'app', 'test', 'core', 'walk-data');

/** Bruxelles-Central (lieu public), et le bord entre les tuiles 2541 et 2542 (latitude 50,84). */
export const CENTRAL = { lat: 50.8454, lon: 4.3571 };
export const EDGE_LAT = 50.84;
const M_LAT = 6371000 * (Math.PI / 180);

export function ll(dx: number, dy: number, anchor = CENTRAL): [number, number] {
  return [anchor.lat + dy / M_LAT, anchor.lon + dx / (M_LAT * Math.cos((anchor.lat * Math.PI) / 180))];
}

export interface XmlWay {
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Extrait OSM XML : nœuds (id → [lat, lon]) et voies. */
export function osmXml(nodes: Record<number, [number, number]>, ways: XmlWay[], timestamp?: string): string {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<osm version="0.6" generator="tests"${timestamp ? ` timestamp="${timestamp}"` : ''}>`];
  for (const [id, [lat, lon]] of Object.entries(nodes)) out.push(`  <node id="${id}" lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>`);
  for (const w of ways) {
    out.push(`  <way id="${w.id}">`);
    for (const n of w.nodes) out.push(`    <nd ref="${n}"/>`);
    for (const [k, v] of Object.entries(w.tags ?? {})) out.push(`    <tag k="${esc(k)}" v="${esc(v)}"/>`);
    out.push('  </way>');
  }
  out.push('</osm>');
  return out.join('\n');
}

export function writeXml(dir: string, name: string, xml: string): string {
  const p = join(dir, name);
  writeFileSync(p, xml);
  return p;
}

/** Tuiles produites dans un dossier : index et tuiles décodées par clé. */
export function readBuilt(dir: string): { index: WalkIndex; files: Map<string, WalkTileFile>; tiles: Map<string, DecodedTile> } {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as WalkIndex;
  const files = new Map<string, WalkTileFile>();
  const tiles = new Map<string, DecodedTile>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json').sort()) {
    const t = JSON.parse(readFileSync(join(dir, f), 'utf8')) as WalkTileFile;
    files.set(t.k, t);
    tiles.set(t.k, decodeTile(t));
  }
  return { index, files, tiles };
}

/** Longueur totale (m) des tronçons d'une tuile décodée. */
export function tileLength(t: DecodedTile): number {
  let total = 0;
  for (let e = 0; e < t.edgeFrom.length; e++) {
    const pts: [number, number][] = [[t.nodeLat[t.edgeFrom[e]], t.nodeLon[t.edgeFrom[e]]]];
    for (let i = t.geoStart[e]; i < t.geoStart[e + 1]; i++) pts.push([t.ptLat[i], t.ptLon[i]]);
    pts.push([t.nodeLat[t.edgeTo[e]], t.nodeLon[t.edgeTo[e]]]);
    for (let i = 1; i < pts.length; i++) {
      const dy = (pts[i][0] - pts[i - 1][0]) * 1e-5 * M_LAT;
      const dx = (pts[i][1] - pts[i - 1][1]) * 1e-5 * M_LAT * Math.cos(((pts[i][0] * 1e-5) * Math.PI) / 180);
      total += Math.hypot(dx, dy);
    }
  }
  return total;
}

/* ------------------------------ Écrivain PBF (tests) ------------------------------ */

class PbWriter {
  bytes: number[] = [];
  varint(v: number): this {
    if (v < 0) throw new RangeError('varint négatif');
    while (v >= 128) {
      this.bytes.push((v % 128) | 128);
      v = Math.floor(v / 128);
    }
    this.bytes.push(v);
    return this;
  }
  sint(v: number): this {
    return this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  tag(field: number, wire: number): this {
    return this.varint(field * 8 + wire);
  }
  field(field: number, v: number): this {
    return this.tag(field, 0).varint(v);
  }
  /** int64, négatif en complément à deux sur 10 octets */
  int64(field: number, v: number): this {
    this.tag(field, 0);
    let x = BigInt.asUintN(64, BigInt(v));
    while (x >= 128n) {
      this.bytes.push(Number(x & 127n) | 128);
      x >>= 7n;
    }
    this.bytes.push(Number(x));
    return this;
  }
  bytesField(field: number, b: Uint8Array | number[]): this {
    this.tag(field, 2).varint(b.length);
    for (const x of b) this.bytes.push(x);
    return this;
  }
  str(field: number, s: string): this {
    return this.bytesField(field, Buffer.from(s, 'utf8'));
  }
  packed(field: number, values: number[], signed = false): this {
    const w = new PbWriter();
    for (const v of values) (signed ? w.sint(v) : w.varint(v));
    return this.bytesField(field, w.bytes);
  }
  buf(): Buffer {
    return Buffer.from(this.bytes);
  }
}

export interface PbfNode {
  id: number;
  lat: number;
  lon: number;
  /** 1.3.1 : étiquettes du nœud (keys_vals des nœuds denses, keys et vals des nœuds simples) */
  tags?: Record<string, string>;
}
export interface PbfWay {
  id: number;
  refs: number[];
  tags: Record<string, string>;
}

/**
 * Fichier PBF : en-tête (trié ou non, horodaté), blocs de nœuds denses puis blocs de voies, `perBlock` éléments par
 * bloc. `granularity` et décalages pour éprouver la conversion des coordonnées ; `raw` : blocs non compressés.
 */
export function writePbf(nodes: PbfNode[], ways: PbfWay[], o: { perBlock?: number; sorted?: boolean; timestamp?: number; granularity?: number; latOffset?: number; lonOffset?: number; raw?: boolean; plainNodes?: boolean } = {}): Buffer {
  const per = o.perBlock ?? 1000;
  const gran = o.granularity ?? 100;
  const latOff = o.latOffset ?? 0;
  const lonOff = o.lonOffset ?? 0;
  const chunks: Buffer[] = [];
  const blob = (type: string, data: Buffer) => {
    const b = new PbWriter();
    if (o.raw) b.bytesField(1, data);
    else b.field(2, data.length).bytesField(3, deflateSync(data));
    const blobBuf = b.buf();
    const h = new PbWriter().str(1, type).field(3, blobBuf.length).buf();
    const len = Buffer.alloc(4);
    len.writeUInt32BE(h.length, 0);
    chunks.push(len, h, blobBuf);
  };
  const header = new PbWriter().str(4, 'OsmSchema-V0.6').str(4, 'DenseNodes');
  if (o.sorted !== false) header.str(5, 'Sort.Type_then_ID');
  header.str(16, 'tests');
  if (o.timestamp) header.int64(32, o.timestamp);
  blob('OSMHeader', header.buf());
  const toUnits = (deg: number, off: number) => Math.round((deg * 1e9 - off) / gran);
  for (let i = 0; i < nodes.length; i += per) {
    const part = nodes.slice(i, i + per);
    const block = new PbWriter();
    // 1.3.1 : table de chaînes des étiquettes de nœuds (sans étiquette : la table d'une chaîne vide, comme avant)
    const tagged = part.some((n) => n.tags && Object.keys(n.tags).length);
    const nstrings = [''];
    const nidx = (x: string) => {
      let k = nstrings.indexOf(x);
      if (k < 0) k = nstrings.push(x) - 1;
      return k;
    };
    const group = new PbWriter();
    if (o.plainNodes) {
      for (const n of part) {
        const w = new PbWriter().tag(1, 0).sint(n.id);
        if (tagged && n.tags && Object.keys(n.tags).length) w.packed(2, Object.keys(n.tags).map(nidx)).packed(3, Object.values(n.tags).map(nidx));
        group.bytesField(1, w.tag(8, 0).sint(toUnits(n.lat, latOff)).tag(9, 0).sint(toUnits(n.lon, lonOff)).buf());
      }
    } else {
      const ids: number[] = [];
      const lats: number[] = [];
      const lons: number[] = [];
      let pid = 0;
      let pla = 0;
      let plo = 0;
      for (const n of part) {
        const la = toUnits(n.lat, latOff);
        const lo = toUnits(n.lon, lonOff);
        ids.push(n.id - pid);
        lats.push(la - pla);
        lons.push(lo - plo);
        pid = n.id;
        pla = la;
        plo = lo;
      }
      const dense = new PbWriter().packed(1, ids, true).packed(8, lats, true).packed(9, lons, true);
      if (tagged) {
        const kv: number[] = [];
        for (const n of part) {
          for (const [k, v] of Object.entries(n.tags ?? {})) kv.push(nidx(k), nidx(v));
          kv.push(0);
        }
        dense.packed(10, kv);
      }
      group.bytesField(2, dense.buf());
    }
    if (tagged) {
      const st = new PbWriter();
      for (const x of nstrings) st.str(1, x);
      block.bytesField(1, st.buf());
    } else block.bytesField(1, new PbWriter().bytesField(1, []).buf());
    block.bytesField(2, group.buf());
    if (gran !== 100) block.field(17, gran);
    if (latOff) block.int64(19, latOff);
    if (lonOff) block.int64(20, lonOff);
    blob('OSMData', block.buf());
  }
  for (let i = 0; i < ways.length; i += per) {
    const part = ways.slice(i, i + per);
    const strings = [''];
    const sidx = (s: string) => {
      let k = strings.indexOf(s);
      if (k < 0) k = strings.push(s) - 1;
      return k;
    };
    const group = new PbWriter();
    for (const w of part) {
      const keys = Object.keys(w.tags).map(sidx);
      const vals = Object.values(w.tags).map(sidx);
      const refs: number[] = [];
      let prev = 0;
      for (const r of w.refs) {
        refs.push(r - prev);
        prev = r;
      }
      group.bytesField(3, new PbWriter().field(1, w.id).packed(2, keys).packed(3, vals).packed(8, refs, true).buf());
    }
    const st = new PbWriter();
    for (const s of strings) st.str(1, s);
    const block = new PbWriter().bytesField(1, st.buf()).bytesField(2, group.buf());
    blob('OSMData', block.buf());
  }
  return Buffer.concat(chunks);
}
