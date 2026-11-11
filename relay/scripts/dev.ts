/**
 * npm run dev [-- --port 8788] : les cinq points d'entrée du relais sur un serveur Node local,
 * avec les mêmes gestionnaires que sur Vercel (api/*.ts : GET et OPTIONS).
 *
 * Développement seulement :
 *  - BMC_BASE vaut par défaut http://localhost:8789 (npm run mock-bmc) et BMC_KEY vaut 'dev-key' ;
 *  - adresses : sans QUAI_GEO_BASE ni QUAI_GEO_*_BASE, QUAI_GEO_BASE vaut http://localhost:8790 (npm run mock-geocode) ;
 *  - QUAI_NOW=2026-11-10T12:10:00+01:00 fait partir l'horloge du relais de cet instant (filtre des alertes actives) ;
 *  - POST /__cache/clear vide les caches (utile après un changement de scène du faux portail ou du faux service
 *    d'adresses : cache, disjoncteurs et limites des adresses compris).
 * Le journal des requêtes ne montre jamais le texte cherché (q) : seulement sa longueur.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rt from '../api/rt.js';
import * as stib from '../api/stib.js';
import * as alerts from '../api/alerts.js';
import * as health from '../api/health.js';
import * as geocode from '../api/geocode.js';
import { clearSharedCaches, setDevClock } from '../lib/context.js';
import { CORS_HEADERS } from '../lib/http.js';
import { scrub, secretsFrom } from '../lib/log.js';
import { readGeoConfig } from '../lib/config.js';

interface ApiModule {
  GET(request: Request): Promise<Response> | Response;
  OPTIONS(request: Request): Promise<Response> | Response;
}

const ROUTES: Record<string, ApiModule> = { '/api/rt': rt, '/api/stib': stib, '/api/alerts': alerts, '/api/health': health, '/api/geocode': geocode };
const HERE = dirname(fileURLToPath(import.meta.url));

function portArg(argv: string[], fallback: number): number {
  const i = argv.indexOf('--port');
  const v = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith('--port='))?.slice(7);
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Port invalide : ${v}`);
  return n;
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...headers } });

async function route(req: http.IncomingMessage, url: URL): Promise<Response> {
  const method = req.method ?? 'GET';
  if (url.pathname === '/__cache/clear') {
    if (method !== 'POST') return jsonResponse(405, { error: 'POST attendu' });
    clearSharedCaches();
    return jsonResponse(200, { ok: true });
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response(readFileSync(join(HERE, '..', 'public', 'index.html')), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const mod = ROUTES[url.pathname.replace(/\/+$/, '')];
  if (!mod) return jsonResponse(404, { error: 'Introuvable : /api/rt, /api/stib, /api/alerts, /api/health ou /api/geocode' });
  // en-têtes utiles seulement (adresse du client pour la limite par client des adresses)
  const forwarded = req.headers['x-forwarded-for'];
  const headers: Record<string, string> = typeof forwarded === 'string' ? { 'x-forwarded-for': forwarded } : {};
  const request = new Request(url, { method, headers });
  if (method === 'GET') return mod.GET(request);
  if (method === 'OPTIONS') return mod.OPTIONS(request);
  return jsonResponse(405, { error: 'Méthode non autorisée : GET ou OPTIONS' }, { Allow: 'GET, OPTIONS' });
}

async function main(): Promise<void> {
  const port = portArg(process.argv.slice(2), 8788);
  process.env.BMC_BASE ??= 'http://localhost:8789';
  process.env.BMC_KEY ??= 'dev-key';
  if (!['QUAI_GEO_BASE', 'QUAI_GEO_VLA_BASE', 'QUAI_GEO_BRU_BASE', 'QUAI_GEO_WAL_BASE'].some((k) => process.env[k]?.trim())) {
    process.env.QUAI_GEO_BASE = 'http://localhost:8790';
  }
  const now = process.env.QUAI_NOW?.trim();
  if (now && !setDevClock(now)) throw new Error(`QUAI_NOW illisible : ${now}`);

  const server = http.createServer((req, res) => {
    const t0 = performance.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    route(req, url)
      .catch((e: unknown) => {
        console.error(`[dev] erreur : ${e instanceof Error ? e.message : String(e)}`);
        return jsonResponse(500, { error: 'Erreur interne du serveur de développement' });
      })
      .then(async (response) => {
        const body = Buffer.from(await response.arrayBuffer());
        res.statusCode = response.status;
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.end(body);
        if (!url.pathname.startsWith('/__')) {
          let query = url.search;
          try {
            query = decodeURIComponent(query);
          } catch {
            /* encodage invalide : affiché tel quel */
          }
          // vie privée : le texte cherché n'est jamais écrit, seulement sa longueur
          if (url.searchParams.has('q')) query = `?q=(${[...(url.searchParams.get('q') ?? '')].length} car.)${url.searchParams.has('lang') ? `&lang=${url.searchParams.get('lang')}` : ''}`;
          const line = `[dev] ${req.method} ${url.pathname}${query} -> ${response.status} (${Math.round(performance.now() - t0)} ms)`;
          console.log(scrub(line, secretsFrom(process.env)));
        }
      })
      .catch(() => res.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  const env = process.env;
  console.log(`[dev] BMC_BASE = ${env.BMC_BASE} ; BMC_KEY ${env.BMC_KEY ? 'définie' : 'absente'} ; SNCB_RT_URL ${env.SNCB_RT_URL ? 'définie' : 'absente'} ; DATA_BASE = ${env.DATA_BASE || '(absente)'}${now ? ` ; horloge depuis ${now}` : ''}`);
  const geo = readGeoConfig(env);
  console.log(`[dev] adresses : sources ${geo.sources.join(',') || '(aucune)'} ; ${geo.sources.map((id) => `${id} = ${geo.base[id]}`).join(' ; ')}`);
  console.log(`[dev] Relais Quai (dev) : http://localhost:${actual}`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e: unknown) => {
  console.error(`[dev] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
