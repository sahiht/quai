/**
 * Tableaux de départs via createCore : scénario 2, fusion STIB, après minuit, jour férié, sources en erreur.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure } from '../../src/core/api';
import { hhmm, lineLabel, minutesUntil } from '../../src/core/util';
import { makeEnv } from './support/env';
import { at } from './support/network';

const NOW2 = '2026-11-10T12:10';
const fmt = (b: Board, now: number) =>
  b.departures.map((d: Departure) => {
    const mins = `${d.rt ? '' : '~'}${minutesUntil(d.est, now)} min`;
    const delay = d.delayMin ? ` (+${d.delayMin})` : '';
    return d.mode === 'train'
      ? `${d.line} ${hhmm(d.sched)} v.${d.newPlatform ?? d.platform}${d.cancelled ? ' SUPPRIMÉ' : ''}${d.rt ? '' : ' ~'}${delay}`
      : `${lineLabel(d.mode, d.line)} ${d.head.fr} ${mins}${delay}`;
  });

describe('board : scénario 2 (12:10, gare du Nord)', () => {
  it('Gare du Nord, tram, filtré T3/T3/T4 : tout en temps réel STIB', async () => {
    const { core, clock, preset } = makeEnv({ now: NOW2 });
    const fav = preset.favorites.find((f) => f.id === 'fav-gdn');
    if (fav?.kind !== 'stop') throw new Error('preset');
    const b = await core.board('stib:6357F', { limit: 5, filter: fav.filter });
    expect(fmt(b, clock.t)).toEqual([
      'T3 Churchill 2 min',
      'T4 Stalle (P) 5 min',
      'T3 Esplanade 6 min',
      'T3 Churchill 10 min',
      'T4 Stalle (P) 13 min',
    ]);
    expect(b.anyPlanned).toBe(false);
    expect(b.rtErrors).toEqual([]);
    expect(b.area).toMatchObject({ id: 'stib:6357F', op: 'stib', modes: ['tram'], lines: ['3', '4'] });
    expect(b.updatedAt).toBe(clock.t);
  });

  it('STIB : au-delà du dernier passage annoncé, l’horaire prévu reprend (~)', async () => {
    const { core, clock } = makeEnv({ now: NOW2 });
    const b = await core.board('stib:6357F', { limit: 12 });
    const lines = fmt(b, clock.t);
    // T3 Churchill : direct 12:12, 12:20 ; puis prévu 12:28
    expect(lines.filter((l) => l.startsWith('T3 Churchill')).slice(0, 3)).toEqual(['T3 Churchill 2 min', 'T3 Churchill 10 min', 'T3 Churchill ~18 min']);
    expect(b.anyPlanned).toBe(true);
    // les départs prévus remplacés (12:07 T4, 12:08 T3 Esplanade) ont disparu
    expect(b.departures.every((d) => d.est >= clock.t - 60_000)).toBe(true);
    expect(b.departures.some((d) => !d.rt && d.sched <= at('2026-11-10T12:24'))).toBe(false);
  });

  it('STIB : ligne absente de WaitingTimes → horaire prévu ; message de l’opérateur conservé', async () => {
    const { core, clock } = makeEnv({ now: NOW2 });
    const b = await core.board('stib:6359', { limit: 8 });
    const lines = fmt(b, clock.t);
    // Rogier : T3/T4 (points 6359, 6360) sans temps réel ; M2/M6 en direct.
    // Le T4 prévu à 12:09 (maintenant - 1 min) reste affiché en tête.
    expect(lines.slice(0, 2)).toEqual(['T4 Stalle (P) ~0 min', 'M2 Simonis (Elisabeth) 3 min']);
    expect(lines).toContain('T3 Churchill ~4 min');
    expect(lines).toContain('M6 Roi Baudouin 5 min');
    const midi = b.departures.find((d) => d.line === '2' && d.head.fr === 'Gare du Midi');
    expect(midi).toMatchObject({ rt: true, msg: 'Travaux : arrêt Botanique non desservi' });
    expect(b.departures.find((d) => d.line === '3')?.rt).toBe(false);
  });

  it('STIB : destination légèrement différente (« STALLE » au lieu de « STALLE (P) ») reconnue', async () => {
    const env = makeEnv({ now: NOW2 });
    env.server.relay.stib.points['6357'] = [{ line: '4', dest: { fr: 'STALLE', nl: 'STALLE' }, times: ['2026-11-10T12:16:00+01:00'] }];
    const b = await env.core.board('stib:6357F', { limit: 3, filter: [{ line: '4', head: 'stalle p' }] });
    expect(b.departures.map((d) => [hhmm(d.est), d.rt, d.head.fr])).toEqual([
      ['12:16', true, 'Stalle (P)'],
      ['12:23', false, 'Stalle (P)'],
      ['12:31', false, 'Stalle (P)'],
    ]);
  });

  it('STIB : heures absurdes (passages à plus de 2 h) ignorées', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const b = await env.core.board('stib:6357F', { limit: 2, filter: [{ line: '3', head: 'churchill' }] });
    expect(b.departures.map((d) => [hhmm(d.est), d.rt])).toEqual([
      ['07:32', false],
      ['07:40', false],
    ]);
  });

  it('Bruxelles-Nord, bus De Lijn : ~ pour les voyages hors flux, retards propagés', async () => {
    const { core, clock } = makeEnv({ now: NOW2 });
    const b = await core.board('delijn:308611', { limit: 5 });
    expect(fmt(b, clock.t)).toEqual([
      '232 Vilvorde ~5 min',
      '460 Meise 10 min (+2)',
      '270 Kortenberg ~12 min',
      '232 Vilvorde 20 min',
      '232 Vilvorde 36 min (+1)',
    ]);
    expect(b.anyPlanned).toBe(true);
    expect(b.departures[1]).toMatchObject({ platform: '6', tripId: '704601218', stopSeq: 1, stopId: '308613' });
  });

  it('Bruxelles-Nord, train : à l’heure, prévu (~), supprimé à sa place', async () => {
    const { core, clock } = makeEnv({ now: NOW2 });
    const b = await core.board('sncb:8812005', { limit: 3 });
    expect(fmt(b, clock.t)).toEqual(['IC 12:22 v.9', 'IC 12:30 v.12 ~', 'S1 12:34 v.3 SUPPRIMÉ']);
    expect(b.departures[0].head.fr).toBe('Anvers-Central');
    expect(b.departures[2]).toMatchObject({ cancelled: true, rt: true, line: 'S1' });
    expect(b.anyPlanned).toBe(true);
  });
});

describe('board : temps réel SNCB du scénario 1', () => {
  it('Namur 07:31 : IC 07:42 +2, voie 6 au lieu de 4', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31' });
    const b = await core.board('sncb:8863008', { limit: 2 });
    expect(b.departures[0]).toMatchObject({ line: 'IC', platform: '4', newPlatform: '6', delayMin: 2, rt: true, cancelled: false });
    expect(hhmm(b.departures[0].sched)).toBe('07:42');
    expect(hhmm(b.departures[0].est)).toBe('07:44');
    expect(hhmm(b.departures[1].sched)).toBe('08:42');
  });

  it('un train en retard prévu avant maintenant reste affiché', async () => {
    const env = makeEnv({ now: '2026-11-10T07:50' });
    env.server.relay.rt.sncb.trips['88____:007::8863008:8814001:10:852:20261231'] = { u: [[1, '8863008_4', 600, null, 0]] };
    const b = await env.core.board('sncb:8863008', { limit: 2 });
    expect(b.departures.map((d) => [hhmm(d.sched), hhmm(d.est), d.delayMin])).toEqual([
      ['07:42', '07:52', 10],
      ['08:42', '08:42', 0],
    ]);
  });
});

describe('board : régression « IC 12:22 deux fois » (flux indexé par trip_id sans date)', () => {
  const ids = (b: Board) => b.departures.map((d) => `${d.tripId}#${d.stopSeq}`);

  it('Bruxelles-Nord à 12:10, 20 départs : chaque voyage une seule fois, le lendemain sans le temps réel du jour', async () => {
    const { core, clock } = makeEnv({ now: NOW2 });
    const b = await core.board('sncb:8812005', { limit: 20 });
    expect(new Set(ids(b)).size).toBe(b.departures.length);
    expect(b.departures.filter((d) => d.line === 'IC' && hhmm(d.sched) === '12:22')).toHaveLength(1);
    // aucun départ ne prend l'heure d'un autre jour ; horizon < 24 h
    for (const d of b.departures) {
      expect(Math.abs(d.est - d.sched)).toBeLessThan(6 * 3_600_000);
      expect(d.sched).toBeLessThan(clock.t + 23 * 3_600_000 + 1);
    }
    // les départs du lendemain (09:41, 10:41) restent en horaire prévu
    const tomorrow = b.departures.filter((d) => d.sched > at('2026-11-11T04:00'));
    expect(tomorrow.map((d) => hhmm(d.sched))).toEqual(['09:41', '10:41']);
    expect(tomorrow.every((d) => !d.rt && d.delayMin === 0)).toBe(true);
    expect(fmt(b, clock.t).slice(0, 3)).toEqual(['IC 12:22 v.9', 'IC 12:30 v.12 ~', 'S1 12:34 v.3 SUPPRIMÉ']);
  });

  it('une suppression du jour ne supprime pas le même train le lendemain', async () => {
    const env = makeEnv({ now: NOW2 });
    env.server.relay.rt.sncb.trips['88____:007::8863008:8814001:10:952:20261231'] = { cancelled: true, u: [] };
    const b = await env.core.board('sncb:8812005', { limit: 20 });
    const ic0941 = b.departures.find((d) => hhmm(d.sched) === '09:41');
    expect(ic0941).toMatchObject({ cancelled: false, rt: false });
  });

  it('autour de moi : une zone par ligne, prochain départ du jour', async () => {
    const { core } = makeEnv({ now: NOW2 });
    const items = await core.nearby(50.86, 4.359, 800);
    expect(new Set(items.map((x) => x.area.id)).size).toBe(items.length);
    const nord = items.find((x) => x.area.id === 'sncb:8812005');
    expect(nord?.next?.sched).toBe(at('2026-11-10T12:22'));
  });
});

describe('board : sources en erreur', () => {
  it('scène noRT : tout en horaire prévu, opérateur signalé', async () => {
    const { core } = makeEnv({ now: NOW2, scene: 'noRT' });
    const t = await core.board('sncb:8812005', { limit: 3 });
    expect(t.rtErrors).toEqual(['sncb']);
    expect(t.departures.every((d) => !d.rt && !d.cancelled && d.est === d.sched)).toBe(true);
    expect(t.anyPlanned).toBe(true);
    const s = await core.board('stib:6357F', { limit: 3 });
    expect(s.rtErrors).toEqual(['stib']);
    expect(s.departures.every((d) => !d.rt)).toBe(true);
    expect(s.departures.map((d) => hhmm(d.sched))).toEqual(['12:12', '12:15', '12:16']);
  });

  it('une seule source en erreur : les autres restent en temps réel', async () => {
    const env = makeEnv({ now: NOW2 });
    env.server.failing.add('delijn');
    const dl = await env.core.board('delijn:308611', { limit: 3 });
    expect(dl.rtErrors).toEqual(['delijn']);
    expect(dl.departures.every((d) => !d.rt)).toBe(true);
    const tr = await env.core.board('sncb:8812005', { limit: 1 });
    expect(tr.rtErrors).toEqual([]);
    expect(tr.departures[0].rt).toBe(true);
  });

  it('relais injoignable (exception réseau) : horaire prévu, pas d’exception', async () => {
    const env = makeEnv({ now: NOW2 });
    await env.core.init();
    await env.core.board('sncb:8812005');
    env.server.overrides.set('/api/rt', () => {
      throw new TypeError('Failed to fetch');
    });
    env.clock.advance(25_000);
    const b = await env.core.board('sncb:8812005', { limit: 2 });
    expect(b.rtErrors).toEqual(['sncb']);
  });
});

describe('board : après minuit et jour férié', () => {
  it('Bruxelles-Nord à 23:55 : IC 2199 à 00:01 (horaire GTFS 24:01)', async () => {
    const { core } = makeEnv({ now: '2026-11-10T23:55' });
    const b = await core.board('sncb:8812005', { limit: 2 });
    expect(b.departures[0]).toMatchObject({ line: 'IC', platform: '9' });
    expect(b.departures[0].sched).toBe(at('2026-11-11T00:01'));
    expect(hhmm(b.departures[0].sched)).toBe('00:01');
  });

  it('Namur Gare (TEC) à 00:05 le 11 : bus 4 de 24:10 (jour de service du 10)', async () => {
    const { core } = makeEnv({ now: '2026-11-11T00:05' });
    const b = await core.board('tec:N508aga', { limit: 1 });
    expect(b.departures[0]).toMatchObject({ line: '4', tripId: 'N4-2410' });
    expect(b.departures[0].sched).toBe(at('2026-11-11T00:10'));
  });

  it('2026-11-11 (férié) à Namur : seuls l’IC 08:42 (DAILY) et l’IC 09:42 (HOLI)', async () => {
    const { core } = makeEnv({ now: '2026-11-11T06:00', scene: 'noRT' });
    const b = await core.board('sncb:8863008', { limit: 8 });
    expect(b.departures.map((d) => hhmm(d.sched))).toEqual(['08:42', '09:42']);
  });

  it('férié : le bus TEC 51 (WEEK) ne circule pas, le 4 (DAILY) oui', async () => {
    const { core } = makeEnv({ now: '2026-11-11T07:00', scene: 'noRT' });
    const b = await core.board('tec:N508aga', { limit: 8 });
    expect(b.departures.some((d) => d.line === '51')).toBe(false);
    expect(b.departures.some((d) => d.line === '4')).toBe(true);
  });
});

describe('board : options et lignes', () => {
  it('limit par défaut 8, filtre par ligne et direction', async () => {
    const { core } = makeEnv({ now: NOW2 });
    expect((await core.board('stib:6359')).departures).toHaveLength(8);
    const only = await core.board('stib:6359', { filter: [{ line: '6', head: 'roi baudouin' }] });
    expect(only.departures.every((d) => d.line === '6')).toBe(true);
    expect(only.departures.length).toBe(8);
  });

  it('linesAt : lignes et directions avec leur filtre', async () => {
    const { core } = makeEnv({ now: NOW2 });
    const l = await core.linesAt('stib:6357F');
    expect(l.map((x) => `${x.line} ${x.head.fr} [${x.filter.head}]`)).toEqual([
      '3 Churchill [churchill]',
      '3 Esplanade [esplanade]',
      '4 Stalle (P) [stalle p]',
    ]);
    expect(l[0].mode).toBe('tram');
  });

  it('zone inconnue : erreur lisible', async () => {
    const { core } = makeEnv({ now: NOW2 });
    await expect(core.board('stib:0000')).rejects.toThrow('Arrêt introuvable');
    await expect(core.board('nimportequoi')).rejects.toThrow('Arrêt introuvable');
  });
});

describe('cas limites', () => {
  it('fin des données : moins de départs que demandé, sans erreur', async () => {
    const { core } = makeEnv({ now: '2026-11-11T23:59', scene: 'noRT' });
    const b = await core.board('sncb:8863008', { limit: 5 });
    expect(b.departures).toEqual([]);
    expect(b.anyPlanned).toBe(false);
  });

  it('rayon nul, requête faite de ponctuation, limite absurde', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    expect(await core.nearby(50.86, 4.359, 0)).toEqual([]);
    expect(await core.search(' -- ')).toEqual([]);
    expect((await core.board('stib:6357F', { limit: -3 })).departures).toHaveLength(1);
  });
});

