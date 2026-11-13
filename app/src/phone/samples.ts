/**
 * Données d'exemple des aperçus (maquettes Config4 et Config5) : l'accueil des lunettes avec ses favoris à 07:31 à
 * Namur (T5), et le trajet du matin vers le bureau avec changement de voie. Rendu par les vraies vues des lunettes.
 * 1.2.2 : réglages v4, les arrêts favoris de l'exemple rangés dans `stations` (Namur) et `lines` (tram 3 à Gare du
 * Nord) ; des gares, des arrêts et des lieux publics seulement.
 */
import type { Favorite, FavoriteAnswer, Journey, LinePick, Settings, StationPick } from '../core/api';
import type { LineFollow } from '../core/linerun';
import { delayAlert, leaveAlert, platformAlert } from '../core/text';
import { gtfsTime } from '../core/util';
import type { AreaSummary, Mode, Names, Op } from '../../../shared/types';
import { homeView, stepsView, type FavoriteEntry } from '../glasses/views';
import type { GlassesView } from '../glasses/types';

const DAY = '2026-11-10';
const at = (hh: number, mm: number): number => gtfsTime(DAY, hh * 60 + mm);
const n = (fr: string, nl = fr): Names => ({ fr, nl });
const area = (id: string, op: Op, fr: string, nl: string, modes: Mode[], lat: number, lon: number): AreaSummary => ({ id, op, n: { fr, nl }, lat, lon, modes, lines: [] });

/** Trajet du matin vers le bureau : marche, IC de 07:42 (+2 min, voie 6 si `platform`), marche jusqu'au bureau. */
function morningJourney(platform: boolean, rt: boolean): Journey {
  return {
    id: 'exemple',
    dep: at(7, 35),
    arr: at(9, 0),
    leaveAt: at(7, 35),
    transfers: 0,
    rt,
    alerts: [],
    legs: [
      { kind: 'walk', from: { name: n('Maison'), lat: 0, lon: 0 }, to: { name: n('Namur', 'Namen'), lat: 0, lon: 0 }, dep: at(7, 35), arr: at(7, 42), schedDep: at(7, 35), schedArr: at(7, 42), walkMin: 7 },
      {
        kind: 'ride',
        from: { name: n('Namur', 'Namen'), lat: 0, lon: 0 },
        to: { name: n('Bruxelles-Central', 'Brussel-Centraal'), lat: 0, lon: 0 },
        dep: at(7, 44),
        arr: at(8, 48),
        schedDep: at(7, 42),
        schedArr: at(8, 46),
        op: 'sncb',
        mode: 'train',
        line: 'IC',
        cat: 'IC',
        head: n('Bruxelles-Midi', 'Brussel-Zuid'),
        platform: '4',
        newPlatform: platform ? '6' : undefined,
        rt,
        delayMin: 2,
      },
      { kind: 'walk', from: { name: n('Bruxelles-Central'), lat: 0, lon: 0 }, to: { name: n('Bureau'), lat: 0, lon: 0 }, dep: at(8, 48), arr: at(9, 0), schedDep: at(8, 46), schedArr: at(8, 58), walkMin: 12 },
    ],
  };
}

/** Trajet d'exemple vers le bureau ; alerte choisie selon les réglages. */
export function alertsPreview(settings: Settings): GlassesView {
  const now = at(7, 37);
  const a = settings.alerts;
  // Textes des alertes du cœur (mêmes mots que pendant un vrai trajet).
  const text = a.platform ? platformAlert('IC', '6') : a.delay && 2 >= a.delayMin ? delayAlert('IC', '07:42', 2) : a.leave ? leaveAlert(7) : undefined;
  const j: Journey = { ...morningJourney(a.platform, true), alerts: text ? [{ kind: 'platform', text, at: now }] : [] };
  return stepsView({ label: 'bureau', title: 'Vers le bureau', leaveAt0: at(7, 33) }, j, { now, settings });
}

/* ------------------------------ Accueil avec ses favoris (T5) ------------------------------ */

const HOME_NOW = at(7, 31);
const NAMUR = area('sncb:8863008', 'sncb', 'Namur', 'Namen', ['train'], 50.4685, 4.8625);
const CENTRAL = area('sncb:8813003', 'sncb', 'Bruxelles-Central', 'Brussel-Centraal', ['train'], 50.8454, 4.3571);
const GAND = area('sncb:8892007', 'sncb', 'Gand-Saint-Pierre', 'Gent-Sint-Pieters', ['train'], 51.0359, 3.7107);
const MONS = area('sncb:8881000', 'sncb', 'Mons', 'Bergen', ['train'], 50.4532, 3.9425);
const GDN = area('stib:6357F', 'stib', 'Gare du Nord', 'Noordstation', ['tram'], 50.86, 4.36);
const station = (a: AreaSummary) => ({ type: 'area' as const, areaId: a.id, op: a.op, name: a.n, lat: a.lat, lon: a.lon });

/**
 * Favoris d'exemple, dans l'ordre du téléphone : un lieu (Bureau) et deux trajets fixes entre des gares. L'ordre
 * intelligent met le bureau (créneau du matin) en tête, puis le trajet qui part de Namur (utilisable d'ici).
 */
const SAMPLE_FAVORITES: Favorite[] = [
  { kind: 'trip', id: 'ex-gand', from: station(CENTRAL), to: station(GAND), propose: 'never' },
  { kind: 'place', id: 'ex-bureau', label: 'Bureau', lat: 50.8441, lon: 4.3474, propose: 'morning' },
  { kind: 'trip', id: 'ex-mons', from: station(NAMUR), to: station(MONS), propose: 'never' },
];
/** Gares et lignes d'exemple (PRD-1.2.2 § 2, § 3) : les anciens arrêts favoris de l'exemple. */
const SAMPLE_STATIONS: StationPick[] = [{ id: 'ex-namur', areaId: NAMUR.id, name: NAMUR.n, lat: NAMUR.lat, lon: NAMUR.lon }];
/** 1.2.6 : un arrêt (toutes ses lignes) et une ligne suivie, sans arrêt. */
const SAMPLE_LINES: LinePick[] = [{ id: 'ex-gdn', areaId: GDN.id, op: 'stib', name: GDN.n, lat: GDN.lat, lon: GDN.lon }];
const SAMPLE_FOLLOWS: LineFollow[] = [{ id: 'ex-t3', op: 'stib', mode: 'tram', line: '3', routes: [] }];

/** Un train entre deux gares, sans marche (`walk` : minutes à pied jusqu'à la gare de départ). */
function trainJourney(id: string, from: AreaSummary, to: AreaSummary, dep: number, arr: number, walk = 0): Journey {
  const ride: Journey['legs'][number] = { kind: 'ride', from: { name: from.n, lat: 0, lon: 0 }, to: { name: to.n, lat: 0, lon: 0 }, dep, arr, schedDep: dep, schedArr: arr, op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: to.n, platform: '3', rt: true, delayMin: 0 };
  const start = dep - walk * 60_000;
  const legs: Journey['legs'] = walk ? [{ kind: 'walk', from: { name: n('Maison'), lat: 0, lon: 0 }, to: { name: from.n, lat: 0, lon: 0 }, dep: start, arr: dep, schedDep: start, schedArr: dep, walkMin: walk }, ride] : [ride];
  return { id, dep: start, arr, leaveAt: start - 2 * 60_000, transfers: 0, rt: true, alerts: [], legs, label: 'short' };
}

function sampleAnswers(): Map<string, FavoriteAnswer> {
  const j = morningJourney(true, true);
  return new Map<string, FavoriteAnswer>([
    ['ex-bureau', { favoriteId: 'ex-bureau', kind: 'trip', state: 'ok', plan: { journeys: [{ ...j, label: 'short' }] }, updatedAt: HOME_NOW }],
    ['ex-mons', { favoriteId: 'ex-mons', kind: 'trip', state: 'ok', plan: { journeys: [trainJourney('ex-mons', NAMUR, MONS, at(7, 54), at(9, 4), 7)] }, updatedAt: HOME_NOW }],
    ['ex-gand', { favoriteId: 'ex-gand', kind: 'trip', state: 'ok', fromStation: true, plan: { journeys: [trainJourney('ex-gand', CENTRAL, GAND, at(8, 58), at(9, 30))] }, updatedAt: HOME_NOW }],
  ]);
}

/** Réglages de l'aperçu : ceux du téléphone, avec les favoris, les gares et les lignes de l'exemple. */
export function sampleSettings(settings: Settings): Settings {
  return { ...settings, favorites: SAMPLE_FAVORITES, stations: SAMPLE_STATIONS, lines: SAMPLE_LINES, follows: SAMPLE_FOLLOWS };
}

/**
 * Aperçu « Affichage » (T5) : l'accueil des lunettes avec ses favoris, selon les réglages (« À l’ouverture de Quai »,
 * « Ordre des favoris », rayon, aides, signe ~). Exemple : 07:31 à la maison, à Namur. 1.2.1 (PRD-1.2.1 § 4) : les 3
 * favoris d'exemple sous « Favoris », une ligne chacun, dans l'ordre réglé ; l'accueil n'en montre pas plus que sa
 * place ne le permet. 1.2.6 : une gare, un arrêt et une ligne (« Gares de train », « Arrêts… », « Lignes… »).
 */
export function homePreview(settings: Settings): GlassesView {
  const s = sampleSettings(settings);
  const answers = sampleAnswers();
  // Ordre intelligent le matin : le bureau (créneau), le trajet depuis Namur (utilisable d'ici), puis le reste.
  const smart = ['ex-bureau', 'ex-mons', 'ex-gand'];
  const order = settings.display.favOrder === 'mine' ? SAMPLE_FAVORITES.map((f) => f.id) : smart;
  const entries: FavoriteEntry[] = order.map((id) => ({ fav: SAMPLE_FAVORITES.find((f) => f.id === id)!, answer: answers.get(id) }));
  const nearbyCount = settings.display.radiusM <= 300 ? 2 : settings.display.radiusM <= 500 ? 3 : 4;
  return homeView({ favorites: entries, order, noFavorites: settings.display.opening === 'home', nearbyCount }, { now: HOME_NOW, settings: s });
}
