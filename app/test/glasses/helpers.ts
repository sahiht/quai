/**
 * Outils des tests des lunettes (1.2.1) : trajets construits à la main, cœur de test (faux cœur dont on remplace les
 * réponses), contrôleur avec horloge simulée et faux port SDK, contrôle des largeurs au pixel.
 * Les textes des raisons viennent du cœur : les tests construisent leurs propres raisons, sans dépendre de celles du
 * cœur en cours de changement.
 */
import { DEFAULT_SETTINGS, type Core, type Favorite, type FavoriteAnswer, type Journey, type JourneyLabel, type Leg, type NearbyItem, type Settings } from '../../src/core/api';
import { gtfsTime } from '../../src/core/util';
import { createFakeCore, dataFreshness } from '../../src/dev/fake-core';
import { GlassesController } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { geometry, layoutPage } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import type { ContainerSpec, GlassesView, PageSpec } from '../../src/glasses/types';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix, GlassesPort, LocationPort, Platform } from '../../src/platform/types';
import { SettingsStore } from '../../src/settings';
import type { Names } from '../../../shared/types';

export const NB = ' ';
/** Espaces insécables remplacées par des espaces (comparaisons de textes). */
export const nb = (t: string): string => t.replace(/ /g, ' ');

/** Instant à Bruxelles : jour (« 2026-11-12 »), heure, minute. */
export const at = (day: string, hh: number, mm: number, ss = 0): number => gtfsTime(day, hh * 60 + mm) + ss * 1000;
export const MIN = 60_000;

const N = (fr: string): Names => ({ fr, nl: fr });

/* ------------------------------ Trajets construits ------------------------------ */

type Step = { walk: number; to?: string } | { ride: string; mode: 'bus' | 'tram' | 'metro' | 'train'; dep: number; arr: number; from: string; to: string; head?: string; platform?: string };

/**
 * Trajet construit à la main : marches (minutes) et véhicules (heures) dans l'ordre ; les marches se placent avant ou
 * après les véhicules voisins.
 */
export function journey(id: string, steps: Step[], opts: { label?: JourneyLabel; reason?: string } = {}): Journey {
  const legs: Leg[] = [];
  const firstRide = steps.findIndex((s) => 'ride' in s);
  // départ : la 1re marche finit au départ du 1er véhicule
  let t = 0;
  if (firstRide >= 0) {
    const r = steps[firstRide] as Extract<Step, { ride: string }>;
    t = r.dep - steps.slice(0, firstRide).reduce((s, x) => s + ('walk' in x ? x.walk * MIN : 0), 0);
  }
  let place = 'Départ';
  for (const s of steps) {
    if ('walk' in s) {
      const to = s.to ?? 'Arrivée';
      legs.push({ kind: 'walk', from: { name: N(place), lat: 50.8, lon: 4.3 }, to: { name: N(to), lat: 50.8, lon: 4.3 }, dep: t, arr: t + s.walk * MIN, schedDep: t, schedArr: t + s.walk * MIN, walkMin: s.walk });
      t += s.walk * MIN;
      place = to;
    } else {
      const op = s.mode === 'train' ? 'sncb' : s.mode === 'bus' ? 'tec' : 'stib';
      const leg: Leg = {
        kind: 'ride', from: { name: N(s.from), lat: 50.8, lon: 4.3 }, to: { name: N(s.to), lat: 50.8, lon: 4.3 },
        dep: s.dep, arr: s.arr, schedDep: s.dep, schedArr: s.arr, op, mode: s.mode, line: s.ride, head: N(s.head ?? s.to), rt: true, delayMin: 0, cancelled: false,
      };
      if (s.mode === 'train') leg.cat = s.ride;
      if (s.platform) leg.platform = s.platform;
      legs.push(leg);
      t = s.arr;
      place = s.to;
    }
  }
  const rides = legs.filter((l) => l.kind === 'ride');
  const j: Journey = { id, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: legs[0].dep, transfers: Math.max(0, rides.length - 1), rt: true, alerts: [] };
  if (opts.label) j.label = opts.label;
  if (opts.reason) j.reason = opts.reason;
  return j;
}

/* ------------------------------ Pages ------------------------------ */

/** Page d'une vue au premier affichage (sélection et défilement initiaux). */
export function page(v: GlassesView): PageSpec {
  const g = geometry(v);
  return layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, g.capacity));
}

/** Lignes de chaque conteneur qui dépassent sa largeur ou sa hauteur (mesure au pixel). */
export function overflowing(p: PageSpec): string[] {
  const bad: string[] = [];
  for (const c of p.containers) {
    for (const line of c.content.split('\n')) if (textWidth(line) > c.w) bad.push(`${c.name} : « ${line} » ${textWidth(line)} px > ${c.w} px`);
    if (c.content.split('\n').length * 27 > c.h) bad.push(`${c.name} : ${c.content.split('\n').length} lignes pour ${c.h} px`);
    if (c.y + c.h > 288) bad.push(`${c.name} : sous le bas de l'écran (${c.y + c.h} px)`);
  }
  return bad;
}

/** Lignes journalisées d'une vue, après contrôle : rien ne dépasse, jamais de tiret long. */
export function lines(v: GlassesView): string[] {
  const p = page(v);
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  for (const l of [p.title, ...p.lines]) if (/—/.test(l)) throw new Error(`tiret long : ${l}`);
  return p.lines.map(nb);
}

export const container = (p: PageSpec, name: string): ContainerSpec => p.containers.find((c) => c.name === name)!;
export const rowsOf = (c: ContainerSpec): string[] => c.content.split('\n').map(nb);

/* ------------------------------ Réglages ------------------------------ */

export const settingsWith = (favorites: Favorite[], patch: Partial<Settings> = {}): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  onboarded: true,
  maxWalkMin: 5,
  favorites,
  ...patch,
});

/** Lieux et arrêt des cas réels du PRD-1.2.1 (§ 1.5) ; Maison est la position de départ des tests. */
export const MAISON = { lat: 50.68579, lon: 4.39175 };
export const PLACES = {
  maison: { kind: 'place', id: 'fav-maison', label: 'Maison', lat: MAISON.lat, lon: MAISON.lon, propose: 'never' } as Favorite,
  bureau: { kind: 'place', id: 'fav-bureau', label: 'Bureau', lat: 50.8504, lon: 4.3707, propose: 'never' } as Favorite,
  mama: { kind: 'place', id: 'fav-mama', label: 'Mama', lat: 50.87677, lon: 4.38584, propose: 'never' } as Favorite,
  gare: { kind: 'stop', id: 'fav-gare', areaId: 'sncb:8814266', op: 'sncb', name: N('Braine-l’Alleud'), lat: 50.6833, lon: 4.3747, propose: 'never' } as Favorite,
};

/* ------------------------------ Cœur et contrôleur ------------------------------ */

export interface StubOptions {
  /** Réponses des favoris (par identifiant), à l'instant de la demande. */
  answers?: (fav: Favorite, now: number) => FavoriteAnswer | undefined;
  /** Propositions de route() et des favoris sans réponse donnée. */
  plan?: (now: number) => Journey[];
  /** Nombre d'arrêts « Autour de moi ». */
  nearby?: number;
}

const nearbyItems = (n: number): NearbyItem[] =>
  Array.from({ length: n }, (_, i) => ({
    area: { id: `stib:${9000 + i}`, op: 'stib', n: N(`Arrêt ${i + 1}`), lat: 50.8, lon: 4.3, modes: ['bus'], lines: ['1'] },
    distanceM: 50 + i * 10,
    walkMin: 1,
  }));

/**
 * Faux cœur dont les réponses des favoris, les trajets et « Autour de moi » sont donnés par le test ; refresh() rend le
 * trajet tel quel (pas de temps réel inventé). init(), status() et orderFavorites() restent ceux du faux cœur.
 */
export function stubCore(now: () => number, o: StubOptions = {}): Core {
  const base = createFakeCore({ dataBase: 'https://x.test/data', relayBase: 'https://r.test', now, storage: { get: async () => null, set: async () => {} } });
  const plan = o.plan;
  return Object.assign(Object.create(base) as Core, {
    async refresh(j: Journey) {
      return j;
    },
    async nearby() {
      return nearbyItems(o.nearby ?? 9);
    },
    async route() {
      const journeys = plan ? plan(now()) : [];
      return journeys.length ? { journeys } : { journeys, empty: 'noTrip' as const };
    },
    async answer(fav: Favorite, _here: unknown, _s: Settings): Promise<FavoriteAnswer> {
      const given = o.answers?.(fav, now());
      if (given) return given;
      const journeys = plan ? plan(now()) : [];
      return fav.kind === 'stop'
        ? { favoriteId: fav.id, kind: 'stop', state: 'none', updatedAt: now() }
        : { favoriteId: fav.id, kind: 'trip', state: journeys.length ? 'ok' : 'none', plan: { journeys }, updatedAt: now() };
    },
  });
}

export interface Screen {
  screen: string;
  title: string;
  lines: string[];
  clock: string;
  sel: number;
  order?: string[];
  shown?: string[];
  page?: number;
  pages?: number;
  label?: string;
  followed?: boolean;
}

interface Call { op: 'start' | 'rebuild' | 'upgrade' | 'exit'; arg?: unknown }

export interface SetupOptions {
  now: number;
  settings: Settings;
  pos?: { lat: number; lon: number } | null;
  core?: (now: () => number) => Core;
  kv?: ReturnType<typeof createKV>;
  web?: boolean;
}

/** Contrôleur des lunettes : horloge simulée (rien n'avance seul), faux port SDK, journal QUAI_SCREEN. */
export async function setup(o: SetupOptions) {
  let t = 0;
  const clock = createClock({ mockNow: o.now, perfNow: () => t });
  const calls: Call[] = [];
  let listener: ((s: import('../../src/glasses/gestures').HubSignal) => void) | null = null;
  const port: GlassesPort = {
    async start(cs) {
      calls.push({ op: 'start', arg: cs });
      return true;
    },
    async rebuild(cs) {
      calls.push({ op: 'rebuild', arg: cs });
      return true;
    },
    async upgrade(c) {
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
  let pos = o.pos === undefined ? MAISON : o.pos;
  const fix = (): Fix | null => (pos ? { lat: pos.lat, lon: pos.lon, accuracy: 5, at: clock.now(), source: 'mock' } : null);
  const location: LocationPort & { set(p: { lat: number; lon: number } | null): void } = { current: async () => fix(), last: () => fix(), set: (p) => (pos = p) };
  const kv = o.kv ?? createKV(memoryBackend());
  const platform: Platform = { kind: o.web ? 'web' : 'even', glasses: port, kv, location, closeWebView: () => {} };
  const settings = new SettingsStore(kv, o.settings);
  const logs: string[] = [];
  const core = (o.core ?? ((now) => stubCore(now)))(clock.now);
  const c = new GlassesController({ platform, core, settings, clock, configured: true, freshness: dataFreshness, e2e: true, log: (l) => logs.push(l), web: o.web });
  const screens = (): Screen[] => logs.filter((l) => l.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.slice(12)) as Screen);
  const last = (): Screen => screens()[screens().length - 1];
  const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));
  const until = async (ok: (s: Screen) => boolean): Promise<Screen> => {
    for (let i = 0; i < 60 && !(last() && ok(last())); i++) await settle(25);
    return last();
  };
  const gesture = async (...gs: ('up' | 'down' | 'tap' | 'double')[]) => {
    for (const g of gs) {
      c.onGesture(g);
      await settle();
    }
  };
  /** Avance l'horloge simulée. */
  const advance = (ms: number) => (t += ms);
  /** Dernière page envoyée aux lunettes (conteneurs). */
  const sent = (): ContainerSpec[] => {
    const lastCall = [...calls].reverse().find((x) => x.op === 'start' || x.op === 'rebuild');
    const cs = structuredClone((lastCall?.arg as ContainerSpec[]) ?? []);
    const after = calls.slice(calls.lastIndexOf(lastCall!) + 1).filter((x) => x.op === 'upgrade');
    for (const u of after) {
      const up = u.arg as ContainerSpec;
      const i = cs.findIndex((x) => x.id === up.id);
      if (i >= 0) cs[i] = { ...up };
    }
    return cs;
  };
  /** Clavier et pavé : un signal de geste (avec l'anti-rebond du contrôleur). */
  const emit = (s: import('../../src/glasses/gestures').HubSignal) => listener?.(s);
  await c.start();
  await settle();
  return { c, calls, logs, last, screens, settle, until, gesture, advance, clock, kv, settings, location, core, sent, emit };
}
