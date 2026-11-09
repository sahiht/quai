import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { CsvError, CsvParser, parseCsvString, readTable } from '../src/csv.ts';

function chunks(text: string, sizes: number[]): string[] {
  const out: string[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const n = sizes[k++ % sizes.length];
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

function parseChunks(parts: string[]): string[][] {
  const rows: string[][] = [];
  const p = new CsvParser((r) => rows.push([...r]));
  for (const c of parts) p.push(c);
  p.end();
  return rows;
}

describe('CsvParser', () => {
  it('lit des lignes simples, avec ou sans fin de ligne finale', () => {
    expect(parseCsvString('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseCsvString('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('retire le BOM UTF-8 en tête', () => {
    expect(parseCsvString('﻿stop_id,stop_name\nN1,Namur\n')).toEqual([['stop_id', 'stop_name'], ['N1', 'Namur']]);
  });

  it('accepte les fins de ligne CRLF', () => {
    expect(parseCsvString('a,b\r\n1,2\r\n3,4\r\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('gère les champs entre guillemets : virgule, guillemets doublés, retour à la ligne', () => {
    const rows = parseCsvString('id,desc,name\r\nN1,"Namur, gare des bus",Gare\nN2,"Quai ""B"", côté gare",X\nN3,"deux\nlignes",Y\n');
    expect(rows).toEqual([
      ['id', 'desc', 'name'],
      ['N1', 'Namur, gare des bus', 'Gare'],
      ['N2', 'Quai "B", côté gare', 'X'],
      ['N3', 'deux\nlignes', 'Y'],
    ]);
  });

  it('accepte des champs tous entre guillemets et des champs vides', () => {
    expect(parseCsvString('"a","b",""\n"1","",""\n,,\n')).toEqual([['a', 'b', ''], ['1', '', ''], ['', '', '']]);
  });

  it('ignore les lignes vides', () => {
    expect(parseCsvString('a,b\n\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('donne le même résultat quel que soit le découpage en morceaux', () => {
    const text = '﻿id,desc,name\r\nN1,"Namur, gare ""des"" bus",Gare\r\nN2,,"x"\r\nN3,"a\r\nb",Z\r\nN4,plain,last';
    const whole = parseCsvString(text);
    for (let cut = 1; cut < text.length; cut++) {
      expect(parseChunks([text.slice(0, cut), text.slice(cut)])).toEqual(whole);
    }
    for (const sizes of [[1], [2], [3, 5], [7, 1, 2]]) {
      expect(parseChunks(chunks(text, sizes))).toEqual(whole);
    }
  });

  it('reste linéaire avec de gros morceaux, même après échauffement du JIT (régression V8)', () => {
    // Piège mesuré : indexOf(c, position) + slice/split dans une boucle optimisée devient quadratique sur des
    // chaînes de plusieurs Mo, seulement une fois la fonction optimisée sur de petites entrées.
    const line = 'trip_1,07:42:00,07:42:00,8863008_4,1\n';
    for (const k of [20_000, 40_000, 60_000]) {
      const p = new CsvParser(() => undefined);
      p.push(Buffer.from(line.repeat(k)).toString());
      p.end();
    }
    for (const [lines, size] of [[300_000, 4 << 20], [300_000, 1 << 20]] as const) {
      const big = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' + line.repeat(lines);
      let n = 0;
      const t0 = Date.now();
      const p = new CsvParser(() => n++);
      for (let i = 0; i < big.length; i += size) p.push(Buffer.from(big.slice(i, i + size)).toString());
      p.end();
      expect(n).toBe(lines + 1);
      expect(Date.now() - t0).toBeLessThan(2000);
    }
    const quoted = '"a","b"\n' + '"x,1","y ""z"""\n'.repeat(150_000);
    let q = 0;
    const t1 = Date.now();
    const pq = new CsvParser(() => q++);
    pq.push(Buffer.from(quoted).toString());
    pq.end();
    expect(q).toBe(150_001);
    expect(Date.now() - t1).toBeLessThan(2000);
  });
});

describe('readTable', () => {
  const src = (s: string | Buffer, size = 7) => {
    const buf = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
    const parts: Buffer[] = [];
    for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, i + size));
    return Readable.from(parts);
  };

  it('accède aux colonnes par nom, quel que soit leur ordre, et ignore les colonnes en trop', async () => {
    const rows: string[][] = [];
    await readTable(src('stop_sequence,stop_id,x_extra,trip_id,departure_time\n1,308611,zz,702321230,12:30:00\n'), 'stop_times.txt',
      ['trip_id', 'stop_id', 'stop_sequence', 'departure_time', 'arrival_time'], (v) => rows.push([...v]));
    expect(rows).toEqual([['702321230', '308611', '1', '12:30:00', '']]);
  });

  it('décode l’UTF-8 coupé entre deux morceaux et retire le BOM en octets', async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('stop_id,stop_name\nN530aaa,Bouge Église\nN509aaa,"Namur Place Léopold"\n', 'utf8')]);
    const rows: string[][] = [];
    const info = await readTable(src(buf, 3), 'stops.txt', ['stop_id', 'stop_name'], (v) => rows.push([...v]), { required: ['stop_id'] });
    expect(info.header).toEqual(['stop_id', 'stop_name']);
    expect(rows).toEqual([['N530aaa', 'Bouge Église'], ['N509aaa', 'Namur Place Léopold']]);
  });

  it('retire les espaces de bord et tolère les lignes trop courtes', async () => {
    const rows: string[][] = [];
    await readTable(src(' Stop_ID , stop_name ,stop_lat\n  N1 , Namur ,50.1\nN2\n'), 'stops.txt', ['stop_id', 'stop_name', 'stop_lat'], (v) => rows.push([...v]));
    expect(rows).toEqual([['N1', 'Namur', '50.1'], ['N2', '', '']]);
  });

  it('signale une colonne obligatoire absente, en français', async () => {
    await expect(readTable(src('stop_name\nNamur\n'), 'stops.txt', ['stop_id'], () => undefined, { required: ['stop_id'] }))
      .rejects.toThrow(new CsvError('stops.txt : colonne obligatoire absente (stop_id)'));
  });

  it('appelle onHeader avec l’en-tête normalisé', async () => {
    let header: string[] = [];
    await readTable(src('"Table_Name",field_name\r\n'), 'translations.txt', [], () => undefined, { onHeader: (h) => (header = h) });
    expect(header).toEqual(['table_name', 'field_name']);
  });
});
