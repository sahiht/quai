// @vitest-environment happy-dom
/**
 * Écran Données (T6, M7.3, M8) : « Version de Quai   1.1.0 », carte « Adresses » (état d'après /api/health),
 * sources des adresses au pied de page, temps réel en panne dit juste.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dataScreen } from '../../src/phone/screens/data';
import { defaults, harness, mount, SCENARIO, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const kv = (el: HTMLElement) => Object.fromEntries([...el.querySelectorAll('.kv')].map((r) => [textOf(r.querySelector('dt')), textOf(r.querySelector('dd'))]));
const addressCard = (el: HTMLElement) => [...el.querySelectorAll('section')].find((s) => textOf(s.querySelector('h2')) === 'Adresses')!;

describe('écran Données', () => {
  it('« Mises à jour » : ligne « Version de Quai   1.1.0 » (CA-M7.3)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(dataScreen(hz.ctx));
    expect(kv(el)['Version de Quai']).toBe('1.1.0');
  });

  it('carte « Adresses » : services des trois Régions, « Disponible » puis « Indisponible » quand ils tombent', async () => {
    const ok = harness({ settings: defaults() });
    const el = mount(dataScreen(ok.ctx));
    const card = addressCard(el);
    expect(textOf(card.querySelector('p'))).toBe('Services officiels de Bruxelles, de Flandre et de Wallonie');
    await until(() => textOf(card.querySelector('.status')) !== '…');
    expect(textOf(card.querySelector('.status'))).toBe('Disponible');
    const down = harness({ settings: defaults(), flags: { geo: 'down' } });
    const el2 = mount(dataScreen(down.ctx));
    await until(() => textOf(addressCard(el2).querySelector('.status')) !== '…');
    expect(textOf(addressCard(el2).querySelector('.status'))).toBe('Indisponible');
  });

  it('pied de page : sources des adresses avec celles des horaires', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(dataScreen(hz.ctx));
    expect(el.textContent?.replace(/ /g, ' ')).toContain('licence CC BY 4.0. Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR).');
  });

  it('temps réel en panne : « indisponible, horaires prévus » (M8)', async () => {
    const hz = harness({ settings: defaults(), now: SCENARIO.s2.now, here: SCENARIO.s2, flags: { noRt: true } });
    await hz.core.init();
    await hz.core.board('sncb:8812005');
    const el = mount(dataScreen(hz.ctx));
    expect(kv(el)['Temps réel']).toBe('indisponible, horaires prévus');
  });
});
