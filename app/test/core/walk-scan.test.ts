/**
 * 1.2.10 (PRD-1.2.10 § 9.3) : balayage des chemins à pied d'une publication de nuit. 1 000 marches de 200 m à 1,5 km
 * entre vrais arrêts publiés (tuiles d'arrêts tiles/*.json), calculées sur les tuiles piétonnes (walk/) comme sur le
 * téléphone. Exigences : au moins 99 % de vrais chemins entre arrêts de Belgique (arbitré le 15/11 : l'extrait est celui
 * de la Belgique ; un arrêt à l'étranger ou au bord de l'extrait, où une tuile manque à 2 km autour, garde le chemin
 * droit prévu par le PRD § 3.8, compté à part ; au moins 98 % sur toutes les marches), calcul p95 sous 150 ms, aucun
 * virage à moins de 15 m d'un
 * autre ni dans les 20 derniers mètres, 80 Mo au plus pour toutes les tuiles et 300 ko par tuile. Le bilan est écrit
 * dans le journal (raisons des chemins droits, exemples, détours, temps à chaud et à froid).
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data), par le workflow « Données
 * de nuit » ; sans lui, ignoré. Ne bloque jamais la publication (étape continue-on-error). QUAI_SCAN_WALKS : nombre
 * de marches (1 000 par défaut).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LatLon } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { isWalkIndex, leafKeysForBox, WALK_UNIT, type WalkIndex } from '../../src/core/walk/format';
import { mergeTiles, prepareTile, type TileGraph } from '../../src/core/walk/graph';
import { routeOn, snapPoint } from '../../src/core/walk/route';
import { boxAround, MARGIN_M, WalkRouter } from '../../src/core/walk/router';
import { diskSource, metres, prng } from './walk-helpers';

const DIR = process.env.QUAI_SCAN_DATA;
const WALKS = Number(process.env.QUAI_SCAN_WALKS ?? 1000);
const BUDGET_BYTES = 80_000_000;
const MAX_TILE_BYTES = 300_000;

interface Stop extends LatLon {
  id: string;
  name: string;
}

function publishedStops(dir: string): Stop[] {
  const out = new Map<string, Stop>();
  for (const f of readdirSync(join(dir, 'tiles')).filter((x) => x.endsWith('.json'))) {
    const t = JSON.parse(readFileSync(join(dir, 'tiles', f), 'utf8')) as { areas?: { id: string; n?: { fr?: string }; lat: number; lon: number }[] };
    for (const a of t.areas ?? []) if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) out.set(a.id, { id: a.id, name: a.n?.fr ?? a.id, lat: a.lat, lon: a.lon });
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Paires d'arrêts de 200 m à 1,5 km l'un de l'autre, tirées au hasard (graine fixe). */
function pairsOf(stops: Stop[], n: number): [Stop, Stop][] {
  const cell = (p: LatLon) => `${Math.floor(p.lat / 0.01)}_${Math.floor(p.lon / 0.015)}`;
  const grid = new Map<string, Stop[]>();
  for (const s of stops) grid.set(cell(s), [...(grid.get(cell(s)) ?? []), s]);
  const rnd = prng(20261115);
  const out: [Stop, Stop][] = [];
  for (let tries = 0; out.length < n && tries < n * 50; tries++) {
    const a = stops[Math.floor(rnd() * stops.length)];
    const cy = Math.floor(a.lat / 0.01);
    const cx = Math.floor(a.lon / 0.015);
    const near: Stop[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (const b of grid.get(`${cy + dy}_${cx + dx}`) ?? []) {
          const d = metres(a, b);
          if (d >= 200 && d <= 1500) near.push(b);
        }
      }
    }
    if (near.length) out.push([a, near[Math.floor(rnd() * near.length)]]);
  }
  return out;
}

const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)] : 0);
const ms = (x: number) => `${x.toFixed(1).replace('.', ',')} ms`;
const mo = (b: number) => `${(b / 1e6).toFixed(1).replace('.', ',')} Mo`;

describe.skipIf(!DIR)('1.2.10 : balayage des chemins à pied (QUAI_SCAN_DATA)', () => {
  it('1 000 marches entre vrais arrêts : vrais chemins, temps, virages, taille', async () => {
    const dir = DIR as string;
    const walkDir = join(dir, 'walk');
    const index = JSON.parse(readFileSync(join(walkDir, 'index.json'), 'utf8')) as WalkIndex;
    expect(isWalkIndex(index), 'walk/index.json illisible').toBe(true);
    const files = readdirSync(walkDir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    const sizes = files.map((f) => ({ f, b: statSync(join(walkDir, f)).size }));
    const total = sizes.reduce((s, x) => s + x.b, 0);
    const biggest = sizes.reduce((m, x) => (x.b > m.b ? x : m), { f: '', b: 0 });
    const log: string[] = [
      `Chemins à pied : données OSM du ${index.version}, ${files.length} tuiles (${index.split.length} coupées en 4), ${mo(total)} (budget ${mo(BUDGET_BYTES)}), plus grosse ${biggest.f} ${Math.round(biggest.b / 1000)} ko (budget ${MAX_TILE_BYTES / 1000} ko)${index.nearStopsM ? `, voies limitées à ${index.nearStopsM} m des arrêts` : ''}`,
    ];
    const stops = publishedStops(dir);
    const pairs = pairsOf(stops, WALKS);
    // bord de l'extrait de Belgique (frontière, arrêts à l'étranger) : une tuile manque à 2 km autour de l'arrêt
    const have = new Set(files.map((f) => f.replace(/\.json$/, '')));
    const splitKeys = new Set(index.split);
    const edgeMemo = new Map<string, boolean>();
    const edge = (st: Stop): boolean => {
      let e = edgeMemo.get(st.id);
      if (e === undefined) {
        e = leafKeysForBox(boxAround(st, st, 2000), splitKeys).some((k) => !have.has(k));
        edgeMemo.set(st.id, e);
      }
      return e;
    };
    let inner = 0;
    let innerOsm = 0;
    const src = diskSource(walkDir);
    const router = new WalkRouter(src);
    const cold: number[] = [];
    const warm: number[] = [];
    let osm = 0;
    let turns = 0;
    let named = 0;
    let detours = 0;
    const tooClose: string[] = [];
    const lastMetres: string[] = [];
    const straight: { a: Stop; b: Stop; why: string }[] = [];
    const ratios: number[] = [];
    for (const [a, b] of pairs) {
      const interior = !edge(a) && !edge(b);
      if (interior) inner++;
      const t0 = performance.now();
      const r = (await router.route(a, b)) as WalkRoute | null;
      cold.push(performance.now() - t0);
      const t1 = performance.now();
      await router.route(a, b);
      warm.push(performance.now() - t1);
      if (!r) throw new Error('chemin null : tuiles absentes ?');
      if (r.source !== 'osm') {
        // raison : un bout sans voie à 100 m, ou pas de chemin dans les tuiles chargées
        const split = new Set(index.split);
        const tiles: TileGraph[] = [];
        for (const k of leafKeysForBox(boxAround(a, b, MARGIN_M), split)) {
          try {
            tiles.push(prepareTile(JSON.parse(readFileSync(join(walkDir, `${k}.json`), 'utf8'))));
          } catch {
            /* tuile absente */
          }
        }
        const g = tiles.length ? mergeTiles(tiles) : null;
        const why = g ? routeOn(g, a, b, 0) : 'aucune tuile';
        // un bout sans voie à 100 m : distance de la voie la plus proche (1 km au plus), pour juger des données
        const near = (p: Stop) => {
          const d = g ? snapPoint(g, p.lat / WALK_UNIT, p.lon / WALK_UNIT, 1000).any?.dist : undefined;
          return d === undefined ? 'plus de 1 km' : `${Math.round(d)} m`;
        };
        const detail = why === 'nosnap' ? ` : voie la plus proche à ${near(a)} et ${near(b)}` : '';
        straight.push({ a, b, why: `${typeof why === 'string' ? why : 'trouvé au second essai'}${detail}${interior ? '' : ', bord de l\'extrait'}` });
        continue;
      }
      osm++;
      if (interior) innerOsm++;
      const crow = metres(a, b);
      ratios.push(r.lengthM / crow);
      if (r.lengthM > 2.5 * crow + 200) detours++;
      turns += r.maneuvers.length;
      named += r.maneuvers.filter((m) => m.street).length;
      for (let i = 1; i < r.maneuvers.length; i++) {
        if (r.maneuvers[i].distM - r.maneuvers[i - 1].distM < 15) tooClose.push(`${a.name} → ${b.name}`);
      }
      if (r.maneuvers.some((m) => m.distM > r.lengthM - 20)) lastMetres.push(`${a.name} → ${b.name}`);
    }
    const n = pairs.length;
    const why = new Map<string, number>();
    for (const s of straight) {
      const k = s.why.split(/[ ,:]/)[0] === 'aucune' ? 'aucune tuile' : s.why.split(/[ ,:]/)[0];
      why.set(k, (why.get(k) ?? 0) + 1);
    }
    log.push(
      `${n} marches entre ${stops.length} arrêts publiés : ${osm} vrais chemins (${((100 * osm) / Math.max(1, n)).toFixed(2).replace('.', ',')} %), ${n - osm} chemins droits` +
        (why.size ? ` (${[...why].map(([k, v]) => `${k} ${v}`).join(', ')})` : ''),
      `Arrêts de Belgique (aucune tuile ne manque à 2 km) : ${inner} marches, ${innerOsm} vrais chemins (${((100 * innerOsm) / Math.max(1, inner)).toFixed(2).replace('.', ',')} %) ; au bord de l'extrait ou à l'étranger : ${n - inner} marches, ${osm - innerOsm} vrais chemins`,
      `Calcul à chaud : p50 ${ms(q(warm, 0.5))}, p95 ${ms(q(warm, 0.95))}, max ${ms(Math.max(0, ...warm))} ; à froid (lecture des tuiles comprise) : p50 ${ms(q(cold, 0.5))}, p95 ${ms(q(cold, 0.95))}`,
      `Virages : ${turns} (${named} avec un nom de rue), ${(turns / Math.max(1, osm)).toFixed(1).replace('.', ',')} par marche ; à moins de 15 m d'un autre : ${tooClose.length} ; dans les 20 derniers mètres : ${lastMetres.length}`,
      `Détour (chemin / vol d'oiseau) : médiane ${q(ratios, 0.5).toFixed(2).replace('.', ',')}, p95 ${q(ratios, 0.95).toFixed(2).replace('.', ',')} ; détours de plus de 2,5 fois + 200 m : ${detours}`,
    );
    for (const s of [...straight.filter((x) => !x.why.includes('bord')), ...straight.filter((x) => x.why.includes('bord'))].slice(0, 16)) log.push(`  chemin droit (${s.why}) : ${s.a.name} (${s.a.lat.toFixed(5)}, ${s.a.lon.toFixed(5)}) → ${s.b.name} (${s.b.lat.toFixed(5)}, ${s.b.lon.toFixed(5)})`);
    console.log(log.join('\n'));
    expect(n).toBeGreaterThanOrEqual(Math.min(WALKS, 100));
    expect(inner).toBeGreaterThanOrEqual(Math.ceil(0.9 * n));
    expect(innerOsm / Math.max(1, inner)).toBeGreaterThanOrEqual(0.99);
    expect(osm / n).toBeGreaterThanOrEqual(0.98);
    expect(q(warm, 0.95)).toBeLessThan(150);
    expect(tooClose).toEqual([]);
    expect(lastMetres).toEqual([]);
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(biggest.b).toBeLessThanOrEqual(MAX_TILE_BYTES);
  }, 600_000);
});
