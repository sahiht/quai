// @vitest-environment happy-dom
/**
 * Quai 1.2.5, côté téléphone (docs/v1.2.5/PRD-1.2.5.md § 3) : réglage « Pluie pendant la marche » dans Affichage,
 * carte « Météo » de l'écran Données (état, position jamais envoyée, attribution Open-Meteo), « pluie prévue » dans la
 * ligne des moyens d'un trajet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Journey, Leg } from '../../src/core/api';
import { dataScreen, weatherText } from '../../src/phone/screens/data';
import { displayScreen } from '../../src/phone/screens/display';
import { meansLine } from '../../src/phone/text';
import { defaults, harness, mount, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const plain = (t: string | null | undefined) => (t ?? '').replace(/[  ]/g, ' ');
const weatherCard = (el: HTMLElement) => [...el.querySelectorAll('section')].find((s) => textOf(s.querySelector('h2')) === 'Météo')!;
const rainSwitch = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => textOf(c.closest('label, .switch-row, div')).includes('Pluie pendant la marche'))!;

describe('Affichage : « Pluie pendant la marche »', () => {
  it('allumé par défaut, avec son explication ; coupé, il est enregistré', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    expect(plain(textOf(el))).toContain('Pluie pendant la marche');
    expect(plain(textOf(el))).toContain('sur les marches de 5 min ou plus, d’après Open-Meteo');
    const sw = rainSwitch(el);
    expect(sw.checked).toBe(true);
    sw.click();
    await until(() => hz.settings.get().display.rain === false);
    expect(hz.settings.get().display.rain).toBe(false);
  });
});

describe('Données : carte « Météo »', () => {
  it('« Disponible » ; relais muet : « Indisponible » ; réglage coupé : « Coupée dans Affichage » ; la position jamais envoyée', async () => {
    const ok = harness({ settings: defaults() });
    const el = mount(dataScreen(ok.ctx));
    const card = weatherCard(el);
    expect(plain(textOf(card.querySelector('p')))).toBe('Open-Meteo : la pluie prévue pendant tes marches. Quai reçoit la carte de toute la Belgique : ta position n’est jamais envoyée.');
    await until(() => textOf(card.querySelector('.status')) !== '…');
    expect(textOf(card.querySelector('.status'))).toBe('Disponible');

    const down = harness({ settings: defaults(), flags: { offline: true } });
    const el2 = mount(dataScreen(down.ctx));
    await until(() => textOf(weatherCard(el2).querySelector('.status')) !== '…');
    expect(textOf(weatherCard(el2).querySelector('.status'))).toBe('Indisponible');

    const off = harness({ settings: defaults({ display: { ...defaults().display, rain: false } }) });
    const el3 = mount(dataScreen(off.ctx));
    await until(() => textOf(weatherCard(el3).querySelector('.status')) !== '…');
    expect(textOf(weatherCard(el3).querySelector('.status'))).toBe('Coupée dans Affichage');
  });

  it('attribution au pied de page : « Météo : Open-Meteo.com, licence CC BY 4.0. »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(dataScreen(hz.ctx));
    expect(plain(el.textContent)).toContain('licence CC BY 4.0. Météo : Open-Meteo.com, licence CC BY 4.0. Adresses : ');
    expect(weatherText('unknown')).toEqual({ ok: false, text: '…' });
  });
});

describe('ligne des moyens d’un trajet : « pluie prévue »', () => {
  const N = (fr: string) => ({ fr, nl: fr });
  const leg = (kind: 'walk' | 'ride', dep: number, min: number, p: Partial<Leg> = {}): Leg => ({
    kind,
    from: { name: N('A'), lat: 50.8, lon: 4.3 },
    to: { name: N('B'), lat: 50.8, lon: 4.3 },
    dep,
    arr: dep + min * 60_000,
    schedDep: dep,
    schedArr: dep + min * 60_000,
    ...(kind === 'walk' ? { walkMin: min } : { op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), rt: true, delayMin: 0, cancelled: false }),
    ...p,
  });
  const T = 1_800_000_000_000;
  const j = (legs: Leg[]): Journey => ({ id: 'j', legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: legs[0].dep, transfers: 0, rt: true, alerts: [] });

  it('une marche de 5 min ou plus sous la pluie : « , pluie prévue » ; 4 min : rien', () => {
    const dry = j([leg('walk', T, 6), leg('ride', T + 6 * 60_000, 10), leg('walk', T + 16 * 60_000, 4)]);
    expect(plain(meansLine(dry))).toBe('tram 3, à pied 6 + 4 min');
    const wet = j([leg('walk', T, 6, { rain: true }), leg('ride', T + 6 * 60_000, 10), leg('walk', T + 16 * 60_000, 4)]);
    expect(plain(meansLine(wet))).toBe('tram 3, à pied 6 + 4 min, pluie prévue');
    const short = j([leg('walk', T, 6), leg('ride', T + 6 * 60_000, 10), leg('walk', T + 16 * 60_000, 4, { rain: true })]);
    expect(plain(meansLine(short))).toBe('tram 3, à pied 6 + 4 min');
    // à pied tout du long : rien d'habitude (la carte le dit), « pluie prévue » sous la pluie
    expect(meansLine(j([leg('walk', T, 22)]))).toBe('');
    expect(meansLine(j([leg('walk', T, 22, { rain: true })]))).toBe('pluie prévue');
  });
});
