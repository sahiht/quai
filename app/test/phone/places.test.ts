// @vitest-environment happy-dom
/**
 * Mes lieux (T3, M4.6 à M4.10, S3, S4) : lieu par adresse ou par arrêt, jamais de coordonnées, lieux 1.0 « Adresse à
 * vérifier » et « Vérifier l’adresse » prérempli, question après un nouveau lieu (créneau proposé d'office),
 * adresses récentes effacées, suppression confirmée dans la page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { placeEditScreen, placesScreen } from '../../src/phone/screens/places';
import { placeSubtitle } from '../../src/phone/text';
import { button, defaults, harness, mount, options, preset, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => document.body.replaceChildren());

/** Aucune coordonnée à l'écran (« 50.4655, 4.8590 »). */
const noCoords = (el: HTMLElement): void => expect(el.textContent ?? '').not.toMatch(/\d{1,2}[.,]\d{3,}\s*[,;]\s*\d{1,3}[.,]\d{3,}/);

async function pick(el: HTMLElement, input: HTMLInputElement, text: string, label: string): Promise<void> {
  type(input, text);
  await sleep(GEO_DELAY_MS + 60);
  await settle();
  const list = el.querySelector(`#${input.id}-liste`)!;
  await until(() => options(list).some(([l]) => l.startsWith(label)));
  [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b.querySelector('.s1')).startsWith(label))!.click();
}

describe('sous-titres des lieux (T3)', () => {
  it('adresse normalisée, « Près de {arrêt} », « Adresse à vérifier » ; jamais de coordonnées', () => {
    expect(placeSubtitle({ id: 'a', label: 'Bureau', lat: 50.8, lon: 4.3, src: 'address', address: 'Rue de Fer 25, 5000 Namur' })).toBe('Rue de Fer 25, 5000 Namur');
    expect(placeSubtitle({ id: 'a', label: 'X', lat: 50.8, lon: 4.3, src: 'address', address: 'Rue Neuve, 1000 Bruxelles', approx: true })).toBe('Rue Neuve, 1000 Bruxelles (sans numéro)');
    expect(placeSubtitle({ id: 'a', label: 'Gare', lat: 50.8, lon: 4.3, src: 'stop', address: 'Près de Namur', areaId: 'sncb:8863008' })).toBe('Près de Namur');
    expect(placeSubtitle({ id: 'a', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Namur' })).toBe('Adresse à vérifier');
    expect(placeSubtitle({ id: 'a', label: 'Ici', lat: 50.4655, lon: 4.859, src: 'here' })).not.toMatch(/\d/);
    expect(placeSubtitle({ id: 'a', label: 'Vieux', lat: 50.4655, lon: 4.859 })).not.toMatch(/\d/);
  });

  it('« Mes lieux » avec les réglages 1.0 : Maison et Bureau « Adresse à vérifier » (CA-M4.10)', async () => {
    const hz = harness({ settings: preset() });
    const el = mount(placesScreen(hz.ctx));
    const rows = [...el.querySelectorAll('.list .row')];
    expect(rows.map((r) => textOf(r.querySelector('.t1')))).toEqual(['Maison', 'Bureau']);
    expect(rows.map((r) => textOf(r.querySelector('.t2')))).toEqual(['Adresse à vérifier', 'Adresse à vérifier']);
    await until(() => rows.every((r) => textOf(r.querySelector('.t3')) !== ''));
    expect(textOf(rows[0].querySelector('.t3'))).toMatch(/^Namur à \d+ min à pied/);
    noCoords(el);
  });
});

describe('nouveau lieu (M4.7, CA-M4.9)', () => {
  it('raccourci « Bureau », adresse tapée puis choisie, « Enregistrer le lieu » : 3 touchers et 1 saisie, sans coordonnées', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(placeEditScreen(hz.ctx, 'nouveau'));
    expect(textOf(el.querySelector('h1'))).toBe('Nouveau lieu');
    const save = button(el, 'Enregistrer le lieu');
    expect(save.disabled).toBe(true);
    expect(textOf(el.querySelector('#pl-hint'))).toBe('Donne un nom au lieu.');
    button(el, 'Bureau').click(); // 1
    expect(el.querySelector<HTMLInputElement>('#pl-name')!.value).toBe('Bureau');
    expect(textOf(el.querySelector('#pl-hint'))).toBe('Choisis une adresse ou un arrêt dans la liste.');
    const addr = el.querySelector<HTMLInputElement>('#pl-addr')!;
    expect(addr.placeholder).toBe('Rue et numéro, commune');
    await pick(el, addr, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur'); // saisie, 2
    expect(addr.value).toBe('Rue de Fer 25, 5000 Namur');
    // confirmation : adresse normalisée puis l'accès
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Rue de Fer 25, 5000 Namur');
    await until(() => textOf(el.querySelector('.spot .t3')) !== '…');
    expect(textOf(el.querySelector('.spot .t3'))).toMatch(/à \d+ min/);
    noCoords(el);
    expect(save.disabled).toBe(false);
    save.click(); // 3
    await until(() => hz.went.length > 0);
    const p = hz.settings.get().places[0];
    expect(p).toMatchObject({ label: 'Bureau', src: 'address', address: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648 });
    expect(hz.went[0]).toBe(`#/lieux?nouveau=${p.id}`);
  });

  it('adresse choisie puis texte corrigé sans nouveau choix : plus rien à enregistrer (revue n° 2)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(placeEditScreen(hz.ctx, 'nouveau'));
    type(el.querySelector<HTMLInputElement>('#pl-name')!, 'Bureau');
    const addr = el.querySelector<HTMLInputElement>('#pl-addr')!;
    await pick(el, addr, 'rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur');
    const save = button(el, 'Enregistrer le lieu');
    expect(save.disabled).toBe(false);
    type(addr, 'rue de fer 52 namur');
    expect(save.disabled).toBe(true);
    expect(el.querySelector('.spot')!.childElementCount).toBe(0);
    expect(textOf(el.querySelector('#pl-hint'))).toBe('Choisis une adresse ou un arrêt dans la liste.');
    save.click();
    await settle();
    expect(hz.settings.get().places).toEqual([]);
    expect(hz.went).toEqual([]);
  });

  it('rue sans numéro : « Position approximative : la rue, sans numéro. » (F2-c)', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(placeEditScreen(hz.ctx, 'nouveau'));
    await pick(el, el.querySelector<HTMLInputElement>('#pl-addr')!, 'rue neuve bruxelles', 'Rue Neuve, 1000 Bruxelles');
    expect(textOf(el.querySelector('.spot .t2'))).toBe('Position approximative : la rue, sans numéro.');
  });

  it('un arrêt choisi dans le champ place le lieu à cet arrêt : « Près de Namur » (M4.7)', async () => {
    const hz = harness({ settings: defaults(), flags: { geo: 'down' } });
    const el = mount(placeEditScreen(hz.ctx, 'nouveau'));
    type(el.querySelector<HTMLInputElement>('#pl-name')!, 'Gare');
    await pick(el, el.querySelector<HTMLInputElement>('#pl-addr')!, 'namur', 'Namur');
    expect(textOf(el.querySelector('#pl-addr-etat'))).toBe('');
    expect(textOf(el.querySelector('.spot .t1'))).toBe('Près de Namur');
    button(el, 'Enregistrer le lieu').click();
    await until(() => hz.settings.get().places.length === 1);
    expect(hz.settings.get().places[0]).toMatchObject({ label: 'Gare', src: 'stop', areaId: 'sncb:8863008', address: 'Près de Namur' });
  });

  it('« Utiliser ma position actuelle », sous-titre « si tu es sur place » ; jamais de coordonnées', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(placeEditScreen(hz.ctx, 'nouveau'));
    const here = button(el, /^Utiliser ma position actuelle/);
    expect(textOf(here.querySelector('.sub'))).toBe('si tu es sur place');
    type(el.querySelector<HTMLInputElement>('#pl-name')!, 'Ici');
    here.click();
    await until(() => !button(el, 'Enregistrer le lieu').disabled);
    noCoords(el);
    button(el, 'Enregistrer le lieu').click();
    await until(() => hz.settings.get().places.length === 1);
    expect(hz.settings.get().places[0]).toMatchObject({ label: 'Ici', src: 'here' });
  });

  it('mention de vie privée sous le champ', () => {
    const hz = harness({ settings: defaults() });
    const el = mount(placeEditScreen(hz.ctx, 'nouveau'));
    expect(textOf(el.querySelector('.privacy'))).toContain('Seul le texte tapé leur est envoyé');
  });
});

describe('lieu de la 1.0 : « Vérifier l’adresse » (M4.8, CA-M4.10)', () => {
  it('le champ s’ouvre avec le texte libre prérempli ; l’adresse choisie remplace le texte libre', async () => {
    const s = preset();
    s.places[0].address = 'rue de fer 25 namur';
    const hz = harness({ settings: s });
    const el = mount(placeEditScreen(hz.ctx, 'maison'));
    expect(textOf(el.querySelector('.verify strong'))).toBe('Adresse à vérifier');
    const addr = el.querySelector<HTMLInputElement>('#pl-addr')!;
    button(el, 'Vérifier l’adresse').click();
    expect(addr.value).toBe('rue de fer 25 namur');
    await sleep(GEO_DELAY_MS + 60);
    await settle();
    const list = el.querySelector('#pl-addr-liste')!;
    await until(() => options(list).length > 0);
    expect(options(list)[0]).toEqual(['Rue de Fer 25, 5000 Namur', 'adresse']);
    list.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    button(el, 'Enregistrer le lieu').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().places[0]).toMatchObject({ id: 'maison', label: 'Maison', src: 'address', address: 'Rue de Fer 25, 5000 Namur' });
    // les favoris vers ce lieu sont gardés (même identifiant)
    expect(hz.settings.get().favorites.map((f) => f.id)).toEqual(preset().favorites.map((f) => f.id));
  });

  it('« Près de Bruxelles-Central » (lieu 1.0 placé à un arrêt) : le champ reçoit le nom de l’arrêt', async () => {
    const s = preset();
    s.places[1].address = 'Près de Bruxelles-Central';
    const hz = harness({ settings: s });
    const el = mount(placeEditScreen(hz.ctx, 'bureau'));
    button(el, 'Vérifier l’adresse').click();
    expect(el.querySelector<HTMLInputElement>('#pl-addr')!.value).toBe('Bruxelles-Central');
  });
});

describe('après un nouveau lieu (S3)', () => {
  it('« Ajouter le trajet vers Bureau à tes favoris ? », « Le matin » proposé d’office, « Ajouter aux favoris »', async () => {
    const s = defaults();
    s.places = [{ id: 'lieu-1', label: 'Bureau', lat: 50.8441, lon: 4.3474, address: 'Rue Royale 1, 1000 Bruxelles', src: 'address' }];
    const hz = harness({ settings: s, params: 'nouveau=lieu-1' });
    const el = mount(placesScreen(hz.ctx));
    expect(textOf(el.querySelector('.offer .confirm-q'))).toBe('Ajouter le trajet vers Bureau à tes favoris ?');
    expect(el.querySelector('.offer .confirm-q')!.textContent).toContain('favoris ?');
    const checked = el.querySelector<HTMLInputElement>('.offer input[type="radio"]:checked')!;
    expect(textOf(checked.closest('label'))).toBe('Le matin (5 h à 11 h)');
    button(el, 'Ajouter aux favoris').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'trip', from: { type: 'here' }, to: { type: 'place', placeId: 'lieu-1' }, propose: 'morning' });
    await until(() => textOf(el.querySelector('.offer .msg')) !== '');
    expect(textOf(el.querySelector('.offer .msg'))).toBe('Ajouté à tes favoris.');
  });

  it('« Maison » : « Le soir » d’office ; « Non merci » ne crée rien', async () => {
    const s = defaults();
    s.places = [{ id: 'lieu-2', label: 'Maison', lat: 50.4655, lon: 4.859, address: 'Rue de Fer 25, 5000 Namur', src: 'address' }];
    const hz = harness({ settings: s, params: 'nouveau=lieu-2' });
    const el = mount(placesScreen(hz.ctx));
    expect(textOf(el.querySelector<HTMLInputElement>('.offer input[type="radio"]:checked')!.closest('label'))).toBe('Le soir (15 h à 21 h)');
    button(el, 'Non merci').click();
    expect(el.querySelector('.offer')).toBeNull();
    await settle();
    expect(hz.settings.get().favorites).toHaveLength(0);
  });
});

describe('adresses récentes et suppression', () => {
  it('« Effacer les adresses récentes » les retire partout (CA-S4.2)', async () => {
    const s = defaults();
    s.recent = [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }];
    const hz = harness({ settings: s });
    const el = mount(placesScreen(hz.ctx));
    expect(textOf(el)).toContain('Veldstraat 1, 9000 Gent');
    button(el, 'Effacer les adresses récentes').click();
    await until(() => hz.went.length > 0);
    expect(hz.settings.get().recent).toEqual([]);
    expect(hz.went.at(-1)).toBe('#/lieux');
  });

  it('suppression confirmée dans la page, sans boîte du système (S6, T3)', async () => {
    const hz = harness({ settings: preset() });
    const el = mount(placeEditScreen(hz.ctx, 'bureau'));
    const confirm = globalThis.confirm;
    globalThis.confirm = () => {
      throw new Error('boîte du système');
    };
    try {
      button(el, 'Supprimer ce lieu').click();
      expect(textOf(el.querySelector('.confirm-q'))).toBe('Supprimer le lieu « Bureau » ? Les trajets favoris vers ce lieu seront aussi supprimés.');
      button(el, 'Annuler').click();
      expect(el.querySelector('.confirm')).toBeNull();
      button(el, 'Supprimer ce lieu').click();
      button(el, 'Supprimer').click();
      await until(() => hz.went.length > 0);
      expect(hz.settings.get().places.map((p) => p.id)).toEqual(['maison']);
      expect(hz.settings.get().favorites.some((f) => f.id === 'fav-bureau')).toBe(false);
    } finally {
      globalThis.confirm = confirm;
    }
  });
});
