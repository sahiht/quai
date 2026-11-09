import { describe, expect, it } from 'vitest';
import { handleRt } from '../lib/handlers.js';
import type { RtResponse } from '../lib/shared/types.js';
import { BMC, NOW_MS, TEST_KEY, bmcRoute, call, feedRoute, header, makeCtx, sec, type Route } from './helpers.js';
import { encodeFeed } from '../lib/gtfsrt.js';
import { protobuf } from './helpers.js';

const NAMUR_IC = '88____:007::8863008:8814001:10:852:20261231';
const S1 = '88____:046::8812005:8883006:4:1315:20261231';
const IC_1258 = '88____:007::8814001:8821006:5:1258:20261231';
const IC_1552 = '88____:007::8812005:8821006:7:1552:20261231';
const IC_2436 = '88____:007::8814001:8821006:5:2436:20261231'; // horaire seulement, absent du temps réel

const rt = (path: string, t = makeCtx()) => call<RtResponse>(handleRt, path, t.ctx);

describe('/api/rt : SNCB via le portail BMC (fixtures)', () => {
  it('IC de Namur : +120 s, quai réel 8863008_6 (assigned_stop_id), heures estimées absolues', async () => {
    const t = makeCtx();
    const r = await rt(`/api/rt?op=sncb&trips=${encodeURIComponent(NAMUR_IC)}`, t);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      op: 'sncb',
      fetchedAt: new Date(NOW_MS).toISOString(),
      feedTimestamp: 1794309000,
      trips: {
        [NAMUR_IC]: {
          u: [
            [1, '8863008_6', 120, sec('2026-11-10T07:44:00+01:00'), 0],
            [7, '8813003_3', 120, sec('2026-11-10T08:48:00+01:00'), 0],
          ],
        },
      },
    });
    expect(r.body.error).toBeUndefined();
  });

  it('ne propage pas les retards : seuls les arrêts donnés par le flux sont renvoyés', async () => {
    const r = await rt(`/api/rt?op=sncb&trips=${NAMUR_IC}`);
    expect(r.body.trips[NAMUR_IC].u.map((x) => x[0])).toEqual([1, 7]);
  });

  it('S1 supprimé : cancelled: true', async () => {
    const r = await rt(`/api/rt?op=sncb&trips=${S1}`);
    expect(r.body.trips[S1]).toEqual({ cancelled: true, u: [] });
  });

  it('ne renvoie que les voyages demandés et présents dans le flux', async () => {
    const r = await rt(`/api/rt?op=sncb&trips=${IC_1552},${IC_2436},inconnu`);
    expect(Object.keys(r.body.trips)).toEqual([IC_1552]);
    expect(r.body.trips[IC_1552]).toEqual({ u: [[1, '8812005_12', 180, sec('2026-11-10T14:21:00+01:00'), 0]] });
    const all = await rt(`/api/rt?op=sncb&trips=${IC_1258},${S1},${NAMUR_IC}`);
    expect(Object.keys(all.body.trips).sort()).toEqual([IC_1258, NAMUR_IC, S1].sort());
    expect(all.body.trips[IC_1258].u).toEqual([[3, '8812005_9', 0, sec('2026-11-10T12:22:00+01:00'), 0]]);
  });

  it('accepte des identifiants demandés avec préfixe et répond en identifiants normalisés', async () => {
    const r = await rt(`/api/rt?op=sncb&trips=${encodeURIComponent(`gt:nmbssncb:${NAMUR_IC}`)}`);
    expect(Object.keys(r.body.trips)).toEqual([NAMUR_IC]);
  });

  it('envoie les deux en-têtes de clé au portail, sur la bonne adresse', async () => {
    const t = makeCtx();
    await rt(`/api/rt?op=sncb&trips=${S1}`, t);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe(`${BMC}/api/gtfs/feed/nmbssncb/rt/trip-update?format=protobuf`);
    expect(t.calls[0].headers['bmc-partner-key']).toBe(TEST_KEY);
    expect(t.calls[0].headers['ocp-apim-subscription-key']).toBe(TEST_KEY);
    expect(t.calls[0].redirect).toBe('error');
  });
});

describe('/api/rt : flux SNCB direct (SNCB_RT_URL)', () => {
  const DIRECT = 'https://sncb.test/sncb-direct/trip-update';

  it('utilise SNCB_RT_URL, sans préfixes, avec les mêmes résultats', async () => {
    const t = makeCtx({ env: { SNCB_RT_URL: DIRECT } });
    const r = await rt(`/api/rt?op=sncb&trips=${NAMUR_IC},${S1}`, t);
    expect(t.calls.map((c) => c.url)).toEqual([DIRECT]);
    expect(r.body.trips[NAMUR_IC].u[0]).toEqual([1, '8863008_6', 120, sec('2026-11-10T07:44:00+01:00'), 0]);
    expect(r.body.trips[S1]).toEqual({ cancelled: true, u: [] });
  });

  it("n'envoie jamais la clé BMC au flux direct et fonctionne sans BMC_KEY", async () => {
    const t = makeCtx({ env: { SNCB_RT_URL: DIRECT, BMC_KEY: undefined } });
    const r = await rt(`/api/rt?op=sncb&trips=${NAMUR_IC}`, t);
    expect(r.body.error).toBeUndefined();
    expect(Object.keys(t.calls[0].headers)).not.toContain('bmc-partner-key');
    expect(Object.keys(t.calls[0].headers)).not.toContain('ocp-apim-subscription-key');
    const t2 = makeCtx({ env: { SNCB_RT_URL: DIRECT } });
    await rt(`/api/rt?op=sncb&trips=${NAMUR_IC}`, t2);
    expect(JSON.stringify(t2.calls[0].headers)).not.toContain(TEST_KEY);
  });
});

describe('/api/rt : De Lijn et TEC (fixtures BMC)', () => {
  it('identifiants De Lijn préfixés normalisés (voyages et arrêts)', async () => {
    const r = await rt('/api/rt?op=delijn&trips=702321245,704601218,700011446');
    expect(r.body.trips).toEqual({
      '702321245': { u: [[1, '308611', 60, sec('2026-11-10T12:46:00+01:00'), 0]] },
      '704601218': { u: [[1, '308613', 120, sec('2026-11-10T12:20:00+01:00'), 0]] },
      '700011446': { u: [[2, '200553', 60, sec('2026-11-10T14:53:00+01:00'), 0]] },
    });
    expect(r.text).not.toContain('gt:');
    expect(r.text).not.toContain('gs:');
  });

  it("ignore l'entité sans trip_id et fusionne le doublon", async () => {
    const t = makeCtx();
    const r = await rt('/api/rt?op=delijn&trips=702321245,702321230', t);
    expect(Object.keys(r.body.trips).sort()).toEqual(['702321230', '702321245']);
    expect(r.body.trips['702321245'].u).toHaveLength(1);
    expect(t.logs.join('\n')).toMatch(/1 sans trip_id ignorés, 1 doublons fusionnés/);
  });

  it('TEC : bus 5 de 07:50 avec +180 s', async () => {
    const r = await rt('/api/rt?op=tec&trips=N5-0750,N4-0745,N4-2410');
    expect(r.body.trips).toEqual({
      'N5-0750': { u: [[1, 'N509aaa', 180, sec('2026-11-10T07:53:00+01:00'), 0]] },
      'N4-0745': { u: [[1, 'N508aga', 0, sec('2026-11-10T07:45:00+01:00'), 0]] },
    });
  });
});

/* ------------------------------ flux construits pour les cas limites ------------------------------ */

const T = 1794309000;
const entity = (id: string, tripUpdate: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, tripUpdate, ...extra });

async function decodeWith(feed: Record<string, unknown>, trips: string, op = 'tec') {
  const t = makeCtx({ route: feedRoute(feed) });
  return { ...(await rt(`/api/rt?op=${op}&trips=${trips}`, t)), t };
}

describe('/api/rt : sémantique des mises à jour', () => {
  it('retard = departure.delay sinon arrival.delay ; heure = departure.time sinon arrival.time', async () => {
    const r = await decodeWith({
      header: header(),
      entity: [entity('1', {
        trip: { tripId: 'A' },
        stopTimeUpdate: [
          { stopSequence: 1, stopId: 's1', arrival: { delay: 30, time: T + 30 }, departure: { delay: 60, time: T + 60 } },
          { stopSequence: 2, stopId: 's2', arrival: { delay: 30, time: T + 330 } },
          { stopSequence: 3, stopId: 's3', arrival: { delay: 45 }, departure: { time: T + 700 } },
          { stopSequence: 4, stopId: 's4' },
          { stopId: 's5', departure: { delay: -20 } },
        ],
      })],
    }, 'A');
    expect(r.body.trips.A.u).toEqual([
      [1, 's1', 60, T + 60, 0],
      [2, 's2', 30, T + 330, 0],
      [3, 's3', 45, T + 700, 0],
      [4, 's4', null, null, 0],
      [null, 's5', -20, null, 0],
    ]);
  });

  it('assigned_stop_id prioritaire sur stop_id, identifiants gs: normalisés', async () => {
    const r = await decodeWith({
      header: header(),
      entity: [entity('1', {
        trip: { tripId: 'gt:nmbssncb:B' },
        stopTimeUpdate: [
          { stopSequence: 1, stopId: 'gs:nmbssncb:8863008_4', stopTimeProperties: { assignedStopId: 'gs:nmbssncb:8863008_6' }, departure: { delay: 0 } },
          { stopSequence: 2, stopId: 'gs:nmbssncb:8874005_1', stopTimeProperties: {} },
        ],
      })],
    }, 'B', 'sncb');
    expect(r.body.trips.B.u.map((x) => x[1])).toEqual(['8863008_6', '8874005_1']);
  });

  it('arrêt SKIPPED = 1, NO_DATA = 0 ; voyage DELETED ou CANCELED = supprimé', async () => {
    const r = await decodeWith({
      header: header(),
      entity: [
        entity('1', { trip: { tripId: 'C' }, stopTimeUpdate: [
          { stopSequence: 1, stopId: 'x', scheduleRelationship: 'SKIPPED' },
          { stopSequence: 2, stopId: 'y', scheduleRelationship: 'NO_DATA' },
        ] }),
        entity('2', { trip: { tripId: 'D', scheduleRelationship: 'DELETED' } }),
        entity('3', { trip: { tripId: 'E', scheduleRelationship: 'CANCELED' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'z', departure: { delay: 0 } }] }),
        entity('4', { trip: { tripId: 'F', scheduleRelationship: 'ADDED' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'z', departure: { delay: 0 } }] }),
      ],
    }, 'C,D,E,F');
    expect(r.body.trips).toEqual({
      C: { u: [[1, 'x', null, null, 1], [2, 'y', null, null, 0]] },
      D: { cancelled: true, u: [] },
      E: { cancelled: true, u: [[1, 'z', 0, null, 0]] },
      F: { u: [[1, 'z', 0, null, 0]] },
    });
  });

  it('ignore les entités sans trip_id, sans trip_update ou supprimées (FULL_DATASET)', async () => {
    const r = await decodeWith({
      header: header(),
      entity: [
        entity('1', { trip: { routeId: 'gr:tec:N4', startTime: '12:00:00' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'x', departure: { delay: 60 } }] }),
        { id: '2', vehicle: { trip: { tripId: 'G' }, position: { latitude: 50.4, longitude: 4.8 } } },
        { id: '3', alert: { headerText: { translation: [{ text: 'x' }] } } },
        entity('4', { trip: { tripId: 'H' }, stopTimeUpdate: [] }, { isDeleted: true }),
        entity('5', { trip: { tripId: 'G' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'x', departure: { delay: 0 } }] }),
      ],
    }, 'G,H');
    expect(Object.keys(r.body.trips)).toEqual(['G']);
    expect(r.text).not.toContain('""');
  });

  it('doublons : fusion par arrêt, la mise à jour la plus récente (timestamp) l’emporte', async () => {
    const r = await decodeWith({
      header: header(),
      entity: [
        entity('1', { trip: { tripId: 'gt:tec:K' }, timestamp: T, stopTimeUpdate: [
          { stopSequence: 1, stopId: 'a', departure: { delay: 60 } },
          { stopSequence: 3, stopId: 'c', departure: { delay: 60 } },
        ] }),
        entity('2', { trip: { tripId: 'K' }, timestamp: T - 100, stopTimeUpdate: [
          { stopSequence: 1, stopId: 'a', departure: { delay: 999 } },
          { stopSequence: 2, stopId: 'b', departure: { delay: 30 } },
        ] }),
      ],
    }, 'K');
    expect(r.body.trips.K.u).toEqual([[1, 'a', 60, null, 0], [2, 'b', 30, null, 0], [3, 'c', 60, null, 0]]);
  });

  it('doublons à dates de départ différentes : celle du jour (Bruxelles) l’emporte', async () => {
    const r = await decodeWith({
      header: header(),
      entity: [
        entity('1', { trip: { tripId: 'L', startDate: '20261110' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'a', departure: { delay: 120 } }] }),
        entity('2', { trip: { tripId: 'L', startDate: '20261111' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'a', departure: { delay: 0 } }] }),
      ],
    }, 'L');
    expect(r.body.trips.L.u).toEqual([[1, 'a', 120, null, 0]]);
  });

  it('horodatages en millisecondes ramenés en secondes', async () => {
    const r = await decodeWith({
      header: header({ timestamp: T * 1000 }),
      entity: [entity('1', { trip: { tripId: 'M' }, stopTimeUpdate: [{ stopSequence: 1, stopId: 'a', departure: { time: (T + 60) * 1000 } }] })],
    }, 'M');
    expect(r.body.feedTimestamp).toBe(T);
    expect(r.body.trips.M.u[0][3]).toBe(T + 60);
  });

  it('en-tête sans horodatage : feedTimestamp absent', async () => {
    const r = await decodeWith({ header: { gtfsRealtimeVersion: '2.0' }, entity: [] }, 'M');
    expect(r.body).not.toHaveProperty('feedTimestamp');
    expect(r.body.trips).toEqual({});
  });
});

describe('/api/rt : FULL_DATASET et DIFFERENTIAL', () => {
  function sequence(feeds: Record<string, unknown>[]): Route {
    let i = 0;
    return () => protobuf(encodeFeed(feeds[Math.min(i++, feeds.length - 1)]));
  }
  const upd = (id: string, delay: number, extra: Record<string, unknown> = {}) =>
    entity(id, { trip: { tripId: id }, stopTimeUpdate: [{ stopSequence: 1, stopId: 's', departure: { delay } }] }, extra);

  it('DIFFERENTIAL : fusion avec l’état précédent de l’instance, is_deleted retire le voyage', async () => {
    const t = makeCtx({
      route: sequence([
        { header: header({ incrementality: 'DIFFERENTIAL' }), entity: [upd('X', 60), upd('Y', 120)] },
        { header: header({ incrementality: 'DIFFERENTIAL' }), entity: [upd('Z', 30), { ...upd('Y', 0), isDeleted: true }] },
      ]),
    });
    const first = await rt('/api/rt?op=tec&trips=X,Y,Z', t);
    expect(Object.keys(first.body.trips).sort()).toEqual(['X', 'Y']);
    t.advance(26_000);
    const second = await rt('/api/rt?op=tec&trips=X,Y,Z', t);
    expect(second.body.trips).toEqual({ X: { u: [[1, 's', 60, null, 0]] }, Z: { u: [[1, 's', 30, null, 0]] } });
    expect(t.calls).toHaveLength(2);
    expect(t.logs.join('\n')).toContain('flux DIFFERENTIAL');
  });

  it('FULL_DATASET : chaque flux remplace entièrement le précédent', async () => {
    const t = makeCtx({
      route: sequence([
        { header: header(), entity: [upd('X', 60), upd('Y', 120)] },
        { header: header(), entity: [upd('Z', 30)] },
      ]),
    });
    await rt('/api/rt?op=tec&trips=X,Y,Z', t);
    t.advance(26_000);
    const second = await rt('/api/rt?op=tec&trips=X,Y,Z', t);
    expect(Object.keys(second.body.trips)).toEqual(['Z']);
  });

  it('les fixtures sont au format FULL_DATASET et lues sans avertissement', async () => {
    const t = makeCtx({ route: bmcRoute() });
    await rt(`/api/rt?op=sncb&trips=${S1}`, t);
    expect(t.logs.join('\n')).not.toContain('DIFFERENTIAL');
  });
});
