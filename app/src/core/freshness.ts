/**
 * Fraîcheur des horaires publiés chaque nuit. Les données couvrent meta.serviceDates (aujourd'hui et demain
 * au moment de la publication). Si la mise à jour de nuit s'arrête, la date du jour finit par ne plus être couverte :
 * on n'affiche alors plus aucun départ plutôt que des horaires faux.
 */
import type { Meta } from '../../../shared/types';
import { brusselsParts, serviceDayBase } from './util';
import { ddmm } from './text';

export interface Freshness {
  ok: boolean;
  ageHours: number;
  message?: string;
}

/** Avant cette heure, la date de service de la veille couvre encore la nuit (voyages après minuit). */
const EARLY_HOUR = 4;
/** À partir de cette heure, des horaires publiés la veille signalent une mise à jour de nuit en retard. */
const LATE_HOUR = 6;

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * État des horaires à l'instant `now` (heure belge) :
 * - ok : la date du jour est couverte (ou, avant 04:00, celle de la veille) ;
 * - ageHours : âge de la publication (meta.generatedAt), une décimale ;
 * - message (≤ 48 caractères) : « Horaires périmés : mise à jour arrêtée le 11/11 », etc.
 */
export function dataFreshness(meta: Meta, now: number): Freshness {
  const dates = Array.isArray(meta?.serviceDates) ? [...meta.serviceDates].sort() : [];
  const gen = Date.parse(meta?.generatedAt ?? '');
  const ref = Number.isFinite(gen) ? gen : dates.length ? serviceDayBase(dates[0]) : now;
  const ageHours = Math.round(((now - ref) / 3_600_000) * 10) / 10;
  if (!dates.length) return { ok: false, ageHours, message: 'Horaires indisponibles : publication à vérifier' };
  const p = brusselsParts(now);
  const today = p.date;
  const covered = dates.includes(today) || (p.h < EARLY_HOUR && dates.includes(addDays(today, -1)));
  if (!covered) {
    if (today < dates[0]) return { ok: false, ageHours, message: `Horaires du ${ddmm(dates[0])} : vérifie la date du téléphone` };
    return { ok: false, ageHours, message: `Horaires périmés : mise à jour arrêtée le ${ddmm(addDays(dates[0], 1))}` };
  }
  if (today > dates[0] && p.h >= LATE_HOUR) return { ok: true, ageHours, message: 'Horaires d’hier : mise à jour de nuit en retard' };
  return { ok: true, ageHours };
}

/** Vrai si les horaires couvrent l'instant `now`. */
export function isCovered(meta: Meta, now: number): boolean {
  return dataFreshness(meta, now).ok;
}
