import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { clampInt, loadSettings, migrateSettings, newId, parseSettings, saveSettings, SETTINGS_KEY, SettingsStore, validateSettings, versionOf } from '../../src/settings';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PRESET_PATH } from './helpers';

describe('validation des réglages', () => {
  it('le préréglage de démonstration (1.0) passe tel quel, complété en v2', () => {
    const raw = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
    const v2 = { ...raw, v: 2, recent: [], seenVersion: '1.0.0', display: { ...raw.display, favOrder: 'smart' } };
    expect(migrateSettings(raw)).toEqual(v2);
    expect(validateSettings(v2)).toEqual(v2);
  });

  it('1.0 vers 1.1 : lieux, favoris, ordre et réglages gardés, nouveautés à montrer une fois', () => {
    const raw = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
    const s = migrateSettings(raw);
    expect(s.v).toBe(2);
    expect(s.places).toEqual(raw.places);
    expect(s.favorites.map((f) => f.id)).toEqual(raw.favorites.map((f: { id: string }) => f.id));
    expect(s.favorites).toEqual(raw.favorites);
    expect(s.display.favOrder).toBe('smart');
    expect(s.recent).toEqual([]);
    expect(s.seenVersion).toBe('1.0.0');
    expect(validateSettings({}).seenVersion).toBe('');
  });

  it('préréglage 1.1 (PRD A.2) : réglages v2 valides tels quels, le 1.0 plus « Vers la maison » le soir, en dernier', () => {
    const raw = JSON.parse(readFileSync(PRESET_PATH.replace(/preset\.json$/, 'preset-1.1.json'), 'utf8'));
    const v10 = migrateSettings(JSON.parse(readFileSync(PRESET_PATH, 'utf8')));
    expect(validateSettings(raw)).toEqual(raw);
    expect(migrateSettings(raw)).toEqual(raw);
    expect(raw.seenVersion).toBe('1.1.0');
    expect(raw.places).toEqual(v10.places);
    expect(raw.favorites.slice(0, -1)).toEqual(v10.favorites);
    expect(raw.favorites.at(-1)).toEqual({ kind: 'trip', id: 'fav-maison', from: { type: 'here' }, to: { type: 'place', placeId: 'maison' }, label: 'maison', propose: 'evening' });
    expect({ ...raw, favorites: v10.favorites, seenVersion: '1.0.0' }).toEqual(v10);
  });

  it('extrémité adresse, lieu par adresse et adresses récentes', () => {
    const s = validateSettings({
      places: [{ id: 'p1', label: 'Rendez-vous', lat: 51.0537, lon: 3.7225, address: 'Veldstraat 1, 9000 Gent', src: 'address' }, { id: 'p2', label: 'X', lat: 50, lon: 4, src: 'nimporte' }],
      favorites: [{ kind: 'trip', id: 'f1', from: { type: 'here' }, to: { type: 'address', label: 'Rue Neuve, 1000 Bruxelles', lat: 50.852, lon: 4.3555, approx: true }, propose: 'never' }],
      recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 5 }, { label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 4 }, { label: 'sans position' }],
      display: { favOrder: 'mine' },
    });
    expect(s.places[0].src).toBe('address');
    expect(s.places[1].src).toBeUndefined();
    expect(s.favorites[0]).toMatchObject({ to: { type: 'address', label: 'Rue Neuve, 1000 Bruxelles', approx: true } });
    expect(s.recent).toHaveLength(1);
    expect(s.display.favOrder).toBe('mine');
  });

  it('valeurs par défaut pour une entrée vide ou invalide', () => {
    expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings('n’importe quoi')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{pas du json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
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

  it('favoris et lieux invalides retirés, doublons ignorés', () => {
    const s = validateSettings({
      places: [
        { id: 'maison', label: 'Maison', lat: 50.46, lon: 4.86 },
        { id: 'maison', label: 'Doublon', lat: 1, lon: 1 },
        { id: 'x', label: '', lat: 1, lon: 1 },
        { id: 'y', label: 'Hors carte', lat: 200, lon: 1 },
      ],
      favorites: [
        { kind: 'stop', id: 'a', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86, lon: 4.36, propose: 'near', filter: [{ line: '3', head: 'Churchill' }, { line: '3', head: 'churchill' }] },
        { kind: 'stop', id: 'b', areaId: 'pas-un-id', op: 'stib', name: { fr: 'X' }, lat: 1, lon: 1 },
        { kind: 'trip', id: 'c', from: { type: 'here' }, to: { type: 'place', placeId: 'inconnu' }, propose: 'morning' },
        { kind: 'trip', id: 'd', from: { type: 'here' }, to: { type: 'place', placeId: 'maison' }, propose: 'bizarre', label: '  maison  ' },
        { kind: 'stop', id: 'a', areaId: 'stib:1', op: 'stib', name: { fr: 'Doublon' }, lat: 1, lon: 1 },
      ],
    });
    expect(s.places.map((p) => p.id)).toEqual(['maison']);
    expect(s.favorites.map((f) => f.id)).toEqual(['a', 'd']);
    const a = s.favorites[0];
    expect(a.kind === 'stop' && a.filter).toEqual([{ line: '3', head: 'churchill' }]);
    const d = s.favorites[1];
    expect(d.propose).toBe('never');
    expect(d.kind === 'trip' && d.label).toBe('maison');
  });
});

describe('migration selon v', () => {
  it('réglages v0 (sans v) : champs à plat repris', () => {
    expect(versionOf({})).toBe(0);
    const s = migrateSettings({ onboarded: true, radius: 300, deps: 6, hints: false, lang: 'nl' });
    expect(s.v).toBe(2);
    expect(s.display.radiusM).toBe(300);
    expect(s.display.depsPerStop).toBe(6);
    expect(s.display.gestureHints).toBe(false);
    expect(s.lang).toBe('nl');
    expect(s.onboarded).toBe(true);
  });

  it('version plus récente lue au mieux', () => {
    const s = migrateSettings({ v: 7, lang: 'local', futur: true });
    expect(s.v).toBe(2);
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
