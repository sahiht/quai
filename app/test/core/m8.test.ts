/**
 * Des réponses justes sur les vraies données (PRD M8), partie cœur : premier affichage sur l'horaire prévu quand le
 * relais tarde (M8.4, CA-M8.5), panne du temps réel dite juste et suppressions gardées 15 min (M8.5, CA-M8.6),
 * lancement sans horaires (M8.6, CA-M8.7), accueil léger (M8.7), départs uniques (M8.2, garde-fou).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Departure } from '../../src/core/api';
import { applyMemory, uniqueDepartures } from '../../src/core/boards';
import { FLUSH_DELAY_MS } from '../../src/core/persist';
import { hhmm } from '../../src/core/util';
import { FakeServer, makeEnv } from './support/env';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Relais qui répond après `ms` (même contenu que le faux relais). */
function slowRelay(server: FakeServer, ms: number): void {
  const plain = new FakeServer();
  plain.scene = server.scene;
  for (const p of ['/api/rt', '/api/stib']) {
    server.overrides.set(p, (url) => new Promise<Response>((resolve) => setTimeout(() => resolve(plain.fetch(url.href)), ms)));
  }
}

describe('M8.4 : premier affichage sur l’horaire prévu (CA-M8.5)', () => {
  it('relais lent : départs en 1,5 s au plus, en horaire prévu ; le temps réel arrivé ensuite sert au rafraîchissement suivant', async () => {
    vi.useFakeTimers();
    const env = makeEnv({ now: '2026-11-10T07:31' });
    await env.core.init();
    slowRelay(env.server, 5_000);
    let done = false;
    const p = env.core.board('sncb:8863008', { limit: 3 }).then((b) => {
      done = true;
      return b;
    });
    await vi.advanceTimersByTimeAsync(1_400);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
    const first = await p;
    const ic = first.departures.find((d) => hhmm(d.sched) === '07:42')!;
    expect(ic).toMatchObject({ rt: false, delayMin: 0 });
    expect(first.anyPlanned).toBe(true);
    expect(first.rtErrors).toEqual([]); // pas une panne : le relais est seulement lent
    expect(env.core.status().rt).toBe('unknown');

    await vi.advanceTimersByTimeAsync(4_000); // la réponse tardive arrive
    expect(env.core.status().rt).toBe('ok');
    env.clock.advance(30_000); // rafraîchissement suivant (30 s)
    const q = env.core.board('sncb:8863008', { limit: 3 });
    await vi.advanceTimersByTimeAsync(1_500);
    const second = await q;
    expect(second.departures.find((d) => hhmm(d.sched) === '07:42')).toMatchObject({ rt: true, delayMin: 2, newPlatform: '6' });
  });

  it('STIB lente aussi : « Autour de moi » répond en 1,5 s', async () => {
    vi.useFakeTimers();
    const env = makeEnv({ now: '2026-11-10T12:10' });
    await env.core.init();
    slowRelay(env.server, 8_000);
    let done = false;
    const p = env.core.nearby(50.86, 4.359, 500).then((x) => {
      done = true;
      return x;
    });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(done).toBe(true);
    const items = await p;
    expect(items[0].area.id).toBe('stib:6357F');
    expect(items[0].next).toMatchObject({ line: '3', rt: false });
  });
});

describe('M8.5 : panne du temps réel (CA-M8.6)', () => {
  it('suppression connue gardée 15 min pendant la panne, en horaire prévu ; état « down » puis « ok »', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    expect(env.core.status()).toEqual({ rt: 'unknown' });
    const base = await env.core.board('sncb:8812005', { limit: 4 });
    const s1 = (b: typeof base) => b.departures.find((d) => d.line === 'S1' && hhmm(d.sched) === '12:34');
    expect(s1(base)).toMatchObject({ cancelled: true, rt: true });
    expect(env.core.status()).toMatchObject({ rt: 'ok' });

    env.server.scene = 'noRT';
    env.clock.advance(21_000);
    const down = await env.core.board('sncb:8812005', { limit: 4 });
    expect(down.rtErrors).toEqual(['sncb']);
    expect(s1(down)).toMatchObject({ cancelled: true, rt: false });
    expect(env.core.status()).toEqual({ rt: 'down', since: env.clock.t });
    env.clock.advance(14 * 60_000);
    expect(s1(await env.core.board('sncb:8812005', { limit: 4 }))).toMatchObject({ cancelled: true });
    env.clock.advance(2 * 60_000); // plus de 15 min après la dernière réponse : on ne sait plus
    expect(s1(await env.core.board('sncb:8812005', { limit: 4 }))).toMatchObject({ cancelled: false, rt: false });

    env.server.scene = 'base';
    env.clock.advance(21_000);
    await env.core.board('sncb:8812005', { limit: 4 });
    expect(env.core.status().rt).toBe('ok');
  });

  it('voie modifiée connue gardée pendant la panne ; téléphone hors ligne → « offline »', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    expect((await env.core.board('sncb:8863008', { limit: 2 })).departures[0]).toMatchObject({ newPlatform: '6', delayMin: 2 });
    env.server.networkDown = true;
    vi.stubGlobal('navigator', { onLine: false });
    env.clock.advance(21_000);
    const b = await env.core.board('sncb:8863008', { limit: 2 });
    expect(b.departures[0]).toMatchObject({ newPlatform: '6', delayMin: 0, rt: false, est: b.departures[0].sched });
    expect(env.core.status().rt).toBe('offline');
  });

  it('applyMemory : suppression, arrêt sauté, voie', () => {
    const d: Departure = { op: 'sncb', mode: 'train', line: 'IC', head: { fr: 'X', nl: 'X' }, sched: 1000, est: 1000, rt: false, delayMin: 0, cancelled: false, platform: '4', stopSeq: 1, stopId: '8863008_4' };
    expect(applyMemory(d, { cancelled: true, u: [] }, undefined).cancelled).toBe(true);
    expect(applyMemory(d, { u: [[1, '8863008_6', null, null, 0]] }, undefined)).toMatchObject({ newPlatform: '6', cancelled: false, rt: false });
    expect(applyMemory(d, { u: [[1, '8863008_4', null, null, 1]] }, undefined).cancelled).toBe(true);
    expect(applyMemory(d, { u: [[3, '8813003_1', null, null, 0]] }, undefined).newPlatform).toBeUndefined();
  });
});

describe('M8.6 : lancement sans horaires (CA-M8.7)', () => {
  it('serveur arrêté : « Pas de connexion aux horaires : nouvel essai dans 30 s » (1.2.2) ; fichier absent : publication en cause', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.networkDown = true;
    await expect(env.core.init()).rejects.toMatchObject({ code: 'dataUnreachable', message: 'Pas de connexion aux horaires : nouvel essai dans 30 s' });
    env.server.networkDown = false;
    env.server.overrides.set('/quai/data/meta.json', () => new Response('Not Found', { status: 404 }));
    await expect(env.core.init()).rejects.toMatchObject({ code: 'dataUnavailable' });
    env.server.overrides.set('/quai/data/meta.json', () => new Response('oups', { status: 503 }));
    await expect(env.core.init()).rejects.toMatchObject({ code: 'dataUnreachable' });
  });
});

describe('M8.7 : accueil léger', () => {
  it('nearby(…, { light }) : les zones des tuiles, sans fichier de zone ni relais', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    await env.core.init();
    const before = env.server.calls.length;
    const light = await env.core.nearby(50.4655, 4.859, 500, { light: true });
    const calls = env.server.calls.slice(before);
    expect(light.map((x) => x.area.id)).toEqual(['tec:N509aaa', 'sncb:8863008', 'tec:N508aga']);
    expect(light.every((x) => x.next === undefined)).toBe(true);
    expect(calls.every((u) => u.includes('/tiles/'))).toBe(true);
    const full = await env.core.nearby(50.4655, 4.859, 500);
    expect(full.map((x) => x.area.id)).toEqual(light.map((x) => x.area.id));
    expect(full.every((x) => x.next)).toBe(true);
  });
});

describe('M8.2 : départs uniques (garde-fou)', () => {
  const D = (p: Partial<Departure>): Departure => ({ op: 'sncb', mode: 'train', line: 'IC', head: { fr: 'Lille Flandres', nl: 'Lille Flandres' }, sched: 1000, est: 1000, rt: false, delayMin: 0, cancelled: false, ...p });
  it('un départ par voyage ; même ligne, destination et heure → un seul, celui qui a du temps réel', () => {
    const out = uniqueDepartures([D({ tripId: 'a' }), D({ tripId: 'b', rt: true }), D({ tripId: 'a', sched: 2000, est: 2000 }), D({ tripId: 'c', sched: 3000, est: 3000, head: { fr: 'Liège', nl: 'Luik' } })]);
    expect(out.map((d) => d.tripId)).toEqual(['b', 'c']);
  });
});

describe('S7 : ouverture sobre en données (CA-S7.1)', () => {
  it('deuxième ouverture sans réseau : les réponses des favoris viennent du cache persistant (trains compris)', async () => {
    vi.useFakeTimers();
    const { MemoryKV } = await import('./support/env');
    const kv = new MemoryKV();
    const first = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT', kv });
    const fav = first.preset.favorites.find((f) => f.id === 'fav-bureau')!;
    const a = await first.core.answer(fav, { lat: 50.4655, lon: 4.859 }, first.preset);
    expect(a.state).toBe('ok');
    expect(first.server.calls.some((u) => u.includes('/trains/2026-11-10.json'))).toBe(true);
    // écritures groupées du cache persistant (FLUSH_DELAY_MS) : l'index liste tous les fichiers lus ;
    // les fichiers absents (404) y sont notés sans paquet
    const loaded = [...new Set(first.server.calls.filter((u) => u.includes('/quai/data/') && !u.endsWith('/meta.json')).map((u) => u.split('/quai/data/')[1]))];
    const index = () => JSON.parse(kv.map.get('quai.core.v2.idx') ?? 'null') as { files: Record<string, { p: number[] }>; packs: Record<string, unknown>; absent: string[] } | null;
    const persisted = () => {
      const idx = index();
      return !!idx && loaded.every((p) => p in idx.files || idx.absent.includes(p)) && kv.map.has('quai.core.v2.meta');
    };
    for (let i = 0; i < 10 && !persisted(); i++) await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 100);
    expect(persisted()).toBe(true);
    const idx = index()!;
    expect(Object.keys(idx.files).length).toBeGreaterThan(Object.keys(idx.packs).length); // plusieurs fichiers par clé
    for (const p of idx.absent) expect(idx.files[p]).toBeUndefined();
    vi.useRealTimers();
    const server = new FakeServer();
    server.networkDown = true;
    const second = makeEnv({ now: '2026-11-10T07:40', kv, server });
    await second.core.init();
    const b = await second.core.answer(fav, { lat: 50.4655, lon: 4.859 }, second.preset);
    expect(b.state).toBe('ok');
    const ride = b.plan!.journeys[0].legs.find((l) => l.kind === 'ride')!;
    expect(ride).toMatchObject({ cat: 'IC', rt: false });
    expect(hhmm(ride.dep)).toBe('08:42'); // l'IC de 07:42 est parti : le suivant, en horaire prévu
    expect(server.calls.filter((u) => u.includes('/data/')).length).toBeGreaterThan(0); // essais réseau échoués…
    expect(second.core.status().rt).not.toBe('ok'); // …et temps réel indisponible
  });

  it('les trains du lendemain ne sont chargés que le soir (à partir de 18:00)', async () => {
    const morning = makeEnv({ now: '2026-11-10T07:31' });
    await morning.core.trains('sncb:8863008', 'sncb:8813003', Date.parse('2026-11-10T07:31:00+01:00'));
    expect(morning.server.calls.some((u) => u.includes('/trains/2026-11-11.json'))).toBe(false);
    const evening = makeEnv({ now: '2026-11-10T20:00' });
    await evening.core.trains('sncb:8863008', 'sncb:8813003', Date.parse('2026-11-10T20:00:00+01:00'));
    expect(evening.server.calls.some((u) => u.includes('/trains/2026-11-11.json'))).toBe(true);
  });
});
