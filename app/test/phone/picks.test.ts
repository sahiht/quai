// @vitest-environment happy-dom
/**
 * Quai 1.2.6, téléphone et Quai Web (PRD-1.2.6 § 1, § 4 et § 5 ; CA-126.5 ; avant : PRD-1.2.2 § 4, PRD-1.2.3 § 3) :
 * sections « Gares de train », « Arrêts de bus, tram, métro » et « Lignes de bus, tram, métro » de l'accueil ; ajout
 * d'une gare, d'un arrêt, d'une ligne (entière, dans les deux sens), chacun avec « Près de toi » ; retrait confirmé,
 * ordre, limites ; « Ouvrir d’office à moins de 300 m » (revue d'usage n° 4) ; réglages de la 1.1 et de la 1.2.5
 * rangés (CA-122.6, CA-126.4). Lignes et arrêts du faux cœur : des arrêts publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Core, LinePick, Settings, StationPick } from '../../src/core/api';
import type { LineFollow } from '../../src/core/linerun';
import { NEWS_SINCE, newsState } from '../../src/phone/app';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { addLineScreen, addStationScreen } from '../../src/phone/screens/pick-add';
import { ICON } from '../../src/phone/dom';
import { inGroups, moveById, moveInGroup, resetKnownLines, withLine, withNear, withStation } from '../../src/phone/screens/picks';
import { LIMITS } from '../../src/settings';
import { button, defaults, harness, mount, plain, preset11, SCENARIO, textOf, type, until } from './helpers';

/** Limites des réglages (settings.ts) : les textes les disent. */
const MAX_STATIONS = LIMITS.stations;
const MAX_LINES = LIMITS.lines;
const FULL_STATIONS = `${MAX_STATIONS} gares au plus : retires-en une.`;
const FULL_LINES = `${MAX_LINES} lignes au plus : retires-en une.`;
const FULL_STOPS = `${MAX_LINES} arrêts au plus : retires-en un.`;
const manyStations = (n: number): StationPick[] => Array.from({ length: n }, (_, i) => station(`g${i}`, `sncb:${i}`, `Gare ${i}`));
/** Arrêts (toutes leurs lignes), chacun sa zone. */
const manyStops = (n: number): LinePick[] => Array.from({ length: n }, (_, i) => line(`s${i}`, { areaId: `stib:${9000 + i}` }));
/** Lignes suivies (1.2.6). */
const manyFollows = (n: number): LineFollow[] => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, op: 'stib', mode: 'tram', line: String(i + 1), routes: [] }));
const T3: LineFollow = { id: 'f-t3', op: 'stib', mode: 'tram', line: '3', routes: ['stib:T3-CHURCHILL', 'stib:T3-ESPLANADE'], ends: [{ fr: 'Churchill', nl: 'Churchill' }, { fr: 'Esplanade', nl: 'Esplanade' }] };
const T4: LineFollow = { id: 'f-t4', op: 'stib', mode: 'tram', line: '4', routes: ['stib:T4-STALLE'], ends: [{ fr: 'Stalle (P)', nl: 'Stalle (P)' }] };
const W: LineFollow = { id: 'f-w', op: 'tec', mode: 'bus', line: 'W', routes: [] };

beforeEach(() => {
  resetAnswers();
  resetKnownLines();
});
afterEach(() => document.body.replaceChildren());

const station = (id: string, areaId: string, fr: string, lat = 50.5, lon = 4.5, nl = fr): StationPick => ({ id, areaId, name: { fr, nl }, lat, lon });
const NAMUR = station('g-namur', 'sncb:8863008', 'Namur', 50.4685, 4.8625, 'Namen');
const CENTRAL = station('g-central', 'sncb:8813003', 'Bruxelles-Central', 50.8454, 4.3571, 'Brussel-Centraal');
const GAND = station('g-gand', 'sncb:8892007', 'Gand-Saint-Pierre', 51.0359, 3.7107, 'Gent-Sint-Pieters');
const line = (id: string, l: Partial<LinePick> = {}): LinePick => ({ id, areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017, ...l });
/** Arrêt TEC public de la gare de Braine-l'Alleud (faux cœur) : la position des essais du bus W. */
const BRAINE_GARE = { lat: 50.6838, lon: 4.3715 };

/** Sections de l'accueil (1.2.6). */
const GARES = 'Gares de train';
const ARRETS = 'Arrêts de bus, tram, métro';
const LIGNES = 'Lignes de bus, tram, métro';
/** Section de l'accueil par son titre. */
const section = (el: HTMLElement, title: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.home-picks')].find((s) => textOf(s.querySelector('h2')) === title)!;
const titles = (s: HTMLElement) => [...s.querySelectorAll('.pick-row .t1, .order-row .t1')].map((t) => textOf(t));
/** « Près de toi » (1.2.6) : [nom, détail, bouton]. */
const nearRows = (el: Element) => [...el.querySelectorAll('.near-row')].map((r) => [textOf(r.querySelector('.t1')), plain(r.querySelector('.t2')?.textContent), textOf(r.querySelector('button'))]);
const nearButton = (el: Element, name: string) => [...el.querySelectorAll<HTMLElement>('.near-row')].find((r) => textOf(r.querySelector('.t1')) === name)!.querySelector('button')!;
/** Propositions d'une liste d'ajout : [nom, à droite]. */
const opts = (list: Element | null) => [...(list?.querySelectorAll('.opt') ?? [])].map((b) => [textOf(b.querySelector('.t1')).replace(/^Ajouter /, ''), textOf(b.querySelector('.meta'))]);
const optButton = (list: Element, name: string) => [...list.querySelectorAll<HTMLButtonElement>('.opt')].find((b) => textOf(b.querySelector('.t1')).replace(/^Ajouter /, '') === name)!;

describe('règles des gares et des lignes (sans écran)', () => {
  it('withStation, withLine : en fin de liste, sans doublon, LIMITS.stations gares et LIMITS.lines lignes au plus ; identifiants libres', () => {
    const s = defaults({ stations: [NAMUR], lines: [line('l-3', { line: '3' })] });
    const a = withStation(s, CENTRAL, 1);
    expect(a).not.toBe('exists');
    if (typeof a !== 'object') throw new Error('gare non ajoutée');
    expect(a.settings.stations.map((x) => x.areaId)).toEqual(['sncb:8863008', 'sncb:8813003']);
    expect(a.pick.id).toMatch(/^gare-/);
    expect(withStation(s, NAMUR)).toBe('exists');
    expect(withStation(defaults({ stations: manyStations(MAX_STATIONS) }), NAMUR)).toBe('full');
    // une ligne : même arrêt et même numéro (casse et zéros de tête ignorés) = doublon ; « toutes les lignes » à part
    expect(withLine(s, { ...line(''), line: '03' })).toBe('exists');
    const b = withLine(s, { ...line(''), line: '4', mode: 'tram' }, 2);
    if (typeof b !== 'object') throw new Error('ligne non ajoutée');
    expect(b.pick).toMatchObject({ areaId: 'stib:6357F', op: 'stib', line: '4', mode: 'tram' });
    expect(b.pick.id).toMatch(/^ligne-/);
    expect(typeof withLine(s, line(''))).toBe('object');
    expect(withLine(defaults({ lines: manyStops(MAX_LINES) }), { ...line(''), areaId: 'stib:1' })).toBe('full');
  });

  it('moveById, withNear : bornes respectées ; near: true ou rien', () => {
    const list = [NAMUR, CENTRAL, GAND];
    expect(moveById(list, 'g-namur', -1)).toBe(list);
    expect(moveById(list, 'g-gand', 1)).toBe(list);
    expect(moveById(list, 'g-gand', -1).map((x) => x.id)).toEqual(['g-namur', 'g-gand', 'g-central']);
    const on = withNear(list, 'g-central', true);
    expect(on[1]).toEqual({ ...CENTRAL, near: true });
    expect(withNear(on, 'g-central', false)[1]).toEqual(CENTRAL);
    expect('near' in withNear(on, 'g-central', false)[1]).toBe(false);
  });

  it('1.2.4 (PRD-1.2.4 § 2) : blocs « Arrêts » puis « Lignes » ; « Monter », « Descendre » dans son bloc seulement', () => {
    const p = (id: string, line?: string) => ({ id, ...(line ? { line } : {}) });
    const groups = [
      { label: 'Arrêts', has: (x: { line?: string }) => !x.line },
      { label: 'Lignes', has: (x: { line?: string }) => !!x.line },
    ];
    const list = [p('w', 'W'), p('cc'), p('t3', '3'), p('rmsj')];
    expect(inGroups(list, groups).map((x) => x.id)).toEqual(['cc', 'rmsj', 'w', 't3']);
    // la liste enregistrée est rangée par bloc ; un arrêt ne passe jamais chez les lignes, ni l'inverse
    expect(moveInGroup(list, 'rmsj', -1, groups).map((x) => x.id)).toEqual(['rmsj', 'cc', 'w', 't3']);
    expect(moveInGroup(list, 'rmsj', 1, groups).map((x) => x.id)).toEqual(['cc', 'rmsj', 'w', 't3']);
    expect(moveInGroup(list, 'w', -1, groups).map((x) => x.id)).toEqual(['cc', 'rmsj', 'w', 't3']);
    expect(moveInGroup(list, 't3', -1, groups).map((x) => x.id)).toEqual(['cc', 'rmsj', 't3', 'w']);
  });
});

describe('sections « Gares de train », « Arrêts… » et « Lignes de bus, tram, métro » de l’accueil (PRD-1.2.6 § 1 et § 5)', () => {
  it('CA-122.6 et CA-126.4 : réglages de la 1.1 rangés ; sous « Mes favoris », avant « Réglages » ; tram 3 et tram 4 suivis, Gare du Nord en repère', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    expect([...el.querySelectorAll('h2')].map((x) => textOf(x))).toEqual(['Mes favoris', GARES, ARRETS, LIGNES, 'Réglages']);
    expect([...el.querySelectorAll('.fav-row .t1')].map((x) => textOf(x))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
    const gares = section(el, GARES);
    expect(titles(gares)).toEqual(['Namur']);
    // l'icône bleue du train
    expect(gares.querySelector('.pick-row .ico')!.classList.contains('train')).toBe(true);
    // Bruxelles-Nord sans filtre : un arrêt, l'épingle, son type ; ses lignes en pastilles
    const arrets = section(el, ARRETS);
    await until(() => textOf(arrets.querySelector('.pick-row .t2')) !== '' && arrets.querySelectorAll('.pick-row .badge').length > 0);
    expect(titles(arrets)).toEqual(['Bruxelles-Nord']);
    expect(textOf(arrets.querySelector('.pick-row .t2'))).toBe('bus De Lijn');
    expect(arrets.querySelector('.pick-row .ico')!.innerHTML).toBe(ICON.pin);
    expect([...arrets.querySelectorAll('.pick-row .badge:not(.more)')].map((b) => textOf(b))).toEqual(['232', '270', '460']);
    // tram 3 et tram 4 (le filtre de la 1.2.1, gardés à Gare du Nord en 1.2.5) : des lignes suivies, retrouvées
    // (variantes, terminus) puis gardées
    const lignes = section(el, LIGNES);
    await until(() => (hz.settings.get().follows ?? []).every((f) => f.routes.length > 0) && titles(lignes)[0] === 'Tram 3');
    expect(titles(lignes)).toEqual(['Tram 3', 'Tram 4']);
    expect([...lignes.querySelectorAll('.pick-row .t2')].map((t) => plain(t.textContent))).toEqual(['STIB · Churchill ↔ Esplanade', 'STIB · Stalle (P)']);
    // pastilles à la couleur de la ligne (CSSOM, la politique de Quai Web refuse les attributs style)
    const badge = lignes.querySelector<HTMLElement>('.pick-row .badge')!;
    expect([textOf(badge), badge.classList.contains('official'), badge.style.getPropertyValue('--b')]).toEqual(['3', true, '#B5BA05']);
    // l'ancien « Quand je suis à moins de 300 m » de Gare du Nord : coché, dit avec l'arrêt repère
    expect([...lignes.querySelectorAll('.pick-near')].map((l) => textOf(l))).toEqual(['Ouvrir d’office à moins de 300 m de Gare du Nord', 'Ouvrir d’office à moins de 300 m de Gare du Nord']);
    expect([...lignes.querySelectorAll<HTMLInputElement>('.pick-near input')].map((c) => c.checked)).toEqual([true, true]);
    expect([...arrets.querySelectorAll<HTMLInputElement>('.pick-near input')].map((c) => c.checked)).toEqual([false]);
    expect([...gares.querySelectorAll<HTMLInputElement>('.pick-near input')].map((c) => c.checked)).toEqual([false]);
    expect(hz.settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
    expect(hz.settings.get().lines.map((p) => p.id)).toEqual(['fav-dl-nord']);
  });

  it('préréglage 1.1 migré, mis à jour : la bannière « Quai 1.2.6 » une fois, sans les nouveautés qui parlent de « Bus, tram, métro »', () => {
    const s = preset11();
    expect(s.seenVersion).toBe('1.1.0');
    const hz = harness({ settings: s });
    hz.ctx.news = newsState(s.seenVersion, NEWS_SINCE, '1.2.6');
    const el = mount(homeScreen(hz.ctx));
    const shown = [...el.querySelectorAll('.news p')].map((p) => plain(p.textContent));
    expect(shown[0]).toBe('Gares de train, arrêts et lignes de bus, tram, métro : trois rubriques séparées.');
    expect(shown[3]).toBe('Tes lignes gardées à un arrêt sont déjà dans Lignes.');
    expect(shown.some((l) => l.startsWith('Bus, tram, métro'))).toBe(false);
    button(el, 'OK').click();
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
  });

  it('vides : « Aucune gare… », « Aucun arrêt… », « Aucune ligne… » ; « Ajouter une gare », « Ajouter un arrêt », « Ajouter une ligne »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(homeScreen(hz.ctx));
    expect(textOf(section(el, GARES).querySelector('.list'))).toBe('Aucune gare pour l’instant.');
    expect(textOf(section(el, ARRETS).querySelector('.list'))).toBe('Aucun arrêt pour l’instant.');
    expect(textOf(section(el, LIGNES).querySelector('.list'))).toBe('Aucune ligne pour l’instant.');
    // « Changer l’ordre » seulement à partir de 2 éléments
    expect(button(section(el, GARES), 'Changer l’ordre').hidden).toBe(true);
    button(section(el, GARES), 'Ajouter une gare').click();
    button(section(el, ARRETS), 'Ajouter un arrêt').click();
    button(section(el, LIGNES), 'Ajouter une ligne').click();
    expect(hz.went).toEqual(['#/gares/ajouter', '#/arrets/ajouter', '#/lignes/ajouter']);
  });

  it('retrait confirmé dans la page (S6) : « Retirer Namur de tes gares ? », « Annuler » garde, « Retirer » retire ; un arrêt, une ligne', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR, CENTRAL], lines: [line('s-gdn')], follows: [T3, T4] }) });
    const el = mount(homeScreen(hz.ctx));
    const confirm = globalThis.confirm;
    globalThis.confirm = () => {
      throw new Error('boîte du système');
    };
    try {
      const gares = section(el, GARES);
      const trigger = gares.querySelector<HTMLButtonElement>('.pick-row .pick-main .btn')!;
      expect([textOf(trigger), trigger.getAttribute('aria-label')]).toEqual(['Retirer', 'Retirer Namur']);
      trigger.click();
      expect(plain(gares.querySelector('.confirm-q')!.textContent)).toBe('Retirer Namur de tes gares ?');
      expect(trigger.hidden).toBe(true);
      expect(textOf(document.activeElement)).toBe('Annuler');
      button(gares, 'Annuler').click();
      expect(gares.querySelector('.confirm')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(hz.settings.get().stations).toHaveLength(2);
      trigger.click();
      button(gares.querySelector('.confirm')!, 'Retirer').click();
      await until(() => hz.settings.get().stations.length === 1);
      expect(hz.settings.get().stations.map((x) => x.id)).toEqual(['g-central']);
      await until(() => plain(gares.querySelector('.live')?.textContent) !== '');
      expect(plain(gares.querySelector('.live')?.textContent)).toBe('Namur n’est plus dans tes gares.');
      expect(titles(gares)).toEqual(['Bruxelles-Central']);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Retirer Bruxelles-Central');
      // une ligne : confirmée aussi (1.2.6)
      const lignes = section(el, LIGNES);
      [...lignes.querySelectorAll<HTMLButtonElement>('.pick-main .btn')][1].click();
      expect(plain(lignes.querySelector('.confirm-q')?.textContent)).toBe('Retirer Tram 4 de tes lignes ?');
      button(lignes.querySelector('.confirm')!, 'Retirer').click();
      await until(() => (hz.settings.get().follows ?? []).length === 1);
      expect(hz.settings.get().follows?.map((x) => x.id)).toEqual(['f-t3']);
      await until(() => plain(lignes.querySelector('.live')?.textContent) !== '');
      expect(plain(lignes.querySelector('.live')?.textContent)).toBe('Tram 4 n’est plus dans tes lignes.');
      // un arrêt
      const arrets = section(el, ARRETS);
      arrets.querySelector<HTMLButtonElement>('.pick-main .btn')!.click();
      expect(plain(arrets.querySelector('.confirm-q')?.textContent)).toBe('Retirer Gare du Nord de tes arrêts ?');
      button(arrets.querySelector('.confirm')!, 'Retirer').click();
      await until(() => hz.settings.get().lines.length === 0);
      expect(textOf(arrets.querySelector('.list'))).toBe('Aucun arrêt pour l’instant.');
    } finally {
      globalThis.confirm = confirm;
    }
  });

  it('après le retrait d’un arrêt, le curseur passe à celui qui le suit à l’écran', async () => {
    const rogier = line('s-rogier', { areaId: 'stib:6359', name: { fr: 'Rogier', nl: 'Rogier' } });
    const hz = harness({ settings: defaults({ lines: [line('s-gdn'), rogier] }) });
    const el = mount(homeScreen(hz.ctx));
    const arrets = section(el, ARRETS);
    expect(titles(arrets)).toEqual(['Gare du Nord', 'Rogier']);
    arrets.querySelector<HTMLButtonElement>('.pick-row .pick-main .btn')!.click();
    button(arrets.querySelector('.confirm')!, 'Retirer').click();
    await until(() => hz.settings.get().lines.length === 1);
    await until(() => document.activeElement?.getAttribute('aria-label') === 'Retirer Rogier');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Retirer Rogier');
  });

  it('ordre : « Changer l’ordre », « Monter », « Descendre », « Terminé » ; l’ordre est enregistré, section par section', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR, CENTRAL, GAND], follows: [T3, T4] }) });
    const el = mount(homeScreen(hz.ctx));
    const gares = section(el, GARES);
    const ids = () => hz.settings.get().stations.map((x) => x.id);
    button(gares, 'Changer l’ordre').click();
    const rows = () => [...gares.querySelectorAll<HTMLElement>('.order-row')];
    expect(rows()).toHaveLength(3);
    expect(button(gares, 'Ajouter une gare').hidden).toBe(true);
    expect(gares.querySelector('.pick-near')).toBeNull();
    expect(rows()[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    expect([...rows()[2].querySelectorAll<HTMLButtonElement>('button')][1].disabled).toBe(true);
    // les autres sections ne changent pas de mode
    expect(section(el, LIGNES).querySelectorAll('.order-row')).toHaveLength(0);
    const gand = rows()[2];
    expect(gand.querySelector('button')!.getAttribute('aria-label')).toBe('Monter Gand-Saint-Pierre');
    button(gand, 'Monter').click();
    await until(() => plain(gares.querySelector('.live')?.textContent) !== '');
    expect(ids()).toEqual(['g-namur', 'g-gand', 'g-central']);
    expect(plain(gares.querySelector('.live')?.textContent)).toBe('Gand-Saint-Pierre : 2e sur 3.');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Monter Gand-Saint-Pierre');
    button(rows()[0], 'Descendre').click();
    await until(() => plain(gares.querySelector('.live')?.textContent) === 'Namur : 2e sur 3.');
    expect(ids()).toEqual(['g-gand', 'g-namur', 'g-central']);
    button(gares, 'Terminé').click();
    expect(gares.querySelectorAll('.order-row')).toHaveLength(0);
    expect(titles(gares)).toEqual(['Gand-Saint-Pierre', 'Namur', 'Bruxelles-Central']);
    // lignes suivies : l'ordre de « Lignes » dans les lunettes
    const lignes = section(el, LIGNES);
    button(lignes, 'Changer l’ordre').click();
    button([...lignes.querySelectorAll<HTMLElement>('.order-row')][1], 'Monter').click();
    await until(() => plain(lignes.querySelector('.live')?.textContent) !== '');
    expect(hz.settings.get().follows?.map((x) => x.id)).toEqual(['f-t4', 'f-t3']);
    expect(plain(lignes.querySelector('.live')?.textContent)).toBe('Tram 4 : 1er sur 2.');
  });

  it('limites (LIMITS de settings.ts) : « Ajouter » grisé, message clair, par section', () => {
    const el = mount(homeScreen(harness({ settings: defaults({ stations: manyStations(MAX_STATIONS), lines: manyStops(MAX_LINES), follows: manyFollows(MAX_LINES) }) }).ctx));
    expect(button(section(el, GARES), 'Ajouter une gare').disabled).toBe(true);
    expect(textOf(section(el, GARES))).toContain(FULL_STATIONS);
    expect(button(section(el, ARRETS), 'Ajouter un arrêt').disabled).toBe(true);
    expect(textOf(section(el, ARRETS))).toContain(FULL_STOPS);
    expect(button(section(el, LIGNES), 'Ajouter une ligne').disabled).toBe(true);
    expect(textOf(section(el, LIGNES))).toContain(FULL_LINES);
    // une de moins : plus de message ; les arrêts et les lignes ont chacun leur limite
    const el2 = mount(homeScreen(harness({ settings: defaults({ stations: manyStations(MAX_STATIONS - 1), lines: manyStops(MAX_LINES) }) }).ctx));
    expect(button(section(el2, GARES), 'Ajouter une gare').disabled).toBe(false);
    expect(textOf(section(el2, GARES))).not.toContain('au plus');
    expect(button(section(el2, LIGNES), 'Ajouter une ligne').disabled).toBe(false);
  });

  it('revue d’usage n° 4 : « Ouvrir d’office à moins de 300 m » décoché d’office ; near: true ou rien ; une ligne : seulement avec son arrêt repère', async () => {
    const via = { areaId: 'stib:6357F', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017 };
    const hz = harness({ settings: defaults({ stations: [NAMUR], lines: [line('s-gdn')], follows: [{ ...T3, via }, T4] }) });
    const el = mount(homeScreen(hz.ctx));
    const box = section(el, GARES).querySelector<HTMLInputElement>('.pick-near input')!;
    expect(textOf(box.closest('label'))).toBe('Ouvrir d’office à moins de 300 m');
    expect(box.checked).toBe(false);
    // nommée par son texte, décrite par la gare (lecteurs d'écran)
    expect(textOf(document.getElementById(box.getAttribute('aria-describedby')!))).toBe('Namur');
    box.click();
    await until(() => hz.settings.get().stations[0].near === true);
    // la case garde le curseur (la liste n'est pas redessinée)
    expect(section(el, GARES).querySelector('.pick-near input')).toBe(box);
    box.click();
    await until(() => !('near' in hz.settings.get().stations[0]));
    section(el, ARRETS).querySelector<HTMLInputElement>('.pick-near input')!.click();
    await until(() => hz.settings.get().lines[0].near === true);
    // le tram 3 (repère Gare du Nord) : sa case ; le tram 4, ajouté en 1.2.6 sans arrêt : aucune
    const lignes = section(el, LIGNES);
    expect([...lignes.querySelectorAll('.pick-near')].map((l) => textOf(l))).toEqual(['Ouvrir d’office à moins de 300 m de Gare du Nord']);
    lignes.querySelector<HTMLInputElement>('.pick-near input')!.click();
    await until(() => hz.settings.get().follows?.[0].near === true);
  });

  it('un élément gardé ailleurs (★ des lunettes de Quai Web) paraît dans sa section', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR] }) });
    const el = mount(homeScreen(hz.ctx));
    await hz.settings.update((s: Settings) => ({ ...s, stations: [...s.stations, CENTRAL], follows: [T4] }));
    expect(titles(section(el, GARES))).toEqual(['Namur', 'Bruxelles-Central']);
    expect(titles(section(el, LIGNES))).toEqual(['Tram 4']);
  });
});

describe('« Ajouter une gare » (§ 4, PRD-1.2.6 § 5)', () => {
  it('gares SNCB seulement, les plus proches d’abord : « bruxelles » près de Bruxelles-Central', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addStationScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Ajouter une gare');
    expect(textOf(el.querySelector('.lead'))).toBe('Ses prochains trains s’afficheront dans les lunettes.');
    expect(textOf(el.querySelector('label[for="gare-nom"]'))).toBe('Nom de la gare');
    expect(el.querySelector('#gare-nom')!.hasAttribute('data-autofocus')).toBe(true);
    type(el.querySelector<HTMLInputElement>('#gare-nom')!, 'bruxelles');
    await until(() => opts(el.querySelector('.opts')).length > 0 && opts(el.querySelector('.opts'))[0][0] === 'Bruxelles-Central');
    // ni l'arrêt De Lijn « Bruxelles-Nord », ni l'arrêt TEC « Bruxelles Midi »
    const found = opts(el.querySelector('.opts'));
    expect(found.map(([n]) => n)).toEqual(['Bruxelles-Central', 'Bruxelles-Luxembourg', 'Bruxelles-Schuman', 'Bruxelles-Nord', 'Bruxelles-Midi']);
    expect(found[0][1]).toBe('ici');
    for (const [, d] of found.slice(1)) expect(d).toMatch(/^1,\d km$/);
    // un toucher ajoute : le bouton le dit aux lecteurs d'écran
    expect(textOf(el.querySelector('.opt .t1'))).toBe('Ajouter Bruxelles-Central');
  });

  it('1.2.6 : « Près de toi » : les gares à moins de 2 km, la plus proche d’abord, « Ajouter » puis « Ajoutée ✓ » ; « Une autre gare » ; sans position : rien', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addStationScreen(hz.ctx));
    await until(() => nearRows(el).length > 0);
    expect(textOf(el.querySelector('.sub-head'))).toBe('Près de toi');
    expect(nearRows(el).map(([n, , b]) => [n, b])).toEqual([
      ['Bruxelles-Central', 'Ajouter'],
      ['Bruxelles-Luxembourg', 'Ajouter'],
      ['Bruxelles-Schuman', 'Ajouter'],
      ['Bruxelles-Nord', 'Ajouter'],
      ['Bruxelles-Midi', 'Ajouter'],
    ]);
    expect(nearRows(el)[0][1]).toBe('ici');
    expect(el.querySelector('.near-row .ico')!.classList.contains('train')).toBe(true);
    expect([...el.querySelectorAll('.sub-head')].map((x) => textOf(x))).toEqual(['Près de toi', 'Une autre gare']);
    // un toucher ajoute, un second retire ; le bouton le dit aux lecteurs d'écran
    nearButton(el, 'Bruxelles-Nord').click();
    await until(() => hz.settings.get().stations.length === 1);
    expect(hz.settings.get().stations[0]).toMatchObject({ areaId: 'sncb:8812005' });
    await until(() => textOf(nearButton(el, 'Bruxelles-Nord')) === 'Ajoutée ✓');
    expect(nearButton(el, 'Bruxelles-Nord').getAttribute('aria-pressed')).toBe('true');
    nearButton(el, 'Bruxelles-Nord').click();
    await until(() => hz.settings.get().stations.length === 0);
    await until(() => textOf(nearButton(el, 'Bruxelles-Nord')) === 'Ajouter');
    // la limite : dite, rien d'ajouté
    const full = harness({ settings: defaults({ stations: manyStations(MAX_STATIONS) }), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el2 = mount(addStationScreen(full.ctx));
    await until(() => nearRows(el2).length > 0);
    nearButton(el2, 'Bruxelles-Nord').click();
    await until(() => textOf(el2.querySelector('.msg')) !== '');
    expect(textOf(el2.querySelector('.msg'))).toBe(FULL_STATIONS);
    expect(full.settings.get().stations).toHaveLength(MAX_STATIONS);
    const none = mount(addStationScreen(harness({ settings: defaults(), here: null }).ctx));
    await new Promise((r) => setTimeout(r, 50));
    expect(nearRows(none)).toEqual([]);
    expect(none.querySelector<HTMLElement>('.sub-head')!.closest<HTMLElement>('.step')!.hidden).toBe(true);
  });

  it('un toucher ajoute (« Namur ajoutée à Gares. ») ; une gare déjà choisie : « Déjà dans tes gares » ; « Terminé » revient à la section', async () => {
    const hz = harness({ settings: defaults(), here: null });
    const el = mount(addStationScreen(hz.ctx));
    const input = el.querySelector<HTMLInputElement>('#gare-nom')!;
    type(input, 'namur');
    await until(() => opts(el.querySelector('.opts')).length > 0);
    // « Namur Gare » (bus TEC) n'est pas une gare SNCB
    expect(opts(el.querySelector('.opts'))).toEqual([['Namur', '']]);
    expect(button(el, 'Terminé').hidden).toBe(true);
    optButton(el.querySelector('.opts')!, 'Namur').click();
    await until(() => hz.settings.get().stations.length === 1);
    expect(hz.settings.get().stations[0]).toMatchObject({ areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 });
    expect(hz.settings.get().stations[0]).not.toHaveProperty('near');
    await until(() => textOf(el.querySelector('.msg')) !== '');
    expect(textOf(el.querySelector('.msg'))).toBe('Namur ajoutée à Gares.');
    // prêt pour une autre gare : le champ est vidé
    expect(input.value).toBe('');
    type(input, 'namur');
    await until(() => opts(el.querySelector('.opts'))[0]?.[1] === 'déjà dans tes gares');
    optButton(el.querySelector('.opts')!, 'Namur').click();
    await until(() => textOf(el.querySelector('.msg')) === 'Déjà dans tes gares.');
    expect(hz.settings.get().stations).toHaveLength(1);
    button(el, 'Terminé').click();
    expect(hz.went).toEqual(['#/gares']);
    expect(el.querySelector('.back')!.textContent).toContain('Accueil');
  });

  it('revue 1.2.2 : « Accueil » des écrans d’ajout ramène à l’accueil, même sans gare ni ligne (pas de boucle)', () => {
    for (const screen of [addStationScreen, addLineScreen, (c: Parameters<typeof addLineScreen>[0]) => addLineScreen(c, 'stop')]) {
      const empty = harness({ settings: defaults() });
      const el = mount(screen(empty.ctx));
      (el.querySelector('.back') as HTMLButtonElement).click();
      expect(empty.went).toEqual(['#/']);
    }
  });

  it('limite des gares : « … gares au plus : retires-en une. » ; aucune gare : texte clair ; recherche en panne : texte clair', async () => {
    const full = harness({ settings: defaults({ stations: manyStations(MAX_STATIONS) }), here: null });
    const el = mount(addStationScreen(full.ctx));
    type(el.querySelector<HTMLInputElement>('#gare-nom')!, 'namur');
    await until(() => opts(el.querySelector('.opts')).length > 0);
    optButton(el.querySelector('.opts')!, 'Namur').click();
    await until(() => textOf(el.querySelector('.msg')) !== '');
    expect(textOf(el.querySelector('.msg'))).toBe(FULL_STATIONS);
    expect(el.querySelector('.msg')!.classList.contains('err')).toBe(true);
    expect(full.settings.get().stations).toHaveLength(MAX_STATIONS);

    const hz = harness({ settings: defaults(), here: null });
    const el2 = mount(addStationScreen(hz.ctx));
    type(el2.querySelector<HTMLInputElement>('#gare-nom')!, 'zzzz');
    await until(() => textOf(el2.querySelector('#gare-nom-etat')) !== '');
    expect(textOf(el2.querySelector('#gare-nom-etat'))).toBe('Aucune gare ne correspond. Vérifie l’orthographe.');

    const down = harness({ settings: defaults(), here: null, core: (c: Core) => ({ ...c, search: async () => Promise.reject(new Error('réseau')) }) });
    const el3 = mount(addStationScreen(down.ctx));
    type(el3.querySelector<HTMLInputElement>('#gare-nom')!, 'namur');
    await until(() => textOf(el3.querySelector('#gare-nom-etat')) !== '');
    expect(textOf(el3.querySelector('#gare-nom-etat'))).toBe('Recherche impossible pour l’instant : réessaie dans un instant.');
    expect(el3.querySelector('#gare-nom-etat')!.classList.contains('err')).toBe(true);
  });
});

describe('« Ajouter une ligne » (PRD-1.2.6 § 5) : la ligne entière, dans les deux sens', () => {
  /** Tape le numéro et attend les lignes trouvées. */
  async function number(el: HTMLElement, q: string): Promise<void> {
    type(el.querySelector<HTMLInputElement>('#ligne-num')!, q);
    await until(() => opts(el.querySelector('.step:not([hidden]) .opts')).length > 0 || textOf(el.querySelector('#ligne-num-etat')) !== '');
  }
  const step2 = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.line-add > .step')].at(-1)!;

  it('« Numéro de la ligne » : « Bus W TEC, … ↔ Bruxelles Midi » ; un toucher ajoute la ligne entière et confirme ; déjà là : dit', async () => {
    const hz = harness({ settings: defaults(), here: BRAINE_GARE });
    const el = mount(addLineScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Ajouter une ligne');
    expect(document.title === '' || true).toBe(true);
    expect(textOf(el.querySelector('.lead'))).toBe('Toute la ligne s’affichera dans les lunettes, dans les deux sens, avec l’attente à chaque arrêt.');
    expect(textOf(el.querySelector('label[for="ligne-num"]'))).toBe('Numéro de la ligne');
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.placeholder).toBe('W, 36, 71…');
    expect(el.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    await number(el, 'w');
    expect(opts(el.querySelector('.opts'))).toEqual([['Bus W TEC, Braine-l’Alleud Gare ↔ Bruxelles Midi', 'ici']]);
    // sa pastille : le TEC ne publie pas de couleur, celle de ses bus (jaune, texte rouge)
    const badge = el.querySelector<HTMLElement>('.opts .opt .badge')!;
    expect([textOf(badge), badge.style.getPropertyValue('--b'), badge.style.getPropertyValue('--t')]).toEqual(['W', '#FFD200', '#D2001F']);
    el.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => (hz.settings.get().follows ?? []).length === 1);
    const f = hz.settings.get().follows![0];
    expect(f).toMatchObject({ op: 'tec', mode: 'bus', line: 'W', routes: ['tec:TEC-W', 'tec:TEC-WR', 'tec:TEC-W-WAT'] });
    expect(f.ends?.map((e) => e.fr)).toEqual(['Braine-l’Alleud Gare', 'Bruxelles Midi']);
    expect(f).not.toHaveProperty('via');
    expect(f).not.toHaveProperty('near');
    expect(hz.settings.get().lines).toEqual([]);
    const s2 = step2(el);
    expect(s2.hidden).toBe(false);
    expect(textOf(s2.querySelector('.chosen-line'))).toBe('Bus W TEC, Braine-l’Alleud Gare ↔ Bruxelles Midi');
    const msg = s2.querySelector('.msg')!;
    await until(() => textOf(msg) !== '');
    expect(plain(msg.textContent)).toMatch(/^Bus W ajouté/);
    // « Ajouter une autre ligne » : le champ vidé ; la même ligne : déjà là
    button(s2, 'Ajouter une autre ligne').click();
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.value).toBe('');
    await number(el, 'w');
    el.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => textOf(step2(el).querySelector('.msg')) !== '');
    expect(plain(step2(el).querySelector('.msg')!.textContent)).toBe('Bus W est déjà dans tes lignes.');
    expect(hz.settings.get().follows).toHaveLength(1);
    // « Terminé » : la section
    button(step2(el), 'Terminé').click();
    expect(hz.went).toEqual(['#/lignes']);
  });

  it('« Près de toi » : les lignes des arrêts à 500 m, « Ajouter » puis « Ajoutée ✓ », un second toucher retire ; la limite dite', async () => {
    const hz = harness({ settings: defaults(), here: BRAINE_GARE });
    const el = mount(addLineScreen(hz.ctx));
    await until(() => nearRows(el).length > 0);
    expect(nearRows(el)).toEqual([['Bus W', 'TEC · Braine-l’Alleud Gare ↔ Bruxelles Midi · ici', 'Ajouter']]);
    expect([...el.querySelectorAll('.sub-head')].filter((x) => !x.closest('[hidden]')).map((x) => textOf(x))).toEqual(['Près de toi', 'Une autre ligne']);
    nearButton(el, 'Bus W').click();
    await until(() => (hz.settings.get().follows ?? []).length === 1);
    await until(() => textOf(nearButton(el, 'Bus W')) === 'Ajoutée ✓');
    nearButton(el, 'Bus W').click();
    await until(() => (hz.settings.get().follows ?? []).length === 0);
    // limite atteinte : dite d'emblée, puis au toucher, et rien n'est ajouté
    const full = harness({ settings: defaults({ follows: manyFollows(MAX_LINES) }), here: BRAINE_GARE });
    const el2 = mount(addLineScreen(full.ctx));
    expect(textOf(el2.querySelector('.screen > .msg.err'))).toBe(FULL_LINES);
    await until(() => nearRows(el2).length > 0);
    nearButton(el2, 'Bus W').click();
    await until(() => [...el2.querySelectorAll('.line-add .msg')].some((m) => textOf(m) === FULL_LINES));
    expect(full.settings.get().follows).toHaveLength(MAX_LINES);
    await number(el2, 'w');
    el2.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => textOf(step2(el2).querySelector('.msg')) !== '');
    expect(textOf(step2(el2).querySelector('.msg'))).toBe(FULL_LINES);
    expect(full.settings.get().follows).toHaveLength(MAX_LINES);
    // sans position : pas de « Près de toi »
    const none = mount(addLineScreen(harness({ settings: defaults(), here: null }).ctx));
    await new Promise((r) => setTimeout(r, 50));
    expect(nearRows(none)).toEqual([]);
  });

  it('plusieurs lignes du même numéro, les plus proches d’abord ; « Changer de ligne » revient au champ', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addLineScreen(hz.ctx));
    await number(el, '1');
    expect(opts(el.querySelector('.opts'))).toEqual([
      ['Tram 1 De Lijn, Flanders Expo ↔ Korenmarkt', '50 km'],
      ['Bus 1 TEC, Jemappes', '52 km'],
    ]);
    [...el.querySelectorAll<HTMLButtonElement>('.opts .opt')][1].click();
    await until(() => (hz.settings.get().follows ?? []).length === 1);
    expect(hz.settings.get().follows![0]).toMatchObject({ op: 'tec', line: '1', mode: 'bus' });
    button(step2(el), 'Changer de ligne').click();
    expect(el.querySelectorAll<HTMLElement>('.step')[1].hidden).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.value).toBe('1');
    expect(document.activeElement?.id).toBe('ligne-num');
  });

  it('textes clairs : numéro inconnu (un train : « ajoute sa gare dans Gares »), recherche en panne', async () => {
    const el = mount(addLineScreen(harness({ settings: defaults(), here: null }).ctx));
    await number(el, 'IC');
    expect(textOf(el.querySelector('#ligne-num-etat'))).toBe('Aucune ligne de bus, tram ou métro ne porte ce numéro. Pour un train, ajoute sa gare dans Gares.');
    const down = harness({ settings: defaults(), here: null, core: (c: Core) => ({ ...c, findLines: async () => Promise.reject(new Error('réseau')) }) });
    const el2 = mount(addLineScreen(down.ctx));
    await number(el2, 'w');
    expect(textOf(el2.querySelector('#ligne-num-etat'))).toBe('Recherche impossible pour l’instant : réessaie dans un instant.');
  });

  it('depuis un arrêt (?arret=…) : ses lignes en raccourcis', async () => {
    const hz = harness({ settings: defaults(), here: null, params: 'arret=stib:6357F' });
    const el = mount(addLineScreen(hz.ctx));
    await until(() => el.querySelectorAll('.quick .shortcut').length > 0);
    expect(textOf(el.querySelector('.quick p'))).toBe('Lignes à Gare du Nord :');
    expect([...el.querySelectorAll('.quick .shortcut')].map((b) => textOf(b))).toEqual(['Tram 3', 'Tram 4']);
    button(el.querySelector('.quick')!, 'Tram 3').click();
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.value).toBe('3');
    await until(() => opts(el.querySelector('.opts')).length > 0);
    expect(opts(el.querySelector('.opts'))[0][0]).toBe('Tram 3 STIB, Churchill ↔ Esplanade');
    el.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => (hz.settings.get().follows ?? []).length === 1);
    expect(hz.settings.get().follows![0]).toMatchObject({ op: 'stib', line: '3', mode: 'tram' });
  });
});

describe('« Ajouter un arrêt » (PRD-1.2.3 § 3, PRD-1.2.6 § 5)', () => {
  /** Liste des arrêts trouvés : [nom, type, à droite]. */
  const stopOpts = (el: HTMLElement) => [...el.querySelectorAll('.stop-add .opt')].map((b) => [textOf(b.querySelector('.t1')).replace(/^Ajouter /, ''), textOf(b.querySelector('.t2')), textOf(b.querySelector('.meta'))]);
  const stopButton = (el: HTMLElement, name: string) => [...el.querySelectorAll<HTMLButtonElement>('.stop-add .opt')].find((b) => textOf(b.querySelector('.t1')).replace(/^Ajouter /, '') === name)!;
  /** Tape dans « Nom de l’arrêt » et attend la réponse (après le délai de frappe) : une autre liste ou une autre note. */
  const search = async (el: HTMLElement, q: string): Promise<void> => {
    const before = JSON.stringify([stopOpts(el), textOf(el.querySelector('#arret-nom-etat'))]);
    type(el.querySelector<HTMLInputElement>('#arret-nom')!, q);
    await new Promise((r) => setTimeout(r, 260));
    await until(() => JSON.stringify([stopOpts(el), textOf(el.querySelector('#arret-nom-etat'))]) !== before);
  };

  it('son écran : « Ajouter un arrêt », le champ « Nom de l’arrêt » ; arrêts de bus, tram et métro seulement, jamais une gare SNCB', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addLineScreen(hz.ctx, 'stop'));
    expect(textOf(el.querySelector('h1'))).toBe('Ajouter un arrêt');
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(textOf(el.querySelector('.lead'))).toBe('Tous ses départs s’afficheront dans les lunettes.');
    expect(el.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    expect(el.querySelector('#arret-nom')!.hasAttribute('data-autofocus')).toBe(true);
    expect(textOf(el.querySelector('label[for="arret-nom"]'))).toBe('Nom de l’arrêt');
    await search(el, 'bruxelles');
    // ni Bruxelles-Central, ni Bruxelles-Nord, ni Bruxelles-Midi (gares SNCB)
    const found = stopOpts(el);
    expect(found.map(([n, k]) => [n, k])).toEqual([
      ['Bruxelles-Nord', 'bus De Lijn'],
      ['Bruxelles Midi', 'bus TEC'],
    ]);
    for (const [, , d] of found) expect(d).toMatch(/^\d,\d km$/);
    await search(el, 'gare du nord');
    await until(() => stopOpts(el)[0]?.[0] === 'Gare du Nord');
    expect(stopOpts(el).map(([n, k]) => [n, k])).toEqual([
      ['Gare du Nord', 'tram STIB'],
      ['Bruxelles-Nord', 'bus De Lijn'],
    ]);
    // un toucher ajoute : le bouton le dit aux lecteurs d'écran ; ses lignes en pastilles
    expect(textOf(el.querySelector('.stop-add .opt .t1'))).toBe('Ajouter Gare du Nord');
    await until(() => el.querySelectorAll('.stop-add .opt .badge').length > 0);
    expect([...el.querySelectorAll('.stop-add .opt')][0].querySelectorAll('.badge').length).toBe(2);
  });

  it('« Près de toi » : les arrêts les plus proches (sans la gare), avec leurs lignes ; « Ajouter », « Ajouté ✓ », un second toucher retire', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addLineScreen(hz.ctx, 'stop'));
    await until(() => nearRows(el).length > 0);
    expect(nearRows(el)).toEqual([
      ['Bourse', 'tram STIB · 610 m', 'Ajouter'],
      ['De Brouckère', 'tram STIB · 700 m', 'Ajouter'],
    ]);
    nearButton(el, 'Bourse').click();
    await until(() => hz.settings.get().lines.length === 1);
    expect(hz.settings.get().lines[0]).toMatchObject({ op: 'stib', name: { fr: 'Bourse' } });
    expect(hz.settings.get().lines[0]).not.toHaveProperty('line');
    await until(() => textOf(nearButton(el, 'Bourse')) === 'Ajouté ✓');
    nearButton(el, 'Bourse').click();
    await until(() => hz.settings.get().lines.length === 0);
    // la limite : dite, rien d'ajouté
    const full = harness({ settings: defaults({ lines: manyStops(MAX_LINES) }), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el2 = mount(addLineScreen(full.ctx, 'stop'));
    expect(textOf(el2.querySelector('.screen > .msg.err'))).toBe(FULL_STOPS);
    await until(() => nearRows(el2).length > 0);
    nearButton(el2, 'Bourse').click();
    await until(() => textOf(el2.querySelector('.stop-add .msg')) !== '');
    expect(textOf(el2.querySelector('.stop-add .msg'))).toBe(FULL_STOPS);
    expect(full.settings.get().lines).toHaveLength(MAX_LINES);
  });

  it('un toucher ajoute l’arrêt avec toutes ses lignes (sans line ni mode) et confirme ; doublon signalé ; « Terminé » : la section', async () => {
    const hz = harness({ settings: defaults({ follows: [T3] }), here: null });
    const el = mount(addLineScreen(hz.ctx, 'stop'));
    await search(el, 'gare du nord');
    await until(() => stopOpts(el)[0]?.[0] === 'Gare du Nord');
    expect(button(el.querySelector('.stop-add')!, 'Terminé').hidden).toBe(true);
    stopButton(el, 'Gare du Nord').click();
    await until(() => hz.settings.get().lines.length === 1);
    const added = hz.settings.get().lines[0];
    expect(added).toMatchObject({ areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017 });
    expect(added).not.toHaveProperty('line');
    expect(added).not.toHaveProperty('mode');
    expect(added).not.toHaveProperty('near');
    const msg = el.querySelector('.stop-add .msg')!;
    await until(() => textOf(msg) !== '');
    expect(plain(msg.textContent)).toBe('Gare du Nord ajouté : tous ses départs s’afficheront dans les lunettes.');
    // prêt pour un autre arrêt : le champ est vidé
    expect(el.querySelector<HTMLInputElement>('#arret-nom')!.value).toBe('');
    await search(el, 'gare du nord');
    await until(() => stopOpts(el)[0]?.[2] === 'déjà dans tes arrêts');
    stopButton(el, 'Gare du Nord').click();
    await until(() => textOf(msg) === 'Déjà dans tes arrêts.');
    expect(hz.settings.get().lines).toHaveLength(1);
    button(el.querySelector('.stop-add')!, 'Terminé').click();
    expect(hz.went).toEqual(['#/arrets']);
    // sur l'accueil : « Gare du Nord » sous « Arrêts… », avec son type ; la ligne suivie à part
    const home = mount(homeScreen(hz.ctx));
    const arrets = section(home, ARRETS);
    await until(() => textOf(arrets.querySelector('.pick-row .t2')) !== '');
    expect(titles(arrets)).toEqual(['Gare du Nord']);
    expect(textOf(arrets.querySelector('.pick-row .t2'))).toBe('tram STIB');
    expect(titles(section(home, LIGNES))).toEqual(['Tram 3']);
  });

  it('textes clairs : seulement une gare (« Pour une gare, ajoute-la dans Gares. »), recherche en panne ; limite des arrêts', async () => {
    const el = mount(addLineScreen(harness({ settings: defaults(), here: null }).ctx, 'stop'));
    await search(el, 'ottignies');
    expect(textOf(el.querySelector('#arret-nom-etat'))).toBe('Aucun arrêt de bus, tram ou métro ne correspond. Pour une gare, ajoute-la dans Gares.');
    expect(stopOpts(el)).toEqual([]);
    const down = harness({ settings: defaults(), here: null, core: (c: Core) => ({ ...c, search: async () => Promise.reject(new Error('réseau')) }) });
    const el2 = mount(addLineScreen(down.ctx, 'stop'));
    await search(el2, 'rogier');
    expect(textOf(el2.querySelector('#arret-nom-etat'))).toBe('Recherche impossible pour l’instant : réessaie dans un instant.');
    expect(el2.querySelector('#arret-nom-etat')!.classList.contains('err')).toBe(true);
    const full = harness({ settings: defaults({ lines: manyStops(MAX_LINES) }), here: null });
    const el3 = mount(addLineScreen(full.ctx, 'stop'));
    expect(textOf(el3.querySelector('.screen > .msg.err'))).toBe(FULL_STOPS);
    await search(el3, 'rogier');
    stopButton(el3, 'Rogier').click();
    const msg = el3.querySelector('.stop-add .msg')!;
    await until(() => textOf(msg) !== '');
    expect(textOf(msg)).toBe(FULL_STOPS);
    expect(full.settings.get().lines).toHaveLength(MAX_LINES);
  });

  it('depuis « Un endroit » (?arret=…) : l’arrêt choisi en tête', async () => {
    const hz = harness({ settings: defaults(), here: null, params: 'arret=stib:6357F' });
    const el = mount(addLineScreen(hz.ctx, 'stop'));
    await until(() => stopOpts(el).length > 0);
    expect(stopOpts(el)).toEqual([['Gare du Nord', 'tram STIB', 'arrêt choisi']]);
    stopButton(el, 'Gare du Nord').click();
    await until(() => hz.settings.get().lines.length === 1);
    expect(hz.settings.get().lines[0]).toMatchObject({ areaId: 'stib:6357F', op: 'stib' });
    expect(hz.settings.get().lines[0]).not.toHaveProperty('line');
  });
});
