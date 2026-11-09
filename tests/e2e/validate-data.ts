/**
 * Quai, contrôle qualité : validation d'un dossier de données produit par le pipeline (npm run build-data).
 *
 * Vérifie chaque fichier contre la sémantique de shared/types.ts : types, bornes, ordres de tri,
 * références croisées (zones des tuiles, index des départs, zones de patterns.next, gares des trains,
 * clés de recherche cohérentes avec searchWords()/searchKey()), noms non vides, identifiants normalisés.
 *
 * Usage : npx tsx validate-data.ts <dossier> [--json]
 * Code de sortie : 0 si aucune erreur, 1 sinon (les avertissements ne font pas échouer).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AreaFile, AreaSummary, Meta, Mode, Names, Op, SearchFile, TileFile, TrainsDay } from '../../shared/types';
import { normalizeId, tileKey } from '../../shared/types';
import { searchKey, searchWords } from '../../shared/names';

export const OPS: Op[] = ['sncb', 'stib', 'delijn', 'tec'];
export const MODES: Mode[] = ['train', 'metro', 'tram', 'bus'];
const EM_DASH = '\u2014';

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
  };
}

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
        if (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
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
    if (!['meta.json', 'LICENSE-DATA.txt', 'tiles', 'areas', 'search', 'trains'].includes(name)) warn(`fichier inattendu à la racine : ${name}`);
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
        if (op === 'tec' && a.n.fr !== a.n.nl) err(`${rel} : TEC doit avoir fr = nl`);
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
        if (!m || m[1] !== key) err(`${w} : arrêt SNCB ${s.id} hors de la gare ${key}`);
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
      if (op === 'sncb' && p.mode !== 'train') err(`${w} : mode ${p.mode} pour une gare SNCB`);
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
      const pk = JSON.stringify([p.line, p.mode, p.head?.fr, p.next]);
      if (patternKeys.has(pk)) err(`${w} : motif identique à patterns[${patternKeys.get(pk)}] (même ligne, destination et next)`);
      else patternKeys.set(pk, i);
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
  const summaries = new Map<string, AreaSummary>();
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
        for (const l of s.lines) if (!isStr(l) || !l || !serving.lines.has(l)) err(`${w} : ligne ${JSON.stringify(l)} ne dessert pas la zone`);
        if (s.lines.length !== Math.min(12, serving.lines.size)) err(`${w} : ${s.lines.length} lignes résumées sur ${serving.lines.size}`);
      }
    });
  }
  for (const id of areas.keys()) if (!summaries.has(id)) err(`zone ${id} : présente dans areas/ mais dans aucune tuile`);

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
      if (!checkNames(`${w}.n`, it.n)) return;
      if (!sameNames(it.n, a.n)) err(`${w} : noms différents de la zone`);
      if (JSON.stringify(it.modes) !== JSON.stringify(s.modes)) err(`${w} : modes différents de la tuile`);
      if (it.lat !== a.lat || it.lon !== a.lon) err(`${w} : position différente de la zone`);
      const keys = searchWords(it.n.fr, it.n.nl).map(searchKey);
      if (!keys.includes(key)) err(`${w} : ${it.id} (« ${it.n.fr} » / « ${it.n.nl} ») n'a aucun mot de clé « ${key} »`);
    });
  }
  for (const [id, a] of areas) {
    if (!isObj(a.n) || !isStr(a.n.fr) || !isStr(a.n.nl)) continue;
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
  /** gare → jour → "trip|seq" → minutes de départ (pour le contrôle croisé avec les départs SNCB). */
  const trainDeps = new Map<string, Map<string, { dep: number; platform: string }>>();
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
      let prevDep = -Infinity;
      let prevSeq = -Infinity;
      tr.s.forEach((x, k) => {
        const ws = `${w}.s[${k}]`;
        if (!Array.isArray(x) || x.length !== 5) {
          err(`${ws} : attendu 5 éléments`);
          return;
        }
        const [si, arr, dep, plat, seq] = x;
        if (!isInt(si) || si < 0 || si >= t.stations.length) err(`${ws} : index de gare ${JSON.stringify(si)} invalide`);
        if (!isInt(arr) || !isInt(dep) || arr < 0 || dep < arr || dep >= 48 * 60) err(`${ws} : heures invalides (${arr}, ${dep})`);
        else {
          if (arr < prevDep) err(`${ws} : arrivée avant le départ précédent`);
          prevDep = dep;
        }
        if (!isStr(plat)) err(`${ws} : quai doit être une chaîne`);
        if (!isInt(seq) || seq <= prevSeq) err(`${ws} : stop_sequence non croissant`);
        prevSeq = isInt(seq) ? seq : prevSeq;
        if (k > 0 && isInt(si) && si === tr.s[k - 1][0]) warn(`${ws} : même gare deux fois de suite`);
        if (k < tr.s.length - 1 && isInt(si) && t.stations[si]) {
          const sid = t.stations[si].id;
          let m = trainDeps.get(sid);
          if (!m) trainDeps.set(sid, (m = new Map()));
          m.set(`${day}|${tr.id}|${seq}`, { dep, platform: plat });
        }
      });
      /* motif de ce train à chaque gare : next = gares suivantes */
      tr.s.forEach((x, k) => {
        if (k === tr.s.length - 1) return;
        const sid = t.stations[x[0]]?.id;
        const a = sid ? areas.get(sid) : undefined;
        if (!a || !Array.isArray(a.deps)) return;
        const row = a.deps.find((d) => d[0] === day && d[4] === tr.id && d[5] === x[4]);
        if (!row) return; // signalé plus bas
        const p = a.patterns[row[2]];
        if (!p) return;
        const after = tr.s.slice(k + 1).map((y) => t.stations[y[0]]?.id);
        const got = p.next.map((n) => n[0]);
        if (JSON.stringify(after) !== JSON.stringify(got)) err(`zone ${sid} : motif ${row[2]} du train ${tr.id} : next ${JSON.stringify(got)} ≠ gares suivantes ${JSON.stringify(after)}`);
        if (p.line !== tr.cat) err(`zone ${sid} : motif ${row[2]} ligne « ${p.line} » ≠ catégorie « ${tr.cat} » du train ${tr.id}`);
        if (isObj(p.head) && isObj(tr.head) && !sameNames(p.head, tr.head)) err(`zone ${sid} : destination du motif ${row[2]} ≠ destination du train ${tr.id}`);
      });
    });
  });
  if (isObj(feeds.sncb) && feeds.sncb.ok === true && sncbTrips.size !== feeds.sncb.trips) {
    err(`meta.json : feeds.sncb.trips = ${feeds.sncb.trips} mais ${sncbTrips.size} trains distincts dans trains/`);
  }
  /* départs SNCB ↔ trains/ */
  for (const [id, a] of areas) {
    if (a.op !== 'sncb' || !Array.isArray(a.deps)) continue;
    const want = trainDeps.get(id) ?? new Map<string, { dep: number; platform: string }>();
    const got = new Set<string>();
    for (const d of a.deps) {
      if (!Array.isArray(d) || d.length !== 6) continue;
      const k = `${d[0]}|${d[4]}|${d[5]}`;
      got.add(k);
      const w = want.get(k);
      if (!w) {
        err(`zone ${id} : départ ${JSON.stringify(d)} absent de trains/`);
        continue;
      }
      if (w.dep !== d[1]) err(`zone ${id} : départ ${JSON.stringify(d)} à ${d[1]} min, trains/ dit ${w.dep}`);
      const plat = a.stops[d[3]]?.platform ?? '';
      if (w.platform && plat !== w.platform) err(`zone ${id} : départ ${JSON.stringify(d)} au quai « ${plat} », trains/ dit « ${w.platform} »`);
    }
    for (const k of want.keys()) if (!got.has(k)) err(`zone ${id} : train ${k} de trains/ sans départ dans la zone`);
  }

  return report();
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
    console.log(`  ${r.stats.files} fichiers lus, ${(r.stats.bytes / 1024).toFixed(1)} Ko ; zones ${JSON.stringify(r.stats.areas)} ; ${r.stats.deps} départs ; ${r.stats.patterns} motifs ; ${r.stats.tiles} tuiles ; ${r.stats.searchFiles} fichiers de recherche ; trains ${JSON.stringify(r.stats.trains)}`);
    for (const w of r.warnings) console.log(`  avertissement : ${w}`);
    for (const e of r.errors) console.log(`  ERREUR : ${e}`);
    console.log(r.errors.length ? `${r.errors.length} erreur(s), ${r.warnings.length} avertissement(s)` : `OK, aucune erreur (${r.warnings.length} avertissement(s))`);
  }
  process.exitCode = r.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
