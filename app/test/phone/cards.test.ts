// @vitest-environment happy-dom
/**
 * Quai 1.2.1 (docs/v1.2.1/PRD-1.2.1.md § 7.2) : cartes des trajets du téléphone. Titre = nom affiché (`displayLabel`),
 * ligne « moyens » (`meansText`, puis les marches), phrase alignée sur les raisons du § 2.2 (« Plus tôt de 13 min, mais
 * 19 min à pied. », « Arrive 13 min après le plus rapide, avec moins de marche. »), paliers de marche (§ 1.1). Les
 * trajets sont construits ici (trips.ts) : les phrases ne lisent que les étiquettes, les heures et les marches, jamais
 * la raison écrite par le cœur. Accès d'un lieu (PRD-1.2 § 2.5, repris de la 1.1.1).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AreaSummary, Journey, Mode, NearbyItem, Op, PlanResult } from '../../src/core/api';
import { accessText } from '../../src/phone/screens/places';
import { searchScreen } from '../../src/phone/screens/search';
import { cardPhrase, cardTitle, meansLine, timesText, typo, walkTier } from '../../src/phone/text';
import { at, defaults, harness, mount, NB, textOf, until } from './helpers';
import { onDay, trip } from './trips';

afterEach(() => document.body.replaceChildren());

const nov11 = onDay('2026-11-11');
const nov12 = onDay('2026-11-12');
/** Titre, ligne « moyens » et phrase de chaque carte d'un résultat (marche maximale `max`). */
const texts = (r: PlanResult, max: number) => r.journeys.map((j) => [cardTitle(j, r), meansLine(j), cardPhrase(j, r, max)]);

/*
 * --- Les trois cas réels du § 1.5 (marche maximale 5 min), reconstruits d'après le vrai cœur sur l'instantané réel
 * (/home/claude/real-data-11/data, 11/11/2026) : mêmes étiquettes, véhicules, marches et arrivées. ---
 */

/** Maison → Mama, 11/11 à 19:42 : bus W puis S1 (arrivée 21:11) ; « Plus tôt » : 19 min à pied, IC 20:08, IC 20:33 (20:58). */
function maisonMama(): PlanResult {
  const first = trip('short', nov11(19, 59), [6, [nov11(20, 5), nov11(20, 16), 'bus W'], 1, [nov11(20, 23), nov11(21, 2), 'S1'], 9]);
  const earlier = trip('earlier', nov11(19, 49), [19, [nov11(20, 8), nov11(20, 27), 'IC'], [nov11(20, 33), nov11(20, 49), 'IC'], 9]);
  const none = trip('none', nov11(19, 57), [19, [nov11(20, 16), nov11(21, 2), 'S1'], 9]);
  return { journeys: [first, earlier, none] };
}

/** Maison → Bureau, 12/11 à 07:31 : bus 36, IC 08:01, métro 2 (arrivée 08:33). */
function maisonBureau(): PlanResult {
  const first = trip('short', nov12(7, 43), [5, [nov12(7, 48), nov12(7, 56), 'bus 36'], 3, [nov12(8, 1), nov12(8, 19), 'IC'], 2, [nov12(8, 23), nov12(8, 30), 'métro 2'], 3]);
  const fewer = trip('fewer', nov12(7, 42), [19, [nov12(8, 1), nov12(8, 19), 'IC'], 3, [nov12(8, 23), nov12(8, 31), 'métro 2'], 2]);
  const later = trip('later', nov12(7, 47), [19, [nov12(8, 6), nov12(8, 27), 'S1'], 3, [nov12(8, 33), nov12(8, 48), 'métro 2'], 2]);
  return { journeys: [first, fewer, later] };
}

/** Braine-l'Alleud Côté du Collège → Madou, 11/11 à 13:30 : bus W, métro 2 (13:39 → 14:47) ; « Plus tôt » : 22 min à pied et IC (14:39). */
function braineMadou(): PlanResult {
  const first = trip('short', nov11(13, 39), [8, [nov11(13, 47), nov11(14, 30), 'bus W'], 1, [nov11(14, 33), nov11(14, 45), 'métro 2'], 2]);
  const earlier = trip('earlier', nov11(13, 46), [22, [nov11(14, 8), nov11(14, 27), 'IC'], 3, [nov11(14, 31), nov11(14, 37), 'métro 2'], 2]);
  const next = trip('next', nov11(14, 11), [8, [nov11(14, 19), nov11(15, 2), 'bus W'], 1, [nov11(15, 5), nov11(15, 17), 'métro 2'], 2]);
  return { journeys: [first, earlier, next] };
}

describe('palier de marche (§ 1.1)', () => {
  const walking = (min: number) => trip('short', at(8, 0), [min, [at(8, 30), at(9, 0), 'IC'], 2]);
  it('0 jusqu’à la marche maximale, puis un palier par tranche de 5 min', () => {
    expect([5, 6, 10, 11, 15, 16, 19, 22].map((m) => walkTier(walking(m), 5))).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect([10, 11, 15, 19, 20, 21].map((m) => walkTier(walking(m), 10))).toEqual([0, 1, 1, 2, 2, 3]);
    // marche seule : sa durée ; aucun trajet sans marche n'a de palier
    expect(walkTier(trip('walk', at(8, 0), [25]), 5)).toBe(4);
    expect(walkTier(trip('short', at(8, 0), [[at(8, 0), at(8, 30), 'IC']]), 5)).toBe(0);
  });
});

describe('ligne « moyens » (§ 2.3, § 7.2)', () => {
  it('les véhicules, puis les marches dans l’ordre ; plus de 3 marches : le total ; sans marche : les véhicules', () => {
    expect(meansLine(maisonMama().journeys[0])).toBe('bus W + S1, à pied 6 + 1 + 9 min');
    expect(meansLine(maisonMama().journeys[1])).toBe('IC + IC, à pied 19 + 9 min');
    expect(meansLine(maisonBureau().journeys[0])).toBe('bus 36 + IC + métro 2, 13 min à pied');
    expect(meansLine(trip('short', at(8, 0), [[at(8, 0), at(8, 30), 'IC'], [at(8, 36), at(9, 0), 'IC']]))).toBe('IC + IC');
    expect(typo(meansLine(braineMadou().journeys[0]))).toBe(`bus W + métro 2, à${NB}pied 8 + 1 + 2${NB}min`);
  });

  it('trajet à pied : pas de ligne (la carte dit déjà « 22 min à pied »)', () => {
    expect(meansLine(trip('walk', at(8, 0), [22]))).toBe('');
  });
});

describe('cartes des trois cas réels (§ 1.5, marche maximale 5 min)', () => {
  it('Maison → Mama : « Moins de marche » arrive 13 min après le plus rapide ; « Plus tôt de 13 min, mais 19 min à pied. »', () => {
    const r = maisonMama();
    expect(texts(r, 5)).toEqual([
      ['Moins de marche', 'bus W + S1, à pied 6 + 1 + 9 min', 'Arrive 13 min après le plus rapide, avec moins de marche.'],
      ['Plus tôt', 'IC + IC, à pied 19 + 9 min', 'Plus tôt de 13 min, mais 19 min à pied.'],
      // même arrivée que la proposition 1, en partant plus tôt, mais palier 3 contre 1 : la marche le dit
      ['Sans changement', 'S1, à pied 19 + 9 min', 'Aucun changement, même heure d’arrivée, mais avec 19 min à pied.'],
    ]);
    // heures du « Plus tôt » comme sur les lunettes (§ 3.3 : « 19:47 → 20:58 »)
    expect(timesText(r.journeys[1], nov11(19, 42))).toBe('19:47 → 20:58');
    expect(typo(cardPhrase(r.journeys[1], r, 5))).toBe(`Plus tôt de 13${NB}min, mais 19${NB}min à pied.`);
  });

  it('Maison → Bureau : rien n’arrive avant, « Le plus court » arrive le plus tôt ; « Moins de changements » marche 19 min', () => {
    expect(texts(maisonBureau(), 5)).toEqual([
      ['Le plus court', 'bus 36 + IC + métro 2, 13 min à pied', 'Arrive le plus tôt.'],
      ['Moins de changements', 'IC + métro 2, à pied 19 + 3 + 2 min', 'Moins de changements, même heure d’arrivée, mais avec 19 min à pied.'],
      ['Plus tard', 'S1 + métro 2, à pied 19 + 3 + 2 min', 'Un autre trajet, plus tard.'],
    ]);
  });

  it('Braine-l’Alleud → Madou : « Moins de marche » (bus W, métro 2), « Plus tôt de 8 min, mais 22 min à pied. »', () => {
    expect(texts(braineMadou(), 5)).toEqual([
      ['Moins de marche', 'bus W + métro 2, à pied 8 + 1 + 2 min', 'Arrive 8 min après le plus rapide, avec moins de marche.'],
      ['Plus tôt', 'IC + métro 2, à pied 22 + 3 + 2 min', 'Plus tôt de 8 min, mais 22 min à pied.'],
      ['Le suivant', 'bus W + métro 2, à pied 8 + 1 + 2 min', 'Même trajet, départ suivant.'],
    ]);
  });
});

describe('phrases des autres propositions (§ 7.2, § 2.2)', () => {
  it('« Moins de marche » derrière « Le plus court » (palier plus haut) : arrive plus tard, à la même heure, ou un peu avant', () => {
    const first = trip('short', at(7, 34), [9, [at(7, 43), at(8, 25), 'S1'], 5]);
    const later = (arr: number) => trip('lesswalk', at(7, 32), [2, [at(7, 34), at(8, 20), 'bus W'], 2, [at(8, 22), arr - 3 * 60_000, 'métro 2'], 3]);
    const r = (lw: Journey): PlanResult => ({ journeys: [first, lw] });
    const lw = later(at(8, 46));
    expect(texts(r(lw), 5)).toEqual([
      ['Le plus court', 'S1, à pied 9 + 5 min', 'Arrive le plus tôt.'],
      ['Moins de marche', 'bus W + métro 2, à pied 2 + 2 + 3 min', 'Arrive 16 min plus tard, avec moins de marche.'],
    ]);
    expect(cardPhrase(later(at(8, 30)), r(later(at(8, 30))), 5)).toBe('Même heure d’arrivée, avec moins de marche.');
    expect(cardPhrase(later(at(8, 28)), r(later(at(8, 28))), 5)).toBe('Arrive 2 min plus tôt, avec moins de marche.');
  });

  it('jamais deux « Moins de marche » : avec une alternative d’un palier plus bas, la proposition 1 reste « Le plus court »', () => {
    const first = trip('short', nov11(13, 39), [8, [nov11(13, 47), nov11(14, 35), 'bus W'], 1, [nov11(14, 38), nov11(14, 50), 'métro 2'], 2]);
    const earlier = trip('earlier', nov11(13, 34), [22, [nov11(13, 56), nov11(14, 28), 'IC'], 11]);
    const lw = trip('lesswalk', nov11(13, 52), [4, [nov11(13, 56), nov11(14, 55), 'bus W'], 1, [nov11(14, 58), nov11(15, 10), 'métro 2'], 2]);
    expect(texts({ journeys: [first, earlier, lw] }, 5)).toEqual([
      ['Le plus court', 'bus W + métro 2, à pied 8 + 1 + 2 min', 'Arrive 13 min après le plus rapide, avec moins de marche.'],
      ['Plus tôt', 'IC, à pied 22 + 11 min', 'Plus tôt de 13 min, mais 22 min à pied.'],
      ['Moins de marche', 'bus W + métro 2, à pied 4 + 1 + 2 min', 'Arrive 20 min plus tard, avec moins de marche.'],
    ]);
  });

  it('la nuit : « Plus tôt » qui ne marche pas plus, en partant bien avant ; « Le plus court sans partir plus tôt. »', () => {
    const first = trip('short', at(6, 20), [[at(6, 20), at(6, 46), 'IC']]);
    const earlier = trip('earlier', at(4, 59), [[at(4, 59), at(6, 30), 'IC']]);
    const r: PlanResult = { journeys: [first, earlier] };
    expect(texts(r, 10)).toEqual([
      ['Le plus court', 'IC', 'Le plus court sans partir plus tôt.'],
      ['Plus tôt', 'IC', 'Plus tôt de 16 min, en partant à 04:59.'],
    ]);
    // plus d'une heure : « 1 h 05 »
    const dawn = trip('earlier', at(4, 0), [[at(4, 0), at(5, 41), 'IC']]);
    expect(typo(cardPhrase(dawn, { journeys: [first, dawn] }, 10))).toBe(`Plus tôt de 1${NB}h${NB}05, en partant à 04:00.`);
  });

  it('« Plus tôt » : « marche plus » comme le nom affiché (walksMore : plus longue marche plus longue, et de plus de 5 min)', () => {
    const first = trip('short', at(7, 30), [6, [at(7, 36), at(8, 20), 'S1'], 2]);
    const earlier = trip('earlier', at(7, 25), [7, [at(7, 32), at(8, 10), 'IC'], 2]);
    expect(texts({ journeys: [first, earlier] }, 10)).toEqual([
      ['Moins de marche', 'S1, à pied 6 + 2 min', 'Arrive 10 min après le plus rapide, avec moins de marche.'],
      ['Plus tôt', 'IC, à pied 7 + 2 min', 'Plus tôt de 10 min, mais 7 min à pied.'],
    ]);
    // 4 min à pied contre 2 : pas « plus de marche » ; il part plus tôt
    const near = trip('short', at(7, 30), [2, [at(7, 32), at(8, 20), 'S1'], 2]);
    const early = trip('earlier', at(7, 25), [4, [at(7, 29), at(8, 10), 'IC'], 2]);
    expect(texts({ journeys: [near, early] }, 10)).toEqual([
      ['Le plus court', 'S1, à pied 2 + 2 min', 'Le plus court sans partir plus tôt.'],
      ['Plus tôt', 'IC, à pied 4 + 2 min', 'Plus tôt de 10 min, en partant à 07:23.'],
    ]);
  });

  it('« Sans changement » et « Moins de changements » qui arrivent plus tard (CA-1.4, CA-1.8) ; même heure ; en partant plus tôt', () => {
    const first = trip('short', at(7, 33), [7, [at(7, 40), at(8, 40), 'IC'], 2, [at(8, 42), at(8, 48), 'métro 2'], 3]);
    const none = trip('none', at(7, 33), [7, [at(7, 40), at(8, 46), 'IC'], 10]);
    expect(typo(cardPhrase(none, { journeys: [first, none] }, 10))).toBe(`Aucun changement, mais arrive 5${NB}min plus tard.`);
    const same = trip('none', at(7, 33), [7, [at(7, 40), at(8, 41), 'IC'], 10]);
    expect(cardPhrase(same, { journeys: [first, same] }, 10)).toBe('Aucun changement, même heure d’arrivée.');
    const sooner = trip('fewer', at(7, 23), [7, [at(7, 30), at(8, 41), 'IC'], 10]);
    expect(cardPhrase(sooner, { journeys: [first, sooner] }, 10)).toBe('Moins de changements, en partant 10 min plus tôt.');
    // même heure d'arrivée, d'un palier plus haut (marche maximale 7 : 10 min, palier 1 ; 7 min, palier 0) : la marche
    // passe avant le départ plus tôt
    expect(cardPhrase(sooner, { journeys: [first, sooner] }, 7)).toBe('Moins de changements, même heure d’arrivée, mais avec 10 min à pied.');
    const slow = trip('none', at(7, 33), [7, [at(7, 40), at(9, 46), 'IC'], 10]);
    expect(typo(cardPhrase(slow, { journeys: [first, slow] }, 10))).toBe(`Aucun changement, mais arrive 1${NB}h${NB}05 plus tard.`);
  });

  it('À pied, Le suivant, Plus tard : phrases de la 1.1 ; sans étiquette : ni titre ni phrase', () => {
    const first = trip('short', at(8, 33), [7, [at(8, 40), at(9, 40), 'IC'], 10]);
    const onFoot = trip('walk', at(8, 50), [22]);
    const next = trip('next', at(9, 33), [7, [at(9, 40), at(10, 40), 'IC'], 10]);
    const later = trip('later', at(9, 12), [[at(9, 12), at(10, 20), 'IC']]);
    const r: PlanResult = { journeys: [first, onFoot, next] };
    expect(typo(cardPhrase(onFoot, r, 10))).toBe(`Sans attendre${NB}: 22${NB}min à pied.`);
    expect(cardTitle(onFoot, r)).toBe('À pied');
    expect(cardPhrase(next, r, 10)).toBe('Même trajet, départ suivant.');
    expect(cardPhrase(later, r, 10)).toBe('Un autre trajet, plus tard.');
    const bare = { ...first, label: undefined };
    expect([cardTitle(bare, r), cardPhrase(bare, r, 10)]).toEqual(['', '']);
  });

  it('jamais la raison du cœur : mêmes phrases quelle que soit `reason`', () => {
    const r = maisonMama();
    const odd: PlanResult = { journeys: r.journeys.map((j) => ({ ...j, reason: 'Le plus rapide : 5 min plus tôt, 1 changement' })) };
    expect(texts(odd, 5)).toEqual(texts(r, 5));
  });

  it('aucun tiret long dans les textes des cartes', () => {
    for (const r of [maisonMama(), maisonBureau(), braineMadou()]) for (const t of texts(r, 5).flat()) expect(t).not.toMatch(/[—–]/);
  });
});

describe('cartes de la recherche (§ 7.2)', () => {
  it('Maison → Mama : nom affiché, ligne « moyens » sous les heures, phrase ; bouton « Afficher Moins de marche dans les lunettes »', async () => {
    const r = maisonMama();
    const hz = harness({ now: nov11(19, 42), settings: defaults({ maxWalkMin: 5 }), params: 'de=sncb:8863008&vers=sncb:8813003', core: (c) => ({ ...c, route: async () => r }) });
    const el = mount(searchScreen(hz.ctx));
    await until(() => el.querySelectorAll('.result').length === 3);
    const cards = [...el.querySelectorAll('.result')];
    expect(cards.map((c) => textOf(c.querySelector('.tag')))).toEqual(['Moins de marche', 'Plus tôt', 'Sans changement']);
    expect(cards.map((c) => textOf(c.querySelector('.means')))).toEqual(['bus W + S1, à pied 6 + 1 + 9 min', 'IC + IC, à pied 19 + 9 min', 'S1, à pied 19 + 9 min']);
    expect(cards.map((c) => textOf(c.querySelector('.why')))).toEqual(['Arrive 13 min après le plus rapide, avec moins de marche.', 'Plus tôt de 13 min, mais 19 min à pied.', 'Aucun changement, même heure d’arrivée, mais avec 19 min à pied.']);
    expect(cards[0].querySelector('.btn-glasses')!.getAttribute('aria-label')).toBe('Afficher Moins de marche dans les lunettes');
    expect(cards[0].querySelector('.means')!.textContent).toContain(`9${NB}min`);
    // ordre d'une carte : nom, heures et durée, moyens, départ du premier véhicule, phrase ; plus de pastilles
    expect([...cards[1].querySelector('.card')!.children].map((c) => c.className)).toEqual(['tagrow', 'r1', 'means', 'det', 'why']);
    expect(textOf(cards[1].querySelector('.time'))).toBe('19:47 → 20:58');
    expect(el.querySelector('.chips')).toBeNull();
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
