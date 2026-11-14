// @vitest-environment happy-dom
/**
 * Affichage (T5, S3) : « À l’ouverture de Quai » et « Ordre des favoris » (libellés de la revue d'usage n° 11, mêmes
 * valeurs) ; aperçu : l'accueil des lunettes avec ses favoris, qui suit les réglages ; réglages v4 de l'exemple.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { textWidth } from '../../src/glasses/font';
import { geometry, layoutPage } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { PageSpec } from '../../src/glasses/types';
import { homePreview, sampleSettings } from '../../src/phone/samples';
import { displayScreen } from '../../src/phone/screens/display';
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

  it('libellés de la revue d’usage n° 11 : ouverture et ordre des favoris, sans « proposer » ni « lieu »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    const legends = [...el.querySelectorAll('legend')].map((l) => textOf(l));
    expect(legends).toContain('À l’ouverture de Quai');
    expect(legends).toContain('Ordre des favoris');
    const labels = [...el.querySelectorAll('label.choice')].map((l) => [l.querySelector('input')!.value, textOf(l)]);
    // 1.2.9 (PRD-1.2.9 § 2.4) : l'ordre des favoris, puis l'ouverture de Quai
    expect(labels).toEqual([
      ['smart', 'Automatique, selon l’heure et ta position'],
      ['mine', 'Dans mon ordre'],
      ['suggest', 'L’accueil, avec mes favoris en tête'],
      ['firstFavorite', 'Directement mon premier favori'],
      ['home', 'L’accueil, sans favoris'],
    ]);
    expect(textOf(el)).not.toMatch(/propos|le lieu/);
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
    expect([...groups[0].querySelectorAll('legend')].map((l) => textOf(l))).toEqual(['Rayon de « Autour de moi »', 'Ordre des favoris', 'À l’ouverture de Quai']);
    expect([...groups[0].querySelectorAll('.seg label')].map((l) => textOf(l))).toEqual(['300 m', '500 m', '800 m']);
    expect([...groups[1].querySelectorAll('.switch-row')].map((r) => [textOf(r.querySelector('.c1')), r.querySelector<HTMLInputElement>('input')!.checked])).toEqual([
      ['Aides de gestes', true],
      ['Signaler les horaires prévus', true],
      ['Pluie pendant la marche', true],
    ]);
    // un seul trait entre deux interrupteurs
    expect(groups[1].querySelectorAll('.box > .bordered')).toHaveLength(2);
    expect(groups[1].querySelector('.box > :first-child')!.classList.contains('bordered')).toBe(false);
  });

  it('chaque réglage est enregistré, et l’aperçu suit (rayon, aides de gestes, signe ~, ouverture)', async () => {
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
    [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === 'home')!.click();
    await until(() => hz.settings.get().display.opening === 'home');
    expect(hz.settings.get().display).toMatchObject({ radiusM: 800, gestureHints: false, markPlanned: false, rain: true, opening: 'home', favOrder: 'smart' });
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
    // l'aide des gestes prend la place de la ligne vide (PRD-1.2.6 § 1)
    const tail = ['Autour de moi | 3 arrêts', 'Gares de train | 1 gare', 'Arrêts de bus, tram, métro | 1 arrêt', 'Lignes de bus, tram, métro | 1 ligne'];
    const favs = ['Favoris | 3', 'Bureau | dans 4 min → 09:00', 'Vers Mons | dans 14 min → 09:04', 'Vers Gand-Saint-Pierre | 08:58 → 09:30'];
    expect(lines(homePreview(defaults()))).toEqual([...favs, ...tail]);
    expect(lines(homePreview(defaults({ display: { ...defaults().display, gestureHints: false } })))).toEqual([...favs, '', ...tail]);
  });

  it('aperçu : selon l’ouverture, l’ordre et le rayon (T5, PRD-1.2.1 § 4)', () => {
    const d = defaults().display;
    /** Favoris montrés sous « Favoris » (une ligne chacun) et ligne « Autour de moi ». */
    const favs = (v: ReturnType<typeof homePreview>) => v.items.filter((i) => i.action?.kind === 'openFavorite').map((i) => lines({ ...v, items: [i] })[0]);
    const around = (v: ReturnType<typeof homePreview>) => lines(v).find((l) => l.startsWith('Autour de moi'));
    const v = homePreview(defaults());
    expect(lines(v)[0]).toBe('Favoris | 3');
    expect(favs(v)).toEqual(['Bureau | dans 4 min → 09:00', 'Vers Mons | dans 14 min → 09:04', 'Vers Gand-Saint-Pierre | 08:58 → 09:30']);
    expect(around(v)).toBe('Autour de moi | 3 arrêts');
    // « Dans mon ordre » : l'ordre du téléphone, le trajet vers Gand en tête
    expect(favs(homePreview(defaults({ display: { ...d, favOrder: 'mine' } })))).toEqual(['Vers Gand-Saint-Pierre | 08:58 → 09:30', 'Bureau | dans 4 min → 09:00', 'Vers Mons | dans 14 min → 09:04']);
    // « L’accueil, sans favoris », rayon de 800 m : « Favoris » sans favori dessous, 4 arrêts ; 300 m : 2 arrêts
    const bare = homePreview(defaults({ display: { ...d, opening: 'home', radiusM: 800 } }));
    expect(lines(bare)[0]).toBe('Favoris | 3');
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
    expect(label).toBe('Aperçu dans les lunettes : Quai, Favoris 3, Bureau dans 4 min → 09:00, Vers Mons dans 14 min → 09:04, Vers Gand-Saint-Pierre 08:58 → 09:30, Autour de moi 3 arrêts, Gares de train 1 gare, Arrêts de bus, tram, métro 1 arrêt, Lignes de bus, tram, métro 1 ligne');
  });
});
