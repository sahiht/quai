// @vitest-environment happy-dom
/**
 * Accueil du téléphone (T1, S8, M8 ; 1.2.9, PRD-1.2.9 § 2.1, piste C « Le miroir des lunettes ») : « Bonjour » et le
 * bouton « Réglages », « Où vas-tu ? » qui ouvre la recherche, bannière « Nouveau » sur une ligne (« Voir ce qui
 * change », « OK »), « Dans tes lunettes » : « Favoris » et jusqu'à 3 favoris dans l'ordre des lunettes (réponse courte,
 * bouton « Lunettes »), puis « Autour de moi », « Gares de train », « Arrêts de bus, tram, métro » et « Lignes de bus,
 * tram, métro », mêmes mots et même ordre que l'accueil des lunettes. Plus de sections avec « Retirer », plus de liste
 * « Réglages » ni de pied de page. Réglages : settings.test.ts ; listes et ajouts : picks.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteAnswer, LinePick, Settings, StationPick } from '../../src/core/api';
import { favoriteTitle } from '../../src/core/favorites';
import type { LineFollow } from '../../src/core/linerun';
import { catchable } from '../../src/glasses/format';
import { HOME_FAVORITES, homeView } from '../../src/glasses/views';
import { NEWS_SINCE, newsState } from '../../src/phone/app';
import { forgetLineColors } from '../../src/phone/badges';
import { ANSWER_MAX_AGE_MS, homeScreen, orderedFavorites, resetAnswers, reusable, rubrics } from '../../src/phone/screens/home';
import { NEWS_122, NEWS_123, NEWS_124, NEWS_125, NEWS_126, NEWS_128, NEWS_129, shortAnswer } from '../../src/phone/text';
import { at, button, defaults, harness, mount, plain, preset11, SCENARIO, textOf, until } from './helpers';

beforeEach(() => {
  resetAnswers();
  forgetLineColors();
});
afterEach(() => document.body.replaceChildren());

const favRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.fav-row')];
const rowText = (r: HTMLElement) => `${textOf(r.querySelector('.t1'))} | ${textOf(r.querySelector('.answer'))}`;
/** Lignes qui ouvrent un écran (« Dans tes lunettes ») : [titre, sous-titre (pastilles : leurs numéros), à droite, ancre]. */
const navRows = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLAnchorElement>('.mirror .nav-row')].map((a) => {
    const badges = [...a.querySelectorAll('.t2 .badge')].map((x) => textOf(x));
    return [textOf(a.querySelector('.t1')), badges.length ? badges.join(' ') : textOf(a.querySelector('.t2')), textOf(a.querySelector('.count')), a.getAttribute('href')];
  });
const navRow = (el: HTMLElement, title: string) => [...el.querySelectorAll<HTMLAnchorElement>('.mirror .nav-row')].find((a) => textOf(a.querySelector('.t1')) === title)!;

const station = (id: string, areaId: string, fr: string, nl = fr): StationPick => ({ id, areaId, name: { fr, nl }, lat: 50.5, lon: 4.5 });
const NAMUR = station('g-namur', 'sncb:8863008', 'Namur', 'Namen');
const CENTRAL = station('g-central', 'sncb:8813003', 'Bruxelles-Central', 'Brussel-Centraal');
const GDN: LinePick = { id: 's-gdn', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017 };
const T3: LineFollow = { id: 'f-t3', op: 'stib', mode: 'tram', line: '3', routes: ['stib:T3-CHURCHILL', 'stib:T3-ESPLANADE'], ends: [{ fr: 'Churchill', nl: 'Churchill' }, { fr: 'Esplanade', nl: 'Esplanade' }] };
const T4: LineFollow = { id: 'f-t4', op: 'stib', mode: 'tram', line: '4', routes: ['stib:T4-STALLE'], ends: [{ fr: 'Stalle (P)', nl: 'Stalle (P)' }] };
const W: LineFollow = { id: 'f-w', op: 'tec', mode: 'bus', line: 'W', routes: [] };

describe('en-tête et « Où vas-tu ? » (M4.1, T1, PRD-1.2.9 § 2.1)', () => {
  for (const web of [false, true]) {
    it(`${web ? 'Quai Web' : 'téléphone'} : « Quai », « Bonjour », et le bouton « Réglages » vers #/reglages ; plus la phrase des départs en direct`, () => {
      const el = mount(homeScreen(harness({ settings: defaults(), web }).ctx));
      const head = el.querySelector('header')!;
      expect(textOf(head.querySelector('.eyebrow'))).toBe('Quai');
      expect(textOf(head.querySelector('h1'))).toBe('Bonjour');
      const settings = head.querySelector<HTMLAnchorElement>('a.head-btn')!;
      expect([textOf(settings), settings.getAttribute('href')]).toEqual(['Réglages', '#/reglages']);
      // une icône décorative, un vrai lien
      expect(settings.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      expect(textOf(el)).not.toMatch(/Les départs en direct/);
      expect(head.querySelector('.lead')).toBeNull();
    });
  }

  it('« Où vas-tu ? » remplace « Rechercher un trajet » et ouvre la recherche', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(homeScreen(hz.ctx));
    expect(el.textContent).not.toContain('Rechercher un trajet');
    const where = el.querySelector<HTMLButtonElement>('.where')!;
    expect(textOf(where.querySelector('.where-label'))).toBe('Où vas-tu ?');
    expect(textOf(where.querySelector('.where-box'))).toBe('Adresse, gare, arrêt ou favori');
    where.click();
    expect(hz.went).toEqual(['#/recherche']);
  });

  it('alertes inchangées : « Quai n’est pas configuré », « Horaires périmés » avec le lien vers Données', () => {
    const off = harness({ settings: defaults() });
    off.ctx.configured = false;
    expect(textOf(mount(homeScreen(off.ctx)).querySelector('.warn[role="alert"] strong'))).toBe('Quai n’est pas configuré.');
    const stale = harness({ settings: defaults() });
    stale.ctx.freshness = () => ({ ok: false, message: 'Horaires périmés depuis 3 jours' }) as ReturnType<typeof stale.ctx.freshness>;
    const warn = mount(homeScreen(stale.ctx)).querySelector('.warn[role="alert"]')!;
    expect(textOf(warn.querySelector('strong'))).toBe('Horaires périmés depuis 3 jours');
    expect(warn.querySelector('a')!.getAttribute('href')).toBe('#/donnees');
  });
});

describe('« Dans tes lunettes » : les rubriques des lunettes, mêmes mots, même ordre (PRD-1.2.9 § 2.1)', () => {
  it('titre, « Mêmes rubriques, même ordre. », lien « Aperçu » vers Affichage (retour à l’accueil) ; « Favoris », « Autour de moi » puis les trois rubriques', () => {
    const hz = harness({ settings: defaults({ favorites: preset11().favorites, stations: [NAMUR, CENTRAL], lines: [GDN], follows: [T3, T4, W] }) });
    const el = mount(homeScreen(hz.ctx));
    const sec = el.querySelector<HTMLElement>('.mirror-sec')!;
    expect(textOf(sec.querySelector('h2'))).toBe('Dans tes lunettes');
    expect(sec.getAttribute('aria-labelledby')).toBe(sec.querySelector('h2')!.id);
    expect(textOf(sec.querySelector('.sec-lead'))).toBe('Mêmes rubriques, même ordre.');
    const preview = sec.querySelector<HTMLAnchorElement>('.sec-link')!;
    expect([textOf(preview), preview.getAttribute('href'), preview.getAttribute('aria-label')]).toEqual(['Aperçu', '#/affichage?retour=accueil', 'Aperçu de l’accueil des lunettes']);
    expect(navRows(el)).toEqual([
      ['Favoris', '', '3', '#/favoris'],
      ['Autour de moi', 'à moins de 500 m', '', '#/affichage?retour=accueil'],
      ['Gares de train', 'Namur, Bruxelles-Central', '2 gares', '#/gares'],
      ['Arrêts de bus, tram, métro', 'Gare du Nord', '1 arrêt', '#/arrets'],
      ['Lignes de bus, tram, métro', '3 4 W', '3 lignes', '#/lignes'],
    ]);
    // le mot clé au plus clair, la précision pâle (comme « Gares de train » dans les lunettes)
    const gares = navRow(el, 'Gares de train');
    expect([textOf(gares.querySelector('.kw')), textOf(gares.querySelector('.qual'))]).toEqual(['Gares', 'de train']);
    // espace insécable entre le nombre et son nom, et dans le rayon
    expect(gares.querySelector('.count')!.textContent).toBe('2 gares');
    expect(navRow(el, 'Autour de moi').querySelector('.t2')!.textContent).toBe('à moins de 500 m');
    // pas de bouton « Retirer » ni de grande section sur l'accueil
    expect(el.querySelector('.home-picks, .pick-row')).toBeNull();
    expect(() => button(el, 'Retirer')).toThrow();
  });

  it('les mêmes mots et le même contenu à droite que l’accueil des lunettes (homeView)', () => {
    for (const s of [defaults(), defaults({ stations: [NAMUR, CENTRAL], lines: [GDN], follows: [T3] }), defaults({ stations: [NAMUR], follows: [T3, T4, W] })]) {
      const glasses = homeView({ favorites: [], nearbyCount: 3 }, { now: SCENARIO.s3.now, settings: s })
        .items.filter((i) => i.segs)
        .map((i) => [i.segs!.map((g) => g.t).join(' '), plain(i.bRight)]);
      const el = mount(homeScreen(harness({ settings: s }).ctx));
      expect(navRows(el).slice(2).map(([t, , right]) => [t, right])).toEqual(glasses);
      // et le même ordre que rubrics() (sans DOM)
      expect(rubrics(s).map((r) => `${r.key} ${r.qual}`)).toEqual(glasses.map(([t]) => t));
    }
  });

  it('rubriques vides : « à choisir » à droite, sans sous-titre, et le toucher ouvre l’ajout (#/…/ajouter)', () => {
    const el = mount(homeScreen(harness({ settings: defaults() }).ctx));
    expect(navRows(el).slice(2)).toEqual([
      ['Gares de train', '', 'à choisir', '#/gares/ajouter'],
      ['Arrêts de bus, tram, métro', '', 'à choisir', '#/arrets/ajouter'],
      ['Lignes de bus, tram, métro', '', 'à choisir', '#/lignes/ajouter'],
    ]);
    // une seule rubrique vide : seulement elle ouvre l'ajout
    const some = mount(homeScreen(harness({ settings: defaults({ stations: [NAMUR], follows: [T3] }) }).ctx));
    expect(navRows(some).slice(2).map(([t, , right, href]) => [t, right, href])).toEqual([
      ['Gares de train', '1 gare', '#/gares'],
      ['Arrêts de bus, tram, métro', 'à choisir', '#/arrets/ajouter'],
      ['Lignes de bus, tram, métro', '1 ligne', '#/lignes'],
    ]);
  });

  it('« Lignes » : les pastilles aux couleurs officielles, dans l’ordre des lunettes ; leurs noms dans celui du lien', async () => {
    const hz = harness({ settings: defaults({ follows: [T4, T3, W] }) });
    const el = mount(homeScreen(hz.ctx));
    const lignes = navRow(el, 'Lignes de bus, tram, métro');
    const badges = () => [...lignes.querySelectorAll<HTMLElement>('.badge')];
    expect(badges().map((b) => textOf(b))).toEqual(['4', '3', 'W']);
    expect(lignes.querySelector('.badges')!.getAttribute('aria-hidden')).toBe('true');
    expect(plain(lignes.getAttribute('aria-label'))).toBe('Lignes de bus, tram, métro, 3 lignes : Tram 4, Tram 3, Bus W');
    // couleurs posées par le CSSOM (la politique de Quai Web refuse les attributs style écrits en texte)
    await until(() => badges()[1].classList.contains('official') && badges()[1].style.getPropertyValue('--b') === '#B5BA05');
    // le W du TEC : le jaune et le rouge du réseau, tout de suite
    expect([badges()[2].classList.contains('official'), badges()[2].style.getPropertyValue('--b')]).toEqual([true, '#FFD200']);
  });

  it('« Gares » et « Arrêts » : les noms dans la langue choisie ; « Autour de moi » suit le rayon réglé', () => {
    const s = defaults({ lang: 'nl', stations: [NAMUR, CENTRAL], lines: [GDN], display: { ...defaults().display, radiusM: 800 } });
    const el = mount(homeScreen(harness({ settings: s }).ctx));
    expect(textOf(navRow(el, 'Gares de train').querySelector('.t2'))).toBe('Namen, Brussel-Centraal');
    expect(textOf(navRow(el, 'Arrêts de bus, tram, métro').querySelector('.t2'))).toBe('Noordstation');
    expect(textOf(navRow(el, 'Autour de moi').querySelector('.t2'))).toBe('à moins de 800 m');
  });

  it('plus de liste « Réglages », de « Données » ni de pied de page sur l’accueil (ils sont dans Réglages)', () => {
    const el = mount(homeScreen(harness({ settings: preset11() }).ctx));
    expect([...el.querySelectorAll('h2')].map((x) => textOf(x))).toEqual(['Dans tes lunettes']);
    expect(el.querySelector('.foot')).toBeNull();
    expect(textOf(el)).not.toMatch(/Données|Position et langue|Trajets|Belgian Mobility Company/);
  });
});

describe('carte « Favoris » (S8, PRD-1.2.9 § 2.1)', () => {
  it('S1 : « Favoris   3 » vers #/favoris, puis « Vers le bureau   partir à 07:33 » en tête (CA-S8.1)', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    const favs = navRow(el, 'Favoris');
    expect([textOf(favs.querySelector('.count')), favs.getAttribute('href')]).toEqual(['3', '#/favoris']);
    expect(plain(favs.getAttribute('aria-label'))).toBe('Favoris, 3 favoris : ajouter, modifier, changer l’ordre');
    // les favoris dans la même carte, en retrait sous « Favoris »
    expect(favRows(el).every((r) => r.closest('.fav-card') === favs.closest('.fav-card'))).toBe(true);
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    expect(rowText(favRows(el)[0])).toBe('Vers le bureau | partir à 07:33');
    // 1.2.2 : les arrêts favoris du préréglage sont dans les rubriques, plus dans « Favoris »
    expect(favRows(el).map((r) => textOf(r.querySelector('.t1')))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
  });

  it('écran attaché après coup par le routeur : les réponses arrivent quand même', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const screen = homeScreen(hz.ctx);
    await Promise.resolve();
    await Promise.resolve();
    const el = mount(screen);
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    expect(rowText(favRows(el)[0])).toBe('Vers le bureau | partir à 07:33');
  });

  it(`${HOME_FAVORITES} favoris au plus, dans l’ordre des lunettes (orderedFavorites) ; « Favoris » donne le total`, async () => {
    const base = preset11();
    const extra = (id: string, label: string) => ({ ...base.favorites.find((f) => f.kind === 'place' && f.id === 'fav-bureau')!, id, label }) as Settings['favorites'][number];
    const s = { ...base, favorites: [...base.favorites, extra('fav-ecole', 'École'), extra('fav-sport', 'Sport')] };
    const hz = harness({ settings: s, now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    expect(textOf(navRow(el, 'Favoris').querySelector('.count'))).toBe('5');
    const expected = orderedFavorites(hz.core, s, SCENARIO.s1).slice(0, HOME_FAVORITES).map((f) => favoriteTitle(f, s));
    expect(expected).toHaveLength(HOME_FAVORITES);
    expect(favRows(el).map((r) => textOf(r.querySelector('.t1')))).toEqual(expected);
    // « Dans mon ordre » : l'ordre du téléphone (la maison, où l'on est à 07:31, passe en dernier comme dans les
    // lunettes : règle 5), les 3 premiers ; seules leurs réponses sont calculées
    const mine = { ...s, display: { ...s.display, favOrder: 'mine' as const } };
    const hz2 = harness({ settings: mine, now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const answer = vi.spyOn(hz2.core, 'answer');
    const el2 = mount(homeScreen(hz2.ctx));
    const firstThree = orderedFavorites(hz2.core, mine, SCENARIO.s1).slice(0, HOME_FAVORITES);
    expect(favRows(el2).map((r) => textOf(r.querySelector('.t1')))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers l’école']);
    expect(firstThree.map((f) => favoriteTitle(f, mine))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers l’école']);
    await until(() => favRows(el2).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    expect(new Set(answer.mock.calls.map(([f]) => f.id))).toEqual(new Set(firstThree.map((f) => f.id)));
  });

  it('« Lunettes » d’un trajet favori : étapes de la proposition 1, trajet suivi (TripRequest du favori)', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    const row = favRows(el)[0];
    const btn = row.querySelector<HTMLButtonElement>('.btn-glasses')!;
    expect(btn.getAttribute('aria-label')).toBe('Afficher Vers le bureau dans les lunettes');
    btn.click();
    await until(() => textOf(row.querySelector('.msg')) !== '');
    expect(hz.glasses.trips).toHaveLength(1);
    // un lieu : le trajet « Ma position → lieu », même identifiant
    expect(hz.glasses.trips[0]).toMatchObject({ title: 'Vers le bureau', favoriteId: 'fav-bureau', index: 0, from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' } });
    expect(hz.glasses.trips[0].result.journeys.length).toBeGreaterThan(0);
    expect(textOf(row.querySelector('.msg'))).toMatch(/^Affiché dans les lunettes : IC 07:42\.$/);
  });

  it('retour sur l’accueil 39 min plus tard : « Lunettes » recalcule la réponse, jamais un train parti (revue n° 1)', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const first = mount(homeScreen(hz.ctx));
    await until(() => favRows(first).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    expect(rowText(favRows(first)[0])).toBe('Vers le bureau | partir à 07:33');
    document.body.replaceChildren();
    hz.advance(39 * 60_000); // 08:10 : l'IC de 07:42 est parti
    const answer = vi.spyOn(hz.core, 'answer');
    const el = mount(homeScreen(hz.ctx));
    const row = favRows(el)[0];
    expect(textOf(row.querySelector('.t1'))).toBe('Vers le bureau');
    // toucher tout de suite, avant le rafraîchissement de l'accueil
    row.querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => hz.glasses.trips.length === 1);
    const now = hz.ctx.clock.now();
    const j = hz.glasses.trips[0].result.journeys[0];
    const ride = j.legs.find((l) => l.kind === 'ride')!;
    expect(ride.dep).toBeGreaterThan(now);
    expect(catchable(j, now)).toBe(true);
    expect(answer.mock.calls.some(([f]) => f.id === 'fav-bureau')).toBe(true);
  });

  it('réponse récente et encore attrapable : envoyée telle quelle, sans nouveau calcul', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    hz.advance(30_000);
    const answer = vi.spyOn(hz.core, 'answer');
    favRows(el)[0].querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => hz.glasses.trips.length === 1);
    expect(answer).not.toHaveBeenCalled();
  });

  it('reusable : moins de 2 min et 1re proposition attrapable', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    await hz.core.init();
    const fav = preset11().favorites.find((f) => f.id === 'fav-bureau')!;
    const a = await hz.core.answer(fav, SCENARIO.s1, preset11());
    const t = a.updatedAt;
    expect(reusable(undefined, t)).toBe(false);
    expect(reusable(a, t + 60_000)).toBe(true);
    expect(reusable(a, t + ANSWER_MAX_AGE_MS)).toBe(false);
    // attrapable jusqu'au départ à pied (07:33 + 30 s), plus après même dans les 2 min
    const late = { ...a, updatedAt: at(7, 40) };
    expect(reusable(late, at(7, 41))).toBe(false);
    expect(reusable({ ...a, plan: { journeys: [], empty: 'noPosition' } }, t + 1000)).toBe(true);
  });

  it('sans favori : « Favoris   Aucun favori » et le lien « Ajouter un favori » (#/favoris/nouveau)', () => {
    const el = mount(homeScreen(harness({ settings: defaults() }).ctx));
    const favs = navRow(el, 'Favoris');
    expect([textOf(favs.querySelector('.count')), favs.getAttribute('href'), favs.getAttribute('aria-label')]).toEqual(['Aucun favori', '#/favoris', 'Favoris, aucun favori']);
    expect(favRows(el)).toHaveLength(0);
    const add = el.querySelector<HTMLAnchorElement>('.fav-card .add-link')!;
    expect([textOf(add), add.getAttribute('href')]).toEqual(['Ajouter un favori', '#/favoris/nouveau']);
  });
});

describe('réponses courtes (S8, mêmes règles que les lunettes)', () => {
  const s: Settings = preset11();
  const now = at(7, 31);
  it('états : « … », « tu y es », « sans position », « aucun trajet », arrêt introuvable', () => {
    const base = { favoriteId: 'f', updatedAt: now };
    expect(shortAnswer(undefined, now, s)).toBe('…');
    expect(shortAnswer({ ...base, kind: 'trip', state: 'here' } as FavoriteAnswer, now, s)).toBe('tu y es');
    expect(shortAnswer({ ...base, kind: 'trip', state: 'noPosition' } as FavoriteAnswer, now, s)).toBe('sans position');
    expect(shortAnswer({ ...base, kind: 'trip', state: 'none' } as FavoriteAnswer, now, s)).toBe('aucun trajet');
    expect(shortAnswer({ ...base, kind: 'stop', state: 'missing' } as FavoriteAnswer, now, s).replace(/ /g, ' ')).toBe('Arrêt introuvable : choisis-le à nouveau');
  });
});

describe('bannière « Nouveau » après la mise à jour (T1, PRD-1.2.9 § 2.1)', () => {
  it(`« Nouveau dans Quai ${NEWS_SINCE} » sur une ligne ; « Voir ce qui change » déplie les nouveautés dans la bannière`, () => {
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.8', NEWS_SINCE, '1.2.9');
    const el = mount(homeScreen(hz.ctx));
    const news = el.querySelector<HTMLElement>('.news')!;
    // après « Où vas-tu ? », avant « Dans tes lunettes »
    const order = [...el.querySelectorAll('.where, .news, .mirror-sec')].map((x) => x.className.split(' ')[0]);
    expect(order).toEqual(['where', 'news', 'mirror-sec']);
    expect(textOf(news.querySelector('.news-title'))).toBe(`Nouveau dans Quai ${NEWS_SINCE}`);
    expect(news.getAttribute('aria-labelledby')).toBe(news.querySelector('.news-title')!.id);
    const more = news.querySelector<HTMLButtonElement>('.news-more')!;
    expect(textOf(more.querySelector('.news-see'))).toBe('Voir ce qui change');
    const lines = news.querySelector<HTMLElement>('.news-lines')!;
    expect(more.getAttribute('aria-controls')).toBe(lines.id);
    expect([more.getAttribute('aria-expanded'), lines.hidden]).toEqual(['false', true]);
    more.click();
    expect([more.getAttribute('aria-expanded'), lines.hidden]).toEqual(['true', false]);
    expect([...lines.querySelectorAll('p')].map((p) => textOf(p))).toEqual([...NEWS_129]);
    // typographie française : espace insécable devant « : » et « ; », dans les guillemets
    expect(lines.querySelectorAll('p')[0]!.textContent).toMatch(/«[\u00a0\u202f]imminent[\u00a0\u202f]».*réel[\u00a0\u202f];/);
    for (const l of NEWS_129) expect(l).not.toMatch(/[\u2013\u2014]|tes lieux|vous\b/);
    more.click();
    expect([more.getAttribute('aria-expanded'), lines.hidden]).toEqual(['false', true]);
  });

  it('« OK » la ferme une fois pour toutes, le curseur passe à « Dans tes lunettes » ; le téléphone n’écrit pas la version vue', () => {
    expect(NEWS_SINCE).toBe('1.2.9');
    // l'appli en 1.2.9 : la bannière se montre une fois
    for (const seen of ['1.1.0', '1.2.0', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8']) expect(newsState(seen, NEWS_SINCE, '1.2.9').visible(), seen).toBe(true);
    for (const seen of ['', '1.2.9', '1.3.0']) expect(newsState(seen, NEWS_SINCE, '1.2.9').visible(), seen || 'installation neuve').toBe(false);
    // une appli plus ancienne que ces nouveautés ne les annonce pas
    expect(newsState('1.2.7', NEWS_SINCE, '1.2.8').visible()).toBe(false);
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.8', NEWS_SINCE, '1.2.9');
    const el = mount(homeScreen(hz.ctx));
    button(el, 'OK').click();
    expect(el.querySelector('.news')).toBeNull();
    expect(hz.ctx.news.visible()).toBe(false);
    expect(document.activeElement).toBe(el.querySelector('#h-miroir'));
    expect(textOf(document.activeElement)).toBe('Dans tes lunettes');
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
    // le téléphone n'écrit pas la version vue (les lunettes s'en servent pour « Quai 1.2.9 »)
    expect(hz.settings.get().seenVersion).toBe('');
    // installation neuve : jamais
    const neuf = harness({ settings: defaults() });
    neuf.ctx.news = newsState('', NEWS_SINCE, '1.2.9');
    expect(mount(homeScreen(neuf.ctx)).querySelector('.news')).toBeNull();
  });

  it('mise à jour directe vers la 1.2.9 : les nouveautés des versions sautées, sans celles qui parlent de « Bus, tram, métro » ; une seule bannière, une fois', () => {
    const v126 = [
      'Gares de train, arrêts et lignes de bus, tram, métro : trois rubriques séparées.',
      'Une ligne se suit maintenant en entier, dans les deux sens, sans choisir d’arrêt : les lunettes montrent l’attente à chacun de ses arrêts.',
      'Pour ajouter une ligne ou un arrêt, ceux près de toi sont proposés, chaque ligne à sa couleur.',
      'Tes lignes gardées à un arrêt sont déjà dans Lignes.',
    ];
    const v125 = [
      'Dans les étapes, quand tu pars bientôt : l’heure d’arrivée si tu rates ton départ.',
      'Une correspondance de 5 min ou moins montre sa marge.',
      'La pluie prévue est dite sur les marches de 5 min ou plus (réglage dans Affichage).',
      'Dans le train, le bus, le tram ou le métro : ta progression jusqu’à la descente.',
    ];
    const v124 = ['Dans les étapes, l’arrêt ou la gare où aller est écrit en entier.', 'L’accueil des lunettes dit combien de gares, d’arrêts et de lignes tu suis.', 'Dans les lunettes, des heures alignées et des aides plus discrètes.'];
    const v123 = ['Tableaux complets dans les lunettes : tous les départs des 2 prochaines heures.', 'Touche un départ : ses arrêts jusqu’au terminus, avec l’heure et la voie.'];
    const v122 = [
      'Nouveau : tes gares et tes lignes de bus, tram et métro sur l’accueil des lunettes.',
      'Tes arrêts favoris y sont rangés, rien n’est perdu.',
      'Dans les lunettes, Aller à… a rejoint Favoris.',
      'Un trajet n’est suivi que si tu le demandes.',
    ];
    expect(NEWS_126).toEqual(v126);
    expect(NEWS_125.filter((l) => !l.startsWith('Bus, tram, métro'))).toEqual(v125);
    expect(NEWS_124.filter((l) => !l.startsWith('Bus, tram, métro'))).toEqual(v124);
    expect(NEWS_123.filter((l) => !l.startsWith('Bus, tram, métro'))).toEqual(v123);
    expect(NEWS_122).toEqual(v122);
    expect(newsState('1.2.8', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129]);
    expect(newsState('1.2.7', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129, ...NEWS_128]);
    expect(newsState('1.2.6', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129, ...NEWS_128]);
    expect(newsState('1.2.5', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129, ...NEWS_128, ...v126]);
    expect(newsState('1.2.4', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129, ...NEWS_128, ...v126, ...v125]);
    expect(newsState('1.2.3', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129, ...NEWS_128, ...v126, ...v125, ...v124]);
    expect(newsState('1.2.2', NEWS_SINCE, '1.2.9').lines).toEqual([...NEWS_129, ...NEWS_128, ...v126, ...v125, ...v124, ...v123]);
    for (const seen of ['1.2.1', '1.2.0', '1.1.0']) expect(newsState(seen, NEWS_SINCE, '1.2.9').lines, seen).toEqual([...NEWS_129, ...NEWS_128, ...v126, ...v125, ...v124, ...v123, ...v122]);
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.5', NEWS_SINCE, '1.2.9');
    const el = mount(homeScreen(hz.ctx));
    expect(el.querySelectorAll('.news')).toHaveLength(1);
    expect([...el.querySelectorAll('.news p')].map((p) => textOf(p))).toEqual([...NEWS_129, ...NEWS_128, ...v126]);
    button(el, 'OK').click();
    expect(el.querySelector('.news')).toBeNull();
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
  });
});
