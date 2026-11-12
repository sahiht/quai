/**
 * Critères d'acceptation sur les fixtures (fixtures/network.json étendu, fichiers de ligne générés) : PRD 1.1 CA-M2.1,
 * CA-M2.2, CA-M2.5, CA-M2.7, CA-M3.1, CA-M3.3, CA-M5.1 à CA-M5.7 avec « Le plus court » (PRD-1.2 CA-1.3 et CA-1.6) ;
 * PRD-1.2 CA-1.4 (Rue Neuve 1) et CA-1.5 (Waterloo, cas H), revus pour PRD-1.2.2 § 7 (le premier arrive le plus tôt,
 * chaque minute de marche au-delà de la marche maximale compte triple) et PRD-1.2.1 § 2 (noms et raisons). Ce calcul
 * fait foi (valeurs du rapport du routage).
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

/**
 * Invariants de toute réponse (CA-M3.1) : 3 au plus, sans doublon, aucun véhicule supprimé, étiquette et raison
 * (1.2.1 § 2.2 : « {nom} : … », sauf « Plus tôt de 13 min, … » ; 60 caractères au plus).
 */
function check(r: PlanResult): PlanResult {
  expect(r.journeys.length).toBeLessThanOrEqual(3);
  expect(new Set(r.journeys.map((j) => j.id)).size).toBe(r.journeys.length);
  for (const j of r.journeys) {
    expect(j.legs.some((l) => l.kind === 'ride' && l.cancelled)).toBe(false);
    expect(j.label).toBeTruthy();
    expect(j.reason).toMatch(j.label === 'earlier' ? /^Plus tôt de \d+ (min|h), / : /^\S.* : /);
    expect(j.reason).not.toMatch(/[–—]/);
    expect(j.reason!.length).toBeLessThanOrEqual(60);
  }
  return r;
}

describe('CA-M2 : trajet du matin (S1 → Bureau, 10/11 07:31)', () => {
  it('CA-M2.2 et CA-1.3, scène noRT (1.2.2) : IC puis T3 d’abord ; le direct et ses 12 min à pied jamais « Sans changement » ; « Le suivant » : l’IC 08:42 puis le T4, qui domine l’IC 08:42 puis le T3', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const r = check(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, S1));
    // 1.2.2 (PRD-1.2.2 § 7) : le même IC et la même arrivée ; le T3 depuis Bruxelles-Nord garde chaque marche dans les
    // 10 min réglées (coût 08:58 + 1 changement), l'IC direct puis 12 min à pied en a 2 de trop (08:58 + 6 min) ; il
    // marche plus que la proposition 1 au-delà de la marche maximale : jamais « Sans changement »
    expect(labels(r)).toEqual(['short', 'next']);
    // garde (PRD-1.2.2 § 7.4) : l'IC 08:42 puis le T3 de 09:48 (08:33 → 10:02) est dominé par l'IC 08:42 puis le T4 de
    // 09:43 (même départ, arrivée 09:57, mêmes marches, même changement) : ce trajet prend sa place de « Le suivant »
    expect(r.journeys.map(times)).toEqual(['07:33 → 08:58', '08:33 → 09:57']);
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Nord 08:40 | marche 2 | 08:44 T3 Gare du Nord → Bourse 08:49 | marche 9');
    expect(legsOf(r.journeys[1])).toBe('marche 7 | 08:42 IC Namur → Bruxelles-Nord 09:40 | marche 2 | 09:43 T4 Gare du Nord → Bourse 09:48 | marche 9');
    // d'autres lignes que la proposition 1 : pas « même trajet »
    expect(r.journeys.map((j) => plain(j.reason))).toEqual(['Le plus court : 1 changement, à pied 7 + 2 + 9 min', 'Le suivant : 1 h plus tard']);
    const ic = r.journeys[1].legs[1];
    expect([hhmm(ic.dep), ic.cat, ic.head?.fr, ic.platform, ic.rt]).toEqual(['08:42', 'IC', 'Bruxelles-Midi', '5', false]);
    // plan() de la 1.0 : les mêmes propositions
    expect((await core.plan(here, bureau, atTime('2026-11-10T07:31'), preset, S1)).map((j) => j.id)).toEqual(r.journeys.map((j) => j.id));
  });

  it('CA-M2.1, scène base (1.2.2) : 07:35 → 08:58 par Bruxelles-Nord et le T3, l’alerte de voie en tête, étiquette « short »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const r = check(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, S1));
    // l'IC a 2 min de retard : le T3 de 08:44 reste attrapable ; le direct (09:00, 2 min de marche de trop) n'est pas proposé
    expect(times(r.journeys[0])).toBe('07:35 → 08:58');
    expect(r.journeys[0].label).toBe('short');
    expect(plain(r.journeys[0].alerts[0]?.text)).toBe('! Voie modifiée : l’IC part de la voie 6');
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:44 IC Namur → Bruxelles-Nord 08:42 | marche 2 | 08:44 T3 Gare du Nord → Bourse 08:49 | marche 9');
    expect(labels(r)).not.toContain('none');
  });

  it('CA-M2.7 : trajet entièrement à pied (50.8480, 4.3520) ; à 280 m du Bureau : « Tu es déjà au bureau. »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const r = check(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, { lat: 50.848, lon: 4.352 }));
    expect(r.journeys).toHaveLength(1);
    expect(r.journeys[0].legs).toHaveLength(1);
    expect(r.journeys[0]).toMatchObject({ label: 'short', transfers: 0 });
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : à pied, 9 min');
    expect(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, { lat: 50.846, lon: 4.35 })).toEqual({ journeys: [], empty: 'here' });
    expect(await core.route(here, bureau, atTime('2026-11-10T07:31'), preset, null)).toEqual({ journeys: [], empty: 'noPosition' });
  });
});

describe('CA-M3 et CA-M2.5 : vers Gand-Saint-Pierre (S3, 13:55, scène base)', () => {
  it('CA-M3.3 et CA-1.6 : le plus court 14:10, puis le suivant 14:22 (+3 min), puis « Plus tard » 14:40 (« Le suivant » une seule fois)', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    const fav = preset.favorites.find((f) => f.id === 'fav-gand');
    if (fav?.kind !== 'trip') throw new Error('preset');
    const r = check(await core.route(fav.from, fav.to, atTime('2026-11-10T13:55'), preset, S3));
    expect(labels(r)).toEqual(['short', 'next', 'later']);
    expect(r.journeys.map((j) => `${hhmm(j.legs[0].schedDep)} ${hhmm(j.legs[0].dep)}`)).toEqual(['14:10 14:10', '14:22 14:25', '14:40 14:40']);
    // CA-M2.5 : pas de marche au début ; « Le plus court : direct » ; le suivant 14:25 → 14:56
    expect(r.journeys.map(times)).toEqual(['14:10 → 14:39', '14:25 → 14:56', '14:40 → 15:09']);
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : direct');
    expect(plain(r.journeys[1].reason)).toBe('Le suivant : même trajet, 12 min plus tard');
    expect(plain(r.journeys[2].reason)).toBe('Plus tard : direct, départ 14:40');
    expect(r.journeys[0].legs[0]).toMatchObject({ cat: 'IC', head: { fr: 'Bruges' }, platform: '4', to: { areaId: 'sncb:8892007' } });
  });

  it('CA-1.4 : vers Rue Neuve 1 (S1, noRT) : Bruxelles-Nord et T3, 5 min plus tôt, d’abord ; le direct « Sans changement »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const r = check(await core.route(here, RUE_NEUVE, atTime('2026-11-10T07:31'), preset, S1));
    expect(labels(r)).toEqual(['short', 'none', 'next']);
    // « Le suivant » : l'IC 08:42 puis le T4 de 09:43 (09:50), qui domine l'IC 08:42 puis le T3 de 09:48 (09:55)
    expect(r.journeys.map(times)).toEqual(['07:33 → 08:51', '07:33 → 08:56', '08:33 → 09:50']);
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Nord 08:40 | marche 2 | 08:44 T3 Gare du Nord → De Brouckere 08:48 | marche 3');
    expect(legsOf(r.journeys[1])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Central 08:46 | marche 10');
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 1 changement, à pied 7 + 2 + 3 min');
    expect(plain(r.journeys[1].reason)).toBe('Sans changement : à pied 7 + 10 min');
    // CA-M5.1 : au moins deux propositions, jamais « Aucun trajet trouvé »
    expect(r.empty).toBeUndefined();
  });

  it('CA-1.5 et CA-M5.5 (1.2.2) : Waterloo (cas H) : bus W puis métro d’abord (« Moins de marche »), 19 min à pied et le S1 « Plus tôt »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const r = check(await core.route(WATERLOO, ROGIER, atTime('2026-11-10T07:31'), preset));
    // 1.2.2 : le S1 arrive 16 min plus tôt, mais ses 19 min à pied en ont 9 de trop (27 min) : « Plus tôt »
    expect(labels(r)).toEqual(['short', 'earlier', 'next']);
    expect(legsOf(r.journeys[0])).toBe('marche 2 | 07:36 W Waterloo Eglise → Bruxelles Midi 08:21 | marche 2 | 08:29 M2 Gare du Midi → Rogier 08:43 | marche 3');
    expect(legsOf(r.journeys[1])).toBe('marche 19 | 07:55 S1 Waterloo → Bruxelles-Nord 08:25 | marche 5');
    expect(plain(r.journeys[0].reason)).toBe('Moins de marche : 1 changement, à pied 2 + 2 + 3 min');
    expect(plain(r.journeys[1].reason)).toBe('Plus tôt de 16 min, mais 19 min à pied');
    expect(r.journeys.map(times)).toEqual(['07:32 → 08:46', '07:34 → 08:30', '07:52 → 09:04']);
  });
});

describe('CA-M5 : porte à porte', () => {
  it('CA-M5.2 : S2 vers le boulevard du Centenaire : Rogier puis M6, « direct, à pied 6 + 1 min »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T12:10' });
    const r = check(await core.route(here, CENTENAIRE, atTime('2026-11-10T12:10'), preset, S2));
    expect(legsOf(r.journeys[0])).toBe('marche 6 | 12:25 M6 Rogier → Roi Baudouin 12:39 | marche 1');
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : direct, à pied 6 + 1 min');
    expect(hhmm(r.journeys[0].arr)).toBe('12:40');
  });

  it('CA-M5.3 : Uccle 08:00 : T3 jusqu’à Rogier puis M6 (la 1.0 ne trouve rien)', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T08:00', scene: 'noRT' });
    const r = check(await core.route(UCCLE, CENTENAIRE, atTime('2026-11-10T08:00'), preset));
    expect(legsOf(r.journeys[0])).toBe('marche 2 | 08:09 T3 Churchill → Rogier 08:30 | 08:35 M6 Rogier → Roi Baudouin 08:49 | marche 1');
    // à confirmer dans le PRD (« 2 + 1 + 1 ») : Rogier est une seule zone (correspondance sans marche)
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 1 changement, à pied 2 + 1 min');
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
    expect(plain(j.reason)).toBe('Le plus court : 1 changement, à pied 1 + 3 min');
    const k = check(await core.route(here, KORENMARKT, atTime('2026-11-10T13:55'), preset, S3));
    expect(legsOf(k.journeys[0])).toBe('14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 | marche 1 | 14:44 T1 Gand-Saint-Pierre → Korenmarkt, Gand 14:54');
  });

  it('CA-M5.6 : Bastogne, aucun arrêt dans la recherche élargie : noStopTo (accessMin 15, PRD-1.2 § 1.4) ; aucun trajet : la gare la plus proche', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    expect(await core.route(here, addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), atTime('2026-11-10T13:55'), preset, S3)).toEqual({ journeys: [], empty: 'noStopTo', accessMin: 15 });
    expect(await core.route(addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), here, atTime('2026-11-10T13:55'), preset, S3)).toEqual({ journeys: [], empty: 'noStopFrom', accessMin: 15 });
    // marche maximale de 20 min : la recherche s'étend à 25 min, le texte aussi
    expect(await core.route(here, addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715), atTime('2026-11-10T13:55'), { ...preset, maxWalkMin: 20 }, S3)).toEqual({ journeys: [], empty: 'noStopTo', accessMin: 25 });
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
