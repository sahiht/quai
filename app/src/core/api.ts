/**
 * Quai : contrat entre le cœur de l'appli (app/src/core/, équipe « cœur ») et l'interface
 * (app/src/glasses/ et app/src/phone/, équipe « interface »).
 * Source de vérité : les deux équipes codent contre ces types. Ne pas modifier sans accord (voir SPEC.md § 5.4).
 * Implémentation : createCore() dans app/src/core/index.ts. Petits utilitaires partagés : app/src/core/util.ts.
 *
 * Version 2 (Quai 1.1, docs/v1.1/DECISIONS.md) : réglages v2 (adresses récentes, ordre des favoris, version vue,
 * lieux par adresse), extrémité « adresse », trajets étiquetés et expliqués (route), réponses des favoris
 * (orderFavorites, answer), adresses (geocode), état du temps réel (status), échanges lunettes ↔ téléphone.
 */
import type { Op, Mode, Names, AreaSummary, Meta, HealthResponse, GeocodeResult, GeoSource } from '../../../shared/types';

export type { Op, Mode, Names, AreaSummary, Meta, HealthResponse, GeocodeResult, GeoSource };

/** Position simple (WGS84). */
export interface LatLon { lat: number; lon: number }

/* ------------------------------ Réglages ------------------------------ */

export type NameLang = 'fr' | 'nl' | 'local';
/** Quand proposer un favori à l'ouverture. near = à moins de 300 m ; morning = 5h-11h ; evening = 15h-21h. */
export type Propose = 'never' | 'near' | 'morning' | 'evening';

/**
 * Lieu enregistré (« Mes lieux »).
 * - src 'address' : position et `address` donnés par le service d'adresses (adresse normalisée) ;
 * - src 'stop' : lieu placé à un arrêt choisi dans le champ unique (`areaId`, sous-titre « Près de Namur ») ;
 * - src 'here' : « Utiliser ma position actuelle » ;
 * - src absent : lieu de la 1.0 ; s'il a une `address` (texte libre jamais vérifié) le téléphone affiche
 *   « Adresse à vérifier » et propose « Vérifier l'adresse » (PRD M4.8).
 */
export interface Place {
  id: string; label: string; lat: number; lon: number;
  address?: string;
  src?: 'address' | 'stop' | 'here';
  approx?: boolean;             // position approximative (rue sans numéro)
  areaId?: string;              // src 'stop' : zone de l'arrêt
}

/** Adresse récente (S4) : les 5 dernières adresses choisies (pas les arrêts), la plus récente d'abord. */
export interface RecentAddress { label: string; lat: number; lon: number; approx?: boolean; at: number }

/**
 * Extrémité d'un trajet. 'here' = position actuelle au moment du calcul.
 * 'address' (1.1) = adresse choisie dans le champ unique sans être enregistrée comme lieu (label = adresse normalisée,
 * « Veldstraat 1, 9000 Gent »).
 */
export type Endpoint =
  | { type: 'here' }
  | { type: 'area'; areaId: string; op: Op; name: Names; lat: number; lon: number }
  | { type: 'place'; placeId: string }
  | { type: 'address'; label: string; lat: number; lon: number; approx?: boolean };

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
/**
 * 1.2 (docs/v1.2/PRD-1.2.md § 2) : favori « lieu ». Un lieu (adresse, arrêt ou position prise sur place, avec un nom)
 * donne « Vers {lieu} » depuis la position : il se comporte comme le trajet « Ma position → lieu » de la 1.1.
 * Un Endpoint { type: 'place', placeId } désigne un favori lieu par son id. propose : 'never' | 'morning' | 'evening'
 * ('near' n'a pas de sens pour un lieu et devient 'never').
 */
export interface FavoritePlace extends Place {
  kind: 'place';
  propose: Propose;
}
/** 1.2 : un trajet fixe ne part jamais de « Ma position » (ce cas est un favori lieu). */
export type Favorite = FavoriteStop | FavoriteTrip | FavoritePlace;

/**
 * Réglages, version 3 (1.2). Une version 2 (1.1) ou 1 (1.0) est migrée par settings.ts (PRD-1.2 § 2.4) : chaque
 * lieu devient un favori lieu ; un favori « Ma position → ce lieu » fusionne avec lui (place, id, nom, créneau) ;
 * « Ma position → adresse ou arrêt » devient un lieu ; le reste est gardé. `places` n'existe plus.
 */
export interface Settings {
  v: 3;
  onboarded: boolean;
  lang: NameLang;
  maxWalkMin: number;           // 5..20 : préférence (PRD-1.2 § 1.2), plus un mur
  favorites: Favorite[];        // 32 au plus, dans l'ordre choisi sur le téléphone
  recent: RecentAddress[];      // 5 au plus, la plus récente d'abord (S4)
  /**
   * Dernière version dont les nouveautés ont été vues (« 1.1.0 »). '' = nouvelle installation : les lunettes
   * y écrivent la version courante sans rien afficher. Message « Quai 1.1 » si non vide et inférieure à 1.1.0.
   */
  seenVersion: string;
  display: {
    depsPerStop: number;        // 2..8
    radiusM: 300 | 500 | 800;
    gestureHints: boolean;
    markPlanned: boolean;       // signe ~ pour les horaires sans temps réel
    opening: 'suggest' | 'home' | 'firstFavorite';
    favOrder: 'smart' | 'mine'; // « Ordre des favoris » : « Selon l'heure et le lieu » ou « Dans mon ordre » (S3)
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
  v: 3,
  onboarded: false,
  lang: 'fr',
  maxWalkMin: 10,
  favorites: [],
  recent: [],
  seenVersion: '',
  display: { depsPerStop: 4, radiusM: 500, gestureHints: true, markPlanned: true, opening: 'suggest', favOrder: 'smart' },
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
  fromStop?: string; toStop?: string;     // 1.1 : identifiants temps réel des arrêts physiques de montée et de descente
  platform?: string; newPlatform?: string;
  rt?: boolean; delayMin?: number; cancelled?: boolean;
  last?: boolean;                         // dernier passage annoncé de la ligne (STIB « Dernier passage »)
  stops?: Stopover[];                     // de la montée à la descente comprises (« Dans le train » ; 1.1 : aussi bus, tram, métro)
}

export interface Alert {
  kind: 'platform' | 'delay' | 'cancel' | 'leave' | 'works';
  text: string;                 // déjà rédigé, 48 caractères max, ex. '! Voie modifiée : l’IC part de la voie 6'
  at: number;                   // epoch ms
}

/**
 * Étiquette d'une proposition (PRD-1.2 § 1.3) : short « Le plus court », earlier « Plus tôt », lesswalk « Moins de
 * marche », none « Sans changement », fewer « Moins de changements », walk « À pied », next « Le suivant »,
 * later « Plus tard ». 'simple' et 'fast' (1.1) n'existent plus : un trajet suivi gardé par la 1.1 dans 'quai.trip'
 * est relu avec 'simple' → 'short' et 'fast' → 'earlier' (labelOf).
 */
export type JourneyLabel = 'short' | 'earlier' | 'fewer' | 'none' | 'walk' | 'next' | 'later' | 'lesswalk';
export const LABEL_TEXT: Record<JourneyLabel, string> = {
  short: 'Le plus court',
  earlier: 'Plus tôt',
  fewer: 'Moins de changements',
  none: 'Sans changement',
  walk: 'À pied',
  next: 'Le suivant',
  later: 'Plus tard',
  lesswalk: 'Moins de marche',
};
/** Étiquette lue dans des données d'une version antérieure (trajet suivi gardé par la 1.1). */
export function labelOf(x: unknown): JourneyLabel | undefined {
  if (x === 'simple') return 'short';
  if (x === 'fast') return 'earlier';
  return typeof x === 'string' && x in LABEL_TEXT ? (x as JourneyLabel) : undefined;
}

export interface Journey {
  id: string;                   // stable d'un rafraîchissement à l'autre
  legs: Leg[];
  dep: number; arr: number;     // début (marche comprise) et arrivée finale, estimés
  leaveAt: number;              // heure conseillée pour partir = départ du 1er véhicule - marche - marge (Settings.alerts.leaveBeforeMin)
  transfers: number;
  rt: boolean;                  // tous les trajets en véhicule ont du temps réel
  alerts: Alert[];              // selon Settings.alerts, les plus importantes d'abord
  /** 1.1 : étiquette et raison calculées par le cœur (route) ; la raison suit PRD § 6.1 L3 et tient sur une ligne
   *  des lunettes (542 px mesurés avec la police, pas un nombre de caractères),
   *  ex. « Le plus simple : direct, à pied 7 + 12 min ». Gardées par refresh(). */
  label?: JourneyLabel;
  reason?: string;
}

/**
 * Résultat d'un calcul de trajets (1.1). `journeys` : 3 au plus, dans l'ordre d'affichage (téléphone et lunettes),
 * chacun avec label et reason. Vide : `empty` dit pourquoi.
 */
export interface PlanResult {
  journeys: Journey[];
  /**
   * here : arrivée à 300 m au plus du départ (« Tu es déjà au bureau. ») ;
   * noPosition : une extrémité est « Ma position » et la position est inconnue ;
   * noStopFrom / noStopTo : aucun arrêt à moins de `accessMin` minutes à pied du départ / de l'arrivée ;
   * noTrip : arrêts trouvés mais aucun trajet (alors `station` si une gare SNCB proche de l'arrivée existe).
   */
  empty?: 'here' | 'noPosition' | 'noStopFrom' | 'noStopTo' | 'noTrip';
  station?: { areaId: string; name: Names; lat: number; lon: number };
  accessMin?: number;
}

export interface SearchItem {
  id: string; op: Op; n: Names; modes: Mode[]; lat: number; lon: number;
  kindLabel: string;            // 'gare SNCB', 'tram De Lijn', 'métro STIB', 'bus TEC'
}

/** Place d'un favori dans l'ordre intelligent (PRD M1.4) : règle 1 tout près, 2 créneau, 3 utilisable d'ici,
 *  4 le reste, 5 fin de liste (déjà sur place ou rien dans les 3 heures). */
export interface FavoriteRank { favoriteId: string; rule: 1 | 2 | 3 | 4 | 5; distanceM?: number }

/**
 * Réponse d'un favori pour l'accueil et « Autres favoris » (M1), et pour la section « Mes favoris » du téléphone (S8).
 * state : ok (réponse prête, même lointaine : « partir à 17:13 », « partir demain 06:20 ») ; here (« tu y es ») ;
 * none (aucun trajet ni départ trouvé dans l'horizon de recherche, environ 23 h : « aucun trajet ») ;
 * noPosition (« sans position ») ; missing (arrêt introuvable : « introuvable : modifie-le sur le téléphone »).
 * La règle 5 de l'ordre (« rien dans les 3 heures ») se lit sur l'heure de la réponse, pas sur state.
 */
export interface FavoriteAnswer {
  favoriteId: string;
  kind: 'stop' | 'trip';
  state: 'ok' | 'here' | 'none' | 'noPosition' | 'missing';
  /** Trajet favori : propositions ; la 1re est la réponse affichée, celle qu'ouvrent et suivent les étapes. */
  plan?: PlanResult;
  /** Trajet favori de gare à gare, gare de départ hors de portée à pied : heures du train (« départ 14:10 »). */
  fromStation?: boolean;
  /** Arrêt favori : départs filtrés par le filtre du favori. */
  board?: Board;
  /** Arrêt favori dont la zone a changé d'identifiant (zones fusionnées) : la zone retrouvée ; l'interface met le favori à jour. */
  movedTo?: AreaSummary;
  updatedAt: number;
}

/** État du temps réel connu à cet instant (accueil, écran Données). */
export interface CoreStatus {
  /** ok : dernière requête temps réel réussie ; down : relais ou sources en erreur (« Temps réel indisponible :
   *  horaires prévus ~ ») ; offline : téléphone hors ligne (« Pas de réseau ») ; unknown : rien demandé encore. */
  rt: 'ok' | 'down' | 'offline' | 'unknown';
  since?: number;               // epoch ms du passage dans cet état
}

/** Réponse de geocode() : jamais d'exception. error : 'down' (service d'adresses en panne) ou 'offline' (pas de réseau). */
export interface GeocodeAnswer {
  results: GeocodeResult[];     // 4 au plus pour le champ unique, les plus proches de `near` d'abord à score égal
  error?: 'down' | 'offline';
  partial?: boolean;
  attribution?: string;
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
  /**
   * Zones dans le rayon, tous réseaux, triées par distance, avec leur prochain départ (temps réel si possible).
   * 1.1 : `light` = sans départ (`next` absent) ni fichier de zone : pour compter « Autour de moi   3 arrêts » (M8.7).
   * Zones fusionnées (M8.3) : une seule entrée par station ; zones sans aucun départ absentes.
   */
  nearby(lat: number, lon: number, radiusM: number, opts?: { light?: boolean }): Promise<NearbyItem[]>;
  /**
   * Prochains départs d'une zone à partir de maintenant, temps réel inclus. limit défaut 8.
   * 1.1 (M8.4, M8.5) : si le temps réel tarde, rend l'horaire prévu après 1,5 s au plus ; le temps réel arrivé
   * ensuite est fusionné au rafraîchissement suivant. Un identifiant de zone fusionnée (`aka`) est accepté.
   */
  board(areaId: string, opts?: { limit?: number; filter?: LineFilter[] }): Promise<Board>;
  /** Lignes et directions d'une zone, pour composer le filtre d'un favori. */
  linesAt(areaId: string): Promise<{ line: string; mode: Mode; head: Names; filter: LineFilter }[]>;
  /** Recherche par nom (≥ 2 caractères), 20 résultats max ; gares d'abord, puis les plus proches si `near`. */
  search(query: string, near?: { lat: number; lon: number }): Promise<SearchItem[]>;
  /** Trains entre deux gares (zones SNCB), direct ou une correspondance, à partir de `after`. limit défaut 3. */
  trains(fromAreaId: string, toAreaId: string, after: number, limit?: number): Promise<Journey[]>;
  /**
   * 1.1 : trajets porte à porte classés selon PRD § 4 et design-routing.md § 4.8 (« Le plus simple » d'abord),
   * une seule fonction pour l'accueil, les favoris, « Aller à… », le téléphone et Quai Web. Jusqu'à 3 véhicules,
   * une correspondance entre lignes urbaines de réseaux différents, deux correspondances en train ; extrémités
   * 'address' acceptées. `here` requis si une extrémité est 'here' (sinon empty = 'noPosition').
   */
  route(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: LatLon | null): Promise<PlanResult>;
  /** 1.0, gardé : (await route(...)).journeys. */
  plan(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: { lat: number; lon: number }): Promise<Journey[]>;
  /** Applique le temps réel à un trajet (retards propagés, voies, suppressions) et recalcule leaveAt et les alertes.
   *  1.1 : garde label et reason ; bus, trams et métros compris (fromStop, toStop). */
  refresh(j: Journey, settings: Settings): Promise<Journey>;
  /** 1.1 : ordre intelligent des favoris (PRD M1.4), immédiat (sans calcul de trajet). `last` : dernières réponses
   *  connues, pour la règle 5 (« rien dans les 3 heures »). Avec favOrder 'mine' : ordre du téléphone, sauf règle 5. */
  orderFavorites(here: LatLon | null, settings: Settings, last?: ReadonlyMap<string, FavoriteAnswer>): FavoriteRank[];
  /** 1.1 : réponse d'un favori (trajet : route() depuis la position, ou depuis la gare si elle est hors de portée à
   *  pied ; arrêt : départs filtrés, zone retrouvée par aka, puis opérateur + nom + 150 m). */
  answer(fav: Favorite, here: LatLon | null, settings: Settings): Promise<FavoriteAnswer>;
  /** 1.1 : adresses par le relais (/api/geocode), 3 caractères au moins, sinon résultats vides. `near` sert seulement
   *  au tri local : la position ne quitte jamais le téléphone. */
  geocode(q: string, lang: 'fr' | 'nl', near?: LatLon | null): Promise<GeocodeAnswer>;
  /** 1.1 : état du temps réel connu à cet instant (synchrone). */
  status(): CoreStatus;
  /** Suggestion d'ouverture selon l'heure, la position et les favoris ; null si rien à proposer. */
  suggest(here: { lat: number; lon: number } | null, settings: Settings): Promise<Suggestion | null>;
  /** Textes des alertes « travaux » actives pour ces lignes ou arrêts (vide si aucune ou source en erreur). */
  works(op: Op, routes: string[], stops: string[]): Promise<string[]>;
  /** État des sources pour l'écran Données (relais /api/health). */
  health(): Promise<HealthResponse>;
}

/* ------------------------------ Lunettes ↔ téléphone (1.1) ------------------------------ */

/** Demande d'affichage d'un trajet dans les lunettes : bouton « Lunettes » d'une carte de résultat (M4.5, M2.9)
 *  ou d'un favori (S8). Le trajet `index` est affiché ET devient le trajet suivi. */
export interface TripRequest {
  title: string;                // « Vers le bureau », « Vers Veldstraat 1 » (vers() de core/text.ts)
  from: Endpoint; to: Endpoint;
  favoriteId?: string;
  result: PlanResult;           // propositions déjà calculées, dans l'ordre du téléphone
  index: number;                // 0 = la 1re proposition
}

/** Ce que le contrôleur des lunettes offre au téléphone (implémenté par GlassesController). Les deux méthodes rendent
 *  le message d'état à afficher à côté du bouton touché (« Affiché dans les lunettes : IC 14:22, voie 6. »). */
export interface GlassesApi {
  showTrip(req: TripRequest): Promise<string>;
  showBoard(areaId: string, filter?: LineFilter[]): Promise<string>;
}
