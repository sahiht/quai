/**
 * Règles de classement candidates, en reclassement pur sur un ensemble de trajets (oracle ∪ candidats du moteur) :
 * chacune donne la proposition 1 et au plus 2 autres propositions aux rôles clairs.
 *
 * - F0* : la règle 1.2.1 (rank() de rank.ts) rejouée sur le même ensemble (F0 = les propositions du moteur).
 * - F1 : coût généralisé = arrivée + w_marche × marche totale + p × changements + w_attente × attentes entre deux
 *   véhicules ; autres propositions : l'arrivée la plus tôt (si elle arrive plus tôt), le trajet qui marche le moins
 *   (plus longue marche, arrivée au plus 20 min après la proposition 1).
 * - F2 : l'arrivée la plus tôt, sauf si un trajet dont chaque marche dure au plus la marche maximale arrive au plus
 *   X min après : alors le premier de ceux-là (arrivée, puis moins de changements) ; mêmes autres propositions.
 */
import type { Shown } from './checks';
import { MIN, P, rankMod, rtmerge } from './quai';
import type { OTrip } from './search';

export interface Ctx {
  /** Heure demandée (min depuis base0). */
  T: number;
  M: number;
  /** Marche seule de O à D (min). */
  direct: number;
  base0: number;
}

/** Ensemble commun des règles : un trajet par signature, départ dans l'heure, garde-fous du produit (attente de 60 min
 *  au plus, marche seule de 30 min au plus) ; `walkRef` : aussi « jamais plus lent que la marche seule » (jusqu'à
 *  60 min de marche), le filtre `usable` du moteur, qui n'est pas une règle de classement. */
export function admissible(list: OTrip[], c: Ctx, walkRef = false): OTrip[] {
  const seen = new Map<string, OTrip>();
  for (const t of list) {
    if (t.dep < c.T || t.dep > c.T + P.windowMin) continue;
    if (t.rides > 0) {
      if (t.maxWait > P.maxWaitMin || t.uu > P.urbanUrbanMax || t.rides > P.rounds) continue;
      if (walkRef && c.direct <= P.walkRefMaxMin && t.arr > c.T + c.direct) continue;
    } else if (c.direct > P.walkOnlyMaxMin) continue;
    const cur = seen.get(t.key);
    if (!cur || (cur.src === 'engine' && t.src === 'oracle')) seen.set(t.key, t);
  }
  return [...seen.values()];
}

type Cmp = (a: OTrip, b: OTrip) => number;
export const byArr = (a: OTrip, b: OTrip) => a.arr - b.arr || a.lw - b.lw || a.transfers - b.transfers || a.tw - b.tw || b.dep - a.dep;
const show = (t: OTrip, label: string): Shown => ({ ...t, label });

/** Raccourci du moteur (engine.ts) : marche seule quand elle tient dans la marche maximale. Pas utilisé par les règles
 *  candidates (la marche seule y concourt comme les autres trajets) ; gardé pour mesurer son effet. */
export function walkFirst(pool: OTrip[], c: Ctx): Shown[] | null {
  if (c.direct > c.M) return null;
  const w = pool.find((t) => t.walkOnly);
  return w ? [show(w, 'walk')] : null;
}

/**
 * Autres propositions, mêmes seuils que la 1.2.1 : « Plus tôt » = l'arrivée la plus tôt, si elle arrive au moins 5 min
 * avant la proposition 1 ; « Moins de marche » = seulement si la proposition 1 marche plus que la marche maximale : le
 * trajet à la plus courte plus longue marche (puis marche totale, arrivée) arrivé au plus 20 min après elle.
 */
function alternatives(pool: OTrip[], first: OTrip, M: number): Shown[] {
  const out: Shown[] = [show(first, 'short')];
  const E = [...pool].sort(byArr)[0];
  if (E && E !== first && E.arr <= first.arr - P.tieMin) out.push(show(E, E.rides ? 'earlier' : 'walk'));
  if (first.lw > M) {
    const lw = pool
      .filter((t) => t.rides > 0 && t.lw < first.lw && t.arr <= first.arr + P.optionLateMin && !out.some((s) => s.key === t.key))
      .sort((a, b) => a.lw - b.lw || a.tw - b.tw || a.arr - b.arr || a.transfers - b.transfers || b.dep - a.dep)[0];
    if (lw) out.push(show(lw, 'lesswalk'));
  }
  return out.slice(0, 3);
}

export interface F1Params {
  wWalk: number;
  p: number;
  wWait: number;
}

export function costF1(t: OTrip, q: F1Params): number {
  return t.arr + q.wWalk * t.tw + q.p * t.transfers + q.wWait * t.waitSum;
}

export function F1(pool: OTrip[], c: Ctx, q: F1Params): Shown[] {
  if (!pool.length) return [];
  const first = [...pool].sort((a, b) => costF1(a, q) - costF1(b, q) || b.dep - a.dep || a.transfers - b.transfers || a.lw - b.lw || a.arr - b.arr)[0];
  return alternatives(pool, first, c.M);
}

export function F2(pool: OTrip[], c: Ctx, X: number): Shown[] {
  if (!pool.length) return [];
  const E = [...pool].sort(byArr)[0];
  let first = E;
  if (E.lw > c.M) {
    const low = pool.filter((t) => t.rides > 0 && t.lw <= c.M && t.arr <= E.arr + X).sort((a, b) => a.arr - b.arr || a.transfers - b.transfers || a.tw - b.tw || b.dep - a.dep);
    if (low.length) first = low[0];
  }
  return alternatives(pool, first, c.M);
}

/** Palier de marche de la 1.2.1 : 0 jusqu'à la marche maximale, puis un palier par tranche de 5 min. */
export const tierOf = (lw: number, M: number) => (lw <= M ? 0 : Math.ceil((lw - M) / P.walkStepMin));

/**
 * F3 (proposée ici, F2 par paliers) : E = l'arrivée la plus tôt ; pour k = 0, 1, 2… : parmi les trajets de palier k au
 * plus qui arrivent au plus X min après E, celui qui arrive le plus tôt (puis le moins de changements, la plus courte
 * plus longue marche, la marche totale la plus courte, le départ le plus tard) ; sinon le palier suivant. Mêmes autres
 * propositions que F1 et F2.
 */
export function F3(pool: OTrip[], c: Ctx, X: number): Shown[] {
  if (!pool.length) return [];
  const E = [...pool].sort(byArr)[0];
  const tiers = [...new Set(pool.map((t) => tierOf(t.lw, c.M)))].sort((a, b) => a - b);
  let first = E;
  for (const k of tiers) {
    const set = pool.filter((t) => tierOf(t.lw, c.M) <= k && t.arr <= E.arr + X).sort((a, b) => a.arr - b.arr || a.transfers - b.transfers || a.lw - b.lw || a.tw - b.tw || b.dep - a.dep);
    if (set.length) {
      first = set[0];
      break;
    }
  }
  return alternatives(pool, first, c.M);
}

/**
 * F4 (proposée ici, F1 sur la plus longue marche) : coût = arrivée + λ × (plus longue marche au-delà de la marche
 * maximale) + p × changements ; à coût égal : le moins de changements, la plus courte plus longue marche, la marche
 * totale la plus courte, le départ le plus tard. Une marche jusqu'à la marche maximale ne coûte rien de plus que son
 * temps. Jamais une proposition 1 dominée (arrivée, plus longue marche, changements) ; jamais une marche absurde
 * (plus de M + 5 min alors qu'un trajet sans marche de plus de M arrive au plus 15 min après) si 6λ > 15 + 2p.
 * Mêmes autres propositions que F1 et F2.
 */
export function costF4(t: OTrip, M: number, lambda: number, p: number): number {
  return t.arr + lambda * Math.max(0, t.lw - M) + p * t.transfers;
}

export function F4(pool: OTrip[], c: Ctx, lambda: number, p: number): Shown[] {
  if (!pool.length) return [];
  const first = [...pool].sort((a, b) => costF4(a, c.M, lambda, p) - costF4(b, c.M, lambda, p) || a.transfers - b.transfers || a.lw - b.lw || a.tw - b.tw || b.dep - a.dep)[0];
  return alternatives(pool, first, c.M);
}

/* ---------- F5 : la règle retenue pour la 1.2.2, écrite ici sans le code du moteur ---------- */

/**
 * F5 (décision du 12/11, PRD-1.2.2 § 7), réécrite ici pour contrôler rank.ts sans s'en servir : proposition 1 = F4
 * (λ = 3, p = 1) ; au plus deux autres avec un gain visible, dans l'ordre « Plus tôt » (l'arrivée la plus tôt, au moins
 * 5 min avant), « Moins de marche » (seulement si la proposition 1 marche plus que la marche maximale : la plus courte
 * plus longue marche des trajets arrivés au plus 20 min après, si elle tient dans la marche maximale ou fait 5 min de
 * moins), « Sans changement » ou « Moins de changements » (moins de changements, au plus 15 min après, jamais plus de
 * marche au-delà de la marche maximale) ; puis « Le suivant » (même structure, une seule fois : les départs suivants
 * qui complètent la liste sont « Plus tard ») et « Plus tard » (parti et arrivé après les précédents). Gardes : aucun trajet affiché dominé par un candidat, affiché ou non
 * (départ ≥, arrivée, plus longue marche, changements ≤, l'un meilleur), sinon un candidat qui le domine le remplace
 * dans le même rôle ; pas deux fois la même suite de lignes (sauf « Le suivant ») ; 3 au plus. La marche seule n'est
 * jamais « Moins de marche », « Sans changement », « Le suivant » ni « Plus tard ».
 * `later` : trajets du moteur partis après l'heure demandée (« Le suivant », « Plus tard », candidats de la garde).
 */
export function F5(pool: OTrip[], c: Ctx, later: OTrip[] = []): Shown[] {
  if (!pool.length) return [];
  const M = c.M;
  const over = (t: OTrip) => Math.max(0, t.lw - M);
  const cost = (t: OTrip) => costF4(t, M, 3, 1);
  const byCost = (a: OTrip, b: OTrip) => cost(a) - cost(b) || a.transfers - b.transfers || a.lw - b.lw || a.tw - b.tw || b.dep - a.dep;
  const byWalk = (a: OTrip, b: OTrip) => a.lw - b.lw || a.tw - b.tw || a.arr - b.arr || a.transfers - b.transfers || b.dep - a.dep;
  const lineSeq = (t: OTrip) => t.legs.filter((l) => l.kind === 'ride').map((l) => `${l.op}/${l.line}`).join('|');
  const structure = (t: OTrip) =>
    t.legs
      .filter((l) => l.kind === 'ride')
      .map((l) => (l.op === 'sncb' ? `${l.line}:${l.from}>${l.to}` : `${l.op}/${l.line}>${rtmerge.headKey(l.head ?? '')}:${l.from}>${l.to}`))
      .join('|');
  const dom = (a: OTrip, b: OTrip) =>
    a.dep >= b.dep && a.arr <= b.arr && a.lw <= b.lw && a.transfers <= b.transfers && (a.dep > b.dep || a.arr < b.arr || a.lw < b.lw || a.transfers < b.transfers);
  // garde (§ 7.4) : aucune proposition dominée par un candidat de l'ensemble (fenêtre et départs plus tardifs du
  // moteur) ; sinon un candidat qui la domine et que rien ne domine la remplace dans le même rôle (le premier dans
  // l'ordre du rôle), puis les autres gardes ; s'il ne les passe pas, le candidat suivant du rôle
  const everyone = [...pool, ...later.filter((t) => !pool.some((p) => p.key === t.key))];
  const top = everyone.filter((t) => !everyone.some((o) => dom(o, t)));
  const best = (t: OTrip, order: Cmp) => (top.includes(t) ? t : top.filter((o) => dom(o, t)).sort(order)[0]);
  const choose = (list: OTrip[], order: Cmp, keep: (t: OTrip) => boolean) => {
    for (const t of [...list].sort(order)) {
      const b = best(t, order);
      if (keep(b)) return b;
    }
    return undefined;
  };
  const inPool = (t: OTrip) => t.rides > 0 || pool.includes(t);
  const first = choose(pool, byCost, inPool) ?? [...pool].sort(byCost)[0];
  const out: Shown[] = [show(first, 'short')];
  const ok = (t: OTrip, label: string) =>
    !out.some((s) => s.key === t.key) && out.every((s) => !dom(s, t) && !dom(t, s) && (label === 'next' || lineSeq(s) !== lineSeq(t)));
  const alt = () => out.length < 3;
  const early = (t: OTrip) => t.arr <= first.arr - 5;
  const E = choose(pool.filter(early), byArr, (t) => early(t) && inPool(t) && ok(t, 'earlier'));
  if (E && alt()) out.push(show(E, 'earlier'));
  if (over(first) > 0 && alt()) {
    const near = (t: OTrip) => t.rides > 0 && t.arr <= first.arr + 20;
    const w = choose(pool.filter(near), byWalk, (t) => near(t) && ok(t, 'lesswalk'));
    if (w && (w.lw <= M || w.lw <= first.lw - 5)) out.push(show(w, 'lesswalk'));
  }
  if (alt()) {
    const fewer = (t: OTrip) => t.rides > 0 && t.transfers < first.transfers && t.arr <= first.arr + 15 && over(t) <= over(first);
    const f = choose(pool.filter(fewer), byCost, (t) => fewer(t) && ok(t, 'fewer'));
    if (f) out.push(show(f, f.transfers === 0 ? 'none' : 'fewer'));
  }
  if (first.rides > 0 && out.length < 3) {
    const all = everyone.filter((t) => t.rides > 0);
    const limit = Math.max(c.T, first.dep) + 120;
    const same = all.filter((t) => t.key !== first.key && structure(t) === structure(first) && t.dep <= limit);
    const nextPool = same.filter((x) => !same.some((o) => o !== x && o.dep >= x.dep && o.arr <= x.arr && (o.dep > x.dep || o.arr < x.arr)));
    const byNext = (a: OTrip, b: OTrip) => a.dep - b.dep || a.arr - b.arr;
    let cur = first;
    while (out.length < 3) {
      const prev = cur;
      const nx = choose(
        nextPool.filter((t) => t.dep > prev.dep),
        byNext,
        (t) => t.rides > 0 && t.dep > prev.dep && t.arr > prev.arr && t.dep <= limit && ok(t, 'next'),
      );
      if (!nx) break;
      // « Le suivant » une seule fois : les départs suivants qui complètent la liste sont « Plus tard »
      out.push(show(nx, prev === first ? 'next' : 'later'));
      cur = nx;
    }
    const cand = all.filter((t) => t.dep <= limit);
    const blocked = (y: OTrip) => cand.some((z) => z !== y && z.dep >= y.dep - 30 && z.arr < y.arr - 30);
    while (out.length < 3) {
      const seq = out.filter((s, i) => i === 0 || s.label === 'next' || s.label === 'later');
      const minDep = Math.max(...seq.map((s) => s.dep));
      const minArr = Math.max(...seq.map((s) => s.arr));
      const beyond = (t: OTrip) => t.dep > minDep && t.arr > minArr;
      const b = choose(cand.filter(beyond), byCost, (t) => t.rides > 0 && beyond(t) && t.dep <= limit && !blocked(t) && ok(t, 'later'));
      if (!b) break;
      out.push(show(b, 'later'));
    }
  }
  return out;
}

/* ---------- F0* : la règle 1.2.1 rejouée ---------- */

function rideStructure(l: OTrip['legs'][number]): string {
  const ends = `${l.from}>${l.to}`;
  if (l.op === 'sncb') return `sncb/${l.line ?? ''}:${ends}`;
  return `${l.op}/${l.line ?? ''}>${rtmerge.headKey(l.head ?? '')}:${ends}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toRankItem(t: OTrip, base0: number): any {
  const b = base0 / MIN;
  const rides = t.legs.filter((l) => l.kind === 'ride');
  const f = rides[0];
  return {
    t,
    dep: t.dep + b,
    arr: t.arr + b,
    rides: rides.length,
    transfers: t.transfers,
    walks: t.walks,
    walk: t.tw,
    firstRide: f ? `${f.op}/${f.tripId || `${f.line}>${f.head ?? ''}`}@${f.from}@${f.dep}` : '',
    structure: rides.map(rideStructure).join('|'),
    id: t.key,
    maxWait: t.maxWait,
  };
}

export function F0star(pool: OTrip[], c: Ctx, extra: OTrip[] = []): Shown[] {
  const items = [...pool, ...extra.filter((x) => !pool.some((p) => p.key === x.key))].map((t) => toRankItem(t, c.base0));
  const ranked = rankMod.rank(items, c.T + c.base0 / MIN, c.M, P.proposals);
  return ranked.map((r: any) => show(r.item.t, r.label));
}
