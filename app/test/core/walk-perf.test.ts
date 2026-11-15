/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : temps de calcul d'une marche de 2 km sur un graphe urbain réaliste et dense : rues tous
 * les 45 à 60 m, trottoirs dessinés des deux côtés, passages piétons à chaque carrefour, positions irrégulières, rues
 * en moins et allées de parc en diagonale (environ 3 400 nœuds par km², au-delà du centre de Bruxelles ou de Gand).
 * Budget : 150 ms sur un téléphone. Ici (ordinateur), à chaud, on exige trois fois moins (marge du téléphone) ; à
 * froid (lecture, décodage et fusion de 16 km² de tuiles, puis calcul), 150 ms.
 */
import { describe, expect, it } from 'vitest';
import type { LatLon } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { isWalkTile, type WalkTileFile } from '../../src/core/walk/format';
import { WalkRouter, type WalkSource } from '../../src/core/walk/router';
import { at, checkRoute, indexOf, metres, prng, tileOf, type GraphDef, type WayDef } from './walk-helpers';

/** Ville de `cols` × `rows` carrefours, îlots de `bx` × `by` m, centrée sur ANCHOR. */
function city(cols: number, rows: number, bx: number, by: number, seed: number): GraphDef {
  const rnd = prng(seed);
  const nodes: GraphDef['nodes'] = {};
  const ways: WayDef[] = [];
  const P: [number, number][][] = [];
  for (let i = 0; i < rows; i++) {
    P.push([]);
    for (let j = 0; j < cols; j++) P[i].push([(j - cols / 2) * bx + (rnd() - 0.5) * 12, (i - rows / 2) * by + (rnd() - 0.5) * 12]);
  }
  const k = (p: string, i: number, j: number) => `${p}${i}_${j}`;
  const add = (id: string, x: number, y: number) => {
    nodes[id] = [x, y];
    return id;
  };
  const S = 6;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const [x, y] = P[i][j];
      add(k('R', i, j), x, y);
      for (const [n, dx, dy] of [['NE', S, S], ['NW', -S, S], ['SE', S, -S], ['SW', -S, -S]] as const) add(k(n, i, j), x + dx, y + dy);
      for (const [n, dx, dy] of [['XN', 0, S], ['XS', 0, -S], ['XE', S, 0], ['XW', -S, 0]] as const) add(k(n, i, j), x + dx, y + dy);
      // passages piétons des quatre branches
      ways.push({ nodes: [k('NW', i, j), k('XN', i, j), k('NE', i, j)], flags: 0 });
      ways.push({ nodes: [k('SW', i, j), k('XS', i, j), k('SE', i, j)] });
      ways.push({ nodes: [k('NE', i, j), k('XE', i, j), k('SE', i, j)] });
      ways.push({ nodes: [k('NW', i, j), k('XW', i, j), k('SW', i, j)] });
      ways.push({ nodes: [k('XN', i, j), k('R', i, j), k('XS', i, j)], name: `Rue ${j}` });
      ways.push({ nodes: [k('XW', i, j), k('R', i, j), k('XE', i, j)], name: `Avenue ${i}` });
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      // rue est-ouest vers (i, j + 1) et nord-sud vers (i + 1, j), 4 % de rues en moins
      if (j + 1 < cols && rnd() > 0.04) {
        ways.push({ nodes: [k('XE', i, j), k('XW', i, j + 1)], name: `Avenue ${i}` });
        ways.push({ nodes: [k('NE', i, j), k('NW', i, j + 1)] });
        ways.push({ nodes: [k('SE', i, j), k('SW', i, j + 1)] });
      }
      if (i + 1 < rows && rnd() > 0.04) {
        ways.push({ nodes: [k('XN', i, j), k('XS', i + 1, j)], name: `Rue ${j}` });
        ways.push({ nodes: [k('NE', i, j), k('SE', i + 1, j)] });
        ways.push({ nodes: [k('NW', i, j), k('SW', i + 1, j)] });
      }
      // parc : allée en diagonale à travers l'îlot, avec une courbe
      if (i + 1 < rows && j + 1 < cols && rnd() < 0.08) {
        const [x0, y0] = P[i][j];
        const [x1, y1] = P[i + 1][j + 1];
        const mid = add(k('M', i, j), (x0 + x1) / 2 + 8, (y0 + y1) / 2 - 8);
        ways.push({ nodes: [k('NE', i, j), mid, k('SW', i + 1, j + 1)], name: `Parc ${i}-${j}` });
      }
    }
  }
  return { nodes, ways };
}

const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * q) - 1)];

describe('vitesse (graphe urbain dense)', () => {
  // 16 km² : 89 × 67 carrefours, îlots de 45 × 60 m
  const def = city(89, 67, 45, 60, 7);
  const tile = tileOf(def, { key: '2541_145', loose: true });
  const text = JSON.stringify(tile);
  const source = (): WalkSource => ({
    index: async () => indexOf(),
    // la tuile est relue (JSON) à chaque demande, comme un fichier reçu du réseau
    tile: async (key) => {
      if (key !== tile.k) return null;
      const x = JSON.parse(text) as unknown;
      return isWalkTile(x) ? (x as WalkTileFile) : null;
    },
  });
  // marches de 1,55 à 1,65 km à vol d'oiseau (2 km environ à pied dans un quadrillage), centrées à moins de 600 m du
  // milieu de la ville : leur cadre touche toujours la tuile de test (toute la ville est dans une seule tuile)
  const rnd = prng(2026);
  const pairs: [LatLon, LatLon][] = [];
  while (pairs.length < 40) {
    const [mx, my] = [(rnd() - 0.5) * 1200, (rnd() - 0.5) * 1200];
    const ang = rnd() * 2 * Math.PI;
    const h = (1550 + rnd() * 100) / 2;
    pairs.push([at(mx - h * Math.cos(ang), my - h * Math.sin(ang)), at(mx + h * Math.cos(ang), my + h * Math.sin(ang))]);
  }

  it('graphe réaliste : nombre de nœuds et de tronçons', () => {
    const nodes = Object.keys(def.nodes).length;
    expect(nodes / 16).toBeGreaterThan(3000);
    console.log(`Graphe de test : ${nodes} nœuds, ${def.ways.length} voies, tuile de ${(text.length / 1e6).toFixed(2)} Mo`);
  });

  it('marches de 2 km : vrais chemins ; calcul à chaud p95 sous 50 ms (150 ms sur un téléphone, marge × 3)', async () => {
    const router = new WalkRouter(source());
    const warm: number[] = [];
    let total = 0;
    for (const [a, b] of pairs) {
      const r = (await router.route(a, b)) as WalkRoute;
      expect(r.source).toBe('osm');
      checkRoute(r, a, b);
      total += r.lengthM;
      const t0 = performance.now();
      await router.route(a, b);
      warm.push(performance.now() - t0);
    }
    const avg = total / pairs.length;
    expect(avg).toBeGreaterThan(1800);
    console.log(`Marches de ${Math.round(avg)} m en moyenne : calcul à chaud p50 ${p(warm, 0.5).toFixed(1)} ms, p95 ${p(warm, 0.95).toFixed(1)} ms, max ${Math.max(...warm).toFixed(1)} ms`);
    expect(p(warm, 0.95)).toBeLessThan(50);
  });

  it('à froid (tuiles lues, décodées, fusionnées, puis calcul) : sous 150 ms', async () => {
    const cold: number[] = [];
    for (const [a, b] of pairs.slice(0, 6)) {
      const router = new WalkRouter(source());
      const t0 = performance.now();
      const r = await router.route(a, b);
      cold.push(performance.now() - t0);
      expect(r?.source).toBe('osm');
    }
    console.log(`À froid : p50 ${p(cold, 0.5).toFixed(1)} ms, max ${Math.max(...cold).toFixed(1)} ms`);
    expect(p(cold, 0.5)).toBeLessThan(150);
  });

  it('mesure de la distance parcourue par rapport au vol d’oiseau (détour plausible dans un quadrillage)', async () => {
    const router = new WalkRouter(source());
    for (const [a, b] of pairs.slice(0, 10)) {
      const r = (await router.route(a, b)) as WalkRoute;
      expect(r.lengthM / metres(a, b)).toBeLessThan(1.6);
    }
  });
});
