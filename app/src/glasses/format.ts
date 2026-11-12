/**
 * Mise en forme des textes des lunettes (français). Fonctions pures.
 * 1.1 : textes exacts du PRD § 6.1 ; jours et attentes selon core/text.ts (« demain » jamais avant 04:00,
 * « imminent »), titres des trajets par vers() du cœur, comme sur le téléphone.
 */
import type { Departure, FavoriteAnswer, Journey, Leg, LineDeparture, NameLang, PlanResult, Settings, StopCall } from '../core/api';
import { meansText, rideName } from '../core/means';
import { NB as CORE_NB, dayWord as coreDayWord, timeText, vers } from '../core/text';
import { OP_NAME, displayName, hhmm, lineLabel, mainMode, minutesUntil } from '../core/util';
import type { AreaSummary, Mode, Names, Op } from '../../../shared/types';
import { textWidth, truncate } from './font';

/** Espace insécable : devant « : ; ! ? » et entre un nombre et son unité. */
export const NB = CORE_NB;

/** Aides de gestes (PRD § 6.1, liste S2). 1.2.4 (PRD-1.2.4 § 4) : triangles vides « △▽ », plus discrets que le contenu. */
export const HINTS = {
  home: `△▽ choisir   toucher${NB}: ouvrir   double${NB}: quitter`,
  /** Quai Web : rien à quitter, l'onglet se ferme dans le navigateur. */
  homeWeb: `△▽ choisir   toucher${NB}: ouvrir`,
  nearby: `△▽ arrêt   toucher${NB}: départs   double${NB}: retour`,
  /**
   * 1.2.3 (PRD-1.2.3 § 1) : tableau complet d'une gare ou d'un arrêt, curseur de départ en départ ; toucher un départ :
   * ses arrêts (la ligne ★ en tête garde ou retire la gare, ou ouvre « garder une ligne »).
   */
  board: `△▽ départs   toucher${NB}: arrêts   double${NB}: retour`,
  /** 1.2.3 (§ 2) : les arrêts d'un départ ; toucher un arrêt : son tableau. */
  stops: `△▽ arrêts   toucher${NB}: départs   double${NB}: retour`,
  /** 1.2.2 : « {arrêt} : garder une ligne ». */
  keepLine: `△▽ choisir   toucher${NB}: ★ garder ou retirer   double${NB}: retour`,
  favorites: `△▽ choisir   toucher${NB}: ouvrir   double${NB}: retour`,
  /** 1.2.2 : « Gares » (PRD-1.2.2 § 2). */
  stations: `△▽ choisir   toucher${NB}: départs   double${NB}: retour`,
  /** 1.2.2 : « Bus, tram, métro » (§ 3) : détail d'une ligne, ou départs d'un arrêt « toutes les lignes ». */
  lines: `△▽ choisir   toucher${NB}: ouvrir   double${NB}: retour`,
  /** 1.2.2 : détail d'une ligne à son arrêt ; 1.2.3 : toucher un passage, ses arrêts (« Tous les départs » : le tableau). */
  line: `△▽ passages   toucher${NB}: arrêts   double${NB}: retour`,
  /** Étapes du trajet suivi (1.2.1 : ▲▼ font défiler les étapes ; 1.2.2 : toucher propose « Ne plus suivre »). */
  steps: `△▽ étapes   toucher${NB}: ne plus suivre   double${NB}: retour`,
  /** Étapes d'une autre proposition, ou d'un trajet ouvert et pas encore suivi (1.2.2). */
  stepsOther: `△▽ étapes   toucher${NB}: suivre ce trajet   double${NB}: retour`,
  /** Trajet entièrement à pied. */
  stepsWalk: `△▽ étapes   double${NB}: retour`,
  /** 1.2.2 : « Ne plus suivre » et le détail du véhicule. */
  followed: `△▽ choisir   toucher${NB}: valider   double${NB}: retour`,
  /** 1.2.1 : « Autres trajets ». */
  others: `△▽ choisir   toucher${NB}: voir   double${NB}: retour`,
  train: `△▽ arrêts   double${NB}: retour`,
  arrival: `toucher${NB}: ★ garder ce trajet   double${NB}: retour`,
  /** 1.2.2 (REVUE-USAGE n° 10) : « Autour de moi » vide, l'arrêt le plus proche. */
  nearest: `toucher${NB}: ses départs   double${NB}: retour`,
  message: `double toucher${NB}: retour`,
  retry: `toucher${NB}: réessayer   double${NB}: retour`,
  /** Erreur à l'écran racine (lancement) : le double toucher quitte. */
  retryRoot: `toucher${NB}: réessayer   double${NB}: quitter`,
  retryWeb: `toucher${NB}: réessayer`,
  firstRun: `toucher${NB}: continuer   double${NB}: quitter`,
  /** Quai Web : rien à quitter, l'onglet se ferme dans le navigateur. */
  firstRunWeb: `toucher${NB}: continuer`,
  /** Message « Quai 1.2.4 ». */
  news: `toucher${NB}: continuer`,
  quit: `double toucher${NB}: quitter`,
} as const;

/**
 * 1.2.2 : textes des rubriques « Gares » et « Bus, tram, métro » (PRD-1.2.2 § 1.1 à § 3, REVUE-USAGE n° 6), en un seul
 * endroit pour les ajuster.
 */
export const SECTION = {
  stations: 'Gares',
  lines: 'Bus, tram, métro',
  /** Rubrique vide, à droite sur l'accueil. */
  empty: 'à choisir',
  /** Toucher sur une rubrique vide (appli Even ; Quai Web ouvre la section de l'onglet Réglages). */
  chooseStations: 'Choisis tes gares dans Quai, sur le téléphone',
  chooseLines: 'Choisis tes lignes dans Quai, sur le téléphone',
  chooseStationsWeb: 'Choisis tes gares dans l’onglet Réglages',
  chooseLinesWeb: 'Choisis tes lignes dans l’onglet Réglages',
  /** Accueil, « Gares » : rien dans l'horizon des tableaux pour la gare la plus proche. */
  noDeparture: 'aucun départ',
  /** « Gares » : gare sans train dans l'horizon des tableaux (§ 2). */
  noTrain: 'aucun train',
  /**
   * Un sens sans passage ; accueil, « Bus, tram, métro » : la ligne la plus proche sans passage, même aucun les jours
   * publiés (lineBoard `none` : week-end, jour férié), jamais « introuvable ».
   */
  noPassage: 'aucun passage',
  /** Une ligne sans aucun passage (« Bus, tram, métro », détail d'une ligne). */
  noPassageAll: 'aucun passage dans les prochaines heures',
  /** Arrêt d'une ligne choisie introuvable dans les données (§ 3, lineBoard `missing`) ; Quai Web : dans l'onglet Réglages. */
  missing: `introuvable${NB}: modifie-la sur le téléphone`,
  missingWeb: `introuvable${NB}: modifie-la dans Réglages`,
  /** 1.2.4 : sous « ARRÊTS », un arrêt (toutes ses lignes) introuvable. */
  missingStop: `introuvable${NB}: modifie-le sur le téléphone`,
  missingStopWeb: `introuvable${NB}: modifie-le dans Réglages`,
  /** Accueil, « Gares » : gare ou arrêt introuvable dans les données du jour (zone ni retrouvée ni déplacée). */
  missingStation: 'introuvable',
  /** Arrêt sans filtre (arrêt favori de la 1.2.1 migré) : « Gare du Nord · toutes les lignes ». */
  allLines: 'toutes les lignes',
  /** 1.2.4 (PRD-1.2.4 § 2) : intitulés pâles des deux blocs de « Bus, tram, métro », jamais sous le curseur. */
  stopsHead: 'ARRÊTS',
  linesHead: 'LIGNES',
  /** Dernière ligne du détail d'une ligne : le tableau de l'arrêt. */
  allDepartures: 'Tous les départs de l’arrêt',
} as const;

/** 1.2.3 : textes du tableau complet et des arrêts d'un départ (PRD-1.2.3 § 1, § 2). */
export const BOARD = {
  /** Ligne ★ en tête du tableau d'une gare SNCB (toucher : comme le toucher de la 1.2.2). */
  keepStation: '★ garder la gare',
  dropStation: '★ retirer la gare',
  /** Ligne ★ en tête du tableau d'un arrêt de bus, tram ou métro : « {arrêt} : garder une ligne ». */
  keepLine: '★ garder une ligne',
  /** Aucun départ dans les 2 heures, ni plus tard dans l'horizon des tableaux. */
  none: 'aucun départ',
  /** Arrêts d'un départ : voyage disparu des données. */
  vanished: 'Ce départ n’est plus dans les horaires.',
  /** Tableau complet : tous les départs des 2 prochaines heures, 40 au plus. */
  horizonMin: 120,
  limit: 40,
} as const;

/**
 * 1.2.3 (§ 2) : heure d'un arrêt d'un départ, comme sur les tableaux des gares : l'heure prévue, « ~ » sans temps réel,
 * le retard (« 08:44 +3 ») ; un arrêt supprimé garde son heure prévue, sans « ~ ».
 */
export function stopTimeText(c: Pick<StopCall, 'sched' | 'rt' | 'delayMin' | 'cancelled'>, markPlanned: boolean): string {
  const p = stopTimeParts(c, markPlanned);
  return p.lead + p.rest;
}

/**
 * 1.2.4 (PRD-1.2.4 § 4) : une heure en deux parties, pour l'aligner dans sa case (Item.aLead, bLead, cLead) : l'heure
 * (« ~ » compris) et ce qui la suit (retard, voie), ses espaces de tête compris.
 */
export interface TimeParts {
  lead: string;
  rest: string;
}

/** 1.2.4 : stopTimeText en deux parties (« ~08:44 », « +3 »). */
export function stopTimeParts(c: Pick<StopCall, 'sched' | 'rt' | 'delayMin' | 'cancelled'>, markPlanned: boolean): TimeParts {
  if (c.cancelled) return { lead: hhmm(c.sched), rest: '' };
  return { lead: `${plannedMark(c.rt, markPlanned)}${hhmm(c.sched)}`, rest: delaySuffix(c.delayMin) };
}

/** 1.2.3 (§ 2) : à droite d'un arrêt d'un départ : « SUPPRIMÉ », sinon la voie (« voie 9 », modifiée : « voie 6 ! »). */
export function stopRightText(c: Pick<StopCall, 'platform' | 'newPlatform' | 'cancelled'>): string {
  return c.cancelled ? 'SUPPRIMÉ' : platformText(c.platform, c.newPlatform);
}

/**
 * 1.2.2 : passage qui s'arrête avant le terminus de son sens (PRD-1.2.2 § 3) : marqué « * » dans « Bus, tram, métro »,
 * expliqué dans la ligne du bas ; son terminus est écrit dans le détail.
 */
export const PARTIAL_MARK = '*';
export const NOTE_PARTIAL = `${PARTIAL_MARK} s’arrête avant le terminus`;
export const untilText = (head: string): string => `jusqu’à ${head}`;

export const NOTE_PLANNED = '~ horaire prévu, sans temps réel';
/** Sources du temps réel (ou relais) en panne (M8.5). */
export const NOTE_RT_DOWN = `Temps réel indisponible${NB}: horaires prévus ~`;
/** Téléphone hors ligne. */
export const NOTE_OFFLINE = `Pas de réseau${NB}: horaires prévus ~`;
/** 1.2.1 : mêmes états sur l'accueil, sans « ~ » (l'accueil n'en affiche plus, PRD-1.2.1 § 4.5). */
export const HOME_RT_DOWN = `Temps réel indisponible${NB}: horaires prévus`;
export const HOME_OFFLINE = `Pas de réseau${NB}: horaires prévus`;
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
  const p = trainCellParts(d, markPlanned);
  return p.lead + p.rest;
}

/** 1.2.4 : trainCell en deux parties : l'heure (« ~12:30 ») et la suite (« +4  voie 11 », «   SUPPRIMÉ »). */
export function trainCellParts(d: Departure, markPlanned: boolean): TimeParts {
  // Une suppression est une information du temps réel (gardée 15 min pendant une panne, M8.5) : jamais de « ~ »,
  // qui coupait la colonne (« ~12:34  SUPPRI… »).
  if (d.cancelled) return { lead: hhmm(d.sched), rest: '  SUPPRIMÉ' };
  const plat = platformText(d.platform, d.newPlatform);
  return { lead: `${plannedMark(d.rt, markPlanned)}${hhmm(d.sched)}`, rest: `${delaySuffix(d.delayMin)}${plat ? '  ' + plat : ''}` };
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

/**
 * 1.2.2 : bus de remplacement de la SNCB (op 'sncb', mode 'bus', ligne « BUS ») : « Bus SNCB » dans les phrases, les
 * étapes, « Dans le train » et « En cours », jamais « BUS » seul (les colonnes étroites des départs gardent « BUS »).
 */
const SNCB_BUS = 'Bus SNCB';
const isSncbBus = (leg: Partial<Pick<Leg, 'op' | 'mode'>>): boolean => leg.op === 'sncb' && leg.mode === 'bus';

/** Véhicule dans une phrase (1.1, L1 et messages) : « IC », « S1 », « T4 », « M2 », « Bus 232 », « Bus W ». */
export function vehicleName(leg: Pick<Leg, 'mode' | 'line' | 'cat'> & Partial<Pick<Leg, 'op'>>): string {
  if (isSncbBus(leg)) return SNCB_BUS;
  if (leg.mode === 'bus' && leg.line) return `Bus ${leg.line}`;
  return vehicleOf(leg);
}

/** Première lettre en majuscule (début de ligne). */
export const upperFirst = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * 1.2.2 (REVUE-USAGE n° 8) : un véhicule en toutes lettres, en minuscules dans une liste ou au milieu d'une phrase :
 * « bus W », « tram 3 », « métro 2 », « IC » (rideName du cœur, celui des moyens « bus W + IC ») ; bus de remplacement
 * de la SNCB : « bus SNCB » tant que rideName dit « BUS ».
 */
export function rideWords(leg: Pick<Leg, 'op' | 'mode' | 'line' | 'cat'>): string {
  const w = rideName(leg);
  return isSncbBus(leg) && /^bus$/i.test(w) ? 'bus SNCB' : w;
}

/** 1.2.2 (n° 8) : le même en tête de ligne d'étape ou de titre : « Bus W », « Tram 3 », « Métro 2 », « IC », « Bus SNCB ». */
export function vehicleWords(leg: Pick<Leg, 'op' | 'mode' | 'line' | 'cat'>): string {
  return upperFirst(rideWords(leg));
}

/**
 * 1.2.2 (n° 8) : code court d'un véhicule dans une colonne étroite (« En cours ») : « IC », « S1 », « T3 », « M2 »,
 * « W » ; bus de remplacement de la SNCB : « Bus SNCB ».
 */
export function lineCode(leg: Pick<Leg, 'op' | 'mode' | 'line' | 'cat'>): string {
  if (isSncbBus(leg)) return SNCB_BUS;
  if (leg.op === 'sncb' || leg.mode === 'train') return leg.cat || leg.line || 'Train';
  return leg.line ? lineLabel(leg.mode ?? 'bus', leg.line) : rideName(leg);
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

/** Colonne de droite des menus (PRD § 6.0). */
export const MENU_RIGHT_PX = 190;

/**
 * « départ 14:10 », « départ demain ~06:15 (+3 min) » (gare de départ hors de portée à pied). Trop long pour la colonne
 * de droite : sans « ~ », puis sans le retard, avant de couper (comme la 2e ligne).
 */
export function departText(ms: number, now: number, planned: boolean, delay: string, maxPx = MENU_RIGHT_PX): string {
  const tries = [`départ ${timeText(ms, now, planned)}${delay}`, `départ ${timeText(ms, now)}${delay}`, `départ ${timeText(ms, now)}`];
  return tries.find((t) => textWidth(t) <= maxPx) ?? truncate(tries[tries.length - 1], maxPx);
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
    const right = departText(r.schedDep, now, planned, delay);
    return { right, second, planned: planned && right.includes('~') };
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

/* ------------------------------ Accueil 1.2.1 : une ligne par favori ------------------------------ */

/** Colonne de droite de l'accueil 1.2.1 (WIDTHS.wideRight). */
export const HOME_RIGHT_PX = 210;

/**
 * Départ conseillé puis arrivée (accueil 1.2.1, PRD-1.2.1 § 4.3), jamais de « ~ » : « maintenant → 21:34 »,
 * « dans 4 min → 21:34 » (1 à 15 min), « 22:10 → 23:05 », « demain 06:20 → 06:46 ». `clock` : l'heure même tout
 * près (départ d'un train qu'on rejoint par ses propres moyens).
 */
export function leaveArrive(leave: number, arr: number, now: number, clock = false): string {
  const day = dayWord(leave, now);
  const m = minutesUntil(leave, now);
  const start = day ? `${day} ${hhmm(leave)}` : clock ? hhmm(leave) : m < 1 ? 'maintenant' : m <= 15 ? `dans ${minText(m)}` : hhmm(leave);
  return `${start} → ${hhmm(arr)}`;
}

/**
 * Réponse d'un lieu ou d'un trajet favori sur une ligne (accueil 1.2.1, § 4.3) : départ conseillé et arrivée ; le
 * détail (véhicule, voie, changements) est sur la page du trajet. États : « … » (en calcul), « tu y es », « sans
 * position », « aucun trajet ».
 */
export function tripHomeText(a: FavoriteAnswer | undefined, now: number): string {
  if (!a) return '…';
  if (a.state === 'here') return 'tu y es';
  if (a.state === 'noPosition') return 'sans position';
  const j = a.plan?.journeys[0];
  if (a.state !== 'ok' || !j) return 'aucun trajet';
  const r = firstRide(j);
  if (!r) {
    // À pied : on part quand on veut.
    const leave = Math.max(j.dep, now);
    return leaveArrive(leave, leave + (j.arr - j.dep), now);
  }
  if (!catchable(j, now)) return '…';
  // Gare de départ hors de portée à pied : l'heure du train.
  if (a.fromStation) return leaveArrive(r.dep, j.arr, now, true);
  return leaveArrive(j.leaveAt, j.arr, now);
}

/**
 * Prochain départ dans une colonne de droite de 210 px (1.2.1 : arrêt favori de l'accueil, § 4.3 ; 1.2.2 : « Gares »
 * et « Bus, tram, métro » de l'accueil et lignes de « Gares », REVUE-USAGE n° 6) : « IC 21:08 voie 2 » (forme courte
 * « v.2 » si la colonne est trop étroite), « T3 2 min », « W 08:45 », « IC demain 06:20 » ; « , dernier » ajouté s'il
 * tient. Sur l'accueil, jamais de « ~ » (`markPlanned` faux) ; ailleurs, comme « Autour de moi ».
 */
export function departureRightText(d: Departure, now: number, markPlanned = false, maxPx = HOME_RIGHT_PX): { text: string; tail?: string } {
  let text = nextText(d, now, markPlanned);
  if (d.mode === 'train' && !d.cancelled && !dayWord(d.sched, now)) {
    const plat = platformText(d.platform, d.newPlatform);
    const long = `${d.line} ${plannedMark(d.rt, markPlanned)}${hhmm(d.sched)}${delaySuffix(d.delayMin)}${plat ? ' ' + plat : ''}`;
    if (textWidth(long) <= maxPx) text = long;
  }
  return d.last && !d.cancelled ? { text, tail: LAST_MARK } : { text };
}

/** Prochain départ d'un arrêt favori sur l'accueil (1.2.1, § 4.3), sans « ~ » (departureRightText). */
export function stopHomeText(a: FavoriteAnswer | undefined, now: number): { text: string; tail?: string } {
  if (!a) return { text: '…' };
  if (a.state === 'missing') return { text: 'introuvable' };
  const d = upcoming(a.board?.departures ?? [], now)[0];
  if (!d) return { text: 'aucun départ' };
  return departureRightText(d, now);
}

/**
 * 1.2.2 : réponse d'une adresse récente de « Favoris » au format de l'accueil (REVUE-USAGE n° 2) : « 07:40 → 08:51 »,
 * « tu y es », « aucun trajet », « … » (en calcul ou sans position).
 */
export function planHomeText(result: PlanResult | null | undefined, now: number): string {
  if (!result) return '…';
  if (result.empty === 'here') return 'tu y es';
  if (result.empty === 'noPosition') return 'sans position';
  return tripHomeText({ favoriteId: '', kind: 'trip', state: result.journeys.length ? 'ok' : 'none', plan: result, updatedAt: now }, now);
}

/**
 * 1.2.2 (REVUE-USAGE n° 7) : 2e ligne d'un lieu ou d'un trajet dans « Favoris », plus pâle : le détail sans l'arrivée,
 * déjà dite en ligne 1 : premier véhicule en toutes lettres et son heure prévue, retard, voie, changements (« bus W
 * 07:36, 1 changement », « IC 07:42 +2 voie 6 !, direct ») ; gare de départ hors de portée à pied : « IC voie 4 à
 * Bruxelles-Central » ; à pied : « à pied, 9 min ». null : pas de 2e ligne (« tu y es », « aucun trajet », en calcul).
 * `planned` : un « ~ » est montré (note du bas).
 */
export function favoriteDetail(a: FavoriteAnswer | undefined, now: number, settings: Settings, maxPx = FULL_PX): { text: string; planned: boolean } | null {
  const j = a?.state === 'ok' ? a.plan?.journeys[0] : undefined;
  if (!j) return null;
  const r = firstRide(j);
  if (!r) return { text: `à pied, ${minText(journeyMinutes(j))}`, planned: false };
  if (!catchable(j, now)) return null;
  const fit = (t: string): string => (textWidth(t) <= maxPx ? t : truncate(t, maxPx));
  if (a?.fromStation) {
    const plat = r.mode === 'train' ? platformText(r.platform, r.newPlatform) : '';
    return { text: fit(`${rideWords(r)}${plat ? ' ' + plat : ''} à ${displayName(r.from.name, settings.lang)}`), planned: false };
  }
  const planned = !r.rt && !r.cancelled && settings.display.markPlanned;
  const time = r.cancelled ? `${hhmm(r.schedDep)} SUPPRIMÉ` : `${planned ? '~' : ''}${hhmm(r.schedDep)}${delaySuffix(r.delayMin)}`;
  const build = (short: boolean): string => {
    const plat = r.mode === 'train' && !r.cancelled ? platformText(r.platform, r.newPlatform, short) : '';
    return `${rideWords(r)} ${time}${plat ? ' ' + plat : ''}, ${transfersText(j.transfers)}`;
  };
  const long = build(false);
  return { text: textWidth(long) <= maxPx ? long : fit(build(true)), planned };
}

/* ------------------------------ 1.2.2 : Bus, tram, métro ------------------------------ */

/** Titre d'une ligne à son arrêt (PRD-1.2.2 § 3) : « Bus W · Merbraine » ; mode pas encore connu : « Ligne W · … ». */
export function lineTitle(mode: Mode | undefined, line: string, stop: string): string {
  return `${mode ? vehicleLong(mode, line) : `Ligne ${line}`} · ${stop}`;
}

/** Arrêt sans filtre : « Gare du Nord · toutes les lignes ». */
export const allLinesTitle = (stop: string): string => `${stop} · ${SECTION.allLines}`;

/** Un passage comme sur les tableaux : « 3 » (minutes), « ~4 », « imminent », « SUPPRIMÉ », « ~08:45 » au-delà d'1 h. */
function passage(d: LineDeparture, now: number, markPlanned: boolean): { v: string; minutes: boolean; partial: boolean } {
  const partial = !!d.partial;
  if (d.cancelled) return { v: 'SUPPRIMÉ', minutes: false, partial };
  const m = minutesUntil(d.est, now);
  const mark = plannedMark(d.rt, markPlanned);
  if (m >= 60) return { v: `${mark}${hhmm(d.est)}`, minutes: false, partial };
  if (m < 1) return { v: 'imminent', minutes: false, partial };
  return { v: `${mark}${m}`, minutes: true, partial };
}

/** « demain » (ou « le 12/11 ») devant des heures d'un autre jour, comme les tableaux (S6) ; '' le jour même. */
function laterDay(d: Pick<Departure, 'est' | 'cancelled'> | undefined, now: number): string {
  return d && !d.cancelled && minutesUntil(d.est, now) >= 60 ? dayWord(d.est, now) : '';
}

/**
 * Les 2 prochains passages d'un sens (PRD-1.2.2 § 3) : « 3 · 18 min », « imminent · 9 min », « ~4 · ~19 min »,
 * « SUPPRIMÉ · 18 min », « 45 min · 08:45 » ; un seul : « 3 min » ; aucun : « aucun passage ». Un passage partiel
 * (`partial`, il s'arrête avant le terminus du sens) est marqué « * » : « 3* · 18 min », « 3 · 18 min* ». Le
 * lendemain, comme les tableaux : « demain 06:02 · 06:10 ».
 */
export function passagesText(deps: readonly LineDeparture[], now: number, markPlanned: boolean, maxPx = HOME_RIGHT_PX): string {
  const ps = deps.slice(0, 2).map((d) => passage(d, now, markPlanned));
  if (!ps.length) return SECTION.noPassage;
  const one = (p: (typeof ps)[number], unit: boolean): string => `${p.v}${p.minutes && unit ? `${NB}min` : ''}${p.partial ? PARTIAL_MARK : ''}`;
  const day = laterDay(deps[0], now);
  const pre = day ? `${day} ` : '';
  if (ps.length === 1) return pre + one(ps[0], true);
  const [a, b] = ps;
  // l'unité une seule fois quand les deux passages sont en minutes (« 3 · 18 min »)
  const both = `${pre}${one(a, !(a.minutes && b.minutes))} · ${one(b, true)}`;
  // le lendemain, les deux heures ne tiennent pas toujours dans la colonne (« demain ~06:04 · ~06:12 ») : la première
  return day && textWidth(both) > maxPx ? pre + one(a, true) : both;
}

/**
 * Arrêt « toutes les lignes » : les 2 prochains départs sur une ligne, « T3 Churchill 2 min · T4 Stalle 5 min » ; trop
 * long : les destinations sont coupées, jamais la ligne ni l'attente. Le lendemain : « demain, 232 Vilvorde 06:10 · … ».
 */
export function stopPassagesText(deps: readonly Departure[], now: number, lang: NameLang, markPlanned: boolean, maxPx: number): string {
  const ps = deps.slice(0, 2).map((d) => ({ line: lineLabel(d.mode, d.line), head: headText(d.head, lang, d.op), wait: minutesText(d, now, markPlanned) }));
  if (!ps.length) return SECTION.noPassageAll;
  const day = laterDay(deps[0], now);
  const join = (heads: string[]): string => (day ? `${day}, ` : '') + ps.map((p, i) => [p.line, heads[i], p.wait].filter(Boolean).join(' ')).join(' · ');
  const full = join(ps.map((p) => p.head));
  if (textWidth(full) <= maxPx) return full;
  const share = Math.max(0, (maxPx - textWidth(join(ps.map(() => '')))) / ps.length - 6);
  const cut = join(ps.map((p) => truncate(p.head, share)));
  return textWidth(cut) <= maxPx ? cut : truncate(cut, maxPx);
}

/** Détail d'une ligne : l'heure prévue d'un passage (« 07:48 », « ~08:08 », « 07:48 +3 »). */
export function passageTime(d: Departure, markPlanned: boolean): string {
  const p = passageParts(d, markPlanned);
  return p.lead + p.rest;
}

/** 1.2.4 : passageTime en deux parties (« ~08:08 », « +3 »). */
export function passageParts(d: Departure, markPlanned: boolean): TimeParts {
  if (d.cancelled) return { lead: hhmm(d.sched), rest: '' };
  return { lead: `${plannedMark(d.rt, markPlanned)}${hhmm(d.sched)}`, rest: delaySuffix(d.delayMin) };
}

/** Détail d'une ligne : l'attente (« dans 3 min », « imminent », « dans 1 h 05 », « SUPPRIMÉ »). */
export function waitText(d: Pick<Departure, 'est' | 'cancelled'>, now: number): string {
  if (d.cancelled) return 'SUPPRIMÉ';
  const m = minutesUntil(d.est, now);
  return m < 1 ? 'imminent' : `dans ${durationText(m)}`;
}

/** Durées des marches d'au moins 1 min, dans l'ordre du trajet. */
function walksOf(j: Pick<Journey, 'legs'>): number[] {
  return j.legs.filter((l) => l.kind === 'walk').map((l) => Math.round(l.walkMin ?? (l.arr - l.dep) / 60_000)).filter((m) => m >= 1);
}

/** Marches d'une proposition : « à pied 5 + 4 + 2 min » ; plus de 3 marches : « 23 min à pied » ; aucune : ''. */
export function walksPhrase(j: Pick<Journey, 'legs'>): string {
  const walks = walksOf(j);
  if (!walks.length) return '';
  return walks.length > 3 ? `${minText(walks.reduce((s, m) => s + m, 0))} à pied` : `à pied ${walks.join(' + ')}${NB}min`;
}

/**
 * « Comment » d'une proposition (« Autres trajets », 1.2.1 § 3.3) : « bus W + S1, à pied 3 + 5 min » (moyens du cœur,
 * puis les marches) ; plus de 3 marches : « 23 min à pied » ; trajet à pied : « à pied, 25 min ».
 */
export function meansLine(j: Pick<Journey, 'legs' | 'dep' | 'arr'>): string {
  if (!j.legs.some((l) => l.kind === 'ride')) return `à pied, ${minText(Math.max(1, Math.round((j.arr - j.dep) / 60_000)))}`;
  const walks = walksPhrase(j);
  return walks ? `${meansText(j)}, ${walks}` : meansText(j);
}

/**
 * Étape suivante d'un trajet en cours (ligne « En cours » de l'accueil) : avant de monter, le véhicule comme sur les
 * départs (1.2.2, REVUE-USAGE n° 8 : code court, heure prévue, retard, voie, « ! » si elle change ; la même heure que
 * la ligne de sa gare) : « IC 07:42 +2 voie 6 ! » (« v.6 ! » si la colonne est trop étroite), « W 07:36 » ;
 * « descente 08:48 » dans le véhicule, « arrivée 09:00 » ensuite.
 */
export function runningNext(j: Journey, now: number, maxPx = HOME_RIGHT_PX): string {
  for (const l of j.legs) {
    if (l.kind !== 'ride' || l.arr <= now) continue;
    const code = lineCode(l);
    if (l.cancelled) return `${code} ${hhmm(l.schedDep)} SUPPRIMÉ`;
    if (now < l.dep) {
      const time = `${code} ${hhmm(l.schedDep)}${delaySuffix(l.delayMin)}`;
      if (l.mode !== 'train') return time;
      const long = platformText(l.platform, l.newPlatform);
      if (!long) return time;
      const text = `${time} ${long}`;
      return textWidth(text) <= maxPx ? text : `${time} ${platformText(l.platform, l.newPlatform, true)}`;
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
