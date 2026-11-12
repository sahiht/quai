/**
 * Chargement des données et du temps réel : erreurs en français, nouvel essai, délai maximal,
 * caches mémoire et persistant (plafonné), cache temps réel de 20 s, lots de 60 voyages / 30 points, état.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataClient, MEM_BUDGET_CHARS } from '../../src/core/data';
import { createCore } from '../../src/core/index';
import { FLUSH_DELAY_MS, PersistentCache } from '../../src/core/persist';
import { DATA_BASE, FakeServer, makeEnv, MemoryKV, RELAY_BASE } from './support/env';
import { buildDataFiles } from './support/gen-fixtures';
import { at } from './support/network';
import { at as endpoint, legsOf, network, SETTINGS, type MiniNet } from './routing/support';
import { hhmm } from '../../src/core/util';
import { MESSAGES } from '../../src/core/errors';
import { FULL_PX } from '../../src/glasses/format';
import { textWidth } from '../../src/glasses/font';

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
    // Serveur injoignable (délai dépassé) : « Pas de connexion aux horaires : nouvel essai dans 30 s » (PRD M8.6,
    // 1.2.2 revue d'usage n° 10).
    const check = expect(p).rejects.toMatchObject({ code: 'dataUnreachable', message: 'Pas de connexion aux horaires\u00a0: nouvel essai dans 30\u00a0s' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
  });

  it('nouvelle publication : meta.json relue (sans cache) après 10 min, avant route() et board() ; jamais deux générations mélangées', async () => {
    // deux publications du même réseau : la seconde couvre le 11/11 (service des jours fériés, départs à :10 et :40)
    const bus = (id: string, short: string) => ({ id, short, long: short, type: 3 });
    const mini: MiniNet = {
      tec: {
        stops: [
          { id: 'A1', name: 'Alpha', lat: 50.8, lon: 4.3 },
          { id: 'B1', name: 'Beta', lat: 50.8, lon: 4.4 },
        ],
        routes: [bus('L1', '1')],
        templates: [
          { idTpl: 'W-{HHMM}', route: 'L1', service: 'WEEK', head: 'Beta', stops: [['A1', 0], ['B1', 20]], from: '06:00', to: '23:30', every: 30 },
          { idTpl: 'H-{HHMM}', route: 'L1', service: 'HOLI', head: 'Beta', stops: [['A1', 0], ['B1', 20]], from: '06:10', to: '23:40', every: 30 },
        ],
      },
    };
    const publication = (dates: string[], gen: string) => {
      const net = network(mini);
      net.serviceDates = dates;
      const f = buildDataFiles(net) as Record<string, { generatedAt?: string }>;
      f['meta.json'].generatedAt = gen;
      if (f['lines/index.json']) f['lines/index.json'].generatedAt = gen;
      return f;
    };
    const server = new FakeServer('/nonexistent');
    const publish = (f: Record<string, unknown>) => {
      server.memFiles.clear();
      for (const [p, b] of Object.entries(f)) server.memFiles.set(p, JSON.stringify(b));
    };
    publish(publication(['2026-11-09', '2026-11-10'], 'G1'));
    const env = makeEnv({ now: '2026-11-10T21:00', scene: 'noRT', server });
    await env.core.init();
    const A = endpoint({ lat: 50.8003, lon: 4.3 });
    const B = endpoint({ lat: 50.8003, lon: 4.4 });
    expect((await env.core.route(A, B, at('2026-11-10T21:00'), SETTINGS)).journeys.length).toBeGreaterThan(0);
    await env.core.board('tec:A1');
    const metaCalls = () => server.count((u) => u.endsWith('/meta.json'));
    expect(metaCalls()).toBe(1);
    // publication de la nuit : rien ne change avant 10 min
    publish(publication(['2026-11-10', '2026-11-11'], 'G2'));
    env.clock.set('2026-11-10T21:09');
    await env.core.board('tec:A1');
    expect(metaCalls()).toBe(1);
    expect(env.core.meta?.generatedAt).toBe('G1');
    // après 10 min : relue avant route(), toute la publication G2 (comme une nouvelle session)
    env.clock.set('2026-11-10T21:40');
    const after = await env.core.route(A, B, at('2026-11-10T21:40'), SETTINGS);
    expect(metaCalls()).toBe(2);
    expect(env.core.meta?.generatedAt).toBe('G2');
    const fresh = makeEnv({ now: '2026-11-10T21:40', scene: 'noRT', server });
    await fresh.core.init();
    expect(after.journeys.map(legsOf)).toEqual((await fresh.core.route(A, B, at('2026-11-10T21:40'), SETTINGS)).journeys.map(legsOf));
    // board() : zone relue pour G2 (cache mémoire vidé), dates de G2 (le 11/11, premier départ à 06:10)
    const board = await env.core.board('tec:A1', { limit: 8 });
    expect(server.count((u) => u.endsWith('/areas/tec/A1.json'))).toBe(2); // une fois par génération
    expect(board.departures.some((d) => hhmm(d.sched) === '06:10')).toBe(true);
    // relecture en échec : la meta connue reste
    env.clock.set('2026-11-10T21:55');
    server.networkDown = true;
    await expect(env.core.board('tec:A1')).resolves.toBeTruthy();
    expect(env.core.meta?.generatedAt).toBe('G2');
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
    vi.useFakeTimers();
    const kv = new MemoryKV();
    const a = makeEnv({ now: '2026-11-10T12:10', kv });
    await a.core.board('stib:6357F', { limit: 2 });
    await a.core.search('Gand');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100); // écritures groupées
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

  it('cache persistant : budget en caractères, petits fichiers groupés par clé, éviction des moins lus, épinglés en dernier', async () => {
    const kv = new MemoryKV();
    let t = at('2026-11-10T08:00');
    const opts = { budgetChars: 10_000, packChars: 2_000, flushDelayMs: 10, now: () => t, pinned: (p: string) => p.startsWith('tiles/') };
    const cache = new PersistentCache(kv, opts);
    // 20 tuiles de 200 caractères : 3 paquets, pas 20 clés
    for (let i = 0; i < 20; i++) cache.put('g1', `tiles/${i}.json`, String(i % 10).repeat(200));
    await cache.flush();
    const packKeys = () => [...kv.map.keys()].filter((k) => k.startsWith('quai.core.v2.p.') && kv.map.get(k));
    expect(packKeys().length).toBe(3);
    expect(await cache.get('g1', 'tiles/7.json')).toBe('7'.repeat(200));
    // un gros fichier sur plusieurs paquets ; trop gros pour le budget : ignoré
    cache.put('g1', 'trains/2026-11-10.json', 't'.repeat(4_500));
    cache.put('g1', 'trop-gros.json', 'y'.repeat(6_000));
    await cache.flush();
    expect(await cache.get('g1', 'trains/2026-11-10.json')).toBe('t'.repeat(4_500));
    expect(await cache.get('g1', 'trop-gros.json')).toBeNull();
    // au-delà du budget, un fichier lu ou écrit depuis moins de 10 min n'est pas évincé pour un fichier ordinaire :
    // le nouveau venu est abandonné (à l'ouverture, les premiers favoris calculés gardent leurs fichiers)
    t += 60_000;
    cache.put('g1', 'lines/stib/x.json', 'x'.repeat(1_900));
    await cache.flush();
    expect(await cache.get('g1', 'lines/stib/x.json')).toBeNull();
    expect(await cache.get('g1', 'trains/2026-11-10.json')).toBe('t'.repeat(4_500));
    // 11 min plus tard : les paquets ordinaires les moins récemment lus partent d'abord ; jamais les épinglés pour un
    // fichier ordinaire : les fichiers de ligne qui ne tiennent plus sont abandonnés, sans rien évincer
    t += 11 * 60_000;
    for (let i = 0; i < 4; i++) cache.put('g1', `lines/stib/${i}.json`, 'l'.repeat(1_900));
    await cache.flush();
    // place réellement occupée : clés libérées réutilisées ou vidées
    const packChars = [...kv.map.entries()].filter(([k]) => k.startsWith('quai.core.v2.p.')).reduce((n, [, v]) => n + v.length, 0);
    expect(packChars).toBeLessThanOrEqual(10_000);
    expect(await cache.get('g1', 'tiles/3.json')).toBe('3'.repeat(200)); // épinglé : gardé
    expect(await cache.get('g1', 'lines/stib/0.json')).toBe('l'.repeat(1_900));
    expect(await cache.get('g1', 'lines/stib/1.json')).toBe('l'.repeat(1_900));
    expect(await cache.get('g1', 'lines/stib/3.json')).toBeNull();
    expect(await cache.get('g1', 'trains/2026-11-10.json')).toBeNull(); // le moins récemment lu, évincé
    // fichier absent (404) : noté dans l'index, sans paquet
    const before = packKeys().length;
    cache.markAbsent('g1', 'tiles/vide.json');
    await cache.flush();
    expect(await cache.absent('g1', 'tiles/vide.json')).toBe(true);
    expect(packKeys().length).toBe(before);
    // une autre instance relit l'index enregistré
    const again = new PersistentCache(kv, opts);
    expect(await again.get('g1', 'tiles/12.json')).toBe('2'.repeat(200));
    expect(await again.get('g2', 'tiles/12.json')).toBeNull();
    // nouvelle génération : tout est invalidé, les clés des paquets sont réutilisées
    again.setGeneration('g2');
    again.put('g2', 'tiles/a.json', 'z'.repeat(500));
    await again.flush();
    expect(await again.get('g2', 'tiles/12.json')).toBeNull();
    expect(await again.get('g2', 'tiles/a.json')).toBe('z'.repeat(500));
    expect(await again.absent('g2', 'tiles/vide.json')).toBe(false);
    expect(packKeys().length).toBeLessThanOrEqual(before);
  });

  it('cache persistant : écritures groupées et limitées par rafale ; anciennes clés (version 1) effacées', async () => {
    const kv = new MemoryKV();
    kv.map.set('quai.core.v1.idx', JSON.stringify({ gen: 'g0', items: [{ path: 'x', slots: [0, 1], len: 3 }] }));
    kv.map.set('quai.core.v1.slot.0', 'a'.repeat(100));
    kv.map.set('quai.core.v1.slot.1', 'b'.repeat(100));
    const sets: string[] = [];
    const spy = { get: (k: string) => kv.get(k), set: (k: string, v: string) => (sets.push(k), kv.set(k, v)) };
    const cache = new PersistentCache(spy, { budgetChars: 1_000_000, packChars: 2_000, flushDelayMs: 10, maxWritesPerFlush: 5 });
    for (let i = 0; i < 30; i++) cache.put('g1', `lines/tec/${i}.json`, 'x'.repeat(900));
    await cache.flush();
    expect(kv.map.get('quai.core.v1.slot.0')).toBe('');
    expect(kv.map.get('quai.core.v1.idx')).toBe('');
    // 30 fichiers de 900 caractères : 2 par paquet, au plus 5 paquets par rafale, l'index une fois à la fin de chaque rafale
    const packs = sets.filter((k) => k.startsWith('quai.core.v2.p.'));
    expect(packs.length).toBeLessThanOrEqual(16);
    const bursts = sets.join(' ').split('quai.core.v2.idx').map((b) => b.split(' ').filter((k) => k.startsWith('quai.core.v2.p.')).length);
    expect(Math.max(...bursts)).toBeLessThanOrEqual(5);
    expect(sets.filter((k) => k === 'quai.core.v2.idx').length).toBeLessThanOrEqual(5);
    expect(await cache.get('g1', 'lines/tec/29.json')).toBe('x'.repeat(900));
    expect(await cache.get('g1', 'lines/tec/0.json')).toBe('x'.repeat(900));
  });

  it('cache persistant : un trajet réel (100 fichiers, 3 millions de caractères) se relit d’une autre instance, en peu d’écritures', async () => {
    // comme Maison → Bureau à 07:31 sur les données réelles (revue du 11/11) : trains du jour 1,65 million de
    // caractères, 82 fichiers de ligne (1,2 million), tuiles et zones
    const kv = new MemoryKV();
    const cache = new PersistentCache(kv, { flushDelayMs: 10, pinned: (p) => p.startsWith('trains/') || p.startsWith('tiles/') });
    const files = new Map<string, string>([['trains/2026-11-10.json', 'T'.repeat(1_650_000)]]);
    for (let i = 0; i < 82; i++) files.set(`lines/tec/${i}.json`, String(i % 10).repeat(14_600));
    for (let i = 0; i < 17; i++) files.set(`tiles/${i}.json`, 'a'.repeat(8_000 + i * 500));
    for (const [p, t] of files) cache.put('g1', p, t);
    await cache.flush();
    const total = [...files.values()].reduce((n, t) => n + t.length, 0);
    const keys = [...kv.map.keys()];
    expect(keys.filter((k) => k.startsWith('quai.core.v2.p.')).length).toBeLessThanOrEqual(Math.ceil(total / 40_000));
    expect(kv.sets).toBeLessThanOrEqual(Math.ceil(total / 40_000) + 3); // paquets, puis l'index une fois par rafale de 40
    const again = new PersistentCache(kv);
    for (const [p, t] of files) expect(await again.get('g1', p)).toBe(t);
  });

  it('cache mémoire compté en caractères : au-delà de MEM_BUDGET_CHARS, les fichiers les moins récemment lus partent', async () => {
    const calls: string[] = [];
    const meta = { v: 1, generatedAt: 'g', timezone: 'Europe/Brussels', serviceDates: ['2026-11-10'], tile: { lat: 0.02, lon: 0.03 }, feeds: {} };
    const fetchFn = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/meta.json')) return new Response(JSON.stringify(meta));
      return new Response(JSON.stringify({ pad: 'x'.repeat(1_000_000) }));
    };
    // sans cache persistant : seul le cache mémoire évite un téléchargement
    const none = { setPinned: () => undefined, getMeta: async () => null, putMeta: () => undefined, setGeneration: () => undefined, absent: async () => false, get: async () => null, put: () => undefined, markAbsent: () => undefined };
    const client = new DataClient('https://d.test', fetchFn, none as unknown as PersistentCache, () => at('2026-11-10T12:10'));
    const valid = (x: unknown): x is { pad: string } => typeof x === 'object' && x !== null;
    for (let i = 0; i < 10; i++) await client.json(`lines/big${i}.json`, valid);
    expect(client.memoryChars).toBeLessThanOrEqual(MEM_BUDGET_CHARS);
    expect(client.memoryChars).toBeGreaterThan(MEM_BUDGET_CHARS - 1_100_000);
    await client.json('lines/big9.json', valid); // récent : en mémoire
    await client.json('lines/big0.json', valid); // le plus ancien : sorti, relu sur le réseau
    expect(calls.filter((u) => u.endsWith('/big9.json'))).toHaveLength(1);
    expect(calls.filter((u) => u.endsWith('/big0.json'))).toHaveLength(2);
  });

  it('cache persistant : index illisible, ses clés sont vidées ; lecture de l’index en échec, rien n’est écrit', async () => {
    const kv = new MemoryKV();
    kv.map.set('quai.core.v2.idx', '{"v":2,"gen":"g0","files":{"x":{"p":[3],"len":1}},"pa'); // tronqué
    for (const i of [0, 3, 7]) kv.map.set(`quai.core.v2.p.${i}`, `QP2|g0\n${'z'.repeat(1_000)}`);
    const cache = new PersistentCache(kv, { budgetChars: 10_000, packChars: 2_000, flushDelayMs: 10 });
    cache.put('g1', 'tiles/a.json', 'a'.repeat(100));
    await cache.flush();
    const packs = [...kv.map.entries()].filter(([k, v]) => k.startsWith('quai.core.v2.p.') && v);
    expect(packs).toHaveLength(1);
    expect(packs[0][1].startsWith('QP2|g1\n')).toBe(true);
    expect(await cache.get('g1', 'tiles/a.json')).toBe('a'.repeat(100));

    const sets: string[] = [];
    const failing = {
      get: async (k: string) => {
        if (k === 'quai.core.v2.idx') throw new Error('pont');
        return kv.get(k);
      },
      set: async (k: string, v: string) => {
        sets.push(k);
        return kv.set(k, v);
      },
    };
    const blind = new PersistentCache(failing, { budgetChars: 10_000, packChars: 2_000, flushDelayMs: 10 });
    blind.put('g1', 'tiles/b.json', 'b'.repeat(100));
    blind.markAbsent('g1', 'tiles/c.json');
    await blind.flush();
    expect(sets).toEqual([]);
    expect(await blind.get('g1', 'tiles/b.json')).toBeNull();
  });

  it('cache persistant : un seul appel KV à la fois, délai maximal, chaîne vide = absent (SDK)', async () => {
    vi.useFakeTimers();
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
    const p1 = core.nearby(50.86, 4.359, 500);
    await vi.advanceTimersByTimeAsync(200);
    await p1;
    const p2 = core.search('Gand');
    await vi.advanceTimersByTimeAsync(200);
    await p2;
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 500);
    expect(peak).toBe(1);
    expect(store.size).toBeGreaterThan(2);

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

describe('messages d’erreur du cœur', () => {
  it('chacun tient sur une ligne des lunettes (542 px), « Pas de connexion aux horaires » compris (1.2.2, revue n° 10)', () => {
    expect(MESSAGES.dataUnreachable).toBe('Pas de connexion aux horaires\u00a0: nouvel essai dans 30\u00a0s');
    for (const m of Object.values(MESSAGES)) {
      expect(textWidth(m), m).toBeLessThanOrEqual(FULL_PX);
      expect(m).not.toContain('\u2014');
    }
  });
});
