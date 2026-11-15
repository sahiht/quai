/**
 * Quai 1.2.1, écran d'un trajet et page « Autres trajets » (docs/v1.2.1/PRD-1.2.1.md § 3, CA-121.4) : △▽ font défiler
 * les étapes du trajet affiché seulement ; ligne du bas « ▽ suite du trajet : n étapes » puis « Fin du trajet. ▽ 2
 * autres trajets » ; ▼ au bout ouvre « Autres trajets » ; toucher ouvre une entrée ; double toucher revient à la liste,
 * puis aux étapes du premier trajet, à leur fin. Trajet suivi, « ▶ » et « Dans le train » inchangés.
 * 1.2.2 (PRD-1.2.2 § 6, REVUE-USAGE n° 8) : véhicules en toutes lettres (« Bus 36 », « Métro 2 »). 1.2.10
 * (docs/v1.2.10/PRD-1.2.10.md § 5) : le nom du trajet en titre, « Départ 07:38, dans 7 min » et « arrivée 08:33 » en
 * haut, une rangée par étape ; toucher : « y aller » (guidage) ; le trajet guidé (ou suivi) : rien à lancer, « ▶ ».
 */
import { describe, expect, it } from 'vitest';
import type { Core, Endpoint, Journey } from '../../src/core/api';
import { TRIP_KEY } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS } from '../../src/glasses/layout';
import { otherDetail, othersTitle, othersView, stepsPage, type ViewCtx } from '../../src/glasses/views';
import type { OthersRoute } from '../../src/glasses/types';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { MIN, PLACES, at, journey, lines, nb, page, settingsWith, setup, stubCore, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 31);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const TO: Endpoint = { type: 'place', placeId: 'fav-bureau' };

/** Proposition 1 : bus 36, IC, métro 2 ; 9 étapes à l'écran. */
const j1 = journey(
  'j1',
  [
    { walk: 5, to: 'Maison Arrêt' },
    { ride: '36', mode: 'bus', dep: T(7, 43), arr: T(7, 55), from: 'Maison Arrêt', to: 'Braine-l’Alleud', head: 'Rixensart' },
    { walk: 4, to: 'Braine-l’Alleud' },
    { ride: 'IC', mode: 'train', dep: T(8, 1), arr: T(8, 24), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '3' },
    { ride: '2', mode: 'metro', dep: T(8, 27), arr: T(8, 31), from: 'Gare Centrale', to: 'Madou', head: 'Simonis' },
    { walk: 2 },
  ],
  { label: 'short', reason: 'Moins de marche : 2 changements, à pied 5 + 4 + 2 min' },
);
/** « Plus tôt » : 19 min à pied puis l'IC. */
const j2 = journey('j2', [{ walk: 19, to: 'Braine-l’Alleud' }, { ride: 'IC', mode: 'train', dep: T(7, 55), arr: T(8, 17), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '1' }, { walk: 3 }], {
  label: 'earlier',
  reason: 'Plus tôt de 13 min, mais 19 min à pied',
});
/** « Le suivant » : le même trajet 30 min plus tard. */
const j3 = journey(
  'j3',
  [
    { walk: 5, to: 'Maison Arrêt' },
    { ride: '36', mode: 'bus', dep: T(8, 13), arr: T(8, 25), from: 'Maison Arrêt', to: 'Braine-l’Alleud', head: 'Rixensart' },
    { walk: 4, to: 'Braine-l’Alleud' },
    { ride: 'IC', mode: 'train', dep: T(8, 31), arr: T(8, 54), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '3' },
    { ride: '2', mode: 'metro', dep: T(8, 57), arr: T(9, 1), from: 'Gare Centrale', to: 'Madou', head: 'Simonis' },
    { walk: 2 },
  ],
  { label: 'next', reason: 'Le suivant : même trajet, 30 min plus tard' },
);
const ALL = [j1, j2, j3];

/** 1.2.10 : trajet guidé (écran calme allumé) : toucher revient au guidage. */
const HINT_FOLLOWED = '△▽ étapes   double : retour';
const HINT_OTHER = '△▽ étapes   double : retour';
/** Les six rangées du trajet 1 (1.2.10 § 5) : marges des correspondances de 5 min ou moins, sinon l'arrivée. */
const J1_ROWS = [
  '07:38 à pied 5 min',
  '07:43 Bus 36 → Braine-l’Alleud   07:55',
  '07:55 à pied 4 min',
  '08:01 IC voie 3 → Bruxelles-Central   marge 2 min',
  '08:27 Métro 2 → Madou   marge 3 min',
  '08:31 à pied 2 min',
];
const HINT_LIST = '△▽ choisir   toucher : voir   double : retour';
const LIST = ['Plus tôt   07:36 → 08:20', 'IC, 13 min plus tôt, mais 19 min à pied', 'Le suivant   08:08 → 09:03', 'bus 36 + IC + métro 2, à pied 5 + 4 + 2 min', HINT_LIST];

const bottom = (s: Screen) => s.lines.at(-2);
const steps = (s: Screen) => s.screen === 'steps' && s.page !== undefined;

/** Faux cœur qui note les trajets rafraîchis (temps réel). */
function spying(refreshed: string[]) {
  return (now: () => number): Core => {
    const core = stubCore(now);
    return Object.assign(Object.create(core) as Core, {
      async refresh(j: Journey) {
        refreshed.push(j.id);
        return j;
      },
    });
  };
}

async function shown(journeys: Journey[], index = 0, opts: { core?: (now: () => number) => Core; kv?: ReturnType<typeof createKV> } = {}) {
  const h = await setup({ now: NOW, kv: opts.kv, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.1' }), core: opts.core ?? ((now) => stubCore(now)) });
  await h.until((s) => s.screen === 'home');
  const msg = await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: TO, favoriteId: 'fav-bureau', result: { journeys }, index });
  expect(nb(msg)).toMatch(/^Affiché dans les lunettes : /);
  await h.until(steps);
  return h;
}

describe('CA-121.4 : un trajet de 9 étapes, puis « Autres trajets »', () => {
  it('six étapes sur une page : « Fin du trajet. ▽ 2 autres trajets » ; jamais un autre trajet sans ▼ au bout', async () => {
    const h = await shown(ALL);
    const first = h.last();
    // le trajet suivi (bouton « Lunettes ») est guidé : toucher revient au guidage, « ▶ » sur la 1re étape
    expect(first).toMatchObject({ screen: 'steps', page: 1, pages: 3, followed: true, sel: 0 });
    expect(nb(first.title)).toBe('Bureau');
    expect(first.lines).toEqual(['Départ 07:38, dans 7 min   arrivée 08:33', ...J1_ROWS, 'Fin du trajet. ▽ 2 autres trajets', HINT_FOLLOWED]);
    // ▲ en haut ne change rien
    await h.gesture('up');
    expect(h.screens().filter((s) => s.screen === 'steps').every((s) => s.page === 1 && s.title === first.title)).toBe(true);
    h.c.stop();
  });

  it('▼ ouvre « Autres trajets » ; toucher ouvre le trajet ; double toucher revient à la liste, puis aux étapes du 1er trajet', async () => {
    const h = await shown(ALL);
    await h.gesture('down');
    const list = await h.until((s) => s.screen === 'others');
    expect(nb(list.title)).toBe('Vers le bureau : autres trajets');
    expect(list.lines).toEqual(LIST);
    expect(list.sel).toBe(0);
    // toucher : les étapes de « Plus tôt » ; toucher y lancerait le guidage
    await h.gesture('tap');
    const other = await h.until(steps);
    expect(other).toMatchObject({ page: 2, label: 'earlier', followed: false, sel: -1 });
    expect(nb(other.title)).toBe('Bureau');
    // 1.2.5 (gardé en 1.2.10) : départ à pied dans 5 min (07:36) : « Si tu le rates » en haut ; raté à Braine-l'Alleud,
    // l'IC de 08:01 du 1er trajet
    expect(other.lines).toEqual(['Si tu le rates : arrivée 08:33, 13 min plus tard', '07:36 à pied 19 min', '07:55 IC voie 1 → Bruxelles-Central   08:17', '08:17 à pied 3 min', 'Fin du trajet. ▽ autres trajets', HINT_OTHER]);
    // double toucher : la liste, curseur sur la même entrée
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'others', sel: 0 });
    // le suivant : ▼ au bout revient à la liste
    await h.gesture('down', 'tap');
    const next = await h.until((s) => steps(s) && s.page === 3);
    expect(next.lines.slice(-2)).toEqual(['Fin du trajet. ▽ autres trajets', HINT_OTHER]);
    await h.gesture('down');
    expect(h.last()).toMatchObject({ screen: 'others', sel: 1 });
    // double toucher sur la liste : les étapes du 1er trajet
    await h.gesture('double');
    const back = h.last();
    expect(back).toMatchObject({ screen: 'steps', page: 1, followed: true });
    expect(back.lines.slice(-2)).toEqual(['Fin du trajet. ▽ 2 autres trajets', HINT_FOLLOWED]);
    // le trajet suivi n'a pas changé
    expect(h.c.followed?.journey.id).toBe('j1');
    h.c.stop();
  });

  it('sur un autre trajet, toucher : « y aller » (goGuide) ; le trajet guidé (ViewCtx.guidedJourneyId) : « ▶ », toucher revient au guidage', () => {
    const c = { now: NOW, settings: settingsWith([PLACES.bureau]) };
    const other = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 1, followedId: 'j1', fromList: true }, c);
    expect(other.tap).toEqual({ kind: 'goGuide' });
    expect(other.mark).toBeUndefined();
    expect(other.hints).toBe(HINT_OTHER.replace(/ : /g, '\u00a0: '));
    // le contrôleur dit quel trajet est guidé : il l'emporte sur le trajet suivi
    const guided = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 1, followedId: 'j1', fromList: true }, { ...c, guidedJourneyId: 'j2' });
    expect(guided.tap).toEqual({ kind: 'resume' });
    expect(guided.mark).toBe(0);
    expect(lines(guided).at(-1)).toBe(HINT_FOLLOWED);
    // suivi sans guidage (réglage éteint) : « Ne plus suivre », comme en 1.2.9
    const off = { ...c, settings: { ...c.settings, display: { ...c.settings.display, guide: false } }, guidedJourneyId: 'j2' };
    const followed = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 1, fromList: true }, off);
    expect(followed.tap).toEqual({ kind: 'open', route: { screen: 'followed' } });
    expect(followed.mark).toBe(0);
    expect(lines(followed).at(-1)).toBe('△▽ étapes   double : retour');
    // un autre trajet, réglage éteint : « y aller » quand même (il fera suivre sans messages)
    expect(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 0 }, off).tap).toEqual({ kind: 'goGuide' });
    expect(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: ALL, index: 0, followedId: 'j1' }, { ...c, guidedJourneyId: 'j2' }).tap).toEqual({ kind: 'goGuide' });
  });

  it('une seule proposition : « Fin du trajet. Pas d’autre trajet pour l’instant », ▼ ne fait rien', async () => {
    const h = await shown([j1]);
    await h.gesture('down');
    expect(bottom(h.last())).toBe('Fin du trajet. Pas d’autre trajet pour l’instant');
    const end = h.last();
    await h.gesture('down');
    expect(h.last()).toEqual(end);
    expect(h.screens().some((s) => s.screen === 'others')).toBe(false);
    h.c.stop();
  });

  it('« Dans le train » au départ du bus suivi, même depuis « Autres trajets » ; retour aux étapes du trajet suivi', async () => {
    const h = await shown(ALL);
    await h.gesture('down', 'down', 'tap');
    await h.until((s) => steps(s) && s.page === 3);
    h.advance(T(7, 43) + 20_000 - NOW);
    await h.c.refreshCurrent();
    const train = await h.until((s) => s.screen === 'train');
    expect(nb(train.title)).toBe('Bus 36 vers Rixensart');
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'steps', page: 1, followed: true });
    h.c.stop();
  });

  it('temps réel : la liste rafraîchit ses entrées ; une entrée ouverte est rafraîchie aussitôt', async () => {
    const refreshed: string[] = [];
    const h = await shown(ALL, 0, { core: spying(refreshed) });
    await h.gesture('down');
    await h.until((s) => s.screen === 'others');
    await h.settle(50);
    expect(refreshed).toEqual(expect.arrayContaining(['j2', 'j3']));
    refreshed.length = 0;
    await h.gesture('tap');
    await h.until((s) => steps(s) && s.page === 2);
    await h.settle(50);
    expect(refreshed).toContain('j2');
    // rafraîchissement de 30 s sur la page ouverte depuis la liste
    refreshed.length = 0;
    h.advance(30_000);
    await h.c.refreshCurrent();
    expect(refreshed).toContain('j2');
    h.c.stop();
  });

  it('reprise d’un trajet en cours à la réouverture : ses étapes et le « ▶ » ; ▼ au bout : « Autres trajets »', async () => {
    const kv = createKV(memoryBackend());
    const a = await shown(ALL, 0, { kv });
    a.c.stop();
    await a.settle();
    expect(JSON.parse((await kv.get(TRIP_KEY))!).journey.id).toBe('j1');
    // 07:40 : la marche vers l'arrêt a commencé
    const b = await setup({ now: T(7, 40), kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    const st = await b.until(steps);
    expect(st).toMatchObject({ page: 1, followed: true, sel: 0 });
    expect(nb(st.lines.at(-1)!)).toBe('Trajet en cours : vers le bureau');
    // 07:40, en marchant vers l'arrêt, avant le bus : « Si tu le rates » (1.2.5, gardé en 1.2.10)
    expect(st.lines.slice(0, 2)).toEqual(['Si tu le rates : arrivée 09:03, 30 min plus tard', '07:38 à pied 5 min']);
    await b.gesture('down');
    expect((await b.until((s) => s.screen === 'others')).lines).toEqual(LIST);
    b.c.stop();
  });

  it('la liste suit la reprise du trajet suivi : ouverte depuis la 2e proposition, elle montre la 1re', async () => {
    const h = await shown(ALL, 1);
    expect(h.last()).toMatchObject({ page: 2, followed: true });
    expect(bottom(h.last())).toBe('Fin du trajet. ▽ 2 autres trajets');
    await h.gesture('down');
    const list = await h.until((s) => s.screen === 'others');
    expect(list.lines.slice(0, 2)).toEqual(['Moins de marche   07:38 → 08:33', 'bus 36 + IC + métro 2, à pied 5 + 4 + 2 min']);
    expect(list.lines[2]).toBe('Le suivant   08:08 → 09:03');
    h.c.stop();
  });
});

/* ------------------------------ Vues ------------------------------ */

const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([PLACES.bureau]), ...patch });
const route = (patch: Partial<OthersRoute> = {}): OthersRoute => ({ screen: 'others', key: 's1', title: 'Vers le bureau', journeys: ALL, index: 0, to: TO, ...patch });

describe('§ 3 : textes et largeurs', () => {
  it('ligne du bas : « 2 étapes », « 1 autre trajet » ; aides du trajet guidé, d’une autre proposition, à pied', () => {
    // 8 étapes, 6 rangées à l'écran : deux cachées
    const long = journey('s', [
      { walk: 5, to: 'Arrêt' },
      { ride: '36', mode: 'bus', dep: T(7, 43), arr: T(7, 55), from: 'Arrêt', to: 'Gare' },
      { walk: 4, to: 'Gare' },
      { ride: 'IC', mode: 'train', dep: T(8, 1), arr: T(8, 24), from: 'Gare', to: 'Central' },
      { ride: '2', mode: 'metro', dep: T(8, 27), arr: T(8, 31), from: 'Gare Centrale', to: 'Madou' },
      { walk: 2, to: 'Madou' },
      { ride: '92', mode: 'tram', dep: T(8, 36), arr: T(8, 44), from: 'Madou', to: 'Flagey' },
      { walk: 3 },
    ]);
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [long, j2], index: 0, followedId: 's', fresh: true }, ctx());
    expect(lines(v).slice(-2)).toEqual(['▽ suite du trajet : 2 étapes', HINT_FOLLOWED]);
    const end = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [long, j2], index: 0, followedId: 's', top: 5 }, ctx());
    expect(lines(end).slice(-2)).toEqual(['Fin du trajet. ▽ 1 autre trajet', HINT_FOLLOWED]);
    const other = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [long, j2], index: 1, followedId: 's', fromList: true }, ctx());
    expect(lines(other).slice(-2)).toEqual(['Fin du trajet. ▽ autres trajets', HINT_OTHER]);
    expect(other.tap).toEqual({ kind: 'goGuide' });
    const walk = journey('w', [{ walk: 9 }], { label: 'walk', reason: 'À pied : 9 min, arrivée 07:49' });
    walk.dep = NOW;
    walk.arr = NOW + 9 * MIN;
    walk.leaveAt = NOW;
    walk.legs[0] = { ...walk.legs[0], dep: NOW, arr: NOW + 9 * MIN, schedDep: NOW, schedArr: NOW + 9 * MIN };
    // à pied seulement : une rangée ; guidé : rien à lancer ; sinon « y aller » (le guidage mène aussi à pied)
    const w = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [walk], index: 0, followedId: 'w', fresh: true }, ctx());
    expect(lines(w)).toEqual(['Départ 07:31   arrivée 07:40', '07:31 à pied 9 min', 'Fin du trajet. Pas d’autre trajet pour l’instant', HINT_FOLLOWED]);
    expect(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [walk], index: 0, fresh: true }, ctx()).tap).toEqual({ kind: 'goGuide' });
  });

  it('titre : le nom du trajet (« Bureau »), l’heure à droite ; un nom trop long coupé au mot', () => {
    const title = (t: string, followedId?: string) => nb(page(stepsPage({ title: t, label: '' }, { journeys: [j1], index: 0, followedId, fresh: true }, ctx())).title);
    expect(title('Vers le bureau')).toBe('Bureau');
    expect(title('Vers la maison', 'j1')).toBe('Maison');
    expect(title('Vers Gand-Saint-Pierre')).toBe('Gand-Saint-Pierre');
    expect(title('Vers Rue Neuve 1')).toBe('Rue Neuve 1');
    const long = title('Vers Comines/komen Chaussée de Wervicq/Werviksesteenweg 1, 7780 Comines-Warneton, Belgique');
    // coupé au mot, ou après un trait d'union ou une barre d'un nom composé (« Wervicq/… » : le français entier)
    expect(long).toMatch(/^Comines\/komen .*[a-z0-9,/-]…$/);
    expect(long).not.toMatch(/ …$/);
    expect(textWidth(long)).toBeLessThanOrEqual(WIDTHS.title);
    // l'heure à sa place, aucun état sur la ligne du titre
    expect(page(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j1], index: 0, fresh: true }, ctx())).containers.find((c) => c.name === 'clock')!.content.trim()).toBe('07:31');
  });

  it('« Autres trajets » : nom affiché, heures, 2e ligne plus pâle, curseur ; titre coupé si trop long', () => {
    const v = othersView(route(), ALL, ctx());
    expect(lines(v)).toEqual(LIST);
    const p = page(v);
    expect(p.sel).toBe(0);
    const by = (n: string) => p.containers.find((c) => c.name === n)!;
    expect(by('colA').level).toBe(4);
    expect(by('colC').level).toBe(4);
    expect(by('colB').level).toBe(2);
    expect(v.items.map((i) => i.action)).toEqual([
      { kind: 'open', route: { screen: 'steps', key: 's1', label: '', title: 'Vers le bureau', journeys: ALL, index: 1, fromList: true, to: TO } },
      { kind: 'open', route: { screen: 'steps', key: 's1', label: '', title: 'Vers le bureau', journeys: ALL, index: 2, fromList: true, to: TO } },
    ]);
    const long = othersTitle('Vers Avenue Winston Churchill 100, Uccle, au troisième étage');
    expect(nb(long)).toMatch(/^Vers Avenue Winston Churchill.*… : autres trajets$/);
    expect(textWidth(long)).toBeLessThanOrEqual(WIDTHS.title);
    lines(othersView(route({ title: 'Vers Avenue Winston Churchill 100, Uccle, au troisième étage' }), ALL, ctx()));
  });

  it('2e ligne : les moyens d’abord, puis le pourquoi sans répéter le nom (sinon les marches) ; les moyens se raccourcissent, jamais le pourquoi', () => {
    // « Plus tôt » qui marche plus que la proposition 1 ; « Le suivant » : ses marches
    expect(nb(otherDetail(j2, ALL))).toBe('IC, 13 min plus tôt, mais 19 min à pied');
    expect(nb(otherDetail(j3, ALL))).toBe('bus 36 + IC + métro 2, à pied 5 + 4 + 2 min');
    // « Plus tôt » sans marcher plus : l'avance seule (l'heure de départ est en ligne 1)
    const quick = journey('q', [{ walk: 4, to: 'Braine-l’Alleud' }, { ride: 'IC', mode: 'train', dep: T(7, 55), arr: T(8, 17), from: 'Braine-l’Alleud', to: 'Bruxelles-Central' }, { walk: 3 }], { label: 'earlier', reason: 'Plus tôt de 13 min, en partant à 07:51' });
    expect(nb(otherDetail(quick, [j1, quick]))).toBe('IC, 13 min plus tôt');
    // « Moins de marche » (autre que la proposition 1) : l'arrivée comparée, puis « moins de marche »
    const less = { ...j3, id: 'less', label: 'lesswalk' as const, reason: 'Moins de marche : arrive 30 min plus tard' };
    expect(nb(otherDetail(less, [j1, less]))).toBe('bus 36 + IC + métro 2, 30 min plus tard, moins de marche');
    expect(nb(otherDetail({ ...less, arr: j1.arr + 60 * MIN }, [j1, less]))).toBe('bus 36 + IC + métro 2, 1 h plus tard, moins de marche');
    // les autres étiquettes : jamais leur raison, les moyens et les marches
    expect(nb(otherDetail({ ...j3, label: 'none', reason: 'Sans changement : à pied 5 + 4 min' }, ALL))).toBe('bus 36 + IC + métro 2, à pied 5 + 4 + 2 min');
    const direct = journey('d', [{ ride: 'IC', mode: 'train', dep: T(8, 1), arr: T(8, 24), from: 'A', to: 'B' }], { label: 'later', reason: 'Plus tard : direct, départ 08:01' });
    expect(otherDetail(direct, [j1, direct])).toBe('IC');
    // à pied seulement
    const walk = { ...journey('w', [{ walk: 25 }], { label: 'walk' as const }), dep: NOW, arr: NOW + 25 * MIN };
    expect(nb(otherDetail(walk, [j1, walk]))).toBe('à pied, 25 min');
    // trop long pour une ligne : les moyens se raccourcissent (« … »), le pourquoi reste entier
    const long = journey(
      'l',
      [
        { walk: 19, to: 'Arrêt' },
        { ride: 'Express Wavre-Louvain-la-Neuve-Ottignies', mode: 'bus', dep: T(7, 55), arr: T(8, 5), from: 'A', to: 'B' },
        { ride: 'IC', mode: 'train', dep: T(8, 7), arr: T(8, 12), from: 'B', to: 'C' },
        { ride: '2', mode: 'metro', dep: T(8, 13), arr: T(8, 15), from: 'C', to: 'D' },
        { walk: 3 },
      ],
      { label: 'earlier', reason: 'Plus tôt de 15 min, mais 19 min à pied' },
    );
    const cut = nb(otherDetail(long, [j1, long]));
    expect(cut).toMatch(/^bus Express Wavre.*…, 15 min plus tôt, mais 19 min à pied$/);
    // trois véhicules qui ne tiennent pas avec le pourquoi (580 px) : « bus Rapido 365a + IC + … » (524 px)
    const rapido = { ...long, legs: long.legs.map((l) => (l.kind === 'ride' && l.mode === 'bus' ? { ...l, line: 'Rapido 365a' } : l)) };
    expect(nb(otherDetail(rapido, [j1, rapido]))).toBe('bus Rapido 365a + IC + …, 15 min plus tôt, mais 19 min à pied');
    // même chose pour « Moins de marche » arrivé avant la proposition 1
    const less15 = { ...rapido, label: 'lesswalk' as const };
    expect(nb(otherDetail(less15, [j1, less15]))).toBe('bus Rapido 365a + IC + …, 15 min plus tôt, moins de marche');
    expect(textWidth(cut)).toBeLessThanOrEqual(WIDTHS.full);
    for (const j of ALL) expect(textWidth(otherDetail(j, ALL))).toBeLessThanOrEqual(WIDTHS.full);
  });

  it('un autre jour : « demain 06:20 → 06:46 » tient à droite', () => {
    const tomorrow = journey('t', [{ ride: 'IC', mode: 'train', dep: at('2026-11-13', 6, 20), arr: at('2026-11-13', 6, 46), from: 'A', to: 'B' }], { label: 'later', reason: 'Plus tard : direct, départ 06:20' });
    const v = othersView(route({ journeys: [j1, tomorrow], index: 0 }), [j1, tomorrow], ctx({ now: at(DAY, 23, 30) }));
    expect(lines(v).slice(0, 2)).toEqual(['Plus tard   demain 06:20 → 06:46', 'IC']);
  });
});
