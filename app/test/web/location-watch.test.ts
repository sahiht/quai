/**
 * 1.2.10 (PRD-1.2.10 § 3.7) : positions continues de Quai Web (watchPosition) : flux, tri, arrêt, refus ; endroit
 * choisi à la main : pas de flux, last() inchangé, reprise au retour du navigateur ; position simulée et
 * window.__quaiPushFix en mode test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushFix, resetPushTargets, type GeoWatch } from '../../src/platform/location';
import type { Fix, WatchOptions } from '../../src/platform/types';
import { createWebLocation } from '../../src/web/location';

afterEach(() => resetPushTargets());

const HIGH: WatchOptions = { accuracy: 'high', intervalMs: 2000, distanceM: 5 };
const FLAGEY = { lat: 50.8275, lon: 4.3722 };
const north = (m: number) => FLAGEY.lat + m / 110_540;
const flush = () => new Promise((r) => setTimeout(r, 0));

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function fakeGeo() {
  const watches = new Map<number, { ok: Parameters<GeoWatch['watchPosition']>[0]; err?: Parameters<GeoWatch['watchPosition']>[1]; o?: PositionOptions }>();
  let n = 0;
  return {
    watches,
    geo: {
      getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void) => ok({ coords: { latitude: FLAGEY.lat, longitude: FLAGEY.lon, accuracy: 20 } }),
      watchPosition: vi.fn((ok: Parameters<GeoWatch['watchPosition']>[0], err?: Parameters<GeoWatch['watchPosition']>[1], o?: PositionOptions) => {
        watches.set(++n, { ok, err, o });
        return n;
      }),
      clearWatch: vi.fn((id: number) => void watches.delete(id)),
    },
    emit(lat: number, accuracy = 6) {
      [...watches.values()].forEach((w) => w.ok({ coords: { latitude: lat, longitude: FLAGEY.lon, accuracy, speed: 1.1, heading: 45 } }));
    },
    fail(code: number) {
      [...watches.values()].forEach((w) => w.err?.({ code }));
    },
  };
}

describe('Quai Web : watchPosition pendant un guidage', () => {
  it('flux du navigateur : tri, vitesse et cap, état « gps » et last() qui suivent, arrêt : clearWatch', async () => {
    let t = 0;
    const g = fakeGeo();
    const loc = createWebLocation(() => t, { geo: g.geo, secure: true, store: memStore(), permissions: null, e2e: false });
    const got: Fix[] = [];
    const stop = loc.watch!(HIGH, (f) => got.push(f));
    expect(g.watches.size).toBe(1);
    expect([...g.watches.values()][0].o).toMatchObject({ enableHighAccuracy: true });
    g.emit(FLAGEY.lat, 12);
    t = 500;
    g.emit(north(30));
    t = 2500;
    g.emit(north(9), 7);
    expect(got.map((f) => [f.at, f.speed, f.heading, f.source])).toEqual([
      [0, 1.1, 45, 'browser'],
      [2500, 1.1, 45, 'browser'],
    ]);
    expect(loc.last()).toEqual(got[1]);
    expect(loc.state()).toEqual({ kind: 'gps', accuracy: 7 });
    stop();
    expect(g.watches.size).toBe(0);
    t = 9000;
    g.emit(north(80));
    expect(got).toHaveLength(2);
  });

  it('un seul flux : le nouveau réglage remplace l’ancien (un seul watchPosition), l’ancien arrêt ne fait rien', () => {
    const g = fakeGeo();
    const loc = createWebLocation(() => 0, { geo: g.geo, secure: true, store: memStore(), permissions: null, e2e: false });
    const stopA = loc.watch!({ accuracy: 'medium', intervalMs: 30_000, distanceM: 50 }, () => undefined);
    expect([...g.watches.values()][0].o).toMatchObject({ enableHighAccuracy: false });
    const b: Fix[] = [];
    const stopB = loc.watch!(HIGH, (f) => b.push(f));
    expect(g.watches.size).toBe(1);
    expect([...g.watches.values()][0].o).toMatchObject({ enableHighAccuracy: true });
    stopA();
    expect(g.watches.size).toBe(1);
    g.emit(FLAGEY.lat);
    expect(b).toHaveLength(1);
    stopB();
    expect(g.watches.size).toBe(0);
  });

  it('endroit choisi à la main : pas de flux, last() inchangé ; retour au navigateur : le flux reprend ; nouvel endroit : il s’arrête', () => {
    const g = fakeGeo();
    const loc = createWebLocation(() => 0, { geo: g.geo, secure: true, store: memStore(), permissions: null, e2e: false });
    loc.setManual({ lat: 50.6245, lon: 5.5667, label: 'Liège-Guillemins (gare SNCB)' });
    const got: Fix[] = [];
    const stop = loc.watch!(HIGH, (f) => got.push(f));
    expect(g.watches.size).toBe(0);
    expect(loc.last()).toMatchObject({ lat: 50.6245, lon: 5.5667, source: 'manual' });
    loc.setManual(null);
    expect(g.watches.size).toBe(1);
    g.emit(FLAGEY.lat);
    expect(got).toHaveLength(1);
    loc.setManual({ lat: 50.6245, lon: 5.5667, label: 'Liège-Guillemins (gare SNCB)' });
    expect(g.watches.size).toBe(0);
    expect(loc.last()).toMatchObject({ source: 'manual' });
    stop();
  });

  it('refus pendant le flux : état « refusée », flux arrêté, plus de position ; pas d’https ou pas d’API : rien', () => {
    const g = fakeGeo();
    const loc = createWebLocation(() => 0, { geo: g.geo, secure: true, store: memStore(), permissions: null, e2e: false });
    const got: Fix[] = [];
    loc.watch!(HIGH, (f) => got.push(f));
    g.fail(2);
    expect(g.watches.size).toBe(1);
    g.fail(1);
    expect(loc.state()).toEqual({ kind: 'denied' });
    expect(g.watches.size).toBe(0);
    expect(loc.last()).toBeNull();
    expect(got).toHaveLength(0);
    for (const o of [{ secure: false }, { geo: null }, { geo: { getCurrentPosition: () => undefined } }]) {
      const l = createWebLocation(() => 0, { geo: g.geo, secure: true, store: memStore(), permissions: null, e2e: false, ...o });
      const cb = vi.fn();
      expect(() => l.watch!(HIGH, cb)()).not.toThrow();
      expect(cb).not.toHaveBeenCalled();
    }
  });
});

describe('Quai Web en mode test : position simulée et window.__quaiPushFix', () => {
  it('position simulée donnée au départ du flux, puis chaque position poussée ; last() et current() la suivent', async () => {
    let t = 100;
    const g = fakeGeo();
    const loc = createWebLocation(() => t, { geo: g.geo, secure: true, store: memStore(), permissions: null, e2e: true });
    loc.useMock(FLAGEY.lat, FLAGEY.lon);
    const got: Fix[] = [];
    loc.watch!(HIGH, (f) => got.push(f));
    expect(g.watches.size).toBe(0);
    await flush();
    expect(got).toEqual([{ lat: FLAGEY.lat, lon: FLAGEY.lon, accuracy: 5, at: 100, source: 'mock' }]);
    t = 200;
    expect((globalThis as { __quaiPushFix?: (p: unknown) => boolean }).__quaiPushFix!({ lat: north(40), lon: FLAGEY.lon, speed: 1.2, heading: 350 })).toBe(true);
    expect(got[1]).toEqual({ lat: north(40), lon: FLAGEY.lon, speed: 1.2, heading: 350, at: 200, source: 'mock' });
    expect(loc.last()).toEqual(got[1]);
    t = 5000;
    expect(await loc.current()).toMatchObject({ lat: north(40), lon: FLAGEY.lon, at: 5000, source: 'mock' });
    expect(loc.state()).toEqual({ kind: 'mock' });
  });

  it('sans position simulée : la position poussée vaut une position du navigateur ; endroit choisi : il garde la main', () => {
    let t = 0;
    const loc = createWebLocation(() => t, { geo: null, secure: true, store: memStore(), permissions: null, e2e: true });
    const got: Fix[] = [];
    loc.watch!(HIGH, (f) => got.push(f));
    t = 10;
    expect(pushFix({ lat: FLAGEY.lat, lon: FLAGEY.lon, accuracy: 9 })).toBe(true);
    expect(got).toHaveLength(1);
    expect(loc.state()).toEqual({ kind: 'gps', accuracy: 9 });
    expect(loc.last()).toMatchObject({ lat: FLAGEY.lat, source: 'mock' });
    loc.setManual({ lat: 50.6245, lon: 5.5667, label: 'Liège-Guillemins (gare SNCB)' });
    expect(pushFix({ lat: north(50), lon: FLAGEY.lon })).toBe(false);
    expect(got).toHaveLength(1);
    expect(loc.last()).toMatchObject({ source: 'manual' });
  });
});
