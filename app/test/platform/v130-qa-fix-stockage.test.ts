/**
 * Quai 1.3.0, corrections du contrôle technique, points 2 et 3 : lecture stricte du stockage (KV.getStrict), additive et
 * facultative. Clé absente : null ; lecture sans réponse (le pont de l'appli Even rend '' au bout de 5 s) : exception,
 * jamais gardée en cache ; la lecture simple ne change pas. Appli Even (bridgeStorage et sa file), navigateur (Quai Web,
 * développement), mémoire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeStorage } from '../../src/platform/even';
import { CHUNK, createKV, localStorageBackend, memoryBackend, type KVBackend } from '../../src/platform/kv';
import { SerialQueue } from '../../src/platform/queue';
import { webStorageBackend } from '../../src/web/storage';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Support en mémoire dont on règle les réponses : `fail` vrai, toute lecture (simple ou stricte) est sans réponse. */
function flaky() {
  const data = new Map<string, string>();
  let fail = false;
  const asked: string[] = [];
  const backend: KVBackend = {
    async get(k) {
      asked.push(`get ${k}`);
      return fail ? '' : (data.get(k) ?? null);
    },
    async getStrict(k) {
      asked.push(`strict ${k}`);
      if (fail) throw new Error('sans réponse');
      return data.get(k) ?? null;
    },
    async set(k, v) {
      if (v === '') data.delete(k);
      else data.set(k, v);
    },
  };
  return { backend, data, asked, failing: (on: boolean) => (fail = on) };
}

describe('createKV : lecture stricte', () => {
  it('clé absente : null ; valeur présente : la valeur ; sans réponse : exception, rien gardé, la lecture suivante redemande', async () => {
    const f = flaky();
    const kv = createKV(f.backend);
    expect(await kv.getStrict!('quai.journal')).toBeNull();
    f.data.set('quai.trip', '{"v":1}');
    f.failing(true);
    await expect(kv.getStrict!('quai.trip')).rejects.toThrow('sans réponse');
    await expect(kv.getStrict!('quai.trip')).rejects.toThrow('sans réponse');
    f.failing(false);
    expect(await kv.getStrict!('quai.trip')).toBe('{"v":1}');
    // lue une fois avec succès : gardée (la lecture simple la rend aussi, sans redemander)
    const n = f.asked.length;
    expect(await kv.getStrict!('quai.trip')).toBe('{"v":1}');
    expect(await kv.get('quai.trip')).toBe('{"v":1}');
    expect(f.asked.length).toBe(n);
  });

  it('la lecture simple ne change pas (elle garde le vide d’une lecture sans réponse) ; la lecture stricte ne s’y fie pas', async () => {
    const f = flaky();
    const kv = createKV(f.backend);
    f.data.set('quai.journal', '{"v":1,"trips":[]}');
    f.failing(true);
    expect(await kv.get('quai.journal')).toBeNull();
    f.failing(false);
    // comme avant : le vide est gardé pour la lecture simple
    expect(await kv.get('quai.journal')).toBeNull();
    // la lecture stricte redemande, et sa réponse sert ensuite à tous
    expect(await kv.getStrict!('quai.journal')).toBe('{"v":1,"trips":[]}');
    expect(await kv.get('quai.journal')).toBe('{"v":1,"trips":[]}');
  });

  it('valeur écrite par Quai : rendue telle quelle, sans redemander ; écrite pendant une lecture : la valeur écrite gagne', async () => {
    const f = flaky();
    const kv = createKV(f.backend);
    await kv.set('quai.settings', '{"v":4}');
    f.failing(true);
    expect(await kv.getStrict!('quai.settings')).toBe('{"v":4}');
    f.failing(false);
    // lecture en cours, écriture pendant ce temps
    let release: (v: string | null) => void = () => undefined;
    const slow: KVBackend = { ...f.backend, getStrict: () => new Promise((r) => (release = r)) };
    const kv2 = createKV(slow);
    const reading = kv2.getStrict!('quai.journal');
    await kv2.set('quai.journal', 'nouveau');
    release('ancien');
    expect(await reading).toBe('nouveau');
  });

  it('grandes valeurs découpées : lues en entier ; un morceau sans réponse : exception ; un morceau absent : null', async () => {
    const f = flaky();
    const kv = createKV(f.backend, { chunk: 10 });
    const big = 'abcdefghij'.repeat(3) + 'xyz';
    await kv.set('quai.journal', big);
    const fresh = () => createKV(f.backend, { chunk: 10 });
    expect(await fresh().getStrict!('quai.journal')).toBe(big);
    // un morceau sans réponse
    const broken: KVBackend = { ...f.backend, getStrict: async (k) => (k.endsWith('#2') ? Promise.reject(new Error('sans réponse')) : (f.data.get(k) ?? null)) };
    await expect(createKV(broken, { chunk: 10 }).getStrict!('quai.journal')).rejects.toThrow('sans réponse');
    f.data.delete('quai.journal#1');
    expect(await fresh().getStrict!('quai.journal')).toBeNull();
    expect(CHUNK).toBe(48_000);
  });

  it('support sans lecture stricte : le KV n’en a pas (le lecteur se sert de la lecture simple)', () => {
    const plain: KVBackend = { get: async () => null, set: async () => undefined };
    expect(createKV(plain).getStrict).toBeUndefined();
  });
});

describe('appli Even : lecture stricte du pont (bridgeStorage)', () => {
  function bridgeOf(get: (k: string) => Promise<string>) {
    const sets: [string, string][] = [];
    const bridge = {
      getLocalStorage: vi.fn(get),
      setLocalStorage: vi.fn(async (k: string, v: string) => {
        sets.push([k, v]);
        return true;
      }),
    };
    return { bridge, sets, backend: bridgeStorage(bridge, new SerialQueue(4000)) };
  }

  it('clé absente (vide) : null ; valeur : la valeur ; pas de réponse en 5 s ou erreur du pont : exception (la lecture simple rend null, comme avant)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store: Record<string, string> = { 'quai.trip': '{"v":1}' };
    const b = bridgeOf(async (k) => store[k] ?? '');
    expect(await b.backend.getStrict!('quai.journal')).toBeNull();
    expect(await b.backend.getStrict!('quai.trip')).toBe('{"v":1}');

    vi.useFakeTimers();
    const mute = bridgeOf(() => new Promise<string>(() => undefined));
    const strict = mute.backend.getStrict!('quai.journal').then(
      () => 'répondu',
      (e: Error) => e.message,
    );
    const simple = mute.backend.get('quai.journal');
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await strict).toBe('stockage du téléphone sans réponse');
    expect(await simple).toBeNull();
    vi.useRealTimers();

    const broken = bridgeOf(async () => Promise.reject(new Error('pont fermé')));
    await expect(broken.backend.getStrict!('quai.journal')).rejects.toThrow('stockage du téléphone sans réponse');
  });

  it('écriture pas encore partie : sa valeur, sans demander au pont', async () => {
    let done: (ok: boolean) => void = () => undefined;
    const get = vi.fn(async () => '');
    let writes = 0;
    const bridge = { getLocalStorage: get, setLocalStorage: vi.fn(() => (writes++ ? Promise.resolve(true) : new Promise<boolean>((r) => (done = r)))) };
    const backend = bridgeStorage(bridge, new SerialQueue(4000));
    // une écriture occupe le pont ; la suivante attend son tour
    const first = backend.set('quai.settings', '{"v":4}');
    void backend.set('quai.journal', '{"v":1,"trips":[]}');
    expect(await backend.getStrict!('quai.journal')).toBe('{"v":1,"trips":[]}');
    expect(get).not.toHaveBeenCalled();
    done(true);
    await first;
  });
});

describe('navigateur et mémoire : la lecture stricte répond toujours', () => {
  it('mémoire, localStorage du développement, Quai Web (stockage interdit compris) : null si absent, jamais d’exception', async () => {
    const mem = memoryBackend();
    await mem.set('quai.journal', 'x');
    expect(await mem.getStrict!('quai.journal')).toBe('x');
    expect(await mem.getStrict!('quai.trip')).toBeNull();

    const items = new Map<string, string>([['quai.journal', 'j']]);
    const store = {
      get length() {
        return items.size;
      },
      key: (i: number) => [...items.keys()][i] ?? null,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    };
    const web = webStorageBackend(store);
    expect(await web.getStrict!('quai.journal')).toBe('j');
    expect(await web.getStrict!('quai.trip')).toBeNull();
    const forbidden = webStorageBackend({
      ...store,
      getItem: () => {
        throw new Error('interdit');
      },
    });
    expect(await forbidden.getStrict!('quai.journal')).toBeNull();
    expect(await webStorageBackend(null).getStrict!('quai.journal')).toBeNull();

    // localStorage du développement : absent du test (Node) : la mémoire de la visite
    const dev = localStorageBackend();
    await dev.set('quai.journal', 'd');
    expect(await dev.getStrict!('quai.journal')).toBe('d');
    expect(await createKV(dev).getStrict!('quai.trip')).toBeNull();
  });
});
