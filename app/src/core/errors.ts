/**
 * Erreurs lisibles (en français) levées par le cœur. L'interface affiche `message` tel quel.
 *
 * 1.1 (PRD M8.6) : serveur des horaires injoignable (réseau, délai, erreur serveur) → dataUnreachable,
 * « Horaires injoignables : nouvel essai dans 30 s » ; serveur qui répond sans le fichier, ou avec un fichier
 * illisible → dataUnavailable, « … vérifie la publication de cette nuit ».
 */

export const MESSAGES = {
  dataUnavailable: 'Données indisponibles : vérifie la publication de cette nuit',
  dataUnreachable: 'Horaires injoignables : nouvel essai dans 30 s',
  areaUnknown: 'Arrêt introuvable dans les données du jour',
  hereMissing: 'Position inconnue : active la localisation',
  placeUnknown: 'Lieu introuvable dans tes réglages',
} as const;

export type QuaiErrorCode = keyof typeof MESSAGES;

export class QuaiError extends Error {
  readonly code: QuaiErrorCode;
  constructor(code: QuaiErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'QuaiError';
    this.code = code;
  }
}
