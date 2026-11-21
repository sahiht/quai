/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : chemin à pied sur des graphes construits à la main, codés au vrai format des tuiles :
 * carrefour en T, angles et seuils, rond-point, escaliers, impasses, deux tuiles, départ hors voie, virages proches,
 * demi-tour, 20 derniers mètres, sens unique (escalier mécanique), réseaux séparés, aucun chemin, même tronçon.
 */
import { describe, expect, it } from 'vitest';
import type { Maneuver, WalkRoute } from '../../src/core/guide-types';
import { F_FWD, F_RING, F_STEPS, F_UNDER } from '../../src/core/walk/format';
import { cleanManeuvers, turnOf } from '../../src/core/walk/route';
import { WalkRouter } from '../../src/core/walk/router';
import { at, memorySource, metres, tileOf, toward, type GraphDef } from './walk-helpers';

const route = async (def: GraphDef | GraphDef[], from: [number, number], to: [number, number]): Promise<WalkRoute> => {
  const tiles = (Array.isArray(def) ? def : [def]).map((d) => tileOf(d));
  const r = await new WalkRouter(memorySource(tiles), { now: () => 1000 }).route(at(...from), at(...to));
  if (!r) throw new Error('aucun résultat');
  return r;
};
const turns = (r: WalkRoute) => r.maneuvers.map((m) => m.turn);
/** Aucun virage à moins de 15 m d'un autre, ni dans les 20 derniers mètres ; rangs et distances cohérents. */
function checkInvariants(r: WalkRoute): void {
  for (let i = 1; i < r.maneuvers.length; i++) expect(r.maneuvers[i].distM - r.maneuvers[i - 1].distM).toBeGreaterThanOrEqual(15);
  let along = 0;
  const cum = [0];
  for (let i = 1; i < r.coords.length; i++) cum.push((along += metres(r.coords[i - 1], r.coords[i])));
  expect(r.lengthM).toBeCloseTo(along, 0);
  for (const m of r.maneuvers) {
    expect(m.distM).toBeLessThanOrEqual(r.lengthM - 20);
    expect(m.at).toBeGreaterThan(0);
    expect(m.at).toBeLessThan(r.coords.length - 1);
    expect(m.distM).toBeCloseTo(cum[m.at], 0);
  }
}

describe('carrefour en T', () => {
  const T: GraphDef = {
    nodes: { S: [0, -200], J: [0, 0], W: [-150, 0], E: [150, 0] },
    ways: [
      { nodes: ['S', 'J'], name: 'Rue du Sud' },
      { nodes: ['W', 'J'], name: 'Rue de l’Ouest' },
      { nodes: ['J', 'E'], name: 'Rue de l’Est' },
    ],
  };

  it('à gauche au carrefour, nom de la rue prise, longueur et points du chemin', async () => {
    const r = await route(T, [0, -180], [-130, 0]);
    expect(r.source).toBe('osm');
    expect(r.lengthM).toBeGreaterThan(306);
    expect(r.lengthM).toBeLessThan(314);
    expect(r.maneuvers).toHaveLength(1);
    expect(r.maneuvers[0]).toMatchObject({ turn: 'left', street: 'Rue de l’Ouest' });
    expect(r.maneuvers[0].distM).toBeGreaterThan(177);
    expect(r.maneuvers[0].distM).toBeLessThan(183);
    expect(metres(r.coords[r.maneuvers[0].at], at(0, 0))).toBeLessThan(1.5);
    expect(r.coords[0]).toEqual(r.from);
    expect(metres(r.coords[r.coords.length - 1], r.to)).toBeLessThan(1.5);
    expect(r.builtAt).toBe(1000);
    checkInvariants(r);
  });

  it('dans l’autre sens : à droite, puis la rue du Sud', async () => {
    const r = await route(T, [-130, 0], [0, -180]);
    expect(r.maneuvers).toEqual([expect.objectContaining({ turn: 'right', street: 'Rue du Sud' })]);
  });

  it('tout droit à travers le carrefour : aucun virage', async () => {
    const r = await route(T, [-130, 0], [130, 0]);
    expect(r.source).toBe('osm');
    expect(r.maneuvers).toEqual([]);
  });
});

describe('angles et seuils (30°, 60°, 135°, 170°)', () => {
  const cases: [number, string | null][] = [
    [20, null], [-25, null], [45, 'slightRight'], [-50, 'slightLeft'], [90, 'right'], [-100, 'left'],
    [150, 'sharpRight'], [-160, 'sharpLeft'], [176, 'uturn'], [-177, 'uturn'],
  ];
  for (const [bearing, expected] of cases) {
    it(`branche à ${bearing}° : ${expected ?? 'aucun virage'}`, async () => {
      const def: GraphDef = {
        nodes: { S: [0, -150], J: [0, 0], N: [0, 150], B: toward(0, 0, bearing, 120) },
        ways: [{ nodes: ['S', 'J', 'N'], name: 'Avenue' }, { nodes: ['J', 'B'], name: 'Branche' }],
      };
      const r = await route(def, [0, -140], toward(0, 0, bearing, 100));
      expect(r.source).toBe('osm');
      expect(r.lengthM).toBeGreaterThan(236);
      expect(r.lengthM).toBeLessThan(244);
      expect(turns(r)).toEqual(expected ? [expected] : []);
      if (expected) expect(r.maneuvers[0].street).toBe('Branche');
      checkInvariants(r);
    });
  }

  it('turnOf : bornes des seuils', () => {
    expect(turnOf(29.9)).toBeNull();
    expect(turnOf(-29.9)).toBeNull();
    expect(turnOf(30)).toBe('slightRight');
    expect(turnOf(-59.9)).toBe('slightLeft');
    expect(turnOf(60)).toBe('right');
    expect(turnOf(-134.9)).toBe('left');
    expect(turnOf(135)).toBe('sharpRight');
    expect(turnOf(-170)).toBe('sharpLeft');
    expect(turnOf(170.1)).toBe('uturn');
    expect(turnOf(180)).toBe('uturn');
  });

  it('un coude sans carrefour (2 voies) n’est jamais un virage', async () => {
    const def: GraphDef = {
      nodes: { A: [0, -150], K: [0, 0], B: [150, 0] },
      ways: [{ nodes: ['A', 'K'], name: 'Rue A' }, { nodes: ['K', 'B'], name: 'Rue B' }],
    };
    const r = await route(def, [0, -140], [140, 0]);
    expect(r.source).toBe('osm');
    expect(r.maneuvers).toEqual([]);
  });
});

describe('rond-point', () => {
  const ring = (deg: number): [number, number] => toward(0, 0, deg, 15);
  const R: GraphDef = {
    nodes: {
      RS: ring(180), p1: ring(135), RE: ring(90), p2: ring(45), RN: ring(0), p3: ring(315), RW: ring(270), p4: ring(225),
      AS: [0, -200], AE: [200, 0], AN: [0, 200], AW: [-200, 0],
    },
    ways: [
      { nodes: ['RS', 'p1', 'RE', 'p2', 'RN', 'p3', 'RW', 'p4', 'RS'], name: 'Rond-point Flagey', flags: F_RING },
      { nodes: ['AS', 'RS'], name: 'Rue Sud' },
      { nodes: ['RE', 'AE'], name: 'Rue Est' },
      { nodes: ['RN', 'AN'], name: 'Rue Nord' },
      { nodes: ['AW', 'RW'], name: 'Rue Ouest' },
    ],
  };

  it('sortie en face : aucun virage (ni à l’entrée, ni le long de l’anneau)', async () => {
    const r = await route(R, [0, -180], [0, 180]);
    expect(r.source).toBe('osm');
    expect(r.maneuvers).toEqual([]);
  });

  it('sortie à droite : « à droite » à la sortie, rue Est', async () => {
    const r = await route(R, [0, -180], [180, 0]);
    expect(r.maneuvers).toEqual([expect.objectContaining({ turn: 'right', street: 'Rue Est' })]);
    expect(metres(r.coords[r.maneuvers[0].at], at(15, 0))).toBeLessThan(1.5);
    checkInvariants(r);
  });

  it('sortie à gauche : « à gauche », rue Ouest', async () => {
    const r = await route(R, [0, -180], [-180, 0]);
    expect(r.maneuvers).toEqual([expect.objectContaining({ turn: 'left', street: 'Rue Ouest' })]);
  });
});

describe('escaliers', () => {
  const stairs = (rampX: number): GraphDef => ({
    nodes: { S: [0, -100], A: [0, 0], B: [0, 60], N: [0, 160], R1: [rampX, 10], R2: [rampX, 50] },
    ways: [
      { nodes: ['S', 'A'], name: 'Rue Basse' },
      { nodes: ['A', 'B'], flags: F_STEPS },
      { nodes: ['A', 'R1', 'R2', 'B'], name: 'Rampe' },
      { nodes: ['B', 'N'], name: 'Rue Haute' },
    ],
  });

  it('une rampe un peu plus longue est préférée à l’escalier (marches comptées 1,5 fois)', async () => {
    const r = await route(stairs(20), [0, -50], [0, 110]);
    expect(r.lengthM).toBeGreaterThan(181);
    expect(r.lengthM).toBeLessThan(189);
    expect(r.coords.some((c) => metres(c, at(20, 10)) < 1.5)).toBe(true);
  });

  it('une rampe bien plus longue : l’escalier', async () => {
    const r = await route(stairs(35), [0, -50], [0, 110]);
    expect(r.lengthM).toBeGreaterThan(157);
    expect(r.lengthM).toBeLessThan(163);
    expect(r.coords.some((c) => metres(c, at(35, 10)) < 5)).toBe(false);
  });
});

describe('impasses et derniers mètres', () => {
  const D: GraphDef = {
    nodes: { M1: [-300, 0], J1: [-100, 0], J2: [150, 0], M2: [300, 0], D1: [-100, -120], D2: [150, 120] },
    ways: [
      { nodes: ['M1', 'J1', 'J2', 'M2'], name: 'Rue Principale' },
      { nodes: ['J1', 'D1'], name: 'Impasse A' },
      { nodes: ['J2', 'D2'], name: 'Impasse B' },
    ],
  };

  it('d’une impasse à l’autre : à droite rue Principale, puis à gauche impasse B', async () => {
    const r = await route(D, [-100, -100], [150, 110]);
    expect(r.lengthM).toBeGreaterThan(455);
    expect(r.lengthM).toBeLessThan(465);
    expect(r.maneuvers.map((m) => [m.turn, m.street])).toEqual([['right', 'Rue Principale'], ['left', 'Impasse B']]);
    checkInvariants(r);
  });

  it('virage à 12 m de l’arrivée : pas annoncé (20 derniers mètres)', async () => {
    const r = await route(D, [-100, -100], [150, 12]);
    expect(r.maneuvers.map((m) => m.turn)).toEqual(['right']);
  });

  it('cleanManeuvers : retire ce qui tombe dans les 20 derniers mètres avant de fusionner', () => {
    const m = (distM: number, turn: Maneuver['turn']): Maneuver => ({ at: 1, distM, turn });
    expect(cleanManeuvers([m(70, 'left'), m(82, 'sharpRight')], 100)).toEqual([m(70, 'left')]);
    expect(cleanManeuvers([m(10, 'slightLeft'), m(20, 'left'), m(30, 'sharpLeft'), m(50, 'right')], 200)).toEqual([m(30, 'sharpLeft'), m(50, 'right')]);
    expect(cleanManeuvers([m(10, 'right'), m(24, 'left'), m(39, 'left')], 200)).toEqual([m(10, 'right'), m(39, 'left')]);
  });
});

describe('deux tuiles', () => {
  // bord nord de la tuile 2541_145 : latitude 50,84 exactement ; nœud partagé posé dessus
  const X = { lat: 50.84, lon: 4.365 };
  const south: GraphDef = { nodes: { S: [0, 900], X }, ways: [{ nodes: ['S', 'X'], name: 'Chaussée' }], shared: { X: 4_000_001 } };
  const north: GraphDef = {
    nodes: { X, T: [0, 1250], N: [0, 1400], E: [150, 1250] },
    ways: [{ nodes: ['X', 'T', 'N'], name: 'Chaussée' }, { nodes: ['T', 'E'], name: 'Rue du Nord-Est' }],
    shared: { X: 4_000_001 },
  };

  it('le chemin passe d’une tuile à l’autre par le nœud partagé', async () => {
    const tiles = [tileOf(south, { key: '2541_145' }), tileOf(north)];
    expect(tiles.map((t) => t.k)).toEqual(['2541_145', '2542_145']);
    const src = memorySource(tiles);
    const r = await new WalkRouter(src, { now: () => 0 }).route(at(0, 950), at(130, 1250));
    expect(r?.source).toBe('osm');
    expect(r!.lengthM).toBeGreaterThan(426);
    expect(r!.lengthM).toBeLessThan(434);
    expect(r!.maneuvers).toEqual([expect.objectContaining({ turn: 'right', street: 'Rue du Nord-Est' })]);
    expect(src.calls.sort()).toEqual(['test|2541_145', 'test|2542_145']);
  });

  it('tuile voisine vide (404) : l’arrivée n’a pas de voie à 100 m, chemin droit', async () => {
    const src = memorySource([tileOf(south, { key: '2541_145' })]);
    const r = await new WalkRouter(src, { now: () => 0 }).route(at(0, 950), at(130, 1250));
    expect(r?.source).toBe('straight');
    expect(r?.maneuvers).toEqual([]);
    expect(r?.coords).toEqual([at(0, 950), at(130, 1250)]);
  });
});

describe('départ et arrivée hors des voies', () => {
  const road: GraphDef = { nodes: { S: [0, -200], N: [0, 200] }, ways: [{ nodes: ['S', 'N'], name: 'Rue' }] };

  it('à 60 m de la voie : raccord droit jusqu’à la voie, compté dans la longueur, aucun virage', async () => {
    const r = await route(road, [60, 0], [0, 150]);
    expect(r.source).toBe('osm');
    expect(r.coords[0]).toEqual(at(60, 0));
    expect(metres(r.coords[1], at(0, 0))).toBeLessThan(1.5);
    expect(r.lengthM).toBeGreaterThan(207);
    expect(r.lengthM).toBeLessThan(213);
    expect(r.maneuvers).toEqual([]);
    // 1.3.1 (A6, correctif du 21/11) : le raccord de départ est signalé (rang du premier point sur la voie)
    expect(r.joinAt).toBe(1);
  });

  it('1.3.1 (A6) : `joinAt` seulement quand le départ est hors de la voie (1 m ou plus) ; jamais sur un chemin droit', async () => {
    const on = await route(road, [0, -100], [0, 100]);
    expect('joinAt' in on).toBe(false);
    const near = await route(road, [0.4, -100], [0, 100]);
    expect('joinAt' in near).toBe(false);
    const door = await route(road, [6, -100], [0, 100]);
    expect(door.joinAt).toBe(1);
    expect(metres(door.coords[1], at(0, -100))).toBeLessThan(1.5);
    // départ hors de la voie, arrivée au pied du raccord : le raccord, puis l'arrivée
    const short = await route(road, [40, 0], [0, 0]);
    expect(short.joinAt).toBe(1);
    expect(short.coords).toHaveLength(2);
    const far = await route(road, [150, 0], [0, 150]);
    expect('joinAt' in far).toBe(false);
  });

  it('à 150 m de toute voie : chemin droit (aucun virage)', async () => {
    const r = await route(road, [150, 0], [0, 150]);
    expect(r.source).toBe('straight');
    expect(r.coords).toEqual([at(150, 0), at(0, 150)]);
    expect(r.lengthM).toBeCloseTo(metres(at(150, 0), at(0, 150)), 0);
    expect(r.maneuvers).toEqual([]);
  });

  it('départ et arrivée sur le même tronçon : chemin direct', async () => {
    const r = await route(road, [0, -100], [0, 100]);
    expect(r.source).toBe('osm');
    expect(r.coords).toHaveLength(2);
    expect(r.lengthM).toBeGreaterThan(198);
    expect(r.lengthM).toBeLessThan(202);
  });
});

describe('accroche : la rue plutôt que le couloir souterrain', () => {
  // couloir du prémétro sous le boulevard (x = 0) ; rue parallèle à 10 m (x = 10) ; liaison par un escalier au nord
  const P: GraphDef = {
    nodes: { T1: [0, -300], T2: [0, 300], S1: [10, -300], S2: [10, 300], E: [10, 320] },
    ways: [
      { nodes: ['T1', 'T2'], name: 'Couloir de la station', flags: F_UNDER },
      { nodes: ['S1', 'S2', 'E'], name: 'Boulevard' },
      { nodes: ['T2', 'E'], flags: F_STEPS },
    ],
  };

  it('arrêt posé au-dessus du couloir : accroché à la rue à 10 m (le couloir compte 25 m de plus)', async () => {
    const r = await route(P, [0, -100], [10, 200]);
    expect(metres(r.coords[1], at(10, -100))).toBeLessThan(1.5);
    expect(r.lengthM).toBeGreaterThan(306);
    expect(r.lengthM).toBeLessThan(314);
  });

  it('sans rue assez proche : le couloir (quai d’une station souterraine)', async () => {
    const far: GraphDef = { ...P, nodes: { ...P.nodes, S1: [60, -300], S2: [60, 300], E: [60, 320] } };
    const r = await route(far, [0, -100], [0, 250]);
    expect(r.coords.length).toBe(2);
    expect(r.lengthM).toBeGreaterThan(348);
    expect(r.lengthM).toBeLessThan(352);
  });
});

describe('virages proches', () => {
  it('traversée en baïonnette (à droite puis à gauche 10 m plus loin) : un seul virage, le premier', async () => {
    const def: GraphDef = {
      nodes: { A: [0, -150], J1: [0, 0], C1: [0, 150], J2: [10, 0], C2: [10, -150], B: [10, 150] },
      ways: [
        { nodes: ['A', 'J1', 'C1'], name: 'Trottoir Ouest' },
        { nodes: ['J1', 'J2'], name: 'Passage' },
        { nodes: ['C2', 'J2', 'B'], name: 'Trottoir Est' },
      ],
    };
    const r = await route(def, [0, -140], [10, 140]);
    expect(r.maneuvers).toEqual([expect.objectContaining({ turn: 'right', street: 'Passage' })]);
    checkInvariants(r);
  });

  it('légèrement puis franchement à gauche à 10 m : le plus marqué', async () => {
    const J2 = toward(0, 0, -45, 10);
    const def: GraphDef = {
      nodes: { A: [0, -150], J1: [0, 0], C1: [0, 150], J2, C2: toward(J2[0], J2[1], 0, 150), B: toward(J2[0], J2[1], -135, 150) },
      ways: [
        { nodes: ['A', 'J1', 'C1'], name: 'Avenue' },
        { nodes: ['J1', 'J2', 'C2'], name: 'Bretelle' },
        { nodes: ['J2', 'B'], name: 'Rue du Coin' },
      ],
    };
    const r = await route(def, [0, -140], toward(J2[0], J2[1], -135, 130));
    expect(r.maneuvers).toEqual([expect.objectContaining({ turn: 'left', street: 'Rue du Coin' })]);
    checkInvariants(r);
  });
});

describe('sens unique (escalier mécanique)', () => {
  const E: GraphDef = {
    nodes: { S: [0, -100], A: [0, 0], B: [0, 40], N: [0, 140], C: [50, 20] },
    ways: [
      { nodes: ['S', 'A'], name: 'Rue' },
      { nodes: ['A', 'B'], flags: F_STEPS | F_FWD },
      { nodes: ['A', 'C', 'B'], name: 'Allée' },
      { nodes: ['B', 'N'], name: 'Rue' },
    ],
  };

  it('dans son sens : l’escalier mécanique', async () => {
    const r = await route(E, [0, -90], [0, 130]);
    expect(r.lengthM).toBeGreaterThan(217);
    expect(r.lengthM).toBeLessThan(223);
  });

  it('à contresens : le détour par l’allée', async () => {
    const r = await route(E, [0, 130], [0, -90]);
    expect(r.lengthM).toBeGreaterThan(284);
    expect(r.lengthM).toBeLessThan(292);
  });
});

describe('réseaux séparés et absence de chemin', () => {
  const G: GraphDef = {
    nodes: { S: [0, -300], N: [0, 300], P1: [40, -200], P2: [40, -100] },
    ways: [{ nodes: ['S', 'N'], name: 'Grand-Rue' }, { nodes: ['P1', 'P2'], name: 'Allée isolée', comp: 1 }],
  };

  it('départ près d’un petit réseau isolé, arrivée sur le grand : accroche au grand réseau', async () => {
    const r = await route(G, [30, -150], [0, 200]);
    expect(r.source).toBe('osm');
    expect(metres(r.coords[1], at(0, -150))).toBeLessThan(1.5);
    expect(r.lengthM).toBeGreaterThan(376);
    expect(r.lengthM).toBeLessThan(384);
  });

  it('deux bouts sur le même petit réseau : chemin dans ce réseau', async () => {
    const r = await route(G, [30, -180], [30, -120]);
    expect(r.source).toBe('osm');
    expect(r.lengthM).toBeGreaterThan(77);
    expect(r.lengthM).toBeLessThan(83);
  });

  it('deux voies sans lien : chemin droit après un second essai plus large', async () => {
    const def: GraphDef = {
      nodes: { A: [0, -300], B: [0, -50], C: [0, 50], D: [0, 300] },
      ways: [{ nodes: ['A', 'B'], name: 'Rue Sud' }, { nodes: ['C', 'D'], name: 'Rue Nord' }],
    };
    const src = memorySource([tileOf(def)]);
    const r = await new WalkRouter(src, { now: () => 0 }).route(at(0, -200), at(0, 200));
    expect(r?.source).toBe('straight');
    expect(r?.maneuvers).toEqual([]);
  });
});
