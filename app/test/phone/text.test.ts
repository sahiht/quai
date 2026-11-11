/**
 * Textes du téléphone (PRD § 6.0, § 6.2, § 6.3) : typographie française, phrases des cartes pour chaque étiquette,
 * lignes des cartes, états vides, jamais de tiret long dans les sources du téléphone et de Quai Web.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg, PlanResult } from '../../src/core/api';
import { cardPhrase, emptyState, summaryText, T, timesText, typo } from '../../src/phone/text';
import { at, defaults, preset } from './helpers';

const NB = ' ';
const walk = (dep: number, min: number): Leg => ({ kind: 'walk', from: { name: { fr: 'A', nl: 'A' }, lat: 0, lon: 0 }, to: { name: { fr: 'B', nl: 'B' }, lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
const ride = (dep: number, arr: number, line = 'IC'): Leg => ({ kind: 'ride', from: { name: { fr: 'Namur', nl: 'Namen' }, lat: 0, lon: 0 }, to: { name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 0, lon: 0 }, dep, arr, schedDep: dep, schedArr: arr, op: 'sncb', mode: 'train', line, cat: line, rt: true });
function journey(label: JourneyLabel, legs: Leg[], transfers = 0): Journey {
  const first = legs.find((l) => l.kind === 'ride');
  const w0 = legs[0].kind === 'walk' ? legs[0].walkMin ?? 0 : 0;
  return { id: label, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: first ? first.dep - (w0 + 2) * 60_000 : legs[0].dep, transfers, rt: true, alerts: [], label };
}

describe('typographie (§ 6.0)', () => {
  it('espace insécable devant « : ; ! ? », dans les guillemets, entre un nombre et son unité', () => {
    expect(typo('Supprimer ce favori ?')).toBe(`Supprimer ce favori${NB}?`);
    expect(typo('Adresses : services officiels')).toBe(`Adresses${NB}: services officiels`);
    expect(typo('Supprimer le lieu « Piscine » ? Les trajets')).toBe(`Supprimer le lieu «${NB}Piscine${NB}»${NB}? Les trajets`);
    expect(typo('Le matin (5 h à 11 h)')).toBe(`Le matin (5${NB}h à 11${NB}h)`);
    expect(typo('Namur à 7 min à pied, rayon 300 m')).toBe(`Namur à 7${NB}min à pied, rayon 300${NB}m`);
    // les heures et les adresses restent intactes
    expect(typo('IC 07:42, Rue de Fer 25, 5000 Namur')).toBe('IC 07:42, Rue de Fer 25, 5000 Namur');
  });
});

describe('cartes (T2)', () => {
  const simple = journey('simple', [walk(at(7, 33), 7), ride(at(7, 42), at(8, 46)), walk(at(8, 46), 10)]);

  it('heures comme le titre des étapes, durée, changements, marche', () => {
    expect(timesText(simple, at(7, 31))).toBe('07:33 → 08:56');
    expect(summaryText(simple)).toBe(`1${NB}h${NB}23, direct, 17 min à pied`);
    const onFoot = journey('walk', [walk(at(8, 50), 22)]);
    expect(summaryText(onFoot)).toBe(`22${NB}min à pied`);
  });

  it('phrase de chaque étiquette', () => {
    const fast = journey('fast', [walk(at(7, 33), 7), ride(at(7, 42), at(8, 40)), walk(at(8, 40), 2), ride(at(8, 44), at(8, 49), '3'), walk(at(8, 49), 2)], 1);
    const earlier = journey('earlier', [ride(at(4, 59), at(6, 30))], 1);
    const none = journey('none', [ride(at(9, 0), at(10, 5))]);
    const fewer = journey('fewer', [ride(at(9, 0), at(10, 5))], 1);
    const onFoot = journey('walk', [walk(at(8, 50), 22)]);
    const next = journey('next', [ride(at(8, 42), at(9, 46))]);
    const later = journey('later', [ride(at(9, 12), at(10, 20))], 1);
    const r: PlanResult = { journeys: [simple, fast, next] };
    expect(cardPhrase(simple, r)).toBe('Le moins de changements et de marche.');
    expect(cardPhrase(simple, { journeys: [simple, next] })).toBe('Le plus simple, et aussi le plus rapide.');
    expect(typo(cardPhrase(fast, r))).toBe(`Arrive 5${NB}min plus tôt, avec 1 changement de plus.`);
    const fast2 = { ...fast, transfers: 2 };
    expect(cardPhrase(fast2, { journeys: [simple, fast2] })).toBe('Arrive 5 min plus tôt, avec 2 changements de plus.');
    const fastWalk = { ...fast, transfers: 0 };
    expect(cardPhrase(fastWalk, { journeys: [simple, fastWalk] })).toBe('Arrive 5 min plus tôt, avec plus de marche.');
    const night = journey('simple', [ride(at(6, 20), at(6, 46))]);
    expect(cardPhrase(earlier, { journeys: [night, earlier] })).toBe('Arrive 16 min plus tôt, en partant à 04:59.');
    expect(cardPhrase(night, { journeys: [night, earlier] })).toBe('Le moins de changements et de marche.');
    const quick = journey('simple', [ride(at(8, 30), at(9, 20))], 1);
    expect(cardPhrase(none, { journeys: [quick, none] })).toBe('Aucun changement, mais arrive 45 min plus tard.');
    expect(cardPhrase(fewer, { journeys: [quick, fewer] })).toBe('Moins de changements, mais arrive 45 min plus tard.');
    expect(cardPhrase(onFoot, r)).toBe('Sans attendre : 22 min à pied.');
    expect(cardPhrase(next, r)).toBe('Même trajet, départ suivant.');
    expect(cardPhrase(later, r)).toBe('Un autre trajet, plus tard.');
  });
});

describe('états vides (§ 6.3)', () => {
  const to = { type: 'address' as const, label: 'Rue du Bois 1, 6600 Bastogne', lat: 50.003, lon: 5.715 };
  it('aucun arrêt, pas de trajet complet, déjà sur place, sans position', () => {
    const s = defaults();
    expect(typo(emptyState({ journeys: [], empty: 'noStopTo', accessMin: 20 }, to, s).text)).toBe(`Aucun arrêt à moins de 20${NB}min à pied de cette adresse.`);
    expect(emptyState({ journeys: [], empty: 'noStopTo' }, to, s).text).toBe('Aucun arrêt à moins de 20 min à pied de cette adresse.');
    const st = emptyState({ journeys: [], empty: 'noTrip', station: { areaId: 'sncb:8892007', name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters' }, lat: 51.0359, lon: 3.7107 } }, to, s);
    expect(st).toMatchObject({ kind: 'station', text: 'Pas de trajet complet. Essaie Gand-Saint-Pierre, puis le tram.', button: 'Chercher vers Gand-Saint-Pierre' });
    expect(emptyState({ journeys: [], empty: 'noTrip' }, to, s).text).toBe(T.noTripNow);
    expect(emptyState({ journeys: [], empty: 'here' }, { type: 'place', placeId: 'bureau' }, preset()).text).toBe('Tu es déjà au bureau.');
    expect(emptyState({ journeys: [], empty: 'here' }, to, s).text).toBe('Tu es déjà à Rue du Bois 1.');
    expect(emptyState({ journeys: [], empty: 'noPosition' }, to, s).text).toBe('Position inconnue : autorise la position pour Quai.');
  });
});

describe('sources', () => {
  it('jamais de tiret cadratin ni demi-cadratin dans les textes du téléphone et de Quai Web', () => {
    const APP = fileURLToPath(new URL('../../', import.meta.url));
    const walkDir = (dir: string): string[] => readdirSync(join(APP, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    for (const f of [...walkDir('src/phone'), ...walkDir('src/web'), 'src/version.ts', 'store/changelog/1.1.0.txt', 'store/description.txt', 'store/privacy.md']) {
      expect(readFileSync(join(APP, f), 'utf8'), f).not.toMatch(/[—–]/);
    }
  });

  it('notes de version 1.1.0 : texte du PRD § 10, 3 lignes, 500 caractères au plus (CA-M7.4)', () => {
    const APP = fileURLToPath(new URL('../../', import.meta.url));
    const notes = readFileSync(join(APP, 'store/changelog/1.1.0.txt'), 'utf8').trim();
    const lines = notes.split('\n');
    expect(lines).toHaveLength(3);
    expect([...notes].length).toBeLessThanOrEqual(500);
    expect(lines[0]).toMatch(/^Tes favoris donnent la réponse dès l’ouverture/);
    expect(lines[2]).toBe('Sur le téléphone, un seul champ pour une adresse, une gare ou un arrêt : vas-y, ou enregistre l’adresse comme lieu.');
  });
});
