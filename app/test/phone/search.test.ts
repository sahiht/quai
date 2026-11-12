// @vitest-environment happy-dom
/**
 * Rechercher un trajet (T2, M3, M4, M5, S3, S4 ; PRD-1.2 § 1.3 et § 2.2) : cartes étiquetées et expliquées (« Le plus
 * court » d'abord), bouton « Lunettes » par carte (TripRequest avec le résultat entier et l'indice ; message à côté du
 * bouton touché seulement), choix unique annoncé, « Garder en favori » (un lieu depuis « Ma position », sinon un trajet
 * fixe), états vides avec leur issue, adresses récentes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/settings';
import { GEO_DELAY_MS } from '../../src/phone/field';
import { searchScreen, withRecent } from '../../src/phone/screens/search';
import { header } from '../../src/phone/app';
import { holidayLine } from '../../src/phone/text';
import type { Journey } from '../../src/core/api';
import { button, defaults, harness, mount, NB, options, preset11, SCENARIO, settle, sleep, textOf, type, until } from './helpers';
import { onDay, trip } from './trips';

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
    expect(tags(hz.el)).toEqual(['Le plus court', 'Le suivant', 'Plus tard']);
    const first = cards(hz.el)[0];
    expect(textOf(first.querySelector('.time'))).toBe('14:10 → 14:39');
    expect(textOf(first.querySelector('.why'))).toBe('Arrive le plus tôt.');
    expect(textOf(cards(hz.el)[1].querySelector('.why'))).toBe('Même trajet, départ suivant.');
    // plus de grand bouton en bas
    expect(hz.el.textContent).not.toContain('Afficher dans les lunettes');
    expect(hz.el.querySelectorAll('.result .btn-glasses')).toHaveLength(3);
  });

  it('choix unique pour les lecteurs d’écran : radiogroup, radio, nom du bouton « Afficher Le plus court dans les lunettes » (CA-M4.13)', async () => {
    const hz = open({ params: 'de=sncb:8813003&vers=sncb:8892007' });
    await results(hz.el);
    const group = hz.el.querySelector('[role="radiogroup"]')!;
    expect(group).not.toBeNull();
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    const btns = cards(hz.el).map((c) => c.querySelector('.btn-glasses')!.getAttribute('aria-label'));
    expect(btns).toEqual(['Afficher Le plus court dans les lunettes', 'Afficher Le suivant dans les lunettes', 'Afficher Plus tard dans les lunettes']);
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

  it('CA-1.4 : « Le plus court » puis « Sans changement » et leurs phrases (S1, noRT, vers Rue Neuve 1)', async () => {
    const hz = open({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    await arrive(hz, 'rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles');
    await results(hz.el);
    expect(tags(hz.el)).toEqual(['Le plus court', 'Sans changement', 'Le suivant']);
    const [short, none] = cards(hz.el);
    expect(textOf(short.querySelector('.time'))).toBe('07:33 → 08:51');
    expect(textOf(short.querySelector('.why'))).toBe('Arrive le plus tôt.');
    expect(textOf(none.querySelector('.time'))).toBe('07:33 → 08:56');
    expect(textOf(none.querySelector('.why'))).toBe('Aucun changement, mais arrive 5 min plus tard.');
    expect(none.querySelector('.why')!.textContent).toContain(`5${NB}min`);
  });
});

describe('adresse dans « Arrivée » (M4.4, S4) et « Garder en favori » (PRD-1.2 § 2.2)', () => {
  it('le choix lance la recherche et l’adresse devient récente ; plus de « Enregistrer comme lieu »', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'veldstraat 1 gent', 'Veldstraat 1, 9000 Gent');
    expect(hz.arr.value).toBe('Veldstraat 1, 9000 Gent');
    await results(hz.el);
    expect(cards(hz.el).length).toBeGreaterThan(0);
    expect(textOf(cards(hz.el)[0].querySelector('.tag'))).toBe('Le plus court');
    expect(hz.el.textContent).not.toMatch(/Enregistrer (comme lieu|l’adresse comme lieu)/);
    await hz.settings.flush();
    expect(hz.settings.get().recent[0]).toMatchObject({ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 });
  });

  it('CA-2.4 : « Ma position » → Veldstraat 1 donne un lieu « Veldstraat 1 » ; une seconde fois : « Déjà dans tes favoris. »', async () => {
    const hz = open({ settings: defaults() });
    await arrive(hz, 'veldstraat 1 gent', 'Veldstraat 1, 9000 Gent');
    await results(hz.el);
    button(hz.el, 'Garder en favori').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'place', label: 'Veldstraat 1', address: 'Veldstraat 1, 9000 Gent', src: 'address', lat: 51.0537, lon: 3.7225, propose: 'never' });
    const msg = () => textOf(hz.el.querySelector('.below-results .msg'));
    await until(() => msg() !== '');
    expect(msg()).toBe('Ajouté à tes favoris.');
    button(hz.el, 'Garder en favori').click();
    await until(() => msg() === 'Déjà dans tes favoris.');
    expect(hz.settings.get().favorites).toHaveLength(1);
  });

  it('CA-2.4 : Bruxelles-Central → Gand-Saint-Pierre donne un trajet fixe ; « Ma position » → une gare, un lieu « Près de … »', async () => {
    const hz = open({ settings: defaults(), params: 'de=sncb:8813003&vers=sncb:8892007' });
    await results(hz.el);
    button(hz.el, 'Garder en favori').click();
    await until(() => hz.settings.get().favorites.length === 1);
    expect(hz.settings.get().favorites[0]).toMatchObject({ kind: 'trip', from: { type: 'area', areaId: 'sncb:8813003' }, to: { type: 'area', areaId: 'sncb:8892007' }, propose: 'never' });
    expect(hz.settings.get().favorites[0]).not.toHaveProperty('label');
    button(hz.el, 'Garder en favori').click();
    await until(() => textOf(hz.el.querySelector('.below-results .msg')) === 'Déjà dans tes favoris.');

    const here = open({ settings: defaults(), params: 'de=ici&vers=sncb:8892007' });
    await results(here.el);
    button(here.el, 'Garder en favori').click();
    await until(() => here.settings.get().favorites.length === 1);
    expect(here.settings.get().favorites[0]).toMatchObject({ kind: 'place', label: 'Gand-Saint-Pierre', src: 'stop', areaId: 'sncb:8892007', address: 'Près de Gand-Saint-Pierre' });
  });

  it('« Garder en favori » vers un lieu déjà gardé : « Déjà dans tes favoris. » ; 32 favoris : la limite', async () => {
    const hz = open({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, params: 'de=ici&vers=fav-bureau' });
    await results(hz.el);
    expect(hz.arr.value).toBe('Bureau');
    button(hz.el, 'Garder en favori').click();
    await until(() => textOf(hz.el.querySelector('.below-results .msg')) === 'Déjà dans tes favoris.');
    // 32 favoris (des lieux : un arrêt favori de la 1.2.1 rejoindrait « Bus, tram, métro », PRD-1.2.2 § 5)
    const full = defaults({ favorites: Array.from({ length: 32 }, (_, i) => ({ kind: 'place' as const, id: `p${i}`, label: `Lieu ${i}`, lat: 50 + i / 1000, lon: 4, propose: 'never' as const })) });
    const hz2 = open({ settings: full, params: 'de=sncb:8813003&vers=sncb:8892007' });
    await results(hz2.el);
    button(hz2.el, 'Garder en favori').click();
    await until(() => textOf(hz2.el.querySelector('.below-results .msg')) !== '');
    expect(textOf(hz2.el.querySelector('.below-results .msg'))).toBe('32 favoris au plus : supprimes-en un.');
    expect(hz2.el.querySelector('.below-results .msg')!.classList.contains('err')).toBe(true);
    expect(hz2.settings.get().favorites).toHaveLength(32);
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
    const s = preset11();
    const hz = open({ settings: s, here: { lat: 50.8441, lon: 4.3474 }, now: SCENARIO.s1.now, params: 'de=ici&vers=fav-bureau' });
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

describe('jour férié (PRD-1.2.1 § 5, § 7.4, CA-121.7)', () => {
  const nov11 = onDay('2026-11-11');
  const nov12 = onDay('2026-11-12');
  const madou = (t: (h: number, m: number) => number) => trip('short', t(13, 39), [8, [t(13, 47), t(14, 30), 'bus W'], 1, [t(14, 33), t(14, 45), 'métro 2'], 2]);

  it('holidayLine : « Jour férié : horaires du dimanche » si un trajet proposé part un jour férié ; rien sinon', () => {
    expect(holidayLine({ journeys: [madou(nov11)] })).toBe(`Jour férié${NB}: horaires du dimanche`);
    expect(holidayLine({ journeys: [madou(nov12)] })).toBe('');
    expect(holidayLine({ journeys: [] })).toBe('');
    expect(holidayLine(null)).toBe('');
    // le jour des trajets, pas celui de la recherche : le 11/11 à 23:30, des trajets le 12/11 au matin, rien
    const dawn12 = trip('short', nov12(5, 30), [[nov12(5, 30), nov12(6, 10), 'IC']]);
    expect(holidayLine({ journeys: [dawn12] })).toBe('');
    // le 10/11 au soir, des trajets le 11/11 au matin : la ligne
    expect(holidayLine({ journeys: [trip('short', nov11(5, 30), [[nov11(5, 30), nov11(6, 10), 'IC']])] })).toBe(`Jour férié${NB}: horaires du dimanche`);
  });

  /** Recherche au jour `t`, résultats construits sur ce jour. */
  async function searchOn(t: (h: number, m: number) => number) {
    const r = { journeys: [madou(t)] };
    const hz = open({ now: t(13, 30), params: 'de=sncb:8863008&vers=sncb:8813003', core: (c) => ({ ...c, route: async () => r }) });
    await results(hz.el);
    return hz.el;
  }

  it('11/11/2026 : la ligne sous l’heure de la recherche, au-dessus des résultats ; 12/11 : rien', async () => {
    const el = await searchOn(nov11);
    const line = el.querySelector('.res-title .holiday')!;
    expect(textOf(line)).toBe('Jour férié : horaires du dimanche');
    expect(line.textContent).toContain(`férié${NB}:`);
    expect(line.compareDocumentPosition(el.querySelector('.results')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textOf(line.previousElementSibling)).toBe('dès 13:30');
    document.body.replaceChildren();
    const el12 = await searchOn(nov12);
    expect(el12.querySelector('.holiday')).toBeNull();
    expect(el12.textContent).not.toContain('Jour férié');
  });

  it('sans trajet, ou pendant la recherche : pas de ligne', async () => {
    const hz = open({ now: nov11(13, 30), params: 'de=sncb:8863008&vers=sncb:8813003', core: (c) => ({ ...c, route: async () => ({ journeys: [], empty: 'noTrip' as const }) }) });
    await results(hz.el);
    expect(hz.el.querySelector('.holiday')).toBeNull();
  });
});

describe('données du réseau affichées en texte, jamais en HTML (revue n° 4)', () => {
  it('noms de lignes et catégories de trains publiés : du texte dans la ligne « moyens »', async () => {
    const t0 = SCENARIO.s3.now + 10 * 60_000;
    const leg = (dep: number, arr: number, extra: object) => ({ kind: 'ride' as const, from: { name: { fr: 'A', nl: 'A' }, lat: 0, lon: 0 }, to: { name: { fr: 'B', nl: 'B' }, lat: 0, lon: 0 }, dep, arr, schedDep: dep, schedArr: arr, rt: true, ...extra });
    const crafted: Journey = {
      id: 'x',
      legs: [leg(t0, t0 + 600_000, { op: 'stib', mode: 'tram', line: '<img src=x onerror="globalThis.__quaiXss=1">' }), leg(t0 + 900_000, t0 + 1_800_000, { op: 'sncb', mode: 'train', line: 'IC', cat: '<b>IC</b>' })],
      dep: t0,
      arr: t0 + 1_800_000,
      leaveAt: t0,
      transfers: 1,
      rt: true,
      alerts: [],
      label: 'short',
    };
    const hz = open({ params: 'de=sncb:8813003&vers=sncb:8892007', core: (c) => ({ ...c, route: async () => ({ journeys: [crafted] }) }) });
    await results(hz.el);
    const card = hz.el.querySelector('.result .card')!;
    const means = card.querySelector('.means')!;
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(means.childNodes).toHaveLength(1);
    expect(means.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(means.textContent).toBe('tram <img src=x onerror="globalThis.__quaiXss=1"> + <b>IC</b>');
    expect((globalThis as { __quaiXss?: number }).__quaiXss).toBeUndefined();
  });

  it('bouton retour de l’en-tête : son libellé est du texte', () => {
    const hz = harness();
    const el = mount(header(hz.ctx, 'Titre', undefined, { label: '<i>Accueil</i>', hash: '#/' }));
    const back = el.querySelector('.back')!;
    expect(back.querySelector('i')).toBeNull();
    expect(textOf(back)).toBe('<i>Accueil</i>');
    expect(back.querySelector('svg')).not.toBeNull();
  });
});
