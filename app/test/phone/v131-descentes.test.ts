// @vitest-environment happy-dom
/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 12, B11) : « Effacer le journal » (Réglages, Données) oublie aussi les arrêts
 * retenus de « j'y descends » (GlassesApi.forgetAlights) ; « Annuler » n'y touche pas ; sans lunettes, rien ne casse.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { JournalTrip, TripJournal } from '../../src/core/journal-types';
import { dataScreen } from '../../src/phone/screens/data';
import { button, defaults, harness, mount, settle, textOf } from './helpers';

afterEach(() => document.body.replaceChildren());

const trip = (id: string): JournalTrip => ({ id, title: 'Vers Gare Centrale', kind: 'ride', startedAt: 1_763_620_000_000, endedAt: 1_763_620_600_000, end: 'done', events: [] });
function journal(): TripJournal & { cleared: number } {
  let all = [trip('a'), trip('b')];
  const j = {
    cleared: 0,
    begin: () => 'x',
    add: () => undefined,
    end: () => undefined,
    list: () => [...all],
    text: () => '',
    clear: () => {
      j.cleared += 1;
      all = [];
    },
  };
  return j;
}
const box = (el: HTMLElement): HTMLElement => [...el.querySelectorAll<HTMLElement>('section')].find((s) => textOf(s.querySelector('h2')) === 'Journal des trajets')!;

describe('B11 : « Effacer le journal » oublie les arrêts retenus', () => {
  it('effacé : forgetAlights une fois ; annulé : jamais', async () => {
    const hz = harness({ settings: defaults() });
    const j = journal();
    hz.ctx.journal = () => j;
    let forgot = 0;
    hz.glasses.forgetAlights = () => void (forgot += 1);
    const b = box(mount(dataScreen(hz.ctx)));
    button(b, 'Effacer le journal').click();
    button(b, 'Annuler').click();
    expect(forgot).toBe(0);
    button(b, 'Effacer le journal').click();
    button(b, 'Effacer').click();
    await settle();
    expect(j.cleared).toBe(1);
    expect(forgot).toBe(1);
  });

  it('sans lunettes (ou une erreur) : le journal est effacé quand même', async () => {
    for (const glasses of [false, true]) {
      const hz = harness({ settings: defaults(), glasses });
      const j = journal();
      hz.ctx.journal = () => j;
      hz.glasses.forgetAlights = () => {
        throw new Error('indisponible');
      };
      const b = box(mount(dataScreen(hz.ctx)));
      button(b, 'Effacer le journal').click();
      button(b, 'Effacer').click();
      await settle();
      expect(j.cleared).toBe(1);
      expect(textOf(b.querySelector('p.msg[role="status"]'))).toBe('Journal effacé.');
      document.body.replaceChildren();
    }
  });
});
