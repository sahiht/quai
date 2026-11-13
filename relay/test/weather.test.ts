import { describe, expect, it } from 'vitest';
import { handleWeather } from '../lib/handlers.js';
import type { WeatherResponse } from '../lib/shared/types.js';
import { CACHE_WEATHER, WEATHER_GRID, WEATHER_HOURS, WEATHER_SLOTS, gridPoints, toWeather, weatherSource } from '../lib/weather.js';
import { withoutBidi } from '../lib/gtfsrt.js';
import { NOW_MS, call, jsonBody, makeCtx, never, type Route } from './helpers.js';

const OM = 'https://meteo.test';
const N = WEATHER_GRID.rows * WEATHER_GRID.cols;
const T0 = Math.floor(NOW_MS / 900_000) * 900 + 900;
const H0 = Math.floor(NOW_MS / 3_600_000) * 3600 + 3600;

/** Réponse d'Open-Meteo : une entrée par case ; pluie et probabilité données par case. */
function openMeteo(rain = (_i: number) => [0.3, 0, null] as (number | null)[], prob = (_i: number) => [70, 20] as (number | null)[]) {
  return Array.from({ length: N }, (_, i) => ({
    latitude: 0,
    longitude: 0,
    minutely_15: { time: rain(i).map((_v, k) => T0 + k * 900), precipitation: rain(i) },
    hourly: { time: prob(i).map((_v, h) => H0 + h * 3600), precipitation_probability: prob(i) },
  }));
}

const route = (body: () => Response | Promise<Response>): Route => (url) => (url.origin === OM ? body() : jsonBody({}, 404));
const weather = (t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(() => jsonBody(openMeteo())) })) => call<WeatherResponse>(handleWeather, '/api/weather', t.ctx);

describe('grille météo (lib/weather.ts)', () => {
  it('144 cases, de 0,25° en 0,25°, du sud-ouest au nord-est de la Belgique', () => {
    const pts = gridPoints();
    expect(pts).toHaveLength(144);
    expect(pts[0]).toEqual({ lat: 49.5, lon: 2.55 });
    expect(pts[15]).toEqual({ lat: 49.5, lon: 6.3 });
    expect(pts[143]).toEqual({ lat: 51.5, lon: 6.3 });
  });

  it('une seule requête à Open-Meteo : toutes les cases, pluie par quart d’heure, probabilité par heure, sans clé', () => {
    const s = weatherSource('https://api.open-meteo.com');
    const u = new URL(s.url);
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('latitude')!.split(',')).toHaveLength(144);
    expect(u.searchParams.get('longitude')!.split(',')).toHaveLength(144);
    expect(u.searchParams.get('minutely_15')).toBe('precipitation');
    expect(u.searchParams.get('hourly')).toBe('precipitation_probability');
    expect(u.searchParams.get('forecast_minutely_15')).toBe(String(WEATHER_SLOTS));
    expect(u.searchParams.get('forecast_hours')).toBe(String(WEATHER_HOURS));
    expect(u.searchParams.get('timeformat')).toBe('unixtime');
    expect(s.auth).toBe(false);
  });

  it('dixièmes de mm, probabilités bornées, valeurs absentes à 0 (jamais de pluie sans donnée)', () => {
    const w = toWeather(openMeteo(() => [0.25, 1.04, null, -1], () => [64.6, null, 120]), 'x');
    expect(w.t0).toBe(T0);
    expect(w.h0).toBe(H0);
    expect(w.rain[0]).toEqual([3, 10, 0, 0]);
    expect(w.prob[0]).toEqual([65, 0, 100]);
    expect(w.rain).toHaveLength(144);
  });

  it('forme inattendue : erreur (nombre de cases, série absente, temps décalés)', () => {
    expect(() => toWeather(openMeteo().slice(1), 'x')).toThrow(/143 cases/);
    const bad = openMeteo();
    (bad[3] as { hourly?: unknown }).hourly = undefined;
    expect(() => toWeather(bad, 'x')).toThrow(/case 3/);
    const shifted = openMeteo();
    shifted[5].minutely_15.time = shifted[5].minutely_15.time.map((t) => t + 900);
    expect(() => toWeather(shifted, 'x')).toThrow(/décalée/);
  });
});

describe('/api/weather', () => {
  it('grille complète, cache CDN 1 h, une seule requête vers Open-Meteo, sans aucune position reçue', async () => {
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(() => jsonBody(openMeteo())) });
    const r = await weather(t);
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
    expect(r.body.rows * r.body.cols).toBe(144);
    expect(r.body.rain[0]).toEqual([3, 0, 0]);
    expect(r.headers.get('cache-control')).toBe(CACHE_WEATHER);
    expect(t.calls.filter((c) => c.url.startsWith(OM))).toHaveLength(1);
  });

  it('gardée 1 h par l’instance : pas de nouvelle requête', async () => {
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(() => jsonBody(openMeteo())) });
    await weather(t);
    t.advance(59 * 60_000);
    await weather(t);
    expect(t.calls.filter((c) => c.url.startsWith(OM))).toHaveLength(1);
    t.advance(2 * 60_000);
    await weather(t);
    expect(t.calls.filter((c) => c.url.startsWith(OM))).toHaveLength(2);
  });

  it('Open-Meteo refuse : la dernière grille sert encore 2 h, sans cache CDN ; ensuite une erreur', async () => {
    let fail = false;
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(() => (fail ? jsonBody({ reason: 'limit' }, 429) : jsonBody(openMeteo()))) });
    await weather(t);
    fail = true;
    t.advance(90 * 60_000);
    const stale = await weather(t);
    expect(stale.body.error).toBeUndefined();
    expect(stale.body.rain).toHaveLength(144);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    t.advance(31 * 60_000);
    const gone = await weather(t);
    expect(gone.status).toBe(200);
    expect(gone.body.error).toMatch(/^Météo indisponible : trop de requêtes/);
    expect(gone.body.rain).toEqual([]);
    expect(gone.headers.get('cache-control')).toBe('no-store');
  });

  it('cache CDN : le reste de l’heure de la grille (1 min au moins), 5 min de revalidation : jamais servie bien après', async () => {
    expect(CACHE_WEATHER).toBe('public, s-maxage=3600, stale-while-revalidate=300');
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(() => jsonBody(openMeteo())) });
    await weather(t);
    t.advance(40 * 60_000);
    expect((await weather(t)).headers.get('cache-control')).toBe('public, s-maxage=1200, stale-while-revalidate=300');
    t.advance(19 * 60_000 + 30_000);
    expect((await weather(t)).headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(t.calls.filter((c) => c.url.startsWith(OM))).toHaveLength(1);
  });

  it('Open-Meteo refuse : pas de nouvel appel avant 5 min (quota préservé), puis un essai', async () => {
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(() => jsonBody({ reason: 'limit' }, 429)) });
    const om = () => t.calls.filter((c) => c.url.startsWith(OM)).length;
    expect((await weather(t)).body.error).toMatch(/^Météo indisponible/);
    expect(om()).toBe(1);
    for (let i = 0; i < 4; i++) {
      t.advance(60_000);
      expect((await weather(t)).body.error).toMatch(/^Météo indisponible/);
    }
    expect(om()).toBe(1);
    t.advance(60_000);
    await weather(t);
    expect(om()).toBe(2);
  });

  it('requêtes simultanées : un seul appel à Open-Meteo', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(async () => (await gate, jsonBody(openMeteo()))) });
    const all = Promise.all([weather(t), weather(t), weather(t)]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const rs = await all;
    expect(rs.every((r) => r.status === 200 && r.body.rain.length === 144)).toBe(true);
    expect(t.calls.filter((c) => c.url.startsWith(OM))).toHaveLength(1);
  });

  it('Open-Meteo muet : erreur dans le délai du relais', async () => {
    const t = makeCtx({ env: { WEATHER_BASE: OM }, route: route(never), timeouts: { upstream: 50 } });
    const r = await weather(t);
    expect(r.body.error).toMatch(/^Météo indisponible/);
  });
});

describe('caractères de sens d’écriture (1.2.5)', () => {
  it('retirés des textes des opérateurs', () => {
    expect(withoutBidi('Travaux ‮esuoc‬ à Bruxelles‏')).toBe('Travaux esuoc à Bruxelles');
    expect(withoutBidi('⁦Gare⁩ du Nord')).toBe('Gare du Nord');
  });
});
