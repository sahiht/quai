/**
 * Réglages du calcul de trajets (PRD § 4.4, design-routing.md § 4 et § 4.8). Constantes du cœur, en minutes et en
 * mètres sauf mention. Les seuils du PRD sont validés sur les vraies données (Q5, DECISIONS.md).
 */
import type { Mode } from '../../../../shared/types';

export const P = {
  /* ---------- réseau (design § 4.5) ---------- */
  /** Correspondance à pied entre deux zones (m), même rayon que LineIndex.conn. */
  transferM: 400,
  /** Correspondance dans la même zone urbaine, dans la même gare (règle 1.0). */
  mctUrban: 2,
  mctStation: 4,
  /** En plus de la marche : vers une zone urbaine, vers une gare (trouver le quai). */
  footBufUrban: 1,
  footBufStation: 3,

  /* ---------- sélection des lignes (design § 4.3 et § 4.4) ---------- */
  maxLinesPerSide: 60,
  middleK: 10,
  /** Attente moyenne supposée à la montée, pour les estimations. */
  estWait: 5,
  speedKmh: { bus: 18, tram: 18, metro: 30, train: 60 } as Record<Mode, number>,

  /* ---------- calcul (design § 4.6) ---------- */
  /** Véhicules au plus. */
  rounds: 3,
  /** Correspondances entre deux lignes urbaines au plus (PRD § 7 : une seule). */
  urbanUrbanMax: 1,
  /** Plage des départs (range RAPTOR) ; nuit ou service rare : plage étendue. */
  windowMin: 60,
  nightWindowMin: 12 * 60,
  /** Recalcul du lendemain : à partir de 04:00 du jour de service suivant. */
  nextDayFromMin: 4 * 60,

  /* ---------- garde-fous (PRD § 4.2, design § 4.7) ---------- */
  maxWaitMin: 60,
  uselessTransferMin: 5,
  /** Jamais un véhicule plus lent que la marche directe, jusqu'à cette durée de marche. */
  walkRefMaxMin: 60,
  /** Arrivée à moins de cette distance du départ : « Tu es déjà … » (PlanResult.empty 'here'). */
  hereM: 300,

  /* ---------- classement (PRD § 4.1, § 4.3, § 4.4 ; design § 4.8) ---------- */
  walkTieMin: 5,
  fastGainMin: 5,
  fastMaxEarlierMin: 30,
  guardMin: 30,
  walkOnlyMaxMin: 30,
  walkOnlyLateMin: 5,
  longWalkFactor: 1.5,
  /** Fenêtre des propositions la nuit (après le premier départ possible). */
  nightPoolMin: 90,
  /** « Le suivant » et « Plus tard » : au plus 2 h après. */
  laterMaxMin: 120,
  /** « Moins de changements » : au plus max(45 min, moitié de la durée du plus simple) après lui. */
  fewerMinMin: 45,
  proposals: 3,
  /** Réserves classées avec les propositions, pour le temps réel (design § 4.9). */
  reserves: 3,
} as const;

/** Distance (m) parcourue en `min` minutes de marche (inverse de walkMinutes). */
export const walkReachM = (min: number) => (min * 80) / 1.3;
