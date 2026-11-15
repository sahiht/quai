/**
 * 1.2.10 (PRD-1.2.10 § 3.9) : images des écrans du guidage, en 16 niveaux de vert (0 éteint, 15 au plus clair).
 *
 *  - flèche d'un virage (`turn`) : flèche pleine et coudée, trait de 16 px dans 144 × 144, comme une flèche de
 *    navigation ; les virages à droite sont exactement le miroir des virages à gauche ;
 *  - panneau (`sign`) : cadre arrondi au plus clair, petit mot pâle en haut (« bus », « voie », « à pied »), grand
 *    chiffre au plus clair (« 6 », « 12 », « IC »), petit mot pâle en bas (« min ») ;
 *  - flèche à vol d'oiseau (`bearing`) : la direction de la cible, en degrés (0 = devant, sens horaire).
 *
 * Rendu pur et déterministe : mêmes octets dans l'appli Even, dans Quai Web, dans le navigateur et dans les tests. Les
 * formes sont vectorielles (segments épais à bouts ronds, polygones, cadre arrondi), échantillonnées 4 × 4 fois par
 * pixel ; seules les quatre opérations sont utilisées (pas de sin, cos ni sqrt de la bibliothèque, dont les derniers
 * bits peuvent varier d'un moteur JavaScript à l'autre). La police est tracée ici, en traits.
 */
import type { TurnKind } from '../core/guide-types';
import type { ImageKind, ImageSpec } from './types';

/** Niveaux de vert des images : au plus clair, et pâle (petits mots des panneaux). */
export const IMAGE_LEVEL = { strong: 15, pale: 10 } as const;
/** Taille de référence des images du guidage (PRD § 3.9) ; les autres tailles sont mises à l'échelle. */
export const IMAGE_BOX = 144;
/** Limites d'un conteneur d'image du SDK. */
export const IMAGE_MAX_W = 288;
export const IMAGE_MAX_H = 144;

/* ------------------------------ Trigonométrie reproductible ------------------------------ */

const PI = 3.141592653589793;

function series(r: number): [number, number] {
  const x = (r * PI) / 180;
  const x2 = x * x;
  const s = x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - x2 / 156))))));
  const c = 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - (x2 / 30) * (1 - (x2 / 56) * (1 - (x2 / 90) * (1 - (x2 / 132) * (1 - x2 / 182))))));
  return [s, c];
}

/** [sin, cos] d'un angle en degrés, arrondi au degré : série sur [0°, 45°], symétries exactes ailleurs (sin 90° = 1). */
export function sinCosDeg(deg: number): [number, number] {
  let d = Number.isFinite(deg) ? Math.round(deg) % 360 : 0;
  if (d < 0) d += 360;
  const q = Math.floor(d / 90);
  const r = d - q * 90;
  let s: number;
  let c: number;
  if (r <= 45) [s, c] = series(r);
  else {
    const [s2, c2] = series(90 - r);
    s = c2;
    c = s2;
  }
  switch (q) {
    case 0:
      return [s, c];
    case 1:
      return [c, -s];
    case 2:
      return [-s, -c];
    default:
      return [-c, s];
  }
}

/* ------------------------------ Rastérisation ------------------------------ */

type Pt = readonly [number, number];
/** Segment épais à bouts ronds (un point seul : un rond). */
interface Capsule { k: 'cap'; ax: number; ay: number; bx: number; by: number; r: number }
/** Polygone plein (règle pair-impair). */
interface Poly { k: 'poly'; pts: Pt[] }
/** Cadre arrondi : rectangle extérieur (x, y, w, h), rayon des coins r, épaisseur t. */
interface Ring { k: 'ring'; x: number; y: number; w: number; h: number; r: number; t: number }
type Shape = Capsule | Poly | Ring;
interface Layer { level: number; shapes: Shape[] }

/** Sous-échantillons par côté de pixel (16 par pixel : 17 couvertures, ramenées à 0..niveau). */
const SS = 4;

function bounds(s: Shape): [number, number, number, number] {
  switch (s.k) {
    case 'cap':
      return [Math.min(s.ax, s.bx) - s.r, Math.min(s.ay, s.by) - s.r, Math.max(s.ax, s.bx) + s.r, Math.max(s.ay, s.by) + s.r];
    case 'poly': {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of s.pts) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      return [x0, y0, x1, y1];
    }
    case 'ring':
      return [s.x, s.y, s.x + s.w, s.y + s.h];
  }
}

function inRoundRect(px: number, py: number, x: number, y: number, w: number, h: number, r: number): boolean {
  if (w <= 0 || h <= 0 || px < x || px > x + w || py < y || py > y + h) return false;
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const cx = px < x + rr ? x + rr : px > x + w - rr ? x + w - rr : px;
  const cy = py < y + rr ? y + rr : py > y + h - rr ? y + h - rr : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= rr * rr;
}

function inside(s: Shape, px: number, py: number): boolean {
  switch (s.k) {
    case 'cap': {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - (s.ax + t * dx);
      const ey = py - (s.ay + t * dy);
      return ex * ex + ey * ey <= s.r * s.r;
    }
    case 'poly': {
      let hit = false;
      const p = s.pts;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i];
        const [xj, yj] = p[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    }
    case 'ring':
      return inRoundRect(px, py, s.x, s.y, s.w, s.h, s.r) && !inRoundRect(px, py, s.x + s.t, s.y + s.t, s.w - 2 * s.t, s.h - 2 * s.t, s.r - s.t);
  }
}

function fillShape(bits: Uint8Array, W: number, H: number, s: Shape): void {
  const [x0, y0, x1, y1] = bounds(s);
  if (!(x1 >= x0 && y1 >= y0)) return;
  const i0 = Math.max(0, Math.floor(x0 * SS));
  const i1 = Math.min(W - 1, Math.ceil(x1 * SS));
  const j0 = Math.max(0, Math.floor(y0 * SS));
  const j1 = Math.min(H - 1, Math.ceil(y1 * SS));
  for (let j = j0; j <= j1; j++) {
    const py = (j + 0.5) / SS;
    const row = j * W;
    for (let i = i0; i <= i1; i++) {
      if (bits[row + i]) continue;
      if (inside(s, (i + 0.5) / SS, py)) bits[row + i] = 1;
    }
  }
}

/** Couches dessinées l'une après l'autre ; dans une couche, les formes s'unissent ; entre couches, le plus clair gagne. */
function rasterize(w: number, h: number, layers: Layer[]): Uint8Array {
  const W = w * SS;
  const H = h * SS;
  const out = new Uint8Array(w * h);
  const bits = new Uint8Array(W * H);
  for (const layer of layers) {
    if (!layer.shapes.length || layer.level <= 0) continue;
    bits.fill(0);
    for (const s of layer.shapes) fillShape(bits, W, H, s);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let j = 0; j < SS; j++) {
          const row = (y * SS + j) * W + x * SS;
          for (let i = 0; i < SS; i++) n += bits[row + i];
        }
        if (!n) continue;
        const v = Math.round((n * layer.level) / (SS * SS));
        if (v > out[y * w + x]) out[y * w + x] = v;
      }
    }
  }
  return out;
}

/** Miroir gauche-droite d'une image (virage à droite = miroir du virage à gauche, au pixel près). */
export function flipH(px: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = px[y * w + (w - 1 - x)];
  return out;
}

/**
 * Image symétrique gauche-droite à partir de sa moitié gauche (flèche droit devant, cible devant ou derrière) : un
 * échantillon posé exactement sur un bord oblique n'est pas compté de la même façon des deux côtés.
 */
function symmetrize(px: Uint8Array, w: number, h: number): Uint8Array {
  for (let y = 0; y < h; y++) for (let x = Math.ceil(w / 2); x < w; x++) px[y * w + x] = px[y * w + (w - 1 - x)];
  return px;
}

const cap = (a: Pt, b: Pt, r: number): Capsule => ({ k: 'cap', ax: a[0], ay: a[1], bx: b[0], by: b[1], r });

/** Trait épais le long d'une ligne brisée (jointures rondes). */
function polyline(pts: Pt[], r: number): Capsule[] {
  if (pts.length === 1) return [cap(pts[0], pts[0], r)];
  const out: Capsule[] = [];
  for (let i = 1; i < pts.length; i++) out.push(cap(pts[i - 1], pts[i], r));
  return out;
}

/* ------------------------------ Police tracée ------------------------------ */

/**
 * Glyphe en unités : ligne de base y = 0, y vers le haut, capitales et chiffres de 10 unités, minuscules de 7,
 * jambages jusqu'à -3. `w` : largeur dessinée (le trait déborde de son demi-épaisseur).
 */
interface Glyph { w: number; strokes: Pt[][]; dots: Pt[] }

const P = (...n: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};

/** Arc d'ellipse en unités (angles en degrés, sens trigonométrique, y vers le haut ; a1 < a0 : sens horaire). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, step = 10): Pt[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const [s, c] = sinCosDeg(Math.round(a0 + ((a1 - a0) * i) / n));
    out.push([cx + rx * c, cy + ry * s]);
  }
  return out;
}
const ring = (cx: number, cy: number, rx: number, ry: number): Pt[] => arc(cx, cy, rx, ry, 90, 450);

type GlyphDef = { s: Pt[][]; d?: Pt[] };

function defs(): Record<string, GlyphDef> {
  return {
    ' ': { s: [] },
    '~': { s: [Array.from({ length: 13 }, (_, i): Pt => [i / 2, 5 + 0.9 * sinCosDeg(30 * i)[0]])] },
    '0': { s: [ring(3, 5, 3, 5)] },
    '1': { s: [P(0, 8.4, 2.4, 10, 2.4, 0)] },
    '2': { s: [[...arc(3, 7, 3, 3, 150, -40), ...P(0, 0, 6, 0)]] },
    '3': { s: [[...arc(3, 7.5, 2.7, 2.5, 150, -90), ...arc(3, 2.5, 3, 2.5, 90, -150)]] },
    '4': { s: [P(4.6, 0, 4.6, 10, 0, 3.1, 6.2, 3.1)] },
    '5': { s: [[...P(5.6, 10, 1, 10), ...arc(2.9, 3.2, 3.1, 3.2, 135, -150)]] },
    '6': { s: [P(4.6, 10, 0.25, 3.9), ring(3, 3.1, 3, 3.1)] },
    '7': { s: [P(0, 10, 6, 10, 2.2, 0)] },
    '8': { s: [ring(3, 7.6, 2.6, 2.4), ring(3, 2.7, 3, 2.7)] },
    '9': { s: [ring(3, 6.9, 3, 3.1), P(5.75, 6.1, 1.4, 0)] },
    A: { s: [P(0, 0, 3.3, 10, 6.6, 0), P(1.19, 3.6, 5.41, 3.6)] },
    B: { s: [P(0, 0, 0, 10), [...P(0, 10), ...arc(3.3, 7.55, 2.45, 2.45, 90, -90), ...P(0, 5.1)], [...P(0, 5.1), ...arc(3.6, 2.55, 2.55, 2.55, 90, -90), ...P(0, 0)]] },
    C: { s: [arc(3.6, 5, 3.6, 5, 40, 320)] },
    D: { s: [[...P(2.4, 0, 0, 0, 0, 10), ...arc(2.4, 5, 3.8, 5, 90, -90)]] },
    E: { s: [P(5.4, 10, 0, 10, 0, 0, 5.4, 0), P(0, 5.1, 4.6, 5.1)] },
    F: { s: [P(5.4, 10, 0, 10, 0, 0), P(0, 5.3, 4.6, 5.3)] },
    G: { s: [[...arc(3.7, 5, 3.7, 5, 45, 360), ...P(4.3, 5)]] },
    H: { s: [P(0, 0, 0, 10), P(5.8, 0, 5.8, 10), P(0, 5.1, 5.8, 5.1)] },
    I: { s: [P(0, 0, 0, 10)] },
    J: { s: [[...P(4.2, 10), ...arc(2.1, 2.7, 2.1, 2.7, 0, -180)]] },
    K: { s: [P(0, 0, 0, 10), P(5.6, 10, 0, 3.6), P(2, 5.89, 5.9, 0)] },
    L: { s: [P(0, 10, 0, 0, 5, 0)] },
    M: { s: [P(0, 0, 0, 10, 3.7, 2.8, 7.4, 10, 7.4, 0)] },
    N: { s: [P(0, 0, 0, 10, 6, 0, 6, 10)] },
    O: { s: [ring(3.9, 5, 3.9, 5)] },
    P: { s: [[...P(0, 0, 0, 10), ...arc(3.4, 7.45, 2.55, 2.55, 90, -90), ...P(0, 4.9)]] },
    Q: { s: [ring(3.9, 5, 3.9, 5), P(4.7, 2.4, 7.9, -0.8)] },
    R: { s: [[...P(0, 0, 0, 10), ...arc(3.4, 7.45, 2.55, 2.55, 90, -90), ...P(0, 4.9)], P(3.2, 4.9, 6.1, 0)] },
    S: { s: [[...arc(3, 7.5, 2.85, 2.5, 25, 270), ...arc(3, 2.5, 3.05, 2.5, 90, -155)]] },
    T: { s: [P(0, 10, 6.4, 10), P(3.2, 10, 3.2, 0)] },
    U: { s: [[...P(0, 10), ...arc(3, 3.1, 3, 3.1, 180, 360), ...P(6, 10)]] },
    V: { s: [P(0, 10, 3.3, 0, 6.6, 10)] },
    W: { s: [P(0, 10, 2.3, 0, 4.6, 8, 6.9, 0, 9.2, 10)] },
    X: { s: [P(0, 0, 6, 10), P(0, 10, 6, 0)] },
    Y: { s: [P(0, 10, 3.2, 5.2, 6.4, 10), P(3.2, 5.2, 3.2, 0)] },
    Z: { s: [P(0, 10, 6, 10, 0, 0, 6, 0)] },
    a: { s: [ring(2.9, 3.5, 2.9, 3.5), P(5.8, 7, 5.8, 0)] },
    b: { s: [P(0, 10, 0, 0), ring(2.95, 3.5, 2.95, 3.5)] },
    c: { s: [arc(3, 3.5, 3, 3.5, 45, 315)] },
    d: { s: [ring(2.9, 3.5, 2.9, 3.5), P(5.8, 10, 5.8, 0)] },
    e: { s: [[...P(0.05, 3.5, 5.95, 3.5), ...arc(3, 3.5, 2.95, 3.5, 0, 320)]] },
    f: { s: [[...P(1.7, 0), ...arc(3.55, 7.9, 1.85, 2.1, 180, 45)], P(0, 7, 3.7, 7)] },
    g: { s: [ring(2.9, 3.5, 2.9, 3.5), [...P(5.8, 7), ...arc(2.9, -0.8, 2.9, 2.2, 0, -155)]] },
    h: { s: [P(0, 10, 0, 0), [...arc(2.9, 4.1, 2.9, 2.9, 180, 0), ...P(5.8, 0)]] },
    i: { s: [P(0, 0, 0, 7)], d: P(0, 9.3) },
    j: { s: [[...P(3.1, 7), ...arc(1.5, -1.2, 1.6, 1.8, 0, -160)]], d: P(3.1, 9.3) },
    k: { s: [P(0, 10, 0, 0), P(5, 7, 0, 2.4), P(1.75, 4.01, 5.3, 0)] },
    l: { s: [P(0, 10, 0, 0)] },
    m: { s: [P(0, 0, 0, 7), [...arc(2.2, 4.8, 2.2, 2.2, 180, 0), ...P(4.4, 0)], [...arc(6.6, 4.8, 2.2, 2.2, 180, 0), ...P(8.8, 0)]] },
    n: { s: [P(0, 0, 0, 7), [...arc(2.9, 4.1, 2.9, 2.9, 180, 0), ...P(5.8, 0)]] },
    o: { s: [ring(3.1, 3.5, 3.1, 3.5)] },
    p: { s: [P(0, 7, 0, -3), ring(2.95, 3.5, 2.95, 3.5)] },
    q: { s: [ring(2.9, 3.5, 2.9, 3.5), P(5.8, 7, 5.8, -3)] },
    r: { s: [P(0, 0, 0, 7), arc(3.3, 4.2, 3.3, 2.8, 180, 75)] },
    s: { s: [[...arc(2.55, 5.25, 2.4, 1.75, 20, 270), ...arc(2.55, 1.75, 2.6, 1.75, 90, -155)]] },
    t: { s: [[...P(1.6, 9.3), ...arc(3.1, 1.3, 1.5, 1.3, 180, 300)], P(0, 7, 3.6, 7)] },
    u: { s: [[...P(0, 7), ...arc(2.9, 2.9, 2.9, 2.9, 180, 360)], P(5.8, 7, 5.8, 0)] },
    v: { s: [P(0, 7, 2.9, 0, 5.8, 7)] },
    w: { s: [P(0, 7, 2.05, 0, 4.1, 5.6, 6.15, 0, 8.2, 7)] },
    x: { s: [P(0, 0, 5.4, 7), P(0, 7, 5.4, 0)] },
    y: { s: [P(0, 7, 3, 0.33), P(5.8, 7, 1.6, -3)] },
    z: { s: [P(0, 7, 5.2, 7, 0, 0, 5.2, 0)] },
    /** i et j sans point, pour les accents (î, ï) */
    ı: { s: [P(0, 0, 0, 7)] },
    ȷ: { s: [[...P(3.1, 7), ...arc(1.5, -1.2, 1.6, 1.8, 0, -160)]] },
  };
}

let FONT: Map<string, Glyph> | null = null;

function font(): Map<string, Glyph> {
  if (FONT) return FONT;
  FONT = new Map();
  for (const [ch, g] of Object.entries(defs())) {
    let w = ch === ' ' ? 3 : 0;
    for (const s of g.s) for (const [x] of s) if (x > w) w = x;
    for (const [x] of g.d ?? []) if (x > w) w = x;
    FONT.set(ch, { w, strokes: g.s, dots: g.d ?? [] });
  }
  return FONT;
}

/** Signes diacritiques composés au-dessus (ou sous) la lettre : cx = milieu de la lettre, top = haut de la lettre. */
function mark(cp: number, cx: number, top: number): { strokes: Pt[][]; dots: Pt[] } | null {
  switch (cp) {
    case 0x300:
      return { strokes: [P(cx - 0.9, top + 2.6, cx + 0.7, top + 1)], dots: [] };
    case 0x301:
      return { strokes: [P(cx - 0.7, top + 1, cx + 0.9, top + 2.6)], dots: [] };
    case 0x302:
      return { strokes: [P(cx - 1.7, top + 1, cx, top + 2.6, cx + 1.7, top + 1)], dots: [] };
    case 0x303:
      return { strokes: [P(cx - 1.8, top + 1.4, cx - 0.9, top + 2.2, cx + 0.9, top + 1.4, cx + 1.8, top + 2.2)], dots: [] };
    case 0x308:
      return { strokes: [], dots: P(cx - 1.4, top + 1.8, cx + 1.4, top + 1.8) };
    case 0x327:
      return { strokes: [P(cx, -0.2, cx + 1.2, -1.4, cx - 0.4, -2.8)], dots: [] };
    default:
      return null;
  }
}

/** Glyphes d'un texte : lettre de base (sans point pour i et j accentués) et ses signes ; caractères inconnus ignorés. */
function glyphsOf(text: string): Glyph[] {
  const f = font();
  const out: Glyph[] = [];
  for (const cluster of text.replace(/[  ]/g, ' ').normalize('NFD').match(/\P{M}\p{M}*/gu) ?? []) {
    const cps = [...cluster];
    const marks = cps.slice(1).map((c) => c.codePointAt(0)!);
    let base = cps[0];
    if (marks.some((m) => m !== 0x327) && (base === 'i' || base === 'j')) base = base === 'i' ? 'ı' : 'ȷ';
    const g = f.get(base);
    if (!g) continue;
    if (!marks.length) {
      out.push(g);
      continue;
    }
    const lower = /[a-zıȷ]/.test(base) && !/[bdfhklt]/.test(base);
    const top = lower ? 7 : 10;
    const strokes = [...g.strokes];
    const dots = [...g.dots];
    for (const m of marks) {
      const mk = mark(m, g.w / 2, top);
      if (!mk) continue;
      strokes.push(...mk.strokes);
      dots.push(...mk.dots);
    }
    out.push({ w: g.w, strokes, dots });
  }
  // caractères inconnus retirés : les espaces qu'ils laissent aux bouts ne décentrent pas le texte
  const space = font().get(' ');
  while (out.length && out[0] === space) out.shift();
  while (out.length && out[out.length - 1] === space) out.pop();
  return out;
}

/** Espace libre entre deux lettres, en unités (en plus de l'épaisseur du trait). */
const TRACK = 1.1;

/** Largeur dessinée d'un texte (px) pour une hauteur de capitale et une épaisseur de trait données. */
function textWidth(gs: Glyph[], capPx: number, stroke: number): number {
  if (!gs.length) return 0;
  const s = capPx / 10;
  let w = stroke;
  gs.forEach((g, i) => {
    w += g.w * s;
    if (i < gs.length - 1) w += stroke + TRACK * s;
  });
  return w;
}

/** Texte ajusté : hauteur de capitale et trait réduits ensemble s'il dépasse `maxW` (le trait jamais sous `minStroke`). */
function fitText(gs: Glyph[], capPx: number, stroke: number, maxW: number, minStroke: number): { cap: number; stroke: number; width: number } {
  let c = capPx;
  let t = stroke;
  let width = textWidth(gs, c, t);
  for (let i = 0; i < 6 && width > maxW; i++) {
    const f = maxW / width;
    c *= f;
    t = Math.max(minStroke, t * f);
    width = textWidth(gs, c, t);
  }
  return { cap: c, stroke: t, width };
}

/**
 * Formes d'un texte centré sur `cx` ; `baseline(cap)` : ligne de base (px) pour la hauteur de capitale retenue (un
 * texte réduit pour tenir en largeur reste ainsi centré en hauteur).
 */
function textShapes(text: string, cx: number, baseline: (cap: number) => number, capPx: number, stroke: number, maxW: number, minStroke: number): Shape[] {
  const gs = glyphsOf(text);
  if (!gs.length) return [];
  const fitted = fitText(gs, capPx, stroke, maxW, minStroke);
  const s = fitted.cap / 10;
  const t = fitted.stroke;
  const r = t / 2;
  const by = baseline(fitted.cap);
  let x = cx - fitted.width / 2 + r;
  const shapes: Shape[] = [];
  const at = (p: Pt): Pt => [x + p[0] * s, by - p[1] * s];
  for (const g of gs) {
    for (const st of g.strokes) shapes.push(...polyline(st.map(at), r));
    for (const d of g.dots) shapes.push(cap(at(d), at(d), r * 1.2));
    x += g.w * s + t + TRACK * s;
  }
  return shapes;
}

/* ------------------------------ Flèches ------------------------------ */

const R2 = Math.SQRT1_2;
/** Demi-épaisseur du trait d'une flèche (16 px dans 144 × 144). */
const SHAFT_R = 8;
const HEAD_LEN = 34;
const HEAD_HALF = 26;

interface ArrowDef { shaft: Pt[]; tip: Pt; dir: Pt }


/** Flèches « à gauche » (et droit devant, demi-tour), dans 144 × 144 ; « à droite » = miroir. */
function arrowDef(turn: 'straight' | 'left' | 'slightLeft' | 'sharpLeft' | 'uturn'): ArrowDef {
  switch (turn) {
    case 'straight':
      return { shaft: [[72, 132]], tip: [72, 14], dir: [0, -1] };
    case 'left':
      return { shaft: [[92, 132], [92, 62]], tip: [12, 62], dir: [-1, 0] };
    case 'slightLeft':
      return { shaft: [[84, 132], [84, 82]], tip: [30, 28], dir: [-R2, -R2] };
    case 'sharpLeft':
      return { shaft: [[96, 132], [96, 50]], tip: [28, 118], dir: [-R2, R2] };
    case 'uturn': {
      const top: Pt[] = [];
      for (let a = 0; a <= 180; a += 10) {
        const [s, c] = sinCosDeg(a);
        top.push([70 + 28 * c, 66 - 28 * s]);
      }
      return { shaft: [[98, 132], ...top], tip: [42, 118], dir: [0, 1] };
    }
  }
}

function arrowShapes(def: ArrowDef, map: (p: Pt) => Pt, k: number): Shape[] {
  const [tx, ty] = def.tip;
  const [ux, uy] = def.dir;
  const base: Pt = [tx - HEAD_LEN * ux, ty - HEAD_LEN * uy];
  const nx = -uy;
  const ny = ux;
  const head: Pt[] = [def.tip, [base[0] + HEAD_HALF * nx, base[1] + HEAD_HALF * ny], [base[0] - HEAD_HALF * nx, base[1] - HEAD_HALF * ny]];
  return [...polyline([...def.shaft, base].map(map), SHAFT_R * k), { k: 'poly', pts: head.map(map) }];
}

/** Mise à l'échelle du dessin de référence 144 × 144, centré dans l'image. */
function fit(w: number, h: number): { k: number; map: (p: Pt) => Pt } {
  const k = Math.min(w, h) / IMAGE_BOX;
  const ox = (w - IMAGE_BOX * k) / 2;
  const oy = (h - IMAGE_BOX * k) / 2;
  return { k, map: (p) => [ox + p[0] * k, oy + p[1] * k] };
}

const LEFT_OF: Record<TurnKind, { def: 'straight' | 'left' | 'slightLeft' | 'sharpLeft' | 'uturn'; mirror: boolean } | undefined> = {
  straight: { def: 'straight', mirror: false },
  left: { def: 'left', mirror: false },
  right: { def: 'left', mirror: true },
  slightLeft: { def: 'slightLeft', mirror: false },
  slightRight: { def: 'slightLeft', mirror: true },
  sharpLeft: { def: 'sharpLeft', mirror: false },
  sharpRight: { def: 'sharpLeft', mirror: true },
  uturn: { def: 'uturn', mirror: false },
};

function turnImage(turn: TurnKind, w: number, h: number): Uint8Array {
  const t = LEFT_OF[turn];
  if (!t) return new Uint8Array(w * h);
  const { k, map } = fit(w, h);
  const px = rasterize(w, h, [{ level: IMAGE_LEVEL.strong, shapes: arrowShapes(arrowDef(t.def), map, k) }]);
  if (t.def === 'straight') return symmetrize(px, w, h);
  return t.mirror ? flipH(px, w, h) : px;
}

/** Angle ramené au degré entier dans [0, 360). */
export function normDeg(deg: number): number {
  let d = Number.isFinite(deg) ? Math.round(deg) % 360 : 0;
  if (d < 0) d += 360;
  return d;
}

/** Flèche à vol d'oiseau : pointe vers `deg` (0 = devant, sens horaire) ; à gauche (> 180°) = miroir de la droite. */
function bearingImage(deg: number, w: number, h: number): Uint8Array {
  const d = normDeg(deg);
  const [s, c] = sinCosDeg(d <= 180 ? d : 360 - d);
  const { k, map } = fit(w, h);
  // dessin vers le haut autour du centre (y vers le bas), tourné dans le sens horaire
  const rot = (p: Pt): Pt => map([72 + p[0] * c - p[1] * s, 72 + p[0] * s + p[1] * c]);
  const half = 28;
  const shapes: Shape[] = [...polyline([rot([0, 50]), rot([0, -16])], SHAFT_R * k), { k: 'poly', pts: [rot([0, -58]), rot([half, -16]), rot([-half, -16])] }];
  const px = rasterize(w, h, [{ level: IMAGE_LEVEL.strong, shapes }]);
  if (d === 0 || d === 180) return symmetrize(px, w, h);
  return d <= 180 ? px : flipH(px, w, h);
}

/* ------------------------------ Panneau ------------------------------ */

/** Géométrie du panneau dans 144 × 144 (cadre, zone intérieure, petits mots, grand chiffre). */
export const SIGN = {
  frame: { x: 3, y: 3, w: 138, h: 138, r: 20, t: 5 },
  inner: { x0: 8, y0: 8, x1: 136, y1: 136 },
  label: { cap: 17, stroke: 2.6, top: 31, foot: 125 },
  value: { cap: 56, capAlone: 60, stroke: 10, maxW: 112 },
  labelMaxW: 116,
} as const;

function signImage(k: Extract<ImageKind, { kind: 'sign' }>, w: number, h: number): Uint8Array {
  const { k: z, map } = fit(w, h);
  const f = SIGN.frame;
  const [fx, fy] = map([f.x, f.y]);
  const frame: Ring = { k: 'ring', x: fx, y: fy, w: f.w * z, h: f.h * z, r: f.r * z, t: f.t * z };
  const [cx] = map([72, 0]);
  const Y = (y: number) => map([0, y])[1];
  const label = String(k.label ?? '').trim();
  const value = String(k.value ?? '').trim();
  const foot = String(k.foot ?? '').trim();
  const L = SIGN.label;
  const pale: Shape[] = [];
  if (label) pale.push(...textShapes(label, cx, () => Y(L.top), L.cap * z, L.stroke * z, SIGN.labelMaxW * z, 1.4 * z));
  if (foot) pale.push(...textShapes(foot, cx, () => Y(L.foot), L.cap * z, L.stroke * z, SIGN.labelMaxW * z, 1.4 * z));
  // grand chiffre : centré en hauteur entre les petits mots (ou le cadre), même réduit pour tenir en largeur
  const top = label ? L.top + 0.3 * L.cap + 6 : SIGN.inner.y0 + 6;
  const bottom = foot ? L.foot - L.cap - 6 : SIGN.inner.y1 - 6;
  const capRef = Math.min(foot ? SIGN.value.cap : SIGN.value.capAlone, bottom - top);
  const V = SIGN.value;
  const strong: Shape[] = [frame];
  if (value) strong.push(...textShapes(value, cx, (c) => Y((top + bottom) / 2) + c / 2, capRef * z, ((V.stroke * capRef) / V.cap) * z, V.maxW * z, 3 * z));
  return rasterize(w, h, [
    { level: IMAGE_LEVEL.pale, shapes: pale },
    { level: IMAGE_LEVEL.strong, shapes: strong },
  ]);
}

/* ------------------------------ Entrée ------------------------------ */

const clampInt = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo);

const cache = new Map<string, Uint8Array>();

/**
 * Pixels d'une image : w × h octets, de 0 (éteint) à 15 (au plus clair), ligne par ligne depuis le haut. Pur et
 * déterministe ; une sorte inconnue donne une image vide (rien de trompeur).
 */
export function renderImage(img: ImageSpec): Uint8Array {
  const w = clampInt(img.w, 1, 576);
  const h = clampInt(img.h, 1, 288);
  const kind = img.image;
  const key = JSON.stringify([w, h, kind]);
  const hit = cache.get(key);
  if (hit) return hit.slice();
  let px: Uint8Array;
  switch (kind?.kind) {
    case 'turn':
      px = turnImage(kind.turn, w, h);
      break;
    case 'sign':
      px = signImage(kind, w, h);
      break;
    case 'bearing':
      px = bearingImage(kind.deg, w, h);
      break;
    default:
      px = new Uint8Array(w * h);
  }
  if (cache.size >= 32) cache.delete(cache.keys().next().value as string);
  cache.set(key, px);
  return px.slice();
}

/** Clé du contenu d'une image (même clé : mêmes pixels). */
export function imageKey(img: Pick<ImageSpec, 'w' | 'h' | 'image'>): string {
  return JSON.stringify([clampInt(img.w, 1, 576), clampInt(img.h, 1, 288), img.image]);
}

const TURN_WORDS: Record<TurnKind, string> = {
  left: 'à gauche',
  right: 'à droite',
  slightLeft: 'légèrement à gauche',
  slightRight: 'légèrement à droite',
  sharpLeft: 'franchement à gauche',
  sharpRight: 'franchement à droite',
  uturn: 'demi-tour',
  straight: 'tout droit',
};

/** Ce que montre une image, en mots (lecteurs d'écran de Quai Web, journal des tests). */
export function describeImage(k: ImageKind | undefined): string {
  switch (k?.kind) {
    case 'turn':
      return `flèche ${TURN_WORDS[k.turn] ?? ''}`.trim();
    case 'sign':
      return ['panneau', k.label, k.value, k.foot].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
    case 'bearing': {
      const d = normDeg(k.deg);
      if (d === 0) return 'flèche droit devant';
      if (d === 180) return 'flèche derrière toi';
      return d < 180 ? `flèche ${d}° à droite` : `flèche ${360 - d}° à gauche`;
    }
    default:
      return 'image';
  }
}
