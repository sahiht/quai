// @vitest-environment happy-dom
/**
 * Réglages de trajet au même endroit (revue d'usage n° 9, PRD-1.2.2 § 8) : ligne « Trajets » sous « Position et
 * langue » (« Marche 10 min au plus, marge 2 min »), écran « Trajets » (« Marche maximale », « Marge avant de partir »,
 * comprise dans l'heure de départ conseillée), « Alertes » qui ne garde que les alertes. Mêmes clés de réglages.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { alertsScreen } from '../../src/phone/screens/alerts';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { tripsScreen } from '../../src/phone/screens/trips';
import { defaults, harness, mount, plain, textOf, until } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
  resetAnswers();
});

const steppers = (el: HTMLElement) => [...el.querySelectorAll('.stepper-row')].map((r) => [textOf(r.querySelector('.c1')), textOf(r.querySelector('.c2')), textOf(r.querySelector('output'))]);

describe('« Trajets » (revue d’usage n° 9)', () => {
  it('ligne « Trajets » des réglages, sous « Position et langue » : « Marche 10 min au plus, marge 2 min »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(homeScreen(hz.ctx));
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.list.box .row')];
    const i = rows.findIndex((r) => textOf(r.querySelector('.t1')) === 'Trajets');
    expect(textOf(rows[i - 1].querySelector('.t1'))).toBe('Position et langue');
    expect(rows[i].querySelector('.t2')!.textContent).toBe('Marche 10 min au plus, marge 2 min');
    rows[i].click();
    expect(hz.went).toEqual(['#/trajets']);
  });

  it('écran « Trajets » : « Marche maximale » (sous-titre de la 1.2.1) et « Marge avant de partir » ; mêmes clés de réglages', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(tripsScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Trajets');
    expect(textOf(el.querySelector('.back'))).toBe('Accueil');
    expect(steppers(el)).toEqual([
      ['Marche maximale', 'D’abord les trajets dans cette limite ; au-delà, s’il n’y a pas mieux', '10 min'],
      ['Marge avant de partir', 'comprise dans l’heure de départ conseillée', '2 min'],
    ]);
    el.querySelector<HTMLButtonElement>('[aria-label="Augmenter la marche maximale"]')!.click();
    await until(() => hz.settings.get().maxWalkMin === 11);
    el.querySelector<HTMLButtonElement>('[aria-label="Marge plus courte"]')!.click();
    await until(() => hz.settings.get().alerts.leaveBeforeMin === 1);
    expect(hz.settings.get().alerts.leave).toBe(true);
  });

  it('« Alertes » ne garde que les alertes : plus de marge ni de « 2 min avant » ; travaux sur les gares et les lignes (n° 4)', () => {
    const el = mount(alertsScreen(harness({ settings: defaults() }).ctx));
    expect(textOf(el)).not.toContain('Marge avant de partir');
    expect(plain(el.textContent)).not.toMatch(/min avant/);
    const sw = Object.fromEntries([...el.querySelectorAll('.switch-row')].map((r) => [textOf(r.querySelector('.c1')), textOf(r.querySelector('.c2'))]));
    expect(sw['Heure de partir à pied']).toBe('à l’heure de départ conseillée');
    expect(sw['Travaux et déviations']).toBe('sur tes gares et tes lignes');
    expect(steppers(el).map(([l]) => l)).toEqual(['Seuil du retard']);
  });
});
