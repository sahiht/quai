/**
 * Textes en français affichés dans les lunettes (≤ 48 caractères après fit()).
 * Jamais de tiret cadratin.
 */
import type { Mode, Names } from '../../../shared/types';
import type { Departure, Leg, NameLang } from './api';
import { displayName, hhmm, lineLabel, localDate, minutesUntil } from './util';

/** Libellé court d'un véhicule : catégorie du train (« IC ») ou ligne (« T3 », « M2 », « 232 »). */
export function vehicleLabel(x: { mode?: Mode; line?: string; cat?: string }): string {
  if (x.cat) return x.cat;
  return lineLabel(x.mode ?? 'bus', x.line ?? '');
}

/** Jour d'un horaire quand ce n'est pas aujourd'hui (heure belge) : « demain », au-delà « le 13/11 » ; sinon ''. */
export function dayWord(ms: number, now: number): string {
  const d = localDate(ms);
  const today = localDate(now);
  if (d <= today) return '';
  const [y, m, dd] = today.split('-').map(Number);
  return d === new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10) ? 'demain' : `le ${ddmm(d)}`;
}
const atDay = (ms: number, now: number | undefined) => {
  const w = now === undefined ? '' : dayWord(ms, now);
  return w ? `${w} ${hhmm(ms)}` : hhmm(ms);
};

/** Destination affichée : STIB sans le « (P) » final des parkings de dissuasion (affichage seulement). */
export function headName(d: { op?: string; head?: Names }, lang: NameLang): string {
  const s = d.head ? displayName(d.head, lang) : '';
  return d.op === 'stib' ? s.replace(/\s*\(P\)$/i, '') : s;
}

/** « l’IC », « le S1 » : élision devant une voyelle. */
export function withArticle(label: string): string {
  return /^[aeiouyàâäéèêëîïôöûü]/i.test(label) ? `l’${label}` : `le ${label}`;
}

export const platformAlert = (label: string, platform: string) => `! Voie modifiée : ${withArticle(label)} part de la voie ${platform}`;
export const delayAlert = (label: string, time: string, min: number) => `! ${label} ${time} : +${min} min`;
export const cancelAlert = (label: string, time: string) => `! ${label} ${time} supprimé`;
export const leaveAlert = (walkMin: number) => `Partir maintenant : ${walkMin} min à pied`;
export const worksAlert = (text: string) => (/^travaux\b/i.test(text.trim()) ? text.trim() : `Travaux : ${text.trim()}`);

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
 * Début du titre d'une suggestion de trajet : « Pour le bureau », « Pour la maison », « Pour l’école »,
 * « Vers chez Karim », « Vers Gand-Saint-Pierre ».
 */
export function forLabel(label: string): string {
  const t = label.trim().replace(/\s+/g, ' ');
  if (!t) return 'Trajet';
  if (/^chez\s/i.test(t)) return `Vers ${t}`;
  if (/^(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|votre|nos|vos)\s/i.test(t) || /^l['’]/i.test(t)) return `Pour ${t}`;
  if (/^[A-ZÀ-Ý]/.test(t)) return `Vers ${t}`;
  const first = fold(t.split(' ')[0]);
  if (/^[aeiouy]/.test(first) || /^h[aeiouy]/.test(first)) return `Pour l’${t}`;
  if (FEMININE.has(fold(t)) || FEMININE.has(first) || /(tion|sion|ette|ence|ance|erie|ure|elle|ie)$/.test(first)) return `Pour la ${t}`;
  return `Pour le ${t}`;
}

/** Marque du dernier passage annoncé d'une ligne (STIB « Dernier passage »). */
export const LAST_MARK = ', dernier';

/** « IC 07:42, voie 4 », « IC 07:42 +2, voie 6 », « IC 07:42 supprimé », « T3 12:14 », « T3 23:58, dernier », « IC demain 07:42, voie 4 ». */
export function rideSummary(l: Leg, now?: number): string {
  const label = vehicleLabel(l);
  const time = atDay(l.schedDep, now);
  if (l.cancelled) return `${label} ${time} supprimé`;
  const delay = (l.delayMin ?? 0) > 0 ? ` +${l.delayMin}` : '';
  if (l.mode === 'train') {
    const p = l.newPlatform ?? l.platform;
    return `${label} ${time}${delay}${p ? `, voie ${p}` : ''}`;
  }
  return `${label} ${atDay(l.dep, now)}${l.last ? LAST_MARK : ''}`;
}

/** Départ en une ligne : « T3 Churchill 2 min », « 232 Vilvorde ~5 min », « T3 Churchill 4 min, dernier », « IC 12:22 +2, voie 9 ». */
export function departureSummary(d: Departure, now: number, lang: NameLang, markPlanned: boolean): string {
  const label = lineLabel(d.mode, d.line);
  if (d.mode === 'train') {
    if (d.cancelled) return `${label} ${atDay(d.sched, now)} supprimé`;
    const p = d.newPlatform ?? d.platform;
    return `${label} ${atDay(d.sched, now)}${d.delayMin > 0 ? ` +${d.delayMin}` : ''}${p ? `, voie ${p}` : ''}`;
  }
  const head = headName(d, lang);
  if (d.cancelled) return `${label} ${head} supprimé`;
  const tilde = !d.rt && markPlanned ? '~' : '';
  const last = d.last ? LAST_MARK : '';
  const m = minutesUntil(d.est, now);
  if (m >= 60 && dayWord(d.est, now)) return `${label} ${head} ${tilde}${atDay(d.est, now)}${last}`;
  return `${label} ${head} ${tilde}${m} min${last}`;
}
