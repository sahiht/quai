/**
 * Faux service d'adresses (fixtures/relay/mock-geocode.ts) : tableau cohérent avec fixtures/network.json (adresses
 * utilisées par le réseau de test), chaque texte tapé retrouve son adresse par le relais, scènes et journal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleGeocode } from '../lib/geocode/service.js';
import type { GeocodeResponse } from '../lib/shared/types.js';
import { createMockGeoState, loadFakeAddresses, mockGeoReply, type FakeAddress } from '../../fixtures/relay/mock-geocode.js';
import { call, makeCtx, stackRoute } from './helpers.js';

const table = loadFakeAddresses();
const labelOf = (a: FakeAddress, lang: 'fr' | 'nl' = 'fr') => {
  const street = a.street[lang] ?? a.street.fr ?? a.street.nl;
  const muni = a.municipality[lang] ?? a.municipality.fr ?? a.municipality.nl;
  return `${street}${a.number ? ` ${a.number}` : ''}, ${a.postcode} ${muni}`;
};

describe('tableau du faux service', () => {
  it('reprend les adresses de fixtures/network.json (même libellé, même position)', () => {
    const network = JSON.parse(readFileSync(new URL('../../fixtures/network.json', import.meta.url), 'utf8')) as {
      addresses?: { id: string; label: string; lat: number; lon: number }[];
    };
    for (const a of network.addresses ?? []) {
      const found = table.find((x) => labelOf(x) === a.label);
      expect(found, `${a.label} absent de fixtures/relay/geocode/fake-addresses.json`).toBeDefined();
      expect([found!.lat, found!.lon]).toEqual([a.lat, a.lon]);
    }
  });

  it('chaque texte tapé du tableau retrouve son adresse par le relais, avec sa position exacte', async () => {
    for (const a of table) {
      for (const typed of a.typed) {
        const t = makeCtx({ route: stackRoute() });
        const r = await call<GeocodeResponse>(handleGeocode, `/api/geocode?q=${encodeURIComponent(typed)}`, t.ctx);
        const hit = r.body.results.find((x) => x.label === labelOf(a));
        expect(hit, `« ${typed} » ne donne pas ${labelOf(a)}`).toBeDefined();
        expect([hit!.lat, hit!.lon]).toEqual([a.lat, a.lon]);
      }
    }
  });
});

describe('scènes et journal', () => {
  const get = (state: ReturnType<typeof createMockGeoState>, path: string, method = 'GET') =>
    mockGeoReply(state, table, method, new URL(`http://mock${path}`), { 'user-agent': 'test' });

  it('down limité à un service ; slow et garbage ; retour à base', () => {
    const s = createMockGeoState();
    expect(get(s, '/__scene/down?sources=wal', 'POST').status).toBe(200);
    expect(JSON.parse(get(s, '/__scene').body)).toEqual({ scene: 'down', sources: ['wal'] });
    expect(get(s, '/geocodeWS/searchAll?address=namur&geom=true&crs=EPSG:4326').status).toBe(503);
    expect(get(s, '/geolocation/v4/Location?q=gent&c=5').status).toBe(200);
    get(s, '/__scene/slow', 'POST');
    expect(get(s, '/geolocation/v4/Location?q=gent&c=5').delayMs).toBe(3000);
    get(s, '/__scene/garbage', 'POST');
    const garbage = get(s, '/geolocation/v4/Location?q=gent&c=5');
    expect([garbage.status, garbage.type]).toEqual([200, 'text/html; charset=utf-8']);
    expect(get(s, '/__scene/base', 'GET').status).toBe(405);
    get(s, '/__scene/base', 'POST');
    expect(get(s, '/geocodeWS/searchAll?address=namur').status).toBe(200);
  });

  it('paramètres manquants refusés comme par les vrais services ; Lambert 72 par défaut chez SPW', () => {
    const s = createMockGeoState();
    expect(get(s, '/geolocation/v4/Location?c=5').status).toBe(400);
    expect(get(s, '/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?freeText=x&model=BeStPlus').status).toBe(400);
    expect(get(s, '/geocodeWS/searchAll?address=x&crs=EPSG:2154').status).toBe(400);
    const lambert = JSON.parse(get(s, '/geocodeWS/searchAll?address=rue%20de%20fer%2025%20namur&geom=true').body) as {
      candidates: { geotag: { geometry: { crs: { properties: { name: string } }; coordinates: number[] } } }[];
    };
    expect(lambert.candidates[0].geotag.geometry.crs.properties.name).toBe('EPSG:31370');
    expect(lambert.candidates[0].geotag.geometry.coordinates[0]).toBeGreaterThan(100_000);
  });

  it('journal : service, paramètres et en-têtes reçus ; remise à zéro ; compteurs', () => {
    const s = createMockGeoState();
    get(s, '/geocodeWS/searchAll?address=rue%20de%20fer');
    expect(s.journal).toEqual([{ at: expect.any(String), source: 'wal', method: 'GET', path: '/geocodeWS/searchAll', params: { address: 'rue de fer' }, headers: { 'user-agent': 'test' } }]);
    expect(JSON.parse(get(s, '/__stats').body)).toEqual({ requests: { wal: 1 } });
    get(s, '/__journal/reset', 'POST');
    expect(s.journal).toEqual([]);
  });
});
