/**
 * Version de Quai affichée sur le téléphone (écran Données, « Version de Quai   1.1.0 »).
 * Source unique : app.json. Les builds (vite.config.ts, vite.web.config.ts) l'inscrivent dans le code par
 * __QUAI_VERSION__ ; les tests (vitest, sans ces configurations) relisent app.json.
 */
import manifest from '../app.json';

declare const __QUAI_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __QUAI_VERSION__ === 'string' && __QUAI_VERSION__ ? __QUAI_VERSION__ : manifest.version;

/** Compare deux versions x.y.z : négatif si a < b, 0 si égales, positif si a > b (une version illisible vaut 0.0.0). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => (/^\d+\.\d+\.\d+$/.test(v.trim()) ? v.trim().split('.').map(Number) : [0, 0, 0]);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
