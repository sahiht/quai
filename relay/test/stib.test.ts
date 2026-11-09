import { describe, expect, it } from 'vitest';
import { handleStib } from '../lib/handlers.js';
import { extractRows, groupWaitingTimes } from '../lib/stib.js';
import { UpstreamError } from '../lib/upstream.js';
import type { StibResponse } from '../lib/shared/types.js';
import { BMC, NOW_MS, TEST_KEY, call, fixture, jsonBody, makeCtx, never, type Route } from './helpers.js';

const stib = (path: string, t = makeCtx()) => call<StibResponse>(handleStib, path, t.ctx);
const T = (hm: string) => `2026-11-10T${hm}:00+01:00`;
const pt = (line: string, time: string, dest: unknown = { fr: 'CHURCHILL', nl: 'CHURCHILL' }, extra: Record<string, unknown> = {}) =>
  ({ destination: dest, expectedArrivalTime: time, lineId: line, ...extra });

describe('lecture des réponses WaitingTimes', () => {
  it('enveloppe Opendatasoft, passingtimes en chaîne JSON (fixture réelle)', () => {
    const { rows, total } = extractRows(JSON.parse(fixture('bmc/stibmivb/waiting-times.json').toString('utf8')));
    expect(total).toBe(6);
    const g = groupWaitingTimes(rows, ['6357', '6358', '8042', '8041']);
    expect(g.get('6357')).toEqual([
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12'), T('12:20')] },
      { line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: [T('12:15'), T('12:23')] },
    ]);
    expect(g.get('6358')).toEqual([{ line: '3', dest: { fr: 'ESPLANADE', nl: 'ESPLANADE' }, times: [T('12:16'), T('12:24')] }]);
    expect(g.get('8042')).toEqual([
      { line: '2', dest: { fr: 'SIMONIS (ELISABETH)', nl: 'SIMONIS (ELISABETH)' }, times: [T('12:13'), T('12:19')] },
      { line: '6', dest: { fr: 'ROI BAUDOUIN', nl: 'KONING BOUDEWIJN' }, times: [T('12:15'), T('12:25')] },
    ]);
    expect(g.get('8041')).toEqual([
      { line: '2', dest: { fr: 'GARE DU MIDI', nl: 'ZUIDSTATION' }, times: [T('12:14'), T('12:20')], msg: 'Travaux : arrêt Botanique non desservi' },
    ]);
  });

  it('tableau nu, passingtimes en tableau, pointid et lineid numériques', () => {
    const { rows, total } = extractRows([
      { pointid: 5153, lineid: 3, passingtimes: [pt('3', T('12:20')), pt('3', T('12:12'))] },
    ]);
    expect(total).toBeNull();
    expect(groupWaitingTimes(rows, ['5153']).get('5153')).toEqual([
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12'), T('12:20')] },
    ]);
  });

  it('formes Opendatasoft records[].fields et records[].record.fields', () => {
    const a = extractRows({ nhits: 1, records: [{ fields: { pointid: '1', lineid: '7', passingtimes: JSON.stringify([pt('7', T('12:01'))]) } }] });
    const b = extractRows({ records: [{ record: { fields: { pointid: '1', lineid: '7', passingtimes: [pt('7', T('12:02'))] } } }] });
    expect(a.total).toBe(1);
    expect(groupWaitingTimes(a.rows, ['1']).get('1')![0].times).toEqual([T('12:01')]);
    expect(groupWaitingTimes(b.rows, ['1']).get('1')![0].times).toEqual([T('12:02')]);
  });

  it('destination chaîne ou objet partiel ; message chaîne, objet { fr, nl } (fr) ou nl seul', () => {
    const { rows } = extractRows({ results: [
      { pointid: '1', lineid: '2', passingtimes: [pt('2', T('12:05'), 'SIMONIS', { message: 'Déviation' })] },
      { pointid: '1', lineid: '6', passingtimes: [pt('6', T('12:06'), { nl: 'KONING BOUDEWIJN' }, { message: { fr: 'Travaux', nl: 'Werken' } })] },
      { pointid: '1', lineid: '7', passingtimes: [pt('7', T('12:07'), { fr: 'HEYSEL' }, { message: { nl: 'Alleen NL' } })] },
      { pointid: '1', lineid: '8', passingtimes: [pt('8', T('12:08'), null, { message: { fr: ' ', nl: '' } })] },
    ] });
    expect(groupWaitingTimes(rows, ['1']).get('1')).toEqual([
      { line: '2', dest: { fr: 'SIMONIS', nl: 'SIMONIS' }, times: [T('12:05')], msg: 'Déviation' },
      { line: '6', dest: { fr: 'KONING BOUDEWIJN', nl: 'KONING BOUDEWIJN' }, times: [T('12:06')], msg: 'Travaux' },
      { line: '7', dest: { fr: 'HEYSEL', nl: 'HEYSEL' }, times: [T('12:07')], msg: 'Alleen NL' },
      { line: '8', dest: { fr: '', nl: '' }, times: [T('12:08')] },
    ]);
  });

  it('regroupe par ligne et destination, trie et dédoublonne les heures, normalise les fuseaux', () => {
    const { rows } = extractRows({ results: [
      { pointid: '9', lineid: '3', passingtimes: JSON.stringify([
        pt('3', '2026-11-10T11:30:00Z', 'ESPLANADE'),
        pt('3', '2026-11-10T12:10:00', 'CHURCHILL'), // sans fuseau : heure de Bruxelles
        pt('3', '2026-11-10T12:10:00+01:00', 'CHURCHILL'), // doublon
        pt('3', '2026-11-10T11:05:00.000Z', 'CHURCHILL'),
      ]) },
      { pointid: '9', lineid: '3', passingtimes: [pt('3', '2026-07-01T10:00:00Z', 'ÉTÉ')] },
    ] });
    expect(groupWaitingTimes(rows, ['9']).get('9')).toEqual([
      { line: '3', dest: { fr: 'ÉTÉ', nl: 'ÉTÉ' }, times: ['2026-07-01T12:00:00+02:00'] },
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:05'), T('12:10')] },
      { line: '3', dest: { fr: 'ESPLANADE', nl: 'ESPLANADE' }, times: [T('12:30')] },
    ]);
  });

  it('ignore les lignes illisibles, les arrêts non demandés et les passages sans heure ; arrêt sans données = []', () => {
    const { rows } = extractRows({ results: [
      { pointid: '1', lineid: '3', passingtimes: '{pas du json' },
      { pointid: '1', lineid: '4', passingtimes: [pt('4', 'bientôt'), pt('4', T('12:40'))] },
      { pointid: '1', lineid: '5', passingtimes: [{ destination: 'X', message: 'Fin de service' }] },
      { pointid: '2', lineid: '4', passingtimes: [pt('4', T('12:41'))] },
      'n’importe quoi',
    ] });
    const g = groupWaitingTimes(rows, ['1', '3']);
    expect(g.get('1')).toEqual([{ line: '4', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:40')] }]);
    expect(g.get('3')).toEqual([]);
    expect(g.has('2')).toBe(false);
  });

  it('forme de réponse inconnue : erreur de source', () => {
    expect(() => extractRows({ error_code: 'ODSQLError', message: 'x' })).toThrow(UpstreamError);
    expect(() => extractRows('texte')).toThrow(UpstreamError);
  });
});

describe('/api/stib', () => {
  it('fixtures : arrêts demandés, destinations telles quelles, message en français', async () => {
    const r = await stib('/api/stib?points=6357,8041');
    expect(r.status).toBe(200);
    expect(r.body.fetchedAt).toBe(new Date(NOW_MS).toISOString());
    expect(Object.keys(r.body.points)).toEqual(['6357', '8041']);
    expect(r.body.points['6357'].map((g) => [g.line, g.dest.fr, g.times.length])).toEqual([['3', 'CHURCHILL', 2], ['4', 'STALLE (P)', 2]]);
    expect(r.body.points['8041'][0].msg).toBe('Travaux : arrêt Botanique non desservi');
    expect(r.headers.get('cache-control')).toBe('public, s-maxage=20, stale-while-revalidate=40');
  });

  it('une seule requête, clause where en « or », limit 100, offset 0, clé dans les deux en-têtes', async () => {
    const t = makeCtx();
    await stib('/api/stib?points=6357,8041', t);
    expect(t.calls).toHaveLength(1);
    const u = new URL(t.calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe(`${BMC}/api/datasets/stibmivb/rt/WaitingTimes`);
    expect(u.searchParams.get('where')).toBe('pointid="6357" or pointid="8041"');
    expect(u.searchParams.get('limit')).toBe('100');
    expect(u.searchParams.get('offset')).toBe('0');
    expect(t.calls[0].url).not.toContain('+'); // espaces encodés en %20
    expect(t.calls[0].headers['bmc-partner-key']).toBe(TEST_KEY);
    expect(t.calls[0].headers['ocp-apim-subscription-key']).toBe(TEST_KEY);
  });

  it('identifiant statique à lettre finale (6357F) ramené au pointid 6357, doublons retirés', async () => {
    const r = await stib('/api/stib?points=6357F,6357');
    expect(Object.keys(r.body.points)).toEqual(['6357']);
    expect(r.body.points['6357']).toHaveLength(2);
  });

  it('pagination par offset quand la réponse dépasse 100 lignes', async () => {
    const points = Array.from({ length: 30 }, (_, i) => String(1000 + i));
    const all = points.flatMap((p) => [1, 2, 3, 4].map((l) => ({ pointid: p, lineid: String(l), passingtimes: JSON.stringify([pt(String(l), T('12:30'))]) })));
    const route: Route = (url) => {
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      return jsonBody({ total_count: all.length, results: all.slice(offset, offset + limit) });
    };
    const t = makeCtx({ route });
    const r = await stib(`/api/stib?points=${points.join(',')}`, t);
    expect(t.calls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', '100']);
    expect(Object.values(r.body.points).every((g) => g.length === 4)).toBe(true);
  });

  it('pagination : un seul budget de temps pour toutes les pages', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ pointid: '1', lineid: String(i), passingtimes: [pt(String(i), T('12:30'))] }));
    const route: Route = async (url) => {
      if (url.searchParams.get('offset') !== '0') return never();
      await new Promise((r) => setTimeout(r, 60));
      return jsonBody({ total_count: 150, results: rows });
    };
    const t = makeCtx({ route, timeouts: { upstream: 100 } });
    const t0 = performance.now();
    const r = await stib('/api/stib?points=1', t);
    expect(performance.now() - t0).toBeLessThan(400);
    expect(t.calls).toHaveLength(2);
    expect(r.body.error).toBe('Temps réel STIB indisponible : délai dépassé (0,1 s)');
  });

  it('cache par arrêt : seuls les arrêts manquants ou périmés sont redemandés', async () => {
    const t = makeCtx();
    await stib('/api/stib?points=6357,8041', t);
    await stib('/api/stib?points=6357', t);
    expect(t.calls).toHaveLength(1);
    const r = await stib('/api/stib?points=6357,8042', t);
    expect(t.calls).toHaveLength(2);
    expect(new URL(t.calls[1].url).searchParams.get('where')).toBe('pointid="8042"');
    expect(r.body.points['8042']).toHaveLength(2);
    t.advance(25_000);
    await stib('/api/stib?points=6357', t);
    expect(t.calls).toHaveLength(3);
  });

  it('requêtes simultanées : une seule requête vers le portail', async () => {
    const t = makeCtx();
    const results = await Promise.all([1, 2, 3].map(() => stib('/api/stib?points=6357,6358', t)));
    expect(t.calls).toHaveLength(1);
    expect(results.every((r) => r.body.points['6358'].length === 1)).toBe(true);
  });

  it('source en erreur : 200, error en français, données vides, pas de cache CDN', async () => {
    const cases: [Route, RegExp][] = [
      [() => jsonBody({ statusCode: 503 }, 503), /^Temps réel STIB indisponible : réponse HTTP 503 du portail$/],
      [() => new Response('<html>', { status: 200 }), /JSON invalide/],
      [() => jsonBody({ error_code: 'x' }), /réponse STIB inattendue/],
      [() => never(), /délai dépassé \(0,05 s\)/],
    ];
    for (const [route, msg] of cases) {
      const t = makeCtx({ route, timeouts: { upstream: 50 } });
      const r = await stib('/api/stib?points=6357', t);
      expect(r.status).toBe(200);
      expect(r.body.points).toEqual({});
      expect(r.body.error).toMatch(msg);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('paramètres invalides : 400 en français', async () => {
    for (const q of ['', '?points=', '?points=abc', '?points=12-3', `?points=${Array.from({ length: 31 }, (_, i) => i + 1).join(',')}`]) {
      const r = await stib(`/api/stib${q}`);
      expect(r.status, q).toBe(400);
      expect(r.body.error).toMatch(/^(Paramètre points|Trop d’arrêts)/);
    }
  });
});
