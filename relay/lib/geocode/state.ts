/**
 * État des adresses dans une instance de fonction : cache des réponses, disjoncteurs, requêtes en cours par source,
 * limite par client, dernier état connu de chaque service (pour /api/health).
 * Aucune adresse IP n'est gardée en clair : seulement une empreinte salée, propre à l'instance, effacée après 1 min.
 */
import { randomBytes } from 'node:crypto';
import type { GeocodeResult, GeocodeResponse } from '../shared/types.js';
import { GEO_IDS, type GeoId } from '../config.js';

export interface CachedAnswer {
  results: GeocodeResult[];
  sources: GeocodeResponse['sources'];
  attribution: string;
  at: number;
  ttl: number;
}

export interface SourceStatus { ok: boolean; ms?: number; error?: string; at: number }

export interface GeoState {
  cache: Map<string, CachedAnswer>;
  inflight: Map<string, Promise<unknown>>;
  breaker: Record<GeoId, { fails: number; openUntil: number }>;
  busy: Record<GeoId, { active: number; queue: (() => void)[] }>;
  rate: Map<string, number[]>;
  status: Partial<Record<GeoId, SourceStatus>>;
  probing: Partial<Record<GeoId, Promise<void>>>;
  /** Sel des empreintes de clients (aléatoire, propre à l'instance). */
  salt: string;
  /** Avertissements de configuration déjà journalisés. */
  warned: Set<string>;
  clear(): void;
}

const perSource = <T>(make: () => T) => Object.fromEntries(GEO_IDS.map((id) => [id, make()])) as Record<GeoId, T>;

export function createGeoState(): GeoState {
  const state: GeoState = {
    cache: new Map(),
    inflight: new Map(),
    breaker: perSource(() => ({ fails: 0, openUntil: 0 })),
    busy: perSource(() => ({ active: 0, queue: [] })),
    rate: new Map(),
    status: {},
    probing: {},
    salt: randomBytes(16).toString('hex'),
    warned: new Set(),
    clear() {
      state.cache.clear();
      state.inflight.clear();
      state.rate.clear();
      state.status = {};
      state.probing = {};
      state.warned.clear();
      for (const id of GEO_IDS) state.breaker[id] = { fails: 0, openUntil: 0 };
      // les requêtes en cours gardent leur place : elles la rendront en finissant
    },
  };
  return state;
}
