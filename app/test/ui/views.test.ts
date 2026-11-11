/**
 * Écrans des lunettes (PRD 1.1 § 6.1) : textes exacts, états vides, largeur au pixel de chaque ligne dans sa colonne.
 * Données : faux cœur 1.1 (fixtures, scénarios S1 à S3), réponses et ordre des favoris du cœur.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, FavoriteAnswer, Journey, Leg, LatLon, Settings } from '../../src/core/api';
import type { FakeFlags } from '../../src/dev/fake-core';
import { layoutPage, geometry, WIDTHS } from '../../src/glasses/layout';
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
  newsView,
  notConfiguredView,
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
  const p = page(v);
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

/** Réponses du cœur pour les favoris, dans l'ordre intelligent. */
async function answers(now: number, here: LatLon | null, s: Settings, flags: FakeFlags = {}) {
  const core = fakeCore(() => now, flags);
  const map = new Map<string, FavoriteAnswer>();
  for (const f of s.favorites) map.set(f.id, await core.answer(f, here, s));
  const order = core.orderFavorites(here, s, map).map((r) => r.favoriteId);
  const entries: FavoriteEntry[] = order.map((id) => ({ fav: s.favorites.find((f) => f.id === id)!, answer: map.get(id) }));
  return { core, map, order, entries };
}

function home(entries: FavoriteEntry[], order: string[], patch: Partial<HomeData> = {}): HomeData {
  return { favorites: entries.slice(0, 2), order, others: order.length - 2, nearbyCount: 3, ...patch };
}

const ctxOf = (now: number, s: Settings, patch: Partial<ViewCtx> = {}): ViewCtx => ({ now, settings: s, ...patch });

describe('scénario 1 : le matin, vers le bureau (S1, 07:31)', () => {
  const now = SCENARIO.s1.now;
  const here = { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon };

  it('CA-M1.1 : accueil sans temps réel, réponse des 2 favoris en tête', async () => {
    const s = settings();
    const { entries, order } = await answers(now, here, s, { noRt: true });
    expect(order.slice(0, 2)).toEqual(['fav-bureau', 'fav-namur']);
    const v = homeView(home(entries, order), ctxOf(now, s, { rt: 'down' }));
    expect(v.log).toEqual({ order });
    expect(v.top).toEqual({ text: 'Temps réel indisponible : horaires prévus ~' });
    const all = v.items.map((i) => [i.a, nb(i.c ?? ''), nb(i.b2 ?? '')]);
    expect(all).toEqual([
      ['Vers le bureau', 'partir dans 2 min', 'IC à ~07:42, voie 4, direct, arrivée 08:58'],
      ['Namur, train', 'IC ~07:42 v.4', 'vers Bruxelles-Midi, puis ~08:42'],
      ['Autour de moi', '3 arrêts', ''],
      ['Autres favoris', '4', ''],
      ['Aller à…', '', ''],
    ]);
    const lines = check(v);
    expect(lines).toContain('~ horaire prévu, sans temps réel');
    expect(lines.some((l) => l.startsWith('Près de'))).toBe(false);
    expect(lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir   double : quitter');
    // ligne du haut et note : « Aller à… » passe sous le bord (CA-M1.9), rien d'autre n'est caché
    expect(lines).not.toContain('Aller à…');
    expect(lines).toContain('Autres favoris   4');
  });

  it('CA-M1.2 : temps réel, retard et voie modifiée', async () => {
    const s = settings();
    const { entries, order } = await answers(now, here, s);
    const lines = check(homeView(home(entries, order), ctxOf(now, s, { rt: 'ok' })));
    expect(lines.slice(0, 4)).toEqual(['Vers le bureau   partir dans 4 min', 'IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00', 'Namur, train   IC 07:42 +2 v.6 !', 'vers Bruxelles-Midi, puis 08:42']);
    expect(lines).toContain('Aller à…');
  });

  it('CA-M2.1 : étapes du trajet suivi, l’alerte passe avant la raison, « ▶ » sur la 1re étape', async () => {
    const s = settings();
    const { map } = await answers(now, here, s);
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, leaveAt0: journeys[0].leaveAt, fresh: true }, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers le bureau : 07:35 → 09:00');
    expect(v.log).toEqual({ page: 1, pages: 3, label: 'simple', followed: true });
    expect(check(v)).toEqual([
      '! Voie modifiée : l’IC part de la voie 6',
      '07:35   Partir à pied vers la gare (7 min)   dans 4 min',
      '07:42   IC vers Bruxelles-Midi, voie 6   +2 min',
      '08:48   Descendre à Bruxelles-Central',
      '09:00   Arrivée au bureau (12 min à pied)',
      '▼ Le suivant : 08:33 → 09:58',
      '▲▼ autre trajet   toucher : détail   double : retour',
    ]);
    expect(page(v).sel).toBe(0);
    expect(v.tap).toMatchObject({ kind: 'open', route: { screen: 'train', leg: 1 } });
  });

  it('CA-M2.2 : sans temps réel, la raison ; page 2 non suivie ; dernière page', async () => {
    const s = settings();
    const { map } = await answers(now, here, s, { noRt: true });
    const journeys = map.get('fav-bureau')!.plan!.journeys;
    const ctx = ctxOf(now, s);
    const p1 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctx);
    const l1 = check(p1);
    expect(l1[0]).toBe('Le plus simple : direct, à pied 7 + 12 min');
    expect(l1).toContain('▼ Le suivant : 08:33 → 09:58');
    const p2 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 1, followedId: journeys[0].id }, ctx);
    expect(nb(p2.title)).toBe('Vers le bureau : 08:33 → 09:58');
    expect(p2.log).toEqual({ page: 2, pages: 3, label: 'next', followed: false });
    const l2 = check(p2);
    expect(l2[0]).toBe('Le suivant : même trajet, 1 h plus tard');
    expect(l2).toContain('~08:42   IC vers Bruxelles-Midi, voie 4');
    expect(l2.slice(-2)).toEqual(['▼ Le suivant : 09:33 → 10:58', '▲▼ autre trajet   toucher : suivre ce trajet   double : retour']);
    expect(page(p2).sel).toBe(-1);
    expect(p2.tap).toEqual({ kind: 'follow' });
    const p3 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: 2, followedId: journeys[0].id }, ctx);
    expect(check(p3)).toContain('▲ trajet précédent');
    // une seule proposition : rien d'autre
    expect(check(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: journeys.slice(0, 1), index: 0 }, ctx))).toContain('Pas d’autre trajet pour l’instant');
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
    const atEnd = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, followedId: j.id, fresh: true }, ctxOf(at(8, 50), s));
    expect(page(atEnd).sel).toBe(3);
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
    expect(p.lines.map(nb)).toContain('Bruxelles-Central   08:48   descente');
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

  it('Aller à… : lieux, adresses récentes (S4), « Autre adresse   sur le téléphone » (L8)', async () => {
    const s = settings();
    s.recent = [
      { label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 3 },
      { label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, at: 2 },
      { label: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648, at: 1 },
      { label: 'Avenue Winston Churchill 100, 1180 Uccle', lat: 50.808, lon: 4.365, at: 0 },
    ];
    const v = placesView({ maison: 'ici', bureau: 'arrivée 08:58', 'recent:Veldstraat 1, 9000 Gent': 'arrivée 10:51' }, ctxOf(now, s));
    expect(check(v)).toEqual(['Maison   ici', 'Bureau   arrivée 08:58', 'Veldstraat 1   arrivée 10:51', 'Rue Neuve 1   …', 'Rue de Fer 25   …', 'Autre adresse   sur le téléphone', '▲▼ choisir   toucher : trajet   double : retour']);
    expect(v.items[0].action).toEqual({ kind: 'go', key: 'maison', to: { type: 'place', placeId: 'maison' }, label: 'maison' });
    expect(v.items[2].action).toEqual({ kind: 'go', key: 'recent:Veldstraat 1, 9000 Gent', to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 }, label: 'Veldstraat 1' });
    expect(v.items.at(-1)!.action).toEqual({ kind: 'toast', text: 'Tape l’adresse dans Quai, sur le téléphone' });
    const empty = placesView({}, ctxOf(now, { ...s, places: [], recent: [] }));
    expect(check(empty)).toEqual(['Aucun lieu enregistré   sur le téléphone', 'Autre adresse   sur le téléphone', '▲▼ choisir   toucher : trajet   double : retour']);
    const js = (await fakeCore(() => now).route({ type: 'here' }, { type: 'place', placeId: 'bureau' }, now, s, here)).journeys;
    expect(placeSummary(js, now)).toBe('arrivée 09:00');
  });
});

describe('scénario 2 : en ville, gare du Nord (S2, 12:10)', () => {
  const now = SCENARIO.s2.now;
  const here = { lat: SCENARIO.s2.lat, lon: SCENARIO.s2.lon };

  it('CA-M1.3 : accueil avec les deux arrêts favoris, puis « Autres favoris »', async () => {
    const s = settings();
    const { entries, order } = await answers(now, here, s);
    expect(order).toEqual(['fav-gdn', 'fav-dl-nord', 'fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    const lines = check(homeView(home(entries, order, { nearbyCount: 4 }), ctxOf(now, s, { rt: 'ok' })));
    expect(lines.slice(0, 4)).toEqual(['Gare du Nord, tram   T3 2 min', 'vers Churchill, puis T4 Stalle 5 min', 'Bruxelles-Nord, bus De Lijn   232 ~5 min', 'vers Vilvorde, puis 460 Meise 10 min']);
    const list = favoritesView({ entries: entries.slice(2), title: 'Autres favoris' }, ctxOf(now, s));
    expect(list.title).toBe('Autres favoris');
    expect(list.log).toEqual({ order: ['fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison'] });
    const l = check(list);
    expect(l.slice(2, 4)).toEqual(['Vers Gand-Saint-Pierre   départ 14:10', 'IC voie 4 à Bruxelles-Central, arrivée 14:39']);
    expect(l.at(-1)).toBe('▲▼ choisir   toucher : ouvrir   double : retour');
    // 3 favoris par écran
    expect(page(list).visible).toBe(3);
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
    const { entries, order, map } = await answers(now, here, s);
    expect(order[0]).toBe('fav-gand');
    expect(check(homeView(home(entries, order), ctxOf(now, s))).slice(0, 2)).toEqual(['Vers Gand-Saint-Pierre   partir dans 13 min', 'IC à 14:10, voie 4, direct, arrivée 14:39']);
    const journeys = map.get('fav-gand')!.plan!.journeys;
    const v = stepsPage({ title: 'Vers Gand-Saint-Pierre', label: '' }, { journeys, index: 0, followedId: journeys[0].id, fresh: true }, ctxOf(now, s));
    expect(nb(v.title)).toBe('Vers Gand-Saint-Pierre : 14:10 → 14:39');
    const lines = check(v);
    expect(lines[0]).toBe('Le plus simple : direct');
    expect(lines[1]).toMatch(/^14:10   IC vers Bruges, voie 4/);
    expect(lines[2]).toBe('14:39   Arrivée à Gand-Saint-Pierre');
    expect(lines).toContain('▼ Le suivant : 14:25 → 14:56');
  });

  it('CA-M5.4 : vers une adresse, train puis tram, « À pied vers l’arrêt du tram »', async () => {
    const s = settings();
    const to = { type: 'address' as const, label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 };
    const res = await fakeCore(() => now).route({ type: 'here' }, to, now, s, here);
    const v = stepsPage({ title: 'Vers Veldstraat 1', label: '' }, { journeys: res.journeys, index: 0, followedId: res.journeys[0].id, fresh: true }, ctxOf(now, s));
    const lines = check(v);
    expect(lines[0]).toBe('Le plus simple : 1 changement, à pied 1 + 3 min');
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
    const res = await fakeCore(() => now).route({ type: 'here' }, { type: 'place', placeId: 'bureau' }, now, s, here);
    const j = res.journeys[0];
    expect(j.legs.some((l) => l.kind === 'ride')).toBe(false);
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: res.journeys, index: 0, followedId: j.id, fresh: true }, ctxOf(now, s));
    const lines = check(v);
    expect(lines[0]).toBe('Le plus simple : à pied, 9 min');
    expect(lines[1]).toMatch(/^10:00   Partir à pied \(9 min\)/);
    expect(lines[2]).toBe('10:09   Arrivée au bureau');
    expect(lines.at(-1)).toBe('▲▼ autre trajet   double : retour');
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

  it('CA-M1.8 : sans position, « sans position » ; les arrêts favoris gardent leurs départs', async () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const { entries, order } = await answers(now, null, s);
    const v = homeView(home(entries, order, { noPosition: true, nearbyCount: undefined }), ctxOf(now, s));
    const lines = check(v);
    expect(lines[0]).toBe('Vers le bureau   sans position');
    expect(lines[1]).toMatch(/^Gare du Nord, tram   T3 /);
    expect(lines).toContain('Autour de moi   sans position');
  });

  it('favoris en calcul : « … » et deux lignes réservées ; accueil sans favoris (S1.3) ; liste vide (L2)', () => {
    const now = SCENARIO.s1.now;
    const s = settings();
    const v = homeView({ favorites: s.favorites.slice(0, 2).map((fav) => ({ fav })), others: 4, nearbyCount: 3 }, ctxOf(now, s));
    expect(v.items.slice(0, 2).map((i) => [i.c, i.two])).toEqual([['…', true], ['…', true]]);
    // le mode de l'arrêt n'est connu qu'avec ses départs
    expect(check(v).slice(0, 2)).toEqual(['Vers le bureau   …', 'Gare du Nord   …']);
    const none = { ...s, favorites: [] };
    const empty = homeView({ nearbyCount: 3, near: 'Namur' }, ctxOf(now, none));
    expect(check(empty)).toEqual(['Près de Namur', 'Ajouter un favori', 'Autour de moi   3 arrêts', 'Aller à…', '▲▼ choisir   toucher : ouvrir   double : quitter']);
    expect(empty.items[0].action).toEqual({ kind: 'open', route: { screen: 'favorites' } });
    const list = favoritesView({}, ctxOf(now, none));
    expect(list.screen).toBe('message');
    expect(check(list)).toEqual(['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', 'ou ajoute un trajet sur le téléphone.', 'double toucher : retour']);
    // « Accueil sans favoris » : « Mes favoris   6 » et « Près de … »
    const plain = homeView({ noFavorites: true, nearbyCount: 3, near: 'Namur' }, ctxOf(now, s));
    expect(check(plain)).toEqual(['Près de Namur', 'Autour de moi   3 arrêts', 'Mes favoris   6', 'Aller à…', '▲▼ choisir   toucher : ouvrir   double : quitter']);
  });

  it('trajet en cours sur l’accueil (M6.4)', async () => {
    const now = at(7, 36);
    const s = settings();
    const { entries, order } = await answers(now, { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon }, s);
    const v = homeView(home(entries, order, { running: { title: 'Vers le bureau', next: 'IC 07:44, voie 6' } }), ctxOf(now, s));
    expect(check(v)[0]).toBe('En cours : vers le bureau   IC 07:44, voie 6');
    expect(v.items[0].action).toEqual({ kind: 'resume' });
  });

  it('messages : bienvenue, « Quai 1.1 », erreur au lancement, attente', () => {
    const ctx = ctxOf(SCENARIO.s2.now, settings());
    expect(check(firstRunView(ctx))).toEqual([
      'Bienvenue dans Quai !',
      'Termine les réglages sur le téléphone :',
      'appli Even Realities, onglet Even Hub, Quai.',
      'Position, langue et tes lieux, en une minute.',
      'toucher : continuer   double : quitter',
    ]);
    expect(check(firstRunView({ ...ctx, web: true })).at(-2)).toBe('position, langue et tes lieux, en une minute.');
    const news = newsView(ctx);
    expect(news.title).toBe('Quai 1.1');
    expect(check(news)).toEqual(['Nouveau : tes favoris donnent la réponse.', 'Toucher un favori : le trajet, étape par étape.', 'Sur un trajet, ▼ : un autre trajet.', 'Les adresses se tapent sur le téléphone.', 'toucher : continuer']);
    expect(news.tap).toEqual({ kind: 'continue' });
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
    expect(nb(v.title)).toBe('Vers le bureau : 07:35 → 09:00');
    expect(check(v)).toContain('Pas d’autre trajet pour l’instant');
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
      const { entries, order } = await answers(sc.now, { lat: sc.lat, lon: sc.lon }, s, flags);
      const ctx = ctxOf(sc.now, s, { rt: 'noRt' in flags ? 'down' : 'ok' });
      const views = [homeView(home(entries, order), ctx), favoritesView({ entries: entries.slice(2), title: 'Autres favoris' }, ctx), favoritesView({ entries }, ctx)];
      for (const v of views) {
        for (const it of v.items) {
          const right = nb(it.c ?? '');
          expect(textWidth(it.a), it.a).toBeLessThanOrEqual(right ? WIDTHS.menuLeft : WIDTHS.full);
          expect(textWidth(right), right).toBeLessThanOrEqual(WIDTHS.menuRight);
          if (it.b2) expect(textWidth(it.b2), it.b2).toBeLessThanOrEqual(WIDTHS.full);
        }
        const p = page(v);
        expect(overflowing(p)).toEqual([]);
        expect(p.lines.filter((l) => l.includes('…') && !l.startsWith('Aller à…'))).toEqual([]);
      }
    });
  }
});
