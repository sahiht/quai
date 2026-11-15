/**
 * 1.2.10, tests du contrôleur : banc d'essai du guidage. Horloge simulée liée aux minuteries simulées de Vitest (le
 * recalcul du moteur à `wakeAt`, les messages qui s'effacent seuls, l'enregistrement au plus toutes les 5 s se vérifient
 * en avançant le temps), faux port des lunettes qui garde chaque appel (pages, images et menu, mises à jour, dessins),
 * fausses positions continues (watch) qu'on fait avancer d'une position à l'autre, cœur de test (helpers.ts) avec chemin
 * à pied et nouveau trajet remplaçables. Le moteur et les écrans du guidage sont les doubles de
 * controller-guide-doubles.ts (vi.mock dans chaque fichier de test). Lieux publics seulement.
 */
import { vi } from 'vitest';
import type { Core, DepartureStops, Journey, KV, LatLon, Settings } from '../../src/core/api';
import type { WalkRoute } from '../../src/core/guide-types';
import { dataFreshness } from '../../src/dev/fake-core';
import { GlassesController } from '../../src/glasses/controller';
import type { HubSignal } from '../../src/glasses/gestures';
import type { Gesture } from '../../src/glasses/nav';
import type { ContainerSpec, ImageSpec } from '../../src/glasses/types';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix, GlassesPort, LocationPort, PageExtra, Platform } from '../../src/platform/types';
import { SettingsStore } from '../../src/settings';
import { MAISON, MIN, at, journey, stubCore, type Screen, type StubOptions } from './helpers';

export const DAY = '2026-11-12';
export const NOW = at(DAY, 7, 31);

/** Gare et arrêts publics des scénarios (jamais d'adresse personnelle). */
export const SPOTS = {
  merbraine: { lat: 50.6833, lon: 4.3891 },
  guillemins: { lat: 50.6245, lon: 5.5669 },
  central: { lat: 50.8454, lon: 4.3571 },
  flagey: { lat: 50.8275, lon: 4.3722 },
};

/** Trajet de porte à porte : 5 min à pied jusqu'à Merbraine, bus W, 4 min à pied ; départ conseillé `leave`. */
export function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5, to: 'Merbraine' }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Merbraine', to: 'Bruxelles Midi', head: 'Bruxelles Midi' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
}

/** Chemin à pied construit (vrai chemin OSM par défaut) : une ligne droite vers le nord-est, découpée en points. */
export function walkRouteOf(from: LatLon, to: LatLon, source: WalkRoute['source'] = 'osm', builtAt = NOW): WalkRoute {
  const coords = Array.from({ length: 6 }, (_, i) => ({ lat: from.lat + ((to.lat - from.lat) * i) / 5, lon: from.lon + ((to.lon - from.lon) * i) / 5 }));
  return { from, to, coords, lengthM: 400, maneuvers: [], source, builtAt };
}

/**
 * Réglages du banc : la normalisation des réglages (settings.ts, équipe du téléphone) ne connaît pas encore
 * `display.guide` (« Me guider pendant un trajet ») et le retire ; il est gardé ici, tel que le test le donne.
 */
export class GuideSettings extends SettingsStore {
  private guide: boolean | undefined;
  private patched: { base: Settings; out: Settings } | null = null;
  constructor(kv: KV, initial: Settings) {
    super(kv, initial);
    this.guide = initial.display.guide;
  }
  override get(): Settings {
    const base = super.get();
    if (this.guide === undefined || base.display.guide === this.guide) return base;
    if (this.patched?.base !== base) this.patched = { base, out: { ...base, display: { ...base.display, guide: this.guide } } };
    return this.patched.out;
  }
  override set(next: Settings): Promise<void> {
    this.guide = next.display.guide;
    return super.set(next);
  }
}

export interface Call {
  op: 'start' | 'rebuild' | 'upgrade' | 'paint' | 'exit';
  arg?: unknown;
  extra?: PageExtra;
}

export interface Watch {
  opts: { accuracy: 'high' | 'medium'; intervalMs: number; distanceM: number };
  cb: (f: Fix) => void;
  stopped: boolean;
}

export interface KitOptions {
  now?: number;
  settings: Settings;
  web?: boolean;
  pos?: LatLon | null;
  kv?: KV;
  stub?: StubOptions;
  /** Chemin à pied du cœur (absent : le cœur n'en a pas). */
  walkRoute?: (from: LatLon, to: LatLon) => Promise<WalkRoute | null>;
  /** Autres réponses du cœur (route, board, departureStops…), par-dessus le cœur de test. */
  coreExtra?: (now: () => number) => Partial<Core>;
  /** Dessin d'une image (faux : échec) ; absent : la plateforme n'a pas paint. */
  paint?: ((img: ImageSpec) => boolean | Promise<boolean>) | null;
  /** La plateforme n'a pas de positions continues. */
  noWatch?: boolean;
  pageStarted?: boolean;
}

let active: { stop(): void } | null = null;

/** À appeler après chaque test : contrôleur arrêté, vraies minuteries rendues. */
export function cleanupKit(): void {
  active?.stop();
  active = null;
  vi.useRealTimers();
}

export async function guideSetup(o: KitOptions) {
  cleanupKit();
  const now0 = o.now ?? NOW;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'], now: now0 });
  const clock = createClock({ mockNow: now0, perfNow: () => performance.now() });
  const calls: Call[] = [];
  let listener: ((s: HubSignal) => void) | null = null;
  const port: GlassesPort = {
    async start(cs, extra) {
      calls.push({ op: 'start', arg: cs, extra });
      return true;
    },
    async rebuild(cs, extra) {
      calls.push({ op: 'rebuild', arg: cs, extra });
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
  const paint = o.paint === undefined ? () => true : o.paint;
  if (paint) {
    port.paint = async (img) => {
      calls.push({ op: 'paint', arg: img });
      return paint(img);
    };
  }
  let pos = o.pos === undefined ? MAISON : o.pos;
  const fixOf = (p: LatLon, extra: Partial<Fix> = {}): Fix => ({ lat: p.lat, lon: p.lon, accuracy: 5, at: clock.now(), source: 'sdk', ...extra });
  const watches: Watch[] = [];
  const location: LocationPort & { set(p: LatLon | null): void } = {
    current: async () => (pos ? fixOf(pos, { source: 'mock' }) : null),
    last: () => (pos ? fixOf(pos, { source: 'mock' }) : null),
    set: (p) => (pos = p),
  };
  if (!o.noWatch) {
    location.watch = (opts, cb) => {
      const w: Watch = { opts, cb, stopped: false };
      watches.push(w);
      return () => {
        w.stopped = true;
      };
    };
  }
  const kv = o.kv ?? createKV(memoryBackend());
  const closeWebView = vi.fn();
  const platform: Platform = { kind: o.web ? 'web' : 'even', glasses: port, kv, location, closeWebView };
  const settings = new GuideSettings(kv, o.settings);
  const logs: string[] = [];
  const core = ((now: () => number) => {
    const c = stubCore(now, o.stub ?? {});
    if (o.walkRoute) Object.assign(c, { walkRoute: o.walkRoute });
    if (o.coreExtra) Object.assign(c, o.coreExtra(now));
    return c;
  })(clock.now);
  const c = new GlassesController({ platform, core, settings, clock, configured: true, freshness: dataFreshness, e2e: true, log: (l) => logs.push(l), web: o.web, pageStarted: o.pageStarted });
  active = c;
  const settle = async (ms = 40): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  const screens = (): (Screen & { show?: string; moment?: string | null })[] => logs.filter((l) => l.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.slice(12)));
  const last = () => screens()[screens().length - 1];
  const until = async (ok: (s: ReturnType<typeof last>) => boolean, tries = 60): Promise<ReturnType<typeof last>> => {
    for (let i = 0; i < tries && !(last() && ok(last())); i++) await settle(25);
    return last();
  };
  const gesture = async (...gs: Gesture[]): Promise<void> => {
    for (const g of gs) {
      c.onGesture(g);
      await settle();
    }
  };
  const emit = async (s: HubSignal): Promise<void> => {
    listener?.(s);
    await settle();
  };
  /** Positions continues en cours (la dernière demandée, pas arrêtée). */
  const watching = (): Watch | undefined => [...watches].reverse().find((w) => !w.stopped);
  /** Une position continue (la plateforme l'envoie à l'abonné du moment). */
  const push = async (p: LatLon, extra: Partial<Fix> = {}): Promise<void> => {
    const w = watching();
    if (!w) throw new Error('aucune position continue demandée');
    w.cb(fixOf(p, extra));
    await settle(5);
  };
  /** Appels depuis le rang `from`. */
  const since = (from: number): Call[] => calls.slice(from);
  /** Dernière page envoyée (conteneurs, mises à jour comprises). */
  const sent = (): ContainerSpec[] => {
    const lastBuild = [...calls].reverse().find((x) => x.op === 'start' || x.op === 'rebuild');
    const cs = structuredClone((lastBuild?.arg as ContainerSpec[]) ?? []);
    for (const u of calls.slice(calls.lastIndexOf(lastBuild!) + 1).filter((x) => x.op === 'upgrade')) {
      const up = u.arg as ContainerSpec;
      const i = cs.findIndex((x) => x.id === up.id);
      if (i >= 0) cs[i] = { ...up };
    }
    return cs;
  };
  const lastBuild = (): Call | undefined => [...calls].reverse().find((x) => x.op === 'start' || x.op === 'rebuild');
  await c.start();
  await settle();
  return { c, calls, logs, last, screens, until, settle, gesture, emit, push, watches, watching, since, sent, lastBuild, clock, kv, settings, location, core, closeWebView };
}

export type Kit = Awaited<ReturnType<typeof guideSetup>>;

/** Arrêts d'un départ de bus (departureStops) : le premier est l'arrêt du tableau. */
export function busStops(now: number): DepartureStops {
  const t = (m: number) => now + m * MIN;
  const names = ['Monument Gramme', 'Place Général Leman', 'Gare des Guillemins', 'Fragnée'];
  return {
    op: 'tec',
    mode: 'bus',
    line: '6',
    head: { fr: 'Gare des Guillemins', nl: 'Gare des Guillemins' },
    stops: names.map((n, i) => ({ areaId: `tec:${n.replace(/\W+/g, '')}`, name: { fr: n, nl: n }, sched: t(4 + i * 3), est: t(4 + i * 3), rt: true, delayMin: 0 })),
    anyPlanned: false,
    state: 'ok',
  };
}
