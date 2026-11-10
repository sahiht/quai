/**
 * Quai Web : configuration du build (npm run build:web), lue dans l'environnement.
 *   QUAI_DATA_BASE   adresse https des données, sans / final (comme npm run configure)
 *   QUAI_RELAY_BASE  adresse https du relais, sans / final (comme npm run configure)
 *   QUAI_WEB_BASE    chemin de publication de la page, défaut /quai/app/ (GitHub Pages : /<dépôt>/app/)
 * Le paquet des lunettes (app.json, src/generated/config.ts) n'est jamais modifié.
 */
import { APP_VERSION, ConfigError, readConfig } from './manifest.mjs';

export const DEFAULT_WEB_BASE = '/quai/app/';

/** Chemin de publication : commence et finit par « / », sans espace, paramètre, ancre ni « // ». */
export function normalizeWebBase(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_WEB_BASE;
  if (!raw.startsWith('/') || !raw.endsWith('/')) {
    throw new ConfigError(`QUAI_WEB_BASE doit commencer et finir par « / », par exemple /quai/app/ (reçu « ${raw} »).`);
  }
  if (/[\s?#\\]/.test(raw) || raw.includes('//') || raw.split('/').some((p) => p === '..' || p === '.')) {
    throw new ConfigError(`QUAI_WEB_BASE n’est pas un chemin valide : « ${raw} ».`);
  }
  return raw;
}

/**
 * Configuration complète. Build : les deux adresses sont obligatoires (messages en français si elles manquent
 * ou sont invalides). Développement (requireBases faux) : adresses facultatives (?e2e=1&data=…&relay=… ou ?fake=1).
 */
export function webBuildConfig(env, { requireBases = true } = {}) {
  const base = normalizeWebBase(env.QUAI_WEB_BASE);
  if (!requireBases && !env.QUAI_DATA_BASE && !env.QUAI_RELAY_BASE) return { base, dataBase: '', relayBase: '', version: APP_VERSION };
  const missing = ['QUAI_DATA_BASE', 'QUAI_RELAY_BASE'].filter((k) => !String(env[k] ?? '').trim());
  if (missing.length) {
    throw new ConfigError(
      `${missing.length > 1 ? 'Variables manquantes' : 'Variable manquante'} : ${missing.join(', ')}. ` +
        'Exemple : QUAI_DATA_BASE=https://moi.github.io/quai/data QUAI_RELAY_BASE=https://quai-relais.vercel.app npm run build:web',
    );
  }
  const { dataBase, relayBase } = readConfig(env);
  return { base, dataBase, relayBase, version: APP_VERSION };
}

export { ConfigError };
