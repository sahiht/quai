/**
 * Noms des arrêts et destinations : translations.txt (formats récents field_value et record_id, ancien format
 * trans_id), puis règles par opérateur (cahier des charges § 3) avec shared/names.ts.
 */
import { prettyName, frName } from '../../shared/names.ts';
import type { Names, Op } from '../../shared/types.ts';

export interface Tr { fr?: string; nl?: string }
export type Lang = 'fr' | 'nl';

/** Code langue GTFS (« fr », « FR », « nl-BE »...) -> 'fr' | 'nl' | null (autres langues ignorées). */
export function langOf(code: string): Lang | null {
  const c = code.trim().toLowerCase().split(/[-_]/)[0];
  return c === 'fr' ? 'fr' : c === 'nl' ? 'nl' : null;
}

const SEP = '\u0001';

export class Translations {
  private readonly byRecord = new Map<string, Tr>();
  private readonly byValue = new Map<string, Tr>();
  private readonly byText = new Map<string, Tr>();
  rows = 0;

  private static put(map: Map<string, Tr>, key: string, lang: Lang, text: string): void {
    if (!text) return;
    let tr = map.get(key);
    if (!tr) map.set(key, (tr = {}));
    if (tr[lang] === undefined) tr[lang] = text;
  }

  /** Format récent, traduction d'un enregistrement précis (record_id). */
  addRecord(table: string, field: string, recordId: string, lang: Lang, text: string): void {
    Translations.put(this.byRecord, table + SEP + field + SEP + recordId, lang, text);
    this.rows++;
  }

  /** Format récent, traduction de toutes les valeurs égales à field_value. */
  addValue(table: string, field: string, value: string, lang: Lang, text: string): void {
    Translations.put(this.byValue, table + SEP + field + SEP + value, lang, text);
    this.rows++;
  }

  /** Ancien format (trans_id = texte d'origine, quel que soit le champ). */
  addText(original: string, lang: Lang, text: string): void {
    Translations.put(this.byText, original, lang, text);
    this.rows++;
  }

  record(table: string, field: string, recordId: string): Tr | undefined {
    return this.byRecord.get(table + SEP + field + SEP + recordId);
  }

  /** Traduction d'une valeur : record_id d'abord, puis field_value, puis ancien format (fusion par langue). */
  get(table: string, field: string, recordId: string | undefined, value: string): Tr | undefined {
    const r = recordId ? this.byRecord.get(table + SEP + field + SEP + recordId) : undefined;
    const v = this.byValue.get(table + SEP + field + SEP + value);
    const t = this.byText.get(value);
    if (!r && !v && !t) return undefined;
    return {
      fr: r?.fr ?? v?.fr ?? t?.fr,
      nl: r?.nl ?? v?.nl ?? t?.nl,
    };
  }

  get size(): number {
    return this.byRecord.size + this.byValue.size + this.byText.size;
  }
}

/* ------------------------------ quais dans les noms ------------------------------ */

const PLATFORM_SUFFIX = /^(.*?\S)[\s,-]*\s(?:perron|quai)\s+([0-9]{1,3}[a-z]?|[a-z]{1,2}[0-9]{0,2})$/i;

/**
 * Retire le suffixe de quai d'un nom (« Namur Gare quai A » -> base « Namur Gare », quai « A » ;
 * « Brussel Noordstation perron 4 » -> « Brussel Noordstation », « 4 »). Les noms de rue (« Quai de la Gare »,
 * « Liège Quai Godefroid ») ne sont pas touchés : le quai doit être un repère court (chiffres ou 1-2 lettres).
 */
export function splitPlatform(name: string): { base: string; platform?: string } {
  const t = (name ?? '').trim().replace(/\s+/g, ' ');
  const m = PLATFORM_SUFFIX.exec(t);
  if (!m) return { base: t };
  return { base: m[1], platform: m[2] };
}

/** Quai d'un arrêt physique : platform_code, sinon suffixe du nom (perron/quai), sinon (SNCB) suffixe numérique de l'identifiant. */
export function platformOf(op: Op, stopId: string, name: string, platformCode: string): string | undefined {
  if (platformCode) return platformCode;
  const p = splitPlatform(name).platform;
  if (p) return p;
  if (op === 'sncb') {
    const m = /_(\d+)$/.exec(stopId);
    if (m) return m[1];
  }
  return undefined;
}

/** Identifiant temps réel d'un arrêt : STIB = pointid numérique (lettres finales retirées), sinon stop_id normalisé. */
export function rtIdOf(op: Op, stopId: string): string {
  if (op !== 'stib') return stopId;
  const bare = stopId.replace(/[A-Za-z]+$/, '');
  return bare || stopId;
}

/* ------------------------------ résolution des noms ------------------------------ */

/**
 * Noms bilingues d'un arrêt (stripPlatform = true) ou d'une destination.
 * - translations (fr, nl) si présentes ; prettyName() appliqué partout (noms STIB en majuscules) ;
 * - sinon De Lijn : nl = nom d'origine, fr = frName(nl), l = 'nl' ; autres : fr = nl = nom d'origine ;
 * - SNCB : l = 'nl' quand le nom d'origine est égal à la traduction nl.
 */
export function resolveNames(op: Op, original: string, tr: Tr | undefined, stripPlatform: boolean): Names {
  const orig = (original ?? '').trim().replace(/\s+/g, ' ');
  const base = (s: string) => (stripPlatform ? splitPlatform(s).base : s.trim().replace(/\s+/g, ' '));
  const clean = prettyName(base(orig));
  const trFr = tr?.fr ? prettyName(base(tr.fr)) : '';
  const trNl = tr?.nl ? prettyName(base(tr.nl)) : '';
  if (trFr || trNl) {
    const nl = trNl || clean;
    const fr = trFr || (op === 'delijn' ? frName(nl) : clean);
    const n: Names = { fr, nl };
    if (op === 'delijn') n.l = 'nl';
    else if (op === 'sncb' && tr?.nl !== undefined && orig === tr.nl.trim().replace(/\s+/g, ' ')) n.l = 'nl';
    return n;
  }
  if (op === 'delijn') return { fr: frName(clean) || clean, nl: clean, l: 'nl' };
  return { fr: clean, nl: clean };
}
