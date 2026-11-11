/**
 * Temps réel des trajets 1.1 (design-routing.md § 4.9) : bus et trams De Lijn et TEC par /api/rt (trip_id des
 * fichiers de ligne, arrêts `fromStop` / `toStop`), STIB par /api/stib sur le point de montée ; refresh() garde
 * l'étiquette et la raison ; correspondance rendue impossible par un retard : reste du trajet recalculé ; premier
 * véhicule parti à l'heure prévue mais en retard : proposé tant qu'il reste attrapable sur l'heure estimée.
 */
import { describe, expect, it } from 'vitest';
import type { Endpoint, Journey } from '../../../src/core/api';
import { hhmm } from '../../../src/core/util';
import { makeEnv, type Scene } from '../support/env';
import { at } from '../support/network';
import { legsOf, plain, summary } from './support';

const here: Endpoint = { type: 'here' };
const S1 = { lat: 50.4655, lon: 4.859 };
const S2 = { lat: 50.86, lon: 4.359 };
const addr = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });

describe('temps réel des bus, trams et métros', () => {
  it('De Lijn : bus 460 de 12:18, +2 min à la montée, propagé à la descente (trip_id du fichier de ligne)', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    const r = await env.core.route(here, addr('Meise Centrum', 50.9392, 4.3272), at('2026-11-10T12:10'), env.preset, S2);
    const ride = r.journeys[0].legs.find((l) => l.kind === 'ride');
    expect(ride).toMatchObject({ op: 'delijn', line: '460', tripId: '704601218', fromStop: '308613', toStop: '300450', rt: true, delayMin: 2 });
    expect([hhmm(ride?.schedDep ?? 0), hhmm(ride?.dep ?? 0), hhmm(ride?.arr ?? 0)]).toEqual(['12:18', '12:20', '12:42']);
    expect(ride?.stops?.map((s) => hhmm(s.est))).toEqual(['12:20', '12:42']);
    expect(env.server.calls.some((u) => u.includes('/api/rt?op=delijn') && u.includes('704601218'))).toBe(true);
  });

  it('TEC : bus 5 de 07:50, +3 min ; scène noRT : horaire prévu', async () => {
    const env = makeEnv({ now: '2026-11-10T07:45' });
    const bouge = addr('Bouge, place', 50.4772, 4.8852);
    const r = await env.core.route(here, bouge, at('2026-11-10T07:45'), env.preset, S1);
    const ride = r.journeys[0].legs.find((l) => l.kind === 'ride');
    expect(ride).toMatchObject({ op: 'tec', line: '5', tripId: 'N5-0750', rt: true, delayMin: 3 });
    expect(hhmm(ride?.dep ?? 0)).toBe('07:53');
    const off = makeEnv({ now: '2026-11-10T07:45', scene: 'noRT' });
    const r2 = await off.core.route(here, bouge, at('2026-11-10T07:45'), off.preset, S1);
    expect(r2.journeys[0].legs.find((l) => l.kind === 'ride')).toMatchObject({ rt: false, delayMin: 0 });
  });

  it('STIB : passage du point de montée (6357), retard de 2 min, destination vide acceptée', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    env.server.relay.stib.points['6357'] = [{ line: '3', dest: { fr: '', nl: '' }, times: ['2026-11-10T12:14:00+01:00', '2026-11-10T12:22:00+01:00'] }];
    const bourse = addr('Bourse', 50.8483, 4.3497);
    const r = await env.core.route(here, bourse, at('2026-11-10T12:10'), env.preset, S2);
    const ride = r.journeys[0].legs.find((l) => l.kind === 'ride');
    expect(ride).toMatchObject({ op: 'stib', line: '3', fromStop: '6357', rt: true, delayMin: 2 });
    expect([hhmm(ride?.schedDep ?? 0), hhmm(ride?.dep ?? 0), hhmm(ride?.arr ?? 0)]).toEqual(['12:12', '12:14', '12:19']);
    // un seul appel STIB, pour le point de montée de chaque proposition (pas tous les points de la zone)
    const stib = env.server.calls.filter((u) => u.includes('/api/stib'));
    expect(stib.length).toBe(1);
    expect(stib[0]).toContain('6357');
  });

  it('refresh() garde l’étiquette et la raison, applique le temps réel aux étapes urbaines', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10', scene: 'noRT' });
    const r = await env.core.route(here, addr('Meise Centrum', 50.9392, 4.3272), at('2026-11-10T12:10'), env.preset, S2);
    const j0 = r.journeys[0];
    expect(j0.legs.find((l) => l.kind === 'ride')?.rt).toBe(false);
    env.server.scene = 'base';
    env.clock.advance(30_000);
    const j1 = await env.core.refresh(j0, env.preset);
    expect([j1.id, j1.label, j1.reason]).toEqual([j0.id, j0.label, j0.reason]);
    expect(j1.legs.find((l) => l.kind === 'ride')).toMatchObject({ rt: true, delayMin: 2 });
  });
});

describe('correspondance rendue impossible par un retard (§ 4.9, point 2)', () => {
  const WATERLOO = addr('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399);
  const ROGIER = addr('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36);
  const late = { u: [[2, 'Bwategl1', 480, null, 0]] as [number, string, number, null, 0][] };
  const RECALCULE = 'marche 2 | 07:44 W Waterloo Eglise → Bruxelles Midi 08:29 | marche 2 | 08:35 M2 Gare du Midi → Rogier 08:49 | marche 3';
  /** Le bus W de 07:36 puis le métro (1.2.1 : la proposition 1 ; le S1 de 07:55 et ses 19 min à pied : « Plus tôt »). */
  const busW = (js: Journey[]) => js.find((j) => j.legs.some((l) => l.tripId === 'W-0724'));

  it('route() : S1 de 07:55 supprimé, bus W en retard de 8 min qui manque le métro de 08:29 : recalculé, en tête', async () => {
    const probe = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const proposals = (await probe.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), probe.preset)).journeys;
    const s1 = proposals.find((j) => j.label === 'earlier')?.legs.find((l) => l.kind === 'ride');
    expect(s1).toMatchObject({ cat: 'S1' });
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.relay.rt.sncb.trips[s1?.tripId ?? ''] = { cancelled: true, u: [] };
    env.server.relay.rt.tec.trips['W-0724'] = late;
    const r = await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset);
    const w = busW(r.journeys);
    expect(w && legsOf(w)).toBe(RECALCULE);
    expect(w?.label).toBe('short');
    expect(w?.alerts[0]?.text).toBe('! Correspondance recalculée');
    expect(r.journeys.some((j) => j.legs.some((l) => l.tripId === s1?.tripId))).toBe(false);
  });

  it('refresh() d’un trajet suivi : même identifiant, étapes recalculées, alerte en tête', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const r = await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset);
    const j0 = busW(r.journeys);
    if (!j0) throw new Error('bus W');
    expect(j0.label).toBe('short');
    expect(legsOf(j0)).toContain('08:29 M2');
    env.server.relay.rt.tec.trips['W-0724'] = late;
    env.clock.set('2026-11-10T07:40');
    const j1 = await env.core.refresh(j0, env.preset);
    expect([j1.id, j1.label, j1.reason]).toEqual([j0.id, j0.label, j0.reason]);
    expect(legsOf(j1)).toBe(RECALCULE);
    expect(j1.alerts[0]).toMatchObject({ kind: 'delay', text: '! Correspondance recalculée' });
    expect(hhmm(j1.arr)).toBe('08:52');
  });
});

describe('premier véhicule en retard mais encore attrapable (PRD § 4.2 et § 4.5)', () => {
  // l'IC de 14:22 de Bruxelles-Central vers Gand-Saint-Pierre a 3 min de retard dans la scène base (estimé 14:25)
  const gand = () => {
    const f = makeEnv({ now: '2026-11-10T14:00' }).preset.favorites.find((x) => x.id === 'fav-gand');
    if (f?.kind !== 'trip') throw new Error('fav-gand');
    return f;
  };
  const NEAR = { lat: 50.8468, lon: 4.3592 }; // 4 min à pied de Bruxelles-Central
  const route = async (now: string, scene: Scene, from?: Endpoint) => {
    const env = makeEnv({ now, scene });
    const f = gand();
    return env.core.route(from ?? f.from, f.to, at(now), env.preset, NEAR);
  };

  it('14:23 à Bruxelles-Central : l’IC de 14:22 (+3 min) en tête, puis l’IC de 14:40', async () => {
    const r = await route('2026-11-10T14:23', 'base');
    expect(summary(r)).toEqual(['short: 14:25 IC Bruxelles-Central → Gand-Saint-Pierre 14:56', 'next: 14:40 IC Bruxelles-Central → Gand-Saint-Pierre 15:09']);
    const ic = r.journeys[0].legs[0];
    expect([hhmm(ic.schedDep), ic.rt, ic.delayMin]).toEqual(['14:22', true, 3]);
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : direct');
    expect(plain(r.journeys[1].reason)).toBe('Le suivant : même trajet, 18 min plus tard');
  });

  it('parti d’après l’heure estimée (14:26), ou sans temps réel : seulement l’IC de 14:40', async () => {
    expect(summary(await route('2026-11-10T14:26', 'base'))).toEqual(['short: 14:40 IC Bruxelles-Central → Gand-Saint-Pierre 15:09']);
    expect(summary(await route('2026-11-10T14:23', 'noRT'))).toEqual(['short: 14:40 IC Bruxelles-Central → Gand-Saint-Pierre 15:09']);
  });

  it('la marche jusqu’au train compte : 4 min à pied, encore attrapable à 14:21, plus à 14:22', async () => {
    const r1 = await route('2026-11-10T14:21', 'base', here);
    expect(legsOf(r1.journeys[0])).toBe('marche 4 | 14:25 IC Bruxelles-Central → Gand-Saint-Pierre 14:56');
    const r2 = await route('2026-11-10T14:22', 'base', here);
    expect(summary(r2)).toEqual(['short: marche 4 | 14:40 IC Bruxelles-Central → Gand-Saint-Pierre 15:09']);
  });

  it('favori « Gand » à 14:23, depuis la gare : l’IC de 14:22 (+3 min) en tête', async () => {
    const env = makeEnv({ now: '2026-11-10T14:23' });
    const a = await env.core.answer(gand(), { lat: 50.8454, lon: 4.3571 }, env.preset);
    expect(a.plan?.journeys.map((j) => `${j.label}: ${legsOf(j)}`)).toEqual([
      'short: 14:25 IC Bruxelles-Central → Gand-Saint-Pierre 14:56',
      'next: 14:40 IC Bruxelles-Central → Gand-Saint-Pierre 15:09',
    ]);
  });
});
