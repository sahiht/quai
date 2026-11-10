/**
 * Quai Web : écran gardé allumé pendant que l'écran des lunettes est visible (Screen Wake Lock API).
 * Sans l'API, ou si le navigateur refuse (batterie faible, page cachée), rien ne se passe.
 */
interface SentinelLike {
  released?: boolean;
  release(): Promise<void>;
  addEventListener?(t: 'release', cb: () => void): void;
}
interface WakeLockNav {
  wakeLock?: { request(type: 'screen'): Promise<SentinelLike> };
}
interface DocLike {
  visibilityState: string;
  addEventListener(t: 'visibilitychange', cb: () => void): void;
}

export interface WakeLock {
  /** Voulu ou non ; pris dès que la page est visible, repris quand elle le redevient. */
  set(on: boolean): void;
  readonly held: boolean;
}

export function screenWakeLock(nav: WakeLockNav = navigator as unknown as WakeLockNav, doc: DocLike = document): WakeLock {
  let wanted = false;
  let sentinel: SentinelLike | null = null;
  let asking = false;

  const sync = async (): Promise<void> => {
    if (!nav.wakeLock) return;
    if (wanted && doc.visibilityState === 'visible') {
      if ((sentinel && !sentinel.released) || asking) return;
      asking = true;
      try {
        const s = await nav.wakeLock.request('screen');
        s.addEventListener?.('release', () => {
          if (sentinel === s) sentinel = null;
        });
        sentinel = s;
        if (!wanted) void release();
      } catch {
        sentinel = null; // refus du navigateur : sans conséquence
      } finally {
        asking = false;
      }
    } else if (!wanted) {
      await release();
    }
  };
  const release = async (): Promise<void> => {
    const s = sentinel;
    sentinel = null;
    try {
      await s?.release();
    } catch {
      /* déjà relâché */
    }
  };
  doc.addEventListener('visibilitychange', () => void sync());
  return {
    set(on) {
      wanted = on;
      void sync();
    },
    get held() {
      return !!sentinel && !sentinel.released;
    },
  };
}
