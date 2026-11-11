/**
 * Noms des arrêts et destinations : translations.txt (formats récents field_value et record_id, ancien format
 * trans_id), puis règles par opérateur (cahier des charges § 3) avec shared/names.ts.
 */
import { communeFr, frName, knownFrName, normalizeForSearch, prettyName, tecName } from '../../shared/names.ts';
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
 * - translations (fr, nl) si présentes ; prettyName() appliqué partout (noms STIB en majuscules), tecName() pour
 *   le TEC (commune en capitales remise en casse : « WATERLOO Eglise » → « Waterloo Eglise ») ;
 * - sinon De Lijn : nl = nom d'origine, fr = frName(nl), l = 'nl' ; autres : fr = nl = nom d'origine ;
 * - SNCB : l = 'nl' quand le nom d'origine est égal à la traduction nl.
 */
export function resolveNames(op: Op, original: string, tr: Tr | undefined, stripPlatform: boolean): Names {
  const orig = (original ?? '').trim().replace(/\s+/g, ' ');
  const base = (s: string) => (stripPlatform ? splitPlatform(s).base : s.trim().replace(/\s+/g, ' '));
  const pretty = op === 'tec' ? tecName : prettyName;
  const clean = pretty(base(orig));
  const trFr = tr?.fr ? pretty(base(tr.fr)) : '';
  const trNl = tr?.nl ? pretty(base(tr.nl)) : '';
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

/* ------------------------------ noms français De Lijn (1.1) ------------------------------ */

/** Rayon de recherche d'une zone de même nom (SNCB, STIB) pour compléter un nom français De Lijn. */
export const REF_RADIUS_M = 500;

interface RefName { key: string; fr: string; lat: number; lon: number }

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Noms traduits des zones SNCB et STIB (fr différent de nl), indexés par position : un arrêt De Lijn qui porte
 * le même nom néerlandais qu'une zone voisine (moins de 500 m) reprend son nom français.
 * Exemples réels : « Sint-Gillis Hallepoort » → « Porte de Hal, Saint-Gilles » ; « Antwerpen Zuid » → « Anvers-Sud ».
 */
export class RefNames {
  private readonly grid = new Map<string, RefName[]>();
  size = 0;
  private static cell(lat: number, lon: number): [number, number] {
    return [Math.floor(lat / 0.005), Math.floor(lon / 0.0075)];
  }

  add(n: Names, lat: number, lon: number): void {
    if (!n.fr || !n.nl || n.fr === n.nl || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = normalizeForSearch(n.nl);
    if (!key) return;
    const [y, x] = RefNames.cell(lat, lon);
    const k = `${y}:${x}`;
    const list = this.grid.get(k);
    const rec = { key, fr: n.fr, lat, lon };
    if (list) list.push(rec);
    else this.grid.set(k, [rec]);
    this.size++;
  }

  /** Zones de référence à moins de REF_RADIUS_M, la plus proche d'abord. */
  near(lat: number, lon: number): RefName[] {
    const [y, x] = RefNames.cell(lat, lon);
    const out: { r: RefName; d: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const r of this.grid.get(`${y + dy}:${x + dx}`) ?? []) {
          const d = distM(lat, lon, r.lat, r.lon);
          if (d <= REF_RADIUS_M) out.push({ r, d });
        }
      }
    }
    return out.sort((a, b) => a.d - b.d || (a.r.fr < b.r.fr ? -1 : 1)).map((x) => x.r);
  }
}

/**
 * Nom français d'une zone De Lijn d'après une zone SNCB ou STIB voisine de même nom néerlandais :
 * nom complet identique (« Antwerpen Zuid » → « Anvers-Sud »), ou nom sans la commune en tête
 * (« Sint-Gillis Hallepoort » → « Porte de Hal, Saint-Gilles »). Les noms connus de NAME_FR restent prioritaires.
 * undefined si rien ne correspond.
 */
export function delijnFrFromRefs(nl: string, lat: number, lon: number, refs: RefNames | undefined): string | undefined {
  if (!refs || !refs.size || !nl || knownFrName(nl)) return undefined;
  const near = refs.near(lat, lon);
  if (!near.length) return undefined;
  const full = normalizeForSearch(nl);
  const hit = near.find((r) => r.key === full);
  if (hit) return hit.fr;
  const sp = nl.indexOf(' ');
  if (sp <= 0) return undefined;
  const rest = normalizeForSearch(nl.slice(sp + 1));
  const part = rest ? near.find((r) => r.key === rest) : undefined;
  return part ? `${part.fr}, ${communeFr(nl.slice(0, sp))}` : undefined;
}
