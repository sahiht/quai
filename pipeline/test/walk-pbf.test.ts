/**
 * 1.2.10 : lecteur OSM PBF (pipeline/src/walk/pbf.ts). Extraits réels : comptes attendus relevés avec pyosmium
 * (libosmium), outil indépendant. Fichiers fabriqués : identifiants au-delà de 2^32, deltas négatifs, granularité et
 * décalages, blocs bruts ou zlib, plusieurs blocs, fichier non trié, nœuds non denses.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyBlock, firstBlockWithoutNodes, HAS_NODES, HAS_WAYS, PbfError, PbfFile } from '../src/walk/pbf.ts';
import { pbfSource } from '../src/walk/source.ts';
import { loadWalkData } from '../src/walk/load.ts';
import { cleanupTempDirs, tempDir } from './helpers.ts';
import { WALK_DATA, writePbf, type PbfNode, type PbfWay } from './walk-helpers.ts';

afterAll(cleanupTempDirs);

function stats(path: string) {
  const src = pbfSource(path);
  let nodes = 0;
  let sumLat = 0;
  let sumLon = 0;
  let first: number[] | null = null;
  let maxId = 0;
  src.nodes((ids, lat, lon, n) => {
    for (let i = 0; i < n; i++) {
      nodes++;
      sumLat += lat[i];
      sumLon += lon[i];
      first ??= [ids[i], lat[i], lon[i]];
      maxId = Math.max(maxId, ids[i]);
    }
  });
  let ways = 0;
  let hw = 0;
  let refs = 0;
  let named = 0;
  src.ways(() => true, (_id, t, _r, n) => {
    ways++;
    if (t.has('highway') || t.get('railway') === 'platform' || t.get('public_transport') === 'platform') {
      hw++;
      refs += n;
      if (t.has('name')) named++;
    }
  });
  src.close();
  return { nodes, ways, hw, refs, named, sumLat, sumLon, first: first as unknown as number[], maxId };
}

describe('extraits réels (comptes de pyosmium)', () => {
  it('centre d’Helsinki : 24 260 nœuds, 5 130 voies dont 2 701 de marche possibles, identifiants au-delà de 2^32', () => {
    const s = stats(join(WALK_DATA, 'pyrosm-helsinki.osm.pbf'));
    expect([s.nodes, s.ways, s.hw, s.refs, s.named]).toEqual([24260, 5130, 2701, 12485, 844]);
    expect(s.sumLat).toBeCloseTo(1459744.82, 2);
    expect(s.sumLon).toBeCloseTo(605147.9099, 3);
    expect(s.first[0]).toBe(25291537);
    expect(s.first[1]).toBeCloseTo(60.1643249, 7);
    expect(s.first[2]).toBeCloseTo(24.9370245, 7);
    expect(s.maxId).toBe(6394671610);
  });

  it('environs de Kotka : 14 222 nœuds, 2 653 voies', () => {
    const s = stats(join(WALK_DATA, 'pyrosm-test.osm.pbf'));
    expect([s.nodes, s.ways, s.hw, s.refs, s.named]).toEqual([14222, 2653, 343, 2478, 129]);
    expect(s.sumLat).toBeCloseTo(860854.7538, 3);
    expect(s.sumLon).toBeCloseTo(383315.3499, 3);
    expect(s.first).toEqual([246991, expect.closeTo(60.5319394, 7), expect.closeTo(26.9609156, 7)]);
    expect(s.maxId).toBe(6270887036);
  });

  it('extraits non déclarés triés : tous les blocs lus aux deux passages (pas de dichotomie)', () => {
    const f = new PbfFile(join(WALK_DATA, 'pyrosm-helsinki.osm.pbf'));
    try {
      expect(f.header.sorted).toBe(false);
      expect(firstBlockWithoutNodes(f)).toBeNull();
      expect(f.blobs).toHaveLength(4);
    } finally {
      f.close();
    }
  });
});

describe('fichiers fabriqués', () => {
  const dir = tempDir('quai-pbf-');
  // identifiants au-delà de 2^32 et dans le désordre géographique (deltas négatifs)
  const big = 2 ** 33;
  const nodes: PbfNode[] = [
    { id: big + 1, lat: 50.8454321, lon: 4.3571234 },
    { id: big + 5, lat: 50.8401234, lon: 4.3612345 },
    { id: big + 9, lat: 50.8467891, lon: 4.3523456 },
    { id: big + 12, lat: -33.8688, lon: -151.2093 },
  ];
  const ways: PbfWay[] = [
    { id: 70, refs: [big + 9, big + 1, big + 5], tags: { highway: 'footway', name: 'Galerie de la Reine' } },
    { id: 71, refs: [big + 5, big + 12], tags: { building: 'yes' } },
    { id: 72, refs: [big + 1, big + 5], tags: { highway: 'steps', 'name:fr': 'Escalier', name: 'Escalier - Trap' } },
  ];
  const write = (name: string, buf: Buffer) => {
    const p = join(dir, name);
    writeFileSync(p, buf);
    return p;
  };

  for (const variant of [
    { name: 'zlib, un bloc', o: {} },
    { name: 'blocs bruts', o: { raw: true } },
    { name: 'un élément par bloc', o: { perBlock: 1 } },
    { name: 'granularité 1000 et décalages', o: { granularity: 1000, latOffset: 123_000_000, lonOffset: -45_000 } },
    { name: 'non trié', o: { sorted: false, perBlock: 2 } },
    { name: 'nœuds non denses', o: { plainNodes: true } },
  ]) {
    it(`${variant.name} : coordonnées au 1e-7 près, voies gardées, noms`, () => {
      const p = write(`${variant.name.replace(/\W+/g, '_')}.osm.pbf`, writePbf(nodes, ways, { timestamp: 1_762_646_400, ...variant.o }));
      const d = loadWalkData(pbfSource(p));
      expect(d.timestamp).toBe(1_762_646_400);
      expect([...d.wayId]).toEqual([70, 72]);
      expect(d.names.slice(1)).toEqual(['Galerie de la Reine', 'Escalier']);
      expect([...d.nodeId]).toEqual([big + 1, big + 5, big + 9]);
      const tol = (variant.o as { granularity?: number }).granularity ? 1e-6 : 1e-7;
      for (const n of nodes.slice(0, 3)) {
        const j = [...d.nodeId].indexOf(n.id);
        expect(Math.abs(d.nodeLat[j] - n.lat)).toBeLessThan(tol);
        expect(Math.abs(d.nodeLon[j] - n.lon)).toBeLessThan(tol);
      }
      expect(d.missingNodes).toBe(0);
    });
  }

  it('fichier trié (comme les extraits Geofabrik) : frontière nœuds / voies trouvée par dichotomie', () => {
    const many: PbfNode[] = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i, lat: 50.84 + i * 1e-4, lon: 4.35 }));
    const w: PbfWay[] = Array.from({ length: 20 }, (_, i) => ({ id: 900 + i, refs: [100 + i, 101 + i], tags: { highway: 'footway' } }));
    const f = new PbfFile(write('trie.osm.pbf', writePbf(many, w, { perBlock: 3 })));
    try {
      expect(f.header.sorted).toBe(true);
      const k = firstBlockWithoutNodes(f) as number;
      expect(k).toBe(17);
      expect(classifyBlock(f.block(k - 1)) & HAS_NODES).toBe(HAS_NODES);
      expect(classifyBlock(f.block(k))).toBe(HAS_WAYS);
    } finally {
      f.close();
    }
    const d = loadWalkData(pbfSource(join(dir, 'trie.osm.pbf')));
    expect(d.wayCount).toBe(20);
    expect(d.missingNodes).toBe(0);
    expect(d.nodeId.length).toBe(21);
  });

  it('fichier tronqué, autre format ou compression inconnue : erreur PbfError', () => {
    const good = writePbf(nodes, ways);
    expect(() => new PbfFile(write('tronque.osm.pbf', good.subarray(0, good.length - 10)))).toThrow(PbfError);
    expect(() => new PbfFile(write('texte.osm.pbf', Buffer.from('<osm version="0.6"></osm>')))).toThrow(PbfError);
    expect(() => new PbfFile(write('vide.osm.pbf', Buffer.alloc(0)))).toThrow('en-tête OSM absent');
  });
});
