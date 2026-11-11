/**
 * Temps réel des trajets 1.1 (design-routing.md § 4.9) : bus et trams De Lijn et TEC par /api/rt (trip_id des
 * fichiers de ligne, arrêts `fromStop` / `toStop`), STIB par /api/stib sur le point de montée ; refresh() garde
 * l'étiquette et la raison ; correspondance rendue impossible par un retard : reste du trajet recalculé.
 */
import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../../../src/core/api';
import { hhmm } from '../../../src/core/util';
import { makeEnv } from '../support/env';
import { at } from '../support/network';
import { legsOf } from './support';

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

  it('route() : le bus W en retard de 8 min manque le métro de 08:29 ; trajet recalculé (métro de 08:35)', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.relay.rt.tec.trips['W-0724'] = late;
    const r = await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset);
    const w = r.journeys.find((j) => j.legs.some((l) => l.tripId === 'W-0724'));
    expect(w && legsOf(w)).toBe('marche 2 | 07:44 W WATERLOO Eglise → BRUXELLES Midi 08:29 | marche 2 | 08:35 M2 Gare du Midi → Rogier 08:49 | marche 3');
    expect(w?.alerts[0]?.text).toBe('! Correspondance recalculée');
  });

  it('refresh() d’un trajet suivi : même identifiant, étapes recalculées, alerte en tête', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const r = await env.core.route(WATERLOO, ROGIER, at('2026-11-10T07:31'), env.preset);
    const j0 = r.journeys[0];
    expect(legsOf(j0)).toContain('08:29 M2');
    env.server.relay.rt.tec.trips['W-0724'] = late;
    env.clock.set('2026-11-10T07:40');
    const j1 = await env.core.refresh(j0, env.preset);
    expect([j1.id, j1.label, j1.reason]).toEqual([j0.id, j0.label, j0.reason]);
    expect(legsOf(j1)).toBe('marche 2 | 07:44 W WATERLOO Eglise → BRUXELLES Midi 08:29 | marche 2 | 08:35 M2 Gare du Midi → Rogier 08:49 | marche 3');
    expect(j1.alerts[0]).toMatchObject({ kind: 'delay', text: '! Correspondance recalculée' });
    expect(hhmm(j1.arr)).toBe('08:52');
  });
});
