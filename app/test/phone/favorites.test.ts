// @vitest-environment happy-dom
/**
 * « Mes favoris » (PRD-1.2 § 2.2, PRD-1.2.2 § 4) : une seule liste (endroits et trajets fixes ; plus d'arrêt favori,
 * rangés dans « Gares » et « Bus, tram, métro ») et ses lignes, chapeau, « Changer l’ordre », « Ajouter un favori » et
 * la limite des 32, adresses récentes en bas ; formulaire d'un trajet fixe (« Départ » sans « Ma position »),
 * créneaux « En tête de l’accueil » (revue d'usage n° 11), suppression confirmée dans la page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Favorite, FavoritePlace } from '../../src/core/api';
import { favoriteEditScreen, fixedTripScreen, newFavoriteScreen, PROPOSE_OPTIONS } from '../../src/phone/screens/favorite-edit';
import { favoritesScreen, moveFavorite } from '../../src/phone/screens/favorites';
import { button, defaults, harness, mount, options, plain, preset, preset11, settle, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.list .row')];
const lines = (row: Element) => [...row.querySelectorAll('.txt > span')].map((t) => textOf(t));
const place = (id: string, label: string, extra: Partial<FavoritePlace> = {}): FavoritePlace => ({ kind: 'place', id, label, lat: 50.4662, lon: 4.8648, address: 'Rue de Fer 25, 5000 Namur', src: 'address', propose: 'never', ...extra });

describe('« Mes favoris » : une seule liste (PRD-1.2 § 2.2)', () => {
  it('chapeau (revue d’usage n° 5) ; lignes d’un lieu et d’un trajet fixe, plus d’arrêt (préréglage 1.1 migré, CA-2.1, CA-122.6)', async () => {
    const hz = harness({ settings: preset11() });
    const el = mount(favoritesScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Mes favoris');
    expect(textOf(el.querySelector('.lead'))).toBe('Tes endroits et tes trajets de A à B. En tête dans les lunettes selon l’heure et ta position (réglage Affichage).');
    await until(() => rows(el).every((r) => !r.querySelector('.t3') || textOf(r.querySelector('.t3')) !== ''));
    const all = rows(el).map(lines);
    // les favoris restants dans le même ordre ; Gare du Nord, Namur et Bruxelles-Nord sont partis dans leurs rubriques
    expect(all).toEqual([
      // lieu : nom ; adresse (« Adresse à vérifier » pour un lieu 1.0) ; accès ; créneau
      ['Bureau', 'Adresse à vérifier', 'Tram Bourse à 9 min à pied', 'en tête le matin'],
      // trajet fixe : « {départ} → {arrivée} » ; « Trajet fixe »
      ['Bruxelles-Central → Gand-Saint-Pierre', 'Trajet fixe'],
      ['Maison', 'Adresse à vérifier', 'Bus TEC Namur Place Léopold à 3 min à pied ; gare de Namur à 7 min', 'en tête le soir'],
    ]);
    expect(rows(el)[0].getAttribute('aria-label')).toBe('Modifier Bureau');
    rows(el)[1].click();
    expect(hz.went).toEqual(['#/favoris/fav-gand']);
  });

  it('bas de l’écran : « Adresses récentes », « Effacer les adresses récentes » ; plus de « Marche maximale » (dans « Trajets »)', async () => {
    const hz = harness({ settings: defaults({ recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }] }) });
    const el = mount(favoritesScreen(hz.ctx));
    expect(el.querySelector('.stepper-row')).toBeNull();
    expect(textOf(el)).not.toContain('Marche maximale');
    expect(textOf(el.querySelector('#recents'))).toBe('Adresses récentes');
    expect(textOf(el)).toContain('Veldstraat 1, 9000 Gent');
    button(el, 'Effacer les adresses récentes').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().recent).toEqual([]);
    expect(hz.went).toEqual(['#/favoris']);
    // liste vide
    const empty = mount(favoritesScreen(harness({ settings: defaults() }).ctx));
    expect(textOf(empty.querySelector('.list'))).toBe('Aucun favori pour l’instant.');
    expect(empty.querySelector('#recents')).toBeNull();
  });

  it('« Ajouter un favori » mène à « Nouveau favori » ; 32 favoris : bouton grisé et « 32 favoris au plus : supprimes-en un. »', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(favoritesScreen(hz.ctx));
    button(el, 'Ajouter un favori').click();
    expect(hz.went).toEqual(['#/favoris/nouveau']);
    const full: Favorite[] = Array.from({ length: 32 }, (_, i) => place(`p${i}`, `Lieu ${i}`));
    const el2 = mount(favoritesScreen(harness({ settings: defaults({ favorites: full }) }).ctx));
    expect(button(el2, 'Ajouter un favori').disabled).toBe(true);
    expect(textOf(el2)).toContain('32 favoris au plus : supprimes-en un.');
  });

  it('« Changer l’ordre » : « Monter », « Descendre », « Terminé » ; l’ordre est enregistré', async () => {
    const hz = harness({ settings: preset11() });
    const el = mount(favoritesScreen(hz.ctx));
    const ids = () => hz.settings.get().favorites.map((f) => f.id);
    expect(ids()).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    button(el, 'Changer l’ordre').click();
    const order = () => [...el.querySelectorAll<HTMLElement>('.order-row')];
    expect(order()).toHaveLength(3);
    expect(button(el, 'Ajouter un favori').hidden).toBe(true);
    expect(order()[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    expect([...order()[2].querySelectorAll<HTMLButtonElement>('button')][1].disabled).toBe(true);
    const maison = order()[2];
    expect(maison.querySelector('button')!.getAttribute('aria-label')).toBe('Monter Maison');
    button(maison, 'Monter').click();
    await until(() => plain(el.querySelector('.live')?.textContent) !== '');
    expect(ids()).toEqual(['fav-bureau', 'fav-maison', 'fav-gand']);
    expect(plain(el.querySelector('.live')?.textContent)).toBe('Maison : 2e sur 3.');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Monter Maison');
    button(order()[0], 'Descendre').click();
    await until(() => plain(el.querySelector('.live')?.textContent) === 'Bureau : 2e sur 3.');
    expect(ids()).toEqual(['fav-maison', 'fav-bureau', 'fav-gand']);
    button(el, 'Terminé').click();
    expect(el.querySelectorAll('.order-row')).toHaveLength(0);
    expect(textOf(rows(el)[0].querySelector('.t1'))).toBe('Maison');
  });

  it('moveFavorite : bornes respectées', () => {
    const list = preset11().favorites;
    expect(moveFavorite(list, 'fav-bureau', -1)).toBe(list);
    expect(moveFavorite(list, 'fav-maison', 1)).toBe(list);
    expect(moveFavorite(list, 'fav-gand', -1).map((f) => f.id)).toEqual(['fav-gand', 'fav-bureau', 'fav-maison']);
  });
});

describe('trajet fixe (1.1) et créneaux (revue d’usage n° 11)', () => {
  it('« En tête de l’accueil » d’un trajet fixe : Automatique, le matin, le soir, d’office à moins de 300 m (mêmes valeurs)', () => {
    expect(PROPOSE_OPTIONS.map((o) => [o.value, plain(o.label)])).toEqual([
      ['never', 'Automatique'],
      ['morning', 'Le matin (5 h à 11 h)'],
      ['evening', 'Le soir (15 h à 21 h)'],
      ['near', 'L’ouvrir d’office à moins de 300 m'],
    ]);
    expect(PROPOSE_OPTIONS[1].label).toBe('Le matin (5 h à 11 h)');
    for (const o of PROPOSE_OPTIONS) expect(o.label).not.toMatch(/propos/i);
  });

  it('trajet fixe : « Départ » sans « Ma position », favoris d’abord ; nom affiché ; « Enregistrer »', async () => {
    const hz = harness({ settings: preset11() });
    // #/favoris/trajet (lien de la 1.2, retiré) : « Nouveau favori », choix « Un trajet de A à B » (PRD-1.2.1 § 7.1)
    const el = mount(fixedTripScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Nouveau favori');
    expect(textOf(el.querySelector('.back'))).toBe('Mes favoris');
    expect(textOf(el.querySelector('[role="tab"][aria-selected="true"] .k1'))).toBe('Un trajet de A à B');
    expect(el.querySelector('.trip-form')!.closest('[role="tabpanel"]')!.hasAttribute('hidden')).toBe(false);
    const dep = el.querySelector<HTMLInputElement>('#fav-de')!;
    expect(dep.hasAttribute('data-autofocus')).toBe(true);
    expect(el.querySelector('#nf-lieu')!.hasAttribute('data-autofocus')).toBe(false);
    const arr = el.querySelector<HTMLInputElement>('#fav-vers')!;
    expect(dep.value).toBe('');
    expect(textOf(el.querySelector('label[for="fav-nom"]'))).toBe('Nom affiché (« Vers le bureau »), facultatif');
    expect(textOf(el.querySelector('.trip-form legend'))).toBe('En tête de l’accueil');
    const save = button(el, 'Enregistrer');
    expect(save.disabled).toBe(true);
    dep.focus();
    dep.dispatchEvent(new Event('focus'));
    await settle();
    // revue d'usage n° 5 : un lieu est « favori », plus « mon lieu »
    expect(options(el.querySelector('#fav-de-liste')!).map(([l, t]) => `${l}|${t}`)).toEqual(['Bureau|favori', 'Maison|favori']);
    [...el.querySelectorAll<HTMLButtonElement>('#fav-de-liste [role="option"]')].find((b) => textOf(b).startsWith('Maison'))!.click();
    expect(dep.value).toBe('Maison');
    arr.focus();
    arr.dispatchEvent(new Event('focus'));
    await settle();
    expect(options(el.querySelector('#fav-vers-liste')!).map(([l]) => l)).toEqual(['Ma position', 'Bureau', 'Maison']);
    [...el.querySelectorAll<HTMLButtonElement>('#fav-vers-liste [role="option"]')].find((b) => textOf(b).startsWith('Bureau'))!.click();
    expect(arr.value).toBe('Bureau');
    expect(save.disabled).toBe(false);
    [...el.querySelectorAll<HTMLInputElement>('.trip-form input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Le matin (5 h à 11 h)')!.click();
    save.click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites[3]).toMatchObject({ kind: 'trip', from: { type: 'place', placeId: 'fav-maison' }, to: { type: 'place', placeId: 'fav-bureau' }, propose: 'morning' });
    expect(hz.went).toEqual(['#/favoris']);
    // une seconde fois : « Déjà dans tes favoris. »
    const el2 = mount(fixedTripScreen(hz.ctx));
    for (const [id, label] of [['fav-de', 'Maison'], ['fav-vers', 'Bureau']] as const) {
      const input = el2.querySelector<HTMLInputElement>(`#${id}`)!;
      input.focus();
      input.dispatchEvent(new Event('focus'));
      await settle();
      [...el2.querySelectorAll<HTMLButtonElement>(`#${id}-liste [role="option"]`)].find((b) => textOf(b.querySelector('.s1')) === label)!.click();
    }
    button(el2, 'Enregistrer').click();
    await until(() => textOf(el2.querySelector('.trip-form .live')) !== '');
    expect(textOf(el2.querySelector('.trip-form .live'))).toBe('Déjà dans tes favoris.');
    expect(hz.settings.get().favorites).toHaveLength(4);
  });

  it('ancien lien « #/favoris/nouveau?type=trajet » : « Nouveau favori », choix « Un trajet de A à B »', () => {
    const el = mount(newFavoriteScreen(harness({ settings: defaults(), params: 'type=trajet' }).ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Nouveau favori');
    expect(textOf(el.querySelector('[role="tab"][aria-selected="true"] .k1'))).toBe('Un trajet de A à B');
    expect(el.querySelector('#fav-de')!.closest('[role="tabpanel"]')!.hasAttribute('hidden')).toBe(false);
    expect(el.querySelector('#nf-lieu')!.closest('[role="tabpanel"]')!.hasAttribute('hidden')).toBe(true);
  });

  it('modification d’un trajet fixe ou d’un lieu : pas de choix en haut, son formulaire directement (PRD-1.2.1 § 7.1)', () => {
    const hz = harness({ settings: preset11() });
    for (const id of ['fav-gand', 'fav-bureau']) {
      const el = mount(favoriteEditScreen(hz.ctx, id));
      expect(el.querySelector('[role="tablist"]'), id).toBeNull();
      expect(plain(el.textContent), id).not.toContain('Un trajet de A à B');
    }
  });

  it('ancien lien d’un arrêt favori (#/favoris/fav-gdn), rangé dans « Bus, tram, métro » : la liste, jamais un formulaire d’arrêt', () => {
    const hz = harness({ settings: preset11() });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gdn'));
    expect(textOf(el.querySelector('h1'))).toBe('Mes favoris');
    expect(el.querySelector('.stop-form')).toBeNull();
  });

  it('trajet fixe existant : les champs montrent ses extrémités ; suppression confirmée dans la page (S6)', async () => {
    const hz = harness({ settings: preset11() });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gand'));
    expect(textOf(el.querySelector('h1'))).toBe('Modifier le favori');
    expect(textOf(el.querySelector('.back'))).toBe('Mes favoris');
    expect(el.querySelector<HTMLInputElement>('#fav-de')!.value).toBe('Bruxelles-Central');
    expect(el.querySelector<HTMLInputElement>('#fav-vers')!.value).toBe('Gand-Saint-Pierre');
    button(el, 'Supprimer ce favori').click();
    expect(el.querySelector('.confirm-q')!.textContent).toBe('Supprimer ce favori ?');
    button(el, 'Annuler').click();
    expect(hz.settings.get().favorites).toHaveLength(3);
    button(el, 'Supprimer ce favori').click();
    button(el, 'Supprimer').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-maison']);
  });

  it('préréglage de la 1.0 migré (CA-122.6) : favoris restants dans le même ordre ; gare, lignes et « toutes les lignes » rangées', () => {
    const s = preset();
    expect(s.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:fav-bureau', 'trip:fav-gand', 'place:maison']);
    expect(s.stations.map((x) => x.areaId)).toEqual(['sncb:8863008']);
    expect(s.lines.map((x) => [x.areaId, x.line ?? '*', !!x.near])).toEqual([
      ['stib:6357F', '3', true],
      ['stib:6357F', '4', true],
      ['delijn:308611', '*', false],
    ]);
  });
});
