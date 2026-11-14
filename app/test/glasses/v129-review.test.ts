/**
 * Quai 1.2.9, relecture avant publication : (1) « Arrêts de bus, tram, métro » : un arrêt dont le rafraîchissement
 * échoue longtemps garde sa dernière valeur tant qu'elle dit quelque chose de vrai, puis « … » (inconnu), jamais
 * « aucun passage dans les prochaines heures » (sonde de la relecture des lunettes) ; (2) « Dans le train » : l'état
 * (« , SUPPRIMÉ », « , +3 min ») et le jour ne sont jamais coupés par une longue destination.
 */
import { describe, expect, it } from 'vitest';
import { trainView } from '../../src/glasses/views';
import { LINES, at, boardOf, dep, journey, nb, page, settingsWith, setup, stubCore, type Screen } from './helpers';

const NOW = at('2026-11-12', 7, 31);
const N = (fr: string) => ({ fr, nl: fr });

describe('1.2.9 : « Arrêts » : arrêt dont le rafraîchissement échoue longtemps', () => {
  it('ses départs gardés tant qu’ils sont à venir, puis « … », jamais « aucun passage dans les prochaines heures »', async () => {
    let fail = false;
    const rogier = { ...LINES.gdnAll, id: 'ln-rogier', areaId: 'stib:5001', name: N('Rogier') };
    const h = await setup({
      now: NOW,
      settings: settingsWith([], { seenVersion: '1.2.9', lines: [LINES.gdnAll, rogier] }),
      core: (now) =>
        stubCore(now, {
          board: (id) => {
            if (id === LINES.gdnAll.areaId) return boardOf(id, 'Gare du Nord', [dep(now(), 3, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') })]);
            if (id !== rogier.areaId) return undefined;
            if (fail) throw new Error('Horaires injoignables');
            return boardOf(id, 'Rogier', [dep(NOW, 5, { op: 'stib', mode: 'metro', line: '2', head: N('Simonis') }), dep(NOW, 9, { op: 'stib', mode: 'metro', line: '6', head: N('Roi Baudouin') })]);
          },
        }),
    });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'lines' });
    const s = await h.until((x: Screen) => x.screen === 'lines' && !x.lines.some((l) => l.trim() === '…'));
    expect(s.lines.slice(2, 5)).toEqual(['Rogier', 'Métro 2 vers Simonis   5 min', 'Métro 6 vers Roi Baudouin   9 min']);
    await h.settle(50);
    fail = true;
    // 2 minutes d'échecs : la dernière valeur reste
    for (let k = 0; k < 4; k++) {
      h.advance(30_000);
      await h.c.refreshCurrent();
      await h.settle(20);
    }
    expect(h.last().lines[2]).toBe('Rogier');
    expect(h.last().lines[3]).toMatch(/^Métro 2 vers Simonis {3}3 min$/);
    // 10 minutes : ses départs sont passés, on ne sait plus rien
    for (let k = 0; k < 16; k++) {
      h.advance(30_000);
      await h.c.refreshCurrent();
      await h.settle(20);
    }
    expect(h.last().lines.slice(2, 4)).toEqual(['Rogier', '…']);
    h.c.stop();
  });
});

describe('1.2.9 : « Dans le train » : l’état et le jour jamais coupés', () => {
  it('« , SUPPRIMÉ, demain » et « , +4 min » restent, la destination coupée avant eux', () => {
    const late = at('2026-11-12', 23, 40);
    const long = { ride: '69', mode: 'bus' as const, dep: at('2026-11-13', 6, 10), arr: at('2026-11-13', 6, 24), from: 'Tubize Gare', to: 'Braine-le-Chateau Quatre Bras', head: 'Braine-le-Chateau Quatre Bras (Rue de Nivelles)' };
    const cancelled = journey('j-69', [long]);
    const ride = cancelled.legs.findIndex((l) => l.kind === 'ride');
    cancelled.legs[ride] = { ...cancelled.legs[ride], cancelled: true };
    const t1 = nb(page(trainView(cancelled, ride, { now: late, settings: settingsWith([]) })).title);
    expect(t1.startsWith('Bus 69 vers Braine-le-Chateau')).toBe(true);
    expect(t1.endsWith(', SUPPRIMÉ, demain')).toBe(true);
    const delayed = journey('j-69b', [long]);
    delayed.legs[ride] = { ...delayed.legs[ride], delayMin: 4 };
    const t2 = nb(page(trainView(delayed, ride, { now: at('2026-11-13', 6, 0), settings: settingsWith([]) })).title);
    expect(t2.endsWith(', +4 min')).toBe(true);
  });
});
