/**
 * Environnement de test du cœur : faux serveur de données (lit un dossier comme GitHub Pages),
 * faux relais (réponses de app/test/fixtures/core/relay, scènes « base » et « noRT »), KV en mémoire,
 * horloge réglable. Aucune requête réseau réelle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCore } from '../../../src/core/index';
import type { Core, KV, Settings } from '../../../src/core/api';
import type { RelayFixtures } from './gen-fixtures';
import { at, CORE_DATA_DIR, CORE_RELAY_DIR, loadPreset, readJson } from './network';

export const DATA_BASE = 'https://data.test/quai/data';
export const RELAY_BASE = 'https://relay.test';

export type Scene = 'base' | 'noRT';

export class MemoryKV implements KV {
  readonly map = new Map<string, string>();
  gets = 0;
  sets = 0;
  async get(key: string): Promise<string | null> {
    this.gets++;
    return this.map.has(key) ? (this.map.get(key) ?? null) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.sets++;
    this.map.set(key, value);
  }
  size(): number {
    let n = 0;
    for (const v of this.map.values()) n += v.length;
    return n;
  }
}

export function loadRelayFixtures(dir = CORE_RELAY_DIR): RelayFixtures {
  const r = (f: string) => readJson<never>(join(dir, f));
  return {
    rt: { sncb: r('rt-sncb.json'), delijn: r('rt-delijn.json'), tec: r('rt-tec.json') },
    stib: r('stib.json'),
    alerts: { sncb: r('alerts-sncb.json'), delijn: r('alerts-delijn.json'), tec: r('alerts-tec.json') },
    health: r('health.json'),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

export class FakeServer {
  scene: Scene = 'base';
  /** Sources du relais en erreur (HTTP 200 + error, comme le relais). */
  readonly failing = new Set<string>();
  /** Plus aucun réseau (fetch rejette). */
  networkDown = false;
  /** Réponses figées par chemin (prioritaires). */
  readonly overrides = new Map<string, (url: URL) => Response | Promise<Response>>();
  readonly calls: string[] = [];
  /** Contenus en mémoire (prioritaires sur le dossier). */
  readonly memFiles = new Map<string, string>();
  readonly relay: RelayFixtures;

  constructor(
    readonly dataDir: string = CORE_DATA_DIR,
    relay: RelayFixtures = loadRelayFixtures(),
  ) {
    this.relay = structuredClone(relay);
  }

  count(pred: (url: string) => boolean): number {
    return this.calls.filter(pred).length;
  }

  readonly fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    this.calls.push(href);
    if (this.networkDown) throw new TypeError('Failed to fetch');
    const url = new URL(href);
    const o = this.overrides.get(url.pathname);
    if (o) return o(url);
    if (href.startsWith(`${DATA_BASE}/`)) return this.data(href.slice(DATA_BASE.length + 1));
    if (href.startsWith(`${RELAY_BASE}/`)) return this.relayResponse(url);
    return new Response('not found', { status: 404 });
  };

  private data(path: string): Response {
    const mem = this.memFiles.get(path);
    if (mem !== undefined) return new Response(mem, { status: 200 });
    const file = join(this.dataDir, path);
    if (path.includes('..') || !existsSync(file)) return new Response('Not Found', { status: 404 });
    return new Response(readFileSync(file, 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  private down(op: string): boolean {
    return this.scene === 'noRT' || this.failing.has(op);
  }

  private relayResponse(url: URL): Response {
    const q = url.searchParams;
    const fetchedAt = this.relay.stib.fetchedAt;
    switch (url.pathname) {
      case '/api/rt': {
        const op = q.get('op') as 'sncb' | 'delijn' | 'tec' | null;
        if (!op || !(op in this.relay.rt)) return json({ error: 'paramètre op invalide' }, 400);
        const ids = (q.get('trips') ?? '').split(',').filter(Boolean);
        if (ids.length > 60) return json({ error: 'trop de voyages' }, 400);
        if (this.down(op)) return json({ op, fetchedAt, trips: {}, error: 'Source indisponible' });
        const all = this.relay.rt[op].trips;
        const trips: Record<string, unknown> = {};
        for (const id of ids) if (all[id]) trips[id] = all[id];
        return json({ ...this.relay.rt[op], trips });
      }
      case '/api/stib': {
        const pts = (q.get('points') ?? '').split(',').filter(Boolean);
        if (pts.length > 30) return json({ error: 'trop de points' }, 400);
        if (this.down('stib')) return json({ fetchedAt, points: {}, error: 'Source indisponible' });
        const points: Record<string, unknown> = {};
        for (const p of pts) if (this.relay.stib.points[p]) points[p] = this.relay.stib.points[p];
        return json({ fetchedAt, points });
      }
      case '/api/alerts': {
        const op = q.get('op') as 'sncb' | 'delijn' | 'tec' | null;
        if (!op || !(op in this.relay.alerts)) return json({ error: 'paramètre op invalide' }, 400);
        if (this.down(op)) return json({ op, fetchedAt, alerts: [], error: 'Source indisponible' });
        const routes = (q.get('routes') ?? '').split(',').filter(Boolean);
        const stops = (q.get('stops') ?? '').split(',').filter(Boolean);
        const alerts = this.relay.alerts[op].alerts.filter(
          (a) => (!routes.length && !stops.length) || a.routes.some((r) => routes.includes(r)) || a.stops.some((s) => stops.includes(s)),
        );
        return json({ op, fetchedAt, alerts });
      }
      case '/api/health':
        return json(this.relay.health);
      default:
        return json({ error: 'inconnu' }, 404);
    }
  }
}

export class Clock {
  t: number;
  constructor(start: number | string) {
    this.t = typeof start === 'number' ? start : at(start);
  }
  readonly now = () => this.t;
  set(t: number | string): void {
    this.t = typeof t === 'number' ? t : at(t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export interface TestEnv {
  core: Core;
  server: FakeServer;
  kv: MemoryKV;
  clock: Clock;
  preset: Settings;
}

export function makeEnv(opts: { now: number | string; scene?: Scene; dataDir?: string; relay?: RelayFixtures; kv?: MemoryKV; server?: FakeServer }): TestEnv {
  const server = opts.server ?? new FakeServer(opts.dataDir ?? CORE_DATA_DIR, opts.relay ?? loadRelayFixtures());
  server.scene = opts.scene ?? 'base';
  const kv = opts.kv ?? new MemoryKV();
  const clock = new Clock(opts.now);
  const core = createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now: clock.now, storage: kv, fetch: server.fetch });
  return { core, server, kv, clock, preset: loadPreset() };
}
