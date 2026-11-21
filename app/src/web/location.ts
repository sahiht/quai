/**
 * Quai Web : position du navigateur (navigator.geolocation, en https) ou endroit choisi à la main (adresse, lieu,
 * gare ou arrêt) quand la position est refusée, indisponible ou trop imprécise. L'endroit choisi est gardé dans ce
 * navigateur.
 * Ne lève jamais ; l'état sert aux messages (rubrique « Position »).
 *
 * 1.2.10 (PRD-1.2.10 § 3.7) : positions continues pendant un guidage (`watch`, watchPosition), avec le même tri que
 * l'appli Even (platform/location.ts). Endroit choisi à la main : pas de flux (le guidage avance à l'heure), last()
 * inchangé ; le flux reprend si l'on revient à la position du navigateur. Mode test : position simulée (une fois au
 * départ du flux) et window.__quaiPushFix.
 */
import { browserWatch, isE2E, lazyPushTarget, pushedFix, singleFlux, watchOptions, type GeoWatch } from '../platform/location';
import { apos } from '../core/typo';
import type { Fix, LocationPort } from '../platform/types';

export type WebLocationState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'gps'; accuracy?: number }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'insecure' }
  | { kind: 'unsupported' }
  | { kind: 'manual'; label: string }
  | { kind: 'mock' };

export interface ManualPosition {
  lat: number;
  lon: number;
  label: string;
}

export interface WebLocation extends LocationPort {
  state(): WebLocationState;
  /** Prévenu à chaque changement d'état (et quand la permission passe à « accordée »). */
  subscribe(cb: (s: WebLocationState) => void): () => void;
  /** Endroit choisi (null : revenir à la position du navigateur). */
  setManual(p: ManualPosition | null): void;
  manual(): ManualPosition | null;
  /** Mode test (?e2e=1&mockLat&mockLon) : position fixe. */
  useMock(lat: number, lon: number): void;
}

export const MANUAL_KEY = 'quai.web.position';

interface GeoLike {
  getCurrentPosition(ok: (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void, err: (e: { code: number }) => void, o?: PositionOptions): void;
  /** 1.2.10 : flux du guidage. */
  watchPosition?: GeoWatch['watchPosition'];
  clearWatch?: GeoWatch['clearWatch'];
}
interface StoreLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
interface PermissionsLike {
  query(d: { name: 'geolocation' }): Promise<{ state: string; addEventListener?(t: 'change', cb: () => void): void; onchange?: unknown }>;
}

export interface WebLocationOptions {
  geo?: GeoLike | null;
  secure?: boolean;
  store?: StoreLike | null;
  permissions?: PermissionsLike | null;
  /** 1.2.10 : mode test (?e2e=1 par défaut) : window.__quaiPushFix. */
  e2e?: boolean;
}

const valid = (lat: unknown, lon: unknown): lat is number =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

function readManual(store: StoreLike | null): ManualPosition | null {
  try {
    const raw = store?.getItem(MANUAL_KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as Partial<ManualPosition>;
    return valid(x.lat, x.lon) && typeof x.label === 'string' && x.label.trim() ? { lat: x.lat, lon: x.lon as number, label: x.label.trim().slice(0, 80) } : null;
  } catch {
    return null;
  }
}

function defaults(): Required<WebLocationOptions> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    e2e: isE2E(),
    geo: nav && 'geolocation' in nav ? (nav.geolocation as GeoLike) : null,
    secure: typeof window === 'undefined' ? true : window.isSecureContext !== false,
    store: (() => {
      try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
      } catch {
        return null;
      }
    })(),
    permissions: nav && 'permissions' in nav ? (nav.permissions as unknown as PermissionsLike) : null,
  };
}

export function createWebLocation(now: () => number, options: WebLocationOptions = {}): WebLocation {
  const o = { ...defaults(), ...options };
  const listeners = new Set<(s: WebLocationState) => void>();
  let state: WebLocationState = { kind: 'idle' };
  let lastFix: Fix | null = null;
  let manual = readManual(o.store);
  let mock: { lat: number; lon: number } | null = null;
  let inflight: Promise<Fix | null> | null = null;
  /** 1.2.10 : dernière position poussée en mode test (last() la rend telle quelle). */
  let pushedMock: Fix | null = null;
  const flux = singleFlux(() => undefined);
  /** Arrêt du watchPosition en cours (null : pas de flux du navigateur). */
  let geoStop: (() => void) | null = null;
  /** Flux pour lequel le watchPosition tourne. */
  let geoFor: unknown = null;

  const set = (s: WebLocationState): void => {
    if (JSON.stringify(s) === JSON.stringify(state)) return;
    state = s;
    for (const l of [...listeners]) l(state);
  };
  const manualFix = (m: ManualPosition): Fix => ({ lat: m.lat, lon: m.lon, accuracy: 30, at: now(), source: 'manual' });
  if (manual) state = { kind: 'manual', label: manual.label };
  const mockFix = (): Fix =>
    pushedMock && mock ? { ...pushedMock, at: now() } : { lat: mock!.lat, lon: mock!.lon, accuracy: 5, at: now(), source: 'mock' };

  /** Position du navigateur reçue par le flux : comme une réponse de current(). */
  const gpsFix = (f: Fix): void => {
    lastFix = f;
    set({ kind: 'gps', ...(f.accuracy !== undefined ? { accuracy: f.accuracy } : {}) });
  };

  /**
   * Le watchPosition tourne seulement s'il y a un flux, sans position simulée ni endroit choisi, en https, avec l'API et
   * sans refus.
   */
  function syncStream(): void {
    const f = flux.current();
    const want = !!f && !mock && !manual && o.secure && typeof o.geo?.watchPosition === 'function' && state.kind !== 'denied';
    if (geoStop && (!want || geoFor !== f)) {
      geoStop();
      geoStop = null;
      geoFor = null;
    }
    if (!want || geoStop || !f) return;
    const geo = o.geo!;
    let stopped = false;
    const stopWatch = browserWatch(
      {
        watchPosition: (ok, err, opts) =>
          geo.watchPosition!(ok, (e) => {
            if (!stopped && e?.code === 1) {
              // refusée : plus de position du navigateur, le flux s'arrête jusqu'à une nouvelle permission
              lastFix = null;
              set({ kind: 'denied' });
              syncStream();
            }
            err?.(e);
          }, opts),
        clearWatch: (id) => geo.clearWatch?.(id),
      },
      f.opts,
      now,
      (fix) => {
        if (stopped || manual || mock) return;
        if (flux.deliver(f, fix, true)) gpsFix(fix);
      },
    );
    geoStop = () => {
      stopped = true;
      stopWatch();
    };
    geoFor = f;
  }

  const touch = lazyPushTarget(o.e2e, {
    push(p) {
      const f = pushedFix(p, now());
      if (!f) return false;
      if (mock) {
        mock = { lat: f.lat, lon: f.lon };
        pushedMock = f;
      } else if (manual) {
        // endroit choisi : il garde la main, comme pour une vraie position
        return false;
      } else gpsFix(f);
      const fl = flux.current();
      if (fl) flux.deliver(fl, f, false);
      return true;
    },
  });

  function ask(timeoutMs: number): Promise<Fix | null> {
    const geo = o.geo;
    if (!o.secure) {
      set({ kind: 'insecure' });
      return Promise.resolve(null);
    }
    if (!geo) {
      set({ kind: 'unsupported' });
      return Promise.resolve(null);
    }
    if (!lastFix && state.kind !== 'denied') set({ kind: 'pending' });
    return new Promise((resolve) => {
      let done = false;
      const finish = (f: Fix | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(f);
      };
      const timer = setTimeout(() => {
        if (!lastFix) set({ kind: 'unavailable' });
        finish(null);
      }, timeoutMs + 500);
      try {
        geo.getCurrentPosition(
          (p) => {
            if (done || manual || mock) return finish(null);
            if (!valid(p.coords.latitude, p.coords.longitude)) {
              if (!lastFix) set({ kind: 'unavailable' });
              return finish(null);
            }
            const accuracy = typeof p.coords.accuracy === 'number' && Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : undefined;
            set({ kind: 'gps', ...(accuracy !== undefined ? { accuracy } : {}) });
            finish({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy, at: now(), source: 'browser' });
          },
          (e) => {
            if (done || manual || mock) return finish(null);
            // 1 : refusée (définitif tant que l'utilisateur ne change pas le réglage du site) ; 2, 3 : indisponible, délai
            if (e?.code === 1) {
              lastFix = null;
              set({ kind: 'denied' });
            } else if (!lastFix) set({ kind: 'unavailable' });
            finish(null);
          },
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 20_000 },
        );
      } catch {
        if (!lastFix) set({ kind: 'unavailable' });
        finish(null);
      }
    });
  }

  const loc: WebLocation = {
    current(timeoutMs = 8000) {
      touch();
      if (mock) return Promise.resolve(mockFix());
      if (manual) return Promise.resolve(manualFix(manual));
      if (!inflight) {
        inflight = ask(timeoutMs)
          .then((f) => {
            if (f) lastFix = f;
            return f ?? (state.kind === 'denied' ? null : lastFix);
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    last() {
      touch();
      if (mock) return pushedMock ?? mockFix();
      if (manual) return manualFix(manual);
      return lastFix;
    },
    state: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setManual(p) {
      manual = p && valid(p.lat, p.lon) ? { lat: p.lat, lon: p.lon, label: p.label.trim().slice(0, 80) || 'Endroit choisi' } : null;
      try {
        if (manual) o.store?.setItem(MANUAL_KEY, JSON.stringify(manual));
        else o.store?.removeItem(MANUAL_KEY);
      } catch {
        /* stockage plein ou interdit : le choix vaut pour cette visite */
      }
      if (manual) set({ kind: 'manual', label: manual.label });
      else set(lastFix ? { kind: 'gps', ...(lastFix.accuracy !== undefined ? { accuracy: lastFix.accuracy } : {}) } : { kind: 'idle' });
      syncStream();
    },
    manual: () => manual,
    useMock(lat, lon) {
      touch();
      mock = { lat, lon };
      pushedMock = null;
      set({ kind: 'mock' });
      syncStream();
    },
    watch(opts, cb) {
      touch();
      return flux.watch(watchOptions(opts), cb, (f) => {
        // position simulée : donnée une fois au départ du flux (puis les positions poussées)
        if (mock) void Promise.resolve().then(() => mock && flux.deliver(f, mockFix(), false));
        syncStream();
        return () => {
          if (geoFor === f) {
            geoStop?.();
            geoStop = null;
            geoFor = null;
          }
        };
      });
    },
  };

  // Permission déjà refusée : on le dit sans attendre ; accordée plus tard : nouvelle position.
  void (async () => {
    try {
      const p = await o.permissions?.query({ name: 'geolocation' });
      if (!p) return;
      if (p.state === 'denied' && !manual && !mock) set({ kind: 'denied' });
      p.addEventListener?.('change', () => {
        if (p.state === 'denied') {
          lastFix = null;
          if (!manual && !mock) set({ kind: 'denied' });
        } else if (p.state === 'granted' && !manual && !mock) {
          void loc.current().then(() => {
            for (const l of [...listeners]) l(state);
            syncStream();
          });
        }
      });
    } catch {
      /* API des permissions absente : l'état vient de la première demande */
    }
  })();

  return loc;
}

/** Texte de l'état de la position, pour la rubrique « Position ». */
export function locationText(s: WebLocationState): string {
  switch (s.kind) {
    case 'idle':
    case 'pending':
      return 'Recherche de ta position…';
    case 'gps': {
      if (s.accuracy === undefined) return 'Position du navigateur.';
      if (s.accuracy > 1000) return 'Position du navigateur très approximative : choisis une adresse ou un arrêt pour plus de précision.';
      return `Position du navigateur, précise à ${Math.max(10, Math.round(s.accuracy / 10) * 10)} m.`;
    }
    case 'denied':
      return 'Position refusée par le navigateur. Pour l’autoriser : réglages du site (le cadenas à côté de l’adresse), Position, Autoriser. Ou choisis une adresse ou un arrêt ci-dessous.';
    case 'unavailable':
      return 'Position indisponible pour l’instant (pas de signal ou délai dépassé). Choisis une adresse ou un arrêt ci-dessous, ou réessaie.';
    case 'insecure':
      return 'La position du navigateur demande une adresse en https. Choisis une adresse ou un arrêt ci-dessous.';
    case 'unsupported':
      return 'Ce navigateur ne donne pas la position. Choisis une adresse ou un arrêt ci-dessous.';
    case 'manual':
      // 1.3.1 (PRD-1.3.1 § 7) : un nom des données (« Braine-l'Alleud (gare SNCB) ») s'affiche avec « ’ » ; le libellé
      // enregistré (ManualPosition.label) ne change pas
      return `Position choisie : ${apos(s.label)}. Gardée dans ce navigateur.`;
    case 'mock':
      return 'Position simulée (mode test).';
  }
}
