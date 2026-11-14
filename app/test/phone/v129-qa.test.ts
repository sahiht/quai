// @vitest-environment happy-dom
/**
 * Contrôle qualité 1.2.9 (écrans du téléphone hors refonte) : défauts prouvés puis corrigés.
 *  - « Changer l’heure » : heure effacée dans le sélecteur (bouton « Effacer » ou « Réinitialiser ») : plus de
 *    recherche pour minuit (Number('') vaut 0).
 *  - « Recherche… » après une recherche en échec : plus en rouge (classe err restée).
 *  - Modification d'un lieu : « Ma position actuelle » puis une adresse avant la réponse de la position : l'adresse
 *    reste, la position arrivée trop tard ne la remplace pas.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Core, FavoritePlace } from '../../src/core/api';
import type { Fix } from '../../src/platform/types';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { favoriteEditScreen } from '../../src/phone/screens/favorite-edit';
import { searchScreen } from '../../src/phone/screens/search';
import { button, defaults, harness, mount, options, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const live = (el: HTMLElement) => el.querySelector<HTMLElement>('.results-box .live')!;
const done = async (el: HTMLElement): Promise<void> => {
  await until(() => textOf(live(el)) !== '' && !textOf(live(el)).startsWith('Recherche'));
  await settle();
};

describe('« Changer l’heure » (recherche de trajet)', () => {
  it('heure effacée dans le sélecteur : pas de recherche pour minuit, l’heure de la recherche ne change pas', async () => {
    const times: number[] = [];
    const hz = harness({
      params: 'de=sncb:8813003&vers=sncb:8892007',
      core: (c) => {
        const route = c.route.bind(c);
        return { ...c, route: (...a: Parameters<Core['route']>) => (times.push(a[2]), route(...a)) };
      },
    });
    const el = mount(searchScreen(hz.ctx));
    await done(el);
    expect(textOf(el.querySelector('.res-title .small'))).toBe('dès 13:55');
    const calls = times.length;
    button(el, 'Changer l’heure').click();
    const time = el.querySelector<HTMLInputElement>('input[type="time"]')!;
    expect(time.closest('[hidden]')).toBeNull();
    // bouton « Effacer » du sélecteur d'heure : valeur vide, événement change
    time.value = '';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await done(el);
    expect(textOf(el.querySelector('.res-title .small'))).toBe('dès 13:55');
    // aucune recherche lancée pour 00:00
    for (const t of times.slice(calls)) expect(t).toBeLessThan(hz.ctx.clock.now() + 3_600_000);
  });

  it('une vraie heure choisie : « départs dès 15:00 » (inchangé)', async () => {
    const hz = harness({ params: 'de=sncb:8813003&vers=sncb:8892007' });
    const el = mount(searchScreen(hz.ctx));
    await done(el);
    button(el, 'Changer l’heure').click();
    const time = el.querySelector<HTMLInputElement>('input[type="time"]')!;
    time.value = '15:00';
    time.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    await done(el);
    expect(textOf(el.querySelector('.res-title .small'))).toBe('départs dès 15:00');
  });
});

describe('« Recherche… » après un échec', () => {
  it('la recherche suivante n’est plus annoncée en rouge (classe err) ; l’échec, lui, l’est', async () => {
    let n = 0;
    const hz = harness({
      params: 'de=sncb:8813003&vers=sncb:8892007',
      core: (c) => ({
        ...c,
        route: () => (++n === 1 ? Promise.reject(new Error('Horaires indisponibles pour l’instant.')) : new Promise<never>(() => {})),
      }),
    });
    const el = mount(searchScreen(hz.ctx));
    await done(el);
    expect(textOf(live(el))).toBe('Horaires indisponibles pour l’instant.');
    expect(live(el).classList.contains('err')).toBe(true);
    // nouvelle recherche (départ et arrivée inversés) : « Recherche… », sans le style d'erreur
    el.querySelector<HTMLButtonElement>('.swap')!.click();
    await settle();
    expect(n).toBe(2);
    expect(textOf(live(el))).toBe('Recherche…');
    expect(live(el).classList.contains('err')).toBe(false);
  });
});

describe('modification d’un lieu : « Ma position actuelle » puis une adresse', () => {
  const bureau: FavoritePlace = { kind: 'place', id: 'lieu-b', label: 'Bureau', lat: 50.4662, lon: 4.8648, address: 'Rue de Fer 25, 5000 Namur', src: 'address', propose: 'never' };

  async function setup(answer: Fix | null) {
    const hz = harness({ settings: defaults({ favorites: [{ ...bureau }] }) });
    let release: (f: Fix | null) => void = () => {};
    hz.ctx.location = { last: () => null, current: () => new Promise<Fix | null>((r) => (release = r)) };
    const el = mount(favoriteEditScreen(hz.ctx, 'lieu-b'));
    const input = el.querySelector<HTMLInputElement>('#pl-lieu')!;
    const list = el.querySelector('#pl-lieu-liste')!;
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(list).length > 0);
    button(el, /^Ma position actuelle/).click();
    await settle();
    expect(textOf(el.querySelector('.place-form > .live'))).toBe('Recherche de ta position…');
    // la position tarde : une adresse est choisie à la place
    type(input, 'rue neuve 1 bruxelles');
    await sleep(GEO_DELAY_MS + 60);
    await settle();
    await until(() => options(list).some(([l]) => l === 'Rue Neuve 1, 1000 Bruxelles'));
    [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b.querySelector('.s1')) === 'Rue Neuve 1, 1000 Bruxelles')!.click();
    await settle();
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Rue Neuve 1, 1000 Bruxelles');
    // la position arrive ensuite (ou échoue)
    release(answer);
    await settle();
    return { hz, el };
  }

  it('position arrivée trop tard : l’adresse choisie reste, et c’est elle qui est enregistrée', async () => {
    const { hz, el } = await setup({ lat: 50.8454, lon: 4.3571, at: 0, source: 'mock' });
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Rue Neuve 1, 1000 Bruxelles');
    button(el, 'Enregistrer').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites[0]).toMatchObject({ id: 'lieu-b', label: 'Bureau', src: 'address', address: 'Rue Neuve 1, 1000 Bruxelles' });
  });

  it('position indisponible trop tard : pas de message d’erreur sous l’adresse choisie', async () => {
    const { el } = await setup(null);
    expect(textOf(el.querySelector('.place-form > .live'))).toBe('');
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Rue Neuve 1, 1000 Bruxelles');
    expect(button(el, 'Enregistrer').disabled).toBe(false);
  });

  it('saisie pendant la recherche de la position, sans nouveau choix : ni position, ni « Recherche de ta position… » restant', async () => {
    const hz = harness({ settings: defaults({ favorites: [{ ...bureau }] }) });
    let release: (f: Fix | null) => void = () => {};
    hz.ctx.location = { last: () => null, current: () => new Promise<Fix | null>((r) => (release = r)) };
    const el = mount(favoriteEditScreen(hz.ctx, 'lieu-b'));
    const input = el.querySelector<HTMLInputElement>('#pl-lieu')!;
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(el.querySelector('#pl-lieu-liste')!).length > 0);
    button(el, /^Ma position actuelle/).click();
    await settle();
    type(input, 'rue neuve');
    release({ lat: 50.8454, lon: 4.3571, at: 0, source: 'mock' });
    await settle();
    expect(textOf(el.querySelector('.place-form > .live'))).toBe('');
    expect(el.querySelector('.spot .t1')).toBeNull();
    expect(button(el, 'Enregistrer').disabled).toBe(true);
    expect(textOf(el.querySelector('#pl-hint'))).toBe('Choisis une adresse ou un arrêt dans la liste.');
  });
});
