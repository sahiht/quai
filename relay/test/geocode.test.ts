/**
 * GET /api/geocode sur le faux service d'adresses en mémoire (mêmes réponses que npm run mock-geocode) :
 * paramètres, aiguillage, tableau du PRD (annexe A.2), fusion et classement, cache, disjoncteur, limites, repli
 * bruxellois, vie privée du journal, Google jamais appelé, état des services dans /api/health.
 */
import { describe, expect, it } from 'vitest';
import * as apiGeocode from '../api/geocode.js';
import { handleHealth } from '../lib/handlers.js';
import { ALL_DOWN, TOO_MANY, handleGeocode } from '../lib/geocode/service.js';
import { CACHE_GEO, CACHE_GEO_EMPTY } from '../lib/http.js';
import type { GeocodeResponse, HealthResponse } from '../lib/shared/types.js';
import { createMockGeoState, type MockGeoState } from '../../fixtures/relay/mock-geocode.js';
import { GEO, call, jsonBody, makeCtx, stackRoute, type Route, type TestCtx } from './helpers.js';

const geocode = (t: TestCtx, q: string, lang?: string, headers?: Record<string, string>) =>
  call<GeocodeResponse>(handleGeocode, `/api/geocode?q=${encodeURIComponent(q)}${lang ? `&lang=${lang}` : ''}`, t.ctx, undefined, headers);
const geoCalls = (t: TestCtx) => t.calls.filter((c) => c.url.startsWith(GEO));
const sourceOf = (url: string) => (url.includes('/geolocation/') ? 'vla' : url.includes('/geocoding/') ? 'bru' : 'wal');
const fake = () => {
  const geo = createMockGeoState();
  return { geo, t: makeCtx({ route: stackRoute({ geo }) }) };
};
const scene = (geo: MockGeoState, s: MockGeoState['scene'], only: string[] = []) => {
  geo.scene = s;
  geo.only = new Set(only as ('vla' | 'bru' | 'wal')[]);
};

describe('point d’entrée Vercel api/geocode.ts', () => {
  it('exporte GET et OPTIONS ; OPTIONS 204 avec CORS ouvert ; 400 sans appel réseau', async () => {
    expect(Object.keys(apiGeocode).sort()).toEqual(['GET', 'OPTIONS']);
    const pre = apiGeocode.OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    const bad = await apiGeocode.GET(new Request('https://relay.test/api/geocode?q=ab'));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('paramètres invalides : 400 avec message en français, aucun appel', () => {
  const cases: [string, string][] = [
    ['/api/geocode', 'Paramètre q manquant ou trop court : 3 caractères au moins.'],
    ['/api/geocode?q=%20%20ab%20%20', 'Paramètre q manquant ou trop court : 3 caractères au moins.'],
    [`/api/geocode?q=${'x'.repeat(101)}`, 'Paramètre q trop long : 100 caractères au plus.'],
    ['/api/geocode?q=rue%0Ade%20fer', 'Paramètre q invalide : caractère de contrôle interdit.'],
    ['/api/geocode?q=rue%20de%20fer&lang=de', 'Paramètre lang invalide : fr ou nl.'],
  ];
  for (const [path, error] of cases) {
    it(path.slice(0, 50), async () => {
      const t = makeCtx();
      const r = await call(handleGeocode, path, t.ctx);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error });
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('access-control-allow-origin')).toBe('*');
      expect(t.calls).toHaveLength(0);
    });
  }
});

describe('faux service, scène base (PRD annexe A.2)', () => {
  const table: [string, string, number, number, string][] = [
    ['rue de fer 25 namur', 'Rue de Fer 25, 5000 Namur', 50.4662, 4.8648, 'wal'],
    ['rue de fer 25', 'Rue de Fer 25, 5000 Namur', 50.4662, 4.8648, 'wal'],
    ['rue neuve 1 bruxelles', 'Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545, 'bru'],
    ['nieuwstraat 1', 'Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545, 'bru'],
    ['rue neuve bruxelles', 'Rue Neuve, 1000 Bruxelles', 50.852, 4.3555, 'bru'],
    ['avenue winston churchill 100', 'Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365, 'bru'],
    ['boulevard du centenaire 1', 'Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334, 'bru'],
    ['veldstraat 1 gent', 'Veldstraat 1, 9000 Gent', 51.0537, 3.7225, 'vla'],
    ['chaussée de bruxelles 1 waterloo', 'Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399, 'wal'],
    ['rue du bois 1 bastogne', 'Rue du Bois 1, 6600 Bastogne', 50.003, 5.715, 'wal'],
    ['rue du progrès 20', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36, 'bru'],
  ];
  for (const [q, label, lat, lon, source] of table) {
    it(`« ${q} » → ${label}`, async () => {
      const { t } = fake();
      const r = await geocode(t, q);
      expect(r.status).toBe(200);
      expect(r.body.results[0]).toMatchObject({ label, lat, lon, source });
      expect(r.body.q).toBe(q);
      expect(r.body.error).toBeUndefined();
      expect(r.body.attribution).toBe('Adresses : Digitaal Vlaanderen, Paradigm (UrbIS, CC0), SPW (ICAR, CC BY 4.0)');
    });
  }

  it('CA-M4.1 : « rue de fer 25 namur » : une adresse exacte, parties, 5 décimales, cache CDN', async () => {
    const { t } = fake();
    const r = await geocode(t, 'rue de fer 25 namur');
    expect(r.body.results).toEqual([{
      label: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648, kind: 'adresse', source: 'wal', score: 1,
      parts: { street: 'Rue de Fer', number: '25', postcode: '5000', municipality: 'Namur' },
    }]);
    expect(r.headers.get('cache-control')).toBe(CACHE_GEO);
  });

  it('homonymes « rue de fer 25 » : même score (le téléphone départage par la proximité)', async () => {
    const { t } = fake();
    const r = await geocode(t, 'rue de fer 25');
    expect(r.body.results.map((x) => [x.label, x.score])).toEqual([['Rue de Fer 25, 5000 Namur', 0.93], ['Rue de Fer 25, 4000 Liège', 0.93]]);
  });

  it('rue sans numéro : la rue d’abord, approximative, avant les adresses de la rue', async () => {
    const { t } = fake();
    const r = await geocode(t, 'rue neuve bruxelles');
    expect(r.body.results.map((x) => [x.label, x.kind, x.approx ?? false])).toEqual([
      ['Rue Neuve, 1000 Bruxelles', 'rue', true],
      ['Rue Neuve 1, 1000 Bruxelles', 'adresse', false],
    ]);
    expect(r.body.results[0].names).toEqual({ fr: 'Rue Neuve, 1000 Bruxelles', nl: 'Nieuwstraat, 1000 Brussel' });
    expect(r.body.results[0].parts).toEqual({ street: 'Rue Neuve', postcode: '1000', municipality: 'Bruxelles' });
  });

  it('Bruxelles en néerlandais (lang=nl) : libellé néerlandais, les deux langues dans names', async () => {
    const { t } = fake();
    const r = await geocode(t, 'nieuwstraat 1', 'nl');
    expect(r.body.results).toHaveLength(1);
    expect(r.body.results[0]).toMatchObject({
      label: 'Nieuwstraat 1, 1000 Brussel', source: 'bru',
      names: { fr: 'Rue Neuve 1, 1000 Bruxelles', nl: 'Nieuwstraat 1, 1000 Brussel' },
    });
  });

  it('doublon entre services (Bruxelles trouvé aussi par le service flamand) : un seul résultat, celui de Bruxelles', async () => {
    const { t } = fake();
    const r = await geocode(t, 'nieuwstraat 1');
    expect(Object.keys(r.body.sources)).toEqual(['vla', 'bru', 'wal']);
    expect(r.body.sources.vla).toMatchObject({ ok: true, n: 1 });
    expect(r.body.sources.bru).toMatchObject({ ok: true, n: 1 });
    expect(r.body.results.map((x) => x.source)).toEqual(['bru']);
  });

  it('rien trouvé : réponse complète vide, cache court', async () => {
    const { t } = fake();
    const r = await geocode(t, 'gand');
    expect(r.body).toMatchObject({ results: [], sources: { vla: { ok: true, n: 0 } } });
    expect(r.headers.get('cache-control')).toBe(CACHE_GEO_EMPTY);
  });
});

describe('aiguillage : seuls les services utiles sont appelés, avec le seul texte tapé', () => {
  const cases: [string, string[]][] = [
    ['rue de fer 25 namur', ['wal']],
    ['veldstraat 1 gent', ['vla']],
    ['rue neuve 1 bruxelles', ['bru']],
    ['rue de la loi 16 1000 bruxelles', ['bru']],
    ['kerkstraat 1 9000', ['vla', 'bru', 'wal']],
    ['rue de fer 25', ['vla', 'bru', 'wal']],
    ['steenweg op brussel 1234 halle', ['vla', 'bru']],
  ];
  for (const [q, sources] of cases) {
    it(`« ${q} » → ${sources.join(', ')}`, async () => {
      const { t } = fake();
      await geocode(t, q);
      expect(geoCalls(t).map((c) => sourceOf(c.url)).sort()).toEqual([...sources].sort());
    });
  }

  it('CA-M4.8 : chaque requête ne contient que le texte tapé et la langue (paramètres fixes), User-Agent générique', async () => {
    const { geo, t } = fake();
    await geocode(t, 'rue de fer 25', 'nl', { 'x-forwarded-for': '203.0.113.7', cookie: 'id=42' });
    expect(geo.journal).toHaveLength(3);
    const params = Object.fromEntries(geo.journal.map((j) => [j.source, j.params]));
    expect(params).toEqual({
      vla: { q: 'rue de fer 25', c: '5' },
      bru: { searchLanguage: 'nl', freeText: 'rue de fer 25', model: 'BeStPlus' },
      wal: { address: 'rue de fer 25', crs: 'EPSG:4326', geom: 'true', lang: 'nl', levels: '1,2,3,4,7' },
    });
    for (const j of geo.journal) expect(j.headers).toEqual({ accept: 'application/json', 'user-agent': 'quai-relay/1.1' });
  });

  it('Bruxelles désactivé (GEOCODE_SOURCES=vla,wal) : Bruxelles par le service flamand', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'vla,wal' } });
    const r = await geocode(t, 'nieuwstraat 1 brussel');
    expect(geoCalls(t).map((c) => sourceOf(c.url))).toEqual(['vla']);
    expect(r.body.results[0]).toMatchObject({ label: 'Nieuwstraat 1, 1000 Brussel', source: 'vla' });
    expect(r.body.attribution).toBe('Adresses : Digitaal Vlaanderen, SPW (ICAR, CC BY 4.0)');
  });
});

describe('réponses partielles, erreurs, repli', () => {
  it('scène down : toutes les sources en erreur, error en français, no-store', async () => {
    const { geo, t } = fake();
    scene(geo, 'down');
    const r = await geocode(t, 'rue de fer 25');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ results: [], partial: true, error: ALL_DOWN });
    expect(r.body.sources).toEqual({
      vla: { ok: false, ms: expect.any(Number), error: 'Réponse HTTP 503 du service flamand' },
      bru: { ok: false, ms: expect.any(Number), error: 'Réponse HTTP 503 du service bruxellois' },
      wal: { ok: false, ms: expect.any(Number), error: 'Réponse HTTP 503 du service wallon' },
    });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('une source en panne : résultats des autres, partial, pas de cache', async () => {
    const { geo, t } = fake();
    scene(geo, 'garbage', ['wal']);
    const r = await geocode(t, 'nieuwstraat 1');
    expect(r.body.results[0]).toMatchObject({ label: 'Rue Neuve 1, 1000 Bruxelles' });
    expect(r.body.partial).toBe(true);
    expect(r.body.error).toBeUndefined();
    expect(r.body.sources.wal).toMatchObject({ ok: false, error: 'Réponse illisible du service wallon' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    // pas mis en cache : la requête suivante réinterroge
    scene(geo, 'base');
    const again = await geocode(t, 'nieuwstraat 1');
    expect(again.body.partial).toBeUndefined();
    expect(geoCalls(t)).toHaveLength(6);
  });

  it('source lente : délai dépassé pour elle seule, les autres répondent', async () => {
    const geo = createMockGeoState();
    scene(geo, 'slow', ['vla']);
    const t = makeCtx({ route: stackRoute({ geo }), timeouts: { geoSource: 60, geoTotal: 100 } });
    const r = await geocode(t, 'nieuwstraat 1');
    expect(r.body.sources.vla).toMatchObject({ ok: false, error: 'Délai dépassé (0,06 s)' });
    expect(r.body.results[0]).toMatchObject({ source: 'bru' });
    expect(r.body.partial).toBe(true);
  });

  it('Bruxelles en panne : repli sur le service flamand (noms néerlandais), réponse partielle', async () => {
    const { geo, t } = fake();
    scene(geo, 'down', ['bru']);
    const r = await geocode(t, 'nieuwstraat 1 brussel');
    expect(geoCalls(t).map((c) => sourceOf(c.url))).toEqual(['bru', 'vla']);
    expect(r.body.sources.bru).toMatchObject({ ok: false, error: 'Réponse HTTP 503 du service bruxellois' });
    expect(r.body.sources.vla).toMatchObject({ ok: true, n: 1 });
    expect(r.body.results[0]).toMatchObject({ label: 'Nieuwstraat 1, 1000 Brussel', source: 'vla' });
    expect(r.body.partial).toBe(true);
    expect(r.body.error).toBeUndefined();
  });

  it('8 résultats au plus', async () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      score: 0.05, geotag: { ident: String(i), level: 4, name: `Rue de la Gare ${i + 1} 5030 Gembloux`, lang: 'fr', geometry: { type: 'Point', coordinates: [4.72 + i / 1000, 50.55] } },
    }));
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' }, route: () => jsonBody({ geotag: { crs: 'EPSG:4326' }, candidates }) });
    const r = await geocode(t, 'rue de la gare gembloux');
    expect(r.body.results).toHaveLength(8);
  });
});

describe('cache de l’instance', () => {
  it('même texte (casse comprise) et même langue : une seule requête ; autre langue : nouvelle requête', async () => {
    const { t } = fake();
    const a = await geocode(t, 'rue de fer 25 namur');
    const b = await geocode(t, 'Rue de Fer 25 NAMUR');
    expect(geoCalls(t)).toHaveLength(1);
    expect(b.body.results).toEqual(a.body.results);
    expect(b.body.q).toBe('Rue de Fer 25 NAMUR');
    expect(b.body.fetchedAt).toBe(a.body.fetchedAt);
    expect(b.headers.get('cache-control')).toBe(CACHE_GEO);
    await geocode(t, 'rue de fer 25 namur', 'nl');
    expect(geoCalls(t)).toHaveLength(2);
  });

  it('requêtes simultanées identiques : une seule requête vers les services', async () => {
    const { t } = fake();
    await Promise.all([1, 2, 3].map(() => geocode(t, 'rue de fer 25')));
    expect(geoCalls(t)).toHaveLength(3);
  });

  it('24 h avec résultats, 10 min sans résultat', async () => {
    const { t } = fake();
    await geocode(t, 'rue de fer 25 namur');
    await geocode(t, 'gand');
    expect(geoCalls(t)).toHaveLength(2);
    t.advance(11 * 60_000);
    await geocode(t, 'rue de fer 25 namur');
    await geocode(t, 'gand');
    expect(geoCalls(t)).toHaveLength(3);
    t.advance(24 * 3_600_000);
    await geocode(t, 'rue de fer 25 namur');
    expect(geoCalls(t)).toHaveLength(4);
  });

  it('500 entrées au plus (la plus ancienne sort)', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' } });
    for (let i = 0; i < 501; i++) await geocode(t, `rue ${i} namur`);
    expect(t.ctx.caches.geo.cache.size).toBe(500);
    const before = geoCalls(t).length;
    await geocode(t, 'rue 500 namur');
    expect(geoCalls(t)).toHaveLength(before);
    await geocode(t, 'rue 0 namur');
    expect(geoCalls(t)).toHaveLength(before + 1);
  });
});

describe('disjoncteur et requêtes en cours', () => {
  it('3 échecs de suite : service écarté 60 s sans requête, puis réessayé', async () => {
    const { geo, t } = fake();
    scene(geo, 'down', ['wal']);
    for (let i = 0; i < 3; i++) await geocode(t, `rue du bois ${i} bastogne`);
    expect(geoCalls(t)).toHaveLength(3);
    const skipped = await geocode(t, 'rue du bois 9 bastogne');
    expect(geoCalls(t)).toHaveLength(3);
    expect(skipped.body).toMatchObject({ results: [], partial: true, error: ALL_DOWN, sources: { wal: { ok: false, error: 'Service des adresses de Wallonie indisponible' } } });
    expect(skipped.body.sources.wal).not.toHaveProperty('ms');
    expect(t.logs.filter((l) => l.includes('service wallon écarté 60 s'))).toHaveLength(1);
    scene(geo, 'base');
    t.advance(61_000);
    const back = await geocode(t, 'rue du bois 1 bastogne');
    expect(back.body.results[0]).toMatchObject({ label: 'Rue du Bois 1, 6600 Bastogne' });
    expect(t.ctx.caches.geo.breaker.wal).toEqual({ fails: 0, openUntil: 0 });
  });

  it('Bruxelles écarté : le service flamand répond tout de suite à sa place', async () => {
    const { geo, t } = fake();
    scene(geo, 'down', ['bru']);
    for (let i = 0; i < 3; i++) await geocode(t, `rue ${i} bruxelles`);
    t.calls.length = 0;
    const r = await geocode(t, 'nieuwstraat 1 brussel');
    expect(geoCalls(t).map((c) => sourceOf(c.url))).toEqual(['vla']);
    expect(r.body.sources.bru).toEqual({ ok: false, error: 'Service des adresses de Bruxelles indisponible' });
    expect(r.body.results[0]).toMatchObject({ source: 'vla' });
  });

  it('4 requêtes en cours au plus par service ; les suivantes attendent une place libre', async () => {
    let active = 0;
    let peak = 0;
    const route: Route = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return jsonBody({ geotag: {}, candidates: [] });
    };
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' }, route });
    const all = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => geocode(t, `rue ${i} namur`)));
    expect(t.calls).toHaveLength(6);
    expect(peak).toBe(4);
    expect(all.every((r) => r.body.sources.wal?.ok)).toBe(true);
  });

  it('aucune place libre avant le délai : « Trop de recherches en cours », sans requête ni effet sur le disjoncteur', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' }, timeouts: { geoSource: 40, geoTotal: 60 } });
    t.ctx.caches.geo.busy.wal.active = 4;
    const r = await geocode(t, 'rue 1 namur');
    expect(r.body.sources.wal).toMatchObject({ ok: false, error: 'Trop de recherches en cours vers le service wallon' });
    expect(t.calls).toHaveLength(0);
    expect(t.ctx.caches.geo.breaker.wal.fails).toBe(0);
    expect(t.ctx.caches.geo.busy.wal).toEqual({ active: 4, queue: [] });
  });
});

describe('limite par client', () => {
  it('30 recherches par minute et par adresse IP : 429 ensuite, autre adresse servie, à nouveau servie après 1 min', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' } });
    const ip = { 'x-forwarded-for': '198.51.100.23, 10.0.0.1' };
    for (let i = 0; i < 30; i++) expect((await geocode(t, `rue ${i} namur`, undefined, ip)).status).toBe(200);
    const limited = await geocode(t, 'rue 99 namur', undefined, ip);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ results: [], error: TOO_MANY });
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(limited.headers.get('cache-control')).toBe('no-store');
    expect((await geocode(t, 'rue 99 namur', undefined, { 'x-real-ip': '198.51.100.24' })).status).toBe(200);
    t.advance(61_000);
    expect((await geocode(t, 'rue 98 namur', undefined, ip)).status).toBe(200);
    // empreintes salées seulement, jamais l'adresse en clair
    expect([...t.ctx.caches.geo.rate.keys()].join(' ')).not.toContain('198.51.100');
  });
});

describe('vie privée du journal', () => {
  it('ni le texte cherché ni l’adresse IP : longueur, langue, aiguillage, sources, durées, statut', async () => {
    const { geo, t } = fake();
    const ip = { 'x-forwarded-for': '192.0.2.77' };
    const texts = ['zebrastraat 77 gent', 'avenue winston churchill 100', 'chaussée de bruxelles 1 waterloo'];
    for (const q of texts) await geocode(t, q, 'fr', ip);
    scene(geo, 'down');
    for (const q of texts) await geocode(t, `${q} bis`, 'nl', ip);
    scene(geo, 'garbage');
    await geocode(t, 'quatrebras 12 tervuren', 'fr', ip);
    for (let i = 0; i < 31; i++) await geocode(t, `kwartel ${i} gent`, 'fr', ip);
    expect(t.logs.length).toBeGreaterThan(10);
    const words = ['zebrastraat', 'winston', 'churchill', 'chaussée', 'chaussee', 'waterloo', 'quatrebras', 'tervuren', 'kwartel'];
    for (const line of t.logs) {
      for (const w of words) expect(line.toLowerCase()).not.toContain(w);
      expect(line).not.toContain('192.0.2.77');
      expect(line).not.toContain(GEO);
    }
    expect(t.logs.some((l) => /adresses : 19 car\., fr, aiguillage commune → vla/.test(l))).toBe(true);
    expect(t.logs.some((l) => l.includes('(429)'))).toBe(true);
  });
});

describe('Google désactivé', () => {
  it('GOOGLE_GEOCODING_KEY définie et google dans GEOCODE_SOURCES : jamais appelé, clé jamais écrite', async () => {
    const key = 'AIzaFAUSSE-cle-google-0123456789';
    const t = makeCtx({ env: { GOOGLE_GEOCODING_KEY: key, GEOCODE_SOURCES: 'vla,bru,wal,google' } });
    const r = await geocode(t, 'gand');
    await geocode(t, 'rue de fer 25');
    expect(t.calls.every((c) => c.url.startsWith(GEO))).toBe(true);
    expect(t.calls.some((c) => /google/i.test(c.url) || JSON.stringify(c.headers).includes(key))).toBe(false);
    expect(Object.keys(r.body.sources)).not.toContain('google');
    expect(t.logs.filter((l) => l.includes('Google n’est pas branché'))).toHaveLength(1);
    expect(t.logs.join('\n')).not.toContain(key);
  });
});

describe('/api/health : état des services d’adresses', () => {
  const health = (t: TestCtx) => call<HealthResponse>(handleHealth, '/api/health', t.ctx);

  it('requête de test « Namur » au plus toutes les 10 min ; `ok` global inchangé', async () => {
    const { geo, t } = fake();
    const r = await health(t);
    expect(r.body.ok).toBe(true);
    expect(r.body.version).toBe('1.1.0');
    expect(r.body.geocode).toEqual({ vla: { ok: true, ms: expect.any(Number) }, bru: { ok: true, ms: expect.any(Number) }, wal: { ok: true, ms: expect.any(Number) } });
    expect(geo.journal.map((j) => Object.values(j.params)[0] === 'Namur' || j.params.freeText === 'Namur')).toEqual([true, true, true]);
    await health(t);
    expect(geoCalls(t)).toHaveLength(3);
    t.advance(10 * 60_000 + 1);
    scene(geo, 'down', ['wal']);
    const later = await health(t);
    expect(geoCalls(t)).toHaveLength(6);
    expect(later.body.geocode?.wal).toEqual({ ok: false, error: 'Réponse HTTP 503 du service wallon' });
    expect(later.body.ok).toBe(true);
  });

  it('une vraie recherche récente vaut sonde : pas de requête de test pour ce service', async () => {
    const { t } = fake();
    await geocode(t, 'rue de fer 25 namur');
    t.calls.length = 0;
    const r = await health(t);
    expect(geoCalls(t).map((c) => sourceOf(c.url)).sort()).toEqual(['bru', 'vla']);
    expect(r.body.geocode?.wal).toMatchObject({ ok: true });
  });

  it('la sonde passe outre le disjoncteur et le referme si le service répond', async () => {
    const { geo, t } = fake();
    scene(geo, 'down', ['wal']);
    for (let i = 0; i < 3; i++) await geocode(t, `rue ${i} namur`);
    expect(t.ctx.caches.geo.breaker.wal.fails).toBe(3);
    scene(geo, 'base');
    t.advance(10 * 60_000 + 1);
    const r = await health(t);
    expect(r.body.geocode?.wal).toMatchObject({ ok: true });
    expect(t.ctx.caches.geo.breaker.wal).toEqual({ fails: 0, openUntil: 0 });
  });

  it('GEOCODE_SOURCES : seulement les services activés', async () => {
    const t = makeCtx({ env: { GEOCODE_SOURCES: 'wal' } });
    const r = await health(t);
    expect(Object.keys(r.body.geocode ?? {})).toEqual(['wal']);
  });
});
