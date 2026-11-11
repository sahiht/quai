/**
 * Contrôle au pixel des captures des lunettes (CA-M1.7) : chaque ligne journalisée (QUAI_SCREEN) doit être dessinée
 * à sa place, dans sa colonne, sans débordement ni retour à la ligne du micrologiciel.
 *
 * Pour chaque bande de ligne (27 px), on calcule les segments attendus (début de colonne + largeur mesurée avec la
 * police des lunettes, @evenrealities/pretext) et on vérifie sur la capture : aucun pixel allumé hors des segments
 * (marge de 3 px), chaque segment allumé et son texte dessiné jusqu'au bout (une ligne coupée par le micrologiciel
 * s'arrêterait avant). Écrans contrôlés : accueil, favoris, Aller à… (menus) et étapes.
 */
import { PNG } from 'pngjs';
import { textWidth } from '../../../app/src/glasses/font';
import { GEO, LAYOUTS } from '../../../app/src/glasses/layout';

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

const MENU = new Set(['home', 'favorites', 'places']);
const TOP_STEPS = /^(! |Le plus simple|Le plus rapide|Plus tôt|Sans changement|Moins de changements|À pied|Le suivant|Plus tard)/;
const TOP_HOME = /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/;
const NOTE = /^(~ horaire prévu|Temps réel indisponible|Pas de réseau|Horaires |▼ |▲ trajet précédent|Pas d’autre trajet pour l’instant$)/;

/** Pixels allumés d'une capture RGBA (alpha > 0), par ligne de pixels. */
function litMap(png: Buffer): { w: number; h: number; lit: (x: number, y: number) => boolean } {
  const img = PNG.sync.read(png);
  return { w: img.width, h: img.height, lit: (x, y) => img.data[(y * img.width + x) * 4 + 3] > 0 };
}

const nbsp = (t: string) => t.replace(/ /g, ' ');
const width = (t: string) => textWidth(nbsp(t));

/** Segments attendus d'une ligne de liste selon le gabarit (colonnes séparées par 3 espaces dans le journal). */
function rowSegments(screen: string, line: string): Seg[] {
  const parts = line.split('   ');
  if (MENU.has(screen)) {
    const def = LAYOUTS.menu;
    if (parts.length === 1) return [{ from: def.a.x, to: def.a.x + width(parts[0]), text: parts[0] }];
    const c = parts[parts.length - 1];
    const a = parts.slice(0, -1).join('   ');
    const end = def.c.x + Math.min(def.c.w ?? 0, GEO.X_END - def.c.x) - GEO.SAFETY;
    // alignée à droite par des espaces de 5 px (padLeftTo) : la fin tombe jusqu'à 5 px avant le bord de la colonne
    return [
      { from: def.a.x, to: def.a.x + width(a), text: a },
      { from: end - width(c) - 5, to: end, text: c },
    ];
  }
  const def = LAYOUTS.steps;
  const [a, b, c] = parts;
  const out: Seg[] = [{ from: def.a.x, to: def.a.x + width(a), text: a }];
  if (b !== undefined) out.push({ from: def.b.x, to: def.b.x + width(b), text: b });
  if (c !== undefined) out.push({ from: def.c.x, to: def.c.x + width(c), text: c });
  return out;
}

/**
 * Contrôle une capture. Renvoie la liste des écarts (vide : tout tient). `hints` : l'écran affiche une ligne d'aide
 * (réglage « Aides de gestes »).
 */
export function checkPixels(png: Buffer, s: LoggedScreen): string[] {
  if (!MENU.has(s.screen) && s.screen !== 'steps') return [];
  const { w, h, lit } = litMap(png);
  if (w !== 576 || h !== SCREEN_H) return [`capture ${w} × ${h} au lieu de 576 × 288`];
  const lines = [...s.lines];
  const hasTop = s.screen === 'steps' ? TOP_STEPS.test(lines[0] ?? '') : s.screen === 'home' && TOP_HOME.test(lines[0] ?? '');
  const top = hasTop ? lines.shift()! : undefined;
  const hint = lines.pop();
  const note = lines.length && NOTE.test(lines[lines.length - 1]) ? lines.pop() : undefined;
  const reserve = s.screen !== 'home' && s.screen !== 'places';
  const footLines = (reserve || note ? 1 : 0) + 1;
  const footY = SCREEN_H - GEO.BOTTOM_MARGIN - footLines * LINE_H;
  const rowsY = GEO.TITLE_Y + LINE_H + (hasTop ? LINE_H : 0) + 3;

  const bands: { y: number; segs: Seg[]; label: string }[] = [];
  const clockW = s.clock ? width(s.clock) : 0;
  const clockEnd = GEO.X_END - GEO.SAFETY;
  bands.push({ y: GEO.TITLE_Y, label: 'titre', segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(s.title), text: s.title }, ...(s.clock ? [{ from: clockEnd - clockW, to: clockEnd, text: s.clock }] : [])] });
  if (top !== undefined) bands.push({ y: GEO.TITLE_Y + LINE_H, label: 'ligne du haut', segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(top), text: top }] });
  lines.forEach((l, i) => bands.push({ y: rowsY + i * LINE_H, label: `ligne ${i + 1}`, segs: rowSegments(s.screen, l) }));
  if (note !== undefined) bands.push({ y: footY, label: 'note', segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(note), text: note }] });
  if (hint !== undefined) bands.push({ y: footY + (footLines - 1) * LINE_H, label: 'aide', segs: [{ from: GEO.X_TEXT, to: GEO.X_TEXT + width(hint), text: hint }] });

  const bad: string[] = [];
  for (const b of bands) {
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
    }
  }
  // rien sous la dernière ligne attendue (texte passé à la ligne et poussé vers le bas)
  const lastY = Math.max(...bands.map((b) => b.y)) + LINE_H;
  for (let y = lastY + 1; y < h; y++) for (let x = 0; x < w; x++) if (lit(x, y)) return [...bad, `pixels allumés sous la dernière ligne (y = ${y})`];
  return bad;
}

/** Lignes coupées par « … » (hors libellés qui en contiennent un : « Aller à… », « Calcul du trajet… »). */
export function truncatedLines(s: LoggedScreen): string[] {
  return [s.title, ...s.lines].filter((l) => l.includes('…') && !/Aller à…|Calcul du trajet…|Chargement…/.test(l));
}
