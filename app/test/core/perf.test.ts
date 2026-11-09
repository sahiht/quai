/**
 * Performance : tableau sur fichiers en cache < 50 ms ; trains sur une journée synthétique de 4 000 voyages < 300 ms.
 */
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta, TrainsDay } from '../../../shared/types';
import { hhmm } from '../../src/core/util';
import { FakeServer, makeEnv } from './support/env';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATES = ['2026-11-10', '2026-11-11'];
const meta: Meta = {
  v: 1,
  generatedAt: '2026-11-10T01:15:00.000Z',
  timezone: 'Europe/Brussels',
  serviceDates: DATES,
  tile: { lat: 0.02, lon: 0.03 },
  feeds: {
    sncb: { ok: true, areas: 600, trips: 8000 },
    stib: { ok: true, areas: 0, trips: 0 },
    delijn: { ok: true, areas: 0, trips: 0 },
    tec: { ok: true, areas: 0, trips: 0 },
  },
};

/** 600 gares, 125 lignes passant toutes par un pôle (gare 0), 4 000 voyages par jour. */
export function syntheticTrainsDay(date: string, seed = 7): TrainsDay {
  const r = rng(seed);
  const stations = Array.from({ length: 600 }, (_, i) => ({
    id: `sncb:${8800000 + i}`,
    n: { fr: `Gare ${i}`, nl: `Station ${i}` },
    lat: 49.6 + r() * 1.8,
    lon: 2.6 + r() * 3.6,
  }));
  const lines: number[][] = [];
  for (let l = 0; l < 125; l++) {
    const own = Array.from({ length: 4 }, (_, k) => 1 + ((l * 4 + k) % 599));
    const others = Array.from({ length: 8 }, () => 1 + Math.floor(r() * 599));
    const seq = [...new Set([...own.slice(0, 2), ...others.slice(0, 4), 0, ...others.slice(4), ...own.slice(2)])];
    lines.push(seq);
  }
  const trips: TrainsDay['trips'] = [];
  let n = 0;
  for (let l = 0; l < lines.length && trips.length < 4000; l++) {
    for (const dir of [0, 1]) {
      const seq = dir ? [...lines[l]].reverse() : lines[l];
      for (let k = 0; k < 16; k++) {
        let t = 300 + k * 60 + Math.floor(r() * 30);
        const s: TrainsDay['trips'][number]['s'] = [];
        seq.forEach((st, i) => {
          const arr = t;
          const dep = i === 0 ? t : t + 1;
          s.push([st, arr, dep, String(1 + (i % 9)), i + 1]);
          t = dep + 3 + Math.floor(r() * 6);
        });
        trips.push({ id: `syn:${date}:${n++}`, cat: l % 3 ? 'IC' : 'L', num: String(1000 + n), head: stations[seq[seq.length - 1]].n, s });
      }
    }
  }
  return { v: 1, date, stations, trips };
}

/** Zone SNCB synthétique très chargée : ~2 900 départs sur deux jours. */
function syntheticArea(): AreaFile {
  const r = rng(3);
  const patterns: AreaFile['patterns'] = Array.from({ length: 24 }, (_, i) => ({
    line: i % 2 ? 'IC' : 'S1',
    mode: 'train',
    route: `R${i}`,
    head: { fr: `Destination ${i}`, nl: `Bestemming ${i}` },
    next: [[`sncb:${8810000 + i}`, 10 + i]],
  }));
  const deps: AreaFile['deps'] = [];
  for (let day = 0; day < 2; day++) {
    for (let m = 300; m < 1500; m += 1) {
      deps.push([day, m, Math.floor(r() * 24), Math.floor(r() * 8), `big:${day}:${m}`, 3]);
      if (r() < 0.2) deps.push([day, m, Math.floor(r() * 24), Math.floor(r() * 8), `big:${day}:${m}b`, 5]);
    }
  }
  return {
    v: 1,
    id: 'sncb:8800001',
    op: 'sncb',
    n: { fr: 'Grande gare', nl: 'Groot station' },
    lat: 50.85,
    lon: 4.35,
    stops: Array.from({ length: 8 }, (_, i) => ({ id: `8800001_${i + 1}`, platform: String(i + 1), rt: `8800001_${i + 1}` })),
    patterns,
    deps,
  };
}

describe('performance', () => {
  it('tableau sur fichiers en cache : < 50 ms', async () => {
    const server = new FakeServer();
    const area = syntheticArea();
    expect(area.deps.length).toBeGreaterThan(2000);
    server.memFiles.set('areas/sncb/8800001.json', JSON.stringify(area));
    const env = makeEnv({ now: '2026-11-10T17:30', server });
    await env.core.board('sncb:8800001', { limit: 8 });
    env.clock.advance(21_000); // temps réel à recharger (relais local instantané)
    let worst = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const b = await env.core.board('sncb:8800001', { limit: 8 });
      worst = Math.max(worst, performance.now() - t0);
      expect(b.departures).toHaveLength(8);
    }
    console.info(`board (cache) : ${worst.toFixed(1)} ms au pire sur 5`);
    expect(worst).toBeLessThan(50);
  });

  it('trains sur une journée synthétique de 4 000 voyages : < 300 ms', async () => {
    const server = new FakeServer();
    server.memFiles.set('meta.json', JSON.stringify(meta));
    for (const d of DATES) server.memFiles.set(`trains/${d}.json`, JSON.stringify(syntheticTrainsDay(d)));
    const env = makeEnv({ now: '2026-11-10T07:00', server });
    await env.core.init();
    // premier appel : lecture des deux fichiers (~2 Mo chacun), index et recherche
    const t0 = performance.now();
    const js = await env.core.trains('sncb:8800005', 'sncb:8800497', env.clock.t);
    const cold = performance.now() - t0;
    // appels suivants : index en cache
    const t1 = performance.now();
    const again = await env.core.trains('sncb:8800010', 'sncb:8800321', env.clock.t);
    const warm = performance.now() - t1;
    console.info(`trains 4 000 voyages/jour : ${cold.toFixed(1)} ms (premier appel), ${warm.toFixed(1)} ms (suivant)`);
    expect(js.length).toBeGreaterThan(0);
    expect(again.length).toBeGreaterThan(0);
    expect(js[0].transfers).toBeLessThanOrEqual(1);
    expect(hhmm(js[0].dep) >= '07:00').toBe(true);
    expect(cold).toBeLessThan(300);
    expect(warm).toBeLessThan(100);
  });
});
