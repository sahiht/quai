/**
 * Quai 1.3.1, accueil des lunettes (docs/v1.3.1/PRD-1.3.1.md § 8 et § 12 ; notes des experts : 02-usager.md U2 et U8,
 * 04-langage.md L7) :
 *  - § 8 : « Autour de moi » ; « Favoris » et ses favoris ; « Gares de train » ; « Lignes de bus, tram, métro » ;
 *    « Arrêts de bus, tram, métro » (« En cours » reste en tête) ; à l'ouverture de Quai, le curseur sur « Autour de
 *    moi » ; les cas qui ajoutent une ligne (aide des gestes, trajet suivi, jour férié, ligne du haut) et le réglage « À
 *    l'ouverture de Quai » gardent leurs règles ; le retour à l'accueil garde son curseur, comme en 1.3.0 ; tout au pixel,
 *    la rangée du curseur toujours entière.
 *  - B15 (U2) : le « ! » d'un favori à souci sur l'accueil, la règle de « Favoris » (favoriteTrouble, TROUBLE_MARK) :
 *    voie modifiée, suppression, travaux ; jamais un simple retard.
 *  - B20 (U8) : le soir, quand aucun favori ne peut aller sur l'accueil, jusqu'à 3 favoris qui ont un trajet plus tard
 *    (« demain 05:52 → 06:46 ») ; jamais « tu y es » ni « aucun trajet ».
 *  - L7 : « ★ Ajoutée à tes lignes », « ★ Déjà dans tes favoris », « ★ Trajet ajouté à tes favoris ».
 * Gares, arrêts et lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, Endpoint, Favorite, FavoriteAnswer, Journey, Leg, StationPick } from '../../src/core/api';
import { LINE_H, missingGlyphs, textWidth } from '../../src/glasses/font';
import { geometry, layoutPage, WIDTHS } from '../../src/glasses/layout';
import { effectiveFrame } from '../../src/glasses/nav';
import type { GlassesView } from '../../src/glasses/types';
import { favoriteItem, favoriteTrouble, homeFavoriteItem, homeView, TROUBLE_MARK, type FavoriteEntry, type HomeData, type ViewCtx } from '../../src/glasses/views';
import { LINES, MIN, PLACES, STATIONS, at, boardOf, container, journey, lines, overflowing, page, rowsOf, settingsWith, setup, stubCore, trainAt, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 20, 47);
/** 11 novembre : jour férié (horaires du dimanche). */
const HOLIDAY = at('2026-11-11', 7, 31);
/** Le soir : la plupart des favoris n'ont plus rien dans les 3 heures. */
const NIGHT = at(DAY, 22, 40);
const TOMORROW = '2026-11-13';

/** Trajet vers un lieu : 5 min à pied, bus W, 4 min à pied ; départ conseillé `leave`, arrivée `arr`. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5 }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Braine-l’Alleud Merbraine', to: 'Bruxelles-Midi' }, { walk: 4 }], { label: 'short', reason: 'Le plus court' });
}

/** Trajet en train : 5 min à pied, puis l'IC voie 4 ; `p` : ce qui arrive au premier train (voie, suppression, retard). */
function train(id: string, leave: number, arr: number, p: Partial<Leg> = {}): Journey {
  const j = journey(id, [{ walk: 5 }, { ride: 'IC', mode: 'train', dep: leave + 5 * MIN, arr, from: 'Braine-l’Alleud', to: 'Bruxelles-Midi', platform: '4' }], { label: 'short', reason: 'Le plus court' });
  j.legs[1] = { ...j.legs[1], ...p };
  return j;
}

const ok = (fav: Favorite, j: Journey, now = NOW): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now });
const here = (fav: Favorite, now = NOW): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'here', plan: { journeys: [], empty: 'here' }, updatedAt: now });
const ctxAt = (now: number, favorites: Favorite[], patch: Partial<ViewCtx['settings']> = {}): ViewCtx => ({ now, settings: settingsWith(favorites, patch) });
/** Une gare publique comme extrémité d'un trajet favori. */
const area = (p: StationPick): Endpoint => ({ type: 'area', areaId: p.areaId, op: 'sncb', name: p.name, lat: p.lat, lon: p.lon });

const FOUR = [PLACES.maison, PLACES.bureau, PLACES.parc, PLACES.ecole];
/** Une gare, une ligne suivie (tram 3) et un arrêt toutes lignes (Gare du Nord). */
const RUBRICS = { stations: [STATIONS.braine], lines: [LINES.gdnAll], follows: [{ id: 'f-t3', op: 'stib' as const, mode: 'tram' as const, line: '3', routes: [] }] };
const TAIL = ['Gares de train   1 gare', 'Lignes de bus, tram, métro   1 ligne', 'Arrêts de bus, tram, métro   1 arrêt'];
/** Bureau « maintenant », Parc « dans 4 min », École à 21:07 (comme les tests de l'accueil de la 1.2.2). */
const three = (now: number): FavoriteEntry[] => [
  { fav: PLACES.bureau, answer: ok(PLACES.bureau, door('j-bureau', now, now + 47 * MIN), now) },
  { fav: PLACES.parc, answer: ok(PLACES.parc, door('j-parc', now + 4 * MIN, now + 71 * MIN), now) },
  { fav: PLACES.ecole, answer: ok(PLACES.ecole, door('j-ecole', now + 20 * MIN, now + 50 * MIN), now) },
];
const running = { title: 'Vers le bureau', next: 'IC 08:01 voie 3', favoriteId: 'fav-bureau' };
const NOTICE = 'Horaires de demain pas encore publiés';

/**
 * La rangée `sel` sous le curseur : la liste ne défile jamais, rien ne dépasse, la rangée du curseur est celle de son
 * élément (la ligne vide au-dessus de « Gares de train » comptée) et tient entière au-dessus du pied.
 */
function wholeRow(v: GlassesView, sel: number): void {
  const g = geometry(v);
  const p = layoutPage(v, effectiveFrame({ route: { screen: 'home' }, sel, top: 0, fresh: false }, v, g.capacity));
  expect(overflowing(p), `rangée ${sel}`).toEqual([]);
  expect([p.top, p.visible, p.sel], `rangée ${sel}`).toEqual([0, v.items.length, sel]);
  const cursor = container(p, 'cursor');
  const row = cursor.content.split('\n').indexOf('▶');
  expect(row, `rangée ${sel}`).toBe(sel + v.items.slice(0, sel + 1).filter((i) => i.gap).length);
  expect(cursor.y + (row + 1) * LINE_H, `rangée ${sel}`).toBeLessThanOrEqual(g.footY);
}

/* ------------------------------ § 8 : l'ordre (vues) ------------------------------ */

describe('PRD-1.3.1 § 8 : l’ordre de l’accueil des lunettes', () => {
  it('« Autour de moi », « Favoris » et ses favoris, la ligne vide, « Gares de train », « Lignes… », « Arrêts… » ; chacun ouvre son écran', () => {
    const v = homeView({ favorites: three(NOW), nearbyCount: 9, gestureHelp: false }, ctxAt(NOW, FOUR, RUBRICS));
    expect(lines(v)).toEqual(['Autour de moi   9 arrêts', 'Favoris   4', 'Bureau   maintenant → 21:34', 'Parc   dans 4 min → 21:58', 'École   21:07 → 21:37', '', ...TAIL]);
    expect(v.items.map((i) => i.action)).toEqual([
      { kind: 'open', route: { screen: 'nearby' } },
      { kind: 'open', route: { screen: 'favorites' } },
      { kind: 'openFavorite', id: 'fav-bureau' },
      { kind: 'openFavorite', id: 'fav-parc' },
      { kind: 'openFavorite', id: 'fav-ecole' },
      { kind: 'open', route: { screen: 'stations' } },
      { kind: 'open', route: { screen: 'follows' } },
      { kind: 'open', route: { screen: 'lines' } },
    ]);
    // la ligne vide ferme le bloc des favoris, au-dessus de « Gares de train », jamais ailleurs
    expect(v.items.map((i) => !!i.gap)).toEqual([false, false, false, false, false, true, false, false]);
    // curseur à l'ouverture : « Autour de moi »
    expect(v.initialSel).toBe(0);
    expect(page(v).sel).toBe(0);
  });

  it('« En cours » reste en tête ; sans favori, « Ajouter un favori » sous « Autour de moi » ; « Accueil sans favoris » : « Favoris   4 » seul', () => {
    const run = homeView({ favorites: three(NOW), nearbyCount: 9, gestureHelp: false, running }, ctxAt(NOW, FOUR, RUBRICS));
    expect(lines(run)).toEqual(['En cours : vers le bureau   IC 08:01 voie 3', 'Autour de moi   9 arrêts', 'Favoris   4', 'Parc   dans 4 min → 21:58', 'École   21:07 → 21:37', '', ...TAIL]);
    expect(run.items[0].action).toEqual({ kind: 'resume' });
    // « En cours » garde le curseur à l'ouverture (un toucher reprend le trajet)
    expect(page(run).sel).toBe(0);
    const none = homeView({ nearbyCount: 3, near: 'Braine-l’Alleud', gestureHelp: false }, ctxAt(NOW, [], RUBRICS));
    expect(lines(none)).toEqual(['Près de Braine-l’Alleud', 'Autour de moi   3 arrêts', 'Ajouter un favori', '', ...TAIL]);
    expect(none.items[1].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    expect(page(none).sel).toBe(0);
    const plain = homeView({ noFavorites: true, favorites: three(NOW), nearbyCount: 3, gestureHelp: false }, ctxAt(NOW, FOUR, RUBRICS));
    expect(lines(plain)).toEqual(['Autour de moi   3 arrêts', 'Favoris   4', '', ...TAIL]);
    expect(lines(homeView({ favorites: three(NOW), noPosition: true, gestureHelp: false }, ctxAt(NOW, FOUR)))[0]).toBe('Autour de moi   sans position');
  });
});

/* ------------------------------ § 8 : les cas qui ajoutent une ligne ------------------------------ */

describe('PRD-1.3.1 § 8 : les cas qui ajoutent une ligne gardent leurs règles ; tout au pixel, la rangée du curseur entière', () => {
  const toNamur: Favorite = { kind: 'trip', id: 'fav-namur', from: area(STATIONS.braine), to: area(STATIONS.namur), propose: 'never' };
  const four = (now: number): FavoriteEntry[] => [...three(now), { fav: toNamur, answer: ok(toNamur, train('j-namur', now + 30 * MIN, now + 75 * MIN), now) }];
  const favs = [...FOUR, toNamur];
  // les mêmes nombres de favoris qu'en 1.2.6 (home.test.ts) : 3 avec un de ces cas, 2 quand deux se cumulent
  const cases: [string, number, Partial<HomeData>, number, boolean][] = [
    ['jour ordinaire, après 7 jours', NOW, { gestureHelp: false }, 3, true],
    ['7 premiers jours (aide des gestes)', NOW, { gestureHelp: true }, 3, false],
    ['trajet en cours', NOW, { gestureHelp: false, running }, 3, false],
    ['ligne du haut', NOW, { gestureHelp: false, notice: NOTICE }, 3, false],
    ['ligne du haut et trajet en cours', NOW, { gestureHelp: false, notice: NOTICE, running }, 2, false],
    ['jour férié, 7 premiers jours', HOLIDAY, { gestureHelp: true }, 2, false],
    ['jour férié et trajet en cours', HOLIDAY, { gestureHelp: false, running }, 2, false],
    ['ligne du haut, trajet en cours, jour férié et aide des gestes', HOLIDAY, { gestureHelp: true, running, notice: NOTICE }, 0, false],
  ];
  for (const [name, now, d, want, blank] of cases) {
    it(`${name} : ${want || 'aucun'} favori${want > 1 ? 's' : ''}${blank ? ', la ligne vide' : ', sans ligne vide'} ; curseur sur « ${d.running ? 'En cours' : 'Autour de moi'} »`, () => {
      const v = homeView({ favorites: four(now), nearbyCount: 9, ...d }, ctxAt(now, favs, RUBRICS));
      const l = lines(v);
      expect(v.items.filter((i) => i.action?.kind === 'openFavorite')).toHaveLength(want);
      expect(v.items.some((i) => i.gap)).toBe(blank);
      // l'ordre : « En cours », « Autour de moi », « Favoris », ses favoris, puis les trois rubriques en dernier
      expect(v.items.map((i) => i.action?.kind === 'openFavorite' ? 'fav' : i.action?.kind === 'resume' ? 'resume' : JSON.stringify(i.action))).toEqual([
        ...(d.running ? ['resume'] : []),
        JSON.stringify({ kind: 'open', route: { screen: 'nearby' } }),
        JSON.stringify({ kind: 'open', route: { screen: 'favorites' } }),
        ...Array<string>(want).fill('fav'),
        JSON.stringify({ kind: 'open', route: { screen: 'stations' } }),
        JSON.stringify({ kind: 'open', route: { screen: 'follows' } }),
        JSON.stringify({ kind: 'open', route: { screen: 'lines' } }),
      ]);
      expect(l.filter((x) => TAIL.includes(x))).toEqual(TAIL);
      // curseur à l'ouverture : « En cours » s'il y est, sinon « Autour de moi » (jamais un favori)
      expect(page(v).sel).toBe(0);
      expect(v.items[0].action).toEqual(d.running ? { kind: 'resume' } : { kind: 'open', route: { screen: 'nearby' } });
      // chaque rangée, sous le curseur : entière, la liste ne défile jamais
      for (let sel = 0; sel < v.items.length; sel++) wholeRow(v, sel);
    });
  }
});

/* ------------------------------ § 8 : le contrôleur ------------------------------ */

/** Réponses du jour : Bureau « maintenant », Parc « dans 4 min », École à 21:07, Maison « tu y es » (règle 5). */
function answersDay(fav: Favorite, now: number): FavoriteAnswer | undefined {
  if (fav.id === 'fav-bureau') return ok(fav, door('j-bureau', now, now + 47 * MIN), now);
  if (fav.id === 'fav-parc') return ok(fav, door('j-parc', now + 4 * MIN, now + 71 * MIN), now);
  if (fav.id === 'fav-ecole') return ok(fav, door('j-ecole', now + 20 * MIN, now + 50 * MIN), now);
  if (fav.id === 'fav-maison') return here(fav, now);
  return undefined;
}
/** La gare de Braine-l'Alleud : IC dans 20 et 50 min. */
const board = (id: string, n: number) => (id === STATIONS.braine.areaId ? boardOf(id, 'Braine-l’Alleud', [trainAt(n, 20), trainAt(n, 50)]) : undefined);
const full = (patch: Partial<ViewCtx['settings']> = {}) => settingsWith(FOUR, { seenVersion: '1.3.0', stations: [STATIONS.braine], lines: [LINES.w], ...patch });
const HOME_TAIL = ['Gares de train   1 gare', 'Lignes de bus, tram, métro   1 ligne', 'Arrêts de bus, tram, métro   à choisir'];
const ready = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l)) && s.lines.includes('Autour de moi   9 arrêts');
/** Ligne de l'élément sous le curseur (accueil sans ligne du haut : sans la ligne vide ni l'aide des gestes). */
const selected = (s: Screen): string => s.lines.filter((l) => l !== '' && !l.startsWith('△▽'))[s.sel];

describe('PRD-1.3.1 § 8 : le curseur à l’ouverture de Quai, le retour à l’accueil, le réglage « À l’ouverture de Quai »', () => {
  it('à l’ouverture, le curseur sur « Autour de moi » (aussi les 7 premiers jours, avec l’aide des gestes) ; un toucher l’ouvre', async () => {
    const h = await setup({ now: NOW, settings: full(), core: (now) => stubCore(now, { answers: answersDay, board }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3);
    expect(s.lines).toEqual(['Autour de moi   9 arrêts', 'Favoris   4', 'Bureau   maintenant → 21:34', 'Parc   dans 4 min → 21:58', 'École   21:07 → 21:37', '', ...HOME_TAIL]);
    expect(s.sel).toBe(0);
    expect(selected(s)).toBe('Autour de moi   9 arrêts');
    // la rangée du curseur, entière : la 1re de la liste
    expect(rowsOf(h.sent().find((c) => c.name === 'cursor')!)).toEqual(['▶']);
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'nearby')).screen).toBe('nearby');
    h.c.stop();
    // nouvelle installation : l'aide des gestes (7 premiers jours) ne change pas le curseur
    const f = await setup({ now: NOW, settings: full({ seenVersion: '' }), core: (now) => stubCore(now, { answers: answersDay, board }) });
    const fs = await f.until((x) => ready(x) && x.shown?.length === 3);
    expect(fs.lines.at(-1)).toBe('△▽ choisir   toucher : ouvrir   double : quitter');
    expect(selected(fs)).toBe('Autour de moi   9 arrêts');
    f.c.stop();
  });

  it('le retour à l’accueil garde son curseur, comme en 1.3.0 : sur la rubrique ou le favori ouvert', async () => {
    const h = await setup({ now: NOW, settings: full(), core: (now) => stubCore(now, { answers: answersDay, board }) });
    await h.until((x) => ready(x) && x.shown?.length === 3);
    // « Favoris », ses trois favoris, puis « Gares de train » (la ligne vide ne se sélectionne pas)
    await h.gesture('down', 'down', 'down', 'down', 'down');
    expect(selected(h.last())).toBe('Gares de train   1 gare');
    await h.gesture('tap');
    await h.until((x) => x.screen === 'stations');
    await h.gesture('double');
    expect(selected(await h.until(ready))).toBe('Gares de train   1 gare');
    // ▲▲ : Parc ; ses étapes, puis retour : le curseur reste sur Parc
    await h.gesture('up', 'up');
    expect(selected(h.last())).toMatch(/^Parc {3}/);
    await h.gesture('tap');
    expect((await h.until((x) => x.screen === 'steps')).title).toBe('Parc');
    await h.gesture('double');
    expect(selected(await h.until(ready))).toMatch(/^Parc {3}/);
    h.c.stop();
  });

  it('un trajet suivi : au retour, « En cours » en tête et le curseur dessus ; un toucher reprend le trajet', async () => {
    const h = await setup({ now: NOW, settings: full(), core: (now) => stubCore(now, { answers: answersDay, board }) });
    await h.until((x) => ready(x) && x.shown?.length === 3);
    const j = door('j-bureau', NOW, NOW + 47 * MIN);
    await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, favoriteId: 'fav-bureau', result: { journeys: [j] }, index: 0 });
    await h.until((s) => s.screen === 'steps' && s.followed === true);
    await h.gesture('double');
    const home = await h.until((s) => ready(s) && s.lines[0].startsWith('En cours'));
    expect(home.lines.slice(1, 3)).toEqual(['Autour de moi   9 arrêts', 'Favoris   4']);
    expect(home.lines.some((l) => l.startsWith('Bureau'))).toBe(false);
    expect(home.sel).toBe(0);
    await h.gesture('tap');
    expect(await h.until((s) => s.screen !== 'home')).toMatchObject({ screen: 'steps', followed: true });
    h.c.stop();
  });

  it('« À l’ouverture de Quai » garde son effet : premier favori, accueil sans favoris, gare « près » ouverte d’office', async () => {
    const display = settingsWith([]).display;
    // « Directement mon premier favori » : ses étapes ; double toucher : l'accueil, pas encore touché, curseur sur
    // « Autour de moi » (règle d'ouverture)
    const a = await setup({ now: NOW, settings: full({ display: { ...display, opening: 'firstFavorite' } }), core: (now) => stubCore(now, { answers: answersDay, board }) });
    expect((await a.until((x) => x.screen === 'steps')).title).toBe('Bureau');
    expect(a.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'steps']);
    await a.gesture('double');
    expect(selected(await a.until(ready))).toBe('Autour de moi   9 arrêts');
    a.c.stop();
    // « L’accueil, sans favoris » : « Favoris   4 » sans favori dessous, « Près de … » en haut ; curseur sur « Autour de moi »
    const b = await setup({ now: NOW, settings: full({ display: { ...display, opening: 'home' } }), core: (now) => stubCore(now, { answers: answersDay, board }) });
    const home = await b.until((x) => x.screen === 'home' && x.lines[0] === 'Près de Arrêt 1' && x.lines.includes('Autour de moi   9 arrêts'));
    expect(home.lines).toEqual(['Près de Arrêt 1', 'Autour de moi   9 arrêts', 'Favoris   4', '', ...HOME_TAIL]);
    expect(home.shown).toEqual([]);
    expect(home.sel).toBe(0);
    b.c.stop();
    // « L’accueil, avec mes favoris » : une gare gardée « près », à moins de 300 m, ouvre ses départs d'office ;
    // double toucher : l'accueil, curseur sur « Autour de moi »
    const atStation = { lat: STATIONS.braine.lat, lon: STATIONS.braine.lon };
    const c = await setup({ now: NOW, pos: atStation, settings: full({ stations: [{ ...STATIONS.braine, near: true }] }), core: (now) => stubCore(now, { answers: answersDay, board }) });
    await c.until((x) => x.screen === 'board');
    expect(c.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'board']);
    await c.gesture('double');
    expect(selected(await c.until(ready))).toBe('Autour de moi   9 arrêts');
    c.c.stop();
  });
});

/* ------------------------------ B15 : le « ! » d'un favori ------------------------------ */

describe('B15 (U2) : le « ! » d’un favori à souci sur l’accueil, la même règle que « Favoris »', () => {
  const leave = NOW + 4 * MIN;
  const arr = at(DAY, 21, 58);
  const works = { kind: 'works' as const, text: 'Travaux : ligne 124', at: NOW };
  const cases: [string, FavoriteAnswer | undefined, boolean][] = [
    ['voie modifiée', ok(PLACES.bureau, train('a', leave, arr, { newPlatform: '6' })), true],
    ['premier train supprimé', ok(PLACES.bureau, train('b', leave, arr, { cancelled: true })), true],
    ['travaux sur le trajet', ok(PLACES.bureau, { ...train('c', leave, arr), alerts: [works] }), true],
    ['retard seul', ok(PLACES.bureau, train('d', leave, arr, { delayMin: 5, dep: leave + 10 * MIN })), false],
    ['rien à signaler', ok(PLACES.bureau, train('e', leave, arr)), false],
    ['tu y es', here(PLACES.bureau), false],
    ['en calcul', undefined, false],
  ];
  for (const [name, answer, trouble] of cases) {
    it(`${name} : ${trouble ? '« Bureau ! »' : 'pas de « ! »'}, comme dans « Favoris »`, () => {
      const e: FavoriteEntry = { fav: PLACES.bureau, answer };
      const ctx = ctxAt(NOW, FOUR);
      expect(favoriteTrouble(answer, NOW)).toBe(trouble);
      expect(homeFavoriteItem(e, ctx).b).toBe(trouble ? `Bureau${TROUBLE_MARK}` : 'Bureau');
      // la règle de « Favoris » (favoriteItem), la même marque
      expect(favoriteItem(e, ctx).item.a.endsWith(TROUBLE_MARK)).toBe(trouble);
      const row = lines(homeView({ favorites: [e], nearbyCount: 9, gestureHelp: false }, ctx))[2];
      expect(row.startsWith(trouble ? 'Bureau !   ' : 'Bureau   ')).toBe(true);
    });
  }

  it('un arrêt favori (réglages d’avant la 1.2.2) : voie modifiée ou départ supprimé, « ! » ; un retard, rien', () => {
    const stop = (d: Departure): FavoriteAnswer => ({ favoriteId: PLACES.gare.id, kind: 'stop', state: 'ok', board: boardOf('sncb:8814266', 'Braine-l’Alleud', [d]), updatedAt: NOW });
    const mark = (d: Departure) => homeFavoriteItem({ fav: PLACES.gare, answer: stop(d) }, ctxAt(NOW, [PLACES.gare])).b!.endsWith(TROUBLE_MARK);
    expect(mark(trainAt(NOW, 21, { newPlatform: '12' }))).toBe(true);
    expect(mark(trainAt(NOW, 21, { cancelled: true }))).toBe(true);
    expect(mark(trainAt(NOW, 21, { delayMin: 4 }))).toBe(false);
  });

  it('nom long : coupé entre deux mots avant le « ! », jamais l’inverse ; la réponse entière ; tout au pixel', () => {
    const long: Favorite = { kind: 'place', id: 'fav-long', label: 'Bibliothèque communale de Woluwe-Saint-Lambert', lat: 50.84, lon: 4.42, propose: 'never' };
    const j = train('l', at(TOMORROW, 6, 20), at(TOMORROW, 6, 46), { newPlatform: '6' });
    const v = homeView({ favorites: [{ fav: long, answer: ok(long, j) }], nearbyCount: 9, gestureHelp: false }, ctxAt(NOW, [long]));
    const row = lines(v)[2];
    const m = /^(.+)… !   demain 06:20 → 06:46$/.exec(row);
    expect(m, row).not.toBeNull();
    const head = m![1];
    // le début du nom, coupé au mot (ou après un morceau entier d'un nom composé)
    expect(long.label.startsWith(head)).toBe(true);
    expect(head.endsWith('-') || long.label[head.length] === ' ').toBe(true);
    for (const r of rowsOf(container(page(v), 'colB'))) expect(textWidth(r)).toBeLessThanOrEqual(WIDTHS.homeRow);
    // sans souci, la même ligne sans « ! »
    const plain = homeView({ favorites: [{ fav: long, answer: ok(long, train('m', at(TOMORROW, 6, 20), at(TOMORROW, 6, 46))) }], nearbyCount: 9, gestureHelp: false }, ctxAt(NOW, [long]));
    expect(lines(plain)[2]).toMatch(/^Bibliothèque communale.*…   demain 06:20 → 06:46$/);
  });
});

/* ------------------------------ B20 : les favoris du soir ------------------------------ */

describe('B20 (U8) : le soir, les favoris avec « demain » plutôt que « Favoris » vide', () => {
  const toNamur: Favorite = { kind: 'trip', id: 'fav-namur', from: area(STATIONS.braine), to: area(STATIONS.namur), propose: 'never' };
  const toNord: Favorite = { kind: 'trip', id: 'fav-nord', from: area(STATIONS.namur), to: area(STATIONS.nord), propose: 'never' };
  const S = settingsWith([PLACES.bureau, PLACES.parc, PLACES.ecole, toNamur, toNord, PLACES.maison], { seenVersion: '1.3.0', stations: [STATIONS.braine], lines: [LINES.w] });
  /**
   * Réponses à 22:40 : Maison « tu y es », Bureau « aucun trajet », les autres demain 05:52 → 06:46 ; `soon` : ce favori
   * part encore ce soir (23:10 → 23:58).
   */
  const night =
    (soon?: string) =>
    (fav: Favorite, now: number): FavoriteAnswer | undefined => {
      if (fav.id === 'fav-maison') return here(fav, now);
      if (fav.id === 'fav-bureau') return { favoriteId: fav.id, kind: 'trip', state: 'none', plan: { journeys: [] }, updatedAt: now };
      if (fav.id === soon) return ok(fav, door(`j-${fav.id}`, NIGHT + 30 * MIN, NIGHT + 78 * MIN), now);
      return ok(fav, door(`j-${fav.id}`, at(TOMORROW, 5, 52), at(TOMORROW, 6, 46)), now);
    };

  it('aucun favori dans les 3 heures : jusqu’à 3 favoris « demain 05:52 → 06:46 », dans l’ordre ; jamais « tu y es » ni « aucun trajet »', async () => {
    const h = await setup({ now: NIGHT, settings: S, core: (now) => stubCore(now, { answers: night(), board }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3 && x.lines.some((l) => l.startsWith('Vers Namur')));
    expect(s.lines).toEqual([
      'Autour de moi   9 arrêts',
      'Favoris   6',
      'Parc   demain 05:52 → 06:46',
      'École   demain 05:52 → 06:46',
      'Vers Namur   demain 05:52 → 06:46',
      '',
      ...HOME_TAIL,
    ]);
    expect(s.shown).toEqual(['fav-parc', 'fav-ecole', 'fav-namur']);
    expect(s.lines.join('\n')).not.toMatch(/tu y es|aucun trajet/);
    // le curseur reste sur « Autour de moi » ; « Favoris », puis Parc : son trajet de demain
    expect(s.sel).toBe(0);
    await h.gesture('down', 'down', 'tap');
    expect((await h.until((x) => x.screen === 'steps')).title).toBe('Parc');
    h.c.stop();
  });

  it('un favori part encore ce soir : lui seul sur l’accueil, comme en 1.2.1 ; ceux de demain restent dans « Favoris »', async () => {
    const h = await setup({ now: NIGHT, settings: S, core: (now) => stubCore(now, { answers: night('fav-ecole'), board }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 1 && x.lines.some((l) => l.startsWith('École')));
    expect(s.lines).toEqual(['Autour de moi   9 arrêts', 'Favoris   6', 'École   23:10 → 23:58', '', ...HOME_TAIL]);
    expect(s.shown).toEqual(['fav-ecole']);
    h.c.stop();
  });

  it('« L’accueil, sans favoris » : rien sous « Favoris », même le soir', async () => {
    const h = await setup({ now: NIGHT, settings: { ...S, display: { ...S.display, opening: 'home' } }, core: (now) => stubCore(now, { answers: night(), board }) });
    await h.until((x) => x.screen === 'home' && x.lines.includes('Autour de moi   9 arrêts'));
    await h.settle(150);
    const s = h.last();
    expect(s.shown).toEqual([]);
    expect(s.lines).toContain('Favoris   6');
    expect(s.lines.some((l) => l.includes('demain'))).toBe(false);
    h.c.stop();
  });
});

/* ------------------------------ L7 : « tes » ------------------------------ */

describe('L7 : les messages ★ des lunettes disent « tes », comme le téléphone', () => {
  it('« garder une ligne » depuis les départs d’un arrêt : « ★ Ajoutée à tes lignes »', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0', lines: [LINES.t3] }), core: (now) => stubCore(now) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: 'stib:6357F', name: { fr: 'Gare du Nord', nl: 'Noordstation' } });
    await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    // la ligne ★ en tête du tableau, puis le tram 4 (le tram 3 est déjà suivi)
    await h.gesture('up', 'tap');
    await h.until((x) => x.screen === 'keepLine' && x.lines.length > 1);
    await h.gesture('down', 'tap');
    expect(h.last().lines.at(-1)).toBe('★ Ajoutée à tes lignes');
    h.c.stop();
  });

  it('les trois messages tiennent sur la ligne des aides, glyphes compris (« ★ garder ce trajet » : ui/controller.test.ts)', () => {
    for (const t of ['★ Ajoutée à tes lignes', '★ Déjà dans tes favoris', '★ Trajet ajouté à tes favoris']) {
      expect(missingGlyphs(t), t).toEqual([]);
      expect(textWidth(t), t).toBeLessThanOrEqual(WIDTHS.full);
    }
  });
});
