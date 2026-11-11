/**
 * Cache persistant « au mieux » des fichiers statiques dans le KV fourni par l'interface (stockage local du SDK
 * Even, qui passe par le pont de l'appli : appels lents, à sérialiser ; localStorage pour Quai Web).
 *
 * Version 2 (1.1, PRD S7, revue du 11/11) :
 * - Budget en caractères (BUDGET_CHARS), pas en nombre de fichiers : un trajet réel lit 50 à 136 fichiers
 *   (Maison → Bureau à 07:31 : 100 fichiers, 3 millions de caractères, dont 82 fichiers de ligne pour 1,2 million
 *   et le fichier de trains du jour pour 1,65 million ; avec les autres favoris du préréglage, 4,2 millions).
 *   4,5 millions de caractères : les réponses de ces favoris tiennent, et le localStorage de Quai Web (environ
 *   5 millions de caractères) garde de la place pour les réglages (s'il est plein, un paquet reste en mémoire).
 * - Paquets : plusieurs fichiers par clé KV, PACK_CHARS caractères au plus (sous le découpage de 48 000 du KV :
 *   un seul appel au pont par paquet) ; seul un fichier plus gros qu'un paquet en occupe plusieurs.
 * - Écritures groupées et limitées : un fichier à garder attend FLUSH_DELAY_MS, puis les fichiers en attente sont
 *   écrits en paquets, MAX_WRITES_PER_FLUSH clés au plus par rafale (la suite à la rafale suivante), et l'index
 *   une seule fois à la fin de la rafale.
 * - Fichiers absents (404) : notés dans l'index, sans paquet.
 * - Épinglés (index des lignes, tuiles, tuiles de lignes, trains du jour ; règle fournie par setPinned et
 *   réévaluée à chaque rafale : les trains d'hier ne le sont plus) : rangés dans leurs propres paquets, évincés
 *   seulement pour faire de la place à un autre épinglé.
 * - Éviction : les paquets les moins récemment lus d'abord, jamais (pour un fichier ordinaire) ceux lus ou écrits
 *   depuis moins de PROTECT_MS : à l'ouverture, l'accueil calcule les favoris dans l'ordre et les premiers gardent
 *   leurs fichiers ; un fichier qui ne peut pas tenir est abandonné, sans rien évincer (pas d'écritures en boucle).
 * - Clés libérées (paquets évincés, génération précédente) : réutilisées d'abord, sinon vidées dans la rafale ;
 *   la place réellement occupée dans le KV reste celle du budget.
 * - Validité : meta.generatedAt ; une nouvelle génération repart de zéro (chaque paquet porte sa génération).
 *   Les clés de la version 1 sont effacées une fois.
 * Toute erreur est ignorée : le réseau prend le relais.
 */
import type { KV } from './api';

const PREFIX = 'quai.core.v2.';
const IDX_KEY = `${PREFIX}idx`;
const META_KEY = `${PREFIX}meta`;
const packKey = (i: number) => `${PREFIX}p.${i}`;
/** Ancienne version (24 à 64 emplacements fixes) : effacée une fois. */
const V1_PREFIX = 'quai.core.v1.';

/** Séparateurs des enregistrements d'un paquet (jamais présents dans un texte JSON). */
const REC = '\u001e';
const SEP = '\u001f';
const packHeader = (gen: string) => `QP2|${gen}\n`;
/** Lecture KV en échec (distincte d'une clé absente). */
const FAILED = Symbol('échec');

export const PACK_CHARS = 47_000;
export const BUDGET_CHARS = 4_500_000;
export const FLUSH_DELAY_MS = 2_000;
export const MAX_WRITES_PER_FLUSH = 40;
/** Paquets lus ou écrits depuis moins de 10 min : jamais évincés pour un fichier ordinaire. */
export const PROTECT_MS = 10 * 60_000;
const KV_TIMEOUT_MS = 3_000;
/** Paquets lus gardés en mémoire (un paquet de tuiles sert à plusieurs lectures de suite). */
const READ_CACHE = 8;
/** Fichiers absents retenus (les plus anciens oubliés). */
const ABSENT_MAX = 500;

interface FileEntry {
  p: number[]; // paquets, dans l'ordre des morceaux
  len: number;
}
interface PackEntry {
  size: number;
  used: number;
  pin?: 1;
}
interface Index {
  v: 2;
  gen: string;
  files: Record<string, FileEntry>;
  packs: Record<string, PackEntry>;
  absent: string[];
  /** Clés qui portent encore un ancien paquet : réutilisées d'abord, sinon vidées. */
  stale?: number[];
}
interface OutPack {
  id: number;
  recs: string[];
  size: number;
  pin: boolean;
}

export interface PersistOptions {
  budgetChars?: number;
  packChars?: number;
  flushDelayMs?: number;
  maxWritesPerFlush?: number;
  timeoutMs?: number;
  now?: () => number;
  /** Fichiers épinglés (réévalué à chaque rafale). */
  pinned?: (path: string) => boolean;
}

export class PersistentCache {
  private index: Index | null = null;
  private indexLoad: Promise<Index | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, { gen: string; text: string }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushRun: Promise<void> | null = null;
  private indexDirty = false;
  /** Dernière lecture de l'index en échec : aucune écriture. */
  private indexUnknown = false;
  /** Génération courante (setGeneration) : un fichier d'une autre génération, arrivé en retard, est ignoré. */
  private gen: string | null = null;
  private readonly readCache = new Map<number, { gen: string; recs: Map<string, string> }>();
  private readonly budget: number;
  private readonly packChars: number;
  private readonly flushDelay: number;
  private readonly maxWrites: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private pinned: (path: string) => boolean;
  /** Nombre d'écritures KV (tests, mesures). */
  writes = 0;

  constructor(
    private readonly kv: KV,
    opts: PersistOptions = {},
  ) {
    this.budget = opts.budgetChars ?? BUDGET_CHARS;
    this.packChars = opts.packChars ?? PACK_CHARS;
    this.flushDelay = opts.flushDelayMs ?? FLUSH_DELAY_MS;
    this.maxWrites = opts.maxWritesPerFlush ?? MAX_WRITES_PER_FLUSH;
    this.timeoutMs = opts.timeoutMs ?? KV_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
    this.pinned = opts.pinned ?? (() => false);
  }

  /** Règle des fichiers épinglés (fournie par le client des données, qui connaît leur rôle). */
  setPinned(rule: (path: string) => boolean): void {
    this.pinned = rule;
  }

  private get maxPacks(): number {
    return 4 * Math.ceil(this.budget / this.packChars) + 8;
  }

  async getMeta(): Promise<string | null> {
    return (await this.run(() => this.kv.get(META_KEY), null)) || null;
  }

  putMeta(text: string): void {
    void this.run(() => this.set(META_KEY, text), undefined);
  }

  /** Contenu enregistré d'un fichier pour cette génération, sinon null. */
  async get(gen: string, path: string): Promise<string | null> {
    const pend = this.pending.get(path);
    if (pend && pend.gen === gen) return pend.text;
    await this.loadIndex();
    const idx = this.index;
    const e = idx && idx.gen === gen ? idx.files[path] : undefined;
    if (!idx || !e) return null;
    let text = '';
    for (const id of e.p) {
      const recs = await this.readPack(id, gen);
      const piece = recs?.get(path);
      if (piece === undefined) return null;
      text += piece;
    }
    if (text.length !== e.len) return null;
    // fichier utile : ses paquets passent en dernier dans l'ordre d'éviction (index réécrit avec la rafale suivante)
    const t = this.now();
    for (const id of e.p) {
      const pk = idx.packs[id];
      if (pk) pk.used = t;
    }
    this.indexDirty = true;
    this.schedule();
    return text;
  }

  /** Vrai si le fichier est connu absent (404) pour cette génération. */
  async absent(gen: string, path: string): Promise<boolean> {
    await this.loadIndex();
    return !!this.index && this.index.gen === gen && this.index.absent.includes(path);
  }

  /** Garde un fichier (écrit avec la rafale suivante). Plus gros que la moitié du budget : ignoré. */
  put(gen: string, path: string, text: string): void {
    if (this.gen !== null && gen !== this.gen) return;
    if (text.length + path.length + 2 > this.budget / 2) return;
    if (this.index && this.index.gen === gen && this.index.files[path]) return;
    this.pending.set(path, { gen, text });
    this.schedule();
  }

  /** Note un fichier absent de la publication (404), sans paquet. */
  markAbsent(gen: string, path: string): void {
    if (this.gen !== null && gen !== this.gen) return;
    void this.loadIndex().then(() => {
      if (this.indexUnknown || (this.gen !== null && gen !== this.gen)) return;
      const idx = this.useGeneration(gen);
      if (idx.absent.includes(path)) return;
      idx.absent.push(path);
      if (idx.absent.length > ABSENT_MAX) idx.absent.splice(0, idx.absent.length - ABSENT_MAX);
      this.indexDirty = true;
      this.schedule();
    });
  }

  /** Nouvelle génération de données : l'index repart de zéro (les clés des paquets seront réutilisées). */
  setGeneration(gen: string): void {
    this.gen = gen;
    for (const [p, v] of this.pending) if (v.gen !== gen) this.pending.delete(p);
    void this.loadIndex().then(() => {
      if (this.indexUnknown || this.gen !== gen) return;
      if (!this.index || this.index.gen !== gen) {
        this.useGeneration(gen);
        this.schedule();
      }
    });
  }

  /** Écrit tout de suite ce qui attend et attend la fin des appels KV (tests, fermeture). */
  async flush(): Promise<void> {
    for (let i = 0; i < 20 && (this.pending.size || this.indexDirty || this.flushRun); i++) {
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      await (this.flushRun ?? this.startFlush());
    }
    await this.queue;
  }

  /* ------------------------------ interne ------------------------------ */

  private schedule(): void {
    if (this.flushTimer !== null || this.flushRun) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.startFlush();
    }, this.flushDelay);
  }

  private startFlush(): Promise<void> {
    if (!this.flushRun) {
      this.flushRun = this.doFlush()
        .catch(() => undefined)
        .finally(() => {
          this.flushRun = null;
          if (this.pending.size || this.indexDirty) this.schedule();
        });
    }
    return this.flushRun;
  }

  /**
   * Une rafale : les fichiers en attente rangés en paquets (épinglés d'abord, dans leurs propres paquets) ; la place
   * est faite avant chaque fichier ; un fichier qui ne peut pas tenir est abandonné (jamais réessayé) ;
   * MAX_WRITES_PER_FLUSH clés au plus (le reste attend la rafale suivante) ; l'index une fois à la fin.
   */
  private async doFlush(): Promise<void> {
    await this.loadIndex();
    if (this.indexUnknown) {
      this.pending.clear(); // le réseau prend le relais
      return;
    }
    // génération courante, sinon celle du dernier fichier en attente (l'index d'une autre repart de zéro)
    const target = this.gen ?? [...this.pending.values()].at(-1)?.gen;
    const idx = target !== undefined ? this.useGeneration(target) : this.index;
    if (!idx) return;
    this.repin(idx);
    const items: { path: string; text: string; pin: boolean }[] = [];
    for (const [path, v] of this.pending) {
      if (v.gen !== idx.gen || idx.files[path]) this.pending.delete(path);
      else items.push({ path, text: v.text, pin: this.pinned(path) });
    }
    items.sort((a, b) => Number(b.pin) - Number(a.pin));
    const head = packHeader(idx.gen).length;
    const out: OutPack[] = [];
    const done: string[] = [];
    let cur: OutPack | null = null;
    for (const { path, text, pin } of items) {
      const recHead = path.length + 2;
      const per = this.packChars - head - recHead; // place d'un morceau dans un paquet neuf
      if (per <= 0) {
        this.pending.delete(path);
        continue;
      }
      // épinglés et ordinaires dans des paquets distincts ; un petit fichier n'est pas coupé en deux
      if (cur && (cur.pin !== pin || (text.length > this.packChars - cur.size - recHead && text.length <= per))) cur = null;
      const room = cur ? Math.max(0, this.packChars - cur.size - recHead) : 0;
      const fresh = Math.max(cur ? 0 : 1, Math.ceil(Math.max(0, text.length - room) / per));
      if (done.length && out.length + fresh > this.maxWrites) break; // la suite à la rafale suivante
      const inBurst = out.reduce((n, p) => n + p.size, 0);
      if (!this.makeRoom(inBurst + text.length + (fresh + 1) * (recHead + head), pin)) {
        this.pending.delete(path); // ne peut pas tenir : abandonné
        continue;
      }
      const ids: number[] = [];
      let rest = text;
      let failed = false;
      do {
        if (!cur || cur.size + recHead >= this.packChars) {
          const id = this.freeId(out, pin);
          if (id === null) {
            failed = true;
            break;
          }
          cur = { id, recs: [], size: head, pin };
          out.push(cur);
        }
        const n = this.packChars - cur.size - recHead;
        cur.recs.push(REC + path + SEP + rest.slice(0, n));
        cur.size += recHead + Math.min(n, rest.length);
        rest = rest.slice(n);
        ids.push(cur.id);
      } while (rest.length);
      this.pending.delete(path);
      if (failed) {
        // plus aucune clé : les morceaux déjà rangés de ce fichier sont retirés, la rafale s'arrête là
        const mine = REC + path + SEP;
        for (const p of out) {
          p.recs = p.recs.filter((r) => !r.startsWith(mine));
          p.size = head + p.recs.reduce((n, r) => n + r.length, 0);
        }
        for (let i = out.length - 1; i >= 0; i--) if (!out[i].recs.length) out.splice(i, 1);
        break;
      }
      idx.files[path] = { p: ids, len: text.length };
      done.push(path);
    }
    const t = this.now();
    for (const p of out) idx.packs[p.id] = { size: p.size, used: t, ...(p.pin ? { pin: 1 as const } : {}) };
    const written = new Set(out.map((p) => p.id));
    const stale = (idx.stale ?? []).filter((i) => !written.has(i));
    const clear = stale.slice(0, Math.max(0, this.maxWrites - out.length));
    if (!out.length && !clear.length && !this.indexDirty) return;
    // paquets écrits dans une seule tâche de la file : aucune autre écriture ne s'intercale
    const ok = await this.run(
      async () => {
        for (const p of out) {
          this.readCache.delete(p.id);
          await this.set(packKey(p.id), packHeader(idx.gen) + p.recs.join(''));
        }
        for (const i of clear) await this.set(packKey(i), '');
        return true;
      },
      false,
      Math.max(1, out.length + clear.length),
    );
    if (ok) idx.stale = stale.slice(clear.length);
    else {
      for (const path of done) delete idx.files[path];
      for (const p of out) delete idx.packs[p.id];
      idx.stale = [...new Set([...stale, ...written])]; // contenu incertain : à vider plus tard
    }
    this.indexDirty = false;
    await this.run(() => this.set(IDX_KEY, JSON.stringify(idx)), undefined);
    // clés encore à vider : une autre rafale, si celle-ci a avancé
    if (ok && clear.length && idx.stale.length) this.indexDirty = true;
  }

  /** Paquets épinglés selon la règle du moment (un paquet l'est s'il porte un fichier épinglé). */
  private repin(idx: Index): void {
    const keep = new Set<number>();
    for (const [path, e] of Object.entries(idx.files)) if (this.pinned(path)) for (const n of e.p) keep.add(n);
    for (const [k, p] of Object.entries(idx.packs)) {
      const pin = keep.has(Number(k));
      if (pin === !!p.pin) continue;
      if (pin) p.pin = 1;
      else delete p.pin;
      this.indexDirty = true;
    }
  }

  /**
   * Fait de la place pour `chars` caractères (paquets de la rafale compris) en évinçant les paquets les moins
   * récemment lus (evictable). Faux, sans rien évincer, si c'est impossible.
   */
  private makeRoom(chars: number, pin: boolean): boolean {
    const idx = this.index!;
    const t = this.now();
    let kept = 0;
    let total = 0;
    for (const p of Object.values(idx.packs)) {
      total += p.size;
      if (!this.evictable(p, pin, t)) kept += p.size;
    }
    if (kept + chars > this.budget) return false;
    while (total + chars > this.budget) {
      if (!this.evictOne(pin)) return false;
      total = Object.values(idx.packs).reduce((n, p) => n + p.size, 0);
    }
    return true;
  }

  /** Un fichier ordinaire n'évince que des paquets ordinaires lus depuis plus de PROTECT_MS ; un épinglé, tout. */
  private evictable(p: PackEntry, pin: boolean, now: number): boolean {
    return pin || (!p.pin && (p.used < now - PROTECT_MS || p.used > now));
  }

  /** Clé pour un nouveau paquet : d'abord une clé à réécrire de toute façon, puis la plus petite libre. */
  private freeId(out: readonly OutPack[], pin: boolean): number | null {
    const idx = this.index!;
    const taken = (i: number) => !!idx.packs[i] || out.some((p) => p.id === i);
    for (;;) {
      const s = (idx.stale ?? []).find((i) => !taken(i));
      if (s !== undefined) return s;
      for (let i = 0; i < this.maxPacks; i++) if (!taken(i)) return i;
      if (!this.evictOne(pin)) return null;
    }
  }

  /**
   * Évince le paquet évinçable le moins récemment lu (ordinaires d'abord), ses fichiers et les paquets qui n'en
   * portent plus aucun ; leurs clés sont à réutiliser ou à vider.
   */
  private evictOne(pin: boolean): boolean {
    const idx = this.index!;
    const t = this.now();
    const ids = Object.keys(idx.packs).filter((id) => this.evictable(idx.packs[id], pin, t));
    const pick = (p: boolean) =>
      ids.filter((id) => !!idx.packs[id].pin === p).sort((a, b) => idx.packs[a].used - idx.packs[b].used || Number(a) - Number(b))[0];
    const id = pick(false) ?? pick(true);
    if (id === undefined) return false;
    for (const [path, e] of Object.entries(idx.files)) if (e.p.includes(Number(id))) delete idx.files[path];
    const live = new Set(Object.values(idx.files).flatMap((e) => e.p));
    const stale = new Set(idx.stale ?? []);
    for (const k of Object.keys(idx.packs)) {
      if (k !== id && live.has(Number(k))) continue;
      delete idx.packs[k];
      this.readCache.delete(Number(k));
      stale.add(Number(k));
    }
    idx.stale = [...stale];
    this.indexDirty = true;
    return true;
  }

  private async readPack(id: number, gen: string): Promise<Map<string, string> | null> {
    const hit = this.readCache.get(id);
    if (hit && hit.gen === gen) {
      this.readCache.delete(id);
      this.readCache.set(id, hit);
      return hit.recs;
    }
    const raw = await this.run(() => this.kv.get(packKey(id)), null);
    const head = packHeader(gen);
    if (!raw || !raw.startsWith(head)) return null;
    const recs = new Map<string, string>();
    for (const r of raw.slice(head.length).split(REC)) {
      if (!r) continue;
      const k = r.indexOf(SEP);
      if (k > 0) recs.set(r.slice(0, k), r.slice(k + 1));
    }
    this.readCache.set(id, { gen, recs });
    while (this.readCache.size > READ_CACHE) {
      const oldest = this.readCache.keys().next().value;
      if (oldest === undefined) break;
      this.readCache.delete(oldest);
    }
    return recs;
  }

  /** Index courant pour cette génération (remis à zéro si la génération change ; anciennes clés à réutiliser). */
  private useGeneration(gen: string): Index {
    if (!this.index || this.index.gen !== gen) {
      const old = this.index;
      const stale = old ? [...new Set([...(old.stale ?? []), ...Object.keys(old.packs).map(Number)])] : [];
      this.index = { v: 2, gen, files: {}, packs: {}, absent: [], stale };
      this.readCache.clear();
      this.indexDirty = true;
    }
    return this.index;
  }

  /**
   * Index enregistré. Lecture en échec (pont lent, erreur) : rien n'est écrit tant qu'il n'est pas connu (nouvel
   * essai au prochain accès), pour ne jamais écraser des paquets qu'il référence. Index illisible : ses clés sont à
   * vider.
   */
  private loadIndex(): Promise<Index | null> {
    if (this.index) return Promise.resolve(this.index);
    if (!this.indexLoad) {
      this.indexLoad = this.run<string | null | typeof FAILED>(() => this.kv.get(IDX_KEY), FAILED).then((raw) => {
        if (raw === FAILED) {
          this.indexLoad = null;
          this.indexUnknown = true;
          return null;
        }
        this.indexUnknown = false;
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = undefined;
        }
        if (!this.index && isIndex(parsed, this.maxPacks)) this.index = parsed;
        else if (!this.index && raw) {
          // index illisible (autre version, contenu abîmé) : génération inconnue, toutes ses clés à vider
          const packs = typeof parsed === 'object' && parsed !== null ? (parsed as { packs?: unknown }).packs : undefined;
          const ids = typeof packs === 'object' && packs !== null ? Object.keys(packs).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 1_000) : [...Array(this.maxPacks).keys()];
          this.index = { v: 2, gen: '', files: {}, packs: {}, absent: [], stale: ids };
        }
        if (!raw) this.dropV1();
        return this.index;
      });
    }
    return this.indexLoad;
  }

  /** Première ouverture en version 2 : les emplacements de la version 1 sont effacés (une fois). */
  private dropV1(): void {
    void this.run(
      async () => {
        const raw = await this.kv.get(`${V1_PREFIX}idx`);
        if (!raw) return;
        let slots: number[] = [];
        try {
          const old = JSON.parse(raw) as { items?: { slots?: number[] }[] };
          slots = (old.items ?? []).flatMap((x) => x.slots ?? []).filter((s) => Number.isInteger(s) && s >= 0 && s < 200);
        } catch {
          slots = [];
        }
        for (const s of new Set(slots)) await this.set(`${V1_PREFIX}slot.${s}`, '');
        await this.set(`${V1_PREFIX}idx`, '');
        await this.set(`${V1_PREFIX}meta`, '');
      },
      undefined,
      10,
    );
  }

  private set(key: string, value: string): Promise<void> {
    this.writes++;
    return this.kv.set(key, value);
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

function isIndex(x: unknown, maxPacks: number): x is Index {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Partial<Index>;
  if (o.v !== 2 || typeof o.gen !== 'string' || typeof o.files !== 'object' || o.files === null || typeof o.packs !== 'object' || o.packs === null || !Array.isArray(o.absent)) return false;
  const okPack = (k: string) => Number.isInteger(Number(k)) && Number(k) >= 0 && Number(k) < maxPacks;
  return (
    Object.keys(o.packs).every(okPack) &&
    (o.stale === undefined || (Array.isArray(o.stale) && o.stale.every((n) => okPack(String(n))))) &&
    Object.values(o.files).every((e) => !!e && Array.isArray(e.p) && e.p.every((n) => okPack(String(n)) && !!o.packs![n]) && typeof e.len === 'number')
  );
}
