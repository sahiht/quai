// @vitest-environment happy-dom
/**
 * Premier lancement (T7, S1) : « Bienvenue » puis « Tes lieux » ; « Terminer » crée Maison, Bureau et les deux
 * trajets (matin, soir) ; « Plus tard » ne crée rien ; la version vue devient la version courante.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { onboardingScreen, withYourPlaces, yourPlacesScreen } from '../../src/phone/screens/onboarding';
import { placesScreen } from '../../src/phone/screens/places';
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
  it('« Quelques réglages, et Quai est prêt. » ; « Continuer » mène à « Tes lieux » et fixe la version vue', async () => {
    const hz = harness({ settings: fresh() });
    const el = mount(onboardingScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Bienvenue');
    expect(textOf(el.querySelector('.lead'))).toBe('Quelques réglages, et Quai est prêt.');
    button(el, 'Continuer').click();
    await until(() => hz.went.length > 0);
    expect(hz.went[0]).toBe('#/bienvenue/lieux');
    expect(hz.settings.get()).toMatchObject({ onboarded: true, seenVersion: APP_VERSION });
  });
});

describe('étape 2 « Tes lieux » (S1)', () => {
  it('textes du PRD : sous-titre, champs, case cochée, « Terminer », « Plus tard »', () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourPlacesScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Tes lieux');
    expect(textOf(el.querySelector('.lead'))).toBe('Facultatif. Avec ces deux adresses, Quai te propose le bon trajet le matin et le soir.');
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

  it('« Terminer » : Maison et Bureau, puis « Ma position → Bureau » le matin et « Ma position → Maison » le soir (CA-S1.1)', async () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourPlacesScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#s1-maison')!, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    await pick(el, el.querySelector<HTMLInputElement>('#s1-bureau')!, 'rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles');
    button(el, 'Terminer').click();
    await until(() => hz.went.length > 0);
    expect(hz.went[0]).toBe('#/?accueil=1');
    const s = hz.settings.get();
    expect(s.places.map((p) => [p.label, p.address, p.src])).toEqual([
      ['Maison', 'Rue de Fer 25, 5000 Namur', 'address'],
      ['Bureau', 'Rue Neuve 1, 1000 Bruxelles', 'address'],
    ]);
    const [bureau, maison] = s.favorites;
    expect(bureau).toMatchObject({ kind: 'trip', from: { type: 'here' }, to: { type: 'place', placeId: s.places[1].id }, propose: 'morning' });
    expect(maison).toMatchObject({ kind: 'trip', from: { type: 'here' }, to: { type: 'place', placeId: s.places[0].id }, propose: 'evening' });
    expect(s.seenVersion).toBe(APP_VERSION);
    // « Mes lieux » = Maison, Bureau ; « Mes favoris » = Ma position → Bureau (matin), → Maison (soir)
    const lieux = mount(placesScreen(hz.ctx));
    expect([...lieux.querySelectorAll('.list .t1')].map((t) => textOf(t))).toEqual(['Maison', 'Bureau']);
    const favs = mount(favoritesScreen(hz.ctx));
    expect([...favs.querySelectorAll('.list .row')].map((r) => `${textOf(r.querySelector('.t1'))} | ${textOf(r.querySelector('.t2'))}`)).toEqual([
      'Ma position → Bureau | Trajet porte à porte, proposé le matin',
      'Ma position → Maison | Trajet porte à porte, proposé le soir',
    ]);
  });

  it('case décochée : les lieux seulement', () => {
    const c = { kind: 'address' as const, label: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648, recent: false };
    const s = withYourPlaces({ ...fresh(), onboarded: true }, { maison: c }, false);
    expect(s.places).toHaveLength(1);
    expect(s.favorites).toHaveLength(0);
  });

  it('« Plus tard » ne crée rien (CA-S1.3)', async () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourPlacesScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#s1-maison')!, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    button(el, 'Plus tard').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().places).toEqual([]);
    expect(hz.settings.get().favorites).toEqual([]);
    expect(hz.settings.get().seenVersion).toBe(APP_VERSION);
  });

  it('une adresse tapée sans choix dans la liste : on le dit au lieu de l’ignorer', async () => {
    const hz = harness({ settings: { ...fresh(), onboarded: true } });
    const el = mount(yourPlacesScreen(hz.ctx));
    type(el.querySelector<HTMLInputElement>('#s1-bureau')!, 'rue neuve 1');
    button(el, 'Terminer').click();
    await settle();
    expect(hz.went).toEqual([]);
    expect(textOf(el.querySelector('.live'))).toBe('Choisis l’adresse de Bureau dans la liste, ou efface-la.');
  });
});
