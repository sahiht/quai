/**
 * 1.3.1 (pôle Guidage) : contrat partagé entre le moteur et les écrans du guidage. Champs simples remplis par le moteur :
 * l'arrêt où monter (§ 4 : « ensuite : 3 min à pied → Gare Centrale », « 2 min à pied → Gare du Nord »), la
 * correspondance très juste (B16 : marge de 1 min ou moins), l'heure prévue d'un train en retard (B13 : « IC 07:42 +2 »).
 * Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Moment } from '../../src/core/guide-types';
import { connectionMargin, tightLegs } from '../../src/core/guide';
import { at, fix, guide, IC, journeyOf, MIN, P, prdTrip, S, step, toward, walkLeg } from './guide-fixtures';

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

describe('1.3.1 : contrat, heure prévue d’un train en retard dans les autres messages du moteur (B13)', () => {
  /** À pied 13 min jusqu'à la gare de Liège-Guillemins, IC de 07:30, à pied 3 min. */
  const icFirst = (o: Parameters<typeof IC>[0] = {}, id = 'jic') => {
    const ic = IC(o);
    return journeyOf([walkLeg(S.avroy, S.guillemins, at('07:15'), 13), ic, walkLeg(S.central, S.gareCentrale, ic.arr, 3, ic.schedArr)], id, at('07:15'));
  };

  it('« Partir maintenant » et « Où tu en es » à pied : l’IC en retard de 2 min, 07:32 et son heure prévue 07:30', () => {
    const r = guide(icFirst({ icDelay: 2 }), { startedAt: at('07:10') });
    const s = step(r, at('07:15:05'), fix(P.avroy, at('07:15:05'), { speed: 0 }));
    expect(m(s.moment, 'leave')).toMatchObject({ depAt: at('07:32'), sched: at('07:30'), rt: true });
    expect(s.where.walk).toMatchObject({ depAt: at('07:32'), sched: at('07:30') });
    // à l'heure : pas d'heure prévue à part
    const r2 = guide(icFirst(), { startedAt: at('07:10') });
    const s2 = step(r2, at('07:15:05'), fix(P.avroy, at('07:15:05'), { speed: 0 }));
    expect(m(s2.moment, 'leave').sched).toBeUndefined();
    expect(s2.where.walk?.sched).toBeUndefined();
  });

  it('« Voie modifiée » : l’heure prévue du train en retard', () => {
    const r = guide(icFirst({ icDelay: 2, icNewPlatform: '5' }), { startedAt: at('07:10') });
    // connue dès le lancement : elle passe devant « Partir maintenant » (2 min)
    const s = step(r, at('07:15:05'), fix(P.avroy, at('07:15:05'), { speed: 0 }));
    expect(m(s.moment, 'platform')).toMatchObject({ platform: '5', was: '3', depAt: at('07:32'), sched: at('07:30') });
  });

  it('« walk » après la descente du bus 6 : vers la gare, l’IC en retard (heure prévue) et sa voie', () => {
    const r = guide(prdTrip({ icDelay: 2 }));
    step(r, at('07:18:30'), fix(toward(P.leman, P.guilleminsBus, 300), at('07:18:30'), { speed: 9 }));
    const s = step(r, at('07:20:20'), fix(P.guilleminsBus, at('07:20:20'), { speed: 0.4 }));
    expect(r.mem.alighted?.leg).toBe(1);
    expect(m(s.moment, 'walk')).toMatchObject({ leg: 2, walkMin: 3, toward: S.guillemins.name, final: false, vehicle: { op: 'sncb', mode: 'train', cat: 'IC' }, depAt: at('07:32'), sched: at('07:30'), rt: true, platform: '3' });
    expect(s.moment).not.toHaveProperty('arr');
  });

  it('« Nouveau trajet » : le premier train du nouveau trajet, en retard, avec son heure prévue', () => {
    // IC de 07:30 supprimé ; le nouveau trajet part avec un IC prévu à 08:30, en retard de 3 min
    const r = guide(icFirst({ icCancelled: true }), { startedAt: at('07:10') });
    const s = step(r, at('07:16'), fix(toward(P.avroy, P.guillemins, 60), at('07:16'), { speed: 1.3 }));
    expect(s.replan).toMatchObject({ reason: 'cancelled' });
    const ic2 = { ...IC({ icDelay: 3 }) };
    const H = 60 * MIN;
    for (const k of ['dep', 'arr', 'schedDep', 'schedArr'] as const) ic2[k] += H;
    ic2.stops = ic2.stops?.map((x) => ({ ...x, sched: x.sched + H, est: x.est + H }));
    r.j = journeyOf([walkLeg(S.avroy, S.guillemins, at('08:15'), 13), ic2, walkLeg(S.central, S.gareCentrale, ic2.arr, 3, ic2.schedArr)], 'jic2', at('08:15'));
    const s2 = step(r, at('07:16:10'), fix(toward(P.avroy, P.guillemins, 70), at('07:16:10'), { speed: 1.3 }));
    const re = m(s2.moment, 'replan');
    expect(re).toMatchObject({ reason: 'cancelled', next: { depAt: at('08:33'), sched: at('08:30'), platform: '3', rt: true } });
    expect(re).not.toHaveProperty('planned');
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
