/**
 * Petits réseaux de test du calcul de trajets (design-routing.md § 8) : un Network minimal, passé dans le même
 * générateur que les fixtures (gen-fixtures.ts, fichiers de ligne compris) et servi en mémoire au vrai cœur.
 */
import type { Endpoint, Journey, PlanResult, Settings } from '../../../src/core/api';
import { DEFAULT_SETTINGS } from '../../../src/core/api';
import { hhmm, lineLabel } from '../../../src/core/util';
import { buildDataFiles } from '../support/gen-fixtures';
import { FakeServer, makeEnv, type TestEnv } from '../support/env';
import type { NetRoute, NetStop, NetTemplate, NetTrip, Network } from '../support/network';

export const CAL = {
  WEEK: { days: '1111100', start: '2026-11-01', end: '2026-12-31', remove: ['2026-11-11'] },
  DAILY: { days: '1111111', start: '2026-11-01', end: '2026-12-31' },
  HOLI: { days: '0000000', start: '2026-11-01', end: '2026-12-31', add: ['2026-11-11'] },
};

export interface MiniNet {
  stations?: { uic: string; name: string; lat: number; lon: number; platforms?: string[] }[];
  trains?: NetTrip[];
  stib?: { stops: NetStop[]; routes: NetRoute[]; templates: NetTemplate[] };
  delijn?: { stops: NetStop[]; routes: NetRoute[]; templates: NetTemplate[] };
  tec?: { stops: NetStop[]; routes: NetRoute[]; templates: NetTemplate[]; trips?: NetTrip[] };
}

const empty = { tripUpdates: [], alerts: [] };

export function network(m: MiniNet): Network {
  return {
    serviceDates: ['2026-11-10', '2026-11-11'],
    calendars: CAL,
    ops: {
      sncb: {
        stations: (m.stations ?? []).map((s) => ({ uic: s.uic, name: s.name, fr: s.name, nl: s.name, lat: s.lat, lon: s.lon, platforms: s.platforms ?? ['1'] })),
        routes: [
          { id: 'IC', short: 'IC', long: 'Intercity', type: 2 },
          { id: 'S1', short: 'S1', long: 'S1', type: 109 },
          { id: 'NJ', short: 'NJ', long: 'Nightjet', type: 2 },
          // bus de remplacement de la SNCB (samedi 14/11 sur les vraies données) : catégorie « BUS »
          { id: 'BUS', short: 'BUS', long: 'Bus de remplacement', type: 3 },
        ],
        trips: m.trains ?? [],
      },
      stib: { stops: m.stib?.stops ?? [], headsigns: {}, routes: m.stib?.routes ?? [], templates: m.stib?.templates ?? [] },
      delijn: { stops: m.delijn?.stops ?? [], routes: m.delijn?.routes ?? [], templates: m.delijn?.templates ?? [] },
      tec: { stops: m.tec?.stops ?? [], routes: m.tec?.routes ?? [], templates: m.tec?.templates ?? [], trips: m.tec?.trips ?? [] },
    },
    realtime: { sncb: empty, delijn: empty, tec: empty, stib: { points: {} } },
    places: {},
    positions: {},
  };
}

/**
 * Cœur de test sur un petit réseau (temps réel en panne : horaires prévus). `patch` modifie les fichiers publiés
 * avant de les servir (autorisations de montée, meta sans fichiers de ligne…).
 */
export function miniEnv(m: MiniNet, now: string, patch?: (files: Record<string, unknown>) => void): TestEnv {
  const files = buildDataFiles(network(m));
  patch?.(files);
  const server = new FakeServer('/nonexistent');
  for (const [path, body] of Object.entries(files)) server.memFiles.set(path, JSON.stringify(body));
  return makeEnv({ now, scene: 'noRT', server });
}

export const SETTINGS: Settings = { ...DEFAULT_SETTINGS, onboarded: true, maxWalkMin: 10 };
export const at = (p: { lat: number; lon: number }, label = 'X'): Endpoint => ({ type: 'address', label, lat: p.lat, lon: p.lon });

/** Étapes lisibles : « 08:05 T3 A → B 08:20 », « marche 4 min ». */
export function legsOf(j: Journey): string {
  return j.legs
    .map((l) => (l.kind === 'walk' ? `marche ${l.walkMin}` : `${hhmm(l.dep)} ${l.cat ?? lineLabel(l.mode ?? 'bus', l.line ?? '')} ${l.from.name.fr} → ${l.to.name.fr} ${hhmm(l.arr)}`))
    .join(' | ');
}

export const summary = (r: PlanResult) => r.journeys.map((j) => `${j.label}: ${legsOf(j)}`);
export const plain = (s: string | undefined) => (s ?? '').replace(/ /g, ' ');
