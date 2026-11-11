/**
 * Quai, contrôle qualité : validation d'un dossier de données produit par le pipeline (npm run build-data).
 *
 * Vérifie chaque fichier contre la sémantique de shared/types.ts : types, bornes, ordres de tri,
 * références croisées (zones des tuiles, index des départs, zones de patterns.next, gares des trains,
 * clés de recherche cohérentes avec searchWords()/searchKey()), noms non vides, identifiants normalisés.
 * 1.1 : départs uniques (un par voyage et par zone, aucun vers un terminus de la zone, pas de doublon), zones
 * sans départ absentes des tuiles et de la recherche, `aka` des zones fusionnées, -1 des trains (montée ou
 * descente interdite), fichiers de ligne (lines/{op}/, lines/index.json, linetiles/) cohérents entre eux, avec
 * les zones et avec meta.json (même génération). Règles 1.0 fausses sur les vraies données (revue technique
 * m10) corrigées : motifs de route différente, noms TEC traduits, lignes résumées, gares SNCB étrangères.
 *
 * Usage : npx tsx validate-data.ts <dossier> [--json]
 * Code de sortie : 0 si aucune erreur, 1 sinon (les avertissements ne font pas échouer).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AreaFile, AreaSummary, LineFile, LineIndex, LineTile, Meta, Mode, Names, Op, SearchFile, TileFile, TrainsDay } from '../../shared/types';
import { normalizeId, tileKey } from '../../shared/types';
import { ACRONYMS, prettyName, searchKey, searchWords } from '../../shared/names';

export const OPS: Op[] = ['sncb', 'stib', 'delijn', 'tec'];
export const MODES: Mode[] = ['train', 'metro', 'tram', 'bus'];
const URBAN = ['stib', 'delijn', 'tec'] as const;
const EM_DASH = '\u2014';
/** Rayon des correspondances attendu dans lines/index.json et meta.lines. */
const CONN_M = 400;

export interface ValidationReport {
  dir: string;
  errors: string[];
  warnings: string[];
  stats: {
    files: number;
    bytes: number;
    areas: Record<Op, number>;
    deps: number;
    patterns: number;
    tiles: number;
    searchFiles: number;
    trains: Record<string, number>;
    /** 1.1 : fichiers de ligne et tuiles de lignes. */
    lines: number;
    lineTiles: number;
  };
}

/** Distance en mètres (haversine, comme le pipeline). */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Vrai pour un nom TEC qui commence encore par la commune en capitales (« WATERLOO Eglise ») : premier mot en
 * capitales suivi d'un mot en casse normale, hors sigles (« CHU Liège », « TEC … », « L-L-N, Gare »).
 */
export function tecCapitals(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return false;
  const letters = words[0].replace(/[^\p{L}]/gu, '');
  if (letters.length < 2 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return false;
  if (ACRONYMS.has(letters.toLowerCase()) || (letters.length >= 3 && !/[aeiouyàâéèêëîïôöûü]/i.test(letters)) || /^(?:\p{Lu}-)+\p{Lu},?$/u.test(words[0])) return false;
  return /\p{Lu}\p{Ll}/u.test(words.slice(1).join(' '));
}

/** Autorisations par défaut d'un motif de ligne : montée seule, les deux…, descente seule. */
const defaultFlags = (n: number) => (n < 2 ? 'b'.repeat(n) : `b${'x'.repeat(n - 2)}a`);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const fileKeyOf = (areaKey: string) => areaKey.replace(/[^A-Za-z0-9_-]/g, '_');
const sameNames = (a: Names, b: Names) => a.fr === b.fr && a.nl === b.nl && (a.l ?? 'fr') === (b.l ?? 'fr');
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export function validateData(dirArg: string): ValidationReport {
  const dir = resolve(dirArg);
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);
  const stats: ValidationReport['stats'] = {
    files: 0,
    bytes: 0,
    areas: { sncb: 0, stib: 0, delijn: 0, tec: 0 },
    deps: 0,
    patterns: 0,
    tiles: 0,
    searchFiles: 0,
    trains: {},
    lines: 0,
    lineTiles: 0,
  };
  const report = (): ValidationReport => ({ dir, errors, warnings, stats });

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(`dossier introuvable : ${dir}`);
    return report();
  }

  /** Lecture d'un JSON : compact, UTF-8 propre, sans tiret cadratin. */
  const readJson = (rel: string): unknown => {
    const path = join(dir, rel);
    let text: string;
    try {
      const buf = readFileSync(path);
      stats.files++;
      stats.bytes += buf.length;
      text = buf.toString('utf8');
    } catch (e) {
      err(`${rel} : lecture impossible (${(e as Error).message})`);
      return undefined;
    }
    if (text.includes('�')) err(`${rel} : caractère de remplacement U+FFFD (encodage)`);
    if (text.charCodeAt(0) === 0xfeff) err(`${rel} : BOM UTF-8 en tête`);
    if (/\n\s/.test(text)) err(`${rel} : JSON indenté (attendu compact)`);
    if (text.includes(EM_DASH)) err(`${rel} : tiret cadratin dans un texte`);
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      err(`${rel} : JSON invalide (${(e as Error).message})`);
      return undefined;
    }
  };

  const checkNames = (where: string, n: unknown): n is Names => {
    if (!isObj(n)) {
      err(`${where} : noms absents`);
      return false;
    }
    for (const k of ['fr', 'nl'] as const) {
      const v = n[k];
      if (!isStr(v) || !v.trim()) err(`${where} : nom ${k} vide`);
      else {
        if (v !== v.trim() || /\s{2,}/.test(v)) err(`${where} : nom ${k} mal espacé « ${v} »`);
        const letters = v.replace(/[^\p{L}]/gu, '');
        // tout en majuscules alors que prettyName l'aurait remis en casse (les sigles « WTC », « UZ-VUB » restent permis)
        if (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && prettyName(v) !== v) {
          err(`${where} : nom ${k} tout en majuscules « ${v} » (prettyName non appliqué)`);
        }
      }
    }
    if ('l' in n && n.l !== undefined && n.l !== 'fr' && n.l !== 'nl') err(`${where} : langue locale invalide ${JSON.stringify(n.l)}`);
    for (const k of Object.keys(n)) if (!['fr', 'nl', 'l'].includes(k)) warn(`${where} : champ de nom inattendu « ${k} »`);
    return true;
  };
  const checkLatLon = (where: string, lat: unknown, lon: unknown): boolean => {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      err(`${where} : position invalide (${String(lat)}, ${String(lon)})`);
      return false;
    }
    if (lat < 49.3 || lat > 51.6 || lon < 2.3 || lon > 6.6) warn(`${where} : position hors de Belgique (${lat}, ${lon})`);
    return true;
  };
  const checkId = (where: string, id: unknown): id is string => {
    if (!isStr(id) || !id) {
      err(`${where} : identifiant vide`);
      return false;
    }
    if (normalizeId(id) !== id) err(`${where} : identifiant non normalisé « ${id} »`);
    if (id !== id.trim()) err(`${where} : identifiant avec espaces « ${id} »`);
    return true;
  };

  /* ------------------------------ meta.json ------------------------------ */
  const metaRaw = readJson('meta.json');
  if (!isObj(metaRaw)) {
    err('meta.json : absent ou illisible');
    return report();
  }
  const meta = metaRaw as unknown as Meta;
  if (meta.v !== 1) err('meta.json : v doit valoir 1');
  if (!isStr(meta.generatedAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(meta.generatedAt) || !Number.isFinite(Date.parse(meta.generatedAt))) {
    err(`meta.json : generatedAt n'est pas une date ISO 8601 (${String(meta.generatedAt)})`);
  }
  if (meta.timezone !== 'Europe/Brussels') err(`meta.json : timezone attendu Europe/Brussels (${String(meta.timezone)})`);
  const dates = Array.isArray(meta.serviceDates) ? meta.serviceDates : [];
  if (dates.length !== 2) err(`meta.json : serviceDates doit contenir 2 dates (${dates.length})`);
  for (const d of dates) {
    if (!isStr(d) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || addDays(d, 0) !== d) err(`meta.json : date de service invalide ${JSON.stringify(d)}`);
  }
  if (dates.length === 2 && addDays(dates[0], 1) !== dates[1]) err(`meta.json : les dates de service ne se suivent pas (${dates.join(', ')})`);
  const tile = isObj(meta.tile) ? meta.tile : { lat: NaN, lon: NaN };
  if (tile.lat !== 0.02 || tile.lon !== 0.03) err(`meta.json : taille de tuile attendue { lat: 0.02, lon: 0.03 } (${JSON.stringify(meta.tile)})`);
  if (!isObj(meta.feeds)) err('meta.json : feeds absent');
  const feeds = (isObj(meta.feeds) ? meta.feeds : {}) as Meta['feeds'];
  for (const k of Object.keys(feeds)) if (!OPS.includes(k as Op)) err(`meta.json : réseau inconnu dans feeds « ${k} »`);
  for (const op of OPS) {
    const f = feeds[op];
    if (!isObj(f)) {
      err(`meta.json : feeds.${op} absent`);
      continue;
    }
    if (typeof f.ok !== 'boolean') err(`meta.json : feeds.${op}.ok n'est pas un booléen`);
    if (!isInt(f.areas) || f.areas < 0) err(`meta.json : feeds.${op}.areas invalide`);
    if (!isInt(f.trips) || f.trips < 0) err(`meta.json : feeds.${op}.trips invalide`);
    if (f.ok === false && (!isStr(f.error) || !f.error.trim())) err(`meta.json : feeds.${op} en échec sans message`);
    if (f.ok === true && f.error !== undefined) warn(`meta.json : feeds.${op} ok mais avec un message d'erreur`);
    if (f.feedVersion !== undefined && !isStr(f.feedVersion)) err(`meta.json : feeds.${op}.feedVersion n'est pas une chaîne`);
    if (f.cachedFrom !== undefined) {
      // repli sur le GTFS gardé d'une nuit précédente (pipeline --cache-dir)
      if (!isStr(f.cachedFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(f.cachedFrom) || addDays(f.cachedFrom, 0) !== f.cachedFrom) err(`meta.json : feeds.${op}.cachedFrom invalide ${JSON.stringify(f.cachedFrom)}`);
      else {
        if (f.ok !== true) err(`meta.json : feeds.${op}.cachedFrom sur un réseau en échec`);
        const age = dates[0] ? Math.round((Date.parse(`${dates[0]}T12:00:00Z`) - Date.parse(`${f.cachedFrom}T12:00:00Z`)) / 86_400_000) : 0;
        if (age > 8) err(`meta.json : feeds.${op}.cachedFrom ${f.cachedFrom} a plus de 7 jours`);
        warn(`meta.json : ${op} repris du GTFS gardé du ${f.cachedFrom}`);
      }
    }
    if (isStr(f.error) && f.error.includes(EM_DASH)) err(`meta.json : tiret cadratin dans feeds.${op}.error`);
  }
  if (!existsSync(join(dir, 'LICENSE-DATA.txt'))) err('LICENSE-DATA.txt absent');
  for (const name of readdirSync(dir)) {
    if (!['meta.json', 'LICENSE-DATA.txt', 'tiles', 'areas', 'search', 'trains', 'lines', 'linetiles'].includes(name)) warn(`fichier inattendu à la racine : ${name}`);
  }

  /* ------------------------------ zones ------------------------------ */
  const areas = new Map<string, AreaFile>(); // id → fichier
  const areaDir = join(dir, 'areas');
  for (const op of OPS) {
    const opDir = join(areaDir, op);
    const names = existsSync(opDir) ? readdirSync(opDir) : [];
    for (const name of names) {
      const rel = `areas/${op}/${name}`;
      if (!name.endsWith('.json')) {
        warn(`${rel} : fichier inattendu`);
        continue;
      }
      const raw = readJson(rel);
      if (!isObj(raw)) {
        err(`${rel} : contenu invalide`);
        continue;
      }
      const a = raw as unknown as AreaFile;
      if (a.v !== 1) err(`${rel} : v doit valoir 1`);
      if (!isStr(a.id) || !a.id.startsWith(`${op}:`)) {
        err(`${rel} : id « ${String(a.id)} » ne commence pas par « ${op}: »`);
        continue;
      }
      const key = a.id.slice(op.length + 1);
      checkId(`${rel} : clé de zone`, key);
      if (`${fileKeyOf(key)}.json` !== name) err(`${rel} : nom de fichier attendu ${fileKeyOf(key)}.json pour ${a.id}`);
      if (a.op !== op) err(`${rel} : op « ${String(a.op)} » au lieu de « ${op} »`);
      if (areas.has(a.id)) err(`${rel} : zone ${a.id} en double`);
      checkNames(`${rel} : n`, a.n);
      checkLatLon(rel, a.lat, a.lon);
      if (isObj(a.n)) {
        if (op === 'delijn' && a.n.l !== 'nl') err(`${rel} : De Lijn doit avoir l = 'nl'`);
        // noms TEC traduits à Bruxelles : permis (revue technique m10)
        if (op === 'tec' && a.n.fr !== a.n.nl) warn(`${rel} : nom TEC traduit (fr ≠ nl)`);
        // S5 : commune TEC en capitales remise en casse (« WATERLOO Eglise » → « Waterloo Eglise »)
        if (op === 'tec' && isStr(a.n.fr) && tecCapitals(a.n.fr)) err(`${rel} : nom TEC avec la commune en capitales « ${a.n.fr} » (tecName non appliqué)`);
      }
      areas.set(a.id, a);
      stats.areas[op]++;
    }
    const f = feeds[op];
    if (isObj(f) && isInt(f.areas) && f.areas !== names.filter((n) => n.endsWith('.json')).length) {
      err(`meta.json : feeds.${op}.areas = ${f.areas} mais ${names.length} fichiers de zone`);
    }
    if (isObj(f) && f.ok === false && names.length) err(`areas/${op} : ${names.length} fichiers alors que le réseau est en échec`);
  }
  for (const name of existsSync(areaDir) ? readdirSync(areaDir) : []) if (!OPS.includes(name as Op)) warn(`areas/${name} : dossier inattendu`);

  const referencedByNext = new Set<string>();
  for (const [id, a] of areas) {
    const rel = `zone ${id}`;
    const op = a.op;
    /* arrêts physiques */
    if (!Array.isArray(a.stops) || !a.stops.length) {
      err(`${rel} : aucun arrêt physique`);
    }
    const stops = Array.isArray(a.stops) ? a.stops : [];
    const stopIds = new Set<string>();
    stops.forEach((s, i) => {
      const w = `${rel} : stops[${i}]`;
      if (!isObj(s)) {
        err(`${w} : invalide`);
        return;
      }
      if (!checkId(w, s.id)) return;
      if (stopIds.has(s.id)) err(`${w} : arrêt ${s.id} en double`);
      stopIds.add(s.id);
      if (s.platform !== undefined && (!isStr(s.platform) || !s.platform.trim())) err(`${w} : quai vide`);
      if (!isStr(s.rt) || !s.rt) err(`${w} : rt vide`);
      else if (op === 'stib') {
        if (!/^\d+$/.test(s.rt)) err(`${w} : rt STIB non numérique « ${s.rt} »`);
        if (s.rt !== s.id.replace(/[A-Za-z]+$/, '')) err(`${w} : rt STIB « ${s.rt} » ≠ pointid de ${s.id}`);
      } else if (s.rt !== normalizeId(s.id)) err(`${w} : rt « ${s.rt} » ≠ stop_id normalisé ${s.id}`);
      if (op === 'sncb') {
        const key = id.slice(5);
        const m = /^(\d+)(?:_(.+))?$/.exec(s.id);
        // gares étrangères (clé non numérique) : arrêts nommés autrement, permis (revue technique m10)
        if (!m || m[1] !== key) (/^\d+$/.test(key) ? err : warn)(`${w} : arrêt SNCB ${s.id} hors de la gare ${key}`);
        else if (m[2] && s.platform !== m[2]) err(`${w} : quai SNCB « ${String(s.platform)} » ≠ suffixe de ${s.id}`);
      }
    });
    /* motifs */
    const patterns = Array.isArray(a.patterns) ? a.patterns : [];
    if (!Array.isArray(a.patterns)) err(`${rel} : patterns absent`);
    stats.patterns += patterns.length;
    const patternKeys = new Map<string, number>();
    patterns.forEach((p, i) => {
      const w = `${rel} : patterns[${i}]`;
      if (!isObj(p)) {
        err(`${w} : invalide`);
        return;
      }
      if (!isStr(p.line) || !p.line.trim()) err(`${w} : ligne vide`);
      if (!MODES.includes(p.mode)) err(`${w} : mode invalide ${JSON.stringify(p.mode)}`);
      // bus de remplacement de la SNCB (catégorie BUS) : réels sur les vraies données
      if (op === 'sncb' && p.mode !== 'train') (p.mode === 'bus' ? warn : err)(`${w} : mode ${p.mode} pour une gare SNCB`);
      if (op !== 'sncb' && p.mode === 'train') warn(`${w} : mode train hors SNCB`);
      if (!isStr(p.route) || !p.route) err(`${w} : route vide`);
      else if (normalizeId(p.route) !== p.route) err(`${w} : route non normalisée « ${p.route} »`);
      checkNames(`${w}.head`, p.head);
      if (!Array.isArray(p.next)) {
        err(`${w} : next absent`);
        return;
      }
      if (p.next.length > 60) err(`${w} : next contient ${p.next.length} zones (max 60)`);
      let prevMin = -Infinity;
      const seen = new Set<string>();
      p.next.forEach((x, k) => {
        if (!Array.isArray(x) || x.length !== 2 || !isStr(x[0]) || !isInt(x[1])) {
          err(`${w}.next[${k}] : attendu [zone, minutes entières] (${JSON.stringify(x)})`);
          return;
        }
        const [nid, m] = x;
        referencedByNext.add(nid);
        if (!areas.has(nid)) err(`${w}.next[${k}] : zone ${nid} sans fichier`);
        if (m < 0 || m > 24 * 60) err(`${w}.next[${k}] : minutes hors bornes (${m})`);
        if (m < prevMin) err(`${w}.next[${k}] : minutes décroissantes (${prevMin} puis ${m})`);
        prevMin = m;
        if (nid === id) warn(`${w}.next[${k}] : la zone se dessert elle-même`);
        if (seen.has(nid)) warn(`${w}.next[${k}] : zone ${nid} répétée`);
        seen.add(nid);
      });
      // même ligne, destination et next mais route différente : réel et bénin (revue technique m10)
      const pk = JSON.stringify([p.line, p.mode, p.route, p.head, p.next]);
      if (patternKeys.has(pk)) err(`${w} : motif identique à patterns[${patternKeys.get(pk)}] (même ligne, route, destination et next)`);
      else patternKeys.set(pk, i);
      if (op !== 'sncb' && (p.mode === 'tram' || p.mode === 'metro') && isStr(p.line) && new RegExp(`^${p.mode === 'tram' ? 'T' : 'M'}\\s?\\d`, 'i').test(p.line)) {
        err(`${w} : ligne « ${p.line} » déjà préfixée (l'appli afficherait « ${p.mode === 'tram' ? 'T' : 'M'}${p.line} »)`);
      }
    });
    /* départs */
    if (!Array.isArray(a.deps)) {
      err(`${rel} : deps absent`);
      continue;
    }
    stats.deps += a.deps.length;
    const usedPatterns = new Set<number>();
    const usedStops = new Set<number>();
    const rowKeys = new Set<string>();
    const tripSeq = new Set<string>();
    const tripDay = new Set<string>();
    const sameDep = new Set<string>();
    let prev: [number, number] = [-1, -1];
    a.deps.forEach((d, i) => {
      const w = `${rel} : deps[${i}]`;
      if (!Array.isArray(d) || d.length !== 6) {
        err(`${w} : attendu 6 éléments (${JSON.stringify(d)})`);
        return;
      }
      const [day, min, pat, stop, trip, seq] = d;
      if (!isInt(day) || day < 0 || day >= dates.length) err(`${w} : jour invalide ${JSON.stringify(day)}`);
      if (!isInt(min) || min < 0 || min >= 48 * 60) err(`${w} : minutes invalides ${JSON.stringify(min)}`);
      if (!isInt(pat) || pat < 0 || pat >= patterns.length) err(`${w} : motif ${JSON.stringify(pat)} hors de patterns (${patterns.length})`);
      else usedPatterns.add(pat);
      if (!isInt(stop) || stop < 0 || stop >= stops.length) err(`${w} : arrêt ${JSON.stringify(stop)} hors de stops (${stops.length})`);
      else usedStops.add(stop);
      if (!isStr(trip)) err(`${w} : trip_id n'est pas une chaîne`);
      else if (op === 'stib') {
        if (trip !== '') err(`${w} : trip_id STIB attendu vide (« ${trip} »)`);
      } else if (!trip) err(`${w} : trip_id vide hors STIB`);
      else if (normalizeId(trip) !== trip) err(`${w} : trip_id non normalisé « ${trip} »`);
      if (!isInt(seq) || seq < 0) err(`${w} : stop_sequence invalide ${JSON.stringify(seq)}`);
      if (isInt(day) && isInt(min)) {
        if (day < prev[0] || (day === prev[0] && min < prev[1])) err(`${w} : départs non triés par (jour, minutes)`);
        prev = [day, min];
      }
      const rk = JSON.stringify(d);
      if (rowKeys.has(rk)) err(`${w} : départ en double ${rk}`);
      rowKeys.add(rk);
      if (op !== 'stib' && isStr(trip) && trip) {
        const ts = `${day}|${trip}|${seq}`;
        if (tripSeq.has(ts)) err(`${w} : même voyage et même stop_sequence deux fois (${ts})`);
        tripSeq.add(ts);
        // 1.1 (M8.2) : un départ par voyage et par zone
        const td = `${day}|${trip}`;
        if (tripDay.has(td)) err(`${w} : même voyage deux fois dans la zone le même jour (${td})`);
        tripDay.add(td);
      }
      const p = isInt(pat) ? patterns[pat] : undefined;
      if (p && isObj(p)) {
        // 1.1 (M8.2) : pas de départ vers un terminus situé dans la zone même ; pas de départ en double
        if (Array.isArray(p.next) && !p.next.length) err(`${w} : départ vers un terminus de la zone même (next vide)`);
        const sk = `${day}|${min}|${stop}|${p.line}|${p.head?.fr}`;
        if (sameDep.has(sk)) err(`${w} : départ en double (même jour, minute, arrêt, ligne et destination : ${sk})`);
        sameDep.add(sk);
      }
    });
    patterns.forEach((_, i) => {
      if (!usedPatterns.has(i)) warn(`${rel} : patterns[${i}] sans aucun départ`);
    });
    if (!a.deps.length && !referencedByNext.has(id)) {
      // vérifié de nouveau plus bas, une fois toutes les zones lues
    }
    void usedStops;
  }
  for (const [id, a] of areas) {
    if (Array.isArray(a.deps) && !a.deps.length && !referencedByNext.has(id)) warn(`zone ${id} : ni départ ni arrivée (zone non desservie)`);
  }

  /* trips par réseau (De Lijn, TEC : voyages distincts des départs) */
  for (const op of ['delijn', 'tec'] as const) {
    const f = feeds[op];
    if (!isObj(f) || f.ok !== true) continue;
    const trips = new Set<string>();
    for (const a of areas.values()) if (a.op === op && Array.isArray(a.deps)) for (const d of a.deps) if (Array.isArray(d) && isStr(d[4])) trips.add(d[4]);
    if (trips.size !== f.trips) err(`meta.json : feeds.${op}.trips = ${f.trips} mais ${trips.size} voyages distincts dans les départs`);
  }

  /* ------------------------------ tuiles ------------------------------ */
  const servingIndex = new Map<string, { lines: Set<string>; modes: Set<Mode> }>();
  const servingOf = (id: string) => {
    let v = servingIndex.get(id);
    if (!v) servingIndex.set(id, (v = { lines: new Set(), modes: new Set() }));
    return v;
  };
  for (const [id, a] of areas) {
    for (const p of Array.isArray(a.patterns) ? a.patterns : []) {
      if (!isObj(p)) continue;
      const targets = [id, ...(Array.isArray(p.next) ? p.next.map((x) => (Array.isArray(x) ? String(x[0]) : '')) : [])];
      for (const t of targets) {
        if (!t) continue;
        servingOf(t).lines.add(p.line);
        servingOf(t).modes.add(p.mode);
      }
    }
  }
  /** 1.1 (S5) : seules les zones qui ont au moins un départ figurent dans les tuiles et la recherche. */
  const departing = (id: string) => (areas.get(id)?.deps?.length ?? 0) > 0;
  /** Lignes des départs d'une zone (résumé AreaSummary.lines). */
  const depLines = (a: AreaFile) => new Set(a.deps.map((d) => a.patterns[d[2]]?.line).filter((l): l is string => isStr(l)));
  const summaries = new Map<string, AreaSummary>();
  const akaOf = new Map<string, string>(); // ancienne zone fusionnée → zone qui la reprend
  const tileDir = join(dir, 'tiles');
  for (const name of existsSync(tileDir) ? readdirSync(tileDir) : []) {
    const rel = `tiles/${name}`;
    const m = /^(-?\d+)_(-?\d+)\.json$/.exec(name);
    if (!m) {
      err(`${rel} : nom de tuile invalide`);
      continue;
    }
    stats.tiles++;
    const raw = readJson(rel);
    if (!isObj(raw)) continue;
    const t = raw as unknown as TileFile;
    if (t.v !== 1) err(`${rel} : v doit valoir 1`);
    if (!Array.isArray(t.areas)) {
      err(`${rel} : areas absent`);
      continue;
    }
    if (!t.areas.length) err(`${rel} : tuile vide`);
    let prevId = '';
    t.areas.forEach((s, i) => {
      const w = `${rel} : areas[${i}]`;
      if (!isObj(s) || !isStr(s.id)) {
        err(`${w} : invalide`);
        return;
      }
      if (s.id < prevId) warn(`${rel} : zones non triées par id (${prevId} puis ${s.id})`);
      prevId = s.id;
      if (summaries.has(s.id)) err(`${w} : zone ${s.id} présente dans plusieurs tuiles`);
      summaries.set(s.id, s);
      if (!OPS.includes(s.op) || !s.id.startsWith(`${s.op}:`)) err(`${w} : op « ${String(s.op)} » incohérent avec ${s.id}`);
      checkNames(`${w}.n`, s.n);
      if (!checkLatLon(w, s.lat, s.lon)) return;
      const k = tileKey(s.lat, s.lon, isObj(meta.tile) ? meta.tile : undefined);
      if (`${k}.json` !== name) err(`${w} : ${s.id} appartient à la tuile ${k}, pas à ${name}`);
      const a = areas.get(s.id);
      if (!a) {
        err(`${w} : zone ${s.id} sans fichier areas/`);
        return;
      }
      if (isObj(s.n) && isObj(a.n) && !sameNames(s.n, a.n)) err(`${w} : noms différents du fichier de zone (${JSON.stringify(s.n)} / ${JSON.stringify(a.n)})`);
      if (s.lat !== a.lat || s.lon !== a.lon) err(`${w} : position différente du fichier de zone`);
      if (!departing(s.id)) err(`${w} : zone ${s.id} sans aucun départ dans les tuiles (S5 : à retirer de « Autour de moi »)`);
      // 1.1 (M8.3) : anciennes zones fusionnées dans celle-ci
      if (s.aka !== undefined) {
        if (!Array.isArray(s.aka) || !s.aka.length) err(`${w} : aka vide ou invalide`);
        else {
          for (const old of s.aka) {
            if (!isStr(old) || !old.startsWith(`${s.op}:`) || old === s.id) err(`${w} : aka « ${String(old)} » invalide`);
            else if (areas.has(old)) err(`${w} : aka ${old} a encore son fichier de zone`);
            else if (akaOf.has(old)) err(`${w} : aka ${old} déjà repris par ${akaOf.get(old)}`);
            else akaOf.set(old, s.id);
          }
          if (new Set(s.aka).size !== s.aka.length) err(`${w} : aka en double`);
        }
      }
      // lignes qui desservent la zone : départs d'ici + motifs d'autres zones qui y mènent (next)
      const serving = servingOf(s.id);
      if (!Array.isArray(s.modes) || !s.modes.length) err(`${w} : modes vide`);
      else {
        if (new Set(s.modes).size !== s.modes.length) err(`${w} : modes en double`);
        for (const md of s.modes) if (!MODES.includes(md)) err(`${w} : mode invalide ${JSON.stringify(md)}`);
        const want = MODES.filter((md) => serving.modes.has(md));
        if (JSON.stringify([...s.modes].sort()) !== JSON.stringify([...want].sort())) err(`${w} : modes ${JSON.stringify(s.modes)} ≠ modes des lignes qui desservent la zone ${JSON.stringify(want)}`);
        else if (JSON.stringify(s.modes) !== JSON.stringify(want)) warn(`${w} : modes pas dans l'ordre train, métro, tram, bus (${JSON.stringify(s.modes)})`);
        if (!(a.patterns ?? []).length) warn(`${w} : ${s.id} n'a que des arrivées (modes ${JSON.stringify(s.modes)} déduits des lignes qui y mènent)`);
      }
      if (!Array.isArray(s.lines)) err(`${w} : lines absent`);
      else {
        if (s.lines.length > 12) err(`${w} : ${s.lines.length} lignes (max 12)`);
        if (new Set(s.lines).size !== s.lines.length) err(`${w} : lignes en double`);
        // résumé = lignes des départs de la zone (12 au plus) ; les lignes qui ne font qu'y arriver n'en font pas partie (m10)
        const own = Array.isArray(a.deps) && a.deps.length ? depLines(a) : serving.lines;
        for (const l of s.lines) if (!isStr(l) || !l || !own.has(l)) err(`${w} : ligne ${JSON.stringify(l)} ne dessert pas la zone`);
        if (s.lines.length !== Math.min(12, own.size)) err(`${w} : ${s.lines.length} lignes résumées sur ${own.size}`);
      }
    });
  }
  for (const id of areas.keys()) if (!summaries.has(id) && departing(id)) err(`zone ${id} : présente dans areas/ mais dans aucune tuile`);
  for (const old of akaOf.keys()) if (summaries.has(old)) err(`tuiles : ${old} est à la fois une zone et un aka de ${akaOf.get(old)}`);

  /* ------------------------------ recherche ------------------------------ */
  const searchDir = join(dir, 'search');
  const indexed = new Map<string, Set<string>>(); // clé → ids
  for (const name of existsSync(searchDir) ? readdirSync(searchDir) : []) {
    const rel = `search/${name}`;
    const m = /^([a-z0-9]{2})\.json$/.exec(name);
    if (!m) {
      err(`${rel} : nom de fichier de recherche invalide`);
      continue;
    }
    const key = m[1];
    stats.searchFiles++;
    const raw = readJson(rel);
    if (!isObj(raw)) continue;
    const f = raw as unknown as SearchFile;
    if (f.v !== 1) err(`${rel} : v doit valoir 1`);
    if (!Array.isArray(f.items) || !f.items.length) {
      err(`${rel} : items vide ou absent`);
      continue;
    }
    const ids = new Set<string>();
    indexed.set(key, ids);
    f.items.forEach((it, i) => {
      const w = `${rel} : items[${i}]`;
      if (!isObj(it) || !isStr(it.id)) {
        err(`${w} : invalide`);
        return;
      }
      if (ids.has(it.id)) err(`${w} : ${it.id} en double`);
      ids.add(it.id);
      const s = summaries.get(it.id);
      const a = areas.get(it.id);
      if (!a || !s) {
        err(`${w} : ${it.id} sans zone`);
        return;
      }
      if (it.op !== a.op) err(`${w} : op différent de la zone`);
      if (!departing(it.id)) err(`${w} : zone ${it.id} sans aucun départ dans la recherche (S5)`);
      if (!checkNames(`${w}.n`, it.n)) return;
      if (!sameNames(it.n, a.n)) err(`${w} : noms différents de la zone`);
      if (JSON.stringify(it.modes) !== JSON.stringify(s.modes)) err(`${w} : modes différents de la tuile`);
      if (it.lat !== a.lat || it.lon !== a.lon) err(`${w} : position différente de la zone`);
      const keys = searchWords(it.n.fr, it.n.nl).map(searchKey);
      if (!keys.includes(key)) err(`${w} : ${it.id} (« ${it.n.fr} » / « ${it.n.nl} ») n'a aucun mot de clé « ${key} »`);
    });
  }
  for (const [id, a] of areas) {
    if (!isObj(a.n) || !isStr(a.n.fr) || !isStr(a.n.nl) || !departing(id)) continue;
    for (const k of new Set(searchWords(a.n.fr, a.n.nl).map(searchKey))) {
      if (!/^[a-z0-9]{2}$/.test(k)) continue;
      if (!indexed.get(k)?.has(id)) err(`recherche : ${id} (« ${a.n.fr} ») absent de search/${k}.json`);
    }
  }

  /* ------------------------------ trains ------------------------------ */
  const trainsDir = join(dir, 'trains');
  const trainFiles = existsSync(trainsDir) ? readdirSync(trainsDir) : [];
  for (const name of trainFiles) if (!dates.some((d) => `${d}.json` === name)) err(`trains/${name} : date hors de serviceDates`);
  const sncbTrips = new Set<string>();
  /**
   * Départs SNCB attendus d'après trains/ : gare → "jour|trip|seq". Règles 1.1 (M8.2, M1) : un départ par train et
   * par gare, pris dans la première suite de positions consécutives à la gare qui permet de monter (départ ≠ -1, pas
   * le terminus) vers une autre gare où la descente est permise (arrivée ≠ -1).
   */
  const trainDeps = new Map<string, Map<string, { dep: number; platform: string; cat: string; head: Names; next: string[] }>>();
  dates.forEach((date, day) => {
    const rel = `trains/${date}.json`;
    if (!existsSync(join(dir, rel))) {
      err(`${rel} : absent`);
      return;
    }
    const raw = readJson(rel);
    if (!isObj(raw)) return;
    const t = raw as unknown as TrainsDay;
    if (t.v !== 1) err(`${rel} : v doit valoir 1`);
    if (t.date !== date) err(`${rel} : date « ${String(t.date)} » ≠ ${date}`);
    if (!Array.isArray(t.stations) || !Array.isArray(t.trips)) {
      err(`${rel} : stations ou trips absent`);
      return;
    }
    stats.trains[date] = t.trips.length;
    const stIds = new Set<string>();
    t.stations.forEach((s, i) => {
      const w = `${rel} : stations[${i}]`;
      if (!isObj(s) || !isStr(s.id)) {
        err(`${w} : invalide`);
        return;
      }
      if (stIds.has(s.id)) err(`${w} : gare ${s.id} en double`);
      stIds.add(s.id);
      if (!s.id.startsWith('sncb:')) err(`${w} : ${s.id} n'est pas une zone SNCB`);
      const a = areas.get(s.id);
      if (!a) err(`${w} : ${s.id} sans fichier de zone`);
      checkNames(`${w}.n`, s.n);
      checkLatLon(w, s.lat, s.lon);
      if (a && isObj(s.n) && !sameNames(s.n, a.n)) err(`${w} : noms différents de la zone ${s.id}`);
      if (a && (s.lat !== a.lat || s.lon !== a.lon)) err(`${w} : position différente de la zone ${s.id}`);
    });
    const okTime = (v: unknown): v is number => isInt(v) && (v === -1 || (v >= 0 && v < 48 * 60));
    const tripIds = new Set<string>();
    t.trips.forEach((tr, i) => {
      const w = `${rel} : trips[${i}]`;
      if (!isObj(tr) || !checkId(`${w}.id`, tr.id)) return;
      if (tripIds.has(tr.id)) err(`${w} : voyage ${tr.id} en double`);
      tripIds.add(tr.id);
      sncbTrips.add(tr.id);
      if (!isStr(tr.cat) || !tr.cat.trim()) err(`${w} : catégorie vide`);
      if (tr.num !== undefined && (!isStr(tr.num) || !tr.num.trim())) err(`${w} : numéro vide`);
      checkNames(`${w}.head`, tr.head);
      if (!Array.isArray(tr.s) || tr.s.length < 2) {
        err(`${w} : moins de 2 arrêts`);
        return;
      }
      let prevTime = -Infinity;
      let prevSeq = -Infinity;
      let shapeOk = true;
      tr.s.forEach((x, k) => {
        const ws = `${w}.s[${k}]`;
        if (!Array.isArray(x) || x.length !== 5) {
          err(`${ws} : attendu 5 éléments`);
          shapeOk = false;
          return;
        }
        const [si, arr, dep, plat, seq] = x;
        if (!isInt(si) || si < 0 || si >= t.stations.length) {
          err(`${ws} : index de gare ${JSON.stringify(si)} invalide`);
          shapeOk = false;
        }
        // 1.1 : -1 = descente (arrivée) ou montée (départ) interdite
        if (!okTime(arr) || !okTime(dep) || (arr >= 0 && dep >= 0 && dep < arr)) err(`${ws} : heures invalides (${arr}, ${dep})`);
        else {
          const first = arr >= 0 ? arr : dep;
          if (first >= 0 && first < prevTime) err(`${ws} : arrivée avant le départ précédent`);
          const last = dep >= 0 ? dep : arr;
          if (last >= 0) prevTime = last;
        }
        if (!isStr(plat)) err(`${ws} : quai doit être une chaîne`);
        if (!isInt(seq) || seq <= prevSeq) err(`${ws} : stop_sequence non croissant`);
        prevSeq = isInt(seq) ? seq : prevSeq;
        if (k > 0 && isInt(si) && si === tr.s[k - 1][0]) warn(`${ws} : même gare deux fois de suite`);
      });
      if (!shapeOk) return;
      const sid = (k: number) => t.stations[tr.s[k][0]]?.id ?? '';
      const done = new Set<string>();
      for (let k = 0; k < tr.s.length;) {
        let e = k;
        while (e + 1 < tr.s.length && tr.s[e + 1][0] === tr.s[k][0]) e++;
        const station = sid(k);
        let cand = -1;
        for (let q = e; q >= k && cand < 0; q--) if (q < tr.s.length - 1 && tr.s[q][2] !== -1) cand = q;
        if (station && !done.has(station) && cand >= 0) {
          const next: string[] = [];
          for (let j = cand + 1; j < tr.s.length && next.length < 60; j++) {
            const nid = sid(j);
            if (tr.s[j][1] === -1 || nid === station || next.includes(nid)) continue;
            next.push(nid);
          }
          if (next.length) {
            done.add(station);
            let m = trainDeps.get(station);
            if (!m) trainDeps.set(station, (m = new Map()));
            m.set(`${day}|${tr.id}|${tr.s[cand][4]}`, { dep: tr.s[cand][2], platform: tr.s[cand][3], cat: tr.cat, head: tr.head, next });
          }
        }
        k = e + 1;
      }
    });
  });
  if (isObj(feeds.sncb) && feeds.sncb.ok === true && sncbTrips.size !== feeds.sncb.trips) {
    err(`meta.json : feeds.sncb.trips = ${feeds.sncb.trips} mais ${sncbTrips.size} trains distincts dans trains/`);
  }
  /* départs SNCB ↔ trains/ */
  for (const [id, a] of areas) {
    if (a.op !== 'sncb' || !Array.isArray(a.deps)) continue;
    const want = trainDeps.get(id) ?? new Map<string, { dep: number; platform: string; cat: string; head: Names; next: string[] }>();
    const got = new Set<string>();
    const present = new Set<string>();
    for (const d of a.deps) {
      if (!Array.isArray(d) || d.length !== 6) continue;
      const k = `${d[0]}|${d[4]}|${d[5]}`;
      got.add(k);
      const plat = a.stops[d[3]]?.platform ?? '';
      const p = a.patterns[d[2]];
      present.add(`${d[0]}|${d[1]}|${plat}|${p?.line}|${p?.head?.fr}`);
      const w = want.get(k);
      if (!w) {
        err(`zone ${id} : départ ${JSON.stringify(d)} absent de trains/`);
        continue;
      }
      if (w.dep !== d[1]) err(`zone ${id} : départ ${JSON.stringify(d)} à ${d[1]} min, trains/ dit ${w.dep}`);
      if (w.platform && plat !== w.platform) err(`zone ${id} : départ ${JSON.stringify(d)} au quai « ${plat} », trains/ dit « ${w.platform} »`);
      if (!p) continue;
      const nextIds = p.next.map((n) => n[0]);
      if (JSON.stringify(nextIds) !== JSON.stringify(w.next)) err(`zone ${id} : motif ${d[2]} du train ${d[4]} : next ${JSON.stringify(nextIds)} ≠ gares suivantes ${JSON.stringify(w.next)}`);
      if (p.line !== w.cat) err(`zone ${id} : motif ${d[2]} ligne « ${p.line} » ≠ catégorie « ${w.cat} » du train ${d[4]}`);
      if (isObj(p.head) && isObj(w.head) && !sameNames(p.head, w.head)) err(`zone ${id} : destination du motif ${d[2]} ≠ destination du train ${d[4]}`);
    }
    for (const [k, w] of want) {
      if (got.has(k)) continue;
      // écarté comme doublon (même jour, minute, quai, catégorie et destination qu'un départ gardé) : permis
      if (present.has(`${k.split('|')[0]}|${w.dep}|${w.platform}|${w.cat}|${w.head?.fr}`)) continue;
      err(`zone ${id} : train ${k} de trains/ sans départ dans la zone`);
    }
  }

  /* ------------------------------ 1.1 : fichiers de ligne ------------------------------ */
  validateLines(dir, meta, feeds, areas, readJson, err, warn, stats);

  return report();
}

/** Grille simple pour chercher les zones à moins de 400 m (cellules de 0,005° × 0,0075°). */
class ZoneGrid {
  private readonly cells = new Map<string, string[]>();
  constructor(private readonly pos: Map<string, [number, number]>) {
    for (const [id, [lat, lon]] of pos) {
      const k = `${Math.floor(lat / 0.005)}:${Math.floor(lon / 0.0075)}`;
      const c = this.cells.get(k);
      if (c) c.push(id);
      else this.cells.set(k, [id]);
    }
  }
  around(lat: number, lon: number, r: number): string[] {
    const y = Math.floor(lat / 0.005);
    const x = Math.floor(lon / 0.0075);
    const out: string[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const id of this.cells.get(`${y + dy}:${x + dx}`) ?? []) {
          const [la, lo] = this.pos.get(id) as [number, number];
          if (distanceM(lat, lon, la, lo) <= r) out.push(id);
        }
      }
    }
    return out;
  }
}

/**
 * 1.1 : lines/{op}/{routeKey}.json, lines/index.json et linetiles/ (shared/types.ts : LineFile, LineIndex, LineTile).
 * Formats et bornes ; index ↔ fichiers ; zones ↔ fichiers de zone ; tuiles de lignes ↔ positions desservies ;
 * correspondances et gares à moins de `conn` mètres ; trip_id des départs De Lijn et TEC présents dans les lignes ;
 * même génération que meta.json.
 */
function validateLines(
  dir: string, meta: Meta, feeds: Meta['feeds'], areas: Map<string, AreaFile>, readJson: (rel: string) => unknown,
  err: (m: string) => void, warn: (m: string) => void, stats: ValidationReport['stats'],
): void {
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
  const isStr = (x: unknown): x is string => typeof x === 'string';
  const sameNames = (a: Names, b: Names) => a.fr === b.fr && a.nl === b.nl && (a.l ?? 'fr') === (b.l ?? 'fr');
  const linesDir = join(dir, 'lines');
  const tilesDir = join(dir, 'linetiles');
  const ml = meta.lines;
  if (ml === undefined) {
    if (existsSync(linesDir) || existsSync(tilesDir)) err('meta.json : lines absent mais lines/ ou linetiles/ présents (fichiers d’une autre génération ?)');
    return;
  }
  if (!isObj(ml)) {
    err('meta.json : lines invalide');
    return;
  }
  if (ml.conn !== CONN_M) err(`meta.json : lines.conn = ${String(ml.conn)}, attendu ${CONN_M}`);
  const ops = Array.isArray(ml.ops) ? ml.ops : [];
  if (!Array.isArray(ml.ops)) err('meta.json : lines.ops absent');
  for (const op of ops) {
    if (!(URBAN as readonly string[]).includes(op)) err(`meta.json : lines.ops contient « ${String(op)} »`);
    else if (!isObj(feeds[op]) || feeds[op].ok !== true) err(`meta.json : lines.ops annonce ${op}, réseau en échec`);
  }
  if (new Set(ops).size !== ops.length) err('meta.json : lines.ops en double');

  /* index */
  const idxRaw = existsSync(join(linesDir, 'index.json')) ? readJson('lines/index.json') : undefined;
  if (!isObj(idxRaw)) {
    err('lines/index.json : absent ou illisible');
    return;
  }
  const index = idxRaw as unknown as LineIndex;
  if (index.v !== 1) err('lines/index.json : v doit valoir 1');
  if (index.generatedAt !== meta.generatedAt) err(`lines/index.json : generatedAt ${String(index.generatedAt)} ≠ meta.json ${meta.generatedAt} (fichiers de deux générations)`);
  if (index.conn !== ml.conn) err(`lines/index.json : conn ${String(index.conn)} ≠ meta.lines.conn ${String(ml.conn)}`);
  const lines = Array.isArray(index.lines) ? index.lines : [];
  if (!Array.isArray(index.lines)) err('lines/index.json : lines absent');
  const numOf = new Map<string, number>();
  lines.forEach((e, i) => {
    const w = `lines/index.json : lines[${i}]`;
    if (!Array.isArray(e) || e.length !== 4 || !isStr(e[0]) || !isStr(e[1]) || !isStr(e[2]) || !isInt(e[3])) {
      err(`${w} : attendu [clé, ligne, mode, motifs] (${JSON.stringify(e)})`);
      return;
    }
    if (numOf.has(e[0])) err(`${w} : ligne ${e[0]} en double`);
    numOf.set(e[0], i);
    if (i > 0 && isStr(lines[i - 1]?.[0]) && !(lines[i - 1][0] < e[0])) err(`${w} : lignes non triées par clé (${lines[i - 1][0]} puis ${e[0]})`);
    if (!MODES.includes(e[2] as Mode) || e[2] === 'train') err(`${w} : mode invalide « ${e[2]} »`);
    if (!e[1].trim()) err(`${w} : nom de ligne vide`);
  });

  /* fichiers de ligne */
  const files = new Map<string, LineFile>();
  for (const op of URBAN) {
    const d = join(linesDir, op);
    const names = existsSync(d) ? readdirSync(d) : [];
    if (!ops.includes(op) && names.length) err(`lines/${op} : ${names.length} fichiers alors que meta.lines.ops ne l’annonce pas`);
    if (ops.includes(op) && !names.length) err(`lines/${op} : aucun fichier alors que meta.lines.ops l’annonce`);
    for (const name of names) {
      const rel = `lines/${op}/${name}`;
      const raw = name.endsWith('.json') ? readJson(rel) : undefined;
      if (!isObj(raw)) {
        err(`${rel} : contenu invalide`);
        continue;
      }
      const f = raw as unknown as LineFile;
      if (!isStr(f.id) || !f.id.startsWith(`${op}:`)) {
        err(`${rel} : id « ${String(f.id)} » ne commence pas par « ${op}: »`);
        continue;
      }
      if (`${String(f.route).replace(/[^A-Za-z0-9_-]/g, '_')}.json` !== name) err(`${rel} : nom de fichier attendu pour la route « ${String(f.route)} »`);
      if (files.has(f.id)) err(`${rel} : ligne ${f.id} en double`);
      files.set(f.id, f);
    }
  }
  stats.lines = files.size;
  if (files.size !== ml.files) err(`meta.json : lines.files = ${String(ml.files)} mais ${files.size} fichiers de ligne`);
  for (const id of numOf.keys()) if (!files.has(id)) err(`lines/index.json : ligne ${id} sans fichier`);
  for (const id of files.keys()) if (!numOf.has(id)) err(`lines : ${id} absente de lines/index.json`);

  /* contenu des lignes ; positions desservies par ligne */
  const served = new Map<string, Set<number>>(); // zone → lignes qui la desservent (montée ou descente)
  const zonePos = new Map<string, [number, number]>();
  const tripsOf = new Map<string, Set<string>>();
  for (const [id, f] of files) {
    const rel = `lines/${f.op}/${id.slice(f.op.length + 1).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
    const num = numOf.get(id);
    const entry = num === undefined ? undefined : lines[num];
    if (f.v !== 1) err(`${rel} : v doit valoir 1`);
    if (f.op !== id.split(':')[0]) err(`${rel} : op « ${String(f.op)} » incohérent avec ${id}`);
    if (!isStr(f.route) || normalizeId(f.route) !== f.route || `${f.op}:${f.route}` !== id) err(`${rel} : route « ${String(f.route)} » incohérente avec ${id}`);
    if (entry && (entry[1] !== f.line || entry[2] !== f.mode)) err(`${rel} : ligne ou mode différents de lines/index.json`);
    if (!isStr(f.line) || !f.line.trim()) err(`${rel} : nom de ligne vide`);
    else if ((f.mode === 'tram' && /^T\s?\d/i.test(f.line)) || (f.mode === 'metro' && /^M\s?\d/i.test(f.line))) err(`${rel} : ligne « ${f.line} » déjà préfixée`);
    if (!MODES.includes(f.mode) || f.mode === 'train') err(`${rel} : mode invalide « ${String(f.mode)} »`);
    const zones = Array.isArray(f.areas) ? f.areas : [];
    if (!zones.length) err(`${rel} : areas vide`);
    zones.forEach((z, i) => {
      const w = `${rel} : areas[${i}]`;
      if (!Array.isArray(z) || z.length !== 4 || !isStr(z[0]) || typeof z[1] !== 'number' || typeof z[2] !== 'number' || !isObj(z[3])) {
        err(`${w} : attendu [zone, lat, lon, noms]`);
        return;
      }
      const a = areas.get(z[0]);
      if (!a) err(`${w} : zone ${z[0]} sans fichier areas/`);
      else {
        if (a.op !== f.op) err(`${w} : zone ${z[0]} d’un autre réseau`);
        if (a.lat !== z[1] || a.lon !== z[2]) err(`${w} : position de ${z[0]} différente du fichier de zone`);
        if (!sameNames(a.n, z[3] as Names)) err(`${w} : noms de ${z[0]} différents du fichier de zone`);
      }
      zonePos.set(z[0], [z[1], z[2]]);
    });
    if (new Set(zones.map((z) => z?.[0])).size !== zones.length) err(`${rel} : zone en double dans areas`);
    const pats = Array.isArray(f.pats) ? f.pats : [];
    if (!pats.length) err(`${rel} : aucun motif`);
    if (entry && entry[3] !== pats.length) err(`${rel} : ${pats.length} motifs, lines/index.json dit ${entry[3]}`);
    const trips = f.trips;
    if (f.op === 'stib') {
      if (trips !== undefined) err(`${rel} : trips présent pour la STIB (temps réel par pointid)`);
    } else if (!Array.isArray(trips)) err(`${rel} : trips absent`);
    else {
      if (new Set(trips).size !== trips.length) err(`${rel} : trip_id en double`);
      for (const t of trips) if (!isStr(t) || !t || normalizeId(t) !== t) err(`${rel} : trip_id non normalisé « ${String(t)} »`);
      tripsOf.set(id, new Set(trips));
    }
    const usedZones = new Set<number>();
    const usedRanks = new Set<number>();
    pats.forEach((p, pi) => {
      const w = `${rel} : pats[${pi}]`;
      if (!isObj(p) || !Array.isArray(p.a) || !Array.isArray(p.s) || !Array.isArray(p.prof) || !Array.isArray(p.t)) {
        err(`${w} : invalide`);
        return;
      }
      const n = p.a.length;
      if (n < 2) err(`${w} : moins de 2 positions`);
      for (const ai of p.a) {
        if (!isInt(ai) || ai < 0 || ai >= zones.length) err(`${w} : zone ${JSON.stringify(ai)} hors de areas`);
        else usedZones.add(ai);
      }
      if (p.s.length !== n || p.s.some((x) => !isStr(x))) err(`${w} : s doit donner un arrêt par position`);
      const flags = p.f ?? defaultFlags(n);
      if (p.f !== undefined) {
        if (!isStr(p.f) || p.f.length !== n || !/^[baxn]*$/.test(p.f)) err(`${w} : f invalide « ${String(p.f)} »`);
        else if (p.f === defaultFlags(n)) warn(`${w} : f égal à la valeur par défaut`);
      }
      const board = flags.search(/[bx]/);
      if (board < 0 || !/[ax]/.test(flags.slice(board + 1))) err(`${w} : aucune montée suivie d’une descente (« ${flags} »)`);
      if (flags[0] === 'a' || flags[0] === 'x' || flags[n - 1] === 'b' || flags[n - 1] === 'x') err(`${w} : descente au premier arrêt ou montée au dernier (« ${flags} »)`);
      p.prof.forEach((pr, k) => {
        if (!Array.isArray(pr) || pr.length !== n || pr[0] !== 0 || pr.some((x, j) => !isInt(x) || x < 0 || (j > 0 && x < pr[j - 1]))) {
          err(`${w}.prof[${k}] : profil invalide (${n} minutes croissantes depuis 0 attendues)`);
        }
      });
      let prevT: number[] | undefined;
      p.t.forEach((t, k) => {
        const wt = `${w}.t[${k}]`;
        const len = f.op === 'stib' ? 3 : 4;
        if (!Array.isArray(t) || t.length !== len || !t.every(isInt)) {
          err(`${wt} : attendu ${len} entiers (${JSON.stringify(t)})`);
          return;
        }
        const [day, dep, prof, rank] = t;
        if (day !== 0 && day !== 1) err(`${wt} : jour invalide ${day}`);
        if (dep < 0 || dep >= 48 * 60) err(`${wt} : départ hors bornes ${dep}`);
        if (prof < 0 || prof >= p.prof.length) err(`${wt} : profil ${prof} hors de prof`);
        if (len === 4) {
          if (!Array.isArray(trips) || rank < 0 || rank >= trips.length) err(`${wt} : rang de voyage ${rank} hors de trips`);
          else usedRanks.add(rank);
        }
        if (prevT && (day < prevT[0] || (day === prevT[0] && dep < prevT[1]))) err(`${wt} : voyages non triés par (jour, départ)`);
        prevT = t;
      });
      if (!p.t.length) err(`${w} : aucun voyage`);
      if (num !== undefined) {
        p.a.forEach((ai, k) => {
          if (!isInt(ai) || !zones[ai] || flags[k] === 'n') return;
          const zid = zones[ai][0];
          let set = served.get(zid);
          if (!set) served.set(zid, (set = new Set()));
          set.add(num);
          // arrêt temps réel : un des arrêts de la zone
          const a = areas.get(zid);
          if (a && p.s[k] && !a.stops.some((x) => x.rt === p.s[k])) err(`${w}.s[${k}] : arrêt « ${p.s[k]} » absent de la zone ${zid}`);
        });
      }
    });
    zones.forEach((z, i) => {
      if (!usedZones.has(i)) warn(`${rel} : areas[${i}] (${z?.[0]}) dans aucun motif`);
    });
    if (Array.isArray(trips) && usedRanks.size !== trips.length) warn(`${rel} : ${trips.length - usedRanks.size} trip_id sans voyage`);
    // correspondances : une entrée par zone, numéros valides, triés, sans la ligne elle-même
    if (!Array.isArray(f.conn) || f.conn.length !== zones.length) err(`${rel} : conn doit avoir une liste par zone (${Array.isArray(f.conn) ? f.conn.length : 'absent'} pour ${zones.length})`);
    else {
      f.conn.forEach((c, i) => {
        if (!Array.isArray(c) || c.some((x, j) => !isInt(x) || x < 0 || x >= lines.length || x === num || (j > 0 && x <= c[j - 1]))) {
          err(`${rel} : conn[${i}] invalide (${JSON.stringify(c)})`);
        }
      });
    }
  }

  /* correspondances et gares : chaque ligne citée a une position desservie à moins de conn mètres */
  const grid = new ZoneGrid(new Map([...served.keys()].map((z) => [z, zonePos.get(z) as [number, number]])));
  const near = new Map<string, Set<number>>();
  const linesNear = (lat: number, lon: number, r: number) => {
    const set = new Set<number>();
    for (const z of grid.around(lat, lon, r)) for (const m of served.get(z) ?? []) set.add(m);
    return set;
  };
  const conn = isInt(ml.conn) ? ml.conn : CONN_M;
  for (const [id, f] of files) {
    if (!Array.isArray(f.conn) || !Array.isArray(f.areas)) continue;
    f.conn.forEach((c, i) => {
      const z = f.areas[i];
      if (!Array.isArray(c) || !Array.isArray(z)) return;
      let set = near.get(z[0]);
      if (!set) near.set(z[0], (set = linesNear(z[1], z[2], conn + 1)));
      for (const m of c) if (!set.has(m)) err(`${id} : conn[${i}] cite la ligne ${m}, sans arrêt à moins de ${conn} m de ${z[0]}`);
    });
  }
  const stations = isObj(index.stations) ? index.stations : {};
  if (!isObj(index.stations)) err('lines/index.json : stations absent');
  for (const [sid, list] of Object.entries(stations)) {
    const a = areas.get(sid);
    if (!sid.startsWith('sncb:') || !a) {
      err(`lines/index.json : stations « ${sid} » n’est pas une gare SNCB connue`);
      continue;
    }
    if (!Array.isArray(list) || !list.length || list.some((x, j) => !isInt(x) || x < 0 || x >= lines.length || (j > 0 && x <= list[j - 1]))) {
      err(`lines/index.json : stations ${sid} invalide (${JSON.stringify(list)})`);
      continue;
    }
    const set = linesNear(a.lat, a.lon, conn + 1);
    for (const m of list) if (!set.has(m)) err(`lines/index.json : stations ${sid} cite la ligne ${m}, sans arrêt à moins de ${conn} m`);
    const strict = linesNear(a.lat, a.lon, conn - 1);
    for (const m of strict) if (!list.includes(m)) err(`lines/index.json : stations ${sid} oublie la ligne ${m} (arrêt à moins de ${conn} m)`);
  }
  for (const [id, a] of areas) {
    if (a.op !== 'sncb' || stations[id]) continue;
    if (linesNear(a.lat, a.lon, conn - 1).size) err(`lines/index.json : gare ${id} absente de stations malgré des lignes à moins de ${conn} m`);
  }

  /* tuiles de lignes : exactement les zones desservies, avec leurs lignes */
  const inTiles = new Set<string>();
  for (const name of existsSync(tilesDir) ? readdirSync(tilesDir) : []) {
    const rel = `linetiles/${name}`;
    if (!/^-?\d+_-?\d+\.json$/.test(name)) {
      err(`${rel} : nom de tuile invalide`);
      continue;
    }
    stats.lineTiles++;
    const raw = readJson(rel);
    if (!isObj(raw)) continue;
    const t = raw as unknown as LineTile;
    if (t.v !== 1) err(`${rel} : v doit valoir 1`);
    if (!isObj(t.a) || !Object.keys(t.a).length) {
      err(`${rel} : tuile vide ou a absent`);
      continue;
    }
    for (const [zid, list] of Object.entries(t.a)) {
      if (inTiles.has(zid)) err(`${rel} : zone ${zid} présente dans plusieurs tuiles de lignes`);
      inTiles.add(zid);
      const want = served.get(zid);
      if (!want) {
        err(`${rel} : zone ${zid} desservie par aucune ligne`);
        continue;
      }
      const pos = zonePos.get(zid) as [number, number];
      if (`${tileKey(pos[0], pos[1], meta.tile)}.json` !== name) err(`${rel} : ${zid} appartient à la tuile de lignes ${tileKey(pos[0], pos[1], meta.tile)}`);
      const sorted = [...want].sort((x, y) => x - y);
      if (JSON.stringify(list) !== JSON.stringify(sorted)) err(`${rel} : lignes de ${zid} ${JSON.stringify(list)} ≠ lignes des fichiers ${JSON.stringify(sorted)}`);
    }
  }
  for (const zid of served.keys()) if (!inTiles.has(zid)) err(`linetiles : zone desservie ${zid} absente des tuiles de lignes`);

  /* départs De Lijn et TEC : leur voyage est dans le fichier de la ligne (temps réel par trip_id) */
  let missing = 0;
  for (const [zid, a] of areas) {
    if ((a.op !== 'delijn' && a.op !== 'tec') || !ops.includes(a.op) || !Array.isArray(a.deps)) continue;
    for (const d of a.deps) {
      const p = a.patterns[d[2]];
      const set = p ? tripsOf.get(`${a.op}:${p.route}`) : undefined;
      if (!set?.has(d[4])) {
        if (missing++ < 20) err(`zone ${zid} : voyage ${d[4]} (ligne ${p?.line}) absent du fichier de ligne ${a.op}:${p?.route}`);
      }
    }
  }
  if (missing > 20) err(`… et ${missing - 20} autres voyages absents des fichiers de ligne`);
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('Usage : npx tsx validate-data.ts <dossier> [--json]');
    process.exitCode = 2;
    return;
  }
  const r = validateData(dir);
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`Validation de ${r.dir}`);
    console.log(`  ${r.stats.files} fichiers lus, ${(r.stats.bytes / 1024).toFixed(1)} Ko ; zones ${JSON.stringify(r.stats.areas)} ; ${r.stats.deps} départs ; ${r.stats.patterns} motifs ; ${r.stats.tiles} tuiles ; ${r.stats.searchFiles} fichiers de recherche ; trains ${JSON.stringify(r.stats.trains)} ; ${r.stats.lines} fichiers de ligne, ${r.stats.lineTiles} tuiles de lignes`);
    for (const w of r.warnings) console.log(`  avertissement : ${w}`);
    for (const e of r.errors) console.log(`  ERREUR : ${e}`);
    console.log(r.errors.length ? `${r.errors.length} erreur(s), ${r.warnings.length} avertissement(s)` : `OK, aucune erreur (${r.warnings.length} avertissement(s))`);
  }
  process.exitCode = r.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
