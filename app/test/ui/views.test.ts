/**
 * Écrans des lunettes : textes des maquettes (Visite1-3), états vides, lignes ≤ 48 caractères
 * et largeur au pixel dans chaque conteneur.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, Journey, Leg, Settings } from '../../src/core/api';
import { layoutPage, geometry } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { GlassesView, Route } from '../../src/glasses/types';
import {
  alreadyThereView,
  arrivalView,
  boardView,
  errorView,
  favoritesView,
  firstRunView,
  homeView,
  journeysView,
  loadingView,
  nearbyView,
  notConfiguredView,
  placeSummary,
  placesView,
  stepsView,
  trainView,
  tripView,
} from '../../src/glasses/views';
import { at, fakeCore, overflowing, preset, SCENARIO } from './helpers';

function page(v: GlassesView) {
  const g = geometry(v);
  return layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, g.capacity));
}

function check(v: GlassesView): string[] {
  const p = page(v);
  expect(overflowing(p)).toEqual([]);
  for (const l of [p.title, ...p.lines]) {
    expect(l).not.toMatch(/—/);
    expect([...l].length, l).toBeLessThanOrEqual(64);
  }
  return p.lines;
}

const settings = (patch: Partial<Settings['display']> = {}): Settings => {
  const s = preset();
  return { ...s, display: { ...s.display, ...patch } };
};

describe('scénario 1 : le matin, aller au bureau', () => {
  const now = SCENARIO.s1.now;
  const core = fakeCore(() => now);
  const here = { lat: SCENARIO.s1.lat, lon: SCENARIO.s1.lon };

  it('accueil avec la suggestion du matin (Visite1, étape 1)', async () => {
    const s = settings();
    const sug = await core.suggest(here, s);
    expect(sug?.autoOpen).toBe(false);
    const v = homeView({ suggestion: sug, nearbyCount: 3 }, { now, settings: s });
    const lines = check(v);
    expect(lines).toEqual([
      'Pour le bureau : IC 07:42, voie 4',
      'partir à 07:33, 7 min à pied',
      'Autour de moi   3 arrêts',
      'Mes favoris   5',
      'Aller à…',
      '▲▼ choisir   toucher : ouvrir',
    ]);
    expect(v.title).toBe('Quai');
    expect(v.items[0].action).toMatchObject({ kind: 'open', route: { screen: 'steps' } });
  });

  it('étapes, puis voie modifiée et retard (Visite1, étapes 2 et 3)', async () => {
    const s = settings();
    const [j] = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, now, s, here);
    const route = { screen: 'steps', journey: j, label: 'bureau', leaveAt0: j.leaveAt } as const;
    const v = stepsView(route, j, { now, settings: s });
    expect(v.title).toBe('Vers le bureau : 07:33 ▶ 08:58');
    expect(check(v).slice(0, 4)).toEqual([
      '07:33   Partir à pied vers la gare   7 min',
      '07:42   IC vers Bruxelles-Midi, voie 4',
      '08:46   Descendre à Bruxelles-Central',
      '08:58   Arrivée au bureau, à pied   12 min',
    ]);
    const later = at(7, 37);
    const core2 = fakeCore(() => later);
    const j2 = await core2.refresh(j, s);
    const v2 = stepsView(route, j2, { now: later, settings: s });
    expect(v2.title).toBe('Vers le bureau : 07:33 ▶ 09:00');
    expect(v2.top).toEqual({ text: '! Voie modifiée : l’IC part de la voie 6', strong: true });
    expect(check(v2).slice(0, 5)).toEqual([
      '! Voie modifiée : l’IC part de la voie 6',
      '07:33   Partir à pied vers la gare   en cours',
      '07:42   IC vers Bruxelles-Midi, voie 6   +2 min',
      '08:48   Descendre à Bruxelles-Central',
      '09:00   Arrivée au bureau, à pied   12 min',
    ]);
  });

  it('dans le train (Visite1, étape 4)', async () => {
    const s = settings();
    const [j] = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, now, s, here);
    const t = at(8, 5);
    const j2 = await fakeCore(() => t).refresh(j, s);
    const v = trainView(j2, 1, { now: t, settings: s });
    expect(v.title).toBe('IC vers Bruxelles-Midi, +2 min');
    const p = page(v);
    expect(p.lines.slice(0, 3)).toEqual(['Gembloux   07:57   passé', 'Ottignies   08:11   prochain', 'Bruxelles-Luxembourg   08:33']);
    expect(p.lines).toContain('Bruxelles-Central   08:48   descente');
    expect(p.sel).toBe(2);
    expect(overflowing(p)).toEqual([]);
  });

  it('autour de moi : trois zones triées par distance', async () => {
    const list = await core.nearby(here.lat, here.lon, 500);
    const lines = check(nearbyView(list, { now, settings: settings() }));
    expect(lines[0]).toMatch(/^Namur Place Léopold, bus TEC   150 m   5 /);
    expect(lines[1]).toBe('Namur, train   420 m   IC 07:42 v.4');
    expect(lines[2]).toMatch(/^Namur Gare, bus TEC   430 m/);
  });

  it('aller à… et propositions', async () => {
    const s = settings();
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, now, s, here);
    expect(placeSummary(js, now)).toBe('arrivée 08:58');
    const home = await core.plan({ type: 'here' }, { type: 'place', placeId: 'maison' }, now, s, here);
    expect(placeSummary(home, now)).toBe('ici');
    const pv = check(placesView({ maison: 'ici', bureau: 'arrivée 08:58' }, { now, settings: s }));
    expect(pv).toEqual(['Maison   ici', 'Bureau   arrivée 08:58', 'Autre lieu   sur le téléphone', '▲▼ choisir   toucher : itinéraires   double : retour']);
    const route: Extract<Route, { screen: 'journeys' }> = { screen: 'journeys', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, label: 'Bureau' };
    const jv = journeysView(route, js, { now, settings: s });
    expect(jv.title).toBe('Vers le bureau, départ maintenant');
    const lines = check(jv);
    expect(lines[0]).toBe('07:33 ▶ 08:58   1 h 25, direct');
    expect(lines[1]).toBe('à pied 7 min, IC voie 4, à pied 12 min');
  });
});

describe('scénario 2 : en ville, autour de moi', () => {
  const now = SCENARIO.s2.now;
  const core = fakeCore(() => now);

  it('ouverture directe du favori Gare du Nord (à moins de 300 m)', async () => {
    const s = settings();
    const sug = await core.suggest({ lat: SCENARIO.s2.lat, lon: SCENARIO.s2.lon }, s);
    expect(sug).toMatchObject({ kind: 'favoriteStop', favoriteId: 'fav-gdn', autoOpen: true });
  });

  it('autour de moi : quatre zones, signe ~ expliqué (Visite2, étape 2)', async () => {
    const list = await core.nearby(SCENARIO.s2.lat, SCENARIO.s2.lon, 500);
    const v = nearbyView(list, { now, settings: settings() });
    const lines = check(v);
    expect(lines).toEqual([
      'Gare du Nord, tram   80 m   T3 2 min',
      'Bruxelles-Nord, train   160 m   IC 12:22 v.9',
      'Bruxelles-Nord, bus De Lijn   200 m   232 ~5 min',
      'Rogier, métro   340 m   M2 3 min',
      '~ horaire prévu, sans temps réel',
      '▲▼ arrêt   toucher : départs',
    ]);
    const plain = nearbyView(list, { now, settings: settings({ markPlanned: false, gestureHints: false }) });
    expect(page(plain).lines).toEqual(['Gare du Nord, tram   80 m   T3 2 min', 'Bruxelles-Nord, train   160 m   IC 12:22 v.9', 'Bruxelles-Nord, bus De Lijn   200 m   232 5 min', 'Rogier, métro   340 m   M2 3 min']);
  });

  it('tableau filtré de la gare du Nord (Visite2, étape 3)', async () => {
    const s = settings();
    const fav = s.favorites.find((f) => f.id === 'fav-gdn');
    const b = await core.board('stib:6357F', { limit: 5, filter: fav?.kind === 'stop' ? fav.filter : undefined });
    const v = boardView(b, { now, settings: s }, { isFavorite: true });
    expect(v.title).toBe('Gare du Nord, tram (STIB)');
    expect(check(v)).toEqual([
      'T3   Churchill   2 min',
      'T4   Stalle   5 min',
      'T3   Esplanade   6 min',
      'T3   Churchill   10 min',
      'T4   Stalle   13 min',
      '▲▼ départs   toucher : ★ retirer   double : retour',
    ]);
  });

  it('tableau De Lijn avec horaires prévus (Visite2, étape 4)', async () => {
    const b = await core.board('delijn:308611', { limit: 5 });
    const v = boardView(b, { now, settings: settings() }, { isFavorite: false });
    expect(v.title).toBe('Bruxelles-Nord, bus (De Lijn)');
    expect(check(v)).toEqual([
      '232   Vilvorde   ~5 min',
      '460   Meise   10 min',
      '270   Kortenberg   ~12 min',
      '232   Vilvorde   20 min',
      '232   Vilvorde   36 min',
      '~ horaire prévu, sans temps réel',
      '▲▼ départs   toucher : ★ favori   double : retour',
    ]);
  });

  it('gare de Bruxelles-Nord : voie, ~ et SUPPRIMÉ', async () => {
    const b = await core.board('sncb:8812005', { limit: 5 });
    const lines = check(boardView(b, { now, settings: settings() }, { isFavorite: false }));
    expect(lines.slice(0, 3)).toEqual(['IC   Anvers-Central   12:22  voie 9', 'IC   Anvers-Central   ~12:30  voie 12', 'S1   Nivelles   12:34  SUPPRIMÉ']);
  });

  it('sans temps réel : « Pas de réseau : horaires prévus ~ »', async () => {
    const b = await fakeCore(() => now, { noRt: true }).board('stib:6357F', { limit: 4 });
    const lines = check(boardView(b, { now, settings: settings() }, { isFavorite: false }));
    expect(lines[0]).toBe('T3   Churchill   ~2 min');
    expect(lines).toContain('Pas de réseau : horaires prévus ~');
  });
});

describe('scénario 3 : une recherche improvisée', () => {
  const now = SCENARIO.s3.now;
  const core = fakeCore(() => now);
  const from = { areaId: 'sncb:8813003', op: 'sncb' as const, name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 50.8454, lon: 4.3571 };
  const to = { areaId: 'sncb:8892007', op: 'sncb' as const, name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters', l: 'nl' as const }, lat: 51.0359, lon: 3.7107 };

  it('trains A ▶ B (Visite3, étape 3)', async () => {
    const js = await core.trains(from.areaId, to.areaId, now, 3);
    const v = tripView({ screen: 'trip', from, to }, js, { now, settings: settings() });
    expect(v.title).toBe('Bruxelles-Central ▶ Gand-Saint-Pierre');
    expect(check(v)).toEqual([
      '14:10   voie 4, arrivée 14:39   à l’heure',
      '14:22   voie 6, arrivée 14:56   +3 min',
      '14:40   voie 4, arrivée 15:09   à l’heure',
      '▲▼ trains   toucher : détail   double : retour',
    ]);
  });

  it('arrivée : la suite devant la gare (Visite3, étape 4)', async () => {
    const t = at(14, 36);
    const c = fakeCore(() => t);
    const b = await c.board('delijn:200553', { limit: 8 });
    const deps = b.departures.filter((d) => d.est >= at(14, 39));
    const v = arrivalView('Gand-Saint-Pierre', at(14, 39), deps.slice(0, 2), { now: t, settings: settings() });
    expect(v.title).toBe('Arrivée à Gand-Saint-Pierre');
    expect(check(v)).toEqual([
      'Dans 3 min. Ensuite, devant la gare :',
      'Tram 1   Korenmarkt, Gand   8 min',
      'Tram 1   Korenmarkt, Gand   17 min',
      'toucher : ★ garder ce trajet   double : retour',
    ]);
  });

  it('recherche « Gand » : gares d’abord', async () => {
    const items = await core.search('Gand', { lat: from.lat, lon: from.lon });
    expect(items.map((i) => `${i.n.fr} (${i.kindLabel})`)).toEqual([
      'Gand-Saint-Pierre (gare SNCB)',
      'Gand-Dampoort (gare SNCB)',
      'Korenmarkt, Gand (tram De Lijn)',
      'Gand-Saint-Pierre (tram De Lijn)',
    ]);
  });
});

describe('états d’attente, d’erreur et listes vides', () => {
  const ctx = { now: SCENARIO.s2.now, settings: preset() };

  it('messages en français, écran « message »', () => {
    expect(check(loadingView('Autour de moi', 'Recherche des arrêts…', ctx))).toEqual(['Recherche des arrêts…', 'double toucher : retour']);
    const empty = nearbyView([], ctx);
    expect(empty.screen).toBe('message');
    expect(check(empty)[0]).toBe('Aucun arrêt dans un rayon de 500 m');
    const err = errorView('Quai', 'Données indisponibles : vérifie la publication de cette nuit', ctx);
    expect(err.tap).toEqual({ kind: 'retry' });
    expect(check(err)).toContain('toucher : réessayer   double : retour');
    expect(check(firstRunView(ctx))[0]).toBe('Bienvenue dans Quai !');
    expect(check(notConfiguredView(ctx))[0]).toBe('Quai n’est pas encore configuré.');
    expect(favoritesView({}, { ...ctx, settings: { ...ctx.settings, favorites: [] } }).screen).toBe('message');
  });

  it('ligne de données périmées sur l’accueil', () => {
    const v = homeView({ suggestion: null, nearbyCount: 4, near: 'Bruxelles-Nord', stale: 'Horaires périmés : mise à jour arrêtée le 11/11' }, ctx);
    expect(v.top).toEqual({ text: 'Horaires périmés : mise à jour arrêtée le 11/11', strong: true });
    const lines = check(v);
    expect(lines[0]).toBe('Horaires périmés : mise à jour arrêtée le 11/11');
    const near = homeView({ suggestion: null, nearbyCount: 4, near: 'Bruxelles-Nord' }, ctx);
    expect(check(near)[0]).toBe('Près de Bruxelles-Nord');
  });

  it('favoris : prochain départ en bout de ligne', () => {
    const v = favoritesView({ 'fav-gdn': { text: 'T3 2 min', planned: false }, 'fav-dl-nord': { text: '232 ~5 min', planned: true } }, ctx);
    const lines = check(v);
    expect(lines[1]).toBe('Gare du Nord (STIB)   T3 2 min');
    expect(lines).toContain('~ horaire prévu, sans temps réel');
  });
});

describe('réglages de l’affichage', () => {
  it('nombre de départs, langue des noms', async () => {
    const now = SCENARIO.s2.now;
    const core = fakeCore(() => now);
    const b = await core.board('delijn:308611', { limit: 8 });
    const s = preset();
    const three = boardView(b, { now, settings: { ...s, display: { ...s.display, depsPerStop: 3 } } }, { isFavorite: false });
    expect(three.items).toHaveLength(3);
    const nl = boardView(b, { now, settings: { ...s, lang: 'nl' } }, { isFavorite: false });
    expect(nl.title).toBe('Brussel Noordstation, bus (De Lijn)');
    expect(nl.items[0].b).toBe('Vilvoorde');
  });
});

describe('voie modifiée jamais coupée (bout en bout : vrai cœur, scène base)', () => {
  // Avec le vrai cœur, Autour de moi à Namur affichait « IC 07:42 +2 v… » : la voie modifiée disparaissait.
  const now = SCENARIO.s1.now;
  const train = (delayMin: number, platform: string, newPlatform: string, line = 'IC') => ({
    op: 'sncb' as const, mode: 'train' as const, line, head: { fr: 'Bruxelles-Midi', nl: 'Brussel-Zuid' },
    sched: at(7, 42), est: at(7, 42) + delayMin * 60_000, rt: true, delayMin, cancelled: false, platform, newPlatform,
  });
  const area = (id: string, fr: string) => ({ id, op: 'sncb' as const, n: { fr, nl: fr }, lat: 50.4685, lon: 4.8625, modes: ['train' as const], lines: ['IC'] });

  it('Autour de moi : « IC 07:42 +2 v.6 ! » et les cas à deux chiffres tiennent dans la colonne', () => {
    const cases: [ReturnType<typeof train>, string][] = [
      [train(2, '4', '6'), 'IC 07:42 +2 v.6 !'],
      [train(12, '4', '12'), 'IC 07:42 +12 v.12 !'],
      [train(12, '4', '12', 'S10'), 'S10 07:42 +12 v.12 !'],
    ];
    for (const [next, text] of cases) {
      const v = nearbyView([{ area: area('sncb:8863008', 'Namur'), distanceM: 420, walkMin: 7, next }], { now, settings: preset() });
      const lines = check(v);
      expect(lines[0]).toBe(`Namur, train   420 m   ${text}`);
    }
    // les noms de zone usuels gardent leur place
    const long = nearbyView([{ area: { ...area('tec:N509aaa', 'Namur Place Léopold'), op: 'tec', modes: ['bus'] }, distanceM: 150, walkMin: 3 }], { now, settings: preset() });
    expect(check(long)[0]).toBe('Namur Place Léopold, bus TEC   150 m');
  });

  it('Mes favoris : le prochain train avec voie modifiée n’est pas coupé', () => {
    const v = favoritesView({ 'fav-namur': { text: 'IC 07:42 +12 v.12 !', planned: false } }, { now, settings: preset() });
    expect(check(v)).toContain('Namur (SNCB)   IC 07:42 +12 v.12 !');
  });
});

describe('polissage : lendemain, horaires périmés, déjà sur place, destinations STIB', () => {
  const late = at(23, 30);
  const T = (hh: number, mm: number, day = 0) => at(hh, mm) + day * 86_400_000;
  const N = (fr: string, nl = fr) => ({ fr, nl });
  const ctx = (patch: Partial<{ stale: string }> = {}) => ({ now: late, settings: preset(), ...patch });
  const nord = { id: 'sncb:8812005', op: 'sncb' as const, n: N('Bruxelles-Nord', 'Brussel-Noord'), lat: 50.86, lon: 4.36, modes: ['train' as const], lines: ['IC'] };
  const train = (p: Partial<Departure>): Departure => ({ op: 'sncb', mode: 'train', line: 'IC', head: N('Anvers-Central'), sched: T(23, 52), est: T(23, 52), rt: true, delayMin: 0, cancelled: false, platform: '9', ...p });
  const board = (area: Board['area'], departures: Departure[]): Board => ({ area, departures, anyPlanned: true, rtErrors: [], updatedAt: late });
  const ride = (p: Partial<Leg> = {}): Leg => ({
    kind: 'ride', from: { name: N('Bruxelles-Central'), lat: 50.845, lon: 4.357, areaId: 'sncb:8813003' }, to: { name: N('Gand-Saint-Pierre'), lat: 51.03, lon: 3.71, areaId: 'sncb:8892007' },
    dep: T(14, 10, 1), arr: T(14, 39, 1), schedDep: T(14, 10, 1), schedArr: T(14, 39, 1), op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruges'), rt: false, delayMin: 0, cancelled: false, platform: '4', ...p,
  });
  const walk = (dep: number, min: number): Leg => ({ kind: 'walk', from: { name: N('Ma position'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Central'), lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
  const journey = (legs: Leg[]): Journey => ({ id: 'j1', legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: legs[0].dep, transfers: 0, rt: false, alerts: [] });

  it('tableau train : départs du lendemain avec « demain, » devant la destination, jamais coupé', () => {
    const b = board(nord, [train({}), train({ sched: T(0, 1, 1), est: T(0, 1, 1), rt: false }), train({ sched: T(8, 42, 1), est: T(8, 42, 1), rt: false, platform: '12', head: N('Louvain-la-Neuve-Université-Centre-Sud') })]);
    const lines = check(boardView(b, ctx(), { isFavorite: false }));
    expect(lines[0]).toBe('IC   Anvers-Central   23:52  voie 9');
    expect(lines[1]).toBe('IC   demain, Anvers-Central   ~00:01  voie 9');
    expect(lines[2]).toMatch(/^IC   demain, Louvain-la-Neuve.*   ~08:42  voie 12$/);
  });

  it('tableau bus : « demain, » au-delà d’une heure, compte à rebours sinon', () => {
    const dl = { ...nord, id: 'delijn:308611', op: 'delijn' as const, n: N('Bruxelles-Nord', 'Brussel Noordstation'), modes: ['bus' as const], lines: ['232'] };
    const bus = (est: number): Departure => ({ op: 'delijn', mode: 'bus', line: '232', head: N('Vilvorde', 'Vilvoorde'), sched: est, est, rt: false, delayMin: 0, cancelled: false });
    const lines = check(boardView(board(dl, [bus(T(0, 10, 1)), bus(T(6, 0, 1))]), ctx(), { isFavorite: false }));
    expect(lines[0]).toBe('232   Vilvorde   ~40 min');
    expect(lines[1]).toBe('232   demain, Vilvorde   ~06:00');
  });

  it('Autour de moi et favoris : prochain départ du lendemain en forme courte', () => {
    const next = train({ sched: T(8, 42, 1), est: T(8, 42, 1), rt: false, platform: '12' });
    const n = check(nearbyView([{ area: nord, distanceM: 160, walkMin: 3, next }], ctx()));
    expect(n[0]).toBe('Bruxelles-Nord, train   160 m   IC ~demain 08:42');
    const f = check(favoritesView({ 'fav-namur': { text: 'IC ~demain 08:42', planned: true } }, ctx()));
    expect(f).toContain('Namur (SNCB)   IC ~demain 08:42');
    // cas le plus large (ligne à 3 chiffres, « 00 » et « 08 ») : vu tronqué dans le simulateur avec 176 px
    const dl = { ...nord, id: 'delijn:308611', op: 'delijn' as const, n: N('Bruxelles-Nord', 'Brussel Noordstation'), modes: ['bus' as const], lines: ['460'] };
    const bus = { op: 'delijn' as const, mode: 'bus' as const, line: '460', head: N('Meise'), sched: T(8, 8, 1), est: T(8, 8, 1), rt: false, delayMin: 0, cancelled: false };
    expect(check(nearbyView([{ area: dl, distanceM: 200, walkMin: 4, next: bus }], ctx()))[0]).toBe('Bruxelles-Nord, bus De Lijn   200 m   460 ~demain 08:08');
    const tec = { ...nord, id: 'tec:N509aaa', op: 'tec' as const, n: N('Namur Place Léopold'), modes: ['bus' as const], lines: ['5'] };
    expect(check(nearbyView([{ area: tec, distanceM: 150, walkMin: 3, next: { ...bus, op: 'tec' as const, line: '888' } }], ctx()))[0]).toBe('Namur Place Léopold, bus TEC   150 m   888 ~demain 08:08');
  });

  it('trains A ▶ B, propositions, étapes, Aller à… et dans le train : le lendemain est dit', () => {
    const from = { areaId: 'sncb:8813003', op: 'sncb' as const, name: N('Bruxelles-Central'), lat: 50.845, lon: 4.357 };
    const to = { areaId: 'sncb:8892007', op: 'sncb' as const, name: N('Gand-Saint-Pierre'), lat: 51.03, lon: 3.71 };
    const j = journey([ride()]);
    expect(check(tripView({ screen: 'trip', from, to }, [j], ctx()))[0]).toBe('~14:10   demain, voie 4, arrivée 14:39');
    const door = journey([walk(T(13, 55, 1), 12), ride()]);
    door.leaveAt = T(13, 55, 1);
    const jv = journeysView({ screen: 'journeys', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, label: 'Bureau' }, [door], ctx());
    expect(check(jv)[0]).toMatch(/^~demain 13:55 ▶ 14:39   /);
    const sv = stepsView({ screen: 'steps', journey: door, label: 'Bureau', leaveAt0: door.leaveAt }, door, ctx());
    expect(sv.title).toBe('Vers le bureau\u00a0: demain 13:55 ▶ 14:39');
    expect(placeSummary([door], late)).toBe('arrivée demain 14:39');
    expect(check(placesView({ maison: 'ici', bureau: 'arrivée demain 14:39' }, ctx()))[1]).toBe('Bureau   arrivée demain 14:39');
    expect(trainView(j, 0, ctx()).title).toBe('IC vers Bruges, demain');
  });

  it('horaires périmés : le message de fraîcheur remplace « Aucun départ… » et les listes vides', () => {
    const stale = 'Horaires périmés : mise à jour arrêtée le 02/11';
    expect(check(boardView(board(nord, []), ctx({ stale }), { isFavorite: false }))[0]).toBe(stale);
    expect(check(boardView(board(nord, []), ctx(), { isFavorite: false }))[0]).toBe('Aucun départ dans les prochaines heures');
    const from = { areaId: 'sncb:8813003', op: 'sncb' as const, name: N('Bruxelles-Central'), lat: 0, lon: 0 };
    expect(check(tripView({ screen: 'trip', from, to: from }, [], ctx({ stale })))[0]).toBe(stale);
    expect(check(journeysView({ screen: 'journeys', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, label: 'Bureau' }, [], ctx({ stale })))[0]).toBe(stale);
    expect(check(nearbyView([{ area: nord, distanceM: 160, walkMin: 3 }], ctx({ stale })))).toContain(stale);
    expect(check(favoritesView({}, ctx({ stale })))).toContain(stale);
  });

  it('déjà sur place : « Tu es déjà à la maison. »', () => {
    const v = alreadyThereView('Maison', ctx());
    expect(v.title).toBe('Vers la maison');
    expect(check(v)[0]).toBe('Tu es déjà à la maison.');
    expect(check(alreadyThereView('Bureau', ctx()))[0]).toBe('Tu es déjà au bureau.');
  });

  it('STIB : « Stalle » sans « (P) » dans les étapes et le titre du train', () => {
    const t4 = ride({ op: 'stib', mode: 'tram', line: '4', cat: undefined, head: N('Stalle (P)'), platform: undefined, dep: T(23, 40), arr: T(23, 50), schedDep: T(23, 40), schedArr: T(23, 50) });
    const j = journey([t4]);
    const sv = check(stepsView({ screen: 'steps', journey: j, label: 'Bureau', leaveAt0: j.leaveAt }, j, ctx()));
    expect(sv.some((l) => /T4 vers Stalle$/.test(l))).toBe(true);
    expect(trainView(j, 0, ctx()).title).toBe('T4 vers Stalle');
  });
});
