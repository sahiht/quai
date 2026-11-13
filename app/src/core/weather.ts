/**
 * 1.2.5 : pluie prévue pendant les marches (Open-Meteo, par le relais : GET /api/weather).
 * Le relais renvoie la même grille fixe de la Belgique à tout le monde ; le téléphone choisit lui-même la case de
 * chaque marche : aucune position ne quitte le téléphone (shared/types.ts, WeatherResponse).
 *
 * Règle (PRD-1.2.5 § 3) : une marche de 5 min ou plus porte la pluie quand, sur un quart d'heure qu'elle touche, la
 * case de son départ ou de son arrivée prévoit au moins 0,3 mm (0,25 mm arrondi au dixième des données) et que l'heure
 * de ce quart d'heure annonce une probabilité de pluie de 60 % ou plus. Sans grille (relais muet, Open-Meteo en
 * panne, réglage coupé) : rien, jamais de pluie supposée.
 */
import type { WeatherResponse } from '../../../shared/types';
import type { Journey, Leg } from './api';
import { getText, safeJson, type FetchLike } from './net';

/** Marche assez longue pour que la pluie compte (minutes). */
export const RAIN_WALK_MIN = 5;
/** Pluie d'un quart d'heure, en dixièmes de mm (0,25 mm arrondi au dixième). */
export const RAIN_TENTHS = 3;
/** Probabilité de pluie de l'heure (%). */
export const RAIN_PROB = 60;
/** Grille gardée par le téléphone. */
export const WEATHER_KEEP_MS = 15 * 60_000;
/** Relais muet : pas de nouvel essai avant ce délai ; la grille connue sert encore jusqu'à WEATHER_STALE_MS. */
export const WEATHER_RETRY_MS = 5 * 60_000;
export const WEATHER_STALE_MS = 2 * 60 * 60_000;
/** Délai d'une demande au relais. */
export const WEATHER_TIMEOUT_MS = 2_500;
/**
 * Le calcul d'un trajet n'attend la grille que 0,5 s de plus au plus : sinon il paraît sans pluie, et la demande en
 * cours sert au rafraîchissement suivant (30 s). Un relais lent ne retarde jamais un trajet de plus.
 */
export const WEATHER_GRACE_MS = 500;

export type WeatherState = 'ok' | 'down' | 'unknown';

/** Grille lisible : dimensions cohérentes, séries de nombres. */
export function isWeather(x: unknown): x is WeatherResponse {
  if (!x || typeof x !== 'object') return false;
  const w = x as Partial<WeatherResponse>;
  const n = typeof w.rows === 'number' && typeof w.cols === 'number' ? w.rows * w.cols : -1;
  return (
    !w.error &&
    [w.lat0, w.lon0, w.step, w.t0, w.h0].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (w.step ?? 0) > 0 &&
    n > 0 &&
    Array.isArray(w.rain) &&
    Array.isArray(w.prob) &&
    w.rain.length === n &&
    w.prob.length === n &&
    w.rain.every((r) => Array.isArray(r) && r.every((v) => typeof v === 'number')) &&
    w.prob.every((r) => Array.isArray(r) && r.every((v) => typeof v === 'number'))
  );
}

export class WeatherClient {
  /** `at` : reçue par le téléphone ; `made` : lue par le relais chez Open-Meteo (fetchedAt), l'âge réel de la grille. */
  private grid: { w: WeatherResponse; at: number; made: number } | null = null;
  private failedAt = -Infinity;
  private pending: Promise<WeatherResponse | null> | null = null;
  private state: WeatherState = 'unknown';

  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike,
    private readonly now: () => number,
  ) {}

  /** État pour l'écran Données : dernière demande réussie, en échec, ou pas encore faite. */
  status(): WeatherState {
    return this.state;
  }

  /** La grille (gardée 15 min) ; relais muet : la connue jusqu'à 2 h après sa lecture chez Open-Meteo, sinon null. Ne lève jamais. */
  async get(): Promise<WeatherResponse | null> {
    const t = this.now();
    const g = this.grid;
    if (g && t - g.at >= 0 && t - g.at < WEATHER_KEEP_MS) return g.w;
    if (t - this.failedAt >= 0 && t - this.failedAt < WEATHER_RETRY_MS) return this.known(t);
    if (!this.pending) {
      this.pending = this.load().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private known(t: number): WeatherResponse | null {
    const g = this.grid;
    return g && t - g.at >= 0 && t - g.made < WEATHER_STALE_MS ? g.w : null;
  }

  private async load(): Promise<WeatherResponse | null> {
    const t = this.now();
    try {
      if (!this.base) throw new Error('relais absent');
      // sans le cache HTTP de la WebView (comme le temps réel) : la grille du relais et du CDN, jamais une copie locale
      const r = await getText(this.fetchFn, `${this.base}/api/weather`, WEATHER_TIMEOUT_MS, true);
      const w = r.status === 200 ? safeJson(r.text) : undefined;
      if (!isWeather(w)) throw new Error('grille météo absente');
      // l'âge réel de la grille (horloge du téléphone en avance : jamais dans le futur) ; plus de 2 h : refusée
      const read = Date.parse(w.fetchedAt);
      const made = Number.isFinite(read) ? Math.min(read, t) : t;
      if (t - made >= WEATHER_STALE_MS) throw new Error('grille météo trop vieille');
      this.grid = { w, at: t, made };
      this.state = 'ok';
      return w;
    } catch {
      this.failedAt = t;
      this.state = 'down';
      return this.known(t);
    }
  }
}

/** La grille si elle arrive dans `ms`, sinon undefined (le trajet garde ses marques, ou n'en a pas). */
export async function inTime(p: Promise<WeatherResponse | null>, ms = WEATHER_GRACE_MS): Promise<WeatherResponse | null | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((r) => {
    timer = setTimeout(() => r(undefined), ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

const cellOf = (w: WeatherResponse, lat: number, lon: number): number => {
  const r = Math.round((lat - w.lat0) / w.step);
  const c = Math.round((lon - w.lon0) / w.step);
  return r < 0 || c < 0 || r >= w.rows || c >= w.cols ? -1 : r * w.cols + c;
};

/** Vrai si la case prévoit de la pluie sur un quart d'heure qui touche [from, to] (epoch ms). */
function rainyCell(w: WeatherResponse, cell: number, from: number, to: number): boolean {
  if (cell < 0) return false;
  const rain = w.rain[cell] ?? [];
  const prob = w.prob[cell] ?? [];
  for (let k = 0; k < rain.length; k++) {
    const end = (w.t0 + k * 900) * 1000;
    const start = end - 900_000;
    if (end <= from || start >= to) continue;
    if (rain[k] < RAIN_TENTHS) continue;
    // l'heure qui contient ce quart d'heure : la première dont la fin n'est pas avant la sienne
    const h = Math.ceil((end / 1000 - w.h0) / 3600);
    if ((prob[Math.max(0, h)] ?? 0) >= RAIN_PROB) return true;
  }
  return false;
}

/** Vrai si une marche de 5 min ou plus se fait sous la pluie prévue (case du départ ou de l'arrivée). */
export function walkRain(w: WeatherResponse, l: Leg): boolean {
  if (l.kind !== 'walk') return false;
  const min = l.walkMin ?? Math.round((l.arr - l.dep) / 60_000);
  if (min < RAIN_WALK_MIN) return false;
  const cells = new Set([cellOf(w, l.from.lat, l.from.lon), cellOf(w, l.to.lat, l.to.lon)]);
  for (const c of cells) if (rainyCell(w, c, l.dep, l.arr)) return true;
  return false;
}

/** Marque (ou démarque) la pluie des marches des trajets. Sans grille : aucune marche sous la pluie. */
export function markRain(journeys: readonly Journey[], w: WeatherResponse | null): void {
  for (const j of journeys) {
    for (const l of j.legs) {
      if (l.kind !== 'walk') continue;
      if (w && walkRain(w, l)) l.rain = true;
      else delete l.rain;
    }
  }
}
