/**
 * Quai 1.2.2, améliorations d'usage côté lunettes (docs/v1.2.2/PRD-1.2.2.md § 8, REVUE-USAGE.md) : n° 5 (plus de
 * « lieux »), n° 8 (un véhicule s'écrit partout de la même façon ; bus de remplacement « Bus SNCB »), n° 10 (« Autour de
 * moi » vide : l'arrêt le plus proche dans 3 km, toucher : ses départs).
 */
import { describe, expect, it } from 'vitest';
import type { Leg } from '../../src/core/api';
import { departureRightText, lineCode, runningNext, vehicleWords } from '../../src/glasses/format';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS } from '../../src/glasses/layout';
import * as views from '../../src/glasses/views';
import { emptyFavoritesLines, firstRunView, nearbyView, stepsPage, trainTitle, type ViewCtx } from '../../src/glasses/views';
import { HINTS } from '../../src/glasses/format';
import { MIN, PLACES, at, journey, lines, nb, settingsWith, setup, stubCore, trainAt } from './helpers';

const NOW = at('2026-11-12', 7, 31);
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([PLACES.bureau]), ...patch });
const N = (fr: string) => ({ fr, nl: fr });

describe('REVUE-USAGE n° 5 : plus de « lieux » dans les textes des lunettes', () => {
  it('bienvenue : « Position, langue et tes favoris, en une minute. » (395 px) ; liste vide : « Ajoute Maison ou Bureau… »', () => {
    expect(lines(firstRunView(ctx())).slice(-2)).toEqual(['Position, langue et tes favoris, en une minute.', 'toucher : continuer   double : quitter']);
    expect(lines(firstRunView(ctx({ web: true }))).at(-2)).toBe('position, langue et tes favoris, en une minute.');
    expect(textWidth('Position, langue et tes favoris, en une minute.')).toBeLessThanOrEqual(WIDTHS.full);
    expect(emptyFavoritesLines()).toEqual(['Aucun favori pour l’instant.', 'Ajoute Maison ou Bureau sur le téléphone.']);
    expect(emptyFavoritesLines(true)[1]).toBe('Ajoute Maison ou Bureau dans l’onglet Réglages.');
  });

  it('aucun texte des lunettes ne dit « tes lieux », « lieu enregistré » ni « mon lieu »', () => {
    const texts = [
      ...lines(firstRunView(ctx())),
      ...lines(firstRunView(ctx({ web: true }))),
      ...emptyFavoritesLines(),
      ...emptyFavoritesLines(true),
      ...views.NEWS_LINES,
      ...Object.values(HINTS),
      ...lines(views.favoritesView({}, ctx({ settings: settingsWith([]) }))),
      ...lines(views.favoritesView({}, ctx({ settings: settingsWith([]), web: true }))),
    ];
    for (const t of texts) expect(t, t).not.toMatch(/tes lieux|lieu enregistré|mon lieu/i);
  });
});

describe('REVUE-USAGE n° 8 : un véhicule s’écrit partout de la même façon', () => {
  const ride = (p: Partial<Leg>): Leg => ({ kind: 'ride', from: { name: N('A'), lat: 0, lon: 0 }, to: { name: N('B'), lat: 0, lon: 0 }, dep: NOW, arr: NOW + 10 * MIN, schedDep: NOW, schedArr: NOW + 10 * MIN, ...p });

  it('dans les étapes et « Dans le train » : « Bus W », « Métro 2 », « Tram 3 », « IC » ; bus de remplacement : « Bus SNCB »', () => {
    expect(vehicleWords(ride({ op: 'tec', mode: 'bus', line: 'W' }))).toBe('Bus W');
    expect(vehicleWords(ride({ op: 'stib', mode: 'metro', line: '2' }))).toBe('Métro 2');
    expect(vehicleWords(ride({ op: 'stib', mode: 'tram', line: '3' }))).toBe('Tram 3');
    expect(vehicleWords(ride({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' }))).toBe('IC');
    expect(vehicleWords(ride({ op: 'sncb', mode: 'bus', line: 'BUS' }))).toBe('Bus SNCB');
    expect(trainTitle(ride({ op: 'stib', mode: 'tram', line: '4', head: N('Stalle (P)') }), 'fr')).toBe('Tram 4 vers Stalle');
    expect(trainTitle(ride({ op: 'sncb', mode: 'bus', line: 'BUS', head: N('Braine-l’Alleud') }), 'fr')).toBe('Bus SNCB vers Braine-l’Alleud');
    // colonnes étroites : le code court (« En cours », départs) ; jamais « BUS » seul dans « En cours »
    expect(lineCode(ride({ op: 'stib', mode: 'tram', line: '3' }))).toBe('T3');
    expect(lineCode(ride({ op: 'sncb', mode: 'bus', line: 'BUS' }))).toBe('Bus SNCB');
  });

  it('étapes : « 07:36   Bus W vers Bruxelles Midi », « Métro 2 vers Simonis (Elisabeth) » tient (279 px dans 342)', () => {
    const j = journey('j', [
      { walk: 4, to: 'Merbraine' },
      { ride: 'W', mode: 'bus', dep: NOW + 5 * MIN, arr: NOW + 50 * MIN, from: 'Merbraine', to: 'Bruxelles Midi', head: 'Bruxelles Midi' },
      { walk: 2, to: 'Gare du Midi' },
      { ride: '2', mode: 'metro', dep: NOW + 55 * MIN, arr: NOW + 62 * MIN, from: 'Gare du Midi', to: 'Madou', head: 'Simonis (Elisabeth)' },
      { walk: 3 },
    ]);
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, ctx());
    const l = lines(v);
    expect(l).toContain('07:36   Bus W vers Bruxelles Midi');
    // 1.2.5 : correspondance de 3 min (le W arrive à 08:21, 2 min à pied) : sa marge dans la colonne d'état
    expect(l).toContain('08:26   Métro 2 vers Simonis (Elisabeth)   marge 3 min');
    expect(textWidth('Métro 2 vers Simonis (Elisabeth)')).toBeLessThanOrEqual(WIDTHS.stepsText);
  });

  it('« En cours » et la ligne d’une gare donnent la même heure pour un même train : « IC 07:42 +2 voie 6 ! »', () => {
    const j = journey('j', [{ walk: 7, to: 'Namur' }, { ride: 'IC', mode: 'train', dep: NOW + 11 * MIN, arr: NOW + 75 * MIN, from: 'Namur', to: 'Bruxelles-Central', platform: '4' }, { walk: 3 }]);
    const r = j.legs[1];
    if (r.kind === 'ride') {
      r.delayMin = 2;
      r.dep += 2 * MIN;
      r.newPlatform = '6';
    }
    const running = runningNext(j, NOW);
    const station = departureRightText(trainAt(NOW, 11, { delayMin: 2, est: NOW + 13 * MIN, platform: '4', newPlatform: '6' }), NOW).text;
    expect(nb(running)).toBe('IC 07:42 +2 voie 6 !');
    expect(running).toBe(station);
    // bus : le code court et l'heure prévue ; dans le véhicule : la descente ; ensuite : l'arrivée
    const w = journey('w', [{ walk: 4 }, { ride: 'W', mode: 'bus', dep: NOW + 5 * MIN, arr: NOW + 50 * MIN, from: 'Merbraine', to: 'Bruxelles Midi' }, { walk: 2 }]);
    expect(runningNext(w, NOW)).toBe('W 07:36');
    expect(runningNext(w, NOW + 10 * MIN)).toBe('descente 08:21');
    expect(runningNext(w, NOW + 51 * MIN)).toBe('arrivée 08:23');
  });
});

describe('REVUE-USAGE n° 10 : « Autour de moi » vide, une issue', () => {
  const area = { id: 'tec:Bbrlcco1', op: 'tec' as const, n: N('Braine-l’Alleud Côté du Collège'), lat: 50.68634, lon: 4.39427, modes: ['bus' as const], lines: ['36'] };

  it('l’arrêt le plus proche dans 3 km, toucher : ses départs ; rien à 3 km : où régler le rayon', () => {
    const v = nearbyView([], ctx(), { area, distanceM: 1180, walkMin: 15 });
    expect(lines(v)).toEqual(['Aucun arrêt à moins de 500 m.', 'Le plus proche : Braine-l’Alleud Côté du Collège, à 1,2 km.', 'toucher : ses départs   double : retour']);
    expect(v.tap).toEqual({ kind: 'open', route: { screen: 'board', areaId: area.id, name: area.n } });
    expect(lines(nearbyView([], ctx(), null))).toEqual(['Aucun arrêt à moins de 500 m.', 'Rayon réglable sur le téléphone : Affichage.', 'double toucher : retour']);
    expect(lines(nearbyView([], ctx({ web: true }), null))[1]).toBe('Rayon réglable dans l’onglet Réglages : Affichage.');
  });

  it('contrôleur : recherche légère jusqu’à 3 km seulement quand la liste est vide ; toucher ouvre les départs nommés', async () => {
    const calls: string[] = [];
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.6' }), core: (now) => stubCore(now, { nearby: 0, calls }) });
    await h.until((x) => x.screen === 'home');
    calls.length = 0;
    await h.c.replaceRoute({ screen: 'nearby' });
    const s = await h.until((x) => x.screen === 'message' && x.title === 'Autour de moi' && x.lines[0]?.startsWith('Aucun arrêt'));
    expect(calls).toEqual(['nearby:500', 'nearby:3000:light']);
    // le faux cœur de test n'a rien non plus à 3 km
    expect(s.lines[1]).toBe('Rayon réglable sur le téléphone : Affichage.');
    h.c.stop();
    const busy: string[] = [];
    const g = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.6' }), core: (now) => stubCore(now, { nearby: 3, calls: busy }) });
    await g.until((x) => x.screen === 'home');
    busy.length = 0;
    await g.c.replaceRoute({ screen: 'nearby' });
    await g.until((x) => x.screen === 'nearby');
    expect(busy).toEqual(['nearby:500']);
    g.c.stop();
  });
});
