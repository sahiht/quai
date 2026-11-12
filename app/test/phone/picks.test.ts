// @vitest-environment happy-dom
/**
 * Quai 1.2.2, téléphone et Quai Web (PRD-1.2.2 § 4, CA-122.5) : sections « Gares » et « Bus, tram, métro » de
 * l'accueil, ajout d'une gare, ajout d'une ligne en deux temps, retrait confirmé, ordre, limites ; « Ouvrir d’office à
 * moins de 300 m » (revue d'usage n° 4) ; arrêts favoris de la 1.2.1 rangés, côté téléphone (CA-122.6). Lignes et
 * arrêts du faux cœur (findLines, lineStops) : des arrêts publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Core, LinePick, Settings, StationPick } from '../../src/core/api';
import { NEWS_SINCE, newsState } from '../../src/phone/app';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { addLineScreen, addStationScreen } from '../../src/phone/screens/pick-add';
import { moveById, resetKnownLines, withLine, withNear, withStation } from '../../src/phone/screens/picks';
import { LIMITS } from '../../src/settings';
import { button, defaults, harness, mount, plain, preset11, SCENARIO, textOf, type, until } from './helpers';

/** Limites des réglages (settings.ts) : les textes les disent. */
const MAX_STATIONS = LIMITS.stations;
const MAX_LINES = LIMITS.lines;
const FULL_STATIONS = `${MAX_STATIONS} gares au plus : retires-en une.`;
const FULL_LINES = `${MAX_LINES} lignes au plus : retires-en une.`;
const manyStations = (n: number): StationPick[] => Array.from({ length: n }, (_, i) => station(`g${i}`, `sncb:${i}`, `Gare ${i}`));
const manyLines = (n: number): LinePick[] => Array.from({ length: n }, (_, i) => line(`l${i}`, { line: String(i + 1), mode: 'tram' }));

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

/** Section de l'accueil par son titre. */
const section = (el: HTMLElement, title: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.home-picks')].find((s) => textOf(s.querySelector('h2')) === title)!;
const titles = (s: HTMLElement) => [...s.querySelectorAll('.pick-row .t1, .order-row .t1')].map((t) => textOf(t));
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
    expect(withLine(defaults({ lines: manyLines(MAX_LINES) }), { ...line(''), line: '99' })).toBe('full');
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
});

describe('sections « Gares » et « Bus, tram, métro » de l’accueil (§ 4)', () => {
  it('CA-122.6 : arrêts favoris de la 1.2.1 rangés ; sous « Mes favoris », avant « Réglages » ; « Mes favoris » sans arrêt, même ordre', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount(homeScreen(hz.ctx));
    expect([...el.querySelectorAll('h2')].map((x) => textOf(x))).toEqual(['Mes favoris', 'Gares', 'Bus, tram, métro', 'Réglages']);
    expect([...el.querySelectorAll('.fav-row .t1')].map((x) => textOf(x))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
    const gares = section(el, 'Gares');
    expect(titles(gares)).toEqual(['Namur']);
    const lignes = section(el, 'Bus, tram, métro');
    // tram 3 et tram 4 de Gare du Nord (le filtre de la 1.2.1), Bruxelles-Nord sans filtre : « toutes les lignes »
    await until(() => titles(lignes)[0] !== 'Ligne 3 · Gare du Nord' && textOf(lignes.querySelector('.pick-row:last-child .t2')) !== '');
    expect(titles(lignes)).toEqual(['Tram 3 · Gare du Nord', 'Tram 4 · Gare du Nord', 'Bruxelles-Nord · toutes les lignes']);
    expect(textOf(lignes.querySelector('.pick-row:last-child .t2'))).toBe('bus De Lijn');
    // l'ancien « Quand je suis à moins de 300 m » de Gare du Nord : « Ouvrir d’office à moins de 300 m » coché
    expect([...lignes.querySelectorAll<HTMLInputElement>('.pick-near input')].map((c) => c.checked)).toEqual([true, true, false]);
    expect([...gares.querySelectorAll<HTMLInputElement>('.pick-near input')].map((c) => c.checked)).toEqual([false]);
    expect(hz.settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
  });

  it('CA-122.6 : la bannière « Quai 1.2.2 » le dit une fois après la mise à jour du préréglage 1.1 migré', () => {
    const s = preset11();
    expect(s.seenVersion).toBe('1.1.0');
    const hz = harness({ settings: s });
    hz.ctx.news = newsState(s.seenVersion, NEWS_SINCE, '1.2.2');
    const el = mount(homeScreen(hz.ctx));
    expect(plain(el.querySelectorAll('.news p')[1]?.textContent)).toBe('Tes arrêts favoris y sont rangés, rien n’est perdu.');
    button(el, 'OK').click();
    expect(mount(homeScreen(hz.ctx)).querySelector('.news')).toBeNull();
  });

  it('vides : « Aucune gare pour l’instant. », « Aucune ligne pour l’instant. » ; « Ajouter une gare », « Ajouter une ligne »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(homeScreen(hz.ctx));
    const gares = section(el, 'Gares');
    const lignes = section(el, 'Bus, tram, métro');
    expect(textOf(gares.querySelector('.list'))).toBe('Aucune gare pour l’instant.');
    expect(textOf(lignes.querySelector('.list'))).toBe('Aucune ligne pour l’instant.');
    // « Changer l’ordre » seulement à partir de 2 éléments
    expect(button(gares, 'Changer l’ordre').hidden).toBe(true);
    button(gares, 'Ajouter une gare').click();
    button(lignes, 'Ajouter une ligne').click();
    expect(hz.went).toEqual(['#/gares/ajouter', '#/lignes/ajouter']);
  });

  it('retrait confirmé dans la page (S6) : « Retirer Namur de tes gares ? », « Annuler » garde, « Retirer » retire', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR, CENTRAL], lines: [line('l-3', { line: '3', mode: 'tram' }), line('l-4', { line: '4', mode: 'tram' })] }) });
    const el = mount(homeScreen(hz.ctx));
    const confirm = globalThis.confirm;
    globalThis.confirm = () => {
      throw new Error('boîte du système');
    };
    try {
      const gares = section(el, 'Gares');
      const trigger = gares.querySelector<HTMLButtonElement>('.pick-row .pick-main .btn')!;
      expect([textOf(trigger), trigger.getAttribute('aria-label')]).toEqual(['Retirer', 'Retirer Namur']);
      trigger.click();
      expect(gares.querySelector('.confirm-q')!.textContent).toBe('Retirer Namur de tes gares ?');
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
      // une ligne
      const lignes = section(el, 'Bus, tram, métro');
      [...lignes.querySelectorAll<HTMLButtonElement>('.pick-main .btn')][1].click();
      expect(plain(lignes.querySelector('.confirm-q')?.textContent)).toBe('Retirer Tram 4 · Gare du Nord de tes lignes ?');
      button(lignes.querySelector('.confirm')!, 'Retirer').click();
      await until(() => hz.settings.get().lines.length === 1);
      expect(hz.settings.get().lines.map((x) => x.id)).toEqual(['l-3']);
    } finally {
      globalThis.confirm = confirm;
    }
  });

  it('ordre : « Changer l’ordre », « Monter », « Descendre », « Terminé » ; l’ordre est enregistré, section par section', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR, CENTRAL, GAND], lines: [line('l-3', { line: '3', mode: 'tram' }), line('l-4', { line: '4', mode: 'tram' })] }) });
    const el = mount(homeScreen(hz.ctx));
    const gares = section(el, 'Gares');
    const ids = () => hz.settings.get().stations.map((x) => x.id);
    button(gares, 'Changer l’ordre').click();
    const rows = () => [...gares.querySelectorAll<HTMLElement>('.order-row')];
    expect(rows()).toHaveLength(3);
    expect(button(gares, 'Ajouter une gare').hidden).toBe(true);
    expect(gares.querySelector('.pick-near')).toBeNull();
    expect(rows()[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    expect([...rows()[2].querySelectorAll<HTMLButtonElement>('button')][1].disabled).toBe(true);
    // l'autre section ne change pas de mode
    expect(section(el, 'Bus, tram, métro').querySelectorAll('.order-row')).toHaveLength(0);
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
    // lignes
    const lignes = section(el, 'Bus, tram, métro');
    button(lignes, 'Changer l’ordre').click();
    button([...lignes.querySelectorAll<HTMLElement>('.order-row')][1], 'Monter').click();
    await until(() => plain(lignes.querySelector('.live')?.textContent) !== '');
    expect(hz.settings.get().lines.map((x) => x.id)).toEqual(['l-4', 'l-3']);
    expect(plain(lignes.querySelector('.live')?.textContent)).toBe('Tram 4 · Gare du Nord : 1er sur 2.');
  });

  it('limites (LIMITS de settings.ts) : « Ajouter » grisé, message clair', () => {
    const stations = manyStations(MAX_STATIONS);
    const lines = manyLines(MAX_LINES);
    const el = mount(homeScreen(harness({ settings: defaults({ stations, lines }) }).ctx));
    const gares = section(el, 'Gares');
    const lignes = section(el, 'Bus, tram, métro');
    expect(button(gares, 'Ajouter une gare').disabled).toBe(true);
    expect(textOf(gares)).toContain(FULL_STATIONS);
    expect(button(lignes, 'Ajouter une ligne').disabled).toBe(true);
    expect(textOf(lignes)).toContain(FULL_LINES);
    // une de moins : plus de message
    const el2 = mount(homeScreen(harness({ settings: defaults({ stations: stations.slice(1) }) }).ctx));
    expect(button(section(el2, 'Gares'), 'Ajouter une gare').disabled).toBe(false);
    expect(textOf(section(el2, 'Gares'))).not.toContain('au plus');
  });

  it('revue d’usage n° 4 : « Ouvrir d’office à moins de 300 m » sur chaque élément, décoché d’office ; near: true ou rien', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR], lines: [line('l-3', { line: '3', mode: 'tram' })] }) });
    const el = mount(homeScreen(hz.ctx));
    const box = section(el, 'Gares').querySelector<HTMLInputElement>('.pick-near input')!;
    expect(textOf(box.closest('label'))).toBe('Ouvrir d’office à moins de 300 m');
    expect(box.checked).toBe(false);
    // nommée par son texte, décrite par la gare (lecteurs d'écran)
    expect(textOf(document.getElementById(box.getAttribute('aria-describedby')!))).toBe('Namur');
    box.click();
    await until(() => hz.settings.get().stations[0].near === true);
    // la case garde le curseur (la liste n'est pas redessinée)
    expect(section(el, 'Gares').querySelector('.pick-near input')).toBe(box);
    box.click();
    await until(() => !('near' in hz.settings.get().stations[0]));
    section(el, 'Bus, tram, métro').querySelector<HTMLInputElement>('.pick-near input')!.click();
    await until(() => hz.settings.get().lines[0].near === true);
  });

  it('une gare gardée ailleurs (★ des départs dans les lunettes de Quai Web) paraît dans la section', async () => {
    const hz = harness({ settings: defaults({ stations: [NAMUR] }) });
    const el = mount(homeScreen(hz.ctx));
    await hz.settings.update((s: Settings) => ({ ...s, stations: [...s.stations, CENTRAL] }));
    expect(titles(section(el, 'Gares'))).toEqual(['Namur', 'Bruxelles-Central']);
  });
});

describe('« Ajouter une gare » (§ 4)', () => {
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

  it('sans texte, la position connue : les gares à moins de 2 km, la plus proche d’abord ; sans position : rien', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addStationScreen(hz.ctx));
    await until(() => opts(el.querySelector('.opts')).length > 0);
    expect(opts(el.querySelector('.opts')).map(([n]) => n)).toEqual(['Bruxelles-Central', 'Bruxelles-Luxembourg', 'Bruxelles-Schuman', 'Bruxelles-Nord', 'Bruxelles-Midi']);
    expect(textOf(el.querySelector('#gare-nom-etat'))).toBe('Les plus proches de ta position.');
    const none = mount(addStationScreen(harness({ settings: defaults(), here: null }).ctx));
    await new Promise((r) => setTimeout(r, 50));
    expect(none.querySelector<HTMLElement>('.opts')!.hidden).toBe(true);
    expect(textOf(none.querySelector('#gare-nom-etat'))).toBe('');
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
    for (const screen of [addStationScreen, addLineScreen]) {
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

describe('« Ajouter une ligne », en deux temps (§ 4)', () => {
  /** Tape le numéro et attend les lignes trouvées. */
  async function number(el: HTMLElement, q: string): Promise<void> {
    type(el.querySelector<HTMLInputElement>('#ligne-num')!, q);
    await until(() => opts(el.querySelector('.step:not([hidden]) .opts')).length > 0 || textOf(el.querySelector('#ligne-num-etat')) !== '');
  }
  const stopsList = (el: HTMLElement) => el.querySelectorAll('.step')[1].querySelector('.opts');

  it('1. « Numéro de la ligne » : « Bus W TEC, … ↔ Bruxelles Midi » ; 2. « À quel arrêt ? » le plus proche d’abord, filtre ; un toucher ajoute et confirme', async () => {
    const hz = harness({ settings: defaults(), here: BRAINE_GARE });
    const el = mount(addLineScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Ajouter une ligne');
    expect(textOf(el.querySelector('label[for="ligne-num"]'))).toBe('Numéro de la ligne');
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.placeholder).toBe('W, 36, 71…');
    await number(el, 'w');
    expect(opts(el.querySelector('.opts'))).toEqual([['Bus W TEC, Braine-l’Alleud Gare ↔ Bruxelles Midi', 'ici']]);
    el.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    // 2e temps : la ligne choisie, la question, les arrêts du plus proche au plus loin
    const [step1, step2] = [...el.querySelectorAll<HTMLElement>('.step')];
    expect(step1.hidden).toBe(true);
    expect(step2.hidden).toBe(false);
    expect(textOf(step2.querySelector('.chosen-line'))).toBe('Bus W TEC, Braine-l’Alleud Gare ↔ Bruxelles Midi');
    expect(textOf(step2.querySelector('h2'))).toBe('À quel arrêt ?');
    expect(document.activeElement).toBe(step2.querySelector('h2'));
    await until(() => opts(stopsList(el)).length > 0);
    expect(opts(stopsList(el))).toEqual([
      ['Braine-l’Alleud Gare', 'ici'],
      ['Braine-l’Alleud Merbraine', '1,2 km'],
      ['Waterloo Eglise', '4,2 km'],
      ['Bruxelles Midi', '17 km'],
    ]);
    // filtre
    type(step2.querySelector<HTMLInputElement>('#ligne-arret')!, 'merb');
    expect(opts(stopsList(el)).map(([n]) => n)).toEqual(['Braine-l’Alleud Merbraine']);
    type(step2.querySelector<HTMLInputElement>('#ligne-arret')!, 'zzz');
    expect(opts(stopsList(el))).toEqual([]);
    expect(textOf(step2.querySelector('#ligne-arret-etat'))).toBe('Aucun arrêt de cette ligne ne correspond.');
    type(step2.querySelector<HTMLInputElement>('#ligne-arret')!, 'merb');
    optButton(stopsList(el)!, 'Braine-l’Alleud Merbraine').click();
    await until(() => hz.settings.get().lines.length === 1);
    expect(hz.settings.get().lines[0]).toMatchObject({ areaId: 'tec:Bbrlmer1', op: 'tec', line: 'W', mode: 'bus', name: { fr: 'Braine-l’Alleud Merbraine' }, lat: 50.6833, lon: 4.3891 });
    expect(hz.settings.get().lines[0]).not.toHaveProperty('near');
    const msg = step2.querySelector('.msg')!;
    await until(() => textOf(msg) !== '');
    expect(msg.textContent).toBe('Bus W à Braine-l’Alleud Merbraine ajouté : les deux sens s’afficheront dans les lunettes.');
    expect(opts(stopsList(el))).toEqual([['Braine-l’Alleud Merbraine', 'déjà dans tes lignes']]);
    optButton(stopsList(el)!, 'Braine-l’Alleud Merbraine').click();
    await until(() => textOf(msg) === 'Déjà dans tes lignes.');
    expect(hz.settings.get().lines).toHaveLength(1);
    // « Ajouter une autre ligne » : le 1er temps, vidé ; « Terminé » : la section
    button(step2, 'Ajouter une autre ligne').click();
    expect(step1.hidden).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.value).toBe('');
    expect(opts(el.querySelector('.opts'))).toEqual([]);
    button(step2, 'Terminé').click();
    expect(hz.went).toEqual(['#/lignes']);
  });

  it('plusieurs lignes du même numéro, les plus proches d’abord ; « Changer de ligne » revient au 1er temps', async () => {
    const hz = harness({ settings: defaults(), here: { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } });
    const el = mount(addLineScreen(hz.ctx));
    await number(el, '1');
    expect(opts(el.querySelector('.opts'))).toEqual([
      ['Tram 1 De Lijn, Flanders Expo ↔ Korenmarkt', '50 km'],
      ['Bus 1 TEC, Jemappes', '52 km'],
    ]);
    [...el.querySelectorAll<HTMLButtonElement>('.opts .opt')][1].click();
    const step2 = el.querySelectorAll<HTMLElement>('.step')[1];
    button(step2, 'Changer de ligne').click();
    expect(el.querySelectorAll<HTMLElement>('.step')[0].hidden).toBe(false);
    expect(el.querySelector<HTMLInputElement>('#ligne-num')!.value).toBe('1');
    expect(document.activeElement?.id).toBe('ligne-num');
  });

  it('textes clairs : numéro inconnu (un train : « ajoute sa gare dans Gares »), recherche en panne, ligne sans arrêt', async () => {
    const el = mount(addLineScreen(harness({ settings: defaults(), here: null }).ctx));
    await number(el, 'IC');
    expect(textOf(el.querySelector('#ligne-num-etat'))).toBe('Aucune ligne de bus, tram ou métro ne porte ce numéro. Pour un train, ajoute sa gare dans Gares.');
    const down = harness({ settings: defaults(), here: null, core: (c: Core) => ({ ...c, findLines: async () => Promise.reject(new Error('réseau')) }) });
    const el2 = mount(addLineScreen(down.ctx));
    await number(el2, 'w');
    expect(textOf(el2.querySelector('#ligne-num-etat'))).toBe('Recherche impossible pour l’instant : réessaie dans un instant.');
    const empty = harness({ settings: defaults(), here: null, core: (c: Core) => ({ ...c, lineStops: async () => [] }) });
    const el3 = mount(addLineScreen(empty.ctx));
    await number(el3, 'w');
    el3.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => textOf(el3.querySelector('#ligne-arret-etat')) !== 'Chargement des arrêts…');
    expect(textOf(el3.querySelector('#ligne-arret-etat'))).toBe('Aucun arrêt trouvé pour cette ligne.');
    const broken = harness({ settings: defaults(), here: null, core: (c: Core) => ({ ...c, lineStops: async () => Promise.reject(new Error('réseau')) }) });
    const el4 = mount(addLineScreen(broken.ctx));
    await number(el4, 'w');
    el4.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => textOf(el4.querySelector('#ligne-arret-etat')) !== 'Chargement des arrêts…');
    expect(textOf(el4.querySelector('#ligne-arret-etat'))).toBe('Recherche impossible pour l’instant : réessaie dans un instant.');
  });

  it('limite des lignes : dite d’emblée, et rien n’est ajouté', async () => {
    const lines = manyLines(MAX_LINES);
    const hz = harness({ settings: defaults({ lines }), here: BRAINE_GARE });
    const el = mount(addLineScreen(hz.ctx));
    expect(textOf(el.querySelector('.step .msg.err'))).toBe(FULL_LINES);
    await number(el, 'w');
    el.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => opts(stopsList(el)).length > 0);
    optButton(stopsList(el)!, 'Braine-l’Alleud Merbraine').click();
    const msg = el.querySelectorAll('.step')[1].querySelector('.msg')!;
    await until(() => textOf(msg) !== '');
    expect(textOf(msg)).toBe(FULL_LINES);
    expect(hz.settings.get().lines).toHaveLength(MAX_LINES);
  });

  it('depuis « Un endroit » (?arret=…, revue d’usage n° 3) : les lignes de l’arrêt en raccourcis ; l’arrêt présélectionné en tête du 2e temps', async () => {
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
    await until(() => opts(stopsList(el)).length > 0);
    expect(opts(stopsList(el))[0]).toEqual(['Gare du Nord', 'arrêt choisi']);
    optButton(stopsList(el)!, 'Gare du Nord').click();
    await until(() => hz.settings.get().lines.length === 1);
    expect(hz.settings.get().lines[0]).toMatchObject({ areaId: 'stib:6357F', op: 'stib', line: '3', mode: 'tram' });
    await until(() => textOf(el.querySelectorAll('.step')[1].querySelector('.msg')) !== '');
    expect(textOf(el.querySelectorAll('.step')[1].querySelector('.msg'))).toBe('Tram 3 à Gare du Nord ajouté : les deux sens s’afficheront dans les lunettes.');
    // une ligne qui ne passe pas à cet arrêt : on le dit, ses arrêts restent proposés
    button(el, 'Ajouter une autre ligne').click();
    await number(el, 'w');
    el.querySelector<HTMLButtonElement>('.opts .opt')!.click();
    await until(() => opts(stopsList(el)).length > 0);
    expect(textOf(el.querySelector('#ligne-arret-etat'))).toBe('Cette ligne ne passe pas à Gare du Nord.');
  });
});
