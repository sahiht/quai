/**
 * Quai 1.2.2, liste « Favoris » (docs/v1.2.2/PRD-1.2.2.md § 1.2, REVUE-USAGE n° 2, n° 5 et n° 7 ; CA-122.2) : tous les
 * favoris dans l'ordre réglé, au format de l'accueil ; puis la ligne pâle « Adresses récentes » (jamais sélectionnée) et
 * 3 adresses au plus avec leur réponse au format de l'accueil ; puis « Autre adresse ». « Aller à… » n'existe plus : un
 * état de la 1.2.1 sur cet écran s'ouvre sur « Favoris ». 1.2.10 (docs/v1.2.10/PRD-1.2.10.md § 2) : une ligne par
 * favori. 1.3.0 (docs/v1.3.0/PRD-1.3.0.md § 7) : le détail du favori sous le curseur s'ouvre sous lui (accordéon,
 * DetailItem.expand ; contenu : v130-ecrans.test.ts), plus de ligne du détail en bas.
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey, RecentAddress } from '../../src/core/api';
import { favoriteDetail, planHomeText } from '../../src/glasses/format';
import { LAYOUTS, WIDTHS, type DetailItem } from '../../src/glasses/layout';
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
  if (fav.id === 'fav-ecole') return tripAnswer(fav, door('j-ecole', now + 9 * MIN, now + 80 * MIN, false));
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
const FAVS = [PLACES.maison, PLACES.bureau, PLACES.ecole];
const listReady = (s: Screen) => s.screen === 'favorites' && !s.lines.some((l) => / …$/.test(l));

describe('CA-122.2 : favoris, puis adresses récentes, puis « Autre adresse »', () => {
  it('titre « Favoris » ; une ligne par favori comme l’accueil ; 1.3.0 : plus de ligne du détail en bas (accordéon, PRD-1.3.0 § 7)', async () => {
    const h = await setup({ now: NOW, settings: settingsWith(FAVS, { seenVersion: '1.3.0' }), core: (now) => stubCore(now, { answers }) });
    await h.until((x) => x.screen === 'home' && x.shown?.length === 2);
    // 1.3.1 (PRD-1.3.1 § 8) : de « Autour de moi » (curseur à l'ouverture), « Favoris » juste dessous
    await h.gesture('down', 'tap');
    const s = await h.until(listReady);
    expect(s.title).toBe('Favoris');
    expect(s.order).toEqual(['fav-bureau', 'fav-ecole', 'fav-maison']);
    const rows = ['Bureau   dans 4 min → 08:46', 'École   dans 9 min → 08:51', 'Maison   tu y es', 'Autre adresse   sur le téléphone'];
    // les rangées dans l'ordre (l'accordéon du curseur, rendu par la mise en page, peut s'y glisser) ; en bas, plus de
    // ligne du détail : « Autre adresse », puis les aides, quel que soit le favori sous le curseur
    const bottom = ['Autre adresse   sur le téléphone', '△▽ choisir   toucher : ouvrir   double : retour'];
    expect(s.lines.filter((l) => rows.includes(l))).toEqual(rows);
    expect(s.lines.slice(-2)).toEqual(bottom);
    // 1.3.1 (PRD-1.3.1 § 4) : l'accordéon dit le véhicule et son heure sur sa 2e ligne : une seule fois, sous la 1re
    const k = s.lines.indexOf('bus W 07:40, direct');
    expect(s.lines.filter((l) => l === 'bus W 07:40, direct')).toHaveLength(1);
    expect(s.lines[k - 1]).toBe('à pied 5 min → Arrêt');
    await h.gesture('down');
    const e = await h.until((x) => listReady(x) && x.sel === 1);
    expect(e.lines.slice(-2)).toEqual(bottom);
    await h.gesture('down');
    const m = await h.until((x) => listReady(x) && x.sel === 2);
    expect(m.lines.slice(-2)).toEqual(bottom);
    h.c.stop();
    // l'accordéon de chaque favori (« ~ » au début de l'heure prévue ; « tu y es » : rien ne s'ouvre)
    const v = favoritesView({ entries: FAVS.map((fav) => ({ fav, answer: answers(fav, NOW) })) }, { now: NOW, settings: settingsWith(FAVS) });
    expect(v.accordion).toBe(true);
    expect(v.items.slice(0, 3).map((i) => (i as DetailItem).expand?.map((l) => nb(l.text)))).toEqual([undefined, ['à pied 5 min → Arrêt', 'bus W 07:40, direct'], ['à pied 5 min → Arrêt', 'bus W ~07:45, direct']]);
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
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0', recent: RECENT }), core: (now) => stubCore(now, { answers, plan }) });
    await h.until((x) => x.screen === 'home' && x.shown?.length === 1);
    // 1.3.1 (§ 8) : de « Autour de moi », « Favoris » juste dessous
    await h.gesture('down', 'tap');
    await h.until(listReady);
    // du favori vers la 1re adresse : la ligne pâle est sautée, elle reste visible au-dessus ; 1.3.0 : l'adresse complète
    // dans l'accordéon (PRD-1.3.0 § 7), plus en bas
    await h.gesture('down');
    const r = await h.until((x) => listReady(x) && x.sel === 1);
    const rows = ['ADRESSES RÉCENTES', 'Rue Neuve 1   dans 9 min → 08:51', 'Grand-Place 1   dans 9 min → 08:51', 'Place Saint-Lambert 1   dans 9 min → 08:51', 'Autre adresse   sur le téléphone'];
    expect(r.lines.filter((l) => rows.includes(l))).toEqual(rows);
    expect(r.lines.at(-2)).toBe('Autre adresse   sur le téléphone');
    await h.gesture('down', 'down', 'down');
    const s = await h.until((x) => listReady(x) && x.sel === 4);
    expect(s.lines.join('\n')).not.toContain('Mons');
    const p = h.sent();
    const colB = rowsOf(p.find((c) => c.name === 'colB')!);
    expect(colB).toContain(RECENT_HEAD);
    expect(p.find((c) => c.name === 'colB')!.level).toBe(2);
    // le curseur est sur « Autre adresse » ; jamais sur la ligne pâle ; 1.3.0 : le pied n'a que les aides
    const cursor = rowsOf(p.find((c) => c.name === 'cursor')!);
    expect(cursor[colB.indexOf(RECENT_HEAD)]).toBe('');
    expect(rowsOf(p.find((c) => c.name === 'foot')!)).toEqual(['△▽ choisir   toucher : ouvrir   double : retour']);
    // toucher : un message (appli Even)
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('Tape l’adresse dans Quai, sur le téléphone');
    // une adresse récente : ses étapes, pas suivies (PRD-1.2.2 § 6) ; 1.2.10 : le nom du trajet en titre
    await h.gesture('up', 'tap');
    const st = await h.until((x) => x.screen === 'steps' && x.page !== undefined);
    expect(nb(st.title)).toBe('Place Saint-Lambert 1');
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
    const h = await setup({ now: NOW, pos: here, web: true, opened, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0', recent: RECENT.slice(0, 1) }), core: (now) => stubCore(now, { answers }) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'favorites' });
    const s = await h.until((x) => listReady(x) && x.lines.some((l) => l.startsWith('Rue Neuve 1')));
    // 1.3.0 (PRD-1.3.0 § 7) : le curseur est sur « Bureau » : son accordéon ouvert dessous, puis les adresses récentes
    expect(s.lines.slice(1, 6)).toEqual(['à pied 5 min → Arrêt', 'bus W 07:40, direct', 'ADRESSES RÉCENTES', 'Rue Neuve 1   tu y es', 'Autre adresse   dans Réglages']);
    await h.gesture('down', 'down', 'tap');
    expect(opened).toEqual(['#/recherche']);
    h.c.stop();
  });

  it('sans favori : « Ajouter un favori » en premier ; toucher : comment en ajouter (REVUE-USAGE n° 2)', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0' }), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.includes('Autour de moi   9 arrêts'));
    // 1.3.1 (§ 8) : « Autour de moi » en tête, « Ajouter un favori » juste dessous
    expect(home.lines.slice(0, 3)).toEqual(['Près de Arrêt 1', 'Autour de moi   9 arrêts', 'Ajouter un favori']);
    await h.gesture('down', 'tap');
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
    const h = await setup({ now: NOW, settings: settingsWith(FAVS, { seenVersion: '1.3.0' }), core: (now) => stubCore(now, { answers }) });
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
  it('accordéon (PRD-1.3.0 § 7, PRD-1.3.1 § 4) : la marche vers la gare, puis le véhicule en toutes lettres et son heure, la voie ; le souci et les changements', () => {
    const s = settingsWith(FAVS);
    const ic = journey('ic', [{ walk: 7 }, { ride: 'IC', mode: 'train', dep: NOW + 11 * MIN, arr: NOW + 64 * MIN, from: 'Braine-l’Alleud', to: 'Bruxelles-Central', platform: '4' }, { walk: 3 }]);
    const r = ic.legs[1];
    if (r.kind === 'ride') {
      r.delayMin = 2;
      r.newPlatform = '6';
    }
    const texts = (a: FavoriteAnswer) => favoriteDetail(a, NOW, s).map((l) => nb(l.text));
    // 1.3.1 (PRD-1.3.1 § 4) : la 1re ligne nomme la gare où monter, la 2e le train, son heure et sa voie (la voie modifiée)
    expect(texts(tripAnswer(PLACES.bureau, ic))).toEqual(['à pied 7 min → Braine-l’Alleud', 'IC 07:42 +2 voie 6 au lieu de 4, direct']);
    // gare de départ hors de portée à pied : « IC voie 4 à 08:01, à Bruxelles-Central »
    const station = journey('st', [{ ride: 'IC', mode: 'train', dep: NOW + 30 * MIN, arr: NOW + 60 * MIN, from: 'Bruxelles-Central', to: 'Gand-Saint-Pierre', platform: '4' }]);
    expect(texts({ ...tripAnswer(PLACES.bureau, station), fromStation: true })).toEqual(['IC voie 4 à 08:01, à Bruxelles-Central', 'direct']);
    // à pied seulement : une ligne ; « tu y es » : rien ne s'ouvre
    const walk = { ...journey('w', [{ walk: 9 }]), dep: NOW, arr: NOW + 9 * MIN };
    expect(texts(tripAnswer(PLACES.bureau, walk))).toEqual(['à pied 9 min']);
    expect(favoriteDetail({ favoriteId: 'x', kind: 'trip', state: 'here', updatedAt: NOW }, NOW, s)).toEqual([]);
  });

  it('en calcul : « … », une ligne, rien ne s’ouvre ; tout tient au pixel', () => {
    const s = settingsWith(FAVS, { recent: RECENT });
    const v = favoritesView({ entries: FAVS.map((fav) => ({ fav })) }, { now: NOW, settings: s });
    expect(v.items.slice(0, 3).map((i) => [i.a, i.c, i.two])).toEqual([['Maison', '…', undefined], ['Bureau', '…', undefined], ['École', '…', undefined]]);
    // 1.3.0 : plus de ligne du détail (Maison en calcul : rien ne s'ouvre) : huit lignes de liste, puis les aides
    expect(lines(v).slice(-3)).toEqual(['Place Saint-Lambert 1   …', 'Autre adresse   sur le téléphone', '△▽ choisir   toucher : ouvrir   double : retour']);
    expect(v.items.slice(0, 3).every((i) => (i as DetailItem).expand === undefined)).toBe(true);
    for (const it of v.items) {
      expect(textWidth(it.c ?? '')).toBeLessThanOrEqual(WIDTHS.wideRight);
      expect(it.b2).toBeUndefined();
    }
  });
});
