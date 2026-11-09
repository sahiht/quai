import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEED_TIMESTAMP, FIXTURES_DIR, buildFixtures } from '../../fixtures/relay/make-rt.js';
import { decodeFeed } from '../lib/gtfsrt.js';

const files = buildFixtures();
const pb = (path: string) => decodeFeed(readFileSync(join(FIXTURES_DIR, path)));

describe('fixtures du relais (npm run make-rt)', () => {
  it.each([...files.keys()])('%s est à jour par rapport à fixtures/network.json', (path) => {
    const expected = files.get(path)!;
    const actual = readFileSync(join(FIXTURES_DIR, path));
    const same = actual.equals(typeof expected === 'string' ? Buffer.from(expected, 'utf8') : Buffer.from(expected));
    expect(same, `fixtures/relay/${path} est périmé : lancer npm run make-rt`).toBe(true);
  });

  it('flux BMC : en-tête FULL_DATASET horodaté 1794309000, identifiants préfixés gt:, gs:, gr:', () => {
    for (const slug of ['nmbssncb', 'delijn', 'tec']) {
      const msg = pb(`bmc/${slug}/trip-update.pb`);
      expect(Number(msg.header.timestamp)).toBe(FEED_TIMESTAMP);
      const withTrip = msg.entity.filter((e) => e.tripUpdate?.trip?.tripId);
      expect(withTrip.length).toBeGreaterThan(0);
      for (const e of withTrip) {
        expect(e.tripUpdate!.trip.tripId).toMatch(new RegExp(`^gt:${slug}:`));
        expect(e.tripUpdate!.trip.routeId).toMatch(new RegExp(`^gr:${slug}:`));
        for (const s of e.tripUpdate!.stopTimeUpdate ?? []) expect(s.stopId).toMatch(new RegExp(`^gs:${slug}:`));
      }
    }
    expect(pb('bmc/nmbssncb/alert.pb').entity).toHaveLength(1);
    expect(pb('bmc/delijn/alert.pb').entity).toHaveLength(0);
  });

  it('flux SNCB direct : mêmes voyages, sans préfixes, quai réel dans stop_id', () => {
    const msg = pb('sncb-direct/trip-update.pb');
    expect(msg.entity.map((e) => e.tripUpdate!.trip.tripId).every((id) => id && !id.startsWith('gt:'))).toBe(true);
    expect(msg.entity[0].tripUpdate!.stopTimeUpdate![0].stopId).toBe('8863008_6');
  });

  it('STIB : enveloppe Opendatasoft, passingtimes en chaîne JSON, destinations en majuscules, heures absolues', () => {
    const body = JSON.parse(readFileSync(join(FIXTURES_DIR, 'bmc/stibmivb/waiting-times.json'), 'utf8')) as {
      total_count: number; results: { pointid: string; lineid: string; passingtimes: string }[];
    };
    expect(body.total_count).toBe(body.results.length);
    for (const row of body.results) {
      expect(typeof row.passingtimes).toBe('string');
      for (const p of JSON.parse(row.passingtimes) as { destination: { fr: string }; expectedArrivalTime: string }[]) {
        expect(p.destination.fr).toBe(p.destination.fr.toUpperCase());
        expect(p.expectedArrivalTime).toMatch(/^2026-11-10T\d{2}:\d{2}:00\+01:00$/);
      }
    }
  });
});
