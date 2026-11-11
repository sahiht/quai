/**
 * Mise en forme des textes des lunettes (français). Fonctions pures.
 * 1.1 : textes exacts du PRD § 6.1 ; jours et attentes selon core/text.ts (« demain » jamais avant 04:00,
 * « imminent »), titres des trajets par vers() du cœur, comme sur le téléphone.
 */
import type { Departure, FavoriteAnswer, Journey, Leg, NameLang, Settings } from '../core/api';
import { NB as CORE_NB, dayWord as coreDayWord, timeText, vers } from '../core/text';
import { OP_NAME, displayName, hhmm, lineLabel, mainMode, minutesUntil } from '../core/util';
import type { AreaSummary, Mode, Names, Op } from '../../../shared/types';
import { textWidth, truncate } from './font';

/** Espace insécable : devant « : ; ! ? » et entre un nombre et son unité. */
export const NB = CORE_NB;

/** Aides de gestes (PRD § 6.1, liste S2). */
export const HINTS = {
  home: `▲▼ choisir   toucher${NB}: ouvrir   double${NB}: quitter`,
  /** Quai Web : rien à quitter, l'onglet se ferme dans le navigateur. */
  homeWeb: `▲▼ choisir   toucher${NB}: ouvrir`,
  nearby: `▲▼ arrêt   toucher${NB}: départs   double${NB}: retour`,
  board: `▲▼ départs   toucher${NB}: ★ favori   double${NB}: retour`,
  boardFav: `▲▼ départs   toucher${NB}: ★ retirer   double${NB}: retour`,
  favorites: `▲▼ choisir   toucher${NB}: ouvrir   double${NB}: retour`,
  places: `▲▼ choisir   toucher${NB}: trajet   double${NB}: retour`,
  /** Étapes du trajet suivi. */
  steps: `▲▼ autre trajet   toucher${NB}: détail   double${NB}: retour`,
  /** Étapes d'une autre proposition. */
  stepsOther: `▲▼ autre trajet   toucher${NB}: suivre ce trajet   double${NB}: retour`,
  /** Trajet entièrement à pied. */
  stepsWalk: `▲▼ autre trajet   double${NB}: retour`,
  train: `▲▼ arrêts   double${NB}: retour`,
  arrival: `toucher${NB}: ★ garder ce trajet   double${NB}: retour`,
  message: `double toucher${NB}: retour`,
  retry: `toucher${NB}: réessayer   double${NB}: retour`,
  /** Erreur à l'écran racine (lancement) : le double toucher quitte. */
  retryRoot: `toucher${NB}: réessayer   double${NB}: quitter`,
  retryWeb: `toucher${NB}: réessayer`,
  firstRun: `toucher${NB}: continuer   double${NB}: quitter`,
  /** Quai Web : rien à quitter, l'onglet se ferme dans le navigateur. */
  firstRunWeb: `toucher${NB}: continuer`,
  /** Message « Quai 1.1 ». */
  news: `toucher${NB}: continuer`,
  quit: `double toucher${NB}: quitter`,
} as const;

export const NOTE_PLANNED = '~ horaire prévu, sans temps réel';
/** Sources du temps réel (ou relais) en panne (M8.5). */
export const NOTE_RT_DOWN = `Temps réel indisponible${NB}: horaires prévus ~`;
/** Téléphone hors ligne. */
export const NOTE_OFFLINE = `Pas de réseau${NB}: horaires prévus ~`;
/** Marque du dernier passage annoncé d'une ligne (STIB « Dernier passage »), en fin de colonne. */
export const LAST_MARK = ', dernier';

const MODE_WORD: Record<Mode, string> = { train: 'train', metro: 'métro', tram: 'tram', bus: 'bus' };
const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };
const MODE_ORDER: Mode[] = ['train', 'metro', 'tram', 'bus'];

/**
 * Jour d'un horaire quand il n'est pas aujourd'hui (heure belge) : « demain » (à partir de 04:00 du lendemain,
 * S6), au-delà « le 13/11 » ; sinon ''. Même règle que le cœur et le téléphone.
 */
export function dayWord(ms: number, now: number): string {
  return coreDayWord(ms, now);
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

/** « 4 min » avec l'espace insécable. */
export const minText = (n: number): string => `${n}${NB}min`;

/**
 * Attente d'un bus, tram ou métro : « imminent » (moins d'une minute, S6), « 2 min », « ~4 min », « SUPPRIMÉ » ;
 * au-delà d'une heure, l'heure seule (« ~13:45 ») : le jour éventuel est dit ailleurs sur la ligne.
 */
export function minutesText(d: Pick<Departure, 'est' | 'rt' | 'cancelled'>, now: number, markPlanned: boolean): string {
  if (d.cancelled) return 'SUPPRIMÉ';
  const m = minutesUntil(d.est, now);
  const mark = plannedMark(d.rt, markPlanned);
  if (m >= 60) return `${mark}${hhmm(d.est)}`;
  if (m < 1) return 'imminent';
  return `${mark}${minText(m)}`;
}

/** Voie : « voie 9 », voie modifiée : « voie 6 ! ». Forme courte « v.9 » pour Autour de moi. */
export function platformText(platform: string | undefined, newPlatform: string | undefined, short = false): string {
  const p = newPlatform || platform;
  if (!p) return '';
  const base = short ? `v.${p}` : `voie ${p}`;
  return newPlatform ? `${base}${NB}!` : base;
}

/** Retard « +3 » (sans unité, à côté d'une heure : forme courte de la 1.0). */
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

/** Prochain départ dans « Autour de moi » et les arrêts favoris : « T3 2 min », « 232 ~4 min », « IC 12:22 v.9 », « T3 imminent ». */
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
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toFixed(1).replace('.', ',')}${NB}km`;
  return `${Math.round(m / 10) * 10}${NB}m`;
}

/** Durée : « 46 min », « 1 h 04 ». */
export function durationText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return minText(m);
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

/** Nom court du véhicule d'un trajet (1.0, étapes et « Dans le train ») : « IC », « T4 », « M2 », « 232 ». */
export function vehicleOf(leg: Pick<Leg, 'mode' | 'line' | 'cat'>): string {
  if (leg.mode === 'train' || (!leg.mode && leg.cat)) return leg.cat || leg.line || 'Train';
  return leg.mode && leg.line ? lineLabel(leg.mode, leg.line) : leg.line || '';
}

/** Véhicule dans une phrase (1.1, L1 et messages) : « IC », « S1 », « T4 », « M2 », « Bus 232 », « Bus W ». */
export function vehicleName(leg: Pick<Leg, 'mode' | 'line' | 'cat'>): string {
  if (leg.mode === 'bus' && leg.line) return `Bus ${leg.line}`;
  return vehicleOf(leg);
}

/** « Tram 1 », « Bus 232 », « Métro 2 » (écran d'arrivée). */
export function vehicleLong(mode: Mode, line: string): string {
  return `${MODE_TITLE[mode]} ${line}`;
}

/** Modes d'une zone (fusionnée ou non) : « tram », « tram et bus », « métro, tram et bus ». */
export function modesText(modes: Mode[]): string {
  const list = MODE_ORDER.filter((m) => modes.includes(m)).map((m) => MODE_WORD[m]);
  if (!list.length) return MODE_WORD[mainMode(modes)];
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
}

/** Titre d'un tableau de départs : « Gare du Nord, tram et bus (STIB) » (M8.3). */
export function boardTitle(area: Pick<AreaSummary, 'n' | 'op' | 'modes'>, lang: NameLang): string {
  return `${displayName(area.n, lang)}, ${modesText(area.modes)} (${OP_NAME[area.op]})`;
}

/* ------------------------------ Destinations ------------------------------ */

/** « Vers le bureau », « Vers la maison », « Vers Gand-Saint-Pierre », « Vers Veldstraat 1 » (vers() du cœur). */
export function towards(label: string): string {
  return vers(label);
}

/** « au bureau », « à la maison », « à l’école », « chez Karim », « à Gand-Saint-Pierre », d'après « Vers … ». */
export function atTitle(title: string): string {
  const t = title.trim();
  const m = /^Vers\s+(.*)$/i.exec(t);
  const rest = m ? m[1] : t;
  if (/^le\s/i.test(rest)) return `au ${rest.slice(3)}`;
  if (/^les\s/i.test(rest)) return `aux ${rest.slice(4)}`;
  if (/^chez\s/i.test(rest)) return rest;
  return `à ${rest}`;
}

/** « au bureau », « à la maison », « à l’école », « à Gand ». */
export function atLabel(label: string): string {
  return atTitle(towards(label));
}

/** « vers le bureau » : le titre en minuscule initiale, dans une phrase (« En cours : vers le bureau »). */
export function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

/* ------------------------------ Trajets ------------------------------ */

const isRide = (l: Leg): boolean => l.kind === 'ride';

/** Première étape en véhicule. */
export function firstRide(j: Journey): Leg | undefined {
  return j.legs.find(isRide);
}

/** Durée de marche d'une étape à pied, en minutes (au moins 1). */
export function walkMinOf(l: Leg): number {
  return l.walkMin ?? Math.max(1, Math.round((l.arr - l.dep) / 60_000));
}

/** Durée totale d'un trajet en minutes (départ à pied compris). */
export function journeyMinutes(j: Journey): number {
  return Math.max(1, Math.round((j.arr - j.dep) / 60_000));
}

/**
 * Début affiché d'un trajet (titre des étapes, ligne du bas) : heure de départ à pied s'il commence par une marche,
 * sinon heure estimée du premier véhicule ; trajet à pied : son départ (PRD M2.2).
 */
export function journeyStart(j: Journey, leave = j.leaveAt): number {
  const ride = firstRide(j);
  if (!ride) return j.dep;
  return j.legs[0]?.kind === 'walk' ? leave : ride.dep;
}

/** « 07:35 → 09:00 », « demain 06:20 → 06:46 ». */
export function spanText(start: number, arr: number, now: number): string {
  const day = dayWord(start, now);
  return `${day ? day + ' ' : ''}${hhmm(start)} → ${hhmm(arr)}`;
}

/**
 * Trajet encore attrapable : on peut encore partir à pied à temps pour le premier véhicule (réponse d'un favori
 * calculée il y a un moment). Un trajet à pied l'est toujours.
 */
export function catchable(j: Journey, now: number): boolean {
  const k = j.legs.findIndex(isRide);
  if (k < 0) return true;
  const walk = j.legs.slice(0, k).reduce((s, l) => s + (l.kind === 'walk' ? walkMinOf(l) : 0), 0);
  return now <= j.legs[k].dep - walk * 60_000 + 30_000;
}

/**
 * Quand partir (L1) : « partir dans 4 min » (1 à 15 min), « partir maintenant », « partir à 07:52 »,
 * « partir demain 06:20 ».
 */
export function leaveText(leave: number, now: number): string {
  const day = dayWord(leave, now);
  if (day) return `partir ${day} ${hhmm(leave)}`;
  const m = minutesUntil(leave, now);
  if (m < 1) return 'partir maintenant';
  if (m <= 15) return `partir dans ${minText(m)}`;
  return `partir à ${hhmm(leave)}`;
}

/** Ce qu'affiche un favori : texte de droite, 2e ligne, « ~ » montré, deux lignes réservées. */
export interface FavoriteLine {
  right: string;
  second?: string;
  planned: boolean;
  /** 2e ligne réservée (réponse en calcul). */
  two?: boolean;
  /** Fin du texte de droite, ajoutée si elle tient (« , dernier »). */
  tail?: string;
}

/** Largeur d'une ligne entière des lunettes (PRD § 6.0). */
export const FULL_PX = 542;

/**
 * 2e ligne d'un trajet favori (L1) : « IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00 ». Trop longue :
 * sans « direct, », puis « v. » au lieu de « voie », puis coupée avec « … » (PRD § 6.0).
 */
export function tripSecondLine(j: Journey, _now: number, markPlanned: boolean, maxPx = FULL_PX): { text: string; planned: boolean } {
  const r = firstRide(j);
  if (!r) return { text: `à pied, arrivée ${hhmm(j.arr)}`, planned: false };
  const planned = !r.rt && markPlanned;
  const time = `${planned ? '~' : ''}${hhmm(r.schedDep)}`;
  const state = r.cancelled ? ' SUPPRIMÉ' : (r.delayMin ?? 0) > 0 ? ` (+${minText(r.delayMin ?? 0)})` : '';
  const build = (direct: boolean, short: boolean): string => {
    const plat = r.mode === 'train' ? platformText(r.platform, r.newPlatform, short) : '';
    const changes = j.transfers > 0 || direct ? `, ${transfersText(j.transfers)}` : '';
    return `${vehicleName(r)} à ${time}${state}${plat ? ', ' + plat : ''}${changes}, arrivée ${hhmm(j.arr)}`;
  };
  for (const [direct, short] of [[true, false], [false, false], [false, true]] as const) {
    const t = build(direct, short);
    if (textWidth(t) <= maxPx) return { text: t, planned };
  }
  return { text: truncate(build(false, true), maxPx), planned };
}

/** Réponse d'un trajet favori (L1) : « partir dans 4 min » et sa 2e ligne, ou l'état (« tu y es », « … »). */
export function tripAnswerLine(a: FavoriteAnswer | undefined, now: number, settings: Settings): FavoriteLine {
  if (!a) return { right: '…', planned: false, two: true };
  if (a.state === 'here') return { right: 'tu y es', planned: false };
  if (a.state === 'noPosition') return { right: 'sans position', planned: false };
  const j = a.plan?.journeys[0];
  if (a.state !== 'ok' || !j) return { right: 'aucun trajet', planned: false };
  const mp = settings.display.markPlanned;
  const r = firstRide(j);
  if (!r) return { right: `à pied ${minText(journeyMinutes(j))}`, second: `à pied, arrivée ${hhmm(Math.max(j.dep, now) + (j.arr - j.dep))}`, planned: false };
  if (!catchable(j, now)) return { right: '…', planned: false, two: true };
  if (a.fromStation) {
    // Gare de départ hors de portée à pied : l'heure du train (« départ 14:10 »).
    const planned = !r.rt && mp;
    const delay = !r.cancelled && (r.delayMin ?? 0) > 0 ? ` (+${minText(r.delayMin ?? 0)})` : '';
    const plat = r.mode === 'train' ? platformText(r.platform, r.newPlatform) : '';
    const station = displayName(r.from.name, settings.lang);
    let second = `${vehicleName(r)}${plat ? ' ' + plat : ''} à ${station}, arrivée ${hhmm(j.arr)}`;
    if (textWidth(second) > FULL_PX) second = truncate(second, FULL_PX);
    return { right: `départ ${timeText(r.schedDep, now, planned)}${delay}`, second, planned };
  }
  const line2 = tripSecondLine(j, now, mp);
  return { right: leaveText(j.leaveAt, now), second: line2.text, planned: line2.planned };
}

/** Départs encore à venir d'un tableau déjà chargé (une réponse peut avoir 30 s). */
export function upcoming(deps: readonly Departure[], now: number): Departure[] {
  return deps.filter((d) => d.est >= now - 30_000);
}

/**
 * Réponse d'un arrêt favori (L1) : prochain départ au format 1.0 (« T3 2 min ») et 2e ligne « vers Churchill,
 * puis T4 Stalle 5 min » (bus, tram, métro) ou « vers Bruxelles-Midi, puis ~08:42 » (train).
 */
export function stopAnswerLine(a: FavoriteAnswer | undefined, now: number, settings: Settings): FavoriteLine {
  if (!a) return { right: '…', planned: false, two: true };
  if (a.state === 'missing') return { right: '', second: `introuvable${NB}: modifie-le sur le téléphone`, planned: false };
  const mp = settings.display.markPlanned;
  const lang = settings.lang;
  const deps = upcoming(a.board?.departures ?? [], now);
  const [d1, d2] = deps;
  if (!d1) return { right: '', second: 'aucun départ dans les prochaines heures', planned: false };
  let planned = !d1.rt && !d1.cancelled && mp;
  let second = `vers ${headText(d1.head, lang, d1.op)}`;
  if (d2) {
    if (!d2.rt && !d2.cancelled && mp) planned = true;
    if (d2.mode === 'train') {
      const t = d2.cancelled ? `${hhmm(d2.sched)} SUPPRIMÉ` : `${timeText(d2.sched, now, !d2.rt && mp)}${delaySuffix(d2.delayMin)}`;
      second += `, puis ${t}`;
    } else {
      second += `, puis ${lineLabel(d2.mode, d2.line)} ${headText(d2.head, lang, d2.op)} ${minutesText(d2, now, mp)}`;
    }
  }
  const out: FavoriteLine = { right: nextText(d1, now, mp), second: textWidth(second) > FULL_PX ? truncate(second, FULL_PX) : second, planned };
  if (d1.last && !d1.cancelled) out.tail = LAST_MARK;
  return out;
}

/**
 * Étape suivante d'un trajet en cours (ligne « En cours » de l'accueil) : « IC 07:44, voie 6 » avant de monter,
 * « descente 08:48 » dans le véhicule, « arrivée 09:00 » ensuite.
 */
export function runningNext(j: Journey, now: number): string {
  for (const l of j.legs) {
    if (l.kind !== 'ride' || l.arr <= now) continue;
    if (l.cancelled) return `${vehicleName(l)} ${hhmm(l.schedDep)} SUPPRIMÉ`;
    if (now < l.dep) {
      const p = l.mode === 'train' ? l.newPlatform || l.platform : undefined;
      return `${vehicleName(l)} ${hhmm(l.dep)}${p ? `, voie ${p}` : ''}`;
    }
    return `descente ${hhmm(l.arr)}`;
  }
  return `arrivée ${hhmm(j.arr)}`;
}

/** Véhicule et heure d'un trajet pour les messages : « IC 08:42 », « Bus 232 07:58 », « IC demain 06:20 ». */
export function tripShort(j: Journey, now: number): string {
  const r = firstRide(j);
  if (!r) return `à pied, ${minText(journeyMinutes(j))}`;
  return `${vehicleName(r)} ${timeText(r.schedDep, now)}`;
}

/** Message du téléphone : « Affiché dans les lunettes : IC 14:22, voie 6. » (M2.9). */
export function shownMessage(j: Journey | undefined, now: number): string {
  if (!j) return 'Affiché dans les lunettes.';
  const r = firstRide(j);
  if (!r) return `Affiché dans les lunettes${NB}: à pied, ${minText(journeyMinutes(j))}.`;
  const p = r.mode === 'train' ? r.newPlatform || r.platform : undefined;
  return `Affiché dans les lunettes${NB}: ${tripShort(j, now)}${p ? `, voie ${p}` : ''}.`;
}
