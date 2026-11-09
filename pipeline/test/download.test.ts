/** Téléchargement : en-têtes, nouvelles tentatives, replis, redirections, délais, masquage de la clé. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DownloadError, downloadFeed, maskSecrets } from '../src/download.ts';
import { buildData } from '../src/build.ts';
import { staticTargets } from '../src/config.ts';
import { cleanupTempDirs, FIXTURE_ZIPS, tempDir } from './helpers.ts';

const KEY = 'cle-secrete-1234567890';
const ZIP = readFileSync(join(FIXTURE_ZIPS, 'tec.zip'));

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_q, r) => r.end();
const seen: { url: string; headers: IncomingMessage['headers']; port: number }[] = [];

function startServer(h: () => Handler): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      seen.push({ url: req.url ?? '', headers: req.headers, port: (server.address() as AddressInfo).port });
      h()(req, res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

let a: { server: Server; base: string };
let b: { server: Server; base: string };
let handlerB: Handler = (_q, r) => r.end();

beforeAll(async () => {
  a = await startServer(() => handler);
  b = await startServer(() => handlerB);
});
afterAll(async () => {
  await new Promise((r) => a.server.close(r));
  await new Promise((r) => b.server.close(r));
  cleanupTempDirs();
});
afterEach(() => {
  seen.length = 0;
});

const fast = { backoffMs: [10, 10, 10], stallMs: 2000, timeoutMs: 10_000 };
const zipOk: Handler = (_q, r) => {
  r.writeHead(200, { 'Content-Type': 'application/zip' });
  r.end(ZIP);
};

describe('downloadFeed', () => {
  it('envoie les deux en-têtes de clé et écrit le zip', async () => {
    handler = zipOk;
    const dest = join(tempDir(), 'f.zip');
    const r = await downloadFeed({ ...fast, targets: [{ url: `${a.base}/api/gtfs/feed/tec/static`, withKey: true, label: 'TEC, portail BMC' }], dest, key: KEY });
    expect(r.bytes).toBe(ZIP.length);
    expect(readFileSync(dest).equals(ZIP)).toBe(true);
    expect(seen[0].headers['bmc-partner-key']).toBe(KEY);
    expect(seen[0].headers['ocp-apim-subscription-key']).toBe(KEY);
  });

  it('3 nouvelles tentatives au plus sur erreur serveur, puis succès', async () => {
    let n = 0;
    handler = (q, r) => {
      if (++n <= 3) {
        r.writeHead(503);
        r.end('indisponible');
      } else zipOk(q, r);
    };
    const logs: string[] = [];
    const dest = join(tempDir(), 'f.zip');
    await downloadFeed({ ...fast, targets: [{ url: `${a.base}/x`, withKey: true, label: 'BMC' }], dest, key: KEY, log: (m) => logs.push(m) });
    expect(n).toBe(4);
    expect(logs.filter((l) => l.includes('nouvel essai'))).toHaveLength(3);
  });

  it('abandonne après 1 + 3 essais, passe au repli ; le repli sans clé ne reçoit pas la clé', async () => {
    let n = 0;
    handler = (_q, r) => {
      n++;
      r.writeHead(500);
      r.end();
    };
    handlerB = zipOk;
    const dest = join(tempDir(), 'f.zip');
    const r = await downloadFeed({
      ...fast, dest, key: KEY,
      targets: [{ url: `${a.base}/bmc`, withKey: true, label: 'BMC' }, { url: `${b.base}/TEC-GTFS.zip`, withKey: false, label: 'repli' }],
    });
    expect(n).toBe(4);
    expect(r.target.label).toBe('repli');
    const fallback = seen.find((s) => s.url === '/TEC-GTFS.zip');
    expect(fallback?.headers['bmc-partner-key']).toBeUndefined();
    expect(fallback?.headers['ocp-apim-subscription-key']).toBeUndefined();
  });

  it('clé refusée (401) : pas de nouvel essai sur la même adresse ; message en français sans la clé', async () => {
    let n = 0;
    handler = (_q, r) => {
      n++;
      r.writeHead(401);
      r.end(`clé invalide ${KEY}`);
    };
    const dest = join(tempDir(), 'f.zip');
    const err = await downloadFeed({ ...fast, dest, key: KEY, targets: [{ url: `${a.base}/bmc`, withKey: true, label: 'SNCB, portail BMC' }] }).catch((e) => e);
    expect(n).toBe(1);
    expect(err).toBeInstanceOf(DownloadError);
    expect(err.message).toBe('téléchargement impossible (SNCB, portail BMC : HTTP 401, clé refusée ou abonnement manquant)');
    expect(err.message).not.toContain(KEY);
  });

  it('suit les redirections ; la clé n’est envoyée qu’à la même origine', async () => {
    handler = (q, r) => {
      if (q.url === '/start') {
        r.writeHead(302, { Location: '/same' });
        r.end();
      } else if (q.url === '/same') {
        r.writeHead(307, { Location: `${b.base}/blob.zip` });
        r.end();
      }
    };
    handlerB = zipOk;
    const dest = join(tempDir(), 'f.zip');
    await downloadFeed({ ...fast, dest, key: KEY, targets: [{ url: `${a.base}/start`, withKey: true, label: 'BMC' }] });
    expect(seen.map((s) => s.url)).toEqual(['/start', '/same', '/blob.zip']);
    expect(seen[1].headers['bmc-partner-key']).toBe(KEY);
    expect(seen[2].headers['bmc-partner-key']).toBeUndefined();
    expect(readFileSync(dest).equals(ZIP)).toBe(true);
  });

  it('contenu qui n’est pas un zip : erreur claire', async () => {
    handler = (_q, r) => {
      r.writeHead(200, { 'Content-Type': 'application/json' });
      r.end('{"statusCode":401,"message":"Access denied"}');
    };
    const dest = join(tempDir(), 'f.zip');
    await expect(downloadFeed({ ...fast, retries: 1, dest, key: KEY, targets: [{ url: `${a.base}/x`, withKey: true, label: 'BMC' }] }))
      .rejects.toThrow("téléchargement impossible (BMC : le contenu reçu n'est pas une archive zip)");
  });

  it('serveur muet en cours de transfert : délai dépassé', async () => {
    handler = (_q, r) => {
      r.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(ZIP.length) });
      r.write(ZIP.subarray(0, 100)); // puis plus rien
    };
    const dest = join(tempDir(), 'f.zip');
    const t0 = Date.now();
    await expect(downloadFeed({ ...fast, stallMs: 300, retries: 1, dest, key: KEY, targets: [{ url: `${a.base}/x`, withKey: true, label: 'BMC' }] }))
      .rejects.toThrow('téléchargement impossible (BMC : délai dépassé)');
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('serveur injoignable : erreur réseau', async () => {
    const dest = join(tempDir(), 'f.zip');
    await expect(downloadFeed({ ...fast, retries: 0, dest, key: KEY, targets: [{ url: 'http://127.0.0.1:1/x', withKey: true, label: 'BMC' }] }))
      .rejects.toThrow(/BMC : erreur réseau/);
  });
});

describe('masquage', () => {
  it('remplace la clé et sa forme encodée', () => {
    expect(maskSecrets('a cle+/=x b', ['cle+/=x'])).toBe('a *** b');
    expect(maskSecrets('url?k=cle%2B%2F%3Dx', ['cle+/=x'])).toBe('url?k=***');
    expect(maskSecrets('rien', [undefined, 'ab'])).toBe('rien');
  });
});

describe('buildData avec téléchargement', () => {
  it('un opérateur en échec n’empêche pas les autres ; message sans secret dans meta', async () => {
    handler = (q, r) => {
      if (q.url?.includes('/stibmivb/')) {
        r.writeHead(403);
        r.end(KEY);
      } else if (q.url?.includes('/tec/')) {
        r.writeHead(200);
        r.end(readFileSync(join(FIXTURE_ZIPS, 'tec.zip')));
      } else {
        r.writeHead(404);
        r.end();
      }
    };
    const out = join(tempDir(), 'data');
    const sources = {
      sncb: { kind: 'missing' as const, reason: 'source non fournie dans QUAI_SOURCES' },
      stib: { kind: 'download' as const, targets: staticTargets('stib', a.base) },
      delijn: { kind: 'file' as const, path: join(FIXTURE_ZIPS, 'delijn.zip') },
      tec: { kind: 'download' as const, targets: staticTargets('tec', a.base).slice(0, 1) },
    };
    const logs: string[] = [];
    const r = await buildData({ out, dates: ['2026-11-10', '2026-11-11'], key: KEY, sources, download: fast, log: (m) => logs.push(m) });
    expect(r.meta.feeds.stib).toEqual({ ok: false, error: 'téléchargement impossible (STIB, portail BMC : HTTP 403, clé refusée ou abonnement manquant)', areas: 0, trips: 0 });
    expect(r.meta.feeds.sncb).toMatchObject({ ok: false, error: 'source non fournie dans QUAI_SOURCES' });
    expect(r.meta.feeds.tec).toMatchObject({ ok: true, areas: 5 });
    expect(r.meta.feeds.delijn).toMatchObject({ ok: true, areas: 7 });
    expect(r.anyOk).toBe(true);
    const meta = readFileSync(join(out, 'meta.json'), 'utf8');
    expect(meta).not.toContain(KEY);
    for (const l of logs) expect(l).not.toContain(KEY);
    expect(seen.some((s) => s.headers['bmc-partner-key'] === KEY && s.headers['ocp-apim-subscription-key'] === KEY)).toBe(true);
    // fichiers de trains présents mais vides quand la SNCB est en erreur
    expect(JSON.parse(readFileSync(join(out, 'trains/2026-11-10.json'), 'utf8'))).toEqual({ v: 1, date: '2026-11-10', stations: [], trips: [] });
  });
});
