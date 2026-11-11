/**
 * Adresses (PRD M4, design-routing.md § 6.5) : client du relais GET /api/geocode, commun au vrai cœur et au faux
 * cœur (qui lui donne un faux transport).
 *  - Vie privée : seuls `q` (texte tapé) et `lang` partent du téléphone ; jamais la position, jamais un identifiant.
 *  - 3 caractères au moins, sinon aucun résultat (sans requête).
 *  - Cache mémoire par texte normalisé et langue (les réponses complètes seulement).
 *  - Erreurs distinguées : 'offline' (téléphone hors ligne : « Recherche d'adresse impossible sans connexion… »),
 *    'down' (relais ou services en panne : « Adresses indisponibles pour l'instant… »). Jamais d'exception.
 *  - Tri local : à score égal, les plus proches de `near` d'abord ; 4 résultats au plus.
 */
import type { GeocodeResponse, GeocodeResult } from '../../../shared/types';
import { normalizeForSearch } from '../../../shared/names';
import type { GeocodeAnswer, LatLon } from './api';
import { getText, isOffline, safeJson, type FetchLike } from './net';
import { distanceM } from './util';

export const GEOCODE_MIN_CHARS = 3;
export const GEOCODE_MAX = 4;
/** Délai maximal d'une requête (le relais répond en 2,5 s au plus). */
export const GEOCODE_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 100;

export class GeoError extends Error {
  constructor(readonly kind: 'down' | 'offline') {
    super(kind === 'offline' ? 'hors ligne' : 'service d’adresses indisponible');
    this.name = 'GeoError';
  }
}

/** Requête d'adresses : rend la réponse du relais, ou lève GeoError. */
export type GeoTransport = (q: string, lang: 'fr' | 'nl') => Promise<GeocodeResponse>;

/** Texte envoyé : espaces resserrés, 100 caractères au plus (comme le contrôle du relais). */
export function geoQuery(q: string): string {
  return (q ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function isResult(x: unknown): x is GeocodeResult {
  return isObj(x) && typeof x.label === 'string' && typeof x.lat === 'number' && typeof x.lon === 'number' && Number.isFinite(x.lat) && Number.isFinite(x.lon);
}

/** Transport réel : GET {relayBase}/api/geocode?q=…&lang=… (seuls q et lang). */
export function relayGeoTransport(relayBase: string, fetchFn: FetchLike, timeoutMs = GEOCODE_TIMEOUT_MS): GeoTransport {
  return async (q, lang) => {
    let r: { status: number; text: string };
    try {
      r = await getText(fetchFn, `${relayBase}/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`, timeoutMs, true);
    } catch {
      throw new GeoError(isOffline() ? 'offline' : 'down');
    }
    const body = r.status === 200 ? safeJson(r.text) : undefined;
    if (!isObj(body) || !Array.isArray(body.results)) throw new GeoError('down');
    const results = body.results.filter(isResult);
    if (typeof body.error === 'string' && body.error && !results.length) throw new GeoError('down');
    return { ...(body as unknown as GeocodeResponse), results };
  };
}

/** À score égal (suites consécutives de même score), les plus proches de `near` d'abord ; l'ordre du relais sinon. */
export function sortByProximity(results: readonly GeocodeResult[], near: LatLon | null | undefined): GeocodeResult[] {
  if (!near) return [...results];
  const out: GeocodeResult[] = [];
  let run: GeocodeResult[] = [];
  const flush = () => {
    out.push(...run.map((r, i) => ({ r, i, d: distanceM(near, r) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.r));
    run = [];
  };
  for (const r of results) {
    if (run.length && Math.abs((run[0].score ?? 0) - (r.score ?? 0)) > 1e-9) flush();
    run.push(r);
  }
  flush();
  return out;
}

export class GeocodeClient {
  private readonly cache = new Map<string, { at: number; res: GeocodeResponse }>();

  constructor(
    private readonly transport: GeoTransport,
    private readonly now: () => number,
  ) {}

  async geocode(q: string, lang: 'fr' | 'nl', near?: LatLon | null): Promise<GeocodeAnswer> {
    const text = geoQuery(q);
    const key = normalizeForSearch(text);
    if (key.replace(/ /g, '').length < GEOCODE_MIN_CHARS) return { results: [] };
    const l: 'fr' | 'nl' = lang === 'nl' ? 'nl' : 'fr';
    const ck = `${l}|${key}`;
    const t = this.now();
    let res: GeocodeResponse;
    const hit = this.cache.get(ck);
    if (hit && t - hit.at < CACHE_TTL_MS && t >= hit.at) {
      res = hit.res;
      this.cache.delete(ck);
      this.cache.set(ck, hit);
    } else {
      try {
        res = await this.transport(text, l);
      } catch (e) {
        return { results: [], error: e instanceof GeoError ? e.kind : isOffline() ? 'offline' : 'down' };
      }
      if (!res.partial) {
        this.cache.set(ck, { at: t, res });
        while (this.cache.size > CACHE_MAX) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
      }
    }
    const out: GeocodeAnswer = { results: sortByProximity(res.results, near).slice(0, GEOCODE_MAX) };
    if (res.partial) out.partial = true;
    if (res.attribution) out.attribution = res.attribution;
    return out;
  }
}
