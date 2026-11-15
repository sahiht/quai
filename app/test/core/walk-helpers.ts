/**
 * 1.2.10 : graphes piétons construits à la main pour les tests du chemin à pied, codés au vrai format des tuiles
 * (core/walk/format.ts). Positions en mètres autour d'un point public (Ixelles, près de Flagey), au centre de sa tuile.
 */
import type { LatLon } from '../../src/core/api';
import { baseKeyOf, boxOf, encodeTile, WALK_UNIT, type ChainIn, type WalkIndex, type WalkTileFile } from '../../src/core/walk/format';
import type { WalkSource } from '../../src/core/walk/router';

/** Centre de la tuile 2541_145 (Ixelles, quartier de Flagey). */
export const ANCHOR: LatLon = { lat: 50.83, lon: 4.365 };
const M_LAT = 6371000 * (Math.PI / 180);

/** Point à `dx` m à l'est et `dy` m au nord de `anchor`. */
export function at(dx: number, dy: number, anchor: LatLon = ANCHOR): LatLon {
  return { lat: anchor.lat + dy / M_LAT, lon: anchor.lon + dx / (M_LAT * Math.cos((anchor.lat * Math.PI) / 180)) };
}

/** Point à `dist` m dans la direction `bearing` (degrés depuis le nord, sens horaire) depuis (dx, dy). */
export function toward(dx: number, dy: number, bearing: number, dist: number): [number, number] {
  const r = (bearing * Math.PI) / 180;
  return [dx + dist * Math.sin(r), dy + dist * Math.cos(r)];
}

export interface WayDef {
  nodes: string[];
  name?: string;
  flags?: number;
  comp?: number;
}

export interface GraphDef {
  /** nœuds : position en mètres autour de ANCHOR, ou position absolue */
  nodes: Record<string, [number, number] | LatLon>;
  ways: WayDef[];
  /** nœuds partagés avec une autre tuile : identifiant global */
  shared?: Record<string, number>;
}

const posOf = (p: [number, number] | LatLon): LatLon => (Array.isArray(p) ? at(p[0], p[1]) : p);
const units = (p: LatLon): [number, number] => [Math.round(p.lat / WALK_UNIT), Math.round(p.lon / WALK_UNIT)];

/**
 * Tuile d'un graphe : nœuds vus deux fois ou plus, ou bouts de voie = carrefours ; les autres = points de forme.
 * `key` : clé imposée (par défaut celle du premier nœud) ; `loose` : nœuds hors du cadre permis (tests de vitesse).
 */
export function tileOf(def: GraphDef, o: { key?: string; ver?: string; loose?: boolean } = {}): WalkTileFile {
  const ids = Object.keys(def.nodes);
  const num = new Map(ids.map((id, i) => [id, i] as const));
  const u = ids.map((id) => units(posOf(def.nodes[id])));
  const key = o.key ?? baseKeyOf(u[0][0], u[0][1]);
  const box = boxOf(key);
  if (!box) throw new Error(`clé ${key}`);
  if (!o.loose) {
    for (let i = 0; i < ids.length; i++) {
      const [la, lo] = u[i];
      if (la < box.lat0 || la > box.lat1 || lo < box.lon0 || lo > box.lon1) throw new Error(`nœud ${ids[i]} hors de la tuile ${key}`);
    }
  }
  const count = new Map<string, number>();
  for (const w of def.ways) for (const n of w.nodes) count.set(n, (count.get(n) ?? 0) + 1);
  const isJunction = (w: WayDef, i: number) => i === 0 || i === w.nodes.length - 1 || (count.get(w.nodes[i]) ?? 0) >= 2;
  const names: string[] = [];
  const chains: ChainIn[] = [];
  for (const w of def.ways) {
    for (const n of w.nodes) if (!num.has(n)) throw new Error(`nœud inconnu ${n}`);
    let name = -1;
    if (w.name) {
      name = names.indexOf(w.name);
      if (name < 0) name = names.push(w.name) - 1;
    }
    const nodes: number[] = [num.get(w.nodes[0]) as number];
    const pts: number[][] = [];
    let cur: number[] = [];
    for (let i = 1; i < w.nodes.length; i++) {
      const id = num.get(w.nodes[i]) as number;
      if (isJunction(w, i)) {
        nodes.push(id);
        pts.push(cur);
        cur = [];
      } else cur.push(u[id][0], u[id][1]);
    }
    chains.push({ name, flags: w.flags ?? 0, comp: w.comp ?? 0, nodes, pts });
  }
  return encodeTile(key, o.ver ?? 'test', names, chains, (id) => u[id], (id) => def.shared?.[ids[id]]);
}

export function indexOf(o: { version?: string; split?: string[] } = {}): WalkIndex {
  return {
    v: 1,
    version: o.version ?? 'test',
    builtAt: '2026-11-01T00:00:00.000Z',
    source: 'tests',
    licence: 'ODbL 1.0',
    attribution: '© les contributeurs d’OpenStreetMap',
    tile: { lat: 0.02, lon: 0.03 },
    unit: WALK_UNIT,
    split: o.split ?? [],
    tiles: 0,
    bytes: 0,
    maxTileBytes: 0,
  };
}

/** Source en mémoire : tuiles par clé (une clé absente = tuile vide), avec le compte des demandes. */
export function memorySource(tiles: WalkTileFile[], index: WalkIndex | null = indexOf()): WalkSource & { calls: string[]; indexCalls: number } {
  const byKey = new Map(tiles.map((t) => [t.k, t] as const));
  const src = {
    calls: [] as string[],
    indexCalls: 0,
    index: async () => {
      src.indexCalls++;
      return index;
    },
    tile: async (key: string, version: string) => {
      src.calls.push(`${version}|${key}`);
      return byKey.get(key) ?? null;
    },
  };
  return src;
}

/** Distance (m) entre deux points (même formule que le chemin à pied). */
export function metres(a: LatLon, b: LatLon): number {
  const dy = (b.lat - a.lat) * M_LAT;
  const dx = (b.lon - a.lon) * M_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
