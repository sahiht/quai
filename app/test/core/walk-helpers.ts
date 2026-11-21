/**
 * 1.2.10 : graphes piétons construits à la main pour les tests du chemin à pied, codés au vrai format des tuiles
 * (core/walk/format.ts). Positions en mètres autour d'un point public (Ixelles, près de Flagey), au centre de sa tuile.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { LatLon } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { baseKeyOf, boxOf, encodeTile, isWalkIndex, isWalkTile, WALK_UNIT, type ChainIn, type WalkIndex, type WalkTileFile } from '../../src/core/walk/format';
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

/** Tuiles lues sur le disque (dossier de tuiles du pipeline). */
export function diskSource(dir: string): WalkSource & { reads: number } {
  const src = {
    reads: 0,
    index: async () => {
      const x = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as unknown;
      return isWalkIndex(x) ? x : null;
    },
    tile: async (key: string) => {
      try {
        const x = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')) as unknown;
        src.reads++;
        return isWalkTile(x) ? x : null;
      } catch {
        return null;
      }
    },
  };
  return src;
}

/** Générateur pseudo-aléatoire reproductible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Invariants d'un chemin : bouts exacts, points proches, virages espacés de 15 m, rien dans les 20 derniers mètres. */
export function checkRoute(r: WalkRoute, from: LatLon, to: LatLon): void {
  expect(r.coords[0]).toEqual(from);
  expect(r.coords[r.coords.length - 1]).toEqual(to);
  expect(r.coords.length).toBeGreaterThanOrEqual(2);
  let along = 0;
  const cum = [0];
  for (let i = 1; i < r.coords.length; i++) cum.push((along += metres(r.coords[i - 1], r.coords[i])));
  expect(Math.abs(r.lengthM - along)).toBeLessThan(0.5);
  expect(r.lengthM).toBeGreaterThanOrEqual(metres(from, to) - 0.5);
  let prev = -Infinity;
  for (const m of r.maneuvers) {
    expect(m.distM - prev).toBeGreaterThanOrEqual(15);
    expect(m.distM).toBeLessThanOrEqual(r.lengthM - 20);
    expect(Math.abs(cum[m.at] - m.distM)).toBeLessThan(0.5);
    prev = m.distM;
  }
}

/* ------------------------------ 1.3.1 : mesure de la première marche (vrai chemin partout) ------------------------------ */

/** Une marche rejouée : ses deux bouts publics (noms d'arrêts), la distance à vol d'oiseau et la longueur du vrai chemin. */
export interface WalkSample {
  from: string;
  to: string;
  crowM: number;
  lengthM: number;
}

/**
 * 1.3.1 (décision du 20/11 à 21:59, contrôle) : ce que la règle « l'heure de partir d'après le vrai chemin » ferait de
 * ces marches si chacune était la première marche d'un trajet. Estimation : celle du calcul des trajets (vol d'oiseau
 * × 1,3 à 80 m par minute, `est`) ; vrai chemin : 80 m par minute (`real`) ; avance : real - est, au plus `capMin`.
 * Lignes pour le journal de la nuit (elles commencent toutes par « Première marche ») : la part des marches où le vrai
 * chemin dépasse l'estimation d'au moins 1 min, la répartition (+1, +2, +3 à +5, plus de 5 min plafonnées), l'avance
 * moyenne, et le pire cas avec ses deux arrêts. Ne juge rien : une mesure.
 */
export function firstWalkReport(samples: readonly WalkSample[], o: { est: (crowM: number) => number; real: (lengthM: number) => number; capMin: number; nearM?: number }): string[] {
  const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1).replace('.', ',')} %`;
  const line = (title: string, xs: readonly WalkSample[]): string => {
    const extra = xs.map((x) => o.real(x.lengthM) - o.est(x.crowM));
    const n = xs.length;
    const count = (ok: (e: number) => boolean) => extra.filter(ok).length;
    const moved = count((e) => e >= 1);
    const capped = extra.filter((e) => e >= 1).map((e) => Math.min(e, o.capMin));
    const mean = capped.length ? capped.reduce((a, b) => a + b, 0) / capped.length : 0;
    const part = (label: string, k: number) => `${label} ${k} (${pct(k, n)})`;
    return (
      `${title} : ${n} vrais chemins, ${moved} (${pct(moved, n)}) dépassent l'estimation d'au moins 1 min : ` +
      [part('+1 min', count((e) => e === 1)), part('+2 min', count((e) => e === 2)), part(`+3 à +${o.capMin} min`, count((e) => e >= 3 && e <= o.capMin)), part(`plus de ${o.capMin} min, plafonnées`, count((e) => e > o.capMin))].join(', ') +
      ` ; avance moyenne quand l'heure change : ${mean.toFixed(1).replace('.', ',')} min ; rien ne change pour ${n - moved} (${pct(n - moved, n)})`
    );
  };
  const nearM = o.nearM ?? 600;
  const out = [line('Première marche (1.3.1, heure de partir d\'après le vrai chemin), toutes les marches rejouées', samples), line(`Première marche, marches de ${nearM} m au plus à vol d'oiseau`, samples.filter((x) => x.crowM <= nearM))];
  let worst: WalkSample | null = null;
  for (const x of samples) if (!worst || o.real(x.lengthM) - o.est(x.crowM) > o.real(worst.lengthM) - o.est(worst.crowM)) worst = x;
  if (worst) {
    const e = o.real(worst.lengthM) - o.est(worst.crowM);
    out.push(
      `Première marche, pire cas : ${worst.from} → ${worst.to}, vrai chemin de ${Math.round(worst.lengthM)} m (${o.real(worst.lengthM)} min) pour ${o.est(worst.crowM)} min estimées (${Math.round(worst.crowM)} m à vol d'oiseau) : ` +
        (e >= 1 ? `l'heure de partir avancerait de ${Math.min(e, o.capMin)} min${e > o.capMin ? ` (plafond, ${e} min sans lui)` : ''}` : 'rien ne changerait'),
    );
  }
  return out;
}
