/**
 * Raisons des propositions (PRD-1.2 § 1.3, règles de la 1.1 : PRD § 6.1 L3), une seule source pour le cœur, le faux
 * cœur et les tests. Fonctions pures : elles ne lisent que les étapes et les heures du trajet.
 *
 * - Espace insécable (U+00A0) devant « : » et entre un nombre et son unité (« 12 min », « 1 h »).
 * - Changements : « direct », « 1 changement », « {n} changements » (changements de véhicule).
 * - Marches : chacune d'au moins 1 min, dans l'ordre (« à pied 7 + 12 min ») ; au-delà de 3 marches : « {total} min à
 *   pied ». Une raison tient sur une ligne des lunettes (542 px) : la plus longue, « Moins de changements : 1
 *   changement, à pied 12 + 13 + 14 min », fait 60 caractères et 538 px ; au-delà de REASON_MAX caractères (cas
 *   extrême), forme « {total} min à pied », puis coupure avec « … ».
 * - Le plus court, Plus tôt, Moins de marche : « {étiquette} : {changements}, à pied {a} + {b} min » ; marche seule :
 *   « Le plus court : à pied, {n} min ». Sans changement : « Sans changement : à pied {a} + {b} min » (sans marche :
 *   « arrivée {HH:MM} ») ; Moins de changements : « Moins de changements : {changements}, à pied {a} + {b} min ».
 * - « Le suivant » : écart entre les départs prévus du premier véhicule du trajet et de `ref` (la proposition
 *   précédente de même structure), comme dans l'horaire : « 15 min plus tard », « 1 h plus tard ».
 * - « départ {HH:MM} » (Plus tard) : heure de départ du trajet (marche comprise), comme le titre des étapes.
 */
import type { Journey, JourneyLabel, Leg } from '../api';
import { LABEL_TEXT } from '../api';
import { hhmm } from '../util';

/** Espace insécable. */
export const NB = ' ';
/** Longueur maximale d'une raison (une ligne des lunettes, 542 px : 60 caractères de ces textes tiennent). */
export const REASON_MAX = 60;

type Trip = Pick<Journey, 'legs' | 'dep' | 'arr' | 'transfers'>;

const isRide = (l: Leg) => l.kind === 'ride';
const minutes = (ms: number) => Math.round(ms / 60_000);

/** « direct », « 1 changement », « 3 changements ». */
export function changesText(n: number): string {
  if (n <= 0) return 'direct';
  return n === 1 ? '1 changement' : `${n} changements`;
}

/** Durées des marches d'au moins 1 min, dans l'ordre du trajet. */
export function walksOf(j: Pick<Journey, 'legs'>): number[] {
  return j.legs.filter((l) => l.kind === 'walk').map((l) => Math.round(l.walkMin ?? 0)).filter((m) => m >= 1);
}

/** « à pied 7 + 12 min » ; plus de 3 marches (ou `total`) : « 23 min à pied » ; aucune marche : ''. */
export function walksText(walks: readonly number[], total = false): string {
  const w = walks.filter((m) => m >= 1);
  if (!w.length) return '';
  if (total || w.length > 3) return `${w.reduce((s, m) => s + m, 0)}${NB}min à pied`;
  return `à pied ${w.join(' + ')}${NB}min`;
}

/** « 15 min plus tard », « 1 h plus tard », « 2 h plus tard ». */
export function laterText(min: number): string {
  const n = Math.max(1, Math.round(min));
  return n % 60 === 0 ? `${n / 60}${NB}h plus tard` : `${n}${NB}min plus tard`;
}

/** Coupe une raison trop longue avec « … » (sans toucher aux espaces insécables). */
function cap(text: string): string {
  return text.length <= REASON_MAX ? text : `${text.slice(0, REASON_MAX - 1).trimEnd()}…`;
}

/** Départ prévu du premier véhicule, sinon départ du trajet. */
function firstRideDep(j: Trip): number {
  return j.legs.find(isRide)?.schedDep ?? j.dep;
}

/**
 * Raison affichée d'une proposition (PRD-1.2 § 1.3), REASON_MAX caractères au plus.
 * `ref` : trajet précédent de même structure pour « Le suivant ».
 */
export function reasonText(label: JourneyLabel, j: Trip, ref?: Trip): string {
  const head = `${LABEL_TEXT[label]}${NB}:`;
  const rides = j.legs.filter(isRide).length;
  const walks = walksOf(j);
  const walkTotal = walks.reduce((s, m) => s + m, 0) || Math.max(1, minutes(j.arr - j.dep));
  const ch = changesText(j.transfers);
  /** `{début}{sép}à pied {a} + {b} min` (forme « {total} min à pied » si trop long) ; sans marche : `{début}`. */
  const withWalks = (start: string, sep: string) => {
    if (!walks.length) return cap(start);
    const all = `${start}${sep}${walksText(walks)}`;
    return cap(all.length <= REASON_MAX ? all : `${start}${sep}${walksText(walks, true)}`);
  };
  switch (label) {
    case 'short':
      return rides ? withWalks(`${head} ${ch}`, ', ') : cap(`${head} à pied, ${walkTotal}${NB}min`);
    case 'earlier':
    case 'lesswalk':
    case 'fewer':
      return withWalks(`${head} ${ch}`, ', ');
    case 'none':
      return walks.length ? withWalks(head, ' ') : cap(`${head} arrivée ${hhmm(j.arr)}`);
    case 'later':
      return cap(`${head} ${ch}, départ ${hhmm(j.dep)}`);
    case 'walk':
      return cap(`${head} ${walkTotal}${NB}min, arrivée ${hhmm(j.arr)}`);
    case 'next':
      return cap(`${head} même trajet, ${laterText(ref ? (firstRideDep(j) - firstRideDep(ref)) / 60_000 : 0)}`);
  }
}
