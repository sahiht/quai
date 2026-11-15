/**
 * 1.2.10 (PRD-1.2.10 § 9.3) : chemin à pied sur de vraies tuiles, construites par le pipeline à partir de petits
 * extraits OpenStreetMap (app/test/core/walk-data/, © les contributeurs d'OpenStreetMap, ODbL) : centre d'Helsinki
 * (trottoirs et passages piétons dessinés, comme à Bruxelles ou Gand) et environs de Kotka (deux tuiles).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LatLon } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { decodeTile, WALK_UNIT } from '../../src/core/walk/format';
import { WalkRouter } from '../../src/core/walk/router';
import { checkRoute, diskSource, metres, prng } from './walk-helpers';

const DATA = join(__dirname, 'walk-data');

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)];

describe('centre d’Helsinki', () => {
  const dir = join(DATA, 'helsinki');
  const places: Record<string, LatLon> = {
    'place de la Gare': { lat: 60.1712, lon: 24.9436 },
    'place du Marché': { lat: 60.1675, lon: 24.9525 },
    'parc de Kaisaniemi': { lat: 60.1745, lon: 24.946 },
    Esplanadi: { lat: 60.1677, lon: 24.947 },
    'place du Sénat': { lat: 60.1693, lon: 24.9522 },
    Ateneum: { lat: 60.1704, lon: 24.9441 },
  };
  const trips: [string, string][] = [
    ['place de la Gare', 'place du Marché'],
    ['parc de Kaisaniemi', 'Esplanadi'],
    ['Ateneum', 'place du Sénat'],
    ['place du Marché', 'parc de Kaisaniemi'],
  ];
  for (const [a, b] of trips) {
    it(`${a} → ${b} : vrai chemin, plausible, virages aux carrefours avec noms de rue`, async () => {
      const r = (await new WalkRouter(diskSource(dir)).route(places[a], places[b])) as WalkRoute;
      expect(r.source).toBe('osm');
      checkRoute(r, places[a], places[b]);
      const crow = metres(places[a], places[b]);
      expect(r.lengthM).toBeLessThan(crow * 1.8 + 60);
      expect(r.maneuvers.length).toBeLessThan(r.lengthM / 30);
    });
  }

  it('300 marches de 200 m à 1,5 km entre nœuds du réseau : 99 % de vrais chemins, invariants, temps', async () => {
    const t = decodeTile(JSON.parse(readFileSync(join(dir, '3008_831.json'), 'utf8')));
    const pts: LatLon[] = [];
    for (let e = 0; e < t.edgeFrom.length; e++) if (t.edgeComp[e] === 0) pts.push({ lat: t.nodeLat[t.edgeFrom[e]] * WALK_UNIT, lon: t.nodeLon[t.edgeFrom[e]] * WALK_UNIT });
    const rnd = prng(1210);
    const router = new WalkRouter(diskSource(dir));
    let osm = 0;
    let n = 0;
    const warm: number[] = [];
    let turns = 0;
    let named = 0;
    while (n < 300) {
      const a = pts[Math.floor(rnd() * pts.length)];
      const b = pts[Math.floor(rnd() * pts.length)];
      const d = metres(a, b);
      if (d < 200 || d > 1500) continue;
      n++;
      const r = (await router.route(a, b)) as WalkRoute;
      const t0 = performance.now();
      await router.route(a, b);
      warm.push(performance.now() - t0);
      if (r.source !== 'osm') continue;
      osm++;
      checkRoute(r, a, b);
      turns += r.maneuvers.length;
      named += r.maneuvers.filter((m) => m.street).length;
    }
    expect(osm / n).toBeGreaterThanOrEqual(0.99);
    expect(p95(warm)).toBeLessThan(150);
    expect(named).toBeGreaterThan(turns * 0.2);
    console.log(`Helsinki : ${osm}/${n} vrais chemins, ${turns} virages (${named} avec un nom de rue), calcul p95 ${p95(warm).toFixed(1)} ms`);
  });
});

describe('environs de Kotka : deux tuiles', () => {
  it('marches d’une tuile à l’autre : raccord par les nœuds partagés', async () => {
    const dir = join(DATA, 'kotka');
    const nodes = (key: string) => {
      const t = decodeTile(JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')));
      const out: LatLon[] = [];
      for (let e = 0; e < t.edgeFrom.length; e++) if (t.edgeComp[e] === 0) out.push({ lat: t.nodeLat[t.edgeTo[e]] * WALK_UNIT, lon: t.nodeLon[t.edgeTo[e]] * WALK_UNIT });
      return out;
    };
    const west = nodes('3026_897');
    const east = nodes('3026_898');
    const rnd = prng(42);
    const router = new WalkRouter(diskSource(dir));
    let tried = 0;
    let crossed = 0;
    let osm = 0;
    while (tried < 40) {
      const a = west[Math.floor(rnd() * west.length)];
      const b = east[Math.floor(rnd() * east.length)];
      const d = metres(a, b);
      if (d < 200 || d > 1500) continue;
      tried++;
      const r = (await router.route(a, b)) as WalkRoute;
      if (r.source !== 'osm') continue;
      osm++;
      checkRoute(r, a, b);
      if (r.coords.some((c) => c.lon < 26.94) && r.coords.some((c) => c.lon > 26.94)) crossed++;
    }
    expect(osm).toBeGreaterThanOrEqual(38);
    expect(crossed).toBe(osm);
  });
});
