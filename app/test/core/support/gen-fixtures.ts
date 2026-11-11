/**
 * Générateur des fixtures du cœur : mini-pipeline déterministe qui transforme fixtures/network.json
 * en fichiers statiques (meta, tiles, areas, search, trains) conformes à shared/types.ts, selon les règles
 * de SPEC § 3, et en réponses du relais (rt, stib, alerts, health) conformes aux mêmes contrats.
 *
 * Les fichiers produits sont enregistrés dans app/test/fixtures/core/ (voir fixtures.test.ts :
 * QUAI_WRITE_FIXTURES=1 pour les régénérer). Ils servent de « données publiées » aux tests.
 */
import type {
  AlertsResponse,
  AreaFile,
  AreaSummary,
  HealthResponse,
  LineFile,
  LineIndex,
  LineTile,
  Meta,
  Mode,
  Names,
  Op,
  RtResponse,
  SearchFile,
  StibResponse,
  TileFile,
  TrainsDay,
} from '../../../../shared/types';
import { normalizeId, tileKey } from '../../../../shared/types';
import { frName, lineName, prettyName, searchKey, searchWords } from '../../../../shared/names';
import type { Network, NetRoute, NetStop, NetTemplate, NetTrip } from './network';

export const TILE = { lat: 0.02, lon: 0.03 };
export const GENERATED_AT = '2026-11-10T01:15:00.000Z';
export const RT_FETCHED_AT = '2026-11-10T11:10:00.000Z';

type Files = Record<string, unknown>;

const MODE_ORDER: Mode[] = ['train', 'metro', 'tram', 'bus'];
const natural = (a: string, b: string) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm4 = (min: number) => `${pad(Math.floor(min / 60))}${pad(min % 60)}`;

function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function runsOn(cal: Network['calendars'][string], date: string): boolean {
  if (cal.remove?.includes(date)) return false;
  if (cal.add?.includes(date)) return true;
  if (date < cal.start || date > cal.end) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // lundi = 0
  return cal.days[dow] === '1';
}

export function modeOfRouteType(type: number): Mode {
  if (type === 0 || (type >= 900 && type <= 906)) return 'tram';
  if (type === 1 || (type >= 400 && type <= 405)) return 'metro';
  if (type === 2 || (type >= 100 && type <= 117)) return 'train';
  return 'bus';
}

interface AreaRec {
  file: AreaFile;
  patKeys: Map<string, number>;
  servedModes: Set<Mode>;
  servedLines: Set<string>;
}

export interface TripRec {
  id: string;
  op: Op;
  route: NetRoute;
  head: Names;
  num?: string;
  service: string;
  st: { stop: string; arr: number; dep: number; seq: number }[];
}

interface Grouped {
  id: string;
  base: string;
  platform?: string;
  nl?: string;
  lat: number;
  lon: number;
}

/** Regroupement « même nom à moins de 300 m » (insensible casse et accents). */
function groupByName(stops: Grouped[]): Grouped[][] {
  const groups: Grouped[][] = [];
  for (const s of stops) {
    const g = groups.find((x) => fold(x[0].base) === fold(s.base) && x.some((y) => distance(y, s) <= 300));
    if (g) g.push(s);
    else groups.push([s]);
  }
  return groups;
}

function splitSuffix(name: string, word: 'perron' | 'quai'): { base: string; platform?: string } {
  const m = new RegExp(`^(.*?)\\s+${word}\\s+(\\S+)$`, 'i').exec(name.trim());
  return m ? { base: m[1].trim(), platform: m[2] } : { base: name.trim() };
}

/** Voyages du mini-réseau (gabarits développés et voyages explicites), triés par premier départ. */
export function buildTrips(net: Network): TripRec[] {
  const sncbHead = (h: string): Names => {
    const st = net.ops.sncb.stations.find((s) => s.name === h);
    if (!st) return { fr: h, nl: h };
    const n: Names = { fr: st.fr, nl: st.nl };
    if (st.name === st.nl) n.l = 'nl';
    return n;
  };
  const headOf: Record<Op, (h: string) => Names> = {
    sncb: sncbHead,
    stib: (h) => ({ fr: prettyName(h), nl: prettyName(net.ops.stib.headsigns[h] ?? h) }),
    delijn: (h) => ({ fr: frName(h), nl: h, l: 'nl' }),
    tec: (h) => ({ fr: h, nl: h }),
  };
  const trips: TripRec[] = [];
  const fromTemplates = (op: Op, routes: NetRoute[], tpls: NetTemplate[]) => {
    for (const t of tpls) {
      const route = routes.find((r) => r.id === t.route);
      if (!route) throw new Error(`route ${t.route}`);
      for (let m = hm(t.from); m <= hm(t.to); m += t.every) {
        trips.push({
          id: t.idTpl.replace('{HHMM}', hhmm4(m)),
          op,
          route,
          head: headOf[op](t.head),
          service: t.service,
          st: t.stops.map(([stop, off], i) => ({ stop, arr: m + off, dep: m + off, seq: i + 1 })),
        });
      }
    }
  };
  const fromTrips = (op: Op, routes: NetRoute[], list: NetTrip[]) => {
    for (const t of list) {
      const route = routes.find((r) => r.id === t.route);
      if (!route) throw new Error(`route ${t.route}`);
      trips.push({
        id: t.id,
        op,
        route,
        head: headOf[op](t.head),
        num: t.num,
        service: t.service,
        st: t.st.map((x, i) => ({ stop: x[0], arr: hm(x[1]), dep: hm(x.length === 3 ? x[2] : x[1]), seq: i + 1 })),
      });
    }
  };
  fromTrips('sncb', net.ops.sncb.routes, net.ops.sncb.trips);
  fromTemplates('stib', net.ops.stib.routes, net.ops.stib.templates);
  fromTemplates('delijn', net.ops.delijn.routes, net.ops.delijn.templates);
  fromTemplates('tec', net.ops.tec.routes, net.ops.tec.templates);
  fromTrips('tec', net.ops.tec.routes, net.ops.tec.trips);
  trips.sort((a, b) => a.st[0].dep - b.st[0].dep || (a.id < b.id ? -1 : 1));
  return trips;
}

export function buildDataFiles(net: Network): Files {
  const dates = net.serviceDates;
  const areas = new Map<string, AreaRec>();
  const areaOfStop = new Map<string, { areaId: string; idx: number }>();
  const areaOrder: string[] = [];

  const addArea = (op: Op, key: string, n: Names, lat: number, lon: number, stops: AreaFile['stops']) => {
    const id = `${op}:${key}`;
    const file: AreaFile = { v: 1, id, op, n, lat, lon, stops, patterns: [], deps: [] };
    areas.set(id, { file, patKeys: new Map(), servedModes: new Set(), servedLines: new Set() });
    areaOrder.push(id);
    stops.forEach((s, idx) => areaOfStop.set(`${op}|${s.id}`, { areaId: id, idx }));
  };

  // SNCB : une zone par gare (parent), arrêt « gare » sans quai + un arrêt par quai.
  for (const s of net.ops.sncb.stations) {
    const n: Names = { fr: s.fr, nl: s.nl };
    if (s.name === s.nl) n.l = 'nl';
    addArea('sncb', s.uic, n, s.lat, s.lon, [
      { id: s.uic, rt: s.uic },
      ...s.platforms.map((p) => ({ id: `${s.uic}_${p}`, platform: p, rt: `${s.uic}_${p}` })),
    ]);
  }

  const addGrouped = (op: Op, list: Grouped[], names: (g: Grouped[]) => Names, rt: (id: string) => string) => {
    for (const g of groupByName(list)) {
      const key = g.map((x) => x.id).sort()[0];
      const lat = g.reduce((s, x) => s + x.lat, 0) / g.length;
      const lon = g.reduce((s, x) => s + x.lon, 0) / g.length;
      const stops = [...g]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((x) => ({ id: x.id, ...(x.platform ? { platform: x.platform } : {}), rt: rt(x.id) }));
      addArea(op, key, names(g), Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, stops);
    }
  };

  addGrouped(
    'stib',
    net.ops.stib.stops.map((s: NetStop) => ({ id: s.id, base: s.name, nl: s.nl, lat: s.lat, lon: s.lon })),
    (g) => ({ fr: prettyName(g[0].base), nl: prettyName(g[0].nl ?? g[0].base) }),
    (id) => id.replace(/[A-Za-z]+$/, ''),
  );
  addGrouped(
    'delijn',
    net.ops.delijn.stops.map((s) => ({ id: s.id, ...splitSuffix(s.name, 'perron'), lat: s.lat, lon: s.lon })),
    (g) => ({ fr: frName(g[0].base), nl: g[0].base, l: 'nl' }),
    (id) => normalizeId(id),
  );
  addGrouped(
    'tec',
    net.ops.tec.stops.map((s) => ({ id: s.id, ...splitSuffix(s.name, 'quai'), lat: s.lat, lon: s.lon })),
    (g) => ({ fr: g[0].base, nl: g[0].base }),
    (id) => normalizeId(id),
  );

  const trips = buildTrips(net);

  const tripCount: Record<Op, number> = { sncb: 0, stib: 0, delijn: 0, tec: 0 };
  dates.forEach((date, day) => {
    for (const t of trips) {
      const cal = net.calendars[t.service];
      if (!cal || !runsOn(cal, date)) continue;
      tripCount[t.op]++;
      const mode = modeOfRouteType(t.route.type);
      const locs = t.st.map((x) => {
        const loc = areaOfStop.get(`${t.op}|${x.stop}`);
        if (!loc) throw new Error(`arrêt inconnu ${t.op} ${x.stop}`);
        return loc;
      });
      locs.forEach((loc) => {
        const a = areas.get(loc.areaId);
        a?.servedModes.add(mode);
        a?.servedLines.add(t.route.short);
      });
      for (let p = 0; p < t.st.length - 1; p++) {
        const here = locs[p];
        const area = areas.get(here.areaId);
        if (!area) continue;
        const next: [string, number][] = [];
        for (let q = p + 1; q < t.st.length && next.length < 60; q++) {
          const aid = locs[q].areaId;
          if (aid === here.areaId || next.some(([id]) => id === aid)) continue;
          next.push([aid, t.st[q].arr - t.st[p].dep]);
        }
        const key = `${t.route.id}|${t.head.fr}|${next.map(([id]) => id).join(',')}`;
        let pi = area.patKeys.get(key);
        if (pi === undefined) {
          pi = area.file.patterns.length;
          area.patKeys.set(key, pi);
          area.file.patterns.push({ line: t.route.short, mode, route: t.route.id, head: t.head, next });
        }
        area.file.deps.push([day, t.st[p].dep, pi, here.idx, t.op === 'stib' ? '' : t.id, t.st[p].seq]);
      }
    }
  });

  const files: Files = {};
  const summaries: AreaSummary[] = [];
  for (const id of areaOrder) {
    const a = areas.get(id);
    if (!a) continue;
    a.file.deps.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3] || (x[4] < y[4] ? -1 : x[4] > y[4] ? 1 : 0));
    const key = id.slice(id.indexOf(':') + 1);
    files[`areas/${a.file.op}/${key.replace(/[^A-Za-z0-9_-]/g, '_')}.json`] = a.file;
    summaries.push({
      id,
      op: a.file.op,
      n: a.file.n,
      lat: a.file.lat,
      lon: a.file.lon,
      modes: MODE_ORDER.filter((m) => a.servedModes.has(m)),
      lines: [...a.servedLines].sort(natural).slice(0, 12),
    });
  }

  const tiles = new Map<string, AreaSummary[]>();
  for (const s of summaries) {
    const k = tileKey(s.lat, s.lon, TILE);
    tiles.set(k, [...(tiles.get(k) ?? []), s]);
  }
  for (const [k, list] of tiles) files[`tiles/${k}.json`] = { v: 1, areas: list } satisfies TileFile;

  const search = new Map<string, SearchFile['items']>();
  for (const s of summaries) {
    for (const w of searchWords(s.n.fr, s.n.nl)) {
      const k = searchKey(w);
      const list = search.get(k) ?? [];
      if (!list.some((x) => x.id === s.id)) list.push({ id: s.id, op: s.op, n: s.n, modes: s.modes, lat: s.lat, lon: s.lon });
      search.set(k, list);
    }
  }
  for (const [k, list] of search) files[`search/${k}.json`] = { v: 1, items: list.sort((a, b) => (a.id < b.id ? -1 : 1)) } satisfies SearchFile;

  const stations = summaries.filter((s) => s.op === 'sncb');
  const stationIdx = new Map(stations.map((s, i) => [s.id, i]));
  for (const date of dates) {
    const day: TrainsDay = {
      v: 1,
      date,
      stations: stations.map((s) => ({ id: s.id, n: s.n, lat: s.lat, lon: s.lon })),
      trips: trips
        .filter((t) => t.op === 'sncb' && runsOn(net.calendars[t.service], date))
        .map((t) => ({
          id: t.id,
          cat: t.route.short,
          ...(t.num ? { num: t.num } : {}),
          head: t.head,
          s: t.st.map((x): [number, number, number, string, number] => {
            const loc = areaOfStop.get(`sncb|${x.stop}`);
            const p = /_(\w+)$/.exec(x.stop);
            return [stationIdx.get(loc?.areaId ?? '') ?? -1, x.arr, x.dep, p ? p[1] : '', x.seq];
          }),
        })),
    };
    files[`trains/${date}.json`] = day;
  }

  const count = (op: Op) => summaries.filter((s) => s.op === op).length;
  const meta: Meta = {
    v: 1,
    generatedAt: GENERATED_AT,
    timezone: 'Europe/Brussels',
    serviceDates: dates,
    tile: TILE,
    feeds: {
      sncb: { ok: true, areas: count('sncb'), trips: tripCount.sncb },
      stib: { ok: true, areas: count('stib'), trips: tripCount.stib },
      delijn: { ok: true, areas: count('delijn'), trips: tripCount.delijn },
      tec: { ok: true, areas: count('tec'), trips: tripCount.tec },
    },
  };
  // 1.1 (routage) : fichiers de ligne, index des lignes et tuiles de lignes (design-routing.md § 3)
  const lineOut = buildLineFiles(net, trips, (op, stop) => {
    const loc = areaOfStop.get(`${op}|${stop}`);
    const a = loc ? areas.get(loc.areaId) : undefined;
    return loc && a ? { id: a.file.id, lat: a.file.lat, lon: a.file.lon, n: a.file.n, rt: a.file.stops[loc.idx]?.rt ?? '' } : null;
  }, stations);
  Object.assign(files, lineOut.files);
  meta.lines = lineOut.meta;
  files['meta.json'] = meta;
  return files;
}

/* ------------------------------ 1.1 : fichiers de ligne (équipe routage) ------------------------------ */

/** Rayon des correspondances des fichiers de ligne (LineIndex.conn). */
export const LINE_CONN_M = 400;

interface ZoneRef {
  id: string;
  lat: number;
  lon: number;
  n: Names;
  rt: string;
}

/**
 * Fichiers de ligne du mini-réseau, au format du pipeline 1.1 (shared/types.ts LineFile, LineIndex, LineTile) :
 * un fichier par ligne GTFS (STIB, De Lijn, TEC), motifs = (destination, suite des zones, autorisations), deux arrêts
 * consécutifs de la même zone = une position (première arrivée, dernier départ), profils partagés, voyages des deux
 * jours triés par (jour, départ), `trips` normalisés (De Lijn, TEC), `conn` réduites aux bornes des tronçons communs ;
 * index (numérotation par opérateur puis clé, `stations` : lignes à moins de 400 m de chaque gare) ; tuiles de lignes.
 */
export function buildLineFiles(
  net: Network,
  trips: TripRec[],
  zoneOf: (op: Op, stop: string) => ZoneRef | null,
  stations: { id: string; lat: number; lon: number }[],
): { files: Files; meta: NonNullable<Meta['lines']> } {
  const dates = net.serviceDates;
  const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
  interface Pat {
    head: Names;
    a: string[];
    s: string[];
    f: string;
    prof: number[][];
    profKey: Map<string, number>;
    t: number[][];
  }
  interface Line {
    key: string;
    op: Exclude<Op, 'sncb'>;
    route: string;
    line: string;
    mode: Mode;
    pats: Pat[];
    patKey: Map<string, Pat>;
    trips: string[];
    tripRank: Map<string, number>;
    zones: Map<string, ZoneRef>;
  }
  const lines = new Map<string, Line>();
  for (const t of trips) {
    if (t.op === 'sncb') continue;
    const op = t.op;
    const mode = modeOfRouteType(t.route.type);
    const days = dates.map((d, i) => (runsOn(net.calendars[t.service], d) ? i : -1)).filter((i) => i >= 0);
    if (!days.length) continue;
    // positions : zones successives (deux arrêts consécutifs de la même zone = une position)
    const pos: { z: ZoneRef; arr: number; dep: number }[] = [];
    for (const x of t.st) {
      const z = zoneOf(op, x.stop);
      if (!z) throw new Error(`arrêt inconnu ${op} ${x.stop}`);
      const last = pos[pos.length - 1];
      if (last && last.z.id === z.id) {
        last.dep = x.dep;
        last.z = { ...last.z, rt: z.rt };
      } else pos.push({ z, arr: x.arr, dep: x.dep });
    }
    if (pos.length < 2) continue;
    const key = `${op}:${t.route.id}`;
    let L = lines.get(key);
    if (!L) {
      L = { key, op, route: normalizeId(t.route.id), line: lineName(t.route.short, mode), mode, pats: [], patKey: new Map(), trips: [], tripRank: new Map(), zones: new Map() };
      lines.set(key, L);
    }
    for (const p of pos) if (!L.zones.has(p.z.id)) L.zones.set(p.z.id, p.z);
    const n = pos.length;
    const f = `b${'x'.repeat(n - 2)}a`;
    const pk = `${t.head.fr}|${pos.map((p) => p.z.id).join(',')}|${f}`;
    let P = L.patKey.get(pk);
    if (!P) {
      P = { head: t.head, a: pos.map((p) => p.z.id), s: pos.map((p) => p.z.rt), f, prof: [], profKey: new Map(), t: [] };
      L.patKey.set(pk, P);
      L.pats.push(P);
    }
    const start = pos[0].dep;
    const prof = pos.map((p, i) => (i === n - 1 ? p.arr : p.dep) - start);
    const prk = prof.join(',');
    let pi = P.profKey.get(prk);
    if (pi === undefined) {
      pi = P.prof.length;
      P.prof.push(prof);
      P.profKey.set(prk, pi);
    }
    let rank = -1;
    if (op !== 'stib') {
      const id = normalizeId(t.id);
      rank = L.tripRank.get(id) ?? -1;
      if (rank < 0) {
        rank = L.trips.length;
        L.trips.push(id);
        L.tripRank.set(id, rank);
      }
    }
    for (const day of days) P.t.push(rank >= 0 ? [day, start, pi, rank] : [day, start, pi]);
  }
  const order = [...lines.values()].sort((x, y) => (x.op < y.op ? -1 : x.op > y.op ? 1 : x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const num = new Map(order.map((L, i) => [L.key, i]));
  // lignes par zone (montée ou descente), positions des zones
  const linesOfZone = new Map<string, Set<number>>();
  const zone = new Map<string, ZoneRef>();
  for (const L of order) {
    const li = num.get(L.key) ?? 0;
    for (const P of L.pats)
      for (const id of P.a) {
        let s = linesOfZone.get(id);
        if (!s) linesOfZone.set(id, (s = new Set()));
        s.add(li);
        zone.set(id, L.zones.get(id) as ZoneRef);
      }
  }
  const near = (pt: { lat: number; lon: number }, self: number): number[] => {
    const s = new Set<number>();
    for (const [id, set] of linesOfZone) {
      const z = zone.get(id);
      if (z && distance(pt, z) <= LINE_CONN_M) for (const li of set) if (li !== self) s.add(li);
    }
    return [...s].sort((a, b) => a - b);
  };
  const files: Files = {};
  for (const L of order) {
    const li = num.get(L.key) ?? 0;
    const local = new Map<string, number>();
    const areasOut: LineFile['areas'] = [];
    const loc = (id: string) => {
      let i = local.get(id);
      if (i === undefined) {
        const z = L.zones.get(id) as ZoneRef;
        i = areasOut.length;
        local.set(id, i);
        areasOut.push([z.id, round5(z.lat), round5(z.lon), z.n]);
      }
      return i;
    };
    const pats = L.pats.map((P) => {
      const out: LineFile['pats'][number] = {
        head: P.head,
        a: P.a.map(loc),
        s: P.s,
        prof: P.prof,
        t: [...P.t].sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]),
      };
      if (P.f !== `b${'x'.repeat(P.a.length - 2)}a`) out.f = P.f;
      return out;
    });
    // correspondances : lignes voisines gardées aux bornes des suites de zones consécutives où elles sont présentes
    const full = areasOut.map(([id]) => near(zone.get(id) as ZoneRef, li));
    const keep = areasOut.map(() => new Set<number>());
    for (const p of pats) {
      const present = new Map<number, number[]>();
      p.a.forEach((la, k) => {
        for (const m of full[la]) (present.get(m) ?? present.set(m, []).get(m)!).push(k);
      });
      for (const [m, ks] of present) {
        let runStart = ks[0];
        for (let i = 1; i <= ks.length; i++) {
          if (i === ks.length || ks[i] !== ks[i - 1] + 1) {
            keep[p.a[runStart]].add(m);
            keep[p.a[ks[i - 1]]].add(m);
            if (i < ks.length) runStart = ks[i];
          }
        }
      }
    }
    const file: LineFile = {
      v: 1,
      id: L.key,
      op: L.op,
      route: L.route,
      line: L.line,
      mode: L.mode,
      areas: areasOut,
      pats,
      conn: keep.map((s) => [...s].sort((a, b) => a - b)),
    };
    if (L.trips.length) file.trips = L.trips;
    files[`lines/${L.op}/${L.key.slice(L.key.indexOf(':') + 1).replace(/[^A-Za-z0-9_-]/g, '_')}.json`] = file;
  }
  const stationLines: Record<string, number[]> = {};
  for (const st of stations) {
    const l = near(st, -1);
    if (l.length) stationLines[st.id] = l;
  }
  const index: LineIndex = {
    v: 1,
    generatedAt: GENERATED_AT,
    conn: LINE_CONN_M,
    lines: order.map((L) => [L.key, L.line, L.mode, L.pats.length]),
    stations: stationLines,
  };
  files['lines/index.json'] = index;
  const tiles = new Map<string, Record<string, number[]>>();
  for (const [id, set] of linesOfZone) {
    const z = zone.get(id) as ZoneRef;
    const k = tileKey(z.lat, z.lon, TILE);
    const t = tiles.get(k) ?? tiles.set(k, {}).get(k)!;
    t[id] = [...set].sort((a, b) => a - b);
  }
  for (const [k, a] of tiles) files[`linetiles/${k}.json`] = { v: 1, a } satisfies LineTile;
  const ops = (['stib', 'delijn', 'tec'] as const).filter((op) => order.some((L) => L.op === op));
  return { files, meta: { files: order.length, ops: [...ops], conn: LINE_CONN_M } };
}

export interface RelayFixtures {
  rt: Record<'sncb' | 'delijn' | 'tec', RtResponse>;
  stib: StibResponse;
  alerts: Record<'sncb' | 'delijn' | 'tec', AlertsResponse>;
  health: HealthResponse;
}

/** Réponses du relais (scène « base ») reprenant la section realtime de network.json. */
export function buildRelayFixtures(net: Network): RelayFixtures {
  const feedTimestamp = Math.round(Date.parse('2026-11-10T12:10:00+01:00') / 1000);
  // Comme le vrai relais : retard (départ, sinon arrivée) et heure estimée absolue = horaire du jour 0 + retard.
  const all = buildTrips(net);
  const day0 = Date.parse(`${net.serviceDates[0]}T12:00:00+01:00`) - 12 * 3_600_000;
  const rtOf = (op: 'sncb' | 'delijn' | 'tec'): RtResponse => {
    const trips: RtResponse['trips'] = {};
    for (const t of net.realtime[op].tripUpdates) {
      const trip = all.find((x) => x.op === op && x.id === t.trip);
      trips[normalizeId(t.trip)] = {
        ...(t.cancelled ? { cancelled: true } : {}),
        u: (t.updates ?? []).map((u) => {
          const delay = u.depDelay ?? u.arrDelay ?? null;
          const st = trip?.st.find((x) => x.seq === u.seq);
          const sched = st ? (u.depDelay !== undefined ? st.dep : st.arr) : undefined;
          const time = sched !== undefined && delay !== null ? Math.round((day0 + sched * 60_000) / 1000) + delay : null;
          return [u.seq ?? null, normalizeId(u.stop), delay, time, 0];
        }),
      };
    }
    return { op, fetchedAt: RT_FETCHED_AT, feedTimestamp, trips };
  };
  const alertsOf = (op: 'sncb' | 'delijn' | 'tec'): AlertsResponse => ({
    op,
    fetchedAt: RT_FETCHED_AT,
    alerts: net.realtime[op].alerts.map((a) => ({
      id: a.id,
      routes: a.routes,
      stops: a.stops,
      header: { fr: a.fr, ...(a.nl ? { nl: a.nl } : {}) },
      active: [[Math.round(Date.parse(a.from) / 1000), Math.round(Date.parse(a.to) / 1000)]],
    })),
  });
  const points: StibResponse['points'] = {};
  for (const [pid, list] of Object.entries(net.realtime.stib.points)) {
    points[pid] = list.map((e) => ({
      line: e.line,
      dest: e.dest,
      times: e.times.map((t) => `2026-11-10T${t}:00+01:00`),
      ...(e.message ? { msg: e.message.fr } : {}),
    }));
  }
  const ok = { ok: true, ms: 120 };
  return {
    rt: { sncb: rtOf('sncb'), delijn: rtOf('delijn'), tec: rtOf('tec') },
    stib: { fetchedAt: RT_FETCHED_AT, points },
    alerts: { sncb: alertsOf('sncb'), delijn: alertsOf('delijn'), tec: alertsOf('tec') },
    health: {
      ok: true,
      time: RT_FETCHED_AT,
      data: { generatedAt: GENERATED_AT, ok: true },
      sources: { sncb: { ...ok }, stib: { ...ok }, delijn: { ...ok }, tec: { ...ok } },
    },
  };
}

/** Fichiers du relais enregistrés dans app/test/fixtures/core/relay/. */
export function relayFiles(r: RelayFixtures): Files {
  return {
    'rt-sncb.json': r.rt.sncb,
    'rt-delijn.json': r.rt.delijn,
    'rt-tec.json': r.rt.tec,
    'stib.json': r.stib,
    'alerts-sncb.json': r.alerts.sncb,
    'alerts-delijn.json': r.alerts.delijn,
    'alerts-tec.json': r.alerts.tec,
    'health.json': r.health,
  };
}
