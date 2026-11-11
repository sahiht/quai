/**
 * 1.2.1 : textes partagés par les lunettes, le téléphone et Quai Web (docs/v1.2.1/PRD-1.2.1.md § 3 et § 5).
 *
 * - rideName / meansText : comment on voyage (« bus W + S1 », « IC + métro 2 »).
 * - longestWalk : la plus longue marche d'un trajet (paliers de marche, § 1.1).
 * - walksMore : un trajet marche plus qu'un autre (plus longue marche plus longue, et de plus de 5 min).
 * - displayLabel : nom affiché d'une proposition. La première s'appelle « Moins de marche » quand une proposition
 *   « Plus tôt » marche plus qu'elle, sinon « Le plus court » ; les autres gardent le texte de leur étiquette.
 * - holidayName / HOLIDAY_TEXT : jours fériés nationaux belges (horaires du dimanche dans les quatre réseaux).
 *
 * Fonctions pures : le vrai cœur, le faux cœur et les deux interfaces les partagent.
 */
import type { Journey, Leg } from './api';
import { LABEL_TEXT } from './api';
import { brusselsParts } from './util';

const NB = ' ';
const MODE_WORD: Record<string, string> = { bus: 'bus', tram: 'tram', metro: 'métro' };

/** Nom court d'un véhicule : « IC », « S1 » (trains : la catégorie), « bus W », « tram 92 », « métro 2 ». */
export function rideName(l: Pick<Leg, 'op' | 'mode' | 'line' | 'cat'>): string {
  if (l.op === 'sncb' || l.mode === 'train') return l.cat || l.line || 'train';
  const word = MODE_WORD[l.mode ?? 'bus'] ?? 'bus';
  return l.line ? `${word} ${l.line}` : word;
}

/** « bus W + S1 » ; plus de 3 véhicules : les 3 premiers puis « + … » ; aucun véhicule : « à pied ». */
export function meansText(j: Pick<Journey, 'legs'>): string {
  const rides = j.legs.filter((l) => l.kind === 'ride').map(rideName);
  if (!rides.length) return 'à pied';
  return rides.length > 3 ? `${rides.slice(0, 3).join(' + ')} + …` : rides.join(' + ');
}

/** La plus longue marche du trajet, en minutes (0 sans marche). */
export function longestWalk(j: Pick<Journey, 'legs'>): number {
  return j.legs.reduce((m, l) => (l.kind === 'walk' ? Math.max(m, Math.round(l.walkMin ?? 0)) : m), 0);
}

/** Une marche de 5 min au plus n'est jamais un inconvénient (« à 5 min près », comme le classement). */
const SHORT_WALK_MIN = 5;

/**
 * `a` marche plus que `b` (§ 2.1 et § 2.2) : sa plus longue marche est plus longue, et dure plus de 5 min. Sans ce
 * seuil, la nuit, un trajet parti bien plus tôt avec 3 min à pied ferait appeler « Moins de marche » un train direct.
 */
export function walksMore(a: Pick<Journey, 'legs'>, b: Pick<Journey, 'legs'>): boolean {
  const la = longestWalk(a);
  return la > longestWalk(b) && la > SHORT_WALK_MIN;
}

/**
 * Nom affiché d'une proposition (§ 2.1). `journeys` : toutes les propositions de la même recherche, dans l'ordre.
 * La première (« short ») devient « Moins de marche » quand une proposition « Plus tôt » marche plus qu'elle
 * (walksMore), sinon « Le plus court » ; les autres gardent le texte de leur étiquette. Jamais deux « Moins de
 * marche » : si une autre proposition porte déjà ce nom (étiquette lesswalk, palier plus bas), la première reste « Le
 * plus court ».
 */
export function displayLabel(j: Pick<Journey, 'label' | 'legs'>, journeys: readonly Pick<Journey, 'label' | 'legs'>[]): string {
  if (!j.label) return 'Autre trajet';
  if (j.label === 'short') {
    const earlier = journeys.find((x) => x.label === 'earlier');
    if (earlier && walksMore(earlier, j) && !journeys.some((x) => x.label === 'lesswalk')) return LABEL_TEXT.lesswalk;
  }
  return LABEL_TEXT[j.label];
}

/** Ligne affichée un jour férié (§ 5). */
export const HOLIDAY_TEXT = `Jour férié${NB}: horaires du dimanche`;

/** Dimanche de Pâques (calendrier grégorien, algorithme anonyme de Meeus, Jones et Butcher). */
export function easterSunday(y: number): { mo: number; d: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { mo: Math.floor(n / 31), d: (n % 31) + 1 };
}

const FIXED: Record<string, string> = {
  '1-1': 'Nouvel An',
  '5-1': 'Fête du travail',
  '7-21': 'Fête nationale',
  '8-15': 'Assomption',
  '11-1': 'Toussaint',
  '11-11': 'Armistice',
  '12-25': 'Noël',
};

/** Nom du jour férié national belge de cet instant (heure de Bruxelles), sinon null. */
export function holidayName(ms: number): string | null {
  const p = brusselsParts(ms);
  const fixed = FIXED[`${p.mo}-${p.d}`];
  if (fixed) return fixed;
  const e = easterSunday(p.y);
  const diff = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(p.y, e.mo - 1, e.d)) / 86_400_000);
  if (diff === 1) return 'Lundi de Pâques';
  if (diff === 39) return 'Ascension';
  if (diff === 50) return 'Lundi de Pentecôte';
  return null;
}
