// @vitest-environment happy-dom
/**
 * Écran Données (T6, M7.3, M8) : « Version de Quai   1.1.1 », carte « Adresses » (état d'après /api/health),
 * sources des adresses au pied de page, temps réel en panne dit juste.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dataScreen } from '../../src/phone/screens/data';
import { APP_VERSION } from '../../src/version';
import { defaults, harness, mount, SCENARIO, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const kv = (el: HTMLElement) => Object.fromEntries([...el.querySelectorAll('.kv')].map((r) => [textOf(r.querySelector('dt')), textOf(r.querySelector('dd'))]));
const addressCard = (el: HTMLElement) => [...el.querySelectorAll('section')].find((s) => textOf(s.querySelector('h2')) === 'Adresses')!;

describe('écran Données', () => {
  it('« Mises à jour » : « Version de Quai » (CA-M7.3) ; « Trajets vers tes favoris » (revue d’usage n° 5)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(dataScreen(hz.ctx));
    expect(kv(el)['Version de Quai']).toBe(APP_VERSION);
    expect(Object.keys(kv(el))).toEqual(['Horaires officiels', 'Trajets vers tes favoris', 'Temps réel', 'Version de Quai']);
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

describe('1.2.10 : carte « Chemins à pied » (PRD-1.2.10 § 3.8 et § 4.5)', () => {
  const walkCard = (el: HTMLElement) => [...el.querySelectorAll('section')].find((s) => textOf(s.querySelector('h2')) === 'Chemins à pied')!;

  it('OpenStreetMap et son attribution (licence ODbL), après la météo ; « Disponible » quand le cœur calcule les chemins à pied', async () => {
    const hz = harness({ settings: defaults(), core: (c) => ({ ...c, init: c.init.bind(c), walkRoute: async () => null }) });
    const el = mount(dataScreen(hz.ctx));
    const card = walkCard(el);
    const titles = [...el.querySelectorAll('section h2')].map((h) => textOf(h));
    expect(titles.indexOf('Chemins à pied')).toBe(titles.indexOf('Météo') + 1);
    expect([...card.querySelectorAll('p')].map((p) => textOf(p))).toEqual([
      'OpenStreetMap : les vrais chemins à pied, avec les escaliers, les parcs et les passages des gares. Le chemin se calcule sur ton téléphone : ta position n’est jamais envoyée.',
      '© les contributeurs d’OpenStreetMap, licence ODbL',
    ]);
    // typographie : espaces insécables devant « : »
    expect(card.querySelector('p')!.textContent).toMatch(/^OpenStreetMap : les vrais/);
    await until(() => textOf(card.querySelector('.status')) !== '…');
    expect(textOf(card.querySelector('.status'))).toBe('Disponible');
    expect(card.querySelector('.status')!.classList.contains('off')).toBe(false);
    expect(card.querySelector('.status .dot')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('« Indisponible » quand le cœur ne sait pas les calculer (pas de Core.walkRoute), ou quand il ne démarre pas', async () => {
    const hz = harness({ settings: defaults(), core: (c) => ({ ...c, init: c.init.bind(c), walkRoute: undefined }) });
    const el = mount(dataScreen(hz.ctx));
    await until(() => textOf(walkCard(el).querySelector('.status')) !== '…');
    expect(textOf(walkCard(el).querySelector('.status'))).toBe('Indisponible');
    expect(walkCard(el).querySelector('.status')!.classList.contains('off')).toBe(true);
    const broken = harness({ settings: defaults() });
    broken.ctx.core = () => Promise.reject(new Error('Horaires indisponibles pour l’instant.'));
    const el2 = mount(dataScreen(broken.ctx));
    await until(() => textOf(walkCard(el2).querySelector('.status')) !== '…');
    expect(textOf(walkCard(el2).querySelector('.status'))).toBe('Indisponible');
  });
});
