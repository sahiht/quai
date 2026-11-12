/**
 * Rapport du banc interne de la 1.2.1 (celui qui a conduit à la règle de la 1.2.2), refait à partir des mesures de la
 * 1.2.1 : lit bench/out/internal-121.json et internal-holdout-121.json (run.ts --tag 121, QUAI_ROOT sur une copie de la
 * 1.2.1) et écrit bench/out/RAPPORT-1.2.1.md. Le rapport de la 1.2.2 : report.ts.
 *
 *   cd bench/oracle && QUAI_ROOT=/tmp/quai-121 npx tsx run.ts --tag 121 && QUAI_ROOT=/tmp/quai-121 npx tsx run.ts --holdout --tag 121
 *   npx tsx report-121.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNet } from './net';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const REPORT = join(OUT, 'RAPPORT-1.2.1.md');
const BEST = 'F4(3,0)';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;
const main: J = JSON.parse(readFileSync(`${OUT}/internal-121.json`, 'utf8'));
const hold: J = JSON.parse(readFileSync(`${OUT}/internal-holdout-121.json`, 'utf8'));
const ruleIds: string[] = main.rules.map((r: J) => r.id);
const ruleName = new Map<string, string>(main.rules.map((r: J) => [r.id, r.name]));
const WALKS = ['M5', 'M10'];

interface Agg {
  n: number;
  dominated: number;
  dominatedStrict: number;
  absurd: number;
  missed: number;
  labels: number;
  slower: number;
  extraMean: number;
  extraP90: number;
  extraMax: number;
  lw: number;
  tw: number;
  tr: number;
  owner?: string;
}

const pct = (k: number, n: number) => (n ? (100 * k) / n : 0);
function p90(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(0.9 * s.length) - 1] : NaN;
}

function aggregate(cases: J[], M: string, rid: string): Agg {
  const rows = cases.map((c) => c[M].rules[rid]).filter((r: J) => r?.p1);
  const n = rows.length;
  const ext = rows.map((r: J) => r.extra).filter((x: J) => x !== null);
  const cnt = (f: (r: J) => boolean) => rows.filter(f).length;
  return {
    n,
    dominated: pct(cnt((r) => r.check.dominated), n),
    dominatedStrict: pct(cnt((r) => r.check.dominatedStrict), n),
    absurd: pct(cnt((r) => r.check.absurdWalk), n),
    missed: pct(cnt((r) => r.check.missed), n),
    labels: pct(cnt((r) => r.check.labelIssues.length > 0), n),
    slower: pct(cnt((r) => r.slowerThanWalk), n),
    extraMean: ext.reduce((s: number, x: number) => s + x, 0) / Math.max(1, ext.length),
    extraP90: p90(ext),
    extraMax: Math.max(...ext),
    lw: rows.reduce((s: number, r: J) => s + r.lw, 0) / n,
    tw: rows.reduce((s: number, r: J) => s + r.tw, 0) / n,
    tr: rows.reduce((s: number, r: J) => s + r.tr, 0) / n,
  };
}

const bench = main.cases.filter((c: J) => !c.owner);
const owner = new Map<string, J>(main.cases.filter((c: J) => c.owner).map((c: J) => [c.owner, c]));
const summary: Record<string, Record<string, Agg>> = {};
const holdSummary: Record<string, Record<string, Agg>> = {};
for (const M of WALKS) {
  summary[M] = {};
  holdSummary[M] = {};
  for (const rid of ruleIds) {
    const a = aggregate(bench, M, rid);
    a.owner = ['A', 'B', 'C'].map((o) => (owner.get(o)?.[M].rules[rid].owner.ok ? 'oui' : 'non')).join(' ');
    summary[M][rid] = a;
    holdSummary[M][rid] = aggregate(hold.cases, M, rid);
  }
}
main.summary = { bench: summary, holdout: holdSummary, best: BEST };
hold.summary = { holdout: holdSummary };
writeFileSync(`${OUT}/summary-1.2.1.json`, JSON.stringify(main.summary));

/* ---------- markdown ---------- */
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '-');
const p = (x: number) => `${f1(x)} %`;
const walksTxt = (w: number[]) => (w.length ? w.join(' + ') : '0');
const tripTxt = (t: J) => {
  if (!t) return '-';
  if (t.lines === 'à pied') return `${t.dep} → ${t.arr}, à pied seulement (${t.walks[0]} min)`;
  return `${t.dep} → ${t.arr}, ${t.lines}, ${t.walks.length ? `à pied ${walksTxt(t.walks)}` : 'sans marche'}, ${t.tr} ch.`;
};
const caseName = (c: J) => `${c.id.split('@')[0]} ${c.from.name} → ${c.to.name}, ${momentTxt(c)}`;
const MOMENTS: Record<string, string> = {
  'ven-0730': 'ven. 07:30',
  'ven-1730': 'ven. 17:30',
  'sam-1100': 'sam. 11:00',
  'jeu-0815': 'jeu. 12/11 08:15',
  'fer-1500': 'mer. 11/11 (férié) 15:00',
  'mer-1942': 'mer. 11/11 (férié) 19:42',
  'jeu-0731': 'jeu. 12/11 07:31',
  'mer-1330': 'mer. 11/11 (férié) 13:30',
};
const momentTxt = (c: J) => MOMENTS[c.moment] ?? c.moment;

function ruleTable(S: Record<string, Agg>, ids: string[], withOwner = true): string {
  const head = `| Règle | P1 dominée | Marche absurde | Oubli | Étiquettes | Plus lent que la marche | Retard moyen | Retard p90 | Plus longue marche | Changements |${withOwner ? ' A B C |' : ''}`;
  const sep = `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|${withOwner ? '---|' : ''}`;
  const rows = ids
    .filter((id) => S[id])
    .map((id) => {
      const a = S[id];
      return `| ${id} | ${p(a.dominated)} | ${p(a.absurd)} | ${p(a.missed)} | ${p(a.labels)} | ${p(a.slower)} | ${f2(a.extraMean)} | ${a.extraP90} | ${f2(a.lw)} | ${f2(a.tr)} |${withOwner ? ` ${a.owner} |` : ''}`;
    });
  return [head, sep, ...rows].join('\n');
}

/* ---------- incohérences de la 1.2.1 ---------- */
const CAUSE: Record<string, string> = {
  egalite: 'égalité d’heure non départagée par la marche',
  lignes: 'ligne utile non chargée (lignes du milieu)',
  gardefou: 'filtre « jamais plus lent que la marche seule »',
  raccourci: 'raccourci « marche seule dès qu’elle tient dans la marche maximale »',
  deuxtemps: 'filtre « correspondance inutile » de rank.ts, puis classement en deux temps (6 trajets, puis 3)',
  apied: '« À pied » proposé alors que la proposition 1 arrive plus tôt en marchant moins',
  arbitrage: 'arbitrage de la 1.2.1 : trajet plus court, parti plus tard',
};
const CASE_CAUSE: Record<string, string> = {
  't15@sam-1100': 'egalite',
  't17@ven-1730': 'egalite',
  't36@ven-1730': 'egalite',
  't04@jeu-0815': 'egalite',
  't17@jeu-0815': 'egalite',
  't13@fer-1500': 'egalite',
  't13@sam-1100': 'lignes',
  't13@jeu-0815': 'lignes',
  't47@ven-1730': 'gardefou',
  't50@ven-0730': 'gardefou',
  't47@fer-1500': 'gardefou',
  't38@ven-0730': 'raccourci',
  't38@ven-1730': 'raccourci',
  't38@sam-1100': 'raccourci',
  't38@jeu-0815': 'raccourci',
  't38@fer-1500': 'raccourci',
  't06@ven-1730': 'deuxtemps',
  't45@sam-1100': 'apied',
  't47@ven-0730': 'apied',
  't47@sam-1100': 'apied',
  't45@jeu-0815': 'apied',
  't47@jeu-0815': 'apied',
  't04@ven-1730': 'arbitrage',
  't10@ven-1730': 'arbitrage',
  't18@ven-0730': 'arbitrage',
  't09@jeu-0815': 'arbitrage',
  't40@fer-1500': 'arbitrage',
};
const CAUSE_SHORT: Record<string, string> = {
  egalite: 'égalité non départagée',
  lignes: 'ligne non chargée',
  gardefou: 'filtre « jamais plus lent que la marche seule »',
  raccourci: 'raccourci « marche seule »',
  deuxtemps: 'filtres et classement en deux temps',
  apied: '« À pied » de trop',
  arbitrage: 'arbitrage',
};
const KIND: Record<string, string> = {
  'dominée (départ compris)': 'dominée',
  dominée: 'dominée',
  'marche absurde': 'marche absurde',
  'oubli (plus tôt, peu de marche)': 'oubli',
  'oubli (peu de marche, absent)': 'oubli',
};

interface Flag {
  c: J;
  Ms: string[];
  kinds: Set<string>;
  p1: J;
  other: J;
  cause: string;
}

function flagsOf(cases: J[]): Flag[] {
  const out = new Map<string, Flag>();
  for (const M of WALKS)
    for (const c of cases) {
      const r = c[M].rules.F0;
      const ch = r.check;
      if (!(ch.dominated || ch.absurdWalk || ch.missed || ch.labelIssues.length)) continue;
      const kinds = new Set<string>(ch.findings.map((f: J) => KIND[f.kind] ?? f.kind));
      if (ch.labelIssues.length) kinds.add('étiquette');
      const other = ch.findings.find((f: J) => f.other)?.other ?? (ch.labelIssues.length ? r.alts.find((a: J) => a.label === 'walk') : null);
      const sig = `${c.id}|${r.p1?.key}|${[...kinds].sort().join(',')}`;
      const cur = out.get(sig);
      if (cur) cur.Ms.push(M);
      else out.set(sig, { c, Ms: [M], kinds, p1: r.p1, other, cause: CASE_CAUSE[c.id] ?? 'à analyser' });
    }
  return [...out.values()];
}

const order = ['egalite', 'lignes', 'gardefou', 'raccourci', 'deuxtemps', 'apied', 'arbitrage', 'à analyser'];
function flagTable(fl: Flag[]): string {
  const rows = [...fl]
    .sort((a, b) => order.indexOf(a.cause) - order.indexOf(b.cause) || (a.c.id < b.c.id ? -1 : 1))
    .map(
      (f) =>
        `| ${caseName(f.c)} | ${f.Ms.map((m) => m.slice(1)).join(' et ')} | ${[...f.kinds].join(', ')} | ${tripTxt(f.p1)} | ${tripTxt(f.other)} | ${CAUSE[f.cause] ?? f.cause} |`,
    );
  return ['| Cas | Marche max. | Contrôle | Proposition 1 de la 1.2.1 | Trajet en cause (oracle ou autre proposition) | Cause |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

const flagsBench = flagsOf(bench);
const flagsHold = flagsOf(hold.cases);
const realBench = (M: string) => new Set(flagsBench.filter((f) => f.Ms.includes(M) && f.cause !== 'arbitrage').map((f) => f.c.id)).size;
const allBench = (M: string) => new Set(flagsBench.filter((f) => f.Ms.includes(M)).map((f) => f.c.id)).size;
const realHold = (M: string) => new Set(flagsHold.filter((f) => f.Ms.includes(M) && f.cause !== 'arbitrage').map((f) => f.c.id)).size;

/* ---------- désaccords 1.2.1 / meilleure règle ---------- */
function disagreements(cases: J[], M: string, rid: string): { rows: string[]; equivalent: number } {
  const rows: string[] = [];
  let equivalent = 0;
  for (const c of cases) {
    const a = c[M].rules.F0.p1;
    const b = c[M].rules[rid].p1;
    if (!a || !b || a.key === b.key) continue;
    if (a.arr === b.arr && a.lw === b.lw && a.tr === b.tr && a.dep === b.dep) {
      equivalent++;
      continue;
    }
    const d = (x: number) => (x > 0 ? `+${x}` : `${x}`);
    rows.push(`| ${caseName(c)} | ${tripTxt(a)} | ${tripTxt(b)} | ${d(b.arrMin - a.arrMin)} | ${d(b.lw - a.lw)} | ${d(b.tr - a.tr)} |`);
  }
  return { rows, equivalent };
}

/* ---------- textes ---------- */
const S5 = summary.M5;
const S10 = summary.M10;
const H5 = holdSummary.M5;
const H10 = holdSummary.M10;
const net13 = loadNet(main.snapshots.bench).stats;
const v = main.validation;
const hv = hold.validation;
const st = main.cases.map((c: J) => c.oracle.stats);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const n = (x: number) => x.toLocaleString('fr-BE').replace(/\u202f|\u00a0/g, ' ');

const ownerRows = ['A', 'B', 'C']
  .map((o) => {
    const c = owner.get(o)!;
    const r0 = c.M5.rules.F0;
    const rb = c.M5.rules[BEST];
    const alts = (r: J) => r.alts.map((a: J) => `${a.label === 'earlier' ? 'Plus tôt' : a.label === 'none' ? 'Sans changement' : a.label === 'fewer' ? 'Moins de changements' : a.label === 'later' ? 'Plus tard' : a.label === 'next' ? 'Le suivant' : a.label === 'lesswalk' ? 'Moins de marche' : a.label} ${a.dep} → ${a.arr} (${a.lines}, à pied ${walksTxt(a.walks)})`).join(' ; ');
    return `| ${o} : ${c.from.name} → ${c.to.name}, ${momentTxt(c)} | ${tripTxt(r0.p1)}${r0.alts.length ? `<br>autres : ${alts(r0)}` : ''} | ${r0.owner.ok ? 'oui' : 'non'} | ${tripTxt(rb.p1)}${rb.alts.length ? `<br>autres : ${alts(rb)}` : ''} | ${rb.owner.ok ? 'oui' : 'non'} |`;
  })
  .join('\n');

const ownerOthers = ['F1(2,5,0)', 'F2(15)', 'F2(20)', 'F3(20)']
  .map((rid) => `${rid} : ${['A', 'B', 'C'].map((o) => `${o} ${owner.get(o)!.M5.rules[rid].owner.ok ? 'oui' : 'non'}`).join(', ')}`)
  .join(' ; ');

const MAIN_IDS = ['F0', 'F0*', 'F0*g', 'F1(1.5,3,0)', 'F1(2,5,0)', 'F1(2,5,0.5)', 'F2(10)', 'F2(15)', 'F2(20)', 'F3(15)', 'F3(20)', 'F3(30)', 'F4(2,0)', 'F4(3,0)', 'F4(3,1)', 'F4(3,3)', 'F4(4,3)', 'F4(3,0)g', 'F4(3,0)/moteur', 'F1(2,5,0)/moteur', 'F3(20)/moteur'];
const HOLD_IDS = ['F0', 'F0*', 'F1(2,5,0)', 'F2(15)', 'F3(20)', 'F4(2,0)', 'F4(3,0)', 'F4(3,1)', 'F4(3,3)', 'F4(3,0)/moteur'];
const dis5 = disagreements(bench, 'M5', BEST);
const dis10 = disagreements(bench, 'M10', BEST);
const B5 = S5[BEST];
const B10 = S10[BEST];

const md = `# Banc interne de cohérence : Quai 1.2.1 et règles de classement candidates

Banc interne, ${new Date(main.generatedAt).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })}. Code mesuré : Quai 1.2.1 (copie intacte du commit c50fd22, \`app/src\`), moteur réel \`computeRoute\`, sans temps réel. Données publiées : instantané du 13/11 (vendredi 13/11, samedi 14/11) pour les 150 cas du banc (\`bench/trips.json\`), instantané du 11/11 (mercredi 11/11 férié, jeudi 12/11) pour les cas A, B, C du propriétaire et pour un contrôle hors échantillon (les 50 trajets le jeudi 12/11 à 08:15 et le 11/11 à 15:00, 100 cas). Marche maximale 5 min (réglage du propriétaire) et 10 min. Aucune adresse personnelle, aucun service Google.

## En bref

- **1.2.1 telle que livrée** : sur les 150 cas, ${allBench('M5')} cas signalés à 5 min de marche maximale (${allBench('M10')} à 10 min), dont ${realBench('M5')} vraies incohérences (${realBench('M10')} à 10 min) ; les autres sont des arbitrages voulus (trajet plus court parti plus tard). Hors échantillon : ${realHold('M5')} et ${realHold('M10')} sur 100. Les cas A, B, C sortent comme le propriétaire l’attend.
- **Les incohérences viennent surtout du moteur, pas des paliers** : la règle 1.2.1 rejouée sur l’ensemble complet des trajets (F0*) n’a plus aucune proposition 1 strictement dominée ni marche absurde ; restent des bus plus lents que la marche seule (${p(S5['F0*'].slower)} à 5 min) et un oubli dû à ses propres filtres (t06). Les causes : égalités d’heure non départagées par la marche, lignes non chargées, filtre « jamais plus lent que la marche seule », raccourci « marche seule », classement en deux temps, « À pied » de trop.
- **Règle recommandée : F4, λ = 3, p = 0** : la proposition 1 est le trajet qui minimise *arrivée + 3 × (plus longue marche au-delà de la marche maximale)*. Zéro proposition 1 dominée, zéro marche absurde, zéro oubli, zéro étiquette fausse, sur le banc et hors échantillon, aux deux réglages ; A, B, C conformes ; retard moyen sur l’arrivée la plus tôt ${f2(B5.extraMean)} min à 5 min (1.2.1 : ${f2(S5.F0.extraMean)}), ${f2(B10.extraMean)} à 10 min (1.2.1 : ${f2(S10.F0.extraMean)}) ; plus longue marche et changements au niveau de la 1.2.1. Les deux propriétés tiennent par construction (voir § 5).
- **Il faut aussi corriger le moteur** : avec les seuls candidats du moteur actuel, toute règle garde 3 à 5 % de propositions 1 dominées ou absurdes (lignes « /moteur »).

## 1. L’oracle

\`bench/oracle/\` : recherche multicritère exhaustive (McRAPTOR par plage de départs) sur **tout** l’instantané (${n(net13.lineFiles)} fichiers de ligne, ${n(net13.urbanTrips)} voyages urbains et ${n(net13.trainTrips)} trains sur les deux jours, ${n(net13.stops)} zones, ${n(net13.footPairs)} marches de correspondance), sans le choix des lignes ni le calcul par rondes ni le classement du moteur. Critères : départ (le plus tard), arrivée, plus longue marche, marche totale, changements ; ensemble de Pareto exact. Départs dans [T, T + 60 min], arrivées jusqu’à T + 3 h. Modèle de Quai repris tel quel : minutes de marche = ⌈distance × 1,3 / 80⌉ (au moins 1), correspondance à pied jusqu’à 400 m (+ 1 min vers un arrêt, + 3 min vers une gare), même zone 2 min (gare 4 min), zone de l’extrémité ou 25 m : 0 min ; extrémités jusqu’à 25 min de marche vers tout arrêt (le moteur : 15 min vers un arrêt urbain) ; 3 véhicules, une correspondance urbaine-urbaine au plus, attente de 60 min au plus ; marche seule en plus. Seuls le modèle de marche (\`util.ts\`) et les constantes (\`params.ts\`) de Quai sont réutilisés.

Validation : sur les ${v.cases} calculs du banc (153 cas × 2 réglages), l’arrivée la plus tôt de l’oracle égale ou bat celle du moteur dans ${v.earliestOk} calculs sur ${v.cases} (strictement meilleure ${v.earliestBetter} fois, 2 cas aux deux réglages : t13 samedi, lignes non chargées par le moteur ; t09 samedi, 17 min à pied d’un arrêt urbain, hors du rayon de 15 min du moteur). L’oracle couvre ${n(v.covered)} des ${n(v.engineCands)} candidats du moteur partis dans l’heure (au moins aussi bon sur tous les critères) ; les ${v.engineCands - v.covered} autres arrivent après T + 3 h. Hors échantillon : ${hv.earliestOk} sur ${hv.cases} et ${n(hv.covered)} sur ${n(hv.engineCands)}. La règle 1.2.1 rejouée sur les candidats du moteur redonne sa proposition 1 dans 305 calculs sur 306 (la seule différence est le défaut de classement en deux temps, t06). Temps : ${Math.round(mean(st.map((s: J) => s.ms)))} ms par cas en moyenne (au plus ${Math.max(...st.map((s: J) => s.ms))} ms), ${Math.round(mean(st.map((s: J) => s.pareto)))} trajets de Pareto en moyenne ; banc complet en ${main.seconds} s.

## 2. Incohérences de la 1.2.1

Contrôles : (a) proposition 1 dominée : un trajet de l’oracle arrive au plus tard à la même heure, avec une plus longue marche et des changements au plus égaux, et fait mieux d’au moins 2 min ou d’un changement (le départ n’y compte pas) ; (b) marche absurde : plus de M + 5 min à pied alors qu’un trajet sans marche de plus de M arrive au plus 15 min après ; (c) oubli : un trajet sans marche de plus de M arrive au moins 5 min avant toutes les propositions, ou, dans le cas (b), arrive au plus 10 min après sans être proposé ; (d) étiquettes : « Plus tôt » arrive plus tôt, « Moins de marche » marche moins, etc., pas de doublon, aucune proposition partie plus tôt et arrivée plus tard qu’une autre sans moins de marche ni de changements.

| 1.2.1 (moteur) | P1 dominée | dont même départ ou plus tard | Marche absurde | Oubli | Étiquettes |
|---|---:|---:|---:|---:|---:|
| Banc, marche 5 | ${p(S5.F0.dominated)} | ${p(S5.F0.dominatedStrict)} | ${p(S5.F0.absurd)} | ${p(S5.F0.missed)} | ${p(S5.F0.labels)} |
| Banc, marche 10 | ${p(S10.F0.dominated)} | ${p(S10.F0.dominatedStrict)} | ${p(S10.F0.absurd)} | ${p(S10.F0.missed)} | ${p(S10.F0.labels)} |
| Hors échantillon, marche 5 | ${p(H5.F0.dominated)} | ${p(H5.F0.dominatedStrict)} | ${p(H5.F0.absurd)} | ${p(H5.F0.missed)} | ${p(H5.F0.labels)} |
| Hors échantillon, marche 10 | ${p(H10.F0.dominated)} | ${p(H10.F0.dominatedStrict)} | ${p(H10.F0.absurd)} | ${p(H10.F0.missed)} | ${p(H10.F0.labels)} |

Cas du banc (150) :

${flagTable(flagsBench)}

Hors échantillon, mêmes causes : ${flagsHold
  .filter((f) => f.cause !== 'arbitrage')
  .map((f) => `${f.c.id.split('@')[0]} ${momentTxt(f.c)}, marche ${f.Ms.map((m) => m.slice(1)).join(' et ')} : ${CAUSE_SHORT[f.cause] ?? f.cause}`)
  .join(' ; ')}.

Causes, en clair :

1. **Égalités d’heure non départagées par la marche** (\`raptor.ts\`) : à heure égale, le calcul par rondes garde le premier trajet trouvé, souvent celui qui marche le plus. t17 : le bus 39 va jusqu’à la gare de Braine-l’Alleud (1 min à pied), le moteur fait descendre à Vallée Bailly (4 min), même départ et même arrivée ; t15 : descendre du bus 38 à Science et marcher 5 min jusqu’à Trône au lieu de rester dans le bus ; t36 : le trajet à un changement (tram 92, bus R27) arrivé à la même heure n’est jamais gardé, même avec toutes les lignes chargées.
2. **Lignes non chargées** (\`select.ts\`, lignes du milieu) : t13 samedi, métro 5 puis 6 jusqu’à Bruxelles-Midi et le bus SNCB de 11:26 : arrivée 12:01, 29 min avant la proposition 1 ; le moteur le trouve dès que toutes les lignes sont chargées. Même chose hors échantillon (métro 5 puis 2, 12 min plus tôt).
3. **Filtre « jamais plus lent que la marche seule »** (\`engine.ts\`, \`usable\`) : t47 vendredi soir, 19 min à pied alors que les trams 4 puis 7 (3 min à pied) arrivent 3 min après ; t50, 14 min à pied contre le bus 43 (4 + 4 min) 4 min après ; hors échantillon t47 le 11/11, 19 min à pied contre le tram 7 une minute après. Tous les trajets en véhicule sont retirés avant le classement.
4. **Raccourci « marche seule »** (\`engine.ts\`) : avec 10 min de marche maximale, t38 De Brouckère → Gare Centrale propose 10 min à pied alors que le métro arrive 7 à 8 min plus tôt sans marche.
5. **Filtres de \`rank.ts\` et classement en deux temps** (\`engine.ts\`) : t06 vendredi 17:30, marche 10. Le filtre « correspondance qui fait gagner moins de 5 min sur le même premier véhicule » retire le S1 + métro 6 + bus 38 (18:18, 3 + 1 min à pied) au profit du S1 + métro 6 + 10 min à pied (18:22), qui n’est lui-même jamais proposé ; puis le moteur, qui classe tout, garde 6 trajets et reclasse ces 6, fait passer en tête le S9 direct (18:27), écarté au premier tour par un trajet arrivé 5 min plus tôt qui ne fait pas partie des 6. Le trajet de 18:18 n’est plus proposé du tout.
6. **« À pied » de trop** (\`rank.ts\`) : « À pied, 18 min » (t45) ou « 19 min » (t47) proposé alors que la proposition 1 arrive plus tôt et marche moins.
7. **Arbitrages, pas des erreurs** : t04, t10, t18 (et t09, t40 hors échantillon) : un trajet arrive à la même heure (t09 : 4 min plus tôt) avec moins de marche ou un changement de moins, mais part 1 à 12 min plus tôt ; la 1.2.1 préfère le trajet le plus court. Le contrôle (a) les compte parce que le départ n’y entre pas.

## 3. Cas du propriétaire (instantané du 11/11, marche maximale 5)

| Cas | 1.2.1 : proposition 1 | Conforme | ${BEST} : proposition 1 | Conforme |
|---|---|---|---|---|
${ownerRows}

Attentes : A, le bus d’abord (pas 22 min à pied jusqu’à la gare) ; B, bus 36, IC 08:01, métro 2 ; C, bus W puis métro 2, jamais le bus 36 vers Rixensart. Autres règles (marche 5) : ${ownerOthers}. F2 échoue en A et en C : aucun trajet n’y a toutes ses marches de 5 min au plus (le bus W demande 8 min à pied), F2 retombe donc sur l’arrivée la plus tôt, 22 min à pied.

## 4. Règles candidates

Toutes les règles reclassent le même ensemble : ensemble de Pareto de l’oracle ∪ candidats du moteur, départ dans l’heure, attente de 60 min au plus, marche seule de 30 min au plus ; sans le filtre « jamais plus lent que la marche seule » (suffixe g : avec ce filtre ; suffixe /moteur : candidats du moteur seuls, c’est-à-dire un remplacement de \`rank.ts\` sans toucher à la recherche). Chacune donne la proposition 1 et au plus deux autres : « Plus tôt » (l’arrivée la plus tôt, si elle arrive au moins 5 min avant) et « Moins de marche » (seulement si la proposition 1 marche plus que la marche maximale : la plus courte plus longue marche parmi les trajets arrivés au plus 20 min après).

- **F0** : la 1.2.1 telle que livrée (moteur). **F0*** : la règle 1.2.1 (\`rank()\`) rejouée sur l’ensemble complet.
- **F1(w, p, a)** : arrivée + w × marche totale + p × changements + a × attentes entre véhicules.
- **F2(X)** : l’arrivée la plus tôt, sauf si un trajet dont chaque marche dure au plus la marche maximale arrive au plus X min après (alors celui-là, puis le moins de changements).
- **F3(X)** (proposée ici) : F2 par paliers de 5 min (ceux de la 1.2.1) : le palier le plus bas qui a un trajet arrivé au plus X min après l’arrivée la plus tôt, puis l’arrivée la plus tôt dans ce palier.
- **F4(λ, p)** (proposée ici) : arrivée + λ × (plus longue marche − marche maximale, si positive) + p × changements ; à égalité, le moins de changements, la plus courte plus longue marche, la marche totale la plus courte, le départ le plus tard.

Colonnes : parts des 150 cas ; « Plus lent que la marche » : proposition 1 en véhicule qui arrive plus de 5 min après la marche seule (marche seule de 30 min au plus) ; retards en minutes sur l’arrivée la plus tôt de l’ensemble ; marches en minutes ; A B C : conforme aux attentes, marche 5 (resp. 10).

### Banc, marche maximale 5 min

${ruleTable(S5, MAIN_IDS)}

### Banc, marche maximale 10 min

${ruleTable(S10, MAIN_IDS)}

### Hors échantillon (100 cas, instantané du 11/11)

Marche 5 :

${ruleTable(H5, HOLD_IDS, false)}

Marche 10 :

${ruleTable(H10, HOLD_IDS, false)}

Lecture :

- **F1** : les meilleurs réglages (w 1,5 ou 2, p 3 ou 5, sans poids d’attente) sont propres et conformes en A, B, C, mais ignorent la marche maximale réglée, arrivent plus tard (environ 1,1 min en moyenne) et proposent des bus plus lents que la marche seule (${p(S5['F1(2,5,0)'].slower)}) ; avec un poids d’attente de 0,5, des propositions 1 dominées apparaissent.
- **F2** : simple et propre, mais échoue en A et en C à 5 min (voir § 3).
- **F3** : propre et conforme à X ≥ 15, mais pousse des bus plus lents que la marche seule (${p(S5['F3(20)'].slower)} à 5 min, par exemple Mons gare → Grand-Place : bus sans marche arrivé 11 min après la marche seule de 11 min).
- **F4** : λ = 3 et p = 0 ou 1 sont propres partout (banc et hors échantillon, 5 et 10 min). λ = 2 laisse passer des marches absurdes hors échantillon à 10 min (${p(H10['F4(2,0)'].absurd)}), λ = 4 allonge les détours (retard moyen ${f2(S5['F4(4,3)'].extraMean)} min à 5 min) ; p = 3 reste propre sur nos cas mais sans garantie, p = 5 fait réapparaître des marches absurdes quand une longue marche évite deux changements (hors échantillon, F4(3,5) à 10 min : ${p(H10['F4(3,5)'].absurd)}, 16 min à pied jusqu’au S1 direct plutôt que bus, IC et métro).
- **Candidats du moteur seuls** : même la meilleure règle garde ${p(S5['F4(3,0)/moteur'].dominated)} de propositions 1 dominées et ${p(S5['F4(3,0)/moteur'].absurd)} de marches absurdes à 5 min : ce sont les causes 1 à 4 du § 2, qui sont dans la recherche.

## 5. Recommandation

**Passer à F4 avec λ = 3 et p = 0, et corriger le moteur.**

Règle (remplace les paliers, « le plus rapide à 5 min près », le garde-fou de 30 min et les filtres de dominance de \`rank.ts\`) :

1. Candidats : départ dans l’heure demandée (la nuit, la fenêtre actuelle), attente de 60 min au plus, 3 véhicules et une correspondance urbaine-urbaine au plus, marche seule de 30 min au plus.
2. Coût = heure d’arrivée + 3 × max(0, plus longue marche − marche maximale réglée), en minutes.
3. Proposition 1 : le coût le plus bas ; à égalité, le moins de changements, puis la plus courte plus longue marche, puis la marche totale la plus courte, puis le départ le plus tard.
4. « Plus tôt » : l’arrivée la plus tôt, si elle arrive au moins 5 min avant la proposition 1. « Moins de marche » : seulement si la proposition 1 marche plus que la marche maximale ; la plus courte plus longue marche parmi les trajets arrivés au plus 20 min après. Puis « Le suivant » et « Plus tard » comme aujourd’hui pour compléter.

Pourquoi : une seule formule, la marche maximale reste une préférence (gratuite jusqu’à elle, chaque minute au-delà compte comme 3 min de retard), et deux garanties par construction, vraies parmi les candidats quels qu’ils soient : la proposition 1 n’est jamais dominée par un autre candidat (un trajet qui fait mieux ne coûte jamais plus, et les égalités vont à celui qui fait mieux) ; jamais de marche absurde au sens du banc (6 min au-delà de la marche maximale coûtent 18 min, plus que les 15 min tolérées). La garantie demande 6λ > 15 + 2p ; parmi les réglages qui la remplissent, λ = 3, p = 0 arrive le plus tôt (λ = 4 allonge les détours). p = 1 donne presque les mêmes résultats ; p = 3 reste propre sur nos cas, sans garantie.

Corrections du moteur, nécessaires quelle que soit la règle :

1. \`raptor.ts\` : à heure égale (arrêt, correspondance, sortie, montée du premier véhicule), garder le trajet qui marche le moins ; mieux, deux critères (arrivée, plus longue marche) sur le petit réseau (l’oracle, à cinq critères sur tout le réseau, prend ici ${Math.round(mean(st.map((s: J) => s.ms)))} ms en moyenne). Corrige t15, t17, t36 et le trajet à 6 min de marche inutiles de t18.
2. \`select.ts\` : toujours charger les lignes de métro STIB (1, 2, 5, 6) quand une extrémité est à Bruxelles, ou plus de lignes du milieu. Corrige t13.
3. \`engine.ts\` : supprimer le filtre « jamais plus lent que la marche seule » et le raccourci « marche seule si elle tient dans la marche maximale » ; la marche seule concourt avec sa propre marche (corrige t47, t50, t38). Garder « Tu es déjà … » à 300 m.
4. \`engine.ts\` : un seul classement sur tous les candidats (le temps réel remplace les heures, il ne réduit pas l’ensemble) ; avec F4, le filtre « correspondance inutile » disparaît. Corrige t06.
5. « À pied » : n’apparaît plus qu’en « Plus tôt » (corrige t45, t47).

Effet attendu sur le banc (F4(3,0) sur l’ensemble complet ; les corrections 1 à 4 rapprochent de cet ensemble les candidats du moteur) : aucune proposition 1 dominée, absurde, oubliée ni mal étiquetée ; retard moyen ${f2(B5.extraMean)} min (p90 ${B5.extraP90}) à 5 min et ${f2(B10.extraMean)} min (p90 ${B10.extraP90}) à 10 min, contre ${f2(S5.F0.extraMean)} et ${f2(S10.F0.extraMean)} pour la 1.2.1 ; plus longue marche ${f2(B5.lw)} et ${f2(B10.lw)} min (1.2.1 : ${f2(S5.F0.lw)} et ${f2(S10.F0.lw)}) ; changements ${f2(B5.tr)} et ${f2(B10.tr)} (1.2.1 : ${f2(S5.F0.tr)} et ${f2(S10.F0.tr)}). L’oracle reste utilisable comme contrôle de non-régression (\`bench/oracle\`, 30 s pour le banc).

## Annexe A. Désaccords entre la 1.2.1 et ${BEST} (proposition 1)

Marche 5 : ${dis5.rows.length} désaccords (et ${dis5.equivalent} ${dis5.equivalent > 1 ? 'trajets différents mais équivalents' : 'trajet différent mais équivalent'} : mêmes heures, même plus longue marche, mêmes changements).

| Cas | 1.2.1 | ${BEST} | Δ arrivée | Δ plus longue marche | Δ changements |
|---|---|---|---:|---:|---:|
${dis5.rows.join('\n')}

Marche 10 : ${dis10.rows.length} désaccords (et ${dis10.equivalent} ${dis10.equivalent > 1 ? 'équivalents' : 'équivalent'}).

| Cas | 1.2.1 | ${BEST} | Δ arrivée | Δ plus longue marche | Δ changements |
|---|---|---|---:|---:|---:|
${dis10.rows.join('\n')}

## Annexe B. Grille complète (banc)

Marche 5 :

${ruleTable(S5, ruleIds)}

Marche 10 :

${ruleTable(S10, ruleIds)}

Données : \`bench/out/internal.json\` (banc et cas A, B, C : ensemble de Pareto de l’oracle, propositions et candidats du moteur, propositions et contrôles de chaque règle, synthèse), \`bench/out/internal-holdout.json\` (contrôle hors échantillon). Rejouer : \`cd bench/oracle && QUAI_ROOT=/tmp/quai-121 tsx run.ts && tsx run.ts --holdout && tsx report.ts\` (QUAI_ROOT : copie de \`git archive c50fd22 app/src shared\`, avec un package.json de type module).
`;

if (md.includes(String.fromCharCode(0x2014))) throw new Error('tiret long dans le rapport');
mkdirSync(OUT, { recursive: true });
writeFileSync(REPORT, md);
console.log(`rapport : ${REPORT} (${md.split('\n').length} lignes) ; synthèse : ${OUT}/summary-1.2.1.json`);
for (const r of [BEST, 'F0', 'F0*']) console.log(r, ruleName.get(r), JSON.stringify(summary.M5[r]));
