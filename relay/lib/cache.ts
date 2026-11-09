/**
 * Caches mémoire (par instance de fonction). Les échecs ne sont pas mis en cache ; les requêtes simultanées
 * pour la même clé partagent la même promesse (une seule requête vers la source).
 */

export interface Entry<T> { value: T; at: number }

const isFresh = (at: number, now: number, ttl: number) => now - at >= 0 && now - at < ttl;

/** Une valeur par clé (un flux GTFS-RT décodé, la liste des alertes d'un opérateur). */
export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<Entry<T>>>();

  constructor(readonly ttlMs: number) {}

  /** `load` reçoit la valeur précédente (même périmée), utile pour les flux DIFFERENTIAL. */
  get(key: string, now: () => number, load: (prev: T | undefined) => Promise<T>): Promise<Entry<T>> {
    const hit = this.store.get(key);
    if (hit && isFresh(hit.at, now(), this.ttlMs)) return Promise.resolve(hit);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load(hit?.value).then((value) => {
      const entry = { value, at: now() };
      this.store.set(key, entry);
      return entry;
    });
    this.inflight.set(key, p);
    const done = () => {
      if (this.inflight.get(key) === p) this.inflight.delete(key);
    };
    p.then(done, done);
    return p;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }
}

/** Une valeur par clé, chargées par lots (arrêts STIB : une seule requête pour tous les arrêts manquants). */
export class BatchCache<T> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<Map<string, Entry<T>>>>();

  constructor(readonly ttlMs: number, readonly maxEntries = 5000) {}

  /** `at` = date de la plus ancienne des valeurs renvoyées. `load` doit renvoyer une valeur par clé demandée. */
  async getMany(
    keys: readonly string[],
    now: () => number,
    load: (keys: string[]) => Promise<Map<string, T>>,
  ): Promise<{ values: Map<string, T>; at: number }> {
    const t = now();
    const found = new Map<string, Entry<T>>();
    const waits = new Set<Promise<Map<string, Entry<T>>>>();
    const missing: string[] = [];
    for (const k of keys) {
      const e = this.store.get(k);
      if (e && isFresh(e.at, t, this.ttlMs)) found.set(k, e);
      else if (this.inflight.has(k)) waits.add(this.inflight.get(k)!);
      else missing.push(k);
    }
    if (missing.length) {
      const p = load(missing).then((values) => {
        const at = now();
        const out = new Map<string, Entry<T>>();
        for (const [k, value] of values) {
          const entry = { value, at };
          this.store.set(k, entry);
          out.set(k, entry);
        }
        this.prune(at);
        return out;
      });
      for (const k of missing) this.inflight.set(k, p);
      const done = () => {
        for (const k of missing) if (this.inflight.get(k) === p) this.inflight.delete(k);
      };
      p.then(done, done);
      waits.add(p);
    }
    for (const p of waits) {
      const got = await p;
      for (const k of keys) {
        const e = got.get(k);
        if (e && !found.has(k)) found.set(k, e);
      }
    }
    let at = t;
    for (const e of found.values()) at = Math.min(at, e.at);
    return { values: new Map([...found].map(([k, e]) => [k, e.value])), at };
  }

  private prune(now: number): void {
    if (this.store.size <= this.maxEntries) return;
    for (const [k, e] of this.store) if (!isFresh(e.at, now, this.ttlMs)) this.store.delete(k);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }
}
