/**
 * 1.2.3 (PRD-1.2.3 CA-123.1, CA-123.2) : tableau complet et arrêts d'un départ sur des instantanés réels publiés par le
 * pipeline, à la demande seulement (comme test/core/linepicks-real.test.ts) :
 *
 *   QUAI_REAL=/home/claude/real-data-11/data,/home/claude/real-data-13/data npx vitest run test/core/departure-stops-real.test.ts
 *
 * Chaque contrôle tourne si un instantané couvre son jour. Relais en panne : horaires prévus. Positions : aucune.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta } from '../../../shared/types';
import { normalizeForSearch } from '../../../shared/names';
import type { Core, Departure, DepartureStops } from '../../src/core/api';
import { gtfsTime, hhmm } from '../../src/core/util';
import { makeEnv, type TestEnv } from './support/env';

const DIRS = (process.env.QUAI_REAL ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((d) => d && existsSync(join(d, 'meta.json')));
const metaOf = (d: string) => JSON.parse(readFileSync(join(d, 'meta.json'), 'utf8')) as Meta;
const snapFor = (day: string) => DIRS.find((d) => metaOf(d).lines && metaOf(d).serviceDates.includes(day));
const has = (...days: string[]) => days.every((d) => !!snapFor(d));
const envAt = (day: string, h: number, m: number): TestEnv => makeEnv({ now: gtfsTime(day, h * 60 + m), scene: 'noRT', dataDir: snapFor(day)! });

const NAMUR = 'sncb:8863008';
const COLLEGE = 'tec:tec:s-brainelalleudctducollge'; // Braine-l'Alleud Côté du Collège
const ARTS_LOI = 'stib:9'; // métro 1, 2, 5, 6
const LOUISE = 'stib:52'; // métro 2, 6 ; trams 8, 92, 93
const view = (s: DepartureStops) => s.stops.map((x) => `${hhmm(x.sched)} ${x.name.fr}${x.platform ? ` v${x.platform}` : ''}`);
const key = (s: string) => normalizeForSearch(s).replace(/ gare$/, '');

/** Invariants (CA-123.2) : l'arrêt du tableau d'abord, à l'heure du départ ; heures croissantes ; jamais deux fois la même zone de suite. */
function check(s: DepartureStops, areaId: string, d: Departure): void {
  expect(s.state).toBe('ok');
  expect(s.stops.length).toBeGreaterThanOrEqual(2);
  expect(s.stops[0]).toMatchObject({ areaId, sched: d.sched });
  for (let i = 1; i < s.stops.length; i++) {
    expect(s.stops[i].sched).toBeGreaterThanOrEqual(s.stops[i - 1].sched);
    expect(s.stops[i].areaId).not.toBe(s.stops[i - 1].areaId);
    expect(s.stops[i].name.fr).not.toBe('');
  }
}

async function timed<T>(f: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const t0 = performance.now();
  const v = await f();
  return { v, ms: performance.now() - t0 };
}

describe.skipIf(!has('2026-11-12'))('données réelles du jeudi 12/11 (instantané du 11)', () => {
  it('CA-123.1 : Namur, 2 h de départs (bien plus de 8) ; un IC et ses gares jusqu’au terminus, voies comprises, en moins d’une seconde', async () => {
    const { core } = envAt('2026-11-12', 7, 32);
    const b = await core.board(NAMUR, { horizonMin: 120, limit: 40 });
    console.log(`12/11 07:32, Namur en 2 h : ${b.departures.length} départs : ${b.departures.map((d) => `${d.line} ${hhmm(d.sched)}`).join(', ')}`);
    expect(b.departures.length).toBeGreaterThan(20);
    expect(b.departures.every((d) => d.sched <= gtfsTime('2026-11-12', 9 * 60 + 32))).toBe(true);
    const ics = b.departures.filter((d) => d.line === 'IC' && !d.cancelled);
    expect(ics.length).toBeGreaterThanOrEqual(4);
    let stops = 0;
    let platforms = 0;
    for (const [i, d] of ics.entries()) {
      const { v: s, ms } = await timed(() => core.departureStops(NAMUR, d));
      if (i < 3) console.log(`IC ${hhmm(d.sched)} vers ${d.head.fr} (${ms.toFixed(0)} ms, ${s.stops.length} gares) :\n  ${view(s).join('\n  ')}`);
      check(s, NAMUR, d);
      expect(ms).toBeLessThan(i === 0 ? 1000 : 200);
      expect(s).toMatchObject({ op: 'sncb', mode: 'train', line: 'IC' });
      // le terminus est la destination affichée ; la voie de Namur, celle du tableau
      expect(key(s.stops.at(-1)!.name.fr)).toBe(key(d.head.fr));
      expect(s.stops[0].platform).toBe(d.platform);
      stops += s.stops.length;
      platforms += s.stops.filter((x) => x.platform).length;
    }
    // voies connues des gares belges (les gares étrangères n'en ont pas)
    expect(platforms).toBeGreaterThan(stops / 2);
  });

  it('CA-123.2 : le 36 à Côté du Collège, jusqu’à Wavre ou Braine-l’Alleud Gare ; le passage de 07:49 s’arrête à Vallée Bailly', async () => {
    const { core } = envAt('2026-11-12', 7, 32);
    const b = await core.board(COLLEGE, { horizonMin: 120 });
    expect(b.departures.length).toBeGreaterThan(8);
    const ends: string[] = [];
    for (const d of b.departures.filter((x) => x.line === '36')) {
      const { v: s, ms } = await timed(() => core.departureStops(COLLEGE, d));
      check(s, COLLEGE, d);
      expect(ms).toBeLessThan(500);
      ends.push(`${hhmm(d.sched)} ${s.stops.at(-1)!.name.fr} (${s.stops.length})`);
      if (hhmm(d.sched) === '07:41') {
        console.log(`36 de 07:41 vers ${d.head.fr} (${ms.toFixed(0)} ms) :\n  ${view(s).join('\n  ')}`);
        expect(s.stops.length).toBeGreaterThan(30);
        expect(s.stops.map((x) => x.name.fr)).toContain("Lasne Village (Rue de l'Eglise)");
      }
    }
    console.log(`12/11, le 36 à Côté du Collège : ${ends.join(' ; ')}`);
    expect(ends.some((e) => /^07:41 Wavre/.test(e))).toBe(true);
    expect(ends.some((e) => /^07:49 Braine-l’Alleud Vallée Bailly \(3\)$/.test(e))).toBe(true);
    expect(ends.some((e) => /Braine-l'Alleud, Gare|Braine-l’Alleud Gare/.test(e))).toBe(true);
  });

  it('CA-123.2 : métro 1 à Arts-Loi, métro 2 et tram 93 à Louise : arrêts et heures prévues', async () => {
    const { core } = envAt('2026-11-12', 7, 32);
    for (const [area, line, mode] of [
      [ARTS_LOI, '1', 'metro'],
      [LOUISE, '2', 'metro'],
      [LOUISE, '93', 'tram'],
    ] as const) {
      const b = await core.board(area, { horizonMin: 120 });
      expect(b.departures).toHaveLength(40);
      const ds = b.departures.filter((d) => d.line === line).slice(0, 2);
      expect(ds.length).toBe(2);
      for (const d of ds) {
        const { v: s, ms } = await timed(() => core.departureStops(area, d));
        console.log(`${mode} ${line} de ${hhmm(d.sched)} vers ${d.head.fr} (${ms.toFixed(0)} ms) : ${s.stops.map((x) => `${hhmm(x.sched)} ${x.name.fr}`).join(', ')}`);
        check(s, area, d);
        expect(s).toMatchObject({ op: 'stib', mode, line, anyPlanned: true });
        expect(ms).toBeLessThan(500);
        expect(key(s.stops.at(-1)!.name.fr)).toBe(key(d.head.fr));
      }
    }
  });
});

describe.skipIf(!has('2026-11-14'))('données réelles du samedi 14/11 (instantané du 13)', () => {
  it('le 36 et l’E3 à Côté du Collège, un IC de Namur : arrêts jusqu’au terminus', async () => {
    const { core } = envAt('2026-11-14', 10, 0);
    for (const [area, line] of [
      [COLLEGE, '36'],
      [COLLEGE, 'E3'],
      [NAMUR, 'IC'],
    ] as const) {
      const d = (await core.board(area, { horizonMin: 120 })).departures.find((x) => x.line === line)!;
      expect(d).toBeDefined();
      const s = await core.departureStops(area, d);
      console.log(`14/11 10:00, ${line} de ${hhmm(d.sched)} vers ${d.head.fr} : ${s.stops.length} arrêts, terminus ${s.stops.at(-1)!.name.fr}`);
      check(s, area, d);
    }
  });
});

/** Tous les départs d'un échantillon de zones : jamais d'exception, l'arrêt du tableau d'abord, heures croissantes. */
async function sweep(core: Core, dir: string, every: number): Promise<{ n: number; missing: number; slow: number; maxMs: number }> {
  const out = { n: 0, missing: 0, slow: 0, maxMs: 0 };
  for (const op of ['sncb', 'stib', 'delijn', 'tec']) {
    const files = readdirSync(join(dir, 'areas', op)).filter((_, i) => i % every === 0);
    for (const f of files) {
      const a = JSON.parse(readFileSync(join(dir, 'areas', op, f), 'utf8')) as AreaFile;
      const b = await core.board(a.id, { horizonMin: 120, limit: 10 });
      for (const d of b.departures) {
        const { v: s, ms } = await timed(() => core.departureStops(a.id, d));
        out.n++;
        out.maxMs = Math.max(out.maxMs, ms);
        if (ms > 300) out.slow++;
        if (s.state === 'missing') {
          out.missing++;
          continue;
        }
        check(s, a.id, d);
      }
    }
  }
  return out;
}

describe.skipIf(!DIRS.length)('données réelles : tous les instantanés, échantillon de zones', () => {
  it('departureStops sur les départs de 2 h de 1 zone sur 150 : jamais d’exception ni de voyage perdu', async () => {
    for (const dir of DIRS) {
      const day = metaOf(dir).serviceDates[0];
      const env = makeEnv({ now: gtfsTime(day, 8 * 60), scene: 'noRT', dataDir: dir });
      const r = await sweep(env.core, dir, 150);
      console.log(`${day} 08:00 : ${r.n} départs, ${r.missing} introuvables, ${r.slow} au-delà de 300 ms (max ${r.maxMs.toFixed(0)} ms)`);
      expect(r.n).toBeGreaterThan(300);
      expect(r.missing).toBe(0);
    }
  }, 600_000);
});
