/**
 * Les quatre points d'entrée du relais, indépendants de Vercel : Request → Response.
 * Contrats de réponse : RtResponse, StibResponse, AlertsResponse, HealthResponse (lib/shared/types.ts).
 * Source en erreur : HTTP 200 avec `error` et données vides (l'appli passe à l'horaire prévu, signe « ~ »).
 * Paramètres invalides : HTTP 400 avec `error`.
 */
import { normalizeId } from './shared/types.js';
import type { AlertsResponse, HealthResponse, Meta, RtResponse, StibResponse } from './shared/types.js';
import {
  DEFAULT_LANG, LIMITS, OP_LABEL, RELAY_VERSION, RT_OPS, alertsSource, metaSource, readConfig, stibSource, tripUpdatesSource,
  type RelayConfig, type RtOp, type Source,
} from './config.js';
import { geocodeHealth } from './geocode/service.js';
import type { Ctx } from './context.js';
import { badRequest, json, requestUrl } from './http.js';
import { decodeFeed, extractAlerts, indexTripUpdates, isActive, sncbStation, type AlertItem, type FeedMessage } from './gtfsrt.js';
import { extractRows, groupWaitingTimes, stibQuery, type StibGroup } from './stib.js';
import { MissingKeyError, UpstreamError, fetchBytes, fetchJson, probe, timeoutError } from './upstream.js';
import { errorText } from './log.js';

const iso = (ms: number) => new Date(ms).toISOString();
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const unique = <T>(a: readonly T[]) => [...new Set(a)];
const idOk = (s: string) => s.length <= LIMITS.idLength && !/[\u0000-\u001f\u007f]/.test(s);

function listParam(url: URL, name: string): string[] {
  return url.searchParams.getAll(name).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
}

function parseOp(v: string | null): RtOp | null {
  const s = (v ?? '').trim().toLowerCase();
  return (RT_OPS as readonly string[]).includes(s) ? (s as RtOp) : null;
}

function opError(v: string | null): string {
  if ((v ?? '').trim().toLowerCase() === 'stib') return 'La STIB n’a pas de flux GTFS-RT : utiliser /api/stib?points=…';
  return v ? 'Paramètre op invalide : sncb, delijn ou tec attendu.' : 'Paramètre op manquant : sncb, delijn ou tec.';
}

const MISSING_KEY_LOG_EVERY_MS = 10 * 60_000;

/** Message client d'une erreur, et trace au journal (sans clé ni adresse). */
function userError(e: unknown, ctx: Ctx): string {
  if (e instanceof MissingKeyError) {
    const t = ctx.now();
    const last = ctx.caches.state.missingKeyLoggedAt;
    if (last == null || t - last < 0 || t - last >= MISSING_KEY_LOG_EVERY_MS) {
      ctx.caches.state.missingKeyLoggedAt = t;
      ctx.log.error(
        'BMC_KEY manquante : ajoutez la variable d’environnement BMC_KEY (Vercel : Settings > Environment Variables) puis redéployez. '
        + 'En attendant, les réponses portent « error » et l’appli affiche les horaires prévus.',
      );
    }
    return e.userMessage;
  }
  if (e instanceof UpstreamError) {
    ctx.log.warn(e.message);
    return e.userMessage;
  }
  ctx.log.error(`Erreur inattendue : ${errorText(e)}`);
  return 'Erreur interne du relais';
}

async function guard(ctx: Ctx, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    ctx.log.error(`Erreur interne : ${errorText(e)}`);
    return json({ error: 'Erreur interne du relais' }, 500, false);
  }
}

function decode(data: Uint8Array, src: Source): FeedMessage {
  try {
    return decodeFeed(data);
  } catch (e) {
    throw new UpstreamError('Flux illisible (protobuf invalide)', `${src.label} : décodage impossible, ${errorText(e)}`);
  }
}

/* ------------------------------ /api/rt ------------------------------ */

function tripIndex(ctx: Ctx, op: RtOp) {
  const src = tripUpdatesSource(readConfig(ctx.env), op);
  return ctx.caches.trips.get(src.id, ctx.now, async (prev) => {
    const { data, ms, bytes } = await fetchBytes(ctx, src, ctx.timeouts.upstream);
    const index = indexTripUpdates(decode(data, src), { now: ctx.now(), prev });
    const s = index.stats;
    ctx.log.info(
      `${src.label} : ${s.tripUpdates} voyages`
      + (s.withoutTripId ? `, ${s.withoutTripId} sans trip_id ignorés` : '')
      + (s.duplicates ? `, ${s.duplicates} doublons fusionnés` : '')
      + (index.differential ? ', flux DIFFERENTIAL' : '')
      + `, ${bytes} octets en ${ms} ms`,
    );
    return index;
  });
}

export async function handleRt(req: Request, ctx: Ctx): Promise<Response> {
  return guard(ctx, async () => {
    const url = requestUrl(req);
    const opParam = url.searchParams.get('op');
    const op = parseOp(opParam);
    if (!op) return badRequest(opError(opParam));
    const raw = listParam(url, 'trips');
    if (!raw.length) return badRequest('Paramètre trips manquant : identifiants de voyages séparés par des virgules.');
    if (!raw.every(idOk)) return badRequest('Paramètre trips invalide : identifiant trop long ou caractère interdit.');
    const ids = unique(raw.map(normalizeId)).filter(Boolean);
    if (ids.length > LIMITS.trips) return badRequest(`Trop de voyages : ${LIMITS.trips} au maximum par appel.`);
    try {
      const { value: index, at } = await tripIndex(ctx, op);
      const body: RtResponse = index.feedTimestamp != null
        ? { op, fetchedAt: iso(at), feedTimestamp: index.feedTimestamp, trips: {} }
        : { op, fetchedAt: iso(at), trips: {} };
      for (const id of ids) {
        const e = index.trips.get(id);
        if (e) body.trips[id] = e.cancelled ? { cancelled: true, u: e.u } : { u: e.u };
      }
      return json(body, 200, true);
    } catch (e) {
      const body: RtResponse = {
        op, fetchedAt: iso(ctx.now()), trips: {},
        error: `Temps réel ${OP_LABEL[op]} indisponible : ${lcFirst(userError(e, ctx))}`,
      };
      return json(body, 200, false);
    }
  });
}

/* ------------------------------ /api/stib ------------------------------ */

async function loadStib(ctx: Ctx, points: string[]): Promise<Map<string, StibGroup[]>> {
  const cfg = readConfig(ctx.env);
  const rows: Record<string, unknown>[] = [];
  let pages = 0;
  let ms = 0;
  // Un seul budget de temps pour toutes les pages : la fonction reste sous le délai amont de 8 s.
  const budget = ctx.timeouts.upstream;
  const deadline = performance.now() + budget;
  for (let page = 0; page < LIMITS.stibMaxPages; page++) {
    const src = stibSource(cfg, stibQuery(points, LIMITS.stibPageSize, page * LIMITS.stibPageSize));
    const left = Math.round(deadline - performance.now());
    if (left <= 0) throw timeoutError(src, budget);
    const res = await fetchJson(ctx, src, left, budget);
    pages++;
    ms += res.ms;
    const { rows: got, total } = extractRows(res.data);
    rows.push(...got);
    if (got.length < LIMITS.stibPageSize || (total != null && (page + 1) * LIMITS.stibPageSize >= total)) break;
  }
  ctx.log.info(`BMC stibmivb/rt/WaitingTimes : ${points.length} arrêts, ${rows.length} lignes en ${pages} page(s), ${ms} ms`);
  return groupWaitingTimes(rows, points);
}

export async function handleStib(req: Request, ctx: Ctx): Promise<Response> {
  return guard(ctx, async () => {
    const url = requestUrl(req);
    const raw = listParam(url, 'points');
    if (!raw.length) return badRequest('Paramètre points manquant : pointid STIB séparés par des virgules, ex. 5153,5154.');
    if (!raw.every((p) => /^\d{1,12}[A-Za-z]{0,3}$/.test(p))) {
      return badRequest('Paramètre points invalide : pointid numériques attendus, ex. 5153,5154.');
    }
    // Les identifiants statiques peuvent porter une lettre finale (5153F) : le pointid temps réel n'en a pas.
    const points = unique(raw.map((p) => p.replace(/[A-Za-z]+$/, '')));
    if (points.length > LIMITS.points) return badRequest(`Trop d’arrêts : ${LIMITS.points} au maximum par appel.`);
    try {
      const { values, at } = await ctx.caches.stib.getMany(points, ctx.now, (missing) => loadStib(ctx, missing));
      const body: StibResponse = { fetchedAt: iso(at), points: {} };
      for (const p of points) body.points[p] = values.get(p) ?? [];
      return json(body, 200, true);
    } catch (e) {
      const body: StibResponse = {
        fetchedAt: iso(ctx.now()), points: {},
        error: `Temps réel STIB indisponible : ${lcFirst(userError(e, ctx))}`,
      };
      return json(body, 200, false);
    }
  });
}

/* ------------------------------ /api/alerts ------------------------------ */

function alertList(ctx: Ctx, op: RtOp) {
  const src = alertsSource(readConfig(ctx.env), op);
  return ctx.caches.alerts.get(src.id, ctx.now, async () => {
    const { data, ms, bytes } = await fetchBytes(ctx, src, ctx.timeouts.upstream);
    const alerts = extractAlerts(decode(data, src), DEFAULT_LANG[op]);
    ctx.log.info(`${src.label} : ${alerts.length} alertes, ${bytes} octets en ${ms} ms`);
    return alerts;
  });
}

function matches(a: AlertItem, routes: Set<string>, stops: Set<string>, stations: Set<string> | null): boolean {
  if (!routes.size && !stops.size) return true;
  if (a.global) return true;
  if (a.routes.some((r) => routes.has(r))) return true;
  return a.stops.some((s) => stops.has(s) || (stations !== null && stations.has(sncbStation(s))));
}

export async function handleAlerts(req: Request, ctx: Ctx): Promise<Response> {
  return guard(ctx, async () => {
    const url = requestUrl(req);
    const opParam = url.searchParams.get('op');
    const op = parseOp(opParam);
    if (!op) return badRequest(opError(opParam));
    const rawRoutes = listParam(url, 'routes');
    const rawStops = listParam(url, 'stops');
    if (![...rawRoutes, ...rawStops].every(idOk)) {
      return badRequest('Paramètre routes ou stops invalide : identifiant trop long ou caractère interdit.');
    }
    const routes = unique(rawRoutes.map(normalizeId));
    const stops = unique(rawStops.map(normalizeId));
    if (routes.length > LIMITS.alertFilters || stops.length > LIMITS.alertFilters) {
      return badRequest(`Trop de lignes ou d’arrêts : ${LIMITS.alertFilters} au maximum chacun.`);
    }
    try {
      const { value: all, at } = await alertList(ctx, op);
      const nowSec = Math.floor(ctx.now() / 1000);
      const routeSet = new Set(routes);
      const stopSet = new Set(stops);
      const stations = op === 'sncb' ? new Set(stops.map(sncbStation)) : null;
      const body: AlertsResponse = {
        op,
        fetchedAt: iso(at),
        alerts: all
          .filter((a) => isActive(a, nowSec) && matches(a, routeSet, stopSet, stations))
          .map(({ id, routes: r, stops: s, header, active }) => ({ id, routes: r, stops: s, header, active })),
      };
      return json(body, 200, true);
    } catch (e) {
      const body: AlertsResponse = {
        op, fetchedAt: iso(ctx.now()), alerts: [],
        error: `Alertes ${OP_LABEL[op]} indisponibles : ${lcFirst(userError(e, ctx))}`,
      };
      return json(body, 200, false);
    }
  });
}

/* ------------------------------ /api/health ------------------------------ */

type SourceState = HealthResponse['sources']['sncb'];

async function check(ctx: Ctx, src: Source): Promise<SourceState> {
  try {
    const { ms } = await probe(ctx, src, ctx.timeouts.health);
    return { ok: true, ms };
  } catch (e) {
    return { ok: false, error: userError(e, ctx) };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function readMeta(ctx: Ctx, cfg: RelayConfig): Promise<HealthResponse['data']> {
  const src = metaSource(cfg);
  if (!src) return undefined;
  try {
    const { data } = await fetchJson(ctx, src, ctx.timeouts.health);
    if (!isObj(data) || typeof data.generatedAt !== 'string') {
      throw new UpstreamError('meta.json illisible', `${src.label} : champ generatedAt absent`);
    }
    const feeds = isObj(data.feeds) ? (data.feeds as Meta['feeds']) : undefined;
    const gen = Date.parse(data.generatedAt);
    const fresh = Number.isFinite(gen) && ctx.now() - gen <= LIMITS.dataMaxAgeH * 3_600_000;
    const feedsOk = !feeds || Object.values(feeds).every((f) => isObj(f) && f.ok === true);
    if (!fresh) ctx.log.warn(`${src.label} : données de nuit de plus de ${LIMITS.dataMaxAgeH} h (${data.generatedAt})`);
    const out: NonNullable<HealthResponse['data']> = { generatedAt: data.generatedAt, ok: fresh && feedsOk };
    if (feeds) out.feeds = feeds;
    return out;
  } catch (e) {
    userError(e, ctx);
    return { generatedAt: '', ok: false };
  }
}

/**
 * `ok` : temps réel et données de nuit (comme en 1.0). Les services d'adresses ont leur propre état dans `geocode`
 * et ne changent pas `ok` (une recherche d'adresse en panne laisse gares et arrêts).
 */
export async function handleHealth(_req: Request, ctx: Ctx): Promise<Response> {
  return guard(ctx, async () => {
    const cfg = readConfig(ctx.env);
    const [sncb, delijn, tec, stib, data, geocode] = await Promise.all([
      check(ctx, tripUpdatesSource(cfg, 'sncb')),
      check(ctx, tripUpdatesSource(cfg, 'delijn')),
      check(ctx, tripUpdatesSource(cfg, 'tec')),
      check(ctx, stibSource(cfg, 'limit=1')),
      readMeta(ctx, cfg),
      geocodeHealth(ctx),
    ]);
    const sources = { sncb, delijn, tec, stib };
    const ok = Object.values(sources).every((s) => s.ok) && (data ? data.ok : true);
    const body: HealthResponse = data
      ? { ok, time: iso(ctx.now()), data, sources, geocode, version: RELAY_VERSION }
      : { ok, time: iso(ctx.now()), sources, geocode, version: RELAY_VERSION };
    return json(body, 200, ok);
  });
}
