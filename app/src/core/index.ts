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
  type CoreStatus,
  type Endpoint,
  type Favorite,
  type FavoriteAnswer,
  type FavoriteRank,
  type GeocodeAnswer,
  type PlanResult,
  type Journey,
  type LatLon,
  type LineBoard,
  type LineFilter,
  type LineMatch,
  type LineStop,
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
import { answerFavorite, orderFavorites, relocateAmong, type PlanMemo } from './favorites';
import { addDays, isCovered } from './freshness';
import { GeocodeClient, relayGeoTransport } from './geocode';
import { brokenConnection, refreshJourney, refreshJourneys, skeleton, type RefreshEnv } from './journeys';
import { makeFetch, mapPool } from './net';
import { PersistentCache } from './persist';
import { planCandidates, type NearArea } from './plan';
import { RealtimeClient, stibPoint, type AlertItem } from './realtime';
import { computeRoute } from './routing/engine';
import { recalcAlert, repairFollowed, touchFollowed } from './routing/repair';
import { rankSearch, searchFileKeys } from './search';
import { suggestOpening } from './suggest';
import { indexDay, TrainEngine, trainLeg, type DayIndex } from './trains';
import { findLinesIn, lineBoardAt, lineStopsIn } from './linepicks';
import { brusselsParts, distanceM, localDate, walkMinutes } from './util';
import { DAY_START_HOUR } from './text';

export { dataFreshness, type Freshness } from './freshness';
export { QuaiError, MESSAGES, type QuaiErrorCode } from './errors';

const NEARBY_DEPS = 4;
/** « Autour de moi » : départs calculés pour les 20 zones les plus proches au plus (une liste des lunettes). */
const NEARBY_MAX = 20;
/** Zone d'un favori disparue : zones candidates dans ce rayon (puis 150 m au plus, core/favorites.ts). */
const RELOCATE_M = 300;
/** S7 : à partir de cette heure, les trains du lendemain sont chargés aussi. */
const NEXT_DAY_HOUR = 18;
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
  const persist = new PersistentCache(opts.storage, { now });
  const data = new DataClient(trimSlash(opts.dataBase), fetchFn, persist, now);
  const rt = new RealtimeClient(trimSlash(opts.relayBase), fetchFn, now);
  const geo = new GeocodeClient(relayGeoTransport(trimSlash(opts.relayBase), fetchFn), now);
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

  /**
   * Trains des jours utiles (S7) : le jour de maintenant (avant 04:00, aussi la veille) ; le lendemain seulement le
   * soir (à partir de 18:00) ou sur demande (`all`, par exemple faute de résultat).
   */
  async function trainDays(opts?: { all?: boolean }): Promise<DayIndex[]> {
    const meta = await ensure();
    const dates = meta.serviceDates.slice(0, 2);
    const t = now();
    const today = localDate(t);
    const h = brusselsParts(t).h;
    let wanted = opts?.all ? dates : dates.filter((d) => d === today || (h < DAY_START_HOUR && d === addDays(today, -1)) || (h >= NEXT_DAY_HOUR && d === addDays(today, 1)));
    if (!wanted.length) wanted = dates.slice(0, 1);
    let failed = false;
    let unreachable = false;
    const files = await Promise.all(
      wanted.map((d) =>
        data.trains(d).catch((e: unknown) => {
          failed = true;
          if (e instanceof QuaiError && e.code === 'dataUnreachable') unreachable = true;
          return null;
        }),
      ),
    );
    const days = files.filter((f): f is NonNullable<typeof f> => f !== null).map(indexDay);
    if (!days.length && failed) throw new QuaiError(unreachable ? 'dataUnreachable' : 'dataUnavailable');
    return days;
  }

  /** M8.3 : ancien identifiant (`aka` d'une zone fusionnée, ou favori retrouvé) → zone actuelle ; résumés vus. */
  const aliasOf = new Map<string, string>();
  const summaryOf = new Map<string, AreaSummary>();
  /** Plans des trajets favoris (core/favorites.ts) : temps réel seul tant qu'ils restent bons. */
  const plans = new Map<string, PlanMemo>();
  data.onGeneration(() => {
    aliasOf.clear();
    summaryOf.clear();
    plans.clear();
  });

  async function areasAround(lat: number, lon: number, radiusM: number): Promise<NearArea[]> {
    const meta = await ensure();
    const tiles = await Promise.all(tileKeysAround(lat, lon, radiusM, meta.tile).map((k) => data.tile(k)));
    const seen = new Set<string>();
    const out: NearArea[] = [];
    for (const t of tiles) {
      for (const a of t?.areas ?? []) {
        if (!a || seen.has(a.id)) continue;
        seen.add(a.id);
        if (a.aka?.length) {
          summaryOf.set(a.id, a);
          for (const old of a.aka) if (old !== a.id) aliasOf.set(old, a.id);
        }
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

    async nearby(lat: number, lon: number, radiusM: number, o?: { light?: boolean }): Promise<NearbyItem[]> {
      const meta = await ensure();
      const list = await areasAround(lat, lon, radiusM);
      const t = now();
      const items: NearbyItem[] = list.map(({ a, d }) => ({ area: a, distanceM: Math.round(d / 10) * 10, walkMin: walkMinutes(d) }));
      // M8.7 : accueil léger, le nombre d'arrêts se compte sur les tuiles seules (ni fichier de zone, ni relais).
      if (o?.light || !isCovered(meta, t) || !items.length) return items;
      // Départs des NEARBY_MAX zones les plus proches seulement (review-tech M8).
      const near = list.slice(0, NEARBY_MAX);
      const preps = await mapPool(near, 4, (x) => preparedOrNull(x.a.id));
      const reqs: { prep: PreparedArea; limit: number }[] = [];
      const at: number[] = [];
      preps.forEach((p, i) => {
        if (p) {
          // marge : des départs de la minute écoulée ne doivent pas cacher le prochain (review-tech m1)
          reqs.push({ prep: p, limit: NEARBY_DEPS + 6 });
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
      // M8.3 : identifiant d'une zone fusionnée (`aka`) accepté, une fois la zone connue (tuiles chargées).
      const id = aliasOf.get(areaId) ?? areaId;
      if (!isCovered(meta, t)) {
        const prep = await preparedOrNull(id);
        return { area: prep?.summary ?? minimalSummary(areaId), departures: [], anyPlanned: false, rtErrors: [], updatedAt: t };
      }
      const prep = await prepared(id);
      const [b] = await buildBoards([{ prep, limit, filter: o?.filter }], rt, t);
      if (id === areaId) return b;
      // zone fusionnée : le résumé publié (avec `aka`) de préférence au résumé tiré du fichier de zone
      return { ...b, area: summaryOf.get(id) ?? b.area };
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

    /** 1.2.2 (PRD-1.2.2 § 4) : lignes par numéro (core/linepicks.ts), fichiers de ligne de la génération connue. */
    async findLines(query: string, near?: LatLon | null): Promise<LineMatch[]> {
      const meta = await ensure();
      return findLinesIn({ meta, json: (p, v) => data.json(p, v) }, query ?? '', near);
    },

    async lineStops(line: Pick<LineMatch, 'op' | 'line' | 'routes'>, near?: LatLon | null): Promise<LineStop[]> {
      const meta = await ensure();
      return lineStopsIn({ meta, json: (p, v) => data.json(p, v) }, line, near);
    },

    /**
     * 1.2.2 (PRD-1.2.2 § 3) : passages d'une ligne à un arrêt, par sens. Zone absente des données → missing (jamais
     * d'exception : « introuvable ») ; serveur injoignable → QuaiError comme board().
     */
    async lineBoard(areaId: string, line: string, o?: { perDirection?: number }): Promise<LineBoard> {
      const meta = await ensure();
      const t = now();
      const per = Math.max(1, Math.round(o?.perDirection ?? 2));
      const id = aliasOf.get(areaId) ?? areaId;
      let prep: PreparedArea;
      try {
        prep = await prepared(id);
      } catch (e) {
        if (!(e instanceof QuaiError && e.code === 'areaUnknown')) throw e;
        const area = minimalSummary(areaId);
        return { area, op: area.op, mode: 'bus', line, directions: [], state: 'missing', anyPlanned: false, rtErrors: [], updatedAt: t };
      }
      const area = id === areaId ? prep.summary : (summaryOf.get(id) ?? prep.summary);
      return lineBoardAt(prep, area, line ?? '', per, t, isCovered(meta, t) ? rt : null, meta.serviceDates);
    },

    async search(query: string, near?: { lat: number; lon: number }): Promise<SearchItem[]> {
      if (normalizeForSearch(query ?? '').replace(/ /g, '').length < 2) return [];
      // M4.2 : un fichier par variante de la requête (noms usuels, St/Sint/Saint, « gare » facultatif)
      const keys = searchFileKeys(query);
      if (!keys.length) return [];
      await ensure();
      const files = await Promise.all(keys.map((k) => data.search(k)));
      return rankSearch(files, query, near);
    },

    async trains(fromAreaId: string, toAreaId: string, after: number, limit = 3): Promise<Journey[]> {
      const meta = await ensure();
      if (!isCovered(meta, now())) return [];
      // 1.1 : direct, une ou deux correspondances (M5c), montée et descente permises seulement (trains.ts) ;
      // rien avec les trains du jour : aussi ceux du lendemain
      let options = engine.search(await trainDays(), fromAreaId, toAreaId, after, Math.max(1, limit));
      if (!options.length) options = engine.search(await trainDays({ all: true }), fromAreaId, toAreaId, after, Math.max(1, limit));
      return refreshJourneys(
        options.map((o) => skeleton(o.rides.map(trainLeg))),
        DEFAULT_SETTINGS,
        refreshEnv,
        true,
      );
    },

    /** 1.0, gardé : les propositions de route(), dans l'ordre d'affichage. */
    async plan(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number }): Promise<Journey[]> {
      return (await core.route(from, to, after, settings, here)).journeys;
    },

    async refresh(j: Journey, settings: Settings): Promise<Journey> {
      // trajet suivi : son réseau passe en tête de la mémoire des réseaux (routing/repair.ts)
      touchFollowed(j.id);
      const out = await refreshJourney(j, settings, refreshEnv, false);
      // correspondance devenue impossible : reste du trajet recalculé sur le réseau de sa recherche, gardé par
      // identifiant de trajet et refait au besoin avec les mêmes fichiers de la même génération (routing/repair.ts)
      const meta = data.meta;
      if (brokenConnection(out) < 0 || !meta) return out;
      const source = { meta, tile: (k: string) => data.tile(k), json: <T>(p: string, v: (x: unknown) => x is T) => data.json(p, v), trains: (d: string) => data.trains(d) };
      const legs = await repairFollowed(out, settings, source).catch(() => null);
      if (!legs || data.meta?.generatedAt !== meta.generatedAt) return out;
      const [fixed] = await refreshJourneys([{ ...out, legs }], settings, refreshEnv, false);
      return { ...fixed, id: j.id, alerts: [recalcAlert(now()), ...fixed.alerts] };
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

    /* --- 1.1 : points d'attache provisoires (remplacés par les équipes cœur et routage) --- */
    /** 1.1 (routage) : calcul de routing/engine.ts sur les fichiers de ligne ; repli 1.0 sans meta.lines. */
    async route(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number } | null): Promise<PlanResult> {
      for (let attempt = 0; ; attempt++) {
        const meta = await ensure();
        if (!isCovered(meta, now())) return { journeys: [], empty: 'noTrip' };
        const result = await computeRoute(from, to, after, settings, here, {
          source: { meta, tile: (k) => data.tile(k), json: (p, v) => data.json(p, v), trains: (d) => data.trains(d) },
          now,
          refresh: (js, fresh) => refreshJourneys(js, settings, refreshEnv, fresh),
          legacy: (O, D, t, maxWalk) =>
            planCandidates(O, D, t, maxWalk, { meta, areasAround, area: preparedOrNull, trainDays, engine, refresh: (j) => refreshJourney(j, settings, refreshEnv, true) }),
        });
        // une génération de données à la fois : publication changée pendant le calcul, on recommence une fois
        if (attempt === 0 && data.meta && data.meta.generatedAt !== meta.generatedAt) continue;
        return result;
      }
    },

    /** M1.4 : ordre intelligent (core/favorites.ts, commun au faux cœur). */
    orderFavorites(here: { lat: number; lon: number } | null, settings: Settings, last?: ReadonlyMap<string, FavoriteAnswer>): FavoriteRank[] {
      return orderFavorites(here, settings, now(), last);
    },

    /** M1.5 : réponse d'un favori (core/favorites.ts) ; zone disparue retrouvée par `aka`, puis par nom et position. */
    answer(fav: Favorite, here: { lat: number; lon: number } | null, settings: Settings): Promise<FavoriteAnswer> {
      return answerFavorite(fav, here, settings, {
        now,
        board: (id, o) => core.board(id, o),
        route: (from, to, after, s, h) => core.route(from, to, after, s, h),
        relocate: async (f) => {
          const list = await areasAround(f.lat, f.lon, RELOCATE_M);
          const found = relocateAmong(f, list.map((x) => x.a));
          if (found) aliasOf.set(f.areaId, found.id);
          return found;
        },
        refresh: (js, s) => refreshJourneys(js, s, refreshEnv, false),
        generation: async () => (await ensure()).generatedAt,
        plans,
      });
    },

    /** M4 : adresses par le relais (core/geocode.ts) : seuls le texte et la langue partent du téléphone. */
    geocode(q: string, lang: 'fr' | 'nl', near?: { lat: number; lon: number } | null): Promise<GeocodeAnswer> {
      return geo.geocode(q, lang, near);
    },

    /** M8.5 : état du temps réel d'après les dernières requêtes au relais. */
    status(): CoreStatus {
      return rt.status();
    },

    health(): Promise<HealthResponse> {
      return rt.health();
    },
  };
  return core;
}
