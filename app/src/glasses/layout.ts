/**
 * Mise en page : GlassesView + sélection → 8 conteneurs texte positionnés (pur, testable).
 *
 * Toujours les mêmes 8 conteneurs (titre = capture des gestes, heure, ligne du haut, curseur,
 * 3 colonnes, pied). Les colonnes ont des positions fixes par gabarit : un rafraîchissement ne
 * change que les textes (textContainerUpgrade, sans clignotement) ; seule une nouvelle forme
 * (autre écran, ligne d'alerte qui apparaît) impose rebuildPageContainer.
 */
import { LINE_H, SCREEN_H, SPACE_W, frenchSpaces, glyphSafe, padLeftTo, padRightTo, textWidth, truncate, utf8Bytes } from './font';
import type { Brightness, ContainerSpec, GlassesView, Item, Layout, PageSpec, Seg } from './types';
import { apos } from '../core/typo';

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
  /**
   * 1.2.2 : « Gares » : nom de la gare, prochain train dans la colonne de droite de l'accueil (PRD-1.2.2 § 2). 1.3.1
   * (PRD-1.3.1 § 12, B21) : la colonne b ne porte que l'accordéon de la gare du curseur, pâle comme celui de « Favoris ».
   */
  stations: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 2 }, c: { x: right(WIDE_W), w: WIDE_W, align: 'right', level: 4 }, gap: TIGHT },
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
  /**
   * Étapes. 1.2.10 (PRD-1.2.10 § 5) : rangées en mots clairs et pâles (segRow) : l'heure et le véhicule au plus clair
   * (colonne a), l'arrêt de descente et la marche pâles (colonne b, qui commence après la case de l'heure, comme
   * « depuis … » en 2e ligne) ; à droite l'heure d'arrivée pâle, ou la marge au plus clair (colonne c).
   */
  steps: { a: { x: X_TEXT, w: TIME_W, align: 'right', level: 4 }, b: { x: X_TEXT + 70 + TIGHT, level: 2 }, c: { x: right(STATE_W), w: STATE_W, level: 4 }, gap: TIGHT },
  train: { a: { x: X_TEXT, level: 4 }, b: { x: right(96) - GAP - TIME_W, w: TIME_W, align: 'right', level: 4 }, c: { x: right(96), w: 96, level: 3 } },
  arrival: { a: { x: X_TEXT, w: 96, level: 4 }, b: { x: X_TEXT + 96 + GAP, level: 3 }, c: { x: right(96), w: 96, align: 'right', level: 4 } },
  message: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: right(96), w: 96, level: 3 } },
  /**
   * 1.2.10 (PRD-1.2.10 § 3.9) : guidage : trois conteneurs au même x, un par luminosité : au plus clair (l'action),
   * normal, pâle. Chaque rangée met son texte dans le conteneur de sa luminosité (les deux autres vides) ; la chaîne de
   * « Où tu en es » mêle les trois, placée au pixel par des espaces (guide-views.ts). x : GUIDE.TEXT_X à côté d'une
   * image, sinon la marge habituelle (layoutGuide).
   */
  guide: { a: { x: X_TEXT, level: 4 }, b: { x: X_TEXT, level: 3 }, c: { x: X_TEXT, level: 2 } },
};

/**
 * 1.2.10 (PRD-1.2.10 § 3.9) : écrans du guidage. Image de 144 × 144 à gauche, sur la grille des rangées (2e rangée sous
 * le titre : 60 px), alignée sur la marge du titre ; texte à x = 196 à côté d'elle, centré verticalement sur elle.
 * Conteneurs d'image : identifiants 9 à 12 (12 conteneurs au plus dont 8 de texte), un par emplacement.
 */
export const GUIDE = {
  IMG_X: X_TEXT,
  IMG_Y: GEO.TITLE_Y + LINE_H + 3 + LINE_H,
  IMG_W: 144,
  IMG_H: 144,
  TEXT_X: 196,
  /** Emplacement de l'image du moment (panneau, flèche) : identifiant et nom stables. */
  IMAGE_ID: 9,
  IMAGE_NAME: 'guide-image',
  /** Largeur utile du texte à côté d'une image, et sans image. */
  TEXT_W: X_END - 196 - GEO.SAFETY,
  FULL_W: X_END - X_TEXT - GEO.SAFETY,
  /**
   * Rangées au plus d'un moment : quatre (« Si tu le rates »), une idée chacune, jamais de passage à la ligne : 108 px,
   * dans la hauteur de l'image (144 px).
   */
  MAX_LINES: 4,
} as const;

/**
 * 1.2.10 (PRD-1.2.10 § 2) : élément de « Favoris » : le détail dit dans la ligne du bas quand le curseur est sur lui
 * (favoriteDetail, l'adresse complète d'une adresse récente). Absent : ligne du bas vide.
 */
export interface DetailItem extends Item {
  detail?: string;
  /**
   * 1.3.0 (PRD-1.3.0 § 7) : lignes de l'accordéon (1 ou 2), dites sous la rangée quand le curseur est sur elle
   * (GlassesView.accordion) ; `planned` : la ligne montre un « ~ ».
   */
  expand?: { text: string; planned?: boolean }[];
}

/**
 * 1.2.10 (PRD-1.2.10 § 2) : bordure d'un conteneur (filet pâle au-dessus de la ligne du détail des favoris). Champ
 * demandé au contrat (ContainerSpec.border) ; la plateforme le dessine (borderWidth, borderColor du SDK).
 */
export interface Border {
  width: number;
  level: Brightness;
}
export type BorderedContainer = ContainerSpec & { border?: Border };

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
  /**
   * 1.3.0 (PRD-1.3.0 § 7) : une ligne de l'accordéon de « Favoris », en retrait de HOME_INDENT depuis la marge : la place
   * que lui donne la mise en page (layoutPage) et celle où son texte est coupé (format.ts, EXPAND_PX), une seule mesure.
   */
  expand: X_END - (X_TEXT + HOME_INDENT) - GEO.SAFETY,
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

/**
 * 1.3.0 (PRD-1.3.0 § 7) : rangée ouverte d'une vue en accordéon : le rang de l'élément sous le curseur et ses lignes en
 * plus (DetailItem.expand). La hauteur d'une rangée dépend donc du curseur : la navigation et le rendu comptent la
 * rangée ouverte entière (maxTop, ensureVisible, pageTop, visibleRange), pour qu'elle tienne toujours à l'écran.
 */
export interface OpenRow {
  at: number;
  lines: number;
}

/** Lignes de l'accordéon d'une rangée, au plus (PRD-1.3.0 § 7 : 1 ou 2). */
export const EXPAND_MAX = 2;

/** 1.3.0 : lignes de l'accordéon d'un élément : celles qui ont un texte, deux au plus. */
export function expandLines(it: Item | undefined): { text: string; planned?: boolean }[] {
  const ex = (it as DetailItem | undefined)?.expand;
  return Array.isArray(ex) ? ex.filter((e) => !!e?.text?.trim()).slice(0, EXPAND_MAX) : [];
}

/** 1.3.0 : la rangée ouverte d'une vue en accordéon quand le curseur est sur `sel` ; aucune sinon (rien à ouvrir). */
export function openRow(v: Pick<GlassesView, 'items'> & Partial<Pick<GlassesView, 'accordion'>>, sel: number): OpenRow | undefined {
  if (!v.accordion) return undefined;
  const lines = expandLines(v.items[sel]).length;
  return lines ? { at: sel, lines } : undefined;
}

/** Hauteur réelle d'un élément (lignes), rangée ouverte de l'accordéon comprise. */
const rowLines = (items: Item[], i: number, open?: OpenRow): number => itemLines(items[i]) + (open && open.at === i ? open.lines : 0);

/** Premier élément visible le plus bas possible (écrans sans curseur : la fin de la liste tient à l'écran). */
export function maxTop(items: Item[], capacity: number, open?: OpenRow): number {
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    used += rowLines(items, i, open);
    if (used > capacity) return i + 1;
  }
  return 0;
}

/** Défilement borné d'un écran sans curseur. */
export function clampTop(items: Item[], top: number, capacity: number, open?: OpenRow): number {
  return Math.min(Math.max(0, Math.round(top) || 0), maxTop(items, capacity, open));
}

export interface Geometry {
  rowsY: number;
  footY: number;
  footLines: number;
  capacity: number;
  hasTop: boolean;
  /** Ligne de note dans le pied (au-dessus de l'aide). */
  noteLine: boolean;
  /** 1.3.0 (PRD-1.3.0 § 1) : ligne d'action (GlassesView.action) dans le pied, sous la note, juste au-dessus de l'aide. */
  actionLine: boolean;
  /** Ligne d'aide (ou de message temporaire) dans le pied. */
  hintLine: boolean;
}

/**
 * Géométrie verticale d'une vue : titre, ligne du haut éventuelle, lignes, pied (note, action, aides). `toast` : un
 * message temporaire est affiché (il prend la ligne d'aide, même sur un pied compact).
 *
 * 1.3.0 (PRD-1.3.0 § 1) : la ligne d'action prend une rangée à la liste ; la liste descend alors du reste de la
 * division (9 px) pour finir là où commence le pied : la colonne a, prolongée sur sa grille, porte la ligne d'action
 * au pixel près sur la grille du pied (layoutPage). 1.3.0 (§ 7) : une vue en accordéon n'a plus de ligne du détail en
 * bas : sa ligne de note n'est réservée (reserveNote) que si elle a une note.
 */
export function geometry(
  v: Pick<GlassesView, 'top' | 'note' | 'reserveNote'> & Partial<Pick<GlassesView, 'hints' | 'compactFoot' | 'notePlanned' | 'action' | 'accordion' | 'cursorAction'>>,
  toast = false,
): Geometry {
  const hasTop = !!v.top?.text;
  const listY = GEO.TITLE_Y + LINE_H + (hasTop ? LINE_H : 0) + 3;
  // 1.2.8 : une note qui dépend de la page (notePlanned) garde sa ligne : changer de page ne reconstruit rien
  const noteLine = !!(v.note || v.notePlanned || (v.reserveNote && !v.accordion));
  // 1.3.1 (PRD-1.3.1 § 6) : une ligne d'action qui suit le curseur garde sa rangée, même vide : rien ne bouge avec lui
  const actionLine = !!v.cursorAction || !!v.action?.trim();
  // Accueil : la ligne d'aide n'existe que si l'aide s'affiche (1.2.1 : sous la note du jour férié ; 1.2.2, REVUE-USAGE
  // n° 1 : toujours, les 7 premiers jours passés) ou pendant un message temporaire. Sans note, le pied est vide.
  const hintLine = !v.compactFoot || !!v.hints || toast;
  const footLines = (noteLine ? 1 : 0) + (actionLine ? 1 : 0) + (hintLine ? 1 : 0);
  const footY = SCREEN_H - GEO.BOTTOM_MARGIN - footLines * LINE_H;
  const capacity = Math.max(1, Math.floor((footY - listY) / LINE_H));
  const rowsY = actionLine ? Math.max(listY, footY - capacity * LINE_H) : listY;
  return { rowsY, footY, footLines, capacity, hasTop, noteLine, actionLine, hintLine };
}

/**
 * Garde l'élément sélectionné visible ; renvoie le premier élément visible. 1.3.0 (`open`) : la rangée ouverte de
 * l'accordéon compte entière (ses lignes en plus aussi).
 */
export function ensureVisible(items: Item[], sel: number, top: number, capacity: number, open?: OpenRow): number {
  if (!items.length) return 0;
  const s = Math.min(Math.max(0, sel), items.length - 1);
  let t = Math.min(Math.max(0, top), s);
  const linesFrom = (from: number, to: number): number => {
    let n = 0;
    for (let i = from; i <= to; i++) n += rowLines(items, i, open);
    return n;
  };
  while (t < s && linesFrom(t, s) > capacity) t++;
  return t;
}

/**
 * 1.2.3 : défilement par page d'une liste à curseur (GlassesView.paged : tableaux complets, arrêts d'un départ, détail
 * d'une ligne). Curseur visible : la page ne bouge pas ; plus bas, la page suivante commence à lui (jamais une ligne
 * déjà vue : la dernière page peut être moins pleine) ; plus haut, la page précédente finit à lui. 1.3.0 (`open`) :
 * hauteurs réelles, rangée ouverte comprise.
 */
export function pageTop(items: Item[], sel: number, top: number, capacity: number, open?: OpenRow): number {
  if (!items.length) return 0;
  const s = Math.min(Math.max(0, sel), items.length - 1);
  const t0 = Math.min(Math.max(0, Math.round(top) || 0), items.length - 1);
  const { from, to } = visibleRange(items, t0, capacity, open);
  if (s >= from && s < to) return t0;
  if (s >= to) return s;
  let t = s;
  const linesFrom = (i: number): number => {
    let n = 0;
    for (let k = i; k <= s; k++) n += rowLines(items, k, open);
    return n;
  };
  while (t > 0 && linesFrom(t - 1) <= capacity) t--;
  return t;
}

/**
 * 1.2.4 : début de la page qui précède `top` (écrans sans curseur) : elle finit juste avant `top` et prend autant
 * d'éléments que la capacité en lignes le permet (au moins un).
 */
export function prevPageTop(items: Item[], top: number, capacity: number, open?: OpenRow): number {
  const t0 = Math.min(Math.max(0, Math.round(top) || 0), items.length);
  if (t0 <= 0) return 0;
  let t = t0 - 1;
  let used = rowLines(items, t, open);
  while (t > 0 && used + rowLines(items, t - 1, open) <= capacity) {
    t--;
    used += rowLines(items, t, open);
  }
  return t;
}

/** Éléments visibles à partir de `top` dans la capacité donnée (1.3.0 : rangée ouverte comprise, `open`). */
export function visibleRange(items: Item[], top: number, capacity: number, open?: OpenRow): { from: number; to: number } {
  let used = 0;
  let to = top;
  for (let i = top; i < items.length; i++) {
    const n = rowLines(items, i, open);
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

/**
 * Colonne b avec une fin protégée : le début est coupé (« … ») pour que `tail` tienne toujours en entier. 1.3.0
 * (PRD-1.3.0 § 5) : le début est coupé au mot (truncateWords), jamais au milieu d'un mot.
 */
export function withTail(text: string, tail: string | undefined, maxPx: number): string {
  if (!tail) return text ? truncateWords(text, maxPx) : '';
  // L'espace de tête de la fin (« (7 min) » après le texte) est gardée : truncate retire les espaces des bords.
  const lead = /^[  ]*/.exec(tail)?.[0] ?? '';
  const end = lead + truncate(tail, maxPx - textWidth(lead));
  if (!text.trim()) return truncate(tail.replace(/^[,\s]+/, ''), maxPx);
  const head = truncateWords(text, maxPx - textWidth(end));
  return head ? head + end : truncate(tail.replace(/^[,\s]+/, ''), maxPx);
}

/**
 * Un texte à gauche et un texte à droite dans un même conteneur de `width` px (1.2.1, favoris de l'accueil) : la droite
 * entière (déjà coupée à sa largeur), la gauche coupée pour laisser `gap` px, puis des espaces mesurés au pixel pour que
 * la droite finisse au bord (± 2 px, comme padLeftTo). 1.3.0 (PRD-1.3.0 § 5) : la gauche coupée au mot.
 */
export function spread(left: string, right: string, width: number, gap: number): { text: string; left: string; right: string } {
  const r = right ? truncate(right, width) : '';
  const l = left ? truncateWords(left, Math.max(0, width - (r ? textWidth(r) + gap : 0))) : '';
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
  /** 1.3.1 (PRD-1.3.1 § 14, R5) : réglage « Plein soleil » (Settings.display.sun) : niveaux de SUN_LEVEL. */
  sun?: boolean;
}

/**
 * 1.3.1 (PRD-1.3.1 § 14, R5) : « Plein soleil », le seul point de réglage de la luminosité : chaque niveau pâle monte
 * d'un cran, jusqu'au niveau 3 au plus ; le niveau 4 reste seul au plus clair. Le curseur et la ligne d'action (au
 * niveau 4, dans la colonne a ou dans le conteneur du curseur) restent donc distincts de tout le reste, d'un cran au
 * moins (3 contre 4, au lieu de 2 contre 4 pour le texte pâle). Les plateformes rendent ces niveaux tels quels
 * (textColor du SDK, opacité de Quai Web).
 */
export const SUN_LEVEL: Readonly<Record<Brightness, Brightness>> = { 0: 1, 1: 2, 2: 3, 3: 3, 4: 4 };

/** Niveau d'un conteneur, « Plein soleil » allumé ou non. */
export function sunLevel(level: Brightness, sun: boolean): Brightness {
  return sun ? SUN_LEVEL[level] : level;
}

/** Page en « Plein soleil » : niveaux des conteneurs et de leurs bordures (filet) ; images et menu inchangés. */
export function inSun(p: PageSpec): PageSpec {
  p.containers = p.containers.map((c) => ({ ...c, level: sunLevel(c.level, true), ...(c.border ? { border: { ...c.border, level: sunLevel(c.border.level, true) } } : {}) }));
  return p;
}

/**
 * 1.2.5 : une ligne en mots clairs et pâles. Chaque mot va dans le conteneur de sa luminosité (colonne a
 * au plus clair, colonne b pâle), placé au pixel par des espaces de 5 px, une espace entre deux mots (deux entre deux
 * conteneurs) ; `right` au plus clair, aligné à droite dans la colonne c. Trop long : le mot qui dépasse est coupé à
 * l'endroit où il commence vraiment, les suivants tombent, jamais `right` : les mots finissent toujours `gap` px avant
 * le début de `right`, ou au bord sûr de l'écran sans lui. 1.2.8 (`rightPale`) : `right` pâle, à la même place, dans
 * le conteneur de la colonne b (une gare que le train a quittée).
 */
export function segRow(segs: Seg[], indentPx: number, right: string | undefined, def: LayoutDef, rightPale = false): { a: string; b: string; c: string; log: string } {
  const row = segRowBright(segs, indentPx, right, def);
  if (!rightPale || !row.c) return row;
  // le texte de droite rejoint la colonne b, à l'endroit où la colonne c l'aurait mis (espaces de 5 px), sans jamais
  // finir plus loin qu'elle (le bord sûr de l'écran) : un arrondi vers le haut le ferait dépasser d'un pixel
  const r = row.c.trimStart();
  const start = def.c.x + textWidth(row.c) - textWidth(r);
  const limit = def.c.x + textWidth(row.c);
  let n = Math.max(1, Math.round((start - def.b.x - textWidth(row.b)) / SPACE_W));
  while (n > 1 && def.b.x + textWidth(row.b + ' '.repeat(n) + r) > limit) n--;
  return { a: row.a, b: row.b + ' '.repeat(n) + r, c: '', log: row.log };
}

function segRowBright(segs: Seg[], indentPx: number, right: string | undefined, def: LayoutDef): { a: string; b: string; c: string; log: string } {
  const gap = def.gap ?? GAP;
  const cw = Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY;
  const r = right ? truncate(right, cw) : '';
  const c = r ? padLeftTo(r, cw) : '';
  const limit = r ? def.c.x + textWidth(c) - textWidth(r) - gap : X_END - GEO.SAFETY;
  const out = { a: '', b: '' };
  const shown: string[] = [];
  let x = X_TEXT + indentPx;
  let prev: 'a' | 'b' | null = null;
  // 1.3.0 (PRD-1.3.0 § 5) : place gardée pour les mots protégés qui suivent le mot `k` (Seg.keep : la voie) : leur
  // largeur, deux espaces (deux conteneurs) et un pixel de crénage chacun
  const reserve = (k: number): number => segs.slice(k + 1).reduce((n, q) => (q.keep && q.t ? n + 2 * SPACE_W + 1 + textWidth(glyphSafe(q.t)) : n), 0);
  let cut = false;
  for (let k = 0; k < segs.length; k++) {
    const p = segs[k];
    if (!p.t) continue;
    // après un mot coupé, les suivants tombent, sauf les mots protégés (la voie reste entière, après le nom coupé)
    if (cut && !p.keep) continue;
    const key = p.hi ? 'a' : 'b';
    const cx = p.hi ? def.a.x : def.b.x;
    const lim = p.keep ? limit : limit - reserve(k);
    // entre deux conteneurs, deux espaces : un glyphe large (« W ») peut déborder de sa chasse
    const space = prev ? (prev !== key ? 2 * SPACE_W : SPACE_W) : 0;
    const pad = ' '.repeat(Math.max(0, Math.round((x + space - cx - textWidth(out[key])) / SPACE_W)));
    // mesure du conteneur entier : le crénage à la jonction compte (± 1 px)
    const fits = (t: string): boolean => cx + textWidth(out[key] + pad + t) <= lim;
    // 1.2.6 : comme truncate, les caractères invisibles (sens d'écriture) retirés, les absents remplacés
    const word = glyphSafe(p.t);
    let t = word;
    if (!fits(t)) {
      // un mot protégé n'est jamais coupé : sans place, il n'est pas dit (ni ce qui le suit)
      if (p.keep) break;
      // 1.3.0 (PRD-1.3.0 § 5) : coupé au mot (ou après un morceau entier d'un nom composé), jamais au milieu d'un mot ;
      // chaque essai plus court que le précédent (le crénage à la jonction peut coûter un pixel)
      let w = lim - cx - textWidth(out[key] + pad);
      t = w > 0 ? truncateWords(word, w) : '';
      while (t && !fits(t)) {
        w = Math.min(w - 1, textWidth(t) - 1);
        t = w > 0 ? truncateWords(word, w) : '';
      }
    }
    if (!t) {
      // rien de ce mot ne tient : la suite tombe, sauf un mot protégé
      cut = true;
      continue;
    }
    out[key] += pad + t;
    shown.push(t);
    prev = key;
    x = cx + textWidth(out[key]);
    if (t !== word) cut = true;
  }
  // 1.2.10 : une heure alignée dans sa case (espaces de tête) se journalise sans elles
  return { ...out, c, log: shown.map((t) => t.trim()).join(' ') + (r ? COL_SEP + r : '') };
}

/** Construit la page complète. `frame` = sélection et défilement courants. */
export function layoutPage(v: GlassesView, frame: Frame, opts: LayoutOptions = {}): PageSpec {
  if (opts.sun) return inSun(layoutPage(v, frame, { ...opts, sun: false }));
  if (v.layout === 'guide') return layoutGuide(v, opts);
  const def = LAYOUTS[v.layout];
  const message = v.layout === 'message';
  const items: Item[] = message
    ? wrapLines(v.items.map((i) => i.a), X_END - X_TEXT - GEO.SAFETY).map((a): Item => ({ a }))
    : v.items;
  const g = geometry(v, !!opts.toast);
  const scroll = !!v.scroll && !message;
  const sel = scroll ? (v.mark ?? -1) : items.length ? Math.min(Math.max(0, frame.sel), items.length - 1) : 0;
  // 1.3.0 (PRD-1.3.0 § 7) : accordéon : la rangée du curseur ouverte, comptée entière dans le défilement
  const open = message || scroll ? undefined : openRow({ items, accordion: v.accordion }, sel);
  const top = message ? 0 : scroll ? clampTop(items, frame.top, g.capacity) : ensureVisible(items, sel, frame.top, g.capacity, open);
  const { from, to } = visibleRange(items, top, g.capacity, open);

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
      const h = truncateWords(it.head, X_END - def.b.x - GEO.SAFETY);
      bOnly(h, h);
    }
    if (it.group) {
      // 1.2.3 : intitulé au-dessus de l'élément, dans la colonne a (« vers Bruxelles Midi »), jamais sous le curseur.
      const h = truncateWords(it.group, X_END - def.a.x - GEO.SAFETY);
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
    // 1.3.0 (PRD-1.3.0 § 5) : tout texte d'une rangée coupé au mot (truncateWords, withTail, spread, segRow), jamais au
    // milieu d'un mot ; les heures, l'état et la voie (colonne c, fins protégées, texte de droite) ne sont jamais coupés
    const aLog = aCell ? aCell.log : truncateWords(it.a, aRoom);
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
    if (it.segs) {
      // 1.2.5 : mots clairs et pâles (« Bus W vers Bruxelles Midi »), l'attente au plus clair à droite
      const row = segRow(it.segs, 0, it.bRight, def, it.rightPale);
      colA.push(row.a);
      colB.push(row.b);
      colC.push(row.c);
      cursor.push(!message && i === sel ? CURSOR : '');
      lines.push(row.log);
    } else {
    colA.push(a);
    colB.push(bt);
    colC.push(cCell ? cCell.text : ctext && def.c.align === 'right' ? padLeftTo(ctext, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY) : ctext);
    cursor.push(!message && i === sel ? CURSOR : '');
    lines.push([aLog, bLog, ctext].filter(Boolean).join(COL_SEP));
    }
    if (it.two || it.a2 || it.b2) {
      const a2 = it.a2 ? truncateWords(it.a2, X_END - def.a.x - GEO.SAFETY) : '';
      const b2 = it.b2 ? truncateWords(it.b2, X_END - def.b.x - GEO.SAFETY) : '';
      colA.push(a2);
      colB.push(b2);
      colC.push('');
      cursor.push('');
      // 2e ligne réservée mais vide (favori en calcul) : rien à journaliser.
      if (a2 || b2) lines.push([a2, b2].filter(Boolean).join(COL_SEP));
    }
    for (const s of it.sub ?? []) {
      if (s.segs) {
        // 1.2.5 : ligne en retrait en mots clairs et pâles (« Bus 36 vers Wavre, Gare »)
        const row = segRow(s.segs, s.flush ? 0 : (def.subIndent ?? 0), s.bRight, def);
        colA.push(row.a);
        colB.push(row.b);
        colC.push(row.c);
        cursor.push('');
        lines.push(row.log);
        continue;
      }
      // 1.2.2 : lignes en retrait sous l'élément (sens d'une ligne), le texte de droite aligné au bord. 1.2.4 : retrait
      // fait d'espaces quand la colonne b commence au bord (subIndent) ; le journal reste sans retrait.
      const ind = def.subIndent ?? 0;
      const pad = ' '.repeat(Math.round(ind / SPACE_W));
      const w = X_END - def.b.x - ind - GEO.SAFETY;
      const row = s.bRight ? spread(s.b, withOptionalTail(s.bRight, s.bRightTail, Math.min(def.c.w ?? 0, X_END - def.c.x) - GEO.SAFETY), w, def.gap ?? GAP) : null;
      const text = row ? row.text : truncateWords(s.b, w);
      bOnly(text ? pad + text : '', row ? [row.left, row.right].filter(Boolean).join(COL_SEP) : text);
    }
    if (open && open.at === i) {
      // 1.3.0 (PRD-1.3.0 § 7) : accordéon : sous la rangée du curseur, ses lignes (1 ou 2), pâles (colonne b) et en
      // retrait de HOME_INDENT depuis la marge, coupées au mot dans WIDTHS.expand, la largeur où l'équipe des écrans a
      // déjà coupé leur texte (EXPAND_PX) : jamais coupées deux fois ; les autres rangées restent fermées
      const pad = ' '.repeat(Math.max(0, Math.round((X_TEXT + HOME_INDENT - def.b.x) / SPACE_W)));
      const w = Math.min(WIDTHS.expand, X_END - def.b.x - textWidth(pad) - GEO.SAFETY);
      for (const e of expandLines(it)) {
        const t = truncateWords(e.text, w);
        bOnly(t ? pad + t : '', t);
      }
    }
  }

  const foot: string[] = [];
  // 1.2.10 (PRD-1.2.10 § 2) : « Favoris » : la ligne du bas dit le détail de l'élément sous le curseur (DetailItem) ;
  // 1.3.0 (PRD-1.3.0 § 7) : plus de ligne du détail (ni de filet) dans une vue en accordéon
  const detailLine = v.layout === 'favorites' && !v.note && !v.accordion;
  const detail = detailLine ? ((items[sel] as DetailItem | undefined)?.detail ?? '') : '';
  // 1.2.8 : « ~ horaire prévu » seulement sous une page qui montre un « ~ » (notePlanned) ; 1.3.0 : une ligne ouverte
  // de l'accordéon aussi (expand.planned)
  const plannedShown = items.slice(from, to).some((it) => it.planned) || (!!open && expandLines(items[open.at]).some((e) => e.planned));
  const noteSrc = detailLine ? detail : v.note ?? (v.notePlanned && plannedShown ? v.notePlanned : '');
  const noteText = noteSrc ? truncateWordsPx(noteSrc, X_END - X_TEXT - GEO.SAFETY) : '';
  // journal QUAI_SCREEN (scénarios de bout en bout) : le texte exact de la ligne du détail, que seule la mise en page
  // connaît (il suit le curseur) ; le contrôleur journalise view.log après la mise en page
  if (detailLine && v.log) v.log.detail = noteText;
  if (g.noteLine) foot.push(noteText);
  // 1.3.0 (PRD-1.3.0 § 1) : ligne d'action, au plus clair, juste au-dessus de l'aide : sa place reste vide dans le pied
  // (pâle), son texte est dans le conteneur de la colonne a, prolongé jusqu'à elle (plus bas). 1.3.1 (PRD-1.3.1 § 6) :
  // celle de la rangée du curseur (cursorAction), vide sur une rangée qui n'en a pas
  const actionSrc = v.cursorAction ? (message || scroll ? '' : (items[sel]?.actionText ?? '')) : (v.action ?? '');
  // 1.3.1 (PRD-1.3.1 § 6) : un gabarit dont la colonne a n'est pas au plus clair (arrêts d'un départ : l'heure, niveau 3)
  // porte la ligne d'action dans le conteneur du curseur, son texte 1 px après la marge (espaces de 5 px) : coupé 1 px
  // plus court, il garde à droite la marge de sécurité de tout texte des lunettes (contrôle qualité 1.3.1)
  const actionInA = g.actionLine && def.a.level === 4;
  const actionInCursor = g.actionLine && !actionInA;
  const actionPad = actionInCursor ? ' '.repeat(Math.ceil((X_TEXT - GEO.X_CURSOR) / SPACE_W)) : '';
  const actionX = actionInCursor ? GEO.X_CURSOR + textWidth(actionPad) : X_TEXT;
  const actionText = g.actionLine ? truncateWordsPx(actionSrc, X_END - actionX - GEO.SAFETY) : '';
  if (g.actionLine) foot.push('');
  const hintText = opts.toast ? truncateWordsPx(opts.toast, X_END - X_TEXT - GEO.SAFETY) : v.hints ? truncateWordsPx(v.hints, X_END - X_TEXT - GEO.SAFETY) : '';
  if (g.hintLine) foot.push(hintText);
  if (noteText) lines.push(noteText);
  if (actionText) lines.push(actionText);
  if (hintText && g.hintLine) lines.push(hintText);

  const titleW = TITLE_W;
  // 1.2.2 : « Suivi » ou « Suivre ce trajet » aligné à droite sur la ligne du titre (écran d'un trajet, PRD-1.2.2 § 6).
  const titleRow = v.titleRight ? spread(v.title, v.titleRight, titleW - GEO.SAFETY, TIGHT) : null;
  // 1.2.10 (PRD-1.2.10 § 1, principe 7) : un titre trop long est coupé au mot, jamais au milieu d'un mot
  const title = titleRow ? titleRow.text : truncateWordsPx(v.title, titleW - GEO.SAFETY) || 'Quai';
  const titleLog = titleRow ? [titleRow.left, titleRow.right].filter(Boolean).join(COL_SEP) : title;
  const rowsH = g.capacity * LINE_H;
  const C = (id: number, name: string, x: number, y: number, w: number, h: number, content: string, level: Brightness): ContainerSpec => ({
    id,
    name,
    x,
    y,
    w,
    h,
    content: fitBytes(nonEmpty(apos(content))),
    level,
    capture: id === IDS.title,
  });
  const join = (l: string[]): string => l.join('\n').replace(/\s+$/, '');

  // 1.2.10 (PRD-1.2.10 § 2) : sans ligne du haut, son conteneur devient le filet pâle au-dessus de la ligne du détail
  // (1 px de haut, bordure de niveau 2), au milieu de l'espace entre la liste et le pied
  const filet = detailLine && !topRow;
  // 1.3.0 (PRD-1.3.0 § 1) : la colonne a (au plus clair aux étapes) se prolonge sur le pied, dont la liste touche le
  // haut (geometry) : les rangées restantes de la liste et la ligne de la note vides, puis la ligne d'action ; les huit
  // mêmes conteneurs (limite du matériel), la ligne d'action au pixel près sur la grille du pied
  // 1.3.1 (PRD-1.3.1 § 6) : un gabarit dont la colonne a n'est pas au plus clair (arrêts d'un départ : l'heure, niveau 3)
  // porte la ligne d'action dans le conteneur du curseur (au plus clair), élargi jusqu'au bord et prolongé de même ; son
  // texte commence à la marge du texte (5 espaces : 1 px plus loin, jamais avant)
  const footRows = (rows: string[], last: string): string[] => [...rows, ...new Array<string>(Math.max(0, g.capacity - rows.length)).fill(''), ...(g.noteLine ? [''] : []), last];
  const aRows = actionInA ? footRows(colA, actionText) : colA;
  const footH = ((g.noteLine ? 1 : 0) + 1) * LINE_H;
  const aH = rowsH + (actionInA ? footH : 0);
  const cursorRows = actionInCursor ? footRows(cursor, actionText ? `${actionPad}${actionText}` : '') : cursor;
  const filetY = Math.round((g.rowsY + rowsH + g.footY) / 2);
  const topC: BorderedContainer = filet
    ? { ...C(IDS.top, 'top', X_TEXT, filetY, X_END - X_TEXT, FOOT_MIN_H, '', 2), border: { width: 1, level: 2 } }
    : C(IDS.top, 'top', X_TEXT, GEO.TITLE_Y + LINE_H, X_END - X_TEXT, LINE_H, topRow ? topRow.text : '', v.top?.strong ? 4 : 2);
  const containers: ContainerSpec[] = [
    C(IDS.title, 'title', X_TEXT, GEO.TITLE_Y, titleW, LINE_H, title, 4),
    C(IDS.clock, 'clock', X_END - GEO.CLOCK_W, GEO.TITLE_Y, GEO.CLOCK_W, LINE_H, padLeftTo(v.clock, GEO.CLOCK_W - GEO.SAFETY), 3),
    topC,
    actionInCursor
      ? C(IDS.cursor, 'cursor', GEO.X_CURSOR, g.rowsY, X_END - GEO.X_CURSOR, rowsH + footH, join(cursorRows), 4)
      : C(IDS.cursor, 'cursor', GEO.X_CURSOR, g.rowsY, GEO.W_CURSOR, rowsH, join(cursor), 4),
    C(IDS.colA, 'colA', def.a.x, g.rowsY, X_END - def.a.x, aH, join(aRows), message ? 4 : def.a.level),
    C(IDS.colB, 'colB', def.b.x, g.rowsY, X_END - def.b.x, rowsH, join(colB), def.b.level),
    C(IDS.colC, 'colC', def.c.x, g.rowsY, X_END - def.c.x, rowsH, join(colC), def.c.level),
    // 1.2.2 : pied vide (accueil sans aide ni jour férié) : 1 px, toujours les 8 mêmes conteneurs (REVUE-USAGE n° 1).
    C(IDS.foot, 'foot', X_TEXT, g.footY, X_END - X_TEXT, Math.max(FOOT_MIN_H, g.footLines * LINE_H), foot.join('\n'), opts.toast ? 4 : 2),
  ];
  return withExtras({ containers, lines, screen: v.screen, title: titleLog, clock: v.clock, top, visible: to - from, sel }, v);
}

/** 1.2.10 : images et choix du menu de la vue, copiés dans la page (absents : aucun). */
function withExtras(p: PageSpec, v: GlassesView): PageSpec {
  // 1.3.1 (PRD-1.3.1 § 7) : le journal de la page dit ce que montrent les conteneurs (apostrophe typographique)
  p.lines = p.lines.map(apos);
  p.title = apos(p.title);
  if (v.images?.length) p.images = v.images.map((i) => ({ ...i, image: { ...i.image } }));
  if (v.menu?.length) p.menu = v.menu.map((m) => ({ ...m }));
  return p;
}

/**
 * 1.2.10 (PRD-1.2.10 § 1, principe 7) : un texte coupé à `maxPx` sans jamais couper un mot : il finit au dernier mot
 * entier qui tient, suivi de « … » ; faute de place pour un seul mot, après le dernier trait d'union, la dernière barre
 * ou la dernière apostrophe qui tient (« Comines/… », « Bruxelles-… ») ; un premier morceau seul trop long est coupé
 * au caractère (aucune autre issue). L'espace insécable lie ses deux mots (« 40 m », « arrêt : ») : jamais séparés.
 * 1.3.0 (PRD-1.3.0 § 5) : le chemin commun de toutes les rangées ; un séparateur isolé (« - », « / ») ne finit jamais le
 * texte coupé.
 */
export function truncateWords(text: string, maxPx: number): string {
  const t = truncate(text, Number.MAX_SAFE_INTEGER);
  if (textWidth(t) <= maxPx) return t;
  const words = t.split(' ');
  for (let k = words.length - 1; k >= 1; k--) {
    // le mot suivant, s'il est composé, garde ses premiers morceaux entiers (« Express Wavre-… ») : le plus long qui tient
    const next = words[k];
    for (let i = next.length - 1; i > 0; i--) {
      if (!/[-/’']/.test(next[i - 1])) continue;
      const part = `${words.slice(0, k).join(' ')} ${next.slice(0, i)}`;
      if (textWidth(`${part}…`) <= maxPx) return `${part}…`;
    }
    // 1.3.0 : ni ponctuation ni séparateur isolé en fin (« Arlon TEC - Rue … » : « Arlon TEC… », jamais « Arlon TEC -… »)
    const head = words.slice(0, k).join(' ').replace(/(?:\s+[-/–·])+$/, '').replace(/[\s,;:·]+$/, '');
    if (head && textWidth(`${head}…`) <= maxPx) return `${head}…`;
  }
  // un seul mot ne tient pas : ses morceaux (« Comines/komen » → « Comines/ », « Bruxelles-Aéroport » → « Bruxelles- »)
  const first = words[0];
  for (let i = first.length - 1; i > 0; i--) {
    if (!/[-/’']/.test(first[i - 1])) continue;
    const head = first.slice(0, i);
    if (textWidth(`${head}…`) <= maxPx) return `${head}…`;
  }
  return truncate(t, maxPx);
}
const truncateWordsPx = truncateWords;

/**
 * 1.2.10 (PRD-1.2.10 § 3.2, § 3.9) : page du guidage. Titre et heure pâles ; rangées (Item.a au plus clair, b normal,
 * c pâle, déjà mesurées et placées par guide-views.ts) à x = 196 à côté d'une image et centrées sur elle, sinon à la
 * marge, sous le titre ; aides dans le pied, sans ligne réservée quand il n'y en a pas (écran vide : rien du tout).
 * Les mêmes 8 conteneurs de texte ; la forme ne change qu'avec l'image, le nombre de rangées ou les aides : les
 * chiffres qui bougent (distance, minutes) se mettent à jour sans reconstruire la page.
 */
function layoutGuide(v: GlassesView, opts: LayoutOptions): PageSpec {
  const image = v.images?.[0];
  const x = image ? GUIDE.TEXT_X : X_TEXT;
  const w = X_END - x;
  const maxPx = w - GEO.SAFETY;
  const g = geometry({ top: undefined, note: undefined, reserveNote: false, hints: v.hints, compactFoot: true }, !!opts.toast);
  // jamais plus de rangées que l'écran n'en tient entre le titre et le pied (la vue en donne six au plus)
  const items = v.items.slice(0, g.capacity);
  const n = items.length;
  const centered = image ? Math.round(image.y + image.h / 2 - (n * LINE_H) / 2) : g.rowsY;
  const rowsY = Math.min(Math.max(g.rowsY, centered), g.footY - Math.max(1, n) * LINE_H);
  const rowsH = Math.max(1, n) * LINE_H;
  // le texte est déjà placé (espaces de tête comprises) : seule la fin est coupée si elle dépassait
  const keep = (s: string | undefined): string => {
    if (!s) return '';
    if (textWidth(s) <= maxPx) return s;
    const lead = /^[  ]*/.exec(s)?.[0] ?? '';
    return lead + truncateWordsPx(s.slice(lead.length), maxPx - textWidth(lead));
  };
  const colA: string[] = [];
  const colB: string[] = [];
  const colC: string[] = [];
  const lines: string[] = [];
  for (const it of items) {
    const a = keep(it.a);
    const b = keep(it.b);
    const c = keep(it.c);
    colA.push(a);
    colB.push(b);
    colC.push(c);
    // journal : la rangée telle qu'elle se lit (un seul texte, ou la chaîne composée des trois)
    lines.push(guideRowLog(a, b, c));
  }
  // 1.3.1 (PRD-1.3.1 § 1, B9) : le pied de l'écran calme (« · · · », la progression) est centré par la vue, avec des
  // espaces de tête mesurées : elles restent (le journal les omet)
  const footLead = !opts.toast && v.hints ? (/^[ \u00a0]*/.exec(v.hints)?.[0] ?? '') : '';
  const hintText = opts.toast ? truncateWordsPx(opts.toast, X_END - X_TEXT - GEO.SAFETY) : v.hints ? footLead + truncateWordsPx(v.hints.slice(footLead.length), X_END - X_TEXT - GEO.SAFETY - textWidth(footLead)) : '';
  if (hintText) lines.push(hintText.trim());
  // titre du trajet guidé (« Vers … » d'un « j'y descends ») coupé au mot, jamais au milieu d'un mot
  const title = v.title ? truncateWordsPx(v.title, TITLE_W - GEO.SAFETY) : '';
  const C = (id: number, name: string, cx: number, y: number, cw: number, h: number, content: string, level: Brightness): ContainerSpec => ({
    id,
    name,
    x: cx,
    y,
    w: cw,
    h,
    content: fitBytes(nonEmpty(apos(content))),
    level,
    capture: id === IDS.title,
  });
  const join = (l: string[]): string => l.join('\n').replace(/\s+$/, '');
  const containers: ContainerSpec[] = [
    C(IDS.title, 'title', X_TEXT, GEO.TITLE_Y, TITLE_W, LINE_H, title, 2),
    C(IDS.clock, 'clock', X_END - GEO.CLOCK_W, GEO.TITLE_Y, GEO.CLOCK_W, LINE_H, v.clock ? padLeftTo(v.clock, GEO.CLOCK_W - GEO.SAFETY) : '', 2),
    C(IDS.top, 'top', X_TEXT, GEO.TITLE_Y + LINE_H, X_END - X_TEXT, LINE_H, '', 2),
    C(IDS.cursor, 'cursor', GEO.X_CURSOR, g.rowsY, GEO.W_CURSOR, LINE_H, '', 4),
    C(IDS.colA, 'colA', x, rowsY, w, rowsH, join(colA), LAYOUTS.guide.a.level),
    C(IDS.colB, 'colB', x, rowsY, w, rowsH, join(colB), LAYOUTS.guide.b.level),
    C(IDS.colC, 'colC', x, rowsY, w, rowsH, join(colC), LAYOUTS.guide.c.level),
    C(IDS.foot, 'foot', X_TEXT, g.footY, X_END - X_TEXT, Math.max(FOOT_MIN_H, g.footLines * LINE_H), hintText, opts.toast ? 4 : 2),
  ];
  return withExtras({ containers, lines, screen: v.screen, title, clock: v.clock, top: 0, visible: n, sel: -1 }, v);
}

/** 1.2.10 : journal d'une rangée du guidage : ses textes dans l'ordre où ils se lisent (de gauche à droite). */
function guideRowLog(a: string, b: string, c: string): string {
  const parts = [a, b, c].filter((s) => s.trim());
  if (parts.length <= 1) return (parts[0] ?? '').trim();
  // rangée composée (chaîne) : chaque caractère visible à sa colonne, les espaces mesurées remises en une seule
  const chars: string[] = [];
  for (const s of [a, b, c]) {
    let px = 0;
    for (const ch of s) {
      if (ch !== ' ' && ch !== ' ') chars.push(`${String(px).padStart(5, '0')}${ch}`);
      px += textWidth(ch === ' ' ? ' ' : ch);
    }
  }
  chars.sort();
  let out = '';
  let last = -1;
  for (const k of chars) {
    const px = Number(k.slice(0, 5));
    if (last >= 0 && px - last >= SPACE_W - 1) out += ' ';
    out += k.slice(5);
    last = px + textWidth(k.slice(5));
  }
  return out;
}

/**
 * Ligne du haut : son texte coupé à la largeur de l'écran ; 1.2.3 (`cols`) : composée sur les colonnes du gabarit,
 * a puis b à leur place (espaces mesurés au pixel), c alignée à droite comme la colonne c, journalisée par colonnes.
 */
function composeTop(t: NonNullable<GlassesView['top']>, def: LayoutDef): { text: string; log: string } {
  const full = X_END - X_TEXT - GEO.SAFETY;
  if (!t.cols) {
    // 1.3.0 (PRD-1.3.0 § 5) : coupée au mot
    const text = truncateWordsPx(t.text, full);
    return { text, log: text };
  }
  const [a, b, c] = t.cols;
  const gap = def.gap ?? GAP;
  if (!b && !t.lead) {
    // 1.2.10 (PRD-1.2.10 § 5) : deux textes seulement : a à la marge, c aligné au bord (« Départ 07:05, dans 3 min »,
    // « arrivée 08:54 »), a coupé au mot avant c
    const r = c ? truncate(c, full) : '';
    const l = truncateWordsPx(a, Math.max(0, full - (r ? textWidth(r) + gap : 0)));
    const row = spread(l, r, full, gap);
    return { text: row.text, log: [row.left, row.right].filter(Boolean).join(COL_SEP) };
  }
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

/**
 * Clé de forme : si elle change, il faut reconstruire la page (rebuildPageContainer). 1.2.10 : aussi la bordure d'un
 * conteneur, chaque image (emplacement et dessin : une autre image reconstruit la page) et les choix du menu système ;
 * seuls les textes changent : mise à jour sans clignotement.
 */
export function shapeKey(p: PageSpec): string {
  const cs = p.containers.map((c) => {
    const b = (c as BorderedContainer).border;
    return `${c.id}:${c.x},${c.y},${c.w},${c.h}${b ? `/b${b.width}:${b.level}` : ''}`;
  });
  const imgs = (p.images ?? []).map((i) => `i${i.id}:${i.x},${i.y},${i.w},${i.h}:${JSON.stringify(i.image)}`);
  const menu = p.menu?.length ? [`m:${p.menu.map((m) => `${m.id}=${m.label}`).join(',')}`] : [];
  return [...cs, ...imgs, ...menu].join('|');
}
