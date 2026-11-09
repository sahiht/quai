#!/usr/bin/env node
/**
 * Génère app/icon.png (24 × 24) pour le portail Even Hub, selon les règles du serveur :
 * PNG ≤ 1 Mo, pixels transparents ou #F4F4F4 opaques, pixels allumés en blocs 2 × 2 alignés.
 * Dessin : un tram vu de face au bord du quai (grille 12 × 12, chaque case = bloc 2 × 2).
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRID = [
  '....####....',
  '.....##.....',
  '..########..',
  '.##......##.',
  '.#........#.',
  '.#........#.',
  '.##########.',
  '.##########.',
  '.##.####.##.',
  '.##########.',
  '..##....##..',
  '############',
];

const LIT = [0xf4, 0xf4, 0xf4, 0xff];

/** Pixels RGBA 24 × 24 à partir de la grille. */
export function iconPixels(grid = GRID) {
  const size = grid.length * 2;
  const px = new Uint8Array(size * size * 4);
  grid.forEach((row, gy) =>
    [...row].forEach((cell, gx) => {
      if (cell !== '#') return;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) px.set(LIT, ((gy * 2 + dy) * size + gx * 2 + dx) * 4);
    }),
  );
  return { size, px };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG RGBA 8 bits, sans filtre. */
export function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { size, px } = iconPixels();
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icon.png');
  writeFileSync(out, encodePng(size, px));
  console.log(`Icône écrite : ${out}`);
  console.log(GRID.map((r) => r.replace(/#/g, '██').replace(/\./g, '  ')).join('\n'));
}
