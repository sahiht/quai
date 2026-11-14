/**
 * 1.2.9 (PRD-1.2.9 § 2.2) : textes des écrans « Gares de train », « Arrêts de bus, tram, métro » et « Lignes de bus,
 * tram, métro » du téléphone : la liste dans l'ordre des lunettes, ses rangées dépliables, l'ajout sous la liste.
 * Fonctions pures, sans DOM ; la typographie française (typo de text.ts) est faite à l'affichage.
 */

export const L = {
  /** Sous le titre de chaque écran ; les lignes ajoutent leurs deux sens. */
  lead: 'Dans tes lunettes, dans cet ordre.',
  leadFollows: 'Chaque ligne s’y affiche dans les deux sens.',
  /** Interrupteur d'une rangée dépliée (`near`), et son sous-titre sans arrêt repère. */
  near: 'Ouvrir d’office',
  nearSub: 'à moins de 300 m',
  /** Rangée repliée ouverte d'office (une gare, un arrêt). */
  autoNear: 'Ouvre d’office à moins de 300 m',
  order: 'Ordre dans les lunettes',
  removeStation: 'Retirer cette gare',
  removeStop: 'Retirer cet arrêt',
  removeFollow: 'Retirer cette ligne',
  /** Nom de chaque liste pour les lecteurs d'écran. */
  stationsList: 'Tes gares, dans l’ordre des lunettes',
  stopsList: 'Tes arrêts, dans l’ordre des lunettes',
  followsList: 'Tes lignes, dans l’ordre des lunettes',
} as const;

/** Sous-titre de « Ouvrir d’office » d'une ligne avec un arrêt repère : « à moins de 300 m de Gare du Nord ». */
export const nearViaSub = (stop: string): string => `${L.nearSub} de ${stop}`;

/** Ligne repliée ouverte d'office : « Ouvre d’office près de Gare du Nord » (son arrêt repère). */
export const autoNearVia = (stop: string): string => `Ouvre d’office près de ${stop}`;

/** Rang dans les lunettes, sous « Ordre dans les lunettes » : « 1er sur 3 », « 2e sur 3 » (comme rankText). */
export const orderText = (rank: number, total: number): string => `${rank === 1 ? '1er' : `${rank}e`} sur ${total}`;
