/**
 * Quai Web : position du navigateur (navigator.geolocation, en https) ou endroit choisi à la main (adresse, lieu,
 * gare ou arrêt) quand la position est refusée, indisponible ou trop imprécise. L'endroit choisi est gardé dans ce
 * navigateur.
 * Ne lève jamais ; l'état sert aux messages (rubrique « Position »).
 */
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

  const set = (s: WebLocationState): void => {
    if (JSON.stringify(s) === JSON.stringify(state)) return;
    state = s;
    for (const l of [...listeners]) l(state);
  };
  const manualFix = (m: ManualPosition): Fix => ({ lat: m.lat, lon: m.lon, accuracy: 30, at: now(), source: 'manual' });
  if (manual) state = { kind: 'manual', label: manual.label };

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
      if (mock) return Promise.resolve({ lat: mock.lat, lon: mock.lon, accuracy: 5, at: now(), source: 'mock' });
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
      if (mock) return { lat: mock.lat, lon: mock.lon, accuracy: 5, at: now(), source: 'mock' };
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
    },
    manual: () => manual,
    useMock(lat, lon) {
      mock = { lat, lon };
      set({ kind: 'mock' });
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
      return `Position choisie : ${s.label}. Gardée dans ce navigateur.`;
    case 'mock':
      return 'Position simulée (mode test).';
  }
}
