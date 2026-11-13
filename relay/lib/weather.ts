/**
 * 1.2.5 : pluie prévue sur une grille fixe de la Belgique (GET /api/weather), demandée à Open-Meteo (gratuit pour un
 * usage non commercial, licence CC BY 4.0, moins de 10 000 appels par jour).
 * Grille de 9 × 16 cases (pas de 0,25°, une case tous les 20 à 30 km) : la même pour tout le monde, aucune position.
 * Une demande compte au plus 144 appels ; gardée 1 h par l'instance et par le cache CDN de Vercel : au plus 3 456
 * appels par jour même si chaque case compte pour un appel. Open-Meteo refuse : la dernière grille sert encore 2 h, et
 * l'instance ne le rappelle pas avant 5 min (les requêtes simultanées partagent un seul appel).
 */
import type { Source } from './config.js';
import type { WeatherResponse } from './shared/types.js';

export const WEATHER_GRID = { lat0: 49.5, lon0: 2.55, step: 0.25, rows: 9, cols: 16 } as const;
export const DEFAULT_WEATHER_BASE = 'https://api.open-meteo.com';
/** 24 quarts d'heure (6 h) et 7 heures : une grille gardée 1 h couvre encore les 4 h qui suivent. */
export const WEATHER_SLOTS = 24;
export const WEATHER_HOURS = 7;
/** Grille gardée par l'instance (et par le CDN, cacheWeather). */
export const WEATHER_TTL_MS = 60 * 60_000;
/** Open-Meteo refuse ou ne répond pas : la dernière grille sert encore jusqu'à 2 h après sa lecture. */
export const WEATHER_STALE_MS = 2 * 60 * 60_000;
/** Open-Meteo a refusé : pas de nouvel appel avant 5 min (le quota n'est pas dépensé pendant une panne). */
export const WEATHER_PAUSE_MS = 5 * 60_000;
/** Revalidation en arrière-plan par le CDN, courte : une grille n'est jamais servie bien après son heure. */
export const WEATHER_SWR_S = 300;

/**
 * Cache CDN d'une grille lue il y a `ageMs` : le reste de son heure (1 min au moins), puis 5 min de revalidation en
 * arrière-plan. Une grille lue à 07:00 n'est plus servie par le CDN après 08:05.
 */
export function cacheWeather(ageMs: number): string {
  const left = Math.max(60, Math.floor((WEATHER_TTL_MS - Math.max(0, ageMs)) / 1000));
  return `public, s-maxage=${left}, stale-while-revalidate=${WEATHER_SWR_S}`;
}
/** Cache CDN d'une grille toute fraîche. */
export const CACHE_WEATHER = cacheWeather(0);

/** Adresse d'Open-Meteo (WEATHER_BASE pour les essais, sinon l'API publique). */
export function weatherBase(env: Record<string, string | undefined>): string {
  return (env.WEATHER_BASE ?? '').trim().replace(/\/+$/, '') || DEFAULT_WEATHER_BASE;
}

/** Les points de la grille, case par case (indice r × cols + c). */
export function gridPoints(): { lat: number; lon: number }[] {
  const { lat0, lon0, step, rows, cols } = WEATHER_GRID;
  const out: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ lat: +(lat0 + r * step).toFixed(2), lon: +(lon0 + c * step).toFixed(2) });
  return out;
}

export function weatherSource(base: string): Source {
  const pts = gridPoints();
  const q = [
    `latitude=${pts.map((p) => p.lat.toFixed(2)).join(',')}`,
    `longitude=${pts.map((p) => p.lon.toFixed(2)).join(',')}`,
    'minutely_15=precipitation',
    'hourly=precipitation_probability',
    `forecast_minutely_15=${WEATHER_SLOTS}`,
    `forecast_hours=${WEATHER_HOURS}`,
    'timeformat=unixtime',
    'timezone=GMT',
  ].join('&');
  return { id: 'weather', kind: 'weather', label: 'Open-Meteo forecast', url: `${base}/v1/forecast?${q}`, auth: false };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const nums = (x: unknown): x is unknown[] => Array.isArray(x);

/** Série d'Open-Meteo : temps (secondes epoch) et valeurs, de même longueur. */
function series(block: unknown, key: string): { time: number[]; values: unknown[] } | null {
  if (!isObj(block) || !nums(block.time) || !nums(block[key])) return null;
  const time = block.time as unknown[];
  const values = block[key] as unknown[];
  if (!time.length || time.length !== values.length || !time.every((t) => typeof t === 'number' && Number.isFinite(t))) return null;
  return { time: time as number[], values };
}

/**
 * Réponse d'Open-Meteo (une liste, une entrée par case dans l'ordre demandé) → grille compacte. Une valeur absente
 * compte pour 0 : jamais de pluie annoncée sans donnée. Forme inattendue : erreur.
 */
export function toWeather(raw: unknown, fetchedAt: string): WeatherResponse {
  const { rows, cols } = WEATHER_GRID;
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length !== rows * cols) throw new Error(`grille météo inattendue : ${list.length} cases au lieu de ${rows * cols}`);
  const rain: number[][] = [];
  const prob: number[][] = [];
  let t0 = 0;
  let h0 = 0;
  list.forEach((item, i) => {
    const m = series(isObj(item) ? item.minutely_15 : null, 'precipitation');
    const h = series(isObj(item) ? item.hourly : null, 'precipitation_probability');
    if (!m || !h) throw new Error(`case ${i} de la grille météo illisible`);
    if (i === 0) {
      t0 = m.time[0];
      h0 = h.time[0];
    } else if (m.time[0] !== t0 || h.time[0] !== h0) throw new Error(`case ${i} de la grille météo décalée`);
    rain.push(m.values.map((v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 10) : 0)));
    prob.push(h.values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0)));
  });
  return { ...WEATHER_GRID, t0, rain, h0, prob, fetchedAt };
}

/** Réponse d'erreur : la grille, sans données. */
export function emptyWeather(fetchedAt: string, error: string): WeatherResponse {
  return { ...WEATHER_GRID, t0: 0, rain: [], h0: 0, prob: [], fetchedAt, error };
}
