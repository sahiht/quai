/**
 * Autour de moi (ordre, distances, prochain départ, concurrence) et recherche par nom.
 */
import { describe, expect, it } from 'vitest';
import type { NearbyItem } from '../../src/core/api';
import { areaLabel, hhmm, lineLabel, minutesUntil } from '../../src/core/util';
import { makeEnv } from './support/env';

const line = (x: NearbyItem, now: number) => {
  const n = x.next;
  let next = '';
  if (n) next = n.mode === 'train' ? `${n.line} ${hhmm(n.sched)} v.${n.newPlatform ?? n.platform}` : `${lineLabel(n.mode, n.line)} ${n.rt ? '' : '~'}${minutesUntil(n.est, now)} min`;
  return `${areaLabel(x.area, 'fr')} | ${x.distanceM} m | ${next}`;
};

describe('nearby', () => {
  it('scénario 2 (12:10, 500 m) : 4 zones dans l’ordre, avec le prochain départ', async () => {
    const { core, clock } = makeEnv({ now: '2026-11-10T12:10' });
    const items = await core.nearby(50.86, 4.359, 500);
    expect(items.map((x) => line(x, clock.t))).toEqual([
      'Gare du Nord, tram | 80 m | T3 2 min',
      'Bruxelles-Nord, train | 160 m | IC 12:22 v.9',
      'Bruxelles-Nord, bus De Lijn | 200 m | 232 ~5 min',
      'Rogier, métro | 340 m | M2 3 min',
    ]);
    expect(items.map((x) => x.walkMin)).toEqual([2, 3, 4, 6]);
    expect(items[1].next?.rt).toBe(true);
    expect(items[2].next?.rt).toBe(false);
  });

  it('scénario 1 (07:31, Maison, 500 m) : 3 zones', async () => {
    const { core, clock } = makeEnv({ now: '2026-11-10T07:31' });
    const items = await core.nearby(50.4655, 4.859, 500);
    expect(items.map((x) => [x.area.id, x.distanceM, x.walkMin])).toEqual([
      ['tec:N509aaa', 150, 3],
      ['sncb:8863008', 420, 7],
      ['tec:N508aga', 430, 7],
    ]);
    expect(items.map((x) => areaLabel(x.area, 'fr'))).toEqual(['Namur Place Léopold, bus TEC', 'Namur, train', 'Namur Gare, bus TEC']);
    expect(line(items[1], clock.t)).toBe('Namur, train | 420 m | IC 07:42 v.6');
    expect(items[1].next?.delayMin).toBe(2);
    expect(items[0].next).toMatchObject({ line: '5', rt: true, delayMin: 3 });
  });

  it('rayon plus petit : moins de zones ; aucun arrêt : liste vide', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    expect((await core.nearby(50.86, 4.359, 300)).map((x) => x.area.id)).toEqual(['stib:6357F', 'sncb:8812005', 'delijn:308611']);
    expect(await core.nearby(50.0, 5.5, 800)).toEqual([]);
  });

  it('un seul appel temps réel par opérateur et au plus 4 chargements simultanés', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    let active = 0;
    let peak = 0;
    const inner = env.server.fetch;
    const slow: typeof fetch = async (input, init) => {
      const href = String(input);
      const isArea = href.includes('/areas/');
      if (isArea) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
      }
      try {
        return await inner(input, init);
      } finally {
        if (isArea) active--;
      }
    };
    const { createCore } = await import('../../src/core/index');
    const { DATA_BASE, RELAY_BASE } = await import('./support/env');
    const core = createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now: env.clock.now, storage: env.kv, fetch: slow });
    const items = await core.nearby(50.86, 4.359, 2000);
    expect(items.length).toBeGreaterThan(4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(env.server.count((u) => u.includes('/api/rt?op=sncb'))).toBe(1);
    expect(env.server.count((u) => u.includes('/api/rt?op=delijn'))).toBe(1);
    expect(env.server.count((u) => u.includes('/api/stib'))).toBe(1);
  });
});

describe('search', () => {
  it('« Gand » : gares SNCB d’abord, puis les arrêts urbains (scénario 3, depuis Bruxelles-Central)', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    const r = await core.search('Gand', { lat: 50.8454, lon: 4.3571 });
    expect(r.slice(0, 3).map((x) => `${x.n.fr} (${x.kindLabel})`)).toEqual([
      'Gand-Saint-Pierre (gare SNCB)',
      'Gand-Dampoort (gare SNCB)',
      'Korenmarkt, Gand (tram De Lijn)',
    ]);
    expect(r.map((x) => x.id)).toEqual(expect.arrayContaining(['sncb:8892007', 'sncb:8893120', 'delijn:200101', 'delijn:200553']));
    // l'arrêt de tram qui porte le nom de la gare passe après les autres arrêts urbains
    expect(r[r.length - 1].id).toBe('delijn:200553');
    expect(r[0]).toMatchObject({ op: 'sncb', modes: ['train'], lat: 51.0359, lon: 3.7107 });
  });

  it('« Gand » sans position : même ordre', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    expect((await core.search('gand')).slice(0, 3).map((x) => x.id)).toEqual(['sncb:8892007', 'sncb:8893120', 'delijn:200101']);
  });

  it('noms néerlandais, plusieurs mots, accents et mots vides', async () => {
    const { core } = makeEnv({ now: '2026-11-10T13:55' });
    expect((await core.search('Gent Sint')).map((x) => x.id)).toEqual(['sncb:8892007', 'delijn:200553']);
    // 1.1 (M4.2) : « gare » facultatif, la gare SNCB d'abord
    expect((await core.search('gare du no')).map((x) => x.id)).toEqual(['sncb:8812005', 'stib:6357F', 'delijn:308611']);
    expect((await core.search('du nord')).map((x) => x.id)).toContain('stib:6357F');
    expect((await core.search('NAMUR place léo')).map((x) => x.id)).toEqual(['tec:N509aaa']);
    expect((await core.search('Namur')).map((x) => `${x.id} ${x.kindLabel}`)).toEqual(['sncb:8863008 gare SNCB', 'tec:N508aga bus TEC', 'tec:N509aaa bus TEC']);
  });

  it('proximité : à égalité, les plus proches d’abord', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    const fromNorth = await core.search('gare du', { lat: 50.86, lon: 4.359 });
    expect(fromNorth.map((x) => x.id)).toEqual(['stib:6357F', 'stib:6364']);
    const fromSouth = await core.search('gare du', { lat: 50.8358, lon: 4.336 });
    expect(fromSouth.map((x) => x.id)).toEqual(['stib:6364', 'stib:6357F']);
  });

  it('moins de 2 caractères ou fichier absent : aucun résultat', async () => {
    const { core, server } = makeEnv({ now: '2026-11-10T12:10' });
    expect(await core.search('g')).toEqual([]);
    expect(await core.search(' ')).toEqual([]);
    expect(await core.search('zzz')).toEqual([]);
    expect(await core.search('xyzzy')).toEqual([]);
    expect(server.count((u) => u.includes('/search/g.json'))).toBe(0);
  });
});
