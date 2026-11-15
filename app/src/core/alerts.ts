/**
 * 1.2.10 (PRD-1.2.10 § 6) : alertes des opérateurs (travaux, déviations…) qui concernent un trajet ou un tableau, et
 * leur texte court. Fonctions pures : ni réseau, ni horloge.
 *
 * Constat du 14/11 : « Travaux : Binche | Travaux réfection rue Zéphir… » sur un trajet Waterloo → Bruxelles. Le TEC
 * publie certaines alertes sans ligne ni arrêt (l'agence seule ; la ligne n'est nommée que dans le titre,
 * « Lieu | Cause | Lignes ») : le relais les marque `global` et l'appli les rattachait à tout trajet du TEC, puis
 * montrait le titre brut, coupé à 48 caractères au milieu d'un mot.
 *
 * Usage pour les écrans (l'équipe des écrans affiche le texte tel quel) :
 * - `Alert.text` d'une alerte `works` d'un trajet (core/journeys.ts) : rédigé par worksText(), 48 caractères au plus et
 *   ALERT_MAX_PX au plus avec la police des lunettes (ligne du haut, toute la largeur) ; jamais coupé dans un mot,
 *   jamais de « | », espaces insécables posées.
 * - `core.works()` (tableaux d'une gare ou d'un arrêt, détail d'une ligne) : même rédaction, avec la place du préfixe
 *   « ! » que les écrans ajoutent (BOARD_PREFIX) : 46 caractères au plus.
 */
import type { Names, Op } from '../../../shared/types';
import { normalizeId } from '../../../shared/types';
import { textWidth } from '../glasses/font';
import { WIDTHS } from '../glasses/layout';

/** Alerte telle que le relais la rend (/api/alerts ; 1.2.10 : cause, effet, description, portée). */
export interface FeedAlert {
  id: string;
  /** route_id normalisés des entités informées. */
  routes: string[];
  /** stop_id normalisés des entités informées. */
  stops: string[];
  header: Partial<Record<'fr' | 'nl' | 'en' | 'de', string>>;
  /** Périodes [début, fin] en secondes epoch, 0 pour une borne absente ; aucune : toujours active. */
  active: [number, number][];
  /** 1.2.10 : énumérations GTFS-RT (CONSTRUCTION, DETOUR, STOP_MOVED…), absentes si le flux ne les donne pas. */
  cause?: string;
  effect?: string;
  /** 1.2.10 : description (300 caractères au plus), quand elle diffère du titre. */
  desc?: Partial<Record<'fr' | 'nl' | 'en' | 'de', string>>;
  /** 1.2.10 : agence ou type de transport sans ligne ni arrêt (le relais ne sait pas à quoi elle s'applique). */
  global?: boolean;
}

/** Arrêt d'une étape ou d'un tableau : identifiant (stop_id, pointid STIB, gare SNCB), nom, montée ou descente. */
export interface ScopeStop {
  id: string;
  name: string;
  /** Vrai à la montée et à la descente (un tableau : tous les arrêts de la zone) ; faux pour un arrêt traversé. */
  end: boolean;
}

/** Ce qu'il faut savoir d'une étape (ou d'un tableau) pour juger une alerte. */
export interface AlertScope {
  op: Op;
  /** Numéros publics des lignes (« W », « 36 », trains : « IC »). */
  lines: string[];
  /** route_id de ces lignes (TEC « B0536-23747 », De Lijn « 10170 »). */
  routes: string[];
  stops: ScopeStop[];
  /** Autres noms du lieu (zone de montée et de descente en français et en néerlandais). */
  names?: string[];
  /** Heures de l'étape (ms) : l'alerte doit être active à un moment de [from, to]. */
  from: number;
  to: number;
}

/** Pourquoi une alerte concerne l'étape : arrêt de montée ou de descente, arrêt traversé, ligne, texte. */
export interface AlertMatch {
  by: 'end' | 'via' | 'route' | 'text';
  /** Nom de l'arrêt de l'étape touché par l'alerte (by 'end' ou 'via'). */
  stop?: string;
}

/** Largeur au pixel de la ligne du haut (toute la largeur de l'écran, police des lunettes). */
export const ALERT_MAX_PX = WIDTHS.full;
export const ALERT_MAX_CHARS = 48;
/** Préfixe que les écrans des tableaux et du détail d'une ligne ajoutent devant le texte de core.works(). */
export const BOARD_PREFIX = '! ';

export interface TextBudget {
  maxChars: number;
  maxPx: number;
}
export const TRIP_BUDGET: TextBudget = { maxChars: ALERT_MAX_CHARS, maxPx: ALERT_MAX_PX };
export const BOARD_BUDGET: TextBudget = { maxChars: ALERT_MAX_CHARS - BOARD_PREFIX.length, maxPx: ALERT_MAX_PX - textWidth(BOARD_PREFIX) };

const NB = ' ';

/* ------------------------------ Mots et noms ------------------------------ */

/** Texte comparable : minuscules, sans accents, mots séparés par une espace. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PLACE_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'gare', 'station', 'arret', 'halte', 'sncb', 'nmbs', 'van', 'het', 'den', 'der', 'ter', 'te', 'aan', 'sur', 'lez', 'les']);
const SAINT = new Map([['st', 'saint'], ['ste', 'sainte'], ['sint', 'saint'], ['sankt', 'saint']]);

/** Mots significatifs d'un nom de lieu (« Gare de Lillois » → lillois ; « Court-St-Etienne » → court saint etienne). */
export function placeWords(s: string): string[] {
  return fold(s)
    .split(' ')
    .map((w) => SAINT.get(w) ?? w)
    .filter((w) => w.length > 1 && !PLACE_STOP.has(w));
}

/** Le lieu nommé par une alerte est-il l'un des arrêts du trajet ? Tous ses mots dans un même nom d'arrêt. */
export function placeMatches(place: string, names: readonly string[]): boolean {
  const want = placeWords(place);
  if (!want.length) return false;
  return names.some((n) => {
    const have = new Set(placeWords(n));
    return want.every((w) => have.has(w));
  });
}

/** Clé d'une ligne (« 039 » et « 39 », « w » et « W ») comme ailleurs dans Quai. */
const lineKey = (s: string): string => s.trim().toUpperCase().replace(/^0+(?=\w)/, '');

/** Gare SNCB : « 8811601_2 », « S8811601 » et « 8811601 » sont la même gare. */
const stopKey = (op: Op, id: string): string => {
  const s = normalizeId(String(id ?? '').trim());
  return op === 'sncb' ? s.replace(/^S(?=\d)/, '').split('_')[0] : s;
};

/* ------------------------------ Titres structurés du TEC ------------------------------ */

/** Titre découpé : « Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44 », « Braine-l'Alleud / Travaux / Lignes 39, 40 ». */
export interface ParsedHeader {
  place?: string;
  /** Mot de la cause (« Travaux », « Accident »), tel que l'opérateur l'écrit en tête de son segment. */
  cause?: string;
  /** Lignes nommées (« E44 », « 39 », « 203 » pour « Proxibus Braine L'Alleud (203) »). */
  lines?: string[];
  /** Vrai si le titre a la forme « A | B | C » (au moins deux segments). */
  structured: boolean;
}

const CAUSE_WORDS: [RegExp, string][] = [
  [/^(travaux|chantier|werken|werkzaamheden|works?)\b/, 'Travaux'],
  [/^(accident|ongeval|collision|aanrijding)\b/, 'Accident'],
  [/^(greve|staking|strike|action syndicale|actions syndicales|vakbondsactie)\b/, 'Grève'],
  [/^(manifestation|betoging)\b/, 'Manifestation'],
  [/^(evenement|evenementen|event|braderie|marche|kermesse|carnaval|course|cortege|festival|feest)\b/, 'Événement'],
  [/^(intemperies|neige|verglas|inondation|sneeuw|ijzel|storm|tempete)\b/, 'Intempéries'],
  [/^(incident|panne|defectuosite|storing|defect)\b/, 'Incident'],
  [/^(deviation|omleiding|detour)\b/, 'Déviation'],
];

const LINES_SEGMENT = /^(lignes?|lijnen|lijn|proxibus|bus|tram|metro|ligne express|express)\b/;

/** Lignes d'un segment « Lignes A, 1, 2, 3, 5 et 9 », « Ligne E44 », « Proxibus Braine L'Alleud (203) ». */
export function linesOf(segment: string): string[] {
  const paren = [...segment.matchAll(/\(([A-Za-z]{0,3}\d{1,4}[a-z]?)\)/g)].map((m) => m[1]);
  if (paren.length) return paren.map(lineKey);
  const body = segment.replace(/^\s*(lignes?|lijnen|lijn|ligne express|express|bus|tram|m[ée]tro)\b\s*/i, '');
  return body
    .split(/\s*(?:,|;|\bet\b|\ben\b|&|\+)\s*/i)
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z]{0,3}\d{0,4}[a-z]?$/.test(t) && t.length > 0 && t.length <= 6)
    .map(lineKey);
}

/** Lignes nommées dans une phrase (« la ligne E44 est déviée », « les lignes 29 et 39 »). */
export function linesInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:lignes?|lijnen|lijn)\s+((?:[A-Za-z]{0,3}\d{1,4}[a-z]?|[A-Z])(?:\s*(?:,|et|en|&)\s*(?:[A-Za-z]{0,3}\d{1,4}[a-z]?|[A-Z]))*)/gi)) out.push(...linesOf(m[1]));
  return [...new Set(out)];
}

function causeOfSegment(seg: string): string | undefined {
  const f = fold(seg);
  for (const [re, word] of CAUSE_WORDS) if (re.test(f)) return word;
  return undefined;
}

/** Lieu d'une phrase libre : « Travaux à Ottignies : … », « Werken in Gent: … » (un nom propre après « à » ou « in »). */
function placeInSentence(text: string): string | undefined {
  const m = /(?:^|\s)(?:à|in|te)\s+([A-ZÀ-Ý][\p{L}'’.-]*(?:[ -](?:[A-ZÀ-Ý][\p{L}'’.-]*|lez|sur|l['’][\p{L}-]+))*)/u.exec(text);
  return m ? m[1].replace(/[.'’-]+$/, '') : undefined;
}

export function parseHeader(text: string): ParsedHeader {
  const t = clean(text);
  const segs = t.split(/\s+[|/]\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return { structured: false, ...(placeInSentence(t) ? { place: placeInSentence(t) } : {}) };
  const out: ParsedHeader = { structured: true };
  segs.forEach((seg, i) => {
    const f = fold(seg);
    if (LINES_SEGMENT.test(f) || /^\d+[a-z]?(\s*(,|et)\s*\d+[a-z]?)*$/i.test(seg)) {
      const ls = linesOf(seg);
      if (ls.length) out.lines = [...(out.lines ?? []), ...ls];
      return;
    }
    const cause = causeOfSegment(seg);
    if (cause && !out.cause) {
      out.cause = cause;
      return;
    }
    if (i === 0 && !out.place) out.place = seg;
  });
  return out;
}

/* ------------------------------ Pertinence ------------------------------ */

/** Effets qui touchent le parcours du véhicule (un arrêt traversé compte) ; les autres ne valent qu'à la montée ou à la descente. */
const RUN_EFFECTS = new Set(['DETOUR', 'SIGNIFICANT_DELAYS', 'REDUCED_SERVICE', 'NO_SERVICE', 'MODIFIED_SERVICE', 'OTHER_EFFECT', 'UNKNOWN_EFFECT']);
/** Effets propres à un arrêt : sur la ligne mais ailleurs que sur le trajet, l'alerte ne le concerne pas. */
const STOP_EFFECTS = new Set(['STOP_MOVED', 'ACCESSIBILITY_ISSUE', 'NO_EFFECT', 'ADDITIONAL_SERVICE']);

const NETWORK_WIDE = /\b(greve|greves|staking|stakingen|strike|action syndicale|actions syndicales|vakbondsactie|tout le reseau|l ensemble du reseau|ensemble du reseau|sur tout le reseau|heel het net|het hele net|volledige net|jour ferie|feestdag|intemperies|verglas|neige|sneeuw|ijzel)\b/;
const ALL_CLEAR_A = /\b(reprise|reprend|reprennent|reprendront|retabli|retablie|retablis|retablissement|retour a la normale|terug normaal|hervat|hervatting|opnieuw normaal)\b/;
const ALL_CLEAR_B = /\b(habituel|habituelle|habituels|habituelles|normal|normale|normaux|normaal|gewone)\b/;

const headerOf = (a: FeedAlert): string => a.header.fr ?? a.header.nl ?? a.header.en ?? a.header.de ?? '';
const descOf = (a: FeedAlert): string => a.desc?.fr ?? a.desc?.nl ?? a.desc?.en ?? a.desc?.de ?? '';

/** Active à un moment de [from, to] (ms) ; sans période : toujours. */
export function activeDuring(a: Pick<FeedAlert, 'active'>, from: number, to: number): boolean {
  if (!a.active?.length) return true;
  return a.active.some(([s, e]) => (!s || s * 1000 <= to) && (!e || from <= e * 1000));
}

/** Fin de perturbation (« Reprise de l'itinéraire habituel | Lignes 29 et 39 ») : rien à faire, jamais montrée. */
export function isAllClear(a: FeedAlert): boolean {
  if (a.effect === 'NO_EFFECT') return true;
  const h = fold(headerOf(a));
  return ALL_CLEAR_A.test(h) && ALL_CLEAR_B.test(h);
}

/** Alerte de tout un réseau (grève, jour férié, intempéries) : concerne tout trajet de ce réseau pendant sa période. */
export function isNetworkWide(a: FeedAlert): boolean {
  if (a.cause === 'STRIKE' || a.cause === 'HOLIDAY' || a.cause === 'WEATHER') return true;
  return NETWORK_WIDE.test(fold(headerOf(a)));
}

/**
 * L'alerte concerne-t-elle cette étape (ou ce tableau) ? Règles, dans l'ordre :
 * 1. active pendant l'étape (from, to), et pas une fin de perturbation ;
 * 2. un arrêt de montée ou de descente touché : oui ;
 * 3. un arrêt traversé : seulement si l'effet touche le parcours (déviation, retards, service réduit ou interrompu),
 *    jamais pour un arrêt déplacé ou un ascenseur ailleurs que là où l'on monte ou descend ;
 * 4. la ligne touchée : oui, sauf si l'alerte nomme ses arrêts, ne vise que ces arrêts (arrêt déplacé…) et qu'aucun
 *    n'est sur l'étape ;
 * 5. sans ligne ni arrêt (agence seule, `global`) : seulement d'après le texte : une ligne de l'étape nommée et le lieu
 *    nommé parmi ses arrêts (un même numéro existe dans plusieurs régions), ou le lieu seul s'il est parmi ses arrêts,
 *    ou une alerte de tout le réseau (grève, jour férié, intempéries) ; sinon non (précision d'abord : c'était
 *    « Binche » sur un trajet Waterloo → Bruxelles).
 */
export function alertMatch(a: FeedAlert, s: AlertScope): AlertMatch | null {
  if (!activeDuring(a, s.from, s.to) || isAllClear(a)) return null;
  const effect = a.effect ?? '';
  const byId = new Map<string, ScopeStop>();
  for (const st of s.stops) {
    const k = stopKey(s.op, st.id);
    const had = byId.get(k);
    if (!had || (st.end && !had.end)) byId.set(k, st);
  }
  const hits = (a.stops ?? []).map((x) => byId.get(stopKey(s.op, x))).filter((x): x is ScopeStop => !!x);
  const end = hits.find((x) => x.end);
  const via = hits.find((x) => !x.end);
  const runs = !effect || RUN_EFFECTS.has(effect);
  if (end) return { by: 'end', stop: end.name };
  if (via && runs) return { by: 'via', stop: via.name };
  const routes = new Set(s.routes.map((r) => normalizeId(r)));
  if ((a.routes ?? []).some((r) => routes.has(normalizeId(r)))) {
    if ((a.stops ?? []).length && STOP_EFFECTS.has(effect)) return null;
    return { by: 'route' };
  }
  if ((a.routes ?? []).length || (a.stops ?? []).length) return null;
  return textMatch(a, s);
}

function textMatch(a: FeedAlert, s: AlertScope): AlertMatch | null {
  const h = parseHeader(headerOf(a));
  const names = [...s.stops.map((x) => x.name), ...(s.names ?? [])];
  const named = h.lines?.length ? h.lines : linesInText(`${headerOf(a)} ${descOf(a)}`);
  const place = h.place;
  if (named.length && s.op !== 'sncb') {
    const mine = new Set(s.lines.map(lineKey));
    if (!named.some((l) => mine.has(l))) return null;
    return place && placeMatches(place, names) ? { by: 'text' } : null;
  }
  if (place) return placeMatches(place, names) ? { by: 'text' } : null;
  return isNetworkWide(a) ? { by: 'text' } : null;
}

/* ------------------------------ Rédaction ------------------------------ */

const CAUSE_TEXT: Record<string, string> = {
  CONSTRUCTION: 'Travaux',
  MAINTENANCE: 'Travaux',
  ACCIDENT: 'Accident',
  STRIKE: 'Grève',
  DEMONSTRATION: 'Manifestation',
  WEATHER: 'Intempéries',
  TECHNICAL_PROBLEM: 'Problème technique',
  POLICE_ACTIVITY: 'Intervention de police',
  MEDICAL_EMERGENCY: 'Urgence médicale',
  HOLIDAY: 'Jour férié',
};

const EFFECT_TEXT: Record<string, string> = {
  DETOUR: 'déviation',
  STOP_MOVED: 'arrêt déplacé',
  NO_SERVICE: 'service interrompu',
  REDUCED_SERVICE: 'service réduit',
  SIGNIFICANT_DELAYS: 'retards possibles',
  ADDITIONAL_SERVICE: 'service renforcé',
  ACCESSIBILITY_ISSUE: 'accès difficile',
};

/** Effet lu dans le texte (flux sans effet, ou effet vague) : seulement des formules sans ambiguïté. */
const EFFECT_WORDS: [RegExp, string][] = [
  [/\b(arrets?|haltes?|haltes) (ne (sont|seront) pas|non) desservi/, 'arrêts non desservis'],
  [/\b(ne (sera|seront|est|sont) (pas|plus) desservi|non desservi|niet bediend|wordt niet bediend|worden niet bediend)/, 'arrêt non desservi'],
  [/\b(devie|devies|deviee|deviees|deviation|omgeleid|omleiding)\b/, 'déviation'],
  [/\b(deplace|deplaces|deplacee|deplacees|verplaatst|remplace par l arret|reporte a l arret)\b/, 'arrêt déplacé'],
  [/\b(ne circule plus|ne circulera pas|ne circulent pas|ne circuleront pas|rijdt niet|rijden niet|geen verkeer)\b/, 'service interrompu'],
  [/\b(retard|retards|vertraging|vertragingen)\b/, 'retards possibles'],
];

/** Texte sans « | », sans tiret long ni moyen, sans caractères invisibles, espaces resserrées. */
export function clean(text: string): string {
  return String(text ?? '')
    .replace(/[​-‏‪-‮⁦-⁩﻿­]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+[–—―]\s+/g, ', ')
    .replace(/[–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Typographie française : espace insécable devant « : ; ! ? », entre un nombre et son unité ; guillemets « ». */
export function frenchText(text: string): string {
  return text
    .replace(/[   ]*([:;!?])(?=\s|$)/g, `${NB}$1`)
    .replace(/(\d) (min|h|s|m|km)\b/g, `$1${NB}$2`)
    .replace(/"([^"]+)"/g, `«${NB}$1${NB}»`)
    .replace(/«\s*/g, `«${NB}`)
    .replace(/\s*»/g, `${NB}»`);
}

/** Le texte tient-il dans le budget (caractères et pixels, police des lunettes) ? */
export function fits(text: string, b: TextBudget = TRIP_BUDGET): boolean {
  return [...text].length <= b.maxChars && textWidth(text) <= b.maxPx;
}

/** Petits mots qui ne finissent jamais un texte coupé (« … de… », « … ne… »). */
const TAIL_WORDS = new Set([
  'a', 'au', 'aux', 'de', 'des', 'du', 'd', 'la', 'le', 'les', 'l', 'et', 'ou', 'ni', 'en', 'sur', 'sous', 'par', 'pour', 'vers', 'entre', 'dans', 'avec', 'sans', 'chez',
  'un', 'une', 'ne', 'n', 'pas', 'qui', 'que', 'qu', 'se', 's', 'sa', 'son', 'ses', 'leur', 'leurs', 'ce', 'cet', 'cette', 'ces', 'il', 'elle', 'ils', 'elles', 'on', 'y',
  'est', 'sont', 'sera', 'seront', 'mais', 'donc', 'car', 'van', 'het', 'een', 'naar', 'in', 'op', 'te', 'ter', 'aan', 'met', 'voor', 'niet', 'the', 'of', 'to', 'at',
  ':', ';', ',', '-', '/',
]);

/** Coupe à la dernière fin de mot qui tient, avec « … » ; jamais au milieu d'un mot ni après un petit mot. */
export function fitWords(text: string, b: TextBudget = TRIP_BUDGET): string {
  const t = text.trim();
  if (fits(t, b)) return t;
  const words = t.split(' ');
  for (let n = words.length - 1; n > 0; n--) {
    const head = words.slice(0, n);
    while (head.length > 1 && TAIL_WORDS.has(fold(head[head.length - 1]) || head[head.length - 1])) head.pop();
    const cand = `${head.join(' ').replace(/[\s,;:. -]+$/, '')}…`;
    if (fits(cand, b)) return cand;
  }
  return '';
}

/** « à Binche », « à la gare de Lillois », « rue de Fer » (une rue ou une place sans préposition). */
export function atPlace(place: string): string {
  const p = place.trim();
  if (/^gare\b/i.test(p)) return `à la ${p.charAt(0).toLowerCase()}${p.slice(1)}`;
  if (/^(rue|avenue|place|chauss[ée]e|boulevard|dr[èe]ve|route|square|quai|pont|rond-point|parvis|all[ée]e|chemin|clos|impasse)\b/i.test(p)) return `${p.charAt(0).toLowerCase()}${p.slice(1)}`;
  return `à ${p}`;
}

function causeText(a: FeedAlert, h: ParsedHeader): string | undefined {
  const c = a.cause ? CAUSE_TEXT[a.cause] : undefined;
  if (c) return c;
  if (h.cause && h.cause !== 'Déviation') return h.cause;
  const f = fold(`${headerOf(a)} ${descOf(a)}`);
  if (/\b(travaux|chantier|werken|werkzaamheden)\b/.test(f)) return 'Travaux';
  if (/\b(greve|staking)\b/.test(f)) return 'Grève';
  return undefined;
}

/** Effet : celui du flux quand il est précis, sinon d'après le texte (`fromText`). */
function effectText(a: FeedAlert): { text: string; fromText: boolean } | undefined {
  const e = a.effect ? EFFECT_TEXT[a.effect] : undefined;
  if (e) return { text: e, fromText: false };
  const f = fold(`${headerOf(a)} ${descOf(a)}`);
  for (const [re, word] of EFFECT_WORDS) if (re.test(f)) return { text: word, fromText: true };
  return undefined;
}

/** « arrêt Waterloo Gare déplacé », « déviation à Waterloo Gare », « retards possibles à Ottignies ». */
function withStop(effect: string, stop: string): string {
  if (effect === 'arrêt déplacé') return `arrêt ${stop} déplacé`;
  if (effect === 'arrêt non desservi') return `arrêt ${stop} non desservi`;
  return `${effect} à ${stop}`;
}

/**
 * Texte court d'une alerte qui concerne l'étape (alertMatch), dans le budget : « Travaux : déviation à Binche »,
 * « Travaux : arrêt Waterloo Gare déplacé », « Grève : service réduit » ; sinon la phrase de l'opérateur nettoyée,
 * coupée à une fin de mot (« Ligne 51 déviée rue de Fer »). null : rien de lisible.
 *
 * L'arrêt de l'étape n'est nommé que si l'effet vient du flux et que l'alerte vise cet arrêt : un effet lu dans le
 * texte (« arrêt Botanique non desservi ») ne parle pas forcément de l'arrêt où l'on monte.
 */
export function worksText(a: FeedAlert, m: AlertMatch, b: TextBudget = TRIP_BUDGET): string | null {
  const raw = headerOf(a);
  const h = parseHeader(raw);
  const cause = causeText(a, h);
  const eff = effectText(a);
  // phrase de l'opérateur, seulement en français (Quai parle français ; un titre néerlandais passe après le modèle)
  const french = !!a.header.fr?.trim();
  const sentence = h.structured ? '' : clean(raw);
  const generic = !!sentence && isGeneric(sentence);
  const own = french && !generic ? sentence : '';
  const detail = generic || !french ? firstSentence(a.desc?.fr ?? '') : '';
  const cands: string[] = [];
  if (eff) {
    const prefix = cause ?? (eff.text === 'déviation' || eff.text.startsWith('arrêt') ? 'Travaux' : 'Perturbation');
    const there = h.place ? `${prefix} : ${eff.text} ${atPlace(h.place)}` : '';
    if (!eff.fromText) {
      if (m.stop && (m.by === 'end' || m.by === 'via')) cands.push(`${prefix} : ${withStop(eff.text, m.stop)}`);
      if (there) cands.push(there);
      if (own) cands.push(own);
      if (detail) cands.push(detail);
      cands.push(`${prefix} : ${eff.text}`);
    } else if (h.structured) {
      if (there) cands.push(there);
      cands.push(`${prefix} : ${eff.text}`);
    } else {
      // effet lu dans une phrase libre : la phrase dit mieux où (« Travaux : arrêt Botanique non desservi »)
      if (own) cands.push(own);
      if (detail) cands.push(detail);
      if (there) cands.push(there);
      if (!own) cands.push(`${prefix} : ${eff.text}`);
    }
  }
  if (h.structured) {
    // titre « Lieu | Cause | Lignes » sans effet connu : « Travaux à Binche », « Accident à Seraing »
    const c = cause ?? h.cause;
    if (c && h.place) cands.push(`${c} ${atPlace(h.place)}`);
    if (c) cands.push(`${c} : ${lc(segmentsText(raw, h))}`);
  } else {
    if (detail) cands.push(detail);
    if (sentence && !generic) cands.push(sentence);
  }
  for (const c of cands) {
    const t = frenchText(clean(c));
    if (t && fits(t, b)) return upperFirst(t);
  }
  // rien ne tient : la phrase de l'opérateur (ou la dernière proposition) coupée à une fin de mot
  const longest = frenchText(clean(own || (cands[cands.length - 1] ?? '')));
  const cut = longest ? fitWords(longest, b) : '';
  return cut && /[\p{L}\d]/u.test(cut) ? upperFirst(cut) : null;
}

const GENERIC = new Set(['perturbation', 'perturbation inattendue', 'perturbations', 'info', 'info trafic', 'information', 'informations', 'avis', 'travaux', 'onverwachte storing', 'storing', 'storingen', 'hinder', 'werken', 'mededeling', 'disruption', 'unexpected disruption']);
/** Titre qui ne dit rien (« Perturbation inattendue » de De Lijn) : la description dit quoi. */
const isGeneric = (s: string): boolean => GENERIC.has(fold(s));
/** Première phrase d'une description (« T1 : Quai 1 supprimé. Tram T1 vers Expo… » → « T1 : Quai 1 supprimé »). */
const firstSentence = (s: string): string => {
  // sans « lookbehind » (absent des WebView d'iOS avant 16.4 : l'appli ne démarrerait pas)
  const t = clean(s);
  const m = /[a-zà-ÿ0-9)»][.!]\s/u.exec(t);
  return (m ? t.slice(0, m.index + 1) : t).replace(/[.!]$/, '').trim();
};

/** Segments d'un titre structuré qui ne sont ni la cause ni les lignes (« réfection rue Zéphirin Fontaine »). */
function segmentsText(raw: string, h: ParsedHeader): string {
  const segs = clean(raw).split(/\s+[|/]\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const rest = segs.filter((s) => s !== h.place && !LINES_SEGMENT.test(fold(s)) && !(causeOfSegment(s) && fold(s).split(' ').length === 1));
  const words = rest.map((s) => s.replace(/^(travaux|chantier|werken)\s+/i, '')).join(', ');
  return words || (h.place ?? '');
}

const lc = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Message d'un passage STIB (WaitingTimes) : la phrase de l'opérateur nettoyée, coupée à une fin de mot. */
export function stibMessageText(msg: string, b: TextBudget = TRIP_BUDGET): string | null {
  const t = frenchText(clean(msg));
  if (!t) return null;
  const out = fits(t, b) ? t : fitWords(t, b);
  return out ? upperFirst(out) : null;
}

/**
 * Textes des alertes qui concernent l'étape ou le tableau, rédigés, sans doublon, dans l'ordre du flux.
 * Fonction d'entrée pour core/journeys.ts (étapes) et core/index.ts (core.works : tableaux et détail d'une ligne).
 */
export function scopeTexts(alerts: readonly FeedAlert[] | null | undefined, s: AlertScope, b: TextBudget = TRIP_BUDGET): string[] {
  const out: string[] = [];
  for (const a of alerts ?? []) {
    const m = alertMatch(a, s);
    if (!m) continue;
    const t = worksText(a, m, b);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Noms d'un lieu dans les deux langues (pour placeMatches). */
export const namesOf = (n: Names | undefined): string[] => (n ? [...new Set([n.fr, n.nl].filter(Boolean))] : []);
