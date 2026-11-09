/**
 * Règles GTFS-RT (fonctions pures) : propagation, heure absolue, voie modifiée, suppression, arrêt sauté,
 * voyage hors flux, séquence nulle.
 */
import { describe, expect, it } from 'vitest';
import { applyTripToDeparture } from '../../src/core/boards';
import type { Departure } from '../../src/core/api';
import type { RtTrip } from '../../src/core/realtime';
import { parseRt, parseStib, parseStibTime } from '../../src/core/realtime';
import { delayMinutes, headKey, headScore, platformOfStopId, rtAtStop, rtOccurrence, sameStop } from '../../src/core/rtmerge';
import { at } from './support/network';

const T = at('2026-11-10T08:00');
const MIN = 60_000;

describe('rtAtStop : règles GTFS-RT', () => {
  const trip: RtTrip = {
    u: [
      [1, '8863008_6', 120, null, 0],
      [7, '8813003_3', 300, null, 0],
    ],
  };

  it('voyage hors flux : horaire prévu, pas de temps réel', () => {
    expect(rtAtStop(undefined, { seq: 3, sched: T })).toEqual({ rt: false, est: T, cancelled: false, delaySec: 0 });
    expect(rtAtStop(null, { seq: 3, sched: T }).rt).toBe(false);
  });

  it('mise à jour de l’arrêt trouvée par stop_sequence', () => {
    const r = rtAtStop(trip, { seq: 7, stopId: '8813003_3', sched: T, platform: '3' });
    expect(r).toMatchObject({ rt: true, est: T + 5 * MIN, cancelled: false, delaySec: 300 });
    expect(r.newPlatform).toBeUndefined();
  });

  it('propagation du retard de la mise à jour précédente la plus proche', () => {
    expect(rtAtStop(trip, { seq: 4, sched: T }).est).toBe(T + 2 * MIN);
    expect(rtAtStop(trip, { seq: 8, sched: T }).est).toBe(T + 5 * MIN);
  });

  it('aucune mise à jour précédente : à l’heure mais temps réel', () => {
    const late: RtTrip = { u: [[5, 'x', 600, null, 0]] };
    expect(rtAtStop(late, { seq: 2, sched: T })).toMatchObject({ rt: true, est: T, delaySec: 0 });
  });

  it('l’heure absolue l’emporte sur le retard', () => {
    const abs: RtTrip = { u: [[2, 's', 60, Math.round((T + 4 * MIN) / 1000), 0]] };
    expect(rtAtStop(abs, { seq: 2, sched: T }).est).toBe(T + 4 * MIN);
  });

  it('heure absolue seule sur un arrêt précédent : convertie en retard si l’horaire prévu est connu', () => {
    const abs: RtTrip = { u: [[1, 's', null, Math.round((T + 3 * MIN) / 1000), 0]] };
    const ctx = { schedOfSeq: (seq: number) => (seq === 1 ? T : undefined) };
    expect(rtAtStop(abs, { seq: 4, sched: T + 30 * MIN }, ctx).est).toBe(T + 33 * MIN);
    // sans horaire connu : pas de propagation possible, à l'heure
    expect(rtAtStop(abs, { seq: 4, sched: T + 30 * MIN }).est).toBe(T + 30 * MIN);
  });

  it('arrêt sauté : supprimé ; les arrêts sautés ne propagent rien', () => {
    const sk: RtTrip = {
      u: [
        [1, 'a', 120, null, 0],
        [3, 'c', null, null, 1],
      ],
    };
    expect(rtAtStop(sk, { seq: 3, sched: T })).toMatchObject({ cancelled: true, rt: true });
    expect(rtAtStop(sk, { seq: 4, sched: T }).est).toBe(T + 2 * MIN);
  });

  it('voyage supprimé : tous ses arrêts supprimés', () => {
    expect(rtAtStop({ cancelled: true, u: [] }, { seq: 1, sched: T })).toMatchObject({ rt: true, cancelled: true, est: T });
  });

  it('séquence nulle : correspondance par identifiant d’arrêt', () => {
    const noSeq: RtTrip = { u: [[null, '308611', 90, null, 0]] };
    expect(rtAtStop(noSeq, { seq: 1, stopId: '308611', sched: T }).est).toBe(T + 90_000);
    expect(rtAtStop(noSeq, { seq: 1, stopId: '999', sched: T }).est).toBe(T);
  });

  it('SNCB : quai temps réel différent du quai prévu → voie modifiée', () => {
    const r = rtAtStop(trip, { seq: 1, stopId: '8863008_4', sched: T, platform: '4' });
    expect(r.newPlatform).toBe('6');
    expect(r.est).toBe(T + 2 * MIN);
    // séquence nulle + quai différent : même gare reconnue
    const ns: RtTrip = { u: [[null, '8863008_6', 0, null, 0]] };
    expect(rtAtStop(ns, { seq: 1, stopId: '8863008_4', sched: T, platform: '4' }).newPlatform).toBe('6');
    // même quai : rien
    expect(rtAtStop({ u: [[1, '8863008_4', 0, null, 0]] }, { seq: 1, stopId: '8863008_4', sched: T, platform: '4' }).newPlatform).toBeUndefined();
  });

  it('régression : mise à jour d’un autre jour (même trip_id) → horaire prévu, pas l’heure du jour', () => {
    const today = { u: [[3, '8812005_9', 0, Math.round(T / 1000), 0]] } satisfies RtTrip;
    const tomorrow = T + 24 * 3_600_000;
    expect(rtAtStop(today, { seq: 3, stopId: '8812005_9', sched: tomorrow })).toEqual({ rt: false, est: tomorrow, cancelled: false, delaySec: 0 });
    expect(rtAtStop(today, { seq: 3, stopId: '8812005_9', sched: T })).toMatchObject({ rt: true, est: T });
    // retard absurde (plus de 6 h) : ignoré
    expect(rtAtStop({ u: [[1, 'x', 8 * 3600, null, 0]] }, { seq: 1, sched: T }).rt).toBe(false);
    // fenêtre d'occurrence : ± 6 h autour de maintenant
    expect(rtOccurrence(T + 5 * 3_600_000, T)).toBe(true);
    expect(rtOccurrence(T + 21 * 3_600_000, T)).toBe(false);
    expect(rtOccurrence(T - 7 * 3_600_000, T)).toBe(false);
  });

  it('outils : quais, arrêts, retards, destinations', () => {
    expect(platformOfStopId('gs:nmbssncb:8863008_12')).toBe('12');
    expect(platformOfStopId('8863008')).toBeUndefined();
    expect(sameStop('8863008_4', 'gs:nmbssncb:8863008_6')).toBe(true);
    expect(sameStop('308611', '308613')).toBe(false);
    expect(delayMinutes(T + 90_000, T)).toBe(2);
    expect(delayMinutes(T - 120_000, T)).toBe(0);
    expect(headKey('STALLE (P)')).toBe('stalle p');
    expect(headScore('stalle', 'stalle p')).toBe(2);
    expect(headScore('churchill', 'esplanade')).toBe(0);
  });
});

describe('applyTripToDeparture', () => {
  const base: Departure = {
    op: 'sncb', mode: 'train', line: 'IC', head: { fr: 'Bruxelles-Midi', nl: 'Brussel-Zuid' },
    sched: T, est: T, rt: false, delayMin: 0, cancelled: false, platform: '4', tripId: 't', stopSeq: 1, stopId: '8863008_4',
  };
  it('retard, voie et suppression', () => {
    const d = applyTripToDeparture(base, { u: [[1, '8863008_6', 120, null, 0]] }, '8863008_4');
    expect(d).toMatchObject({ rt: true, est: T + 2 * MIN, delayMin: 2, newPlatform: '6', cancelled: false });
    const c = applyTripToDeparture(base, { cancelled: true, u: [] }, '8863008_4');
    expect(c).toMatchObject({ rt: true, cancelled: true, delayMin: 0 });
    expect(c.newPlatform).toBeUndefined();
    expect(applyTripToDeparture(base, null, '8863008_4')).toMatchObject({ rt: false, est: T });
  });
});

describe('analyse des réponses du relais', () => {
  it('/api/rt : identifiants normalisés, champs manquants tolérés', () => {
    const m = parseRt({ op: 'sncb', fetchedAt: '', trips: { 'gt:nmbssncb:abc': { u: [[1, 'gs:nmbssncb:8863008_6', '120', null, 0], ['x']] }, def: { cancelled: true } } });
    expect(m.get('abc')?.u).toEqual([[1, '8863008_6', 120, null, 0]]);
    expect(m.get('def')).toEqual({ cancelled: true, u: [] });
    expect(() => parseRt({ error: 'x' })).toThrow();
  });

  it('/api/stib : passingtimes en chaîne JSON, heures ISO ou HH:MM, message objet', () => {
    const now = at('2026-11-10T12:10');
    const m = parseStib(
      {
        fetchedAt: '',
        points: {
          '6357': [
            { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: '["2026-11-10T12:12:00+01:00","12:20"]', msg: { fr: 'Travaux', nl: 'Werken' } },
            { lineId: 4, destination: 'STALLE (P)', times: [{ expectedArrivalTime: '2026-11-10T12:15:00+01:00' }] },
          ],
        },
      },
      now,
    );
    const e = m.get('6357') ?? [];
    expect(e[0]).toEqual({ line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [at('2026-11-10T12:12'), at('2026-11-10T12:20')], msg: 'Travaux' });
    expect(e[1]).toMatchObject({ line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: [at('2026-11-10T12:15')] });
  });

  it('heure STIB « HH:MM » : la plus proche de maintenant, y compris après minuit', () => {
    expect(parseStibTime('00:05', at('2026-11-10T23:58'))).toBe(at('2026-11-11T00:05'));
    expect(parseStibTime('23:58', at('2026-11-11T00:02'))).toBe(at('2026-11-10T23:58'));
    expect(parseStibTime('n’importe quoi', at('2026-11-10T12:00'))).toBeNull();
  });
});
