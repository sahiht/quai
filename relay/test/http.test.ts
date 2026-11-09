import { describe, expect, it } from 'vitest';
import * as apiRt from '../api/rt.js';
import * as apiStib from '../api/stib.js';
import * as apiAlerts from '../api/alerts.js';
import * as apiHealth from '../api/health.js';
import { handleAlerts, handleHealth, handleRt, handleStib } from '../lib/handlers.js';
import { CACHE_OK } from '../lib/http.js';
import type { RtResponse } from '../lib/shared/types.js';
import { bmcRoute, call, jsonBody, makeCtx, never, protobuf, type Route } from './helpers.js';

const S1 = '88____:046::8812005:8883006:4:1315:20261231';

function expectCors(h: Headers) {
  expect(h.get('access-control-allow-origin')).toBe('*');
  expect(h.get('access-control-allow-methods')).toBe('GET, OPTIONS');
}

describe('points d’entrée Vercel (api/*.ts)', () => {
  it('chaque fichier exporte GET et OPTIONS (signature Web Request → Response)', () => {
    for (const mod of [apiRt, apiStib, apiAlerts, apiHealth]) {
      expect(typeof mod.GET).toBe('function');
      expect(typeof mod.OPTIONS).toBe('function');
      expect(Object.keys(mod).sort()).toEqual(['GET', 'OPTIONS']);
    }
  });

  it('OPTIONS : 204, CORS ouvert, pré-vérification mise en cache', async () => {
    for (const mod of [apiRt, apiStib, apiAlerts, apiHealth]) {
      const res = await mod.OPTIONS();
      expect(res.status).toBe(204);
      expectCors(res.headers);
      expect(res.headers.get('access-control-max-age')).toBe('86400');
      expect(await res.text()).toBe('');
    }
  });

  it('GET sur une requête invalide passe par le contexte par défaut sans appel réseau (400)', async () => {
    const res = await apiRt.GET(new Request('https://relay.test/api/rt?op=bus&trips=1'));
    expect(res.status).toBe(400);
    expectCors(res.headers);
  });
});

describe('en-têtes communs', () => {
  it('CORS sur toutes les réponses ; cache CDN sur les succès, no-store sur les erreurs et les 400', async () => {
    const ok = makeCtx();
    const bad = makeCtx({ route: () => jsonBody({}, 503) });
    const cases: [string, Awaited<ReturnType<typeof call>>, string][] = [
      ['rt ok', await call(handleRt, `/api/rt?op=sncb&trips=${S1}`, ok.ctx), CACHE_OK],
      ['stib ok', await call(handleStib, '/api/stib?points=6357', ok.ctx), CACHE_OK],
      ['alerts ok', await call(handleAlerts, '/api/alerts?op=sncb', ok.ctx), CACHE_OK],
      ['health ok', await call(handleHealth, '/api/health', ok.ctx), CACHE_OK],
      ['rt erreur', await call(handleRt, `/api/rt?op=sncb&trips=${S1}`, bad.ctx), 'no-store'],
      ['health erreur', await call(handleHealth, '/api/health', bad.ctx), 'no-store'],
      ['400', await call(handleRt, '/api/rt?op=sncb', ok.ctx), 'no-store'],
    ];
    for (const [name, r, cache] of cases) {
      expectCors(r.headers);
      expect(r.headers.get('cache-control'), name).toBe(cache);
      expect(r.headers.get('content-type'), name).toBe('application/json; charset=utf-8');
    }
  });
});

describe('paramètres invalides : 400 avec message en français', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => `t${i}`);
  const cases: [string, RegExp][] = [
    ['/api/rt', /^Paramètre op manquant/],
    ['/api/rt?op=bus&trips=1', /^Paramètre op invalide/],
    ['/api/rt?op=stib&trips=1', /STIB n’a pas de flux GTFS-RT/],
    ['/api/rt?op=sncb', /^Paramètre trips manquant/],
    ['/api/rt?op=sncb&trips=,,', /^Paramètre trips manquant/],
    [`/api/rt?op=sncb&trips=${[...sixty, 't60'].join(',')}`, /^Trop de voyages : 60 au maximum/],
    ['/api/rt?op=sncb&trips=a%00b', /^Paramètre trips invalide/],
    [`/api/rt?op=sncb&trips=${'x'.repeat(257)}`, /^Paramètre trips invalide/],
  ];
  for (const [path, msg] of cases) {
    it(path.slice(0, 60), async () => {
      const t = makeCtx();
      const r = await call(handleRt, path, t.ctx);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(msg);
      expect(t.calls).toHaveLength(0);
    });
  }

  it('60 voyages (doublons comptés une fois) sont acceptés ; op en majuscules accepté', async () => {
    const r = await call(handleRt, `/api/rt?op=SNCB&trips=${[...sixty, 't0', 't1'].join(',')}`, makeCtx().ctx);
    expect(r.status).toBe(200);
    const multi = await call<RtResponse>(handleRt, `/api/rt?op=sncb&trips=t1&trips=${S1}`, makeCtx().ctx);
    expect(Object.keys(multi.body.trips)).toEqual([S1]);
  });
});

describe('source en erreur : HTTP 200, error en français, données vides', () => {
  const cases: [string, Route, string][] = [
    ['HTTP 503', () => jsonBody({ statusCode: 503 }, 503), 'Temps réel SNCB indisponible : réponse HTTP 503 du portail'],
    ['clé refusée', () => jsonBody({ statusCode: 401 }, 401), 'Temps réel SNCB indisponible : clé refusée par le portail (HTTP 401)'],
    ['limite', () => jsonBody({ statusCode: 429 }, 429), 'Temps réel SNCB indisponible : trop de requêtes, limite du portail atteinte (HTTP 429)'],
    ['réseau', () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })), 'Temps réel SNCB indisponible : portail injoignable'],
    // forme réelle de l'erreur de Node (undici) quand redirect: 'error' refuse un 302 du portail
    ['redirection refusée', () => Promise.reject(new TypeError('fetch failed', { cause: new Error('unexpected redirect') })), 'Temps réel SNCB indisponible : redirection refusée du portail'],
    ['délai', () => never(), 'Temps réel SNCB indisponible : délai dépassé (0,05 s)'],
    ['protobuf invalide', () => protobuf(new TextEncoder().encode('<html>erreur</html>')), 'Temps réel SNCB indisponible : flux illisible (protobuf invalide)'],
    ['corps vide', () => protobuf(new Uint8Array()), 'Temps réel SNCB indisponible : flux illisible (protobuf invalide)'],
  ];
  for (const [name, route, error] of cases) {
    it(name, async () => {
      const t = makeCtx({ route, timeouts: { upstream: 50 } });
      const r = await call<RtResponse>(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ op: 'sncb', trips: {}, error });
      expect(typeof r.body.fetchedAt).toBe('string');
      expect(r.body).not.toHaveProperty('feedTimestamp');
      expect(t.logs.some((l) => l.startsWith('[relais] '))).toBe(true);
    });
  }

  it('délai réel de 8 s par défaut (configuration de production)', async () => {
    const { defaultCtx } = await import('../lib/context.js');
    expect(defaultCtx().timeouts).toEqual({ upstream: 8000, health: 3000 });
  });

  it('une erreur n’est pas mise en cache : la requête suivante réessaie', async () => {
    let fail = true;
    const bmc = bmcRoute();
    const t = makeCtx({ route: (u, c) => (fail ? jsonBody({}, 503) : bmc(u, c)) });
    expect((await call<RtResponse>(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx)).body.error).toBeDefined();
    fail = false;
    const r = await call<RtResponse>(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx);
    expect(r.body.error).toBeUndefined();
    expect(r.body.trips[S1]).toEqual({ cancelled: true, u: [] });
    expect(t.calls).toHaveLength(2);
  });
});

describe('clé BMC absente', () => {
  it('200 avec error en français, aucune requête vers le portail, une ligne de journal claire (non répétée)', async () => {
    const t = makeCtx({ env: { BMC_KEY: '  ' } });
    const rt = await call<RtResponse>(handleRt, '/api/rt?op=delijn&trips=702321245', t.ctx);
    const stib = await call(handleStib, '/api/stib?points=6357', t.ctx);
    const alerts = await call(handleAlerts, '/api/alerts?op=tec', t.ctx);
    expect(rt.status).toBe(200);
    expect(rt.body).toMatchObject({ op: 'delijn', trips: {}, error: 'Temps réel De Lijn indisponible : clé BMC_KEY absente sur le relais' });
    expect(stib.body).toMatchObject({ points: {}, error: 'Temps réel STIB indisponible : clé BMC_KEY absente sur le relais' });
    expect(alerts.body).toMatchObject({ alerts: [], error: 'Alertes TEC indisponibles : clé BMC_KEY absente sur le relais' });
    expect(t.calls).toHaveLength(0);
    const lines = t.logs.filter((l) => l.includes('BMC_KEY manquante'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/Settings > Environment Variables/);
    t.advance(11 * 60_000);
    await call(handleRt, '/api/rt?op=tec&trips=x', t.ctx);
    expect(t.logs.filter((l) => l.includes('BMC_KEY manquante'))).toHaveLength(2);
  });
});
