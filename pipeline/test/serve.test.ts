import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createDataServer } from '../src/serve.ts';
import { cleanupTempDirs, tempDir } from './helpers.ts';

let server: Server;
let base = '';
const big = JSON.stringify({ v: 1, items: Array.from({ length: 200 }, (_, i) => ({ id: `stib:${i}`, n: { fr: 'Gare du Nord', nl: 'Noordstation' } })) });

/** Requête brute (fetch décompresse tout seul ; ici on veut voir les octets). */
function raw(path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const dir = tempDir();
  mkdirSync(join(dir, 'search'), { recursive: true });
  writeFileSync(join(dir, 'meta.json'), '{"v":1}');
  writeFileSync(join(dir, 'search', 'ga.json'), big);
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html><title>Quai</title>');
  writeFileSync(join(tempDir(), 'secret.txt'), 'non');
  server = createDataServer(dir);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  cleanupTempDirs();
});

describe('serve-data', () => {
  it('sert le JSON avec CORS et le bon type', async () => {
    const r = await raw('/meta.json');
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.body.toString()).toBe('{"v":1}');
  });

  it('compresse en gzip si le client l’accepte', async () => {
    const r = await raw('/search/ga.json', { headers: { 'Accept-Encoding': 'gzip, deflate' } });
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.headers.vary).toBe('Accept-Encoding');
    expect(r.body.length).toBeLessThan(Buffer.byteLength(big));
    expect(gunzipSync(r.body).toString()).toBe(big);
    const plain = await raw('/search/ga.json');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe(big);
  });

  it('fonctionne avec fetch (décompression transparente)', async () => {
    const res = await fetch(`${base}/search/ga.json`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual(JSON.parse(big));
  });

  it('404 en JSON avec CORS, dossier -> index.html, HEAD, OPTIONS', async () => {
    const r = await raw('/areas/stib/0000.json');
    expect(r.status).toBe(404);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(JSON.parse(r.body.toString())).toMatchObject({ error: 'fichier introuvable' });
    const idx = await raw('/');
    expect(idx.status).toBe(200);
    expect(idx.headers['content-type']).toBe('text/html; charset=utf-8');
    const head = await raw('/meta.json', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    const opt = await raw('/meta.json', { method: 'OPTIONS' });
    expect(opt.status).toBe(204);
    expect(opt.headers['access-control-allow-origin']).toBe('*');
    expect((await raw('/meta.json', { method: 'POST' })).status).toBe(405);
  });

  it('refuse de sortir du dossier servi', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
      const r = await raw(p);
      expect([403, 404]).toContain(r.status);
      expect(r.body.toString()).not.toBe('non');
    }
  });
});
