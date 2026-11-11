/**
 * Types de l'interface des lunettes : routes (écrans), modèles de vue, intentions des gestes.
 * Tout est sérialisable en JSON (état d'arrière-plan, journal QUAI_SCREEN).
 */
import type { Endpoint, Journey, LineFilter } from '../core/api';
import type { Names, Op } from '../../../shared/types';

export type ScreenId =
  | 'home'
  | 'nearby'
  | 'board'
  | 'favorites'
  | 'places'
  | 'steps'
  | 'train'
  | 'arrival'
  | 'message';

/** Zone d'arrêt identifiée (gare, arrêt) pour les routes. */
export interface AreaRef { areaId: string; op: Op; name: Names; lat: number; lon: number }

/**
 * « Trajet proposé » (L3) : une page par proposition (PRD M2). Les champs de la 1.0 (`journey`, `label`, `leaveAt0`)
 * restent acceptés (aperçus du téléphone, show() de la 1.0) : ils valent une seule proposition.
 */
export interface StepsRoute {
  screen: 'steps';
  /** Destination de la 1.0 (« bureau ») : sert au titre si `title` est absent. */
  label: string;
  /** 1.0 : trajet affiché (une seule proposition). */
  journey?: Journey;
  /** 1.0 : heure de départ à pied au premier affichage. */
  leaveAt0?: number;
  /** 1.1 : identifiant de la session (cache des données de l'écran). */
  key?: string;
  /** 1.1 : « Vers le bureau » (vers() du cœur, ou TripRequest.title). */
  title?: string;
  /** 1.1 : propositions dans l'ordre du cœur ; absentes tant que le calcul n'est pas fait (« Calcul du trajet… »). */
  journeys?: Journey[];
  /** 1.1 : proposition affichée (0 = la 1re). */
  index?: number;
  /** 1.1 : ce qu'il faut calculer quand `journeys` est absent. */
  from?: Endpoint;
  to?: Endpoint;
  favoriteId?: string;
  /**
   * 1.1 : la proposition 1 devient le trajet suivi une fois calculée. 'open' : toucher sur un favori ou un lieu
   * (un trajet déjà en cours reste suivi) ; 'phone' : demande explicite du téléphone.
   */
  follow?: 'open' | 'phone';
}

export type Route =
  | { screen: 'home' }
  | { screen: 'nearby' }
  | { screen: 'board'; areaId: string; filter?: LineFilter[]; name?: Names }
  /** `exclude` : favoris déjà montrés sur l'accueil (« Autres favoris ») ; absent : « Mes favoris ». */
  | { screen: 'favorites'; exclude?: string[] }
  | { screen: 'places' }
  | StepsRoute
  | { screen: 'train'; journey: Journey; leg: number; label?: string; auto?: boolean; trip?: { from: AreaRef; to: AreaRef } }
  | { screen: 'arrival'; journey: Journey; leg: number; trip?: { from: AreaRef; to: AreaRef } }
  | { screen: 'message'; kind: MessageKind; title: string; lines: string[] };

/** news : message « Quai 1.1 » (une fois, après la mise à jour). */
export type MessageKind = 'loading' | 'error' | 'empty' | 'firstRun' | 'notConfigured' | 'info' | 'news';

/** Ce que fait un toucher sur un élément. */
export type Intent =
  | { kind: 'open'; route: Route }
  /** Favori de l'accueil ou de la liste : ses étapes (trajet) ou ses départs (arrêt). */
  | { kind: 'openFavorite'; id: string }
  /** Lieu ou adresse récente de « Aller à… » : les étapes du trajet proposé. */
  | { kind: 'go'; key: string; to: Endpoint; label: string }
  /** Ligne « En cours » : le trajet suivi, à l'écran qui correspond à l'heure. */
  | { kind: 'resume' }
  /** Étapes d'une autre proposition : elle devient le trajet suivi. */
  | { kind: 'follow' }
  | { kind: 'toggleFavoriteStop' }
  | { kind: 'saveTrip' }
  | { kind: 'toast'; text: string }
  /** Quai Web : ouvrir un écran des réglages (#/…) ; dans l'appli Even, `text` s'affiche en message. */
  | { kind: 'phone'; hash: string; text: string }
  | { kind: 'retry' }
  | { kind: 'continue' };

/** Un élément de liste : une ligne (colonnes a, b, c), ou deux lignes (a2/b2 sur la seconde). */
export interface Item {
  a: string;
  b?: string;
  c?: string;
  a2?: string;
  b2?: string;
  /** Deux lignes même si la seconde est vide (favori en calcul : la liste ne saute pas quand la réponse arrive). */
  two?: boolean;
  /** Fin de la colonne b jamais coupée (ex. « , dernier ») : la colonne b est raccourcie avant elle. */
  bTail?: string;
  /** Fin de la colonne c ajoutée seulement si elle tient en entier (la colonne c n'est jamais coupée pour elle). */
  cTail?: string;
  action?: Intent;
}

/** Gabarits de colonnes (largeurs fixes : pas de reconstruction de page lors des rafraîchissements). */
export type Layout =
  | 'menu'
  | 'nearby'
  | 'board'
  | 'boardTrain'
  | 'steps'
  | 'train'
  | 'arrival'
  | 'message';

/** Ligne sous le titre : alerte (forte) ou contexte (discret). */
export interface TopLine { text: string; strong?: boolean }

export interface GlassesView {
  screen: ScreenId;
  layout: Layout;
  title: string;
  clock: string;
  top?: TopLine;
  items: Item[];
  /** Ligne de bas de liste (« ~ horaire prévu, sans temps réel », ce que fera ▼ sur les étapes). */
  note?: string;
  /** Réserver la ligne de note même vide (évite de reconstruire la page au rafraîchissement). */
  reserveNote?: boolean;
  /** Aides de gestes (vide si désactivées). */
  hints: string;
  /** Élément sélectionné au premier affichage (ex. « prochain » arrêt dans le train). */
  initialSel?: number;
  /** Premier élément visible au premier affichage. */
  initialTop?: number;
  /** Action d'un toucher quand l'élément sélectionné n'en a pas (écrans de message, tableau, étapes). */
  tap?: Intent;
  /**
   * Sans curseur (départs, étapes) : ▲▼ font défiler ; arrivé au bout, le contrôleur reçoit un effet « edge »
   * (étapes : autre proposition).
   */
  scroll?: boolean;
  /** Écran sans curseur : ligne marquée « ▶ » (étape en cours ou prochaine du trajet suivi). */
  mark?: number;
  /** Champs ajoutés au journal QUAI_SCREEN (order, page, pages, label, followed). */
  log?: Record<string, unknown>;
}

export type Brightness = 0 | 1 | 2 | 3 | 4;

/** Conteneur texte prêt à envoyer au SDK. */
export interface ContainerSpec {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  level: Brightness;
  capture: boolean;
}

export interface PageSpec {
  containers: ContainerSpec[];
  /** Pour QUAI_SCREEN : textes affichés, dans l'ordre (colonnes séparées par 3 espaces). */
  lines: string[];
  screen: ScreenId;
  title: string;
  clock: string;
  /** Index du premier élément visible et nombre d'éléments affichés. */
  top: number;
  visible: number;
  /** Élément sous le curseur ; écrans sans curseur : ligne marquée « ▶ », sinon -1. */
  sel: number;
}
