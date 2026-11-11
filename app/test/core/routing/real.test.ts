/**
 * Contrôles sur données réelles (PRD annexe A.3, design-routing.md § 5 et § 8), à la demande seulement (DECISIONS Q13) :
 *
 *   QUAI_REAL=/home/claude/real-data/data [QUAI_REAL_LINES=/home/claude/routing-proto/out] [QUAI_REAL_PAIRS=300] \
 *     npx vitest run test/core/routing/real.test.ts
 *
 * Dossier de données temporaire : zones, recherche et tuiles de l'instantané ; fichiers de ligne et tuiles de lignes
 * du prototype (même format, même instantané) ; meta.lines ajouté ; trains/ avec les autorisations de montée et de
 * descente (-1) reprises de trainflags.json du prototype (émulation du correctif M1 du pipeline). Relais en panne :
 * horaires prévus. Les résultats (propositions, octets, temps) s'écrivent dans la console.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LineIndex, Meta, TileFile, TrainsDay } from '../../../../shared/types';
import type { Endpoint, Journey, PlanResult, Settings } from '../../../src/core/api';
import { DEFAULT_SETTINGS } from '../../../src/core/api';
import { computeRoute, type RouteDebug } from '../../../src/core/routing/engine';
import { changesOf, itemOf } from '../../../src/core/routing/rank';
import { distanceM, gtfsTime, hhmm, lineLabel, localDate, walkMinutes } from '../../../src/core/util';
import { DATA_BASE, makeEnv } from '../support/env';

const REAL = process.env.QUAI_REAL ?? '';
const PROTO = process.env.QUAI_REAL_LINES ?? '/home/claude/routing-proto/out';
const PAIRS = Number(process.env.QUAI_REAL_PAIRS ?? 300);
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, onboarded: true, maxWalkMin: 10 };

let DIR = '';
let trainsFiles: Record<string, TrainsDay> = {};

function prepare(): void {
  DIR = mkdtempSync(join(tmpdir(), 'quai-real-'));
  for (const d of ['areas', 'search', 'tiles']) symlinkSync(join(REAL, d), join(DIR, d));
  symlinkSync(join(PROTO, 'lines'), join(DIR, 'lines'));
  symlinkSync(join(PROTO, 'linetiles'), join(DIR, 'linetiles'));
  const meta = JSON.parse(readFileSync(join(REAL, 'meta.json'), 'utf8')) as Meta;
  const index = JSON.parse(readFileSync(join(PROTO, 'lines', 'index.json'), 'utf8')) as LineIndex;
  meta.lines = { files: index.lines.length, ops: ['stib', 'delijn', 'tec'], conn: index.conn };
  writeFileSync(join(DIR, 'meta.json'), JSON.stringify(meta));
  const flags = JSON.parse(readFileSync(join(PROTO, 'trainflags.json'), 'utf8')) as Record<string, { b: number[]; a: string[] }>;
  mkdirSync(join(DIR, 'trains'));
  let forbidden = 0;
  for (const date of meta.serviceDates) {
    const day = JSON.parse(readFileSync(join(REAL, 'trains', `${date}.json`), 'utf8')) as TrainsDay;
    for (const t of day.trips) {
      const fl = flags[t.id];
      if (!fl) continue;
      const n = t.s.length;
      t.s.forEach((x, k) => {
        if (k < n - 1 && !fl.b.includes(x[4])) {
          x[2] = -1;
          forbidden++;
        }
        if (k > 0 && !fl.a.includes(day.stations[x[0]]?.id ?? '')) {
          x[1] = -1;
          forbidden++;
        }
      });
    }
    trainsFiles[date] = day;
    writeFileSync(join(DIR, 'trains', `${date}.json`), JSON.stringify(day));
  }
  console.log(`données réelles : ${DIR} (${forbidden} montées ou descentes interdites)`);
}

const T = (h: number, m: number, day = '2026-11-10') => gtfsTime(day, h * 60 + m);
const pt = (lat: number, lon: number, label: string): Endpoint => ({ type: 'address', label, lat, lon });
function st(id: string): Endpoint {
  const s = trainsFiles['2026-11-10'].stations.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return { type: 'area', areaId: id, op: 'sncb', name: s.n, lat: s.lat, lon: s.lon };
}

interface Q {
  n: string;
  O: () => Endpoint;
  D: () => Endpoint;
  after: number;
}
/** Les requêtes du design § 5.2 (24) et le cas de nuit de l'annexe A.3. */
const QUERIES: Q[] = [
  { n: '1 Waterloo centre → bureau', O: () => pt(50.715, 4.399, 'Waterloo centre'), D: () => pt(50.8441, 4.3474, 'Bureau'), after: T(7, 45) },
  { n: '2 Namur centre → quartier Nord', O: () => pt(50.4625, 4.867, 'Namur'), D: () => pt(50.858, 4.358, 'Nord'), after: T(7, 30) },
  { n: '3 Flagey → point Verboekhoven', O: () => pt(50.8275, 4.3725, 'Flagey'), D: () => pt(50.8607, 4.3815, 'Verboekhoven'), after: T(12, 0) },
  { n: '3b Flagey → arrêt Verboekhoven', O: () => pt(50.8275, 4.3725, 'Flagey'), D: () => pt(50.87117, 4.37587, 'Place Verboekhoven'), after: T(12, 0) },
  { n: '4 Gand Korenmarkt → Bruges', O: () => pt(51.0545, 3.7215, 'Korenmarkt'), D: () => st('sncb:8891009'), after: T(10, 0) },
  { n: '5 Liège centre → Bruxelles-Luxembourg', O: () => pt(50.641, 5.5735, 'Liège'), D: () => st('sncb:8811304'), after: T(8, 0) },
  { n: '6 LLN centre → Ottignies', O: () => pt(50.668, 4.6115, 'LLN'), D: () => st('sncb:8811601'), after: T(17, 30) },
  { n: '7 Anvers Groenplaats → Brussels Airport', O: () => pt(51.2189, 4.4011, 'Groenplaats'), D: () => st('sncb:8819406'), after: T(9, 0) },
  { n: '8 Charleroi Ville-Haute → Mons', O: () => pt(50.411, 4.444, 'Charleroi'), D: () => pt(50.4543, 3.952, 'Mons'), after: T(18, 0) },
  { n: '9 Mettet → Namur centre', O: () => pt(50.3213, 4.66, 'Mettet'), D: () => pt(50.4625, 4.867, 'Namur'), after: T(7, 15) },
  { n: '10 De Brouckère → Namur, 23:10', O: () => pt(50.8505, 4.3524, 'De Brouckère'), D: () => pt(50.4625, 4.867, 'Namur'), after: T(23, 10) },
  { n: '11 Lo → Ypres', O: () => pt(50.981, 2.7517, 'Lo'), D: () => pt(50.8512, 2.8853, 'Ypres'), after: T(8, 0) },
  { n: '12 Flagey → Verboekhoven, 23:45', O: () => pt(50.8275, 4.3725, 'Flagey'), D: () => pt(50.8607, 4.3815, 'Verboekhoven'), after: T(23, 45) },
  { n: '13 Schuman → LLN', O: () => pt(50.8432, 4.381, 'Schuman'), D: () => pt(50.668, 4.6115, 'LLN'), after: T(8, 30) },
  { n: '14 Bièvre → Bertrix', O: () => pt(49.942, 5.019, 'Bièvre'), D: () => pt(49.855, 5.253, 'Bertrix'), after: T(7, 0) },
  { n: '15 De Brouckère → Gand Korenmarkt, 23:10', O: () => pt(50.8505, 4.3524, 'De Brouckère'), D: () => pt(51.0545, 3.7215, 'Korenmarkt'), after: T(23, 10) },
  { n: '16 Uccle Fort-Jaco → Evere', O: () => pt(50.78943, 4.37403, 'Fort-Jaco'), D: () => pt(50.8594, 4.4146, 'Evere'), after: T(12, 0) },
  { n: '17 Westland → Roodebeek', O: () => pt(50.827, 4.295, 'Westland'), D: () => pt(50.8475, 4.432, 'Roodebeek'), after: T(8, 0) },
  { n: '18 Kortemark → Torhout', O: () => pt(51.029, 3.042, 'Kortemark'), D: () => pt(51.0645, 3.101, 'Torhout'), after: T(9, 0) },
  { n: '19 CA-M8.1 Maison → Bureau 07:31', O: () => pt(50.4655, 4.859, 'Maison'), D: () => pt(50.8441, 4.3474, 'Bureau'), after: T(7, 31) },
  { n: '20 CA-M8.1 Maison → Bureau 23:50', O: () => pt(50.4655, 4.859, 'Maison'), D: () => pt(50.8441, 4.3474, 'Bureau'), after: T(23, 50) },
  { n: '21 cas G : Waterloo → Bruxelles-Midi 23:50', O: () => st('sncb:8814266'), D: () => st('sncb:8814001'), after: T(23, 50) },
  { n: '22 CA-M5.8 Namur → Saint-Nicolas', O: () => st('sncb:8863008'), D: () => st('sncb:8894508'), after: T(7, 45) },
  { n: '23 CA-M8.4 Liège-Guillemins → Bruxelles-Nord 11/11', O: () => st('sncb:8841004'), D: () => st('sncb:8812005'), after: T(9, 10, '2026-11-11') },
  { n: 'A.3 nuit : LLN Grand-Place → Namur 23:50', O: () => pt(50.6693, 4.6115, 'LLN Grand-Place'), D: () => pt(50.4627, 4.8666, 'Namur'), after: T(23, 50) },
];

const legText = (j: Journey) =>
  j.legs
    .map((l) => (l.kind === 'walk' ? `à pied ${l.walkMin}` : `${l.cat ?? `${l.op} ${lineLabel(l.mode ?? 'bus', l.line ?? '')}`} ${hhmm(l.dep)} ${l.from.name.fr} → ${l.to.name.fr} ${hhmm(l.arr)}`))
    .join(' ; ');
const show = (r: PlanResult) =>
  r.journeys.map((j) => `  [${j.label}] ${hhmm(j.dep)} → ${hhmm(j.arr)}${localDate(j.dep) !== '2026-11-10' ? ` (${localDate(j.dep)})` : ''} « ${(j.reason ?? '').replace(/ /g, ' ')} »\n     ${legText(j)}`).join('\n') ||
  `  ${r.empty}${r.station ? ` (${r.station.name.fr})` : ''}`;

/** Attente la plus longue en correspondance (min). */
function maxWait(j: Journey): number {
  return itemOf(j).maxWait;
}

const gz = new Map<string, number>();
function bytes(urls: string[]): { files: number; raw: number; gz: number } {
  let raw = 0;
  let g = 0;
  let files = 0;
  for (const u of urls) {
    if (!u.startsWith(`${DATA_BASE}/`)) continue;
    const p = join(DIR, u.slice(DATA_BASE.length + 1));
    try {
      raw += statSync(p).size;
      let z = gz.get(p);
      if (z === undefined) gz.set(p, (z = gzipSync(readFileSync(p), { level: 6 }).length));
      g += z;
      files++;
    } catch {
      /* 404 */
    }
  }
  return { files, raw, gz: g };
}

describe.skipIf(!REAL)('données réelles (instantané du 10/11/2026)', () => {
  const results = new Map<string, PlanResult>();

  beforeAll(() => {
    prepare();
  });
  afterAll(() => {
    if (DIR) rmSync(DIR, { recursive: true, force: true });
  });

  it('24 requêtes du design § 5.2 et cas de nuit : propositions, octets, temps', async () => {
    const lines: string[] = [];
    for (const q of QUERIES) {
      const env = makeEnv({ now: q.after, scene: 'noRT', dataDir: DIR });
      const t0 = performance.now();
      const r = await env.core.route(q.O(), q.D(), q.after, SETTINGS);
      const cold = performance.now() - t0;
      const b = bytes(env.server.calls);
      const trainsGz = bytes(env.server.calls.filter((u) => u.includes('/trains/') || u.endsWith('/lines/index.json'))).gz;
      const t1 = performance.now();
      await env.core.route(q.O(), q.D(), q.after, SETTINGS);
      const warm = performance.now() - t1;
      results.set(q.n, r);
      lines.push(
        `=== ${q.n} (${hhmm(q.after)}) ===\n${show(r)}\n  ${b.files} fichiers, ${Math.round(b.gz / 1024)} Ko gzip à froid (${Math.round((b.gz - trainsGz) / 1024)} Ko sans trains ni index), ${Math.round(b.raw / 1024)} Ko bruts ; ${Math.round(cold)} ms à froid, ${Math.round(warm)} ms en mémoire`,
      );
      for (const j of r.journeys) {
        expect(maxWait(j)).toBeLessThanOrEqual(60);
        expect(j.transfers).toBeLessThanOrEqual(2);
      }
    }
    console.log(lines.join('\n'));
    for (const q of QUERIES) if (!q.n.startsWith('A.3')) expect(results.get(q.n)?.journeys.length, q.n).toBeGreaterThan(0);
  }, 600_000);

  it('CA-M8.1 : IC jusqu’à Bruxelles-Central puis 12 min à pied, jamais Bruxelles-Chapelle ; une proposition à 23:50 pour le lendemain', () => {
    const r = results.get('19 CA-M8.1 Maison → Bureau 07:31');
    const j = r?.journeys[0];
    expect(j?.label).toBe('simple');
    const ride = j?.legs.find((l) => l.kind === 'ride');
    expect(ride).toMatchObject({ cat: 'IC', to: { areaId: 'sncb:8813003' } });
    expect(j?.legs[j.legs.length - 1]).toMatchObject({ kind: 'walk', walkMin: 12 });
    expect(j?.legs.some((l) => l.to.areaId === 'sncb:8812104' || l.from.areaId === 'sncb:8812104')).toBe(false);
    const night = results.get('20 CA-M8.1 Maison → Bureau 23:50');
    expect(night?.journeys.length).toBeGreaterThan(0);
    expect(localDate(night?.journeys[0].legs.find((l) => l.kind === 'ride')?.dep ?? 0)).toBe('2026-11-11');
  });

  it('cas G : S1 06:20 direct d’abord, un trajet « Plus tôt »', () => {
    const r = results.get('21 cas G : Waterloo → Bruxelles-Midi 23:50');
    expect(r?.journeys[0]).toMatchObject({ label: 'simple', transfers: 0 });
    expect(hhmm(r?.journeys[0].legs[0].dep ?? 0)).toBe('06:20');
    expect(r?.journeys.some((j) => j.label === 'earlier')).toBe(true);
  });

  it('CA-M5.8 : Namur → Saint-Nicolas par Bruxelles (deux correspondances), pas par Lille', () => {
    const j = results.get('22 CA-M5.8 Namur → Saint-Nicolas')?.journeys[0];
    expect(j?.transfers).toBe(2);
    expect(j?.legs.some((l) => /Bruxelles/.test(l.to.name.fr))).toBe(true);
    expect(j?.legs.some((l) => /Lille/.test(`${l.to.name.fr} ${l.from.name.fr}`))).toBe(false);
  });

  it('CA-M8.4 : Liège-Guillemins → Bruxelles-Nord le 11/11 à 09:10 : aucun train de nuit, IC 09:27', () => {
    const r = results.get('23 CA-M8.4 Liège-Guillemins → Bruxelles-Nord 11/11');
    expect(r?.journeys.some((j) => j.legs.some((l) => l.cat === 'NJ' || l.cat === 'EN'))).toBe(false);
    expect(hhmm(r?.journeys[0].legs[0].dep ?? 0)).toBe('09:27');
  });

  it('nuit (A.3) : LLN Grand-Place → Namur à 23:50 : aucune attente de plus de 60 min', () => {
    const r = results.get('A.3 nuit : LLN Grand-Place → Namur 23:50');
    for (const j of r?.journeys ?? []) expect(maxWait(j)).toBeLessThanOrEqual(60);
  });

  it(`contrôle « réseau complet » : ${PAIRS} paires, au moins 97 % de meilleures arrivées et de « Le plus simple » identiques`, async () => {
    const meta = JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf8')) as Meta;
    const cache = new Map<string, unknown>();
    const read = <T>(path: string): T | null => {
      if (cache.has(path)) return cache.get(path) as T | null;
      let v: unknown = null;
      try {
        v = JSON.parse(readFileSync(join(DIR, path), 'utf8'));
      } catch {
        v = null;
      }
      cache.set(path, v);
      return v as T | null;
    };
    const source = {
      meta,
      tile: async (k: string) => read<TileFile>(`tiles/${k}.json`),
      json: async <X>(p: string, valid: (x: unknown) => x is X) => {
        const v = read<unknown>(p);
        return valid(v) ? v : null;
      },
      trains: async (d: string) => read<TrainsDay>(`trains/${d}.json`),
    };
    const centres: [string, number, number, number][] = [
      ['Bruxelles', 50.8466, 4.3528, 7], ['Anvers', 51.2194, 4.4025, 5], ['Gand', 51.0543, 3.7174, 4],
      ['Liège', 50.6326, 5.5797, 4], ['Charleroi', 50.4108, 4.4446, 4], ['Namur', 50.4669, 4.8675, 3],
      ['Louvain', 50.8798, 4.7005, 3], ['Bruges', 51.2093, 3.2247, 3], ['Mons', 50.4542, 3.9567, 3],
    ];
    let seed = Number(process.env.SEED ?? 777);
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const jitter = (lat: number, lon: number, km: number) => {
      const r = km * Math.sqrt(rnd());
      const a = 2 * Math.PI * rnd();
      return { lat: lat + (r / 111.32) * Math.cos(a), lon: lon + (r / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a) };
    };
    const env = (allLines: boolean) => ({ source, now: () => 0, refresh: async (js: Journey[]) => js, tune: { allLines } });
    let comparable = 0;
    let sameBest = 0;
    let sameSimple = 0;
    let none = 0;
    let onlyFull = 0;
    let smallMs = 0;
    const gaps: string[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const c1 = centres[Math.floor(rnd() * centres.length)];
      const c2 = rnd() < 0.35 ? centres[Math.floor(rnd() * centres.length)] : c1;
      const o = jitter(c1[1], c1[2], c1[3]);
      const d = jitter(c2[1], c2[2], c2[3]);
      const hm = [7 * 60 + 30, 8 * 60 + 15, 12 * 60, 17 * 60 + 20, 20 * 60 + 40][Math.floor(rnd() * 5)];
      const after = gtfsTime('2026-11-10', hm);
      const O = pt(o.lat, o.lon, 'O');
      const D = pt(d.lat, d.lon, 'D');
      const dbgS: RouteDebug = { cands: [], raw: [], files: 0, computeMs: 0, mode: 'lines' };
      const dbgF: RouteDebug = { cands: [], raw: [], files: 0, computeMs: 0, mode: 'lines' };
      const t0 = performance.now();
      const rs = await computeRoute(O, D, after, SETTINGS, null, { ...env(false), now: () => after }, dbgS);
      smallMs += performance.now() - t0;
      const rf = await computeRoute(O, D, after, SETTINGS, null, { ...env(true), now: () => after }, dbgF);
      if (!rs.journeys.length && !rf.journeys.length) {
        none++;
        continue;
      }
      if (!rs.journeys.length) {
        onlyFull++;
        gaps.push(`${c1[0]}→${c2[0]} #${i} ${hhmm(after)} : rien, réseau complet ${hhmm(rf.journeys[0].arr)}`);
        continue;
      }
      comparable++;
      const walkRef = walkMinutes(distanceM(o, d));
      const afterMin = (after - gtfsTime('2026-11-10', 0)) / 60_000;
      const usable = (x: RouteDebug['raw'][number]) => x.pass !== 2 && x.wait <= 60 && (walkRef > 60 || x.arr <= afterMin + walkRef);
      const best = (dbg: RouteDebug, k: number) => Math.min(...dbg.raw.filter((x) => usable(x) && x.k <= k).map((x) => x.arr));
      let ok = true;
      for (const k of [1, 2, 3]) {
        const a = best(dbgS, k);
        const b = best(dbgF, k);
        if (a > b) {
          ok = false;
          gaps.push(`${c1[0]}→${c2[0]} #${i} ${hhmm(after)} : ${k} véhicule(s) : ${a === Infinity ? '-' : Math.round(a - b)} min plus tard`);
        }
      }
      if (ok) sameBest++;
      const s1 = itemOf(rs.journeys[0]);
      const s2 = rf.journeys.length ? itemOf(rf.journeys[0]) : s1;
      const c1x = changesOf(s1, 10);
      const c2x = changesOf(s2, 10);
      if (c1x < c2x || (c1x === c2x && Math.abs(s1.walk - s2.walk) < 5 && s1.arr <= s2.arr)) sameSimple++;
      else gaps.push(`   « simple » : ${c1x} chgt, ${s1.walk} min, ${hhmm(rs.journeys[0].arr)} contre ${c2x} chgt, ${s2.walk} min, ${hhmm(rf.journeys[0].arr)}`);
    }
    console.log(
      `${gaps.join('\n')}\n${PAIRS} paires ; comparables ${comparable} ; aucune proposition des deux côtés ${none} ; seul le réseau complet trouve ${onlyFull}\n` +
        `meilleures arrivées identiques (1, 2, 3 véhicules) : ${sameBest}/${comparable} (${((100 * sameBest) / Math.max(1, comparable)).toFixed(1)} %) ; « Le plus simple » : ${sameSimple}/${comparable} (${((100 * sameSimple) / Math.max(1, comparable)).toFixed(1)} %) ; calcul moyen (petit réseau, fichiers en mémoire) ${Math.round(smallMs / PAIRS)} ms`,
    );
    expect(sameBest / Math.max(1, comparable)).toBeGreaterThanOrEqual(0.97);
    expect(sameSimple / Math.max(1, comparable)).toBeGreaterThanOrEqual(0.97);
  }, 3_600_000);
});
