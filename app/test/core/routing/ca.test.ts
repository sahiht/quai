/**
 * Critères d'acceptation du PRD sur les fixtures (fixtures/network.json étendu, fichiers de ligne générés) :
 * CA-M2.1, CA-M2.2, CA-M2.5, CA-M2.7, CA-M3.1, CA-M3.3, CA-M3.4, CA-M3.5, CA-M5.1 à CA-M5.7, cas à trois pages.
 * Heures « à confirmer » du PRD : ce calcul fait foi (valeurs relevées dans le rapport du routage).
 */
import { describe, expect, it } from 'vitest';
import type { Endpoint, Journey, PlanResult, Settings } from '../../../src/core/api';
import { hhmm } from '../../../src/core/util';
import { makeEnv } from '../support/env';
import { at as atTime } from '../support/network';
import { legsOf, plain } from './support';

const S1 = { lat: 50.4655, lon: 4.859 };
const S2 = { lat: 50.86, lon: 4.359 };
const S3 = { lat: 50.8454, lon: 4.3571 };
const here: Endpoint = { type: 'here' };
const bureau: Endpoint = { type: 'place', placeId: 'bureau' };
const addr = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });
const RUE_NEUVE = addr('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545);
const CENTENAIRE = addr('Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334);
const UCCLE = addr('Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365);
const VELDSTRAAT = addr('Veldstraat 1, 9000 Gent', 51.0537, 3.7225);
const WATERLOO = addr('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399);
const ROGIER = addr('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36);
const KORENMARKT: Endpoint = { type: 'area', areaId: 'delijn:200101', op: 'delijn', name: { fr: 'Korenmarkt, Gand', nl: 'Gent Korenmarkt' }, lat: 51.05472, lon: 3.72145 };

const times = (j: Journey) => `${hhmm(j.dep)} → ${hhmm(j.arr)}`;
const labels = (r: PlanResult) => r.journeys.map((j) => j.label);

/** Invariants de toute réponse (CA-M3.1) : 3 au plus, sans doublon, aucun véhicule supprimé, étiquette et raison. */
function check(r: PlanResult): PlanResult {
  expect(r.journeys.length).toBeLessThanOrEqual(3);
  expect(new Set(r.journeys.map((j) => j.id)).size).toBe(r.journeys.length);
  for (const j of r.journeys) {
    expect(j.legs.some((l) => l.kind === 'ride' && l.cancelled)).toBe(false);
    expect(j.label).toBeTruthy();
    expect(j.reason).toMatch(/^\S.* : /);
    expect(j.reason).not.toMatch(/[–—]/);
  }
  return r;
}

describe('CA-M2 : trajet du matin (S1 → Bureau, 10/11 07:31)', () => {
  it('CA-M2.2, scène noRT : « direct, à pied 7 + 12 min » puis « Le suivant » 08:33 → 09:58 ; deux propositions le 10/11', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const r = check(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, S1));
    expect(labels(r)).toEqual(['simple', 'next']);
    expect(r.journeys.map(times)).toEqual(['07:33 → 08:58', '08:33 → 09:58']);
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : direct, à pied 7 + 12 min');
    expect(plain(r.journeys[1].reason)).toBe('Le suivant : même trajet, 1 h plus tard');
    const ic = r.journeys[1].legs[1];
    expect([hhmm(ic.dep), ic.cat, ic.head?.fr, ic.platform, ic.rt]).toEqual(['08:42', 'IC', 'Bruxelles-Midi', '5', false]);
    // plan() de la 1.0 : les mêmes propositions
    expect((await core.plan(here, bureau, atTime('2026-11-10T07:31'), preset, S1)).map((j) => j.id)).toEqual(r.journeys.map((j) => j.id));
  });

  it('CA-M2.1, scène base : 07:35 → 09:00, l’alerte de voie en tête, étiquette « simple »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const r = check(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, S1));
    expect(times(r.journeys[0])).toBe('07:35 → 09:00');
    expect(r.journeys[0].label).toBe('simple');
    expect(plain(r.journeys[0].alerts[0]?.text)).toBe('! Voie modifiée : l’IC part de la voie 6');
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:44 IC Namur → Bruxelles-Central 08:48 | marche 12');
  });

  it('CA-M2.7 : trajet entièrement à pied (50.8480, 4.3520) ; à 280 m du Bureau : « Tu es déjà au bureau. »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const r = check(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, { lat: 50.848, lon: 4.352 }));
    expect(r.journeys).toHaveLength(1);
    expect(r.journeys[0].legs).toHaveLength(1);
    expect(r.journeys[0]).toMatchObject({ label: 'simple', transfers: 0 });
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : à pied, 9 min');
    expect(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, { lat: 50.846, lon: 4.35 })).toEqual({ journeys: [], empty: 'here' });
    expect(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, null)).toEqual({ journeys: [], empty: 'noPosition' });
  });
});

describe('CA-M3 et CA-M2.5 : vers Gand-Saint-Pierre (S3, 13:55, scène base)', () => {
  it('CA-M3.3 : simple 14:10, puis le suivant 14:22 (+3 min) et 14:40 ; pas de « Le plus rapide »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    const fav = preset.favorites.find((f) => f.id === 'fav-gand');
    if (fav?.kind !== 'trip') throw new Error('preset');
    const r = check(await core.route(fav.from, fav.to, atTime('2026-11-10T13:55'), preset, S3));
    expect(labels(r)).toEqual(['simple', 'next', 'next']);
    expect(r.journeys.map((j) => `${hhmm(j.legs[0].schedDep)} ${hhmm(j.legs[0].dep)}`)).toEqual(['14:10 14:10', '14:22 14:25', '14:40 14:40']);
    // CA-M2.5 : pas de marche au début ; « Le plus simple : direct » ; le suivant 14:25 → 14:56
    expect(r.journeys.map(times)).toEqual(['14:10 → 14:39', '14:25 → 14:56', '14:40 → 15:09']);
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : direct');
    expect(plain(r.journeys[1].reason)).toBe('Le suivant : même trajet, 12 min plus tard');
    expect(plain(r.journeys[2].reason)).toBe('Le suivant : même trajet, 18 min plus tard');
    expect(r.journeys[0].legs[0]).toMatchObject({ cat: 'IC', head: { fr: 'Bruges' }, platform: '4', to: { areaId: 'sncb:8892007' } });
  });

  it('CA-M3.4 : vers Rue Neuve 1 (S1, noRT) : simple Bruxelles-Central + 10 min, rapide Bruxelles-Nord + T3, 5 min plus tôt', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const r = check(await core.route(here, RUE_NEUVE, atTime('2026-11-10T07:31'), preset, S1));
    expect(labels(r)).toEqual(['simple', 'fast', 'next']);
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Central 08:46 | marche 10');
    expect(hhmm(r.journeys[0].arr)).toBe('08:56');
    expect(legsOf(r.journeys[1])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Nord 08:40 | marche 2 | 08:44 T3 Gare du Nord → De Brouckere 08:48 | marche 3');
    expect(hhmm(r.journeys[1].arr)).toBe('08:51');
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : direct, à pied 7 + 10 min');
    expect(plain(r.journeys[1].reason)).toBe('Le plus rapide : 5 min plus tôt, 1 changement');
    // CA-M5.1 : au moins deux propositions, jamais « Aucun trajet trouvé »
    expect(r.empty).toBeUndefined();
  });

  it('CA-M3.5 et CA-M5.5 : Waterloo (cas H) : bus W puis métro d’abord, marche puis train « Le plus rapide »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const r = check(await core.route(WATERLOO, ROGIER, atTime('2026-11-10T07:31'), preset));
    expect(labels(r)).toEqual(['simple', 'fast', 'next']);
    expect(legsOf(r.journeys[0])).toBe('marche 2 | 07:36 W WATERLOO Eglise → BRUXELLES Midi 08:21 | marche 2 | 08:29 M2 Gare du Midi → Rogier 08:43 | marche 3');
    expect(legsOf(r.journeys[1])).toBe('marche 19 | 07:55 S1 Waterloo → Bruxelles-Nord 08:25 | marche 5');
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : 1 changement, à pied 2 + 2 + 3 min');
    expect(plain(r.journeys[1].reason)).toBe('Le plus rapide : 16 min plus tôt, direct');
    expect(r.journeys.map(times)).toEqual(['07:32 → 08:46', '07:34 → 08:30', '07:52 → 09:04']);
  });
});

describe('CA-M5 : porte à porte', () => {
  it('CA-M5.2 : S2 vers le boulevard du Centenaire : Rogier puis M6, « direct, à pied 6 + 1 min »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T12:10' });
    const r = check(await core.route(here, CENTENAIRE, atTime('2026-11-10T12:10'), preset, S2));
    expect(legsOf(r.journeys[0])).toBe('marche 6 | 12:25 M6 Rogier → Roi Baudouin 12:39 | marche 1');
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : direct, à pied 6 + 1 min');
    expect(hhmm(r.journeys[0].arr)).toBe('12:40');
  });

  it('CA-M5.3 : Uccle 08:00 : T3 jusqu’à Rogier puis M6 (la 1.0 ne trouve rien)', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T08:00', scene: 'noRT' });
    const r = check(await core.route(UCCLE, CENTENAIRE, atTime('2026-11-10T08:00'), preset));
    expect(legsOf(r.journeys[0])).toBe('marche 2 | 08:09 T3 Churchill → Rogier 08:30 | 08:35 M6 Rogier → Roi Baudouin 08:49 | marche 1');
    // à confirmer dans le PRD (« 2 + 1 + 1 ») : Rogier est une seule zone (correspondance sans marche)
    expect(plain(r.journeys[0].reason)).toBe('Le plus simple : 1 changement, à pied 2 + 1 min');
    expect(hhmm(r.journeys[0].arr)).toBe('08:50');
  });

  it('CA-M5.4 : S3 vers Veldstraat 1 (2,1 km de Gand-Saint-Pierre) : train puis tram 1, et vers l’arrêt Korenmarkt', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    const r = check(await core.route(here, VELDSTRAAT, atTime('2026-11-10T13:55'), preset, S3));
    const j = r.journeys[0];
    expect(legsOf(j)).toBe('14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 | marche 1 | 14:44 T1 Gand-Saint-Pierre → Korenmarkt, Gand 14:54 | marche 3');
    expect([hhmm(j.legs[1].dep), hhmm(j.legs[2].dep), hhmm(j.legs[2].arr), hhmm(j.arr)]).toEqual(['14:39', '14:44', '14:54', '14:57']);
    expect(j.legs[2]).toMatchObject({ op: 'delijn', line: '1', head: { fr: 'Korenmarkt' }, fromStop: '200553', toStop: '200101', tripId: '700011438' });
    expect(j.legs[2].stops?.map((s) => s.name.fr)).toEqual(['Gand-Saint-Pierre', 'Korenmarkt, Gand']);
    expect(plain(j.reason)).toBe('Le plus simple : 1 changement, à pied 1 + 3 min');
    const k = check(await core.route(here, KORENMARKT, atTime('2026-11-10T13:55'), preset, S3));
    expect(legsOf(k.journeys[0])).toBe('14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 | marche 1 | 14:44 T1 Gand-Saint-Pierre → Korenmarkt, Gand 14:54');
  });

  it('CA-M5.6 : Bastogne, aucun arrêt à 20 min : noStopTo (accessMin 20) ; aucun trajet : la gare la plus proche', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    expect(await core.route(here, addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), atTime('2026-11-10T13:55'), preset, S3)).toEqual({ journeys: [], empty: 'noStopTo', accessMin: 20 });
    expect(await core.route(addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), here, atTime('2026-11-10T13:55'), preset, S3)).toEqual({ journeys: [], empty: 'noStopFrom', accessMin: 20 });
    // Nivelles 07:00 vers Jambes : le soir seulement vers Namur (attente de plus de 60 min) : pas de trajet complet
    const nivelles: Endpoint = { type: 'area', areaId: 'sncb:8883006', op: 'sncb', name: { fr: 'Nivelles', nl: 'Nijvel' }, lat: 50.5996, lon: 4.3289 };
    const r = await core.route(nivelles, addr('Place de la Wallonie, 5100 Jambes', 50.4593, 4.8733), atTime('2026-11-10T07:00'), preset);
    expect(r).toMatchObject({ journeys: [], empty: 'noTrip', station: { areaId: 'sncb:8863008', name: { fr: 'Namur' } } });
  });

  it('CA-M5.7 : 2 s au plus par recherche (fixtures)', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const cases: [Endpoint, Endpoint, string, { lat: number; lon: number } | undefined][] = [
      [here, bureau, '07:31', S1],
      [here, RUE_NEUVE, '07:31', S1],
      [WATERLOO, ROGIER, '07:31', undefined],
      [UCCLE, CENTENAIRE, '08:00', undefined],
      [here, VELDSTRAAT, '13:55', S3],
      [here, CENTENAIRE, '12:10', S2],
      [here, bureau, '23:50', S1],
    ];
    for (const [from, to, hm, pos] of cases) {
      const t0 = performance.now();
      const r = await env.core.route(from, to, atTime(`2026-11-10T${hm}`), env.preset as Settings, pos);
      const ms = performance.now() - t0;
      expect(r.journeys.length).toBeGreaterThan(0);
      expect(ms).toBeLessThan(2000);
    }
  });
});
