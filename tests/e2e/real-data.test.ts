/**
 * Données réelles, à la demande seulement (DECISIONS Q13) : l'instantané publié par le pipeline 1.1, servi en HTTP par
 * serve-data, le vrai relais branché sur le faux portail en scène noRT (sans temps réel), un vrai cœur neuf par
 * recherche. Cas réels : PRD-1.2.1 § 1.5 (CA-121.1, marche maximale 5 min) et contrôles de PRD-1.2 § 5 (CA-1.7,
 * CA-1.8, CA-1.10), avec le classement de PRD-1.2.2 § 7 (le premier arrive le plus tôt, chaque minute de marche au-delà
 * de la marche maximale compte triple), marche maximale 10 min, ou 5 min.
 *
 *   QUAI_REAL_DATA=/home/claude/real-data-11/data npx vitest run real-data
 *
 * Sans QUAI_REAL_DATA (intégration continue), la suite est sautée. Il faut un instantané 1.1 (meta.lines) qui couvre
 * le 11/11 et le 12/11/2026.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Meta } from '../../shared/types';
import { createCore } from '../../app/src/core/index';
import { DEFAULT_SETTINGS, type Endpoint, type Journey, type PlanResult, type Settings } from '../../app/src/core/api';
import { hhmm } from '../../app/src/core/util';
import { memoryKV, startStack, type Stack } from './lib/stack';

const DIR = process.env.QUAI_REAL_DATA === '1' ? '/home/claude/real-data-11/data' : (process.env.QUAI_REAL_DATA ?? '');
const meta = DIR && existsSync(join(DIR, 'meta.json')) ? (JSON.parse(readFileSync(join(DIR, 'meta.json'), 'utf8')) as Meta) : null;
const enabled = !!meta?.lines && meta.serviceDates.includes('2026-11-11') && meta.serviceDates.includes('2026-11-12');

const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+01:00`);
const pt = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });
const MADOU = pt('Madou', 50.8504, 4.3707);
const BRAINE = pt('Braine-l’Alleud Côté du Collège', 50.68634, 4.39427);
const WATERLOO = pt('Waterloo', 50.7175, 4.399);
const MAISON = pt('Namur Place Léopold', 50.4655, 4.859);
/** PRD-1.2.1 § 1.5 : cas réels, toujours avec des arrêts publics (jamais d'adresse personnelle dans le dépôt). */
const SCHAERBEEK = pt('Schaerbeek Gare', 50.87755, 4.37966);
const settings = (maxWalkMin = 10): Settings => ({ ...DEFAULT_SETTINGS, onboarded: true, maxWalkMin });
const plain = (s?: string) => (s ?? '').replace(/\u00a0/g, ' ');
const summary = (r: PlanResult) => r.journeys.map((j) => `${j.label} ${hhmm(j.dep)} → ${hhmm(j.arr)}`);
const lines = (j: Journey) => j.legs.filter((l) => l.kind === 'ride').map((l) => `${l.cat ?? l.line} ${l.from.name.fr} → ${l.to.name.fr}`);
/** Le bus 36 du TEC dans le mauvais sens (vers Rixensart), le trajet aberrant signalé par le propriétaire. */
const bus36Rixensart = (j: Journey) => j.legs.some((l) => l.kind === 'ride' && l.line === '36' && /rixensart/i.test(`${l.head?.fr ?? ''} ${l.to.name.fr}`));

let stack: Stack;
const timings: string[] = [];

/** Recherche sur un cœur neuf (fichiers lus en HTTP, rien en cache), temps mesuré. */
async function route(name: string, from: Endpoint, to: Endpoint, after: number, maxWalkMin = 10): Promise<PlanResult> {
  const core = createCore({ dataBase: stack.data.url, relayBase: stack.relay.url, now: () => after, storage: memoryKV(), fetch });
  await core.init();
  const t0 = performance.now();
  const r = await core.route(from, to, after, settings(maxWalkMin));
  const ms = Math.round(performance.now() - t0);
  timings.push(`${name} : ${ms} ms`);
  expect(ms, `${name} : ${ms} ms`).toBeLessThan(8_000);
  expect(r.journeys.length, name).toBeGreaterThan(0);
  expect(r.journeys[0].label, name).toBe('short');
  return r;
}

describe.skipIf(!enabled)('données réelles (instantané 1.1 servi en HTTP) : cas réels, PRD-1.2.1 § 1.5 et PRD-1.2 § 5', () => {
  beforeAll(async () => {
    stack = await startStack({ dataDir: DIR });
    await stack.scene('noRT');
  }, 120_000);
  afterAll(async () => {
    console.log(`temps de calcul (cœur neuf, HTTP local) :\n  ${timings.join('\n  ')}`);
    await stack?.stop();
  });

  it('CA-121.1 (§ 1.5) : Braine-l’Alleud → Schaerbeek Gare, 11/11 19:42, marche 5 : bus W puis S1 ; 22 min à pied, IC 20:08, IC 20:33 seulement en « Plus tôt »', async () => {
    const r = await route('Braine-l’Alleud → Schaerbeek 11/11 19:42, marche 5', BRAINE, SCHAERBEEK, at('2026-11-11', '19:42'), 5);
    expect(summary(r)).toEqual(['short 19:57 → 21:05', 'earlier 19:44 → 20:52', 'next 20:39 → 22:01']);
    expect(lines(r.journeys[0])).toEqual(["W Braine-l’Alleud Bonne Fosse → Braine-l'Alleud, Gare", "S1 Braine-l'Alleud → Schaerbeek"]);
    // « Le suivant » (garde, PRD-1.2.2 § 7.4) : le bus W puis le tram 92 (20:39 → 22:01) domine le bus W puis le S1
    // suivant (20:27 → 22:05 : partir plus tôt pour arriver plus tard, mêmes marches)
    expect(lines(r.journeys[2])).toEqual(['W Braine-l’Alleud Bonne Fosse → Saint-Gilles Ma Campagne', '92 Ma Campagne → Schaerbeek Gare']);
    expect(plain(r.journeys[2].reason)).toBe('Le suivant : 42 min plus tard');
    expect(r.journeys[1].legs[0]).toMatchObject({ kind: 'walk', walkMin: 22 });
    expect(r.journeys[1].legs.filter((l) => l.kind === 'ride').map((l) => `${l.cat} ${hhmm(l.dep)}`)).toEqual(['IC 20:08', 'IC 20:33']);
    // PRD-1.2.1 § 2 : « Plus tôt » marche plus (22 min) : la proposition 1 s'affiche « Moins de marche »
    expect(r.journeys.slice(0, 2).map((j) => plain(j.reason))).toEqual(['Moins de marche : 1 changement, à pied 8 + 1 + 3 min', 'Plus tôt de 13 min, mais 22 min à pied']);
    // PRD-1.2.2 § 7 : la longue marche jusqu'à la gare n'apparaît qu'en « Plus tôt »
    for (const j of r.journeys) if (j.label !== 'earlier') expect(Math.max(...j.legs.map((l) => (l.kind === 'walk' ? (l.walkMin ?? 0) : 0)))).toBeLessThan(15);
    for (const j of r.journeys) expect((j.reason ?? '').length).toBeLessThanOrEqual(60);
  });

  it('CA-121.1 (§ 1.5) : Braine-l’Alleud → Madou, 12/11 07:31, marche 5 : bus 36, IC 08:01, métro 2 (07:49 → 08:33)', async () => {
    const r = await route('Braine-l’Alleud → Madou 12/11 07:31, marche 5', BRAINE, MADOU, at('2026-11-12', '07:31'), 5);
    expect(summary(r)[0]).toBe('short 07:49 → 08:33');
    expect(lines(r.journeys[0])).toEqual(['36 Braine-l’Alleud Côté du Collège → Braine-l’Alleud Vallée Bailly', "IC Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
    expect(hhmm(r.journeys[0].legs.find((l) => l.cat === 'IC')!.dep)).toBe('08:01');
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 2 changements, à pied 4 + 3 + 2 min');
    // PRD-1.2.2 § 7 : l'IC après 22 min à pied (même arrivée) marche plus au-delà de la marche maximale : jamais « Moins
    // de changements » ; « Plus tard » : bus 36 de 07:54, S1 08:06 et métro 2 (3 min à pied au plus), puis bus 39 et IC
    expect(summary(r).slice(1)).toEqual(['later 07:54 → 08:50', 'later 08:14 → 09:01']);
    expect(lines(r.journeys[1])).toEqual(["36 Braine-l’Alleud Côté du Collège → Braine-l'Alleud, Gare", "S1 Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
    expect(r.journeys[1].legs.filter((l) => l.kind === 'ride').map((l) => hhmm(l.dep)).slice(0, 2)).toEqual(['07:54', '08:06']);
    expect(Math.max(...r.journeys[1].legs.map((l) => (l.kind === 'walk' ? (l.walkMin ?? 0) : 0)))).toBe(3);
    expect(plain(r.journeys[1].reason)).toBe('Plus tard : 2 changements, départ 07:54');
    expect(r.journeys.filter(bus36Rixensart)).toEqual([]);
  });

  it('CA-121.1 (§ 1.5) : Braine-l’Alleud Côté du Collège → Madou, 11/11 13:30, marche 5 : bus W, métro 2 ; « Plus tôt » : 22 min à pied et l’IC', async () => {
    const r = await route('Braine-l’Alleud → Madou 11/11 13:30, marche 5 (1.2.1)', BRAINE, MADOU, at('2026-11-11', '13:30'), 5);
    expect(summary(r).slice(0, 2)).toEqual(['short 13:39 → 14:47', 'earlier 13:44 → 14:39']);
    expect(lines(r.journeys[0])).toEqual(['W Braine-l’Alleud Bonne Fosse → Saint-Gilles Porte de Hal Metro', '2 Porte de Hal → Madou']);
    expect(r.journeys[1].legs[0]).toMatchObject({ kind: 'walk', walkMin: 22 });
    expect(r.journeys[1].legs.find((l) => l.kind === 'ride')?.cat).toBe('IC');
    expect(r.journeys.slice(0, 2).map((j) => plain(j.reason))).toEqual(['Moins de marche : 1 changement, à pied 8 + 1 + 2 min', 'Plus tôt de 8 min, mais 22 min à pied']);
    expect(r.journeys.filter(bus36Rixensart)).toEqual([]);
  });

  it('CA-1.10 : Braine-l’Alleud Côté du Collège → Madou, 11/11 13:30, marche 5 et 10 : bus W et métro 2, jamais le bus 36 vers Rixensart', async () => {
    for (const m of [5, 10]) {
      const r = await route(`Braine-l’Alleud → Madou 11/11 13:30, marche ${m}`, BRAINE, MADOU, at('2026-11-11', '13:30'), m);
      expect(summary(r)[0], `marche ${m}`).toBe('short 13:39 → 14:47');
      // PRD-1.2.1 § 2 : « Plus tôt » (22 min à pied et l'IC) marche plus : « Moins de marche »
      expect(plain(r.journeys[0].reason)).toBe('Moins de marche : 1 changement, à pied 8 + 1 + 2 min');
      expect(lines(r.journeys[0])).toEqual(['W Braine-l’Alleud Bonne Fosse → Saint-Gilles Porte de Hal Metro', '2 Porte de Hal → Madou']);
      expect(r.journeys.filter(bus36Rixensart).map((j) => j.label), `marche ${m}`).toEqual([]);
    }
  });

  it('CA-1.10 : même départ le 12/11 à 07:31 : bus 36 vers la gare (pas vers Rixensart), IC 08:01 jusqu’à Bruxelles-Midi, métro 2', async () => {
    const r = await route('Braine-l’Alleud → Madou 12/11 07:31', BRAINE, MADOU, at('2026-11-12', '07:31'));
    expect(summary(r)[0]).toBe('short 07:49 → 08:33');
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 2 changements, à pied 4 + 3 + 2 min');
    expect(lines(r.journeys[0])).toEqual(['36 Braine-l’Alleud Côté du Collège → Braine-l’Alleud Vallée Bailly', "IC Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
    expect(hhmm(r.journeys[0].legs.find((l) => l.cat === 'IC')!.dep)).toBe('08:01');
    expect(r.journeys.filter(bus36Rixensart)).toEqual([]);
  });

  it('CA-1.7 : Waterloo → Madou, 12/11 07:31 : bus W, IC depuis Braine-l’Alleud, métro 2 ; le P et 19 min à pied « Plus tôt » ; jamais le S1 vers Congrès', async () => {
    const r = await route('Waterloo → Madou 12/11 07:31', WATERLOO, MADOU, at('2026-11-12', '07:31'));
    expect(summary(r).slice(0, 2)).toEqual(['short 07:34 → 08:33', 'earlier 07:29 → 08:27']);
    expect(r.journeys[2]?.label).toBe('next');
    // PRD-1.2.1 § 2 : « Plus tôt » marche plus (19 min) : la proposition 1 s'affiche « Moins de marche »
    expect(plain(r.journeys[0].reason)).toBe('Moins de marche : 2 changements, 8 min à pied');
    expect(lines(r.journeys[0])).toEqual(["W Waterloo Eglise → Braine-l'Alleud, Gare", "IC Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
    expect(plain(r.journeys[1].reason)).toBe('Plus tôt de 6 min, mais 19 min à pied');
    expect(r.journeys[1].legs.find((l) => l.kind === 'ride')?.cat).toBe('P');
    expect(r.journeys.some((j) => j.legs.some((l) => l.to.areaId === 'sncb:8813045' || l.from.areaId === 'sncb:8813045'))).toBe(false);
  });

  it('CA-1.8 : Namur Place Léopold → Madou, 12/11 07:31 : IC jusqu’à Bruxelles-Luxembourg, bus 12, métro 2 ; « Moins de changements »', async () => {
    const r = await route('Namur → Madou 12/11 07:31', MAISON, MADOU, at('2026-11-12', '07:31'));
    expect(summary(r)).toEqual(['short 07:34 → 08:44', 'fewer 07:34 → 08:52', 'next 08:06 → 09:18']);
    // « Le suivant » (garde, PRD-1.2.2 § 7.4) : l'IC suivant puis le bus 64 (09:18) plutôt que le bus 12 (09:30)
    expect(lines(r.journeys[2])).toEqual(['IC Namur → Bruxelles-Luxembourg', '64 Luxembourg → Trône', '2 Trône → Madou']);
    expect(r.journeys.map((j) => plain(j.reason)).slice(0, 2)).toEqual(['Le plus court : 2 changements, à pied 8 + 1 + 2 min', 'Moins de changements : 1 changement, à pied 8 + 2 + 10 min']);
    expect(lines(r.journeys[0])).toEqual(['IC Namur → Bruxelles-Luxembourg', '12 Luxembourg → Trône', '2 Trône → Madou']);
  });
});
