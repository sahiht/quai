/**
 * Quai : cœur de l'appli (logique sans interface, sans DOM ni SDK Even).
 * Point d'entrée : createCore(opts) qui implémente l'interface Core de ./api.
 * Aide exportée : dataFreshness(meta, now) pour signaler des horaires périmés.
 */
import type { AreaSummary, Meta, Op } from '../../../shared/types';
import { normalizeId } from '../../../shared/types';
import { normalizeForSearch } from '../../../shared/names';
import {
  DEFAULT_SETTINGS,
  type Board,
  type Core,
  type CoreOptions,
  type Endpoint,
  type Journey,
  type LineFilter,
  type Mode,
  type Names,
  type NearbyItem,
  type SearchItem,
  type Settings,
  type Suggestion,
  type HealthResponse,
} from './api';
import { naturalCompare, prepareArea, tileKeysAround, type PreparedArea } from './areas';
import { buildBoards } from './boards';
import { DataClient, OPS } from './data';
import { QuaiError } from './errors';
import { isCovered } from './freshness';
import { refreshJourney, skeleton, type RefreshEnv } from './journeys';
import { makeFetch, mapPool } from './net';
import { PersistentCache } from './persist';
import { planJourneys, type NearArea } from './plan';
import { RealtimeClient, stibPoint, type AlertItem } from './realtime';
import { rankSearch, searchFileKey } from './search';
import { suggestOpening } from './suggest';
import { indexDay, TrainEngine, trainLeg, type DayIndex } from './trains';
import { distanceM, walkMinutes } from './util';

export { dataFreshness, type Freshness } from './freshness';
export { QuaiError, MESSAGES, type QuaiErrorCode } from './errors';

const NEARBY_DEPS = 4;
const trimSlash = (s: string) => s.replace(/\/+$/, '');

function minimalSummary(id: string): AreaSummary {
  const op = id.slice(0, id.indexOf(':'));
  return {
    id,
    op: (OPS as readonly string[]).includes(op) ? (op as Op) : 'stib',
    n: { fr: id, nl: id },
    lat: 0,
    lon: 0,
    modes: [],
    lines: [],
  };
}

function alertActive(a: AlertItem, now: number): boolean {
  if (!a.active.length) return true;
  return a.active.some(([s, e]) => (!s || now >= s * 1000) && (!e || now <= e * 1000));
}

const stopBase = (s: string) => normalizeId(s).replace(/_[^_]+$/, '').replace(/^S(?=\d)/, '');

export function createCore(opts: CoreOptions): Core {
  const now = () => opts.now();
  const fetchFn = makeFetch(opts.fetch);
  const persist = new PersistentCache(opts.storage);
  const data = new DataClient(trimSlash(opts.dataBase), fetchFn, persist);
  const rt = new RealtimeClient(trimSlash(opts.relayBase), fetchFn, now);
  const engine = new TrainEngine();

  const ensure = (): Promise<Meta> => data.requireMeta();

  async function prepared(id: string): Promise<PreparedArea> {
    const meta = await ensure();
    return prepareArea(await data.area(id), meta);
  }

  async function preparedOrNull(id: string): Promise<PreparedArea | null> {
    try {
      return await prepared(id);
    } catch {
      return null;
    }
  }

  async function trainDays(): Promise<DayIndex[]> {
    const meta = await ensure();
    let failed = false;
    const files = await Promise.all(
      meta.serviceDates.slice(0, 2).map((d) =>
        data.trains(d).catch(() => {
          failed = true;
          return null;
        }),
      ),
    );
    const days = files.filter((f): f is NonNullable<typeof f> => f !== null).map(indexDay);
    if (!days.length && failed) throw new QuaiError('dataUnavailable');
    return days;
  }

  async function areasAround(lat: number, lon: number, radiusM: number): Promise<NearArea[]> {
    const meta = await ensure();
    const tiles = await Promise.all(tileKeysAround(lat, lon, radiusM, meta.tile).map((k) => data.tile(k)));
    const seen = new Set<string>();
    const out: NearArea[] = [];
    for (const t of tiles) {
      for (const a of t?.areas ?? []) {
        if (!a || seen.has(a.id)) continue;
        seen.add(a.id);
        const d = distanceM({ lat, lon }, a);
        if (d <= radiusM) out.push({ a, d });
      }
    }
    return out.sort((x, y) => x.d - y.d || (x.a.id < y.a.id ? -1 : 1));
  }

  async function works(op: Op, routes: string[], stops: string[]): Promise<string[]> {
    const t = now();
    if (op === 'stib') {
      const pts = [...new Set(stops.map(stibPoint).filter(Boolean))];
      if (!pts.length) return [];
      const res = await rt.stib(pts);
      if (res.error) return [];
      const texts: string[] = [];
      for (const p of pts) for (const e of res.map.get(p) ?? []) if (e.msg && (!routes.length || routes.includes(e.line))) texts.push(e.msg);
      return [...new Set(texts)];
    }
    const alerts = await rt.alerts(op, routes, stops);
    if (!alerts) return [];
    const rs = new Set(routes.map(normalizeId));
    const ss = new Set(stops.map(stopBase));
    const texts = alerts
      .filter((a) => alertActive(a, t))
      .filter((a) => (!a.routes.length && !a.stops.length) || a.routes.some((r) => rs.has(r)) || a.stops.some((s) => ss.has(stopBase(s))))
      .map((a) => a.header.fr ?? a.header.nl ?? a.header.en ?? a.header.de ?? '')
      .filter((x) => x.trim());
    return [...new Set(texts)];
  }

  const refreshEnv: RefreshEnv = { rt, now, trainDays, area: preparedOrNull, works };

  const core: Core = {
    get meta() {
      return data.meta;
    },

    async init(): Promise<Meta> {
      return data.loadMeta();
    },

    async nearby(lat: number, lon: number, radiusM: number): Promise<NearbyItem[]> {
      const meta = await ensure();
      const list = await areasAround(lat, lon, radiusM);
      const t = now();
      const items: NearbyItem[] = list.map(({ a, d }) => ({ area: a, distanceM: Math.round(d / 10) * 10, walkMin: walkMinutes(d) }));
      if (!isCovered(meta, t) || !items.length) return items;
      const preps = await mapPool(list, 4, (x) => preparedOrNull(x.a.id));
      const reqs: { prep: PreparedArea; limit: number }[] = [];
      const at: number[] = [];
      preps.forEach((p, i) => {
        if (p) {
          reqs.push({ prep: p, limit: NEARBY_DEPS });
          at.push(i);
        }
      });
      const boards = await buildBoards(reqs, rt, t);
      boards.forEach((b, k) => {
        const next = b.departures.find((d) => !d.cancelled && d.est >= t);
        if (next) items[at[k]].next = next;
      });
      return items;
    },

    async board(areaId: string, o?: { limit?: number; filter?: LineFilter[] }): Promise<Board> {
      const meta = await ensure();
      const t = now();
      const limit = Math.max(1, Math.round(o?.limit ?? 8));
      if (!isCovered(meta, t)) {
        const prep = await preparedOrNull(areaId);
        return { area: prep?.summary ?? minimalSummary(areaId), departures: [], anyPlanned: false, rtErrors: [], updatedAt: t };
      }
      const prep = await prepared(areaId);
      const [b] = await buildBoards([{ prep, limit, filter: o?.filter }], rt, t);
      return b;
    },

    async linesAt(areaId: string): Promise<{ line: string; mode: Mode; head: Names; filter: LineFilter }[]> {
      const prep = await prepared(areaId);
      const seen = new Set<string>();
      const out: { line: string; mode: Mode; head: Names; filter: LineFilter }[] = [];
      prep.file.patterns.forEach((p, i) => {
        const key = `${p.line}|${prep.headKeys[i]}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ line: p.line, mode: p.mode, head: p.head, filter: { line: p.line, head: prep.headKeys[i] } });
      });
      return out.sort((a, b) => naturalCompare(a.line, b.line) || a.head.fr.localeCompare(b.head.fr, 'fr'));
    },

    async search(query: string, near?: { lat: number; lon: number }): Promise<SearchItem[]> {
      if (normalizeForSearch(query ?? '').replace(/ /g, '').length < 2) return [];
      const key = searchFileKey(query);
      if (!key) return [];
      await ensure();
      return rankSearch(await data.search(key), query, near);
    },

    async trains(fromAreaId: string, toAreaId: string, after: number, limit = 3): Promise<Journey[]> {
      const meta = await ensure();
      if (!isCovered(meta, now())) return [];
      const days = await trainDays();
      const options = engine.search(days, fromAreaId, toAreaId, after, Math.max(1, limit));
      return Promise.all(options.map((o) => refreshJourney(skeleton(o.rides.map(trainLeg)), DEFAULT_SETTINGS, refreshEnv, true)));
    },

    async plan(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number }): Promise<Journey[]> {
      const meta = await ensure();
      if (!isCovered(meta, now())) return [];
      return planJourneys(from, to, after, settings, here, {
        meta,
        areasAround,
        area: preparedOrNull,
        trainDays,
        engine,
        refresh: (j) => refreshJourney(j, settings, refreshEnv, true),
      });
    },

    async refresh(j: Journey, settings: Settings): Promise<Journey> {
      return refreshJourney(j, settings, refreshEnv, false);
    },

    async suggest(here: { lat: number; lon: number } | null, settings: Settings): Promise<Suggestion | null> {
      let meta: Meta;
      try {
        meta = await ensure();
      } catch {
        return null;
      }
      const t = now();
      if (!isCovered(meta, t)) return null;
      return suggestOpening(here, settings, {
        now: t,
        board: (id, o) => core.board(id, o),
        plan: (from, to, after, s, h) => core.plan(from, to, after, s, h),
      });
    },

    works(op: Op, routes: string[], stops: string[]): Promise<string[]> {
      return works(op, routes, stops).catch(() => []);
    },

    health(): Promise<HealthResponse> {
      return rt.health();
    },
  };
  return core;
}
