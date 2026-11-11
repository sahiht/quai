/**
 * Option --cache-dir : GTFS gardé après une préparation réussie, repli quand le flux de la nuit est inutilisable
 * (portail injoignable, contenu non zip, aucun voyage sur les deux journées), refus au-delà de 7 jours,
 * meta.feeds[op].cachedFrom et page d'état.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Op } from '../../shared/types.ts';
import { buildData } from '../src/build.ts';
import { daysBetween, readCached, storeCached } from '../src/cache.ts';
import { SLUG, staticTargets } from '../src/config.ts';
import type { Source } from '../src/config.ts';
import { feedState, statusPage } from '../src/site.ts';
import { cleanupTempDirs, FIXTURE_ZIPS, miniFeed, tempDir, writeGtfsZip } from './helpers.ts';

const OPS: Op[] = ['sncb', 'stib', 'delijn', 'tec'];
const DATES = ['2026-11-10', '2026-11-11'];
const fast = { retries: 0, backoffMs: [0] };
const at = (iso: string) => () => new Date(iso);

type Reply = (op: Op) => { status: number; body?: Buffer | string };
let reply: Reply = () => ({ status: 404 });
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const m = /^\/api\/gtfs\/feed\/([a-z]+)\/static$/.exec(req.url ?? '');
    const op = OPS.find((o) => m && SLUG[o] === m[1]);
    const r = op ? reply(op) : { status: 404 };
    res.writeHead(r.status, { 'Content-Type': 'application/zip' });
    res.end(r.body ?? '');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  cleanupTempDirs();
});

/** Sources « téléchargement » sur le serveur local uniquement (pas de repli externe). */
const sources = (): Record<Op, Source> =>
  Object.fromEntries(OPS.map((op) => [op, { kind: 'download', targets: staticTargets(op, base).slice(0, 1) }])) as Record<Op, Source>;
const fixtureZip = (op: Op) => readFileSync(join(FIXTURE_ZIPS, `${op}.zip`));

async function build(cacheDir: string, now: string) {
  const out = join(tempDir(), 'data');
  const logs: string[] = [];
  const r = await buildData({ out, dates: DATES, key: 'k-123456', sources: sources(), cacheDir, download: fast, now: at(now), log: (m) => logs.push(m) });
  return { ...r, out, logs };
}

describe('fichiers du cache', () => {
  it('aller-retour, fiche illisible, zip incomplet, trop ancien', async () => {
    const dir = tempDir();
    expect(await readCached(dir, 'tec', '2026-11-10')).toEqual({ reason: 'aucun flux gardé' });
    const entry = await storeCached(dir, 'tec', join(FIXTURE_ZIPS, 'tec.zip'), { date: '2026-11-10', savedAt: '2026-11-10T01:20:00.000Z', feedVersion: 'X' });
    expect(entry).toMatchObject({ v: 1, op: 'tec', date: '2026-11-10', feedVersion: 'X' });
    expect(existsSync(join(dir, 'tec.zip.tmp')) || existsSync(join(dir, 'tec.json.tmp'))).toBe(false);
    expect(await readCached(dir, 'tec', '2026-11-17')).toMatchObject({ path: join(dir, 'tec.zip'), entry: { date: '2026-11-10' } });
    expect(await readCached(dir, 'tec', '2026-11-18')).toEqual({ reason: 'flux gardé du 10/11 trop ancien (plus de 7 jours)' });
    writeFileSync(join(dir, 'tec.zip'), 'tronqué');
    expect(await readCached(dir, 'tec', '2026-11-10')).toEqual({ reason: 'zip gardé incomplet' });
    writeFileSync(join(dir, 'tec.json'), '{oups');
    expect(await readCached(dir, 'tec', '2026-11-10')).toEqual({ reason: 'fiche du flux gardé illisible' });
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
  });
});

describe('buildData avec --cache-dir', () => {
  const cacheDir = tempDir('quai-cache-');
  let first: Awaited<ReturnType<typeof build>>;

  it('nuit normale : chaque GTFS est gardé avec sa date, rien n’est marqué en repli', async () => {
    reply = (op) => ({ status: 200, body: fixtureZip(op) });
    first = await build(cacheDir, '2026-11-10T02:15:00+01:00');
    for (const op of OPS) {
      expect(first.meta.feeds[op].ok).toBe(true);
      expect(first.meta.feeds[op].cachedFrom).toBeUndefined();
      expect(JSON.parse(readFileSync(join(cacheDir, `${op}.json`), 'utf8'))).toMatchObject({ v: 1, op, date: '2026-11-10' });
      expect(readFileSync(join(cacheDir, `${op}.zip`)).equals(fixtureZip(op))).toBe(true);
    }
    expect(first.logs.some((l) => l === 'TEC : GTFS gardé pour les nuits suivantes')).toBe(true);
  });

  it('portail en panne, contenu non zip, flux sans voyage : repli sur le GTFS gardé, cachedFrom renseigné', async () => {
    const empty = writeGtfsZip(tempDir(), 'vide.zip', miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Arrêt A,50.1,4.1\nB,Arrêt B,50.2,4.2\n',
      'trips.txt': 'route_id,service_id,trip_id\nR1,OFF,T1\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,A,1\nT1,08:10:00,08:10:00,B,2\n',
    }));
    reply = (op) =>
      op === 'sncb' ? { status: 503 } : op === 'stib' ? { status: 200, body: '<html>maintenance</html>' } : op === 'delijn' ? { status: 200, body: readFileSync(empty) } : { status: 200, body: fixtureZip('tec') };
    const r = await build(cacheDir, '2026-11-12T02:15:00+01:00');
    expect(r.anyOk).toBe(true);
    for (const op of ['sncb', 'stib', 'delijn'] as const) {
      expect(r.meta.feeds[op]).toMatchObject({ ok: true, cachedFrom: '2026-11-10', areas: first.meta.feeds[op].areas, trips: first.meta.feeds[op].trips });
      expect(r.meta.feeds[op].error).toBeUndefined();
    }
    expect(r.meta.feeds.tec.cachedFrom).toBeUndefined();
    expect(r.logs.some((l) => /^De Lijn : aucun voyage les 10\/11 et 11\/11 ; repli sur le GTFS gardé du 10\/11$/.test(l))).toBe(true);
    expect(r.logs.some((l) => /^SNCB : téléchargement impossible .* repli sur le GTFS gardé du 10\/11$/.test(l))).toBe(true);
    // les fichiers produits sont ceux du GTFS gardé : trains et zones SNCB présents
    expect(JSON.parse(readFileSync(join(r.out, 'trains/2026-11-10.json'), 'utf8')).trips.length).toBe(20);
    expect(existsSync(join(r.out, 'areas/delijn/308611.json'))).toBe(true);
    // un flux inutilisable ne remplace jamais le GTFS gardé
    expect(JSON.parse(readFileSync(join(cacheDir, 'delijn.json'), 'utf8')).date).toBe('2026-11-10');
    expect(JSON.parse(readFileSync(join(cacheDir, 'tec.json'), 'utf8')).date).toBe('2026-11-12');
    const page = statusPage(r.meta);
    expect(page).toContain('horaires du 10/11, le portail n’a pas répondu cette nuit');
    expect(page).toContain('certains reprennent les horaires d’une nuit précédente');
    expect(feedState(r.meta.feeds.delijn)).toBe('horaires du 10/11, le portail n’a pas répondu cette nuit');
    expect(feedState(r.meta.feeds.tec)).toBe('à jour');
    expect(readFileSync(join(r.out, 'LICENSE-DATA.txt'), 'utf8')).toContain('(GTFS du 10/11)');
  });

  it('GTFS gardé de plus de 7 jours : pas de repli, erreur explicite, code d’échec si tout échoue', async () => {
    reply = () => ({ status: 503 });
    const r = await build(cacheDir, '2026-11-18T02:15:00+01:00');
    expect(r.anyOk).toBe(true); // TEC gardé le 12/11 : encore utilisable
    expect(r.meta.feeds.tec).toMatchObject({ ok: true, cachedFrom: '2026-11-12' });
    for (const op of ['sncb', 'stib', 'delijn'] as const) {
      expect(r.meta.feeds[op].ok).toBe(false);
      expect(r.meta.feeds[op].error).toMatch(/pas de repli \(flux gardé du 10\/11 trop ancien \(plus de 7 jours\)\)$/);
    }
    const none = await build(cacheDir, '2026-11-25T02:15:00+01:00');
    expect(none.anyOk).toBe(false);
  });

  it('sans --cache-dir : un flux sans voyage est une erreur, rien n’est gardé', async () => {
    const empty = writeGtfsZip(tempDir(), 'vide2.zip', miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Arrêt A,50.1,4.1\nB,Arrêt B,50.2,4.2\n',
      'trips.txt': 'route_id,service_id,trip_id\nR1,OFF,T1\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,A,1\nT1,08:10:00,08:10:00,B,2\n',
    }));
    reply = (op) => ({ status: 200, body: op === 'tec' ? readFileSync(empty) : fixtureZip(op) });
    const out = join(tempDir(), 'data');
    const r = await buildData({ out, dates: DATES, key: 'k-123456', sources: sources(), download: fast, now: at('2026-11-10T02:15:00+01:00'), log: () => undefined });
    expect(r.meta.feeds.tec).toEqual({ ok: false, error: 'aucun voyage les 10/11 et 11/11', areas: 0, trips: 0 });
    expect(r.meta.feeds.sncb.ok).toBe(true);
  });
});
