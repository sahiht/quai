/**
 * 1.2.10 : PNG en niveaux de gris 8 bits, sans dépendance, pour updateImageRawData. L'hôte Even décode l'image et la
 * ramène à 4 bits (16 niveaux) ; le niveau v (0..15) est écrit v × 17 (0, 17, …, 255), que la conversion retrouve
 * exactement (v × 17 >> 4 = v, et v × 17 / 17 = v). Le PNG est le format éprouvé sur les G2 par les applis publiées
 * (even-g2-notes, display) ; les octets bruts n'ont pas de format documenté.
 *
 * Compression : filtre « Up » sur chaque ligne (les lignes répétées deviennent des zéros), puis deflate à codes de
 * Huffman fixes avec répétitions à distance 1 : une image du guidage (fond noir, formes pleines) tient en quelques
 * centaines d'octets, au lieu de w × h nombres envoyés au pont du téléphone.
 */

/** Écriture bit à bit de deflate (bits de poids faible d'abord ; codes de Huffman de poids fort d'abord). */
class BitWriter {
  private readonly out: number[] = [];
  private acc = 0;
  private n = 0;

  private bit(b: number): void {
    this.acc |= b << this.n;
    if (++this.n === 8) {
      this.out.push(this.acc);
      this.acc = 0;
      this.n = 0;
    }
  }

  /** Valeur sur `count` bits, poids faible d'abord (champs et bits supplémentaires). */
  put(value: number, count: number): void {
    for (let i = 0; i < count; i++) this.bit((value >> i) & 1);
  }

  /** Code de Huffman sur `len` bits, poids fort d'abord. */
  code(code: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bit((code >> i) & 1);
  }

  bytes(): number[] {
    if (this.n) {
      this.out.push(this.acc);
      this.acc = 0;
      this.n = 0;
    }
    return this.out;
  }
}

/** Symbole littéral ou longueur (0..287) en code de Huffman fixe (RFC 1951, 3.2.6). */
function symbol(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

function length(w: BitWriter, len: number): void {
  let i = LEN_BASE.length - 1;
  while (LEN_BASE[i] > len) i--;
  symbol(w, 257 + i);
  if (LEN_EXTRA[i]) w.put(len - LEN_BASE[i], LEN_EXTRA[i]);
}

/** Flux deflate brut (un seul bloc final à codes fixes ; répétitions du dernier octet, distance 1). */
export function deflateFixed(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.put(1, 1); // dernier bloc
  w.put(1, 2); // codes de Huffman fixes
  let i = 0;
  while (i < data.length) {
    if (i > 0) {
      const prev = data[i - 1];
      let run = 0;
      while (run < 258 && i + run < data.length && data[i + run] === prev) run++;
      if (run >= 3) {
        length(w, run);
        w.code(0, 5); // distance 1
        i += run;
        continue;
      }
    }
    symbol(w, data[i]);
    i++;
  }
  symbol(w, 256); // fin du bloc
  return Uint8Array.from(w.bytes());
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Flux zlib (RFC 1950) : en-tête, deflate, somme Adler-32. */
export function zlibFixed(data: Uint8Array): Uint8Array {
  const body = deflateFixed(data);
  const out = new Uint8Array(body.length + 6);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(body, 2);
  const s = adler32(data);
  out[out.length - 4] = s >>> 24;
  out[out.length - 3] = (s >>> 16) & 0xff;
  out[out.length - 2] = (s >>> 8) & 0xff;
  out[out.length - 1] = s & 0xff;
  return out;
}

let CRC: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG gris 8 bits d'une image en niveaux 0..15 (`scale` = 17 : 15 → 255). Les valeurs hors de 0..15 sont bornées.
 */
export function grayPng(levels: Uint8Array, w: number, h: number, scale = 17): Uint8Array {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 2; // filtre « Up »
    for (let x = 0; x < w; x++) {
      const v = Math.min(255, Math.min(15, levels[y * w + x] ?? 0) * scale);
      const up = y > 0 ? Math.min(255, Math.min(15, levels[(y - 1) * w + x] ?? 0) * scale) : 0;
      raw[y * (w + 1) + 1 + x] = (v - up) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 0; // gris
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibFixed(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
