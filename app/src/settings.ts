/**
 * Réglages de Quai : validation, migration selon `v`, lecture et écriture via le KV du SDK.
 * Aucune fonction ne lève d'exception sur une entrée invalide : on retombe sur les valeurs par défaut.
 */
import type { Endpoint, Favorite, FavoriteStop, FavoriteTrip, KV, LineFilter, NameLang, Place, Propose, Settings } from './core/api';
import { DEFAULT_SETTINGS } from './core/api';
import type { Names, Op } from '../../shared/types';

export const SETTINGS_KEY = 'quai.settings';
export const CURRENT_VERSION = 1;

const OPS: readonly Op[] = ['sncb', 'stib', 'delijn', 'tec'];
const LANGS: readonly NameLang[] = ['fr', 'nl', 'local'];
const PROPOSE: readonly Propose[] = ['never', 'near', 'morning', 'evening'];
const OPENING: readonly Settings['display']['opening'][] = ['suggest', 'home', 'firstFavorite'];
const RADII: readonly Settings['display']['radiusM'][] = [300, 500, 800];

export const LIMITS = {
  places: 12,
  favorites: 20,
  label: 30,
  address: 120,
  maxWalkMin: [5, 20] as const,
  depsPerStop: [2, 8] as const,
  delayMin: [1, 60] as const,
  leaveBeforeMin: [0, 15] as const,
};

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 200): string | undefined =>
  typeof x === 'string' && x.trim() ? x.trim().replace(/\s+/g, ' ').slice(0, max) : undefined;
const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : undefined);
const oneOf = <T>(x: unknown, list: readonly T[], d: T): T => (list.includes(x as T) ? (x as T) : d);

export function clampInt(x: unknown, [lo, hi]: readonly [number, number], d: number): number {
  const n = num(x);
  if (n === undefined) return d;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function lat(x: unknown): number | undefined {
  const n = num(x);
  return n !== undefined && n >= -90 && n <= 90 ? n : undefined;
}
function lon(x: unknown): number | undefined {
  const n = num(x);
  return n !== undefined && n >= -180 && n <= 180 ? n : undefined;
}

function names(x: unknown): Names | undefined {
  if (!isObj(x)) return undefined;
  const fr = str(x.fr, 120);
  const nl = str(x.nl, 120);
  if (!fr && !nl) return undefined;
  const out: Names = { fr: fr ?? nl!, nl: nl ?? fr! };
  if (x.l === 'nl' || x.l === 'fr') out.l = x.l;
  return out;
}

function nearestRadius(x: unknown): Settings['display']['radiusM'] {
  const n = num(x);
  if (n === undefined) return DEFAULT_SETTINGS.display.radiusM;
  return RADII.reduce((best, r) => (Math.abs(r - n) < Math.abs(best - n) ? r : best), RADII[0]);
}

function place(x: unknown): Place | undefined {
  if (!isObj(x)) return undefined;
  const id = str(x.id, 60);
  const label = str(x.label, LIMITS.label);
  const la = lat(x.lat);
  const lo = lon(x.lon);
  if (!id || !label || la === undefined || lo === undefined) return undefined;
  const p: Place = { id, label, lat: la, lon: lo };
  const address = str(x.address, LIMITS.address);
  if (address) p.address = address;
  return p;
}

function areaId(x: unknown): string | undefined {
  const s = str(x, 80);
  return s && /^(sncb|stib|delijn|tec):\S+$/.test(s) ? s : undefined;
}

function endpoint(x: unknown, placeIds: Set<string>): Endpoint | undefined {
  if (!isObj(x)) return undefined;
  if (x.type === 'here') return { type: 'here' };
  if (x.type === 'place') {
    const placeId = str(x.placeId, 60);
    return placeId && placeIds.has(placeId) ? { type: 'place', placeId } : undefined;
  }
  if (x.type === 'area') {
    const id = areaId(x.areaId);
    const op = oneOf(x.op, OPS, undefined as unknown as Op);
    const n = names(x.name);
    const la = lat(x.lat);
    const lo = lon(x.lon);
    if (!id || !op || !n || la === undefined || lo === undefined) return undefined;
    return { type: 'area', areaId: id, op, name: n, lat: la, lon: lo };
  }
  return undefined;
}

function filters(x: unknown): LineFilter[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const out: LineFilter[] = [];
  for (const f of x) {
    if (!isObj(f)) continue;
    const line = str(f.line, 20);
    const head = typeof f.head === 'string' ? f.head.trim().toLowerCase() : undefined;
    if (!line || head === undefined) continue;
    if (!out.some((o) => o.line === line && o.head === head)) out.push({ line, head });
  }
  return out.length ? out.slice(0, 30) : undefined;
}

function favorite(x: unknown, placeIds: Set<string>): Favorite | undefined {
  if (!isObj(x)) return undefined;
  const id = str(x.id, 60);
  if (!id) return undefined;
  const propose = oneOf(x.propose, PROPOSE, 'never' as Propose);
  if (x.kind === 'stop') {
    const id2 = areaId(x.areaId);
    const op = oneOf(x.op, OPS, undefined as unknown as Op);
    const n = names(x.name);
    const la = lat(x.lat);
    const lo = lon(x.lon);
    if (!id2 || !op || !n || la === undefined || lo === undefined) return undefined;
    const fav: FavoriteStop = { kind: 'stop', id, areaId: id2, op, name: n, lat: la, lon: lo, propose };
    const f = filters(x.filter);
    if (f) fav.filter = f;
    return fav;
  }
  if (x.kind === 'trip') {
    const from = endpoint(x.from, placeIds);
    const to = endpoint(x.to, placeIds);
    if (!from || !to) return undefined;
    const fav: FavoriteTrip = { kind: 'trip', id, from, to, propose };
    const label = str(x.label, LIMITS.label);
    if (label) fav.label = label;
    return fav;
  }
  return undefined;
}

/** Valide et complète des réglages (format v1). Ne lève jamais. */
export function validateSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const x = isObj(input) ? input : {};
  const places: Place[] = [];
  for (const p of Array.isArray(x.places) ? x.places : []) {
    const ok = place(p);
    if (ok && !places.some((q) => q.id === ok.id)) places.push(ok);
    if (places.length >= LIMITS.places) break;
  }
  const placeIds = new Set(places.map((p) => p.id));
  const favorites: Favorite[] = [];
  for (const f of Array.isArray(x.favorites) ? x.favorites : []) {
    const ok = favorite(f, placeIds);
    if (ok && !favorites.some((g) => g.id === ok.id)) favorites.push(ok);
    if (favorites.length >= LIMITS.favorites) break;
  }
  const disp = isObj(x.display) ? x.display : {};
  const al = isObj(x.alerts) ? x.alerts : {};
  return {
    v: 1,
    onboarded: bool(x.onboarded, d.onboarded),
    lang: oneOf(x.lang, LANGS, d.lang),
    places,
    maxWalkMin: clampInt(x.maxWalkMin, LIMITS.maxWalkMin, d.maxWalkMin),
    favorites,
    display: {
      depsPerStop: clampInt(disp.depsPerStop, LIMITS.depsPerStop, d.display.depsPerStop),
      radiusM: nearestRadius(disp.radiusM),
      gestureHints: bool(disp.gestureHints, d.display.gestureHints),
      markPlanned: bool(disp.markPlanned, d.display.markPlanned),
      opening: oneOf(disp.opening, OPENING, d.display.opening),
    },
    alerts: {
      platform: bool(al.platform, d.alerts.platform),
      delay: bool(al.delay, d.alerts.delay),
      delayMin: clampInt(al.delayMin, LIMITS.delayMin, d.alerts.delayMin),
      cancel: bool(al.cancel, d.alerts.cancel),
      leave: bool(al.leave, d.alerts.leave),
      leaveBeforeMin: clampInt(al.leaveBeforeMin, LIMITS.leaveBeforeMin, d.alerts.leaveBeforeMin),
      works: bool(al.works, d.alerts.works),
    },
  };
}

/**
 * Migrations successives, indexées par la version de départ.
 * v0 = réglages enregistrés sans champ `v` (prototype) : mêmes champs, mais `radius` et `deps`
 * à plat et `hints` au lieu de display.gestureHints.
 */
const MIGRATIONS: Record<number, (x: Obj) => Obj> = {
  0: (x) => {
    const display = isObj(x.display) ? { ...x.display } : {};
    if (display.radiusM === undefined && x.radius !== undefined) display.radiusM = x.radius;
    if (display.depsPerStop === undefined && x.deps !== undefined) display.depsPerStop = x.deps;
    if (display.gestureHints === undefined && x.hints !== undefined) display.gestureHints = x.hints;
    const { radius: _r, deps: _d, hints: _h, ...rest } = x;
    return { ...rest, display, v: 1 };
  },
};

/** Version d'un objet de réglages (0 si absente ou invalide). */
export function versionOf(x: unknown): number {
  if (!isObj(x)) return 0;
  const v = num(x.v);
  return v !== undefined && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** Migre puis valide. Une version plus récente que celle connue est lue au mieux (champs connus). */
export function migrateSettings(input: unknown): Settings {
  if (!isObj(input)) return validateSettings({});
  let x: Obj = { ...input };
  let v = versionOf(x);
  while (v < CURRENT_VERSION && MIGRATIONS[v]) {
    x = MIGRATIONS[v](x);
    v += 1;
  }
  return validateSettings(x);
}

/** Lit les réglages enregistrés (JSON) ; valeurs par défaut si absents ou illisibles. */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return validateSettings({});
  try {
    return migrateSettings(JSON.parse(raw));
  } catch {
    return validateSettings({});
  }
}

export async function loadSettings(kv: KV): Promise<Settings> {
  try {
    return parseSettings(await kv.get(SETTINGS_KEY));
  } catch {
    return validateSettings({});
  }
}

export async function saveSettings(kv: KV, s: Settings): Promise<void> {
  await kv.set(SETTINGS_KEY, JSON.stringify(validateSettings(s)));
}

export async function clearSettings(kv: KV): Promise<void> {
  await kv.set(SETTINGS_KEY, '');
}

/** Identifiant court et lisible pour un nouveau lieu ou favori. */
export function newId(prefix: string, taken: Iterable<string>, now = Date.now()): string {
  const used = new Set(taken);
  let n = now % 1_000_000;
  let id = `${prefix}-${n.toString(36)}`;
  while (used.has(id)) id = `${prefix}-${(++n).toString(36)}`;
  return id;
}

type Listener = (s: Settings) => void;

/** Réglages vivants partagés par le téléphone et les lunettes. */
export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();
  private saving: Promise<void> = Promise.resolve();

  constructor(private kv: KV, initial: Settings) {
    this.value = validateSettings(initial);
  }

  get(): Settings {
    return this.value;
  }

  /** Remplace les réglages (validés), enregistre, prévient les abonnés. */
  set(next: Settings): Promise<void> {
    this.value = validateSettings(next);
    for (const l of this.listeners) {
      try {
        l(this.value);
      } catch (err) {
        console.error(err);
      }
    }
    const snapshot = this.value;
    this.saving = this.saving.then(() => saveSettings(this.kv, snapshot)).catch((err) => console.error('Réglages non enregistrés', err));
    return this.saving;
  }

  update(fn: (s: Settings) => Settings): Promise<void> {
    return this.set(fn(structuredClone(this.value)));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  flush(): Promise<void> {
    return this.saving;
  }
}
