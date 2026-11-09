/** Outils communs aux tests de l'interface. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/api';
import { gtfsTime } from '../../src/core/util';
import { createFakeCore } from '../../src/dev/fake-core';
import { migrateSettings } from '../../src/settings';
import { textWidth } from '../../src/glasses/font';
import type { PageSpec } from '../../src/glasses/types';

export const PRESET_PATH = fileURLToPath(new URL('../../../fixtures/app/preset.json', import.meta.url));
export const preset = (): Settings => migrateSettings(JSON.parse(readFileSync(PRESET_PATH, 'utf8')));

/** Instant du 2026-11-10 (jour des fixtures), heure belge. */
export const at = (hh: number, mm: number, ss = 0): number => gtfsTime('2026-11-10', hh * 60 + mm) + ss * 1000;

export const SCENARIO = {
  s1: { lat: 50.4655, lon: 4.859, now: at(7, 31) },
  s2: { lat: 50.86, lon: 4.359, now: at(12, 10) },
  s3: { lat: 50.8454, lon: 4.3571, now: at(13, 55) },
};

export function fakeCore(now: () => number, flags = {}) {
  return createFakeCore({ dataBase: 'https://x.test/data', relayBase: 'https://r.test', now, storage: { get: async () => null, set: async () => {} } }, flags);
}

export const defaults = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), onboarded: true, ...patch });

/** Vérifie qu'aucune ligne d'un conteneur ne dépasse sa largeur (mesure au pixel). */
export function overflowing(page: PageSpec): string[] {
  const bad: string[] = [];
  for (const c of page.containers) {
    for (const line of c.content.split('\n')) {
      if (textWidth(line) > c.w) bad.push(`${c.name}: « ${line} » ${textWidth(line)} px > ${c.w} px`);
    }
    const lines = c.content.split('\n').length;
    if (lines * 27 > c.h) bad.push(`${c.name}: ${lines} lignes pour ${c.h} px`);
  }
  return bad;
}
