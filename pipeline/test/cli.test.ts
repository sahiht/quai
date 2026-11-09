/** La commande build-data lancée comme en vrai (processus séparé). */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Meta } from '../../shared/types.ts';
import { cleanupTempDirs, FIXTURE_ZIPS, PIPELINE_DIR, tempDir } from './helpers.ts';

afterAll(cleanupTempDirs);

function run(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const clean = { ...process.env };
    for (const k of ['BMC_KEY', 'BMC_BASE', 'QUAI_DATE', 'QUAI_SOURCES', 'INIT_CWD']) delete clean[k];
    const p = spawn(process.execPath, ['--experimental-strip-types', 'src/cli.ts', ...args], { cwd: PIPELINE_DIR, env: { ...clean, ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const zips = (ops: string[]) => ops.map((op) => `${op}=${join(FIXTURE_ZIPS, `${op}.zip`)}`).join(',');

describe('npm run build-data', () => {
  it('sans BMC_KEY ni QUAI_SOURCES : code 2 et message en français', async () => {
    const r = await run(['--out', join(tempDir(), 'x')], {});
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Erreur : la variable BMC_KEY est absente');
  });

  it('sans --out : code 2 et usage', async () => {
    const r = await run([], { BMC_KEY: 'k' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--out <dossier> est obligatoire');
    expect(r.stderr).toContain('Usage : npm run build-data');
  });

  it('QUAI_SOURCES partiel : réseaux absents marqués en erreur, code 0, rapport de taille', async () => {
    const dir = tempDir();
    const r = await run(['--out', join(dir, 'data'), '--site', dir], { QUAI_SOURCES: zips(['stib', 'tec']), QUAI_DATE: '2026-11-10' });
    expect(r.code).toBe(0);
    const meta = JSON.parse(readFileSync(join(dir, 'data', 'meta.json'), 'utf8')) as Meta;
    expect(meta.serviceDates).toEqual(['2026-11-10', '2026-11-11']);
    expect(meta.feeds.sncb).toEqual({ ok: false, error: 'source non fournie dans QUAI_SOURCES', areas: 0, trips: 0 });
    expect(meta.feeds.delijn.ok).toBe(false);
    expect(meta.feeds.stib.ok).toBe(true);
    expect(meta.feeds.tec.ok).toBe(true);
    expect(r.stdout).toMatch(/Taille : \d+ fichiers, [\d,]+ Mo au total/);
    expect(r.stdout).toContain('Plus gros fichiers :');
    expect(r.stdout).toMatch(/mémoire maximale : \d+ Mo/);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
    expect(r.stdout.includes('\u2014') || r.stderr.includes('\u2014')).toBe(false);
  });

  it('tous les réseaux en échec : code 1, meta écrit quand même', async () => {
    const dir = tempDir();
    const bad = join(dir, 'pas-un-zip.zip');
    writeFileSync(bad, 'ceci n’est pas un zip');
    const r = await run(['--out', join(dir, 'data')], { QUAI_SOURCES: ['sncb', 'stib', 'delijn', 'tec'].map((op) => `${op}=${bad}`).join(',') });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('aucun réseau n\'a pu être préparé');
    const meta = JSON.parse(readFileSync(join(dir, 'data', 'meta.json'), 'utf8')) as Meta;
    expect(meta.feeds.sncb.ok).toBe(false);
    expect(meta.feeds.sncb.error).toMatch(/^archive zip illisible/);
  });

  it('téléchargement depuis un portail BMC simulé : clé envoyée, jamais affichée', async () => {
    const KEY = 'ma-cle-tres-secrete-42';
    const seen: IncomingMessage['headers'][] = [];
    const slugs: Record<string, string> = { nmbssncb: 'sncb', stibmivb: 'stib', delijn: 'delijn', tec: 'tec' };
    const server = createServer((req, res) => {
      seen.push(req.headers);
      const m = /^\/api\/gtfs\/feed\/([a-z]+)\/static$/.exec(req.url ?? '');
      if (!m || req.headers['bmc-partner-key'] !== KEY || req.headers['ocp-apim-subscription-key'] !== KEY) {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(readFileSync(join(FIXTURE_ZIPS, `${slugs[m[1]]}.zip`)));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const dir = tempDir();
      const r = await run(['--out', join(dir, 'data')], {
        BMC_KEY: KEY, BMC_BASE: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, QUAI_DATE: '2026-11-10',
      });
      expect(r.code).toBe(0);
      const meta = JSON.parse(readFileSync(join(dir, 'data', 'meta.json'), 'utf8')) as Meta;
      for (const op of ['sncb', 'stib', 'delijn', 'tec'] as const) expect(meta.feeds[op].ok, op).toBe(true);
      expect(seen).toHaveLength(4);
      expect(r.stdout + r.stderr).not.toContain(KEY);
      expect(r.stdout).toContain('Mo reçus (SNCB, portail BMC');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
