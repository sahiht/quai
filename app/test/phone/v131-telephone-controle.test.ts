// @vitest-environment happy-dom
/**
 * Quai 1.3.1, contrôle indépendant du sujet « téléphone et Quai Web » (docs/v1.3.1/PRD-1.3.1.md § 7 et § 14, R6) :
 *  - balayage de tous les écrans du téléphone, dans l'appli Even et dans Quai Web, avec des réglages et un cœur dont
 *    chaque nom porte une apostrophe droite : aucune « ' » dans un texte affiché ni dans un nom lu ; les réglages sont
 *    identiques après ;
 *  - un lieu gardé en favori (son nom vient souvent d'une gare) s'affiche comme sur l'accueil et dans les lunettes ;
 *  - la recherche tapée avec « ' », « ’ » ou sans apostrophe retrouve toujours le nom ;
 *  - « Copier mon heure d’arrivée » ne garde rien et n'ouvre aucune connexion.
 * Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Core, Settings } from '../../src/core/api';
import type { GuideStatus } from '../../src/core/guide-types';
import { rankSearch } from '../../src/core/search';
import { placeField } from '../../src/phone/field';
import { alertsScreen } from '../../src/phone/screens/alerts';
import { dataScreen } from '../../src/phone/screens/data';
import { displayScreen, openingScreen } from '../../src/phone/screens/display';
import { favoriteEditScreen, fixedTripScreen, newFavoriteScreen } from '../../src/phone/screens/favorite-edit';
import { favoriteRowTitle, favoritesScreen } from '../../src/phone/screens/favorites';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { onboardingScreen, yourFavoritesScreen } from '../../src/phone/screens/onboarding';
import { picksScreen, resetKnownLines } from '../../src/phone/screens/picks';
import { searchScreen, shownLabel } from '../../src/phone/screens/search';
import { settingsScreen } from '../../src/phone/screens/settings';
import { tripsScreen } from '../../src/phone/screens/trips';
import { endpointText } from '../../src/phone/text';
import { at, defaults, harness, mount, options, plain, SCENARIO, settle, sleep, textOf, type, until, withGuide, type Harness } from './helpers';

beforeEach(() => {
  resetAnswers();
  resetKnownLines();
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

const N = (fr: string, nl = fr) => ({ fr, nl });

/** Ajoute une apostrophe droite à chaque nom (objets { fr, nl }) d'une réponse du cœur. */
function marked<T>(x: T, seen = new Set<unknown>()): T {
  if (!x || typeof x !== 'object' || seen.has(x)) return x;
  seen.add(x);
  const o = x as Record<string, unknown>;
  if (typeof o.fr === 'string' && typeof o.nl === 'string') {
    const straighten = (n: string): string => (/['’]/.test(n) ? n : `${n} l'Est`).replace(/’/g, "'");
    o.fr = straighten(o.fr);
    o.nl = straighten(o.nl);
    return x;
  }
  for (const v of Array.isArray(x) ? x : Object.values(o)) marked(v, seen);
  return x;
}
const copyOf = <T>(y: T): T => {
  try {
    return structuredClone(y);
  } catch {
    return y;
  }
};
/** Le faux cœur, dont toutes les réponses portent des noms à apostrophe droite (comme les données de la SNCB et du TEC). */
const straightCore = (c: Core): Core =>
  new Proxy(c, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r) as unknown;
      if (typeof v !== 'function' || k === 'init' || k === 'onGeneration') return v;
      return (...a: unknown[]) => {
        const out = (v as (...a: unknown[]) => unknown).apply(t, a);
        return out instanceof Promise ? out.then((y) => marked(copyOf(y))) : marked(copyOf(out));
      };
    },
  });

const NAMUR = { areaId: 'sncb:8863008', name: N("Namur-l'Est"), lat: 50.4685, lon: 4.8625 };
const CENTRAL = { areaId: 'sncb:8813003', name: N("Bruxelles-Central l'Est"), lat: 50.8454, lon: 4.3571 };
/** Réglages où tout ce qui porte un nom a une apostrophe droite : gares, arrêts, lignes, lieux gardés, trajet fixe. */
const straightSettings = (): Settings =>
  defaults({
    stations: [{ id: 'g1', ...NAMUR }],
    lines: [
      { id: 's1', areaId: 'stib:8032', op: 'stib', name: N("Porte d'Anderlecht"), lat: 50.8436, lon: 4.3417 },
    ],
    follows: [{ id: 'f1', op: 'tec', mode: 'bus', line: 'W', routes: ['tec:W-MIDI'], ends: [N("Braine-l'Alleud Gare"), N("Bruxelles-l'Midi")], via: { areaId: 'tec:Bbrlmer1', name: N("Braine-l'Alleud Merbraine"), lat: 50.6833, lon: 4.3891 } }],
    favorites: [
      { kind: 'place', id: 'lieu-gare', label: "Gare de Braine-l'Alleud", lat: 50.6838, lon: 4.3715, src: 'stop', address: "Près de Braine-l'Alleud", areaId: 'tec:Bbrlgar1', propose: 'never' },
      { kind: 'trip', id: 'fav-trajet', from: { type: 'area', op: 'sncb', ...NAMUR }, to: { type: 'area', op: 'sncb', ...CENTRAL }, propose: 'never' },
      { kind: 'trip', id: 'fav-lieu', from: { type: 'area', op: 'sncb', ...NAMUR }, to: { type: 'place', placeId: 'lieu-gare' }, propose: 'never' },
      { kind: 'place', id: 'lieu-place', label: "Place de l'Yser", lat: 50.8606, lon: 4.3503, src: 'address', address: 'Boulevard Baudouin 1, 1000 Bruxelles', propose: 'never' },
    ],
  });

/** Ce qui se voit ou se lit avec une apostrophe droite : textes, noms lus, aides, valeurs des champs. */
function straight(): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentElement;
    if ((n.textContent ?? '').includes("'") && p && !['SCRIPT', 'STYLE'].includes(p.tagName)) out.push(`texte <${p.tagName.toLowerCase()} class="${p.className}"> ${(n.textContent ?? '').trim()}`);
  }
  for (const el of document.body.querySelectorAll('*')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) if (el.getAttribute(a)?.includes("'")) out.push(`${a} <${el.tagName.toLowerCase()} class="${el.className}"> ${el.getAttribute(a)}`);
    // le nom d'un lieu en cours de modification est la valeur enregistrée elle-même : elle ne change jamais
    if (el instanceof HTMLInputElement && el.id !== 'pl-nom' && el.value.includes("'")) out.push(`valeur <input id="${el.id}"> ${el.value}`);
  }
  return [...new Set(out)];
}

const GUIDE: GuideStatus = { kind: 'trip', title: "Braine-l'Alleud", arr: at(8, 54), now: "IC vers Braine-l'Alleud", guided: true };

describe('§ 7 : aucun écran du téléphone ni de Quai Web (onglet Réglages) ne montre une apostrophe droite', () => {
  const screens: [name: string, make: (hz: Harness) => HTMLElement, params?: string, shows?: RegExp][] = [
    ['accueil', (hz) => homeScreen(hz.ctx), undefined, /Gare de Braine-l’Alleud[\s\S]*Namur-l’Est[\s\S]*Porte d’Anderlecht/],
    ['« Mes favoris »', (hz) => favoritesScreen(hz.ctx), undefined, /Gare de Braine-l’Alleud[\s\S]*Namur-l’Est → Bruxelles-Central l’Est[\s\S]*Namur-l’Est → Gare de Braine-l’Alleud[\s\S]*Place de l’Yser/],
    ['un lieu (gare gardée)', (hz) => favoriteEditScreen(hz.ctx, 'lieu-gare'), undefined, /Gare de Braine-l’Alleud[\s\S]*Près de Braine-l’Alleud/],
    ['un lieu (adresse)', (hz) => favoriteEditScreen(hz.ctx, 'lieu-place'), undefined, /Place de l’Yser/],
    ['un trajet fixe', (hz) => favoriteEditScreen(hz.ctx, 'fav-trajet')],
    ['un trajet fixe vers un lieu', (hz) => favoriteEditScreen(hz.ctx, 'fav-lieu')],
    ['« Nouveau favori »', (hz) => newFavoriteScreen(hz.ctx)],
    ['« Un trajet de A à B »', (hz) => fixedTripScreen(hz.ctx)],
    ['« Gares »', (hz) => picksScreen(hz.ctx, 'stations'), undefined, /Namur-l’Est/],
    ['« Gares », ajout', (hz) => picksScreen(hz.ctx, 'stations', { add: true })],
    ['« Arrêts »', (hz) => picksScreen(hz.ctx, 'lines'), undefined, /Porte d’Anderlecht/],
    ['« Arrêts », ajout', (hz) => picksScreen(hz.ctx, 'lines', { add: true })],
    ['« Lignes »', (hz) => picksScreen(hz.ctx, 'follows'), undefined, /Braine-l’Alleud Gare ↔ Bruxelles-l’Midi/],
    ['« Lignes », ajout', (hz) => picksScreen(hz.ctx, 'follows', { add: true })],
    ['recherche entre deux gares', (hz) => searchScreen(hz.ctx), 'de=sncb:8863008&vers=sncb:8813003', /Namur l’Est → Bruxelles-Central l’Est/],
    ['recherche vers un lieu gardé', (hz) => searchScreen(hz.ctx), 'vers=lieu-gare', /→ Gare de Braine-l’Alleud/],
    ['« Affichage »', (hz) => displayScreen(hz.ctx)],
    ['« À l’ouverture de Quai »', (hz) => openingScreen(hz.ctx)],
    ['« Réglages »', (hz) => settingsScreen(hz.ctx)],
    ['« Alertes »', (hz) => alertsScreen(hz.ctx)],
    ['« Données »', (hz) => dataScreen(hz.ctx)],
    ['« Trajets »', (hz) => tripsScreen(hz.ctx)],
    ['« Bienvenue »', (hz) => onboardingScreen(hz.ctx)],
    ['« Tes favoris » de l’accueil du premier jour', (hz) => yourFavoritesScreen(hz.ctx)],
  ];
  for (const web of [false, true])
    for (const [name, make, params, shows] of screens)
      it(`${name}${web ? ', Quai Web' : ''}`, async () => {
        const hz = harness({ settings: straightSettings(), core: straightCore, web, params, here: SCENARIO.s1, now: SCENARIO.s1.now });
        const before = structuredClone(hz.settings.get());
        withGuide(hz.glasses, GUIDE);
        const el = mount(make(hz));
        await settle(10);
        await sleep(120);
        await settle(10);
        // ce qui s'ouvre sans rien changer : détails, éléments d'une liste, « Voir les autres favoris »
        for (const d of el.querySelectorAll('details')) d.open = true;
        for (const b of el.querySelectorAll<HTMLButtonElement>('.pick-head, .more-favs, [aria-expanded="false"]')) b.click();
        await settle(10);
        expect(straight(), 'à l’ouverture').toEqual([]);
        if (shows) expect(textOf(el), 'les noms sont bien à l’écran, avec « ’ »').toMatch(shows);
        // une saisie dans chaque champ libre : les propositions (gares, arrêts, lieux gardés)
        let proposed = 0;
        for (const i of el.querySelectorAll<HTMLInputElement>('input[type="search"], input[type="text"], input:not([type])')) {
          if (i.value || i.id === 'pl-nom' || i.id === 'fav-nom') continue;
          // « Lignes » se cherche par numéro (bus W) ; « Gares » par nom de gare ; ailleurs un arrêt « … Gare »
          type(i, /Lignes/.test(name) ? 'w' : /Gares/.test(name) ? 'brux' : 'gare');
          await sleep(320);
          await settle(6);
          proposed += [...document.querySelectorAll('[role="option"], .row.opt')].filter((o) => (o.textContent ?? '').includes('’')).length;
          expect(straight(), `après une saisie dans #${i.id}`).toEqual([]);
        }
        if (/Nouveau favori|A à B|ajout/.test(name)) expect(proposed, 'des propositions à apostrophe ont bien été montrées').toBeGreaterThan(0);
        // § 7 : seulement à l'affichage : rien n'a changé dans les réglages
        expect(hz.settings.get()).toEqual(before);
      });
});

describe('§ 7 : un lieu gardé en favori s’affiche comme sur l’accueil et dans les lunettes', () => {
  it('« Mes favoris » (titre et noms des boutons), titre de son écran, extrémité d’un trajet fixe, recherche ; le nom enregistré ne change pas', async () => {
    const s = straightSettings();
    const hz = harness({ settings: s });
    const before = structuredClone(hz.settings.get());
    withGuide(hz.glasses, null);
    const place = s.favorites[0];
    expect(favoriteRowTitle(place as Parameters<typeof favoriteRowTitle>[0], hz.ctx)).toBe('Gare de Braine-l’Alleud');
    expect(endpointText({ type: 'place', placeId: 'lieu-gare' }, s)).toBe('Gare de Braine-l’Alleud');
    expect(shownLabel({ kind: 'place', placeId: 'lieu-gare', label: "Gare de Braine-l'Alleud" })).toBe('Gare de Braine-l’Alleud');
    const list = mount(favoritesScreen(hz.ctx));
    const row = list.querySelector<HTMLElement>('.list li')!;
    expect(textOf(row.querySelector('.t1'))).toBe('Gare de Braine-l’Alleud');
    expect([...row.querySelectorAll('button')].map((b) => plain(b.getAttribute('aria-label')))).toEqual(['Modifier Gare de Braine-l’Alleud', 'Y aller : Gare de Braine-l’Alleud']);
    const edit = mount(favoriteEditScreen(hz.ctx, 'lieu-gare'));
    expect(textOf(edit.querySelector('h1'))).toBe('Gare de Braine-l’Alleud');
    // le champ « Nom » montre la valeur enregistrée, telle quelle ; l'endroit (« Près de … ») est un affichage
    expect(edit.querySelector<HTMLInputElement>('#pl-nom')!.value).toBe("Gare de Braine-l'Alleud");
    expect(edit.querySelector<HTMLInputElement>('#pl-lieu')!.value).toBe('Braine-l’Alleud');
    expect(hz.settings.get()).toEqual(before);
  });
});

describe('§ 7 : la recherche retrouve le nom, tapé avec « \' », avec « ’ » ou sans apostrophe', () => {
  const BRAINE = { id: 'sncb:8814258', op: 'sncb' as const, n: N("Braine-l'Alleud", 'Eigenbrakel'), modes: ['train' as const], lat: 50.6848, lon: 4.3757 };
  const OTHER = { id: 'sncb:8863008', op: 'sncb' as const, n: N('Namur', 'Namen'), modes: ['train' as const], lat: 50.4685, lon: 4.8625 };
  for (const q of ["braine-l'alleud", 'braine-l’alleud', 'braine l alleud', "l'alleud", 'l’alleud', 'Gare de Braine-l’Alle', "gare de braine-l'alleud"])
    it(`« ${q} »`, async () => {
      // le vrai classement de la recherche (core/search.ts), sur un nom des données à apostrophe droite
      const hz = harness({ settings: straightSettings(), core: (c) => ({ ...c, search: async (query, near) => rankSearch({ v: 1, items: [OTHER, BRAINE] }, query, near ?? undefined).map((it) => ({ ...it, kindLabel: 'gare' })), geocode: async () => ({ results: [] }) }) });
      const picks: unknown[] = [];
      const f = placeField(hz.ctx, { id: 'f', label: 'Arrivée', places: true, onPick: (c) => picks.push(c) });
      mount(f.el);
      type(f.input, q);
      await until(() => options(f.list).length > 0);
      await settle();
      const shown = options(f.list);
      const gare = /^gare de/i.test(q);
      // « Gare de … » : le lieu gardé ; sinon la gare des données (et le lieu, qui porte aussi ce nom)
      expect(shown.map((o) => o[0])).toContain(gare ? 'Gare de Braine-l’Alleud' : 'Braine-l’Alleud');
      for (const [label] of shown) expect(label).not.toContain("'");
      const want = gare ? 'favori' : 'gare';
      [...f.list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((o) => textOf(o.querySelector('.s2')) === want)!.click();
      expect(f.input.value).toBe(gare ? 'Gare de Braine-l’Alleud' : 'Braine-l’Alleud');
      // le choix rendu garde le nom des données ou le nom enregistré
      expect(picks[0]).toMatchObject(gare ? { kind: 'place', label: "Gare de Braine-l'Alleud" } : { kind: 'stop', label: "Braine-l'Alleud" });
      await settle();
    });
});

describe('§ 14, R6 : « Copier mon heure d’arrivée » ne garde rien et n’ouvre aucune connexion', () => {
  it('ni réglage, ni stockage, ni réseau (fetch, XMLHttpRequest, WebSocket, sendBeacon) ; le texte copié n’a que l’heure', async () => {
    const calls: string[] = [];
    const Refuse = (what: string) =>
      class {
        constructor() {
          calls.push(what);
        }
      };
    vi.stubGlobal('fetch', async () => (calls.push('fetch'), new Response('')));
    vi.stubGlobal('XMLHttpRequest', Refuse('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', Refuse('WebSocket'));
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => (calls.push('sendBeacon'), true) });
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void copied.push(t) } });
    const hz = harness({ settings: straightSettings(), core: straightCore });
    // un guidage dont chaque texte nomme un lieu
    withGuide(hz.glasses, { kind: 'trip', title: "Gare de Braine-l'Alleud", arr: at(8, 54), now: "à pied vers l'arrêt Flagey", guided: true, check: ['Lunettes : 12 % de batterie'] } as GuideStatus);
    const el = mount(homeScreen(hz.ctx));
    await settle(10);
    const stored = new Map(hz.kv.data);
    const settings = structuredClone(hz.settings.get());
    const before = calls.length;
    el.querySelector<HTMLButtonElement>('.now-copy')!.click();
    await until(() => textOf(el.querySelector('.now-copied')).startsWith('Copié'));
    await settle(10);
    expect(copied).toEqual(['J’arrive vers 08:54.']);
    expect(copied[0]).toMatch(/^J’arrive vers \d\d:\d\d\.$/);
    expect(textOf(el.querySelector('.now-copied'))).toBe('Copié : J’arrive vers 08:54.');
    expect(calls.slice(before), 'aucune connexion ouverte par la copie').toEqual([]);
    expect(hz.settings.get()).toEqual(settings);
    expect(new Map(hz.kv.data)).toEqual(stored);
  });
});
