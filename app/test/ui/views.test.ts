/**
 * Écrans des lunettes (PRD 1.1 § 6.1, PRD-1.2.1 § 3, § 4 et § 6, mis à jour pour la 1.2.2 : docs/v1.2.2/PRD-1.2.2.md
 * § 1, § 2, § 3, § 6 et REVUE-USAGE.md) : textes exacts, états vides, largeur au pixel de chaque ligne dans sa colonne.
 * Données : faux cœur (fixtures, scénarios S1 à S3), réponses et ordre des favoris du cœur. Réglages de la 1.1 migrés
 * en v4 : favoris Bureau, Vers Gand-Saint-Pierre et Maison ; « Gares » : Namur ; « Bus, tram, métro » : tram 3 et
 * tram 4 à Gare du Nord (« près »), Bruxelles-Nord De Lijn « toutes les lignes ». Classement du faux cœur (PRD-1.2.2
 * § 7) : à S1, la proposition 1 vers le bureau est l'IC jusqu'à Bruxelles-Nord puis le tram 3 (marches 7 + 2 + 9 min,
 * arrivée 08:58), puis deux « Le suivant » (08:33 et 09:33).
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, FavoriteAnswer, Journey, Leg, LatLon, LinePick, Settings } from '../../src/core/api';
import type { FakeFlags } from '../../src/dev/fake-core';
import { departureRightText, planHomeText, SECTION, upcoming } from '../../src/glasses/format';
import { layoutPage, geometry, GEO, HOME_INDENT, WIDTHS } from '../../src/glasses/layout';
import { textWidth } from '../../src/glasses/font';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { GlassesView, KeepLineRoute, LineRoute } from '../../src/glasses/types';
import {
  alreadyThereView,
  arrivalView,
  boardView,
  errorView,
  favoritesView,
  firstRunView,
  followsView,
  followedView,
  homeView,
  keepLineView,
  lineRunView,
  lineView,
  linesView,
  loadingView,
  nearbyView,
  NEWS_LINES,
  NEWS_LINES_128,
  newsLines,
  newsView,
  notConfiguredView,
  othersView,
  recentKey,
  stationsView,
  stepsPage,
  stepsView,
  trainView,
  type FavoriteEntry,
  type HomeData,
  type LineRow,
  type StationRow,
  type StopLine,
  type ViewCtx,
} from '../../src/glasses/views';
import { completeFollow, matchFollow, type LineFollow } from '../../src/core/linerun';
import { at, fakeCore, nb, overflowing, preset11, SCENARIO } from './helpers';

function page(v: GlassesView) {
  const g = geometry(v);
  return layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, g.capacity));
}

/** Lignes affichées (espaces insécables normalisées), après contrôle de la largeur au pixel et des tirets. */
function check(v: GlassesView): string[] {
  return checked(page(v));
}

/** Même contrôle, pour un écran sans curseur défilé jusqu'à `top` (étapes au bout). */
function checkAt(v: GlassesView, top: number): string[] {
  return checked(layoutPage(v, { sel: -1, top }));
}

function checked(p: ReturnType<typeof page>): string[] {
  expect(overflowing(p)).toEqual([]);
  for (const l of [p.title, ...p.lines]) {
    expect(l).not.toMatch(/[—–]/);
    expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
  }
  return p.lines.map(nb);
}

const settings = (patch: Partial<Settings['display']> = {}): Settings => {
  const s = preset11();
  return { ...s, display: { ...s.display, ...patch } };
};

/** 1.2.2 : le bus W à Merbraine (passages partiels vers Waterloo Eglise, temps réel), en plus des lignes migrées. */
const W_MERBRAINE: LinePick = { id: 'w-merbraine', areaId: 'tec:Bbrlmer1', op: 'tec', name: { fr: 'Braine-l’Alleud Merbraine', nl: 'Braine-l’Alleud Merbraine' }, lat: 50.6833, lon: 4.3891, line: 'W', mode: 'bus' };

/** Réponses du cœur pour les favoris, dans l'ordre intelligent ; `last` : favoris de la règle 5 (jamais sur l'accueil). */
async function answers(now: number, here: LatLon | null, s: Settings, flags: FakeFlags = {}) {
  const core = fakeCore(() => now, flags);
  const map = new Map<string, FavoriteAnswer>();
  for (const f of s.favorites) map.set(f.id, await core.answer(f, here, s));
  const ranks = core.orderFavorites(here, s, map);
  const order = ranks.map((r) => r.favoriteId);
  const last = new Set(ranks.filter((r) => r.rule === 5).map((r) => r.favoriteId));
  const entries: FavoriteEntry[] = order.map((id) => ({ fav: s.favorites.find((f) => f.id === id)!, answer: map.get(id) }));
  return { core, map, order, entries, last };
}

/** Données de l'accueil comme le contrôleur les donne (PRD-1.2.2 § 1.1) : les 3 premiers favoris, sans la règle 5. */
function home(
  a: { entries: FavoriteEntry[]; order: string[]; last?: Set<string> },
  patch: Partial<HomeData> = {},
): HomeData {
  return { favorites: a.entries.filter((e) => !a.last?.has(e.fav.id)).slice(0, 3), order: a.order, nearbyCount: 3, ...patch };
}

/** Lignes de « Gares » et de « Bus, tram, métro », comme le contrôleur les charge (3 passages par sens, 2 montrés). */
async function stationRows(core: ReturnType<typeof fakeCore>, now: number, s: Settings): Promise<StationRow[]> {
  const rows: StationRow[] = [];
  for (const pick of s.stations) {
    const next = upcoming((await core.board(pick.areaId, { limit: 3 })).departures, now)[0];
    rows.push(next ? { pick, next, state: 'ok' } : { pick, state: 'none' });
  }
  return rows;
}

async function lineRows(core: ReturnType<typeof fakeCore>, picks: readonly LinePick[]): Promise<LineRow[]> {
  const rows: LineRow[] = [];
  for (const pick of picks) {
    rows.push(pick.line ? { pick, board: await core.lineBoard(pick.areaId, pick.line, { perDirection: 3 }) } : { pick, stop: await core.board(pick.areaId, { limit: 4 }) });
  }
  return rows;
}

/** Route du détail d'une ligne choisie (toucher sur son titre dans « Bus, tram, métro »). */
const lineRoute = (p: LinePick): LineRoute => ({ screen: 'line', pick: p.id, areaId: p.areaId, op: p.op, line: p.line!, name: p.name, ...(p.mode ? { mode: p.mode } : {}) });

/** Lignes d'un arrêt pour « garder une ligne », comme le contrôleur : une par ligne, jamais un train. */
async function stopLines(core: ReturnType<typeof fakeCore>, areaId: string): Promise<StopLine[]> {
  const seen = new Set<string>();
  const out: StopLine[] = [];
  for (const x of await core.linesAt(areaId)) {
    if (x.mode === 'train' || seen.has(x.line)) continue;
    seen.add(x.line);
    out.push({ line: x.line, mode: x.mode });
  }
  return out;
}

const HINT_HOME = '△▽ choisir   toucher : ouvrir   double : quitter';
/** 1.2.6 (PRD-1.2.6 § 1) : les trois rubriques du préréglage (Namur ; Bruxelles-Nord De Lijn ; tram 3 et tram 4). */
const SECTIONS = ['Gares de train   1 gare', 'Arrêts de bus, tram, métro   1 arrêt', 'Lignes de bus, tram, métro   2 lignes'];
/** Titre d'une ligne de l'accueil : la colonne a, ou les mots clairs et pâles d'une rubrique (1.2.6). */
const titleOf = (i: { a?: string; segs?: { t: string }[] }) => i.a || (i.segs ?? []).map((g) => g.t).join(' ');

/** 1.2.6 : une ligne suivie retrouvée comme le contrôleur (matchFollow, completeFollow), avec ses sens. */
async function followRow(core: ReturnType<typeof fakeCore>, f: LineFollow) {
  const m = matchFollow(f, await core.findLines(f.line, f.via ?? null));
  const follow = m ? completeFollow(f, m) : f;
  return { follow, mode: follow.mode, heads: m ? await core.lineHeads!(follow) : [] };
}
/** 1.2.2 (PRD-1.2.2 § 6) : sur le trajet suivi, toucher propose « Ne plus suivre ». */
const HINT_STEPS = '△▽ étapes   toucher : ne plus suivre   double : retour';
const HINT_OTHER = '△▽ étapes   toucher : suivre ce trajet   double : retour';

const ctxOf = (now: number, s: Settings, patch: Partial<ViewCtx> = {}): ViewCtx => ({ now, settings: s, ...patch });


describe('scénario 1 : le matin, vers le bureau (S1, 07:31)', () => {
  const now = SCENARIO.s1.now;
  const here = { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon };

  it('CA-122.1, CA-121.5 et CA-126.1 : accueil sans temps réel : « Favoris », favoris en retrait, « Autour de moi », les trois rubriques, sans « ~ »', async () => {
    const s = settings();
    const a = await answers(now, here, s, { noRt: true });
    // Maison : « tu y es » (règle 5), jamais sur l'accueil
    expect(a.order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    expect([...a.last]).toEqual(['fav-maison']);
    const v = homeView(home(a), ctxOf(now, s, { rt: 'down' }));
    expect(v.log).toEqual({ order: a.order, shown: ['fav-bureau', 'fav-gand'] });
    // sans « ~ » sur l'accueil, qui n'en affiche pas (les autres écrans gardent « horaires prévus ~ »)
    expect(nb(v.top?.text ?? '')).toBe('Temps réel indisponible : horaires prévus');
    expect(v.top?.strong).toBeUndefined();
    // titres dans la colonne a, nombre ou prochain départ à droite ; favoris en retrait (nom et réponse dans la colonne b)
    // 1.2.6 : le mot clé de chaque rubrique au plus clair, sa précision pâle (segs)
    const all = v.items.map((i) => [titleOf(i), i.b ?? '', nb(i.c ?? i.bRight ?? '')]);
    expect(all).toEqual([
      ['Favoris', '', '3'],
      ['', 'Bureau', 'dans 2 min → 08:58'],
      ['', 'Vers Gand-Saint-Pierre', '07:40 → 08:09'],
      ['Autour de moi', '', '3 arrêts'],
      ['Gares de train', '', '1 gare'],
      ['Arrêts de bus, tram, métro', '', '1 arrêt'],
      ['Lignes de bus, tram, métro', '', '2 lignes'],
    ]);
    // la ligne du haut et l'aide des gestes prennent la place de la ligne vide (PRD-1.2.6 § 1) ; « Aller à… » n'existe
    // plus (PRD-1.2.2 § 1.1)
    expect(v.items[3].gap).toBeUndefined();
    expect(v.items.slice(1, 3).every((i) => !i.c && i.bRight)).toBe(true);
    expect(v.items.map((i) => i.action)).toEqual([
      { kind: 'open', route: { screen: 'favorites' } },
      { kind: 'openFavorite', id: 'fav-bureau' },
      { kind: 'openFavorite', id: 'fav-gand' },
      { kind: 'open', route: { screen: 'nearby' } },
      { kind: 'open', route: { screen: 'stations' } },
      { kind: 'open', route: { screen: 'lines' } },
      { kind: 'open', route: { screen: 'follows' } },
    ]);
    // curseur à l'ouverture sur le premier favori
    expect(v.initialSel).toBe(1);
    const lines = check(v);
    expect(lines).not.toContain('~ horaire prévu, sans temps réel');
    expect(lines.join(' ')).not.toMatch(/~|Aller à/);
    expect(lines).toEqual([
      'Temps réel indisponible : horaires prévus',
      'Favoris   3',
      'Bureau   dans 2 min → 08:58',
      'Vers Gand-Saint-Pierre   07:40 → 08:09',
      'Autour de moi   3 arrêts',
      ...SECTIONS,
      HINT_HOME,
    ]);
    const p = page(v);
    expect(p.visible).toBe(v.items.length);
    expect(p.sel).toBe(1);
    // relief : titres et nombres au niveau 4, favoris (nom et réponse) au niveau 2
    expect(p.containers.filter((c) => ['colA', 'colB', 'colC'].includes(c.name)).map((c) => [c.name, c.level])).toEqual([['colA', 4], ['colB', 2], ['colC', 4]]);
  });

  it('CA-M1.2 : temps réel, retard et voie modifiée sur une ligne : « Gares   IC 07:42 +2 voie 6 ! » (Namur)', async () => {
    const s = settings();
    const lines = check(homeView(home(await answers(now, here, s)), ctxOf(now, s, { rt: 'ok' })));
    expect(lines).toEqual([
      'Favoris   3',
      'Bureau   dans 4 min → 08:58',
      'Vers Gand-Saint-Pierre   07:40 → 08:09',
      '',
      'Autour de moi   3 arrêts',
      ...SECTIONS,
      HINT_HOME,
    ]);
  });

  it('CA-M2.1 et CA-122.7 : étapes du trajet suivi, « Suivi » sur la ligne du titre, l’alerte avant la raison, « ▶ » sur la 1re étape ; ▼ : la suite', async () => {
    const s = settings();
    const { map } = await answers(now, here, s);
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, leaveAt0: journeys[0].leaveAt, fresh: true }, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers le bureau : 07:35 → 08:58');
    expect(v.titleRight).toBe('Suivi');
    expect(nb(page(v).title)).toBe('Vers le bureau : 07:35 → 08:58   Suivi');
    expect(v.log).toEqual({ page: 1, pages: 3, label: 'short', followed: true });
    // IC jusqu'à Bruxelles-Nord, puis le tram 3 : 7 étapes pour 6 lignes ; 1.2.4 : la gare de départ nommée sous le
    // départ à pied (2 lignes), les 2 dernières étapes annoncées en bas
    expect(check(v)).toEqual([
      '! Voie modifiée : l’IC part de la voie 6',
      '07:35   Partir à pied vers la gare (7 min)   dans 4 min',
      'Namur',
      '07:42   IC vers Bruxelles-Midi, voie 6   +2 min',
      '08:42   Descendre à Bruxelles-Nord',
      '08:42   À pied vers Gare du Nord (2 min)',
      // 1.2.5 (PRD-1.2.5 § 2) : l'IC a 2 min de retard ; à 08:44 à l'arrêt, le tram à 08:44 : aucune marge
      '~08:44   Tram 3 vers Churchill   très juste',
      '▽ suite du trajet : 2 étapes',
      HINT_STEPS,
    ]);
    expect(page(v).sel).toBe(0);
    // toucher : « Ne plus suivre » et le détail du véhicule (plus « Dans le train » directement)
    expect(v.tap).toEqual({ kind: 'open', route: { screen: 'followed' } });
    const f = followedView({ title: 'Vers le bureau', journey: journeys[0] }, ctxOf(now, s));
    expect(nb(f.title)).toBe('Vers le bureau : trajet suivi');
    expect(check(f)).toEqual(['Ne plus suivre', 'Arrêts : IC vers Bruxelles-Midi, +2 min', '△▽ choisir   toucher : valider   double : retour']);
    expect(f.items.map((i) => i.action?.kind)).toEqual(['unfollow', 'open']);
    expect(f.items[1].action).toMatchObject({ kind: 'open', route: { screen: 'train', leg: 1 } });
    expect(check(followedView(null, ctxOf(now, s)))).toEqual(['Ce trajet n’est plus suivi.', 'double toucher : retour']);
    // au bout : « Fin du trajet. ▽ 2 autres trajets »
    const end = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, leaveAt0: journeys[0].leaveAt, top: 1 }, ctxOf(now, s));
    expect(checkAt(end, 1).slice(-3)).toEqual(['08:58   Arrivée au bureau (9 min à pied)', 'Fin du trajet. ▽ 2 autres trajets', HINT_STEPS]);
  });

  it('CA-M2.2 et CA-122.7 : sans temps réel, « Si tu le rates » puis la raison ; « Autres trajets » ; une autre proposition, « Suivre ce trajet » ; une seule', async () => {
    const s = settings();
    const { map } = await answers(now, here, s, { noRt: true });
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    expect(journeys.map((j) => j.label)).toEqual(['short', 'next', 'later']);
    const ctx = ctxOf(now, s);
    const p1 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctx);
    const l1 = check(p1);
    // 1.2.5 (PRD-1.2.5 § 1) : départ à pied à 07:33, dans 2 min : « Si tu le rates » (l'IC suivant de Namur) en haut
    expect(l1[0]).toBe('Si tu le rates : arrivée 09:57, 59 min plus tard');
    expect(l1.slice(-2)).toEqual(['▽ suite du trajet : 2 étapes', HINT_STEPS]);
    // 6 min avant, la raison
    expect(check(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctxOf(at(7, 27), s)))[0]).toBe('Le plus court : 1 changement, à pied 7 + 2 + 9 min');
    // ▼ au bout : « Autres trajets », la raison ou les moyens en 2e ligne
    const list = othersView({ screen: 'others', key: 'k', title: 'Vers le bureau', journeys, index: 0 }, journeys, ctx);
    expect(nb(list.title)).toBe('Vers le bureau : autres trajets');
    expect(check(list)).toEqual(['Le suivant   08:33 → 09:57', 'IC + tram 4, à pied 7 + 2 + 9 min', 'Plus tard   09:33 → 10:58', 'IC + tram 3, à pied 7 + 2 + 9 min', '△▽ choisir   toucher : voir   double : retour']);
    // une autre proposition, ouverte depuis la liste : non suivie, sans « ▶ », « Suivre ce trajet » sur la ligne du titre
    const p3 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 2, followedId: journeys[0].id, fromList: true }, ctx);
    expect(nb(p3.title)).toBe('Vers le bureau : 09:33 → 10:58');
    expect(p3.titleRight).toBe('Suivre ce trajet');
    expect(p3.log).toEqual({ page: 3, pages: 3, label: 'later', followed: false });
    const l3 = check(p3);
    expect(l3[0]).toBe('Plus tard : 1 changement, départ 09:33');
    expect(l3).toContain('~09:42   IC vers Bruxelles-Midi, voie 4');
    expect(l3.slice(-2)).toEqual(['▽ suite du trajet : 2 étapes', HINT_OTHER]);
    expect(page(p3).sel).toBe(-1);
    expect(p3.tap).toEqual({ kind: 'follow' });
    const p3end = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 2, followedId: journeys[0].id, fromList: true, top: 1 }, ctx);
    expect(checkAt(p3end, 1).slice(-3)).toEqual(['10:58   Arrivée au bureau (9 min à pied)', 'Fin du trajet. ▽ autres trajets', HINT_OTHER]);
    // 1.2.2 : la 1re proposition d'un trajet ouvert, pas suivi : « Suivre ce trajet » aussi, sans aide des gestes
    const open = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, fresh: true }, ctxOf(now, settings({ gestureHints: false })));
    expect(open.titleRight).toBe('Suivre ce trajet');
    expect(open.tap).toEqual({ kind: 'follow' });
    expect(open.mark).toBeUndefined();
    expect(check(open).at(-1)).toBe('▽ suite du trajet : 2 étapes');
    // une seule proposition : rien d'autre, dit au bout des étapes
    const one = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: journeys.slice(0, 1), index: 0, top: 1 }, ctx);
    expect(checkAt(one, 1).slice(-2)).toEqual(['Fin du trajet. Pas d’autre trajet pour l’instant', HINT_OTHER]);
  });

  it('CA-S6.3 : colonne d’état « dans 4 min » puis « en cours » ; repère sur l’étape en cours', async () => {
    const s = settings();
    const { map } = await answers(now, here, s);
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    const later = at(7, 36);
    const j = await fakeCore(() => later).refresh(journeys[0], s);
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j, ...journeys.slice(1)], index: 0, followedId: j.id, leaveAt0: journeys[0].leaveAt, fresh: true }, ctxOf(later, s));
    const lines = check(v);
    expect(lines[1]).toBe('07:35   Partir à pied vers la gare (7 min)   en cours');
    expect(page(v).sel).toBe(0);
    const inTrain = at(8, 5);
    const v2 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, followedId: j.id, leaveAt0: journeys[0].leaveAt, fresh: true }, ctxOf(inTrain, s));
    expect(check(v2)[3]).toBe('07:42   IC vers Bruxelles-Midi, voie 6   en cours');
    expect(page(v2).sel).toBe(1);
    // 08:47 : dans le tram 3 (08:44 → 08:49), le repère est sur le tram
    const inTram = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, followedId: j.id, fresh: true }, ctxOf(at(8, 47), s));
    expect(page(inTram).sel).toBe(4);
    expect(check(inTram)).toContain('~08:44   Tram 3 vers Churchill   en cours');
  });

  it('dans le train : arrêts, aide « △▽ arrêts   double : retour » (L4)', async () => {
    const s = settings();
    const { map } = await answers(now, here, s);
    const t = at(8, 5);
    const j = await fakeCore(() => t).refresh(map.get('fav-bureau')!.plan!.journeys[0], s);
    const v = trainView(j, 1, ctxOf(t, s));
    expect(nb(v.title)).toBe('IC vers Bruxelles-Midi, +2 min');
    const p = page(v);
    expect(p.lines.map(nb)).toContain('Ottignies   08:11   prochain');
    // l'IC du trajet du bureau s'arrête à Bruxelles-Nord (puis le tram 3)
    expect(p.lines.map(nb)).toContain('Bruxelles-Nord   08:42   descente');
    expect(nb(p.lines.at(-1)!)).toBe('△▽ arrêts   double : retour');
    // 1.2.5 (PRD-1.2.5 § 7) : la ligne de progression, train compris : Namur et Gembloux passés, Ottignies le prochain
    expect(v.top).toEqual({ text: '●─●─◎─○─○─○   descente dans 4 arrêts' });
    expect(nb(p.lines[0])).toBe('●─●─◎─○─○─○   descente dans 4 arrêts');
    expect(overflowing(p)).toEqual([]);
  });

  it('autour de moi : trois zones, aide avec « double : retour » (L7)', async () => {
    const list = await fakeCore(() => now).nearby(here.lat, here.lon, 500);
    const lines = check(nearbyView(list, ctxOf(now, settings())));
    expect(lines[0]).toMatch(/^Namur Place Léopold, bus TEC   150 m   /);
    expect(lines[1]).toMatch(/^Namur, train   420 m   IC 07:42/);
    expect(lines.at(-1)).toBe('△▽ arrêt   toucher : départs   double : retour');
  });

  it('CA-122.2 : « Favoris » : ligne 1 comme l’accueil, détail pâle en 2e ligne ; « Adresses récentes » (3 au plus) ; « Autre adresse   sur le téléphone »', async () => {
    const s = settings();
    // lieux publics seulement (PRD-1.2.2, règle de confidentialité)
    s.recent = [
      { label: 'Korenmarkt, 9000 Gent', lat: 51.0547, lon: 3.7217, at: 4 },
      { label: 'Grand-Place, 1000 Bruxelles', lat: 50.8467, lon: 4.3525, at: 3 },
      { label: 'Place d’Armes, 5000 Namur', lat: 50.4626, lon: 4.8667, at: 2 },
      { label: 'Place Saint-Lambert, 4000 Liège', lat: 50.6451, lon: 5.5734, at: 1 },
    ];
    const a = await answers(now, here, s);
    const korenmarkt = recentKey('Korenmarkt, 9000 Gent');
    const v = favoritesView({ entries: a.entries, recents: { [korenmarkt]: '07:40 → 08:51' } }, ctxOf(now, s, { rt: 'ok' }));
    expect(v.title).toBe('Favoris');
    expect(v.log).toEqual({ order: a.order });
    expect(v.items.map((i) => [i.head ?? '', i.a, nb(i.c ?? ''), nb(i.b2 ?? '')])).toEqual([
      ['', 'Bureau', 'dans 4 min → 08:58', 'IC 07:42 +2 voie 6 !, 1 changement'],
      ['', 'Vers Gand-Saint-Pierre', '07:40 → 08:09', 'IC voie 4 à Bruxelles-Central'],
      ['', 'Maison', 'tu y es', ''],
      ['ADRESSES RÉCENTES', 'Korenmarkt', '07:40 → 08:51', ''],
      ['', 'Grand-Place', '…', ''],
      ['', 'Place d’Armes', '…', ''],
      ['', 'Autre adresse', 'sur le téléphone', ''],
    ]);
    expect(check(v)).toEqual([
      'Bureau   dans 4 min → 08:58',
      'IC 07:42 +2 voie 6 !, 1 changement',
      'Vers Gand-Saint-Pierre   07:40 → 08:09',
      'IC voie 4 à Bruxelles-Central',
      'Maison   tu y es',
      'ADRESSES RÉCENTES',
      'Korenmarkt   07:40 → 08:51',
      '△▽ choisir   toucher : ouvrir   double : retour',
    ]);
    // en bas de la liste : la ligne pâle n'est jamais sous le curseur (elle va avec l'adresse qui la suit)
    const bottom = layoutPage(v, { sel: 6, top: 3 });
    expect(bottom.lines.map(nb).slice(0, 5)).toEqual(['ADRESSES RÉCENTES', 'Korenmarkt   07:40 → 08:51', 'Grand-Place   …', 'Place d’Armes   …', 'Autre adresse   sur le téléphone']);
    expect(overflowing(bottom)).toEqual([]);
    expect(v.items[3].action).toEqual({ kind: 'go', key: korenmarkt, to: { type: 'address', label: 'Korenmarkt, 9000 Gent', lat: 51.0547, lon: 3.7217 }, label: 'Korenmarkt' });
    expect(v.items.at(-1)!.action).toEqual({ kind: 'toast', text: 'Tape l’adresse dans Quai, sur le téléphone' });
    // Quai Web : « dans Réglages », la recherche de l'onglet Réglages
    const web = favoritesView({ entries: a.entries }, ctxOf(now, s, { web: true }));
    expect(web.items.at(-1)).toMatchObject({ a: 'Autre adresse', c: 'dans Réglages', action: { kind: 'phone', hash: '#/recherche', text: 'Tape l’adresse dans l’onglet Réglages' } });
    // la réponse d'une adresse récente : au format de l'accueil (planHomeText)
    const res = await fakeCore(() => now).route({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, s, here);
    expect(nb(planHomeText(res, now))).toBe('dans 4 min → 08:58');
    expect(planHomeText(null, now)).toBe('…');
  });
});

describe('scénario 2 : en ville, gare du Nord (S2, 12:10)', () => {
  const now = SCENARIO.s2.now;
  const here = { lat: SCENARIO.s2.lat, lon: SCENARIO.s2.lon };

  it('CA-122.1 : à Gare du Nord, l’accueil dit le contenu des rubriques ; « Favoris » ouvre la liste', async () => {
    const s = settings();
    const a = await answers(now, here, s);
    expect(a.order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    // Maison (17:13) : rien dans les 3 heures, règle 5 : dans « Favoris » seulement
    expect([...a.last]).toEqual(['fav-maison']);
    const v = homeView(home(a, { nearbyCount: 4 }), ctxOf(now, s, { rt: 'ok' }));
    expect(check(v)).toEqual([
      'Favoris   3',
      'Bureau   maintenant → 12:26',
      'Vers Gand-Saint-Pierre   14:10 → 14:39',
      '',
      'Autour de moi   4 arrêts',
      ...SECTIONS,
      HINT_HOME,
    ]);
    expect(v.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    // la liste ouverte par « Favoris » : tous les favoris, la ligne de l'accueil puis le détail
    const list = favoritesView({ entries: a.entries }, ctxOf(now, s));
    expect(list.log).toEqual({ order: a.order });
    expect(check(list)).toEqual([
      'Bureau   maintenant → 12:26',
      'tram 3 12:12, direct',
      'Vers Gand-Saint-Pierre   14:10 → 14:39',
      'IC voie 4 à Bruxelles-Central',
      'Maison   17:13 → 18:23',
      'IC 17:18 voie 3, direct',
      'Autre adresse   sur le téléphone',
      '△▽ choisir   toucher : ouvrir   double : retour',
    ]);
  });

  it('CA-122.3 : « Gares de train » : la gare choisie et son prochain train ; toucher : son tableau', async () => {
    const s = settings();
    const core = fakeCore(() => now);
    const v = stationsView(await stationRows(core, now, s), ctxOf(now, s));
    expect(v.title).toBe('Gares de train');
    expect(check(v)).toEqual(['Namur   IC 12:42 voie 4', '△▽ choisir   toucher : départs   double : retour']);
    expect(v.items[0].action).toEqual({ kind: 'open', route: { screen: 'board', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' } } });
    // le tableau complet de la gare (1.2.3) : « ★ » (gardée), la ligne ★ en tête la retire de « Gares »
    const b = boardView(await core.board('sncb:8863008', { horizonMin: 120, limit: 40 }), ctxOf(now, s), { kept: true });
    expect(b.title).toBe('Namur, train (SNCB) ★');
    expect(b.items[0]).toEqual({ a: '★ retirer la gare', action: { kind: 'toggleStation' } });
    expect(check(b).at(-1)).toBe('△▽ départs   toucher : arrêts   double : retour');
  });

  it('CA-126.2 et CA-126.3 : « Arrêts… » : l’arrêt et ses 2 départs ; « Lignes… » : un sens par rangée ; toute la ligne ; le détail à 4 passages', async () => {
    const s = settings();
    const core = fakeCore(() => now);
    const rows = await lineRows(core, s.lines);
    const v = linesView(rows, ctxOf(now, s));
    expect(v.title).toBe('Arrêts de bus, tram, métro');
    // 1.2.5 (PRD-1.2.5 § 4) : sous l'arrêt, ses 2 prochains départs, un par ligne ; 1.2.6 : plus d'intitulé « ARRÊTS »
    expect(check(v)).toEqual(['Bruxelles-Nord', 'Bus 232 vers Vilvorde   ~5 min', 'Bus 460 vers Meise   10 min', '~ horaire prévu, sans temps réel', '△▽ choisir   toucher : ouvrir   double : retour']);
    expect(v.items.map((i) => i.action)).toEqual([{ kind: 'open', route: { screen: 'board', areaId: 'delijn:308611', name: s.lines[0].name } }]);
    // « Lignes de bus, tram, métro » : tram 3 et tram 4 (Gare du Nord en repère), un sens par rangée, sans attente
    const follows = await Promise.all((s.follows ?? []).map((f) => followRow(core, f)));
    const fv = followsView(follows, ctxOf(now, s));
    expect(fv.title).toBe('Lignes de bus, tram, métro');
    expect(check(fv)).toEqual(['Tram 3 vers Churchill', 'Tram 3 vers Esplanade', 'Tram 4 vers Stalle', '△▽ choisir   toucher : la ligne   double : retour']);
    expect(fv.items.map((i) => i.action)).toEqual([
      { kind: 'open', route: { screen: 'lineRun', follow: 'f-fav-gdn-3', dir: 0 } },
      { kind: 'open', route: { screen: 'lineRun', follow: 'f-fav-gdn-3', dir: 1 } },
      { kind: 'open', route: { screen: 'lineRun', follow: 'f-fav-gdn-4', dir: 0 } },
    ]);
    // toute la ligne vers Churchill, à Gare du Nord : le curseur sur cet arrêt (à 80 m) ; 1.2.7 : le prochain passage en
    // clair, ● seulement d'après le temps réel (ici, l'horaire prévu)
    const t3 = follows[0].follow;
    const run = await core.lineRun!(t3, 0, { near: here });
    const rv = lineRunView({ screen: 'lineRun', follow: t3.id, dir: 0 }, t3, run, ctxOf(now, s));
    expect(rv.title).toBe('Tram 3 vers Churchill');
    expect(rv.initialSel).toBe(1);
    expect(check(rv).slice(0, 2)).toEqual(['○ Esplanade   dans ~6 min', '○ Gare du Nord à 80 m   dans ~2 min']);
    expect(rv.items[1].action).toEqual({ kind: 'open', route: { screen: 'line', areaId: 'stib:6357F', op: 'stib', line: '3', name: run.stops[1].name, mode: 'tram' } });
    expect(rv.items.at(-1)).toMatchObject({ action: { kind: 'open', route: { screen: 'lineRun', follow: t3.id, dir: 1 } } });
    expect(overflowing(layoutPage(rv, { sel: rv.items.length - 1, top: rv.items.length - 1 }))).toEqual([]);
    // le détail du tram 3 : ses deux sens, 4 passages chacun, puis « Tous les départs de l’arrêt » ; 1.2.3 : curseur de
    // passage en passage (« vers … » au-dessus du premier, jamais sous le curseur), toucher un passage : ses arrêts
    const t3b = await core.lineBoard('stib:6357F', '3', { perDirection: 5 });
    const gdn = { id: 'fav-gdn-3', areaId: 'stib:6357F', op: 'stib' as const, name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017, line: '3', mode: 'tram' as const };
    const d = lineView(lineRoute(gdn), t3b, ctxOf(now, s));
    expect(d.title).toBe('Tram 3 · Gare du Nord');
    expect(d.scroll).toBeUndefined();
    expect(d.paged).toBe(true);
    const block = (head: string) => {
      const i = d.items.findIndex((x) => x.group === head);
      // 1.2.4 : l'heure dans sa case (bLead), alignée à droite
      return d.items.slice(i, i + 4).map((x) => [`${x.bLead ?? ''}${x.b ?? ''}`, nb(x.c ?? '')]);
    };
    expect(block('vers Churchill')).toEqual([['12:12', 'dans 2 min'], ['12:20', 'dans 10 min'], ['12:28', 'dans 18 min'], ['12:36', 'dans 26 min']]);
    expect(block('vers Esplanade')).toEqual([['12:16', 'dans 6 min'], ['12:24', 'dans 14 min'], ['12:32', 'dans 22 min'], ['12:40', 'dans 30 min']]);
    expect(d.items).toHaveLength(9);
    const first = d.items.find((x) => x.group === 'vers Churchill')!;
    expect(first.action).toEqual({ kind: 'open', route: { screen: 'stops', areaId: 'stib:6357F', dep: t3b.directions.find((x) => x.head.fr === 'Churchill')!.departures[0] } });
    expect(check(d).at(-1)).toBe('△▽ passages   toucher : arrêts   double : retour');
    expect(d.items.at(-1)).toEqual({ a: 'Tous les départs de l’arrêt', action: { kind: 'open', route: { screen: 'board', areaId: 'stib:6357F', name: gdn.name } } });
    expect(overflowing(layoutPage(d, { sel: 0, top: 0 }))).toEqual([]);
    expect(overflowing(layoutPage(d, { sel: d.items.length - 1, top: d.items.length - 1 }))).toEqual([]);
  });

  it('REVUE-USAGE n° 3 : départs d’un arrêt de tram : « ★ » si une de ses lignes est gardée ; toucher : « Gare du Nord : garder une ligne »', async () => {
    const s = settings();
    const core = fakeCore(() => now);
    const b = await core.board('stib:6357F', { limit: 5 });
    const v = boardView(b, ctxOf(now, s), { kept: true });
    expect(v.title).toBe('Gare du Nord, tram (STIB) ★');
    // 1.2.3 : la ligne ★ en tête ouvre « garder une ligne » ; chaque départ ouvre ses arrêts
    expect(v.items[0]).toEqual({ a: '★ garder une ligne', action: { kind: 'open', route: { screen: 'keepLine', areaId: 'stib:6357F', op: 'stib', name: b.area.n, lat: b.area.lat, lon: b.area.lon } } });
    expect(v.items.slice(1).map((i) => i.action)).toEqual(b.departures.map((dep) => ({ kind: 'open', route: { screen: 'stops', areaId: 'stib:6357F', dep } })));
    // colonnes étroites : les codes courts (REVUE-USAGE n° 8)
    expect(check(v)).toEqual(['★ garder une ligne', 'T3   Churchill   2 min', 'T4   Stalle   5 min', 'T3   Esplanade   6 min', 'T3   Churchill   10 min', 'T4   Stalle   13 min', '△▽ départs   toucher : arrêts   double : retour']);
    expect(page(v).sel).toBe(1);
    expect(boardView(b, ctxOf(now, s), { kept: false }).title).toBe('Gare du Nord, tram (STIB)');
    // « garder une ligne » : les lignes de l'arrêt en toutes lettres, « ★ » sur celles gardées
    const route: KeepLineRoute = { screen: 'keepLine', areaId: 'stib:6357F', op: 'stib', name: b.area.n, lat: b.area.lat, lon: b.area.lon };
    const lines = await stopLines(core, 'stib:6357F');
    const k = keepLineView(route, lines, ctxOf(now, s));
    expect(nb(k.title)).toBe('Gare du Nord : garder une ligne');
    expect(check(k)).toEqual(['tram 3   ★', 'tram 4   ★', '△▽ choisir   toucher : ★ garder ou retirer   double : retour']);
    expect(k.items.map((i) => i.action)).toEqual([{ kind: 'toggleLine', line: '3', mode: 'tram' }, { kind: 'toggleLine', line: '4', mode: 'tram' }]);
    // 1.2.6 : « ★ » sur les lignes suivies, où que soit leur repère
    const none = { ...s, follows: s.follows?.filter((p) => p.line !== '4') };
    expect(check(keepLineView(route, lines, ctxOf(now, none))).slice(0, 2)).toEqual(['tram 3   ★', 'tram 4']);
    expect(check(keepLineView(route, [], ctxOf(now, s)))).toEqual(['Aucune ligne à cet arrêt aujourd’hui.', 'double toucher : retour']);
  });

  it('départs De Lijn en horaire prévu ; gare : voie, ~ et SUPPRIMÉ', async () => {
    const core = fakeCore(() => now);
    const dl = boardView(await core.board('delijn:308611', { limit: 5 }), ctxOf(now, settings()), { kept: false });
    expect(dl.title).toBe('Bruxelles-Nord, bus (De Lijn)');
    const l = check(dl);
    expect(l.slice(0, 2)).toEqual(['★ garder une ligne', '232   Vilvorde   ~5 min']);
    expect(l.slice(-2)).toEqual(['~ horaire prévu, sans temps réel', '△▽ départs   toucher : arrêts   double : retour']);
    const gare = boardView(await core.board('sncb:8812005', { limit: 5 }), ctxOf(now, settings()), { kept: false });
    const lines = check(gare);
    expect(lines.slice(0, 4)).toEqual(['★ garder la gare', 'IC   Anvers-Central   12:22  voie 9', 'IC   Anvers-Central   ~12:30  voie 12', 'S1   Nivelles   12:34  SUPPRIMÉ']);
    expect(lines.at(-1)).toBe('△▽ départs   toucher : arrêts   double : retour');
    expect(gare.items[0].action).toEqual({ kind: 'toggleStation' });
  });

  it('CA-M8.6 : temps réel coupé, « Temps réel indisponible : horaires prévus ~ » ; hors ligne, « Pas de réseau »', async () => {
    const b = await fakeCore(() => now, { noRt: true }).board('stib:6357F', { limit: 4 });
    const lines = check(boardView(b, ctxOf(now, settings(), { rt: 'down' }), { kept: false }));
    expect(lines[1]).toBe('T3   Churchill   ~2 min');
    expect(lines).toContain('Temps réel indisponible : horaires prévus ~');
    expect(check(boardView(b, ctxOf(now, settings(), { rt: 'offline' }), { kept: false }))).toContain('Pas de réseau : horaires prévus ~');
  });

  it('zone fusionnée : les modes dans le titre ; « imminent » (S6)', () => {
    const area = { id: 'stib:6357F', op: 'stib' as const, n: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 0, lon: 0, modes: ['tram' as const, 'bus' as const], lines: ['3', '4', '88'] };
    const d: Departure = { op: 'stib', mode: 'tram', line: '3', head: { fr: 'Churchill', nl: 'Churchill' }, sched: now + 20_000, est: now + 20_000, rt: true, delayMin: 0, cancelled: false };
    const v = boardView({ area, departures: [d], anyPlanned: false, rtErrors: [], updatedAt: now }, ctxOf(now, settings()), { kept: true });
    expect(v.title).toBe('Gare du Nord, tram et bus (STIB) ★');
    expect(check(v)[1]).toBe('T3   Churchill   imminent');
  });
});

describe('scénario 3 : l’après-midi vers Gand (S3, 13:55)', () => {
  const now = SCENARIO.s3.now;
  const here = { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon };

  it('CA-M1.4 et CA-M2.5 : le favori de gare à gare en tête, puis ses étapes', async () => {
    const s = settings();
    const a = await answers(now, here, s);
    expect(a.order[0]).toBe('fav-gand');
    // un trajet fixe : son titre, puis le départ conseillé et l'arrivée
    expect(check(homeView(home(a), ctxOf(now, s))).slice(0, 3)).toEqual(['Favoris   3', 'Vers Gand-Saint-Pierre   dans 13 min → 14:39', 'Bureau   maintenant → 14:07']);
    const journeys = a.map.get('fav-gand')!.plan!.journeys;
    const v = stepsPage({ title: 'Vers Gand-Saint-Pierre', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctxOf(now, s));
    expect(nb(page(v).title)).toBe('Vers Gand-Saint-Pierre : 14:10 → 14:39   Suivi');
    const lines = check(v);
    expect(lines[0]).toBe('Le plus court : direct');
    expect(lines[1]).toMatch(/^14:10   IC vers Bruges, voie 4/);
    // 1.2.4 : à bord dès le départ, d'où il part
    expect(lines[2]).toBe('depuis Bruxelles-Central');
    expect(lines[3]).toBe('14:39   Arrivée à Gand-Saint-Pierre');
    expect(lines.slice(-2)).toEqual(['Fin du trajet. ▽ 2 autres trajets', HINT_STEPS]);
    // les autres trajets : « Le suivant », même trajet plus tard (les moyens en 2e ligne)
    expect(check(othersView({ screen: 'others', key: 'g', title: 'Vers Gand-Saint-Pierre', journeys, index: 0 }, journeys, ctxOf(now, s))).slice(0, 4)).toEqual(['Le suivant   14:25 → 14:56', 'IC', 'Plus tard   14:40 → 15:09', 'IC']);
  });

  it('CA-M5.4 : vers un lieu public, train puis tram, « À pied vers l’arrêt du tram »', async () => {
    const s = settings();
    const to = { type: 'address' as const, label: 'Korenmarkt, 9000 Gent', lat: 51.0547, lon: 3.7217 };
    const res = await fakeCore(() => now).route({ type: 'here' }, to, now, s, here);
    const v = stepsPage({ title: 'Vers Korenmarkt', label: '' }, { journeys: res.journeys, index: 0, fresh: true }, ctxOf(now, s));
    expect(v.titleRight).toBe('Suivre ce trajet');
    const lines = check(v);
    expect(lines[0]).toBe('Le plus court : 1 changement, à pied 1 + 1 min');
    expect(lines.slice(1, 8).map((l) => l.replace(/   (dans|en) .*$/, ''))).toEqual([
      '14:10   IC vers Bruges, voie 4',
      'depuis Bruxelles-Central',
      '14:39   Descendre à Gand-Saint-Pierre',
      '14:39   À pied vers l’arrêt du tram (1 min)',
      // 1.2.5 (PRD-1.2.5 § 2) : 4 min entre l'arrivée à pied (14:40) et le tram : la marge
      '14:44   Tram 1 vers Korenmarkt   marge 4 min',
      '14:54   Descendre à Korenmarkt, Gand',
      '▽ suite du trajet : 1 étape',
    ]);
  });

  it('C1 et PRD-1.2.5 § 7 : dans le tram, les arrêts et la ligne de progression « ◎─○─○─○─○   descente dans 4 arrêts »', () => {
    const N = (fr: string) => ({ fr, nl: fr });
    const stop = (fr: string, t: number) => ({ name: N(fr), sched: t, est: t });
    const tram: Leg = {
      kind: 'ride', from: { name: N('Gand-Saint-Pierre'), lat: 0, lon: 0 }, to: { name: N('Korenmarkt'), lat: 0, lon: 0 },
      dep: at(14, 44), arr: at(14, 54), schedDep: at(14, 44), schedArr: at(14, 54), op: 'delijn', mode: 'tram', line: '1', head: N('Korenmarkt'), rt: true,
      stops: [stop('Gand-Saint-Pierre', at(14, 44)), stop('Rooigem', at(14, 46)), stop('Kortrijksepoort', at(14, 49)), stop('Sint-Michielsplein', at(14, 51)), stop('Korenmarkt', at(14, 54))],
    };
    const j: Journey = { id: 't', legs: [tram], dep: tram.dep, arr: tram.arr, leaveAt: tram.dep, transfers: 0, rt: true, alerts: [] };
    const before = trainView(j, 0, ctxOf(at(14, 40), settings()));
    expect(before.top).toEqual({ text: '◎─○─○─○─○   descente dans 4 arrêts' });
    expect(before.title).toBe('Tram 1 vers Korenmarkt');
    const during = trainView(j, 0, ctxOf(at(14, 47), settings()));
    expect(during.top).toEqual({ text: '●─●─◎─○─○   descente dans 3 arrêts' });
    expect(check(during)).toContain('Kortrijksepoort   14:49   prochain');
    expect(trainView(j, 0, ctxOf(at(14, 52), settings())).top).toEqual({ text: '●─●─●─●─◎   descente au prochain arrêt' });
    // arrivé : plus de ligne du haut
    expect(trainView(j, 0, ctxOf(at(14, 55), settings())).top).toBeUndefined();
    // 1.2.5 : le train aussi (1.2.4 : sans ligne du haut)
    const train = { ...tram, mode: 'train' as const, op: 'sncb' as const, cat: 'IC' };
    expect(trainView({ ...j, legs: [train] }, 0, ctxOf(at(14, 47), settings())).top).toEqual({ text: '●─●─◎─○─○   descente dans 3 arrêts' });
    // arrêts inconnus (deux extrémités seulement) : rien
    expect(trainView({ ...j, legs: [{ ...tram, stops: undefined }] }, 0, ctxOf(at(14, 47), settings())).top).toBeUndefined();
  });

  it('arrivée : la suite devant la gare (inchangé)', async () => {
    const t = at(14, 36);
    const b = await fakeCore(() => t).board('delijn:200553', { limit: 8 });
    const deps = b.departures.filter((d) => d.est >= at(14, 39));
    const v = arrivalView('Gand-Saint-Pierre', at(14, 39), deps.slice(0, 2), ctxOf(t, settings()));
    expect(v.title).toBe('Arrivée à Gand-Saint-Pierre');
    const lines = check(v);
    expect(lines[0]).toBe('Dans 3 min. Ensuite, devant la gare :');
    expect(lines.at(-1)).toBe('toucher : ★ garder ce trajet   double : retour');
  });
});

describe('trajet à pied, déjà sur place, états vides et messages', () => {
  it('CA-M2.7 : trajet entièrement à pied, deux étapes, toucher sans effet, rien à suivre', async () => {
    const now = at(10, 0);
    const s = settings();
    const here = { lat: 50.848, lon: 4.352 };
    const res = await fakeCore(() => now).route({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, s, here);
    const j = res.journeys[0];
    expect(j.legs.some((l) => l.kind === 'ride')).toBe(false);
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: res.journeys, index: 0, followedId: j.id, fresh: true }, ctxOf(now, s));
    expect(v.titleRight).toBeUndefined();
    const lines = check(v);
    expect(lines[0]).toBe('Le plus court : à pied, 9 min');
    expect(lines[1]).toMatch(/^10:00   Partir à pied \(9 min\)/);
    expect(lines[2]).toBe('10:09   Arrivée au bureau');
    expect(lines.slice(-2)).toEqual(['Fin du trajet. Pas d’autre trajet pour l’instant', '△▽ étapes   double : retour']);
    expect(v.tap).toBeUndefined();
    expect(lines.join(' ')).not.toMatch(/direct/);
  });

  it('CA-M1.5 : déjà au bureau, « tu y es » sans 2e ligne, « Tu es déjà au bureau. »', async () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const { entries, order } = await answers(now, { lat: 50.8441, lon: 4.3474 }, s);
    // « tu y es » : en fin de liste (règle 5), avec les favoris sans rien dans les 3 heures
    expect(order.indexOf('fav-bureau')).toBeGreaterThanOrEqual(order.length - 2);
    const v = favoritesView({ entries }, ctxOf(now, s));
    const item = v.items.find((i) => i.a === 'Bureau')!;
    expect([item.c, item.b2, item.two]).toEqual(['tu y es', undefined, undefined]);
    expect(check(alreadyThereView('Vers le bureau', ctxOf(now, s)))[0]).toBe('Tu es déjà au bureau.');
    expect(check(alreadyThereView('Vers la maison', ctxOf(now, s)))[0]).toBe('Tu es déjà à la maison.');
  });

  it('CA-M1.8 : sans position, « sans position » ; le trajet fixe part de sa gare ; les trois rubriques : leur contenu', async () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const v = homeView(home(await answers(now, null, s), { noPosition: true, nearbyCount: undefined }), ctxOf(now, s));
    expect(check(v)).toEqual([
      'Favoris   3',
      'Bureau   sans position',
      'Vers Gand-Saint-Pierre   07:40 → 08:09',
      'Maison   sans position',
      'Autour de moi   sans position',
      ...SECTIONS,
      HINT_HOME,
    ]);
  });

  it('favoris en calcul : « … » sur leur ligne ; aucun favori ; accueil sans favoris ; « à choisir » (CA-122.1, § 1.3)', () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const v = homeView({ favorites: s.favorites.slice(0, 3).map((fav) => ({ fav })), nearbyCount: 3 }, ctxOf(now, s));
    // une ligne par favori, même en calcul (rien ne saute quand la réponse arrive) ; rubriques en calcul : « … »
    expect(v.items.slice(1, 4).map((i) => [i.b, i.bRight, i.two])).toEqual([['Bureau', '…', undefined], ['Vers Gand-Saint-Pierre', '…', undefined], ['Maison', '…', undefined]]);
    expect(check(v)).toEqual(['Favoris   3', 'Bureau   …', 'Vers Gand-Saint-Pierre   …', 'Maison   …', 'Autour de moi   3 arrêts', ...SECTIONS, HINT_HOME]);
    // aucun favori : « Ajouter un favori » ouvre « Favoris », où « Ajouter un favori » dit comment faire
    const none = { ...s, favorites: [] };
    const empty = homeView({ nearbyCount: 3, near: 'Namur' }, ctxOf(now, none));
    expect(check(empty)).toEqual(['Près de Namur', 'Ajouter un favori', '', 'Autour de moi   3 arrêts', ...SECTIONS, HINT_HOME]);
    expect(empty.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    const list = favoritesView({}, ctxOf(now, none));
    expect(list.screen).toBe('favorites');
    expect(check(list)).toEqual(['Ajouter un favori   sur le téléphone', 'Autre adresse   sur le téléphone', '△▽ choisir   toucher : ouvrir   double : retour']);
    expect(list.items[0].action).toEqual({ kind: 'open', route: { screen: 'message', kind: 'info', title: 'Favoris', lines: ['Aucun favori pour l’instant.', 'Ajoute Maison ou Bureau sur le téléphone.'] } });
    expect(favoritesView({}, ctxOf(now, none, { web: true })).items[0]).toMatchObject({ a: 'Ajouter un favori', c: 'dans Réglages', action: { kind: 'phone', hash: '#/favoris/nouveau', text: 'Ajoute Maison ou Bureau dans l’onglet Réglages.' } });
    // « Accueil sans favoris » : « Favoris   3 » sans favori dessous (il ouvre la liste) et « Près de … »
    const plain = homeView({ noFavorites: true, favorites: s.favorites.slice(0, 3).map((fav) => ({ fav })), nearbyCount: 3, near: 'Namur' }, ctxOf(now, s));
    expect(check(plain)).toEqual(['Près de Namur', 'Favoris   3', '', 'Autour de moi   3 arrêts', ...SECTIONS, HINT_HOME]);
    expect(plain.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    // aide des gestes passée (7 premiers jours, contrôleur) : plus de pied du tout
    expect(check(homeView({ noFavorites: true, nearbyCount: 3, gestureHelp: false }, ctxOf(now, s))).at(-1)).toBe('Lignes de bus, tram, métro   2 lignes');
    // rubriques vides : « à choisir » ; toucher : où les choisir (Quai Web : l'ajout de l'onglet Réglages, #/…/ajouter)
    const bare: Settings = { ...s, stations: [], lines: [], follows: [] };
    const b = homeView({ favorites: [], nearbyCount: 3 }, ctxOf(now, bare));
    expect(check(b).slice(-4)).toEqual(['Gares de train   à choisir', 'Arrêts de bus, tram, métro   à choisir', 'Lignes de bus, tram, métro   à choisir', HINT_HOME]);
    expect(b.items.slice(-3).map((i) => i.action)).toEqual([
      { kind: 'phone', hash: '#/gares/ajouter', text: 'Choisis tes gares dans Quai, sur le téléphone' },
      { kind: 'phone', hash: '#/arrets/ajouter', text: 'Choisis tes arrêts dans Quai, sur le téléphone' },
      { kind: 'phone', hash: '#/lignes/ajouter', text: 'Choisis tes lignes dans Quai, sur le téléphone' },
    ]);
    const bw = homeView({ favorites: [], nearbyCount: 3 }, ctxOf(now, bare, { web: true }));
    expect(bw.items.slice(-3).map((i) => i.action)).toEqual([
      { kind: 'phone', hash: '#/gares/ajouter', text: 'Choisis tes gares dans l’onglet Réglages' },
      { kind: 'phone', hash: '#/arrets/ajouter', text: 'Choisis tes arrêts dans l’onglet Réglages' },
      { kind: 'phone', hash: '#/lignes/ajouter', text: 'Choisis tes lignes dans l’onglet Réglages' },
    ]);
    // les rubriques vides, ouvertes quand même (retirées pendant qu'on les regarde) : où les choisir
    expect(check(stationsView([], ctxOf(now, bare)))).toEqual(['Choisis tes gares dans Quai, sur le téléphone.', 'double toucher : retour']);
    expect(check(linesView([], ctxOf(now, bare)))).toEqual(['Choisis tes arrêts dans Quai, sur le téléphone.', 'double toucher : retour']);
    expect(check(followsView([], ctxOf(now, bare)))).toEqual(['Choisis tes lignes dans Quai, sur le téléphone.', 'double toucher : retour']);
  });

  it('REVUE-USAGE n° 1 : « En cours » au-dessus de « Favoris », sans répéter son favori ; le prochain véhicule et sa voie', async () => {
    const now = at(7, 36);
    const s = settings();
    const a = await answers(now, { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon }, s);
    const v = homeView(home(a, { running: { title: 'Vers le bureau', next: 'IC 07:42 +2 voie 6 !', favoriteId: 'fav-bureau' } }), ctxOf(now, s));
    expect(check(v).slice(0, 3)).toEqual(['En cours : vers le bureau   IC 07:42 +2 voie 6 !', 'Favoris   3', 'Vers Gand-Saint-Pierre   07:40 → 08:09']);
    expect(v.items[0].action).toEqual({ kind: 'resume' });
    expect(v.log).toMatchObject({ shown: ['fav-gand'] });
    expect(page(v).visible).toBe(v.items.length);
  });

  it('messages : bienvenue, « Quai 1.2.6 », erreur au lancement, attente, « Autour de moi » vide', async () => {
    const ctx = ctxOf(SCENARIO.s2.now, settings());
    expect(check(firstRunView(ctx))).toEqual([
      'Bienvenue dans Quai !',
      'Termine les réglages sur le téléphone :',
      'appli Even Realities, onglet Even Hub, Quai.',
      'Position, langue et tes favoris, en une minute.',
      'toucher : continuer   double : quitter',
    ]);
    expect(check(firstRunView({ ...ctx, web: true })).at(-2)).toBe('position, langue et tes favoris, en une minute.');
    // PRD-1.2.8 § 4 : un seul message ; depuis la 1.2.7 ou la 1.2.6, les lignes de la 1.2.8 ; d'avant, aussi celles de
    // la 1.2.6 (une version entière ou rien : la 1.2.5 ne tient plus) ; espace insécable devant « : »
    const news = newsView(ctx, newsLines('1.2.7'));
    expect(news.title).toBe('Quai 1.2.8');
    expect(check(news)).toEqual(['Un train : tout son trajet, gares d’avant comprises.', 'Chaque gare : sa voie et dans combien de temps.', '● : là où le train arrive, d’après le temps réel.', 'toucher : continuer']);
    expect(check(newsView(ctx, newsLines('1.2.5'))).slice(3, 8)).toEqual([
      'Arrêts et lignes de bus, tram, métro, séparés.',
      'Une ligne : tout son parcours, l’attente à chaque arrêt.',
      'Dans les deux sens, sans choisir d’arrêt.',
      'Tes lignes gardées y sont déjà.',
      'toucher : continuer',
    ]);
    expect(newsLines('1.1.0')).toEqual(newsLines('1.2.4'));
    expect(newsLines('1.2.4')).toEqual(newsLines('1.2.5'));
    expect(newsLines('1.2.5')).toEqual([...NEWS_LINES_128, ...NEWS_LINES]);
    expect(news.tap).toEqual({ kind: 'continue' });
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.0')).items).toEqual(newsView(ctx, newsLines('1.2.0')).items);
    const root = errorView('Quai', 'Pas de connexion aux horaires : nouvel essai dans 30 s', ctx, { root: true });
    expect(check(root)).toEqual(['Pas de connexion aux horaires : nouvel essai dans 30 s', 'toucher : réessayer   double : quitter']);
    expect(check(errorView('Autour de moi', 'Pas de réseau : réessaie dans un instant.', ctx)).at(-1)).toBe('toucher : réessayer   double : retour');
    expect(check(loadingView('Autour de moi', 'Recherche des arrêts…', ctx))).toEqual(['Recherche des arrêts…', 'double toucher : retour']);
    // REVUE-USAGE n° 10 : vide, l'arrêt le plus proche (toucher : ses départs), sinon où régler le rayon
    expect(check(nearbyView([], ctx))).toEqual(['Aucun arrêt à moins de 500 m.', 'Rayon réglable sur le téléphone : Affichage.', 'double toucher : retour']);
    expect(check(nearbyView([], { ...ctx, web: true }))[1]).toBe('Rayon réglable dans l’onglet Réglages : Affichage.');
    // (recherche légère du contrôleur dans 3 km, ici autour de la Grand-Place : Bourse, placée à 1,2 km pour l'exemple)
    const [nearest] = await fakeCore(() => ctx.now).nearby(50.8467, 4.3525, 3000, { light: true });
    expect(nearest.area.id).toBe('stib:6362');
    const far = nearbyView([], ctx, { ...nearest, distanceM: 1200 });
    expect(check(far)).toEqual(['Aucun arrêt à moins de 500 m.', 'Le plus proche : Bourse, à 1,2 km.', 'toucher : ses départs   double : retour']);
    expect(far.tap).toEqual({ kind: 'open', route: { screen: 'board', areaId: nearest.area.id, name: nearest.area.n } });
    expect(check(notConfiguredView(ctx))[0]).toBe('Quai n’est pas encore configuré.');
  });

  it('aperçu du téléphone (1.0) : stepsView avec un seul trajet, non suivi', async () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const { map } = await answers(now, { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon }, s);
    const j = map.get('fav-bureau')!.plan!.journeys[0];
    const v = stepsView({ label: 'bureau', leaveAt0: j.leaveAt }, j, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers le bureau : 07:35 → 08:58');
    expect(v.titleRight).toBe('Suivre ce trajet');
    // 7 étapes, la 1re sur 2 lignes (1.2.4), pour 6 lignes : la suite d'abord ; au bout, aucune autre proposition
    expect(check(v).at(-2)).toBe('▽ suite du trajet : 2 étapes');
    const end = stepsPage({ label: 'bureau' }, { journeys: [j], index: 0, leaveAt0: j.leaveAt, top: 1 }, ctxOf(now, s));
    expect(checkAt(end, 1).slice(-3)).toEqual(['08:58   Arrivée au bureau (9 min à pied)', 'Fin du trajet. Pas d’autre trajet pour l’instant', HINT_OTHER]);
  });
});

describe('lendemain, horaires périmés, destinations STIB', () => {
  const late = at(23, 30);
  const T = (hh: number, mm: number, day = 0) => at(hh, mm) + day * 86_400_000;
  const N = (fr: string, nl = fr) => ({ fr, nl });
  const ctx = (patch: Partial<{ stale: string }> = {}): ViewCtx => ({ now: late, settings: settings(), ...patch });
  const nord = { id: 'sncb:8812005', op: 'sncb' as const, n: N('Bruxelles-Nord', 'Brussel-Noord'), lat: 50.86, lon: 4.36, modes: ['train' as const], lines: ['IC'] };
  const train = (p: Partial<Departure>): Departure => ({ op: 'sncb', mode: 'train', line: 'IC', head: N('Anvers-Central'), sched: T(23, 52), est: T(23, 52), rt: true, delayMin: 0, cancelled: false, platform: '9', ...p });
  const board = (area: Board['area'], departures: Departure[]): Board => ({ area, departures, anyPlanned: true, rtErrors: [], updatedAt: late });

  it('tableau train : « demain, » à partir de 04:00 seulement ; tous demain : « Départs de demain » (S6)', () => {
    const b = board(nord, [train({}), train({ sched: T(0, 1, 1), est: T(0, 1, 1), rt: false }), train({ sched: T(8, 42, 1), est: T(8, 42, 1), rt: false, platform: '12', head: N('Louvain-la-Neuve-Université-Centre-Sud') })]);
    const lines = check(boardView(b, ctx(), { kept: false }));
    expect(lines[0]).toBe('★ garder la gare');
    expect(lines[1]).toBe('IC   Anvers-Central   23:52  voie 9');
    expect(lines[2]).toBe('IC   Anvers-Central   ~00:01  voie 9');
    expect(lines[3]).toMatch(/^IC   demain, Louvain-la-Neuve.*   ~08:42  voie 12$/);
    const tomorrow = boardView(board(nord, [train({ sched: T(6, 2, 1), est: T(6, 2, 1), rt: false }), train({ sched: T(7, 2, 1), est: T(7, 2, 1), rt: false })]), ctx(), { kept: false });
    expect(tomorrow.top).toEqual({ text: 'Départs de demain' });
    expect(check(tomorrow).slice(0, 4)).toEqual(['Départs de demain', '★ garder la gare', 'IC   Anvers-Central   ~06:02  voie 9', 'IC   Anvers-Central   ~07:02  voie 9']);
  });

  it('tableau bus : « demain, » au-delà d’une heure, compte à rebours sinon', () => {
    const dl = { ...nord, id: 'delijn:308611', op: 'delijn' as const, n: N('Bruxelles-Nord', 'Brussel Noordstation'), modes: ['bus' as const], lines: ['232'] };
    const bus = (est: number): Departure => ({ op: 'delijn', mode: 'bus', line: '232', head: N('Vilvorde', 'Vilvoorde'), sched: est, est, rt: false, delayMin: 0, cancelled: false });
    const lines = check(boardView(board(dl, [bus(T(0, 10, 1)), bus(T(6, 0, 1))]), ctx(), { kept: false }));
    expect(lines.slice(0, 3)).toEqual(['★ garder une ligne', '232   Vilvorde   ~40 min', '232   demain, Vilvorde   ~06:00']);
  });

  it('étapes, adresses récentes de « Favoris » et train : le lendemain est dit', () => {
    const ride: Leg = {
      kind: 'ride', from: { name: N('Bruxelles-Central'), lat: 50.845, lon: 4.357, areaId: 'sncb:8813003' }, to: { name: N('Gand-Saint-Pierre'), lat: 51.03, lon: 3.71, areaId: 'sncb:8892007' },
      dep: T(14, 10, 1), arr: T(14, 39, 1), schedDep: T(14, 10, 1), schedArr: T(14, 39, 1), op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruges'), rt: false, delayMin: 0, cancelled: false, platform: '4',
    };
    const walk: Leg = { kind: 'walk', from: { name: N('Ma position'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Central'), lat: 0, lon: 0 }, dep: T(13, 58, 1), arr: T(14, 10, 1), schedDep: T(13, 58, 1), schedArr: T(14, 10, 1), walkMin: 12 };
    const door: Journey = { id: 'j1', legs: [walk, ride], dep: walk.dep, arr: ride.arr, leaveAt: T(13, 56, 1), transfers: 0, rt: false, alerts: [] };
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [door], index: 0 }, ctx());
    expect(nb(v.title)).toBe('Vers le bureau : demain 13:56 → 14:39');
    expect(nb(planHomeText({ journeys: [door] }, late))).toBe('demain 13:56 → 14:39');
    expect(trainView(door, 1, ctx()).title).toBe('IC vers Bruges, demain');
  });

  it('horaires périmés : le message de fraîcheur remplace « aucun départ » et les listes vides', () => {
    const stale = 'Horaires périmés : mise à jour arrêtée le 02/11';
    expect(check(boardView(board(nord, []), ctx({ stale }), { kept: false })).slice(0, 2)).toEqual(['★ garder la gare', stale]);
    expect(check(boardView(board(nord, []), ctx(), { kept: false })).slice(0, 2)).toEqual(['★ garder la gare', 'aucun départ']);
    expect(check(nearbyView([{ area: nord, distanceM: 160, walkMin: 3 }], ctx({ stale })))).toContain(stale);
    const h = homeView({ stale, nearbyCount: 2 }, ctx({ stale }));
    expect(h.top).toEqual({ text: stale, strong: true });
  });

  it('STIB : « Stalle » sans « (P) » dans les étapes et le titre du tram ; le véhicule en toutes lettres (REVUE-USAGE n° 8)', () => {
    const t4: Leg = {
      kind: 'ride', from: { name: N('Gare du Nord'), lat: 0, lon: 0 }, to: { name: N('Bourse'), lat: 0, lon: 0 },
      dep: T(23, 40), arr: T(23, 50), schedDep: T(23, 40), schedArr: T(23, 50), op: 'stib', mode: 'tram', line: '4', head: N('Stalle (P)'), rt: true,
    };
    const j: Journey = { id: 'j', legs: [t4], dep: t4.dep, arr: t4.arr, leaveAt: t4.dep, transfers: 0, rt: true, alerts: [] };
    const sv = check(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0 }, ctx()));
    expect(sv.some((l) => /^23:40   Tram 4 vers Stalle/.test(l))).toBe(true);
    expect(trainView(j, 0, ctx()).title).toBe('Tram 4 vers Stalle');
  });
});

describe('largeurs au pixel (CA-M1.7) : accueil, « Favoris » et les écrans de la 1.2.2 des scénarios S1 à S3, sans « … »', () => {
  for (const [name, sc, flags] of [
    ['S1 base', SCENARIO.s1, {}],
    ['S1 noRT', SCENARIO.s1, { noRt: true }],
    ['S2 base', SCENARIO.s2, {}],
    ['S3 base', SCENARIO.s3, {}],
  ] as const) {
    it(name, async () => {
      const s = settings();
      const here = { lat: sc.lat, lon: sc.lon };
      const a = await answers(sc.now, here, s, flags);
      const ctx = ctxOf(sc.now, s, { rt: 'noRt' in flags ? 'down' : 'ok' });
      // accueil : titres dans la colonne a, favoris en retrait dans la colonne b, réponses et départs à droite (210 px)
      const h = homeView(home(a), ctx);
      for (const it of h.items) {
        const right = nb(it.c ?? '');
        expect(textWidth(it.a), it.a).toBeLessThanOrEqual(right ? WIDTHS.wideLeft : WIDTHS.full);
        expect(textWidth(right), right).toBeLessThanOrEqual(WIDTHS.wideRight);
        if (it.bRight) expect(textWidth(it.bRight), it.bRight).toBeLessThanOrEqual(WIDTHS.wideRight);
      }
      const hp = page(h);
      const colB = hp.containers.find((c) => c.name === 'colB')!;
      expect(colB).toMatchObject({ x: GEO.X_TEXT + HOME_INDENT, level: 2 });
      // nom et réponse sur une ligne de la colonne b, au pixel
      for (const row of colB.content.split('\n')) expect(textWidth(row), row).toBeLessThanOrEqual(WIDTHS.homeRow);
      expect(overflowing(hp)).toEqual([]);
      expect(hp.visible).toBe(h.items.length);
      expect(hp.lines.filter((l) => l.includes('…'))).toEqual([]);
      // « Favoris » : deux lignes par favori, au format de l'accueil
      const list = favoritesView({ entries: a.entries }, ctx);
      for (const it of list.items) {
        const right = nb(it.c ?? '');
        expect(textWidth(it.a), it.a).toBeLessThanOrEqual(right ? WIDTHS.wideLeft : WIDTHS.full);
        expect(textWidth(right), right).toBeLessThanOrEqual(WIDTHS.wideRight);
        if (it.b2) expect(textWidth(it.b2), it.b2).toBeLessThanOrEqual(WIDTHS.full);
      }
      const lp = page(list);
      expect(overflowing(lp)).toEqual([]);
      expect(lp.lines.filter((l) => l.includes('…'))).toEqual([]);
      // « Gares », « Bus, tram, métro » (avec le bus W à Merbraine : passages partiels), détail de chaque ligne
      const core = fakeCore(() => sc.now, flags);
      const picks = [...s.lines, W_MERBRAINE];
      const views = [stationsView(await stationRows(core, sc.now, s), ctx), linesView(await lineRows(core, picks), ctx)];
      for (const p of picks.filter((x) => x.line)) views.push(lineView(lineRoute(p), await core.lineBoard(p.areaId, p.line!, { perDirection: 5 }), ctx));
      const gdn = await core.board('stib:6357F', { limit: 5 });
      views.push(keepLineView({ screen: 'keepLine', areaId: 'stib:6357F', op: 'stib', name: gdn.area.n, lat: gdn.area.lat, lon: gdn.area.lon }, await stopLines(core, 'stib:6357F'), ctx));
      for (const v of views) {
        const g = geometry(v);
        for (let top = 0; top < v.items.length; top++) {
          const p = layoutPage(v, v.scroll ? { sel: -1, top } : { sel: Math.min(top, v.items.length - 1), top: Math.max(0, top - g.capacity + 1) });
          expect(overflowing(p), `${v.title} ${top}`).toEqual([]);
          for (const l of [p.title, ...p.lines]) {
            expect(l).not.toMatch(/[—–]/);
            expect(l.includes('…'), `${v.title} : ${l}`).toBe(false);
          }
        }
      }
    });
  }
});
