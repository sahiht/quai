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
 * 1.2.5 (PRD-1.2.5 § 9) : la page publiée ne charge que ses propres fichiers et ne parle qu'aux adresses des données et
 * du relais (politique de sécurité du contenu) ; elle ne dit pas d'où viennent les visites (aucun référent).
 * QUAI_WEB_CSP_LOCAL=1 (essais de bout en bout seulement) : aussi les serveurs de la machine (127.0.0.1, localhost).
 */
export function webSecurityMeta(dataBase: string, relayBase: string, local = false): string {
  const origin = (u: string): string => {
    try {
      return new URL(u).origin;
    } catch {
      return '';
    }
  };
  const connect = ["'self'", origin(dataBase), origin(relayBase), ...(local ? ['http://127.0.0.1:*', 'http://localhost:*'] : [])].filter(Boolean);
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="no-referrer" />`;
}

function securityHeaders(dataBase: string, relayBase: string, local: boolean): Plugin {
  return {
    name: 'quai-web-security',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${webSecurityMeta(dataBase, relayBase, local)}`);
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
    plugins: command === 'build' ? [coreGuard(), securityHeaders(cfg.dataBase, cfg.relayBase, process.env.QUAI_WEB_CSP_LOCAL === '1')] : [],
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
