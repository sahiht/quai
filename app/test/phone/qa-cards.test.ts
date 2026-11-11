/**
 * Contrôle qualité 1.2 (simulateur et Chrome, réseau de test) : phrase d'une carte « Sans changement » ou « Moins de
 * changements » qui arrive un peu AVANT « Le plus court ». Cas réel du réseau de test : S3 (Bruxelles-Central) à
 * 17:00 vers le boulevard du Centenaire 1, marche maximale 10 : « Le plus court » 17:12 → 17:50 (2 changements),
 * « Moins de changements » 17:12 → 17:47 avec 15 min à pied (marche longue : elle ne peut pas être « Le plus court »
 * et ne gagne que 3 min, donc pas « Plus tôt »). La carte disait « même heure d’arrivée », ce qui est faux.
 */
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg, Mode, PlanResult } from '../../src/core/api';
import { cardPhrase, typo } from '../../src/phone/text';
import { at, NB } from './helpers';

const walk = (dep: number, min: number): Leg => ({ kind: 'walk', from: { name: { fr: 'A', nl: 'A' }, lat: 0, lon: 0 }, to: { name: { fr: 'B', nl: 'B' }, lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
const ride = (dep: number, arr: number, line: string, mode: Mode): Leg => ({ kind: 'ride', from: { name: { fr: 'X', nl: 'X' }, lat: 0, lon: 0 }, to: { name: { fr: 'Y', nl: 'Y' }, lat: 0, lon: 0 }, dep, arr, schedDep: dep, schedArr: arr, op: 'stib', mode, line, rt: false });

/** Trajet : [minutes de marche] ou [départ, arrivée] d'un véhicule, à la suite depuis `start`. */
function trip(label: JourneyLabel, start: number, steps: (number | [number, number])[]): Journey {
  const legs: Leg[] = [];
  let t = start;
  let rides = 0;
  for (const s of steps) {
    if (typeof s === 'number') {
      legs.push(walk(t, s));
      t += s * 60_000;
    } else {
      legs.push(ride(s[0], s[1], String(rides + 1), rides ? 'metro' : 'tram'));
      rides++;
      t = s[1];
    }
  }
  return { id: `${label}-${start}`, legs, dep: legs[0].dep, arr: t, leaveAt: legs[0].dep, transfers: Math.max(0, rides - 1), rt: false, alerts: [], label };
}

describe('carte qui arrive un peu avant « Le plus court » (CA-1.2 : moins de 5 min, ou avec une marche longue)', () => {
  const short = trip('short', at(17, 12), [2, [at(17, 14), at(17, 30)], [at(17, 31), at(17, 40)], [at(17, 41), at(17, 49)], 1]);

  it('« Moins de changements » 3 min plus tôt avec 15 min à pied : ni « même heure d’arrivée », ni « en partant »', () => {
    const fewer = trip('fewer', at(17, 12), [2, [at(17, 14), at(17, 25)], [at(17, 26), at(17, 32)], 15]);
    const r: PlanResult = { journeys: [short, fewer] };
    expect(typo(cardPhrase(fewer, r, 10))).toBe(`Moins de changements, arrive 3${NB}min plus tôt, mais avec 15${NB}min à pied.`);
    // marche maximale 15 : 15 min n'est plus une marche longue (seuil 20)
    expect(cardPhrase(fewer, r, 15)).toBe('Moins de changements, arrive 3 min plus tôt.');
    // la carte « Le plus court » le dit aussi : une autre carte arrive plus tôt, avec une marche longue
    expect(cardPhrase(short, r, 10)).toBe('Le plus court sans marche longue.');
  });

  it('sans marche longue, elle part plus tôt : la carte donne l’heure de départ, comme « Plus tôt »', () => {
    const sooner = trip('fewer', at(17, 2), [2, [at(17, 4), at(17, 30)], [at(17, 31), at(17, 44)], 3]);
    expect(cardPhrase(sooner, { journeys: [short, sooner] }, 10)).toBe('Moins de changements, arrive 3 min plus tôt, en partant à 17:02.');
  });

  it('« Sans changement » : même règle', () => {
    const none = trip('none', at(17, 12), [2, [at(17, 14), at(17, 32)], 15]);
    expect(cardPhrase(none, { journeys: [short, none] }, 10)).toBe('Aucun changement, arrive 3 min plus tôt, mais avec 15 min à pied.');
  });

  it('les cas de la 1.2 ne changent pas (plus tard, même heure, en partant plus tôt)', () => {
    const same = trip('none', at(17, 12), [2, [at(17, 14), at(17, 45)], 5]);
    expect(cardPhrase(same, { journeys: [short, same] }, 10)).toBe('Aucun changement, même heure d’arrivée.');
    const sooner = trip('fewer', at(17, 5), [2, [at(17, 7), at(17, 30)], [at(17, 31), at(17, 45)], 5]);
    expect(cardPhrase(sooner, { journeys: [short, sooner] }, 10)).toBe('Moins de changements, en partant 7 min plus tôt.');
    const late = trip('none', at(17, 12), [2, [at(17, 14), at(17, 50)], 5]);
    expect(cardPhrase(late, { journeys: [short, late] }, 10)).toBe('Aucun changement, mais arrive 5 min plus tard.');
  });
});
