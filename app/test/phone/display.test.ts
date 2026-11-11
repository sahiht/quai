// @vitest-environment happy-dom
/**
 * Affichage (T5, S3) : « À l’ouverture de Quai » et « Ordre des favoris » ; aperçu : l'accueil des lunettes avec ses
 * favoris, qui suit les réglages.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { textWidth } from '../../src/glasses/font';
import { geometry, layoutPage } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { PageSpec } from '../../src/glasses/types';
import { homePreview } from '../../src/phone/samples';
import { displayScreen } from '../../src/phone/screens/display';
import { defaults, harness, mount, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/** Lignes plus larges que leur conteneur, ou conteneurs trop bas pour leurs lignes (27 px), comme test/ui/helpers.ts. */
function overflowing(page: PageSpec): string[] {
  return page.containers.flatMap((c) => {
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
    const text = [i.a, i.b, i.bRight ? `${i.bRight}${i.bRightTail ?? ''}` : '', i.c, i.b2].filter(Boolean).join(' | ').replace(/\u00a0/g, ' ');
    return i.gap ? ['', text] : [text];
  });

describe('Affichage', () => {
  it('textes du PRD : ouverture et ordre des favoris', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    const legends = [...el.querySelectorAll('legend')].map((l) => textOf(l));
    expect(legends).toContain('À l’ouverture de Quai');
    expect(legends).toContain('Ordre des favoris');
    const labels = [...el.querySelectorAll('label.choice')].map((l) => textOf(l));
    expect(labels).toEqual(expect.arrayContaining(['Mes favoris en tête, selon l’heure et le lieu', 'Toujours ouvrir le favori en tête', 'Accueil sans favoris', 'Selon l’heure et le lieu', 'Dans mon ordre']));
  });

  it('« Dans mon ordre » est enregistré (S3)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    const mine = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Dans mon ordre')!;
    mine.click();
    await until(() => hz.settings.get().display.favOrder === 'mine');
  });

  it('aperçu : l’accueil 1.2.1 avec ses 3 favoris, selon l’ouverture, l’ordre et le rayon (T5, PRD-1.2.1 § 4)', () => {
    const d = defaults().display;
    expect(lines(homePreview(defaults()))).toEqual([
      'Favoris | 3',
      'Bureau | dans 4 min → 09:00',
      'Namur, train | IC 07:42 +2 voie 6 !',
      'Gare du Nord, tram | T3 6 min',
      '',
      'Autour de moi | 3 arrêts',
      'Aller à…',
    ]);
    // « Dans mon ordre » : l'ordre du téléphone, la gare du Nord en tête
    expect(lines(homePreview(defaults({ display: { ...d, favOrder: 'mine' } }))).slice(1, 4)).toEqual(['Gare du Nord, tram | T3 6 min', 'Bureau | dans 4 min → 09:00', 'Namur, train | IC 07:42 +2 voie 6 !']);
    // « Accueil sans favoris », rayon de 800 m : « Favoris » sans favori dessous, 4 arrêts ; 300 m : 2 arrêts
    expect(lines(homePreview(defaults({ display: { ...d, opening: 'home', radiusM: 800 } })))).toEqual(['Favoris | 3', '', 'Autour de moi | 4 arrêts', 'Aller à…']);
    expect(lines(homePreview(defaults({ display: { ...d, radiusM: 300 } })))).toContain('Autour de moi | 2 arrêts');
  });

  it('aperçu dans l’écran : les 3 favoris tiennent dans les lunettes, sans débordement ; le lecteur d’écran lit leurs réponses', () => {
    for (const gestureHints of [true, false]) {
      const v = homePreview(defaults({ display: { ...defaults().display, gestureHints } }));
      const page = layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, geometry(v).capacity));
      expect(v.items.filter((i) => i.action?.kind === 'openFavorite'), `aides ${gestureHints}`).toHaveLength(3);
      expect(overflowing(page), `aides ${gestureHints}`).toEqual([]);
    }
    const el = mount(displayScreen(harness({ settings: defaults() }).ctx));
    expect(el.querySelector('.preview')!.getAttribute('aria-label')!.replace(/\u00a0/g, ' ')).toBe(
      'Aperçu dans les lunettes : Quai, Favoris 3, Bureau dans 4 min → 09:00, Namur, train IC 07:42 +2 voie 6 !, Gare du Nord, tram T3 6 min, Autour de moi 3 arrêts, Aller à…',
    );
  });
});
