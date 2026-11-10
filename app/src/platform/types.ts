/**
 * Couche plateforme : ce dont l'interface a besoin, indépendamment du SDK Even.
 * Implémentations : appli Even (src/platform/even.ts), navigateur de développement (src/platform/browser.ts)
 * et Quai Web (src/web/, page publiée sans lunettes).
 */
import type { KV } from '../core/api';
import type { HubSignal } from '../glasses/gestures';
import type { ContainerSpec } from '../glasses/types';

export interface GlassesPort {
  /** Première page (createStartUpPageContainer, une seule fois). */
  start(containers: ContainerSpec[]): Promise<boolean>;
  /** Nouvelle page (rebuildPageContainer : la forme change). */
  rebuild(containers: ContainerSpec[]): Promise<boolean>;
  /** Mise à jour sans clignotement d'un conteneur (textContainerUpgrade). */
  upgrade(c: ContainerSpec, opts: { content: boolean; level: boolean }): Promise<boolean>;
  /** Gestes et cycle de vie. Renvoie la fonction de désabonnement. */
  onSignal(cb: (s: HubSignal) => void): () => void;
  /** Quitter : 1 = boîte de confirmation système, 0 = immédiat. */
  exit(mode: 0 | 1): Promise<void>;
}

export interface Fix {
  lat: number;
  lon: number;
  accuracy?: number;
  at: number;
  /** manual : arrêt choisi à la main (Quai Web, position refusée ou imprécise). */
  source: 'sdk' | 'browser' | 'mock' | 'manual';
}

export interface LocationPort {
  /** Position actuelle, ou null (refus, délai dépassé, indisponible). Ne lève jamais. */
  current(timeoutMs?: number): Promise<Fix | null>;
  /** Dernière position connue (sans nouvelle demande). */
  last(): Fix | null;
}

export interface Platform {
  kind: 'even' | 'browser' | 'web';
  glasses: GlassesPort;
  kv: KV;
  location: LocationPort;
  /** Ferme la page du téléphone après la sortie confirmée sur les lunettes. */
  closeWebView(): void;
}
