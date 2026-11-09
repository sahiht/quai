/**
 * Cache persistant « au mieux » des fichiers statiques dans le KV fourni par l'interface
 * (stockage local du SDK Even, qui passe par le pont de l'appli : appels lents, à sérialiser).
 *
 * - Validité : meta.generatedAt (une génération par nuit) ; une nouvelle génération invalide tout.
 * - Taille bornée : SLOTS emplacements fixes de SLOT_CHARS caractères (clés réutilisées, jamais d'effacement
 *   à faire) ; un fichier occupe 1 à MAX_SLOTS_PER_FILE emplacements ; les plus anciens sont réutilisés d'abord.
 * - Index en mémoire (lu une fois) : on ne lit le KV que pour un fichier réellement enregistré.
 * - Tous les appels KV passent par une file unique, un à la fois, avec un délai maximal de 3 s.
 * - Écritures réduites : l'index n'est réécrit qu'une fois par rafale d'enregistrements.
 * Toute erreur est ignorée : le réseau prend le relais.
 */
import type { KV } from './api';

const PREFIX = 'quai.core.v1.';
const IDX_KEY = `${PREFIX}idx`;
const META_KEY = `${PREFIX}meta`;
const slotKey = (i: number) => `${PREFIX}slot.${i}`;

export const SLOT_CHARS = 50_000;
export const SLOTS = 24; // 1,2 million de caractères au plus
export const MAX_SLOTS_PER_FILE = 4;
const KV_TIMEOUT_MS = 3_000;

interface Item {
  path: string;
  slots: number[];
  len: number;
}
interface Index {
  gen: string;
  items: Item[]; // du plus ancien au plus récent
}

export interface PersistOptions {
  slots?: number;
  slotChars?: number;
  maxSlotsPerFile?: number;
  timeoutMs?: number;
}

export class PersistentCache {
  private index: Index | null = null;
  private indexLoad: Promise<Index | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private indexDirty = false;
  private indexWriteQueued = false;
  private readonly slots: number;
  private readonly slotChars: number;
  private readonly maxSlotsPerFile: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly kv: KV,
    opts: PersistOptions = {},
  ) {
    this.slots = opts.slots ?? SLOTS;
    this.slotChars = opts.slotChars ?? SLOT_CHARS;
    this.maxSlotsPerFile = opts.maxSlotsPerFile ?? MAX_SLOTS_PER_FILE;
    this.timeoutMs = opts.timeoutMs ?? KV_TIMEOUT_MS;
  }

  async getMeta(): Promise<string | null> {
    return (await this.run(() => this.kv.get(META_KEY), null)) || null;
  }

  putMeta(text: string): void {
    if (text.length <= this.slotChars) void this.run(() => this.kv.set(META_KEY, text), undefined);
  }

  /** Contenu enregistré d'un fichier pour cette génération, sinon null. */
  async get(gen: string, path: string): Promise<string | null> {
    await this.loadIndex();
    const idx = this.index;
    const item = idx && idx.gen === gen ? idx.items.find((x) => x.path === path) : undefined;
    if (!item) return null;
    let text = '';
    for (const s of item.slots) {
      const part = await this.run(() => this.kv.get(slotKey(s)), null);
      if (!part) return null;
      text += part;
    }
    const guard = `${gen}|${path}\n`;
    if (!text.startsWith(guard)) return null;
    const body = text.slice(guard.length);
    return body.length === item.len ? body : null;
  }

  /** Enregistre un fichier (en arrière-plan). Trop gros : ignoré. */
  put(gen: string, path: string, text: string): void {
    const value = `${gen}|${path}\n${text}`;
    const n = Math.ceil(value.length / this.slotChars);
    if (n > this.maxSlotsPerFile || n > this.slots) return;
    void this.loadIndex().then(async () => {
      const idx = this.useGeneration(gen);
      if (idx.items.some((x) => x.path === path)) return;
      const used = new Set(idx.items.flatMap((x) => x.slots));
      const free = () => Array.from({ length: this.slots }, (_, i) => i).filter((i) => !used.has(i));
      while (free().length < n && idx.items.length) {
        const old = idx.items.shift();
        for (const s of old?.slots ?? []) used.delete(s);
      }
      const slots = free().slice(0, n);
      if (slots.length < n) return;
      const item: Item = { path, slots, len: text.length };
      idx.items.push(item);
      this.indexDirty = true;
      // tous les morceaux dans une seule tâche de la file : aucune autre écriture ne s'intercale
      const ok = await this.run(
        async () => {
          for (let k = 0; k < n; k++) await this.kv.set(slotKey(slots[k]), value.slice(k * this.slotChars, (k + 1) * this.slotChars));
          return true;
        },
        false,
        n,
      );
      if (!ok) idx.items = idx.items.filter((x) => x !== item);
      this.scheduleIndexWrite();
    });
  }

  /** Nouvelle génération de données : l'index repart de zéro (les emplacements seront réécrits). */
  setGeneration(gen: string): void {
    void this.loadIndex().then(() => {
      if (!this.index || this.index.gen !== gen) {
        this.useGeneration(gen);
        this.scheduleIndexWrite();
      }
    });
  }

  /** Attend la fin des appels KV en cours (tests). */
  async flush(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await this.queue;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** Index courant pour cette génération (remis à zéro si la génération change). */
  private useGeneration(gen: string): Index {
    if (!this.index || this.index.gen !== gen) {
      this.index = { gen, items: [] };
      this.indexDirty = true;
    }
    return this.index;
  }

  private scheduleIndexWrite(): void {
    if (this.indexWriteQueued) return;
    this.indexWriteQueued = true;
    void this.run(async () => {
      this.indexWriteQueued = false;
      if (!this.indexDirty || !this.index) return;
      this.indexDirty = false;
      await this.kv.set(IDX_KEY, JSON.stringify(this.index));
    }, undefined);
  }

  private loadIndex(): Promise<Index | null> {
    if (this.index) return Promise.resolve(this.index);
    if (!this.indexLoad) {
      this.indexLoad = this.run(() => this.kv.get(IDX_KEY), null).then((raw) => {
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        if (!this.index && isIndex(parsed, this.slots)) this.index = parsed;
        return this.index;
      });
    }
    return this.indexLoad;
  }

  /** File unique : un appel KV à la fois, délai maximal (× nombre d'appels groupés), erreur → valeur de repli. */
  private run<T>(op: () => Promise<T>, fallback: T, calls = 1): Promise<T> {
    const p = this.queue.then(() => withTimeout(op(), this.timeoutMs * calls)).then(
      (v) => v,
      () => fallback,
    );
    this.queue = p;
    return p;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('délai KV dépassé')), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isIndex(x: unknown, slots: number): x is Index {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as { gen?: unknown; items?: unknown };
  if (typeof o.gen !== 'string' || !Array.isArray(o.items)) return false;
  return o.items.every(
    (it: unknown) =>
      typeof it === 'object' &&
      it !== null &&
      typeof (it as Item).path === 'string' &&
      typeof (it as Item).len === 'number' &&
      Array.isArray((it as Item).slots) &&
      (it as Item).slots.every((s) => Number.isInteger(s) && s >= 0 && s < slots),
  );
}
