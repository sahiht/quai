import { describe, expect, it } from 'vitest';
import { handleHealth } from '../lib/handlers.js';
import type { HealthResponse, Meta } from '../lib/shared/types.js';
import { BMC, NOW_MS, TEST_KEY, bmcRoute, call, jsonBody, makeCtx, never, type Route } from './helpers.js';

const health = (t = makeCtx()) => call<HealthResponse>(handleHealth, '/api/health', t.ctx);
const DATA = 'https://data.test/quai/data';
const feeds = (ok = true): Meta['feeds'] => ({
  sncb: { ok, areas: 14, trips: 11 }, stib: { ok: true, areas: 9, trips: 900 },
  delijn: { ok: true, areas: 7, trips: 300 }, tec: { ok: true, areas: 6, trips: 120 },
});
const meta = (generatedAt: string, ok = true): Meta => ({
  v: 1, generatedAt, timezone: 'Europe/Brussels', serviceDates: ['2026-11-10', '2026-11-11'], tile: { lat: 0.02, lon: 0.03 }, feeds: feeds(ok),
});
const withMeta = (body: unknown, status = 200): Route => {
  const bmc = bmcRoute();
  return (url, c) => (url.href === `${DATA}/meta.json` ? jsonBody(body, status) : bmc(url, c));
};

describe('/api/health', () => {
  it('toutes les sources joignables : ok, durées en ms, pas de bloc data sans DATA_BASE', async () => {
    const t = makeCtx();
    const r = await health(t);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.time).toBe(new Date(NOW_MS).toISOString());
    expect(r.body).not.toHaveProperty('data');
    for (const op of ['sncb', 'delijn', 'tec', 'stib'] as const) {
      expect(r.body.sources[op].ok).toBe(true);
      expect(typeof r.body.sources[op].ms).toBe('number');
    }
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=20, stale-while-revalidate=40');
    expect(t.calls.map((c) => c.url).sort()).toEqual([
      `${BMC}/api/datasets/stibmivb/rt/WaitingTimes?limit=1`,
      `${BMC}/api/gtfs/feed/delijn/rt/trip-update?format=protobuf`,
      `${BMC}/api/gtfs/feed/nmbssncb/rt/trip-update?format=protobuf`,
      `${BMC}/api/gtfs/feed/tec/rt/trip-update?format=protobuf`,
    ]);
    expect(t.calls.every((c) => c.headers['bmc-partner-key'] === TEST_KEY && c.headers['ocp-apim-subscription-key'] === TEST_KEY)).toBe(true);
  });

  it('lit meta.json de DATA_BASE : dernière génération de nuit et état des flux', async () => {
    const m = meta('2026-11-10T02:21:00+01:00');
    const r = await health(makeCtx({ env: { DATA_BASE: `${DATA}/` }, route: withMeta(m) }));
    expect(r.body.data).toEqual({ generatedAt: m.generatedAt, ok: true, feeds: m.feeds });
    expect(r.body.ok).toBe(true);
    expect(Object.keys(r.body)).toEqual(['ok', 'time', 'data', 'sources']);
  });

  it('données de nuit en échec, trop anciennes ou absentes : data.ok = false', async () => {
    const failed = await health(makeCtx({ env: { DATA_BASE: DATA }, route: withMeta(meta('2026-11-10T02:21:00+01:00', false)) }));
    expect(failed.body.data?.ok).toBe(false);
    expect(failed.body.ok).toBe(false);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    const t = makeCtx({ env: { DATA_BASE: DATA }, route: withMeta(meta('2026-11-07T02:21:00+01:00')) });
    const old = await health(t);
    expect(old.body.data).toMatchObject({ generatedAt: '2026-11-07T02:21:00+01:00', ok: false });
    expect(t.logs.join('\n')).toContain('données de nuit de plus de 48 h');
    const missing = await health(makeCtx({ env: { DATA_BASE: DATA }, route: withMeta({ error: 'absent' }, 404) }));
    expect(missing.body.data).toEqual({ generatedAt: '', ok: false });
    const junk = await health(makeCtx({ env: { DATA_BASE: DATA }, route: withMeta({ v: 1 }) }));
    expect(junk.body.data).toEqual({ generatedAt: '', ok: false });
  });

  it('une source en erreur ou trop lente : ok = false, message en français', async () => {
    const bmc = bmcRoute();
    const route: Route = (url, c) => {
      if (url.pathname.includes('/delijn/')) return jsonBody({ statusCode: 503 }, 503);
      if (url.pathname.includes('/tec/')) return never();
      if (url.pathname.includes('WaitingTimes')) return jsonBody({ statusCode: 401 }, 401);
      return bmc(url, c);
    };
    const r = await health(makeCtx({ route, timeouts: { health: 50 } }));
    expect(r.body.ok).toBe(false);
    expect(r.body.sources.sncb.ok).toBe(true);
    expect(r.body.sources.delijn).toEqual({ ok: false, error: 'Réponse HTTP 503 du portail' });
    expect(r.body.sources.tec).toEqual({ ok: false, error: 'Délai dépassé (0,05 s)' });
    expect(r.body.sources.stib).toEqual({ ok: false, error: 'Clé refusée par le portail (HTTP 401)' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('clé absente : sources BMC en erreur sans requête, une ligne de journal claire', async () => {
    const t = makeCtx({ env: { BMC_KEY: undefined } });
    const r = await health(t);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    for (const op of ['sncb', 'delijn', 'tec', 'stib'] as const) {
      expect(r.body.sources[op]).toEqual({ ok: false, error: 'Clé BMC_KEY absente sur le relais' });
    }
    expect(t.calls).toHaveLength(0);
    expect(t.logs.filter((l) => l.includes('BMC_KEY manquante'))).toHaveLength(1);
  });

  it('SNCB_RT_URL : la sonde SNCB vise le flux direct, sans clé BMC, et l’adresse ne fuit pas', async () => {
    const direct = 'https://sncb.test/sncb-direct/trip-update?token=jeton-secret-123';
    const t = makeCtx({ env: { SNCB_RT_URL: direct } });
    const r = await health(t);
    const sncbCall = t.calls.find((c) => c.url === direct);
    expect(sncbCall).toBeDefined();
    expect(sncbCall!.headers).not.toHaveProperty('bmc-partner-key');
    expect(r.body.sources.sncb.ok).toBe(true);
    expect(r.text).not.toContain('jeton-secret-123');
    expect(r.text).not.toContain('sncb.test');
  });
});
