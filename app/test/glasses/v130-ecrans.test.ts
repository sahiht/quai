/**
 * Quai 1.3.0, écrans des lunettes (docs/v1.3.0/PRD-1.3.0.md, équipe A) : ligne d'action de l'écran du trajet (§ 1) et
 * ce que fait vraiment le toucher (contrôleur), ▲ des autres trajets (§ 2, `edgeUp`), « où descendre » (§ 3), hors de
 * Belgique (§ 4 : moment `offMap`, « Où tu en es »), vérification (§ 6.3 : moment `check`), test de l'écran (§ 6.1),
 * contenu de l'accordéon des favoris (§ 7). Chaque texte mesuré au pixel. Lieux publics seulement (gares, arrêts,
 * places) ; à l'étranger : Lille-Flandres, Maastricht Station.
 */
import { describe, expect, it, vi } from 'vitest';

/** Vues passées à geometry() (écran, ligne d'action à ce moment-là) : la ligne d'action est posée avant la géométrie. */
const geometryCalls = vi.hoisted(() => [] as { screen?: string; action?: string }[]);
vi.mock('../../src/glasses/layout', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/glasses/layout')>();
  return {
    ...m,
    geometry: (v: Parameters<typeof m.geometry>[0], toast?: boolean) => {
      const w = v as { screen?: string; action?: string };
      geometryCalls.push({ screen: w.screen, action: w.action });
      return m.geometry(v, toast);
    },
  };
});

import type { Favorite, FavoriteAnswer, Journey, Leg, RecentAddress } from '../../src/core/api';
import type { CheckIssue, GuideState, Moment, WhereAmI } from '../../src/core/guide-types';
import { textWidth } from '../../src/glasses/font';
import { ACTION, EXPAND_PX, HINTS, changesText, favoriteDetail, troubleText } from '../../src/glasses/format';
import { GUIDE_TEXT, checkLines, guideView, type GuideShow } from '../../src/glasses/guide-views';
import { GUIDE, WIDTHS, type DetailItem } from '../../src/glasses/layout';
import { MENU_IDS, type GlassesView, type OthersRoute, type PageSpec } from '../../src/glasses/types';
import {
  DISPLAY_TEST,
  boardView,
  displayTestView,
  favoritesView,
  homeView,
  lineView,
  othersView,
  stepsAction,
  stepsPage,
  type FavoriteEntry,
  type ViewCtx,
} from '../../src/glasses/views';
import { MIN, PLACES, at, boardOf, container, dep, journey, lineBoardOf, lines, nb, overflowing, page, rowsOf, settingsWith, setup, stubCore, trainAt, type Screen } from './helpers';

const DAY = '2026-11-15';
const NOW = at(DAY, 7, 31);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}, favs: Favorite[] = [PLACES.bureau]): ViewCtx => ({ now: NOW, settings: settingsWith(favs), ...patch });
const off = (patch: Partial<ViewCtx> = {}): ViewCtx => ctx({ settings: settingsWith([PLACES.bureau], { display: { ...settingsWith([]).display, guide: false } }), ...patch });

/** Trajet vers un lieu : 5 min à pied, bus W, 4 min à pied. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5, to: 'Merbraine' }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Merbraine', to: 'Bruxelles Midi', head: 'Bruxelles Midi' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
}
const J1 = door('j1', NOW + 4 * MIN, NOW + 75 * MIN);
const J2 = { ...door('j2', NOW + 19 * MIN, NOW + 90 * MIN), label: 'next' as const, reason: 'Le suivant : même trajet, 15 min plus tard' };
const J3 = { ...door('j3', NOW + 34 * MIN, NOW + 105 * MIN), label: 'later' as const, reason: 'Plus tard : même trajet, 30 min plus tard' };
const ALL = [J1, J2, J3];
const route = { title: 'Vers le bureau', label: '' };
const STEPS_HINT = '△▽ étapes   double : retour';

/* ------------------------------ § 1 : ligne d'action ------------------------------ */

describe('PRD-1.3.0 § 1 : ligne d’action de l’écran du trajet', () => {
  it('les quatre cas du tableau : ce que fait le toucher (intention) et sa ligne, au plus clair ; aides sans « toucher »', () => {
    // trajet pas encore guidé, réglage « Me guider » allumé : « ▶ Y aller »
    const go = stepsPage(route, { journeys: ALL, index: 0, fresh: true }, ctx());
    expect(go).toMatchObject({ action: '▶ Y aller', tap: { kind: 'goGuide' } });
    expect(go.mark).toBeUndefined();
    // ce trajet est guidé (le contrôleur le dit) : « ▶ Retour au guidage »
    const back = stepsPage(route, { journeys: ALL, index: 0, fresh: true }, ctx({ guidedJourneyId: 'j1' }));
    expect(back).toMatchObject({ action: '▶ Retour au guidage', tap: { kind: 'resume' }, mark: 0 });
    // réglage éteint, trajet pas suivi : « ▶ Suivre ce trajet » (goGuide fait alors suivre sans messages)
    const follow = stepsPage(route, { journeys: ALL, index: 0, fresh: true }, off());
    expect(follow).toMatchObject({ action: '▶ Suivre ce trajet', tap: { kind: 'goGuide' } });
    // réglage éteint, trajet suivi : « ▶ Trajet suivi » (toucher : son écran, comme en 1.2.10)
    const followed = stepsPage(route, { journeys: ALL, index: 0, fresh: true }, off({ guidedJourneyId: 'j1' }));
    expect(followed).toMatchObject({ action: '▶ Trajet suivi', tap: { kind: 'open', route: { screen: 'followed' } }, mark: 0 });
    expect(stepsPage(route, { journeys: ALL, index: 0, followedId: 'j1', fresh: true }, off())).toMatchObject({ action: '▶ Trajet suivi' });
    // le « toucher : … » a quitté l'aide : la même dans tous les cas
    for (const v of [go, back, follow, followed]) {
      expect(nb(v.hints)).toBe(STEPS_HINT);
      expect(v.hints).not.toMatch(/toucher/);
      expect(lines(v).at(-1)).toBe(STEPS_HINT);
    }
    expect(Object.values(ACTION)).toEqual(['▶ Y aller', '▶ Retour au guidage', '▶ Suivre ce trajet', '▶ Trajet suivi']);
  });

  it('suivi sans guidage (bouton « Lunettes » du téléphone), réglage allumé : pas d’écran du guidage où revenir, « ▶ Y aller » ; un autre trajet que celui guidé : « ▶ Y aller »', () => {
    const phone = stepsPage(route, { journeys: ALL, index: 0, followedId: 'j1', fresh: true }, ctx());
    expect(phone).toMatchObject({ action: '▶ Y aller', tap: { kind: 'goGuide' }, mark: 0 });
    const other = stepsPage(route, { journeys: ALL, index: 1, followedId: 'j1', fresh: true }, ctx({ guidedJourneyId: 'j1' }));
    expect(other).toMatchObject({ action: '▶ Y aller', tap: { kind: 'goGuide' } });
    expect(other.mark).toBeUndefined();
  });

  it('même règle pour un trajet ouvert depuis « Autres trajets » ; « Fin du trajet. ▽ … » reste', () => {
    const list = stepsPage(route, { journeys: ALL, index: 1, fromList: true, fresh: true }, ctx());
    expect(list).toMatchObject({ action: '▶ Y aller', tap: { kind: 'goGuide' }, note: 'Fin du trajet. ▽ autres trajets' });
    expect(stepsPage(route, { journeys: ALL, index: 1, fromList: true }, ctx({ guidedJourneyId: 'j2' }))).toMatchObject({ action: '▶ Retour au guidage', tap: { kind: 'resume' } });
    expect(stepsPage(route, { journeys: ALL, index: 1, fromList: true }, off())).toMatchObject({ action: '▶ Suivre ce trajet' });
    expect(stepsPage(route, { journeys: ALL, index: 1, fromList: true }, off({ guidedJourneyId: 'j2' }))).toMatchObject({ action: '▶ Trajet suivi' });
    expect(stepsPage(route, { journeys: ALL, index: 0, fresh: true }, ctx()).note).toBe('Fin du trajet. ▽ 2 autres trajets');
  });

  it('la ligne d’action est posée avant la géométrie (la mise en page lui retire une rangée aux étapes)', () => {
    for (const [c, want] of [
      [ctx(), ACTION.go],
      [ctx({ guidedJourneyId: 'j1' }), ACTION.back],
      [off(), ACTION.follow],
      [off({ guidedJourneyId: 'j1' }), ACTION.followed],
    ] as const) {
      geometryCalls.length = 0;
      stepsPage(route, { journeys: ALL, index: 0, fresh: true }, c);
      const steps = geometryCalls.filter((g) => g.screen === 'steps');
      expect(steps.length).toBeGreaterThan(0);
      for (const g of steps) expect(g.action).toBe(want);
    }
  });

  it('toucher sans effet : pas de ligne d’action ; sans aide des gestes : la ligne d’action reste ; tout tient au pixel', () => {
    expect(stepsAction(undefined, false)).toBeUndefined();
    expect(stepsAction({ kind: 'retry' }, false)).toBeUndefined();
    expect(stepsAction({ kind: 'open', route: { screen: 'home' } }, false)).toBeUndefined();
    expect(stepsAction({ kind: 'goGuide' }, true)).toBe(ACTION.follow);
    const quiet = stepsPage(route, { journeys: ALL, index: 0, fresh: true }, ctx({ settings: settingsWith([PLACES.bureau], { display: { ...settingsWith([]).display, gestureHints: false } }) }));
    expect(quiet).toMatchObject({ hints: '', action: ACTION.go });
    for (const a of Object.values(ACTION)) {
      expect(textWidth(a)).toBeLessThanOrEqual(WIDTHS.full);
      expect(a).toMatch(/^▶ [A-Z]/);
      expect(a).not.toMatch(/[–—]/);
    }
    // le message « Calcul du trajet… » n'a pas de ligne d'action
    expect(page(stepsPage(route, { journeys: ALL, index: 2, fresh: true }, ctx()))).toBeTruthy();
  });
});

/* ------------------------------ § 1 : ce que fait vraiment le toucher (contrôleur) ------------------------------ */

function answers(fav: Favorite, now: number): FavoriteAnswer | undefined {
  return fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)] }, updatedAt: now } : undefined;
}
const stepsReady = (s: Screen) => s.screen === 'steps' && s.page !== undefined;
const homeReady = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
async function open(guide = true) {
  const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.1', display: { ...settingsWith([]).display, guide } }), core: (now) => stubCore(now, { answers }) });
  await h.until(homeReady);
  // 1.3.1 (PRD-1.3.1 § 8) : le curseur s'ouvre sur « Autour de moi » ; posé sur le favori (« Favoris », puis Bureau)
  await h.gesture('down', 'down');
  return h;
}

describe('PRD-1.3.0 § 1 : chaque ligne d’action dit vrai (contrôleur, goGuide)', () => {
  it('réglage allumé : « ▶ Y aller » lance le guidage ; « Voir tout le trajet » : « ▶ Retour au guidage » y revient', async () => {
    const h = await open();
    await h.gesture('tap');
    await h.until(stepsReady);
    expect(h.c.buildView()).toMatchObject({ screen: 'steps', action: ACTION.go, tap: { kind: 'goGuide' } });
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'guide')).screen).toBe('guide');
    expect(h.c.followed).toMatchObject({ favoriteId: 'fav-bureau', guide: { kind: 'trip' } });
    h.c.onSignal({ kind: 'menu', id: MENU_IDS.allSteps });
    await h.until((x) => stepsReady(x) && x.followed === true);
    expect(h.c.buildView()).toMatchObject({ action: ACTION.back, tap: { kind: 'resume' } });
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'guide')).screen).toBe('guide');
    h.c.stop();
  });

  it('réglage éteint : « ▶ Suivre ce trajet » le fait suivre (« Trajet suivi », rien ne change d’écran) ; puis « ▶ Trajet suivi » ouvre son écran', async () => {
    const h = await open(false);
    await h.gesture('tap');
    await h.until(stepsReady);
    expect(h.c.followed).toBeNull();
    expect(h.c.buildView()).toMatchObject({ action: ACTION.follow, tap: { kind: 'goGuide' } });
    await h.gesture('tap');
    const after = await h.until((x) => stepsReady(x) && x.followed === true);
    expect(after.lines.at(-1)).toBe('Trajet suivi');
    expect(h.c.followed?.journey.id).toBe('j-bureau');
    expect(h.screens().some((x) => x.screen === 'guide')).toBe(false);
    expect(h.c.buildView()).toMatchObject({ action: ACTION.followed, tap: { kind: 'open', route: { screen: 'followed' } } });
    await h.gesture('tap');
    const f = await h.until((x) => x.screen === 'followed');
    expect(f.lines[0]).toBe('Ne plus suivre');
    h.c.stop();
  });

  it('bouton « Lunettes » du téléphone (suivi sans guidage), réglage allumé : « ▶ Y aller » lance bien le guidage de ce trajet', async () => {
    const h = await open();
    const j = door('j-phone', NOW + 2 * MIN, NOW + 75 * MIN);
    await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, favoriteId: 'fav-bureau', result: { journeys: [j] }, index: 0 });
    await h.until((x) => stepsReady(x) && x.followed === true);
    expect(h.c.followed?.guide).toBeUndefined();
    expect(h.c.buildView()).toMatchObject({ action: ACTION.go, tap: { kind: 'goGuide' } });
    await h.gesture('tap');
    await h.until((x) => x.screen === 'guide');
    expect(h.c.followed).toMatchObject({ journey: { id: 'j-phone' }, guide: { kind: 'trip' } });
    h.c.stop();
  });
});

/* ------------------------------ § 2 et § 3 ------------------------------ */

describe('PRD-1.3.0 § 2 : ▲ sur la première rangée de « Autres trajets »', () => {
  it('la liste met `edgeUp` ; ses aides ne changent pas ; le message « aucun autre trajet » non', () => {
    const r: OthersRoute = { screen: 'others', title: 'Vers le bureau', journeys: ALL, index: 0 };
    const v = othersView(r, ALL, ctx());
    expect(v.edgeUp).toBe(true);
    expect(v.hints).toBe(HINTS.others);
    expect(v.items).toHaveLength(2);
    const none = othersView({ ...r, journeys: [J1] }, [J1], ctx());
    expect(none.layout).toBe('message');
    expect(none.edgeUp).toBeUndefined();
  });
});

describe('PRD-1.3.0 § 3 : « toucher : où descendre » sur les tableaux et une ligne à son arrêt', () => {
  const HINT_PX = WIDTHS.full;
  it('textes exacts, au pixel ; le toucher ne change pas (les arrêts du départ)', () => {
    expect(nb(HINTS.board)).toBe('△▽ départs   toucher : où descendre   double : retour');
    expect(nb(HINTS.line)).toBe('△▽ passages   toucher : où descendre   double : retour');
    expect(HINTS.board).toContain('toucher : où descendre');
    for (const h of [HINTS.board, HINTS.line]) expect(textWidth(h)).toBeLessThanOrEqual(HINT_PX);
    const b = boardView(boardOf('sncb:8814266', 'Braine-l’Alleud', [trainAt(NOW, 5), trainAt(NOW, 20)]), ctx(), { kept: false });
    expect(lines(b).at(-1)).toBe('△▽ départs   toucher : où descendre   double : retour');
    expect(b.items[1].action).toMatchObject({ kind: 'open', route: { screen: 'stops', areaId: 'sncb:8814266' } });
    const bus = boardView(boardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', [dep(NOW, 3), dep(NOW, 9)]), ctx(), { kept: false });
    expect(nb(bus.hints)).toBe('△▽ départs   toucher : où descendre   double : retour');
    const l = lineView({ screen: 'line', areaId: 'tec:Bbrlmer1', op: 'tec', line: 'W', name: N('Braine-l’Alleud Merbraine') }, lineBoardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', 'W', [{ head: 'Bruxelles Midi', departures: [dep(NOW, 3)] }]), ctx());
    expect(lines(l).at(-1)).toBe('△▽ passages   toucher : où descendre   double : retour');
  });
});

/* ------------------------------ § 4 : hors de Belgique ------------------------------ */

const BUS45 = { op: 'delijn' as const, mode: 'bus' as const, line: '45' };
/** Marche jusqu'à l'arrêt Maastricht Station (Pays-Bas), bus 45 jusqu'à Lanaken, marche. */
const ABROAD: Journey = journey('jx', [
  { walk: 6, to: 'Maastricht Station' },
  { ride: '45', mode: 'bus', dep: T(7, 45), arr: T(8, 5), from: 'Maastricht Station', to: 'Lanaken Kerk', head: 'Genk Station' },
  { walk: 4 },
]);
/** Marche jusqu'à la gare de Lille-Flandres, IC jusqu'à Courtrai. */
const LILLE: Journey = journey('jl', [
  { walk: 6, to: 'Lille-Flandres' },
  { ride: 'IC', mode: 'train', dep: T(7, 45), arr: T(8, 15), from: 'Lille-Flandres', to: 'Courtrai', platform: '2' },
  { walk: 3 },
]);
const WHERE: WhereAmI = {
  title: 'Bureau',
  arr: T(8, 9),
  rt: true,
  chain: [
    { label: 'à pied', state: 'now' },
    { label: 'bus 45', state: 'next' },
  ],
  walk: { toward: N('Maastricht Station'), toKind: 'stop', remainingM: 455, remainingMin: 6, vehicle: BUS45, depAt: T(7, 45), marginMin: 8 },
};
function state(moment: Moment | null, p: Partial<GuideState> = {}): GuideState {
  return { kind: 'trip', journeyId: 'jx', phase: { kind: 'walk', leg: 0 }, moment, where: WHERE, location: 'high', wakeAt: NOW + 60_000, ended: false, ...p };
}
const offMap = (p: Partial<Extract<Moment, { kind: 'offMap' }>> = {}): Moment => ({ since: NOW, until: NOW + 30_000, leg: 0, id: 'offMap:jx:0', kind: 'offMap', walkMin: 6, distM: 450, bearingDeg: 30, toward: N('Maastricht Station'), ...p });
function shown(m: Moment | null, show: GuideShow = 'moment', s: Partial<GuideState> = {}, j: Journey = ABROAD, c: ViewCtx = ctx()): { v: GlassesView; p: PageSpec; lines: string[] } {
  const v = guideView(state(m, s), show, j, c);
  const p = page(v);
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[–—]/);
  return { v, p, lines: p.lines.map(nb) };
}
const levels = (p: PageSpec) => ({ hi: rowsOf(container(p, 'colA')), norm: rowsOf(container(p, 'colB')), pale: rowsOf(container(p, 'colC')) });
// 1.3.1 (PRD-1.3.1 § 2) : « masquer »
const GUIDE_HINT = 'toucher : masquer   appui long : arrêter';

describe('PRD-1.3.0 § 4 : hors de Belgique', () => {
  it('moment `offMap`, cap connu : « Hors de Belgique », « pas de chemin à pied : suis la flèche », pâle « 6 min jusqu’à l’arrêt … » ; la flèche', () => {
    const { v, p, lines } = shown(offMap());
    expect(lines).toEqual(['Hors de Belgique', 'pas de chemin à pied : suis la flèche', '6 min jusqu’à l’arrêt Maastricht Station', GUIDE_HINT]);
    expect(levels(p).hi[0]).toBe('Hors de Belgique');
    expect(levels(p).norm[1]).toBe('pas de chemin à pied : suis la flèche');
    expect(levels(p).pale[2]).toBe('6 min jusqu’à l’arrêt Maastricht Station');
    expect(v.images).toHaveLength(1);
    expect(v.images![0].image).toEqual({ kind: 'bearing', deg: 30 });
    expect(container(p, 'colA').x).toBe(GUIDE.TEXT_X);
    expect(v.log).toMatchObject({ show: 'moment', moment: { kind: 'offMap', id: 'offMap:jx:0' } });
    expect(GUIDE_TEXT.offMapArrow).toBe('pas de chemin à pied : suis la flèche');
  });

  it('sans cap : « pas de chemin à pied », le panneau « à pied / 6 / min » ; un train : « jusqu’à la gare de … » ; dernière marche : « jusqu’au bureau »', () => {
    const noCap = shown(offMap({ bearingDeg: undefined }));
    expect(noCap.lines).toEqual(['Hors de Belgique', 'pas de chemin à pied', '6 min jusqu’à l’arrêt Maastricht Station', GUIDE_HINT]);
    expect(noCap.v.images![0].image).toEqual({ kind: 'sign', label: 'à pied', value: '6', foot: 'min' });
    const train = shown(offMap({ toward: N('Lille-Flandres') }), 'moment', { journeyId: 'jl' }, LILLE);
    expect(train.lines[2]).toBe('6 min jusqu’à la gare de Lille-Flandres');
    // la marche finale (après le bus) : le titre du trajet
    const last = shown(offMap({ leg: 2, walkMin: 4, toward: undefined }));
    expect(last.lines[2]).toBe('4 min jusqu’au bureau');
    // le nom de l'arrêt manque : celui de la montée du véhicule qui suit
    expect(shown(offMap({ toward: undefined })).lines[2]).toBe('6 min jusqu’à l’arrêt Maastricht Station');
  });

  it('aucun virage, un nom très long coupé au mot, jamais l’action ; une rangée chacun, à côté de l’image', () => {
    const name = 'Comines/komen Chaussée de Wervicq/Werviksesteenweg';
    const { lines, v } = shown(offMap({ toward: N(name) }));
    expect(lines[0]).toBe('Hors de Belgique');
    expect(lines[2]).toMatch(/^6 min jusqu’à .*…$/);
    expect(lines[2]).not.toMatch(/ …$/);
    for (const it of v.items) expect(Math.max(textWidth(it.a), textWidth(it.b ?? ''), textWidth(it.c ?? ''))).toBeLessThanOrEqual(GUIDE.TEXT_W);
    expect(lines.join(' ')).not.toMatch(/à gauche|à droite|tout droit/);
  });

  it('« Où tu en es » à pied hors de Belgique : « À pied vers l’arrêt … », « 450 m à vol d’oiseau, 6 min », pâle « hors de Belgique, pas de chemin à pied »', () => {
    const w: WhereAmI = { ...WHERE, walk: { ...WHERE.walk!, offMap: true, crowM: 452, remainingM: undefined, bearingDeg: 30 } };
    const { p, lines } = shown(null, 'where', { where: w });
    // 1.3.1 (PRD-1.3.1 § 4, § 12) : le nom de l'arrêt, « Ensuite : bus 45 à 07:45 », plus de marge
    expect(lines).toEqual(['Jusqu’au bureau', 'Ensuite : bus 45 à 07:45', 'À pied vers l’arrêt Maastricht Station', '450 m à vol d’oiseau, 6 min', 'hors de Belgique, pas de chemin à pied', '◎ à pied ─ ○ bus 45', 'arrivée 08:09', GUIDE_HINT]);
    expect(levels(p).pale).toContain('hors de Belgique, pas de chemin à pied');
    // sans la distance à vol d'oiseau : celle du chemin droit, ou les minutes seules
    expect(shown(null, 'where', { where: { ...w, walk: { ...w.walk!, crowM: undefined, remainingM: 455 } } }).lines[3]).toBe('460 m à vol d’oiseau, 6 min');
    expect(shown(null, 'where', { where: { ...w, walk: { ...w.walk!, crowM: undefined } } }).lines[3]).toBe('6 min');
    // en Belgique (pas `offMap`) : comme en 1.2.10
    expect(shown(null, 'where').lines.slice(2, 4)).toEqual(['À pied vers l’arrêt Maastricht Station', '460 m, 6 min']);
  });
});

/* ------------------------------ § 6.3 : vérification ------------------------------ */

const check = (issues: CheckIssue[]): Moment => ({ since: NOW, until: NOW + 20_000, leg: 0, id: 'check:jx:start', kind: 'check', issues });

describe('PRD-1.3.0 § 6.3 : moment `check`', () => {
  it('une ligne par problème au plus clair, son explication pâle ; sans image, toute la largeur ; aides du guidage', () => {
    const bat = shown(check([{ kind: 'battery', level: 12 }]));
    expect(bat.lines).toEqual(['Lunettes : 12 % de batterie', GUIDE_HINT]);
    expect(bat.v.images).toBeUndefined();
    expect(container(bat.p, 'colA').x).toBe(28);
    const pos = shown(check([{ kind: 'noPosition' }]));
    expect(pos.lines).toEqual(['Pas de position : Quai suit l’horaire', 'Position « Toujours » pour l’appli Even, sur le téléphone', GUIDE_HINT]);
    expect(levels(pos.p).hi[0]).toBe('Pas de position : Quai suit l’horaire');
    expect(levels(pos.p).pale[1]).toBe('Position « Toujours » pour l’appli Even, sur le téléphone');
    const lost = shown(check([{ kind: 'positionLost', minutes: 3 }]));
    expect(lost.lines).toEqual(['Position perdue depuis 3 min', 'Quai suit l’horaire en attendant', GUIDE_HINT]);
    expect(levels(lost.p).pale[1]).toBe('Quai suit l’horaire en attendant');
    const both = shown(check([{ kind: 'battery', level: 12 }, { kind: 'noPosition' }]));
    expect(both.lines).toEqual(['Lunettes : 12 % de batterie', 'Pas de position : Quai suit l’horaire', 'Position « Toujours » pour l’appli Even, sur le téléphone', GUIDE_HINT]);
    expect(both.v.log).toMatchObject({ moment: { kind: 'check', id: 'check:jx:start' } });
  });

  it('deux problèmes au plus (quatre rangées) ; checkLines garde sa forme (carte « En cours » du téléphone) ; au pixel', () => {
    const three: CheckIssue[] = [{ kind: 'battery', level: 9.6 }, { kind: 'positionLost', minutes: 3.2 }, { kind: 'noPosition' }];
    const v = shown(check(three));
    expect(v.lines).toEqual(['Lunettes : 10 % de batterie', 'Position perdue depuis 3 min', 'Quai suit l’horaire en attendant', GUIDE_HINT]);
    expect(v.v.items.length).toBeLessThanOrEqual(GUIDE.MAX_LINES);
    expect(checkLines(three).map(nb)).toEqual(['Lunettes : 10 % de batterie', 'Position perdue depuis 3 min']);
    expect(checkLines([{ kind: 'battery', level: 140 }]).map(nb)).toEqual(['Lunettes : 100 % de batterie']);
    expect(checkLines([{ kind: 'positionLost', minutes: 0 }]).map(nb)).toEqual(['Position perdue depuis 1 min']);
    expect(checkLines([])).toEqual([]);
    for (const l of [...checkLines([{ kind: 'battery', level: 100 }, { kind: 'noPosition' }]), GUIDE_TEXT.checkNoPosition, GUIDE_TEXT.checkLost]) {
      expect(textWidth(l)).toBeLessThanOrEqual(GUIDE.FULL_W);
      expect(l).not.toMatch(/ [:;!?]|[–—]/);
    }
    // aucun problème donné : le titre du moment seul
    expect(shown(check([])).lines).toEqual(['À vérifier', GUIDE_HINT]);
  });
});

/* ------------------------------ § 6.1 : test de l'écran ------------------------------ */

describe('PRD-1.3.0 § 6.1 : écran `displayTest`', () => {
  // contrôle technique : à la fin du test, les lunettes reviennent à l'écran d'avant (le résultat est dit sur le
  // téléphone) : l'écran n'a plus d'étape de fin, jamais affichée
  it('une ligne courte par étape ; aucune aide pendant le test', () => {
    const c = ctx();
    const at = (step: 'wait' | 'sent' | 'ask') => displayTestView(c, step);
    expect(lines(at('wait'))).toEqual(['Ne touche à rien.']);
    expect(lines(at('sent'))).toEqual(['Touche une fois les lunettes.']);
    expect(lines(at('ask'))).toEqual(['Réponds sur le téléphone.']);
    for (const step of ['wait', 'sent', 'ask'] as const) {
      const v = at(step);
      expect(v).toMatchObject({ screen: 'displayTest', layout: 'message', title: 'Test de l’écran', hints: '' });
      expect(v.tap).toBeUndefined();
      expect(v.log).toEqual({ step });
      expect(page(v).title).toBe('Test de l’écran');
    }
    expect(Object.keys(DISPLAY_TEST)).toEqual(['title', 'wait', 'sent', 'ask']);
    // chaque texte sur une seule rangée, sans tiret long ni moyen, tutoiement
    for (const t of Object.values(DISPLAY_TEST)) {
      expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.full);
      expect(t).not.toMatch(/[–—]|vous\b/i);
    }
  });
});

/* ------------------------------ § 7 : accordéon des favoris ------------------------------ */

const ok = (fav: Favorite, j: Journey, p: Partial<FavoriteAnswer> = {}): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: NOW, ...p });
const S = settingsWith([PLACES.bureau]);
const texts = (a: FavoriteAnswer | undefined, now = NOW) => favoriteDetail(a, now, S).map((l) => nb(l.text));
/** Marche puis véhicules : chaque étape donnée, les marches de 3 min entre deux véhicules. */
function chain(rides: { ride: string; mode: 'bus' | 'tram' | 'metro' | 'train'; platform?: string }[], walk = 7): Journey {
  const steps: Parameters<typeof journey>[1] = [{ walk, to: 'Braine-l’Alleud' }];
  let t = NOW + 11 * MIN;
  rides.forEach((r, i) => {
    if (i > 0) steps.push({ walk: 3, to: `Arrêt ${i}` });
    steps.push({ ride: r.ride, mode: r.mode, dep: t, arr: t + 10 * MIN, from: `Arrêt ${i}`, to: `Arrêt ${i + 1}`, ...(r.platform ? { platform: r.platform } : {}) });
    t += 15 * MIN;
  });
  steps.push({ walk: 2 });
  return journey('c', steps);
}
const withRide = (j: Journey, p: Partial<Leg>): Journey => ({ ...j, legs: j.legs.map((l) => (l === j.legs.find((x) => x.kind === 'ride') ? { ...l, ...p } : l)) });

describe('PRD-1.3.0 § 7 : contenu de l’accordéon des favoris', () => {
  // 1.3.1 (PRD-1.3.1 § 4) : la 1re ligne nomme l'arrêt où monter, la 2e garde le véhicule et son heure (règles de la 1.3.0
  // pour l'heure prévue, la voie, le souci et les changements)
  it('marche puis véhicule : « à pied 7 min → Arrêt 0 », « bus W ~07:42, direct » ; un train et sa voie, voie modifiée', () => {
    const bus = withRide(chain([{ ride: 'W', mode: 'bus' }]), { rt: false });
    expect(texts(ok(PLACES.bureau, bus))).toEqual(['à pied 7 min → Arrêt 0', 'bus W ~07:42, direct']);
    expect(favoriteDetail(ok(PLACES.bureau, bus), NOW, S)[1]).toEqual({ text: 'bus W ~07:42, direct', planned: true });
    // sans le « ~ » du réglage : pas de `planned`
    expect(favoriteDetail(ok(PLACES.bureau, bus), NOW, settingsWith([], { display: { ...S.display, markPlanned: false } }))[1]).toEqual({ text: 'bus W 07:42, direct' });
    const ic = withRide(chain([{ ride: 'IC', mode: 'train', platform: '4' }]), { rt: false });
    expect(texts(ok(PLACES.bureau, ic))).toEqual(['à pied 7 min → Arrêt 0', 'IC ~07:42 voie 4, direct']);
    const moved = withRide(chain([{ ride: 'IC', mode: 'train', platform: '4' }]), { newPlatform: '6', delayMin: 2 });
    expect(texts(ok(PLACES.bureau, moved))).toEqual(['à pied 7 min → Arrêt 0', 'IC 07:42 +2 voie 6 au lieu de 4, direct']);
    // un trajet qui part de la gare : « depuis Namur »
    const aboard = journey('a', [{ ride: 'IC', mode: 'train', dep: NOW + 11 * MIN, arr: NOW + 40 * MIN, from: 'Namur', to: 'Bruxelles-Central', platform: '2' }]);
    expect(texts(ok(PLACES.bureau, aboard))).toEqual(['depuis Namur', 'IC 07:42 voie 2, direct']);
  });

  it('2e ligne : « 1 changement : métro 2 », « 2 changements : métro 2, tram 3 », au-delà « … » ; le souci', () => {
    const one = chain([{ ride: 'IC', mode: 'train', platform: '3' }, { ride: '2', mode: 'metro' }]);
    expect(texts(ok(PLACES.bureau, one))[1]).toBe('IC 07:42 voie 3, 1 changement : métro 2');
    const two = chain([{ ride: 'IC', mode: 'train', platform: '3' }, { ride: '2', mode: 'metro' }, { ride: '3', mode: 'tram' }]);
    expect(texts(ok(PLACES.bureau, two))[1]).toBe('IC 07:42 voie 3, 2 changements : métro 2, tram 3');
    const three = chain([{ ride: '36', mode: 'bus' }, { ride: 'IC', mode: 'train' }, { ride: '2', mode: 'metro' }, { ride: '3', mode: 'tram' }]);
    expect(nb(changesText(three))).toBe('3 changements : IC, métro 2, …');
    // premier véhicule supprimé : « IC 07:42 supprimé », l'heure prévue, sans voie (1.3.1)
    const cancelled = withRide(one, { cancelled: true });
    expect(texts(ok(PLACES.bureau, cancelled))).toEqual(['à pied 7 min → Arrêt 0', 'IC 07:42 supprimé, 1 changement : métro 2']);
    // voie modifiée sans l'ancienne voie : « voie modifiée »
    expect(troubleText(withRide(chain([{ ride: 'IC', mode: 'train' }]), { newPlatform: '6' }))).toBe('voie modifiée');
    // alerte du trajet (travaux, voie, suppression), sans son « ! » ; un retard seul, jamais
    expect(troubleText({ ...one, alerts: [{ kind: 'works', text: 'Travaux : ligne 124', at: NOW }] })).toBe('Travaux : ligne 124');
    expect(troubleText({ ...one, alerts: [{ kind: 'cancel', text: '! Supprimé : le métro 2 de 08:01', at: NOW }] })).toBe('Supprimé : le métro 2 de 08:01');
    expect(troubleText({ ...one, alerts: [{ kind: 'delay', text: '! Retard : +12 min', at: NOW }] })).toBe('');
    expect(troubleText(withRide(one, { delayMin: 12 }))).toBe('');
  });

  it('gare hors de portée à pied : « IC voie 4 à 11:42, à Bruxelles-Central » ; à pied seulement : une ligne ; rien ne s’ouvre sinon', () => {
    const late = at(DAY, 11, 12);
    const station = journey('st', [{ ride: 'IC', mode: 'train', dep: at(DAY, 11, 42), arr: at(DAY, 12, 12), from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4' }]);
    expect(texts(ok(PLACES.bureau, station, { fromStation: true }), late)).toEqual(['IC voie 4 à 11:42, à Bruxelles-Central', 'direct']);
    const walk = { ...journey('w', [{ walk: 23 }]), dep: NOW, arr: NOW + 23 * MIN };
    expect(texts(ok(PLACES.bureau, walk))).toEqual(['à pied 23 min']);
    // « tu y es », aucun trajet, sans position, en calcul, plus attrapable : rien
    expect(favoriteDetail({ favoriteId: 'x', kind: 'trip', state: 'here', updatedAt: NOW }, NOW, S)).toEqual([]);
    expect(favoriteDetail({ favoriteId: 'x', kind: 'trip', state: 'none', updatedAt: NOW }, NOW, S)).toEqual([]);
    expect(favoriteDetail({ favoriteId: 'x', kind: 'trip', state: 'noPosition', updatedAt: NOW }, NOW, S)).toEqual([]);
    expect(favoriteDetail(undefined, NOW, S)).toEqual([]);
    expect(favoriteDetail(ok(PLACES.bureau, chain([{ ride: 'W', mode: 'bus' }])), NOW + 30 * MIN, S)).toEqual([]);
  });

  it('« Favoris » : `accordion`, chaque favori son accordéon, l’adresse récente complète ; « Autre adresse » rien ; plus de ligne du détail ; l’accueil ne change pas', () => {
    const recent: RecentAddress[] = [{ label: 'Place Saint-Lambert 1, 4000 Liège', lat: 50.6451, lon: 5.5734, at: 1 }];
    const favs = [PLACES.bureau, PLACES.maison];
    const entries: FavoriteEntry[] = [
      { fav: PLACES.bureau, answer: ok(PLACES.bureau, chain([{ ride: 'W', mode: 'bus' }])) },
      { fav: PLACES.maison, answer: { favoriteId: 'fav-maison', kind: 'trip', state: 'here', updatedAt: NOW } },
    ];
    const c = ctx({ settings: settingsWith(favs, { recent }) }, favs);
    const v = favoritesView({ entries }, c);
    expect(v.accordion).toBe(true);
    expect(v.reserveNote).toBeUndefined();
    const items = v.items as DetailItem[];
    expect(items.map((i) => i.expand?.map((l) => nb(l.text)))).toEqual([['à pied 7 min → Arrêt 0', 'bus W 07:42, direct'], undefined, ['Place Saint-Lambert 1, 4000 Liège'], undefined]);
    expect(items.every((i) => i.detail === undefined)).toBe(true);
    expect(page(v).lines.map(nb)).not.toContain('Place Saint-Lambert 1, 4000 Liège');
    // sans favori : « Ajouter un favori » n'a rien à ouvrir
    expect((favoritesView({}, ctx({ settings: settingsWith([]) }, [])).items[0] as DetailItem).expand).toBeUndefined();
    // l'accueil ne change pas
    const home = homeView({ favorites: entries, nearbyCount: 9, gestureHelp: false }, c);
    expect(home.accordion).toBeUndefined();
    expect(home.items.some((i) => (i as DetailItem).expand)).toBe(false);
  });

  it('noms et adresses les plus longs : chaque ligne tient en retrait (EXPAND_PX), coupée au mot, l’heure et la voie entières', () => {
    const LONG = ['Comines/komen Chaussée de Wervicq/Werviksesteenweg', 'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost', 'Bruxelles-Aéroport-Zaventem'];
    expect(EXPAND_PX).toBe(WIDTHS.homeRow);
    for (const name of LONG) {
      const station = journey('st', [{ ride: 'IC', mode: 'train', dep: NOW + 30 * MIN, arr: NOW + 60 * MIN, from: name, to: 'Gand-Saint-Pierre', platform: '12a' }]);
      const st = favoriteDetail(ok(PLACES.bureau, station, { fromStation: true }), NOW, S);
      expect(nb(st[0].text)).toMatch(/^IC voie 12a à 08:01, à /);
      const recent: RecentAddress[] = [{ label: `${name} 1, 7780 Comines-Warneton, Hainaut, Belgique`, lat: 50.77, lon: 3.0, at: 1 }];
      const alert = { ...chain([{ ride: '163b4', mode: 'bus' }, { ride: 'IC', mode: 'train' }, { ride: '2', mode: 'metro' }, { ride: '3', mode: 'tram' }]), alerts: [{ kind: 'works' as const, text: `Travaux : ${name}`, at: NOW }] };
      const v = favoritesView({ entries: [{ fav: PLACES.bureau, answer: ok(PLACES.bureau, alert) }] }, ctx({ settings: settingsWith([PLACES.bureau], { recent }) }));
      const all = [...st, ...(v.items as DetailItem[]).flatMap((i) => i.expand ?? [])];
      expect(all.length).toBeGreaterThanOrEqual(4);
      for (const l of all) {
        expect(textWidth(l.text), l.text).toBeLessThanOrEqual(EXPAND_PX);
        expect(l.text).not.toMatch(/ …$|[–—]/);
        // coupé : après un mot entier ou un morceau entier d'un nom composé
        if (l.text.endsWith('…')) expect(l.text, l.text).toMatch(/[\p{L}\p{N},:)/\-’]…$/u);
      }
    }
  });
});
