/**
 * Fichiers du calcul et choix des lignes (design-routing.md § 4.1 à § 4.4).
 *
 * Vague 1 : lines/index.json, tiles/ et linetiles/ autour du départ (O) et de l'arrivée (D).
 * Vague 2 : lignes L_O et L_D (zones urbaines de la recherche élargie, 15 min à pied, de la plus proche à la plus
 *           lointaine, 60 lignes au plus par côté) ; trains/ des jours utiles (fait par l'appelant, en parallèle).
 * Rayons (PRD-1.2 § 1.2) : arrêts urbains jusqu'à 15 min à pied, gares jusqu'à 25 min, quel que soit le réglage.
 * Vague 3 : lignes du milieu (10 au plus) choisies par une estimation : lignes qui relient une zone en aval de L_O
 *           (ou en amont de L_D) à une gare d'où part un train direct vers le côté D (ou qui arrive du côté O),
 *           durées réelles des trains directs du fichier trains/ ; en plus (PRD-1.2.2 § 7, correctif 2), les lignes
 *           de métro dont une gare desservie est à 10 km au plus d'une extrémité (backboneLines : à Bruxelles, les
 *           métros 1, 2, 5 et 6 de la STIB ; à Charleroi, celui du TEC), que les estimations ne prennent pas toujours.
 * Une génération à la fois : l'index doit être celui de meta.generatedAt (quand il le dit) et chaque fichier de
 * ligne celui que l'index annonce.
 */
import type { AreaSummary, LineFile, LineIndex, LineTile, Meta, Mode, TileFile, TrainsDay } from '../../../../shared/types';
import { tileKeysAround } from '../areas';
import { QuaiError } from '../errors';
import { distanceM, walkMinutes } from '../util';
import { patternFlags } from './network';
import { P, walkReachM, type WalkRadii } from './params';

export interface RoutingSource {
  meta: Meta;
  tile(key: string): Promise<TileFile | null>;
  json<T>(path: string, valid: (x: unknown) => x is T): Promise<T | null>;
  trains(date: string): Promise<TrainsDay | null>;
}

export interface Point {
  lat: number;
  lon: number;
  areaId?: string;
}

export interface NearZone {
  a: AreaSummary;
  d: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export const isLineIndex = (x: unknown): x is LineIndex =>
  isObj(x) && x.v === 1 && Array.isArray(x.lines) && isObj(x.stations) && typeof x.conn === 'number';
export const isLineTile = (x: unknown): x is LineTile => isObj(x) && isObj(x.a);
export const isLineFile = (x: unknown): x is LineFile =>
  isObj(x) && typeof x.id === 'string' && typeof x.op === 'string' && Array.isArray(x.areas) && Array.isArray(x.pats) && Array.isArray(x.conn);

/**
 * Fichier facultatif du calcul : absent ou illisible → null (la ligne ou la tuile manque, le calcul continue) ;
 * serveur injoignable → l'erreur remonte (« Horaires injoignables : nouvel essai dans 30 s »).
 */
export function soft<T>(p: Promise<T | null>): Promise<T | null> {
  return p.catch((e: unknown) => {
    if (e instanceof QuaiError && e.code === 'dataUnreachable') throw e;
    return null;
  });
}

/** Chemin du fichier d'une ligne de l'index : lines/{op}/{routeKey}.json. */
export function linePath(key: string): string | null {
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const op = key.slice(0, i);
  const route = key.slice(i + 1);
  if (!route || !['stib', 'delijn', 'tec'].includes(op)) return null;
  return `lines/${op}/${route.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
}

/** Zones des tuiles autour d'un point, à `radiusM` au plus, de la plus proche à la plus lointaine. */
export function zonesFrom(tiles: (TileFile | null)[], pt: Point, radiusM: number): NearZone[] {
  const seen = new Set<string>();
  const out: NearZone[] = [];
  for (const t of tiles) {
    for (const a of t?.areas ?? []) {
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      const d = distanceM(pt, a);
      if (d <= radiusM || a.id === pt.areaId) out.push({ a, d: a.id === pt.areaId ? 0 : d });
    }
  }
  return out.sort((x, y) => x.d - y.d || (x.a.id < y.a.id ? -1 : 1));
}

/** Lignes des zones urbaines proches (linetiles), de la plus proche à la plus lointaine, `max` au plus. */
export function pickLines(near: readonly NearZone[], lt: Map<string, number[]>, radiusM: number, max: number = P.maxLinesPerSide): number[] {
  const lines: number[] = [];
  const seen = new Set<number>();
  for (const { a, d } of near) {
    if (a.op === 'sncb' || d > radiusM) continue;
    for (const li of lt.get(a.id) ?? []) {
      if (seen.has(li)) continue;
      seen.add(li);
      lines.push(li);
      if (lines.length >= max) return lines;
    }
  }
  return lines;
}

export interface Wave1 {
  index: LineIndex | null;
  nearO: NearZone[];
  nearD: NearZone[];
  ltO: Map<string, number[]>;
  ltD: Map<string, number[]>;
}

/** Vague 1 : index des lignes, tuiles et tuiles de lignes autour de O et de D (en parallèle). */
export async function wave1(src: RoutingSource, O: Point, D: Point, R: WalkRadii, withLines: boolean): Promise<Wave1> {
  const tile = src.meta.tile;
  const rLong = walkReachM(Math.max(R.station, R.urban));
  const r15 = walkReachM(R.urban);
  const tO = tileKeysAround(O.lat, O.lon, rLong, tile);
  const tD = tileKeysAround(D.lat, D.lon, rLong, tile);
  const lO = withLines ? tileKeysAround(O.lat, O.lon, r15, tile) : [];
  const lD = withLines ? tileKeysAround(D.lat, D.lon, r15, tile) : [];
  const tileKeys = [...new Set([...tO, ...tD])];
  const lineKeys = [...new Set([...lO, ...lD])];
  const [index, tiles, ltiles] = await Promise.all([
    withLines ? soft(src.json('lines/index.json', isLineIndex)) : Promise.resolve(null),
    Promise.all(tileKeys.map((k) => soft(src.tile(k)))),
    Promise.all(lineKeys.map((k) => soft(src.json(`linetiles/${k}.json`, isLineTile)))),
  ]);
  const tileOf = new Map(tileKeys.map((k, i) => [k, tiles[i]]));
  const ltOf = new Map(lineKeys.map((k, i) => [k, ltiles[i]]));
  const merge = (keys: string[]) => {
    const m = new Map<string, number[]>();
    for (const k of keys) for (const [id, l] of Object.entries(ltOf.get(k)?.a ?? {})) if (Array.isArray(l)) m.set(id, l);
    return m;
  };
  return {
    index,
    nearO: zonesFrom(tO.map((k) => tileOf.get(k) ?? null), O, rLong),
    nearD: zonesFrom(tD.map((k) => tileOf.get(k) ?? null), D, rLong),
    ltO: merge(lO),
    ltD: merge(lD),
  };
}

/** Charge des lignes de l'index (en parallèle) ; un fichier absent ou d'une autre génération est ignoré. */
export async function loadLines(src: RoutingSource, index: LineIndex, list: readonly number[]): Promise<Map<number, LineFile>> {
  const files = await Promise.all(
    list.map(async (li) => {
      const key = index.lines[li]?.[0];
      const path = key ? linePath(key) : null;
      if (!path) return null;
      const f = await soft(src.json(path, isLineFile));
      return f && f.id === key ? f : null;
    }),
  );
  const out = new Map<number, LineFile>();
  list.forEach((li, i) => {
    const f = files[i];
    if (f) out.set(li, f);
  });
  return out;
}

interface Est {
  t: number;
  lat: number;
  lon: number;
}

/** Grille simple pour trouver les points à moins de `r` mètres. */
class PointGrid<T extends { lat: number; lon: number }> {
  private readonly cells = new Map<string, T[]>();
  constructor(private readonly cell = 0.005) {}
  add(p: T): void {
    const k = `${Math.floor(p.lat / this.cell)}:${Math.floor(p.lon / (this.cell * 1.5))}`;
    let l = this.cells.get(k);
    if (!l) this.cells.set(k, (l = []));
    l.push(p);
  }
  near(pt: { lat: number; lon: number }, r: number, cb: (p: T, d: number) => void): void {
    const cy = Math.floor(pt.lat / this.cell);
    const cx = Math.floor(pt.lon / (this.cell * 1.5));
    const ry = Math.ceil(r / 111_320 / this.cell);
    const rx = Math.ceil(r / (111_320 * Math.max(0.1, Math.cos((pt.lat * Math.PI) / 180))) / (this.cell * 1.5));
    for (let y = cy - ry; y <= cy + ry; y++)
      for (let x = cx - rx; x <= cx + rx; x++)
        for (const p of this.cells.get(`${y}:${x}`) ?? []) {
          const d = distanceM(pt, p);
          if (d <= r) cb(p, d);
        }
  }
}

export interface MiddleInput {
  index: LineIndex;
  O: Point;
  D: Point;
  /** Rayons de marche (PRD-1.2 § 1.2). */
  radii: WalkRadii;
  nearO: readonly NearZone[];
  nearD: readonly NearZone[];
  LO: readonly number[];
  LD: readonly number[];
  files: Map<number, LineFile>;
  /** Trains du jour de la recherche (durées réelles des trains directs). */
  day: TrainsDay | null;
  K?: number;
  urbanUrbanMax?: number;
  /** Lignes déjà chargées par ailleurs (métros, backboneLines) : jamais comptées parmi les K. */
  skip?: ReadonlySet<number>;
}

/**
 * Lignes de métro (P.backboneModes) dont une gare desservie (LineIndex.stations : à 400 m au plus de la ligne) est à
 * `radiusM` au plus d'une extrémité (PRD-1.2.2 § 7, correctif 2). Ceria → Braine-l'Alleud le samedi : le métro 5
 * (ligne de Ceria) puis le métro 6 jusqu'à Bruxelles-Midi et le bus de la SNCB ; le métro 6 n'était chargé ni comme
 * ligne d'une extrémité ni comme ligne du milieu.
 */
export function backboneLines(index: LineIndex, day: TrainsDay | null, ends: readonly Point[], radiusM: number = P.backboneKm * 1000): number[] {
  if (!day) return [];
  const backbone = index.lines.map((l) => P.backboneModes.includes(l?.[2]));
  const at = new Map(day.stations.map((s) => [s.id, s]));
  const out = new Set<number>();
  for (const [id, lines] of Object.entries(index.stations)) {
    if (!Array.isArray(lines) || !lines.some((li) => backbone[li])) continue;
    const st = at.get(id);
    if (!st || !ends.some((e) => distanceM(e, st) <= radiusM)) continue;
    for (const li of lines) if (backbone[li]) out.add(li);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Lignes du milieu (design § 4.4) : pour les trajets à trois véhicules dont le véhicule du milieu n'est ni une ligne
 * de O, ni une ligne de D, ni un train (urbain, urbain, train et train, urbain, urbain ; urbain, urbain, urbain si
 * deux correspondances urbaines sont permises). Les K meilleures estimations, quotas 60 % / 40 % dans le cas général.
 */
export function middleLines(m: MiddleInput): number[] {
  const K = m.K ?? P.middleK;
  if (K <= 0) return [];
  const uu = m.urbanUrbanMax ?? P.urbanUrbanMax;
  const r15 = walkReachM(m.radii.urban);
  const accessW = new Map<string, number>();
  for (const { a, d } of m.nearO) if (d <= r15 || a.op === 'sncb' || a.id === m.O.areaId) accessW.set(a.id, a.id === m.O.areaId ? 0 : walkMinutes(d));
  const egressW = new Map<string, number>();
  for (const { a, d } of m.nearD) if (d <= r15 || a.op === 'sncb' || a.id === m.D.areaId) egressW.set(a.id, a.id === m.D.areaId ? 0 : walkMinutes(d));

  // estimations : depuis O le long de L_O (eO), vers D le long de L_D (eD)
  const eO = new Map<string, Est & { conn: number[] }>();
  const eD = new Map<string, Est & { conn: number[] }>();
  const setMin = (map: typeof eO, f: LineFile, la: number, t: number) => {
    const area = f.areas[la];
    if (!area) return;
    const c = map.get(area[0]);
    if (!c || t < c.t) map.set(area[0], { t, lat: area[1], lon: area[2], conn: f.conn[la] ?? [] });
  };
  for (const li of m.LO) {
    const f = m.files.get(li);
    if (!f) continue;
    for (const p of f.pats) {
      const prof = p.prof?.[0];
      const n = p.a.length;
      if (!prof || prof.length !== n) continue;
      const fl = patternFlags(p.f, n);
      let base = Infinity;
      for (let pos = 0; pos < n; pos++) {
        const la = p.a[pos];
        if (base < Infinity && (fl[pos] === 'a' || fl[pos] === 'x')) setMin(eO, f, la, base + prof[pos] + P.estWait);
        const w = accessW.get(f.areas[la]?.[0] ?? '');
        if (w !== undefined && (fl[pos] === 'b' || fl[pos] === 'x')) base = Math.min(base, w - prof[pos]);
      }
    }
  }
  for (const li of m.LD) {
    const f = m.files.get(li);
    if (!f) continue;
    for (const p of f.pats) {
      const prof = p.prof?.[0];
      const n = p.a.length;
      if (!prof || prof.length !== n) continue;
      const fl = patternFlags(p.f, n);
      let base = Infinity;
      for (let pos = n - 1; pos >= 0; pos--) {
        const la = p.a[pos];
        if (base < Infinity && (fl[pos] === 'b' || fl[pos] === 'x')) setMin(eD, f, la, base - prof[pos] + P.estWait);
        const w = egressW.get(f.areas[la]?.[0] ?? '');
        if (w !== undefined && (fl[pos] === 'a' || fl[pos] === 'x')) base = Math.min(base, w + prof[pos]);
      }
    }
  }
  const have = new Set([...m.files.keys(), ...(m.skip ?? [])]);
  const candO = new Map<number, Est[]>();
  const candD = new Map<number, Est[]>();
  for (const v of eO.values()) for (const li of v.conn) if (!have.has(li)) (candO.get(li) ?? candO.set(li, []).get(li)!).push(v);
  for (const v of eD.values()) for (const li of v.conn) if (!have.has(li)) (candD.get(li) ?? candD.set(li, []).get(li)!).push(v);

  const est: { li: number; cost: number; od: boolean }[] = [];
  const modeOf = (li: number): Mode => m.index.lines[li]?.[2] ?? 'bus';
  const consider = (li: number, A: readonly Est[], B: readonly Est[], od: boolean) => {
    let best = Infinity;
    const speed = P.speedKmh[modeOf(li)] ?? 18;
    for (const a of A)
      for (const b of B) {
        const ride = ((distanceM(a, b) * 1.3) / 1000 / speed) * 60;
        best = Math.min(best, a.t + ride + b.t + 4);
      }
    if (best < Infinity) est.push({ li, cost: best, od });
  };
  for (const [li, A] of candO) {
    const B = candD.get(li);
    if (B) consider(li, A, B, true);
  }

  // gares côté O et côté D, durées des trains directs
  if (m.day) {
    const stations = m.day.stations;
    const gO = new PointGrid<Est>();
    const gD = new PointGrid<Est>();
    for (const v of eO.values()) gO.add(v);
    for (const v of eD.values()) gD.add(v);
    const nearL = (pt: { lat: number; lon: number }, g: PointGrid<Est>) => {
      let best = Infinity;
      g.near(pt, P.transferM, (v, d) => {
        best = Math.min(best, v.t + walkMinutes(d) + 2);
      });
      return best;
    };
    const toStation = new Map<number, number>();
    const fromStation = new Map<number, number>();
    stations.forEach((s, i) => {
      const wO = walkMinutes(distanceM(m.O, s));
      const wD = walkMinutes(distanceM(m.D, s));
      const a = Math.min(wO <= m.radii.station ? wO : Infinity, nearL(s, gO));
      const b = Math.min(wD <= m.radii.station ? wD : Infinity, nearL(s, gD));
      if (a < Infinity) toStation.set(i, a);
      if (b < Infinity) fromStation.set(i, b);
    });
    const trainTo = new Map<number, number>();
    const trainFrom = new Map<number, number>();
    for (const t of m.day.trips) {
      const s = t.s;
      for (let j = 1; j < s.length; j++) {
        const fy = fromStation.get(s[j][0]);
        if (fy === undefined || s[j][1] < 0) continue;
        for (let i = 0; i < j; i++) {
          if (s[i][2] < 0) continue;
          const v = s[j][1] - s[i][2] + fy;
          if (v < (trainTo.get(s[i][0]) ?? Infinity)) trainTo.set(s[i][0], v);
        }
      }
      for (let i = 0; i < s.length - 1; i++) {
        const ty = toStation.get(s[i][0]);
        if (ty === undefined || s[i][2] < 0) continue;
        for (let j = i + 1; j < s.length; j++) {
          if (s[j][1] < 0) continue;
          const v = ty + 5 + s[j][1] - s[i][2];
          if (v < (trainFrom.get(s[j][0]) ?? Infinity)) trainFrom.set(s[j][0], v);
        }
      }
    }
    const stLinesO = new Map<number, Est[]>();
    const stLinesD = new Map<number, Est[]>();
    stations.forEach((st, i) => {
      const lines = m.index.stations[st.id];
      if (!lines) return;
      const tTo = trainTo.get(i);
      const tFrom = trainFrom.get(i);
      if (tTo !== undefined && !fromStation.has(i))
        for (const li of lines) if (!have.has(li) && candO.has(li)) (stLinesO.get(li) ?? stLinesO.set(li, []).get(li)!).push({ t: tTo + 4, lat: st.lat, lon: st.lon });
      if (tFrom !== undefined && !toStation.has(i))
        for (const li of lines) if (!have.has(li) && candD.has(li)) (stLinesD.get(li) ?? stLinesD.set(li, []).get(li)!).push({ t: tFrom + 4, lat: st.lat, lon: st.lon });
    });
    for (const [li, A] of candO) {
      const B = stLinesO.get(li);
      if (B) consider(li, A, B, false);
    }
    for (const [li, B] of candD) {
      const A = stLinesD.get(li);
      if (A) consider(li, A, B, false);
    }
  }
  est.sort((a, b) => a.cost - b.cost || a.li - b.li);
  // quotas : 60 % pour les lignes entre L_O et L_D si deux correspondances urbaines sont permises, le reste pour les gares
  const kOD = uu >= 2 ? Math.ceil(K * 0.6) : 0;
  const out: number[] = [];
  const take = (ok: (e: { od: boolean }) => boolean, limit: number) => {
    for (const e of est) {
      if (out.length >= limit) break;
      if (ok(e) && !out.includes(e.li)) out.push(e.li);
    }
  };
  take((e) => e.od, kOD);
  take((e) => !e.od, K);
  take(() => true, K);
  return out;
}
