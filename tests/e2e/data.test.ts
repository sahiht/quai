/**
 * Données produites par le pipeline (npm run build-data sur les zips de fixtures) : validation complète
 * (validate-data.ts), attentes de fixtures/README.md, et preuve que le validateur détecte les corruptions.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AreaFile, Meta, SearchFile, TileFile, TrainsDay } from '../../shared/types';
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
    expect(build.stdout).toMatch(/SNCB\s+OK\s+14 zones, 11 voyages/);
    expect(build.stdout).toMatch(/STIB\s+OK\s+10 zones/);
    expect(build.stdout).toMatch(/De Lijn\s+OK\s+7 zones/);
    expect(build.stdout).toMatch(/TEC\s+OK\s+5 zones/);
    expect(build.stdout).toMatch(/Taille : \d+ fichiers/);
    expect(build.stdout).toMatch(/Durée : [\d,]+ s ; mémoire maximale : \d+ Mo/);
  });

  it('validate-data : aucune erreur', () => {
    const r = validateData(dir);
    expect(r.errors).toEqual([]);
    expect(r.stats.areas).toEqual({ sncb: 14, stib: 10, delijn: 7, tec: 5 });
    expect(r.stats.trains).toEqual({ '2026-11-10': 10, '2026-11-11': 8 });
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
});
