/**
 * Raisons des propositions (PRD-1.2.1 § 2 ; PRD-1.2 § 1.3, règles de la 1.1 : PRD § 6.1 L3), une seule source pour le
 * cœur, le faux cœur et les tests. Fonctions pures : elles ne lisent que les étapes et les heures des trajets.
 *
 * - Espace insécable (U+00A0) devant « : » et entre un nombre et son unité (« 12 min », « 1 h »).
 * - Changements : « direct », « 1 changement », « {n} changements » (changements de véhicule).
 * - Marches : chacune d'au moins 1 min, dans l'ordre (« à pied 7 + 12 min ») ; au-delà de 3 marches : « {total} min à
 *   pied ». Une raison tient sur une ligne des lunettes (542 px) : la plus longue, « Moins de changements : 1
 *   changement, à pied 12 + 13 + 14 min », fait 60 caractères et 538 px ; au-delà de REASON_MAX caractères (cas
 *   extrême), forme « {total} min à pied », puis coupure avec « … ».
 * - Proposition 1 : « {nom affiché} : {changements}, à pied {a} + {b} min » ; marche seule : « {nom affiché} : à pied,
 *   {n} min ». Nom affiché (1.2.1 § 2.1, displayLabel de core/means.ts) : « Moins de marche » quand une proposition
 *   « Plus tôt » marche plus qu'elle (walksMore : plus longue marche plus longue, et de plus de 5 min), sinon « Le
 *   plus court ».
 * - Plus tôt (`ref` : la proposition 1) : s'il marche plus qu'elle (walksMore), « Plus tôt de 13 min, mais 19 min à
 *   pied » (sa plus longue marche) ; sinon « Plus tôt de 13 min, en partant à 19:20 » (départ du trajet, marche
 *   comprise).
 * - Moins de marche, autre que la proposition 1 (`ref` : la proposition 1) : « Moins de marche : arrive 25 min plus
 *   tard », complété de ses marches si la place le permet (« , à pied 2 + 3 min », sinon « , 7 min à pied »).
 * - Écarts entre deux heures affichées (Plus tôt, Moins de marche) : « 13 min », « 1 h » pour une heure pleine.
 * - Sans changement : « Sans changement : à pied {a} + {b} min » (sans marche : « arrivée {HH:MM} ») ; Moins de
 *   changements : « Moins de changements : {changements}, à pied {a} + {b} min ».
 * - « Le suivant » : écart entre les départs prévus du premier véhicule du trajet et de `ref` (la proposition
 *   précédente de même structure), comme dans l'horaire : « 15 min plus tard », « 1 h plus tard ». Remplacé par un
 *   trajet d'autres lignes qui le domine (PRD-1.2.2 § 7.4) : « Le suivant : 1 h plus tard », sans « même trajet ».
 * - « départ {HH:MM} » (Plus tard) : heure de départ du trajet (marche comprise), comme le titre des étapes.
 * - Sans la proposition 1 (`ref` absent), Plus tôt et Moins de marche gardent la forme de la 1.2
 *   (« {étiquette} : {changements}, à pied {a} + {b} min »).
 *
 * reasonsOf() donne les raisons de toutes les propositions d'une recherche : la raison de la proposition 1 dépend des
 * autres (son nom), celles de Plus tôt et de Moins de marche dépendent de la proposition 1.
 */
import type { Journey, JourneyLabel, Leg } from '../api';
import { LABEL_TEXT } from '../api';
import { displayLabel, longestWalk, walksMore } from '../means';
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

/** Écart entre deux heures : « 13 min », « 1 h », « 2 h » (heures pleines), « 75 min ». */
export function gapText(min: number): string {
  const n = Math.max(1, Math.round(min));
  return n % 60 === 0 ? `${n / 60}${NB}h` : `${n}${NB}min`;
}

/** Coupe une raison trop longue avec « … » (sans toucher aux espaces insécables). */
function cap(text: string): string {
  return text.length <= REASON_MAX ? text : `${text.slice(0, REASON_MAX - 1).trimEnd()}…`;
}

/** Départ prévu du premier véhicule, sinon départ du trajet. */
function firstRideDep(j: Trip): number {
  return j.legs.find(isRide)?.schedDep ?? j.dep;
}

/** Minutes entre deux heures affichées (HH:MM) : de `a` à `b`. */
const shownGap = (a: number, b: number) => Math.floor(b / 60_000) - Math.floor(a / 60_000);

/**
 * Raison affichée d'une proposition (PRD-1.2.1 § 2.2), REASON_MAX caractères au plus.
 * `ref` : la proposition 1 pour « Plus tôt » et « Moins de marche » ; le trajet précédent de même structure pour
 * « Le suivant ». `name` : nom affiché de la proposition 1 (« Le plus court » par défaut, voir reasonsOf).
 */
export function reasonText(label: JourneyLabel, j: Trip, ref?: Trip, name: string = LABEL_TEXT[label]): string {
  const head = `${label === 'short' ? name : LABEL_TEXT[label]}${NB}:`;
  const rides = j.legs.filter(isRide).length;
  const walks = walksOf(j);
  const walkTotal = walks.reduce((s, m) => s + m, 0) || Math.max(1, minutes(j.arr - j.dep));
  const ch = changesText(j.transfers);
  /** `{début}{sép}à pied {a} + {b} min` (forme « {total} min à pied » si trop long) ; sans marche : `{début}`. */
  const withWalks = (start: string, sep: string, optional = false) => {
    if (!walks.length) return cap(start);
    const all = `${start}${sep}${walksText(walks)}`;
    if (all.length <= REASON_MAX) return all;
    const total = `${start}${sep}${walksText(walks, true)}`;
    return cap(optional && total.length > REASON_MAX ? start : total);
  };
  switch (label) {
    case 'short':
      return rides ? withWalks(`${head} ${ch}`, ', ') : cap(`${head} à pied, ${walkTotal}${NB}min`);
    case 'earlier': {
      if (!ref) return withWalks(`${head} ${ch}`, ', ');
      const gain = `Plus tôt de ${gapText(shownGap(j.arr, ref.arr))}`;
      return cap(walksMore(j, ref) ? `${gain}, mais ${longestWalk(j)}${NB}min à pied` : `${gain}, en partant à ${hhmm(j.dep)}`);
    }
    case 'lesswalk': {
      if (!ref) return withWalks(`${head} ${ch}`, ', ');
      const d = shownGap(ref.arr, j.arr);
      const when = d > 0 ? `arrive ${gapText(d)} plus tard` : d < 0 ? `arrive ${gapText(-d)} plus tôt` : 'même heure d’arrivée';
      return withWalks(`${head} ${when}`, ', ', true);
    }
    case 'fewer':
      return withWalks(`${head} ${ch}`, ', ');
    case 'none':
      return walks.length ? withWalks(head, ' ') : cap(`${head} arrivée ${hhmm(j.arr)}`);
    case 'later':
      return cap(`${head} ${ch}, départ ${hhmm(j.dep)}`);
    case 'walk':
      return cap(`${head} ${walkTotal}${NB}min, arrivée ${hhmm(j.arr)}`);
    case 'next': {
      const later = laterText(ref ? (firstRideDep(j) - firstRideDep(ref)) / 60_000 : 0);
      return cap(ref && linesOf(j) !== linesOf(ref) ? `${head} ${later}` : `${head} même trajet, ${later}`);
    }
  }
}

/** Suite des lignes d'un trajet (train : catégorie). */
function linesOf(j: Pick<Journey, 'legs'>): string {
  return j.legs
    .filter(isRide)
    .map((l) => (l.op === 'sncb' || l.mode === 'train' ? `sncb/${l.cat ?? l.line ?? ''}` : `${l.op}/${l.line ?? ''}`))
    .join('|');
}

type Labeled = Trip & Pick<Journey, 'label'>;

/**
 * Raisons des propositions d'une même recherche, dans l'ordre d'affichage (PRD-1.2.1 § 2) : la proposition 1 avec son
 * nom affiché (displayLabel), Plus tôt et Moins de marche comparés à la proposition 1, Le suivant à la précédente « Le
 * suivant » (sinon à la proposition 1). Sans étiquette : pas de raison.
 */
export function reasonsOf(js: readonly Labeled[]): (string | undefined)[] {
  const first = js.find((x) => x.label === 'short');
  return js.map((j, i) => {
    if (!j.label) return undefined;
    if (j.label === 'short') return reasonText('short', j, undefined, displayLabel(j, js));
    let ref = first && first !== j ? first : undefined;
    if (j.label === 'next') {
      ref = js[0] !== j ? js[0] : undefined;
      for (let k = i - 1; k >= 0; k--)
        if (js[k].label === 'next' || js[k].label === 'short') {
          ref = js[k];
          break;
        }
    }
    return reasonText(j.label, j, ref);
  });
}
