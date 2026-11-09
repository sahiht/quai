/**
 * Trains A → B (direct ou une correspondance) avec temps réel, et filtre de Pareto.
 */
import { describe, expect, it } from 'vitest';
import type { Journey } from '../../src/core/api';
import { pareto, type TrainOption } from '../../src/core/trains';
import { hhmm } from '../../src/core/util';
import { makeEnv } from './support/env';
import { at } from './support/network';

const CENTRAL = 'sncb:8813003';
const GAND = 'sncb:8892007';
const NAMUR = 'sncb:8863008';

const fmt = (j: Journey) => {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  const p = first.newPlatform ?? first.platform;
  const state = first.cancelled ? 'supprimé' : first.delayMin ? `+${first.delayMin} min` : first.rt ? 'à l’heure' : '~';
  return `${hhmm(first.schedDep)} → ${hhmm(last.arr)} voie ${p} ${state}`;
};

describe('trains : scénario 3 (Bruxelles-Central → Gand-Saint-Pierre dès 13:55)', () => {
  it('trois trains directs, retard propagé jusqu’à l’arrivée', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    const js = await core.trains(CENTRAL, GAND, at('2026-11-10T13:55'));
    expect(js.map(fmt)).toEqual(['14:10 → 14:39 voie 4 à l’heure', '14:22 → 14:56 voie 6 +3 min', '14:40 → 15:09 voie 4 à l’heure']);
    expect(js.every((j) => j.transfers === 0 && j.rt)).toBe(true);
    const j = js[1];
    expect(hhmm(j.dep)).toBe('14:25');
    expect(hhmm(j.legs[0].schedArr)).toBe('14:53');
    expect(j.legs[0]).toMatchObject({ cat: 'IC', num: '1810', op: 'sncb', mode: 'train', fromSeq: 2, toSeq: 4 });
    expect(j.legs[0].head?.fr).toBe('Anvers-Central');
    // arrêts de la montée à la descente, retard propagé
    expect(j.legs[0].stops?.map((s) => `${s.name.fr} ${hhmm(s.sched)}/${hhmm(s.est)}`)).toEqual([
      'Bruxelles-Central 14:22/14:25',
      'Bruxelles-Midi 14:26/14:29',
      'Gand-Saint-Pierre 14:53/14:56',
    ]);
    expect(js[0].alerts).toEqual([]);
  });

  it('identifiants stables et limite', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    const a = await core.trains(CENTRAL, GAND, at('2026-11-10T13:55'), 2);
    const b = await core.trains(CENTRAL, GAND, at('2026-11-10T13:55'), 2);
    expect(a).toHaveLength(2);
    expect(a.map((j) => j.id)).toEqual(b.map((j) => j.id));
    expect(new Set(a.map((j) => j.id)).size).toBe(2);
  });

  it('scène noRT : horaires prévus', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55', scene: 'noRT' });
    const js = await core.trains(CENTRAL, GAND, at('2026-11-10T13:55'));
    expect(js.map(fmt)).toEqual(['14:10 → 14:39 voie 4 ~', '14:22 → 14:53 voie 6 ~', '14:40 → 15:09 voie 4 ~']);
    expect(js.every((j) => !j.rt)).toBe(true);
  });
});

describe('trains : correspondance', () => {
  it('Namur → Gand-Saint-Pierre à 07:31 : IC 07:42, une correspondance, arrivée 09:29', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const js = await core.trains(NAMUR, GAND, at('2026-11-10T07:31'));
    const j = js[0];
    expect(j.transfers).toBe(1);
    expect(hhmm(j.legs[0].schedDep)).toBe('07:42');
    expect(hhmm(j.arr)).toBe('09:29');
    const [a, b] = j.legs;
    expect(a.to.areaId).toBe(b.from.areaId);
    expect(['sncb:8813003', 'sncb:8812005']).toContain(a.to.areaId);
    expect(b.schedDep - a.schedArr).toBeGreaterThanOrEqual(4 * 60_000);
    expect(a.tripId).not.toBe(b.tripId);
    expect(b.head?.fr).toBe('Bruges');
    expect(b.stops?.[b.stops.length - 1].name.fr).toBe('Gand-Saint-Pierre');
    // les trajets suivants partent plus tard
    for (let i = 1; i < js.length; i++) expect(js[i].legs[0].schedDep).toBeGreaterThan(js[i - 1].legs[0].schedDep);
  });

  it('avec temps réel : le retard de l’IC 07:42 ne casse pas la correspondance', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31' });
    const j = (await core.trains(NAMUR, GAND, at('2026-11-10T07:31')))[0];
    expect(j.legs[0]).toMatchObject({ delayMin: 2, newPlatform: '6', rt: true });
    expect(hhmm(j.arr)).toBe('09:29');
    expect(j.legs[1].rt).toBe(false);
    expect(j.rt).toBe(false);
  });

  it('après minuit : l’IC 2199 de 23:52 (Midi) arrive à Anvers à 00:36', async () => {
    const { core } = makeEnv({ now: '2026-11-10T23:30', scene: 'noRT' });
    const js = await core.trains('sncb:8814001', 'sncb:8821006', at('2026-11-10T23:30'), 1);
    expect(js[0].legs[0].num).toBe('2199');
    expect(js[0].arr).toBe(at('2026-11-11T00:36'));
  });

  it('même gare ou gare inconnue : aucun trajet', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    expect(await core.trains(CENTRAL, CENTRAL, at('2026-11-10T13:55'))).toEqual([]);
    expect(await core.trains(CENTRAL, 'sncb:0000000', at('2026-11-10T13:55'))).toEqual([]);
  });
});

describe('trains : régression « doublons » (même train chaque jour)', () => {
  const identity = (j: Journey) => j.legs.map((l) => `${l.tripId}:${l.from.areaId}>${l.to.areaId}`).join('|');

  it('Bruxelles-Central → Gand-Saint-Pierre, 10 demandés à 12:10 : chaque train une fois, celui du jour', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    const js = await core.trains(CENTRAL, GAND, at('2026-11-10T12:10'), 10);
    expect(new Set(js.map(identity)).size).toBe(js.length);
    expect(js.map(fmt)).toEqual(['14:10 → 14:39 voie 4 à l’heure', '14:22 → 14:56 voie 6 +3 min', '14:40 → 15:09 voie 4 à l’heure']);
  });

  it('Namur → Gand à 07:31 : l’IC 08:42 du lendemain n’est pas reproposé ; le soir, le premier train du lendemain', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const js = await core.trains(NAMUR, GAND, at('2026-11-10T07:31'), 5);
    expect(new Set(js.map(identity)).size).toBe(js.length);
    expect(js.map((j) => hhmm(j.legs[0].schedDep))).toEqual(['07:42', '08:42']);
    const late = makeEnv({ now: '2026-11-10T20:00', scene: 'noRT' });
    const next = await late.core.trains(NAMUR, GAND, at('2026-11-10T20:00'), 3);
    // le 11 (férié), l'IC 09:42 (HOLI) attrape la même correspondance que l'IC 08:42 : on part le plus tard possible
    expect(next.map((j) => `${j.legs[0].schedDep === at('2026-11-11T09:42')} ${hhmm(j.arr)}`)).toEqual(['true 14:39']);
  });
});

describe('pareto', () => {
  const o = (dep: number, arr: number, transfers: number): TrainOption => ({ dep, arr, rides: new Array(transfers + 1).fill(null) as never });
  it('retire les trajets qui partent plus tôt et arrivent plus tard ; garde le direct plus lent', () => {
    const r = pareto([o(10, 50, 1), o(12, 40, 1), o(12, 45, 0), o(5, 60, 0), o(12, 40, 1), o(20, 70, 0)]);
    expect(r.map((x) => [x.dep, x.arr, x.rides.length - 1])).toEqual([
      [12, 40, 1],
      [12, 45, 0],
      [20, 70, 0],
    ]);
  });
});
