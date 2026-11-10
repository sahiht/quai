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
    /** Arrêts : [index gare, arrivée (min), départ (min), quai ou '' , stop_sequence] */
    s: [number, number, number, string, number][];
  }[];
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
}

/** Normalisation des identifiants préfixés par le portail BMC : 'gt:tec:123' -> '123', 'gs:nmbssncb:8812005' -> '8812005'. */
export function normalizeId(id: string): string {
  return id.replace(/^g[a-z]:[a-z0-9]+:/i, '');
}
