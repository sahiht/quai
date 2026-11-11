import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { clampInt, LIMITS, loadSettings, migrateSettings, newId, parseSettings, saveSettings, SETTINGS_KEY, SettingsStore, validateSettings, versionOf } from '../../src/settings';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PRESET_11_PATH, PRESET_PATH } from './helpers';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
/** CA-2.1 : un lieu sans trajet ajouté au préréglage, « École ». */
const withSchool = <T extends { places: unknown[] }>(raw: T): T => ({ ...raw, places: [...raw.places, { id: 'ecole', label: 'École', lat: 50.85, lon: 4.35 }] });

describe('réglages v3 : migration (PRD-1.2 § 2.4)', () => {
  it('CA-2.1 préréglage 1.1 : 6 favoris au lieu de 8 entrées, lieux fusionnés, « École » en fin ; seconde lecture identique', () => {
    const raw = withSchool(read(PRESET_11_PATH));
    const s = migrateSettings(raw);
    expect(s.v).toBe(3);
    expect('places' in s).toBe(false);
    expect(s.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-namur', 'fav-dl-nord', 'fav-maison', 'ecole']);
    // « Ma position → lieu » : le lieu prend la place, l'identifiant, le nom et le créneau du trajet ;
    // « Adresse à vérifier » (lieu de la 1.0 sans src) gardé
    expect(s.favorites[0]).toEqual({ kind: 'place', id: 'fav-bureau', label: 'Bureau', lat: 50.8441, lon: 4.3474, address: 'Bruxelles', propose: 'morning' });
    expect(s.favorites[5]).toEqual({ kind: 'place', id: 'fav-maison', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Namur', propose: 'evening' });
    expect(s.favorites[6]).toEqual({ kind: 'place', id: 'ecole', label: 'École', lat: 50.85, lon: 4.35, propose: 'never' });
    // arrêts (filtres, créneaux) et trajet fixe inchangés
    expect(s.favorites.slice(1, 5)).toEqual(raw.favorites.slice(1, 5));
    expect([s.seenVersion, s.recent, s.display, s.alerts, s.maxWalkMin]).toEqual([raw.seenVersion, raw.recent, raw.display, raw.alerts, raw.maxWalkMin]);
    // une seconde lecture ne change rien
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
    expect(validateSettings(s)).toEqual(s);
    expect(migrateSettings(s)).toEqual(s);
    // validateSettings migre d'office des réglages d'une version antérieure (préréglages des tests)
    expect(validateSettings(raw)).toEqual(s);
  });

  it('CA-2.1 préréglage 1.0 : même migration ; sans « Vers la maison », « Maison » devient un lieu « Jamais » en fin', () => {
    const raw = withSchool(read(PRESET_PATH));
    const s = migrateSettings(raw);
    const v11 = migrateSettings(withSchool(read(PRESET_11_PATH)));
    expect(s.v).toBe(3);
    expect(s.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-namur', 'fav-dl-nord', 'maison', 'ecole']);
    expect(s.favorites.slice(0, 5)).toEqual(v11.favorites.slice(0, 5));
    expect(s.favorites[5]).toEqual({ kind: 'place', id: 'maison', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Namur', propose: 'never' });
    expect([s.seenVersion, s.display.favOrder, s.recent]).toEqual(['1.0.0', 'smart', []]);
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
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
    expect(s.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:f1', 'place:f3', 'place:f4', 'trip:f5', 'stop:s', 'place:s-2']);
    expect(s.favorites[0]).toEqual({ kind: 'place', id: 'f1', label: 'Boulot', lat: 50.85, lon: 4.35, address: 'Rue Neuve 1, 1000 Bruxelles', src: 'address', propose: 'never' });
    expect(s.favorites[1]).toEqual({ kind: 'place', id: 'f3', label: 'Veldstraat 1', lat: 51.0537, lon: 3.7225, address: 'Veldstraat 1, 9000 Gent', src: 'address', approx: true, propose: 'morning' });
    expect(s.favorites[2]).toEqual({ kind: 'place', id: 'f4', label: 'Gand-Saint-Pierre', lat: 51.0359, lon: 3.7107, address: 'Près de Gand-Saint-Pierre', src: 'stop', areaId: 'sncb:8892007', propose: 'evening' });
    // le trajet fixe suit les identifiants des favoris lieux (« b » fusionné dans f1, « s » renommé : pris par l'arrêt)
    expect(s.favorites[3]).toMatchObject({ kind: 'trip', from: { type: 'place', placeId: 'f1' }, to: { type: 'place', placeId: 's-2' } });
    expect(s.favorites[5]).toMatchObject({ kind: 'place', label: 'Gym', propose: 'never' });
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
  });
});

describe('validation des réglages (v3)', () => {
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
    const stop = (i: number) => ({ kind: 'stop', id: `s${i}`, areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, propose: 'never' });
    expect(LIMITS.favorites).toBe(32);
    expect(validateSettings({ v: 3, favorites: Array.from({ length: 40 }, (_, i) => stop(i)) }).favorites).toHaveLength(32);
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
    expect(s.favorites.map((f) => f.id)).toEqual(['maison', 'a', 'd']);
    const a = s.favorites[1];
    expect(a.kind === 'stop' && a.filter).toEqual([{ line: '3', head: 'churchill' }]);
    const d = s.favorites[2];
    expect(d.propose).toBe('never');
    expect(d.kind === 'trip' && d.label).toBe('maison');
  });
});

describe('migration selon v', () => {
  it('réglages v0 (sans v) : champs à plat repris', () => {
    expect(versionOf({})).toBe(0);
    const s = migrateSettings({ onboarded: true, radius: 300, deps: 6, hints: false, lang: 'nl' });
    expect(s.v).toBe(3);
    expect(s.display.radiusM).toBe(300);
    expect(s.display.depsPerStop).toBe(6);
    expect(s.display.gestureHints).toBe(false);
    expect(s.lang).toBe('nl');
    expect(s.onboarded).toBe(true);
  });

  it('version plus récente lue au mieux', () => {
    const s = migrateSettings({ v: 7, lang: 'local', futur: true });
    expect(s.v).toBe(3);
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
