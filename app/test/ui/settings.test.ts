import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Favorite, type FavoriteStop, type LinePick, type Settings, type StationPick } from '../../src/core/api';
import type { LineFollow } from '../../src/core/linerun';
import {
  clampInt,
  CURRENT_VERSION,
  LIMITS,
  loadSettings,
  migrateSettings,
  moveStops,
  newId,
  parseSettings,
  saveSettings,
  SETTINGS_BACKUP_125_KEY,
  SETTINGS_BACKUP_KEY,
  SETTINGS_KEY,
  SettingsStore,
  validateSettings,
  versionOf,
} from '../../src/settings';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { REPO_DIR } from '../core/support/network';

const PRESET_PATH = join(REPO_DIR, 'fixtures', 'app', 'preset.json');
const PRESET_11_PATH = join(REPO_DIR, 'fixtures', 'app', 'preset-1.1.json');

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
/** CA-2.1 : un lieu sans trajet ajouté au préréglage, « École ». */
const withSchool = <T extends { places: unknown[] }>(raw: T): T => ({ ...raw, places: [...raw.places, { id: 'ecole', label: 'École', lat: 50.85, lon: 4.35 }] });

/** Arrêts du préréglage (fixtures/app) rangés par la 1.2.2 : « Namur » en gare ; tram 3 et tram 4 à « Gare du Nord »
 *  (ouverts d'office à moins de 300 m), « Bruxelles-Nord, bus De Lijn » toutes lignes, en lignes. */
const PRESET_STATIONS: StationPick[] = [{ id: 'fav-namur', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 }];
const GDN = { areaId: 'stib:6357F', op: 'stib' as const, name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017 };
const PRESET_LINES: LinePick[] = [
  { id: 'fav-dl-nord', areaId: 'delijn:308611', op: 'delijn', name: { fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' }, lat: 50.86183, lon: 4.35906 },
];
/** 1.2.6 (PRD-1.2.6 § 4) : tram 3 et tram 4 gardés à « Gare du Nord » deviennent des lignes suivies, l'arrêt en repère. */
const VIA_GDN = { areaId: GDN.areaId, name: GDN.name, lat: GDN.lat, lon: GDN.lon };
const PRESET_FOLLOWS: LineFollow[] = [
  { id: 'f-fav-gdn-3', op: 'stib', line: '3', routes: [], via: VIA_GDN, near: true },
  { id: 'f-fav-gdn-4', op: 'stib', line: '4', routes: [], via: VIA_GDN, near: true },
];
/** Une seconde lecture (validation, migration, JSON) ne change rien. */
const stable = (s: Settings) => {
  expect(parseSettings(JSON.stringify(s))).toEqual(s);
  expect(validateSettings(s)).toEqual(s);
  expect(migrateSettings(s)).toEqual(s);
};

describe('réglages : migration de la 1.1 et de la 1.0 (PRD-1.2 § 2.4, puis PRD-1.2.2 § 5)', () => {
  it('CA-2.1 préréglage 1.1 : lieux fusionnés, « École » en fin ; arrêts rangés en gares et lignes ; seconde lecture identique', () => {
    const raw = withSchool(read(PRESET_11_PATH));
    const s = migrateSettings(raw);
    expect(s.v).toBe(4);
    expect('places' in s).toBe(false);
    expect(s.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gand', 'fav-maison', 'ecole']);
    // « Ma position → lieu » : le lieu prend la place, l'identifiant, le nom et le créneau du trajet ;
    // « Adresse à vérifier » (lieu de la 1.0 sans src) gardé
    expect(s.favorites[0]).toEqual({ kind: 'place', id: 'fav-bureau', label: 'Bureau', lat: 50.8441, lon: 4.3474, address: 'Bruxelles', propose: 'morning' });
    expect(s.favorites[2]).toEqual({ kind: 'place', id: 'fav-maison', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Namur', propose: 'evening' });
    expect(s.favorites[3]).toEqual({ kind: 'place', id: 'ecole', label: 'École', lat: 50.85, lon: 4.35, propose: 'never' });
    // trajet fixe inchangé ; arrêts (CA-122.6) : dans leur rubrique, ouverture d'office gardée, rien de perdu ni doublé
    expect(s.favorites[1]).toEqual(raw.favorites[2]);
    expect(s.stations).toEqual(PRESET_STATIONS);
    expect(s.lines).toEqual(PRESET_LINES);
    expect(s.follows).toEqual(PRESET_FOLLOWS);
    // 1.2.5 (PRD-1.2.5 § 3) : « Pluie pendant la marche », nouveau, allumé
    expect([s.seenVersion, s.recent, s.display, s.alerts, s.maxWalkMin]).toEqual([raw.seenVersion, raw.recent, { ...raw.display, rain: true }, raw.alerts, raw.maxWalkMin]);
    // une seconde lecture ne change rien
    stable(s);
    // validateSettings migre d'office des réglages d'une version antérieure (préréglages des tests)
    expect(validateSettings(raw)).toEqual(s);
  });

  it('CA-2.1 préréglage 1.0 : même migration ; sans « Vers la maison », « Maison » devient un lieu « Jamais » en fin', () => {
    const raw = withSchool(read(PRESET_PATH));
    const s = migrateSettings(raw);
    const v11 = migrateSettings(withSchool(read(PRESET_11_PATH)));
    expect(s.v).toBe(4);
    expect(s.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gand', 'maison', 'ecole']);
    expect(s.favorites.slice(0, 2)).toEqual(v11.favorites.slice(0, 2));
    expect(s.favorites[2]).toEqual({ kind: 'place', id: 'maison', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Namur', propose: 'never' });
    expect([s.seenVersion, s.display.favOrder, s.recent]).toEqual(['1.0.0', 'smart', []]);
    stable(s);
  });

  it('revue n° 4 : preset.json migré, tram 3 et tram 4 à « Gare du Nord » ouverts d’office, « Namur » et le bus De Lijn dans leur rubrique', () => {
    const s = migrateSettings(read(PRESET_PATH));
    expect(s.stations).toEqual(PRESET_STATIONS);
    expect(s.lines).toEqual(PRESET_LINES);
    expect(s.follows).toEqual(PRESET_FOLLOWS);
    expect(s.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:fav-bureau', 'trip:fav-gand', 'place:maison']);
    expect(s.favorites.some((f) => f.kind === 'stop')).toBe(false);
    // le message « Quai 1.2.2 » s'affichera une fois : la version vue reste celle d'avant
    expect(s.seenVersion).toBe('1.0.0');
    stable(s);
    expect(migrateSettings(migrateSettings(s))).toEqual(s);
  });

  it('§ 2.4 : fusion (le premier seulement), « Ma position → adresse ou arrêt » devient un lieu, identifiants suivis', () => {
    const gand = { type: 'area', areaId: 'sncb:8892007', op: 'sncb', name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters', l: 'nl' }, lat: 51.0359, lon: 3.7107 };
    const s = migrateSettings({
      v: 2,
      lang: 'fr',
      places: [
        { id: 'b', label: 'Bureau', lat: 50.85, lon: 4.35, address: 'Rue Neuve 1, 1000 Bruxelles', src: 'address' },
        { id: 's', label: 'Gym', lat: 50.84, lon: 4.36 },
      ],
      favorites: [
        { kind: 'trip', id: 'f1', from: { type: 'here' }, to: { type: 'place', placeId: 'b' }, label: 'boulot', propose: 'near' },
        { kind: 'trip', id: 'f2', from: { type: 'here' }, to: { type: 'place', placeId: 'b' }, propose: 'morning' },
        { kind: 'trip', id: 'f3', from: { type: 'here' }, to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, approx: true }, propose: 'morning' },
        { kind: 'trip', id: 'f4', from: { type: 'here' }, to: gand, propose: 'evening' },
        { kind: 'trip', id: 'f5', from: { type: 'place', placeId: 'b' }, to: { type: 'place', placeId: 's' }, propose: 'never' },
        { kind: 'stop', id: 's', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, propose: 'never' },
        { kind: 'trip', id: 'f6', from: { type: 'here' }, to: { type: 'here' }, propose: 'never' },
      ],
    });
    expect(s.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:f1', 'place:f3', 'place:f4', 'trip:f5', 'place:s-2']);
    // l'arrêt « s » (sans filtre) est rangé en ligne « toutes les lignes », son identifiant gardé
    expect(s.lines).toEqual([{ id: 's', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36 }]);
    expect(s.favorites[0]).toEqual({ kind: 'place', id: 'f1', label: 'Boulot', lat: 50.85, lon: 4.35, address: 'Rue Neuve 1, 1000 Bruxelles', src: 'address', propose: 'never' });
    expect(s.favorites[1]).toEqual({ kind: 'place', id: 'f3', label: 'Veldstraat 1', lat: 51.0537, lon: 3.7225, address: 'Veldstraat 1, 9000 Gent', src: 'address', approx: true, propose: 'morning' });
    expect(s.favorites[2]).toEqual({ kind: 'place', id: 'f4', label: 'Gand-Saint-Pierre', lat: 51.0359, lon: 3.7107, address: 'Près de Gand-Saint-Pierre', src: 'stop', areaId: 'sncb:8892007', propose: 'evening' });
    // le trajet fixe suit les identifiants des favoris lieux (« b » fusionné dans f1, « s » renommé : pris par l'arrêt)
    expect(s.favorites[3]).toMatchObject({ kind: 'trip', from: { type: 'place', placeId: 'f1' }, to: { type: 'place', placeId: 's-2' } });
    expect(s.favorites[4]).toMatchObject({ kind: 'place', label: 'Gym', propose: 'never' });
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
  });
});

describe('validation des réglages (v4)', () => {
  it('lieux (créneau « près » → « Jamais », src connue seulement), trajets « Ma position → … » devenus lieux, trajet vers un lieu absent retiré', () => {
    const s = validateSettings({
      v: 3,
      favorites: [
        { kind: 'place', id: 'p1', label: 'Rendez-vous', lat: 51.0537, lon: 3.7225, address: 'Veldstraat 1, 9000 Gent', src: 'address', propose: 'near' },
        { kind: 'place', id: 'p2', label: 'X', lat: 50, lon: 4, src: 'nimporte', propose: 'evening' },
        { kind: 'place', id: 'p3', label: '', lat: 50, lon: 4, propose: 'never' },
        { kind: 'trip', id: 't1', from: { type: 'here' }, to: { type: 'place', placeId: 'p1' }, propose: 'morning' },
        { kind: 'trip', id: 't2', from: { type: 'here' }, to: { type: 'address', label: 'Rue Neuve, 1000 Bruxelles', lat: 50.852, lon: 4.3555, approx: true }, propose: 'never' },
        { kind: 'trip', id: 't3', from: { type: 'place', placeId: 'p2' }, to: { type: 'place', placeId: 'inconnu' }, propose: 'never' },
        { kind: 'trip', id: 't4', from: { type: 'place', placeId: 'p2' }, to: { type: 'place', placeId: 'p1' }, propose: 'near' },
      ],
      recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 5 }, { label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 4 }, { label: 'sans position' }],
      display: { favOrder: 'mine' },
    });
    expect(s.favorites.map((f) => f.id)).toEqual(['p1', 'p2', 't2', 't4']);
    expect(s.favorites[0]).toMatchObject({ kind: 'place', src: 'address', propose: 'never' });
    expect(s.favorites[1]).toMatchObject({ kind: 'place', propose: 'evening' });
    expect(s.favorites[1].kind === 'place' && s.favorites[1].src).toBeUndefined();
    expect(s.favorites[2]).toMatchObject({ kind: 'place', label: 'Rue Neuve', address: 'Rue Neuve, 1000 Bruxelles', approx: true, src: 'address' });
    expect(s.favorites[3]).toMatchObject({ kind: 'trip', propose: 'near' });
    expect(s.recent).toHaveLength(1);
    expect(s.display.favOrder).toBe('mine');
  });

  it('32 favoris au plus', () => {
    const place = (i: number) => ({ kind: 'place', id: `p${i}`, label: `Lieu ${i}`, lat: 50.86, lon: 4.36, propose: 'never' });
    expect(LIMITS.favorites).toBe(32);
    expect(validateSettings({ v: 4, favorites: Array.from({ length: 40 }, (_, i) => place(i)) }).favorites).toHaveLength(32);
    // 1.2.2 : 40 arrêts favoris de la 1.2 (32 lus) : 32 lignes, aucun perdu, aucun favori
    const stop = (i: number) => ({ kind: 'stop', id: `s${i}`, areaId: `stib:${6000 + i}`, op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, propose: 'never' });
    const s = validateSettings({ v: 3, favorites: Array.from({ length: 40 }, (_, i) => stop(i)) });
    expect([s.favorites.length, s.lines.length]).toEqual([0, 32]);
    expect(s.lines.map((l) => l.id)).toEqual(Array.from({ length: 32 }, (_, i) => `s${i}`));
  });

  it('valeurs par défaut pour une entrée vide ou invalide', () => {
    expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings('n’importe quoi')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{pas du json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({}).seenVersion).toBe('');
  });

  it('bornes et listes fermées', () => {
    const s = validateSettings({
      maxWalkMin: 99,
      lang: 'de',
      display: { depsPerStop: 1, radiusM: 650, gestureHints: 'oui', opening: 'jamais' },
      alerts: { delayMin: '7', leaveBeforeMin: -3 },
    });
    expect(s.maxWalkMin).toBe(20);
    expect(s.lang).toBe('fr');
    expect(s.display.depsPerStop).toBe(2);
    expect(s.display.radiusM).toBe(500);
    expect(s.display.gestureHints).toBe(true);
    expect(s.display.opening).toBe('suggest');
    expect(s.alerts.delayMin).toBe(7);
    expect(s.alerts.leaveBeforeMin).toBe(0);
    expect(validateSettings({ display: { radiusM: 790 } }).display.radiusM).toBe(800);
    expect(clampInt('abc', [1, 5], 3)).toBe(3);
  });

  it('favoris invalides retirés, doublons ignorés', () => {
    const s = validateSettings({
      favorites: [
        { kind: 'place', id: 'maison', label: 'Maison', lat: 50.46, lon: 4.86, propose: 'evening' },
        { kind: 'place', id: 'maison', label: 'Doublon', lat: 1, lon: 1, propose: 'never' },
        { kind: 'place', id: 'y', label: 'Hors carte', lat: 200, lon: 1, propose: 'never' },
        { kind: 'stop', id: 'a', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, propose: 'near', filter: [{ line: '3', head: 'Churchill' }, { line: '3', head: 'churchill' }] },
        { kind: 'stop', id: 'b', areaId: 'pas-un-id', op: 'stib', name: { fr: 'X' }, lat: 1, lon: 1 },
        { kind: 'trip', id: 'd', from: { type: 'place', placeId: 'maison' }, to: { type: 'area', areaId: 'sncb:8892007', op: 'sncb', name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters' }, lat: 51.0359, lon: 3.7107 }, propose: 'bizarre', label: '  maison  ' },
        { kind: 'stop', id: 'a', areaId: 'stib:1', op: 'stib', name: { fr: 'Doublon' }, lat: 1, lon: 1 },
      ],
    });
    expect(s.favorites.map((f) => f.id)).toEqual(['maison', 'd']);
    // l'arrêt « a » (filtre dédoublonné : tram 3) devient sa ligne, ouverte d'office ; son doublon (même id) ignoré ;
    // 1.2.6 : une ligne suivie, l'arrêt en repère
    expect(s.lines).toEqual([]);
    expect(s.follows).toEqual([{ id: 'f-a', op: 'stib', line: '3', routes: [], via: { areaId: 'stib:6357F', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36 }, near: true }]);
    const d = s.favorites[1];
    expect(d.propose).toBe('never');
    expect(d.kind === 'trip' && d.label).toBe('maison');
  });
});

const NAMUR = { name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 };
const stopFav = (id: string, areaId: string, extra: Partial<FavoriteStop> = {}): FavoriteStop => ({
  kind: 'stop',
  id,
  areaId,
  op: areaId.slice(0, areaId.indexOf(':')) as FavoriteStop['op'],
  name: { fr: id, nl: id },
  lat: 50.86,
  lon: 4.36,
  propose: 'never',
  ...extra,
});
const tripFav = (id: string): Favorite => ({ kind: 'trip', id, from: { type: 'address', label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545 }, to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 }, propose: 'never' });
const placeFav = (id: string): Favorite => ({ kind: 'place', id, label: id, lat: 50.85, lon: 4.35, propose: 'never' });

describe('réglages v4 : gares et lignes (PRD-1.2.2 § 5, CA-122.6)', () => {
  it('moveStops : gare SNCB → gare ; filtre → une ligne par ligne du filtre ; sans filtre → toutes les lignes ; « près » → near', () => {
    const stations: StationPick[] = [];
    const lines: LinePick[] = [];
    const rest = moveStops(
      [
        placeFav('maison'),
        stopFav('namur', 'sncb:8863008', { ...NAMUR, filter: [{ line: 'IC', head: 'bruxelles midi' }], propose: 'near' }),
        tripFav('t1'),
        stopFav('gdn', 'stib:6357F', { filter: [{ line: '3', head: 'churchill' }, { line: '3', head: 'esplanade' }, { line: '4', head: 'stalle p' }], propose: 'morning' }),
        stopFav('w', 'tec:Bwategl1', { filter: [{ line: 'W', head: 'bruxelles midi' }], propose: 'near' }),
        stopFav('nord', 'delijn:308611'),
        placeFav('bureau'),
      ],
      stations,
      lines,
    );
    // les autres favoris restent, dans leur ordre ; les arrêts partent
    expect(rest.map((f) => f.id)).toEqual(['maison', 't1', 'bureau']);
    // gare : le filtre ne compte pas (tous les trains) ; ouverture d'office gardée
    expect(stations).toEqual([{ id: 'namur', areaId: 'sncb:8863008', ...NAMUR, near: true }]);
    // lignes, dans l'ordre des favoris : une ligne par ligne du filtre (les deux sens), identifiants suivis de la
    // ligne quand l'arrêt en donne plusieurs ; « matin » ne donne pas `near`
    expect(lines.map((l) => [l.id, l.areaId, l.op, l.line, l.near])).toEqual([
      ['gdn-3', 'stib:6357F', 'stib', '3', undefined],
      ['gdn-4', 'stib:6357F', 'stib', '4', undefined],
      ['w', 'tec:Bwategl1', 'tec', 'W', true],
      ['nord', 'delijn:308611', 'delijn', undefined, undefined],
    ]);
    expect(lines[3]).toEqual({ id: 'nord', areaId: 'delijn:308611', op: 'delijn', name: { fr: 'nord', nl: 'nord' }, lat: 50.86, lon: 4.36 });
  });

  it('moveStops : rien de doublé (même gare, même ligne au même arrêt, choix déjà faits), « près » rejoint le choix existant', () => {
    const stations: StationPick[] = [{ id: 'gare', areaId: 'sncb:8863008', ...NAMUR }];
    const lines: LinePick[] = [{ id: 'l1', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, line: '3' }];
    const rest = moveStops(
      [
        stopFav('a', 'sncb:8863008', { propose: 'near' }),
        stopFav('b', 'sncb:8814001'),
        stopFav('c', 'sncb:8814001'),
        stopFav('d', 'stib:6357F', { filter: [{ line: '3', head: 'churchill' }], propose: 'near' }),
        stopFav('e', 'stib:6357F', { filter: [{ line: '4', head: 'stalle p' }, { line: '3', head: 'esplanade' }] }),
        stopFav('f', 'stib:6357F'),
        stopFav('g', 'stib:6357F'),
      ],
      stations,
      lines,
    );
    expect(rest).toEqual([]);
    expect(stations.map((x) => [x.id, x.areaId, x.near])).toEqual([
      ['gare', 'sncb:8863008', true],
      ['b', 'sncb:8814001', undefined],
    ]);
    expect(lines.map((x) => [x.id, x.line, x.near])).toEqual([
      ['l1', '3', true],
      ['e-4', '4', undefined],
      ['f', undefined, undefined],
    ]);
  });

  it('moveStops : aucun arrêt perdu (32 gares, 32 lignes) ; identifiants uniques parmi favoris, gares et lignes, 60 caractères au plus', () => {
    expect([LIMITS.favorites, LIMITS.stations, LIMITS.lines]).toEqual([32, 32, 32]);
    const stations: StationPick[] = [];
    const lines: LinePick[] = [];
    const sncb = Array.from({ length: 16 }, (_, i) => stopFav(`g${i}`, `sncb:88${String(i).padStart(5, '0')}`));
    const bus = Array.from({ length: 16 }, (_, i) => stopFav(`b${i}`, `tec:X${i}`));
    moveStops([...sncb, ...bus], stations, lines);
    expect(stations.map((x) => x.id)).toEqual(sncb.map((f) => f.id));
    expect(lines.map((x) => x.id)).toEqual(bus.map((f) => f.id));
    // 32 arrêts favoris (le plus que la 1.2 garde) de 3 lignes chacun : une ligne par ligne tant que les arrêts
    // suivants gardent leur place, puis « toutes les lignes » ; chaque arrêt est là
    const three = (i: number) => stopFav(`t${i}`, `stib:${7000 + i}`, { filter: ['1', '2', '3'].map((line) => ({ line, head: 'x' })) });
    const full: LinePick[] = [];
    moveStops(Array.from({ length: 12 }, (_, i) => three(i)), [], full);
    expect(full).toHaveLength(32);
    expect(new Set(full.map((x) => x.areaId)).size).toBe(12);
    expect(full.filter((x) => x.line === undefined).map((x) => x.id)).toEqual(['t10', 't11']);
    const most: LinePick[] = [];
    const s32 = validateSettings({ v: 3, favorites: Array.from({ length: 32 }, (_, i) => three(i)) });
    moveStops(Array.from({ length: 32 }, (_, i) => three(i)), [], most);
    expect(most.map((x) => [x.id, x.line])).toEqual(Array.from({ length: 32 }, (_, i) => [`t${i}`, undefined]));
    expect(s32.lines).toEqual(most);
    stable(s32);
    // un identifiant déjà pris par un favori restant, une gare ou une ligne : suffixe « -2 », « -3 »
    const st2: StationPick[] = [{ id: 'x', areaId: 'sncb:8812005', name: { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' }, lat: 50.86, lon: 4.36 }];
    const li2: LinePick[] = [];
    const long = 'z'.repeat(60);
    const rest = moveStops(
      [
        stopFav('x', 'sncb:8863008'),
        placeFav('y'),
        stopFav('y', 'stib:6357F', { filter: [{ line: '3', head: 'churchill' }] }),
        stopFav('y-3', 'stib:6359', { filter: [{ line: '3', head: 'churchill' }, { line: '6', head: 'roi baudouin' }] }),
        stopFav(long, 'stib:6362', { filter: [{ line: '3', head: 'churchill' }, { line: '4', head: 'stalle p' }] }),
        stopFav(long, 'stib:6364'),
      ],
      st2,
      li2,
    );
    expect(rest.map((f) => f.id)).toEqual(['y']);
    expect(st2.map((x) => x.id)).toEqual(['x', 'x-2']);
    const ids = li2.map((x) => x.id);
    expect(ids.slice(0, 3)).toEqual(['y-2', 'y-3-3', 'y-3-6']);
    expect(ids.slice(3).every((id) => id.length <= 60)).toBe(true);
    expect(ids.slice(3)).toEqual([`${'z'.repeat(58)}-3`, `${'z'.repeat(58)}-4`, long]);
    const all = [...rest.map((f) => f.id), ...st2.map((x) => x.id), ...ids];
    expect(new Set(all).size).toBe(all.length);
  });

  it('migration v3 → v4 : arrêts rangés au milieu des favoris, ordre des autres gardé, version vue gardée, seconde lecture identique', () => {
    const v3 = {
      v: 3,
      onboarded: true,
      lang: 'fr',
      seenVersion: '1.2.1',
      favorites: [
        placeFav('maison'),
        stopFav('fav-gdn', 'stib:6357F', { filter: [{ line: '3', head: 'churchill' }, { line: '4', head: 'stalle p' }], propose: 'near' }),
        tripFav('t1'),
        stopFav('fav-namur', 'sncb:8863008', NAMUR),
        placeFav('bureau'),
        stopFav('fav-dl', 'delijn:308611'),
      ],
      display: { favOrder: 'mine' },
    };
    const s = migrateSettings(v3);
    expect(s.v).toBe(4);
    expect(s.favorites.map((f) => f.id)).toEqual(['maison', 't1', 'bureau']);
    expect(s.stations.map((x) => x.id)).toEqual(['fav-namur']);
    expect(s.lines.map((x) => `${x.id} ${x.line ?? '*'}${x.near ? ' près' : ''}`)).toEqual(['fav-dl *']);
    expect(s.follows?.map((x) => `${x.id} ${x.line}${x.near ? ' près' : ''} ${x.via?.areaId}`)).toEqual(['f-fav-gdn-3 3 près stib:6357F', 'f-fav-gdn-4 4 près stib:6357F']);
    expect([s.seenVersion, s.display.favOrder, s.onboarded]).toEqual(['1.2.1', 'mine', true]);
    stable(s);
    expect(parseSettings(JSON.stringify(v3))).toEqual(s);
    // des réglages v4 qui contiendraient encore un arrêt favori (version antérieure) : rangé à la lecture
    const late = validateSettings({ ...s, favorites: [...s.favorites, stopFav('tard', 'stib:6359', { filter: [{ line: '2', head: 'simonis' }] })] });
    expect(late.favorites).toEqual(s.favorites);
    expect(late.lines.map((x) => x.id)).toEqual(['fav-dl']);
    expect(late.follows?.map((x) => x.id)).toEqual(['f-fav-gdn-3', 'f-fav-gdn-4', 'f-tard']);
    stable(late);
  });

  it('migration : le réseau se lit dans l’identifiant de zone ; une seconde migration ne change rien', () => {
    const s = migrateSettings({ v: 3, favorites: [{ ...stopFav('odd', 'stib:6357F'), op: 'sncb' }, { ...stopFav('gare', 'sncb:8814001'), op: 'tec' }] });
    expect(s.lines).toMatchObject([{ id: 'odd', areaId: 'stib:6357F', op: 'stib' }]);
    expect(s.stations).toMatchObject([{ id: 'gare', areaId: 'sncb:8814001' }]);
    stable(s);
  });

  it('validation v4 : gares et lignes invalides retirées, doublons ignorés, limites, mode et near', () => {
    const gdn = { areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36 };
    const s = validateSettings({
      v: 4,
      stations: [
        { id: 'n', areaId: 'sncb:8863008', ...NAMUR, near: true },
        { id: 'n', areaId: 'sncb:8814001', ...NAMUR }, // même identifiant
        { id: 'm', areaId: 'sncb:8863008', ...NAMUR }, // même gare
        { id: 'tram', areaId: 'stib:6357F', ...NAMUR }, // pas une gare SNCB
        { id: 'sans-nom', areaId: 'sncb:8814001', lat: 50.8, lon: 4.3 },
        { id: 'hors-carte', areaId: 'sncb:8814001', ...NAMUR, lat: 200 },
        { id: 'midi', areaId: 'sncb:8814001', ...NAMUR, near: 'oui' },
      ],
      lines: [
        { id: 'l3', ...gdn, line: '3', mode: 'tram', near: true },
        { id: 'l3b', ...gdn, line: '3' }, // même ligne au même arrêt
        { id: 'tout', ...gdn },
        { id: 'tout2', ...gdn }, // même arrêt sans ligne
        { id: 'train', ...gdn, op: 'sncb', line: 'IC' },
        { id: 'mode', ...gdn, line: '4', mode: 'train' },
        { id: 'long', ...gdn, line: 'x'.repeat(30) },
        { id: 'bad', areaId: 'pas-un-id', op: 'stib', name: gdn.name, lat: 1, lon: 1, line: '3' },
      ],
    });
    expect(s.stations).toEqual([
      { id: 'n', areaId: 'sncb:8863008', ...NAMUR, near: true },
      { id: 'midi', areaId: 'sncb:8814001', ...NAMUR },
    ]);
    expect(s.lines.map((l) => [l.id, l.line, l.mode, l.near])).toEqual([['tout', undefined, undefined, undefined]]);
    // 1.2.6 : les lignes gardées à un arrêt deviennent des lignes suivies, dans le même ordre
    expect(s.follows?.map((l) => [l.id, l.line, l.mode, l.near, l.via?.areaId])).toEqual([
      ['f-l3', '3', 'tram', true, 'stib:6357F'],
      ['f-mode', '4', undefined, undefined, 'stib:6357F'],
      ['f-long', 'x'.repeat(20), undefined, undefined, 'stib:6357F'],
    ]);
    const many = validateSettings({
      v: 4,
      stations: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, areaId: `sncb:88${i}`, ...NAMUR })),
      lines: Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, ...gdn, line: String(i) })),
    });
    expect([many.stations.length, many.lines.length, many.follows?.length]).toEqual([32, 0, 32]);
    expect(many.follows?.map((l) => l.line)).toEqual(Array.from({ length: 32 }, (_, i) => String(i)));
    stable(s);
    stable(many);
  });

  it('réglages par défaut : aucune gare, aucune ligne', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ v: 4, stations: [], lines: [] });
    expect(validateSettings({})).toMatchObject({ stations: [], lines: [] });
  });
});

describe('migration selon v', () => {
  it('réglages v0 (sans v) : champs à plat repris', () => {
    expect(versionOf({})).toBe(0);
    const s = migrateSettings({ onboarded: true, radius: 300, deps: 6, hints: false, lang: 'nl' });
    expect(s.v).toBe(4);
    expect([s.stations, s.lines]).toEqual([[], []]);
    expect(s.display.radiusM).toBe(300);
    expect(s.display.depsPerStop).toBe(6);
    expect(s.display.gestureHints).toBe(false);
    expect(s.lang).toBe('nl');
    expect(s.onboarded).toBe(true);
  });

  it('version plus récente lue au mieux', () => {
    const s = migrateSettings({ v: 7, lang: 'local', futur: true });
    expect(s.v).toBe(4);
    expect(CURRENT_VERSION).toBe(4);
    expect(s.lang).toBe('local');
  });
});

describe('persistance (KV du SDK)', () => {
  it('écriture, relecture, remise à zéro', async () => {
    const backend = memoryBackend();
    const kv = createKV(backend);
    const store = new SettingsStore(kv, await loadSettings(kv));
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.display.depsPerStop));
    await store.update((s) => ({ ...s, display: { ...s.display, depsPerStop: 6 } }));
    expect(seen).toEqual([6]);
    expect(JSON.parse(backend.data.get(SETTINGS_KEY)!).display.depsPerStop).toBe(6);
    const again = await loadSettings(createKV(backend));
    expect(again.display.depsPerStop).toBe(6);
    await saveSettings(kv, { ...again, display: { ...again.display, depsPerStop: 50 } });
    expect((await loadSettings(createKV(backend))).display.depsPerStop).toBe(8);
  });

  it('identifiants uniques', () => {
    const a = newId('fav', [], 123);
    expect(newId('fav', [a], 123)).not.toBe(a);
  });

  it('revue 1.2.2 : réglages d’avant la v4 copiés tels quels sous quai.settings.v3 à la 1re migration, jamais réécrits', async () => {
    expect(SETTINGS_BACKUP_KEY).toBe('quai.settings.v3');
    const v3 = JSON.stringify({
      v: 3,
      onboarded: true,
      favorites: [{ kind: 'stop', id: 'gdn', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017, filter: [{ line: '3', head: 'churchill' }], propose: 'never' }],
    });
    const backend = memoryBackend();
    backend.data.set(SETTINGS_KEY, v3);
    const kv = createKV(backend);
    const store = new SettingsStore(kv, await loadSettings(kv));
    expect(store.get()).toMatchObject({ v: 4, favorites: [], lines: [], follows: [{ id: 'f-gdn', op: 'stib', line: '3', via: { areaId: 'stib:6357F' } }] });
    // copie exacte du JSON lu, la clé des réglages inchangée tant que rien n'est enregistré
    expect(backend.data.get(SETTINGS_BACKUP_KEY)).toBe(v3);
    expect(backend.data.get(SETTINGS_KEY)).toBe(v3);
    // réglages enregistrés en v4 : la copie reste celle de la v3
    await store.update((s) => ({ ...s, display: { ...s.display, depsPerStop: 6 } }));
    expect(versionOf(JSON.parse(backend.data.get(SETTINGS_KEY)!))).toBe(4);
    await loadSettings(createKV(backend));
    expect(backend.data.get(SETTINGS_BACKUP_KEY)).toBe(v3);
    // retour à la 1.2.1, autres réglages v3, puis 1.2.2 de nouveau : la première copie n'est pas remplacée
    backend.data.set(SETTINGS_KEY, JSON.stringify({ ...JSON.parse(v3), lang: 'nl' }));
    expect((await loadSettings(createKV(backend))).lang).toBe('nl');
    expect(backend.data.get(SETTINGS_BACKUP_KEY)).toBe(v3);
    // la 1.2.1 relit la copie : ses arrêts favoris y sont
    expect(JSON.parse(backend.data.get(SETTINGS_BACKUP_KEY)!).favorites[0]).toMatchObject({ kind: 'stop', id: 'gdn' });
  });

  it('1.2.6 (PRD-1.2.6 § 4) : une ligne gardée à un arrêt devient une ligne suivie, l’arrêt en repère ; gardée à deux arrêts : une fois', () => {
    const gdn = { areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36 };
    const rogier = { ...gdn, areaId: 'stib:6359', name: { fr: 'Rogier', nl: 'Rogier' }, lat: 50.857, lon: 4.362 };
    const s = validateSettings({
      v: 4,
      lines: [
        { id: 'stop', ...gdn },
        { id: 'l3', ...gdn, line: '3', mode: 'tram' },
        { id: 'l3r', ...rogier, line: '03', near: true },
        { id: 'w', areaId: 'tec:Bbrlmer1', op: 'tec', name: { fr: 'Merbraine', nl: 'Merbraine' }, lat: 50.68, lon: 4.39, line: 'W', near: true },
      ],
      follows: [{ id: 'f-4', op: 'stib', line: '4', routes: ['stib:4'], mode: 'tram', color: 'e5007d', text: 'ffffff' }, { id: 'bad', op: 'sncb', line: 'IC', routes: [] }, { id: 'f-4b', op: 'stib', line: '4', routes: [] }],
    });
    expect(s.lines.map((p) => p.id)).toEqual(['stop']);
    // le tram 3 une fois (son premier arrêt en repère ; l'ouverture d'office d'un autre arrêt ne le suit pas) ; une
    // ligne suivie déjà là gardée (couleur en majuscules), un train refusé, un doublon ignoré
    expect(s.follows).toEqual([
      { id: 'f-4', op: 'stib', line: '4', routes: ['stib:4'], mode: 'tram', color: 'E5007D', text: 'FFFFFF' },
      { id: 'f-l3', op: 'stib', mode: 'tram', line: '3', routes: [], via: { areaId: 'stib:6357F', name: gdn.name, lat: 50.86, lon: 4.36 } },
      { id: 'f-w', op: 'tec', line: 'W', routes: [], via: { areaId: 'tec:Bbrlmer1', name: { fr: 'Merbraine', nl: 'Merbraine' }, lat: 50.68, lon: 4.39 }, near: true },
    ]);
    stable(s);
    // contrôle qualité : deux lignes du même numéro de deux régions (aucune variante commune) restent deux lignes ; une
    // variante commune : la même ligne, une seule fois
    const two = validateSettings({
      v: 4,
      follows: [
        { id: 'w-braine', op: 'tec', line: 'W', routes: ['tec:B0536-23747'] },
        { id: 'w-tournai', op: 'tec', line: 'W', routes: ['tec:T0900-23747'] },
        { id: 'w-encore', op: 'tec', line: 'W', routes: ['tec:T0900-23747', 'tec:T0900-23748'] },
      ],
    });
    expect(two.follows?.map((x) => x.id)).toEqual(['w-braine', 'w-tournai']);
    stable(two);
    // une ligne gardée à un arrêt qui devient une ligne suivie : identifiant unique, même si « f-l4 » existe déjà
    const clash = validateSettings({ v: 4, follows: [{ id: 'f-l4', op: 'stib', line: '4', routes: ['stib:4'] }], lines: [{ id: 'l4', ...gdn, line: '3' }] });
    expect(clash.follows?.map((x) => x.id)).toEqual(['f-l4', 'f-l4-2']);
    stable(clash);
    // `near` sans repère : ignoré ; repère sans coordonnées : sans repère
    const odd = validateSettings({ v: 4, follows: [{ id: 'a', op: 'tec', line: '1', routes: ['x'], near: true }, { id: 'b', op: 'tec', line: '2', routes: [], via: { areaId: 'tec:1', name: { fr: 'X' } } }] });
    expect(odd.follows).toEqual([
      { id: 'a', op: 'tec', line: '1', routes: [] },
      { id: 'b', op: 'tec', line: '2', routes: [] },
    ]);
  });

  it('1.2.6 : réglages de la 1.2.5 qui gardent une ligne à un arrêt copiés tels quels sous quai.settings.v4-1.2.5 à la 1re lecture, jamais remplacés', async () => {
    expect(SETTINGS_BACKUP_125_KEY).toBe('quai.settings.v4-1.2.5');
    const gdn = { areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36 };
    const v125 = JSON.stringify({ ...validateSettings({}), lines: [{ id: 'l3', ...gdn, line: '3', mode: 'tram', near: true }] });
    const backend = memoryBackend();
    backend.data.set(SETTINGS_KEY, v125);
    const s = await loadSettings(createKV(backend));
    expect(s.follows).toMatchObject([{ id: 'f-l3', line: '3', near: true, via: { areaId: 'stib:6357F' } }]);
    expect(backend.data.get(SETTINGS_BACKUP_125_KEY)).toBe(v125);
    // la 1.2.5 relit la copie : sa ligne y est
    expect(JSON.parse(backend.data.get(SETTINGS_BACKUP_125_KEY)!).lines[0]).toMatchObject({ id: 'l3', line: '3' });
    // retour à la 1.2.5, autres réglages, puis 1.2.6 de nouveau : la première copie n'est pas remplacée
    backend.data.set(SETTINGS_KEY, JSON.stringify({ ...JSON.parse(v125), lang: 'nl' }));
    expect((await loadSettings(createKV(backend))).lang).toBe('nl');
    expect(backend.data.get(SETTINGS_BACKUP_125_KEY)).toBe(v125);
    // aucune copie sans ligne gardée à un arrêt, pour des réglages d'avant la v4 (leur copie est celle de la 1.2.2), ou illisibles
    for (const raw of [JSON.stringify(validateSettings({})), JSON.stringify({ ...validateSettings({}), lines: [{ id: 's', ...gdn }] }), JSON.stringify({ v: 3, favorites: [] }), '{pas du json']) {
      const b = memoryBackend();
      b.data.set(SETTINGS_KEY, raw);
      expect((await loadSettings(createKV(b))).v).toBe(4);
      expect(b.data.has(SETTINGS_BACKUP_125_KEY), raw).toBe(false);
    }
  });

  it('revue 1.2.2 : aucune copie pour des réglages déjà en v4, absents ou illisibles ; une copie impossible n’empêche pas la lecture', async () => {
    for (const raw of [JSON.stringify(validateSettings({})), '', '{pas du json', JSON.stringify([1, 2])]) {
      const backend = memoryBackend();
      if (raw) backend.data.set(SETTINGS_KEY, raw);
      expect((await loadSettings(createKV(backend))).v).toBe(4);
      expect(backend.data.has(SETTINGS_BACKUP_KEY)).toBe(false);
    }
    // 1.1 (v2) : copiée aussi, avant toute migration
    const v2 = readFileSync(PRESET_11_PATH, 'utf8');
    const b2 = memoryBackend();
    b2.data.set(SETTINGS_KEY, v2);
    await loadSettings(createKV(b2));
    expect(b2.data.get(SETTINGS_BACKUP_KEY)).toBe(v2);
    // stockage qui refuse l'écriture : réglages lus quand même
    const ro = memoryBackend();
    ro.data.set(SETTINGS_KEY, JSON.stringify({ v: 3, favorites: [] }));
    const refuse = { get: ro.get, set: async () => Promise.reject(new Error('quota')) };
    expect((await loadSettings(createKV(refuse))).v).toBe(4);
  });
});

describe('stockage découpé', () => {
  it('valeurs de plus de 48 000 caractères', async () => {
    const backend = memoryBackend();
    const kv = createKV(backend, { chunk: 10 });
    const big = 'x'.repeat(35) + 'é'.repeat(10);
    await kv.set('cache', big);
    expect(backend.data.size).toBe(6);
    expect(await createKV(backend, { chunk: 10 }).get('cache')).toBe(big);
    expect(await kv.get('absent')).toBeNull();
    await kv.set('petit', 'ok');
    expect(await createKV(backend, { chunk: 10 }).get('petit')).toBe('ok');
  });

  it('préfixe', async () => {
    const backend = memoryBackend();
    await createKV(backend, { prefix: 'quai.cache.' }).set('k', 'v');
    expect([...backend.data.keys()]).toEqual(['quai.cache.k']);
  });
});
