// @vitest-environment happy-dom
/**
 * Mes favoris (T4, S3, S6) : sous-titre, « Changer l’ordre » (« Monter », « Descendre », « Terminé »), créneaux avec
 * leurs heures, trajet favori en champs unifiés (le choix s'écrit dans le champ, CA-M4.12), suppression confirmée
 * dans la page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { favoriteEditScreen, favoritesScreen, moveFavorite, PROPOSE_OPTIONS } from '../../src/phone/screens/favorites';
import { button, harness, mount, options, plain, preset, settle, textOf, until } from './helpers';

afterEach(() => document.body.replaceChildren());

const titles = (el: HTMLElement) => [...el.querySelectorAll('.list .t1')].map((t) => textOf(t));

describe('liste et ordre (S3)', () => {
  it('sous-titre de l’écran et des favoris (T4, CA-S1.1)', () => {
    const hz = harness({ settings: preset() });
    const el = mount(favoritesScreen(hz.ctx));
    expect(textOf(el.querySelector('.lead'))).toBe('En tête dans les lunettes selon l’heure et le lieu (réglage Affichage).');
    expect(titles(el)[0]).toBe('Ma position → Bureau');
    expect(textOf(el.querySelector('.list .t2'))).toBe('Trajet porte à porte, proposé le matin');
  });

  it('« Changer l’ordre » : « Monter », « Descendre », « Terminé » ; l’ordre est enregistré', async () => {
    const hz = harness({ settings: preset() });
    const el = mount(favoritesScreen(hz.ctx));
    const ids = () => hz.settings.get().favorites.map((f) => f.id);
    expect(ids()).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-namur', 'fav-dl-nord']);
    button(el, 'Changer l’ordre').click();
    const rows = () => [...el.querySelectorAll<HTMLElement>('.order-row')];
    expect(rows()).toHaveLength(5);
    // pas de « Monter » pour le premier, pas de « Descendre » pour le dernier
    expect(rows()[0].querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    expect([...rows()[4].querySelectorAll<HTMLButtonElement>('button')][1].disabled).toBe(true);
    const namur = rows()[3];
    expect(namur.querySelector('button')!.getAttribute('aria-label')).toBe('Monter Namur');
    button(namur, 'Monter').click();
    await until(() => plain(el.querySelector('.live')?.textContent) !== '');
    expect(ids()).toEqual(['fav-bureau', 'fav-gdn', 'fav-namur', 'fav-gand', 'fav-dl-nord']);
    expect(plain(el.querySelector('.live')?.textContent)).toBe('Namur : 3e sur 5.');
    // le curseur reste sur le favori déplacé
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Monter Namur');
    button(rows()[0], 'Descendre').click();
    await until(() => plain(el.querySelector('.live')?.textContent) === 'Ma position → Bureau : 2e sur 5.');
    expect(ids()[1]).toBe('fav-bureau');
    button(el, 'Terminé').click();
    expect(el.querySelectorAll('.order-row')).toHaveLength(0);
    expect(titles(el)[0]).toBe('Gare du Nord');
  });

  it('moveFavorite : bornes respectées', () => {
    const list = preset().favorites;
    expect(moveFavorite(list, 'fav-bureau', -1)).toBe(list);
    expect(moveFavorite(list, 'fav-dl-nord', 1)).toBe(list);
    expect(moveFavorite(list, 'fav-gdn', -1).map((f) => f.id).slice(0, 2)).toEqual(['fav-gdn', 'fav-bureau']);
  });
});

describe('formulaire d’un favori (T4)', () => {
  it('créneaux avec leurs heures (S3)', () => {
    expect(PROPOSE_OPTIONS.map((o) => plain(o.label))).toEqual(['Jamais', 'Quand je suis à moins de 300 m', 'Le matin (5 h à 11 h)', 'Le soir (15 h à 21 h)']);
    expect(PROPOSE_OPTIONS[2].label).toBe('Le matin (5 h à 11 h)');
  });

  it('trajet favori : « Départ » et « Arrivée » affichent le choix (« Bureau », CA-M4.12) ; nom affiché', async () => {
    const hz = harness({ settings: preset(), params: 'type=trajet' });
    const el = mount(favoriteEditScreen(hz.ctx, 'nouveau'));
    const dep = el.querySelector<HTMLInputElement>('#fav-de')!;
    const arr = el.querySelector<HTMLInputElement>('#fav-vers')!;
    expect(dep.value).toBe('Ma position');
    expect(textOf(el.querySelector('label[for="fav-nom"]'))).toBe('Nom affiché (« Vers le bureau »), facultatif');
    const save = button(el, 'Enregistrer le favori');
    expect(save.disabled).toBe(true);
    arr.focus();
    await settle();
    const list = el.querySelector('#fav-vers-liste')!;
    expect(options(list).map(([l, t]) => `${l}|${t}`)).toEqual(['Ma position|position actuelle', 'Maison|mon lieu', 'Bureau|mon lieu']);
    [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b).startsWith('Bureau'))!.click();
    expect(arr.value).toBe('Bureau');
    expect(save.disabled).toBe(false);
    [...el.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => textOf(r.closest('label')) === 'Le matin (5 h à 11 h)')!.click();
    save.click();
    await until(() => hz.settings.get().favorites.length === 6);
    expect(hz.settings.get().favorites[5]).toMatchObject({ kind: 'trip', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, propose: 'morning' });
  });

  it('trajet favori existant : les champs montrent ses extrémités', () => {
    const hz = harness({ settings: preset() });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gand'));
    expect(el.querySelector<HTMLInputElement>('#fav-de')!.value).toBe('Bruxelles-Central');
    expect(el.querySelector<HTMLInputElement>('#fav-vers')!.value).toBe('Gand-Saint-Pierre');
  });

  it('suppression confirmée dans la page : « Supprimer ce favori ? », « Supprimer », « Annuler » (S6)', async () => {
    const hz = harness({ settings: preset() });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gand'));
    expect(() => button(el, 'Mettre en premier')).toThrow();
    button(el, 'Supprimer ce favori').click();
    expect(textOf(el.querySelector('.confirm-q'))).toBe('Supprimer ce favori ?');
    expect(el.querySelector('.confirm-q')!.textContent).toBe('Supprimer ce favori ?');
    button(el, 'Annuler').click();
    expect(hz.settings.get().favorites).toHaveLength(5);
    button(el, 'Supprimer ce favori').click();
    button(el, 'Supprimer').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().favorites.map((f) => f.id)).not.toContain('fav-gand');
  });

  it('arrêt disparu : « Arrêt introuvable : choisis-le à nouveau » (M8)', async () => {
    const s = preset();
    const gdn = s.favorites.find((f) => f.id === 'fav-gdn')!;
    if (gdn.kind === 'stop') gdn.areaId = 'stib:999999';
    const hz = harness({ settings: s });
    const el = mount(favoriteEditScreen(hz.ctx, 'fav-gdn'));
    await until(() => textOf(el.querySelector('[role="alert"]')) !== '');
    expect(textOf(el.querySelector('[role="alert"]'))).toBe('Arrêt introuvable : choisis-le à nouveau');
  });
});
