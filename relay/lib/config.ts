/**
 * Configuration du relais : variables d'environnement, limites et adresses des sources.
 * Aucune clé n'est écrite ici : tout vient de l'environnement (BMC_KEY, BMC_BASE, SNCB_RT_URL, DATA_BASE).
 */

export type Env = Record<string, string | undefined>;
export type RtOp = 'sncb' | 'delijn' | 'tec';
export type SourceOp = RtOp | 'stib';

export const RT_OPS: readonly RtOp[] = ['sncb', 'delijn', 'tec'];

/** Identifiants des flux sur le portail BMC. */
export const SLUG: Record<SourceOp, string> = { sncb: 'nmbssncb', delijn: 'delijn', tec: 'tec', stib: 'stibmivb' };

/** Noms affichés dans les messages d'erreur. */
export const OP_LABEL: Record<SourceOp, string> = { sncb: 'SNCB', delijn: 'De Lijn', tec: 'TEC', stib: 'STIB' };

/** Langue par défaut d'une traduction sans code de langue dans les alertes. */
export const DEFAULT_LANG: Record<RtOp, 'fr' | 'nl'> = { sncb: 'fr', delijn: 'nl', tec: 'fr' };

export const DEFAULT_BMC_BASE = 'https://api-management-opendata-production.azure-api.net';

export const LIMITS = {
  /** Voyages par appel à /api/rt. */
  trips: 60,
  /** Arrêts STIB (pointid) par appel à /api/stib. */
  points: 30,
  /** Lignes ou arrêts par appel à /api/alerts. */
  alertFilters: 200,
  /** Longueur maximale d'un identifiant reçu en paramètre. */
  idLength: 256,
  /** Cache mémoire par flux. */
  cacheTtlMs: 25_000,
  /** Délai maximal d'une requête vers une source. */
  upstreamTimeoutMs: 8_000,
  /** Délai maximal d'une sonde de /api/health. */
  healthTimeoutMs: 3_000,
  /** Taille de page de l'API STIB (Opendatasoft : 100 au maximum). */
  stibPageSize: 100,
  stibMaxPages: 10,
  /** Âge maximal des données de nuit (meta.json) pour être jugées à jour. */
  dataMaxAgeH: 48,
  /** Flux DIFFERENTIAL : un voyage non revu depuis ce délai est oublié. */
  differentialMaxAgeMs: 10 * 60_000,
} as const;

export interface RelayConfig {
  key: string | null;
  base: string;
  sncbRtUrl: string | null;
  dataBase: string | null;
}

const clean = (v: string | undefined) => (v ?? '').trim();

export function readConfig(env: Env): RelayConfig {
  return {
    key: clean(env.BMC_KEY) || null,
    base: (clean(env.BMC_BASE) || DEFAULT_BMC_BASE).replace(/\/+$/, ''),
    sncbRtUrl: clean(env.SNCB_RT_URL) || null,
    dataBase: clean(env.DATA_BASE).replace(/\/+$/, '') || null,
  };
}

/** Une source amont. `auth` : envoyer la clé BMC (jamais vers une autre adresse que BMC_BASE). */
export interface Source {
  id: string;
  kind: 'bmc' | 'sncb-direct' | 'data';
  /** Libellé pour les journaux (sans adresse ni clé). */
  label: string;
  url: string;
  auth: boolean;
}

export function tripUpdatesSource(cfg: RelayConfig, op: RtOp): Source {
  if (op === 'sncb' && cfg.sncbRtUrl) {
    return { id: 'rt:sncb:direct', kind: 'sncb-direct', label: 'SNCB flux direct (SNCB_RT_URL)', url: cfg.sncbRtUrl, auth: false };
  }
  const slug = SLUG[op];
  return {
    id: `rt:${op}:bmc`,
    kind: 'bmc',
    label: `BMC ${slug}/rt/trip-update`,
    url: `${cfg.base}/api/gtfs/feed/${slug}/rt/trip-update?format=protobuf`,
    auth: true,
  };
}

export function alertsSource(cfg: RelayConfig, op: RtOp): Source {
  const slug = SLUG[op];
  return {
    id: `alerts:${op}`,
    kind: 'bmc',
    label: `BMC ${slug}/rt/alert`,
    url: `${cfg.base}/api/gtfs/feed/${slug}/rt/alert?format=protobuf`,
    auth: true,
  };
}

/** `query` : chaîne de requête déjà encodée (sans « ? »). */
export function stibSource(cfg: RelayConfig, query: string): Source {
  return {
    id: 'stib',
    kind: 'bmc',
    label: 'BMC stibmivb/rt/WaitingTimes',
    url: `${cfg.base}/api/datasets/stibmivb/rt/WaitingTimes${query ? `?${query}` : ''}`,
    auth: true,
  };
}

export function metaSource(cfg: RelayConfig): Source | null {
  if (!cfg.dataBase) return null;
  return { id: 'meta', kind: 'data', label: 'DATA_BASE/meta.json', url: `${cfg.dataBase}/meta.json`, auth: false };
}
