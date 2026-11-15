/**
 * 1.2.10 : PNG gris des images envoyées aux lunettes (platform/png.ts), relu par zlib de Node : signature, blocs et
 * CRC, IHDR, données décompressées, filtre « Up » défait : chaque pixel vaut exactement niveau × 17.
 */
import { describe, expect, it } from 'vitest';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { renderImage } from '../../src/glasses/images';
import type { ImageKind } from '../../src/glasses/types';
import { crc32, deflateFixed, grayPng, zlibFixed } from '../../src/platform/png';

/** Lecture d'un PNG gris 8 bits (filtres 0 et 2), CRC contrôlés. */
function decode(png: Uint8Array): { w: number; h: number; px: Uint8Array; chunks: string[] } {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let w = 0;
  let h = 0;
  const idat: Uint8Array[] = [];
  const chunks: string[] = [];
  while (o < png.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    const data = png.subarray(o + 8, o + 8 + len);
    expect(dv.getUint32(o + 8 + len)).toBe(crc32(png.subarray(o + 4, o + 8 + len)));
    chunks.push(type);
    if (type === 'IHDR') {
      w = new DataView(data.buffer, data.byteOffset).getUint32(0);
      h = new DataView(data.buffer, data.byteOffset).getUint32(4);
      expect(Array.from(data.subarray(8))).toEqual([8, 0, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe((w + 1) * h);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    expect([0, 2]).toContain(f);
    for (let x = 0; x < w; x++) {
      const v = raw[y * (w + 1) + 1 + x];
      px[y * w + x] = f === 2 ? (v + (y ? px[(y - 1) * w + x] : 0)) & 0xff : v;
    }
  }
  return { w, h, px, chunks };
}

describe('PNG gris des images des lunettes', () => {
  it('CRC-32 et deflate conformes (relus par zlib)', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    const samples = [new Uint8Array(0), Uint8Array.from([7]), Uint8Array.from([1, 1, 1, 1, 1, 1, 2, 2, 2, 0, 0, 0, 0]), new Uint8Array(70_000).fill(255)];
    const noisy = new Uint8Array(5000);
    for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 7919 + (i >> 3) * 31) & 0xff;
    samples.push(noisy);
    for (const s of samples) {
      expect(Array.from(inflateRawSync(deflateFixed(s)))).toEqual(Array.from(s));
      expect(Array.from(inflateSync(zlibFixed(s)))).toEqual(Array.from(s));
    }
  });

  it('chaque image du guidage relue au pixel près (niveau × 17), en quelques centaines d’octets', () => {
    const kinds: ImageKind[] = [
      { kind: 'turn', turn: 'left' },
      { kind: 'turn', turn: 'uturn' },
      { kind: 'sign', label: 'à pied', value: '12', foot: 'min' },
      { kind: 'bearing', deg: 33 },
    ];
    for (const k of kinds) {
      for (const [w, h] of [
        [144, 144],
        [288, 144],
        [21, 20],
      ]) {
        const levels = renderImage({ id: 1, name: 'i', x: 0, y: 0, w, h, image: k });
        const png = grayPng(levels, w, h);
        const d = decode(png);
        expect(d.chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
        expect([d.w, d.h]).toEqual([w, h]);
        expect(Array.from(d.px)).toEqual(Array.from(levels, (v) => v * 17));
        // la conversion en 4 bits de l'hôte retrouve exactement le niveau
        expect(Array.from(d.px, (v) => v >> 4)).toEqual(Array.from(levels));
        if (w === 144) expect(png.length).toBeLessThan(4000);
      }
    }
  });

  it('valeurs hors de 0..15 bornées à 15 ; image unie', () => {
    const d = decode(grayPng(Uint8Array.from([0, 15, 16, 255]), 2, 2));
    expect(Array.from(d.px)).toEqual([0, 255, 255, 255]);
    expect(Array.from(decode(grayPng(new Uint8Array(40 * 30).fill(9), 40, 30)).px).every((v) => v === 153)).toBe(true);
  });
});
