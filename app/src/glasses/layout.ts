/**
 * Mise en page : GlassesView + sélection → 8 conteneurs texte positionnés (pur, testable).
 *
 * Toujours les mêmes 8 conteneurs (titre = capture des gestes, heure, ligne du haut, curseur,
 * 3 colonnes, pied). Les colonnes ont des positions fixes par gabarit : un rafraîchissement ne
 * change que les textes (textContainerUpgrade, sans clignotement) ; seule une nouvelle forme
 * (autre écran, ligne d'alerte qui apparaît) impose rebuildPageContainer.
 */
import { LINE_H, SCREEN_H, frenchSpaces, padLeftTo, textWidth, truncate, utf8Bytes } from './font';
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
  /** Écart entre deux colonnes (marge de sécurité en plus) ; 12 px par défaut. */
  gap?: number;
}

const { X_TEXT, X_END, GAP } = GEO;
const right = (w: number): number => X_END - w;

/**
 * Positions des colonnes par gabarit (maquettes : grilles 76 px / 1fr / auto, 60 px / 1fr / auto…).
 * Prochain départ (Autour de moi) : 182 px, pour ne jamais couper la voie modifiée
 * (« S10 07:42 +12 v.12 ! » = 170 px) ni un départ du lendemain (« 460 ~demain 08:08 » = 178 px).
 */
const NEXT_W = 182;
/**
 * Colonnes des menus (accueil, favoris, Aller à…, PRD § 6.0) : gauche 340 px, droite 190 px
 * (« partir demain 06:20 » = 170 px, « arrivée demain 09:58 » = 186 px).
 */
const MENU_W = 192;
/** Étapes (S6) : heure 70 px, texte 342 px, état 108 px utiles (« dans 30 min » = 108 px). */
const STATE_W = 110;
/**
 * Colonne des heures (étapes, « Dans le train ») : 70 px utiles, pour l'heure prévue la plus large (« ~08:44 » =
 * 69 px) ; le texte des étapes reste à 80 px de la marge (11 px d'écart au moins).
 */
const TIME_W = 72;
/** Écart entre colonnes des menus et des étapes (largeurs utiles du PRD § 6.0). */
const TIGHT = 10;
/**
 * 1.2.1 : colonne de droite de l'accueil et de « Autres trajets », 210 px utiles : départ puis arrivée d'un autre jour
 * (« demain 06:20 → 06:46 » = 201 px, « le 13/11 06:20 → 06:46 » = 199 px).
 */
const WIDE_W = 212;
/** 1.2.1 : retrait des favoris sous « Favoris » sur l'accueil (PRD-1.2.1 § 4.1). */
export const HOME_INDENT = 20;
/** Titre : 476 px utiles avant l'heure. */
const TITLE_W = X_END - GEO.CLOCK_W - TIGHT - X_TEXT;
/**
 * Gabarits. Accueil (1.2.1, § 4.4) : « Favoris », « Autour de moi », « Aller à… », « En cours » (colonne a) et leurs
 * nombres (colonne c : « 4 », « 9 arrêts ») au plus clair ; chaque favori en retrait, nom et réponse dans la colonne b
 * (la réponse alignée à droite par des espaces, mesurés au pixel), au niveau 2. « Autres trajets » : nom et heures au
 * plus clair, 2e ligne (colonne b) un ton plus pâle.
 */
export const LAYOUTS: Record<Layout, LayoutDef> = {
  menu: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(MENU_W), w: MENU_W, align: 'right', level: 3 }, gap: TIGHT },
  home: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT + HOME_INDENT, level: 2 }, c: { x: right(WIDE_W), w: WIDE_W, align: 'right', level: 4 }, gap: TIGHT },
  others: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 2 }, c: { x: right(WIDE_W), w: WIDE_W, align: 'right', level: 4 }, gap: TIGHT },
  nearby: { a: { x: X_TEXT, level: 4 }, b: { x: right(NEXT_W) - GAP - 64, w: 64, level: 3 }, c: { x: right(NEXT_W), w: NEXT_W, level: 4 } },
  board: { a: { x: X_TEXT, w: 52, level: 4 }, b: { x: X_TEXT + 52 + GAP, level: 3 }, c: { x: right(96), w: 96, level: 4 } },
  boardTrain: { a: { x: X_TEXT, w: 40, level: 4 }, b: { x: X_TEXT + 40 + GAP, level: 3 }, c: { x: right(160), w: 160, level: 4 } },
  steps: { a: { x: X_TEXT, w: TIME_W, level: 4 }, b: { x: X_TEXT + 70 + TIGHT, level: 3 }, c: { x: right(STATE_W), w: STATE_W, level: 4 }, gap: TIGHT },
  train: { a: { x: X_TEXT, level: 4 }, b: { x: right(96) - GAP - TIME_W, w: TIME_W, level: 4 }, c: { x: right(96), w: 96, level: 3 } },
  arrival: { a: { x: X_TEXT, w: 96, level: 4 }, b: { x: X_TEXT + 96 + GAP, level: 3 }, c: { x: right(96), w: 96, level: 4 } },
  message: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(96), w: 96, level: 3 } },
};

/** Largeurs utiles (au pixel) des colonnes des menus et des étapes, pour les tests de largeur (CA-M1.7). */
export const WIDTHS = {
  full: X_END - X_TEXT - GEO.SAFETY,
  title: TITLE_W - GEO.SAFETY,
  menuLeft: right(MENU_W) - TIGHT - X_TEXT - GEO.SAFETY,
  menuRight: MENU_W - GEO.SAFETY,
  stepsTime: TIME_W - GEO.SAFETY,
  stepsText: right(STATE_W) - TIGHT - (X_TEXT + 70 + TIGHT) - GEO.SAFETY,
  stepsState: STATE_W - GEO.SAFETY,
  /** 1.2.1 : accueil et « Autres trajets » : texte de gauche (colonne a) à côté de la colonne de droite. */
  wideLeft: right(WIDE_W) - TIGHT - X_TEXT - GEO.SAFETY,
  /** 1.2.1 : ligne d'un favori en retrait sur l'accueil (colonne b : nom, puis réponse alignée à droite). */
  homeRow: X_END - (X_TEXT + HOME_INDENT) - GEO.SAFETY,
  /** 1.2.1 : colonne de droite de l'accueil et de « Autres trajets ». */
  wideRight: WIDE_W - GEO.SAFETY,
};

export interface Frame {
  sel: number;
  top: number;
}

/** Nombre de lignes d'un élément (1 ou 2), plus sa ligne vide au-dessus (1.2.1). */
export const itemLines = (it: Item): number => (it.gap ? 1 : 0) + (it.two || it.a2 || it.b2 ? 2 : 1);

/** Premier élément visible le plus bas possible (écrans sans curseur : la fin de la liste tient à l'écran). */
export function maxTop(items: Item[], capacity: number): number {
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    used += itemLines(items[i]);
    if (used > capacity) return i + 1;
  }
  return 0;
}

/** Défilement borné d'un écran sans curseur. */
export function clampTop(items: Item[], top: number, capacity: number): number {
  return Math.min(Math.max(0, Math.round(top) || 0), maxTop(items, capacity));
}

export interface Geometry {
  rowsY: number;
  footY: number;
  footLines: number;
  capacity: number;
  hasTop: boolean;
  /** Ligne de note dans le pied (au-dessus de l'aide). */
  noteLine: boolean;
  /** Ligne d'aide (ou de message temporaire) dans le pied. */
  hintLine: boolean;
}

/**
 * Géométrie verticale d'une vue : titre, ligne du haut éventuelle, lignes, pied (note + aides). `toast` : un message
 * temporaire est affiché (il prend la ligne d'aide, même sur un pied compact).
 */
export function geometry(v: Pick<GlassesView, 'top' | 'note' | 'reserveNote'> & Partial<Pick<GlassesView, 'hints' | 'compactFoot'>>, toast = false): Geometry {
  const hasTop = !!v.top?.text;
  const rowsY = GEO.TITLE_Y + LINE_H + (hasTop ? LINE_H : 0) + 3;
  const noteLine = !!(v.reserveNote || v.note);
  // 1.2.1 (accueil) : sous la note du jour férié, pas de ligne d'aide vide ; la note est la dernière ligne de l'écran.
  const hintLine = !(v.compactFoot && noteLine && !v.hints && !toast);
  const footLines = (noteLine ? 1 : 0) + (hintLine ? 1 : 0);
  const footY = SCREEN_H - GEO.BOTTOM_MARGIN - footLines * LINE_H;
  const capacity = Math.max(1, Math.floor((footY - rowsY) / LINE_H));
  return { rowsY, footY, footLines, capacity, hasTop, noteLine, hintLine };
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
    const words = frenchSpaces(line).split(/[ \t\n]+/).filter(Boolean);
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
  const gap = def.gap ?? GAP;
  if (col === 'a' && next.b && def.b.x > c.x) return def.b.x - gap - c.x - GEO.SAFETY;
  if ((col === 'a' || col === 'b') && next.c) return def.c.x - gap - c.x - GEO.SAFETY;
  return X_END - c.x - GEO.SAFETY;
}

/** Colonne b avec une fin protégée : le début est coupé (« … ») pour que `tail` tienne toujours en entier. */
export function withTail(text: string, tail: string | undefined, maxPx: number): string {
  if (!tail) return text ? truncate(text, maxPx) : '';
  // L'espace de tête de la fin (« (7 min) » après le texte) est gardée : truncate retire les espaces des bords.
  const lead = /^[  ]*/.exec(tail)?.[0] ?? '';
  const end = lead + truncate(tail, maxPx - textWidth(lead));
  if (!text.trim()) return truncate(tail.replace(/^[,\s]+/, ''), maxPx);
  const head = truncate(text, maxPx - textWidth(end));
  return head ? head + end : truncate(tail.replace(/^[,\s]+/, ''), maxPx);
}

/**
 * Un texte à gauche et un texte à droite dans un même conteneur de `width` px (1.2.1, favoris de l'accueil) : la droite
 * entière (déjà coupée à sa largeur), la gauche coupée pour laisser `gap` px, puis des espaces mesurés au pixel pour que
 * la droite finisse au bord (± 2 px, comme padLeftTo).
 */
export function spread(left: string, right: string, width: number, gap: number): { text: string; left: string; right: string } {
  const r = right ? truncate(right, width) : '';
  const l = left ? truncate(left, Math.max(0, width - (r ? textWidth(r) + gap : 0))) : '';
  if (!r) return { text: l, left: l, right: '' };
  return { text: l + padLeftTo(r, width - textWidth(l)), left: l, right: r };
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
  const g = geometry(v, !!opts.toast);
  const scroll = !!v.scroll && !message;
  const sel = scroll ? (v.mark ?? -1) : items.length ? Math.min(Math.max(0, frame.sel), items.length - 1) : 0;
  const top = message ? 0 : scroll ? clampTop(items, frame.top, g.capacity) : ensureVisible(items, sel, frame.top, g.capacity);
  const { from, to } = visibleRange(items, top, g.capacity);

  const colA: string[] = [];
  const colB: string[] = [];
  const colC: string[] = [];
  const cursor: string[] = [];
  const lines: string[] = [];
  if (g.hasTop && v.top) lines.push(truncate(v.top.text, X_END - X_TEXT - GEO.SAFETY));

  for (let i = from; i < to; i++) {
    const it = items[i];
    if (it.gap) {
      // 1.2.1 : ligne vide au-dessus de l'élément (journalisée vide : elle se voit à l'écran).
      colA.push('');
      colB.push('');
      colC.push('');
      cursor.push('');
      lines.push('');
    }
    const b = it.b ?? '';
    const c = it.c ?? '';
    const bAny = b || it.bTail ? `${b}${it.bTail ?? ''}` : '';
    const a = truncate(it.a, room(def, 'a', { b: bAny, c }));
    let bt = bAny ? withTail(b, it.bTail, room(def, 'b', { c })) : '';
    let bLog = bt;
    if (it.bRight) {
      // 1.2.1 (accueil) : nom puis réponse alignée à droite, dans le même conteneur (même luminosité).
      const row = spread(b, withOptionalTail(it.bRight, it.bRightTail, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY), X_END - def.b.x - GEO.SAFETY, def.gap ?? GAP);
      bt = row.text;
      bLog = [row.left, row.right].filter(Boolean).join(COL_SEP);
    }
    const ctext = c ? withOptionalTail(c, it.cTail, room(def, 'c', {})) : '';
    colA.push(a);
    colB.push(bt);
    colC.push(ctext && def.c.align === 'right' ? padLeftTo(ctext, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY) : ctext);
    cursor.push(!message && i === sel ? CURSOR : '');
    lines.push([a, bLog, ctext].filter(Boolean).join(COL_SEP));
    if (it.two || it.a2 || it.b2) {
      const a2 = it.a2 ? truncate(it.a2, X_END - def.a.x - GEO.SAFETY) : '';
      const b2 = it.b2 ? truncate(it.b2, X_END - def.b.x - GEO.SAFETY) : '';
      colA.push(a2);
      colB.push(b2);
      colC.push('');
      cursor.push('');
      // 2e ligne réservée mais vide (favori en calcul) : rien à journaliser.
      if (a2 || b2) lines.push([a2, b2].filter(Boolean).join(COL_SEP));
    }
  }

  const foot: string[] = [];
  const noteText = v.note ? truncate(v.note, X_END - X_TEXT - GEO.SAFETY) : '';
  if (g.noteLine) foot.push(noteText);
  const hintText = opts.toast ? truncate(opts.toast, X_END - X_TEXT - GEO.SAFETY) : v.hints ? truncate(v.hints, X_END - X_TEXT - GEO.SAFETY) : '';
  if (g.hintLine) foot.push(hintText);
  if (noteText) lines.push(noteText);
  if (hintText && g.hintLine) lines.push(hintText);

  const titleW = TITLE_W;
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
