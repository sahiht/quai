/**
 * Accès réseau minimal : GET texte avec délai maximal (le fetch injecté peut ignorer le signal).
 */

export type FetchLike = (url: string, init?: { signal?: AbortSignal; cache?: 'no-store' }) => Promise<Response>;

export class TimeoutError extends Error {
  constructor() {
    super('délai dépassé');
    this.name = 'TimeoutError';
  }
}

export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/**
 * Le fetch du navigateur doit être appelé avec `this` = globalThis (sinon « Illegal invocation »).
 */
export function makeFetch(f?: typeof fetch): FetchLike {
  if (f) return (url, init) => f.call(globalThis, url, init);
  return (url, init) => globalThis.fetch(url, init);
}

/**
 * GET avec délai maximal ; renvoie le statut et le corps (jamais d'exception sur un statut HTTP).
 * `noStore` : ne pas passer par le cache HTTP de la WebView (temps réel : voir RealtimeClient).
 */
export async function getText(fetchFn: FetchLike, url: string, timeoutMs: number, noStore = false): Promise<{ status: number; text: string }> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        ctrl?.abort();
      } catch {
        /* rien */
      }
      reject(new TimeoutError());
    }, timeoutMs);
  });
  const run = (async () => {
    const init = { ...(ctrl ? { signal: ctrl.signal } : {}), ...(noStore ? { cache: 'no-store' as const } : {}) };
    const res = await fetchFn(url, ctrl || noStore ? init : undefined);
    const text = await res.text();
    return { status: res.status, text };
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Le téléphone se dit hors ligne (WebView : navigator.onLine). Inconnu = en ligne. */
export function isOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine === false;
}

/** Résout `p`, ou 'late' si `ms` passe avant (p continue en arrière-plan). */
export async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés (ordre des résultats conservé). */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}
