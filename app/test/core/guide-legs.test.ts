/**
 * 1.2.10 : les arrêts des étapes trouvées par le calcul de trajets portent leur position (core/routing/legs.ts) :
 * bus, tram, métro (zones des fichiers de ligne) et trains (gares du réseau de la recherche).
 */
import { describe, expect, it } from 'vitest';
import { at as atTime } from './support/network';
import { at, miniEnv, SETTINGS, type MiniNet } from './routing/support';

const bus = (id: string, short: string) => ({ id, short, long: short, type: 3 });

describe('positions des arrêts des étapes', () => {
  it('bus : chaque arrêt, intermédiaire compris', async () => {
    const m: MiniNet = {
      tec: {
        stops: [
          { id: 'A1', name: 'Alpha', lat: 50.8, lon: 4.3 },
          { id: 'M1', name: 'Milieu', lat: 50.8, lon: 4.35 },
          { id: 'B1', name: 'Beta', lat: 50.8, lon: 4.4 },
        ],
        routes: [bus('L1', '1')],
        templates: [{ idTpl: 'L1-{HHMM}', route: 'L1', service: 'DAILY', head: 'Beta', stops: [['A1', 0], ['M1', 10], ['B1', 20]], from: '07:00', to: '09:00', every: 15 }],
      },
    };
    const { core } = miniEnv(m, '2026-11-10T07:05');
    const r = await core.route(at({ lat: 50.8003, lon: 4.3 }), at({ lat: 50.8003, lon: 4.4 }), atTime('2026-11-10T07:05'), SETTINGS);
    const ride = r.journeys[0].legs.find((l) => l.kind === 'ride')!;
    expect(ride.stops?.map((s) => [s.name.fr, s.lat, s.lon])).toEqual([
      ['Alpha', 50.8, 4.3],
      ['Milieu', 50.8, 4.35],
      ['Beta', 50.8, 4.4],
    ]);
  });

  it('train : chaque gare desservie', async () => {
    const m: MiniNet = {
      stations: [
        { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
        { uic: '8000002', name: 'Qu', lat: 50.7, lon: 4.1 },
        { uic: '8000003', name: 'Ro', lat: 50.8, lon: 4.2 },
      ],
      trains: [{ id: 'T1', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000001_1', '08:00'], ['8000002_1', '08:20'], ['8000003_1', '08:40']] }],
    };
    const { core } = miniEnv(m, '2026-11-10T07:30');
    const st = (uic: string, name: string, lat: number, lon: number) => ({ type: 'area' as const, areaId: `sncb:${uic}`, op: 'sncb' as const, name: { fr: name, nl: name }, lat, lon });
    const r = await core.route(st('8000001', 'Pi', 50.6, 4.0), st('8000003', 'Ro', 50.8, 4.2), atTime('2026-11-10T07:30'), SETTINGS);
    const ride = r.journeys[0].legs.find((l) => l.kind === 'ride')!;
    expect(ride.stops?.map((s) => [s.name.fr, s.lat, s.lon])).toEqual([
      ['Pi', 50.6, 4.0],
      ['Qu', 50.7, 4.1],
      ['Ro', 50.8, 4.2],
    ]);
  });
});
