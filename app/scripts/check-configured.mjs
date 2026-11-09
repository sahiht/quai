#!/usr/bin/env node
/** Garde-fou de `npm run pack` : refuse d'empaqueter une appli non configurée. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isConfiguredManifest } from './manifest.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
const config = readFileSync(join(appDir, 'src', 'generated', 'config.ts'), 'utf8');

if (!isConfiguredManifest(manifest) || !/CONFIGURED = true/.test(config)) {
  console.error(
    'Paquet refusé : Quai n’est pas configuré. Lancez d’abord\n' +
      '  QUAI_DATA_BASE=https://<compte>.github.io/<dépôt>/data QUAI_RELAY_BASE=https://<relais>.vercel.app npm run configure',
  );
  process.exit(1);
}
console.log(`Configuration présente : ${manifest.permissions.find((p) => p.name === 'network').whitelist.join(', ')}`);
