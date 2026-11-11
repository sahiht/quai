/**
 * Données réelles, à la demande seulement (DECISIONS Q13) : l'instantané publié par le pipeline 1.1, servi en HTTP par
 * serve-data, le vrai relais branché sur le faux portail en scène noRT (sans temps réel), un vrai cœur neuf par
 * recherche. Cas du propriétaire et contrôles de PRD-1.2 § 5 (CA-1.7, CA-1.8, CA-1.10), réglages v3 (marche maximale
 * 10 min, ou 5 min).
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

describe.skipIf(!enabled)('données réelles (instantané 1.1 servi en HTTP) : cas du propriétaire, PRD-1.2 § 5', () => {
  beforeAll(async () => {
    stack = await startStack({ dataDir: DIR });
    await stack.scene('noRT');
  }, 120_000);
  afterAll(async () => {
    console.log(`temps de calcul (cœur neuf, HTTP local) :\n  ${timings.join('\n  ')}`);
    await stack?.stop();
  });

  it('CA-1.10 : Braine-l’Alleud Côté du Collège → Madou, 11/11 13:30, marche 5 et 10 : bus W et métro 2, jamais le bus 36 vers Rixensart', async () => {
    for (const m of [5, 10]) {
      const r = await route(`Braine-l’Alleud → Madou 11/11 13:30, marche ${m}`, BRAINE, MADOU, at('2026-11-11', '13:30'), m);
      expect(summary(r)[0], `marche ${m}`).toBe('short 13:39 → 14:47');
      expect(plain(r.journeys[0].reason)).toBe('Le plus court : 1 changement, à pied 8 + 1 + 2 min');
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
    expect(plain(r.journeys[0].reason)).toBe('Le plus court : 2 changements, 8 min à pied');
    expect(lines(r.journeys[0])).toEqual(["W Waterloo Eglise → Braine-l'Alleud, Gare", "IC Braine-l'Alleud → Bruxelles-Midi", '2 Gare du Midi → Madou']);
    expect(plain(r.journeys[1].reason)).toBe('Plus tôt : 1 changement, à pied 19 + 3 + 2 min');
    expect(r.journeys[1].legs.find((l) => l.kind === 'ride')?.cat).toBe('P');
    expect(r.journeys.some((j) => j.legs.some((l) => l.to.areaId === 'sncb:8813045' || l.from.areaId === 'sncb:8813045'))).toBe(false);
  });

  it('CA-1.8 : Namur Place Léopold → Madou, 12/11 07:31 : IC jusqu’à Bruxelles-Luxembourg, bus 12, métro 2 ; « Moins de changements »', async () => {
    const r = await route('Namur → Madou 12/11 07:31', MAISON, MADOU, at('2026-11-12', '07:31'));
    expect(summary(r)).toEqual(['short 07:34 → 08:44', 'fewer 07:34 → 08:52', 'next 08:06 → 09:30']);
    expect(r.journeys.map((j) => plain(j.reason)).slice(0, 2)).toEqual(['Le plus court : 2 changements, à pied 8 + 1 + 2 min', 'Moins de changements : 1 changement, à pied 8 + 2 + 10 min']);
    expect(lines(r.journeys[0])).toEqual(['IC Namur → Bruxelles-Luxembourg', '12 Luxembourg → Trône', '2 Trône → Madou']);
  });
});
