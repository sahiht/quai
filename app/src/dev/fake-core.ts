/**
 * Faux cœur de développement (?fake=1) : implémente l'interface Core avec un petit réseau statique tiré de
 * fixtures/network.json (et de l'extension de l'annexe A.2 du PRD : Waterloo, retours du soir), aligné sur les
 * scénarios de fixtures/README.md (S1 Namur 07:31, S2 Gare du Nord 12:10, S3 Bruxelles-Central 13:55).
 * Sensible à l'heure via now() : horaires générés pour le jour et le lendemain, temps réel selon l'heure.
 *
 * 1.1 : ordre intelligent et réponses des favoris (fonctions communes avec le vrai cœur, core/favorites.ts),
 * trajets étiquetés et expliqués (route : classement simplifié du PRD § 4, raisons de core/routing/reason.ts),
 * adresses (geocode : tableau de l'annexe A.2), état du temps réel (status), « Autour de moi » léger.
 *
 * Drapeaux (lus à chaque appel : modifier l'objet passé à createFakeCore change la scène, CA-M1.6 et CA-M8.6) :
 *  - stale : horaires périmés (publication arrêtée il y a 3 jours) ;
 *  - noRt : temps réel coupé (scène noRT) : status 'down', « ~ » partout ; suppressions et voies modifiées déjà
 *    connues gardées 15 min (M8.5) ;
 *  - geo : 'down' : service d'adresses en panne (CA-M4.6) ;
 *  - offline : téléphone hors ligne : adresses impossibles (error 'offline'), temps réel absent, status 'offline'.
 * Dans le navigateur, les paramètres d'URL geo=down et offline=1 sont lus ici (main.ts ne transmet que stale et
 * noRt), et l'objet des drapeaux est exposé dans globalThis.__quaiFake pour changer de scène depuis la console
 * (ex. __quaiFake.noRt = true).
 *
 * Cas utiles : favori d'arrêt sur « stib:6358 » (ancien identifiant, `aka` de Gare du Nord) ou sur un identifiant
 * inconnu nommé « Gare du Nord » à moins de 150 m → movedTo stib:6357F ; identifiant inconnu sans zone de même nom
 * → 'missing'. « Rue de Nimy 50, 7000 Mons » (adresse propre au faux cœur) → noTrip avec la gare de Mons.
 */
import { DEFAULT_SETTINGS } from '../core/api';
import type {
  Alert,
  Board,
  Core,
  CoreOptions,
  CoreStatus,
  Departure,
  Endpoint,
  FavoriteStop,
  Journey,
  JourneyLabel,
  LatLon,
  Leg,
  LineFilter,
  Meta,
  NearbyItem,
  PlanResult,
  Settings,
  Stopover,
  Suggestion,
} from '../core/api';
import { distanceM, gtfsTime, hhmm, localDate, localMinutes, walkMinutes } from '../core/util';
import type { AreaSummary, GeocodeResponse, GeocodeResult, HealthResponse, Mode, Names, Op } from '../../../shared/types';
import { normalizeForSearch, prettyName } from '../../../shared/names';
import { QuaiError } from '../core/errors';
import { answerFavorite, asTrip, orderFavorites, placeOf, relocateAmong, type PlanMemo } from '../core/favorites';
import { GeocodeClient, GeoError, type GeoTransport } from '../core/geocode';
import { reasonText } from '../core/routing/reason';
import { rankSearch } from '../core/search';
import { tripLabel } from '../core/suggest';
import { cancelAlert, delayAlert, forLabel, leaveAlert, NB, platformAlert } from '../core/text';

export interface FakeFlags {
  stale?: boolean;
  noRt?: boolean;
  geo?: 'down';
  offline?: boolean;
}

const N = (fr: string, nl = fr, l?: 'fr' | 'nl'): Names => (l ? { fr, nl, l } : { fr, nl });
const A = (id: string, op: Op, n: Names, lat: number, lon: number, modes: Mode[], lines: string[], aka?: string[]): AreaSummary => ({ id, op, n, lat, lon, modes, lines, ...(aka ? { aka } : {}) });
const hm = (h: number, m: number): number => h * 60 + m;
const MIN = 60_000;

/* ------------------------------ Réseau ------------------------------ */

const AREAS: AreaSummary[] = [
  A('sncb:8863008', 'sncb', N('Namur', 'Namen'), 50.4685, 4.8625, ['train'], ['IC']),
  A('sncb:8874005', 'sncb', N('Gembloux', 'Gembloers'), 50.5707, 4.6913, ['train'], ['IC']),
  A('sncb:8811601', 'sncb', N('Ottignies'), 50.6727, 4.5694, ['train'], ['IC']),
  A('sncb:8811304', 'sncb', N('Bruxelles-Luxembourg', 'Brussel-Luxemburg'), 50.8388, 4.3732, ['train'], ['IC']),
  A('sncb:8811916', 'sncb', N('Bruxelles-Schuman', 'Brussel-Schuman'), 50.8433, 4.3804, ['train'], ['IC']),
  A('sncb:8812005', 'sncb', N('Bruxelles-Nord', 'Brussel-Noord'), 50.8605, 4.3612, ['train'], ['IC', 'S1']),
  A('sncb:8813003', 'sncb', N('Bruxelles-Central', 'Brussel-Centraal'), 50.8454, 4.3571, ['train'], ['IC', 'S1']),
  A('sncb:8814001', 'sncb', N('Bruxelles-Midi', 'Brussel-Zuid'), 50.8357, 4.3363, ['train'], ['IC', 'S1']),
  A('sncb:8892007', 'sncb', N('Gand-Saint-Pierre', 'Gent-Sint-Pieters', 'nl'), 51.0359, 3.7107, ['train'], ['IC']),
  A('sncb:8893120', 'sncb', N('Gand-Dampoort', 'Gent-Dampoort', 'nl'), 51.0563, 3.7406, ['train'], ['IC']),
  A('sncb:8891009', 'sncb', N('Bruges', 'Brugge', 'nl'), 51.1972, 3.2167, ['train'], ['IC']),
  A('sncb:8822004', 'sncb', N('Malines', 'Mechelen', 'nl'), 51.0175, 4.4831, ['train'], ['IC']),
  A('sncb:8821006', 'sncb', N('Anvers-Central', 'Antwerpen-Centraal', 'nl'), 51.2172, 4.4211, ['train'], ['IC']),
  A('sncb:8883006', 'sncb', N('Nivelles', 'Nijvel'), 50.5996, 4.3289, ['train'], ['S1']),
  A('sncb:8814266', 'sncb', N('Waterloo'), 50.7154, 4.3835, ['train'], ['S1']),
  A('sncb:8881000', 'sncb', N('Mons', 'Bergen'), 50.4532, 3.9425, ['train'], ['IC']),
  A('stib:6357F', 'stib', N('Gare du Nord', 'Noordstation'), 50.86004, 4.36017, ['tram'], ['3', '4'], ['stib:6358']),
  A('stib:6359', 'stib', N('Rogier'), 50.8569, 4.3589, ['metro', 'tram'], ['2', '3', '4', '6']),
  A('stib:6361', 'stib', N('De Brouckère'), 50.851, 4.3524, ['tram'], ['3', '4']),
  A('stib:6362', 'stib', N('Bourse', 'Beurs'), 50.8483, 4.3497, ['tram'], ['3', '4']),
  A('stib:6364', 'stib', N('Gare du Midi', 'Zuidstation'), 50.8357, 4.336, ['metro', 'tram'], ['2', '3', '4']),
  A('stib:6366', 'stib', N('Churchill'), 50.80752, 4.36605, ['tram'], ['3']),
  A('stib:6370', 'stib', N('Stalle', 'Stalle'), 50.7972, 4.3188, ['tram'], ['4']),
  A('stib:6380', 'stib', N('Esplanade'), 50.89902, 4.33905, ['tram'], ['3']),
  A('stib:8291', 'stib', N('Simonis'), 50.86332, 4.32905, ['metro'], ['2']),
  A('stib:8302', 'stib', N('Roi Baudouin', 'Koning Boudewijn'), 50.8913, 4.3345, ['metro'], ['6']),
  A('delijn:308611', 'delijn', N('Bruxelles-Nord', 'Brussel Noordstation', 'nl'), 50.86183, 4.35906, ['bus'], ['232', '460', '270']),
  A('delijn:300120', 'delijn', N('Gare de Vilvorde', 'Vilvoorde Station', 'nl'), 50.9262, 4.43, ['bus'], ['232']),
  A('delijn:300450', 'delijn', N('Meise Centrum', 'Meise Centrum', 'nl'), 50.939, 4.327, ['bus'], ['460']),
  A('delijn:301870', 'delijn', N('Gare de Kortenberg', 'Kortenberg Station', 'nl'), 50.884, 4.538, ['bus'], ['270']),
  A('delijn:200553', 'delijn', N('Gand-Saint-Pierre', 'Gent Sint-Pietersstation', 'nl'), 51.03622, 3.71105, ['tram'], ['1']),
  A('delijn:200101', 'delijn', N('Korenmarkt, Gand', 'Gent Korenmarkt', 'nl'), 51.05472, 3.72145, ['tram'], ['1']),
  A('delijn:200900', 'delijn', N('Flanders Expo, Gand', 'Gent Flanders Expo', 'nl'), 51.024, 3.695, ['tram'], ['1']),
  A('tec:N508aga', 'tec', N('Namur Gare'), 50.46803, 4.86356, ['bus'], ['4', '5', '51']),
  A('tec:N509aaa', 'tec', N('Namur Place Léopold'), 50.466, 4.861, ['bus'], ['5']),
  A('tec:N520aaa', 'tec', N('Jambes Place de la Wallonie'), 50.459, 4.873, ['bus'], ['4']),
  A('tec:N530aaa', 'tec', N('Bouge Église'), 50.477, 4.885, ['bus'], ['5']),
  A('tec:N540aaa', 'tec', N('Salzinnes Ronet'), 50.457, 4.842, ['bus'], ['51']),
  A('tec:Bbrlgar1', 'tec', N('Braine-l’Alleud Gare'), 50.6838, 4.3715, ['bus'], ['W']),
  A('tec:Bwategl1', 'tec', N('Waterloo Eglise'), 50.7174, 4.3979, ['bus'], ['W']),
  A('tec:Bbxlmid1', 'tec', N('Bruxelles Midi'), 50.8361, 4.3352, ['bus'], ['W']),
  A('tec:Hmogpl1', 'tec', N('Mons Grand-Place'), 50.4545, 3.952, ['bus'], ['1']),
  A('tec:Hmojem1', 'tec', N('Jemappes Place'), 50.4512, 3.8869, ['bus'], ['1']),
];
const AREA = new Map(AREAS.map((a) => [a.id, a]));
/** Zones d'arrivée seulement (terminus) : absentes de « Autour de moi » et de la recherche (S5). */
const NO_DEPS = new Set(['stib:6370', 'stib:8302', 'delijn:300120', 'delijn:300450', 'delijn:301870', 'tec:N520aaa', 'tec:N530aaa', 'tec:N540aaa', 'tec:Hmojem1']);

function area(id: string): AreaSummary {
  const a = AREA.get(id) ?? AREAS.find((x) => x.aka?.includes(id));
  if (!a) throw new QuaiError('areaUnknown');
  return a;
}

/** Trains : gabarits avec heures de départ (min depuis minuit) et arrêts [gare, décalage arr, décalage dép, voie]. */
interface TrainTpl {
  key: string;
  cat: string;
  num: string;
  head: Names;
  stops: [string, number, number, string][];
  starts: number[];
  /** Voies d'une autre série (minute de départ → gare → voie). */
  alt?: Record<number, Record<string, string>>;
}
const hours = (from: number, to: number, minute: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => (from + i) * 60 + minute);
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const TRAINS: TrainTpl[] = [
  {
    key: 'IC-NAM-MIDI', cat: 'IC', num: '2112', head: N('Bruxelles-Midi', 'Brussel-Zuid'), starts: hours(5, 21, 42),
    stops: [['sncb:8863008', 0, 0, '4'], ['sncb:8874005', 13, 13, '1'], ['sncb:8811601', 27, 27, '2'], ['sncb:8811304', 49, 49, '1'], ['sncb:8811916', 53, 53, '2'], ['sncb:8812005', 58, 59, '11'], ['sncb:8813003', 64, 64, '3'], ['sncb:8814001', 70, 70, '15']],
  },
  {
    // Comme les fixtures : pas de train vers Gand entre 09:00 et 14:10 à Bruxelles-Central (CA-M1.3 « départ 14:10 »).
    key: 'IC-NORD-BRUGES', cat: 'IC', num: '1510', head: N('Bruges', 'Brugge', 'nl'),
    starts: sorted([...hours(6, 8, 6), ...hours(6, 8, 36), hm(8, 56), ...hours(14, 21, 6), ...hours(14, 21, 36)]),
    stops: [['sncb:8812005', 0, 0, '11'], ['sncb:8813003', 4, 4, '4'], ['sncb:8814001', 8, 8, '12'], ['sncb:8892007', 33, 33, '8'], ['sncb:8891009', 56, 56, '5']],
  },
  {
    key: 'IC-MIDI-ANVERS', cat: 'IC', num: '2412', head: N('Anvers-Central', 'Antwerpen-Centraal', 'nl'), starts: sorted([...hours(6, 22, 12), ...hours(6, 22, 20)]),
    alt: { 20: { 'sncb:8814001': '6', 'sncb:8813003': '1', 'sncb:8812005': '12' } },
    stops: [['sncb:8814001', 0, 0, '19'], ['sncb:8813003', 5, 5, '5'], ['sncb:8812005', 10, 10, '9'], ['sncb:8822004', 25, 25, '7'], ['sncb:8821006', 46, 46, '22']],
  },
  {
    key: 'S1-NORD-NIVELLES', cat: 'S1', num: '1987', head: N('Nivelles', 'Nijvel'), starts: hours(6, 22, 34),
    stops: [['sncb:8812005', 0, 0, '3'], ['sncb:8813003', 4, 4, '1'], ['sncb:8814001', 8, 8, '6'], ['sncb:8814266', 25, 25, '2'], ['sncb:8883006', 41, 41, '2']],
  },
  {
    // Extension Waterloo (fixtures 1.1) : Nivelles HH:10 et HH:40, Waterloo +15, Bruxelles-Central 25 min après.
    key: 'S1-NIVELLES-NORD', cat: 'S1', num: '1960', head: N('Bruxelles-Nord', 'Brussel-Noord'), starts: sorted([...hours(6, 21, 10), ...hours(6, 21, 40)]),
    stops: [['sncb:8883006', 0, 0, '2'], ['sncb:8814266', 15, 15, '1'], ['sncb:8814001', 35, 35, '6'], ['sncb:8813003', 40, 40, '1'], ['sncb:8812005', 45, 45, '3']],
  },
  {
    key: 'IC-NORD-GAND-ANVERS', cat: 'IC', num: '1810', head: N('Anvers-Central', 'Antwerpen-Centraal', 'nl'), starts: hours(14, 20, 18),
    stops: [['sncb:8812005', 0, 0, '12'], ['sncb:8813003', 4, 4, '6'], ['sncb:8814001', 8, 8, '12'], ['sncb:8892007', 35, 35, '9'], ['sncb:8893120', 43, 43, '2'], ['sncb:8821006', 94, 94, '22']],
  },
  {
    // Retours du soir (A.2) : IC Bruxelles-Central vers Namur à 17:12 et 18:12.
    key: 'IC-MIDI-NAM', cat: 'IC', num: '2137', head: N('Namur', 'Namen'), starts: [hm(17, 6), hm(18, 6)],
    stops: [['sncb:8814001', 0, 0, '6'], ['sncb:8813003', 6, 6, '5'], ['sncb:8812005', 11, 12, '3'], ['sncb:8811916', 17, 17, '2'], ['sncb:8811304', 21, 21, '1'], ['sncb:8811601', 43, 43, '5'], ['sncb:8874005', 57, 57, '2'], ['sncb:8863008', 70, 70, '5']],
  },
  {
    key: 'IC-MIDI-MONS', cat: 'IC', num: '1715', head: N('Mons', 'Bergen'), starts: hours(6, 22, 26),
    stops: [['sncb:8814001', 0, 0, '17'], ['sncb:8881000', 48, 48, '3']],
  },
];

interface TrainRt { rt: boolean; delay: number; platformAt?: Record<string, string>; cancelled?: boolean }

/** Temps réel « en direct » des trains (scène base) selon l'instance et l'heure actuelle. */
function trainRtLive(t: TrainTpl, start: number, now: number): TrainRt {
  const m = localMinutes(now);
  // Fixtures, scène base : l'IC de 07:42 à Namur part voie 6 avec 2 min de retard (connu dès 07:00, CA-M1.2).
  if (t.key === 'IC-NAM-MIDI' && start === hm(7, 42)) return m >= hm(7, 0) ? { rt: true, delay: 2, platformAt: { 'sncb:8863008': '6' } } : { rt: true, delay: 0 };
  if (t.key === 'IC-MIDI-ANVERS' && start === hm(12, 20)) return { rt: false, delay: 0 };
  if (t.key === 'S1-NORD-NIVELLES' && start === hm(12, 34)) return { rt: true, delay: 0, cancelled: true };
  if (t.key === 'IC-NORD-GAND-ANVERS' && start === hm(14, 18)) return { rt: true, delay: 3 };
  return { rt: true, delay: 0 };
}

/** Bus, trams, métros : lignes (motif de zones avec décalages, premier départ, fréquence, dernier départ). */
type RtFn = (sched: number, now: number) => { rt: boolean; delay: number } | null;
interface LineTpl {
  key: string;
  op: Exclude<Op, 'sncb'>;
  mode: Mode;
  line: string;
  head: Names;
  stops: [string, number][];
  first: number;
  every: number;
  last: number;
  extra?: number[];
  platform?: Record<string, string>;
  /** Message de l'opérateur (STIB) à un arrêt, montré avec le temps réel. */
  msg?: Record<string, string>;
  /** Temps réel à un arrêt de montée (zone → fonction de l'horaire prévu en minutes) ; absent : horaire prévu. */
  rt?: Record<string, RtFn>;
  /** STIB : passages en temps réel dans les 30 min (zone de montée quelconque). */
  stib?: boolean;
}
const exact = (table: Record<number, number>): RtFn => (sched) => (sched in table ? { rt: true, delay: table[sched] } : null);
const LINES: LineTpl[] = [
  { key: 'T3-CHURCHILL', op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), stops: [['stib:6380', 0], ['stib:6357F', 12], ['stib:6359', 14], ['stib:6361', 16], ['stib:6362', 17], ['stib:6364', 22], ['stib:6366', 37]], first: hm(5, 52), every: 8, last: hm(22, 44), stib: true },
  { key: 'T3-ESPLANADE', op: 'stib', mode: 'tram', line: '3', head: N('Esplanade'), stops: [['stib:6366', 0], ['stib:6359', 21], ['stib:6357F', 23], ['stib:6380', 35]], first: hm(5, 45), every: 8, last: hm(22, 37), stib: true },
  { key: 'T4-STALLE', op: 'stib', mode: 'tram', line: '4', head: N('Stalle (P)', 'Stalle (P)'), stops: [['stib:6357F', 0], ['stib:6359', 2], ['stib:6361', 4], ['stib:6362', 5], ['stib:6364', 10], ['stib:6370', 25]], first: hm(6, 7), every: 8, last: hm(22, 55), stib: true },
  { key: 'M2-SIMONIS', op: 'stib', mode: 'metro', line: '2', head: N('Simonis (Elisabeth)'), stops: [['stib:6364', 0], ['stib:6359', 14], ['stib:8291', 20]], first: hm(5, 53), every: 6, last: hm(23, 47), stib: true },
  { key: 'M2-MIDI', op: 'stib', mode: 'metro', line: '2', head: N('Gare du Midi', 'Zuidstation'), stops: [['stib:8291', 0], ['stib:6359', 6], ['stib:6364', 20]], first: hm(6, 8), every: 6, last: hm(23, 50), stib: true, msg: { 'stib:6359': 'Travaux : arrêt Botanique non desservi' } },
  { key: 'M6-ROI', op: 'stib', mode: 'metro', line: '6', head: N('Roi Baudouin', 'Koning Boudewijn'), stops: [['stib:6359', 0], ['stib:8302', 14]], first: hm(6, 5), every: 10, last: hm(23, 55), stib: true },
  { key: 'DL-232', op: 'delijn', mode: 'bus', line: '232', head: N('Vilvorde', 'Vilvoorde', 'nl'), stops: [['delijn:308611', 0], ['delijn:300120', 25]], first: hm(6, 0), every: 15, last: hm(22, 45), platform: { 'delijn:308611': '4' }, rt: { 'delijn:308611': exact({ [hm(12, 30)]: 0, [hm(12, 45)]: 1 }) } },
  { key: 'DL-460', op: 'delijn', mode: 'bus', line: '460', head: N('Meise', 'Meise', 'nl'), stops: [['delijn:308611', 0], ['delijn:300450', 22]], first: hm(6, 18), every: 30, last: hm(22, 48), platform: { 'delijn:308611': '6' }, rt: { 'delijn:308611': exact({ [hm(12, 18)]: 2 }) } },
  { key: 'DL-270', op: 'delijn', mode: 'bus', line: '270', head: N('Kortenberg', 'Kortenberg', 'nl'), stops: [['delijn:308611', 0], ['delijn:301870', 35]], first: hm(6, 22), every: 30, last: hm(22, 52), platform: { 'delijn:308611': '4' } },
  { key: 'DL-1-KOREN', op: 'delijn', mode: 'tram', line: '1', head: N('Korenmarkt', 'Korenmarkt', 'nl'), stops: [['delijn:200900', 0], ['delijn:200553', 6], ['delijn:200101', 16]], first: hm(6, 6), every: 8, last: hm(22, 54), platform: { 'delijn:200553': '3' }, rt: { 'delijn:200553': exact({ [hm(14, 44)]: 0, [hm(14, 52)]: 1 }) } },
  { key: 'DL-1-EXPO', op: 'delijn', mode: 'tram', line: '1', head: N('Flanders Expo', 'Flanders Expo', 'nl'), stops: [['delijn:200101', 0], ['delijn:200553', 10], ['delijn:200900', 16]], first: hm(6, 0), every: 8, last: hm(22, 48), platform: { 'delijn:200101': '2', 'delijn:200553': '4' } },
  { key: 'TEC-4', op: 'tec', mode: 'bus', line: '4', head: N('Jambes'), stops: [['tec:N508aga', 0], ['tec:N520aaa', 9]], first: hm(6, 0), every: 15, last: hm(23, 45), extra: [hm(24, 10)], platform: { 'tec:N508aga': 'A' }, rt: { 'tec:N508aga': exact({ [hm(7, 45)]: 0 }) } },
  { key: 'TEC-5', op: 'tec', mode: 'bus', line: '5', head: N('Bouge'), stops: [['tec:N509aaa', 0], ['tec:N508aga', 4], ['tec:N530aaa', 15]], first: hm(6, 10), every: 20, last: hm(22, 50), platform: { 'tec:N508aga': 'B' }, rt: { 'tec:N509aaa': exact({ [hm(7, 50)]: 3 }) } },
  { key: 'TEC-51', op: 'tec', mode: 'bus', line: '51', head: N('Salzinnes'), stops: [['tec:N508aga', 0], ['tec:N540aaa', 12]], first: hm(6, 5), every: 30, last: hm(21, 35), platform: { 'tec:N508aga': 'A' } },
  // Extension Waterloo (fixtures 1.1) : bus W vers « Bruxelles Midi », 45 min depuis Waterloo Eglise, à côté du métro.
  { key: 'TEC-W', op: 'tec', mode: 'bus', line: 'W', head: N('Bruxelles Midi'), stops: [['tec:Bbrlgar1', 0], ['tec:Bwategl1', 12], ['tec:Bbxlmid1', 57]], first: hm(6, 4), every: 20, last: hm(21, 44) },
  { key: 'TEC-WR', op: 'tec', mode: 'bus', line: 'W', head: N('Braine-l’Alleud Gare'), stops: [['tec:Bbxlmid1', 0], ['tec:Bwategl1', 45], ['tec:Bbrlgar1', 57]], first: hm(6, 10), every: 20, last: hm(21, 50) },
  // Propre au faux cœur : bus de Mons qui ne mène pas à la gare (cas « Pas de trajet complet »).
  { key: 'TEC-MONS-1', op: 'tec', mode: 'bus', line: '1', head: N('Jemappes'), stops: [['tec:Hmogpl1', 0], ['tec:Hmojem1', 14]], first: hm(6, 3), every: 20, last: hm(21, 43) },
];

/* ------------------------------ Adresses (annexe A.2) ------------------------------ */

type GeoRow = GeocodeResult & { nl?: string };
const G = (label: string, lat: number, lon: number, source: GeocodeResult['source'], kind: GeocodeResult['kind'] = 'adresse', nl?: string, score = 1): GeoRow => ({
  label,
  lat,
  lon,
  kind,
  source,
  score,
  ...(kind === 'adresse' ? {} : { approx: true }),
  ...(nl ? { names: { fr: label, nl }, nl } : {}),
});
const GEO: GeoRow[] = [
  G('Rue de Fer 25, 5000 Namur', 50.4662, 4.8648, 'wal'),
  G('Rue de Fer 25, 4000 Liège', 50.64, 5.57, 'wal'),
  G('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545, 'bru', 'adresse', 'Nieuwstraat 1, 1000 Brussel'),
  G('Rue Neuve, 1000 Bruxelles', 50.852, 4.3555, 'bru', 'rue', 'Nieuwstraat, 1000 Brussel', 0.9),
  G('Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365, 'bru', 'adresse', 'Winston Churchilllaan 100, 1180 Ukkel'),
  G('Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334, 'bru', 'adresse', 'Eeuwfeestlaan 1, 1020 Brussel'),
  G('Veldstraat 1, 9000 Gent', 51.0537, 3.7225, 'vla'),
  G('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399, 'wal'),
  G('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36, 'bru', 'adresse', 'Vooruitgangstraat 20, 1210 Sint-Joost-ten-Node'),
  // Propre au faux cœur : exemple « Moins de marche » depuis S1 (moins-de-marche.md, CA-MW.6).
  G('Place Saint-Géry 1, 1000 Bruxelles', 50.847, 4.348, 'bru', 'adresse', 'Sint-Goriksplein 1, 1000 Brussel'),
  G('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715, 'wal'),
  G('Rue de Nimy 50, 7000 Mons', 50.46, 3.957, 'wal'),
  G('5000 Namur', 50.4669, 4.8675, 'wal', 'commune', undefined, 0.8),
  G('9000 Gent', 51.0543, 3.7174, 'vla', 'commune', undefined, 0.8),
];
const KIND_RANK: Record<GeocodeResult['kind'], number> = { adresse: 0, rue: 1, lieu: 2, commune: 3 };

/** Faux relais d'adresses : chaque mot tapé commence un mot du libellé (fr ou nl) ; sans chiffre, ni numéro. */
function fakeGeoTransport(flags: FakeFlags, now: () => number): GeoTransport {
  return async (q, lang) => {
    if (flags.offline) throw new GeoError('offline');
    if (flags.geo === 'down') throw new GeoError('down');
    const words = normalizeForSearch(q).split(' ').filter(Boolean);
    const hasNumber = words.some((w) => /\d/.test(w));
    const hits = GEO.map((g, i) => {
      if (!hasNumber && g.kind === 'adresse') return null;
      const own = new Set(normalizeForSearch(`${g.label} ${g.nl ?? ''}`).split(' '));
      if (!words.every((w) => [...own].some((o) => o.startsWith(w)))) return null;
      return { g, i, exact: words.filter((w) => own.has(w)).length };
    })
      .filter((x): x is { g: GeoRow; i: number; exact: number } => x !== null)
      .sort((a, b) => b.exact - a.exact || KIND_RANK[a.g.kind] - KIND_RANK[b.g.kind] || a.i - b.i);
    const results = hits.slice(0, 8).map(({ g }): GeocodeResult => {
      const { nl: _nl, ...r } = g;
      return lang === 'nl' && g.nl ? { ...r, label: g.nl } : r;
    });
    const res: GeocodeResponse = {
      q: q.trim(),
      fetchedAt: new Date(now()).toISOString(),
      results,
      sources: { vla: { ok: true, ms: 80 }, bru: { ok: true, ms: 90 }, wal: { ok: true, ms: 110 } },
      attribution: 'Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR)',
    };
    return res;
  };
}

/* ------------------------------ Outils ------------------------------ */

const dayOf = (now: number): string => localDate(now);
const T = (date: string, min: number): number => gtfsTime(date, min);
const nextDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
const prevDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};
const headMatch = (head: Names, f: LineFilter): boolean => normalizeForSearch(prettyName(head.fr)) === f.head;
const passes = (filter: LineFilter[] | undefined, line: string, head: Names): boolean => !filter?.length || filter.some((f) => f.line === line && headMatch(head, f));
const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm4 = (min: number) => `${pad2(Math.floor(min / 60))}${pad2(min % 60)}`;
/** Horaires d'une ligne au premier arrêt (minutes). */
const lineStarts = (l: LineTpl): number[] => {
  const out: number[] = [];
  for (let m = l.first; m <= l.last; m += l.every) out.push(m);
  return [...out, ...(l.extra ?? [])];
};
const LINE_STARTS = new Map(LINES.map((l) => [l.key, lineStarts(l)]));

/** Un voyage (train ou ligne urbaine) d'un jour donné. */
interface Run {
  kind: 'train' | 'line';
  id: string;
  date: string;
  start: number;
  train?: TrainTpl;
  line?: LineTpl;
  /** Arrêts : zone, arrivée et départ prévus (ms), voie. */
  stops: { areaId: string; arr: number; dep: number; platform?: string }[];
}

function trainRun(tpl: TrainTpl, date: string, start: number): Run {
  return {
    kind: 'train',
    id: `${tpl.key}-${date.replace(/-/g, '')}-${hhmm4(start)}`,
    date,
    start,
    train: tpl,
    stops: tpl.stops.map(([areaId, arrOff, depOff, platform]) => ({ areaId, arr: T(date, start + arrOff), dep: T(date, start + depOff), platform: tpl.alt?.[start % 60]?.[areaId] ?? platform })),
  };
}

function lineRun(l: LineTpl, date: string, start: number): Run {
  return {
    kind: 'line',
    id: `${l.key}-${date.replace(/-/g, '')}-${hhmm4(start)}`,
    date,
    start,
    line: l,
    stops: l.stops.map(([areaId, off]) => ({ areaId, arr: T(date, start + off), dep: T(date, start + off), platform: l.platform?.[areaId] })),
  };
}

const runById = (id: string): Run | null => {
  const m = /^(.+)-(\d{8})-(\d{4})$/.exec(id);
  if (!m) return null;
  const date = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`;
  const start = Number(m[3].slice(0, 2)) * 60 + Number(m[3].slice(2));
  const tpl = TRAINS.find((t) => t.key === m[1]);
  if (tpl) return trainRun(tpl, date, start);
  const l = LINES.find((x) => x.key === m[1]);
  return l ? lineRun(l, date, start) : null;
};

/** Passages au départ de chaque zone : gabarit, rang de l'arrêt, décalage de départ, heures de départ triées. */
interface Passage {
  key: string;
  train?: TrainTpl;
  line?: LineTpl;
  k: number;
  off: number;
  starts: number[];
}
const PASSAGES = new Map<string, Passage[]>();
for (const tpl of TRAINS) {
  tpl.stops.forEach(([areaId, , dep], k) => {
    if (k === tpl.stops.length - 1) return;
    PASSAGES.set(areaId, [...(PASSAGES.get(areaId) ?? []), { key: tpl.key, train: tpl, k, off: dep, starts: sorted(tpl.starts) }]);
  });
}
for (const l of LINES) {
  l.stops.forEach(([areaId, off], k) => {
    if (k === l.stops.length - 1) return;
    PASSAGES.set(areaId, [...(PASSAGES.get(areaId) ?? []), { key: l.key, line: l, k, off, starts: sorted(LINE_STARTS.get(l.key) ?? []) }]);
  });
}

/** Premier rang d'un tableau trié dont la valeur est ≥ x. */
function lowerBound(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const runOf = (p: Passage, date: string, start: number): Run => (p.train ? trainRun(p.train, date, start) : lineRun(p.line!, date, start));

/** Voyages partant d'une zone entre `from` et `to` (horaires prévus), triés ; `perTpl` : au plus n par gabarit. */
function runsFrom(areaId: string, from: number, to: number, perTpl = Infinity): { run: Run; k: number }[] {
  const out: { run: Run; k: number; t: number }[] = [];
  const dates = [prevDate(dayOf(from)), dayOf(from), nextDate(dayOf(from))].filter((d, i, xs) => xs.indexOf(d) === i && T(d, 0) <= to);
  for (const p of PASSAGES.get(areaId) ?? []) {
    let n = 0;
    for (const date of dates) {
      const base = T(date, 0);
      for (let i = lowerBound(p.starts, (from - base) / MIN - p.off); i < p.starts.length && n < perTpl; i++) {
        const t = base + (p.starts[i] + p.off) * MIN;
        if (t > to) break;
        if (t < from) continue;
        out.push({ run: runOf(p, date, p.starts[i]), k: p.k, t });
        n++;
      }
    }
  }
  return out.sort((a, b) => a.t - b.t).map(({ run, k }) => ({ run, k }));
}

/* ------------------------------ Cœur factice ------------------------------ */

interface Pt {
  lat: number;
  lon: number;
  name: Names;
  areaId?: string;
}

/** Marge d'une correspondance, en plus de la marche entre les deux zones. */
const TRANSFER_MS = 2 * MIN;
const MAX_WAIT_MS = 60 * MIN;
/** À 50 m au plus d'un arrêt, on y est : pas d'étape à pied. */
const AT_STOP_M = 50;
const HORIZON_MS = 23 * 3_600_000;
const NEAR_HERE_M = 300;
const RT_MEMORY_MS = 15 * MIN;

export function createFakeCore(opts: CoreOptions, flags: FakeFlags = {}): Core {
  const now = (): number => opts.now();
  let meta: Meta | null = null;
  /** Plans des trajets favoris, comme le vrai cœur. */
  const plans = new Map<string, PlanMemo>();
  // Navigateur : drapeaux des adresses lus dans l'adresse de la page ; objet exposé pour changer de scène.
  const g = globalThis as { location?: { search?: string }; __quaiFake?: FakeFlags };
  try {
    const q = new URLSearchParams(g.location?.search ?? '');
    if (flags.geo === undefined && q.get('geo') === 'down') flags.geo = 'down';
    if (flags.offline === undefined && q.get('offline') === '1') flags.offline = true;
  } catch {
    /* rien */
  }
  if (g.location) g.__quaiFake = flags;

  /* --- état du temps réel (status) et mémoire des suppressions --- */
  let rtState: CoreStatus = { rt: 'unknown' };
  let rtOkAt: number | undefined;
  const live = (): boolean => !flags.noRt && !flags.offline;
  /** Appelé à chaque calcul qui demande le temps réel. */
  function touchRt(): void {
    const t = now();
    const s: CoreStatus['rt'] = flags.offline ? 'offline' : flags.noRt ? 'down' : 'ok';
    if (rtState.rt !== s) rtState = { rt: s, since: t };
    if (s === 'ok') rtOkAt = t;
  }

  function trainRt(tpl: TrainTpl, start: number): TrainRt {
    if (live()) return trainRtLive(tpl, start, now());
    // Panne : suppressions et voies modifiées déjà connues gardées 15 min (M8.5), en horaire prévu.
    if (rtOkAt !== undefined && now() - rtOkAt <= RT_MEMORY_MS) {
      const known = trainRtLive(tpl, start, rtOkAt);
      const out: TrainRt = { rt: false, delay: 0 };
      if (known.cancelled) out.cancelled = true;
      if (known.platformAt) out.platformAt = known.platformAt;
      return out;
    }
    return { rt: false, delay: 0 };
  }

  function lineRt(l: LineTpl, areaId: string, schedMs: number): { rt: boolean; delay: number } | null {
    if (!live()) return null;
    const t = now();
    if (l.stib) return schedMs - t <= 30 * MIN && schedMs >= t - MIN ? { rt: true, delay: 0 } : null;
    const f = l.rt?.[areaId];
    if (!f) return null;
    const date = dayOf(schedMs);
    return f(Math.round((schedMs - T(date, 0)) / MIN), t);
  }

  /** Temps réel d'un voyage à son arrêt k (retard propagé à la suite du voyage) ; seulement à moins de 6 h de
   *  maintenant, comme le vrai cœur (le flux ne connaît pas la date). */
  function runRt(run: Run, k: number): TrainRt {
    if (Math.abs(run.stops[k].dep - now()) > 6 * 3_600_000) return { rt: false, delay: 0 };
    if (run.train) return trainRt(run.train, run.start);
    const r = run.line ? lineRt(run.line, run.stops[k].areaId, run.stops[k].dep) : null;
    return r ? { rt: true, delay: r.delay } : { rt: false, delay: 0 };
  }

  function departure(run: Run, k: number): Departure {
    const a = area(run.stops[k].areaId);
    const rt = runRt(run, k);
    const st = run.stops[k];
    if (run.train) {
      const np = rt.platformAt?.[a.id];
      const d: Departure = { op: 'sncb', mode: 'train', line: run.train.cat, head: run.train.head, sched: st.dep, est: st.dep + rt.delay * MIN, rt: rt.rt, delayMin: rt.delay, cancelled: !!rt.cancelled, tripId: run.id, stopSeq: k + 1 };
      if (st.platform) d.platform = st.platform;
      if (np && np !== st.platform && !rt.cancelled) d.newPlatform = np;
      return d;
    }
    const l = run.line!;
    const d: Departure = { op: l.op, mode: l.mode, line: l.line, head: l.head, sched: st.dep, est: st.dep + rt.delay * MIN, rt: rt.rt, delayMin: rt.delay, cancelled: false, tripId: run.id, stopSeq: k + 1 };
    if (st.platform) d.platform = st.platform;
    const msg = l.msg?.[a.id];
    if (msg && rt.rt) d.msg = msg;
    return d;
  }

  function departuresAt(areaId: string, from: number, limit: number, filter?: LineFilter[]): Departure[] {
    const out: Departure[] = [];
    for (const { run, k } of runsFrom(areaId, from - 2 * 3_600_000, from + HORIZON_MS)) {
      const head = run.train?.head ?? run.line!.head;
      const line = run.train?.cat ?? run.line!.line;
      if (!passes(filter, line, head)) continue;
      const d = departure(run, k);
      if (d.est < from - 30_000 && !(d.cancelled && d.sched >= from - 30_000)) continue;
      out.push(d);
    }
    return out.sort((x, y) => x.est - y.est || x.sched - y.sched).slice(0, limit);
  }

  /* --- trajets --- */

  function rideLeg(run: Run, k1: number, k2: number): Leg {
    const rt = runRt(run, k1);
    const shift = rt.delay * MIN;
    const fa = area(run.stops[k1].areaId);
    const ta = area(run.stops[k2].areaId);
    const a = run.stops[k1];
    const b = run.stops[k2];
    const stops: Stopover[] = [];
    for (let k = k1; k <= k2; k++) {
      const s = run.stops[k];
      const z = area(s.areaId);
      const sched = k === k1 ? s.dep : s.arr;
      const so: Stopover = { name: z.n, areaId: z.id, sched, est: sched + shift };
      const p = k === k1 ? (rt.platformAt?.[z.id] ?? s.platform) : s.platform;
      if (p) so.platform = p;
      stops.push(so);
    }
    const leg: Leg = {
      kind: 'ride',
      from: { name: fa.n, lat: fa.lat, lon: fa.lon, areaId: fa.id },
      to: { name: ta.n, lat: ta.lat, lon: ta.lon, areaId: ta.id },
      dep: a.dep + shift,
      arr: b.arr + shift,
      schedDep: a.dep,
      schedArr: b.arr,
      tripId: run.id,
      fromSeq: k1 + 1,
      toSeq: k2 + 1,
      fromStop: `${fa.id.slice(fa.id.indexOf(':') + 1)}${a.platform && run.train ? `_${a.platform}` : ''}`,
      toStop: `${ta.id.slice(ta.id.indexOf(':') + 1)}${b.platform && run.train ? `_${b.platform}` : ''}`,
      rt: rt.rt,
      delayMin: rt.delay,
      cancelled: !!rt.cancelled,
      stops,
    };
    if (run.train) {
      Object.assign(leg, { op: 'sncb', mode: 'train', line: run.train.cat, cat: run.train.cat, num: run.train.num, head: run.train.head });
      if (a.platform) leg.platform = a.platform;
      const np = rt.platformAt?.[fa.id];
      if (np && np !== a.platform) leg.newPlatform = np;
    } else {
      const l = run.line!;
      Object.assign(leg, { op: l.op, mode: l.mode, line: l.line, head: l.head });
      if (a.platform) leg.platform = a.platform;
    }
    return leg;
  }

  const walkLeg = (from: Pt, to: Pt, walkMin: number): Leg => ({
    kind: 'walk',
    from: { name: from.name, lat: from.lat, lon: from.lon, ...(from.areaId ? { areaId: from.areaId } : {}) },
    to: { name: to.name, lat: to.lat, lon: to.lon, ...(to.areaId ? { areaId: to.areaId } : {}) },
    dep: 0,
    arr: 0,
    schedDep: 0,
    schedArr: 0,
    walkMin,
  });

  function alertsFor(j: Journey, settings: Settings | null): Alert[] {
    const out: Alert[] = [];
    const a = settings?.alerts;
    const t = now();
    for (const l of j.legs) {
      if (l.kind !== 'ride') continue;
      const label = l.cat ?? l.line ?? '';
      if ((a?.platform ?? true) && l.newPlatform && !l.cancelled && t < l.dep) out.push({ kind: 'platform', text: platformAlert(label, l.newPlatform), at: t });
      if ((a?.delay ?? true) && !l.cancelled && (l.delayMin ?? 0) >= (a?.delayMin ?? 5) && t < l.arr) out.push({ kind: 'delay', text: delayAlert(label, hhmm(l.schedDep), l.delayMin ?? 0), at: t });
      if ((a?.cancel ?? true) && l.cancelled && t < l.schedArr) out.push({ kind: 'cancel', text: cancelAlert(label, hhmm(l.schedDep)), at: t });
    }
    const first = j.legs[0]?.kind === 'walk' ? j.legs[0] : undefined;
    const ride = j.legs.find((l) => l.kind === 'ride');
    if ((a?.leave ?? true) && first && ride && !ride.cancelled && t >= j.leaveAt && t < ride.dep) out.push({ kind: 'leave', text: leaveAlert(first.walkMin ?? 0), at: t });
    return out;
  }

  /** Heures des marches (la 1re se cale sur le 1er véhicule, marge comprise), départ conseillé, alertes. */
  function finish(legs: Leg[], settings: Settings | null, id: string, startAt?: number): Journey {
    const margin = (settings?.alerts.leaveBeforeMin ?? 2) * MIN;
    const firstRide = legs.find((l) => l.kind === 'ride');
    legs.forEach((l, i) => {
      if (l.kind !== 'walk') return;
      const w = (l.walkMin ?? 0) * MIN;
      if (i === 0) {
        const dep = firstRide ? firstRide.dep - w - margin : (startAt ?? now());
        const sched = firstRide ? firstRide.schedDep - w - margin : dep;
        Object.assign(l, { dep, arr: dep + w, schedDep: sched, schedArr: sched + w });
      } else {
        const prev = legs[i - 1];
        Object.assign(l, { dep: prev.arr, arr: prev.arr + w, schedDep: prev.schedArr, schedArr: prev.schedArr + w });
      }
    });
    const rides = legs.filter((l) => l.kind === 'ride');
    const walk0 = legs[0]?.kind === 'walk' ? (legs[0].walkMin ?? 0) * MIN : 0;
    const leaveAt = firstRide ? firstRide.dep - walk0 - margin : legs[0].dep;
    const j: Journey = { id, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt, transfers: Math.max(0, rides.length - 1), rt: rides.every((r) => r.rt), alerts: [] };
    j.alerts = alertsFor(j, settings);
    return j;
  }

  function resolve(e: Endpoint, settings: Settings, here?: LatLon | null): Pt | null {
    if (e.type === 'here') return here ? { ...here, name: N('Ma position', 'Mijn positie') } : null;
    if (e.type === 'area') return { lat: e.lat, lon: e.lon, name: e.name, areaId: AREA.has(e.areaId) ? e.areaId : undefined };
    if (e.type === 'address') return { lat: e.lat, lon: e.lon, name: N(e.label) };
    // 1.2 : un favori lieu
    const p = placeOf(settings, e.placeId);
    if (!p) throw new QuaiError('placeUnknown');
    return { lat: p.lat, lon: p.lon, name: N(p.label) };
  }

  /** Zones d'accès autour d'une extrémité : la zone elle-même (0 min, pas d'étape à pied ; au départ, aussi une
   *  zone à 50 m au plus), puis les zones à distance de marche. */
  function accessZones(p: Pt, maxMin: number, boarding: boolean): { a: AreaSummary; walk: number }[] {
    const out: { a: AreaSummary; walk: number }[] = [];
    for (const a of AREAS) {
      if (boarding && NO_DEPS.has(a.id)) continue;
      const d = distanceM(p, a);
      if (a.id === p.areaId || (boarding && d <= AT_STOP_M)) {
        out.push({ a, walk: 0 });
        continue;
      }
      const w = walkMinutes(d);
      if (w <= maxMin) out.push({ a, walk: w });
    }
    return out;
  }

  interface Cand {
    j: Journey;
    changes: number; // changements de véhicule (1.2 : une marche longue n'en est plus un)
    long: boolean; // marche longue : la marche maximale plus 5 min, ou davantage (PRD-1.2 § 1.2)
    walk: number;
    rides: number;
    firstDep: number;
    sig: string;
    keyRides: string;
  }

  function score(j: Journey, settings: Settings): Cand {
    const walks = j.legs.filter((l) => l.kind === 'walk').map((l) => l.walkMin ?? 0);
    const rides = j.legs.filter((l) => l.kind === 'ride');
    const sigOf = (l: Leg) => (l.kind === 'walk' ? 'w' : `${l.op}/${l.cat ?? l.line}/${l.from.areaId}/${l.to.areaId}`);
    return {
      j,
      changes: j.transfers,
      long: rides.length > 0 && walks.some((w) => w >= settings.maxWalkMin + 5),
      walk: walks.reduce((s, w) => s + w, 0),
      rides: rides.length,
      firstDep: rides[0]?.dep ?? j.dep,
      sig: j.legs.map(sigOf).join('|'),
      keyRides: rides.map((l) => `${l.tripId}:${l.fromSeq}:${l.toSeq}`).join('+') || `walk:${j.dep}`,
    };
  }

  /** Candidats : marche seule, un véhicule, ou deux avec une correspondance (attente de 60 min au plus). */
  function candidates(a: Pt, b: Pt, after: number, settings: Settings): Journey[] {
    const access = accessZones(a, a.areaId ? settings.maxWalkMin : 2 * settings.maxWalkMin, true);
    const egress = new Map(accessZones(b, b.areaId ? settings.maxWalkMin : 2 * settings.maxWalkMin, false).map((x) => [x.a.id, x.walk]));
    const out: Journey[] = [];
    const seen = new Set<string>();
    const push = (legs: Leg[]) => {
      const key = legs.map((l) => (l.kind === 'walk' ? `w${l.walkMin}` : `${l.tripId}:${l.fromSeq}:${l.toSeq}`)).join('|');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(finish(legs, settings, `fake:${key}`));
    };
    const ptOf = (z: AreaSummary): Pt => ({ lat: z.lat, lon: z.lon, name: z.n, areaId: z.id });
    for (const acc of access) {
      const t0 = after + acc.walk * MIN;
      for (const { run, k } of runsFrom(acc.a.id, t0, after + HORIZON_MS, 6)) {
        const tplKey = run.train?.key ?? run.line!.key;
        const first0 = acc.walk ? [walkLeg(a, ptOf(acc.a), acc.walk)] : [];
        for (let k2 = k + 1; k2 < run.stops.length; k2++) {
          const y = area(run.stops[k2].areaId);
          const ride1 = rideLeg(run, k, k2);
          const eg = egress.get(y.id);
          if (eg !== undefined) push([...first0, ride1, ...(eg ? [walkLeg(ptOf(y), b, eg)] : [])]);
          // Correspondance : même zone ou zone à 400 m au plus, premier départ de chaque autre ligne.
          for (const x of AREAS) {
            if (NO_DEPS.has(x.id)) continue;
            const same = x.id === y.id;
            const dxy = same ? 0 : distanceM(y, x);
            if (!same && dxy > 400) continue;
            const tw = same ? 0 : walkMinutes(dxy);
            const ready = ride1.arr + tw * MIN + TRANSFER_MS;
            for (const s of runsFrom(x.id, ready, ride1.arr + MAX_WAIT_MS, 1)) {
              const key2 = s.run.train?.key ?? s.run.line!.key;
              if (key2 === tplKey) continue;
              const head1 = run.train?.head.fr ?? run.line!.head.fr;
              const head2 = s.run.train?.head.fr ?? s.run.line!.head.fr;
              const sameLine = (s.run.line?.line ?? s.run.train?.cat) === (run.line?.line ?? run.train?.cat) && head1 === head2;
              if (sameLine) continue;
              for (let j2 = s.k + 1; j2 < s.run.stops.length; j2++) {
                const v = area(s.run.stops[j2].areaId);
                const ev = egress.get(v.id);
                if (ev === undefined) continue;
                const ride2 = rideLeg(s.run, s.k, j2);
                const between = same ? (run.train && s.run.train ? [] : [walkLeg(ptOf(y), ptOf(x), 1)]) : [walkLeg(ptOf(y), ptOf(x), tw)];
                push([...first0, ride1, ...between, ride2, ...(ev ? [walkLeg(ptOf(v), b, ev)] : [])]);
              }
            }
          }
        }
      }
    }
    return out;
  }

  /**
   * Classement simplifié de la 1.2 (docs/v1.2/PRD-1.2.md § 1, sur les heures estimées) : « Le plus court » (celui
   * que rien ne devance de 5 min à l'arrivée ; puis durée, changements, marche à 5 min près, arrivée, départ ; une
   * marche longue seulement pour 10 min de gagnées), puis « Plus tôt », « Moins de marche », « Sans changement » ou
   * « Moins de changements », « À pied », « Le suivant », « Plus tard » ; 3 au plus, avec la raison
   * (core/routing/reason.ts).
   */
  function rank(all: Journey[], walkOnly: Journey | null, settings: Settings, after: number): Journey[] {
    const t = now();
    const ok = all.filter((j) => {
      const first = j.legs.find((l) => l.kind === 'ride');
      const w0 = j.legs[0]?.kind === 'walk' ? (j.legs[0].walkMin ?? 0) * MIN : 0;
      if (j.legs.some((l) => l.kind === 'ride' && l.cancelled)) return false;
      if (first && first.dep - w0 < t - 30_000) return false;
      // Règle 1.0 : jamais plus lent que la marche seule, quand elle n'est pas une marche longue (cas E du PRD).
      if (walkOnly && (walkOnly.legs[0].walkMin ?? 0) < settings.maxWalkMin + 5 && j.arr > walkOnly.arr) return false;
      return true;
    });
    const scored = [...ok, ...(walkOnly ? [walkOnly] : [])].map((j) => score(j, settings));
    // Trajets dominés retirés : un autre part au plus tôt en même temps, arrive au plus tard en même temps, avec
    // autant de changements et de marche au plus.
    const dominated = (c: Cand) =>
      scored.some((d) => d !== c && d.j.dep >= c.j.dep && d.j.arr <= c.j.arr && d.changes <= c.changes && d.walk <= c.walk && (d.j.dep > c.j.dep || d.j.arr < c.j.arr || d.changes < c.changes || d.walk < c.walk));
    const pool = scored.filter((c) => !dominated(c));
    if (!pool.length) return [];
    // Départs dans l'heure demandée ; la nuit (rien dans l'heure), jusqu'à 90 min après le premier départ possible.
    const earliest = Math.min(...pool.map((c) => c.j.dep));
    const windowEnd = earliest <= after + 60 * MIN ? after + 60 * MIN : earliest + 90 * MIN;
    const win = pool.filter((c) => c.j.dep <= windowEnd);
    const night = earliest > after + 60 * MIN;
    const M5 = 5 * MIN;
    const isWalk = (c: Cand) => c.rides === 0;
    // § 1.1 : un trajet en devance un autre s'il arrive au moins 5 min plus tôt (la nuit, sans partir plus de 30 min
    // avant lui) ; parmi ceux que rien ne devance : durée, changements, marche (à 5 min près), arrivée, départ.
    const beats = (d: Cand, c: Cand) => d.j.arr <= c.j.arr - M5 && (!night || d.j.dep >= c.j.dep - 30 * MIN);
    const order = (x: Cand, y: Cand) => {
      const dx = x.j.arr - x.j.dep;
      const dy = y.j.arr - y.j.dep;
      if (Math.abs(dx - dy) >= M5) return dx - dy;
      if (x.changes !== y.changes) return x.changes - y.changes;
      if (Math.abs(x.walk - y.walk) >= 5) return x.walk - y.walk;
      return x.j.arr - y.j.arr || y.j.dep - x.j.dep;
    };
    const shortest = (list: Cand[]): Cand | undefined => list.filter((c) => !list.some((d) => d !== c && beats(d, c))).sort(order)[0];
    // § 1.2 : une marche longue n'est « Le plus court » que pour arriver au moins 10 min avant le plus court sans
    // marche longue
    const best = shortest(win)!;
    const plain = shortest(win.filter((c) => !c.long));
    const simple = best.long && plain && best.j.arr > plain.j.arr - 10 * MIN ? plain : best;
    const props: { c: Cand; label: JourneyLabel }[] = [{ c: simple, label: 'short' }];
    const used = new Set([simple.keyRides]);
    const add = (c: Cand | undefined, label: JourneyLabel) => {
      if (!c || props.length >= 3 || used.has(c.keyRides)) return;
      used.add(c.keyRides);
      props.push({ c, label });
    };
    // § 1.3, dans l'ordre : Plus tôt, Moins de marche, Sans changement ou Moins de changements, À pied, Le suivant, Plus tard
    const first = win.filter((c) => !isWalk(c)).sort((x, y) => x.j.arr - y.j.arr || order(x, y))[0];
    if (first && first.j.arr <= simple.j.arr - M5) add(first, 'earlier');
    if (simple.long) {
      add(shortest(win.filter((c) => !c.long && !isWalk(c) && c !== simple && c.walk <= simple.walk - 5 && c.j.arr <= simple.j.arr + 20 * MIN)), 'lesswalk');
    }
    const fewer = shortest(
      win.filter((c) => !isWalk(c) && c.changes < simple.changes && c.j.arr <= simple.j.arr + 20 * MIN && (!c.long || c.j.arr <= simple.j.arr || simple.long)),
    );
    if (fewer) add(fewer, fewer.changes === 0 ? 'none' : 'fewer');
    if (walkOnly && !isWalk(simple)) {
      const w = pool.find(isWalk);
      if (w && w.walk <= 30 && w.j.arr <= simple.j.arr + 5 * MIN) add(w, 'walk');
    }
    let ref = simple;
    while (props.length < 3 && !isWalk(simple)) {
      const nx = pool.filter((c) => c.sig === ref.sig && c.firstDep > ref.firstDep && c.firstDep <= simple.firstDep + 2 * 3_600_000 && !used.has(c.keyRides)).sort((x, y) => x.firstDep - y.firstDep)[0];
      if (!nx) break;
      add(nx, 'next');
      ref = nx;
    }
    if (props.length < 3) {
      // « Plus tard » : un autre trajet, sans reprendre un véhicule déjà proposé.
      const trips = (c: Cand) => c.keyRides.split('+').map((r) => r.split(':')[0]);
      const rides = new Set(props.flatMap((p) => trips(p.c)));
      // jamais un trajet devancé de plus de 30 min par un trajet parti au plus 30 min avant (1.1)
      const outrun = (c: Cand) => pool.some((d) => d.j.arr <= c.j.arr - 30 * MIN && d.j.dep >= c.j.dep - 30 * MIN);
      const later = pool
        .filter((c) => !isWalk(c) && !used.has(c.keyRides) && !trips(c).some((r) => rides.has(r)) && c.firstDep > simple.firstDep && c.j.arr > simple.j.arr && c.firstDep <= simple.firstDep + 2 * 3_600_000 && !outrun(c))
        .sort((x, y) => x.changes - y.changes || x.j.arr - y.j.arr || x.walk - y.walk);
      for (const c of later) add(c, 'later');
    }
    const out = props.map(({ c, label }) => ({ ...c.j, label }));
    out.forEach((j, i) => {
      let r: Journey | undefined;
      if (j.label === 'next') for (let k = i - 1; k >= 0 && !r; k--) if (out[k].label === 'next' || out[k].label === 'short') r = out[k];
      j.reason = reasonText(j.label!, j, r);
    });
    return out;
  }

  async function route(from: Endpoint, to: Endpoint, after: number, settings: Settings, here?: LatLon | null): Promise<PlanResult> {
    touchRt();
    const a = resolve(from, settings, here);
    const b = resolve(to, settings, here);
    if (!a || !b) return { journeys: [], empty: 'noPosition' };
    const d = distanceM(a, b);
    if (d <= NEAR_HERE_M) return { journeys: [], empty: 'here' };
    const accessMin = 2 * settings.maxWalkMin;
    const walkMin = walkMinutes(d);
    const walkOnly = walkMin <= 30 ? finish([walkLeg(a, b, walkMin)], settings, `fake:walk:${walkMin}`, Math.max(after, now())) : null;
    const hasFrom = accessZones(a, a.areaId ? settings.maxWalkMin : accessMin, true).length > 0;
    const hasTo = accessZones(b, b.areaId ? settings.maxWalkMin : accessMin, false).length > 0;
    if (!walkOnly && !hasFrom) return { journeys: [], empty: 'noStopFrom', accessMin };
    if (!walkOnly && !hasTo) return { journeys: [], empty: 'noStopTo', accessMin };
    const journeys = rank(hasFrom && hasTo ? candidates(a, b, after, settings) : [], walkOnly, settings, after);
    if (journeys.length) return { journeys };
    const st = AREAS.filter((z) => z.op === 'sncb')
      .map((z) => ({ z, d: distanceM(b, z) }))
      .sort((x, y) => x.d - y.d)[0];
    const out: PlanResult = { journeys: [], empty: 'noTrip' };
    if (st && st.d <= 10_000) out.station = { areaId: st.z.id, name: st.z.n, lat: st.z.lat, lon: st.z.lon };
    return out;
  }

  /** Trains entre deux gares : directs, sinon avec une correspondance (1.0). */
  function trainsBetween(fromId: string, toId: string, after: number, limit: number): Journey[] {
    touchRt();
    const out: Journey[] = [];
    for (const { run, k } of runsFrom(fromId, after, after + HORIZON_MS)) {
      if (!run.train) continue;
      const k2 = run.stops.findIndex((s, i) => i > k && s.areaId === toId);
      if (k2 < 0) continue;
      out.push(finish([rideLeg(run, k, k2)], null, `fake:${run.id}:${fromId}>${toId}`));
      if (out.length >= limit) break;
    }
    if (out.length) return out;
    const pt = (id: string): Pt => {
      const z = area(id);
      return { lat: z.lat, lon: z.lon, name: z.n, areaId: z.id };
    };
    return candidates(pt(fromId), pt(toId), after, DEFAULT_SETTINGS)
      .filter((j) => j.legs.every((l) => l.kind === 'ride' && l.op === 'sncb') && j.legs[0].from.areaId === fromId && j.legs[j.legs.length - 1].to.areaId === toId)
      .sort((x, y) => x.arr - y.arr || x.dep - y.dep)
      .filter((j, i, xs) => xs.findIndex((o) => o.dep === j.dep) === i)
      .sort((x, y) => x.dep - y.dep)
      .slice(0, limit);
  }

  const core: Core = {
    async init() {
      const t = now();
      const date = dayOf(flags.stale ? t - 3 * 86_400_000 : t);
      const gen = T(date, 3 * 60 + 12);
      meta = {
        v: 1,
        generatedAt: new Date(gen).toISOString(),
        timezone: 'Europe/Brussels',
        serviceDates: [date, nextDate(date)],
        tile: { lat: 0.02, lon: 0.03 },
        feeds: {
          sncb: { ok: true, areas: 16, trips: 140 },
          stib: { ok: true, areas: 10, trips: 900 },
          delijn: { ok: true, areas: 7, trips: 300 },
          tec: { ok: true, areas: 9, trips: 220 },
        },
        lines: { files: 16, ops: ['stib', 'delijn', 'tec'], conn: 400 },
      };
      return meta;
    },
    get meta() {
      return meta;
    },
    async nearby(lat, lon, radiusM, o) {
      const t = now();
      if (!o?.light) touchRt();
      const out: NearbyItem[] = [];
      for (const a of AREAS) {
        if (NO_DEPS.has(a.id)) continue;
        const d = distanceM({ lat, lon }, a);
        if (d > radiusM) continue;
        const item: NearbyItem = { area: a, distanceM: Math.round(d / 10) * 10, walkMin: walkMinutes(d) };
        if (!o?.light) {
          const next = departuresAt(a.id, t, 4).find((x) => !x.cancelled && x.est >= t - 30_000);
          if (next) item.next = next;
        }
        out.push(item);
      }
      return out.sort((x, y) => x.distanceM - y.distanceM);
    },
    async board(areaId, o = {}) {
      touchRt();
      const a = area(areaId);
      const deps = departuresAt(a.id, now(), o.limit ?? 8, o.filter);
      return { area: a, departures: deps, anyPlanned: deps.some((d) => !d.rt), rtErrors: live() ? [] : [a.op], updatedAt: now() } satisfies Board;
    },
    async linesAt(areaId) {
      const a = area(areaId);
      const seen = new Map<string, { line: string; mode: Mode; head: Names; filter: LineFilter }>();
      const add = (line: string, mode: Mode, head: Names): void => {
        const f = { line, head: normalizeForSearch(prettyName(head.fr)) };
        seen.set(`${line}|${f.head}`, { line, mode, head, filter: f });
      };
      for (const t of TRAINS) if (t.stops.some((s, i) => s[0] === a.id && i < t.stops.length - 1)) add(t.cat, 'train', t.head);
      for (const l of LINES) if (l.stops.some((s, i) => s[0] === a.id && i < l.stops.length - 1)) add(l.line, l.mode, l.head);
      return [...seen.values()].sort((x, y) => x.line.localeCompare(y.line, 'fr', { numeric: true }) || x.head.fr.localeCompare(y.head.fr));
    },
    async search(query, near) {
      // Même classement que le vrai cœur (core/search.ts : noms usuels, mot exact, mode, homonymes).
      if (normalizeForSearch(query).replace(/ /g, '').length < 2) return [];
      const items = AREAS.filter((a) => !NO_DEPS.has(a.id)).map((a) => ({ id: a.id, op: a.op, n: a.n, modes: a.modes, lat: a.lat, lon: a.lon }));
      return rankSearch({ v: 1, items }, query, near);
    },
    async trains(fromAreaId, toAreaId, after, limit = 3) {
      area(fromAreaId);
      area(toAreaId);
      return trainsBetween(fromAreaId, toAreaId, after, limit);
    },
    route,
    /** 1.0, gardé : les propositions de route(), comme le vrai cœur. */
    async plan(from, to, after, settings, here) {
      return (await route(from, to, after, settings, here)).journeys;
    },
    async refresh(j, settings) {
      touchRt();
      const legs = j.legs.map((l): Leg => {
        if (l.kind !== 'ride' || !l.tripId) return { ...l };
        const run = runById(l.tripId);
        if (!run) return { ...l };
        return rideLeg(run, (l.fromSeq ?? 1) - 1, (l.toSeq ?? run.stops.length) - 1);
      });
      const out = finish(legs, settings, j.id);
      if (j.label) out.label = j.label;
      if (j.reason) out.reason = j.reason;
      return out;
    },
    async suggest(here, settings) {
      const t = now();
      if (here) {
        for (const f of settings.favorites) {
          if (f.kind !== 'stop' || f.propose !== 'near') continue;
          if (distanceM(here, f) <= 300) {
            const board = await core.board(f.areaId, { limit: settings.display.depsPerStop, filter: f.filter });
            return { kind: 'favoriteStop', favoriteId: f.id, autoOpen: true, title: `${f.name.fr}${NB}: prochain départ`, board } satisfies Suggestion;
          }
        }
      }
      const m = localMinutes(t);
      const slot = m >= 5 * 60 && m < 11 * 60 ? 'morning' : m >= 15 * 60 && m < 21 * 60 ? 'evening' : null;
      if (!slot) return null;
      for (const f of settings.favorites) {
        if (f.propose !== slot) continue;
        if (f.kind === 'trip' || f.kind === 'place') {
          // un lieu : le trajet « Ma position → lieu »
          const tr = asTrip(f);
          const js = await core.plan(tr.from, tr.to, t, settings, here ?? undefined).catch(() => [] as Journey[]);
          const j = js[0];
          const ride = j?.legs.find((l) => l.kind === 'ride');
          if (!j || !ride) continue;
          const p = ride.newPlatform ?? ride.platform;
          const walk = j.legs[0]?.kind === 'walk' ? j.legs[0].walkMin ?? 0 : 0;
          return {
            kind: 'favoriteTrip',
            favoriteId: f.id,
            autoOpen: false,
            title: `${forLabel(tripLabel(f, settings))}${NB}: ${ride.cat ?? ride.line} ${hhmm(ride.dep)}${p ? `, voie ${p}` : ''}`,
            subtitle: walk ? `partir à ${hhmm(j.leaveAt)}, ${walk}${NB}min à pied` : undefined,
            journey: j,
          };
        }
        const board = await core.board(f.areaId, { limit: 1, filter: f.filter });
        const d = board.departures[0];
        if (d) return { kind: 'favoriteStop', favoriteId: f.id, autoOpen: false, title: `${f.name.fr}${NB}: ${d.line} ${hhmm(d.est)}`, board };
      }
      return null;
    },
    async works(op, routes) {
      if (op === 'tec' && routes.some((r) => r === '51' || r === 'N51')) return ['Ligne 51 déviée rue de Fer'];
      return [];
    },

    orderFavorites(here, settings, last) {
      return orderFavorites(here, settings, now(), last);
    },

    answer(fav, here, settings) {
      return answerFavorite(fav, here, settings, {
        now,
        board: (id, o) => core.board(id, o),
        route,
        relocate: async (f: FavoriteStop) => relocateAmong(f, AREAS.filter((a) => distanceM(f, a) <= 1_000)),
        refresh: (js, s) => Promise.all(js.map((j) => core.refresh(j, s))),
        generation: async () => meta?.generatedAt,
        plans,
      });
    },

    geocode(q, lang, near) {
      return geo.geocode(q, lang, near);
    },

    status(): CoreStatus {
      if (rtState.rt === 'unknown') return rtState;
      const s: CoreStatus['rt'] = flags.offline ? 'offline' : flags.noRt ? 'down' : 'ok';
      if (rtState.rt !== s) rtState = { rt: s, since: now() };
      return { ...rtState };
    },

    async health(): Promise<HealthResponse> {
      const ok = live();
      const src = { ok, ms: 120, ...(ok ? {} : { error: 'Portail injoignable (503)' }) };
      const geoOk = !flags.offline && flags.geo !== 'down';
      const gs = { ok: geoOk, ms: 90, ...(geoOk ? {} : { error: 'Service indisponible' }) };
      return {
        ok,
        time: new Date(now()).toISOString(),
        data: meta ? { generatedAt: meta.generatedAt, ok: true, feeds: meta.feeds } : undefined,
        sources: { sncb: src, stib: src, delijn: src, tec: src },
        geocode: { vla: gs, bru: gs, wal: gs },
        version: '1.1.0',
      };
    },
  };
  const geo = new GeocodeClient(fakeGeoTransport(flags, now), now);
  return core;
}

/** Même signature que le vrai cœur (app/src/core/index.ts). */
export function createCore(opts: CoreOptions): Core {
  return createFakeCore(opts);
}

/** Fraîcheur des données (même contrat que dataFreshness du vrai cœur). */
export function dataFreshness(meta: Meta, now: number): { ok: boolean; ageHours: number; message?: string } {
  const gen = Date.parse(meta.generatedAt);
  const ageHours = Math.round(((now - gen) / 3_600_000) * 10) / 10;
  const today = localDate(now);
  if (!meta.serviceDates.includes(today)) {
    const d = meta.serviceDates[0] ?? '';
    return { ok: false, ageHours, message: `Horaires périmés${NB}: mise à jour arrêtée le ${d.slice(8, 10)}/${d.slice(5, 7)}` };
  }
  return { ok: true, ageHours };
}
