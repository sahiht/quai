/**
 * Adresses (PRD M4, design-routing.md § 6.5) : client du relais GET /api/geocode.
 * Vie privée (CA-M4.8) : seuls q et lang partent ; hors ligne et panne distingués (CA-M4.6) ; cache ; tri local.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeocodeResponse, GeocodeResult } from '../../../shared/types';
import { GEOCODE_MAX, GeocodeClient, relayGeoTransport, sortByProximity } from '../../src/core/geocode';
import { makeEnv, RELAY_BASE } from './support/env';

afterEach(() => {
  vi.unstubAllGlobals();
});

const R = (label: string, lat: number, lon: number, score = 1, kind: GeocodeResult['kind'] = 'adresse'): GeocodeResult => ({ label, lat, lon, kind, source: 'wal', score });
const response = (results: GeocodeResult[], extra: Partial<GeocodeResponse> = {}): GeocodeResponse => ({
  q: 'x',
  fetchedAt: '2026-11-10T12:00:00Z',
  results,
  sources: { wal: { ok: true } },
  attribution: 'Adresses : SPW (ICAR)',
  ...extra,
});

function relay(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    return handler(url);
  };
  const client = new GeocodeClient(relayGeoTransport(RELAY_BASE, fetch), () => Date.parse('2026-11-10T12:00:00+01:00'));
  return { client, calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('geocode : client du relais', () => {
  it('CA-M4.8 : seuls le texte tapé et la langue partent (jamais la position ni un identifiant)', async () => {
    const { client, calls } = relay(() => json(response([R('Rue de Fer 25, 5000 Namur', 50.4662, 4.8648)])));
    const a = await client.geocode('  rue de  fer 25 namur ', 'fr', { lat: 50.4655, lon: 4.859 });
    expect(a.results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur']);
    expect(a.attribution).toBe('Adresses : SPW (ICAR)');
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe('/api/geocode');
    expect([...calls[0].searchParams.keys()].sort()).toEqual(['lang', 'q']);
    expect(calls[0].searchParams.get('q')).toBe('rue de fer 25 namur');
    expect(calls[0].searchParams.get('lang')).toBe('fr');
    expect(calls[0].href).not.toMatch(/50\.46|4\.85/);
  });

  it('3 caractères au moins, sinon rien (sans requête)', async () => {
    const { client, calls } = relay(() => json(response([])));
    expect(await client.geocode('ru', 'fr')).toEqual({ results: [] });
    expect(await client.geocode(' a b ', 'fr')).toEqual({ results: [] });
    expect(calls).toHaveLength(0);
  });

  it('cache par texte normalisé et langue ; réponse partielle jamais gardée', async () => {
    let partial = false;
    const { client, calls } = relay(() => json(response([R('Veldstraat 1, 9000 Gent', 51.0537, 3.7225)], partial ? { partial: true } : {})));
    await client.geocode('Veldstraat 1 Gent', 'fr');
    await client.geocode('veldstraat  1 gent', 'fr');
    expect(calls).toHaveLength(1);
    await client.geocode('veldstraat 1 gent', 'nl');
    expect(calls).toHaveLength(2);
    partial = true;
    const p = await client.geocode('rue neuve 1', 'fr');
    expect(p.partial).toBe(true);
    await client.geocode('rue neuve 1', 'fr');
    expect(calls).toHaveLength(4);
  });

  it('CA-M4.6 : service en panne → « down » ; téléphone hors ligne → « offline » ; jamais d’exception', async () => {
    const down = relay(() => json({ ...response([]), error: 'Recherche d’adresse indisponible pour l’instant : gares et arrêts seulement.' }));
    expect(await down.client.geocode('rue de fer 25', 'fr')).toEqual({ results: [], error: 'down' });
    const http = relay(() => new Response('oups', { status: 502 }));
    expect((await http.client.geocode('rue de fer 25', 'fr')).error).toBe('down');
    const unreachable = relay(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await unreachable.client.geocode('rue de fer 25', 'fr')).error).toBe('down');
    vi.stubGlobal('navigator', { onLine: false });
    expect((await unreachable.client.geocode('rue de fer 26', 'fr')).error).toBe('offline');
  });

  it('à score égal, les plus proches de la position d’abord ; 4 résultats au plus', async () => {
    const results = [R('Rue de Fer 25, 4000 Liège', 50.64, 5.57), R('Rue de Fer 25, 5000 Namur', 50.4662, 4.8648), R('Rue de Fer, 5000 Namur', 50.466, 4.865, 0.9, 'rue'), R('A', 50, 4, 0.5), R('B', 50, 4, 0.5), R('C', 50, 4, 0.4)];
    const { client } = relay(() => json(response(results)));
    const near = await client.geocode('rue de fer 25', 'fr', { lat: 50.4655, lon: 4.859 });
    expect(near.results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur', 'Rue de Fer 25, 4000 Liège', 'Rue de Fer, 5000 Namur', 'A']);
    expect(near.results).toHaveLength(GEOCODE_MAX);
    const noPos = await client.geocode('rue de fer 25', 'fr');
    expect(noPos.results[0].label).toBe('Rue de Fer 25, 4000 Liège'); // ordre du relais
    // l'ordre du relais n'est jamais changé entre scores différents
    expect(sortByProximity([R('loin', 51, 3, 1), R('près', 50.4655, 4.859, 0.8)], { lat: 50.4655, lon: 4.859 }).map((r) => r.label)).toEqual(['loin', 'près']);
  });

  it('par le cœur : core.geocode passe par {relayBase}/api/geocode', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    env.server.overrides.set('/api/geocode', (url) => json(response([R(`Résultat ${url.searchParams.get('q')}`, 50.85, 4.35)])));
    const a = await env.core.geocode('rue neuve 1 bruxelles', 'fr', { lat: 50.86, lon: 4.359 });
    expect(a.results.map((r) => r.label)).toEqual(['Résultat rue neuve 1 bruxelles']);
    const call = env.server.calls.find((u) => u.includes('/api/geocode'))!;
    expect(new URL(call).search).toBe('?q=rue%20neuve%201%20bruxelles&lang=fr');
    env.server.networkDown = true;
    expect((await env.core.geocode('autre adresse', 'fr')).error).toBe('down');
  });
});
