/**
 * Quai 1.2, contrôle qualité : bout en bout avec le VRAI cœur, les vraies données (pipeline sur les zips de fixtures),
 * le vrai relais (faux portail BMC, faux service d'adresses des trois Régions) et l'appli construite :
 *   - lunettes dans le simulateur Even Hub 0.9.5 (sans affichage, xvfb) : gestes, journal QUAI_SCREEN, captures
 *     576 × 288 contrôlées au pixel (CA-M1.7) ;
 *   - téléphone dans Chrome sans affichage (protocole DevTools, sim/cdp.ts) : « Mes favoris » (lieux, arrêts, trajets
 *     fixes), « Nouveau favori », champ unique, cartes, « Lunettes », « Garder en favori », données, premier lancement,
 *     et réouverture de Quai (le simulateur 0.9.5 ne garde pas setLocalStorage d'un lancement à l'autre ; Chrome garde
 *     le stockage local d'un chargement à l'autre) ;
 *   - Quai Web (build web) dans Chrome : rubrique « Position » avec une adresse (PRD-1.2 § 3).
 *
 *   cd tests/e2e && npm run sim                    (tout, environ 13 min)
 *   npm run sim -- --only s1,s2                    (scénarios choisis, liste dans SCENARIOS en bas du fichier)
 *   npm run sim -- --deliver /home/claude/quai-1.2-shots   (captures pour le propriétaire + manifest.json)
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
/** Scénario 4 : « Chaussée de Bruxelles 1, 1410 Waterloo » à 07:31 (fixtures/README.md, Extension 1.1 ; PRD-1.2 CA-1.5). */
const WAT = { mockLat: '50.7175', mockLon: '4.399', mockNow: '2026-11-10T07:31:00+01:00' };
/** De la maison au bureau : à pied jusqu'à la gare de Namur, IC, Bruxelles-Central, à pied (minutes après 07:31). */
const PATH_S1 = '6:50.4677,4.8617;12:50.4685,4.8625;20:50.53,4.7;34:50.6727,4.5694;70:50.8603,4.362;77:50.8454,4.3571;85:50.8445,4.35;89:50.8441,4.3474';
/**
 * De Bruxelles-Central à Gand-Saint-Pierre (minutes après 14:05). Le point de départ est la gare elle-même : la
 * position la quitte dès 14:09, sinon une position prise juste après le départ de 14:10, encore à moins de 300 m,
 * mettrait fin au trajet (« pas parti », PRD M6.3).
 */
const PATH_S3 = '4:50.849,4.362;10:50.86,4.2;20:50.95,3.95;30:51.03,3.72;34:51.0359,3.7107';

/** Aides de gestes exactes (PRD 1.1 § 6.1, liste S2 ; inchangées en 1.2) : l'oracle, indépendant du code. */
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
/** Message « Quai 1.2 » (PRD-1.2 § 2.3) et bannière du téléphone (§ 2.2). */
const NEWS = ['Nouveau : le trajet le plus court d’abord.', 'Tes lieux sont maintenant dans tes favoris.', 'Sur un trajet, ▼ : un autre trajet.'];
const BANNER = 'Nouveau : le trajet le plus court d’abord, et tes lieux sont dans tes favoris.';
const WELCOME = ['Bienvenue dans Quai !', 'Termine les réglages sur le téléphone :', 'appli Even Realities, onglet Even Hub, Quai.', 'Position, langue et tes lieux, en une minute.'];
const RT_DOWN = 'Temps réel indisponible : horaires prévus ~';
const PLANNED = '~ horaire prévu, sans temps réel';
const FAVS_LEAD = 'Tes lieux, tes arrêts et tes trajets. En tête dans les lunettes selon l’heure et le lieu (réglage Affichage).';
const MAX_WALK_SUB = 'Au-delà de 5 min de plus, seulement pour arriver au moins 10 min plus tôt';

/* ------------------------------ Captures pour le propriétaire (--deliver) ------------------------------ */

const DELIVERABLES: Record<string, { file: string; caption: string }> = {
  g01: { file: 'g01-lunettes-accueil-vers-le-bureau.png', caption: 'Lunettes, accueil à 07:31 à la maison (Namur) : le lieu « Vers le bureau » en tête avec sa réponse (partir dans 4 min, IC à 07:42 voie 6, arrivée 09:00).' },
  g02: { file: 'g02-lunettes-etapes-le-plus-court.png', caption: 'Lunettes, Maison vers Bureau sans temps réel : « Le plus court : direct, à pied 7 + 12 min », et en bas la proposition suivante « ▼ Le suivant : 08:33 → 09:58 ».' },
  g03: { file: 'g03-lunettes-waterloo-le-plus-court.png', caption: 'Lunettes, Waterloo vers la rue du Progrès : « Le plus court » (19 min à pied puis le S1, arrivée 08:30), et en bas la 2e proposition « ▼ Moins de marche : 07:32 → 08:46 ».' },
  g04: { file: 'g04-lunettes-waterloo-moins-de-marche.png', caption: 'Lunettes, même recherche après ▼ : 2e proposition « Moins de marche : 1 changement, à pied 2 + 2 + 3 min » (bus W puis métro 2), toucher pour la suivre.' },
  g05: { file: 'g05-lunettes-aller-a-lieux.png', caption: 'Lunettes, « Aller à… » : les lieux d’abord (Bureau, arrivée 09:00 ; Maison, ici), puis les adresses récentes, puis « Autre adresse ».' },
  g06: { file: 'g06-lunettes-message-quai-1-2.png', caption: 'Lunettes, message « Quai 1.2 », montré une seule fois à la première ouverture après la mise à jour depuis la 1.0 ou la 1.1.' },
  p01: { file: 'p01-telephone-mes-favoris.png', caption: 'Téléphone, « Mes favoris » : une seule liste avec les lieux (adresse, accès, créneau), les arrêts et le trajet fixe.' },
  p02: { file: 'p02-telephone-nouveau-favori.png', caption: 'Téléphone, « Nouveau favori » : champ unique « Adresse, gare ou arrêt » avec « Ma position actuelle » en tête, puis les adresses récentes.' },
  p03: { file: 'p03-telephone-gare-departs-ou-trajet.png', caption: 'Téléphone, « Nouveau favori » après le choix de la gare de Namur : « Ses prochains départs » (un arrêt) ou « Le trajet pour y aller » (un lieu).' },
  p04: { file: 'p04-telephone-cartes-le-plus-court.png', caption: 'Téléphone, Waterloo vers la rue du Progrès : « Le plus court » (arrive le plus tôt), puis « Moins de marche » (17 min de marche en moins, mais arrive 16 min plus tard).' },
  p05: { file: 'p05-telephone-marche-maximale.png', caption: 'Téléphone, bas de « Mes favoris » : réglage « Marche maximale » et son sous-titre, puis les adresses récentes.' },
  p06: { file: 'p06-telephone-premier-lancement-tes-favoris.png', caption: 'Téléphone, premier lancement, étape « Tes favoris » : les adresses de la maison et du bureau deviennent les deux premiers favoris.' },
  w01: { file: 'w01-quai-web-position-adresse.png', caption: 'Quai Web, rubrique « Position » : position du navigateur refusée, adresse choisie dans le champ unique (« Position choisie : Rue du Progrès 20. Gardée dans ce navigateur. ») ; au-dessus, « Autour de moi » centré sur cette adresse.' },
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
/** Ligne du bas (au-dessus de l'aide) d'un écran d'étapes. */
const bottom = (s: { lines: string[] }) => s.lines[s.lines.length - 2];
/** Espaces insécables (typographie française du téléphone) remplacées par des espaces, pour comparer. */
const nbn = (t: string | undefined) => (t ?? '').replace(/[  ]/g, ' ');
/** Même chose dans une expression évaluée dans la page. */
const N = (expr: string) => `((${expr}) ?? '').replace(/[\\u00a0\\u202f]/g, ' ')`;
const field = <T>(s: Screen, k: string) => (s as unknown as Record<string, T>)[k];
const clockAtLeast = (hhmm: string) => (s: Screen) => (s.clock ?? '') >= hhmm;
const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

let stack: Stack;
let night: Proc;
let web: { url: string; close(): Promise<void> };
let webApp: { url: string; close(): Promise<void> };
let sim: Sim;

/** Adresse de la page (paramètres du mode test, SPEC § 5.3). */
function pageUrl(params: Record<string, string | undefined>, hash = '', bases?: { data?: string; relay?: string; app?: string }): string {
  const u = new URL(`${bases?.app ?? web.url}/index.html`);
  u.searchParams.set('e2e', '1');
  u.searchParams.set('data', bases?.data ?? night.url);
  u.searchParams.set('relay', bases?.relay ?? stack.relay.url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString() + hash;
}
const preset = (file: string) => (p: Record<string, string>) => ({ ...p, reset: '1', preset: `${web.url}/${file}` });
/** Réglages 1.1 tels quels (fixtures/app/preset-1.1.json, seenVersion 1.1.0) : migrés, « Quai 1.2 » une fois. */
const P11 = preset('preset-1.1.json');
/** Réglages de la 1.0 (fixtures/app/preset.json) : migrés au lancement, « Quai 1.2 » une fois. */
const P10 = preset('preset.json');
/**
 * Utilisateur de la 1.2 : les réglages de la 1.1 avec les nouveautés déjà vues (seenVersion 1.2.0). Migrés au
 * lancement comme ceux d'un utilisateur réel (même résultat que des réglages v3 enregistrés par la 1.2).
 */
const P12 = preset('p/1.2.json');
/** P12 avec trois adresses récentes (S4). */
const PREC = preset('p/recent.json');
/** P12 avec un lieu au nom de ville et une adresse récente (champ unique). */
const PPHONE = preset('p/phone.json');
/** Configuration faite, aucun favori (CA-2.3 à CA-2.5, Quai Web). */
const PEMPTY = preset('p/empty.json');
/** P12 avec des lieux à adresse vérifiée et deux adresses récentes (captures de « Mes favoris »). */
const PNICE = preset('p/nice.json');

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

/** Contrôles communs d'un écran : aide exacte, aucune ligne coupée par « … » (CA-M1.7), pas de tiret long. */
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
    check(!sim.screens.some((x) => x.title === 'Quai 1.2'), 'pas de « Quai 1.2 » pour qui l’a déjà vu');
    check(/^Vers le bureau {3}partir dans [34] min$/.test(s.lines[0] ?? ''), `1er favori « ${s.lines[0]} »`);
    check(s.lines[1] === 'IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00', `2e ligne « ${s.lines[1]} »`);
    check(s.lines[2] === 'Namur, train   IC 07:42 +2 v.6 !', `2e favori « ${s.lines[2]} »`);
    check(s.lines[3] === 'vers Bruxelles-Midi, puis ~08:42', `2e ligne du 2e favori « ${s.lines[3]} »`);
    check(s.lines[4] === 'Autour de moi   3 arrêts' && s.lines[5] === 'Autres favoris   4' && s.lines[6] === 'Aller à…', `menu ${JSON.stringify(s.lines.slice(4, 7))}`);
    check(s.lines[7] === PLANNED, `note « ${s.lines[7]} »`);
    check(!has(s, /^Près de/), 'pas de ligne « Près de » quand des favoris sont en tête');
    const order = field<string[]>(s, 'order') ?? [];
    check(order[0] === 'fav-bureau' && order[1] === 'fav-namur' && order.length === 6, `order ${JSON.stringify(order)} (CA-2.2 : le lieu fav-bureau en tête)`);
    check(s.title === 'Quai' && s.clock === '07:31', `titre et heure « ${s.title} » ${s.clock}`);
    common(s, H.home);
    return { screen: s, deliver: 'g01', tour: ['glasses-home.png', 'Accueil, 07:31 à la maison : le lieu « Vers le bureau » et la gare de Namur en tête'] };
  });
  await step('steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes, page 1');
    check(s.title === 'Vers le bureau : 07:35 → 09:00', `titre « ${s.title} »`);
    check(field(s, 'pages') === 2 && field(s, 'label') === 'short' && field(s, 'followed') === true, `page ${field(s, 'page')}/${field(s, 'pages')} ${field(s, 'label')} suivi ${field(s, 'followed')}`);
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte en tête « ${s.lines[0]} »`);
    check(/^07:35 {3}Partir à pied vers la gare \(7 min\) {3}dans [34] min$/.test(s.lines[1] ?? ''), `1re étape « ${s.lines[1]} »`);
    check(s.lines[2] === '07:42   IC vers Bruxelles-Midi, voie 6   +2 min', `2e étape « ${s.lines[2]} »`);
    check(s.lines[3] === '08:48   Descendre à Bruxelles-Central' && s.lines[4] === '09:00   Arrivée au bureau (12 min à pied)', `fin ${JSON.stringify(s.lines.slice(3, 5))}`);
    check(s.lines[5] === '▼ Le suivant : 08:33 → 09:58', `ligne du bas « ${s.lines[5]} »`);
    check(s.sel === 0, `repère ▶ sur la 1re étape (sel ${s.sel})`);
    common(s, H.steps);
    return { screen: s, tour: ['glasses-steps.png', 'Trajet proposé Maison vers Bureau, page 1 « Le plus court », trajet suivi (alerte de voie en tête)'] };
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
    check(bottom(s) === '▲ trajet précédent', `ligne du bas « ${bottom(s)} »`);
    check(s.sel === -1, 'pas de repère ▶ sur un trajet non suivi');
    common(s, H.stepsOther);
    return { screen: s, tour: ['glasses-journeys.png', 'Autre trajet (▼) : page 2 « Le suivant », non suivi (remplace la liste des propositions de la 1.0)'] };
  });
  await step('last-page', async () => {
    await sim.input('down');
    const s = await sim.waitScreen(is('steps', (x) => hint(x) === 'Pas d’autre trajet pour l’instant'), 8_000, '« Pas d’autre trajet pour l’instant »');
    check(field(s, 'page') === 2 && bottom(s) === '▲ trajet précédent', 'reste sur la dernière page, « ▲ trajet précédent »');
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
    check(order[order.length - 1] === 'fav-maison', `le lieu « Maison » (tu y es) en fin de liste : ${JSON.stringify(order)}`);
    const items = s.lines.slice(0, -2);
    check(items.length <= 7 && items.filter((l) => /^(Vers |Gare |Bruxelles|Namur)/.test(l)).length >= 3, `au moins 3 favoris visibles, 7 lignes au plus : ${JSON.stringify(items)}`);
    common(s, H.favorites);
    return { screen: s };
  });
  await step('places', async () => {
    await back(homeReady, 'retour à l’accueil');
    await sim.select(4);
    await sim.input('click');
    const s = await sim.waitScreen(is('places', (x) => loaded(x) && x.lines.length >= 7), 25_000, 'Aller à… chargé');
    // PRD-1.2 § 2.3, CA-2.2 : les lieux d'abord, dans l'ordre de « Mes favoris » (Bureau, puis Maison)
    check(s.lines[0] === 'Bureau   arrivée 09:00', `« ${s.lines[0]} »`);
    check(s.lines[1] === 'Maison   ici', `« ${s.lines[1]} »`);
    // Rue Neuve 1 : « Le plus court » par Bruxelles-Nord et le T3 (CA-1.4), 08:51 et non plus 08:58 (direct, 1.1)
    check(sameList(s.lines.slice(2, 5), ['Rue du Progrès 20   arrivée 08:47', 'Veldstraat 1   arrivée 09:45', 'Rue Neuve 1   arrivée 08:51']), `adresses récentes ${JSON.stringify(s.lines.slice(2, 5))}`);
    check(s.lines[5] === 'Autre adresse   sur le téléphone', `« ${s.lines[5]} »`);
    common(s, H.places);
    return { screen: s, deliver: 'g05', tour: ['glasses-places.png', 'Aller à… : les lieux, puis les adresses récentes, avec l’heure d’arrivée'] };
  });
  await step('place-steps', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 20_000, 'étapes vers le bureau');
    check(s.title === 'Vers le bureau : 07:35 → 09:00' && field(s, 'label') === 'short' && field(s, 'followed') === true, `« ${s.title} » ${field(s, 'label')}`);
    await back(is('places'), 'retour à Aller à…');
    await sim.select(1);
    await sim.input('click');
    const m = await sim.waitScreen(is('message', (x) => x.title === 'Vers la maison'), 8_000, '« Tu es déjà à la maison. »');
    check(m.lines[0] === 'Tu es déjà à la maison.', `« ${m.lines[0]} »`);
    common(m, H.message);
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

/* ------------------------------ Scénario 1 sans temps réel (scène noRT, CA-1.3) ------------------------------ */

async function s1noRT(): Promise<void> {
  await stack.scene('noRT');
  try {
    await sim.launch(pageUrl(P12(S1)));
    await step('home', async () => {
      const s = await sim.waitScreen(is('home', (x) => loaded(x) && x.lines[0] === RT_DOWN), 25_000, 'accueil, temps réel indisponible');
      check(/^Vers le bureau {3}partir dans [12] min$/.test(s.lines[1] ?? ''), `1er favori « ${s.lines[1]} »`);
      check(s.lines[2] === 'IC à ~07:42, voie 4, direct, arrivée 08:58', `2e ligne « ${s.lines[2]} »`);
      check(s.lines[3] === 'Namur, train   IC ~07:42 v.4' && s.lines[4] === 'vers Bruxelles-Midi, puis ~08:42', `2e favori ${JSON.stringify(s.lines.slice(3, 5))}`);
      check(s.lines[5] === 'Autour de moi   3 arrêts' && s.lines[6] === 'Autres favoris   4', `menu ${JSON.stringify(s.lines.slice(5, 7))}`);
      check(s.lines[7] === PLANNED, `note « ${s.lines[7]} »`);
      common(s, H.home);
      return { screen: s };
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
      check(field(s, 'label') === 'short' && field(s, 'pages') === 2, `étiquette ${field(s, 'label')}, ${field(s, 'pages')} pages`);
      check(s.lines[0] === 'Le plus court : direct, à pied 7 + 12 min', `raison « ${s.lines[0]} » (CA-1.3)`);
      check(has(s, /^~07:42 {3}IC vers Bruxelles-Midi, voie 4$/), 'IC ~07:42 voie 4');
      check(bottom(s) === '▼ Le suivant : 08:33 → 09:58', `ligne du bas « ${bottom(s)} »`);
      common(s, H.steps);
      return { screen: s, deliver: 'g02' };
    });
    await step('next', async () => {
      await sim.input('down');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
      check(field(s, 'label') === 'next' && field(s, 'followed') === false, `page 2 ${field(s, 'label')}`);
      check(s.lines[0] === 'Le suivant : même trajet, 1 h plus tard', `raison « ${s.lines[0]} »`);
      check(has(s, /^~08:42 {3}IC vers Bruxelles-Midi, voie 5$/) && s.sel === -1, 'IC ~08:42, pas de repère');
      check(bottom(s) === '▲ trajet précédent', `ligne du bas « ${bottom(s)} »`);
      common(s, H.stepsOther);
      return { screen: s };
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
  await sim.launch(pageUrl({ ...P12(S1), mockSpeed: '30', mockPath: PATH_S1 }));
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
    return { screen: s };
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
    return { screen: s, tour: ['glasses-train.png', 'Dans le train à 08:05, ouvert seul au départ de l’IC suivi'] };
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
  await sim.launch(pageUrl({ ...P12(S1), mockSpeed: '30' }));
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
  await sim.launch(pageUrl(P12(S2)));
  await step('board-favorite', async () => {
    const s = await sim.waitScreen(is('board', loaded), 20_000, 'départs du favori ouverts seuls');
    check(s.title === 'Gare du Nord, tram (STIB) ★', `titre « ${s.title} »`);
    const want = [/^T3 {3}Churchill {3}[12] min$/, /^T4 {3}Stalle {3}[45] min$/, /^T3 {3}Esplanade {3}[56] min$/, /^T3 {3}Churchill {3}(9|10) min$/, /^T4 {3}Stalle {3}1[23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `départ ${i + 1} « ${s.lines[i]} »`));
    check(!has(s, /~/), 'tout en temps réel');
    common(s, H.boardFav);
    return { screen: s, tour: ['glasses-board.png', 'Départs d’un arrêt favori (★), ouverts seuls à moins de 300 m'] };
  });
  await step('remove-undo', async () => {
    await sim.input('down');
    await sim.input('up');
    check(sim.last?.sel === -1, 'départs sans curseur (▲▼ font défiler)');
    await sim.input('click', 300);
    const off = await sim.waitScreen(is('board', (x) => hint(x) === '★ Retiré. Toucher encore : annuler'), 6_000, '« ★ Retiré. Toucher encore : annuler »');
    check(off.title === 'Gare du Nord, tram (STIB)', `titre sans ★ « ${off.title} »`);
    await sim.input('click', 300);
    const on = await sim.waitScreen(is('board', (x) => hint(x) === '★ Favori rétabli'), 4_000, '« ★ Favori rétabli » (moins de 5 s)');
    check(on.title === 'Gare du Nord, tram (STIB) ★', `★ revenu, même filtre de lignes : « ${on.title} »`);
    const again = await sim.waitScreen(is('board', (x) => hint(x) === H.boardFav), 6_000, 'aide « ★ retirer » revenue');
    return { screen: again, shot: false };
  });
  await step('home', async () => {
    const s = await back(is('home', loaded), 'accueil');
    const order = field<string[]>(s, 'order') ?? [];
    check(order[0] === 'fav-gdn' && order[1] === 'fav-dl-nord' && order.length === 6, `order ${JSON.stringify(order)} (fav-gdn rétabli, tout près)`);
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
    check(sameList(order, ['fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']), `order ${JSON.stringify(order)} (CA-M1.3, les lieux comme les trajets depuis ma position)`);
    check(/^Vers le bureau {3}/.test(s.lines[0] ?? ''), `le lieu « Vers le bureau » en tête : « ${s.lines[0]} »`);
    check(s.lines[2] === 'Vers Gand-Saint-Pierre   départ 14:10' && s.lines[3] === 'IC voie 4 à Bruxelles-Central, arrivée 14:39', `Gand ${JSON.stringify(s.lines.slice(2, 4))}`);
    common(s, H.favorites);
    return { screen: s, tour: ['glasses-favorites.png', 'Autres favoris à 12:10 près de la gare du Nord : lieux, trajet fixe et gare, avec leur réponse'] };
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
  await sim.launch(pageUrl(P12(S3)));
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
    check(s.lines[0] === 'Le plus court : direct', `raison « ${s.lines[0]} » (CA-1.6)`);
    check(/^14:10 {3}IC vers Bruges, voie 4 {3}dans 1[45] min$/.test(s.lines[1] ?? '') && s.lines[2] === '14:39   Arrivée à Gand-Saint-Pierre', `étapes ${JSON.stringify(s.lines.slice(1, 3))}`);
    check(s.lines[3] === '▼ Le suivant : 14:25 → 14:56' && field(s, 'pages') === 3, `ligne du bas « ${s.lines[3]} », ${field(s, 'pages')} pages`);
    common(s, H.steps);
    return { screen: s, tour: ['glasses-trip.png', 'Vers Gand-Saint-Pierre, trajet fixe de gare à gare : « Le plus court : direct », puis « ▼ Le suivant »'] };
  });
  await step('labels', async () => {
    const labels = [field<string>(sim.last!, 'label')];
    for (let i = 2; i <= 3; i++) {
      await sim.input('down');
      const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === i), 8_000, `page ${i}`);
      labels.push(field<string>(s, 'label'));
    }
    check(sameList(labels, ['short', 'next', 'next']), `étiquettes ${JSON.stringify(labels)} (CA-M3.3, CA-1.6)`);
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

/**
 * Scénario 3 en accéléré : dans le train à 14:10, aide à l'arrivée 3 min avant Gand-Saint-Pierre (CA-M2.5) ;
 * « ★ garder ce trajet » sur un trajet venu d'un favori : déjà gardé (PRD-1.2 § 2.3).
 */
async function s3run(): Promise<void> {
  await sim.launch(pageUrl({ ...P12({ ...S3, mockNow: '2026-11-10T14:05:00+01:00' }), mockSpeed: '20', mockPath: PATH_S3 }));
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
  await step('keep-already', async () => {
    // Horloge accélérée (×20) : le message ne reste que 130 ms ; on le cherche dans tout le journal depuis le toucher.
    await sim.drain();
    const mark = sim.screens.length;
    await sim.input('click', 300);
    let s: Screen | undefined;
    for (const t0 = Date.now(); !s && Date.now() - t0 < 5_000; await sleep(100)) {
      await sim.drain();
      s = sim.screens.slice(mark).find((x) => x.screen === 'arrival' && hint(x) === '★ Déjà dans les favoris');
    }
    check(s, `« ★ Déjà dans les favoris » (trajet suivi depuis le favori « Vers Gand-Saint-Pierre ») : ${JSON.stringify(sim.screens.slice(mark).map(hint))}`);
    let h: Screen | undefined;
    for (let i = 0; i < 4 && !h; i++) {
      await sleep(i ? 0 : 2_800);
      await sim.input('double_click');
      await sleep(600);
      await sim.drain();
      if (sim.last?.screen === 'home') h = sim.last;
    }
    check(h, 'retour à l’accueil par double toucher');
    const home = await sim.waitScreen(homeReady, 15_000, 'accueil chargé');
    check((field<string[]>(home, 'order') ?? []).length === 6, `aucun favori ajouté : ${JSON.stringify(field(home, 'order'))}`);
    return { screen: s, shot: false };
  });
}

/* ------------------------------ Scénario 4 : Waterloo, trois trajets (CA-1.5) ------------------------------ */

async function waterloo(): Promise<void> {
  await sim.launch(pageUrl(PREC(WAT)));
  await step('places', async () => {
    await sim.waitScreen(is('home'), 20_000, 'accueil');
    await sim.select(4);
    await sim.input('click');
    const s = await sim.waitScreen(is('places', (x) => loaded(x) && x.lines.some((l) => /^Rue du Progrès 20 {3}arrivée /.test(l))), 25_000, 'Aller à…');
    check(s.lines[2] === 'Rue du Progrès 20   arrivée 08:30', `« ${s.lines[2]} » (le plus court arrive à 08:30)`);
    return { screen: s };
  });
  await step('short', async () => {
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 1 && loaded(x)), 25_000, 'étapes, page 1');
    check(field(s, 'label') === 'short' && field(s, 'pages') === 3 && field(s, 'followed') === true, `page 1 ${field(s, 'label')} / ${field(s, 'pages')}`);
    check(s.title === 'Vers Rue du Progrès 20 : 07:34 → 08:30', `titre « ${s.title} »`);
    check(s.lines[0] === 'Le plus court : direct, à pied 19 + 5 min', `raison « ${s.lines[0]} » (CA-1.5)`);
    check(has(s, /^07:34 {3}Partir à pied vers la gare \(19 min\) {3}dans [23] min$/) && has(s, /^~07:55 {3}S1 vers Bruxelles-Nord, voie 1$/), `marche puis S1 ${JSON.stringify(s.lines)}`);
    check(has(s, /^08:30 {3}Arrivée à Rue du Progrès 20 \(5 min à pied\)$/), 'arrivée 08:30, 5 min à pied');
    check(bottom(s) === '▼ Moins de marche : 07:32 → 08:46', `ligne du bas « ${bottom(s)} » (la 2e proposition, sans geste)`);
    common(s, H.steps);
    return { screen: s, deliver: 'g03' };
  });
  await step('lesswalk', async () => {
    await sim.input('down');
    const s = await sim.waitScreen(is('steps', (x) => field(x, 'page') === 2), 8_000, 'page 2');
    check(field(s, 'label') === 'lesswalk' && field(s, 'followed') === false, `page 2 ${field(s, 'label')}`);
    check(s.title === 'Vers Rue du Progrès 20 : 07:32 → 08:46', `titre « ${s.title} »`);
    check(s.lines[0] === 'Moins de marche : 1 changement, à pied 2 + 2 + 3 min', `raison « ${s.lines[0]} » (CA-1.5)`);
    check(has(s, /^~07:36 {3}W vers Bruxelles Midi$/) && has(s, /^~08:29 {3}M2 vers Simonis \(Elisabeth\)$/), `bus W puis métro M2 ${JSON.stringify(s.lines)}`);
    common(s, H.stepsOther);
    return { screen: s, deliver: 'g04' };
  });
  await step('third', async () => {
    let s: Screen | undefined;
    let p2End = '';
    for (let i = 0; i < 3 && !s; i++) {
      await sim.input('down');
      const x = await sim.waitScreen(is('steps'), 8_000, 'page suivante');
      if (field(x, 'page') === 3) s = x;
      else p2End = bottom(x);
    }
    check(s, 'page 3 atteinte par ▼');
    check(!p2End || p2End === '▼ Le suivant : 08:04 → 09:00', `fin de la page 2 « ${p2End} »`);
    check(field(s, 'label') === 'next' && s.title === 'Vers Rue du Progrès 20 : 08:04 → 09:00', `page 3 ${field(s, 'label')} « ${s.title} »`);
    check(/^Le suivant : même trajet, \d+ min plus tard$/.test(s.lines[0] ?? ''), `raison « ${s.lines[0]} »`);
    let p1: Screen | undefined;
    for (let i = 0; i < 4 && !p1; i++) {
      await sim.input('up');
      const x = await sim.waitScreen(is('steps'), 8_000, 'page précédente');
      if (field(x, 'page') === 1) p1 = x;
    }
    check(p1 && bottom(p1) === '▼ Moins de marche : 07:32 → 08:46', 'retour à la page 1 par ▲');
    return { screen: p1 };
  });
}

/* ------------------------------ Mise à jour depuis la 1.0 et la 1.1, premier lancement ------------------------------ */

async function news(): Promise<void> {
  const from = async (label: string, P: typeof P10, ids: string[], withDeliver: boolean) => {
    await sim.launch(pageUrl(P(S1)));
    await step(`message-${label}`, async () => {
      const s = await sim.waitScreen(is('message', (x) => x.title === 'Quai 1.2'), 20_000, 'message « Quai 1.2 »');
      check(sameList(s.lines.slice(0, -1), NEWS), `texte ${JSON.stringify(s.lines)}`);
      common(s, H.news);
      return { screen: s, pixels: false, ...(withDeliver ? { deliver: 'g06' as const } : {}) };
    });
    await step(`home-${label}`, async () => {
      await sim.input('click');
      const s = await sim.waitScreen(homeReady, 20_000, 'accueil');
      const order = field<string[]>(s, 'order') ?? [];
      check(sameList([...order].sort(), ids), `favoris migrés sans perte ni doublon : ${JSON.stringify(order)} (CA-2.1)`);
      check(order[0] === 'fav-bureau' && s.lines.includes('Autres favoris   4'), `ordre ${JSON.stringify(order)}`);
      common(s, H.home);
      return { screen: s };
    });
    await step(`places-${label}`, async () => {
      await sim.select(4);
      await sim.input('click');
      const p = await sim.waitScreen(is('places', (x) => loaded(x) && x.lines.length >= 4), 25_000, 'Aller à…');
      check(p.lines[0] === 'Bureau   arrivée 09:00' && p.lines[1] === 'Maison   ici' && p.lines[2] === 'Autre adresse   sur le téléphone', `lieux devenus favoris ${JSON.stringify(p.lines)}`);
      common(p, H.places);
      return { screen: p };
    });
    await step(`session-${label}`, async () => {
      await back(is('home'), 'accueil');
      await sim.select(3);
      await sim.input('click');
      await sim.waitScreen(is('favorites'), 15_000, 'Autres favoris');
      const h = await back(is('home'), 'accueil');
      const homeId = sim.screens.find((y) => y.screen === 'home')?.id ?? 0;
      check(!sim.screens.some((x) => x.title === 'Quai 1.2' && x.id > homeId), '« Quai 1.2 » ne revient pas pendant la session');
      return { screen: h, shot: false };
    });
  };
  await from('1.0', P10, ['fav-bureau', 'fav-dl-nord', 'fav-gand', 'fav-gdn', 'fav-namur', 'maison'], true);
  await from('1.1', P11, ['fav-bureau', 'fav-dl-nord', 'fav-gand', 'fav-gdn', 'fav-maison', 'fav-namur'], false);
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
    check(sameList(s.lines.slice(0, 4), WELCOME), `texte ${JSON.stringify(s.lines)}`);
    check(!sim.screens.some((x) => x.title === 'Quai 1.2'), 'jamais « Quai 1.2 » après une nouvelle installation (CA-3.2)');
    common(s, H.firstRun);
    return { screen: s, pixels: false, tour: ['glasses-first-run.png', 'Premier lancement : bienvenue, réglages sur le téléphone'] };
  });
  await step('home-empty', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil sans favori');
    check(s.lines[0] === 'Près de Bruxelles-Nord', `ligne du haut « ${s.lines[0]} » (seulement sans favoris en tête)`);
    check(sameList(s.lines.slice(1, 4), ['Ajouter un favori', 'Autour de moi   4 arrêts', 'Aller à…']), `menu ${JSON.stringify(s.lines)}`);
    common(s, H.home);
    return { screen: s, tour: ['glasses-home-near.png', 'Accueil sans favori : « Près de Bruxelles-Nord », « Ajouter un favori »'] };
  });
  await step('empty-list', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Mes favoris'), 10_000, 'liste vide');
    check(sameList(s.lines.slice(0, 3), ['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', 'ou ajoute un favori sur le téléphone.']), `texte ${JSON.stringify(s.lines)} (PRD-1.2 § 2.3)`);
    common(s, H.message);
    return { screen: s, pixels: false };
  });
  await step('places-empty', async () => {
    await back(is('home'), 'retour à l’accueil');
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('places'), 10_000, 'Aller à…');
    check(sameList(s.lines.slice(0, 2), ['Aucun lieu enregistré   sur le téléphone', 'Autre adresse   sur le téléphone']), `lignes ${JSON.stringify(s.lines)}`);
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
    await sim.launch(pageUrl(P12(S2), '', { data: proxy.url }));
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
    await sim.launch(pageUrl(P12(S2), '', { data: proxy.url }));
    await step('retry-auto', async () => {
      await sim.waitScreen(is('message', (x) => /^Horaires injoignables/.test(x.lines[0] ?? '')), 40_000, 'horaires injoignables');
      const t0 = Date.now();
      proxy.up(true);
      const s = await sim.waitScreen((x) => x.screen === 'board' || x.screen === 'home', 45_000, 'nouvel essai seul (30 s)');
      notes.push(`errors : démarrage seul ${((Date.now() - t0) / 1000).toFixed(1)} s après le retour du serveur d’horaires`);
      return { screen: s, shot: false };
    });
    proxy.up(false);
    await sim.launch(pageUrl(P12(S2), '', { data: proxy.url }));
    await step('error-exit', async () => {
      await sim.waitScreen(is('message', (x) => /^Horaires injoignables/.test(x.lines[0] ?? '')), 40_000, 'horaires injoignables');
      const mark = sim.out.join('').length;
      await sim.input('double_click', 2_500);
      check(/ShutDownPageContainer/.test(sim.out.join('').slice(mark)), 'double toucher sur l’erreur au lancement : shutDownPageContainer non appelé');
    });
  } finally {
    await proxy.close();
  }
  await sim.launch(pageUrl(P12(S2), '', { relay: 'http://127.0.0.1:9' }));
  await step('relay-down', async () => {
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && x.lines.includes(RT_DOWN)), 30_000, 'départs sans relais');
    check(s.lines.slice(0, 5).every((l) => /~\d+ min$/.test(l)), `tout en horaire prévu : ${JSON.stringify(s.lines)}`);
    const h = await back(is('home', (x) => x.lines[0] === RT_DOWN), 'accueil, « Temps réel indisponible » (pas « Pas de réseau »)');
    return { screen: h, shot: false };
  });
  await sim.launch(pageUrl({ ...P12(S2), mockLat: '50.1', mockLon: '5.2' }));
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
    await sim.launch(pageUrl(P12(S2), '', { data: old.url }));
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
  await sim.launch(pageUrl(P12({ ...S2, mockNow: '2026-11-10T23:30:00+01:00' })));
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

/** Haut de la capture : un sélecteur CSS, ou le premier élément dont le texte est exactement `text`. */
type Scroll = string | { text: string };

/** Étape du téléphone : capture facultative (390 × 844, densité 2, sans l'émulateur des lunettes de la page). */
async function phoneStep(page: Page, name: string, fn: () => Promise<{ shot?: boolean; deliver?: keyof typeof DELIVERABLES; scroll?: Scroll; glasses?: GlassesScreen } | void>): Promise<void> {
  const t0 = Date.now();
  const r: StepResult = { scenario, step: name, ok: true, ms: 0 };
  try {
    const out = (await fn()) ?? {};
    if (out.glasses) r.screen = out.glasses;
    if (out.shot !== false && (out.shot || out.deliver)) {
      await page.addStyle(NO_EMU);
      await page.eval(`document.activeElement && document.activeElement.blur && document.activeElement.blur(), true`);
      const target =
        typeof out.scroll === 'string'
          ? `document.querySelector(${JSON.stringify(out.scroll)})`
          : out.scroll
            ? `[...document.querySelectorAll('h1,h2,h3,legend,label,span,p,button,strong')].find((e) => ${N('e.textContent')}.trim() === ${JSON.stringify(out.scroll.text)})`
            : 'null';
      await page.eval(`(() => { const el = ${target}; if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12); else window.scrollTo(0, 0); return true; })()`);
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

/** Changement d'écran du téléphone par l'ancre seule (même page, rien n'est rechargé). */
async function hashGo(page: Page, hash: string): Promise<void> {
  await page.eval(`(location.hash = ${JSON.stringify(hash)}, true)`);
  await sleep(400);
}

/** Texte des propositions du champ (« libellé | type »). */
const suggestions = (page: Page, id: string) =>
  page.eval<string[]>(`[...document.querySelectorAll('#${id}-liste [role=option]')].map((b) => ${N("b.querySelector('.s1').textContent")} + ' | ' + ${N("b.querySelector('.s2').textContent")})`);

/** Touche la proposition « libellé » (et « type ») du champ `id`, dès qu'elle paraît. */
async function pick(page: Page, id: string, label: string, type?: string, timeout = 10_000): Promise<void> {
  const find = `[...document.querySelectorAll('#${id}-liste [role=option]')].find((b) => ${N("b.querySelector('.s1')?.textContent")} === ${JSON.stringify(label)}${type ? ` && ${N("b.querySelector('.s2')?.textContent")} === ${JSON.stringify(type)}` : ''})`;
  await page.waitFor(`!!${find}`, timeout, `proposition « ${label}${type ? ` | ${type}` : ''} » du champ ${id}`);
  await page.eval(`(() => { const b = ${find}; b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
}

const noCoordinates = async (page: Page) => {
  const t = await page.text('main');
  check(!/\b\d{1,2}[.,]\d{4,}\b/.test(t), `coordonnées affichées : ${/\b\d{1,2}[.,]\d{4,}\b/.exec(t)?.[0]}`);
};

/** Lignes de « Mes favoris » : titre, sous-titre, accès d'un lieu, créneau. */
interface FavRow {
  t1: string;
  t2: string;
  t3: string;
  t4: string;
}
const favRows = (page: Page) =>
  page.eval<FavRow[]>(
    `[...document.querySelectorAll('.screen ul.list > li > button.row')].map((b) => ({ t1: ${N("b.querySelector('.t1')?.textContent")}, t2: ${N("b.querySelector('.t2:not(.t4)')?.textContent")}, t3: ${N("b.querySelector('.t3')?.textContent")}, t4: ${N("b.querySelector('.t4')?.textContent")} }))`,
  );
/** Attend « Mes favoris » avec `n` lignes, accès des lieux et noms des arrêts calculés (« Gare du Nord, tram »). */
async function waitRows(page: Page, n: number, label = `${n} favoris`): Promise<FavRow[]> {
  const t0 = Date.now();
  let rows: FavRow[] = [];
  while (Date.now() - t0 < 15_000) {
    rows = await favRows(page).catch(() => []);
    const settled = rows.every((r) => !/…$/.test(r.t3) && !(r.t3 === '' && /Près de|, \d{4} |Position prise|Adresse à vérifier/.test(r.t2) && r.t2 !== 'Adresse à vérifier'));
    if (rows.length === n && settled) {
      await sleep(400); // noms d'arrêts complétés (modes connus)
      return favRows(page);
    }
    await sleep(150);
  }
  throw new Check(`délai dépassé : ${label} (lignes : ${JSON.stringify(rows)})`);
}
const rowText = (r: FavRow) => [r.t1, r.t2, r.t3, r.t4].filter(Boolean).join(' | ');

async function phone(): Promise<void> {
  // Migration visible depuis la 1.1 (CA-2.1) : Maison et Bureau deviennent des lieux, sans doublon ; bannière une fois.
  await withChrome(async (page) => {
    await phoneStep(page, 'migration', async () => {
      await page.goto(pageUrl(P11(S1), '#/'));
      const t = await waitText(page, new RegExp(`${BANNER.replace(/[.()]/g, '\\$&')}\\s*OK`), 'bannière 1.2 depuis la 1.1', 15_000);
      check(!/Mes lieux/.test(t), '« Mes lieux » encore sur l’accueil (PRD-1.2 § 2.2)');
      check(/Mes favoris\s+6 favoris/.test(t), `ligne « Mes favoris », « 6 favoris » : ${/Mes favoris[^\n]*\n[^\n]*/.exec(t.split('Réglages').pop() ?? '')?.[0]}`);
      const g = await page.waitScreen((s) => s.screen === 'message' && s.title === 'Quai 1.2', 20_000, 'message « Quai 1.2 » dans les lunettes');
      await page.clickText('OK', '.news');
      await page.waitFor(`!document.querySelector('.news')`, 5_000, 'bannière fermée par « OK »');
      await hashGo(page, '#/favoris');
      await waitText(page, /Ajouter un favori/, 'écran « Mes favoris »');
      check((await page.text('main')).includes(FAVS_LEAD), 'chapeau de « Mes favoris »');
      const rows = await waitRows(page, 6, 'six favoris migrés');
      const want: [RegExp, RegExp, RegExp][] = [
        [/^Bureau$/, /^Adresse à vérifier$/, /^proposé le matin$/],
        [/^Gare du Nord, tram$/, /^Trams 3 et 4$/, /^proposé à moins de 300 m$/],
        [/^Bruxelles-Central → Gand-Saint-Pierre$/, /^Trajet fixe$/, /^$/],
        [/^Namur, train$/, /^Toutes les lignes$/, /^$/],
        [/^Bruxelles-Nord, bus De Lijn$/, /^Toutes les lignes$/, /^$/],
        [/^Maison$/, /^Adresse à vérifier$/, /^proposé le soir$/],
      ];
      want.forEach(([a, b, c], i) => check(rows[i] && a.test(rows[i].t1) && b.test(rows[i].t2) && c.test(rows[i].t4), `favori ${i + 1} : ${rows[i] ? rowText(rows[i]) : 'absent'}`));
      check(!rows.some((r) => /Ma position/.test(r.t1)), 'plus de trajet « Ma position → lieu » (fusionné avec son lieu)');
      return { glasses: g };
    });
    await phoneStep(page, 'migration-legacy-link', async () => {
      // ancre de la 1.1 (#/lieux) : la même chose dans « Mes favoris »
      await hashGo(page, '#/lieux');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, '#/lieux mène à #/favoris (CA-2.4)');
      await hashGo(page, '#/lieux/nouveau');
      await page.waitFor(`location.hash === '#/favoris/nouveau' && document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000, '#/lieux/nouveau mène à « Nouveau favori »');
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'home', async () => {
      await page.goto(pageUrl(P12(S1), '#/'));
      await page.waitFor(`document.querySelector('.home-favs')?.innerText.includes('partir à 07:35')`, 20_000, 'réponses des favoris sur l’accueil');
      const t = await page.text('main');
      check(t.includes('Où vas-tu ?') && t.includes('Adresse, gare, arrêt ou lieu') && t.includes('Mes favoris') && t.includes('Gérer mes favoris'), 'accueil : champ et section « Mes favoris »');
      check(!t.includes(BANNER), 'pas de bannière pour qui a déjà vu la 1.2');
      const buttons = await page.eval<number>(`document.querySelectorAll('.home-favs button.btn-glasses').length`);
      check(buttons === 6, `un bouton « Lunettes » par favori, lieux compris (${buttons})`);
      const names = (await page.eval<string[]>(`[...document.querySelectorAll('.home-favs .fav-row')].map((r) => r.innerText.split('\\n')[0])`)).map(nbn);
      check(names.includes('Vers le bureau') && names.includes('Vers la maison'), `les lieux sur l’accueil : ${JSON.stringify(names)}`);
    });
    await phoneStep(page, 'favorite-to-glasses', async () => {
      const n = page.screens().length;
      await page.eval(`(() => { const row = [...document.querySelectorAll('.home-favs .fav-row')].find((r) => r.innerText.includes('Vers le bureau')); row.querySelector('button').click(); return true; })()`);
      const g = await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 20_000, 'étapes suivies dans les lunettes', n);
      const msg = nbn(await page.waitFor<string>(`[...document.querySelectorAll('.home-favs .msg')].map((m) => m.textContent).filter(Boolean).join('|')`, 10_000, 'message à côté du bouton'));
      check(msg === 'Affiché dans les lunettes : IC 07:42, voie 6.', `message « ${msg} »`);
      check(g.title === 'Vers le bureau : 07:35 → 09:00' && g.page === 1 && g.label === 'short', `lunettes « ${g.title} » page ${g.page} ${g.label}`);
      // arrêt favori : ses départs, un seul message (celui du bouton touché)
      const m = page.screens().length;
      await page.eval(`(() => { const row = [...document.querySelectorAll('.home-favs .fav-row')].find((r) => r.innerText.includes('Gare du Nord')); row.querySelector('button').click(); return true; })()`);
      const b = await page.waitScreen((s) => s.screen === 'board' && /^Gare du Nord, tram \(STIB\) ★$/.test(s.title), 20_000, 'départs de l’arrêt favori dans les lunettes', m);
      const msgs = (await page.eval<string[]>(`[...document.querySelectorAll('.home-favs .msg')].map((m) => m.textContent).filter(Boolean)`)).map(nbn);
      check(msgs.length === 1 && msgs[0] === 'Affiché dans les lunettes : départs de Gare du Nord.', `un seul message : ${JSON.stringify(msgs)}`);
      return { glasses: b };
    });
  });

  // « Mes favoris » avec des lieux à adresse vérifiée : la liste unique, la marche maximale, « Nouveau favori ».
  await withChrome(async (page) => {
    await phoneStep(page, 'favorites-list', async () => {
      await page.goto(pageUrl(PNICE(S1), '#/favoris'));
      const rows = await waitRows(page, 6);
      check(rows[0].t1 === 'Bureau' && rows[0].t2 === 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode' && /^Métro Rogier à \d+ min à pied/.test(rows[0].t3) && rows[0].t4 === 'proposé le matin', `lieu Bureau : ${rowText(rows[0])}`);
      check(rows[5].t1 === 'Maison' && rows[5].t2 === 'Rue de Fer 25, 5000 Namur' && /à \d+ min à pied/.test(rows[5].t3) && rows[5].t4 === 'proposé le soir', `lieu Maison : ${rowText(rows[5])}`);
      check(rows[2].t1 === 'Bruxelles-Central → Gand-Saint-Pierre' && rows[2].t2 === 'Trajet fixe', `trajet fixe : ${rowText(rows[2])}`);
      check(rows[1].t1 === 'Gare du Nord, tram' && rows[1].t2 === 'Trams 3 et 4', `arrêt : ${rowText(rows[1])}`);
      notes.push(`phone : accès des lieux : « ${rows[0].t3} » ; « ${rows[5].t3} »`);
      await noCoordinates(page);
      return { deliver: 'p01' };
    });
    await phoneStep(page, 'max-walk', async () => {
      const t = await page.text('main');
      check(t.includes('Marche maximale') && t.includes(MAX_WALK_SUB), '« Marche maximale » et son sous-titre (PRD-1.2 § 2.2)');
      const v = nbn(await page.eval<string>(`[...document.querySelectorAll('output')].map((o) => o.textContent).join('|')`));
      check(v === '10 min', `valeur « ${v} »`);
      check(t.includes('Adresses récentes') && t.includes('Effacer les adresses récentes') && t.includes('Veldstraat 1, 9000 Gent'), 'adresses récentes en bas de « Mes favoris »');
      check(!t.includes('Mes lieux'), 'plus de « Mes lieux »');
      return { deliver: 'p05', scroll: { text: 'Ajouter un favori' } };
    });
    await phoneStep(page, 'new-favorite', async () => {
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000, 'écran « Nouveau favori »');
      await page.eval(`document.querySelector('#nf-lieu').focus(), true`);
      const list = await page.waitFor<string[]>(`(() => { const l = [...document.querySelectorAll('#nf-lieu-liste [role=option]')]; return l.length >= 3 && l.map((b) => ${N("b.querySelector('.s1').textContent")} + ' | ' + ${N("b.querySelector('.s2').textContent")}); })()`, 8_000, 'propositions du champ vide');
      check(list[0] === 'Ma position actuelle | si tu es sur place', `en tête « ${list[0]} »`);
      check(list.slice(1).every((l) => / \| récent$/.test(l)), `puis les adresses récentes : ${JSON.stringify(list)}`);
      const t = await page.text('main');
      check(/Adresse, gare ou arrêt/.test(t) && t.includes('Un trajet fixe, d’un endroit à un autre'), 'champ « Adresse, gare ou arrêt » et lien « Un trajet fixe »');
      return { deliver: 'p02' };
    });
    await phoneStep(page, 'here-place', async () => {
      // « Ma position actuelle » : un lieu « Position prise sur place », à nommer
      await pick(page, 'nf-lieu', 'Ma position actuelle');
      await page.waitFor(`!!document.querySelector('#pl-nom')`, 12_000, 'formulaire du lieu');
      await waitText(page, /Position prise sur place[\s\S]*à \d+ min à pied/, 'endroit et accès', 10_000);
      check(await page.eval<boolean>(`[...document.querySelectorAll('.place-form button')].find((b) => b.textContent === 'Enregistrer').disabled`), '« Enregistrer » grisé sans nom');
      check((await page.text('main')).includes('Donne un nom au lieu.'), 'aide « Donne un nom au lieu. »');
      await page.type('#pl-nom', 'Piscine');
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 7);
      check(rows[6].t1 === 'Piscine' && rows[6].t2 === 'Position prise sur place' && /à \d+ min à pied/.test(rows[6].t3) && !rows[6].t4, `nouveau lieu en fin de liste : ${rowText(rows[6])}`);
    });
  });

  // Nouveau favori depuis une liste vide : adresse (CA-2.3), gare « Ses prochains départs » / « Le trajet pour y aller »,
  // trajet fixe entre deux lieux, suppression d'un lieu utilisé par un trajet fixe (CA-2.5).
  await withChrome(async (page) => {
    await phoneStep(page, 'new-place', async () => {
      await page.goto(pageUrl(PEMPTY(S1), '#/favoris'));
      await waitText(page, /Aucun favori pour l’instant\.[\s\S]*Ajouter un favori/, 'liste vide et « Ajouter un favori »');
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000, 'écran « Nouveau favori »');
      await page.type('#nf-lieu', 'rue neuve 1 bruxelles');
      await pick(page, 'nf-lieu', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
      await page.waitFor(`document.querySelector('#pl-nom')?.value === 'Rue Neuve 1'`, 5_000, 'nom proposé « Rue Neuve 1 » (adresse courte)');
      await page.clickText('Bureau', '.shortcuts');
      await page.waitFor(`document.querySelector('#pl-nom').value === 'Bureau' && document.querySelector('.place-form input[type=radio][value=morning]').checked`, 3_000, '« Bureau » : « Le matin » coché sans autre toucher');
      await waitText(page, /Rue Neuve 1, 1000 Bruxelles[\s\S]*à \d+ min à pied/, 'adresse normalisée et accès', 10_000);
      await noCoordinates(page);
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 1);
      check(rows[0].t1 === 'Bureau' && rows[0].t2 === 'Rue Neuve 1, 1000 Bruxelles' && /à \d+ min à pied/.test(rows[0].t3) && rows[0].t4 === 'proposé le matin', `CA-2.3 (3 touchers, 1 saisie) : ${rowText(rows[0])}`);
    });
    await phoneStep(page, 'station-choice', async () => {
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.type('#nf-lieu', 'namur');
      await pick(page, 'nf-lieu', 'Namur', 'gare SNCB');
      await page.waitFor(`!!document.querySelector('.stop-form fieldset input[type=checkbox]')`, 10_000, 'lignes de la gare');
      const radios = await page.eval<string>(`[...document.querySelectorAll('.form-body > fieldset label')].map((l) => l.textContent + (l.querySelector('input').checked ? ' (coché)' : '')).join(' | ')`);
      check(nbn(radios) === 'Ses prochains départs (coché) | Le trajet pour y aller', `choix « Dans les lunettes » : ${radios}`);
      check((await page.text('main')).includes('Dans les lunettes'), 'légende « Dans les lunettes »');
      return { deliver: 'p03' };
    });
    await phoneStep(page, 'station-board', async () => {
      await page.clickText('Enregistrer', '.stop-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 2);
      check(rows[1].t1 === 'Namur, train' && rows[1].t2 === 'Toutes les lignes', `« Ses prochains départs » donne un arrêt : ${rowText(rows[1])}`);
    });
    await phoneStep(page, 'station-trip', async () => {
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.type('#nf-lieu', 'namur');
      await pick(page, 'nf-lieu', 'Namur', 'gare SNCB');
      await page.clickText('Le trajet pour y aller', '.form-body');
      await page.waitFor(`document.querySelector('#pl-nom')?.value === 'Namur'`, 5_000, 'lieu nommé « Namur »');
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 3);
      check(rows[2].t1 === 'Namur' && rows[2].t2 === 'Près de Namur' && /^Gare de Namur à \d+ min à pied/.test(rows[2].t3), `« Le trajet pour y aller » donne un lieu « Près de Namur » : ${rowText(rows[2])}`);
    });
    await phoneStep(page, 'fixed-trip', async () => {
      // Maison : « rue de fer 25 namur », raccourci « Maison » (proposé le soir)
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.type('#nf-lieu', 'rue de fer 25 namur');
      await pick(page, 'nf-lieu', 'Rue de Fer 25, 5000 Namur', 'adresse');
      await page.clickText('Maison', '.shortcuts');
      await page.clickText('Enregistrer', '.place-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000);
      // Trajet fixe Maison → Bureau
      await page.clickText('Ajouter un favori');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Nouveau favori'`, 5_000);
      await page.clickText('Un trajet fixe, d’un endroit à un autre');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Trajet fixe'`, 5_000, 'écran « Trajet fixe »');
      await page.eval(`document.querySelector('#fav-de').focus(), true`);
      const dep = await page.waitFor<string[]>(`(() => { const l = [...document.querySelectorAll('#fav-de-liste [role=option]')]; return l.length && l.map((b) => ${N("b.querySelector('.s1').textContent")}); })()`, 5_000, 'propositions du départ');
      check(!dep.some((l) => /^Ma position/.test(l)) && dep.includes('Maison') && dep.includes('Bureau'), `départ : les lieux, jamais « Ma position » : ${JSON.stringify(dep)}`);
      await pick(page, 'fav-de', 'Maison', 'mon lieu');
      await page.eval(`document.querySelector('#fav-vers').focus(), true`);
      await pick(page, 'fav-vers', 'Bureau', 'mon lieu');
      await page.clickText('Enregistrer', '.trip-form');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 5);
      check(rows[4].t1 === 'Maison → Bureau' && rows[4].t2 === 'Trajet fixe', `trajet fixe entre deux lieux : ${rowText(rows[4])}`);
    });
    await phoneStep(page, 'delete-place', async () => {
      await page.eval(`(() => { const b = [...document.querySelectorAll('.screen ul.list > li > button.row')].find((r) => r.querySelector('.t1')?.textContent === 'Maison'); b.click(); return true; })()`);
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Maison'`, 5_000, 'écran du lieu « Maison »');
      // Espacements du formulaire d'un lieu (comme les écrans de la 1.1) : « Supprimer ce favori » ne touche pas
      // « Enregistrer », le champ de l'endroit ne touche pas les raccourcis du nom.
      const gaps = await page.eval<{ saveDel: number; shortcutsField: number }>(`(() => {
        const f = document.querySelector('.place-form');
        const btn = (t) => [...f.querySelectorAll('button')].find((b) => b.textContent === t).getBoundingClientRect();
        const sc = f.querySelector('.shortcuts').getBoundingClientRect();
        const next = f.querySelector('#pl-lieu').closest('.field').getBoundingClientRect();
        return { saveDel: Math.round(btn('Supprimer ce favori').top - btn('Enregistrer').bottom), shortcutsField: Math.round(next.top - sc.bottom) };
      })()`);
      check(gaps.saveDel >= 12 && gaps.shortcutsField >= 12, `espacements du formulaire du lieu (px) : ${JSON.stringify(gaps)}`);
      await page.clickText('Supprimer ce favori');
      const q = nbn(await page.waitFor<string>(`document.querySelector('.confirm-q')?.textContent`, 5_000, 'question de suppression'));
      check(q === 'Supprimer « Maison » ? Les trajets fixes qui l’utilisent seront aussi supprimés.', `question « ${q} » (CA-2.5)`);
      await page.clickText('Supprimer', '.confirm-actions');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, 'retour à « Mes favoris »');
      const rows = await waitRows(page, 3);
      check(!rows.some((r) => /Maison/.test(r.t1)), `« Maison » et « Maison → Bureau » supprimés : ${JSON.stringify(rows.map((r) => r.t1))}`);
    });
  });

  // Cartes (scène noRT) : Rue Neuve 1 (CA-1.4), Waterloo (CA-1.5), bouton « Lunettes ».
  await stack.scene('noRT');
  try {
    await withChrome(async (page) => {
      await phoneStep(page, 'results', async () => {
        await page.goto(pageUrl(P12(S1), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await page.waitFor(`[...document.querySelectorAll('#r-arrivee-liste [role=option]')].some((b) => b.innerText.includes('Rue Neuve 1, 1000 Bruxelles'))`, 10_000, 'adresse proposée');
        const first = (await suggestions(page, 'r-arrivee'))[0];
        check(first === 'Rue Neuve 1, 1000 Bruxelles | adresse', `1re proposition « ${first} » (le texte ressemble à une adresse)`);
        await pick(page, 'r-arrivee', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.innerText.replace(/\\n+/g, ' | '))`)).map(nbn);
        check(/^Le plus court \| 07:33 → 08:51 \| 1 h 18, 1 changement, 12 min à pied/.test(cards[0]) && cards[0].includes('Arrive le plus tôt.'), `carte 1 : ${cards[0]}`);
        check(/^Sans changement \| 07:33 → 08:56 \| 1 h 23, direct, 17 min à pied/.test(cards[1]) && cards[1].includes('Aucun changement, mais arrive 5 min plus tard.'), `carte 2 : ${cards[1]}`);
        check(/^Le suivant \| 08:33 → 09:55/.test(cards[2]) && cards[2].includes('Même trajet, départ suivant.'), `carte 3 : ${cards[2]}`);
        check(cards.every((c) => c.endsWith('Lunettes')), 'un bouton « Lunettes » par carte');
        const roles = await page.eval<string>(`document.querySelector('.results').getAttribute('role') + '/' + document.querySelectorAll('.results [role=radio]').length + '/' + document.querySelector('.result button.btn-glasses').getAttribute('aria-label')`);
        check(roles === 'radiogroup/3/Afficher Le plus court dans les lunettes', `accessibilité ${roles} (CA-M4.13)`);
        check((await page.text('.results-box')).includes('3 trajets.'), 'nombre de trajets annoncé');
        const buttons = await page.eval<string[]>(`[...document.querySelectorAll('button')].map((b) => b.textContent)`);
        check(!buttons.some((b) => /Enregistrer (l’adresse )?comme lieu/.test(b ?? '')) && buttons.includes('Garder en favori'), '« Enregistrer comme lieu » retiré, « Garder en favori » présent (PRD-1.2 § 2.2)');
      });
      await phoneStep(page, 'glasses-button', async () => {
        const n = page.screens().length;
        await page.click('.result:nth-child(2) button.btn-glasses');
        const g = await page.waitScreen((s) => s.screen === 'steps' && s.page === 2 && s.followed === true, 20_000, 'trajet de la carte 2 suivi', n);
        check(g.label === 'none' && g.pages === 3 && g.title === 'Vers Rue Neuve 1 : 07:33 → 08:56', `lunettes ${g.label} ${g.pages} « ${g.title} »`);
        check(g.lines[0] === 'Sans changement : à pied 7 + 10 min', `raison « ${g.lines[0]} » (CA-1.4)`);
        const msgs = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.querySelector('.msg')?.textContent ?? '')`)).map(nbn);
        check(msgs[1] === 'Affiché dans les lunettes : IC 07:42, voie 4.' && !msgs[0] && !msgs[2], `message seulement à côté du bouton touché : ${JSON.stringify(msgs)}`);
        return { glasses: g };
      });
      await phoneStep(page, 'glasses-pages', async () => {
        const n = page.screens().length;
        for (let i = 0; i < 4 && page.lastScreen()?.page !== 3; i++) await page.gesture('down');
        const p3 = await page.waitScreen((s) => s.screen === 'steps' && s.page === 3, 8_000, 'page 3', n);
        check(p3.label === 'next' && p3.followed === false && p3.title === 'Vers Rue Neuve 1 : 08:33 → 09:55', `page 3 ${p3.label} « ${p3.title} »`);
        // ▲ : la page précédente, affichée par sa fin, puis la page 1
        for (let i = 0; i < 5 && page.lastScreen()?.page !== 1; i++) await page.gesture('up');
        const p1 = await page.waitScreen((s) => s.screen === 'steps' && s.page === 1, 8_000, 'page 1', n);
        check(p1.label === 'short' && bottom(p1) === '▼ Sans changement : 07:33 → 08:56', `page 1 ${JSON.stringify(p1.lines)}`);
        check(p1.lines[0] === 'Le plus court : 1 changement, à pied 7 + 2 + 3 min', `raison « ${p1.lines[0]} » (CA-1.4)`);
        return { glasses: p1 };
      });
      await phoneStep(page, 'results-waterloo', async () => {
        await page.goto(pageUrl(P12(WAT), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue du progrès 20');
        await pick(page, 'r-arrivee', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.innerText.replace(/\\n+/g, ' | '))`)).map(nbn);
        check(/^Le plus court \| 07:34 → 08:30 \| 56 min, direct, 24 min à pied/.test(cards[0]) && cards[0].includes('Arrive le plus tôt.'), `carte 1 : ${cards[0]}`);
        check(/^Moins de marche \| 07:32 → 08:46 \| 1 h 14, 1 changement, 7 min à pied/.test(cards[1]) && cards[1].includes('17 min de marche en moins, mais arrive 16 min plus tard.'), `carte 2 : ${cards[1]} (CA-1.5)`);
        check(/^Le suivant \| 08:04 → 09:00/.test(cards[2]), `carte 3 : ${cards[2]}`);
        return { deliver: 'p04', scroll: '.res-head' };
      });
      await phoneStep(page, 'results-earlier', async () => {
        // « Plus tôt » (§ 1.3) : marche longue qui ne fait gagner que 8 min (Waterloo à 08:30 vers Uccle)
        await page.goto(pageUrl(P12({ ...WAT, mockNow: '2026-11-10T08:30:00+01:00' }), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'avenue winston churchill 100');
        await pick(page, 'r-arrivee', 'Avenue Winston Churchill 100, 1180 Uccle', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.innerText.replace(/\\n+/g, ' | '))`)).map(nbn);
        check(/^Le plus court \| 08:32 → 09:43 \| /.test(cards[0]) && cards[0].includes('Le plus court sans marche longue.'), `carte 1 : ${cards[0]}`);
        check(/^Plus tôt \| 08:34 → 09:35 \| /.test(cards[1]) && cards[1].includes('Arrive 8 min plus tôt, mais avec 19 min à pied.'), `carte 2 : ${cards[1]}`);
        check(/^Le suivant \| 08:52 → 10:07/.test(cards[2]), `carte 3 : ${cards[2]}`);
        const n = page.screens().length;
        await page.click('.result:nth-child(2) button.btn-glasses');
        const g = await page.waitScreen((s) => s.screen === 'steps' && s.page === 2 && s.followed === true, 20_000, 'carte « Plus tôt » dans les lunettes', n);
        check(g.label === 'earlier' && g.lines[0] === 'Plus tôt : 1 changement, à pied 19 + 1 + 2 min', `lunettes ${g.label} « ${g.lines[0]} »`);
        return { glasses: g };
      });
      await phoneStep(page, 'results-none', async () => {
        // « Sans changement » (§ 1.3) : Uccle vers la rue Neuve, le direct arrive 5 min plus tard
        await page.goto(pageUrl(P12({ mockLat: '50.808', mockLon: '4.365', mockNow: '2026-11-10T07:31:00+01:00' }), '#/recherche'));
        await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
        await page.type('#r-arrivee', 'rue neuve 1 bruxelles');
        await pick(page, 'r-arrivee', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
        await page.waitFor(`document.querySelectorAll('.result').length === 3`, 15_000, 'trois cartes');
        const cards = (await page.eval<string[]>(`[...document.querySelectorAll('.result')].map((r) => r.innerText.replace(/\\n+/g, ' | '))`)).map(nbn);
        check(/^Le plus court \| 07:33 → 08:06 \| /.test(cards[0]) && cards[0].includes('Arrive le plus tôt.'), `carte 1 : ${cards[0]}`);
        check(/^Sans changement \| 07:33 → 08:11 \| /.test(cards[1]) && cards[1].includes('Aucun changement, mais arrive 5 min plus tard.'), `carte 2 : ${cards[1]}`);
      });
    });
  } finally {
    await stack.scene('base');
  }

  // Champ unique, messages, « Garder en favori » (CA-2.4)
  await withChrome(async (page) => {
    await phoneStep(page, 'field', async () => {
      await page.goto(pageUrl(PPHONE(S3), '#/recherche'));
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
  });
  await withChrome(async (page) => {
    const keep = async (label: string): Promise<string> => {
      await page.clickText('Garder en favori', '.below-results');
      return nbn(await page.waitFor<string>(`[...document.querySelectorAll('.below-results .msg')].map((m) => m.textContent).find((t) => t && t !== ${JSON.stringify(label)})`, 6_000, 'message de « Garder en favori »'));
    };
    await phoneStep(page, 'keep-place', async () => {
      await page.goto(pageUrl(PEMPTY(S3), '#/recherche'));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await page.type('#r-arrivee', 'veldstraat 1 gent');
      await pick(page, 'r-arrivee', 'Veldstraat 1, 9000 Gent', 'adresse');
      await page.waitFor(`document.querySelectorAll('.result').length >= 2`, 15_000, 'cartes vers Veldstraat (CA-M4.4)');
      const m1 = await keep('');
      check(m1 === 'Ajouté à tes favoris.', `« ${m1} »`);
      const m2 = await keep(m1);
      check(m2 === 'Déjà dans tes favoris.', `seconde fois : « ${m2} » (CA-2.4)`);
      await hashGo(page, '#/lieux');
      await page.waitFor(`location.hash === '#/favoris'`, 5_000, '#/lieux mène à #/favoris');
      const rows = await waitRows(page, 1);
      check(rows[0].t1 === 'Veldstraat 1' && rows[0].t2 === 'Veldstraat 1, 9000 Gent' && /à \d+ min à pied/.test(rows[0].t3), `« Ma position » → Veldstraat 1 donne un lieu : ${rowText(rows[0])}`);
    });
    await phoneStep(page, 'keep-trip', async () => {
      await hashGo(page, '#/recherche');
      await page.waitFor(`!!document.querySelector('#r-depart')`, 10_000);
      await page.type('#r-depart', 'bruxelles-central');
      await pick(page, 'r-depart', 'Bruxelles-Central', 'gare SNCB');
      await page.type('#r-arrivee', 'gand-saint-pierre');
      await pick(page, 'r-arrivee', 'Gand-Saint-Pierre', 'gare SNCB');
      await page.waitFor(`document.querySelectorAll('.result').length >= 2`, 15_000, 'cartes Bruxelles-Central vers Gand-Saint-Pierre');
      const m1 = await keep('');
      check(m1 === 'Ajouté à tes favoris.', `« ${m1} »`);
      const m2 = await keep(m1);
      check(m2 === 'Déjà dans tes favoris.', `seconde fois : « ${m2} »`);
      await hashGo(page, '#/favoris');
      const rows = await waitRows(page, 2);
      check(rows[1].t1 === 'Bruxelles-Central → Gand-Saint-Pierre' && rows[1].t2 === 'Trajet fixe', `trajet fixe : ${rowText(rows[1])}`);
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'reorder', async () => {
      await page.goto(pageUrl(P12(S3), '#/favoris'));
      await waitText(page, /Changer l’ordre/, 'bouton « Changer l’ordre »');
      await page.clickText('Changer l’ordre');
      await page.waitFor(`document.querySelectorAll('.order-row').length >= 2`, 5_000, 'mode « Changer l’ordre »');
      const before = await page.eval<string[]>(`[...document.querySelectorAll('.order-row .t1')].map((e) => e.textContent)`);
      check(before.length === 6 && before[0] === 'Bureau' && before[4] === 'Bruxelles-Nord' && before[5] === 'Maison', `lieux, arrêts et trajet dans une seule liste : ${JSON.stringify(before)}`);
      await page.click(`.order-row:nth-child(5) button:first-of-type`);
      await page.waitFor(`document.querySelector('.order-row:nth-child(4) .t1').textContent === 'Bruxelles-Nord'`, 5_000, '« Bruxelles-Nord » monté');
      check(await page.eval<boolean>(`document.querySelector('.order-row:nth-child(1) button:first-of-type').disabled && document.querySelector('.order-row:nth-child(6) button:last-of-type').disabled`), '« Monter » grisé en tête, « Descendre » en fin de liste');
    });
    await phoneStep(page, 'my-order', async () => {
      // « Bruxelles-Nord » (bus De Lijn, départs toutes les 15 min) monté en 1re place, puis « Dans mon ordre »
      // (CA-S3.2 ; un favori sans rien dans les 3 heures resterait en fin de liste, règle 5).
      for (const row of [4, 3, 2]) {
        await page.click(`.order-row:nth-child(${row}) button:first-of-type`);
        await page.waitFor(`document.querySelector('.order-row:nth-child(${row - 1}) .t1')?.textContent === 'Bruxelles-Nord'`, 5_000, `« Bruxelles-Nord » en ${row - 1}e place`);
      }
      await page.clickText('Terminé');
      const first = await page.waitFor<string>(`(() => { const t = document.querySelector('.list .t1')?.textContent ?? ''; return t.startsWith('Bruxelles-Nord') && t; })()`, 5_000, '« Bruxelles-Nord » en tête de la liste');
      check(first === 'Bruxelles-Nord' || first === 'Bruxelles-Nord, bus De Lijn', `« Bruxelles-Nord » monté en 1re place (${first})`);
      const n = page.screens().length;
      await hashGo(page, '#/affichage');
      await waitText(page, /Dans mon ordre/, 'écran « Affichage »');
      await page.clickText('Dans mon ordre');
      await page.waitFor(`!!document.querySelector('input[type=radio][value=mine]')?.checked`, 5_000, '« Dans mon ordre » choisi');
      const g = await page.waitScreen((s) => s.screen === 'home' && Array.isArray(s.order) && (s.order as string[])[0] === 'fav-dl-nord', 20_000, 'accueil des lunettes dans l’ordre choisi (CA-S3.2)', n);
      return { glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'data', async () => {
      await page.goto(pageUrl(P12(S3), '#/donnees'));
      const t = await waitText(page, /Adresses\s+Disponible\s+Services officiels de Bruxelles, de Flandre et de Wallonie[\s\S]*Version de Quai\s+1\.2\.0/, 'carte « Adresses » et « Version de Quai 1.2.0 » (PRD-1.2 § 4)', 15_000);
      check(/Horaires officiels\s+cette nuit, 04:12/.test(t), `date des horaires : ${/Horaires officiels\s+[^\n]+\n?[^\n]*/.exec(t)?.[0]}`);
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
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Tes favoris'`, 5_000, '« Tes favoris » (PRD-1.2 § 2.2)');
      await page.type('#s1-maison', 'rue de fer 25 namur');
      await pick(page, 's1-maison', 'Rue de Fer 25, 5000 Namur', 'adresse');
      await page.type('#s1-bureau', 'rue neuve 1 bruxelles');
      await pick(page, 's1-bureau', 'Rue Neuve 1, 1000 Bruxelles', 'adresse');
      const t = await page.text('main');
      check(t.includes('Facultatif. Maison et bureau deviennent tes premiers favoris.') && t.includes('Me proposer le trajet vers le bureau le matin, et vers la maison le soir'), 'textes de « Tes favoris »');
      check(await page.eval<boolean>(`document.querySelector('.check-row input[type=checkbox]').checked`), 'case cochée');
      const buttons = await page.eval<string[]>(`[...document.querySelectorAll('main button')].map((b) => b.textContent)`);
      check(buttons.includes('Terminer') && buttons.includes('Plus tard'), `boutons ${JSON.stringify(buttons.slice(-3))}`);
      return { deliver: 'p06' };
    });
    await phoneStep(page, 'onboarding-done', async () => {
      const n = page.screens().length;
      await page.clickText('Terminer');
      await page.waitFor(`document.querySelector('.home-favs')?.innerText.includes('Vers le bureau')`, 10_000, 'accueil avec « Mes favoris »');
      const g = await page.waitScreen((s) => s.screen === 'home' && s.lines[0]?.startsWith('Vers le bureau'), 15_000, 'lunettes : « Vers le bureau » en tête (CA-S1.2)', n);
      await hashGo(page, '#/favoris');
      const rows = await waitRows(page, 2, 'deux lieux, sans autre favori');
      check(rows[0].t1 === 'Bureau' && rows[0].t2 === 'Rue Neuve 1, 1000 Bruxelles' && rows[0].t4 === 'proposé le matin', `Bureau : ${rowText(rows[0])}`);
      check(rows[1].t1 === 'Maison' && rows[1].t2 === 'Rue de Fer 25, 5000 Namur' && rows[1].t4 === 'proposé le soir', `Maison : ${rowText(rows[1])}`);
      return { glasses: g };
    });
  });

  await withChrome(async (page) => {
    await phoneStep(page, 'legacy-place', async () => {
      await page.goto(pageUrl(P10(S1), '#/favoris'));
      const rows = await waitRows(page, 6);
      check(rows.filter((r) => r.t2 === 'Adresse à vérifier').length === 2, `Bureau et Maison « Adresse à vérifier » (CA-M4.10) : ${JSON.stringify(rows.map(rowText))}`);
      await page.eval(`(() => { const b = [...document.querySelectorAll('.screen ul.list > li > button.row')].find((r) => r.querySelector('.t1')?.textContent === 'Maison'); b.click(); return true; })()`);
      await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Vérifier l’adresse')`, 5_000, 'bouton « Vérifier l’adresse »');
      check((await page.text('main')).includes('Texte enregistré avec la version précédente : « Namur ».'), 'ancien texte rappelé');
    });
    await phoneStep(page, 'legacy-verify', async () => {
      await page.clickText('Vérifier l’adresse');
      await page.waitFor(`document.querySelector('input[role=combobox]')?.value === 'Namur' && document.querySelectorAll('[role=listbox] [role=option]').length > 0`, 10_000, 'champ prérempli avec l’ancien texte');
    });
  });
}

/* ------------------------------ « ★ garder ce trajet » depuis ma position (Chrome, accéléré) ------------------------------ */

async function keep(): Promise<void> {
  await withChrome(async (page) => {
    await phoneStep(page, 'arrival-keep', async () => {
      await page.goto(pageUrl({ ...P12({ ...S3, mockNow: '2026-11-10T14:05:00+01:00' }), mockSpeed: '20', mockPath: PATH_S3 }, '#/recherche'));
      await page.waitFor(`!!document.querySelector('#r-arrivee')`, 15_000);
      await page.type('#r-arrivee', 'gand-saint-pierre');
      await pick(page, 'r-arrivee', 'Gand-Saint-Pierre', 'gare SNCB');
      await page.waitFor(`document.querySelectorAll('.result').length >= 1`, 15_000, 'cartes vers Gand-Saint-Pierre');
      const n = page.screens().length;
      await page.click('.result:nth-child(1) button.btn-glasses');
      await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 20_000, 'trajet suivi dans les lunettes', n);
      const a = await page.waitScreen((s) => s.screen === 'arrival', 150_000, 'aide à l’arrivée (accéléré)', n);
      check(a.title === 'Arrivée à Gand-Saint-Pierre' && hint(a) === H.arrival, `« ${a.title} », aide « ${hint(a)} »`);
      const m = page.screens().length;
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'arrival' && hint(s) === '★ Trajet ajouté aux favoris', 6_000, '« ★ Trajet ajouté aux favoris »', m);
      await sleep(2_900);
      const k = page.screens().length;
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'arrival' && hint(s) === '★ Déjà dans les favoris', 6_000, 'seconde fois : « ★ Déjà dans les favoris »', k);
      // Parti de « Ma position » : un lieu (PRD-1.2 § 2.3), pas un trajet fixe
      await hashGo(page, '#/favoris');
      const rows = await waitRows(page, 7);
      check(rows[6].t1 === 'Gand-Saint-Pierre' && rows[6].t2 === 'Près de Gand-Saint-Pierre', `nouveau lieu en fin de liste : ${rowText(rows[6])}`);
      check(rows.filter((r) => /Gand-Saint-Pierre/.test(r.t1)).length === 2, 'un seul lieu ajouté (le trajet fixe Bruxelles-Central → Gand-Saint-Pierre reste)');
      return { glasses: page.lastScreen() };
    });
  });
}

/* ------------------------------ Quai Web : rubrique « Position » avec une adresse (PRD-1.2 § 3) ------------------------------ */

async function webPosition(): Promise<void> {
  const url = pageUrl({ mockNow: S1.mockNow, ...preset('p/empty.json')({}) }, '', { app: webApp.url });
  const status = (page: Page) => page.eval<string>(N("document.querySelector('.w-pos-box .w-pos-status')?.textContent"));
  await withChrome(async (page) => {
    await phoneStep(page, 'position-denied', async () => {
      await page.permission('geolocation', 'denied');
      await page.goto(url);
      await page.waitFor(`/^Position refusée par le navigateur\\./.test(${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")})`, 15_000, '« Position refusée par le navigateur. »');
      const t = await page.text('.w-pos-box');
      check(t.includes('Choisir une adresse, une gare ou un arrêt') && t.includes('Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé.'), `champ et mention : ${t}`);
      check((await page.eval<string>(`document.querySelector('#w-pos-q')?.placeholder`)) === 'Adresse, gare ou arrêt', 'texte d’exemple « Adresse, gare ou arrêt »');
      return { glasses: page.lastScreen() };
    });
    await phoneStep(page, 'position-address', async () => {
      await stack.geoJournalReset();
      const n0 = page.screens().length;
      await page.type('#w-pos-q', 'rue du progrès 20');
      await pick(page, 'w-pos-q', 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 'adresse');
      await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === 'Position choisie : Rue du Progrès 20. Gardée dans ce navigateur.'`, 8_000, '« Position choisie : Rue du Progrès 20. Gardée dans ce navigateur. »');
      const t = await page.text('.w-pos-box');
      check(t.includes('Choisir un autre endroit') && t.includes('Revenir à la position du navigateur'), `liens : ${t}`);
      const journal = await stack.geoJournal();
      const leaks = journal.filter((j) => Object.entries(j.params).some(([k, v]) => /lat|lon|^x$|^y$|pos|near|id/i.test(k) || /50\.\d{3}|4\.\d{3}/.test(v)));
      check(journal.length > 0 && !leaks.length, `requêtes d’adresses : seul le texte tapé (${journal.length} requêtes, ${leaks.length} avec position)`);
      // « Autour de moi » est centré là (CA-3.1) : accueil sans favori, « Près de Bruxelles-Nord » (tram Gare du Nord à
      // 200 m de la rue du Progrès 20), arrêts comptés autour de l'adresse
      const h = await page.waitScreen((s) => s.screen === 'home' && loaded(s) && /^Près de /.test(s.lines[0] ?? '') && /^Autour de moi {3}\d+ arrêts?$/.test(s.lines[2] ?? ''), 20_000, 'accueil des lunettes centré sur l’adresse', n0);
      check(h.lines[0] === 'Près de Bruxelles-Nord' && h.lines[1] === 'Ajouter un favori', `accueil sans favori : ${JSON.stringify(h.lines)}`);
      const n = page.screens().length;
      await page.gesture('down', '.w-gestures');
      await page.gesture('tap', '.w-gestures');
      const near = await page.waitScreen((s) => s.screen === 'nearby' && loaded(s), 15_000, 'Autour de moi', n);
      const dist = (re: RegExp) => Number(/ {3}(\d+) m /.exec(near.lines.find((l) => re.test(l)) ?? '')?.[1] ?? NaN);
      check(dist(/^Gare du Nord, tram /) <= 250 && dist(/^Rogier, métro /) <= 450, `Autour de moi centré sur l’adresse : ${JSON.stringify(near.lines)}`);
      return { deliver: 'w01', glasses: near };
    });
    await phoneStep(page, 'position-kept', async () => {
      await page.reload();
      await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === 'Position choisie : Rue du Progrès 20. Gardée dans ce navigateur.'`, 15_000, 'position gardée au rechargement');
      const s = await status(page);
      check(s === 'Position choisie : Rue du Progrès 20. Gardée dans ce navigateur.', `« ${s} »`);
    });
    await phoneStep(page, 'position-geo-down', async () => {
      await stack.geoScene('down');
      try {
        await page.clickText('Choisir un autre endroit', '.w-pos-box');
        await page.type('#w-pos-q', 'rue de fer 25 namur');
        await page.waitFor(`${N("document.querySelector('#w-pos-q-etat')?.textContent")} === 'Adresses indisponibles pour l’instant : gares et arrêts seulement.'`, 10_000, 'service d’adresses en panne : gares et arrêts seulement');
        await page.type('#w-pos-q', 'namur');
        await pick(page, 'w-pos-q', 'Namur', 'gare SNCB');
        await page.waitFor(`${N("document.querySelector('.w-pos-box .w-pos-status')?.textContent")} === 'Position choisie : Namur (gare SNCB). Gardée dans ce navigateur.'`, 8_000, 'gare choisie en panne des adresses');
      } finally {
        await stack.geoScene('base');
      }
    });
  });
}

/* ------------------------------ Réouverture de Quai (Chrome : stockage gardé) ------------------------------ */

async function reopen(): Promise<void> {
  for (const [name, P] of [['news-once-1.0', P10], ['news-once-1.1', P11]] as const) {
    await withChrome(async (page) => {
      await phoneStep(page, name, async () => {
        await page.goto(pageUrl(P(S1), '#/'));
        await page.waitScreen((s) => s.screen === 'message' && s.title === 'Quai 1.2', 20_000, 'message « Quai 1.2 »');
        const t = await waitText(page, new RegExp(`${BANNER.replace(/[.()]/g, '\\$&')}\\s*OK`), 'bannière du téléphone');
        check(!t.includes('Bienvenue'), 'pas d’écran « Bienvenue » après la mise à jour');
        await page.gesture('tap');
        await page.waitScreen((s) => s.screen === 'home', 15_000, 'accueil après « continuer »');
        // Réouverture : même page sans remise à zéro (le stockage local garde les réglages).
        const n = page.screens().length;
        await page.goto(pageUrl({ ...S1 }, '#/'));
        const h = await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil à la réouverture', n);
        check(!page.screens().slice(n).some((s) => s.title === 'Quai 1.2'), '« Quai 1.2 » revenu à la réouverture (CA-3.2)');
        check(!(await page.text('main')).includes(BANNER), 'bannière revenue à la réouverture (CA-3.2)');
        check((h.order as string[] | undefined)?.length === 6, `favoris gardés à la réouverture : ${JSON.stringify(h.order)}`);
        return { glasses: h };
      });
    });
  }
  await withChrome(async (page) => {
    await phoneStep(page, 'fresh-install', async () => {
      await page.goto(pageUrl({ ...S1, reset: '1' }, '#/'));
      await page.waitScreen((s) => s.screen === 'message' && s.lines[0] === WELCOME[0], 20_000, 'bienvenue');
      await page.clickText('Continuer');
      await page.waitFor(`document.querySelector('h1')?.textContent === 'Tes favoris'`, 5_000);
      await page.clickText('Plus tard');
      await page.waitScreen((s) => s.screen === 'home' && s.lines.includes('Ajouter un favori'), 15_000, 'accueil sans favori (CA-S1.3)');
      check(!(await page.text('main')).includes(BANNER), 'jamais la bannière après une nouvelle installation');
      const n = page.console.length;
      await page.goto(pageUrl({ ...S1 }, '#/'));
      await page.waitScreen((s) => s.screen === 'home', 20_000, 'accueil à la réouverture');
      const later = page.console.slice(n).filter((l) => l.text.startsWith('QUAI_SCREEN ')).map((l) => JSON.parse(l.text.slice(12)) as GlassesScreen);
      check(!page.screens().some((s) => s.title === 'Quai 1.2'), 'jamais « Quai 1.2 » après une nouvelle installation (CA-3.2)');
      check(!later.some((s) => s.lines[0] === WELCOME[0]), 'bienvenue pas reprise');
      check(!(await page.text('main')).includes(BANNER), 'jamais la bannière à la réouverture');
      return { glasses: page.lastScreen() };
    });
  });
  await withChrome(async (page) => {
    await phoneStep(page, 'resume', async () => {
      await page.goto(pageUrl({ ...P12(S1), mockSpeed: '20' }, '#/'));
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
      const st = await page.waitScreen((s) => s.screen === 'steps' && s.followed === true, 8_000, 'étapes du trajet en cours', m);
      check(st.label === 'short', `étiquette du trajet repris « ${st.label} »`);
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
      await page.goto(pageUrl(P12(S1), '#/'));
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
      await page.goto(pageUrl(P12(S2), '#/favoris'));
      const before = await page.waitFor<string>(`document.querySelector('main')?.innerText.includes('Gare du Nord, tram') && document.querySelector('main').innerText`, 10_000);
      await page.waitScreen((s) => s.screen === 'board' && /★$/.test(s.title), 20_000, 'départs du favori ouverts seuls');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'board' && s.lines[s.lines.length - 1] === '★ Retiré. Toucher encore : annuler', 5_000, 'retiré');
      await page.gesture('tap');
      await page.waitScreen((s) => s.screen === 'board' && s.lines[s.lines.length - 1] === '★ Favori rétabli', 5_000, 'rétabli');
      await page.goto(pageUrl({ ...S2 }, '#/favoris'));
      const after = await page.waitFor<string>(`document.querySelector('main')?.innerText.includes('Gare du Nord, tram') && document.querySelector('main').innerText`, 10_000);
      check(after === before, `liste des favoris identique (place, lignes, réglage) :\n${before}\n≠\n${after}`);
      await hashGo(page, '#/favoris/fav-gdn');
      await waitText(page, /Modifier le favori[\s\S]*Le proposer à l’ouverture/, 'écran du favori fav-gdn (même identifiant)');
      await page.waitFor(`document.querySelector('input[type=search]')?.value === 'Gare du Nord, tram (STIB)'`, 8_000, 'nom de l’arrêt avec son mode');
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
    ['phone-home.png', PNICE(S3), '#/', 'Accueil du téléphone : « Où vas-tu ? » et « Mes favoris », lieux compris'],
    ['phone-places.png', PNICE(S1), '#/favoris/fav-maison', 'Un lieu de « Mes favoris » : nom, adresse et accès, créneau (remplace « Mes lieux » de la 1.1)'],
    ['phone-favorites.png', PNICE(S3), '#/favoris', 'Mes favoris : lieux, arrêts et trajets fixes dans une seule liste'],
    ['phone-favorite-edit.png', P12(S2), '#/favoris/fav-gdn', 'Modifier un arrêt favori'],
    ['phone-display.png', P12(S2), '#/affichage', 'Affichage, avec « Ordre des favoris »'],
    ['phone-alerts.png', P12(S1), '#/alertes', 'Alertes'],
    ['phone-data.png', P12(S2), '#/donnees', 'Données, avec « Version de Quai » et « Adresses »'],
    ['phone-search.png', P12(S3), '#/recherche?q=Gand', 'Recherche « Gand » dans le champ unique'],
    ['phone-search-results.png', P12(S3), '#/recherche?de=sncb:8813003&vers=sncb:8892007', 'Trajets Bruxelles-Central vers Gand-Saint-Pierre'],
  ];
  const { dir } = await buildFixtureData({ date: '2026-11-01' });
  const old = await startDataServer(dir);
  try {
    await withChrome(
      async (page) => {
        for (const [file, params, hash, what, data] of [...shots, ['phone-data-stale.png', P12(S2), '#/donnees', 'Données quand la mise à jour de nuit est en panne', old.url] as const]) {
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
  ['s1', 'le matin à Namur : accueil, étapes « Le plus court », pages, suivre un autre trajet, Autres favoris, Aller à… (lieux), sortie', s1],
  ['s1noRT', 'le matin, temps réel indisponible : ligne du haut, « Le plus court : direct, à pied 7 + 12 min », « Le suivant »', s1noRT],
  ['s1run', 'trajet suivi en accéléré : en cours, dans le train, descente, fin', s1run],
  ['s1stay', 'l’IC part sans l’utilisateur : le trajet en cours prend fin', s1stay],
  ['s2', 'gare du Nord : départs du favori, retrait annulable, accueil, Autres favoris, panne du temps réel', s2],
  ['s3', 'l’après-midi vers Gand : réponse, étapes, étiquettes, détail du train', s3],
  ['s3run', 'vers Gand en accéléré : dans le train, aide à l’arrivée, « ★ garder ce trajet » déjà gardé', s3run],
  ['waterloo', 'Waterloo vers la rue du Progrès : le plus court, moins de marche, le suivant', waterloo],
  ['news', 'mise à jour depuis la 1.0 et la 1.1 : message « Quai 1.2 », favoris migrés, lieux dans « Aller à… »', news],
  ['firstrun', 'premier lancement : bienvenue, accueil sans favori, liste vide, sortie', firstrun],
  ['errors', 'horaires injoignables puis nouvel essai, relais muet, aucun arrêt', errors],
  ['stale', 'horaires périmés', stale],
  ['late', '23:30 : départs de demain', late],
  ['phone', 'téléphone (Chrome) : migration, Mes favoris, Nouveau favori, cartes, Garder en favori, champ, ordre, données, premier lancement', phone],
  ['keep', '« ★ garder ce trajet » depuis ma position (Chrome, accéléré) : un lieu', keep],
  ['web', 'Quai Web (Chrome) : rubrique « Position » avec une adresse, gardée au rechargement', webPosition],
  ['reopen', 'réouverture de Quai (Chrome) : « Quai 1.2 » une fois depuis la 1.0 et la 1.1, trajet repris, fin du trajet, retrait annulé à l’identique', reopen],
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
  const distWeb = join(tmp, 'dist-web');
  console.log('Construction de l’appli et de Quai Web (vite build)…');
  const b = await run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: APP });
  if (b.code !== 0) throw new Error(`vite build en échec\n${b.stdout}\n${b.stderr}`);
  // Quai Web : adresses de build fictives (https exigé), remplacées dans la page par ?e2e=1&data=…&relay=…
  const bw = await run('npx', ['vite', 'build', '--config', 'vite.web.config.ts', '--outDir', distWeb, '--emptyOutDir'], {
    cwd: APP,
    env: { ...process.env, QUAI_DATA_BASE: 'https://donnees.quai-test.invalid', QUAI_RELAY_BASE: 'https://relais.quai-test.invalid', QUAI_WEB_BASE: '/' },
  });
  if (bw.code !== 0) throw new Error(`vite build de Quai Web en échec\n${bw.stdout}\n${bw.stderr}`);
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
  // Réglages de test, tous au format de la 1.1 (v2) : la 1.2 les migre au lancement (PRD-1.2 § 2.4).
  const p11 = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', 'preset-1.1.json'), 'utf8')) as Record<string, unknown> & { places: Record<string, unknown>[] };
  const p12 = { ...p11, seenVersion: '1.2.0' };
  const recent = [
    { label: 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', lat: 50.8582, lon: 4.36, at: Date.parse('2026-11-09T18:20:00+01:00') },
    { label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: Date.parse('2026-11-08T10:05:00+01:00') },
    { label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, at: Date.parse('2026-11-07T16:40:00+01:00') },
  ];
  const presets = join(tmp, 'p');
  mkdirSync(presets);
  const write = (name: string, x: unknown) => writeFileSync(join(presets, name), JSON.stringify(x));
  write('1.2.json', p12);
  write('recent.json', { ...p12, recent });
  write('phone.json', {
    ...p12,
    places: [...p11.places, { id: 'lieu-piscine', label: 'Piscine de Bruxelles', lat: 50.852, lon: 4.3555, address: 'Rue Neuve, 1000 Bruxelles', src: 'address', approx: true }],
    recent: [{ label: 'Boulevard du Centenaire 1, 1020 Bruxelles', lat: 50.8915, lon: 4.334, at: Date.parse('2026-11-09T18:20:00+01:00') }],
  });
  write('empty.json', { ...p12, places: [], favorites: [], recent: [] });
  write('nice.json', {
    ...p12,
    places: [
      { id: 'maison', label: 'Maison', lat: 50.4662, lon: 4.8648, address: 'Rue de Fer 25, 5000 Namur', src: 'address' },
      { id: 'bureau', label: 'Bureau', lat: 50.8582, lon: 4.36, address: 'Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', src: 'address' },
    ],
    recent: recent.slice(1),
  });
  const extra = {
    '/preset.json': join(ROOT, 'fixtures', 'app', 'preset.json'),
    '/preset-1.1.json': join(ROOT, 'fixtures', 'app', 'preset-1.1.json'),
    ...Object.fromEntries(readdirSync(presets).map((f) => [`/p/${f}`, join(presets, f)])),
  };
  web = await startStatic(dist, extra);
  webApp = await startStatic(distWeb, extra);
  sim = new Sim(PORT, SHOTS);
  console.log(`Données ${night.url} ; relais ${stack.relay.url} ; adresses ${stack.geo.url} ; appli ${web.url} ; Quai Web ${webApp.url} ; simulateur :${PORT}`);
  const t0 = Date.now();
  try {
    for (const [id, label, fn] of SCENARIOS) await runScenario(id, label, fn);
  } finally {
    await sim.stop();
    await web.close();
    await webApp.close();
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
    writeFileSync(path, JSON.stringify({ version: '1.2.0', how: 'tests/e2e : npm run sim -- --tour (vrai cœur, données des fixtures)', screens: [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
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
