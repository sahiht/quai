/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : mesure de la sortie du métro (pipeline/src/walk/exits.ts, commande « exits »), sur un
 * petit extrait fabriqué autour de Bruxelles-Central (lieu public) : une station avec quai, couloir et escalier jusqu'à
 * une rue nommée (E), un quai sous terre isolé (C), un quai seulement en surface (B), un arrêt sans voie (A), une
 * sortie vers un sentier sans nom (D), un escalator qui ne monte pas (C, sens unique respecté), un arrêt de bus en
 * surface (compté, pas mesuré), une sortie qui débouche d'abord sur un passage au nom de la station (« Louise ») avant
 * l'avenue (gardée). 1.3.1 (R1, construction) : fichier publié data/exits.json (writeExits, semaine, publication).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXITS_FILE, isExitsFile, type ExitsFile } from '../../app/src/core/walk/exits-format.ts';
import { buildWalk } from '../src/walk/build.ts';
import { main } from '../src/walk/cli.ts';
import { byCode, exitReport, exitsFile, featureOf, isStreetName, isUnderStop, joinPublished, loadExitGraph, measureFeature, publishedRailStops, publishedStibStops, readStibFeatures, sameStationMissing, stibCode, writeExits, type FeatureResult, type StibFeature } from '../src/walk/exits.ts';
import { readKeyedNodes, PbfFile } from '../src/walk/pbf.ts';
import { EXITS_FORMAT, EXITS_TRY_FILE, exitsGap, publishExits, publishWalk, readTiles, weeklyWalk, type ExitsTry } from '../src/walk/weekly.ts';
import { cleanupTempDirs, tempDir } from './helpers.ts';
import { ll, writePbf, type PbfNode, type PbfWay } from './walk-helpers.ts';

afterAll(cleanupTempDirs);

const at: Record<number, [number, number]> = {
  // rues nommées (grand réseau)
  1: [-300, 40],
  14: [80, 40],
  3: [300, 40],
  4: [300, 300],
  // Bourse : quai, couloir, escalier jusqu'au boulevard (nœud 14)
  10: [-60, 0],
  11: [0, 0],
  12: [60, 0],
  13: [80, 20],
  15: [0, -3],
  // quai isolé sous terre
  30: [500, -200],
  31: [650, -200],
  32: [800, -200],
  33: [650, -203],
  // quai en surface
  40: [-350, -400],
  41: [-100, -400],
  42: [-200, -397],
  // arrêt sans voie
  50: [-1500, -1500],
  // sortie vers un sentier sans nom
  60: [1200, 0],
  61: [1300, 0],
  62: [1300, 20],
  63: [1300, 300],
  64: [1250, -3],
  // escalator qui descend seulement
  70: [0, -900],
  71: [150, -900],
  72: [150, -870],
  73: [0, -870],
  74: [300, -870],
  75: [75, -903],
  // arrêt de bus en surface
  80: [0, 45],
  // Louise : l'escalier débouche sur un passage au nom de la station, puis l'avenue à 30 m
  90: [2000, 0],
  91: [2100, 0],
  92: [2100, 20],
  93: [2100, 50],
  94: [2400, 50],
  95: [1800, 50],
  96: [2050, -3],
};

const stop = (ref: string, name: string, extra: Record<string, string> = {}) => ({ railway: 'stop', public_transport: 'stop_position', subway: 'yes', location: 'underground', 'ref:STIB_MIVB': ref, name, ...extra });
const nodeTags: Record<number, Record<string, string>> = {
  15: stop('8001', 'Bourse - Beurs', { 'name:nl': 'Beurs' }),
  33: stop('8002', 'Isolé'),
  42: stop('8003', 'Surface'),
  50: stop('8004', 'Loin'),
  64: stop('8005', 'Sans nom'),
  75: stop('8006', 'Escalator'),
  80: { highway: 'bus_stop', 'ref:STIB_MIVB': '9001', name: 'Bourse' },
  96: stop('8007', 'Louise'),
};

const ways: PbfWay[] = [
  { id: 1001, refs: [1, 14, 3], tags: { highway: 'residential', name: 'Boulevard Anspach' } },
  { id: 1002, refs: [3, 4], tags: { highway: 'residential', name: 'Rue Neuve' } },
  { id: 2001, refs: [10, 11, 12], tags: { railway: 'platform', public_transport: 'platform', layer: '-1', name: 'Bourse', 'ref:STIB_MIVB': '8001;8011F' } },
  { id: 2002, refs: [12, 13], tags: { highway: 'footway', layer: '-1' } },
  { id: 2003, refs: [13, 14], tags: { highway: 'steps', layer: '-1' } },
  { id: 3001, refs: [30, 31, 32], tags: { railway: 'platform', layer: '-1' } },
  { id: 4001, refs: [40, 41], tags: { railway: 'platform' } },
  { id: 6001, refs: [60, 61], tags: { railway: 'platform', layer: '-1' } },
  { id: 6002, refs: [61, 62], tags: { highway: 'steps', layer: '-1' } },
  { id: 6003, refs: [62, 63], tags: { highway: 'footway' } },
  { id: 7001, refs: [70, 71], tags: { railway: 'platform', layer: '-1' } },
  // escalator de la rue (72) vers le quai (71) : sens unique, il ne monte pas
  { id: 7002, refs: [72, 71], tags: { highway: 'steps', conveying: 'forward', layer: '-1' } },
  { id: 7003, refs: [73, 72, 74], tags: { highway: 'residential', name: 'Rue de l’Escalier' } },
  { id: 9001, refs: [90, 91], tags: { railway: 'platform', layer: '-1', name: 'Louise' } },
  { id: 9002, refs: [91, 92], tags: { highway: 'steps', layer: '-1' } },
  { id: 9003, refs: [92, 93], tags: { highway: 'pedestrian', name: 'Louise' } },
  { id: 9004, refs: [95, 93, 94], tags: { highway: 'residential', name: 'Avenue de la Toison d’Or' } },
];

function nodes(): PbfNode[] {
  return Object.entries(at)
    .map(([id, [dx, dy]]) => {
      const [lat, lon] = ll(dx, dy);
      const tags = nodeTags[Number(id)];
      return { id: Number(id), lat, lon, ...(tags ? { tags } : {}) };
    })
    .sort((a, b) => a.id - b.id);
}

/** Extrait PBF, tuiles construites depuis lui, données publiées avec deux stations de métro. */
function fixture(o: { plainNodes?: boolean; sorted?: boolean; perBlock?: number } = {}) {
  const dir = tempDir('quai-exits-');
  const pbf = join(dir, 'extrait.osm.pbf');
  writeFileSync(pbf, writePbf(nodes(), ways, { timestamp: 1_763_078_400, ...o }));
  const data = join(dir, 'data');
  mkdirSync(join(data, 'tiles'), { recursive: true });
  const [blat, blon] = ll(0, 10);
  const [flat, flon] = ll(3000, 3000);
  writeFileSync(
    join(data, 'tiles', '2542_145.json'),
    JSON.stringify({
      v: 1,
      areas: [
        { id: 'stib:1', op: 'stib', n: { fr: 'Bourse', nl: 'Beurs' }, lat: blat, lon: blon, modes: ['metro', 'tram'], lines: ['3'] },
        { id: 'stib:2', op: 'stib', n: { fr: 'Station lointaine' }, lat: flat, lon: flon, modes: ['metro'], lines: ['1'] },
        { id: 'stib:3', op: 'stib', n: { fr: 'Arrêt de bus' }, lat: blat, lon: blon, modes: ['bus'], lines: ['48'] },
      ],
    }),
  );
  // fichiers de ligne publiés : arrêts physiques que l'appli donne à ses étapes, toujours sans lettre (8001 ; 8011,
  // écrit « 8011F » dans OpenStreetMap ; 8007 n'est desservi par aucune ligne publiée)
  mkdirSync(join(data, 'lines', 'stib'), { recursive: true });
  writeFileSync(join(data, 'lines', 'stib', '3.json'), JSON.stringify({ v: 1, id: 'stib:3', op: 'stib', line: '3', mode: 'tram', areas: [['stib:1', blat, blon, { fr: 'Bourse', nl: 'Beurs' }], ['stib:2', flat, flon, { fr: 'Station lointaine' }]], pats: [{ a: [0, 0, 0], s: ['8001', '', '9001'] }, { a: [0, 1], s: ['8011', '8002'] }] }));
  writeFileSync(join(data, 'lines', 'stib', 'casse.json'), '{ illisible');
  return { dir, pbf, data, tiles: join(dir, 'tiles') };
}

describe('1.3.1 : sorties du métro (mesure de vérification R1)', () => {
  it('lit les nœuds porteurs de ref:STIB_MIVB et leurs étiquettes (nœuds denses ou simples, trié ou non, plusieurs blocs)', () => {
    for (const o of [{}, { plainNodes: true }, { sorted: false, perBlock: 4 }, { plainNodes: true, perBlock: 3 }]) {
      const fx = fixture(o);
      const { features, timestamp } = readStibFeatures(fx.pbf);
      expect(timestamp).toBe(1_763_078_400);
      const byOsm = new Map(features.map((f) => [f.osm, f]));
      expect([...byOsm.keys()].sort()).toEqual(['n15', 'n33', 'n42', 'n50', 'n64', 'n75', 'n80', 'n96', 'w2001']);
      const bourse = byOsm.get('n15') as StibFeature;
      expect(bourse).toMatchObject({ codes: ['8001'], name: 'Bourse', role: 'stop', mode: 'metro', under: true });
      const [lat, lon] = ll(0, -3);
      expect(bourse.lat).toBeCloseTo(lat, 6);
      expect(bourse.lon).toBeCloseTo(lon, 6);
      // quai (voie) : moyenne de ses nœuds, deux numéros, sous terre par sa couche
      const quai = byOsm.get('w2001') as StibFeature;
      expect(quai).toMatchObject({ codes: ['8001', '8011'], role: 'platform', under: true });
      expect(quai.lat).toBeCloseTo(ll(0, 0)[0], 6);
      // arrêt de bus en surface : lu, mais pas mesuré
      expect(byOsm.get('n80')).toMatchObject({ role: 'platform', mode: 'bus', under: false });
      expect(features.filter(isUnderStop).map((f) => f.osm).sort()).toEqual(['n15', 'n33', 'n42', 'n50', 'n64', 'n75', 'n96', 'w2001']);
    }
  });

  it('un bloc sans la clé ne décode aucune étiquette ; les nœuds demandés donnent leurs coordonnées', () => {
    const fx = fixture({ perBlock: 4 });
    const f = new PbfFile(fx.pbf);
    try {
      const keyed: number[] = [];
      const wanted: number[] = [];
      for (let i = 0; i < f.blobs.length; i++) readKeyedNodes(f.block(i), 'ref:STIB_MIVB', (id) => keyed.push(id), (id) => id === 11 || id === 63, (id) => wanted.push(id));
      expect(keyed.sort((a, b) => a - b)).toEqual([15, 33, 42, 50, 64, 75, 80, 96]);
      expect(wanted.sort((a, b) => a - b)).toEqual([11, 63]);
      const none: number[] = [];
      for (let i = 0; i < f.blobs.length; i++) readKeyedNodes(f.block(i), 'clé:absente', (id) => none.push(id));
      expect(none).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('classe chaque arrêt sous terre : sortie nommée par les couloirs, sans nom, sans sortie, en surface, sans voie', async () => {
    const fx = fixture();
    await buildWalk({ input: fx.pbf, out: fx.tiles, log: () => undefined });
    const { features } = readStibFeatures(fx.pbf);
    const targets = features.filter(isUnderStop);
    const g = await loadExitGraph(fx.tiles, targets);
    expect(g).not.toBeNull();
    const res = new Map(targets.map((f) => [f.osm, measureFeature(g!, f)]));
    expect(res.get('n15')).toMatchObject({ cls: 'E', names: ['Boulevard Anspach'] });
    // quai (60 m), couloir (28 m), escalier (20 m)
    expect(res.get('n15')!.underM).toBeGreaterThan(100);
    expect(res.get('n15')!.underM).toBeLessThan(115);
    expect(res.get('w2001')!.cls).toBe('E');
    expect(res.get('n33')!.cls).toBe('C');
    expect(res.get('n42')!.cls).toBe('B');
    expect(res.get('n50')!.cls).toBe('A');
    expect(res.get('n64')!.cls).toBe('D');
    // l'escalator descend seulement : pas de sortie par lui
    expect(res.get('n75')!.cls).toBe('C');
    // le passage au nom de la station (« Louise ») est sauté : l'avenue, 30 m plus loin, est gardée
    expect(res.get('n96')).toMatchObject({ cls: 'E', names: ['Avenue de la Toison d’Or'] });
    const codes = byCode([...res.values()]);
    expect(codes.map((c) => `${c.code}:${c.cls}`)).toEqual(['8001:E', '8002:C', '8003:B', '8004:A', '8005:D', '8006:C', '8007:E', '8011:E']);
    // point en surface : le haut de l'escalier, au bord du boulevard ; mètres de couloir arrondis
    const e = codes[0].exits[0];
    expect(e.name).toBe('Boulevard Anspach');
    expect(e.lat).toBeCloseTo(ll(80, 40)[0], 4);
    expect(e.lon).toBeCloseTo(ll(80, 40)[1], 4);
    expect(Number.isInteger(e.m)).toBe(true);
  });

  it('sans le sens unique de l’escalator, la même station sort par la rue de l’Escalier', async () => {
    const fx = fixture();
    await buildWalk({ input: fx.pbf, out: fx.tiles, log: () => undefined });
    const g = (await loadExitGraph(fx.tiles, [featureOf('n75', ...ll(75, -903), nodeTags[75])]))!;
    const f = featureOf('n75', ...ll(75, -903), nodeTags[75]);
    // même graphe, sens unique effacé : l'escalator monte aussi
    g.eFlags.forEach((v, e) => {
      g.eFlags[e] = v & ~(2 | 4);
    });
    expect(measureFeature(g, f)).toMatchObject({ cls: 'E', names: ['Rue de l’Escalier'] });
  });

  it('bilan : taux, seuil, classes, exemples publics et contrôle avec les stations officielles', async () => {
    const fx = fixture();
    await buildWalk({ input: fx.pbf, out: fx.tiles, log: () => undefined });
    const { features } = readStibFeatures(fx.pbf);
    const g = (await loadExitGraph(fx.tiles, features.filter(isUnderStop)))!;
    const r = exitReport(g, features, [
      { id: 'stib:1', name: 'Bourse', lat: ll(0, 10)[0], lon: ll(0, 10)[1] },
      { id: 'stib:2', name: 'Station lointaine', lat: ll(3000, 3000)[0], lon: ll(3000, 3000)[1] },
    ], { osmDate: '2025-11-14' });
    const text = r.lines.join('\n');
    expect(r.rate).toBeCloseTo(3 / 8, 6);
    expect(text).toContain('Sorties du métro : 8 numéros STIB sous terre');
    expect(text).toContain('sortie nommée par les couloirs pour 3 sur 8 (37,5 %) ; seuil de 80 % NON atteint');
    expect(text).toContain('A pas de voie piétonne à 30 m 1 ; B quai seulement en surface 1 ; C couloirs sans sortie à 600 m 2 ; D sortie sans rue ni place 1 ; E sortie nommée 3');
    expect(text).toContain('sorties retenues pour 2 stations');
    expect(text).toMatch(/Sorties du métro : Bourse → Boulevard Anspach \(1\d\d m\)\n/);
    expect(text).toMatch(/Sorties du métro : Louise → Avenue de la Toison d’Or \(70 m\)\n/);
    expect(text).toContain('sans couloir jusqu’à la rue : Isolé (8002, C), Surface (8003, B), Loin (8004, A), Escalator (8006, C)');
    expect(text).toContain('sortie sans rue ni place : Sans nom (8005, D)');
    expect(text).toContain('2 stations STIB de métro publiées ; avec un arrêt OSM sous terre à 150 m 1 (50,0 %) ; avec une sortie nommée 1 (50,0 %)');
    expect(text).toContain('stations de métro sans arrêt OSM sous terre : Station lointaine');
    expect(r.official).toEqual({ stations: 2, covered: 1, named: 1 });
  });

  it('commande « exits » : extrait local, tuiles, données publiées ; bilan et deux annotations dans le journal', async () => {
    const fx = fixture();
    await buildWalk({ input: fx.pbf, out: fx.tiles, log: () => undefined });
    const log: string[] = [];
    const code = await main(['exits', '--tiles', fx.tiles, '--input', fx.pbf, '--stops', fx.data], { GITHUB_ACTIONS: 'true' }, (m) => log.push(m));
    expect(code).toBe(0);
    const text = log.join('\n');
    expect(text).toContain('Sorties du métro : extrait OSM du 2025-11-14');
    expect(text).toContain('Sorties du métro : données officielles : 2 stations STIB de métro publiées');
    // fichier des sorties et jointure avec les arrêts de l'appli (8001 ; 8011, « 8011F » dans OpenStreetMap ; 8007 sans ligne)
    expect(text).toMatch(/Sorties du métro : fichier des sorties : 3 arrêts, 3 sorties, 2 noms, \d+ octets ; nom le plus long : « Avenue de la Toison d’Or » \(24 caractères\)\n/);
    expect(text).toContain('Sorties du métro : arrêts de l\'appli : 4 arrêts physiques STIB publiés (fichiers de ligne) ; numéros du fichier des sorties retrouvés par l\'appli 2 sur 3 (66,7 %)');
    expect(text).toContain('Sorties du métro : numéros du fichier sans arrêt publié : Louise (8007)');
    // contrôle : un arrêt de tram de la même station (Bourse, 9001) absent du fichier ; 8002 est seul dans sa station
    expect(text).toContain('Sorties du métro : arrêts de métro ou de tram des mêmes stations absents du fichier (en surface : normal ; sous terre : à corriger) : Bourse (9001, tram)\n');
    const notes = log.filter((l) => l.startsWith('::notice title=Sorties du métro (R1)::'));
    expect(notes).toHaveLength(3);
    expect(notes[2]).toContain('retrouvés par l\'appli 2 sur 3');
    expect(notes[0]).toContain('(37,5 %25) ; seuil de 80 %25 NON atteint');
    // erreurs d'usage et tuiles absentes
    expect(await main(['exits', '--tiles', fx.tiles], {}, () => undefined)).toBe(2);
    expect(await main(['exits', '--tiles', join(fx.dir, 'rien'), '--input', fx.pbf], {}, () => undefined)).toBe(1);
  });

  it('arrêts physiques publiés (fichiers de ligne) et jointure comme dans l’appli : numéro exact, sinon sans sa lettre', async () => {
    const fx = fixture();
    const pub = await publishedStibStops(fx.data);
    expect([...pub!].sort()).toEqual(['8001', '8002', '8011', '9001']);
    expect(await publishedStibStops(join(fx.dir, 'rien'))).toBeNull();
    const x = (name: string): [string, number, number, number] => [name, 50.85, 4.35, 40];
    const file: ExitsFile = { v: 1, version: '2025-11-14', builtAt: '', source: '', licence: '', attribution: '', stops: { '8001': { s: 'Bourse', x: [x('Rue A')] }, '8011': { s: 'Bourse', x: [x('Rue A')] }, '8007': { s: 'Louise', x: [x('Rue B')] }, '8011F': { s: 'Bourse', x: [x('Rue C')] } } };
    // la publication n'a jamais de lettre : une clé « 8011F » du fichier ne serait retrouvée par personne (d'où stibCode)
    expect(joinPublished(file, pub!)).toEqual({ reached: ['8001', '8011'], lost: ['8007', '8011F'] });
    expect(joinPublished({ ...file, stops: { '8011': file.stops['8011'] } }, pub!)).toEqual({ reached: ['8011'], lost: [] });
    // arrêts de métro et de tram publiés, avec leur station ; ceux d'une station du fichier qui n'y sont pas
    const rail = await publishedRailStops(fx.data);
    expect([...rail!.entries()].map(([id, r]) => `${id} ${r.area} ${r.name} ${r.mode}`).sort()).toEqual(['8001 stib:1 Bourse tram', '8002 stib:2 Station lointaine tram', '8011 stib:1 Bourse tram', '9001 stib:1 Bourse tram']);
    expect(await publishedRailStops(join(fx.dir, 'rien'))).toBeNull();
    expect(sameStationMissing(file, rail!)).toEqual(['Bourse (9001, tram)']);
    expect(sameStationMissing({ ...file, stops: { '8002': file.stops['8001'], '9001': file.stops['8001'] } }, rail!)).toEqual(['Bourse (8001, tram)', 'Bourse (8011, tram)']);
    expect(sameStationMissing({ ...file, stops: {} }, rail!)).toEqual([]);
    // contrôle du 20/11 (Simonis 0470F et 0473F, Albert 0711F et 0712F) : le numéro du fichier est celui de l'appli
    expect(stibCode('0470F')).toBe('0470');
    expect(stibCode('2285G')).toBe('2285');
    expect(stibCode('8362')).toBe('8362');
    expect(stibCode('F')).toBe('F');
    const tram = featureOf('n1', 50.86, 4.33, { railway: 'tram_stop', location: 'underground', name: 'Simonis', 'ref:STIB_MIVB': '0470F; 0470 ;0473F' });
    expect(tram.codes).toEqual(['0470', '0473']);
    const made = exitsFile(byCode([{ f: tram, cls: 'E', underM: 44, names: ['Rue A'], exits: [{ name: 'Rue A', lat: 50.86, lon: 4.33, m: 44 }] }]), { version: '2026-11-19', builtAt: '' });
    expect(Object.keys(made.stops)).toEqual(['0470', '0473']);
    expect(joinPublished(made, new Set(['0470', '0473']))).toEqual({ reached: ['0470', '0473'], lost: [] });
  });

  it('noms des sorties : rues et places seulement, jamais le nom de la station (consigne du 20/11)', () => {
    for (const n of ['Rue Neuve', 'Avenue de la Toison d’Or', 'Boulevard Anspach', 'Place Louise', 'Chaussée de Wavre', 'CHAUSSÉE DE MONS', 'Square Patrice Lumumba', 'Parvis Saint-Gilles', 'Esplanade de l’Europe', 'Petite rue des Bouchers', 'Rond-Point Schuman', 'Quai au Bois à Brûler', 'Cours Saint-Michel', 'Pont Fernand Demany']) {
      expect(isStreetName(n, 'Station')).toBe(true);
    }
    expect(isStreetName('Parc', 'Parc')).toBe(false);
    expect(isStreetName('Louise', 'Louise')).toBe(false);
    expect(isStreetName('Gare de l’Ouest', "Gare de l'Ouest")).toBe(false);
    expect(isStreetName('Gare du Midi', 'Gare du Midi')).toBe(false);
    expect(isStreetName('Heysel', 'Heysel')).toBe(false);
    // le nom de la station lui-même, même s'il commence comme une rue
    expect(isStreetName('Porte de Hal', 'Porte de Hal')).toBe(false);
    expect(isStreetName('Place Flagey', 'Place Flagey')).toBe(false);
    // ni sentier, ni parc, ni quai, ni nom sans mot de rue
    for (const n of ['Sentier de la Marjolaine', 'Groenenberg', 'Parc de Bruxelles', 'Galerie Ravenstein', '', '   ']) expect(isStreetName(n, 'Station')).toBe(false);
    // une rue qui porte le nom de la station reste une rue
    expect(isStreetName('Avenue Herrmann-Debroux', 'Herrmann-Debroux')).toBe(true);
  });

  it('fichier publié : numéros avec une sortie seulement, 3 sorties au plus, la plus proche du quai d’abord', () => {
    const f = (osm: string, codes: string[], name = 'Station'): StibFeature => ({ osm, lat: 50.85, lon: 4.35, codes, name, role: 'stop', mode: 'metro', under: true });
    const x = (name: string, m: number) => ({ name, lat: 50.85, lon: 4.35, m });
    const results: FeatureResult[] = [
      { f: f('n1', ['8101']), cls: 'E', underM: 40, names: [], exits: [x('Rue A', 40), x('Rue B', 90), x('Rue C', 120)] },
      // même numéro par son quai : Rue B plus courte, Rue D en plus
      { f: f('w2', ['8101']), cls: 'E', underM: 30, names: [], exits: [x('Rue B', 30), x('Rue D', 200)] },
      { f: f('n3', ['8102']), cls: 'C', names: [], exits: [] },
      { f: f('n4', ['8103']), cls: 'D', names: [], exits: [] },
    ];
    const codes = byCode(results);
    expect(codes.find((c) => c.code === '8101')!.exits.map((e) => `${e.name} ${e.m}`)).toEqual(['Rue B 30', 'Rue A 40', 'Rue C 120', 'Rue D 200']);
    const file = exitsFile(codes, { version: '2026-11-19', builtAt: '2026-11-20T01:30:00.000Z' });
    expect(isExitsFile(file)).toBe(true);
    expect(Object.keys(file.stops)).toEqual(['8101']);
    expect(file.stops['8101']).toEqual({ s: 'Station', x: [['Rue B', 50.85, 4.35, 30], ['Rue A', 50.85, 4.35, 40], ['Rue C', 50.85, 4.35, 120]] });
    expect(file).toMatchObject({ v: 1, version: '2026-11-19', licence: expect.stringContaining('ODbL'), attribution: '© les contributeurs d’OpenStreetMap' });
  });

  it('writeExits : fichier écrit avec l’extrait et les tuiles ; jamais d’exception (tuiles ou extrait absents)', async () => {
    const fx = fixture();
    await buildWalk({ input: fx.pbf, out: fx.tiles, log: () => undefined });
    const out = join(fx.dir, EXITS_FILE);
    const r = await writeExits({ pbf: fx.pbf, tilesDir: fx.tiles, out, version: '2025-11-14', builtAt: '2025-11-14T02:00:00.000Z' });
    expect(r).toMatchObject({ ok: true, stops: 3, message: 'sorties du métro : 3 arrêts STIB sous terre sur 8 avec une sortie' });
    const file = JSON.parse(readFileSync(out, 'utf8')) as ExitsFile;
    expect(isExitsFile(file)).toBe(true);
    expect(Object.keys(file.stops).sort()).toEqual(['8001', '8007', '8011']);
    expect(file.stops['8001'].s).toBe('Bourse');
    expect(file.stops['8001'].x.map((e) => e[0])).toEqual(['Boulevard Anspach']);
    expect(file.stops['8007'].x.map((e) => e[0])).toEqual(['Avenue de la Toison d’Or']);
    expect(existsSync(`${out}.tmp`)).toBe(false);
    expect(await writeExits({ pbf: fx.pbf, tilesDir: join(fx.dir, 'rien'), out: join(fx.dir, 'b.json'), version: 'x', builtAt: 'x' })).toMatchObject({ ok: false });
    expect(await writeExits({ pbf: join(fx.dir, 'rien.pbf'), tilesDir: fx.tiles, out: join(fx.dir, 'c.json'), version: 'x', builtAt: 'x' })).toMatchObject({ ok: false });
    expect(existsSync(join(fx.dir, 'b.json')) || existsSync(join(fx.dir, 'c.json'))).toBe(false);
  });

  it('semaine et publication : sorties faites avec l’extrait de la semaine, publiées en data/exits.json si même version', async () => {
    const fx = fixture();
    const body = readFileSync(fx.pbf);
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('.md5')) return new Response(`${createHash('md5').update(body).digest('hex')}  belgium-latest.osm.pbf\n`, { status: 200 });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const cache = join(fx.dir, 'cache');
    const logs: string[] = [];
    const w = await weeklyWalk({ cacheDir: cache, url: 'https://download.example/belgium-latest.osm.pbf', fetchImpl, now: () => new Date('2026-11-16T01:30:00Z'), log: (m) => logs.push(m), retries: 0, backoffMs: [0] });
    expect(w.state).toBe('built');
    expect(logs).toContain('Chemins à pied : sorties du métro : 3 arrêts STIB sous terre sur 8 avec une sortie');
    // exits.json à côté des tuiles, jamais dedans (l'index compte les tuiles) ; l'extrait n'est plus gardé
    expect(existsSync(join(cache, EXITS_FILE))).toBe(true);
    expect(existsSync(join(cache, 'tiles', EXITS_FILE))).toBe(false);
    expect(existsSync(join(cache, 'extract.osm.pbf'))).toBe(false);
    const data = join(fx.dir, 'site-data');
    mkdirSync(data, { recursive: true });
    const plog: string[] = [];
    const p = await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-16T02:00:00Z'), log: (m) => plog.push(m) });
    expect(p.published).toBe(true);
    expect(plog).toContain(`Chemins à pied : sorties du métro publiées : 3 arrêts STIB sous terre (${EXITS_FILE})`);
    const pub = JSON.parse(readFileSync(join(data, EXITS_FILE), 'utf8')) as ExitsFile;
    expect(isExitsFile(pub)).toBe(true);
    expect(pub.version).toBe(w.index!.version);
    expect(existsSync(join(data, 'walk', EXITS_FILE))).toBe(false);
    // autre version que les tuiles : pas publiées ; absentes ou illisibles : les tuiles sont publiées quand même
    writeFileSync(join(cache, EXITS_FILE), JSON.stringify({ ...pub, version: '2020-01-01' }));
    expect(await publishExits(cache, data, w.index!.version)).toContain('non publiées');
    expect(existsSync(join(data, EXITS_FILE))).toBe(false);
    // d'une autre forme (4 sorties pour un arrêt, autre format) : jamais publiées
    const four = { ...pub, stops: { '8001': { s: 'Bourse', x: [['Rue A', 50.85, 4.35, 1], ['Rue B', 50.85, 4.35, 2], ['Rue C', 50.85, 4.35, 3], ['Rue D', 50.85, 4.35, 4]] } } };
    for (const bad of [four, { ...pub, v: 2 }]) {
      writeFileSync(join(cache, EXITS_FILE), JSON.stringify(bad));
      expect(await publishExits(cache, data, w.index!.version)).toBe('sorties du métro illisibles : non publiées');
      expect(existsSync(join(data, EXITS_FILE))).toBe(false);
    }
    writeFileSync(join(cache, EXITS_FILE), '{ illisible');
    expect((await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-16T02:00:00Z'), log: () => undefined })).published).toBe(true);
    expect(existsSync(join(data, EXITS_FILE))).toBe(false);
  });
});

/**
 * 1.3.1 (finitions du 21/11, contrôle de R1, remarque 4) : les sorties dès la première nuit après la publication.
 * Le cache des nuits a des tuiles de la semaine faites par la 1.3.0 (ni exits.json ni exits-try.json) : la nuit refait
 * tuiles et sorties une fois, puis plus jamais pour les mêmes tuiles, que l'essai ait réussi ou non.
 */
describe('1.3.1 : sorties du métro dès la première nuit (rattrapage, une seule fois)', () => {
  const URL = 'https://download.example/belgium-latest.osm.pbf';

  /** Faux portail : l'extrait des sorties (ou un autre corps), compte des téléchargements, panne à la demande. */
  function portal(fx: { pbf: string }) {
    const st = { downloads: 0, status: 200, body: readFileSync(fx.pbf) as Buffer };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('.md5')) return new Response(`${createHash('md5').update(st.body).digest('hex')}  belgium-latest.osm.pbf\n`, { status: 200 });
      st.downloads++;
      if (st.status !== 200) return new Response('indisponible', { status: st.status });
      return new Response(st.body, { status: 200 });
    }) as typeof fetch;
    return { st, fetchImpl };
  }

  /** Une nuit (01:30 UTC) : résultat et journal. */
  async function night(cache: string, fetchImpl: typeof fetch, date: string, extra: { force?: boolean } = {}) {
    const logs: string[] = [];
    const r = await weeklyWalk({ cacheDir: cache, url: URL, fetchImpl, now: () => new Date(`${date}T01:30:00Z`), log: (m) => logs.push(m), retries: 0, backoffMs: [0], ...extra });
    return { r, logs };
  }

  /** Cache comme la 1.3.0 le laisse : tuiles de la semaine (lundi 16/11), sans sorties ni fiche d'essai. */
  async function cacheOf130(): Promise<{ cache: string; p: ReturnType<typeof portal>; builtAt: string }> {
    const fx = fixture();
    const p = portal(fx);
    const cache = join(fx.dir, 'cache');
    expect((await night(cache, p.fetchImpl, '2026-11-16')).r.state).toBe('built');
    rmSync(join(cache, EXITS_FILE));
    rmSync(join(cache, EXITS_TRY_FILE));
    expect(existsSync(join(cache, 'extract.osm.pbf'))).toBe(false);
    return { cache, p, builtAt: (await readTiles(join(cache, 'tiles')))!.builtAt };
  }

  const tilesOf = (cache: string) => readdirSync(join(cache, 'tiles')).sort().map((f) => readFileSync(join(cache, 'tiles', f), 'utf8'));
  const tried = (cache: string) => JSON.parse(readFileSync(join(cache, EXITS_TRY_FILE), 'utf8')) as ExitsTry;

  it('première nuit : tuiles de la semaine sans sorties → tuiles et sorties refaites, un téléchargement de plus, publiées', async () => {
    const { cache, p, builtAt } = await cacheOf130();
    expect(p.st.downloads).toBe(1);
    const { r, logs } = await night(cache, p.fetchImpl, '2026-11-21');
    expect(r).toMatchObject({ state: 'built', catchUp: true, message: expect.stringContaining('tuiles et sorties du métro refaites (rattrapage, une seule fois)') });
    // l'extrait de la semaine n'était plus dans le cache : téléchargé une fois de plus, cette nuit seulement
    expect(p.st.downloads).toBe(2);
    expect(logs).toContain('Chemins à pied : tuiles de la semaine sans sorties du métro (fichier des sorties absent) : tuiles et sorties refaites une fois, cette nuit seulement');
    expect(logs).toContain('Chemins à pied : sorties du métro : 3 arrêts STIB sous terre sur 8 avec une sortie');
    const idx = (await readTiles(join(cache, 'tiles')))!;
    expect(idx.builtAt).toBe('2026-11-21T01:30:00.000Z');
    expect(idx.builtAt).not.toBe(builtAt);
    const file = JSON.parse(readFileSync(join(cache, EXITS_FILE), 'utf8')) as ExitsFile;
    expect(isExitsFile(file)).toBe(true);
    expect(file.version).toBe(idx.version);
    expect(await exitsGap(cache, idx)).toBeNull();
    expect(tried(cache)).toEqual({ v: 1, format: EXITS_FORMAT, builtAt: idx.builtAt, date: '2026-11-21', ok: true });
    // rien ne traîne dans le cache
    for (const f of ['extract.osm.pbf', 'extract.osm.pbf.part', 'extract.osm.pbf.part.json', 'next', 'tiles.old']) expect(existsSync(join(cache, f))).toBe(false);
    // la publication de la même nuit donne les sorties
    const data = tempDir('quai-exits-data-');
    const plog: string[] = [];
    expect((await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-21T02:00:00Z'), log: (m) => plog.push(m) })).published).toBe(true);
    expect(plog).toContain(`Chemins à pied : sorties du métro publiées : 3 arrêts STIB sous terre (${EXITS_FILE})`);
    expect(isExitsFile(JSON.parse(readFileSync(join(data, EXITS_FILE), 'utf8')))).toBe(true);
    // nuits suivantes de la semaine : plus rien (aucun téléchargement) ; semaine suivante : la construction ordinaire
    const next = await night(cache, p.fetchImpl, '2026-11-22');
    expect(next.r).toMatchObject({ state: 'fresh', message: `tuiles de la semaine déjà prêtes (données OSM du ${idx.version})` });
    expect(next.r.catchUp).toBeUndefined();
    expect(p.st.downloads).toBe(2);
    const monday = await night(cache, p.fetchImpl, '2026-11-23');
    expect(monday.r.state).toBe('built');
    expect(monday.r.catchUp).toBeUndefined();
    expect(monday.r.message).toMatch(/^tuiles construites en /);
    expect(p.st.downloads).toBe(3);
  });

  it('portail en panne pendant le rattrapage : la nuit continue, tuiles intactes, et les nuits suivantes ne recommencent pas', async () => {
    const { cache, p, builtAt } = await cacheOf130();
    const before = tilesOf(cache);
    p.st.status = 503;
    const { r } = await night(cache, p.fetchImpl, '2026-11-18');
    expect(r).toMatchObject({ state: 'failed', catchUp: true });
    expect(r.message).toContain('rattrapage des sorties du métro raté (');
    expect(r.message).toContain('HTTP 503');
    expect(r.message).toContain('tuiles de la semaine gardées');
    expect(p.st.downloads).toBe(2);
    expect(tilesOf(cache)).toEqual(before);
    expect(tried(cache)).toEqual({ v: 1, format: EXITS_FORMAT, builtAt, date: '2026-11-18' });
    for (const f of ['extract.osm.pbf', 'extract.osm.pbf.part', 'extract.osm.pbf.part.json', 'next']) expect(existsSync(join(cache, f))).toBe(false);
    // le portail répond de nouveau : aucune des nuits suivantes de la semaine ne télécharge ni ne refait quoi que ce soit
    p.st.status = 200;
    for (const date of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) {
      const again = await night(cache, p.fetchImpl, date);
      expect(again.r.state).toBe('fresh');
      expect(again.r.message).toContain('sorties du métro déjà essayées pour ces tuiles (fichier des sorties absent)');
    }
    expect(p.st.downloads).toBe(2);
    expect(tilesOf(cache)).toEqual(before);
    // les tuiles de la semaine restent publiées, sans sorties ; puis la semaine suivante fait les deux
    const data = tempDir('quai-exits-data-');
    expect((await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-22T02:00:00Z'), log: () => undefined })).published).toBe(true);
    expect(existsSync(join(data, EXITS_FILE))).toBe(false);
    expect((await night(cache, p.fetchImpl, '2026-11-23')).r.state).toBe('built');
    expect(existsSync(join(cache, EXITS_FILE))).toBe(true);
  });

  it('extrait reçu illisible pendant le rattrapage : tuiles intactes, extrait retiré du cache, jamais rejoué', async () => {
    const { cache, p } = await cacheOf130();
    const before = tilesOf(cache);
    const good = p.st.body;
    p.st.body = Buffer.from('pas un fichier PBF');
    const { r } = await night(cache, p.fetchImpl, '2026-11-18');
    expect(r).toMatchObject({ state: 'failed', catchUp: true });
    expect(tilesOf(cache)).toEqual(before);
    expect(existsSync(join(cache, 'extract.osm.pbf'))).toBe(false);
    expect(existsSync(join(cache, 'next'))).toBe(false);
    p.st.body = good;
    expect((await night(cache, p.fetchImpl, '2026-11-19')).r.state).toBe('fresh');
    expect(p.st.downloads).toBe(2);
    // semaine suivante : construction ordinaire, avec un extrait neuf
    expect((await night(cache, p.fetchImpl, '2026-11-23')).r).toMatchObject({ state: 'built' });
    expect(p.st.downloads).toBe(3);
  });

  it('sorties déjà essayées pour ces tuiles (réussies puis abîmées, ou ratées) : jamais refaites la même semaine', async () => {
    const fx = fixture();
    const p = portal(fx);
    const cache = join(fx.dir, 'cache');
    await night(cache, p.fetchImpl, '2026-11-16');
    const idx = (await readTiles(join(cache, 'tiles')))!;
    expect(tried(cache)).toEqual({ v: 1, format: EXITS_FORMAT, builtAt: idx.builtAt, date: '2026-11-16', ok: true });
    const good = readFileSync(join(cache, EXITS_FILE), 'utf8');
    const cases: [string | null, string][] = [
      [null, 'fichier des sorties absent'],
      ['{ illisible', 'fichier des sorties absent'],
      [JSON.stringify({ ...JSON.parse(good), v: 2 }), 'fichier des sorties d’une autre forme'],
      [JSON.stringify({ ...JSON.parse(good), version: '2020-01-01' }), `sorties du 2020-01-01, tuiles du ${idx.version}`],
    ];
    for (const [body, why] of cases) {
      if (body === null) rmSync(join(cache, EXITS_FILE));
      else writeFileSync(join(cache, EXITS_FILE), body);
      expect(await exitsGap(cache, idx)).toBe(why);
      const again = await night(cache, p.fetchImpl, '2026-11-17');
      expect(again.r.state).toBe('fresh');
      expect(again.r.message).toContain(`sorties du métro déjà essayées pour ces tuiles (${why})`);
    }
    expect(p.st.downloads).toBe(1);
    expect((await readTiles(join(cache, 'tiles')))!.builtAt).toBe(idx.builtAt);
  });

  it('fiche d’essai d’autres tuiles, d’une autre forme de fichier ou illisible : le rattrapage a lieu, une fois', async () => {
    for (const marker of [
      JSON.stringify({ v: 1, format: EXITS_FORMAT, builtAt: '2026-11-09T01:30:00.000Z', date: '2026-11-09', ok: true }),
      (builtAt: string) => JSON.stringify({ v: 1, format: EXITS_FORMAT - 1, builtAt, date: '2026-11-16' }),
      '{ illisible',
    ]) {
      const { cache, p, builtAt } = await cacheOf130();
      writeFileSync(join(cache, EXITS_TRY_FILE), typeof marker === 'string' ? marker : marker(builtAt));
      // sorties d'une forme que cette version ne lit pas (comme après un changement de forme)
      writeFileSync(join(cache, EXITS_FILE), JSON.stringify({ v: 0, stops: {} }));
      const first = await night(cache, p.fetchImpl, '2026-11-17');
      expect(first.r).toMatchObject({ state: 'built', catchUp: true });
      expect(first.logs.join('\n')).toContain('(fichier des sorties d’une autre forme)');
      expect(isExitsFile(JSON.parse(readFileSync(join(cache, EXITS_FILE), 'utf8')))).toBe(true);
      expect((await night(cache, p.fetchImpl, '2026-11-18')).r.state).toBe('fresh');
      expect(p.st.downloads).toBe(2);
    }
  });

  it('la forme notée dans la fiche est celle que isExitsFile accepte (à augmenter ensemble)', () => {
    const file = { v: EXITS_FORMAT, version: '2026-11-16', stops: {} };
    expect(isExitsFile(file)).toBe(true);
    expect(isExitsFile({ ...file, v: EXITS_FORMAT + 1 })).toBe(false);
  });

  it('semaine nouvelle, vérification forcée : comme avant, sans rattrapage (la fiche est quand même tenue à jour)', async () => {
    const { cache, p } = await cacheOf130();
    // lundi suivant : la construction ordinaire de la semaine, pas un rattrapage
    const monday = await night(cache, p.fetchImpl, '2026-11-23');
    expect(monday.r.state).toBe('built');
    expect(monday.r.catchUp).toBeUndefined();
    expect(monday.logs.join('\n')).not.toContain('refaites une fois');
    expect(tried(cache)).toMatchObject({ builtAt: '2026-11-23T01:30:00.000Z', ok: true });
    // vérification d'une branche : toujours refait, jamais compté comme un rattrapage
    const forced = await night(cache, p.fetchImpl, '2026-11-24', { force: true });
    expect(forced.r.state).toBe('built');
    expect(forced.r.catchUp).toBeUndefined();
    expect(tried(cache)).toMatchObject({ builtAt: '2026-11-24T01:30:00.000Z', ok: true });
    expect((await night(cache, p.fetchImpl, '2026-11-25')).r.state).toBe('fresh');
  });
});
