// @vitest-environment happy-dom
/**
 * Rechercher un trajet (T2, M3, M4, M5, S3, S4) : cartes étiquetées et expliquées, bouton « Lunettes » par carte
 * (TripRequest avec le résultat entier et l'indice ; message à côté du bouton touché seulement), choix unique
 * annoncé, « Enregistrer comme lieu », « Garder en favori », états vides avec leur issue, adresses récentes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/settings';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { searchScreen, withRecent } from '../../src/phone/screens/search';
import { button, defaults, harness, mount, NB, options, preset, SCENARIO, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => document.body.replaceChildren());

type Hz = ReturnType<typeof harness>;
const cards = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.result')];
const tags = (root: ParentNode) => cards(root).map((c) => textOf(c.querySelector('.tag')));

function open(opts: Parameters<typeof harness>[0] = {}) {
  const hz = harness(opts);
  const el = mount(searchScreen(hz.ctx));
  return { ...hz, el, dep: el.querySelector<HTMLInputElement>('#r-depart')!, arr: el.querySelector<HTMLInputElement>('#r-arrivee')! };
}

/** Tape dans « Arrivée » et choisit la proposition dont le libellé commence par `label`. */
async function arrive(hz: { arr: HTMLInputElement; el: HTMLElement }, text: string, label: string): Promise<void> {
  type(hz.arr, text);
  await sleep(GEO_DELAY_MS + 60);
  await settle();
  const list = hz.el.querySelector('#r-arrivee-liste')!;
  await until(() => options(list).some(([l]) => l.startsWith(label)));
  [...list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b.querySelector('.s1')).startsWith(label))!.click();
}

const results = async (el: HTMLElement): Promise<void> => {
  await until(() => !textOf(el.querySelector('.live')).startsWith('Recherche') && textOf(el.querySelector('.live')) !== '');
  await settle();
};

describe('cartes de résultats (M3, M4.5)', () => {
  it('gare à gare (S3) : une carte par trajet, étiquette, raison, son bouton « Lunettes » ; « 3 trajets. » annoncé', async () => {
    const hz = open({ params: 'de=sncb:8813003&vers=sncb:8892007' });
    await results(hz.el);
    expect(textOf(hz.el.querySelector('.live'))).toBe('3 trajets.');
    expect(tags(hz.el)).toEqual(['Le plus simple', 'Le suivant', 'Le suivant']);
    const first = cards(hz.el)[0];
    expect(textOf(first.querySelector('.time'))).toBe('14:10 → 14:39');
    expect(textOf(first.querySelector('.why'))).toBe('Le plus simple, et aussi le plus rapide.');
    expect(textOf(cards(hz.el)[1].querySelector('.why'))).toBe('Même trajet, départ suivant.');
    // plus de grand bouton en bas
    expect(hz.el.textContent).not.toContain('Afficher dans les lunettes');
    expect(hz.el.querySelectorAll('.result .btn-glasses')).toHaveLength(3);
  });

  it('choix unique pour les lecteurs d’écran : radiogroup, radio, nom du bouton « Afficher Le plus simple dans les lunettes » (CA-M4.13)', async () => {
    const hz = open({ params: 'de=sncb:8813003&vers=sncb:8892007' });
    await results(hz.el);
    const group = hz.el.querySelector('[role="radiogroup"]')!;
    expect(group).not.toBeNull();
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const btns = cards(hz.el).map((c) => c.querySelector('.btn-glasses')!.getAttribute('aria-label'));
    expect(btns).toEqual(['Afficher Le plus simple dans les lunettes', 'Afficher Le suivant dans les lunettes', 'Afficher Le suivant dans les lunettes']);
    (radios[2] as HTMLElement).click();
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    radios[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('« Lunettes » de la 2e carte : TripRequest (résultat entier, indice 1) et message à côté de ce bouton seulement (CA-M2.6)', async () => {
    const hz = open({ params: 'de=sncb:8813003&vers=sncb:8892007' });
    await results(hz.el);
    const [c0, c1] = cards(hz.el);
    c0.querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => textOf(c0.querySelector('.msg')) !== '');
    c1.querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => textOf(c1.querySelector('.msg')) !== '');
    expect(hz.glasses.trips).toHaveLength(2);
    const req = hz.glasses.trips[1];
    expect(req.index).toBe(1);
    expect(req.result.journeys).toHaveLength(3);
    expect(req.title).toBe('Vers Gand-Saint-Pierre');
    expect(req.from).toMatchObject({ type: 'area', areaId: 'sncb:8813003' });
    expect(req.to).toMatchObject({ type: 'area', areaId: 'sncb:8892007' });
    expect(textOf(c1.querySelector('.msg'))).toBe('Affiché dans les lunettes : IC 14:22.');
    expect(textOf(c0.querySelector('.msg'))).toBe('');
    // la carte touchée devient la carte choisie
    expect(c1.querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('lunettes absentes : message d’erreur à côté du bouton ; Quai Web : l’onglet Lunettes s’ouvre après showTrip', async () => {
    const off = open({ params: 'de=sncb:8813003&vers=sncb:8892007', glasses: false });
    await results(off.el);
    const c = cards(off.el)[0];
    c.querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => textOf(c.querySelector('.msg')) !== '');
    expect(textOf(c.querySelector('.msg'))).toBe('Lunettes indisponibles pour l’instant.');
    expect(c.querySelector('.msg')!.classList.contains('err')).toBe(true);

    const web = harness({ params: 'de=sncb:8813003&vers=sncb:8892007', web: true });
    let shown = 0;
    web.ctx.showGlasses = () => shown++;
    const el = mount(searchScreen(web.ctx));
    await results(el);
    cards(el)[0].querySelector<HTMLButtonElement>('.btn-glasses')!.click();
    await until(() => shown === 1);
    expect(web.glasses.trips).toHaveLength(1);
  });

  it('« Le plus simple » et « Le plus rapide » différents : leurs phrases (S1, noRT, vers Rue Neuve 1 ; F3-b)', async () => {
    const hz = open({ settings: preset(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    await arrive(hz, 'rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles');
    await results(hz.el);
    expect(tags(hz.el).slice(0, 2)).toEqual(['Le plus simple', 'Le plus rapide']);
    const [simple, fast] = cards(hz.el);
    expect(textOf(simple.querySelector('.why'))).toBe('Le moins de changements et de marche.');
    expect(textOf(fast.querySelector('.why'))).toBe('Arrive 5 min plus tôt, avec 1 changement de plus.');
    expect(fast.querySelector('.why')!.textContent).toContain(`5${NB}min`);
    expect(textOf(simple.querySelector('.time'))).toMatch(/^07:3\d → 08:56$/);
  });
});

describe('adresse dans « Arrivée » (M4.4, M4.6, S4)', () => {
  it('le choix lance la recherche, « Enregistrer comme lieu » apparaît, l’adresse devient récente', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'veldstraat 1 gent', 'Veldstraat 1, 9000 Gent');
    expect(hz.arr.value).toBe('Veldstraat 1, 9000 Gent');
    await results(hz.el);
    expect(cards(hz.el).length).toBeGreaterThan(0);
    expect(textOf(cards(hz.el)[0].querySelector('.tag'))).toBe('Le plus simple');
    expect(() => button(hz.el, 'Enregistrer comme lieu')).not.toThrow();
    expect(() => button(hz.el, 'Enregistrer l’adresse comme lieu')).not.toThrow();
    await hz.settings.flush();
    expect(hz.settings.get().recent[0]).toMatchObject({ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 });
  });

  it('« Enregistrer comme lieu » : nom, « Enregistrer le lieu » ; le lieu est enregistré par son adresse (CA-M4.5)', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'veldstraat 1 gent', 'Veldstraat 1, 9000 Gent');
    await results(hz.el);
    button(hz.el, 'Enregistrer comme lieu').click();
    const save = button(hz.el, 'Enregistrer le lieu');
    expect(save.disabled).toBe(true);
    // raccourcis de nom
    expect([...hz.el.querySelectorAll('.save-panel .shortcut')].map((b) => textOf(b))).toEqual(['Maison', 'Bureau', 'École']);
    const name = hz.el.querySelector<HTMLInputElement>('.save-panel input')!;
    type(name, 'Rendez-vous');
    expect(save.disabled).toBe(false);
    save.click();
    await until(() => hz.settings.get().places.length === 1);
    expect(hz.settings.get().places[0]).toMatchObject({ label: 'Rendez-vous', address: 'Veldstraat 1, 9000 Gent', src: 'address', lat: 51.0537, lon: 3.7225 });
    await until(() => textOf(hz.el.querySelector('.save-link .msg')) !== '');
    expect(textOf(hz.el.querySelector('.save-link .msg'))).toBe('Lieu enregistré : Rendez-vous.');
    // l'arrivée est désormais ce lieu ; plus de lien d'enregistrement
    expect(hz.arr.value).toBe('Rendez-vous');
    expect(() => button(hz.el, 'Enregistrer comme lieu')).toThrow();
  });

  it('« Garder en favori » : « Ajouté à tes favoris. », puis « Déjà dans tes favoris. » (S3, CA-S3.1)', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'veldstraat 1 gent', 'Veldstraat 1, 9000 Gent');
    await results(hz.el);
    button(hz.el, 'Garder en favori').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'trip', from: { type: 'here' }, to: { type: 'address', label: 'Veldstraat 1, 9000 Gent' }, label: 'Veldstraat 1', propose: 'never' });
    const msg = () => textOf(hz.el.querySelector('.below-results .msg'));
    await until(() => msg() !== '');
    expect(msg()).toBe('Ajouté à tes favoris.');
    button(hz.el, 'Garder en favori').click();
    await until(() => msg() === 'Déjà dans tes favoris.');
    expect(hz.settings.get().favorites).toHaveLength(1);
  });

  it('adresses récentes : 5 au plus, la plus récente d’abord, sans doublon (S4)', () => {
    let s = defaults();
    for (let i = 1; i <= 7; i++) s = withRecent(s, { label: `Rue ${i}, 1000 Bruxelles`, lat: 50.85, lon: 4.35 }, i);
    expect(s.recent.map((r) => r.label)).toEqual(['Rue 7, 1000 Bruxelles', 'Rue 6, 1000 Bruxelles', 'Rue 5, 1000 Bruxelles', 'Rue 4, 1000 Bruxelles', 'Rue 3, 1000 Bruxelles']);
    expect(s.recent).toHaveLength(LIMITS.recent);
    s = withRecent(s, { label: 'Rue 5, 1000 Bruxelles', lat: 50.85, lon: 4.35 }, 8);
    expect(s.recent.map((r) => r.label).slice(0, 2)).toEqual(['Rue 5, 1000 Bruxelles', 'Rue 7, 1000 Bruxelles']);
    expect(s.recent).toHaveLength(5);
  });

  it('une adresse récente revient en tête du champ, avec le type « récent »', async () => {
    const s = defaults();
    s.recent = [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }];
    const hz = open({ settings: s });
    hz.arr.focus();
    await settle();
    expect(options(hz.el.querySelector('#r-arrivee-liste')!)).toContainEqual(['Veldstraat 1, 9000 Gent', 'récent']);
  });
});

describe('aucun trajet complet : une issue (M5, § 6.3)', () => {
  it('adresse loin de tout arrêt : « Aucun arrêt à moins de 20 min à pied de cette adresse. » (CA-M5.6)', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'rue du bois 1 bastogne', 'Rue du Bois 1, 6600 Bastogne');
    await results(hz.el);
    expect(textOf(hz.el.querySelector('.live'))).toBe('Aucun arrêt à moins de 20 min à pied de cette adresse.');
    expect(hz.el.querySelector('.live')!.textContent).toContain(`20${NB}min`);
    expect(cards(hz.el)).toHaveLength(0);
    expect(() => button(hz.el, 'Garder en favori')).toThrow();
  });

  it('pas de trajet complet : « Essaie {gare}, puis le tram. » et « Chercher vers {gare} » relance vers la gare (F3-e)', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'rue de nimy 50', 'Rue de Nimy 50, 7000 Mons');
    await results(hz.el);
    expect(textOf(hz.el.querySelector('.live'))).toBe('Pas de trajet complet. Essaie Mons, puis le tram.');
    // une seule fois à l'écran (review-ux n° 29)
    expect((hz.el.textContent ?? '').split('Pas de trajet complet').length - 1).toBe(1);
    button(hz.el, 'Chercher vers Mons').click();
    expect(hz.arr.value).toBe('Mons');
    await results(hz.el);
    expect(textOf(hz.el.querySelector('.live'))).not.toContain('Pas de trajet complet');
  });

  it('déjà sur place : « Tu es déjà … »', async () => {
    const s = preset();
    const hz = open({ settings: s, here: { lat: 50.8441, lon: 4.3474 }, now: SCENARIO.s1.now, params: 'de=ici&vers=bureau' });
    await results(hz.el);
    expect(textOf(hz.el.querySelector('.live'))).toBe('Tu es déjà au bureau.');
  });
});

describe('liens directs et champs', () => {
  it('#/recherche?q=Gand : « Arrivée » prérempli, propositions ouvertes ; « Départ » : « Ma position, {gare proche} »', async () => {
    const hz = open({ params: 'q=Gand' });
    await settle();
    expect(hz.arr.value).toBe('Gand');
    await until(() => options(hz.el.querySelector('#r-arrivee-liste')!).length > 0);
    expect(options(hz.el.querySelector('#r-arrivee-liste')!)[0]).toEqual(['Gand-Saint-Pierre', 'gare SNCB']);
    await until(() => hz.dep.value !== 'Ma position');
    expect(hz.dep.value).toBe('Ma position, Bruxelles-Central');
    expect(hz.arr.hasAttribute('data-autofocus')).toBe(true);
  });

  it('mention de vie privée sous les champs (M4.9, § 6.2)', () => {
    const hz = open();
    expect(textOf(hz.el.querySelector('.privacy'))).toBe('Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé, ta position reste sur le téléphone.');
  });
});
