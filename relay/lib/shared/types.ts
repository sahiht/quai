/**
 * Quai : contrats partagés entre le pipeline de nuit, le relais temps réel et l'appli.
 * Ce fichier est la source de vérité des formats. Ne pas le modifier sans mettre SPEC.md à jour.
 * Import relatif depuis chaque paquet : `import type { ... } from '../../shared/types'`.
 */

export type Op = 'sncb' | 'stib' | 'delijn' | 'tec';
export type Mode = 'train' | 'metro' | 'tram' | 'bus';

/**
 * Noms bilingues. `fr` et `nl` toujours remplis (repli : nom d'origine).
 * `l` : langue locale du lieu (réglage « Comme sur place ») ; absent = 'fr'.
 * Mise en forme : voir shared/names.ts (prettyName, frName).
 */
export interface Names { fr: string; nl: string; l?: 'fr' | 'nl' }

/* ------------------------------------------------------------------ */
/* Données statiques produites chaque nuit (servies par GitHub Pages)  */
/* Base : DATA_BASE, ex. https://<utilisateur>.github.io/<depot>/data   */
/* ------------------------------------------------------------------ */

/** DATA_BASE/meta.json */
export interface Meta {
  v: 1;
  generatedAt: string;            // ISO 8601
  timezone: 'Europe/Brussels';
  serviceDates: string[];         // ['2026-11-10', '2026-11-11'] : jour 0 et jour 1 couverts
  tile: { lat: number; lon: number }; // taille des tuiles en degrés : { lat: 0.02, lon: 0.03 }
  /**
   * cachedFrom : date (AAAA-MM-JJ) du GTFS gardé d'une nuit précédente quand celui de cette nuit n'a pas pu être
   * utilisé (portail injoignable, flux sans voyage) ; absent quand le flux de la nuit a servi.
   */
  feeds: Record<Op, { ok: boolean; error?: string; areas: number; trips: number; feedVersion?: string; cachedFrom?: string }>;
  /**
   * 1.1 : fichiers de ligne publiés cette nuit (lines/, lines/index.json, linetiles/). Absent : pas de fichiers de
   * ligne (pipeline 1.0 ou étape en échec) ; l'appli retombe alors sur le calcul 1.0 (lignes directes).
   * `ops` : réseaux dont les fichiers de ligne existent. Toutes les lignes d'une même nuit sont numérotées
   * ensemble : ne jamais mélanger des fichiers de deux `generatedAt` différents.
   */
  lines?: { files: number; ops: Exclude<Op, 'sncb'>[]; conn: number };
}

/** Index de tuile : ty = floor(lat / tile.lat), tx = floor(lon / tile.lon). Fichier DATA_BASE/tiles/{ty}_{tx}.json */
export function tileKey(lat: number, lon: number, tile = { lat: 0.02, lon: 0.03 }): string {
  return `${Math.floor(lat / tile.lat)}_${Math.floor(lon / tile.lon)}`;
}

export interface AreaSummary {
  id: string;            // `${op}:${areaKey}` ex. 'stib:8042', 'sncb:8812005'
  op: Op;
  n: Names;
  lat: number;
  lon: number;
  modes: Mode[];
  lines: string[];       // noms courts des lignes, max 12, ex. ['3', '4'] ou ['IC', 'S1']
  /**
   * 1.1 : identifiants d'anciennes zones fusionnées dans celle-ci (même nom, même opérateur, moins de 300 m).
   * Sert à retrouver un favori dont la zone a changé d'identifiant. Absent si aucune fusion.
   */
  aka?: string[];
}

/** DATA_BASE/tiles/{ty}_{tx}.json */
export interface TileFile { v: 1; areas: AreaSummary[] }

/**
 * Une « zone d'arrêt » regroupe les quais / arrêts physiques d'un même lieu pour un opérateur
 * (parent_station GTFS, sinon même nom à moins de 300 m).
 * Fichier : DATA_BASE/areas/{op}/{fileKey}.json où fileKey = areaKey avec tout caractère hors [A-Za-z0-9_-] remplacé par '_'.
 */
export interface AreaFile {
  v: 1;
  id: string;
  op: Op;
  n: Names;
  lat: number;
  lon: number;
  /** Arrêts physiques (quais). `rt` = identifiant à envoyer au relais (stop_id GTFS normalisé, ou pointid STIB numérique). */
  stops: { id: string; platform?: string; rt: string }[];
  /**
   * Motifs de desserte au départ de cette zone (ligne + direction + suite d'arrêts).
   * `next` : zones desservies ensuite, avec minutes après le départ d'ici (max 60 zones).
   */
  patterns: { line: string; mode: Mode; route: string; head: Names; next: [string, number][] }[];
  /**
   * Départs triés par heure : [jour, minutes, motif, arrêt, trip_id, stop_sequence].
   * jour : 0 = serviceDates[0], 1 = serviceDates[1]. minutes : depuis minuit local (peut dépasser 1440 en GTFS).
   * motif : index dans patterns. arrêt : index dans stops.
   */
  deps: [number, number, number, number, string, number][];
}

/**
 * Recherche de noms : DATA_BASE/search/{xx}.json.
 * xx = deux premiers caractères (a-z, 0-9) d'un mot normalisé (searchWords() de shared/names.ts).
 * Chaque zone est indexée sous chacun des mots de ses noms fr et nl (mots de 2 caractères ou plus, hors mots vides).
 * Recherche côté appli : au moins 2 caractères ; on charge le fichier du premier mot tapé puis on filtre
 * (chaque mot tapé doit être le début d'un mot du nom fr ou nl).
 */
export interface SearchFile { v: 1; items: { id: string; op: Op; n: Names; modes: Mode[]; lat: number; lon: number }[] }

/**
 * Trains du jour, pour la recherche A vers B (direct ou une correspondance) calculée sur le téléphone.
 * Fichier : DATA_BASE/trains/{YYYY-MM-DD}.json (un fichier par date de serviceDates).
 */
export interface TrainsDay {
  v: 1;
  date: string;
  stations: { id: string; n: Names; lat: number; lon: number }[]; // id = AreaSummary.id de la gare SNCB
  trips: {
    id: string;          // trip_id
    cat: string;         // 'IC', 'S1', 'L', 'P', 'EUR'...
    num?: string;        // numéro de train si connu
    head: Names;         // destination
    /**
     * Arrêts : [index gare, arrivée (min), départ (min), quai ou '' , stop_sequence]
     * 1.1 : arrivée -1 = descente interdite (drop_off_type 1), départ -1 = montée interdite (pickup_type 1).
     * Un train de nuit qui ne fait que déposer à Bruxelles a donc départ -1 à Bruxelles : on ne peut pas y monter.
     */
    s: [number, number, number, string, number][];
  }[];
}

/* ------------------------------------------------------------------ */
/* 1.1 : réseau urbain pour le calcul de trajets (ajouts seulement)    */
/* Voir docs/v1.1/design-routing.md § 3.                               */
/* ------------------------------------------------------------------ */

/**
 * DATA_BASE/lines/{op}/{routeKey}.json : une ligne GTFS (route_id) de la STIB, de De Lijn ou du TEC,
 * toutes directions, voyages des deux dates de service. routeKey = route_id normalisé, caractère hors
 * [A-Za-z0-9_-] remplacé par '_' (comme fileKey).
 */
export interface LineFile {
  v: 1;
  id: string;            // `${op}:${route_id}`, ex. 'tec:L0149-21069'
  op: Exclude<Op, 'sncb'>;
  route: string;         // route_id normalisé (alertes)
  line: string;          // nom court, ex. '149'
  mode: Mode;
  /** 1.2.6 : couleur officielle (route_color) et couleur du texte (route_text_color), « RRGGBB », si publiées. */
  color?: string;
  text?: string;
  /** Zones desservies : [AreaSummary.id, lat, lon, noms]. Coordonnées = celles de la zone (5 décimales). */
  areas: [id: string, lat: number, lon: number, n: Names][];
  pats: {
    head: Names;         // destination mise en forme
    a: number[];         // zones du motif, dans l'ordre (indices dans areas ; une zone peut revenir dans une boucle)
    s: string[];         // arrêt physique par position, identifiant temps réel (rt) ; '' si inconnu
    /** Autorisations par position : b montée seule, a descente seule, x les deux, n aucune.
     *  Absent = 'b' puis 'x'… puis 'a' (premier arrêt montée seule, dernier descente seule). */
    f?: string;
    /** Profils : minutes depuis le départ du premier arrêt, une valeur par position (départ ; arrivée au dernier). */
    prof: number[][];
    /** Voyages triés par (jour, départ) : [jour 0|1, départ du 1er arrêt en minutes (peut dépasser 1440),
     *  profil (indice dans prof), rang du trip_id dans trips (absent pour la STIB)]. */
    t: number[][];
  }[];
  /** Correspondances : pour chaque zone de areas, numéros (LineIndex) des autres lignes à moins de
   *  LineIndex.conn mètres, réduits aux bornes de chaque tronçon commun. */
  conn: number[][];
  /** trip_id normalisés, pour /api/rt (De Lijn, TEC). Absent pour la STIB (temps réel par pointid). */
  trips?: string[];
}

/** DATA_BASE/lines/index.json : numérotation des lignes de la nuit (cohérente avec tous les fichiers de la nuit). */
export interface LineIndex {
  v: 1;
  generatedAt?: string;                                // = Meta.generatedAt de la même nuit (contrôle de cohérence)
  conn: number;                                        // rayon des correspondances en mètres (400)
  /** numéro de ligne = rang dans ce tableau ; key = LineFile.id (`${op}:${route_id}`), fichier
   *  lines/{op}/{routeKey}.json (routeKey = route_id normalisé comme fileKey). */
  /** 1.2.6 : couleur officielle de la ligne (route_color, route_text_color des horaires, « RRGGBB ») quand l'opérateur la publie. */
  lines: [key: string, line: string, mode: Mode, patterns: number, color?: string, text?: string][];
  stations: Record<string, number[]>;                  // gare SNCB (AreaSummary.id) → lignes à moins de `conn` m
}

/** DATA_BASE/linetiles/{ty}_{tx}.json (même découpage que tiles/) : zone urbaine → numéros des lignes qui la desservent. */
export interface LineTile { v: 1; a: Record<string, number[]> }

/* ------------------------------------------------------------------ */
/* 1.1 : adresses (relais GET /api/geocode). Voir design-routing.md § 6 */
/* ------------------------------------------------------------------ */

/** Source d'adresses : Flandre (Digitaal Vlaanderen), Bruxelles (Paradigm, UrbIS), Wallonie (SPW, ICAR), Google (désactivé). */
export type GeoSource = 'vla' | 'bru' | 'wal' | 'google';

export interface GeocodeResult {
  label: string;                     // « Rue de Fer 25, 5000 Namur » ; rue sans numéro : « Rue Neuve, 1000 Bruxelles »
  lat: number; lon: number;          // WGS84, 5 décimales
  kind: 'adresse' | 'rue' | 'commune' | 'lieu';
  approx?: boolean;                  // rue, commune, numéro interpolé : position approximative
  source: GeoSource;
  score: number;                     // 0..1 après normalisation
  parts?: { street?: string; number?: string; postcode?: string; municipality?: string };
  names?: { fr?: string; nl?: string }; // Bruxelles : libellé dans les deux langues
}

/** GET /api/geocode?q=texte&lang=fr|nl (seuls q et lang partent du téléphone : jamais de position ni d'identifiant). */
export interface GeocodeResponse {
  q: string;                         // texte normalisé (espaces)
  fetchedAt: string;
  results: GeocodeResult[];          // 8 au plus, classés
  sources: Partial<Record<GeoSource, { ok: boolean; ms?: number; n?: number; error?: string }>>;
  partial?: boolean;                 // au moins une source interrogée n'a pas répondu à temps
  attribution: string;               // ex. « Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR) »
  error?: string;                    // toutes les sources en erreur (texte en français)
}

/* ------------------------------------------------------------------ */
/* Relais temps réel (Vercel). Base : RELAY_BASE, ex. https://quai-relay.vercel.app */
/* Toutes les réponses : JSON, Access-Control-Allow-Origin: *                       */
/* ------------------------------------------------------------------ */

/** GET /api/rt?op=sncb|delijn|tec&trips=t1,t2 (max 60 trip_id, normalisés) */
export interface RtResponse {
  op: Op;
  fetchedAt: string;
  feedTimestamp?: number;   // secondes epoch du flux
  trips: Record<string, {
    cancelled?: boolean;
    /**
     * Mises à jour par arrêt, dans l'ordre du flux :
     * [stop_sequence|null, stop_id normalisé, retard en s|null, heure estimée epoch s|null, sauté (1) ou 0]
     * - retard : departure.delay si présent, sinon arrival.delay ;
     * - heure estimée : departure.time si présent, sinon arrival.time (heure absolue donnée par le flux) ;
     * - stop_id : stop_time_properties.assigned_stop_id s'il existe, sinon stop_id. Pour la SNCB, un stop_id de quai
     *   différent du statique (ex. '8863008_6' au lieu de '8863008_4') signale un changement de voie.
     * Le retard se propage aux arrêts suivants tant qu'aucune autre mise à jour ne le remplace (règle GTFS-RT).
     */
    u: [number | null, string, number | null, number | null, 0 | 1][];
  }>;
  error?: string;
}

/**
 * GET /api/stib?points=5153,5154 (max 30 pointid). Un groupe par ligne, destination et message : `msg` vaut pour
 * toutes les heures du groupe (« Temps théorique », « Ne pas embarquer », « Dernier passage » ou message de travaux).
 * `dest` est tel que donné par la STIB (majuscules, parfois vide).
 */
export interface StibResponse {
  fetchedAt: string;
  points: Record<string, { line: string; dest: Names; times: string[]; msg?: string }[]>;
  error?: string;
}

/** GET /api/alerts?op=sncb|delijn|tec&routes=r1,r2&stops=s1 */
export interface AlertsResponse {
  op: Op;
  fetchedAt: string;
  alerts: { id: string; routes: string[]; stops: string[]; header: Partial<Record<'fr' | 'nl' | 'en' | 'de', string>>; active: [number, number][] }[];
  error?: string;
}

/** GET /api/health */
export interface HealthResponse {
  ok: boolean;
  time: string;
  data?: { generatedAt: string; ok: boolean; feeds?: Meta['feeds'] };
  sources: Record<'sncb' | 'delijn' | 'tec' | 'stib', { ok: boolean; ms?: number; error?: string }>;
  /** 1.1 : services d'adresses (requête de test au plus toutes les 10 min, en cache). */
  geocode?: Partial<Record<GeoSource, { ok: boolean; ms?: number; error?: string }>>;
  /** 1.1 : version du relais (ex. '1.1.0'). */
  version?: string;
}

/**
 * 1.2.5 : GET /api/weather : pluie prévue sur une grille fixe de la Belgique (Open-Meteo, licence CC BY 4.0), la même
 * pour tout le monde : le téléphone choisit lui-même la case de chaque marche, aucune position n'est envoyée.
 * Cases ligne par ligne, du sud au nord puis d'ouest en est : la case (r, c) est au point lat0 + r × step,
 * lon0 + c × step, d'indice r × cols + c. Erreur : `error`, listes vides.
 */
export interface WeatherResponse {
  lat0: number;
  lon0: number;
  step: number;
  rows: number;
  cols: number;
  /** Fin du premier quart d'heure, en secondes epoch : le quart d'heure k va de t0 + (k - 1) × 900 à t0 + k × 900. */
  t0: number;
  /** Pluie de chaque quart d'heure en dixièmes de mm, par case : rain[case][k]. */
  rain: number[][];
  /** Fin de la première heure, en secondes epoch : l'heure h va de h0 + (h - 1) × 3600 à h0 + h × 3600. */
  h0: number;
  /** Probabilité de pluie (plus de 0,1 mm) de chaque heure, en %, par case : prob[case][h]. */
  prob: number[][];
  fetchedAt: string;
  error?: string;
}

/** Normalisation des identifiants préfixés par le portail BMC : 'gt:tec:123' -> '123', 'gs:nmbssncb:8812005' -> '8812005'. */
export function normalizeId(id: string): string {
  return id.replace(/^g[a-z]:[a-z0-9]+:/i, '');
}
