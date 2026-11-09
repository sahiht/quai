/**
 * Accès au mini-réseau commun (fixtures/network.json) et aux réglages de démonstration (preset.json).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '../../../src/core/api';

const here = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = join(here, '..', '..', '..');
export const REPO_DIR = join(APP_DIR, '..');
export const CORE_FIXTURES = join(APP_DIR, 'test', 'fixtures', 'core');
export const CORE_DATA_DIR = join(CORE_FIXTURES, 'data');
export const CORE_RELAY_DIR = join(CORE_FIXTURES, 'relay');
/** Sortie réelle du pipeline sur les fixtures (produite par l'équipe données, facultative). */
export const PIPELINE_DATA_DIR = join(REPO_DIR, '.data', 'fixture-data');

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
export const exists = (p: string) => existsSync(p);

export interface NetRoute {
  id: string;
  short: string;
  long: string;
  type: number;
}
export interface NetTrip {
  id: string;
  route: string;
  service: string;
  num?: string;
  head: string;
  st: ([string, string] | [string, string, string])[];
}
export interface NetTemplate {
  idTpl: string;
  route: string;
  service: string;
  head: string;
  stops: [string, number][];
  from: string;
  to: string;
  every: number;
}
export interface NetStop {
  id: string;
  name: string;
  nl?: string;
  lat: number;
  lon: number;
}
export interface NetUpdate {
  seq?: number;
  stop: string;
  arrDelay?: number;
  depDelay?: number;
}
export interface NetAlert {
  id: string;
  stops: string[];
  routes: string[];
  fr: string;
  nl: string;
  from: string;
  to: string;
}
export interface Network {
  serviceDates: string[];
  calendars: Record<string, { days: string; start: string; end: string; remove?: string[]; add?: string[] }>;
  ops: {
    sncb: {
      stations: { uic: string; name: string; fr: string; nl: string; lat: number; lon: number; platforms: string[] }[];
      routes: NetRoute[];
      trips: NetTrip[];
    };
    stib: { stops: NetStop[]; headsigns: Record<string, string>; routes: NetRoute[]; templates: NetTemplate[] };
    delijn: { stops: NetStop[]; routes: NetRoute[]; templates: NetTemplate[] };
    tec: { stops: NetStop[]; routes: NetRoute[]; templates: NetTemplate[]; trips: NetTrip[] };
  };
  realtime: {
    sncb: { tripUpdates: { trip: string; cancelled?: boolean; updates?: NetUpdate[] }[]; alerts: NetAlert[] };
    delijn: { tripUpdates: { trip: string; cancelled?: boolean; updates?: NetUpdate[] }[]; alerts: NetAlert[] };
    tec: { tripUpdates: { trip: string; cancelled?: boolean; updates?: NetUpdate[] }[]; alerts: NetAlert[] };
    stib: { points: Record<string, { line: string; dest: { fr: string; nl: string }; times: string[]; message?: { fr: string; nl: string } }[]> };
  };
  places: Record<string, { label: string; lat: number; lon: number }>;
  positions: Record<string, { lat: number; lon: number; now: string }>;
}

export const loadNetwork = () => readJson<Network>(join(REPO_DIR, 'fixtures', 'network.json'));
export const loadPreset = () => readJson<Settings>(join(REPO_DIR, 'fixtures', 'app', 'preset.json'));

/** Instant d'un horaire « YYYY-MM-DDTHH:MM » à l'heure belge d'hiver (UTC+1, comme les fixtures). */
export const at = (local: string) => Date.parse(`${local}:00+01:00`);
