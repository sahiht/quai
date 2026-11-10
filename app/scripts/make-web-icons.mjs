#!/usr/bin/env node
/**
 * npm run icons:web : icônes de Quai Web dans web/public/ (copiées telles quelles par npm run build:web).
 * Même dessin que app/icon.png (tram vu de face au bord du quai, grille 12 × 12 de scripts/make-icon.mjs),
 * en clair sur le vert de l'appli, sans transparence (exigé par l'iPhone pour l'écran d'accueil) :
 *   icon-192.png, icon-512.png           manifeste (purpose « any »)
 *   icon-maskable-512.png                manifeste (purpose « maskable » : dessin dans la zone sûre de 80 %)
 *   apple-touch-icon.png (180 px)        écran d'accueil de l'iPhone
 *   favicon-32.png                       onglet du navigateur
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRID, encodePng } from './make-icon.mjs';

/** Vert des maquettes (--accent) et clair de l'icône du portail Even Hub. */
export const BG = [0x1f, 0x7a, 0x45, 0xff];
export const FG = [0xf4, 0xf4, 0xf4, 0xff];

/** art : part de la largeur occupée par le dessin. */
export const WEB_ICONS = [
  { file: 'icon-192.png', size: 192, art: 0.625 },
  { file: 'icon-512.png', size: 512, art: 0.61 },
  { file: 'icon-maskable-512.png', size: 512, art: 0.47 },
  { file: 'apple-touch-icon.png', size: 180, art: 0.6 },
  { file: 'favicon-32.png', size: 32, art: 0.75 },
];

/** Pixels RGBA d'une icône carrée : fond plein, dessin centré en blocs carrés entiers (net, sans flou). */
export function webIconPixels(size, art, grid = GRID) {
  const n = grid.length;
  const cell = Math.max(1, Math.floor((size * art) / n));
  const off = Math.floor((size - cell * n) / 2);
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set(BG, i * 4);
  grid.forEach((row, gy) =>
    [...row].forEach((c, gx) => {
      if (c !== '#') return;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) px.set(FG, ((off + gy * cell + y) * size + off + gx * cell + x) * 4);
    }),
  );
  return { size, px, cell, off };
}

export const WEB_PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(WEB_PUBLIC, { recursive: true });
  for (const icon of WEB_ICONS) {
    const { size, px } = webIconPixels(icon.size, icon.art);
    writeFileSync(join(WEB_PUBLIC, icon.file), encodePng(size, px));
    console.log(`Icône écrite : web/public/${icon.file} (${size} × ${size})`);
  }
}
