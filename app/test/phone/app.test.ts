// @vitest-environment happy-dom
/**
 * Routeur du téléphone (PRD-1.2 § 2.2, CA-2.4) : « Mes lieux » n'existe plus, ses ancres mènent à « Mes favoris » ;
 * « Nouveau favori », « Trajet fixe », modification d'un favori ; « Tes favoris » au premier lancement. 1.2.2
 * (PRD-1.2.2 § 1.3 et § 4) : #/gares et #/lignes, ouverts par les lunettes de Quai Web (la section, ou l'ajout si elle
 * est vide), #/gares/ajouter, #/lignes/ajouter, #/trajets (revue d'usage n° 9) ; plus aucun « lieu » à l'écran (n° 5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Settings } from '../../src/core/api';
import { legacyHash, mountPhone } from '../../src/phone/app';
import { defaults, harness, preset11, settle, textOf, until } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

function mountAt(hash: string, settings: Settings = defaults(), web = false) {
  history.replaceState(null, '', hash);
  const hz = harness({ settings, web });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const { go: _go, params: _params, ...deps } = hz.ctx;
  mountPhone({ ...deps, root, news: { visible: () => false, dismiss: () => {}, lines: [] } });
  return root;
}

describe('ancres de la 1.1 (« Mes lieux ») et de la 1.2', () => {
  it('legacyHash : #/lieux, #/lieux/nouveau, #/lieux/{id} ; rien d’autre', () => {
    expect(legacyHash('#/lieux')).toBe('#/favoris');
    expect(legacyHash('#lieux')).toBe('#/favoris');
    expect(legacyHash('#/lieux?nouveau=lieu-1')).toBe('#/favoris');
    expect(legacyHash('#/lieux/nouveau')).toBe('#/favoris/nouveau');
    expect(legacyHash('#/lieux/bureau')).toBe('#/favoris/bureau');
    expect(legacyHash('#/favoris')).toBeNull();
    expect(legacyHash('#/lieuxdits')).toBeNull();
    expect(legacyHash('#/recherche?q=lieux')).toBeNull();
  });

  it('CA-2.4 : #/lieux mène à #/favoris (« Mes favoris »), sans nouvelle entrée d’historique', async () => {
    const before = history.length;
    const root = mountAt('#/lieux');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(location.hash).toBe('#/favoris');
    expect(textOf(root.querySelector('h1'))).toBe('Mes favoris');
    expect(history.length).toBe(before);
  });

  it('#/favoris/nouveau, #/favoris/trajet (choix « Un trajet de A à B », PRD-1.2.1 § 7.1), #/bienvenue/favoris', async () => {
    let root = mountAt('#/favoris/nouveau');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(textOf(root.querySelector('h1'))).toBe('Nouveau favori');
    expect(textOf(root.querySelector('[role="tab"][aria-selected="true"] .k1'))).toBe('Un endroit');
    // le curseur va dans le champ du choix montré
    expect(document.activeElement?.id).toBe('nf-lieu');
    document.body.replaceChildren();
    root = mountAt('#/favoris/trajet');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(textOf(root.querySelector('h1'))).toBe('Nouveau favori');
    expect(textOf(root.querySelector('[role="tab"][aria-selected="true"] .k1'))).toBe('Un trajet de A à B');
    expect(document.activeElement?.id).toBe('fav-de');
    document.body.replaceChildren();
    root = mountAt('#/bienvenue/favoris');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(textOf(root.querySelector('h1'))).toBe('Tes favoris');
  });
});

describe('1.2.2 et 1.2.6 : #/gares, #/arrets, #/lignes (Quai Web), #/trajets', () => {
  const stations = [{ id: 'g-namur', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 }];
  const lines = [{ id: 's-gdn', areaId: 'stib:6357F', op: 'stib' as const, name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017 }];
  const follows = [{ id: 'f-3', op: 'stib' as const, mode: 'tram' as const, line: '3', routes: [] }];

  for (const web of [false, true]) {
    it(`${web ? 'Quai Web' : 'téléphone'} : #/gares, #/arrets et #/lignes : l’écran de la rubrique, curseur sur son titre ; vides (les lunettes y mènent), curseur sur l’ajout`, async () => {
      for (const [hash, h1, add, field, title] of [
        ['#/gares', 'Gares de train', 'Ajouter une gare', 'gare-nom', 'Gares de train · Quai'],
        ['#/arrets', 'Arrêts de bus, tram, métro', 'Ajouter un arrêt', 'arret-nom', 'Arrêts de bus, tram, métro · Quai'],
        ['#/lignes', 'Lignes de bus, tram, métro', 'Ajouter une ligne', 'ligne-num', 'Lignes de bus, tram, métro · Quai'],
      ] as const) {
        const root = mountAt(hash, defaults(), web);
        await until(() => textOf(root.querySelector('h1')) !== '');
        expect(textOf(root.querySelector('h1')), hash).toBe(h1);
        // 1.2.9 : la liste vide, l'ajout dessous ; le curseur sur son titre, sans ouvrir le clavier
        expect(root.querySelector('.pick-list .empty-row'), hash).not.toBeNull();
        expect([document.activeElement?.tagName, textOf(document.activeElement)], hash).toEqual(['H2', add]);
        expect(root.querySelector(`#${field}`), hash).not.toBeNull();
        expect(document.title, hash).toBe(title);
        expect(document.body.classList.contains('grey'), hash).toBe(true);
        document.body.replaceChildren();
      }
      for (const [hash, h1, first] of [
        ['#/gares', 'Gares de train', 'Namur'],
        ['#/arrets', 'Arrêts de bus, tram, métro', 'Gare du Nord'],
        ['#/lignes', 'Lignes de bus, tram, métro', 'Tram 3'],
      ] as const) {
        const root = mountAt(hash, defaults({ stations, lines, follows }), web);
        await until(() => textOf(root.querySelector('h1')) !== '');
        expect(textOf(root.querySelector('h1')), hash).toBe(h1);
        expect(textOf(root.querySelector('.pick-head .t1')), hash).toBe(first);
        expect(document.body.classList.contains('grey'), hash).toBe(true);
        expect(document.activeElement, hash).toBe(root.querySelector('h1'));
        expect(root.querySelectorAll('[data-focus]'), hash).toHaveLength(0);
        document.body.replaceChildren();
      }
    });
  }

  it('1.2.9 : #/…/ajouter : l’écran de la rubrique, curseur sur son ajout ; #/lignes/ajouter/arret : celui des arrêts', async () => {
    for (const [hash, h1, add, field, title] of [
      ['#/gares/ajouter', 'Gares de train', 'Ajouter une gare', 'gare-nom', 'Gares de train · Quai'],
      ['#/arrets/ajouter', 'Arrêts de bus, tram, métro', 'Ajouter un arrêt', 'arret-nom', 'Arrêts de bus, tram, métro · Quai'],
      ['#/lignes/ajouter', 'Lignes de bus, tram, métro', 'Ajouter une ligne', 'ligne-num', 'Lignes de bus, tram, métro · Quai'],
      ['#/lignes/ajouter/ligne', 'Lignes de bus, tram, métro', 'Ajouter une ligne', 'ligne-num', 'Lignes de bus, tram, métro · Quai'],
      ['#/lignes/ajouter/arret', 'Arrêts de bus, tram, métro', 'Ajouter un arrêt', 'arret-nom', 'Arrêts de bus, tram, métro · Quai'],
    ] as const) {
      const root = mountAt(hash, defaults({ stations, lines, follows }));
      await until(() => textOf(root.querySelector('h1')) !== '');
      expect(textOf(root.querySelector('h1')), hash).toBe(h1);
      // la liste au-dessus, une rangée
      expect(root.querySelectorAll('.pick-head'), hash).toHaveLength(1);
      expect(root.querySelector('[role="tablist"]'), hash).toBeNull();
      expect([document.activeElement?.tagName, textOf(document.activeElement)], hash).toEqual(['H2', add]);
      expect(root.querySelectorAll('[data-focus]'), hash).toHaveLength(1);
      // le bon ajout, et lui seul
      expect(root.querySelectorAll('.pick-add-section input'), hash).toHaveLength(1);
      expect(root.querySelector(`.pick-add-section #${field}`), hash).not.toBeNull();
      expect(document.title, hash).toBe(title);
      document.body.replaceChildren();
    }
  });

  it('#/gares/ajouter et #/lignes/ajouter même avec des éléments ; #/lignes/ajouter?arret=… ; #/trajets', async () => {
    let root = mountAt('#/gares/ajouter', defaults({ stations, lines, follows }));
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(textOf(root.querySelector('h1'))).toBe('Gares de train');
    expect(textOf(document.activeElement)).toBe('Ajouter une gare');
    document.body.replaceChildren();
    root = mountAt('#/lignes/ajouter?arret=stib%3A6357F', defaults({ stations, lines, follows }));
    await until(() => root.querySelectorAll('.quick .shortcut').length > 0);
    expect(textOf(root.querySelector('.quick p'))).toBe('Lignes à Gare du Nord :');
    document.body.replaceChildren();
    root = mountAt('#/trajets');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(textOf(root.querySelector('h1'))).toBe('Trajets');
    expect(document.title).toBe('Trajets · Quai');
  });

  it('revue d’usage n° 5 : aucun texte affiché ne dit « tes lieux », « lieu enregistré » ni « mon lieu »', async () => {
    const shown = (root: HTMLElement): string => [root.textContent ?? '', ...[...root.querySelectorAll('[placeholder], [aria-label]')].flatMap((e) => [e.getAttribute('placeholder') ?? '', e.getAttribute('aria-label') ?? ''])].join(' ');
    for (const hash of ['#/', '#/reglages', '#/favoris', '#/favoris/nouveau', '#/favoris/fav-gand', '#/gares/ajouter', '#/lignes/ajouter', '#/trajets', '#/affichage', '#/alertes', '#/donnees', '#/recherche', '#/bienvenue', '#/bienvenue/favoris']) {
      const root = mountAt(hash, preset11());
      await until(() => textOf(root.querySelector('h1')) !== '');
      await settle();
      expect(shown(root), hash).not.toMatch(/tes lieux|lieu enregistré|mon lieu/i);
      document.body.replaceChildren();
    }
  });
});

describe('1.2.9 (PRD-1.2.9 § 2.3) : #/reglages', () => {
  for (const web of [false, true]) {
    it(`${web ? 'Quai Web (onglet Réglages)' : 'téléphone'} : le bouton « Réglages » de l’accueil ouvre l’écran Réglages, fond gris, curseur sur son titre ; retour à l’accueil`, async () => {
      const root = mountAt('#/', preset11(), web);
      await until(() => textOf(root.querySelector('h1')) === 'Bonjour');
      const open = root.querySelector<HTMLAnchorElement>('header a.head-btn')!;
      expect([textOf(open), open.getAttribute('href')]).toEqual(['Réglages', '#/reglages']);
      // le lien change l'ancre, le routeur suit (hashchange), comme dans l'onglet Réglages de Quai Web
      location.hash = open.getAttribute('href')!;
      await until(() => textOf(root.querySelector('h1')) === 'Réglages');
      expect(document.title).toBe('Réglages · Quai');
      expect(document.body.classList.contains('grey')).toBe(true);
      expect(document.activeElement).toBe(root.querySelector('h1'));
      expect(textOf(root.querySelector('.back'))).toBe('Accueil');
      root.querySelector<HTMLButtonElement>('.back')!.click();
      await until(() => textOf(root.querySelector('h1')) === 'Bonjour');
      expect(location.hash).toBe('#/');
      document.body.replaceChildren();
    });
  }

  it('Affichage : fond gris comme Réglages ; #/trajets reste valable', async () => {
    let root = mountAt('#/affichage');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect([textOf(root.querySelector('h1')), document.title, document.body.classList.contains('grey')]).toEqual(['Affichage', 'Affichage · Quai', true]);
    document.body.replaceChildren();
    root = mountAt('#/trajets');
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect([textOf(root.querySelector('h1')), textOf(root.querySelector('.back'))]).toEqual(['Trajets', 'Réglages']);
  });
});
