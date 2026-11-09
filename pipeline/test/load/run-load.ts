/**
 * Test de charge : npm run load-test [-- --copies 400]
 * Génère un flux synthétique (copies des motifs des fixtures, au moins 1,5 million de lignes stop_times),
 * lance la vraie commande build-data dans un processus séparé et mesure durée et mémoire maximale.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeLoadFeed } from './make-load-feed.ts';
import type { LoadFeedInfo } from './make-load-feed.ts';
import { sizeReport } from '../../src/report.ts';

const PIPELINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface LoadResult {
  feed: LoadFeedInfo;
  seconds: number;
  peakRssMB: number;
  outFiles: number;
  outMB: number;
  exitCode: number;
  stdout: string;
}

export async function runLoad(copies: number): Promise<LoadResult> {
  const dir = mkdtempSync(join(tmpdir(), 'quai-load-'));
  try {
    const zip = join(dir, 'charge.zip');
    const feed = makeLoadFeed(copies, zip);
    const out = join(dir, 'data');
    const t0 = Date.now();
    const { code, stdout } = await new Promise<{ code: number; stdout: string }>((res) => {
      const env: NodeJS.ProcessEnv = { ...process.env, QUAI_SOURCES: `delijn=${zip}`, QUAI_DATE: '2026-11-10' };
      delete env.BMC_KEY;
      delete env.INIT_CWD;
      const p = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts', '--out', out], { cwd: PIPELINE, env });
      let o = '';
      p.stdout.on('data', (d) => (o += d));
      p.stderr.on('data', (d) => (o += d));
      p.on('close', (c) => res({ code: c ?? -1, stdout: o }));
    });
    const seconds = (Date.now() - t0) / 1000;
    const m = /mémoire maximale : (\d+) Mo/.exec(stdout);
    const rep = await sizeReport(out);
    return { feed, seconds, peakRssMB: m ? Number(m[1]) : NaN, outFiles: rep.files, outMB: rep.bytes / 1048576, exitCode: code, stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const fr = (x: number, d = 1) => x.toFixed(d).replace('.', ',');

async function main(): Promise<void> {
  const i = process.argv.indexOf('--copies');
  const big = i > 0 ? Number(process.argv[i + 1]) : 400;
  const sizes = [Math.round(big / 2), big];
  const results: LoadResult[] = [];
  for (const copies of sizes) {
    process.stdout.write(`Flux synthétique de ${copies} copies... `);
    const r = await runLoad(copies);
    results.push(r);
    console.log(`${r.feed.stopTimes.toLocaleString('fr-BE')} lignes stop_times (${r.feed.activeStopTimes.toLocaleString('fr-BE')} actives), `
      + `${fr(r.seconds)} s, mémoire max ${r.peakRssMB} Mo, sortie ${r.outFiles} fichiers / ${fr(r.outMB)} Mo, code ${r.exitCode}`);
    if (r.exitCode !== 0) console.log(r.stdout);
  }
  const [a, b] = results;
  const perRowKB = ((b.peakRssMB - a.peakRssMB) * 1024) / (b.feed.activeStopTimes - a.feed.activeStopTimes);
  const rowsPerSec = b.feed.stopTimes / b.seconds;
  console.log(`\nPente mémoire : ${fr(perRowKB * 1024, 0)} octets par ligne active ; débit : ${Math.round(rowsPerSec).toLocaleString('fr-BE')} lignes/s`);
  for (const [total, active] of [[15e6, 3e6], [30e6, 5e6]]) {
    const mem = b.peakRssMB + ((active - b.feed.activeStopTimes) * perRowKB) / 1024;
    console.log(`Extrapolation ${total / 1e6} M lignes dont ${active / 1e6} M actives : environ ${Math.round(total / rowsPerSec)} s et ${Math.round(mem)} Mo`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
