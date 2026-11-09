import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from '../../fixtures/pipeline/zip.ts';
import { JsonWriter } from '../src/writer.ts';
import { processFeed } from '../src/feed.ts';
import type { Op } from '../../shared/types.ts';

export const PIPELINE_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const ROOT_DIR = resolve(PIPELINE_DIR, '..');
export const FIXTURE_ZIPS = join(ROOT_DIR, 'fixtures', 'pipeline', 'gtfs');

const dirs: string[] = [];

export function tempDir(prefix = 'quai-test-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export function cleanupTempDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Écrit un zip GTFS à partir de contenus texte. */
export function writeGtfsZip(dir: string, name: string, files: Record<string, string>): string {
  const path = join(dir, name);
  writeFileSync(path, makeZip(Object.entries(files).map(([n, data]) => ({ name: n, data }))));
  return path;
}

/** Petit flux GTFS minimal valide, que chaque test complète ou remplace. */
export function miniFeed(over: Record<string, string> = {}): Record<string, string> {
  return {
    'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\nA,Test,https://example.org,Europe/Brussels\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nALL,1,1,1,1,1,1,1,20260101,20261231\nOFF,0,0,0,0,0,0,0,20260101,20261231\n',
    'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nR1,1,Ligne 1,3\n',
    ...over,
  };
}

/** Traite un zip et renvoie le résultat et le dossier de sortie. */
export async function runFeed(op: Op, files: Record<string, string>, dates = ['2026-11-10', '2026-11-11']) {
  const dir = tempDir();
  const zip = writeGtfsZip(dir, `${op}.zip`, files);
  const out = join(dir, 'out');
  const writer = new JsonWriter(out);
  const result = await processFeed({ op, zipPath: zip, dates, writer });
  await writer.flush();
  return { result, out };
}
