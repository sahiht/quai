/**
 * Paramètres d'URL du mode test (SPEC § 5.3), actifs seulement avec ?e2e=1 :
 * mockLat, mockLon, mockNow (ISO), mockSpeed (accélère l'horloge simulée), data, relay, preset, reset=1.
 * ?fake=1 (faux cœur) est accepté en développement ou avec e2e=1 ; stale=1 et noRt=1 pilotent le faux cœur.
 */
export interface Env {
  e2e: boolean;
  fake: boolean;
  mockLat?: number;
  mockLon?: number;
  mockNow?: number;
  mockSpeed?: number;
  data?: string;
  relay?: string;
  preset?: string;
  reset: boolean;
  stale: boolean;
  noRt: boolean;
  /** Force le repli navigateur (émulateur des lunettes sur la page), même dans l'appli Even. */
  browser?: boolean;
}

const num = (v: string | null): number | undefined => {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Base d'URL de test (http autorisé pour les serveurs locaux), sans / final. */
export function testBase(v: string | null): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return v.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function parseEnv(search: string, dev: boolean): Env {
  const q = new URLSearchParams(search);
  const e2e = q.get('e2e') === '1';
  const fake = q.get('fake') === '1' && (e2e || dev);
  const env: Env = { e2e, fake, reset: false, stale: fake && q.get('stale') === '1', noRt: fake && q.get('noRt') === '1' };
  if (!e2e) return env;
  const lat = num(q.get('mockLat'));
  const lon = num(q.get('mockLon'));
  if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    env.mockLat = lat;
    env.mockLon = lon;
  }
  const iso = q.get('mockNow');
  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) env.mockNow = t;
  }
  const speed = num(q.get('mockSpeed'));
  if (speed !== undefined && speed > 0 && speed <= 600) env.mockSpeed = speed;
  env.data = testBase(q.get('data'));
  env.relay = testBase(q.get('relay'));
  const preset = q.get('preset');
  if (preset) env.preset = preset;
  env.reset = q.get('reset') === '1';
  if (q.get('browser') === '1') env.browser = true;
  return env;
}
