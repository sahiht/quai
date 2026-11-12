/**
 * Quai 1.2.2, accueil des lunettes (docs/v1.2.2/PRD-1.2.2.md § 1.1 et § 1.3, REVUE-USAGE n° 1 et n° 6 ; CA-122.1) :
 * « Favoris » et leur nombre, jusqu'à 3 favoris en retrait un ton plus pâles (jamais la règle 5, jamais celui du
 * trajet en cours), ligne vide, « Autour de moi », « Gares » et « Bus, tram, métro » avec le prochain départ de
 * l'élément le plus proche, ou « à choisir ». La ligne d'aide n'existe que les 7 premiers jours ; s'il manque une
 * ligne, la ligne vide saute d'abord. Le relief et le curseur de la 1.2.1 (CA-121.5) sont gardés.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, Favorite, FavoriteAnswer, Journey } from '../../src/core/api';
import { FIRST_USE_KEY } from '../../src/glasses/controller';
import { stopHomeText, tripHomeText } from '../../src/glasses/format';
import { GEO, HOME_INDENT, LAYOUTS, WIDTHS } from '../../src/glasses/layout';
import { boardView, homeView, type FavoriteEntry, type HomeData, type ViewCtx } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { textWidth } from '../../src/glasses/font';
import { LINES, MIN, PLACES, STATIONS, at, boardOf, container, dep, journey, lineBoardOf, lines, nb, page, rowsOf, settingsWith, setup, stubCore, trainAt, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 20, 47);
const HINTS_HOME = '▲▼ choisir   toucher : ouvrir   double : quitter';

/** Trajet vers un lieu : marche, bus, marche ; départ conseillé `leave`, arrivée `arr`. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5 }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Arrêt', to: 'Gare' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
}

const tripAnswer = (fav: Favorite, j: Journey, extra: Partial<FavoriteAnswer> = {}): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: NOW, ...extra });

const train = (t: number, p: Partial<Departure> = {}): Departure => ({ op: 'sncb', mode: 'train', line: 'IC', head: { fr: 'Bruxelles-Midi', nl: 'Brussel-Zuid' }, sched: t, est: t, rt: true, delayMin: 0, cancelled: false, platform: '2', ...p });
const stopAnswer = (fav: Favorite, departures: Departure[], now = NOW): FavoriteAnswer => ({
  favoriteId: fav.id,
  kind: 'stop',
  state: 'ok',
  board: { area: { id: 'sncb:8814266', op: 'sncb', n: { fr: 'Braine-l’Alleud', nl: 'Eigenbrakel' }, lat: 50.68, lon: 4.37, modes: ['train'], lines: ['IC'] }, departures, anyPlanned: false, rtErrors: [], updatedAt: now },
  updatedAt: now,
});

/**
 * Réponses de l'accueil cible, à l'heure de la demande : Bureau « maintenant » (arrivée 47 min plus tard), Mama « dans
 * 4 min » (71 min), École à 21:07, Maison « tu y es » (règle 5, jamais sur l'accueil).
 */
function answers(fav: Favorite, now: number): FavoriteAnswer | undefined {
  if (fav.id === 'fav-bureau') return tripAnswer(fav, door('j-bureau', now, now + 47 * MIN));
  if (fav.id === 'fav-mama') return tripAnswer(fav, door('j-mama', now + 4 * MIN, now + 71 * MIN));
  if (fav.id === 'fav-ecole') return tripAnswer(fav, door('j-ecole', now + 20 * MIN, now + 50 * MIN));
  if (fav.id === 'fav-maison') return { favoriteId: fav.id, kind: 'trip', state: 'here', updatedAt: now };
  return undefined;
}

/** Gare de Braine-l'Alleud : IC dans 20 min, voie 1 ; W à Merbraine : dans 4 min, puis dans 9 min dans l'autre sens. */
const sections = (calls?: string[]) => ({
  calls,
  board: (id: string, n: number) => (id === STATIONS.braine.areaId ? boardOf(id, 'Braine-l’Alleud', [trainAt(n, 20), trainAt(n, 50)]) : undefined),
  lineBoard: (id: string, _line: string, n: number) =>
    id === LINES.w.areaId ? lineBoardOf(id, 'Braine-l’Alleud Merbraine', 'W', [{ head: 'Bruxelles Midi', departures: [dep(n, 4), dep(n, 18)] }, { head: 'Braine-l’Alleud Gare', departures: [dep(n, 9)] }]) : undefined,
});

const FOUR = [PLACES.maison, PLACES.bureau, PLACES.mama, PLACES.ecole];
const full = (patch = {}) => settingsWith(FOUR, { stations: [STATIONS.braine], lines: [LINES.w], ...patch });
const ready = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l)) && s.lines.includes('Autour de moi   9 arrêts');
const HOME = ['Favoris   4', 'Bureau   maintenant → 21:34', 'Mama   dans 4 min → 21:58', 'École   21:07 → 21:37', '', 'Autour de moi   9 arrêts', 'Gares   IC 21:07 voie 1', 'Bus, tram, métro   W 4 min'];

describe('CA-122.1 : l’accueil dans l’ordre du § 1.1, 3 favoris tenus', () => {
  it('« Favoris   4 », 3 favoris en retrait, ligne vide, « Autour de moi », « Gares » et « Bus, tram, métro » ; « Aller à… » n’existe plus', async () => {
    const h = await setup({ now: NOW, settings: full({ seenVersion: '1.2.3' }), core: (now) => stubCore(now, { answers, ...sections() }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3 && x.lines.at(-1) === 'Bus, tram, métro   W 4 min');
    expect(s.title).toBe('Quai');
    // Quai déjà utilisé (mise à jour) : pas d'aide des gestes, pas de pied du tout (9 lignes sous le titre)
    expect(s.lines).toEqual(HOME);
    expect(s.shown).toEqual(['fav-bureau', 'fav-mama', 'fav-ecole']);
    // curseur sur le premier favori montré : un toucher ouvre le trajet le plus probable
    expect(s.sel).toBe(1);
    expect(s.lines.join('\n')).not.toMatch(/Aller à|horaire prévu|~/);
    // pied vide : 1 px, toujours 8 conteneurs ; la liste a 9 lignes
    const foot = h.sent().find((c) => c.name === 'foot')!;
    expect(foot).toMatchObject({ h: 1, y: 288 - GEO.BOTTOM_MARGIN });
    expect(foot.content.trim()).toBe('');
    expect(h.sent().find((c) => c.name === 'colA')!.h).toBe(9 * 27);
    h.c.stop();
  });

  it('relief de la 1.2.1 : titres et textes de droite au plus clair, favoris en retrait au niveau 2', async () => {
    const h = await setup({ now: NOW, settings: full({ seenVersion: '1.2.3' }), core: (now) => stubCore(now, { answers, ...sections() }) });
    await h.until((x) => ready(x) && x.shown?.length === 3 && x.lines.at(-1) === 'Bus, tram, métro   W 4 min');
    const cs = h.sent();
    const by = (n: string) => cs.find((c) => c.name === n)!;
    expect(rowsOf(by('colA'))).toEqual(['Favoris', '', '', '', '', 'Autour de moi', 'Gares', 'Bus, tram, métro']);
    expect(by('colA')).toMatchObject({ x: GEO.X_TEXT, level: 4 });
    expect(rowsOf(by('colC')).map((l) => l.trim())).toEqual(['4', '', '', '', '', '9 arrêts', 'IC 21:07 voie 1', 'W 4 min']);
    expect(by('colC').level).toBe(4);
    const favs = rowsOf(by('colB'));
    expect(favs.slice(1, 4).map((l) => l.replace(/ {2,}/g, ' | '))).toEqual(['Bureau | maintenant → 21:34', 'Mama | dans 4 min → 21:58', 'École | 21:07 → 21:37']);
    expect(by('colB')).toMatchObject({ x: GEO.X_TEXT + HOME_INDENT, level: 2 });
    // les textes de droite des rubriques finissent au bord, comme les nombres et les réponses des favoris
    const edge = (c: { x: number }, line: string) => c.x + textWidth(line);
    const colC = by('colC').content.split('\n');
    for (const k of [0, 6, 7]) expect(Math.abs(edge(by('colC'), colC[k]) - edge(by('colC'), colC[0]))).toBeLessThanOrEqual(5);
    expect(LAYOUTS.home.b.level).toBe(2);
    expect(rowsOf(by('cursor'))).toEqual(['', '▶']);
    h.c.stop();
  });

  it('toucher « Gares » et « Bus, tram, métro » ouvre leur écran ; la ligne vide ne se sélectionne pas', async () => {
    const h = await setup({ now: NOW, settings: full({ seenVersion: '1.2.3' }), core: (now) => stubCore(now, { answers, ...sections() }) });
    await h.until((x) => ready(x) && x.shown?.length === 3);
    // École, puis « Autour de moi » (la ligne vide est sautée), « Gares », « Bus, tram, métro »
    await h.gesture('down', 'down', 'down');
    expect(h.last().sel).toBe(4);
    await h.gesture('down', 'tap');
    expect((await h.until((x) => x.screen === 'stations')).title).toBe('Gares');
    await h.gesture('double');
    await h.until(ready);
    await h.gesture('down', 'tap');
    expect((await h.until((x) => x.screen === 'lines')).title).toBe('Bus, tram, métro');
    h.c.stop();
  });

  it('§ 1.3 : rubriques vides, « à choisir » ; toucher : « Choisis tes gares dans Quai, sur le téléphone » à la place du titre, sans pousser de ligne', async () => {
    // aide des gestes passée : l'accueil n'a pas de ligne de pied ; une ligne ajoutée ferait sortir la dernière (revue)
    const kv = createKV(memoryBackend());
    await kv.set(FIRST_USE_KEY, String(NOW - 8 * 86_400_000));
    const h = await setup({ now: NOW, kv, settings: settingsWith(FOUR, { seenVersion: '1.2.3' }), core: (now) => stubCore(now, { answers }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3);
    expect(s.lines.slice(-2)).toEqual(['Gares   à choisir', 'Bus, tram, métro   à choisir']);
    expect(s.title).toBe('Quai');
    await h.gesture('down', 'down', 'down', 'down', 'tap');
    expect(h.last()).toMatchObject({ screen: 'home', title: 'Choisis tes gares dans Quai, sur le téléphone', lines: s.lines });
    await h.gesture('down', 'tap');
    expect(h.last()).toMatchObject({ screen: 'home', title: 'Choisis tes lignes dans Quai, sur le téléphone', lines: s.lines });
    // tient sur la ligne du titre, avec l'heure ; 2,6 s plus tard, « Quai » revient
    expect(textWidth('Choisis tes lignes dans Quai, sur le téléphone')).toBeLessThanOrEqual(WIDTHS.title);
    expect(nb(h.sent().find((c) => c.name === 'title')?.content ?? '')).toBe('Choisis tes lignes dans Quai, sur le téléphone');
    expect(h.sent().find((c) => c.name === 'foot')?.content.trim()).toBe('');
    h.advance(2_600);
    await h.c.refreshCurrent();
    expect(h.last()).toMatchObject({ title: 'Quai', lines: s.lines });
    h.c.stop();
  });

  it('§ 1.3, Quai Web : le toucher ouvre directement l’ajout dans l’onglet Réglages (#/gares/ajouter, #/lignes/ajouter)', async () => {
    const opened: string[] = [];
    const h = await setup({ now: NOW, web: true, opened, settings: settingsWith(FOUR, { seenVersion: '1.2.3' }), core: (now) => stubCore(now, { answers }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3);
    expect(s.lines.slice(-2)).toEqual(['Gares   à choisir', 'Bus, tram, métro   à choisir']);
    await h.gesture('down', 'down', 'down', 'down', 'tap', 'down', 'tap');
    expect(opened).toEqual(['#/gares/ajouter', '#/lignes/ajouter']);
    expect(h.last().title).toBe('Quai');
    h.c.stop();
  });

  it('REVUE-USAGE n° 6 : la gare et la ligne les plus proches, une requête par rubrique et par rafraîchissement', async () => {
    const calls: string[] = [];
    const far = { ...STATIONS.namur };
    const h = await setup({ now: NOW, settings: full({ seenVersion: '1.2.3', stations: [far, STATIONS.braine] }), core: (now) => stubCore(now, { answers, ...sections(calls) }) });
    const s = await h.until((x) => ready(x) && x.lines.at(-2) === 'Gares   IC 21:07 voie 1');
    // Namur est en tête de liste, mais Braine-l'Alleud est la plus proche de la position (Maison)
    expect(s.lines.at(-2)).toBe('Gares   IC 21:07 voie 1');
    expect(calls.filter((c) => c.startsWith('board:'))).toEqual([`board:${STATIONS.braine.areaId}`]);
    expect(calls.filter((c) => c.startsWith('lineBoard:'))).toEqual([`lineBoard:${LINES.w.areaId}:W`]);
    calls.length = 0;
    h.advance(30_000);
    await h.c.refreshCurrent();
    await h.settle(60);
    expect(calls.filter((c) => c.startsWith('board:') || c.startsWith('lineBoard:'))).toEqual([`board:${STATIONS.braine.areaId}`, `lineBoard:${LINES.w.areaId}:W`]);
    h.c.stop();
    // sans position : la première de la liste
    const n = await setup({ now: NOW, pos: null, settings: full({ seenVersion: '1.2.3', stations: [far, STATIONS.braine] }), core: (now) => stubCore(now, { answers, ...sections() }) });
    await n.until((x) => x.screen === 'home' && x.lines.includes('Autour de moi   sans position'));
    await n.settle(80);
    expect(n.last().lines.find((l) => l.startsWith('Gares'))).toMatch(/^Gares {3}IC \d\d:\d\d/);
    n.c.stop();
  });

  it('« … » pendant le calcul, « aucun départ » sans rien dans l’horizon des tableaux', () => {
    const ctx = ctxAt(NOW, FOUR, { stations: [STATIONS.braine], lines: [LINES.w] });
    const v = homeView({ favorites: [], nearbyCount: 9, gestureHelp: false }, ctx);
    expect(lines(v).slice(-2)).toEqual(['Gares   …', 'Bus, tram, métro   …']);
    const none = homeView({ favorites: [], nearbyCount: 9, gestureHelp: false, stationsNext: { text: 'aucun départ' }, linesNext: { text: 'aucun départ' } }, ctx);
    expect(lines(none).slice(-2)).toEqual(['Gares   aucun départ', 'Bus, tram, métro   aucun départ']);
  });
});

/* ------------------------------ Vues ------------------------------ */

const ctxAt = (now: number, favorites: Favorite[], patch: Partial<ViewCtx['settings']> = {}, ctx: Partial<ViewCtx> = {}): ViewCtx => ({ now, settings: settingsWith(favorites, patch), ...ctx });
/** Favori lieu qui part dans `leave` minutes et arrive dans `arr` minutes. */
const placeIn = (fav: Favorite, now: number, leave: number, arr: number): FavoriteEntry => ({ fav, answer: tripAnswer(fav, door(`j-${fav.id}`, now + leave * MIN, now + arr * MIN)) });

describe('REVUE-USAGE n° 1 : 3 favoris dans les situations de la revue, jamais de défilement', () => {
  const extra: Favorite = { kind: 'place', id: 'fav-autre', label: 'Piscine', lat: 50.7, lon: 4.4, propose: 'never' };
  const four = (now: number): FavoriteEntry[] => [placeIn(PLACES.bureau, now, 0, 47), placeIn(PLACES.mama, now, 4, 71), placeIn(PLACES.ecole, now, 20, 50), placeIn(extra, now, 30, 60)];
  const favs = [...FOUR, extra];
  const running = { title: 'Vers le bureau', next: 'IC 08:01 voie 3', favoriteId: 'fav-bureau' };
  const holiday = at('2026-11-11', 7, 31);
  const shownOf = (v: ReturnType<typeof homeView>) => v.items.filter((i) => i.b).map((i) => i.b);
  const check = (v: ReturnType<typeof homeView>) => {
    lines(v);
    expect(page(v).visible).toBe(v.items.length);
    // « Gares » et « Bus, tram, métro » toujours là, en dernier
    expect(v.items.slice(-2).map((i) => i.a)).toEqual(['Gares', 'Bus, tram, métro']);
  };

  for (const [name, now, d, want, blank] of [
    ['jour ordinaire, après 7 jours', NOW, { gestureHelp: false }, 3, true],
    ['7 premiers jours (aide des gestes)', NOW, { gestureHelp: true }, 3, true],
    ['trajet en cours', NOW, { gestureHelp: false, running }, 3, true],
    ['ligne du haut', NOW, { gestureHelp: false, notice: 'Horaires de demain pas encore publiés' }, 3, true],
    ['ligne du haut et trajet en cours', NOW, { gestureHelp: false, notice: 'Horaires de demain pas encore publiés', running }, 3, false],
    ['jour férié, 7 premiers jours', holiday, { gestureHelp: true }, 3, false],
    ['jour férié et trajet en cours', holiday, { gestureHelp: false, running }, 3, false],
    ['ligne du haut, trajet en cours, jour férié et aide des gestes', holiday, { gestureHelp: true, running, notice: 'Horaires de demain pas encore publiés' }, 1, false],
  ] as const) {
    it(`${name} : ${want} favori${want > 1 ? 's' : ''}${blank ? ', ligne vide' : ', la ligne vide saute d’abord'}`, () => {
      const v = homeView({ favorites: four(now), nearbyCount: 9, ...d }, ctxAt(now, favs, { stations: [STATIONS.braine], lines: [LINES.w] }));
      check(v);
      expect(shownOf(v)).toHaveLength(want);
      expect(v.items.find((i) => i.a === 'Autour de moi')?.gap ?? false).toBe(blank);
      // le favori du trajet en cours n'est pas répété sous « En cours »
      if ('running' in d) expect(shownOf(v)).not.toContain('Bureau');
    });
  }

  it('« En cours » remplace la ligne de son favori : « En cours : vers le bureau », pas de « Bureau » dessous', () => {
    const v = homeView({ favorites: four(NOW), nearbyCount: 9, gestureHelp: false, running }, ctxAt(NOW, favs));
    expect(lines(v).slice(0, 5)).toEqual(['En cours : vers le bureau   IC 08:01 voie 3', 'Favoris   5', 'Mama   dans 4 min → 21:58', 'École   21:07 → 21:37', 'Piscine   21:17 → 21:47']);
    expect(v.items[0].action).toEqual({ kind: 'resume' });
  });

  it('un jour férié : « Jour férié : horaires du dimanche » en dernière ligne, pâle (CA-121.7) ; le 12/11 rien', () => {
    const v = homeView({ favorites: four(holiday), nearbyCount: 9, gestureHelp: false }, ctxAt(holiday, favs));
    const l = lines(v);
    expect(l.at(-1)).toBe('Jour férié : horaires du dimanche');
    expect(l.at(-2)).toBe('Bus, tram, métro   à choisir');
    const foot = container(page(v), 'foot');
    expect({ ...foot, content: nb(foot.content) }).toMatchObject({ content: 'Jour férié : horaires du dimanche', level: 2, y: 288 - GEO.BOTTOM_MARGIN - 27, h: 27 });
    expect(lines(homeView({ favorites: four(NOW), nearbyCount: 9, gestureHelp: false }, ctxAt(NOW, favs))).some((x) => x.startsWith('Jour férié'))).toBe(false);
  });

  it('aucun favori : « Ajouter un favori » à la place du bloc ; « Accueil sans favoris » : « Favoris   n » seul', () => {
    const none = homeView({ nearbyCount: 3, near: 'Braine-l’Alleud', gestureHelp: false }, ctxAt(NOW, []));
    expect(lines(none)).toEqual(['Près de Braine-l’Alleud', 'Ajouter un favori', '', 'Autour de moi   3 arrêts', 'Gares   à choisir', 'Bus, tram, métro   à choisir']);
    expect(none.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    const plain = homeView({ noFavorites: true, favorites: four(NOW), nearbyCount: 3, near: 'Braine-l’Alleud', gestureHelp: false }, ctxAt(NOW, favs));
    expect(lines(plain).slice(0, 3)).toEqual(['Près de Braine-l’Alleud', 'Favoris   5', '']);
    expect(lines(homeView({ favorites: [], noPosition: true, gestureHelp: false }, ctxAt(NOW, FOUR)))).toContain('Autour de moi   sans position');
  });

  it('curseur à l’ouverture : sur « En cours » s’il y est, sinon sur le premier favori montré, sinon la 1re ligne', () => {
    const ctx = ctxAt(NOW, FOUR);
    expect(homeView({ favorites: [placeIn(PLACES.bureau, NOW, 0, 47)], nearbyCount: 9 }, ctx).initialSel).toBe(1);
    expect(homeView({ favorites: [placeIn(PLACES.mama, NOW, 0, 47)], nearbyCount: 9, running }, ctx).initialSel).toBeUndefined();
    expect(homeView({ favorites: [], nearbyCount: 9 }, ctx).initialSel).toBeUndefined();
    expect(page(homeView({ favorites: [placeIn(PLACES.bureau, NOW, 0, 47)], nearbyCount: 9 }, ctx)).sel).toBe(1);
  });

  it('temps réel absent : la ligne du haut de l’accueil sans « ~ » ; les départs gardent la leur', () => {
    const d: HomeData = { favorites: [placeIn(PLACES.bureau, NOW, 0, 47)], nearbyCount: 9, gestureHelp: false };
    expect(lines(homeView(d, ctxAt(NOW, FOUR, {}, { rt: 'down' })))[0]).toBe('Temps réel indisponible : horaires prévus');
    expect(lines(homeView(d, ctxAt(NOW, FOUR, {}, { rt: 'offline' })))[0]).toBe('Pas de réseau : horaires prévus');
    expect(lines(homeView(d, ctxAt(NOW, FOUR, {}, { rt: 'ok' })))[0]).toBe('Favoris   4');
    const area = { id: 'stib:1', op: 'stib' as const, n: { fr: 'Madou', nl: 'Madou' }, lat: 0, lon: 0, modes: ['metro' as const], lines: ['2'] };
    const board = boardView({ area, departures: [], anyPlanned: false, rtErrors: ['stib'], updatedAt: NOW }, ctxAt(NOW, FOUR, {}, { rt: 'down' }), { kept: false });
    expect(lines(board)).toContain('Temps réel indisponible : horaires prévus ~');
  });
});

describe('aide des gestes les 7 premiers jours, Quai Web', () => {
  it('aide des gestes de l’accueil les 7 premiers jours seulement (date du premier lancement hors des réglages)', async () => {
    const kv = createKV(memoryBackend());
    const fresh = full({ seenVersion: '' });
    const day0 = await setup({ now: NOW, settings: fresh, kv, core: (now) => stubCore(now, { answers, ...sections() }) });
    const s0 = await day0.until((x) => ready(x) && x.shown?.length === 3 && x.lines.at(-2) === 'Bus, tram, métro   W 4 min');
    // aide des gestes : une ligne de pied ; les 3 favoris tiennent
    expect(s0.lines).toEqual([...HOME, HINTS_HOME]);
    expect(await kv.get(FIRST_USE_KEY)).toBe(String(NOW));
    expect(JSON.stringify(day0.settings.get())).not.toContain(String(NOW));
    day0.c.stop();
    const day8 = await setup({ now: NOW + 8 * 86_400_000, settings: day0.settings.get(), kv, core: (now) => stubCore(now, { answers, ...sections() }) });
    const s8 = await day8.until((x) => ready(x) && x.shown?.length === 3);
    expect(s8.lines.some((l) => l.startsWith('▲▼'))).toBe(false);
    // du premier favori : Mama, École, puis « Autour de moi », qui garde son aide
    await day8.gesture('down', 'down', 'down', 'tap');
    expect((await day8.until((x) => x.screen === 'nearby')).lines.at(-1)).toBe('▲▼ arrêt   toucher : départs   double : retour');
    day8.c.stop();
  });

  it('Quai Web : pas de « double : quitter », et le double toucher ne dit rien', async () => {
    const h = await setup({ now: NOW, web: true, settings: full({ seenVersion: '' }), core: (now) => stubCore(now, { answers, ...sections() }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3);
    expect(s.lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir');
    await h.gesture('double');
    await h.settle(60);
    expect(h.last().lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir');
    expect(h.calls.some((x) => x.op === 'exit')).toBe(false);
    h.c.stop();
  });
});

describe('une ligne par favori : départ conseillé puis arrivée (PRD-1.2.1 § 4.3, inchangé)', () => {
  const t = (leave: number, arr: number, extra: Partial<FavoriteAnswer> = {}) => tripHomeText(tripAnswer(PLACES.bureau, door('j', leave, arr), extra), NOW);

  it('lieu ou trajet : « maintenant », « dans 4 min », l’heure, un autre jour ; sans « ~ »', () => {
    expect(nb(t(NOW, at(DAY, 21, 34)))).toBe('maintenant → 21:34');
    expect(nb(t(NOW + 4 * MIN, at(DAY, 21, 34)))).toBe('dans 4 min → 21:34');
    expect(nb(t(at(DAY, 22, 10), at(DAY, 23, 5)))).toBe('22:10 → 23:05');
    expect(nb(t(at('2026-11-13', 6, 20), at('2026-11-13', 6, 46)))).toBe('demain 06:20 → 06:46');
    expect(textWidth(t(at('2026-11-13', 6, 20), at('2026-11-13', 6, 46)))).toBeLessThanOrEqual(WIDTHS.wideRight);
  });

  it('arrêt (aperçus et réglages d’avant la 1.2.2) : « IC 21:08 voie 2 », sans « ~ » ; voie modifiée, demain, dernier', () => {
    const s = (deps: Departure[]) => stopHomeText(stopAnswer(PLACES.gare, deps), NOW);
    expect(s([train(at(DAY, 21, 8))])).toEqual({ text: 'IC 21:08 voie 2' });
    expect(nb(s([train(at(DAY, 21, 8), { rt: false })]).text)).toBe('IC 21:08 voie 2');
    expect(nb(s([train(at(DAY, 21, 8), { delayMin: 12, newPlatform: '12' })]).text)).toBe('IC 21:08 +12 voie 12 !');
    expect(s([train(at('2026-11-13', 6, 20))]).text).toBe('IC demain 06:20');
    expect(s([]).text).toBe('aucun départ');
  });

  it('largeurs : noms longs coupés dans leur colonne, réponses entières, rubriques entières', () => {
    const long: Favorite = { kind: 'place', id: 'fav-long', label: 'Chez la grand-mère de Louisa à Woluwe', lat: 50.84, lon: 4.42, propose: 'never' };
    const v = homeView(
      { favorites: [{ fav: long, answer: tripAnswer(long, door('j-l', at('2026-11-13', 6, 20), at('2026-11-13', 6, 46))) }], nearbyCount: 9, gestureHelp: false, stationsNext: { text: 'IC 21:08 +12 v.12 !' }, linesNext: { text: 'T3 imminent', tail: ', dernier' } },
      ctxAt(NOW, [long], { stations: [STATIONS.braine], lines: [LINES.t3] }),
    );
    const l = lines(v);
    expect(l[1]).toMatch(/^Chez la grand-mère.*…   demain 06:20 → 06:46$/);
    expect(l.slice(-2)).toEqual(['Gares   IC 21:08 +12 v.12 !', 'Bus, tram, métro   T3 imminent, dernier']);
    for (const row of rowsOf(container(page(v), 'colB'))) expect(textWidth(row)).toBeLessThanOrEqual(WIDTHS.homeRow);
  });
});
