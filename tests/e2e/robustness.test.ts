/**
 * Robustesse face à des entrées malformées, à chaque frontière :
 *  - relais ← portail BMC (pannes injectées devant le faux portail) : 500, délai, protobuf ou JSON invalide,
 *    coupure, clé refusée, redirection, paramètres invalides ; jamais de plantage, messages en français, pas de clé ;
 *  - cœur ← relais (pannes injectées devant le relais) : 500, délai, JSON invalide, formes inattendues ;
 *  - cœur ← données (pannes injectées devant serve-data) : JSON invalide, zone absente, tuile vide, meta illisible ;
 *  - cœur : zone inconnue, position absente, lieu inconnu.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore, QuaiError, MESSAGES } from '../../app/src/core/index';
import type { Core, Settings } from '../../app/src/core/api';
import { startFaultyProxy, type FaultyProxy, type Rule } from './lib/faulty';
import { memoryKV, ROOT, startRelay, startStack, TEST_KEY, type Proc, type Stack } from './lib/stack';

const PRESET = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', 'preset.json'), 'utf8')) as Settings;
const NOW = Date.parse('2026-11-10T12:10:00+01:00');
const IC1258 = '88____:007::8814001:8821006:5:1258:20261231';
const FRENCH = /[a-zàâçéèêëîïôûùüÿœ]/i;
const EM_DASH = '\u2014';

let stack: Stack;
let relayProxy: FaultyProxy;
let dataProxy: FaultyProxy;

/** Cœur neuf (aucun cache) branché sur les mandataires. */
const core = (now = NOW, kv = memoryKV()): Core => createCore({ dataBase: dataProxy.url, relayBase: relayProxy.url, now: () => now, storage: kv, fetch });

async function expectQuaiError(p: Promise<unknown>, code: keyof typeof MESSAGES): Promise<void> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, `QuaiError ${code} attendue`).toBeInstanceOf(QuaiError);
  expect((e as QuaiError).code).toBe(code);
  expect((e as QuaiError).message).toBe(MESSAGES[code]);
  expect((e as QuaiError).message.includes(EM_DASH)).toBe(false);
}

beforeAll(async () => {
  stack = await startStack();
  relayProxy = await startFaultyProxy(stack.relay.url);
  dataProxy = await startFaultyProxy(stack.data.url);
});
afterAll(async () => {
  await relayProxy?.close();
  await dataProxy?.close();
  await stack?.stop();
});

describe('relais : pannes du portail BMC', () => {
  let bmcProxy: FaultyProxy;
  let relay: Proc;
  const get = async (path: string) => {
    const r = await fetch(`${relay.url}${path}`);
    const text = await r.text();
    return { status: r.status, text, body: JSON.parse(text) as Record<string, unknown>, headers: r.headers };
  };
  const clear = () => fetch(`${relay.url}/__cache/clear`, { method: 'POST' });

  beforeAll(async () => {
    bmcProxy = await startFaultyProxy(stack.bmc.url);
    relay = await startRelay({ BMC_BASE: bmcProxy.url, DATA_BASE: stack.data.url });
  });
  afterAll(async () => {
    await relay?.stop();
    await bmcProxy?.close();
  });

  const cases: { name: string; match: RegExp; fault: Rule['fault']; path: string; error: RegExp }[] = [
    { name: 'HTTP 500 sur trip-update', match: /nmbssncb\/rt\/trip-update$/, fault: () => ({ status: 500, body: 'boom' }), path: `/api/rt?op=sncb&trips=${IC1258}`, error: /^Temps réel SNCB indisponible : réponse HTTP 500 du portail$/ },
    { name: 'protobuf invalide', match: /delijn\/rt\/trip-update$/, fault: () => ({ status: 200, body: Buffer.from([0xff, 0xff, 0xff, 0x0f, 0x01, 0x02]), headers: { 'Content-Type': 'application/x-protobuf' } }), path: '/api/rt?op=delijn&trips=702321230', error: /^Temps réel De Lijn indisponible : flux illisible \(protobuf invalide\)$/ },
    { name: 'connexion coupée', match: /tec\/rt\/trip-update$/, fault: () => ({ destroy: true }), path: '/api/rt?op=tec&trips=N5-0750', error: /^Temps réel TEC indisponible : portail injoignable$/ },
    { name: 'clé refusée (401)', match: /nmbssncb\/rt\/alert$/, fault: () => ({ status: 401, body: '{"statusCode":401}' }), path: '/api/alerts?op=sncb', error: /^Alertes SNCB indisponibles : clé refusée par le portail \(HTTP 401\)$/ },
    { name: 'redirection (clé jamais suivie ailleurs)', match: /tec\/rt\/alert$/, fault: () => ({ status: 302, headers: { Location: 'http://127.0.0.1:9/ailleurs' } }), path: '/api/alerts?op=tec', error: /^Alertes TEC indisponibles : redirection refusée du portail$/ },
    { name: 'JSON STIB invalide', match: /WaitingTimes$/, fault: () => ({ status: 200, body: '{"results": [', headers: { 'Content-Type': 'application/json' } }), path: '/api/stib?points=6357', error: /^Temps réel STIB indisponible : réponse illisible du portail \(JSON invalide\)$/ },
    { name: 'trop de requêtes (429)', match: /WaitingTimes$/, fault: () => ({ status: 429, body: '{}' }), path: '/api/stib?points=6358', error: /^Temps réel STIB indisponible : trop de requêtes, limite du portail atteinte \(HTTP 429\)$/ },
  ];

  for (const c of cases) {
    it(`${c.name} : HTTP 200, données vides, message en français`, async () => {
      bmcProxy.rules = [{ match: c.match, fault: c.fault }];
      await clear();
      const r = await get(c.path);
      expect(r.status).toBe(200);
      expect(String(r.body.error)).toMatch(c.error);
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
      expect(r.headers.get('cache-control')).toBe('no-store');
      const data = r.body.trips ?? r.body.points ?? r.body.alerts;
      expect(Array.isArray(data) ? data.length : Object.keys(data as object).length).toBe(0);
      expect(r.text.includes(TEST_KEY)).toBe(false);
      expect(r.text.includes(bmcProxy.url)).toBe(false);
    });
  }

  it('délai du portail dépassé (> 8 s) : réponse en moins de 10 s avec erreur', async () => {
    bmcProxy.rules = [{ match: /nmbssncb\/rt\/trip-update$/, fault: () => ({ delayMs: 12_000 }) }];
    await clear();
    const t0 = Date.now();
    const r = await get(`/api/rt?op=sncb&trips=${IC1258}`);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.status).toBe(200);
    expect(String(r.body.error)).toMatch(/^Temps réel SNCB indisponible : délai dépassé \(8 s\)$/);
  }, 20_000);

  it('réponse STIB de forme inattendue ou passingtimes illisible : pas de plantage, arrêts vides', async () => {
    bmcProxy.rules = [
      {
        match: /WaitingTimes$/,
        fault: () => ({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 3, results: [{ pointid: '6357', lineid: '3', passingtimes: '[{"destination": ' }, { pointid: 6357, lineid: 4, passingtimes: [{ lineId: '4', destination: 'STALLE (P)', expectedArrivalTime: 'pas une date' }] }, { foo: 'bar' }, null] }),
        }),
      },
    ];
    await clear();
    const r = await get('/api/stib?points=6357F,6358');
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
    expect(Object.keys(r.body.points as object).sort()).toEqual(['6357', '6358']);
    const p = r.body.points as Record<string, unknown[]>;
    expect(p['6358']).toEqual([]);
  });

  it('paramètres invalides : 400 en français ; OPTIONS : 204 avec CORS', async () => {
    bmcProxy.rules = [];
    const bad = ['/api/rt', '/api/rt?op=stib&trips=1', '/api/rt?op=sncb', `/api/rt?op=sncb&trips=${Array.from({ length: 61 }, (_, i) => `t${i}`).join(',')}`, '/api/stib', '/api/stib?points=abc', `/api/stib?points=${Array.from({ length: 31 }, (_, i) => 1000 + i).join(',')}`, '/api/alerts?op=xyz', `/api/rt?op=sncb&trips=${'x'.repeat(500)}`];
    for (const path of bad) {
      const r = await get(path);
      expect(r.status, path).toBe(400);
      expect(String(r.body.error), path).toMatch(FRENCH);
      expect(String(r.body.error).includes(EM_DASH)).toBe(false);
    }
    const o = await fetch(`${relay.url}/api/rt`, { method: 'OPTIONS' });
    expect(o.status).toBe(204);
    expect(o.headers.get('access-control-allow-origin')).toBe('*');
    expect(o.headers.get('access-control-allow-methods')).toMatch(/GET/);
  });

  it('health : portail en panne et données injoignables, toujours une réponse lisible', async () => {
    bmcProxy.rules = [{ match: /./, fault: () => ({ status: 503, body: 'down' }) }];
    await clear();
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    const sources = r.body.sources as Record<string, { ok: boolean; error?: string }>;
    for (const op of ['sncb', 'delijn', 'tec', 'stib']) {
      expect(sources[op].ok).toBe(false);
      expect(sources[op].error).toMatch(FRENCH);
    }
    expect(r.text.includes(TEST_KEY)).toBe(false);
  });

  it('jamais de clé dans les journaux du relais', () => {
    const logs = relay.out.join('');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.includes(TEST_KEY)).toBe(false);
    expect(logs.includes(encodeURIComponent(TEST_KEY))).toBe(false);
  });
});

describe('relais sans BMC_KEY', () => {
  it('réponses 200 avec « Clé BMC_KEY absente sur le relais » et une ligne claire au journal', async () => {
    const relay = await startRelay({ BMC_BASE: stack.bmc.url, BMC_KEY: '' });
    try {
      const r = await fetch(`${relay.url}/api/rt?op=sncb&trips=${IC1258}`);
      const body = (await r.json()) as { error?: string; trips: object };
      expect(r.status).toBe(200);
      expect(body.error).toBe('Temps réel SNCB indisponible : clé BMC_KEY absente sur le relais');
      expect(Object.keys(body.trips)).toEqual([]);
      expect(relay.out.join('')).toMatch(/BMC_KEY manquante/);
    } finally {
      await relay.stop();
    }
  });
});

describe('cœur : relais en panne ou réponses malformées', () => {
  afterAll(() => {
    relayProxy.rules = [];
  });

  it('relais en 500 : tout en horaire prévu, sources signalées, aucune exception', async () => {
    relayProxy.rules = [{ match: /^\/api\//, fault: () => ({ status: 500, body: '{"error":"Erreur interne du relais"}' }) }];
    const c = core();
    for (const id of ['stib:6357F', 'delijn:308611', 'sncb:8812005']) {
      const b = await c.board(id, { limit: 5 });
      expect(b.departures.length).toBe(5);
      expect(b.departures.every((d) => !d.rt)).toBe(true);
      expect(b.anyPlanned).toBe(true);
      expect(b.rtErrors).toEqual([id.split(':')[0]]);
    }
    const near = await c.nearby(50.86, 4.359, 500);
    expect(near.length).toBe(4);
    expect(near.every((n) => n.next && !n.next.rt)).toBe(true);
    const js = await c.trains('sncb:8813003', 'sncb:8892007', Date.parse('2026-11-10T13:55:00+01:00'), 3);
    expect(js.length).toBe(3);
    expect(await c.works('sncb', [], ['8811601'])).toEqual([]);
    const h = await c.health();
    expect(h.ok).toBe(false);
    expect(h.sources.sncb.error).toBe('Relais injoignable');
  });

  it('relais muet (délai > 8 s) : le tableau arrive quand même, en horaire prévu', async () => {
    relayProxy.rules = [{ match: /^\/api\/stib$/, fault: () => ({ delayMs: 15_000 }) }];
    const t0 = Date.now();
    const b = await core().board('stib:6357F', { limit: 3 });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(12_000);
    expect(b.rtErrors).toEqual(['stib']);
    expect(b.departures.length).toBe(3);
  }, 30_000);

  it('JSON invalide, forme inattendue, valeurs absurdes : pas d’exception', async () => {
    const bodies = [
      'pas du json',
      '{"op":"sncb","trips":"oups"}',
      '[]',
      'null',
      JSON.stringify({ op: 'sncb', fetchedAt: 'x', trips: { [IC1258]: { u: [['x', 42, 'abc', 'zz', 7], null, [3], [3, '8812005_9', 1e12, null, 0]] }, autre: 'x' } }),
      JSON.stringify({ op: 'sncb', fetchedAt: 'x', trips: { [IC1258]: { cancelled: 'oui', u: 'non' } } }),
    ];
    for (const body of bodies) {
      relayProxy.rules = [{ match: /^\/api\/rt$/, fault: () => ({ status: 200, body, headers: { 'Content-Type': 'application/json' } }) }];
      const b = await core().board('sncb:8812005', { limit: 3 });
      expect(b.departures.length, body).toBe(3);
      for (const d of b.departures) {
        expect(Number.isFinite(d.est), body).toBe(true);
        expect(Number.isFinite(d.delayMin), body).toBe(true);
      }
    }
  });

  it('STIB : réponse du relais malformée (heures illisibles, points non numériques) : horaire prévu', async () => {
    const bodies = [
      JSON.stringify({ fetchedAt: 'x', points: { '6357': [{ line: '3', dest: { fr: 'CHURCHILL' }, times: ['n’importe quoi', null, 12] }], abc: 'x' } }),
      JSON.stringify({ fetchedAt: 'x', points: { '6357': 'oups' } }),
      JSON.stringify({ fetchedAt: 'x', points: null }),
    ];
    for (const body of bodies) {
      relayProxy.rules = [{ match: /^\/api\/stib$/, fault: () => ({ status: 200, body, headers: { 'Content-Type': 'application/json' } }) }];
      const b = await core().board('stib:6357F', { limit: 4 });
      expect(b.departures.length, body).toBe(4);
      for (const d of b.departures) expect(d.est, body).toBeGreaterThanOrEqual(NOW - 60_000);
    }
  });

  it('relais arrêté (connexion refusée) : horaire prévu', async () => {
    const c = createCore({ dataBase: dataProxy.url, relayBase: 'http://127.0.0.1:9', now: () => NOW, storage: memoryKV(), fetch });
    const b = await c.board('delijn:308611', { limit: 3 });
    expect(b.rtErrors).toEqual(['delijn']);
    expect(b.departures.length).toBe(3);
  });
});

describe('cœur : données statiques malformées ou absentes', () => {
  afterAll(() => {
    dataProxy.rules = [];
  });

  it('meta.json illisible, absent ou serveur arrêté : init() échoue avec « Données indisponibles »', async () => {
    for (const fault of [{ status: 200, body: '{"v":1,' }, { status: 404, body: '{}' }, { status: 200, body: '{"v":2}' }, { status: 503, body: '' }] as const) {
      dataProxy.rules = [{ match: /meta\.json$/, fault: () => fault }];
      await expectQuaiError(core().init(), 'dataUnavailable');
    }
    const down = createCore({ dataBase: 'http://127.0.0.1:9', relayBase: relayProxy.url, now: () => NOW, storage: memoryKV(), fetch });
    await expectQuaiError(down.init(), 'dataUnavailable');
    await expectQuaiError(down.board('stib:6357F'), 'dataUnavailable');
    expect(await down.suggest(null, PRESET)).toBeNull();
  });

  it('meta.json injoignable mais copie enregistrée : le cœur repart sur la copie', async () => {
    dataProxy.rules = [];
    const kv = memoryKV();
    const first = core(NOW, kv);
    await first.init();
    await first.board('stib:6357F', { limit: 2 });
    await new Promise((r) => setTimeout(r, 200)); // écritures KV en arrière-plan
    dataProxy.rules = [{ match: /./, fault: () => ({ status: 503, body: '' }) }];
    const second = core(NOW, kv);
    const meta = await second.init();
    expect(meta.serviceDates).toEqual(['2026-11-10', '2026-11-11']);
    const b = await second.board('stib:6357F', { limit: 2 });
    expect(b.departures.length).toBe(2); // fichier de zone servi par le cache persistant
  });

  it('fichier de zone JSON invalide : board() lève « Données indisponibles », nearby() continue sans ce départ', async () => {
    dataProxy.rules = [{ match: /areas\/delijn\/308611\.json$/, fault: () => ({ status: 200, body: '{"v":1,"id":"delijn:308611","stops":[' }) }];
    const c = core();
    await expectQuaiError(c.board('delijn:308611'), 'dataUnavailable');
    const near = await c.nearby(50.86, 4.359, 500);
    expect(near.map((n) => n.area.id)).toEqual(['stib:6357F', 'sncb:8812005', 'delijn:308611', 'stib:6359']);
    expect(near[2].next).toBeUndefined();
    expect(near[0].next).toBeDefined();
  });

  it('fichier de zone absent (404) ou zone inconnue : « Arrêt introuvable dans les données du jour »', async () => {
    dataProxy.rules = [{ match: /areas\/stib\/6359\.json$/, fault: () => ({ status: 404, body: '{}' }) }];
    const c = core();
    await expectQuaiError(c.board('stib:6359'), 'areaUnknown');
    for (const id of ['stib:NOPE', 'xyz:1', '', 'sncb:', ':', 'sncb:../../meta']) await expectQuaiError(c.board(id), 'areaUnknown');
    await expectQuaiError(c.linesAt('stib:NOPE'), 'areaUnknown');
    expect(await c.trains('sncb:0000000', 'sncb:8892007', NOW, 3)).toEqual([]);
  });

  it('tuile vide, absente ou malformée : nearby() renvoie une liste vide ou partielle, sans exception', async () => {
    for (const fault of [{ status: 200, body: '{"v":1,"areas":[]}' }, { status: 404, body: '' }, { status: 200, body: '{"v":1,"areas":[null,{"id":"stib:6357F"},{"id":"x","lat":"a","lon":null}]}' }] as const) {
      dataProxy.rules = [{ match: /tiles\//, fault: () => fault }];
      const near = await core().nearby(50.86, 4.359, 500);
      expect(near).toEqual([]);
    }
    dataProxy.rules = [];
    expect(await core().nearby(Number.NaN, Number.NaN, 500)).toEqual([]);
    expect(await core().nearby(10, 10, 500)).toEqual([]); // hors réseau
  });

  it('fichiers trains et recherche illisibles : erreurs lisibles, pas de plantage', async () => {
    dataProxy.rules = [{ match: /trains\//, fault: () => ({ status: 200, body: 'xx' }) }];
    await expectQuaiError(core().trains('sncb:8813003', 'sncb:8892007', NOW, 3), 'dataUnavailable');
    dataProxy.rules = [{ match: /search\//, fault: () => ({ status: 200, body: '{"v":1,"items":[null,{"id":"x"},{"id":"delijn:1","n":{"fr":"Gand test","nl":"Gent test"},"op":"delijn","modes":["tram"],"lat":1,"lon":1}]}' }) }];
    const res = await core().search('Gand');
    expect(res.map((r) => r.id)).toEqual(['delijn:1']);
    dataProxy.rules = [{ match: /search\//, fault: () => ({ status: 404, body: '' }) }];
    expect(await core().search('Gand')).toEqual([]);
  });
});

describe('cœur : entrées de l’appli', () => {
  beforeAll(() => {
    dataProxy.rules = [];
    relayProxy.rules = [];
  });

  it('position absente : plan() lève « Position inconnue », suggest(null) reste calme', async () => {
    const c = core(Date.parse('2026-11-10T07:31:00+01:00'));
    await expectQuaiError(c.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, NOW, PRESET), 'hereMissing');
    await expectQuaiError(c.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, NOW, PRESET, { lat: Number.NaN, lon: 4 }), 'hereMissing');
    expect(await c.suggest(null, PRESET)).toBeNull(); // fav-bureau part de « ici » : ignoré sans position
  });

  it('lieu inconnu : « Lieu introuvable dans tes réglages »', async () => {
    await expectQuaiError(core().plan({ type: 'place', placeId: 'nulle-part' }, { type: 'place', placeId: 'bureau' }, NOW, PRESET), 'placeUnknown');
  });

  it('réglages minimaux ou incohérents : pas d’exception', async () => {
    const odd = { ...PRESET, maxWalkMin: -5, favorites: [], places: [], display: { ...PRESET.display, depsPerStop: 0 } } as Settings;
    const c = core();
    expect(await c.suggest({ lat: 50.86, lon: 4.359 }, odd)).toBeNull();
    const b = await c.board('stib:6357F', { limit: 0 });
    expect(b.departures.length).toBe(1);
    expect(await c.works('stib', [], [])).toEqual([]);
  });
});
