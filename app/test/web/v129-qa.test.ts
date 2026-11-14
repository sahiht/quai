// @vitest-environment happy-dom
/**
 * Contrôle qualité 1.2.9, Quai Web : aide sous l'écran des lunettes en typographie française (espace insécable devant
 * « : », comme les autres textes de Quai Web, rubrique « Position » comprise).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountShell } from '../../src/web/shell';

afterEach(() => document.body.replaceChildren());

describe('aide sous l’écran des lunettes', () => {
  it('« Sur l’écran : … » et « Clavier : … » : espace insécable devant les deux-points', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shell = mountShell(host, 'lunettes');
    const help = shell.root.querySelector('.w-help')!;
    const text = help.textContent ?? '';
    expect(text).toContain('Sur l’écran : glisse vers le haut ou le bas, touche une ou deux fois.');
    expect(text).toContain('Clavier : ↑ ↓, Entrée = toucher, Échap = double toucher.');
    expect(text).not.toMatch(/ [:;!?]/);
  });
});
