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
import { frName, prettyName, searchKey, searchWords } from '../../../../shared/names';
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
  files['meta.json'] = meta;
  return files;
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
