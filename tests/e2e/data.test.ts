/**
 * Données produites par le pipeline (npm run build-data sur les zips de fixtures) : validation complète
 * (validate-data.ts), attentes de fixtures/README.md, et preuve que le validateur détecte les corruptions.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AreaFile, LineFile, LineIndex, LineTile, Meta, SearchFile, TileFile, TrainsDay } from '../../shared/types';
import { validateData } from './validate-data';
import { buildFixtureData, type RunResult } from './lib/stack';

let dir: string;
let build: RunResult;
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(dir, rel), 'utf8')) as T;

beforeAll(async () => {
  ({ dir, result: build } = await buildFixtureData());
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('préparation des données (zips de fixtures, QUAI_DATE=2026-11-10)', () => {
  it('build-data réussit, rapport de taille et durée affichés', () => {
    expect(build.code).toBe(0);
    expect(build.stdout).toMatch(/SNCB\s+OK\s+15 zones, 21 voyages/);
    expect(build.stdout).toMatch(/STIB\s+OK\s+10 zones/);
    expect(build.stdout).toMatch(/De Lijn\s+OK\s+7 zones/);
    expect(build.stdout).toMatch(/TEC\s+OK\s+8 zones/);
    expect(build.stdout).toMatch(/Fichiers de ligne : 12 lignes \(STIB 4, De Lijn 4, TEC 4\), [\d,]+ Mo bruts, [\d,]+ Mo en gzip/);
    expect(build.stdout).toMatch(/Taille : \d+ fichiers/);
    expect(build.stdout).toMatch(/Durée : [\d,]+ s ; mémoire maximale : \d+ Mo/);
  });

  it('validate-data : aucune erreur', () => {
    const r = validateData(dir);
    expect(r.errors).toEqual([]);
    expect(r.stats.areas).toEqual({ sncb: 15, stib: 10, delijn: 7, tec: 8 });
    expect(r.stats.trains).toEqual({ '2026-11-10': 20, '2026-11-11': 18 });
    expect(r.stats.lines).toBe(12);
    expect(r.warnings).toEqual([]);
  });

  it('identifiants de zone attendus par fixtures/README.md', () => {
    const meta = read<Meta>('meta.json');
    expect(meta.serviceDates).toEqual(['2026-11-10', '2026-11-11']);
    const want: Record<string, [string, string]> = {
      'sncb:8812005': ['areas/sncb/8812005.json', 'Bruxelles-Nord'],
      'stib:6357F': ['areas/stib/6357F.json', 'Gare du Nord'],
      'stib:6359': ['areas/stib/6359.json', 'Rogier'],
      'delijn:308611': ['areas/delijn/308611.json', 'Bruxelles-Nord'],
      'delijn:200553': ['areas/delijn/200553.json', 'Gand-Saint-Pierre'],
      'delijn:200101': ['areas/delijn/200101.json', 'Korenmarkt, Gand'],
      'tec:N508aga': ['areas/tec/N508aga.json', 'Namur Gare'],
    };
    for (const [id, [file, fr]] of Object.entries(want)) {
      const a = read<AreaFile>(file);
      expect([a.id, a.n.fr]).toEqual([id, fr]);
    }
    // STIB : pointid temps réel numérique ; quais De Lijn et TEC tirés du nom
    expect(read<AreaFile>('areas/stib/6357F.json').stops.map((s) => [s.id, s.rt])).toEqual([['6357F', '6357'], ['6358', '6358']]);
    expect(read<AreaFile>('areas/delijn/308611.json').stops.map((s) => s.platform)).toEqual(['4', '6']);
    expect(read<AreaFile>('areas/tec/N508aga.json').stops.map((s) => s.platform)).toEqual(['A', 'B']);
    expect(read<AreaFile>('areas/delijn/308611.json').n).toEqual({ fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' });
  });

  it('jour férié et après minuit dans les départs', () => {
    const namur = read<AreaFile>('areas/sncb/8863008.json');
    expect(namur.deps.filter((d) => d[0] === 1).map((d) => d[1])).toEqual([522, 582]); // 08:42 et 09:42 le 11/11
    expect(namur.deps.filter((d) => d[0] === 0).map((d) => d[1])).toEqual([462, 522]); // 07:42 et 08:42 le 10/11
    const nord = read<AreaFile>('areas/sncb/8812005.json');
    expect(nord.deps.some((d) => d[0] === 0 && d[1] === 1441 && d[4].endsWith(':2436:20261231'))).toBe(true); // 24:01
    const gare = read<AreaFile>('areas/tec/N508aga.json');
    expect(gare.deps.some((d) => d[0] === 0 && d[1] === 1450 && d[4] === 'N4-2410')).toBe(true); // 24:10
  });

  it('1.1 : fichiers de ligne de la même génération, lignes et correspondances attendues', () => {
    const meta = read<Meta>('meta.json');
    expect(meta.lines).toEqual({ files: 12, ops: ['stib', 'delijn', 'tec'], conn: 400 });
    const index = read<LineIndex>('lines/index.json');
    expect(index.generatedAt).toBe(meta.generatedAt);
    expect(index.lines.map((l) => `${l[0]} ${l[1]} ${l[2]}`)).toEqual([
      'delijn:1 1 tram', 'delijn:232 232 bus', 'delijn:270 270 bus', 'delijn:460 460 bus',
      'stib:2 2 metro', 'stib:3 3 tram', 'stib:4 4 tram', 'stib:6 6 metro',
      'tec:B0536-23747 W bus', 'tec:N4 4 bus', 'tec:N5 5 bus', 'tec:N51 51 bus',
    ]);
    const num = (key: string) => index.lines.findIndex((l) => l[0] === key);
    // T3 vers Esplanade : Churchill, Rogier, Gare du Nord, Esplanade (pas d'arrêt à Gare du Midi, scénario 4)
    const t3 = read<LineFile>('lines/stib/3.json');
    const north = t3.pats.find((p) => p.head.fr === 'Esplanade');
    expect(north?.a.map((i) => t3.areas[i][0])).toEqual(['stib:6366', 'stib:6359', 'stib:6357F', 'stib:6380']);
    expect(north?.s).toEqual(['6367', '6360', '6358', '6380']);
    expect(t3.trips).toBeUndefined();
    // W : noms remis en casse ; à Bruxelles Midi, correspondance avec M2, T3 et T4 de Gare du Midi
    const w = read<LineFile>('lines/tec/B0536-23747.json');
    expect(w.areas.map((a) => a[3].fr)).toEqual(['Braine-l’Alleud Gare', 'Waterloo Eglise', 'Bruxelles Midi']);
    expect(w.conn[2]).toEqual([num('stib:2'), num('stib:3'), num('stib:4')]);
    // rangs des trip_id dans l'ordre des premiers départs : W-0604, WR-0610, W-0624…
    expect(w.trips?.slice(0, 3)).toEqual(['W-0604', 'WR-0610', 'W-0624']);
    expect(w.pats.find((p) => p.head.fr === 'Bruxelles Midi')?.t.slice(0, 2)).toEqual([[0, 364, 0, 0], [0, 384, 0, 2]]);
    // tram De Lijn : « T1 » dans le GTFS, « 1 » publié
    expect(read<LineFile>('lines/delijn/1.json').line).toBe('1');
    expect(index.stations['sncb:8814001']).toEqual([num('stib:2'), num('stib:3'), num('stib:4'), num('tec:B0536-23747')]);
    expect(index.stations['sncb:8814266']).toBeUndefined(); // gare de Waterloo : arrêt W à plus de 400 m
    const tiles = Object.assign({}, ...readdirSync(join(dir, 'linetiles')).map((f) => read<LineTile>(`linetiles/${f}`).a)) as Record<string, number[]>;
    expect(tiles['stib:8302']).toEqual([num('stib:6')]); // Roi Baudouin : arrivée seule, mais desservi
    expect(tiles['tec:Bwategl1']).toEqual([num('tec:B0536-23747')]);
  });

  it('1.1 : noms lisibles, zones sans départ hors des tuiles et de la recherche, trains du soir', () => {
    const eglise = read<AreaFile>('areas/tec/Bwategl1.json');
    expect(eglise.n).toEqual({ fr: 'Waterloo Eglise', nl: 'Waterloo Eglise' });
    expect(eglise.patterns.map((p) => `${p.line} ${p.head.fr}`).sort()).toEqual(['W Braine-l’Alleud Gare', 'W Bruxelles Midi']);
    const gsp = read<AreaFile>('areas/delijn/200553.json');
    expect(gsp.patterns.every((p) => p.line === '1')).toBe(true);
    const inTiles = new Set(readdirSync(join(dir, 'tiles')).flatMap((f) => read<TileFile>(`tiles/${f}`).areas.map((a) => a.id)));
    const inSearch = new Set(readdirSync(join(dir, 'search')).flatMap((f) => read<SearchFile>(`search/${f}`).items.map((i) => i.id)));
    for (const id of ['sncb:8821006', 'sncb:8891009', 'stib:6370', 'stib:8302', 'delijn:300120', 'delijn:300450', 'delijn:301870', 'tec:N520aaa', 'tec:N530aaa', 'tec:N540aaa']) {
      expect([inTiles.has(id), inSearch.has(id)], id).toEqual([false, false]);
    }
    for (const id of ['sncb:8814266', 'tec:Bwategl1', 'tec:Bbxlmid1', 'tec:Bbrlgar1', 'sncb:8883006']) expect(inTiles.has(id), id).toBe(true);
    const central = read<AreaFile>('areas/sncb/8813003.json');
    const evening = central.deps.filter((d) => d[0] === 0 && d[1] >= 17 * 60 && d[1] < 19 * 60).map((d) => `${central.patterns[d[2]].line} ${d[1]} ${central.patterns[d[2]].head.fr}`);
    expect(evening).toEqual(['IC 1032 Namur', 'IC 1092 Namur']);
    const t = read<TrainsDay>('trains/2026-11-10.json');
    expect(t.trips.every((x) => x.s.every((p) => p[1] >= 0 && p[2] >= 0))).toBe(true); // aucune interdiction dans les fixtures
  });

  it('recherche « gand » : fichier ga.json avec les gares et les arrêts De Lijn', () => {
    const ga = read<SearchFile>('search/ga.json');
    expect(ga.items.map((x) => x.id)).toEqual(expect.arrayContaining(['sncb:8892007', 'sncb:8893120', 'delijn:200101', 'delijn:200553']));
  });
});

describe('le validateur détecte les corruptions', () => {
  let copy: string;
  beforeAll(() => {
    copy = mkdtempSync(join(tmpdir(), 'quai-e2e-mut-'));
  });
  afterAll(() => {
    rmSync(copy, { recursive: true, force: true });
  });

  const mutate = (name: string, fn: (d: string) => void, expected: RegExp) =>
    it(name, () => {
      const d = join(copy, name.replace(/\W+/g, '_'));
      cpSync(dir, d, { recursive: true });
      fn(d);
      const r = validateData(d);
      expect(r.errors.some((e) => expected.test(e)), `erreurs : ${JSON.stringify(r.errors.slice(0, 5))}`).toBe(true);
    });
  const edit = <T>(d: string, rel: string, f: (x: T) => void, pretty = false) => {
    const x = JSON.parse(readFileSync(join(d, rel), 'utf8')) as T;
    f(x);
    writeFileSync(join(d, rel), pretty ? JSON.stringify(x, null, 2) : JSON.stringify(x));
  };

  it('les sigles gardés par prettyName (« UZ-VUB », « RTBF ») ne sont pas des noms restés en majuscules', () => {
    const d = join(copy, 'sigles');
    cpSync(dir, d, { recursive: true });
    edit<AreaFile>(d, 'areas/stib/6357F.json', (a) => {
      a.patterns[0].head = { fr: 'UZ-VUB', nl: 'UZ-VUB' };
      a.patterns[1].head = { fr: 'RTBF', nl: 'VRT' };
    });
    expect(validateData(d).errors.filter((e) => /majuscules/.test(e))).toEqual([]);
  });

  mutate('départs non triés', (d) => edit<AreaFile>(d, 'areas/stib/6357F.json', (a) => a.deps.reverse()), /non triés/);
  mutate('index de motif invalide', (d) => edit<AreaFile>(d, 'areas/delijn/308611.json', (a) => (a.deps[0][2] = 99)), /hors de patterns/);
  mutate('index d’arrêt invalide', (d) => edit<AreaFile>(d, 'areas/tec/N508aga.json', (a) => (a.deps[0][3] = 7)), /hors de stops/);
  mutate('zone de next inexistante', (d) => edit<AreaFile>(d, 'areas/stib/6357F.json', (a) => (a.patterns[0].next[0][0] = 'stib:9999')), /sans fichier/);
  mutate('zone de tuile sans fichier', (d) => rmSync(join(d, 'areas/stib/6359.json')), /sans fichier areas|feeds\.stib\.areas/);
  mutate('mauvaise tuile', (d) => edit<TileFile>(d, 'tiles/2543_145.json', (t) => (t.areas[0].lat += 0.05)), /appartient à la tuile|position différente/);
  mutate('clé de recherche incohérente', (d) => edit<SearchFile>(d, 'search/ga.json', (s) => s.items.push({ ...s.items[0], id: 'tec:N509aaa', op: 'tec', n: { fr: 'Namur Place Léopold', nl: 'Namur Place Léopold' } })), /aucun mot de clé|noms différents/);
  mutate('identifiant préfixé', (d) => edit<AreaFile>(d, 'areas/delijn/308611.json', (a) => (a.deps[0][4] = `gt:delijn:${a.deps[0][4]}`)), /non normalisé/);
  mutate('trip_id STIB non vide', (d) => edit<AreaFile>(d, 'areas/stib/6357F.json', (a) => (a.deps[0][4] = '1103x')), /STIB attendu vide/);
  mutate('index de gare des trains invalide', (d) => edit<TrainsDay>(d, 'trains/2026-11-10.json', (t) => (t.trips[0].s[0][0] = 99)), /index de gare/);
  mutate('JSON indenté', (d) => edit<Meta>(d, 'meta.json', () => undefined, true), /indenté/);
  mutate('nom vide', (d) => edit<AreaFile>(d, 'areas/tec/N509aaa.json', (a) => (a.n.nl = '')), /nom nl vide/);
  mutate('nom resté en majuscules', (d) => edit<AreaFile>(d, 'areas/stib/6357F.json', (a) => (a.n.fr = 'GARE DU NORD')), /tout en majuscules « GARE DU NORD »/);
  mutate('départ en double', (d) => edit<AreaFile>(d, 'areas/sncb/8812005.json', (a) => a.deps.splice(3, 0, a.deps[3])), /en double/);
  mutate('train absent des départs', (d) => edit<AreaFile>(d, 'areas/sncb/8863008.json', (a) => (a.deps = a.deps.slice(1))), /sans départ dans la zone/);
  // 1.1
  mutate('départ vers un terminus de la zone', (d) => edit<AreaFile>(d, 'areas/stib/6357F.json', (a) => (a.patterns[0].next = [])), /terminus de la zone même/);
  mutate('même voyage deux fois dans une zone', (d) => edit<AreaFile>(d, 'areas/delijn/308611.json', (a) => {
    const x = a.deps[0];
    a.deps.splice(1, 0, [x[0], x[1], x[2], x[3], x[4], x[5] + 1]);
  }), /même voyage deux fois/);
  mutate('zone sans départ dans les tuiles', (d) => {
    const s = JSON.parse(readFileSync(join(d, 'areas/stib/6370.json'), 'utf8')) as AreaFile;
    const key = `${Math.floor(s.lat / 0.02)}_${Math.floor(s.lon / 0.03)}`;
    let tile: TileFile = { v: 1, areas: [] };
    try {
      tile = JSON.parse(readFileSync(join(d, `tiles/${key}.json`), 'utf8')) as TileFile;
    } catch { /* tuile absente */ }
    tile.areas.push({ id: s.id, op: s.op, n: s.n, lat: s.lat, lon: s.lon, modes: ['tram'], lines: ['4'] });
    writeFileSync(join(d, `tiles/${key}.json`), JSON.stringify(tile));
  }, /sans aucun départ dans les tuiles/);
  mutate('nom TEC en capitales', (d) => edit<AreaFile>(d, 'areas/tec/Bwategl1.json', (a) => (a.n = { fr: 'WATERLOO Eglise', nl: 'WATERLOO Eglise' })), /commune en capitales/);
  mutate('ligne déjà préfixée', (d) => edit<AreaFile>(d, 'areas/delijn/200553.json', (a) => (a.patterns[0].line = 'T1')), /déjà préfixée/);
  mutate('heure de train invalide', (d) => edit<TrainsDay>(d, 'trains/2026-11-10.json', (t) => (t.trips[0].s[1][1] = -2)), /heures invalides/);
  mutate('fichier de ligne vers une zone inconnue', (d) => edit<LineFile>(d, 'lines/stib/3.json', (l) => (l.areas[0][0] = 'stib:9999')), /zone stib:9999 sans fichier areas/);
  mutate('index d’une autre génération', (d) => edit<LineIndex>(d, 'lines/index.json', (x) => (x.generatedAt = '2026-11-09T01:15:00.000Z')), /deux générations/);
  mutate('meta.lines.files faux', (d) => edit<Meta>(d, 'meta.json', (m) => (m.lines = { files: 11, ops: ['stib', 'delijn', 'tec'], conn: 400 })), /lines\.files = 11/);
  mutate('conn sans une liste par zone', (d) => edit<LineFile>(d, 'lines/tec/N4.json', (l) => l.conn.pop()), /conn doit avoir une liste par zone/);
  mutate('correspondance trop lointaine', (d) => edit<LineFile>(d, 'lines/delijn/1.json', (l) => (l.conn[0] = [0, 4].filter((x) => x !== 0))), /sans arrêt à moins de 400 m/);
  mutate('profil décroissant', (d) => edit<LineFile>(d, 'lines/stib/2.json', (l) => (l.pats[0].prof[0] = [...l.pats[0].prof[0]].reverse())), /profil invalide/);
  mutate('voyages non triés', (d) => edit<LineFile>(d, 'lines/tec/N5.json', (l) => l.pats[0].t.reverse()), /non triés par \(jour, départ\)/);
  mutate('autorisations invalides', (d) => edit<LineFile>(d, 'lines/tec/N4.json', (l) => (l.pats[0].f = 'ab')), /descente au premier arrêt|aucune montée/);
  mutate('tuile de lignes fausse', (d) => edit<LineTile>(d, 'linetiles/2542_145.json', (t) => (t.a['stib:6359'] = [...t.a['stib:6359'], 11])), /≠ lignes des fichiers/);
  mutate('voyage absent du fichier de ligne', (d) => edit<LineFile>(d, 'lines/delijn/232.json', (l) => (l.trips = l.trips?.map((x) => `${x}x`))), /absent du fichier de ligne/);
});
