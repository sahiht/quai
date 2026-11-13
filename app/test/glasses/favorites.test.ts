/**
 * Quai 1.2.2, liste « Favoris » (docs/v1.2.2/PRD-1.2.2.md § 1.2, REVUE-USAGE n° 2, n° 5 et n° 7 ; CA-122.2) : tous les
 * favoris dans l'ordre réglé, ligne 1 identique à l'accueil, ligne 2 plus pâle ; puis la ligne pâle « Adresses
 * récentes » (jamais sélectionnée) et 3 adresses au plus avec leur réponse au format de l'accueil ; puis « Autre
 * adresse ». « Aller à… » n'existe plus : un état de la 1.2.1 sur cet écran s'ouvre sur « Favoris ».
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey, RecentAddress } from '../../src/core/api';
import { favoriteDetail, planHomeText } from '../../src/glasses/format';
import { LAYOUTS, WIDTHS } from '../../src/glasses/layout';
import { parseNav } from '../../src/glasses/nav';
import { textWidth } from '../../src/glasses/font';
import { favoritesView, homeView, RECENT_HEAD, type FavoriteEntry, type ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, at, container, journey, lines, nb, page, rowsOf, settingsWith, setup, stubCore, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 31);

function door(id: string, leave: number, arr: number, rt = true): Journey {
  const j = journey(id, [{ walk: 5 }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Arrêt', to: 'Gare' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
  if (!rt) for (const l of j.legs) if (l.kind === 'ride') l.rt = false;
  return j;
}
const tripAnswer = (fav: Favorite, j: Journey): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: NOW });
function answers(fav: Favorite, now: number): FavoriteAnswer | undefined {
  if (fav.id === 'fav-bureau') return tripAnswer(fav, door('j-bureau', now + 4 * MIN, now + 75 * MIN));
  if (fav.id === 'fav-mama') return tripAnswer(fav, door('j-mama', now + 9 * MIN, now + 80 * MIN, false));
  if (fav.id === 'fav-maison') return { favoriteId: fav.id, kind: 'trip', state: 'here', updatedAt: now };
  return undefined;
}

/** Adresses récentes publiques ; la 4e n'est jamais montrée (3 au plus). */
const RECENT: RecentAddress[] = [
  { label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, at: 4 },
  { label: 'Grand-Place 1, 1000 Bruxelles', lat: 50.8467, lon: 4.3525, at: 3 },
  { label: 'Place Saint-Lambert 1, 4000 Liège', lat: 50.6451, lon: 5.5734, at: 2 },
  { label: 'Grand-Place 1, 7000 Mons', lat: 50.4542, lon: 3.952, at: 1 },
];
const FAVS = [PLACES.maison, PLACES.bureau, PLACES.mama];
const listReady = (s: Screen) => s.screen === 'favorites' && !s.lines.some((l) => / …$/.test(l));

describe('CA-122.2 : favoris, puis adresses récentes, puis « Autre adresse »', () => {
  it('titre « Favoris » ; ligne 1 comme l’accueil, ligne 2 le détail ; « tu y es » sur une ligne', async () => {
    const h = await setup({ now: NOW, settings: settingsWith(FAVS, { seenVersion: '1.2.5' }), core: (now) => stubCore(now, { answers }) });
    await h.until((x) => x.screen === 'home' && x.shown?.length === 2);
    await h.gesture('up', 'tap');
    const s = await h.until(listReady);
    expect(s.title).toBe('Favoris');
    expect(s.order).toEqual(['fav-bureau', 'fav-mama', 'fav-maison']);
    expect(s.lines).toEqual([
      'Bureau   dans 4 min → 08:46',
      'bus W 07:40, direct',
      'Mama   dans 9 min → 08:51',
      'bus W ~07:45, direct',
      'Maison   tu y es',
      'Autre adresse   sur le téléphone',
      // « ~ » seulement en ligne 2, avec la note du bas
      '~ horaire prévu, sans temps réel',
      '△▽ choisir   toucher : ouvrir   double : retour',
    ]);
    h.c.stop();
  });

  it('la ligne 1 de chaque favori est celle de l’accueil (REVUE-USAGE n° 7)', () => {
    const ctx: ViewCtx = { now: NOW, settings: settingsWith(FAVS) };
    const entries: FavoriteEntry[] = FAVS.map((fav) => ({ fav, answer: answers(fav, NOW) }));
    const home = homeView({ favorites: entries, nearbyCount: 9, gestureHelp: false }, ctx);
    const homeRows = home.items.filter((i) => i.action?.kind === 'openFavorite').map((i) => [i.b, nb(i.bRight ?? '')]);
    const list = favoritesView({ entries }, ctx);
    const listRows = list.items.filter((i) => i.action?.kind === 'openFavorite').map((i) => [i.a, nb(i.c ?? '')]);
    expect(listRows.slice(0, homeRows.length)).toEqual(homeRows);
    // colonne de droite de 210 px comme « Autres trajets », 2e ligne un ton plus pâle
    expect(LAYOUTS.favorites.c).toMatchObject({ w: 212, align: 'right', level: 4 });
    expect(LAYOUTS.favorites.b.level).toBe(2);
    expect(container(page(list), 'colB').level).toBe(2);
  });

  it('adresses récentes : la ligne pâle « Adresses récentes », 3 au plus, réponse au format de l’accueil, jamais sélectionnée', async () => {
    const plan = (now: number) => [door('j-r', now + 9 * MIN, now + 80 * MIN)];
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.5', recent: RECENT }), core: (now) => stubCore(now, { answers, plan }) });
    await h.until((x) => x.screen === 'home' && x.shown?.length === 1);
    await h.gesture('up', 'tap');
    await h.until(listReady);
    // du favori (2 lignes) vers la 1re adresse : la ligne pâle est sautée, elle reste visible au-dessus
    await h.gesture('down', 'down', 'down', 'down');
    const s = await h.until((x) => listReady(x) && x.sel === 4);
    expect(s.lines.slice(-6, -1)).toEqual(['ADRESSES RÉCENTES', 'Rue Neuve 1   dans 9 min → 08:51', 'Grand-Place 1   dans 9 min → 08:51', 'Place Saint-Lambert 1   dans 9 min → 08:51', 'Autre adresse   sur le téléphone']);
    expect(s.lines.join('\n')).not.toContain('Mons');
    const p = h.sent();
    const colB = rowsOf(p.find((c) => c.name === 'colB')!);
    expect(colB).toContain(RECENT_HEAD);
    expect(p.find((c) => c.name === 'colB')!.level).toBe(2);
    // le curseur est sur « Autre adresse » ; jamais sur la ligne pâle
    const cursor = rowsOf(p.find((c) => c.name === 'cursor')!);
    expect(cursor[colB.indexOf(RECENT_HEAD)]).toBe('');
    // toucher : un message (appli Even)
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('Tape l’adresse dans Quai, sur le téléphone');
    // une adresse récente : ses étapes, pas suivies (PRD-1.2.2 § 6)
    await h.gesture('up', 'tap');
    const st = await h.until((x) => x.screen === 'steps' && x.page !== undefined);
    // « Suivre ce trajet » couperait la destination : « Suivre », le titre entier
    expect(nb(st.title)).toBe('Vers Place Saint-Lambert 1 : 07:40 → 08:51   Suivre');
    expect(h.c.followed).toBeNull();
    h.c.stop();
  });

  it('sur place : « tu y es » ; sans position : « sans position » ; Quai Web : « dans Réglages » et #/recherche', async () => {
    expect(planHomeText({ journeys: [], empty: 'here' }, NOW)).toBe('tu y es');
    expect(planHomeText({ journeys: [], empty: 'noPosition' }, NOW)).toBe('sans position');
    expect(planHomeText({ journeys: [], empty: 'noTrip' }, NOW)).toBe('aucun trajet');
    expect(planHomeText(undefined, NOW)).toBe('…');
    const here = { lat: RECENT[0].lat, lon: RECENT[0].lon };
    const opened: string[] = [];
    const h = await setup({ now: NOW, pos: here, web: true, opened, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.5', recent: RECENT.slice(0, 1) }), core: (now) => stubCore(now, { answers }) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'favorites' });
    const s = await h.until((x) => listReady(x) && x.lines.some((l) => l.startsWith('Rue Neuve 1')));
    expect(s.lines.slice(2, 5)).toEqual(['ADRESSES RÉCENTES', 'Rue Neuve 1   tu y es', 'Autre adresse   dans Réglages']);
    await h.gesture('down', 'down', 'tap');
    expect(opened).toEqual(['#/recherche']);
    h.c.stop();
  });

  it('sans favori : « Ajouter un favori » en premier ; toucher : comment en ajouter (REVUE-USAGE n° 2)', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.5' }), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.includes('Autour de moi   9 arrêts'));
    expect(home.lines.slice(0, 2)).toEqual(['Près de Arrêt 1', 'Ajouter un favori']);
    await h.gesture('tap');
    const s = await h.until(listReady);
    expect(s.lines.slice(0, 2)).toEqual(['Ajouter un favori   sur le téléphone', 'Autre adresse   sur le téléphone']);
    await h.gesture('tap');
    expect(await h.until((x) => x.screen === 'message')).toMatchObject({ title: 'Favoris', lines: ['Aucun favori pour l’instant.', 'Ajoute Maison ou Bureau sur le téléphone.', 'double toucher : retour'] });
    h.c.stop();
    // Quai Web : « Nouveau favori » dans l'onglet Réglages
    const v = favoritesView({}, { now: NOW, settings: settingsWith([]), web: true });
    expect(v.items[0]).toMatchObject({ a: 'Ajouter un favori', c: 'dans Réglages', action: { kind: 'phone', hash: '#/favoris/nouveau' } });
  });

  it('« Aller à… » n’existe plus : ni sur l’accueil, ni comme écran ; un état de la 1.2.1 sur « Aller à… » ouvre « Favoris »', async () => {
    const snap = { stack: [{ route: { screen: 'home' }, sel: 0, top: 0 }, { route: { screen: 'places' }, sel: 2, top: 0 }] };
    expect(parseNav(snap)?.stack.map((f) => f.route)).toEqual([{ screen: 'home' }, { screen: 'favorites' }]);
    const h = await setup({ now: NOW, settings: settingsWith(FAVS, { seenVersion: '1.2.5' }), core: (now) => stubCore(now, { answers }) });
    await h.until((x) => x.screen === 'home');
    expect(h.screens().every((x) => !x.lines.some((l) => l.startsWith('Aller à')))).toBe(true);
    h.c.restore(JSON.stringify({ v: 2, nav: snap }));
    expect((await h.until(listReady)).title).toBe('Favoris');
    await h.gesture('double');
    expect(h.last().screen).toBe('home');
    h.c.stop();
  });
});

describe('§ 1.2 : textes et largeurs', () => {
  it('2e ligne : véhicule en toutes lettres et son heure, voie, changements, sans l’arrivée', () => {
    const s = settingsWith(FAVS);
    const ic = journey('ic', [{ walk: 7 }, { ride: 'IC', mode: 'train', dep: NOW + 11 * MIN, arr: NOW + 64 * MIN, from: 'Braine-l’Alleud', to: 'Bruxelles-Central', platform: '4' }, { walk: 3 }]);
    const r = ic.legs[1];
    if (r.kind === 'ride') {
      r.delayMin = 2;
      r.newPlatform = '6';
    }
    expect(nb(favoriteDetail(tripAnswer(PLACES.bureau, ic), NOW, s)!.text)).toBe('IC 07:42 +2 voie 6 !, direct');
    // gare de départ hors de portée à pied : « IC voie 4 à Bruxelles-Central »
    const station = journey('st', [{ ride: 'IC', mode: 'train', dep: NOW + 30 * MIN, arr: NOW + 60 * MIN, from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4' }]);
    expect(favoriteDetail({ ...tripAnswer(PLACES.bureau, station), fromStation: true }, NOW, s)!.text).toBe('IC voie 4 à Bruxelles-Central');
    // à pied ; « tu y es » : pas de 2e ligne
    const walk = { ...journey('w', [{ walk: 9 }]), dep: NOW, arr: NOW + 9 * MIN };
    expect(nb(favoriteDetail(tripAnswer(PLACES.bureau, walk), NOW, s)!.text)).toBe('à pied, 9 min');
    expect(favoriteDetail({ favoriteId: 'x', kind: 'trip', state: 'here', updatedAt: NOW }, NOW, s)).toBeNull();
  });

  it('en calcul : deux lignes réservées ; tout tient au pixel', () => {
    const s = settingsWith(FAVS, { recent: RECENT });
    const v = favoritesView({ entries: FAVS.map((fav) => ({ fav })) }, { now: NOW, settings: s });
    expect(v.items.slice(0, 3).map((i) => [i.a, i.c, i.two])).toEqual([['Maison', '…', true], ['Bureau', '…', true], ['Mama', '…', true]]);
    lines(v);
    for (const it of v.items) {
      expect(textWidth(it.c ?? '')).toBeLessThanOrEqual(WIDTHS.wideRight);
      if (it.b2) expect(textWidth(it.b2)).toBeLessThanOrEqual(WIDTHS.full);
    }
  });
});
