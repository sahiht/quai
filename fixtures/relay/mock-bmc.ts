/**
 * npm run mock-bmc (depuis relay/) [-- --port 8789] : faux portail Belgian Mobility Company pour les tests.
 *
 * Sert les fixtures de fixtures/relay/ sur les vrais chemins du portail, en exigeant les deux en-têtes
 * bmc-partner-key et Ocp-Apim-Subscription-Key (sinon 401, comme Azure API Management) :
 *   GET /api/gtfs/feed/{nmbssncb|delijn|tec}/rt/trip-update?format=protobuf
 *   GET /api/gtfs/feed/{nmbssncb|delijn|tec}/rt/alert?format=protobuf
 *   GET /api/datasets/stibmivb/rt/WaitingTimes?where=pointid="5153" or pointid="5154"&limit=100&offset=0
 *   GET /api/gtfs/feed/{nmbssncb|stibmivb|delijn|tec}/static  (zips de fixtures/pipeline/gtfs/ s'ils existent)
 * Sans clé : GET /sncb-direct/trip-update (variante du flux SNCB direct, pour SNCB_RT_URL).
 * Pilotage : POST /__scene/base, POST /__scene/noRT (toutes les routes en 503), GET /__scene,
 *            GET /__stats (requêtes reçues par chemin), POST /__stats/reset.
 * Variable optionnelle MOCK_BMC_KEY : n'accepter que cette clé (sinon toute clé non vide).
 */
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export type Scene = 'base' | 'noRT';

export interface MockBmcOptions {
  port?: number;
  /** Clé exigée ; absente = toute clé non vide est acceptée. */
  key?: string | null;
  /** Dossier des fixtures (défaut : celui de ce fichier). */
  fixturesDir?: string;
  /** Dossier des zips GTFS de l'équipe données (défaut : fixtures/pipeline/gtfs). */
  gtfsDir?: string;
  log?: (line: string) => void;
}

export interface MockBmc {
  url: string;
  port: number;
  scene(): Scene;
  setScene(scene: Scene): void;
  stats(): Record<string, number>;
  close(): Promise<void>;
}

const RT_SLUGS = new Set(['nmbssncb', 'delijn', 'tec']);
const STATIC_FILES: Record<string, string> = { nmbssncb: 'sncb', stibmivb: 'stib', delijn: 'delijn', tec: 'tec' };
const ODS_MAX_LIMIT = 100;

type Row = Record<string, unknown>;

/** Arrêts demandés dans la clause where (pointid="5153" or pointid="5154", ou pointid in (...)). */
export function wherePoints(where: string): Set<string> {
  const ids = new Set<string>();
  for (const m of where.matchAll(/pointid\s*=\s*["']?(\d+)["']?/gi)) ids.add(m[1]);
  for (const m of where.matchAll(/pointid\s+in\s*\(([^)]*)\)/gi)) for (const x of m[1].matchAll(/\d+/g)) ids.add(x[0]);
  return ids;
}

export function startMockBmc(opts: MockBmcOptions = {}): Promise<MockBmc> {
  const dir = opts.fixturesDir ?? HERE;
  const gtfsDir = opts.gtfsDir ?? join(HERE, '..', 'pipeline', 'gtfs');
  const key = opts.key ?? null;
  const log = opts.log ?? ((line: string) => console.log(line));
  let scene: Scene = 'base';
  const counts: Record<string, number> = {};

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock-bmc');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const send = (status: number, body: string | Buffer, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
      res.end(method === 'HEAD' ? undefined : body);
      if (!path.startsWith('/__')) log(`[faux BMC] ${method} ${path} -> ${status}`);
    };
    const error = (status: number, message: string) => send(status, JSON.stringify({ statusCode: status, message }));

    // Pilotage
    if (path === '/__scene') return send(200, JSON.stringify({ scene }));
    const sceneMatch = /^\/__scene\/(base|noRT)$/.exec(path);
    if (sceneMatch) {
      if (method !== 'POST') return error(405, 'POST attendu');
      scene = sceneMatch[1] as Scene;
      log(`[faux BMC] scène : ${scene}`);
      return send(200, JSON.stringify({ scene }));
    }
    if (path === '/__stats') return send(200, JSON.stringify({ requests: counts }));
    if (path === '/__stats/reset') {
      for (const k of Object.keys(counts)) delete counts[k];
      return send(200, JSON.stringify({ requests: counts }));
    }

    counts[path] = (counts[path] ?? 0) + 1;
    if (scene === 'noRT') return error(503, 'Service indisponible (scène noRT)');
    if (method !== 'GET' && method !== 'HEAD') return error(405, 'Méthode non prise en charge');

    const serveFile = (file: string, type: string) => {
      if (!existsSync(file)) return error(404, 'Fixture absente : lancer npm run make-rt');
      return send(200, readFileSync(file), type);
    };

    if (path === '/sncb-direct/trip-update') return serveFile(join(dir, 'sncb-direct', 'trip-update.pb'), 'application/x-protobuf');

    if (!path.startsWith('/api/')) return error(404, 'Resource not found');

    // Authentification façon Azure API Management : les deux en-têtes sont exigés.
    const k1 = req.headers['bmc-partner-key'];
    const k2 = req.headers['ocp-apim-subscription-key'];
    if (!k1 || !k2) {
      return error(401, 'Access denied due to missing subscription key. Make sure to include subscription key when making requests to an API.');
    }
    if (key && (k1 !== key || k2 !== key)) {
      return error(401, 'Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.');
    }

    const rt = /^\/api\/gtfs\/feed\/([a-z]+)\/rt\/(trip-update|alert)$/.exec(path);
    if (rt && RT_SLUGS.has(rt[1])) {
      const format = url.searchParams.get('format');
      if (format && format !== 'protobuf') return error(400, 'Seul format=protobuf est simulé');
      return serveFile(join(dir, 'bmc', rt[1], `${rt[2]}.pb`), 'application/x-protobuf');
    }

    const st = /^\/api\/gtfs\/feed\/([a-z]+)\/static$/.exec(path);
    if (st && STATIC_FILES[st[1]]) {
      const file = join(gtfsDir, `${STATIC_FILES[st[1]]}.zip`);
      if (!existsSync(file)) return error(404, `GTFS de test absent : fixtures/pipeline/gtfs/${STATIC_FILES[st[1]]}.zip`);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': statSync(file).size });
      log(`[faux BMC] ${method} ${path} -> 200`);
      if (method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
      return;
    }

    if (path === '/api/datasets/stibmivb/rt/WaitingTimes') {
      const file = join(dir, 'bmc', 'stibmivb', 'waiting-times.json');
      if (!existsSync(file)) return error(404, 'Fixture absente : lancer npm run make-rt');
      const all = (JSON.parse(readFileSync(file, 'utf8')) as { results: Row[] }).results;
      const where = url.searchParams.get('where');
      const ids = where ? wherePoints(where) : null;
      const rows = ids ? all.filter((r) => ids.has(String(r.pointid))) : all;
      const limit = Number(url.searchParams.get('limit') ?? 10);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(limit) || limit < -1 || limit > ODS_MAX_LIMIT) {
        return send(400, JSON.stringify({
          error_code: 'InvalidRESTParameterError',
          message: `Invalid value for limit API parameter: ${url.searchParams.get('limit')} was found but -1 <= limit <= ${ODS_MAX_LIMIT} is expected.`,
        }));
      }
      if (!Number.isInteger(offset) || offset < 0) {
        return send(400, JSON.stringify({ error_code: 'InvalidRESTParameterError', message: 'Invalid value for offset API parameter.' }));
      }
      const page = limit === -1 ? rows.slice(offset) : rows.slice(offset, offset + limit);
      return send(200, JSON.stringify({ total_count: rows.length, results: page }));
    }

    return error(404, 'Resource not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8789, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : opts.port ?? 8789;
      resolve({
        url: `http://localhost:${port}`,
        port,
        scene: () => scene,
        setScene: (s) => {
          scene = s;
        },
        stats: () => ({ ...counts }),
        close: () => new Promise<void>((done) => server.close(() => done())),
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
  const mock = await startMockBmc({ port: portArg(process.argv.slice(2), 8789), key: process.env.MOCK_BMC_KEY?.trim() || null });
  console.log(`[faux BMC] prêt : ${mock.url} (scène base${process.env.MOCK_BMC_KEY ? ', clé imposée par MOCK_BMC_KEY' : ', toute clé acceptée'})`);
  console.log(`[faux BMC] scènes : curl -X POST ${mock.url}/__scene/noRT ; curl -X POST ${mock.url}/__scene/base`);
  const stop = () => {
    void mock.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(`[faux BMC] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
