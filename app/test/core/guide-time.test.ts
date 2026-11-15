/**
 * 1.2.10 : le guidage ne compte qu'en instants (epoch ms), jamais en heures locales : minuit, passage à l'heure
 * d'hiver (25/10/2026, 03:00 → 02:00) et à l'heure d'été (29/03/2026, 02:00 → 03:00).
 */
import { describe, expect, it } from 'vitest';
import type { Moment } from '../../src/core/guide-types';
import { guideNowText } from '../../src/core/guide';
import { at, guide, journeyOf, kindOf, MIN, N, P, rideLeg, S, step, walkLeg } from './guide-fixtures';

const m = <K extends Moment['kind']>(mo: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(mo?.kind).toBe(kind);
  return mo as Extract<Moment, { kind: K }>;
};
const iso = (s: string) => Date.parse(s);

describe('minuit', () => {
  const D2 = '2026-11-17';
  const bus = rideLeg({ op: 'tec', mode: 'bus', line: '6', head: 'Gare des Guillemins', stops: [{ p: S.gramme, t: at('23:52') }, { p: S.leman, t: at('23:58') }, { p: S.guilleminsBus, t: at('00:05', D2) }] });
  const j = journeyOf([walkLeg(S.avroy, S.gramme, at('23:45'), 5), bus, walkLeg(S.guilleminsBus, S.guillemins, at('00:05', D2), 7)], 'jnuit', at('23:45'));

  it('partir à 23:45, monter à 23:50, descendre après minuit, « Tu y es » à 00:12, fin à 00:14', () => {
    const r = guide(j, { startedAt: at('23:30') });
    const s0 = step(r, at('23:30'));
    expect(guideNowText(s0, j, 'fr')).toBe('partir à 23:45');
    expect(m(step(r, at('23:45')).moment, 'leave')).toMatchObject({ marginMin: 2, depAt: at('23:52') });
    expect(m(step(r, at('23:50')).moment, 'board')).toMatchObject({ depAt: at('23:52') });
    expect(step(r, at('23:53')).moment).toBeNull();
    expect(step(r, at('00:00:59', D2)).moment).toBeNull();
    expect(m(step(r, at('00:01', D2)).moment, 'alight')).toMatchObject({ at: at('00:05', D2), then: { kind: 'walk', min: 7, last: true } });
    expect(step(r, at('00:07', D2)).phase).toEqual({ kind: 'walk', leg: 2 });
    expect(m(step(r, at('00:12', D2)).moment, 'arrived')).toMatchObject({ at: at('00:12', D2), diffMin: 0 });
    expect(step(r, at('00:14', D2)).ended).toBe(true);
  });
});

describe('heure d’hiver (25/10/2026)', () => {
  // train de nuit : 01:40 (été) → 02:30 (été) → 02:10 (hiver, la seconde fois) → 02:20 (hiver) : 1 h 40 réelles
  const A = { name: N('Liège-Guillemins'), ...P.guillemins, areaId: 'sncb:8841004' };
  const B = { name: N('Louvain', 'Leuven'), ...P.louvain, areaId: 'sncb:8833001' };
  const C = { name: N('Bruxelles-Nord', 'Brussel-Noord'), ...P.nord, areaId: 'sncb:8812005' };
  const D = { name: N('Bruxelles-Central', 'Brussel-Centraal'), ...P.central, areaId: 'sncb:8813003' };
  const train = rideLeg({
    op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Bruxelles-Midi', platform: '1',
    stops: [{ p: A, t: iso('2026-10-25T01:40:00+02:00') }, { p: B, t: iso('2026-10-25T02:30:00+02:00') }, { p: C, t: iso('2026-10-25T02:10:00+01:00') }, { p: D, t: iso('2026-10-25T02:20:00+01:00') }],
  });
  const j = journeyOf([walkLeg(S.avroy, A, iso('2026-10-25T01:30:00+02:00'), 8), train], 'jhiver', iso('2026-10-25T01:30:00+02:00'));

  it('heures locales justes et durées réelles', () => {
    expect(train.arr - train.dep).toBe(100 * MIN);
    const r = guide(j, { startedAt: iso('2026-10-25T01:00:00+02:00') });
    expect(guideNowText(step(r, iso('2026-10-25T01:00:00+02:00')), j, 'fr')).toBe('partir à 01:30');
    expect(m(step(r, iso('2026-10-25T01:30:00+02:00')).moment, 'leave')).toMatchObject({ marginMin: 2 });
  });

  it('« Prochain arrêt » à la seconde 02:09 seulement, « Descends » à 02:16 d’hiver (pas à 02:16 d’été)', () => {
    const r = guide(j, { startedAt: iso('2026-10-25T01:00:00+02:00') });
    expect(step(r, iso('2026-10-25T02:09:30+02:00')).moment).toBeNull();
    expect(step(r, iso('2026-10-25T02:16:00+02:00')).moment).toBeNull();
    expect(m(step(r, iso('2026-10-25T02:29:00+02:00')).moment, 'nextStop')).toMatchObject({ stop: N('Louvain', 'Leuven') });
    expect(m(step(r, iso('2026-10-25T02:09:30+01:00')).moment, 'nextStop')).toMatchObject({ stop: N('Bruxelles-Nord', 'Brussel-Noord'), stopsToAlight: 1 });
    expect(step(r, iso('2026-10-25T02:15:59+01:00')).moment).toBeNull();
    expect(kindOf(step(r, iso('2026-10-25T02:16:00+01:00')))).toBe('alight');
    expect(m(step(r, iso('2026-10-25T02:22:00+01:00')).moment, 'arrived')).toMatchObject({ diffMin: 0 });
    expect(step(r, iso('2026-10-25T02:24:00+01:00')).ended).toBe(true);
  });
});

describe('heure d’été (29/03/2026)', () => {
  // bus : 01:50 (hiver) → 03:01 → 03:05 (été) : 15 min réelles ; marche 01:43 → 01:48, puis 03:05 → 03:12
  const bus = rideLeg({ op: 'tec', mode: 'bus', line: '6', head: 'Gare des Guillemins', stops: [{ p: S.gramme, t: iso('2026-03-29T01:50:00+01:00') }, { p: S.leman, t: iso('2026-03-29T03:01:00+02:00') }, { p: S.guilleminsBus, t: iso('2026-03-29T03:05:00+02:00') }] });
  const j = journeyOf([walkLeg(S.avroy, S.gramme, iso('2026-03-29T01:43:00+01:00'), 5), bus, walkLeg(S.guilleminsBus, S.guillemins, bus.arr, 7)], 'jete', iso('2026-03-29T01:43:00+01:00'));

  it('marge, montée, descente et arrivée à l’heure réelle', () => {
    expect(bus.arr - bus.dep).toBe(15 * MIN);
    const r = guide(j, { startedAt: iso('2026-03-29T01:30:00+01:00') });
    expect(m(step(r, iso('2026-03-29T01:43:00+01:00')).moment, 'leave')).toMatchObject({ marginMin: 2 });
    expect(kindOf(step(r, iso('2026-03-29T01:48:00+01:00')))).toBe('board');
    expect(step(r, iso('2026-03-29T03:01:29+02:00')).moment).toBeNull();
    expect(kindOf(step(r, iso('2026-03-29T03:01:30+02:00')))).toBe('alight');
    const w = step(r, iso('2026-03-29T03:08:00+02:00'));
    expect(w.phase).toEqual({ kind: 'walk', leg: 2 });
    expect(guideNowText(w, j, 'fr')).toBe('à pied, arrivée 03:12');
    expect(m(step(r, iso('2026-03-29T03:12:00+02:00')).moment, 'arrived')).toMatchObject({ at: iso('2026-03-29T03:12:00+02:00'), diffMin: 0 });
  });
});
