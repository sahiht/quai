/**
 * Types de l'interface des lunettes : routes (écrans), modèles de vue, intentions des gestes.
 * Tout est sérialisable en JSON (état d'arrière-plan, journal QUAI_SCREEN).
 */
import type { Departure, Endpoint, Journey, LineFilter } from '../core/api';
import type { Mode, Names, Op } from '../../../shared/types';

/**
 * 1.2.2 : « Aller à… » (`places`) n'existe plus, son contenu est dans « Favoris » (PRD-1.2.2 § 1.2) ; un état gardé par
 * la 1.2.1 sur cet écran s'ouvre sur « Favoris » (parseNav).
 */
export type ScreenId =
  | 'home'
  | 'nearby'
  | 'board'
  | 'favorites'
  /** 1.2.2 : « Gares » (PRD-1.2.2 § 2). */
  | 'stations'
  /** 1.2.2 : « Bus, tram, métro » (§ 3). */
  | 'lines'
  /** 1.2.2 : détail d'une ligne à son arrêt, les deux sens (§ 3). */
  | 'line'
  /** 1.2.2 : « {arrêt} : garder une ligne », ouvert par ★ des départs d'un arrêt (REVUE-USAGE n° 3). */
  | 'keepLine'
  | 'steps'
  /** 1.2.1 : « Autres trajets », les autres propositions d'un trajet (PRD-1.2.1 § 3.3). */
  | 'others'
  /** 1.2.2 : toucher sur le trajet suivi : « Ne plus suivre » et le détail du véhicule (PRD-1.2.2 § 6). */
  | 'followed'
  /** 1.2.3 : les arrêts d'un départ, de l'arrêt du tableau au terminus (PRD-1.2.3 § 2). */
  | 'stops'
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
   * 'phone' : demande explicite du téléphone (bouton « Lunettes ») : la proposition 1 devient le trajet suivi une fois
   * calculée. 1.2.2 (PRD-1.2.2 § 6) : ouvrir un favori, un lieu ou une adresse ne fait plus suivre ; la valeur 'open'
   * d'un état gardé par la 1.2.1 est ignorée.
   */
  follow?: 'open' | 'phone';
  /**
   * 1.2.1 : proposition ouverte depuis « Autres trajets » (au-dessus de la liste dans la pile) : double toucher et ▼ au
   * bout des étapes reviennent à la liste.
   */
  fromList?: boolean;
}

/**
 * 1.2.1 : « Autres trajets » (PRD-1.2.1 § 3.3), ouverte par ▼ au bout des étapes : les propositions de la session
 * sauf celle des étapes du dessous (`index`). Toucher une entrée empile ses étapes (StepsRoute.fromList).
 */
export interface OthersRoute {
  screen: 'others';
  /** Session d'étapes (StepsRoute.key) : trajet suivi, cache. */
  key?: string;
  /** « Vers le bureau » (titre des étapes). */
  title: string;
  /** Toutes les propositions de la session, dans l'ordre du cœur. */
  journeys: Journey[];
  /** Proposition des étapes d'où la liste a été ouverte (absente de la liste). */
  index: number;
  from?: Endpoint;
  to?: Endpoint;
  favoriteId?: string;
}

/** 1.2.2 : une ligne à son arrêt (LinePick avec `line`), pour son détail. */
export interface LineRoute {
  screen: 'line';
  /** LinePick.id (absent : ouvert d'ailleurs). */
  pick?: string;
  areaId: string;
  op: Op;
  line: string;
  /** Nom de l'arrêt (titre « Bus W · Merbraine ») ; `mode` si connu. */
  name: Names;
  mode?: Mode;
}

/**
 * 1.2.3 : les arrêts d'un départ (PRD-1.2.3 § 2), ouverts en touchant un départ d'un tableau ou un passage du détail
 * d'une ligne : la zone du tableau et le départ tel qu'il y figurait (departureStops).
 */
export interface StopsRoute {
  screen: 'stops';
  areaId: string;
  dep: Departure;
}

/** 1.2.2 : « {arrêt} : garder une ligne » (lignes de l'arrêt, core.linesAt). */
export interface KeepLineRoute {
  screen: 'keepLine';
  areaId: string;
  op: Op;
  name: Names;
  lat: number;
  lon: number;
}

export type Route =
  | { screen: 'home' }
  | { screen: 'nearby' }
  /**
   * `pick` (1.2.4) : gare ou arrêt gardé ouvert d'office (`near`) : StationPick.id ou LinePick.id, pour retrouver sa zone
   * si son identifiant a changé (le choix suit, comme dans « Gares » et « Bus, tram, métro »).
   */
  | { screen: 'board'; areaId: string; filter?: LineFilter[]; name?: Names; pick?: string }
  /** 1.2.2 : « Favoris » : favoris, adresses récentes, « Autre adresse » (PRD-1.2.2 § 1.2). */
  | { screen: 'favorites' }
  | { screen: 'stations' }
  /** `focus` : LinePick.id sous le curseur à l'ouverture (ligne `near` ouverte d'office, REVUE-USAGE n° 4). */
  | { screen: 'lines'; focus?: string }
  | LineRoute
  | KeepLineRoute
  | StopsRoute
  | StepsRoute
  | OthersRoute
  /** 1.2.2 : « Ne plus suivre » et le détail du véhicule, pour le trajet suivi du moment. */
  | { screen: 'followed' }
  | { screen: 'train'; journey: Journey; leg: number; label?: string; auto?: boolean; trip?: { from: AreaRef; to: AreaRef } }
  | { screen: 'arrival'; journey: Journey; leg: number; trip?: { from: AreaRef; to: AreaRef } }
  | { screen: 'message'; kind: MessageKind; title: string; lines: string[] };

/** news : message « Quai 1.2.4 » (une fois, après la mise à jour depuis une version antérieure ; lignes dans la route). */
export type MessageKind = 'loading' | 'error' | 'empty' | 'firstRun' | 'notConfigured' | 'info' | 'news';

/** Ce que fait un toucher sur un élément. */
export type Intent =
  | { kind: 'open'; route: Route }
  /** Favori de l'accueil ou de la liste : ses étapes (trajet) ou ses départs (arrêt). */
  | { kind: 'openFavorite'; id: string }
  /** Adresse récente de « Favoris » (1.2.1 : lieu ou adresse de « Aller à… ») : les étapes du trajet proposé. */
  | { kind: 'go'; key: string; to: Endpoint; label: string }
  /** Ligne « En cours » : le trajet suivi, à l'écran qui correspond à l'heure. */
  | { kind: 'resume' }
  /** « Suivre ce trajet » : la proposition affichée devient le trajet suivi (PRD-1.2.2 § 6). */
  | { kind: 'follow' }
  /** 1.2.2 : « Ne plus suivre » (§ 6). */
  | { kind: 'unfollow' }
  /** 1.2.2 : ★ des départs d'une gare : la garder ou la retirer de « Gares » (REVUE-USAGE n° 3). */
  | { kind: 'toggleStation' }
  /** 1.2.2 : « garder une ligne » : la ligne `line` de l'arrêt de l'écran, gardée ou retirée. */
  | { kind: 'toggleLine'; line: string; mode: Mode }
  | { kind: 'saveTrip' }
  | { kind: 'toast'; text: string }
  /** Quai Web : ouvrir un écran des réglages (#/…) ; dans l'appli Even, `text` s'affiche en message. */
  | { kind: 'phone'; hash: string; text: string }
  | { kind: 'retry' }
  | { kind: 'continue' };

/**
 * 1.2.5 : un mot ou un groupe de mots d'une ligne, au plus clair (`hi`, conteneur de la colonne a) ou pâle
 * (conteneur de la colonne b) : « Bus W » et « Bruxelles Midi » au plus clair, « vers » pâle. Les G2 n'ont pas de
 * surligneur : la luminosité, par conteneur, en tient lieu.
 */
export interface Seg {
  t: string;
  hi?: boolean;
}

/**
 * 1.2.2 : ligne en retrait sous un élément (un sens d'une ligne de « Bus, tram, métro ») : texte de la colonne b, puis
 * `bRight` aligné à droite dans la même colonne (comme les favoris de l'accueil).
 */
export interface SubRow {
  b: string;
  /** 1.2.5 : la ligne en mots clairs et pâles (`b` ignoré), `bRight` au plus clair à droite. */
  segs?: Seg[];
  /** 1.2.5 : sans retrait, alignée sur l'élément (un autre sens de la même ligne). */
  flush?: boolean;
  bRight?: string;
  /** Fin de `bRight` ajoutée seulement si elle tient. */
  bRightTail?: string;
}

/** Un élément de liste : une ligne (colonnes a, b, c), ou deux lignes (a2/b2 sur la seconde). */
export interface Item {
  a: string;
  /** 1.2.5 : la ligne en mots clairs et pâles (`a` et `b` ignorés), `bRight` au plus clair à droite. */
  segs?: Seg[];
  b?: string;
  c?: string;
  a2?: string;
  b2?: string;
  /** Deux lignes même si la seconde est vide (favori en calcul : la liste ne saute pas quand la réponse arrive). */
  two?: boolean;
  /**
   * 1.2.1 : une ligne vide au-dessus de l'élément (accueil : entre les favoris et « Autour de moi »). Elle compte dans
   * la hauteur de l'élément mais ne se sélectionne pas : les indices des éléments ne changent pas.
   */
  gap?: boolean;
  /**
   * 1.2.2 : ligne pâle au-dessus de l'élément (séparateur « Adresses récentes » de « Favoris »), dans la colonne b ;
   * comme `gap`, elle compte dans sa hauteur et ne se sélectionne jamais.
   */
  head?: string;
  /** 1.2.2 : lignes en retrait sous l'élément, qui en font partie (curseur sur la 1re ligne seulement). */
  sub?: SubRow[];
  /**
   * 1.2.3 : intitulé au-dessus de l'élément, dans la colonne a (« vers Bruxelles Midi » au-dessus du premier passage
   * d'un sens, détail d'une ligne) ; comme `head`, il compte dans la hauteur de l'élément, défile avec lui et ne se
   * sélectionne jamais.
   */
  group?: string;
  /**
   * 1.2.3 : identité de l'élément, « identité@minutes » (departureKey : un départ d'un tableau, un passage d'une ligne) :
   * le curseur la suit quand la liste change (NavFrame.key).
   */
  key?: string;
  /** Fin de la colonne b jamais coupée (ex. « , dernier ») : la colonne b est raccourcie avant elle. */
  bTail?: string;
  /**
   * 1.2.4 (PRD-1.2.4 § 4) : une heure en tête de la colonne, alignée à droite dans la case de l'heure du gabarit
   * (Col.lead) : le « ~ » d'un horaire prévu dépasse à gauche, les chiffres restent alignés. Le texte de la colonne
   * (a, b ou c) la suit, ses espaces de tête compris ; si le tout ne tient pas, l'heure n'est pas décalée.
   */
  aLead?: string;
  bLead?: string;
  cLead?: string;
  /** Fin de la colonne c ajoutée seulement si elle tient en entier (la colonne c n'est jamais coupée pour elle). */
  cTail?: string;
  /**
   * 1.2.1 (accueil) : texte aligné à droite dans le conteneur de la colonne b, avec la luminosité de b (réponse d'un
   * favori en retrait, « maintenant → 21:34 ») ; `b` est coupé avant lui. `bRightTail` : fin ajoutée si elle tient.
   */
  bRight?: string;
  bRightTail?: string;
  action?: Intent;
}

/** Gabarits de colonnes (largeurs fixes : pas de reconstruction de page lors des rafraîchissements). */
export type Layout =
  | 'menu'
  /** 1.2.1 : accueil, favoris en retrait sous « Favoris » (PRD-1.2.1 § 4). */
  | 'home'
  /** 1.2.1 : « Autres trajets » (PRD-1.2.1 § 3.3). */
  | 'others'
  /** 1.2.2 : « Favoris », au format de l'accueil, détail plus pâle en 2e ligne (REVUE-USAGE n° 7). */
  | 'favorites'
  /** 1.2.2 : « Gares » : nom, prochain train à droite (PRD-1.2.2 § 2). */
  | 'stations'
  /** 1.2.2 : « Bus, tram, métro » : titre de la ligne, sens en retrait plus pâles (§ 3). */
  | 'lines'
  /** 1.2.2 : détail d'une ligne : sens, puis heure, terminus si différent, attente (§ 3). */
  | 'line'
  /** 1.2.3 : les arrêts d'un départ : heure (retard), nom, voie ou « SUPPRIMÉ » (PRD-1.2.3 § 2). */
  | 'stops'
  | 'nearby'
  | 'board'
  | 'boardTrain'
  | 'steps'
  | 'train'
  | 'arrival'
  | 'message';

/**
 * Ligne sous le titre : alerte (forte) ou contexte (discret). 1.2.3 : `cols` (arrêts d'un départ : l'arrêt du tableau,
 * « 08:42 », « Namur », « voie 2 ») : la ligne est composée sur les colonnes a, b et c du gabarit, alignée sur la liste
 * en dessous, et journalisée colonnes séparées par trois espaces ; `text` les reprend (largeur, journal sans gabarit).
 */
export interface TopLine {
  text: string;
  strong?: boolean;
  cols?: [string, string, string];
  /** 1.2.4 : heure en tête de la colonne a de `cols`, alignée comme Item.aLead. */
  lead?: string;
}

export interface GlassesView {
  screen: ScreenId;
  layout: Layout;
  title: string;
  /**
   * 1.2.2 : texte aligné à droite sur la ligne du titre, avant l'heure : « Suivi » ou « Suivre ce trajet » sur l'écran
   * d'un trajet (PRD-1.2.2 § 6). Le titre est coupé avant lui ; journalisé après trois espaces.
   */
  titleRight?: string;
  clock: string;
  top?: TopLine;
  items: Item[];
  /** Ligne de bas de liste (« ~ horaire prévu, sans temps réel », ce que fera ▼ sur les étapes). */
  note?: string;
  /** Réserver la ligne de note même vide (évite de reconstruire la page au rafraîchissement). */
  reserveNote?: boolean;
  /** Aides de gestes (vide si désactivées). */
  hints: string;
  /**
   * 1.2.1 (accueil) : sous une note (jour férié), la ligne d'aide n'est pas réservée quand l'aide est vide ; la note
   * devient la dernière ligne de l'écran et la liste garde une ligne de plus. 1.2.2 (REVUE-USAGE n° 1) : sans note
   * non plus, la ligne d'aide n'existe que si l'aide s'affiche (ou un message temporaire) ; le pied peut être vide.
   */
  compactFoot?: boolean;
  /** Élément sélectionné au premier affichage (ex. « prochain » arrêt dans le train). */
  initialSel?: number;
  /** Premier élément visible au premier affichage. */
  initialTop?: number;
  /** Action d'un toucher quand l'élément sélectionné n'en a pas (écrans de message, tableau, étapes). */
  tap?: Intent;
  /**
   * Sans curseur (départs, étapes) : ▲▼ font défiler ; arrivé au bout, le contrôleur reçoit un effet « edge »
   * (étapes, 1.2.1 : ▼ ouvre « Autres trajets », jamais un autre trajet directement).
   */
  scroll?: boolean;
  /** Écran sans curseur : ligne marquée « ▶ » (étape en cours ou prochaine du trajet suivi). */
  mark?: number;
  /**
   * 1.2.3 : liste à curseur qui défile par page (tableaux complets, arrêts d'un départ, détail d'une ligne) : le curseur
   * qui sort de la page ouvre la page suivante (ou la précédente), au lieu de la décaler d'une ligne.
   */
  paged?: boolean;
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
