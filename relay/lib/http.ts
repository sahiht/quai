/**
 * Réponses HTTP : JSON, CORS ouvert, cache CDN Vercel sur les succès seulement.
 */

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const CACHE_OK = 'public, s-maxage=20, stale-while-revalidate=40';
export const CACHE_NONE = 'no-store';
/** Adresses : réponse complète avec résultats (cache CDN 24 h, puis 7 jours en revalidation). */
export const CACHE_GEO = 'public, s-maxage=86400, stale-while-revalidate=604800';
/** Adresses : réponse complète sans résultat (10 min, comme le cache de l'instance). */
export const CACHE_GEO_EMPTY = 'public, s-maxage=600, stale-while-revalidate=600';

/** `cacheable` : réponse complète sans erreur (cache CDN 20 s), sinon no-store. */
export function json(body: unknown, status: number, cacheable: boolean): Response {
  return jsonWith(body, status, cacheable ? CACHE_OK : CACHE_NONE);
}

/** Réponse JSON avec un Cache-Control donné (et en-têtes supplémentaires éventuels). */
export function jsonWith(body: unknown, status: number, cacheControl: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400, false);
}

/** Réponse aux requêtes OPTIONS (pré-vérification CORS). */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}

export function requestUrl(req: Request): URL {
  return new URL(req.url, 'http://localhost');
}
