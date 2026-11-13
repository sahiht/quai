/**
 * Bout en bout : faux portail BMC (npm run mock-bmc), faux service d'adresses (npm run mock-geocode) et relais local
 * (npm run dev) lancés comme processus séparés sur des ports éphémères, un petit serveur pour meta.json, puis appels
 * HTTP réels des six points d'entrée (1.2.5 : /api/weather sur un faux Open-Meteo). Pour finir : la clé ne doit apparaître dans aucune réponse ni dans aucun journal
 * des trois processus, et le texte cherché jamais dans le journal du relais.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AlertsResponse, GeocodeResponse, HealthResponse, RtResponse, StibResponse, WeatherResponse } from '../lib/shared/types.js';

const RELAY_DIR = fileURLToPath(new URL('..', import.meta.url));
const KEY = `e2e-${randomUUID()}`;
const NOW = '2026-11-10T12:10:00+01:00';
const NAMUR_IC = '88____:007::8863008:8814001:10:852:20261231';
const S1 = '88____:046::8812005:8883006:4:1315:20261231';
const sec = (iso: string) => Math.round(Date.parse(iso) / 1000);

const META = {
  v: 1, generatedAt: '2026-11-10T02:21:00+01:00', timezone: 'Europe/Brussels', serviceDates: ['2026-11-10', '2026-11-11'],
  tile: { lat: 0.02, lon: 0.03 },
  feeds: { sncb: { ok: true, areas: 14, trips: 11 }, stib: { ok: true, areas: 9, trips: 900 }, delijn: { ok: true, areas: 7, trips: 300 }, tec: { ok: true, areas: 6, trips: 120 } },
};

interface Proc { child: ChildProcess; output: string[]; url: string }
const procs: Proc[] = [];
const seen: string[] = [];

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of [
    'BMC_KEY', 'BMC_BASE', 'SNCB_RT_URL', 'DATA_BASE', 'QUAI_NOW', 'MOCK_BMC_KEY', 'NODE_OPTIONS',
    'QUAI_GEO_BASE', 'QUAI_GEO_VLA_BASE', 'QUAI_GEO_BRU_BASE', 'QUAI_GEO_WAL_BASE', 'GEOCODE_SOURCES', 'GOOGLE_GEOCODING_KEY', 'WEATHER_BASE',
  ]) delete env[k];
  return { ...env, ...extra };
}

/** Lance un script TypeScript (tsx) avec --port 0 et attend la ligne qui annonce le port. */
function start(script: string, env: Record<string, string>, ready: RegExp): Promise<Proc> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, '--port', '0'], { cwd: RELAY_DIR, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    const output: string[] = [];
    let done = false;
    const timer = setTimeout(() => !done && reject(new Error(`${script} n'a pas démarré :\n${output.join('')}`)), 20_000);
    const onData = (chunk: Buffer) => {
      output.push(chunk.toString());
      const m = ready.exec(output.join(''));
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        const proc = { child, output, url: `http://127.0.0.1:${m[1]}` };
        procs.push(proc);
        resolve(proc);
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.once('exit', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`${script} s'est arrêté (code ${code}) :\n${output.join('')}`));
      }
    });
  });
}

async function waitForOutput(p: Proc, re: RegExp, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (re.test(p.output.join(''))) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return re.test(p.output.join(''));
}

const startMock = () => start('../fixtures/relay/mock-bmc.ts', { MOCK_BMC_KEY: KEY }, /prêt : http:\/\/localhost:(\d+)/);
const startGeo = () => start('../fixtures/relay/mock-geocode.ts', {}, /prêt : http:\/\/localhost:(\d+)/);
const startRelay = (env: Record<string, string>) => start('scripts/dev.ts', env, /Relais Quai \(dev\) : http:\/\/localhost:(\d+)/);

async function request<T = Record<string, unknown>>(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  seen.push(text, JSON.stringify([...res.headers]));
  return { status: res.status, headers: res.headers, text, body: (text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null) as T };
}

let mock: Proc;
let geo: Proc;
let relay: Proc;
let dataServer: http.Server;
let dataBase: string;
/** 1.2.5 : faux Open-Meteo (requêtes reçues notées). */
let weatherServer: http.Server;
const weatherCalls: string[] = [];

beforeAll(async () => {
  dataServer = http.createServer((req, res) => {
    const ok = req.url === '/data/meta.json';
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(ok ? JSON.stringify(META) : '{}');
  });
  await new Promise<void>((r) => dataServer.listen(0, '127.0.0.1', () => r()));
  dataBase = `http://127.0.0.1:${(dataServer.address() as AddressInfo).port}/data`;
  weatherServer = http.createServer((req, res) => {
    weatherCalls.push(req.url ?? '');
    const u = new URL(req.url ?? '/', 'http://x');
    const n = (u.searchParams.get('latitude') ?? '').split(',').length;
    const t0 = sec(NOW) - (sec(NOW) % 900) + 900;
    const h0 = sec(NOW) - (sec(NOW) % 3600) + 3600;
    const cell = () => ({ minutely_15: { time: [t0, t0 + 900], precipitation: [0.4, 0] }, hourly: { time: [h0], precipitation_probability: [70] } });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Array.from({ length: n }, cell)));
  });
  await new Promise<void>((r) => weatherServer.listen(0, '127.0.0.1', () => r()));
  const weatherBase = `http://127.0.0.1:${(weatherServer.address() as AddressInfo).port}`;
  [mock, geo] = await Promise.all([startMock(), startGeo()]);
  relay = await startRelay({ BMC_BASE: mock.url, BMC_KEY: KEY, QUAI_NOW: NOW, DATA_BASE: dataBase, QUAI_GEO_BASE: geo.url, WEATHER_BASE: weatherBase });
});

afterAll(async () => {
  for (const p of procs) p.child.kill('SIGTERM');
  await new Promise<void>((r) => dataServer.close(() => r()));
  await new Promise<void>((r) => weatherServer.close(() => r()));
});

describe('faux portail BMC (processus)', () => {
  const path = '/api/gtfs/feed/tec/rt/trip-update?format=protobuf';

  it('exige les deux en-têtes de clé (401 sinon), sert le protobuf avec la bonne clé', async () => {
    expect((await request(mock.url + path)).status).toBe(401);
    expect((await request(mock.url + path, { headers: { 'bmc-partner-key': KEY } })).status).toBe(401);
    expect((await request(mock.url + path, { headers: { 'bmc-partner-key': 'faux', 'Ocp-Apim-Subscription-Key': 'faux' } })).status).toBe(401);
    const ok = await fetch(mock.url + path, { headers: { 'bmc-partner-key': KEY, 'Ocp-Apim-Subscription-Key': KEY } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/x-protobuf');
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('applique le filtre where de WaitingTimes et la limite Opendatasoft', async () => {
    const h = { 'bmc-partner-key': KEY, 'Ocp-Apim-Subscription-Key': KEY };
    const where = encodeURIComponent('pointid="6357" or pointid="8041"');
    const r = await request<{ total_count: number; results: { pointid: string }[] }>(`${mock.url}/api/datasets/stibmivb/rt/WaitingTimes?where=${where}&limit=100`, { headers: h });
    expect(r.body.total_count).toBe(3);
    expect(new Set(r.body.results.map((x) => x.pointid))).toEqual(new Set(['6357', '8041']));
    expect((await request(`${mock.url}/api/datasets/stibmivb/rt/WaitingTimes?limit=200`, { headers: h })).status).toBe(400);
  });

  it('GTFS statiques : zips de l’équipe données s’ils existent, sinon 404', async () => {
    const h = { 'bmc-partner-key': KEY, 'Ocp-Apim-Subscription-Key': KEY };
    for (const slug of ['nmbssncb', 'stibmivb', 'delijn', 'tec']) {
      const res = await fetch(`${mock.url}/api/gtfs/feed/${slug}/static`, { headers: h });
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) expect(res.headers.get('content-type')).toBe('application/zip');
      await res.arrayBuffer();
    }
  });
});

describe('relais local (npm run dev) sur le faux portail', () => {
  it('/api/rt SNCB : IC de Namur +2 min voie 6, S1 supprimé', async () => {
    const r = await request<RtResponse>(`${relay.url}/api/rt?op=sncb&trips=${encodeURIComponent(`${NAMUR_IC},${S1}`)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=20, stale-while-revalidate=40');
    expect(r.body.feedTimestamp).toBe(1794309000);
    expect(r.body.fetchedAt.slice(0, 13)).toBe('2026-11-10T11');
    expect(r.body.trips[NAMUR_IC].u[0]).toEqual([1, '8863008_6', 120, sec('2026-11-10T07:44:00+01:00'), 0]);
    expect(r.body.trips[S1]).toEqual({ cancelled: true, u: [] });
  });

  it('/api/rt De Lijn et TEC : identifiants normalisés', async () => {
    const dl = await request<RtResponse>(`${relay.url}/api/rt?op=delijn&trips=702321230,702321245,704601218,700011438,700011446`);
    expect(Object.keys(dl.body.trips).sort()).toEqual(['700011438', '700011446', '702321230', '702321245', '704601218']);
    expect(dl.body.trips['702321245'].u).toEqual([[1, '308611', 60, sec('2026-11-10T12:46:00+01:00'), 0]]);
    const tec = await request<RtResponse>(`${relay.url}/api/rt?op=tec&trips=N5-0750`);
    expect(tec.body.trips['N5-0750'].u[0][2]).toBe(180);
  });

  it('/api/stib : quatre arrêts, regroupés par ligne et destination', async () => {
    const r = await request<StibResponse>(`${relay.url}/api/stib?points=6357,6358,8042,8041`);
    expect(r.body.error).toBeUndefined();
    expect(r.body.points['6357'].map((g) => `${g.line} ${g.dest.fr} ${g.times.map((t) => t.slice(11, 16)).join(' ')}`))
      .toEqual(['3 CHURCHILL 12:12 12:20', '4 STALLE (P) 12:15 12:23']);
    expect(r.body.points['6358'][0].dest).toEqual({ fr: 'ESPLANADE', nl: 'ESPLANADE' });
    expect(r.body.points['8042'].map((g) => g.line)).toEqual(['2', '6']);
    expect(r.body.points['8041'][0].msg).toBe('Travaux : arrêt Botanique non desservi');
  });

  it('/api/alerts : actives à l’horloge QUAI_NOW, filtrées', async () => {
    const sncb = await request<AlertsResponse>(`${relay.url}/api/alerts?op=sncb&stops=8811601_2`);
    expect(sncb.body.alerts.map((a) => a.id)).toEqual(['sncb-works-ottignies']);
    const tec = await request<AlertsResponse>(`${relay.url}/api/alerts?op=tec&routes=N51`);
    expect(tec.body.alerts[0].header).toEqual({ fr: 'Ligne 51 déviée rue de Fer' });
    const none = await request<AlertsResponse>(`${relay.url}/api/alerts?op=tec&routes=N4`);
    expect(none.body.alerts).toEqual([]);
  });

  it('/api/health : sources joignables, génération de nuit lue dans DATA_BASE, services d’adresses, version', async () => {
    const r = await request<HealthResponse>(`${relay.url}/api/health`);
    expect(r.body.ok).toBe(true);
    expect(r.body.data).toEqual({ generatedAt: META.generatedAt, ok: true, feeds: META.feeds });
    expect(Object.values(r.body.sources).every((s) => s.ok && typeof s.ms === 'number')).toBe(true);
    expect(r.body.version).toBe('1.1.0');
    expect(Object.keys(r.body.geocode ?? {})).toEqual(['vla', 'bru', 'wal']);
    expect(Object.values(r.body.geocode ?? {}).every((s) => s?.ok)).toBe(true);
  });

  it('/api/weather (1.2.5) : la grille de toute la Belgique, une requête vers Open-Meteo gardée 1 h, sans clé ni position', async () => {
    const r = await request<WeatherResponse>(`${relay.url}/api/weather`);
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
    expect([r.body.rows, r.body.cols, r.body.rain.length, r.body.prob.length]).toEqual([9, 16, 144, 144]);
    expect(r.body.rain[0]).toEqual([4, 0]);
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=300');
    await request(`${relay.url}/api/weather`);
    expect(weatherCalls).toHaveLength(1);
    expect(new URL(weatherCalls[0], 'http://x').searchParams.get('latitude')!.split(',')).toHaveLength(144);
    expect(weatherCalls[0]).not.toContain(KEY);
  });

  it('OPTIONS 204, paramètres invalides 400, chemin inconnu 404, méthode non prise en charge 405', async () => {
    const pre = await request(`${relay.url}/api/stib`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    const bad = await request(`${relay.url}/api/rt?op=stib&trips=1`);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/STIB/);
    expect((await request(`${relay.url}/api/inconnu`)).status).toBe(404);
    expect((await request(`${relay.url}/api/rt?op=sncb&trips=1`, { method: 'POST' })).status).toBe(405);
  });

  it('cache : deux appels rapprochés = une seule requête vers le portail', async () => {
    await request(`${relay.url}/__cache/clear`, { method: 'POST' });
    await request(`${mock.url}/__stats/reset`, { method: 'POST' });
    await Promise.all([1, 2, 3].map(() => request(`${relay.url}/api/rt?op=tec&trips=N5-0750`)));
    await request(`${relay.url}/api/rt?op=tec&trips=N4-0745`);
    const stats = await request<{ requests: Record<string, number> }>(`${mock.url}/__stats`);
    expect(stats.body.requests['/api/gtfs/feed/tec/rt/trip-update']).toBe(1);
  });

  it('scène noRT : HTTP 200 avec error et données vides, puis retour à la normale', async () => {
    await request(`${mock.url}/__scene/noRT`, { method: 'POST' });
    await request(`${relay.url}/__cache/clear`, { method: 'POST' });
    const rt = await request<RtResponse>(`${relay.url}/api/rt?op=sncb&trips=${encodeURIComponent(NAMUR_IC)}`);
    expect(rt.status).toBe(200);
    expect(rt.body).toMatchObject({ op: 'sncb', trips: {}, error: 'Temps réel SNCB indisponible : réponse HTTP 503 du portail' });
    expect(rt.headers.get('cache-control')).toBe('no-store');
    const stib = await request<StibResponse>(`${relay.url}/api/stib?points=6357`);
    expect(stib.body).toMatchObject({ points: {}, error: 'Temps réel STIB indisponible : réponse HTTP 503 du portail' });
    const alerts = await request<AlertsResponse>(`${relay.url}/api/alerts?op=sncb`);
    expect(alerts.body).toMatchObject({ alerts: [], error: 'Alertes SNCB indisponibles : réponse HTTP 503 du portail' });
    const health = await request<HealthResponse>(`${relay.url}/api/health`);
    expect(health.body.ok).toBe(false);
    expect(health.body.sources.delijn).toEqual({ ok: false, error: 'Réponse HTTP 503 du portail' });
    expect(health.body.data?.ok).toBe(true);
    await request(`${mock.url}/__scene/base`, { method: 'POST' });
    await request(`${relay.url}/__cache/clear`, { method: 'POST' });
    const back = await request<RtResponse>(`${relay.url}/api/rt?op=sncb&trips=${encodeURIComponent(NAMUR_IC)}`);
    expect(back.body.error).toBeUndefined();
    expect(back.body.trips[NAMUR_IC].u).toHaveLength(2);
  });
});

describe('faux service d’adresses (processus)', () => {
  it('sert les trois services officiels sur leurs vrais chemins, dans leurs formats', async () => {
    const vla = await request<{ LocationResult: { FormattedAddress: string; LocationType: string; Location: { X_Lambert72: number } }[] }>(`${geo.url}/geolocation/v4/Location?q=veldstraat%201%20gent&c=5`);
    expect(vla.body.LocationResult[0]).toMatchObject({ FormattedAddress: 'Veldstraat 1, 9000 Gent', LocationType: 'basisregisters_huisnummer_aangeduidDoorBeheerder' });
    expect(vla.body.LocationResult[0].Location.X_Lambert72).toBeGreaterThan(100_000);
    const bru = await request<{ resultsList: { objectType: string; result: { address: { position: { pointGeometry: { point: { srsName: string } } } } }[] }[] }>(
      `${geo.url}/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage=fr&freeText=rue%20neuve%201&model=BeStPlus`);
    expect(bru.body.resultsList[0].objectType).toBe('ext:Address');
    expect(bru.body.resultsList[0].result[0].address.position.pointGeometry.point.srsName).toBe('EPSG:31370');
    const wal = await request<{ candidates: { geotag: { name: string; level: number; geometry: { coordinates: number[] } } }[] }>(
      `${geo.url}/geocodeWS/searchAll?address=rue%20de%20fer%2025%20namur&crs=EPSG:4326&geom=true&lang=fr&levels=1,2,3,4,7`);
    expect(wal.body.candidates[0].geotag).toMatchObject({ name: 'Rue de Fer 25 5000 Namur', level: 4, geometry: { coordinates: [4.8648, 50.4662] } });
    expect((await request(`${geo.url}/geocodeWS/searchAll`)).status).toBe(400);
  });
});

describe('relais local : /api/geocode sur le faux service d’adresses', () => {
  const geocode = (q: string, lang = 'fr') => request<GeocodeResponse>(`${relay.url}/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`);

  it('CA-M4.1 : « rue de fer 25 namur » → « Rue de Fer 25, 5000 Namur », adresse, en moins d’1 s', async () => {
    const t0 = performance.now();
    const r = await geocode('rue de fer 25 namur');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=86400, stale-while-revalidate=604800');
    expect(r.body.results[0]).toMatchObject({ label: 'Rue de Fer 25, 5000 Namur', kind: 'adresse', lat: 50.4662, lon: 4.8648 });
  });

  it('S3 et S1 : « Veldstraat 1, 9000 Gent » et « Rue Neuve 1, 1000 Bruxelles » (nl : Nieuwstraat)', async () => {
    expect((await geocode('veldstraat 1 gent')).body.results[0].label).toBe('Veldstraat 1, 9000 Gent');
    expect((await geocode('Veldstraat 1, 9000 Gent')).body.results[0].label).toBe('Veldstraat 1, 9000 Gent');
    const nl = await geocode('nieuwstraat 1', 'nl');
    expect(nl.body.results[0]).toMatchObject({ label: 'Nieuwstraat 1, 1000 Brussel', names: { fr: 'Rue Neuve 1, 1000 Bruxelles' } });
  });

  it('CA-M4.8 : le faux service ne reçoit que le texte tapé (et la langue), sans position ni identifiant', async () => {
    await request(`${geo.url}/__journal/reset`, { method: 'POST' });
    await request(`${relay.url}/__cache/clear`, { method: 'POST' });
    await request(`${relay.url}/api/geocode?q=${encodeURIComponent('avenue winston churchill 100')}&lang=fr&lat=50.8&lon=4.3&id=abc`, {
      headers: { 'X-Forwarded-For': '203.0.113.9', Cookie: 'session=1', Referer: 'https://quai.example/' },
    });
    const j = await request<{ requests: { source: string; params: Record<string, string>; headers: Record<string, string> }[] }>(`${geo.url}/__journal`);
    expect(j.body.requests.map((x) => x.source).sort()).toEqual(['bru', 'vla', 'wal']);
    for (const x of j.body.requests) {
      const values = Object.values(x.params);
      expect(values).toContain(x.source === 'bru' ? 'fr' : x.source === 'vla' ? '5' : 'EPSG:4326');
      expect(Object.entries(x.params).filter(([k]) => ['q', 'freeText', 'address'].includes(k)).map(([, v]) => v)).toEqual(['avenue winston churchill 100']);
      expect(Object.keys(x.params).some((k) => /lat|lon|id$|position|near/i.test(k) && k !== 'searchLanguage')).toBe(false);
      expect(x.headers['user-agent']).toBe('quai-relay/1.1');
      for (const h of ['x-forwarded-for', 'cookie', 'referer', 'authorization', 'bmc-partner-key', 'ocp-apim-subscription-key']) expect(x.headers).not.toHaveProperty(h);
    }
  });

  it('CA-M4.6 : scène down : HTTP 200 avec error en français, puis retour à la normale', async () => {
    await request(`${geo.url}/__scene/down`, { method: 'POST' });
    await request(`${relay.url}/__cache/clear`, { method: 'POST' });
    const down = await geocode('rue du bois 1 bastogne');
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ results: [], partial: true, error: 'Recherche d’adresse indisponible pour l’instant : gares et arrêts seulement.' });
    expect(down.headers.get('cache-control')).toBe('no-store');
    await request(`${geo.url}/__scene/base`, { method: 'POST' });
    await request(`${relay.url}/__cache/clear`, { method: 'POST' });
    expect((await geocode('rue du bois 1 bastogne')).body.results[0].label).toBe('Rue du Bois 1, 6600 Bastogne');
  });

  it('le journal du relais ne contient jamais le texte cherché', () => {
    const log = relay.output.join('');
    expect(log).toMatch(/GET \/api\/geocode\?q=\(\d+ car\.\)/);
    for (const w of ['churchill', 'bastogne', 'veldstraat', 'nieuwstraat', 'rue de fer']) expect(log.toLowerCase()).not.toContain(w);
  });
});

describe('relais sans BMC_KEY, avec le flux SNCB direct (SNCB_RT_URL)', () => {
  let direct: Proc;
  beforeAll(async () => {
    direct = await startRelay({ BMC_BASE: mock.url, BMC_KEY: '', SNCB_RT_URL: `${mock.url}/sncb-direct/trip-update`, QUAI_NOW: NOW });
  });

  it('SNCB servie par le flux direct sans clé ; autres opérateurs : error en français', async () => {
    const sncb = await request<RtResponse>(`${direct.url}/api/rt?op=sncb&trips=${encodeURIComponent(NAMUR_IC)}`);
    expect(sncb.body.error).toBeUndefined();
    expect(sncb.body.trips[NAMUR_IC].u[0][1]).toBe('8863008_6');
    const dl = await request<RtResponse>(`${direct.url}/api/rt?op=delijn&trips=702321245`);
    expect(dl.status).toBe(200);
    expect(dl.body).toMatchObject({ trips: {}, error: 'Temps réel De Lijn indisponible : clé BMC_KEY absente sur le relais' });
    // la ligne part sur stderr : elle peut arriver juste après la réponse HTTP
    expect(await waitForOutput(direct, /BMC_KEY manquante/)).toBe(true);
  });
});

describe('aucune fuite de la clé', () => {
  it('ni dans les réponses ni dans les journaux du relais et du faux portail', () => {
    expect(seen.length).toBeGreaterThan(40);
    for (const text of seen) expect(text).not.toContain(KEY);
    for (const p of procs) {
      const log = p.output.join('');
      expect(log.length).toBeGreaterThan(0);
      expect(log).not.toContain(KEY);
    }
  });
});
