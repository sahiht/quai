/**
 * Lecture CSV en flux, tolérante aux écarts des vrais flux GTFS :
 * BOM UTF-8, fins de ligne CRLF ou LF, champs entre guillemets (virgules, guillemets doublés, retours à la ligne),
 * colonnes dans n'importe quel ordre (accès par nom), colonnes en trop ou manquantes, lignes vides.
 * Chemin rapide : une ligne sans guillemet est découpée avec split(',').
 *
 * Performance : les recherches se font avec des boucles charCodeAt et jamais avec indexOf(c, position) sur les
 * gros morceaux : dans V8 (Node 22), indexOf avec position combiné à slice/split dans une même boucle optimisée
 * devient quadratique sur des chaînes de plusieurs mégaoctets (mesuré : 80 s au lieu de 3 s sur 2 millions de lignes).
 */

/** Position du prochain saut de ligne à partir de `from`, ou -1. */
function nextNewline(s: string, from: number): number {
  const n = s.length;
  for (let i = from; i < n; i++) if (s.charCodeAt(i) === 10) return i;
  return -1;
}

export type RowHandler = (fields: string[]) => void;

export class CsvError extends Error {}

/** Taille maximale d'un enregistrement en attente (au-delà : fichier malformé). */
const MAX_RECORD = 16 * 1024 * 1024;

export class CsvParser {
  private rest = '';
  private started = false;
  private readonly onRow: RowHandler;

  constructor(onRow: RowHandler) {
    this.onRow = onRow;
  }

  push(chunk: string): void {
    let s = chunk;
    if (!this.started) {
      s = this.rest + s;
      this.rest = '';
      if (!s.length) return;
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      this.started = true;
    }
    if (this.rest.length) {
      // On termine l'enregistrement en attente avec un petit tampon, ligne par ligne, sans jamais concaténer
      // le gros morceau reçu : V8 peut devenir quadratique sur une grande chaîne concaténée.
      let buf = this.rest;
      let cut = 0;
      for (;;) {
        const nl = nextNewline(s, cut);
        if (nl < 0) {
          this.rest = buf + s.slice(cut);
          if (this.rest.length > MAX_RECORD) throw new CsvError('ligne démesurée ou guillemet non fermé');
          return;
        }
        buf += s.slice(cut, nl + 1);
        cut = nl + 1;
        const used = this.consume(buf, false);
        if (used >= buf.length) break;
        buf = buf.slice(used);
        if (buf.length > MAX_RECORD) throw new CsvError('ligne démesurée ou guillemet non fermé');
      }
      this.rest = '';
      s = s.slice(cut);
    }
    this.rest = s.slice(this.consume(s, false));
    if (this.rest.length > MAX_RECORD) throw new CsvError('ligne démesurée ou guillemet non fermé');
  }

  end(): void {
    if (this.rest.length) {
      const s = this.rest;
      this.rest = '';
      this.consume(s, true);
    }
  }

  /** Traite les enregistrements complets de s ; renvoie la position du premier caractère non traité. */
  private consume(s: string, final: boolean): number {
    const n = s.length;
    let pos = 0;
    while (pos < n) {
      // fin de ligne, en repérant au passage un éventuel guillemet
      let i = pos;
      let quoted = false;
      while (i < n) {
        const c = s.charCodeAt(i);
        if (c === 10) break;
        if (c === 34) {
          quoted = true;
          break;
        }
        i++;
      }
      if (quoted) {
        const next = this.parseQuoted(s, pos, final);
        if (next < 0) break; // enregistrement incomplet : attendre la suite
        pos = next;
        continue;
      }
      if (i >= n && !final) break; // ligne incomplète
      // chemin rapide : ligne sans guillemet
      let end = i;
      if (end > pos && s.charCodeAt(end - 1) === 13) end--;
      if (end > pos) this.onRow(s.slice(pos, end).split(','));
      pos = i + 1;
    }
    return Math.min(pos, n);
  }

  /** Analyse un enregistrement contenant des guillemets à partir de pos ; -1 si incomplet. */
  private parseQuoted(s: string, pos: number, final: boolean): number {
    const n = s.length;
    const fields: string[] = [];
    let i = pos;
    for (;;) {
      // début de champ
      if (i < n && s.charCodeAt(i) === 34) {
        // champ entre guillemets
        let value = '';
        let j = i + 1;
        let seg = j;
        for (;;) {
          if (j >= n) {
            if (!final) return -1;
            value += s.slice(seg, n); // guillemet jamais fermé : jusqu'à la fin
            break;
          }
          if (s.charCodeAt(j) !== 34) {
            j++;
            continue;
          }
          value += s.slice(seg, j);
          if (j + 1 < n && s.charCodeAt(j + 1) === 34) {
            value += '"';
            j += 2;
            seg = j;
            continue;
          }
          if (j + 1 >= n && !final) return -1; // on ne sait pas encore si le guillemet est doublé
          j++;
          break;
        }
        // caractères éventuels entre le guillemet fermant et le séparateur (tolérance)
        let k = j;
        while (k < n) {
          const c = s.charCodeAt(k);
          if (c === 44 || c === 10 || c === 13) break;
          k++;
        }
        if (k > j) value += s.slice(j, k);
        fields.push(value);
        i = k;
      } else {
        let k = i;
        while (k < n) {
          const c = s.charCodeAt(k);
          if (c === 44 || c === 10 || c === 13) break;
          k++;
        }
        fields.push(s.slice(i, k));
        i = k;
      }
      if (i >= n) {
        if (!final) return -1;
        this.emit(fields);
        return n;
      }
      const c = s.charCodeAt(i);
      if (c === 44) {
        i++;
        if (i >= n) {
          if (!final) return -1;
          fields.push('');
          this.emit(fields);
          return n;
        }
        continue;
      }
      // fin d'enregistrement : \n, \r\n ou \r isolé
      if (c === 13) {
        if (i + 1 >= n && !final) return -1;
        i += i + 1 < n && s.charCodeAt(i + 1) === 10 ? 2 : 1;
      } else {
        i++;
      }
      this.emit(fields);
      return i;
    }
  }

  private emit(fields: string[]): void {
    if (fields.length === 1 && fields[0] === '') return;
    this.onRow(fields);
  }
}

/** Analyse complète d'une chaîne (tests, petits fichiers). */
export function parseCsvString(text: string): string[][] {
  const rows: string[][] = [];
  const p = new CsvParser((r) => rows.push(r));
  p.push(text);
  p.end();
  return rows;
}

export interface TableInfo { header: string[]; rows: number }

export interface TableOptions {
  /** Colonnes obligatoires (erreur en français si absentes). */
  required?: readonly string[];
  /** Appelé avec l'en-tête normalisé (minuscules, sans espaces ni BOM) avant la première ligne. */
  onHeader?: (header: string[]) => void;
}

/**
 * Lit une table CSV et appelle onRow avec les valeurs des colonnes demandées (dans l'ordre de `columns`,
 * chaîne vide si la colonne est absente ou la ligne trop courte, espaces de bord retirés).
 * Le tableau passé à onRow est réutilisé d'une ligne à l'autre : ne pas le conserver.
 */
export async function readTable(
  input: AsyncIterable<Buffer | Uint8Array | string>,
  file: string,
  columns: readonly string[],
  onRow: (values: string[]) => void,
  opts: TableOptions = {},
): Promise<TableInfo> {
  const required = opts.required ?? [];
  let idx: number[] | null = null;
  let header: string[] = [];
  let rows = 0;
  const vals: string[] = new Array<string>(columns.length).fill('');
  const parser = new CsvParser((fields) => {
    if (!idx) {
      header = fields.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
      for (const r of required) {
        if (!header.includes(r)) throw new CsvError(`${file} : colonne obligatoire absente (${r})`);
      }
      idx = columns.map((c) => header.indexOf(c));
      opts.onHeader?.(header);
      return;
    }
    const ix = idx;
    for (let i = 0; i < ix.length; i++) {
      const j = ix[i];
      const v = j >= 0 && j < fields.length ? fields[j] : '';
      vals[i] = v.length && (v.charCodeAt(0) <= 32 || v.charCodeAt(v.length - 1) <= 32) ? v.trim() : v;
    }
    rows++;
    onRow(vals);
  });
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of input) {
    parser.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
  if (!idx) {
    if (required.length) throw new CsvError(`${file} : fichier vide`);
  }
  return { header, rows };
}
