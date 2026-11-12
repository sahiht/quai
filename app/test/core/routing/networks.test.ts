/**
 * Petits réseaux (design-routing.md § 8) : ligne directe ; deux lignes urbaines d'opérateurs différents reliées à
 * pied (M5b) ; urbain, train, urbain ; trois trains (M5c) ; trois lignes urbaines refusées (portée PRD) ; attente de
 * 61 min refusée ; correspondance qui fait gagner 3 min sur le même premier train (PRD-1.2.2 § 7 : proposée, le direct
 * « Sans changement ») ; nuit avec repli au lendemain ; montée interdite (trains -1, lignes `f`) ; repli 1.0 sans
 * fichiers de ligne ; bus de remplacement de la SNCB (un véhicule comme un autre, « bus SNCB »).
 */
import { describe, expect, it } from 'vitest';
import type { LineFile, Meta, TrainsDay } from '../../../../shared/types';
import type { Endpoint as ApiEndpoint } from '../../../src/core/api';
import { meansText, rideName } from '../../../src/core/means';
import { hhmm } from '../../../src/core/util';
import { at as atTime } from '../support/network';
import { at, legsOf, miniEnv, plain, SETTINGS, summary, type MiniNet } from './support';

const station = (uic: string, name: string, lat: number, lon: number): ApiEndpoint => ({
  type: 'area',
  areaId: `sncb:${uic}`,
  op: 'sncb',
  name: { fr: name, nl: name },
  lat,
  lon,
});

const bus = (id: string, short: string) => ({ id, short, long: short, type: 3 });
const tram = (id: string, short: string) => ({ id, short, long: short, type: 0 });

describe('petits réseaux', () => {
  it('ligne directe : bus, marches de 1 min, « Le suivant »', async () => {
    const m: MiniNet = {
      tec: {
        stops: [
          { id: 'A1', name: 'Alpha', lat: 50.8, lon: 4.3 },
          { id: 'B1', name: 'Beta', lat: 50.8, lon: 4.4 },
        ],
        routes: [bus('L1', '1')],
        templates: [{ idTpl: 'L1-{HHMM}', route: 'L1', service: 'DAILY', head: 'Beta', stops: [['A1', 0], ['B1', 20]], from: '07:00', to: '09:00', every: 15 }],
      },
    };
    const { core } = miniEnv(m, '2026-11-10T07:05');
    const r = await core.route(at({ lat: 50.8003, lon: 4.3 }), at({ lat: 50.8003, lon: 4.4 }), atTime('2026-11-10T07:05'), SETTINGS);
    expect(summary(r)).toEqual([
      'short: marche 1 | 07:15 1 Alpha → Beta 07:35 | marche 1',
      'next: marche 1 | 07:30 1 Alpha → Beta 07:50 | marche 1',
      // « Le suivant » une seule fois : le départ d'après est « Plus tard »
      'later: marche 1 | 07:45 1 Alpha → Beta 08:05 | marche 1',
    ]);
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : direct, à pied 1 + 1 min');
    expect(plain(r.journeys[1].reason)).toBe('Le suivant : même trajet, 15 min plus tard');
    const ride = r.journeys[0].legs[1];
    expect(ride).toMatchObject({ op: 'tec', mode: 'bus', line: '1', tripId: 'L1-0715', fromStop: 'A1', toStop: 'B1' });
    expect(ride.stops?.map((s) => `${s.name.fr} ${hhmm(s.sched)}`)).toEqual(['Alpha 07:15', 'Beta 07:35']);
  });

  it('M5b : deux lignes urbaines de réseaux différents (TEC puis STIB), correspondance à pied', async () => {
    const m: MiniNet = {
      tec: {
        stops: [
          { id: 'A1', name: 'Alpha', lat: 50.8, lon: 4.3 },
          { id: 'B1', name: 'Beta', lat: 50.8, lon: 4.4 },
        ],
        routes: [bus('L1', '1')],
        templates: [{ idTpl: 'L1-{HHMM}', route: 'L1', service: 'DAILY', head: 'Beta', stops: [['A1', 0], ['B1', 20]], from: '07:00', to: '09:00', every: 20 }],
      },
      stib: {
        stops: [
          { id: '9001', name: 'GAMMA', lat: 50.8015, lon: 4.4005 },
          { id: '9002', name: 'EPSILON', lat: 50.85, lon: 4.4005 },
        ],
        routes: [tram('7', '7')],
        templates: [{ idTpl: '7{HHMM}', route: '7', service: 'DAILY', head: 'EPSILON', stops: [['9001', 0], ['9002', 15]], from: '07:00', to: '09:00', every: 10 }],
      },
    };
    const { core } = miniEnv(m, '2026-11-10T07:05');
    const r = await core.route(at({ lat: 50.8003, lon: 4.3 }), at({ lat: 50.8503, lon: 4.4005 }), atTime('2026-11-10T07:05'), SETTINGS);
    expect(legsOf(r.journeys[0])).toBe('marche 1 | 07:20 1 Alpha → Beta 07:40 | marche 3 | 07:50 T7 Gamma → Epsilon 08:05 | marche 1');
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 1 changement, à pied 1 + 3 + 1 min');
    expect(r.journeys[0].legs[3]).toMatchObject({ op: 'stib', fromStop: '9001', toStop: '9002' });
    expect(r.journeys[0].legs[3].tripId).toBeUndefined();
  });

  const chain: MiniNet = {
    stations: [
      { uic: '8000001', name: 'Pi', lat: 50.7, lon: 4.3 },
      { uic: '8000002', name: 'Qu', lat: 50.9, lon: 4.5 },
    ],
    trains: [
      { id: 'T-P-0800', route: 'IC', service: 'DAILY', num: '100', head: 'Qu', st: [['8000001_1', '08:00'], ['8000002_1', '08:30']] },
      { id: 'T-P-0830', route: 'IC', service: 'DAILY', num: '101', head: 'Qu', st: [['8000001_1', '08:30'], ['8000002_1', '09:00']] },
    ],
    tec: {
      stops: [
        { id: 'A1', name: 'Alpha', lat: 50.7, lon: 4.2 },
        { id: 'P1', name: 'Pi Gare', lat: 50.701, lon: 4.3 },
      ],
      routes: [bus('L1', '1')],
      templates: [{ idTpl: 'L1-{HHMM}', route: 'L1', service: 'DAILY', head: 'Pi Gare', stops: [['A1', 0], ['P1', 20]], from: '07:00', to: '09:00', every: 30 }],
    },
    stib: {
      stops: [
        { id: '9101', name: 'QU GARE', lat: 50.901, lon: 4.5 },
        { id: '9102', name: 'OMEGA', lat: 50.95, lon: 4.5 },
      ],
      routes: [tram('8', '8')],
      templates: [{ idTpl: '8{HHMM}', route: '8', service: 'DAILY', head: 'OMEGA', stops: [['9101', 0], ['9102', 12]], from: '07:00', to: '10:00', every: 10 }],
    },
  };

  it('urbain, train, urbain (trois véhicules, une gare à chaque bout)', async () => {
    const { core } = miniEnv(chain, '2026-11-10T07:20');
    const r = await core.route(at({ lat: 50.7003, lon: 4.2 }), at({ lat: 50.9503, lon: 4.5 }), atTime('2026-11-10T07:20'), SETTINGS);
    expect(legsOf(r.journeys[0])).toBe('marche 1 | 07:30 1 Alpha → Pi Gare 07:50 | marche 2 | 08:00 IC Pi → Qu 08:30 | marche 2 | 08:40 T8 Qu Gare → Omega 08:52 | marche 1');
    expect(r.journeys[0].transfers).toBe(2);
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 2 changements, 6 min à pied');
  });

  it('M5c : trois trains, deux correspondances (route et trains)', async () => {
    const m: MiniNet = {
      stations: [
        { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
        { uic: '8000002', name: 'Qu', lat: 50.7, lon: 4.1 },
        { uic: '8000003', name: 'Ro', lat: 50.8, lon: 4.2 },
        { uic: '8000004', name: 'Ta', lat: 50.9, lon: 4.3 },
      ],
      trains: [
        { id: 'T1', route: 'IC', service: 'DAILY', head: 'Qu', st: [['8000001_1', '08:00'], ['8000002_1', '08:20']] },
        { id: 'T2', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000002_1', '08:30'], ['8000003_1', '08:50']] },
        { id: 'T3', route: 'S1', service: 'DAILY', head: 'Ta', st: [['8000003_1', '09:00'], ['8000004_1', '09:20']] },
      ],
    };
    const { core } = miniEnv(m, '2026-11-10T07:30');
    const r = await core.route(station('8000001', 'Pi', 50.6, 4.0), station('8000004', 'Ta', 50.9, 4.3), atTime('2026-11-10T07:30'), SETTINGS);
    expect(summary(r)).toEqual(['short: 08:00 IC Pi → Qu 08:20 | 08:30 IC Qu → Ro 08:50 | 09:00 S1 Ro → Ta 09:20']);
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 2 changements');
    const tr = await core.trains('sncb:8000001', 'sncb:8000004', atTime('2026-11-10T07:30'));
    expect(tr.map((j) => j.legs.map((l) => `${hhmm(l.dep)} ${l.cat}`).join(' + '))).toEqual(['08:00 IC + 08:30 IC + 09:00 S1']);
    expect(tr[0].transfers).toBe(2);
  });

  it('trois lignes urbaines : refusé (une seule correspondance urbaine, PRD § 7)', async () => {
    const m: MiniNet = {
      tec: {
        stops: [
          { id: 'A1', name: 'Alpha', lat: 50.8, lon: 4.3 },
          { id: 'B1', name: 'Beta', lat: 50.8, lon: 4.4 },
        ],
        routes: [bus('L1', '1')],
        templates: [{ idTpl: 'L1-{HHMM}', route: 'L1', service: 'DAILY', head: 'Beta', stops: [['A1', 0], ['B1', 20]], from: '07:00', to: '09:00', every: 20 }],
      },
      stib: {
        stops: [
          { id: '9001', name: 'BETA BIS', lat: 50.8015, lon: 4.4 },
          { id: '9002', name: 'GAMMA', lat: 50.9, lon: 4.4 },
        ],
        routes: [tram('7', '7')],
        templates: [{ idTpl: '7{HHMM}', route: '7', service: 'DAILY', head: 'GAMMA', stops: [['9001', 0], ['9002', 15]], from: '07:00', to: '10:00', every: 10 }],
      },
      delijn: {
        stops: [
          { id: '301', name: 'Gamma Bis', lat: 50.9015, lon: 4.4 },
          { id: '302', name: 'Delta', lat: 50.9, lon: 4.6 },
        ],
        routes: [bus('D9', '9')],
        templates: [{ idTpl: 'D9{HHMM}', route: 'D9', service: 'DAILY', head: 'Delta', stops: [['301', 0], ['302', 15]], from: '07:00', to: '11:00', every: 10 }],
      },
    };
    const { core } = miniEnv(m, '2026-11-10T07:05');
    const to = at({ lat: 50.9003, lon: 4.6 });
    const r = await core.route(at({ lat: 50.8003, lon: 4.3 }), to, atTime('2026-11-10T07:05'), SETTINGS);
    expect(r).toMatchObject({ journeys: [], empty: 'noTrip' });
    // deux lignes urbaines suffisent pour Gamma : trouvé
    const r2 = await core.route(at({ lat: 50.8003, lon: 4.3 }), at({ lat: 50.9003, lon: 4.4 }), atTime('2026-11-10T07:05'), SETTINGS);
    expect(r2.journeys[0]?.transfers).toBe(1);
  });

  const waits = (dep: string): MiniNet => ({
    stations: [
      { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
      { uic: '8000002', name: 'Qu', lat: 50.7, lon: 4.1 },
      { uic: '8000003', name: 'Ro', lat: 50.8, lon: 4.2 },
    ],
    trains: [
      { id: 'T1', route: 'IC', service: 'DAILY', head: 'Qu', st: [['8000001_1', '07:40'], ['8000002_1', '08:00']] },
      { id: 'T2', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000002_1', dep], ['8000003_1', '09:30']] },
    ],
  });

  it('attente en correspondance : 60 min acceptées, 61 min refusées', async () => {
    const ok = miniEnv(waits('09:00'), '2026-11-10T07:30');
    const r = await ok.core.route(station('8000001', 'Pi', 50.6, 4.0), station('8000003', 'Ro', 50.8, 4.2), atTime('2026-11-10T07:30'), SETTINGS);
    expect(summary(r)).toEqual(['short: 07:40 IC Pi → Qu 08:00 | 09:00 IC Qu → Ro 09:30']);
    const ko = miniEnv(waits('09:01'), '2026-11-10T07:30');
    const r2 = await ko.core.route(station('8000001', 'Pi', 50.6, 4.0), station('8000003', 'Ro', 50.8, 4.2), atTime('2026-11-10T07:30'), SETTINGS);
    expect(r2).toMatchObject({ journeys: [], empty: 'noTrip' });
    expect(await ko.core.trains('sncb:8000001', 'sncb:8000003', atTime('2026-11-10T07:30'))).toEqual([]);
  });

  it('correspondance qui fait gagner 3 min sur le même premier train : proposée (1 min par changement), le direct « Sans changement » (PRD-1.2.2 § 7)', async () => {
    const m: MiniNet = {
      stations: [
        { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
        { uic: '8000002', name: 'Qu', lat: 50.7, lon: 4.1 },
        { uic: '8000003', name: 'Ro', lat: 50.8, lon: 4.2 },
      ],
      trains: [
        { id: 'T1', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000001_1', '08:25'], ['8000002_1', '09:16'], ['8000003_1', '09:24']] },
        { id: 'T2', route: 'S1', service: 'DAILY', head: 'Ro', st: [['8000002_1', '09:20'], ['8000003_1', '09:21']] },
      ],
    };
    const { core } = miniEnv(m, '2026-11-10T08:00');
    const r = await core.route(station('8000001', 'Pi', 50.6, 4.0), station('8000003', 'Ro', 50.8, 4.2), atTime('2026-11-10T08:00'), SETTINGS);
    expect(summary(r)).toEqual(['short: 08:25 IC Pi → Qu 09:16 | 09:20 S1 Qu → Ro 09:21', 'none: 08:25 IC Pi → Ro 09:24']);
    expect(plain(r.journeys[1].reason)).toBe('Sans changement : arrivée 09:24');
    // la recherche de trains (trains.ts) garde sa règle : jamais une correspondance qui fait gagner moins de 5 min
    const tr = await core.trains('sncb:8000001', 'sncb:8000003', atTime('2026-11-10T08:00'));
    expect(tr.map((j) => j.legs.length)).toEqual([1]);
  });

  it('nuit : rien ce soir, le premier train du lendemain, sans longue attente (CA-M8.1)', async () => {
    const m: MiniNet = {
      stations: [
        { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
        { uic: '8000002', name: 'Qu', lat: 50.7, lon: 4.1 },
        { uic: '8000003', name: 'Ro', lat: 50.8, lon: 4.2 },
      ],
      trains: [
        { id: 'TA', route: 'IC', service: 'DAILY', head: 'Qu', st: [['8000001_1', '22:10'], ['8000002_1', '22:40']] },
        { id: 'TB', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000002_1', '23:59'], ['8000003_1', '24:30']] },
        { id: 'TC', route: 'IC', service: 'DAILY', head: 'Qu', st: [['8000001_1', '23:55'], ['8000002_1', '24:25']] },
        { id: 'TD', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000002_1', '06:05'], ['8000003_1', '06:35']] },
        { id: 'TE', route: 'IC', service: 'DAILY', head: 'Ro', st: [['8000001_1', '05:16'], ['8000003_1', '06:20']] },
      ],
    };
    const { core } = miniEnv(m, '2026-11-10T23:50');
    const r = await core.route(station('8000001', 'Pi', 50.6, 4.0), station('8000003', 'Ro', 50.8, 4.2), atTime('2026-11-10T23:50'), SETTINGS);
    // 23:55 puis 5 h 40 d'attente à Qu : refusé ; le direct de 05:16 le 11/11
    expect(r.journeys[0].legs.map((l) => `${new Date(l.dep).toISOString().slice(0, 10)} ${hhmm(l.dep)}`)).toEqual(['2026-11-11 05:16']);
    expect(r.journeys.every((j) => j.legs.length === 1)).toBe(true);
  });

  it('montée interdite : le train de nuit en dépose seule n’est jamais proposé (CA-M8.4) ; données 1.0 sans -1 : permis', async () => {
    const m: MiniNet = {
      stations: [
        { uic: '8000009', name: 'Vienne', lat: 48.2, lon: 16.37 },
        { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
        { uic: '8000002', name: 'Qu', lat: 50.85, lon: 4.35 },
      ],
      trains: [
        { id: 'NJ1', route: 'NJ', service: 'DAILY', head: 'Qu', st: [['8000009_1', '00:30'], ['8000001_1', '09:21'], ['8000002_1', '10:19']] },
        { id: 'IC1', route: 'IC', service: 'DAILY', head: 'Qu', st: [['8000001_1', '09:27'], ['8000002_1', '10:35']] },
      ],
    };
    const forbid = (files: Record<string, unknown>) => {
      for (const [p, f] of Object.entries(files)) {
        if (!p.startsWith('trains/')) continue;
        const day = f as TrainsDay;
        for (const t of day.trips) if (t.id === 'NJ1') t.s[1][2] = -1; // Pi : descente seule
      }
    };
    const from = station('8000001', 'Pi', 50.6, 4.0);
    const to = station('8000002', 'Qu', 50.85, 4.35);
    const a = miniEnv(m, '2026-11-10T09:10', forbid);
    const r = await a.core.route(from, to, atTime('2026-11-10T09:10'), SETTINGS);
    expect(summary(r)[0]).toBe('short: 09:27 IC Pi → Qu 10:35');
    expect(r.journeys.some((j) => j.legs.some((l) => l.cat === 'NJ'))).toBe(false);
    expect((await a.core.trains('sncb:8000001', 'sncb:8000002', atTime('2026-11-10T09:10'))).map((j) => j.legs[0].cat)).toEqual(['IC']);
    // fichier 1.0 (aucun -1) : tout est permis, le Nightjet part le premier
    const b = miniEnv(m, '2026-11-10T09:10');
    expect((await b.core.trains('sncb:8000001', 'sncb:8000002', atTime('2026-11-10T09:10'))).map((j) => j.legs[0].cat)[0]).toBe('NJ');
  });

  it('ligne urbaine : descente interdite à un arrêt (autorisations `f` du fichier de ligne)', async () => {
    const m: MiniNet = {
      tec: {
        stops: [
          { id: 'A1', name: 'Alpha', lat: 50.8, lon: 4.3 },
          { id: 'B1', name: 'Beta', lat: 50.8, lon: 4.4 },
          { id: 'C1', name: 'Gamma', lat: 50.8, lon: 4.5 },
        ],
        routes: [bus('L1', '1')],
        templates: [{ idTpl: 'L1-{HHMM}', route: 'L1', service: 'DAILY', head: 'Gamma', stops: [['A1', 0], ['B1', 20], ['C1', 40]], from: '07:00', to: '09:00', every: 20 }],
      },
    };
    const noAlight = (files: Record<string, unknown>) => {
      const f = files['lines/tec/L1.json'] as LineFile;
      f.pats[0].f = 'bba'; // Beta : montée seule
    };
    const dest = at({ lat: 50.8003, lon: 4.4 });
    const ok = miniEnv(m, '2026-11-10T07:05');
    expect((await ok.core.route(at({ lat: 50.8003, lon: 4.3 }), dest, atTime('2026-11-10T07:05'), SETTINGS)).journeys.length).toBeGreaterThan(0);
    const ko = miniEnv(m, '2026-11-10T07:05', noAlight);
    expect(await ko.core.route(at({ lat: 50.8003, lon: 4.3 }), dest, atTime('2026-11-10T07:05'), SETTINGS)).toMatchObject({ journeys: [], empty: 'noTrip' });
  });

  it('bus de remplacement de la SNCB (trains/, catégorie « BUS ») : un véhicule comme un autre, « bus SNCB » dans les phrases', async () => {
    const m: MiniNet = {
      stations: [
        { uic: '8000001', name: 'Pi', lat: 50.6, lon: 4.0 },
        { uic: '8000002', name: 'Qu', lat: 50.7, lon: 4.1 },
        { uic: '8000003', name: 'Ro', lat: 50.8, lon: 4.2 },
      ],
      trains: [
        { id: 'IC1', route: 'IC', service: 'DAILY', num: '2105', head: 'Qu', st: [['8000001_1', '08:00'], ['8000002_1', '08:30']] },
        { id: 'IC2', route: 'IC', service: 'DAILY', num: '2107', head: 'Qu', st: [['8000001_1', '09:00'], ['8000002_1', '09:30']] },
        // remplace le train de Qu à Ro, numéroté d'après lui ; correspondance de gare (4 min) tenue de justesse
        { id: 'B1', route: 'BUS', service: 'DAILY', num: '3505', head: 'Ro', st: [['8000002_1', '08:34'], ['8000003_1', '09:05']] },
        { id: 'B2', route: 'BUS', service: 'DAILY', num: '3507', head: 'Ro', st: [['8000002_1', '09:34'], ['8000003_1', '10:05']] },
      ],
    };
    const { core } = miniEnv(m, '2026-11-10T07:50');
    const r = await core.route(station('8000001', 'Pi', 50.6, 4.0), station('8000003', 'Ro', 50.8, 4.2), atTime('2026-11-10T07:50'), SETTINGS);
    expect(summary(r)).toEqual(['short: 08:00 IC Pi → Qu 08:30 | 08:34 BUS Qu → Ro 09:05', 'next: 09:00 IC Pi → Qu 09:30 | 09:34 BUS Qu → Ro 10:05']);
    const bus = r.journeys[0].legs[1];
    // comme les départs des gares : op sncb, mode bus, ligne « BUS »
    expect(bus).toMatchObject({ op: 'sncb', mode: 'bus', line: 'BUS', cat: 'BUS', num: '3505', tripId: 'B1' });
    expect(meansText(r.journeys[0])).toBe('IC + bus SNCB');
    expect(rideName(bus)).toBe('bus SNCB');
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 1 changement');
  });

  it('repli 1.0 sans fichiers de ligne (meta.lines absent) : propositions étiquetées', async () => {
    const env = miniEnv(chain, '2026-11-10T07:20', (files) => {
      delete (files['meta.json'] as Meta).lines;
    });
    const r = await env.core.route(at({ lat: 50.703, lon: 4.3 }), at({ lat: 50.903, lon: 4.5 }), atTime('2026-11-10T07:40'), SETTINGS);
    expect(summary(r)).toEqual(['short: marche 6 | 08:00 IC Pi → Qu 08:30 | marche 6', 'next: marche 6 | 08:30 IC Pi → Qu 09:00 | marche 6']);
    expect(plain(r.journeys[1].reason)).toBe('Le suivant : même trajet, 30 min plus tard');
    expect(env.server.count((u) => u.includes('/lines/'))).toBe(0);
  });
});
