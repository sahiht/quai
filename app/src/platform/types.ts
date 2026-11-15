/**
 * Couche plateforme : ce dont l'interface a besoin, indépendamment du SDK Even.
 * Implémentations : appli Even (src/platform/even.ts), navigateur de développement (src/platform/browser.ts)
 * et Quai Web (src/web/, page publiée sans lunettes).
 */
import type { KV } from '../core/api';
import type { HubSignal } from '../glasses/gestures';
import type { ContainerSpec, ImageSpec, MenuItem } from '../glasses/types';

export interface GlassesPort {
  /** Première page (createStartUpPageContainer, une seule fois). 1.2.10 : `extra` : images et menu de la page. */
  start(containers: ContainerSpec[], extra?: PageExtra): Promise<boolean>;
  /** Nouvelle page (rebuildPageContainer : la forme change). 1.2.10 : `extra` : images et menu de la page. */
  rebuild(containers: ContainerSpec[], extra?: PageExtra): Promise<boolean>;
  /**
   * 1.2.10 : dessine une image dans son conteneur (créé par start ou rebuild) : updateImageRawData, une à la fois.
   * Faux si l'envoi échoue (l'écran garde son texte, le guidage continue).
   */
  paint?(img: ImageSpec): Promise<boolean>;
  /** Mise à jour sans clignotement d'un conteneur (textContainerUpgrade). */
  upgrade(c: ContainerSpec, opts: { content: boolean; level: boolean }): Promise<boolean>;
  /** Gestes et cycle de vie. Renvoie la fonction de désabonnement. */
  onSignal(cb: (s: HubSignal) => void): () => void;
  /** Quitter : 1 = boîte de confirmation système, 0 = immédiat. */
  exit(mode: 0 | 1): Promise<void>;
  /**
   * 1.3.0 (PRD-1.3.0 § 6.2) : capteur de mouvement des lunettes (imuControl) : ouvert, une mesure toutes les `paceMs`
   * (100 à 1000, par 100) en signal `imu` ; fermé. Faux si l'hôte refuse (le rappel des messages se passe alors du capteur).
   *
   * Précisions (appli Even, platform/even.ts) : ouvrir prend l'allure permise la plus proche (sans `paceMs` : 100) et rend
   * vrai seulement si l'hôte accepte ; chaque ouverture est transmise (changer d'allure : rouvrir). Les signaux `imu`
   * n'arrivent qu'entre imu(true) et imu(false), jamais après une ouverture refusée. Fermer est toujours sûr, même deux
   * fois ou sans avoir ouvert : vrai quand le capteur est fermé (rien n'est envoyé s'il l'est déjà), faux si l'hôte n'a
   * pas confirmé (un nouvel appel réessaie). Un seul capteur : la dernière demande gagne. Jamais d'exception.
   * Sans capteur (Quai Web, navigateur, hôte sans imuControl) : faux, toujours.
   */
  imu?(on: boolean, paceMs?: number): Promise<boolean>;
}

/** 1.2.10 : images et choix du menu d'une page. */
export interface PageExtra {
  images?: ImageSpec[];
  menu?: MenuItem[];
}

export interface Fix {
  lat: number;
  lon: number;
  accuracy?: number;
  /** 1.2.10 : m/s, si le téléphone la donne */
  speed?: number;
  /** 1.2.10 : degrés depuis le nord vrai (cap de la marche), si le téléphone le donne */
  heading?: number;
  at: number;
  /** manual : arrêt choisi à la main (Quai Web, position refusée ou imprécise). */
  source: 'sdk' | 'browser' | 'mock' | 'manual';
}

/** 1.2.10 : réglage d'un flux de positions (PRD § 3.7 : high 5 m et 2 s, medium 50 m et 30 s). */
export interface WatchOptions {
  accuracy: 'high' | 'medium';
  intervalMs: number;
  distanceM: number;
}

export interface LocationPort {
  /** Position actuelle, ou null (refus, délai dépassé, indisponible). Ne lève jamais. */
  current(timeoutMs?: number): Promise<Fix | null>;
  /** Dernière position connue (sans nouvelle demande). */
  last(): Fix | null;
  /**
   * 1.2.10 : positions continues pendant un guidage (SDK : startAppLocationUpdates ; navigateur : watchPosition).
   * Renvoie la fonction d'arrêt. Ne lève jamais ; sans position possible, `cb` n'est simplement jamais appelé.
   *
   * Un seul flux actif : un nouvel appel remplace le précédent (le dernier réglage gagne) et la fonction d'arrêt d'un
   * flux remplacé ne fait plus rien. Positions transmises au plus une par `intervalMs`, dès `distanceM` parcourus, et au
   * moins toutes les 20 s même immobile (position fraîche à l'arrêt : le moteur ignore les positions de plus de 60 s).
   * `last()` suit le flux. Mode test (?e2e=1) : window.__quaiPushFix (tests/e2e/README.md).
   */
  watch?(opts: WatchOptions, cb: (f: Fix) => void): () => void;
}

export interface Platform {
  kind: 'even' | 'browser' | 'web';
  glasses: GlassesPort;
  kv: KV;
  location: LocationPort;
  /** Ferme la page du téléphone après la sortie confirmée sur les lunettes. */
  closeWebView(): void;
}
