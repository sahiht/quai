// @vitest-environment happy-dom
/**
 * Accueil du téléphone (T1, S8, M8 ; PRD-1.2 § 2.2) : « Où vas-tu ? » ouvre la recherche, section « Mes favoris »
 * (endroits et trajets) au-dessus de « Réglages » (réponse courte, bouton « Lunettes », « Gérer mes favoris »),
 * « Réglages » sans « Mes lieux », avec « Trajets » (revue d'usage n° 9), bannière « Quai 1.2.3 » après la mise à
 * jour, « Temps réel indisponible, horaires prévus » au lieu de « Tout est à jour ». Gares et lignes : picks.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteAnswer, Settings } from '../../src/core/api';
import { NEWS_SINCE, newsState } from '../../src/phone/app';
import { ANSWER_MAX_AGE_MS, homeScreen, resetAnswers, reusable } from '../../src/phone/screens/home';
import { catchable } from '../../src/glasses/format';
import { NEWS_122, NEWS_123, NEWS_124, NEWS_125, NEWS_126, NEWS_128, shortAnswer } from '../../src/phone/text';
import { at, button, defaults, harness, mount, preset11, SCENARIO, textOf, until } from './helpers';

beforeEach(() => resetAnswers());
afterEach(() => document.body.replaceChildren());

const favRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.fav-row')];
const rowText = (r: HTMLElement) => `${textOf(r.querySelector('.t1'))} | ${textOf(r.querySelector('.answer'))}`;

describe('« Où vas-tu ? » (M4.1, T1)', () => {
  it('remplace « Rechercher un trajet » et ouvre la recherche', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(homeScreen(hz.ctx));
    expect(el.textContent).not.toContain('Rechercher un trajet');
    const where = el.querySelector<HTMLButtonElement>('.where')!;
    expect(textOf(where.querySelector('.where-label'))).toBe('Où vas-tu ?');
    expect(textOf(where.querySelector('.where-box'))).toBe('Adresse, gare, arrêt ou favori');
    where.click();
    expect(hz.went).toEqual(['#/recherche']);
  });
});

describe('« Mes favoris » sur l’accueil (S8)', () => {
  it('S1 : « Vers le bureau   partir à 07:33 » en tête, avant « Réglages » (CA-S8.1)', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    const section = el.querySelector('.home-favs')!;
    expect(textOf(section.querySelector('h2'))).toBe('Mes favoris');
    const h2s = [...el.querySelectorAll('h2')].map((x) => textOf(x));
    expect(h2s.indexOf('Mes favoris')).toBeLessThan(h2s.indexOf('Réglages'));
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    expect(rowText(favRows(el)[0])).toBe('Vers le bureau | partir à 07:33');
    // 1.2.2 : les arrêts favoris du préréglage sont dans « Gares » et « Bus, tram, métro », plus dans « Mes favoris »
    expect(favRows(el)).toHaveLength(3);
    expect(textOf(section.querySelector('.more-link'))).toBe('Gérer mes favoris');
    expect(section.querySelector('.more-link')!.getAttribute('href')).toBe('#/favoris');
  });

  it('écran attaché après coup par le routeur : les réponses arrivent quand même', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const screen = homeScreen(hz.ctx);
    await Promise.resolve();
    await Promise.resolve();
    const el = mount(screen);
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    expect(rowText(favRows(el)[0])).toBe('Vers le bureau | partir à 07:33');
    // l'état du temps réel est connu après les premières réponses
    const data = [...el.querySelectorAll('.row')].find((r) => textOf(r.querySelector('.t1')) === 'Données')!;
    expect(textOf(data.querySelector('.t2'))).toBe('Temps réel indisponible, horaires prévus');
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

  it('lieux compris (préréglage 1.1 migré) ; « Réglages » : plus de « Mes lieux », « Trajets », « Mes favoris   3 favoris »', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    expect(favRows(el).map((r) => textOf(r.querySelector('.t1')))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
    const settingsRows = [...el.querySelectorAll('.list.box:not(.fav-list):not(.pick-list) .row')].map((r) => textOf(r.querySelector('.t1')));
    expect(settingsRows).toEqual(['Position et langue', 'Trajets', 'Mes favoris', 'Affichage', 'Alertes', 'Données']);
    // 1.2.3 : plus de « départs par arrêt » sous « Affichage » (PRD-1.2.3 § 1)
    const display = [...el.querySelectorAll('.row')].find((r) => textOf(r.querySelector('.t1')) === 'Affichage')!;
    expect(display.querySelector('.t2')!.textContent).toBe('Rayon 500\u00a0m');
    const favs = [...el.querySelectorAll('.row')].find((r) => textOf(r.querySelector('.t1')) === 'Mes favoris')!;
    expect(textOf(favs.querySelector('.t2'))).toBe('3 favoris');
    (favs as HTMLButtonElement).click();
    expect(hz.went).toEqual(['#/favoris']);
    const one = mount(homeScreen(harness({ settings: defaults({ favorites: [preset11().favorites[0]] }) }).ctx));
    expect(textOf([...one.querySelectorAll('.row')].find((r) => textOf(r.querySelector('.t1')) === 'Mes favoris')!.querySelector('.t2'))).toBe('1 favori');
  });

  it('sans favori : « Aucun favori pour l’instant. »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(homeScreen(hz.ctx));
    expect(textOf(el.querySelector('.home-favs .empty-row'))).toBe('Aucun favori pour l’instant.');
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
    expect(shortAnswer({ ...base, kind: 'stop', state: 'missing' } as FavoriteAnswer, now, s).replace(/ /g, ' ')).toBe('Arrêt introuvable : choisis-le à nouveau');
  });
});

describe('bannière après la mise à jour (T1) et état des données (M8)', () => {
  it('« Quai 1.2.8 » (PRD-1.2.8 § 4) : une fois depuis une version antérieure, jusqu’à « OK » ; jamais après une nouvelle installation', () => {
    expect(NEWS_SINCE).toBe('1.2.8');
    // l'appli en 1.2.8 (la version est montée à l'intégration) : la bannière se montre une fois
    for (const seen of ['1.1.0', '1.2.0', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7']) expect(newsState(seen, NEWS_SINCE, '1.2.8').visible(), seen).toBe(true);
    for (const seen of ['', '1.2.8', '1.3.0']) expect(newsState(seen, NEWS_SINCE, '1.2.8').visible(), seen || 'installation neuve').toBe(false);
    // une appli plus ancienne que ces nouveautés ne les annonce pas
    expect(newsState('1.2.6', NEWS_SINCE, '1.2.7').visible()).toBe(false);
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.7', NEWS_SINCE, '1.2.8');
    const el = mount(homeScreen(hz.ctx));
    const lines = [
      'Dans les lunettes, touche un train au tableau d’une gare : tout son trajet, des gares d’avant jusqu’au terminus.',
      'À chaque gare, sa voie et le prochain passage en clair (« dans 6 min ») ; ● montre où arrive le train, d’après le temps réel.',
    ];
    expect([...el.querySelectorAll('.news p')].map((p) => textOf(p))).toEqual(lines);
    expect(NEWS_128).toEqual(lines);
    // typographie française : espace insécable devant « : » et « ; », dans les guillemets
    expect(el.querySelectorAll('.news p')[0]!.textContent).toMatch(/gare[\u00a0\u202f]:/);
    for (const l of lines) expect(l).not.toMatch(/[—–]|tes lieux|vous\b/);
    button(el, 'OK').click();
    expect(el.querySelector('.news')).toBeNull();
    expect(hz.ctx.news.visible()).toBe(false);
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
    // le téléphone n'écrit pas la version vue (les lunettes s'en servent pour « Quai 1.2.8 »)
    expect(hz.settings.get().seenVersion).toBe('');
  });

  it('mise à jour directe vers la 1.2.8 : les nouveautés des versions sautées, sans celles qui parlent de « Bus, tram, métro » ; une seule bannière, une fois', () => {
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
    expect(newsState('1.2.7', NEWS_SINCE, '1.2.8').lines).toEqual([...NEWS_128]);
    expect(newsState('1.2.6', NEWS_SINCE, '1.2.8').lines).toEqual([...NEWS_128]);
    expect(newsState('1.2.5', NEWS_SINCE, '1.2.8').lines).toEqual([...NEWS_128, ...v126]);
    expect(newsState('1.2.4', NEWS_SINCE, '1.2.8').lines).toEqual([...NEWS_128, ...v126, ...v125]);
    expect(newsState('1.2.3', NEWS_SINCE, '1.2.8').lines).toEqual([...NEWS_128, ...v126, ...v125, ...v124]);
    expect(newsState('1.2.2', NEWS_SINCE, '1.2.8').lines).toEqual([...NEWS_128, ...v126, ...v125, ...v124, ...v123]);
    for (const seen of ['1.2.1', '1.2.0', '1.1.0']) expect(newsState(seen, NEWS_SINCE, '1.2.8').lines, seen).toEqual([...NEWS_128, ...v126, ...v125, ...v124, ...v123, ...v122]);
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.2.5', NEWS_SINCE, '1.2.8');
    const el = mount(homeScreen(hz.ctx));
    expect(el.querySelectorAll('.news')).toHaveLength(1);
    expect([...el.querySelectorAll('.news p')].map((p) => textOf(p))).toEqual([...NEWS_128, ...v126]);
    button(el, 'OK').click();
    expect(el.querySelector('.news')).toBeNull();
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
    // installation neuve : rien
    expect(newsState('', NEWS_SINCE, '1.2.8').visible()).toBe(false);
  });

  it('« Données » : « Temps réel indisponible, horaires prévus » pendant une panne, sinon « Tout est à jour »', async () => {
    const down = harness({ settings: defaults(), now: SCENARIO.s2.now, here: SCENARIO.s2, flags: { noRt: true } });
    await down.core.init();
    await down.core.board('sncb:8812005');
    const row = (el: HTMLElement) => [...el.querySelectorAll('.row')].find((r) => textOf(r.querySelector('.t1')) === 'Données')!;
    expect(textOf(row(mount(homeScreen(down.ctx))).querySelector('.t2'))).toBe('Temps réel indisponible, horaires prévus');
    const ok = harness({ settings: defaults(), now: SCENARIO.s2.now, here: SCENARIO.s2 });
    await ok.core.init();
    await ok.core.board('sncb:8812005');
    expect(textOf(row(mount(homeScreen(ok.ctx))).querySelector('.t2'))).toBe('Tout est à jour');
  });
});
