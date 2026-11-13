/** Outils communs aux tests de l'interface. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { DEFAULT_SETTINGS, type Core, type Settings } from '../../src/core/api';
import { gtfsTime } from '../../src/core/util';
import { createFakeCore, dataFreshness, type FakeFlags } from '../../src/dev/fake-core';
import { migrateSettings, SettingsStore } from '../../src/settings';
import { textWidth } from '../../src/glasses/font';
import type { ContainerSpec, PageSpec } from '../../src/glasses/types';
import { GlassesController } from '../../src/glasses/controller';
import type { HubSignal } from '../../src/glasses/gestures';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix, GlassesPort, LocationPort, Platform } from '../../src/platform/types';
import { APP_VERSION } from '../../src/version';

export const PRESET_PATH = fileURLToPath(new URL('../../../fixtures/app/preset.json', import.meta.url));
export const PRESET_11_PATH = fileURLToPath(new URL('../../../fixtures/app/preset-1.1.json', import.meta.url));
/** Réglages de démonstration de la 1.0 (5 favoris), migrés en v2. */
export const preset = (): Settings => migrateSettings(JSON.parse(readFileSync(PRESET_PATH, 'utf8')));
/** Réglages de démonstration de la 1.1 (6 favoris, dont fav-maison « Le soir »). */
export const preset11 = (): Settings => migrateSettings(JSON.parse(readFileSync(PRESET_11_PATH, 'utf8')));

/** Instant du 2026-11-10 (jour des fixtures), heure belge. */
export const at = (hh: number, mm: number, ss = 0): number => gtfsTime('2026-11-10', hh * 60 + mm) + ss * 1000;

export const SCENARIO = {
  s1: { lat: 50.4655, lon: 4.859, now: at(7, 31) },
  s2: { lat: 50.86, lon: 4.359, now: at(12, 10) },
  s3: { lat: 50.8454, lon: 4.3571, now: at(13, 55) },
};

export function fakeCore(now: () => number, flags: FakeFlags = {}) {
  return createFakeCore({ dataBase: 'https://x.test/data', relayBase: 'https://r.test', now, storage: { get: async () => null, set: async () => {} } }, flags);
}

export const defaults = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), onboarded: true, ...patch });

/** Espaces insécables remplacées par des espaces (comparaisons de textes). */
export const nb = (t: string): string => t.replace(/ /g, ' ');

/**
 * Vérifie qu'aucune ligne d'un conteneur ne dépasse sa largeur (mesure au pixel), ni sa hauteur. 1.2.2 : un conteneur
 * vide (pied réduit à 1 px sur l'accueil sans aide des gestes) n'a pas de hauteur à tenir.
 */
export function overflowing(page: PageSpec): string[] {
  const bad: string[] = [];
  for (const c of page.containers) {
    for (const line of c.content.split('\n')) {
      if (textWidth(line) > c.w) bad.push(`${c.name}: « ${line} » ${textWidth(line)} px > ${c.w} px`);
    }
    const lines = c.content.split('\n').length;
    if (c.content.trim() && lines * 27 > c.h) bad.push(`${c.name}: ${lines} lignes pour ${c.h} px`);
    if (c.y + c.h > 288) bad.push(`${c.name}: sous le bas de l’écran (${c.y + c.h} px)`);
  }
  return bad;
}

/* ------------------------------ Contrôleur des lunettes ------------------------------ */

interface Call { op: 'start' | 'rebuild' | 'upgrade' | 'exit'; arg?: unknown }

/** Faux port SDK qui enregistre les appels. */
export function recorder() {
  const calls: Call[] = [];
  let listener: ((s: HubSignal) => void) | null = null;
  const port: GlassesPort = {
    async start(cs: ContainerSpec[]) {
      calls.push({ op: 'start', arg: cs });
      return true;
    },
    async rebuild(cs: ContainerSpec[]) {
      calls.push({ op: 'rebuild', arg: cs });
      return true;
    },
    async upgrade(c: ContainerSpec) {
      calls.push({ op: 'upgrade', arg: c });
      return true;
    },
    onSignal(cb) {
      listener = cb;
      return () => (listener = null);
    },
    async exit(mode) {
      calls.push({ op: 'exit', arg: mode });
    },
  };
  return { calls, port, emit: (s: HubSignal) => listener?.(s) };
}

/** Position qu'un test peut déplacer (ou retirer : position refusée). */
export function movableLocation(now: () => number, pos: { lat: number; lon: number } | null): LocationPort & { set(p: { lat: number; lon: number } | null): void } {
  let cur = pos;
  const fix = (): Fix | null => (cur ? { lat: cur.lat, lon: cur.lon, accuracy: 5, at: now(), source: 'mock' } : null);
  return { current: async () => fix(), last: () => fix(), set: (p) => (cur = p) };
}

export interface Screen {
  screen: string;
  title: string;
  lines: string[];
  clock: string;
  sel: number;
  order?: string[];
  page?: number;
  pages?: number;
  label?: string;
  followed?: boolean;
}

export interface SetupOptions {
  /** Instant de départ (sinon celui du scénario). */
  now?: number;
  scenario?: keyof typeof SCENARIO;
  /** Position (null : refusée) ; sinon celle du scénario. */
  pos?: { lat: number; lon: number } | null;
  settings?: Settings;
  flags?: FakeFlags;
  configured?: boolean;
  wrap?: (core: Core) => Core;
  /** Stockage partagé entre deux ouvertures (réouverture de Quai). */
  kv?: ReturnType<typeof createKV>;
  web?: boolean;
  /** Appelé avant start() (ex. __restoreState dans une nouvelle WebView). */
  beforeStart?: (c: GlassesController) => void;
  /** Ne pas attendre la fin du démarrage (cœur lent : état pendant « Chargement… »). */
  noWait?: boolean;
  /** 1.2.5 : position fournie par le test (ex. qui tarde à répondre), à la place de movableLocation. */
  location?: ReturnType<typeof movableLocation>;
  /**
   * Garder la version vue des réglages (message « Quai 1.2 » après une mise à jour). Sinon, des réglages d'une version
   * antérieure (préréglages 1.0 et 1.1) sont pris comme déjà vus dans la version courante : l'accueil s'ouvre directement.
   */
  keepSeen?: boolean;
}

/**
 * Contrôleur des lunettes avec le faux cœur, une horloge simulée (advance) et un faux port SDK.
 * Rien n'avance seul : les tests appellent refreshCurrent() ou settle().
 */
export async function setupController(o: SetupOptions = {}) {
  const sc = SCENARIO[o.scenario ?? 's1'];
  let t = 0;
  const clock = createClock({ mockNow: o.now ?? sc.now, perfNow: () => t });
  const rec = recorder();
  const closeWebView = vi.fn();
  const kv = o.kv ?? createKV(memoryBackend());
  const location = o.location ?? movableLocation(clock.now, o.pos === undefined ? { lat: sc.lat, lon: sc.lon } : o.pos);
  const platform: Platform = { kind: 'even', glasses: rec.port, kv, location, closeWebView };
  const initial = o.settings ?? preset11();
  const settings = new SettingsStore(kv, o.keepSeen || !initial.seenVersion ? initial : { ...initial, seenVersion: APP_VERSION });
  const logs: string[] = [];
  const flags: FakeFlags = o.flags ?? {};
  const base = fakeCore(clock.now, flags);
  const core = o.wrap ? o.wrap(base) : base;
  const c = new GlassesController({ platform, core, settings, clock, configured: o.configured ?? true, freshness: dataFreshness, e2e: true, log: (l) => logs.push(l), web: o.web });
  const screens = (): Screen[] => logs.filter((l) => l.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.slice(12)) as Screen);
  const last = (): Screen => screens()[screens().length - 1];
  const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));
  /** Attend qu'un écran vérifie `ok` (rendus asynchrones), au plus ~1 s. */
  const until = async (ok: (s: Screen) => boolean): Promise<Screen> => {
    for (let i = 0; i < 40 && !(last() && ok(last())); i++) await settle(25);
    return last();
  };
  const advance = (ms: number) => (t += ms);
  /** Avance l'horloge jusqu'à un instant donné. */
  const goTo = (when: number) => (t += when - clock.now());
  const gesture = async (...gs: ('up' | 'down' | 'tap' | 'double')[]) => {
    for (const g of gs) {
      c.onGesture(g);
      await settle();
    }
  };
  o.beforeStart?.(c);
  if (o.noWait) void c.start();
  else await c.start();
  await settle();
  return { c, rec, logs, last, screens, settle, until, closeWebView, settings, advance, goTo, clock, kv, flags, location, core, gesture };
}
