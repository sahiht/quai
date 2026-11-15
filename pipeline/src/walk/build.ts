/**
 * 1.2.10 : construction des tuiles piétonnes depuis un extrait OSM (PBF ou XML) : lecture, graphe, tuiles, budget.
 * Budget (PRD-1.2.10 § 3.8) : 80 Mo pour la Belgique, 300 ko par tuile. Au-delà de 80 Mo : voies limitées à 2 km
 * des arrêts publiés (si les tuiles d'arrêts sont fournies), puis simplification plus forte (4 m).
 * Écriture : chaque tuile, puis index.json en dernier (un lecteur ne voit jamais un index qui annonce des tuiles
 * absentes).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildGraph } from './graph.ts';
import { loadWalkData } from './load.ts';
import { nearStops, publishedStops } from './near.ts';
import { openSource } from './source.ts';
import { BUDGET_BYTES, buildTiles, MAX_TILE_BYTES, SIMPLIFY_M, type BuiltTiles } from './tiles.ts';

export const NEAR_STOPS_M = 2000;

export interface WalkBuildOptions {
  input: string;
  /** dossier des tuiles (vidé puis rempli) */
  out: string;
  /** dossier des données de la nuit (tiles/*.json : arrêts publiés), pour le repli du budget */
  stopsDir?: string;
  version?: string;
  builtAt?: string;
  budgetBytes?: number;
  maxTileBytes?: number;
  /** source annoncée dans l'index (par défaut l'extrait Geofabrik) */
  source?: string;
  log?: (m: string) => void;
  now?: () => Date;
}

export interface WalkBuildResult {
  built: BuiltTiles;
  ms: number;
}

const ko = (b: number) => `${Math.round(b / 1000)} ko`;
const mo = (b: number) => `${(b / 1e6).toFixed(1).replace('.', ',')} Mo`;

export function sizeLine(b: BuiltTiles): string {
  return `${b.stats.tiles} tuiles, ${mo(b.stats.bytes)} au total, plus grosse ${b.stats.maxTile.key} ${ko(b.stats.maxTile.bytes)}, ${b.stats.split} tuiles coupées en 4`;
}

/** Version des tuiles : date des données de l'extrait, sinon date du jour (UTC). */
export function dataVersion(timestamp: number | undefined, now: Date): string {
  const t = timestamp && timestamp > 0 ? new Date(timestamp * 1000) : now;
  return t.toISOString().slice(0, 10);
}

export async function buildWalk(o: WalkBuildOptions): Promise<WalkBuildResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const t0 = Date.now();
  const now = o.now ? o.now() : new Date();
  const budget = o.budgetBytes ?? BUDGET_BYTES;
  const maxTile = o.maxTileBytes ?? MAX_TILE_BYTES;
  const src = openSource(o.input);
  let data;
  try {
    data = loadWalkData(src, log);
  } finally {
    src.close();
  }
  const graph = buildGraph(data, { log });
  const version = o.version ?? dataVersion(data.timestamp, now);
  const builtAt = o.builtAt ?? now.toISOString();
  const base = { version, builtAt, maxTileBytes: maxTile, log, ...(o.source ? { source: o.source } : {}) };
  let built = buildTiles(graph, base);
  log(`Chemins à pied : ${sizeLine(built)}`);
  if (built.stats.bytes > budget && o.stopsDir) {
    const stops = await publishedStops(o.stopsDir);
    if (stops.length) {
      log(`Chemins à pied : au-delà du budget de ${mo(budget)}, voies limitées à ${NEAR_STOPS_M} m des ${stops.length} arrêts publiés`);
      built = buildTiles(graph, { ...base, keepEdge: nearStops(stops, NEAR_STOPS_M), nearStopsM: NEAR_STOPS_M });
      log(`Chemins à pied : ${sizeLine(built)}`);
    }
  }
  if (built.stats.bytes > budget) {
    log(`Chemins à pied : toujours au-delà du budget, simplification à ${2 * SIMPLIFY_M} m`);
    const keep = built.index.nearStopsM && o.stopsDir ? nearStops(await publishedStops(o.stopsDir), NEAR_STOPS_M) : undefined;
    built = buildTiles(graph, { ...base, simplifyM: 2 * SIMPLIFY_M, ...(keep ? { keepEdge: keep, nearStopsM: NEAR_STOPS_M } : {}) });
    log(`Chemins à pied : ${sizeLine(built)}`);
  }
  if (built.stats.bytes > budget) log(`Chemins à pied : attention, ${mo(built.stats.bytes)} au-delà du budget de ${mo(budget)}`);
  if (built.stats.overLimit.length) log(`Chemins à pied : attention, ${built.stats.overLimit.length} tuiles au-delà de ${ko(maxTile)} (${built.stats.overLimit.slice(0, 5).join(', ')})`);
  if (!built.files.length) throw new Error('aucune voie piétonne dans l’extrait');
  await rm(o.out, { recursive: true, force: true });
  await mkdir(o.out, { recursive: true });
  for (const f of built.files) await writeFile(join(o.out, `${f.key}.json`), f.json, 'utf8');
  await writeFile(join(o.out, 'index.json'), JSON.stringify(built.index), 'utf8');
  return { built, ms: Date.now() - t0 };
}
