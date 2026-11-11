// @vitest-environment happy-dom
/**
 * Affichage (T5, S3) : « À l’ouverture de Quai » et « Ordre des favoris » ; aperçu : l'accueil des lunettes avec ses
 * favoris, qui suit les réglages.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { homePreview } from '../../src/phone/samples';
import { displayScreen } from '../../src/phone/screens/display';
import { defaults, harness, mount, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const lines = (v: ReturnType<typeof homePreview>) => v.items.map((i) => [i.a, i.c, i.b2].filter(Boolean).join(' | ').replace(/ /g, ' '));

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

  it('aperçu : l’accueil avec ses favoris, selon l’ouverture, l’ordre et le rayon (T5)', () => {
    const smart = lines(homePreview(defaults()));
    expect(smart[0]).toBe('Vers le bureau | partir dans 4 min | IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00');
    expect(smart[1]).toMatch(/^Namur, train \| IC 07:42 \+2 v\.6 ! \| vers Bruxelles-Midi, puis ~08:42$/);
    expect(smart).toContain('Autour de moi | 3 arrêts');
    expect(smart).toContain('Autres favoris | 1');
    const mine = lines(homePreview(defaults({ display: { ...defaults().display, favOrder: 'mine' } })));
    expect(mine[0]).toMatch(/^Gare du Nord, tram \| T3 /);
    const none = lines(homePreview(defaults({ display: { ...defaults().display, opening: 'home', radiusM: 800 } })));
    expect(none).toContain('Mes favoris | 3');
    expect(none).toContain('Autour de moi | 4 arrêts');
    expect(none.some((l) => l.startsWith('Vers le bureau'))).toBe(false);
  });
});
