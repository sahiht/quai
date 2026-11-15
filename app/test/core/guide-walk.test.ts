/**
 * 1.2.10 : géométrie du guidage (core/guide-walk.ts) : projection sur une polyligne, progression sur un chemin à
 * pied, virages annoncés, caps.
 */
import { describe, expect, it } from 'vitest';
import { bearingDeg, cumulative, knownPoint, projectOn, relativeDeg, turnsOf, walkProgress } from '../../src/core/guide-walk';
import { distanceM } from '../../src/core/util';
import { firstWalkRoute, offset, P, route } from './guide-fixtures';

const near = (x: number, y: number, tol = 2) => expect(Math.abs(x - y)).toBeLessThanOrEqual(tol);

describe('projection', () => {
  const a = P.flagey;
  const b = offset(a, 1000, 0);
  it('sur un segment : distance parcourue et écart', () => {
    const pr = projectOn([a, b], offset(a, 300, 20));
    near(pr.alongM, 300);
    near(pr.offM, 20);
    expect(pr.seg).toBe(0);
    near(pr.totalM, 1000);
  });

  it('avant le début et après la fin : bornée', () => {
    const before = projectOn([a, b], offset(a, -50, 0));
    expect(before.alongM).toBe(0);
    near(before.offM, 50);
    const after = projectOn([a, b], offset(b, 70, 0));
    near(after.alongM, after.totalM, 0.001);
    near(after.offM, 70);
  });

  it('polyligne vide ou d’un point', () => {
    expect(projectOn([], a).offM).toBe(Infinity);
    const one = projectOn([a], offset(a, 30, 40));
    expect(one.alongM).toBe(0);
    near(one.offM, 50);
  });

  it('distances cumulées', () => {
    const c = cumulative([a, b, offset(b, 0, 500)]);
    expect(c[0]).toBe(0);
    near(c[1], 1000);
    near(c[2], 1500);
  });
});

describe('progression sur un chemin à pied', () => {
  const rt = firstWalkRoute();
  it('reste et prochain virage', () => {
    const pr = walkProgress(rt, offset(P.avroy, 3, -100));
    near(pr.alongM, 100);
    near(pr.offRouteM, 3);
    near(pr.remainingM, rt.lengthM - 100);
    expect(pr.next?.m.turn).toBe('right');
    near(pr.next!.distM, 100);
  });

  it('après le dernier virage : plus de prochain virage', () => {
    const pr = walkProgress(rt, offset(P.gramme, 0, -100));
    expect(pr.next).toBeUndefined();
    near(pr.remainingM, 100);
  });

  it('chemin sans points : le segment du départ à l’arrivée', () => {
    const pr = walkProgress({ ...rt, coords: [] }, offset(P.avroy, 0, -10));
    near(pr.remainingM, distanceM(P.avroy, P.gramme), 15);
    expect(pr.next).toBeUndefined();
  });
});

describe('virages annoncés', () => {
  const a = P.flagey;
  const b = offset(a, 0, -200);
  const c = offset(b, 200, 0);
  const d = offset(c, 0, -15);
  it('chemin droit (sans données) : aucun', () => {
    expect(turnsOf(route([a, b, c], [{ at: 1, turn: 'left' }], 'straight'))).toEqual([]);
  });
  it('« tout droit » jamais annoncé ; aucun virage dans les 20 derniers mètres', () => {
    const t = turnsOf(route([a, b, c, d], [{ at: 1, turn: 'straight' }, { at: 2, turn: 'right' }]));
    expect(t).toEqual([]);
    const u = turnsOf(route([a, b, c, d], [{ at: 1, turn: 'left' }, { at: 2, turn: 'right' }]));
    expect(u.map((x) => [x.i, x.m.turn])).toEqual([[0, 'left']]);
    near(u[0].alongM, 200);
  });
  it('rang hors des points : la distance donnée par le chemin', () => {
    const rt = route([a, b, c], [{ at: 1, turn: 'left' }]);
    rt.maneuvers[0] = { ...rt.maneuvers[0], at: 99, distM: 123 };
    expect(turnsOf(rt)[0].alongM).toBe(123);
  });
  it('demi-tour au départ d’un nouveau chemin : annoncé (« Fais demi-tour »)', () => {
    const rt = route([a, b, c], [{ at: 0, turn: 'uturn' }]);
    const pr = walkProgress(rt, a);
    expect(pr.next?.m.turn).toBe('uturn');
    expect(pr.next?.distM).toBe(0);
  });
});

describe('caps', () => {
  const o = { lat: 50.8, lon: 4.3 };
  it('nord, est, sud, ouest', () => {
    near(bearingDeg(o, offset(o, 0, 500)), 0, 0.5);
    near(bearingDeg(o, offset(o, 500, 0)), 90, 0.5);
    near(bearingDeg(o, offset(o, 0, -500)), 180, 0.5);
    near(bearingDeg(o, offset(o, -500, 0)), 270, 0.5);
  });
  it('direction par rapport au cap, de -180 à 180', () => {
    expect(relativeDeg(10, 350)).toBe(20);
    expect(relativeDeg(350, 10)).toBe(-20);
    expect(relativeDeg(180, 0)).toBe(180);
    expect(relativeDeg(0, 180)).toBe(180);
    expect(relativeDeg(90, 90)).toBe(0);
  });
  it('positions inconnues (0, 0), non numériques, absentes', () => {
    expect(knownPoint({ lat: 0, lon: 0 })).toBe(false);
    expect(knownPoint({ lat: Number.NaN, lon: 4 })).toBe(false);
    expect(knownPoint(undefined)).toBe(false);
    expect(knownPoint({ lat: 50.8, lon: 4.3 })).toBe(true);
  });
});
