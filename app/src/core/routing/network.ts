/**
 * Réseau du calcul de trajets (design-routing.md § 4.5) : zones (celles des fichiers de ligne chargés, plus toutes
 * les gares de trains/), motifs (fichiers de ligne ; trains groupés par suite de gares et d'autorisations), marches
 * entre zones à moins de 400 m (grille, walkMinutes de util.ts).
 *
 * Heures : minutes depuis l'origine GTFS du jour de service 0 (`base0`, serviceDayBase de meta.serviceDates[0]) ;
 * le jour 1 est décalé de l'écart réel entre les deux origines (changement d'heure compris).
 *
 * Les parties lourdes sont gardées en mémoire et partagées d'une recherche à l'autre : motifs des trains par
 * fichiers trains/ (même objet = même génération), motifs d'un fichier de ligne par objet LineFile.
 */
import type { LineFile, Mode, Names, Op, TrainsDay } from '../../../../shared/types';
import { distanceM, serviceDayBase, walkMinutes } from '../util';
import { P } from './params';

/** Motif du calcul. dep et arr : [voyage × n + position], minutes depuis base0, voyages triés par départ. */
export interface RRoute {
  stops: Int32Array;
  board: Uint8Array;
  alight: Uint8Array;
  n: number;
  nTrips: number;
  dep: Int32Array;
  arr: Int32Array;
  /** Vrai si l'ordre des voyages est le même à toutes les positions (recherche dichotomique possible). */
  fifo: boolean;
  op: Op;
  mode: Mode;
  /** Nom court de la ligne (train : catégorie du 1er voyage, qui peut varier d'un voyage à l'autre). */
  line: string;
  head: Names;
  urban: boolean;
  /** Fichier de ligne et motif, ou partie « trains » et rang du motif. */
  src: { kind: 'line'; part: LinePart; pat: number } | { kind: 'train'; part: TrainPart; r: number };
}

/* ------------------------------ trains ------------------------------ */

export interface TrainDayRef {
  file: TrainsDay;
  /** Décalage (min) de l'origine de ce jour par rapport à base0. */
  off: number;
}

export interface TrainPart {
  base0: number;
  days: TrainDayRef[];
  ids: string[];
  lat: number[];
  lon: number[];
  names: Names[];
  routes: RRoute[];
  /** Par motif : jour (rang dans days) et rang du voyage dans le fichier, pour chaque voyage du motif. */
  tripDay: Int8Array[];
  tripIdx: Int32Array[];
}

/** Heures d'un arrêt de train : départ (montée) et arrivée (descente), -1 = interdit (TrainsDay, 1.1). */
export function trainTimes(s: TrainsDay['trips'][number]['s'], k: number): { arr: number; dep: number } {
  const x = s[k];
  let arr = x[1];
  let dep = x[2];
  if (arr < 0 && dep < 0) {
    // ni montée ni descente : heure de l'arrêt voisin, pour garder l'ordre des heures
    for (let j = k - 1; j >= 0; j--) {
      const t = s[j][2] >= 0 ? s[j][2] : s[j][1];
      if (t >= 0) return { arr: t, dep: t };
    }
    for (let j = k + 1; j < s.length; j++) {
      const t = s[j][1] >= 0 ? s[j][1] : s[j][2];
      if (t >= 0) return { arr: t, dep: t };
    }
    return { arr: 0, dep: 0 };
  }
  if (arr < 0) arr = dep;
  if (dep < 0) dep = arr;
  return { arr, dep };
}

const trainCache: { files: TrainsDay[]; base0: number; part: TrainPart }[] = [];

function isFifo(dep: Int32Array, n: number, nT: number): boolean {
  for (let k = 0; k < n; k++) for (let t = 1; t < nT; t++) if (dep[t * n + k] < dep[(t - 1) * n + k]) return false;
  return true;
}

/** Motifs des trains des fichiers donnés (gardés en mémoire pour les mêmes fichiers). */
export function trainPart(files: TrainsDay[], base0: number): TrainPart {
  const hit = trainCache.find((c) => c.base0 === base0 && c.files.length === files.length && c.files.every((f, i) => f === files[i]));
  if (hit) return hit.part;
  const days: TrainDayRef[] = files.map((file) => ({ file, off: Math.round((serviceDayBase(file.date) - base0) / 60_000) }));
  const part: TrainPart = { base0, days, ids: [], lat: [], lon: [], names: [], routes: [], tripDay: [], tripIdx: [] };
  const sIdx = new Map<string, number>();
  const station = (st: TrainsDay['stations'][number]) => {
    let i = sIdx.get(st.id);
    if (i === undefined) {
      i = part.ids.length;
      sIdx.set(st.id, i);
      part.ids.push(st.id);
      part.lat.push(st.lat);
      part.lon.push(st.lon);
      part.names.push(st.n);
    }
    return i;
  };
  const groups = new Map<string, { stops: number[]; board: Uint8Array; alight: Uint8Array; trips: { d: number; ti: number; start: number }[] }>();
  days.forEach((day, d) => {
    day.file.trips.forEach((t, ti) => {
      const s = t.s;
      const n = s.length;
      if (n < 2) return;
      const stops: number[] = [];
      for (const x of s) {
        const st = day.file.stations[x[0]];
        if (!st) return;
        stops.push(station(st));
      }
      const board = new Uint8Array(n);
      const alight = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        board[k] = k < n - 1 && s[k][2] >= 0 ? 1 : 0;
        alight[k] = k > 0 && s[k][1] >= 0 ? 1 : 0;
      }
      const key = `${stops.join(',')}|${board.join('')}${alight.join('')}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { stops, board, alight, trips: [] }));
      g.trips.push({ d, ti, start: day.off + trainTimes(s, 0).dep });
    });
  });
  for (const g of groups.values()) {
    g.trips.sort((a, b) => a.start - b.start || a.d - b.d || a.ti - b.ti);
    const n = g.stops.length;
    const nT = g.trips.length;
    const dep = new Int32Array(nT * n);
    const arr = new Int32Array(nT * n);
    const tripDay = new Int8Array(nT);
    const tripIdx = new Int32Array(nT);
    g.trips.forEach(({ d, ti }, t) => {
      const day = days[d];
      const s = day.file.trips[ti].s;
      for (let k = 0; k < n; k++) {
        const x = trainTimes(s, k);
        dep[t * n + k] = day.off + x.dep;
        arr[t * n + k] = day.off + x.arr;
      }
      tripDay[t] = d;
      tripIdx[t] = ti;
    });
    const first = days[g.trips[0].d].file.trips[g.trips[0].ti];
    const r = part.routes.length;
    part.routes.push({
      stops: Int32Array.from(g.stops),
      board: g.board,
      alight: g.alight,
      n,
      nTrips: nT,
      dep,
      arr,
      fifo: isFifo(dep, n, nT),
      op: 'sncb',
      mode: 'train',
      line: first.cat,
      head: first.head,
      urban: false,
      src: { kind: 'train', part, r },
    });
    part.tripDay.push(tripDay);
    part.tripIdx.push(tripIdx);
  }
  trainCache.unshift({ files: [...files], base0, part });
  if (trainCache.length > 3) trainCache.length = 3;
  return part;
}

/** Voyage du fichier trains/ d'un voyage d'un motif de train. */
export function trainTripOf(route: RRoute, trip: number): { day: TrainDayRef; ti: number } | null {
  if (route.src.kind !== 'train') return null;
  const { part, r } = route.src;
  return { day: part.days[part.tripDay[r][trip]], ti: part.tripIdx[r][trip] };
}

/* ------------------------------ fichiers de ligne ------------------------------ */

export interface LinePart {
  file: LineFile;
  base0: number;
  dayOff: readonly number[];
  pats: {
    a: Int32Array; // zones (indices dans file.areas)
    board: Uint8Array;
    alight: Uint8Array;
    n: number;
    nTrips: number;
    dep: Int32Array;
    arr: Int32Array;
    fifo: boolean;
    /** Rang de chaque voyage du motif dans pats[].t (ordre des départs). */
    t: Int32Array;
  }[];
}

const lineCache = new WeakMap<LineFile, LinePart>();

/** Autorisations d'un motif de ligne (b montée, a descente, x les deux, n aucune ; absent = b x… x a). */
export function patternFlags(f: string | undefined, n: number): string {
  return f && f.length === n ? f : `b${'x'.repeat(Math.max(0, n - 2))}a`.slice(0, Math.max(n, 2));
}

/** Motifs d'un fichier de ligne en heures absolues (gardés en mémoire pour ce fichier). */
export function linePart(file: LineFile, base0: number, dayOff: readonly number[]): LinePart {
  const hit = lineCache.get(file);
  if (hit && hit.base0 === base0 && hit.dayOff.length === dayOff.length && hit.dayOff.every((x, i) => x === dayOff[i])) return hit;
  const pats: LinePart['pats'] = [];
  for (const p of file.pats ?? []) {
    const n = p.a?.length ?? 0;
    const flags = patternFlags(p.f, n);
    const board = new Uint8Array(n);
    const alight = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const c = flags[k];
      board[k] = k < n - 1 && (c === 'b' || c === 'x') ? 1 : 0;
      alight[k] = k > 0 && (c === 'a' || c === 'x') ? 1 : 0;
    }
    const trips = (p.t ?? [])
      .map((t, i) => ({ i, start: (dayOff[t[0]] ?? NaN) + t[1], prof: p.prof?.[t[2]] }))
      .filter((x) => Number.isFinite(x.start) && Array.isArray(x.prof) && x.prof.length === n)
      .sort((x, y) => x.start - y.start || x.i - y.i);
    const nT = trips.length;
    const dep = new Int32Array(nT * n);
    trips.forEach((x, t) => {
      for (let k = 0; k < n; k++) dep[t * n + k] = x.start + (x.prof as number[])[k];
    });
    pats.push({ a: Int32Array.from(p.a ?? []), board, alight, n, nTrips: nT, dep, arr: dep, fifo: isFifo(dep, n, nT), t: Int32Array.from(trips.map((x) => x.i)) });
  }
  const part: LinePart = { file, base0, dayOff: [...dayOff], pats };
  lineCache.set(file, part);
  return part;
}

/* ------------------------------ réseau d'une recherche ------------------------------ */

export class Net {
  readonly ids: string[] = [];
  readonly lat: number[] = [];
  readonly lon: number[] = [];
  readonly names: Names[] = [];
  readonly station: number[] = [];
  readonly idx = new Map<string, number>();
  readonly routes: RRoute[] = [];
  routesAt: number[][] = [];
  posAt: number[][] = [];
  /** Marches : [zone voisine, minutes, zone voisine, minutes…] (sans le temps de recherche du quai). */
  foot: number[][] = [];
  readonly lines: LineFile[] = [];

  constructor(
    readonly base0: number,
    readonly trains: TrainPart | null,
  ) {
    if (trains) {
      trains.ids.forEach((id, i) => this.addStop(id, trains.lat[i], trains.lon[i], trains.names[i], true));
      for (const r of trains.routes) this.routes.push(r);
    }
  }

  get size(): number {
    return this.ids.length;
  }

  addStop(id: string, lat: number, lon: number, n: Names, station: boolean): number {
    let i = this.idx.get(id);
    if (i === undefined) {
      i = this.ids.length;
      this.idx.set(id, i);
      this.ids.push(id);
      this.lat.push(lat);
      this.lon.push(lon);
      this.names.push(n);
      this.station.push(station ? 1 : 0);
    }
    return i;
  }

  addLine(part: LinePart): void {
    const f = part.file;
    this.lines.push(f);
    const ids = f.areas.map(([id, lat, lon, n]) => this.addStop(id, lat, lon, n, false));
    part.pats.forEach((p, pi) => {
      if (p.n < 2 || !p.nTrips) return;
      const head = f.pats[pi].head;
      this.routes.push({
        stops: Int32Array.from(p.a, (a) => ids[a] ?? 0),
        board: p.board,
        alight: p.alight,
        n: p.n,
        nTrips: p.nTrips,
        dep: p.dep,
        arr: p.arr,
        fifo: p.fifo,
        op: f.op,
        mode: f.mode,
        line: f.line,
        head,
        urban: true,
        src: { kind: 'line', part, pat: pi },
      });
    });
  }

  /** Index des motifs par zone et, si `walks`, marches entre zones (à appeler une fois le réseau complet). */
  finish(walks = true): this {
    const N = this.size;
    this.routesAt = Array.from({ length: N }, () => []);
    this.posAt = Array.from({ length: N }, () => []);
    this.routes.forEach((r, ri) => {
      for (let pos = 0; pos < r.n; pos++) {
        const s = r.stops[pos];
        this.routesAt[s].push(ri);
        this.posAt[s].push(pos);
      }
    });
    this.foot = Array.from({ length: N }, () => []);
    if (!walks) return this;
    const cellLat = 0.004;
    const cellLon = 0.006;
    const grid = new Map<string, number[]>();
    for (let i = 0; i < N; i++) {
      const k = `${Math.floor(this.lat[i] / cellLat)}:${Math.floor(this.lon[i] / cellLon)}`;
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(i);
    }
    for (let i = 0; i < N; i++) {
      const cy = Math.floor(this.lat[i] / cellLat);
      const cx = Math.floor(this.lon[i] / cellLon);
      const a = { lat: this.lat[i], lon: this.lon[i] };
      const out = this.foot[i];
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let x = cx - 1; x <= cx + 1; x++)
          for (const j of grid.get(`${y}:${x}`) ?? []) {
            if (j === i) continue;
            const d = distanceM(a, { lat: this.lat[j], lon: this.lon[j] });
            if (d <= P.transferM) out.push(j, walkMinutes(d));
          }
    }
    return this;
  }
}

/** Distance (m) au-dessous de laquelle une extrémité est « sur place » : marche de 0 min jusqu'à la zone
 *  (position prise à la gare même, CA-M5.4 ; au-delà, walkMinutes compte au moins 1 min, CA-M5.2). */
export const ON_SPOT_M = 25;

/** Minutes de marche entre une extrémité et une zone du réseau (0 si c'est la zone de l'extrémité ou sur place). */
export function accessMinutes(net: Net, i: number, pt: { lat: number; lon: number; areaId?: string }): number {
  if (pt.areaId && net.ids[i] === pt.areaId) return 0;
  const d = distanceM(pt, { lat: net.lat[i], lon: net.lon[i] });
  return d <= ON_SPOT_M ? 0 : walkMinutes(d);
}

/** Zones du réseau à `urbanMin` minutes de marche au plus (gares : `stationMin`), extrémité elle-même à 0. */
export function accessMap(net: Net, pt: { lat: number; lon: number; areaId?: string }, urbanMin: number, stationMin: number): Map<number, number> {
  const m = new Map<number, number>();
  const reach = (Math.max(urbanMin, stationMin) * 80) / 1.3 + 50;
  const dLat = reach / 111_320;
  const dLon = reach / (111_320 * Math.max(0.1, Math.cos((pt.lat * Math.PI) / 180)));
  for (let i = 0; i < net.size; i++) {
    if (pt.areaId && net.ids[i] === pt.areaId) {
      m.set(i, 0);
      continue;
    }
    if (Math.abs(net.lat[i] - pt.lat) > dLat || Math.abs(net.lon[i] - pt.lon) > dLon) continue;
    const w = accessMinutes(net, i, pt);
    if (w <= (net.station[i] ? stationMin : urbanMin)) m.set(i, w);
  }
  return m;
}
