/**
 * 1.2.10 : chemin à pied côté téléphone : routeur (tuiles autour de la marche, cache mémoire, versions, erreurs),
 * client des données (walk/index.json, tuiles demandées par zone, hors des caches persistants) et Core.walkRoute
 * (jamais d'exception, aucune position envoyée).
 */
import { describe, expect, it, vi } from 'vitest';
import { DataClient } from '../../src/core/data';
import { PersistentCache } from '../../src/core/persist';
import { makeFetch } from '../../src/core/net';
import type { WalkTileFile } from '../../src/core/walk/format';
import { MAX_WALK_M, WalkRouter } from '../../src/core/walk/router';
import { makeEnv, MemoryKV } from './support/env';
import { ANCHOR, at, indexOf, memorySource, tileOf, type GraphDef } from './walk-helpers';

const street: GraphDef = {
  nodes: { S: [0, -400], J: [0, 0], N: [0, 400], E: [400, 0] },
  ways: [{ nodes: ['S', 'J', 'N'], name: 'Avenue Louise' }, { nodes: ['J', 'E'], name: 'Rue du Bailli' }],
};
const TILE = tileOf(street);

describe('WalkRouter', () => {
  it('pas de chemins publiés : null, aucune tuile demandée', async () => {
    const src = memorySource([TILE], null);
    expect(await new WalkRouter(src).route(at(0, -300), at(300, 0))).toBeNull();
    expect(src.calls).toEqual([]);
  });

  it('coordonnées invalides : null ; marche de plus de 5 km : chemin droit sans rien charger', async () => {
    const src = memorySource([TILE]);
    const r = new WalkRouter(src, { now: () => 5 });
    expect(await r.route({ lat: Number.NaN, lon: 4.3 }, at(0, 0))).toBeNull();
    expect(await r.route({ lat: 95, lon: 4.3 }, at(0, 0))).toBeNull();
    const far = await r.route(at(0, 0), at(0, MAX_WALK_M + 100));
    expect(far).toMatchObject({ source: 'straight', maneuvers: [], builtAt: 5 });
    expect(src.indexCalls).toBe(0);
    expect(src.calls).toEqual([]);
  });

  it('tuiles gardées en mémoire : un nouveau calcul (hors du chemin) ne redemande rien', async () => {
    const src = memorySource([TILE]);
    const r = new WalkRouter(src);
    const a = await r.route(at(0, -300), at(300, 0));
    const b = await r.route(at(5, -200), at(300, 0));
    expect(a?.source).toBe('osm');
    expect(b?.source).toBe('osm');
    expect(src.calls).toEqual(['test|2541_145']);
    expect(src.indexCalls).toBe(2);
  });

  it('nouvelle version des tuiles : cache vidé, tuiles redemandées avec la version', async () => {
    let version = '2026-11-02';
    const tile = tileOf(street, { ver: version });
    const calls: string[] = [];
    const r = new WalkRouter({ index: async () => indexOf({ version }), tile: async (k, v) => (calls.push(`${v}|${k}`), tile) });
    await r.route(at(0, -300), at(300, 0));
    version = '2026-11-09';
    await r.route(at(0, -300), at(300, 0));
    expect(calls).toEqual(['2026-11-02|2541_145', '2026-11-09|2541_145']);
  });

  it('tuile en échec (réseau) : exception, rien de gardé ; le calcul suivant redemande la tuile', async () => {
    let fail = true;
    const r = new WalkRouter({ index: async () => indexOf(), tile: async () => (fail ? Promise.reject(new Error('réseau')) : TILE) });
    await expect(r.route(at(0, -300), at(300, 0))).rejects.toThrow('réseau');
    fail = false;
    expect((await r.route(at(0, -300), at(300, 0)))?.source).toBe('osm');
  });

  it('tuile illisible : exception (le cœur rend null)', async () => {
    const bad: WalkTileFile = { ...TILE, w: TILE.w.slice(0, 10) };
    await expect(new WalkRouter(memorySource([bad])).route(at(0, -300), at(300, 0))).rejects.toThrow('tuile piétonne illisible');
  });

  it('deux calculs en même temps : une seule demande par tuile', async () => {
    const src = memorySource([TILE]);
    const r = new WalkRouter(src);
    const [a, b] = await Promise.all([r.route(at(0, -300), at(300, 0)), r.route(at(0, 300), at(300, 0))]);
    expect(a?.source).toBe('osm');
    expect(b?.source).toBe('osm');
    expect(src.calls).toEqual(['test|2541_145']);
  });

  it('cache borné : la tuile la plus ancienne est oubliée', async () => {
    const west: GraphDef = { nodes: { A: [-3000, 0], B: [-2600, 0] }, ways: [{ nodes: ['A', 'B'], name: 'Rue Ouest' }] };
    const east: GraphDef = { nodes: { A: [2600, 0], B: [2900, 0] }, ways: [{ nodes: ['A', 'B'], name: 'Rue Est' }] };
    const tiles = [TILE, tileOf(west), tileOf(east)];
    expect(tiles.map((t) => t.k)).toEqual(['2541_145', '2541_144', '2541_146']);
    const src = memorySource(tiles);
    const r = new WalkRouter(src, { maxTiles: 2 });
    await r.route(at(0, -300), at(0, 300));
    await r.route(at(-2950, 0), at(-2700, 0));
    await r.route(at(2650, 0), at(2850, 0));
    await r.route(at(0, -300), at(0, 300));
    expect(src.calls.filter((c) => c === 'test|2541_145')).toHaveLength(2);
  });

  it('tuiles coupées en 4 (index.split) : les quarts sont demandés, pas la tuile de base', async () => {
    const quarter = tileOf(street, { key: '2541_145_2', loose: true });
    const src = memorySource([quarter], indexOf({ split: ['2541_145'] }));
    const r = await new WalkRouter(src).route(at(0, 200), at(300, 0));
    expect(r?.source).toBe('osm');
    expect(src.calls.every((c) => /\|2541_145_[0-3]$/.test(c) || !c.includes('2541_145'))).toBe(true);
    expect(src.calls).toContain('test|2541_145_2');
  });
});

describe('DataClient : index et tuiles piétonnes', () => {
  const META = { v: 1, generatedAt: '2026-11-10T01:30:00.000Z', timezone: 'Europe/Brussels', serviceDates: ['2026-11-10', '2026-11-11'], tile: { lat: 0.02, lon: 0.03 }, feeds: {} };
  function client(routes: Record<string, () => Response>) {
    const calls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const path = url.replace('https://data.test/quai/data/', '');
      const h = routes[path];
      return h ? h() : new Response('Not Found', { status: 404 });
    }) as typeof globalThis.fetch;
    const persist = new PersistentCache(new MemoryKV());
    const put = vi.spyOn(persist, 'put');
    const dc = new DataClient('https://data.test/quai/data', makeFetch(fetch), persist, () => Date.parse('2026-11-10T12:00:00Z'));
    return { dc, calls, put };
  }
  const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

  it('index absent (404) : null ; index valide lu une fois par publication', async () => {
    const none = client({ 'meta.json': ok(META) });
    expect(await none.dc.walkIndex()).toBeNull();
    const idx = indexOf({ version: '2026-11-09' });
    const some = client({ 'meta.json': ok(META), 'walk/index.json': ok(idx) });
    expect(await some.dc.walkIndex()).toEqual(idx);
    expect(await some.dc.walkIndex()).toEqual(idx);
    expect(some.calls.filter((c) => c.endsWith('walk/index.json'))).toHaveLength(1);
  });

  it('index invalide : QuaiError dataUnavailable', async () => {
    const c = client({ 'meta.json': ok(META), 'walk/index.json': ok({ v: 1, version: 'x' }) });
    await expect(c.dc.walkIndex()).rejects.toMatchObject({ code: 'dataUnavailable' });
  });

  it('tuile : adresse par zone avec la version (aucune position), jamais dans le cache persistant', async () => {
    const c = client({ 'meta.json': ok(META), 'walk/2541_145.json?v=2026-11-09': ok(TILE) });
    expect(await c.dc.walkTile('2541_145', '2026-11-09')).toEqual(TILE);
    expect(c.calls).toEqual(['https://data.test/quai/data/walk/2541_145.json?v=2026-11-09']);
    expect(c.put).not.toHaveBeenCalled();
  });

  it('tuile vide (404) : null ; clé invalide : null sans requête ; contenu faux : dataUnavailable ; réseau : dataUnreachable', async () => {
    const c = client({
      'walk/2541_146.json?v=v': ok({ ...TILE, k: '2541_146', w: 1 }),
      'walk/2541_147.json?v=v': ok(TILE),
      'walk/2541_148.json?v=v': () => new Response('panne', { status: 503 }),
    });
    expect(await c.dc.walkTile('2541_144', 'v')).toBeNull();
    expect(await c.dc.walkTile('../meta', 'v')).toBeNull();
    expect(c.calls.some((u) => u.includes('meta'))).toBe(false);
    await expect(c.dc.walkTile('2541_146', 'v')).rejects.toMatchObject({ code: 'dataUnavailable' });
    // clé de la réponse différente de la clé demandée
    await expect(c.dc.walkTile('2541_147', 'v')).rejects.toMatchObject({ code: 'dataUnavailable' });
    await expect(c.dc.walkTile('2541_148', 'v')).rejects.toMatchObject({ code: 'dataUnreachable' });
    expect(c.calls.filter((u) => u.includes('2541_148'))).toHaveLength(2);
  });
});

describe('Core.walkRoute', () => {
  const env = () => makeEnv({ now: '2026-11-10T12:10' });

  it('publication sans chemins à pied : null (le guidage garde le chemin droit)', async () => {
    const e = env();
    expect(await e.core.walkRoute!(at(0, -300), at(300, 0))).toBeNull();
  });

  it('vrai chemin depuis les tuiles publiées ; seules la zone et la version partent', async () => {
    const e = env();
    e.server.overrides.set('/quai/data/walk/index.json', () => new Response(JSON.stringify(indexOf({ version: '2026-11-09' })), { status: 200 }));
    e.server.overrides.set('/quai/data/walk/2541_145.json', () => new Response(JSON.stringify(TILE), { status: 200 }));
    const r = await e.core.walkRoute!(at(0, -300), at(300, 0));
    expect(r?.source).toBe('osm');
    expect(r?.maneuvers).toEqual([expect.objectContaining({ turn: 'right', street: 'Rue du Bailli' })]);
    const walkCalls = e.server.calls.filter((u) => u.includes('/walk/'));
    expect(walkCalls.length).toBeGreaterThan(1);
    for (const u of walkCalls) expect(u).toMatch(/\/walk\/(index|\d+_\d+(_[0-3]+)?)\.json(\?v=2026-11-09)?$/);
    const pos = [ANCHOR.lat, ANCHOR.lon].map((x) => String(x).slice(0, 5));
    for (const u of e.server.calls) for (const p of pos) expect(u).not.toContain(p);
  });

  it('walkIndex (carte « Chemins à pied » de l’écran Données) : date des données et nombre de tuiles ; null sinon', async () => {
    const e = env();
    expect(await e.core.walkIndex!()).toBeNull();
    const f = env();
    f.server.overrides.set('/quai/data/walk/index.json', () => new Response(JSON.stringify({ ...indexOf({ version: '2026-11-09' }), tiles: 7612 }), { status: 200 }));
    expect(await f.core.walkIndex!()).toEqual({ date: '2026-11-09', tiles: 7612 });
    const g = env();
    g.server.overrides.set('/quai/data/walk/index.json', () => new Response('{"v":1}', { status: 200 }));
    await expect(g.core.walkIndex!()).resolves.toBeNull();
    const h = env();
    h.server.networkDown = true;
    await expect(h.core.walkIndex!()).resolves.toBeNull();
  });

  it('serveur en panne pendant le chargement d’une tuile : null, jamais d’exception', async () => {
    const e = env();
    e.server.overrides.set('/quai/data/walk/index.json', () => new Response(JSON.stringify(indexOf()), { status: 200 }));
    e.server.overrides.set('/quai/data/walk/2541_145.json', () => new Response('panne', { status: 500 }));
    await expect(e.core.walkRoute!(at(0, -300), at(300, 0))).resolves.toBeNull();
  });
});
