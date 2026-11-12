#!/usr/bin/env node
/**
 * Visite automatique de Quai dans le simulateur Even Hub (API d'automatisation) :
 * parcourt les écrans des lunettes avec les gestes et enregistre les captures dans test/screens/.
 * 1.2.2 : accueil avec « Gares » et « Bus, tram, métro », « Favoris » (adresses récentes), « Gares », « Bus, tram,
 * métro », détail d'une ligne, « garder une ligne », trajet suivi sur demande (« Suivre ce trajet », « Ne plus suivre »).
 *
 *   npm run dev                          (autre terminal, port 5173)
 *   npm run sim-tour                     (faux cœur : ?fake=1)
 *   node scripts/sim-tour.mjs --data http://localhost:8787 --relay http://localhost:8788
 *   node scripts/sim-tour.mjs --url http://localhost:4173/ --preset http://localhost:8080/preset.json --only glasses
 *
 * Options : --url (page de l'appli), --data/--relay (vrai cœur), --preset (URL des réglages de démonstration,
 * par défaut fixtures/app/preset.json servi par le serveur Vite), --out (dossier), --port (automatisation, 9898),
 * --sim (binaire du simulateur), --only glasses|phone, --keep (ne pas fermer le simulateur à la fin).
 * Sans écran (DISPLAY absent), le simulateur est lancé avec xvfb-run -a. Le simulateur (WebKitGTK, pas Chromium) est
 * lancé sans les variables de proxy : il ne parle qu'aux serveurs de la machine.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const opt = args(process.argv.slice(2));
const URL_BASE = opt.url ?? 'http://localhost:5173/';
const PORT = Number(opt.port ?? 9898);
const API = `http://127.0.0.1:${PORT}`;
const OUT = resolve(opt.out ?? join(APP, 'test', 'screens'));
const SIM = opt.sim ?? process.env.EVENHUB_SIMULATOR ?? '/home/claude/tools/node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator';
const REAL = !!(opt.data && opt.relay);
const PRESET = opt.preset ?? `${new URL(URL_BASE).origin}/@fs${join(ROOT, 'fixtures', 'app', 'preset.json')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Simulateur ------------------------------ */

let proc = null;
let lastId = -1;
const screensSeen = [];
const failures = [];

function pageUrl(params, hash = '') {
  const u = new URL(URL_BASE);
  u.searchParams.set('e2e', '1');
  if (REAL) {
    u.searchParams.set('data', opt.data);
    u.searchParams.set('relay', opt.relay);
  } else u.searchParams.set('fake', '1');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString() + hash;
}

async function api(path, init) {
  const r = await fetch(API + path, init);
  if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
  return r;
}

async function stopSim() {
  if (!proc) return;
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    /* déjà arrêté */
  }
  proc = null;
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(API + '/api/ping');
      await sleep(200);
    } catch {
      return;
    }
  }
}

async function launch(url) {
  await stopSim();
  const cmd = process.env.DISPLAY ? SIM : 'xvfb-run';
  const argv = process.env.DISPLAY ? ['--automation-port', String(PORT), url] : ['-a', SIM, '--automation-port', String(PORT), url];
  // ni proxy ni accès hors de la machine (le propriétaire ne veut aucun trafic vers Google ni ailleurs)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|all|no)_proxy$/i.test(k)));
  proc = spawn(cmd, argv, { detached: true, stdio: 'ignore', env });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await (await fetch(API + '/api/ping')).text()).includes('pong')) break;
    } catch {
      /* pas encore prêt */
    }
    await sleep(200);
  }
  lastId = -1;
  lastScreen = null;
  lastScreenSeq = -1;
  markSeq = -1;
  pending.length = 0;
  await waitLog((m) => m === 'QUAI_READY', 25_000, 'QUAI_READY');
}

async function console_() {
  const q = lastId >= 0 ? `?since_id=${lastId}` : '';
  const { entries } = await (await api(`/api/console${q}`)).json();
  for (const e of entries) lastId = Math.max(lastId, e.id);
  return entries;
}

const pending = [];
let lastScreen = null;
let screenSeq = 0;
let lastScreenSeq = -1;
let markSeq = -1;

async function drain() {
  for (const e of await console_()) {
    pending.push(e);
    const s = parseScreen(e.message);
    if (s) {
      lastScreen = s;
      lastScreenSeq = ++screenSeq;
    }
    if (e.level === 'error' || e.message.startsWith('[uncaught]') || e.message.startsWith('[unhandledrejection]')) console.log(`   ! ${e.message.slice(0, 200)}`);
  }
}

/** Attend un message de la console ; renvoie le message (les messages lus sont consommés). */
async function waitLog(pred, timeout = 10_000, label = 'message') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await drain();
    while (pending.length) {
      const e = pending.shift();
      if (pred(e.message)) return e.message;
    }
    await sleep(120);
  }
  throw new Error(`délai dépassé en attendant ${label}`);
}

function parseScreen(m) {
  return m.startsWith('QUAI_SCREEN ') ? JSON.parse(m.slice(12)) : null;
}

/** Attend que l'écran affiché (dernier rendu, postérieur au dernier geste) vérifie `pred`. */
async function waitScreen(pred, timeout = 10_000, label = 'écran') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await drain();
    pending.length = 0;
    if (lastScreen && lastScreenSeq > markSeq && pred(lastScreen)) {
      screensSeen.push(lastScreen);
      return lastScreen;
    }
    await sleep(120);
  }
  throw new Error(`délai dépassé en attendant ${label} (dernier écran : ${lastScreen ? `${lastScreen.screen} « ${lastScreen.title} »` : 'aucun'})`);
}

async function input(action, pause = 450) {
  await drain();
  markSeq = screenSeq;
  await api('/api/input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
  await sleep(pause);
}

async function shotGlasses(name, s) {
  const buf = Buffer.from(await (await api('/api/screenshot/glasses')).arrayBuffer());
  writeFileSync(join(OUT, `glasses-${name}.png`), buf);
  console.log(`   ✓ glasses-${name}.png  [${s.screen}] ${s.title}  ${s.clock}`);
  for (const l of s.lines) console.log(`       ${l}`);
}

async function shotPhone(name, waitMs = 2500) {
  await sleep(waitMs);
  const buf = Buffer.from(await (await api('/api/screenshot/webview')).arrayBuffer());
  writeFileSync(join(OUT, `phone-${name}.png`), buf);
  console.log(`   ✓ phone-${name}.png`);
}

/** Exécute une étape ; une erreur est notée sans arrêter la visite. */
async function step(label, fn) {
  console.log(`• ${label}`);
  try {
    await fn();
  } catch (e) {
    failures.push(`${label} : ${e.message}`);
    console.log(`   ✗ ${e.message}`);
  }
}

const is = (screen, extra = () => true) => (s) => s.screen === screen && extra(s);
/** Écran chargé : plus de « … » d'attente en bout de ligne. */
const loaded = (s) => !s.lines.some((l) => l.endsWith('   …') || l === '…');
const homeReady = is('home', loaded);
/** Ligne du haut de l'accueil (jamais un élément sélectionnable). */
const TOP_HOME = /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/;
/** Rang de l'élément de l'accueil dont la ligne vérifie `re` (sans la ligne du haut, la ligne vide, la note, l'aide). */
function homeIndex(s, re) {
  const l = [...s.lines];
  if (TOP_HOME.test(l[0] ?? '')) l.shift();
  const i = l.filter((x) => x !== '' && !/^(Jour férié|▲▼ )/.test(x)).findIndex((x) => re.test(x));
  if (i < 0) throw new Error(`élément ${re} absent de l’accueil`);
  return i;
}

/** Déplace la sélection jusqu'à l'élément `index` de l'écran courant (gestes espacés de 450 ms). */
async function select(index, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await drain();
    const cur = lastScreen?.sel ?? 0;
    if (cur === index) return;
    await input(cur < index ? 'down' : 'up', 450);
  }
  throw new Error(`sélection ${index} non atteinte`);
}
const clockAtLeast = (hhmm) => (s) => s.clock >= hhmm;

/* ------------------------------ Scénarios ------------------------------ */

const S1 = { mockLat: 50.4655, mockLon: 4.859, mockNow: '2026-11-10T07:31:00+01:00' };
const S2 = { mockLat: 50.86, mockLon: 4.359, mockNow: '2026-11-10T12:10:00+01:00' };
const S3 = { mockLat: 50.8454, mockLon: 4.3571, mockNow: '2026-11-10T13:55:00+01:00' };
const withPreset = (p) => ({ ...p, reset: 1, preset: PRESET });

async function glassesTour() {
  await step('Scénario 1 : accueil, étapes, suivre, Favoris, Gares', async () => {
    await launch(pageUrl(withPreset(S1)));
    const home = await waitScreen(homeReady);
    await shotGlasses('home', home);
    await input('click');
    await shotGlasses('steps', await waitScreen(is('steps', (s) => s.followed === false)));
    // « Suivre ce trajet », puis toucher : « Ne plus suivre » et le détail du train
    await input('click');
    await waitScreen(is('steps', (s) => s.followed === true));
    await sleep(2800);
    await input('click');
    await shotGlasses('followed', await waitScreen(is('followed')));
    await input('double_click');
    await waitScreen(is('steps'));
    await input('double_click');
    const h = await waitScreen(homeReady);
    await select(0);
    await input('click');
    await shotGlasses('favorites', await waitScreen(is('favorites', loaded), 15_000));
    await input('double_click');
    await waitScreen(homeReady);
    await select(homeIndex(h, /^Gares {3}/));
    await input('click');
    await shotGlasses('stations', await waitScreen(is('stations', loaded), 15_000));
    await input('click');
    await shotGlasses('board-station', await waitScreen(is('board', loaded), 15_000));
  });

  await step('Scénario 1 en accéléré : voie modifiée, puis dans le train', async () => {
    await launch(pageUrl({ ...withPreset(S1), mockSpeed: 30 }));
    await waitScreen(homeReady);
    await input('click', 200);
    await waitScreen(is('steps', (s) => s.followed === false));
    await input('click', 200);
    await waitScreen(is('steps', (s) => s.followed === true));
    await shotGlasses('steps-alert', await waitScreen(is('steps', (s) => s.clock >= '07:37' && s.lines[0]?.startsWith('!')), 30_000, 'étapes à 07:37'));
    await shotGlasses('train', await waitScreen(is('train', clockAtLeast('08:05')), 90_000, 'dans le train à 08:05'));
  });

  await step('Scénario 2 : lignes proches, détail, garder une ligne, autour de moi, tableaux', async () => {
    await launch(pageUrl(withPreset(S2)));
    await shotGlasses('lines', await waitScreen(is('lines', loaded), 15_000));
    await input('click');
    await shotGlasses('line', await waitScreen(is('line', loaded), 15_000));
    await input('click');
    await shotGlasses('board', await waitScreen(is('board', loaded), 15_000));
    await input('click');
    await shotGlasses('keep-line', await waitScreen(is('keepLine', loaded), 15_000));
    for (let i = 0; i < 4 && lastScreen?.screen !== 'home'; i++) await input('double_click', 700);
    const h = await waitScreen(homeReady);
    await shotGlasses('home-near', h);
    await select(homeIndex(h, /^Autour de moi {3}/));
    await input('click');
    await shotGlasses('nearby', await waitScreen(is('nearby')));
    await select(2);
    await input('click');
    await shotGlasses('board-planned', await waitScreen(is('board', (s) => /De Lijn/.test(s.title))));
    await input('double_click');
    await waitScreen(is('nearby'));
    await select(1);
    await input('click');
    await shotGlasses('board-train', await waitScreen(is('board', (s) => /SNCB/.test(s.title))));
  });

  await step('Scénario 3 : trajet de gare à gare, suivi, détail du train', async () => {
    await launch(pageUrl(withPreset(S3)));
    await waitScreen(homeReady);
    await input('click');
    await shotGlasses('trip', await waitScreen(is('steps')));
    await input('click');
    await waitScreen(is('steps', (s) => s.followed === true));
    await sleep(2800);
    await input('click');
    await waitScreen(is('followed'));
    await input('down');
    await input('click');
    await shotGlasses('train-detail', await waitScreen(is('train')));
  });

  await step('Scénario 3 en accéléré : arrivée à Gand', async () => {
    await launch(pageUrl({ ...withPreset(S3), mockNow: '2026-11-10T14:05:00+01:00', mockSpeed: 30 }));
    await waitScreen(homeReady);
    await input('click', 250);
    await waitScreen(is('steps', (s) => s.followed === false));
    await input('click', 250);
    await waitScreen(is('steps', (s) => s.followed === true));
    await shotGlasses('arrival', await waitScreen(is('arrival', (s) => s.lines.length > 2 && !s.lines[1]?.startsWith('Recherche')), 90_000, 'arrivée'));
  });

  await step('États : premier lancement, aucun arrêt, horaires périmés', async () => {
    await launch(pageUrl({ ...S2, reset: 1 }));
    await shotGlasses('first-run', await waitScreen(is('message', (s) => s.lines[0]?.startsWith('Bienvenue'))));
    await launch(pageUrl({ ...withPreset(S2), mockLat: 50.1, mockLon: 5.2 }));
    const h = await waitScreen(homeReady);
    await select(homeIndex(h, /^Autour de moi {3}/));
    await input('click');
    await shotGlasses('nearby-empty', await waitScreen(is('message', (s) => s.title === 'Autour de moi' && s.lines[0]?.startsWith('Aucun'))));
    if (!REAL) {
      await launch(pageUrl({ ...withPreset(S3), stale: 1 }));
      await shotGlasses('home-stale', await waitScreen(is('home', (s) => s.lines[0]?.startsWith('Horaires'))));
    }
  });
}

async function phoneTour() {
  const shots = [
    ['onboarding', { ...S3, reset: 1 }, '#/'],
    ['home', withPreset(S3), '#/'],
    ['picks', withPreset(S3), '#/gares'],
    ['favorites', withPreset(S3), '#/favoris'],
    ['favorite-edit', withPreset(S2), '#/favoris/fav-gand'],
    ['trips', withPreset(S1), '#/trajets'],
    ['display', withPreset(S2), '#/affichage'],
    ['alerts', withPreset(S1), '#/alertes'],
    ['data', withPreset(S2), '#/donnees'],
    ...(REAL ? [] : [['data-stale', { ...withPreset(S3), stale: 1 }, '#/donnees']]),
    ['search', withPreset(S3), '#/recherche?q=Gand'],
    ['search-results', withPreset(S3), '#/recherche?de=ici&vers=sncb:8892007'],
  ];
  for (const [name, params, hash] of shots) {
    await step(`Téléphone : ${name}`, async () => {
      await launch(pageUrl(params, hash));
      await shotPhone(name, name.startsWith('search') ? 3500 : 2500);
    });
  }
}

async function main() {
  if (!existsSync(SIM) && !opt.sim) console.warn(`Simulateur introuvable : ${SIM} (option --sim)`);
  mkdirSync(OUT, { recursive: true });
  console.log(`Quai, visite du simulateur : ${URL_BASE} (${REAL ? `données ${opt.data}, relais ${opt.relay}` : 'faux cœur'}) → ${OUT}`);
  try {
    if (opt.only !== 'phone') await glassesTour();
    if (opt.only !== 'glasses') await phoneTour();
  } finally {
    if (!opt.keep) await stopSim();
  }
  writeFileSync(join(OUT, 'tour.json'), JSON.stringify({ url: URL_BASE, real: REAL, screens: screensSeen, failures }, null, 2));
  if (failures.length) {
    console.log(`\n${failures.length} étape(s) en échec :\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nVisite terminée sans erreur.');
}

process.on('SIGINT', async () => {
  await stopSim();
  process.exit(130);
});
await main();
