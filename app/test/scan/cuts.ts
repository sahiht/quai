/**
 * 1.3.0 (PRD-1.3.0 § 5) : rangées coupées au milieu d'un mot, comptées par les balayages des vraies données (et par les
 * tests de la mise en page). Indépendant de la façon de couper : chaque « … » collé à un texte, dans le journal de la
 * page (ce qui se lit à l'écran), est comparé aux textes entiers des éléments affichés. Le morceau qui le précède est le
 * début d'un de ces textes ; il finit au milieu d'un mot quand son dernier caractère et le suivant du texte entier sont
 * deux lettres ou deux chiffres. Une coupe après une espace, un trait d'union, une barre ou une apostrophe d'un nom
 * composé (« Wervicq/… », « Bruxelles-… ») est une coupe au mot. Un premier mot seul trop long, coupé au caractère faute
 * d'autre issue, est compté à part (`first`). Un « … » qui fait partie du texte (« bus 36 + IC + … », « … » d'un calcul)
 * n'est pas une coupe.
 */
import { truncate } from '../../src/glasses/font';
import { expandLines, layoutPage } from '../../src/glasses/layout';
import type { GlassesView, Item, PageSpec, Seg } from '../../src/glasses/types';

/** `word` : au mot ; `mid` : au milieu d'un mot ; `first` : un premier mot seul trop long ; `unknown` : texte entier introuvable. */
export type CutKind = 'word' | 'mid' | 'first' | 'unknown';

export interface Cut {
  /** Rang de la rangée dans le journal de la page. */
  row: number;
  /** Rangée telle qu'elle se lit (journal de la page). */
  line: string;
  /** Début visible du texte coupé, avant « … ». */
  shown: string;
  /** Texte entier coupé (vide : introuvable). */
  full: string;
  kind: CutKind;
}

const NBSP = /[  ]/g;
/** Comme l'affichage (caractères sûrs, espaces insécables de la typographie française), espaces insécables en espaces. */
const norm = (s: string): string => truncate(s, Number.MAX_SAFE_INTEGER).replace(NBSP, ' ');
export const isWordChar = (ch: string | undefined): boolean => !!ch && /[\p{L}\p{N}]/u.test(ch);
const COMPOUND = /[-/’']/;

/** Coupe d'un texte entier `full` dont `shown` est le début visible : au mot, au milieu d'un mot, ou d'un premier mot seul. */
export function cutKind(shown: string, full: string): Exclude<CutKind, 'unknown'> {
  const s = shown.replace(NBSP, ' ');
  const f = full.replace(NBSP, ' ');
  if (!(isWordChar(s.at(-1)) && isWordChar(f[s.length]))) return 'word';
  return / /.test(s.trim()) || COMPOUND.test(s) ? 'mid' : 'first';
}

const segsText = (segs: readonly Seg[] | undefined): string => (segs ?? []).map((g) => g.t).filter(Boolean).join(' ');

/** Textes entiers d'un élément : ses colonnes, ses mots (ensemble et un à un), ses lignes en retrait, son accordéon. */
export function itemTexts(it: Item): string[] {
  const out = [it.a, it.b, it.c, it.a2, it.b2, it.group, it.head, it.bRight, it.bTail, it.cTail, it.bLead && it.b ? `${it.bLead}${it.b}` : '', segsText(it.segs), ...(it.segs ?? []).map((g) => g.t)];
  for (const s of it.sub ?? []) out.push(s.b, s.bRight, segsText(s.segs), ...(s.segs ?? []).map((g) => g.t));
  out.push(...expandLines(it).map((e) => e.text));
  return out.filter((x): x is string => !!x && !!x.trim());
}

/** Un « … » collé à un texte (une coupe possible) ; seul ou après une espace (« + … », calcul en cours) : pas une coupe. */
const glued = (line: string): boolean => /\S…/.test(line.replace(NBSP, ' '));

/** Coupes de rangées dont les textes entiers sont `texts` ; `row0` : rang de la première dans le journal de la page. */
function lineCuts(lines: readonly string[], texts: readonly (string | undefined)[], row0: number): Cut[] {
  const cands = [...new Set(texts.filter((x): x is string => !!x && !!x.trim()).map(norm))];
  const out: Cut[] = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(NBSP, ' ');
    for (let k = line.indexOf('…'); k >= 0; k = line.indexOf('…', k + 1)) {
      const before = line.slice(0, k);
      if (!before.trim() || /\s$/.test(before)) continue;
      let found: Cut | null = null;
      for (let s = 0; s < before.length && !found; s++) {
        if (s > 0 && before[s - 1] !== ' ') continue;
        const shown = before.slice(s);
        if (!shown.trim()) break;
        const full = cands.find((f) => f.length > shown.length && f.startsWith(shown));
        if (full) found = { row: row0 + i, line: raw, shown, full, kind: cutKind(shown, full) };
      }
      out.push(found ?? { row: row0 + i, line: raw, shown: before, full: '', kind: 'unknown' });
    }
  });
  return out;
}

/**
 * Coupes des rangées d'une page. Chaque rangée n'est comparée qu'aux textes entiers de son élément : l'élément remis en
 * page seul (même gabarit, même curseur pour l'accordéon) donne exactement ses lignes, dans l'ordre de la page ; la ligne
 * du haut et le pied (note, ligne d'action, aides) aux textes de la vue. Deux noms voisins au même début
 * (« Meensel-Kiezegem Meensel Gemeentehuis », « Meensel-Kiezegem Meenselbaan ») ne se confondent pas.
 */
export function pageCuts(v: GlassesView, p: PageSpec): Cut[] {
  if (!p.lines.some(glued)) return [];
  const viewTexts = [v.top?.text, ...(v.top?.cols ?? []), v.note, v.notePlanned, v.hints, v.action];
  // écran de message (lignes recoupées à la largeur) ou du guidage : les textes de toute la vue
  if (v.layout === 'message' || v.layout === 'guide') return lineCuts(p.lines, [...viewTexts, ...v.items.flatMap(itemTexts)], 0);
  const out: Cut[] = [];
  let k = 0;
  if (v.top?.text) {
    out.push(...lineCuts(p.lines.slice(0, 1), viewTexts, 0));
    k = 1;
  }
  for (let i = p.top; i < p.top + p.visible; i++) {
    const it = v.items[i];
    const alone: GlassesView = { ...v, items: [it], top: undefined, note: undefined, notePlanned: undefined, reserveNote: false, hints: '', action: undefined, compactFoot: true, scroll: false, mark: undefined, paged: false, initialSel: undefined, initialTop: undefined, accordion: !!v.accordion && i === p.sel, log: undefined };
    const n = layoutPage(alone, { sel: 0, top: 0 }).lines.length;
    out.push(...lineCuts(p.lines.slice(k, k + n), itemTexts(it), k));
    k += n;
  }
  out.push(...lineCuts(p.lines.slice(k), viewTexts, k));
  return out;
}

/** Bilan des coupes de plusieurs pages : rangées coupées (« … »), au milieu d'un mot, premier mot seul, introuvables. */
export interface CutTally {
  cut: number;
  mid: number;
  first: number;
  unknown: number;
  samples: string[];
}

export const newTally = (): CutTally => ({ cut: 0, mid: 0, first: 0, unknown: 0, samples: [] });

/** Ajoute les coupes d'une page au bilan (une rangée compte une fois, à sa pire coupe). */
export function tally(t: CutTally, cuts: readonly Cut[], label = ''): void {
  const byRow = new Map<number, { line: string; kind: CutKind }>();
  const rank: Record<CutKind, number> = { word: 0, first: 1, unknown: 2, mid: 3 };
  for (const c of cuts) {
    const k = byRow.get(c.row);
    if (!k || rank[c.kind] > rank[k.kind]) byRow.set(c.row, { line: c.line, kind: c.kind });
  }
  for (const { line, kind } of byRow.values()) {
    t.cut++;
    if (kind === 'word') continue;
    t[kind]++;
    if (t.samples.length < 12) t.samples.push(`${kind === 'mid' ? 'au milieu d’un mot' : kind === 'first' ? 'premier mot seul' : 'introuvable'} : ${label ? `${label} : ` : ''}${line.replace(NBSP, ' ')}`);
  }
}
