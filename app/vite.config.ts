import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { APP_VERSION } from './scripts/manifest.mjs';

const CORE_ENTRY = fileURLToPath(new URL('./src/core/index.ts', import.meta.url));

/**
 * Le cœur (app/src/core/index.ts) est écrit par une autre équipe. S'il manque, le build
 * échoue avec un message clair, uniquement sur ce fichier. En développement (vite),
 * l'appli reste utilisable avec ?fake=1.
 */
function coreGuard(): Plugin {
  return {
    name: 'quai-core-guard',
    buildStart() {
      if (!existsSync(CORE_ENTRY)) {
        this.error(
          'Fichier manquant : app/src/core/index.ts (équipe cœur). ' +
            "L'appli attend les exports createCore(opts) et dataFreshness(meta, now). " +
            'Le reste de l’interface est prêt ; en développement, utilisez ?fake=1.',
        );
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  // Chemins relatifs : le paquet .ehpk est servi depuis un dossier local de l'appli Even.
  base: './',
  // Version de app.json, affichée sur le téléphone (src/version.ts).
  define: { __QUAI_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: command === 'build' ? [coreGuard()] : [],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    fs: { allow: ['..'] },
  },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
}));
