// @vitest-environment happy-dom
/**
 * Quai 1.2 (docs/v1.2/PRD-1.2.md) : phrases des cartes du téléphone (§ 1.3 : « Le plus court », « Plus tôt »,
 * « Moins de marche », « Sans changement », « Moins de changements »), marche longue (§ 1.2), lecteur d'écran, et
 * accès d'un lieu (§ 2.5, repris de la 1.1.1).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AreaSummary, Journey, JourneyLabel, Leg, Mode, NearbyItem, Op, PlanResult } from '../../src/core/api';
import { accessText } from '../../src/phone/screens/places';
import { searchScreen } from '../../src/phone/screens/search';
import { cardPhrase, hasLongWalk, longestWalk, typo } from '../../src/phone/text';
import { at, defaults, harness, mount, NB, SCENARIO, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/* --- trajets synthétiques : marches et véhicules qui se suivent --- */
const walk = (dep: number, min: number): Leg => ({ kind: 'walk', from: { name: { fr: 'A', nl: 'A' }, lat: 0, lon: 0 }, to: { name: { fr: 'B', nl: 'B' }, lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
const ride = (dep: number, arr: number, line = 'IC', mode: Mode = 'train'): Leg => ({ kind: 'ride', from: { name: { fr: 'Namur', nl: 'Namen' }, lat: 0, lon: 0 }, to: { name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 0, lon: 0 }, dep, arr, schedDep: dep, schedArr: arr, op: mode === 'train' ? 'sncb' : 'stib', mode, line, cat: mode === 'train' ? line : undefined, rt: true });
/** Trajet à partir de ses étapes : [minutes de marche] ou [départ, arrivée] d'un véhicule, à la suite depuis `start`. */
function trip(label: JourneyLabel, start: number, steps: (number | [number, number])[]): Journey {
  const legs: Leg[] = [];
  let t = start;
  let rides = 0;
  for (const s of steps) {
    if (typeof s === 'number') {
      legs.push(walk(t, s));
      t += s * 60_000;
    } else {
      legs.push(ride(s[0], s[1], rides ? String(rides) : 'IC', rides ? 'metro' : 'train'));
      rides++;
      t = s[1];
    }
  }
  const first = legs.find((l) => l.kind === 'ride');
  const w0 = legs[0].kind === 'walk' ? legs[0].walkMin ?? 0 : 0;
  return { id: `${label}-${start}`, legs, dep: legs[0].dep, arr: t, leaveAt: first ? first.dep - (w0 + 2) * 60_000 : legs[0].dep, transfers: Math.max(0, rides - 1), rt: true, alerts: [], label };
}

describe('marche longue (§ 1.2)', () => {
  it('une marche d’au moins la marche maximale plus 5 min, dans un trajet en véhicule', () => {
    const j = trip('short', at(7, 34), [19, [at(7, 53), at(8, 25)], 5]);
    expect(longestWalk(j)).toBe(19);
    expect(hasLongWalk(j, 10)).toBe(true);
    expect(hasLongWalk(j, 14)).toBe(true);
    expect(hasLongWalk(j, 15)).toBe(false);
    // à pied seulement : pas de « marche longue » (c'est « À pied »)
    expect(longestWalk(trip('walk', at(8, 0), [25]))).toBe(0);
  });
});

describe('phrases des cartes (§ 1.3)', () => {
  it('CA-1.5 Waterloo → Rogier : « Moins de marche » et « Le plus court »', () => {
    const short = trip('short', at(7, 34), [19, [at(7, 53), at(8, 25)], 5]);
    const lw = trip('lesswalk', at(7, 32), [2, [at(7, 34), at(8, 20)], 2, [at(8, 22), at(8, 43)], 3]);
    const next = trip('next', at(8, 4), [19, [at(8, 23), at(8, 55)], 5]);
    const r: PlanResult = { journeys: [short, lw, next] };
    expect(typo(cardPhrase(lw, r, 10))).toBe(`17${NB}min de marche en moins, mais arrive 16${NB}min plus tard.`);
    expect(cardPhrase(short, r, 10)).toBe('Arrive le plus tôt.');
    expect(cardPhrase(next, r, 10)).toBe('Même trajet, départ suivant.');
  });

  it('CA-1.7 Waterloo → Madou : « Plus tôt » avec sa marche longue ; « Le plus court sans marche longue. »', () => {
    const short = trip('short', at(7, 34), [3, [at(7, 37), at(7, 55)], 2, [at(7, 57), at(8, 20)], 3, [at(8, 23), at(8, 31)], 2]);
    const earlier = trip('earlier', at(7, 29), [19, [at(7, 50), at(8, 18)], 3, [at(8, 21), at(8, 25)], 2]);
    const r: PlanResult = { journeys: [short, earlier] };
    expect(typo(cardPhrase(earlier, r, 10))).toBe(`Arrive 6${NB}min plus tôt, mais avec 19${NB}min à pied.`);
    expect(cardPhrase(short, r, 10)).toBe('Le plus court sans marche longue.');
    // marche maximale 15 : 19 min n'est plus une marche longue (seuil 20)
    expect(cardPhrase(earlier, r, 15)).toBe('Arrive 6 min plus tôt, en partant à 07:29.');
    expect(cardPhrase(short, r, 15)).toBe('Le plus court sans partir plus tôt.');
  });

  it('la nuit : « Plus tôt » en partant bien avant, « Le plus court sans partir plus tôt. »', () => {
    const short = trip('short', at(6, 20), [[at(6, 20), at(6, 46)]]);
    const earlier = trip('earlier', at(4, 59), [[at(4, 59), at(6, 30)]]);
    const r: PlanResult = { journeys: [short, earlier] };
    expect(cardPhrase(earlier, r, 10)).toBe('Arrive 16 min plus tôt, en partant à 04:59.');
    expect(cardPhrase(short, r, 10)).toBe('Le plus court sans partir plus tôt.');
  });

  it('CA-1.4 et CA-1.8 : « Sans changement » et « Moins de changements » qui arrivent plus tard', () => {
    const short = trip('short', at(7, 33), [7, [at(7, 40), at(8, 40)], 2, [at(8, 42), at(8, 48)], 3]);
    const none = trip('none', at(7, 33), [7, [at(7, 40), at(8, 46)], 10]);
    expect(typo(cardPhrase(none, { journeys: [short, none] }, 10))).toBe(`Aucun changement, mais arrive 5${NB}min plus tard.`);
    const short8 = trip('short', at(7, 34), [8, [at(7, 42), at(8, 30)], 1, [at(8, 31), at(8, 38)], 2, [at(8, 40), at(8, 42)], 2]);
    const fewer = trip('fewer', at(7, 34), [8, [at(7, 42), at(8, 30)], 2, [at(8, 32), at(8, 42)], 10]);
    expect(cardPhrase(fewer, { journeys: [short8, fewer] }, 10)).toBe('Moins de changements, mais arrive 8 min plus tard.');
  });

  it('« Sans changement » : même heure d’arrivée, ou en partant plus tôt ; une heure de plus en heures', () => {
    const short = trip('short', at(7, 40), [5, [at(7, 45), at(8, 30)], 2, [at(8, 32), at(8, 45)], 5]);
    const same = trip('none', at(7, 40), [5, [at(7, 45), at(8, 40)], 10]);
    expect(cardPhrase(same, { journeys: [short, same] }, 10)).toBe('Aucun changement, même heure d’arrivée.');
    const sooner = trip('none', at(7, 30), [5, [at(7, 35), at(8, 40)], 10]);
    expect(cardPhrase(sooner, { journeys: [short, sooner] }, 10)).toBe('Aucun changement, en partant 10 min plus tôt.');
    const fewer = trip('fewer', at(7, 30), [5, [at(7, 35), at(8, 40)], 10]);
    expect(cardPhrase(fewer, { journeys: [short, fewer] }, 10)).toBe('Moins de changements, en partant 10 min plus tôt.');
    const slow = trip('none', at(7, 40), [5, [at(7, 45), at(9, 50)], 5]);
    expect(typo(cardPhrase(slow, { journeys: [short, slow] }, 10))).toBe(`Aucun changement, mais arrive 1${NB}h${NB}05 plus tard.`);
  });

  it('À pied, Le suivant, Plus tard : phrases de la 1.1', () => {
    const short = trip('short', at(8, 33), [7, [at(8, 40), at(9, 40)], 10]);
    const onFoot = trip('walk', at(8, 50), [22]);
    const next = trip('next', at(9, 33), [7, [at(9, 40), at(10, 40)], 10]);
    const later = trip('later', at(9, 12), [[at(9, 12), at(10, 20)]]);
    const r: PlanResult = { journeys: [short, onFoot, next] };
    expect(typo(cardPhrase(onFoot, r, 10))).toBe(`Sans attendre${NB}: 22${NB}min à pied.`);
    expect(cardPhrase(next, r, 10)).toBe('Même trajet, départ suivant.');
    expect(cardPhrase(later, r, 10)).toBe('Un autre trajet, plus tard.');
    // sans étiquette (ancien cœur) : pas de phrase
    expect(cardPhrase({ ...short, label: undefined }, r, 10)).toBe('');
  });
});

describe('cartes de la recherche (T2, § 1.3)', () => {
  it('étiquette, phrase avec la marche maximale réglée, bouton « Afficher Moins de marche dans les lunettes »', async () => {
    const short = trip('short', at(7, 34), [19, [at(7, 53), at(8, 25)], 5]);
    const lw = trip('lesswalk', at(7, 32), [2, [at(7, 34), at(8, 20)], 2, [at(8, 22), at(8, 43)], 3]);
    const hz = harness({ now: SCENARIO.s1.now, here: SCENARIO.s1, settings: defaults({ maxWalkMin: 10 }), params: 'de=sncb:8863008&vers=sncb:8813003', core: (c) => ({ ...c, route: async () => ({ journeys: [short, lw] }) }) });
    const el = mount(searchScreen(hz.ctx));
    await until(() => el.querySelectorAll('.result').length === 2);
    const [first, second] = [...el.querySelectorAll('.result')];
    expect(textOf(first.querySelector('.tag'))).toBe('Le plus court');
    expect(textOf(first.querySelector('.why'))).toBe('Arrive le plus tôt.');
    expect(textOf(second.querySelector('.tag'))).toBe('Moins de marche');
    expect(second.querySelector('.btn-glasses')!.getAttribute('aria-label')).toBe('Afficher Moins de marche dans les lunettes');
    expect(textOf(second.querySelector('.why'))).toBe('17 min de marche en moins, mais arrive 16 min plus tard.');
  });
});

/* --- accès d'un lieu (§ 2.5) --- */
const zone = (id: string, op: Op, fr: string, modes: Mode[], lines: string[]): AreaSummary => ({ id, op, n: { fr, nl: fr }, lat: 0, lon: 0, modes, lines });
const near = (a: AreaSummary, walkMin: number, distanceM = walkMin * 70): NearbyItem => ({ area: a, walkMin, distanceM });

describe('accès d’un lieu (§ 2.5)', () => {
  it('exemples : l’arrêt le plus proche nommé d’abord ; la gare seulement avec des IC et dans la marche maximale', () => {
    expect(accessText([near(zone('sncb:8813045', 'sncb', 'Bruxelles-Congrès', ['train'], ['S2', 'S4']), 11), near(zone('stib:8051', 'stib', 'Madou', ['metro'], ['2', '6']), 2)], 'fr', 10)).toBe('Métro Madou à 2 min à pied');
    expect(accessText([near(zone('tec:N5', 'tec', 'Namur Omalius', ['bus'], ['4']), 5), near(zone('sncb:8863008', 'sncb', 'Namur', ['train'], ['IC', 'L']), 8)], 'fr', 10)).toBe('Bus TEC Namur Omalius à 5 min à pied ; gare de Namur à 8 min');
    // Bruxelles-Chapelle (S1 seulement) n'est pas citée
    expect(accessText([near(zone('stib:1', 'stib', 'Anneessens', ['tram'], ['3', '4']), 3), near(zone('sncb:8813037', 'sncb', 'Bruxelles-Chapelle', ['train'], ['S1']), 4)], 'fr', 10)).toBe('Tram Anneessens à 3 min à pied');
  });

  it('gare au-delà de la marche maximale : pas citée ; la gare la plus proche, citée une seule fois', () => {
    const bus = near(zone('tec:N5', 'tec', 'Namur Omalius', ['bus'], ['4']), 5);
    const namur = near(zone('sncb:8863008', 'sncb', 'Namur', ['train'], ['IC']), 12);
    expect(accessText([bus, namur], 'fr', 10)).toBe('Bus TEC Namur Omalius à 5 min à pied');
    expect(accessText([bus, namur], 'fr', 15)).toBe('Bus TEC Namur Omalius à 5 min à pied ; gare de Namur à 12 min');
    expect(accessText([near(zone('sncb:8863008', 'sncb', 'Namur', ['train'], ['IC']), 4), bus], 'fr', 10)).toBe('Gare de Namur à 4 min à pied');
  });

  it('à égalité de minutes : train, métro, tram, bus, puis la distance ; mots de l’appli et élision', () => {
    const list = [near(zone('delijn:1', 'delijn', 'Korenmarkt', ['tram'], ['1']), 3, 200), near(zone('stib:2', 'stib', 'Rogier', ['metro', 'tram'], ['2', '3']), 3, 220)];
    expect(accessText(list, 'fr')).toBe('Métro Rogier à 3 min à pied');
    expect(accessText([list[0]], 'fr')).toBe('Tram De Lijn Korenmarkt à 3 min à pied');
    expect(accessText([near(zone('tec:C', 'tec', 'Charleroi Waterloo', ['metro'], ['M1']), 2)], 'fr')).toBe('Métro TEC Charleroi Waterloo à 2 min à pied');
    expect(accessText([near(zone('sncb:8811601', 'sncb', 'Ottignies', ['train'], ['IC']), 6), near(zone('tec:O', 'tec', 'Ottignies Gare', ['bus'], ['20']), 6, 300)], 'fr')).toBe('Gare d’Ottignies à 6 min à pied');
    expect(accessText([], 'fr')).toBe('Aucun arrêt à moins de 800 m');
  });
});
