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
  | 'trip'
  | 'places'
  | 'journeys'
  | 'steps'
  | 'train'
  | 'arrival'
  | 'message';

/** Zone d'arrêt identifiée (gare, arrêt) pour les routes. */
export interface AreaRef { areaId: string; op: Op; name: Names; lat: number; lon: number }

export type Route =
  | { screen: 'home' }
  | { screen: 'nearby' }
  | { screen: 'board'; areaId: string; filter?: LineFilter[] }
  | { screen: 'favorites' }
  | { screen: 'trip'; from: AreaRef; to: AreaRef }
  | { screen: 'places' }
  | { screen: 'journeys'; from: Endpoint; to: Endpoint; label: string }
  | { screen: 'steps'; journey: Journey; label: string; leaveAt0: number }
  | { screen: 'train'; journey: Journey; leg: number; label?: string; auto?: boolean; trip?: { from: AreaRef; to: AreaRef } }
  | { screen: 'arrival'; journey: Journey; leg: number; trip?: { from: AreaRef; to: AreaRef } }
  | { screen: 'message'; kind: MessageKind; title: string; lines: string[] };

export type MessageKind = 'loading' | 'error' | 'empty' | 'firstRun' | 'notConfigured' | 'info';

/** Ce que fait un toucher sur un élément. */
export type Intent =
  | { kind: 'open'; route: Route }
  | { kind: 'toggleFavoriteStop' }
  | { kind: 'saveTrip' }
  | { kind: 'toast'; text: string }
  | { kind: 'retry' }
  | { kind: 'continue' };

/** Un élément de liste : une ligne (colonnes a, b, c), ou deux lignes (a2/b2 sur la seconde). */
export interface Item {
  a: string;
  b?: string;
  c?: string;
  a2?: string;
  b2?: string;
  action?: Intent;
}

/** Gabarits de colonnes (largeurs fixes : pas de reconstruction de page lors des rafraîchissements). */
export type Layout =
  | 'menu'
  | 'nearby'
  | 'board'
  | 'boardTrain'
  | 'trip'
  | 'journeys'
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
  /** Ligne de bas de liste (« ~ horaire prévu, sans temps réel », erreur temps réel). */
  note?: string;
  /** Réserver la ligne de note même vide (évite de reconstruire la page au rafraîchissement). */
  reserveNote?: boolean;
  /** Aides de gestes (vide si désactivées). */
  hints: string;
  /** Élément sélectionné au premier affichage (ex. « prochain » arrêt dans le train). */
  initialSel?: number;
  /** Premier élément visible au premier affichage. */
  initialTop?: number;
  /** Action d'un toucher quand l'élément sélectionné n'en a pas (écrans de message, tableau). */
  tap?: Intent;
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
  sel: number;
}
