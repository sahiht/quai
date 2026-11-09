/**
 * Stockage clé/valeur (contrat KV du cœur) au-dessus du stockage de l'appli Even
 * (setLocalStorage / getLocalStorage, seul stockage fiable dans la WebView) ou de localStorage.
 * Les grandes valeurs sont découpées en morceaux de 48 000 caractères, de façon transparente.
 */
import type { KV } from '../core/api';

export interface KVBackend {
  /** '' ou null si absent. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const CHUNK = 48_000;
const MARK = '\u0000quai-chunks:';

export function createKV(backend: KVBackend, opts: { prefix?: string; chunk?: number } = {}): KV {
  const prefix = opts.prefix ?? '';
  const chunk = opts.chunk ?? CHUNK;
  const cache = new Map<string, string | null>();

  async function rawGet(key: string): Promise<string | null> {
    const v = await backend.get(prefix + key);
    return v === undefined || v === null || v === '' ? null : v;
  }

  return {
    async get(key) {
      if (cache.has(key)) return cache.get(key) ?? null;
      const head = await rawGet(key);
      let value = head;
      if (head && head.startsWith(MARK)) {
        const n = Number(head.slice(MARK.length));
        const parts: string[] = [];
        for (let i = 0; i < n; i++) {
          const p = await rawGet(`${key}#${i}`);
          if (p === null) {
            value = null;
            break;
          }
          parts.push(p);
        }
        if (value !== null) value = parts.join('');
      }
      cache.set(key, value);
      return value;
    },
    async set(key, value) {
      cache.set(key, value || null);
      if (value.length <= chunk) {
        await backend.set(prefix + key, value);
      } else {
        const n = Math.ceil(value.length / chunk);
        for (let i = 0; i < n; i++) await backend.set(`${prefix}${key}#${i}`, value.slice(i * chunk, (i + 1) * chunk));
        await backend.set(prefix + key, `${MARK}${n}`);
      }
    },
  };
}

/** KV en mémoire (tests, repli ultime). */
export function memoryBackend(): KVBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      if (v === '') data.delete(k);
      else data.set(k, v);
    },
  };
}

/** localStorage du navigateur (développement hors de l'appli Even). */
export function localStorageBackend(): KVBackend {
  const mem = memoryBackend();
  return {
    async get(k) {
      try {
        return window.localStorage.getItem(k);
      } catch {
        return mem.get(k);
      }
    },
    async set(k, v) {
      try {
        if (v === '') window.localStorage.removeItem(k);
        else window.localStorage.setItem(k, v);
      } catch {
        await mem.set(k, v);
      }
    },
  };
}
