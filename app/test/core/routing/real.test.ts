/**
 * Contrôles sur données réelles (PRD annexe A.3, design-routing.md § 5 et § 8), à la demande seulement (DECISIONS Q13) :
 *
 *   QUAI_REAL=/home/claude/real-data/data [QUAI_REAL_LINES=/home/claude/routing-proto/out] [QUAI_REAL_PAIRS=300] \
 *     npx vitest run test/core/routing/real.test.ts
 *
 * Instantané 1.1 publié par le pipeline (11/11 et 12/11) : QUAI_REAL=/home/claude/real-data-11/data (jour des requêtes :
 * le premier jour de l'instantané quand il ne couvre pas le 10/11, ou QUAI_REAL_DAY ; les requêtes de 23:10 ont besoin
 * du lendemain dans l'instantané) ; QUAI_REAL_MAXWALK=5 : contrôle large avec 5 min de marche maximale.
 * Classement : PRD-1.2.2 § 7 (le premier arrive le plus tôt, chaque minute de marche au-delà de la marche maximale
 * compte triple).
 *
 * Dossier de données temporaire : zones, recherche et tuiles de l'instantané ; fichiers de ligne et tuiles de lignes
 * du prototype (même format, même instantané) ; meta.lines ajouté ; trains/ avec les autorisations de montée et de
 * descente (-1) reprises de trainflags.json du prototype (émulation du correctif M1 du pipeline). Relais en panne :
 * horaires prévus. Les résultats (propositions, octets, temps) s'écrivent dans la console.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LineIndex, Meta, TileFile, TrainsDay } from '../../../../shared/types';
import type { Endpoint, Journey, PlanResult, Settings } from '../../../src/core/api';
import { DEFAULT_SETTINGS } from '../../../src/core/api';
import { computeRoute, type RouteDebug } from '../../../src/core/routing/engine';
import { costOf, itemOf, longestOf } from '../../../src/core/routing/rank';
import { dropNets, netMemory } from '../../../src/core/routing/repair';
import { reasonText } from '../../../src/core/routing/reason';
import { gtfsTime, hhmm, lineLabel, localDate } from '../../../src/core/util';
import { DATA_BASE, makeEnv } from '../support/env';

const REAL = process.env.QUAI_REAL ?? '';
const PROTO = process.env.QUAI_REAL_LINES ?? '/home/claude/routing-proto/out';
const PAIRS = Number(process.env.QUAI_REAL_PAIRS ?? 300);
/** Jour des requêtes (QUAI_REAL_DAY ; sinon 2026-11-10, l'instantané 1.0 du design, s'il est couvert, ou le premier jour
 *  de l'instantané). Les attentes datées (cas G, CA-M8.1, CA-M8.4) ne valent que pour l'instantané du 10/11 ; sur un
 *  autre jour, seuls les contrôles génériques tournent. */
/** Jours couverts par l'instantané (vide sans QUAI_REAL). */
const DATES: readonly string[] = (() => {
  try {
    return (JSON.parse(readFileSync(join(REAL, 'meta.json'), 'utf8')) as Meta).serviceDates;
  } catch {
    return [];
  }
})();
const DAY = process.env.QUAI_REAL_DAY || (DATES.includes('2026-11-10') || !DATES.length ? '2026-11-10' : DATES[0]);
const SNAP10 = DAY === '2026-11-10';
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, onboarded: true, maxWalkMin: 10 };
/** Contrôle large : marche maximale QUAI_REAL_MAXWALK (10 min par défaut ; 5 pour les réglages du propriétaire). */
const LARGE: Settings = { ...SETTINGS, maxWalkMin: Number(process.env.QUAI_REAL_MAXWALK ?? 10) };

let DIR = '';
let trainsFiles: Record<string, TrainsDay> = {};

function prepare(): void {
  const published = JSON.parse(readFileSync(join(REAL, 'meta.json'), 'utf8')) as Meta;
  if (published.lines && !process.env.QUAI_REAL_LINES) {
    // Données publiées par le pipeline 1.1 : fichiers de ligne et montées ou descentes interdites (-1) déjà présents.
    DIR = REAL;
    for (const date of published.serviceDates) trainsFiles[date] = JSON.parse(readFileSync(join(REAL, 'trains', `${date}.json`), 'utf8')) as TrainsDay;
    console.log(`données réelles 1.1 : ${DIR} (${published.lines.files} fichiers de ligne, jours ${published.serviceDates.join(', ')})`);
    return;
  }
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

const T = (h: number, m: number, day = DAY) => gtfsTime(day, h * 60 + m);
const pt = (lat: number, lon: number, label: string): Endpoint => ({ type: 'address', label, lat, lon });
function st(id: string): Endpoint {
  const s = trainsFiles[DAY].stations.find((x) => x.id === id);
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
  r.journeys.map((j) => `  [${j.label}] ${hhmm(j.dep)} → ${hhmm(j.arr)}${localDate(j.dep) !== DAY ? ` (${localDate(j.dep)})` : ''} « ${(j.reason ?? '').replace(/ /g, ' ')} »\n     ${legText(j)}`).join('\n') ||
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

describe.skipIf(!REAL)(`données réelles (${DAY})`, () => {
  const results = new Map<string, PlanResult>();

  beforeAll(() => {
    prepare();
  });
  afterAll(() => {
    if (DIR && DIR !== REAL) rmSync(DIR, { recursive: true, force: true });
  });

  it('24 requêtes du design § 5.2 et cas de nuit : propositions, octets, temps', async () => {
    const lines: string[] = [];
    for (const q of QUERIES) {
      const env = makeEnv({ now: q.after, scene: 'noRT', dataDir: DIR });
      dropNets();
      const t0 = performance.now();
      const r = await env.core.route(q.O(), q.D(), q.after, SETTINGS);
      const cold = performance.now() - t0;
      const kept = netMemory().bytes;
      const b = bytes(env.server.calls);
      const trainsGz = bytes(env.server.calls.filter((u) => u.includes('/trains/') || u.endsWith('/lines/index.json'))).gz;
      const t1 = performance.now();
      await env.core.route(q.O(), q.D(), q.after, SETTINGS);
      const warm = performance.now() - t1;
      results.set(q.n, r);
      lines.push(
        `=== ${q.n} (${hhmm(q.after)}) ===\n${show(r)}\n  ${b.files} fichiers, ${Math.round(b.gz / 1024)} Ko gzip à froid (${Math.round((b.gz - trainsGz) / 1024)} Ko sans trains ni index), ${Math.round(b.raw / 1024)} Ko bruts ; ${Math.round(cold)} ms à froid, ${Math.round(warm)} ms en mémoire ; réseau gardé pour refresh() : ${Math.round(kept / 1024)} Ko estimés`,
      );
      for (const j of r.journeys) {
        expect(maxWait(j)).toBeLessThanOrEqual(60);
        expect(j.transfers).toBeLessThanOrEqual(2);
      }
    }
    console.log(lines.join('\n'));
    // une requête datée hors de l'instantané (CA-M8.4 le 11/11 sur celui du 13/11) n'a pas d'horaires : pas d'attente
    for (const q of QUERIES) if (!q.n.startsWith('A.3') && DATES.includes(localDate(q.after))) expect(results.get(q.n)?.journeys.length, q.n).toBeGreaterThan(0);
  }, 600_000);

  it.skipIf(!SNAP10)('CA-M8.1 (1.2.2) : IC jusqu’à Bruxelles-Schuman, métro 1 et tram 10 d’abord, l’IC et le bus 95 en « Moins de changements », jamais Bruxelles-Chapelle ; une proposition à 23:50 pour le lendemain', () => {
    const r = results.get('19 CA-M8.1 Maison → Bureau 07:31');
    // 1.2.2 (PRD-1.2.2 § 7) : par Schuman, 08:54 et 2 changements (coût 08:56), contre 08:56 et 1 changement par
    // Bruxelles-Luxembourg et le bus 95 (coût 08:57), proposé en « Moins de changements » ; comme sur l'instantané 1.1
    // (CA-1.9). L'IC jusqu'à Bruxelles-Central puis 12 min à pied n'est toujours pas proposé.
    const rides = (j?: Journey) => j?.legs.filter((l) => l.kind === 'ride').map((l) => `${l.cat ?? l.line} ${l.to.name.fr}`);
    expect(rides(r?.journeys[0])).toEqual(['IC Bruxelles-Schuman', '1 De Brouckère', '10 Anneessens']);
    expect(r?.journeys[1]?.label).toBe('fewer');
    expect(rides(r?.journeys[1])).toEqual(['IC Bruxelles-Luxembourg', '95 Grand-Place']);
    for (const x of r?.journeys ?? []) expect(x.legs.some((l) => l.to.areaId === 'sncb:8812104' || l.from.areaId === 'sncb:8812104')).toBe(false);
    const night = results.get('20 CA-M8.1 Maison → Bureau 23:50');
    expect(night?.journeys.length).toBeGreaterThan(0);
    expect(localDate(night?.journeys[0].legs.find((l) => l.kind === 'ride')?.dep ?? 0)).toBe('2026-11-11');
  });

  it.skipIf(!SNAP10)('cas G (1.2.2) : la nuit, l’arrivée la plus tôt d’abord (S19 05:02, métro 1 et 6), puis « Le suivant » : le S1 direct de 06:20', () => {
    const r = results.get('21 cas G : Waterloo → Bruxelles-Midi 23:50');
    // 1.2.2 (PRD-1.2.2 § 7) : 05:58 et 2 changements (coût 06:00) avant le S1 direct de 06:20, qui arrive plus de
    // 15 min après : pas de « Sans changement ». Garde (§ 7.4) : le S1 de 06:20 (06:46, direct) domine le S19 de 06:02
    // et ses deux métros (06:58) : il est « Le suivant » ; le S19 de 07:02 l'est par le S1 de 07:20, au-delà de 2 h
    expect(r?.journeys[0]).toMatchObject({ label: 'short', transfers: 2 });
    expect(hhmm(r?.journeys[0].legs[0].dep ?? 0)).toBe('05:02');
    expect(hhmm(r?.journeys[0].arr ?? 0)).toBe('05:58');
    expect(r?.journeys.slice(1).map((j) => `${j.label} ${hhmm(j.dep)} → ${hhmm(j.arr)} ${j.transfers}`)).toEqual(['next 06:20 → 06:46 0']);
    for (const j of r?.journeys ?? []) expect(localDate(j.dep)).toBe('2026-11-11');
  });

  it('CA-M5.8 : Namur → Saint-Nicolas par Bruxelles (deux correspondances), pas par Lille', () => {
    const j = results.get('22 CA-M5.8 Namur → Saint-Nicolas')?.journeys[0];
    expect(j?.transfers).toBe(2);
    expect(j?.legs.some((l) => /Bruxelles/.test(l.to.name.fr))).toBe(true);
    expect(j?.legs.some((l) => /Lille/.test(`${l.to.name.fr} ${l.from.name.fr}`))).toBe(false);
  });

  it.skipIf(!SNAP10)('CA-M8.4 : Liège-Guillemins → Bruxelles-Nord le 11/11 à 09:10 : aucun train de nuit, IC 09:27', () => {
    const r = results.get('23 CA-M8.4 Liège-Guillemins → Bruxelles-Nord 11/11');
    expect(r?.journeys.some((j) => j.legs.some((l) => l.cat === 'NJ' || l.cat === 'EN'))).toBe(false);
    expect(hhmm(r?.journeys[0].legs[0].dep ?? 0)).toBe('09:27');
  });

  it('nuit (A.3) : LLN Grand-Place → Namur à 23:50 : aucune attente de plus de 60 min', () => {
    const r = results.get('A.3 nuit : LLN Grand-Place → Namur 23:50');
    for (const j of r?.journeys ?? []) expect(maxWait(j)).toBeLessThanOrEqual(60);
  });

  it(`contrôle « réseau complet » : ${PAIRS} paires, au moins 97 % de meilleures arrivées identiques et de propositions 1 aussi bonnes ; jamais une proposition 1 dominée ni une marche absurde (PRD-1.2.2 § 7)`, async () => {
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
    // PRD-1.2.2 § 7 : parmi les candidats de l'heure demandée (marche seule de 30 min au plus comprise), la proposition 1
    // n'est jamais dominée (arrivée, plus longue marche, changements) ni une marche absurde (plus de M + 5 min à pied
    // alors qu'un trajet sans marche de plus de M arrive au plus 15 min après) ; combien ne sont pas la plus tôt
    const maxWalk = LARGE.maxWalkMin;
    const guard = { checked: 0, notEarliest: 0, worst: 0, overMax: 0 };
    const bad: string[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const c1 = centres[Math.floor(rnd() * centres.length)];
      const c2 = rnd() < 0.35 ? centres[Math.floor(rnd() * centres.length)] : c1;
      const o = jitter(c1[1], c1[2], c1[3]);
      const d = jitter(c2[1], c2[2], c2[3]);
      const hm = [7 * 60 + 30, 8 * 60 + 15, 12 * 60, 17 * 60 + 20, 20 * 60 + 40][Math.floor(rnd() * 5)];
      const after = gtfsTime(DAY, hm);
      const O = pt(o.lat, o.lon, 'O');
      const D = pt(d.lat, d.lon, 'D');
      const dbgS: RouteDebug = { cands: [], raw: [], files: 0, computeMs: 0, mode: 'lines' };
      const dbgF: RouteDebug = { cands: [], raw: [], files: 0, computeMs: 0, mode: 'lines' };
      const t0 = performance.now();
      const rs = await computeRoute(O, D, after, LARGE, null, { ...env(false), now: () => after }, dbgS);
      smallMs += performance.now() - t0;
      const rf = await computeRoute(O, D, after, LARGE, null, { ...env(true), now: () => after }, dbgF);
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
      // candidats partis dans l'heure demandée (marche seule de 30 min au plus comprise)
      const inHour = dbgS.cands.map(itemOf).filter((x) => x.dep <= after / 60_000 + 60 && (x.rides > 0 || x.walk <= 30));
      if (inHour.length) {
        const first = itemOf(rs.journeys[0]);
        const lw = longestOf(first);
        const E = Math.min(...inHour.map((x) => x.arr));
        const late = Math.round(first.arr - E);
        guard.checked++;
        guard.worst = Math.max(guard.worst, late);
        if (late > 0) guard.notEarliest++;
        if (lw > maxWalk) guard.overMax++;
        const where = `${c1[0]}→${c2[0]} #${i} ${hhmm(after)} : proposition 1 ${hhmm(first.dep * 60_000)} → ${hhmm(first.arr * 60_000)}`;
        for (const x of inHour) {
          const xl = longestOf(x);
          if (x.arr <= first.arr && xl <= lw && x.transfers <= first.transfers && (x.arr < first.arr || xl < lw || x.transfers < first.transfers)) bad.push(`${where} dominée`);
          if (lw > maxWalk + 5 && xl <= maxWalk && x.arr <= first.arr + 15) bad.push(`${where} : ${lw} min à pied, marche absurde`);
        }
      }
      const afterMin = (after - gtfsTime(DAY, 0)) / 60_000;
      const usable = (x: RouteDebug['raw'][number]) => x.wait <= 60 && x.dep >= afterMin;
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
      // proposition 1 du petit réseau aussi bonne que celle du réseau complet, à 5 min de coût près (PRD-1.2.2 § 7)
      const s1 = itemOf(rs.journeys[0]);
      const s2 = rf.journeys.length ? itemOf(rf.journeys[0]) : s1;
      if (s1.id === s2.id || costOf(s1, maxWalk) < costOf(s2, maxWalk) + 5) sameSimple++;
      else gaps.push(`   proposition 1 : ${hhmm(rs.journeys[0].dep)} → ${hhmm(rs.journeys[0].arr)} contre ${hhmm(rf.journeys[0].dep)} → ${hhmm(rf.journeys[0].arr)}`);
    }
    console.log(
      `${gaps.join('\n')}\n${PAIRS} paires (marche maximale ${maxWalk} min) ; comparables ${comparable} ; aucune proposition des deux côtés ${none} ; seul le réseau complet trouve ${onlyFull}\n` +
        `meilleures arrivées identiques (1, 2, 3 véhicules) : ${sameBest}/${comparable} (${((100 * sameBest) / Math.max(1, comparable)).toFixed(1)} %) ; proposition 1 : ${sameSimple}/${comparable} (${((100 * sameSimple) / Math.max(1, comparable)).toFixed(1)} %) ; calcul moyen (petit réseau, fichiers en mémoire) ${Math.round(smallMs / PAIRS)} ms\n` +
        `PRD-1.2.2 § 7 : ${guard.checked} propositions 1 contrôlées ; plus longue marche au-delà de la marche maximale : ${guard.overMax} ; pas la plus tôt : ${guard.notEarliest} ; au plus ${guard.worst} min après la plus tôt\n${bad.join('\n')}`,
    );
    expect(sameBest / Math.max(1, comparable)).toBeGreaterThanOrEqual(0.97);
    expect(sameSimple / Math.max(1, comparable)).toBeGreaterThanOrEqual(0.97);
    expect(bad).toEqual([]);
  }, 3_600_000);
});

/**
 * PRD-1.2 § 5, CA-1.7 à CA-1.11, revus pour la 1.2.1 (le moins de marche d'abord, noms et raisons du § 2), et
 * PRD-1.2.1 CA-121.1 (cas réels du § 1.5, marche maximale 5 min) : contrôles ciblés sur l'instantané 1.1 publié par le
 * pipeline (fichiers de ligne compris), 11/11 et jeudi 12/11, relais en panne. Tournent dès que QUAI_REAL désigne un tel
 * instantané (QUAI_REAL=/home/claude/real-data-11/data ; dates fixées dans chaque test).
 */
const SNAP11 = (() => {
  if (!REAL || !existsSync(join(REAL, 'meta.json'))) return false;
  const m = JSON.parse(readFileSync(join(REAL, 'meta.json'), 'utf8')) as Meta;
  return !!m.lines && m.serviceDates.includes('2026-11-11') && m.serviceDates.includes('2026-11-12');
})();

describe.skipIf(!SNAP11)('classement 1.2.2 sur l’instantané 1.1 (PRD-1.2 CA-1.7 à CA-1.11, PRD-1.2.1 CA-121.1, PRD-1.2.2 § 7)', () => {
  const MADOU = pt(50.8504, 4.3707, 'Madou');
  const MAISON = pt(50.4655, 4.859, 'Maison');
  const BUREAU = pt(50.8441, 4.3474, 'Bureau');
  const BRAINE = pt(50.68634, 4.39427, 'Braine-l’Alleud Côté du Collège');
  const at = (day: string, h: number, m: number) => gtfsTime(day, h * 60 + m);
  async function route(O: Endpoint, D: Endpoint, after: number, maxWalkMin = 10): Promise<PlanResult> {
    const env = makeEnv({ now: after, scene: 'noRT', dataDir: REAL });
    return env.core.route(O, D, after, { ...SETTINGS, maxWalkMin });
  }
  const summary = (r: PlanResult) => r.journeys.map((j) => `${j.label} ${hhmm(j.dep)} → ${hhmm(j.arr)}`);
  const reason = (j: Journey) => (j.reason ?? '').replace(/\u00A0/g, ' ');
  const lines = (j: Journey) => j.legs.filter((l) => l.kind === 'ride').map((l) => `${l.cat ?? l.line} ${l.from.name.fr} → ${l.to.name.fr}`);
  const bus36 = (j: Journey) => j.legs.some((l) => l.kind === 'ride' && l.line === '36' && /Rixensart/.test(l.to.name.fr));

  it('CA-1.7 : Waterloo → Madou, 12/11 07:31 : bus W, IC depuis Braine-l’Alleud, métro 2 ; le P à 19 min « Plus tôt » ; jamais le S1 vers Congrès', async () => {
    const r = await route(pt(50.7175, 4.399, 'Waterloo'), MADOU, at('2026-11-12', 7, 31));
    expect(summary(r)).toEqual(['short 07:34 → 08:33', 'earlier 07:29 → 08:27', 'next 07:51 → 09:01']);
    // 1.2.1 § 2 : « Plus tôt » marche plus (19 min) : la proposition 1 s'appelle « Moins de marche »
    expect(reason(r.journeys[0])).toBe('Moins de marche : 2 changements, 8 min à pied');
    expect(lines(r.journeys[0])).toEqual(["W Waterloo Eglise → Braine-l'Alleud, Gare", "IC Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
    expect(reason(r.journeys[1])).toBe('Plus tôt de 6 min, mais 19 min à pied');
    expect(r.journeys.some((j) => j.legs.some((l) => l.to.areaId === 'sncb:8813045'))).toBe(false);
  });

  it('CA-1.8 : Namur Place Léopold → Madou, 07:31 : IC jusqu’à Bruxelles-Luxembourg, bus 12, métro 2 ; « Moins de changements »', async () => {
    const r = await route(MAISON, MADOU, at('2026-11-12', 7, 31));
    expect(summary(r)).toEqual(['short 07:34 → 08:44', 'fewer 07:34 → 08:52', 'next 08:06 → 09:18']);
    expect(r.journeys.map(reason).slice(0, 2)).toEqual(['Le plus court : 2 changements, à pied 8 + 1 + 2 min', 'Moins de changements : 1 changement, à pied 8 + 2 + 10 min']);
    expect(lines(r.journeys[0])).toEqual(['IC Namur → Bruxelles-Luxembourg', '12 Luxembourg → Trône', '2 Trône → Madou']);
    // « Le suivant » (garde, PRD-1.2.2 § 7.4) : l'IC suivant puis le bus 64 (09:18), qui domine le bus 12 (09:30)
    expect(lines(r.journeys[2])).toEqual(['IC Namur → Bruxelles-Luxembourg', '64 Luxembourg → Trône', '2 Trône → Madou']);
  });

  it('CA-1.9 : Maison → Bureau et → Rue Neuve 1, 07:31 : par Schuman ou Bruxelles-Luxembourg ; vers Rue Neuve, le direct « Sans changement »', async () => {
    const b = await route(MAISON, BUREAU, at('2026-11-12', 7, 31));
    // 1.2.2 : par Schuman, métro 1 et tram 10, 2 min plus tôt que l'IC et le bus 95 (« Moins de changements ») ; le
    // direct puis 12 min à pied (2 min de trop) arrive 8 min après : jamais « Sans changement »
    expect(summary(b)).toEqual(['short 07:34 → 08:54', 'fewer 07:34 → 08:56', 'next 08:06 → 09:25']);
    expect(lines(b.journeys[0])).toEqual(['IC Namur → Bruxelles-Schuman', '1 Schuman → De Brouckère', '10 De Brouckère → Anneessens']);
    expect(reason(b.journeys[0])).toBe('Le plus court : 2 changements, à pied 8 + 2 + 3 min');
    expect(lines(b.journeys[1])).toEqual(['IC Namur → Bruxelles-Luxembourg', '95 Luxembourg → Grand-Place']);
    expect(reason(b.journeys[1])).toBe('Moins de changements : 1 changement, à pied 8 + 1 + 6 min');
    const n = await route(MAISON, pt(50.8505, 4.3545, 'Rue Neuve 1'), at('2026-11-12', 7, 31));
    expect(summary(n).slice(0, 2)).toEqual(['short 07:34 → 08:49', 'none 07:34 → 09:02']);
    expect(lines(n.journeys[0])).toEqual(['IC Namur → Bruxelles-Schuman', '1 Schuman → De Brouckère']);
  });

  it('CA-1.10 : Braine-l’Alleud Côté du Collège → Madou : jamais le bus 36 vers Rixensart (11/11 13:30, marche 5 et 10) ; 12/11 07:31', async () => {
    for (const m of [5, 10]) {
      const r = await route(BRAINE, MADOU, at('2026-11-11', 13, 30), m);
      expect(summary(r)[0], `marche ${m}`).toBe('short 13:39 → 14:47');
      // PRD-1.2.1 § 2 : « Plus tôt » (22 min à pied et l'IC) marche plus : « Moins de marche »
      expect(reason(r.journeys[0])).toBe('Moins de marche : 1 changement, à pied 8 + 1 + 2 min');
      expect(lines(r.journeys[0])).toEqual(['W Braine-l’Alleud Bonne Fosse → Saint-Gilles Porte de Hal Metro', '2 Porte de Hal → Madou']);
      expect(r.journeys.some(bus36)).toBe(false);
    }
    const r = await route(BRAINE, MADOU, at('2026-11-12', 7, 31));
    expect(summary(r)[0]).toBe('short 07:49 → 08:33');
    expect(reason(r.journeys[0])).toBe('Le plus court : 2 changements, à pied 4 + 3 + 2 min');
    expect(lines(r.journeys[0])).toEqual(['36 Braine-l’Alleud Côté du Collège → Braine-l’Alleud Vallée Bailly', "IC Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
  });

  it('CA-1.11 : nuit, Maison → Bureau le 11/11 à 23:50 : S8, métro 1, tram 4 ; S8 et tram 10 « Moins de changements »', async () => {
    const r = await route(MAISON, BUREAU, at('2026-11-11', 23, 50));
    // 1.2.1 § 1.4 : le direct puis 12 min à pied (palier 1, 05:46) arrive plus tard : remplacé par le S8 jusqu'à
    // Bruxelles-Nord et le tram 10 (palier 0, 05:42)
    expect(summary(r).slice(0, 2)).toEqual(['short 04:10 → 05:37', 'fewer 04:10 → 05:42']);
    expect(lines(r.journeys[0])).toEqual(['S8 Namur → Bruxelles-Schuman', '1 Schuman → De Brouckère', '4 De Brouckère → Anneessens']);
    expect(reason(r.journeys[1])).toBe('Moins de changements : 1 changement, à pied 8 + 2 + 3 min');
    expect(reasonText('fewer', r.journeys[1])).toBe(r.journeys[1].reason);
  });

  it('CA-121.1 et PRD-1.2.2 § 7 : les trois cas réels du PRD-1.2.1 § 1.5 (marche maximale 5 min)', async () => {
    // Arrêts publics seulement (jamais d'adresse personnelle dans le dépôt). Braine-l'Alleud → Schaerbeek, 11/11 19:42 :
    // bus W puis S1 ; les 22 min à pied, IC 20:08, IC 20:33 seulement en « Plus tôt »
    const mama = await route(BRAINE, pt(50.87755, 4.37966, 'Schaerbeek Gare'), at('2026-11-11', 19, 42), 5);
    // « Le suivant » (garde, PRD-1.2.2 § 7.4) : le bus W puis le tram 92 (20:39 → 22:01), qui domine le bus W puis le
    // S1 suivant (20:27 → 22:05)
    expect(summary(mama)).toEqual(['short 19:57 → 21:05', 'earlier 19:44 → 20:52', 'next 20:39 → 22:01']);
    expect(lines(mama.journeys[0]).map((x) => x.split(' ')[0])).toEqual(['W', 'S1']);
    expect(lines(mama.journeys[2]).map((x) => x.split(' ')[0])).toEqual(['W', '92']);
    expect(mama.journeys[1].legs.filter((l) => l.kind === 'ride').map((l) => `${l.cat} ${hhmm(l.dep)}`)).toEqual(['IC 20:08', 'IC 20:33']);
    expect(mama.journeys.map(reason).slice(0, 2)).toEqual(['Moins de marche : 1 changement, à pied 8 + 1 + 3 min', 'Plus tôt de 13 min, mais 22 min à pied']);
    for (const j of mama.journeys) if (j.label !== 'earlier') expect(Math.max(...j.legs.map((l) => (l.kind === 'walk' ? (l.walkMin ?? 0) : 0)))).toBeLessThan(15);
    // Braine-l'Alleud → Madou, 12/11 07:31 : bus 36, IC 08:01, métro 2
    const bureau = await route(BRAINE, MADOU, at('2026-11-12', 7, 31), 5);
    expect(summary(bureau)[0]).toBe('short 07:49 → 08:33');
    expect(lines(bureau.journeys[0]).map((x) => x.split(' ')[0])).toEqual(['36', 'IC', '2']);
    expect(hhmm(bureau.journeys[0].legs.find((l) => l.cat === 'IC')!.dep)).toBe('08:01');
    // « Plus tard » : bus 36 de 07:54, S1 08:06, métro 2 (3 min à pied au plus), pas le S1 après 22 min à pied ;
    // l'IC après 22 min à pied (même arrivée) marche plus au-delà de la marche maximale : jamais « Moins de changements »
    expect(summary(bureau).slice(1)).toEqual(['later 07:54 → 08:50', 'later 08:14 → 09:01']);
    expect(bureau.journeys[1].legs.filter((l) => l.kind === 'ride').map((l) => `${l.cat ?? l.line} ${hhmm(l.dep)}`)).toEqual(['36 07:54', 'S1 08:06', '2 08:39']);
    expect(Math.max(...bureau.journeys[1].legs.map((l) => (l.kind === 'walk' ? (l.walkMin ?? 0) : 0)))).toBe(3);
    // Braine-l'Alleud Côté du Collège → Madou, 11/11 13:30 : bus W, métro 2 ; « Plus tôt » : 22 min à pied et l'IC
    const braine = await route(BRAINE, MADOU, at('2026-11-11', 13, 30), 5);
    expect(summary(braine).slice(0, 2)).toEqual(['short 13:39 → 14:47', 'earlier 13:44 → 14:39']);
    expect(braine.journeys[1].legs[0]).toMatchObject({ kind: 'walk', walkMin: 22 });
    expect(reason(braine.journeys[1])).toBe('Plus tôt de 8 min, mais 22 min à pied');
    expect(braine.journeys.some(bus36)).toBe(false);
    for (const r of [mama, bureau, braine]) for (const j of r.journeys) expect((j.reason ?? '').length).toBeLessThanOrEqual(60);
  });
});
