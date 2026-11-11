/**
 * Trajets suivis (design-routing.md § 4.9, point 2) : la recette du réseau de chaque trajet proposé (génération,
 * fichiers de ligne, jours de trains) est gardée par identifiant de trajet ; refresh() recalcule une correspondance
 * devenue impossible même après d'autres calculs, sur le réseau en mémoire ou refait avec les mêmes fichiers, jamais
 * avec ceux d'une autre génération. Plans mémorisés des favoris (favorites.ts) : identifiants, étiquettes et raisons
 * gardés, et refresh() d'une de leurs propositions recalcule la correspondance.
 */
import { describe, expect, it } from 'vitest';
import type { Endpoint, FavoriteTrip, Settings } from '../../../src/core/api';
import { dropNets, netMemory, netOf, RECALC_TEXT } from '../../../src/core/routing/repair';
import { makeEnv, type TestEnv } from '../support/env';
import { at, CORE_DATA_DIR, readJson } from '../support/network';
import { legsOf } from './support';

const addr = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });
const WATERLOO = addr('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399);
const ROGIER = addr('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36);
const WPOS = { lat: 50.7175, lon: 4.399 };
const S1 = { lat: 50.4655, lon: 4.859 };
const S2 = { lat: 50.86, lon: 4.359 };
const S3 = { lat: 50.8454, lon: 4.3571 };
/** Bus W en retard de 8 min dès Waterloo Eglise. */
const late = { u: [[2, 'Bwategl1', 480, null, 0]] as [number, string, number, null, 0][] };
const RECALCULE = 'marche 2 | 07:44 W Waterloo Eglise → Bruxelles Midi 08:29 | marche 2 | 08:35 M2 Gare du Midi → Rogier 08:49 | marche 3';
const lineCalls = (env: TestEnv) => env.server.count((u) => u.includes('/lines/') || u.includes('/trains/'));

/** La réponse du bureau, celle de Gand, puis deux calculs de l'accueil (autres réseaux). */
async function otherComputations(env: TestEnv, s: Settings): Promise<void> {
  const fav = (id: string) => s.favorites.find((f) => f.id === id)!;
  await env.core.answer(fav('fav-bureau'), S1, s);
  await env.core.answer(fav('fav-gand'), S3, s);
  await env.core.route({ type: 'here' }, addr('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545), env.clock.now(), s, S2);
  await env.core.route({ type: 'here' }, addr('Meise Centrum', 50.9392, 4.3272), env.clock.now(), s, S2);
}

describe('réseau gardé par trajet suivi ou récent', () => {
  it('après la réponse du bureau et trois autres calculs, refresh() recalcule encore la correspondance', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const meta = await env.core.init();
    const j0 = (await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset)).journeys[0];
    expect(legsOf(j0)).toContain('08:29 M2');
    await otherComputations(env, env.preset);
    expect(netOf(meta.generatedAt, j0.id)).toBeTruthy();
    env.server.relay.rt.tec.trips['W-0724'] = late;
    env.clock.set('2026-11-10T07:40');
    const j1 = await env.core.refresh(j0, env.preset);
    expect([j1.id, j1.label, j1.reason]).toEqual([j0.id, j0.label, j0.reason]);
    expect(legsOf(j1)).toBe(RECALCULE);
    expect(j1.alerts[0]).toMatchObject({ kind: 'delay', text: RECALC_TEXT });
  });

  it('réseau effacé de la mémoire : refait avec les mêmes fichiers, sans rien recharger', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const j0 = (await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset)).journeys[0];
    dropNets();
    expect(netMemory().nets).toBe(0);
    const calls = lineCalls(env);
    env.server.relay.rt.tec.trips['W-0724'] = late;
    env.clock.set('2026-11-10T07:40');
    const j1 = await env.core.refresh(j0, env.preset);
    expect(legsOf(j1)).toBe(RECALCULE);
    expect(j1.alerts[0]?.text).toBe(RECALC_TEXT);
    expect(lineCalls(env)).toBe(calls);
    expect(netMemory().nets).toBe(1);
  });

  it('nouvelle génération des données : rien de l’ancienne, pas de recalcul', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const meta = await env.core.init();
    const j0 = (await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset)).journeys[0];
    const next = { ...readJson<Record<string, unknown>>(`${CORE_DATA_DIR}/meta.json`), generatedAt: '2026-11-11T03:00:00Z' };
    env.server.memFiles.set('meta.json', JSON.stringify(next));
    await env.core.init();
    expect(netOf(meta.generatedAt, j0.id)).toBeTruthy();
    env.server.relay.rt.tec.trips['W-0724'] = late;
    env.clock.set('2026-11-10T07:40');
    const j1 = await env.core.refresh(j0, env.preset);
    expect(legsOf(j1)).toContain('07:44 W Waterloo Eglise → Bruxelles Midi 08:29 | marche 2 | 08:29 M2');
    expect(j1.alerts.some((a) => a.text === RECALC_TEXT)).toBe(false);
    expect(netOf(meta.generatedAt, j0.id)).toBeNull();
  });
});

describe('plan mémorisé d’un trajet favori (temps réel seul pendant 5 min)', () => {
  const fav: FavoriteTrip = { kind: 'trip', id: 'fav-rogier', from: { type: 'here' }, to: ROGIER, label: 'Rogier', propose: 'never' };

  it('identifiants, étiquettes et raisons gardés ; refresh() d’une proposition recalcule la correspondance', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const s: Settings = { ...env.preset, favorites: [...env.preset.favorites, fav] };
    const a1 = await env.core.answer(fav, WPOS, s);
    const keys = (a: typeof a1) => a.plan?.journeys.map((j) => [j.id, j.label, j.reason]);
    expect(a1.plan?.journeys.map((j) => j.label)).toEqual(['simple', 'fast', 'next']);
    env.clock.set('2026-11-10T07:32');
    const a2 = await env.core.answer(fav, WPOS, s);
    expect(keys(a2)).toEqual(keys(a1));
    // « Le suivant » (W de 07:56) : 8 min de retard, le métro de 08:47 est manqué
    const j = a2.plan!.journeys[2];
    expect(legsOf(j)).toContain('07:56 W');
    await otherComputations(env, s);
    env.server.relay.rt.tec.trips['W-0744'] = late;
    env.clock.set('2026-11-10T07:40');
    const r = await env.core.refresh(j, s);
    expect([r.id, r.label, r.reason]).toEqual([j.id, j.label, j.reason]);
    expect(legsOf(r)).toBe('marche 2 | 08:04 W Waterloo Eglise → Bruxelles Midi 08:49 | marche 2 | 08:53 M2 Gare du Midi → Rogier 09:07 | marche 3');
    expect(r.alerts[0]?.text).toBe(RECALC_TEXT);
  });
});
