/**
 * Rapport du banc interne pour la 1.2.2 : lit bench/out/internal.json et internal-holdout.json (run.ts sur ce dépôt),
 * et, s'ils existent, internal-121.json et internal-holdout-121.json (run.ts --tag 121 sur une copie de la 1.2.1) pour
 * la comparaison ; contrôle externe avec les références Transitous et iRail (refs.ts). Écrit bench/out/RAPPORT-1.2.2.md
 * et bench/out/summary-1.2.2.json. N'écrit rien hors de bench/out.
 *
 *   cd bench/oracle && QUAI_ROOT=/home/claude/quai-122 npx tsx run.ts && npx tsx run.ts --holdout && npx tsx report.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNet } from './net';
import { compareRefs, foreign, refText, REFS, type RefFlag } from './refs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const REPORT = join(OUT, 'RAPPORT-1.2.2.md');
const WALKS = ['M5', 'M10'];

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;
const read = (f: string): J | null => (existsSync(join(OUT, f)) ? JSON.parse(readFileSync(join(OUT, f), 'utf8')) : null);
const main: J = read('internal.json');
const hold: J = read('internal-holdout.json');
const main121: J = read('internal-121.json');
const hold121: J = read('internal-holdout-121.json');
if (!main || !hold) throw new Error('lancer run.ts puis run.ts --holdout d’abord');

interface Agg {
  n: number;
  dominated: number;
  /** Une proposition au moins (la première comprise) dominée par un trajet de l'oracle ou la marche seule, départ
   *  compris (garde 1.2.2, PRD-1.2.2 § 7.4). */
  beaten: number;
  absurd: number;
  missed: number;
  labels: number;
  slower: number;
  extraMean: number;
  extraP90: number;
  lw: number;
  tr: number;
}
const pct = (k: number, n: number) => (n ? (100 * k) / n : 0);
const p90 = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.ceil(0.9 * s.length) - 1] : NaN;
};
function aggregate(cases: J[], M: string, rid: string): Agg {
  const rows = cases.filter((c) => !c.owner).map((c) => c[M].rules[rid]).filter((r: J) => r?.p1);
  const n = rows.length;
  const ext = rows.map((r: J) => r.extra).filter((x: J) => x !== null);
  const cnt = (f: (r: J) => boolean) => rows.filter(f).length;
  return {
    n,
    dominated: pct(cnt((r) => r.check.dominated), n),
    beaten: pct(cnt((r) => (r.beaten?.length ?? 0) > 0), n),
    absurd: pct(cnt((r) => r.check.absurdWalk), n),
    missed: pct(cnt((r) => r.check.missed), n),
    labels: pct(cnt((r) => r.check.labelIssues.length > 0), n),
    slower: pct(cnt((r) => r.slowerThanWalk), n),
    extraMean: ext.reduce((s: number, x: number) => s + x, 0) / Math.max(1, ext.length),
    extraP90: p90(ext),
    lw: rows.reduce((s: number, r: J) => s + r.lw, 0) / n,
    tr: rows.reduce((s: number, r: J) => s + r.tr, 0) / n,
  };
}

const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '-');
const p = (x: number) => `${f1(x)} %`;
const walksTxt = (w: number[]) => (w.length ? w.join(' + ') : '0');
const LABEL: Record<string, string> = { short: 'Proposition 1', earlier: 'Plus tôt', lesswalk: 'Moins de marche', none: 'Sans changement', fewer: 'Moins de changements', next: 'Le suivant', later: 'Plus tard', walk: 'À pied' };
const tripTxt = (t: J) => {
  if (!t) return '-';
  if (t.lines === 'à pied') return `${t.dep} → ${t.arr}, à pied seulement (${t.walks[0]} min)`;
  return `${t.dep} → ${t.arr}, ${t.lines}, ${t.walks.length ? `à pied ${walksTxt(t.walks)}` : 'sans marche'}, ${t.tr} ch.`;
};
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
const caseName = (c: J) => `${c.id.split('@')[0]} ${c.from.name} → ${c.to.name}, ${MOMENTS[c.moment] ?? c.moment}`;

/* ---------- tableaux ---------- */
const HEAD = '| Version | P1 dominée | Marche absurde | Oubli | Étiquettes | Une proposition dominée | Plus lent que la marche | Retard moyen | Retard p90 | Plus longue marche | Changements |';
const SEP = '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
const row = (name: string, a: Agg) => `| ${name} | ${p(a.dominated)} | ${p(a.absurd)} | ${p(a.missed)} | ${p(a.labels)} | ${p(a.beaten)} | ${p(a.slower)} | ${f2(a.extraMean)} | ${a.extraP90} | ${f2(a.lw)} | ${f2(a.tr)} |`;
const summary: Record<string, Record<string, Record<string, Agg>>> = {};
function table(label: string, cur: J, before: J | null): string {
  const lines: string[] = [];
  for (const M of WALKS) {
    const rows = [HEAD, SEP];
    if (before) rows.push(row('1.2.1 (moteur livré)', aggregate(before.cases, M, 'F0')));
    const now = aggregate(cur.cases, M, 'F0');
    const rule = aggregate(cur.cases, M, 'F5');
    rows.push(row('1.2.2 (moteur)', now), row('règle 1.2.2 sur l’ensemble complet (F5)', rule));
    (summary[label] ??= {})[M] = { '1.2.2': now, F5: rule, ...(before ? { '1.2.1': aggregate(before.cases, M, 'F0') } : {}) };
    lines.push(`Marche maximale ${M.slice(1)} min (${now.n} cas) :`, '', ...rows, '');
  }
  return lines.join('\n');
}

/* ---------- propositions du moteur dominées par un trajet de l'oracle (garde 1.2.2) ---------- */
/** Explications vérifiées à la main (lignes chargées par le moteur, `select.ts`). */
const BEATEN_WHY: Record<string, string> = {
  't09@ven-0730': 'le bus 95 (Trône → Luxembourg) n’est pas parmi les 61 lignes que le moteur charge pour ce trajet (il prend le bus 64) : le moteur ne voit pas ce trajet, sa garde ne peut pas le remplacer',
};
const beatenList = [
  ['banc', main],
  ['hors échantillon', hold],
].flatMap(([name, d]) =>
  (d as J).cases.flatMap((c: J) =>
    WALKS.flatMap((M) =>
      (c[M].rules.F0.beaten ?? []).map(
        (b: J) => `- ${caseName(c)}, marche ${M.slice(1)} (${name}) : ${LABEL[b.shown.label] ?? b.shown.label} ${tripTxt(b.shown)} ; l’oracle : ${tripTxt(b.by)}${BEATEN_WHY[c.id] ? ` ; ${BEATEN_WHY[c.id]}` : ''}.`,
      ),
    ),
  ),
);

/* ---------- cas du propriétaire ---------- */
const owner = new Map<string, J>(main.cases.filter((c: J) => c.owner).map((c: J) => [c.owner, c]));
const ownerRows = ['A', 'B', 'C']
  .flatMap((o) => {
    const c = owner.get(o);
    if (!c) return [];
    return WALKS.map((M) => {
      const r = c[M].rules.F0;
      const alts = r.alts.map((a: J) => `${LABEL[a.label] ?? a.label} ${a.dep} → ${a.arr} (${a.lines}, à pied ${walksTxt(a.walks)})`).join(' ; ');
      return `| ${o} : ${c.from.name} → ${c.to.name}, ${MOMENTS[c.moment] ?? c.moment}, marche ${M.slice(1)} | ${tripTxt(r.p1)}${alts ? `<br>autres : ${alts}` : ''} | ${r.owner?.ok ? 'oui' : 'non'} |`;
    });
  })
  .join('\n');

/* ---------- cohérence : moteur, rank.ts rejoué, règle écrite à part ---------- */
function agreement(cases: J[], M: string) {
  let n = 0;
  let p1 = 0;
  let equiv = 0;
  let star = 0;
  let shown = 0;
  const diffs: string[] = [];
  for (const c of cases) {
    const R = c[M].rules;
    const a = R.F0.p1;
    const b = R.F5.p1;
    if (!a || !b) continue;
    n++;
    if (a.key === b.key) p1++;
    else if (a.arr === b.arr && a.lw === b.lw && a.tr === b.tr && a.dep === b.dep) equiv++;
    else diffs.push(`${caseName(c)}, marche ${M.slice(1)} : moteur ${tripTxt(a)} ; règle ${tripTxt(b)}`);
    if (R['F0*'].p1?.key === b.key || (R['F0*'].p1 && R['F0*'].p1.arr === b.arr && R['F0*'].p1.lw === b.lw && R['F0*'].p1.tr === b.tr && R['F0*'].p1.tw === b.tw)) star++;
    const la = [R.F0.p1, ...R.F0.alts].map((x: J) => `${x.label}:${x.arr}:${x.lw}:${x.tr}`).join('|');
    const lb = [R.F5.p1, ...R.F5.alts].map((x: J) => `${x.label}:${x.arr}:${x.lw}:${x.tr}`).join('|');
    if (la === lb) shown++;
  }
  return { n, p1, equiv, star, shown, diffs };
}
const agreeRows: string[] = [];
const agreeDiffs: string[] = [];
for (const [name, d] of [['banc', main], ['hors échantillon', hold]] as const)
  for (const M of WALKS) {
    const a = agreement(d.cases, M);
    agreeRows.push(`| ${name}, marche ${M.slice(1)} | ${a.n} | ${a.p1 + a.equiv}${a.equiv ? ` (dont ${a.equiv} ${a.equiv > 1 ? 'équivalents' : 'équivalent'})` : ''} | ${a.star} | ${a.shown} |`);
    agreeDiffs.push(...a.diffs);
  }

/* ---------- temps ---------- */
function timing(d: J, M: string) {
  const ms = d.cases.map((c: J) => c[M].engine.ms as number).sort((a: number, b: number) => a - b);
  return { mean: ms.reduce((s: number, x: number) => s + x, 0) / ms.length, p50: ms[Math.floor(ms.length / 2)], p90: p90(ms), max: ms[ms.length - 1] };
}
const timeRows: string[] = [];
for (const [name, cur, before] of [['banc (153 calculs)', main, main121], ['hors échantillon (100)', hold, hold121]] as const)
  for (const M of WALKS) {
    const t = timing(cur, M);
    const b = before ? timing(before, M) : null;
    timeRows.push(`| ${name}, marche ${M.slice(1)} | ${b ? `${Math.round(b.mean)} / ${b.p50} / ${b.p90} / ${b.max}` : '-'} | ${Math.round(t.mean)} / ${t.p50} / ${t.p90} / ${t.max} |`);
  }

/* ---------- références externes ---------- */
/** Explications des écarts avec les références (cas, source), vérifiées à la main sur l'oracle et les données. */
const EXPLAIN: Record<string, string> = {
  't43@ven-1730|transitous':
    'les mêmes véhicules sont dans les données de Quai (bus 11 de 17:31, tram 4 de 17:37 à Brugsepoort), mais Quai compte une correspondance à pied comme sa marche plus 1 min pour trouver l’arrêt (17:35 + 2 + 1 = 17:38) : le tram de 17:37 est manqué ; écart de modèle, acceptable (avec 10 min de marche maximale, Quai propose le tram 1 et 7 min à pied, 17:32 → 17:55)',
  't36@ven-1730|transitous':
    'trois lignes urbaines, donc deux correspondances entre lignes urbaines, et Quai n’en permet qu’une (règle du produit) ; acceptable (1.2.2 : un seul changement, tram 92 puis bus R27 avec 5 min de marche maximale, tram 4 puis métro 6 et 10 min à pied avec 10 min)',
  't13@sam-1100|transitous': 'corrigé par la 1.2.2 (lignes de métro chargées) : métro 5 puis 6 jusqu’à Bruxelles-Midi et le même bus SNCB de 11:26, arrivée 12:01',
  't04@ven-0730|transitous':
    'plus de marche (12 min jusqu’à la gare) : Quai propose un trajet de ce genre en « Plus tôt » (P et P, 13 min à pied, arrivée 08:31) et en proposition 1 avec 10 min de marche maximale ; acceptable',
  't41@sam-1100|transitous':
    'plus de marche (8 min jusqu’à Merode) : Quai propose ce trajet en « Plus tôt » (11:00 → 11:24) et en proposition 1 avec 10 min de marche maximale ; acceptable',
};
const base0 = new Map<string, number>();
const base0Of = (c: J) => {
  let b = base0.get(c.snap);
  if (b === undefined) base0.set(c.snap, (b = loadNet(c.snap).base0));
  return b;
};
const refsOk = existsSync(REFS);
const refs = refsOk ? compareRefs(main.cases, WALKS, base0Of) : null;
const refs121 = refsOk && main121 ? compareRefs(main121.cases, WALKS, base0Of) : null;
const flagTxt = (f: RefFlag) =>
  `- ${caseName(main.cases.find((c: J) => c.id === f.id))}, marche ${f.M}, ${f.source} : ${refText(f.ref)} (${f.ref.transfers} ch., marche ${f.ref.walkMaxMin} min au plus, ${f.ref.walkTotalMin} en tout) ; Quai : ${tripTxt(f.p1)} ; oracle (tout l’instantané, modèle de marche de Quai) : ${f.oracleBetter ? `un trajet aussi bon, ${tripTxt(f.oracleBetter)}` : f.oracleSame ? `les mêmes véhicules, ${tripTxt(f.oracleSame)}` : 'aucun trajet aussi bon'}${EXPLAIN[`${f.id}|${f.source}`] ? ` ; ${EXPLAIN[`${f.id}|${f.source}`]}` : ''}.`;
/** Trajets de référence arrivés au moins 5 min avant la proposition 1, signalés ou non (plus de marche ou de changements). */
function nearMisses(): string[] {
  if (!refsOk) return [];
  const ref = JSON.parse(readFileSync(REFS, 'utf8'));
  const out: string[] = [];
  for (const c of main.cases) {
    if (c.owner) continue;
    for (const M of WALKS) {
      const p1 = c[M].rules.F0.p1;
      for (const r of ref.cases.filter((x: J) => x.trip === c.trip && x.moment === c.moment && x.ok)) {
        const b0 = base0Of(c);
        const min = (iso: string) => Math.round((Date.parse(iso) - b0) / 60_000);
        const best = r.itineraries
          .filter((it: J) => !foreign(it) && !it.direct)
          .filter((it: J) => min(it.arr) - min(c.at) <= p1.arrMin - 5)
          .sort((a: J, b: J) => Date.parse(a.arr) - Date.parse(b.arr))[0];
        if (best) out.push(`${c.id}|${M}|${r.source}|${refText(best)}|${best.transfers}|${best.walkMaxMin}|${best.walkTotalMin}|${tripTxt(p1)}`);
      }
    }
  }
  return out;
}
const near = nearMisses();

/* ---------- désaccords 1.2.1 / 1.2.2 (proposition 1) ---------- */
function changed(cur: J, before: J | null, M: string): number {
  if (!before) return 0;
  const by = new Map<string, J>(before.cases.map((c: J) => [c.id, c]));
  return cur.cases.filter((c: J) => {
    const a = by.get(c.id)?.[M].rules.F0.p1;
    const b = c[M].rules.F0.p1;
    return a && b && !(a.arr === b.arr && a.lw === b.lw && a.tr === b.tr && a.dep === b.dep);
  }).length;
}

const benchTable = table('banc', main, main121);
const holdTable = table('hors échantillon', hold, hold121);
const S5 = summary.banc?.M5;
/** Fin de phrase : pas de second point après « ch. ». */
const dot = (s: string) => (s.endsWith('.') ? s : `${s}.`);
const md = `# Banc interne : Quai 1.2.2 (règle F4, corrections du moteur)

Banc interne, ${new Date(main.generatedAt).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })}. Code mesuré : la 1.2.2 de ce dépôt (moteur réel \`computeRoute\`, sans temps réel), comparée à la 1.2.1 (copie du commit c50fd22, \`app/src\` et \`shared\`), sur la même machine, l’une après l’autre. Mêmes données et mêmes contrôles que le rapport interne de la 1.2.1 : 150 cas du banc (instantané du 13/11), cas A, B, C et 100 cas hors échantillon (instantané du 11/11), marche maximale 5 et 10 min ; oracle exhaustif (\`bench/oracle\`), indépendant du moteur. Aucune adresse personnelle, aucun service Google.

## En bref

- 1.2.2 (moteur) : ${p(S5?.['1.2.2'].dominated ?? NaN)} de propositions 1 dominées, ${p(S5?.['1.2.2'].absurd ?? NaN)} de marches absurdes, ${p(S5?.['1.2.2'].missed ?? NaN)} d’oublis, ${p(S5?.['1.2.2'].labels ?? NaN)} d’étiquettes fausses sur le banc à 5 min (tableaux du § 1 pour 10 min et hors échantillon) ; cas A, B, C conformes.
- Garde de la 1.2.2 (aucune proposition dominée, même par un trajet non affiché) : ${p(S5?.['1.2.2'].beaten ?? NaN)} des cas du banc à 5 min ont une proposition dominée par un trajet de l’oracle ou la marche seule (1.2.1 : ${p(S5?.['1.2.1']?.beaten ?? NaN)}).
- Retard moyen sur l’arrivée la plus tôt : ${f2(S5?.['1.2.2'].extraMean ?? NaN)} min à 5 min (1.2.1 : ${f2(S5?.['1.2.1']?.extraMean ?? NaN)}), ${f2(summary.banc?.M10?.['1.2.2'].extraMean ?? NaN)} min à 10 min (1.2.1 : ${f2(summary.banc?.M10?.['1.2.1']?.extraMean ?? NaN)}).
- Le moteur donne la proposition 1 de la règle écrite à part (F5, sur tout l’ensemble de l’oracle) dans presque tous les cas (§ 3) : les corrections du moteur lui font trouver les trajets dont la règle a besoin.
- Temps de calcul (§ 4) : ${Math.round(timing(main, 'M5').mean)} ms en moyenne par recherche (1.2.1 : ${main121 ? Math.round(timing(main121, 'M5').mean) : '-'} ms).
- Références externes (§ 5) : ${refs ? refs.flags.length : '-'} cas où Transitous ou iRail arrive au moins 5 min plus tôt sans plus de marche ni de changements (1.2.1 : ${refs121 ? refs121.flags.length : '-'}).

## 1. Contrôles

Validation de l’oracle : son arrivée la plus tôt égale ou bat celle du moteur dans ${main.validation.earliestOk} calculs du banc sur ${main.validation.cases} (strictement meilleure ${main.validation.earliestBetter} fois) et ${hold.validation.earliestOk} sur ${hold.validation.cases} hors échantillon${hold.validation.earliestWorse.length ? ` (les autres : un trajet en véhicule du moteur que la marche seule domine, absent de l’ensemble de Pareto de l’oracle, jamais proposé)` : ''} ; il couvre ${main.validation.covered} des ${main.validation.engineCands} candidats du moteur partis dans l’heure (${hold.validation.covered} sur ${hold.validation.engineCands} hors échantillon ; les autres arrivent après T + 3 h).

Contrôles du rapport 1.2.1 : (a) proposition 1 dominée par un trajet de l’oracle (arrivée, plus longue marche, changements ; 1 min de tolérance) ; (b) marche absurde (plus de M + 5 min à pied alors qu’un trajet sans marche de plus de M arrive au plus 15 min après) ; (c) oubli ; (d) étiquettes. Contrôle ajouté pour la garde de la 1.2.2 : une proposition au moins, la première comprise, dominée par un trajet de l’oracle ou par la marche seule (départ plus tard ou égal, arrivée, plus longue marche et changements pas pires, l’un meilleur d’au moins 2 min ou d’un changement ; trajets de l’oracle partis dans l’heure). Retards en minutes sur l’arrivée la plus tôt de l’ensemble ; marches en minutes.

### Banc (150 cas, instantané du 13/11)

${benchTable}
### Hors échantillon (100 cas, instantané du 11/11)

${holdTable}
${beatenList.length ? `Propositions du moteur 1.2.2 dominées par un trajet de l’oracle (garde de la 1.2.2) :\n\n${beatenList.join('\n')}\n\n` : 'Aucune proposition du moteur 1.2.2 dominée par un trajet de l’oracle.\n\n'}Propositions 1 changées par rapport à la 1.2.1 : banc ${changed(main, main121, 'M5')} (marche 5) et ${changed(main, main121, 'M10')} (marche 10) sur 153 ; hors échantillon ${changed(hold, hold121, 'M5')} et ${changed(hold, hold121, 'M10')} sur 100.

## 2. Cas du propriétaire (instantané du 11/11)

| Cas | 1.2.2 : propositions | Conforme |
|---|---|---|
${ownerRows}

Attentes : A, le bus W et le S1 d’abord, la marche de 22 min et l’IC seulement en « Plus tôt » ; B, bus 36, IC 08:01, métro 2 ; C, bus W puis métro 2, jamais le bus 36 vers Rixensart.

## 3. Moteur et règle

F5 : la règle 1.2.2 écrite dans \`bench/oracle/rules.ts\`, sans le code du moteur, sur l’ensemble complet (oracle et candidats du moteur) ; F0* : \`rank.ts\` sur ce même ensemble.

| Calculs | Nombre | P1 du moteur = P1 de F5 | P1 de rank.ts = P1 de F5 | Propositions du moteur = celles de F5 |
|---|---:|---:|---:|---:|
${agreeRows.join('\n')}

${agreeDiffs.length ? `Propositions 1 différentes (même coût, départage par la marche : le moteur n’a pas chargé la ligne qui marche une minute de moins) :\n\n${agreeDiffs.map((x) => `- ${x}`).join('\n')}\n` : 'Aucune proposition 1 différente.\n'}
## 4. Temps de calcul

Temps par recherche (ms : moyenne / médiane / p90 / maximum), fichiers lus sur disque et gardés en mémoire d’une recherche à l’autre, comme dans l’application.

| Calculs | 1.2.1 | 1.2.2 |
|---|---|---|
${timeRows.join('\n')}

## 5. Références externes (Transitous, iRail)

${
  refs
    ? `${refs.cases} cas du banc ; ${refs.compared.transitous ?? 0} réponses de Transitous, ${refs.compared.irail ?? 0} d’iRail ; itinéraires écartés (services absents des données de Quai) : ${Object.entries(refs.skippedForeign).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucun'}. Un cas est signalé quand une source arrive au moins 5 min avant la proposition 1 de Quai sans plus de changements ni plus de marche (plus longue marche et marche totale ; Transitous part des coordonnées et arrive aux coordonnées : 2 min de tolérance sur la plus longue marche, 4 min sur la marche totale).

Cas signalés, 1.2.2 : ${refs.flags.length}${refs.flags.length ? ` :\n\n${refs.flags.map(flagTxt).join('\n')}` : '.'}

Cas signalés, 1.2.1 : ${refs121 ? refs121.flags.length : '-'}${refs121?.flags.length ? ` :\n\n${refs121.flags.map(flagTxt).join('\n')}` : '.'}

Trajets de référence arrivés au moins 5 min avant la proposition 1 de la 1.2.2 (non signalés : plus de marche ou de changements) :

${near.map((x) => {
  const [id, M, src, ref, tr, wmax, , quai] = x.split('|');
  return `- ${caseName(main.cases.find((c: J) => c.id === id))}, marche ${M.slice(1)}, ${src} : ${ref} (${tr} ch., plus longue marche ${wmax} min) ; Quai : ${dot(quai)}${EXPLAIN[`${id}|${src}`] ? ` ${dot(EXPLAIN[`${id}|${src}`].replace(/^./, (x) => x.toUpperCase()))}` : ''}`;
}).join('\n') || '- aucun'}
`
    : 'Fichier des références absent.'
}
Données : \`bench/out/internal.json\`, \`internal-holdout.json\` (1.2.2), \`internal-121.json\`, \`internal-holdout-121.json\` (1.2.1). Rejouer : \`cd bench/oracle && QUAI_ROOT=<dépôt> npx tsx run.ts && npx tsx run.ts --holdout && npx tsx report.ts\` ; la 1.2.1 : \`QUAI_ROOT=<copie 1.2.1> npx tsx run.ts --tag 121\` (et \`--holdout --tag 121\`).
`;

if (md.includes(String.fromCharCode(0x2014))) throw new Error('tiret long dans le rapport');
mkdirSync(OUT, { recursive: true });
writeFileSync(REPORT, md);
writeFileSync(join(OUT, 'summary-1.2.2.json'), JSON.stringify({ summary, refs: refs && { flags: refs.flags.length, compared: refs.compared, skipped: refs.skippedForeign }, near }, null, 1));
console.log(`rapport : ${REPORT} (${md.split('\n').length} lignes)`);
for (const [k, v] of Object.entries(summary)) for (const [M, x] of Object.entries(v)) console.log(k, M, JSON.stringify(x));
