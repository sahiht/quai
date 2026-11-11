/**
 * Les trois services d'adresses officiels : adresse de la requête (seul le texte tapé et la langue partent) et
 * lecture de la réponse en candidats (rank.ts). Formats : fixtures/relay/geocode/README.md.
 *
 *  - vla : Digitaal Vlaanderen, Geolocation v4 `Location` : { LocationResult: [{ Municipality, Zipcode,
 *    Thoroughfarename, Housenumber, ID, FormattedAddress, Location: { Lat_WGS84, Lon_WGS84, X_Lambert72, … },
 *    LocationType, BoundingBox }] }. LocationType relevés : basisregisters_gemeente, basisregisters_straat,
 *    basisregisters_huisnummer_<méthode> (aangeduidDoorBeheerder…), urbis_huisnummer (Bruxelles, noms néerlandais).
 *  - bru : Paradigm, géocodage du registre bruxellois `api/v1/…/freeSearch/searchAnyObject` (spécification
 *    Geoloc_TechSpec_EN20260224). Structure relevée en direct le 11/11/2026 : inputValues, resultsList[].objectType,
 *    result[].score, result[].address (houseNumber, hasStreetName.streetname.name[{language, spelling}],
 *    hasMunicipality.name[…], hasPostalInfo.code.objectIdentifier, position.pointGeometry.point.pos « x y » et srsName
 *    EPSG:31370). Lecture tolérante gardée pour les autres formes.
 *  - wal : SPW, ICAR `searchAll` : { geotag, candidates: [{ score, geotag: { ident, level, name, lang, geometry } }] },
 *    niveaux 1 commune, 2 zone d'adresse (« 5000 Namur »), 3 rue (« Rue de la Gare 5030 Gembloux », parfois sans
 *    code postal), 4 adresse (« Rue de Fer 25 5000 Namur »), 7 gare ; score = densité de couverture (plus grand =
 *    meilleur, sans borne) ; coordonnées GeoJSON [lon, lat] en EPSG:4326 demandé.
 */
import { GEO_LIMITS, type GeoConfig, type GeoId } from '../config.js';
import { regionOfPostcode, splitMunicipalitySuffix, type Region } from './communes.js';
import { crsFromName, toWgs84, type Crs } from './lambert.js';
import type { Candidate, Kind, Variant } from './rank.js';
import { cleanMunicipality, cleanName, cleanNumber, type Lang } from './text.js';

/** Noms des services dans les messages (« Réponse illisible du service flamand »). */
export const SERVICE_NAME: Readonly<Record<GeoId, string>> = { vla: 'service flamand', bru: 'service bruxellois', wal: 'service wallon' };
/** Région de chaque service (« Service des adresses de Wallonie indisponible »). */
export const REGION_NAME: Readonly<Record<GeoId, string>> = { vla: 'Flandre', bru: 'Bruxelles', wal: 'Wallonie' };
/** Fournisseur et licence, pour l'attribution. */
export const PROVIDER: Readonly<Record<GeoId, string>> = {
  vla: 'Digitaal Vlaanderen',
  bru: 'Paradigm (UrbIS, CC0)',
  wal: 'SPW (ICAR, CC BY 4.0)',
};

/** Texte d'attribution des services activés (Q10). */
export function attribution(sources: readonly GeoId[]): string {
  const list = (['vla', 'bru', 'wal'] as const).filter((s) => sources.includes(s)).map((s) => PROVIDER[s]);
  return `Adresses : ${list.join(', ')}`;
}

/** Adresse de la requête : seuls le texte tapé (q) et la langue réglée partent, rien d'autre. */
export function sourceUrl(cfg: GeoConfig, id: GeoId, q: string, lang: Lang): string {
  const text = encodeURIComponent(q);
  switch (id) {
    case 'vla':
      return `${cfg.base.vla}/Location?q=${text}&c=${GEO_LIMITS.vlaCount}`;
    case 'bru':
      return `${cfg.base.bru}/freeSearch/searchAnyObject?searchLanguage=${lang}&freeText=${text}&model=BeStPlus`;
    case 'wal':
      return `${cfg.base.wal}/searchAll?address=${text}&crs=EPSG:4326&geom=true&lang=${lang}&levels=1,2,3,4,7`;
  }
}

/** Réponse lisible mais pas au format attendu (traitée comme illisible). */
export class FormatError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'FormatError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
};
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** Score relatif au meilleur candidat de la source (0 à 1) ; sans score, d'après le rang. */
function relativeScores(raw: (number | undefined)[]): number[] {
  const max = Math.max(0, ...raw.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0));
  return raw.map((s, i) => (max > 0 && typeof s === 'number' && s > 0 ? Math.min(1, s / max) : Math.max(0.5, 1 - 0.1 * i)));
}

function regionOf(postcode: string | undefined, fallback: Region): Region {
  return regionOfPostcode(postcode) ?? fallback;
}

/* ------------------------------ Flandre ------------------------------ */

export function parseVla(body: unknown): Candidate[] {
  if (!isObj(body) || !Array.isArray(body.LocationResult)) throw new FormatError('LocationResult absent');
  const out: Candidate[] = [];
  const items = body.LocationResult.filter(isObj);
  const scores = relativeScores(items.map(() => undefined));
  items.forEach((it, i) => {
    const loc = isObj(it.Location) ? it.Location : {};
    const p = toWgs84(num(loc.Lon_WGS84), num(loc.Lat_WGS84), 'EPSG:4326')
      ?? toWgs84(num(loc.X_Lambert72), num(loc.Y_Lambert72), 'EPSG:31370')
      ?? toWgs84(num(loc.X_Lambert2008), num(loc.Y_Lambert2008), 'EPSG:3812');
    if (!p) return;
    const type = str(it.LocationType) ?? '';
    const street = cleanName(str(it.Thoroughfarename));
    const number = cleanNumber(str(it.Housenumber));
    const municipality = cleanMunicipality(str(it.Municipality));
    const postcode = str(it.Zipcode);
    const kind: Kind = number ? 'adresse' : street ? 'rue' : municipality ? 'commune' : 'lieu';
    const place = kind === 'lieu' ? cleanName(str(it.FormattedAddress)) : undefined;
    if (!street && !municipality && !place) return;
    out.push({
      source: 'vla',
      kind,
      approx: kind !== 'adresse' || /interpol|geinterpoleerd/i.test(type),
      lat: p.lat,
      lon: p.lon,
      number,
      postcode,
      variants: [{ lang: 'nl', street, municipality, place }],
      id: str(it.ID),
      srcScore: scores[i],
      order: i,
      region: regionOf(postcode, /^urbis/i.test(type) ? 'bru' : 'vla'),
    });
  });
  return out;
}

/* ------------------------------ Wallonie ------------------------------ */

/** Lecture du nom ICAR selon le niveau : « Rue de Fer 25 5000 Namur », « 25 Rue du Fer 4020 Liège_ », « 5000 Namur »… */
export function parseWalName(level: number, raw: string): { street?: string; number?: string; postcode?: string; municipality?: string; place?: string } {
  const name = raw.replace(/[_\s]+$/g, '').replace(/\s+/g, ' ').trim();
  const box = String.raw`(?:\s+(?:bte|bt|boîte|boite|bus)\s*\S+)?`;
  let m: RegExpExecArray | null;
  switch (level) {
    case 1:
      return { municipality: name };
    case 2:
      m = /^(\d{4})\s+(.+)$/.exec(name);
      return m ? { postcode: m[1], municipality: m[2] } : { municipality: name };
    case 4:
      m = new RegExp(String.raw`^(.*?\S)\s+(\d+[^\s]*)${box}\s+(\d{4})\s+(.+)$`, 'i').exec(name);
      if (m && /[^\d\s]/.test(m[1])) return { street: m[1], number: m[2], postcode: m[3], municipality: m[4] };
      m = new RegExp(String.raw`^(\d+[^\s]*)${box}\s+(.*\S)\s+(\d{4})\s+(.+)$`, 'i').exec(name);
      if (m) return { street: m[2], number: m[1], postcode: m[3], municipality: m[4] };
      m = /^(.*\S)\s+(\d+[^\s]*)\s+(\S.*)$/.exec(name);
      if (m) return { street: m[1], number: m[2], municipality: m[3] };
      return { street: name };
    case 7:
      return { place: name };
    default: {
      // 3 (rue), 5 et 6 (routes régionales)
      m = /^(.*\S)\s+(\d{4})\s+(.+)$/.exec(name);
      if (m) return { street: m[1], postcode: m[2], municipality: m[3] };
      const split = splitMunicipalitySuffix(name);
      return split ?? { street: name };
    }
  }
}

const WAL_KIND: Readonly<Record<number, Kind>> = { 1: 'commune', 2: 'commune', 3: 'rue', 4: 'adresse', 5: 'rue', 6: 'rue', 7: 'lieu' };

function geometryPoint(g: unknown, fallbackCrs: Crs | null): { lat: number; lon: number } | null {
  if (!isObj(g)) return null;
  const coords = Array.isArray(g.coordinates) ? g.coordinates : null;
  if (!coords || coords.length < 2) return null;
  const crsName = isObj(g.crs) && isObj(g.crs.properties) ? g.crs.properties.name : undefined;
  return toWgs84(num(coords[0]), num(coords[1]), crsFromName(crsName) ?? fallbackCrs);
}

export function parseWal(body: unknown): Candidate[] {
  if (!isObj(body) || !Array.isArray(body.candidates)) throw new FormatError('candidates absent');
  const requested = isObj(body.geotag) ? crsFromName(body.geotag.crs) : null;
  const items = body.candidates.filter(isObj);
  const scores = relativeScores(items.map((c) => (typeof c.score === 'number' ? c.score : undefined)));
  const out: Candidate[] = [];
  items.forEach((c, i) => {
    const tag = isObj(c.geotag) ? c.geotag : null;
    if (!tag) return;
    const level = Number(tag.level);
    const kind = WAL_KIND[level];
    const name = str(tag.name);
    if (!kind || !name) return;
    const p = geometryPoint(tag.geometry, requested ?? 'EPSG:31370');
    if (!p) return;
    const parts = parseWalName(level, name);
    const lang = str(tag.lang)?.toLowerCase();
    const variant: Variant = {
      lang: lang === 'fr' || lang === 'nl' || lang === 'de' ? lang : undefined,
      street: cleanName(parts.street),
      municipality: cleanMunicipality(parts.municipality),
      place: cleanName(parts.place),
    };
    out.push({
      source: 'wal',
      kind,
      approx: kind === 'rue' || kind === 'commune',
      lat: p.lat,
      lon: p.lon,
      number: cleanNumber(parts.number),
      postcode: parts.postcode,
      variants: [variant],
      id: `${level}:${str(tag.ident) ?? name}`,
      srcScore: scores[i],
      order: i,
      region: regionOf(parts.postcode, 'wal'),
    });
  });
  return out;
}

/* ------------------------------ Bruxelles (lecture tolérante) ------------------------------ */

type Named = Partial<Record<'fr' | 'nl' | 'de', string>> & { any?: string };

const LANG_KEYS = ['fr', 'nl', 'de'] as const;

/** Nom dans les langues disponibles : chaîne, { fr, nl }, [{ language, spelling }], { name: … }, { geographicalName: … }. */
export function namesOf(v: unknown, depth = 0): Named {
  if (depth > 5 || v === null || v === undefined) return {};
  const s = str(v);
  if (s !== undefined && typeof v !== 'number') return { any: s };
  const out: Named = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      if (isObj(item)) {
        const lang = str(item.language ?? item.lang ?? item.languageCode ?? item['@language'])?.toLowerCase().slice(0, 2);
        const text = str(item.spelling ?? item.value ?? item.name ?? item.text ?? item['#text'] ?? item.label);
        if (text && (lang === 'fr' || lang === 'nl' || lang === 'de')) out[lang] ??= text;
        else if (text) out.any ??= text;
        else Object.assign(out, { ...namesOf(item, depth + 1), ...out });
      } else {
        const t = str(item);
        if (t) out.any ??= t;
      }
    }
    return out;
  }
  if (!isObj(v)) return out;
  for (const k of LANG_KEYS) {
    const t = str(v[k]) ?? str(v[k.toUpperCase()]);
    if (t) out[k] = t;
  }
  if (out.fr || out.nl || out.de) return out;
  for (const key of ['name', 'names', 'geographicalName', 'geographicalNames', 'spelling', 'label', 'value', 'streetName', 'streetname', 'municipalityName']) {
    if (key in v) {
      const sub = namesOf(v[key], depth + 1);
      if (sub.fr || sub.nl || sub.de || sub.any) return sub;
    }
  }
  return out;
}

/** Première valeur dont la clé correspond (recherche en profondeur limitée). */
function findKey(o: unknown, re: RegExp, depth = 0): unknown {
  if (!isObj(o) || depth > 4) return undefined;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && v !== null && v !== undefined) return v;
  for (const v of Object.values(o)) {
    if (isObj(v)) {
      const found = findKey(v, re, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Position : pos « x y » ou [x, y], coordinates [x, y], ou { x, y } ; srsName ou crs n'importe où sur le chemin. */
export function positionOf(o: unknown, depth = 0, crs: Crs | null = null): { lat: number; lon: number } | null {
  if (!isObj(o) || depth > 6) return null;
  const here = crsFromName(o.srsName ?? o.srs ?? o.crs ?? (isObj(o.crs) && isObj(o.crs.properties) ? o.crs.properties.name : undefined)) ?? crs;
  const pair = (v: unknown): [number, number] | null => {
    if (typeof v === 'string') {
      const n = v.trim().split(/[\s,]+/).map(Number);
      return n.length >= 2 && n.every(Number.isFinite) ? [n[0], n[1]] : null;
    }
    if (Array.isArray(v) && v.length >= 2) {
      const n = [num(v[0]), num(v[1])];
      return n.every(Number.isFinite) ? [n[0], n[1]] : null;
    }
    return null;
  };
  for (const key of ['pos', 'coordinates', 'coordinate']) {
    const p = pair(o[key]);
    if (p) return toWgs84(p[0], p[1], here ?? 'EPSG:31370');
  }
  if (Number.isFinite(num(o.x)) && Number.isFinite(num(o.y))) return toWgs84(num(o.x), num(o.y), here ?? 'EPSG:31370');
  if (Number.isFinite(num(o.lat)) && Number.isFinite(num(o.lon))) return toWgs84(num(o.lon), num(o.lat), 'EPSG:4326');
  for (const key of ['position', 'addressPosition', 'pointGeometry', 'point', 'geometry', 'location', 'centroid']) {
    if (key in o) {
      const p = positionOf(o[key], depth + 1, here);
      if (p) return p;
    }
  }
  return null;
}

const KEY_NUMBER = /^(houseNumber|policeNumber|housenumber|huisnummer|number|numero)$/i;
const KEY_POSTCODE = /^(postalCode|postCode|postcode|zipcode|zipCode|postalInfo|hasPostalInfo)$/i;
const KEY_STREET = /^(streetName|streetname|hasStreetName|street|thoroughfare|straatnaam)$/i;
const KEY_MUNI = /^(municipality|municipalityName|hasMunicipality|gemeente|commune)$/i;

function postcodeOf(v: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  const direct = str(v);
  if (direct && /^\d{4}$/.test(direct)) return direct;
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = postcodeOf(item, depth + 1);
      if (found) return found;
    }
  }
  if (isObj(v)) {
    for (const k of ['postalCode', 'postCode', 'code', 'objectIdentifier', 'id', 'value']) {
      const found = postcodeOf(v[k], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function variantsOf(street: Named, muni: Named, place: Named, lang: Lang): Variant[] {
  const out: Variant[] = [];
  for (const l of ['fr', 'nl', 'de'] as const) {
    const s = street[l];
    const m = muni[l];
    const p = place[l];
    if (s || m || p) out.push({ lang: l, street: cleanName(s ?? street.any), municipality: cleanMunicipality(m ?? muni.any), place: cleanName(p ?? place.any) });
  }
  if (!out.length) out.push({ lang, street: cleanName(street.any), municipality: cleanMunicipality(muni.any), place: cleanName(place.any) });
  return out;
}

const BRU_KIND: readonly [RegExp, Kind][] = [
  [/address|adres/i, 'adresse'],
  [/street|straat|rue/i, 'rue'],
  [/municipality|gemeente|commune|postal/i, 'commune'],
  [/place|plaats|lieu|poi/i, 'lieu'],
];

/** Un objet de résultat : { score, address | streetname | municipality | placeName } ou l'objet lui-même. */
function bruCandidate(item: Record<string, unknown>, objectType: string, lang: Lang, order: number, score: number | undefined): Omit<Candidate, 'srcScore'> & { raw?: number } | null {
  let kind: Kind | undefined;
  let obj: unknown;
  for (const [key, k] of [['address', 'adresse'], ['streetname', 'rue'], ['streetName', 'rue'], ['placeName', 'lieu'], ['municipality', 'commune']] as const) {
    if (isObj(item[key])) {
      kind = k;
      obj = item[key];
      break;
    }
  }
  if (!obj) {
    obj = item;
    kind = BRU_KIND.find(([re]) => re.test(objectType))?.[1];
  }
  if (!isObj(obj)) return null;
  const number = cleanNumber(str(findKey(obj, KEY_NUMBER)));
  if (!kind) kind = number ? 'adresse' : findKey(obj, KEY_STREET) !== undefined ? 'rue' : 'commune';
  const pos = positionOf(obj);
  if (!pos) return null;
  const street = kind === 'adresse' || kind === 'rue' ? namesOf(kind === 'rue' && !findKey(obj, KEY_STREET) ? obj : findKey(obj, KEY_STREET)) : {};
  const muni = namesOf(kind === 'commune' && !findKey(obj, KEY_MUNI) ? obj : findKey(obj, KEY_MUNI));
  const place = kind === 'lieu' ? namesOf(findKey(obj, /^(placeName|name|names)$/i) ?? obj) : {};
  const postcode = postcodeOf(findKey(obj, KEY_POSTCODE));
  const variants = variantsOf(street, muni, place, lang);
  if (!variants.some((v) => v.street || v.municipality || v.place)) return null;
  const idv = findKey(obj, /^(objectIdentifier|id|identifier|code)$/i);
  return {
    source: 'bru',
    kind,
    approx: kind === 'rue' || kind === 'commune',
    lat: pos.lat,
    lon: pos.lon,
    number: kind === 'adresse' ? number : undefined,
    postcode,
    variants,
    id: str(idv) ?? (isObj(idv) ? str(idv.objectIdentifier) : undefined),
    order,
    region: regionOf(postcode, 'bru'),
    raw: score,
  };
}

export function parseBru(body: unknown, lang: Lang): Candidate[] {
  let groups: { objectType: string; items: Record<string, unknown>[] }[] = [];
  const asItems = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : []);
  if (isObj(body) && Array.isArray(body.resultsList)) {
    groups = body.resultsList.filter(isObj).map((g) => ({
      objectType: str(g.objectType) ?? '',
      items: g.result !== undefined ? asItems(g.result) : [g],
    }));
  } else if (isObj(body) && Array.isArray(body.results)) {
    groups = [{ objectType: '', items: asItems(body.results) }];
  } else if (Array.isArray(body)) {
    groups = [{ objectType: '', items: asItems(body) }];
  } else if (isObj(body) && Array.isArray(body.result)) {
    groups = [{ objectType: str(body.objectType) ?? '', items: asItems(body.result) }];
  } else {
    throw new FormatError('resultsList absent');
  }
  const found: (Omit<Candidate, 'srcScore'> & { raw?: number })[] = [];
  let order = 0;
  for (const g of groups) {
    for (const item of g.items) {
      const score = typeof item.score === 'number' ? item.score : undefined;
      const c = bruCandidate(item, g.objectType, lang, order++, score);
      if (c) found.push(c);
    }
  }
  const scores = relativeScores(found.map((c) => c.raw));
  return found.map(({ raw: _raw, ...c }, i) => ({ ...c, srcScore: scores[i] }));
}

export function parseSource(id: GeoId, body: unknown, lang: Lang): Candidate[] {
  if (id === 'vla') return parseVla(body);
  if (id === 'wal') return parseWal(body);
  return parseBru(body, lang);
}
