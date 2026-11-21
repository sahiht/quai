/**
 * Quai 1.3.0, corrections du contrôle technique, point 3 : réglages illisibles au lancement. Le pont de l'appli Even rend
 * '' au bout de 5 s quand le stockage du téléphone ne répond pas : la lecture des réglages donnait alors les réglages par
 * défaut, que les lunettes écrivaient aussitôt (version vue), à la place des favoris. Vrai chemin du stockage de l'appli
 * Even (bridgeStorage, file du pont, createKV), vrais réglages (loadSettings, SettingsStore), vrai contrôleur. Lieux
 * publics seulement.
 */
import { APP_VERSION } from '../../src/version';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_USE_KEY } from '../../src/glasses/controller';
import { bridgeStorage } from '../../src/platform/even';
import { createKV } from '../../src/platform/kv';
import { SerialQueue } from '../../src/platform/queue';
import { SETTINGS_KEY, loadSettings } from '../../src/settings';
import { PLACES, at, settingsWith, setup } from './helpers';

const NOW = at('2026-11-15', 7, 31);

/**
 * Faux pont : stockage du téléphone en mémoire ; `hang(clé, n)` : la n-ième lecture de cette clé ne répond jamais (le
 * pont rend alors '' au bout de 5 s).
 */
function phoneStorage(stored: Record<string, string>, hang: (key: string, n: number) => boolean) {
  const store = new Map(Object.entries(stored));
  const writes: [string, string][] = [];
  const reads = new Map<string, number>();
  const bridge = {
    getLocalStorage: async (k: string): Promise<string> => {
      const n = (reads.get(k) ?? 0) + 1;
      reads.set(k, n);
      if (hang(k, n)) return new Promise<string>(() => undefined);
      return store.get(k) ?? '';
    },
    setLocalStorage: async (k: string, v: string): Promise<boolean> => {
      writes.push([k, v]);
      store.set(k, v);
      return true;
    },
  };
  return { kv: createKV(bridgeStorage(bridge, new SerialQueue(4000))), store, writes, reads };
}

/** Réglages enregistrés d'une personne qui utilise Quai depuis la 1.2.10 : un favori, la version vue. */
const SAVED = settingsWith([PLACES.bureau], { seenVersion: '1.2.10' });

/** Lit les réglages comme main.ts, les lectures du pont sans réponse comprises (minuteries simulées). */
async function readAtLaunch(kv: ReturnType<typeof createKV>) {
  vi.useFakeTimers();
  const p = loadSettings(kv);
  await vi.advanceTimersByTimeAsync(11_000);
  const s = await p;
  vi.useRealTimers();
  return s;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('point 3 : réglages illisibles au lancement', () => {
  it('deux lectures sans réponse : réglages par défaut, rien n’est écrit tant que la personne ne change rien ; les favoris restent enregistrés', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // sans la correction : la lecture sans réponse donnait les réglages par défaut, et les lunettes écrivaient aussitôt
    // { favorites: [], seenVersion: '1.3.1' } à la place des réglages enregistrés (markSeen)
    const p = phoneStorage({ [SETTINGS_KEY]: JSON.stringify(SAVED), [FIRST_USE_KEY]: String(NOW - 30 * 86_400_000) }, (k) => k === SETTINGS_KEY);
    const settings = await readAtLaunch(p.kv);
    expect(settings.favorites).toEqual([]);
    expect(settings.seenVersion).toBe('');
    // la lecture stricte, puis un second essai
    expect(p.reads.get(SETTINGS_KEY)).toBe(2);
    const k = await setup({ now: NOW, kv: p.kv, settings });
    await k.settle(200);
    // le contrôleur a démarré (écran de bienvenue des réglages par défaut), sans rien écrire : ni les réglages (version
    // vue), ni la date du premier lancement (elle dépend de la version vue)
    expect(k.logs).toContain('QUAI_READY');
    expect(k.settings.unread).toBe(true);
    expect(p.writes.map(([key]) => key)).toEqual([]);
    expect(JSON.parse(p.store.get(SETTINGS_KEY)!)).toEqual(JSON.parse(JSON.stringify(SAVED)));
    // un changement de la personne : enregistré, et la suite est normale
    await k.settings.update((x) => ({ ...x, maxWalkMin: 15 }));
    expect(k.settings.unread).toBe(false);
    expect(JSON.parse(p.store.get(SETTINGS_KEY)!).maxWalkMin).toBe(15);
    k.c.stop();
  });

  it('la première lecture sans réponse, la seconde répond : les réglages enregistrés, et la suite comme avant (version vue écrite)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = phoneStorage({ [SETTINGS_KEY]: JSON.stringify(SAVED) }, (k, n) => k === SETTINGS_KEY && n === 1);
    const settings = await readAtLaunch(p.kv);
    expect(p.reads.get(SETTINGS_KEY)).toBe(2);
    expect(settings.favorites.map((f) => f.id)).toEqual([PLACES.bureau.id]);
    expect(settings.seenVersion).toBe('1.2.10');
    const k = await setup({ now: NOW, kv: p.kv, settings });
    await k.settle(200);
    expect(k.settings.unread).toBe(false);
    // message « Quai 1.3.0 » vu : la version est écrite, les favoris avec
    const saved = JSON.parse(p.store.get(SETTINGS_KEY)!);
    expect(saved.seenVersion).toBe(APP_VERSION);
    expect(saved.favorites.map((f: { id: string }) => f.id)).toEqual([PLACES.bureau.id]);
    k.c.stop();
  });

  it('réglages absents (nouvelle installation) : une seule lecture, réglages par défaut écrits comme avant', async () => {
    const p = phoneStorage({}, () => false);
    const settings = await readAtLaunch(p.kv);
    expect(p.reads.get(SETTINGS_KEY)).toBe(1);
    const k = await setup({ now: NOW, kv: p.kv, settings });
    await k.settle(200);
    expect(k.settings.unread).toBe(false);
    expect(JSON.parse(p.store.get(SETTINGS_KEY)!).seenVersion).toBe(APP_VERSION);
    // premier lancement : sa date (maintenant), comme avant
    expect(Number(p.store.get(FIRST_USE_KEY))).toBe(NOW);
    k.c.stop();
  });
});
