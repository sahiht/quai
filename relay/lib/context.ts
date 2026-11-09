/**
 * Contexte d'exécution des gestionnaires : environnement, fetch, horloge, journal, caches, délais.
 * En production : defaultCtx() (process.env, fetch global, caches partagés par l'instance).
 * Les tests construisent leur propre contexte (fetch simulé, horloge fixe, journal capturé).
 */
import { LIMITS, type Env } from './config.js';
import { BatchCache, TtlCache } from './cache.js';
import { createLogger, type Logger } from './log.js';
import type { AlertItem, TripIndex } from './gtfsrt.js';
import type { StibGroup } from './stib.js';

export interface Caches {
  trips: TtlCache<TripIndex>;
  alerts: TtlCache<AlertItem[]>;
  stib: BatchCache<StibGroup[]>;
  /** Dernier message « clé absente » journalisé (pour ne pas le répéter à chaque requête). */
  state: { missingKeyLoggedAt: number | null };
  clear(): void;
}

export function createCaches(ttlMs: number = LIMITS.cacheTtlMs): Caches {
  const caches: Caches = {
    trips: new TtlCache<TripIndex>(ttlMs),
    alerts: new TtlCache<AlertItem[]>(ttlMs),
    stib: new BatchCache<StibGroup[]>(ttlMs),
    state: { missingKeyLoggedAt: null },
    clear() {
      caches.trips.clear();
      caches.alerts.clear();
      caches.stib.clear();
      caches.state.missingKeyLoggedAt = null;
    },
  };
  return caches;
}

export interface Ctx {
  env: Env;
  fetch: typeof fetch;
  /** Horloge en epoch ms. */
  now: () => number;
  log: Logger;
  caches: Caches;
  timeouts: { upstream: number; health: number };
}

const shared = createCaches();
let clockOffsetMs = 0;

/** Serveur de développement seulement : l'horloge du relais part de `iso` puis avance normalement. */
export function setDevClock(iso: string): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  clockOffsetMs = t - Date.now();
  return true;
}

/** Serveur de développement seulement : vide les caches de l'instance. */
export function clearSharedCaches(): void {
  shared.clear();
}

export function defaultCtx(): Ctx {
  return {
    env: process.env,
    fetch: ((input, init) => globalThis.fetch(input, init)) as typeof fetch,
    now: () => Date.now() + clockOffsetMs,
    log: createLogger(process.env),
    caches: shared,
    timeouts: { upstream: LIMITS.upstreamTimeoutMs, health: LIMITS.healthTimeoutMs },
  };
}
