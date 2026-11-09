/**
 * Position du téléphone : API de l'appli Even (permission `location`, getAppLocation), repli sur
 * navigator.geolocation, ou position simulée (?e2e=1&mockLat&mockLon). Ne lève jamais.
 * Le simulateur 0.9.5 ne connaît pas getAppLocation (« unknown variant ») : on bascule alors
 * définitivement sur le repli navigateur.
 */
import type { Fix, LocationPort } from './types';

export interface SdkLocationSource {
  getAppLocation(opts: { accuracy?: string; timeoutMs?: number }): Promise<{ latitude: number; longitude: number; accuracy?: number } | null>;
}

const valid = (lat: unknown, lon: unknown): boolean =>
  typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

export function mockLocation(lat: number, lon: number, now: () => number): LocationPort {
  const fix = (): Fix => ({ lat, lon, accuracy: 5, at: now(), source: 'mock' });
  return { current: async () => fix(), last: () => fix() };
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

export function deviceLocation(sdk: SdkLocationSource | null, now: () => number): LocationPort {
  let lastFix: Fix | null = null;
  let sdkUsable = !!sdk;
  let inflight: Promise<Fix | null> | null = null;

  async function ask(timeoutMs: number): Promise<Fix | null> {
    if (sdk && sdkUsable) {
      try {
        const r = await sdk.getAppLocation({ accuracy: 'high', timeoutMs });
        if (r && valid(r.latitude, r.longitude)) return { lat: r.latitude, lon: r.longitude, accuracy: r.accuracy, at: now(), source: 'sdk' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unknown variant|not (available|supported)|handler/i.test(msg)) sdkUsable = false;
      }
    }
    return browserFix(timeoutMs, now);
  }

  return {
    current(timeoutMs = 8000) {
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
    last: () => lastFix,
  };
}
