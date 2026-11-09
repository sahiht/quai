/** Écriture des fichiers JSON compacts, avec un nombre limité d'écritures simultanées. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class JsonWriter {
  readonly root: string;
  files = 0;
  bytes = 0;
  private readonly concurrency: number;
  private readonly inflight = new Set<Promise<void>>();
  private readonly dirs = new Map<string, Promise<unknown>>();
  private error: unknown = null;

  constructor(root: string, concurrency = 32) {
    this.root = root;
    this.concurrency = concurrency;
  }

  private ensureDir(dir: string): Promise<unknown> {
    let p = this.dirs.get(dir);
    if (!p) {
      p = mkdir(dir, { recursive: true });
      this.dirs.set(dir, p);
    }
    return p;
  }

  /** Programme l'écriture de `rel` (chemin relatif à la racine) ; attend si trop d'écritures sont en cours. */
  async write(rel: string, data: unknown): Promise<void> {
    if (this.error) throw this.error;
    const buf = Buffer.from(JSON.stringify(data), 'utf8');
    const path = join(this.root, rel);
    this.files++;
    this.bytes += buf.length;
    const p: Promise<void> = this.ensureDir(dirname(path))
      .then(() => writeFile(path, buf))
      .catch((e: unknown) => {
        this.error ??= e;
      })
      .finally(() => {
        this.inflight.delete(p);
      });
    this.inflight.add(p);
    if (this.inflight.size >= this.concurrency) await Promise.race(this.inflight);
    if (this.error) throw this.error;
  }

  async flush(): Promise<void> {
    await Promise.all(this.inflight);
    if (this.error) throw this.error;
  }
}
