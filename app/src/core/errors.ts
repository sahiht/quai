/**
 * Erreurs lisibles (en français) levées par le cœur. L'interface affiche `message` tel quel.
 */

export const MESSAGES = {
  dataUnavailable: 'Données indisponibles : vérifie la publication de cette nuit',
  areaUnknown: 'Arrêt introuvable dans les données du jour',
  hereMissing: 'Position inconnue : active la localisation',
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
