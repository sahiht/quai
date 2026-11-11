/**
 * npm run mock-geocode (depuis relay/) [-- --port 8790] : faux service d'adresses pour les tests (PRD M4, annexe A.2).
 *
 * Imite les trois services officiels, sur leurs vrais chemins et avec leurs formats de réponse
 * (fixtures/relay/geocode/README.md), à partir du tableau fixtures/relay/geocode/fake-addresses.json :
 *   GET /geolocation/v4/Location?q=…&c=5                                   (Digitaal Vlaanderen, Geolocation v4)
 *   GET /geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage=fr&freeText=…&model=BeStPlus
 *                                                                          (Paradigm, registre bruxellois)
 *   GET /geocodeWS/searchAll?address=…&crs=EPSG:4326&geom=true&lang=fr&levels=1,2,3,4,7   (SPW, ICAR)
 * Le relais s'y branche avec QUAI_GEO_BASE=http://localhost:8790 (ou les trois QUAI_GEO_*_BASE).
 *
 * Comme les vrais services : le service flamand couvre aussi Bruxelles (noms néerlandais, LocationType urbis_*),
 * le service bruxellois donne les noms français et néerlandais et ses positions en Lambert 72, le service wallon
 * rend la Wallonie seulement, en EPSG:31370 par défaut ou en EPSG:4326 si demandé.
 *
 * Pilotage :
 *   POST /__scene/base | /__scene/down (HTTP 503) | /__scene/slow (réponse après 3 s) | /__scene/garbage (HTML en 200),
 *        avec ?sources=wal,bru pour ne toucher que ces services ; GET /__scene
 *   GET /__journal : requêtes reçues (service, chemin, paramètres, en-têtes), pour vérifier qu'elles ne contiennent
 *        que le texte tapé (CA-M4.8) ; POST /__journal/reset
 *   GET /__stats (requêtes par service), POST /__stats/reset
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wgs84ToLambert2008, wgs84ToLambert72 } from '../../relay/lib/geocode/lambert.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKE_ADDRESSES_FILE = join(HERE, 'geocode', 'fake-addresses.json');

export type GeoId = 'vla' | 'bru' | 'wal';
export type GeoScene = 'base' | 'down' | 'slow' | 'garbage';
export const GEO_SCENES: readonly GeoScene[] = ['base', 'down', 'slow', 'garbage'];
/** Retard de la scène slow : au-delà du délai de 2 s du relais. */
export const SLOW_MS = 3_000;

export interface FakeAddress {
  id: string;
  region: GeoId;
  kind?: 'adresse' | 'rue';
  street: { fr?: string; nl?: string };
  number?: string;
  postcode: string;
  municipality: { fr?: string; nl?: string };
  lat: number;
  lon: number;
  typed: string[];
  note?: string;
}

export function loadFakeAddresses(file = FAKE_ADDRESSES_FILE): FakeAddress[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { addresses: FakeAddress[] }).addresses;
}

export interface JournalEntry {
  at: string;
  source: GeoId | null;
  method: string;
  path: string;
  params: Record<string, string>;
  headers: Record<string, string>;
}

export interface MockGeoState {
  scene: GeoScene;
  /** Services touchés par la scène (vide : tous). */
  only: Set<GeoId>;
  journal: JournalEntry[];
  counts: Record<string, number>;
}

export const createMockGeoState = (): MockGeoState => ({ scene: 'base', only: new Set(), journal: [], counts: {} });

/** Chemins des trois services. */
export const MOCK_PATHS: Readonly<Record<GeoId, string>> = {
  vla: '/geolocation/v4/Location',
  bru: '/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject',
  wal: '/geocodeWS/searchAll',
};

/* ------------------------------ Correspondance (simple, comme un moteur plein texte) ------------------------------ */

const SMALL = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'a', 'au', 'aux', 'van', 'het', 'der', 'den', 'ter', 'te', 'op']);

function words(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Chaque mot tapé significatif doit se retrouver dans l'adresse (le dernier peut n'en être que le début). */
function matches(typed: string, names: string[]): boolean {
  const want = words(typed).filter((w) => !SMALL.has(w));
  if (!want.length) return false;
  const have = new Set(names.flatMap(words));
  return want.every((w, i) => have.has(w) || (i === want.length - 1 && !/^\d+$/.test(w) && w.length >= 2 && [...have].some((h) => h.startsWith(w))));
}

const kindOf = (a: FakeAddress) => a.kind ?? (a.number ? 'adresse' : 'rue');

function namesIn(a: FakeAddress, lang: 'fr' | 'nl' | 'both'): string[] {
  const pick = (o: { fr?: string; nl?: string }) => (lang === 'both' ? [o.fr, o.nl] : [o[lang] ?? o.fr ?? o.nl]);
  return [...pick(a.street), ...pick(a.municipality), a.number ?? '', a.postcode].filter((x): x is string => !!x);
}

/* ------------------------------ Réponses au format de chaque service ------------------------------ */

const r2 = (v: number) => Math.round(v * 100) / 100;

function vlaReply(table: FakeAddress[], params: URLSearchParams): { status: number; body: unknown } {
  const q = params.get('q') ?? '';
  if (q.trim().length < 2) return { status: 400, body: { Message: 'The request is invalid.' } };
  const c = Math.min(5, Math.max(1, Number(params.get('c') ?? 1) || 1));
  const found = table.filter((a) => (a.region === 'vla' || a.region === 'bru') && (a.street.nl || a.municipality.nl) && matches(q, namesIn(a, 'nl')));
  const LocationResult = found.slice(0, c).map((a, i) => {
    const street = a.street.nl ?? a.street.fr ?? null;
    const muni = a.municipality.nl ?? a.municipality.fr ?? null;
    const l72 = wgs84ToLambert72(a.lat, a.lon);
    const l08 = wgs84ToLambert2008(a.lat, a.lon);
    const loc = { Lat_WGS84: a.lat, Lon_WGS84: a.lon, X_Lambert72: r2(l72.x), Y_Lambert72: r2(l72.y), X_Lambert2008: r2(l08.x), Y_Lambert2008: r2(l08.y) };
    const addr = kindOf(a) === 'adresse';
    const prefix = a.region === 'bru' ? 'urbis' : 'basisregisters';
    return {
      Municipality: muni,
      Zipcode: a.postcode,
      Thoroughfarename: street,
      Housenumber: addr ? a.number : null,
      ID: 900000 + i,
      FormattedAddress: addr ? `${street} ${a.number}, ${a.postcode} ${muni}` : `${street}, ${muni}`,
      Location: loc,
      LocationType: addr ? (a.region === 'bru' ? 'urbis_huisnummer' : 'basisregisters_huisnummer_aangeduidDoorBeheerder') : `${prefix}_straat`,
      BoundingBox: { LowerLeft: loc, UpperRight: loc },
    };
  });
  return { status: 200, body: { LocationResult } };
}

function bruReply(table: FakeAddress[], params: URLSearchParams): { status: number; body: unknown } {
  const lang = params.get('searchLanguage');
  const text = params.get('freeText') ?? '';
  const model = (params.get('model') ?? '').toLowerCase();
  if ((lang !== 'fr' && lang !== 'nl') || !text.trim() || (model !== 'bestplus' && model !== 'best')) {
    return { status: 400, body: { status: 400, error: 'Bad Request', message: 'searchLanguage (fr|nl), freeText et model (BeStPlus|BeSt) sont obligatoires' } };
  }
  const found = table.filter((a) => a.region === 'bru' && matches(text, namesIn(a, 'both')));
  const names = (o: { fr?: string; nl?: string }) => (['fr', 'nl'] as const).filter((l) => o[l]).map((l) => ({ language: l, spelling: o[l] }));
  const code = (ns: string, id: string) => ({ namespace: `https://databrussels.be/id/${ns}`, objectIdentifier: id, versionIdentifier: '2026-11-04T00:00:00' });
  const position = (a: FakeAddress) => {
    const p = wgs84ToLambert72(a.lat, a.lon);
    return { pointGeometry: { point: { pos: `${p.x.toFixed(2)} ${p.y.toFixed(2)}`, srsName: 'EPSG:31370' } } };
  };
  const muni = (a: FakeAddress) => ({ code: code('municipality', a.postcode), name: names(a.municipality) });
  const streets = found.filter((a) => kindOf(a) === 'rue').map((a, i) => ({
    score: Math.round((0.95 - i * 0.05) * 100) / 100,
    streetname: { code: code('streetname', a.id), name: names(a.street), hasMunicipality: muni(a), hasPostalInfo: [{ code: code('postalinfo', a.postcode) }], position: position(a) },
  }));
  const addresses = found.filter((a) => kindOf(a) === 'adresse').map((a, i) => ({
    score: Math.round((0.9 - i * 0.05) * 100) / 100,
    address: {
      code: code('address', a.id), houseNumber: a.number, boxNumber: null, addressStatus: { status: 'current' },
      position: { ...position(a), positionGeometryMethod: 'assignedByAdministrator', positionSpecification: 'entrance' },
      hasStreetName: { code: code('streetname', a.id), name: names(a.street) },
      hasMunicipality: muni(a),
      hasPostalInfo: { code: code('postalinfo', a.postcode) },
    },
  }));
  const resultsList = [
    ...(streets.length ? [{ objectType: 'ext:StreetName', result: streets }] : []),
    ...(addresses.length ? [{ objectType: 'ext:Address', result: addresses }] : []),
  ];
  return { status: 200, body: { resultsList } };
}

function walReply(table: FakeAddress[], params: URLSearchParams): { status: number; body: unknown } {
  const address = params.get('address') ?? '';
  if (!address.trim()) return { status: 400, body: { message: 'Le paramètre address est obligatoire' } };
  const crs = params.get('crs') ?? 'EPSG:31370';
  if (!['EPSG:31370', 'EPSG:4326', 'EPSG:3812', 'EPSG:3857'].includes(crs)) return { status: 400, body: { message: `crs non pris en charge : ${crs}` } };
  const geom = (params.get('geom') ?? 'false').toLowerCase() === 'true';
  const lang = params.get('lang') ?? 'fr';
  const levels = (params.get('levels') ?? '1,2,3,4,5,6,7').split(',').map(Number);
  const found = table.filter((a) => a.region === 'wal' && levels.includes(kindOf(a) === 'adresse' ? 4 : 3) && matches(address, namesIn(a, 'fr')));
  const candidates = found.map((a, i) => {
    const level = kindOf(a) === 'adresse' ? 4 : 3;
    const name = level === 4 ? `${a.street.fr} ${a.number} ${a.postcode} ${a.municipality.fr}` : `${a.street.fr} ${a.postcode} ${a.municipality.fr}`;
    const coords = crs === 'EPSG:4326' ? [a.lon, a.lat] : crs === 'EPSG:3812'
      ? (({ x, y }) => [x, y])(wgs84ToLambert2008(a.lat, a.lon))
      : (({ x, y }) => [x, y])(wgs84ToLambert72(a.lat, a.lon));
    const geotag: Record<string, unknown> = { ident: String(360000 + i), level, name, lang: 'fr' };
    if (geom) geotag.geometry = { type: 'Point', crs: { type: 'name', properties: { name: crs } }, coordinates: coords };
    return { score: 0.04761905, geotag };
  });
  return {
    status: 200,
    body: { geotag: { address, levels: params.get('levels') ?? '1,2,3,4,5,6,7', bbox: false, geom, crs, scopes: ['WAL'], lang }, candidates },
  };
}

export interface MockReply { status: number; type: string; body: string; delayMs: number; source: GeoId | null }

/**
 * Réponse du faux service pour une requête (utilisée par le serveur et, en mémoire, par les tests du relais).
 * Note la requête au journal (sauf les chemins de pilotage).
 */
export function mockGeoReply(
  state: MockGeoState, table: FakeAddress[], method: string, url: URL, headers: Record<string, string>,
): MockReply {
  const json = (status: number, body: unknown, source: GeoId | null = null, delayMs = 0): MockReply =>
    ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(body), delayMs, source });
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/__scene') return json(200, { scene: state.scene, sources: [...state.only] });
  const scene = /^\/__scene\/(base|down|slow|garbage)$/.exec(path);
  if (scene) {
    if (method !== 'POST') return json(405, { error: 'POST attendu' });
    state.scene = scene[1] as GeoScene;
    state.only = new Set((url.searchParams.get('sources') ?? '').split(',').map((s) => s.trim()).filter((s): s is GeoId => s === 'vla' || s === 'bru' || s === 'wal'));
    return json(200, { scene: state.scene, sources: [...state.only] });
  }
  if (path === '/__journal') return json(200, { requests: state.journal });
  if (path === '/__journal/reset') {
    state.journal.length = 0;
    return json(200, { requests: [] });
  }
  if (path === '/__stats') return json(200, { requests: state.counts });
  if (path === '/__stats/reset') {
    for (const k of Object.keys(state.counts)) delete state.counts[k];
    return json(200, { requests: {} });
  }

  const source = (Object.keys(MOCK_PATHS) as GeoId[]).find((id) => MOCK_PATHS[id] === path) ?? null;
  state.journal.push({ at: new Date().toISOString(), source, method, path, params: Object.fromEntries(url.searchParams), headers });
  if (!source) return json(404, { error: 'Introuvable' });
  state.counts[source] = (state.counts[source] ?? 0) + 1;
  if (method !== 'GET') return json(405, { error: 'GET attendu' }, source);

  const touched = state.only.size === 0 || state.only.has(source);
  if (touched && state.scene === 'down') {
    return { status: 503, type: 'text/html; charset=utf-8', body: '<html><body><h1>503 Service Unavailable</h1></body></html>', delayMs: 0, source };
  }
  if (touched && state.scene === 'garbage') {
    return { status: 200, type: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><body>Maintenance</body></html>', delayMs: 0, source };
  }
  const reply = source === 'vla' ? vlaReply(table, url.searchParams) : source === 'bru' ? bruReply(table, url.searchParams) : walReply(table, url.searchParams);
  return json(reply.status, reply.body, source, touched && state.scene === 'slow' ? SLOW_MS : 0);
}

/* ------------------------------ Serveur ------------------------------ */

export interface MockGeocodeOptions {
  port?: number;
  table?: FakeAddress[];
  log?: (line: string) => void;
}

export interface MockGeocode {
  url: string;
  port: number;
  state: MockGeoState;
  close(): Promise<void>;
}

export function startMockGeocode(opts: MockGeocodeOptions = {}): Promise<MockGeocode> {
  const table = opts.table ?? loadFakeAddresses();
  const log = opts.log ?? ((line: string) => console.log(line));
  const state = createMockGeoState();
  const timers = new Set<NodeJS.Timeout>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock-geocode');
    const method = req.method ?? 'GET';
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    const reply = mockGeoReply(state, table, method, url, headers);
    const send = () => {
      if (res.destroyed) return;
      res.writeHead(reply.status, { 'Content-Type': reply.type, 'Content-Length': Buffer.byteLength(reply.body) });
      res.end(reply.body);
      if (reply.source) log(`[faux adresses] ${method} ${url.pathname} -> ${reply.status}${reply.delayMs ? ` (après ${reply.delayMs} ms)` : ''}`);
    };
    if (url.pathname.startsWith('/__scene/') && method === 'POST') log(`[faux adresses] scène : ${state.scene}${state.only.size ? ` (${[...state.only].join(', ')})` : ''}`);
    if (reply.delayMs > 0) {
      const t = setTimeout(() => {
        timers.delete(t);
        send();
      }, reply.delayMs);
      timers.add(t);
    } else send();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8790, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : opts.port ?? 8790;
      resolve({
        url: `http://localhost:${port}`,
        port,
        state,
        close: () => new Promise<void>((done) => {
          for (const t of timers) clearTimeout(t);
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

function portArg(argv: string[], fallback: number): number {
  const i = argv.indexOf('--port');
  const v = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith('--port='))?.slice(7);
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Port invalide : ${v}`);
  return n;
}

async function main(): Promise<void> {
  const mock = await startMockGeocode({ port: portArg(process.argv.slice(2), 8790) });
  console.log(`[faux adresses] prêt : ${mock.url} (scène base, ${loadFakeAddresses().length} adresses)`);
  console.log(`[faux adresses] relais : QUAI_GEO_BASE=${mock.url} npm run dev ; scènes : curl -X POST ${mock.url}/__scene/down ; journal : curl ${mock.url}/__journal`);
  const stop = () => {
    void mock.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(`[faux adresses] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
