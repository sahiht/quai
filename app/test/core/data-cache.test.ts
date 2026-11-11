/**
 * Chargement des données et du temps réel : erreurs en français, nouvel essai, délai maximal,
 * caches mémoire et persistant (plafonné), cache temps réel de 20 s, lots de 60 voyages / 30 points, état.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCore } from '../../src/core/index';
import { PersistentCache } from '../../src/core/persist';
import { DATA_BASE, FakeServer, makeEnv, MemoryKV, RELAY_BASE } from './support/env';
import { at } from './support/network';

afterEach(() => {
  vi.useRealTimers();
});

describe('init et fichiers statiques', () => {
  it('meta.json absent : erreur lisible en français', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    env.server.overrides.set('/quai/data/meta.json', () => new Response('Not Found', { status: 404 }));
    // Le serveur répond sans le fichier : la publication est en cause (PRD M8.6).
    await expect(env.core.init()).rejects.toThrow('Données indisponibles\u00a0: vérifie la publication de cette nuit');
    await expect(env.core.init()).rejects.toMatchObject({ code: 'dataUnavailable' });
    await expect(env.core.board('stib:6357F')).rejects.toThrow('Données indisponibles');
    expect(env.core.meta).toBeNull();
  });

  it('meta.json invalide : même erreur', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    env.server.overrides.set('/quai/data/meta.json', () => new Response('{"v":2}', { status: 200 }));
    await expect(env.core.init()).rejects.toThrow('Données indisponibles');
  });

  it('un nouvel essai après une erreur serveur', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    let n = 0;
    env.server.overrides.set('/quai/data/meta.json', () => (++n === 1 ? new Response('oups', { status: 503 }) : new Response(JSON.stringify({ v: 1, generatedAt: 'g', timezone: 'Europe/Brussels', serviceDates: ['2026-11-10', '2026-11-11'], tile: { lat: 0.02, lon: 0.03 }, feeds: {} }), { status: 200 })));
    const meta = await env.core.init();
    expect(n).toBe(2);
    expect(meta.generatedAt).toBe('g');
    expect(env.core.meta?.generatedAt).toBe('g');
  });

  it('délai maximal de 10 s par essai, deux essais, puis erreur lisible', async () => {
    vi.useFakeTimers();
    const env = makeEnv({ now: '2026-11-10T12:10' });
    let calls = 0;
    env.server.overrides.set('/quai/data/meta.json', () => {
      calls++;
      return new Promise<Response>(() => undefined);
    });
    const p = env.core.init();
    // Serveur injoignable (délai dépassé) : « Horaires injoignables : nouvel essai dans 30 s » (PRD M8.6).
    const check = expect(p).rejects.toMatchObject({ code: 'dataUnreachable', message: 'Horaires injoignables\u00a0: nouvel essai dans 30\u00a0s' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
  });

  it('cache mémoire : un fichier n’est téléchargé qu’une fois ; tuile absente = aucune zone', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    await env.core.board('stib:6357F');
    await env.core.board('stib:6357F');
    await env.core.linesAt('stib:6357F');
    expect(env.server.count((u) => u.endsWith('/areas/stib/6357F.json'))).toBe(1);
    expect(await env.core.nearby(10, 10, 500)).toEqual([]);
  });

  it('cache persistant : sans réseau, une nouvelle instance relit meta et fichiers depuis le KV', async () => {
    const kv = new MemoryKV();
    const a = makeEnv({ now: '2026-11-10T12:10', kv });
    await a.core.board('stib:6357F', { limit: 2 });
    await a.core.search('Gand');
    await new Promise((r) => setTimeout(r, 0));
    const server = new FakeServer();
    server.networkDown = true;
    const b = makeEnv({ now: '2026-11-10T12:10', kv, server });
    const meta = await b.core.init();
    expect(meta.serviceDates).toEqual(['2026-11-10', '2026-11-11']);
    const board = await b.core.board('stib:6357F', { limit: 2 });
    expect(board.departures).toHaveLength(2);
    expect(board.rtErrors).toEqual(['stib']);
    expect((await b.core.search('Gand')).length).toBeGreaterThan(3);
    await expect(b.core.board('stib:6359')).rejects.toMatchObject({ code: 'dataUnreachable' });
  });

  it('cache persistant borné : emplacements fixes réutilisés, fichiers trop gros ignorés, nouvelle génération', async () => {
    const kv = new MemoryKV();
    const cache = new PersistentCache(kv, { slots: 6, slotChars: 1_000, maxSlotsPerFile: 2 });
    for (let i = 0; i < 10; i++) cache.put('g1', `areas/x/${i}.json`, String(i).repeat(1_500));
    cache.put('g1', 'trop-gros.json', 'y'.repeat(2_500));
    await cache.flush();
    const slotKeys = [...kv.map.keys()].filter((k) => k.includes('.slot.'));
    expect(slotKeys.length).toBeLessThanOrEqual(6);
    expect(kv.size()).toBeLessThan(6 * 1_000 + 1_000);
    expect(await cache.get('g1', 'areas/x/9.json')).toBe('9'.repeat(1_500));
    expect(await cache.get('g1', 'areas/x/7.json')).toBe('7'.repeat(1_500));
    expect(await cache.get('g1', 'areas/x/0.json')).toBeNull();
    expect(await cache.get('g1', 'trop-gros.json')).toBeNull();
    expect(await cache.get('g2', 'areas/x/9.json')).toBeNull();
    // une autre instance relit l'index enregistré
    const again = new PersistentCache(kv, { slots: 6, slotChars: 1_000, maxSlotsPerFile: 2 });
    expect(await again.get('g1', 'areas/x/8.json')).toBe('8'.repeat(1_500));
    // nouvelle génération : tout est invalidé, les mêmes clés sont réutilisées
    again.setGeneration('g2');
    again.put('g2', 'tiles/a.json', 'z'.repeat(500));
    await again.flush();
    expect(await again.get('g2', 'areas/x/8.json')).toBeNull();
    expect(await again.get('g2', 'tiles/a.json')).toBe('z'.repeat(500));
    expect([...kv.map.keys()].filter((k) => k.includes('.slot.')).length).toBeLessThanOrEqual(6);
  });

  it('cache persistant : un seul appel KV à la fois, délai maximal, chaîne vide = absent (SDK)', async () => {
    let active = 0;
    let peak = 0;
    const store = new Map<string, string>();
    const slowKv = {
      async get(k: string) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
        return store.get(k) ?? '';
      },
      async set(k: string, v: string) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        store.set(k, v);
        active--;
      },
    };
    const server = new FakeServer();
    const core = createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now: () => at('2026-11-10T12:10'), storage: slowKv, fetch: server.fetch });
    await core.nearby(50.86, 4.359, 500);
    await core.search('Gand');
    await new Promise((r) => setTimeout(r, 200));
    expect(peak).toBe(1);
    expect(store.size).toBeGreaterThan(2);

    vi.useFakeTimers();
    const hanging = { get: () => new Promise<string>(() => undefined), set: () => new Promise<void>(() => undefined) };
    const cache = new PersistentCache(hanging, { timeoutMs: 3_000 });
    const p = cache.get('g', 'tiles/x.json');
    await vi.advanceTimersByTimeAsync(3_001);
    expect(await p).toBeNull();
  });

  it('KV défaillant : ignoré (best effort)', async () => {
    const broken = { get: async () => { throw new Error('kv'); }, set: async () => { throw new Error('kv'); } };
    const server = new FakeServer();
    const core = createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now: () => at('2026-11-10T12:10'), storage: broken, fetch: server.fetch });
    expect((await core.board('stib:6357F', { limit: 1 })).departures).toHaveLength(1);
  });

  it('adresse de base avec « / » final acceptée', async () => {
    const server = new FakeServer();
    const core = createCore({ dataBase: `${DATA_BASE}/`, relayBase: `${RELAY_BASE}/`, now: () => at('2026-11-10T12:10'), storage: new MemoryKV(), fetch: server.fetch });
    expect((await core.board('sncb:8812005', { limit: 1 })).departures[0].rt).toBe(true);
    expect(server.calls.every((u) => !u.includes('//api') && !u.includes('data//'))).toBe(true);
  });
});

describe('temps réel : cache et lots', () => {
  it('cache de 20 s par voyage et par point', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    await env.core.board('sncb:8812005', { limit: 3 });
    await env.core.board('stib:6357F', { limit: 3 });
    env.clock.advance(19_000);
    await env.core.board('sncb:8812005', { limit: 3 });
    await env.core.board('stib:6357F', { limit: 3 });
    expect(env.server.count((u) => u.includes('/api/rt?'))).toBe(1);
    expect(env.server.count((u) => u.includes('/api/stib?'))).toBe(1);
    env.clock.advance(2_000);
    await env.core.board('sncb:8812005', { limit: 3 });
    await env.core.board('stib:6357F', { limit: 3 });
    expect(env.server.count((u) => u.includes('/api/rt?'))).toBe(2);
    expect(env.server.count((u) => u.includes('/api/stib?'))).toBe(2);
  });

  it('au plus 60 voyages par appel /api/rt et 30 points par appel /api/stib', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    const rt = (await import('../../src/core/realtime')).RealtimeClient;
    const { makeFetch } = await import('../../src/core/net');
    const client = new rt(RELAY_BASE, makeFetch(env.server.fetch), env.clock.now);
    const ids = Array.from({ length: 130 }, (_, i) => `t${i}`);
    const r = await client.trips('tec', [...ids, 'N5-0750']);
    expect(r.error).toBe(false);
    // comme le vrai relais : retard et heure estimée absolue (07:50 + 3 min le 2026-11-10)
    expect(r.map.get('N5-0750')?.u[0]).toEqual([1, 'N509aaa', 180, Math.round(at('2026-11-10T07:53') / 1000), 0]);
    expect(r.map.get('t3')).toBeNull();
    const calls = env.server.calls.filter((u) => u.includes('/api/rt?'));
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(new URL(c).searchParams.get('trips')?.split(',').length).toBeLessThanOrEqual(60);
    const pts = Array.from({ length: 65 }, (_, i) => String(9000 + i));
    const s = await client.stib([...pts, '6357F']);
    expect(s.map.get('6357')?.[0].line).toBe('3');
    expect(env.server.calls.filter((u) => u.includes('/api/stib?'))).toHaveLength(3);
  });

  it('identifiants de voyage avec caractères spéciaux encodés dans l’URL', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    await env.core.board('sncb:8863008', { limit: 1 });
    const call = env.server.calls.find((u) => u.includes('/api/rt?op=sncb'));
    expect(call).toContain('88____%3A007%3A%3A8863008');
  });

  it('health : réponse du relais ; relais injoignable : état synthétique', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    expect(await env.core.health()).toMatchObject({ ok: true, sources: { sncb: { ok: true } } });
    env.server.networkDown = true;
    const h = await env.core.health();
    expect(h.ok).toBe(false);
    expect(h.sources.stib).toEqual({ ok: false, error: 'Relais injoignable' });
    expect(h.time).toBe(new Date(at('2026-11-10T12:10')).toISOString());
  });
});
