/**
 * 1.2.10 « Y aller » : contrôle au pixel des écrans du guidage (PRD-1.2.10 § 3.9) et du menu de l'appui long, sur une
 * capture 576 × 288 au format du simulateur (vert, luminosité dans l'alpha) : celle du simulateur Even Hub, ou celle du
 * canvas de Quai Web convertie (`canvasToShot`).
 *
 * Le gabarit exact du guidage appartient à l'équipe des écrans ; ce contrôle ne suppose que le PRD : titre et heure sur
 * la rangée du haut, image (144 × 144, 4 au plus) à gauche sous le titre, texte à x = 196 à côté d'une image, sinon à la
 * marge, aide en bas. Pour chaque ligne journalisée : une bande de texte qui commence à sa colonne et va jusqu'au bout
 * de sa largeur mesurée avec la police des G2 (jamais coupée), dans l'ordre de haut en bas ; aucun pixel allumé ailleurs
 * que dans ces bandes et dans les cadres d'image (aucun texte hors cadre, aucune ligne passée à la ligne) ; une image
 * attendue est dessinée, dans son cadre ; aucun texte sur une image.
 */
import { PNG } from 'pngjs';
import { padLeftTo, textWidth } from '../../../app/src/glasses/font';
import { GEO } from '../../../app/src/glasses/layout';

const W = 576;
const H = 288;
const LINE_H = 27;
const TOL_SIM = 3;
const END_TOL = 9;
/** Colonne du texte à côté d'une image (PRD § 3.9). */
export const X_IMAGE_TEXT = 196;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GuideShot {
  screen: string;
  title: string;
  lines: string[];
  clock?: string;
  /** cadres d'image journalisés (QUAI_SCREEN, champ `images` demandé au contrôleur) */
  images?: Box[];
}

const nbsp = (t: string) => t.replace(/ /g, ' ');
const width = (t: string) => textWidth(nbsp(t));

/** Cadre d'image par défaut quand le journal ne le donne pas : à gauche, sous le titre (PRD § 3.9). */
export const DEFAULT_IMAGE: Box = { x: GEO.X_TEXT - 8, y: GEO.TITLE_Y + LINE_H, w: X_IMAGE_TEXT - (GEO.X_TEXT - 8) - 6, h: 150 };

function read(png: Buffer): { lit: (x: number, y: number) => boolean; w: number; h: number } {
  const img = PNG.sync.read(png);
  return { w: img.width, h: img.height, lit: (x, y) => img.data[(y * img.width + x) * 4 + 3] > 0 };
}

/** Pixels allumés d'une capture (écran calme : aucun). */
export function litCount(png: Buffer): number {
  const { w, h, lit } = read(png);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lit(x, y)) n++;
  return n;
}

/**
 * Canvas de Quai Web (vert #33ff66 sur fond noir, opacité par niveau) → capture au format du simulateur : même vert,
 * luminosité dans l'alpha (le canal vert du canvas : niveau 4 → 255, 3 → 230, 2 → 196).
 */
export function canvasToShot(png: Buffer): Buffer {
  const src = PNG.sync.read(png);
  const out = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / W));
      const sy = Math.min(src.height - 1, Math.floor((y * src.height) / H));
      const g = src.data[(sy * src.width + sx) * 4 + 1];
      const i = (y * W + x) * 4;
      out.data[i] = 0x33;
      out.data[i + 1] = 0xff;
      out.data[i + 2] = 0x66;
      out.data[i + 3] = g;
    }
  return PNG.sync.write(out);
}

type Seg = { from: number; to: number; text: string };

/** Extrémités allumées d'une bande (rangées du cœur des lettres), hors des cadres d'image. */
function extent(lit: (x: number, y: number) => boolean, y0: number, boxes: Box[], xFrom = 0, xTo = W): { min: number; max: number; n: number } {
  let min = W;
  let max = -1;
  let n = 0;
  for (let y = Math.max(0, y0 + 4); y < Math.min(H, y0 + 23); y++)
    for (let x = xFrom; x < xTo; x++) {
      if (!lit(x, y) || boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
      n++;
      if (x < min) min = x;
      if (x > max) max = x;
    }
  return { min, max, n };
}

/**
 * Contrôle d'un écran du guidage ou du menu. `image` : le moment a une image (leave, turn, board, platform). Rend la
 * liste des écarts (vide : tout tient).
 */
export function checkGuidePixels(png: Buffer, s: GuideShot, opts: { image: boolean; tol?: number }): string[] {
  const { w, h, lit } = read(png);
  // canvas de Quai Web : lettres d'une police du système, jusqu'à 4 px plus larges que l'avance des G2 aux extrémités
  const TOL = opts.tol ?? TOL_SIM;
  if (w !== W || h !== H) return [`capture ${w} × ${h} au lieu de ${W} × ${H}`];
  const bad: string[] = [];
  const boxes = s.images?.length ? s.images : opts.image ? [DEFAULT_IMAGE] : [];
  for (const b of boxes) {
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) bad.push(`image hors de l’écran : ${JSON.stringify(b)}`);
    if (b.x + b.w > X_IMAGE_TEXT) bad.push(`image qui déborde sur la colonne du texte (x = ${X_IMAGE_TEXT}) : ${JSON.stringify(b)}`);
  }
  if (opts.image) {
    let n = 0;
    for (const b of boxes) for (let y = b.y; y < Math.min(H, b.y + b.h); y++) for (let x = b.x; x < Math.min(W, b.x + b.w); x++) if (lit(x, y)) n++;
    if (n < 40) bad.push(`image attendue à gauche, cadre vide (${n} pixels allumés)`);
  }
  // rangée du titre : le titre à la marge, l'heure calée à droite (mêmes espaces que layout.ts)
  const explained: { y: number; h?: number; segs: Seg[] }[] = [];
  if (s.title || s.clock) {
    const segs: Seg[] = [];
    if (s.title) segs.push({ from: GEO.X_TEXT, to: GEO.X_TEXT + width(s.title), text: s.title });
    if (s.clock) {
      const from = GEO.X_END - GEO.CLOCK_W + width(padLeftTo(s.clock, GEO.CLOCK_W - GEO.SAFETY)) - width(s.clock);
      segs.push({ from, to: from + width(s.clock), text: s.clock });
    }
    for (const sg of segs) {
      const e = extent(lit, GEO.TITLE_Y, boxes, Math.max(0, Math.floor(sg.from - TOL)), Math.min(W, Math.ceil(sg.to + TOL)));
      if (!e.n) bad.push(`titre : « ${sg.text} » absent`);
      else if (e.max < sg.to - END_TOL) bad.push(`titre : « ${sg.text} » s’arrête à x = ${e.max} au lieu de ${Math.round(sg.to)} (texte coupé ?)`);
    }
    explained.push({ y: GEO.TITLE_Y, segs });
  }
  // lignes : de haut en bas, chacune à sa colonne (196 à côté d'une image, sinon la marge), jusqu'au bout de sa largeur
  let y = GEO.TITLE_Y + LINE_H - 6;
  for (const line of s.lines) {
    if (!line.trim()) continue;
    const lw = width(line);
    let found: { y: number; x0: number } | null = null;
    const fits = (yy: number, x0: number): boolean => {
      const e = extent(lit, yy, boxes);
      return e.n > 0 && Math.abs(e.min - x0) <= TOL + 1 && e.max >= x0 + lw - END_TOL && e.max <= x0 + lw + TOL;
    };
    for (let yy = y; yy <= H - LINE_H + 4 && !found; yy++) {
      for (const x0 of boxes.length ? [X_IMAGE_TEXT, GEO.X_TEXT] : [GEO.X_TEXT]) {
        if (!fits(yy, x0)) continue;
        // la fenêtre convient sur plusieurs rangées de pixels autour de la ligne : on prend le milieu de cette suite
        let end = yy;
        while (end < yy + 14 && fits(end + 1, x0)) end++;
        found = { y: Math.round((yy + end) / 2), x0 };
        break;
      }
    }
    if (!found) {
      bad.push(`« ${line} » introuvable à sa place (colonne ${boxes.length ? `${X_IMAGE_TEXT} ou ${GEO.X_TEXT}` : GEO.X_TEXT}, largeur ${Math.round(lw)} px) : coupé, décalé ou passé à la ligne`);
      continue;
    }
    const overImage = boxes.some((b) => found!.y + 4 < b.y + b.h && found!.y + 23 > b.y && found!.x0 < b.x + b.w);
    if (overImage) bad.push(`« ${line} » écrit sur l’image`);
    // la fenêtre trouvée peut commencer quelques pixels au-dessus de la rangée : accents et jambages compris
    explained.push({ y: found.y - 3, h: LINE_H + 8, segs: [{ from: found.x0, to: found.x0 + lw, text: line }] });
    y = found.y + LINE_H - 4;
  }
  // aucun autre pixel allumé : ni texte hors cadre, ni ligne passée à la ligne, ni reste d'une page précédente
  const stray: string[] = [];
  for (let yy = 0; yy < H && stray.length < 3; yy++)
    for (let x = 0; x < W && stray.length < 3; x++) {
      if (!lit(x, yy)) continue;
      if (boxes.some((b) => x >= b.x && x < b.x + b.w && yy >= b.y && yy < b.y + b.h)) continue;
      if (x < GEO.X_TEXT - 2 && s.screen === 'menu') continue; // curseur ▶ du menu
      const ok = explained.some((e) => yy >= e.y && yy < e.y + (e.h ?? LINE_H) && e.segs.some((sg) => x >= sg.from - TOL && x <= sg.to + TOL));
      if (!ok) stray.push(`(${x}, ${yy})`);
    }
  if (stray.length) bad.push(`pixels allumés hors des lignes journalisées et des images : ${stray.join(', ')}…`);
  return bad;
}
