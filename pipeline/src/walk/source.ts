/**
 * 1.2.10 : sources OSM du graphe piéton : fichier PBF (extrait Geofabrik) ou petit fichier OSM XML (extraits écrits
 * à la main pour les tests). Même interface : un passage sur les voies, puis un passage sur les nœuds.
 */
import { readFileSync } from 'node:fs';
import { firstBlockWithoutNodes, PbfFile, readNodes, readWays, type Tags } from './pbf.ts';
import { tagsOf } from './filter.ts';

export type WayCallback = (id: number, tags: Tags, refs: Float64Array, n: number) => void;
export type NodesCallback = (ids: Float64Array, lat: Float64Array, lon: Float64Array, n: number) => void;

export interface OsmSource {
  /** Date des données (secondes depuis 1970), si le fichier la donne. */
  readonly timestamp?: number;
  ways(wanted: (t: Tags) => boolean, onWay: WayCallback): void;
  nodes(onNodes: NodesCallback): void;
  close(): void;
}

export function pbfSource(path: string): OsmSource {
  const f = new PbfFile(path);
  let split: number | null | undefined;
  const boundary = () => {
    if (split === undefined) split = firstBlockWithoutNodes(f);
    return split;
  };
  return {
    timestamp: f.header.timestamp,
    ways(wanted, onWay) {
      const k = boundary();
      for (let i = k === null ? 0 : Math.max(0, k - 1); i < f.blobs.length; i++) readWays(f.block(i), wanted, onWay);
    },
    nodes(onNodes) {
      const k = boundary();
      const end = k === null ? f.blobs.length : k;
      for (let i = 0; i < end; i++) readNodes(f.block(i), onNodes);
    },
    close() {
      f.close();
    },
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e],
  );
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = unescapeXml(m[2] ?? m[3] ?? '');
  return out;
}

/** Source OSM XML (petits extraits) : tout est lu en mémoire. */
export function xmlSource(text: string): OsmSource {
  const nodes: { id: number; lat: number; lon: number }[] = [];
  const ways: { id: number; tags: Record<string, string>; refs: number[] }[] = [];
  const head = /<osm\b([^>]*)>/.exec(text);
  const stamp = head ? attrs(head[1]).timestamp : undefined;
  const meta = /<meta\b([^>]*)\/?>/.exec(text);
  const base = meta ? attrs(meta[1]).osm_base : undefined;
  const iso = stamp ?? base;
  const timestamp = iso && Number.isFinite(Date.parse(iso)) ? Math.floor(Date.parse(iso) / 1000) : undefined;
  for (const m of text.matchAll(/<(node|way)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g)) {
    const a = attrs(m[2]);
    const id = Number(a.id);
    if (!Number.isFinite(id)) throw new Error(`OSM XML : identifiant invalide (${a.id})`);
    if (m[1] === 'node') {
      const lat = Number(a.lat);
      const lon = Number(a.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`OSM XML : nœud ${id} sans coordonnées`);
      nodes.push({ id, lat, lon });
      continue;
    }
    const body = m[4] ?? '';
    const tags: Record<string, string> = {};
    for (const t of body.matchAll(/<tag\b([^>]*?)\/?>/g)) {
      const ta = attrs(t[1]);
      if (ta.k !== undefined) tags[ta.k] = ta.v ?? '';
    }
    const refs: number[] = [];
    for (const r of body.matchAll(/<nd\b([^>]*?)\/?>/g)) refs.push(Number(attrs(r[1]).ref));
    ways.push({ id, tags, refs });
  }
  nodes.sort((x, y) => x.id - y.id);
  ways.sort((x, y) => x.id - y.id);
  return {
    timestamp,
    ways(wanted, onWay) {
      for (const w of ways) {
        const t = tagsOf(w.tags);
        if (!wanted(t)) continue;
        onWay(w.id, t, Float64Array.from(w.refs), w.refs.length);
      }
    },
    nodes(onNodes) {
      const ids = Float64Array.from(nodes.map((n) => n.id));
      const lat = Float64Array.from(nodes.map((n) => n.lat));
      const lon = Float64Array.from(nodes.map((n) => n.lon));
      onNodes(ids, lat, lon, nodes.length);
    },
    close() {},
  };
}

/** Source d'après l'extension : .osm.pbf / .pbf, sinon XML. */
export function openSource(path: string): OsmSource {
  return /\.pbf$/i.test(path) ? pbfSource(path) : xmlSource(readFileSync(path, 'utf8'));
}
