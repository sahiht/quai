/**
 * Classement « le moins de marche d'abord » et propositions étiquetées (PRD-1.2.1 § 1, qui remplace « Le plus court
 * d'abord » de PRD-1.2 § 1 ; design-routing.md § 4.8).
 *
 * Palier de marche (§ 1.1) : la plus longue marche L d'un trajet (marche seule : sa durée), comparée à la marche
 * maximale réglée M : palier 0 si L ≤ M, sinon ceil((L − M) / 5). Avec M = 5 : jusqu'à 5 min palier 0, 6 à 10
 * palier 1, 11 à 15 palier 2…
 *
 * « Le plus rapide » d'un ensemble (`shortest`, la règle « Le plus court » de la 1.2) : un trajet en devance un autre
 * s'il arrive au moins 5 min plus tôt (la nuit, aucun départ dans l'heure demandée, sans partir plus de 30 min avant
 * lui) ; parmi les trajets que rien ne devance : la durée la plus courte, à 5 min près ; puis le moins de changements
 * de véhicule ; puis le moins de marche au total, à 5 min près ; puis l'arrivée la plus tôt ; puis le départ le plus
 * tard.
 *
 * Proposition 1 (§ 1.2, étiquette short ; `pick`) : E = l'arrivée la plus tôt de l'ensemble. Pour chaque palier
 * k = 0, 1, 2… : le plus rapide des trajets de palier k au plus, s'il arrive au plus 30 min après E (garde-fou contre
 * les détours, comme le bus 36 par Rixensart) ; sinon le palier suivant. Repli : le plus rapide de tout l'ensemble.
 * Filtres de la 1.1 (trajets dominés, correspondance qui ne fait gagner que moins de 5 min sur le même premier
 * véhicule) : jamais un trajet écarté au profit d'un trajet de palier plus haut (§ 1.3).
 *
 * Propositions (§ 1.4), dans l'ordre, 3 au plus, sans doublon : la proposition 1 ; Plus tôt (le trajet qui arrive le
 * plus tôt, s'il arrive au moins 5 min avant elle ; à même arrivée, le palier le plus bas) ; Moins de marche (seulement
 * si la proposition 1 n'est pas au palier 0 : le plus rapide des trajets de palier plus bas, arrivée au plus 20 min
 * après) ; Sans changement ou Moins de changements (choisi comme la proposition 1 parmi les trajets avec moins de
 * changements, arrivée au plus 20 min après ; jamais de palier plus haut que la proposition 1, sauf s'il n'arrive pas
 * plus tard) ; À pied (marche seule de 30 min au plus, arrivée au plus 5 min après) ; Le suivant (même structure :
 * mêmes lignes et sens, mêmes montées et descentes ; train : mêmes gares et même catégorie ; départs successifs) ; Plus
 * tard (la suite, chacun choisi comme la proposition 1 parmi les trajets restants, palier par palier avec le garde-fou
 * sur l'arrivée la plus tôt de ce reste ; jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min
 * avant). Fenêtre : départs dans l'heure demandée ; la nuit, jusqu'à 90 min après le premier départ possible ; « Le
 * suivant » et « Plus tard » au plus 2 h après.
 *
 * Toutes les heures du classement sont en minutes (heures estimées quand le temps réel est connu, PRD 1.1 § 4.5).
 */
import type { Journey, JourneyLabel, Leg } from '../api';
import { headKey } from '../rtmerge';
import { P } from './params';
import { walksOf } from './reason';

/**
 * Palier de marche (PRD-1.2.1 § 1.1) d'un trajet dont la plus longue marche dure `longest` minutes, avec la marche
 * maximale `maxWalk` : 0 jusqu'à `maxWalk`, puis un palier de plus par tranche de 5 min.
 */
export function walkTier(longest: number, maxWalk: number): number {
  return longest <= maxWalk ? 0 : Math.ceil((longest - maxWalk) / P.walkStepMin);
}

/** Plus longue marche (min) d'un élément du classement (marche seule : sa durée). */
export const longestOf = (x: Pick<RankItem, 'walks'>): number => x.walks.reduce((m, w) => Math.max(m, w), 0);

/** Ce que le classement lit d'un trajet. */
export interface RankItem {
  /** Départ (min) : départ du premier véhicule moins la marche jusqu'à lui (sans la marge « partir »). */
  dep: number;
  /** Arrivée finale (min). */
  arr: number;
  rides: number;
  transfers: number;
  /** Marches (min) dans l'ordre, chacune d'au moins 1 min. */
  walks: number[];
  walk: number;
  /** Premier véhicule (voyage, zone et heure de montée) : règle de la correspondance inutile. */
  firstRide: string;
  /** Structure (lignes et sens, montées et descentes ; train : catégorie et gares) : « Le suivant ». */
  structure: string;
  /** Identité (voyages, montées, descentes). */
  id: string;
  /** Attente la plus longue en correspondance (min). */
  maxWait: number;
}

export interface Ranked<T> {
  item: T;
  label: JourneyLabel;
  /** Référence : la proposition 1 (autres propositions) ou la proposition précédente de même structure (Le suivant). */
  ref?: T;
}

const MIN = 60_000;
const isRide = (l: Leg) => l.kind === 'ride';

/** Clé d'une étape en véhicule pour la structure : train = catégorie et gares ; sinon ligne, destination et zones. */
function rideStructure(l: Leg): string {
  const ends = `${l.from.areaId ?? `${l.from.lat},${l.from.lon}`}>${l.to.areaId ?? `${l.to.lat},${l.to.lon}`}`;
  if (l.op === 'sncb' || l.mode === 'train') return `sncb/${l.cat ?? l.line ?? ''}:${ends}`;
  return `${l.op}/${l.line ?? ''}>${headKey(l.head?.fr ?? '')}:${ends}`;
}

/** Éléments du classement lus dans un trajet (heures estimées). */
export function itemOf(j: Journey): RankItem & { j: Journey } {
  const rides = j.legs.filter(isRide);
  const first = rides[0];
  const accessWalk = j.legs[0]?.kind === 'walk' ? (j.legs[0].walkMin ?? 0) : 0;
  const dep = first ? first.dep - accessWalk * MIN : (j.legs[0]?.dep ?? j.dep);
  const walks = walksOf(j);
  let maxWait = 0;
  for (let i = 0, prev: Leg | undefined, walk = 0; i < j.legs.length; i++) {
    const l = j.legs[i];
    if (l.kind === 'walk') {
      walk += l.walkMin ?? 0;
      continue;
    }
    if (prev) maxWait = Math.max(maxWait, (l.dep - prev.arr) / MIN - walk);
    prev = l;
    walk = 0;
  }
  return {
    j,
    dep: dep / MIN,
    arr: j.arr / MIN,
    rides: rides.length,
    transfers: Math.max(0, rides.length - 1),
    walks,
    walk: walks.reduce((s, m) => s + m, 0),
    firstRide: first ? `${first.op}/${first.tripId || `${first.line}>${first.head?.fr ?? ''}`}@${first.from.areaId ?? ''}@${first.schedDep}` : '',
    structure: rides.map(rideStructure).join('|'),
    id: j.id,
    maxWait,
  };
}

/**
 * Propositions étiquetées, dans l'ordre d'affichage (`max` au plus). `after` : heure demandée (min) ; `maxWalk` :
 * marche maximale réglée (préférence). Avec `max` > 3, les suivantes servent de réserves (temps réel).
 */
export function rank<T extends RankItem>(cands: readonly T[], after: number, maxWalk: number, max: number = P.proposals): Ranked<T>[] {
  const tiers = new Map<T, number>();
  /** Palier de marche (§ 1.1). */
  const tier = (x: T): number => {
    let t = tiers.get(x);
    if (t === undefined) tiers.set(x, (t = walkTier(longestOf(x), maxWalk)));
    return t;
  };
  // un trajet par identité : le départ le plus tard
  const byId = new Map<string, T>();
  for (const c of cands) {
    const cur = byId.get(c.id);
    if (!cur || c.dep > cur.dep) byId.set(c.id, c);
  }
  const unique = [...byId.values()];
  const walkOnly = unique.filter((x) => x.rides === 0).sort((a, b) => a.arr - b.arr)[0];
  let list = unique.filter((x) => x.rides > 0);
  // filtres de la 1.1 (§ 1.3) : jamais un trajet écarté au profit d'un trajet de palier plus haut
  const spare = (o: T, c: T) => tier(o) > tier(c);
  // trajets dominés : part plus tôt, arrive plus tard, sans moins de changements, sans 5 min de marche en moins ; au
  // moins un critère strictement meilleur, donc jamais deux trajets qui se dominent l'un l'autre
  list = list.filter(
    (c) =>
      !list.some(
        (o) =>
          o !== c &&
          !spare(o, c) &&
          o.dep >= c.dep &&
          o.arr <= c.arr &&
          o.transfers <= c.transfers &&
          o.walk < c.walk + P.tieMin &&
          (o.dep > c.dep || o.arr < c.arr || o.transfers < c.transfers || o.walk < c.walk),
      ),
  );
  // jamais une correspondance qui ne fait gagner que moins de 5 min sur le même premier véhicule
  list = list.filter((c) => !list.some((o) => o !== c && !spare(o, c) && o.firstRide === c.firstRide && o.rides < c.rides && o.arr < c.arr + P.uselessTransferMin));
  const all = list.length ? list : walkOnly ? [walkOnly] : [];
  if (!all.length) return [];

  // fenêtre des propositions ; la marche seule (30 min au plus) concourt avec les autres
  const inWin = all.filter((x) => x.dep <= after + P.windowMin);
  const night = !inWin.length;
  const firstDep = Math.min(...all.map((x) => x.dep));
  const pool0 = inWin.length ? inWin : all.filter((x) => x.dep <= firstDep + P.nightPoolMin);
  const pool = walkOnly && walkOnly.walk <= P.walkOnlyMaxMin && !pool0.includes(walkOnly) ? [...pool0, walkOnly] : pool0;

  const dur = (x: T) => x.arr - x.dep;
  // y devance x : il arrive au moins 5 min plus tôt (la nuit, sans partir plus de 30 min avant)
  const ahead = (y: T, x: T) => y.arr <= x.arr - P.tieMin && (!night || y.dep >= x.dep - P.nightAheadMin);
  /** Le plus rapide d'un ensemble (« Le plus court » de la 1.2). */
  const shortest = (set: readonly T[]): T | undefined => {
    if (!set.length) return undefined;
    const free = set.filter((x) => !set.some((y) => y !== x && ahead(y, x)));
    const d = Math.min(...free.map(dur));
    let c = free.filter((x) => dur(x) < d + P.tieMin);
    const k = Math.min(...c.map((x) => x.transfers));
    c = c.filter((x) => x.transfers === k);
    const w = Math.min(...c.map((x) => x.walk));
    c = c.filter((x) => x.walk < w + P.tieMin);
    return [...c].sort((a, b) => a.arr - b.arr || b.dep - a.dep)[0];
  };
  /**
   * Proposition 1 d'un ensemble (§ 1.2) : palier par palier, le plus rapide des trajets de palier k au plus, s'il
   * arrive au plus 30 min après l'arrivée la plus tôt de l'ensemble (garde-fou contre les détours) ; repli : le plus
   * rapide de tous.
   */
  const pick = (set: readonly T[]): T | undefined => {
    if (!set.length) return undefined;
    const E = Math.min(...set.map((x) => x.arr));
    for (const k of [...new Set(set.map(tier))].sort((a, b) => a - b)) {
      const b = shortest(set.filter((x) => tier(x) <= k))!;
      if (b.arr <= E + P.detourGuardMin) return b;
    }
    return shortest(set);
  };

  const first = pick(pool)!;
  const out: Ranked<T>[] = [{ item: first, label: 'short' }];
  const shown = (x: T) => out.some((r) => r.item === x);
  const add = (x: T | undefined, label: JourneyLabel, ref?: T): boolean => {
    if (!x || out.length >= max || shown(x)) return false;
    out.push(ref ? { item: x, label, ref } : { item: x, label });
    return true;
  };

  // plus tôt : le trajet qui arrive le plus tôt, s'il arrive au moins 5 min avant la proposition 1 ; à même arrivée,
  // le palier le plus bas d'abord (le moins de marche), puis le moins de changements
  const earliest = [...pool].sort((a, b) => a.arr - b.arr || tier(a) - tier(b) || a.transfers - b.transfers || a.walk - b.walk || b.dep - a.dep)[0];
  if (earliest !== first && earliest.arr <= first.arr - P.tieMin) add(earliest, earliest.rides ? 'earlier' : 'walk', first);
  // moins de marche : la proposition 1 n'est pas au palier 0 ; le plus rapide des trajets de palier plus bas
  if (tier(first) > 0) {
    add(shortest(pool.filter((x) => !shown(x) && x.rides > 0 && tier(x) < tier(first) && x.arr <= first.arr + P.optionLateMin)), 'lesswalk', first);
  }
  // sans changement, moins de changements : jamais de palier plus haut que la proposition 1, sauf s'il n'arrive pas
  // plus tard
  const fewer = pick(
    pool.filter((x) => !shown(x) && x.rides > 0 && x.transfers < first.transfers && x.arr <= first.arr + P.optionLateMin && (tier(x) <= tier(first) || x.arr <= first.arr)),
  );
  if (fewer) add(fewer, fewer.transfers === 0 ? 'none' : 'fewer', first);
  // à pied
  if (walkOnly && walkOnly.walk <= P.walkOnlyMaxMin && walkOnly.arr <= first.arr + P.walkOnlyLateMin) add(walkOnly, 'walk', first);
  if (first.rides > 0) {
    // le suivant : même trajet, départs successifs. Seul un départ plus tardif du même trajet qui n'arrive pas plus
    // tard l'écarte (un autre trajet un peu meilleur ne fait pas sauter un départ du même trajet).
    const laterLimit = Math.max(after, first.dep) + P.laterMaxMin;
    const same = unique.filter((x) => x !== first && x.rides > 0 && x.structure === first.structure && x.dep <= laterLimit);
    const nextPool = same.filter((c) => !same.some((o) => o !== c && o.dep >= c.dep && o.arr <= c.arr && (o.dep > c.dep || o.arr < c.arr)));
    let cur = first;
    for (;;) {
      const next = nextPool.filter((x) => !shown(x) && x.dep > cur.dep).sort((a, b) => a.dep - b.dep || a.arr - b.arr)[0];
      if (!next || !add(next, 'next', cur)) break;
      cur = next;
    }
    // plus tard : la suite, jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant ;
    // chacun choisi comme la proposition 1 parmi le reste (le moins de marche d'abord, garde-fou sur l'arrivée la plus
    // tôt de ce reste)
    const later = all.filter((x) => x.dep <= laterLimit);
    const blocked = (y: T) => later.some((z) => z !== y && z.dep >= y.dep - P.laterGuardMin && z.arr < y.arr - P.laterGuardMin);
    let rest = later.filter((y) => !shown(y) && y.dep > first.dep && !blocked(y));
    while (rest.length && out.length < max) {
      const b = pick(rest)!;
      add(b, 'later');
      rest = rest.filter((x) => x !== b);
    }
  }
  return out;
}
