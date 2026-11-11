import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  APP_NAME,
  ConfigError,
  buildManifest,
  configModule,
  isConfiguredManifest,
  normalizeBase,
  originOf,
  privacyWithDomains,
  readConfig,
  whitelistFor,
} from '../../scripts/manifest.mjs';
import { writeConfiguration } from '../../scripts/configure.mjs';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const CFG = { dataBase: 'https://moi.github.io/quai/data', relayBase: 'https://quai-relais.vercel.app' };

describe('npm run configure', () => {
  it('valide les bases : https, sans / final, sans paramètres', () => {
    expect(normalizeBase('X', '  https://moi.github.io/quai/data ')).toBe('https://moi.github.io/quai/data');
    for (const bad of ['http://moi.github.io/data', 'https://moi.github.io/data/', 'https://x.app?k=1', 'https://x.app#a', 'pas une url', '', 'https://u:p@x.app']) {
      expect(() => normalizeBase('QUAI_DATA_BASE', bad), bad).toThrow(ConfigError);
    }
    try {
      normalizeBase('QUAI_DATA_BASE', 'https://moi.github.io/data/');
    } catch (e) {
      expect((e as Error).message).toMatch(/ne doit pas se terminer par « \/ »/);
    }
  });

  it('lit l’environnement et explique ce qui manque', () => {
    expect(readConfig({ QUAI_DATA_BASE: CFG.dataBase, QUAI_RELAY_BASE: CFG.relayBase })).toEqual(CFG);
    expect(readConfig({}, [`--data=${CFG.dataBase}`, `--relay=${CFG.relayBase}`])).toEqual(CFG);
    expect(() => readConfig({ QUAI_DATA_BASE: CFG.dataBase })).toThrow(/Variable manquante : QUAI_RELAY_BASE/);
    expect(() => readConfig({})).toThrow(/QUAI_DATA_BASE, QUAI_RELAY_BASE/);
  });

  it('liste blanche = les deux origines', () => {
    expect(originOf(CFG.dataBase)).toBe('https://moi.github.io');
    expect(whitelistFor(CFG)).toEqual(['https://moi.github.io', 'https://quai-relais.vercel.app']);
    expect(whitelistFor({ dataBase: 'https://a.dev/data', relayBase: 'https://a.dev/relais' })).toEqual(['https://a.dev']);
  });

  it('écrit config.ts, app.json et la page de confidentialité', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quai-cfg-'));
    mkdirSync(join(dir, 'store'));
    writeFileSync(join(dir, 'store', 'privacy.md'), readFileSync(join(APP, 'store', 'privacy.md'), 'utf8'));
    writeConfiguration(dir, CFG);
    const ts = readFileSync(join(dir, 'src', 'generated', 'config.ts'), 'utf8');
    expect(ts).toContain('export const DATA_BASE = "https://moi.github.io/quai/data";');
    expect(ts).toContain('export const RELAY_BASE = "https://quai-relais.vercel.app";');
    expect(ts).toContain('export const CONFIGURED = true;');
    const manifest = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
    expect(manifest.permissions[0].whitelist).toEqual(['https://moi.github.io', 'https://quai-relais.vercel.app']);
    expect(isConfiguredManifest(manifest)).toBe(true);
    const privacy = readFileSync(join(dir, 'store', 'privacy.md'), 'utf8');
    expect(privacy).toContain('- Horaires (fichiers statiques) : https://moi.github.io');
    expect(privacy).toContain('- Temps réel et adresses (relais personnel) : https://quai-relais.vercel.app');
    writeConfiguration(dir, null);
    expect(readFileSync(join(dir, 'src', 'generated', 'config.ts'), 'utf8')).toContain('CONFIGURED = false');
    expect(readFileSync(join(dir, 'store', 'privacy.md'), 'utf8')).toContain('remplie par `npm run configure`');
  });

  it('script : message clair et code de sortie non nul si une variable manque', () => {
    const r = spawnSync(process.execPath, [join(APP, 'scripts', 'configure.mjs')], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Erreur de configuration : Variables manquantes : QUAI_DATA_BASE, QUAI_RELAY_BASE/);
  });
});

describe('app.json (skill build-and-deploy, CLI evenhub 0.2)', () => {
  const m = buildManifest(CFG);

  it('champs obligatoires et règles de validation', () => {
    expect(m.package_id).toBe('com.quai.transports');
    expect(m.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
    expect(m.edition).toBe('202601');
    expect(m.name).toBe('Quai');
    expect(m.name.length).toBeLessThanOrEqual(20);
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.min_sdk_version).toBe('0.0.16');
    expect(m.entrypoint).toBe('index.html');
    expect(m.supported_languages).toEqual(['fr']);
    expect(Array.isArray(m.permissions)).toBe(true);
    expect(m.permissions.map((p: { name: string }) => p.name)).toEqual(['network', 'location']);
    for (const p of m.permissions as { desc: string }[]) {
      expect(p.desc.length).toBeGreaterThan(0);
      expect(p.desc.length).toBeLessThanOrEqual(300);
      expect(p.desc).not.toMatch(/—/);
    }
  });

  it('le manifeste du dépôt est à jour (configure --reset)', () => {
    const disk = JSON.parse(readFileSync(join(APP, 'app.json'), 'utf8'));
    const expected = buildManifest(null);
    expect({ ...disk, permissions: disk.permissions.map((p: Record<string, unknown>) => ({ ...p, whitelist: p.whitelist ? [] : undefined })) }).toEqual({
      ...expected,
      permissions: expected.permissions.map((p: Record<string, unknown>) => ({ ...p, whitelist: p.whitelist ? [] : undefined })),
    });
    expect(disk.name).toBe(APP_NAME);
    expect(configModule(null)).toContain('CONFIGURED = false');
    expect(existsSync(join(APP, 'src', 'generated', 'config.ts'))).toBe(true);
  });

  it('domaines de la page de confidentialité', () => {
    const md = '<!-- quai:domaines:debut -->\nx\n<!-- quai:domaines:fin -->';
    expect(privacyWithDomains(md, CFG)).toContain('https://quai-relais.vercel.app');
    expect(privacyWithDomains('sans marqueurs', CFG)).toBe('sans marqueurs');
  });
});
