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
 * `levels()` mesure aussi la luminosité de chaque bande (relief : favoris un ton plus pâles que leur titre).
 */
import { PNG } from 'pngjs';
import { textWidth } from '../../../app/src/glasses/font';
import { GEO, HOME_INDENT, LAYOUTS, WIDTHS } from '../../../app/src/glasses/layout';

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
const CHECKED = new Set(['home', 'steps', 'others', 'lines', 'line', ...Object.keys(MENU)]);
const TOP_STEPS = /^(! |Le plus court|Le plus simple|Le plus rapide|Moins de marche|Plus tôt|Sans changement|Moins de changements|À pied|Le suivant|Plus tard)/;
const TOP_HOME = /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/;
const NOTE = /^(~ horaire prévu|\* s’arrête avant le terminus|Temps réel indisponible|Pas de réseau|Horaires |▼ |Fin du trajet\.|▲ trajet précédent|Pas d’autre trajet pour l’instant$)/;
/** Accueil : les lignes qui suivent les favoris (jamais en retrait, même sans ligne vide). */
const HOME_TOOLS = /^(Autour de moi|Gares|Bus, tram, métro)( {3}|$)/;
/** « Bus, tram, métro » : titre d'une ligne choisie (à la marge) ; le reste, ses sens, en retrait. */
const LINE_TITLE = /^((Bus SNCB|Bus|Tram|Métro|Ligne) \S+ · |.+ · toutes les lignes$)/;
/** Ligne d'aide (ou message temporaire de l'accueil) : jamais une ligne de la liste. */
const HINT = /^(▲▼ |toucher |double |★ )/;
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

/** Segments attendus d'une ligne de liste selon le gabarit (colonnes séparées par 3 espaces dans le journal). */
function rowSegments(screen: string, line: string): Seg[] {
  const parts = line.split('   ');
  if (MENU[screen]) {
    const def = LAYOUTS[MENU[screen]];
    if (parts.length === 1) return [{ from: def.a.x, to: def.a.x + width(parts[0]), text: parts[0] }];
    const a = parts.slice(0, -1).join('   ');
    return [{ from: def.a.x, to: def.a.x + width(a), text: a }, rightSeg(def, parts[parts.length - 1])];
  }
  if (screen === 'lines') {
    // titre de la ligne à la marge ; ses sens en retrait, les passages calés au bord droit (comme les favoris)
    if (LINE_TITLE.test(line)) return [{ from: LAYOUTS.lines.a.x, to: LAYOUTS.lines.a.x + width(line), text: line }];
    return indentedSegments(LAYOUTS.lines.b.x, line);
  }
  if (screen === 'line') {
    // détail : « vers … » et « Tous les départs de l’arrêt » à la marge ; un passage en retrait (heure, terminus s'il
    // diffère), son attente dans la colonne d'état
    const def = LAYOUTS.line;
    if (parts.length === 1 && !/^(~?\d\d:\d\d|aucun passage$)/.test(line)) return [{ from: def.a.x, to: def.a.x + width(line), text: line }];
    const out: Seg[] = [{ from: def.b.x, to: def.b.x + width(parts[0]), text: parts[0] }];
    if (parts[1] !== undefined) out.push({ from: def.c.x, to: def.c.x + width(parts[1]), text: parts[1] });
    return out;
  }
  const def = LAYOUTS.steps;
  const [a, b, c] = parts;
  const out: Seg[] = [{ from: def.a.x, to: def.a.x + width(a), text: a }];
  if (b !== undefined) out.push({ from: def.b.x, to: def.b.x + width(b), text: b });
  if (c !== undefined) out.push({ from: def.c.x, to: def.c.x + width(c), text: c });
  return out;
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
  const home = s.screen === 'home';
  const hasTop = s.screen === 'steps' ? TOP_STEPS.test(lines[0] ?? '') : home ? TOP_HOME.test(lines[0] ?? '') : s.screen === 'line' && /^! /.test(lines[0] ?? '');
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
    note = lines.length && NOTE.test(lines[lines.length - 1]) ? lines.pop() : undefined;
    // ligne de note réservée (layout.ts, reserveNote) : partout sauf « Autres trajets » et les menus
    const reserve = !['others', 'keepLine', 'followed'].includes(s.screen);
    footLines = (reserve || note ? 1 : 0) + 1;
  }
  const footY = SCREEN_H - GEO.BOTTOM_MARGIN - footLines * LINE_H;
  const rowsY = GEO.TITLE_Y + LINE_H + (hasTop ? LINE_H : 0) + 3;

  const out: Band[] = [];
  const clockW = s.clock ? width(s.clock) : 0;
  const clockEnd = GEO.X_END - GEO.SAFETY;
  // 1.2.2 : l'état d'un trajet (« Suivi », « Suivre ce trajet ») calé à droite de la ligne du titre
  const [tLeft, tRight] = s.screen === 'steps' ? s.title.split('   ') : [s.title];
  const titleEnd = GEO.X_TEXT + WIDTHS.title;
  const titleSegs: Seg[] = [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(tLeft), text: tLeft }];
  if (tRight) titleSegs.push({ from: titleEnd - width(tRight) - 5, to: titleEnd, text: tRight });
  out.push({ y: GEO.TITLE_Y, label: 'titre', text: s.title, segs: [...titleSegs, ...(s.clock ? [{ from: clockEnd - clockW, to: clockEnd, text: s.clock }] : [])] });
  if (top !== undefined) out.push({ y: GEO.TITLE_Y + LINE_H, label: 'ligne du haut', text: top, segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(top), text: top }] });
  // accueil : les favoris en retrait sont les lignes entre « Favoris » et la ligne vide
  let underFavorites = false;
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
    else segs = rowSegments(s.screen, l);
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
