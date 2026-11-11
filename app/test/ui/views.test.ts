/**
 * Écrans des lunettes (PRD 1.1 § 6.1, mis à jour pour la 1.2.1 : docs/v1.2.1/PRD-1.2.1.md § 3, § 4 et § 6) : textes
 * exacts, états vides, largeur au pixel de chaque ligne dans sa colonne.
 * Données : faux cœur (fixtures, scénarios S1 à S3), réponses et ordre des favoris du cœur. 1.2.1 : le faux cœur classe
 * « le moins de marche d'abord » ; à S1, la proposition 1 vers le bureau est l'IC jusqu'à Bruxelles-Nord puis le T4
 * (marches 7 + 2 + 9 min, arrivée 09:01) plutôt que l'IC jusqu'à Bruxelles-Central et 12 min à pied (arrivée 09:00).
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, FavoriteAnswer, Journey, Leg, LatLon, Settings } from '../../src/core/api';
import type { FakeFlags } from '../../src/dev/fake-core';
import { layoutPage, geometry, GEO, HOME_INDENT, WIDTHS } from '../../src/glasses/layout';
import { textWidth } from '../../src/glasses/font';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { GlassesView } from '../../src/glasses/types';
import {
  alreadyThereView,
  arrivalView,
  boardView,
  errorView,
  favoritesView,
  firstRunView,
  homeView,
  loadingView,
  nearbyView,
  newsLines,
  newsView,
  notConfiguredView,
  othersView,
  placeSummary,
  placesView,
  stepsPage,
  stepsView,
  trainView,
  type FavoriteEntry,
  type HomeData,
  type ViewCtx,
} from '../../src/glasses/views';
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

/** Données de l'accueil comme le contrôleur les donne (PRD-1.2.1 § 4.2) : les 3 premiers favoris, sans la règle 5. */
function home(a: { entries: FavoriteEntry[]; order: string[]; last?: Set<string> }, patch: Partial<HomeData> = {}): HomeData {
  return { favorites: a.entries.filter((e) => !a.last?.has(e.fav.id)).slice(0, 3), order: a.order, nearbyCount: 3, ...patch };
}

const HINT_HOME = '▲▼ choisir   toucher : ouvrir   double : quitter';
const HINT_STEPS = '▲▼ étapes   toucher : détail   double : retour';
const HINT_OTHER = '▲▼ étapes   toucher : suivre ce trajet   double : retour';

const ctxOf = (now: number, s: Settings, patch: Partial<ViewCtx> = {}): ViewCtx => ({ now, settings: s, ...patch });

describe('scénario 1 : le matin, vers le bureau (S1, 07:31)', () => {
  const now = SCENARIO.s1.now;
  const here = { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon };

  it('CA-M1.1 et CA-121.5 : accueil sans temps réel : « Favoris », 3 favoris en retrait sur une ligne, sans « ~ » ni note', async () => {
    const s = settings();
    const a = await answers(now, here, s, { noRt: true });
    expect(a.order.slice(0, 3)).toEqual(['fav-bureau', 'fav-namur', 'fav-gdn']);
    const v = homeView(home(a), ctxOf(now, s, { rt: 'down' }));
    expect(v.log).toEqual({ order: a.order, shown: ['fav-bureau', 'fav-namur', 'fav-gdn'] });
    // sans « ~ » sur l'accueil, qui n'en affiche plus (les autres écrans gardent « horaires prévus ~ »)
    expect(nb(v.top?.text ?? '')).toBe('Temps réel indisponible : horaires prévus');
    expect(v.top?.strong).toBeUndefined();
    // titre de section et son nombre (colonnes a et c), favoris en retrait (nom et réponse dans la colonne b), sans « ~ »
    const all = v.items.map((i) => [i.a, i.b ?? '', nb(i.c ?? i.bRight ?? '')]);
    expect(all).toEqual([
      ['Favoris', '', '6'],
      ['', 'Bureau', 'dans 2 min → 08:58'],
      ['', 'Namur, train', 'IC 07:42 voie 4'],
      ['', 'Gare du Nord, tram', 'T3 1 min'],
      ['Autour de moi', '', '3 arrêts'],
      ['Aller à…', '', ''],
    ]);
    expect(v.items[4].gap).toBe(true);
    expect(v.items.slice(1, 4).every((i) => !i.c && i.bRight)).toBe(true);
    // curseur à l'ouverture sur le premier favori
    expect(v.initialSel).toBe(1);
    const lines = check(v);
    // plus de note « ~ » sur l'accueil (§ 4.5) : « Aller à… » reste à l'écran même avec la ligne du haut
    expect(lines).not.toContain('~ horaire prévu, sans temps réel');
    expect(lines.some((l) => l.startsWith('Près de'))).toBe(false);
    expect(lines.slice(1)).toEqual(['Favoris   6', 'Bureau   dans 2 min → 08:58', 'Namur, train   IC 07:42 voie 4', 'Gare du Nord, tram   T3 1 min', '', 'Autour de moi   3 arrêts', 'Aller à…', HINT_HOME]);
    const p = page(v);
    expect(p.visible).toBe(v.items.length);
    expect(p.sel).toBe(1);
    // relief : sections et nombres au niveau 4, favoris (nom et réponse) au niveau 2
    expect(p.containers.filter((c) => ['colA', 'colB', 'colC'].includes(c.name)).map((c) => [c.name, c.level])).toEqual([['colA', 4], ['colB', 2], ['colC', 4]]);
  });

  it('CA-M1.2 : temps réel, retard et voie modifiée, sur une ligne (le détail est sur la page du trajet)', async () => {
    const s = settings();
    const lines = check(homeView(home(await answers(now, here, s)), ctxOf(now, s, { rt: 'ok' })));
    expect(lines.slice(0, 4)).toEqual(['Favoris   6', 'Bureau   dans 4 min → 09:01', 'Namur, train   IC 07:42 +2 voie 6 !', 'Gare du Nord, tram   T3 1 min']);
    expect(lines).toContain('Aller à…');
  });

  it('CA-M2.1 : étapes du trajet suivi, l’alerte passe avant la raison, « ▶ » sur la 1re étape ; ▼ : la suite', async () => {
    const s = settings();
    const { map } = await answers(now, here, s);
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, leaveAt0: journeys[0].leaveAt, fresh: true }, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers le bureau : 07:35 → 09:01');
    expect(v.log).toEqual({ page: 1, pages: 3, label: 'short', followed: true });
    // IC jusqu'à Bruxelles-Nord, puis le T4 : 7 étapes pour 6 lignes, la dernière est annoncée en bas
    expect(check(v)).toEqual([
      '! Voie modifiée : l’IC part de la voie 6',
      '07:35   Partir à pied vers la gare (7 min)   dans 4 min',
      '07:42   IC vers Bruxelles-Midi, voie 6   +2 min',
      '08:42   Descendre à Bruxelles-Nord',
      '08:42   À pied vers Gare du Nord (2 min)',
      '~08:47   T4 vers Stalle',
      '08:52   Descendre à Bourse',
      '▼ suite du trajet : 1 étape',
      HINT_STEPS,
    ]);
    expect(page(v).sel).toBe(0);
    expect(v.tap).toMatchObject({ kind: 'open', route: { screen: 'train', leg: 1 } });
    // au bout : « Fin du trajet. ▼ 2 autres trajets »
    const end = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, leaveAt0: journeys[0].leaveAt, top: 1 }, ctxOf(now, s));
    expect(checkAt(end, 1).slice(-3)).toEqual(['09:01   Arrivée au bureau (9 min à pied)', 'Fin du trajet. ▼ 2 autres trajets', HINT_STEPS]);
  });

  it('CA-M2.2 : sans temps réel, la raison ; « Autres trajets » ; une autre proposition, non suivie ; une seule', async () => {
    const s = settings();
    const { map } = await answers(now, here, s, { noRt: true });
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    expect(journeys.map((j) => j.label)).toEqual(['short', 'none', 'next']);
    const ctx = ctxOf(now, s);
    const p1 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctx);
    const l1 = check(p1);
    expect(l1[0]).toBe('Le plus court : 1 changement, à pied 7 + 2 + 9 min');
    expect(l1.slice(-2)).toEqual(['▼ suite du trajet : 1 étape', HINT_STEPS]);
    // ▼ au bout : « Autres trajets », la raison ou les moyens en 2e ligne
    const list = othersView({ screen: 'others', key: 'k', title: 'Vers le bureau', journeys, index: 0 }, journeys, ctx);
    expect(nb(list.title)).toBe('Vers le bureau : autres trajets');
    expect(check(list)).toEqual(['Sans changement   07:33 → 08:58', 'IC, à pied 7 + 12 min', 'Le suivant   08:33 → 10:02', 'IC + tram 3, à pied 7 + 2 + 9 min', '▲▼ choisir   toucher : voir   double : retour']);
    // « Le suivant », ouvert depuis la liste : non suivi, sans « ▶ », toucher le fait suivre
    const p3 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 2, followedId: journeys[0].id, fromList: true }, ctx);
    expect(nb(p3.title)).toBe('Vers le bureau : 08:33 → 10:02');
    expect(p3.log).toEqual({ page: 3, pages: 3, label: 'next', followed: false });
    const l3 = check(p3);
    expect(l3[0]).toBe('Le suivant : même trajet, 1 h plus tard');
    expect(l3).toContain('~08:42   IC vers Bruxelles-Midi, voie 4');
    expect(l3.slice(-2)).toEqual(['▼ suite du trajet : 1 étape', HINT_OTHER]);
    expect(page(p3).sel).toBe(-1);
    expect(p3.tap).toEqual({ kind: 'follow' });
    const p3end = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 2, followedId: journeys[0].id, fromList: true, top: 1 }, ctx);
    expect(checkAt(p3end, 1).slice(-3)).toEqual(['10:02   Arrivée au bureau (9 min à pied)', 'Fin du trajet. ▼ autres trajets', HINT_OTHER]);
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
    expect(check(v2)[2]).toBe('07:42   IC vers Bruxelles-Midi, voie 6   en cours');
    expect(page(v2).sel).toBe(1);
    // 08:50 : dans le T4 (08:47 → 08:52), le repère est sur le tram
    const inTram = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, followedId: j.id, fresh: true }, ctxOf(at(8, 50), s));
    expect(page(inTram).sel).toBe(4);
    expect(check(inTram)).toContain('~08:47   T4 vers Stalle   en cours');
  });

  it('dans le train : arrêts, aide « ▲▼ arrêts   double : retour » (L4)', async () => {
    const s = settings();
    const { map } = await answers(now, here, s);
    const t = at(8, 5);
    const j = await fakeCore(() => t).refresh(map.get('fav-bureau')!.plan!.journeys[0], s);
    const v = trainView(j, 1, ctxOf(t, s));
    expect(nb(v.title)).toBe('IC vers Bruxelles-Midi, +2 min');
    const p = page(v);
    expect(p.lines.map(nb)).toContain('Ottignies   08:11   prochain');
    // 1.2.1 : l'IC du trajet du bureau s'arrête à Bruxelles-Nord (puis le T4)
    expect(p.lines.map(nb)).toContain('Bruxelles-Nord   08:42   descente');
    expect(nb(p.lines.at(-1)!)).toBe('▲▼ arrêts   double : retour');
    expect(v.top).toBeUndefined();
    expect(overflowing(p)).toEqual([]);
  });

  it('autour de moi : trois zones, aide avec « double : retour » (L7)', async () => {
    const list = await fakeCore(() => now).nearby(here.lat, here.lon, 500);
    const lines = check(nearbyView(list, ctxOf(now, settings())));
    expect(lines[0]).toMatch(/^Namur Place Léopold, bus TEC   150 m   /);
    expect(lines[1]).toMatch(/^Namur, train   420 m   IC 07:42/);
    expect(lines.at(-1)).toBe('▲▼ arrêt   toucher : départs   double : retour');
  });

  it('CA-2.2 : « Aller à… » : les lieux des favoris, adresses récentes (S4), « Autre adresse   sur le téléphone » (L8)', async () => {
    const s = settings();
    s.recent = [
      { label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 3 },
      { label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, at: 2 },
      { label: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648, at: 1 },
      { label: 'Avenue Winston Churchill 100, 1180 Uccle', lat: 50.808, lon: 4.365, at: 0 },
    ];
    const v = placesView({ 'fav-bureau': 'arrivée 08:58', 'fav-maison': 'ici', 'recent:Veldstraat 1, 9000 Gent': 'arrivée 10:51' }, ctxOf(now, s));
    // 1.2 : les lieux sont des favoris, dans l'ordre du téléphone (Bureau, puis Maison).
    expect(check(v)).toEqual(['Bureau   arrivée 08:58', 'Maison   ici', 'Veldstraat 1   arrivée 10:51', 'Rue Neuve 1   …', 'Rue de Fer 25   …', 'Autre adresse   sur le téléphone', '▲▼ choisir   toucher : trajet   double : retour']);
    expect(v.items[0].action).toEqual({ kind: 'go', key: 'fav-bureau', to: { type: 'place', placeId: 'fav-bureau' }, label: 'Bureau' });
    expect(v.items[2].action).toEqual({ kind: 'go', key: 'recent:Veldstraat 1, 9000 Gent', to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 }, label: 'Veldstraat 1' });
    expect(v.items.at(-1)!.action).toEqual({ kind: 'toast', text: 'Tape l’adresse dans Quai, sur le téléphone' });
    // sans lieu (arrêts et trajets fixes seulement) : « Aucun lieu enregistré » ; Quai Web : « Nouveau favori »
    const noPlace = { ...s, favorites: s.favorites.filter((f) => f.kind !== 'place'), recent: [] };
    expect(check(placesView({}, ctxOf(now, noPlace)))).toEqual(['Aucun lieu enregistré   sur le téléphone', 'Autre adresse   sur le téléphone', '▲▼ choisir   toucher : trajet   double : retour']);
    const web = placesView({}, ctxOf(now, noPlace, { web: true }));
    expect(web.items.map((i) => i.action)).toEqual([
      { kind: 'phone', hash: '#/favoris/nouveau', text: 'Ajoute Maison ou Bureau dans l’onglet Réglages' },
      { kind: 'phone', hash: '#/recherche', text: 'Tape l’adresse dans l’onglet Réglages' },
    ]);
    const js = (await fakeCore(() => now).route({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, s, here)).journeys;
    expect(placeSummary(js, now)).toBe('arrivée 09:01');
  });
});

describe('scénario 2 : en ville, gare du Nord (S2, 12:10)', () => {
  const now = SCENARIO.s2.now;
  const here = { lat: SCENARIO.s2.lat, lon: SCENARIO.s2.lon };

  it('CA-M1.3 : accueil avec les deux arrêts favoris en tête ; « Favoris » ouvre la liste de tous, détail compris', async () => {
    const s = settings();
    const a = await answers(now, here, s);
    expect(a.order).toEqual(['fav-gdn', 'fav-dl-nord', 'fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    const v = homeView(home(a, { nearbyCount: 4 }), ctxOf(now, s, { rt: 'ok' }));
    // un arrêt : le prochain départ seulement, sans « ~ » (le détail « vers Churchill, puis… » est sur ses départs)
    expect(check(v).slice(0, 4)).toEqual(['Favoris   6', 'Gare du Nord, tram   T3 2 min', 'Bruxelles-Nord, bus De Lijn   232 5 min', 'Bureau   maintenant → 12:26']);
    expect(v.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    // la liste ouverte par « Favoris » : tous les favoris, deux lignes chacun (inchangée)
    const list = favoritesView({ entries: a.entries, title: 'Mes favoris' }, ctxOf(now, s));
    expect(list.log).toEqual({ order: a.order });
    const l = check(list);
    expect(l.slice(0, 4)).toEqual(['Gare du Nord, tram   T3 2 min', 'vers Churchill, puis T4 Stalle 5 min', 'Bruxelles-Nord, bus De Lijn   232 ~5 min', 'vers Vilvorde, puis 460 Meise 10 min']);
    expect(l.at(-1)).toBe('▲▼ choisir   toucher : ouvrir   double : retour');
    // 3 favoris par écran ; Gand-Saint-Pierre (le 4e) en descendant
    expect(page(list).visible).toBe(3);
    const down = layoutPage(list, { sel: 3, top: 0 }).lines.map(nb);
    expect(down).toContain('Vers Gand-Saint-Pierre   départ 14:10');
    expect(down).toContain('IC voie 4 à Bruxelles-Central, arrivée 14:39');
  });

  it('départs d’un arrêt favori : « ★ » dans le titre, sans curseur (M6.2)', async () => {
    const s = settings();
    const fav = s.favorites.find((f) => f.id === 'fav-gdn');
    const b = await fakeCore(() => now).board('stib:6357F', { limit: 5, filter: fav?.kind === 'stop' ? fav.filter : undefined });
    const v = boardView(b, ctxOf(now, s), { isFavorite: true });
    expect(v.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(v.scroll).toBe(true);
    expect(v.tap).toEqual({ kind: 'toggleFavoriteStop' });
    expect(v.items.every((i) => !i.action)).toBe(true);
    expect(check(v)).toEqual(['T3   Churchill   2 min', 'T4   Stalle   5 min', 'T3   Esplanade   6 min', 'T3   Churchill   10 min', 'T4   Stalle   13 min', '▲▼ départs   toucher : ★ retirer   double : retour']);
    expect(page(v).sel).toBe(-1);
    expect(boardView(b, ctxOf(now, s), { isFavorite: false }).title).toBe('Gare du Nord, tram (STIB)');
  });

  it('départs De Lijn en horaire prévu ; gare : voie, ~ et SUPPRIMÉ', async () => {
    const core = fakeCore(() => now);
    const dl = boardView(await core.board('delijn:308611', { limit: 5 }), ctxOf(now, settings()), { isFavorite: false });
    expect(dl.title).toBe('Bruxelles-Nord, bus (De Lijn)');
    const l = check(dl);
    expect(l[0]).toBe('232   Vilvorde   ~5 min');
    expect(l.slice(-2)).toEqual(['~ horaire prévu, sans temps réel', '▲▼ départs   toucher : ★ favori   double : retour']);
    const lines = check(boardView(await core.board('sncb:8812005', { limit: 5 }), ctxOf(now, settings()), { isFavorite: false }));
    expect(lines.slice(0, 3)).toEqual(['IC   Anvers-Central   12:22  voie 9', 'IC   Anvers-Central   ~12:30  voie 12', 'S1   Nivelles   12:34  SUPPRIMÉ']);
  });

  it('CA-M8.6 : temps réel coupé, « Temps réel indisponible : horaires prévus ~ » ; hors ligne, « Pas de réseau »', async () => {
    const b = await fakeCore(() => now, { noRt: true }).board('stib:6357F', { limit: 4 });
    const lines = check(boardView(b, ctxOf(now, settings(), { rt: 'down' }), { isFavorite: false }));
    expect(lines[0]).toBe('T3   Churchill   ~2 min');
    expect(lines).toContain('Temps réel indisponible : horaires prévus ~');
    expect(check(boardView(b, ctxOf(now, settings(), { rt: 'offline' }), { isFavorite: false }))).toContain('Pas de réseau : horaires prévus ~');
  });

  it('zone fusionnée : les modes dans le titre ; « imminent » (S6)', () => {
    const area = { id: 'stib:6357F', op: 'stib' as const, n: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 0, lon: 0, modes: ['tram' as const, 'bus' as const], lines: ['3', '4', '88'] };
    const d: Departure = { op: 'stib', mode: 'tram', line: '3', head: { fr: 'Churchill', nl: 'Churchill' }, sched: now + 20_000, est: now + 20_000, rt: true, delayMin: 0, cancelled: false };
    const v = boardView({ area, departures: [d], anyPlanned: false, rtErrors: [], updatedAt: now }, ctxOf(now, settings()), { isFavorite: true });
    expect(v.title).toBe('Gare du Nord, tram et bus (STIB) ★');
    expect(check(v)[0]).toBe('T3   Churchill   imminent');
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
    expect(check(homeView(home(a), ctxOf(now, s))).slice(0, 3)).toEqual(['Favoris   6', 'Vers Gand-Saint-Pierre   dans 13 min → 14:39', 'Bureau   maintenant → 14:07']);
    const journeys = a.map.get('fav-gand')!.plan!.journeys;
    const v = stepsPage({ title: 'Vers Gand-Saint-Pierre', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers Gand-Saint-Pierre : 14:10 → 14:39');
    const lines = check(v);
    expect(lines[0]).toBe('Le plus court : direct');
    expect(lines[1]).toMatch(/^14:10   IC vers Bruges, voie 4/);
    expect(lines[2]).toBe('14:39   Arrivée à Gand-Saint-Pierre');
    expect(lines.slice(-2)).toEqual(['Fin du trajet. ▼ 2 autres trajets', HINT_STEPS]);
    // les autres trajets : « Le suivant », même trajet plus tard (les moyens en 2e ligne)
    expect(check(othersView({ screen: 'others', key: 'g', title: 'Vers Gand-Saint-Pierre', journeys, index: 0 }, journeys, ctxOf(now, s))).slice(0, 4)).toEqual(['Le suivant   14:25 → 14:56', 'IC', 'Le suivant   14:40 → 15:09', 'IC']);
  });

  it('CA-M5.4 : vers une adresse, train puis tram, « À pied vers l’arrêt du tram »', async () => {
    const s = settings();
    const to = { type: 'address' as const, label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 };
    const res = await fakeCore(() => now).route({ type: 'here' }, to, now, s, here);
    const v = stepsPage({ title: 'Vers Veldstraat 1', label: '' }, { journeys: res.journeys, index: 0, followedId: res.journeys[0].id, fresh: true }, ctxOf(now, s));
    const lines = check(v);
    expect(lines[0]).toBe('Le plus court : 1 changement, à pied 1 + 3 min');
    expect(lines.slice(1, 7).map((l) => l.replace(/   (dans|en) .*$/, ''))).toEqual([
      '14:10   IC vers Bruges, voie 4',
      '14:39   Descendre à Gand-Saint-Pierre',
      '14:39   À pied vers l’arrêt du tram (1 min)',
      '14:44   T1 vers Korenmarkt',
      '14:54   Descendre à Korenmarkt, Gand',
      '14:57   Arrivée à Veldstraat 1 (3 min à pied)',
    ]);
  });

  it('C1 : dans le tram, les arrêts et « Descente dans … »', () => {
    const N = (fr: string) => ({ fr, nl: fr });
    const stop = (fr: string, t: number) => ({ name: N(fr), sched: t, est: t });
    const tram: Leg = {
      kind: 'ride', from: { name: N('Gand-Saint-Pierre'), lat: 0, lon: 0 }, to: { name: N('Korenmarkt'), lat: 0, lon: 0 },
      dep: at(14, 44), arr: at(14, 54), schedDep: at(14, 44), schedArr: at(14, 54), op: 'delijn', mode: 'tram', line: '1', head: N('Korenmarkt'), rt: true,
      stops: [stop('Gand-Saint-Pierre', at(14, 44)), stop('Rooigem', at(14, 46)), stop('Kortrijksepoort', at(14, 49)), stop('Sint-Michielsplein', at(14, 51)), stop('Korenmarkt', at(14, 54))],
    };
    const j: Journey = { id: 't', legs: [tram], dep: tram.dep, arr: tram.arr, leaveAt: tram.dep, transfers: 0, rt: true, alerts: [] };
    const before = trainView(j, 0, ctxOf(at(14, 40), settings()));
    expect(before.top).toEqual({ text: 'Descente dans 4 arrêts' });
    const during = trainView(j, 0, ctxOf(at(14, 47), settings()));
    expect(during.top).toEqual({ text: 'Descente dans 3 arrêts' });
    expect(check(during)).toContain('Kortrijksepoort   14:49   prochain');
    expect(trainView(j, 0, ctxOf(at(14, 52), settings())).top).toEqual({ text: 'Descente au prochain arrêt' });
    // train : écran 1.0, sans ligne du haut
    const train = { ...tram, mode: 'train' as const, op: 'sncb' as const, cat: 'IC' };
    expect(trainView({ ...j, legs: [train] }, 0, ctxOf(at(14, 47), settings())).top).toBeUndefined();
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
  it('CA-M2.7 : trajet entièrement à pied, deux étapes, toucher sans effet', async () => {
    const now = at(10, 0);
    const s = settings();
    const here = { lat: 50.848, lon: 4.352 };
    const res = await fakeCore(() => now).route({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, s, here);
    const j = res.journeys[0];
    expect(j.legs.some((l) => l.kind === 'ride')).toBe(false);
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: res.journeys, index: 0, followedId: j.id, fresh: true }, ctxOf(now, s));
    const lines = check(v);
    expect(lines[0]).toBe('Le plus court : à pied, 9 min');
    expect(lines[1]).toMatch(/^10:00   Partir à pied \(9 min\)/);
    expect(lines[2]).toBe('10:09   Arrivée au bureau');
    expect(lines.slice(-2)).toEqual(['Fin du trajet. Pas d’autre trajet pour l’instant', '▲▼ étapes   double : retour']);
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
    const item = v.items.find((i) => i.a === 'Vers le bureau')!;
    expect([item.c, item.b2, item.two]).toEqual(['tu y es', undefined, undefined]);
    expect(check(alreadyThereView('Vers le bureau', ctxOf(now, s)))[0]).toBe('Tu es déjà au bureau.');
    expect(check(alreadyThereView('Vers la maison', ctxOf(now, s)))[0]).toBe('Tu es déjà à la maison.');
  });

  it('CA-M1.8 : sans position, « sans position » ; les arrêts favoris gardent leurs départs, le trajet fixe part de sa gare', async () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const v = homeView(home(await answers(now, null, s), { noPosition: true, nearbyCount: undefined }), ctxOf(now, s));
    const lines = check(v);
    expect(lines.slice(0, 4)).toEqual(['Favoris   6', 'Bureau   sans position', 'Gare du Nord, tram   T3 1 min', 'Vers Gand-Saint-Pierre   07:40 → 08:09']);
    expect(lines).toContain('Autour de moi   sans position');
  });

  it('favoris en calcul : « … » sur leur ligne ; aucun favori (S1.3) ; accueil sans favoris ; liste vide (L2)', () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const v = homeView({ favorites: s.favorites.slice(0, 3).map((fav) => ({ fav })), nearbyCount: 3 }, ctxOf(now, s));
    // 1.2.1 : une ligne par favori, même en calcul (rien ne saute quand la réponse arrive)
    expect(v.items.slice(1, 4).map((i) => [i.b, i.bRight, i.two])).toEqual([['Bureau', '…', undefined], ['Gare du Nord', '…', undefined], ['Vers Gand-Saint-Pierre', '…', undefined]]);
    // le mode de l'arrêt n'est connu qu'avec ses départs
    expect(check(v).slice(0, 4)).toEqual(['Favoris   6', 'Bureau   …', 'Gare du Nord   …', 'Vers Gand-Saint-Pierre   …']);
    const none = { ...s, favorites: [] };
    const empty = homeView({ nearbyCount: 3, near: 'Namur' }, ctxOf(now, none));
    expect(check(empty)).toEqual(['Près de Namur', 'Ajouter un favori', '', 'Autour de moi   3 arrêts', 'Aller à…', HINT_HOME]);
    expect(empty.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    const list = favoritesView({}, ctxOf(now, none));
    expect(list.screen).toBe('message');
    expect(check(list)).toEqual(['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', 'ou ajoute un favori sur le téléphone.', 'double toucher : retour']);
    expect(check(favoritesView({}, ctxOf(now, none, { web: true }))).at(-2)).toBe('ou ajoute un favori dans l’onglet Réglages.');
    // « Accueil sans favoris » : « Favoris   6 » sans favori dessous (il ouvre la liste) et « Près de … »
    const plain = homeView({ noFavorites: true, favorites: s.favorites.slice(0, 3).map((fav) => ({ fav })), nearbyCount: 3, near: 'Namur' }, ctxOf(now, s));
    expect(check(plain)).toEqual(['Près de Namur', 'Favoris   6', '', 'Autour de moi   3 arrêts', 'Aller à…', HINT_HOME]);
    expect(plain.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    // aide des gestes passée (7 premiers jours, contrôleur) : plus de pied du tout
    expect(check(homeView({ noFavorites: true, nearbyCount: 3, gestureHelp: false }, ctxOf(now, s))).at(-1)).toBe('Aller à…');
  });

  it('trajet en cours sur l’accueil (M6.4)', async () => {
    const now = at(7, 36);
    const s = settings();
    const { entries, order } = await answers(now, { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon }, s);
    const v = homeView(home({ entries, order }, { running: { title: 'Vers le bureau', next: 'IC 07:44, voie 6' } }), ctxOf(now, s));
    // « En cours » inchangée, au-dessus de « Favoris »
    expect(check(v).slice(0, 2)).toEqual(['En cours : vers le bureau   IC 07:44, voie 6', 'Favoris   6']);
    expect(v.items[0].action).toEqual({ kind: 'resume' });
  });

  it('messages : bienvenue, « Quai 1.2.1 », erreur au lancement, attente', () => {
    const ctx = ctxOf(SCENARIO.s2.now, settings());
    expect(check(firstRunView(ctx))).toEqual([
      'Bienvenue dans Quai !',
      'Termine les réglages sur le téléphone :',
      'appli Even Realities, onglet Even Hub, Quai.',
      'Position, langue et tes lieux, en une minute.',
      'toucher : continuer   double : quitter',
    ]);
    expect(check(firstRunView({ ...ctx, web: true })).at(-2)).toBe('position, langue et tes lieux, en une minute.');
    // PRD-1.2.1 § 6 : depuis la 1.2.0, trois lignes ; depuis une version antérieure, la ligne des lieux en plus
    const news = newsView(ctx, newsLines('1.2.0'));
    expect(news.title).toBe('Quai 1.2.1');
    expect(check(news)).toEqual(['Nouveau : le moins de marche d’abord.', 'Sur un trajet, ▼ : la suite, puis les autres trajets.', 'Accueil plus simple : tes favoris en tête.', 'toucher : continuer']);
    expect(check(newsView(ctx, newsLines('1.1.0'))).slice(-2)).toEqual(['Tes lieux sont maintenant dans tes favoris.', 'toucher : continuer']);
    expect(news.tap).toEqual({ kind: 'continue' });
    // espace insécable devant « : » (PRD), mêmes lignes sur Quai Web
    expect(news.items[0].a).toBe('Nouveau\u00a0: le moins de marche d’abord.');
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.0')).items).toEqual(news.items);
    const root = errorView('Quai', 'Horaires injoignables : nouvel essai dans 30 s', ctx, { root: true });
    expect(check(root)).toEqual(['Horaires injoignables : nouvel essai dans 30 s', 'toucher : réessayer   double : quitter']);
    expect(check(errorView('Autour de moi', 'Pas de réseau : réessaie dans un instant.', ctx)).at(-1)).toBe('toucher : réessayer   double : retour');
    expect(check(loadingView('Autour de moi', 'Recherche des arrêts…', ctx))).toEqual(['Recherche des arrêts…', 'double toucher : retour']);
    expect(check(nearbyView([], ctx))[0]).toBe('Aucun arrêt dans un rayon de 500 m');
    expect(check(notConfiguredView(ctx))[0]).toBe('Quai n’est pas encore configuré.');
  });

  it('aperçu du téléphone (1.0) : stepsView avec un seul trajet, non suivi', async () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const { map } = await answers(now, { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon }, s);
    const j = map.get('fav-bureau')!.plan!.journeys[0];
    const v = stepsView({ label: 'bureau', leaveAt0: j.leaveAt }, j, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers le bureau : 07:35 → 09:01');
    // 7 étapes pour 6 lignes : la suite d'abord ; au bout, aucune autre proposition
    expect(check(v).at(-2)).toBe('▼ suite du trajet : 1 étape');
    const end = stepsPage({ label: 'bureau' }, { journeys: [j], index: 0, leaveAt0: j.leaveAt, top: 1 }, ctxOf(now, s));
    expect(checkAt(end, 1).slice(-3)).toEqual(['09:01   Arrivée au bureau (9 min à pied)', 'Fin du trajet. Pas d’autre trajet pour l’instant', HINT_OTHER]);
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
    const lines = check(boardView(b, ctx(), { isFavorite: false }));
    expect(lines[0]).toBe('IC   Anvers-Central   23:52  voie 9');
    expect(lines[1]).toBe('IC   Anvers-Central   ~00:01  voie 9');
    expect(lines[2]).toMatch(/^IC   demain, Louvain-la-Neuve.*   ~08:42  voie 12$/);
    const tomorrow = boardView(board(nord, [train({ sched: T(6, 2, 1), est: T(6, 2, 1), rt: false }), train({ sched: T(7, 2, 1), est: T(7, 2, 1), rt: false })]), ctx(), { isFavorite: false });
    expect(tomorrow.top).toEqual({ text: 'Départs de demain' });
    expect(check(tomorrow).slice(0, 3)).toEqual(['Départs de demain', 'IC   Anvers-Central   ~06:02  voie 9', 'IC   Anvers-Central   ~07:02  voie 9']);
  });

  it('tableau bus : « demain, » au-delà d’une heure, compte à rebours sinon', () => {
    const dl = { ...nord, id: 'delijn:308611', op: 'delijn' as const, n: N('Bruxelles-Nord', 'Brussel Noordstation'), modes: ['bus' as const], lines: ['232'] };
    const bus = (est: number): Departure => ({ op: 'delijn', mode: 'bus', line: '232', head: N('Vilvorde', 'Vilvoorde'), sched: est, est, rt: false, delayMin: 0, cancelled: false });
    const lines = check(boardView(board(dl, [bus(T(0, 10, 1)), bus(T(6, 0, 1))]), ctx(), { isFavorite: false }));
    expect(lines[0]).toBe('232   Vilvorde   ~40 min');
    expect(lines[1]).toBe('232   demain, Vilvorde   ~06:00');
  });

  it('étapes et Aller à… : le lendemain est dit', () => {
    const ride: Leg = {
      kind: 'ride', from: { name: N('Bruxelles-Central'), lat: 50.845, lon: 4.357, areaId: 'sncb:8813003' }, to: { name: N('Gand-Saint-Pierre'), lat: 51.03, lon: 3.71, areaId: 'sncb:8892007' },
      dep: T(14, 10, 1), arr: T(14, 39, 1), schedDep: T(14, 10, 1), schedArr: T(14, 39, 1), op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruges'), rt: false, delayMin: 0, cancelled: false, platform: '4',
    };
    const walk: Leg = { kind: 'walk', from: { name: N('Ma position'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Central'), lat: 0, lon: 0 }, dep: T(13, 58, 1), arr: T(14, 10, 1), schedDep: T(13, 58, 1), schedArr: T(14, 10, 1), walkMin: 12 };
    const door: Journey = { id: 'j1', legs: [walk, ride], dep: walk.dep, arr: ride.arr, leaveAt: T(13, 56, 1), transfers: 0, rt: false, alerts: [] };
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [door], index: 0 }, ctx());
    expect(nb(v.title)).toBe('Vers le bureau : demain 13:56 → 14:39');
    expect(placeSummary([door], late)).toBe('arrivée demain 14:39');
    expect(trainView(door, 1, ctx()).title).toBe('IC vers Bruges, demain');
  });

  it('horaires périmés : le message de fraîcheur remplace « Aucun départ… » et les listes vides', () => {
    const stale = 'Horaires périmés : mise à jour arrêtée le 02/11';
    expect(check(boardView(board(nord, []), ctx({ stale }), { isFavorite: false }))[0]).toBe(stale);
    expect(check(boardView(board(nord, []), ctx(), { isFavorite: false }))[0]).toBe('Aucun départ dans les prochaines heures');
    expect(check(nearbyView([{ area: nord, distanceM: 160, walkMin: 3 }], ctx({ stale })))).toContain(stale);
    const h = homeView({ stale, nearbyCount: 2 }, ctx({ stale }));
    expect(h.top).toEqual({ text: stale, strong: true });
  });

  it('STIB : « Stalle » sans « (P) » dans les étapes et le titre du train', () => {
    const t4: Leg = {
      kind: 'ride', from: { name: N('Gare du Nord'), lat: 0, lon: 0 }, to: { name: N('Bourse'), lat: 0, lon: 0 },
      dep: T(23, 40), arr: T(23, 50), schedDep: T(23, 40), schedArr: T(23, 50), op: 'stib', mode: 'tram', line: '4', head: N('Stalle (P)'), rt: true,
    };
    const j: Journey = { id: 'j', legs: [t4], dep: t4.dep, arr: t4.arr, leaveAt: t4.dep, transfers: 0, rt: true, alerts: [] };
    const sv = check(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0 }, ctx()));
    expect(sv.some((l) => /^23:40   T4 vers Stalle/.test(l))).toBe(true);
    expect(trainView(j, 0, ctx()).title).toBe('T4 vers Stalle');
  });
});

describe('largeurs au pixel (CA-M1.7) : accueil et favoris des scénarios S1 à S3, sans « … »', () => {
  for (const [name, sc, flags] of [
    ['S1 base', SCENARIO.s1, {}],
    ['S1 noRT', SCENARIO.s1, { noRt: true }],
    ['S2 base', SCENARIO.s2, {}],
    ['S3 base', SCENARIO.s3, {}],
  ] as const) {
    it(name, async () => {
      const s = settings();
      const a = await answers(sc.now, { lat: sc.lat, lon: sc.lon }, s, flags);
      const ctx = ctxOf(sc.now, s, { rt: 'noRt' in flags ? 'down' : 'ok' });
      // accueil (1.2.1) : sections dans la colonne a, favoris en retrait dans la colonne b, réponses à droite
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
      expect(hp.lines.filter((l) => l.includes('…') && !l.startsWith('Aller à…'))).toEqual([]);
      // liste « Mes favoris » (inchangée) : deux lignes par favori
      const list = favoritesView({ entries: a.entries }, ctx);
      for (const it of list.items) {
        const right = nb(it.c ?? '');
        expect(textWidth(it.a), it.a).toBeLessThanOrEqual(right ? WIDTHS.menuLeft : WIDTHS.full);
        expect(textWidth(right), right).toBeLessThanOrEqual(WIDTHS.menuRight);
        if (it.b2) expect(textWidth(it.b2), it.b2).toBeLessThanOrEqual(WIDTHS.full);
      }
      const lp = page(list);
      expect(overflowing(lp)).toEqual([]);
      expect(lp.lines.filter((l) => l.includes('…'))).toEqual([]);
    });
  }
});
