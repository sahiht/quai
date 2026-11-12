/**
 * Textes en français affichés dans les lunettes (≤ 48 caractères après fit()).
 * Jamais de tiret cadratin.
 */
import type { Mode, Names, Op } from '../../../shared/types';
import type { Departure, Leg, NameLang } from './api';
import { isSncbBus, SNCB_BUS_TEXT } from './means';
import { brusselsParts, displayName, hhmm, lineLabel, localDate, minutesUntil } from './util';

/** Espace insécable (devant « : ; ! ? » et entre un nombre et son unité). */
export const NB = ' ';

/**
 * Libellé d'un véhicule dans une phrase : catégorie du train (« IC ») ou ligne (« T3 », « M2 », « 232 ») ; 1.2.2 : bus
 * de remplacement de la SNCB (core/means.ts) : « bus SNCB », jamais « BUS » seul. Les colonnes étroites des départs
 * gardent le code court des données (Departure.line « BUS »).
 */
export function vehicleLabel(x: { op?: Op; mode?: Mode; line?: string; cat?: string }): string {
  if (isSncbBus(x)) return SNCB_BUS_TEXT;
  if (x.cat) return x.cat;
  return lineLabel(x.mode ?? 'bus', x.line ?? '');
}

/** Le même en tête de phrase (alertes « ! Bus SNCB 07:42 supprimé ») : seul « bus SNCB » prend la majuscule. */
export function vehicleLabelStart(x: { op?: Op; mode?: Mode; line?: string; cat?: string }): string {
  const s = vehicleLabel(x);
  return s === SNCB_BUS_TEXT ? `B${s.slice(1)}` : s;
}

/** Un véhicule de la SNCB qui roule sur des rails (pas un bus de remplacement) : heures prévues et voies. */
const isTrain = (x: { op?: Op; mode?: Mode; line?: string; cat?: string }): boolean => x.mode === 'train' && !isSncbBus(x);

/** Avant cette heure, un horaire du lendemain appartient encore à la nuit en cours : jamais « demain » (S6). */
export const DAY_START_HOUR = 4;

/**
 * Jour d'un horaire quand ce n'est pas aujourd'hui (heure belge) : « demain » (à partir de 04:00 du lendemain ;
 * avant, c'est la nuit en cours : à 23:30, un train à 00:01 s'écrit sans « demain »), au-delà « le 13/11 » ; sinon ''.
 */
export function dayWord(ms: number, now: number): string {
  const d = localDate(ms);
  const today = localDate(now);
  if (d <= today) return '';
  const [y, m, dd] = today.split('-').map(Number);
  if (d !== new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10)) return `le ${ddmm(d)}`;
  return brusselsParts(ms).h < DAY_START_HOUR ? '' : 'demain';
}
const atDay = (ms: number, now: number | undefined) => {
  const w = now === undefined ? '' : dayWord(ms, now);
  return w ? `${w} ${hhmm(ms)}` : hhmm(ms);
};

/** Heure avec son jour s'il le faut (S6) : « 06:02 », « demain 06:02 » ; `planned` : « ~06:02 », « demain ~06:02 ». */
export function timeText(ms: number, now: number, planned = false): string {
  const w = dayWord(ms, now);
  const t = `${planned ? '~' : ''}${hhmm(ms)}`;
  return w ? `${w} ${t}` : t;
}

/** Au-delà de cette attente, on écrit une heure plutôt que des minutes (S6 : jamais « ~298 min »). */
export const WAIT_MAX_MIN = 60;

/**
 * Attente d'un bus, d'un tram ou d'un métro (S6) : « imminent » (moins d'1 min), « 5 min », « ~5 min » ; à partir
 * de 60 min, l'heure : « 13:18 », « ~13:18 », « demain ~06:02 ». `planned` : horaire prévu à signaler (« ~ »).
 */
export function waitText(est: number, now: number, planned = false): string {
  const m = minutesUntil(est, now);
  if (m >= WAIT_MAX_MIN) return timeText(est, now, planned);
  if (m < 1) return 'imminent';
  return `${planned ? '~' : ''}${m}${NB}min`;
}

/** Destination affichée : STIB sans le « (P) » final des parkings de dissuasion (affichage seulement). */
export function headName(d: { op?: string; head?: Names }, lang: NameLang): string {
  const s = d.head ? displayName(d.head, lang) : '';
  return d.op === 'stib' ? s.replace(/\s*\(P\)$/i, '') : s;
}

/** « l’IC », « le S1 » : élision devant une voyelle. */
export function withArticle(label: string): string {
  return /^[aeiouyàâäéèêëîïôöûü]/i.test(label) ? `l’${label}` : `le ${label}`;
}

/** Espaces insécables d'un texte venu d'ailleurs (opérateur) : devant « : ; ! ? » et entre un nombre et « min ». */
export function frenchSpaces(text: string): string {
  return text.replace(/[ \u202f]+([:;!?])/g, `${NB}$1`).replace(/(\d) (min|h|s|m|km)\b/g, `$1${NB}$2`);
}

export const platformAlert = (label: string, platform: string) => `! Voie modifiée${NB}: ${withArticle(label)} part de la voie ${platform}`;
export const delayAlert = (label: string, time: string, min: number) => `! ${label} ${time}${NB}: +${min}${NB}min`;
export const cancelAlert = (label: string, time: string) => `! ${label} ${time} supprimé`;
export const leaveAlert = (walkMin: number) => `Partir maintenant${NB}: ${walkMin}${NB}min à pied`;
export const worksAlert = (text: string) => frenchSpaces(/^travaux\b/i.test(text.trim()) ? text.trim() : `Travaux : ${text.trim()}`);

/** « 12/11 » à partir de « 2026-11-12 ». */
export const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const FEMININE = new Set([
  'maison', 'gare', 'ecole', 'salle', 'piscine', 'fac', 'faculte', 'universite', 'creche', 'banque', 'poste', 'mairie',
  'clinique', 'boutique', 'plage', 'pharmacie', 'boulangerie', 'bibliotheque', 'cantine', 'residence', 'famille',
  'mosquee', 'eglise', 'synagogue', 'classe', 'reunion', 'formation', 'rue', 'place', 'avenue', 'ferme', 'campagne',
  'mer', 'montagne', 'ville', 'societe', 'boite', 'usine', 'agence', 'maternite', 'salle de sport', 'garderie', 'cite',
]);
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/**
 * 1.2 : noms communs d'un lieu (en plus de FEMININE), qui prennent l'article : « Bureau » → « Vers le bureau ».
 * Tout autre nom est gardé tel quel, comme un nom propre ou une adresse (« Vers Gand-Saint-Pierre », « Vers Namur »).
 */
const COMMON = new Set([
  'bureau', 'travail', 'boulot', 'job', 'taf', 'college', 'lycee', 'athenee', 'institut', 'stade', 'parc', 'jardin',
  'cinema', 'theatre', 'musee', 'hopital', 'restaurant', 'resto', 'magasin', 'supermarche', 'marche', 'club', 'local',
  'appartement', 'appart', 'studio', 'domicile', 'atelier', 'garage', 'depot', 'entrepot', 'campus', 'kot', 'gymnase',
  'centre', 'hotel', 'aeroport', 'chantier', 'siege', 'labo', 'laboratoire', 'cabinet', 'dentiste', 'medecin',
  'docteur', 'kine', 'sport', 'fitness', 'conservatoire', 'internat', 'zoo', 'ecole', 'unif', 'univ', 'bercail',
]);

/**
 * Début du titre d'une suggestion de trajet : « Pour le bureau », « Pour la maison », « Pour l’école »,
 * « Vers chez Karim », « Vers Gand-Saint-Pierre ».
 */
export function forLabel(label: string): string {
  const t = label.trim().replace(/\s+/g, ' ');
  if (!t) return 'Trajet';
  if (/^chez\s/i.test(t)) return `Vers ${t}`;
  if (/^(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|votre|nos|vos)\s/i.test(t) || /^l['’]/i.test(t)) return `Pour ${t}`;
  if (/^[A-ZÀ-Ý0-9]/.test(t)) return `Vers ${t}`;
  const first = fold(t.split(' ')[0]);
  if (/^[aeiouy]/.test(first) || /^h[aeiouy]/.test(first)) return `Pour l’${t}`;
  if (FEMININE.has(fold(t)) || FEMININE.has(first) || /(tion|sion|ette|ence|ance|erie|ure|elle|ie)$/.test(first)) return `Pour la ${t}`;
  return `Pour le ${t}`;
}

/**
 * 1.1 : début de la ligne d'un trajet favori et titre des étapes (PRD § 6.1 L1, L3), avec l'article de la 1.0 :
 * « Vers le bureau », « Vers la maison », « Vers l’école », « Vers chez Karim », « Vers Gand-Saint-Pierre »,
 * « Vers Veldstraat 1 ».
 */
export function vers(label: string): string {
  return forLabel(label).replace(/^Pour /, 'Vers ');
}

/**
 * 1.2 : nom d'un lieu prêt pour l'article de la 1.0 (forLabel, vers) : nom commun connu en minuscule
 * (« Bureau » → « bureau », « Salle de sport » → « salle de sport », « Le bureau » → « le bureau »,
 * « Chez Karim » → « chez Karim », « Ma mère » → « ma mère ») ; adresse (chiffre) et autre nom gardés tels quels
 * (« Veldstraat 1 », « Gand-Saint-Pierre », « La Louvière »).
 */
export function placeNoun(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ');
  if (!t || /\d/.test(t)) return t;
  const lower = t.charAt(0).toLowerCase() + t.slice(1);
  if (/^chez\s/i.test(t) || /^(mon|ma|mes|ton|ta|tes|son|sa|ses|notre|votre|nos|vos)\s/i.test(t)) return lower;
  const words = t.split(' ');
  // article en tête : nom commun seulement si le mot suivant en est un (« La Louvière » reste un nom propre)
  const head = /^(le|la|les)$/i.test(words[0]) ? (words[1] ?? '') : /^l['’]/i.test(words[0]) ? words[0].slice(2) : words[0];
  const common = COMMON.has(fold(head)) || FEMININE.has(fold(head)) || FEMININE.has(fold(t));
  return common ? lower : t;
}

/** 1.2 : titre d'un lieu, « Vers le bureau », « Vers l’école », « Vers Veldstraat 1 », « Vers Gand-Saint-Pierre ». */
export function placeTitle(name: string): string {
  return vers(placeNoun(name));
}

/** Adresse courte (avant la première virgule) : « Veldstraat 1, 9000 Gent » → « Veldstraat 1 ». */
export function shortAddress(label: string): string {
  const t = label.trim().replace(/\s+/g, ' ');
  const i = t.indexOf(',');
  return i > 0 ? t.slice(0, i).trim() : t;
}

/** Marque du dernier passage annoncé d'une ligne (STIB « Dernier passage »). */
export const LAST_MARK = ', dernier';

/**
 * « IC 07:42, voie 4 », « IC 07:42 +2, voie 6 », « IC 07:42 supprimé », « T3 12:14 », « T3 23:58, dernier », « IC demain
 * 07:42, voie 4 » ; bus de remplacement de la SNCB : « bus SNCB 07:44 », comme un bus.
 */
export function rideSummary(l: Leg, now?: number): string {
  const label = vehicleLabel(l);
  const time = atDay(l.schedDep, now);
  if (l.cancelled) return `${label} ${time} supprimé`;
  const delay = (l.delayMin ?? 0) > 0 ? ` +${l.delayMin}` : '';
  if (isTrain(l)) {
    const p = l.newPlatform ?? l.platform;
    return `${label} ${time}${delay}${p ? `, voie ${p}` : ''}`;
  }
  return `${label} ${atDay(l.dep, now)}${l.last ? LAST_MARK : ''}`;
}

/**
 * Départ en une ligne : « T3 Churchill 2 min », « 232 Vilvorde ~5 min », « T3 Churchill 4 min, dernier », « IC 12:22 +2,
 * voie 9 » ; bus de remplacement de la SNCB : « bus SNCB Landen 5 min ».
 */
export function departureSummary(d: Departure, now: number, lang: NameLang, markPlanned: boolean): string {
  const label = isSncbBus(d) ? SNCB_BUS_TEXT : lineLabel(d.mode, d.line);
  if (isTrain(d)) {
    if (d.cancelled) return `${label} ${atDay(d.sched, now)} supprimé`;
    const p = d.newPlatform ?? d.platform;
    return `${label} ${atDay(d.sched, now)}${d.delayMin > 0 ? ` +${d.delayMin}` : ''}${p ? `, voie ${p}` : ''}`;
  }
  const head = headName(d, lang);
  if (d.cancelled) return `${label} ${head} supprimé`;
  const last = d.last ? LAST_MARK : '';
  return `${label} ${head} ${waitText(d.est, now, !d.rt && markPlanned)}${last}`;
}
