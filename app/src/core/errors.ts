/**
 * Erreurs lisibles (en français) levées par le cœur. L'interface affiche `message` tel quel.
 *
 * 1.1 (PRD M8.6) : serveur des horaires injoignable (réseau, délai, erreur serveur) → dataUnreachable ; serveur qui
 * répond sans le fichier, ou avec un fichier illisible → dataUnavailable, « … vérifie la publication de cette nuit ».
 * 1.2.2 (revue d'usage n° 10) : dataUnreachable dit « Pas de connexion aux horaires : nouvel essai dans 30 s »
 * (au lieu de « Horaires injoignables… »), une ligne des lunettes (542 px).
 */

export const MESSAGES = {
  dataUnavailable: 'Données indisponibles : vérifie la publication de cette nuit',
  dataUnreachable: 'Pas de connexion aux horaires : nouvel essai dans 30 s',
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
