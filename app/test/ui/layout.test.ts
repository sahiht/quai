import { describe, expect, it } from 'vitest';
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk';
import { toTextProperty } from '../../src/platform/even';
import { clampTop, ensureVisible, geometry, IDS, layoutPage, LAYOUTS, maxTop, shapeKey, visibleRange, WIDTHS, withOptionalTail, withTail, wrapLines } from '../../src/glasses/layout';
import { textWidth } from '../../src/glasses/font';
import type { GlassesView, Item, Layout } from '../../src/glasses/types';
import { nb, overflowing } from './helpers';

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
    expect(nb(p.lines[0])).toBe('T3   Churchill 3   5 min');
  });

  it('éléments sur deux lignes', () => {
    const items: Item[] = [{ a: 'Pour le bureau : IC 07:42, voie 4', b2: 'partir à 07:33, 7 min à pied' }, { a: 'Autour de moi', c: '3 arrêts' }];
    expect(visibleRange(items, 0, 2)).toEqual({ from: 0, to: 1 });
    expect(ensureVisible(items, 1, 0, 2)).toBe(1);
    const p = layoutPage(view({ layout: 'menu', items }), { sel: 0, top: 0 });
    expect(p.lines.slice(0, 3).map(nb)).toEqual(['Pour le bureau : IC 07:42, voie 4', 'partir à 07:33, 7 min à pied', 'Autour de moi   3 arrêts']);
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
    // espace de tête de la fin gardée (durées des étapes, S6)
    expect(withTail('Partir à pied vers la gare', ' (7\u00a0min)', 300)).toBe('Partir à pied vers la gare (7\u00a0min)');
    const walk = withTail('À pied vers Bruxelles-Luxembourg, quai de la gare', ' (12\u00a0min)', 200);
    expect(walk.endsWith('… (12\u00a0min)')).toBe(true);
    expect(textWidth(walk)).toBeLessThanOrEqual(200);
    const long = withTail('Une destination beaucoup trop longue pour la place', ', dernier', 200);
    expect(long.endsWith('…, dernier')).toBe(true);
    expect(textWidth(long)).toBeLessThanOrEqual(200);
    expect(withTail('', ', dernier', 200)).toBe('dernier');
    expect(withTail('Churchill', undefined, 300)).toBe('Churchill');
  });

  it('withOptionalTail : ajoutée seulement si tout tient, la colonne n’est jamais coupée pour elle', () => {
    expect(nb(withOptionalTail('T3 2 min', ', dernier', 180))).toBe('T3 2 min, dernier');
    expect(nb(withOptionalTail('T3 2 min', ', dernier', 100))).toBe('T3 2 min');
    expect(withOptionalTail('', ', dernier', 180)).toBe('');
  });

  it('tableau : la colonne b garde « , dernier », sans déborder sur l’heure', () => {
    const p = layoutPage(
      view({ items: [{ a: 'T3', b: 'Simonis (Elisabeth) par le boulevard Léopold II et la basilique', bTail: ', dernier', c: '12 min' }] }),
      { sel: 0, top: 0 },
    );
    expect(nb(p.lines[0])).toMatch(/^T3 {3}Simonis .*…, dernier {3}12 min$/);
    expect(overflowing(p)).toEqual([]);
    const colB = p.containers.find((c) => c.name === 'colB')!;
    const colC = p.containers.find((c) => c.name === 'colC')!;
    expect(colB.x + textWidth(colB.content.split('\n')[0])).toBeLessThan(colC.x);
  });
});

describe('1.1 : largeurs du PRD (§ 6.0), écrans sans curseur, deux lignes réservées', () => {
  it('largeurs utiles : ligne 542, titre 476, menus 340 + 190, étapes 342 + 108', () => {
    expect(WIDTHS).toMatchObject({ full: 542, title: 476, menuLeft: 340, menuRight: 190, stepsText: 342, stepsState: 108 });
    // « dans 30 min » (108 px) tient dans la colonne d'état ; « ~07:42 » dans celle de l'heure
    expect(textWidth('dans 30\u00a0min')).toBeLessThanOrEqual(WIDTHS.stepsState);
    expect(textWidth('~07:42')).toBeLessThanOrEqual(WIDTHS.stepsTime);
    // le plus long des textes du PRD
    expect(textWidth('▲▼ autre trajet   toucher\u00a0: suivre ce trajet   double\u00a0: retour')).toBeLessThanOrEqual(WIDTHS.full);
  });

  it('sans curseur : ▶ seulement sur la ligne marquée, défilement borné à la fin de la liste', () => {
    const items: Item[] = Array.from({ length: 9 }, (_, i) => ({ a: `0${i}:00`, b: `Étape ${i}` }));
    const v = view({ layout: 'steps', screen: 'steps', items, scroll: true, mark: 2, top: { text: 'Le plus court : direct' }, note: '▼ 3 étapes de plus' });
    const cap = geometry(v).capacity;
    expect(cap).toBe(6);
    expect(maxTop(items, cap)).toBe(3);
    expect(clampTop(items, 99, cap)).toBe(3);
    const p = layoutPage(v, { sel: 5, top: 0 });
    const cursor = p.containers.find((c) => c.name === 'cursor')!.content.split('\n');
    expect(cursor.indexOf('▶')).toBe(2);
    expect(cursor.filter((x) => x === '▶')).toHaveLength(1);
    expect(p.sel).toBe(2);
    const unmarked = layoutPage({ ...v, mark: undefined }, { sel: 0, top: 4 });
    expect(unmarked.containers.find((c) => c.name === 'cursor')!.content.trim()).toBe('');
    expect(unmarked.sel).toBe(-1);
    expect(unmarked.top).toBe(3);
  });

  it('favori en calcul : deux lignes réservées, la 2e vide n’est pas journalisée', () => {
    const items: Item[] = [{ a: 'Vers le bureau', c: '…', two: true }, { a: 'Autour de moi', c: '3 arrêts' }];
    const p = layoutPage(view({ layout: 'menu', items }), { sel: 0, top: 0 });
    expect(p.lines.slice(0, 2)).toEqual(['Vers le bureau   …', 'Autour de moi   3 arrêts']);
    const colA = p.containers.find((c) => c.name === 'colA')!.content.split('\n');
    expect(colA[2]).toBe('Autour de moi');
  });
});
