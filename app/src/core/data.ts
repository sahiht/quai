/**
 * Chargement des fichiers statiques publiés chaque nuit (DATA_BASE) :
 * délai 10 s, un nouvel essai, cache mémoire (LRU borné en caractères) et cache persistant par génération ;
 * meta.json relue toutes les 10 min au plus : une nouvelle publication remplace l'ancienne d'un coup (jamais de
 * fichiers de deux générations dans les caches).
 */
import type { AreaFile, Meta, Op, SearchFile, TileFile, TrainsDay } from '../../../shared/types';
import { QuaiError, type QuaiErrorCode } from './errors';
import { getText, HttpStatusError, safeJson, type FetchLike } from './net';
import { localDate } from './util';
import type { PersistentCache } from './persist';

const TIMEOUT_MS = 10_000;
/** Lecture du cache persistant (pont de l'appli, parfois lent) : au-delà, on passe au réseau. */
const PERSIST_DEADLINE_MS = 1_500;
/**
 * Cache mémoire : 8 millions de caractères de JSON au plus (15 à 30 Mo de tas une fois lus, d'après la revue
 * technique : trains des deux jours 3,3 Mo de texte pour 12,8 Mo de tas), raisonnable pour la WebView d'un téléphone
 * de milieu de gamme ; de quoi garder les fichiers de ligne de plusieurs trajets favoris et les trains du jour.
 */
export const MEM_BUDGET_CHARS = 8_000_000;
const MEM_MAX_FILES = 2_000;
/** meta.json relue (sans cache HTTP) quand la dernière lecture a plus de 10 min. */
export const META_TTL_MS = 10 * 60_000;
const META_CHECK_TIMEOUT_MS = 4_000;
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

/**
 * Fichiers épinglés du cache persistant (effacés en dernier) : index des lignes, tuiles, tuiles de lignes, trains
 * du jour (PRD S7 : l'accueil répond sans réseau à la deuxième ouverture de la journée).
 */
export function pinned(path: string, today: string): boolean {
  return path === 'lines/index.json' || path.startsWith('tiles/') || path.startsWith('linetiles/') || path === `trains/${today}.json`;
}

export class DataClient {
  meta: Meta | null = null;
  /** Clé « génération|chemin » : deux publications ne se mélangent jamais. Taille comptée en caractères. */
  private readonly mem = new Map<string, { p: Promise<unknown>; size: number }>();
  private memChars = 0;
  private metaLoading: Promise<Meta> | null = null;
  /** Dernière lecture (ou tentative) de meta.json sur le réseau. */
  private metaCheckedAt = 0;
  private readonly genListeners: ((gen: string) => void)[] = [];

  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike,
    private readonly persist: PersistentCache,
    private readonly now: () => number = () => Date.now(),
  ) {
    persist.setPinned((path) => pinned(path, localDate(this.now())));
  }

  /** Prévient d'un changement de génération (caches à vider ailleurs). */
  onGeneration(cb: (gen: string) => void): void {
    this.genListeners.push(cb);
  }

  /** Recharge meta.json (repli : dernière copie enregistrée). */
  loadMeta(): Promise<Meta> {
    if (!this.metaLoading) {
      this.metaLoading = this.fetchMeta().finally(() => {
        this.metaLoading = null;
      });
    }
    return this.metaLoading;
  }

  /**
   * meta.json connue ; relue sur le réseau (sans cache HTTP) quand la dernière lecture a plus de 10 min, pour ne pas
   * lire les fichiers d'une nouvelle publication avec les serviceDates de l'ancienne. Échec : on garde la connue.
   */
  async requireMeta(): Promise<Meta> {
    if (!this.meta) return this.loadMeta();
    const t = this.now();
    if (t - this.metaCheckedAt >= META_TTL_MS || t < this.metaCheckedAt) {
      if (!this.metaLoading) {
        this.metaCheckedAt = t;
        this.metaLoading = this.refreshMeta().finally(() => {
          this.metaLoading = null;
        });
      }
      return this.metaLoading;
    }
    return this.meta;
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

  /**
   * Fichier JSON quelconque de la publication (1.1 : lines/index.json, linetiles/, lines/ pour le calcul de
   * trajets), par le même cache (mémoire LRU, persistant, génération meta.generatedAt). 404 → null ;
   * échec réseau → QuaiError('dataUnreachable') ; contenu invalide → QuaiError('dataUnavailable').
   * Chemin et validation : à l'appelant.
   */
  json<T>(path: string, valid: (x: unknown) => x is T): Promise<T | null> {
    return this.file(path, valid, null);
  }

  /** Caractères gardés dans le cache mémoire (tests, mesures). */
  get memoryChars(): number {
    return this.memChars;
  }

  private async fetchMeta(): Promise<Meta> {
    let text: string | null = null;
    let fromNetwork = false;
    // Serveur injoignable (réseau, délai, erreur serveur) ou serveur qui répond sans le fichier (PRD M8.6).
    let unreachable = false;
    this.metaCheckedAt = this.now();
    const net = this.fetchRetry('meta.json', true).then(
      (r) => (r.status === 200 && isMeta(safeJson(r.text)) ? r.text : null),
      () => {
        unreachable = true;
        return null;
      },
    );
    // 1.2.5 (PRD-1.2.5 § 6) : réseau lent ou absent (train, reprise après verrouillage) : au bout de 4 s, la copie
    // enregistrée sert ; la réponse du réseau, si elle arrive ensuite avec une autre génération, la remplace comme le
    // ferait la relecture (refreshMeta).
    const saved = this.persist.getMeta().catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((r) => {
      timer = setTimeout(() => r(undefined), META_CHECK_TIMEOUT_MS);
    });
    const quick = await Promise.race([net, late]);
    clearTimeout(timer);
    if (quick !== undefined) {
      text = quick;
      fromNetwork = quick !== null;
    } else {
      // La copie, ou le réseau s'il répond pendant qu'on la lit (pont de stockage lent).
      const copied = saved.then((c) => (c !== null && isMeta(safeJson(c)) ? c : null));
      const won = await Promise.race([copied.then((t) => ({ net: false, t })), net.then((t) => ({ net: true, t }))]);
      if (won.net && won.t !== null) {
        text = won.t;
        fromNetwork = true;
      } else {
        const copy = won.net ? await copied : won.t;
        if (copy !== null) {
          text = copy;
          void net.then((t) => this.adoptLate(t));
        } else {
          text = await net;
          fromNetwork = text !== null;
        }
      }
    }
    if (text === null) text = await saved;
    const parsed = text === null ? undefined : safeJson(text);
    if (!isMeta(parsed)) throw new QuaiError(unreachable ? 'dataUnreachable' : 'dataUnavailable');
    if (fromNetwork && text !== null) this.persist.putMeta(text);
    this.useMeta(parsed);
    return parsed;
  }

  /** 1.2.5 : meta du réseau arrivée après la copie enregistrée : une autre génération la remplace. */
  private adoptLate(text: string | null): void {
    const parsed = text === null ? undefined : safeJson(text);
    if (!isMeta(parsed) || !this.meta || parsed.generatedAt === this.meta.generatedAt) return;
    this.persist.putMeta(text!);
    this.metaCheckedAt = this.now();
    this.useMeta(parsed);
  }

  /** Relecture périodique : un seul essai, délai court ; en cas d'échec, la meta connue reste. */
  private async refreshMeta(): Promise<Meta> {
    const known = this.meta!;
    try {
      const r = await getText(this.fetchFn, `${this.base}/meta.json`, META_CHECK_TIMEOUT_MS, true);
      const parsed = r.status === 200 ? safeJson(r.text) : undefined;
      if (!isMeta(parsed)) return known;
      if (parsed.generatedAt !== known.generatedAt) this.persist.putMeta(r.text);
      this.useMeta(parsed);
      return parsed;
    } catch {
      return known;
    }
  }

  private useMeta(m: Meta): void {
    const changed = !this.meta || this.meta.generatedAt !== m.generatedAt;
    this.meta = m;
    if (!changed) return;
    this.mem.clear();
    this.memChars = 0;
    this.persist.setGeneration(m.generatedAt);
    for (const cb of this.genListeners) {
      try {
        cb(m.generatedAt);
      } catch {
        /* rien */
      }
    }
  }

  private async file<T>(path: string, valid: (x: unknown) => x is T, notFound: QuaiErrorCode | null): Promise<T | null> {
    const meta = await this.requireMeta();
    const key = `${meta.generatedAt}|${path}`;
    const hit = this.mem.get(key);
    if (hit) {
      this.mem.delete(key);
      this.mem.set(key, hit);
      return hit.p as Promise<T | null>;
    }
    const entry = { p: null as unknown as Promise<unknown>, size: 0 };
    const p = this.load(meta, path, valid, notFound).then(({ value, size }) => {
      if (this.mem.get(key) === entry) {
        entry.size = size;
        this.memChars += size;
        this.trimMemory(key);
      }
      return value;
    });
    entry.p = p;
    this.mem.set(key, entry);
    p.catch(() => {
      if (this.mem.get(key) === entry) this.mem.delete(key);
    });
    return p;
  }

  /** Cache mémoire borné en caractères (MEM_BUDGET_CHARS), le plus ancien d'abord ; jamais le fichier qui arrive. */
  private trimMemory(keep: string): void {
    for (const [k, e] of this.mem) {
      if (this.memChars <= MEM_BUDGET_CHARS && this.mem.size <= MEM_MAX_FILES) break;
      if (k === keep) continue;
      this.mem.delete(k);
      this.memChars -= e.size;
    }
  }

  private async load<T>(meta: Meta, path: string, valid: (x: unknown) => x is T, notFound: QuaiErrorCode | null): Promise<{ value: T | null; size: number }> {
    const gen = meta.generatedAt;
    if (notFound === null && (await this.persist.absent(gen, path))) return { value: null, size: 0 };
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
      if (valid(parsed)) return { value: parsed, size: cached.length };
    }
    let r: { status: number; text: string };
    try {
      r = await this.fetchRetry(path);
    } catch {
      throw new QuaiError('dataUnreachable');
    }
    if (r.status === 404) {
      if (notFound === null) {
        // fichier absent de la publication (tuile vide…) : noté, une ouverture sans réseau ne bute pas dessus
        this.persist.markAbsent(gen, path);
        return { value: null, size: 0 };
      }
      throw new QuaiError(notFound);
    }
    const parsed = safeJson(r.text);
    if (!valid(parsed)) throw new QuaiError('dataUnavailable');
    this.persist.put(gen, path, r.text);
    return { value: parsed, size: r.text.length };
  }

  /** Un essai, puis un second en cas d'échec réseau, de délai dépassé ou d'erreur serveur. */
  private async fetchRetry(path: string, noStore = false): Promise<{ status: number; text: string }> {
    const url = `${this.base}/${path}`;
    let last: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await getText(this.fetchFn, url, TIMEOUT_MS, noStore);
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
