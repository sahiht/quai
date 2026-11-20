/**
 * Quai 1.2.10 « Y aller », écrans du guidage (docs/v1.2.10/PRD-1.2.10.md § 3.2 à § 3.4, § 3.9) : écran vide, chaque
 * moment (textes exacts, luminosités, image, aides, toucher, menu), « Où tu en es », menu de Quai Web, et chaque texte
 * mesuré au pixel avec les noms les plus longs des vraies données (rien ne dépasse, aucun mot coupé, jamais l'action).
 * Lieux publics seulement (gares, arrêts).
 */
import { describe, expect, it } from 'vitest';
import type { Journey } from '../../src/core/api';
import type { GuideState, Moment, Then, VehicleRef, WhereAmI } from '../../src/core/guide-types';
import { textWidth } from '../../src/glasses/font';
import { truncateWords, turnDistance, turnText, tripName, untilTitle, towardTitle } from '../../src/glasses/format';
import { GUIDE_MENU, GUIDE_TEXT, chainRow, guideView, menuView, vehicleSign, type GuideShow } from '../../src/glasses/guide-views';
import { GUIDE, layoutPage, shapeKey } from '../../src/glasses/layout';
import { MENU_IDS, type GlassesView, type PageSpec } from '../../src/glasses/types';
import type { ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, at, container, journey, nb, overflowing, page, rowsOf, settingsWith } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 0);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const N = (fr: string) => ({ fr, nl: fr });
const ctx: ViewCtx = { now: NOW, settings: settingsWith([PLACES.bureau]) };

const BUS6: VehicleRef = { op: 'stib', mode: 'bus', line: '6' };
const BUS71: VehicleRef = { op: 'stib', mode: 'bus', line: '71' };
const IC: VehicleRef = { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' };
const TRAM3: VehicleRef = { op: 'stib', mode: 'tram', line: '3' };
const METRO2: VehicleRef = { op: 'stib', mode: 'metro', line: '2' };

/** Marche jusqu'à Monument Gramme, bus 6 jusqu'à Liège-Guillemins, IC voie 3 jusqu'à Bruxelles-Central, marche. */
const J: Journey = journey('j1', [
  { walk: 5, to: 'Monument Gramme' },
  { ride: '6', mode: 'bus', dep: T(7, 12), arr: T(7, 20), from: 'Monument Gramme', to: 'Liège-Guillemins', head: 'Gare des Guillemins' },
  { walk: 3, to: 'Liège-Guillemins' },
  { ride: 'IC', mode: 'train', dep: T(7, 30), arr: T(8, 31), from: 'Liège-Guillemins', to: 'Bruxelles-Central', platform: '3' },
  { walk: 6 },
]);

const WHERE: WhereAmI = {
  title: 'Bureau',
  arr: T(8, 54),
  rt: true,
  chain: [
    { label: 'à pied', state: 'now' },
    { label: 'bus 6', state: 'next' },
    { label: 'IC', state: 'next' },
  ],
  walk: { toward: N('Monument Gramme'), toKind: 'stop', remainingM: 263, remainingMin: 4, vehicle: BUS6, depAt: T(7, 12), marginMin: 2 },
};

function state(moment: Moment | null, p: Partial<GuideState> = {}): GuideState {
  return { kind: 'trip', journeyId: 'j1', phase: { kind: 'walk', leg: 0 }, moment, where: WHERE, location: 'high', wakeAt: NOW + 60_000, ended: false, ...p };
}

const base = { since: NOW, until: NOW + 120_000, leg: 0 };
const leave = (p: Partial<Extract<Moment, { kind: 'leave' }>> = {}): Moment => ({ ...base, id: 'leave:j1', kind: 'leave', walkMin: 5, toward: N('Monument Gramme'), vehicle: BUS6, depAt: T(7, 12), rt: true, marginMin: 3, ...p });
const turn = (p: Partial<Extract<Moment, { kind: 'turn' }>> = {}): Moment => ({ ...base, id: 'turn:j1:0:1', kind: 'turn', turn: 'left', distM: 40, toward: N('Monument Gramme'), final: false, ...p });
const board = (p: Partial<Extract<Moment, { kind: 'board' }>> = {}): Moment => ({
  ...base,
  leg: 1,
  id: 'board:j1:1',
  kind: 'board',
  vehicle: BUS6,
  head: N('Gare des Guillemins'),
  depAt: NOW + 60_000,
  rt: true,
  alight: N('Liège-Guillemins'),
  stopsToAlight: 4,
  ...p,
});

/** Vue et page, après contrôle : rien ne dépasse, jamais de tiret long ni moyen. */
function shown(m: Moment | null, show: GuideShow = 'moment', s: Partial<GuideState> = {}, c: ViewCtx = ctx): { v: GlassesView; p: PageSpec; lines: string[] } {
  const v = guideView(state(m, s), show, J, c);
  const p = page(v);
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[–—]/);
  return { v, p, lines: p.lines.map(nb) };
}

/** Rangées de chaque conteneur (au plus clair, normal, pâle), espaces insécables remises. */
const levels = (p: PageSpec) => ({ hi: rowsOf(container(p, 'colA')), norm: rowsOf(container(p, 'colB')), pale: rowsOf(container(p, 'colC')) });

// 1.3.1 (PRD-1.3.1 § 2) : « masquer » (rien n'est effacé, le guidage continue)
const HINT = 'toucher : masquer   appui long : arrêter';

describe('PRD § 3.2 : écran calme, l’écran vide', () => {
  it('ni titre, ni heure, ni texte, ni aide, ni image ; 1.3.1 (PRD-1.3.1 § 1) : « · · · » seuls, au pied ; toucher = guideTap ; le menu de l’appui long reste', () => {
    for (const [m, show] of [[null, 'moment'], [leave(), 'empty']] as const) {
      const { v, p } = shown(m, show);
      expect(v).toMatchObject({ screen: 'guide', layout: 'guide', title: '', clock: '', items: [], tap: { kind: 'guideTap' } });
      expect(v.images).toBeUndefined();
      expect(p.images).toBeUndefined();
      // 1.3.1 : les trois petits points, rien d'autre (leur place au pixel : v131-guidage-ecrans.test.ts)
      expect(p.lines).toEqual([GUIDE_TEXT.dots]);
      for (const c of p.containers) if (c.name !== 'foot') expect(c.content.trim(), c.name).toBe('');
      expect(container(p, 'foot')).toMatchObject({ h: 27, level: 2 });
      expect(p.menu).toEqual(GUIDE_MENU);
      // journal QUAI_SCREEN : rien de montré, le menu
      expect(v.log).toEqual({ show: 'empty', moment: null, images: [], menu: GUIDE_MENU, journey: 'j1' });
    }
    expect(GUIDE_MENU.map((m) => new TextEncoder().encode(m.label).length).every((n) => n <= 32)).toBe(true);
  });
});

describe('PRD § 3.2 : les moments', () => {
  it('leave : « Partir maintenant », la marche jusqu’à l’arrêt, le bus ; panneau « à pied / 5 / min » à gauche, texte à x = 196', () => {
    const { v, p, lines } = shown(leave());
    expect(nb(p.title)).toBe('Bureau');
    expect(container(p, 'title').level).toBe(2);
    expect(container(p, 'clock').level).toBe(2);
    expect(container(p, 'clock').content.trim()).toBe('07:00');
    // une idée par rangée : « … jusqu’à l’arrêt Monument Gramme » (408 px) ne tient pas dans les 374 px à côté de
    // l'image : sans « l’arrêt »
    expect(lines).toEqual(['Partir maintenant', '5 min à pied jusqu’à Monument Gramme', 'bus 6 à 07:12', HINT]);
    expect(levels(p).hi[0]).toBe('Partir maintenant');
    expect(levels(p).norm.slice(1, 3)).toEqual(['5 min à pied jusqu’à Monument Gramme', 'bus 6 à 07:12']);
    expect(v.images).toEqual([{ id: 9, name: 'guide-image', x: 28, y: 60, w: 144, h: 144, image: { kind: 'sign', label: 'à pied', value: '5', foot: 'min' } }]);
    expect(p.images).toEqual(v.images);
    for (const n of ['colA', 'colB', 'colC'] as const) expect(container(p, n)).toMatchObject({ x: GUIDE.TEXT_X, w: 376 });
    // les rangées centrées sur l'image (60 à 204 : centre 132)
    const a = container(p, 'colA');
    // (± 1 px : un nombre impair de demi-rangées s'arrondit au pixel)
    expect(Math.abs(a.y + a.h / 2 - 132)).toBeLessThanOrEqual(1);
    expect(container(p, 'colA').level).toBe(4);
    expect(container(p, 'colB').level).toBe(3);
    expect(container(p, 'colC').level).toBe(2);
    expect(v.tap).toEqual({ kind: 'guideTap' });
    expect(v.menu).toEqual(GUIDE_MENU);
    // journal QUAI_SCREEN : le moment, son image, le menu
    expect(v.log).toEqual({ show: 'moment', moment: { kind: 'leave', id: 'leave:j1' }, images: [{ x: 28, y: 60, w: 144, h: 144, kind: 'sign' }], menu: GUIDE_MENU, journey: 'j1' });
  });

  it('leave : train « jusqu’à la gare de Namur », sans temps réel « ~07:12 », très juste et « Si tu le rates » (règle 1.2.5)', () => {
    expect(shown(leave({ toward: N('Namur'), vehicle: IC, depAt: T(7, 30) })).lines.slice(0, 3)).toEqual(['Partir maintenant', '5 min à pied jusqu’à la gare de Namur', 'IC à 07:30']);
    expect(shown(leave({ rt: false })).lines[2]).toBe('bus 6 à ~07:12');
    // très juste : quatre rangées au plus, dans la hauteur de l'image ; « Si tu le rates » sans l'écart s'il ne tient pas
    const tight = shown(leave({ marginMin: 1, tight: true, missed: { arr: T(9, 34), laterMin: 30 } }));
    expect(tight.lines).toEqual(['Partir maintenant', '5 min à pied jusqu’à Monument Gramme', 'bus 6 à 07:12, très juste', 'Si tu le rates : arrivée 09:34', HINT]);
    expect(levels(tight.p).pale[3]).toBe('Si tu le rates : arrivée 09:34');
    const a = container(tight.p, 'colA');
    expect(a.h).toBe(4 * 27);
    expect(a.y).toBeGreaterThanOrEqual(GUIDE.IMG_Y);
    expect(a.y + a.h).toBeLessThanOrEqual(GUIDE.IMG_Y + GUIDE.IMG_H);
    // « Si tu le rates » qui tient (même heure d'arrivée) : entier
    expect(shown(leave({ tight: true, missed: { arr: T(8, 54), laterMin: 0 } })).lines[3]).toBe('Si tu le rates : même heure d’arrivée');
    // 1.3.1 (A4, P4) : « très juste » seulement quand le moteur le dit (`tight`), jamais d'après la marge arrondie
    expect(shown(leave({ marginMin: 1 })).lines[2]).toBe('bus 6 à 07:12');
  });

  it('leave : dernière marche, « jusqu’au bureau » (le titre du trajet), sans véhicule', () => {
    const { lines } = shown(leave({ vehicle: undefined, depAt: undefined, walkMin: 12, toward: N('Bureau') }));
    expect(lines).toEqual(['Partir maintenant', '12 min à pied jusqu’au bureau', HINT]);
    expect(untilTitle('Bureau')).toBe('jusqu’au bureau');
    expect(untilTitle('Vers la maison')).toBe('jusqu’à la maison');
    expect(untilTitle('Vers Bruxelles-Central')).toBe('jusqu’à Bruxelles-Central');
    expect(untilTitle('Vers chez Karim')).toBe('jusque chez Karim');
  });

  it('turn : « À gauche dans 40 m » au plus clair (1.3.1, B12), la rue ou « vers l’arrêt Monument Gramme » pâle (1.3.1, § 4) ; flèche à gauche', () => {
    const { v, p, lines } = shown(turn());
    expect(lines).toEqual(['À gauche dans 40 m', 'vers l’arrêt Monument Gramme', HINT]);
    expect(levels(p).hi[0]).toBe('À gauche dans 40 m');
    expect(levels(p).pale[1]).toBe('vers l’arrêt Monument Gramme');
    expect(v.images?.[0]).toMatchObject({ id: 9, x: 28, y: 60, w: 144, h: 144, image: { kind: 'turn', turn: 'left' } });
    expect(shown(turn({ street: 'Rue Neuve' })).lines[1]).toBe('Rue Neuve');
    expect(shown(turn({ turn: 'sharpLeft', distM: 23 })).lines[0]).toBe('Franchement à gauche dans 20 m');
    expect(shown(turn({ turn: 'slightRight', distM: 130 })).lines[0]).toBe('Légèrement à droite dans 150 m');
    expect(shown(turn({ turn: 'right', distM: 8 })).lines[0]).toBe('À droite maintenant');
    expect(shown(turn({ turn: 'uturn', distM: 30 })).lines[0]).toBe('Fais demi-tour');
    // vers la voie d'un train, vers la destination (dernière marche)
    expect(shown(turn({ leg: 2, toward: N('Liège-Guillemins') })).lines[1]).toBe('vers la voie 3');
    expect(shown(turn({ leg: 4, final: true, toward: N('Bureau') })).lines[1]).toBe('vers le bureau');
  });

  it('turn : arrondis du PRD (moins de 100 m par 10 m, au-delà par 50 m, 10 m ou moins : maintenant)', () => {
    expect([5, 10, 11, 37, 44, 96, 100, 120, 124, 126, 260, 480].map(turnDistance)).toEqual([null, null, 20, 40, 40, 100, 100, 100, 100, 150, 250, 500]);
    expect(nb(turnText('left', 40))).toBe('à gauche dans 40 m');
    expect(nb(turnText('slightLeft', 0))).toBe('légèrement à gauche maintenant');
    expect(nb(turnText('straight', 60))).toBe('tout droit dans 60 m');
  });

  it('board : « Bus 6 dans 1 min » (1.3.1, B12), « vers … » pâle, « descente dans 4 arrêts » pâle ; panneau « bus / 6 »', () => {
    const { v, p, lines } = shown(board());
    expect(lines).toEqual(['Bus 6 dans 1 min', 'vers Gare des Guillemins', 'descente dans 4 arrêts', HINT]);
    expect(levels(p).hi[0]).toBe('Bus 6 dans 1 min');
    expect(levels(p).pale.slice(1)).toEqual(['vers Gare des Guillemins', 'descente dans 4 arrêts']);
    expect(v.images?.[0].image).toEqual({ kind: 'sign', label: 'bus', value: '6' });
    // au-delà de 10 min : l'heure ; « imminent » seulement avec le temps réel ; sans lui : « ~ »
    expect(shown(board({ depAt: T(7, 12) })).lines[0]).toBe('Bus 6 à 07:12');
    expect(shown(board({ depAt: NOW + 20_000 })).lines[0]).toBe('Bus 6 imminent');
    expect(shown(board({ depAt: NOW + 20_000, rt: false })).lines[0]).toBe('Bus 6 dans ~1 min');
    expect(shown(board({ depAt: T(7, 12), rt: false })).lines[0]).toBe('Bus 6 à ~07:12');
    expect(shown(board({ stopsToAlight: 1 })).lines[2]).toBe('descente au prochain arrêt');
  });

  it('board : tram, métro, train « IC à 07:30 » panneau « voie / 3 » ; sans voie « train / IC » ; voie modifiée ; correspondance en gare', () => {
    expect(vehicleSign(TRAM3)).toEqual({ kind: 'sign', label: 'tram', value: '3' });
    expect(vehicleSign(METRO2)).toEqual({ kind: 'sign', label: 'métro', value: '2' });
    expect(vehicleSign({ op: 'sncb', mode: 'bus', line: 'BUS' })).toEqual({ kind: 'sign', label: 'bus', value: 'SNCB' });
    const train = shown(board({ vehicle: IC, depAt: T(7, 30), platform: '3', head: N('Ostende'), stopsToAlight: 6 }));
    // contrôle usager du 15/11 : la voie aussi dans le texte (le texte suffit sans l'image, § 3.9)
    expect(train.lines).toEqual(['IC à 07:30, voie 3', 'vers Ostende', 'descente dans 6 arrêts', HINT]);
    expect(train.v.images?.[0].image).toEqual({ kind: 'sign', label: 'voie', value: '3' });
    expect(shown(board({ vehicle: IC, depAt: T(7, 30), head: N('Ostende') })).v.images?.[0].image).toEqual({ kind: 'sign', label: 'train', value: 'IC' });
    const changed = shown(board({ vehicle: IC, depAt: T(7, 30), platform: '6', platformChanged: true, head: N('Ostende') }));
    expect(changed.lines[0]).toBe('IC à 07:30, voie 6 !');
    expect(levels(changed.p).hi[0]).toBe('IC à 07:30, voie 6 !');
    // sans voie connue : « train / IC », rien dans le texte
    expect(shown(board({ vehicle: IC, depAt: T(7, 30), head: N('Ostende') })).lines[0]).toBe('IC à 07:30');
    const corr = shown(board({ vehicle: IC, depAt: T(7, 30), platform: '3', head: N('Ostende'), walkMin: 3, marginMin: 6 }));
    expect(corr.lines.slice(0, 3)).toEqual(['IC à 07:30, voie 3', 'vers Ostende', '3 min à pied jusqu’au quai, marge 6 min']);
    // bus, tram, métro : « jusqu'à l'arrêt » (pas de quai)
    expect(shown(board({ vehicle: TRAM3, depAt: T(8, 44), head: N('Churchill'), walkMin: 2, marginMin: 1 })).lines[2]).toBe('2 min à pied jusqu’à l’arrêt, marge 1 min');
  });

  it('platform : « Voie modifiée » ; « IC à 07:30, voie 6 au lieu de 4 » ; panneau « voie / 6 »', () => {
    const { v, p, lines } = shown({ ...base, id: 'platform:j1:3:6', kind: 'platform', vehicle: IC, depAt: T(7, 30), platform: '6', was: '4' });
    expect(lines).toEqual(['Voie modifiée', 'IC à 07:30, voie 6 au lieu de 4', HINT]);
    expect(levels(p).hi[0]).toBe('Voie modifiée');
    expect(v.images?.[0].image).toEqual({ kind: 'sign', label: 'voie', value: '6' });
  });

  it('nextStop : « Prochain arrêt : Louvain » ; pâle « descente dans 3 arrêts, à Bruxelles-Central » ; sans image, à la marge', () => {
    const { v, p, lines } = shown({ ...base, id: 'next:j1:3:2', kind: 'nextStop', stop: N('Louvain'), at: T(7, 50), rt: true, stopsToAlight: 3, alight: N('Bruxelles-Central') });
    expect(lines).toEqual(['Prochain arrêt : Louvain', 'descente dans 3 arrêts, à Bruxelles-Central', HINT]);
    expect(v.images).toBeUndefined();
    expect(p.images).toBeUndefined();
    expect(container(p, 'colA')).toMatchObject({ x: 28, y: 33 });
    expect(levels(p).pale[1]).toBe('descente dans 3 arrêts, à Bruxelles-Central');
  });

  it('alight : « Descends au prochain arrêt » ; « Gare des Guillemins, 07:20 » ; pâle : ce qui suit', () => {
    const al = (then: Then, rt = true) => shown({ ...base, id: 'alight:j1:1', kind: 'alight', stop: N('Gare des Guillemins'), at: T(7, 20), rt, then });
    const ride = al({ kind: 'ride', vehicle: IC, depAt: T(7, 30), rt: true, platform: '3', walkMin: 3 });
    expect(ride.lines).toEqual(['Descends au prochain arrêt', 'Gare des Guillemins, 07:20', 'ensuite : voie 3, IC à 07:30', HINT]);
    expect(levels(ride.p).hi[0]).toBe('Descends au prochain arrêt');
    expect(levels(ride.p).norm[1]).toBe('Gare des Guillemins, 07:20');
    expect(levels(ride.p).pale[2]).toBe('ensuite : voie 3, IC à 07:30');
    expect(al({ kind: 'ride', vehicle: BUS71, depAt: T(8, 34), rt: true, walkMin: 2 }).lines[2]).toBe('ensuite : bus 71 à 08:34');
    expect(al({ kind: 'walk', min: 5, toward: N('Bureau'), last: true }).lines[2]).toBe('ensuite : 5 min à pied');
    expect(al({ kind: 'none' }, false).lines).toEqual(['Descends au prochain arrêt', 'Gare des Guillemins, ~07:20', HINT]);
  });

  it('replan : parti, supprimé, correspondance ratée ; nouveau trajet et son arrivée ; sans solution', () => {
    const rp = (p: Partial<Extract<Moment, { kind: 'replan' }>>, kind: GuideState['kind'] = 'trip') =>
      shown({ ...base, id: 'replan:j1', kind: 'replan', reason: 'missed', lost: { vehicle: IC, depAt: T(7, 30) }, ...p }, 'moment', { kind });
    const missed = rp({ next: { vehicle: IC, depAt: T(8, 2), platform: '3' }, arr: T(9, 27), laterMin: 33 });
    // 1.3.1 (B12, L4) : « Nouveau trajet : IC à 08:02, voie 3 »
    expect(missed.lines).toEqual(['Ton IC de 07:30 est parti', 'Nouveau trajet : IC à 08:02, voie 3', 'arrivée 09:27, 33 min plus tard', HINT]);
    expect(levels(missed.p).pale[2]).toBe('arrivée 09:27, 33 min plus tard');
    expect(rp({ reason: 'cancelled', none: true }).lines).toEqual(['Ton IC de 07:30 est supprimé', 'Pas d’autre trajet trouvé', HINT]);
    expect(rp({ reason: 'late', lost: { vehicle: BUS71, depAt: T(8, 34) }, next: { vehicle: BUS71, depAt: T(8, 49) }, arr: T(9, 14), laterMin: 15 }).lines.slice(0, 3)).toEqual([
      'Correspondance ratée : bus 71 de 08:34',
      'Nouveau trajet : bus 71 à 08:49',
      'arrivée 09:14, 15 min plus tard',
    ]);
    expect(rp({ next: { vehicle: IC, depAt: T(9, 2) }, arr: T(10, 31), laterMin: 92 }).lines[2]).toBe('arrivée 10:31, 1 h 32 plus tard');
    // contrôle technique du 15/11 : nouveau trajet à pied seul : il est dit, avec son arrivée ; pas encore connu : la perte seule
    const onFoot = rp({ reason: 'late', lost: { vehicle: BUS71, depAt: T(8, 34) }, arr: T(8, 58), laterMin: 6 });
    expect(onFoot.lines).toEqual(['Correspondance ratée : bus 71 de 08:34', 'Nouveau trajet : à pied', 'arrivée 08:58, 6 min plus tard', HINT]);
    expect(levels(onFoot.p).pale[2]).toBe('arrivée 08:58, 6 min plus tard');
    expect(rp({}).lines).toEqual(['Ton IC de 07:30 est parti', HINT]);
    // « J'y descends » : le prochain du même véhicule, s'il est connu (§ 3.6)
    expect(rp({ lost: { vehicle: BUS6, depAt: T(7, 12) }, next: { vehicle: BUS6, depAt: T(7, 24) } }, 'ride').lines).toEqual(['Ton bus 6 de 07:12 est parti', 'Prochain : bus 6 à 07:24', HINT]);
    expect(rp({ lost: { vehicle: BUS6, depAt: T(7, 12) } }, 'ride').lines).toEqual(['Ton bus 6 de 07:12 est parti', HINT]);
  });

  it('passed : « Tu as passé … », « Descends à …, 08:31 », pâle « nouveau trajet : arrivée 09:06 » (genre trip seulement)', () => {
    const m: Moment = { ...base, id: 'passed:j1:3', kind: 'passed', passed: N('Bruxelles-Central'), getOff: N('Bruxelles-Midi'), at: T(8, 31), arr: T(9, 6) };
    expect(shown(m).lines).toEqual(['Tu as passé Bruxelles-Central', 'Descends à Bruxelles-Midi, 08:31', 'nouveau trajet : arrivée 09:06', HINT]);
    expect(shown(m, 'moment', { kind: 'ride' }).lines).toEqual(['Tu as passé Bruxelles-Central', 'Descends à Bruxelles-Midi, 08:31', HINT]);
  });

  it('arrived : « Tu y es » ; pâle « Bureau, 08:54, à l’heure » (retard, avance) ; aides « toucher : terminer »', () => {
    const ar = (diffMin: number, title = 'Bureau') => shown({ ...base, id: 'arrived:j1', kind: 'arrived', title, at: T(8, 54), diffMin });
    const ok = ar(0);
    expect(ok.lines).toEqual(['Tu y es', 'Bureau, 08:54, à l’heure', 'toucher : terminer']);
    expect(levels(ok.p).hi[0]).toBe('Tu y es');
    expect(levels(ok.p).pale[1]).toBe('Bureau, 08:54, à l’heure');
    expect(ok.v.tap).toEqual({ kind: 'guideTap' });
    expect(ar(3).lines[1]).toBe('Bureau, 08:54, 3 min de retard');
    expect(ar(-2).lines[1]).toBe('Bureau, 08:54, 2 min d’avance');
    // un titre « Vers le bureau » se dit par son nom
    expect(ar(0, 'Vers le bureau').lines[1]).toBe('Bureau, 08:54, à l’heure');
    expect(tripName('Vers l’école')).toBe('École');
    expect(tripName('Vers La Louvière')).toBe('La Louvière');
    expect(towardTitle('Gare de Namur')).toBe('vers la gare de Namur');
  });

  it('aides des gestes éteintes (réglage) : aucune ligne d’aide, le reste inchangé', () => {
    const off: ViewCtx = { now: NOW, settings: settingsWith([PLACES.bureau], {}) };
    off.settings.display.gestureHints = false;
    const { v, p, lines } = shown(turn(), 'moment', {}, off);
    expect(v.hints).toBe('');
    expect(lines).toEqual(['À gauche dans 40 m', 'vers l’arrêt Monument Gramme']);
    expect(container(p, 'foot').h).toBe(1);
  });
});

describe('règles d’affichage du moteur (équipe A)', () => {
  it('arrêt où descendre inconnu (`getOff` vide) : pas de « Descends à … »', () => {
    const m: Moment = { ...base, id: 'passed:j1:3', kind: 'passed', passed: N('Bruxelles-Central'), getOff: N(''), at: T(8, 31) };
    expect(shown(m).lines).toEqual(['Tu as passé Bruxelles-Central', HINT]);
  });

  it('nombre d’arrêts inconnu (0) : « descente à … », jamais « descente dans 0 arrêts »', () => {
    expect(shown(board({ stopsToAlight: 0 })).lines).toEqual(['Bus 6 dans 1 min', 'vers Gare des Guillemins', 'descente à Liège-Guillemins', HINT]);
    const n: Moment = { ...base, id: 'next', kind: 'nextStop', stop: N('Louvain'), at: T(7, 50), rt: true, stopsToAlight: 0, alight: N('Bruxelles-Central') };
    expect(shown(n).lines).toEqual(['Prochain arrêt : Louvain', 'descente à Bruxelles-Central', HINT]);
    const ride: NonNullable<WhereAmI['ride']> = { vehicle: BUS6, total: 0, next: 0, nextStop: N('Place Général Leman'), nextAt: T(7, 16), alight: N('Gare des Guillemins'), alightAt: T(7, 20), stopsToAlight: 0, rt: true };
    const w = shown(null, 'where', { phase: { kind: 'ride', leg: 1, next: 0 }, where: { ...WHERE, walk: undefined, ride } }).lines;
    // 1.3.1 (§ 12) : « Ensuite » dit où descendre ; pas de progression
    expect(w).toEqual(['Jusqu’au bureau', 'Ensuite : descente à Gare des Guillemins, 07:20', 'Prochain arrêt : Place Général Leman, 07:16', '◎ à pied ─ ○ bus 6 ─ ○ IC', 'arrivée 08:54', HINT]);
    for (const l of w) expect(l).not.toMatch(/dans 0 arrêt/);
  });

  it('« Où tu en es » à pied : l’heure du véhicule visé suit son temps réel, pas celui du trajet entier', () => {
    // IC en temps réel, tram de la correspondance sans : « IC à 07:44 » (comme « Partir maintenant »), arrivée « ~ »
    const walk = { ...WHERE.walk!, vehicle: IC, depAt: T(7, 44), rt: true };
    const w = shown(null, 'where', { where: { ...WHERE, rt: false, walk } }).lines;
    // 1.3.1 (§ 3, § 12) : « Ensuite : IC à 07:44 », plus de marge sur cet écran
    expect(w[1]).toBe('Ensuite : IC à 07:44');
    expect(w.at(-2)).toBe('arrivée ~08:54');
    // véhicule sans temps réel dans un trajet qui en a : « ~ »
    expect(shown(null, 'where', { where: { ...WHERE, rt: true, walk: { ...walk, rt: false } } }).lines[1]).toBe('Ensuite : IC à ~07:44');
  });

  it('marge négative : « très juste », jamais « marge -2 min » ; la voie ne concerne que les trains', () => {
    expect(shown(board({ vehicle: IC, depAt: T(7, 30), platform: '3', head: N('Ostende'), walkMin: 4, marginMin: -2 })).lines[2]).toBe('4 min à pied jusqu’au quai, très juste');
    // 1.3.1 (§ 3) : plus de marge dans « Où tu en es » ; (A4) au départ, « très juste » seulement si le moteur le dit
    const wm = shown(null, 'where', { where: { ...WHERE, walk: { ...WHERE.walk!, marginMin: -2 } } }).lines;
    expect(wm[1]).toBe('Ensuite : bus 6 à 07:12');
    expect(wm.join('\n')).not.toMatch(/marge|très juste/);
    expect(shown(leave({ marginMin: -3 })).lines[2]).toBe('bus 6 à 07:12');
    expect(shown(leave({ marginMin: -3, tight: true })).lines[2]).toBe('bus 6 à 07:12, très juste');
    // un bus avec une « voie modifiée » (donnée incohérente) : rien sur la voie
    const bus = shown(board({ platform: '6', platformChanged: true }));
    expect(bus.lines[0]).toBe('Bus 6 dans 1 min');
    expect(bus.v.images?.[0].image).toEqual({ kind: 'sign', label: 'bus', value: '6' });
  });
});

describe('PRD § 3.3, 1.3.1 (PRD-1.3.1 § 3, § 12) : « Où tu en es »', () => {
  /** La chaîne du trajet, où qu'elle soit dans l'écran. */
  const chainLine = (ls: string[]): string | undefined => ls.find((l) => /^[●◎○] /.test(l));

  it('à pied : « Guidage en cours », « Jusqu’au bureau », « Ensuite : bus 6 à 07:12 », « À pied vers l’arrêt Monument Gramme », « 260 m, 4 min », la chaîne, l’arrivée', () => {
    const { v, p, lines } = shown(null, 'where');
    expect(nb(p.title)).toBe('Guidage en cours');
    expect(container(p, 'clock').content.trim()).toBe('07:00');
    expect(lines).toEqual(['Jusqu’au bureau', 'Ensuite : bus 6 à 07:12', 'À pied vers l’arrêt Monument Gramme', '260 m, 4 min', '◎ à pied ─ ○ bus 6 ─ ○ IC', 'arrivée 08:54', HINT]);
    expect(v.images).toBeUndefined();
    expect(v.log).toMatchObject({ show: 'where', moment: null, images: [] });
    // sous le titre, à la marge
    expect(container(p, 'colA')).toMatchObject({ x: 28, y: 33 });
    const lv = levels(p);
    // le prochain geste au plus clair ; dans la chaîne, l'étape en cours au plus clair, à venir pâles
    expect(lv.norm[0]).toBe('Jusqu’au bureau');
    expect(lv.hi[1]).toBe('Ensuite : bus 6 à 07:12');
    expect(lv.hi[4].trim()).toBe('◎ à pied');
    expect(lv.pale[4].replace(/\s+/g, ' ').trim()).toBe('─ ○ bus 6 ─ ○ IC');
    expect(lv.pale[5]).toBe('arrivée 08:54');
  });

  it('à pied : vers la voie d’un train, vers la gare, vers la destination ; sans distance ; jamais de marge', () => {
    const w = (walk: Partial<NonNullable<WhereAmI['walk']>>, phase: GuideState['phase'] = { kind: 'walk', leg: 2 }) =>
      shown(null, 'where', { phase, where: { ...WHERE, walk: { ...WHERE.walk!, ...walk } } }).lines;
    // correspondance en gare : la voie une seule fois, « À pied vers la voie 3 »
    expect(w({ toKind: 'platform', toward: N('Liège-Guillemins'), vehicle: IC, depAt: T(7, 30), marginMin: 6 }).slice(1, 4)).toEqual(['Ensuite : IC à 07:30', 'À pied vers la voie 3', '260 m, 4 min']);
    // vers une gare : la voie avec le train
    expect(w({ toKind: 'station', toward: N('Namur'), vehicle: IC }).slice(1, 3)).toEqual(['Ensuite : IC à 07:12, voie 3', 'À pied vers la gare de Namur']);
    // dernière marche : « Ensuite : arrivée … » ; la destination dite une fois (« Jusqu’au bureau »)
    expect(w({ toKind: 'dest', toward: N('Bureau'), vehicle: undefined, depAt: undefined, remainingM: 480, remainingMin: 6 }, { kind: 'walk', leg: 4 })).toEqual(['Jusqu’au bureau', 'Ensuite : arrivée 08:54', 'À pied, 480 m, 6 min', '◎ à pied ─ ○ bus 6 ─ ○ IC', HINT]);
    expect(w({ remainingM: undefined, marginMin: 0 }).slice(1, 4)).toEqual(['Ensuite : bus 6 à 07:12', 'À pied vers l’arrêt Monument Gramme', '4 min']);
  });

  it('à l’arrêt : « Ensuite : bus 6 à 07:01 » (l’heure), « À l’arrêt Monument Gramme », pâle « vers Gare des Guillemins » ; gare : « À la gare de Namur », la voie avec le train', () => {
    const wait = (p: Partial<NonNullable<WhereAmI['wait']>>) =>
      shown(null, 'where', { phase: { kind: 'wait', leg: 1 }, where: { ...WHERE, walk: undefined, wait: { stop: N('Monument Gramme'), vehicle: BUS6, head: N('Gare des Guillemins'), depAt: NOW + 60_000, rt: true, ...p } } });
    const bus = wait({});
    expect(bus.lines).toEqual(['Jusqu’au bureau', 'Ensuite : bus 6 à 07:01', 'À l’arrêt Monument Gramme', 'vers Gare des Guillemins', '◎ à pied ─ ○ bus 6 ─ ○ IC', 'arrivée 08:54', HINT]);
    expect(levels(bus.p).hi[1]).toBe('Ensuite : bus 6 à 07:01');
    expect(levels(bus.p).norm[2]).toBe('À l’arrêt Monument Gramme');
    expect(levels(bus.p).pale[3]).toBe('vers Gare des Guillemins');
    const train = wait({ stop: N('Namur'), vehicle: IC, head: N('Bruxelles-Midi'), depAt: T(7, 30), platform: '3' });
    expect(train.lines.slice(1, 4)).toEqual(['Ensuite : IC à 07:30, voie 3', 'À la gare de Namur', 'vers Bruxelles-Midi']);
    expect(wait({ stop: N('Namur'), vehicle: IC, head: N('Bruxelles-Midi'), depAt: T(7, 30), platform: '6', platformChanged: true }).lines[1]).toBe('Ensuite : IC à 07:30, voie 6 !');
  });

  it('à bord : « Ensuite : descente à …, 07:20 », la progression, « Prochain arrêt : …, 07:16 », la chaîne, l’arrivée (genre trip)', () => {
    const ride: NonNullable<WhereAmI['ride']> = { vehicle: BUS6, head: N('Gare des Guillemins'), total: 6, next: 2, nextStop: N('Place Général Leman'), nextAt: T(7, 16), alight: N('Gare des Guillemins'), alightAt: T(7, 20), stopsToAlight: 3, rt: true };
    const chain: WhereAmI['chain'] = [{ label: 'à pied', state: 'done' }, { label: 'bus 6', state: 'now' }, { label: 'IC', state: 'next' }];
    const on = (kind: GuideState['kind'], title = 'Bureau') => shown(null, 'where', { kind, phase: { kind: 'ride', leg: 1, next: 2 }, where: { ...WHERE, title, chain, walk: undefined, ride } });
    const trip = on('trip');
    expect(trip.lines).toEqual(['Jusqu’au bureau', 'Ensuite : descente à Gare des Guillemins, 07:20', '●─●─◎─○─○─○ descente dans 3 arrêts', 'Prochain arrêt : Place Général Leman, 07:16', '● à pied ─ ◎ bus 6 ─ ○ IC', 'arrivée 08:54', HINT]);
    const lv = levels(trip.p);
    expect(lv.hi[1]).toBe('Ensuite : descente à Gare des Guillemins, 07:20');
    expect(lv.norm[2].trim()).toBe('●─●─◎─○─○─○');
    expect(lv.pale[2].trim()).toBe('descente dans 3 arrêts');
    expect(lv.norm[3]).toBe('Prochain arrêt : Place Général Leman, 07:16');
    expect(lv.norm[4].trim()).toBe('● à pied');
    expect(lv.pale[5]).toBe('arrivée 08:54');
    // genre ride (« j'y descends ») : « Jusqu’à … », la descente sans répéter son nom, « Quai te dit quand descendre » ;
    // ni chaîne ni arrivée (la descente est l'arrivée)
    expect(on('ride', 'Vers Gare des Guillemins').lines).toEqual(['Jusqu’à Gare des Guillemins', 'Ensuite : descente à 07:20', '●─●─◎─○─○─○ descente dans 3 arrêts', 'Prochain arrêt : Place Général Leman, 07:16', 'Quai te dit quand descendre', HINT]);
    // le prochain arrêt est la descente : son nom une seule fois (contrôle usager du 15/11), la progression le dit
    const last = shown(null, 'where', { kind: 'trip', phase: { kind: 'ride', leg: 1, next: 5 }, where: { ...WHERE, chain, walk: undefined, ride: { ...ride, next: 5, nextStop: N('Gare des Guillemins'), nextAt: T(7, 20), stopsToAlight: 1 } } });
    expect(last.lines).toEqual(['Jusqu’au bureau', 'Ensuite : descente à Gare des Guillemins, 07:20', '●─●─●─●─●─◎ descente au prochain arrêt', '● à pied ─ ◎ bus 6 ─ ○ IC', 'arrivée 08:54', HINT]);
  });

  it('chaîne trop longue : « … » au milieu, à la place des étapes les plus loin de celle en cours', () => {
    const chain: WhereAmI['chain'] = [
      { label: 'à pied', state: 'done' },
      { label: 'bus 163b4', state: 'done' },
      { label: 'bus SNCB', state: 'now' },
      { label: 'IC', state: 'next' },
      { label: 'métro 2', state: 'next' },
      { label: 'tram 3', state: 'next' },
      { label: 'bus 163b5', state: 'next' },
      { label: 'bus 162a4', state: 'next' },
    ];
    const row = chainRow(chain, GUIDE.FULL_W);
    const { lines } = shown(null, 'where', { where: { ...WHERE, chain } });
    // la première, celle en cours et la dernière restent ; « … » à la place des autres, de part et d'autre
    expect(chainLine(lines)).toBe('● à pied ─ … ─ ◎ bus SNCB ─ … ─ ○ bus 162a4');
    expect(Math.max(textWidth(row.a), textWidth(row.b ?? ''), textWidth(row.c ?? ''))).toBeLessThanOrEqual(GUIDE.FULL_W);
    // un trajet ordinaire (marche, bus, train, bus) tient en entier
    const four: WhereAmI['chain'] = [{ label: 'à pied', state: 'done' }, { label: 'bus 6', state: 'now' }, { label: 'IC', state: 'next' }, { label: 'bus 71', state: 'next' }];
    expect(chainLine(shown(null, 'where', { where: { ...WHERE, chain: four } }).lines)).toBe('● à pied ─ ◎ bus 6 ─ ○ IC ─ ○ bus 71');
    // cinq étapes, la plus loin de celle en cours tombe la première
    const five: WhereAmI['chain'] = [...four.slice(0, 2), { label: 'bus SNCB', state: 'next' }, { label: 'métro 2', state: 'next' }, { label: 'tram 3', state: 'next' }, { label: 'bus 163b4', state: 'next' }, { label: 'bus 162a4', state: 'next' }];
    const l5 = chainLine(shown(null, 'where', { where: { ...WHERE, chain: five } }).lines);
    expect(l5).toMatch(/^● à pied ─ ◎ bus 6 ─ ○ bus SNCB ─ .*… ─ ○ bus 162a4$/);
  });
});

describe('PRD § 3.4 : menu de l’appui long rendu par Quai (Quai Web)', () => {
  it('un choix par rangée ; toucher = le choisir ; double = retour', () => {
    const v = menuView(GUIDE_MENU, ctx);
    expect(v).toMatchObject({ screen: 'menu', layout: 'menu', title: 'Menu' });
    expect(v.items).toEqual([
      { a: 'Arrêter le guidage', action: { kind: 'menu', id: 1 } },
      { a: 'Voir tout le trajet', action: { kind: 'menu', id: 2 } },
    ]);
    const p = page(v);
    expect(p.lines.map(nb)).toEqual(['Arrêter le guidage', 'Voir tout le trajet', '△▽ choisir   toucher : valider   double : retour']);
    expect(overflowing(p)).toEqual([]);
    expect(rowsOf(container(p, 'cursor'))[0]).toBe('▶');
  });
});

describe('PRD § 3.9 : page, images et reconstruction', () => {
  it('layoutPage copie images et menu ; une autre image reconstruit la page, des chiffres qui bougent non', () => {
    const k40 = shapeKey(page(guideView(state(turn({ distM: 40 })), 'moment', J, ctx)));
    const k30 = shapeKey(page(guideView(state(turn({ distM: 30 })), 'moment', J, ctx)));
    const kRight = shapeKey(page(guideView(state(turn({ turn: 'right' })), 'moment', J, ctx)));
    expect(k30).toBe(k40);
    expect(kRight).not.toBe(k40);
    // le moment « leave » qui compte ses minutes : même forme
    const a = page(guideView(state(board({ depAt: NOW + 3 * MIN })), 'moment', J, ctx));
    const b = page(guideView(state(board({ depAt: NOW + 2 * MIN })), 'moment', J, ctx));
    expect(shapeKey(a)).toBe(shapeKey(b));
    expect(a.lines[0]).not.toBe(b.lines[0]);
    // écran vide, moment, « Où tu en es » : trois formes
    const keys = new Set([shapeKey(shown(null, 'empty').p), shapeKey(shown(turn()).p), shapeKey(shown(null, 'where').p)]);
    expect(keys.size).toBe(3);
    // le menu compte dans la forme
    const v = guideView(state(turn()), 'moment', J, ctx);
    expect(shapeKey(layoutPage({ ...v, menu: undefined }, { sel: 0, top: 0 }))).not.toBe(shapeKey(layoutPage(v, { sel: 0, top: 0 })));
    // les images sont des copies : la vue n'est jamais modifiée par la page
    const p = layoutPage(v, { sel: 0, top: 0 });
    expect(p.images).toEqual(v.images);
    expect(p.images?.[0]).not.toBe(v.images?.[0]);
  });
});

/* ------------------------------ Largeurs au pixel, vraies données ------------------------------ */

/** Les noms les plus longs des vraies données (data/tiles, publication du 12/11), en pixels. */
const LONG = {
  tec: 'Comines/komen Chaussée de Wervicq/Werviksesteenweg', // 494 px
  delijn: 'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost', // 454 px
  stib: 'Begraafplaats van Molenbeek', // 257 px
  sncb: 'Bruxelles-Aéroport-Zaventem', // 261 px
  sncb2: 'Antwerpen-Noorderdokken',
};
const LONG_BUS: VehicleRef = { op: 'tec', mode: 'bus', line: '163b4' };

/**
 * Chaque ligne tient ; une ligne coupée finit par « … » après un mot entier du texte d'origine, ou après un trait
 * d'union, une barre ou une apostrophe d'un nom composé (« Bruxelles-Aéroport-… », règle de truncateWords).
 */
function checkWords(lines: string[], sources: string[]): void {
  const all = sources.map(nb).join(' ');
  for (const l of lines) {
    if (!l.endsWith('…')) continue;
    const head = l.slice(0, -1);
    if (/[-/’']$/.test(head)) {
      expect(all, `« ${l} » coupe un mot`).toContain(head.split(' ').pop()!);
      continue;
    }
    const lastWord = head.split(' ').pop()!;
    // le dernier mot gardé est un mot entier des textes d'origine (suivi d'une espace, d'une virgule ou de la fin)
    expect(all, `« ${l} » coupe un mot`).toMatch(new RegExp(`${lastWord.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s|,|$)`));
  }
}

describe('PRD § 9.4 : chaque texte au pixel, avec les noms les plus longs des vraies données', () => {
  it('moments : rien ne dépasse, aucun mot coupé, l’action entière', () => {
    expect(textWidth(LONG.tec)).toBe(494);
    for (const name of Object.values(LONG)) {
      const moments: Moment[] = [
        leave({ toward: N(name), vehicle: LONG_BUS, marginMin: 0, tight: true, missed: { arr: T(23, 59), laterMin: 452 } }),
        leave({ toward: N(name), vehicle: IC }),
        leave({ vehicle: undefined, toward: N(name) }),
        turn({ street: name }),
        turn({ toward: N(name), leg: 4, final: false }),
        board({ vehicle: LONG_BUS, head: N(name), stopsToAlight: 38 }),
        board({ vehicle: IC, head: N(name), platform: '12a', platformChanged: true, walkMin: 12, marginMin: 1 }),
        { ...base, id: 'p', kind: 'platform', vehicle: IC, depAt: T(7, 30), platform: '12a', was: '11b' },
        { ...base, id: 'n', kind: 'nextStop', stop: N(name), at: T(7, 50), rt: true, stopsToAlight: 12, alight: N(name) },
        { ...base, id: 'a', kind: 'alight', stop: N(name), at: T(7, 20), rt: false, then: { kind: 'ride', vehicle: LONG_BUS, depAt: T(7, 30), rt: false, platform: '12a', walkMin: 3 } },
        { ...base, id: 'r', kind: 'replan', reason: 'late', lost: { vehicle: LONG_BUS, depAt: T(8, 34) }, next: { vehicle: IC, depAt: T(23, 2), platform: '12a' }, arr: T(23, 59), laterMin: 452 },
        { ...base, id: 's', kind: 'passed', passed: N(name), getOff: N(name), at: T(8, 31), arr: T(9, 6) },
        { ...base, id: 'e', kind: 'arrived', title: name, at: T(8, 54), diffMin: -12 },
      ];
      for (const m of moments) {
        const { v, p, lines } = shown(m);
        const action = { leave: GUIDE_TEXT.leave, alight: GUIDE_TEXT.alight, platform: GUIDE_TEXT.platform, arrived: GUIDE_TEXT.arrived } as Record<string, string>;
        if (action[m.kind]) expect(lines[0], m.kind).toBe(action[m.kind]);
        // l'action (1re ligne d'un moment qui dit quoi faire) n'est jamais coupée ; un nom l'est au mot, en dernier recours
        if (!['nextStop', 'passed'].includes(m.kind)) expect(lines[0], `${m.kind} ${name}`).not.toMatch(/…$/);
        checkWords(lines, [name, 'Si tu le rates : arrivée 23:59, 7 h 32 plus tard', 'vers Gare des Guillemins']);
        // une idée par rangée : quatre au plus, dans la hauteur de l'image
        expect(v.items.length, m.kind).toBeLessThanOrEqual(4);
        const c = container(p, 'colA');
        if (v.images?.length) expect(c.y >= GUIDE.IMG_Y && c.y + c.h <= GUIDE.IMG_Y + GUIDE.IMG_H, m.kind).toBe(true);
      }
    }
  });

  it('« Où tu en es » : rien ne dépasse avec les noms les plus longs ; les heures et « Prochain arrêt : » restent entiers', () => {
    for (const name of Object.values(LONG)) {
      const ride: NonNullable<WhereAmI['ride']> = { vehicle: LONG_BUS, head: N(name), total: 40, next: 12, nextStop: N(name), nextAt: T(7, 16), alight: N(name), alightAt: T(7, 20), stopsToAlight: 27, rt: false };
      const r = shown(null, 'where', { phase: { kind: 'ride', leg: 1, next: 12 }, where: { ...WHERE, title: name, walk: undefined, ride, rt: false } }).lines;
      // 1.3.1 (§ 12) : la descente dans « Ensuite », l'arrêt suivant, la progression (jamais effacée)
      expect(r.find((l) => l.startsWith('Ensuite'))).toMatch(/^Ensuite : descente à .*, ~07:20$/);
      expect(r.find((l) => l.startsWith('Prochain arrêt'))).toMatch(/^Prochain arrêt : .*, ~07:16$/);
      expect(r.some((l) => /descente dans 27 arrêts$/.test(l))).toBe(true);
      const wt = shown(null, 'where', { phase: { kind: 'wait', leg: 1 }, where: { ...WHERE, walk: undefined, wait: { stop: N(name), vehicle: LONG_BUS, head: N(name), depAt: T(7, 30), rt: true } } }).lines;
      expect(wt.slice(1, 3)).toEqual(['Ensuite : bus 163b4 à 07:30', expect.stringMatching(/^À l’arrêt /)]);
      const wk = shown(null, 'where', { where: { ...WHERE, title: name, walk: { ...WHERE.walk!, toward: N(name), toKind: 'station', remainingM: 1490 } } }).lines;
      expect(wk).toContain('1,5 km, 4 min');
      checkWords([...r, ...wt, ...wk], [name, `vers ${name}`]);
    }
  });

  it('truncateWords : au dernier mot entier, « … » ; l’espace insécable lie ses deux mots', () => {
    expect(truncateWords('Comines/komen Chaussée de Wervicq/Werviksesteenweg', 300)).toBe('Comines/komen Chaussée de…');
    expect(textWidth(truncateWords(LONG.tec, 300))).toBeLessThanOrEqual(300);
    expect(nb(truncateWords('Prochain arrêt : Gare', 140))).toBe('Prochain arrêt…');
    expect(truncateWords('Prochain arrêt', 100)).toBe('Prochain…');
    expect(truncateWords('Bureau', 300)).toBe('Bureau');
    // faute de place pour un mot entier : après un trait d'union ou une barre du nom composé
    expect(truncateWords('Comines/komen Chaussée', 90)).toBe('Comines/…');
    expect(truncateWords('Bruxelles-Aéroport-Zaventem', 200)).toBe('Bruxelles-Aéroport-…');
  });
});
