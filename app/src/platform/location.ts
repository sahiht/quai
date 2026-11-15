/**
 * Position du téléphone : API de l'appli Even (permission `location`, getAppLocation), repli sur
 * navigator.geolocation, ou position simulée (?e2e=1&mockLat&mockLon). Ne lève jamais.
 * Le simulateur 0.9.5 ne connaît pas getAppLocation (« unknown variant ») : on bascule alors
 * définitivement sur le repli navigateur.
 *
 * 1.2.10 (PRD-1.2.10 § 3.7) : positions continues pendant un guidage (`watch`) : startAppLocationUpdates et
 * onAppLocationChanged dans l'appli Even, watchPosition ailleurs. Un seul flux actif, le dernier réglage gagne. Le tri
 * (intervalle, distance) se fait ici, pas chez l'hôte (distanceFilter 0) : immobile à un arrêt, une position fraîche
 * arrive quand même toutes les 20 s, sinon le moteur croirait la position perdue (plus de 60 s) et ne verrait pas un
 * véhicule raté. La position reste sur le téléphone : rien ne part d'ici.
 *
 * Mode test (?e2e=1) : window.__quaiPushFix({ lat, lon, accuracy?, speed?, heading?, at? }) pousse une position vers le
 * flux actif et met à jour last() (tests/e2e/README.md).
 */
import type { Fix, LocationPort, WatchOptions } from './types';

/** Position telle que la donne le SDK (AppLocation) ou le navigateur (coords + timestamp). */
export interface SdkFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  /** epoch ms (heure de la mesure), si l'hôte la donne */
  timestamp?: number | null;
}

export interface SdkLocationSource {
  getAppLocation(opts: { accuracy?: string; timeoutMs?: number }): Promise<SdkFix | null>;
  /** 1.2.10 : début des positions continues (l'hôte pousse ensuite par onUpdate). */
  startUpdates?(opts: { accuracy: 'high' | 'medium'; intervalMs: number; distanceFilter: number }): Promise<boolean>;
  stopUpdates?(): Promise<boolean>;
  onUpdate?(cb: (l: SdkFix) => void): () => void;
}

/** Le strict nécessaire de navigator.geolocation pour un flux. */
export interface GeoWatch {
  watchPosition(
    ok: (p: { coords: { latitude: number; longitude: number; accuracy?: number | null; speed?: number | null; heading?: number | null }; timestamp?: number }) => void,
    err?: (e: { code: number }) => void,
    o?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
}

const valid = (lat: unknown, lon: unknown): boolean =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Nombre fini et positif ou nul, sinon absent (iOS : -1 = inconnu). */
const nonNeg = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Cap en degrés dans [0, 360), sinon absent (négatif : inconnu). */
const headingOf = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
  return v % 360;
};

/** Âge d'une mesure au plus pris en compte (au-delà, l'horloge de l'hôte est douteuse : heure de réception). */
const MAX_AGE_MS = 120_000;

/**
 * Position du SDK ou du navigateur → Fix ; null si les coordonnées sont invalides. `at` : heure de l'appli au moment de
 * la mesure (l'âge donné par l'horodatage de l'hôte est retranché, s'il est plausible).
 */
export function fixOf(l: SdkFix | null | undefined, now: number, source: Fix['source'], wallNow = Date.now()): Fix | null {
  if (!l || !valid(l.latitude, l.longitude)) return null;
  const ts = l.timestamp;
  const age = typeof ts === 'number' && Number.isFinite(ts) ? wallNow - ts : 0;
  const at = age >= 0 && age <= MAX_AGE_MS ? now - age : now;
  const f: Fix = { lat: l.latitude, lon: l.longitude, at, source };
  const accuracy = nonNeg(l.accuracy);
  const speed = nonNeg(l.speed);
  const heading = headingOf(l.heading);
  if (accuracy !== undefined) f.accuracy = accuracy;
  if (speed !== undefined) f.speed = speed;
  if (heading !== undefined) f.heading = heading;
  return f;
}

/* ------------------------------ Tri des positions d'un flux ------------------------------ */

/** Une position au moins toutes les 20 s pendant un flux, même immobile (le moteur oublie une position de plus de 60 s). */
export const WATCH_REFRESH_MS = 20_000;
/**
 * Tolérance sur l'intervalle : une position est gardée dès les trois quarts de l'intervalle demandé (l'hôte pousse à
 * 2 s, parfois 1,9 s ; à 30 s, parfois un peu avant : contrôle technique du 15/11, une position écartée de peu
 * doublait l'écart, près de la limite de 60 s du moteur).
 */
const INTERVAL_SHARE = 0.75;

/** Distance approchée en mètres (petites distances). */
export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (b.lon - a.lon) * 111_320 * k;
  const dy = (b.lat - a.lat) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Faut-il transmettre `next` après `prev` (la dernière transmise) ? Jamais une plus ancienne, jamais avant les trois
 * quarts de `intervalMs` ;
 * puis dès `distanceM` parcourus, dès que la précision double, ou au moins toutes les 20 s.
 */
export function keepFix(prev: Fix | null, next: Fix, o: WatchOptions): boolean {
  if (!prev) return true;
  const dt = next.at - prev.at;
  if (dt < 0 || dt < o.intervalMs * INTERVAL_SHARE) return false;
  if (dt >= WATCH_REFRESH_MS) return true;
  if (metersBetween(prev, next) >= o.distanceM) return true;
  return next.accuracy !== undefined && (prev.accuracy === undefined || next.accuracy <= prev.accuracy / 2);
}

/** Réglage borné (intervalle de 0,5 s à 10 min, distance de 0 à 1 km). */
export function watchOptions(o: Partial<WatchOptions> | null | undefined): WatchOptions {
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { accuracy: o?.accuracy === 'medium' ? 'medium' : 'high', intervalMs: num(o?.intervalMs, 2000, 500, 600_000), distanceM: num(o?.distanceM, 5, 0, 1000) };
}

const sameOpts = (a: WatchOptions, b: WatchOptions): boolean => a.accuracy === b.accuracy && a.intervalMs === b.intervalMs && a.distanceM === b.distanceM;

/** Appel d'un rappel de l'appli sans jamais laisser passer son erreur (la plateforme ne lève jamais). */
function safe(cb: (f: Fix) => void, f: Fix): void {
  try {
    cb(f);
  } catch (e) {
    console.error('[Quai] position : rappel en erreur', e);
  }
}

/** État d'un flux : réglage, rappel, dernière position transmise, arrêt de la source. */
interface Flux {
  token: number;
  opts: WatchOptions;
  cb: (f: Fix) => void;
  prev: Fix | null;
  stop: () => void;
}

/**
 * Flux unique : `watch` remplace le flux en cours (même réglage : la source continue, seul le rappel change). Les
 * positions d'une source arrêtée ou remplacée sont ignorées ; la fonction d'arrêt d'un flux remplacé ne fait rien.
 */
export function singleFlux(onDeliver: (f: Fix) => void) {
  let flux: Flux | null = null;
  let seq = 0;
  const stopToken = (token: number): void => {
    if (!flux || flux.token !== token) return;
    const f = flux;
    flux = null;
    f.stop();
  };
  return {
    /** `start(f)` lance la source du flux `f` et renvoie son arrêt. */
    watch(o: WatchOptions, cb: (f: Fix) => void, start: (f: Flux) => () => void): () => void {
      if (flux && sameOpts(flux.opts, o)) {
        flux.cb = cb;
        flux.token = ++seq;
      } else {
        const old = flux;
        flux = null;
        old?.stop();
        const f: Flux = { token: ++seq, opts: o, cb, prev: null, stop: () => undefined };
        flux = f;
        const stop = start(f);
        if (flux === f) f.stop = stop;
        else stop();
      }
      const token = flux ? flux.token : -1;
      return () => stopToken(token);
    },
    /** Position d'une source : transmise si son flux est toujours celui en cours (et, `filtered`, si le tri l'accepte). */
    deliver(f: Flux, fix: Fix, filtered: boolean): boolean {
      if (flux !== f) return false;
      if (filtered && !keepFix(f.prev, fix, f.opts)) return false;
      f.prev = fix;
      onDeliver(fix);
      safe(f.cb, fix);
      return true;
    },
    current: (): Flux | null => flux,
    stop(): void {
      if (flux) stopToken(flux.token);
    },
  };
}

/* ------------------------------ Mode test : __quaiPushFix ------------------------------ */

/** Position poussée par un test de bout en bout. */
export interface PushedFix {
  lat: number;
  lon: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  /** epoch ms, horloge de l'appli (défaut : maintenant) */
  at?: number;
}

/** Un port de position qui accepte les positions poussées ; vrai s'il l'a prise (last() mis à jour). */
export interface PushTarget {
  push(p: PushedFix): boolean;
}

const targets = new Set<PushTarget>();

/** Mode test : ?e2e=1 dans l'adresse de la page. */
export function isE2E(): boolean {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).get('e2e') === '1';
  } catch {
    return false;
  }
}

/** Position poussée → Fix (source mock) avec l'horloge de l'appli ; null si invalide. */
export function pushedFix(p: unknown, now: number): Fix | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  if (!valid(o.lat, o.lon)) return null;
  const f: Fix = { lat: o.lat as number, lon: o.lon as number, at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : now, source: 'mock' };
  const accuracy = nonNeg(o.accuracy);
  const speed = nonNeg(o.speed);
  const heading = headingOf(o.heading);
  if (accuracy !== undefined) f.accuracy = accuracy;
  if (speed !== undefined) f.speed = speed;
  if (heading !== undefined) f.heading = heading;
  return f;
}

/**
 * window.__quaiPushFix : pousse une position vers chaque port de position en service (flux actif et last()). Renvoie
 * vrai si au moins un port l'a prise ; faux si la position est invalide ou si aucun port n'est en service.
 */
export function pushFix(p: unknown): boolean {
  if (!p || typeof p !== 'object' || !valid((p as PushedFix).lat, (p as PushedFix).lon)) {
    console.warn('[Quai] __quaiPushFix : position invalide', p);
    return false;
  }
  let taken = false;
  for (const t of [...targets]) {
    try {
      taken = t.push(p as PushedFix) || taken;
    } catch (e) {
      console.error('[Quai] __quaiPushFix', e);
    }
  }
  return taken;
}

/** Inscrit un port (mode test seulement) et installe window.__quaiPushFix. */
export function registerPushTarget(t: PushTarget): () => void {
  targets.add(t);
  const g = globalThis as { __quaiPushFix?: (p: unknown) => boolean };
  if (typeof g.__quaiPushFix !== 'function') g.__quaiPushFix = pushFix;
  return () => targets.delete(t);
}

/** Tests : oublie les ports inscrits et retire window.__quaiPushFix. */
export function resetPushTargets(): void {
  targets.clear();
  delete (globalThis as { __quaiPushFix?: unknown }).__quaiPushFix;
}

/** Inscription au premier usage du port (un port créé puis remplacé, ?mockPath par exemple, ne prend rien). */
export function lazyPushTarget(e2e: boolean, t: PushTarget): () => void {
  let done = !e2e;
  return () => {
    if (done) return;
    done = true;
    registerPushTarget(t);
  };
}

/* ------------------------------ Ports ------------------------------ */

const microtask = (fn: () => void): void => void Promise.resolve().then(fn);

export function mockLocation(lat: number, lon: number, now: () => number, opts: { e2e?: boolean } = {}): LocationPort {
  let pos: Omit<Fix, 'at' | 'source'> = { lat, lon, accuracy: 5 };
  let pushed: Fix | null = null;
  const fresh = (): Fix => ({ ...pos, at: now(), source: 'mock' });
  const flux = singleFlux(() => undefined);
  const touch = lazyPushTarget(opts.e2e ?? isE2E(), {
    push(p) {
      const f = pushedFix(p, now());
      if (!f) return false;
      pos = { lat: f.lat, lon: f.lon, accuracy: f.accuracy ?? 5, ...(f.speed !== undefined ? { speed: f.speed } : {}), ...(f.heading !== undefined ? { heading: f.heading } : {}) };
      pushed = f;
      const fl = flux.current();
      if (fl) flux.deliver(fl, f, false);
      return true;
    },
  });
  return {
    current: async () => {
      touch();
      return fresh();
    },
    last: () => {
      touch();
      return pushed ?? fresh();
    },
    watch(o, cb) {
      touch();
      // position simulée : le flux la donne une fois au départ, puis seulement les positions poussées
      return flux.watch(watchOptions(o), cb, (f) => {
        microtask(() => flux.deliver(f, fresh(), false));
        return () => undefined;
      });
    },
  };
}

function browserFix(timeoutMs: number, now: () => number): Promise<Fix | null> {
  return new Promise((resolve) => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) return resolve(null);
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs + 500);
    try {
      geo.getCurrentPosition(
        (p) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(valid(p.coords.latitude, p.coords.longitude) ? { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: now(), source: 'browser' } : null);
        },
        () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 20_000 },
      );
    } catch {
      done = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Erreur du pont qui dit que l'hôte ne connaît pas l'appel (simulateur 0.9.5 : « unknown variant »). */
const unsupported = (err: unknown): boolean => /unknown variant|not (available|supported)|handler/i.test(err instanceof Error ? err.message : String(err));

/** Flux watchPosition du navigateur ; renvoie son arrêt (rien si l'API manque). */
export function browserWatch(geo: GeoWatch | null | undefined, o: WatchOptions, now: () => number, onFix: (f: Fix) => void): () => void {
  if (!geo || typeof geo.watchPosition !== 'function') return () => undefined;
  let id: number | null = null;
  let stopped = false;
  try {
    id = geo.watchPosition(
      (p) => {
        if (stopped) return;
        const f = fixOf({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, timestamp: p.timestamp }, now(), 'browser');
        if (f) onFix(f);
      },
      () => {
        /* refusée ou indisponible : le flux ne donne rien, le guidage continue à l'heure */
      },
      { enableHighAccuracy: o.accuracy === 'high', maximumAge: Math.min(o.intervalMs, 10_000) },
    );
  } catch {
    id = null;
  }
  return () => {
    stopped = true;
    if (id === null) return;
    try {
      geo.clearWatch(id);
    } catch {
      /* déjà arrêté */
    }
    id = null;
  };
}

const defaultGeo = (): GeoWatch | null => (typeof navigator !== 'undefined' && navigator.geolocation ? (navigator.geolocation as unknown as GeoWatch) : null);

export function deviceLocation(sdk: SdkLocationSource | null, now: () => number, opts: { e2e?: boolean; geo?: GeoWatch | null } = {}): LocationPort {
  let lastFix: Fix | null = null;
  let sdkUsable = !!sdk;
  let inflight: Promise<Fix | null> | null = null;
  const geo = (): GeoWatch | null => (opts.geo !== undefined ? opts.geo : defaultGeo());
  const flux = singleFlux((f) => {
    lastFix = f;
  });
  // appels start et stop du SDK l'un après l'autre (un flux remplacé s'arrête avant que le suivant démarre)
  let chain: Promise<unknown> = Promise.resolve();
  const serial = (fn: () => Promise<unknown>): void => {
    chain = chain.then(fn).catch(() => undefined);
  };
  const touch = lazyPushTarget(opts.e2e ?? isE2E(), {
    push(p) {
      const f = pushedFix(p, now());
      if (!f) return false;
      lastFix = f;
      const fl = flux.current();
      if (fl) flux.deliver(fl, f, false);
      return true;
    },
  });

  async function ask(timeoutMs: number): Promise<Fix | null> {
    if (sdk && sdkUsable) {
      try {
        const r = await sdk.getAppLocation({ accuracy: 'high', timeoutMs });
        if (r && valid(r.latitude, r.longitude)) return { lat: r.latitude, lon: r.longitude, accuracy: r.accuracy ?? undefined, at: now(), source: 'sdk' };
      } catch (err) {
        if (unsupported(err)) sdkUsable = false;
      }
    }
    return browserFix(timeoutMs, now);
  }

  /** Flux du SDK ; repli sur le navigateur si l'hôte refuse ou ne connaît pas l'appel. */
  function startSdk(f: Flux): () => void {
    const s = sdk!;
    let stopped = false;
    let off: (() => void) | null = null;
    let browserStop: (() => void) | null = null;
    const fallback = (): void => {
      if (stopped || browserStop) return;
      off?.();
      off = null;
      browserStop = browserWatch(geo(), f.opts, now, (fix) => flux.deliver(f, fix, true));
    };
    try {
      off = s.onUpdate!((l) => {
        if (stopped) return;
        const fix = fixOf(l, now(), 'sdk');
        if (fix) flux.deliver(f, fix, true);
      });
    } catch {
      off = null;
    }
    let started = false;
    serial(async () => {
      if (stopped) return;
      started = true;
      try {
        const ok = await s.startUpdates!({ accuracy: f.opts.accuracy, intervalMs: f.opts.intervalMs, distanceFilter: 0 });
        if (ok !== true) fallback();
      } catch (err) {
        if (unsupported(err)) sdkUsable = false;
        fallback();
      }
    });
    return () => {
      if (stopped) return;
      stopped = true;
      off?.();
      off = null;
      browserStop?.();
      browserStop = null;
      serial(async () => {
        // flux remplacé avant même d'avoir démarré : rien à arrêter chez l'hôte
        if (!started) return;
        try {
          await s.stopUpdates!();
        } catch {
          /* hôte sans flux : rien à arrêter */
        }
      });
    };
  }

  return {
    current(timeoutMs = 8000) {
      touch();
      if (!inflight) {
        inflight = ask(timeoutMs)
          .then((f) => {
            if (f) lastFix = f;
            return f ?? lastFix;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    last: () => {
      touch();
      return lastFix;
    },
    watch(o, cb) {
      touch();
      return flux.watch(watchOptions(o), cb, (f) => {
        if (sdk && sdkUsable && sdk.startUpdates && sdk.stopUpdates && sdk.onUpdate) return startSdk(f);
        return browserWatch(geo(), f.opts, now, (fix) => flux.deliver(f, fix, true));
      });
    },
  };
}
