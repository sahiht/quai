/**
 * Texte des adresses : contrôle du texte tapé, normalisation pour la comparaison, casse des libellés.
 * Aucune de ces fonctions ne journalise quoi que ce soit (le texte tapé ne va jamais au journal).
 */
import { GEO_LIMITS } from '../config.js';

export const BAD_Q = 'Paramètre q manquant ou trop court : 3 caractères au moins.';
export const LONG_Q = `Paramètre q trop long : ${GEO_LIMITS.maxChars} caractères au plus.`;
export const CTRL_Q = 'Paramètre q invalide : caractère de contrôle interdit.';
export const BAD_LANG = 'Paramètre lang invalide : fr ou nl.';

export type Lang = 'fr' | 'nl';

/** Contrôle de q (PRD M4, design-routing.md § 6.4 point 1) : espaces resserrés, 3 à 100 caractères, pas de contrôle. */
export function cleanQuery(raw: string | null): { q: string } | { error: string } {
  const s = raw ?? '';
  if (/[\u0000-\u001f\u007f-\u009f]/.test(s)) return { error: CTRL_Q };
  const q = s.replace(/\s+/gu, ' ').trim();
  const n = [...q].length;
  if (n < GEO_LIMITS.minChars) return { error: BAD_Q };
  if (n > GEO_LIMITS.maxChars) return { error: LONG_Q };
  return { q };
}

export function cleanLang(raw: string | null): Lang | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '') return 'fr';
  return s === 'fr' || s === 'nl' ? s : null;
}

/** Minuscules sans accents, ponctuation en espaces : « Chaussée d’Ixelles » → « chaussee d ixelles ». */
export function normalizeText(s: string): string {
  return (s ?? '')
    .replace(/ß/g, 'ss').replace(/[Ææ]/g, 'ae').replace(/[Œœ]/g, 'oe')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Abréviations courantes ramenées au mot entier ; Saint, Sainte, Sint, St, Ste : un seul jeton « st ». */
const SYNONYMS: Readonly<Record<string, string>> = {
  av: 'avenue', ave: 'avenue', avn: 'avenue',
  bd: 'boulevard', boul: 'boulevard', bld: 'boulevard', blvd: 'boulevard',
  ch: 'chaussee', chee: 'chaussee', chs: 'chaussee', chau: 'chaussee',
  pl: 'place', sq: 'square', r: 'rue', rte: 'route', imp: 'impasse',
  str: 'straat', stwg: 'steenweg', stw: 'steenweg', ln: 'laan', pln: 'plein',
  saint: 'st', sainte: 'st', sint: 'st', ste: 'st', sankt: 'st',
};

/** Petits mots (articles, prépositions) : moitié de poids dans la couverture, ignorés dans la précision. */
export const PARTICLES: ReadonlySet<string> = new Set([
  'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'a', 'au', 'aux', 'en', 'et', 'sur', 'sous', 'lez',
  'van', 'der', 'den', 'het', 't', 'ter', 'ten', 'te', 'op', 'aan', 'bij', 'in',
  'am', 'an', 'von', 'zu', 'zum', 'zur', 'im', 'die', 'das',
]);

/** Jetons comparables d'un texte (normalisé, abréviations développées). */
export function tokens(s: string): string[] {
  const n = normalizeText(s);
  if (!n) return [];
  return n.split(' ').map((t) => SYNONYMS[t] ?? t);
}

/** Numéro de maison ou code postal : chiffres, éventuellement suivis de lettres (25, 25a, 12bis). */
export const isNumberToken = (t: string) => /^\d+[a-z]{0,3}$/.test(t);

/** Numéro de maison comparable : minuscules, sans espaces ni ponctuation (« 25 A » → « 25a »). */
export const normNumber = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* ------------------------------ Casse des libellés ------------------------------ */

/** Mots laissés en minuscules dans un nom (sauf en tête). */
const LOWER_WORDS: ReadonlySet<string> = new Set([
  'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'à', 'au', 'aux', 'en', 'et', 'sur', 'sous', 'lez', 'lès', 'lèz',
  'van', 'der', 'den', 'het', 't', 'ter', 'ten', 'te', 'op', 'aan', 'bij', 'in', 'onder', 'over', 'uit', 'voor',
  'am', 'an', 'von', 'zu', 'zum', 'zur', 'im', 'die', 'das', 'und',
]);

const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3})$/;

function hasLetters(s: string): boolean {
  return /\p{L}/u.test(s);
}

/**
 * Casse corrigée : un nom tout en capitales ou tout en minuscules devient « Rue de l’Église », « Chapelle-lez-Herlaimont ».
 * Un nom déjà en casse mixte est gardé tel quel (graphie officielle), avec sa première lettre en capitale.
 */
export function properCase(s: string): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t || !hasLetters(t)) return t;
  const upper = t === t.toUpperCase();
  const lower = t === t.toLowerCase();
  if (!upper && !lower) return t.charAt(0).toUpperCase() + t.slice(1);
  const low = t.toLowerCase();
  let index = 0;
  return low.replace(/[\p{L}\p{N}]+/gu, (w, offset: number) => {
    const first = index++ === 0;
    const before = low.charAt(offset - 1);
    const afterApostrophe = before === '\'' || before === '’';
    const elided = (w === 'l' || w === 'd') && /['’]/.test(low.charAt(offset + 1));
    if (ROMAN.test(w) && !first) return w.toUpperCase();
    if (!first && !afterApostrophe && (LOWER_WORDS.has(w) || elided)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}

/**
 * Nom de commune propre : sans le préfixe en capitales (« NAMUR Jambes » → « Jambes »), casse corrigée,
 * sans soulignés ni espaces parasites en fin.
 */
export function cleanMunicipality(s: string | undefined): string | undefined {
  let t = (s ?? '').replace(/[_\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  const m = /^((?:[\p{Lu}'’-]{2,}\s+)+)(?=\p{Lu}\p{Ll})/u.exec(t);
  if (m && t.slice(m[0].length).trim()) t = t.slice(m[0].length).trim();
  return properCase(t);
}

/** Nom de rue ou de lieu propre (casse corrigée, sans soulignés en fin). */
export function cleanName(s: string | undefined): string | undefined {
  const t = (s ?? '').replace(/[_\s]+$/g, '').replace(/\s+/g, ' ').trim();
  return t ? properCase(t) : undefined;
}

/** Numéro de maison propre (« 25 a » → « 25A »). */
export function cleanNumber(s: string | number | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined;
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.replace(/^(\d+)\s*([a-zA-Z]{1,3})$/, (_, n: string, l: string) => `${n}${l.toUpperCase()}`);
}
