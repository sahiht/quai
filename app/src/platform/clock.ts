/**
 * Horloge de l'appli. En mode test (?e2e=1&mockNow=ISO) elle démarre à l'instant donné puis avance
 * normalement (ou plus vite avec mockSpeed, pour parcourir un trajet en quelques secondes).
 *
 * 1.2.10 : en mode test (?e2e=1) seulement, window.__quaiClock.set(epochMs) règle l'horloge simulée (elle repart de
 * cet instant, à la même vitesse) et window.__quaiClock.now() la lit ; chaque réglage envoie l'événement
 * CLOCK_EVENT sur window (detail : { now }), pour qui veut recalculer tout de suite. Sans effet hors du mode test.
 */
import { isE2E } from './location';

export interface Clock {
  now(): number;
  /** Délai réel correspondant à un délai simulé (mockSpeed). */
  real(ms: number): number;
  /** Instantané pour l'état d'arrière-plan. */
  snapshot(): { now: number; speed: number; mocked: boolean };
  /** Reprend un instantané (horloge simulée seulement). */
  restore(s: { now: number }): void;
}

/** 1.2.10 : événement envoyé sur window à chaque réglage de l'horloge par window.__quaiClock.set. */
export const CLOCK_EVENT = 'quai-horloge';

/** Crochet du mode test : régler et lire l'horloge simulée. */
export interface ClockHook {
  /** Règle l'horloge simulée sur `epochMs` ; faux si la valeur n'est pas un instant valide. */
  set(epochMs: number): boolean;
  now(): number;
}

export function createClock(opts: { mockNow?: number; speed?: number; perfNow?: () => number; e2e?: boolean } = {}): Clock {
  const perf = opts.perfNow ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  let origin = opts.mockNow;
  let t0 = perf();
  let mocked = origin !== undefined;
  const now = (): number => (origin === undefined ? Date.now() : Math.round(origin + (perf() - t0) * speed));
  const clock: Clock = {
    now,
    real: (ms) => Math.max(0, Math.round(ms / speed)),
    snapshot: () => ({ now: now(), speed, mocked }),
    restore(s) {
      if (!mocked || !Number.isFinite(s.now)) return;
      origin = s.now;
      t0 = perf();
    },
  };
  if (opts.e2e ?? isE2E()) {
    const hook: ClockHook = {
      set(epochMs) {
        // instant plausible seulement (entre 2000 et 2100) : une erreur de test ne déplace pas l'horloge n'importe où
        if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs < 946_684_800_000 || epochMs > 4_102_444_800_000) {
          console.warn('[Quai] __quaiClock.set : instant invalide', epochMs);
          return false;
        }
        origin = epochMs;
        t0 = perf();
        mocked = true;
        try {
          const w = globalThis as { dispatchEvent?: (e: Event) => boolean };
          if (typeof w.dispatchEvent === 'function' && typeof CustomEvent === 'function') w.dispatchEvent(new CustomEvent(CLOCK_EVENT, { detail: { now: now() } }));
        } catch {
          /* pas de window (tests) */
        }
        return true;
      },
      now,
    };
    (globalThis as { __quaiClock?: ClockHook }).__quaiClock = hook;
  }
  return clock;
}
