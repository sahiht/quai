/**
 * Outils des tests du téléphone (environnement happy-dom) : contexte d'écran avec le faux cœur, réglages en
 * mémoire, position simulée, lunettes factices (GlassesApi) et attente des promesses.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import type { Core, GlassesApi, LineFilter, Settings, TripRequest } from '../../src/core/api';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { gtfsTime } from '../../src/core/util';
import { createFakeCore, type FakeFlags } from '../../src/dev/fake-core';
import type { PhoneCtx } from '../../src/phone/app';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix } from '../../src/platform/types';
import { migrateSettings, SettingsStore } from '../../src/settings';

export const PRESET_PATH = fileURLToPath(new NodeURL('../../../fixtures/app/preset.json', import.meta.url));
/** Réglages de démonstration de la 1.0 (lieux à adresse libre), migrés en réglages v3 (lieux dans les favoris). */
export const preset = (): Settings => migrateSettings(JSON.parse(readFileSync(PRESET_PATH, 'utf8')));
/** Préréglage de la 1.1 (PRD annexe A.2) : preset.json et le favori « fav-maison », migrés en réglages v3. */
export const preset11 = (): Settings => migrateSettings(JSON.parse(readFileSync(fileURLToPath(new NodeURL('../../../fixtures/app/preset-1.1.json', import.meta.url)), 'utf8')));
export const defaults = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), onboarded: true, ...patch });

/** Instant du 2026-11-10 (jour des fixtures), heure belge. */
export const at = (hh: number, mm: number, ss = 0): number => gtfsTime('2026-11-10', hh * 60 + mm) + ss * 1000;

export const SCENARIO = {
  s1: { lat: 50.4655, lon: 4.859, now: at(7, 31) },
  s2: { lat: 50.86, lon: 4.359, now: at(12, 10) },
  s3: { lat: 50.8454, lon: 4.3571, now: at(13, 55) },
};

/** Espace insécable : les textes du téléphone suivent la typographie française. */
export const NB = ' ';
/** Texte visible, espaces insécables remplacés par des espaces (comparaisons lisibles). */
export const plain = (s: string | null | undefined): string => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
export const textOf = (el: Element | null | undefined): string => plain(el?.textContent);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Laisse passer les promesses en attente (cœur factice, réglages). */
export async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
/** Attend qu'une condition soit vraie (2 s au plus). */
export async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condition jamais remplie');
    await sleep(10);
  }
}

export interface FakeGlasses extends GlassesApi {
  trips: TripRequest[];
  boards: { areaId: string; filter?: LineFilter[] }[];
}

/** Lunettes factices : gardent les demandes et rendent le message du contrat. */
export function fakeGlasses(): FakeGlasses {
  const g: FakeGlasses = {
    trips: [],
    boards: [],
    async showTrip(req) {
      g.trips.push(req);
      const j = req.result.journeys[req.index];
      const r = j?.legs.find((l) => l.kind === 'ride');
      return r ? `Affiché dans les lunettes${NB}: ${r.cat ?? r.line} ${new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(r.schedDep)}.` : 'Affiché dans les lunettes.';
    },
    async showBoard(areaId, filter) {
      g.boards.push({ areaId, filter });
      return 'Départs affichés dans les lunettes.';
    },
  };
  return g;
}

export interface Harness {
  /** Avance l'horloge simulée (l'horloge ne bouge pas toute seule pendant un test). */
  advance(ms: number): void;
  ctx: PhoneCtx;
  core: Core;
  settings: SettingsStore;
  glasses: FakeGlasses;
  went: string[];
  location: { fix: Fix | null };
  kv: ReturnType<typeof memoryBackend>;
}

/**
 * Contexte d'un écran du téléphone : faux cœur (drapeaux FakeFlags), réglages en mémoire, position fixe,
 * horloge simulée, lunettes factices. `go` note l'ancre demandée sans changer d'écran.
 */
export function harness(opts: { settings?: Settings; now?: number; here?: { lat: number; lon: number } | null; flags?: FakeFlags; params?: string; core?: (c: Core) => Core; web?: boolean; glasses?: boolean } = {}): Harness {
  let tick = 0;
  const clock = createClock({ mockNow: opts.now ?? SCENARIO.s3.now, perfNow: () => tick });
  const kv = memoryBackend();
  const settings = new SettingsStore(createKV(kv), opts.settings ?? defaults());
  const base = createFakeCore({ dataBase: 'https://x.test/data', relayBase: 'https://r.test', now: clock.now, storage: { get: async () => null, set: async () => {} } }, opts.flags ?? {});
  const core = opts.core ? opts.core(base) : base;
  const here = opts.here === undefined ? { lat: SCENARIO.s3.lat, lon: SCENARIO.s3.lon } : opts.here;
  const location = { fix: here ? ({ ...here, at: clock.now(), source: 'mock' } as Fix) : null };
  const glasses = fakeGlasses();
  const went: string[] = [];
  let ready: Promise<Core> | null = null;
  const ctx: PhoneCtx = {
    settings,
    core: () => (ready ??= core.init().then(() => core)),
    coreNow: () => core,
    location: { current: async () => location.fix, last: () => location.fix },
    clock,
    glasses: () => (opts.glasses === false ? null : glasses),
    meta: () => core.meta,
    freshness: () => null,
    coreError: () => null,
    configured: true,
    web: opts.web,
    go: (hash) => void went.push(hash),
    params: new URLSearchParams(opts.params ?? ''),
  };
  return { ctx, core, settings, glasses, went, location, kv, advance: (ms) => void (tick += ms) };
}

/** Monte un écran dans la page (les écrans sont faits pour être dans le document). */
export function mount(el: HTMLElement): HTMLElement {
  document.body.replaceChildren(el);
  return el;
}

/** Tape un texte dans un champ (événement input). */
export function type(input: HTMLInputElement, text: string): void {
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Propositions affichées sous un champ : [libellé, type]. */
export function options(list: Element): [string, string][] {
  return [...list.querySelectorAll('[role="option"]')].map((o) => [textOf(o.querySelector('.s1')), textOf(o.querySelector('.s2'))]);
}

/** Bouton par son texte visible. */
export function button(root: ParentNode, text: string | RegExp): HTMLButtonElement {
  const all = [...root.querySelectorAll<HTMLButtonElement>('button')];
  const b = all.find((x) => (typeof text === 'string' ? textOf(x) === text : text.test(textOf(x))));
  if (!b) throw new Error(`bouton introuvable : ${String(text)} (parmi ${all.map((x) => `« ${textOf(x)} »`).join(', ')})`);
  return b;
}
