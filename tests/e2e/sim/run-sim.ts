/**
 * Quai 1.1, contrôle qualité : bout en bout avec le VRAI cœur, les vraies données (pipeline sur les zips de fixtures),
 * le vrai relais (faux portail BMC, faux service d'adresses des trois Régions) et l'appli construite :
 *   - lunettes dans le simulateur Even Hub 0.9.5 (sans affichage, xvfb) : gestes, journal QUAI_SCREEN, captures
 *     576 × 288 contrôlées au pixel (CA-M1.7) ;
 *   - téléphone dans Chrome sans affichage (protocole DevTools, sim/cdp.ts) : champ unique, cartes, « Lunettes »,
 *     lieux, favoris, données, et réouverture de Quai (le simulateur 0.9.5 ne garde pas setLocalStorage d'un
 *     lancement à l'autre ; Chrome garde le stockage local d'un chargement à l'autre).
 *
 *   cd tests/e2e && npm run sim                    (tout, environ 12 min)
 *   npm run sim -- --only s1,s2                    (scénarios choisis, liste dans SCENARIOS en bas du fichier)
 *   npm run sim -- --deliver /home/claude/quai-1.1-shots   (captures pour le propriétaire + manifest.json)
 *   npm run sim -- --tour                          (rafraîchit les images de app/test/screens/, mêmes noms)
 *
 * Captures : tests/e2e/screens/<scénario>-<étape>.png ; rapport : tests/e2e/out/sim-report.json.
 * Port d'automatisation : 9931 (option --port), pour ne pas gêner un autre simulateur sur 9898.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, buildFixtureData, ROOT, run, startDataServer, startStack, type Proc, type Stack } from '../lib/stack';
import { litPixels, Sim, startStatic, type Screen } from '../lib/sim';
import { Chrome, type GlassesScreen, type Page } from './cdp';
import { checkPixels, truncatedLines } from './pixels';

const E2E = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SHOTS = join(E2E, 'screens');
const OUT = join(E2E, 'out');
const TOUR = join(APP, 'test', 'screens');
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = new Set((opt('only') ?? '').split(',').filter(Boolean));
const PORT = Number(opt('port') ?? 9931);
const DELIVER = opt('deliver');
const WITH_TOUR = argv.includes('--tour');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Situations de test (PRD § 5, conventions) ------------------------------ */

const S1 = { mockLat: '50.4655', mockLon: '4.859', mockNow: '2026-11-10T07:31:00+01:00' };
const S2 = { mockLat: '50.86', mockLon: '4.359', mockNow: '2026-11-10T12:10:00+01:00' };
const S3 = { mockLat: '50.8454', mockLon: '4.3571', mockNow: '2026-11-10T13:55:00+01:00' };
/** Scénario 4 : « Chaussée de Bruxelles 1, 1410 Waterloo » à 07:31 (fixtures/README.md, Extension 1.1). */
const WAT = { mockLat: '50.7175', mockLon: '4.399', mockNow: '2026-11-10T07:31:00+01:00' };
/** De la maison au bureau : à pied jusqu'à la gare de Namur, IC, Bruxelles-Central, à pied (minutes après 07:31). */
const PATH_S1 = '6:50.4677,4.8617;12:50.4685,4.8625;20:50.53,4.7;34:50.6727,4.5694;70:50.8603,4.362;77:50.8454,4.3571;85:50.8445,4.35;89:50.8441,4.3474';
/**
 * De Bruxelles-Central à Gand-Saint-Pierre (minutes après 14:05). Le point de départ est la gare elle-même : la
 * position la quitte dès 14:09, sinon une position prise juste après le départ de 14:10, encore à moins de 300 m,
 * mettrait fin au trajet (« pas parti », PRD M6.3).
 */
const PATH_S3 = '4:50.849,4.362;10:50.86,4.2;20:50.95,3.95;30:51.03,3.72;34:51.0359,3.7107';

/** Aides de gestes exactes (PRD § 6.1, liste S2) : l'oracle, indépendant du code. */
const H = {
  home: '▲▼ choisir   toucher : ouvrir   double : quitter',
  favorites: '▲▼ choisir   toucher : ouvrir   double : retour',
  steps: '▲▼ autre trajet   toucher : détail   double : retour',
  stepsOther: '▲▼ autre trajet   toucher : suivre ce trajet   double : retour',
  train: '▲▼ arrêts   double : retour',
  arrival: 'toucher : ★ garder ce trajet   double : retour',
  board: '▲▼ départs   toucher : ★ favori   double : retour',
  boardFav: '▲▼ départs   toucher : ★ retirer   double : retour',
  nearby: '▲▼ arrêt   toucher : départs   double : retour',
  places: '▲▼ choisir   toucher : trajet   double : retour',
  message: 'double toucher : retour',
  errorRoot: 'toucher : réessayer   double : quitter',
  firstRun: 'toucher : continuer   double : quitter',
  news: 'toucher : continuer',
};
const NEWS = ['Nouveau : tes favoris donnent la réponse.', 'Toucher un favori : le trajet, étape par étape.', 'Sur un trajet, ▼ : un autre trajet.', 'Les adresses se tapent sur le téléphone.'];
const WELCOME = ['Bienvenue dans Quai !', 'Termine les réglages sur le téléphone :', 'appli Even Realities, onglet Even Hub, Quai.', 'Position, langue et tes lieux, en une minute.'];
const RT_DOWN = 'Temps réel indisponible : horaires prévus ~';
const PLANNED = '~ horaire prévu, sans temps réel';

/* ------------------------------ Captures pour le propriétaire (--deliver) ------------------------------ */

const DELIVERABLES: Record<string, { file: string; caption: string }> = {
  g01: { file: 'g01-lunettes-accueil-favoris.png', caption: 'Lunettes, accueil à 07:31 à la maison (Namur) : les deux favoris en tête avec leur réponse, Vers le bureau puis Namur, train.' },
  g02: { file: 'g02-lunettes-accueil-en-cours.png', caption: 'Lunettes, accueil pendant le trajet : la ligne « En cours : vers le bureau » avec l’étape suivante (IC 07:44, voie 6).' },
  g03: { file: 'g03-lunettes-etapes-le-plus-simple.png', caption: 'Lunettes, trajet proposé Maison vers Bureau, page 1 « Le plus simple : direct, à pied 7 + 12 min » (sans temps réel).' },
  g04: { file: 'g04-lunettes-etapes-le-suivant.png', caption: 'Lunettes, même trajet après ▼ : page 2 « Le suivant : même trajet, 1 h plus tard », toucher pour le suivre.' },
  g05: { file: 'g05-lunettes-dans-le-train.png', caption: 'Lunettes, « Dans le train » vers 08:05 : arrêts passés, prochain arrêt Ottignies, descente à Bruxelles-Central.' },
  g06: { file: 'g06-lunettes-autres-favoris.png', caption: 'Lunettes, « Autres favoris » : les favoris suivants avec leur réponse, trois par écran.' },
  g07: { file: 'g07-lunettes-departs-favori.png', caption: 'Lunettes, départs d’un arrêt favori (Gare du Nord, tram, avec ★), ouverts seuls à moins de 300 m.' },
  g08: { file: 'g08-lunettes-favori-retire-annuler.png', caption: 'Lunettes, après un toucher sur ces départs : « ★ Retiré. Toucher encore : annuler » pendant 5 secondes.' },
  g09: { file: 'g09-lunettes-aller-a.png', caption: 'Lunettes, « Aller à… » : les lieux, puis les adresses récentes tapées sur le téléphone, avec l’heure d’arrivée.' },
  g10: { file: 'g10-lunettes-message-quai-1-1.png', caption: 'Lunettes, message « Quai 1.1 » montré une seule fois à la première ouverture après la mise à jour.' },
  g11: { file: 'g11-lunettes-waterloo-le-plus-simple.png', caption: 'Lunettes, Waterloo vers la rue du Progrès : « Le plus simple », bus W puis métro 2, 1 changement et peu de marche.' },
  g12: { file: 'g12-lunettes-waterloo-le-plus-rapide.png', caption: 'Lunettes, même recherche, page 2 « Le plus rapide » : 19 min à pied jusqu’à la gare puis le S1, 16 min plus tôt.' },
  g13: { file: 'g13-lunettes-temps-reel-indisponible.png', caption: 'Lunettes, accueil pendant une panne du temps réel : « Temps réel indisponible : horaires prévus ~ » en ligne du haut.' },
  p01: { file: 'p01-telephone-accueil.png', caption: 'Téléphone, accueil : champ « Où vas-tu ? » et « Mes favoris » avec leur réponse et un bouton « Lunettes » chacun.' },
  p02: { file: 'p02-telephone-champ-unique.png', caption: 'Téléphone, champ unique : un lieu, une adresse récente, des gares et des adresses, chacun avec son type à droite.' },
  p03: { file: 'p03-telephone-trois-trajets.png', caption: 'Téléphone, vers Rue Neuve 1 sans temps réel : trois cartes étiquetées et expliquées (le plus simple, le plus rapide, le suivant).' },
  p04: { file: 'p04-telephone-message-lunettes.png', caption: 'Téléphone, après « Lunettes » sur la 2e carte : le message « Affiché dans les lunettes : IC 07:42, voie 4. » à côté du bouton.' },
  p05: { file: 'p05-telephone-enregistrer-comme-lieu.png', caption: 'Téléphone, « Enregistrer comme lieu » sous l’adresse choisie : nom du lieu et raccourcis Maison, Bureau, École.' },
  p06: { file: 'p06-telephone-ajouter-un-lieu.png', caption: 'Téléphone, « Nouveau lieu » par adresse : l’adresse choisie et l’accès en confirmation, sans coordonnées.' },
  p07: { file: 'p07-telephone-premier-lancement-tes-lieux.png', caption: 'Téléphone, premier lancement, étape « Tes lieux » : adresses de la maison et du bureau, trajets du matin et du soir.' },
  p08: { file: 'p08-telephone-changer-l-ordre.png', caption: 'Téléphone, « Mes favoris », « Changer l’ordre » : boutons Monter et Descendre sous chaque favori.' },
  p09: { file: 'p09-telephone-affichage-ordre-des-favoris.png', caption: 'Téléphone, « Affichage » : « Ordre des favoris » (selon l’heure et le lieu, ou dans mon ordre) et l’aperçu des lunettes.' },
  p10: { file: 'p10-telephone-donnees-version.png', caption: 'Téléphone, « Données » : carte « Adresses » disponible et « Version de Quai 1.1.0 ».' },
  p11: { file: 'p11-telephone-lieu-a-verifier.png', caption: 'Téléphone, un lieu venu de la 1.0 : « Adresse à vérifier » et le bouton « Vérifier l’adresse ».' },
};
const delivered: Record<string, string> = {};
const toured: { file: string; what: string }[] = [];

function deliver(id: keyof typeof DELIVERABLES, src: string): void {
  if (!DELIVER) return;
  mkdirSync(DELIVER, { recursive: true });
  copyFileSync(src, join(DELIVER, DELIVERABLES[id].file));
  delivered[id] = DELIVERABLES[id].file;
}

/** Images de la visite (app/test/screens/, noms de la 1.0 gardés). */
function tour(name: string, src: string, what: string): void {
  if (!WITH_TOUR) return;
  copyFileSync(src, join(TOUR, name));
  toured.push({ file: name, what });
}

/* ------------------------------ Résultats ------------------------------ */

interface StepResult {
  scenario: string;
  step: string;
  ok: boolean;
  error?: string;
  screen?: Screen | GlassesScreen;
  shot?: string;
  ms: number;
}
const results: StepResult[] = [];
const notes: string[] = [];

class Check extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Check(msg);
}
const has = (s: { lines: string[] }, re: RegExp) => s.lines.some((l) => re.test(l));
const show = (s: { screen: string; title: string; clock?: string; lines: string[] } & Record<string, unknown>) => {
  const extra = Object.entries(s).filter(([k]) => !['screen', 'title', 'lines', 'clock', 'sel', 'at', 'id'].includes(k));
  return `${s.screen} « ${s.title} » ${s.clock ?? ''} ${extra.length ? JSON.stringify(Object.fromEntries(extra)) : ''}\n      ${s.lines.join('\n      ')}`;
};
/** Écran chargé : plus de « … » d'attente (« Aller à… » est un libellé). */
const loaded = (s: { lines: string[] }) => !s.lines.some((l) => (l.endsWith('…') && l !== 'Aller à…') || /^Chargement|^Recherche|^Calcul/.test(l));
const is = (screen: string, extra: (s: Screen) => boolean = () => true) => (s: Screen) => s.screen === screen && extra(s);
const hint = (s: { lines: string[] }) => s.lines[s.lines.length - 1];
/** Espaces insécables (typographie française du téléphone) remplacées par des espaces, pour comparer. */
const nbn = (t: string | undefined) => (t ?? '').replace(/[  ]/g, ' ');
/** Même chose dans une expression évaluée dans la page. */
const N = (expr: string) => `((${expr}) ?? '').replace(/[\\u00a0\\u202f]/g, ' ')`;
const field = <T>(s: Screen, k: string) => (s as unknown as Record<string, T>)[k];
const clockAtLeast = (hhmm: string) => (s: Screen) => (s.clock ?? '') >= hhmm;

let stack: Stack;
let night: Proc;
let web: { url: string; close(): Promise<void> };
let sim: Sim;

/** Adresse de la page (paramètres du mode test, SPEC § 5.3). */
function pageUrl(params: Record<string, string | undefined>, hash = '', bases?: { data?: string; relay?: string }): string {
  const u = new URL(`${web.url}/index.html`);
  u.searchParams.set('e2e', '1');
  u.searchParams.set('data', bases?.data ?? night.url);
  u.searchParams.set('relay', bases?.relay ?? stack.relay.url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString() + hash;
}
const preset = (file: string) => (p: Record<string, string>) => ({ ...p, reset: '1', preset: `${web.url}/${file}` });
/** Réglages 1.1 (6 favoris, fixtures/app/preset-1.1.json). */
const P11 = preset('preset-1.1.json');
/** Réglages de la 1.0 (fixtures/app/preset.json) : migrés au lancement. */
const P10 = preset('preset.json');
/** Réglages 1.1 avec trois adresses récentes (S4). */
const PREC = preset('p/recent.json');

let scenario = '';
interface StepOut {
  screen?: Screen;
  /** Capture des lunettes (défaut : oui si un écran est rendu). */
  shot?: boolean;
  /** Contrôle au pixel de la capture (défaut : oui pour accueil, favoris, Aller à…, étapes). */
  pixels?: boolean;
  deliver?: keyof typeof DELIVERABLES;
  tour?: [string, string];
}

async function step(name: string, fn: () => Promise<StepOut | void>): Promise<void> {
  const t0 = Date.now();
  const r: StepResult = { scenario, step: name, ok: true, ms: 0 };
  try {
    const out = (await fn()) ?? {};
    if (out.screen) r.screen = out.screen;
    if (out.screen && out.shot !== false) {
      // Capture stable : aucun nouvel écran journalisé pendant la capture (horloge accélérée), sinon on recommence ;
      // le contrôle au pixel porte sur le dernier écran journalisé, celui qui est affiché.
      let buf: Buffer = Buffer.alloc(0);
      let shown: Screen = out.screen;
      for (let i = 0; i < 5; i++) {
        await sim.drain();
        const before = sim.screens.length;
        buf = await sim.rawShot();
        await sim.drain();
        if (sim.screens.length === before && sim.last) {
          shown = sim.last;
          break;
        }
        await sleep(200);
      }
      const file = join(SHOTS, `${scenario}-${name}.png`);
      writeFileSync(file, buf);
      r.shot = file.slice(E2E.length + 1);
      check(litPixels(buf).lit > 0, `capture ${name} : écran noir`);
      if (out.pixels !== false) {
        const bad = checkPixels(buf, shown.screen === out.screen.screen ? shown : out.screen);
        check(!bad.length, `contrôle au pixel :\n        ${bad.join('\n        ')}`);
      }
      if (out.deliver) deliver(out.deliver, file);
      if (out.tour) tour(out.tour[0], file, out.tour[1]);
    }
    console.log(`  ✓ ${scenario}-${name}${r.screen ? `\n      ${show(r.screen as Screen & Record<string, unknown>)}` : ''}`);
  } catch (e) {
    r.ok = false;
    r.error = (e as Error).message;
    r.screen = sim?.last;
    console.log(`  ✗ ${scenario}-${name} : ${r.error}${r.screen ? `\n      dernier écran : ${show(r.screen as Screen & Record<string, unknown>)}` : ''}`);
    try {
      if (sim?.proc) await sim.shot(`${scenario}-${name}-ECHEC`);
    } catch {
      /* simulateur arrêté */
    }
  }
  r.ms = Date.now() - t0;
  results.push(r);
}

async function runScenario(id: string, label: string, fn: () => Promise<void>): Promise<void> {
  if (ONLY.size && !ONLY.has(id)) return;
  scenario = id;
  console.log(`\n• ${id} : ${label}`);
  for (const f of readdirSync(SHOTS)) if (f.startsWith(`${id}-`) && f.endsWith('.png')) rmSync(join(SHOTS, f));
  try {
    await fn();
  } catch (e) {
    results.push({ scenario, step: 'scénario', ok: false, error: (e as Error).message, ms: 0 });
    console.log(`  ✗ ${id} interrompu : ${(e as Error).message}`);
  }
  if (sim.proc) {
    const errs = sim.errors().filter((e) => !/favicon|\[fetch\] 404 Not Found .*\/(line)?tiles\//i.test(e.message));
    if (errs.length) notes.push(`${id} : erreurs console : ${errs.map((e) => e.message.slice(0, 160)).join(' | ')}`);
  }
  await sim.stop();
}

/** Accueil chargé : réponses des favoris en tête calculées et « Autour de moi » compté. */
const homeReady = is('home', loaded);

/** Contrôles communs d'un écran : aide exacte, aucune ligne coupée par « … » (CA-M1.7). */
function common(s: Screen, wantHint: string): void {
  check(hint(s) === wantHint, `aide « ${hint(s)} » au lieu de « ${wantHint} »`);
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées : ${JSON.stringify(cut)}`);
  check(![s.title, ...s.lines].some((l) => /[\u2013\u2014]/.test(l)), 'tiret long dans un texte affiché');
}

/** Double toucher : retour à l'écran attendu (jamais de sortie hors de l'écran racine). */
async function back(to: (s: Screen) => boolean, label: string): Promise<Screen> {
  await sim.input('double_click');
  return sim.waitScreen(to, 12_000, label);
}

/* ------------------------------ Lunettes, scénario 1 : le matin à Namur ------------------------------ */

async function s1(): Promise<void> {
  await sim.launch(pageUrl(PREC(S1)));
  await step('home', async () => {
    const s = await sim.waitScreen(homeReady, 20_000, 'accueil chargé');
    check(/^Vers le bureau {3}partir dans [34] min$/.test(s.lines[0] ?? ''), `1er favori « ${s.lines[0]} »`);
    check(s.lines[1] === 'IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00', `2e ligne « ${s.lines[1]} »`);
    check(s.lines[2] === 'Namur, train   IC 07:42 +2 v.6 !', `2e favori « ${s.lines[2]} »`);
    check(s.lines[3] === 'vers Bruxelles-Midi, puis ~08:42', `2e ligne du 2e favori « ${s.lines[3]} »`);
    check(s.lines[4] === 'Autour de moi   3 arrêts' && s.lines[5] === 'Autres favoris   4' && s.lines[6] === 'Aller à…', `menu ${JSON.stringify(s.lines.slice(4, 7))}`);
    check(s.lines[7] === PLANNED, `note « ${s.lines[7]} »`);
    check(!has(s, /^Près de/), 'pas de ligne « Près de » quand des favoris sont en tête');
    const order = field<string[]>(s, 'order') ?? [];
    check(order[0] === 'fav-bureau' && order[1] === 'fav-namur', `order ${JSON.stringify(order)}`);
    check(s.title === 'Quai' && s.clock === '07:31', `titre et heure « ${s.title} » ${s.clock}`);
    common(s, H.home);
    return { screen: s, deliver: 'g01', tour: ['glasses-home.png', 'Accueil, 07:31 à la maison : les deux favoris en tête (scène base)'] };
  });
  await step('steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes, page 1');
    check(s.title === 'Vers le bureau : 07:35 → 09:00', `titre « ${s.title} »`);
    check(field(s, 'pages') === 2 && field(s, 'label') === 'simple' && field(s, 'followed') === true, `page ${field(s, 'page')}/${field(s, 'pages')} ${field(s, 'label')} suivi ${field(s, 'followed')}`);
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte en tête « ${s.lines[0]} »`);
    check(/^07:35 {3}Partir à pied vers la gare \(7 min\) {3}dans [34] min$/.test(s.lines[1] ?? ''), `1re étape « ${s.lines[1]} »`);
    check(s.lines[2] === '07:42   IC vers Bruxelles-Midi, voie 6   +2 min', `2e étape « ${s.lines[2]} »`);
    check(s.lines[3] === '08:48   Descendre à Bruxelles-Central' && s.lines[4] === '09:00   Arrivée au bureau (12 min à pied)', `fin ${JSON.stringify(s.lines.slice(3, 5))}`);
    check(s.lines[5] === '▼ Le suivant : 08:33 → 09:58', `ligne du bas « ${s.lines[5]} »`);
    check(s.sel === 0, `repère ▶ sur la 1re étape (sel ${s.sel})`);
    common(s, H.steps);
    return { screen: s, tour: ['glasses-steps.png', 'Trajet proposé Maison vers Bureau, page 1, trajet suivi (alerte de voie en tête)'] };
  });
  await step('train-detail', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('train', loaded), 15_000, 'détail du véhicule');
    check(s.title === 'IC vers Bruxelles-Midi, +2 min', `titre « ${s.title} »`);
    check(has(s, /^Namur {3}07:44 {3}voie 6 !$/) && has(s, /^Bruxelles-Central {3}08:48 {3}descente$/), `arrêts ${JSON.stringify(s.lines)}`);
    common(s, H.train);
    const b = await back(is('steps', (x) => field(x, 'page') === 1), 'retour aux étapes, même page');
    check(field(b, 'followed') === true, 'page 1 toujours suivie');
    return { screen: s, shot: false };
  });
  await step('next-page', async () => {
    await sim.input('down');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 12_000, 'page 2');
    check(field(s, 'label') === 'next' && field(s, 'followed') === false, `label ${field(s, 'label')}, suivi ${field(s, 'followed')}`);
    check(s.title === 'Vers le bureau : 08:33 → 09:58', `titre « ${s.title} »`);
    check(s.lines[0] === 'Le suivant : même trajet, 1 h plus tard', `raison « ${s.lines[0]} »`);
    check(has(s, /^~08:42 {3}IC vers Bruxelles-Midi, voie 5$/), 'IC ~08:42 voie 5');
    check(s.lines[s.lines.length - 2] === '▲ trajet précédent', `ligne du bas « ${s.lines[s.lines.length - 2]} »`);
    check(s.sel === -1, 'pas de repère ▶ sur un trajet non suivi');
    common(s, H.stepsOther);
    return { screen: s, tour: ['glasses-journeys.png', 'Autre trajet (▼) : page 2 « Le suivant », non suivi (remplace la liste des propositions de la 1.0)'] };
  });
  await step('last-page', async () => {
    await sim.input('down');
    const s = await sim.waitScreen(is('steps', (x) => hint(x) === 'Pas d’autre trajet pour l’instant'), 8_000, '« Pas d’autre trajet pour l’instant »');
    check(field(s, 'page') === 2 && s.lines[s.lines.length - 2] === '▲ trajet précédent', 'reste sur la dernière page, « ▲ trajet précédent »');
    await sim.input('up');
    const p1 = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1), 8_000, 'retour page 1');
    check(hint(p1) === H.stepsOther || hint(p1) === H.steps, `le message ne suit pas sur la page 1 : « ${hint(p1)} »`);
    return { screen: s, shot: false };
  });
  await step('follow-other', async () => {
    await sim.input('down');
    await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2 && field(x, 'followed') === true), 8_000, 'page 2 suivie');
    check(hint(s) === 'Trajet suivi : IC 08:42', `message « ${hint(s)} »`);
    await sim.input('up');
    const p1 = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1), 8_000, 'page 1');
    check(field(p1, 'followed') === false && hint(p1) === H.stepsOther, `page 1 plus suivie : ${field(p1, 'followed')} « ${hint(p1)} »`);
    return { screen: s, shot: false };
  });
  await step('other-favorites', async () => {
    const h = await back(homeReady, 'retour à l’accueil');
    check(h.sel === 0, 'curseur gardé sur « Vers le bureau »');
    await sim.select(3);
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 20_000, 'Autres favoris chargés');
    check(s.title === 'Autres favoris', `titre « ${s.title} »`);
    const order = field<string[]>(s, 'order') ?? [];
    check(order.length === 4 && !order.includes('fav-bureau') && !order.includes('fav-namur'), `order ${JSON.stringify(order)}`);
    check(order[order.length - 1] === 'fav-maison', `« Vers la maison » (tu y es) en fin de liste : ${JSON.stringify(order)}`);
    const items = s.lines.slice(0, -2);
    check(items.length <= 7 && items.filter((l) => /^(Vers |Gare |Bruxelles|Namur)/.test(l)).length >= 3, `au moins 3 favoris visibles, 7 lignes au plus : ${JSON.stringify(items)}`);
    common(s, H.favorites);
    return { screen: s, deliver: 'g06' };
  });
  await step('places', async () => {
    await back(homeReady, 'retour à l’accueil');
    await sim.select(4);
    await sim.input('click');
    const s = await sim.waitScreen(is('places', (x) => loaded(x) && x.lines.length >= 7), 25_000, 'Aller à… chargé');
    check(s.lines[0] === 'Maison   ici', `« ${s.lines[0]} »`);
    check(s.lines[1] === 'Bureau   arrivée 09:00', `« ${s.lines[1]} »`);
    check(/^Rue du Progrès 20 {3}arrivée 08:4\d$/.test(s.lines[2] ?? '') && /^Veldstraat 1 {3}arrivée 09:45$/.test(s.lines[3] ?? '') && /^Rue Neuve 1 {3}arrivée 08:58$/.test(s.lines[4] ?? ''), `adresses récentes ${JSON.stringify(s.lines.slice(2, 5))}`);
    check(s.lines[5] === 'Autre adresse   sur le téléphone', `« ${s.lines[5]} »`);
    common(s, H.places);
    return { screen: s, deliver: 'g09', tour: ['glasses-places.png', 'Aller à… : lieux et adresses récentes, avec l’heure d’arrivée'] };
  });
  await step('place-steps', async () => {
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes vers le bureau');
    check(s.title === 'Vers le bureau : 07:35 → 09:00' && field(s, 'label') === 'simple' && field(s, 'followed') === true, `« ${s.title} » ${field(s, 'label')}`);
    await back(is('places'), 'retour à Aller à…');
    await sim.select(5);
    await sim.input('click');
    const t = await sim.waitScreen(is('places', (x) => hint(x) === 'Tape l’adresse dans Quai, sur le téléphone'), 8_000, 'message « Autre adresse »');
    return { screen: t, shot: false };
  });
  await step('exit', async () => {
    await back(homeReady, 'retour à l’accueil');
    const mark = sim.out.join('').length;
    await sim.input('double_click', 2_500);
    check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’accueil : shutDownPageContainer non appelé');
  });
}

/* ------------------------------ Scénario 1 sans temps réel (scène noRT) ------------------------------ */

async function s1noRT(): Promise<void> {
  await stack.scene('noRT');
  try {
    await sim.launch(pageUrl(P11(S1)));
    await step('home', async () => {
      const s = await sim.waitScreen(is('home', (x) => loaded(x) && x.lines[0] === RT_DOWN), 25_000, 'accueil, temps réel indisponible');
      check(/^Vers le bureau {3}partir dans [12] min$/.test(s.lines[1] ?? ''), `1er favori « ${s.lines[1]} »`);
      check(s.lines[2] === 'IC à ~07:42, voie 4, direct, arrivée 08:58', `2e ligne « ${s.lines[2]} »`);
      check(s.lines[3] === 'Namur, train   IC ~07:42 v.4' && s.lines[4] === 'vers Bruxelles-Midi, puis ~08:42', `2e favori ${JSON.stringify(s.lines.slice(3, 5))}`);
      check(s.lines[5] === 'Autour de moi   3 arrêts' && s.lines[6] === 'Autres favoris   4', `menu ${JSON.stringify(s.lines.slice(5, 7))}`);
      check(s.lines[7] === PLANNED, `note « ${s.lines[7]} »`);
      common(s, H.home);
      return { screen: s, deliver: 'g13' };
    });
    await step('go-to-reachable', async () => {
      await sim.select(4);
      const s = await sim.waitScreen(is('home', (x) => x.sel === 4 && x.lines.includes('Aller à…')), 8_000, '« Aller à… » amené par ▼');
      return { screen: s, shot: false };
    });
    await step('steps', async () => {
      await sim.select(0);
      await sim.input('click');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes');
      check(s.title === 'Vers le bureau : 07:33 → 08:58', `titre « ${s.title} »`);
      check(s.lines[0] === 'Le plus simple : direct, à pied 7 + 12 min', `raison « ${s.lines[0]} »`);
      check(has(s, /^~07:42 {3}IC vers Bruxelles-Midi, voie 4$/), 'IC ~07:42 voie 4');
      check(s.lines[s.lines.length - 2] === '▼ Le suivant : 08:33 → 09:58', `ligne du bas « ${s.lines[s.lines.length - 2]} »`);
      common(s, H.steps);
      return { screen: s, deliver: 'g03' };
    });
    await step('next', async () => {
      await sim.input('down');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
      check(field(s, 'label') === 'next' && field(s, 'followed') === false, `page 2 ${field(s, 'label')}`);
      check(s.lines[0] === 'Le suivant : même trajet, 1 h plus tard', `raison « ${s.lines[0]} »`);
      check(has(s, /^~08:42 {3}IC vers Bruxelles-Midi, voie 5$/) && s.sel === -1, 'IC ~08:42, pas de repère');
      check(s.lines[s.lines.length - 2] === '▲ trajet précédent', `ligne du bas « ${s.lines[s.lines.length - 2]} »`);
      common(s, H.stepsOther);
      return { screen: s, deliver: 'g04' };
    });
    await step('up-up', async () => {
      await sim.input('up');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1), 8_000, 'page 1');
      await sim.input('up');
      await sleep(600);
      await sim.drain();
      check(field(sim.last!, 'page') === 1, '▲ sur la page 1 : rien ne change');
      return { screen: s, shot: false };
    });
  } finally {
    await stack.scene('base');
  }
}

/* ------------------------------ Trajet suivi en accéléré : en cours, dans le train, descente ------------------------------ */

async function s1run(): Promise<void> {
  await sim.launch(pageUrl({ ...P11(S1), mockSpeed: '30', mockPath: PATH_S1 }));
  await step('walking', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click', 200);
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true && has(x, /Partir à pied vers la gare \(7 min\) {3}en cours$/)), 40_000, 'marche « en cours »');
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte « ${s.lines[0]} »`);
    check(s.sel === 0, 'repère sur la marche en cours');
    return { screen: s, tour: ['glasses-steps-alert.png', 'Étapes du trajet suivi à 07:36 : marche en cours, voie modifiée en tête'] };
  });
  await step('home-running', async () => {
    const s = await back(is('home', (x) => /^En cours : vers le bureau {3}IC 07:44, voie 6$/.test(x.lines[0] ?? '')), 'accueil avec « En cours »');
    check(/^Vers le bureau /.test(s.lines[1] ?? ''), `favoris sous la ligne « En cours » : « ${s.lines[1]} »`);
    common(s, H.home);
    return { screen: s, deliver: 'g02' };
  });
  await step('resume-from-home', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen((x) => (x.screen === 'steps' && field(x, 'followed') === true) || x.screen === 'train', 10_000, 'trajet en cours rouvert');
    return { screen: s, shot: false };
  });
  await step('in-vehicle', async () => {
    const s = await sim.waitScreen(is('train', clockAtLeast('08:05')), 120_000, 'dans le train vers 08:05');
    check(s.title === 'IC vers Bruxelles-Midi, +2 min', `titre « ${s.title} »`);
    check(has(s, /^Gembloux {3}07:57 {3}passé$/) && has(s, /^Ottignies {3}08:11 {3}prochain$/) && has(s, /^Bruxelles-Central {3}08:48 {3}descente$/), `arrêts ${JSON.stringify(s.lines)}`);
    common(s, H.train);
    return { screen: s, deliver: 'g05', tour: ['glasses-train.png', 'Dans le train à 08:05, ouvert seul au départ de l’IC suivi'] };
  });
  await step('alight', async () => {
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true && clockAtLeast('08:49')(x)), 150_000, 'retour aux étapes à la descente');
    check(has(s, /^09:00 {3}Arrivée au bureau \(12 min à pied\) {3}en cours$/), `marche finale en cours ${JSON.stringify(s.lines)}`);
    check(s.sel === s.lines.findIndex((l) => l.startsWith('09:00')) - 1, `repère sur la dernière étape (sel ${s.sel})`);
    const h = await back(is('home', (x) => /^En cours : vers le bureau {3}arrivée 09:00$/.test(x.lines[0] ?? '')), 'accueil, « En cours » jusqu’à l’arrivée');
    return { screen: h, shot: false };
  });
  await step('ended', async () => {
    const s = await sim.waitScreen(is('home', (x) => !/^En cours/.test(x.lines[0] ?? '') && clockAtLeast('09:05')(x)), 90_000, 'fin du trajet (arrivée plus 5 min)');
    return { screen: s, shot: false };
  });
}

/** CA-M6.5 dans une même session : l'IC part sans l'utilisateur resté à la maison, le trajet en cours prend fin. */
async function s1stay(): Promise<void> {
  await sim.launch(pageUrl({ ...P11(S1), mockSpeed: '30' }));
  await step('not-left', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click');
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true), 15_000, 'étapes suivies');
    // (le filtre des gestes ignore un double toucher moins de 220 ms après un toucher)
    await sleep(300);
    await sim.input('double_click');
    await sim.waitScreen(is('home', (x) => /^En cours : vers le bureau/.test(x.lines[0] ?? '')), 40_000, '« En cours » après 07:35');
    const s = await sim.waitScreen(is('home', (x) => !/^En cours/.test(x.lines[0] ?? '') && clockAtLeast('07:44')(x)), 90_000, '« En cours » retiré après le départ de l’IC');
    return { screen: s, shot: false };
  });
}

/* ------------------------------ Scénario 2 : gare du Nord, retrait annulable, panne du temps réel ------------------------------ */

async function s2(): Promise<void> {
  await sim.launch(pageUrl(P11(S2)));
  await step('board-favorite', async () => {
    const s = await sim.waitScreen(is('board', loaded), 20_000, 'départs du favori ouverts seuls');
    check(s.title === 'Gare du Nord, tram (STIB) ★', `titre « ${s.title} »`);
    const want = [/^T3 {3}Churchill {3}[12] min$/, /^T4 {3}Stalle {3}[45] min$/, /^T3 {3}Esplanade {3}[56] min$/, /^T3 {3}Churchill {3}(9|10) min$/, /^T4 {3}Stalle {3}1[23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `départ ${i + 1} « ${s.lines[i]} »`));
    check(!has(s, /~/), 'tout en temps réel');
    common(s, H.boardFav);
    return { screen: s, deliver: 'g07', tour: ['glasses-board.png', 'Départs d’un arrêt favori (★), ouverts seuls à moins de 300 m'] };
  });
  await step('remove-undo', async () => {
    await sim.input('down');
    await sim.input('up');
    check(sim.last?.sel === -1, 'départs sans curseur (▲▼ font défiler)');
    await sim.input('click', 300);
    const off = await sim.waitScreen(is('board', (x) => hint(x) === '★ Retiré. Toucher encore : annuler'), 6_000, '« ★ Retiré. Toucher encore : annuler »');
    check(off.title === 'Gare du Nord, tram (STIB)', `titre sans ★ « ${off.title} »`);
    const buf = await sim.rawShot();
    const file = join(SHOTS, `${scenario}-undo-message.png`);
    writeFileSync(file, buf);
    deliver('g08', file);
    await sim.input('click', 300);
    const on = await sim.waitScreen(is('board', (x) => hint(x) === '★ Favori rétabli'), 4_000, '« ★ Favori rétabli » (moins de 5 s)');
    check(on.title === 'Gare du Nord, tram (STIB) ★', `★ revenu, même filtre de lignes : « ${on.title} »`);
    const again = await sim.waitScreen(is('board', (x) => hint(x) === H.boardFav), 6_000, 'aide « ★ retirer » revenue');
    return { screen: again, shot: false };
  });
  await step('home', async () => {
    const s = await back(is('home', loaded), 'accueil');
    const order = field<string[]>(s, 'order') ?? [];
    check(order[0] === 'fav-gdn' && order[1] === 'fav-dl-nord', `order ${JSON.stringify(order)} (fav-gdn rétabli, tout près)`);
    check(/^Gare du Nord, tram {3}T3 [12] min$/.test(s.lines[0] ?? '') && /^vers Churchill, puis T4 Stalle [45] min$/.test(s.lines[1] ?? ''), `1er favori ${JSON.stringify(s.lines.slice(0, 2))}`);
    check(/^Bruxelles-Nord, bus De Lijn {3}232 ~[45] min$/.test(s.lines[2] ?? '') && /^vers Vilvorde, puis 460 Meise (9|10) min$/.test(s.lines[3] ?? ''), `2e favori ${JSON.stringify(s.lines.slice(2, 4))}`);
    check(s.lines[4] === 'Autour de moi   4 arrêts', `« ${s.lines[4]} »`);
    common(s, H.home);
    return { screen: s };
  });
  await step('other-favorites', async () => {
    await sim.select(3);
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 20_000, 'Autres favoris');
    const order = field<string[]>(s, 'order') ?? [];
    check(JSON.stringify(order) === JSON.stringify(['fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']), `order ${JSON.stringify(order)} (CA-M1.3)`);
    check(s.lines[2] === 'Vers Gand-Saint-Pierre   départ 14:10' && s.lines[3] === 'IC voie 4 à Bruxelles-Central, arrivée 14:39', `Gand ${JSON.stringify(s.lines.slice(2, 4))}`);
    common(s, H.favorites);
    return { screen: s, tour: ['glasses-favorites.png', 'Autres favoris à 12:10 près de la gare du Nord, avec leur réponse'] };
  });
  await step('nearby', async () => {
    await back(is('home'), 'accueil');
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('nearby', loaded), 15_000, 'Autour de moi');
    const want = [/^Gare du Nord, tram {3}80 m {3}T3 [12] min$/, /^Bruxelles-Nord, train {3}160 m {3}IC 12:22 v\.9$/, /^Bruxelles-Nord, bus De Lijn {3}200 m {3}232 ~[45] min$/, /^Rogier, métro {3}340 m {3}M2 [23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `zone ${i + 1} « ${s.lines[i]} »`));
    common(s, H.nearby);
    return { screen: s, pixels: false, tour: ['glasses-nearby.png', 'Autour de moi à 12:10 près de la gare du Nord'] };
  });
  await step('board-planned', async () => {
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /De Lijn/.test(x.title)), 15_000, 'départs De Lijn');
    check(s.title === 'Bruxelles-Nord, bus (De Lijn) ★', `titre « ${s.title} »`);
    check(s.lines[0]?.startsWith('232   Vilvorde   ~') ?? false, `1er départ « ${s.lines[0]} »`);
    common(s, H.boardFav);
    return { screen: s, pixels: false, tour: ['glasses-board-planned.png', 'Départs De Lijn en partie en horaire prévu (~)'] };
  });
  await step('board-train', async () => {
    await back(is('nearby'), 'retour à Autour de moi');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'départs des trains');
    check(/^IC {3}Anvers-Central {3}12:22 {2}voie 9$/.test(s.lines[0] ?? ''), `1er départ « ${s.lines[0]} »`);
    check(/^S1 {3}.*12:34 {2}SUPPRIMÉ$/.test(s.lines[2] ?? ''), `S1 supprimé « ${s.lines[2]} »`);
    check(s.lines.filter((l) => /12:22/.test(l)).length === 1, 'IC 12:22 une seule fois');
    common(s, H.board);
    return { screen: s, pixels: false, tour: ['glasses-board-train.png', 'Départs des trains à Bruxelles-Nord (S1 supprimé)'] };
  });
  await step('rt-outage', async () => {
    const t0 = Date.now();
    await stack.scene('noRT');
    try {
      const s = await sim.waitScreen(is('board', (x) => /train/.test(x.title) && /~12:22/.test(x.lines[0] ?? '') && x.lines.includes(RT_DOWN)), 45_000, 'panne du temps réel dite juste');
      notes.push(`s2 : panne du temps réel affichée après ${((Date.now() - t0) / 1000).toFixed(1)} s (rafraîchissement 30 s)`);
      check(/^S1 {3}.*12:34 {2}SUPPRIMÉ$/.test(s.lines[2] ?? ''), `suppression gardée 15 min (CA-M8.6) : « ${s.lines[2]} »`);
      await back(is('nearby'), 'Autour de moi');
      const h = await back(is('home', (x) => x.lines[0] === RT_DOWN), 'accueil, ligne du haut « Temps réel indisponible »');
      return { screen: h, pixels: false, shot: false };
    } finally {
      await stack.scene('base');
    }
  });
}

/* ------------------------------ Scénario 3 : l'après-midi vers Gand ------------------------------ */

async function s3(): Promise<void> {
  await sim.launch(pageUrl(P11(S3)));
  await step('home', async () => {
    const s = await sim.waitScreen(homeReady, 20_000, 'accueil');
    check(/^Vers Gand-Saint-Pierre {3}partir dans 1[23] min$/.test(s.lines[0] ?? ''), `1er favori « ${s.lines[0]} »`);
    check(s.lines[1] === 'IC à 14:10, voie 4, direct, arrivée 14:39', `2e ligne « ${s.lines[1]} »`);
    common(s, H.home);
    return { screen: s };
  });
  await step('steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes');
    check(s.title === 'Vers Gand-Saint-Pierre : 14:10 → 14:39', `titre « ${s.title} » (pas de marche au début)`);
    check(s.lines[0] === 'Le plus simple : direct', `raison « ${s.lines[0]} »`);
    check(/^14:10 {3}IC vers Bruges, voie 4 {3}dans 1[45] min$/.test(s.lines[1] ?? '') && s.lines[2] === '14:39   Arrivée à Gand-Saint-Pierre', `étapes ${JSON.stringify(s.lines.slice(1, 3))}`);
    check(s.lines[3] === '▼ Le suivant : 14:25 → 14:56' && field(s, 'pages') === 3, `ligne du bas « ${s.lines[3]} », ${field(s, 'pages')} pages`);
    common(s, H.steps);
    return { screen: s, tour: ['glasses-trip.png', 'Vers Gand-Saint-Pierre, favori de gare à gare : ses étapes (remplace l’écran Trains A ▶ B de la 1.0)'] };
  });
  await step('labels', async () => {
    const labels = [field<string>(sim.last!, 'label')];
    for (let i = 2; i <= 3; i++) {
      await sim.input('down');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === i), 8_000, `page ${i}`);
      labels.push(field<string>(s, 'label'));
    }
    check(JSON.stringify(labels) === JSON.stringify(['simple', 'next', 'next']), `étiquettes ${JSON.stringify(labels)} (CA-M3.3)`);
    await sim.input('up');
    await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
    await sim.input('up');
    await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1), 8_000, 'page 1');
  });
  await step('train-detail', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('train', loaded), 15_000, 'détail du train');
    check(s.title === 'IC vers Bruges' && has(s, /^Gand-Saint-Pierre {3}14:39 {3}descente$/), `« ${s.title} » ${JSON.stringify(s.lines)}`);
    common(s, H.train);
    return { screen: s, pixels: false, tour: ['glasses-train-detail.png', 'Détail du train suivi (toucher sur les étapes)'] };
  });
}

/** Scénario 3 en accéléré : dans le train à 14:10, aide à l'arrivée 3 min avant Gand-Saint-Pierre (CA-M2.5). */
async function s3run(): Promise<void> {
  await sim.launch(pageUrl({ ...P11({ ...S3, mockNow: '2026-11-10T14:05:00+01:00' }), mockSpeed: '20', mockPath: PATH_S3 }));
  await step('train', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.input('click', 200);
    await sim.waitScreen(is('steps', (x) => field(x, 'followed') === true), 20_000, 'étapes suivies');
    const s = await sim.waitScreen(is('train', clockAtLeast('14:10')), 60_000, 'dans le train à 14:10');
    check(s.title === 'IC vers Bruges', `titre « ${s.title} »`);
    return { screen: s, pixels: false };
  });
  await step('arrival', async () => {
    const s = await sim.waitScreen(is('arrival', (x) => loaded(x) && x.lines.some((l) => /^Tram 1 /.test(l))), 120_000, 'aide à l’arrivée');
    check(s.title === 'Arrivée à Gand-Saint-Pierre', `titre « ${s.title} »`);
    check(/^Dans \d+ min\. Ensuite, devant la gare :$/.test(s.lines[0] ?? ''), `« ${s.lines[0]} »`);
    check(s.lines.filter((l) => /^Tram 1 {3}Korenmarkt {3}~?\d+ min$/.test(l)).length >= 1, `trams vers Korenmarkt ${JSON.stringify(s.lines)}`);
    check((s.clock ?? '') >= '14:36' && (s.clock ?? '') < '14:39', `vers 14:36 (${s.clock})`);
    common(s, H.arrival);
    return { screen: s, pixels: false, tour: ['glasses-arrival.png', 'Aide à l’arrivée 3 min avant Gand-Saint-Pierre'] };
  });
}

/* ------------------------------ Scénario 4 : Waterloo, trois trajets ------------------------------ */

async function waterloo(): Promise<void> {
  await sim.launch(pageUrl(PREC(WAT)));
  await step('places', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.select(4);
    await sim.input('click');
    const s = await sim.waitScreen(is('places', (x) => x.lines.some((l) => /^Rue du Progrès 20 {3}arrivée 08:46$/.test(l))), 25_000, 'Aller à…');
    return { screen: s };
  });
  await step('simple', async () => {
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 25_000, 'étapes, page 1');
    check(field(s, 'label') === 'simple' && field(s, 'pages') === 3 && field(s, 'followed') === true, `page 1 ${field(s, 'label')} / ${field(s, 'pages')}`);
    check(s.title === 'Vers Rue du Progrès 20 : 07:32 → 08:46', `titre « ${s.title} »`);
    check(s.lines[0] === 'Le plus simple : 1 changement, à pied 2 + 2 + 3 min', `raison « ${s.lines[0]} »`);
    check(has(s, /^~07:36 {3}W vers Bruxelles Midi$/) && has(s, /^~08:29 {3}M2 vers Simonis \(Elisabeth\)$/), 'bus W puis métro M2 (CA-M3.5)');
    check(s.lines[s.lines.length - 2] === '▼ 1 étape de plus', `ligne du bas « ${s.lines[s.lines.length - 2]} »`);
    common(s, H.steps);
    return { screen: s, deliver: 'g11' };
  });
  await step('fast', async () => {
    await sim.input('down');
    const end = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && x.lines[x.lines.length - 2] === '▼ Le plus rapide : 07:34 → 08:30'), 8_000, 'fin des étapes de la page 1');
    check(has(end, /^08:46 {3}Arrivée à Rue du Progrès 20 \(3 min à pied\)$/), 'arrivée 08:46');
    await sim.input('down');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
    check(field(s, 'label') === 'fast' && s.title === 'Vers Rue du Progrès 20 : 07:34 → 08:30', `« ${s.title} » ${field(s, 'label')}`);
    check(s.lines[0] === 'Le plus rapide : 16 min plus tôt, direct', `raison « ${s.lines[0]} »`);
    check(has(s, /^07:34 {3}Partir à pied vers la gare \(19 min\) {3}dans [23] min$/) && has(s, /^~07:55 {3}S1 vers Bruxelles-Nord, voie 1$/), `marche puis S1 ${JSON.stringify(s.lines)}`);
    common(s, H.stepsOther);
    return { screen: s, deliver: 'g12' };
  });
  await step('third', async () => {
    await sim.input('down');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 3), 8_000, 'page 3');
    check(field(s, 'label') === 'next' && s.lines[0] === 'Le suivant : même trajet, 20 min plus tard', `page 3 « ${s.lines[0]} »`);
    await sim.input('up');
    await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
    await sim.input('up');
    const p1 = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1), 8_000, 'page 1');
    check(p1.lines[p1.lines.length - 2] === '▼ Le plus rapide : 07:34 → 08:30', 'page 1 affichée par sa fin');
    return { screen: p1 };
  });
}

/* ------------------------------ Mise à jour depuis la 1.0, premier lancement ------------------------------ */

async function news(): Promise<void> {
  await sim.launch(pageUrl(P10(S1)));
  await step('message', async () => {
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Quai 1.1'), 20_000, 'message « Quai 1.1 »');
    check(JSON.stringify(s.lines.slice(0, 4)) === JSON.stringify(NEWS), `texte ${JSON.stringify(s.lines)}`);
    common(s, H.news);
    return { screen: s, pixels: false, deliver: 'g10' };
  });
  await step('home', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(homeReady, 20_000, 'accueil');
    const order = field<string[]>(s, 'order') ?? [];
    check(JSON.stringify([...order].sort()) === JSON.stringify(['fav-bureau', 'fav-dl-nord', 'fav-gand', 'fav-gdn', 'fav-namur']), `favoris de la 1.0 gardés : ${JSON.stringify(order)}`);
    check(order[0] === 'fav-bureau' && s.lines.includes('Autres favoris   3'), `ordre ${JSON.stringify(order)}`);
    await sim.select(3);
    await sim.input('click');
    await sim.waitScreen(is('favorites'), 15_000, 'Autres favoris');
    const h = await back(is('home'), 'accueil');
    const homeId = sim.screens.find((y) => y.screen === 'home')?.id ?? 0;
    check(!sim.screens.some((x) => x.title === 'Quai 1.1' && x.id > homeId), '« Quai 1.1 » ne revient pas pendant la session');
    return { screen: h, shot: false };
  });
}

async function firstrun(): Promise<void> {
  const frames: { t: number; lit: number }[] = [];
  await sim.launch(pageUrl({ ...S2, reset: '1' }), {
    waitReady: false,
    onPing: async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5_000) {
        try {
          frames.push({ t: Date.now() - t0, lit: litPixels(await sim.rawShot()).lit });
        } catch {
          frames.push({ t: Date.now() - t0, lit: -1 });
        }
        await sleep(100);
      }
    },
  });
  await step('welcome', async () => {
    const first = frames.findIndex((f) => f.lit > 0);
    check(first >= 0, 'aucune image pendant 5 s');
    check(!frames.slice(first).some((f) => f.lit <= 0), 'écran noir après le premier affichage');
    const s = await sim.waitScreen(is('message', (x) => x.lines[0] === WELCOME[0]), 20_000, 'bienvenue');
    check(JSON.stringify(s.lines.slice(0, 4)) === JSON.stringify(WELCOME), `texte ${JSON.stringify(s.lines)}`);
    check(!sim.screens.some((x) => x.title === 'Quai 1.1'), 'jamais « Quai 1.1 » après une nouvelle installation');
    common(s, H.firstRun);
    return { screen: s, pixels: false, tour: ['glasses-first-run.png', 'Premier lancement : bienvenue, réglages sur le téléphone'] };
  });
  await step('home-empty', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil sans favori');
    check(s.lines[0] === 'Près de Bruxelles-Nord', `ligne du haut « ${s.lines[0]} » (seulement sans favoris en tête)`);
    check(JSON.stringify(s.lines.slice(1, 4)) === JSON.stringify(['Ajouter un favori', 'Autour de moi   4 arrêts', 'Aller à…']), `menu ${JSON.stringify(s.lines)}`);
    common(s, H.home);
    return { screen: s, tour: ['glasses-home-near.png', 'Accueil sans favori : « Près de Bruxelles-Nord », « Ajouter un favori »'] };
  });
  await step('empty-list', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Mes favoris'), 10_000, 'liste vide');
    check(JSON.stringify(s.lines.slice(0, 3)) === JSON.stringify(['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', 'ou ajoute un trajet sur le téléphone.']), `texte ${JSON.stringify(s.lines)}`);
    common(s, H.message);
    return { screen: s, pixels: false };
  });
  await step('places-empty', async () => {
    await back(is('home'), 'retour à l’accueil');
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('places'), 10_000, 'Aller à…');
    check(JSON.stringify(s.lines.slice(0, 2)) === JSON.stringify(['Aucun lieu enregistré   sur le téléphone', 'Autre adresse   sur le téléphone']), `lignes ${JSON.stringify(s.lines)}`);
    common(s, H.places);
    return { screen: s };
  });
  await step('exit', async () => {
    await back(is('home'), 'retour à l’accueil');
    const mark = sim.out.join('').length;
    await sim.input('double_click', 2_500);
    check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’accueil : shutDownPageContainer non appelé');
  });
}

/* ------------------------------ Pannes : horaires injoignables, relais muet, aucun arrêt, périmés ------------------------------ */

/** Mandataire des horaires : en panne (HTTP 503) ou transparent, au choix du test. */
async function switchable(target: string): Promise<{ url: string; up(on: boolean): void; close(): Promise<void> }> {
  let on = false;
  const server = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (!on) {
      res.writeHead(503, cors);
      res.end('indisponible');
      return;
    }
    try {
      const r = await fetch(target + (req.url ?? '/'));
      res.writeHead(r.status, { ...cors, 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(502, cors);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    up: (v) => (on = v),
    close: () => new Promise<void>((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    }),
  };
}

async function errors(): Promise<void> {
  const proxy = await switchable(night.url);
  try {
    await sim.launch(pageUrl(P11(S2), '', { data: proxy.url }));
    await step('data-unreachable', async () => {
      const s = await sim.waitScreen(is('message', (x) => x.lines[0] === 'Horaires injoignables : nouvel essai dans 30 s'), 40_000, 'horaires injoignables');
      common(s, H.errorRoot);
      return { screen: s, pixels: false };
    });
    await step('retry-tap', async () => {
      proxy.up(true);
      await sim.input('click');
      const s = await sim.waitScreen((x) => x.screen === 'board' || x.screen === 'home', 30_000, 'Quai démarré après « réessayer »');
      return { screen: s, shot: false };
    });
    proxy.up(false);
    await sim.launch(pageUrl(P11(S2), '', { data: proxy.url }));
    await step('retry-auto', async () => {
      await sim.waitScreen(is('message', (x) => /^Horaires injoignables/.test(x.lines[0] ?? '')), 40_000, 'horaires injoignables');
      const t0 = Date.now();
      proxy.up(true);
      const s = await sim.waitScreen((x) => x.screen === 'board' || x.screen === 'home', 45_000, 'nouvel essai seul (30 s)');
      notes.push(`errors : démarrage seul ${((Date.now() - t0) / 1000).toFixed(1)} s après le retour du serveur d’horaires`);
      return { screen: s, shot: false };
    });
    proxy.up(false);
    await sim.launch(pageUrl(P11(S2), '', { data: proxy.url }));
    await step('error-exit', async () => {
      await sim.waitScreen(is('message', (x) => /^Horaires injoignables/.test(x.lines[0] ?? '')), 40_000, 'horaires injoignables');
      const mark = sim.out.join('').length;
      await sim.input('double_click', 2_500);
      check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’erreur au lancement : shutDownPageContainer non appelé');
    });
  } finally {
    await proxy.close();
  }
  await sim.launch(pageUrl(P11(S2), '', { relay: 'http://127.0.0.1:9' }));
  await step('relay-down', async () => {
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && x.lines.includes(RT_DOWN)), 30_000, 'départs sans relais');
    check(s.lines.slice(0, 5).every((l) => /~\d+ min$/.test(l)), `tout en horaire prévu : ${JSON.stringify(s.lines)}`);
    const h = await back(is('home', (x) => x.lines[0] === RT_DOWN), 'accueil, « Temps réel indisponible » (pas « Pas de réseau »)');
    return { screen: h, shot: false };
  });
  await sim.launch(pageUrl({ ...P11(S2), mockLat: '50.1', mockLon: '5.2' }));
  await step('nearby-empty', async () => {
    await sim.waitScreen(is('home', loaded), 20_000, 'accueil');
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Autour de moi'), 15_000, 'aucun arrêt');
    check(s.lines[0] === 'Aucun arrêt dans un rayon de 500 m', `« ${s.lines[0]} »`);
    common(s, H.message);
    return { screen: s, pixels: false, tour: ['glasses-nearby-empty.png', 'Autour de moi sans arrêt dans le rayon'] };
  });
}

async function stale(): Promise<void> {
  const { dir } = await buildFixtureData({ date: '2026-11-01' });
  const old = await startDataServer(dir);
  try {
    await sim.launch(pageUrl(P11(S2), '', { data: old.url }));
    await step('home', async () => {
      const STALE = 'Horaires périmés : mise à jour arrêtée le 02/11';
      const b = await sim.waitScreen(is('board', (x) => x.lines[0] === STALE), 25_000, 'départs du favori proche, horaires périmés');
      check(!b.lines.some((l) => /\d+ min$/.test(l)), `aucun départ avec des horaires périmés : ${JSON.stringify(b.lines)}`);
      const s = await back(is('home', (x) => x.lines[0] === STALE), 'accueil, horaires périmés');
      common(s, H.home);
      const buf = await sim.rawShot();
      for (let i = 0; i < 6; i++) await sim.input('down', 400);
      await sim.drain();
      const end = sim.last!;
      check(end.screen === 'home' && end.lines.includes('Aller à…') && end.lines[0] === STALE && end.sel === 4, `« Aller à… » atteint par ▼ (CA-M1.9) : sel ${end.sel} ${JSON.stringify(end.lines)}`);
      const file = join(SHOTS, `${scenario}-home-first.png`);
      writeFileSync(file, buf);
      tour('glasses-home-stale.png', file, 'Accueil quand la mise à jour de nuit est en panne');
      return { screen: s, shot: false };
    });
  } finally {
    await old.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 23:30 : départs du lendemain (S6) : « Départs de demain » en ligne du haut ; train de 00:01 sans « demain ». */
async function late(): Promise<void> {
  await sim.launch(pageUrl(P11({ ...S2, mockNow: '2026-11-10T23:30:00+01:00' })));
  await step('board-tomorrow', async () => {
    const s = await sim.waitScreen(is('board', loaded), 20_000, 'favori proche ouvert');
    check(s.lines[0] === 'Départs de demain', `ligne du haut « ${s.lines[0]} »`);
    check(!s.lines.some((l) => /demain, /.test(l)), `pas de « demain, » sur chaque ligne : ${JSON.stringify(s.lines)}`);
    check(!s.lines.some((l) => /\(P\)/.test(l)), 'Stalle sans « (P) »');
    return { screen: s, pixels: false };
  });
  await step('train-after-midnight', async () => {
    await back(is('home'), 'accueil');
    await sim.select(2);
    await sim.input('click');
    await sim.waitScreen(is('nearby', loaded), 15_000, 'Autour de moi');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'trains');
    check(/^IC {3}Anvers-Central {3}~?00:01 {2}voie 9$/.test(s.lines[0] ?? ''), `train de 00:01 sans « demain » (CA-S6.4) : « ${s.lines[0]} »`);
    return { screen: s, pixels: false };
  });
}

/* ------------------------------ Téléphone (Chrome) ------------------------------ */

const NO_EMU = '#glasses-emulator{display:none !important}';

/** Chrome neuf (stockage vide) pour un scénario du téléphone. */
async function withChrome(fn: (page: Page) => Promise<void>, viewport?: { width: number; height: number; dpr: number; mobile: boolean }): Promise<void> {
  const chrome = await Chrome.launch();
  const page = await chrome.newPage(viewport);
  try {
    await fn(page);
  } finally {
    const errs = page.errors.filter((e) => !/favicon/i.test(e));
    if (errs.length) notes.push(`${scenario} : erreurs de la page : ${errs.join(' | ').slice(0, 400)}`);
    await chrome.close();
  }
}

/** Étape du téléphone : capture facultative (390 × 844, densité 2, sans l'émulateur des lunettes de la page). */
async function phoneStep(page: Page, name: string, fn: () => Promise<{ shot?: boolean; deliver?: keyof typeof DELIVERABLES; scroll?: string; glasses?: GlassesScreen } | void>): Promise<void> {
  const t0 = Date.now();
  const r: StepResult = { scenario, step: name, ok: true, ms: 0 };
  try {
    const out = (await fn()) ?? {};
    if (out.glasses) r.screen = out.glasses;
    if (out.shot !== false && (out.shot || out.deliver)) {
      await page.addStyle(NO_EMU);
      await page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur(), true`);
      if (out.scroll) await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(out.scroll)}); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); else window.scrollTo(0, 0); return true; })()`);
      else await page.eval('window.scrollTo(0, 0), true');
      await sleep(250);
      const file = join(SHOTS, `${scenario}-${name}.png`);
      await page.screenshot(file);
      r.shot = file.slice(E2E.length + 1);
      if (out.deliver) deliver(out.deliver, file);
    }
    console.log(`  ✓ ${scenario}-${name}${r.screen ? `\n      lunettes : ${show(r.screen as GlassesScreen & Record<string, unknown>)}` : ''}`);
  } catch (e) {
    r.ok = false;
    r.error = (e as Error).message;
    console.log(`  ✗ ${scenario}-${name} : ${r.error}`);
    try {
      await page.addStyle(NO_EMU);
      await page.screenshot(join(SHOTS, `${scenario}-${name}-ECHEC.png`));
    } catch {
      /* page fermée */
    }
  }
  r.ms = Date.now() - t0;
  results.push(r);
}

/** Attend que le texte de la page (espaces insécables normalisées) vérifie `re` ; rend ce texte. */
async function waitText(page: Page, re: RegExp, label: string, timeout = 10_000, selector = 'main'): Promise<string> {
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < timeout) {
    t = await page.text(selector);
    if (re.test(t)) return t;
    await sleep(150);
  }
  throw new Check(`délai dépassé : ${label} (texte : ${t.slice(0, 500)})`);
}

/** Texte des propositions du champ (« libellé | type »). */
const suggestions = (page: Page, id: string) =>
  page.eval<string[]>(`[...document.querySelectorAll('#${id}-liste [role=option]')].map((b) => b.querySelector('.s1').textContent + ' | ' + b.querySelector('.s2').textContent)`);
const noCoordinates = async (page: Page) => {
  const t = await page.text('main');
  check(!/\b\d{1,2}[.,]\d{4,}\b/.test(t), `coordonnées affichées : ${/\b\d{1,2}[.,]\d{4,}\b/.exec(t)?.[0]}`);
};

async function phone(): Promise<void> {
  await withChrome(async (page) => {
    await phoneStep(page, 'home', async () => {
      await page.goto(pageUrl(P11(S1), '#/'));
      await page.waitFor(`document.querySelector('.home-favs')?.innerText.includes('partir à 07:35')`, 20_000, 'réponses des favoris sur l’accueil');
      const t = await page.text('main');
      check(t.includes('Où vas-tu ?') && t.includes('Adresse, gare, arrêt ou lieu') && t.includes('Mes favoris') && t.includes('Gérer mes favoris'), 'accueil : champ et section « Mes favoris »');
      const buttons = await page.eval<number>(`document.querySelectorAll('.home-favs button.btn-glasses').length`);
      check(buttons === 6, `un bouton « Lunettes » par favori (${buttons})`);
      return { deliver: 'p01' };
    });
    await phoneStep(page, 'favorite-to-glasses', async () => {
      const n = page.screens().length;
      await page.eval(`(() => { const row = [...document.querySelectorAll('.home-favs .fav-row')].find((r) => r.innerText.includes('Vers le bureau')); row.querySelector('button').click(); return true; })()`);
      const g = await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 20_000, 'étapes suivies dans les lunettes', n);
      const msg = nbn(await page.waitFor<string>(`[...document.querySelectorAll('.home-favs .msg')].map((m) => m.textContent).filter(Boolean).join('|')`, 10_000, 'message à côté du bouton'));
      check(msg === 'Affiché dans les lunettes : IC 07:42, voie 6.', `message « ${msg} »`);
      check(g.title === 'Vers le bureau : 07:35 → 09:00' && g.page === 1, `lunettes « ${g.title} » page ${g.page}`);
      // arrêt favori : ses départs, un seul message (celui du bouton touché)
      const m = page.screens().length;
      await page.eval(`(() => { const row = [...document.querySelectorAll('.home-favs .fav-row')].find((r) => r.innerText.includes('Gare du Nord')); row.querySelector('button').click(); return true; })()`);
      const b = await page.waitScreen((s) => s.screen === 'board' && /^Gare du Nord, tram \(STIB\) ★$/.test(s.title), 20_000, 'départs de l’arrêt favori dans les lunettes', m);
      const msgs = (await page.eval<string[]>(`[...document.querySelectorAll('.home-favs .msg')].map((m) => m.textContent).filter(Boolean)`)).map(nbn);
      check(msgs.length === 1 && msgs[0] === 'Affiché dans les lunettes : départs de Gare du Nord.', `un seul message : ${JSON.stringify(msgs)}`);
      return { glasses: b };
    });
  });

  await stack.scene('noRT');
  try {
    await withChrome(async (page) => {
      await phoneStep(page, 'results', async () => {
        await page.goto(pageUrl(P11(S1), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste [role=option]')].some((b) => b.innerText.includes('Rue Neuve 1, 1000 Bruxelles'))`, 10_000, 'adresse proposée');
        const first = (await suggestions(page, 'r-arrivee'))[0];
        check(first === 'Rue Neuve 1, 1000 Bruxelles | adresse', `1re proposition « ${first} » (le texte ressemble à une adresse)`);
        await page.clickText('Rue Neuve 1, 1000 Bruxelles', '#r-arrivee-liste');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.innerText.replace(/\\n+/g, ' | '))`)).map(nbn);
        check(/^Le plus simple \| 07:33 → 08:56 \| 1 h 23, direct, 17 min à pied/.test(cards[0]) && cards[0].includes('Le moins de changements et de marche.'), `carte 1 : ${cards[0]}`);
        check(/^Le plus rapide \| 07:33 → 08:51 \| 1 h 18, 1 changement, 12 min à pied/.test(cards[1]) && cards[1].includes('Arrive 5 min plus tôt, avec 1 changement de plus.'), `carte 2 : ${cards[1]}`);
        check(/^Le suivant \| 08:33 → 09:56/.test(cards[2]) && cards[2].includes('Même trajet, départ suivant.'), `carte 3 : ${cards[2]}`);
        check(cards.every((c) => c.endsWith('Lunettes')), 'un bouton « Lunettes » par carte');
        const roles = await page.eval<string>(`document.querySelector('.results').getAttribute('role') + '/' + document.querySelectorAll('.results [role=radio]').length + '/' + document.querySelector('.result button.btn-glasses').getAttribute('aria-label')`);
        check(roles === 'radiogroup/3/Afficher Le plus simple dans les lunettes', `accessibilité ${roles} (CA-M4.13)`);
        check((await page.text('.results-box')).includes('3 trajets.'), 'nombre de trajets annoncé');
        check(await page.eval<boolean>(`[...document.querySelectorAll('.save-link button')].some((b) => b.textContent === 'Enregistrer comme lieu')`), '« Enregistrer comme lieu » sous le champ');
        return { deliver: 'p03', scroll: '.res-head' };
      });
      await phoneStep(page, 'glasses-button', async () => {
        const n = page.screens().length;
        await page.click('.result:nth-child(2) button.btn-glasses');
        const g = await page.waitScreen((s) => s.screen === 'steps' && s.page === 2 && s.followed === true, 20_000, 'trajet de la carte 2 suivi', n);
        check(g.label === 'fast' && g.pages === 3 && g.title === 'Vers Rue Neuve 1 : 07:33 → 08:51', `lunettes ${g.label} ${g.pages} « ${g.title} »`);
        const msgs = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.querySelector('.msg')?.textContent ?? '')`)).map(nbn);
        check(msgs[1] === 'Affiché dans les lunettes : IC 07:42, voie 4.' && !msgs[0] && !msgs[2], `message seulement à côté du bouton touché : ${JSON.stringify(msgs)}`);
        return { deliver: 'p04', scroll: '.result:nth-child(2)', glasses: g };
      });
      await phoneStep(page, 'glasses-pages', async () => {
        const n = page.screens().length;
        await page.gesture('down');
        await page.gesture('down');
        const p3 = await page.waitScreen((s) => s.screen === 'steps' && s.page === 3, 8_000, 'page 3', n);
        check(p3.label === 'next' && p3.followed === false, `page 3 ${p3.label}`);
        // ▲ : la page précédente, affichée par sa fin (la page 2 a une étape cachée en haut), puis la page 1
        for (let i = 0; i < 4 && page.lastScreen()?.page !== 1; i++) await page.gesture('up');
        const p1 = await page.waitScreen((s) => s.screen === 'steps' && s.page === 1, 8_000, 'page 1', n);
        check(p1.label === 'simple' && p1.lines[p1.lines.length - 2] === '▼ Le plus rapide : 07:33 → 08:51', `page 1 ${JSON.stringify(p1.lines)}`);
        return { glasses: p1 };
      });
    });
  } finally {
    await stack.scene('base');
  }

  await withChrome(async (page) => {
    await phoneStep(page, 'field', async () => {
      await page.goto(pageUrl(preset('p/phone.json')(S3), '#/recherche'));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await stack.geoJournalReset();
      await page.type('#r-arrivee', 'bruxelles');
      await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste .s2')].some((e) => e.textContent === 'adresse')`, 10_000, 'adresses proposées');
      const list = await suggestions(page, 'r-arrivee');
      const types = new Set(list.map((l) => l.split(' | ')[1]));
      for (const t of ['mon lieu', 'récent', 'gare SNCB', 'adresse']) check(types.has(t), `type « ${t} » absent : ${JSON.stringify(list)}`);
      check(list[0] === 'Piscine de Bruxelles | mon lieu' && list[1] === 'Boulevard du Centenaire 1, 1020 Bruxelles | récent', `lieux et récents d’abord : ${JSON.stringify(list)}`);
      const stops = list.findIndex((l) => / \| gare SNCB$/.test(l));
      const addr = list.findIndex((l) => / \| adresse$/.test(l));
      check(stops < addr, 'gares avant adresses (le texte ne ressemble pas à une adresse)');
      const journal = await stack.geoJournal();
      const leaks = journal.filter((j) => Object.entries(j.params).some(([k, v]) => /lat|lon|^x$|^y$|pos|near|id/i.test(k) || /50\.8|4\.35/.test(v)));
      check(journal.length > 0 && !leaks.length, `requêtes d’adresses : seul le texte tapé (${journal.length} requêtes, ${leaks.length} avec position ou identifiant)`);
      return { deliver: 'p02' };
    });
    await phoneStep(page, 'field-messages', async () => {
      await stack.geoScene('down');
      try {
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await page.waitFor(`${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Adresses indisponibles pour l’instant : gares et arrêts seulement.'`, 10_000, 'service d’adresses en panne (CA-M4.6)');
        await page.type('#r-arrivee', 'gare du nord');
        await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste [role=option]')].length > 0 && ${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Adresses indisponibles pour l’instant : gares et arrêts seulement.'`, 10_000, 'gares et arrêts toujours proposés');
      } finally {
        await stack.geoScene('base');
      }
      await page.type('#r-arrivee', 'namur');
      await page.waitFor(`document.querySelectorAll('#r-arrivee-liste [role=option]').length > 0`, 10_000);
      await page.offline(true);
      await page.type('#r-arrivee', 'rue de fer 25 namur');
      await page.waitFor(`${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Recherche d’adresse impossible sans connexion : gares et arrêts seulement.'`, 10_000, 'téléphone hors ligne');
      await page.offline(false);
      await page.type('#r-arrivee', 'qxzqxzwvk');
      await page.waitFor(`${N("document.querySelector('#r-arrivee-etat')?.textContent")} === 'Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe.'`, 10_000, 'rien ne correspond (CA-M4.7)');
      await page.type('#r-arrivee', 'rue de fer 25');
      await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste .s1')].filter((e) => /^Rue de Fer 25, /.test(e.textContent)).length === 2`, 10_000, 'deux homonymes (F2-b)');
    });
    await phoneStep(page, 'save-as-place', async () => {
      await page.type('#r-arrivee', 'veldstraat 1 gent');
      await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste [role=option]')].some((b) => b.innerText.includes('Veldstraat 1, 9000 Gent'))`, 10_000);
      await page.clickText('Veldstraat 1, 9000 Gent', '#r-arrivee-liste');
      await page.waitFor(`document.querySelectorAll('.result').length >= 2`, 15_000, 'cartes vers Veldstraat (CA-M4.4)');
      await page.clickText('Enregistrer comme lieu', '.save-link');
      await page.waitFor(`!!document.querySelector('.save-link .save-panel')`, 5_000, 'panneau « Enregistrer comme lieu »');
      const shortcuts = await page.eval<string[]>(`[...document.querySelectorAll('.save-link .shortcut')].map((b) => b.textContent)`);
      check(JSON.stringify(shortcuts) === JSON.stringify(['Maison', 'Bureau', 'École']), `raccourcis ${JSON.stringify(shortcuts)}`);
      return { deliver: 'p05' };
    });
    await phoneStep(page, 'place-saved', async () => {
      await page.type('.save-link .save-panel input', 'Rendez-vous');
      await page.clickText('Enregistrer le lieu', '.save-link');
      const msg = nbn(await page.waitFor<string>(`[...document.querySelectorAll('.msg')].map((m) => m.textContent).find((t) => t.startsWith('Lieu enregistré'))`, 8_000, 'message « Lieu enregistré »'));
      check(msg === 'Lieu enregistré : Rendez-vous.', `« ${msg} »`);
      const n = page.screens().length;
      await page.goto(pageUrl({ ...S3 }, '#/lieux'));
      await waitText(page, /Rendez-vous\s+Veldstraat 1, 9000 Gent\s+.+à \d+ min à pied/, '« Rendez-vous », adresse et accès dans « Mes lieux » (CA-M4.5)');
      await noCoordinates(page);
      // Lunettes (émulateur de la page, rouvert avec la page) : accueil, puis « Aller à… » (5e élément)
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil des lunettes', n);
      for (let i = 0; i < 4; i++) await page.gesture('down');
      await page.waitScreen((s) => s.screen === 'home' && s.sel === 4, 5_000, '« Aller à… » choisi', n);
      await page.gesture('tap');
      const g = await page.waitScreen((s) => s.screen === 'places' && s.lines.some((l) => /^Rendez-vous {3}arrivée \d\d:\d\d$/.test(l)), 20_000, '« Rendez-vous » dans « Aller à… »', n);
      return { glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'new-place', async () => {
      await page.goto(pageUrl(P11(S3), '#/lieux'));
      await page.waitFor(`document.querySelector('main')?.innerText.includes('Ajouter un lieu')`, 10_000);
      await page.clickText('Ajouter un lieu');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau lieu'`, 5_000, 'écran « Nouveau lieu »');
      await page.clickText('École');
      await page.type('input[role=combobox]', 'rue de fer 25 namur');
      await page.waitFor(`[...document.querySelectorAll('[role=listbox] [role=option]')].some((b) => b.innerText.includes('Rue de Fer 25, 5000 Namur'))`, 10_000);
      await page.clickText('Rue de Fer 25, 5000 Namur', '[role=listbox]');
      await page.waitFor(`/Namur à \\d+ min à pied/.test(${N("document.querySelector('main').innerText")})`, 10_000, 'accès en confirmation');
      check((await page.text('main')).includes('Rue de Fer 25, 5000 Namur'), 'adresse normalisée');
      check(!(await page.eval<boolean>(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer le lieu').disabled`)), '« Enregistrer le lieu » actif');
      await noCoordinates(page);
      return { deliver: 'p06' };
    });
    await phoneStep(page, 'new-place-offer', async () => {
      await page.clickText('Enregistrer le lieu');
      await waitText(page, /Ajouter le trajet vers École à tes favoris \?/, 'question « Ajouter le trajet vers École à tes favoris ? » (S3)');
      await page.clickText('Ajouter aux favoris');
      await page.goto(pageUrl({ ...S3 }, '#/favoris'));
      await waitText(page, /Ma position → École/, 'nouveau trajet favori');
    });
    await phoneStep(page, 'reorder', async () => {
      await waitText(page, /Changer l’ordre/, 'bouton « Changer l’ordre »');
      await page.clickText('Changer l’ordre');
      await page.waitFor(`document.querySelectorAll('.order-row').length >= 2`, 5_000, 'mode « Changer l’ordre »');
      const before = await page.eval<string[]>(`[...document.querySelectorAll('.order-row .t1')].map((e) => e.textContent)`);
      check(before[4] === 'Bruxelles-Nord', `5e favori « ${before[4]} »`);
      await page.click(`.order-row:nth-child(5) button:first-of-type`);
      await page.waitFor(`document.querySelector('.order-row:nth-child(4) .t1').textContent === 'Bruxelles-Nord'`, 5_000, '« Bruxelles-Nord » monté');
      return { deliver: 'p08' };
    });
    await phoneStep(page, 'my-order', async () => {
      // « Bruxelles-Nord » (bus De Lijn, départs toutes les 15 min) monté en 1re place, puis « Dans mon ordre »
      // (CA-S3.2 ; un favori sans rien dans les 3 heures resterait en fin de liste, règle 5).
      for (const row of [4, 3, 2]) {
        await page.click(`.order-row:nth-child(${row}) button:first-of-type`);
        await page.waitFor(`document.querySelector('.order-row:nth-child(${row - 1}) .t1')?.textContent === 'Bruxelles-Nord'`, 5_000, `« Bruxelles-Nord » en ${row - 1}e place`);
      }
      await page.clickText('Terminé');
      const first = await page.eval<string>(`document.querySelector('.list .t1')?.textContent ?? ''`);
      check(first === 'Bruxelles-Nord', `« Bruxelles-Nord » monté en 1re place (${first})`);
      const n = page.screens().length;
      await page.goto(pageUrl({ ...S3 }, '#/affichage'));
      await waitText(page, /Dans mon ordre/, 'écran « Affichage »');
      await page.clickText('Dans mon ordre');
      await page.waitFor(`!!document.querySelector('input[type=radio][value=mine]')?.checked`, 5_000, '« Dans mon ordre » choisi');
      const g = await page.waitScreen((s) => s.screen === 'home' && Array.isArray(s.order) && (s.order as string[])[0] === 'fav-dl-nord', 20_000, 'accueil des lunettes dans l’ordre choisi (CA-S3.2)', n);
      return { deliver: 'p09', scroll: '.preview-wrap', glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'data', async () => {
      await page.goto(pageUrl(P11(S3), '#/donnees'));
      const t = await waitText(page, /Adresses\s+Disponible\s+Services officiels de Bruxelles, de Flandre et de Wallonie[\s\S]*Version de Quai\s+1\.1\.0/, 'carte « Adresses » et « Version de Quai 1.1.0 » (CA-M7.3)', 15_000);
      check(/Horaires officiels\s+cette nuit, 04:12/.test(t), `date des horaires : ${/Horaires officiels\s+[^\n]+\n?[^\n]*/.exec(t)?.[0]}`);
      return { deliver: 'p10' };
    });
    await phoneStep(page, 'data-one-region-down', async () => {
      await stack.geoScene('down', ['wal']);
      try {
        await waitText(page, /Tester la connexion/, 'bouton « Tester la connexion »');
        await page.clickText('Tester la connexion');
        await waitText(page, /Disponible, sauf en Wallonie/, '« Disponible, sauf en Wallonie » (une Région en panne)', 15_000);
      } finally {
        await stack.geoScene('base');
      }
    });
    await phoneStep(page, 'onboarding', async () => {
      await page.goto(pageUrl({ ...S3, reset: '1' }, '#/'));
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Bienvenue'`, 10_000, 'bienvenue');
      check((await page.text('main')).includes('Quelques réglages, et Quai est prêt.'), 'sous-titre de bienvenue');
      await page.clickText('Continuer');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Tes lieux'`, 5_000, '« Tes lieux »');
      await page.type('#s1-maison', 'rue de fer 25 namur');
      await page.waitFor(`[...document.querySelectorAll('#s1-maison-liste [role=option]')].some((b) => b.innerText.includes('Rue de Fer 25, 5000 Namur'))`, 10_000);
      await page.clickText('Rue de Fer 25, 5000 Namur', '#s1-maison-liste');
      await page.type('#s1-bureau', 'rue neuve 1 bruxelles');
      await page.waitFor(`[...document.querySelectorAll('#s1-bureau-liste [role=option]')].some((b) => b.innerText.includes('Rue Neuve 1, 1000 Bruxelles'))`, 10_000);
      await page.clickText('Rue Neuve 1, 1000 Bruxelles', '#s1-bureau-liste');
      const t = await page.text('main');
      check(t.includes('Facultatif. Avec ces deux adresses, Quai te propose le bon trajet le matin et le soir.') && t.includes('Me proposer le trajet vers le bureau le matin, et vers la maison le soir'), 'textes de « Tes lieux »');
      return { deliver: 'p07' };
    });
    await phoneStep(page, 'onboarding-done', async () => {
      const n = page.screens().length;
      await page.clickText('Terminer');
      await page.waitFor(`document.querySelector('.home-favs')?.innerText.includes('Vers le bureau')`, 10_000, 'accueil avec « Mes favoris »');
      const g = await page.waitScreen((s) => s.screen === 'home' && s.lines[0]?.startsWith('Vers le bureau'), 15_000, 'lunettes : « Vers le bureau » en tête le matin (CA-S1.2)', n);
      await page.goto(pageUrl({ ...S3 }, '#/favoris'));
      await waitText(page, /Ma position → Bureau\s+Trajet porte à porte, proposé le matin\s+Ma position → Maison\s+Trajet porte à porte, proposé le soir/, 'deux trajets favoris (CA-S1.1)');
      return { glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'legacy-place', async () => {
      await page.goto(pageUrl(P10(S1), '#/lieux'));
      await page.waitFor(`(document.querySelector('main')?.innerText.match(/Adresse à vérifier/g) ?? []).length === 2`, 10_000, 'Maison et Bureau « Adresse à vérifier » (CA-M4.10)');
      await page.clickText('Maison');
      await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Vérifier l’adresse')`, 5_000, 'bouton « Vérifier l’adresse »');
      check((await page.text('main')).includes('Texte enregistré avec la version précédente : « Namur ».'), 'ancien texte rappelé');
      return { deliver: 'p11' };
    });
    await phoneStep(page, 'legacy-verify', async () => {
      await page.clickText('Vérifier l’adresse');
      await page.waitFor(`document.querySelector('input[role=combobox]')?.value === 'Namur' && document.querySelectorAll('[role=listbox] [role=option]').length > 0`, 10_000, 'champ prérempli avec l’ancien texte');
    });
  });
}

/* ------------------------------ Réouverture de Quai (Chrome : stockage gardé) ------------------------------ */

async function reopen(): Promise<void> {
  await withChrome(async (page) => {
    await phoneStep(page, 'news-once', async () => {
      await page.goto(pageUrl(P10(S1), '#/'));
      await page.waitScreen((s) => s.screen === 'message' && s.title === 'Quai 1.1', 20_000, 'message « Quai 1.1 »');
      const t = await waitText(page, /Nouveau : tape une adresse, Quai trouve le trajet le plus simple\.\s+OK/, 'bannière du téléphone');
      check(!t.includes('Bienvenue'), 'pas d’écran « Bienvenue » après la mise à jour');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'home', 15_000, 'accueil après « continuer »');
      // Réouverture : même page sans remise à zéro (le stockage local garde les réglages).
      const n = page.screens().length;
      await page.goto(pageUrl({ ...S1 }, '#/'));
      const h = await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil à la réouverture', n);
      check(!page.screens().slice(n).some((s) => s.title === 'Quai 1.1'), '« Quai 1.1 » revenu à la réouverture (CA-S2.2)');
      check(!(await page.text('main')).includes('Nouveau : tape une adresse'), 'bannière revenue à la réouverture');
      return { glasses: h };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'fresh-install', async () => {
      await page.goto(pageUrl({ ...S1, reset: '1' }, '#/'));
      await page.waitScreen((s) => s.screen === 'message' && s.lines[0] === WELCOME[0], 20_000, 'bienvenue');
      await page.clickText('Continuer');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Tes lieux'`, 5_000);
      await page.clickText('Plus tard');
      await page.waitScreen((s) => s.screen === 'home' && s.lines.includes('Ajouter un favori'), 15_000, 'accueil sans favori (CA-S1.3)');
      const n = page.console.length;
      await page.goto(pageUrl({ ...S1 }, '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil à la réouverture');
      const later = page.console.slice(n).filter((l) => l.text.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.text.slice(12)) as GlassesScreen);
      check(!page.screens().some((s) => s.title === 'Quai 1.1'), 'jamais « Quai 1.1 » après une nouvelle installation');
      check(!later.some((s) => s.lines[0] === WELCOME[0]), 'bienvenue pas reprise');
      return { glasses: page.lastScreen() };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'resume', async () => {
      await page.goto(pageUrl({ ...P11(S1), mockSpeed: '20' }, '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true && s.lines.some((l) => /en cours$/.test(l)), 40_000, 'marche en cours (07:35)');
      await page.gesture('double');
      await page.waitScreen((s) => s.screen === 'home' && /^En cours : vers le bureau {3}IC 07:44, voie 6$/.test(s.lines[0] ?? ''), 10_000, '« En cours » sur l’accueil (CA-M6.3)');
      const n = page.screens().length;
      await page.goto(pageUrl({ mockLat: '50.6727', mockLon: '4.5694', mockNow: '2026-11-10T08:05:00+01:00' }, '#/'));
      const g = await page.waitScreen((s) => s.screen === 'train' && s.lines[s.lines.length - 1] === 'Trajet en cours : vers le bureau', 20_000, '« Dans le train » et « Trajet en cours : vers le bureau »', n);
      check(g.title === 'IC vers Bruxelles-Midi, +2 min', `titre « ${g.title} »`);
      await page.waitScreen((s) => s.screen === 'train' && s.lines[s.lines.length - 1] === H.train, 8_000, 'message court (3 s), puis l’aide', n);
      const m = page.screens().length;
      await page.gesture('double');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 8_000, 'étapes du trajet en cours', m);
      await page.gesture('double');
      const h = await page.waitScreen((s) => s.screen === 'home' && /^En cours : vers le bureau {3}descente 08:48$/.test(s.lines[0] ?? ''), 10_000, 'accueil, « En cours » gardée', m);
      return { glasses: h };
    });
    await phoneStep(page, 'after-arrival', async () => {
      const n = page.screens().length;
      await page.goto(pageUrl({ mockLat: '50.8441', mockLon: '4.3474', mockNow: '2026-11-10T09:10:00+01:00' }, '#/'));
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s), 20_000, 'accueil à 09:10', n);
      check(!/^En cours/.test(h.lines[0] ?? ''), `plus de « En cours » après l’arrivée plus 5 min (CA-M6.6) : « ${h.lines[0]} »`);
      return { glasses: h };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'not-left', async () => {
      await page.goto(pageUrl(P11(S1), '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 20_000, 'étapes suivies à 07:31');
      await page.gesture('double');
      await page.waitScreen((s) => s.screen === 'home', 8_000, 'accueil avant le départ');
      const n = page.screens().length;
      await page.goto(pageUrl({ ...S1, mockNow: '2026-11-10T07:50:00+01:00' }, '#/'));
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s), 20_000, 'accueil à 07:50, toujours à la maison', n);
      check(!/^En cours/.test(h.lines[0] ?? ''), `pas de « En cours » : l’IC est parti sans l’utilisateur (CA-M6.4, CA-M6.5) : « ${h.lines[0]} »`);
      return { glasses: h };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'undo-identical', async () => {
      await page.goto(pageUrl(P11(S2), '#/favoris'));
      const before = await page.waitFor<string>(`document.querySelector('main')?.innerText.includes('Gare du Nord') && document.querySelector('main').innerText`, 10_000);
      await page.waitScreen((s) => s.screen === 'board' && /★$/.test(s.title), 20_000, 'départs du favori ouverts seuls');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'board' && s.lines[s.lines.length - 1] === '★ Retiré. Toucher encore : annuler', 5_000, 'retiré');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'board' && s.lines[s.lines.length - 1] === '★ Favori rétabli', 5_000, 'rétabli');
      await page.goto(pageUrl({ ...S2 }, '#/favoris'));
      const after = await page.waitFor<string>(`document.querySelector('main')?.innerText.includes('Gare du Nord') && document.querySelector('main').innerText`, 10_000);
      check(after === before, `liste des favoris identique (place, lignes, réglage) :\n${before}\n≠\n${after}`);
      await page.goto(pageUrl({ ...S2 }, '#/favoris/fav-gdn'));
      await waitText(page, /Modifier le favori[\s\S]*Le proposer à l’ouverture/, 'écran du favori fav-gdn (même identifiant)');
      const state = await page.eval<string>(`[document.querySelector('input[type=search]')?.value, document.querySelectorAll('input[type=checkbox]:checked').length, document.querySelector('input[type=radio][value=near]')?.checked].join('|')`);
      check(state === 'Gare du Nord, tram (STIB)|3|true', `arrêt, 3 lignes cochées, « Quand je suis à moins de 300 m » : ${state}`);
    });
  });
}

/* ------------------------------ Visite : images de app/test/screens (--tour) ------------------------------ */

async function tourPhone(): Promise<void> {
  if (!WITH_TOUR) return;
  const shots: [string, Record<string, string>, string, string][] = [
    ['phone-onboarding.png', { ...S3, reset: '1' }, '#/', 'Premier lancement, étape « Bienvenue »'],
    ['phone-home.png', P11(S3), '#/', 'Accueil du téléphone : « Où vas-tu ? » et « Mes favoris »'],
    ['phone-places.png', P10(S1), '#/lieux', 'Mes lieux (lieux de la 1.0 : « Adresse à vérifier »)'],
    ['phone-favorites.png', P11(S3), '#/favoris', 'Mes favoris'],
    ['phone-favorite-edit.png', P11(S2), '#/favoris/fav-gdn', 'Modifier un arrêt favori'],
    ['phone-display.png', P11(S2), '#/affichage', 'Affichage, avec « Ordre des favoris »'],
    ['phone-alerts.png', P11(S1), '#/alertes', 'Alertes'],
    ['phone-data.png', P11(S2), '#/donnees', 'Données, avec « Version de Quai » et « Adresses »'],
    ['phone-search.png', P11(S3), '#/recherche?q=Gand', 'Recherche « Gand » dans le champ unique'],
    ['phone-search-results.png', P11(S3), '#/recherche?de=sncb:8813003&vers=sncb:8892007', 'Trajets Bruxelles-Central vers Gand-Saint-Pierre'],
  ];
  const { dir } = await buildFixtureData({ date: '2026-11-01' });
  const old = await startDataServer(dir);
  try {
    await withChrome(
      async (page) => {
        for (const [file, params, hash, what, data] of [...shots, ['phone-data-stale.png', P11(S2), '#/donnees', 'Données quand la mise à jour de nuit est en panne', old.url] as const]) {
          await phoneStep(page, file.replace(/\.png$/, ''), async () => {
            await page.goto(pageUrl(params, hash, data ? { data } : undefined));
            await sleep(hash.includes('recherche') ? 3_500 : 2_500);
            await page.addStyle(NO_EMU);
            await page.eval('window.scrollTo(0, 0), true');
            const out = join(TOUR, file);
            await page.screenshot(out);
            toured.push({ file, what });
          });
        }
      },
      { width: 600, height: 800, dpr: 1, mobile: true },
    );
  } finally {
    await old.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------ Lancement ------------------------------ */

const SCENARIOS: [string, string, () => Promise<void>][] = [
  ['s1', 'le matin à Namur : accueil, étapes, pages, suivre un autre trajet, Autres favoris, Aller à…, sortie', s1],
  ['s1noRT', 'le matin, temps réel indisponible : ligne du haut, raison, « Le suivant »', s1noRT],
  ['s1run', 'trajet suivi en accéléré : en cours, dans le train, descente, fin', s1run],
  ['s1stay', 'l’IC part sans l’utilisateur : le trajet en cours prend fin', s1stay],
  ['s2', 'gare du Nord : départs du favori, retrait annulable, accueil, Autres favoris, panne du temps réel', s2],
  ['s3', 'l’après-midi vers Gand : réponse, étapes, étiquettes, détail du train', s3],
  ['s3run', 'vers Gand en accéléré : dans le train, aide à l’arrivée', s3run],
  ['waterloo', 'Waterloo vers la rue du Progrès : le plus simple, le plus rapide, le suivant', waterloo],
  ['news', 'mise à jour depuis la 1.0 : message « Quai 1.1 », favoris gardés', news],
  ['firstrun', 'premier lancement : bienvenue, accueil sans favori, liste vide, sortie', firstrun],
  ['errors', 'horaires injoignables puis nouvel essai, relais muet, aucun arrêt', errors],
  ['stale', 'horaires périmés', stale],
  ['late', '23:30 : départs de demain', late],
  ['phone', 'téléphone (Chrome) : accueil, champ unique, cartes, « Lunettes », lieux, favoris, données, premier lancement', phone],
  ['reopen', 'réouverture de Quai (Chrome) : « Quai 1.1 » une fois, trajet repris, fin du trajet, retrait annulé à l’identique', reopen],
  ['tour', 'images du téléphone pour app/test/screens (--tour)', tourPhone],
];

async function main(): Promise<void> {
  if (process.env.QUAI_SKIP_SIM === '1') {
    console.log('Simulateur ignoré (QUAI_SKIP_SIM=1).');
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(SHOTS)) if (f.endsWith('-ECHEC.png')) rmSync(join(SHOTS, f));
  const tmp = mkdtempSync(join(tmpdir(), 'quai-sim-'));
  const dist = join(tmp, 'dist');
  console.log('Construction de l’appli (vite build)…');
  const b = await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: APP });
  if (b.code !== 0) throw new Error(`vite build en échec\n${b.stdout}\n${b.stderr}`);
  stack = await startStack();
  // Données de la nuit : mêmes fichiers, publiés le 10/11 à 04:12 (heure du jeu de test, écran « Données »). La
  // génération est réécrite partout où elle figure (meta.json, lines/index.json…) : le cœur n'utilise les fichiers
  // de ligne que s'ils sont de la même génération que meta.json.
  const nightDir = join(tmp, 'data');
  cpSync(stack.dataDir, nightDir, { recursive: true });
  const gen = (JSON.parse(readFileSync(join(nightDir, 'meta.json'), 'utf8')) as { generatedAt: string }).generatedAt;
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const f of walk(nightDir)) {
    const text = readFileSync(f, 'utf8');
    if (text.includes(gen)) writeFileSync(f, text.split(gen).join('2026-11-10T03:12:00.000Z'));
  }
  night = await startDataServer(nightDir);
  // Réglages de test : 1.0, 1.1, 1.1 avec adresses récentes (S4), téléphone (un lieu au nom de ville).
  const p11 = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', 'preset-1.1.json'), 'utf8')) as Record<string, unknown>;
  const recent = [
    { label: 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', lat: 50.8582, lon: 4.36, at: Date.parse('2026-11-09T18:20:00+01:00') },
    { label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: Date.parse('2026-11-08T10:05:00+01:00') },
    { label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, at: Date.parse('2026-11-07T16:40:00+01:00') },
  ];
  const presets = join(tmp, 'p');
  mkdirSync(presets);
  writeFileSync(join(presets, 'recent.json'), JSON.stringify({ ...p11, recent }));
  writeFileSync(
    join(presets, 'phone.json'),
    JSON.stringify({
      ...p11,
      places: [...(p11.places as object[]), { id: 'lieu-piscine', label: 'Piscine de Bruxelles', lat: 50.852, lon: 4.3555, address: 'Rue Neuve, 1000 Bruxelles', src: 'address', approx: true }],
      recent: [{ label: 'Boulevard du Centenaire 1, 1020 Bruxelles', lat: 50.8915, lon: 4.334, at: Date.parse('2026-11-09T18:20:00+01:00') }],
    }),
  );
  web = await startStatic(dist, {
    '/preset.json': join(ROOT, 'fixtures', 'app', 'preset.json'),
    '/preset-1.1.json': join(ROOT, 'fixtures', 'app', 'preset-1.1.json'),
    '/p/recent.json': join(presets, 'recent.json'),
    '/p/phone.json': join(presets, 'phone.json'),
  });
  sim = new Sim(PORT, SHOTS);
  console.log(`Données ${night.url} ; relais ${stack.relay.url} ; adresses ${stack.geo.url} ; appli ${web.url} ; simulateur :${PORT}`);
  const t0 = Date.now();
  try {
    for (const [id, label, fn] of SCENARIOS) await runScenario(id, label, fn);
  } finally {
    await sim.stop();
    await web.close();
    writeFileSync(join(OUT, 'sim-servers.log'), stack.logs());
    await night.stop();
    await stack.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
  if (DELIVER && Object.keys(delivered).length) {
    const manifest = Object.fromEntries(Object.entries(DELIVERABLES).filter(([id]) => delivered[id]).map(([, d]) => [d.file, d.caption]));
    const path = join(DELIVER, 'manifest.json');
    const prev = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {};
    writeFileSync(path, JSON.stringify({ ...prev, ...manifest }, null, 2) + '\n');
  }
  if (WITH_TOUR && toured.length) {
    const path = join(TOUR, 'tour.json');
    const prev = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { screens?: { file: string; what: string }[] }) : {};
    const byFile = new Map((prev.screens ?? []).filter((x) => typeof x === 'object' && 'file' in x).map((x) => [x.file, x]));
    for (const t of toured) byFile.set(t.file, t);
    writeFileSync(path, JSON.stringify({ version: '1.1.0', how: 'tests/e2e : npm run sim -- --tour (vrai cœur, données des fixtures)', screens: [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, 'sim-report.json'), JSON.stringify({ when: new Date().toISOString(), ms: Date.now() - t0, results, notes }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} étapes réussies en ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const n of notes) console.log(`  note : ${n}`);
  for (const f of failed) console.log(`  ✗ ${f.scenario}-${f.step} : ${f.error}`);
  process.exitCode = failed.length ? 1 : 0;
}

process.on('SIGINT', () => {
  void sim?.stop().finally(() => process.exit(130));
});
await main();
