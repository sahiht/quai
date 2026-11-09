/**
 * Outils de test : fetch simulé (sert les fixtures BMC en mémoire), contexte avec horloge fixe et journal capturé.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCaches, type Ctx } from '../lib/context.js';
import { createLogger } from '../lib/log.js';
import { encodeFeed } from '../lib/gtfsrt.js';
import type { Env } from '../lib/config.js';
import { wherePoints } from '../../fixtures/relay/mock-bmc.js';

export const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/relay/', import.meta.url));
/** Horodatage des fixtures : 2026-11-10T12:10:00+01:00. */
export const NOW_MS = Date.parse('2026-11-10T12:10:00+01:00');
export const TEST_KEY = 'test-key-5f1c2b9d';
export const BMC = 'https://bmc.test';

export const sec = (iso: string) => Math.round(Date.parse(iso) / 1000);
export const fixture = (path: string) => readFileSync(FIXTURES_DIR + path);

export interface Call { url: string; headers: Record<string, string>; redirect?: RequestInit['redirect'] }
export type Route = (url: URL, call: Call) => Response | Promise<Response>;

const abortable = (signal: AbortSignal | null | undefined) =>
  new Promise<never>((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

/** fetch simulé : enregistre les appels et respecte le signal d'abandon (délais). */
export function fakeFetch(route: Route) {
  const calls: Call[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), redirect: init?.redirect };
    calls.push(call);
    return Promise.race([Promise.resolve().then(() => route(new URL(url), call)), abortable(init?.signal)]);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export const protobuf = (data: Uint8Array) => new Response(data, { headers: { 'Content-Type': 'application/x-protobuf' } });
export const jsonBody = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
/** Une réponse qui n'arrive jamais (pour tester les délais). */
export const never = () => new Promise<Response>(() => undefined);

/** Faux portail BMC en mémoire, mêmes règles que fixtures/relay/mock-bmc.ts. */
export function bmcRoute(opts: { key?: string } = {}): Route {
  return (url, call) => {
    if (url.pathname.endsWith('/sncb-direct/trip-update')) return protobuf(fixture('sncb-direct/trip-update.pb'));
    const k1 = call.headers['bmc-partner-key'];
    const k2 = call.headers['ocp-apim-subscription-key'];
    if (!k1 || !k2 || (opts.key && (k1 !== opts.key || k2 !== opts.key))) return jsonBody({ statusCode: 401 }, 401);
    const rt = /^\/api\/gtfs\/feed\/(nmbssncb|delijn|tec)\/rt\/(trip-update|alert)$/.exec(url.pathname);
    if (rt) return protobuf(fixture(`bmc/${rt[1]}/${rt[2]}.pb`));
    if (url.pathname === '/api/datasets/stibmivb/rt/WaitingTimes') {
      const all = (JSON.parse(fixture('bmc/stibmivb/waiting-times.json').toString('utf8')) as { results: Record<string, unknown>[] }).results;
      const where = url.searchParams.get('where');
      const ids = where ? wherePoints(where) : null;
      const rows = ids ? all.filter((r) => ids.has(String(r.pointid))) : all;
      const limit = Number(url.searchParams.get('limit') ?? 10);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return jsonBody({ total_count: rows.length, results: rows.slice(offset, offset + limit) });
    }
    if (url.pathname.endsWith('/meta.json')) return jsonBody({ error: 'absent' }, 404);
    return jsonBody({ statusCode: 404 }, 404);
  };
}

/** Route qui sert un flux GTFS-RT construit dans le test (objet protobufjs). */
export const feedRoute = (feed: Record<string, unknown>): Route => () => protobuf(encodeFeed(feed));

export interface TestCtx { ctx: Ctx; logs: string[]; calls: Call[]; advance(ms: number): void; setNow(ms: number): void }

export function makeCtx(opts: { env?: Env; route?: Route; now?: number; timeouts?: Partial<Ctx['timeouts']> } = {}): TestCtx {
  const logs: string[] = [];
  const sink = { log: (m: string) => void logs.push(m), warn: (m: string) => void logs.push(m), error: (m: string) => void logs.push(m) };
  const env: Env = { BMC_KEY: TEST_KEY, BMC_BASE: BMC, ...opts.env };
  const { fetch, calls } = fakeFetch(opts.route ?? bmcRoute());
  let now = opts.now ?? NOW_MS;
  const ctx: Ctx = {
    env,
    fetch,
    now: () => now,
    log: createLogger(env, sink),
    caches: createCaches(),
    timeouts: { upstream: 8000, health: 3000, ...opts.timeouts },
  };
  return { ctx, logs, calls, advance: (ms) => void (now += ms), setNow: (ms) => void (now = ms) };
}

export interface Result<T = Record<string, unknown>> { status: number; headers: Headers; text: string; body: T }

/** Appelle un gestionnaire comme le ferait Vercel et lit la réponse. */
export async function call<T = Record<string, unknown>>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
  path: string,
  ctx: Ctx,
  sink?: Result<unknown>[],
): Promise<Result<T>> {
  const res = await handler(new Request(`https://relay.test${path}`), ctx);
  const text = await res.text();
  const out: Result<T> = { status: res.status, headers: res.headers, text, body: (text ? JSON.parse(text) : null) as T };
  sink?.push(out as Result<unknown>);
  return out;
}

/** Un en-tête GTFS-RT minimal. */
export const header = (extra: Record<string, unknown> = {}) => ({ gtfsRealtimeVersion: '2.0', incrementality: 'FULL_DATASET', timestamp: 1794309000, ...extra });
