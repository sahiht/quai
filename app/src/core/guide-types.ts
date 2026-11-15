/**
 * 1.2.10 « Y aller » : contrat partagé entre le moteur du guidage (core/guide.ts), le chemin à pied (core/walk/),
 * les écrans des lunettes (glasses/guide-views.ts), le contrôleur, la plateforme et le téléphone.
 * Types seulement, tous sérialisables en JSON (état persistant, journal). Spécification : docs/v1.2.10/PRD-1.2.10.md.
 *
 * Règle commune : le moteur décide QUOI montrer (données) ; les écrans décident COMMENT (textes, mise en page).
 */
import type { LatLon, Names, Op, Mode } from './api';

/* ------------------------------ Position ------------------------------ */

/** Une position du téléphone pendant le guidage (SDK : onAppLocationChanged ; navigateur : watchPosition). */
export interface GuideFix {
  lat: number;
  lon: number;
  /** epoch ms */
  at: number;
  /** mètres */
  accuracy?: number;
  /** m/s */
  speed?: number;
  /** degrés depuis le nord vrai, sens horaire (cap de la marche, donné par le téléphone) */
  heading?: number;
}

/** Précision de position demandée par le moteur (politique batterie, PRD § 3.7). */
export type LocationNeed = 'high' | 'medium' | 'off';

/* ------------------------------ Chemin à pied ------------------------------ */

/** Sens d'un virage, par rapport au sens de la marche (PRD § 3.8). */
export type TurnKind = 'left' | 'right' | 'slightLeft' | 'slightRight' | 'sharpLeft' | 'sharpRight' | 'uturn' | 'straight';

/** Un changement de direction sur le chemin (seulement aux vrais carrefours). */
export interface Maneuver {
  /** rang du point du virage dans `WalkRoute.coords` */
  at: number;
  /** distance depuis le début du chemin jusqu'au virage, en mètres */
  distM: number;
  turn: TurnKind;
  /** nom de la rue prise après le virage (OSM `name`), s'il est connu */
  street?: string;
}

/** Chemin à pied calculé sur le téléphone (graphe piéton OpenStreetMap) ou, à défaut, ligne droite. */
export interface WalkRoute {
  from: LatLon;
  to: LatLon;
  coords: LatLon[];
  lengthM: number;
  maneuvers: Maneuver[];
  /** osm : vrai chemin ; straight : pas de données, segment droit (aucun virage annoncé) */
  source: 'osm' | 'straight';
  /**
   * 1.3.0 (PRD-1.3.0 § 4) : pourquoi un chemin droit. outside : un bout sans tuile piétonne (hors de l'extrait de
   * Belgique) ; nosnap : aucune voie à 100 m ; nopath : pas de chemin dans les tuiles ; far : marche de plus de 5 km.
   */
  reason?: 'outside' | 'nosnap' | 'nopath' | 'far';
  builtAt: number;
}

/** 1.3.0 (PRD-1.3.0 § 6.3) : ce que la vérification au départ signale, une ligne chacun. */
export type CheckIssue =
  | { kind: 'noPosition' }
  | { kind: 'positionLost'; minutes: number }
  | { kind: 'battery'; level: number };

/** Où l'on en est sur un chemin à pied (walkProgress). */
export interface WalkProgress {
  /** distance parcourue le long du chemin (projection de la position), m */
  alongM: number;
  /** distance de la position au chemin, m */
  offRouteM: number;
  /** distance restante le long du chemin, m */
  remainingM: number;
  /** prochain virage et distance jusqu'à lui, s'il en reste un */
  next?: { m: Maneuver; distM: number };
}

/* ------------------------------ Guidage ------------------------------ */

/** trip : « Y aller » (de porte à porte) ; ride : « J'y descends » (un seul véhicule, déjà pris ou à prendre ici). */
export type GuideKind = 'trip' | 'ride';

/** Véhicule tel que les écrans l'écrivent (« bus 6 », « IC », « tram 3 », « métro 2 », « bus SNCB »). */
export interface VehicleRef {
  op?: Op;
  mode?: Mode;
  line?: string;
  cat?: string;
}

/** Étape en cours, déduite de l'heure, du temps réel et de la position. `leg` : rang dans journey.legs. */
export type GuidePhase =
  | { kind: 'before'; leg: number }
  | { kind: 'walk'; leg: number }
  | { kind: 'wait'; leg: number }
  /** à bord ; `next` : rang dans legs[leg].stops du prochain arrêt (le premier non passé) */
  | { kind: 'ride'; leg: number; next: number }
  | { kind: 'arrived' }
  | { kind: 'ended' };

/** Ce qui suit une descente (ligne « ensuite : … »). */
export type Then =
  | { kind: 'walk'; min: number; toward: Names; last: boolean }
  | { kind: 'ride'; vehicle: VehicleRef; depAt: number; rt: boolean; platform?: string; walkMin: number }
  | { kind: 'none' };

interface MomentBase {
  /** stable : « leave:<journey> », « turn:<journey>:<leg>:<i> », « alight:<journey>:<leg> »… Un moment effacé ne revient pas. */
  id: string;
  /** epoch ms : début, fin automatique au plus tard */
  since: number;
  until: number;
  leg: number;
}

/**
 * Un moment de l'écran calme (PRD § 3.2) : une seule chose à faire. Le moteur en donne au plus un à la fois, le plus
 * prioritaire : replan > passed > alight > platform > board > turn > leave > nextStop > arrived.
 */
export type Moment =
  | (MomentBase & {
      kind: 'leave';
      walkMin: number;
      /** arrêt, gare ou destination rejointe à pied */
      toward: Names;
      vehicle?: VehicleRef;
      depAt?: number;
      rt?: boolean;
      marginMin?: number;
      /** très juste (marge ≤ 1 min) : la ligne « Si tu le rates » s'ajoute */
      tight?: boolean;
      missed?: { arr: number; laterMin: number };
    })
  | (MomentBase & {
      kind: 'turn';
      turn: TurnKind;
      distM: number;
      street?: string;
      /** vers où mène la marche */
      toward: Names;
      final: boolean;
    })
  | (MomentBase & {
      kind: 'board';
      vehicle: VehicleRef;
      head: Names;
      depAt: number;
      rt: boolean;
      platform?: string;
      platformChanged?: boolean;
      /** marche dans la gare jusqu'au quai (correspondance), et marge */
      walkMin?: number;
      marginMin?: number;
      alight: Names;
      stopsToAlight: number;
    })
  | (MomentBase & { kind: 'platform'; vehicle: VehicleRef; depAt: number; platform: string; was?: string })
  | (MomentBase & { kind: 'nextStop'; stop: Names; at: number; rt: boolean; stopsToAlight: number; alight: Names })
  | (MomentBase & { kind: 'alight'; stop: Names; at: number; rt: boolean; then: Then })
  | (MomentBase & {
      kind: 'replan';
      reason: 'missed' | 'cancelled' | 'late';
      /** ce qui est perdu (« l'IC de 07:30 ») */
      lost: { vehicle: VehicleRef; depAt: number };
      /** premier véhicule du nouveau trajet */
      next?: { vehicle: VehicleRef; depAt: number; platform?: string };
      arr?: number;
      laterMin?: number;
      /** aucun autre trajet trouvé */
      none?: boolean;
    })
  | (MomentBase & { kind: 'passed'; passed: Names; getOff: Names; at: number; arr?: number })
  | (MomentBase & { kind: 'arrived'; title: string; at: number; diffMin: number })
  /** 1.3.0 (PRD-1.3.0 § 4) : marche sans chemin à pied (hors de Belgique) : la direction et le temps, sans virage. */
  | (MomentBase & { kind: 'offMap'; walkMin: number; distM?: number; bearingDeg?: number; toward?: Names })
  /** 1.3.0 (PRD-1.3.0 § 6.3) : vérification au départ (position, batterie des lunettes). */
  | (MomentBase & { kind: 'check'; issues: CheckIssue[] });

/** « Où tu en es » (toucher sur l'écran vide, et à l'ouverture du guidage) : PRD § 3.3. */
export interface WhereAmI {
  title: string;
  arr: number;
  rt: boolean;
  /** « ● à pied ─ ◎ bus 6 ─ ○ IC ─ ○ bus 71 » : la marche de départ puis chaque véhicule */
  chain: { label: string; state: 'done' | 'now' | 'next' }[];
  walk?: {
    toward: Names;
    toKind: 'stop' | 'station' | 'platform' | 'dest';
    remainingM?: number;
    remainingMin: number;
    vehicle?: VehicleRef;
    depAt?: number;
    /** 1.2.10 (contrôle technique) : temps réel du véhicule visé (« IC à 07:44 » ; « ~ » sans), pas celui du trajet */
    rt?: boolean;
    marginMin?: number;
    next?: { turn: TurnKind; distM: number };
    /** sans chemin : direction de la cible par rapport à la marche (degrés, 0 = devant), si le cap est connu */
    bearingDeg?: number;
    /** 1.3.0 (PRD-1.3.0 § 4) : marche hors de l'extrait de Belgique (chemin droit, raison outside) */
    offMap?: boolean;
    /** 1.3.0 : distance à vol d'oiseau jusqu'à la cible (m), pour une marche sans chemin */
    crowM?: number;
  };
  wait?: { stop: Names; vehicle: VehicleRef; head: Names; depAt: number; rt: boolean; platform?: string; platformChanged?: boolean };
  ride?: { vehicle: VehicleRef; head?: Names; total: number; next: number; nextStop: Names; nextAt: number; alight: Names; alightAt: number; stopsToAlight: number; rt: boolean };
}

/** Mémoire du guidage, persistante avec le trajet suivi (clé quai.trip). */
export interface GuideMemory {
  v: 1;
  /** moments effacés d'un toucher ou terminés : ils ne reviennent pas (sauf contenu changé : nouvel id) */
  dismissed: string[];
  /** id → première apparition (epoch ms) */
  shown: Record<string, number>;
  /** dernier « Prochain arrêt » montré (au plus un toutes les 10 min) */
  lastNextStopAt?: number;
  /** montée constatée par la position (vitesse de véhicule le long du trajet) */
  boarded?: { leg: number; at: number };
  /** descente constatée par la position */
  alighted?: { leg: number; at: number };
}

/** Résultat du moteur, recalculé à chaque position, chaque minute et à chaque rafraîchissement du temps réel. */
export interface GuideState {
  kind: GuideKind;
  journeyId: string;
  phase: GuidePhase;
  /** moment à afficher maintenant ; null : écran vide */
  moment: Moment | null;
  where: WhereAmI;
  /** le moteur demande un nouveau trajet depuis `from` (correspondance ratée, véhicule supprimé, arrêt dépassé) */
  replan?: { from: LatLon & { areaId?: string; name?: Names }; reason: 'missed' | 'cancelled' | 'passed'; at: number };
  /** chemin à pied à calculer (marche en cours ou prochaine), si le contrôleur ne l'a pas encore */
  needRoute?: { leg: number; from: LatLon; to: LatLon };
  location: LocationNeed;
  /**
   * 1.3.0 (PRD-1.3.0 § 6.3) : problèmes vrais en ce moment (batterie basse, pas de position, position perdue), même
   * après la fin du moment `check` ; la carte « En cours » du téléphone les montre (GuideStatus.check, checkLines).
   */
  issues?: CheckIssue[];
  /** prochain instant où recalculer sans nouvelle position (epoch ms) */
  wakeAt: number;
  ended: boolean;
}

/** Ce que le téléphone montre dans la carte « En cours » (PRD § 4.3). */
export interface GuideStatus {
  kind: GuideKind;
  title: string;
  arr: number;
  /** « bus 6 vers Gare des Guillemins », « à pied vers l'arrêt du bus 6 », « IC vers Courtrai » */
  now: string;
  /** guidage avec l'écran calme (réglage « Me guider pendant un trajet ») ; faux : suivi sans messages */
  guided: boolean;
  /** 1.3.0 (PRD-1.3.0 § 6.3) : problèmes de la vérification en cours (« Lunettes : 12 % de batterie »), deux au plus */
  check?: string[];
}
