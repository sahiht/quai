/**
 * 1.2.6 : pastille d'une ligne de bus, tram ou métro, à sa couleur officielle (route_color et
 * route_text_color des horaires de l'opérateur) ; sans couleur publiée, une pastille neutre. Les couleurs passent par
 * le CSSOM (style.setProperty) : la politique de sécurité de Quai Web refuse les attributs style écrits dans la page.
 */
import type { Mode, Op } from '../../../shared/types';
import { lineKey } from '../core/linepicks';
import type { PhoneCtx } from './app';
import { h } from './dom';

type Colors = Map<string, { color: string; text?: string }>;
let colorsP: Promise<Colors> | null = null;

/** Couleurs officielles des lignes (réseau:numéro), lues une fois. */
export function lineColors(ctx: Pick<PhoneCtx, 'core'>): Promise<Colors> {
  if (!colorsP) {
    colorsP = ctx
      .core()
      .then(async (c) => (await c.lineColors?.()) ?? new Map<string, { color: string; text?: string }>())
      .catch(() => {
        colorsP = null;
        return new Map<string, { color: string; text?: string }>();
      });
  }
  return colorsP;
}

/** Pour les tests : oublie les couleurs lues. */
export function forgetLineColors(): void {
  colorsP = null;
}

/** Couleur sombre : texte blanc par défaut (quand l'opérateur ne donne pas la couleur du texte). */
function dark(hex: string): boolean {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 150;
}

/** Contraste WCAG entre deux couleurs « RRGGBB » (de 1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = parseInt(hex, 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Contraste minimal du numéro sur sa pastille (WCAG, texte en gras et éléments d'interface). */
export const BADGE_CONTRAST = 3;

/**
 * Fond et texte d'une pastille à la couleur d'une ligne : le texte de l'opérateur, sinon blanc ou presque noir. 1.2.6 :
 * un texte de l'opérateur illisible sur son fond (contraste sous 3:1, comme le beige sur blanc de 556 lignes De Lijn
 * le 13/11) est remplacé par le plus lisible des deux ; le fond reste celui de l'opérateur.
 */
export function badgeColors(color: string, text?: string): { b: string; t: string } {
  const t = text || (dark(color) ? 'FFFFFF' : '161A17');
  if (contrastRatio(color, t) >= BADGE_CONTRAST) return { b: color, t };
  return { b: color, t: contrastRatio(color, 'FFFFFF') >= contrastRatio(color, '161A17') ? 'FFFFFF' : '161A17' };
}

export function paintBadge(el: HTMLElement, color?: string, text?: string): void {
  if (!color) return;
  const c = badgeColors(color, text);
  el.classList.add('official');
  el.style.setProperty('--b', `#${c.b}`);
  el.style.setProperty('--t', `#${c.t}`);
}

/**
 * Couleurs du réseau pour une ligne sans couleur dans les horaires de son opérateur : au TEC, le jaune et le rouge de
 * ses bus. Les trois réseaux publient la couleur de chaque ligne (nuit du 13/11/2026 : STIB 86/86, De Lijn 1856/1856,
 * TEC 838/838) ; ailleurs, une ligne sans couleur reste neutre.
 */
export const NETWORK_COLORS: Partial<Record<Op, { color: string; text: string }>> = { tec: { color: 'FFD200', text: 'D2001F' } };

/** Pastille d'une ligne : son numéro, à sa couleur (connue, ou lue dans l'index des lignes), sinon celle du réseau. */
export function lineBadge(ctx: Pick<PhoneCtx, 'core'>, l: { op: Op; mode?: Mode; line: string; color?: string; text?: string }, small = false): HTMLSpanElement {
  const el = h('span', { class: small ? 'badge sm' : 'badge', 'aria-hidden': 'true' }, l.line);
  if (l.color) {
    paintBadge(el, l.color, l.text);
    return el;
  }
  const net = NETWORK_COLORS[l.op];
  if (net) paintBadge(el, net.color, net.text);
  void lineColors(ctx).then((m) => {
    const c = m.get(`${l.op}:${lineKey(l.line)}`);
    if (c) paintBadge(el, c.color, c.text);
  });
  return el;
}

/** Pastilles des lignes d'un arrêt (8 au plus, puis « +3 »), dans l'ordre des numéros. */
export function badgeRow(ctx: Pick<PhoneCtx, 'core'>, op: Op, lines: readonly { line: string; mode?: Mode }[], max = 8): HTMLSpanElement {
  const seen = new Set<string>();
  const list = lines.filter((l) => l.mode !== 'train' && !seen.has(lineKey(l.line)) && seen.add(lineKey(l.line)));
  list.sort((a, b) => a.line.localeCompare(b.line, 'fr', { numeric: true }));
  const row = h('span', { class: 'badges', 'aria-hidden': 'true' }, ...list.slice(0, max).map((l) => lineBadge(ctx, { op, ...l }, true)));
  if (list.length > max) row.append(h('span', { class: 'badge sm more' }, `+${list.length - max}`));
  return row;
}
