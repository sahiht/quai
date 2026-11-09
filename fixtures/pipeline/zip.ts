/**
 * Écriture minimale d'archives zip (méthode deflate), sans dépendance, déterministe :
 * même contenu => mêmes octets (date fixe), pour pouvoir committer les zips de test.
 * Utilisé par make-gtfs.ts et par le test de charge du pipeline.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** method : 8 = deflate (défaut), 0 = sans compression. */
export interface ZipInput { name: string; data: string | Uint8Array; method?: 0 | 8 }

/** Date DOS fixe : 2026-11-09 00:00:00. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 9;

export function makeZip(files: ZipInput[], level = 9): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : Buffer.from(f.data);
    const name = Buffer.from(f.name, 'utf8');
    const method = f.method ?? 8;
    const comp = method === 8 ? deflateRawSync(data, { level }) : data;
    const crc = crc32(data);
    if (data.length > 0xfffffffe || comp.length > 0xfffffffe || offset > 0xfffffffe) {
      throw new Error('archive trop grande pour ce petit outil (zip64 non pris en charge)');
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version nécessaire
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(method, 8); // 8 deflate, 0 sans compression
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4); // créé sous Unix, version 2.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // commentaire
    cd.writeUInt16LE(0, 34); // disque
    cd.writeUInt16LE(0, 36); // attributs internes
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // attributs externes : fichier 0644
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cdBuf, end]);
}
