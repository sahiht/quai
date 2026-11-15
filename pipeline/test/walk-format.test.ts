/** 1.2.10 : format des tuiles piétonnes (app/src/core/walk/format.ts, commun au pipeline et au téléphone). */
import { describe, expect, it } from 'vitest';
import {
  baseKeyOf, boxOf, decodeTile, encodeTile, F_COMP, F_RING, F_STEPS, isTileKey, isWalkIndex, isWalkTile, leafKeyOf,
  leafKeysForBox, quarter, TileFormatError, VarReader, VarWriter, type ChainIn,
} from '../../app/src/core/walk/format.ts';

describe('nombres codés', () => {
  it('aller-retour exact, entiers positifs et signés jusqu’à 2^53', () => {
    const vals = [0, 1, 44, 45, 46, 2069, 2070, 95219, 95220, 1e6, 2 ** 31, 2 ** 32 + 7, 2 * 13_000_000_000, 2 ** 50 + 3];
    const w = new VarWriter();
    for (const v of vals) w.uint(v);
    w.uint(Number.MAX_SAFE_INTEGER);
    for (const v of vals) w.sint(-v);
    for (const v of vals) w.sint(v);
    const r = new VarReader(w.toString());
    for (const v of vals) expect(r.uint()).toBe(v);
    expect(r.uint()).toBe(Number.MAX_SAFE_INTEGER);
    for (const v of vals) expect(r.sint()).toBe(-v === 0 ? 0 : -v);
    for (const v of vals) expect(r.sint()).toBe(v);
    expect(r.done).toBe(true);
  });

  it('longueur : 1 caractère sous 45, 2 sous 2070, 3 sous 95220', () => {
    const len = (v: number) => {
      const w = new VarWriter();
      w.uint(v);
      return w.toString().length;
    };
    expect([0, 44, 45, 2069, 2070, 95219, 95220].map(len)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('caractères sûrs en JSON (ni guillemet, ni barre oblique inverse, ni contrôle) et longs flux', () => {
    const w = new VarWriter();
    for (let v = 0; v < 50_000; v++) w.sint(v % 2 ? -v * 37 : v * 101);
    const s = w.toString();
    expect(s).not.toMatch(/["\\\u0000-\u001f\u007f-￿]/);
    expect(JSON.parse(JSON.stringify(s))).toBe(s);
    expect(JSON.stringify(s).length).toBe(s.length + 2);
  });

  it('flux abîmé : erreur lisible', () => {
    expect(() => new VarReader('').uint()).toThrow(TileFormatError);
    expect(() => new VarReader('#').uint()).toThrow('fin inattendue');
    expect(() => new VarReader('é').uint()).toThrow('caractère inattendu');
    expect(() => new VarReader('"').uint()).toThrow('caractère inattendu');
    expect(() => new VarWriter().uint(-1)).toThrow(RangeError);
    expect(() => new VarWriter().uint(1.5)).toThrow(RangeError);
  });
});

describe('clés et cadres des tuiles', () => {
  it('clé de base en entiers (pas d’erreur d’arrondi au bord)', () => {
    expect(baseKeyOf(5084000, 436500)).toBe('2542_145');
    expect(baseKeyOf(5083999, 434999)).toBe('2541_144');
    expect(boxOf('2541_145')).toEqual({ lat0: 5082000, lat1: 5084000, lon0: 435000, lon1: 438000 });
    expect(boxOf('2541_145_3')).toEqual({ lat0: 5083000, lat1: 5084000, lon0: 436500, lon1: 438000 });
    expect(boxOf('2541_145_30')).toEqual({ lat0: 5083000, lat1: 5083500, lon0: 436500, lon1: 437250 });
    expect(boxOf('2541_145_301')).toEqual({ lat0: 5083000, lat1: 5083250, lon0: 436875, lon1: 437250 });
    expect(boxOf('x')).toBeNull();
    expect(boxOf('2541_145_4')).toBeNull();
    expect(boxOf('2541_145_0123')).toBeNull();
    expect(isTileKey('2541_145')).toBe(true);
    expect(isTileKey('../meta')).toBe(false);
    expect(quarter({ lat0: 0, lat1: 8, lon0: 0, lon1: 4 }, 2)).toEqual({ lat0: 4, lat1: 8, lon0: 0, lon1: 2 });
  });

  it('feuilles d’un cadre et feuille d’un point, avec des tuiles coupées', () => {
    const split = new Set(['2541_145', '2541_145_2']);
    expect(leafKeyOf(5082100, 435100, split)).toBe('2541_145_0');
    expect(leafKeyOf(5083900, 435100, split)).toBe('2541_145_22');
    expect(leafKeyOf(5083900, 436000, split)).toBe('2541_145_23');
    expect(leafKeyOf(5083900, 438100, split)).toBe('2541_146');
    const keys = leafKeysForBox({ lat0: 5083600, lat1: 5084100, lon0: 435500, lon1: 438100 }, split);
    expect(keys).toEqual(['2541_145_22', '2541_145_23', '2541_145_3', '2541_146', '2542_145', '2542_146']);
    expect(leafKeysForBox({ lat0: 0, lat1: 1_000_000, lon0: 0, lon1: 1_000_000 }, split)).toEqual([]);
  });

  it('index et tuile : validation', () => {
    const idx = { v: 1, version: '2026-11-09', builtAt: 'x', source: 's', licence: 'l', attribution: 'a', tile: { lat: 0.02, lon: 0.03 }, unit: 1e-5, split: [], tiles: 0, bytes: 0, maxTileBytes: 0 };
    expect(isWalkIndex(idx)).toBe(true);
    expect(isWalkIndex({ ...idx, tile: { lat: 0.01, lon: 0.03 } })).toBe(false);
    expect(isWalkIndex({ ...idx, v: 2 })).toBe(false);
    expect(isWalkTile({ v: 1, k: '1_2', ver: 'v', names: [], w: '', s: '' })).toBe(true);
    expect(isWalkTile({ v: 1, k: '1_2', ver: 'v', names: [3], w: '', s: '' })).toBe(false);
  });
});

describe('tuile : écriture et lecture', () => {
  const coords = new Map<number, [number, number]>([
    [10, [5082100, 435100]], [11, [5082200, 435100]], [12, [5082200, 435300]], [13, [5082300, 435100]], [14, [5084000, 435200]],
  ]);
  const chains: ChainIn[] = [
    { name: 0, flags: 0, comp: 0, nodes: [10, 11, 13], pts: [[5082150, 435105], []] },
    { name: 1, flags: F_STEPS | F_RING, comp: 0, nodes: [11, 12], pts: [[5082210, 435150, 5082205, 435250]] },
    { name: -1, flags: 0, comp: 7, nodes: [13, 14], pts: [[]] },
    { name: 0, flags: 0, comp: 0, nodes: [12, 12], pts: [[5082250, 435300, 5082250, 435350]] },
  ];
  const file = encodeTile('2541_145', '2026-11-09', ['Rue de la Loi', 'Escalier du Mont'], chains, (id) => coords.get(id) as [number, number], (id) => (id === 14 ? 2 * 123_456_789_012 : undefined));

  it('nœuds écrits une fois, renvoyés ensuite ; tronçons, points, attributs, composantes, nœuds partagés', () => {
    const d = decodeTile(file);
    expect(d.key).toBe('2541_145');
    expect(d.ver).toBe('2026-11-09');
    expect([...d.nodeLat]).toEqual([5082100, 5082200, 5082300, 5082200, 5084000]);
    expect([...d.nodeLon]).toEqual([435100, 435100, 435100, 435300, 435200]);
    expect([...d.edgeFrom]).toEqual([0, 1, 1, 2, 3]);
    expect([...d.edgeTo]).toEqual([1, 2, 3, 4, 3]);
    expect([...d.edgeName]).toEqual([0, 0, 1, -1, 0]);
    expect([...d.edgeFlags]).toEqual([0, 0, F_STEPS | F_RING, 0, 0]);
    expect([...d.edgeComp]).toEqual([0, 0, 0, 7, 0]);
    expect([...d.geoStart]).toEqual([0, 1, 1, 3, 3, 5]);
    expect([...d.ptLat]).toEqual([5082150, 5082210, 5082205, 5082250, 5082250]);
    expect([...d.ptLon]).toEqual([435105, 435150, 435250, 435300, 435350]);
    expect([...d.sharedLocal]).toEqual([4]);
    expect([...d.sharedGlobal]).toEqual([246_913_578_024]);
    expect(d.edgeFlags.every((f) => !(f & F_COMP))).toBe(true);
  });

  it('tuile abîmée : TileFormatError, jamais un graphe faux', () => {
    expect(() => decodeTile({ ...file, w: file.w.slice(0, -3) })).toThrow(TileFormatError);
    expect(() => decodeTile({ ...file, w: `${file.w}Q` })).toThrow('données en trop');
    expect(() => decodeTile({ ...file, names: ['seul'] })).toThrow('nom inconnu');
    expect(() => decodeTile({ ...file, k: 'abc' })).toThrow('clé invalide');
    const s = new VarWriter();
    s.uint(1);
    s.uint(99);
    s.uint(1);
    expect(() => decodeTile({ ...file, s: s.toString() })).toThrow('nœud partagé invalide');
  });

  it('chaîne invalide refusée à l’écriture', () => {
    expect(() => encodeTile('2541_145', 'v', [], [{ name: -1, flags: 0, comp: 0, nodes: [10], pts: [] }], (id) => coords.get(id) as [number, number], () => undefined)).toThrow('chaîne invalide');
    expect(() => encodeTile('nope', 'v', [], [], () => [0, 0], () => undefined)).toThrow('clé de tuile invalide');
  });
});
