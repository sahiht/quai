/**
 * Chargement des fichiers statiques publiés chaque nuit (DATA_BASE) :
 * délai 10 s, un nouvel essai, cache mémoire (LRU) et cache persistant par génération.
 */
import type { AreaFile, Meta, Op, SearchFile, TileFile, TrainsDay } from '../../../shared/types';
import { QuaiError, type QuaiErrorCode } from './errors';
import { getText, HttpStatusError, safeJson, type FetchLike } from './net';
import type { PersistentCache } from './persist';

const TIMEOUT_MS = 10_000;
/** Lecture du cache persistant (pont de l'appli, parfois lent) : au-delà, on passe au réseau. */
const PERSIST_DEADLINE_MS = 1_500;
const MEM_MAX = 400;
export const OPS: readonly Op[] = ['sncb', 'stib', 'delijn', 'tec'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function isMeta(x: unknown): x is Meta {
  return (
    isObj(x) &&
    x.v === 1 &&
    typeof x.generatedAt === 'string' &&
    Array.isArray(x.serviceDates) &&
    x.serviceDates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) &&
    isObj(x.tile) &&
    typeof x.tile.lat === 'number' &&
    typeof x.tile.lon === 'number' &&
    x.tile.lat > 0 &&
    x.tile.lon > 0
  );
}
const isTile = (x: unknown): x is TileFile => isObj(x) && Array.isArray(x.areas);
const isArea = (x: unknown): x is AreaFile =>
  isObj(x) && typeof x.id === 'string' && Array.isArray(x.stops) && Array.isArray(x.patterns) && Array.isArray(x.deps);
const isSearch = (x: unknown): x is SearchFile => isObj(x) && Array.isArray(x.items);
const isTrains = (x: unknown): x is TrainsDay => isObj(x) && typeof x.date === 'string' && Array.isArray(x.stations) && Array.isArray(x.trips);

/** Chemin du fichier d'une zone : areas/{op}/{fileKey}.json (null si l'identifiant est invalide). */
export function areaPath(id: string): string | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  const op = id.slice(0, i);
  const key = id.slice(i + 1);
  if (!key || !(OPS as readonly string[]).includes(op)) return null;
  return `areas/${op}/${key.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
}

export class DataClient {
  meta: Meta | null = null;
  private readonly mem = new Map<string, Promise<unknown>>();
  private metaLoading: Promise<Meta> | null = null;

  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike,
    private readonly persist: PersistentCache,
  ) {}

  /** Recharge meta.json (repli : dernière copie enregistrée). */
  loadMeta(): Promise<Meta> {
    if (!this.metaLoading) {
      this.metaLoading = this.fetchMeta().finally(() => {
        this.metaLoading = null;
      });
    }
    return this.metaLoading;
  }

  async requireMeta(): Promise<Meta> {
    return this.meta ?? this.loadMeta();
  }

  tile(key: string): Promise<TileFile | null> {
    return this.file(`tiles/${key}.json`, isTile, null);
  }

  async area(id: string): Promise<AreaFile> {
    const path = areaPath(id);
    if (!path) throw new QuaiError('areaUnknown');
    const f = await this.file(path, isArea, 'areaUnknown');
    if (!f) throw new QuaiError('areaUnknown');
    return f;
  }

  search(key: string): Promise<SearchFile | null> {
    if (!/^[a-z0-9]{2}$/.test(key)) return Promise.resolve(null);
    return this.file(`search/${key}.json`, isSearch, null);
  }

  trains(date: string): Promise<TrainsDay | null> {
    return this.file(`trains/${date}.json`, isTrains, null);
  }

  private async fetchMeta(): Promise<Meta> {
    let text: string | null = null;
    let fromNetwork = false;
    try {
      const r = await this.fetchRetry('meta.json');
      if (r.status === 200 && isMeta(safeJson(r.text))) {
        text = r.text;
        fromNetwork = true;
      }
    } catch {
      text = null;
    }
    if (text === null) text = await this.persist.getMeta();
    const parsed = text === null ? undefined : safeJson(text);
    if (!isMeta(parsed)) throw new QuaiError('dataUnavailable');
    if (fromNetwork && text !== null) this.persist.putMeta(text);
    if (!this.meta || this.meta.generatedAt !== parsed.generatedAt) {
      this.mem.clear();
      this.persist.setGeneration(parsed.generatedAt);
    }
    this.meta = parsed;
    return parsed;
  }

  private file<T>(path: string, valid: (x: unknown) => x is T, notFound: QuaiErrorCode | null): Promise<T | null> {
    const hit = this.mem.get(path);
    if (hit) {
      this.mem.delete(path);
      this.mem.set(path, hit);
      return hit as Promise<T | null>;
    }
    const p = this.load(path, valid, notFound);
    this.mem.set(path, p);
    while (this.mem.size > MEM_MAX) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
    p.catch(() => {
      if (this.mem.get(path) === p) this.mem.delete(path);
    });
    return p;
  }

  private async load<T>(path: string, valid: (x: unknown) => x is T, notFound: QuaiErrorCode | null): Promise<T | null> {
    const meta = await this.requireMeta();
    const gen = meta.generatedAt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cached = await Promise.race([
      this.persist.get(gen, path),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PERSIST_DEADLINE_MS);
      }),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
    if (cached !== null) {
      const parsed = safeJson(cached);
      if (valid(parsed)) return parsed;
    }
    let r: { status: number; text: string };
    try {
      r = await this.fetchRetry(path);
    } catch {
      throw new QuaiError('dataUnavailable');
    }
    if (r.status === 404) {
      if (notFound === null) return null;
      throw new QuaiError(notFound);
    }
    const parsed = safeJson(r.text);
    if (!valid(parsed)) throw new QuaiError('dataUnavailable');
    this.persist.put(gen, path, r.text);
    return parsed;
  }

  /** Un essai, puis un second en cas d'échec réseau, de délai dépassé ou d'erreur serveur. */
  private async fetchRetry(path: string): Promise<{ status: number; text: string }> {
    const url = `${this.base}/${path}`;
    let last: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await getText(this.fetchFn, url, TIMEOUT_MS);
        if (r.status === 200 || r.status === 404) return r;
        last = new HttpStatusError(r.status);
        if (r.status < 500 && r.status !== 408 && r.status !== 429) break;
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('échec réseau');
  }
}
