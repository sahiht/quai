/**
 * Quai 1.3.1, « l'heure de partir d'après le vrai chemin, la même partout » : la scène des tests. Vrai cœur (createCore)
 * sur le mini-réseau commun (fixtures/network.json), avec des tuiles piétonnes codées au vrai format (walk-helpers.ts).
 *
 * L'exemple du propriétaire, sur des lieux publics : on est à 180 m au sud de l'arrêt Esplanade (STIB, Bruxelles), on va
 * à la Bourse. Tram 3 à 07:20, marge 2 min. Marche estimée : 180 m × 1,3 à 80 m par minute, 3 min : partir à 07:15. Le
 * vrai chemin contourne un îlot : 133 m vers l'est, 180 m vers le nord, 133 m vers l'ouest, 446 m, 6 min : il faut
 * partir à 07:12.
 */
import type { Core, FavoritePlace, LatLon, Settings } from '../../src/core/api';
import { createCore } from '../../src/core/index';
import { F_STEPS } from '../../src/core/walk/format';
import { DATA_BASE, FakeServer, MemoryKV, RELAY_BASE } from './support/env';
import { at as atLocal, loadPreset } from './support/network';
import { indexOf, tileOf, type GraphDef } from './walk-helpers';

const M_LAT = 6371000 * (Math.PI / 180);
/** Point à `dx` m à l'est et `dy` m au nord de `p`. */
export const offset = (p: LatLon, dx: number, dy: number): LatLon => ({ lat: p.lat + dy / M_LAT, lon: p.lon + dx / (M_LAT * Math.cos((p.lat * Math.PI) / 180)) });

export const DAY = '2026-11-10';
export const at = (hm: string): number => atLocal(`${DAY}T${hm.slice(0, 5)}`) + (hm.length > 5 ? Number(hm.slice(6)) * 1000 : 0);
export const MIN = 60_000;

/** L'arrêt Esplanade (zone stib:6380 du mini-réseau) et le point de départ, 180 m plus au sud. */
export const ESPLANADE: LatLon = { lat: 50.899025, lon: 4.33905 };
export const START: LatLon = offset(ESPLANADE, 0, -180);
export const BOURSE: FavoritePlace = { kind: 'place', id: 'bourse', label: 'Bourse', lat: 50.8483, lon: 4.3497, propose: 'never' };
export const TILE = '2544_144';
export const VERSION = '2026-11-09';

export type PathKind = 'long' | 'short' | 'huge' | 'stairs' | 'elsewhere';

/**
 * Le quartier, au format des tuiles :
 * - long : le seul chemin fait le tour de l'îlot (446 m, 6 min) ;
 * - short : une rue toute droite (180 m, 3 min : pas plus long que l'estimation) ;
 * - huge : un tour de 1 000 m (13 min : le plafond de 5 min) ;
 * - stairs : la rue droite est un escalier (180 m), le tour de l'îlot est sans marches (446 m) ;
 * - elsewhere : des rues à 300 m de là (aucune voie à 100 m du départ : chemin droit).
 */
export function graphOf(kind: PathKind): GraphDef {
  const east = kind === 'huge' ? 410 : 133;
  const b = offset(START, east, 0);
  const c = { lat: ESPLANADE.lat, lon: b.lon };
  if (kind === 'elsewhere') {
    const p = offset(START, 300, 0);
    return { nodes: { p, q: offset(p, 0, 180) }, ways: [{ nodes: ['p', 'q'], name: 'Rue du Test' }] };
  }
  const nodes = { a: START, b, c, d: ESPLANADE };
  const around = [
    { nodes: ['a', 'b'], name: 'Avenue de l’Esplanade' },
    { nodes: ['b', 'c'], name: 'Avenue du Parc' },
    { nodes: ['c', 'd'], name: 'Place de l’Esplanade' },
  ];
  if (kind === 'short') return { nodes, ways: [{ nodes: ['a', 'd'], name: 'Avenue de l’Esplanade' }] };
  if (kind === 'stairs') return { nodes, ways: [...around, { nodes: ['a', 'd'], name: 'Escalier du Parc', flags: F_STEPS }] };
  return { nodes, ways: around };
}

export interface Scene {
  server: FakeServer;
  /** Demandes de tuiles et d'index piétons, dans l'ordre. */
  walkCalls(): string[];
  /** Tuile retenue tant que `release` n'est pas appelé (réseau lent). */
  hold(): void;
  release(): void;
  /** La tuile échoue (réseau coupé) ou revient. */
  fail(on: boolean): void;
  /** Un cœur neuf sur ce serveur (l'horloge du test). */
  core(now: () => number): Core;
  settings(patch?: Partial<Settings>): Settings;
}

/**
 * Serveur de données du mini-réseau, sans temps réel, avec les tuiles piétonnes du quartier (`path` ; null : aucun
 * chemin à pied publié, comme hors de Belgique ou avant la 1.2.10).
 */
export function scene(path: PathKind | null = 'long'): Scene {
  const server = new FakeServer();
  server.scene = 'noRT';
  let held: (() => void)[] | null = null;
  let failing = false;
  if (path) {
    const tile = JSON.stringify(tileOf(graphOf(path), { key: TILE, ver: VERSION }));
    server.overrides.set('/quai/data/walk/index.json', () => new Response(JSON.stringify(indexOf({ version: VERSION })), { status: 200 }));
    server.overrides.set(`/quai/data/walk/${TILE}.json`, async () => {
      if (failing) throw new TypeError('Failed to fetch');
      if (held) await new Promise<void>((r) => held?.push(r));
      return new Response(tile, { status: 200 });
    });
  }
  return {
    server,
    walkCalls: () => server.calls.filter((u) => u.includes('/walk/')).map((u) => u.slice(DATA_BASE.length + 1)),
    hold: () => {
      held = [];
    },
    release: () => {
      const h = held ?? [];
      held = null;
      for (const r of h) r();
    },
    fail: (on) => {
      failing = on;
    },
    core: (now) => createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now, storage: new MemoryKV(), fetch: server.fetch }),
    settings: (patch = {}) => ({ ...loadPreset(), favorites: [BOURSE], ...patch }),
  };
}

/** Laisse passer les calculs en arrière-plan (tuile, chemin, signal). */
export const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
