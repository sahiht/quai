/**
 * Fiche du magasin Even Hub : icône (règles du serveur), textes (limites en points de code),
 * nom identique partout, page de confidentialité.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { homeView } from '../../src/glasses/views';
import { defaults } from './helpers';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string): string => readFileSync(join(APP, p), 'utf8');
/** Mesure comme le CLI : \r\n → \n, espaces de tête et de fin retirés, points de code Unicode. */
const codePoints = (s: string): number => [...s.replace(/\r\n/g, '\n').trim()].length;

/** Décodeur PNG minimal (RGBA ou RGB 8 bits, filtres 0 à 4). */
function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      colorType = data[9];
      expect(data[12]).toBe(0);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  expect(bpp).toBeGreaterThan(0);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cur[i] = (x + [0, a, b, (a + b) >> 1, paeth][f]) & 0xff;
    }
    for (let xx = 0; xx < width; xx++) {
      out.set(bpp === 4 ? cur.subarray(xx * 4, xx * 4 + 4) : [...cur.subarray(xx * 3, xx * 3 + 3), 255], (y * width + xx) * 4);
    }
    prev.set(cur);
  }
  return { width, height, rgba: out };
}

describe('icône du portail (app/icon.png)', () => {
  const file = join(APP, 'icon.png');
  const png = decodePng(readFileSync(file));
  const lit = (x: number, y: number): boolean => png.rgba[(y * png.width + x) * 4 + 3] !== 0;

  it('PNG de 1 Mo au plus, exactement 24 × 24', () => {
    expect(statSync(file).size).toBeLessThanOrEqual(1024 * 1024);
    expect(png.width).toBe(24);
    expect(png.height).toBe(24);
  });

  it('chaque pixel est transparent ou #F4F4F4 opaque', () => {
    for (let i = 0; i < png.rgba.length; i += 4) {
      const [r, g, b, a] = png.rgba.subarray(i, i + 4);
      if (a === 0) continue;
      expect([r, g, b, a], `pixel ${(i / 4) % 24},${Math.floor(i / 96)}`).toEqual([0xf4, 0xf4, 0xf4, 0xff]);
    }
  });

  it('pixels allumés en blocs 2 × 2 alignés (balayage ligne par ligne)', () => {
    const used = new Set<number>();
    let blocks = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        if (!lit(x, y) || used.has(y * 24 + x)) continue;
        expect(x, `bloc en (${x},${y}) sur la dernière colonne`).toBeLessThan(23);
        expect(y, `bloc en (${x},${y}) sur la dernière ligne`).toBeLessThan(23);
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
          const k = (y + dy) * 24 + x + dx;
          expect(lit(x + dx, y + dy) && !used.has(k), `voisin (${x + dx},${y + dy}) du bloc (${x},${y})`).toBe(true);
        }
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) used.add((y + dy) * 24 + x + dx);
        blocks++;
      }
    }
    expect(blocks).toBeGreaterThan(20);
  });
});

describe('textes du magasin (app/store)', () => {
  it('nom identique dans app.json, la fiche et les lunettes', () => {
    const name = read('store/name.txt').trim();
    expect(name).toBe('Quai');
    expect(JSON.parse(read('app.json')).name).toBe(name);
    expect(homeView({}, { now: 0, settings: defaults() }).title).toBe(name);
    expect(read('index.html')).toContain('<title>Quai</title>');
  });

  it('limites du CLI : accroche ≤ 50, description ≤ 2000, notes de version ≤ 500 (points de code)', () => {
    const tagline = read('store/tagline.txt');
    expect(codePoints(tagline)).toBeGreaterThan(0);
    expect(codePoints(tagline)).toBeLessThanOrEqual(50);
    const desc = read('store/description.txt');
    expect(codePoints(desc)).toBeLessThanOrEqual(2000);
    expect(desc).toContain('Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0');
    expect(desc).toMatch(/[Uu]sage personnel et non commercial/);
    const version = JSON.parse(read('app.json')).version;
    const notes = read(`store/changelog/${version}.txt`);
    expect(codePoints(notes)).toBeLessThanOrEqual(500);
    const lines = notes.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it('confidentialité : position, tuiles, relais, ni compte ni suivi, domaines', () => {
    const md = read('store/privacy.md');
    expect(md).toMatch(/jamais enregistrée et n’est jamais envoyée au relais/);
    expect(md).toMatch(/zones d’environ 2 km/);
    expect(md).toMatch(/GitHub Pages/);
    expect(md).toMatch(/Vercel/);
    expect(md).toMatch(/aucun compte/);
    expect(md).toMatch(/statistiques/);
    expect(md).toContain('<!-- quai:domaines:debut -->');
    expect(md).toContain('<!-- quai:domaines:fin -->');
  });

  it('jamais de tiret cadratin dans les sources de l’interface', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(APP, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'core' && dir === 'src' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));
    for (const f of [...walk('src'), ...walk('scripts')].filter((x) => /\.(ts|mjs|css)$/.test(x))) expect(read(f), f).not.toMatch(/\u2014/);
  });

  it('jamais de tiret cadratin dans les textes publiés', () => {
    const files = ['store/name.txt', 'store/tagline.txt', 'store/description.txt', 'store/privacy.md', 'app.json', 'index.html', ...readdirSync(join(APP, 'store/changelog')).map((f) => `store/changelog/${f}`)];
    for (const f of files) expect(read(f), f).not.toMatch(/—/);
  });
});
