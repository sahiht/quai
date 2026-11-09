/**
 * File d'appels au pont : un appel à la fois (le lien BLE et le pont ne supportent pas bien les
 * appels concurrents : affichage et stockage partagent le même canal), avec priorité à l'affichage
 * et un délai maximal par appel (un saut BLE défaillant peut bloquer ~30 s). Ne lève jamais.
 */
type Lane = 'high' | 'low';
interface Task {
  label: string;
  run: () => Promise<unknown>;
  fallback: unknown;
  timeoutMs: number;
  resolve: (v: unknown) => void;
}

export class SerialQueue {
  private lanes: Record<Lane, Task[]> = { high: [], low: [] };
  private busy = false;

  constructor(private timeoutMs = 4000) {}

  get size(): number {
    return this.lanes.high.length + this.lanes.low.length + (this.busy ? 1 : 0);
  }

  run<T>(label: string, fn: () => Promise<T>, fallback: T, opts: { lane?: Lane; timeoutMs?: number } = {}): Promise<T> {
    return new Promise<T>((resolve) => {
      this.lanes[opts.lane ?? 'high'].push({
        label,
        run: fn,
        fallback,
        timeoutMs: opts.timeoutMs ?? this.timeoutMs,
        resolve: resolve as (v: unknown) => void,
      });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const task = this.lanes.high.shift() ?? this.lanes.low.shift();
        if (!task) break;
        task.resolve(await withTimeout(task.label, task.run, task.fallback, task.timeoutMs));
      }
    } finally {
      this.busy = false;
    }
  }
}

export async function withTimeout<T>(label: string, fn: () => Promise<T>, fallback: T, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[Quai] ${label} : pas de réponse après ${ms} ms`);
          resolve(fallback);
        }, ms);
      }),
    ]);
  } catch (err) {
    console.warn(`[Quai] ${label} : échec`, err instanceof Error ? err.message : err);
    return fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Promesse avec délai qui rejette (appels au cœur : on veut afficher l'erreur). */
export function deadline<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
