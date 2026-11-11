/**
 * Adresses de bout en bout (PRD M4, M5a ; design-routing.md § 6) : vrai cœur (geocode) → vrai relais (npm run dev,
 * GET /api/geocode) → faux services des trois Régions (npm run mock-geocode, formats et chemins des vrais services),
 * puis l'adresse choisie comme extrémité de route() sur les données du pipeline.
 * Vie privée (CA-M4.8) : le journal du faux service et les requêtes du cœur ne contiennent que le texte tapé.
 * Pannes : scènes down, slow et garbage du faux service, relais en panne ou arrêté, téléphone hors ligne.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCore } from '../../app/src/core/index';
import type { Core, Endpoint, GeocodeAnswer, GeocodeResult, Journey, Settings } from '../../app/src/core/api';
import { hhmm, lineLabel } from '../../app/src/core/util';
import { migrateSettings } from '../../app/src/settings';
import { startFaultyProxy, type FaultyProxy } from './lib/faulty';
import { memoryKV, ROOT, startStack, TEST_KEY, type Stack } from './lib/stack';

/** Réglages v3 (1.2) : le préréglage 1.1 migré, comme l'appli le lit. */
const PRESET: Settings = migrateSettings(JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', 'preset-1.1.json'), 'utf8')));
const T = (hm: string, day = '2026-11-10') => Date.parse(`${day}T${hm}:00+01:00`);
const S2 = { lat: 50.86, lon: 4.359 };
const S3 = { lat: 50.8454, lon: 4.3571 };
const LIEGE = { lat: 50.6326, lon: 5.5797 };
const ATTRIBUTION = 'Adresses : Digitaal Vlaanderen, Paradigm (UrbIS, CC0), SPW (ICAR, CC BY 4.0)';
const legsOf = (j: Journey) =>
  j.legs.map((l) => (l.kind === 'walk' ? `marche ${l.walkMin}` : `${hhmm(l.dep)} ${l.cat ?? lineLabel(l.mode ?? 'bus', l.line ?? '')} ${l.from.name.fr} → ${l.to.name.fr} ${hhmm(l.arr)}`)).join(' | ');
/** Ce que l'interface fait d'un résultat choisi : une extrémité « adresse » (Endpoint de api.ts). */
const asEndpoint = (r: GeocodeResult): Endpoint => ({ type: 'address', label: r.label, lat: r.lat, lon: r.lon, ...(r.approx ? { approx: true } : {}) });

let stack: Stack;
/** Requêtes envoyées par le cœur (adresses complètes). */
const sent: string[] = [];
const recFetch: typeof fetch = (input, init) => {
  sent.push(String(input));
  return fetch(input, init);
};
const core = (now = T('13:55'), relayBase = stack.relay.url): Core => createCore({ dataBase: stack.data.url, relayBase, now: () => now, storage: memoryKV(), fetch: recFetch });
const geocode = (q: string, lang: 'fr' | 'nl' = 'fr', near: { lat: number; lon: number } | null = S3, c = core()): Promise<GeocodeAnswer> => c.geocode(q, lang, near);

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});
// scène de base, caches du relais vidés (disjoncteurs et limite de 30 recherches par minute compris)
beforeEach(async () => {
  await stack.geoScene('base');
  sent.length = 0;
});

describe('adresses : cœur → relais → services des trois Régions (scène base)', () => {
  it('CA-M4.1 : « rue de fer 25 namur » : 1re proposition « Rue de Fer 25, 5000 Namur », adresse, en moins d’1 s', async () => {
    const t0 = performance.now();
    const a = await geocode('rue de fer 25 namur');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(a.error).toBeUndefined();
    expect(a.partial).toBeUndefined();
    expect(a.results[0]).toMatchObject({ label: 'Rue de Fer 25, 5000 Namur', kind: 'adresse', source: 'wal', lat: 50.4662, lon: 4.8648 });
    expect(a.attribution).toBe(ATTRIBUTION);
    // aiguillage par la commune : seul le service wallon est interrogé
    expect((await stack.geoJournal()).map((e) => e.source)).toEqual(['wal']);
  });

  it('homonymes à score égal : le plus proche d’abord, tri fait sur le téléphone (la position ne part jamais)', async () => {
    const fromBxl = await geocode('rue de fer 25', 'fr', S3);
    expect(fromBxl.results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur', 'Rue de Fer 25, 4000 Liège']);
    expect(fromBxl.results[0].score).toBe(fromBxl.results[1].score);
    const fromLiege = await geocode('rue de fer 25', 'fr', LIEGE);
    expect(fromLiege.results.map((r) => r.label)).toEqual(['Rue de Fer 25, 4000 Liège', 'Rue de Fer 25, 5000 Namur']);
    // sans commune : les trois services en parallèle
    expect(new Set((await stack.geoJournal()).map((e) => e.source))).toEqual(new Set(['vla', 'bru', 'wal']));
  });

  it('Bruxelles : rue sans numéro (position approximative) ; libellé dans la langue des noms, noms fr et nl', async () => {
    const street = await geocode('rue neuve bruxelles');
    expect(street.results[0]).toMatchObject({ label: 'Rue Neuve, 1000 Bruxelles', kind: 'rue', approx: true, source: 'bru' });
    expect(street.results[1]).toMatchObject({ label: 'Rue Neuve 1, 1000 Bruxelles', kind: 'adresse' });
    const frRes = await geocode('nieuwstraat 1', 'fr');
    expect(frRes.results.map((r) => r.label)).toEqual(['Rue Neuve 1, 1000 Bruxelles']);
    const nlRes = await geocode('nieuwstraat 1', 'nl');
    expect(nlRes.results).toHaveLength(1); // doublon flamand et bruxellois fusionné
    expect(nlRes.results[0]).toMatchObject({ label: 'Nieuwstraat 1, 1000 Brussel', names: { fr: 'Rue Neuve 1, 1000 Bruxelles', nl: 'Nieuwstraat 1, 1000 Brussel' } });
    expect(sent.filter((u) => u.includes('/api/geocode')).map((u) => new URL(u).searchParams.get('lang'))).toEqual(['fr', 'fr', 'nl']);
  });

  it('moins de 3 caractères : rien, sans requête ; aucun résultat : liste vide sans erreur ; réponses complètes gardées 10 min', async () => {
    expect(await geocode('ru')).toEqual({ results: [] });
    expect(await geocode('  a  b ')).toEqual({ results: [] });
    expect(sent).toEqual([]);
    const none = await geocode('xyzzy plop');
    expect(none.results).toEqual([]);
    expect(none.error).toBeUndefined();
    // même cœur, même texte (à la casse et aux espaces près) : servi par le cache du cœur
    const c = core();
    await c.geocode('Veldstraat 1 Gent', 'fr', S3);
    const before = sent.length;
    const again = await c.geocode('veldstraat  1 gent', 'fr', S3);
    expect(sent.length).toBe(before);
    expect(again.results[0]?.label).toBe('Veldstraat 1, 9000 Gent');
  });

  it('CA-M4.8 : seuls le texte et la langue partent du cœur ; les services ne reçoivent que le texte tapé', async () => {
    await stack.geoJournalReset();
    const typed = ['veldstraat 1 gent', 'rue de fer 25', 'chaussée de bruxelles 1 waterloo', 'nieuwstraat 1'];
    for (const q of typed) await geocode(q, 'fr', S3);
    const calls = sent.filter((u) => u.includes('/api/geocode'));
    expect(calls).toHaveLength(typed.length);
    for (const u of calls) {
      const url = new URL(u);
      expect([...url.searchParams.keys()].sort(), u).toEqual(['lang', 'q']);
      expect(typed).toContain(url.searchParams.get('q'));
      expect(u).not.toMatch(/50[.,]84|4[.,]35/); // jamais la position du téléphone
    }
    const journal = await stack.geoJournal();
    expect(journal.length).toBeGreaterThanOrEqual(typed.length);
    const allowed: Record<string, { keys: string[]; text: string }> = {
      vla: { keys: ['c', 'q'], text: 'q' },
      bru: { keys: ['freeText', 'model', 'searchLanguage'], text: 'freeText' },
      wal: { keys: ['address', 'crs', 'geom', 'lang', 'levels'], text: 'address' },
    };
    for (const e of journal) {
      const rule = allowed[e.source ?? ''];
      expect(rule, e.path).toBeDefined();
      expect(Object.keys(e.params).sort(), e.path).toEqual(rule.keys);
      expect(typed, e.path).toContain(e.params[rule.text]);
      const all = JSON.stringify(e);
      expect(all).not.toMatch(/50[.,]84|4[.,]35/);
      expect(all.includes(TEST_KEY)).toBe(false);
      expect(e.headers['user-agent']).toBe('quai-relay/1.1');
      for (const h of ['cookie', 'authorization', 'x-forwarded-for', 'bmc-partner-key', 'ocp-apim-subscription-key']) expect(e.headers[h], h).toBeUndefined();
    }
    // le journal du relais ne montre jamais le texte cherché, seulement sa longueur
    const logs = stack.relay.out.join('');
    expect(logs).toMatch(/\/api\/geocode\?q=\(\d+ car\.\)/);
    for (const q of typed) expect(logs.includes(q), q).toBe(false);
  });
});

describe('de l’adresse au trajet : résultat choisi → route() sur les données du pipeline', () => {
  beforeAll(async () => {
    await stack.scene('noRT');
  });

  it('CA-M4.4, CA-M5.4 : S3 vers « Veldstraat 1, 9000 Gent » : IC puis tram 1, cartes en moins de 3 s', async () => {
    const c = core(T('13:55'));
    const t0 = performance.now();
    const [res] = (await c.geocode('veldstraat 1 gent', 'fr', S3)).results;
    const r = await c.route({ type: 'here' }, asEndpoint(res), T('13:55'), PRESET, S3);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(legsOf(r.journeys[0])).toBe('14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 | marche 1 | 14:44 T1 Gand-Saint-Pierre → Korenmarkt, Gand 14:54 | marche 3');
    expect(r.journeys[0].legs.at(-1)?.to.name.fr).toBe('Veldstraat 1, 9000 Gent');
  });

  it('scénario 4 (CA-1.5) : adresses tapées « chaussée de bruxelles 1 waterloo » → « rue du progrès 20 » : le S1 d’abord, puis bus W et M2', async () => {
    const c = core(T('07:31'));
    const [from] = (await c.geocode('chaussée de bruxelles 1 waterloo', 'fr', null)).results;
    const [to] = (await c.geocode('rue du progrès 20', 'fr', null)).results;
    expect([from.label, to.label]).toEqual(['Chaussée de Bruxelles 1, 1410 Waterloo', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode']);
    const r = await c.route(asEndpoint(from), asEndpoint(to), T('07:31'), PRESET, null);
    expect(r.journeys.map((j) => j.label)).toEqual(['short', 'lesswalk', 'next']);
    expect(legsOf(r.journeys[0])).toBe('marche 19 | 07:55 S1 Waterloo → Bruxelles-Nord 08:25 | marche 5');
    expect(legsOf(r.journeys[1])).toBe('marche 2 | 07:36 W Waterloo Eglise → Bruxelles Midi 08:21 | marche 2 | 08:29 M2 Gare du Midi → Rogier 08:43 | marche 3');
  });

  it('CA-M5.2 et CA-M5.3 : « boulevard du centenaire 1 » depuis S2 et depuis « avenue winston churchill 100 »', async () => {
    const c = core(T('12:10'));
    const [centenaire] = (await c.geocode('boulevard du centenaire 1', 'fr', S2)).results;
    const r = await c.route({ type: 'here' }, asEndpoint(centenaire), T('12:10'), PRESET, S2);
    expect(legsOf(r.journeys[0])).toBe('marche 6 | 12:25 M6 Rogier → Roi Baudouin 12:39 | marche 1');
    const [uccle] = (await c.geocode('avenue winston churchill 100', 'fr', S2)).results;
    const u = await core(T('08:00')).route(asEndpoint(uccle), asEndpoint(centenaire), T('08:00'), PRESET, null);
    expect(legsOf(u.journeys[0])).toBe('marche 2 | 08:09 T3 Churchill → Rogier 08:30 | 08:35 M6 Rogier → Roi Baudouin 08:49 | marche 1');
  });

  it('CA-M5.6 : « rue du bois 1 bastogne » : aucun arrêt à moins de 15 min (noStopTo, PRD-1.2 § 1.4)', async () => {
    const c = core(T('13:55'));
    const [bastogne] = (await c.geocode('rue du bois 1 bastogne', 'fr', S3)).results;
    expect(bastogne.label).toBe('Rue du Bois 1, 6600 Bastogne');
    expect(await c.route({ type: 'here' }, asEndpoint(bastogne), T('13:55'), PRESET, S3)).toEqual({ journeys: [], empty: 'noStopTo', accessMin: 15 });
  });
});

describe('adresses en panne : jamais d’exception, « down » ou « offline »', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CA-M4.6 : services en panne (503), HTML en 200, trop lents (3 s) : « down », en 4 s au plus', async () => {
    for (const scene of ['down', 'garbage', 'slow'] as const) {
      await stack.geoScene(scene);
      const t0 = performance.now();
      const a = await geocode('rue de fer 25 namur');
      const ms = performance.now() - t0;
      expect(a, scene).toEqual({ results: [], error: 'down' });
      expect(ms, `${scene} : ${Math.round(ms)} ms`).toBeLessThan(4000);
      if (scene === 'slow') expect(ms).toBeGreaterThan(1900); // délai du relais : 2 s par service
    }
  });

  it('un seul service en panne : réponse partielle des autres, jamais gardée en cache', async () => {
    await stack.geoScene('down', ['bru']);
    const c = core();
    const a = await c.geocode('rue de fer 25', 'fr', S3);
    expect(a.partial).toBe(true);
    expect(a.error).toBeUndefined();
    expect(a.results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur', 'Rue de Fer 25, 4000 Liège']);
    const n = sent.length;
    await c.geocode('rue de fer 25', 'fr', S3);
    expect(sent.length).toBe(n + 1); // réponse partielle : nouvelle requête
  });

  it('relais arrêté : « down » ; téléphone hors ligne : « offline » (« Recherche d’adresse impossible sans connexion »)', async () => {
    expect(await geocode('rue de fer 25 namur', 'fr', S3, core(T('13:55'), 'http://127.0.0.1:9'))).toEqual({ results: [], error: 'down' });
    vi.stubGlobal('navigator', { onLine: false });
    expect(await geocode('rue de fer 25 namur', 'fr', S3, core(T('13:55'), 'http://127.0.0.1:9'))).toEqual({ results: [], error: 'offline' });
  });

  it('relais en panne devant le cœur : 500, JSON invalide, forme inattendue, délai : « down » sans exception', async () => {
    const proxy: FaultyProxy = await startFaultyProxy(stack.relay.url);
    try {
      const faults = [
        { status: 500, body: '{"error":"Erreur interne"}' },
        { status: 200, body: 'pas du json', headers: { 'Content-Type': 'application/json' } },
        { status: 200, body: '{"results":"oups"}', headers: { 'Content-Type': 'application/json' } },
        { status: 429, body: '{"error":"Trop de recherches d’adresses : réessaie dans une minute."}', headers: { 'Retry-After': '60' } },
        { delayMs: 6_000 },
      ] as const;
      for (const f of faults) {
        proxy.rules = [{ match: /^\/api\/geocode$/, fault: () => f }];
        const t0 = performance.now();
        const a = await geocode('rue de fer 25 namur', 'fr', S3, core(T('13:55'), proxy.url));
        expect(a, JSON.stringify(f)).toEqual({ results: [], error: 'down' });
        expect(performance.now() - t0).toBeLessThan(5000); // délai du cœur : 4 s
      }
      // des résultats illisibles sont écartés un à un, les autres restent
      proxy.rules = [{ match: /^\/api\/geocode$/, fault: () => ({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'x', fetchedAt: 'x', sources: {}, attribution: ATTRIBUTION, results: [null, { label: 'Sans position' }, { label: 'Rue de Fer 25, 5000 Namur', lat: 50.4662, lon: 4.8648, kind: 'adresse', source: 'wal', score: 1 }] }) }) }];
      const ok = await geocode('rue de fer 25 namur', 'fr', S3, core(T('13:55'), proxy.url));
      expect(ok.results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur']);
    } finally {
      await proxy.close();
    }
  }, 60_000);

  it('health() : version du relais et état des trois services d’adresses (« sauf en Wallonie » quand un seul est en panne)', async () => {
    const h = await core().health();
    expect(h.version).toBe('1.1.0');
    expect(Object.keys(h.geocode ?? {}).sort()).toEqual(['bru', 'vla', 'wal']);
    expect([h.geocode?.vla?.ok, h.geocode?.bru?.ok, h.geocode?.wal?.ok]).toEqual([true, true, true]);
    await stack.geoScene('down', ['wal']);
    const d = await core().health();
    expect([d.geocode?.vla?.ok, d.geocode?.bru?.ok, d.geocode?.wal?.ok]).toEqual([true, true, false]);
    expect(d.geocode?.wal?.error).toMatch(/[a-zé]/);
  });
});
