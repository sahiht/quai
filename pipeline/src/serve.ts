/**
 * npm run serve-data -- --dir <dossier> [--port 8787] [--host 127.0.0.1]
 * Petit serveur statique de test : Access-Control-Allow-Origin: *, types JSON corrects, gzip si accepté.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.zip': 'application/zip',
  '.pb': 'application/x-protobuf',
};
const COMPRESSIBLE = new Set(['.json', '.html', '.txt', '.js', '.css', '.svg']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export function createDataServer(dir: string, log: (msg: string) => void = () => undefined): Server {
  const root = resolve(dir);
  return createServer(async (req, res) => {
    const send = (status: number, body: string, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { ...CORS, 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(405, JSON.stringify({ error: 'méthode non autorisée' }));
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      let rel: string;
      try {
        rel = decodeURIComponent(url.pathname);
      } catch {
        send(400, JSON.stringify({ error: 'chemin invalide' }));
        return;
      }
      let path = resolve(join(root, rel));
      if (path !== root && !path.startsWith(root + sep)) {
        send(403, JSON.stringify({ error: 'accès refusé' }));
        return;
      }
      let st = await stat(path).catch(() => null);
      if (st?.isDirectory()) {
        path = join(path, 'index.html');
        st = await stat(path).catch(() => null);
      }
      if (!st?.isFile()) {
        send(404, JSON.stringify({ error: 'fichier introuvable', path: rel }));
        log(`404 ${rel}`);
        return;
      }
      const ext = extname(path).toLowerCase();
      const headers: Record<string, string> = {
        ...CORS,
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        Vary: 'Accept-Encoding',
      };
      const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? '')) && st.size > 256;
      if (gzip) headers['Content-Encoding'] = 'gzip';
      else headers['Content-Length'] = String(st.size);
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(path);
      stream.on('error', () => res.destroy());
      if (gzip) stream.pipe(createGzip()).pipe(res);
      else stream.pipe(res);
    } catch (e) {
      if (!res.headersSent) send(500, JSON.stringify({ error: 'erreur du serveur' }));
      else res.destroy();
      log(`erreur : ${(e as Error).message}`);
    }
  });
}

function main(): void {
  let values: { dir?: string; port?: string; host?: string };
  try {
    ({ values } = parseArgs({ options: { dir: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' } } }));
  } catch (e) {
    console.error(`Erreur : ${(e as Error).message}\nUsage : npm run serve-data -- --dir <dossier> [--port 8787] [--host 127.0.0.1]`);
    process.exitCode = 2;
    return;
  }
  if (!values.dir) {
    console.error('Erreur : --dir <dossier> est obligatoire\nUsage : npm run serve-data -- --dir <dossier> [--port 8787] [--host 127.0.0.1]');
    process.exitCode = 2;
    return;
  }
  const dir = resolve(process.env.INIT_CWD || process.cwd(), values.dir);
  const port = Number(values.port ?? 8787);
  const host = values.host ?? '127.0.0.1';
  const server = createDataServer(dir, (m) => console.log(m));
  server.listen(port, host, () => {
    const addr = server.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`Données servies depuis ${dir} sur http://${host === '0.0.0.0' ? 'localhost' : host}:${p}/`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
