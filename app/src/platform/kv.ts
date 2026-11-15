/**
 * Stockage clé/valeur (contrat KV du cœur) au-dessus du stockage de l'appli Even
 * (setLocalStorage / getLocalStorage, seul stockage fiable dans la WebView) ou de localStorage.
 * Les grandes valeurs sont découpées en morceaux de 48 000 caractères, de façon transparente.
 *
 * 1.3.0 (contrôle technique) : lecture stricte (`getStrict`, si le support la connaît) : null pour une clé absente, une
 * exception pour une lecture qui n'a pas abouti ; jamais d'échec gardé en cache (la lecture simple, elle, garde le vide
 * que le pont rend au bout de 5 s, comme avant).
 */
import type { KV } from '../core/api';

export interface KVBackend {
  /** '' ou null si absent. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Lecture stricte, facultative : '' ou null si absent ; exception si la lecture n'a pas abouti (délai dépassé). */
  getStrict?(key: string): Promise<string | null>;
}

export const CHUNK = 48_000;
const MARK = '\u0000quai-chunks:';

export function createKV(backend: KVBackend, opts: { prefix?: string; chunk?: number } = {}): KV {
  const prefix = opts.prefix ?? '';
  const chunk = opts.chunk ?? CHUNK;
  const cache = new Map<string, string | null>();
  /** Clés dont la valeur gardée est sûre : écrite par Quai ou lue par une lecture stricte (jamais un échec). */
  const sure = new Set<string>();

  const clean = (v: string | null | undefined): string | null => (v === undefined || v === null || v === '' ? null : v);
  const rawGet = async (key: string): Promise<string | null> => clean(await backend.get(prefix + key));

  /** Valeur entière : la tête, puis ses morceaux s'il y en a (un morceau absent : valeur illisible, null). */
  async function read(key: string, one: (k: string) => Promise<string | null>): Promise<string | null> {
    const head = await one(key);
    if (!head || !head.startsWith(MARK)) return head;
    const n = Number(head.slice(MARK.length));
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = await one(`${key}#${i}`);
      if (p === null) return null;
      parts.push(p);
    }
    return parts.join('');
  }

  const kv: KV = {
    async get(key) {
      if (cache.has(key)) return cache.get(key) ?? null;
      const value = await read(key, rawGet);
      cache.set(key, value);
      return value;
    },
    async set(key, value) {
      cache.set(key, value || null);
      sure.add(key);
      if (value.length <= chunk) {
        await backend.set(prefix + key, value);
      } else {
        const n = Math.ceil(value.length / chunk);
        for (let i = 0; i < n; i++) await backend.set(`${prefix}${key}#${i}`, value.slice(i * chunk, (i + 1) * chunk));
        await backend.set(prefix + key, `${MARK}${n}`);
      }
    },
  };
  const strict = backend.getStrict?.bind(backend);
  if (strict) {
    kv.getStrict = async (key) => {
      if (sure.has(key)) return cache.get(key) ?? null;
      // une lecture sans réponse lève ici : rien n'est gardé, la suivante redemande au téléphone
      const value = await read(key, async (k) => clean(await strict(prefix + k)));
      // écrite pendant la lecture : la valeur écrite est la plus récente
      if (sure.has(key)) return cache.get(key) ?? null;
      cache.set(key, value);
      sure.add(key);
      return value;
    };
  }
  return kv;
}

/** KV en mémoire (tests, repli ultime). Lecture stricte : la mémoire répond toujours. */
export function memoryBackend(): KVBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const get = async (k: string): Promise<string | null> => data.get(k) ?? null;
  return {
    data,
    get,
    getStrict: get,
    async set(k, v) {
      if (v === '') data.delete(k);
      else data.set(k, v);
    },
  };
}

/**
 * localStorage du navigateur (développement hors de l'appli Even). Lecture stricte : localStorage répond toujours, tout
 * de suite (stockage interdit : la mémoire de la visite, où vont aussi les écritures).
 */
export function localStorageBackend(): KVBackend {
  const mem = memoryBackend();
  const get = async (k: string): Promise<string | null> => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return mem.get(k);
    }
  };
  return {
    get,
    getStrict: get,
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
