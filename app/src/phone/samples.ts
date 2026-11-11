/**
 * Données d'exemple des aperçus (maquettes Config4 et Config5) : l'accueil des lunettes avec ses favoris à 07:31 à
 * Namur (T5), et le trajet du matin vers le bureau avec changement de voie.
 * Rendu par les vraies vues des lunettes.
 */
import type { Departure, Favorite, FavoriteAnswer, Journey, Settings } from '../core/api';
import { delayAlert, leaveAlert, platformAlert } from '../core/text';
import { gtfsTime } from '../core/util';
import type { AreaSummary, Mode, Names, Op } from '../../../shared/types';
import { homeView, stepsView, type FavoriteEntry } from '../glasses/views';
import type { GlassesView } from '../glasses/types';

const DAY = '2026-11-10';
const at = (hh: number, mm: number): number => gtfsTime(DAY, hh * 60 + mm);
const n = (fr: string, nl = fr): Names => ({ fr, nl });
const area = (id: string, op: Op, fr: string, nl: string, modes: Mode[], lat: number, lon: number): AreaSummary => ({ id, op, n: { fr, nl }, lat, lon, modes, lines: [] });
const dep = (op: Op, mode: Mode, line: string, head: Names, t: number, rt: boolean, platform?: string): Departure => ({ op, mode, line, head, sched: t, est: t, rt, delayMin: 0, cancelled: false, platform });

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
const GDN = area('stib:6357F', 'stib', 'Gare du Nord', 'Noordstation', ['tram'], 50.86, 4.36);
const train = (t: number, opts: Partial<Departure>): Departure => ({ op: 'sncb', mode: 'train', line: 'IC', head: n('Bruxelles-Midi', 'Brussel-Zuid'), sched: t, est: t, rt: true, delayMin: 0, cancelled: false, platform: '4', ...opts });

/** Favoris d'exemple, dans l'ordre du téléphone : l'ordre intelligent met le bureau en tête le matin. */
const SAMPLE_FAVORITES: Favorite[] = [
  { kind: 'stop', id: 'ex-gdn', areaId: GDN.id, op: 'stib', name: GDN.n, lat: GDN.lat, lon: GDN.lon, propose: 'never' },
  { kind: 'trip', id: 'ex-bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'ex-lieu-bureau' }, propose: 'morning' },
  { kind: 'stop', id: 'ex-namur', areaId: NAMUR.id, op: 'sncb', name: NAMUR.n, lat: NAMUR.lat, lon: NAMUR.lon, propose: 'never' },
];

function sampleAnswers(): Map<string, FavoriteAnswer> {
  const j = morningJourney(true, true);
  const board = (a: AreaSummary, departures: Departure[]) => ({ area: a, departures, anyPlanned: departures.some((d) => !d.rt), rtErrors: [], updatedAt: HOME_NOW });
  return new Map<string, FavoriteAnswer>([
    ['ex-bureau', { favoriteId: 'ex-bureau', kind: 'trip', state: 'ok', plan: { journeys: [{ ...j, label: 'simple' }] }, updatedAt: HOME_NOW }],
    ['ex-namur', { favoriteId: 'ex-namur', kind: 'stop', state: 'ok', board: board(NAMUR, [train(at(7, 42), { est: at(7, 44), delayMin: 2, newPlatform: '6' }), train(at(8, 42), { rt: false })]), updatedAt: HOME_NOW }],
    ['ex-gdn', { favoriteId: 'ex-gdn', kind: 'stop', state: 'ok', board: board(GDN, [dep('stib', 'tram', '3', n('Churchill'), at(7, 37), true), dep('stib', 'tram', '4', n('Stalle (P)'), at(7, 40), true)]), updatedAt: HOME_NOW }],
  ]);
}

/**
 * Aperçu « Affichage » (T5) : l'accueil des lunettes avec ses favoris, selon les réglages (« À l’ouverture de Quai »,
 * « Ordre des favoris », rayon, aides, signe ~). Exemple : 07:31 à la maison, à Namur.
 */
export function homePreview(settings: Settings): GlassesView {
  const s: Settings = {
    ...settings,
    places: [{ id: 'ex-lieu-bureau', label: 'Bureau', lat: 50.8441, lon: 4.3474 }],
    favorites: SAMPLE_FAVORITES,
  };
  const answers = sampleAnswers();
  // Ordre intelligent le matin : le trajet du bureau (créneau), puis la gare de Namur (utilisable d'ici).
  const smart = ['ex-bureau', 'ex-namur', 'ex-gdn'];
  const order = settings.display.favOrder === 'mine' ? SAMPLE_FAVORITES.map((f) => f.id) : smart;
  const entries: FavoriteEntry[] = order.map((id) => ({ fav: SAMPLE_FAVORITES.find((f) => f.id === id)!, answer: answers.get(id) }));
  const nearbyCount = settings.display.radiusM <= 300 ? 2 : settings.display.radiusM <= 500 ? 3 : 4;
  return homeView({ favorites: entries.slice(0, 2), order, others: entries.length - 2, noFavorites: settings.display.opening === 'home', nearbyCount }, { now: HOME_NOW, settings: s });
}
