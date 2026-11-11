import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaFile } from '../../shared/types.ts';
import { fillTimes } from '../src/feed.ts';
import { cleanupTempDirs, miniFeed, runFeed } from './helpers.ts';

afterAll(cleanupTempDirs);

const area = (out: string, op: string, key: string) => JSON.parse(readFileSync(join(out, `areas/${op}/${key}.json`), 'utf8')) as AreaFile;

function stopsCsv(n: number, prefix = 'S'): string {
  let s = 'stop_id,stop_name,stop_lat,stop_lon\n';
  for (let i = 0; i < n; i++) s += `${prefix}${String(i).padStart(3, '0')},Arrêt ${i},${(50 + i * 0.01).toFixed(4)},4.0\n`;
  return s;
}

describe('départs et motifs', () => {
  it('boucle : un seul départ par voyage et par zone (le premier passage, M8.2) ; pas de départ au terminus', async () => {
    const files = miniFeed({
      'stops.txt': stopsCsv(4),
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nR1,ALL,T1,Boucle,0\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
        + 'T1,08:00:00,08:00:00,S000,1\nT1,08:05:00,08:05:00,S001,2\nT1,08:10:00,08:10:00,S002,3\nT1,08:15:00,08:16:00,S000,4\nT1,08:20:00,08:20:00,S003,5\n',
    });
    const { out } = await runFeed('tec', files, ['2026-11-10']);
    const a = area(out, 'tec', 'S000');
    expect(a.deps).toEqual([[0, 480, 0, 0, 'T1', 1]]);
    expect(a.patterns).toHaveLength(1);
    expect(a.patterns[0].next).toEqual([['tec:S001', 5], ['tec:S002', 10], ['tec:S003', 20]]);
    expect(area(out, 'tec', 'S003').deps).toEqual([]);
    expect(area(out, 'tec', 'S003').patterns).toEqual([]);
  });

  it('pickup_type 1 : pas de départ ; drop_off_type 1 : zone absente de next', async () => {
    const files = miniFeed({
      'stops.txt': stopsCsv(4),
      'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n'
        + 'T1,08:00:00,08:00:00,S000,1,0,1\nT1,08:05:00,08:05:00,S001,2,1,0\nT1,08:10:00,08:10:00,S002,3,0,1\nT1,08:20:00,08:20:00,S003,4,1,0\n',
    });
    const { out } = await runFeed('tec', files, ['2026-11-10']);
    expect(area(out, 'tec', 'S000').patterns[0].next).toEqual([['tec:S001', 5], ['tec:S003', 20]]);
    expect(area(out, 'tec', 'S001').deps).toEqual([]);
    expect(area(out, 'tec', 'S002').deps).toHaveLength(1);
  });

  it('next limité à 60 zones', async () => {
    let st = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n';
    for (let i = 0; i < 70; i++) {
      const t = `${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`;
      st += `T1,${t},${t},S${String(i).padStart(3, '0')},${i + 1}\n`;
    }
    const files = miniFeed({ 'stops.txt': stopsCsv(70), 'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\n', 'stop_times.txt': st });
    const { out } = await runFeed('delijn', files, ['2026-11-10']);
    const next = area(out, 'delijn', 'S000').patterns[0].next;
    expect(next).toHaveLength(60);
    expect(next[0]).toEqual(['delijn:S001', 1]);
    expect(next[59]).toEqual(['delijn:S060', 60]);
  });

  it('jours 0 et 1, tri par (jour, minutes), motif partagé, voyage inactif ignoré', async () => {
    const files = miniFeed({
      'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nTUE,0,1,0,0,0,0,0,20260101,20261231\nALL,1,1,1,1,1,1,1,20260101,20261231\nOLD,1,1,1,1,1,1,1,20250101,20251231\n',
      'stops.txt': stopsCsv(2),
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,LATE,Fin\nR1,TUE,EARLY,Fin\nR1,OLD,GONE,Fin\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
        + 'LATE,24:30:00,24:30:00,S000,1\nLATE,24:40:00,24:40:00,S001,2\nEARLY,06:00:00,06:00:00,S000,1\nEARLY,06:10:00,06:10:00,S001,2\n'
        + 'GONE,07:00:00,07:00:00,S000,1\nGONE,07:10:00,07:10:00,S001,2\n',
    });
    const { out, result } = await runFeed('tec', files);
    const a = area(out, 'tec', 'S000');
    expect(a.deps).toEqual([[0, 360, 0, 0, 'EARLY', 1], [0, 1470, 0, 0, 'LATE', 1], [1, 1470, 0, 0, 'LATE', 1]]);
    expect(a.patterns).toHaveLength(1);
    expect(result.trips).toBe(2);
  });

  it('identifiants préfixés normalisés, STIB sans trip_id, heures manquantes interpolées', async () => {
    const files = miniFeed({
      'routes.txt': 'route_id,route_short_name,route_type\ngr:stibmivb:3,3,0\n',
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\ngs:stibmivb:6357F,GARE DU NORD,50.86,4.36\n6359,ROGIER,50.857,4.359\n6361,DE BROUCKERE,50.851,4.3524\n',
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\ngr:stibmivb:3,ALL,gt:stibmivb:110312,CHURCHILL\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
        + 'gt:stibmivb:110312,12:12:00,12:12:00,gs:stibmivb:6357F,1\ngt:stibmivb:110312,,,6359,2\ngt:stibmivb:110312,12:16:00,12:16:00,6361,3\n',
    });
    const { out } = await runFeed('stib', files, ['2026-11-10']);
    const g = area(out, 'stib', '6357F');
    expect(g.id).toBe('stib:6357F');
    expect(g.stops).toEqual([{ id: '6357F', rt: '6357' }]);
    expect(g.deps).toEqual([[0, 732, 0, 0, '', 1]]);
    expect(g.patterns[0]).toMatchObject({ line: '3', mode: 'tram', route: '3', head: { fr: 'Churchill', nl: 'Churchill' } });
    expect(g.patterns[0].next).toEqual([['stib:6359', 2], ['stib:6361', 4]]);
    expect(area(out, 'stib', '6359').deps).toEqual([[0, 734, 0, 0, '', 2]]);
  });

  it('stop_times désordonné, arrêt inconnu ignoré, voyage d’un seul arrêt écarté', async () => {
    const files = miniFeed({
      'stops.txt': stopsCsv(3),
      'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\nR1,ALL,SOLO\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
        + 'T1,08:20:00,08:20:00,S002,30\nSOLO,09:00:00,09:00:00,S000,1\nT1,08:00:00,08:00:00,S000,10\nT1,08:10:00,08:10:00,NOPE,15\nT1,08:05:00,08:05:00,S001,20\n',
    });
    const { out, result } = await runFeed('tec', files, ['2026-11-10']);
    expect(area(out, 'tec', 'S000').deps).toEqual([[0, 480, 0, 0, 'T1', 10]]);
    expect(area(out, 'tec', 'S000').patterns[0].next).toEqual([['tec:S001', 5], ['tec:S002', 20]]);
    expect(result.trips).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/arrêt inconnu/);
    expect(result.warnings.join(' ')).toMatch(/inutilisable/);
  });

  it('lignes et modes du résumé : départs d’abord, au plus 12, ordre mode puis naturel', async () => {
    let routes = 'route_id,route_short_name,route_type\n';
    let trips = 'route_id,service_id,trip_id\n';
    let st = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n';
    for (let i = 1; i <= 14; i++) {
      routes += `L${i},${i},${i === 1 ? 1 : 3}\n`;
      for (let k = 0; k < (i <= 12 ? 2 : 1); k++) {
        trips += `L${i},ALL,T${i}_${k}\n`;
        st += `T${i}_${k},08:0${k}:00,08:0${k}:00,S000,1\nT${i}_${k},08:3${k}:00,08:3${k}:00,S001,2\n`;
      }
    }
    const files = miniFeed({ 'routes.txt': routes, 'stops.txt': stopsCsv(2), 'trips.txt': trips, 'stop_times.txt': st });
    const { result } = await runFeed('stib', files, ['2026-11-10']);
    const s0 = result.areas.find((a) => a.id === 'stib:S000');
    expect(s0?.modes).toEqual(['metro', 'bus']);
    expect(s0?.lines).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    const s1 = result.areas.find((a) => a.id === 'stib:S001');
    expect(s1?.lines).toHaveLength(12); // terminus : lignes qui y arrivent
  });

  it('formes différentes seulement en amont : un seul motif à l’arrêt commun ; suite différente : deux motifs', async () => {
    const files = miniFeed({
      'stops.txt': stopsCsv(5),
      'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,ALL,LONG,Fin\nR1,ALL,SHORT,Fin\nR1,ALL,SLOW,Fin\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
        + 'LONG,08:00:00,08:00:00,S000,1\nLONG,08:05:00,08:05:00,S001,2\nLONG,08:10:00,08:10:00,S002,3\nLONG,08:15:00,08:15:00,S003,4\n'
        + 'SHORT,09:05:00,09:05:00,S001,1\nSHORT,09:10:00,09:10:00,S002,2\nSHORT,09:15:00,09:15:00,S003,3\n'
        + 'SLOW,10:05:00,10:05:00,S004,1\nSLOW,10:06:00,10:06:00,S001,2\nSLOW,10:20:00,10:20:00,S002,3\nSLOW,10:30:00,10:30:00,S003,4\n',
    });
    const { out } = await runFeed('tec', files, ['2026-11-10']);
    const s1 = area(out, 'tec', 'S001');
    expect(s1.patterns.map((p) => p.next)).toEqual([[['tec:S002', 5], ['tec:S003', 10]], [['tec:S002', 14], ['tec:S003', 24]]]);
    expect(s1.deps.map((d) => [d[1], d[2], d[4]])).toEqual([[485, 0, 'LONG'], [545, 0, 'SHORT'], [606, 1, 'SLOW']]);
  });

  it('deux clés donnant le même nom de fichier : la seconde zone est écartée et jamais référencée', async () => {
    const files = miniFeed({
      'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nX:1,Alpha,50.0,4.0\nX_1,Beta,50.1,4.0\nY,Gamma,50.2,4.0\n',
      'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,Y,1\nT1,08:05:00,08:05:00,X_1,2\nT1,08:10:00,08:10:00,X:1,3\n',
    });
    const { out, result } = await runFeed('tec', files, ['2026-11-10']);
    expect(result.areas.map((a) => a.id).sort()).toEqual(['tec:X:1', 'tec:Y']);
    expect(area(out, 'tec', 'X_1').id).toBe('tec:X:1');
    expect(area(out, 'tec', 'Y').patterns[0].next).toEqual([['tec:X:1', 10]]);
    expect(result.warnings.join(' ')).toMatch(/nom de fichier X_1\.json déjà utilisé/);
  });

  it('frequencies.txt signalé comme non pris en charge', async () => {
    const files = miniFeed({
      'stops.txt': stopsCsv(2),
      'trips.txt': 'route_id,service_id,trip_id\nR1,ALL,T1\n',
      'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,08:00:00,08:00:00,S000,1\nT1,08:10:00,08:10:00,S001,2\n',
      'frequencies.txt': 'trip_id,start_time,end_time,headway_secs\nT1,08:00:00,10:00:00,600\n',
    });
    const { result } = await runFeed('tec', files, ['2026-11-10']);
    expect(result.warnings.join(' ')).toMatch(/frequencies\.txt/);
  });

  it('erreurs en français : fichier obligatoire absent', async () => {
    const files = miniFeed({ 'stops.txt': stopsCsv(1), 'trips.txt': 'route_id,service_id,trip_id\n' });
    await expect(runFeed('tec', files)).rejects.toThrow('fichier GTFS obligatoire absent : stop_times.txt');
  });
});

describe('fillTimes', () => {
  it('arrivée = départ si l’une manque, interpolation par rang, voyage sans début ou fin rejeté', () => {
    const arr = Int16Array.from([-1, -1, -1, 30, -1]);
    const dep = Int16Array.from([0, -1, -1, 31, 40]);
    expect(fillTimes(arr, dep, 0, 5)).toBe(true);
    expect([...arr]).toEqual([0, 10, 20, 30, 40]);
    expect([...dep]).toEqual([0, 10, 20, 31, 40]);
    expect(fillTimes(Int16Array.from([-1, 5]), Int16Array.from([-1, 5]), 0, 2)).toBe(false);
  });
});
