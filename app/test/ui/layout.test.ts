import { describe, expect, it } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { toTextProperty } from '../../src/platform/even';
import { ensureVisible, geometry, IDS, layoutPage, LAYOUTS, shapeKey, visibleRange, withOptionalTail, withTail, wrapLines } from '../../src/glasses/layout';
import { textWidth } from '../../src/glasses/font';
import type { GlassesView, Item, Layout } from '../../src/glasses/types';
import { overflowing } from './helpers';

const view = (patch: Partial<GlassesView> = {}): GlassesView => ({
  screen: 'board',
  layout: 'board',
  title: 'Gare du Nord, tram (STIB)',
  clock: '12:10',
  items: Array.from({ length: 12 }, (_, i): Item => ({ a: 'T3', b: `Churchill ${i}`, c: `${i + 2} min` })),
  hints: '▲▼ départs   toucher : ★ favori   double : retour',
  reserveNote: true,
  ...patch,
});

describe('mise en page des conteneurs', () => {
  it('respecte les limites du matériel', () => {
    for (const layout of Object.keys(LAYOUTS) as Layout[]) {
      const p = layoutPage(view({ layout, top: { text: '! Voie modifiée : l’IC part de la voie 6', strong: true }, note: '~ horaire prévu, sans temps réel' }), { sel: 3, top: 0 });
      expect(p.containers).toHaveLength(8);
      expect(p.containers.filter((c) => c.capture)).toHaveLength(1);
      expect(new Set(p.containers.map((c) => c.id)).size).toBe(8);
      for (const c of p.containers) {
        expect(c.name.length).toBeLessThanOrEqual(16);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(576);
        expect(c.y + c.h).toBeLessThanOrEqual(288);
        expect(c.content.length).toBeGreaterThan(0);
        expect(new TextEncoder().encode(c.content).length).toBeLessThanOrEqual(999);
        expect(c.level).toBeGreaterThanOrEqual(0);
        expect(c.level).toBeLessThanOrEqual(4);
      }
      expect(overflowing(p)).toEqual([]);
      const sdkPage = { containerTotalNum: 8, textObject: p.containers.map(toTextProperty) };
      expect(validateEvenHubPageContainer(sdkPage)).toEqual({ valid: true });
    }
  });

  it('niveaux de luminosité : titre 4, contenu 3-4, aides 2', () => {
    const p = layoutPage(view(), { sel: 0, top: 0 });
    const by = (name: string) => p.containers.find((c) => c.name === name)!;
    expect(by('title').level).toBe(4);
    expect(by('title').capture).toBe(true);
    expect(by('clock').level).toBe(3);
    expect(by('foot').level).toBe(2);
    expect([3, 4]).toContain(by('colB').level);
    expect(layoutPage(view(), { sel: 0, top: 0 }, { toast: '★ Ajouté aux favoris' }).containers.find((c) => c.id === IDS.foot)!.level).toBe(4);
  });

  it('heure alignée à droite, colonnes à position fixe', () => {
    const p = layoutPage(view(), { sel: 0, top: 0 });
    const clock = p.containers.find((c) => c.name === 'clock')!;
    expect(clock.content.trim()).toBe('12:10');
    expect(clock.x + textWidth(clock.content)).toBeGreaterThanOrEqual(572 - 6);
    const a = layoutPage(view({ items: [{ a: 'T3', b: 'Churchill', c: '9 min' }] }), { sel: 0, top: 0 });
    const b = layoutPage(view({ items: [{ a: 'T3', b: 'Churchill', c: '10 min' }] }), { sel: 0, top: 0 });
    // Un rafraîchissement (9 → 10 min) ne change pas la forme : mise à jour sans reconstruction.
    expect(shapeKey(a)).toBe(shapeKey(b));
    expect(shapeKey(a)).not.toBe(shapeKey(layoutPage(view({ top: { text: '! alerte' } }), { sel: 0, top: 0 })));
  });

  it('curseur sur l’élément choisi, fenêtre qui suit la sélection', () => {
    const v = view();
    const g = geometry(v);
    expect(g.capacity).toBe(7);
    const p = layoutPage(v, { sel: 9, top: 0 });
    expect(p.top).toBe(3);
    expect(p.visible).toBe(7);
    const cursor = p.containers.find((c) => c.name === 'cursor')!.content.split('\n');
    expect(cursor.indexOf('▶')).toBe(6);
    expect(p.lines[0]).toBe('T3   Churchill 3   5 min');
  });

  it('éléments sur deux lignes', () => {
    const items: Item[] = [{ a: 'Pour le bureau : IC 07:42, voie 4', b2: 'partir à 07:33, 7 min à pied' }, { a: 'Autour de moi', c: '3 arrêts' }];
    expect(visibleRange(items, 0, 2)).toEqual({ from: 0, to: 1 });
    expect(ensureVisible(items, 1, 0, 2)).toBe(1);
    const p = layoutPage(view({ layout: 'menu', items }), { sel: 0, top: 0 });
    expect(p.lines.slice(0, 3)).toEqual(['Pour le bureau : IC 07:42, voie 4', 'partir à 07:33, 7 min à pied', 'Autour de moi   3 arrêts']);
  });

  it('messages longs repliés au mot, espace insécable respectée', () => {
    const lines = wrapLines(['Données indisponibles : vérifie la publication de cette nuit, puis réessaie dans quelques minutes, merci'], 300);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(300);
    expect(wrapLines(['rayon de 500 m'], 1000)).toEqual(['rayon de 500 m']);
  });
});

describe('fins de colonne protégées (« , dernier »)', () => {
  it('withTail : la fin reste entière, le début est coupé au pixel', () => {
    expect(withTail('Churchill', ', dernier', 300)).toBe('Churchill, dernier');
    const long = withTail('Une destination beaucoup trop longue pour la place', ', dernier', 200);
    expect(long.endsWith('…, dernier')).toBe(true);
    expect(textWidth(long)).toBeLessThanOrEqual(200);
    expect(withTail('', ', dernier', 200)).toBe('dernier');
    expect(withTail('Churchill', undefined, 300)).toBe('Churchill');
  });

  it('withOptionalTail : ajoutée seulement si tout tient, la colonne n’est jamais coupée pour elle', () => {
    expect(withOptionalTail('T3 2 min', ', dernier', 180)).toBe('T3 2 min, dernier');
    expect(withOptionalTail('T3 2 min', ', dernier', 100)).toBe('T3 2 min');
    expect(withOptionalTail('', ', dernier', 180)).toBe('');
  });

  it('tableau : la colonne b garde « , dernier », sans déborder sur l’heure', () => {
    const p = layoutPage(
      view({ items: [{ a: 'T3', b: 'Simonis (Elisabeth) par le boulevard Léopold II et la basilique', bTail: ', dernier', c: '12 min' }] }),
      { sel: 0, top: 0 },
    );
    expect(p.lines[0]).toMatch(/^T3 {3}Simonis .*…, dernier {3}12 min$/);
    expect(overflowing(p)).toEqual([]);
    const colB = p.containers.find((c) => c.name === 'colB')!;
    const colC = p.containers.find((c) => c.name === 'colC')!;
    expect(colB.x + textWidth(colB.content.split('\n')[0])).toBeLessThan(colC.x);
  });
});
