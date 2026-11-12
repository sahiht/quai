/**
 * Classement des trajets (PRD-1.2.2 § 7, qui remplace « le moins de marche d'abord » de PRD-1.2.1 § 1 ; méthode et
 * mesures : bench/oracle, rapport interne du banc d'essai).
 *
 * Pour l'usager : « Le premier trajet est celui qui arrive le plus tôt ; au-delà de ta marche maximale, chaque minute à
 * pied compte triple. »
 *
 * Coût d'un trajet, en minutes : arrivée + 3 × max(0, plus longue marche − marche maximale) + 1 × changements (marche
 * seule : sa durée est sa plus longue marche). Une marche jusqu'à la marche maximale ne coûte que son temps.
 *
 * Proposition 1 (short) : le coût le plus bas ; à égalité, le moins de changements, la plus courte plus longue marche,
 * la marche totale la plus courte, le départ le plus tard (puis la garde ci-dessous). Elle n'est donc jamais dominée
 * par un autre candidat, et jamais une marche absurde : 6 min au-delà de la marche maximale coûtent 18 min.
 *
 * Deux autres propositions au plus, chacune avec un gain visible sur la proposition 1, dans cet ordre :
 * - Plus tôt (earlier) : le trajet qui arrive le plus tôt, s'il arrive au moins 5 min avant elle (souvent en marchant
 *   plus) ; la marche seule n'est proposée qu'en proposition 1 ou ainsi ;
 * - Moins de marche (lesswalk), seulement si la plus longue marche de la proposition 1 dépasse la marche maximale :
 *   parmi les trajets arrivés au plus 20 min après elle, celui dont la plus longue marche est la plus courte, s'il tient
 *   dans la marche maximale ou marche au moins 5 min de moins ;
 * - Sans changement, Moins de changements (none, fewer) : le meilleur coût des trajets qui changent moins, arrivés au
 *   plus 15 min après elle, sans marcher plus qu'elle au-delà de la marche maximale ;
 * puis, pour compléter : Le suivant (next : même structure, mêmes lignes, montées et descentes, départ suivant ; une
 * seule fois, les départs suivants de même structure qui complètent la liste sont « Plus tard ») et Plus tard (later :
 * le meilleur coût des trajets partis et arrivés après la proposition 1, « Le suivant » et les « Plus tard » déjà
 * affichés ; jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant).
 *
 * Gardes : aucune proposition n'est dominée par un candidat, quel qu'il soit, affiché ou non (départ plus tard ou égal,
 * arrivée, plus longue marche et changements pas pires, l'un meilleur) ; sinon un trajet qui la domine et que rien ne
 * domine prend sa place dans le même rôle (« Le suivant » : l'IC puis le T4 qui arrive 5 min plus tôt que l'IC puis le
 * T3), puis les autres gardes s'appliquent : jamais deux trajets de la même suite de lignes (sauf « Le suivant », le
 * même trajet plus tard), la marche seule seulement en proposition 1 ou « Plus tôt », 3 propositions au plus.
 *
 * Fenêtre : départs dans l'heure demandée ; la nuit (aucun départ en véhicule dans l'heure), jusqu'à 90 min après le
 * premier départ possible ; marche seule de 30 min au plus, sans limite s'il n'y a aucun trajet en véhicule (le moteur
 * ne la propose alors que jusqu'à 60 min) ; « Le suivant » et « Plus tard » au plus 2 h après. Toutes les heures sont en
 * minutes (heures estimées quand le temps réel est connu, PRD 1.1 § 4.5).
 */
import type { Journey, JourneyLabel, Leg } from '../api';
import { headKey } from '../rtmerge';
import { P } from './params';
import { walksOf } from './reason';

/**
 * Palier de marche de la 1.2.1 (PRD-1.2.1 § 1.1), gardé pour le faux cœur et les outils : 0 jusqu'à `maxWalk`, puis
 * un palier de plus par tranche de 5 min. Le classement 1.2.2 ne s'en sert plus.
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
  /** Premier véhicule (voyage, zone et heure de montée). */
  firstRide: string;
  /** Structure (lignes et sens, montées et descentes ; train : catégorie et gares) : « Le suivant ». */
  structure: string;
  /** Suite des lignes (« tec/W|sncb/S1 ») : deux propositions ne la partagent jamais (sauf « Le suivant »). Absente :
   *  lue dans la structure. */
  lines?: string;
  /** Identité (voyages, montées, descentes). */
  id: string;
  /** Attente la plus longue en correspondance (min). */
  maxWait: number;
  /** Retards annoncés (min, somme des véhicules) : dernier départage, le passage le plus vraisemblable d'abord (deux
   *  voyages prévus que le temps réel de la STIB rattache au même passage). */
  delay?: number;
}

export interface Ranked<T> {
  item: T;
  label: JourneyLabel;
  /** Référence : la proposition 1 (autres propositions) ou la proposition précédente de même structure (Le suivant). */
  ref?: T;
}

const MIN = 60_000;
const isRide = (l: Leg) => l.kind === 'ride';

/** Ligne d'une étape en véhicule : train = catégorie (IC, S1, BUS) ; sinon ligne. */
function rideLine(l: Leg): string {
  if (l.op === 'sncb' || l.mode === 'train') return `sncb/${l.cat ?? l.line ?? ''}`;
  return `${l.op}/${l.line ?? ''}`;
}

/** Clé d'une étape en véhicule pour la structure : train = catégorie et gares ; sinon ligne, destination et zones. */
function rideStructure(l: Leg): string {
  const ends = `${l.from.areaId ?? `${l.from.lat},${l.from.lon}`}>${l.to.areaId ?? `${l.to.lat},${l.to.lon}`}`;
  if (l.op === 'sncb' || l.mode === 'train') return `sncb/${l.cat ?? l.line ?? ''}:${ends}`;
  return `${l.op}/${l.line ?? ''}>${headKey(l.head?.fr ?? '')}:${ends}`;
}

/** Suite des lignes lue dans une structure (`sncb/IC:…|stib/2>…:…`). */
function linesOfStructure(structure: string): string {
  if (!structure) return '';
  return structure
    .split('|')
    .map((p) => (p.startsWith('sncb/') ? p.slice(0, p.indexOf(':') < 0 ? p.length : p.indexOf(':')) : p.slice(0, p.indexOf('>') < 0 ? p.length : p.indexOf('>'))))
    .join('|');
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
    lines: rides.map(rideLine).join('|'),
    id: j.id,
    maxWait,
    delay: rides.reduce((s, l) => s + Math.max(0, l.delayMin ?? 0), 0),
  };
}

/** Secondes entières d'une heure en minutes (les comparaisons ne dépendent jamais des arrondis des minutes). */
const sec = (min: number) => Math.round(min * 60);

/**
 * Coût d'un trajet (min, PRD-1.2.2 § 7) : arrivée + 3 × max(0, plus longue marche − marche maximale) + 1 × changements.
 */
export function costOf(x: Pick<RankItem, 'arr' | 'walks' | 'transfers'>, maxWalk: number): number {
  return x.arr + P.walkPenalty * Math.max(0, longestOf(x) - maxWalk) + P.transferPenalty * x.transfers;
}

/** Ce que les règles comparent, en secondes entières. */
interface Row<T> {
  x: T;
  dep: number;
  arr: number;
  lw: number;
  tw: number;
  tr: number;
  /** Plus longue marche au-delà de la marche maximale (min). */
  over: number;
  cost: number;
  lines: string;
  delay: number;
  id: string;
}

type Order<T extends RankItem> = (a: Row<T>, b: Row<T>) => number;
const byId = <T extends RankItem>(a: Row<T>, b: Row<T>) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** « Le suivant » : le départ le plus tôt, puis l'arrivée. */
const byNext = <T extends RankItem>(a: Row<T>, b: Row<T>) => a.dep - b.dep || a.arr - b.arr || byId(a, b);
/** Ordre de la proposition 1 : coût, puis changements, plus longue marche, marche totale, départ le plus tard (puis le
 *  moins de retard annoncé, l'identité). */
const byCost = <T extends RankItem>(a: Row<T>, b: Row<T>) => a.cost - b.cost || a.tr - b.tr || a.lw - b.lw || a.tw - b.tw || b.dep - a.dep || a.delay - b.delay || byId(a, b);
/** « Plus tôt » : arrivée, puis plus longue marche, changements, marche totale, départ le plus tard. */
const byArr = <T extends RankItem>(a: Row<T>, b: Row<T>) => a.arr - b.arr || a.lw - b.lw || a.tr - b.tr || a.tw - b.tw || b.dep - a.dep || a.delay - b.delay || byId(a, b);
/** « Moins de marche » : plus longue marche, puis marche totale, arrivée, changements, départ le plus tard. */
const byWalk = <T extends RankItem>(a: Row<T>, b: Row<T>) => a.lw - b.lw || a.tw - b.tw || a.arr - b.arr || a.tr - b.tr || b.dep - a.dep || a.delay - b.delay || byId(a, b);

/** a domine b : départ plus tard ou égal, arrivée, plus longue marche et changements pas pires, l'un meilleur. */
function dominates<T extends RankItem>(a: Row<T>, b: Row<T>): boolean {
  return a.dep >= b.dep && a.arr <= b.arr && a.lw <= b.lw && a.tr <= b.tr && (a.dep > b.dep || a.arr < b.arr || a.lw < b.lw || a.tr < b.tr);
}

/** Les trajets du classement dans l'ordre de la proposition 1 (coût, puis départages), pour le temps réel. */
export function byCostOrder<T extends RankItem>(cands: readonly T[], maxWalk: number): T[] {
  return cands.map((x) => rowOf(x, maxWalk)).sort(byCost).map((r) => r.x);
}

function rowOf<T extends RankItem>(x: T, maxWalk: number): Row<T> {
  const lw = longestOf(x);
  const over = Math.max(0, lw - maxWalk);
  return {
    x,
    dep: sec(x.dep),
    arr: sec(x.arr),
    lw,
    tw: x.walk,
    tr: x.transfers,
    over,
    cost: sec(x.arr) + 60 * (P.walkPenalty * over + P.transferPenalty * x.transfers),
    lines: x.lines ?? linesOfStructure(x.structure),
    delay: x.delay ?? 0,
    id: x.id,
  };
}

/**
 * Propositions étiquetées, dans l'ordre d'affichage (`max` au plus). `after` : heure demandée (min) ; `maxWalk` :
 * marche maximale réglée (une préférence : au-delà, chaque minute de la plus longue marche compte triple).
 */
export function rank<T extends RankItem>(cands: readonly T[], after: number, maxWalk: number, max: number = P.proposals): Ranked<T>[] {
  // un trajet par identité : le départ le plus tard
  const ids = new Map<string, T>();
  for (const c of cands) {
    const cur = ids.get(c.id);
    if (!cur || c.dep > cur.dep) ids.set(c.id, c);
  }
  const rows = [...ids.values()].map((x) => rowOf(x, maxWalk));
  const rides = rows.filter((r) => r.x.rides > 0);
  const walkOnly = rows.filter((r) => r.x.rides === 0).sort(byArr)[0];
  // fenêtre des propositions ; la nuit, jusqu'à 90 min après le premier départ possible
  const inWin = rides.filter((r) => r.x.dep <= after + P.windowMin);
  const firstDep = Math.min(...rides.map((r) => r.x.dep));
  // à arrivée, marches et changements égaux, partir plus tard : un trajet de la fenêtre qu'un autre domine (départ plus
  // tard ou égal, arrivée, plus longue marche, marche totale et changements pas pires, l'un meilleur) lui cède sa place,
  // même parti après l'heure (le T3 de 16:57 plutôt que celui de 16:09 et 52 min d'attente pour le même IC)
  const outdoes = (y: Row<T>, x: Row<T>) =>
    y.dep >= x.dep && y.arr <= x.arr && y.lw <= x.lw && y.tw <= x.tw && y.tr <= x.tr && (y.dep > x.dep || y.arr < x.arr || y.lw < x.lw || y.tw < x.tw || y.tr < x.tr);
  const instead = (x: Row<T>) => rides.filter((y) => outdoes(y, x)).sort(byCost)[0] ?? x;
  const pool0 = [...new Set((inWin.length ? inWin : rides.filter((r) => r.x.dep <= firstDep + P.nightPoolMin)).map(instead))];
  // la marche seule concourt avec les autres (30 min au plus ; sans limite s'il n'y a rien d'autre)
  const pool = walkOnly && (walkOnly.x.walk <= P.walkOnlyMaxMin || !pool0.length) ? [...pool0, walkOnly] : pool0;
  if (!pool.length) return [];

  // Garde sur chaque proposition : aucun candidat, quel qu'il soit, ne la domine (départ plus tard ou égal, arrivée,
  // plus longue marche et changements pas pires, l'un meilleur). Sinon un trajet qui la domine et que rien ne domine
  // prend sa place, dans le même rôle (le premier dans l'ordre du rôle) ; les autres gardes s'appliquent à lui, et s'il
  // ne les passe pas, le candidat suivant du rôle est essayé.
  const free = rows.filter((r) => !rows.some((c) => dominates(c, r)));
  const top = (r: Row<T>, order: Order<T>): Row<T> => (free.includes(r) ? r : free.filter((c) => dominates(c, r)).sort(order)[0]);
  /** Le remplaçant non dominé du premier candidat du rôle (dans son ordre) qui passe les conditions du rôle. */
  const pick = (list: readonly Row<T>[], order: Order<T>, ok: (r: Row<T>) => boolean): Row<T> | undefined => {
    for (const r of [...list].sort(order)) {
      const t = top(r, order);
      if (ok(t)) return t;
    }
    return undefined;
  };
  /** La marche seule n'est proposée qu'en proposition 1 ou « Plus tôt », et seulement si elle concourt. */
  const walkOk = (r: Row<T>) => r.x.rides > 0 || pool.includes(r);

  const first = pick(pool, byCost, walkOk) ?? [...pool].sort(byCost)[0];
  const out: Ranked<T>[] = [{ item: first.x, label: 'short' }];
  const shown: Row<T>[] = [first];
  /** Gardes sur l'ensemble affiché : ni dominé ni dominant, jamais la même suite de lignes (sauf « Le suivant »). */
  const showable = (r: Row<T>, label: JourneyLabel) =>
    !shown.includes(r) && shown.every((s) => !dominates(s, r) && !dominates(r, s) && (label === 'next' || s.lines !== r.lines));
  const add = (r: Row<T> | undefined, label: JourneyLabel, ref?: Row<T>): boolean => {
    if (!r || out.length >= max) return false;
    out.push(ref ? { item: r.x, label, ref: ref.x } : { item: r.x, label });
    shown.push(r);
    return true;
  };
  const alternatives = () => out.length - 1 < P.alternatives && out.length < max;
  const gain = 60 * P.tieMin;

  // plus tôt : l'arrivée la plus tôt, au moins 5 min avant la proposition 1 (marche seule comprise)
  if (alternatives()) {
    const early = (r: Row<T>) => r.arr <= first.arr - gain;
    add(pick(pool.filter(early), byArr, (t) => early(t) && walkOk(t) && showable(t, 'earlier')), 'earlier', first);
  }
  // moins de marche : la plus longue marche de la proposition 1 dépasse la marche maximale ; la plus courte plus longue
  // marche des trajets arrivés au plus 20 min après, si elle tient dans la marche maximale ou fait 5 min de moins
  if (alternatives() && first.over > 0) {
    const near = (r: Row<T>) => r.x.rides > 0 && r.arr <= first.arr + 60 * P.lessWalkLateMin;
    const w = pick(pool.filter(near), byWalk, (t) => near(t) && showable(t, 'lesswalk'));
    if (w && (w.lw <= maxWalk || w.lw <= first.lw - P.lessWalkGainMin)) add(w, 'lesswalk', first);
  }
  // sans changement, moins de changements : arrivée au plus 15 min après, jamais plus de marche au-delà de la marche
  // maximale que la proposition 1
  if (alternatives()) {
    const fewer = (r: Row<T>) => r.x.rides > 0 && r.tr < first.tr && r.arr <= first.arr + 60 * P.fewerLateMin && r.over <= first.over;
    const f = pick(pool.filter(fewer), byCost, (t) => fewer(t) && showable(t, t.tr === 0 ? 'none' : 'fewer'));
    if (f) add(f, f.tr === 0 ? 'none' : 'fewer', first);
  }
  if (first.x.rides > 0 && out.length < max) {
    // le suivant : même trajet, départs successifs (seul un départ plus tardif du même trajet qui n'arrive pas plus tard
    // l'écarte) ; un trajet d'autres lignes qui le domine prend sa place (l'IC puis le T4 plutôt que l'IC puis le T3).
    // « Le suivant » une seule fois : les départs suivants qui complètent la liste, dans l'ordre des départs, sont
    // « Plus tard » (même suite de lignes permise, comme pour « Le suivant »)
    const laterLimit = 60 * (Math.max(after, first.x.dep) + P.laterMaxMin);
    const same = rides.filter((r) => r !== first && r.x.structure === first.x.structure && r.dep <= laterLimit);
    const nextPool = same.filter((c) => !same.some((o) => o !== c && o.dep >= c.dep && o.arr <= c.arr && (o.dep > c.dep || o.arr < c.arr)));
    let cur = first;
    for (;;) {
      const prev = cur;
      const nx = pick(
        nextPool.filter((r) => r.dep > prev.dep),
        byNext,
        (t) => t.x.rides > 0 && t.dep > prev.dep && t.arr > prev.arr && t.dep <= laterLimit && showable(t, 'next'),
      );
      if (!nx || !(prev === first ? add(nx, 'next', prev) : add(nx, 'later'))) break;
      cur = nx;
    }
    // plus tard : le meilleur coût des trajets partis et arrivés après la proposition 1 et le dernier « Le suivant » ;
    // jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant
    const later = rides.filter((r) => r.dep <= laterLimit);
    const guard = 60 * P.laterGuardMin;
    const blocked = (y: Row<T>) => later.some((z) => z !== y && z.dep >= y.dep - guard && z.arr < y.arr - guard);
    while (out.length < max) {
      const seq = shown.filter((s, i) => i === 0 || out[i].label === 'next' || out[i].label === 'later');
      const minDep = Math.max(...seq.map((s) => s.dep));
      const minArr = Math.max(...seq.map((s) => s.arr));
      const beyond = (r: Row<T>) => r.dep > minDep && r.arr > minArr;
      const b = pick(later.filter(beyond), byCost, (t) => t.x.rides > 0 && beyond(t) && t.dep <= laterLimit && !blocked(t) && showable(t, 'later'));
      if (!b) break;
      add(b, 'later');
    }
  }
  return out;
}
