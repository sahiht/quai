/**
 * Réseau de l'oracle : TOUT l'instantané (toutes les lignes STIB, De Lijn, TEC de lines/ et tous les trains des
 * jours couverts), construit ici sans le choix des lignes du moteur (select.ts) ni ses structures (network.ts).
 *
 * Modèle de marche identique à Quai (params.ts, network.ts, util.ts) :
 * - minutes de marche = max(1, ceil(distance × 1,3 / 80)) ;
 * - correspondance à pied entre deux zones à 400 m au plus : marche + 1 min vers une zone urbaine, + 3 min vers une
 *   gare ; dans la même zone : 2 min (urbaine), 4 min (gare) ;
 * - extrémités : 0 min vers la zone de l'extrémité ou à 25 m au plus, sinon les minutes de marche ; ici jusqu'à
 *   25 min vers tout arrêt (le moteur : 15 min vers un arrêt urbain, 25 min vers une gare).
 *
 * Heures en minutes depuis l'origine GTFS du jour de service 0 (base0).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { P, util, type Names } from './quai';

export interface ORoute {
  stops: Int32Array;
  board: Uint8Array;
  alight: Uint8Array;
  n: number;
  nTrips: number;
  /** [voyage × n + position] */
  dep: Int32Array;
  arr: Int32Array;
  urban: boolean;
  op: string;
  mode: string;
  /** Nom court de la ligne (urbain) ; trains : voir tripCat. */
  line: string;
  head: Names[];
  tripCat: string[];
  tripId: string[];
  tripNum: string[];
  file: string;
}

export interface ONet {
  dir: string;
  base0: number;
  dates: string[];
  dayOff: number[];
  ids: string[];
  lat: Float64Array;
  lon: Float64Array;
  names: Names[];
  station: Uint8Array;
  idx: Map<string, number>;
  routes: ORoute[];
  /** Par zone : motifs (indices) et positions. */
  routesAt: Int32Array[];
  posAt: Int32Array[];
  /** Par zone : [voisine, minutes, voisine, minutes…] à 400 m au plus. */
  foot: Int32Array[];
  stats: { lineFiles: number; patterns: number; urbanTrips: number; trainTrips: number; routes: number; stops: number; footPairs: number; ms: number };
}

const nets = new Map<string, ONet>();

/** Réseau complet d'un instantané (gardé en mémoire). */
export function loadNet(dir: string): ONet {
  const hit = nets.get(dir);
  if (hit) return hit;
  const t0 = performance.now();
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { serviceDates: string[] };
  const dates = meta.serviceDates;
  const base0 = util.serviceDayBase(dates[0]) as number;
  const dayOff = dates.map((d) => Math.round((util.serviceDayBase(d) - base0) / 60_000));

  const ids: string[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  const names: Names[] = [];
  const station: number[] = [];
  const idx = new Map<string, number>();
  const stop = (id: string, la: number, lo: number, n: Names, st: boolean): number => {
    let i = idx.get(id);
    if (i === undefined) {
      i = ids.length;
      idx.set(id, i);
      ids.push(id);
      lat.push(la);
      lon.push(lo);
      names.push(n);
      station.push(st ? 1 : 0);
    }
    return i;
  };
  const routes: ORoute[] = [];
  let patterns = 0;
  let urbanTrips = 0;
  let trainTrips = 0;
  let lineFiles = 0;

  /** Découpe un groupe de voyages (même suite d'arrêts et d'autorisations) en motifs FIFO (aucun dépassement). */
  const addGroup = (
    base: Omit<ORoute, 'nTrips' | 'dep' | 'arr' | 'head' | 'tripCat' | 'tripId' | 'tripNum'>,
    trips: { dep: number[]; arr: number[]; head: Names; cat: string; id: string; num: string }[],
  ) => {
    const n = base.n;
    trips.sort((a, b) => a.dep[0] - b.dep[0] || a.arr[n - 1] - b.arr[n - 1]);
    const chains: (typeof trips)[] = [];
    for (const t of trips) {
      let placed = false;
      for (const c of chains) {
        const l = c[c.length - 1];
        let ok = true;
        for (let k = 0; k < n && ok; k++) if (t.dep[k] < l.dep[k] || t.arr[k] < l.arr[k]) ok = false;
        if (ok) {
          c.push(t);
          placed = true;
          break;
        }
      }
      if (!placed) chains.push([t]);
    }
    for (const c of chains) {
      const nT = c.length;
      const dep = new Int32Array(nT * n);
      const arr = new Int32Array(nT * n);
      c.forEach((t, ti) => {
        for (let k = 0; k < n; k++) {
          dep[ti * n + k] = t.dep[k];
          arr[ti * n + k] = t.arr[k];
        }
      });
      routes.push({ ...base, nTrips: nT, dep, arr, head: c.map((t) => t.head), tripCat: c.map((t) => t.cat), tripId: c.map((t) => t.id), tripNum: c.map((t) => t.num) });
    }
  };

  // ---------- trains ----------
  for (let d = 0; d < dates.length; d++) {
    let day: { stations: { id: string; n: Names; lat: number; lon: number }[]; trips: { id: string; cat: string; num?: string; head: Names; s: [number, number, number, string, number][] }[] };
    try {
      day = JSON.parse(readFileSync(join(dir, 'trains', `${dates[d]}.json`), 'utf8'));
    } catch {
      continue;
    }
    const sIdx = day.stations.map((s) => stop(s.id, s.lat, s.lon, s.n, true));
    const groups = new Map<string, { stops: number[]; board: number[]; alight: number[]; trips: { dep: number[]; arr: number[]; head: Names; cat: string; id: string; num: string }[] }>();
    for (const t of day.trips) {
      const s = t.s;
      const n0 = s.length;
      if (n0 < 2) continue;
      const st: number[] = [];
      const bo: number[] = [];
      const al: number[] = [];
      const dp: number[] = [];
      const ar: number[] = [];
      let bad = false;
      for (let k = 0; k < n0; k++) {
        const x = s[k];
        const si = sIdx[x[0]];
        if (si === undefined) {
          bad = true;
          break;
        }
        const b = k < n0 - 1 && x[2] >= 0 ? 1 : 0;
        const a = k > 0 && x[1] >= 0 ? 1 : 0;
        if (!b && !a) continue; // ni montée ni descente : sans intérêt pour le calcul
        st.push(si);
        bo.push(b);
        al.push(a);
        const tDep = x[2] >= 0 ? x[2] : x[1];
        const tArr = x[1] >= 0 ? x[1] : x[2];
        dp.push(dayOff[d] + tDep);
        ar.push(dayOff[d] + tArr);
      }
      if (bad || st.length < 2) continue;
      trainTrips++;
      const key = `${st.join(',')}|${bo.join('')}|${al.join('')}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { stops: st, board: bo, alight: al, trips: [] }));
      g.trips.push({ dep: dp, arr: ar, head: t.head, cat: t.cat, id: t.id, num: t.num ?? '' });
    }
    for (const g of groups.values()) {
      addGroup(
        { stops: Int32Array.from(g.stops), board: Uint8Array.from(g.board), alight: Uint8Array.from(g.alight), n: g.stops.length, urban: false, op: 'sncb', mode: 'train', line: '', file: `trains/${dates[d]}` },
        g.trips,
      );
    }
  }

  // ---------- lignes urbaines (tous les fichiers de lines/) ----------
  for (const op of ['stib', 'delijn', 'tec']) {
    let files: string[] = [];
    try {
      files = readdirSync(join(dir, 'lines', op)).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const fn of files) {
      const f = JSON.parse(readFileSync(join(dir, 'lines', op, fn), 'utf8')) as {
        id: string;
        op: string;
        line: string;
        mode: string;
        areas: [string, number, number, Names][];
        pats: { head: Names; a: number[]; f?: string; prof: number[][]; t: number[][] }[];
        trips?: string[];
      };
      lineFiles++;
      const aIdx = f.areas.map(([id, la, lo, nm]) => stop(id, la, lo, nm, false));
      for (const p of f.pats ?? []) {
        const n = p.a?.length ?? 0;
        if (n < 2 || !p.t?.length) continue;
        const flags = p.f && p.f.length === n ? p.f : `b${'x'.repeat(n - 2)}a`;
        const board: number[] = [];
        const alight: number[] = [];
        for (let k = 0; k < n; k++) {
          const c = flags[k];
          board.push(k < n - 1 && (c === 'b' || c === 'x') ? 1 : 0);
          alight.push(k > 0 && (c === 'a' || c === 'x') ? 1 : 0);
        }
        const trips: { dep: number[]; arr: number[]; head: Names; cat: string; id: string; num: string }[] = [];
        for (const t of p.t) {
          const off = dayOff[t[0]];
          const prof = p.prof?.[t[2]];
          if (off === undefined || !Array.isArray(prof) || prof.length !== n) continue;
          const times = prof.map((m) => off + t[1] + m);
          trips.push({ dep: times, arr: times, head: p.head, cat: f.line, id: t.length > 3 && f.trips ? (f.trips[t[3]] ?? '') : '', num: '' });
        }
        if (!trips.length) continue;
        patterns++;
        urbanTrips += trips.length;
        addGroup(
          { stops: Int32Array.from(p.a, (a) => aIdx[a]), board: Uint8Array.from(board), alight: Uint8Array.from(alight), n, urban: true, op: f.op, mode: f.mode, line: f.line, file: f.id },
          trips,
        );
      }
    }
  }

  // ---------- index des motifs par zone ----------
  const N = ids.length;
  const ra: number[][] = Array.from({ length: N }, () => []);
  const pa: number[][] = Array.from({ length: N }, () => []);
  routes.forEach((r, ri) => {
    for (let pos = 0; pos < r.n; pos++) {
      ra[r.stops[pos]].push(ri);
      pa[r.stops[pos]].push(pos);
    }
  });

  // ---------- marches entre zones (400 m) ----------
  const cellLat = 0.004;
  const cellLon = 0.006;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const k = `${Math.floor(lat[i] / cellLat)}:${Math.floor(lon[i] / cellLon)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  let footPairs = 0;
  const foot: Int32Array[] = [];
  for (let i = 0; i < N; i++) {
    const cy = Math.floor(lat[i] / cellLat);
    const cx = Math.floor(lon[i] / cellLon);
    const out: number[] = [];
    const a = { lat: lat[i], lon: lon[i] };
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++)
        for (const j of grid.get(`${y}:${x}`) ?? []) {
          if (j === i) continue;
          const d = util.distanceM(a, { lat: lat[j], lon: lon[j] });
          if (d <= P.transferM) out.push(j, util.walkMinutes(d));
        }
    footPairs += out.length / 2;
    foot.push(Int32Array.from(out));
  }

  const net: ONet = {
    dir,
    base0,
    dates,
    dayOff,
    ids,
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    names,
    station: Uint8Array.from(station),
    idx,
    routes,
    routesAt: ra.map((x) => Int32Array.from(x)),
    posAt: pa.map((x) => Int32Array.from(x)),
    foot,
    stats: { lineFiles, patterns, urbanTrips, trainTrips, routes: routes.length, stops: N, footPairs, ms: 0 },
  };
  net.stats.ms = Math.round(performance.now() - t0);
  nets.set(dir, net);
  return net;
}

/** Point d'extrémité : position et zone éventuelle (0 min de marche vers elle). */
export interface Pt {
  lat: number;
  lon: number;
  areaId?: string;
}

/** Zones à `maxMin` minutes de marche au plus d'une extrémité (règle accessMinutes de Quai : zone de l'extrémité ou
 *  25 m au plus : 0 min). */
export function accessOf(net: ONet, pt: Pt, maxMin: number): Map<number, number> {
  const m = new Map<number, number>();
  const reach = (maxMin * 80) / 1.3 + 50;
  const dLat = reach / 111_320;
  const dLon = reach / (111_320 * Math.max(0.1, Math.cos((pt.lat * Math.PI) / 180)));
  for (let i = 0; i < net.ids.length; i++) {
    if (pt.areaId && net.ids[i] === pt.areaId) {
      m.set(i, 0);
      continue;
    }
    if (Math.abs(net.lat[i] - pt.lat) > dLat || Math.abs(net.lon[i] - pt.lon) > dLon) continue;
    const d = util.distanceM(pt, { lat: net.lat[i], lon: net.lon[i] });
    const w = d <= 25 ? 0 : util.walkMinutes(d);
    if (w <= maxMin) m.set(i, w);
  }
  return m;
}
