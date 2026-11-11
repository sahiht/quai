/**
 * Classement « le trajet le plus facile » et propositions étiquetées (PRD § 4.1 à § 4.3, design-routing.md § 4.8).
 *
 * « Le plus simple » (PRD § 4.1) : (1) le moins de changements, chaque marche d'au moins 1,5 × maxWalkMin comptant
 * pour un changement de plus ; (2) le moins de marche au total, moins de 5 min d'écart = égalité ; (3) sans
 * escaliers : donnée absente, critère inactif ; (4) l'arrivée la plus tôt ; (5) le moins de véhicules, puis le départ
 * le plus tard. Lecture séquentielle (§ 4.8, précision 1) : on part du trajet qui arrive le plus tôt et on ne le
 * remplace que par un trajet avec moins de changements, ou autant de changements et au moins 5 min de marche en moins.
 *
 * Garde-fou (§ 4.8, précision 2 ; moins-de-marche.md § 5) : de jour (un départ dans l'heure demandée), « Le plus
 * simple » n'arrive jamais plus de 30 min après la référence (la première arrivée de l'heure, à égalité celle qui
 * marche le moins), ni plus de 15 min après s'il ne fait pas marcher au moins 5 min de moins qu'elle ; la nuit, même
 * double seuil face aux seuls trajets qui ne partent pas plus de 30 min plus tôt.
 *
 * Propositions, dans l'ordre (3 au plus, sans doublon) : Le plus simple ; Le plus rapide (≥ 5 min plus tôt, départ au
 * plus 30 min avant) ; Plus tôt (≥ 5 min plus tôt, départ plus de 30 min avant) ; Moins de marche (moins-de-marche.md
 * § 1 : une marche du plus simple d'au moins la marche maximale ; au moins 5 min de marche en moins, au plus un
 * changement de plus, départ au plus 5 min avant, arrivée au plus 5 min après ; « Le plus rapide » en tient lieu s'il
 * remplit ces conditions) ; Sans changement ou Moins de changements (écarté par le garde-fou, au plus max(45 min,
 * moitié de la durée) après le plus simple, § 4.8 précision 4) ; À pied (≤ 30 min, au plus 5 min après le plus
 * simple) ; Le suivant (même structure : mêmes lignes et sens, mêmes montées et descentes ; train : mêmes gares et
 * même catégorie ; départs successifs) ; Plus tard (la suite du classement). Fenêtre (§ 4.8, précision 3) : départs
 * dans l'heure demandée ; la nuit, jusqu'à 90 min après le premier départ possible ; « Le suivant » et « Plus tard »
 * au plus 2 h après.
 *
 * Toutes les heures du classement sont en minutes (heures estimées quand le temps réel est connu, PRD § 4.5).
 */
import type { Journey, JourneyLabel, Leg } from '../api';
import { headKey } from '../rtmerge';
import { P } from './params';
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
  /** Référence : « Le plus simple » (Le plus rapide, Moins de marche) ou proposition précédente de même structure (Le suivant). */
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

/** Changements au sens du PRD § 4.1 : changements de véhicule, plus une par marche longue. */
export function changesOf(x: Pick<RankItem, 'transfers' | 'walks'>, maxWalk: number): number {
  const long = Math.ceil(P.longWalkFactor * maxWalk);
  return x.transfers + x.walks.filter((w) => w >= long).length;
}

/**
 * Propositions étiquetées, dans l'ordre d'affichage (`max` au plus). `after` : heure demandée (min).
 * Avec `max` > 3, les suivantes servent de réserves (temps réel).
 */
export function rank<T extends RankItem>(cands: readonly T[], after: number, maxWalk: number, max: number = P.proposals): Ranked<T>[] {
  const changes = (x: T) => changesOf(x, maxWalk);
  // un trajet par identité : le départ le plus tard
  const byId = new Map<string, T>();
  for (const c of cands) {
    const cur = byId.get(c.id);
    if (!cur || c.dep > cur.dep) byId.set(c.id, c);
  }
  const unique = [...byId.values()];
  const walkOnly = unique.filter((x) => x.rides === 0).sort((a, b) => a.arr - b.arr)[0];
  let list = unique.filter((x) => x.rides > 0);
  // trajets dominés : part plus tôt, arrive plus tard, sans moins de changements, sans 5 min de marche en moins
  // (égalité de marche du PRD § 4.1) ; au moins un critère strictement meilleur, donc jamais deux trajets qui se
  // dominent l'un l'autre
  list = list.filter(
    (c) =>
      !list.some(
        (o) =>
          o !== c &&
          o.dep >= c.dep &&
          o.arr <= c.arr &&
          changes(o) <= changes(c) &&
          o.walk < c.walk + P.walkTieMin &&
          (o.dep > c.dep || o.arr < c.arr || changes(o) < changes(c) || o.walk < c.walk),
      ),
  );
  // jamais une correspondance qui ne fait gagner que moins de 5 min sur le même premier véhicule, sauf si elle fait
  // marcher au moins 5 min de moins (moins-de-marche.md § 1 : « même train, puis tram »)
  list = list.filter(
    (c) => !list.some((o) => o !== c && o.firstRide === c.firstRide && o.rides < c.rides && o.arr < c.arr + P.uselessTransferMin && c.walk > o.walk - P.walkTieMin),
  );
  const all = list.length ? list : walkOnly ? [walkOnly] : [];
  if (!all.length) return [];

  // fenêtre des propositions
  const inWin = all.filter((x) => x.dep <= after + P.windowMin);
  const firstDep = Math.min(...all.map((x) => x.dep));
  const pool = inWin.length ? inWin : all.filter((x) => x.dep <= firstDep + P.nightPoolMin);
  // référence du garde-fou : la première arrivée (à égalité, celle qui marche le moins)
  const fastestRef = [...pool].sort((a, b) => a.arr - b.arr || a.walk - b.walk)[0];

  const pickSimple = (set: readonly T[]): T => {
    const sorted = [...set].sort((a, b) => a.arr - b.arr || changes(a) - changes(b) || a.walk - b.walk || a.rides - b.rides || b.dep - a.dep);
    let best = sorted[0];
    for (const x of sorted.slice(1)) {
      if (changes(x) < changes(best) || (changes(x) === changes(best) && x.walk <= best.walk - P.walkTieMin)) best = x;
    }
    return best;
  };
  const orderSimple = (set: readonly T[]): T[] => {
    const rest = [...set];
    const out: T[] = [];
    while (rest.length) {
      const b = pickSimple(rest);
      out.push(b);
      rest.splice(rest.indexOf(b), 1);
    }
    return out;
  };
  const night = !inWin.length;
  // x arrive trop tard face à y : plus de 30 min après, ou plus de 15 min après sans 5 min de marche en moins
  const tooLate = (x: T, y: T) => y.arr < x.arr - P.guardMin || (y.arr < x.arr - P.guardSameWalkMin && x.walk > y.walk - P.walkTieMin);
  const blockedIn = (set: readonly T[], x: T) => set.some((y) => y !== x && y.dep >= x.dep - P.guardMin && tooLate(x, y));
  const blocked = (x: T) => (night ? blockedIn(pool, x) : x !== fastestRef && tooLate(x, fastestRef));
  const eligible = pool.filter((x) => !blocked(x));
  const simplest = orderSimple(eligible.length ? eligible : pool)[0];
  // « Le suivant » et « Plus tard » : au plus 2 h après le départ du plus simple (ou l'heure demandée)
  const later = all.filter((x) => x.dep <= Math.max(after, simplest.dep) + P.laterMaxMin);

  const out: Ranked<T>[] = [{ item: simplest, label: 'simple' }];
  const shown = (x: T) => out.some((r) => r.item === x);
  const add = (x: T | undefined, label: JourneyLabel, ref?: T): boolean => {
    if (!x || out.length >= max || shown(x)) return false;
    out.push(ref ? { item: x, label, ref } : { item: x, label });
    return true;
  };
  const byArr = (a: T, b: T) => a.arr - b.arr || changes(a) - changes(b) || a.walk - b.walk || b.dep - a.dep;

  if (simplest.rides > 0) {
    const faster = pool.filter((x) => x !== simplest && x.arr <= simplest.arr - P.fastGainMin);
    add(faster.filter((x) => x.dep >= simplest.dep - P.fastMaxEarlierMin).sort(byArr)[0], 'fast', simplest);
    add(faster.filter((x) => x.dep < simplest.dep - P.fastMaxEarlierMin).sort(byArr)[0], 'earlier');
    // moins de marche : une marche du plus simple d'au moins la marche maximale (minutes affichées) ; le premier, dans
    // l'ordre du plus simple, des trajets du même créneau qui font marcher nettement moins ; « Le plus rapide » en
    // tient lieu s'il remplit ces conditions
    const lessWalk = (x: T) =>
      x !== simplest &&
      x.rides > 0 &&
      x.walk <= simplest.walk - P.lessWalkGainMin &&
      x.transfers <= simplest.transfers + P.lessWalkExtraTransfers &&
      x.dep >= simplest.dep - P.lessWalkSlotMin &&
      x.arr <= simplest.arr + P.lessWalkSlotMin;
    if (Math.max(0, ...simplest.walks) >= maxWalk && !out.some((r) => lessWalk(r.item))) {
      add(orderSimple(pool.filter((x) => !shown(x) && lessWalk(x)))[0], 'lesswalk', simplest);
    }
    const fewerBound = simplest.arr + Math.max(P.fewerMinMin, Math.round((simplest.arr - simplest.dep) / 2));
    const fewer = orderSimple(pool.filter((x) => !shown(x) && blocked(x) && changes(x) < changes(simplest) && x.arr <= fewerBound))[0];
    if (fewer) add(fewer, changes(fewer) === 0 ? 'none' : 'fewer');
    if (walkOnly && walkOnly.walk <= P.walkOnlyMaxMin && walkOnly.arr <= simplest.arr + P.walkOnlyLateMin) add(walkOnly, 'walk');
    // le suivant : même trajet, départs successifs. Seul un départ plus tardif du même trajet qui n'arrive pas plus
    // tard l'écarte (un autre trajet un peu meilleur ne fait pas sauter un départ du même trajet).
    const laterLimit = Math.max(after, simplest.dep) + P.laterMaxMin;
    const same = unique.filter((x) => x !== simplest && x.rides > 0 && x.structure === simplest.structure && x.dep <= laterLimit);
    const nextPool = same.filter((c) => !same.some((o) => o !== c && o.dep >= c.dep && o.arr <= c.arr && (o.dep > c.dep || o.arr < c.arr)));
    let cur = simplest;
    for (;;) {
      const next = nextPool.filter((x) => !shown(x) && x.dep > cur.dep).sort((a, b) => a.dep - b.dep || a.arr - b.arr)[0];
      if (!next || !add(next, 'next', cur)) break;
      cur = next;
    }
    for (const x of orderSimple(later.filter((y) => !shown(y) && y.dep > simplest.dep && !blockedIn(later, y)))) add(x, 'later');
  }
  return out;
}
