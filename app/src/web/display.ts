/**
 * Quai Web : écran des lunettes dessiné dans un canvas, à partir des mêmes conteneurs que l'appareil
 * (layoutPage → ContainerSpec). Chaque caractère est placé à l'abscisse que calcule le micrologiciel LVGL
 * (métriques de @evenrealities/pretext, crénage compris) : colonnes, alignements à droite et coupes « … »
 * tombent exactement comme sur les G2. La forme des lettres vient d'une police du système, resserrée au
 * besoin pour tenir dans la largeur du caractère des lunettes. Le canvas est redessiné à la résolution de
 * l'écran (net à toutes les tailles).
 */
import { getAdvW, getTextWidth } from '@evenrealities/pretext';
import { LINE_H, SCREEN_H, SCREEN_W } from '../glasses/font';
import type { Brightness, ContainerSpec } from '../glasses/types';

/** Vert des lunettes. */
export const GREEN = '#33ff66';
/**
 * Opacité de chaque niveau de luminosité (textColor 0..4), d'après le simulateur Even Hub :
 * niveau 4 → 255, 3 → 230, 2 → 197 (alpha mesuré sur ses captures).
 */
export const LEVEL_ALPHA: Record<Brightness, number> = { 0: 0.52, 1: 0.64, 2: 0.77, 3: 0.9, 4: 1 };
/** Ligne de base sous le haut de chaque ligne de 27 px (lettres capitales de la ligne 6 à 22, comme le simulateur). */
export const BASELINE = 22;
export const FONT_PX = 21;
export const FONT_FAMILY = '"Inter", "Roboto", "Segoe UI", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';
export const FONT = `500 ${FONT_PX}px ${FONT_FAMILY}`;

/** Avance d'un caractère en pixels, arrondie comme LVGL. */
export function advance(cp: number): number {
  return (getAdvW(cp) + 8) >> 4;
}

const positionsCache = new Map<string, number[]>();

/**
 * Abscisse (px) de chaque caractère d'une ligne, au pixel près comme sur les lunettes :
 * position(i) = largeur(caractères 0..i) - avance(i) (le crénage avec le suivant compte dans l'avance d'un caractère).
 */
export function glyphPositions(line: string): number[] {
  const hit = positionsCache.get(line);
  if (hit) return hit;
  const cps = [...line];
  const out: number[] = [];
  let prefix = '';
  for (const ch of cps) {
    prefix += ch;
    out.push(getTextWidth(prefix) - advance(ch.codePointAt(0)!));
  }
  if (positionsCache.size > 600) positionsCache.clear();
  positionsCache.set(line, out);
  return out;
}

/** Mots d'une rangée d'un conteneur et leur abscisse à l'écran (px). */
function wordsAt(c: ContainerSpec | undefined, line: string | undefined): { x: number; t: string }[] {
  if (!c || !line) return [];
  return [...line.matchAll(/\S+/g)].map((m) => ({ x: c.x + getTextWidth(line.slice(0, m.index)), t: m[0] }));
}

/**
 * Texte lisible d'une page, pour les lecteurs d'écran (titre, heure, lignes, aides). 1.2.5 : une rangée en mots clairs
 * et pâles (« Bus W » et « Bruxelles Midi » dans la colonne a, « vers » dans la b, entremêlés) se lit dans l'ordre des
 * mots à l'écran : « Bus W vers Bruxelles Midi, 20 · ~37 min ».
 */
export function describeContainers(cs: readonly ContainerSpec[]): string {
  const box = (name: string) => cs.find((c) => c.name === name);
  const by = (name: string) => box(name)?.content.split('\n') ?? [];
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
  const cursor = by('cursor');
  const [a, b, c] = [by('colA'), by('colB'), by('colC')];
  const rows: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length, c.length); i++) {
    const wa = wordsAt(box('colA'), a[i]);
    const wb = wordsAt(box('colB'), b[i]);
    const xs = (w: { x: number }[]) => w.map((x) => x.x);
    const mixed = wa.length > 0 && wb.length > 0 && Math.min(...xs(wb)) < Math.max(...xs(wa)) && Math.max(...xs(wb)) > Math.min(...xs(wa));
    const cols = mixed ? [[...wa, ...wb].sort((p, q) => p.x - q.x).map((w) => w.t).join(' '), c[i]] : [a[i], b[i], c[i]];
    const row = cols.map((x) => clean(x ?? '')).filter(Boolean).join(', ');
    if (row) rows.push(cursor[i]?.trim() ? `sélection : ${row}` : row);
  }
  return [clean(by('title').join(' ')), clean(by('clock').join(' ')), clean(by('top').join(' ')), ...rows, ...by('foot').map(clean)].filter(Boolean).join('. ');
}

type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'fillRect'
  | 'fillText'
  | 'measureText'
  | 'beginPath'
  | 'rect'
  | 'clip'
  | 'translate'
  | 'scale'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'fill'
> & { font: string; fillStyle: string | CanvasGradient | CanvasPattern; globalAlpha: number; textBaseline: CanvasTextBaseline };

const widthCache = new Map<string, number>();
function glyphWidth(ctx: Ctx2D, ch: string): number {
  const key = `${ctx.font}|${ch}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    w = ctx.measureText(ch).width;
    widthCache.set(key, w);
  }
  return w;
}

/** Symboles des aides et du curseur dessinés en vecteur (jamais remplacés par un émoji du système). */
function drawSymbol(ctx: Ctx2D, ch: string, x: number, baseline: number, adv: number): boolean {
  const poly = (pts: [number, number][]): true => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
    return true;
  };
  /** 1.2.4 : triangle vide (aides des gestes « △▽ ») : le contour seul, une bande de 2 px (pair-impair). */
  const ring = (pts: [number, number][]): true => {
    const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
    const cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    const inner = pts.map(([px, py]): [number, number] => [cx + (px - cx) * 0.66, cy + (py - cy) * 0.66]);
    ctx.beginPath();
    for (const path of [pts, inner]) {
      path.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
    }
    ctx.fill('evenodd');
    return true;
  };
  const w = Math.max(4, adv - 4);
  const l = x + (adv - w) / 2;
  switch (ch) {
    case '△':
      return ring([
        [l + w / 2, baseline - 15],
        [l + w, baseline],
        [l, baseline],
      ]);
    case '▽':
      return ring([
        [l, baseline - 15],
        [l + w, baseline - 15],
        [l + w / 2, baseline],
      ]);
    case '▶': {
      const top = baseline - 17;
      const bottom = baseline + 1;
      return poly([
        [l, top],
        [l + w, (top + bottom) / 2],
        [l, bottom],
      ]);
    }
    case '▲':
      return poly([
        [l + w / 2, baseline - 15],
        [l + w, baseline],
        [l, baseline],
      ]);
    case '▼':
      return poly([
        [l, baseline - 15],
        [l + w, baseline - 15],
        [l + w / 2, baseline],
      ]);
    case '★': {
      const cx = x + adv / 2;
      const cy = baseline - 7.5;
      const pts: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 3.9 : 9;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return poly(pts);
    }
    case '■':
      ctx.fillRect(l + 1, baseline - 14, w - 2, w - 2);
      return true;
    default:
      return false;
  }
}

function drawLine(ctx: Ctx2D, line: string, x0: number, baseline: number): void {
  if (!line.trim()) return;
  const pos = glyphPositions(line);
  const cps = [...line];
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    if (ch === ' ' || ch === ' ') continue;
    const x = x0 + pos[i];
    const adv = advance(ch.codePointAt(0)!);
    if (drawSymbol(ctx, ch, x, baseline, adv)) continue;
    const w = glyphWidth(ctx, ch);
    if (adv > 0 && w > adv) {
      // lettre plus large que celle des lunettes : resserrée, jamais de chevauchement
      ctx.save();
      ctx.translate(x, baseline);
      ctx.scale(adv / w, 1);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(ch, x + (adv - w) / 2, baseline);
    }
  }
}

/** Dessine une page (coordonnées des lunettes : 576 × 288) : fond noir, texte vert, luminosité par conteneur. */
export function drawContainers(ctx: Ctx2D, cs: readonly ContainerSpec[], color = GREEN): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  for (const c of cs) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    ctx.globalAlpha = LEVEL_ALPHA[c.level] ?? 1;
    c.content.split('\n').forEach((line, i) => drawLine(ctx, line, c.x, c.y + i * LINE_H + BASELINE));
    ctx.restore();
  }
  ctx.restore();
}

/** Canvas de l'écran des lunettes : garde la dernière page, la redessine à chaque changement de taille. */
export class GlassesCanvas {
  private cs: ContainerSpec[] = [];
  private frame = 0;
  private readonly observer: ResizeObserver | null;

  /** `watchWindow` : aussi redessiner au redimensionnement de la fenêtre (densité de pixels changée) ; faux pour les aperçus éphémères. */
  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly onPaint?: (cs: readonly ContainerSpec[]) => void,
    watchWindow = true,
  ) {
    this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.schedule()) : null;
    this.observer?.observe(canvas);
    // zoom du navigateur, rotation, autre écran : nouvelle taille ou nouvelle densité de pixels
    if (watchWindow || !this.observer) window.addEventListener('resize', () => this.schedule());
  }

  paint(cs: readonly ContainerSpec[]): void {
    this.cs = cs.map((c) => ({ ...c }));
    this.onPaint?.(this.cs);
    this.schedule();
  }

  get containers(): readonly ContainerSpec[] {
    return this.cs;
  }

  private schedule(): void {
    if (this.frame) return;
    const run = () => {
      this.frame = 0;
      this.draw();
    };
    this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number);
  }

  /** Dessin immédiat (aussi appelé quand le canvas réapparaît). */
  draw(): void {
    const cssW = this.canvas.clientWidth || this.canvas.getBoundingClientRect().width;
    if (!cssW) return;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 4);
    const w = Math.round(cssW * dpr);
    const h = Math.round(w / 2);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(w / SCREEN_W, 0, 0, h / SCREEN_H, 0, 0);
    drawContainers(ctx, this.cs);
  }
}
