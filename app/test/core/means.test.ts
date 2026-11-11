import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg } from '../../src/core/api';
import { displayLabel, easterSunday, HOLIDAY_TEXT, holidayName, longestWalk, meansText, rideName, walksMore } from '../../src/core/means';

const at = (iso: string) => Date.parse(iso);
const place = { name: { fr: 'x', nl: 'x' }, lat: 50.8, lon: 4.3 };
const walk = (min: number): Leg => ({ kind: 'walk', from: place, to: place, dep: 0, arr: 0, schedDep: 0, schedArr: 0, walkMin: min });
const ride = (r: Partial<Leg>): Leg => ({ kind: 'ride', from: place, to: place, dep: 0, arr: 0, schedDep: 0, schedArr: 0, ...r });
const trip = (label: JourneyLabel | undefined, legs: Leg[]): Pick<Journey, 'label' | 'legs'> => ({ label, legs });

describe('means : comment on voyage', () => {
  it('nom court de chaque véhicule', () => {
    expect(rideName({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' })).toBe('IC');
    expect(rideName({ op: 'sncb', mode: 'train', line: 'S1', cat: 'S1' })).toBe('S1');
    expect(rideName({ op: 'tec', mode: 'bus', line: 'W' })).toBe('bus W');
    expect(rideName({ op: 'stib', mode: 'tram', line: '92' })).toBe('tram 92');
    expect(rideName({ op: 'stib', mode: 'metro', line: '2' })).toBe('métro 2');
  });

  it('« bus W + S1 », plus de trois véhicules coupés, marche seule', () => {
    const w = ride({ op: 'tec', mode: 'bus', line: 'W' });
    const s1 = ride({ op: 'sncb', mode: 'train', line: 'S1', cat: 'S1' });
    const m2 = ride({ op: 'stib', mode: 'metro', line: '2' });
    const t92 = ride({ op: 'stib', mode: 'tram', line: '92' });
    expect(meansText({ legs: [walk(6), w, walk(1), s1, walk(9)] })).toBe('bus W + S1');
    expect(meansText({ legs: [w, s1, m2, t92] })).toBe('bus W + S1 + métro 2 + …');
    expect(meansText({ legs: [walk(12)] })).toBe('à pied');
  });

  it('plus longue marche', () => {
    expect(longestWalk({ legs: [walk(6), ride({}), walk(1), ride({}), walk(9)] })).toBe(9);
    expect(longestWalk({ legs: [ride({})] })).toBe(0);
  });
});

describe('means : nom affiché d’une proposition', () => {
  const bus = ride({ op: 'tec', mode: 'bus', line: 'W' });
  const ic = ride({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' });
  const first = trip('short', [walk(6), bus, walk(1), ic, walk(9)]);
  const earlier = trip('earlier', [walk(19), ic, walk(9)]);

  it('« Moins de marche » quand une proposition « Plus tôt » marche plus', () => {
    expect(displayLabel(first, [first, earlier])).toBe('Moins de marche');
    expect(displayLabel(earlier, [first, earlier])).toBe('Plus tôt');
  });

  it('« Le plus court » sinon', () => {
    expect(displayLabel(first, [first])).toBe('Le plus court');
    const earlierLessWalk = trip('earlier', [walk(2), ic, walk(2)]);
    expect(displayLabel(first, [first, earlierLessWalk])).toBe('Le plus court');
    expect(displayLabel(trip('next', [bus]), [first])).toBe('Le suivant');
    expect(displayLabel(trip(undefined, [bus]), [first])).toBe('Autre trajet');
  });

  it('marcher plus : une plus longue marche plus longue, et de plus de 5 min (la nuit, 3 min à pied ne comptent pas)', () => {
    const direct = trip('short', [ic]);
    const threeMin = trip('earlier', [walk(3), bus, walk(1), ic, walk(2)]);
    const sixMin = trip('earlier', [walk(6), ic]);
    expect([walksMore(threeMin, direct), walksMore(sixMin, direct), walksMore(earlier, first), walksMore(first, earlier)]).toEqual([false, true, true, false]);
    expect(displayLabel(direct, [direct, threeMin])).toBe('Le plus court');
    expect(displayLabel(direct, [direct, sixMin])).toBe('Moins de marche');
  });

  it('jamais deux « Moins de marche » : avec une proposition lesswalk, la première reste « Le plus court »', () => {
    const lesswalk = trip('lesswalk', [walk(3), bus, walk(2)]);
    expect(displayLabel(first, [first, earlier, lesswalk])).toBe('Le plus court');
    expect(displayLabel(lesswalk, [first, earlier, lesswalk])).toBe('Moins de marche');
  });
});

describe('means : jours fériés belges', () => {
  it('Pâques', () => {
    expect(easterSunday(2024)).toEqual({ mo: 3, d: 31 });
    expect(easterSunday(2025)).toEqual({ mo: 4, d: 20 });
    expect(easterSunday(2026)).toEqual({ mo: 4, d: 5 });
    expect(easterSunday(2027)).toEqual({ mo: 3, d: 28 });
    expect(easterSunday(2028)).toEqual({ mo: 4, d: 16 });
  });

  it('jours fixes et mobiles, à l’heure de Bruxelles', () => {
    expect(holidayName(at('2026-11-11T19:42:00+01:00'))).toBe('Armistice');
    expect(holidayName(at('2026-11-12T07:31:00+01:00'))).toBeNull();
    expect(holidayName(at('2026-04-06T09:00:00+02:00'))).toBe('Lundi de Pâques');
    expect(holidayName(at('2026-05-14T09:00:00+02:00'))).toBe('Ascension');
    expect(holidayName(at('2026-05-25T09:00:00+02:00'))).toBe('Lundi de Pentecôte');
    expect(holidayName(at('2027-03-29T09:00:00+02:00'))).toBe('Lundi de Pâques');
    expect(holidayName(at('2026-07-21T12:00:00+02:00'))).toBe('Fête nationale');
    expect(holidayName(at('2026-12-25T23:30:00+01:00'))).toBe('Noël');
    expect(holidayName(at('2026-12-26T00:30:00+01:00'))).toBeNull();
    // 23:30 UTC le 24/12 = 00:30 le 25 à Bruxelles
    expect(holidayName(at('2026-12-24T23:30:00Z'))).toBe('Noël');
  });

  it('texte affiché', () => {
    expect(HOLIDAY_TEXT.replace(/ /g, ' ')).toBe('Jour férié : horaires du dimanche');
  });
});
