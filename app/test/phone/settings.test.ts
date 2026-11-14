// @vitest-environment happy-dom
/**
 * Réglages (#/reglages, 1.2.9, PRD-1.2.9 § 2.3) : retour « Accueil », « Dans les lunettes » (Affichage, Alertes, leurs
 * résumés selon les réglages), « Tes trajets » (« Marche maximale » et « Marge avant de partir » réglables sur place,
 * les pas-à-pas de l'écran Trajets, puis « Position et langue »), « Quai » (Données), les sources en bas. Affichage,
 * Alertes, Données, Position et langue et Trajets reviennent à Réglages ; les favoris, à l'accueil.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { alertsScreen } from '../../src/phone/screens/alerts';
import { dataScreen } from '../../src/phone/screens/data';
import { displayScreen } from '../../src/phone/screens/display';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { onboardingScreen } from '../../src/phone/screens/onboarding';
import { settingsScreen } from '../../src/phone/screens/settings';
import { tripsScreen } from '../../src/phone/screens/trips';
import { alertsSummary, displaySummary } from '../../src/phone/text';
import { LIMITS } from '../../src/settings';
import { button, defaults, harness, mount, plain, SCENARIO, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/** Lignes de Réglages : [titre, sous-titre, ancre]. */
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLAnchorElement>('a.nav-row')].map((a) => [textOf(a.querySelector('.t1')), textOf(a.querySelector('.t2')), a.getAttribute('href')]);
const steppers = (el: HTMLElement) => [...el.querySelectorAll('.stepper-row')].map((r) => [textOf(r.querySelector('.c1')), textOf(r.querySelector('.c2')), textOf(r.querySelector('output'))]);

describe('écran Réglages', () => {
  it('retour « Accueil », titre, phrase ; groupes « Dans les lunettes », « Tes trajets », « Quai » ; les sources en bas', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(settingsScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Réglages');
    expect(textOf(el.querySelector('.lead'))).toBe('Favoris, gares, arrêts et lignes se règlent sur l’accueil, dans l’ordre des lunettes.');
    const groups = [...el.querySelectorAll<HTMLElement>('section.group')];
    expect(groups.map((g) => textOf(g.querySelector('h2')))).toEqual(['Dans les lunettes', 'Tes trajets', 'Quai']);
    for (const g of groups) expect(g.getAttribute('aria-labelledby')).toBe(g.querySelector('h2')!.id);
    expect(rows(el)).toEqual([
      ['Affichage', 'Rayon 500 m, horaires prévus « ~ », pluie pendant la marche', '#/affichage'],
      ['Alertes', 'Voie, retard dès 5 min, suppression, départ à pied', '#/alertes'],
      ['Position et langue', 'Noms en français', '#/bienvenue'],
      ['Données', 'Tout est à jour', '#/donnees'],
    ]);
    // « Mes favoris » n'est plus dans les réglages (la ligne « Favoris » de l'accueil y mène)
    expect(textOf(el)).not.toMatch(/Mes favoris/);
    expect(el.querySelector('a[href^="#/favoris"]')).toBeNull();
    // en bas : les sources (elles restent aussi dans Données)
    const foot = el.querySelector('.foot')!;
    expect(foot.textContent).toBe('Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company');
    expect(el.lastElementChild).toBe(foot);
    // retour à l'accueil
    const back = el.querySelector<HTMLButtonElement>('.back')!;
    expect(textOf(back)).toBe('Accueil');
    back.click();
    expect(hz.went).toEqual(['#/']);
  });

  it('« Tes trajets » : les deux pas-à-pas de l’écran Trajets, réglables sur place (mêmes bornes, pas et textes), puis « Position et langue »', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(settingsScreen(hz.ctx));
    const trips = [...el.querySelectorAll<HTMLElement>('section.group')][1];
    expect(steppers(trips)).toEqual([
      ['Marche maximale', 'D’abord les trajets dans cette limite ; au-delà, s’il n’y a pas mieux', '10 min'],
      ['Marge avant de partir', 'comprise dans l’heure de départ conseillée', '2 min'],
    ]);
    // le même code que l'écran Trajets (#/trajets reste valable)
    const old = mount(tripsScreen(harness({ settings: defaults() }).ctx));
    expect(steppers(old)).toEqual(steppers(trips));
    const names = (root: ParentNode) => [...root.querySelectorAll('.stepper button')].map((b) => b.getAttribute('aria-label'));
    expect(names(old)).toEqual(names(trips));
    mount(el);
    // « Position et langue » après les pas-à-pas, dans la même carte
    expect(textOf(trips.querySelector('.box > ul .t1'))).toBe('Position et langue');
    trips.querySelector<HTMLButtonElement>('[aria-label="Augmenter la marche maximale"]')!.click();
    await until(() => hz.settings.get().maxWalkMin === 11);
    expect(textOf(trips.querySelector('output'))).toBe('11 min');
    trips.querySelector<HTMLButtonElement>('[aria-label="Marge plus courte"]')!.click();
    await until(() => hz.settings.get().alerts.leaveBeforeMin === 1);
    expect(hz.settings.get().alerts.leave).toBe(true);
  });

  it('pas-à-pas aux bornes (LIMITS de settings.ts) : « + » grisé au maximum, « − » au minimum', () => {
    const s = defaults({ maxWalkMin: LIMITS.maxWalkMin[1], alerts: { ...defaults().alerts, leaveBeforeMin: LIMITS.leaveBeforeMin[0] } });
    const el = mount(settingsScreen(harness({ settings: s }).ctx));
    const b = (label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    expect([b('Augmenter la marche maximale').disabled, b('Réduire la marche maximale').disabled]).toEqual([true, false]);
    expect([b('Marge plus courte').disabled, b('Marge plus longue').disabled]).toEqual([true, false]);
    expect(steppers(el).map(([, , v]) => v)).toEqual([`${LIMITS.maxWalkMin[1]} min`, `${LIMITS.leaveBeforeMin[0]} min`]);
  });

  it('résumés selon les réglages : rayon, signe « ~ », pluie ; alertes et seuil du retard ; langue des noms', () => {
    const d = defaults().display;
    expect(plain(displaySummary({ ...d, radiusM: 300, markPlanned: false }))).toBe('Rayon 300 m, pluie pendant la marche');
    expect(plain(displaySummary({ ...d, rain: false }))).toBe('Rayon 500 m, horaires prévus « ~ »');
    expect(displaySummary({ ...d, radiusM: 800, markPlanned: false, rain: false })).toBe('Rayon 800 m');
    // guillemets français, espaces insécables
    expect(displaySummary(d)).toContain('« ~ »');
    const a = defaults().alerts;
    expect(plain(alertsSummary({ ...a, delayMin: 10, works: true }))).toBe('Voie, retard dès 10 min, suppression, départ à pied, travaux');
    expect(plain(alertsSummary({ ...a, platform: false, delay: false }))).toBe('Suppression, départ à pied');
    expect(alertsSummary({ ...a, platform: false, delay: false, cancel: false, leave: false, works: false })).toBe('Aucune alerte');
    const el = mount(settingsScreen(harness({ settings: defaults({ lang: 'nl', display: { ...d, markPlanned: false }, alerts: { ...a, delayMin: 15 } }) }).ctx));
    expect(rows(el).map(([t, sub]) => [t, sub])).toEqual([
      ['Affichage', 'Rayon 500 m, pluie pendant la marche'],
      ['Alertes', 'Voie, retard dès 15 min, suppression, départ à pied'],
      ['Position et langue', 'Noms en néerlandais'],
      ['Données', 'Tout est à jour'],
    ]);
  });

  it('« Données » : « Temps réel indisponible, horaires prévus » pendant une panne, sinon « Tout est à jour » (M8)', async () => {
    const data = (el: HTMLElement) => rows(el).find(([t]) => t === 'Données')![1];
    const down = harness({ settings: defaults(), now: SCENARIO.s2.now, here: SCENARIO.s2, flags: { noRt: true } });
    await down.core.init();
    await down.core.board('sncb:8812005');
    expect(data(mount(settingsScreen(down.ctx)))).toBe('Temps réel indisponible, horaires prévus');
    const ok = harness({ settings: defaults(), now: SCENARIO.s2.now, here: SCENARIO.s2 });
    await ok.core.init();
    await ok.core.board('sncb:8812005');
    expect(data(mount(settingsScreen(ok.ctx)))).toBe('Tout est à jour');
    const off = harness({ settings: defaults() });
    off.ctx.configured = false;
    expect(data(mount(settingsScreen(off.ctx)))).toBe('Appli non configurée');
  });

  it('vrais liens, cibles de 44 px (classes des lignes), icônes décoratives', () => {
    const el = mount(settingsScreen(harness({ settings: defaults() }).ctx));
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a.nav-row')) {
      expect(a.classList.contains('row')).toBe(true);
      for (const svg of a.querySelectorAll('svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    for (const b of el.querySelectorAll('.stepper button')) expect(b.tagName).toBe('BUTTON');
  });
});

describe('retours vers Réglages (PRD-1.2.9 § 2.3) ; les favoris reviennent à l’accueil', () => {
  it('Affichage, Alertes, Données, Position et langue et Trajets : « Réglages » mène à #/reglages', () => {
    const screens = { Affichage: displayScreen, Alertes: alertsScreen, Données: dataScreen, 'Position et langue': onboardingScreen, Trajets: tripsScreen };
    for (const [title, screen] of Object.entries(screens)) {
      const hz = harness({ settings: defaults() });
      const el = mount(screen(hz.ctx));
      expect(textOf(el.querySelector('h1')), title).toBe(title);
      const back = el.querySelector<HTMLButtonElement>('.back')!;
      expect(textOf(back), title).toBe('Réglages');
      back.click();
      expect(hz.went, title).toEqual(['#/reglages']);
    }
  });

  it('« Position et langue » : « Enregistrer » revient à Réglages ; au premier lancement, « Continuer » mène toujours à « Tes favoris »', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(onboardingScreen(hz.ctx));
    button(el, 'Enregistrer').click();
    await until(() => hz.went.length > 0);
    expect(hz.went).toEqual(['#/reglages']);
    const first = harness({ settings: { ...defaults(), onboarded: false } });
    const welcome = mount(onboardingScreen(first.ctx));
    expect(welcome.querySelector('.back')).toBeNull();
    button(welcome, 'Continuer').click();
    await until(() => first.went.length > 0);
    expect(first.went).toEqual(['#/bienvenue/favoris']);
  });

  it('« Mes favoris » revient toujours à l’accueil', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(favoritesScreen(hz.ctx));
    const back = el.querySelector<HTMLButtonElement>('.back')!;
    expect(textOf(back)).toBe('Accueil');
    back.click();
    expect(hz.went).toEqual(['#/']);
  });
});
