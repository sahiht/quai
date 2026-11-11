/**
 * Faux cœur 1.1 (app/src/dev/fake-core.ts, ?fake=1) : ses réponses doivent rester alignées sur les scénarios de
 * fixtures/README.md et les critères du PRD, puisque les équipes lunettes et téléphone développent dessus.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Endpoint, FavoriteAnswer, Journey, PlanResult } from '../../src/core/api';
import { createFakeCore, type FakeFlags } from '../../src/dev/fake-core';
import { gtfsTime, hhmm } from '../../src/core/util';
import { validateSettings } from '../../src/settings';
import { readJson, REPO_DIR } from './support/network';

const at = (h: number, m: number) => gtfsTime('2026-11-10', h * 60 + m);
const PRESET = validateSettings(readJson(join(REPO_DIR, 'fixtures', 'app', 'preset-1.1.json')));
const POS = { s1: { lat: 50.4655, lon: 4.859 }, s2: { lat: 50.86, lon: 4.359 }, s3: { lat: 50.8454, lon: 4.3571 }, bureau: { lat: 50.8441, lon: 4.3474 } };
const here: Endpoint = { type: 'here' };
const addr = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });
const fake = (now: number, flags: FakeFlags = {}) => createFakeCore({ dataBase: 'https://x.test/data', relayBase: 'https://r.test', now: () => now, storage: { get: async () => null, set: async () => {} } }, flags);
const labels = (r: PlanResult) => r.journeys.map((j) => j.label);
const times = (j: Journey) => `${hhmm(j.dep)}→${hhmm(j.arr)}`;

async function order(now: number, pos: { lat: number; lon: number } | null) {
  const core = fake(now);
  const last = new Map<string, FavoriteAnswer>();
  for (const f of PRESET.favorites) last.set(f.id, await core.answer(f, pos, PRESET));
  return { core, last, order: core.orderFavorites(pos, PRESET, last).map((r) => r.favoriteId) };
}

describe('faux cœur 1.1 : favoris', () => {
  it('ordre intelligent des scénarios S1, S2, S3 et au Bureau', async () => {
    expect((await order(at(7, 31), POS.s1)).order).toEqual(['fav-bureau', 'fav-namur', 'fav-gdn', 'fav-gand', 'fav-dl-nord', 'fav-maison']);
    expect((await order(at(12, 10), POS.s2)).order).toEqual(['fav-gdn', 'fav-dl-nord', 'fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    expect((await order(at(13, 55), POS.s3)).order[0]).toBe('fav-gand');
    const b = await order(at(7, 31), POS.bureau);
    expect(b.last.get('fav-bureau')?.state).toBe('here');
    expect(b.order.slice(-2)).toContain('fav-bureau');
  });

  it('réponses : bureau (simple, suivant, suivant), gare à gare hors de portée, sans position', async () => {
    const s1 = (await order(at(7, 31), POS.s1)).last.get('fav-bureau')!;
    expect(labels(s1.plan!)).toEqual(['simple', 'next', 'next']);
    expect(s1.plan!.journeys.map(times)).toEqual(['07:35→09:00', '08:33→09:58', '09:33→10:58']);
    expect(s1.plan!.journeys[0].legs.find((l) => l.kind === 'ride')).toMatchObject({ newPlatform: '6', delayMin: 2 });
    const noRt = await fake(at(7, 31), { noRt: true }).answer(PRESET.favorites[0], POS.s1, PRESET);
    expect(noRt.plan!.journeys[0].reason).toBe('Le plus simple : direct, à pied 7 + 12 min');
    expect(times(noRt.plan!.journeys[0])).toBe('07:33→08:58');
    const gand = (await order(at(12, 10), POS.s2)).last.get('fav-gand')!;
    expect(gand.fromStation).toBe(true);
    expect(gand.plan!.journeys.map((j) => hhmm(j.legs[0].schedDep))).toEqual(['14:10', '14:22', '14:40']);
    expect((await fake(at(7, 31)).answer(PRESET.favorites[0], null, PRESET)).state).toBe('noPosition');
  });

  it('arrêts : zone retrouvée (aka, nom et position) ou introuvable', async () => {
    const core = fake(at(12, 10));
    const gdn = PRESET.favorites[1];
    if (gdn.kind !== 'stop') throw new Error('arrêt attendu');
    expect((await core.answer({ ...gdn, areaId: 'stib:6358' }, POS.s2, PRESET)).movedTo?.id).toBe('stib:6357F');
    expect((await core.answer({ ...gdn, areaId: 'stib:64' }, POS.s2, PRESET)).movedTo?.id).toBe('stib:6357F');
    expect((await core.answer({ ...gdn, areaId: 'stib:99', name: { fr: 'Ailleurs', nl: 'Elders' } }, POS.s2, PRESET)).state).toBe('missing');
  });
});

describe('faux cœur 1.1 : trajets', () => {
  it('CA-M3.4 noRT vers Rue Neuve 1 : simple 08:56 puis « Le plus rapide : 5 min plus tôt, 1 changement »', async () => {
    const r = await fake(at(7, 31), { noRt: true }).route(here, addr('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545), at(7, 31), PRESET, POS.s1);
    expect(labels(r)).toEqual(['simple', 'fast', 'next']);
    expect(hhmm(r.journeys[0].arr)).toBe('08:56');
    expect(r.journeys[1].reason).toBe('Le plus rapide : 5 min plus tôt, 1 changement');
  });

  it('CA-M5.2, M5.3, M5.4 : métro, tram puis métro, train puis tram', async () => {
    const centenaire = addr('Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334);
    const a = await fake(at(12, 10)).route(here, centenaire, at(12, 10), PRESET, POS.s2);
    expect(a.journeys[0].reason).toBe('Le plus simple : direct, à pied 6 + 1 min');
    const b = await fake(at(8, 0)).route(addr('Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365), centenaire, at(8, 0), PRESET);
    expect(b.journeys[0].legs.filter((l) => l.kind === 'ride').map((l) => l.line)).toEqual(['3', '6']);
    const c = await fake(at(13, 55)).route(here, addr('Veldstraat 1, 9000 Gent', 51.0537, 3.7225), at(13, 55), PRESET, POS.s3);
    expect(c.journeys[0].reason).toBe('Le plus simple : 1 changement, à pied 1 + 3 min');
    expect(times(c.journeys[0])).toBe('14:10→14:57');
    expect(c.journeys[0].legs.find((l) => l.mode === 'tram')?.stops?.length).toBe(2);
  });

  it('scénario 4 (Waterloo) : bus W puis métro, ou marche et train plus rapide', async () => {
    const r = await fake(at(7, 31)).route(addr('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399), addr('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36), at(7, 31), PRESET);
    expect(labels(r).slice(0, 2)).toEqual(['simple', 'fast']);
    expect(r.journeys[0].legs.filter((l) => l.kind === 'ride').map((l) => l.line)).toEqual(['W', '2']);
    expect(r.journeys[1].legs[0]).toMatchObject({ kind: 'walk', walkMin: 19 });
  });

  it('états vides : à pied, tu y es, sans position, aucun arrêt, pas de trajet complet', async () => {
    const core = fake(at(7, 31));
    const walk = await core.route(here, { type: 'place', placeId: 'bureau' }, at(7, 31), PRESET, { lat: 50.848, lon: 4.352 });
    expect(walk.journeys.map((j) => j.reason)).toEqual(['Le plus simple : à pied, 9 min']);
    expect((await core.route(here, { type: 'place', placeId: 'bureau' }, at(7, 31), PRESET, POS.bureau)).empty).toBe('here');
    expect((await core.route(here, { type: 'place', placeId: 'bureau' }, at(7, 31), PRESET, null)).empty).toBe('noPosition');
    expect(await core.route(here, addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), at(7, 31), PRESET, POS.s1)).toMatchObject({ empty: 'noStopTo', accessMin: 20 });
    expect(await core.route(here, addr('Rue de Nimy 50, 7000 Mons', 50.46, 3.957), at(7, 31), PRESET, POS.s1)).toMatchObject({ empty: 'noTrip', station: { areaId: 'sncb:8881000' } });
  });
});

describe('faux cœur 1.1 : adresses, état, accueil léger', () => {
  it('tableau A.2 ; geo=down et offline', async () => {
    const flags: FakeFlags = {};
    const core = fake(at(12, 10), flags);
    expect((await core.geocode('rue de fer 25 namur', 'fr')).results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur']);
    expect((await core.geocode('rue de fer 25', 'fr', POS.s1)).results.map((r) => r.label)).toEqual(['Rue de Fer 25, 5000 Namur', 'Rue de Fer 25, 4000 Liège']);
    expect((await core.geocode('nieuwstraat 1', 'nl')).results[0].label).toBe('Nieuwstraat 1, 1000 Brussel');
    expect((await core.geocode('rue neuve bruxelles', 'fr')).results).toMatchObject([{ label: 'Rue Neuve, 1000 Bruxelles', approx: true }]);
    expect((await core.geocode('ve', 'fr')).results).toEqual([]);
    flags.geo = 'down';
    expect(await core.geocode('rue de fer 26', 'fr')).toEqual({ results: [], error: 'down' });
    flags.geo = undefined;
    flags.offline = true;
    expect((await core.geocode('rue de fer 27', 'fr')).error).toBe('offline');
  });

  it('status, panne (suppression gardée), nearby léger', async () => {
    const flags: FakeFlags = {};
    const core = fake(at(12, 10), flags);
    expect(core.status()).toEqual({ rt: 'unknown' });
    const s1 = async () => (await core.board('sncb:8812005', { limit: 4 })).departures.find((d) => d.line === 'S1');
    expect(await s1()).toMatchObject({ cancelled: true, rt: true });
    expect(core.status().rt).toBe('ok');
    flags.noRt = true;
    expect(await s1()).toMatchObject({ cancelled: true, rt: false });
    expect(core.status().rt).toBe('down');
    const light = await core.nearby(POS.s2.lat, POS.s2.lon, 500, { light: true });
    expect(light.map((x) => x.area.id)).toEqual(['stib:6357F', 'sncb:8812005', 'delijn:308611', 'stib:6359']);
    expect(light.every((x) => !x.next)).toBe(true);
  });

  it('recherche commune avec le vrai cœur', async () => {
    const core = fake(at(12, 10));
    expect((await core.search('gare du midi'))[0].id).toBe('sncb:8814001');
    expect((await core.search('gand')).slice(0, 2).map((x) => x.id)).toEqual(['sncb:8892007', 'sncb:8893120']);
  });
});
