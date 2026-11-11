// @vitest-environment happy-dom
/**
 * Routeur du téléphone (PRD-1.2 § 2.2, CA-2.4) : « Mes lieux » n'existe plus, ses ancres mènent à « Mes favoris » ;
 * « Nouveau favori », « Trajet fixe », modification d'un favori ; « Tes favoris » au premier lancement.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { legacyHash, mountPhone } from '../../src/phone/app';
import { defaults, harness, textOf, until } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

function mountAt(hash: string, settings = defaults()) {
  history.replaceState(null, '', hash);
  const hz = harness({ settings });
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
