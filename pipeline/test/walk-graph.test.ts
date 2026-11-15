/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : voies gardées, attributs, carrefours, tronçons, composantes, simplification, coupe des
 * tuiles et raccord par les nœuds partagés, tuiles trop lourdes coupées en 4. Extraits OSM XML écrits à la main.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { boxOf, decodeTile, F_BWD, F_FWD, F_RING, F_STEPS, F_UNDER, type DecodedTile, type WalkTileFile } from '../../app/src/core/walk/format.ts';
import { footOneway, tagsOf, underground, walkable, wayFlags, wayName } from '../src/walk/filter.ts';
import { buildGraph } from '../src/walk/graph.ts';
import { loadWalkData } from '../src/walk/load.ts';
import { xmlSource } from '../src/walk/source.ts';
import { buildTiles, simplify, type TileBuildOptions } from '../src/walk/tiles.ts';
import { cleanupTempDirs } from './helpers.ts';
import { CENTRAL, EDGE_LAT, ll, osmXml, tileLength, type XmlWay } from './walk-helpers.ts';

afterAll(cleanupTempDirs);

const OPTS: TileBuildOptions = { version: '2026-11-09', builtAt: '2026-11-10T01:30:00.000Z' };

function build(nodes: Record<number, [number, number]>, ways: XmlWay[], o: Partial<TileBuildOptions> = {}) {
  const data = loadWalkData(xmlSource(osmXml(nodes, ways)));
  const graph = buildGraph(data);
  const built = buildTiles(graph, { ...OPTS, ...o });
  const files = new Map<string, WalkTileFile>(built.files.map((f) => [f.key, JSON.parse(f.json) as WalkTileFile]));
  const tiles = new Map<string, DecodedTile>([...files].map(([k, f]) => [k, decodeTile(f)]));
  return { data, graph, built, files, tiles };
}

const degreesOf = (t: DecodedTile) => {
  const deg = new Map<number, number>();
  for (let e = 0; e < t.edgeFrom.length; e++) {
    deg.set(t.edgeFrom[e], (deg.get(t.edgeFrom[e]) ?? 0) + 1);
    deg.set(t.edgeTo[e], (deg.get(t.edgeTo[e]) ?? 0) + 1);
  }
  return deg;
};

describe('voies gardées (PRD § 3.8)', () => {
  const kept: Record<string, string>[] = [
    ...['footway', 'pedestrian', 'path', 'steps', 'living_street', 'residential', 'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'track', 'cycleway', 'corridor', 'platform'].map((h) => ({ highway: h })),
    { railway: 'platform' },
    { public_transport: 'platform' },
    { highway: 'trunk', sidewalk: 'both' },
    { highway: 'trunk_link', 'sidewalk:right': 'yes' },
    { highway: 'trunk', foot: 'yes' },
    { highway: 'footway', access: 'private', foot: 'yes' },
    { highway: 'service', access: 'no', foot: 'designated' },
    { highway: 'track', access: 'agricultural' },
    { highway: 'steps', conveying: 'forward' },
    { highway: 'footway', tunnel: 'yes', layer: '-1' },
    { highway: 'primary', motorroad: 'yes', foot: 'yes' },
  ];
  const dropped: Record<string, string>[] = [
    { highway: 'motorway' },
    { highway: 'motorway_link', foot: 'yes' },
    { highway: 'trunk' },
    { highway: 'trunk', sidewalk: 'separate' },
    { highway: 'footway', foot: 'no' },
    { highway: 'cycleway', foot: 'no' },
    { highway: 'secondary', foot: 'use_sidepath' },
    { highway: 'service', access: 'private' },
    { highway: 'track', access: 'no' },
    { highway: 'steps', conveying: 'reversible' },
    { highway: 'primary', motorroad: 'yes' },
    { highway: 'secondary', tunnel: 'yes', motorroad: 'yes' },
    { highway: 'construction' },
    { highway: 'bridleway' },
    { highway: 'proposed' },
    { building: 'yes' },
    { railway: 'rail' },
  ];
  for (const t of kept) it(`gardée : ${JSON.stringify(t)}`, () => expect(walkable(tagsOf(t))).toBe(true));
  for (const t of dropped) it(`exclue : ${JSON.stringify(t)}`, () => expect(walkable(tagsOf(t))).toBe(false));

  it('attributs : marches, sens unique à pied, escalier mécanique, anneau', () => {
    expect(wayFlags(tagsOf({ highway: 'steps' }))).toBe(F_STEPS);
    expect(footOneway(tagsOf({ highway: 'footway', 'oneway:foot': 'yes' }))).toBe(F_FWD);
    expect(footOneway(tagsOf({ highway: 'footway', 'oneway:foot': '-1' }))).toBe(F_BWD);
    expect(footOneway(tagsOf({ highway: 'steps', conveying: 'backward' }))).toBe(F_BWD);
    expect(footOneway(tagsOf({ highway: 'path', 'foot:backward': 'no' }))).toBe(F_FWD);
    expect(footOneway(tagsOf({ highway: 'path', 'foot:forward': 'no' }))).toBe(F_BWD);
    // sens unique des voitures : sans effet pour un piéton
    expect(footOneway(tagsOf({ highway: 'residential', oneway: 'yes' }))).toBe(0);
    expect(wayFlags(tagsOf({ highway: 'steps', conveying: 'forward' }))).toBe(F_STEPS | F_FWD);
    expect(wayFlags(tagsOf({ highway: 'primary', junction: 'roundabout', oneway: 'yes' }))).toBe(F_RING);
    expect(wayFlags(tagsOf({ highway: 'steps', tunnel: 'yes' }))).toBe(F_STEPS | F_UNDER);
  });

  it('sous terre ou à l’intérieur : tunnel, couloir, niveau ou couche négatifs ; pas un passage sous un bâtiment', () => {
    const under: Record<string, string>[] = [{ tunnel: 'yes' }, { highway: 'corridor' }, { indoor: 'yes' }, { layer: '-1' }, { level: '-1;0' }, { level: '-0.5' }];
    const surface: Record<string, string>[] = [{ tunnel: 'building_passage' }, { tunnel: 'no' }, { layer: '1' }, { level: '0' }, { bridge: 'yes' }, {}];
    for (const t of under) expect(underground(tagsOf({ highway: 'footway', ...t }))).toBe(true);
    for (const t of surface) expect(underground(tagsOf({ highway: 'footway', ...t }))).toBe(false);
  });

  it('noms : français d’abord, moitié française d’un nom bilingue bruxellois', () => {
    expect(wayName(tagsOf({ name: 'Rue de la Loi - Wetstraat', 'name:fr': 'Rue de la Loi', 'name:nl': 'Wetstraat' }))).toBe('Rue de la Loi');
    expect(wayName(tagsOf({ name: 'Rue Neuve - Nieuwstraat', 'name:nl': 'Nieuwstraat' }))).toBe('Rue Neuve');
    expect(wayName(tagsOf({ name: 'Kerkstraat' }))).toBe('Kerkstraat');
    expect(wayName(tagsOf({ name: '  Place   Flagey ' }))).toBe('Place Flagey');
    expect(wayName(tagsOf({ highway: 'footway' }))).toBe('');
  });
});

describe('carrefours et tronçons', () => {
  // T : voie 1 (S, a, J, b, N) et voie 2 (J, c, E) ; a, b, c : points de forme
  const nodes: Record<number, [number, number]> = {
    1: ll(0, -100), 2: ll(1, -50), 3: ll(0, 0), 4: ll(-1, 50), 5: ll(0, 100), 6: ll(50, 1), 7: ll(100, 0),
  };
  const T: XmlWay[] = [
    { id: 10, nodes: [1, 2, 3, 4, 5], tags: { highway: 'residential', name: 'Rue Royale' } },
    { id: 11, nodes: [3, 6, 7], tags: { highway: 'footway' } },
  ];

  it('nœuds aux carrefours et aux bouts seulement ; 3 tronçons ; longueur', () => {
    const { graph, data } = build(nodes, T);
    const junctions = [...data.nodeId].filter((_, j) => graph.junction[j]);
    expect(junctions).toEqual([1, 3, 5, 7]);
    expect(graph.edgeCount).toBe(3);
    const ends = Array.from({ length: 3 }, (_, e) => [data.nodeId[data.refs[graph.edgeA[e]]], data.nodeId[data.refs[graph.edgeB[e]]]]);
    expect(ends).toEqual([[1, 3], [3, 5], [3, 7]]);
    for (let e = 0; e < 3; e++) expect(graph.edgeLen[e]).toBeGreaterThan(99.9);
    for (let e = 0; e < 3; e++) expect(graph.edgeLen[e]).toBeLessThan(100.2);
  });

  it('dans la tuile : carrefour de degré 3, noms, points de forme gardés au-delà de 2 m d’écart seulement', () => {
    const { tiles } = build(nodes, T);
    expect(tiles.size).toBe(1);
    const t = [...tiles.values()][0];
    expect(t.nodeLat.length).toBe(4);
    expect([...degreesOf(t).values()].sort()).toEqual([1, 1, 1, 3]);
    expect(t.names).toEqual(['Rue Royale']);
    // a et b s'écartent d'1 m de la droite : simplifiés ; c aussi
    expect(t.ptLat.length).toBe(0);
    expect(tileLength(t)).toBeGreaterThan(299);
    expect(tileLength(t)).toBeLessThan(301);
  });

  it('voie fermée accrochée par un seul nœud : une boucle ; nœud manquant : voie coupée, voisins devenus bouts', () => {
    const n: Record<number, [number, number]> = { 1: ll(0, 0), 2: ll(30, 30), 3: ll(0, 60), 4: ll(-30, 30), 5: ll(0, -100), 7: ll(100, -100), 8: ll(200, -100) };
    const ways: XmlWay[] = [
      { id: 20, nodes: [1, 2, 3, 4, 1], tags: { highway: 'footway' } },
      { id: 21, nodes: [5, 1], tags: { highway: 'footway' } },
      // 6 absent de l'extrait, 7 répété aussitôt
      { id: 22, nodes: [5, 6, 7, 7, 8], tags: { highway: 'path' } },
    ];
    const { graph, data } = build(n, ways);
    const ends = Array.from({ length: graph.edgeCount }, (_, e) => [data.nodeId[data.refs[graph.edgeA[e]]], data.nodeId[data.refs[graph.edgeB[e]]]]);
    expect(ends).toEqual([[1, 1], [5, 1], [7, 8]]);
    expect(data.missingNodes).toBe(1);
  });
});

describe('composantes connexes', () => {
  it('grand réseau (0), autre réseau de plus de 200 m (1), petit bout isolé retiré', () => {
    const nodes: Record<number, [number, number]> = {
      1: ll(0, 0), 2: ll(0, 500), 3: ll(300, 0), 4: ll(300, 250), 5: ll(-200, 0), 6: ll(-200, 50),
    };
    const ways: XmlWay[] = [
      { id: 1, nodes: [1, 2], tags: { highway: 'residential' } },
      { id: 2, nodes: [3, 4], tags: { highway: 'path' } },
      { id: 3, nodes: [5, 6], tags: { railway: 'platform' } },
    ];
    const { graph, tiles } = build(nodes, ways);
    expect([...graph.edgeComp]).toEqual([0, 1, -1]);
    expect(graph.stats.droppedEdges).toBe(1);
    const t = [...tiles.values()][0];
    expect([...t.edgeComp].sort()).toEqual([0, 1]);
  });
});

describe('simplification (Douglas-Peucker, 2 m)', () => {
  it('écarts sous 2 m retirés, coude de 5 m gardé, bouts toujours gardés', () => {
    const cos = Math.cos((50.84 * Math.PI) / 180);
    const m = 1 / 1.11195; // unités par mètre (latitude)
    // ligne est-ouest de 100 m (lon), écarts en latitude
    const line = (devs: number[]) => devs.flatMap((d, i) => [d * m, (i * 10 * m) / cos]);
    expect(simplify(line([0, 0.5, -0.8, 1.2, 0.3, 0, 0.9, -1.5, 0.2, 0, 0]), 2, cos)).toEqual([0, 10]);
    // pointe de 5 m : la pointe et ses deux voisins (à 4 m des cordes qui y mènent)
    expect(simplify(line([0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0]), 2, cos)).toEqual([0, 4, 5, 6, 10]);
    // coude doux : un seul point
    expect(simplify(line([0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0]), 2, cos)).toEqual([0, 5, 10]);
    expect(simplify([1, 2, 3, 4], 2, cos)).toEqual([0, 1]);
  });
});

describe('coupe des tuiles et raccord', () => {
  // voie nord-sud de 400 m qui traverse le bord des tuiles 2541 et 2542 (latitude 50,84)
  const edge = { lat: EDGE_LAT, lon: CENTRAL.lon };
  const cross = { 1: ll(0, -200, edge), 2: ll(3, 100, edge), 3: ll(0, 200, edge) } as Record<number, [number, number]>;

  it('un point de coupe par bord franchi, partagé par les deux tuiles (même identifiant, mêmes coordonnées)', () => {
    const { tiles, built } = build(cross, [{ id: 300, nodes: [1, 2, 3], tags: { highway: 'footway', name: 'Mont des Arts' } }]);
    expect([...tiles.keys()].sort()).toEqual(['2541_145', '2542_145']);
    const [s, n] = ['2541_145', '2542_145'].map((k) => tiles.get(k) as DecodedTile);
    expect(s.sharedGlobal.length).toBe(1);
    expect(n.sharedGlobal.length).toBe(1);
    expect(s.sharedGlobal[0]).toBe(n.sharedGlobal[0]);
    expect(s.sharedGlobal[0] % 2).toBe(1);
    // identifiant stable : (voie × 4096 + segment) × 16 + coupe ; le bord est franchi sur le premier segment
    expect((s.sharedGlobal[0] - 1) / 2).toBe((300 * 4096 + 0) * 16 + 0);
    const si = s.sharedLocal[0];
    const ni = n.sharedLocal[0];
    expect([s.nodeLat[si], s.nodeLon[si]]).toEqual([n.nodeLat[ni], n.nodeLon[ni]]);
    expect(s.nodeLat[si]).toBe(5084000);
    expect(tileLength(s) + tileLength(n)).toBeGreaterThan(399);
    expect(tileLength(s) + tileLength(n)).toBeLessThan(401);
    expect(s.names).toEqual(['Mont des Arts']);
    expect(n.names).toEqual(['Mont des Arts']);
    expect(built.index.tiles).toBe(2);
  });

  it('carrefour posé exactement sur le bord : partagé sous son identifiant OSM (2 × id)', () => {
    const n: Record<number, [number, number]> = { 1: ll(0, -150, edge), 2: [EDGE_LAT, CENTRAL.lon], 3: ll(0, 150, edge), 4: ll(150, 0, edge) };
    const { tiles } = build(n, [
      { id: 1, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { id: 2, nodes: [2, 4], tags: { highway: 'residential' } },
    ]);
    const all = [...tiles.values()];
    expect(all.length).toBe(2);
    for (const t of all) expect([...t.sharedGlobal]).toContain(4);
  });

  it('identifiants de coupe indépendants des autres voies (raccord entre deux semaines)', () => {
    const a = build(cross, [{ id: 300, nodes: [1, 2, 3], tags: { highway: 'footway' } }]);
    const more = { ...cross, 9: ll(500, -50, edge), 10: ll(500, 50, edge) } as Record<number, [number, number]>;
    const b = build(more, [{ id: 300, nodes: [1, 2, 3], tags: { highway: 'footway' } }, { id: 5, nodes: [9, 10], tags: { highway: 'path' } }]);
    const ids = (r: typeof a) => [...r.tiles.values()].flatMap((t) => [...t.sharedGlobal]).sort();
    expect(ids(b)).toEqual(expect.arrayContaining(ids(a)));
  });

  it('segment de plus de 30 km (erreur de dessin) : ce tronçon seul est écarté', () => {
    const n = { ...cross, 7: ll(2000, -20_000, edge), 8: ll(2000, 20_000, edge) } as Record<number, [number, number]>;
    const logs: string[] = [];
    const { tiles } = build(n, [{ id: 300, nodes: [1, 2, 3], tags: { highway: 'footway' } }, { id: 301, nodes: [7, 8], tags: { highway: 'track' } }], { log: (m) => logs.push(m) });
    expect([...tiles.keys()].sort()).toEqual(['2541_145', '2542_145']);
    expect(logs.some((m) => m.includes('voie 301 écartée'))).toBe(true);
  });

  it('même extrait, mêmes tuiles octet pour octet', () => {
    const w: XmlWay[] = [{ id: 300, nodes: [1, 2, 3], tags: { highway: 'footway' } }];
    expect(build(cross, w).built.files).toEqual(build(cross, w).built.files);
  });
});

describe('tuile trop lourde : coupée en 4', () => {
  // quadrillage dense de 41 × 41 nœuds tous les 40 m autour de Bruxelles-Central
  const nodes: Record<number, [number, number]> = {};
  const ways: XmlWay[] = [];
  const N = 41;
  const id = (i: number, j: number) => 1 + i * N + j;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) nodes[id(i, j)] = ll((j - 20) * 40, (i - 20) * 40);
  for (let i = 0; i < N; i++) ways.push({ id: 1000 + i, nodes: Array.from({ length: N }, (_, j) => id(i, j)), tags: { highway: 'residential', name: `Rue ${i}` } });
  for (let j = 0; j < N; j++) ways.push({ id: 2000 + j, nodes: Array.from({ length: N }, (_, i) => id(i, j)), tags: { highway: 'footway' } });

  it('au-delà du plafond : tuiles de quart, index des tuiles coupées, rien de perdu, raccords complets', () => {
    const whole = build(nodes, ways);
    const small = build(nodes, ways, { maxTileBytes: 4000 });
    expect(whole.built.index.split).toEqual([]);
    expect(small.built.index.split.length).toBeGreaterThan(0);
    expect(small.built.stats.overLimit).toEqual([]);
    expect(small.built.files.every((f) => f.bytes <= 4000)).toBe(true);
    for (const k of small.built.index.split) expect(small.tiles.has(k)).toBe(false);
    // chaque morceau est dans le cadre de sa tuile
    for (const [k, t] of small.tiles) {
      const b = boxOf(k)!;
      for (let i = 0; i < t.nodeLat.length; i++) {
        expect(t.nodeLat[i]).toBeGreaterThanOrEqual(b.lat0 - 1);
        expect(t.nodeLat[i]).toBeLessThanOrEqual(b.lat1 + 1);
        expect(t.nodeLon[i]).toBeGreaterThanOrEqual(b.lon0 - 1);
        expect(t.nodeLon[i]).toBeLessThanOrEqual(b.lon1 + 1);
      }
    }
    const len = (r: typeof whole) => [...r.tiles.values()].reduce((s, t) => s + tileLength(t), 0);
    expect(len(small)).toBeCloseTo(len(whole), -1);
    // chaque identifiant partagé l'est par au moins deux tuiles, aux mêmes coordonnées
    const seen = new Map<number, string[]>();
    for (const t of small.tiles.values()) {
      t.sharedGlobal.forEach((g, i) => {
        const c = `${t.nodeLat[t.sharedLocal[i]]},${t.nodeLon[t.sharedLocal[i]]}`;
        seen.set(g, [...(seen.get(g) ?? []), c]);
      });
    }
    for (const [, cs] of seen) {
      expect(cs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(cs).size).toBe(1);
    }
  });
});
