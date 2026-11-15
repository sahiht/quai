// @vitest-environment happy-dom
/**
 * 1.3.0 (PRD-1.3.0 § 6) : le navigateur de développement (platform/browser.ts) n'a pas de lunettes : ni capteur de
 * mouvement (`imu` rend faux) ni état des lunettes (aucun signal `device`, pas de batterie) ; le reste ne change pas.
 * Quai Web (web/port.ts) : test/platform/v130-capteurs.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HubSignal } from '../../src/glasses/gestures';
import type { ContainerSpec } from '../../src/glasses/types';
import { createBrowserPlatform } from '../../src/platform/browser';

afterEach(() => document.body.replaceChildren());

describe('navigateur de développement : sans capteur ni batterie', () => {
  it('imu rend faux (ouvrir comme fermer, deux fois) ; seuls les gestes arrivent ; l’écran se dessine comme avant', async () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const p = createBrowserPlatform(() => 0, mount);
    const got: HubSignal[] = [];
    p.glasses.onSignal((s) => got.push(s));
    expect(await p.glasses.imu!(true, 100)).toBe(false);
    expect(await p.glasses.imu!(true)).toBe(false);
    expect(await p.glasses.imu!(false)).toBe(false);
    expect(await p.glasses.imu!(false)).toBe(false);
    const cs: ContainerSpec[] = [{ id: 1, name: 'title', x: 28, y: 3, w: 300, h: 27, content: 'Test de l’écran', level: 4, capture: true }];
    expect(await p.glasses.start(cs)).toBe(true);
    expect(mount.querySelector('.g-box')?.textContent).toBe('Test de l’écran');
    mount.querySelector<HTMLButtonElement>('button[data-g="tap"]')!.click();
    expect(got).toEqual([{ kind: 'gesture', gesture: 'tap' }]);
  });
});
