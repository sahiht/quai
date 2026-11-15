/**
 * 1.3.0 (PRD-1.3.0 § 6.4) : journal des trajets guidés, gardé sur le téléphone seulement (clé `quai.journal` du
 * stockage de l'appli, jamais de réseau). Contrat : journal-types.ts ; le contrôleur écrit, le téléphone lit.
 *
 * - Lecture tolérante à l'ouverture : contenu abîmé, autre version ou stockage muet : journal vide, jamais d'exception.
 * - Ensuite tout répond tout de suite, en mémoire ; l'enregistrement suit en arrière-plan : regroupé (au plus un toutes
 *   les 2 s) pour les événements, tout de suite au début et à la fin d'un trajet et à l'effacement ; `flush` à la
 *   fermeture de la page.
 * - Plafonds du JSON enregistré ({ v: 1, trips }, trajets du plus ancien au plus récent) : 10 trajets et 60 000 octets.
 *   Le plus ancien trajet est oublié d'abord ; un trajet seul trop long garde son début et sa fin, ses événements du
 *   milieu deviennent un seul événement « n événements oubliés ».
 * - Jamais de coordonnées ni d'adresse : clés lat, lon, lng, latitude, longitude, address, adresse retirées (sans tenir
 *   compte de la casse, aussi dans un nom composé : fromLat, home_address) ; valeurs qui ressemblent à une paire de
 *   coordonnées ou à une adresse (« Rue de la Loi 16 ») retirées ; un titre qui en est une devient « Adresse » ;
 *   nombres arrondis au dixième (aucune coordonnée précise, même sous un autre nom).
 * - Une seule ligne de début et une seule de fin par trajet : begin() écrit le début (un `start` ajouté ensuite complète
 *   ses détails), end() écrit la fin (un `end` ajouté vaut end() ; la première fin compte).
 */
import type { KV } from './api';
import type { CreateJournal, JournalEvent, JournalTrip, TripJournal } from './journal-types';
import { NB } from './text';
import { brusselsParts } from './util';
import { APP_VERSION } from '../version';

/** Clé du stockage de l'appli (téléphone). */
export const JOURNAL_KEY = 'quai.journal';
/** Trajets gardés au plus. */
export const JOURNAL_MAX_TRIPS = 10;
/** Taille du JSON enregistré au plus, en octets (UTF-8). */
export const JOURNAL_MAX_BYTES = 60_000;
/** Événements regroupés : un enregistrement au plus toutes les 2 s. */
export const JOURNAL_SAVE_MS = 2_000;
/** Sorte de l'événement qui remplace le milieu d'un trajet trop long (d.n : nombre d'événements oubliés). */
export const JOURNAL_FORGOTTEN = 'forgotten';
/** Titre d'un trajet dont le nom est une adresse ou une position. */
export const JOURNAL_ADDRESS_TITLE = 'Adresse';

/**
 * Mots des moments du guidage dans le journal : la première ligne de l'écran quand elle est fixe (GUIDE_TEXT de
 * glasses/guide-views.ts : « Partir maintenant », « Descends au prochain arrêt », « Voie modifiée », « Tu y es »…), sinon
 * un mot qui dit le moment.
 */
export const JOURNAL_MOMENT_WORDS: Readonly<Record<string, string>> = {
  leave: 'Partir maintenant',
  turn: 'Tourner',
  board: 'Monter',
  platform: 'Voie modifiée',
  alight: 'Descends au prochain arrêt',
  replan: 'Nouveau trajet',
  passed: 'Arrêt dépassé',
  offMap: 'Hors de Belgique',
  check: 'À vérifier',
  nextStop: 'Prochain arrêt',
  arrived: 'Tu y es',
};

const END_WORDS: Readonly<Record<string, string>> = { done: 'tu y es', stopped: 'arrêté', ended: 'trajet terminé', replaced: 'nouveau guidage' };
const REPLAN_WORDS: Readonly<Record<string, string>> = { missed: 'véhicule parti', cancelled: 'véhicule supprimé', late: 'correspondance ratée', passed: 'arrêt dépassé' };

/** Le journal de l'appli : le contrat, et l'enregistrement immédiat de ce qui attend (fermeture de la page). */
export interface JournalStore extends TripJournal {
  /** Enregistre tout de suite ce qui attend encore. Jamais d'exception. */
  flush(): Promise<void>;
}

type End = NonNullable<JournalTrip['end']>;
type Detail = NonNullable<JournalEvent['d']>;

const ENDS: readonly string[] = ['done', 'stopped', 'ended', 'replaced'];
const isEnd = (x: unknown): x is End => typeof x === 'string' && ENDS.includes(x);

/* ------------------------------ Le journal ------------------------------ */

/**
 * Ouvre le journal (lecture de `quai.journal`). Ne rejette jamais : stockage illisible ou contenu abîmé, journal vide.
 * `opts.now` : l'horloge de l'appli, pour un événement sans heure valable.
 */
export async function createJournal(kv: KV, opts?: { now?: () => number }): Promise<JournalStore> {
  const now = (): number => {
    try {
      const n = (opts?.now ?? Date.now)();
      return Number.isFinite(n) ? Math.round(n) : Date.now();
    } catch {
      return Date.now();
    }
  };

  let raw: string | null = null;
  try {
    const v: unknown = await kv.get(JOURNAL_KEY);
    raw = typeof v === 'string' ? v : null;
  } catch (e) {
    console.warn('[Quai] journal des trajets illisible', errText(e));
  }
  const trips = readJournal(raw);

  let saved = raw ?? '';
  let settled = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let sinceSettle = 0;

  const find = (id: unknown): JournalTrip | undefined => (typeof id === 'string' ? trips.find((t) => t.id === id) : undefined);

  /** Plafonds appliqués (seulement si quelque chose a changé depuis la dernière fois). */
  const settle = (): void => {
    if (settled) return;
    settled = true;
    sinceSettle = 0;
    enforceLimits(trips);
  };

  const write = async (): Promise<void> => {
    if (!dirty) return;
    dirty = false;
    let json: string;
    try {
      settle();
      json = serialize(trips);
    } catch (e) {
      console.warn('[Quai] journal des trajets non enregistré', errText(e));
      return;
    }
    if (json === saved) return;
    try {
      await kv.set(JOURNAL_KEY, json);
      saved = json;
    } catch (e) {
      // réessayé au prochain changement
      dirty = true;
      console.warn('[Quai] journal des trajets non enregistré', errText(e));
    }
  };

  const flush = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    chain = chain.then(write).catch(() => undefined);
    return chain;
  };

  /** Un changement : enregistré tout de suite (`soon`) ou avec les autres, au plus tard dans 2 s. */
  const changed = (soon: boolean): void => {
    settled = false;
    dirty = true;
    if (soon) void flush();
    else if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, JOURNAL_SAVE_MS);
    }
  };

  const endTrip = (trip: JournalTrip, end: End, at: number): void => {
    if (trip.end) return;
    trip.end = end;
    trip.endedAt = at;
    trip.events.push({ t: at, k: 'end', d: { end } });
    changed(true);
  };

  return {
    begin(meta) {
      let id = '';
      try {
        const at = timeOf(meta?.at, now);
        const kind: JournalTrip['kind'] = meta?.kind === 'ride' ? 'ride' : 'trip';
        const title = cleanTitle(meta?.title);
        id = newId(trips, at);
        trips.push({ id, title, kind, startedAt: at, events: [{ t: at, k: 'start', d: title ? { title, kind } : { kind } }] });
        if (trips.length > JOURNAL_MAX_TRIPS) trips.splice(0, trips.length - JOURNAL_MAX_TRIPS);
        changed(true);
      } catch (e) {
        console.warn('[Quai] journal : début du trajet non noté', errText(e));
      }
      return id;
    },

    add(id, e) {
      try {
        const trip = find(id);
        if (!trip) return;
        const ev = cleanEvent(e, now);
        if (!ev) return;
        if (ev.k === 'end') {
          const end = ev.d?.end;
          endTrip(trip, isEnd(end) ? end : 'ended', ev.t);
          return;
        }
        const start = ev.k === 'start' ? trip.events.find((x) => x.k === 'start') : undefined;
        if (start) {
          if (ev.d) start.d = { ...(start.d ?? {}), ...ev.d };
        } else {
          trip.events.push(ev);
          // une boucle qui écrit sans fin : plafonds appliqués sans attendre l'enregistrement
          if (++sinceSettle >= 500) settle();
        }
        changed(false);
      } catch (err) {
        console.warn('[Quai] journal : événement non noté', errText(err));
      }
    },

    end(id, end, at) {
      try {
        const trip = find(id);
        if (trip) endTrip(trip, isEnd(end) ? end : 'ended', timeOf(at, now));
      } catch (e) {
        console.warn('[Quai] journal : fin du trajet non notée', errText(e));
      }
    },

    list() {
      try {
        settle();
        return trips.slice().reverse().map(copyTrip);
      } catch (e) {
        console.warn('[Quai] journal illisible', errText(e));
        return [];
      }
    },

    text(id) {
      try {
        settle();
        const trip = find(id);
        return trip ? tripText(trip) : '';
      } catch (e) {
        console.warn('[Quai] journal illisible', errText(e));
        return '';
      }
    },

    clear() {
      try {
        trips.length = 0;
        changed(true);
      } catch (e) {
        console.warn('[Quai] journal non effacé', errText(e));
      }
    },

    flush,
  };
}

// le contrat est respecté (la fabrique rend en plus `flush`)
void (createJournal satisfies CreateJournal);

/* ------------------------------ Lecture et enregistrement ------------------------------ */

/** Lecture tolérante : tout ce qui n'est pas un journal { v: 1, trips } lisible donne un journal vide. */
export function readJournal(raw: string | null): JournalTrip[] {
  if (!raw) return [];
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObj(o) || o.v !== 1 || !Array.isArray(o.trips)) return [];
  const out: JournalTrip[] = [];
  const ids = new Set<string>();
  for (const x of o.trips) {
    const t = readTrip(x);
    if (t && !ids.has(t.id)) {
      ids.add(t.id);
      out.push(t);
    }
  }
  return out;
}

function readTrip(x: unknown): JournalTrip | null {
  if (!isObj(x)) return null;
  const id = typeof x.id === 'string' ? x.id.trim().slice(0, 40) : '';
  const startedAt = finite(x.startedAt);
  if (!id || startedAt === undefined) return null;
  const trip: JournalTrip = { id, title: cleanTitle(x.title), kind: x.kind === 'ride' ? 'ride' : 'trip', startedAt, events: [] };
  const endedAt = finite(x.endedAt);
  if (endedAt !== undefined) trip.endedAt = endedAt;
  if (isEnd(x.end)) trip.end = x.end;
  if (Array.isArray(x.events)) {
    for (const e of x.events) {
      const ev = cleanEvent(e, () => startedAt);
      if (ev) trip.events.push(ev);
    }
  }
  return trip;
}

/** Un trajet dans l'ordre de ses champs (le même JSON à chaque fois, sa taille mesurée juste). */
function canon(t: JournalTrip): JournalTrip {
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    startedAt: t.startedAt,
    ...(t.endedAt !== undefined ? { endedAt: t.endedAt } : {}),
    ...(t.end ? { end: t.end } : {}),
    events: t.events,
  };
}

const tripJson = (t: JournalTrip): string => JSON.stringify(canon(t));
const EMPTY_JSON = '{"v":1,"trips":[]}';

function serialize(trips: JournalTrip[]): string {
  return `{"v":1,"trips":[${trips.map(tripJson).join(',')}]}`;
}

/** Taille du JSON enregistré, d'après la taille de chaque trajet (crochets, virgules). */
function storedBytes(sizes: number[]): number {
  return EMPTY_JSON.length + sizes.reduce((a, b) => a + b, 0) + Math.max(0, sizes.length - 1);
}

/** 10 trajets au plus ; 60 000 octets au plus : les plus anciens oubliés d'abord, puis le milieu d'un trajet seul. */
function enforceLimits(trips: JournalTrip[]): void {
  if (trips.length > JOURNAL_MAX_TRIPS) trips.splice(0, trips.length - JOURNAL_MAX_TRIPS);
  const sizes = trips.map((t) => utf8Bytes(tripJson(t)));
  while (trips.length > 1 && storedBytes(sizes) > JOURNAL_MAX_BYTES) {
    trips.shift();
    sizes.shift();
  }
  if (trips.length === 1 && storedBytes(sizes) > JOURNAL_MAX_BYTES) trips[0] = compactTrip(trips[0], JOURNAL_MAX_BYTES - EMPTY_JSON.length);
}

const forgotten = (t: number, n: number): JournalEvent => ({ t, k: JOURNAL_FORGOTTEN, d: { n } });
const weight = (e: JournalEvent): number => (e.k === JOURNAL_FORGOTTEN ? Math.max(1, Math.round(Number(e.d?.n)) || 1) : 1);

/**
 * Un trajet trop long dans `budget` octets : son début (les événements avant l'ancien repère, sinon le premier tiers du
 * budget) et sa fin (le plus possible) restent ; le milieu devient un seul événement « n événements oubliés », à l'heure
 * du premier oublié (un repère déjà là y est compté).
 */
function compactTrip(trip: JournalTrip, budget: number): JournalTrip {
  const ev = trip.events;
  const n = ev.length;
  if (n < 3) return trip;
  const base = utf8Bytes(tripJson({ ...trip, events: [] }));
  const sizes = ev.map((e) => utf8Bytes(JSON.stringify(e)));
  const mark = ev.findIndex((e, i) => i > 0 && i < n - 1 && e.k === JOURNAL_FORGOTTEN);
  let head = mark;
  if (head < 0) {
    const headBudget = (budget - base) / 3;
    let acc = 0;
    head = 0;
    while (head < n - 2 && acc + sizes[head] + 1 <= headBudget) acc += sizes[head++] + 1;
    head = Math.max(1, head);
  }
  for (const h of head > 1 ? [head, 1] : [1]) {
    let headBytes = 0;
    for (let i = 0; i < h; i++) headBytes += sizes[i];
    let tailBytes = 0;
    for (let i = h + 1; i < n; i++) tailBytes += sizes[i];
    let count = weight(ev[h]);
    // milieu ev[h..j), fin ev[j..n) : au moins un événement à la fin
    for (let j = h + 1; j < n; j++) {
      const m = forgotten(ev[h].t, count);
      const size = base + headBytes + utf8Bytes(JSON.stringify(m)) + tailBytes + (h + n - j);
      if (size <= budget) return { ...trip, events: [...ev.slice(0, h), m, ...ev.slice(j)] };
      count += weight(ev[j]);
      tailBytes -= sizes[j];
    }
  }
  // dernier recours (détails déjà courts : n'arrive pas) : le premier, le repère, le dernier
  let all = 0;
  for (let i = 1; i < n - 1; i++) all += weight(ev[i]);
  return { ...trip, events: [ev[0], forgotten(ev[1].t, all), ev[n - 1]] };
}

function copyTrip(t: JournalTrip): JournalTrip {
  return { ...canon(t), events: t.events.map((e) => (e.d ? { t: e.t, k: e.k, d: { ...e.d } } : { t: e.t, k: e.k })) };
}

function newId(trips: JournalTrip[], at: number): string {
  const base = `j${Math.max(0, at).toString(36)}`;
  let id = base;
  for (let i = 2; trips.some((t) => t.id === id); i++) id = `${base}-${i}`;
  return id;
}

/* ------------------------------ Ni coordonnées ni adresse ------------------------------ */

const MAX_TITLE = 80;
const MAX_TEXT = 160;
const MAX_KIND = 24;
const MAX_KEYS = 12;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Mots refusés dans un nom de clé (seul ou dans un nom composé : fromLat, home_address, latLon). */
const REFUSED_KEY_WORDS = new Set([
  'lat', 'lon', 'lng', 'latitude', 'longitude', 'latlon', 'latlng', 'lonlat',
  'address', 'addresses', 'adresse', 'adresses', 'addr', 'coord', 'coords', 'coordinates', 'coordonnee', 'coordonnees', 'geo',
]);

/** Vrai si la clé doit être retirée (coordonnées ou adresse), sans tenir compte de la casse. */
export function refusedKey(key: string): boolean {
  const words = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => REFUSED_KEY_WORDS.has(w)) || REFUSED_KEY_WORDS.has(words.join(''));
}

// deux nombres à décimales côte à côte (« 50.8466, 4.3528 », « 50,8466 4,3528 », « POINT(4.35 50.84) »)
const PAIR_RE = /(?:^|[^\d.,])[-+−]?\d{1,3}[.,]\d{2,}\s*(?:[,;/]\s*|\s+)[-+−]?\d{1,3}[.,]\d{2,}(?!\d)/u;
// degrés, minutes (« 50°50′48″ N », « 4° E »)
const DMS_RE = /\d{1,3}(?:[.,]\d+)?\s*°\s*(?:\d{1,2}(?:[.,]\d+)?\s*['′’]|[NSEOW](?![a-z]))/iu;
// « lat 50.84 », « lon=4.35 »
const NAMED_RE = /\b(?:lat|lon|lng|latitude|longitude)\b\s*[:=]?\s*[-+−]?\d/iu;

/** Vrai si le texte ressemble à une position (paire de coordonnées, degrés, « lat 50.84 »). */
export function looksLikeCoordinates(s: string): boolean {
  return PAIR_RE.test(s) || DMS_RE.test(s) || NAMED_RE.test(s);
}

const STREET = String.raw`(?:rue|avenue|av\.?|boulevard|bd|chauss[ée]e|chemin|place|square|impasse|all[ée]e|clos|dr[èe]ve|sentier|route|rond-point|parvis|quai|galerie|passage|cours|venelle|ruelle|faubourg|esplanade|promenade|street|road|lane)`;
const STREET_SUFFIX = String.raw`(?:straat|laan|steenweg|weg|plein|lei|dreef|kaai|singel|baan|dijk|vest|markt|plaats|wegel|stra(?:ss|ß)e|gasse|platz|allee)`;
// numéro de maison (« 16 », « 54b », « 12 bis ») : pas une durée, une distance, un pourcentage ni une heure
const HOUSE = String.raw`\d{1,4}(?!\d)(?:(?:\s?(?:bis|ter)|[a-z])(?![\p{L}\d]))?(?![.,]\d)(?!\s*(?:%|:|°|(?:min|km|h|s|m)(?![\p{L}])))`;
// « Rue de la Loi 16 » : le type de voie, au moins un mot de son nom, le numéro
const ADDRESS_NAME_FIRST = new RegExp(String.raw`(?:^|[^\p{L}])${STREET}\s+(?:[^\s\d,;]+\s+){1,6}${HOUSE}`, 'iu');
// « 16 rue de la Loi »
const ADDRESS_NUMBER_FIRST = new RegExp(String.raw`(?:^|[\s,(])\d{1,4}(?!\d)(?:\s?(?:bis|ter)|[a-z])?,?\s+${STREET}\s+[^\s\d,;]+`, 'iu');
// « Wetstraat 16 », « Grote Markt 1 »
const ADDRESS_SUFFIX = new RegExp(String.raw`\p{L}*${STREET_SUFFIX}\s+${HOUSE}`, 'iu');

/** Vrai si le texte ressemble à une adresse (type de voie, nom et numéro), jamais pour un arrêt, une gare, une voie. */
export function looksLikeAddress(s: string): boolean {
  return ADDRESS_NAME_FIRST.test(s) || ADDRESS_NUMBER_FIRST.test(s) || ADDRESS_SUFFIX.test(s);
}

/** Texte d'une seule ligne, sans demi-caractère, `max` caractères au plus. */
function cleanText(s: string, max: number): string {
  let t = wellFormed(s.length > max * 4 ? s.slice(0, max * 4) : s)
    .replace(/[^\S  ]+/g, ' ')
    .trim();
  const cps = Array.from(t);
  if (cps.length > max) t = `${cps.slice(0, max - 1).join('').trimEnd()}…`;
  return t;
}

function wellFormed(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else out += '�';
    } else if (c >= 0xdc00 && c <= 0xdfff) out += '�';
    else out += s[i];
  }
  return out;
}

function cleanTitle(x: unknown): string {
  const s = typeof x === 'string' ? cleanText(x, MAX_TITLE) : '';
  return s && (looksLikeCoordinates(s) || looksLikeAddress(s)) ? JOURNAL_ADDRESS_TITLE : s;
}

/** Un événement propre, ou null (pas d'objet, pas de sorte, sorte qui serait une position ou une adresse). */
function cleanEvent(e: unknown, now: () => number): JournalEvent | null {
  if (!isObj(e)) return null;
  const k = typeof e.k === 'string' ? cleanText(e.k, MAX_KIND) : '';
  if (!k || looksLikeCoordinates(k) || looksLikeAddress(k)) return null;
  const t = timeOf(e.t, now);
  const d = cleanDetail(e.d);
  return d ? { t, k, d } : { t, k };
}

/**
 * Détails courts : 12 clés au plus ; clés de coordonnées ou d'adresse retirées ; textes d'une ligne (160 caractères au
 * plus), retirés s'ils ressemblent à une position ou à une adresse ; nombres arrondis au dixième ; vrai ou faux.
 */
function cleanDetail(d: unknown): Detail | undefined {
  if (!isObj(d)) return undefined;
  const out: Detail = {};
  let n = 0;
  for (const [key, v] of Object.entries(d)) {
    if (n >= MAX_KEYS) break;
    if (!KEY_RE.test(key) || RESERVED_KEYS.has(key) || refusedKey(key)) continue;
    let val: string | number | boolean | undefined;
    if (typeof v === 'boolean') val = v;
    else if (typeof v === 'number') val = Number.isFinite(v) ? (Number.isInteger(v) ? v : Math.round(v * 10) / 10) : undefined;
    else if (typeof v === 'string') {
      const s = cleanText(v, MAX_TEXT);
      val = s && !looksLikeCoordinates(s) && !looksLikeAddress(s) ? s : undefined;
    }
    if (val === undefined) continue;
    out[key] = val;
    n++;
  }
  return n ? out : undefined;
}

/* ------------------------------ Texte à copier ------------------------------ */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** « 08:02:10 » à l'heure de Bruxelles (heure d'été comprise), quel que soit le fuseau du téléphone. */
export function journalClock(ms: number): string {
  const p = brusselsParts(ms);
  return `${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)}`;
}

/** « 15/11/2026 », date de Bruxelles. */
export function journalDate(ms: number): string {
  const p = brusselsParts(ms);
  return `${pad2(p.d)}/${pad2(p.mo)}/${p.y}`;
}

/**
 * Le texte d'un trajet : « Journal Quai 1.3.0, trajet « Bureau », 15/11/2026 », puis une ligne par événement
 * (« 08:02:10 Partir maintenant affiché »), heures de Bruxelles.
 */
function tripText(trip: JournalTrip): string {
  const title = trip.title ? `trajet «${NB}${trip.title}${NB}»` : 'trajet sans nom';
  const lines = [fr(`Journal Quai ${APP_VERSION}, ${title}, ${journalDate(trip.startedAt)}`)];
  for (const e of trip.events) lines.push(`${journalClock(e.t)} ${fr(eventText(e, trip))}`);
  return lines.join('\n');
}

/** Typographie française d'une ligne : insécables (« : ; ! ? », guillemets, nombre et unité), jamais de tiret long ni moyen. */
function fr(s: string): string {
  return s
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, '-')
    .replace(/[ \t  ]*([;:!?])(?=$|[\s),.»])/g, `${NB}$1`)
    .replace(/«[ \t  ]*/g, `«${NB}`)
    .replace(/[ \t  ]*»/g, `${NB}»`)
    .replace(/(\d)[ \t  ]+(%|min|km|m|s|h)(?=$|[\s,.;:!?)])/g, `$1${NB}$2`);
}

const has = (table: Readonly<Record<string, string>>, key: unknown): string | undefined =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? numText(v) : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const numText = (v: number): string => String(v).replace('.', ',');

function momentName(m: unknown): string {
  return has(JOURNAL_MOMENT_WORDS, m) ?? (typeof m === 'string' && m ? m : 'Message');
}

/** « 40 s », « 3 min 20 s ». */
function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}${NB}s`;
  const rest = s % 60;
  return `${Math.floor(s / 60)}${NB}min${rest ? ` ${rest}${NB}s` : ''}`;
}

function eventText(e: JournalEvent, trip: JournalTrip): string {
  const d: Detail = e.d ?? {};
  switch (e.k) {
    case 'start':
      return (d.kind ?? trip.kind) === 'ride' ? `Début du guidage «${NB}j’y descends${NB}»` : 'Début du guidage';
    case 'battery': {
      const level = num(d.level);
      return level === undefined ? 'Batterie des lunettes' : `Batterie des lunettes${NB}: ${Math.round(level)}${NB}%`;
    }
    case 'moment':
      return `${momentName(d.m)} affiché`;
    case 'clear':
      return `${momentName(d.m)} effacé d’un toucher`;
    case 'remind': {
      const n = num(d.n);
      return `${momentName(d.m)} renvoyé${n !== undefined ? ` (rappel ${numText(n)})` : ''}`;
    }
    case 'seen':
      return `${momentName(d.m)} vu (tête levée)`;
    case 'boarded':
      return `Montée constatée${str(d.line) ? `${NB}: ${str(d.line)}` : ''}`;
    case 'alighted':
      return `Descente constatée${str(d.stop) ? ` à ${str(d.stop)}` : ''}`;
    case 'replan': {
      const r = str(d.reason);
      return `Recalcul du trajet${r ? `${NB}: ${has(REPLAN_WORDS, r) ?? r}` : ''}`;
    }
    case 'passed':
      return `Arrêt dépassé${str(d.stop) ? `${NB}: ${str(d.stop)}` : ''}`;
    case 'arrived':
      return 'Arrivée constatée';
    case 'positions': {
      const parts: string[] = [];
      const n = num(d.n);
      if (n !== undefined) parts.push(n === 0 ? 'aucune reçue' : `${numText(n)} reçue${n > 1 ? 's' : ''}`);
      const acc = num(d.acc);
      if (acc !== undefined) parts.push(`précision médiane ${numText(acc)}${NB}m`);
      const gap = num(d.gap);
      if (gap !== undefined) parts.push(`plus long trou ${duration(gap)}`);
      return `Positions${parts.length ? `${NB}: ${parts.join(', ')}` : ''}`;
    }
    case 'fg':
      return d.on === false ? 'Quai quitté sur les lunettes' : 'Quai revenu au premier plan des lunettes';
    case 'glasses':
      return d.connected === false ? 'Lunettes déconnectées' : 'Lunettes reconnectées';
    case 'check':
      return `Vérification${str(d.issues) ? `${NB}: ${str(d.issues)}` : ''}`;
    case 'end': {
      const end = str(d.end) || trip.end || '';
      return `Fin du guidage${end ? `${NB}: ${has(END_WORDS, end) ?? end}` : ''}`;
    }
    case JOURNAL_FORGOTTEN: {
      const n = Math.max(1, Math.round(num(d.n) ?? 1));
      return n > 1 ? `${n} événements oubliés` : '1 événement oublié';
    }
    default: {
      // sorte inconnue : écrite telle quelle, avec ses détails
      const extra = Object.entries(d).map(([k, v]) => `${k}${NB}: ${typeof v === 'boolean' ? (v ? 'oui' : 'non') : str(v)}`);
      return extra.length ? `${e.k} (${extra.join(', ')})` : e.k;
    }
  }
}

/* ------------------------------ Petits outils ------------------------------ */

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function finite(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : undefined;
}

function timeOf(x: unknown, now: () => number): number {
  return finite(x) ?? now();
}

/** Taille en octets (UTF-8) d'un texte bien formé. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)) || 'Erreur inconnue';
}
