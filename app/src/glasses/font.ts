/**
 * Police des lunettes : mesures au pixel (bibliothèque @evenrealities/pretext, mêmes métriques que le
 * micrologiciel LVGL), contrôle des glyphes et coupe des textes. La police est proportionnelle
 * (« 1 » = 8 px, « 4 » = 13 px, espace = 5 px) : on ne peut aligner qu'en mesurant.
 */
import { getAdvW, getTextWidth } from '@evenrealities/pretext';

export const SCREEN_W = 576;
export const SCREEN_H = 288;
export const LINE_H = 27;
export const SPACE_W = 5;
export const ELLIPSIS = '…';

/**
 * Remplacements des caractères absents de la police (vérifiés avec getAdvW et les avertissements
 * « glyph dsc. not found » du simulateur). Le tiret cadratin n'est jamais affiché.
 */
const SUBST: Record<string, string> = {
  ' ': ' ', // espace fine insécable → espace insécable
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '‑': '-', // trait d'union insécable
  '‒': '-',
  '–': '-',
  '\u2014': '-', // tiret cadratin : jamais affiché
  '―': '-',
  '−': '-',
  '‘': '’',
  '‚': ',',
  '“': '«',
  '”': '»',
  '„': '«',
  '′': '’',
  '⚠': '!', // ⚠
  '✓': 'v',
  '✔': 'v',
  '✗': 'x',
  '►': '▶',
  '▸': '▶',
  '⏵': '▶',
  '➤': '▶',
  '➜': '→',
  '⟶': '→',
  '⇨': '→',
  '▪': '■',
  '⬤': '●',
  '◉': '●',
};
const DROP = new Set(['​', '‌', '‍', '⁠', '﻿', '­']);

const glyphCache = new Map<number, boolean>();

/** Vrai si le code point a un glyphe dans la police des lunettes (ou est un saut de ligne). */
export function hasGlyph(cp: number): boolean {
  if (cp === 10) return true;
  let v = glyphCache.get(cp);
  if (v === undefined) {
    v = getAdvW(cp) > 0;
    glyphCache.set(cp, v);
  }
  return v;
}

/** Remplace les caractères absents par un équivalent affichable (accent retiré, sinon « ? »). */
export function glyphSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    if (DROP.has(ch)) continue;
    const sub = SUBST[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (cp === 9) {
      out += ' ';
      continue;
    }
    if (hasGlyph(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && base !== ch && [...base].every((c) => hasGlyph(c.codePointAt(0)!)) ? base : '?';
  }
  return out;
}

/** Caractères d'un texte absents de la police (pour les tests). */
export function missingGlyphs(text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) if (!hasGlyph(ch.codePointAt(0)!)) out.add(ch);
  return [...out];
}

/** Largeur en pixels d'une ligne (texte rendu sûr au préalable). */
export function textWidth(text: string): number {
  return text ? getTextWidth(glyphSafe(text)) : 0;
}

/**
 * Typographie française des textes affichés (PRD § 6.0), filet de sécurité pour les textes venus d'ailleurs (alertes
 * du cœur, messages des opérateurs) : espace insécable devant « ! ? : ; » et entre un nombre et son unité. Même
 * largeur au pixel que l'espace ordinaire (5 px).
 */
export function frenchSpaces(text: string): string {
  return text.replace(/(\S) ([!?:;])(?=\s|$)/g, '$1 $2').replace(/(\d) (min|h|s|m|km)(?=[\s,.;:)!?]|$)/g, '$1 $2');
}

/** Coupe une ligne à `maxPx` avec « … » (mesure au pixel). Espaces multiples conservés. */
export function truncate(text: string, maxPx: number): string {
  const t = glyphSafe(frenchSpaces(text)).replace(/[\r\n]+/g, ' ').replace(/^\s+|\s+$/g, '');
  if (!t || getTextWidth(t) <= maxPx) return t;
  const cps = [...t];
  let lo = 0;
  let hi = cps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (getTextWidth(cps.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  const cut = cps.slice(0, lo).join('').trimEnd();
  return cut ? cut + ELLIPSIS : getTextWidth(ELLIPSIS) <= maxPx ? ELLIPSIS : '';
}

/**
 * Aligne à droite dans une colonne de `widthPx` en ajoutant des espaces en tête
 * (précision ± 2 px, l'espace faisant 5 px). Le texte est coupé s'il dépasse.
 */
export function padLeftTo(text: string, widthPx: number): string {
  const t = truncate(text, widthPx);
  const w = getTextWidth(t);
  const n = Math.max(0, Math.round((widthPx - w) / SPACE_W));
  let pad = ' '.repeat(n);
  while (pad && getTextWidth(pad + t) > widthPx) pad = pad.slice(1);
  return pad + t;
}

/**
 * 1.2.3 : complète à droite par des espaces jusqu'à `widthPx` (précision ± 2 px, l'espace faisant 5 px), pour placer la
 * suite d'une ligne composée sur une colonne (ligne du haut des arrêts d'un départ). Le texte n'est jamais coupé.
 */
export function padRightTo(text: string, widthPx: number): string {
  const w = text ? getTextWidth(glyphSafe(text)) : 0;
  return text + ' '.repeat(Math.max(0, Math.round((widthPx - w) / SPACE_W)));
}

/** Longueur en octets UTF-8 (limites des conteneurs : 999 octets dans le simulateur). */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
