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

describe('1.2.2 : #/gares, #/lignes (Quai Web), #/trajets', () => {
  const stations = [{ id: 'g-namur', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 }];
  const lines = [{ id: 'l-3', areaId: 'stib:6357F', op: 'stib' as const, name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017, line: '3', mode: 'tram' as const }];

  for (const web of [false, true]) {
    it(`${web ? 'Quai Web' : 'téléphone'} : vides, #/gares et #/lignes ouvrent l’ajout ; sinon la section de l’accueil, curseur sur son titre`, async () => {
      let root = mountAt('#/gares', defaults(), web);
      await until(() => textOf(root.querySelector('h1')) !== '');
      expect(textOf(root.querySelector('h1'))).toBe('Ajouter une gare');
      expect(document.activeElement?.id).toBe('gare-nom');
      expect(document.title).toBe('Gares · Quai');
      expect(document.body.classList.contains('grey')).toBe(false);
      document.body.replaceChildren();
      root = mountAt('#/lignes', defaults(), web);
      await until(() => textOf(root.querySelector('h1')) !== '');
      expect(textOf(root.querySelector('h1'))).toBe('Ajouter une ligne ou un arrêt');
      expect(document.activeElement?.id).toBe('ligne-num');
      document.body.replaceChildren();
      root = mountAt('#/gares', defaults({ stations, lines }), web);
      await until(() => textOf(root.querySelector('h1')) !== '');
      expect(textOf(root.querySelector('h1'))).toBe('Bonjour');
      expect(document.body.classList.contains('grey')).toBe(true);
      expect(textOf(document.activeElement)).toBe('Gares');
      expect(document.activeElement?.tagName).toBe('H2');
      document.body.replaceChildren();
      root = mountAt('#/lignes', defaults({ stations, lines }), web);
      await until(() => textOf(root.querySelector('h1')) !== '');
      expect(textOf(document.activeElement)).toBe('Bus, tram, métro');
      // une seule section reçoit le curseur
      expect(root.querySelectorAll('[data-focus]')).toHaveLength(1);
    });
  }

  it('1.2.3 : #/lignes/ajouter ouvre le choix (« Une ligne » d’office) ; #/lignes/ajouter/ligne, #/lignes/ajouter/arret', async () => {
    const selected = (root: HTMLElement) => textOf(root.querySelector('[role="tab"][aria-selected="true"] .k1'));
    for (const [hash, tab, field] of [
      ['#/lignes/ajouter', 'Une ligne', 'ligne-num'],
      ['#/lignes/ajouter/ligne', 'Une ligne', 'ligne-num'],
      ['#/lignes/ajouter/arret', 'Un arrêt', 'arret-nom'],
    ] as const) {
      const root = mountAt(hash, defaults({ stations, lines }));
      await until(() => textOf(root.querySelector('h1')) !== '');
      expect(textOf(root.querySelector('h1')), hash).toBe('Ajouter une ligne ou un arrêt');
      expect(selected(root), hash).toBe(tab);
      expect(document.activeElement?.id, hash).toBe(field);
      expect(document.title, hash).toBe('Bus, tram, métro · Quai');
      document.body.replaceChildren();
    }
  });

  it('#/gares/ajouter et #/lignes/ajouter même avec des éléments ; #/lignes/ajouter?arret=… ; #/trajets', async () => {
    let root = mountAt('#/gares/ajouter', defaults({ stations, lines }));
    await until(() => textOf(root.querySelector('h1')) !== '');
    expect(textOf(root.querySelector('h1'))).toBe('Ajouter une gare');
    document.body.replaceChildren();
    root = mountAt('#/lignes/ajouter?arret=stib%3A6357F', defaults({ stations, lines }));
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
    for (const hash of ['#/', '#/favoris', '#/favoris/nouveau', '#/favoris/fav-gand', '#/gares/ajouter', '#/lignes/ajouter', '#/trajets', '#/affichage', '#/alertes', '#/donnees', '#/recherche', '#/bienvenue', '#/bienvenue/favoris']) {
      const root = mountAt(hash, preset11());
      await until(() => textOf(root.querySelector('h1')) !== '');
      await settle();
      expect(shown(root), hash).not.toMatch(/tes lieux|lieu enregistré|mon lieu/i);
      document.body.replaceChildren();
    }
  });
});
