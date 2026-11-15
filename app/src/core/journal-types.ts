/**
 * 1.3.0 (PRD-1.3.0 § 6.4) : contrat du journal de trajet. Le contrôleur écrit (début, événements, fin), le téléphone lit
 * (liste, texte à copier). Jamais de coordonnées ni d'adresse : des heures, des sortes d'événements, des noms d'arrêts
 * et de gares publics, des nombres (précision, minutes). Gardé sur le téléphone seulement.
 */

/** Une ligne du journal : heure (epoch ms), sorte, détails courts. */
export interface JournalEvent {
  t: number;
  /**
   * Sortes : moment (affiché : kind, id), effacé (toucher), rappel (message renvoyé), monté, descendu, étape, recalcul,
   * dépassé, arrivé, position (précision médiane, trous de plus de 60 s), premier plan (quitté, revenu), lunettes
   * (déconnectées, reconnectées, batterie), vérification (problèmes signalés), fin.
   */
  k: string;
  d?: Record<string, string | number | boolean>;
}

/** Un trajet guidé du journal. */
export interface JournalTrip {
  id: string;
  /** nom du trajet comme à l'écran (« Bureau »), ou « Vers Gare des Guillemins » pour « j'y descends » */
  title: string;
  kind: 'trip' | 'ride';
  startedAt: number;
  endedAt?: number;
  /** done (Tu y es), stopped (arrêté), ended (fin donnée par le moteur ou le trajet), replaced (nouveau guidage) */
  end?: 'done' | 'stopped' | 'ended' | 'replaced';
  events: JournalEvent[];
}

export interface TripJournal {
  /** Nouveau trajet guidé ; renvoie son identifiant. Garde les 10 derniers, 60 ko au plus en tout. */
  begin(meta: { title: string; kind: 'trip' | 'ride'; at: number }): string;
  add(id: string, e: JournalEvent): void;
  end(id: string, end: NonNullable<JournalTrip['end']>, at: number): void;
  /** Du plus récent au plus ancien. */
  list(): JournalTrip[];
  /** Texte en français, prêt à copier (une ligne par événement, heures locales de Bruxelles), sans coordonnées. */
  text(id: string): string;
  clear(): void;
}

/**
 * Fabrique (core/journal.ts, équipe H) : lit `quai.journal` dans le stockage du téléphone, puis répond tout de suite
 * (liste et texte en mémoire) et enregistre en arrière-plan. Branchée dans main.ts et web/main.ts : donnée au
 * contrôleur (ControllerDeps.journal) et au téléphone (PhoneCtx.journal).
 */
export type CreateJournal = (kv: import('./api').KV, opts?: { now?: () => number }) => Promise<TripJournal>;
