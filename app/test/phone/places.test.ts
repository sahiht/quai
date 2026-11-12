// @vitest-environment happy-dom
/**
 * Lieux, favoris de la 1.2 (PRD-1.2 § 2.2) : « Nouveau favori » (champ unique avec « Ma position actuelle »), lieu par
 * adresse, par arrêt (« Le trajet pour y aller », toujours en 1.2.2, avec le lien vers « Gares » ou « Bus, tram,
 * métro », revue d'usage n° 3) ou par la position, jamais de coordonnées, créneau proposé d'office (« Bureau » le
 * matin), lieux 1.0 « Adresse à vérifier », suppression d'un lieu utilisé par un trajet fixe, limite des 32 favoris.
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

describe('« Nouveau favori » (PRD-1.2 § 2.2, PRD-1.2.1 § 7.1)', () => {
  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')];
  const panelOf = (el: HTMLElement, tab: HTMLElement) => el.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`)!;

  it('CA-121.6 : en haut, deux choix de même taille et de même style, « Un endroit » choisi d’office ; le lien du bas a disparu', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    expect(textOf(el.querySelector('h1'))).toBe('Nouveau favori');
    expect(textOf(el.querySelector('.back'))).toBe('Mes favoris');
    // juste sous l'en-tête, avant tout formulaire
    expect(el.querySelector('header')!.nextElementSibling!.getAttribute('role')).toBe('tablist');
    const list = el.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-label')).toBe('Type de favori');
    const [placeTab, tripTab] = tabs(el);
    expect([placeTab, tripTab].map((t) => [textOf(t.querySelector('.k1')), textOf(t.querySelector('.k2'))])).toEqual([
      ['Un endroit', 'adresse, gare ou arrêt'],
      ['Un trajet de A à B', 'départ et arrivée fixes'],
    ]);
    // « A à B » insécable : jamais un « B » seul sur sa ligne
    expect(tripTab.querySelector('.k1')!.textContent).toBe('Un trajet de A\u00a0à\u00a0B');
    // même taille, même style : mêmes éléments, mêmes classes, colonnes égales de la grille (mesuré dans Chrome)
    expect([placeTab.tagName, placeTab.className, placeTab.children.length]).toEqual([tripTab.tagName, tripTab.className, tripTab.children.length]);
    expect(list.className).toBe('kinds');
    // accessibles : nom (titre) et description (sous-titre), état, un seul dans l'ordre de tabulation
    expect(placeTab.getAttribute('aria-labelledby')).toBe(placeTab.querySelector('.k1')!.id);
    expect(placeTab.getAttribute('aria-describedby')).toBe(placeTab.querySelector('.k2')!.id);
    expect([placeTab, tripTab].map((t) => [t.getAttribute('aria-selected'), t.tabIndex])).toEqual([
      ['true', 0],
      ['false', -1],
    ]);
    expect(panelOf(el, placeTab).hidden).toBe(false);
    expect(panelOf(el, tripTab).hidden).toBe(true);
    expect(panelOf(el, placeTab).getAttribute('aria-labelledby')).toBe(placeTab.querySelector('.k1')!.id);
    // « Un endroit » : le formulaire actuel ; le lien « Un trajet fixe » n'existe plus
    expect(panelOf(el, placeTab).querySelector('#nf-lieu')).not.toBeNull();
    expect(el.textContent).not.toContain('Un trajet fixe');
    expect([...el.querySelectorAll('button')].map((b) => textOf(b))).not.toContain('Un trajet fixe, d’un endroit à un autre');
    expect(el.querySelector('.btn-link')).toBeNull();
  });

  it('« Un trajet de A à B » : le formulaire du trajet fixe (Départ, Arrivée, nom, créneau) ; clavier ; rien de perdu en changeant', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(newFavoriteScreen(hz.ctx));
    const [placeTab, tripTab] = tabs(el);
    const input = el.querySelector<HTMLInputElement>('#nf-lieu')!;
    type(input, 'rue de fer');
    tripTab.click();
    expect([placeTab, tripTab].map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect([placeTab.tabIndex, tripTab.tabIndex]).toEqual([-1, 0]);
    const panel = panelOf(el, tripTab);
    expect(panel.hidden).toBe(false);
    expect(panelOf(el, placeTab).hidden).toBe(true);
    expect(['fav-de', 'fav-vers', 'fav-nom'].map((id) => textOf(panel.querySelector(`label[for="${id}"]`)))).toEqual(['Départ', 'Arrivée', 'Nom affiché (« Vers le bureau »), facultatif']);
    expect(textOf(panel.querySelector('legend'))).toBe('En tête de l’accueil');
    expect(button(panel, 'Enregistrer').disabled).toBe(true);
    // flèches gauche et droite, Début et Fin : le choix suit le curseur
    tripTab.focus();
    tripTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(placeTab);
    expect(placeTab.getAttribute('aria-selected')).toBe('true');
    placeTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(tripTab);
    expect(tripTab.getAttribute('aria-selected')).toBe('true');
    tripTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(placeTab);
    expect(placeTab.getAttribute('aria-selected')).toBe('true');
    placeTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(placeTab);
    // ce qui était tapé est toujours là
    expect(input.value).toBe('rue de fer');
    await settle();
    expect(hz.settings.get().favorites).toEqual([]);
  });

  it('textes de « Un endroit » : champ « Adresse, gare ou arrêt » avec en tête « Ma position actuelle », mention', async () => {
    const hz = harness({ settings: defaults({ recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }] }) });
    const el = mount(newFavoriteScreen(hz.ctx));
    const input = el.querySelector<HTMLInputElement>('#nf-lieu')!;
    expect(textOf(el.querySelector('label[for="nf-lieu"]'))).toBe('Adresse, gare ou arrêt');
    // le curseur va dans ce champ à l'ouverture, pas dans le « Départ » caché du trajet
    expect(input.hasAttribute('data-autofocus')).toBe(true);
    expect(el.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(el.querySelector('#nf-lieu-liste')!).length > 0);
    expect(options(el.querySelector('#nf-lieu-liste')!)).toEqual([
      ['Ma position actuelle', 'si tu es sur place'],
      ['Veldstraat 1, 9000 Gent', 'récent'],
    ]);
    expect(textOf(el.querySelector('.privacy'))).toContain('Seul le texte tapé leur est envoyé');
  });

  it('trajet de A à B enregistré depuis « Nouveau favori » : retour à « Mes favoris »', async () => {
    const s = defaults({ favorites: [place('lieu-m', 'Maison'), place('lieu-b', 'Bureau', { lat: 50.8505, lon: 4.3545, address: 'Rue Neuve 1, 1000 Bruxelles' })] });
    const hz = harness({ settings: s });
    const el = mount(newFavoriteScreen(hz.ctx));
    tabs(el)[1].click();
    for (const [id, label] of [['fav-de', 'Maison'], ['fav-vers', 'Bureau']] as const) {
      const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
      input.focus();
      input.dispatchEvent(new Event('focus'));
      await settle();
      [...el.querySelectorAll<HTMLButtonElement>(`#${id}-liste [role="option"]`)].find((b) => textOf(b.querySelector('.s1')) === label)!.click();
    }
    button(el.querySelector('.trip-form')!, 'Enregistrer').click();
    await until(() => hz.went.length > 0);
    expect(hz.went).toEqual(['#/favoris']);
    expect(hz.settings.get().favorites[2]).toMatchObject({ kind: 'trip', from: { type: 'place', placeId: 'lieu-m' }, to: { type: 'place', placeId: 'lieu-b' }, propose: 'never' });
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
    const legend = [...el.querySelectorAll('legend')].find((l) => textOf(l) === 'En tête de l’accueil')!;
    expect([...legend.parentElement!.querySelectorAll('label')].map((l) => textOf(l))).toEqual(['Automatique', 'Le matin (5 h à 11 h)', 'Le soir (15 h à 21 h)']);
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
    // « Jamais » s'appelle « Automatique » (revue d'usage n° 11), même valeur enregistrée
    expect(checked()).toBe('Automatique');
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

  it('revue d’usage n° 3 : une gare donne toujours un lieu « Près de Namur » ; le lien l’ajoute à « Gares », jamais un arrêt favori', async () => {
    const hz = harness({ settings: defaults(), flags: { geo: 'down' } });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'namur', 'Namur', 'gare SNCB');
    // plus de choix « Dans les lunettes » : le formulaire du lieu, directement
    expect([...el.querySelectorAll('legend')].map((l) => textOf(l))).not.toContain('Dans les lunettes');
    expect(el.textContent).not.toContain('Ses prochains départs »');
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Près de Namur');
    expect(el.querySelector<HTMLInputElement>('#pl-nom')!.value).toBe('Namur');
    // au-dessus du formulaire, le lien vers « Gares »
    const link = el.querySelector<HTMLButtonElement>('.jump')!;
    expect(link.compareDocumentPosition(el.querySelector('.place-form')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.textContent).toBe('Ses prochains départs\u00a0: ajouter Namur à Gares');
    link.click();
    await until(() => textOf(el.querySelector('.jump-box .msg')) !== '');
    expect(textOf(el.querySelector('.jump-box .msg'))).toBe('Namur ajoutée à Gares.');
    expect(hz.settings.get().stations).toEqual([expect.objectContaining({ areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' } })]);
    link.click();
    await until(() => textOf(el.querySelector('.jump-box .msg')) === 'Déjà dans tes gares.');
    expect(hz.settings.get().stations).toHaveLength(1);
    // le lieu s'enregistre comme avant ; aucun favori « stop » dans les réglages (critère du n° 3)
    button(el, 'Enregistrer').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'place', label: 'Namur', src: 'stop', areaId: 'sncb:8863008', address: 'Près de Namur', propose: 'never' });
    expect(hz.settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
  });

  it('revue d’usage n° 3 : un arrêt de tram donne un lieu ; le lien mène à « Ajouter une ligne », arrêt présélectionné', async () => {
    const hz = harness({ settings: defaults(), flags: { geo: 'down' } });
    const el = mount(newFavoriteScreen(hz.ctx));
    await pick(el, el.querySelector<HTMLInputElement>('#nf-lieu')!, 'gare du nord', 'Gare du Nord', 'tram STIB');
    const link = el.querySelector<HTMLAnchorElement>('a.jump')!;
    expect(textOf(link)).toBe('Ses prochains passages : choisir une ligne dans Bus, tram, métro');
    expect(link.getAttribute('href')).toBe('#/lignes/ajouter?arret=stib%3A6357F');
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Près de Gare du Nord');
    // pas de lien « Gares » pour un arrêt de tram, rien d'ajouté tant qu'on n'a pas choisi de ligne
    expect(el.querySelector('button.jump')).toBeNull();
    expect(hz.settings.get().lines).toEqual([]);
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
    expect(textOf(el.querySelector('#pl-hint'))).toBe('Donne un nom à cet endroit.');
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
