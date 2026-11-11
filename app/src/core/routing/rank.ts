/**
 * Classement « Le plus court » et propositions étiquetées (PRD-1.2 § 1 ; design-routing.md § 4.8).
 *
 * « Le plus court » (§ 1.1), une seule fonction pour la proposition 1 comme pour les autres : un trajet en devance un
 * autre s'il arrive au moins 5 min plus tôt (la nuit, aucun départ dans l'heure demandée, sans partir plus de 30 min
 * avant lui) ; parmi les trajets que rien ne devance : la durée la plus courte, à 5 min près ; puis le moins de
 * changements de véhicule ; puis le moins de marche au total, à 5 min près ; puis l'arrivée la plus tôt ; puis le
 * départ le plus tard.
 *
 * Marche (§ 1.2) : une préférence, plus un mur. Marche longue : au moins la marche maximale plus 5 min ; elle ne
 * compte plus comme un changement. Un trajet avec une marche longue n'est « Le plus court » que s'il arrive au moins
 * 10 min avant le plus court des trajets sans marche longue. Filtres de la 1.1 (trajets dominés, correspondance qui ne
 * fait gagner que moins de 5 min sur le même premier véhicule) : jamais un trajet sans marche longue écarté au profit
 * d'un trajet avec marche longue.
 *
 * Propositions (§ 1.3), dans l'ordre, 3 au plus, sans doublon : Le plus court ; Plus tôt (le trajet qui arrive le plus
 * tôt, s'il arrive au moins 5 min avant) ; Moins de marche (« Le plus court » a une marche longue : le plus court des
 * trajets sans marche longue qui marchent au moins 5 min de moins, arrivée au plus 20 min après) ; Sans changement ou
 * Moins de changements (le plus court des trajets avec moins de changements, arrivée au plus 20 min après ; pas de
 * marche longue, sauf s'il n'arrive pas plus tard ou si « Le plus court » en a une) ; À pied (marche seule de 30 min
 * au plus, arrivée au plus 5 min après) ; Le suivant (même structure : mêmes lignes et sens, mêmes montées et
 * descentes ; train : mêmes gares et même catégorie ; départs successifs) ; Plus tard (la suite, jamais un trajet
 * devancé de plus de 30 min par un trajet parti au plus 30 min avant). Fenêtre : départs dans l'heure demandée ; la
 * nuit, jusqu'à 90 min après le premier départ possible ; « Le suivant » et « Plus tard » au plus 2 h après.
 *
 * Toutes les heures du classement sont en minutes (heures estimées quand le temps réel est connu, PRD 1.1 § 4.5).
 */
import type { Journey, JourneyLabel, Leg } from '../api';
import { headKey } from '../rtmerge';
import { P, walkRadii } from './params';
import { walksOf } from './reason';

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
  /** Référence : « Le plus court » (autres propositions) ou proposition précédente de même structure (Le suivant). */
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
  const R = walkRadii(maxWalk);
  const isLong = (x: T) => x.walks.some((w) => w >= R.long);
  // un trajet par identité : le départ le plus tard
  const byId = new Map<string, T>();
  for (const c of cands) {
    const cur = byId.get(c.id);
    if (!cur || c.dep > cur.dep) byId.set(c.id, c);
  }
  const unique = [...byId.values()];
  const walkOnly = unique.filter((x) => x.rides === 0).sort((a, b) => a.arr - b.arr)[0];
  let list = unique.filter((x) => x.rides > 0);
  // filtres de la 1.1 ; jamais un trajet sans marche longue écarté au profit d'un trajet avec marche longue
  const spare = (o: T, c: T) => isLong(o) && !isLong(c);
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
  /** Le plus court d'un ensemble (§ 1.1). */
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
   * Le plus court, avec une marche longue seulement s'il arrive au moins 10 min avant les trajets sans marche longue
   * (§ 1.2 : avant le plus court d'entre eux ; CA-1.2 : avant chacun d'eux), sinon le plus court sans marche longue.
   */
  const pick = (set: readonly T[]): T | undefined => {
    const s0 = shortest(set);
    if (!s0 || !isLong(s0)) return s0;
    const rest = set.filter((x) => !isLong(x));
    return rest.length && rest.some((x) => s0.arr > x.arr - P.longWalkGainMin) ? shortest(rest) : s0;
  };

  const first = pick(pool)!;
  const out: Ranked<T>[] = [{ item: first, label: 'short' }];
  const shown = (x: T) => out.some((r) => r.item === x);
  const add = (x: T | undefined, label: JourneyLabel, ref?: T): boolean => {
    if (!x || out.length >= max || shown(x)) return false;
    out.push(ref ? { item: x, label, ref } : { item: x, label });
    return true;
  };

  // plus tôt : le trajet qui arrive le plus tôt, s'il arrive au moins 5 min avant « Le plus court »
  const earliest = [...pool].sort((a, b) => a.arr - b.arr || a.transfers - b.transfers || a.walk - b.walk || b.dep - a.dep)[0];
  if (earliest !== first && earliest.arr <= first.arr - P.tieMin) add(earliest, earliest.rides ? 'earlier' : 'walk', first);
  // moins de marche : « Le plus court » a une marche longue
  if (isLong(first)) {
    add(pick(pool.filter((x) => !shown(x) && x.rides > 0 && !isLong(x) && x.walk <= first.walk - P.tieMin && x.arr <= first.arr + P.optionLateMin)), 'lesswalk', first);
  }
  // sans changement, moins de changements
  const fewer = pick(
    pool.filter((x) => !shown(x) && x.rides > 0 && x.transfers < first.transfers && x.arr <= first.arr + P.optionLateMin && (!isLong(x) || isLong(first) || x.arr <= first.arr)),
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
    // plus tard : la suite, jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant
    const later = all.filter((x) => x.dep <= laterLimit);
    const blocked = (y: T) => later.some((z) => z !== y && z.dep >= y.dep - P.laterGuardMin && z.arr < y.arr - P.laterGuardMin);
    let rest = later.filter((y) => !shown(y) && y.dep > first.dep && !blocked(y));
    while (rest.length && out.length < max) {
      const b = shortest(rest)!;
      add(b, 'later');
      rest = rest.filter((x) => x !== b);
    }
  }
  return out;
}
