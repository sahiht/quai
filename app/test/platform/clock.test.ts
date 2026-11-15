// @vitest-environment happy-dom
/**
 * 1.2.10 : crochet du mode test window.__quaiClock (régler l'horloge simulée), seulement avec ?e2e=1.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CLOCK_EVENT, createClock, type ClockHook } from '../../src/platform/clock';

const hook = () => (globalThis as { __quaiClock?: ClockHook }).__quaiClock;
afterEach(() => {
  delete (globalThis as { __quaiClock?: unknown }).__quaiClock;
});

describe('window.__quaiClock (mode test)', () => {
  it('set(epochMs) : l’horloge simulée repart de cet instant, à la même vitesse ; événement envoyé ; now() la lit', () => {
    let perf = 0;
    const clock = createClock({ mockNow: Date.parse('2026-11-16T07:00:00+01:00'), speed: 20, perfNow: () => perf, e2e: true });
    const seen: number[] = [];
    window.addEventListener(CLOCK_EVENT, (e) => seen.push((e as CustomEvent<{ now: number }>).detail.now));
    const t = Date.parse('2026-11-16T07:42:00+01:00');
    expect(hook()!.set(t)).toBe(true);
    expect(clock.now()).toBe(t);
    expect(hook()!.now()).toBe(t);
    perf = 1000;
    expect(clock.now()).toBe(t + 20_000);
    expect(clock.snapshot()).toEqual({ now: t + 20_000, speed: 20, mocked: true });
    expect(seen).toEqual([t]);
  });

  it('horloge réelle en mode test : set la rend simulée (et l’instantané se reprend ensuite) ; instant invalide refusé', () => {
    let perf = 0;
    const clock = createClock({ perfNow: () => perf, e2e: true });
    expect(clock.snapshot().mocked).toBe(false);
    for (const bad of [Number.NaN, -1, 0, 1e20, '2026-11-16' as unknown as number]) expect(hook()!.set(bad)).toBe(false);
    expect(clock.snapshot().mocked).toBe(false);
    const t = Date.parse('2026-11-16T23:30:00+01:00');
    expect(hook()!.set(t)).toBe(true);
    perf = 500;
    expect(clock.now()).toBe(t + 500);
    clock.restore({ now: t + 60_000 });
    expect(clock.now()).toBe(t + 60_000);
  });

  it('hors du mode test : pas de crochet', () => {
    createClock({ mockNow: 0, e2e: false });
    expect(hook()).toBeUndefined();
    createClock({});
    expect(hook()).toBeUndefined();
  });
});
