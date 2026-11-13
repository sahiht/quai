/**
 * La clé BMC (et le jeton éventuel de SNCB_RT_URL) ne doit jamais apparaître dans une réponse ni dans un journal,
 * quel que soit le scénario : succès, erreurs de source, erreurs qui citent la clé ou l'adresse, paramètres invalides.
 */
import { describe, expect, it } from 'vitest';
import { handleAlerts, handleHealth, handleRt, handleStib, handleWeather } from '../lib/handlers.js';
import { handleGeocode } from '../lib/geocode/service.js';
import { scrub, secretsFrom } from '../lib/log.js';
import { bmcRoute, call, jsonBody, makeCtx, never, protobuf, stackRoute, type Result, type Route } from './helpers.js';

const KEY = 'K3Y-tres-secrete-7c41a9';
const TOKEN = 'jeton-sncb-9d8e7f6a5b4c';
const DIRECT = `https://user:${TOKEN}@sncb.test/feeds/${TOKEN}/sncb-direct/trip-update?apikey=${TOKEN}`;
const S1 = '88____:046::8812005:8883006:4:1315:20261231';

/** Source bavarde : son erreur ou sa réponse recopie l'adresse demandée et les en-têtes envoyés (clé comprise). */
const leaky = (status: number): Route => (url, c) => {
  const echo = `${url.href} ${JSON.stringify(c.headers)}`;
  if (status === 0) throw new Error(`échec vers ${echo}`);
  return jsonBody({ message: `refusé : ${echo}` }, status);
};

const PATHS = [
  `/api/rt?op=sncb&trips=${S1}`,
  '/api/rt?op=delijn&trips=702321245',
  '/api/rt?op=tec&trips=N5-0750',
  '/api/stib?points=6357,8041',
  '/api/alerts?op=sncb',
  '/api/alerts?op=tec&routes=N51',
  '/api/health',
  '/api/rt?op=stib&trips=1',
  `/api/rt?op=sncb&trips=${KEY}`,
  '/api/stib?points=abc',
  '/api/geocode?q=rue%20de%20fer%2025%20namur',
  '/api/geocode?q=rue%20de%20fer%2025&lang=nl',
  '/api/geocode?q=ab',
  '/api/weather',
];

function handlerFor(path: string) {
  if (path.startsWith('/api/rt')) return handleRt;
  if (path.startsWith('/api/stib')) return handleStib;
  if (path.startsWith('/api/alerts')) return handleAlerts;
  if (path.startsWith('/api/geocode')) return handleGeocode;
  if (path.startsWith('/api/weather')) return handleWeather;
  return handleHealth;
}

describe('la clé ne fuit jamais', () => {
  it('ni dans les réponses (corps et en-têtes) ni dans les journaux, dans tous les scénarios', async () => {
    const scenarios: Route[] = [bmcRoute({ key: KEY }), leaky(0), leaky(401), leaky(500), () => never(), () => protobuf(new TextEncoder().encode(KEY))];
    const responses: Result<unknown>[] = [];
    const logs: string[] = [];
    for (const route of scenarios) {
      for (const env of [{}, { SNCB_RT_URL: DIRECT }, { DATA_BASE: `https://data.test/${KEY}` }]) {
        const t = makeCtx({ env: { BMC_KEY: KEY, ...env }, route, timeouts: { upstream: 30, health: 30 } });
        for (const path of PATHS) {
          // un identifiant demandé égal à la clé est un cas d'école : il est renvoyé tel quel s'il existait ; ici il n'existe pas
          await call(handlerFor(path), path, t.ctx, responses);
        }
        logs.push(...t.logs);
      }
    }
    expect(responses.length).toBe(scenarios.length * 3 * PATHS.length);
    for (const r of responses) {
      const headers = JSON.stringify([...r.headers.entries()]);
      expect(r.text).not.toContain(KEY);
      expect(r.text).not.toContain(TOKEN);
      expect(r.text).not.toContain('sncb.test');
      expect(headers).not.toContain(KEY);
    }
    expect(logs.length).toBeGreaterThan(20);
    const basic = Buffer.from(`user:${TOKEN}`).toString('base64');
    for (const line of logs) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(basic);
    }
  });

  it('la clé n’est envoyée qu’au portail BMC, jamais au flux direct, au site de données, aux services d’adresses ni à Open-Meteo', async () => {
    const t = makeCtx({ env: { BMC_KEY: KEY, SNCB_RT_URL: DIRECT.replace(`user:${TOKEN}@`, ''), DATA_BASE: 'https://data.test/d' }, route: stackRoute({ key: KEY }) });
    await call(handleHealth, '/api/health', t.ctx);
    await call(handleRt, `/api/rt?op=sncb&trips=${S1}`, t.ctx);
    await call(handleGeocode, '/api/geocode?q=rue%20de%20fer%2025', t.ctx);
    await call(handleWeather, '/api/weather', t.ctx);
    expect(t.calls.some((c) => c.url.startsWith('https://api.open-meteo.com/v1/forecast?'))).toBe(true);
    const outside = t.calls.filter((c) => !c.url.startsWith('https://bmc.test/'));
    expect(outside.length).toBeGreaterThanOrEqual(9);
    for (const c of outside) expect(`${c.url} ${JSON.stringify(c.headers)}`).not.toContain(KEY);
  });

  it('scrub masque la clé, SNCB_RT_URL (en entier ou en partie) et les chaînes de requête', () => {
    const secrets = secretsFrom({ BMC_KEY: KEY, SNCB_RT_URL: DIRECT });
    const text = `a ${KEY} b ${DIRECT} c /feeds/${TOKEN}/sncb-direct/trip-update d https://x.test/p?k=${KEY}&z=1 e https://u:p@x.test/`;
    const out = scrub(text, secrets);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('https://x.test/p?***');
    expect(out).toContain('https://***@x.test/');
  });
});
