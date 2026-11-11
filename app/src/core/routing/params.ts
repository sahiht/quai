/**
 * Réglages du calcul de trajets (PRD 1.1 § 4.4, PRD-1.2 § 1, PRD-1.2.1 § 1, design-routing.md § 4 et § 4.8).
 * Constantes du cœur, en minutes et en mètres sauf mention. Les seuils sont validés sur les vraies données (Q5,
 * DECISIONS.md).
 */
import type { Mode } from '../../../../shared/types';
import type { Settings } from '../api';

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
  /** Premier véhicule parti à l'heure prévue mais peut-être en retard : départs prévus jusqu'à 30 min avant l'heure
   *  demandée, gardés seulement s'ils restent attrapables sur l'heure estimée ; au plus 8 trajets de ce genre. */
  lateLookbackMin: 30,
  lateMax: 8,
  maxWaitMin: 60,
  uselessTransferMin: 5,
  /** Jamais un véhicule plus lent que la marche directe, jusqu'à cette durée de marche. */
  walkRefMaxMin: 60,
  /** Arrivée à moins de cette distance du départ : « Tu es déjà … » (PlanResult.empty 'here'). */
  hereM: 300,

  /* ---------- classement (PRD-1.2 § 1, PRD-1.2.1 § 1) ---------- */
  /** « À 5 min près » : un trajet en devance un autre s'il arrive au moins 5 min plus tôt ; égalités de durée et de
   *  marche ; « Plus tôt » fait gagner au moins 5 min. */
  tieMin: 5,
  /** La nuit (aucun départ dans l'heure), un trajet n'en devance un autre que s'il ne part pas plus de 30 min avant. */
  nightAheadMin: 30,
  /** Paliers de marche (1.2.1 § 1.1) : palier 0 jusqu'à la marche maximale, puis un palier par tranche de 5 min. */
  walkStepMin: 5,
  /** Garde-fou contre les détours (1.2.1 § 1.2) : la proposition 1 d'un palier arrive au plus 30 min après le trajet
   *  qui arrive le plus tôt, sinon le palier suivant. */
  detourGuardMin: 30,
  /** « Moins de marche », « Sans changement », « Moins de changements » : arrivée au plus 20 min après. */
  optionLateMin: 20,
  /** « Plus tard » : jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant. */
  laterGuardMin: 30,
  /** « À pied » : marche seule de 30 min au plus, arrivée au plus 5 min après la proposition 1. */
  walkOnlyMaxMin: 30,
  walkOnlyLateMin: 5,
  /** Fenêtre des propositions la nuit (après le premier départ possible). */
  nightPoolMin: 90,
  /** « Le suivant » et « Plus tard » : au plus 2 h après. */
  laterMaxMin: 120,
  proposals: 3,
  /** Réserves classées avec les propositions, pour le temps réel (design § 4.9). */
  reserves: 3,

  /* ---------- marche (PRD-1.2 § 1.2) : une préférence, plus un mur ---------- */
  /** Recherche toujours élargie : arrêts jusqu'à 15 min à pied, gares jusqu'à 25 min. */
  wideUrbanMin: 15,
  wideStationMin: 25,
  /** Passe « courte » : 5 min de marche au plus. */
  shortWalkMin: 5,
} as const;

/** Distance (m) parcourue en `min` minutes de marche (inverse de walkMinutes). */
export const walkReachM = (min: number) => (min * 80) / 1.3;

/** Marche maximale des réglages (« Mes favoris »), de 1 à 30 min, 10 par défaut : une préférence (PRD-1.2 § 1.2). */
export const maxWalkOf = (s: Pick<Settings, 'maxWalkMin'>) => Math.min(30, Math.max(1, Math.round(s.maxWalkMin || 10)));

/** Rayons de marche en minutes (PRD-1.2 § 1.2), quel que soit le réglage. */
export interface WalkRadii {
  /** Préférence : la marche maximale réglée (palier 0, PRD-1.2.1 § 1.1). */
  pref: number;
  /** Recherche élargie : arrêts urbains jusqu'à 15 min, gares jusqu'à 25 min (au moins la marche maximale plus
   *  5 min, le palier 1). */
  urban: number;
  station: number;
  /** Passe courte : 5 min. */
  short: number;
}

export function walkRadii(maxWalk: number): WalkRadii {
  const tier1 = maxWalk + P.walkStepMin;
  return { pref: maxWalk, urban: Math.max(P.wideUrbanMin, tier1), station: Math.max(P.wideStationMin, tier1), short: P.shortWalkMin };
}
