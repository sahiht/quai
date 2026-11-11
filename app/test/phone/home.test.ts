// @vitest-environment happy-dom
/**
 * Accueil du téléphone (T1, S8, M8) : « Où vas-tu ? » ouvre la recherche, section « Mes favoris » au-dessus de
 * « Réglages » (réponse courte, bouton « Lunettes », « Gérer mes favoris »), bannière après la mise à jour,
 * « Temps réel indisponible, horaires prévus » au lieu de « Tout est à jour ».
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FavoriteAnswer, Settings } from '../../src/core/api';
import { newsState } from '../../src/phone/app';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { shortAnswer } from '../../src/phone/text';
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
    expect(textOf(where.querySelector('.where-box'))).toBe('Adresse, gare, arrêt ou lieu');
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
    expect(favRows(el)).toHaveLength(6);
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
    expect(hz.glasses.trips[0]).toMatchObject({ title: 'Vers le bureau', favoriteId: 'fav-bureau', index: 0, from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' } });
    expect(hz.glasses.trips[0].result.journeys.length).toBeGreaterThan(0);
    expect(textOf(row.querySelector('.msg'))).toMatch(/^Affiché dans les lunettes : IC 07:42\.$/);
  });

  it('« Lunettes » d’un arrêt favori : ses départs (showBoard avec le filtre)', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s2.now, here: SCENARIO.s2 });
    const el = mount(homeScreen(hz.ctx));
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    const gdn = favRows(el).find((r) => textOf(r.querySelector('.t1')).startsWith('Gare du Nord'))!;
    expect(textOf(gdn.querySelector('.answer'))).toMatch(/^T3 (\d+ min|imminent)/);
    gdn.querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => hz.glasses.boards.length === 1);
    expect(hz.glasses.boards[0].areaId).toBe('stib:6357F');
    expect(hz.glasses.boards[0].filter?.length).toBe(3);
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
  it('une fois après une mise à jour depuis la 1.0, jusqu’à « OK » ; jamais après une nouvelle installation', () => {
    expect(newsState('1.0.0', '1.1.0').visible()).toBe(true);
    expect(newsState('', '1.1.0').visible()).toBe(false);
    expect(newsState('1.1.0', '1.1.0').visible()).toBe(false);
    const hz = harness({ settings: defaults() });
    hz.ctx.news = newsState('1.0.0', '1.1.0');
    const el = mount(homeScreen(hz.ctx));
    expect(textOf(el.querySelector('.news p'))).toBe('Nouveau : tape une adresse, Quai trouve le trajet le plus simple.');
    button(el, 'OK').click();
    expect(el.querySelector('.news')).toBeNull();
    expect(hz.ctx.news.visible()).toBe(false);
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
    // le téléphone n'écrit pas la version vue (les lunettes s'en servent pour « Quai 1.1 »)
    expect(hz.settings.get().seenVersion).toBe('');
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
