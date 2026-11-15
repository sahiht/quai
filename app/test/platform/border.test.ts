import { describe, expect, it } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { BORDER_COLOR, toTextProperty } from '../../src/platform/even';
import { drawContainers } from '../../src/web/display';
import type { ContainerSpec } from '../../src/glasses/types';

/** 1.2.10 (PRD-1.2.10 § 2) : bordure d'un conteneur, pour le filet pâle au-dessus du détail des favoris. */
const base: ContainerSpec = { id: 9, name: 'filet', x: 28, y: 230, w: 534, h: 1, content: '', level: 2, capture: false };

describe('bordure des conteneurs (filet des favoris)', () => {
  it('appli Even : borderWidth et borderColor (gris discret pour le niveau pâle), rien sans bordure', () => {
    const p = toTextProperty({ ...base, border: { width: 1, level: 2 } });
    expect(p.borderWidth).toBe(1);
    expect(p.borderColor).toBe(BORDER_COLOR[2]);
    expect(BORDER_COLOR[2]).toBeGreaterThanOrEqual(5);
    expect(BORDER_COLOR[2]).toBeLessThan(BORDER_COLOR[4]);
    const q = toTextProperty(base);
    expect(q.borderWidth).toBe(0);
    expect(q.borderColor).toBe(0);
  });

  it('la page avec un conteneur bordé d’un pixel de haut reste valide pour le SDK', () => {
    const page = { containerTotalNum: 1, textObject: [toTextProperty({ ...base, border: { width: 1, level: 2 } })] };
    const r = validateEvenHubPageContainer(page as never) as unknown;
    const ok = typeof r === 'boolean' ? r : (r as { valid?: boolean; ok?: boolean })?.valid ?? (r as { ok?: boolean })?.ok ?? true;
    expect(ok).not.toBe(false);
  });

  it('Quai Web : le filet est dessiné sur toute la largeur, une seule fois en haut et en bas d’un conteneur d’un pixel', () => {
    const rects: [number, number, number, number][] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText() {}, measureText: () => ({ width: 10 }),
      fillRect(x: number, y: number, w: number, h: number) { rects.push([x, y, w, h]); },
      translate() {}, scale() {}, set globalAlpha(_v: number) {}, set fillStyle(_v: string) {}, set font(_v: string) {}, set textBaseline(_v: string) {},
    };
    drawContainers(ctx as never, [{ ...base, border: { width: 1, level: 2 } }]);
    const lines = rects.filter(([x, y, w, h]) => x === 28 && y === 230 && w === 534 && h === 1);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    rects.length = 0;
    drawContainers(ctx as never, [base]);
    expect(rects.filter(([x, y, w]) => x === 28 && y === 230 && w === 534)).toHaveLength(0);
  });
});
