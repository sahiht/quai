/**
 * Contrôle au pixel des captures des lunettes (CA-M1.7) : chaque ligne journalisée (QUAI_SCREEN) doit être dessinée
 * à sa place, dans sa colonne, sans débordement ni retour à la ligne du micrologiciel.
 *
 * Pour chaque bande de ligne (27 px), on calcule les segments attendus (début de colonne + largeur mesurée avec la
 * police des lunettes, @evenrealities/pretext) et on vérifie sur la capture : aucun pixel allumé hors des segments
 * (marge de 3 px), chaque segment allumé et son texte dessiné jusqu'au bout (une ligne coupée par le micrologiciel
 * s'arrêterait avant). Écrans contrôlés : accueil, « Favoris », étapes et « Autres trajets » ; 1.2.2 : « Gares »,
 * « Bus, tram, métro », le détail d'une ligne, « garder une ligne » et le trajet suivi (« Ne plus suivre »).
 *
 * 1.2.1 : accueil à son propre gabarit (PRD-1.2.1 § 4) : « Favoris » et « Autour de moi » à gauche, leurs nombres à
 * droite ; dessous « Favoris », chaque favori en retrait de 20 px, nom à gauche et réponse calée au bord droit ; une
 * ligne vide (aucun pixel) ; pied compact (le jour férié en dernière ligne quand l'aide est masquée). 1.2.2 : « Gares »
 * et « Bus, tram, métro » sous « Autour de moi », la ligne vide saute d'abord s'il manque une ligne ; sur un trajet,
 * l'état (« Suivi », « Suivre ce trajet ») calé à droite de la ligne du titre ; les sens d'une ligne en retrait, leurs
 * passages calés au bord droit, comme les favoris de l'accueil.
 * « Autres trajets » : nom à gauche et heures à droite, puis la 2e ligne (moyens, pourquoi) à la marge.
 * 1.2.3 : tableau complet (la ligne ★ à la marge, puis ligne, destination, heure dans leurs colonnes) et les arrêts
 * d'un départ (ligne du haut composée sur les colonnes : heure, nom, voie calée à droite ; puis un arrêt par ligne).
 * 1.2.4 (PRD-1.2.4 § 4) : heures alignées à droite (étapes ; case d'heure des arrêts d'un départ, du tableau d'une gare
 * et du détail d'une ligne, le « ~ » dépassant à gauche ; attente des tableaux de bus), mesurées comme layout.ts les
 * pose (espaces de 5 px) ; le nom de l'arrêt ou de la gare sous « Partir à pied » dans la colonne du texte ;
 * « Bus, tram, métro » : intitulés, noms d'arrêts et titres de lignes à la marge, leurs lignes en retrait ; « Dans le
 * train » : l'heure de chaque arrêt sous les autres, même sans état.
 * 1.2.5 (PRD-1.2.5) : « Si tu le rates » en ligne du haut des étapes (§ 1) ; « Bus, tram, métro » en mots clairs et
 * pâles (§ 4) : chaque mot à la place que layout.ts (segRow) lui donne, dans son conteneur, les passages calés à
 * droite ; la ligne de progression en haut de « Dans le train », train compris (§ 7), et sa note (§ 5).
 * `levels()` mesure aussi la luminosité de chaque bande (relief : favoris un ton plus pâles que leur titre) ;
 * `alphaIn()` celle d'une plage de la bande (1.2.5 : « vers » pâle entre la ligne et sa destination au plus clair).
 */
import { PNG } from 'pngjs';
import { padLeftTo, textWidth } from '../../../app/src/glasses/font';
import { GEO, HOME_INDENT, LAYOUTS, TILDE_W, WIDTHS, segRow } from '../../../app/src/glasses/layout';

const LINE_H = 27;
const SCREEN_H = 288;
const TOL = 3;
/** Fin de texte : le dernier pixel allumé peut précéder l'avance du dernier caractère (approche, « . », « : »). */
const END_TOL = 9;

export interface LoggedScreen {
  screen: string;
  title: string;
  lines: string[];
  clock?: string;
  sel?: number;
}

type Seg = { from: number; to: number; text: string };

/** Écrans en liste à une colonne de droite (gabarit de chacun, layout.ts). */
const MENU: Record<string, keyof typeof LAYOUTS> = { favorites: 'favorites', stations: 'stations', keepLine: 'menu', followed: 'menu' };
const CHECKED = new Set(['home', 'steps', 'others', 'lines', 'line', 'board', 'stops', 'train', ...Object.keys(MENU)]);
/** 1.2.3 : ligne du haut d'un tableau (message de l'opérateur, « Départs de demain ») ; sa note, jamais une ligne de liste. */
const TOP_BOARD = /^(! |Départs de demain$)/;
const NOTE_BOARD = /^(~ horaire prévu|Temps réel indisponible|Pas de réseau)/;
/** 1.2.3 : voyage disparu : message (gabarit des messages), non contrôlé ici. */
const VANISHED = 'Ce départ n’est plus dans les horaires.';
const TOP_STEPS = /^(! |Si tu le rates |Le plus court|Le plus simple|Le plus rapide|Moins de marche|Plus tôt|Sans changement|Moins de changements|À pied|Le suivant|Plus tard)/;
const TOP_HOME = /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/;
const NOTE = /^(~ horaire prévu|\* s’arrête avant le terminus|Temps réel indisponible|Temps réel coupé|Pas de réseau|Horaires |[▼▽] |Fin du trajet\.|[▲△] trajet précédent|Pas d’autre trajet pour l’instant$)/;
/** 1.2.5 (PRD-1.2.5 § 7) : « Dans le train », tous les véhicules : la ligne de progression en ligne du haut. */
const TOP_TRAIN = /^[●◎○─…]+ {3}descente (au prochain arrêt|dans \d+ arrêts)$/;
/** 1.2.5 (PRD-1.2.5 § 4) : rangée en mots clairs et pâles de « Bus, tram, métro » (« Bus W vers Bruxelles Midi   20 min »). */
export const SEG_ROW = /^(Bus SNCB|Bus|Tram|Métro|Ligne) \S+ vers /;
/** Accueil : les lignes qui suivent les favoris (jamais en retrait, même sans ligne vide). */
const HOME_TOOLS = /^(Autour de moi|Gares|Bus, tram, métro)( {3}|$)/;
/** « Bus, tram, métro » : titre d'une ligne choisie (à la marge) ; le reste, ses sens, en retrait. */
const LINE_TITLE = /^((Bus SNCB|Bus|Tram|Métro|Ligne) \S+ · |.+ · toutes les lignes$)/;
/** Ligne d'aide (ou message temporaire de l'accueil) : jamais une ligne de la liste. */
const HINT = /^([▲△][▼▽] |toucher |double |★ )/;
/** Note de l'accueil (1.2.1 § 4.7) : le jour férié, dernière ligne quand l'aide est masquée. */
const HOME_NOTE = /^Jour férié /;

/** Pixels allumés d'une capture RGBA (alpha > 0), par ligne de pixels. */
function litMap(png: Buffer): { w: number; h: number; lit: (x: number, y: number) => boolean; alpha: (x: number, y: number) => number } {
  const img = PNG.sync.read(png);
  const alpha = (x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
  return { w: img.width, h: img.height, lit: (x, y) => alpha(x, y) > 0, alpha };
}

const nbsp = (t: string) => t.replace(/ /g, '\u00a0');
const width = (t: string) => textWidth(nbsp(t));

/** Colonne de droite alignée à droite par des espaces de 5 px (padLeftTo) : la fin tombe jusqu'à 5 px avant le bord. */
function rightSeg(def: { c: { x: number; w?: number } }, text: string): Seg {
  const end = def.c.x + Math.min(def.c.w ?? 0, GEO.X_END - def.c.x) - GEO.SAFETY;
  return { from: end - width(text) - 5, to: end, text };
}

/** 1.2.4 : texte aligné à droite dans `room` px depuis `x`, par les mêmes espaces que layout.ts (padLeftTo). */
function padSeg(x: number, room: number, text: string): Seg {
  const from = x + width(padLeftTo(text, room)) - width(text);
  return { from, to: from + width(text), text };
}

const TIME = /^(~?\d\d:\d\d)(.*)$/;

/**
 * 1.2.4 : case d'heure (Col.lead, leadCell) : l'heure alignée à droite dans `slot` px, le « ~ » dépassant à gauche,
 * puis la suite ; sans décalage si le tout ne tient pas avec la case. Sans heure (« aucun passage »), le texte commence
 * avec les chiffres, après la place du « ~ ». Le journal est sans les espaces d'alignement.
 */
function leadSeg(x: number, slot: number, room: number, cell: string): Seg {
  const m = TIME.exec(cell);
  let pad = width(' '.repeat(Math.round(TILDE_W / 5)));
  if (m) {
    const padded = padLeftTo(m[1], Math.min(slot, room));
    pad = width(padded + m[2]) <= room ? width(padded) - width(m[1]) : 0;
  }
  return { from: x + pad, to: x + pad + width(cell), text: cell };
}

/** Place d'une colonne jusqu'à la suivante (layout.ts, room) : bord de la colonne c, moins l'écart et la marge. */
const roomTo = (def: { c: { x: number }; gap?: number }, x: number): number => def.c.x - (def.gap ?? GEO.GAP) - x - GEO.SAFETY;
const roomIn = (c: { x: number; w?: number }): number => Math.min(c.w ?? 0, GEO.X_END - c.x) - GEO.SAFETY;

/** Segments attendus d'une ligne de liste selon le gabarit (colonnes séparées par 3 espaces dans le journal). */
function rowSegments(screen: string, line: string, indented = false): Seg[] {
  const parts = line.split('   ');
  if (MENU[screen]) {
    const def = LAYOUTS[MENU[screen]];
    if (parts.length === 1) return [{ from: def.a.x, to: def.a.x + width(parts[0]), text: parts[0] }];
    const a = parts.slice(0, -1).join('   ');
    return [{ from: def.a.x, to: def.a.x + width(a), text: a }, rightSeg(def, parts[parts.length - 1])];
  }
  if (screen === 'lines') {
    // intitulés, noms d'arrêts et titres de lignes à la marge ; leurs lignes en retrait (espaces de 5 px, subIndent),
    // les passages d'un sens calés au bord droit (comme les favoris). 1.2.5 : rangées en mots clairs et pâles.
    const def = LAYOUTS.lines;
    if (SEG_ROW.test(line)) return segRowSegments(line, indented ? (def.subIndent ?? 0) : 0);
    if (!indented) return [{ from: def.a.x, to: def.a.x + width(line), text: line }];
    return indentedSegments(def.b.x + width(' '.repeat(Math.round((def.subIndent ?? 0) / 5))), line);
  }
  if (screen === 'board' || screen === 'boardTrain') {
    // 1.2.3 : la ligne ★ (ou « aucun départ ») à la marge ; un départ : ligne, destination, heure dans leurs colonnes.
    // 1.2.4 : l'attente d'un bus calée à droite ; l'heure d'un train dans sa case (« ~ » à gauche), puis la voie.
    const def = LAYOUTS[screen];
    if (parts.length === 1) return [{ from: def.a.x, to: def.a.x + width(line), text: line }];
    const [a, b, c] = parts;
    const out: Seg[] = [{ from: def.a.x, to: def.a.x + width(a), text: a }];
    if (b !== undefined) out.push({ from: def.b.x, to: def.b.x + width(b), text: b });
    if (c !== undefined) out.push(def.c.lead ? leadSeg(def.c.x, def.c.lead, roomIn(def.c), c) : padSeg(def.c.x, roomIn(def.c), c));
    return out;
  }
  if (screen === 'stops') {
    // 1.2.3 : un arrêt : heure (retard), nom, puis la voie ou « SUPPRIMÉ » calée au bord droit de sa colonne.
    // 1.2.4 : l'heure dans sa case (« ~ » à gauche).
    const def = LAYOUTS.stops;
    const [a, b, c] = parts;
    const out: Seg[] = [leadSeg(def.a.x, def.a.lead ?? 0, roomIn(def.a), a)];
    if (b !== undefined) out.push({ from: def.b.x, to: def.b.x + width(b), text: b });
    if (c !== undefined) out.push(rightSeg(def, c));
    return out;
  }
  if (screen === 'train') {
    // 1.2.4 : « Dans le train » : l'arrêt, son heure calée à droite de sa colonne (même sans état), puis l'état
    const def = LAYOUTS.train;
    const [a, b, c] = parts;
    const out: Seg[] = [{ from: def.a.x, to: def.a.x + width(a), text: a }];
    if (b !== undefined) out.push(padSeg(def.b.x, roomIn(def.b), b));
    if (c !== undefined) out.push({ from: def.c.x, to: def.c.x + width(c), text: c });
    return out;
  }
  if (screen === 'line') {
    // détail : « vers … » et « Tous les départs de l’arrêt » à la marge ; un passage (heure dans sa case, « ~ » dans le
    // retrait ; terminus s'il diffère), son attente dans la colonne d'état
    const def = LAYOUTS.line;
    if (parts.length === 1 && !/^(~?\d\d:\d\d|aucun passage$)/.test(line)) return [{ from: def.a.x, to: def.a.x + width(line), text: line }];
    const room = parts[1] !== undefined ? roomTo(def, def.b.x) : GEO.X_END - def.b.x - GEO.SAFETY;
    const out: Seg[] = [leadSeg(def.b.x, def.b.lead ?? 0, room, parts[0])];
    if (parts[1] !== undefined) out.push({ from: def.c.x, to: def.c.x + width(parts[1]), text: parts[1] });
    return out;
  }
  const def = LAYOUTS.steps;
  // 1.2.4 : sous « Partir à pied vers l'arrêt » (ou un trajet qui commence à bord), le nom seul, dans la colonne du texte
  if (parts.length === 1 && !TIME.test(line)) return [{ from: def.b.x, to: def.b.x + width(line), text: line }];
  const [a, b, c] = parts;
  // 1.2.4 : l'heure calée à droite de sa colonne (« ~ » à gauche) dès qu'un texte la suit
  const out: Seg[] = [b !== undefined || c !== undefined ? padSeg(def.a.x, roomIn(def.a), a) : { from: def.a.x, to: def.a.x + width(a), text: a }];
  if (b !== undefined) out.push({ from: def.b.x, to: def.b.x + width(b), text: b });
  if (c !== undefined) out.push({ from: def.c.x, to: def.c.x + width(c), text: c });
  return out;
}

/**
 * 1.2.4 : « Bus, tram, métro » : lignes en retrait de la page, d'après leur ordre. 1.2.5 (PRD-1.2.5 § 4) : « ARRÊTS » :
 * un nom d'arrêt (pâle, à la marge) puis ses départs (en retrait) ; « LIGNES » : une rangée par sens (à la marge), puis
 * l'arrêt (pâle, en retrait) ; sens pas encore connus : le titre de la 1.2.4 et ses lignes en retrait. Une page
 * commence toujours par un élément entier (ou son intitulé).
 */
function linesIndented(lines: string[]): boolean[] {
  let block: 'stops' | 'lines' | undefined;
  return lines.map((l) => {
    if (l === 'ARRÊTS' || l === 'LIGNES') {
      block = l === 'ARRÊTS' ? 'stops' : 'lines';
      return false;
    }
    if (LINE_TITLE.test(l)) {
      block = 'lines';
      return false;
    }
    block ??= 'stops';
    const sub = /^(…|aucun passage|introuvable)/.test(l);
    if (block === 'stops') return sub || SEG_ROW.test(l);
    return !SEG_ROW.test(l);
  });
}

/**
 * 1.2.5 : segments d'une rangée en mots clairs et pâles, placés comme segRow (layout.ts) les pose : la ligne
 * (« Bus W ») et la destination dans le conteneur clair, « vers » dans le pâle, deux espaces entre deux conteneurs ;
 * les passages calés à droite de la colonne c. Le journal joint les mots par une espace : on le redécoupe.
 */
function segRowSegments(line: string, indentPx: number): Seg[] {
  const def = LAYOUTS.lines;
  const parts = line.split('   ');
  const right = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const left = parts.length > 1 ? parts.slice(0, -1).join('   ') : line;
  const m = /^(.+?) vers (.+)$/.exec(left);
  const r = segRow(m ? [{ t: nbsp(m[1]), hi: true }, { t: 'vers' }, { t: nbsp(m[2]), hi: true }] : [{ t: nbsp(left) }], indentPx, right === undefined ? undefined : nbsp(right), def);
  const out: Seg[] = [];
  for (const [x0, content] of [
    [def.a.x, r.a],
    [def.b.x, r.b],
  ] as const) {
    // des mots séparés par deux espaces ou plus : un segment chacun
    for (const run of content.matchAll(/\S+(?: \S+)*/g)) {
      const from = x0 + textWidth(content.slice(0, run.index));
      out.push({ from, to: from + textWidth(run[0]), text: run[0] });
    }
  }
  if (r.c.trim()) out.push({ from: def.c.x + textWidth(r.c) - textWidth(r.c.trim()), to: def.c.x + textWidth(r.c), text: r.c.trim() });
  return out.sort((p, q) => p.from - q.from);
}

/**
 * 1.2.5 : luminosité (alpha des captures) des pixels pleinement dessinés d'une plage de x dans la bande de la ligne
 * journalisée `text` : la plus haute valeur qui revient souvent ; -1 si la ligne n'est pas à l'écran.
 */
export function alphaIn(png: Buffer, s: LoggedScreen, text: string, from: number, to: number): number {
  const all = bands(s);
  const b = all?.find((x) => x.text === text);
  if (!b) return -1;
  const { w, h, alpha } = litMap(png);
  const count = new Map<number, number>();
  for (let y = Math.max(0, b.y + 2); y < Math.min(h, b.y + LINE_H - 1); y++)
    for (let x = Math.max(0, Math.floor(from)); x < Math.min(w, Math.ceil(to)); x++) {
      const a = alpha(x, y);
      if (a) count.set(a, (count.get(a) ?? 0) + 1);
    }
  const total = [...count.values()].reduce((p, q) => p + q, 0);
  const strong = [...count.entries()].filter(([, n]) => n >= total * 0.1).map(([a]) => a);
  return strong.length ? Math.max(...strong) : 0;
}

/** 1.2.5 : segments attendus d'une ligne journalisée de « Bus, tram, métro » (pour alphaIn). */
export function lineSegments(s: LoggedScreen, text: string): Seg[] {
  return bands(s)?.find((x) => x.text === text)?.segs ?? [];
}

/** Ligne en retrait (favori de l'accueil, sens d'une ligne) : texte à gauche, et le reste calé au bord droit. */
function indentedSegments(x: number, line: string): Seg[] {
  const parts = line.split('   ');
  const end = GEO.X_END - GEO.SAFETY;
  if (parts.length === 1) return [{ from: x, to: x + width(parts[0]), text: parts[0] }];
  const left = parts.slice(0, -1).join('   ');
  const right = parts[parts.length - 1];
  return [
    { from: x, to: x + width(left), text: left },
    { from: end - width(right) - 5, to: end, text: right },
  ];
}

/** Accueil : ligne de menu (« Favoris   4 ») ou favori en retrait (nom, puis réponse calée au bord droit). */
function homeSegments(line: string, indented: boolean): Seg[] {
  const def = LAYOUTS.home;
  if (!line) return [];
  const parts = line.split('   ');
  if (indented) return indentedSegments(def.b.x, line);
  if (parts.length === 1) return [{ from: def.a.x, to: def.a.x + width(parts[0]), text: parts[0] }];
  const a = parts.slice(0, -1).join('   ');
  return [{ from: def.a.x, to: def.a.x + width(a), text: a }, rightSeg(def, parts[parts.length - 1])];
}

/** « Autres trajets » : 1re ligne d'une entrée (nom, heures à droite) ou 2e ligne (moyens, pourquoi). */
function othersSegments(line: string, second: boolean): Seg[] {
  const def = LAYOUTS.others;
  if (second) return [{ from: def.b.x, to: def.b.x + width(line), text: line }];
  const parts = line.split('   ');
  if (parts.length === 1) return [{ from: def.a.x, to: def.a.x + width(parts[0]), text: parts[0] }];
  const a = parts.slice(0, -1).join('   ');
  return [{ from: def.a.x, to: def.a.x + width(a), text: a }, rightSeg(def, parts[parts.length - 1])];
}

interface Band {
  y: number;
  segs: Seg[];
  label: string;
  /** Ligne journalisée (vide : la ligne vide de l'accueil). */
  text: string;
}

/** Bandes attendues d'une capture (position, segments), selon la géométrie de layout.ts. */
function bands(s: LoggedScreen): Band[] | null {
  if (!CHECKED.has(s.screen)) return null;
  const lines = [...s.lines];
  // « Autres trajets » sans autre proposition : message (gabarit des messages), non contrôlé ici
  if (s.screen === 'others' && lines[0] === 'Pas d’autre trajet pour l’instant') return null;
  // 1.2.3 : arrêts d'un départ disparu, ou en chargement : messages
  if (s.screen === 'stops' && (lines[0] === VANISHED || /^Chargement/.test(lines[0] ?? ''))) return null;
  if (s.screen === 'board' && /^Chargement/.test(lines[0] ?? '')) return null;
  const home = s.screen === 'home';
  const board = s.screen === 'board';
  const hasTop =
    s.screen === 'steps'
      ? TOP_STEPS.test(lines[0] ?? '')
      : home
        ? TOP_HOME.test(lines[0] ?? '')
        : board
          ? TOP_BOARD.test(lines[0] ?? '')
          : s.screen === 'train'
            ? TOP_TRAIN.test(lines[0] ?? '')
            : s.screen === 'stops' || (s.screen === 'line' && /^! /.test(lines[0] ?? ''));
  const top = hasTop ? lines.shift()! : undefined;
  let hint: string | undefined;
  let note: string | undefined;
  let footLines: number;
  if (home) {
    // pied compact (1.2.1) : l'aide seulement les 7 premiers jours ; sous le jour férié, pas de ligne d'aide vide
    if (lines.length && HINT.test(lines[lines.length - 1])) hint = lines.pop();
    if (lines.length && HOME_NOTE.test(lines[lines.length - 1])) note = lines.pop();
    footLines = (note !== undefined ? 1 : 0) + (note !== undefined && hint === undefined ? 0 : 1);
  } else {
    hint = lines.pop();
    note = lines.length && (board ? NOTE_BOARD : NOTE).test(lines[lines.length - 1]) ? lines.pop() : undefined;
    // ligne de note réservée (layout.ts, reserveNote) : partout sauf « Autres trajets », les menus et « Dans le train »
    const reserve = !['others', 'keepLine', 'followed', 'train'].includes(s.screen);
    footLines = (reserve || note ? 1 : 0) + 1;
  }
  const footY = SCREEN_H - GEO.BOTTOM_MARGIN - footLines * LINE_H;
  const rowsY = GEO.TITLE_Y + LINE_H + (hasTop ? LINE_H : 0) + 3;

  const out: Band[] = [];
  // l'heure du titre, calée à droite de son conteneur par les mêmes espaces que layout.ts
  const clockSeg = s.clock ? padSeg(GEO.X_END - GEO.CLOCK_W, GEO.CLOCK_W - GEO.SAFETY, s.clock) : undefined;
  // 1.2.2 : l'état d'un trajet (« Suivi », « Suivre ce trajet ») calé à droite de la ligne du titre
  const [tLeft, tRight] = s.screen === 'steps' ? s.title.split('   ') : [s.title];
  const titleEnd = GEO.X_TEXT + WIDTHS.title;
  const titleSegs: Seg[] = [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(tLeft), text: tLeft }];
  if (tRight) titleSegs.push({ from: titleEnd - width(tRight) - 5, to: titleEnd, text: tRight });
  out.push({ y: GEO.TITLE_Y, label: 'titre', text: s.title, segs: [...titleSegs, ...(clockSeg ? [clockSeg] : [])] });
  if (top !== undefined) {
    // 1.2.3 : arrêts d'un départ : l'arrêt du tableau composé sur les colonnes de la liste (voie calée au bord droit) ;
    // 1.2.4 : son heure dans la case, comme celles dessous
    const tp = top.split('   ');
    const st = LAYOUTS.stops;
    const segs =
      s.screen === 'stops' && tp.length > 1
        ? [
            leadSeg(GEO.X_TEXT, st.a.lead ?? 0, st.b.x - (st.gap ?? GEO.GAP) - GEO.X_TEXT - GEO.SAFETY, tp[0]),
            { from: st.b.x, to: st.b.x + width(tp[1]), text: tp[1] },
            ...(tp[2] !== undefined ? [{ from: GEO.X_END - GEO.SAFETY - width(tp[2]) - 5, to: GEO.X_END - GEO.SAFETY, text: tp[2] }] : []),
          ]
        : [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(top), text: top }];
    out.push({ y: GEO.TITLE_Y + LINE_H, label: 'ligne du haut', text: top, segs });
  }
  // accueil : les favoris en retrait sont les lignes entre « Favoris » et la ligne vide
  let underFavorites = false;
  const indented = s.screen === 'lines' ? linesIndented(lines) : [];
  lines.forEach((l, i) => {
    let segs: Seg[];
    if (home) {
      if (/^Favoris( |$)/.test(l)) {
        segs = homeSegments(l, false);
        underFavorites = true;
      } else if (!l || HOME_TOOLS.test(l)) {
        segs = homeSegments(l, false);
        underFavorites = false;
      } else segs = homeSegments(l, underFavorites);
    } else if (s.screen === 'others') segs = othersSegments(l, i % 2 === 1);
    else if (board) segs = rowSegments(/\(SNCB\)( ★)?$/.test(s.title) ? 'boardTrain' : 'board', l);
    else segs = rowSegments(s.screen, l, indented[i]);
    out.push({ y: rowsY + i * LINE_H, label: `ligne ${i + 1}`, text: l, segs });
  });
  if (note !== undefined) out.push({ y: footY, label: 'note', text: note, segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(note), text: note }] });
  if (hint !== undefined) out.push({ y: footY + (footLines - 1) * LINE_H, label: 'aide', text: hint, segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(hint), text: hint }] });
  return out;
}

/**
 * Contrôle une capture. Renvoie la liste des écarts (vide : tout tient).
 */
export function checkPixels(png: Buffer, s: LoggedScreen): string[] {
  const all = bands(s);
  if (!all) return [];
  const { w, h, lit } = litMap(png);
  if (w !== 576 || h !== SCREEN_H) return [`capture ${w} × ${h} au lieu de 576 × 288`];

  const bad: string[] = [];
  for (const b of all) {
    // colonne du curseur « ▶ » (x < 27) exclue ; bande réduite de 2 px en haut et en bas (accents, jambages voisins)
    const xs = new Set<number>();
    for (let y = Math.max(0, b.y + 2); y < Math.min(h, b.y + LINE_H - 1); y++) for (let x = GEO.X_TEXT - 1; x < w; x++) if (lit(x, y)) xs.add(x);
    const inSeg = (x: number) => b.segs.some((sg) => x >= sg.from - TOL && x <= sg.to + TOL);
    const stray = [...xs].filter((x) => !inSeg(x)).sort((p, q) => p - q);
    if (stray.length) bad.push(`${b.label} « ${b.segs.map((sg) => sg.text).join(' | ')} » : pixels hors colonne x = ${stray[0]}…${stray[stray.length - 1]}`);
    for (const sg of b.segs) {
      if (!sg.text.trim()) continue;
      const mine = [...xs].filter((x) => x >= sg.from - TOL && x <= sg.to + TOL);
      if (!mine.length) {
        bad.push(`${b.label} : « ${sg.text} » absent (x ${Math.round(sg.from)} à ${Math.round(sg.to)})`);
        continue;
      }
      const right = Math.max(...mine);
      if (right < sg.to - END_TOL) bad.push(`${b.label} : « ${sg.text} » s'arrête à x = ${right} au lieu de ${Math.round(sg.to)} (texte coupé ?)`);
      const left = Math.min(...mine);
      // texte décalé (retrait de l'accueil) : il commence dans les premiers pixels de son segment
      if (left > sg.from + END_TOL && sg.to - sg.from > 2 * END_TOL) bad.push(`${b.label} : « ${sg.text} » commence à x = ${left} au lieu de ${Math.round(sg.from)}`);
    }
  }
  // rien sous la dernière ligne attendue (texte passé à la ligne et poussé vers le bas)
  const lastY = Math.max(...all.map((b) => b.y)) + LINE_H;
  for (let y = lastY + 1; y < h; y++) for (let x = 0; x < w; x++) if (lit(x, y)) return [...bad, `pixels allumés sous la dernière ligne (y = ${y})`];
  return bad;
}

/**
 * Luminosité de chaque ligne journalisée d'une capture (relief, PRD-1.2.1 § 4.4) : valeur alpha la plus fréquente des
 * pixels pleinement dessinés de la bande (le cœur des traits, sans l'anticrénelage), par texte de ligne. Les
 * captures du simulateur codent la luminosité du conteneur dans l'alpha des pixels.
 */
export function levels(png: Buffer, s: LoggedScreen): { text: string; label: string; alpha: number; x0: number }[] {
  const all = bands(s);
  if (!all) return [];
  const { w, h, alpha } = litMap(png);
  return all
    .filter((b) => b.segs.length)
    .map((b) => {
      const count = new Map<number, number>();
      let x0 = w;
      for (let y = Math.max(0, b.y + 2); y < Math.min(h, b.y + LINE_H - 1); y++)
        for (let x = GEO.X_TEXT - 1; x < w; x++) {
          const a = alpha(x, y);
          if (!a) continue;
          x0 = Math.min(x0, x);
          count.set(a, (count.get(a) ?? 0) + 1);
        }
      // l'alpha du cœur des traits : la valeur la plus haute qui revient souvent (au moins 10 % des pixels allumés)
      const total = [...count.values()].reduce((p, q) => p + q, 0);
      const strong = [...count.entries()].filter(([, n]) => n >= total * 0.1).map(([a]) => a);
      return { text: b.text, label: b.label, alpha: strong.length ? Math.max(...strong) : 0, x0 };
    });
}

/** Lignes coupées par « … » (hors libellés qui en contiennent un : « Aller à… » du message « Quai 1.2.2 », « Calcul du trajet… »). */
export function truncatedLines(s: LoggedScreen): string[] {
  return [s.title, ...s.lines].filter((l) => l.includes('…') && !/Aller à…|Calcul du trajet…|Chargement…/.test(l));
}

export { HOME_INDENT };
