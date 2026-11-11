/**
 * Textes du téléphone (PRD § 6.0, § 6.2, § 6.3) : typographie française, phrases des cartes pour chaque étiquette,
 * lignes des cartes, états vides, jamais de tiret long dans les sources du téléphone et de Quai Web.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Journey, JourneyLabel, Leg, PlanResult } from '../../src/core/api';
import { emptyState, labelText, summaryText, T, timesText, typo } from '../../src/phone/text';
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
  const short = journey('short', [walk(at(7, 33), 7), ride(at(7, 42), at(8, 46)), walk(at(8, 46), 10)]);

  it('heures comme le titre des étapes, durée, changements, marche', () => {
    expect(timesText(short, at(7, 31))).toBe('07:33 → 08:56');
    expect(summaryText(short)).toBe(`1${NB}h${NB}23, direct, 17 min à pied`);
    const onFoot = journey('walk', [walk(at(8, 50), 22)]);
    expect(summaryText(onFoot)).toBe(`22${NB}min à pied`);
  });

  it('étiquettes de la 1.2 : « Le plus court » remplace « Le plus simple » et « Le plus rapide » (PRD-1.2 § 1.4)', () => {
    expect(labelText(short)).toBe('Le plus court');
    expect(labelText({ ...short, label: 'earlier' })).toBe('Plus tôt');
    expect(labelText({ ...short, label: 'lesswalk' })).toBe('Moins de marche');
    expect(labelText({ ...short, label: undefined })).toBe('');
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
    // préréglage 1.0 migré (réglages v3) : le lieu « Bureau » a pris l'identifiant de son trajet favori
    const p = preset();
    const bureau = p.favorites.find((f) => f.kind === 'place' && f.label === 'Bureau')!;
    expect(emptyState({ journeys: [], empty: 'here' }, { type: 'place', placeId: bureau.id }, p).text).toBe('Tu es déjà au bureau.');
    expect(emptyState({ journeys: [], empty: 'here' }, to, s).text).toBe('Tu es déjà à Rue du Bois 1.');
    expect(emptyState({ journeys: [], empty: 'noPosition' }, to, s).text).toBe('Position inconnue : autorise la position pour Quai.');
    expect(emptyState({ journeys: [], empty: 'noPosition' }, to, s, { web: true }).text).toBe('Position inconnue : autorise-la dans le navigateur, ou choisis une adresse ou un arrêt (onglet Lunettes, rubrique Position).');
  });
});

describe('sources', () => {
  it('jamais de tiret cadratin ni demi-cadratin dans les textes du téléphone et de Quai Web', () => {
    const APP = fileURLToPath(new URL('../../', import.meta.url));
    const walkDir = (dir: string): string[] => readdirSync(join(APP, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    for (const f of [...walkDir('src/phone'), ...walkDir('src/web'), 'src/version.ts', 'store/changelog/1.1.0.txt', 'store/changelog/1.2.0.txt', 'store/description.txt', 'store/privacy.md']) {
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

describe('notes de version 1.2.0 (PRD-1.2 § 6)', () => {
  it('texte du § 6 en 3 lignes (limite du magasin : les deux dernières phrases sur une ligne), 500 caractères au plus', () => {
    const APP = fileURLToPath(new URL('../../', import.meta.url));
    const notes = readFileSync(join(APP, 'store/changelog/1.2.0.txt'), 'utf8').trim();
    expect([...notes].length).toBeLessThanOrEqual(500);
    expect(notes.split('\n')).toEqual([
      'Le trajet le plus court d’abord : celui qui t’amène le plus tôt, avec la raison. Une longue marche seulement si elle fait gagner au moins 10 min.',
      'Un seul écran « Mes favoris » : tes lieux, tes arrêts et tes trajets, sans rien perdre.',
      'Dans Quai Web, ta position peut être une adresse. L’accès d’un lieu nomme d’abord l’arrêt le plus proche.',
    ]);
    // la 1.1.1, jamais publiée, n'a pas de notes
    expect(readdirSync(join(APP, 'store/changelog'))).not.toContain('1.1.1.txt');
    for (const f of ['app.json', 'package.json']) expect(JSON.parse(readFileSync(join(APP, f), 'utf8')).version, f).toBe('1.2.0');
    const lock = JSON.parse(readFileSync(join(APP, 'package-lock.json'), 'utf8'));
    expect([lock.version, lock.packages[''].version]).toEqual(['1.2.0', '1.2.0']);
  });
});
