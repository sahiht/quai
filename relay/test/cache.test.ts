import { describe, expect, it, vi } from 'vitest';
import { BatchCache, TtlCache } from '../lib/cache.js';
import { handleAlerts, handleRt } from '../lib/handlers.js';
import type { RtResponse } from '../lib/shared/types.js';
import { NOW_MS, bmcRoute, call, makeCtx, type Route } from './helpers.js';

const S1 = '88____:046::8812005:8883006:4:1315:20261231';

describe('TtlCache', () => {
  it('sert la valeur pendant 25 s puis recharge, en passant la valeur précédente', async () => {
    let now = 0;
    const cache = new TtlCache<number>(25_000);
    const load = vi.fn(async (prev: number | undefined) => (prev ?? 0) + 1);
    expect((await cache.get('k', () => now, load)).value).toBe(1);
    now = 24_999;
    expect((await cache.get('k', () => now, load)).value).toBe(1);
    now = 25_000;
    expect((await cache.get('k', () => now, load)).value).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(1);
  });

  it('requêtes simultanées : un seul chargement partagé', async () => {
    const cache = new TtlCache<string>(25_000);
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const all = Promise.all([1, 2, 3, 4, 5].map(() => cache.get('k', () => 0, load)));
    resolve('v');
    expect((await all).map((e) => e.value)).toEqual(['v', 'v', 'v', 'v', 'v']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('les échecs ne sont pas mis en cache et sont partagés par les requêtes simultanées', async () => {
    const cache = new TtlCache<string>(25_000);
    const load = vi.fn().mockRejectedValueOnce(new Error('panne')).mockResolvedValueOnce('ok');
    const results = await Promise.allSettled([cache.get('k', () => 0, load), cache.get('k', () => 0, load)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect((await cache.get('k', () => 0, load)).value).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('une horloge qui recule invalide l’entrée', async () => {
    let now = 10_000;
    const cache = new TtlCache<number>(25_000);
    const load = vi.fn(async () => now);
    await cache.get('k', () => now, load);
    now = 5_000;
    await cache.get('k', () => now, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('BatchCache', () => {
  it('ne charge que les clés manquantes et partage les chargements en cours', async () => {
    const cache = new BatchCache<string>(25_000);
    const load = vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, `v${k}`])));
    const [a, b] = await Promise.all([cache.getMany(['1', '2'], () => 0, load), cache.getMany(['2', '3'], () => 0, load)]);
    expect([...a.values]).toEqual([['1', 'v1'], ['2', 'v2']]);
    expect([...b.values]).toEqual([['2', 'v2'], ['3', 'v3']]);
    expect(load.mock.calls).toEqual([[['1', '2']], [['3']]]);
  });

  it('`at` est la date de la plus ancienne valeur ; les entrées périmées sont rechargées', async () => {
    let now = 1000;
    const cache = new BatchCache<number>(25_000);
    const load = vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, now])));
    await cache.getMany(['a'], () => now, load);
    now = 11_000;
    const r = await cache.getMany(['a', 'b'], () => now, load);
    expect(r.at).toBe(1000);
    now = 26_000;
    await cache.getMany(['a', 'b'], () => now, load);
    expect(load.mock.calls.map((c) => c[0])).toEqual([['a'], ['b'], ['a']]);
  });

  it('limite le nombre d’entrées gardées', async () => {
    const cache = new BatchCache<number>(25_000, 10);
    const load = async (keys: string[]) => new Map(keys.map((k) => [k, 1]));
    for (let i = 0; i < 5; i++) await cache.getMany(Array.from({ length: 5 }, (_, j) => `${i}-${j}`), () => 0, load);
    const loadSpy = vi.fn(load);
    await cache.getMany(['4-4', '0-0'], () => 0, loadSpy);
    expect(loadSpy.mock.calls).toEqual([[['0-0']]]);
  });
});

describe('cache des points d’entrée', () => {
  it('/api/rt : un flux par opérateur, 25 s, requêtes simultanées dédoublonnées', async () => {
    const t = makeCtx();
    await Promise.all([1, 2, 3, 4, 5].map(() => call(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx)));
    expect(t.calls).toHaveLength(1);
    t.advance(24_000);
    const cached = await call<RtResponse>(handleRt, `/api/rt?op=sncb&trips=${S1},autre`, t.ctx);
    expect(t.calls).toHaveLength(1);
    expect(cached.body.fetchedAt).toBe(new Date(NOW_MS).toISOString());
    await call(handleRt, '/api/rt?op=delijn&trips=702321245', t.ctx);
    expect(t.calls).toHaveLength(2);
    t.advance(1_000);
    const fresh = await call<RtResponse>(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx);
    expect(t.calls).toHaveLength(3);
    expect(fresh.body.fetchedAt).toBe(new Date(NOW_MS + 25_000).toISOString());
  });

  it('/api/alerts : cache séparé du flux des voyages, filtre appliqué à chaque requête', async () => {
    const urls: string[] = [];
    const bmc = bmcRoute();
    const route: Route = (u, c) => {
      urls.push(u.pathname);
      return bmc(u, c);
    };
    const t = makeCtx({ route });
    await call(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx);
    const a = await call<{ alerts: unknown[] }>(handleAlerts, '/api/alerts?op=sncb&stops=8811601', t.ctx);
    const b = await call<{ alerts: unknown[] }>(handleAlerts, '/api/alerts?op=sncb&stops=8812005', t.ctx);
    expect(a.body.alerts).toHaveLength(1);
    expect(b.body.alerts).toHaveLength(0);
    expect(urls).toEqual(['/api/gtfs/feed/nmbssncb/rt/trip-update', '/api/gtfs/feed/nmbssncb/rt/alert']);
  });
});
