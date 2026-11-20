/**
 * 1.3.1 (pôle Guidage) : contrat partagé entre le moteur et les écrans du guidage. Champs simples remplis par le moteur :
 * l'arrêt où monter (§ 4 : « ensuite : 3 min à pied → Gare Centrale », « 2 min à pied → Gare du Nord »), la
 * correspondance très juste (B16 : marge de 1 min ou moins), l'heure prévue d'un train en retard (B13 : « IC 07:42 +2 »).
 * Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Moment } from '../../src/core/guide-types';
import { connectionMargin, tightLegs } from '../../src/core/guide';
import { at, fix, guide, MIN, P, prdTrip, S, step } from './guide-fixtures';

const m = <K extends Moment['kind']>(x: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(x?.kind).toBe(kind);
  return x as Extract<Moment, { kind: K }>;
};

describe('1.3.1 : contrat du guidage', () => {
  it('marge des correspondances, à la minute près (marches comprises), et correspondances très juste', () => {
    const j = prdTrip();
    // bus 6 arrivé 07:20, 3 min à pied, IC 07:30 : 7 min ; IC arrivé 08:27, 3 min à pied, bus 71 08:34 : 4 min
    expect(connectionMargin(j.legs, 3)).toBe(7);
    expect(connectionMargin(j.legs, 5)).toBe(4);
    expect(connectionMargin(j.legs, 1)).toBeUndefined();
    expect(connectionMargin(j.legs, 0)).toBeUndefined();
    expect(tightLegs(j)).toEqual([]);
    // IC en retard de 3 min : arrivée 08:30, bus 71 à 08:34 après 3 min à pied : 1 min, très juste
    const late = prdTrip({ icDelay: 3 });
    expect(connectionMargin(late.legs, 5)).toBe(1);
    expect(tightLegs(late)).toEqual([5]);
  });

  it('« Descends » : ensuite, l’arrêt où monter, très juste, heure prévue d’un train en retard', () => {
    // IC de 07:30 en retard de 2 min : écrit « IC 07:30 +2 » (sched), correspondance de 5 min : pas très juste
    const r = guide(prdTrip({ icDelay: 2 }));
    const al = m(step(r, at('07:16:30')).moment, 'alight');
    expect(al.then).toMatchObject({ kind: 'ride', from: S.guillemins.name, depAt: at('07:32'), sched: at('07:30') });
    expect(al.then.kind === 'ride' && al.then.tight).toBeFalsy();
    // bus 71 très juste après l'IC en retard de 3 min ; un bus n'a jamais d'heure prévue écrite à part
    const r2 = guide(prdTrip({ icDelay: 3 }));
    const al2 = m(step(r2, at('08:26:30')).moment, 'alight');
    expect(al2.then).toMatchObject({ kind: 'ride', from: S.gareCentrale.name, tight: true });
    expect(al2.then.kind === 'ride' && al2.then.sched).toBeUndefined();
  });

  it('« Monter » : l’arrêt où monter ; « Où tu en es » en attente d’un train en retard : son heure prévue', () => {
    const r = guide(prdTrip({ icDelay: 2 }));
    // à la gare de Liège-Guillemins, l'IC en retard dans 10 min
    const s = step(r, at('07:22'), fix(P.guillemins, at('07:22')));
    const b = m(s.moment, 'board');
    expect(b).toMatchObject({ stop: S.guillemins.name, depAt: at('07:32'), sched: at('07:30') });
    expect(s.where.wait).toMatchObject({ depAt: at('07:32'), sched: at('07:30') });
    // à l'heure : pas d'heure prévue à part
    const r2 = guide(prdTrip());
    const s2 = step(r2, at('07:22'), fix(P.guillemins, at('07:22')));
    expect(m(s2.moment, 'board').sched).toBeUndefined();
    expect(s2.where.wait?.sched).toBeUndefined();
    expect(MIN).toBe(60_000);
  });
});

describe('1.3.1 : heure d’un véhicule à prendre (B13)', () => {
  it('« IC 07:30 +2 » pour un train en retard, « IC à 07:30 » à l’heure, jamais pour un bus', async () => {
    const { vehicleAtText } = await import('../../src/glasses/guide-views');
    const { DEFAULT_SETTINGS } = await import('../../src/core/api');
    const ctx = { now: at('07:20'), settings: DEFAULT_SETTINGS };
    const ic = { op: 'sncb' as const, mode: 'train' as const, line: 'IC', cat: 'IC' };
    expect(vehicleAtText(ic, at('07:32'), true, ctx, at('07:30'))).toBe('IC 07:30 +2');
    expect(vehicleAtText(ic, at('07:30'), true, ctx)).toBe('IC à 07:30');
    const bus = { op: 'tec' as const, mode: 'bus' as const, line: '6' };
    expect(vehicleAtText(bus, at('07:14'), true, ctx, at('07:12'))).toBe('bus 6 à 07:14');
  });
});
