/**
 * Démarrage commun à l'appli Even (main.ts) et à Quai Web (web/main.ts) : chargement du cœur,
 * stockage préfixé du cache, réglages du mode test (?e2e=1&reset=1&preset=…).
 */
import type { Core, CoreOptions, KV, Meta } from './core/api';
import type { Env } from './env';
import type { Freshness } from './glasses/controller';
import { clearSettings, migrateSettings, saveSettings } from './settings';

export interface CoreModule {
  createCore(opts: CoreOptions): Core;
  dataFreshness(meta: Meta, now: number): Freshness;
}

/** KV préfixé (cache du cœur séparé des réglages). */
export function prefixed(kv: KV, prefix: string): KV {
  return { get: (k) => kv.get(prefix + k), set: (k, v) => kv.set(prefix + k, v) };
}

/** Charge le cœur ; un échec de chargement passager (WebView qui démarre) est retenté deux fois. */
export async function loadCore(fake: boolean): Promise<CoreModule> {
  for (let attempt = 1; ; attempt++) {
    try {
      return fake ? await import('./dev/fake-core') : await import('./core/index');
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

/** Mode test : remise à zéro des réglages, puis réglages de démonstration (fichier JSON servi en local). */
export async function applyTestSettings(env: Pick<Env, 'reset' | 'preset'>, kv: KV): Promise<void> {
  if (env.reset) await clearSettings(kv);
  if (!env.preset) return;
  try {
    const r = await fetch(env.preset);
    if (r.ok) await saveSettings(kv, migrateSettings(await r.json()));
    else console.warn(`[Quai] preset ${env.preset} : HTTP ${r.status}`);
  } catch (e) {
    console.warn('[Quai] preset illisible', e);
  }
}
