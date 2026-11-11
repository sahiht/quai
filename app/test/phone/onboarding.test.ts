// @vitest-environment happy-dom
/**
 * Premier lancement (T7, S1, PRD-1.2 § 2.2) : « Bienvenue » puis « Tes favoris » ; « Terminer » crée deux lieux,
 * Bureau proposé le matin et Maison le soir (case cochée), sans autre favori ; « Plus tard » ne crée rien ; la
 * version vue devient la version courante.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { onboardingScreen, withYourPlaces, yourFavoritesScreen } from '../../src/phone/screens/onboarding';
import { APP_VERSION } from '../../src/version';
import { button, harness, mount, options, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const fresh = () => structuredClone(DEFAULT_SETTINGS);

async function pick(el: HTMLElement, input: HTMLInputElement, text: string, label: string): Promise<void> {
  type(input, text);
  await sleep(GEO_DELAY_MS + 60);
  await settle();
  const list = el.querySelector(`#${input.id}-liste`)!;
  await until(() => options(list).some(([l]) => l.startsWith(label)));
  [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b.querySelector('.s1')).startsWith(label))!.click();
}

describe('étape 1 « Bienvenue »', () => {
  it('« Quelques réglages, et Quai est prêt. » ; « Continuer » mène à « Tes favoris » et fixe la version vue', async () => {
    const hz = harness({ settings: fresh() });
    const el = mount(onboardingScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Bienvenue');
    expect(textOf(el.querySelector('.lead'))).toBe('Quelques réglages, et Quai est prêt.');
    button(el, 'Continuer').click();
    await until(() => hz.went.length > 0);
    expect(hz.went[0]).toBe('#/bienvenue/favoris');
    expect(hz.settings.get()).toMatchObject({ onboarded: true, seenVersion: APP_VERSION });
  });
});

describe('étape 2 « Tes favoris » (S1, PRD-1.2 § 2.2)', () => {
  it('textes du PRD : sous-titre, champs, case cochée, « Terminer », « Plus tard »', () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourFavoritesScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Tes favoris');
    expect(textOf(el.querySelector('.lead'))).toBe('Facultatif. Maison et bureau deviennent tes premiers favoris.');
    expect(textOf(el.querySelector('label[for="s1-maison"]'))).toBe('Maison');
    expect(el.querySelector<HTMLInputElement>('#s1-maison')!.placeholder).toBe('Adresse de ton domicile');
    expect(textOf(el.querySelector('label[for="s1-bureau"]'))).toBe('Bureau');
    expect(el.querySelector<HTMLInputElement>('#s1-bureau')!.placeholder).toBe('Adresse de ton travail ou de ton école');
    const box = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    expect(textOf(box.closest('label'))).toBe('Me proposer le trajet vers le bureau le matin, et vers la maison le soir');
    expect(() => button(el, 'Terminer')).not.toThrow();
    expect(() => button(el, 'Plus tard')).not.toThrow();
  });

  it('« Terminer » : deux lieux, Bureau proposé le matin et Maison le soir, sans autre favori (CA-S1.1)', async () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourFavoritesScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#s1-maison')!, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    await pick(el, el.querySelector<HTMLInputElement>('#s1-bureau')!, 'rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles');
    button(el, 'Terminer').click();
    await until(() => hz.went.length > 0);
    expect(hz.went[0]).toBe('#/?accueil=1');
    const s = hz.settings.get();
    expect(s.favorites.map((f) => (f.kind === 'place' ? [f.label, f.address, f.src, f.propose] : f.kind))).toEqual([
      ['Bureau', 'Rue Neuve 1, 1000 Bruxelles', 'address', 'morning'],
      ['Maison', 'Rue de Fer 25, 5000 Namur', 'address', 'evening'],
    ]);
    expect(s.seenVersion).toBe(APP_VERSION);
    // « Mes favoris » : les deux lieux, avec leur créneau
    const favs = mount(favoritesScreen(hz.ctx));
    expect([...favs.querySelectorAll('.list .row')].map((r) => `${textOf(r.querySelector('.t1'))} | ${textOf(r.querySelector('.t2'))} | ${textOf(r.querySelector('.t4'))}`)).toEqual([
      'Bureau | Rue Neuve 1, 1000 Bruxelles | proposé le matin',
      'Maison | Rue de Fer 25, 5000 Namur | proposé le soir',
    ]);
  });

  it('case décochée : les deux lieux, jamais proposés, Maison d’abord ; un lieu de même nom est remplacé', () => {
    const c = { kind: 'address' as const, label: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648, recent: false };
    const b = { kind: 'address' as const, label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, recent: false };
    const s = withYourPlaces({ ...fresh(), onboarded: true }, { maison: c, bureau: b }, false);
    expect(s.favorites.map((f) => (f.kind === 'place' ? `${f.label}:${f.propose}` : f.kind))).toEqual(['Maison:never', 'Bureau:never']);
    const again = withYourPlaces(s, { bureau: c }, true);
    expect(again.favorites.map((f) => f.id)).toEqual(s.favorites.map((f) => f.id));
    expect(again.favorites[1]).toMatchObject({ label: 'Bureau', address: 'Rue de Fer 25, 5000 Namur', propose: 'morning' });
  });

  it('« Plus tard » ne crée rien (CA-S1.3)', async () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourFavoritesScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#s1-maison')!, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    button(el, 'Plus tard').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites).toEqual([]);
    expect(hz.settings.get().seenVersion).toBe(APP_VERSION);
  });

  it('une adresse tapée sans choix dans la liste : on le dit au lieu de l’ignorer', async () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourFavoritesScreen(hz.ctx));
    type(el.querySelector<HTMLInputElement>('#s1-bureau')!, 'rue neuve 1');
    button(el, 'Terminer').click();
    await settle();
    expect(hz.went).toEqual([]);
    expect(textOf(el.querySelector('.live'))).toBe('Choisis l’adresse de Bureau dans la liste, ou efface-la.');
  });
});
