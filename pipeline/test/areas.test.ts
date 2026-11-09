import { describe, expect, it } from 'vitest';
import { areaFileKey, distanceM, groupAreas, nameKey } from '../src/areas.ts';
import type { StopRec } from '../src/areas.ts';
import type { Op } from '../../shared/types.ts';

const S = (id: string, name: string, lat: number, lon: number, extra: Partial<StopRec> = {}): StopRec => ({
  id, name, lat, lon, loc: 0, parent: '', pcode: '', ...extra,
});

function group(op: Op, stops: StopRec[], used?: number[]) {
  const u = used ? Uint8Array.from(stops.map((_, i) => (used.includes(i) ? 1 : 0))) : undefined;
  const { areas, stopArea } = groupAreas(op, stops, u);
  const byKey = Object.fromEntries(areas.map((a) => [a.key, { ...a, ids: a.members.map((i) => stops[i].id) }]));
  return { areas, stopArea, byKey };
}

describe('regroupement par parent_station', () => {
  it('SNCB : clé sans le « S », arrêt « gare » sans quai compris, position du parent', () => {
    const stops = [
      S('S8812005', 'Brussel-Noord/Bruxelles-Nord', 50.8605, 4.3612, { loc: 1 }),
      S('8812005', 'Brussel-Noord/Bruxelles-Nord', 50.8605, 4.3612, { parent: 'S8812005' }),
      S('8812005_9', 'Brussel-Noord/Bruxelles-Nord', 50.8606, 4.3613, { parent: 'S8812005', pcode: '9' }),
      S('8812005_12', 'Brussel-Noord/Bruxelles-Nord', 50.8607, 4.3614, { parent: 'S8812005', pcode: '12' }),
    ];
    const { areas, byKey } = group('sncb', stops);
    expect(areas).toHaveLength(1);
    expect(byKey['8812005'].ids).toEqual(['8812005', '8812005_12', '8812005_9']);
    expect(byKey['8812005'].lat).toBe(50.8605);
    expect(stops[byKey['8812005'].nameStop].id).toBe('S8812005');
  });

  it('autres opérateurs : clé = parent_station tel quel ; parent absent du fichier = moyenne des arrêts', () => {
    const stops = [
      S('a1', 'X', 50.0, 4.0, { parent: 'P1' }),
      S('a2', 'X', 50.002, 4.002, { parent: 'P1' }),
    ];
    const { byKey } = group('tec', stops);
    expect(Object.keys(byKey)).toEqual(['P1']);
    expect(byKey.P1.lat).toBeCloseTo(50.001, 6);
    expect(byKey.P1.lon).toBeCloseTo(4.001, 6);
  });

  it('zone d’embarquement (location_type 4) desservie : rattachée à la gare via son quai', () => {
    const stops = [
      S('ST', 'Gare', 50.0, 4.0, { loc: 1 }),
      S('Q1', 'Gare', 50.0, 4.0, { parent: 'ST' }),
      S('B1', 'Gare', 50.0, 4.0, { loc: 4, parent: 'Q1' }),
      S('E1', 'Gare', 50.0, 4.0, { loc: 2, parent: 'ST' }),
    ];
    const { byKey } = group('tec', stops, [2]);
    expect(byKey.ST.ids).toEqual(['B1', 'Q1']);
  });

  it('gare (location_type 1) desservie directement : traitée comme un arrêt', () => {
    const stops = [S('S8863008', 'Namur', 50.4685, 4.8625, { loc: 1 })];
    const { byKey } = group('sncb', stops, [0]);
    expect(byKey['8863008'].ids).toEqual(['S8863008']);
  });
});

describe('regroupement par nom à moins de 300 m', () => {
  it('même nom (sans casse ni accents, suffixe de quai retiré) et proches : une zone, clé = plus petit stop_id', () => {
    const stops = [
      S('N508agb', 'Namur Gare quai B', 50.46806, 4.86362),
      S('N508aga', 'NAMUR GARE quai A', 50.468, 4.8635),
      S('N509aaa', 'Namur Place Léopold', 50.466, 4.861),
      S('N509aab', 'Namur Place Leopold', 50.4661, 4.8611),
    ];
    const { areas, byKey } = group('tec', stops);
    expect(areas).toHaveLength(2);
    expect(byKey.N508aga.ids).toEqual(['N508aga', 'N508agb']);
    expect(byKey.N509aaa.ids).toEqual(['N509aaa', 'N509aab']);
    expect(byKey.N508aga.lat).toBeCloseTo(50.46803, 6);
  });

  it('comparaison de chaînes pour le plus petit identifiant (6357F < 6358, 10 < 9)', () => {
    const { byKey } = group('stib', [
      S('6358', 'GARE DU NORD', 50.86008, 4.3602),
      S('6357F', 'GARE DU NORD', 50.86, 4.36014),
    ]);
    expect(Object.keys(byKey)).toEqual(['6357F']);
    const { byKey: k2 } = group('stib', [S('9', 'X', 50, 4), S('10', 'X', 50.0001, 4)]);
    expect(Object.keys(k2)).toEqual(['10']);
  });

  it('même nom à plus de 300 m : deux zones', () => {
    const a = S('100', 'Station', 50.8, 4.3);
    const b = S('200', 'Station', 50.8, 4.3 + 0.0045); // ~316 m
    expect(distanceM(a.lat, a.lon, b.lat, b.lon)).toBeGreaterThan(300);
    const { areas } = group('delijn', [a, b]);
    expect(areas.map((x) => x.key).sort()).toEqual(['100', '200']);
  });

  it('noms différents proches : zones séparées ; De Lijn « perron N »', () => {
    const { byKey } = group('delijn', [
      S('308611', 'Brussel Noordstation perron 4', 50.8618, 4.359),
      S('308613', 'Brussel Noordstation perron 6', 50.86186, 4.35912),
      S('300450', 'Meise Centrum', 50.8619, 4.3592),
    ]);
    expect(byKey['308611'].ids).toEqual(['308611', '308613']);
    expect(byKey['300450'].ids).toEqual(['300450']);
  });

  it('grande gare routière (plus de 200 arrêts, grille) : quais proches de proche en proche regroupés, lointain séparé', () => {
    const stops: StopRec[] = [];
    for (let i = 0; i < 250; i++) stops.push(S(`c${String(i).padStart(3, '0')}`, 'Kerk', 50 + i * 0.002, 4)); // 222 m d'écart
    stops.push(S('far', 'Kerk', 52, 5));
    const { areas } = group('delijn', stops);
    expect(areas).toHaveLength(2);
  });

  it('arrêts sans position et sans parent : ignorés', () => {
    const { areas, stopArea } = group('tec', [S('x', 'Nulle part', NaN, 4), S('y', 'Zéro', 0, 0)]);
    expect(areas).toHaveLength(0);
    expect([...stopArea]).toEqual([-1, -1]);
  });

  it('clé de nom normalisée', () => {
    expect(nameKey('Namur Gare quai A')).toBe(nameKey('NAMUR GARE'));
    expect(nameKey('Bouge Église')).toBe('bouge eglise');
  });
});

describe('nom de fichier de zone', () => {
  it('remplace tout caractère hors [A-Za-z0-9_-] par _', () => {
    expect(areaFileKey('8812005')).toBe('8812005');
    expect(areaFileKey('6357F')).toBe('6357F');
    expect(areaFileKey('N508aga')).toBe('N508aga');
    expect(areaFileKey('a:b/c d.é')).toBe('a_b_c_d__');
  });
});
