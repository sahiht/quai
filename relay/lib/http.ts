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

/** `cacheable` : réponse complète sans erreur (cache CDN 20 s), sinon no-store. */
export function json(body: unknown, status: number, cacheable: boolean): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheable ? CACHE_OK : CACHE_NONE,
      'X-Content-Type-Options': 'nosniff',
      ...CORS_HEADERS,
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
