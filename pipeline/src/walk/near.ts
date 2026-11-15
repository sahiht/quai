/**
 * 1.2.10 : repli du budget (PRD-1.2.10 § 3.8) : ne garder que les voies à moins de `radiusM` d'un arrêt publié
 * (tuiles d'arrêts de la nuit, data/tiles/*.json). Grille de cases de 250 m marquées autour de chaque arrêt.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CELL_M = 250;
const M_PER_DEG = 111_195;

export interface StopPoint {
  lat: number;
  lon: number;
}

/** Arrêts publiés : positions des zones des tuiles d'arrêts (data/tiles/*.json). */
export async function publishedStops(dataDir: string): Promise<StopPoint[]> {
  const dir = join(dataDir, 'tiles');
  const out: StopPoint[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const n of names.filter((x) => x.endsWith('.json')).sort()) {
    try {
      const t = JSON.parse(await readFile(join(dir, n), 'utf8')) as { areas?: { lat?: unknown; lon?: unknown }[] };
      for (const a of t.areas ?? []) {
        if (typeof a.lat === 'number' && typeof a.lon === 'number' && Number.isFinite(a.lat) && Number.isFinite(a.lon)) out.push({ lat: a.lat, lon: a.lon });
      }
    } catch {
      /* tuile illisible : ignorée */
    }
  }
  return out;
}

/** Fonction « ce point est-il à moins de radiusM d'un arrêt ? » (à une case près, par excès). */
export function nearStops(stops: readonly StopPoint[], radiusM: number): (lat: number, lon: number) => boolean {
  if (!stops.length) return () => false;
  const lat0 = stops.reduce((s, p) => s + p.lat, 0) / stops.length;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const cells = new Set<number>();
  const key = (cy: number, cx: number) => cy * 100_003 + cx;
  const r = Math.ceil(radiusM / CELL_M) + 1;
  for (const p of stops) {
    const cy = Math.floor((p.lat * M_PER_DEG) / CELL_M);
    const cx = Math.floor((p.lon * kx) / CELL_M);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(Math.max(0, Math.abs(dy) - 1), Math.max(0, Math.abs(dx) - 1)) * CELL_M <= radiusM) cells.add(key(cy + dy, cx + dx));
      }
    }
  }
  return (lat, lon) => cells.has(key(Math.floor((lat * M_PER_DEG) / CELL_M), Math.floor((lon * kx) / CELL_M)));
}
