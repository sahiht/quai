// @vitest-environment happy-dom
/**
 * Quai 1.1.1 (docs/v1.1/moins-de-marche.md) : phrases des cartes du téléphone (§ 3 : « Moins de marche », « Le plus
 * simple », « Le plus rapide » qui en tient lieu, lecteur d'écran) et accès d'un lieu (§ 6, CA-MW.11).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AreaSummary, Journey, JourneyLabel, Leg, Mode, NearbyItem, Op, PlanResult } from '../../src/core/api';
import { accessText } from '../../src/phone/screens/places';
import { searchScreen } from '../../src/phone/screens/search';
import { cardPhrase, fastWalksLess, typo } from '../../src/phone/text';
import { at, harness, mount, NB, SCENARIO, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/* --- trajets synthétiques comme au PRD § 4.6 (marche maximale 10 min) --- */
const walk = (dep: number, min: number): Leg => ({ kind: 'walk', from: { name: { fr: 'A', nl: 'A' }, lat: 0, lon: 0 }, to: { name: { fr: 'B', nl: 'B' }, lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
const ride = (dep: number, arr: number, line = 'IC', mode: Mode = 'train'): Leg => ({ kind: 'ride', from: { name: { fr: 'Namur', nl: 'Namen' }, lat: 0, lon: 0 }, to: { name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 0, lon: 0 }, dep, arr, schedDep: dep, schedArr: arr, op: mode === 'train' ? 'sncb' : 'stib', mode, line, cat: mode === 'train' ? line : undefined, rt: true });
function journey(label: JourneyLabel, legs: Leg[], transfers: number): Journey {
  const first = legs.find((l) => l.kind === 'ride');
  const w0 = legs[0].kind === 'walk' ? legs[0].walkMin ?? 0 : 0;
  return { id: `${label}-${legs.length}`, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: first ? first.dep - (w0 + 2) * 60_000 : legs[0].dep, transfers, rt: true, alerts: [], label };
}
/** X : direct, marche 7 + 12, IC 07:42, arrivée 08:58 (moins-de-marche.md § 7). */
const X = journey('simple', [walk(at(7, 35), 7), ride(at(7, 42), at(8, 46)), walk(at(8, 46), 12)], 0);
/** Z : même IC puis un bus, marche 7 + 1 + 2, arrivée `arr`. */
const Z = (label: JourneyLabel, arrH: number, arrM: number): Journey =>
  journey(label, [walk(at(7, 35), 7), ride(at(7, 42), at(8, 40)), walk(at(8, 40), 1), ride(at(8, 42), at(arrH, arrM) - 2 * 60_000, '29', 'bus'), walk(at(arrH, arrM) - 2 * 60_000, 2)], 1);
const next = journey('next', [walk(at(8, 35), 7), ride(at(8, 42), at(9, 46)), walk(at(9, 46), 12)], 0);

describe('phrases des cartes (§ 3)', () => {
  it('« Moins de marche » : écart de marche, puis l’arrivée plus tard, à la même heure ou plus tôt', () => {
    const later = Z('lesswalk', 8, 59);
    expect(typo(cardPhrase(later, { journeys: [X, later, next] }))).toBe(`9${NB}min de marche en moins, arrivée 1${NB}min plus tard.`);
    const same = Z('lesswalk', 8, 58);
    expect(cardPhrase(same, { journeys: [X, same] })).toBe('9 min de marche en moins, même heure d’arrivée.');
    const earlier = Z('lesswalk', 8, 55);
    expect(cardPhrase(earlier, { journeys: [X, earlier] })).toBe('9 min de marche en moins, arrivée 3 min plus tôt.');
  });

  it('CA-MW.6 : 2e carte « 5 min de marche en moins, arrivée 4 min plus tôt. », 1re « Le moins de changements. »', () => {
    // simple 07:33 → 08:57, à pied 7 + 11 ; lesswalk 07:33 → 08:53, à pied 7 + 2 + 4
    const simple = journey('simple', [walk(at(7, 35), 7), ride(at(7, 42), at(8, 46)), walk(at(8, 46), 11)], 0);
    const lw = journey('lesswalk', [walk(at(7, 35), 7), ride(at(7, 42), at(8, 40)), walk(at(8, 40), 2), ride(at(8, 44), at(8, 49), '3', 'tram'), walk(at(8, 49), 4)], 1);
    const r: PlanResult = { journeys: [simple, lw, next] };
    expect(cardPhrase(lw, r)).toBe('5 min de marche en moins, arrivée 4 min plus tôt.');
    expect(cardPhrase(simple, r)).toBe('Le moins de changements.');
  });

  it('CA-MW.4 : « Le plus rapide » qui tient lieu de « Moins de marche » ; 1re carte « Le moins de changements. »', () => {
    const fast = Z('fast', 8, 53);
    const r: PlanResult = { journeys: [X, fast, next] };
    expect(fastWalksLess(fast, X)).toBe(true);
    expect(typo(cardPhrase(fast, r))).toBe(`Arrive 5${NB}min plus tôt, avec 1 changement de plus et 9${NB}min de marche en moins.`);
    expect(cardPhrase(X, r)).toBe('Le moins de changements.');
  });

  it('« Le plus rapide » qui ne marche pas 5 min de moins, ou avec deux changements de plus : phrases de la 1.1.0', () => {
    // marche 7 + 2 + 6 : 4 min de moins seulement
    const close = journey('fast', [walk(at(7, 35), 7), ride(at(7, 42), at(8, 40)), walk(at(8, 40), 2), ride(at(8, 43), at(8, 47), '3', 'tram'), walk(at(8, 47), 6)], 1);
    expect(fastWalksLess(close, X)).toBe(false);
    expect(cardPhrase(close, { journeys: [X, close] })).toBe('Arrive 5 min plus tôt, avec 1 changement de plus.');
    expect(cardPhrase(X, { journeys: [X, close] })).toBe('Le moins de changements et de marche.');
    const two = { ...Z('fast', 8, 53), transfers: 2 };
    expect(fastWalksLess(two, X)).toBe(false);
    expect(cardPhrase(two, { journeys: [X, two] })).toBe('Arrive 5 min plus tôt, avec 2 changements de plus.');
    // parti plus de 5 min avant « Le plus simple » : pas le même créneau
    const early = journey('fast', [walk(at(7, 20), 7), ride(at(7, 27), at(8, 40)), walk(at(8, 40), 1), ride(at(8, 42), at(8, 51), '29', 'bus'), walk(at(8, 51), 2)], 1);
    expect(fastWalksLess(early, X)).toBe(false);
  });

  it('« Le plus simple, et aussi le plus rapide. » seulement si aucune autre carte n’arrive plus tôt', () => {
    expect(cardPhrase(X, { journeys: [X, next] })).toBe('Le plus simple, et aussi le plus rapide.');
    // « Moins de marche » qui arrive plus tard : X reste le plus rapide
    const later = Z('lesswalk', 8, 59);
    expect(cardPhrase(X, { journeys: [X, later, next] })).toBe('Le plus simple, et aussi le plus rapide.');
  });
});

describe('lecteur d’écran (§ 3)', () => {
  it('bouton de la carte : « Afficher Moins de marche dans les lunettes »', async () => {
    const lw = Z('lesswalk', 8, 59);
    const hz = harness({ now: SCENARIO.s1.now, here: SCENARIO.s1, params: 'de=sncb:8863008&vers=sncb:8813003', core: (c) => ({ ...c, route: async () => ({ journeys: [X, lw, next] }) }) });
    const el = mount(searchScreen(hz.ctx));
    await until(() => el.querySelectorAll('.result').length === 3);
    const second = el.querySelectorAll('.result')[1];
    expect(textOf(second.querySelector('.tag'))).toBe('Moins de marche');
    expect(second.querySelector('.btn-glasses')!.getAttribute('aria-label')).toBe('Afficher Moins de marche dans les lunettes');
    expect(textOf(second.querySelector('.why'))).toBe('9 min de marche en moins, arrivée 1 min plus tard.');
  });
});

/* --- accès d'un lieu (§ 6) --- */
const zone = (id: string, op: Op, fr: string, modes: Mode[], lines: string[]): AreaSummary => ({ id, op, n: { fr, nl: fr }, lat: 0, lon: 0, modes, lines });
const near = (a: AreaSummary, walkMin: number, distanceM = walkMin * 70): NearbyItem => ({ area: a, walkMin, distanceM });

describe('accès d’un lieu (§ 6, CA-MW.11)', () => {
  it('exemples du § 6 : l’arrêt le plus proche nommé d’abord ; la gare seulement avec des IC et dans la marche maximale', () => {
    // Madou : 1.1.0 disait « Bruxelles-Congrès à 11 min à pied, métro à 2 min »
    expect(accessText([near(zone('sncb:8813045', 'sncb', 'Bruxelles-Congrès', ['train'], ['S2', 'S4']), 11), near(zone('stib:8051', 'stib', 'Madou', ['metro'], ['2', '6']), 2)], 'fr', 10)).toBe('Métro Madou à 2 min à pied');
    // Maison
    expect(accessText([near(zone('tec:N5', 'tec', 'Namur Omalius', ['bus'], ['4']), 5), near(zone('sncb:8863008', 'sncb', 'Namur', ['train'], ['IC', 'L']), 8)], 'fr', 10)).toBe('Bus TEC Namur Omalius à 5 min à pied ; gare de Namur à 8 min');
    // Bureau : Bruxelles-Chapelle (S1 seulement) n'est pas citée
    expect(accessText([near(zone('stib:1', 'stib', 'Anneessens', ['tram'], ['3', '4']), 3), near(zone('sncb:8813037', 'sncb', 'Bruxelles-Chapelle', ['train'], ['S1']), 4)], 'fr', 10)).toBe('Tram Anneessens à 3 min à pied');
  });

  it('gare au-delà de la marche maximale : pas citée ; la gare la plus proche, citée une seule fois', () => {
    const bus = near(zone('tec:N5', 'tec', 'Namur Omalius', ['bus'], ['4']), 5);
    const namur = near(zone('sncb:8863008', 'sncb', 'Namur', ['train'], ['IC']), 12);
    expect(accessText([bus, namur], 'fr', 10)).toBe('Bus TEC Namur Omalius à 5 min à pied');
    expect(accessText([bus, namur], 'fr', 15)).toBe('Bus TEC Namur Omalius à 5 min à pied ; gare de Namur à 12 min');
    // la gare est l'arrêt le plus proche : nommée une fois, avec « Gare de »
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
