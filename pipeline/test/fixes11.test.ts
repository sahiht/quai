/**
 * 1.1 : correctifs des données (docs/v1.1/review-tech.md) sur des mini GTFS : trains avec montée ou descente
 * interdite (-1, M1), départs uniques (M8.2), zones fusionnées (M8.3), noms lisibles (S5).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaFile, LineFile, SearchFile, TileFile, TrainsDay } from '../../shared/types.ts';
import { cleanupTempDirs, miniFeed, runBuild, runFeed } from './helpers.ts';

afterAll(cleanupTempDirs);

const area = (out: string, op: string, key: string) => JSON.parse(readFileSync(join(out, `areas/${op}/${key}.json`), 'utf8')) as AreaFile;
const ST = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n';
const st = (trip: string, rows: [string, string, number?, number?][]) =>
  rows.map(([stop, t, pu, dr], i) => `${trip},${t},${t},${stop},${i + 1},${pu ?? 0},${dr ?? 0}\n`).join('');

describe('trains : montée ou descente interdite (-1)', () => {
  it('arrivée -1 si descente interdite, départ -1 si montée interdite ; point frontière sans départ', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\nNJ,NJ,2\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Liège,50.62,5.56\nX,Frontière,50.70,5.80\nB,Bruxelles,50.86,4.36\nC,Ostende,51.23,2.92\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,trip_short_name\nNJ,ALL,NJ1,Ostende,448\n',
      'stop_times.txt': ST + st('NJ1', [['A', '09:00:00', 0, 1], ['X', '09:10:00', 1, 1], ['B', '09:30:00', 1, 0], ['C', '10:30:00', 1, 0]]),
    });
    const { out, result } = await runFeed('sncb', files, ['2026-11-10']);
    const t = result.trains![0];
    const ids = t.stations.map((s) => s.id);
    expect(t.trips[0].s.map((x) => [ids[x[0]], x[1], x[2]])).toEqual([['sncb:A', -1, 540], ['sncb:X', -1, -1], ['sncb:B', 570, -1], ['sncb:C', 630, -1]]);
    expect(area(out, 'sncb', 'A').deps).toEqual([[0, 540, 0, 0, 'NJ1', 1]]);
    expect(area(out, 'sncb', 'A').patterns[0].next).toEqual([['sncb:B', 30], ['sncb:C', 90]]);
    for (const k of ['X', 'B', 'C']) expect(area(out, 'sncb', k).deps).toEqual([]);
    expect(result.idle.sort()).toEqual(['sncb:B', 'sncb:C', 'sncb:X']);
  });
});

describe('départs uniques (M8.2)', () => {
  it('SNCB : train publié deux fois (même numéro, mêmes heures) gardé une fois, destination = terminus', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\nIC,IC,2\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nN,Namur,50.4685,4.8625\nL,Lille Flandres,50.6366,3.0707\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,trip_short_name\n'
        + 'IC,ALL,a:13:1952:20261110:4,Lille-Flandres (FR),930\nIC,ALL,b:20261110:1:3,Lille Flandres,930\nIC,ALL,c:autre,Lille Flandres,931\n',
      'stop_times.txt': ST + st('a:13:1952:20261110:4', [['N', '17:38:00'], ['L', '19:52:00']])
        + st('b:20261110:1:3', [['N', '17:38:00'], ['L', '19:52:00']]) + st('c:autre', [['N', '18:38:00'], ['L', '20:52:00']]),
    });
    const { out, result } = await runFeed('sncb', files);
    expect(result.trips).toBe(2);
    for (const day of result.trains!) expect(day.trips.map((t) => t.id)).toEqual(['b:20261110:1:3', 'c:autre']);
    const n = area(out, 'sncb', 'N');
    expect(n.deps.map((d) => [d[0], d[1], d[4]])).toEqual([[0, 1058, 'b:20261110:1:3'], [0, 1118, 'c:autre'], [1, 1058, 'b:20261110:1:3'], [1, 1118, 'c:autre']]);
    expect(result.warnings.join(' ')).toMatch(/1 train\(s\) en double écarté\(s\)/);
  });

  it('un départ par voyage et par zone ; aucun vers un terminus de la zone même ; doublons ligne, destination, minute, arrêt', async () => {
    const files = miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Place,50.0,4.0\nG1,Gare quai 1,50.1,4.1\nG2,Gare quai 2,50.1001,4.1001\nB,Eglise,50.2,4.2\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,QUAIS,Eglise\nR1,ALL,TERM,Gare\nR1,ALL,DUP1,Eglise\nR1,ALL,DUP2,Eglise\n',
      'stop_times.txt': ST
        + st('QUAIS', [['A', '08:00:00'], ['G1', '08:05:00'], ['G2', '08:06:00'], ['B', '08:15:00']])
        + st('TERM', [['A', '09:00:00'], ['G1', '09:05:00'], ['G2', '09:07:00']])
        + st('DUP1', [['A', '10:00:00'], ['B', '10:20:00']])
        + st('DUP2', [['A', '10:00:00'], ['B', '10:20:00']]),
    });
    const { out, result } = await runFeed('tec', files, ['2026-11-10']);
    // QUAIS passe aux deux quais de la gare : un seul départ (quai 2, 08:06) ; TERM finit à la gare : aucun départ
    expect(area(out, 'tec', 'G1').deps).toEqual([[0, 486, 0, 1, 'QUAIS', 3]]);
    // DUP1 et DUP2 : même ligne, même destination, même minute, même arrêt
    expect(area(out, 'tec', 'A').deps.map((d) => [d[1], d[4]])).toEqual([[480, 'QUAIS'], [540, 'TERM'], [600, 'DUP1']]);
    expect(result.warnings.join(' ')).toMatch(/1 départ\(s\) en double écarté\(s\)/);
  });
});

describe('zones fusionnées (M8.3)', () => {
  it('TEC : un parent par quai, même nom à moins de 300 m : une zone, clé du membre qui a le plus de départs, aka', async () => {
    const files = miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n'
        + 'P1,LA HULPE Gare quai 1,50.7300,4.4850,1,\nP2,LA HULPE Gare quai 2,50.7301,4.4852,1,\n'
        + 'Q1,LA HULPE Gare quai 1,50.7300,4.4850,0,P1\nQ2,LA HULPE Gare quai 2,50.7301,4.4852,0,P2\nF,LA HULPE Fin,50.75,4.50,0,\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,T1,LA HULPE Fin\nR1,ALL,T2,LA HULPE Fin\nR1,ALL,T3,LA HULPE Fin\n',
      'stop_times.txt': ST + st('T1', [['Q1', '08:00:00'], ['F', '08:10:00']]) + st('T2', [['Q2', '09:00:00'], ['F', '09:10:00']])
        + st('T3', [['Q2', '10:00:00'], ['F', '10:10:00']]),
    });
    const { out, result } = await runFeed('tec', files, ['2026-11-10']);
    expect(result.areas.map((a) => a.id).sort()).toEqual(['tec:F', 'tec:P2']);
    const gare = result.areas.find((a) => a.id === 'tec:P2');
    expect(gare).toMatchObject({ n: { fr: 'La Hulpe Gare', nl: 'La Hulpe Gare' }, aka: ['tec:P1'], lat: 50.7301, lon: 4.4852 });
    expect(area(out, 'tec', 'P2').stops).toEqual([{ id: 'Q1', platform: '1', rt: 'Q1' }, { id: 'Q2', platform: '2', rt: 'Q2' }]);
    expect(area(out, 'tec', 'P2').deps.map((d) => d[4])).toEqual(['T1', 'T2', 'T3']);
    expect(readdirSync(join(out, 'areas/tec')).sort()).toEqual(['F.json', 'P2.json']);
    expect(result.areas.find((a) => a.id === 'tec:F')?.aka).toBeUndefined();
  });

  it('STIB : prémétro sous un parent et bus de surface du même nom fusionnés, modes et lignes réunis ; égalité : plus petite clé', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\n3,3,0\n58,58,3\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n'
        + '64,GARE DU NORD,50.8600,4.3600,1,\n6357,GARE DU NORD,50.8600,4.3601,0,64\n1082,GARE DU NORD,50.8606,4.3608,0,\n9000,ESPLANADE,50.8990,4.3390,0,\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n3,ALL,T1,ESPLANADE\n58,ALL,B1,ESPLANADE\n',
      'stop_times.txt': ST + st('T1', [['6357', '08:00:00'], ['9000', '08:12:00']]) + st('B1', [['1082', '08:05:00'], ['9000', '08:25:00']]),
    });
    const { result } = await runFeed('stib', files, ['2026-11-10']);
    const gdn = result.areas.find((a) => a.n.fr === 'Gare du Nord');
    // un départ chacun : à égalité, la plus petite clé (« 1082 » < « 64 »)
    expect(gdn).toMatchObject({ id: 'stib:1082', aka: ['stib:64'], modes: ['tram', 'bus'], lines: ['3', '58'] });
  });
});

describe('noms (S5)', () => {
  it('TEC : commune en capitales remise en casse ; destination égale au nom d’une zone : noms de la zone', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\nB0536-23747,W,3\nM3,M3,1\n',
      'stops.txt': "stop_id,stop_name,stop_lat,stop_lon\nA,WATERLOO Eglise,50.7174,4.3979\nB,BRUXELLES Midi,50.8361,4.3352\nC,BRAINE-L'ALLEUD Gare,50.6838,4.3715\nD,LIEGE Liège Expo (Tram),50.61,5.57\n",
      'trips.txt': "route_id,service_id,trip_id,trip_headsign\nB0536-23747,ALL,W1,BRUXELLES Midi\nB0536-23747,ALL,W2,BRAINE-L'ALLEUD Gare\nM3,ALL,M1,GOSSELIES Faubourg\n",
      'stop_times.txt': ST + st('W1', [['A', '07:36:00'], ['B', '08:21:00']]) + st('W2', [['A', '07:35:00'], ['C', '07:47:00']])
        + st('M1', [['D', '07:00:00'], ['A', '08:00:00']]),
    });
    const { out, result } = await runFeed('tec', files, ['2026-11-10']);
    const names = Object.fromEntries(result.areas.map((a) => [a.id, a.n.fr]));
    expect(names).toEqual({ 'tec:A': 'Waterloo Eglise', 'tec:B': 'Bruxelles Midi', 'tec:C': 'Braine-l’Alleud Gare', 'tec:D': 'Liège Expo (Tram)' });
    const a = area(out, 'tec', 'A');
    expect(a.patterns.map((p) => [p.line, p.head])).toEqual([
      ['W', { fr: 'Braine-l’Alleud Gare', nl: 'Braine-l’Alleud Gare' }],
      ['W', { fr: 'Bruxelles Midi', nl: 'Bruxelles Midi' }],
    ]);
    // ligne de métro déjà préfixée dans le GTFS : « M3 » devient « 3 » (sinon « MM3 » dans l'appli)
    expect(area(out, 'tec', 'D').patterns[0]).toMatchObject({ line: '3', mode: 'metro', head: { fr: 'Gosselies Faubourg' } });
  });

  it('STIB : destination sans accent reprise du nom traduit de la zone (« TRONE » → « Trône »)', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\n1,1,1\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n8011,ARTS-LOIS,50.8454,4.3696\n8021,TRONE,50.8411,4.3653\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n1,ALL,T1,TRONE\n',
      'translations.txt': 'table_name,field_name,language,translation,record_id,record_sub_id,field_value\n'
        + 'stops,stop_name,fr,TRÔNE,8021,,\nstops,stop_name,nl,TROON,8021,,\ntrips,trip_headsign,nl,TROON,,,TRONE\n',
      'stop_times.txt': ST + st('T1', [['8011', '08:00:00'], ['8021', '08:02:00']]),
    });
    const { out } = await runFeed('stib', files, ['2026-11-10']);
    expect(area(out, 'stib', '8011').patterns[0].head).toEqual({ fr: 'Trône', nl: 'Troon' });
  });

  it('De Lijn : tram « T2 » publié « 2 » ; nom français d’une zone STIB voisine ; noms connus prioritaires ; exonymes wallons', async () => {
    const stib = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\n2,2,1\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n1169,PORTE DE HAL,50.8330,4.3450\n6357F,GARE DU NORD,50.8600,4.3601\n',
      'translations.txt': 'table_name,field_name,language,translation,record_id,record_sub_id,field_value\n'
        + 'stops,stop_name,fr,PORTE DE HAL,1169,,\nstops,stop_name,nl,HALLEPOORT,1169,,\nstops,stop_name,fr,GARE DU NORD,6357F,,\nstops,stop_name,nl,NOORDSTATION,6357F,,\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n2,ALL,M1,GARE DU NORD\n',
      'stop_times.txt': ST + st('M1', [['1169', '08:00:00'], ['6357F', '08:20:00']]),
    });
    const delijn = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\n20270,T2,0\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n301026,Sint-Gillis Hallepoort,50.8332,4.3452\n308611,Brussel Noordstation perron 4,50.8618,4.3590\n401,Terhulpen Station,50.7300,4.4850\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n20270,ALL,D1,Terhulpen Station\n',
      'stop_times.txt': ST + st('D1', [['301026', '08:00:00'], ['308611', '08:10:00'], ['401', '08:40:00']]),
    });
    const { read } = await runBuild({ stib, delijn });
    expect(read<AreaFile>('areas/delijn/301026.json').n).toEqual({ fr: 'Porte de Hal, Saint-Gilles', nl: 'Sint-Gillis Hallepoort', l: 'nl' });
    expect(read<AreaFile>('areas/delijn/308611.json').n).toEqual({ fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' });
    expect(read<AreaFile>('areas/delijn/401.json').n).toEqual({ fr: 'Gare de La Hulpe', nl: 'Terhulpen Station', l: 'nl' });
    const p = read<AreaFile>('areas/delijn/301026.json').patterns[0];
    expect(p).toMatchObject({ line: '2', mode: 'tram', head: { fr: 'Gare de La Hulpe', nl: 'Terhulpen Station' } });
    expect(read<LineFile>('lines/delijn/20270.json').line).toBe('2');
  });

  it('zones sans aucun départ : absentes des tuiles et de la recherche, présentes dans areas/ et les fichiers de ligne', async () => {
    const tec = miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Namur Gare,50.468,4.8635\nB,Jambes Place,50.459,4.873\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,T1,Jambes\n',
      'stop_times.txt': ST + st('T1', [['A', '08:00:00'], ['B', '08:09:00']]),
    });
    const { out, read } = await runBuild({ tec });
    const tiles = readdirSync(join(out, 'tiles')).flatMap((f) => read<TileFile>(`tiles/${f}`).areas.map((a) => a.id));
    expect(tiles).toEqual(['tec:A']);
    const search = readdirSync(join(out, 'search')).flatMap((f) => read<SearchFile>(`search/${f}`).items.map((i) => i.id));
    expect(new Set(search)).toEqual(new Set(['tec:A']));
    expect(read<AreaFile>('areas/tec/B.json').deps).toEqual([]);
    expect(read<LineFile>('lines/tec/R1.json').areas.map((a) => a[0])).toEqual(['tec:A', 'tec:B']);
    expect(read<TrainsDay>('trains/2026-11-10.json').trips).toEqual([]);
  });
});
