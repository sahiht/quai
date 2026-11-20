// @vitest-environment happy-dom
/**
 * Quai 1.3.1, « 7h12 partout », côté téléphone : l'accueil (réponse d'un favori) et les cartes de « Rechercher un
 * trajet » disent l'heure de partir du vrai chemin, la même que les lunettes (test/glasses/v131-vrai-chemin.test.ts).
 * Vrais écrans du téléphone sur le vrai cœur (test/core/vrai-chemin-scene.ts : arrêt Esplanade, tram 3 de 07:20, la
 * Bourse). La carte « En cours » lit l'état du guidage des lunettes : prouvée avec le vrai contrôleur dans le test des
 * lunettes (guideStatus, guideNowLine : « Ensuite : partir à 07:12 »).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { searchScreen } from '../../src/phone/screens/search';
import { BOURSE, scene, START, type PathKind } from '../core/vrai-chemin-scene';
import { at, defaults, harness, mount, settle, sleep, textOf, until } from './helpers';

beforeEach(() => resetAnswers());
afterEach(() => document.body.replaceChildren());

function phone(path: PathKind | null, hh: number, mm: number, o: { hold?: boolean; params?: string } = {}) {
  const sc = scene(path);
  if (o.hold) sc.hold();
  const now = at(hh, mm);
  const real = sc.core(() => now);
  const hz = harness({ settings: defaults({ favorites: [BOURSE] }), now, here: START, core: () => real, params: o.params });
  return { sc, hz };
}

const answer = (el: HTMLElement): string => textOf(el.querySelector('.fav-row .answer'));
const cards = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('.result')];
const times = (el: ParentNode) => cards(el).map((c) => textOf(c.querySelector('.time')));
const tags = (el: ParentNode) => cards(el).map((c) => textOf(c.querySelector('.tag')));

describe('accueil du téléphone : la réponse du favori', () => {
  it('07:10 : « partir à 07:12 » (vrai chemin de 446 m, 6 min) ; sans tuiles piétonnes : « partir à 07:15 », comme en 1.3.0', async () => {
    const a = phone('long', 7, 10);
    const el = mount(homeScreen(a.hz.ctx));
    await until(() => answer(el) !== '…');
    expect(answer(el)).toBe('partir à 07:12');
    document.body.replaceChildren();
    resetAnswers();
    const b = phone(null, 7, 10);
    const el2 = mount(homeScreen(b.hz.ctx));
    await until(() => answer(el2) !== '…');
    expect(answer(el2)).toBe('partir à 07:15');
  });

  it('tuile lente : l’estimation tout de suite, puis « partir à 07:12 » dès que le chemin est connu (sans attendre les 30 s), une seule fois', async () => {
    const { sc, hz } = phone('long', 7, 10, { hold: true });
    const el = mount(homeScreen(hz.ctx));
    await until(() => answer(el) !== '…');
    expect(answer(el)).toBe('partir à 07:15');
    const seen: string[] = [];
    const obs = new MutationObserver(() => seen.push(answer(el)));
    obs.observe(el, { subtree: true, childList: true, characterData: true });
    sc.release();
    await until(() => answer(el) === 'partir à 07:12');
    await sleep(150);
    obs.disconnect();
    expect([...new Set(seen)]).toEqual(['partir à 07:12']);
    // l'accueil rouvert : la réponse gardée est déjà la bonne (jamais 07:15 un instant)
    const again = mount(homeScreen(hz.ctx));
    expect(answer(again)).toBe('partir à 07:12');
  });
});

describe('accueil du téléphone : chemin connu pendant qu’on regarde un autre écran', () => {
  it('l’accueil rouvert montre « partir à 07:12 » dès sa première peinture (la réponse gardée a suivi, sans réseau)', async () => {
    const { sc, hz } = phone('long', 7, 10, { hold: true });
    const el = mount(homeScreen(hz.ctx));
    await until(() => answer(el) !== '…');
    expect(answer(el)).toBe('partir à 07:15');
    // un autre écran ; la tuile arrive pendant ce temps
    document.body.replaceChildren();
    const calls = sc.server.calls.length;
    sc.release();
    await sleep(200);
    expect(sc.server.calls.length).toBe(calls);
    const again = mount(homeScreen(hz.ctx));
    expect(answer(again)).toBe('partir à 07:12');
  });
});

describe('« Rechercher un trajet » : les cartes', () => {
  it('07:10, de ma position à la Bourse : « 07:12 → 07:37 » sur la première carte ; mêmes cartes, même ordre qu’avec l’estimation', async () => {
    const a = phone('long', 7, 10, { params: 'de=ici&vers=bourse' });
    const el = mount(searchScreen(a.hz.ctx));
    await until(() => cards(el).length > 0);
    await settle();
    const b = phone(null, 7, 10, { params: 'de=ici&vers=bourse' });
    const el2 = mount(searchScreen(b.hz.ctx));
    await until(() => cards(el2).length > 0);
    await settle();
    expect(times(el2)[0]).toBe('07:15 → 07:37');
    expect(tags(el2)).toEqual(tags(el));
    document.body.replaceChildren(el);
    expect(times(el)[0]).toBe('07:12 → 07:37');
    expect(times(el).length).toBe(times(el2).length);
  });

  it('tuile lente : les cartes sortent avec l’estimation, puis prennent l’heure du vrai chemin une fois, dans le même ordre, sans nouvelle recherche', async () => {
    const { sc, hz } = phone('long', 7, 10, { hold: true, params: 'de=ici&vers=bourse' });
    const el = mount(searchScreen(hz.ctx));
    await until(() => cards(el).length > 0);
    await settle();
    expect(times(el)[0]).toBe('07:15 → 07:37');
    const order = tags(el);
    const routes = sc.server.calls.length;
    sc.release();
    await until(() => times(el)[0] === '07:12 → 07:37');
    expect(tags(el)).toEqual(order);
    await sleep(100);
    // aucune demande de plus au réseau pour mettre les cartes à jour (la tuile retenue était déjà demandée)
    expect(sc.server.calls.length).toBe(routes);
  });
});
