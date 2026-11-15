/**
 * 1.2.10 : construction complète des tuiles piétonnes (pipeline/src/walk/build.ts) : écriture (index en dernier),
 * index (version, date, source, licence, taille), budget (limite autour des arrêts publiés, puis simplification),
 * extraits réels. Les tuiles des extraits réels servent aussi aux tests du téléphone (app/test/core/walk-data/) :
 * ce test vérifie qu'elles sont à jour (QUAI_WALK_FIXTURES=1 les réécrit).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isWalkIndex, isWalkTile } from '../../app/src/core/walk/format.ts';
import { buildWalk, dataVersion, NEAR_STOPS_M } from '../src/walk/build.ts';
import { ATTRIBUTION, LICENCE, SOURCE } from '../src/walk/tiles.ts';
import { cleanupTempDirs, tempDir } from './helpers.ts';
import { APP_WALK_DATA, ll, osmXml, readBuilt, tileLength, WALK_DATA, writeXml, type XmlWay } from './walk-helpers.ts';

afterAll(cleanupTempDirs);

const quiet = () => undefined;

describe('construction et index', () => {
  it('tuiles puis index.json ; version = date des données de l’extrait ; licence ODbL et attribution', async () => {
    const dir = tempDir('quai-walk-');
    const input = writeXml(dir, 'mini.osm', osmXml({ 1: ll(0, 0), 2: ll(0, 300), 3: ll(200, 300) }, [
      { id: 1, nodes: [1, 2], tags: { highway: 'pedestrian', name: 'Rue Neuve' } },
      { id: 2, nodes: [2, 3], tags: { highway: 'steps' } },
    ], '2026-11-08T21:14:02Z'));
    const out = join(dir, 'walk');
    const r = await buildWalk({ input, out, log: quiet, now: () => new Date('2026-11-10T01:30:00Z') });
    const b = readBuilt(out);
    expect(isWalkIndex(b.index)).toBe(true);
    expect(b.index).toMatchObject({
      v: 1, version: '2026-11-08', builtAt: '2026-11-10T01:30:00.000Z', source: SOURCE, licence: LICENCE, attribution: ATTRIBUTION,
      tile: { lat: 0.02, lon: 0.03 }, unit: 1e-5, split: [], tiles: 1,
    });
    expect(b.index.attribution).toBe('© les contributeurs d’OpenStreetMap');
    expect(b.index.licence).toMatch(/^ODbL 1\.0/);
    const tileFile = readdirSync(out).find((f) => f !== 'index.json') as string;
    expect(b.index.bytes).toBe(statSync(join(out, tileFile)).size);
    expect(b.index.maxTileBytes).toBe(b.index.bytes);
    expect(statSync(join(out, 'index.json')).mtimeMs).toBeGreaterThanOrEqual(statSync(join(out, tileFile)).mtimeMs);
    const t = [...b.tiles.values()][0];
    expect(t.ver).toBe('2026-11-08');
    expect(t.names).toEqual(['Rue Neuve']);
    expect(r.built.stats.tiles).toBe(1);
  });

  it('date des données absente : date du jour ; extrait sans voie à pied : erreur', async () => {
    expect(dataVersion(undefined, new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-15');
    expect(dataVersion(1_762_646_400, new Date('2026-11-15T03:00:00Z'))).toBe('2025-11-09');
    const dir = tempDir('quai-walk-');
    const input = writeXml(dir, 'vide.osm', osmXml({ 1: ll(0, 0), 2: ll(0, 300) }, [{ id: 1, nodes: [1, 2], tags: { highway: 'motorway' } }]));
    await expect(buildWalk({ input, out: join(dir, 'walk'), log: quiet })).rejects.toThrow('aucune voie piétonne');
  });
});

describe('budget', () => {
  // deux quartiers à 6 km l'un de l'autre ; un seul arrêt publié, près du premier
  const nodes: Record<number, [number, number]> = {};
  const ways: XmlWay[] = [];
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 10; i++) {
      nodes[1 + k * 100 + i * 2] = ll(k * 6000 + i * 50, 0);
      nodes[2 + k * 100 + i * 2] = ll(k * 6000 + i * 50, 400);
      ways.push({ id: 1 + k * 100 + i, nodes: [1 + k * 100 + i * 2, 2 + k * 100 + i * 2], tags: { highway: 'footway' } });
    }
    ways.push({ id: 50 + k * 100, nodes: Array.from({ length: 10 }, (_, i) => 1 + k * 100 + i * 2), tags: { highway: 'residential' } });
  }

  it('au-delà du budget : voies limitées à 2 km des arrêts publiés, puis simplification ; tout est journalisé', async () => {
    const dir = tempDir('quai-walk-');
    const input = writeXml(dir, 'deux.osm', osmXml(nodes, ways));
    const stops = join(dir, 'data');
    mkdirSync(join(stops, 'tiles'), { recursive: true });
    const [lat, lon] = ll(200, 200);
    writeFileSync(join(stops, 'tiles', '2542_145.json'), JSON.stringify({ v: 1, areas: [{ id: 'stib:1', op: 'stib', n: { fr: 'Gare Centrale', nl: 'Centraal Station' }, lat, lon, modes: ['metro'], lines: ['1'] }] }));
    const full = await buildWalk({ input, out: join(dir, 'a'), log: quiet });
    const logs: string[] = [];
    const r = await buildWalk({ input, out: join(dir, 'b'), stopsDir: stops, budgetBytes: full.built.stats.bytes - 1, log: (m) => logs.push(m) });
    expect(r.built.index.nearStopsM).toBe(NEAR_STOPS_M);
    expect(r.built.stats.bytes).toBeLessThan(full.built.stats.bytes * 0.6);
    expect(logs.some((m) => m.includes('voies limitées à 2000 m des 1 arrêts publiés'))).toBe(true);
    const tiny = await buildWalk({ input, out: join(dir, 'c'), stopsDir: stops, budgetBytes: 10, log: (m) => logs.push(m) });
    expect(tiny.built.index.nearStopsM).toBe(NEAR_STOPS_M);
    expect(logs.some((m) => m.includes('simplification à 4 m'))).toBe(true);
    expect(logs.some((m) => m.includes('au-delà du budget de'))).toBe(true);
  });
});

describe('extraits réels (paquet pyrosm)', () => {
  const FIXED = { version: '2026-11-01', builtAt: '2026-11-01T02:00:00.000Z' };
  const sets = [
    { name: 'helsinki', input: 'pyrosm-helsinki.osm.pbf', tiles: 1, km: [110, 120] },
    { name: 'kotka', input: 'pyrosm-test.osm.pbf', tiles: 2, km: [55, 62] },
  ];
  for (const s of sets) {
    it(`${s.name} : longueur gardée, tuiles sous 300 ko, données de test du téléphone à jour`, async () => {
      const out = tempDir('quai-walk-real-');
      const r = await buildWalk({ input: join(WALK_DATA, s.input), out, log: quiet, ...FIXED });
      expect(r.built.stats.tiles).toBe(s.tiles);
      expect(r.built.stats.maxTile.bytes).toBeLessThan(300_000);
      const b = readBuilt(out);
      const km = [...b.tiles.values()].reduce((x, t) => x + tileLength(t), 0) / 1000;
      expect(km).toBeGreaterThan(s.km[0]);
      expect(km).toBeLessThan(s.km[1]);
      for (const f of b.files.values()) expect(isWalkTile(f)).toBe(true);
      const fixture = join(APP_WALK_DATA, s.name);
      const files = readdirSync(out).sort();
      if (process.env.QUAI_WALK_FIXTURES === '1') {
        mkdirSync(fixture, { recursive: true });
        for (const f of files) writeFileSync(join(fixture, f), readFileSync(join(out, f)));
      }
      expect(readdirSync(fixture).sort()).toEqual(files);
      for (const f of files) expect(readFileSync(join(fixture, f), 'utf8'), `${s.name}/${f} : relancer avec QUAI_WALK_FIXTURES=1`).toBe(readFileSync(join(out, f), 'utf8'));
    });
  }
});
