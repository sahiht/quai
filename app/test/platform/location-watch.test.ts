/**
 * 1.2.10 (PRD-1.2.10 § 3.7) : LocationPort.watch de l'appli Even (SDK simulé), du navigateur (watchPosition simulé) et
 * de la position simulée : un seul flux, le dernier réglage gagne, arrêt propre, relance, erreurs, tri des positions,
 * vitesse et cap, last() qui suit ; mode test : window.__quaiPushFix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deviceLocation,
  fixOf,
  keepFix,
  metersBetween,
  mockLocation,
  pushedFix,
  pushFix,
  resetPushTargets,
  watchOptions,
  WATCH_REFRESH_MS,
  type GeoWatch,
  type SdkFix,
  type SdkLocationSource,
} from '../../src/platform/location';
import type { Fix, WatchOptions } from '../../src/platform/types';

afterEach(() => {
  resetPushTargets();
  vi.useRealTimers();
});

const HIGH: WatchOptions = { accuracy: 'high', intervalMs: 2000, distanceM: 5 };
const MEDIUM: WatchOptions = { accuracy: 'medium', intervalMs: 30_000, distanceM: 50 };
/** Liège-Guillemins, puis quelques mètres vers le nord. */
const GUI = { lat: 50.6245, lon: 5.5667 };
const north = (m: number) => GUI.lat + m / 110_540;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Faux SDK : start et stop enregistrés, positions poussées à la main. */
function fakeSdk(opts: { start?: () => Promise<boolean> } = {}) {
  const log: string[] = [];
  const subs = new Set<(l: SdkFix) => void>();
  const sdk: SdkLocationSource = {
    getAppLocation: vi.fn(async () => ({ latitude: GUI.lat, longitude: GUI.lon, accuracy: 9 })),
    startUpdates: vi.fn(async (o) => {
      log.push(`start ${o.accuracy} ${o.intervalMs} ${o.distanceFilter}`);
      return opts.start ? opts.start() : true;
    }),
    stopUpdates: vi.fn(async () => {
      log.push('stop');
      return true;
    }),
    onUpdate: vi.fn((cb) => {
      subs.add(cb);
      log.push('on');
      return () => {
        subs.delete(cb);
        log.push('off');
      };
    }),
  };
  return { sdk, log, push: (l: SdkFix) => [...subs].forEach((s) => s(l)), subs };
}

/** Faux navigator.geolocation (watchPosition / clearWatch). */
function fakeGeo() {
  const watches = new Map<number, { ok: Parameters<GeoWatch['watchPosition']>[0]; err?: Parameters<GeoWatch['watchPosition']>[1]; o?: PositionOptions }>();
  let n = 0;
  const geo: GeoWatch = {
    watchPosition: vi.fn((ok, err, o) => {
      watches.set(++n, { ok, err, o });
      return n;
    }),
    clearWatch: vi.fn((id: number) => void watches.delete(id)),
  };
  const emit = (lat: number, lon: number, extra: { accuracy?: number; speed?: number | null; heading?: number | null } = {}) =>
    [...watches.values()].forEach((w) => w.ok({ coords: { latitude: lat, longitude: lon, accuracy: extra.accuracy ?? 5, speed: extra.speed ?? null, heading: extra.heading ?? null } }));
  const fail = (code: number) => [...watches.values()].forEach((w) => w.err?.({ code }));
  return { geo, watches, emit, fail };
}

describe('lecture et tri des positions', () => {
  it('Fix : vitesse et cap quand donnés (iOS : -1 = inconnu), précision, âge de la mesure retranché', () => {
    expect(fixOf({ latitude: 50.62, longitude: 5.57, accuracy: 8, speed: 1.4, heading: 92, timestamp: 9_000 }, 100_000, 'sdk', 10_000)).toEqual({ lat: 50.62, lon: 5.57, accuracy: 8, speed: 1.4, heading: 92, at: 99_000, source: 'sdk' });
    expect(fixOf({ latitude: 50.62, longitude: 5.57, speed: -1, heading: -1, accuracy: -1 }, 5, 'sdk')).toEqual({ lat: 50.62, lon: 5.57, at: 5, source: 'sdk' });
    expect(fixOf({ latitude: 50.62, longitude: 5.57, heading: 360, speed: null }, 5, 'browser')?.heading).toBe(0);
    // horodatage absurde (futur, ou très ancien) : heure de réception
    expect(fixOf({ latitude: 50.62, longitude: 5.57, timestamp: 20_000 }, 100, 'sdk', 10_000)?.at).toBe(100);
    expect(fixOf({ latitude: 50.62, longitude: 5.57, timestamp: 1 }, 100, 'sdk', 10_000_000)?.at).toBe(100);
    for (const bad of [null, undefined, { latitude: 0, longitude: 0 }, { latitude: 91, longitude: 5 }, { latitude: Number.NaN, longitude: 5 }]) expect(fixOf(bad as SdkFix, 1, 'sdk')).toBeNull();
  });

  it('tri : jamais avant l’intervalle ; dès la distance ; précision doublée ; au moins toutes les 20 s immobile ; jamais plus ancienne', () => {
    const at = (t: number, m = 0, accuracy = 5): Fix => ({ lat: north(m), lon: GUI.lon, at: t, accuracy, source: 'sdk' });
    expect(keepFix(null, at(0), HIGH)).toBe(true);
    expect(keepFix(at(0), at(1000, 30), HIGH)).toBe(false);
    expect(keepFix(at(0), at(1800, 30), HIGH)).toBe(true);
    expect(keepFix(at(0), at(2000, 3), HIGH)).toBe(false);
    expect(keepFix(at(0), at(2000, 6), HIGH)).toBe(true);
    expect(keepFix(at(0, 0, 40), at(2000, 1, 18), HIGH)).toBe(true);
    expect(keepFix(at(0), at(WATCH_REFRESH_MS - 1, 1), HIGH)).toBe(false);
    expect(keepFix(at(0), at(WATCH_REFRESH_MS, 1), HIGH)).toBe(true);
    expect(keepFix(at(5000), at(4000, 100), HIGH)).toBe(false);
    expect(keepFix(at(0), at(20_000, 200), MEDIUM)).toBe(false);
    expect(keepFix(at(0), at(30_000, 0), MEDIUM)).toBe(true);
    // contrôle technique du 15/11 : l'hôte pousse à 30 s, parfois un peu avant ; une position à 29,6 s n'est plus
    // écartée (sinon la suivante, vers 60 s, arrivait au bord de la limite de fraîcheur du moteur)
    expect(keepFix(at(0), at(29_600, 0), MEDIUM)).toBe(true);
    expect(keepFix(at(0), at(22_500, 60), MEDIUM)).toBe(true);
    expect(keepFix(at(0), at(1_400, 30), HIGH)).toBe(false);
    expect(keepFix(at(0), at(1_500, 30), HIGH)).toBe(true);
    expect(metersBetween(GUI, { lat: north(100), lon: GUI.lon })).toBeCloseTo(100, 0);
    expect(watchOptions({ accuracy: 'medium', intervalMs: 10, distanceM: -3 })).toEqual({ accuracy: 'medium', intervalMs: 500, distanceM: 0 });
    expect(watchOptions(null)).toEqual(HIGH);
  });
});

describe('appli Even : startAppLocationUpdates et onAppLocationChanged', () => {
  it('flux : précision demandée, tri fait par Quai (distanceFilter 0), vitesse et cap, last() qui suit, arrêt propre', async () => {
    let t = 0;
    const s = fakeSdk();
    const loc = deviceLocation(s.sdk, () => t, { e2e: false, geo: null });
    const got: Fix[] = [];
    const stop = loc.watch!(HIGH, (f) => got.push(f));
    await flush();
    expect(s.log).toEqual(['on', 'start high 2000 0']);
    s.push({ latitude: GUI.lat, longitude: GUI.lon, accuracy: 6, speed: 1.3, heading: 10 });
    t = 1000;
    s.push({ latitude: north(20), longitude: GUI.lon, accuracy: 6 }); // trop tôt
    t = 2500;
    s.push({ latitude: north(2), longitude: GUI.lon, accuracy: 6 }); // trop près
    t = 4000;
    s.push({ latitude: north(12), longitude: GUI.lon, accuracy: 6, speed: 1.4, heading: 12 });
    expect(got.map((f) => [f.at, f.speed, f.heading, f.source])).toEqual([
      [0, 1.3, 10, 'sdk'],
      [4000, 1.4, 12, 'sdk'],
    ]);
    expect(loc.last()).toEqual(got[1]);
    stop();
    await flush();
    expect(s.log.slice(2)).toEqual(['off', 'stop']);
    t = 9000;
    s.push({ latitude: north(80), longitude: GUI.lon });
    expect(got).toHaveLength(2);
    // arrêt appelé deux fois : rien de plus
    stop();
    await flush();
    expect(s.log.filter((l) => l === 'stop')).toHaveLength(1);
  });

  it('nouvel appel : un seul flux, le dernier réglage gagne ; l’arrêt de l’ancien flux ne fait plus rien', async () => {
    let t = 0;
    const s = fakeSdk();
    const loc = deviceLocation(s.sdk, () => t, { e2e: false, geo: null });
    const a: Fix[] = [];
    const b: Fix[] = [];
    const stopA = loc.watch!(MEDIUM, (f) => a.push(f));
    const stopB = loc.watch!(HIGH, (f) => b.push(f));
    await flush();
    // le premier flux, remplacé avant d'avoir démarré, ne démarre pas (ni ne s'arrête) chez l'hôte
    expect(s.log).toEqual(['on', 'off', 'on', 'start high 2000 0']);
    expect(s.subs.size).toBe(1);
    s.push({ latitude: GUI.lat, longitude: GUI.lon });
    expect([a.length, b.length]).toEqual([0, 1]);
    stopA();
    await flush();
    expect(s.log.at(-1)).toBe('start high 2000 0');
    t = 3000;
    s.push({ latitude: north(10), longitude: GUI.lon });
    expect(b).toHaveLength(2);
    // même réglage : la source continue, seul le rappel change (pas d'arrêt ni de relance)
    const c: Fix[] = [];
    const stopC = loc.watch!(HIGH, (f) => c.push(f));
    await flush();
    expect(s.log.at(-1)).toBe('start high 2000 0');
    t = 6000;
    s.push({ latitude: north(30), longitude: GUI.lon });
    expect([b.length, c.length]).toEqual([2, 1]);
    stopB();
    t = 9000;
    s.push({ latitude: north(60), longitude: GUI.lon });
    expect(c).toHaveLength(2);
    stopC();
    await flush();
    expect(s.log.at(-1)).toBe('stop');
    // relance après l'arrêt : un nouveau flux complet
    loc.watch!(HIGH, () => undefined);
    await flush();
    expect(s.log.slice(-2)).toEqual(['on', 'start high 2000 0']);
    // réglage changé flux démarré : arrêt chez l'hôte puis nouveau départ, dans cet ordre
    loc.watch!(MEDIUM, () => undefined);
    await flush();
    expect(s.log.slice(-4)).toEqual(['off', 'on', 'stop', 'start medium 30000 0']);
  });

  it('hôte qui ne connaît pas le flux (simulateur) ou le refuse : repli sur watchPosition ; rappel qui lève sans effet', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const g = fakeGeo();
    const s = fakeSdk({ start: async () => Promise.reject(new Error('unknown variant `startAppLocationUpdates`')) });
    const loc = deviceLocation(s.sdk, () => 0, { e2e: false, geo: g.geo });
    const got: Fix[] = [];
    const stop = loc.watch!(MEDIUM, (f) => {
      got.push(f);
      throw new Error('rappel en erreur');
    });
    await flush();
    expect(g.watches.size).toBe(1);
    expect([...g.watches.values()][0].o).toMatchObject({ enableHighAccuracy: false });
    g.emit(GUI.lat, GUI.lon, { speed: 2, heading: 180 });
    expect(got).toEqual([expect.objectContaining({ source: 'browser', speed: 2, heading: 180 })]);
    stop();
    await flush();
    expect(g.watches.size).toBe(0);
    // ensuite, l'hôte n'est plus essayé
    loc.watch!(HIGH, () => undefined);
    expect(g.watches.size).toBe(1);
    await flush();
    expect(s.sdk.startUpdates).toHaveBeenCalledTimes(1);
    // hôte qui répond « non » : repli aussi
    const g2 = fakeGeo();
    const refused = fakeSdk({ start: async () => false });
    deviceLocation(refused.sdk, () => 0, { e2e: false, geo: g2.geo }).watch!(HIGH, () => undefined);
    await flush();
    expect(g2.watches.size).toBe(1);
    err.mockRestore();
  });

  it('sans position possible (ni SDK ni navigateur) : rien, jamais d’erreur', async () => {
    const loc = deviceLocation(null, () => 0, { e2e: false, geo: null });
    const cb = vi.fn();
    const stop = loc.watch!(HIGH, cb);
    await flush();
    stop();
    expect(cb).not.toHaveBeenCalled();
    expect(loc.last()).toBeNull();
    // navigateur qui lève à l'appel : rien non plus
    const throwing: GeoWatch = {
      watchPosition: () => {
        throw new Error('interdit');
      },
      clearWatch: () => undefined,
    };
    expect(() => deviceLocation(null, () => 0, { e2e: false, geo: throwing }).watch!(HIGH, cb)()).not.toThrow();
  });
});

describe('navigateur (plateforme de développement) : watchPosition', () => {
  it('haute précision pour high, refus sans effet, arrêt : clearWatch', async () => {
    let t = 0;
    const g = fakeGeo();
    const loc = deviceLocation(null, () => t, { e2e: false, geo: g.geo });
    const got: Fix[] = [];
    const stop = loc.watch!(HIGH, (f) => got.push(f));
    expect([...g.watches.values()][0].o).toMatchObject({ enableHighAccuracy: true, maximumAge: 2000 });
    g.emit(GUI.lat, GUI.lon);
    t = 2500;
    g.emit(north(8), GUI.lon, { heading: Number.NaN });
    g.fail(1);
    expect(got.map((f) => f.at)).toEqual([0, 2500]);
    expect(got[1]).not.toHaveProperty('heading');
    expect(loc.last()?.at).toBe(2500);
    stop();
    expect(g.watches.size).toBe(0);
  });
});

describe('position simulée et window.__quaiPushFix (mode test)', () => {
  it('position simulée : donnée une fois au départ du flux, puis les positions poussées ; last() les suit', async () => {
    let t = 1000;
    const loc = mockLocation(GUI.lat, GUI.lon, () => t, { e2e: true });
    const got: Fix[] = [];
    const stop = loc.watch!(HIGH, (f) => got.push(f));
    await flush();
    expect(got).toEqual([{ lat: GUI.lat, lon: GUI.lon, accuracy: 5, at: 1000, source: 'mock' }]);
    t = 2000;
    expect((globalThis as { __quaiPushFix?: (p: unknown) => boolean }).__quaiPushFix!({ lat: north(50), lon: GUI.lon, accuracy: 8, speed: 1.2, heading: 0 })).toBe(true);
    // poussée : jamais filtrée (le test décide), même à 1 ms d'intervalle
    t = 2001;
    expect(pushFix({ lat: north(51), lon: GUI.lon, at: 1500 })).toBe(true);
    expect(got.slice(1)).toEqual([
      { lat: north(50), lon: GUI.lon, accuracy: 8, speed: 1.2, heading: 0, at: 2000, source: 'mock' },
      { lat: north(51), lon: GUI.lon, at: 1500, source: 'mock' },
    ]);
    expect(loc.last()).toEqual(got[2]);
    // current() : la position simulée lue maintenant
    t = 9000;
    expect(await loc.current()).toMatchObject({ lat: north(51), lon: GUI.lon, at: 9000, source: 'mock' });
    stop();
    expect(pushFix({ lat: north(60), lon: GUI.lon })).toBe(true);
    expect(got).toHaveLength(3);
    expect(loc.last()?.lat).toBe(north(60));
  });

  it('appli Even en mode test : la position poussée va au flux et à last(), sans tri', async () => {
    let t = 0;
    const s = fakeSdk();
    const loc = deviceLocation(s.sdk, () => t, { e2e: true, geo: null });
    const got: Fix[] = [];
    loc.watch!(HIGH, (f) => got.push(f));
    t = 10;
    expect(pushFix({ lat: GUI.lat, lon: GUI.lon })).toBe(true);
    t = 11;
    expect(pushFix({ lat: GUI.lat, lon: GUI.lon, accuracy: 3 })).toBe(true);
    expect(got.map((f) => f.at)).toEqual([10, 11]);
    expect(loc.last()).toEqual(got[1]);
  });

  it('position invalide refusée ; aucun port en service : faux ; hors mode test : pas de window.__quaiPushFix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(pushFix({ lat: 0, lon: 0 })).toBe(false);
    expect(pushFix({ lat: 'x', lon: 5 })).toBe(false);
    expect(pushFix(null)).toBe(false);
    expect(pushFix({ lat: 50.8, lon: 4.3 })).toBe(false);
    const loc = mockLocation(GUI.lat, GUI.lon, () => 0, { e2e: false });
    loc.last();
    expect((globalThis as { __quaiPushFix?: unknown }).__quaiPushFix).toBeUndefined();
    expect(pushFix({ lat: 50.8, lon: 4.3 })).toBe(false);
    // port créé mais jamais utilisé (remplacé, ?mockPath) : pas inscrit
    mockLocation(GUI.lat, GUI.lon, () => 0, { e2e: true });
    expect(pushFix({ lat: 50.8, lon: 4.3 })).toBe(false);
    expect(pushedFix({ lat: 50.8, lon: 4.3, heading: 450, speed: -2, accuracy: Number.NaN }, 7)).toEqual({ lat: 50.8, lon: 4.3, heading: 90, at: 7, source: 'mock' });
    warn.mockRestore();
  });
});
