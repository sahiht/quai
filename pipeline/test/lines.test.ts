/**
 * 1.1 : fichiers de ligne (docs/v1.1/design-routing.md § 3 et § 8) sur des mini GTFS : profils selon l'heure,
 * boucle, montée seule et descente seule, deux directions, voyage après 24:00, voyage d'un seul des deux jours,
 * STIB sans trip_id, arrêts consécutifs d'une même zone ; correspondances réduites aux bornes des tronçons
 * communs, lignes autour des gares, tuiles de lignes ; meta.lines et réseau en échec.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaFile, LineFile, LineIndex, LineTile, Meta, Names, TileFile } from '../../shared/types.ts';
import { tileKey } from '../../shared/types.ts';
import { buildLineOutputs, defaultFlags, LineCollector, routeFileKey, usableFlags } from '../src/lines.ts';
import type { LineData } from '../src/lines.ts';
import { cleanupTempDirs, miniFeed, runBuild, runFeed } from './helpers.ts';

afterAll(cleanupTempDirs);

const N = (s: string): Names => ({ fr: s, nl: s });
const area = (out: string, op: string, key: string) => JSON.parse(readFileSync(join(out, `areas/${op}/${key}.json`), 'utf8')) as AreaFile;

function stopsCsv(n: number): string {
  let s = 'stop_id,stop_name,stop_lat,stop_lon\n';
  for (let i = 0; i < n; i++) s += `S${String(i).padStart(3, '0')},Arrêt ${i},${(50 + i * 0.01).toFixed(4)},4.0\n`;
  return s;
}
const CAL = 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
  + 'ALL,1,1,1,1,1,1,1,20260101,20261231\nTUE,0,1,0,0,0,0,0,20260101,20261231\n';
const ST = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n';
const st = (trip: string, rows: [string, string, string?, number?, number?][]) =>
  rows.map(([stop, arr, dep, pu, dr], i) => `${trip},${arr},${dep ?? arr},${stop},${i + 1},${pu ?? 0},${dr ?? 0}\n`).join('');

describe('LineCollector', () => {
  it('autorisations par défaut et trajets possibles', () => {
    expect(defaultFlags(2)).toBe('ba');
    expect(defaultFlags(4)).toBe('bxxa');
    expect(usableFlags('ba')).toBe(true);
    expect(usableFlags('na')).toBe(false);
    expect(usableFlags('bn')).toBe(false);
    expect(usableFlags('nbna')).toBe(true);
    expect(routeFileKey('L0149-21069')).toBe('L0149-21069');
    expect(routeFileKey('x:1 2')).toBe('x_1_2');
  });

  it('profils partagés, voyages triés par (jour, départ, rang), zones locales par première apparition', () => {
    const c = new LineCollector('tec');
    const pos = (t: number[], areas = [5, 6, 7]) => areas.map((a, i) => ({ area: a, time: t[i], flag: (i === 0 ? 'b' : i === areas.length - 1 ? 'a' : 'x') as 'b' | 'a' | 'x', rt: `s${a}` }));
    const r = { id: 'R', line: '7', mode: 'bus' as const };
    c.addTrip(0, r, 0, N('Fin'), pos([600, 605, 610]), [0, 1], 'B');
    c.addTrip(0, r, 0, N('Fin'), pos([480, 485, 490]), [1], 'A');
    c.addTrip(0, r, 0, N('Fin'), pos([500, 510, 520]), [0], 'C');
    expect(c.addTrip(0, r, 0, N('Fin'), [{ area: 5, time: 1, flag: 'n', rt: '' }, { area: 6, time: 2, flag: 'a', rt: '' }], [0], 'D')).toBe(false);
    const [line] = c.finish((a) => [`tec:${a}`, 50, 4, N(`Z${a}`)]);
    expect(line).toMatchObject({ id: 'tec:R', op: 'tec', route: 'R', line: '7', mode: 'bus', trips: ['B', 'A', 'C'] });
    expect(line.areas.map((a) => a[0])).toEqual(['tec:5', 'tec:6', 'tec:7']);
    expect(line.pats).toEqual([{ head: N('Fin'), a: [0, 1, 2], s: ['s5', 's6', 's7'], prof: [[0, 5, 10], [0, 10, 20]], t: [[0, 500, 1, 2], [0, 600, 0, 0], [1, 480, 0, 1], [1, 600, 0, 0]] }]);
  });
});

describe('fichiers de ligne depuis le GTFS', () => {
  it('profils selon l’heure, deux directions, voyage d’un seul jour, voyage après 24:00, rang des trip_id', async () => {
    const files = miniFeed({
      'calendar.txt': CAL,
      'stops.txt': stopsCsv(3),
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nR1,ALL,T1,Arrêt 2,0\nR1,ALL,T2,Arrêt 2,0\nR1,TUE,T3,Arrêt 2,0\nR1,ALL,T4,Arrêt 0,1\nR1,ALL,T5,Arrêt 2,0\n',
      'stop_times.txt': ST
        + st('T1', [['S000', '08:00:00'], ['S001', '08:05:00'], ['S002', '08:10:00']])
        + st('T2', [['S000', '17:00:00'], ['S001', '17:08:00'], ['S002', '17:15:00']])
        + st('T3', [['S000', '09:00:00'], ['S001', '09:05:00'], ['S002', '09:10:00']])
        + st('T4', [['S002', '10:00:00'], ['S001', '10:05:00'], ['S000', '10:12:00']])
        + st('T5', [['S000', '24:30:00'], ['S001', '24:35:00'], ['S002', '24:40:00']]),
    });
    const { result } = await runFeed('tec', files);
    expect(result.lines).toHaveLength(1);
    const l = result.lines![0];
    // rangs dans l'ordre des premiers départs : T1 08:00, T3 09:00, T4 10:00, T2 17:00, T5 24:30
    expect(l).toMatchObject({ id: 'tec:R1', op: 'tec', route: 'R1', line: '1', mode: 'bus', trips: ['T1', 'T3', 'T4', 'T2', 'T5'] });
    expect(l.areas).toEqual([['tec:S000', 50, 4, N('Arrêt 0')], ['tec:S001', 50.01, 4, N('Arrêt 1')], ['tec:S002', 50.02, 4, N('Arrêt 2')]]);
    expect(l.pats).toEqual([
      {
        head: N('Arrêt 2'), a: [0, 1, 2], s: ['S000', 'S001', 'S002'], prof: [[0, 5, 10], [0, 8, 15]],
        t: [[0, 480, 0, 0], [0, 540, 0, 1], [0, 1020, 1, 3], [0, 1470, 0, 4], [1, 480, 0, 0], [1, 1020, 1, 3], [1, 1470, 0, 4]],
      },
      { head: N('Arrêt 0'), a: [2, 1, 0], s: ['S002', 'S001', 'S000'], prof: [[0, 5, 12]], t: [[0, 600, 0, 2], [1, 600, 0, 2]] },
    ]);
  });

  it('boucle, montée seule, descente seule, aucune des deux, voyage inutilisable, arrêts consécutifs d’une même zone', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nR1,1,Boucle,3\nR2,2,Autorisations,3\nR3,3,Gare,3\n',
      'stops.txt': `${stopsCsv(5)}G1,Gare quai A,50.5,4.5\nG2,Gare quai B,50.5001,4.5001\n`,
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,L1,Boucle\nR2,ALL,P1,Fin\nR2,ALL,P2,Fin\nR3,ALL,G,Fin\n',
      'stop_times.txt': ST
        + st('L1', [['S000', '08:00:00'], ['S001', '08:05:00'], ['S002', '08:10:00'], ['S000', '08:15:00', '08:16:00'], ['S003', '08:20:00']])
        + st('P1', [['S000', '09:00:00'], ['S001', '09:05:00', undefined, 1, 0], ['S002', '09:10:00', undefined, 0, 1], ['S003', '09:15:00', undefined, 1, 1], ['S004', '09:20:00']])
        + st('P2', [['S000', '10:00:00', undefined, 1, 0], ['S001', '10:05:00', undefined, 1, 0]])
        + st('G', [['S000', '11:00:00'], ['G1', '11:05:00'], ['G2', '11:07:00'], ['S001', '11:15:00']]),
    });
    const { result, out } = await runFeed('tec', files, ['2026-11-10']);
    const by = Object.fromEntries((result.lines ?? []).map((l) => [l.id, l]));
    // boucle : la zone revient dans le motif
    expect(by['tec:R1'].areas.map((a) => a[0])).toEqual(['tec:S000', 'tec:S001', 'tec:S002', 'tec:S003']);
    expect(by['tec:R1'].pats).toEqual([{ head: N('Boucle'), a: [0, 1, 2, 0, 3], s: ['S000', 'S001', 'S002', 'S000', 'S003'], prof: [[0, 5, 10, 16, 20]], t: [[0, 480, 0, 0]] }]);
    // autorisations : b, a (montée interdite), b (descente interdite), n (aucune), a ; P2 (aucune montée suivie d'une descente) écarté
    expect(by['tec:R2'].pats).toEqual([{ head: N('Fin'), a: [0, 1, 2, 3, 4], s: ['S000', 'S001', 'S002', 'S003', 'S004'], f: 'babna', prof: [[0, 5, 10, 15, 20]], t: [[0, 540, 0, 0]] }]);
    expect(by['tec:R2'].trips).toEqual(['P1']);
    // deux arrêts de la même zone : une seule position, dernier départ permis (quai B à 11:07)
    expect(by['tec:R3'].areas.map((a) => a[0])).toEqual(['tec:S000', 'tec:G1', 'tec:S001']);
    expect(by['tec:R3'].pats[0]).toMatchObject({ a: [0, 1, 2], s: ['S000', 'G2', 'S001'], prof: [[0, 7, 15]] });
    expect(by['tec:R3'].pats[0].f).toBeUndefined();
    // départs de la zone : un seul par voyage (M8.2), au quai B
    const gare = area(out, 'tec', 'G1');
    expect(gare.stops.map((s) => s.id)).toEqual(['G1', 'G2']);
    expect(gare.deps).toEqual([[0, 667, 0, 1, 'G', 3]]);
    expect(area(out, 'tec', 'S000').deps.filter((d) => d[4] === 'L1')).toEqual([[0, 480, 0, 0, 'L1', 1]]);
  });

  it('STIB : pas de trip_id (temps réel par pointid), arrêts au format pointid', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\ngr:stibmivb:3,3,0\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n6357F,GARE DU NORD,50.86,4.36\n6359,ROGIER,50.857,4.359\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\ngr:stibmivb:3,ALL,gt:stibmivb:110312,CHURCHILL\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\ngt:stibmivb:110312,12:12:00,12:12:00,6357F,1\ngt:stibmivb:110312,12:14:00,12:14:00,6359,2\n',
    });
    const { result } = await runFeed('stib', files);
    const [l] = result.lines ?? [];
    expect(l).toMatchObject({ id: 'stib:3', route: '3', line: '3', mode: 'tram' });
    expect(l.trips).toBeUndefined();
    expect(l.pats).toEqual([{ head: N('Churchill'), a: [0, 1], s: ['6357', '6359'], prof: [[0, 2]], t: [[0, 732, 0], [1, 732, 0]] }]);
  });

  it('SNCB : pas de fichier de ligne', async () => {
    const files = miniFeed({
      'stops.txt': stopsCsv(2),
      'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\n',
      'stop_times.txt': ST + st('T1', [['S000', '08:00:00'], ['S001', '08:30:00']]),
    });
    expect((await runFeed('sncb', files)).result.lines).toBeUndefined();
  });
});

describe('correspondances, gares et tuiles de lignes', () => {
  const zone = (id: string, lat: number, lon = 4.0): LineFile['areas'][number] => [id, lat, lon, N(id)];
  const line = (id: string, zones: LineFile['areas'], extra: Partial<LineData> = {}): LineData => {
    const op = id.slice(0, id.indexOf(':')) as 'tec';
    const route = id.slice(id.indexOf(':') + 1);
    return {
      id, op, route, line: route, mode: 'bus', areas: zones,
      pats: [{ head: N('Fin'), a: zones.map((_, i) => i), s: zones.map(() => ''), prof: [zones.map((_, i) => i * 5)], t: [[0, 480, 0, 0]] }],
      trips: ['x'], ...extra,
    };
  };
  // zones espacées de 1,1 km ; B partage Z1 à Z4 avec A ; C (STIB) à 220 m de Z0 ; gare X à 330 m de Z5
  const Z = Array.from({ length: 6 }, (_, i) => zone(`tec:Z${i}`, 50 + i * 0.01));
  const A = line('tec:A', Z);
  const B = line('tec:B', [Z[1], Z[2], Z[3], Z[4], zone('tec:Z9', 50.2)]);
  const C: LineData = { ...line('stib:C', [zone('stib:W', 50.002), zone('stib:V', 49.95)]), op: 'stib', trips: undefined };
  const out = buildLineOutputs([B, A, C], [{ id: 'sncb:X', lat: 50.053, lon: 4.0 }, { id: 'sncb:Y', lat: 51, lon: 4 }], '2026-11-10T01:15:00.000Z');

  it('numérotation par identifiant, index', () => {
    expect(out.index).toMatchObject({ v: 1, generatedAt: '2026-11-10T01:15:00.000Z', conn: 400 });
    expect(out.index.lines).toEqual([['stib:C', 'C', 'bus', 1], ['tec:A', 'A', 'bus', 1], ['tec:B', 'B', 'bus', 1]]);
    expect(out.ops).toEqual(['stib', 'tec']);
    expect(out.files.map((f) => f.path)).toEqual(['lines/stib/C.json', 'lines/tec/A.json', 'lines/tec/B.json']);
  });

  it('conn : lignes à moins de 400 m, réduites aux bornes du tronçon commun, d’un réseau à l’autre', () => {
    const a = out.files.find((f) => f.file.id === 'tec:A')!.file;
    // A : C à Z0 (220 m) ; B seulement à Z1 et Z4, pas à Z2 ni Z3
    expect(a.conn).toEqual([[0], [2], [], [], [2], []]);
    const b = out.files.find((f) => f.file.id === 'tec:B')!.file;
    expect(b.conn).toEqual([[1], [], [], [1], []]);
    const c = out.files.find((f) => f.file.id === 'stib:C')!.file;
    expect(c.conn).toEqual([[1], []]);
    expect(c.trips).toBeUndefined();
  });

  it('gares : lignes à moins de 400 m ; tuiles de lignes : zone → lignes', () => {
    expect(out.index.stations).toEqual({ 'sncb:X': [1] });
    const all: Record<string, number[]> = {};
    for (const [k, t] of out.tiles) {
      for (const [id, l] of Object.entries(t.a)) {
        const z = [...Z, ...B.areas, ...C.areas].find((x) => x[0] === id)!;
        expect(tileKey(z[1], z[2])).toBe(k);
        all[id] = l;
      }
    }
    expect(all).toMatchObject({ 'tec:Z0': [1], 'tec:Z1': [1, 2], 'tec:Z4': [1, 2], 'tec:Z5': [1], 'tec:Z9': [2], 'stib:W': [0], 'stib:V': [0] });
  });

  it('position sans montée ni descente : ni correspondance ni tuile ; nom de fichier déjà pris : ligne écartée', () => {
    const D = line('tec:D', [zone('tec:Q0', 48), zone('tec:Q1', 48.01), zone('tec:Q2', 48.02)]);
    D.pats[0].f = 'bna';
    const E1 = line('tec:x:1', [zone('tec:R0', 47), zone('tec:R1', 47.01)]);
    const E2 = line('tec:x_1', [zone('tec:R2', 47.5), zone('tec:R3', 47.51)]);
    const o = buildLineOutputs([D, E1, E2], [], 'g');
    const tiles = Object.assign({}, ...[...o.tiles.values()].map((t) => t.a)) as Record<string, number[]>;
    expect(tiles['tec:Q1']).toBeUndefined();
    // « x:1 » et « x_1 » donnent le même fichier x_1.json : la première par identifiant (« : » avant « _ ») est gardée
    expect(Object.keys(tiles).sort()).toEqual(['tec:Q0', 'tec:Q2', 'tec:R0', 'tec:R1']);
    expect(o.index.lines.map((x) => x[0])).toEqual(['tec:D', 'tec:x:1']);
    expect(o.warnings.join(' ')).toMatch(/ligne tec:x_1 ignorée : fichier lines\/tec\/x_1\.json déjà utilisé/);
  });
});

describe('préparation complète : lines/, linetiles/, meta.lines', () => {
  const tec = miniFeed({
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,WATERLOO Eglise,50.7174,4.3979\nB,BRUXELLES Midi,50.8361,4.3352\nC,BRUXELLES Gare,50.8361,4.3402\n',
    'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,W1,BRUXELLES Midi\n',
    'stop_times.txt': ST + st('W1', [['A', '07:36:00'], ['B', '08:21:00']]),
  });
  const stib = miniFeed({
    'routes.txt': 'route_id,route_short_name,route_type\n2,2,1\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n8402,GARE DU MIDI,50.8355,4.3358\n8042,ROGIER,50.8568,4.35875\n',
    'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n2,ALL,M1,SIMONIS\n',
    'stop_times.txt': ST + st('M1', [['8402', '08:23:00'], ['8042', '08:37:00']]),
  });

  it('fichiers cohérents : index, tuiles et fichiers de la même génération ; zones sans départ hors des tuiles', async () => {
    const { out, read, logs } = await runBuild({ tec, stib });
    const meta = read<Meta>('meta.json');
    expect(meta.lines).toEqual({ files: 2, ops: ['stib', 'tec'], conn: 400 });
    const index = read<LineIndex>('lines/index.json');
    expect(index.generatedAt).toBe(meta.generatedAt);
    expect(index.lines).toEqual([['stib:2', '2', 'metro', 1], ['tec:R1', '1', 'bus', 1]]);
    expect(readdirSync(join(out, 'lines')).sort()).toEqual(['index.json', 'stib', 'tec']);
    const w = read<LineFile>('lines/tec/R1.json');
    expect(w.areas.map((a) => [a[0], a[3].fr])).toEqual([['tec:A', 'Waterloo Eglise'], ['tec:B', 'Bruxelles Midi']]);
    expect(w.pats[0].head).toEqual(N('Bruxelles Midi'));
    expect(w.conn).toEqual([[], [0]]); // M2 à Gare du Midi (80 m)
    const lt = Object.assign({}, ...readdirSync(join(out, 'linetiles')).map((f) => read<LineTile>(`linetiles/${f}`).a));
    expect(lt).toEqual({ 'stib:8042': [0], 'stib:8402': [0], 'tec:A': [1], 'tec:B': [1] });
    // tec:B (terminus) et stib:8042 n'ont aucun départ : fichiers de zone écrits, absents des tuiles et de la recherche
    const inTiles = readdirSync(join(out, 'tiles')).flatMap((f) => read<TileFile>(`tiles/${f}`).areas.map((a) => a.id)).sort();
    expect(inTiles).toEqual(['stib:8402', 'tec:A']);
    expect(existsSync(join(out, 'areas/tec/B.json'))).toBe(true);
    expect(logs.some((l) => /^Fichiers de ligne : 2 lignes \(STIB 1, TEC 1\), [\d,]+ Mo bruts, [\d,]+ Mo en gzip ; index/.test(l))).toBe(true);
  });

  it('réseau en échec : pas de fichiers de ligne pour lui ; aucun réseau urbain : meta.lines sans ligne', async () => {
    const broken = { ...tec, 'stop_times.txt': 'trip_id,stop_id\n' };
    const r1 = await runBuild({ tec: broken, stib });
    expect(r1.read<Meta>('meta.json').lines).toEqual({ files: 1, ops: ['stib'], conn: 400 });
    expect(existsSync(join(r1.out, 'lines/tec'))).toBe(false);
    const r2 = await runBuild({ sncb: miniFeed({ 'stops.txt': stopsCsv(2), 'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\n', 'stop_times.txt': ST + st('T1', [['S000', '08:00:00'], ['S001', '08:30:00']]) }) });
    expect(r2.read<Meta>('meta.json').lines).toEqual({ files: 0, ops: [], conn: 400 });
    expect(r2.read<LineIndex>('lines/index.json').lines).toEqual([]);
  });
});
