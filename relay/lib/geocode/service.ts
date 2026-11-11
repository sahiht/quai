/**
 * GET /api/geocode?q=texte&lang=fr|nl (GeocodeResponse) et état des services pour /api/health
 * (design-routing.md § 6.3 et § 6.4, PRD M4).
 *
 * Vie privée : seuls q et lang sont lus dans la requête et seul le texte (avec la langue) part vers les services
 * officiels, avec un User-Agent générique. Le journal ne contient jamais q ni l'adresse IP : longueur, langue,
 * aiguillage, sources, durées, nombre de résultats, statut.
 */
import { createHash } from 'node:crypto';
import type { GeocodeResponse, HealthResponse } from '../shared/types.js';
import { GEO_LIMITS, USER_AGENT, readGeoConfig, type GeoConfig, type GeoId } from '../config.js';
import type { Ctx } from '../context.js';
import { CACHE_GEO, CACHE_GEO_EMPTY, CACHE_NONE, badRequest, jsonWith, requestUrl } from '../http.js';
import { errorText } from '../log.js';
import { routeQuery, type Routing } from './communes.js';
import { queryInfo, rankCandidates, toResult, type Candidate } from './rank.js';
import { FormatError, REGION_NAME, SERVICE_NAME, attribution, parseSource, sourceUrl } from './sources.js';
import type { CachedAnswer, GeoState } from './state.js';
import { BAD_LANG, cleanLang, cleanQuery, tokens, type Lang } from './text.js';

export const ALL_DOWN = 'Recherche d’adresse indisponible pour l’instant : gares et arrêts seulement.';
export const TOO_MANY = 'Trop de recherches d’adresses : réessaie dans une minute.';
const INTERNAL = 'Erreur interne du relais';

const seconds = (ms: number) => String(Math.round(ms / 10) / 100).replace('.', ',');
const iso = (ms: number) => new Date(ms).toISOString();

/** Messages par source (texte en français, sans adresse ni texte tapé). */
export const geoMessages = {
  timeout: (ms: number) => `Délai dépassé (${seconds(ms)} s)`,
  unreadable: (id: GeoId) => `Réponse illisible du ${SERVICE_NAME[id]}`,
  http: (id: GeoId, status: number) => (status === 429
    ? `Trop de requêtes, limite du ${SERVICE_NAME[id]} atteinte (HTTP 429)`
    : `Réponse HTTP ${status} du ${SERVICE_NAME[id]}`),
  network: (id: GeoId) => `${SERVICE_NAME[id].charAt(0).toUpperCase()}${SERVICE_NAME[id].slice(1)} injoignable`,
  tooLarge: (id: GeoId) => `Réponse trop volumineuse du ${SERVICE_NAME[id]}`,
  busy: (id: GeoId) => `Trop de recherches en cours vers le ${SERVICE_NAME[id]}`,
  open: (id: GeoId) => `Service des adresses de ${REGION_NAME[id]} indisponible`,
  notTried: 'Pas encore interrogé',
};

/* ------------------------------ Une source ------------------------------ */

export type Outcome =
  | { id: GeoId; ok: true; ms: number; cands: Candidate[] }
  | { id: GeoId; ok: false; ms?: number; error: string; skipped?: boolean };

class SourceFailure extends Error {
  constructor(readonly userMessage: string, detail: string, readonly counts = true) {
    super(detail);
    this.name = 'SourceFailure';
  }
}

async function readBody(res: Response, max: number, id: GeoId): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new SourceFailure(geoMessages.tooLarge(id), `réponse de plus de ${max} octets`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Attend une place parmi les requêtes en cours de la source (4 au plus), jusqu'à l'échéance. */
function acquire(state: GeoState, id: GeoId, deadline: number): Promise<boolean> {
  const slot = state.busy[id];
  if (slot.active < GEO_LIMITS.inflightPerSource) {
    slot.active++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const take = () => {
      clearTimeout(timer);
      slot.active++;
      resolve(true);
    };
    const timer = setTimeout(() => {
      const i = slot.queue.indexOf(take);
      if (i >= 0) slot.queue.splice(i, 1);
      resolve(false);
    }, Math.max(0, deadline - performance.now()));
    slot.queue.push(take);
  });
}

function release(state: GeoState, id: GeoId): void {
  const slot = state.busy[id];
  slot.active = Math.max(0, slot.active - 1);
  const next = slot.queue.shift();
  if (next) next();
}

function breakerOpen(ctx: Ctx, id: GeoId): boolean {
  const b = ctx.caches.geo.breaker[id];
  return b.fails >= GEO_LIMITS.breakerFailures && ctx.now() < b.openUntil;
}

function recordOutcome(ctx: Ctx, o: Outcome, counts: boolean): void {
  const state = ctx.caches.geo;
  const b = state.breaker[o.id];
  if (o.ok) {
    b.fails = 0;
    b.openUntil = 0;
  } else if (counts) {
    b.fails++;
    if (b.fails >= GEO_LIMITS.breakerFailures) {
      if (b.fails === GEO_LIMITS.breakerFailures || ctx.now() >= b.openUntil) {
        ctx.log.warn(`adresses : ${SERVICE_NAME[o.id]} écarté ${GEO_LIMITS.breakerOpenMs / 1000} s après ${b.fails} échecs de suite`);
      }
      b.openUntil = ctx.now() + GEO_LIMITS.breakerOpenMs;
    }
  }
  state.status[o.id] = o.ok ? { ok: true, ms: o.ms, at: ctx.now() } : { ok: false, error: o.error, at: ctx.now() };
}

/**
 * Interroge un service : disjoncteur (sauf sonde de santé), place libre, délai propre et échéance totale.
 * Ne lève jamais : rend un Outcome.
 */
export async function querySource(
  ctx: Ctx, cfg: GeoConfig, id: GeoId, q: string, lang: Lang,
  opts: { timeoutMs: number; deadline: number; total?: AbortSignal; probe?: boolean },
): Promise<Outcome> {
  const state = ctx.caches.geo;
  if (!opts.probe && breakerOpen(ctx, id)) return { id, ok: false, error: geoMessages.open(id), skipped: true };
  const t0 = performance.now();
  if (!(await acquire(state, id, Math.min(opts.deadline, t0 + opts.timeoutMs)))) {
    // service non interrogé : ni le disjoncteur ni l'état de santé ne changent
    return { id, ok: false, ms: Math.round(performance.now() - t0), error: geoMessages.busy(id) };
  }
  const own = AbortSignal.timeout(Math.max(1, Math.round(opts.timeoutMs - (performance.now() - t0))));
  const signal = opts.total ? AbortSignal.any([own, opts.total]) : own;
  let outcome: Outcome;
  let counts = true;
  try {
    let res: Response;
    try {
      res = await ctx.fetch(sourceUrl(cfg, id, q, lang), {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
        redirect: 'follow',
      });
    } catch (e) {
      throw classify(e, id, opts.timeoutMs);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SourceFailure(geoMessages.http(id, res.status), `HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    }
    let text: string;
    try {
      text = await readBody(res, GEO_LIMITS.maxBodyBytes, id);
    } catch (e) {
      throw e instanceof SourceFailure ? e : classify(e, id, opts.timeoutMs);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new SourceFailure(geoMessages.unreadable(id), `JSON invalide (${text.length} caractères)`);
    }
    let cands: Candidate[];
    try {
      cands = parseSource(id, body, lang);
    } catch (e) {
      throw new SourceFailure(geoMessages.unreadable(id), e instanceof FormatError ? `format inattendu : ${e.message}` : errorText(e));
    }
    outcome = { id, ok: true, ms: Math.round(performance.now() - t0), cands };
  } catch (e) {
    const f = e instanceof SourceFailure ? e : new SourceFailure(geoMessages.unreadable(id), errorText(e));
    counts = f.counts;
    outcome = { id, ok: false, ms: Math.round(performance.now() - t0), error: f.userMessage };
    ctx.log.warn(`adresses : ${SERVICE_NAME[id]} en échec (${f.message}) en ${outcome.ms} ms`);
  } finally {
    release(state, id);
  }
  recordOutcome(ctx, outcome, counts);
  return outcome;
}

function classify(e: unknown, id: GeoId, timeoutMs: number): SourceFailure {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'TimeoutError' || name === 'AbortError') return new SourceFailure(geoMessages.timeout(timeoutMs), `délai dépassé (${timeoutMs} ms)`);
  return new SourceFailure(geoMessages.network(id), errorText(e));
}

/* ------------------------------ Une recherche ------------------------------ */

interface Computed {
  answer: Omit<CachedAnswer, 'at' | 'ttl'>;
  complete: boolean;
  error?: string;
  routing: Routing;
  called: GeoId[];
  ms: number;
}

/** Sources à interroger et repli : Bruxelles par le service flamand (il couvre aussi Bruxelles, noms néerlandais). */
function plan(routing: Routing, cfg: GeoConfig): { primary: GeoId[]; fallback: Partial<Record<GeoId, GeoId>> } {
  const enabled = (id: GeoId) => cfg.sources.includes(id);
  if (!routing.regions) return { primary: [...cfg.sources], fallback: {} };
  const primary: GeoId[] = [];
  const fallback: Partial<Record<GeoId, GeoId>> = {};
  for (const r of routing.regions) {
    if (enabled(r)) {
      if (!primary.includes(r)) primary.push(r);
      if (r === 'bru' && enabled('vla')) fallback.bru = 'vla';
    } else if (r === 'bru' && enabled('vla') && !primary.includes('vla')) primary.push('vla');
  }
  return { primary: cfg.sources.filter((s) => primary.includes(s)), fallback };
}

async function compute(ctx: Ctx, cfg: GeoConfig, q: string, lang: Lang): Promise<Computed> {
  const t0 = performance.now();
  const total = ctx.timeouts.geoTotal;
  const perSource = ctx.timeouts.geoSource;
  const deadline = t0 + total;
  const totalSignal = AbortSignal.timeout(total);
  const toks = tokens(q);
  const routing = routeQuery(toks);
  const { primary, fallback } = plan(routing, cfg);
  const outcomes: Outcome[] = [];
  const started = new Set<GeoId>();

  const run = async (id: GeoId, timeoutMs: number): Promise<void> => {
    started.add(id);
    const o = await querySource(ctx, cfg, id, q, lang, { timeoutMs, deadline, total: totalSignal });
    outcomes.push(o);
    const fb = fallback[id];
    const left = Math.floor(deadline - performance.now());
    if (!o.ok && fb && !started.has(fb) && left >= GEO_LIMITS.fallbackMinMs) await run(fb, Math.min(perSource, left));
  };
  await Promise.all(primary.map((id) => run(id, perSource)));

  const sources: GeocodeResponse['sources'] = {};
  for (const id of cfg.sources) {
    const o = outcomes.find((x) => x.id === id);
    if (!o) continue;
    sources[id] = o.ok ? { ok: true, ms: o.ms, n: o.cands.length } : o.ms === undefined ? { ok: false, error: o.error } : { ok: false, ms: o.ms, error: o.error };
  }
  const good = outcomes.filter((o): o is Extract<Outcome, { ok: true }> => o.ok);
  const qi = queryInfo(q, routing.postcode);
  const ranked = rankCandidates(good.flatMap((o) => o.cands), qi, cfg.sources);
  const results = ranked.slice(0, GEO_LIMITS.maxResults).map((s) => toResult(s, lang));
  const allFailed = outcomes.length === 0 || good.length === 0;
  return {
    answer: { results, sources, attribution: attribution(cfg.sources) },
    complete: !allFailed && good.length === outcomes.length,
    error: allFailed ? ALL_DOWN : undefined,
    routing,
    called: outcomes.map((o) => o.id),
    ms: Math.round(performance.now() - t0),
  };
}

/* ------------------------------ Cache et limite par client ------------------------------ */

function cacheGet(ctx: Ctx, key: string): CachedAnswer | null {
  const cache = ctx.caches.geo.cache;
  const hit = cache.get(key);
  if (!hit) return null;
  const age = ctx.now() - hit.at;
  if (age < 0 || age >= hit.ttl) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet(ctx: Ctx, key: string, value: CachedAnswer): void {
  const cache = ctx.caches.geo.cache;
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > GEO_LIMITS.cacheEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Adresse IP du client (Vercel : x-real-ip, x-forwarded-for), jamais journalisée ni gardée en clair. */
function clientKey(req: Request, salt: string): string | null {
  const ip = (req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  if (!ip) return null;
  return createHash('sha256').update(`${salt}|${ip}`).digest('base64url').slice(0, 22);
}

function rateLimited(ctx: Ctx, req: Request): boolean {
  const state = ctx.caches.geo;
  const key = clientKey(req, state.salt);
  if (!key) return false;
  const now = ctx.now();
  const recent = (state.rate.get(key) ?? []).filter((t) => now - t >= 0 && now - t < 60_000);
  state.rate.delete(key);
  if (recent.length >= GEO_LIMITS.ratePerMinute) {
    state.rate.set(key, recent);
    return true;
  }
  recent.push(now);
  state.rate.set(key, recent);
  while (state.rate.size > GEO_LIMITS.rateMaxClients) {
    const oldest = state.rate.keys().next();
    if (oldest.done) break;
    state.rate.delete(oldest.value);
  }
  return false;
}

/* ------------------------------ Point d'entrée ------------------------------ */

function warnConfig(ctx: Ctx, cfg: GeoConfig): void {
  const w = ctx.caches.geo.warned;
  if (cfg.googleKey && !w.has('google')) {
    w.add('google');
    ctx.log.warn('adresses : GOOGLE_GEOCODING_KEY est définie, mais Google n’est pas branché en 1.1 : la clé n’est jamais utilisée.');
  }
  if (cfg.ignored.length && !w.has('ignored')) {
    w.add('ignored');
    ctx.log.warn(`adresses : GEOCODE_SOURCES, entrées ignorées : ${cfg.ignored.join(', ')} (vla, bru, wal seulement)`);
  }
}

function describe(r: Routing): string {
  return r.regions ? `${r.by} → ${r.regions.join('+')}` : 'aucun → toutes les sources';
}

export async function handleGeocode(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const url = requestUrl(req);
    const lang = cleanLang(url.searchParams.get('lang'));
    const checked = cleanQuery(url.searchParams.get('q'));
    if ('error' in checked) return badRequest(checked.error);
    if (!lang) return badRequest(BAD_LANG);
    const { q } = checked;
    const len = [...q].length;
    const cfg = readGeoConfig(ctx.env);
    warnConfig(ctx, cfg);

    if (rateLimited(ctx, req)) {
      ctx.log.warn(`adresses : ${len} car., limite de ${GEO_LIMITS.ratePerMinute} recherches par minute atteinte pour un client (429)`);
      const body: GeocodeResponse = { q, fetchedAt: iso(ctx.now()), results: [], sources: {}, attribution: attribution(cfg.sources), error: TOO_MANY };
      return jsonWith(body, 429, CACHE_NONE, { 'Retry-After': '60' });
    }

    const key = `${lang}|${q.toLowerCase()}`;
    const hit = cacheGet(ctx, key);
    if (hit) {
      ctx.log.info(`adresses : ${len} car., ${lang}, cache de l’instance, ${hit.results.length} résultat(s), statut 200`);
      const body: GeocodeResponse = { q, fetchedAt: iso(hit.at), results: hit.results, sources: hit.sources, attribution: hit.attribution };
      return jsonWith(body, 200, hit.results.length ? CACHE_GEO : CACHE_GEO_EMPTY);
    }

    const state = ctx.caches.geo;
    let pending = state.inflight.get(key) as Promise<Computed> | undefined;
    if (!pending) {
      pending = compute(ctx, cfg, q, lang);
      state.inflight.set(key, pending);
      const done = () => {
        if (state.inflight.get(key) === pending) state.inflight.delete(key);
      };
      pending.then(done, done);
    }
    const c = await pending;
    const at = ctx.now();
    const body: GeocodeResponse = c.complete
      ? { q, fetchedAt: iso(at), results: c.answer.results, sources: c.answer.sources, attribution: c.answer.attribution }
      : { q, fetchedAt: iso(at), results: c.answer.results, sources: c.answer.sources, partial: true, attribution: c.answer.attribution };
    if (c.error) body.error = c.error;
    if (c.complete) {
      cacheSet(ctx, key, { ...c.answer, at, ttl: c.answer.results.length ? GEO_LIMITS.cacheTtlMs : GEO_LIMITS.emptyTtlMs });
    }
    const states = Object.entries(c.answer.sources)
      .map(([id, s]) => (s?.ok ? `${id} ok ${s.n} rés. ${s.ms} ms` : `${id} erreur « ${s?.error} »`)).join(', ');
    ctx.log.info(
      `adresses : ${len} car., ${lang}, aiguillage ${describe(c.routing)}, ${states || 'aucune source'} ; `
      + `${c.answer.results.length} résultat(s) en ${c.ms} ms${c.complete ? '' : ', réponse partielle'}, statut 200`,
    );
    const cache = c.complete ? (c.answer.results.length ? CACHE_GEO : CACHE_GEO_EMPTY) : CACHE_NONE;
    return jsonWith(body, 200, cache);
  } catch (e) {
    ctx.log.error(`adresses : erreur interne, ${errorText(e)}`);
    return jsonWith({ error: INTERNAL }, 500, CACHE_NONE);
  }
}

/* ------------------------------ Santé ------------------------------ */

/** Texte de la requête de test de /api/health. */
export const HEALTH_QUERY = 'Namur';

/**
 * État des services activés : dernier état connu (vraies recherches ou sonde) s'il a moins de 10 min, sinon une
 * requête de test « Namur » (une seule à la fois par service).
 */
export async function geocodeHealth(ctx: Ctx): Promise<NonNullable<HealthResponse['geocode']>> {
  const cfg = readGeoConfig(ctx.env);
  const state = ctx.caches.geo;
  const out: NonNullable<HealthResponse['geocode']> = {};
  await Promise.all(cfg.sources.map(async (id) => {
    const known = state.status[id];
    const age = known ? ctx.now() - known.at : Infinity;
    if (!known || age < 0 || age >= GEO_LIMITS.healthEveryMs) {
      let probing = state.probing[id];
      if (!probing) {
        const t0 = performance.now();
        probing = querySource(ctx, cfg, id, HEALTH_QUERY, 'fr', { timeoutMs: ctx.timeouts.geoSource, deadline: t0 + ctx.timeouts.geoSource, probe: true })
          .then(() => undefined, () => undefined)
          .finally(() => {
            if (state.probing[id] === probing) delete state.probing[id];
          });
        state.probing[id] = probing;
      }
      await probing;
    }
    const s = state.status[id];
    out[id] = !s ? { ok: false, error: geoMessages.notTried } : s.ok ? { ok: true, ms: s.ms } : { ok: false, error: s.error };
  }));
  const ordered: NonNullable<HealthResponse['geocode']> = {};
  for (const id of cfg.sources) if (out[id]) ordered[id] = out[id];
  return ordered;
}
