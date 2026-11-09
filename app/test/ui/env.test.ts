import { describe, expect, it } from 'vitest';
import { parseEnv, testBase } from '../../src/env';
import { createClock } from '../../src/platform/clock';

describe('mode test (SPEC § 5.3)', () => {
  it('paramètres actifs seulement avec e2e=1', () => {
    const off = parseEnv('?mockLat=50&mockLon=4&mockNow=2026-11-10T07:31:00%2B01:00&reset=1&fake=1', false);
    expect(off).toEqual({ e2e: false, fake: false, reset: false, stale: false, noRt: false });
    const on = parseEnv('?e2e=1&fake=1&mockLat=50.4655&mockLon=4.859&mockNow=2026-11-10T07:31:00%2B01:00&mockSpeed=30&data=http://localhost:8787/&relay=http://localhost:8788&preset=/p.json&reset=1&stale=1', false);
    expect(on).toMatchObject({ e2e: true, fake: true, mockLat: 50.4655, mockLon: 4.859, mockSpeed: 30, data: 'http://localhost:8787', relay: 'http://localhost:8788', preset: '/p.json', reset: true, stale: true });
    expect(on.mockNow).toBe(Date.parse('2026-11-10T06:31:00Z'));
    expect(parseEnv('?e2e=1&browser=1', false).browser).toBe(true);
    expect(parseEnv('?browser=1', false).browser).toBeUndefined();
  });

  it('faux cœur accepté en développement', () => {
    expect(parseEnv('?fake=1', true).fake).toBe(true);
    expect(parseEnv('?fake=1', false).fake).toBe(false);
  });

  it('valeurs invalides ignorées', () => {
    const e = parseEnv('?e2e=1&mockLat=abc&mockLon=4&mockNow=hier&data=ftp://x&mockSpeed=-2', false);
    expect(e.mockLat).toBeUndefined();
    expect(e.mockNow).toBeUndefined();
    expect(e.data).toBeUndefined();
    expect(e.mockSpeed).toBeUndefined();
    expect(testBase('https://a.b/c/')).toBe('https://a.b/c');
  });

  it('horloge simulée qui avance (et plus vite avec mockSpeed)', () => {
    let t = 0;
    const clock = createClock({ mockNow: 1_000_000, speed: 60, perfNow: () => t });
    expect(clock.now()).toBe(1_000_000);
    t = 1000;
    expect(clock.now()).toBe(1_060_000);
    expect(clock.real(60_000)).toBe(1000);
    clock.restore({ now: 5_000_000 });
    expect(clock.now()).toBe(5_000_000);
    const real = createClock();
    expect(Math.abs(real.now() - Date.now())).toBeLessThan(50);
  });
});
