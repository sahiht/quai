/**
 * Quai 1.2.1, accueil des lunettes (docs/v1.2.1/PRD-1.2.1.md § 4, § 5 côté lunettes) : « Favoris » et leur nombre,
 * favoris en retrait un ton plus pâles sur une ligne chacun (jamais la règle 5), ligne vide, outils ; aucun pied ;
 * aide des gestes les 7 premiers jours ; jour férié en dernière ligne pâle. CA-121.5 et CA-121.7.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, Favorite, FavoriteAnswer, Journey } from '../../src/core/api';
import { FIRST_USE_KEY } from '../../src/glasses/controller';
import { stopHomeText, tripHomeText } from '../../src/glasses/format';
import { GEO, HOME_INDENT, LAYOUTS, WIDTHS } from '../../src/glasses/layout';
import { boardView, homeView, type FavoriteEntry, type HomeData, type ViewCtx } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { textWidth } from '../../src/glasses/font';
import { MIN, PLACES, at, container, journey, lines, nb, page, rowsOf, settingsWith, setup, stubCore, type Screen } from './helpers';

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
 * Réponses du cas CA-121.5, à l'heure de la demande : Bureau « maintenant » (arrivée 47 min plus tard), Mama « dans
 * 4 min » (71 min), Maison « tu y es », gare : rien avant 9 h 25 (le lendemain matin à 20:47).
 */
function ca1215Answers(fav: Favorite, now: number): FavoriteAnswer | undefined {
  if (fav.id === 'fav-bureau') return tripAnswer(fav, door('j-bureau', now, now + 47 * MIN));
  if (fav.id === 'fav-mama') return tripAnswer(fav, door('j-mama', now + 4 * MIN, now + 71 * MIN));
  if (fav.id === 'fav-maison') return { favoriteId: fav.id, kind: 'trip', state: 'here', updatedAt: now };
  if (fav.id === 'fav-gare') return stopAnswer(fav, [train(now + 565 * MIN)], now);
  return undefined;
}

const FOUR = [PLACES.maison, PLACES.bureau, PLACES.mama, PLACES.gare];
const ready = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => l.endsWith('…') && l !== 'Aller à…') && s.lines.includes('Autour de moi   9 arrêts');

describe('CA-121.5 : accueil avec 4 favoris dont Maison (tu y es)', () => {
  it('« Favoris   4 », Bureau et Mama en retrait sur une ligne chacun, ligne vide, outils ; aucun pied', async () => {
    const h = await setup({ now: NOW, settings: settingsWith(FOUR), core: (now) => stubCore(now, { answers: ca1215Answers }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 2);
    expect(s.title).toBe('Quai');
    expect(s.lines).toEqual(['Favoris   4', 'Bureau   maintenant → 21:34', 'Mama   dans 4 min → 21:58', '', 'Autour de moi   9 arrêts', 'Aller à…', HINTS_HOME]);
    // curseur sur le premier favori montré : un toucher ouvre le trajet le plus probable
    expect(s.sel).toBe(1);
    // Maison (tu y es) et la gare (rien avant demain) : règle 5, jamais sur l'accueil
    expect(s.shown).toEqual(['fav-bureau', 'fav-mama']);
    expect(s.lines.join('\n')).not.toMatch(/horaire prévu|Autres favoris|autres favoris|FAVORIS|~/);
    h.c.stop();
  });

  it('relief : « Favoris », « Autour de moi », « Aller à… » et leurs nombres au plus clair ; favoris en retrait, nom et réponse au niveau 2', async () => {
    const h = await setup({ now: NOW, settings: settingsWith(FOUR), core: (now) => stubCore(now, { answers: ca1215Answers }) });
    await h.until((x) => ready(x) && x.shown?.length === 2);
    const cs = h.sent();
    const by = (n: string) => cs.find((c) => c.name === n)!;
    expect(rowsOf(by('colA'))).toEqual(['Favoris', '', '', '', 'Autour de moi', 'Aller à…']);
    expect(by('colA')).toMatchObject({ x: GEO.X_TEXT, level: 4 });
    // les nombres à droite, au plus clair, sans les réponses des favoris
    expect(rowsOf(by('colC')).map((l) => l.trim())).toEqual(['4', '', '', '', '9 arrêts']);
    expect(by('colC').level).toBe(4);
    // chaque favori : nom en retrait puis réponse alignée à droite, dans un même conteneur au niveau 2
    const favs = rowsOf(by('colB'));
    expect(favs[0]).toBe('');
    expect(favs.slice(1).map((l) => l.replace(/ {2,}/g, ' | '))).toEqual(['Bureau | maintenant → 21:34', 'Mama | dans 4 min → 21:58']);
    expect(by('colB')).toMatchObject({ x: GEO.X_TEXT + HOME_INDENT, level: 2 });
    // les réponses finissent au bord droit, comme les nombres (à 5 px près : espaces de 5 px)
    const rightEdge = (c: { x: number }, line: string) => c.x + textWidth(line);
    for (const row of by('colB').content.split('\n').slice(1)) expect(Math.abs(rightEdge(by('colB'), row) - rightEdge(by('colC'), by('colC').content.split('\n')[0]))).toBeLessThanOrEqual(5);
    expect(LAYOUTS.home.b.level).toBe(2);
    expect(LAYOUTS.home.a.level).toBe(4);
    // le curseur est sur Bureau
    expect(rowsOf(by('cursor'))).toEqual(['', '▶']);
    h.c.stop();
  });

  it('un toucher ouvre le premier favori ; ▲ : « Favoris », qui ouvre la liste des 4 ; ▼ saute la ligne vide', async () => {
    const h = await setup({ now: NOW, settings: settingsWith(FOUR), core: (now) => stubCore(now, { answers: ca1215Answers }) });
    expect((await h.until((x) => ready(x) && x.shown?.length === 2)).sel).toBe(1);
    await h.gesture('tap');
    const st = await h.until((x) => x.screen === 'steps');
    expect(nb(st.title)).toBe('Vers le bureau : 20:47 → 21:34');
    await h.gesture('double');
    // le trajet du bureau part maintenant : « En cours » (inchangée) au-dessus de « Favoris »
    const back = await h.until((x) => ready(x) && x.lines[0].startsWith('En cours'));
    expect(back.lines).toEqual(['En cours : vers le bureau   Bus W 20:52', 'Favoris   4', 'Bureau   maintenant → 21:34', 'Mama   dans 4 min → 21:58', '', 'Autour de moi   9 arrêts', 'Aller à…', HINTS_HOME]);
    h.c.stop();
    // ▲ depuis le premier favori : « Favoris », qui ouvre la liste de tous, dans l'ordre du cœur (règle 5 en fin)
    const g = await setup({ now: NOW, settings: settingsWith(FOUR), core: (now) => stubCore(now, { answers: ca1215Answers }) });
    await g.until((x) => ready(x) && x.shown?.length === 2);
    await g.gesture('up');
    expect(g.last().sel).toBe(0);
    await g.gesture('tap');
    const list = await g.until((x) => x.screen === 'favorites');
    expect(list.title).toBe('Mes favoris');
    expect(list.order).toEqual(['fav-bureau', 'fav-mama', 'fav-maison', 'fav-gare']);
    await g.gesture('double');
    await g.until(ready);
    // Bureau, Mama, puis « Autour de moi » (la ligne vide ne se sélectionne pas), puis « Aller à… »
    await g.gesture('down', 'down', 'down');
    expect(g.last().sel).toBe(3);
    expect(g.last().lines[g.last().sel + 1]).toBe('Autour de moi   9 arrêts');
    await g.gesture('down');
    expect(g.last().sel).toBe(4);
    expect(g.last().lines[g.last().sel + 1]).toBe('Aller à…');
    g.c.stop();
  });

  it('curseur à l’ouverture : sur « En cours » s’il y est (comme en 1.2), sur la 1re ligne sans favori montré', () => {
    const ctx = ctxAt(NOW, FOUR);
    const fav = (f: Favorite) => placeIn(f, NOW, 0, 47);
    expect(homeView({ favorites: [fav(PLACES.bureau)], nearbyCount: 9 }, ctx).initialSel).toBe(1);
    expect(homeView({ favorites: [fav(PLACES.bureau)], nearbyCount: 9, running: { title: 'Vers le bureau', next: 'Bus W 20:52' } }, ctx).initialSel).toBeUndefined();
    expect(homeView({ favorites: [], nearbyCount: 9 }, ctx).initialSel).toBeUndefined();
    expect(homeView({ noFavorites: true, favorites: [fav(PLACES.bureau)], nearbyCount: 9 }, ctx).initialSel).toBeUndefined();
    expect(page(homeView({ favorites: [fav(PLACES.bureau)], nearbyCount: 9 }, ctx)).sel).toBe(1);
  });

  it('temps réel absent : la ligne du haut de l’accueil sans « ~ » ; les autres écrans gardent la leur', () => {
    const d: HomeData = { favorites: [placeIn(PLACES.bureau, NOW, 0, 47)], nearbyCount: 9, gestureHelp: false };
    expect(lines(homeView(d, ctxAt(NOW, FOUR, { rt: 'down' })))[0]).toBe('Temps réel indisponible : horaires prévus');
    expect(lines(homeView(d, ctxAt(NOW, FOUR, { rt: 'offline' })))[0]).toBe('Pas de réseau : horaires prévus');
    expect(lines(homeView(d, ctxAt(NOW, FOUR, { rt: 'ok' })))[0]).toBe('Favoris   4');
    const area = { id: 'stib:1', op: 'stib' as const, n: { fr: 'Madou', nl: 'Madou' }, lat: 0, lon: 0, modes: ['metro' as const], lines: ['2'] };
    const board = boardView({ area, departures: [], anyPlanned: false, rtErrors: ['stib'], updatedAt: NOW }, ctxAt(NOW, FOUR, { rt: 'down' }), { isFavorite: false });
    expect(lines(board)).toContain('Temps réel indisponible : horaires prévus ~');
  });

  it('aide des gestes de l’accueil les 7 premiers jours seulement (date du premier lancement hors des réglages)', async () => {
    const kv = createKV(memoryBackend());
    const fresh = settingsWith(FOUR, { seenVersion: '' });
    const day0 = await setup({ now: NOW, settings: fresh, kv, core: (now) => stubCore(now, { answers: ca1215Answers }) });
    expect((await day0.until(ready)).lines.at(-1)).toBe(HINTS_HOME);
    expect(await kv.get(FIRST_USE_KEY)).toBe(String(NOW));
    expect(JSON.stringify(day0.settings.get())).not.toContain(String(NOW));
    day0.c.stop();
    // 6 jours plus tard : encore l'aide ; 8 jours plus tard : plus d'aide sur l'accueil, les autres écrans la gardent
    const day6 = await setup({ now: NOW + 6 * 86_400_000, settings: day0.settings.get(), kv, core: (now) => stubCore(now, { answers: ca1215Answers }) });
    expect((await day6.until(ready)).lines.at(-1)).toBe(HINTS_HOME);
    day6.c.stop();
    const day8 = await setup({ now: NOW + 8 * 86_400_000, settings: day0.settings.get(), kv, core: (now) => stubCore(now, { answers: ca1215Answers }) });
    const s8 = await day8.until((x) => ready(x) && x.shown?.length === 2);
    expect(s8.lines.at(-1)).toBe('Aller à…');
    expect(s8.lines.some((l) => l.startsWith('▲▼'))).toBe(false);
    // du premier favori : Mama, puis « Autour de moi »
    await day8.gesture('down', 'down', 'tap');
    const near = await day8.until((x) => x.screen === 'nearby');
    expect(near.lines.at(-1)).toBe('▲▼ arrêt   toucher : départs   double : retour');
    day8.c.stop();
  });

  it('mise à jour d’une version antérieure : Quai déjà utilisé, pas d’aide sur l’accueil', async () => {
    const kv = createKV(memoryBackend());
    const h = await setup({ now: NOW, settings: settingsWith(FOUR, { seenVersion: '1.2.1' }), kv, core: (now) => stubCore(now, { answers: ca1215Answers }) });
    const s = await h.until(ready);
    expect(s.lines.at(-1)).toBe('Aller à…');
    expect(await kv.get(FIRST_USE_KEY)).toBe('0');
    h.c.stop();
  });

  it('au lancement, un favori « rien dans les 3 heures » sort de l’accueil dès sa réponse ; ensuite l’accueil reste figé', async () => {
    let gareFar = false;
    const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
      fav.id === 'fav-gare' ? stopAnswer(fav, [train(gareFar ? at('2026-11-13', 6, 12) : now + 20 * MIN)], now) : ca1215Answers(fav, now);
    const h = await setup({ now: NOW, settings: settingsWith(FOUR), core: (now) => stubCore(now, { answers }) });
    const s = await h.until((x) => ready(x) && x.shown?.length === 3);
    expect(s.lines.slice(0, 4)).toEqual(['Favoris   4', 'Bureau   maintenant → 21:34', 'Mama   dans 4 min → 21:58', 'Braine-l’Alleud, train   IC 21:07 voie 2']);
    // l'utilisateur a bougé : plus rien ne change sous ses yeux, même si la gare n'a plus rien
    await h.gesture('down');
    gareFar = true;
    h.advance(30_000);
    await h.c.refreshCurrent();
    expect(h.last().shown).toEqual(['fav-bureau', 'fav-mama', 'fav-gare']);
    // nouvelle entrée dans l'accueil : la gare (règle 5) n'y est plus (Mama, la gare, puis « Autour de moi »)
    await h.gesture('down', 'down', 'tap');
    await h.until((x) => x.screen === 'nearby');
    await h.gesture('double');
    expect((await h.until((x) => ready(x) && x.shown?.length === 2)).shown).toEqual(['fav-bureau', 'fav-mama']);
    h.c.stop();
  });

  it('Quai Web : pas de « double : quitter », et le double toucher ne dit plus rien (§ 4.5)', async () => {
    const h = await setup({ now: NOW, web: true, settings: settingsWith(FOUR, { seenVersion: '' }), core: (now) => stubCore(now, { answers: ca1215Answers }) });
    const s = await h.until(ready);
    expect(s.lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir');
    const n = h.screens().length;
    await h.gesture('double');
    await h.settle(60);
    expect(h.screens().slice(n).every((x) => !x.lines.some((l) => l.includes('ferme simplement')))).toBe(true);
    expect(h.last().lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir');
    expect(h.calls.some((x) => x.op === 'exit')).toBe(false);
    h.c.stop();
  });
});

/* ------------------------------ Vues ------------------------------ */

const ctxAt = (now: number, favorites: Favorite[], patch: Partial<ViewCtx> = {}): ViewCtx => ({ now, settings: settingsWith(favorites), ...patch });
/** Favori lieu qui part dans `leave` minutes et arrive dans `arr` minutes. */
const placeIn = (fav: Favorite, now: number, leave: number, arr: number): FavoriteEntry => ({ fav, answer: tripAnswer(fav, door(`j-${fav.id}`, now + leave * MIN, now + arr * MIN)) });

describe('accueil (vue) : hauteur, largeurs, états', () => {
  const extra: Favorite = { kind: 'place', id: 'fav-ecole', label: 'École de Louisa', lat: 50.7, lon: 4.4, propose: 'never' };
  const three = (now: number): FavoriteEntry[] => [placeIn(PLACES.bureau, now, 0, 47), placeIn(PLACES.mama, now, 4, 71), placeIn(extra, now, 20, 50)];
  const running = { title: 'Vers le bureau', next: 'IC 08:01, voie 3' };

  it('3 favoris au plus ; tout tient sans défiler avec « En cours », 3 favoris et le jour férié', () => {
    const holiday = at('2026-11-11', 7, 31);
    const gare: FavoriteEntry = { fav: PLACES.gare, answer: stopAnswer(PLACES.gare, [train(holiday + 30 * MIN)], holiday) };
    const base: HomeData = { favorites: [...three(holiday), gare], nearbyCount: 9, running, gestureHelp: false };
    const v = homeView(base, ctxAt(holiday, [...FOUR, extra]));
    const l = lines(v);
    expect(l).toEqual([
      'En cours : vers le bureau   IC 08:01, voie 3',
      'Favoris   5',
      'Bureau   maintenant → 08:18',
      'Mama   dans 4 min → 08:42',
      'École de Louisa   07:51 → 08:21',
      '',
      'Autour de moi   9 arrêts',
      'Aller à…',
      'Jour férié : horaires du dimanche',
    ]);
    const p = page(v);
    expect(p.visible).toBe(v.items.length);
    // le jour férié est la dernière ligne de l'écran, pâle
    const foot = container(p, 'foot');
    expect({ ...foot, content: nb(foot.content) }).toMatchObject({ content: 'Jour férié : horaires du dimanche', level: 2, y: 288 - GEO.BOTTOM_MARGIN - 27, h: 27 });
  });

  it('pas assez de place (aide des gestes, ligne du haut) : moins de favoris, jamais de défilement', () => {
    const holiday = at('2026-11-11', 7, 31);
    const d: HomeData = { favorites: three(holiday), nearbyCount: 9, running };
    const withHelp = homeView(d, ctxAt(holiday, FOUR));
    expect(withHelp.items.filter((i) => i.b).map((i) => i.b)).toEqual(['Bureau', 'Mama']);
    expect(lines(withHelp).slice(-2)).toEqual(['Jour férié : horaires du dimanche', HINTS_HOME]);
    expect(page(withHelp).visible).toBe(withHelp.items.length);
    const stale = homeView({ ...d, stale: 'Horaires périmés : mise à jour arrêtée le 10/11' }, ctxAt(holiday, FOUR));
    expect(stale.items.filter((i) => i.b).map((i) => i.b)).toEqual(['Bureau']);
    expect(page(stale).visible).toBe(stale.items.length);
    lines(stale);
    // un jour ordinaire, sans « En cours » : 3 favoris même avec l'aide et une ligne du haut
    const plain = homeView({ favorites: three(NOW), nearbyCount: 9, notice: 'Horaires de demain pas encore publiés' }, ctxAt(NOW, FOUR));
    expect(plain.items.filter((i) => i.b)).toHaveLength(3);
    expect(page(plain).visible).toBe(plain.items.length);
  });

  it('CA-121.7 : le 11/11/2026, « Jour férié : horaires du dimanche » en dernière ligne ; le 12/11, rien', () => {
    const d = (now: number): HomeData => ({ favorites: [placeIn(PLACES.bureau, now, 0, 47)], nearbyCount: 9, gestureHelp: false });
    const on = lines(homeView(d(at('2026-11-11', 20, 47)), ctxAt(at('2026-11-11', 20, 47), FOUR)));
    expect(on.at(-1)).toBe('Jour férié : horaires du dimanche');
    const off = lines(homeView(d(NOW), ctxAt(NOW, FOUR)));
    expect(off.some((l) => l.startsWith('Jour férié'))).toBe(false);
    expect(off.at(-1)).toBe('Aller à…');
    // avec l'aide des gestes, la ligne du jour férié reste juste au-dessus
    const help = lines(homeView({ ...d(at('2026-11-11', 9, 0)), gestureHelp: true }, ctxAt(at('2026-11-11', 9, 0), FOUR)));
    expect(help.slice(-2)).toEqual(['Jour férié : horaires du dimanche', HINTS_HOME]);
  });

  it('aucun favori : « Ajouter un favori » à la place du bloc ; « Accueil sans favoris » : « Favoris   n » seul', () => {
    const none = homeView({ nearbyCount: 3, near: 'Braine-l’Alleud' }, ctxAt(NOW, []));
    expect(lines(none)).toEqual(['Près de Braine-l’Alleud', 'Ajouter un favori', '', 'Autour de moi   3 arrêts', 'Aller à…', HINTS_HOME]);
    expect(none.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    const plain = homeView({ noFavorites: true, favorites: three(NOW), nearbyCount: 3, near: 'Braine-l’Alleud', gestureHelp: false }, ctxAt(NOW, FOUR));
    expect(lines(plain)).toEqual(['Près de Braine-l’Alleud', 'Favoris   4', '', 'Autour de moi   3 arrêts', 'Aller à…']);
    expect(plain.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    // sans position
    expect(lines(homeView({ favorites: [], noPosition: true, gestureHelp: false }, ctxAt(NOW, FOUR)))).toContain('Autour de moi   sans position');
  });

  it('aucun « ~ » ni note « horaire prévu » sur l’accueil, même sans temps réel', () => {
    const planned = (fav: Favorite): FavoriteEntry => {
      const j = door('j-p', NOW + 10 * MIN, at(DAY, 21, 40));
      j.legs[1].rt = false;
      j.rt = false;
      return { fav, answer: tripAnswer(fav, j) };
    };
    const gare: FavoriteEntry = { fav: PLACES.gare, answer: stopAnswer(PLACES.gare, [train(NOW + 21 * MIN, { rt: false })]) };
    const l = lines(homeView({ favorites: [planned(PLACES.bureau), gare], nearbyCount: 2, gestureHelp: false }, ctxAt(NOW, FOUR)));
    expect(l.slice(1, 3)).toEqual(['Bureau   dans 10 min → 21:40', 'Braine-l’Alleud, train   IC 21:08 voie 2']);
    expect(l.join('\n')).not.toContain('~');
  });
});

describe('§ 4.3 : une ligne par favori, départ conseillé puis arrivée', () => {
  const t = (leave: number, arr: number, extra: Partial<FavoriteAnswer> = {}) => tripHomeText(tripAnswer(PLACES.bureau, door('j', leave, arr), extra), NOW);

  it('lieu ou trajet : « maintenant », « dans 4 min », l’heure, un autre jour ; sans « ~ »', () => {
    expect(nb(t(NOW, at(DAY, 21, 34)))).toBe('maintenant → 21:34');
    expect(nb(t(NOW + 4 * MIN, at(DAY, 21, 34)))).toBe('dans 4 min → 21:34');
    expect(nb(t(NOW + 15 * MIN, at(DAY, 21, 34)))).toBe('dans 15 min → 21:34');
    expect(nb(t(at(DAY, 22, 10), at(DAY, 23, 5)))).toBe('22:10 → 23:05');
    expect(nb(t(at('2026-11-13', 6, 20), at('2026-11-13', 6, 46)))).toBe('demain 06:20 → 06:46');
    expect(textWidth(t(at('2026-11-13', 6, 20), at('2026-11-13', 6, 46)))).toBeLessThanOrEqual(WIDTHS.wideRight);
    // gare de départ hors de portée à pied : l'heure du train, même tout près
    const station = journey('j-st', [{ ride: 'IC', mode: 'train', dep: NOW + 5 * MIN, arr: NOW + 34 * MIN, from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre' }]);
    expect(nb(tripHomeText(tripAnswer(PLACES.bureau, station, { fromStation: true }), NOW))).toBe('20:52 → 21:21');
  });

  it('à pied, états : « … », « tu y es », « sans position », « aucun trajet »', () => {
    const walk = journey('j-walk', [{ walk: 9 }]);
    walk.dep = NOW - 2 * MIN;
    walk.arr = NOW + 7 * MIN;
    expect(nb(tripHomeText(tripAnswer(PLACES.bureau, walk), NOW))).toBe('maintenant → 20:56');
    expect(tripHomeText(undefined, NOW)).toBe('…');
    expect(tripHomeText({ favoriteId: 'x', kind: 'trip', state: 'here', updatedAt: NOW }, NOW)).toBe('tu y es');
    expect(tripHomeText({ favoriteId: 'x', kind: 'trip', state: 'noPosition', updatedAt: NOW }, NOW)).toBe('sans position');
    expect(tripHomeText({ favoriteId: 'x', kind: 'trip', state: 'none', updatedAt: NOW }, NOW)).toBe('aucun trajet');
    // le premier véhicule est parti : la réponse se recalcule
    expect(t(NOW - 20 * MIN, at(DAY, 21, 34))).toBe('…');
  });

  it('arrêt : le prochain départ, « IC 21:08 voie 2 », sans « ~ » ; voie modifiée, retard, demain, dernier', () => {
    const s = (deps: Departure[]) => stopHomeText(stopAnswer(PLACES.gare, deps), NOW);
    expect(s([train(at(DAY, 21, 8))])).toEqual({ text: 'IC 21:08 voie 2' });
    expect(nb(s([train(at(DAY, 21, 8), { rt: false })]).text)).toBe('IC 21:08 voie 2');
    expect(nb(s([train(at(DAY, 21, 8), { delayMin: 12, newPlatform: '12' })]).text)).toBe('IC 21:08 +12 voie 12 !');
    expect(s([train(at('2026-11-13', 6, 20))]).text).toBe('IC demain 06:20');
    expect(s([train(at(DAY, 21, 8), { cancelled: true })]).text).toBe('IC 21:08 SUPPRIMÉ');
    const tram: Departure = { op: 'stib', mode: 'tram', line: '3', head: { fr: 'Churchill', nl: 'Churchill' }, sched: NOW + 2 * MIN, est: NOW + 2 * MIN, rt: false, delayMin: 0, cancelled: false, last: true };
    expect(s([tram])).toEqual({ text: `T3 2 min`, tail: ', dernier' });
    expect(stopHomeText(undefined, NOW).text).toBe('…');
    expect(s([]).text).toBe('aucun départ');
    expect(stopHomeText({ favoriteId: 'x', kind: 'stop', state: 'missing', updatedAt: NOW }, NOW).text).toBe('introuvable');
  });

  it('largeurs : noms longs coupés dans leur colonne, réponses entières', () => {
    const long: Favorite = { kind: 'place', id: 'fav-long', label: 'Chez la grand-mère de Louisa à Woluwe', lat: 50.84, lon: 4.42, propose: 'never' };
    const v = homeView({ favorites: [{ fav: long, answer: tripAnswer(long, door('j-l', at('2026-11-13', 6, 20), at('2026-11-13', 6, 46))) }], nearbyCount: 9, gestureHelp: false }, ctxAt(NOW, [long]));
    const l = lines(v);
    expect(l[1]).toMatch(/^Chez la grand-mère.*…   demain 06:20 → 06:46$/);
    const p = page(v);
    for (const row of rowsOf(container(p, 'colB'))) expect(textWidth(row)).toBeLessThanOrEqual(WIDTHS.homeRow);
    // « En cours » d'un long titre, arrêt au long nom, train en retard sur une voie modifiée : rien ne dépasse
    const stop: Favorite = { kind: 'stop', id: 'fav-lln', areaId: 'sncb:8811676', op: 'sncb', name: { fr: 'Louvain-la-Neuve-Université-Centre-Sud', nl: 'Louvain-la-Neuve' }, lat: 50.67, lon: 4.61, propose: 'never' };
    const t0 = at('2026-11-11', 20, 47);
    const lln = stopAnswer(stop, [train(t0 + 8 * MIN, { delayMin: 12, newPlatform: '12' })], t0);
    lln.board!.area = { ...lln.board!.area, id: stop.areaId, n: stop.name };
    const busy = homeView(
      {
        favorites: [{ fav: stop, answer: lln }],
        running: { title: 'Vers Avenue Winston Churchill 100, Uccle', next: 'IC 21:08, voie 12' },
        nearbyCount: 12,
        notice: 'Horaires de demain pas encore publiés : ceux d’aujourd’hui sont utilisés',
        gestureHelp: true,
      },
      ctxAt(t0, [stop]),
    );
    const bl = lines(busy);
    expect(bl[1]).toMatch(/^En cours : vers Avenue Winston.*…   IC 21:08, voie 12$/);
    expect(bl[3]).toMatch(/^Louvain-la-Neuve-Université.*   IC 20:55 \+12 voie 12 !$/);
    expect(bl.slice(-2)).toEqual(['Jour férié : horaires du dimanche', HINTS_HOME]);
    expect(page(busy).visible).toBe(busy.items.length);
  });
});
