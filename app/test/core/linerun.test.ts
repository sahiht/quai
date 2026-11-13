/**
 * 1.2.6 (docs/v1.2.6/PRD-1.2.6.md § 3, § 4 et § 6 ; CA-126.3, CA-126.4, CA-126.6) : lignes suivies (core/linerun.ts) :
 * les sens d'une ligne, toute la ligne dans un sens (lineRun) avec l'attente à chaque arrêt, le temps réel STIB par
 * point d'arrêt, les véhicules qui arrivent, l'arrêt le plus proche ; matchFollow et completeFollow ; lignes « près de
 * toi » (linesNear) et couleurs officielles (lineColorsIn). Le vrai cœur sur les fixtures (createCore), au 10/11 à 12:10.
 */
import { describe, expect, it } from 'vitest';
import type { LineFile, Meta } from '../../../shared/types';
import type { LineMatch } from '../../src/core/api';
import { lineColorsIn, linePath, type LineData } from '../../src/core/linepicks';
import { NEAR_RUN_M, completeFollow, lineDirectionsIn, lineHeadsIn, lineRunIn, matchFollow, sameFollow, type LineDirection, type LineFollow } from '../../src/core/linerun';
import { gtfsTime, hhmm } from '../../src/core/util';
import { makeEnv } from './support/env';

const NOW = '2026-11-10T12:10';
const GDN = { lat: 50.86004, lon: 4.36017 };
const N = (fr: string) => ({ fr, nl: fr });
/** Un arrêt de lineRun : « nom heures », « ~ » pour l'horaire prévu, « ● » pour un véhicule qui arrive. */
const row = (s: { name: { fr: string }; next: { t: number; rt: boolean }[]; vehicle?: boolean }) =>
  `${s.vehicle ? '● ' : ''}${s.name.fr} ${s.next.map((x) => `${hhmm(x.t)}${x.rt ? '' : '~'}`).join(' ')}`;

describe('vrai cœur sur les fixtures : une ligne suivie, toute la ligne', () => {
  it('lineHeads : les sens rangés par terminus ; lineRun : les arrêts du motif le plus servi, 2 passages, le plus proche, le terminus', async () => {
    const { core } = makeEnv({ now: NOW });
    const [t3] = await core.findLines('3', GDN);
    expect(t3).toMatchObject({ op: 'stib', line: '3', mode: 'tram', routes: ['stib:3'] });
    expect(await core.lineHeads!(t3)).toEqual([N('Churchill'), N('Esplanade')]);
    const run = await core.lineRun!(t3, 0, { near: GDN });
    expect(run).toMatchObject({ op: 'stib', mode: 'tram', line: '3', dir: 0, state: 'ok', rtError: false, nearest: { index: 1, distanceM: 0 } });
    expect(run.heads.map((h) => h.fr)).toEqual(['Churchill', 'Esplanade']);
    // Gare du Nord : l'attente annoncée par la STIB (relais) ; ailleurs l'horaire prévu (« ~ »). Un tram entre
    // Esplanade et Gare du Nord : il y arrive avant le prochain d'Esplanade plus les 12 min de parcours
    expect(run.stops.map(row)).toEqual([
      'Esplanade 12:16~ 12:24~',
      '● Gare du Nord 12:12 12:20',
      'Rogier 12:14~ 12:22~',
      'De Brouckere 12:16~ 12:24~',
      'Bourse 12:17~ 12:25~',
      '● Gare du Midi 12:14~ 12:22~',
      '● Churchill 12:13~ 12:21~',
    ]);
    expect(run.stops.map((s) => !!s.last)).toEqual([false, false, false, false, false, false, true]);
    // l'autre sens : son propre motif, Gare du Nord sous le curseur
    const back = await core.lineRun!(t3, 1, { near: GDN });
    expect(back.stops.map((s) => s.name.fr)).toEqual(['Churchill', 'Rogier', 'Gare du Nord', 'Esplanade']);
    expect(back.nearest).toEqual({ index: 2, distanceM: 0 });
    // sans position, ou plus loin que 2 km : pas d'arrêt le plus proche
    expect((await core.lineRun!(t3, 0)).nearest).toBeUndefined();
    expect((await core.lineRun!(t3, 0, { near: { lat: GDN.lat + 0.06, lon: GDN.lon } })).nearest).toBeUndefined();
    expect(NEAR_RUN_M).toBe(2_000);
    // un sens hors bornes : le dernier
    expect((await core.lineRun!(t3, 5)).dir).toBe(1);
  });

  it('STIB : l’attente annoncée à un arrêt remplace l’horaire prévu, l’horaire prévu reprend après ; ● suit ; relais en panne : prévu, rtError', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6359'] = [{ line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: ['2026-11-10T12:13:00+01:00'] }];
    const [t3] = await env.core.findLines('3', GDN);
    const run = await env.core.lineRun!(t3, 0, { near: GDN });
    // Rogier : 12:13 annoncé, puis le prévu de 12:22 ; le tram de Gare du Nord (12:12) y arrive : il a déjà passé
    // Gare du Nord ? non : 12:13 vient avant 12:12 + 2 min de parcours, le tram est entre les deux
    expect(row(run.stops[2])).toBe('● Rogier 12:13 12:22~');
    // une autre ligne ou l'autre sens annoncés au même point ne comptent pas
    env.server.relay.stib.points['6361'] = [{ line: '4', dest: { fr: 'STALLE', nl: 'STALLE' }, times: ['2026-11-10T12:11:00+01:00'] }, { line: '3', dest: { fr: 'ESPLANADE', nl: 'ESPLANADE' }, times: ['2026-11-10T12:11:00+01:00'] }];
    env.clock.set(env.clock.t + 30_000);
    const again = await env.core.lineRun!(t3, 0, { near: GDN });
    expect(row(again.stops[3])).toBe('De Brouckere 12:16~ 12:24~');
    const down = makeEnv({ now: NOW, scene: 'noRT' });
    const planned = await down.core.lineRun!(t3, 0, { near: GDN });
    expect(planned.rtError).toBe(true);
    expect(planned.stops.every((s) => s.next.every((x) => !x.rt))).toBe(true);
  });

  it('TEC : une ligne et sa variante, deux sens ; ligne introuvable (variantes inconnues) : missing, sans exception', async () => {
    const { core } = makeEnv({ now: NOW });
    const [w] = await core.findLines('W');
    expect(w.ends.map((e) => e.fr)).toEqual(['Braine-l’Alleud Gare', 'Bruxelles Midi']);
    const run = await core.lineRun!(w, 0, { near: { lat: 50.6833, lon: 4.3891 } });
    expect(run.heads.map((h) => h.fr)).toEqual(['Braine-l’Alleud Gare', 'Bruxelles Midi']);
    expect(run.stops.map((s) => s.name.fr)).toEqual(['Bruxelles Midi', 'Waterloo Eglise', 'Braine-l’Alleud Gare']);
    // l'arrêt le plus proche à 1,2 km : sous le curseur
    expect(run.nearest).toEqual({ index: 2, distanceM: 1241 });
    const lost = await core.lineRun!({ op: 'stib', line: '99', routes: ['stib:99'] }, 0);
    expect([lost.state, lost.stops.length]).toEqual(['missing', 0]);
    expect(await core.lineHeads!({ routes: ['stib:99'] })).toEqual([]);
  });

  it('linesNear : les lignes des arrêts à 500 m, la plus proche d’abord (métro, tram, puis bus à égale distance), chacune une fois', async () => {
    const { core } = makeEnv({ now: NOW });
    const near = await core.linesNear!(GDN, 500);
    expect(near.map((m) => [m.op, m.line, m.mode, m.nearest?.name.fr, m.nearest?.distanceM])).toEqual([
      ['stib', '3', 'tram', 'Gare du Nord', 0],
      ['stib', '4', 'tram', 'Gare du Nord', 0],
      ['delijn', '232', 'bus', 'Bruxelles-Nord', 214],
      ['delijn', '270', 'bus', 'Bruxelles-Nord', 214],
      ['delijn', '460', 'bus', 'Bruxelles-Nord', 214],
      ['stib', '2', 'metro', 'Rogier', 361],
      ['stib', '6', 'metro', 'Rogier', 361],
    ]);
    // jamais une ligne de train ; plus près, moins de lignes
    expect(near.some((m) => m.mode === 'train' || m.op === 'sncb')).toBe(false);
    expect((await core.linesNear!(GDN, 100)).map((m) => m.line)).toEqual(['3', '4']);
  });
});

describe('lignes suivies : règles (sans données)', () => {
  const m = (p: Partial<LineMatch>): LineMatch => ({ op: 'tec', mode: 'bus', line: 'W', ends: [N('A'), N('B'), N('C')], routes: ['tec:a', 'tec:b'], ...p });

  it('sameFollow : même réseau, même numéro (casse et zéros de tête ignorés) ; matchFollow : même réseau et mode, le repère départage', () => {
    expect(sameFollow({ op: 'stib', line: '03' }, { op: 'stib', line: '3' })).toBe(true);
    expect(sameFollow({ op: 'tec', line: 'w' }, { op: 'tec', line: 'W' })).toBe(true);
    expect(sameFollow({ op: 'stib', line: '3' }, { op: 'delijn', line: '3' })).toBe(false);
    const a = m({ nearest: { areaId: 'tec:x', name: N('X'), distanceM: 10 } });
    const b = m({ routes: ['tec:c'], nearest: { areaId: 'tec:y', name: N('Y'), distanceM: 900 } });
    const f: LineFollow = { id: 'f', op: 'tec', line: 'W', routes: [], via: { areaId: 'tec:y', name: N('Y'), lat: 0, lon: 0 } };
    expect(matchFollow(f, [a, b])).toBe(b);
    expect(matchFollow({ ...f, via: undefined }, [a, b])).toBe(a);
    expect(matchFollow({ ...f, mode: 'tram' }, [a, b])).toBeNull();
    expect(matchFollow({ ...f, op: 'stib' }, [a, b])).toBeNull();
  });

  it('completeFollow : mode, variantes (16 au plus), terminus (2 au plus), couleur officielle ; le repère et l’ouverture d’office restent', () => {
    const f: LineFollow = { id: 'f', op: 'tec', line: 'W', routes: [], via: { areaId: 'tec:y', name: N('Y'), lat: 0, lon: 0 }, near: true, color: '000000' };
    const done = completeFollow(f, m({ routes: Array.from({ length: 20 }, (_, i) => `tec:${i}`), color: 'FFD200', text: 'D2001F' }));
    expect(done).toMatchObject({ id: 'f', mode: 'bus', color: 'FFD200', text: 'D2001F', near: true, via: f.via });
    expect([done.routes.length, done.ends?.map((e) => e.fr)]).toEqual([16, ['A', 'B']]);
    // une ligne sans couleur publiée : plus de couleur gardée
    expect(completeFollow(f, m({}))).not.toHaveProperty('color');
  });

  it('lineColorsIn : les couleurs de lines/index.json (5e et 6e éléments) par réseau et numéro ; jamais un train ; un index d’une autre nuit : rien', async () => {
    const index = {
      v: 1,
      generatedAt: 'nuit',
      conn: 400,
      stations: {},
      lines: [
        ['stib:3', '3', 'tram', 2, 'B5BA05', '000000'],
        ['stib:3-bis', '03', 'tram', 1, '111111'],
        ['tec:B0536-23747', 'W', 'bus', 2],
        ['delijn:1', '1', 'tram', 2, '0066B3'],
        ['sncb:IC', 'IC', 'train', 1, 'FF0000'],
      ],
    };
    const src = (generatedAt: string) => ({ meta: { lines: true, generatedAt } as never, json: async <T,>(p: string, valid: (x: unknown) => x is T) => (p === 'lines/index.json' && valid(index) ? index : null) });
    const colors = await lineColorsIn(src('nuit'));
    expect([...colors]).toEqual([
      ['stib:3', { color: 'B5BA05', text: '000000' }],
      ['delijn:1', { color: '0066B3' }],
    ]);
    expect((await lineColorsIn(src('autre nuit'))).size).toBe(0);
  });
});

/**
 * Correction 1.2.6 (contrôle qualité du 13/11, vraies données : le tram 4 en deux tronçons, des arrêts de variantes
 * absents) : chaque morceau d'une ligne est un sens, tous les arrêts des variantes sont à leur place, marqués.
 */
describe('lignes à variantes et en morceaux (correction 1.2.6)', () => {
  /** Arrêts sur un axe nord-sud (environ 1,1 km entre deux lettres), deux axes parallèles à 3,5 km. */
  const XY: Record<string, [number, number]> = {
    Z: [50.91, 4.35], A: [50.9, 4.35], B: [50.89, 4.35], C: [50.88, 4.35], X: [50.875, 4.36], D: [50.87, 4.35], E: [50.86, 4.35], F: [50.87, 4.33], G: [50.86, 4.32], H: [50.85, 4.35],
    N1: [50.9, 4.4], N2: [50.89, 4.4], N3: [50.88, 4.4], S1: [50.86, 4.4], S2: [50.85, 4.4], S3: [50.84, 4.4],
    T: [50.9, 4.45], a: [50.89, 4.45], b: [50.88, 4.46], c: [50.89, 4.47], x: [50.895, 4.46],
  };
  type P = { head: string; stops: string[]; trips: number };
  const file = (id: string, pats: P[]): LineFile => {
    const names = [...new Set(pats.flatMap((p) => p.stops))];
    return {
      v: 1,
      id,
      op: 'stib',
      route: id.slice(5),
      line: '9',
      mode: 'tram',
      areas: names.map((n) => [`stib:${n}`, XY[n][0], XY[n][1], N(n)]),
      pats: pats.map((p) => ({ head: N(p.head), a: p.stops.map((n) => names.indexOf(n)), s: p.stops.map(() => ''), prof: [p.stops.map((_, q) => 2 * q)], t: Array.from({ length: p.trips }, (_, k) => [0, 360 + 5 * k, 0]) })),
      conn: [],
    };
  };
  const source = (...files: LineFile[]): LineData => ({
    meta: { serviceDates: ['2026-11-10', '2026-11-11'] } as Meta,
    json: async <T,>(path: string, valid: (x: unknown) => x is T): Promise<T | null> => {
      const f = files.find((x) => linePath(x.id) === path);
      return f && valid(f) ? f : null;
    },
  });
  const stops = (d: LineDirection) => d.stops.map((s) => `${s.branch ? '◇' : ''}${s.areaId.slice(5)}`).join(' ');

  it('variantes d’un sens : l’épine, puis chaque arrêt à sa place (détour, départ plus tôt, embranchement, prolongement), marqué', async () => {
    const f = file('stib:9', [
      { head: 'E', stops: ['A', 'B', 'C', 'D', 'E'], trips: 50 },
      { head: 'E', stops: ['A', 'B', 'X', 'D', 'E'], trips: 20 },
      { head: 'G', stops: ['A', 'B', 'C', 'F', 'G'], trips: 10 },
      { head: 'H', stops: ['A', 'B', 'C', 'D', 'E', 'H'], trips: 5 },
      { head: 'E', stops: ['Z', 'A', 'B', 'C', 'D', 'E'], trips: 4 },
      { head: 'A', stops: ['E', 'D', 'C', 'B', 'A'], trips: 50 },
    ]);
    const dirs = await lineDirectionsIn(source(f), { routes: [f.id] });
    expect(dirs.map((d) => [d.head.fr, d.group, d.other])).toEqual([
      ['A', 1, 1],
      ['E', 0, 0],
    ]);
    expect(stops(dirs[1])).toBe('◇Z A B C ◇X D E ◇F ◇G ◇H');
    expect(stops(dirs[0])).toBe('E D C B A');
    // aucun arrêt d'un motif n'est caché
    for (const d of dirs) for (const p of d.patterns) for (const a of p.areas) expect(d.stops.some((s) => s.areaId === a)).toBe(true);
    // toute la ligne : les passages des variantes à leurs arrêts, le terminus de l'épine, le sens inverse
    const run = await lineRunIn(source(f), null, { op: 'stib', line: '9', mode: 'tram', routes: [f.id] }, 1, gtfsTime('2026-11-10', 360), null);
    expect(run).toMatchObject({ dir: 1, other: 0, state: 'ok' });
    expect(run.stops.map((s) => `${s.branch ? '◇' : ''}${s.name.fr}${s.last ? '|' : ''} ${s.next.map((x) => hhmm(x.t)).join(' ')}`)).toEqual([
      '◇Z 06:00 06:05',
      'A 06:00 06:00',
      'B 06:02 06:02',
      'C 06:04 06:04',
      '◇X 06:04 06:09',
      'D 06:06 06:06',
      'E| 06:08 06:08',
      '◇F 06:06 06:11',
      '◇G 06:08 06:13',
      '◇H 06:10 06:15',
    ]);
  });

  it('ligne en deux morceaux (travaux) : un sens par morceau et par sens, chacun son terminus ; « Autre sens » : le même morceau', async () => {
    const f = file('stib:4', [
      { head: 'Wiels', stops: ['N1', 'N2', 'N3'], trips: 50 },
      { head: 'Stalle', stops: ['S1', 'S2', 'S3'], trips: 40 },
      { head: 'Gare du Nord', stops: ['N3', 'N2', 'N1'], trips: 50 },
      { head: 'Porte de Hal', stops: ['S3', 'S2', 'S1'], trips: 40 },
    ]);
    const dirs = await lineDirectionsIn(source(f), { routes: [f.id] });
    const named = dirs.map((d) => [d.head.fr, stops(d), d.other === undefined ? null : dirs[d.other].head.fr]);
    expect(named).toEqual([
      ['Gare du Nord', 'N3 N2 N1', 'Wiels'],
      ['Porte de Hal', 'S3 S2 S1', 'Stalle'],
      ['Stalle', 'S1 S2 S3', 'Porte de Hal'],
      ['Wiels', 'N1 N2 N3', 'Gare du Nord'],
    ]);
    expect(await lineHeadsIn(source(f), { routes: [f.id] })).toEqual([N('Gare du Nord'), N('Porte de Hal'), N('Stalle'), N('Wiels')]);
  });

  it('boucle : un seul sens, sans sens inverse ; le terminus deux fois, l’arrêt d’une variante avant le retour', async () => {
    const f = file('stib:7', [
      { head: 'T', stops: ['T', 'a', 'b', 'c', 'T'], trips: 50 },
      { head: 'T', stops: ['T', 'a', 'x', 'T'], trips: 10 },
    ]);
    const [d, ...rest] = await lineDirectionsIn(source(f), { routes: [f.id] });
    expect(rest).toEqual([]);
    expect(d.other).toBeUndefined();
    expect(stops(d)).toBe('T a b c ◇x T');
    const run = await lineRunIn(source(f), null, { op: 'stib', line: '7', mode: 'tram', routes: [f.id] }, 0, gtfsTime('2026-11-10', 360), null);
    expect(run.other).toBeUndefined();
    expect(run.stops.map((s) => `${s.branch ? '◇' : ''}${s.name.fr}${s.last ? '|' : ''}`)).toEqual(['T', 'a', 'b', 'c', '◇x', 'T|']);
  });
});
