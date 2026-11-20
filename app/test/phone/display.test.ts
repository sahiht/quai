// @vitest-environment happy-dom
/**
 * Affichage (T5, S3) : « À l’ouverture de Quai » et « Ordre des favoris » (libellés de la revue d'usage n° 11, mêmes
 * valeurs) ; aperçu : l'accueil des lunettes avec ses favoris, qui suit les réglages ; réglages v4 de l'exemple.
 * 1.2.10 (PRD-1.2.10 § 4.4) : sur un seul écran : « Ordre des favoris » en deux choix côte à côte, l'ouverture sur son
 * écran (#/affichage/ouverture), qui revient à Affichage (et, depuis l'accueil, à l'Affichage de l'accueil).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { textWidth } from '../../src/glasses/font';
import { geometry, layoutPage } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { PageSpec } from '../../src/glasses/types';
import { homePreview, sampleSettings } from '../../src/phone/samples';
import { displayScreen, openingScreen } from '../../src/phone/screens/display';
import { defaults, harness, mount, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/**
 * Lignes plus larges que leur conteneur, ou conteneurs trop bas pour leurs lignes (27 px), comme test/ui/helpers.ts ;
 * un conteneur vide (pied de hauteur nulle sans aide des gestes, revue d'usage n° 1) n'a pas de ligne.
 */
function overflowing(page: PageSpec): string[] {
  return page.containers.flatMap((c) => {
    if (!c.content.trim()) return [];
    const rows = c.content.split('\n');
    const wide = rows.filter((l) => textWidth(l) > c.w).map((l) => `${c.name} : « ${l} » ${textWidth(l)} px > ${c.w} px`);
    return rows.length * 27 > c.h ? [...wide, `${c.name} : ${rows.length} lignes pour ${c.h} px`] : wide;
  });
}

/**
 * Lignes de l'aperçu (1.2.1) : colonnes a et b, réponse d'un favori alignée à droite (bRight), colonne c, seconde
 * ligne ; une ligne vide avant un élément « gap » (entre les favoris et « Autour de moi »).
 */
const lines = (v: ReturnType<typeof homePreview>) =>
  v.items.flatMap((i) => {
    // 1.2.6 : une rubrique dit son mot clé et sa précision (segs)
    const title = i.a || (i.segs ?? []).map((g) => g.t).join(' ');
    const text = [title, i.b, i.bRight ? `${i.bRight}${i.bRightTail ?? ''}` : '', i.c, i.b2].filter(Boolean).join(' | ').replace(/\u00a0/g, ' ');
    return i.gap ? ['', text] : [text];
  });

describe('Affichage', () => {
  it('CA-123.1 : plus de « Départs par arrêt » (tableaux de 2 heures) ; la valeur enregistrée reste, sans effet', async () => {
    const hz = harness({ settings: defaults({ display: { ...defaults().display, depsPerStop: 6 } }) });
    const el = mount(displayScreen(hz.ctx));
    expect(textOf(el)).not.toMatch(/Départs par arrêt|départs? de (plus|moins)/i);
    expect(el.querySelector('.stepper-row')).toBeNull();
    // le premier réglage de la boîte, le rayon, n'a plus de trait au-dessus de lui
    const box = el.querySelector('.box')!;
    expect(box.firstElementChild!.classList.contains('bordered')).toBe(false);
    expect(textOf(box.firstElementChild!.querySelector('legend'))).toBe('Rayon de « Autour de moi »');
    // un autre réglage enregistré : depsPerStop n'est ni effacé ni changé
    [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Dans mon ordre')!.click();
    await until(() => hz.settings.get().display.favOrder === 'mine');
    expect(hz.settings.get().display.depsPerStop).toBe(6);
  });

  it('libellés de la revue d’usage n° 11 : ordre des favoris, ouverture sur son écran, sans « proposer » ni « lieu »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    expect([...el.querySelectorAll('legend')].map((l) => textOf(l))).toEqual(['Rayon de « Autour de moi »', 'Ordre des favoris']);
    // 1.2.10 : deux choix côte à côte ; le premier, abrégé, garde son nom complet pour les lecteurs d'écran
    const order = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((r) => r.name === el.querySelector<HTMLInputElement>('input[value="mine"]')!.name);
    expect(order.map((r) => [r.value, textOf(r.closest('label')), r.getAttribute('aria-label')])).toEqual([
      ['smart', 'Automatique', 'Automatique, selon l’heure et ta position'],
      ['mine', 'Dans mon ordre', null],
    ]);
    expect(el.querySelector('label.choice')).toBeNull();
    // l'ouverture : une ligne (un vrai lien) qui ouvre son écran, sa valeur dessous
    const row = el.querySelector<HTMLAnchorElement>('.opening-link a.nav-row')!;
    expect([textOf(row.querySelector('.t1')), textOf(row.querySelector('.t2')), row.getAttribute('href')]).toEqual(['À l’ouverture de Quai', 'L’accueil, avec mes favoris en tête', '#/affichage/ouverture']);
    const opening = mount(openingScreen(harness({ settings: defaults() }).ctx));
    expect([...opening.querySelectorAll('label.choice')].map((l) => [l.querySelector('input')!.value, textOf(l)])).toEqual([
      ['suggest', 'L’accueil, avec mes favoris en tête'],
      ['firstFavorite', 'Directement mon premier favori'],
      ['home', 'L’accueil, sans favoris'],
    ]);
    expect(textOf(el) + textOf(opening)).not.toMatch(/propos|le lieu/);
  });

  it('1.2.9 (PRD-1.2.9 § 2.4) : retour « Réglages », l’aperçu en haut, groupes « Accueil des lunettes » et « Sur tous les écrans »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Affichage');
    const back = el.querySelector<HTMLButtonElement>('.back')!;
    expect(textOf(back)).toBe('Réglages');
    back.click();
    expect(hz.went).toEqual(['#/reglages']);
    const groups = [...el.querySelectorAll<HTMLElement>('section.group')];
    expect(groups.map((g) => textOf(g.querySelector('h2')))).toEqual(['Accueil des lunettes', 'Sur tous les écrans']);
    for (const g of groups) expect(g.getAttribute('aria-labelledby')).toBe(g.querySelector('h2')!.id);
    // l'aperçu avant les groupes
    const preview = el.querySelector('.preview')!;
    expect(preview.compareDocumentPosition(groups[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...groups[0].querySelectorAll('legend')].map((l) => textOf(l))).toEqual(['Rayon de « Autour de moi »', 'Ordre des favoris']);
    expect([...groups[0].querySelectorAll('.seg label')].map((l) => textOf(l))).toEqual(['300 m', '500 m', '800 m', 'Automatique', 'Dans mon ordre']);
    expect(textOf(groups[0].querySelector('.opening-link .t1'))).toBe('À l’ouverture de Quai');
    expect([...groups[1].querySelectorAll('.switch-row')].map((r) => [textOf(r.querySelector('.c1')), r.querySelector<HTMLInputElement>('input')!.checked])).toEqual([
      ['Aides de gestes', true],
      ['Signaler les horaires prévus', true],
      ['Pluie pendant la marche', true],
    ]);
    // un seul trait entre deux interrupteurs
    expect(groups[1].querySelectorAll('.box > .bordered')).toHaveLength(2);
    expect(groups[1].querySelector('.box > :first-child')!.classList.contains('bordered')).toBe(false);
  });

  it('chaque réglage est enregistré, et l’aperçu suit (rayon, aides de gestes, signe ~, ordre)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    const label = () => el.querySelector('.preview')!.getAttribute('aria-label')!.replace(/ /g, ' ');
    expect(label()).toContain('Autour de moi 3 arrêts');
    [...el.querySelectorAll<HTMLInputElement>('.seg input')].find((r) => r.value === '800')!.click();
    await until(() => hz.settings.get().display.radiusM === 800 && label().includes('Autour de moi 4 arrêts'));
    const sw = (name: string) => [...el.querySelectorAll<HTMLInputElement>('input.switch')].find((c) => textOf(c.closest('label')).startsWith(name))!;
    sw('Aides de gestes').click();
    await until(() => hz.settings.get().display.gestureHints === false);
    sw('Signaler les horaires prévus').click();
    await until(() => hz.settings.get().display.markPlanned === false);
    el.querySelector<HTMLInputElement>('input[value="mine"]')!.click();
    await until(() => hz.settings.get().display.favOrder === 'mine' && label().includes('Favoris 3, Vers Gand-Saint-Pierre'));
    expect(hz.settings.get().display).toMatchObject({ radiusM: 800, gestureHints: false, markPlanned: false, rain: true, opening: 'suggest', favOrder: 'mine' });
  });

  it('« Dans mon ordre » est enregistré (S3)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    const mine = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Dans mon ordre')!;
    mine.click();
    await until(() => hz.settings.get().display.favOrder === 'mine');
  });

  it('exemple en réglages v4 : favoris (endroits et trajets), une gare, un arrêt et une ligne suivie ; aucun arrêt favori', () => {
    const s = sampleSettings(defaults());
    expect(s.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['trip:ex-gand', 'place:ex-bureau', 'trip:ex-mons']);
    expect(s.stations.map((x) => [x.id, x.areaId])).toEqual([['ex-namur', 'sncb:8863008']]);
    expect(s.lines.map((x) => [x.id, x.areaId, x.line, x.mode])).toEqual([['ex-gdn', 'stib:6357F', undefined, undefined]]);
    expect(s.follows?.map((x) => [x.id, x.op, x.line, x.mode])).toEqual([['ex-t3', 'stib', '3', 'tram']]);
  });

  it('aperçu : l’accueil 1.2.2 (PRD-1.2.2 § 1.1), 3 favoris, puis les trois rubriques (1.2.6) et leur nombre à droite', () => {
    // l'aide des gestes prend la place de la ligne vide (PRD-1.2.6 § 1) ; 1.3.1 (PRD-1.3.1 § 8) : l'aperçu est l'accueil
    // des lunettes : « Autour de moi » en tête, « Favoris » et ses favoris, puis les rubriques, « Lignes » avant « Arrêts » ;
    // le bureau (voie modifiée dans l'exemple) porte son « ! » (B15)
    const head = ['Autour de moi | 3 arrêts'];
    const tail = ['Gares de train | 1 gare', 'Lignes de bus, tram, métro | 1 ligne', 'Arrêts de bus, tram, métro | 1 arrêt'];
    const favs = ['Favoris | 3', 'Bureau ! | dans 4 min → 09:00', 'Vers Mons | dans 14 min → 09:04', 'Vers Gand-Saint-Pierre | 08:58 → 09:30'];
    expect(lines(homePreview(defaults()))).toEqual([...head, ...favs, ...tail]);
    expect(lines(homePreview(defaults({ display: { ...defaults().display, gestureHints: false } })))).toEqual([...head, ...favs, '', ...tail]);
  });

  it('aperçu : selon l’ouverture, l’ordre et le rayon (T5, PRD-1.2.1 § 4)', () => {
    const d = defaults().display;
    /** Favoris montrés sous « Favoris » (une ligne chacun) et ligne « Autour de moi ». */
    const favs = (v: ReturnType<typeof homePreview>) => v.items.filter((i) => i.action?.kind === 'openFavorite').map((i) => lines({ ...v, items: [i] })[0]);
    const around = (v: ReturnType<typeof homePreview>) => lines(v).find((l) => l.startsWith('Autour de moi'));
    const v = homePreview(defaults());
    // 1.3.1 (PRD-1.3.1 § 8) : « Autour de moi » en tête, « Favoris » dessous ; le « ! » du bureau (B15)
    expect(lines(v).slice(0, 2)).toEqual(['Autour de moi | 3 arrêts', 'Favoris | 3']);
    expect(favs(v)).toEqual(['Bureau ! | dans 4 min → 09:00', 'Vers Mons | dans 14 min → 09:04', 'Vers Gand-Saint-Pierre | 08:58 → 09:30']);
    expect(around(v)).toBe('Autour de moi | 3 arrêts');
    // « Dans mon ordre » : l'ordre du téléphone, le trajet vers Gand en tête
    expect(favs(homePreview(defaults({ display: { ...d, favOrder: 'mine' } })))).toEqual(['Vers Gand-Saint-Pierre | 08:58 → 09:30', 'Bureau ! | dans 4 min → 09:00', 'Vers Mons | dans 14 min → 09:04']);
    // « L’accueil, sans favoris », rayon de 800 m : « Favoris » sans favori dessous, 4 arrêts ; 300 m : 2 arrêts
    const bare = homePreview(defaults({ display: { ...d, opening: 'home', radiusM: 800 } }));
    expect(lines(bare)[1]).toBe('Favoris | 3');
    expect(favs(bare)).toEqual([]);
    expect(around(bare)).toBe('Autour de moi | 4 arrêts');
    expect(around(homePreview(defaults({ display: { ...d, radiusM: 300 } })))).toBe('Autour de moi | 2 arrêts');
  });

  it('aperçu dans l’écran : les 3 favoris tiennent dans les lunettes, sans débordement ; le lecteur d’écran lit leurs réponses', () => {
    for (const gestureHints of [true, false]) {
      const v = homePreview(defaults({ display: { ...defaults().display, gestureHints } }));
      const page = layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, geometry(v).capacity));
      expect(v.items.filter((i) => i.action?.kind === 'openFavorite'), `aides ${gestureHints}`).toHaveLength(3);
      expect(overflowing(page), `aides ${gestureHints}`).toEqual([]);
    }
    const el = mount(displayScreen(harness({ settings: defaults() }).ctx));
    const label = el.querySelector('.preview')!.getAttribute('aria-label')!.replace(/\u00a0/g, ' ');
    // 1.3.1 (PRD-1.3.1 § 8, B15) : l'ordre des lunettes, le « ! » du bureau
    expect(label).toBe('Aperçu dans les lunettes : Quai, Autour de moi 3 arrêts, Favoris 3, Bureau ! dans 4 min → 09:00, Vers Mons dans 14 min → 09:04, Vers Gand-Saint-Pierre 08:58 → 09:30, Gares de train 1 gare, Lignes de bus, tram, métro 1 ligne, Arrêts de bus, tram, métro 1 arrêt');
  });
});

describe('1.2.10 : Affichage sur un seul écran, l’ouverture sur son écran (PRD-1.2.10 § 4.4)', () => {
  it('« À l’ouverture de Quai » : retour « Affichage », phrase, l’aperçu, trois choix (légende pour les lecteurs d’écran) enregistrés tout de suite ; l’aperçu suit', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(openingScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('À l’ouverture de Quai');
    expect(textOf(el.querySelector('.lead'))).toBe('Ce que les lunettes montrent en premier.');
    const legend = el.querySelector('legend')!;
    expect([textOf(legend), legend.className]).toEqual(['À l’ouverture de Quai', 'sr-only']);
    const label = () => el.querySelector('.preview')!.getAttribute('aria-label')!.replace(/ /g, ' ');
    // 1.3.1 (PRD-1.3.1 § 8) : « Autour de moi » en tête de l'accueil des lunettes
    expect(label()).toMatch(/^Aperçu dans les lunettes : Quai, Autour de moi 3 arrêts, Favoris 3, Bureau /);
    expect(el.querySelector<HTMLInputElement>('input[value="suggest"]')!.checked).toBe(true);
    el.querySelector<HTMLInputElement>('input[value="home"]')!.click();
    // « L’accueil, sans favoris » : plus aucun favori sous « Favoris » dans l'aperçu
    await until(() => hz.settings.get().display.opening === 'home' && /Favoris 3, Gares de train/.test(label()));
    el.querySelector<HTMLInputElement>('input[value="firstFavorite"]')!.click();
    await until(() => hz.settings.get().display.opening === 'firstFavorite');
    // retour à Affichage, qui montre la valeur choisie
    const back = el.querySelector<HTMLButtonElement>('.back')!;
    expect(textOf(back)).toBe('Affichage');
    back.click();
    expect(hz.went).toEqual(['#/affichage']);
    const display = mount(displayScreen(hz.ctx));
    expect(textOf(display.querySelector('.opening-link .t2'))).toBe('Directement mon premier favori');
  });

  it('ouvert depuis l’accueil (?retour=accueil) : Affichage → ouverture → Affichage → accueil, sans perdre le chemin du retour', () => {
    const hz = harness({ settings: defaults(), params: 'retour=accueil' });
    const display = mount(displayScreen(hz.ctx));
    expect(display.querySelector('.opening-link a')!.getAttribute('href')).toBe('#/affichage/ouverture?retour=accueil');
    const opening = mount(openingScreen(hz.ctx));
    opening.querySelector<HTMLButtonElement>('.back')!.click();
    expect(hz.went).toEqual(['#/affichage?retour=accueil']);
    const again = mount(displayScreen(hz.ctx));
    expect(textOf(again.querySelector('.back'))).toBe('Accueil');
  });

  it('tient dans 390 × 844 (calcul des sections, hauteurs mesurées dans Chrome) : rien de plus que l’en-tête, l’aperçu, deux choix segmentés, une ligne et trois interrupteurs', () => {
    const el = mount(displayScreen(harness({ settings: defaults() }).ctx));
    // les blocs de l'écran, dans l'ordre : en-tête, aperçu sans titre écrit, deux groupes
    expect([...el.children].map((c) => c.tagName.toLowerCase() + (c.className ? `.${c.className.split(' ')[0]}` : ''))).toEqual(['header.head', 'div.preview-top', 'section.group', 'section.group']);
    expect(el.querySelector('header .lead')).toBeNull();
    expect(el.querySelector('.preview-wrap .label')).toBeNull();
    const [home, all] = [...el.querySelectorAll<HTMLElement>('section.group')];
    expect([...home.querySelectorAll('.box > *')].map((c) => c.className)).toEqual(['pad-row', 'pad-row bordered', 'list bordered opening-link']);
    expect(home.querySelectorAll('.seg')).toHaveLength(2);
    expect(all.querySelectorAll('.switch-row')).toHaveLength(3);
    // sous-titres des interrupteurs : deux sur une ligne (36 caractères au plus à 13 px), la pluie sur deux
    const subs = [...all.querySelectorAll('.switch-row .c2')].map((c) => plainText(c));
    expect(subs.map((t) => t.length <= 36)).toEqual([true, true, false]);
    // hauteurs (px) mesurées à 390 × 844 dans Chrome (Inter) : marges de la page 24 + 32, espaces de 12, en-tête 80,
    // aperçu 175 (350 × 175), titre de groupe 18 + 6, choix segmenté 96, ligne de l'ouverture 57, interrupteur 56 (69
    // sur deux lignes), traits de 1 px
    const groupHome = 18 + 6 + (96 + 1 + 96 + 1 + 57 + 2);
    const groupAll = 18 + 6 + (56 + 1 + 56 + 1 + 68 + 2);
    const total = 24 + 80 + 12 + 175 + 12 + groupHome + 12 + groupAll + 32;
    expect(total).toBeLessThanOrEqual(844 - 10);
  });
});

/** Texte d'un élément, espaces insécables compris comme des espaces. */
function plainText(el: Element): string {
  return (el.textContent ?? '').replace(/ /g, ' ');
}
