/**
 * Quai : contrat entre le cœur de l'appli (app/src/core/, équipe « cœur ») et l'interface
 * (app/src/glasses/ et app/src/phone/, équipe « interface »).
 * Source de vérité : les deux équipes codent contre ces types. Ne pas modifier sans accord (voir SPEC.md § 5.4).
 * Implémentation : createCore() dans app/src/core/index.ts. Petits utilitaires partagés : app/src/core/util.ts.
 */
import type { Op, Mode, Names, AreaSummary, Meta, HealthResponse } from '../../../shared/types';

export type { Op, Mode, Names, AreaSummary, Meta, HealthResponse };

/* ------------------------------ Réglages ------------------------------ */

export type NameLang = 'fr' | 'nl' | 'local';
/** Quand proposer un favori à l'ouverture. near = à moins de 300 m ; morning = 5h-11h ; evening = 15h-21h. */
export type Propose = 'never' | 'near' | 'morning' | 'evening';

export interface Place { id: string; label: string; lat: number; lon: number; address?: string }

/** Extrémité d'un trajet. 'here' = position actuelle au moment du calcul. */
export type Endpoint =
  | { type: 'here' }
  | { type: 'area'; areaId: string; op: Op; name: Names; lat: number; lon: number }
  | { type: 'place'; placeId: string };

/** Filtre de ligne d'un favori. head = normalizeForSearch(prettyName(direction fr)), ex. 'stalle p'. */
export interface LineFilter { line: string; head: string }

export interface FavoriteStop {
  kind: 'stop'; id: string;
  areaId: string; op: Op; name: Names; lat: number; lon: number;
  filter?: LineFilter[];        // absent ou vide = toutes les lignes
  propose: Propose;
}
export interface FavoriteTrip {
  kind: 'trip'; id: string;
  from: Endpoint; to: Endpoint;
  label?: string;               // ex. 'bureau' pour « Pour le bureau : … »
  propose: Propose;
}
export type Favorite = FavoriteStop | FavoriteTrip;

export interface Settings {
  v: 1;
  onboarded: boolean;
  lang: NameLang;
  places: Place[];
  maxWalkMin: number;           // 5..20
  favorites: Favorite[];
  display: {
    depsPerStop: number;        // 2..8
    radiusM: 300 | 500 | 800;
    gestureHints: boolean;
    markPlanned: boolean;       // signe ~ pour les horaires sans temps réel
    opening: 'suggest' | 'home' | 'firstFavorite';
  };
  alerts: {
    platform: boolean;
    delay: boolean; delayMin: number;
    cancel: boolean;
    leave: boolean; leaveBeforeMin: number;
    works: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  onboarded: false,
  lang: 'fr',
  places: [],
  maxWalkMin: 10,
  favorites: [],
  display: { depsPerStop: 4, radiusM: 500, gestureHints: true, markPlanned: true, opening: 'suggest' },
  alerts: { platform: true, delay: true, delayMin: 5, cancel: true, leave: true, leaveBeforeMin: 2, works: false },
};

/* ------------------------------ Résultats ------------------------------ */

export interface Departure {
  op: Op; mode: Mode;
  line: string;                 // nom court : '3', '232', 'IC', 'S1'
  head: Names;                  // destination déjà mise en forme (prettyName / frName)
  sched: number;                // epoch ms, horaire prévu
  est: number;                  // epoch ms, horaire estimé (= sched sans temps réel)
  rt: boolean;                  // temps réel connu pour ce départ
  delayMin: number;             // retard arrondi à la minute (0 si à l'heure ou inconnu)
  cancelled: boolean;
  platform?: string;            // voie ou quai prévu
  newPlatform?: string;         // voie modifiée par le temps réel (seulement si différente)
  tripId?: string;
  stopSeq?: number;
  stopId?: string;
  msg?: string;                 // message de l'opérateur (STIB)
  last?: boolean;               // dernier passage annoncé de la ligne à cet arrêt (STIB « Dernier passage »)
}

export interface Board {
  area: AreaSummary;
  departures: Departure[];      // triés par est ; les supprimés restent à leur place
  anyPlanned: boolean;          // au moins un départ affiché sans temps réel
  rtErrors: Op[];               // sources temps réel injoignables (affichage ~)
  updatedAt: number;            // epoch ms
}

export interface NearbyItem { area: AreaSummary; distanceM: number; walkMin: number; next?: Departure }

export interface Stopover { name: Names; areaId?: string; sched: number; est: number; platform?: string }

export interface Leg {
  kind: 'walk' | 'ride';
  from: { name: Names; lat: number; lon: number; areaId?: string };
  to: { name: Names; lat: number; lon: number; areaId?: string };
  dep: number; arr: number;               // estimés (= prévus sans temps réel)
  schedDep: number; schedArr: number;
  walkMin?: number;                       // marche
  op?: Op; mode?: Mode; line?: string;    // trajet en véhicule
  cat?: string; num?: string;             // trains : 'IC', '2112'
  head?: Names;
  tripId?: string; fromSeq?: number; toSeq?: number;
  platform?: string; newPlatform?: string;
  rt?: boolean; delayMin?: number; cancelled?: boolean;
  last?: boolean;                         // dernier passage annoncé de la ligne (STIB « Dernier passage »)
  stops?: Stopover[];                     // de la montée à la descente comprises (pour « Dans le train »)
}

export interface Alert {
  kind: 'platform' | 'delay' | 'cancel' | 'leave' | 'works';
  text: string;                 // déjà rédigé, 48 caractères max, ex. '! Voie modifiée : l’IC part de la voie 6'
  at: number;                   // epoch ms
}

export interface Journey {
  id: string;                   // stable d'un rafraîchissement à l'autre
  legs: Leg[];
  dep: number; arr: number;     // début (marche comprise) et arrivée finale, estimés
  leaveAt: number;              // heure conseillée pour partir = départ du 1er véhicule - marche - marge (Settings.alerts.leaveBeforeMin)
  transfers: number;
  rt: boolean;                  // tous les trajets en véhicule ont du temps réel
  alerts: Alert[];              // selon Settings.alerts, les plus importantes d'abord
}

export interface SearchItem {
  id: string; op: Op; n: Names; modes: Mode[]; lat: number; lon: number;
  kindLabel: string;            // 'gare SNCB', 'tram De Lijn', 'métro STIB', 'bus TEC'
}

export interface Suggestion {
  kind: 'favoriteStop' | 'favoriteTrip';
  favoriteId: string;
  autoOpen: boolean;            // vrai : ouvrir directement l'écran (favori « à moins de 300 m »)
  title: string;                // ≤ 48 caractères, ex. 'Pour le bureau : IC 07:42, voie 4'
  subtitle?: string;            // ≤ 48 caractères, ex. 'partir à 07:33, 7 min à pied'
  journey?: Journey;
  board?: Board;
}

/* ------------------------------ Cœur ------------------------------ */

export interface KV { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }

export interface CoreOptions {
  dataBase: string;             // ex. https://moi.github.io/quai/data (sans / final)
  relayBase: string;            // ex. https://quai-relais.vercel.app (sans / final)
  now: () => number;            // horloge (simulable en test)
  storage: KV;                  // cache persistant (best effort)
  fetch?: typeof fetch;         // injectable en test
}

export interface Core {
  /**
   * Charge meta.json (erreur lisible en français si les données sont absentes).
   * Des horaires périmés ne font pas échouer init() : vérifier avec dataFreshness(meta, now) exporté par core/index.ts.
   */
  init(): Promise<Meta>;
  readonly meta: Meta | null;
  /** Zones dans le rayon, tous réseaux, triées par distance, avec leur prochain départ (temps réel si possible). */
  nearby(lat: number, lon: number, radiusM: number): Promise<NearbyItem[]>;
  /** Prochains départs d'une zone à partir de maintenant, temps réel inclus. limit défaut 8. */
  board(areaId: string, opts?: { limit?: number; filter?: LineFilter[] }): Promise<Board>;
  /** Lignes et directions d'une zone, pour composer le filtre d'un favori. */
  linesAt(areaId: string): Promise<{ line: string; mode: Mode; head: Names; filter: LineFilter }[]>;
  /** Recherche par nom (≥ 2 caractères), 20 résultats max ; gares d'abord, puis les plus proches si `near`. */
  search(query: string, near?: { lat: number; lon: number }): Promise<SearchItem[]>;
  /** Trains entre deux gares (zones SNCB), direct ou une correspondance, à partir de `after`. limit défaut 3. */
  trains(fromAreaId: string, toAreaId: string, after: number, limit?: number): Promise<Journey[]>;
  /** Trajets porte à porte, 3 propositions max, triés par arrivée. `here` requis si une extrémité est 'here'. */
  plan(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number }): Promise<Journey[]>;
  /** Applique le temps réel à un trajet (retards propagés, voies, suppressions) et recalcule leaveAt et les alertes. */
  refresh(j: Journey, settings: Settings): Promise<Journey>;
  /** Suggestion d'ouverture selon l'heure, la position et les favoris ; null si rien à proposer. */
  suggest(here: { lat: number; lon: number } | null, settings: Settings): Promise<Suggestion | null>;
  /** Textes des alertes « travaux » actives pour ces lignes ou arrêts (vide si aucune ou source en erreur). */
  works(op: Op, routes: string[], stops: string[]): Promise<string[]>;
  /** État des sources pour l'écran Données (relais /api/health). */
  health(): Promise<HealthResponse>;
}
