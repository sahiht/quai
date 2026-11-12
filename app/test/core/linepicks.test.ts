/**
 * 1.2.2 (PRD-1.2.2 § 3, § 4) : lignes par numéro (findLines), arrêts d'une ligne (lineStops), passages d'une ligne
 * par sens (lineBoard). Règles pures de core/linepicks.ts, puis le vrai cœur sur les fixtures (createCore).
 * Données réelles : test/core/linepicks-real.test.ts (QUAI_REAL).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile } from '../../../shared/types';
import type { Departure, LineBoard } from '../../src/core/api';
import { QuaiError } from '../../src/core/errors';
import {
  directionGroups,
  directionsOf,
  groupDirections,
  lineKey,
  mainEnds,
  orderStops,
  partialIn,
  sameWay,
  sortMatches,
  type DirPattern,
} from '../../src/core/linepicks';
import { hhmm } from '../../src/core/util';
import { makeEnv } from './support/env';
import { CORE_DATA_DIR, readJson } from './support/network';

const N = (fr: string) => ({ fr, nl: fr });
const pat = (pi: number, head: string, next: string[], day = 1, total = day): DirPattern => ({ pi, head: N(head), next, day, total });
const dep = (line: string, head: string, sched: number, extra: Partial<Departure> = {}): Departure => ({
  op: 'tec',
  mode: 'bus',
  line,
  head: N(head),
  sched,
  est: sched,
  rt: true,
  delayMin: 0,
  cancelled: false,
  ...extra,
});
const view = (b: LineBoard) =>
  b.directions.map(
    (d) =>
      `${d.head.fr} : ${d.departures.map((x) => `${hhmm(x.est)}${x.rt ? '' : '~'}${x.cancelled ? ' supprimé' : ''}${x.partial ? ` jusqu'à ${x.head.fr}` : x.head.fr !== d.head.fr ? ` (${x.head.fr})` : ''}`).join(', ')}`,
  );

describe('règles (core/linepicks.ts)', () => {
  it('lineKey : casse, espaces et zéros de tête ignorés', () => {
    expect(['W', ' w ', '036', '36', '0', '00', 'N 05', 'n05', '1 2'].map(lineKey)).toEqual(['w', 'w', '36', '36', '0', '0', 'n05', 'n05', '12']);
  });

  it('mainEnds : la destination la plus servie et la plus servie en sens contraire, par ordre alphabétique ; boucle : une seule', () => {
    const A = { lat: 50.6838, lon: 4.3715 };
    const W = { lat: 50.7174, lon: 4.3979 };
    const M = { lat: 50.8361, lon: 4.3352 };
    const ends = mainEnds([
      { head: N('Bruxelles Midi'), from: A, to: M, trips: 40 },
      { head: N('Bruxelles Midi'), from: W, to: M, trips: 3 },
      { head: N('Waterloo Eglise'), from: A, to: W, trips: 30 },
      { head: N('Braine-l’Alleud Gare'), from: M, to: A, trips: 35 },
    ]);
    // « Waterloo Eglise » (30) va dans le même sens que « Bruxelles Midi » : le contraire est Braine-l'Alleud (35)
    expect(ends.map((n) => n.fr)).toEqual(['Braine-l’Alleud Gare', 'Bruxelles Midi']);
    expect(mainEnds([{ head: N('Tournai SNCB'), from: A, to: { lat: 50.6839, lon: 4.3716 }, trips: 20 }]).map((n) => n.fr)).toEqual(['Tournai SNCB']);
    expect(mainEnds([])).toEqual([]);
  });

  it('sens : premières zones suivantes communes ; même terminus réuni ; 3 au plus, dans l’ordre des motifs', () => {
    expect(sameWay(['a', 'b', 'c', 'd'], ['x', 'y', 'c'])).toBe(true);
    expect(sameWay(['a', 'b', 'c', 'd'], ['x', 'y', 'z', 'd'])).toBe(false);
    const g = groupDirections([
      pat(0, 'Wavre Gare', ['v', 'm', 'g', 'p', 'l', 'r', 'w'], 4, 16),
      pat(1, 'Braine-l’Alleud Gare', ['s', 'b', 'g2'], 3, 22),
      pat(5, 'Lasne Village', ['v', 'm', 'g', 'p', 'l'], 0, 2),
      pat(7, 'Vallée Bailly', ['s', 'b'], 1, 1),
      // variante vers le même terminus qui se sépare juste après l'arrêt : même sens
      pat(9, 'Wavre Gare', ['q', 'r2', 't', 'w'], 1, 3),
    ]);
    expect(g.map((x) => [x.head.fr, x.pats.map((p) => p.pi).sort()])).toEqual([
      ['Wavre Gare', [0, 5, 9]],
      ['Braine-l’Alleud Gare', [1, 7]],
    ]);
    // terminus du sens : le plus servi sur la journée de service, même si un autre l'est davantage ce soir
    expect(groupDirections([pat(0, 'Wavre Gare', ['v', 'w'], 16, 1), pat(3, 'Lasne Village', ['v'], 2, 2)])[0].head.fr).toBe('Wavre Gare');
    // plus de 3 sens : les plus servis, rangés par rang de motif
    const four = groupDirections([pat(4, 'A', ['a'], 5), pat(1, 'B', ['b'], 1), pat(2, 'C', ['c'], 3), pat(3, 'D', ['d'], 4)]);
    expect(four.map((x) => x.head.fr)).toEqual(['C', 'D', 'A']);
    // le soir, le service principal (Wavre, rang 0) est fini : le sens garde son nom et sa place, Lasne est partiel
    const evening = directionGroups([pat(0, 'Wavre Gare', ['v', 'm', 'l', 'w'], 16, 0), pat(1, 'Braine-l’Alleud Gare', ['s', 'b'], 22, 2), pat(18, 'Lasne Village', ['v', 'm', 'l'], 2, 2)]);
    expect(evening.map((x) => x.head.fr)).toEqual(['Wavre Gare', 'Braine-l’Alleud Gare']);
    expect(partialIn(evening[0].pats.find((p) => p.pi === 18)!, evening[0])).toBe(true);
    // un motif sans départ dans l'horizon qui touche deux sens n'en rejoint aucun
    const bridge = directionGroups([pat(0, 'A', ['a1', 'a2'], 5, 5), pat(1, 'B', ['b1', 'b2'], 5, 5), pat(2, 'C', ['a1', 'b1'], 50, 0)]);
    expect(bridge.map((x) => [x.head.fr, x.pats.map((p) => p.pi)])).toEqual([
      ['A', [0]],
      ['B', [1]],
    ]);
    // sans départ dans l'horizon : sens de tous les motifs (état « aucun passage »)
    expect(directionGroups([pat(0, 'A', ['a'], 0, 0), pat(1, 'B', ['b'], 0, 0)]).length).toBe(2);
    expect(directionGroups([pat(0, 'A', ['a'], 0, 0), pat(1, 'B', ['b'], 1, 1)]).map((x) => x.head.fr)).toEqual(['B']);
  });

  it('partiel : terminus sur le parcours du sens, avant son terminus ; ni une antenne ni le même terminus', () => {
    const [g] = groupDirections([
      pat(0, 'Wavre Gare', ['v', 'm', 'g', 'l', 'w'], 5),
      pat(1, 'Lasne Village', ['v', 'm', 'g', 'l'], 1),
      pat(2, 'Rixensart', ['v', 'm', 'x'], 1),
      pat(3, 'Wavre, Gare', ['v', 'm', 'g', 'l', 'w'], 1),
      pat(4, 'Genval', ['v', 'g'], 1),
    ]);
    const by = (pi: number) => g.pats.find((p) => p.pi === pi)!;
    expect(g.head.fr).toBe('Wavre Gare');
    expect(partialIn(by(1), g)).toBe(true); // début du parcours
    expect(partialIn(by(4), g)).toBe(true); // terminus sur le parcours (autre chemin)
    expect(partialIn(by(2), g)).toBe(false); // antenne
    expect(partialIn(by(3), g)).toBe(false); // même terminus, autre graphie
    expect(partialIn(by(0), g)).toBe(false);
  });

  it('passages par sens : `per` au plus, partiels marqués, passage STIB sans motif rangé par sa destination', () => {
    const groups = groupDirections([pat(0, 'Churchill', ['a', 'b', 'c'], 3), pat(1, 'Esplanade', ['x', 'y'], 3), pat(2, 'Gare du Midi', ['a', 'b'], 1)]);
    const T = (m: number) => Date.UTC(2026, 10, 10, 11, m);
    const dirs = directionsOf(
      groups,
      [
        { d: dep('3', 'Churchill', T(2)), pi: 0 },
        { d: dep('3', 'Gare du Midi', T(4)), pi: 2 },
        { d: dep('3', 'ESPLANADE', T(5)), pi: -1 },
        { d: dep('3', 'Churchill', T(9)), pi: 0 },
        { d: dep('3', 'Inconnu', T(10)), pi: -1 },
        { d: dep('3', 'Esplanade', T(12)), pi: 1 },
        { d: dep('3', 'Esplanade', T(20)), pi: 1 },
      ],
      2,
    );
    expect(dirs.map((d) => [d.head.fr, d.departures.map((x) => `${x.head.fr}${x.partial ? '*' : ''}`)])).toEqual([
      ['Churchill', ['Churchill', 'Gare du Midi*']],
      ['Esplanade', ['ESPLANADE', 'Esplanade']],
    ]);
  });

  it('tri : le plus proche, sinon par réseau puis numéro ; arrêts du plus proche au plus lointain', () => {
    const m = (op: 'stib' | 'tec' | 'delijn', d?: number) => ({ op, mode: 'bus' as const, line: '36', ends: [], routes: [`${op}:x`], ...(d === undefined ? {} : { nearest: { areaId: 'a', name: N('a'), distanceM: d } }) });
    expect(sortMatches([m('tec'), m('delijn'), m('stib')]).map((x) => x.op)).toEqual(['stib', 'delijn', 'tec']);
    expect(sortMatches([m('stib', 900), m('tec', 40), m('delijn', 300)]).map((x) => x.op)).toEqual(['tec', 'delijn', 'stib']);
    const stops = [
      { areaId: 'a', name: N('A'), lat: 50.68, lon: 4.37 },
      { areaId: 'b', name: N('B'), lat: 50.72, lon: 4.4 },
    ];
    expect(orderStops(stops).map((s) => s.areaId)).toEqual(['a', 'b']);
    expect(orderStops(stops, { lat: 50.7174, lon: 4.3979 }).map((s) => [s.areaId, s.distanceM])).toEqual([
      ['b', 325],
      ['a', 4600],
    ]);
  });
});

describe('vrai cœur sur les fixtures : findLines et lineStops', () => {
  it('findLines : numéro, terminus, variantes, le plus proche d’abord, ni train ni ligne inconnue', async () => {
    const { core, server } = makeEnv({ now: '2026-11-10T12:10' });
    const [t3] = await core.findLines('03');
    expect(t3).toMatchObject({ op: 'stib', mode: 'tram', line: '3', routes: ['stib:3'] });
    expect(t3.ends.map((n) => n.fr)).toEqual(['Churchill', 'Esplanade']);
    const [w] = await core.findLines(' w');
    expect(w).toMatchObject({ op: 'tec', mode: 'bus', line: 'W', routes: ['tec:B0536-23747'] });
    expect(w.ends.map((n) => n.fr)).toEqual(['Braine-l’Alleud Gare', 'Bruxelles Midi']);
    // tram 4 STIB et bus 4 TEC : sans position par réseau, à Namur le bus d'abord
    expect((await core.findLines('4')).map((m) => `${m.op} ${m.mode}`)).toEqual(['stib tram', 'tec bus']);
    const namur = await core.findLines('4', { lat: 50.46803, lon: 4.86356 });
    expect(namur.map((m) => `${m.op} ${m.nearest?.areaId} ${m.nearest?.distanceM}`)).toEqual(['tec tec:N508aga 0', 'stib stib:6364 55271']);
    expect(await core.findLines('IC')).toEqual([]);
    expect(await core.findLines('99')).toEqual([]);
    expect(await core.findLines('')).toEqual([]);
    // fichiers lus : l'index et les fichiers de ligne seulement
    expect(server.calls.filter((u) => u.includes('/areas/'))).toEqual([]);
  });

  it('lineStops : arrêts où l’on monte, dans l’ordre de la ligne ou le plus proche d’abord ; repli par numéro', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    const [w] = await core.findLines('w');
    expect((await core.lineStops(w)).map((s) => s.areaId)).toEqual(['tec:Bbrlgar1', 'tec:Bwategl1', 'tec:Bbxlmid1']);
    const near = await core.lineStops(w, { lat: 50.7174, lon: 4.3979 });
    expect(near.map((s) => s.areaId)).toEqual(['tec:Bwategl1', 'tec:Bbrlgar1', 'tec:Bbxlmid1']);
    expect(near[0]).toMatchObject({ name: { fr: 'Waterloo Eglise' }, distanceM: 0 });
    // Stalle, terminus du tram 4, n'est pas proposé
    const t4 = await core.lineStops({ op: 'stib', line: '4', routes: ['stib:4'] });
    expect(t4.map((s) => s.areaId)).toEqual(['stib:6357F', 'stib:6359', 'stib:6361', 'stib:6362', 'stib:6364']);
    // variantes inconnues (autre génération) : par réseau et numéro
    expect((await core.lineStops({ op: 'stib', line: '4', routes: ['stib:ancien'] })).length).toBe(5);
    expect(await core.lineStops({ op: 'stib', line: '77', routes: [] })).toEqual([]);
  });
});

describe('vrai cœur sur les fixtures : lineBoard', () => {
  it('tram 3 à Gare du Nord (12:10) : deux sens en temps réel STIB, ordre stable ; puis l’horaire prévu', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    const b = await core.lineBoard('stib:6357F', '3');
    expect(b).toMatchObject({ state: 'ok', op: 'stib', mode: 'tram', line: '3', anyPlanned: false, rtErrors: [], area: { id: 'stib:6357F' } });
    expect(view(b)).toEqual(['Esplanade : 12:16, 12:24', 'Churchill : 12:12, 12:20']);
    const four = await core.lineBoard('stib:6357F', '3', { perDirection: 4 });
    expect(view(four)).toEqual(['Esplanade : 12:16, 12:24, 12:32~, 12:40~', 'Churchill : 12:12, 12:20, 12:28~, 12:36~']);
    expect(four.anyPlanned).toBe(true);
    // un seul sens au départ du tram 4
    expect(view(await core.lineBoard('stib:6357F', '4'))).toEqual(['Stalle (P) : 12:15, 12:23']);
  });

  it('bus W : deux sens à Waterloo, un seul à son terminus ; relais en panne : prévu et réseau signalé', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const b = await core.lineBoard('tec:Bwategl1', 'w');
    expect(view(b)).toEqual(['Bruxelles Midi : 07:36~, 07:56~', 'Braine-l’Alleud Gare : 07:35~, 07:55~']);
    expect(b).toMatchObject({ state: 'ok', line: 'W', anyPlanned: true, rtErrors: ['tec'] });
    expect(view(await core.lineBoard('tec:Bbrlgar1', 'W'))).toEqual(['Bruxelles Midi : 07:44~, 08:04~']);
  });

  it('introuvable : ligne absente de l’arrêt, zone inconnue ; aucun passage : horaires périmés ; réseau coupé : erreur', async () => {
    const { core, server, clock } = makeEnv({ now: '2026-11-10T12:10' });
    expect(await core.lineBoard('stib:6357F', '71')).toMatchObject({ state: 'missing', directions: [], line: '71' });
    expect(await core.lineBoard('stib:404', '3')).toMatchObject({ state: 'missing', directions: [], area: { id: 'stib:404' } });
    expect(await core.lineBoard('autre:1', '3')).toMatchObject({ state: 'missing' });
    // jour non couvert par les horaires : sens connus, aucun passage
    clock.set('2026-11-14T12:10');
    const none = await core.lineBoard('stib:6357F', '3');
    expect(none.state).toBe('none');
    expect(none.directions.map((d) => [d.head.fr, d.departures.length])).toEqual([
      ['Esplanade', 0],
      ['Churchill', 0],
    ]);
    clock.set('2026-11-10T12:10');
    server.networkDown = true;
    await expect(core.lineBoard('stib:6362', '3')).rejects.toBeInstanceOf(QuaiError);
  });

  it('passage partiel : un W qui s’arrête à Waterloo Eglise, temps réel TEC fusionné ; zone fusionnée (aka) acceptée', async () => {
    const env = makeEnv({ now: '2026-11-10T07:40' });
    // fichier de zone de Braine-l'Alleud Gare complété d'un motif « Waterloo Eglise » (07:50) et d'un voyage en temps réel
    const file = readJson<AreaFile>(join(CORE_DATA_DIR, 'areas', 'tec', 'Bbrlgar1.json'));
    file.patterns.push({ line: 'W', mode: 'bus', route: file.patterns[0].route, head: N('Waterloo Eglise'), next: [['tec:Bwategl1', 12]] });
    file.deps.push([0, 7 * 60 + 50, file.patterns.length - 1, 0, 'W-SHORT-0750', 1]);
    file.deps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    env.server.memFiles.set('areas/tec/Bbrlgar1.json', JSON.stringify(file));
    env.server.relay.rt.tec.trips['W-SHORT-0750'] = { u: [[1, 'Bbrlgar1', 120, null, 0]] };
    const b = await env.core.lineBoard('tec:Bbrlgar1', 'W', { perDirection: 3 });
    expect(view(b)).toEqual(["Bruxelles Midi : 07:44~, 07:52 jusqu'à Waterloo Eglise, 08:04~"]);
    expect(b.directions[0].departures[1]).toMatchObject({ partial: true, rt: true, delayMin: 2, tripId: 'W-SHORT-0750' });
    expect(b.directions[0].departures[0].partial).toBeUndefined();
    // la clé interne du motif ne sort pas
    expect(Object.keys(b.directions[0].departures[1])).not.toContain('pi');
  });
});
