/**
 * Mise en page : GlassesView + sélection → 8 conteneurs texte positionnés (pur, testable).
 *
 * Toujours les mêmes 8 conteneurs (titre = capture des gestes, heure, ligne du haut, curseur,
 * 3 colonnes, pied). Les colonnes ont des positions fixes par gabarit : un rafraîchissement ne
 * change que les textes (textContainerUpgrade, sans clignotement) ; seule une nouvelle forme
 * (autre écran, ligne d'alerte qui apparaît) impose rebuildPageContainer.
 */
import { LINE_H, SCREEN_H, SPACE_W, frenchSpaces, padLeftTo, padRightTo, textWidth, truncate, utf8Bytes } from './font';
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
  /**
   * 1.2.4 : case de l'heure en tête de colonne (px), où l'heure d'Item.aLead / bLead / cLead s'aligne à droite (« ~ »
   * compris : 68 px pour « ~08:48 »).
   */
  lead?: number;
  level: Brightness;
}
interface LayoutDef {
  a: Col;
  b: Col;
  c: Col;
  /** Écart entre deux colonnes (marge de sécurité en plus) ; 12 px par défaut. */
  gap?: number;
  /**
   * 1.2.4 : retrait des lignes en retrait (`sub`), en px, fait d'espaces (5 px chacune) : la colonne b commence alors au
   * bord, où se placent les intitulés pâles (`head` : « ARRÊTS », « LIGNES »).
   */
  subIndent?: number;
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
/**
 * 1.2.3 : arrêts d'un départ (PRD-1.2.3 § 2) : heure et retard, jusqu'à un retard de 3 chiffres (la pire au pixel,
 * « 00:00 +444 » = 104 px ; « 23:59 +120 » = 98 px, « ~08:44 » = 69 px), puis le nom ; à droite la voie
 * (« voie 12a ! » = 80 px) ou « SUPPRIMÉ » (92 px).
 */
const STOP_TIME_W = 106;
/**
 * 1.2.4 (PRD-1.2.4 § 4) : case d'une heure alignée à droite, « ~ » compris (« ~08:48 » : 68 px ; une heure seule : 52 px
 * au plus). Le « ~ » (16 px) dépasse à gauche des chiffres ; le détail d'une ligne le laisse dans le retrait (TILDE_W).
 */
const TIME_SLOT = 68;
export const TILDE_W = 16;
/**
 * 1.2.4 : colonne de l'heure d'un tableau de gare : la case (68 px) puis le retard et la voie, entiers même au plus long
 * (« +12  voie 12 ! » = 113 px ; «   SUPPRIMÉ » = 102 px) ; la destination garde 294 px (« Bruxelles-Aéroport-Zaventem »
 * = 261 px).
 */
const TRAIN_CELL_W = 184;
const STOP_RIGHT_W = 96;
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
  /**
   * 1.2.2 : « Favoris » au format de l'accueil (REVUE-USAGE n° 7) : nom et réponse au plus clair (colonne de droite de
   * 210 px, comme « Autres trajets »), détail et séparateur « Adresses récentes » un ton plus pâles (colonne b).
   */
  favorites: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 2 }, c: { x: right(WIDE_W), w: WIDE_W, align: 'right', level: 4 }, gap: TIGHT },
  /** 1.2.2 : « Gares » : nom de la gare, prochain train dans la colonne de droite de l'accueil (PRD-1.2.2 § 2). */
  stations: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(WIDE_W), w: WIDE_W, align: 'right', level: 4 }, gap: TIGHT },
  /**
   * 1.2.2 : « Bus, tram, métro » (§ 3) : titre de la ligne au plus clair (colonne a) ; ses sens en retrait, plus pâles,
   * le terminus puis les passages alignés à droite (colonne b, comme les favoris de l'accueil). 1.2.4 (PRD-1.2.4 § 2) :
   * la colonne b commence au bord pour les intitulés « ARRÊTS » et « LIGNES » ; le retrait des sens est fait d'espaces.
   */
  lines: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 2 }, c: { x: right(WIDE_W), w: WIDE_W, align: 'right', level: 4 }, gap: TIGHT, subIndent: HOME_INDENT },
  /**
   * 1.2.2 : détail d'une ligne (§ 3) : « vers … » et « Tous les départs de l'arrêt » au plus clair (colonne a) ; chaque
   * passage en retrait, heure puis terminus s'il diffère (colonne b), attente dans la colonne d'état des étapes.
   */
  line: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT + HOME_INDENT - TILDE_W, lead: TIME_SLOT, level: 3 }, c: { x: right(STATE_W), w: STATE_W, level: 4 }, gap: TIGHT },
  /**
   * 1.2.3 : arrêts d'un départ (PRD-1.2.3 § 2) : heure (retard), nom, voie ou « SUPPRIMÉ » à droite, un ton sous l'arrêt
   * du tableau, ligne du haut au plus clair composée sur les mêmes colonnes.
   */
  stops: { a: { x: X_TEXT, w: STOP_TIME_W, lead: TIME_SLOT, level: 3 }, b: { x: X_TEXT + STOP_TIME_W + TIGHT, level: 3 }, c: { x: right(STOP_RIGHT_W), w: STOP_RIGHT_W, align: 'right', level: 3 }, gap: TIGHT },
  nearby: { a: { x: X_TEXT, level: 4 }, b: { x: right(NEXT_W) - GAP - 64, w: 64, level: 3 }, c: { x: right(NEXT_W), w: NEXT_W, level: 4 } },
  board: { a: { x: X_TEXT, w: 52, level: 4 }, b: { x: X_TEXT + 52 + GAP, level: 3 }, c: { x: right(96), w: 96, align: 'right', level: 4 } },
  boardTrain: { a: { x: X_TEXT, w: 40, level: 4 }, b: { x: X_TEXT + 40 + GAP, level: 3 }, c: { x: right(TRAIN_CELL_W), w: TRAIN_CELL_W, lead: TIME_SLOT, level: 4 } },
  steps: { a: { x: X_TEXT, w: TIME_W, align: 'right', level: 4 }, b: { x: X_TEXT + 70 + TIGHT, level: 3 }, c: { x: right(STATE_W), w: STATE_W, level: 4 }, gap: TIGHT },
  train: { a: { x: X_TEXT, level: 4 }, b: { x: right(96) - GAP - TIME_W, w: TIME_W, align: 'right', level: 4 }, c: { x: right(96), w: 96, level: 3 } },
  arrival: { a: { x: X_TEXT, w: 96, level: 4 }, b: { x: X_TEXT + 96 + GAP, level: 3 }, c: { x: right(96), w: 96, align: 'right', level: 4 } },
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
  /** 1.2.2 : un passage du détail d'une ligne (heure, terminus s'il diffère), à côté de l'attente. */
  lineText: right(STATE_W) - TIGHT - (X_TEXT + HOME_INDENT) - GEO.SAFETY,
  /** 1.2.3 : arrêts d'un départ : heure et retard, nom (entre l'heure et la voie), voie ou « SUPPRIMÉ ». */
  stopTime: STOP_TIME_W - GEO.SAFETY,
  stopName: right(STOP_RIGHT_W) - TIGHT - (X_TEXT + STOP_TIME_W + TIGHT) - GEO.SAFETY,
  stopRight: STOP_RIGHT_W - GEO.SAFETY,
};

export interface Frame {
  sel: number;
  top: number;
}

/**
 * Nombre de lignes d'un élément (1 ou 2), plus sa ligne vide (1.2.1) et sa ligne pâle (1.2.2) au-dessus, et ses lignes
 * en retrait en dessous (1.2.2).
 */
export const itemLines = (it: Item): number => (it.gap ? 1 : 0) + (it.head ? 1 : 0) + (it.group ? 1 : 0) + (it.two || it.a2 || it.b2 ? 2 : 1) + (it.sub?.length ?? 0);

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
  // Accueil : la ligne d'aide n'existe que si l'aide s'affiche (1.2.1 : sous la note du jour férié ; 1.2.2, REVUE-USAGE
  // n° 1 : toujours, les 7 premiers jours passés) ou pendant un message temporaire. Sans note, le pied est vide.
  const hintLine = !v.compactFoot || !!v.hints || toast;
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

/**
 * 1.2.3 : défilement par page d'une liste à curseur (GlassesView.paged : tableaux complets, arrêts d'un départ, détail
 * d'une ligne). Curseur visible : la page ne bouge pas ; plus bas, la page suivante commence à lui (jamais une ligne
 * déjà vue : la dernière page peut être moins pleine) ; plus haut, la page précédente finit à lui.
 */
export function pageTop(items: Item[], sel: number, top: number, capacity: number): number {
  if (!items.length) return 0;
  const s = Math.min(Math.max(0, sel), items.length - 1);
  const t0 = Math.min(Math.max(0, Math.round(top) || 0), items.length - 1);
  const { from, to } = visibleRange(items, t0, capacity);
  if (s >= from && s < to) return t0;
  if (s >= to) return s;
  let t = s;
  const linesFrom = (i: number): number => items.slice(i, s + 1).reduce((n, it) => n + itemLines(it), 0);
  while (t > 0 && linesFrom(t - 1) <= capacity) t--;
  return t;
}

/**
 * 1.2.4 : début de la page qui précède `top` (écrans sans curseur) : elle finit juste avant `top` et prend autant
 * d'éléments que la capacité en lignes le permet (au moins un).
 */
export function prevPageTop(items: Item[], top: number, capacity: number): number {
  const t0 = Math.min(Math.max(0, Math.round(top) || 0), items.length);
  if (t0 <= 0) return 0;
  let t = t0 - 1;
  let used = itemLines(items[t]);
  while (t > 0 && used + itemLines(items[t - 1]) <= capacity) {
    t--;
    used += itemLines(items[t]);
  }
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

/**
 * 1.2.4 : texte aligné à droite dans la largeur propre de sa colonne (Col.w), jamais jusqu'au bord de l'écran quand la
 * colonne suivante est vide (« Dans le train » : l'heure d'un arrêt sans état reste sous les autres). Plus large que la
 * colonne, ou colonne sans largeur : laissé tel quel.
 */
function alignRight(text: string, c: Col): string {
  if (c.w === undefined) return text;
  const w = Math.min(c.w, X_END - c.x) - GEO.SAFETY;
  return textWidth(text) <= w ? padLeftTo(text, w) : text;
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

/**
 * 1.2.4 (PRD-1.2.4 § 4) : une heure alignée à droite dans sa case de `slot` px (le « ~ » d'un horaire prévu dépasse à
 * gauche, les chiffres restent alignés d'une ligne à l'autre), puis la suite (`rest`, ses espaces de tête gardés ;
 * `tail` jamais coupée ; sans texte, la fin seule collée à l'heure : « 23:38, dernier »), le tout dans `maxPx`. La case
 * n'est abandonnée que si elle seule ferait couper la suite (rien n'est coupé pour l'alignement) ; une suite coupée de
 * toute façon (« vers » un long terminus) garde l'heure à sa place. `log` : sans les espaces d'alignement.
 */
export function leadCell(lead: string, rest: string, tail: string | undefined, slot: number, maxPx: number): { text: string; log: string } {
  const time = truncate(lead, maxPx);
  const sep = /^[  ]*/.exec(rest)?.[0] ?? '';
  const body = rest.trim();
  const fit = (room: number): string => {
    if (body) return sep + withTail(body, tail, room - textWidth(sep));
    if (!tail) return '';
    const tl = /^[  ]*/.exec(tail)?.[0] ?? '';
    return sep + tl + truncate(tail, room - textWidth(sep + tl));
  };
  if (!time) {
    const r = body || tail ? withTail(body, tail, maxPx) : '';
    return { text: r, log: r };
  }
  const padded = padLeftTo(time, Math.min(slot, maxPx));
  const all = body || tail ? `${sep}${body}${tail ?? ''}` : '';
  const head = textWidth(padded + all) <= maxPx || textWidth(time + all) > maxPx ? padded : time;
  const r = fit(maxPx - textWidth(head));
  return { text: head + r, log: time + r };
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
  const topRow = g.hasTop && v.top ? composeTop(v.top, def) : null;
  if (topRow) lines.push(topRow.log);

  // 1.2.1 (accueil) : nom puis réponse alignée à droite, dans le même conteneur (même luminosité) ; 1.2.2 : sens d'une
  // ligne de « Bus, tram, métro » (lignes en retrait sous l'élément).
  const rightRow = (left: string, r: string, tail: string | undefined) =>
    spread(left, withOptionalTail(r, tail, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY), X_END - def.b.x - GEO.SAFETY, def.gap ?? GAP);
  /** Ligne sans curseur, dans la colonne b seulement (ligne pâle au-dessus, lignes en retrait en dessous). */
  const bOnly = (text: string, log: string): void => {
    colA.push('');
    colB.push(text);
    colC.push('');
    cursor.push('');
    lines.push(log);
  };

  for (let i = from; i < to; i++) {
    const it = items[i];
    if (it.gap) {
      // 1.2.1 : ligne vide au-dessus de l'élément (journalisée vide : elle se voit à l'écran).
      bOnly('', '');
    }
    if (it.head) {
      // 1.2.2 : ligne pâle au-dessus de l'élément (« Adresses récentes »), jamais sous le curseur.
      const h = truncate(it.head, X_END - def.b.x - GEO.SAFETY);
      bOnly(h, h);
    }
    if (it.group) {
      // 1.2.3 : intitulé au-dessus de l'élément, dans la colonne a (« vers Bruxelles Midi »), jamais sous le curseur.
      const h = truncate(it.group, X_END - def.a.x - GEO.SAFETY);
      colA.push(h);
      colB.push('');
      colC.push('');
      cursor.push('');
      lines.push(h);
    }
    const b = it.b ?? '';
    const c = it.c ?? '';
    const bAny = b || it.bTail || it.bLead ? `${it.bLead ?? ''}${b}${it.bTail ?? ''}` : '';
    const cAny = c || it.cLead ? `${it.cLead ?? ''}${c}` : '';
    const aRoom = room(def, 'a', { b: bAny, c: cAny });
    // 1.2.4 (PRD-1.2.4 § 4) : heures alignées à droite dans leur case (Col.lead) ou dans leur colonne (Col.align : sa
    // largeur propre, que la colonne suivante soit remplie ou non)
    const aCell = it.aLead && def.a.lead ? leadCell(it.aLead, it.a, undefined, def.a.lead, aRoom) : null;
    const aLog = aCell ? aCell.log : truncate(it.a, aRoom);
    const a = aCell ? aCell.text : aLog && def.a.align === 'right' && (bAny || cAny) ? alignRight(aLog, def.a) : aLog;
    const bRoom = room(def, 'b', { c: cAny });
    const bCell = it.bLead && def.b.lead ? leadCell(it.bLead, b, it.bTail, def.b.lead, bRoom) : null;
    // sans heure (« aucun passage » d'un sens) : le texte d'une case d'heure commence avec les chiffres, après le « ~ »
    const bPad = !bCell && def.b.lead && bAny ? ' '.repeat(Math.round(TILDE_W / SPACE_W)) : '';
    let bLog = bCell ? bCell.log : bAny ? withTail(b, it.bTail, bRoom - textWidth(bPad)) : '';
    let bt = bCell ? bCell.text : bLog ? bPad + bLog : '';
    if (!bCell && bt && def.b.align === 'right') bt = alignRight(bt, def.b);
    if (it.bRight) {
      const row = rightRow(b, it.bRight, it.bRightTail);
      bt = row.text;
      bLog = [row.left, row.right].filter(Boolean).join(COL_SEP);
    }
    const cRoom = room(def, 'c', {});
    const cCell = it.cLead && def.c.lead ? leadCell(it.cLead, c, undefined, def.c.lead, cRoom) : null;
    const ctext = cCell ? cCell.log : c ? withOptionalTail(c, it.cTail, cRoom) : '';
    colA.push(a);
    colB.push(bt);
    colC.push(cCell ? cCell.text : ctext && def.c.align === 'right' ? padLeftTo(ctext, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY) : ctext);
    cursor.push(!message && i === sel ? CURSOR : '');
    lines.push([aLog, bLog, ctext].filter(Boolean).join(COL_SEP));
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
    for (const s of it.sub ?? []) {
      // 1.2.2 : lignes en retrait sous l'élément (sens d'une ligne), le texte de droite aligné au bord. 1.2.4 : retrait
      // fait d'espaces quand la colonne b commence au bord (subIndent) ; le journal reste sans retrait.
      const ind = def.subIndent ?? 0;
      const pad = ' '.repeat(Math.round(ind / SPACE_W));
      const w = X_END - def.b.x - ind - GEO.SAFETY;
      const row = s.bRight ? spread(s.b, withOptionalTail(s.bRight, s.bRightTail, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY), w, def.gap ?? GAP) : null;
      const text = row ? row.text : truncate(s.b, w);
      bOnly(text ? pad + text : '', row ? [row.left, row.right].filter(Boolean).join(COL_SEP) : text);
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
  // 1.2.2 : « Suivi » ou « Suivre ce trajet » aligné à droite sur la ligne du titre (écran d'un trajet, PRD-1.2.2 § 6).
  const titleRow = v.titleRight ? spread(v.title, v.titleRight, titleW - GEO.SAFETY, TIGHT) : null;
  const title = titleRow ? titleRow.text : truncate(v.title, titleW - GEO.SAFETY) || 'Quai';
  const titleLog = titleRow ? [titleRow.left, titleRow.right].filter(Boolean).join(COL_SEP) : title;
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
    C(IDS.top, 'top', X_TEXT, GEO.TITLE_Y + LINE_H, X_END - X_TEXT, LINE_H, topRow ? topRow.text : '', v.top?.strong ? 4 : 2),
    C(IDS.cursor, 'cursor', GEO.X_CURSOR, g.rowsY, GEO.W_CURSOR, rowsH, join(cursor), 4),
    C(IDS.colA, 'colA', def.a.x, g.rowsY, X_END - def.a.x, rowsH, join(colA), message ? 4 : def.a.level),
    C(IDS.colB, 'colB', def.b.x, g.rowsY, X_END - def.b.x, rowsH, join(colB), def.b.level),
    C(IDS.colC, 'colC', def.c.x, g.rowsY, X_END - def.c.x, rowsH, join(colC), def.c.level),
    // 1.2.2 : pied vide (accueil sans aide ni jour férié) : 1 px, toujours les 8 mêmes conteneurs (REVUE-USAGE n° 1).
    C(IDS.foot, 'foot', X_TEXT, g.footY, X_END - X_TEXT, Math.max(FOOT_MIN_H, g.footLines * LINE_H), foot.join('\n'), opts.toast ? 4 : 2),
  ];
  return { containers, lines, screen: v.screen, title: titleLog, clock: v.clock, top, visible: to - from, sel };
}

/**
 * Ligne du haut : son texte coupé à la largeur de l'écran ; 1.2.3 (`cols`) : composée sur les colonnes du gabarit,
 * a puis b à leur place (espaces mesurés au pixel), c alignée à droite comme la colonne c, journalisée par colonnes.
 */
function composeTop(t: NonNullable<GlassesView['top']>, def: LayoutDef): { text: string; log: string } {
  const full = X_END - X_TEXT - GEO.SAFETY;
  if (!t.cols) {
    const text = truncate(t.text, full);
    return { text, log: text };
  }
  const [a, b, c] = t.cols;
  const gap = def.gap ?? GAP;
  const aRoom = def.b.x - gap - X_TEXT - GEO.SAFETY;
  // 1.2.4 : l'heure en tête, alignée comme celles des lignes dessous (Col.lead)
  const cell = t.lead && def.a.lead ? leadCell(t.lead, a, undefined, def.a.lead, aRoom) : null;
  const at = cell ? cell.text : truncate(a, aRoom);
  const ct = c ? truncate(c, Math.min(def.c.w ?? full, X_END - def.c.x) - GEO.SAFETY) : '';
  // b commence à sa colonne (± 2 px) ; le reste de la ligne est mesuré sur ce qui précède : jamais plus large que l'écran
  const lead = padRightTo(at, def.b.x - X_TEXT);
  const row = spread(b, ct, full - textWidth(lead), gap);
  return { text: lead + row.text, log: [cell ? cell.log : at, row.left, row.right].filter(Boolean).join(COL_SEP) };
}

/** Hauteur d'un pied sans ligne (la documentation du SDK permet 0 ; 1 px évite un champ omis par protobuf). */
export const FOOT_MIN_H = 1;

/** Clé de forme : si elle change, il faut reconstruire la page (rebuildPageContainer). */
export function shapeKey(p: PageSpec): string {
  return p.containers.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join('|');
}
