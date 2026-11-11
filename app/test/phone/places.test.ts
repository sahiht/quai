// @vitest-environment happy-dom
/**
 * Lieux, favoris de la 1.2 (PRD-1.2 § 2.2) : « Nouveau favori » (champ unique avec « Ma position actuelle »), lieu par
 * adresse, par arrêt (« Le trajet pour y aller ») ou par la position, jamais de coordonnées, créneau proposé d'office
 * (« Bureau » le matin), lieux 1.0 « Adresse à vérifier », suppression d'un lieu utilisé par un trajet fixe, limite
 * des 32 favoris.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Favorite, FavoritePlace, FavoriteTrip } from '../../src/core/api';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { favoriteEditScreen, newFavoriteScreen } from '../../src/phone/screens/favorite-edit';
import { withPlace } from '../../src/phone/screens/places';
import { placeSubtitle } from '../../src/phone/text';
import { button, defaults, harness, mount, options, preset, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/** Aucune coordonnée à l'écran (« 50.4655, 4.8590 »). */
const noCoords = (el: HTMLElement): void => expect(el.textContent ?? '').not.toMatch(/\d{1,2}[.,]\d{3,}\s*[,;]\s*\d{1,3}[.,]\d{3,}/);

/** Tape `text` dans le champ et touche la proposition qui commence par `label` (type `kind` s'il est donné). */
async function pick(el: HTMLElement, input: HTMLInputElement, text: string, label: string, kind?: string): Promise<void> {
  type(input, text);
  await sleep(GEO_DELAY_MS + 60);
  await settle();
  const list = el.querySelector(`#${input.id}-liste`)!;
  const match = (b: Element): boolean => textOf(b.querySelector('.s1')).startsWith(label) && (!kind || textOf(b.querySelector('.s2')) === kind);
  await until(() => [...list.querySelectorAll('[role="option"]')].some(match));
  [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(match)!.click();
}

const places = (favs: Favorite[]): FavoritePlace[] => favs.filter((f): f is FavoritePlace => f.kind === 'place');
const place = (id: string, label: string, extra: Partial<FavoritePlace> = {}): FavoritePlace => ({ kind: 'place', id, label, lat: 50.4662, lon: 4.8648, address: 'Rue de Fer 25, 5000 Namur', src: 'address', propose: 'never', ...extra });

describe('sous-titres des lieux', () => {
  it('adresse normalisée, « Près de {arrêt} », « Position prise sur place », « Adresse à vérifier » ; jamais de coordonnées', () => {
    expect(placeSubtitle({ id: 'a', label: 'Bureau', lat: 50.8, lon: 4.3, src: 'address', address: 'Rue de Fer 25, 5000 Namur' })).toBe('Rue de Fer 25, 5000 Namur');
    expect(placeSubtitle({ id: 'a', label: 'X', lat: 50.8, lon: 4.3, src: 'address', address: 'Rue Neuve, 1000 Bruxelles', approx: true })).toBe('Rue Neuve, 1000 Bruxelles (sans numéro)');
    expect(placeSubtitle({ id: 'a', label: 'Gare', lat: 50.8, lon: 4.3, src: 'stop', address: 'Près de Namur', areaId: 'sncb:8863008' })).toBe('Près de Namur');
    expect(placeSubtitle({ id: 'a', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Namur' })).toBe('Adresse à vérifier');
    expect(placeSubtitle({ id: 'a', label: 'Ici', lat: 50.4655, lon: 4.859, src: 'here' })).toBe('Position prise sur place');
  });
});

describe('« Nouveau favori » (PRD-1.2 § 2.2)', () => {
  it('textes : titre, champ « Adresse, gare ou arrêt » avec en tête « Ma position actuelle », lien du trajet fixe, mention', async () => {
    const hz = harness({ settings: defaults({ recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }] }) });
    const el = mount(newFavoriteScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Nouveau favori');
    expect(textOf(el.querySelector('.back'))).toBe('Mes favoris');
    const input = el.querySelector<HTMLInputElement>('#nf-lieu')!;
    expect(textOf(el.querySelector('label[for="nf-lieu"]'))).toBe('Adresse, gare ou arrêt');
    expect(input.hasAttribute('data-autofocus')).toBe(true);
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(el.querySelector('#nf-lieu-liste')!).length > 0);
    expect(options(el.querySelector('#nf-lieu-liste')!)).toEqual([
      ['Ma position actuelle', 'si tu es sur place'],
      ['Veldstraat 1, 9000 Gent', 'récent'],
    ]);
    expect(textOf(el.querySelector('.privacy'))).toContain('Seul le texte tapé leur est envoyé');
    button(el, 'Un trajet fixe, d’un endroit à un autre').click();
    expect(hz.went).toEqual(['#/favoris/trajet']);
  });

  it('CA-2.3 : « rue neuve 1 bruxelles », raccourci « Bureau », « Le matin » d’office, « Enregistrer » : 3 touchers et 1 saisie', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles'); // saisie, 1
    // « Nom » (adresse courte proposée), raccourcis, adresse et accès, créneaux d'un lieu, « Enregistrer »
    const name = el.querySelector<HTMLInputElement>('#pl-nom')!;
    expect(textOf(el.querySelector('label[for="pl-nom"]'))).toBe('Nom');
    expect(name.value).toBe('Rue Neuve 1');
    expect([...el.querySelectorAll('.shortcut')].map((b) => textOf(b))).toEqual(['Maison', 'Bureau', 'École']);
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Rue Neuve 1, 1000 Bruxelles');
    await until(() => textOf(el.querySelector('.spot .t3')) !== '…');
    expect(textOf(el.querySelector('.spot .t3'))).toMatch(/à \d+ min à pied/);
    const legend = [...el.querySelectorAll('legend')].find((l) => textOf(l) === 'Le proposer à l’ouverture')!;
    expect([...legend.parentElement!.querySelectorAll('label')].map((l) => textOf(l))).toEqual(['Jamais', 'Le matin (5 h à 11 h)', 'Le soir (15 h à 21 h)']);
    button(el, 'Bureau').click(); // 2
    expect(name.value).toBe('Bureau');
    expect(textOf(el.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.closest('label'))).toBe('Le matin (5 h à 11 h)');
    noCoords(el);
    button(el, 'Enregistrer').click(); // 3
    await until(() => hz.went.length > 0);
    expect(hz.went).toEqual(['#/favoris']);
    expect(hz.settings.get().favorites).toEqual([
      expect.objectContaining({ kind: 'place', label: 'Bureau', src: 'address', address: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, propose: 'morning' }),
    ]);
  });

  it('le créneau choisi à la main n’est plus changé par le nom ; « Maison » : le soir', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    button(el, 'Maison').click();
    const checked = (): string => textOf(el.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.closest('label'));
    expect(checked()).toBe('Le soir (15 h à 21 h)');
    const never = [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === 'never')!;
    never.checked = true;
    never.dispatchEvent(new Event('change'));
    button(el, 'Bureau').click();
    expect(checked()).toBe('Jamais');
  });

  it('adresse choisie puis texte corrigé sans nouveau choix : le formulaire disparaît, rien à enregistrer', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    const input = el.querySelector<HTMLInputElement>('#nf-lieu')!;
    await pick(el, input, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    expect(el.querySelector('#pl-nom')).not.toBeNull();
    type(input, 'rue de fer 52 namur');
    expect(el.querySelector('#pl-nom')).toBeNull();
    await settle();
    expect(hz.settings.get().favorites).toEqual([]);
  });

  it('rue sans numéro : « Position approximative : la rue, sans numéro. »', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'rue neuve bruxelles', 'Rue Neuve, 1000 Bruxelles');
    expect(textOf(el.querySelector('.spot .t2'))).toBe('Position approximative : la rue, sans numéro.');
  });

  it('CA-2.3 : gare « Namur » : « Ses prochains départs » donne un arrêt, « Le trajet pour y aller » un lieu « Près de Namur »', async () => {
    const hz = harness({ settings: defaults(), flags: { geo: 'down' } });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'namur', 'Namur', 'gare SNCB');
    const legend = [...el.querySelectorAll('legend')].find((l) => textOf(l) === 'Dans les lunettes')!;
    const radios = [...legend.parentElement!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => textOf(r.closest('label')))).toEqual(['Ses prochains départs', 'Le trajet pour y aller']);
    expect(radios[0].checked).toBe(true);
    // arrêt : lignes et directions, quatre créneaux (« Quand je suis à moins de 300 m » compris)
    await until(() => el.querySelectorAll('.stop-form input[type="checkbox"]').length > 0);
    expect(textOf(el.querySelector('.stop-form'))).toContain('Quand je suis à moins de 300 m');
    button(el, 'Enregistrer').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'stop', areaId: 'sncb:8863008', propose: 'never' });

    const hz2 = harness({ settings: defaults(), flags: { geo: 'down' } });
    const el2 = mount(newFavoriteScreen(hz2.ctx));
    await pick(el2, el2.querySelector<HTMLInputElement>('#nf-lieu')!, 'namur', 'Namur', 'gare SNCB');
    const trip = [...el2.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Le trajet pour y aller')!;
    trip.checked = true;
    trip.dispatchEvent(new Event('change'));
    expect(textOf(el2.querySelector('.spot .t1'))).toBe('Près de Namur');
    expect(el2.querySelector<HTMLInputElement>('#pl-nom')!.value).toBe('Namur');
    button(el2, 'Enregistrer').click();
    await until(() => hz2.settings.get().favorites.length === 1);
    expect(hz2.settings.get().favorites[0]).toMatchObject({ kind: 'place', label: 'Namur', src: 'stop', areaId: 'sncb:8863008', address: 'Près de Namur', propose: 'never' });
  });

  it('« Ma position actuelle » : position prise sur place, sans coordonnées ; sans position : on le dit', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    const input = el.querySelector<HTMLInputElement>('#nf-lieu')!;
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(el.querySelector('#nf-lieu-liste')!).length > 0);
    button(el, /^Ma position actuelle/).click();
    await until(() => el.querySelector('#pl-nom') !== null);
    expect(input.value).toBe('Ma position actuelle');
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Position prise sur place');
    expect(button(el, 'Enregistrer').disabled).toBe(true);
    expect(textOf(el.querySelector('#pl-hint'))).toBe('Donne un nom au lieu.');
    type(el.querySelector<HTMLInputElement>('#pl-nom')!, 'Piscine');
    noCoords(el);
    button(el, 'Enregistrer').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'place', label: 'Piscine', src: 'here', lat: 50.8454, lon: 4.3571 });

    const none = harness({ settings: defaults(), here: null });
    const el2 = mount(newFavoriteScreen(none.ctx));
    const input2 = el2.querySelector<HTMLInputElement>('#nf-lieu')!;
    input2.focus();
    input2.dispatchEvent(new Event('focus'));
    await until(() => options(el2.querySelector('#nf-lieu-liste')!).length > 0);
    button(el2, /^Ma position actuelle/).click();
    await until(() => textOf(el2.querySelector('.live')) !== '' && !/Recherche/.test(textOf(el2.querySelector('.live'))));
    expect(textOf(el2.querySelector('.live'))).toBe('Position indisponible : autorise la position pour Quai dans l’appli Even, ou choisis une adresse ou un arrêt.');
    expect(el2.querySelector('#pl-nom')).toBeNull();
  });

  it('un lieu de même nom est remplacé à sa place (même identifiant) ; 32 favoris au plus', async () => {
    const s = defaults({ favorites: [place('lieu-b', 'Bureau', { propose: 'morning' }), place('lieu-m', 'Maison')] });
    const r = withPlace(s.favorites, place('', 'bureau', { address: 'Rue Neuve 1, 1000 Bruxelles' }))!;
    expect(r.favorites.map((f) => f.id)).toEqual(['lieu-b', 'lieu-m']);
    expect(r.place).toMatchObject({ id: 'lieu-b', address: 'Rue Neuve 1, 1000 Bruxelles' });
    const full = Array.from({ length: 32 }, (_, i) => place(`p${i}`, `Lieu ${i}`));
    expect(withPlace(full, place('', 'Nouveau'))).toBeNull();
    expect(withPlace(full, place('', 'Lieu 3'))!.favorites).toHaveLength(32);

    const hz = harness({ settings: defaults({ favorites: full }) });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles');
    button(el, 'Enregistrer').click();
    await until(() => textOf(el.querySelector('.live.err, [role="alert"]')) !== '' || textOf(el.querySelector('.place-form')).includes('32 favoris au plus'));
    expect(textOf(el.querySelector('.place-form'))).toContain('32 favoris au plus : supprimes-en un.');
    expect(hz.settings.get().favorites).toHaveLength(32);
    expect(hz.went).toEqual([]);
  });
});

describe('lieu de la 1.0 : « Vérifier l’adresse » (M4.8)', () => {
  it('le champ s’ouvre avec le texte libre prérempli ; l’adresse choisie remplace le texte libre, même identifiant', async () => {
    const s = preset();
    const maison = places(s.favorites).find((p) => p.label === 'Maison')!;
    maison.address = 'rue de fer 25 namur';
    const hz = harness({ settings: s });
    const el = mount(favoriteEditScreen(hz.ctx, maison.id));
    expect(textOf(el.querySelector('h1'))).toBe('Maison');
    expect(textOf(el.querySelector('.verify strong'))).toBe('Adresse à vérifier');
    const addr = el.querySelector<HTMLInputElement>('#pl-lieu')!;
    button(el, 'Vérifier l’adresse').click();
    expect(addr.value).toBe('rue de fer 25 namur');
    await sleep(GEO_DELAY_MS + 60);
    await settle();
    const list = el.querySelector('#pl-lieu-liste')!;
    await until(() => options(list).some(([, t]) => t === 'adresse'));
    [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b.querySelector('.s1')) === 'Rue de Fer 25, 5000 Namur')!.click();
    button(el, 'Enregistrer').click();
    await until(() => hz.went.length > 0);
    const after = hz.settings.get().favorites;
    expect(after.find((f) => f.id === maison.id)).toMatchObject({ kind: 'place', label: 'Maison', src: 'address', address: 'Rue de Fer 25, 5000 Namur' });
    expect(after.map((f) => f.id)).toEqual(preset().favorites.map((f) => f.id));
  });

  it('« Près de Bruxelles-Central » (lieu 1.0 placé à un arrêt) : le champ reçoit le nom de l’arrêt', () => {
    const s = preset();
    const bureau = places(s.favorites).find((p) => p.label === 'Bureau')!;
    bureau.address = 'Près de Bruxelles-Central';
    const hz = harness({ settings: s });
    const el = mount(favoriteEditScreen(hz.ctx, bureau.id));
    button(el, 'Vérifier l’adresse').click();
    expect(el.querySelector<HTMLInputElement>('#pl-lieu')!.value).toBe('Bruxelles-Central');
  });

  it('modification : « Ma position actuelle » en tête du champ, créneau gardé', async () => {
    const s = defaults({ favorites: [place('lieu-b', 'Bureau', { propose: 'morning' })] });
    const hz = harness({ settings: s });
    const el = mount(favoriteEditScreen(hz.ctx, 'lieu-b'));
    const input = el.querySelector<HTMLInputElement>('#pl-lieu')!;
    expect(input.value).toBe('Rue de Fer 25, 5000 Namur');
    expect(textOf(el.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.closest('label'))).toBe('Le matin (5 h à 11 h)');
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(el.querySelector('#pl-lieu-liste')!).length > 0);
    expect(options(el.querySelector('#pl-lieu-liste')!)[0]).toEqual(['Ma position actuelle', 'si tu es sur place']);
  });
});

describe('suppression d’un lieu (PRD-1.2 § 2.2, CA-2.5)', () => {
  const trip: FavoriteTrip = { kind: 'trip', id: 'fav-mb', from: { type: 'place', placeId: 'lieu-m' }, to: { type: 'place', placeId: 'lieu-b' }, propose: 'morning' };

  it('« Maison » utilisée par le trajet fixe « Maison → Bureau » : le message du § 2.2 ; les deux disparaissent', async () => {
    const hz = harness({ settings: defaults({ favorites: [place('lieu-m', 'Maison'), place('lieu-b', 'Bureau'), trip] }) });
    const el = mount(favoriteEditScreen(hz.ctx, 'lieu-m'));
    const confirm = globalThis.confirm;
    globalThis.confirm = () => {
      throw new Error('boîte du système');
    };
    try {
      button(el, 'Supprimer ce favori').click();
      expect(textOf(el.querySelector('.confirm-q'))).toBe('Supprimer « Maison » ? Les trajets fixes qui l’utilisent seront aussi supprimés.');
      expect(el.querySelector('.confirm-q')!.textContent).toContain('« Maison » ?');
      button(el, 'Annuler').click();
      expect(el.querySelector('.confirm')).toBeNull();
      button(el, 'Supprimer ce favori').click();
      button(el, 'Supprimer').click();
      await until(() => hz.went.length > 0);
      expect(hz.went).toEqual(['#/favoris']);
      expect(hz.settings.get().favorites.map((f) => f.id)).toEqual(['lieu-b']);
    } finally {
      globalThis.confirm = confirm;
    }
  });

  it('lieu qu’aucun trajet fixe n’utilise : « Supprimer ce favori ? »', async () => {
    const hz = harness({ settings: defaults({ favorites: [place('lieu-m', 'Maison'), place('lieu-b', 'Bureau'), trip] }) });
    const el = mount(favoriteEditScreen(hz.ctx, 'lieu-x'));
    // favori inconnu (supprimé, ancien lien) : la liste
    expect(textOf(el.querySelector('h1'))).toBe('Mes favoris');
    const s = defaults({ favorites: [place('lieu-m', 'Maison')] });
    const hz2 = harness({ settings: s });
    const el2 = mount(favoriteEditScreen(hz2.ctx, 'lieu-m'));
    button(el2, 'Supprimer ce favori').click();
    expect(textOf(el2.querySelector('.confirm-q'))).toBe('Supprimer ce favori ?');
    button(el2, 'Supprimer').click();
    await until(() => hz2.settings.get().favorites.length === 0);
    expect(hz.settings.get().favorites).toHaveLength(3);
  });
});
