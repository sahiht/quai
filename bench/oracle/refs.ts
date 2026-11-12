/**
 * Contrôle externe (PRD-1.2.2 § 7) : les propositions 1 de Quai face aux itinéraires de Transitous (MOTIS) et d'iRail
 * pour les 150 cas du banc (bench-references/references.json, format : bench/REFERENCES.md ; aucune requête ici).
 *
 * Un cas est signalé quand une source a un trajet qui arrive au moins 5 min avant la proposition 1 de Quai, sans plus
 * de changements et sans plus de marche (plus longue marche et marche totale ; Transitous part des coordonnées du
 * banc et y arrive : 2 min de tolérance sur la plus longue marche, 4 min sur la marche totale), hors services que les
 * données de Quai ne portent pas (FlixBus, Eurostar, ICE, European Sleeper, Eurocity Direct : opérateur, mode ou
 * ligne). Pour chaque cas, l'ensemble de Pareto de l'oracle (tout l'instantané de Quai) dit si un
 * trajet aussi bon existe dans les données de Quai (alors : manque du moteur) ou non (données, ou modèle de marche et
 * de correspondance différent).
 */
import { readFileSync } from 'node:fs';

export const REFS = process.env.QUAI_REFS ?? '/home/claude/bench-results/bench-references/references.json';
/** Tolérances de marche (min) : Transitous part des coordonnées et y arrive (1 à 2 min à chaque bout) ; iRail va de
 *  gare à gare. Plus longue marche, puis marche totale. */
const TOL_WALK: Record<string, [number, number]> = { transitous: [2, 4], irail: [0, 0] };
const GAIN = 5;

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

export interface RefLeg {
  mode: string;
  line?: string;
  operator?: string;
  from: { name: string };
  to: { name: string };
  dep: string;
  arr: string;
  walkMin?: number;
}
export interface RefIt {
  dep: string;
  arr: string;
  transfers: number;
  walkTotalMin: number;
  walkMaxMin: number;
  direct?: boolean;
  legs: RefLeg[];
}

/** Services absents des données de Quai (opérateur, mode ou ligne). */
export function foreign(it: RefIt): string | null {
  for (const l of it.legs) {
    if (l.mode === 'walk') continue;
    const op = l.operator ?? '';
    const line = l.line ?? '';
    if (/flixbus/i.test(op) || l.mode === 'coach') return 'FlixBus';
    if (/eurostar/i.test(op) || /eurostar/i.test(line) || line === 'EUR' || /->/.test(line)) return 'Eurostar';
    if (/european sleeper/i.test(op) || /^ES\b/.test(line)) return 'European Sleeper';
    if (/DB Fernverkehr/i.test(op) || line === 'ICE') return 'ICE';
    if (/NS International/i.test(op) || /eurocity direct/i.test(line) || line === 'ECD') return 'Eurocity Direct';
  }
  return null;
}

const hm = (iso: string) => iso.slice(11, 16);
/** Minutes depuis l'origine du jour de service du banc (base0, ms). */
const minOf = (iso: string, base0: number) => Math.round((Date.parse(iso) - base0) / 60_000);

export function refText(it: RefIt): string {
  const parts = it.legs.map((l) => (l.mode === 'walk' ? `à pied ${Math.round(l.walkMin ?? 0)}` : `${l.operator && !/SNCB/.test(l.operator) ? `${l.operator.replace('LETEC', 'TEC')} ` : ''}${l.line ?? l.mode} ${hm(l.dep)} ${l.from.name} → ${l.to.name} ${hm(l.arr)}`));
  return `${hm(it.dep)} → ${hm(it.arr)} : ${parts.join(' ; ')}`;
}

export interface RefFlag {
  id: string;
  M: number;
  source: string;
  ref: RefIt;
  refArr: number;
  /** Proposition 1 de Quai (format compact de run.ts). */
  p1: J;
  /** Le meilleur trajet de l'oracle aussi bon que la référence sur les changements et la marche, arrivé au moins 5 min
   *  avant la proposition 1 (s'il existe : manque du moteur). */
  oracleBetter: J | null;
  /** Le trajet de l'oracle de mêmes lignes que la référence, au même départ du premier véhicule (à 2 min près). */
  oracleSame: J | null;
  /** Une proposition de Quai (autre que la 1) arrive au plus 1 min après la référence. */
  shownNear: J | null;
}

export interface RefSummary {
  cases: number;
  compared: Record<string, number>;
  skippedForeign: Record<string, number>;
  flags: RefFlag[];
}

const lineKey = (op: string | undefined, line: string | undefined) => `${(op ?? '').toLowerCase()}/${(line ?? '').toUpperCase()}`;
/** Suite des lignes d'un itinéraire de référence (opérateurs ramenés à ceux de Quai). */
function refLines(it: RefIt): string {
  return it.legs
    .filter((l) => l.mode !== 'walk')
    .map((l) => {
      const op = /SNCB|NMBS/.test(l.operator ?? '') || (!l.operator && l.mode === 'train') ? 'sncb' : /TEC/i.test(l.operator ?? '') ? 'tec' : /STIB/i.test(l.operator ?? '') ? 'stib' : /lijn/i.test(l.operator ?? '') ? 'delijn' : (l.operator ?? '');
      return lineKey(op, l.line);
    })
    .join('|');
}
function quaiLines(t: J): string {
  return String(t.lines)
    .split(' + ')
    .map((x: string) => {
      const m = /^(STIB|TEC|De Lijn) (.+)$/.exec(x);
      if (!m) return lineKey('sncb', x);
      return lineKey(m[1] === 'De Lijn' ? 'delijn' : m[1].toLowerCase(), m[2]);
    })
    .join('|');
}

/** Cas signalés pour une marche maximale (M5, M10) : `cases` = internal.json de run.ts (cas du banc). */
export function compareRefs(cases: J[], walks: string[], base0Of: (c: J) => number): RefSummary {
  const ref = JSON.parse(readFileSync(REFS, 'utf8')) as { cases: { trip: string; moment: string; source: string; ok: boolean; itineraries: RefIt[] }[] };
  const out: RefSummary = { cases: 0, compared: {}, skippedForeign: {}, flags: [] };
  for (const c of cases) {
    if (c.owner) continue;
    out.cases++;
    const base0 = base0Of(c);
    for (const r of ref.cases.filter((x) => x.trip === c.trip && x.moment === c.moment && x.ok)) {
      out.compared[r.source] = (out.compared[r.source] ?? 0) + 1;
      const usable = r.itineraries.filter((it) => {
        const f = foreign(it);
        if (f) out.skippedForeign[f] = (out.skippedForeign[f] ?? 0) + 1;
        return !f && !it.direct;
      });
      for (const M of walks) {
        const p1 = c[M].rules.F0.p1;
        if (!p1) continue;
        const [tolMax, tolTotal] = TOL_WALK[r.source] ?? [0, 0];
        const better = usable
          .filter((it) => {
            const arr = minOf(it.arr, base0) - minOf(c.at, base0) + 0;
            return arr <= p1.arrMin - GAIN && it.transfers <= p1.tr && it.walkMaxMin <= p1.lw + tolMax && it.walkTotalMin <= p1.tw + tolTotal;
          })
          .sort((a, b) => Date.parse(a.arr) - Date.parse(b.arr))[0];
        if (!better) continue;
        const refArr = minOf(better.arr, base0) - minOf(c.at, base0);
        const oracle: J[] = c.oracle.trips;
        const oracleBetter =
          oracle
            .filter((t) => t.arrMin <= p1.arrMin - GAIN && t.tr <= p1.tr && t.lw <= p1.lw && t.tw <= p1.tw && t.depMin >= 0 && t.depMin <= 60)
            .sort((a, b) => a.arrMin - b.arrMin)[0] ?? null;
        const rl = refLines(better);
        const firstDep = better.legs.find((l) => l.mode !== 'walk')?.dep;
        const oracleSame =
          oracle.find((t) => {
            if (quaiLines(t) !== rl || !firstDep) return false;
            const first = String(t.legs).split(' ; ').find((x: string) => !x.startsWith('à pied'));
            const m = first ? /(\d\d:\d\d)/.exec(first) : null;
            return !!m && Math.abs(minOf(`${c.at.slice(0, 11)}${m[1]}:00${c.at.slice(19)}`, base0) - minOf(firstDep, base0)) <= 2;
          }) ?? null;
        const shownNear = (c[M].rules.F0.alts as J[]).find((a) => a.arrMin <= refArr + 1) ?? null;
        out.flags.push({ id: c.id, M: Number(M.slice(1)), source: r.source, ref: better, refArr, p1, oracleBetter, oracleSame, shownNear });
      }
    }
  }
  return out;
}
