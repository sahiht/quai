/**
 * Contrôles de cohérence d'une liste de propositions (proposition 1 en tête) contre l'ensemble de Pareto de l'oracle.
 * M : marche maximale réglée. Heures en minutes. Tolérance de 1 min : « strictement meilleur » = au moins 2 min.
 */
import type { OTrip } from './search';

export interface Shown extends OTrip {
  label: string;
  reason?: string;
}

export interface Finding {
  kind: string;
  detail: string;
  /** Trajet de l'oracle en cause (le meilleur exemple). */
  other?: OTrip;
}

export interface CheckResult {
  dominated: boolean;
  /** Dominée en comptant aussi le départ (le trajet de l'oracle part au plus tôt à la même heure). */
  dominatedStrict: boolean;
  /** Dominée aussi sur la marche totale. */
  dominatedTotalWalk: boolean;
  absurdWalk: boolean;
  missed: boolean;
  missedEarlier: boolean;
  missedLowWalk: boolean;
  labelIssues: string[];
  findings: Finding[];
}

const TOL = 1;

/** x fait strictement mieux que p (arrivée, plus longue marche, changements), à 1 min près. */
export function dominatesP1(x: OTrip, p: OTrip): boolean {
  return x.arr <= p.arr && x.lw <= p.lw && x.transfers <= p.transfers && (x.arr < p.arr - TOL || x.lw < p.lw - TOL || x.transfers < p.transfers);
}

/** x domine la proposition s (garde 1.2.2 sur chaque proposition, PRD-1.2.2 § 7.4) : départ plus tard ou égal, arrivée,
 *  plus longue marche et changements pas pires, l'un meilleur (départ, arrivée ou marche d'au moins 2 min, ou un
 *  changement de moins). */
export function dominatesShown(x: OTrip, s: OTrip): boolean {
  return x.dep >= s.dep && x.arr <= s.arr && x.lw <= s.lw && x.transfers <= s.transfers && (x.dep > s.dep + TOL || x.arr < s.arr - TOL || x.lw < s.lw - TOL || x.transfers < s.transfers);
}

const best = (list: OTrip[], cmp: (a: OTrip, b: OTrip) => number) => [...list].sort(cmp)[0];
const byArr = (a: OTrip, b: OTrip) => a.arr - b.arr || a.lw - b.lw || a.transfers - b.transfers || b.dep - a.dep;

export function check(shown: Shown[], oracle: OTrip[], M: number): CheckResult {
  const res: CheckResult = {
    dominated: false,
    dominatedStrict: false,
    dominatedTotalWalk: false,
    absurdWalk: false,
    missed: false,
    missedEarlier: false,
    missedLowWalk: false,
    labelIssues: [],
    findings: [],
  };
  const p = shown[0];
  if (!p) {
    const any = oracle.filter((x) => x.rides > 0);
    if (any.length) {
      res.missed = true;
      res.findings.push({ kind: 'aucune proposition', detail: `l'oracle trouve ${any.length} trajets`, other: best(any, byArr) });
    }
    return res;
  }
  // (a) dominée
  const doms = oracle.filter((x) => dominatesP1(x, p));
  if (doms.length) {
    res.dominated = true;
    const x = best(doms, (a, b) => b.dep - a.dep || byArr(a, b));
    const strict = doms.filter((y) => y.dep >= p.dep);
    res.dominatedStrict = strict.length > 0;
    res.dominatedTotalWalk = doms.some((y) => y.tw <= p.tw);
    const ex = strict.length ? best(strict, byArr) : x;
    res.findings.push({ kind: res.dominatedStrict ? 'dominée (départ compris)' : 'dominée', detail: `arrivée ${p.arr - ex.arr >= 0 ? '-' : '+'}${Math.abs(p.arr - ex.arr)} min, plus longue marche ${ex.lw} contre ${p.lw}, changements ${ex.transfers} contre ${p.transfers}, départ ${ex.dep - p.dep >= 0 ? '+' : ''}${ex.dep - p.dep} min`, other: ex });
  }
  const low = oracle.filter((x) => x.rides > 0 && x.lw <= M);
  // (b) marche absurde
  if (p.lw > M + 5) {
    const alt = low.filter((x) => x.arr <= p.arr + 15);
    if (alt.length) {
      res.absurdWalk = true;
      const x = best(alt, byArr);
      res.findings.push({ kind: 'marche absurde', detail: `proposition 1 : ${p.lw} min à pied ; sans marche de plus de ${M} min : arrivée ${x.arr - p.arr >= 0 ? '+' : ''}${x.arr - p.arr} min`, other: x });
    }
  }
  // (c) oublis
  const minArr = Math.min(...shown.map((s) => s.arr));
  const earlier = low.filter((x) => x.arr <= minArr - 5);
  if (earlier.length) {
    res.missed = res.missedEarlier = true;
    const x = best(earlier, byArr);
    res.findings.push({ kind: 'oubli (plus tôt, peu de marche)', detail: `arrivée ${minArr - x.arr} min avant toutes les propositions, plus longue marche ${x.lw}`, other: x });
  }
  if (p.lw > M + 5) {
    const near = low.filter((x) => x.arr <= p.arr + 10 && !shown.some((s) => s.lw <= M && s.arr <= x.arr + TOL));
    if (near.length) {
      res.missed = res.missedLowWalk = true;
      const x = best(near, byArr);
      res.findings.push({ kind: 'oubli (peu de marche, absent)', detail: `proposition 1 : ${p.lw} min à pied ; absent : ${x.lw} min au plus, arrivée ${x.arr - p.arr >= 0 ? '+' : ''}${x.arr - p.arr} min`, other: x });
    }
  }
  // (d) étiquettes
  const issues = res.labelIssues;
  shown.forEach((s, i) => {
    if (i === 0) return;
    const L = s.label;
    if (L === 'earlier' && !(s.arr < p.arr)) issues.push(`« Plus tôt » n'arrive pas plus tôt (${s.arr - p.arr} min)`);
    if (L === 'lesswalk' && !(s.lw < p.lw)) issues.push(`« Moins de marche » ne marche pas moins (${s.lw} contre ${p.lw})`);
    if (L === 'fewer' && !(s.transfers < p.transfers)) issues.push(`« Moins de changements » : ${s.transfers} contre ${p.transfers}`);
    if (L === 'none' && s.transfers !== 0) issues.push(`« Sans changement » avec ${s.transfers} changement(s)`);
    if (L === 'later' && !(s.dep > p.dep)) issues.push(`« Plus tard » ne part pas plus tard (${s.dep - p.dep} min)`);
    if (L === 'next' && !(s.dep > p.dep)) issues.push(`« Le suivant » ne part pas plus tard (${s.dep - p.dep} min)`);
    if (L === 'walk' && s.rides !== 0) issues.push('« À pied » avec un véhicule');
  });
  if (p.reason?.startsWith('Moins de marche')) {
    const e = shown.find((s) => s.label === 'earlier');
    if (!e || !(e.lw > p.lw)) issues.push('proposition 1 nommée « Moins de marche » sans « Plus tôt » qui marche plus');
  }
  for (let i = 0; i < shown.length; i++)
    for (let j = 0; j < shown.length; j++) {
      if (i === j) continue;
      const x = shown[i];
      const y = shown[j];
      if (j > i && x.key === y.key) issues.push(`doublon : propositions ${i + 1} et ${j + 1}`);
      if (x.dep <= y.dep && x.arr >= y.arr && (x.dep < y.dep || x.arr > y.arr) && x.lw >= y.lw && x.tw >= y.tw && x.transfers >= y.transfers)
        issues.push(`proposition ${i + 1} part plus tôt et arrive plus tard que la ${j + 1}, sans moins de marche ni de changements`);
    }
  return res;
}
