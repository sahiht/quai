/**
 * Tests de contrat des trois services d'adresses, sur les réponses types de fixtures/relay/geocode/ (relevées en
 * direct ou reconstituées, voir le README de ce dossier) : réponse normale, vide, délai, HTTP 500, JSON illisible,
 * format inattendu. Adresses des requêtes : seuls le texte tapé et la langue partent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGeoConfig, type GeoId } from '../lib/config.js';
import { ALL_DOWN, handleGeocode } from '../lib/geocode/service.js';
import { FormatError, parseBru, parseVla, parseWal, sourceUrl } from '../lib/geocode/sources.js';
import { CACHE_GEO, CACHE_GEO_EMPTY } from '../lib/http.js';
import type { GeocodeResponse } from '../lib/shared/types.js';
import { FIXTURES_DIR, GEO, call, jsonBody, makeCtx, never, type Route } from './helpers.js';

const fx = (path: string): unknown => JSON.parse(readFileSync(`${FIXTURES_DIR}geocode/${path}`, 'utf8'));
const html = (status = 200) => new Response(readFileSync(`${FIXTURES_DIR}geocode/common/erreur-500.html`), { status, headers: { 'Content-Type': 'text/html' } });

describe('adresses des requêtes (seuls le texte tapé et la langue)', () => {
  it('formats des trois services officiels', () => {
    const cfg = readGeoConfig({});
    expect(sourceUrl(cfg, 'vla', 'veldstraat 1 gent', 'fr')).toBe('https://geo.api.vlaanderen.be/geolocation/v4/Location?q=veldstraat%201%20gent&c=5');
    expect(sourceUrl(cfg, 'bru', 'rue neuve 1', 'nl'))
      .toBe('https://geoservices.irisnet.be/geocoding/api/v1/brussels/geocoding/freeSearch/searchAnyObject?searchLanguage=nl&freeText=rue%20neuve%201&model=BeStPlus');
    expect(sourceUrl(cfg, 'wal', 'chaussée de bruxelles 1', 'fr'))
      .toBe('https://geoservices.wallonie.be/geocodeWS/searchAll?address=chauss%C3%A9e%20de%20bruxelles%201&crs=EPSG:4326&geom=true&lang=fr&levels=1,2,3,4,7');
  });

  it('adresses configurables : une base par service, ou une base unique (faux service)', () => {
    const own = readGeoConfig({ QUAI_GEO_WAL_BASE: 'https://wal.example/geo/', QUAI_GEO_BASE: 'http://localhost:8790' });
    expect(own.base).toEqual({
      vla: 'http://localhost:8790/geolocation/v4',
      bru: 'http://localhost:8790/geocoding/api/v1/brussels/geocoding',
      wal: 'https://wal.example/geo',
    });
    expect(readGeoConfig({}).sources).toEqual(['vla', 'bru', 'wal']);
    expect(readGeoConfig({ GEOCODE_SOURCES: 'wal, google ,vla,wal,xyz' })).toMatchObject({ sources: ['wal', 'vla'], ignored: ['google', 'xyz'] });
  });
});

describe('Flandre (Digitaal Vlaanderen, Location v4)', () => {
  it('Veldstraat 1, Gand (réponse relevée en direct) : adresses exactes, WGS84 du service', () => {
    const c = parseVla(fx('vla/location-veldstraat-1-gent.json'));
    expect(c).toHaveLength(5);
    expect(c[0]).toMatchObject({
      source: 'vla', kind: 'adresse', approx: false, number: '1', postcode: '9000', region: 'vla', id: '2327665',
      variants: [{ lang: 'nl', street: 'Veldstraat', municipality: 'Gent' }],
    });
    expect(c[0].lat).toBeCloseTo(51.053595747924049, 9);
    expect(c.map((x) => x.number)).toEqual(['1', '10', '100', '11', '12']);
  });

  it('commune et rues sans numéro : position approximative', () => {
    const c = parseVla(fx('vla/location-gent.json'));
    expect(c.map((x) => [x.kind, x.approx])).toEqual([['commune', true], ['rue', true], ['rue', true], ['rue', true], ['rue', true]]);
    expect(c[1]).toMatchObject({ postcode: '9820', variants: [{ street: 'Gentbos', municipality: 'Merelbeke-Melle' }] });
  });

  it('Bruxelles par le service flamand (urbis_huisnummer) : Région Bruxelles, noms néerlandais', () => {
    const c = parseVla(fx('vla/location-nieuwstraat-1-brussel.json'));
    expect(c[0]).toMatchObject({ kind: 'adresse', region: 'bru', postcode: '1000', variants: [{ lang: 'nl', street: 'Nieuwstraat', municipality: 'Brussel' }] });
  });

  it('numéro interpolé : approximatif ; sans WGS84 : Lambert 72 converti', () => {
    const [item] = (fx('vla/location-veldstraat-1-gent.json') as { LocationResult: Record<string, unknown>[] }).LocationResult;
    const location = item.Location as Record<string, number>;
    const c = parseVla({ LocationResult: [
      { ...item, LocationType: 'basisregisters_huisnummer_geinterpoleerd' },
      { ...item, Location: { X_Lambert72: location.X_Lambert72, Y_Lambert72: location.Y_Lambert72 } },
    ] });
    expect(c[0].approx).toBe(true);
    expect(c[1].lat).toBeCloseTo(51.0535957, 6);
    expect(c[1].lon).toBeCloseTo(3.7224103, 6);
  });

  it('vide et format inattendu', () => {
    expect(parseVla(fx('vla/location-empty.json'))).toEqual([]);
    expect(() => parseVla({ Message: 'An error has occurred.' })).toThrow(FormatError);
  });
});

describe('Wallonie (SPW, ICAR searchAll)', () => {
  it('Rue de Fer 25, Namur (réponse relevée en direct) : niveau 4, coordonnées [lon, lat] en EPSG:4326', () => {
    const [c] = parseWal(fx('wal/searchall-rue-de-fer-25-namur.json'));
    expect(c).toMatchObject({
      source: 'wal', kind: 'adresse', approx: false, number: '25', postcode: '5000', region: 'wal', id: '4:367956',
      variants: [{ lang: 'fr', street: 'Rue de Fer', municipality: 'Namur' }],
    });
    expect([c.lat, c.lon]).toEqual([50.46540393341745, 4.865011263015592]);
  });

  it('Namur : commune (niveau 1), zone d’adresse (niveau 2), rues avec ou sans code postal (niveau 3)', () => {
    const c = parseWal(fx('wal/searchall-namur.json'));
    expect(c.map((x) => [x.kind, x.postcode ?? '', x.variants[0].street ?? '', x.variants[0].municipality])).toEqual([
      ['commune', '', '', 'Namur'],
      ['commune', '5000', '', 'Namur'],
      ['rue', '', 'Rue Yolande de Namur', 'Namur'],
      ['rue', '5000', 'Rue de Namur', 'Namur'],
      ['rue', '', 'Place du Château de Namur', 'Namur'],
      ['rue', '5020', 'Vieux chemin de Namur', 'Namur'],
    ]);
    // score de la source : densité de couverture ramenée au meilleur candidat
    expect(c.map((x) => Math.round(x.srcScore * 100) / 100)).toEqual([0.55, 0.55, 1, 1, 1, 1]);
  });

  it('gare (niveau 7) : lieu ; exemple de la FAQ en Lambert 72 converti', () => {
    const gare = parseWal(fx('wal/searchall-gare-de-gembloux.json')).find((x) => x.kind === 'lieu');
    expect(gare).toMatchObject({ approx: false, variants: [{ place: 'Gare de Gembloux' }] });
    const [faq] = parseWal(fx('wal/searchall-gembloux-lambert72.json'));
    expect(faq.lat).toBeCloseTo(50.57017565302071, 7);
    expect(faq.lon).toBeCloseTo(4.691095148997802, 7);
  });

  it('variantes du même objet (même ident) relevées en direct : un seul après fusion', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' }, route: () => jsonBody(fx('wal/searchall-rue-de-fer-25.json')) });
    const r = await call<GeocodeResponse>(handleGeocode, '/api/geocode?q=rue%20de%20fer%2025', t.ctx);
    const labels = r.body.results.map((x) => x.label);
    expect(labels.filter((l) => l === 'Rue du Fer 25, 4020 Liège')).toHaveLength(1);
    expect(labels[0]).toBe('Rue de Fer 25, 5000 Namur');
  });

  it('vide et format inattendu', () => {
    expect(parseWal(fx('wal/searchall-empty.json'))).toEqual([]);
    expect(() => parseWal({ error: 'x' })).toThrow(FormatError);
  });
});

describe('Bruxelles (Paradigm, freeSearch/searchAnyObject, format reconstitué)', () => {
  it('adresse : noms français et néerlandais, code postal, Lambert 72 converti', () => {
    const [c] = parseBru(fx('bru/searchanyobject-rue-neuve-1.json'), 'fr');
    expect(c).toMatchObject({ source: 'bru', kind: 'adresse', approx: false, number: '1', postcode: '1000', region: 'bru', id: '4103' });
    expect(c.variants).toEqual([
      { lang: 'fr', street: 'Rue Neuve', municipality: 'Bruxelles', place: undefined },
      { lang: 'nl', street: 'Nieuwstraat', municipality: 'Brussel', place: undefined },
    ]);
    expect(c.lat).toBeCloseTo(50.8506084, 6);
    expect(c.lon).toBeCloseTo(4.3540228, 6);
  });

  it('structure réelle de la réponse v1 (relevée en direct le 11/11/2026) : Rue Neuve 1, 1000 Bruxelles', () => {
    const [c, d] = parseBru(fx('bru/searchanyobject-v1-rue-neuve-1-structure-reelle.json'), 'fr');
    expect(c).toMatchObject({ source: 'bru', kind: 'adresse', approx: false, number: '1', postcode: '1000', region: 'bru' });
    expect(c.variants).toEqual([
      { lang: 'fr', street: 'Rue Neuve', municipality: 'Bruxelles', place: undefined },
      { lang: 'nl', street: 'Nieuwstraat', municipality: 'Brussel', place: undefined },
    ]);
    // 148962.829 171134.478 en Lambert 72 : Rue Neuve 1, près de la place de la Monnaie
    expect(c.lat).toBeGreaterThan(50.849);
    expect(c.lat).toBeLessThan(50.853);
    expect(c.lon).toBeGreaterThan(4.352);
    expect(c.lon).toBeLessThan(4.357);
    expect(d).toMatchObject({ number: '1', postcode: '1000' });
  });

  it('rue et adresses regroupées par type d’objet', () => {
    const c = parseBru(fx('bru/searchanyobject-rue-neuve.json'), 'fr');
    expect(c.map((x) => [x.kind, x.number ?? '', x.postcode])).toEqual([['rue', '', '1000'], ['adresse', '1', '1000'], ['adresse', '10', '1000']]);
    expect(c[0].approx).toBe(true);
  });

  it('lecture tolérante : result objet, policeNumber, noms { fr, nl }, pos en tableau, srsName en URN', () => {
    const [c] = parseBru(fx('bru/searchanyobject-variante-churchill.json'), 'fr');
    expect(c).toMatchObject({ kind: 'adresse', number: '100', postcode: '1180' });
    expect(c.variants.map((v) => v.street)).toEqual(['Avenue Winston Churchill', 'Winston Churchilllaan']);
    expect(c.lat).toBeCloseTo(50.808, 5);
  });

  it('vide et format inattendu', () => {
    expect(parseBru(fx('bru/searchanyobject-empty.json'), 'fr')).toEqual([]);
    expect(() => parseBru({ message: 'Internal error' }, 'fr')).toThrow(FormatError);
  });
});

/* ------------------------------ Contrat par source, à travers le point d'entrée ------------------------------ */

const CASES: [GeoId, string, string, string, string][] = [
  ['vla', 'veldstraat 1 gent', 'vla/location-veldstraat-1-gent.json', 'vla/location-empty.json', 'service flamand'],
  ['bru', 'rue neuve 1', 'bru/searchanyobject-rue-neuve-1.json', 'bru/searchanyobject-empty.json', 'service bruxellois'],
  ['wal', 'rue de fer 25 namur', 'wal/searchall-rue-de-fer-25-namur.json', 'wal/searchall-empty.json', 'service wallon'],
];

describe.each(CASES)('contrat %s par /api/geocode', (id, q, normal, empty, name) => {
  const path = `/api/geocode?q=${encodeURIComponent(q)}`;
  const only = (route: Route, timeouts = {}) => makeCtx({ env: { GEOCODE_SOURCES: id }, route, timeouts });

  it('réponse normale : résultats, source ok avec durée et nombre, cache CDN 24 h', async () => {
    const t = only(() => jsonBody(fx(normal)));
    const r = await call<GeocodeResponse>(handleGeocode, path, t.ctx);
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBeGreaterThan(0);
    expect(r.body.sources[id]).toMatchObject({ ok: true, n: expect.any(Number), ms: expect.any(Number) });
    expect(r.body).not.toHaveProperty('partial');
    expect(r.body).not.toHaveProperty('error');
    expect(r.headers.get('cache-control')).toBe(CACHE_GEO);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url.startsWith(GEO)).toBe(true);
  });

  it('réponse vide : aucun résultat, pas d’erreur, cache court', async () => {
    const r = await call<GeocodeResponse>(handleGeocode, path, only(() => jsonBody(fx(empty))).ctx);
    expect(r.body).toMatchObject({ results: [], sources: { [id]: { ok: true, n: 0 } } });
    expect(r.body).not.toHaveProperty('error');
    expect(r.headers.get('cache-control')).toBe(CACHE_GEO_EMPTY);
  });

  const failures: [string, Route, string][] = [
    ['délai', () => never(), 'Délai dépassé (0,05 s)'],
    ['HTTP 500', () => html(500), `Réponse HTTP 500 du ${name}`],
    ['JSON illisible', () => html(200), `Réponse illisible du ${name}`],
    ['format inattendu', () => jsonBody({ unexpected: true }), `Réponse illisible du ${name}`],
    ['limite du service', () => jsonBody({}, 429), `Trop de requêtes, limite du ${name} atteinte (HTTP 429)`],
    ['réseau', () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), `${name.charAt(0).toUpperCase()}${name.slice(1)} injoignable`],
  ];
  for (const [label, route, error] of failures) {
    it(`${label} : HTTP 200, error en français, réponse partielle sans cache`, async () => {
      const r = await call<GeocodeResponse>(handleGeocode, path, only(route, { geoSource: 50, geoTotal: 80 }).ctx);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ results: [], partial: true, error: ALL_DOWN, sources: { [id]: { ok: false, error } } });
      expect(r.headers.get('cache-control')).toBe('no-store');
    });
  }
});

describe('délais de production', () => {
  it('« Délai dépassé (2 s) » avec les délais par défaut (2 s par service, 2,5 s en tout)', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' }, route: () => never(), timeouts: { geoSource: 2000, geoTotal: 2500 } });
    const t0 = performance.now();
    const r = await call<GeocodeResponse>(handleGeocode, '/api/geocode?q=rue%20de%20fer%2025%20namur', t.ctx);
    const ms = performance.now() - t0;
    expect(r.body.sources.wal).toMatchObject({ ok: false, error: 'Délai dépassé (2 s)' });
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(ms).toBeLessThan(3000);
  });
});
