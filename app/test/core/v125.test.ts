/**
 * Quai 1.2.5, partie cœur (docs/v1.2.5/PRD-1.2.5.md) : pluie prévue sur les marches (§ 3 : WeatherClient, walkRain,
 * markRain, route et refresh), retards gardés pendant une panne du temps réel (§ 5), démarrage sur la copie
 * enregistrée quand le réseau tarde (§ 6). Aucune requête réseau réelle : faux relais et faux serveur de données.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeatherResponse } from '../../../shared/types';
import type { Journey, Leg } from '../../src/core/api';
import { DataClient } from '../../src/core/data';
import type { FetchLike } from '../../src/core/net';
import { FLUSH_DELAY_MS, type PersistentCache } from '../../src/core/persist';
import { RAIN_PROB, RAIN_TENTHS, WEATHER_GRACE_MS, WEATHER_KEEP_MS, WEATHER_RETRY_MS, WEATHER_STALE_MS, WEATHER_TIMEOUT_MS, WeatherClient, inTime, isWeather, markRain, walkRain } from '../../src/core/weather';
import { brokenConnection } from '../../src/core/journeys';
import { stepsPage } from '../../src/glasses/views';
import { hhmm } from '../../src/core/util';
import { FakeServer, MemoryKV, makeEnv } from './support/env';
import { at } from './support/network';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ROWS = 9;
const COLS = 16;
const SLOTS = 24;
const HOURS = 7;
const NOW = at('2026-11-10T07:31');
const MIN = 60_000;
/** Fin du quart d'heure en cours et fin de l'heure en cours, en secondes (comme Open-Meteo, données « précédentes »). */
const T0 = Math.floor(NOW / 900_000) * 900 + 900;
const H0 = Math.floor(NOW / 3_600_000) * 3600 + 3600;

/** Grille du relais : pluie (dixièmes de mm) et probabilité (%) par case, toutes égales sauf `cells`. */
function grid(rain = 0, prob = 0, cells: Record<number, { rain?: number[]; prob?: number[] }> = {}): WeatherResponse {
  return {
    lat0: 49.5,
    lon0: 2.55,
    step: 0.25,
    rows: ROWS,
    cols: COLS,
    t0: T0,
    h0: H0,
    rain: Array.from({ length: ROWS * COLS }, (_, i) => cells[i]?.rain ?? Array<number>(SLOTS).fill(rain)),
    prob: Array.from({ length: ROWS * COLS }, (_, i) => cells[i]?.prob ?? Array<number>(HOURS).fill(prob)),
    fetchedAt: '2026-11-10T06:30:00Z',
  };
}

/** Case de la grille d'un point (au plus proche). Bruxelles (50.85, 4.35) : rangée 5, colonne 7. */
const cell = (lat: number, lon: number) => Math.round((lat - 49.5) / 0.25) * COLS + Math.round((lon - 2.55) / 0.25);
const BXL = { lat: 50.85, lon: 4.35 };
const ANVERS = { lat: 51.22, lon: 4.4 };

const walk = (dep: number, min: number, from = BXL, to = BXL): Leg => ({
  kind: 'walk',
  from: { name: { fr: 'A', nl: 'A' }, ...from },
  to: { name: { fr: 'B', nl: 'B' }, ...to },
  dep,
  arr: dep + min * 60_000,
  schedDep: dep,
  schedArr: dep + min * 60_000,
  walkMin: min,
});

/** Faux relais pour WeatherClient : réponses à la demande, appels comptés. */
function relay(answer: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return answer();
  };
  return { calls, fetchFn };
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });

describe('PRD-1.2.5 § 3 : WeatherClient (grille du relais)', () => {
  it('une demande à /api/weather, gardée 15 min ; puis une nouvelle', async () => {
    let t = NOW;
    const r = relay(() => json(grid()));
    const w = new WeatherClient('https://relay.test', r.fetchFn, () => t);
    expect(w.status()).toBe('unknown');
    expect(await w.get()).toMatchObject({ rows: ROWS, cols: COLS });
    expect(r.calls).toEqual(['https://relay.test/api/weather']);
    expect(w.status()).toBe('ok');
    t += WEATHER_KEEP_MS - 1;
    await w.get();
    expect(r.calls).toHaveLength(1);
    t += 1;
    await w.get();
    expect(r.calls).toHaveLength(2);
  });

  it('deux demandes en même temps : un seul appel', async () => {
    const r = relay(() => json(grid()));
    const w = new WeatherClient('https://relay.test', r.fetchFn, () => NOW);
    const [a, b] = await Promise.all([w.get(), w.get()]);
    expect(a).toBe(b);
    expect(r.calls).toHaveLength(1);
  });

  it('relais en erreur : null, « down », pas de nouvel essai avant 5 min ; la grille connue sert encore 2 h', async () => {
    let t = NOW;
    let fail = false;
    const r = relay(() => (fail ? json({ error: 'Météo indisponible : trop de requêtes' }) : json(grid(10, 90))));
    const w = new WeatherClient('https://relay.test', r.fetchFn, () => t);
    const first = await w.get();
    fail = true;
    t += WEATHER_KEEP_MS;
    // la grille du relais porte une erreur : la connue sert encore (moins de 2 h)
    expect(await w.get()).toBe(first);
    expect(w.status()).toBe('down');
    expect(r.calls).toHaveLength(2);
    t += WEATHER_RETRY_MS - 1;
    expect(await w.get()).toBe(first);
    expect(r.calls).toHaveLength(2);
    t += 1;
    await w.get();
    expect(r.calls).toHaveLength(3);
    // plus de 2 h après la dernière réussite : plus de grille
    t = NOW + WEATHER_STALE_MS;
    expect(await w.get()).toBeNull();
  });

  it('sans le cache HTTP de la WebView ; l’âge réel de la grille (fetchedAt) compte : plus de 2 h, refusée', async () => {
    const inits: unknown[] = [];
    const fetchFn = async (_url: string, init?: unknown) => {
      inits.push(init);
      return json(grid());
    };
    expect(await new WeatherClient('https://relay.test', fetchFn, () => NOW).get()).not.toBeNull();
    expect(inits[0]).toMatchObject({ cache: 'no-store' });
    // une grille lue chez Open-Meteo il y a 2 h (CDN, relais) : refusée, « down »
    const old = relay(() => json({ ...grid(), fetchedAt: new Date(NOW - WEATHER_STALE_MS).toISOString() }));
    const w = new WeatherClient('https://relay.test', old.fetchFn, () => NOW);
    expect(await w.get()).toBeNull();
    expect(w.status()).toBe('down');
    // lue il y a 1 h 30 : acceptée ; le relais muet ensuite : gardée jusqu'à 2 h après sa lecture, pas après sa réception
    let t = NOW;
    let fail = false;
    const r = relay(() => (fail ? json({ error: 'Météo indisponible' }) : json({ ...grid(), fetchedAt: new Date(NOW - 90 * 60_000).toISOString() })));
    const c = new WeatherClient('https://relay.test', r.fetchFn, () => t);
    const g = await c.get();
    expect(g).not.toBeNull();
    fail = true;
    t += 29 * 60_000;
    expect(await c.get()).toBe(g);
    t += WEATHER_RETRY_MS;
    expect(await c.get()).toBeNull();
  });

  it('jamais d’exception : HTTP 500, JSON illisible, grille incohérente, relais absent', async () => {
    for (const bad of [() => new Response('oups', { status: 500 }), () => new Response('{pas du json'), () => json({ ...grid(), rain: [[1]] })]) {
      const r = relay(bad);
      const w = new WeatherClient('https://relay.test', r.fetchFn, () => NOW);
      await expect(w.get()).resolves.toBeNull();
      expect(w.status()).toBe('down');
    }
    const r = relay(() => json(grid()));
    const none = new WeatherClient('', r.fetchFn, () => NOW);
    expect(await none.get()).toBeNull();
    expect(r.calls).toEqual([]);
    expect(isWeather(grid())).toBe(true);
    expect(isWeather({ ...grid(), error: 'x' })).toBe(false);
    expect(isWeather({ ...grid(), step: 0 })).toBe(false);
    expect(isWeather({ ...grid(), prob: grid().prob.slice(1) })).toBe(false);
  });

  it('relais muet : null au bout de 2,5 s, jamais plus tard', async () => {
    vi.useFakeTimers();
    const r = relay(() => new Promise<Response>(() => undefined));
    const w = new WeatherClient('https://relay.test', r.fetchFn, () => NOW);
    let out: unknown = 'en attente';
    void w.get().then((x) => (out = x));
    await vi.advanceTimersByTimeAsync(WEATHER_TIMEOUT_MS - 10);
    expect(out).toBe('en attente');
    await vi.advanceTimersByTimeAsync(20);
    expect(out).toBeNull();
    expect(w.status()).toBe('down');
  });
});

describe('PRD-1.2.5 § 3 : une marche de 5 min ou plus sous la pluie prévue', () => {
  const bx = cell(BXL.lat, BXL.lon);
  const rainAt = (slots: number[], tenths = 5, prob = 80) => {
    const rain = Array<number>(SLOTS).fill(0);
    for (const k of slots) rain[k] = tenths;
    return grid(0, 0, { [bx]: { rain, prob: Array<number>(HOURS).fill(prob) } });
  };
  /** Début du quart d'heure k (en ms) : le quart d'heure k finit à T0 + k × 900 s. */
  const slotStart = (k: number) => (T0 + k * 900) * 1000 - 900_000;

  it('quart d’heure touché, au moins 0,3 mm, probabilité de 60 % ou plus : pluie', () => {
    expect([RAIN_TENTHS, RAIN_PROB]).toEqual([3, 60]);
    expect(walkRain(rainAt([3]), walk(slotStart(3) + 2 * 60_000, 7))).toBe(true);
    // la marche commence avant et finit dans le quart d'heure
    expect(walkRain(rainAt([3]), walk(slotStart(3) - 5 * 60_000, 7))).toBe(true);
    // pas de pluie sur les quarts d'heure qu'elle touche
    expect(walkRain(rainAt([5]), walk(slotStart(3), 7))).toBe(false);
    // 0,2 mm : non ; probabilité 59 % : non
    expect(walkRain(rainAt([3], 2), walk(slotStart(3), 7))).toBe(false);
    expect(walkRain(rainAt([3], 5, 59), walk(slotStart(3), 7))).toBe(false);
  });

  it('4 min : jamais ; la case de l’arrivée compte aussi ; hors de la Belgique : rien', () => {
    expect(walkRain(rainAt([3]), walk(slotStart(3), 4))).toBe(false);
    expect(walkRain(rainAt([3]), walk(slotStart(3), 5))).toBe(true);
    // départ à Anvers (sec), arrivée à Bruxelles (pluie)
    expect(walkRain(rainAt([3]), walk(slotStart(3), 6, ANVERS, BXL))).toBe(true);
    expect(walkRain(rainAt([3]), walk(slotStart(3), 6, ANVERS, ANVERS))).toBe(false);
    expect(walkRain(grid(50, 100), walk(slotStart(3), 9, { lat: 48.5, lon: 2.3 }, { lat: 48.5, lon: 2.3 }))).toBe(false);
  });

  it('la probabilité est celle de l’heure du quart d’heure (« précédente » chez Open-Meteo)', () => {
    // le quart d'heure dont la fin est H0 appartient à l'heure 0 ; le suivant, à l'heure 1
    const k0 = (H0 - T0) / 900;
    const rain = Array<number>(SLOTS).fill(0);
    rain[k0] = 5;
    rain[k0 + 1] = 5;
    const g = (p0: number, p1: number) => grid(0, 0, { [bx]: { rain, prob: [p0, p1, 0, 0, 0, 0, 0] } });
    expect(walkRain(g(80, 0), walk(slotStart(k0), 6))).toBe(true);
    expect(walkRain(g(0, 80), walk(slotStart(k0), 6))).toBe(false);
    expect(walkRain(g(0, 80), walk(slotStart(k0 + 1), 6))).toBe(true);
  });

  it('markRain : marque les marches, retire une marque périmée ; sans grille, aucune pluie', () => {
    const wet = rainAt([3]);
    const j: Journey = { id: 'j', legs: [walk(slotStart(3), 7), { ...walk(slotStart(3), 2), rain: true }], dep: 0, arr: 0, leaveAt: 0, transfers: 0, rt: true, alerts: [] };
    markRain([j], wet);
    expect(j.legs.map((l) => l.rain)).toEqual([true, undefined]);
    markRain([j], null);
    expect(j.legs.every((l) => !('rain' in l))).toBe(true);
  });
});

describe('PRD-1.2.5 § 3 : route() et refresh() avec la grille du relais', () => {
  const here = { lat: 50.4655, lon: 4.859 };
  const wetAll = grid(10, 100);

  it('marches de 5 min ou plus marquées ; la grille demandée une fois ; réglage coupé : aucune demande, aucune marque', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.overrides.set('/api/weather', () => json(wetAll));
    const fav = env.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const a = await env.core.answer(fav, here, env.preset);
    const j = a.plan!.journeys[0];
    const walks = j.legs.filter((l) => l.kind === 'walk');
    expect(walks.map((l) => [l.walkMin, l.rain ?? false])).toEqual([
      [7, true],
      [2, false],
      [9, true],
    ]);
    expect(env.server.count((u) => u.endsWith('/api/weather'))).toBe(1);
    // refresh : les marches gardent leur marque (grille gardée 15 min, pas de nouvelle demande)
    env.clock.advance(60_000);
    const r = await env.core.refresh(j, env.preset);
    expect(r.legs.filter((l) => l.kind === 'walk').map((l) => l.rain ?? false)).toEqual([true, false, true]);
    expect(env.server.count((u) => u.endsWith('/api/weather'))).toBe(1);
    expect(await env.core.weather?.()).toBe('ok');

    const off = makeEnv({ now: '2026-11-10T07:31' });
    off.server.overrides.set('/api/weather', () => json(wetAll));
    const s = { ...off.preset, display: { ...off.preset.display, rain: false } };
    const b = await off.core.answer(fav, here, s);
    expect(b.plan!.journeys[0].legs.some((l) => l.rain)).toBe(false);
    expect(off.server.count((u) => u.endsWith('/api/weather'))).toBe(0);
  });

  it('relais lent : le trajet ne l’attend que 0,5 s ; la grille arrivée ensuite sert au rafraîchissement suivant', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.overrides.set('/api/weather', () => new Promise<Response>((r) => setTimeout(() => r(json(wetAll)), 1_500)));
    const fav = env.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const t0 = Date.now();
    const a = await env.core.answer(fav, here, env.preset);
    expect(Date.now() - t0).toBeLessThan(1_400);
    const j = a.plan!.journeys[0];
    expect(j.legs.some((l) => l.rain)).toBe(false);
    await new Promise((r) => setTimeout(r, 1_300));
    const r = await env.core.refresh(j, env.preset);
    expect(r.legs.filter((l) => l.kind === 'walk').map((l) => l.rain ?? false)).toEqual([true, false, true]);
    expect(env.server.count((u) => u.endsWith('/api/weather'))).toBe(1);
  });

  it('réponse d’un favori rafraîchie (plan mémorisé) : la pluie suit le réglage et la grille arrivée en retard', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    let slow = true;
    env.server.overrides.set('/api/weather', () => new Promise<Response>((r) => setTimeout(() => r(json(wetAll)), slow ? 1_500 : 0)));
    const fav = env.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const rains = (a: Awaited<ReturnType<typeof env.core.answer>>) => a.plan!.journeys[0].legs.filter((l) => l.kind === 'walk').map((l) => l.rain ?? false);
    // grille trop lente pour le calcul : sans pluie
    expect(rains(await env.core.answer(fav, here, env.preset))).toEqual([false, false, false]);
    slow = false;
    await new Promise((r) => setTimeout(r, 1_300));
    // 30 s plus tard, plan mémorisé, temps réel seul : la grille arrivée entre-temps marque les marches
    env.clock.advance(30_000);
    expect(rains(await env.core.answer(fav, here, env.preset))).toEqual([true, false, true]);
    // réglage coupé : plus aucune marque, sans attendre un calcul complet
    env.clock.advance(30_000);
    const off = { ...env.preset, display: { ...env.preset.display, rain: false } };
    expect(rains(await env.core.answer(fav, here, off))).toEqual([false, false, false]);
  });

  it('trajet favori depuis une gare, marche jusqu’à elle ajoutée après le calcul : marquée elle aussi', async () => {
    const now = at('2026-11-10T13:55');
    const env = makeEnv({ now });
    const t0 = Math.floor(now / 900_000) * 900 + 900;
    const h0 = Math.floor(now / 3_600_000) * 3600 + 3600;
    env.server.overrides.set('/api/weather', () => json({ ...grid(10, 100), t0, h0, fetchedAt: new Date(now - 60_000).toISOString() }));
    const fav = env.preset.favorites.find((f) => f.id === 'fav-gand')!;
    // à 400 m au nord de Bruxelles-Central : 7 min à pied jusqu'à la gare
    const a = await env.core.answer(fav, { lat: 50.849, lon: 4.3571 }, env.preset);
    expect(a.state).toBe('ok');
    const first = a.plan!.journeys[0].legs[0];
    expect(first).toMatchObject({ kind: 'walk', rain: true });
    expect(first.walkMin).toBeGreaterThanOrEqual(5);
  });

  it('inTime : la grille si elle arrive à temps, sinon undefined', async () => {
    vi.useFakeTimers();
    const g = grid();
    const quick = inTime(Promise.resolve(g));
    await vi.advanceTimersByTimeAsync(0);
    expect(await quick).toBe(g);
    let out: unknown = 'en attente';
    void inTime(new Promise(() => undefined)).then((x) => (out = x));
    await vi.advanceTimersByTimeAsync(WEATHER_GRACE_MS + 1);
    expect(out).toBeUndefined();
  });

  it('relais sans météo (ancien relais, 404) : trajets inchangés, « down »', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const fav = env.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const a = await env.core.answer(fav, here, env.preset);
    expect(a.state).toBe('ok');
    expect(a.plan!.journeys[0].legs.some((l) => l.rain)).toBe(false);
    expect(await env.core.weather?.()).toBe('down');
  });
});

describe('PRD-1.2.5 § 5 : retards gardés pendant une panne du temps réel', () => {
  it('relais en panne : le dernier retard connu (15 min au plus), « ~ », marqué `rtKept` ; ensuite l’horaire prévu ; relais revenu : en direct', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const fav = env.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const a = await env.core.answer(fav, { lat: 50.4655, lon: 4.859 }, env.preset);
    const j = a.plan!.journeys[0];
    const ic = (x: Journey) => x.legs.find((l) => l.kind === 'ride' && l.mode === 'train')!;
    expect(ic(j)).toMatchObject({ rt: true, delayMin: 2 });
    expect(ic(j).rtKept).toBeUndefined();

    env.server.scene = 'noRT';
    env.clock.advance(21_000);
    const kept = await env.core.refresh(j, env.preset, { followed: true });
    expect(ic(kept)).toMatchObject({ rt: false, delayMin: 2, rtKept: true });
    expect(hhmm(ic(kept).dep)).toBe('07:44');
    expect(env.core.status().rt).toBe('down');
    // le retard gardé ne recule pas le départ à pied : l'IC a pu rattraper son retard
    expect(kept.leaveAt).toBe(j.leaveAt - 2 * 60_000);
    expect(kept.legs[0]).toMatchObject({ kind: 'walk', dep: kept.leaveAt });
    // un trajet qui n'est pas le suivi : l'horaire prévu, comme en 1.2.4 (M8.5)
    const other = await env.core.refresh(j, env.preset);
    expect(ic(other)).toMatchObject({ rt: false, delayMin: 0 });
    expect(ic(other).rtKept).toBeUndefined();
    expect(hhmm(ic(other).dep)).toBe('07:42');
    expect(other.leaveAt).toBe(kept.leaveAt);

    env.clock.advance(16 * 60_000);
    const old = await env.core.refresh(kept, env.preset, { followed: true });
    expect(ic(old)).toMatchObject({ rt: false, delayMin: 0 });
    expect(ic(old).rtKept).toBeUndefined();
    expect(hhmm(ic(old).dep)).toBe('07:42');

    env.server.scene = 'base';
    env.clock.advance(21_000);
    const live = await env.core.refresh(old, env.preset, { followed: true });
    expect(ic(live)).toMatchObject({ rt: true, delayMin: 2 });
    expect(ic(live).rtKept).toBeUndefined();
  });

  it('une correspondance n’est cassée (et le trajet recalculé) que par le temps réel en direct, jamais par un retard gardé', () => {
    const t = at('2026-11-10T08:40');
    const P = (fr: string) => ({ name: { fr, nl: fr }, lat: 0, lon: 0 });
    const ride = (dep: number, arr: number, o: Partial<Leg> = {}): Leg => ({ kind: 'ride', mode: 'train', dep, arr, schedDep: dep, schedArr: arr, from: P('A'), to: P('B'), ...o });
    const walk: Leg = { kind: 'walk', walkMin: 2, dep: 0, arr: 0, schedDep: 0, schedArr: 0, from: P('B'), to: P('C') };
    const tram = ride(t + 4 * MIN, t + 20 * MIN, { mode: 'tram' });
    // IC prévu à 08:40, +4 : arrivée 08:44, plus 2 min de marche, pour un tram à 08:44
    const late = (o: Partial<Leg>) => ({ legs: [ride(t - 30 * MIN, t + 4 * MIN, { schedArr: t, delayMin: 4, ...o }), walk, tram] }) as Journey;
    expect(brokenConnection(late({ rt: true }))).toBe(2);
    expect(brokenConnection(late({ rt: false, rtKept: true }))).toBe(-1);
  });
});

describe('PRD-1.2.5 § 6 : démarrage sur la copie enregistrée quand le réseau tarde', () => {
  async function savedKv(): Promise<MemoryKV> {
    vi.useFakeTimers();
    const kv = new MemoryKV();
    const first = makeEnv({ now: '2026-11-10T07:31', kv });
    await first.core.init();
    for (let i = 0; i < 10 && !kv.map.has('quai.core.v2.meta'); i++) await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    expect(kv.map.has('quai.core.v2.meta')).toBe(true);
    return kv;
  }

  it('réseau muet : la copie au bout de 4 s ; la réponse arrivée ensuite, d’une autre génération, la remplace', async () => {
    const kv = await savedKv();
    const server = new FakeServer();
    const plain = new FakeServer();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const fresh = JSON.parse(await (await plain.fetch('https://data.test/quai/data/meta.json')).text()) as { generatedAt: string };
    server.overrides.set('/quai/data/meta.json', async () => {
      await gate;
      return json({ ...fresh, generatedAt: '2026-11-10T07:00:00Z' });
    });
    const second = makeEnv({ now: '2026-11-10T07:40', kv, server });
    const told: string[] = [];
    second.core.onGeneration?.((g) => told.push(g));
    let done = false;
    const p = second.core.init().then((m) => {
      done = true;
      return m;
    });
    await vi.advanceTimersByTimeAsync(3_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect((await p).generatedAt).toBe(fresh.generatedAt);
    expect(second.core.meta?.generatedAt).toBe(fresh.generatedAt);
    // la réponse du réseau arrive : nouvelle génération adoptée, enregistrée et annoncée, sans autre lecture
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(second.core.meta?.generatedAt).toBe('2026-11-10T07:00:00Z');
    expect(told.at(-1)).toBe('2026-11-10T07:00:00Z');
    expect(server.count((u) => u.endsWith('/meta.json'))).toBe(1);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    expect(kv.map.get('quai.core.v2.meta')).toContain('2026-11-10T07:00:00Z');
  });

  it('pont de stockage lent : le réseau qui répond pendant la lecture de la copie l’emporte', async () => {
    vi.useFakeTimers();
    const plain = new FakeServer();
    const text = await (await plain.fetch('https://data.test/quai/data/meta.json')).text();
    const copy = JSON.stringify({ ...JSON.parse(text), generatedAt: '2026-11-09T02:12:00Z' });
    const newer = JSON.stringify({ ...JSON.parse(text), generatedAt: '2026-11-10T07:00:00Z' });
    const putMeta = vi.fn();
    const persist = {
      setPinned: () => undefined,
      setGeneration: () => undefined,
      putMeta,
      // copie lue en 8 s (la file du stockage peut attendre une écriture en cours)
      getMeta: () => new Promise<string | null>((r) => setTimeout(() => r(copy), 8_000)),
    } as unknown as PersistentCache;
    const fetchFn: FetchLike = () => new Promise<Response>((r) => setTimeout(() => r(new Response(newer, { status: 200 })), 5_000));
    const data = new DataClient('https://data.test/quai/data', fetchFn, persist, () => at('2026-11-10T07:40'));
    let got: string | undefined;
    void data.loadMeta().then((m) => (got = m.generatedAt));
    await vi.advanceTimersByTimeAsync(4_500);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(600);
    expect(got).toBe('2026-11-10T07:00:00Z');
    expect(putMeta).toHaveBeenCalledWith(newer);
  });

  it('sans copie enregistrée : on attend le réseau, au-delà de 4 s', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const plain = new FakeServer();
    server.overrides.set('/quai/data/meta.json', () => new Promise<Response>((r) => setTimeout(() => r(plain.fetch('https://data.test/quai/data/meta.json')), 6_000)));
    const env = makeEnv({ now: '2026-11-10T07:31', server });
    let done = false;
    void env.core.init().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(done).toBe(true);
  });

  it('hors ligne : la copie tout de suite, sans attendre 4 s', async () => {
    const kv = await savedKv();
    const server = new FakeServer();
    server.networkDown = true;
    const env = makeEnv({ now: '2026-11-10T07:40', kv, server });
    let done = false;
    void env.core.init().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(true);
  });
});

describe('PRD-1.2.5 § 1 avec le vrai cœur : « Si tu le rates » et l’alerte « Partir maintenant »', () => {
  it('avant l’heure de partir : « Si tu le rates » ; pendant la marche, l’alerte réglée passe d’abord, sinon encore « Si tu le rates »', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const fav = env.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const a = await env.core.answer(fav, { lat: 50.4655, lon: 4.859 }, env.preset);
    const js = a.plan!.journeys;
    const j = js[0];
    expect(j.legs[0].kind).toBe('walk');
    const topAt = (journeys: Journey[], now: number, settings = env.preset): string | undefined =>
      stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, fresh: true }, { now, settings }).top?.text;
    // 2 min avant de partir : « Si tu le rates »
    expect(topAt(js, j.leaveAt - 2 * MIN)).toMatch(/^Si tu le rates/);
    // l'heure de partir passée, en marchant : « Partir maintenant » (Alertes, allumée) d'abord
    env.clock.advance(j.leaveAt + MIN - env.clock.now());
    const walking = await env.core.refresh(j, env.preset);
    expect(walking.alerts[0]?.kind).toBe('leave');
    expect(topAt([walking, ...js.slice(1)], env.clock.now())).toMatch(/^Partir maintenant/);
    // l'alerte coupée : « Si tu le rates » jusqu'au départ du premier véhicule
    const quiet = { ...env.preset, alerts: { ...env.preset.alerts, leave: false } };
    const noAlert = await env.core.refresh(j, quiet);
    expect(noAlert.alerts).toEqual([]);
    expect(topAt([noAlert, ...js.slice(1)], env.clock.now(), quiet)).toMatch(/^Si tu le rates/);
  });
});
