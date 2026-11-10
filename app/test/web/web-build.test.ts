/**
 * Quai Web : configuration du build (QUAI_WEB_BASE, QUAI_DATA_BASE, QUAI_RELAY_BASE), page d'entrée,
 * manifeste d'installation et icônes ; le paquet des lunettes n'est pas concerné.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_BASE, normalizeWebBase, webBuildConfig } from '../../scripts/web-config.mjs';
import { BG, FG, WEB_ICONS, webIconPixels } from '../../scripts/make-web-icons.mjs';
import { GRID as PORTAL_GRID } from '../../scripts/make-icon.mjs';
import { GRID } from '../../src/web/icon-grid';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string): string => readFileSync(join(APP, p), 'utf8');

/** PNG RGBA 8 bits sans filtre (forme écrite par scripts/make-icon.mjs). */
function png(file: string): { width: number; height: number; rgba: Uint8Array } {
  const buf = readFileSync(join(APP, file));
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9]]).toEqual([8, 6]);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

describe('configuration du build web (npm run build:web)', () => {
  const ok = { QUAI_DATA_BASE: 'https://sahiht.github.io/quai/data', QUAI_RELAY_BASE: 'https://quai-relay.vercel.app' };

  it('chemin de publication : /quai/app/ par défaut, remplaçable par QUAI_WEB_BASE', () => {
    expect(DEFAULT_WEB_BASE).toBe('/quai/app/');
    expect(webBuildConfig(ok)).toMatchObject({ base: '/quai/app/', dataBase: ok.QUAI_DATA_BASE, relayBase: ok.QUAI_RELAY_BASE });
    expect(webBuildConfig({ ...ok, QUAI_WEB_BASE: '/mon-quai/app/' }).base).toBe('/mon-quai/app/');
    expect(normalizeWebBase('  ')).toBe('/quai/app/');
    expect(normalizeWebBase('/app/')).toBe('/app/');
    for (const bad of ['quai/app/', '/quai/app', '/quai//app/', '/quai/../app/', '/quai app/', '/quai/?x/']) expect(() => normalizeWebBase(bad)).toThrow(/QUAI_WEB_BASE/);
  });

  it('adresses comme npm run configure : https seulement, sans / final, messages en français', () => {
    expect(() => webBuildConfig({})).toThrow(/Variables manquantes : QUAI_DATA_BASE, QUAI_RELAY_BASE.*npm run build:web/);
    expect(() => webBuildConfig({ QUAI_DATA_BASE: ok.QUAI_DATA_BASE })).toThrow(/Variable manquante : QUAI_RELAY_BASE/);
    expect(() => webBuildConfig({ ...ok, QUAI_DATA_BASE: 'http://sahiht.github.io/quai/data' })).toThrow(/https:\/\//);
    expect(() => webBuildConfig({ ...ok, QUAI_RELAY_BASE: 'https://quai-relay.vercel.app/' })).toThrow(/ne doit pas se terminer par « \/ »/);
    // développement (vite --config vite.web.config.ts) : adresses facultatives
    expect(webBuildConfig({}, { requireBases: false })).toMatchObject({ base: '/quai/app/', dataBase: '', relayBase: '' });
  });

  it('le build web est séparé : entrée web/, sortie dist-web/, jamais app.json ni src/generated', () => {
    const cfg = read('vite.web.config.ts');
    expect(cfg).toContain("new URL('./web', import.meta.url)");
    expect(cfg).toContain("new URL('./dist-web', import.meta.url)");
    expect(cfg).not.toMatch(/(import|readFileSync|writeFileSync)[^\n]*(generated\/config|app\.json)/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['build:web']).toBe('vite build --config vite.web.config.ts');
    expect(pkg.scripts.pack).toBe('node scripts/check-configured.mjs && npm run build && evenhub pack app.json dist -o quai.ehpk --sdk-ver 0.0.16');
    expect(read('vite.config.ts')).toContain("outDir: 'dist'");
    expect(read('../.gitignore')).toMatch(/^dist-web\/$/m);
    // l'entrée web n'utilise ni le SDK Even ni la configuration du paquet
    const main = read('src/web/main.ts');
    expect(main).not.toMatch(/even_hub_sdk|platform\/even|generated\/config/);
  });
});

describe('page installable (manifeste, icônes, balises)', () => {
  const manifest = JSON.parse(read('web/public/manifest.webmanifest'));
  const html = read('web/index.html');

  it('manifeste : Quai, autonome, couleurs des maquettes, adresses relatives (tout chemin de publication)', () => {
    expect(manifest).toMatchObject({ name: 'Quai', short_name: 'Quai', lang: 'fr', display: 'standalone', start_url: './', scope: './', id: './' });
    const css = read('src/phone/styles.css');
    expect(css).toContain(`--bg: ${manifest.background_color}`);
    expect(manifest.theme_color).toBe(manifest.background_color);
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const i of manifest.icons) {
      expect(i.src).not.toMatch(/^\//);
      expect(existsSync(join(APP, 'web/public', i.src))).toBe(true);
    }
  });

  it('balises : langue, fenêtre, manifeste, icône de l’iPhone, couleur, mode autonome', () => {
    expect(html).toMatch(/<html lang="fr">/);
    expect(html).toContain('<title>Quai</title>');
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Quai" />');
    expect(html).toContain('src="../src/web/main.ts"');
    expect(html).not.toMatch(/—/);
    expect(JSON.stringify(manifest)).not.toMatch(/—/);
  });

  it('icônes : même tram que l’icône des lunettes, nettes, sans transparence, dans la zone sûre', () => {
    expect(GRID).toEqual(PORTAL_GRID);
    for (const icon of WEB_ICONS) {
      const p = png(`web/public/${icon.file}`);
      expect([p.width, p.height]).toEqual([icon.size, icon.size]);
      // fichier à jour (npm run icons:web)
      expect(Buffer.from(p.rgba).equals(Buffer.from(webIconPixels(icon.size, icon.art).px))).toBe(true);
      const colors = new Set<string>();
      for (let i = 0; i < p.rgba.length; i += 4) colors.add(p.rgba.subarray(i, i + 4).join(','));
      expect([...colors].sort()).toEqual([BG.join(','), FG.join(',')].sort());
    }
    // maskable : tout le dessin dans le cercle de 80 % (rayon 40 % de la taille)
    const { size, cell, off } = webIconPixels(512, WEB_ICONS.find((i) => i.file === 'icon-maskable-512.png')!.art);
    const art = cell * GRID.length;
    const corner = Math.hypot(off + art - size / 2, off + art - size / 2);
    expect(corner).toBeLessThanOrEqual(0.4 * size);
    expect(existsSync(join(APP, 'web/public/apple-touch-icon.png'))).toBe(true);
    expect(existsSync(join(APP, 'web/public/favicon-32.png'))).toBe(true);
  });
});
