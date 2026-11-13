/**
 * Pile de test complète, lancée avec les vraies commandes des paquets sur des ports éphémères :
 *   pipeline : npm run build-data (zips de fixtures/pipeline/gtfs) puis npm run serve-data
 *   relay    : npm run mock-bmc (faux portail BMC, clé imposée) et npm run mock-geocode (faux service d'adresses
 *              des trois Régions, 1.1), puis npm run dev (relais local, QUAI_GEO_BASE = faux service d'adresses)
 * Chaque processus est lancé dans son propre groupe (arrêt propre de npm, sh et node).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
export const PIPELINE = join(ROOT, 'pipeline');
export const RELAY = join(ROOT, 'relay');
export const APP = join(ROOT, 'app');
export const GTFS = join(ROOT, 'fixtures', 'pipeline', 'gtfs');
export const FIXTURE_SOURCES = ['sncb', 'stib', 'delijn', 'tec'].map((op) => `${op}=${join(GTFS, `${op}.zip`)}`).join(',');

/** Clé de test, volontairement reconnaissable pour détecter toute fuite dans les journaux ou les réponses. */
export const TEST_KEY = 'qa-secret-K3y-7f3a9c';

export interface Proc {
  name: string;
  child: ChildProcess;
  out: string[];
  url: string;
  stop(): Promise<void>;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Lance une commande et attend sa fin. */
export function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<RunResult> {
  const t0 = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} ${args.join(' ')} : délai dépassé`));
    }, opts.timeoutMs ?? 120_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}

/** Démarre un serveur longue durée et attend sa ligne « prêt » (qui donne l'URL). */
export function startServer(
  name: string,
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; ready: RegExp; timeoutMs?: number },
): Promise<Proc> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const out: string[] = [];
    let done = false;
    const stop = async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((r) => {
        child.once('close', () => r());
        try {
          process.kill(-(child.pid as number), 'SIGTERM');
        } catch {
          r();
        }
        setTimeout(() => {
          try {
            process.kill(-(child.pid as number), 'SIGKILL');
          } catch {
            /* déjà arrêté */
          }
          r();
        }, 3000).unref();
      });
    };
    const onData = (b: Buffer) => {
      const text = b.toString();
      out.push(text);
      if (done) return;
      const m = opts.ready.exec(out.join(''));
      if (m) {
        done = true;
        clearTimeout(timer);
        resolvePromise({ name, child, out, url: m[1].replace(/\/+$/, ''), stop });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      void stop();
      reject(new Error(`${name} : pas prêt à temps\n${out.join('')}`));
    }, opts.timeoutMs ?? 30_000);
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`${name} : arrêt prématuré (code ${code})\n${out.join('')}`));
    });
  });
}

/** Prépare les données de test (zips de fixtures) dans un dossier neuf. */
export async function buildFixtureData(opts: { date?: string; sources?: string; out?: string } = {}): Promise<{ dir: string; result: RunResult }> {
  const dir = opts.out ?? mkdtempSync(join(tmpdir(), 'quai-e2e-data-'));
  const result = await run('npm', ['run', 'build-data', '--', '--out', dir], {
    cwd: PIPELINE,
    env: { QUAI_SOURCES: opts.sources ?? FIXTURE_SOURCES, QUAI_DATE: opts.date ?? '2026-11-10', BMC_KEY: '' },
  });
  if (result.code !== 0) throw new Error(`build-data en échec (${result.code})\n${result.stdout}\n${result.stderr}`);
  return { dir, result };
}

export const startDataServer = (dir: string) =>
  startServer('serve-data', 'npm', ['run', 'serve-data', '--', '--dir', dir, '--port', '0'], { cwd: PIPELINE, ready: /sur (http:\/\/[^\s]+)/ });

export const startMockBmc = (key = TEST_KEY) =>
  startServer('mock-bmc', 'npm', ['run', 'mock-bmc', '--', '--port', '0'], { cwd: RELAY, env: { MOCK_BMC_KEY: key }, ready: /prêt : (http:\/\/localhost:\d+)/ });

/** Faux service d'adresses (1.1) : imite les services des trois Régions (fixtures/relay/mock-geocode.ts). */
export const startMockGeocode = () =>
  startServer('mock-geocode', 'npm', ['run', 'mock-geocode', '--', '--port', '0'], { cwd: RELAY, ready: /\[faux adresses\] prêt : (http:\/\/localhost:\d+)/ });

/**
 * Relais local. Sans QUAI_GEO_BASE, `npm run dev` vise http://localhost:8790 : les adresses sont alors en panne
 * (personne n'écoute), ce qui convient aux suites qui ne s'en servent pas.
 */
export const startRelay = (env: { BMC_BASE: string; DATA_BASE?: string; BMC_KEY?: string; QUAI_NOW?: string; SNCB_RT_URL?: string; QUAI_GEO_BASE?: string; WEATHER_BASE?: string }) =>
  startServer('relay', 'npm', ['run', 'dev', '--', '--port', '0'], {
    cwd: RELAY,
    env: { BMC_KEY: TEST_KEY, QUAI_NOW: '2026-11-10T12:10:00+01:00', ...env },
    ready: /Relais Quai \(dev\) : (http:\/\/localhost:\d+)/,
  });

/**
 * 1.2.5 : faux Open-Meteo (GET /v1/forecast), dans ce processus. Grille du 10/11 : quarts d'heure de 07:15 à 13:00,
 * heures de 08:00 à 14:00 (fins de période, comme Open-Meteo) ; de la pluie (0,8 mm, 80 %) sur une seule case, celle de
 * Bruxelles et de Waterloo (rangée 5, colonne 7 ; 50,75° N, 4,30° E), entre 08:45 et 09:00 : la marche finale du
 * scénario 1 (Bourse vers le bureau, 08:49 → 08:58) se fait sous la pluie, rien d'autre. Aucune requête réelle.
 */
export const WEATHER_RAIN_CELL = 5 * 16 + 7;
export async function startMockWeather(): Promise<{ url: string; calls: string[]; close(): Promise<void> }> {
  const t0 = Date.parse('2026-11-10T07:15:00+01:00') / 1000;
  const h0 = Date.parse('2026-11-10T08:00:00+01:00') / 1000;
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url ?? '');
    const u = new URL(req.url ?? '/', 'http://x');
    const n = (u.searchParams.get('latitude') ?? '').split(',').filter(Boolean).length;
    if (u.pathname !== '/v1/forecast' || !n) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: true, reason: 'requête inattendue' }));
      return;
    }
    const body = Array.from({ length: n }, (_, i) => ({
      minutely_15: { time: Array.from({ length: 24 }, (_x, k) => t0 + k * 900), precipitation: Array.from({ length: 24 }, (_x, k) => (i === WEATHER_RAIN_CELL && k === 7 ? 0.8 : 0)) },
      hourly: { time: Array.from({ length: 7 }, (_x, h) => h0 + h * 3600), precipitation_probability: Array.from({ length: 7 }, (_x, h) => (i === WEATHER_RAIN_CELL && h === 1 ? 80 : 10)) },
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(n === 1 ? body[0] : body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Scènes du faux service d'adresses : base, down (HTTP 503), slow (réponse après 3 s), garbage (HTML en 200). */
export type GeoScene = 'base' | 'down' | 'slow' | 'garbage';

/** Requête reçue par le faux service d'adresses (GET /__journal). */
export interface GeoJournalEntry {
  at: string;
  source: 'vla' | 'bru' | 'wal' | null;
  method: string;
  path: string;
  params: Record<string, string>;
  headers: Record<string, string>;
}

export interface Stack {
  dataDir: string;
  data: Proc;
  bmc: Proc;
  /** Faux service d'adresses (le relais y est branché par QUAI_GEO_BASE). */
  geo: Proc;
  relay: Proc;
  /** 1.2.5 : faux Open-Meteo (le relais y est branché par WEATHER_BASE). */
  weather: { url: string; calls: string[] };
  /** Change la scène du faux portail et vide le cache du relais. */
  scene(s: 'base' | 'noRT'): Promise<void>;
  /** Change la scène du faux service d'adresses (`sources` : seulement ces services) et vide le cache du relais. */
  geoScene(s: GeoScene, sources?: ('vla' | 'bru' | 'wal')[]): Promise<void>;
  /** Requêtes reçues par le faux service d'adresses depuis le dernier geoJournalReset(). */
  geoJournal(): Promise<GeoJournalEntry[]>;
  geoJournalReset(): Promise<void>;
  stop(): Promise<void>;
  logs(): string;
}

export async function startStack(opts: { dataDir?: string; relayNow?: string } = {}): Promise<Stack> {
  const owned = !opts.dataDir;
  const dataDir = opts.dataDir ?? (await buildFixtureData()).dir;
  const [data, bmc, geo, weather] = await Promise.all([startDataServer(dataDir), startMockBmc(), startMockGeocode(), startMockWeather()]);
  const relay = await startRelay({ BMC_BASE: bmc.url, DATA_BASE: data.url, QUAI_GEO_BASE: geo.url, WEATHER_BASE: weather.url, ...(opts.relayNow ? { QUAI_NOW: opts.relayNow } : {}) });
  const post = async (url: string) => {
    const r = await fetch(url, { method: 'POST' });
    if (!r.ok) throw new Error(`POST ${url} : HTTP ${r.status}`);
  };
  return {
    dataDir,
    data,
    bmc,
    geo,
    relay,
    weather,
    async scene(s) {
      await post(`${bmc.url}/__scene/${s}`);
      await post(`${relay.url}/__cache/clear`);
    },
    async geoScene(s, sources) {
      await post(`${geo.url}/__scene/${s}${sources?.length ? `?sources=${sources.join(',')}` : ''}`);
      await post(`${relay.url}/__cache/clear`);
    },
    async geoJournal() {
      const r = await fetch(`${geo.url}/__journal`);
      if (!r.ok) throw new Error(`GET ${geo.url}/__journal : HTTP ${r.status}`);
      return ((await r.json()) as { requests: GeoJournalEntry[] }).requests;
    },
    async geoJournalReset() {
      await post(`${geo.url}/__journal/reset`);
    },
    async stop() {
      await Promise.all([relay.stop(), bmc.stop(), geo.stop(), data.stop(), weather.close()]);
      if (owned) rmSync(dataDir, { recursive: true, force: true });
    },
    logs: () => [data, bmc, geo, relay].map((p) => `--- ${p.name}\n${p.out.join('')}`).join('\n'),
  };
}

/** KV en mémoire (cache persistant du cœur). */
export function memoryKV(): { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v) };
}
