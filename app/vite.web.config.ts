import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { ConfigError, webBuildConfig } from './scripts/web-config.mjs';

/** Même garde-fou que vite.config.ts : sans le cœur (app/src/core/index.ts), le build échoue clairement. */
function coreGuard(): Plugin {
  const entry = fileURLToPath(new URL('./src/core/index.ts', import.meta.url));
  return {
    name: 'quai-core-guard',
    buildStart() {
      if (!existsSync(entry)) this.error('Fichier manquant : app/src/core/index.ts (cœur de l’appli), indispensable à Quai Web.');
    },
  };
}

/**
 * Quai Web (npm run build:web → dist-web/) : la même appli pour un navigateur, publiée sur GitHub Pages.
 * Entrée web/index.html (icônes et manifeste dans web/public/), chemin de publication QUAI_WEB_BASE
 * (défaut /quai/app/), adresses QUAI_DATA_BASE et QUAI_RELAY_BASE inscrites dans la page au build.
 * Le build des lunettes (vite.config.ts, dist/, app.json) n'est pas concerné.
 */
export default defineConfig(({ command }) => {
  let cfg: { base: string; dataBase: string; relayBase: string; version: string };
  try {
    cfg = webBuildConfig(process.env, { requireBases: command === 'build' });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Erreur de configuration de Quai Web : ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  return {
    root: fileURLToPath(new URL('./web', import.meta.url)),
    base: cfg.base,
    publicDir: 'public',
    define: {
      __QUAI_WEB__: JSON.stringify({ dataBase: cfg.dataBase, relayBase: cfg.relayBase, version: cfg.version }),
      // Version de app.json, affichée sur le téléphone (src/version.ts).
      __QUAI_VERSION__: JSON.stringify(cfg.version),
    },
    plugins: command === 'build' ? [coreGuard()] : [],
    server: { host: true, port: 5174, strictPort: false, fs: { allow: ['..', '../..'] } },
    preview: { host: true, port: 4174 },
    build: {
      target: 'es2022',
      outDir: fileURLToPath(new URL('./dist-web', import.meta.url)),
      emptyOutDir: true,
      sourcemap: false,
      assetsInlineLimit: 0,
    },
  };
});
