/**
 * Configuration du relais : variables d'environnement, limites et adresses des sources.
 * Aucune clé n'est écrite ici : tout vient de l'environnement (BMC_KEY, BMC_BASE, SNCB_RT_URL, DATA_BASE ;
 * adresses : GEOCODE_SOURCES, QUAI_GEO_VLA_BASE, QUAI_GEO_BRU_BASE, QUAI_GEO_WAL_BASE, QUAI_GEO_BASE,
 * GOOGLE_GEOCODING_KEY).
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

/* ------------------------------ 1.1 : adresses (GET /api/geocode) ------------------------------ */

/** Version du relais, rendue par /api/health. */
export const RELAY_VERSION = '1.1.0';
/** En-tête User-Agent générique de toutes les requêtes du relais (aucun identifiant de l'appareil). */
export const USER_AGENT = 'quai-relay/1.1';

/** Services d'adresses officiels : Flandre (Digitaal Vlaanderen), Bruxelles (Paradigm), Wallonie (SPW). */
export type GeoId = 'vla' | 'bru' | 'wal';
export const GEO_IDS: readonly GeoId[] = ['vla', 'bru', 'wal'];

/**
 * Adresses de base des services (sans « / » final). Le relais ajoute :
 *  - vla : /Location?q={texte}&c=5 (Geolocation v4) ;
 *  - bru : /freeSearch/searchAnyObject?searchLanguage={fr|nl}&freeText={texte}&model=BeStPlus ;
 *  - wal : /searchAll?address={texte}&crs=EPSG:4326&geom=true&lang={fr|nl}&levels=1,2,3,4,7.
 */
export const DEFAULT_GEO_BASE: Readonly<Record<GeoId, string>> = {
  vla: 'https://geo.api.vlaanderen.be/geolocation/v4',
  bru: 'https://geoservices.irisnet.be/geocoding/api/v1/brussels/geocoding',
  wal: 'https://geoservices.wallonie.be/geocodeWS',
};

/** Chemins des trois services sous une base unique (QUAI_GEO_BASE : faux service d'adresses, npm run mock-geocode). */
export const GEO_MOCK_PATH: Readonly<Record<GeoId, string>> = {
  vla: '/geolocation/v4',
  bru: '/geocoding/api/v1/brussels/geocoding',
  wal: '/geocodeWS',
};

const GEO_ENV: Readonly<Record<GeoId, string>> = { vla: 'QUAI_GEO_VLA_BASE', bru: 'QUAI_GEO_BRU_BASE', wal: 'QUAI_GEO_WAL_BASE' };

export const GEO_LIMITS = {
  /** Longueur du texte (après nettoyage des espaces). */
  minChars: 3,
  maxChars: 100,
  /** Résultats rendus au plus. */
  maxResults: 8,
  /** Résultats demandés au service flamand (c, 5 au plus chez Digitaal Vlaanderen). */
  vlaCount: 5,
  /** Délai par source et délai total (PRD R1). */
  sourceTimeoutMs: 2_000,
  totalTimeoutMs: 2_500,
  /** Repli (Bruxelles par le service flamand) seulement s'il reste au moins ce temps. */
  fallbackMinMs: 400,
  /** Cache mémoire de l'instance. */
  cacheEntries: 500,
  cacheTtlMs: 24 * 3_600_000,
  emptyTtlMs: 10 * 60_000,
  /** 30 requêtes par minute et par adresse IP (par instance, au mieux). */
  ratePerMinute: 30,
  rateMaxClients: 5_000,
  /** Requêtes en cours au plus par source (par instance). */
  inflightPerSource: 4,
  /** Disjoncteur : 3 échecs de suite écartent la source 60 s. */
  breakerFailures: 3,
  breakerOpenMs: 60_000,
  /** État des sources pour /api/health : requête de test « Namur » au plus toutes les 10 min. */
  healthEveryMs: 10 * 60_000,
  /** Taille maximale d'une réponse de service. */
  maxBodyBytes: 2_000_000,
  /** Doublons : même type à moins de 25 m. */
  dedupeMeters: 25,
} as const;

export interface GeoConfig {
  /** Sources activées, dans l'ordre de GEOCODE_SOURCES (défaut vla,bru,wal). */
  sources: GeoId[];
  base: Record<GeoId, string>;
  /** Entrées de GEOCODE_SOURCES non reconnues ou non branchées (google), pour le journal. */
  ignored: string[];
  /** GOOGLE_GEOCODING_KEY définie : Google n'est pas branché en 1.1, la clé n'est jamais utilisée. */
  googleKey: boolean;
}

export function readGeoConfig(env: Env): GeoConfig {
  const raw = clean(env.GEOCODE_SOURCES) || GEO_IDS.join(',');
  const sources: GeoId[] = [];
  const ignored: string[] = [];
  for (const s of raw.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if ((GEO_IDS as readonly string[]).includes(s)) {
      if (!sources.includes(s as GeoId)) sources.push(s as GeoId);
    } else ignored.push(s);
  }
  const mock = clean(env.QUAI_GEO_BASE).replace(/\/+$/, '');
  const base = {} as Record<GeoId, string>;
  for (const id of GEO_IDS) {
    const own = clean(env[GEO_ENV[id]]).replace(/\/+$/, '');
    base[id] = own || (mock ? `${mock}${GEO_MOCK_PATH[id]}` : DEFAULT_GEO_BASE[id]);
  }
  return { sources, base, ignored, googleKey: clean(env.GOOGLE_GEOCODING_KEY) !== '' };
}
