/**
 * Mise en forme des textes des lunettes (français, ≤ 48 caractères par ligne). Fonctions pures.
 */
import type { Departure, Endpoint, Journey, Leg, NameLang, Settings } from '../core/api';
import { OP_NAME, displayName, hhmm, lineLabel, localDate, mainMode, minutesUntil } from '../core/util';
import type { AreaSummary, Mode, Names, Op } from '../../../shared/types';

export const NB = ' '; // espace insécable (typographie française devant « : »)

/** Aides de gestes, textes des maquettes (Visite1-3). */
export const HINTS = {
  home: `▲▼ choisir   toucher${NB}: ouvrir`,
  nearby: `▲▼ arrêt   toucher${NB}: départs`,
  board: `▲▼ départs   toucher${NB}: ★ favori   double${NB}: retour`,
  boardFav: `▲▼ départs   toucher${NB}: ★ retirer   double${NB}: retour`,
  favorites: `▲▼ choisir   toucher${NB}: ouvrir   double${NB}: retour`,
  trip: `▲▼ trains   toucher${NB}: détail   double${NB}: retour`,
  places: `▲▼ choisir   toucher${NB}: itinéraires   double${NB}: retour`,
  journeys: `▲▼ choisir   toucher${NB}: étapes   double${NB}: retour`,
  steps: `▲▼ étapes   double toucher${NB}: retour`,
  train: `▲▼ arrêts   double toucher${NB}: retour`,
  arrival: `toucher${NB}: ★ garder ce trajet   double${NB}: retour`,
  message: `double toucher${NB}: retour`,
  retry: `toucher${NB}: réessayer   double${NB}: retour`,
  firstRun: `toucher${NB}: continuer   double${NB}: quitter`,
  /** Quai Web : rien à quitter, l'onglet se ferme dans le navigateur. */
  firstRunWeb: `toucher${NB}: continuer`,
} as const;

export const NOTE_PLANNED = '~ horaire prévu, sans temps réel';
export const NOTE_NO_RT = `Pas de réseau${NB}: horaires prévus ~`;
/** Marque du dernier passage annoncé d'une ligne (STIB « Dernier passage »), en fin de colonne. */
export const LAST_MARK = ', dernier';

const MODE_WORD: Record<Mode, string> = { train: 'train', metro: 'métro', tram: 'tram', bus: 'bus' };
const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };

/**
 * Jour d'un horaire quand il n'est pas aujourd'hui (heure belge) : « demain », au-delà « le 13/11 » ; sinon ''.
 * Toute heure du lendemain est affichée avec ce mot (« demain 08:42 ») pour ne jamais la lire comme celle du jour.
 */
export function dayWord(ms: number, now: number): string {
  const d = localDate(ms);
  const today = localDate(now);
  if (d <= today) return '';
  const [y, m, dd] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
  return d === tomorrow ? 'demain' : `le ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** « demain, » devant un texte quand l'horaire est un autre jour (colonne large : jamais coupé en fin de texte). */
export function withDay(text: string, ms: number, now: number): string {
  const w = dayWord(ms, now);
  return w ? `${w}, ${text}` : text;
}

/** Destination affichée : STIB sans le « (P) » final des parkings de dissuasion (affichage seulement). */
export function headText(n: Names, lang: NameLang, op?: Op): string {
  const s = displayName(n, lang);
  return op === 'stib' ? s.replace(/\s*\(P\)$/i, '') : s;
}

/** « ~ » devant un horaire sans temps réel (si le réglage le demande). */
export function plannedMark(rt: boolean, markPlanned: boolean): string {
  return !rt && markPlanned ? '~' : '';
}

/** Attente d'un bus, tram ou métro : « 2 min », « ~4 min », « SUPPRIMÉ », au-delà d'une heure « ~13:45 ». */
export function minutesText(d: Pick<Departure, 'est' | 'rt' | 'cancelled'>, now: number, markPlanned: boolean): string {
  if (d.cancelled) return 'SUPPRIMÉ';
  const m = minutesUntil(d.est, now);
  const mark = plannedMark(d.rt, markPlanned);
  return m >= 60 ? `${mark}${hhmm(d.est)}` : `${mark}${m} min`;
}

/** Voie : « voie 9 », voie modifiée : « voie 6 ! ». Forme courte « v.9 » pour Autour de moi. */
export function platformText(platform: string | undefined, newPlatform: string | undefined, short = false): string {
  const p = newPlatform || platform;
  if (!p) return '';
  const base = short ? `v.${p}` : `voie ${p}`;
  return newPlatform ? `${base} !` : base;
}

/** Retard « +3 » (sans unité, à côté d'une heure). */
export function delaySuffix(delayMin: number | undefined): string {
  return delayMin && delayMin > 0 ? ` +${delayMin}` : '';
}

/** Colonne horaire d'un train sur un tableau : « 12:22  voie 9 », « ~12:30  voie 12 », « 18:04 +4  voie 11 », « 12:34  SUPPRIMÉ ». */
export function trainCell(d: Departure, markPlanned: boolean): string {
  const time = `${plannedMark(d.rt, markPlanned)}${hhmm(d.sched)}`;
  if (d.cancelled) return `${time}  SUPPRIMÉ`;
  const plat = platformText(d.platform, d.newPlatform);
  return `${time}${delaySuffix(d.delayMin)}${plat ? '  ' + plat : ''}`;
}

/** Prochain départ dans « Autour de moi » et les favoris : « T3 2 min », « 232 ~4 min », « IC 12:22 v.9 ». */
export function nextText(d: Departure | undefined, now: number, markPlanned: boolean): string {
  if (!d) return '';
  const line = lineLabel(d.mode, d.line);
  // un autre jour : forme courte « IC ~demain 08:42 », « 232 ~demain 06:12 » (la voie est sur le tableau)
  const t = d.mode === 'train' ? d.sched : d.est;
  const day = (d.mode === 'train' || minutesUntil(d.est, now) >= 60) && !d.cancelled ? dayWord(t, now) : '';
  if (day) return `${line} ${plannedMark(d.rt, markPlanned)}${day} ${hhmm(t)}`;
  if (d.mode === 'train') {
    if (d.cancelled) return `${line} ${hhmm(d.sched)} SUPPRIMÉ`;
    const plat = platformText(d.platform, d.newPlatform, true);
    return `${line} ${plannedMark(d.rt, markPlanned)}${hhmm(d.sched)}${delaySuffix(d.delayMin)}${plat ? ' ' + plat : ''}`;
  }
  return `${line} ${minutesText(d, now, markPlanned)}`;
}

/** Distance arrondie à 10 m : « 80 m », « 1,2 km ». */
export function distanceText(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 10) * 10} m`;
}

/** Durée : « 46 min », « 1 h 04 ». */
export function durationText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}${NB}h${NB}${String(m % 60).padStart(2, '0')}`;
}

export function transfersText(n: number): string {
  if (n <= 0) return 'direct';
  return n === 1 ? '1 changement' : `${n} changements`;
}

/** Nombre d'arrêts pour l'accueil : « 3 arrêts », « 1 arrêt », « aucun arrêt ». */
export function stopsCount(n: number | undefined): string {
  if (n === undefined) return '…';
  if (n === 0) return 'aucun arrêt';
  return n === 1 ? '1 arrêt' : `${n} arrêts`;
}

/** Nom court du véhicule d'un trajet : « IC », « T4 », « M2 », « 232 ». */
export function vehicleOf(leg: Pick<Leg, 'mode' | 'line' | 'cat'>): string {
  if (leg.mode === 'train' || (!leg.mode && leg.cat)) return leg.cat || leg.line || 'Train';
  return leg.mode && leg.line ? lineLabel(leg.mode, leg.line) : leg.line || '';
}

/** « Tram 1 », « Bus 232 », « Métro 2 » (écran d'arrivée). */
export function vehicleLong(mode: Mode, line: string): string {
  return `${MODE_TITLE[mode]} ${line}`;
}

/** Titre d'un tableau de départs : « Gare du Nord, tram (STIB) ». */
export function boardTitle(area: Pick<AreaSummary, 'n' | 'op' | 'modes'>, lang: NameLang): string {
  return `${displayName(area.n, lang)}, ${MODE_WORD[mainMode(area.modes)]} (${OP_NAME[area.op]})`;
}

const ARTICLES: Record<string, string> = {
  maison: 'la maison',
  bureau: 'le bureau',
  travail: 'le travail',
  boulot: 'le boulot',
  école: 'l’école',
  ecole: 'l’école',
  université: 'l’université',
  universite: 'l’université',
  gare: 'la gare',
  salle: 'la salle',
  crèche: 'la crèche',
  creche: 'la crèche',
  piscine: 'la piscine',
};

/** « le bureau », « la maison », sinon le libellé tel quel. */
export function withArticle(label: string): string {
  const k = label.trim().toLowerCase();
  return ARTICLES[k] ?? label.trim();
}

/** « Vers le bureau », « Vers Gand-Saint-Pierre ». */
export function towards(label: string): string {
  return `Vers ${withArticle(label)}`;
}

/** « au bureau », « à la maison », « à l’école », « à Gand ». */
export function atLabel(label: string): string {
  const w = withArticle(label);
  if (w.startsWith('le ')) return `au ${w.slice(3)}`;
  if (w.startsWith('les ')) return `aux ${w.slice(4)}`;
  return `à ${w}`;
}

/** Nom d'une extrémité de trajet pour les titres. */
export function endpointName(ep: Endpoint, settings: Settings, lang: NameLang): string {
  if (ep.type === 'here') return 'Ici';
  if (ep.type === 'area') return displayName(ep.name, lang);
  if (ep.type === 'address') return ep.label.split(',')[0];
  return settings.places.find((p) => p.id === ep.placeId)?.label ?? 'Lieu';
}

/** Durée totale d'un trajet en minutes (départ à pied compris). */
export function journeyMinutes(j: Journey): number {
  return Math.round((j.arr - j.dep) / 60_000);
}

/** Résumé d'un trajet : « à pied 3 min, IC voie 9, à pied 5 min ». */
export function legsSummary(j: Journey): string {
  return j.legs
    .map((l) => {
      if (l.kind === 'walk') return `à pied ${l.walkMin ?? Math.max(1, Math.round((l.arr - l.dep) / 60_000))} min`;
      const v = vehicleOf(l);
      const p = l.newPlatform || l.platform;
      return l.mode === 'train' && p ? `${v} voie ${p}` : v;
    })
    .join(', ');
}

export function namesOf(n: Names | undefined, lang: NameLang): string {
  return n ? displayName(n, lang) : '';
}
