/**
 * Quai : petits utilitaires partagés par le cœur et l'interface (purs, sans dépendance).
 * Heures toujours affichées à l'heure belge, quel que soit le fuseau du téléphone.
 */
import type { Op, Mode, Names, AreaSummary } from '../../../shared/types';
import type { NameLang } from './api';

export const TZ = 'Europe/Brussels';

/* ------------------------------ Heures ------------------------------ */

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** Date et heure locales (Bruxelles) d'un instant. */
export function brusselsParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number; date: string } {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  const h = Number(p.hour) % 24; // certains moteurs écrivent 24:00
  const y = Number(p.year), mo = Number(p.month), d = Number(p.day);
  return { y, mo, d, h, mi: Number(p.minute), s: Number(p.second), date: `${p.year}-${p.month}-${p.day}` };
}

/** Décalage de Bruxelles par rapport à UTC à cet instant, en ms (3 600 000 l'hiver, 7 200 000 l'été). */
export function tzOffsetMs(ms: number): number {
  const p = brusselsParts(ms);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000) * 60000;
}

/** « 07:42 » à l'heure belge. */
export function hhmm(ms: number): string {
  const p = brusselsParts(ms);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/** Date de service locale « YYYY-MM-DD » d'un instant. */
export function localDate(ms: number): string { return brusselsParts(ms).date; }

/** Minutes depuis minuit (heure belge) d'un instant. */
export function localMinutes(ms: number): number { const p = brusselsParts(ms); return p.h * 60 + p.mi; }

/**
 * Origine GTFS d'une date de service : midi local moins 12 h (règle GTFS, juste aussi les jours de changement d'heure).
 * Un horaire GTFS « HH:MM » vaut serviceDayBase(date) + (HH*60+MM) minutes.
 */
export function serviceDayBase(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, 12, 0, 0);
  const noon = guess - tzOffsetMs(guess);
  return noon - 12 * 3600_000;
}

/** Instant (epoch ms) d'un horaire GTFS exprimé en minutes depuis l'origine du jour de service. */
export function gtfsTime(date: string, minutes: number): number { return serviceDayBase(date) + minutes * 60_000; }

/** Minutes entières avant un instant (arrondi vers le bas, jamais négatif). */
export function minutesUntil(ms: number, now: number): number { return Math.max(0, Math.floor((ms - now) / 60_000)); }

/* ------------------------------ Distances ------------------------------ */

/** Distance à vol d'oiseau en mètres (haversine). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes de marche : distance × 1,3 (détours) à 80 m/min, arrondi au-dessus, au moins 1. */
export function walkMinutes(distance: number): number { return Math.max(1, Math.ceil((distance * 1.3) / 80)); }

/* ------------------------------ Noms et libellés ------------------------------ */

export const OP_NAME: Record<Op, string> = { sncb: 'SNCB', stib: 'STIB', delijn: 'De Lijn', tec: 'TEC' };
const MODE_RANK: Mode[] = ['train', 'metro', 'tram', 'bus'];
const MODE_WORD: Record<Mode, string> = { train: 'train', metro: 'métro', tram: 'tram', bus: 'bus' };

/** Nom selon le réglage de langue (« Comme sur place » = langue locale du lieu). */
export function displayName(n: Names, lang: NameLang): string {
  if (lang === 'nl') return n.nl || n.fr;
  if (lang === 'local') return (n.l === 'nl' ? n.nl : n.fr) || n.fr || n.nl;
  return n.fr || n.nl;
}

/** Mode principal d'une zone : train > métro > tram > bus. */
export function mainMode(modes: Mode[]): Mode {
  return MODE_RANK.find((m) => modes.includes(m)) ?? 'bus';
}

/** Mot du mode, avec la compagnie quand elle aide (bus et trams hors STIB) : 'tram', 'bus De Lijn', 'bus TEC'. */
export function modeWord(mode: Mode, op: Op): string {
  if (mode === 'train' || op === 'stib') return MODE_WORD[mode];
  return `${MODE_WORD[mode]} ${OP_NAME[op]}`;
}

/** Libellé d'une zone dans les listes : « Gare du Nord, tram », « Bruxelles-Nord, bus De Lijn ». */
export function areaLabel(a: Pick<AreaSummary, 'n' | 'op' | 'modes'>, lang: NameLang): string {
  return `${displayName(a.n, lang)}, ${modeWord(mainMode(a.modes), a.op)}`;
}

/** Type d'un résultat de recherche : « gare SNCB », « tram De Lijn », « métro STIB », « bus TEC ». */
export function kindLabel(op: Op, modes: Mode[]): string {
  const m = mainMode(modes);
  if (m === 'train') return 'gare SNCB';
  return `${MODE_WORD[m]} ${OP_NAME[op]}`;
}

/** Nom court d'une ligne pour les lunettes : tram « T3 », métro « M2 », bus « 232 », train « IC ». */
export function lineLabel(mode: Mode, line: string): string {
  if (mode === 'tram') return `T${line}`;
  if (mode === 'metro') return `M${line}`;
  return line;
}

/** Coupe un texte à `max` caractères avec « … » si besoin (les lunettes affichent ~48 caractères par ligne). */
export function fit(text: string, max = 48): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
