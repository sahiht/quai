#!/usr/bin/env node
/**
 * npm run configure : écrit src/generated/config.ts, app.json (liste blanche réseau)
 * et la liste des domaines de store/privacy.md à partir de QUAI_DATA_BASE et QUAI_RELAY_BASE.
 *
 *   QUAI_DATA_BASE=https://moi.github.io/quai/data QUAI_RELAY_BASE=https://quai-relais.vercel.app npm run configure
 *   npm run configure -- --data=https://… --relay=https://…
 *   npm run configure -- --reset        (revient à l'état non configuré)
 *
 * La version de l'appli est celle de app.json : le script la conserve. Pour une nouvelle version,
 * ajouter store/changelog/<version>.txt puis modifier "version" dans app.json.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, ConfigError, buildManifest, checkVersion, configModule, privacyWithDomains, readConfig } from './manifest.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function writeConfiguration(dir, cfg) {
  const configPath = join(dir, 'src', 'generated', 'config.ts');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, configModule(cfg));
  writeFileSync(join(dir, 'app.json'), JSON.stringify(buildManifest(cfg), null, 2) + '\n');
  const privacyPath = join(dir, 'store', 'privacy.md');
  if (existsSync(privacyPath)) {
    const md = readFileSync(privacyPath, 'utf8');
    writeFileSync(privacyPath, privacyWithDomains(md, cfg));
  }
  return { configPath, manifestPath: join(dir, 'app.json') };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--reset')) {
    writeConfiguration(appDir, null);
    console.log('Configuration remise à zéro (non configurée).');
    return;
  }
  try {
    checkVersion(APP_VERSION);
    const cfg = readConfig(process.env, argv);
    writeConfiguration(appDir, cfg);
    console.log(`Configuration écrite (version ${APP_VERSION}) :\n  données : ${cfg.dataBase}\n  relais  : ${cfg.relayBase}`);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Erreur de configuration : ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
