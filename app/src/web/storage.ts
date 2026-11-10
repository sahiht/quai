/**
 * Quai Web : réglages et cache dans le localStorage du navigateur. Les réglages passent toujours :
 * si le stockage est plein, le cache des horaires (clés « quai.cache. ») est vidé pour leur faire de la place.
 * Stockage interdit (navigation privée stricte) : repli en mémoire pour la visite.
 */
import type { KVBackend } from '../platform/kv';

export const CACHE_PREFIX = 'quai.cache.';

interface StoreLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function browserStore(): StoreLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Retire toutes les clés du cache des horaires (jamais les réglages). */
export function clearCache(store: StoreLike): number {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  for (const k of keys) store.removeItem(k);
  return keys.length;
}

export function webStorageBackend(store: StoreLike | null = browserStore()): KVBackend {
  const mem = new Map<string, string>();
  return {
    async get(k) {
      if (mem.has(k)) return mem.get(k) ?? null;
      try {
        return store?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    async set(k, v) {
      if (v === '') {
        mem.delete(k);
        try {
          store?.removeItem(k);
        } catch {
          /* rien à effacer */
        }
        return;
      }
      if (!store) {
        mem.set(k, v);
        return;
      }
      try {
        store.setItem(k, v);
        mem.delete(k);
        return;
      } catch {
        /* plein ou interdit */
      }
      if (!k.startsWith(CACHE_PREFIX)) {
        try {
          clearCache(store);
          store.setItem(k, v);
          mem.delete(k);
          return;
        } catch {
          /* toujours impossible */
        }
      }
      mem.set(k, v);
    },
  };
}
