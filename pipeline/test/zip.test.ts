import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeZip } from '../../fixtures/pipeline/zip.ts';
import { openGtfsZip, ZipError } from '../src/zip.ts';
import { cleanupTempDirs, tempDir } from './helpers.ts';

afterAll(cleanupTempDirs);

async function text(path: string, name: string): Promise<string> {
  const zip = await openGtfsZip(path);
  try {
    const parts: Buffer[] = [];
    for await (const c of await zip.open(name)) parts.push(c as Buffer);
    return Buffer.concat(parts).toString('utf8');
  } finally {
    zip.close();
  }
}

describe('lecture des zips', () => {
  it('trouve les fichiers par nom de base, sans casse ni sous-dossier, et lit les fichiers non compressés', async () => {
    const path = join(tempDir(), 'a.zip');
    const big = 'x,y\n' + '1,2\n'.repeat(200_000);
    writeFileSync(path, makeZip([
      { name: 'gtfs/', data: '' },
      { name: 'gtfs/Stops.TXT', data: 'stop_id\nA\n' },
      { name: 'gtfs/sub/stops.txt', data: 'stop_id\nB\n' },
      { name: '__MACOSX/gtfs/._trips.txt', data: 'junk' },
      { name: 'trips.txt', data: big, method: 0 },
      { name: 'empty.txt', data: '' },
    ]));
    const zip = await openGtfsZip(path);
    expect(zip.files).toEqual(['empty.txt', 'stops.txt', 'trips.txt']);
    expect(zip.has('STOPS.txt')).toBe(true);
    zip.close();
    expect(await text(path, 'stops.txt')).toBe('stop_id\nA\n');
    expect(await text(path, 'trips.txt')).toBe(big);
    expect(await text(path, 'empty.txt')).toBe('');
  });

  it('fichier absent, archive illisible, données corrompues ou tronquées : ZipError en français', async () => {
    const dir = tempDir();
    const ok = join(dir, 'ok.zip');
    writeFileSync(ok, makeZip([{ name: 'stops.txt', data: 'stop_id,stop_name\n' + 'N1,Namur\n'.repeat(5000) }]));
    await expect(text(ok, 'trips.txt')).rejects.toThrow(new ZipError("fichier GTFS absent de l'archive : trips.txt"));

    const notZip = join(dir, 'texte.zip');
    writeFileSync(notZip, 'bonjour');
    await expect(openGtfsZip(notZip)).rejects.toThrow(/^archive zip illisible/);

    const corrupt = Buffer.from(readFileSync(ok));
    for (let i = 60; i < 90; i++) corrupt[i] ^= 0xff; // dans les données compressées
    const bad = join(dir, 'corrompu.zip');
    writeFileSync(bad, corrupt);
    await expect(text(bad, 'stops.txt')).rejects.toThrow(ZipError);

    // taille annoncée fausse : données plus courtes qu'annoncé
    const lying = Buffer.from(readFileSync(ok));
    const cd = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(lying.readUInt32LE(cd + 24) + 10, cd + 24);
    const lie = join(dir, 'taille.zip');
    writeFileSync(lie, lying);
    await expect(text(lie, 'stops.txt')).rejects.toThrow(/stops\.txt : contenu tronqué, archive corrompue/);
  });

  it('un lecteur peut s’arrêter avant la fin sans bloquer', async () => {
    const path = join(tempDir(), 'grand.zip');
    writeFileSync(path, makeZip([{ name: 'stop_times.txt', data: 'a,b\n'.repeat(500_000) }]));
    const zip = await openGtfsZip(path);
    const s = await zip.open('stop_times.txt');
    for await (const chunk of s) {
      expect((chunk as Buffer).length).toBeGreaterThan(0);
      break; // destroy implicite
    }
    expect(s.destroyed).toBe(true);
    zip.close();
  });
});
