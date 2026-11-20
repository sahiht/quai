/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : sorties du métro et du prémétro, fichier data/exits.json. Écrit par le pipeline avec le
 * graphe piéton de la semaine et le même extrait OpenStreetMap (pipeline/src/walk/exits.ts), lu par le téléphone ;
 * jamais demandé par la 1.3.0. Fichier autonome, sans aucun import : le pipeline le lit tel quel avec Node
 * (--experimental-strip-types).
 *
 * Un arrêt STIB sous terre, par le numéro de son arrêt physique (celui des données officielles : `Leg.toStop`), garde 3
 * sorties au plus, de la plus proche à la plus lointaine par les couloirs : nom de la rue ou de la place (en français,
 * tel qu'OpenStreetMap l'écrit ; l'apostrophe typographique est mise à l'affichage), point en surface (degrés, 5
 * décimales) et mètres de couloir depuis le quai. Jamais le nom de la station elle-même, jamais un nom qui n'est pas
 * une rue ou une place (tri fait par le pipeline). La sortie montrée est choisie sur le téléphone, vers la suite du
 * chemin (chooseExit) : rien n'est envoyé.
 */

/** Chemin du fichier dans les données publiées. */
export const EXITS_FILE = 'exits.json';
/** Sorties gardées par arrêt. */
export const MAX_EXITS = 3;

/** Une sortie : [nom, latitude, longitude, mètres de couloir depuis le quai]. */
export type ExitTuple = [string, number, number, number];

export interface ExitsFile {
  v: 1;
  /** date des données OpenStreetMap (AAAA-MM-JJ), la même que celle des tuiles piétonnes */
  version: string;
  /** instant de la construction (ISO 8601) */
  builtAt: string;
  source: string;
  licence: string;
  attribution: string;
  /** numéro STIB de l'arrêt physique → nom de la station (relecture) et sorties */
  stops: Record<string, { s: string; x: ExitTuple[] }>;
}

export interface ExitPoint {
  name: string;
  lat: number;
  lon: number;
  /** mètres de couloir depuis le quai */
  m: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function isTuple(x: unknown): x is ExitTuple {
  return (
    Array.isArray(x) &&
    x.length === 4 &&
    typeof x[0] === 'string' &&
    x[0].trim().length > 0 &&
    x[0].length <= 120 &&
    isNum(x[1]) &&
    Math.abs(x[1]) <= 90 &&
    isNum(x[2]) &&
    Math.abs(x[2]) <= 180 &&
    isNum(x[3]) &&
    x[3] >= 0
  );
}

/** Fichier des sorties bien formé (sinon il est ignoré : aucune sortie). */
export function isExitsFile(x: unknown): x is ExitsFile {
  if (!isObj(x) || x.v !== 1 || typeof x.version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.version) || !isObj(x.stops)) return false;
  for (const v of Object.values(x.stops)) {
    if (!isObj(v) || typeof v.s !== 'string' || !Array.isArray(v.x) || v.x.length === 0 || v.x.length > MAX_EXITS || !v.x.every(isTuple)) return false;
  }
  return true;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Sorties d'un arrêt physique, de la plus proche à la plus lointaine ; [] sans fichier, hors de la STIB, sans numéro
 * d'arrêt ou sans sortie connue (arrêt en surface). Numéro exact, sinon sans sa lettre finale (« 6357F » → « 6357 »).
 */
export function exitsOf(f: ExitsFile | null | undefined, op: string | undefined, stopId: string | undefined): ExitPoint[] {
  if (!f || op !== 'stib') return [];
  const key = exitKey(f, stopId);
  if (key === null) return [];
  return f.stops[key].x.map(([name, lat, lon, m]) => ({ name, lat, lon, m }));
}

/** Clé du fichier pour un numéro d'arrêt physique : le numéro exact, sinon sans sa lettre finale ; null s'il n'y est pas. */
export function exitKey(f: ExitsFile, stopId: string | undefined): string | null {
  if (!stopId) return null;
  const bare = stopId.replace(/[A-Za-z]+$/, '');
  return own(f.stops, stopId) ? stopId : bare && own(f.stops, bare) ? bare : null;
}

const RAD = Math.PI / 180;

/** Distance à vol d'oiseau en mètres (projection locale, assez juste à l'échelle d'une marche). */
function crowM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dy = (b.lat - a.lat) * 111_195;
  const dx = (b.lon - a.lon) * 111_195 * Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Sortie vers la suite du chemin : la plus courte en mètres de couloir plus vol d'oiseau jusqu'au bout de la marche
 * (arrêt suivant ou destination) ; sans bout connu, la plus proche du quai. null sans sortie.
 */
export function chooseExit(exits: readonly ExitPoint[], toward?: { lat: number; lon: number } | null): ExitPoint | null {
  if (!exits.length) return null;
  if (!toward || !isNum(toward.lat) || !isNum(toward.lon)) return exits[0];
  let best = exits[0];
  let cost = Infinity;
  for (const e of exits) {
    const c = e.m + crowM(e, toward);
    if (c < cost) {
      best = e;
      cost = c;
    }
  }
  return best;
}
