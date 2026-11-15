/**
 * 1.2.10 (PRD-1.2.10 § 3.5 et § 4.1) : réglage « Me guider pendant un trajet » (`display.guide`). Absent : allumé ; seul
 * `false` est gardé, à la lecture comme à l'écriture, à la migration et au changement de version ; les réglages par
 * défaut restent ceux de DEFAULT_SETTINGS. Les lunettes le voient tout de suite (SettingsStore, comme les autres
 * réglages d'Affichage).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/api';
import { createKV, memoryBackend } from '../src/platform/kv';
import { guideOn, loadSettings, migrateSettings, parseSettings, saveSettings, SETTINGS_KEY, SettingsStore, validateSettings } from '../src/settings';

const withGuide = (guide: unknown): Record<string, unknown> => ({ ...structuredClone(DEFAULT_SETTINGS), onboarded: true, display: { ...DEFAULT_SETTINGS.display, guide } });

describe('réglage « Me guider pendant un trajet » (settings.ts)', () => {
  it('absent : allumé, sans champ écrit ; les réglages par défaut restent DEFAULT_SETTINGS', () => {
    const s = validateSettings({});
    expect('guide' in s.display).toBe(false);
    expect(guideOn(s)).toBe(true);
    expect(validateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(guideOn(DEFAULT_SETTINGS)).toBe(true);
  });

  it('lu et normalisé : `false` l’éteint ; vrai, absent ou une valeur illisible : allumé, champ retiré', () => {
    const off = validateSettings(withGuide(false));
    expect(off.display.guide).toBe(false);
    expect(guideOn(off)).toBe(false);
    for (const v of [true, undefined, null, 'false', 'non', 0, 1, {}, []]) {
      const s = validateSettings(withGuide(v));
      expect('guide' in s.display, JSON.stringify(v) ?? 'undefined').toBe(false);
      expect(guideOn(s), JSON.stringify(v) ?? 'undefined').toBe(true);
    }
    // une deuxième lecture ne change rien
    expect(validateSettings(off)).toEqual(off);
    // les autres réglages d'Affichage ne bougent pas
    expect({ ...off.display, guide: undefined }).toEqual({ ...DEFAULT_SETTINGS.display, guide: undefined });
  });

  it('écrit puis relu (KV de l’appli) : éteint le reste ; rallumé, plus rien n’est écrit', async () => {
    const backend = memoryBackend();
    const kv = createKV(backend);
    await saveSettings(kv, validateSettings(withGuide(false)));
    expect(JSON.parse(backend.data.get(SETTINGS_KEY)!).display.guide).toBe(false);
    expect((await loadSettings(kv)).display.guide).toBe(false);
    await saveSettings(kv, validateSettings(withGuide(true)));
    expect('guide' in JSON.parse(backend.data.get(SETTINGS_KEY)!).display).toBe(false);
    expect(guideOn(await loadSettings(kv))).toBe(true);
  });

  it('gardé au changement de version : réglages enregistrés par la 1.2.9 (v4), et par une version antérieure migrée', () => {
    // même format (v4) d'une version à l'autre : un réglage éteint, relu par la version suivante, reste éteint
    const v129 = { ...withGuide(false), v: 4, seenVersion: '1.2.9' };
    expect(parseSettings(JSON.stringify(v129)).display.guide).toBe(false);
    expect(parseSettings(JSON.stringify({ ...v129, seenVersion: '1.2.10' })).display.guide).toBe(false);
    // réglages d'une version antérieure (v3, 1.2.1) : migrés, le réglage suit
    const v3 = { ...withGuide(false), v: 3 };
    expect(migrateSettings(v3).display.guide).toBe(false);
    expect(guideOn(migrateSettings({ ...withGuide(undefined), v: 2 }))).toBe(true);
  });

  it('SettingsStore : les abonnés (les lunettes) voient le changement tout de suite, et il est enregistré', async () => {
    const backend = memoryBackend();
    const store = new SettingsStore(createKV(backend), validateSettings(withGuide(undefined)));
    const seen: (boolean | undefined)[] = [];
    store.subscribe((s: Settings) => seen.push(s.display.guide));
    await store.update((s) => ({ ...s, display: { ...s.display, guide: false } }));
    expect(seen).toEqual([false]);
    expect(guideOn(store.get())).toBe(false);
    expect(JSON.parse(backend.data.get(SETTINGS_KEY)!).display.guide).toBe(false);
    await store.update((s) => ({ ...s, display: { ...s.display, guide: true } }));
    expect(seen).toEqual([false, undefined]);
    expect(guideOn(store.get())).toBe(true);
  });
});
