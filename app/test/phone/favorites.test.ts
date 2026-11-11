// @vitest-environment happy-dom
/**
 * « Mes favoris » (PRD-1.2 § 2.2) : une seule liste (lieux, arrêts, trajets fixes) et ses lignes, chapeau,
 * « Changer l’ordre », « Ajouter un favori » et la limite des 32, bas de l'écran (« Marche maximale », adresses
 * récentes) ; formulaires d'un arrêt et d'un trajet fixe (« Départ » sans « Ma position »), suppression confirmée
 * dans la page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Favorite, FavoritePlace, FavoriteStop, SearchItem } from '../../src/core/api';
import { favoriteEditScreen, fixedTripScreen, newFavoriteScreen, PROPOSE_OPTIONS } from '../../src/phone/screens/favorite-edit';
import { favoritesScreen, moveFavorite, stopLinesText } from '../../src/phone/screens/favorites';
import { button, defaults, harness, mount, options, plain, preset, preset11, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.list .row')];
const lines = (row: Element) => [...row.querySelectorAll('.txt > span')].map((t) => textOf(t));
const place = (id: string, label: string, extra: Partial<FavoritePlace> = {}): FavoritePlace => ({ kind: 'place', id, label, lat: 50.4662, lon: 4.8648, address: 'Rue de Fer 25, 5000 Namur', src: 'address', propose: 'never', ...extra });

describe('« Mes favoris » : une seule liste (PRD-1.2 § 2.2)', () => {
  it('chapeau ; lignes d’un lieu, d’un arrêt et d’un trajet fixe (préréglage 1.1 migré, CA-2.1)', async () => {
    const hz = harness({ settings: preset11() });
    const el = mount(favoritesScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Mes favoris');
    expect(textOf(el.querySelector('.lead'))).toBe('Tes lieux, tes arrêts et tes trajets. En tête dans les lunettes selon l’heure et le lieu (réglage Affichage).');
    // les lignes des arrêts sont complétées par leurs modes (« Gare du Nord, tram »)
    await until(() => rows(el).every((r) => !r.querySelector('.t3') || textOf(r.querySelector('.t3')) !== '') && textOf(rows(el)[1].querySelector('.t1')).includes(','));
    const all = rows(el).map(lines);
    // lieu : nom ; adresse (« Adresse à vérifier » pour un lieu 1.0) ; accès ; créneau
    expect(all[0]).toEqual(['Bureau', 'Adresse à vérifier', 'Tram Bourse à 9 min à pied', 'proposé le matin']);
    // arrêt : « Gare du Nord, tram » ; ses lignes ; créneau
    expect(all[1]).toEqual(['Gare du Nord, tram', 'Trams 3 et 4', 'proposé à moins de 300 m']);
    // trajet fixe : « {départ} → {arrivée} » ; « Trajet fixe »
    expect(all[2]).toEqual(['Bruxelles-Central → Gand-Saint-Pierre', 'Trajet fixe']);
    expect(all[3]).toEqual(['Namur, train', 'Toutes les lignes']);
    expect(all[5]).toEqual(['Maison', 'Adresse à vérifier', 'Bus TEC Namur Place Léopold à 3 min à pied ; gare de Namur à 7 min', 'proposé le soir']);
    expect(rows(el)[0].getAttribute('aria-label')).toBe('Modifier Bureau');
    rows(el)[2].click();
    expect(hz.went).toEqual(['#/favoris/fav-gand']);
  });

  it('lignes d’un arrêt : « Trams 3 et 4 », « Ligne 71 », « Toutes les lignes »', () => {
    const stop = (filter: { line: string; head: string }[] | undefined, op: FavoriteStop['op'] = 'stib'): FavoriteStop => ({ kind: 'stop', id: 's', areaId: 'stib:1', op, name: { fr: 'X', nl: 'X' }, lat: 0, lon: 0, filter, propose: 'never' });
    expect(stopLinesText(stop(undefined))).toBe('Toutes les lignes');
    expect(stopLinesText(stop([]))).toBe('Toutes les lignes');
    expect(stopLinesText(stop([{ line: '71', head: 'delta' }]))).toBe('Ligne 71');
    expect(stopLinesText(stop([{ line: '3', head: 'a' }, { line: '3', head: 'b' }, { line: '4', head: 'c' }]), [{ line: '3', mode: 'tram' }, { line: '4', mode: 'tram' }])).toBe('Trams 3 et 4');
    expect(stopLinesText(stop([{ line: '2', head: 'a' }, { line: '92', head: 'b' }]), [{ line: '2', mode: 'metro' }, { line: '92', mode: 'tram' }])).toBe('Lignes 2 et 92');
    expect(stopLinesText(stop([{ line: 'IC', head: 'a' }], 'sncb'))).toBe('Train IC');
  });

  it('bas de l’écran : « Marche maximale » et son sous-titre, « Adresses récentes », « Effacer les adresses récentes »', async () => {
    const hz = harness({ settings: defaults({ recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }] }) });
    const el = mount(favoritesScreen(hz.ctx));
    expect(textOf(el.querySelector('.stepper-row .c1'))).toBe('Marche maximale');
    expect(textOf(el.querySelector('.stepper-row .c2'))).toBe('Au-delà de 5 min de plus, seulement pour arriver au moins 10 min plus tôt');
    expect(el.querySelector('.stepper-row .c2')!.textContent).toContain('5 min');
    el.querySelector<HTMLButtonElement>('[aria-label="Augmenter la marche maximale"]')!.click();
    await until(() => hz.settings.get().maxWalkMin === 11);
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
    expect(ids()).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-namur', 'fav-dl-nord', 'fav-maison']);
    button(el, 'Changer l’ordre').click();
    const order = () => [...el.querySelectorAll<HTMLElement>('.order-row')];
    expect(order()).toHaveLength(6);
    expect(button(el, 'Ajouter un favori').hidden).toBe(true);
    expect(order()[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    expect([...order()[5].querySelectorAll<HTMLButtonElement>('button')][1].disabled).toBe(true);
    const namur = order()[3];
    expect(namur.querySelector('button')!.getAttribute('aria-label')).toBe('Monter Namur, train');
    button(namur, 'Monter').click();
    await until(() => plain(el.querySelector('.live')?.textContent) !== '');
    expect(ids()).toEqual(['fav-bureau', 'fav-gdn', 'fav-namur', 'fav-gand', 'fav-dl-nord', 'fav-maison']);
    expect(plain(el.querySelector('.live')?.textContent)).toBe('Namur, train : 3e sur 6.');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Monter Namur, train');
    button(order()[0], 'Descendre').click();
    await until(() => plain(el.querySelector('.live')?.textContent) === 'Bureau : 2e sur 6.');
    expect(ids()[1]).toBe('fav-bureau');
    button(el, 'Terminé').click();
    expect(el.querySelectorAll('.order-row')).toHaveLength(0);
    expect(textOf(rows(el)[0].querySelector('.t1'))).toMatch(/^Gare du Nord/);
  });

  it('moveFavorite : bornes respectées', () => {
    const list = preset11().favorites;
    expect(moveFavorite(list, 'fav-bureau', -1)).toBe(list);
    expect(moveFavorite(list, 'fav-maison', 1)).toBe(list);
    expect(moveFavorite(list, 'fav-gdn', -1).map((f) => f.id).slice(0, 2)).toEqual(['fav-gdn', 'fav-bureau']);
  });
});

describe('arrêt et trajet fixe (1.1)', () => {
  it('créneaux d’un arrêt ou d’un trajet fixe, avec leurs heures', () => {
    expect(PROPOSE_OPTIONS.map((o) => plain(o.label))).toEqual(['Jamais', 'Quand je suis à moins de 300 m', 'Le matin (5 h à 11 h)', 'Le soir (15 h à 21 h)']);
    expect(PROPOSE_OPTIONS[2].label).toBe('Le matin (5 h à 11 h)');
  });

  it('trajet fixe : « Départ » sans « Ma position », lieux d’abord ; nom affiché ; « Enregistrer »', async () => {
    const hz = harness({ settings: preset11() });
    const el = mount(fixedTripScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Trajet fixe');
    expect(textOf(el.querySelector('.back'))).toBe('Nouveau favori');
    const dep = el.querySelector<HTMLInputElement>('#fav-de')!;
    const arr = el.querySelector<HTMLInputElement>('#fav-vers')!;
    expect(dep.value).toBe('');
    expect(textOf(el.querySelector('label[for="fav-nom"]'))).toBe('Nom affiché (« Vers le bureau »), facultatif');
    const save = button(el, 'Enregistrer');
    expect(save.disabled).toBe(true);
    dep.focus();
    dep.dispatchEvent(new Event('focus'));
    await settle();
    expect(options(el.querySelector('#fav-de-liste')!).map(([l, t]) => `${l}|${t}`)).toEqual(['Bureau|mon lieu', 'Maison|mon lieu']);
    [...el.querySelectorAll<HTMLButtonElement>('#fav-de-liste [role="option"]')].find((b) => textOf(b).startsWith('Maison'))!.click();
    expect(dep.value).toBe('Maison');
    arr.focus();
    arr.dispatchEvent(new Event('focus'));
    await settle();
    expect(options(el.querySelector('#fav-vers-liste')!).map(([l]) => l)).toEqual(['Ma position', 'Bureau', 'Maison']);
    [...el.querySelectorAll<HTMLButtonElement>('#fav-vers-liste [role="option"]')].find((b) => textOf(b).startsWith('Bureau'))!.click();
    expect(arr.value).toBe('Bureau');
    expect(save.disabled).toBe(false);
    [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Le matin (5 h à 11 h)')!.click();
    save.click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites[6]).toMatchObject({ kind: 'trip', from: { type: 'place', placeId: 'fav-maison' }, to: { type: 'place', placeId: 'fav-bureau' }, propose: 'morning' });
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
    expect(hz.settings.get().favorites).toHaveLength(7);
  });

  it('ancien lien « #/favoris/nouveau?type=trajet » : le trajet fixe', () => {
    const el = mount(newFavoriteScreen(harness({ settings: defaults(), params: 'type=trajet' }).ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Trajet fixe');
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
    expect(hz.settings.get().favorites).toHaveLength(6);
    button(el, 'Supprimer ce favori').click();
    button(el, 'Supprimer').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites.map((f) => f.id)).not.toContain('fav-gand');
  });

  it('arrêt existant : lignes et directions, créneau, « Enregistrer » ; filtre gardé', async () => {
    const hz = harness({ settings: preset11() });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gdn'));
    await until(() => el.querySelectorAll('.stop-form input[type="checkbox"]').length > 0);
    expect(el.querySelector<HTMLInputElement>('#fav-arret')!.value).toMatch(/^Gare du Nord, /);
    expect(textOf(el.querySelector<HTMLInputElement>('input[type="radio"]:checked')!.closest('label'))).toBe('Quand je suis à moins de 300 m');
    button(el, 'Enregistrer').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites.find((f) => f.id === 'fav-gdn')).toEqual(preset11().favorites.find((f) => f.id === 'fav-gdn'));
  });

  it('champ d’arrêt : la réponse d’une saisie dépassée, arrivée en retard, est ignorée (revue n° 3)', async () => {
    const pending: { q: string; done: (v: SearchItem[]) => void }[] = [];
    const item = (id: string, fr: string): SearchItem => ({ id, op: 'sncb', n: { fr, nl: fr }, modes: ['train'], lat: 50, lon: 4, kindLabel: 'gare SNCB' });
    const hz = harness({ settings: preset11(), core: (c) => ({ ...c, search: (q: string) => new Promise<SearchItem[]>((done) => pending.push({ q, done })) }) });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-namur'));
    const input = el.querySelector<HTMLInputElement>('#fav-arret')!;
    type(input, 'ga');
    await sleep(260);
    type(input, 'gand');
    await sleep(260);
    expect(pending.map((p) => p.q).slice(-2)).toEqual(['ga', 'gand']);
    pending.at(-1)!.done([item('sncb:8892007', 'Gand-Saint-Pierre'), item('sncb:8893120', 'Gand-Dampoort')]);
    await settle();
    pending.at(-2)!.done([item('sncb:1', 'Gare du Nord'), item('sncb:2', 'Gastuche')]);
    await settle();
    expect(options(el.querySelector('#fav-arret-list')!).map(([l]) => l)).toEqual(['Gand-Saint-Pierre', 'Gand-Dampoort']);
  });

  it('arrêt disparu : « Arrêt introuvable : choisis-le à nouveau » (M8)', async () => {
    const s = preset11();
    const gdn = s.favorites.find((f) => f.id === 'fav-gdn')!;
    if (gdn.kind === 'stop') gdn.areaId = 'stib:999999';
    const hz = harness({ settings: s });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gdn'));
    await until(() => textOf(el.querySelector('[role="alert"]')) !== '');
    expect(textOf(el.querySelector('[role="alert"]'))).toBe('Arrêt introuvable : choisis-le à nouveau');
  });

  it('préréglage de la 1.0 migré : mêmes favoris, lieux compris', () => {
    expect(preset().favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:fav-bureau', 'stop:fav-gdn', 'trip:fav-gand', 'stop:fav-namur', 'stop:fav-dl-nord', 'place:maison']);
  });
});
