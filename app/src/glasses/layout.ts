/**
 * Mise en page : GlassesView + sélection → 8 conteneurs texte positionnés (pur, testable).
 *
 * Toujours les mêmes 8 conteneurs (titre = capture des gestes, heure, ligne du haut, curseur,
 * 3 colonnes, pied). Les colonnes ont des positions fixes par gabarit : un rafraîchissement ne
 * change que les textes (textContainerUpgrade, sans clignotement) ; seule une nouvelle forme
 * (autre écran, ligne d'alerte qui apparaît) impose rebuildPageContainer.
 */
import { LINE_H, SCREEN_H, padLeftTo, textWidth, truncate, utf8Bytes } from './font';
import type { Brightness, ContainerSpec, GlassesView, Item, Layout, PageSpec } from './types';

export const GEO = {
  X_CURSOR: 4,
  W_CURSOR: 22,
  X_TEXT: 28,
  X_END: 572,
  TITLE_Y: 3,
  GAP: 12,
  CLOCK_W: 56,
  BOTTOM_MARGIN: 3,
  /** Marge de sécurité pour que LVGL ne passe jamais à la ligne. */
  SAFETY: 2,
  /** Limite d'octets d'un conteneur (999 dans le simulateur, 1000 caractères dans le SDK). */
  MAX_BYTES: 999,
};

export const IDS = { title: 1, clock: 2, top: 3, cursor: 4, colA: 5, colB: 6, colC: 7, foot: 8 } as const;
export const CURSOR = '▶';
export const COL_SEP = '   ';

interface Col {
  x: number;
  /** Largeur allouée (fixe) ; sinon jusqu'à la colonne suivante non vide de la ligne. */
  w?: number;
  align?: 'left' | 'right';
  level: Brightness;
}
interface LayoutDef {
  a: Col;
  b: Col;
  c: Col;
}

const { X_TEXT, X_END, GAP } = GEO;
const right = (w: number): number => X_END - w;

/**
 * Positions des colonnes par gabarit (maquettes : grilles 76 px / 1fr / auto, 60 px / 1fr / auto…).
 * Prochain départ (Autour de moi, favoris) : 182 px, pour ne jamais couper la voie modifiée
 * (« S10 07:42 +12 v.12 ! » = 170 px) ni un départ du lendemain (« 460 ~demain 08:08 » = 178 px).
 */
const NEXT_W = 182;
/** Colonne de droite des menus (accueil, favoris, Aller à…) : « arrivée demain 09:58 » = 186 px. */
const MENU_W = 192;
export const LAYOUTS: Record<Layout, LayoutDef> = {
  menu: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(MENU_W), w: MENU_W, align: 'right', level: 3 } },
  nearby: { a: { x: X_TEXT, level: 4 }, b: { x: right(NEXT_W) - GAP - 64, w: 64, level: 3 }, c: { x: right(NEXT_W), w: NEXT_W, level: 4 } },
  board: { a: { x: X_TEXT, w: 52, level: 4 }, b: { x: X_TEXT + 52 + GAP, level: 3 }, c: { x: right(96), w: 96, level: 4 } },
  boardTrain: { a: { x: X_TEXT, w: 40, level: 4 }, b: { x: X_TEXT + 40 + GAP, level: 3 }, c: { x: right(160), w: 160, level: 4 } },
  trip: { a: { x: X_TEXT, w: 70, level: 4 }, b: { x: X_TEXT + 70 + GAP, level: 3 }, c: { x: right(96), w: 96, level: 4 } },
  steps: { a: { x: X_TEXT, w: 70, level: 4 }, b: { x: X_TEXT + 70 + GAP, level: 3 }, c: { x: right(96), w: 96, level: 4 } },
  train: { a: { x: X_TEXT, level: 4 }, b: { x: right(96) - GAP - 70, w: 70, level: 4 }, c: { x: right(96), w: 96, level: 3 } },
  arrival: { a: { x: X_TEXT, w: 96, level: 4 }, b: { x: X_TEXT + 96 + GAP, level: 3 }, c: { x: right(96), w: 96, level: 4 } },
  journeys: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(220), w: 220, align: 'right', level: 3 } },
  message: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(96), w: 96, level: 3 } },
};

export interface Frame {
  sel: number;
  top: number;
}

/** Nombre de lignes d'un élément (1 ou 2). */
export const itemLines = (it: Item): number => (it.a2 || it.b2 ? 2 : 1);

export interface Geometry {
  rowsY: number;
  footY: number;
  footLines: number;
  capacity: number;
  hasTop: boolean;
}

/** Géométrie verticale d'une vue : titre, ligne du haut éventuelle, lignes, pied (note + aides). */
export function geometry(v: Pick<GlassesView, 'top' | 'note' | 'reserveNote'>): Geometry {
  const hasTop = !!v.top?.text;
  const rowsY = GEO.TITLE_Y + LINE_H + (hasTop ? LINE_H : 0) + 3;
  const footLines = (v.reserveNote || v.note ? 1 : 0) + 1;
  const footY = SCREEN_H - GEO.BOTTOM_MARGIN - footLines * LINE_H;
  const capacity = Math.max(1, Math.floor((footY - rowsY) / LINE_H));
  return { rowsY, footY, footLines, capacity, hasTop };
}

/** Garde l'élément sélectionné visible ; renvoie le premier élément visible. */
export function ensureVisible(items: Item[], sel: number, top: number, capacity: number): number {
  if (!items.length) return 0;
  const s = Math.min(Math.max(0, sel), items.length - 1);
  let t = Math.min(Math.max(0, top), s);
  const linesFrom = (from: number, to: number): number => {
    let n = 0;
    for (let i = from; i <= to; i++) n += itemLines(items[i]);
    return n;
  };
  while (t < s && linesFrom(t, s) > capacity) t++;
  return t;
}

/** Éléments visibles à partir de `top` dans la capacité donnée. */
export function visibleRange(items: Item[], top: number, capacity: number): { from: number; to: number } {
  let used = 0;
  let to = top;
  for (let i = top; i < items.length; i++) {
    const n = itemLines(items[i]);
    if (used + n > capacity) break;
    used += n;
    to = i + 1;
  }
  return { from: top, to };
}

function fitBytes(text: string): string {
  if (utf8Bytes(text) <= GEO.MAX_BYTES) return text;
  let t = text;
  while (t && utf8Bytes(t) > GEO.MAX_BYTES) t = t.slice(0, -1);
  return t;
}

/** Texte d'un conteneur : jamais vide (le SDK refuse un contenu vide). */
const nonEmpty = (s: string): string => (s.replace(/\s/g, '') ? s : ' ');

/** Coupe les lignes trop longues d'un message (retour à la ligne au mot, mesure au pixel). */
export function wrapLines(lines: string[], maxPx: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // Espaces ordinaires seulement : l'espace insécable (devant « : », « m ») reste collé.
    const words = line.split(/[ \t\n]+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (!cur || textWidth(cand) <= maxPx) cur = cand;
      else {
        out.push(cur);
        cur = w;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Largeur disponible pour une colonne d'une ligne : jusqu'à la prochaine colonne remplie. */
function room(def: LayoutDef, col: 'a' | 'b' | 'c', next: { b?: string; c?: string }): number {
  const c = def[col];
  if (c.w !== undefined && (col === 'c' || (col === 'a' && next.b) || (col === 'b' && next.c))) {
    return Math.min(c.w, X_END - c.x) - GEO.SAFETY;
  }
  if (col === 'a' && next.b && def.b.x > c.x) return def.b.x - GAP - c.x - GEO.SAFETY;
  if ((col === 'a' || col === 'b') && next.c) return def.c.x - GAP - c.x - GEO.SAFETY;
  return X_END - c.x - GEO.SAFETY;
}

/** Colonne b avec une fin protégée : le début est coupé (« … ») pour que `tail` tienne toujours en entier. */
export function withTail(text: string, tail: string | undefined, maxPx: number): string {
  if (!tail) return text ? truncate(text, maxPx) : '';
  const end = truncate(tail, maxPx);
  if (!text.trim()) return truncate(tail.replace(/^[,\s]+/, ''), maxPx);
  const head = truncate(text, maxPx - textWidth(end));
  return head ? head + end : truncate(tail.replace(/^[,\s]+/, ''), maxPx);
}

/** Colonne c avec une fin facultative : ajoutée seulement si le tout tient dans `maxPx`. */
export function withOptionalTail(text: string, tail: string | undefined, maxPx: number): string {
  if (!tail || !text) return text ? truncate(text, maxPx) : '';
  const full = text + tail;
  return textWidth(full) <= maxPx ? truncate(full, maxPx) : truncate(text, maxPx);
}

export interface LayoutOptions {
  /** Message temporaire affiché dans la ligne d'aides (ex. « ★ Ajouté aux favoris »). */
  toast?: string;
}

/** Construit la page complète. `frame` = sélection et défilement courants. */
export function layoutPage(v: GlassesView, frame: Frame, opts: LayoutOptions = {}): PageSpec {
  const def = LAYOUTS[v.layout];
  const message = v.layout === 'message';
  const items: Item[] = message
    ? wrapLines(v.items.map((i) => i.a), X_END - X_TEXT - GEO.SAFETY).map((a): Item => ({ a }))
    : v.items;
  const g = geometry(v);
  const sel = items.length ? Math.min(Math.max(0, frame.sel), items.length - 1) : 0;
  const top = message ? 0 : ensureVisible(items, sel, frame.top, g.capacity);
  const { from, to } = visibleRange(items, top, g.capacity);

  const colA: string[] = [];
  const colB: string[] = [];
  const colC: string[] = [];
  const cursor: string[] = [];
  const lines: string[] = [];
  if (g.hasTop && v.top) lines.push(truncate(v.top.text, X_END - X_TEXT - GEO.SAFETY));

  for (let i = from; i < to; i++) {
    const it = items[i];
    const b = it.b ?? '';
    const c = it.c ?? '';
    const bAny = b || it.bTail ? `${b}${it.bTail ?? ''}` : '';
    const a = truncate(it.a, room(def, 'a', { b: bAny, c }));
    const bt = bAny ? withTail(b, it.bTail, room(def, 'b', { c })) : '';
    const ctext = c ? withOptionalTail(c, it.cTail, room(def, 'c', {})) : '';
    colA.push(a);
    colB.push(bt);
    colC.push(ctext && def.c.align === 'right' ? padLeftTo(ctext, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY) : ctext);
    cursor.push(!message && i === sel ? CURSOR : '');
    lines.push([a, bt, ctext].filter(Boolean).join(COL_SEP));
    if (itemLines(it) === 2) {
      const a2 = it.a2 ? truncate(it.a2, X_END - def.a.x - GEO.SAFETY) : '';
      const b2 = it.b2 ? truncate(it.b2, X_END - def.b.x - GEO.SAFETY) : '';
      colA.push(a2);
      colB.push(b2);
      colC.push('');
      cursor.push('');
      lines.push([a2, b2].filter(Boolean).join(COL_SEP));
    }
  }

  const foot: string[] = [];
  const noteText = v.note ? truncate(v.note, X_END - X_TEXT - GEO.SAFETY) : '';
  if (g.footLines === 2) foot.push(noteText);
  const hintText = opts.toast ? truncate(opts.toast, X_END - X_TEXT - GEO.SAFETY) : v.hints ? truncate(v.hints, X_END - X_TEXT - GEO.SAFETY) : '';
  foot.push(hintText);
  if (noteText) lines.push(noteText);
  if (hintText) lines.push(hintText);

  const titleW = X_END - GEO.CLOCK_W - GAP - X_TEXT;
  const title = truncate(v.title, titleW - GEO.SAFETY) || 'Quai';
  const rowsH = g.capacity * LINE_H;
  const C = (id: number, name: string, x: number, y: number, w: number, h: number, content: string, level: Brightness): ContainerSpec => ({
    id,
    name,
    x,
    y,
    w,
    h,
    content: fitBytes(nonEmpty(content)),
    level,
    capture: id === IDS.title,
  });
  const join = (l: string[]): string => l.join('\n').replace(/\s+$/, '');

  const containers: ContainerSpec[] = [
    C(IDS.title, 'title', X_TEXT, GEO.TITLE_Y, titleW, LINE_H, title, 4),
    C(IDS.clock, 'clock', X_END - GEO.CLOCK_W, GEO.TITLE_Y, GEO.CLOCK_W, LINE_H, padLeftTo(v.clock, GEO.CLOCK_W - GEO.SAFETY), 3),
    C(IDS.top, 'top', X_TEXT, GEO.TITLE_Y + LINE_H, X_END - X_TEXT, LINE_H, g.hasTop ? lines[0] : '', v.top?.strong ? 4 : 2),
    C(IDS.cursor, 'cursor', GEO.X_CURSOR, g.rowsY, GEO.W_CURSOR, rowsH, join(cursor), 4),
    C(IDS.colA, 'colA', def.a.x, g.rowsY, X_END - def.a.x, rowsH, join(colA), message ? 4 : def.a.level),
    C(IDS.colB, 'colB', def.b.x, g.rowsY, X_END - def.b.x, rowsH, join(colB), def.b.level),
    C(IDS.colC, 'colC', def.c.x, g.rowsY, X_END - def.c.x, rowsH, join(colC), def.c.level),
    C(IDS.foot, 'foot', X_TEXT, g.footY, X_END - X_TEXT, g.footLines * LINE_H, foot.join('\n'), opts.toast ? 4 : 2),
  ];
  return { containers, lines, screen: v.screen, title, clock: v.clock, top, visible: to - from, sel };
}

/** Clé de forme : si elle change, il faut reconstruire la page (rebuildPageContainer). */
export function shapeKey(p: PageSpec): string {
  return p.containers.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join('|');
}
