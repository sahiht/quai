/**
 * Faux cœur (1.2.2 ; app/src/dev/fake-core.ts, ?fake=1) : ses réponses doivent rester alignées sur les scénarios de
 * fixtures/README.md et les critères du PRD (1.2.2 : classement du vrai cœur, core/routing/rank.ts, mêmes temps de
 * correspondance, noms et raisons), puisque les équipes lunettes et téléphone développent dessus.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Endpoint, Favorite, FavoriteAnswer, FavoriteStop, Journey, LineBoard, PlanResult, Settings } from '../../src/core/api';
import { displayLabel } from '../../src/core/means';
import { createFakeCore, type FakeFlags } from '../../src/dev/fake-core';
import { gtfsTime, hhmm } from '../../src/core/util';
import { validateSettings } from '../../src/settings';
import { makeEnv } from './support/env';
import { readJson, REPO_DIR } from './support/network';

const at = (h: number, m: number) => gtfsTime('2026-11-10', h * 60 + m);
const RAW = readJson<{ favorites: { id: string; kind: string }[] }>(join(REPO_DIR, 'fixtures', 'app', 'preset-1.1.json'));
const PRESET = validateSettings(RAW);
/** 1.2.2 : le préréglage tel que la 1.2.1 le lisait, arrêts favoris compris (réponses des données antérieures). */
const LEGACY: Settings = {
  ...PRESET,
  favorites: RAW.favorites
    .map((r) => PRESET.favorites.find((f) => f.id === r.id) ?? (r.kind === 'stop' ? (r as unknown as FavoriteStop) : undefined))
    .filter((f): f is Favorite => f !== undefined),
};
const POS = { s1: { lat: 50.4655, lon: 4.859 }, s2: { lat: 50.86, lon: 4.359 }, s3: { lat: 50.8454, lon: 4.3571 }, bureau: { lat: 50.8441, lon: 4.3474 } };
const here: Endpoint = { type: 'here' };
const addr = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });
const WATERLOO = addr('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399);
const ROGIER = addr('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36);
const fake = (now: number, flags: FakeFlags = {}) => createFakeCore({ dataBase: 'https://x.test/data', relayBase: 'https://r.test', now: () => now, storage: { get: async () => null, set: async () => {} } }, flags);
const labels = (r: PlanResult) => r.journeys.map((j) => j.label);
const times = (j: Journey) => `${hhmm(j.dep)}→${hhmm(j.arr)}`;

async function order(now: number, pos: { lat: number; lon: number } | null, settings: Settings = LEGACY) {
  const core = fake(now);
  const last = new Map<string, FavoriteAnswer>();
  for (const f of settings.favorites) last.set(f.id, await core.answer(f, pos, settings));
  return { core, last, order: core.orderFavorites(pos, settings, last).map((r) => r.favoriteId) };
}

describe('faux cœur 1.2 : favoris', () => {
  it('ordre intelligent des scénarios S1, S2, S3 et au Bureau', async () => {
    expect((await order(at(7, 31), POS.s1)).order).toEqual(['fav-bureau', 'fav-namur', 'fav-gdn', 'fav-gand', 'fav-dl-nord', 'fav-maison']);
    expect((await order(at(12, 10), POS.s2)).order).toEqual(['fav-gdn', 'fav-dl-nord', 'fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    expect((await order(at(13, 55), POS.s3)).order[0]).toBe('fav-gand');
    const b = await order(at(7, 31), POS.bureau);
    expect(b.last.get('fav-bureau')?.state).toBe('here');
    expect(b.order.slice(-2)).toContain('fav-bureau');
    // 1.2.2 : réglages v4 (arrêts rangés dans les gares et les lignes)
    expect((await order(at(7, 31), POS.s1, PRESET)).order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    expect([PRESET.stations.map((x) => x.id), PRESET.lines.map((x) => x.id)]).toEqual([['fav-namur'], ['fav-gdn-3', 'fav-gdn-4', 'fav-dl-nord']]);
  });

  it('réponses : bureau (IC puis tram, puis les IC suivants), gare à gare hors de portée, sans position', async () => {
    const s1 = (await order(at(7, 31), POS.s1)).last.get('fav-bureau')!;
    // 1.2 : fav-bureau est un lieu ; sa réponse est celle du trajet « Ma position → lieu » (CA-1.3)
    expect(PRESET.favorites[0].kind).toBe('place');
    expect(s1.kind).toBe('trip');
    // 1.2.2 (classement du vrai cœur, core/routing/rank.ts) : coût = arrivée + 3 × la marche au-delà des 10 min
    // réglées + 1 par changement. L'IC (+2, voie 6) jusqu'à Bruxelles-Nord puis le T3 de 08:44 (correspondance tenue,
    // comme dans le vrai cœur) garde chaque marche sous 10 min ; l'IC direct puis 12 min à pied (09:00) marche plus
    // au-delà de la marche maximale : plus de « Sans changement » ; ensuite les IC suivants
    const js = s1.plan!.journeys;
    expect(labels(s1.plan!)[0]).toBe('short');
    expect(labels(s1.plan!)).not.toContain('none');
    expect(labels(s1.plan!).slice(1).every((l) => l === 'next' || l === 'later')).toBe(true);
    expect(times(js[0])).toBe('07:35→08:58');
    expect(js[0].legs.filter((l) => l.kind === 'ride').map((l) => l.cat ?? l.line)).toEqual(['IC', '3']);
    expect(js[0].legs.find((l) => l.kind === 'ride')).toMatchObject({ newPlatform: '6', delayMin: 2 });
    expect(times(js[1])).toBe('08:33→09:57');
    const noRt = await fake(at(7, 31), { noRt: true }).answer(PRESET.favorites[0], POS.s1, PRESET);
    expect(noRt.plan!.journeys[0].reason).toBe('Le plus court\u00a0: 1 changement, à pied 7 + 2 + 9\u00a0min');
    expect(times(noRt.plan!.journeys[0])).toBe('07:33→08:58');
    const gand = (await order(at(12, 10), POS.s2)).last.get('fav-gand')!;
    expect(gand.fromStation).toBe(true);
    expect(gand.plan!.journeys.map((j) => hhmm(j.legs[0].schedDep))).toEqual(['14:10', '14:22', '14:40']);
    expect((await fake(at(7, 31)).answer(PRESET.favorites[0], null, PRESET)).state).toBe('noPosition');
  });

  it('arrêts : zone retrouvée (aka, nom et position) ou introuvable', async () => {
    const core = fake(at(12, 10));
    const gdn = LEGACY.favorites[1];
    if (gdn.kind !== 'stop') throw new Error('arrêt attendu');
    expect((await core.answer({ ...gdn, areaId: 'stib:6358' }, POS.s2, PRESET)).movedTo?.id).toBe('stib:6357F');
    expect((await core.answer({ ...gdn, areaId: 'stib:64' }, POS.s2, PRESET)).movedTo?.id).toBe('stib:6357F');
    expect((await core.answer({ ...gdn, areaId: 'stib:99', name: { fr: 'Ailleurs', nl: 'Elders' } }, POS.s2, PRESET)).state).toBe('missing');
  });
});

describe('faux cœur 1.2 : trajets', () => {
  it('CA-1.4 noRT vers Rue Neuve 1 : le plus court 07:33 → 08:51 (IC puis T3), sans changement 08:56, le suivant', async () => {
    const r = await fake(at(7, 31), { noRt: true }).route(here, addr('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545), at(7, 31), PRESET, POS.s1);
    expect(labels(r)).toEqual(['short', 'none', 'next']);
    // 1.2.2 : le suivant prend le T4 de 09:43 (IC 09:40, 2 min à pied et 1 min de marge, comme le vrai cœur)
    expect(r.journeys.map(times)).toEqual(['07:33→08:51', '07:33→08:56', '08:33→09:50']);
    expect(r.journeys.slice(0, 2).map((j) => j.reason)).toEqual(['Le plus court\u00a0: 1 changement, à pied 7 + 2 + 3\u00a0min', 'Sans changement\u00a0: à pied 7 + 10\u00a0min']);
  });

  it('CA-M5.2, M5.3, M5.4 : métro, tram puis métro, train puis tram', async () => {
    const centenaire = addr('Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334);
    const a = await fake(at(12, 10)).route(here, centenaire, at(12, 10), PRESET, POS.s2);
    expect(a.journeys[0].reason).toBe('Le plus court : direct, à pied 6 + 1 min');
    const b = await fake(at(8, 0)).route(addr('Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365), centenaire, at(8, 0), PRESET);
    expect(b.journeys[0].legs.filter((l) => l.kind === 'ride').map((l) => l.line)).toEqual(['3', '6']);
    const c = await fake(at(13, 55)).route(here, addr('Veldstraat 1, 9000 Gent', 51.0537, 3.7225), at(13, 55), PRESET, POS.s3);
    expect(c.journeys[0].reason).toBe('Le plus court : 1 changement, à pied 1 + 3 min');
    expect(times(c.journeys[0])).toBe('14:10→14:57');
    expect(c.journeys[0].legs.find((l) => l.mode === 'tram')?.stops?.length).toBe(2);
  });

  it('CA-1.5 Waterloo → Rogier (cas H) : bus W puis métro d’abord (« Moins de marche »), 19 min à pied et le S1 « Plus tôt » (1.2.2 : 9 min de trop comptent triple)', async () => {
    const r = await fake(at(7, 31)).route(WATERLOO, ROGIER, at(7, 31), PRESET);
    expect(labels(r)).toEqual(['short', 'earlier', 'next']);
    expect(r.journeys.map(times)).toEqual(['07:32→08:46', '07:34→08:30', '07:52→09:04']);
    expect(r.journeys[0].legs.filter((l) => l.kind === 'ride').map((l) => l.line)).toEqual(['W', '2']);
    expect(r.journeys[1].legs[0]).toMatchObject({ kind: 'walk', walkMin: 19 });
    expect(r.journeys.map((j) => j.reason)).toEqual([
      'Moins de marche\u00a0: 1 changement, à pied 2 + 2 + 3\u00a0min',
      'Plus tôt de 16\u00a0min, mais 19\u00a0min à pied',
      'Le suivant\u00a0: même trajet, 20\u00a0min plus tard',
    ]);
    expect(r.journeys.map((j) => displayLabel(j, r.journeys))).toEqual(['Moins de marche', 'Plus tôt', 'Le suivant']);
  });

  it('CA-121.3 (1.2.2) : mêmes étiquettes, heures et raisons que le vrai cœur, scènes base et noRT', async () => {
    const centenaire = addr('Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334);
    const cases: [number, Endpoint, Endpoint, { lat: number; lon: number } | undefined][] = [
      [at(7, 31), WATERLOO, ROGIER, undefined],
      [at(7, 31), here, addr('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545), POS.s1],
      [at(12, 10), here, centenaire, POS.s2],
      [at(8, 0), addr('Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365), centenaire, undefined],
      [at(13, 55), here, addr('Veldstraat 1, 9000 Gent', 51.0537, 3.7225), POS.s3],
      [at(17, 30), { type: 'place', placeId: 'fav-bureau' }, { type: 'place', placeId: 'fav-maison' }, undefined],
    ];
    const view = (x: PlanResult) => x.journeys.map((j) => `${j.label} ${times(j)} ${j.reason}`);
    for (const scene of ['noRT', 'base'] as const) {
      for (const [t, from, to, pos] of cases) {
        const real = makeEnv({ now: t, scene });
        const a = await fake(t, { noRt: scene === 'noRT' }).route(from, to, t, PRESET, pos);
        const b = await real.core.route(from, to, t, PRESET, pos);
        expect(view(a), `${scene} ${hhmm(t)}`).toEqual(view(b));
        for (const j of a.journeys) expect(j.reason!.length).toBeLessThanOrEqual(60);
      }
    }
  });

  it('états vides : à pied, tu y es, sans position, aucun arrêt, pas de trajet complet', async () => {
    const core = fake(at(7, 31));
    const walk = await core.route(here, { type: 'place', placeId: 'fav-bureau' }, at(7, 31), PRESET, { lat: 50.848, lon: 4.352 });
    expect(walk.journeys.map((j) => j.reason)).toEqual(['Le plus court : à pied, 9 min']);
    expect((await core.route(here, { type: 'place', placeId: 'fav-bureau' }, at(7, 31), PRESET, POS.bureau)).empty).toBe('here');
    expect((await core.route(here, { type: 'place', placeId: 'fav-bureau' }, at(7, 31), PRESET, null)).empty).toBe('noPosition');
    expect(await core.route(here, addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), at(7, 31), PRESET, POS.s1)).toMatchObject({ empty: 'noStopTo', accessMin: 20 });
    expect(await core.route(here, addr('Rue de Nimy 50, 7000 Mons', 50.46, 3.957), at(7, 31), PRESET, POS.s1)).toMatchObject({ empty: 'noTrip', station: { areaId: 'sncb:8881000' } });
  });
});

describe('faux cœur 1.2 : adresses, état, accueil léger', () => {
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

describe('faux cœur 1.2.2 : lignes par numéro et passages par sens (PRD-1.2.2 § 3, § 4)', () => {
  const MERBRAINE = { lat: 50.6833, lon: 4.3891 };
  const view = (b: LineBoard) =>
    b.directions.map((d) => `${d.head.fr} : ${d.departures.map((x) => `${hhmm(x.sched)}${x.rt ? '' : '~'}${x.delayMin ? `+${x.delayMin}` : ''}${x.cancelled ? ' supprimé' : ''}${x.partial ? ` jusqu'à ${x.head.fr}` : ''}`).join(', ')}`);

  it('findLines : numéro sans casse, espaces ni zéros de tête, terminus, le plus proche d’abord, jamais un train', async () => {
    const core = fake(at(7, 31));
    const [w, ...others] = await core.findLines(' 0w ');
    expect(others).toEqual([]);
    expect(w).toMatchObject({ op: 'tec', mode: 'bus', line: 'W', routes: ['tec:TEC-W', 'tec:TEC-WR', 'tec:TEC-W-WAT'] });
    expect(w.ends.map((n) => n.fr)).toEqual(['Braine-l’Alleud Gare', 'Bruxelles Midi']);
    expect(w.nearest).toBeUndefined();
    expect((await core.findLines('W', MERBRAINE))[0].nearest).toEqual({ areaId: 'tec:Bbrlmer1', name: { fr: 'Braine-l’Alleud Merbraine', nl: 'Braine-l’Alleud Merbraine' }, distanceM: 0 });
    // sans position : par réseau puis par numéro ; avec position : la plus proche d'abord
    expect((await core.findLines('1')).map((m) => `${m.op} ${m.mode}`)).toEqual(['delijn tram', 'tec bus']);
    const mons = await core.findLines('1', { lat: 50.4545, lon: 3.952 });
    expect(mons.map((m) => `${m.op} ${m.nearest?.areaId}`)).toEqual(['tec tec:Hmogpl1', 'delijn delijn:200900']);
    // une boucle ou une ligne sans retour n'a qu'un terminus
    expect((await core.findLines('4')).map((m) => m.ends.map((n) => n.fr))).toEqual([['Stalle (P)'], ['Jambes']]);
    expect(await core.findLines('IC')).toEqual([]);
    expect(await core.findLines('')).toEqual([]);
    expect(await core.findLines('99')).toEqual([]);
  });

  it('lineStops : arrêts où l’on monte, dans l’ordre de la ligne, ou le plus proche d’abord', async () => {
    const core = fake(at(7, 31));
    const [w] = await core.findLines('w');
    expect((await core.lineStops(w)).map((s) => s.areaId)).toEqual(['tec:Bbrlgar1', 'tec:Bbrlmer1', 'tec:Bwategl1', 'tec:Bbxlmid1']);
    const near = await core.lineStops(w, MERBRAINE);
    expect(near.map((s) => [s.areaId, s.distanceM])).toEqual([
      ['tec:Bbrlmer1', 0],
      ['tec:Bbrlgar1', 1241],
      ['tec:Bwategl1', 3842],
      ['tec:Bbxlmid1', 17408],
    ]);
    // un terminus sans départ de la ligne n'est pas proposé (Stalle pour le tram 4)
    expect((await core.lineStops({ op: 'stib', line: '4', routes: [] })).map((s) => s.areaId)).toEqual(['stib:6357F', 'stib:6359', 'stib:6361', 'stib:6362', 'stib:6364']);
  });

  it('lineBoard : deux sens, passages partiels, temps réel, supprimé, terminus, introuvable', async () => {
    // 07:31 à Merbraine : W de 07:48 en retard de 3 min (temps réel), le partiel de 08:18 vers Waterloo Eglise
    const b = await fake(at(7, 31)).lineBoard('tec:Bbrlmer1', 'W', { perDirection: 3 });
    expect(b).toMatchObject({ state: 'ok', op: 'tec', mode: 'bus', line: 'W', anyPlanned: true, rtErrors: [] });
    expect(view(b)).toEqual(["Bruxelles Midi : 07:48+3, 08:08~, 08:18~ jusqu'à Waterloo Eglise", 'Braine-l’Alleud Gare : 07:42, 08:02~, 08:22~']);
    // 2 passages par sens par défaut
    expect((await fake(at(7, 10)).lineBoard('tec:Bbrlmer1', 'W')).directions.map((d) => d.departures.length)).toEqual([2, 2]);
    expect(view(await fake(at(7, 10)).lineBoard('tec:Bbrlmer1', 'W'))[0]).toBe("Bruxelles Midi : 07:18 jusqu'à Waterloo Eglise, 07:28");
    // 08:00 : le partiel de 08:18 est supprimé (il reste à sa place)
    expect(view(await fake(at(8, 0)).lineBoard('tec:Bbrlmer1', 'W'))[0]).toBe("Bruxelles Midi : 08:08, 08:18 supprimé jusqu'à Waterloo Eglise");
    // terminus : un seul sens ; tram 3 : deux sens ; tram 4 au départ : un seul
    expect(view(await fake(at(7, 31)).lineBoard('tec:Bbrlgar1', 'w'))).toEqual(["Bruxelles Midi : 07:44~, 08:04~"]);
    expect(view(await fake(at(8, 0)).lineBoard('tec:Bbrlgar1', 'W'))).toEqual(["Bruxelles Midi : 08:04~, 08:14~ jusqu'à Waterloo Eglise"]);
    const t3 = await fake(at(7, 31)).lineBoard('stib:6357F', '3');
    expect(view(t3)).toEqual(['Churchill : 07:32, 07:40', 'Esplanade : 07:36, 07:44']);
    expect(t3.anyPlanned).toBe(false);
    expect(view(await fake(at(7, 31)).lineBoard('stib:6357F', '4'))).toEqual(['Stalle (P) : 07:35, 07:43']);
    // ligne sans départ à l'arrêt : aucun passage (revue 1.2.2 : pas « introuvable ») ; arrêt inconnu : introuvable
    expect(await fake(at(7, 31)).lineBoard('stib:6357F', 'W')).toMatchObject({ state: 'none', directions: [], area: { id: 'stib:6357F' } });
    expect(await fake(at(7, 31)).lineBoard('stib:404', '3')).toMatchObject({ state: 'missing', directions: [], area: { id: 'stib:404' } });
    // temps réel coupé : horaires prévus, réseau signalé
    const down = await fake(at(7, 31), { noRt: true }).lineBoard('tec:Bbrlmer1', 'W');
    expect(down).toMatchObject({ anyPlanned: true, rtErrors: ['tec'] });
    expect(view(down)).toEqual(['Bruxelles Midi : 07:48~, 08:08~', 'Braine-l’Alleud Gare : 07:42~, 08:02~']);
  });

  it('gare ou ligne choisie dont la zone a changé d’identifiant : movedTo (aka, ou même nom avec near) ; sinon missing', async () => {
    const core = fake(at(7, 31));
    const GDN = { lat: 50.86004, lon: 4.36017, name: { fr: 'Gare du Nord', nl: 'Noordstation' } };
    // ancien identifiant (`aka` de Gare du Nord) : retrouvé, même sans near
    expect(await core.lineBoard('stib:6358', '3')).toMatchObject({ state: 'ok', movedTo: 'stib:6357F', area: { id: 'stib:6357F' } });
    expect(await core.board('stib:6358', { limit: 2 })).toMatchObject({ movedTo: 'stib:6357F', area: { id: 'stib:6357F' } });
    // identifiant inconnu, même nom à 150 m au plus autour de near : retrouvé
    const t3 = await core.lineBoard('stib:64', '3', { near: GDN });
    expect(t3).toMatchObject({ state: 'ok', movedTo: 'stib:6357F' });
    expect(view(t3)).toEqual(['Churchill : 07:32, 07:40', 'Esplanade : 07:36, 07:44']);
    expect((await core.board('stib:64', { limit: 2, near: GDN })).movedTo).toBe('stib:6357F');
    // identifiant actuel : ni movedTo ni missing
    const same = await core.board('stib:6357F', { limit: 2, near: GDN });
    expect([same.movedTo, same.missing]).toEqual([undefined, undefined]);
    expect(Object.keys(await core.lineBoard('stib:6357F', '3', { near: GDN }))).not.toContain('movedTo');
    // rien de ce nom : board missing avec near (sans exception), exception sans near ; lineBoard missing
    const gone = { ...GDN, name: { fr: 'Arrêt disparu', nl: 'Weg' } };
    expect(await core.board('stib:999999', { near: gone })).toMatchObject({ missing: true, departures: [], area: { id: 'stib:999999' } });
    await expect(core.board('stib:999999')).rejects.toMatchObject({ code: 'areaUnknown' });
    expect(await core.lineBoard('stib:999999', '3', { near: gone })).toMatchObject({ state: 'missing', directions: [] });
  });
});
