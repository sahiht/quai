/**
 * Chemin de téléchargement du pipeline (npm run build-data sans QUAI_SOURCES) contre le faux portail BMC,
 * via un mandataire qui enregistre les en-têtes et injecte des pannes : en-têtes de clé, nouvelles tentatives,
 * replis, redirection vers une autre origine, contenu non zip, clé refusée, et jamais de clé dans les sorties.
 */
import { readdirSync, readFileSync, rmSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateData } from './validate-data';
import { buildFixtureData, GTFS, PIPELINE, run, startMockBmc, TEST_KEY, type Proc } from './lib/stack';
import { startFaultyProxy, startRecorder, type FaultyProxy } from './lib/faulty';

const SLUGS = ['nmbssncb', 'stibmivb', 'delijn', 'tec'];

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out.sort();
}

/** Aucune trace de la clé (ni encodée) dans un texte ou dans les fichiers d'un dossier. */
function expectNoKey(text: string, key: string, where: string): void {
  for (const form of [key, encodeURIComponent(key), Buffer.from(key).toString('base64')]) {
    expect(text.includes(form), `clé trouvée dans ${where}`).toBe(false);
  }
}
function expectNoKeyInDir(dir: string, key: string): void {
  for (const f of listFiles(dir)) expectNoKey(readFileSync(join(dir, f), 'utf8'), key, f);
}

const buildData = (out: string, env: Record<string, string>, extra: string[] = []) =>
  run('npm', ['run', 'build-data', '--', '--out', out, '--site', `${out}-site`, ...extra], { cwd: PIPELINE, env: { QUAI_SOURCES: '', QUAI_DATE: '2026-11-10', ...env }, timeoutMs: 240_000 });

let bmc: Proc;
let reference: string;
const tmp = mkdtempSync(join(tmpdir(), 'quai-e2e-dl-'));

beforeAll(async () => {
  bmc = await startMockBmc(TEST_KEY);
  reference = (await buildFixtureData({ out: join(tmp, 'reference') })).dir;
});
afterAll(async () => {
  await bmc?.stop();
  rmSync(tmp, { recursive: true, force: true });
  rmSync(`${tmp}-site`, { recursive: true, force: true });
});

describe('téléchargement depuis le faux portail BMC', () => {
  let proxy: FaultyProxy;
  beforeAll(async () => {
    proxy = await startFaultyProxy(bmc.url);
  });
  afterAll(async () => {
    await proxy?.close();
  });

  it('chemin nominal : deux en-têtes de clé, 4 flux, résultat identique aux zips locaux, aucune fuite', async () => {
    const out = join(tmp, 'nominal');
    const r = await buildData(out, { BMC_KEY: TEST_KEY, BMC_BASE: proxy.url });
    const logs = r.stdout + r.stderr;
    expect(r.code, logs).toBe(0);
    const statics = proxy.seen.filter((s) => /\/static$/.test(s.path));
    expect(statics.map((s) => s.path).sort()).toEqual(SLUGS.map((s) => `/api/gtfs/feed/${s}/static`).sort());
    for (const s of statics) {
      expect(s.headers['bmc-partner-key']).toBe(TEST_KEY);
      expect(s.headers['ocp-apim-subscription-key']).toBe(TEST_KEY);
      expect(s.headers['user-agent']).toMatch(/quai-pipeline/);
      expect(s.status).toBe(200);
    }
    expect(logs).toMatch(/SNCB : [\d,]+ Mo reçus \(SNCB, portail BMC/);
    expectNoKey(logs, TEST_KEY, 'journal');
    expectNoKeyInDir(out, TEST_KEY);
    expectNoKeyInDir(`${out}-site`, TEST_KEY);
    // mêmes fichiers et même contenu que la préparation depuis les zips locaux (hors date de génération)
    expect(listFiles(out)).toEqual(listFiles(reference));
    for (const f of listFiles(out)) {
      const a = readFileSync(join(out, f), 'utf8');
      const b = readFileSync(join(reference, f), 'utf8');
      if (f === 'meta.json' || f === 'LICENSE-DATA.txt') {
        const strip = (t: string) => t.replace(/"generatedAt":"[^"]+"/, '').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '');
        expect(strip(a), f).toBe(strip(b));
      } else expect(a, f).toBe(b);
    }
    expect(validateData(out).errors).toEqual([]);
  });

  it('pannes : 503 puis succès, redirection vers une autre origine, contenu non zip, 503 permanent avec repli', async () => {
    const zip = readFileSync(join(GTFS, 'stib.zip'));
    const other = await startRecorder({ '/elsewhere/stib.zip': { body: zip, type: 'application/zip' } });
    try {
      proxy.seen.length = 0;
      proxy.rules = [
        { match: /nmbssncb\/static$/, fault: (n) => (n <= 2 ? { status: 503, body: 'Service Unavailable' } : 'pass') },
        { match: /stibmivb\/static$/, fault: () => ({ status: 302, headers: { Location: `${other.url}/elsewhere/stib.zip` } }) },
        { match: /delijn\/static$/, fault: (n) => (n === 1 ? { status: 200, body: '<html>maintenance</html>', headers: { 'Content-Type': 'text/html' } } : 'pass') },
        { match: /tec\/static$/, fault: () => ({ status: 503, body: 'down' }) },
      ];
      const out = join(tmp, 'faults');
      const t0 = Date.now();
      const r = await buildData(out, { BMC_KEY: TEST_KEY, BMC_BASE: proxy.url });
      const ms = Date.now() - t0;
      const logs = r.stdout + r.stderr;
      expect(r.code, logs).toBe(0); // au moins un réseau a réussi
      const count = (re: RegExp) => proxy.seen.filter((s) => re.test(s.path)).length;
      // SNCB : deux 503 puis succès au 3e essai
      expect(count(/nmbssncb\/static$/)).toBe(3);
      expect(logs).toMatch(/SNCB, portail BMC : essai 1 échoué \(HTTP 503, erreur du serveur\), nouvel essai/);
      // STIB : redirection suivie ; la clé n'est PAS envoyée à l'autre origine
      expect(other.seen.length).toBe(1);
      expect(other.seen[0].headers['bmc-partner-key']).toBeUndefined();
      expect(other.seen[0].headers['ocp-apim-subscription-key']).toBeUndefined();
      // De Lijn : un contenu non zip est refusé puis le 2e essai réussit
      expect(count(/delijn\/static$/)).toBe(2);
      expect(logs).toMatch(/archive zip/);
      // TEC : 503 permanent = 1 essai + 3 nouvelles tentatives, puis repli (injoignable ici) sans clé
      expect(count(/tec\/static$/)).toBe(4);
      const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
      expect([meta.feeds.sncb.ok, meta.feeds.stib.ok, meta.feeds.delijn.ok, meta.feeds.tec.ok]).toEqual([true, true, true, false]);
      expect(meta.feeds.tec.error).toMatch(/TEC, portail BMC : HTTP 503, erreur du serveur/);
      expect(meta.feeds.tec.error).toMatch(/TEC, repli opendata\.tec-wl\.be/);
      expect(meta.feeds.tec.areas).toBe(0);
      expect(ms).toBeGreaterThan(25_000); // attentes 2 s, 8 s, 20 s respectées
      const report = validateData(out);
      expect(report.errors).toEqual([]);
      expect(report.stats.areas.tec).toBe(0);
      expectNoKey(logs, TEST_KEY, 'journal');
      expectNoKeyInDir(out, TEST_KEY);
      expectNoKeyInDir(`${out}-site`, TEST_KEY);
    } finally {
      proxy.rules = [];
      await other.close();
    }
  }, 180_000);

  it('clé refusée (401) : pas de nouvel essai sur le portail, message clair, code de sortie 1 si tout échoue', async () => {
    proxy.seen.length = 0;
    const wrong = 'wrong-key-QA-91b2c3';
    const out = join(tmp, 'wrong-key');
    const r = await buildData(out, { BMC_KEY: wrong, BMC_BASE: proxy.url });
    const logs = r.stdout + r.stderr;
    expect(r.code, logs).toBe(1);
    for (const slug of SLUGS) expect(proxy.seen.filter((s) => s.path.endsWith(`${slug}/static`)).length, slug).toBe(1);
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
    for (const op of ['sncb', 'stib', 'delijn', 'tec']) {
      expect(meta.feeds[op].ok).toBe(false);
      expect(meta.feeds[op].error).toMatch(/HTTP 401, clé refusée ou abonnement manquant/);
    }
    expect(logs).toMatch(/aucun réseau n'a pu être préparé/);
    expectNoKey(logs, wrong, 'journal');
    expectNoKeyInDir(out, wrong);
  }, 180_000);

  it('--cache-dir : GTFS gardés après une nuit normale, repris la nuit où le portail refuse tout ; pas au-delà de 7 jours', async () => {
    const cache = join(tmp, 'gtfs-cache');
    proxy.rules = [];
    const ok = await buildData(join(tmp, 'cache-1'), { BMC_KEY: TEST_KEY, BMC_BASE: proxy.url }, ['--cache-dir', cache]);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    const today = JSON.parse(readFileSync(join(cache, 'tec.json'), 'utf8')).date as string;
    for (const op of ['sncb', 'stib', 'delijn', 'tec']) {
      expect(readFileSync(join(cache, `${op}.zip`)).equals(readFileSync(join(GTFS, `${op}.zip`))), op).toBe(true);
      expect(JSON.parse(readFileSync(join(cache, `${op}.json`), 'utf8'))).toMatchObject({ v: 1, op, date: today });
    }
    // nuit suivante : clé refusée partout ; le GTFS De Lijn gardé est trop ancien
    const info = join(cache, 'delijn.json');
    writeFileSync(info, JSON.stringify({ ...JSON.parse(readFileSync(info, 'utf8')), date: '2026-10-20' }));
    proxy.rules = [{ match: /\/static$/, fault: () => ({ status: 401, body: '{"statusCode":401}' }) }];
    const out = join(tmp, 'cache-2');
    const r = await buildData(out, { BMC_KEY: TEST_KEY, BMC_BASE: proxy.url }, ['--cache-dir', cache]);
    const logs = r.stdout + r.stderr;
    expect(r.code, logs).toBe(0);
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
    for (const op of ['sncb', 'stib', 'tec']) expect(meta.feeds[op], op).toMatchObject({ ok: true, cachedFrom: today });
    expect(meta.feeds.delijn.ok).toBe(false);
    expect(meta.feeds.delijn.error).toMatch(/HTTP 401, clé refusée .* pas de repli \(flux gardé du 20\/10 trop ancien \(plus de 7 jours\)\)$/);
    expect(readFileSync(`${out}-site/index.html`, 'utf8')).toContain(`horaires du ${today.slice(8, 10)}/${today.slice(5, 7)}, le portail n’a pas répondu cette nuit`);
    expect(logs).toMatch(/SNCB\s+OK\s+14 zones, 11 voyages, .*GTFS gardé du /);
    const report = validateData(out);
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter((w) => /repris du GTFS gardé/.test(w)).length).toBe(3);
    expectNoKey(logs, TEST_KEY, 'journal');
    expectNoKeyInDir(cache, TEST_KEY);
    proxy.rules = [];
  }, 180_000);

  it('configuration : BMC_KEY absente (sans QUAI_SOURCES) donne le code 2 et un message en français', async () => {
    const r = await buildData(join(tmp, 'nokey'), { BMC_KEY: '', BMC_BASE: proxy.url });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/BMC_KEY est absente/);
  });
});
