/**
 * Cache HTTP de la WebView : le relais répond « Cache-Control: public, s-maxage=20, stale-while-revalidate=40 »
 * (cache du CDN Vercel). Une WebView (WebKit, Chromium) ignore s-maxage mais applique stale-while-revalidate :
 * sans précaution, chaque rafraîchissement de 30 s recevait la réponse précédente (un cycle de retard ; passage
 * en « ~ » vu après 59 s dans le simulateur). Le cœur demande donc le temps réel avec cache: 'no-store'.
 */
import { describe, expect, it } from 'vitest';
import { createCore } from '../../src/core/index';
import { Clock, DATA_BASE, FakeServer, MemoryKV, RELAY_BASE } from './support/env';

function spyCore(now: string) {
  const server = new FakeServer();
  const seen: { url: string; cache?: string }[] = [];
  const fetchSpy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, cache: init?.cache });
    return server.fetch(input, init);
  }) as typeof fetch;
  const clock = new Clock(now);
  const core = createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now: clock.now, storage: new MemoryKV(), fetch: fetchSpy });
  return { core, seen };
}

describe('requêtes au relais sans cache HTTP de la WebView', () => {
  it('temps réel, alertes et état des sources : cache « no-store » ; données statiques : cache HTTP permis', async () => {
    const { core, seen } = spyCore('2026-11-10T12:10');
    await core.init();
    await core.board('stib:6357F', { limit: 3 });
    await core.board('sncb:8812005', { limit: 3 });
    await core.works('sncb', [], ['8811601']);
    await core.health();
    const relay = seen.filter((s) => s.url.startsWith(RELAY_BASE));
    expect(relay.map((s) => new URL(s.url).pathname).sort()).toEqual(['/api/alerts', '/api/health', '/api/rt', '/api/stib']);
    for (const s of relay) expect(s.cache, s.url).toBe('no-store');
    const data = seen.filter((s) => s.url.startsWith(DATA_BASE));
    expect(data.length).toBeGreaterThan(0);
    for (const s of data) expect(s.cache, s.url).toBeUndefined();
  });
});
