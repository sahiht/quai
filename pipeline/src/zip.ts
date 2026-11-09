/**
 * Lecture d'une archive zip GTFS en flux. yauzl lit le répertoire central (zip64 compris) ; les données d'un
 * fichier sont lues directement par blocs de 256 Ko et décompressées par zlib avec de grands tampons, ce qui
 * évite des milliers d'allers-retours entre le fil principal et zlib sur les gros fichiers (stop_times.txt).
 * Les fichiers sont retrouvés par leur nom de base, sans tenir compte de la casse ni d'un éventuel sous-dossier.
 */
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { createReadStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

export class ZipError extends Error {}

export interface GtfsZip {
  /** Noms des fichiers présents (noms de base, en minuscules). */
  readonly files: string[];
  has(name: string): boolean;
  /** Flux décompressé d'un fichier ; erreur si absent. */
  open(name: string): Promise<Readable>;
  close(): void;
}

const BLOCK = 256 * 1024;

function openFile(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: false, validateEntrySizes: true }, (err, zf) => {
      if (err || !zf) reject(new ZipError(`archive zip illisible (${err?.message ?? 'inconnue'})`));
      else resolve(zf);
    });
  });
}

/** Vérifie que la taille décompressée correspond à celle annoncée par l'archive. */
class SizeCheck extends Transform {
  private seen = 0;
  private readonly expected: number;
  private readonly name: string;
  constructor(expected: number, name: string) {
    super();
    this.expected = expected;
    this.name = name;
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.seen += chunk.length;
    if (this.seen > this.expected) cb(new ZipError(`${this.name} : contenu plus long qu'annoncé, archive corrompue`));
    else cb(null, chunk);
  }
  override _flush(cb: TransformCallback): void {
    cb(this.seen === this.expected ? null : new ZipError(`${this.name} : contenu tronqué, archive corrompue`));
  }
}

export async function openGtfsZip(path: string): Promise<GtfsZip> {
  const zf = await openFile(path);
  const entries = new Map<string, Entry>();
  await new Promise<void>((resolve, reject) => {
    zf.on('entry', (e: Entry) => {
      const name = e.fileName.replace(/\\/g, '/');
      if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) {
        const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
        const prev = entries.get(base);
        // en cas de doublon, garder le fichier le moins profond
        if (base && (!prev || prev.fileName.split('/').length > name.split('/').length)) entries.set(base, e);
      }
      zf.readEntry();
    });
    zf.once('end', () => resolve());
    zf.once('error', (err: Error) => reject(new ZipError(`archive zip illisible (${err.message})`)));
    zf.readEntry();
  });

  const dataStart = (e: Entry) => new Promise<number>((resolve, reject) => {
    zf.readLocalFileHeader(e, { minimal: true }, (err, h) => {
      if (err || !h) reject(new ZipError(`archive zip illisible (${err?.message ?? 'en-tête local'})`));
      else resolve(h.fileDataStart);
    });
  });

  return {
    files: [...entries.keys()].sort(),
    has: (name) => entries.has(name.toLowerCase()),
    open: async (name) => {
      const e = entries.get(name.toLowerCase());
      if (!e) throw new ZipError(`fichier GTFS absent de l'archive : ${name}`);
      if (e.isEncrypted()) throw new ZipError(`${name} : fichier chiffré`);
      if (e.compressionMethod !== 0 && e.compressionMethod !== 8) {
        throw new ZipError(`${name} : méthode de compression ${e.compressionMethod} non prise en charge`);
      }
      if (e.compressedSize === 0) {
        if (e.uncompressedSize !== 0) throw new ZipError(`${name} : archive corrompue`);
        return Readable.from([]);
      }
      const start = await dataStart(e);
      const raw = createReadStream(path, { start, end: start + e.compressedSize - 1, highWaterMark: BLOCK });
      const inflate = e.compressionMethod === 8 ? createInflateRaw({ chunkSize: BLOCK }) : null;
      const check = new SizeCheck(e.uncompressedSize, name);
      // erreurs de lecture ou de décompression -> erreur en français sur le flux rendu au lecteur
      const fail = (err: Error) => {
        if (!check.destroyed) check.destroy(err instanceof ZipError ? err : new ZipError(`${name} : archive illisible (${err.message})`));
      };
      raw.on('error', fail);
      inflate?.on('error', fail);
      (inflate ? raw.pipe(inflate) : raw).pipe(check);
      // lecteur arrêté avant la fin : libérer le fichier et zlib
      check.on('close', () => {
        raw.destroy();
        inflate?.destroy();
      });
      return check;
    },
    close: () => zf.close(),
  };
}
