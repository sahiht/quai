/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : mesure de la sortie du métro (pipeline/src/walk/exits.ts, commande « exits »), sur un
 * petit extrait fabriqué autour de Bruxelles-Central (lieu public) : une station avec quai, couloir et escalier jusqu'à
 * une rue nommée (E), un quai sous terre isolé (C), un quai seulement en surface (B), un arrêt sans voie (A), une
 * sortie vers un sentier sans nom (D), un escalator qui ne monte pas (C, sens unique respecté), un arrêt de bus en
 * surface (compté, pas mesuré).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildWalk } from '../src/walk/build.ts';
import { main } from '../src/walk/cli.ts';
import { byCode, exitReport, featureOf, isUnderStop, loadExitGraph, measureFeature, readStibFeatures, type StibFeature } from '../src/walk/exits.ts';
import { readKeyedNodes, PbfFile } from '../src/walk/pbf.ts';
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
};

const ways: PbfWay[] = [
  { id: 1001, refs: [1, 14, 3], tags: { highway: 'residential', name: 'Boulevard Anspach' } },
  { id: 1002, refs: [3, 4], tags: { highway: 'residential', name: 'Rue Neuve' } },
  { id: 2001, refs: [10, 11, 12], tags: { railway: 'platform', public_transport: 'platform', layer: '-1', name: 'Bourse', 'ref:STIB_MIVB': '8001;8011' } },
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
  return { dir, pbf, data, tiles: join(dir, 'tiles') };
}

describe('1.3.1 : sorties du métro (mesure de vérification R1)', () => {
  it('lit les nœuds porteurs de ref:STIB_MIVB et leurs étiquettes (nœuds denses ou simples, trié ou non, plusieurs blocs)', () => {
    for (const o of [{}, { plainNodes: true }, { sorted: false, perBlock: 4 }, { plainNodes: true, perBlock: 3 }]) {
      const fx = fixture(o);
      const { features, timestamp } = readStibFeatures(fx.pbf);
      expect(timestamp).toBe(1_763_078_400);
      const byOsm = new Map(features.map((f) => [f.osm, f]));
      expect([...byOsm.keys()].sort()).toEqual(['n15', 'n33', 'n42', 'n50', 'n64', 'n75', 'n80', 'w2001']);
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
      expect(features.filter(isUnderStop).map((f) => f.osm).sort()).toEqual(['n15', 'n33', 'n42', 'n50', 'n64', 'n75', 'w2001']);
    }
  });

  it('un bloc sans la clé ne décode aucune étiquette ; les nœuds demandés donnent leurs coordonnées', () => {
    const fx = fixture({ perBlock: 4 });
    const f = new PbfFile(fx.pbf);
    try {
      const keyed: number[] = [];
      const wanted: number[] = [];
      for (let i = 0; i < f.blobs.length; i++) readKeyedNodes(f.block(i), 'ref:STIB_MIVB', (id) => keyed.push(id), (id) => id === 11 || id === 63, (id) => wanted.push(id));
      expect(keyed.sort((a, b) => a - b)).toEqual([15, 33, 42, 50, 64, 75, 80]);
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
    const codes = byCode([...res.values()]);
    expect(codes.map((c) => `${c.code}:${c.cls}`)).toEqual(['8001:E', '8002:C', '8003:B', '8004:A', '8005:D', '8006:C', '8011:E']);
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
    expect(r.rate).toBeCloseTo(2 / 7, 6);
    expect(text).toContain('Sorties du métro : 7 numéros STIB sous terre');
    expect(text).toContain('sortie nommée par les couloirs pour 2 sur 7 (28,6 %) ; seuil de 80 % NON atteint');
    expect(text).toContain('A pas de voie piétonne à 30 m 1 ; B quai seulement en surface 1 ; C couloirs sans sortie à 600 m 2 ; D sortie sans nom 1 ; E sortie nommée 2');
    expect(text).toContain('exemples : Bourse → Boulevard Anspach');
    expect(text).toContain('sans couloir jusqu’à la rue : Isolé (8002, C), Surface (8003, B), Loin (8004, A), Escalator (8006, C)');
    expect(text).toContain('sortie sans nom : Sans nom (8005, D)');
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
    const notes = log.filter((l) => l.startsWith('::notice title=Sorties du métro (R1)::'));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('(28,6 %25) ; seuil de 80 %25 NON atteint');
    // erreurs d'usage et tuiles absentes
    expect(await main(['exits', '--tiles', fx.tiles], {}, () => undefined)).toBe(2);
    expect(await main(['exits', '--tiles', join(fx.dir, 'rien'), '--input', fx.pbf], {}, () => undefined)).toBe(1);
  });
});
