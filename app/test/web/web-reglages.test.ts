// @vitest-environment happy-dom
/**
 * Quai Web, onglet Réglages (1.2.9, PRD-1.2.9 § 2) : l'interface du téléphone dans l'onglet ; le bouton « Réglages » de
 * l'accueil ouvre l'écran Réglages dans le même onglet, qui reste choisi ; ses textes propres (ctx.web) restent :
 * « Position et langue » avec le choix de la position de Quai Web, et le retour vers Réglages.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountPhone } from '../../src/phone/app';
import { h } from '../../src/phone/dom';
import { mountShell } from '../../src/web/shell';
import { harness, preset11, textOf, until } from '../phone/helpers';

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, '', '#/');
});

function mountWeb(hash: string) {
  history.replaceState(null, '', hash);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shell = mountShell(host, 'reglages');
  const hz = harness({ settings: preset11(), web: true });
  const { go: _go, params: _params, ...deps } = hz.ctx;
  let picked = 0;
  mountPhone({
    ...deps,
    root: shell.reglages,
    themeTarget: shell.reglagesPanel,
    web: true,
    showGlasses: () => shell.show('lunettes'),
    positionPicker: () => (picked++, h('div', { class: 'w-pos' }, 'Choix de la position')),
    news: { visible: () => false, dismiss: () => {}, lines: [] },
  });
  return { shell, picked: () => picked };
}

describe('Quai Web : bouton « Réglages » dans l’onglet Réglages', () => {
  it('l’accueil, puis l’écran Réglages dans le même onglet (fond gris), puis retour à l’accueil', async () => {
    const { shell } = mountWeb('#/');
    await until(() => textOf(shell.reglages.querySelector('h1')) === 'Bonjour');
    expect(shell.panel()).toBe('reglages');
    expect(textOf(shell.reglages.querySelector('.head-home'))).not.toMatch(/onglet Lunettes/);
    const open = shell.reglages.querySelector<HTMLAnchorElement>('a.head-btn')!;
    expect([textOf(open), open.getAttribute('href')]).toEqual(['Réglages', '#/reglages']);
    location.hash = open.getAttribute('href')!;
    await until(() => textOf(shell.reglages.querySelector('h1')) === 'Réglages');
    expect(shell.panel()).toBe('reglages');
    expect(shell.reglagesPanel.classList.contains('grey')).toBe(true);
    expect(document.activeElement).toBe(shell.reglages.querySelector('h1'));
    shell.reglages.querySelector<HTMLButtonElement>('.back')!.click();
    await until(() => textOf(shell.reglages.querySelector('h1')) === 'Bonjour');
    expect(location.hash).toBe('#/');
  });

  it('« Position et langue » : le choix de la position de Quai Web (ctx.positionPicker), retour à Réglages', async () => {
    const { shell, picked } = mountWeb('#/bienvenue');
    await until(() => textOf(shell.reglages.querySelector('h1')) === 'Position et langue');
    expect(picked()).toBeGreaterThan(0);
    expect(textOf(shell.reglages.querySelector('.w-pos'))).toBe('Choix de la position');
    const back = shell.reglages.querySelector<HTMLButtonElement>('.back')!;
    expect(textOf(back)).toBe('Réglages');
    back.click();
    await until(() => textOf(shell.reglages.querySelector('h1')) === 'Réglages');
    expect(location.hash).toBe('#/reglages');
  });
});
