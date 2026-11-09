/**
 * Horloge de l'appli. En mode test (?e2e=1&mockNow=ISO) elle démarre à l'instant donné puis avance
 * normalement (ou plus vite avec mockSpeed, pour parcourir un trajet en quelques secondes).
 */
export interface Clock {
  now(): number;
  /** Délai réel correspondant à un délai simulé (mockSpeed). */
  real(ms: number): number;
  /** Instantané pour l'état d'arrière-plan. */
  snapshot(): { now: number; speed: number; mocked: boolean };
  /** Reprend un instantané (horloge simulée seulement). */
  restore(s: { now: number }): void;
}

export function createClock(opts: { mockNow?: number; speed?: number; perfNow?: () => number } = {}): Clock {
  const perf = opts.perfNow ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  let origin = opts.mockNow;
  let t0 = perf();
  const mocked = origin !== undefined;
  const now = (): number => (origin === undefined ? Date.now() : Math.round(origin + (perf() - t0) * speed));
  return {
    now,
    real: (ms) => Math.max(0, Math.round(ms / speed)),
    snapshot: () => ({ now: now(), speed, mocked }),
    restore(s) {
      if (!mocked || !Number.isFinite(s.now)) return;
      origin = s.now;
      t0 = perf();
    },
  };
}
