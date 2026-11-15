/**
 * Quai 1.3.0 : scénarios de bout en bout du simulateur (préfixe s130), écrits d'après docs/v1.3.0/PRD-1.3.0.md seul,
 * avant la fusion des équipes (textes exacts du PRD ; formulations laissées aux équipes : seulement leur sujet).
 *
 *  - Simulateur Even Hub (vraies captures 576 × 288, contrôle au pixel) : ligne d'action de l'écran du trajet (§ 1),
 *    ▲ depuis la première rangée de « Autres trajets » (§ 2), favoris en accordéon (§ 7), « toucher : où descendre »
 *    (§ 3) ; avec l'hôte simulé (lib/host.ts : capteur de mouvement, état des lunettes, page du téléphone) : test de
 *    l'écran (§ 6.1), rappel d'un message important à 45 s et « vu » (§ 6.2), vérification au départ, batterie basse
 *    (§ 6.3).
 *  - Quai Web dans Chrome (positions poussées, horloge pilotée, comme les s1210) : « ▶ Retour au guidage », réglage
 *    éteint (§ 1), hors de Belgique (§ 4 : données des fixtures avec la gare de Luxembourg, desservie depuis Namur),
 *    journal de trajet (§ 6.4 : jamais de coordonnées ni d'adresse).
 *
 * Joués avec les attentes 1.3.0 (défaut de run-sim.ts depuis la fusion de toutes les équipes : `npm run sim`, ou
 * `npm run sim -- --only 's130*'`) ; pas avec `--spec 1.2.10`. Lieux publics seulement (places, gares).
 * Captures : tests/e2e/screens/<scénario>-<étape>.png.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFeeds, feedZip, loadNetwork } from '../../../fixtures/pipeline/make-gtfs';
import { hostCalls, type HostBridge, type HostCall, type Pose } from '../lib/host';
import type { Screen, Sim } from '../lib/sim';
import { buildFixtureData, buildWalkTiles, GTFS } from '../lib/stack';
import { distM, joinTrace, pointAt, stay, walk, type LatLon, type Trace, type TracePoint } from '../traces/geo';
import { NAMUR_FONTAINAS, PLACES, toFix } from '../traces/traces';
import type { GlassesScreen, Page } from './cdp';
import * as O from './guide-oracle';
import { canvasToShot, checkGuidePixels, litCount, type GuideShot } from './guide-pixels';
import { accordionLines, checkPixels, levels, truncatedLines } from './pixels';
import type { Ctx } from './s1210';

/** Ce que run-sim.ts prête en plus aux scénarios 1.3.0. */
export interface Ctx130 extends Ctx {
  /** Hôte simulé du simulateur Even Hub (capteur, état des lunettes, page du téléphone). */
  host: HostBridge;
  /** Page de l'appli Even pour le simulateur, servie avec le script de l'hôte simulé (`e2eHost=1`). */
  hostUrl(params: Record<string, string | undefined>): string;
  /** Page (appli Even ou Quai Web) avec d'autres données que celles des fixtures (`data`). */
  pageUrlWith(params: Record<string, string | undefined>, web: boolean, data: string): string;
  /** Publie un dossier de données comme la nuit du 10/11 (04:12) et le sert ; arrêté en fin de passage. */
  serveData(dir: string): Promise<string>;
  /** Scène du faux portail BMC (« noRT » : sans temps réel), cache du relais vidé. */
  scene(s: 'base' | 'noRT'): Promise<void>;
}

class Check extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Check(msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hint = (s: { lines: string[] }) => s.lines[s.lines.length - 1];
const field = <T>(s: object, k: string) => (s as Record<string, T>)[k];
const show = (s: { screen: string; title: string; clock?: string; lines: string[] } | undefined) => (s ? `${s.screen} « ${s.title} » ${s.clock ?? ''} ${JSON.stringify(s.lines)}` : 'aucun écran');
const loaded = (s: { lines: string[] }) => !s.lines.some((l) => l.endsWith('…') || /^Chargement|^Recherche|^Calcul/.test(l));
const T = (hhmmss: string) => Date.parse(`2026-11-10T${hhmmss.length === 5 ? `${hhmmss}:00` : hhmmss}+01:00`);

/* ------------------------------ Textes du PRD 1.3.0 (l'oracle, indépendant du code) ------------------------------ */

export const TXT = {
  /** § 1 : ligne d'action de l'écran du trajet, au plus clair, juste au-dessus des aides. */
  go: '▶ Y aller',
  guided: '▶ Retour au guidage',
  follow: '▶ Suivre ce trajet',
  followed: '▶ Trajet suivi',
  steps: '△▽ étapes   double : retour',
  /** § 2 : les aides de « Autres trajets » ne changent pas. */
  others: '△▽ choisir   toucher : voir   double : retour',
  /** § 3 */
  board: '△▽ départs   toucher : où descendre   double : retour',
  line: '△▽ passages   toucher : où descendre   double : retour',
  /** 1.2.10, inchangé : le toucher ouvre toujours les arrêts du départ, où l'on choisit « j'y descends ». */
  stops: '△▽ arrêts   toucher : j’y descends   double : retour',
  favorites: '△▽ choisir   toucher : ouvrir   double : retour',
  moment: 'toucher : effacer   appui long : arrêter',
  /** § 4 */
  offMap: 'Hors de Belgique',
  offMapArrow: 'pas de chemin à pied : suis la flèche',
  offMapNoHeading: 'pas de chemin à pied',
  offMapWhere: 'hors de Belgique, pas de chemin à pied',
  /** § 6.1 */
  testButton: 'Tester l’écran des lunettes',
  testWait: 'Mets tes lunettes, regarde devant toi, la tête droite, et ne touche à rien pendant 45 secondes',
  testTitle: 'Test de l’écran',
  testDontTouch: 'Ne touche à rien',
  testSent: 'Touche une fois les lunettes',
  testAsk: 'Lève la tête. Que vois-tu dans les lunettes ?',
  answers: { quai: 'Le test de Quai', dashboard: 'Le Dashboard', nothing: 'Rien' },
  testVisible: 'Les messages de Quai se voient sans rien faire. S’il le faut, Quai les rappelle.',
  testHeadUp: 'Lève un peu la tête pour voir les messages. Pour le moindre mouvement : dans l’appli Even, règle l’angle d’affichage au plus bas.',
  testDashboard: 'En levant la tête, tu vois le Dashboard. Pendant un trajet, touche une fois les lunettes pour voir Quai.',
  testCancel: 'Arrêter le test',
  testClosed: 'Ouvre Quai sur les lunettes, puis recommence.',
  /** § 6.3 */
  battery: (n: number) => `Lunettes : ${n} % de batterie`,
  /** § 6.4 */
  journalCard: 'Journal des trajets',
  journalCopy: 'Copier',
  journalClear: 'Effacer le journal',
} as const;

/** § 6.2 : messages importants (rappelés s'ils ne sont pas vus). */
const IMPORTANT = new Set(['leave', 'board', 'platform', 'alight', 'replan', 'passed']);
/** Comparaison : espaces insécables, apostrophes, point final facultatif (« Ne touche à rien » / « Ne touche à rien. »). */
const same = (got: string | undefined, want: string) => O.norm(got).replace(/\.$/, '') === O.norm(want).replace(/\.$/, '');

/* ------------------------------ Situations et préréglages (lieux publics) ------------------------------ */

/** Place de l'Ange à Namur, mardi 10/11/2026 à 07:20 (scénarios s1210). */
const START = { mockLat: String(PLACES.placeAnge.lat), mockLon: String(PLACES.placeAnge.lon), mockNow: '2026-11-10T07:20:00+01:00' };
/** Gare du Nord (Bruxelles), 12:10 : les départs de l'arrêt repère du tram 3 s'ouvrent seuls (scénario s2). */
const S2 = { mockLat: '50.86', mockLon: '4.359', mockNow: '2026-11-10T12:10:00+01:00' };
/** Waterloo, chaussée de Bruxelles (scénario 4 des fixtures), 07:31 : « Bureau » a deux autres trajets. */
const WAT = { mockLat: '50.7175', mockLon: '4.399', mockNow: '2026-11-10T07:31:00+01:00' };
const FONTAINAS = 'Place Fontainas';

/**
 * Hors de Belgique (§ 4) : la gare de Luxembourg (CFL), desservie depuis Namur par l'IC Bruxelles-Luxembourg,
 * ajoutée aux fixtures pour ce scénario seulement ; la place de Paris (Luxembourg-ville, place publique)
 * à 550 m environ. Les tuiles piétonnes des tests ne couvrent que Namur et Bruxelles : la marche vers la gare n'a pas
 * de chemin (raison `outside`), celle de la gare de Namur à la place de l'Ange en a un.
 */
const LUX = {
  station: { lat: 49.59996, lon: 6.13336 },
  placeDeParis: { lat: 49.6048, lon: 6.1327 },
  /** avenue de la Liberté, de la place de Paris à la gare */
  path: [
    { lat: 49.6048, lon: 6.1327 },
    { lat: 49.6036, lon: 6.1329 },
    { lat: 49.6024, lon: 6.1331 },
    { lat: 49.6012, lon: 6.1333 },
    { lat: 49.59996, lon: 6.13336 },
  ] as LatLon[],
  /** IC de Luxembourg à Namur (voyage ajouté), départ 07:02 voie 3, Namur 08:47 voie 5 */
  dep: '07:02',
  arr: '08:47',
};
/** Position à 06:45, place de Paris (le départ à pied conseillé vient quelques minutes plus tard). */
const LUX_START = { mockLat: String(LUX.placeDeParis.lat), mockLon: String(LUX.placeDeParis.lon), mockNow: '2026-11-10T06:45:00+01:00' };
/**
 * De la place de Paris à la gare de Luxembourg, à pied, avec vitesse et cap (le moteur connaît la direction) : sur place
 * jusqu'à l'heure de partir calculée par le cœur (`leaveAt`), puis en marche 20 s plus tard.
 */
function luxWalk(leaveAt: number): Trace {
  return {
    id: 'LUX_GARE',
    label: 'Luxembourg, place de Paris → gare (à pied, sans chemin : hors de Belgique)',
    points: joinTrace(stay(LUX.placeDeParis, T('06:45'), leaveAt + 10_000, { everyS: 20 }), walk(LUX.path, leaveAt + 20_000, { speed: 1.3, everyS: 10 })),
  } as unknown as Trace;
}

/** Préréglages des s130 (écrits par run-sim.ts dans p/), d'après ceux de la 1.2.10. */
export function presets130(base: { p1210: Record<string, unknown>; pcur: Record<string, unknown> }): Record<string, unknown> {
  const p = base.p1210 as { places: unknown[]; favorites: unknown[]; display?: Record<string, unknown> };
  const ange = { id: 'ange', label: 'Place de l’Ange', lat: PLACES.placeAnge.lat, lon: PLACES.placeAnge.lon, address: 'Place de l’Ange, 5000 Namur', src: 'address' };
  const gare = { id: 'gare-namur', label: 'Gare de Namur', lat: 50.4681, lon: 4.8628, address: 'Place de la Station, 5000 Namur', src: 'address' };
  const disp = (base.pcur as { display?: Record<string, unknown> }).display ?? {};
  return {
    // § 7 : un lieu où l'on est (tu y es : rien ne s'ouvre) et un lieu à pied seulement, en plus des favoris de la 1.2.10
    '130fav.json': {
      ...base.p1210,
      places: [...p.places, ange, gare],
      favorites: [...p.favorites, { kind: 'trip', id: 'fav-gare-namur', from: { type: 'here' }, to: { type: 'place', placeId: 'gare-namur' }, label: 'Gare de Namur', propose: 'never' }, { kind: 'trip', id: 'fav-ange', from: { type: 'here' }, to: { type: 'place', placeId: 'ange' }, label: 'Place de l’Ange', propose: 'never' }],
    },
    // § 4 : de Luxembourg vers la place de l'Ange (Namur)
    '130lux.json': {
      ...base.pcur,
      places: [ange],
      favorites: [{ kind: 'trip', id: 'fav-ange', from: { type: 'here' }, to: { type: 'place', placeId: 'ange' }, label: 'Place de l’Ange', propose: 'morning' }],
      recent: [],
    },
    // § 6.2 : mouvement « lever la tête » appris (axe y, vers le haut, écart 0,5), messages visibles ; contrôle technique :
    // avec la position de repos apprise (la pose REST), référence du « vu » (sans elle, le mouvement ne sert pas)
    '130seen.json': { ...base.p1210, display: { ...disp, ...(p.display ?? {}), alert: 'visible', headUp: { axis: 'y', sign: 1, delta: 0.5, rest: REST.y } } },
    // § 6.2 : en levant la tête, le Dashboard : aucun rappel
    '130dash.json': { ...base.p1210, display: { ...disp, ...(p.display ?? {}), alert: 'dashboard' } },
  };
}

/**
 * Capteur de mouvement : la tête droite (repos), levée vers l'écran des lunettes (+0,5 sur l'axe y, net : 50 fois le
 * bruit), baissée vers le téléphone pour répondre (-0,4 : la posture « téléphone », d'où l'appli tire l'axe ; le sens
 * « lever la tête » en est l'opposé, glasses/headup.ts).
 */
const REST: Pose = { x: 0.02, y: -0.98, z: 0.15 };
const HEAD_UP: Pose = { x: 0.02, y: -0.48, z: 0.15 };
const PHONE_DOWN: Pose = { x: 0.02, y: -1.38, z: 0.15 };

/* ------------------------------ Simulateur : aides ------------------------------ */

/** Rangées de « Favoris » (sans les lignes de l'accordéon, l'intitulé des adresses ni l'aide). */
function favRows(s: Screen): string[] {
  const open = accordionLines(s);
  return s.lines.slice(0, -1).filter((l) => !open.includes(l) && l !== 'ADRESSES RÉCENTES');
}

/** Écran déjà affiché qui convient, sinon le prochain journalisé. */
async function lastOrWait(sim: Sim, pred: (s: Screen) => boolean, timeout: number, label: string): Promise<Screen> {
  await sim.drain();
  if (sim.last && pred(sim.last)) return sim.last;
  return sim.waitScreen(pred, timeout, label);
}

/**
 * Double toucher jusqu'à l'accueil, un écran à la fois : jamais sur l'accueil lui-même (il quitterait Quai,
 * ShutDownPageContainer, et tous les gestes suivants seraient perdus).
 */
async function simBackHome(sim: Sim): Promise<Screen> {
  for (let i = 0; i < 6; i++) {
    await sim.drain();
    if (sim.last?.screen === 'home') return sim.last;
    await sim.input('double_click', 300);
    await sim.waitScreen(() => true, 8_000, 'écran d’avant (double toucher)');
  }
  return simHome(sim);
}

async function simHome(sim: Sim): Promise<Screen> {
  return lastOrWait(sim, (s) => s.screen === 'home' && loaded(s) && s.lines.some((l) => /^Autour de moi {3}/.test(l)), 25_000, 'accueil chargé');
}

async function simFavorites(sim: Sim): Promise<Screen> {
  await simHome(sim);
  await sim.select(0);
  await sim.input('click');
  return sim.waitScreen((s) => s.screen === 'favorites' && loaded(s), 25_000, '« Favoris » calculés');
}

/** Depuis l'accueil : « Favoris », puis le favori `name`, son écran du trajet. */
async function simOpenFavorite(sim: Sim, name: string): Promise<Screen> {
  const f = await simFavorites(sim);
  const k = favRows(f).findIndex((l) => l.startsWith(`${name}   `) || l.startsWith(`${name} !   `));
  check(k >= 0, `favori « ${name} » absent de « Favoris » : ${JSON.stringify(f.lines)}`);
  await sim.select(k);
  await sim.input('click');
  return sim.waitScreen((s) => s.screen === 'steps' && loaded(s), 20_000, `écran du trajet « ${name} »`);
}

/** Ligne d'action (la ligne juste au-dessus des aides) et ligne du bas des étapes (au-dessus d'elle). */
const actionOf = (s: { lines: string[] }) => s.lines[s.lines.length - 2];
const bottomOf = (s: { lines: string[] }) => s.lines[s.lines.length - 3];
/**
 * Pour se déplacer (pas pour vérifier) : la ligne « Fin du trajet. ▽ … » ou « ▽ suite du trajet : … » des étapes, où
 * qu'elle soit (avec ou sans ligne d'action), pour que les échecs disent ce qui manque et non un déplacement raté.
 */
const noteOf = (s: { lines: string[] }) => [...s.lines].reverse().find((l) => /^(Fin du trajet\.|▽ suite du trajet)/.test(O.norm(l))) ?? '';
/** ▼ jusqu'à « Fin du trajet » (la dernière page des étapes). */
async function simStepsEnd(sim: Sim, from: Screen): Promise<Screen> {
  let cur = from;
  for (let i = 0; i < 6 && !/^Fin du trajet\./.test(O.norm(noteOf(cur))); i++) {
    const before = noteOf(cur);
    await sim.input('down');
    cur = await sim.waitScreen((x) => x.screen !== 'steps' || noteOf(x) !== before, 8_000, 'étapes suivantes (▼)');
  }
  check(cur.screen === 'steps' && /^Fin du trajet\./.test(O.norm(noteOf(cur))), `« Fin du trajet » jamais atteint : ${show(cur)}`);
  return cur;
}

/** § 1 : aides, ligne d'action et « Fin du trajet. ▽ … » ou « ▽ suite … » juste au-dessus ; rien de coupé. */
function stepsCommon(s: GlassesScreen | Screen, action: string): void {
  check(s.screen === 'steps', `écran du trajet attendu : ${show(s)}`);
  check(same(hint(s), TXT.steps), `aides « ${hint(s)} » au lieu de « ${TXT.steps} » (PRD-1.3.0 § 1 : le toucher quitte la ligne d’aide)`);
  check(same(actionOf(s), action), `ligne d’action « ${actionOf(s)} » au lieu de « ${action} », juste au-dessus des aides (PRD-1.3.0 § 1)`);
  check(/^(Fin du trajet\. ▽ |▽ suite du trajet : )/.test(O.norm(bottomOf(s))), `« Fin du trajet. ▽ … » (ou « ▽ suite du trajet ») reste au-dessus de la ligne d’action : « ${bottomOf(s)} »`);
  check(!s.lines.slice(0, -2).some((l) => /^▶ /.test(l)), `une seule ligne d’action : ${JSON.stringify(s.lines)}`);
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées par « … » : ${JSON.stringify(cut)}`);
  const typo = O.typographyIssues([s.title, ...s.lines]);
  check(!typo.length, typo.join(' ; '));
}

/** Capture du simulateur : ligne d'action au plus clair (niveau 4 : alpha 255), comme le titre. */
async function actionBright(sim: Sim, s: Screen): Promise<void> {
  await sleep(300);
  const png = await sim.rawShot();
  const lv = levels(png, s);
  const a = lv.find((l) => l.label === 'ligne d’action');
  check(a, `ligne d’action introuvable sur la capture (bandes : ${lv.map((l) => l.label).join(', ')})`);
  check(a.alpha === 255, `ligne d’action « ${a.text} » au niveau ${a.alpha} (alpha) au lieu du plus clair (255, niveau 4, PRD-1.3.0 § 1)`);
}

/** Écran du guidage ou du test dans le simulateur : capture contrôlée au pixel (sim/guide-pixels.ts). */
async function guideShot(ctx: Ctx130, name: string, s: Screen, image: boolean): Promise<void> {
  const sim = ctx.sim();
  let shot = await sim.rawShot();
  let bad = checkGuidePixels(shot, s as unknown as GuideShot, { image });
  for (let k = 0; bad.length && k < 4; k++) {
    await sleep(400);
    shot = await sim.rawShot();
    bad = checkGuidePixels(shot, s as unknown as GuideShot, { image });
  }
  writeFileSync(join(ctx.shots, `${ctx.scenario()}-${name}${bad.length ? '-ECHEC' : ''}.png`), shot);
  check(!bad.length, `contrôle au pixel (${name}) :\n        ${bad.join('\n        ')}`);
}

/** Appels du pont notés par l'hôte simulé depuis `from` ; attend celui qui convient. */
async function waitCall(sim: Sim, from: number, pred: (c: HostCall) => boolean, timeout: number, label: string): Promise<HostCall> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sim.drain();
    const c = hostCalls(sim.entries, from).find(pred);
    if (c) return c;
    await sleep(150);
  }
  throw new Check(`délai dépassé en attendant ${label} (appels vus : ${JSON.stringify(hostCalls(sim.entries, from).map((c) => [c.m, c.on, c.pace, c.key]))})`);
}

/**
 * État des lunettes poussé par l'hôte simulé, et reçu par le SDK de la page (qui écrit « Device status changed » dans la
 * console) : la preuve que l'injection arrive, avant toute nouveauté de l'appli.
 */
async function pushDevice(ctx: Ctx130, status: Parameters<HostBridge['device']>[0]): Promise<void> {
  const sim = ctx.sim();
  await sim.drain();
  const from = sim.entries.length;
  await ctx.host.device(status);
  const t0 = Date.now();
  while (Date.now() - t0 < 4_000) {
    await sim.drain();
    if (sim.entries.slice(from).some((e) => /Device status changed/.test(e.message))) return;
    await sleep(150);
  }
  throw new Check(`état des lunettes injecté (${JSON.stringify(status)}) mais jamais reçu par le SDK de la page (« Device status changed » absent de la console)`);
}

/** Page du téléphone dans le simulateur (même WebView) : texte de <main>, clic sur un bouton par son texte, ancre. */
const NORM_JS = `const n = (t) => (t || '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/'/g, '’').replace(/\\s+/g, ' ').trim();`;
async function phoneText(host: HostBridge): Promise<string> {
  return host.eval<string>(`(() => { ${NORM_JS} return n(document.querySelector('main')?.innerText || document.body.innerText); })()`);
}
async function phoneWait(host: HostBridge, re: RegExp, timeout: number, label: string): Promise<string> {
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < timeout) {
    t = await phoneText(host);
    if (re.test(t)) return t;
    await sleep(300);
  }
  throw new Check(`téléphone : délai dépassé en attendant ${label} ; texte vu : « ${t.slice(0, 600)} »`);
}
async function phoneClick(host: HostBridge, text: string): Promise<void> {
  const ok = await host.eval<boolean>(`(() => { ${NORM_JS} const want = n(${JSON.stringify(text)}); const el = [...document.querySelectorAll('button, a, [role=button], summary')].find((e) => n(e.textContent) === want || n(e.getAttribute('aria-label')) === want); if (!el) return false; el.scrollIntoView && el.scrollIntoView(); el.click(); return true; })()`);
  check(ok, `téléphone : bouton « ${text} » introuvable`);
}
async function phoneGo(host: HostBridge, hash: string): Promise<void> {
  await host.eval(`(location.hash = ${JSON.stringify(hash)}, true)`);
  await sleep(500);
}
const reEsc = (t: string) => O.norm(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Après « Tester l'écran des lunettes », le téléphone peut d'abord présenter le test (bouton « Commencer le test » ou
 * « Recommencer le test », choix de l'équipe du téléphone) : on le lance alors.
 */
async function startIfAsked(host: HostBridge): Promise<void> {
  await sleep(700);
  await host.eval<boolean>(`(() => { ${NORM_JS} const el = [...document.querySelectorAll('button')].find((e) => /^(Commencer|Recommencer) le test$/.test(n(e.textContent))); if (el) el.click(); return !!el; })()`);
}

/** Réglages enregistrés par l'appli (setLocalStorage de quai.settings, tels que l'hôte les a reçus). */
async function savedDisplay(host: HostBridge): Promise<{ alert?: string; headUp?: { axis: string; sign: number; delta: number; rest?: number } }> {
  const raw = await host.storage('quai.settings');
  check(raw, 'quai.settings jamais enregistré par l’appli (setLocalStorage)');
  return ((JSON.parse(raw) as { display?: object }).display ?? {}) as { alert?: string; headUp?: { axis: string; sign: number; delta: number; rest?: number } };
}

/** Clé et valeur du trajet guidé (quai.trip) telles que l'appli les a enregistrées dans le simulateur. */
async function simTrip(host: HostBridge): Promise<O.OJourney> {
  // l'appli enregistre le trajet suivi par rafale : jusqu'à 8 s
  for (let k = 0; k < 40; k++) {
    const raw = await host.storage('quai.trip');
    if (raw) {
      const t = JSON.parse(raw) as { journey?: O.OJourney; guide?: unknown };
      if (t.journey?.legs?.length && t.guide) return t.journey;
    }
    await sleep(200);
  }
  throw new Check('quai.trip jamais enregistré avec un guidage (setLocalStorage vu par l’hôte simulé)');
}

/* ------------------------------ Quai Web : aides (comme sim/s1210.ts) ------------------------------ */

const CANVAS_CSS = '.w-canvas{width:576px !important;height:288px !important;max-width:none !important;max-height:none !important}';
const VIEWPORT = { width: 1280, height: 1000, dpr: 1, mobile: false };
interface Run {
  ctx: Ctx130;
  page: Page;
  mark: number;
  blocked?: string;
}
const isGuide = (s: GlassesScreen) => s.screen === 'guide';
const isEmpty = (s: GlassesScreen) => s.screen === 'guide' && !s.title && s.lines.every((l) => !l.trim());
const momentKind = (s: GlassesScreen) => (s.moment && typeof s.moment === 'object' ? String((s.moment as { kind?: unknown }).kind ?? '') : '');

async function openWeb(r: Run, url: string): Promise<GlassesScreen> {
  await r.page.goto(url);
  await r.page.addStyle(CANVAS_CSS);
  await r.page.eval(`(document.querySelector('#w-tab-lunettes')?.click(), true)`).catch(() => undefined);
  return r.page.waitScreen((s) => s.screen === 'home' && !s.lines.some((l) => /…$|^Chargement/.test(l)), 30_000, 'accueil des lunettes (Quai Web)');
}
async function gesture(r: Run, g: 'up' | 'down' | 'tap' | 'double' | 'long'): Promise<void> {
  r.mark = r.page.screens().length;
  const ok = await r.page.eval<boolean>(`(() => { const b = document.querySelector('.w-gestures button[data-g="${g}"]'); if (!b) return false; b.click(); return true; })()`);
  check(ok, `bouton du geste ${g} introuvable dans Quai Web`);
  await sleep(450);
}
async function setNow(r: Run, t: number): Promise<void> {
  const ok = await r.page.eval<boolean>(`(() => { const c = window.__quaiClock; if (!c || typeof c.set !== 'function') return false; return c.set(${t}); })()`);
  check(ok, 'crochet manquant : window.__quaiClock.set (mode e2e)');
}
async function push(r: Run, p: TracePoint): Promise<void> {
  const ok = await r.page.eval<string>(`(() => { if (typeof window.__quaiPushFix !== 'function') return 'absent'; return window.__quaiPushFix(${JSON.stringify(toFix(p))}) ? 'pris' : 'refusé'; })()`);
  check(ok === 'pris', `position ${ok === 'absent' ? 'impossible à pousser (window.__quaiPushFix absent)' : 'refusée'} (${p.lat}, ${p.lon})`);
}
async function goTo(r: Run, trace: Trace, t: number): Promise<void> {
  await setNow(r, t);
  for (const p of trace.points.filter((x) => x.at <= t).slice(-3)) await push(r, p);
  await push(r, { ...pointAt(trace.points, t), at: t });
  await sleep(350);
}
async function waitGuide(r: Run, label: string, pred: (s: GlassesScreen) => boolean, timeout = 10_000): Promise<GlassesScreen> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const all = r.page.screens();
    for (let i = all.length - 1; i >= r.mark && i >= 0; i--) if (pred(all[i])) return all[i];
    await sleep(120);
  }
  throw new Check(`délai dépassé en attendant ${label} ; dernier écran : ${show(r.page.lastScreen())}`);
}
async function webFollowed(r: Run): Promise<{ journey: O.OJourney; title: string } | null> {
  const raw = await r.page.eval<string | null>(`localStorage.getItem('quai.trip')`);
  return raw ? (JSON.parse(raw) as { journey: O.OJourney; title: string }) : null;
}
/** Depuis l'accueil de Quai Web : « Favoris », le favori `name`, son écran du trajet. */
async function webOpenFavorite(r: Run, name: string): Promise<GlassesScreen> {
  for (let i = 0; i < 4 && r.page.lastScreen()?.sel !== 0; i++) await gesture(r, 'up');
  await gesture(r, 'tap');
  const f = await waitGuide(r, '« Favoris »', (s) => s.screen === 'favorites' && loaded(s), 20_000);
  const k = favRows(f as unknown as Screen).findIndex((l) => l.startsWith(`${name}   `) || l.startsWith(`${name} !   `));
  check(k >= 0, `favori « ${name} » absent : ${JSON.stringify(f.lines)}`);
  for (let i = 0; i < 12 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
  await gesture(r, 'tap');
  return waitGuide(r, `écran du trajet « ${name} »`, (s) => s.screen === 'steps' && loaded(s), 20_000);
}
async function canvasShot(r: Run): Promise<Buffer> {
  const b64 = await r.page.eval<string>(`(() => { const c = document.querySelector('.w-canvas'); return c ? c.toDataURL('image/png').split(',')[1] : ''; })()`);
  check(b64, 'canvas des lunettes de Quai Web introuvable');
  return canvasToShot(Buffer.from(b64, 'base64'));
}
/**
 * Contrôle d'une capture du canvas : `layout` (gabarits de layout.ts, comme les s1210), `guide` et `guideImage` (écrans du
 * guidage), `empty` (écran calme) ; `capture` : seulement jamais noir (l'écran du trajet est contrôlé au pixel dans le
 * simulateur, s130action et s1 : les mots des étapes, posés au pixel près, ne se retrouvent pas avec la police du canvas).
 */
type WShot = 'layout' | 'guide' | 'guideImage' | 'empty' | 'capture';
/** Étape Quai Web : capture du canvas contrôlée au pixel, résultat dans le rapport commun. */
async function wstep(r: Run, name: string, fn: () => Promise<{ screen?: GlassesScreen; shot?: WShot } | void>, opts: { critical?: boolean } = {}): Promise<void> {
  const t0 = Date.now();
  const res: Parameters<Ctx['record']>[0] = { scenario: r.ctx.scenario(), step: name, ok: true, ms: 0 };
  const file = join(r.ctx.shots, `${res.scenario}-${name}.png`);
  if (existsSync(file)) rmSync(file);
  if (r.blocked) {
    res.ok = false;
    res.error = `non joué : ${r.blocked}`;
    console.log(`  ✗ ${res.scenario}-${name} : ${res.error}`);
    r.ctx.record(res);
    return;
  }
  try {
    const out = (await fn()) ?? {};
    if (out.screen) res.screen = out.screen;
    if (out.screen && out.shot) {
      await sleep(250);
      const buf = await canvasShot(r);
      const s = out.screen;
      const bad =
        out.shot === 'empty'
          ? litCount(buf)
            ? [`écran calme attendu, ${litCount(buf)} pixels allumés`]
            : []
          : out.shot === 'capture'
            ? litCount(buf)
              ? []
              : ['écran noir']
            : out.shot === 'layout'
            ? litCount(buf)
              ? checkPixels(buf, s, { tol: 6 })
              : ['écran noir']
            : checkGuidePixels(buf, s as unknown as GuideShot, { image: out.shot === 'guideImage', tol: 5 });
      const target = bad.length ? join(r.ctx.shots, `${res.scenario}-${name}-ECHEC.png`) : file;
      writeFileSync(target, buf);
      res.shot = target.slice(target.indexOf('tests/e2e/') + 10);
      check(!bad.length, `contrôle au pixel (${name}) :\n        ${bad.join('\n        ')}`);
    }
    console.log(`  ✓ ${res.scenario}-${name}${out.screen ? `\n      ${show(out.screen)}` : ''}`);
  } catch (e) {
    res.ok = false;
    res.error = (e as Error).message;
    if (opts.critical) r.blocked = `étape « ${name} » en échec (${res.error.split('\n')[0].slice(0, 160)})`;
    console.log(`  ✗ ${res.scenario}-${name} : ${res.error}`);
    try {
      writeFileSync(join(r.ctx.shots, `${res.scenario}-${name}-ECHEC.png`), await canvasShot(r));
    } catch {
      /* page fermée */
    }
  }
  res.ms = Date.now() - t0;
  r.ctx.record(res);
}

/** Contrôles communs d'un écran du guidage avec un moment (PRD-1.2.10 § 3.2, gardés). */
function momentCommon(s: GlassesScreen | Screen, title: string, wantHint: string = TXT.moment): void {
  check(O.norm(s.title).startsWith(O.norm(title)), `titre « ${s.title} » au lieu du titre du trajet « ${title} »`);
  check(/^\d\d:\d\d$/.test(s.clock ?? ''), `heure à droite du titre absente (« ${s.clock ?? ''} »)`);
  check(same(hint(s), wantHint), `aide « ${hint(s)} » au lieu de « ${wantHint} »`);
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées par « … » : ${JSON.stringify(cut)}`);
  const typo = O.typographyIssues([s.title, ...s.lines]);
  check(!typo.length, typo.join(' ; '));
}

/* ------------------------------ s130action : ligne d'action (§ 1) ------------------------------ */

async function s130action(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, false));
  await ctx.step('trajet-y-aller', async () => {
    // § 1 : trajet pas encore guidé, réglage « Me guider » allumé : « ▶ Y aller » au plus clair, juste au-dessus des aides
    const s = await simOpenFavorite(sim, FONTAINAS);
    stepsCommon(s, TXT.go);
    check(O.norm(bottomOf(s)) === 'Fin du trajet. ▽ 1 autre trajet', `« Fin du trajet. ▽ 1 autre trajet » reste (PRD-1.3.0 § 1), vu « ${bottomOf(s)} »`);
    check(field(s, 'followed') === false && s.sel === -1, `trajet pas guidé, sans repère : ${JSON.stringify({ followed: field(s, 'followed'), sel: s.sel })}`);
    await actionBright(sim, s);
    return { screen: s };
  });
  await ctx.step('autre-trajet-y-aller', async () => {
    // § 1 : même règle pour un autre trajet ouvert depuis « Autres trajets »
    await simStepsEnd(sim, sim.last!);
    await sim.input('down');
    await sim.waitScreen((x) => x.screen === 'others' && loaded(x), 10_000, '« Autres trajets »');
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'steps' && field(x, 'page') === 2 && loaded(x), 12_000, 'l’autre trajet');
    stepsCommon(s, TXT.go);
    return { screen: s };
  });
  await ctx.step('y-aller-lance-le-guidage', async () => {
    // le toucher ne change pas (décision 1) : « y aller », l'écran du guidage
    await sim.input('click');
    const g = await sim.waitScreen((x) => x.screen === 'guide' && x.lines.length > 1, 15_000, 'écran du guidage après « ▶ Y aller »');
    return { screen: g, shot: false };
  });
}

async function s130actionWeb(ctx: Ctx130): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await wstep(
      r,
      'trajet-y-aller',
      async () => {
        await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
        const s = await webOpenFavorite(r, FONTAINAS);
        stepsCommon(s, TXT.go);
        return { screen: s, shot: 'capture' };
      },
      { critical: true },
    );
    await wstep(r, 'retour-au-guidage', async () => {
      await gesture(r, 'tap');
      await waitGuide(r, 'écran du guidage (« ▶ Y aller »)', isGuide, 15_000);
      check(await webFollowed(r), 'aucun trajet guidé après « ▶ Y aller »');
      // menu de l'appui long, « Voir tout le trajet » : l'écran du trajet guidé
      await gesture(r, 'long');
      await waitGuide(r, 'menu de l’appui long', (s) => s.screen === 'menu');
      await gesture(r, 'down');
      await gesture(r, 'tap');
      const s = await waitGuide(r, 'écran du trajet guidé', (x) => x.screen === 'steps' && loaded(x));
      stepsCommon(s, TXT.guided);
      return { screen: s, shot: 'capture' };
    });
    await wstep(r, 'retour-au-guidage-toucher', async () => {
      await gesture(r, 'tap');
      const g = await waitGuide(r, '« ▶ Retour au guidage » : l’écran du guidage', isGuide);
      return { screen: g };
    });
    await wstep(r, 'reglage-eteint-suivre', async () => {
      // arrêter le guidage, puis « Me guider pendant un trajet » éteint (PRD-1.2.10 § 3.5)
      await gesture(r, 'long');
      await waitGuide(r, 'menu', (s) => s.screen === 'menu');
      await gesture(r, 'tap');
      await waitGuide(r, 'accueil après « Arrêter le guidage »', (s) => s.screen === 'home');
      await page.eval(`(() => { const s = JSON.parse(localStorage.getItem('quai.settings')); s.display = { ...s.display, guide: false }; localStorage.setItem('quai.settings', JSON.stringify(s)); return true; })()`);
      await openWeb(r, ctx.pageUrl({ ...START }, true));
      const s = await webOpenFavorite(r, FONTAINAS);
      stepsCommon(s, TXT.follow);
      return { screen: s, shot: 'capture' };
    });
    await wstep(r, 'reglage-eteint-trajet-suivi', async () => {
      await gesture(r, 'tap');
      // toast « Trajet suivi » (1.2.10), puis « ▶ Trajet suivi » ; aucun écran du guidage
      const s = await waitGuide(r, '« ▶ Trajet suivi »', (x) => x.screen === 'steps' && same(actionOf(x), TXT.followed) && same(hint(x), TXT.steps), 8_000);
      check(!r.page.screens().slice(r.mark).some(isGuide), 'écran du guidage ouvert alors que « Me guider » est éteint');
      stepsCommon(s, TXT.followed);
      return { screen: s, shot: 'capture' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s130up : ▲ depuis « Autres trajets » (§ 2) ------------------------------ */

async function s130up(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...WAT, ...ctx.preset('p/waterloo.json') }, false));
  let end: Screen | undefined;
  await ctx.step('autres-trajets', async () => {
    const s = await simOpenFavorite(sim, 'Bureau');
    // ▼ jusqu'à « Fin du trajet » (la dernière page), puis ▼ : « Autres trajets »
    end = await simStepsEnd(sim, s);
    await sim.input('down');
    const o = await sim.waitScreen((x) => x.screen === 'others' && loaded(x), 10_000, '« Autres trajets »');
    check(o.sel === 0 && same(hint(o), TXT.others), `curseur sur la 1re rangée, aides inchangées (« ${hint(o)} ») : ${show(o)}`);
    check(o.lines.length >= 5, `deux autres trajets attendus (Plus tôt, Le suivant) : ${JSON.stringify(o.lines)}`);
    return { screen: o };
  });
  await ctx.step('fleche-haut-2e-rangee', async () => {
    // ▲ ailleurs que sur la première rangée : le curseur monte, on reste dans la liste
    await sim.select(1);
    await sim.input('up');
    const o = await sim.waitScreen((x) => x.screen === 'others' && x.sel === 0, 8_000, '▲ : 1re rangée');
    return { screen: o, shot: false };
  });
  await ctx.step('fleche-haut-retour', async () => {
    // § 2 : ▲ sur la première rangée : le trajet proposé, à l'endroit où il était (sa dernière page, « Fin du trajet »)
    await sim.input('up');
    const s = await sim.waitScreen((x) => x.screen === 'steps', 8_000, '▲ sur la 1re rangée : le trajet proposé');
    check(end, 'écran du trajet d’avant inconnu');
    check(s.title === end.title && field(s, 'page') === 1 && field(s, 'label') === field(end, 'label'), `le trajet proposé (page 1, ${String(field(end, 'label'))}) attendu : ${show(s)} page ${String(field(s, 'page'))}`);
    // la ligne du haut (« Si tu le rates », « Départ …, dans N min ») suit l'heure : les étapes et le bas, comme avant ▼
    check(JSON.stringify(s.lines.slice(1)) === JSON.stringify(end.lines.slice(1)), `à sa dernière page, comme avant ▼ : ${JSON.stringify(s.lines)} au lieu de ${JSON.stringify(end.lines)}`);
    stepsCommon(s, TXT.go);
    return { screen: s };
  });
  await ctx.step('fleche-bas-de-nouveau', async () => {
    await sim.input('down');
    const o = await sim.waitScreen((x) => x.screen === 'others', 8_000, '▼ : de nouveau « Autres trajets »');
    check(o.sel === 0, `curseur sur la 1re rangée (sel ${o.sel})`);
    return { screen: o, shot: false };
  });
}

/* ------------------------------ s130fav : favoris en accordéon (§ 7) ------------------------------ */

/** 2e ligne de l'accordéon (PRD-1.3.0 § 7) : un souci du trajet en tête, puis « direct » ou les changements (au-delà : « … »). */
const SECOND = /^((voie \S+ au lieu de \S+|.+ supprimé), )?(direct|\d+ changements? : .+)$/;
/** Contenu attendu de l'accordéon d'une rangée de « Favoris » (PRD-1.3.0 § 7), d'après la rangée elle-même. */
function accordionWant(row: string): { n: [number, number]; first?: RegExp; label: string } {
  const answer = row.split('   ').pop() ?? '';
  if (/^(tu y es|aucun trajet|…|sur le téléphone)$/.test(answer)) return { n: [0, 0], label: '« tu y es », aucun trajet, en calcul, « Autre adresse » : rien ne s’ouvre' };
  return {
    n: [1, 2],
    // marche puis véhicule ; départ d'une gare hors de portée à pied ; à pied seulement ; adresse récente (l'adresse complète)
    first: /^(à pied \d+ min, puis .+|(IC|S\d+|L|P|EXP|bus|tram|métro|Bus|Tram|Métro)\b.* à ~?\d\d:\d\d, à .+|à pied \d+ min|.+, \d{4} .+)$/,
    label: 'marche puis véhicule, gare hors de portée, à pied seulement ou adresse',
  };
}

async function s130fav(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...START, ...ctx.preset('p/130fav.json') }, false));
  const seen: { row: string; open: string[] }[] = [];
  const checkScreen = (s: Screen, label: string): string[] => {
    check(same(hint(s), TXT.favorites), `aides « ${hint(s)} » (inchangées)`);
    check((s as unknown as { detail?: unknown }).detail === undefined, `${label} : champ « detail » encore journalisé (PRD-1.3.0 § 7 : la ligne du détail en bas et son filet disparaissent)`);
    const open = accordionLines(s);
    const rows = favRows(s);
    // la rangée du curseur : la rangée juste au-dessus des lignes ouvertes, ou la sel-ième si rien n'est ouvert
    const k = open.length ? s.lines.indexOf(open[0]) : -1;
    if (open.length) {
      const row = s.lines[k - 1];
      check(k > 0 && rows.includes(row), `${label} : lignes ouvertes pas sous une rangée : ${JSON.stringify(s.lines)}`);
      open.forEach((l, i) => check(s.lines[k + i] === l, `${label} : lignes de l’accordéon pas collées : ${JSON.stringify(s.lines)}`));
      const want = accordionWant(row);
      check(open.length >= want.n[0] && open.length <= want.n[1], `${label} : ${open.length} ligne(s) ouverte(s) sous « ${row} » (${want.label})`);
      if (want.first) check(want.first.test(O.norm(open[0])), `${label} : 1re ligne « ${open[0]} » sous « ${row} » (${want.label}, PRD-1.3.0 § 7)`);
      // 2e ligne : « direct », « 1 changement : métro 2 », « 2 changements : métro 2, tram 3 », un souci en tête
      if (open[1] !== undefined) check(SECOND.test(O.norm(open[1])), `${label} : 2e ligne « ${open[1]} » sous « ${row} » (« direct », « N changement(s) : … », un souci en tête, PRD-1.3.0 § 7)`);
      // la rangée ouverte toujours entière à l'écran : ses lignes avant l'aide
      check(k + open.length <= s.lines.length - 1, `${label} : rangée ouverte coupée par le bas de l’écran`);
      seen.push({ row: row.split('   ')[0], open });
    }
    const typo = O.typographyIssues([s.title, ...s.lines]);
    check(!typo.length, typo.join(' ; '));
    const cut = truncatedLines(s);
    check(!cut.length, `lignes coupées par « … » : ${JSON.stringify(cut)}`);
    return open;
  };
  await ctx.step('accordeon', async () => {
    const f = await simFavorites(sim);
    // le favori du curseur (Place Fontainas) s'ouvre sur deux lignes : la marche puis l'IC, puis le souci et le changement
    const open = checkScreen(f, 'Favoris');
    check(f.sel === 0 && open.length === 2 && f.lines[1] === open[0], `accordéon sous « ${FONTAINAS} » (curseur) : ${JSON.stringify(f.lines)}`);
    check(/^à pied \d+ min, puis IC ~?07:4[24]( \+2)? voie 6 !$/.test(O.norm(open[0])), `1re ligne « ${open[0]} » au lieu de « à pied 9 min, puis IC ~07:42 voie 6 ! »`);
    check(/^voie 6 au lieu de 4\b.*\b1 changement : tram 3$/.test(O.norm(open[1])), `2e ligne « ${open[1]} » : « voie 6 au lieu de 4 » en tête, puis « 1 changement : tram 3 »`);
    // relief : les lignes ouvertes pâles (plus pâles que la rangée), en retrait (contrôle au pixel de l'étape)
    await sleep(300);
    const lv = levels(await sim.rawShot(), f);
    const rowA = lv.find((l) => l.text === f.lines[0])?.alpha ?? 0;
    const openA = lv.filter((l) => open.includes(l.text)).map((l) => l.alpha);
    check(openA.length === 2 && openA.every((a) => a > 0 && a < rowA && a < 255), `lignes de l’accordéon pâles (alpha ${JSON.stringify(openA)}, rangée ${rowA})`);
    return { screen: f };
  });
  await ctx.step('accordeon-suit-le-curseur', async () => {
    // ▼ de favori en favori jusqu'au bout : un seul ouvert, sous le curseur ; le précédent refermé ; toujours entier
    let prev = sim.last!;
    const n = (field<string[]>(prev, 'order') ?? []).length + 3;
    let moves = 0;
    for (let i = 0; i < n; i++) {
      const before = prev;
      await sim.input('down');
      await sleep(350);
      await sim.drain();
      const s = sim.last!;
      if (s.sel === before.sel) break;
      moves++;
      const open = checkScreen(s, `Favoris, curseur ${s.sel}`);
      const was = accordionLines(before);
      check(!was.some((l) => s.lines.includes(l) && !open.includes(l)), `lignes du favori quitté restées ouvertes : ${JSON.stringify(s.lines)}`);
      prev = s;
    }
    check(moves >= 6, `curseur passé sur ${moves} rangées seulement`);
    // contenus vus : un trajet depuis une gare hors de portée à pied (une ligne « IC voie … à …, à Bruxelles-Central »),
    // un lieu à pied seulement (« à pied N min »), l'adresse récente (l'adresse complète), « tu y es » fermé
    const all = seen.map((x) => x.open);
    check(all.some((o) => /^IC voie \d+ !? ?à ~?\d\d:\d\d, à Bruxelles-Central$/.test(O.norm(o[0]))), `aucun favori « IC voie 4 à 09:00, à Bruxelles-Central » (gare hors de portée à pied) : ${JSON.stringify(all)}`);
    check(all.some((o) => o.length === 1 && /^à pied \d+ min$/.test(O.norm(o[0]))), `aucun favori « à pied N min » sur une seule ligne (à pied seulement) : ${JSON.stringify(all)}`);
    check(all.some((o) => o.length === 1 && O.norm(o[0]) === 'Korenmarkt, 9000 Gent'), `adresse récente sans son adresse complète sur une ligne (« Korenmarkt, 9000 Gent ») : ${JSON.stringify(all)}`);
    check(!seen.some((x) => x.row === 'Place de l’Ange' || x.row === 'Autre adresse'), `« tu y es » ou « Autre adresse » ouvert : ${JSON.stringify(seen.map((x) => x.row))}`);
    return { screen: sim.last! };
  });
  await ctx.step('accordeon-remonte', async () => {
    // ▲ jusqu'en haut : la rangée ouverte toujours entière, la liste revient au premier favori ouvert
    for (let i = 0; i < 14 && (sim.last?.sel ?? 0) > 0; i++) {
      await sim.input('up');
      await sleep(350);
      await sim.drain();
      checkScreen(sim.last!, `Favoris, curseur ${sim.last!.sel} (▲)`);
    }
    const s = sim.last!;
    check(s.sel === 0 && accordionLines(s).length === 2 && s.lines[1] === accordionLines(s)[0], `retour en haut, le premier favori ouvert : ${show(s)}`);
    return { screen: s };
  });
}

/* ------------------------------ s130board : « toucher : où descendre » (§ 3) ------------------------------ */

async function s130board(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...S2, ...ctx.preset('p/current.json') }, false));
  await ctx.step('tableau', async () => {
    const s = await sim.waitScreen((x) => x.screen === 'board' && loaded(x), 20_000, 'départs de Gare du Nord ouverts seuls');
    check(same(hint(s), TXT.board), `aides du tableau « ${hint(s)} » au lieu de « ${TXT.board} » (PRD-1.3.0 § 3)`);
    return { screen: s };
  });
  await ctx.step('tableau-toucher-arrets', async () => {
    // le toucher ne change pas : les arrêts du départ, où l'on choisit « j'y descends »
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'stops' && loaded(x) && x.lines.length > 2, 15_000, 'arrêts du départ');
    check(same(hint(s), TXT.stops), `aides des arrêts « ${hint(s)} » au lieu de « ${TXT.stops} »`);
    return { screen: s };
  });
  await ctx.step('ligne-a-son-arret', async () => {
    // « Lignes de bus, tram, métro », tout le tram 3, toucher Gare du Nord : la ligne à son arrêt (écran `line`)
    await simBackHome(sim);
    const h = await simHome(sim);
    const k = h.lines.filter((l, i) => l !== '' && !(i === 0 && /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/.test(l))).findIndex((l) => /^Lignes de bus, tram, métro {3}/.test(l));
    check(k >= 0, `« Lignes de bus, tram, métro » absent de l’accueil : ${JSON.stringify(h.lines)}`);
    await sim.select(k);
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'follows' && loaded(x), 15_000, '« Lignes de bus, tram, métro »');
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'lineRun' && loaded(x), 15_000, 'toute la ligne');
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'line' && loaded(x), 15_000, 'la ligne à son arrêt');
    check(same(hint(s), TXT.line), `aides de la ligne à son arrêt « ${hint(s)} » au lieu de « ${TXT.line} » (PRD-1.3.0 § 3)`);
    return { screen: s };
  });
  await ctx.step('ligne-toucher-arrets', async () => {
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'stops' && loaded(x) && x.lines.length > 2, 15_000, 'arrêts d’un passage');
    check(same(hint(s), TXT.stops), `aides des arrêts « ${hint(s)} » au lieu de « ${TXT.stops} »`);
    return { screen: s };
  });
}

/* ------------------------------ s130offmap : hors de Belgique (§ 4) ------------------------------ */

/** Données des fixtures avec la gare de Luxembourg et l'IC Luxembourg → Namur, tuiles piétonnes de l'extrait de test. */
async function luxembourgData(ctx: Ctx130): Promise<string> {
  const net = loadNetwork();
  net.ops.sncb.stations.push({ uic: '8200100', name: 'Luxembourg', fr: 'Luxembourg', nl: 'Luxemburg', lat: LUX.station.lat, lon: LUX.station.lon, platforms: ['3'] });
  net.ops.sncb.trips.push({ id: '88____:007::8200100:8863008:2:847:20261231', route: 'IC', service: 'DAILY', num: '2108', head: 'Namur', st: [['8200100_3', LUX.dep], ['8863008_5', LUX.arr]] });
  const tmp = mkdtempSync(join(tmpdir(), 'quai-s130-lux-'));
  writeFileSync(join(tmp, 'sncb.zip'), feedZip(buildFeeds(net).sncb));
  const sources = ['sncb', 'stib', 'delijn', 'tec'].map((op) => `${op}=${op === 'sncb' ? join(tmp, 'sncb.zip') : join(GTFS, `${op}.zip`)}`).join(',');
  const { dir } = await buildFixtureData({ sources, out: join(tmp, 'data') });
  await buildWalkTiles(dir);
  return ctx.serveData(dir);
}

async function s130offmap(ctx: Ctx130): Promise<void> {
  let data = '';
  try {
    data = await luxembourgData(ctx);
  } catch (e) {
    ctx.record({ scenario: ctx.scenario(), step: 'donnees-luxembourg', ok: false, error: (e as Error).message, ms: 0 });
    console.log(`  ✗ ${ctx.scenario()}-donnees-luxembourg : ${(e as Error).message}`);
    return;
  }
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    const title = 'Place de l’Ange';
    let j!: O.OJourney;
    /** instant (horloge simulée) où « Hors de Belgique » a paru */
    let tOff = 0;
    await wstep(
      r,
      'trajet',
      async () => {
        await openWeb(r, ctx.pageUrlWith({ ...LUX_START, ...ctx.preset('p/130lux.json') }, true, data));
        const s = await webOpenFavorite(r, title);
        check(s.lines.some((l) => /IC\b.*→ Namur/.test(O.norm(l))), `trajet par l’IC de Luxembourg à Namur attendu : ${show(s)}`);
        await gesture(r, 'tap');
        await waitGuide(r, 'écran du guidage', isGuide, 15_000);
        const ft = await webFollowed(r);
        check(ft?.journey?.legs?.[0]?.kind === 'walk', `trajet guidé qui commence à pied : ${JSON.stringify(ft?.journey?.legs?.map((l) => l.kind))}`);
        j = ft.journey;
        return { screen: s, shot: 'capture' };
      },
      { critical: true },
    );
    await wstep(r, 'hors-de-belgique', async () => {
      // § 4 : une fois, au début de la marche (après « Partir maintenant », PRIO) ; aucun virage
      const cur = r.page.lastScreen();
      if (cur && isGuide(cur) && !isEmpty(cur)) {
        await gesture(r, 'tap');
        await waitGuide(r, 'écran vide', isEmpty);
      }
      const tr = luxWalk(j.leaveAt);
      let s: GlassesScreen | undefined;
      for (let t = j.leaveAt - 5_000; t <= j.leaveAt + 180_000 && !s; t += 10_000) {
        tOff = t;
        await goTo(r, tr, t);
        const now = r.page.lastScreen();
        if (now && isGuide(now) && O.matches(now.lines[0], 'Partir maintenant')) await gesture(r, 'tap');
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && O.matches(x.lines[0], TXT.offMap));
      }
      check(s, `moment « ${TXT.offMap} » jamais affiché au début de la marche vers la gare de Luxembourg : ${show(r.page.lastScreen())}`);
      check(momentKind(s) === '' || momentKind(s) === 'offMap', `sorte du moment « ${momentKind(s)} » au lieu de offMap`);
      const walkMin = j.legs[0].walkMin ?? Math.max(1, Math.round((j.legs[0].arr - j.legs[0].dep) / 60_000));
      const arrow = O.matches(s.lines[1], TXT.offMapArrow);
      check(arrow || O.matches(s.lines[1], TXT.offMapNoHeading), `2e ligne « ${s.lines[1]} » au lieu de « ${TXT.offMapArrow} » (sans cap : « ${TXT.offMapNoHeading} »)`);
      // pâle « 7 min jusqu'à la gare de Luxembourg » : le temps de marche qui reste (à la minute près)
      const left = /^(\d+) min jusqu’à la gare de Luxembourg$/.exec(O.norm(s.lines[2]));
      check(left && Math.abs(Number(left[1]) - walkMin) <= 1, `3e ligne « ${s.lines[2]} » au lieu de « ${walkMin} min jusqu’à la gare de Luxembourg »`);
      // image : la flèche de direction si le cap est connu, sinon le panneau « à pied / N / min »
      const imgs = (s.images as { kind?: string }[] | undefined) ?? [];
      check(imgs.length === 1 && imgs[0].kind === (arrow ? 'bearing' : 'sign'), `image « ${arrow ? 'bearing (flèche)' : 'sign (à pied)'} » attendue : ${JSON.stringify(imgs)}`);
      momentCommon(s, title);
      return { screen: s, shot: 'guideImage' };
    });
    await wstep(r, 'aucun-virage', async () => {
      // toute la marche jusqu'à la gare : ni virage, ni second « Hors de Belgique »
      await gesture(r, 'tap');
      const tr = luxWalk(j.leaveAt);
      const from = r.page.screens().length;
      const walkEnd = tr.points[tr.points.length - 1].at;
      for (let t = tOff + 15_000; t <= walkEnd - 30_000; t += 15_000) await goTo(r, tr, t);
      const after = r.page.screens().slice(from).filter(isGuide);
      const turns = after.filter((x) => /^(légèrement |franchement )?(à gauche|à droite)( dans \d+ m| maintenant)$|^Fais demi-tour$/.test(O.norm(x.lines[0])) || momentKind(x) === 'turn');
      check(!turns.length, `virage annoncé sans chemin à pied (hors de Belgique) : ${turns.map(show).join(' | ')}`);
      const again = after.filter((x) => O.matches(x.lines[0], TXT.offMap));
      check(!again.length, `« ${TXT.offMap} » montré plus d’une fois : ${again.map(show).join(' | ')}`);
      return { screen: r.page.lastScreen() };
    });
    await wstep(r, 'ou-tu-en-es-hors-de-belgique', async () => {
      // « Où tu en es » à pied, hors de Belgique : la gare, la distance à vol d'oiseau et le temps, puis la raison, pâle
      const tr = luxWalk(j.leaveAt);
      const mid = j.leaveAt + 20_000 + 120_000;
      await goTo(r, tr, mid);
      const cur = r.page.lastScreen();
      if (cur && isGuide(cur) && !isEmpty(cur)) {
        await gesture(r, 'tap');
        await waitGuide(r, 'écran vide', isEmpty);
      }
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » à pied', (x) => isGuide(x) && x.lines.some((l) => /^À pied vers /.test(O.norm(l))));
      const k = w.lines.findIndex((l) => /^À pied vers /.test(O.norm(l)));
      check(O.matches(w.lines[k], 'À pied vers la gare de Luxembourg'), `« ${w.lines[k]} » au lieu de « À pied vers la gare de Luxembourg »`);
      const crow = Math.round(distM(pointAt(tr.points, mid), LUX.station));
      const m = /^(\d[\d ]*) m à vol d’oiseau, (\d+) min$/.exec(O.norm(w.lines[k + 1]));
      check(m && Math.abs(Number(m[1].replace(/ /g, '')) - crow) <= Math.max(30, crow * 0.15), `« ${w.lines[k + 1]} » au lieu de « ${crow} m à vol d’oiseau, N min » (PRD-1.3.0 § 4)`);
      check(O.matches(w.lines[k + 2], TXT.offMapWhere), `« ${w.lines[k + 2]} » au lieu de « ${TXT.offMapWhere} » (pâle)`);
      momentCommon(w, title);
      return { screen: w, shot: (w.images as unknown[] | undefined)?.length ? 'guideImage' : 'guide' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s130screen : test de l'écran (§ 6.1) ------------------------------ */

async function s130screen(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  const host = ctx.host;
  host.reset();
  await sim.launch(ctx.hostUrl({ ...START, ...ctx.preset('p/1210.json') }));
  const start = async (): Promise<number> => {
    await pushDevice(ctx, { batteryLevel: 80 });
    await host.imu(REST, 0.01);
    await phoneGo(host, '#/reglages');
    await phoneWait(host, /Pendant un trajet[\s\S]*Me guider pendant un trajet[\s\S]*Tester l’écran des lunettes/, 8_000, '« Tester l’écran des lunettes » sous « Me guider pendant un trajet » (groupe « Pendant un trajet »)');
    await sim.drain();
    const from = sim.entries.length;
    await phoneClick(host, TXT.testButton);
    await startIfAsked(host);
    return from;
  };
  const waitSent = async (from: number): Promise<Screen> => {
    // 45 s sans rien toucher, puis une nouvelle page entière « Touche une fois les lunettes »
    const g = await sim.waitScreen((x) => x.screen === 'displayTest' && x.lines.some((l) => same(l, TXT.testSent)), 55_000, `« ${TXT.testSent} » après 45 s`);
    check(hostCalls(sim.entries, from).some((c) => c.m === 'rebuildPageContainer'), `« ${TXT.testSent} » sans nouvelle page entière (rebuildPageContainer, PRD-1.3.0 § 6.1)`);
    return g;
  };
  await ctx.step('attente', async () => {
    const from = await start();
    await phoneWait(host, new RegExp(reEsc(TXT.testWait)), 8_000, `« ${TXT.testWait} »`);
    // compte à rebours (« 45 s », .test-left du téléphone ; à défaut, le premier « N s » de la page) : il diminue
    const left = async () => Number(/(\d+)\s*s\b/.exec(await host.eval<string>(`(() => { ${NORM_JS} return n(document.querySelector('.test-left')?.textContent || (document.querySelector('main') || document.body).innerText); })()`))?.[1] ?? NaN);
    const n1 = await left();
    await sleep(2500);
    const n2 = await left();
    check(Number.isFinite(n1) && Number.isFinite(n2) && n2 < n1 && n1 <= 45, `compte à rebours du téléphone (${n1} puis ${n2})`);
    const g = await sim.waitScreen((x) => x.screen === 'displayTest', 8_000, `écran « ${TXT.testTitle} » des lunettes`);
    check(same(g.title, TXT.testTitle) || g.lines.some((l) => same(l, TXT.testTitle)), `« ${TXT.testTitle} » : ${show(g)}`);
    check(g.lines.some((l) => same(l, TXT.testDontTouch)), `« ${TXT.testDontTouch} » : ${show(g)}`);
    // capteur de mouvement ouvert, une mesure toutes les 100 ms (position de repos)
    await waitCall(sim, from, (c) => c.m === 'imuControl' && c.on === true && c.pace === 100, 5_000, 'imuControl ouvert à 100 ms');
    await guideShot(ctx, 'attente', g, false);
    return { screen: g, shot: false };
  });
  await ctx.step('visible', async () => {
    const from = sim.entries.length;
    const g = await waitSent(from);
    await guideShot(ctx, 'envoi', g, false);
    // un toucher dans les 15 s : résultat « visible »
    await sim.input('click');
    await phoneWait(host, new RegExp(reEsc(TXT.testVisible)), 8_000, `« ${TXT.testVisible} »`);
    await waitCall(sim, from, (c) => c.m === 'imuControl' && c.on === false, 5_000, 'capteur fermé à la fin');
    const d = await savedDisplay(host);
    check(d.alert === 'visible', `Settings.display.alert « ${String(d.alert)} » au lieu de « visible »`);
    return { screen: g, shot: false };
  });
  await ctx.step('question-tete-levee', async () => {
    const from = await start();
    await waitSent(from);
    // pas de toucher : au bout de 15 s, la question sur le téléphone, trois réponses
    await phoneWait(host, new RegExp(reEsc(TXT.testAsk)), 22_000, `« ${TXT.testAsk} »`);
    const answers = await host.eval<string[]>(`(() => { ${NORM_JS} const box = document.querySelector('.test-answers') || document; return [...box.querySelectorAll('button')].map((b) => n(b.textContent)); })()`);
    const want: string[] = Object.values(TXT.answers);
    check(want.every((b) => answers.includes(b)) && answers.filter((b) => want.includes(b)).join('|') === want.join('|'), `boutons « ${want.join(' », « ')} », dans cet ordre : ${JSON.stringify(answers)}`);
    // la personne lève la tête vers les lunettes (2 s), puis la baisse vers le téléphone pour répondre (la dernière
    // seconde, posture « téléphone ») : Quai apprend le mouvement (axe y, vers le haut, écart 0,5)
    await host.imu(HEAD_UP, 0.01);
    await sleep(2_000);
    await host.imu(PHONE_DOWN, 0.01);
    await sleep(1_200);
    await phoneClick(host, TXT.answers.quai);
    await phoneWait(host, new RegExp(reEsc(TXT.testHeadUp)), 8_000, `« ${TXT.testHeadUp} »`);
    await waitCall(sim, from, (c) => c.m === 'imuControl' && c.on === false, 5_000, 'capteur fermé à la fin');
    const d = await savedDisplay(host);
    check(d.alert === 'headUp' && d.headUp?.axis === 'y' && d.headUp.sign === 1 && d.headUp.delta > 0.3 && d.headUp.delta < 0.7, `réglages « headUp » et le mouvement appris (axe y, sens +1, écart ≈ 0,5) : ${JSON.stringify(d)}`);
    // contrôle technique : la position de repos sur l'axe appris est enregistrée avec lui (référence du « vu »)
    check(typeof d.headUp?.rest === 'number' && Math.abs(d.headUp.rest - REST.y) < 0.02, `position de repos du mouvement appris (headUp.rest ≈ ${REST.y}) : ${JSON.stringify(d.headUp)}`);
    await host.imu(REST, 0.01);
    return { screen: sim.last, shot: false };
  });
  await ctx.step('dashboard', async () => {
    const from = await start();
    await waitSent(from);
    await phoneWait(host, new RegExp(reEsc(TXT.testAsk)), 22_000, `« ${TXT.testAsk} »`);
    await phoneClick(host, TXT.answers.dashboard);
    await phoneWait(host, new RegExp(reEsc(TXT.testDashboard)), 8_000, `« ${TXT.testDashboard} »`);
    await waitCall(sim, from, (c) => c.m === 'imuControl' && c.on === false, 5_000, 'capteur fermé à la fin');
    check((await savedDisplay(host)).alert === 'dashboard', 'Settings.display.alert « dashboard » attendu');
    return { screen: sim.last, shot: false };
  });
  await ctx.step('rien', async () => {
    const from = await start();
    await waitSent(from);
    await phoneWait(host, new RegExp(reEsc(TXT.testAsk)), 22_000, `« ${TXT.testAsk} »`);
    await phoneClick(host, TXT.answers.nothing);
    // pas de résultat ; conseil de vérifier « Head-Up » dans l'appli Even
    await phoneWait(host, /Head-Up/, 8_000, 'conseil « Head-Up » de l’appli Even');
    await waitCall(sim, from, (c) => c.m === 'imuControl' && c.on === false, 5_000, 'capteur fermé à la fin');
    check((await savedDisplay(host)).alert === 'dashboard', '« Rien » ne change pas le résultat enregistré');
    return { screen: sim.last, shot: false };
  });
  await ctx.step('arreter', async () => {
    const from = await start();
    await phoneWait(host, new RegExp(reEsc(TXT.testWait)), 8_000, `« ${TXT.testWait} »`);
    await sleep(1_500);
    await phoneClick(host, TXT.testCancel);
    await waitCall(sim, from, (c) => c.m === 'imuControl' && c.on === false, 5_000, 'capteur fermé après « Arrêter le test »');
    const s = await sim.waitScreen((x) => x.screen !== 'displayTest', 8_000, 'les lunettes quittent le test');
    return { screen: s, shot: false };
  });
  await ctx.step('quai-ferme', async () => {
    // Quai fermé sur les lunettes (déconnectées) : le test ne démarre pas, le capteur n'est jamais ouvert
    await pushDevice(ctx, { connectType: 'disconnected' });
    await sleep(600);
    await phoneGo(host, '#/reglages');
    await sim.drain();
    const from = sim.entries.length;
    await phoneClick(host, TXT.testButton);
    await startIfAsked(host);
    await phoneWait(host, new RegExp(reEsc(TXT.testClosed)), 8_000, `« ${TXT.testClosed} »`);
    await sleep(1_000);
    await sim.drain();
    check(!hostCalls(sim.entries, from).some((c) => c.m === 'imuControl' && c.on), 'capteur ouvert alors que Quai est fermé sur les lunettes');
    await pushDevice(ctx, { connectType: 'connected' });
    return { screen: sim.last, shot: false };
  });
  await ctx.step('refus-pendant-guidage', async () => {
    // décision du 15/11 (contrat DisplayTestState.error « guiding ») : le test de l'écran ne démarre pas pendant un guidage
    await sleep(800);
    await simBackHome(sim);
    await simOpenFavorite(sim, FONTAINAS);
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'guide', 15_000, 'écran du guidage');
    await phoneGo(host, '#/reglages');
    await sim.drain();
    const from = sim.entries.length;
    await phoneClick(host, TXT.testButton);
    await startIfAsked(host);
    await sleep(3_000);
    await sim.drain();
    check(!sim.screens.some((x) => x.id > (sim.entries[from - 1]?.id ?? -1) && x.screen === 'displayTest'), 'écran du test sur les lunettes pendant un guidage');
    check(!hostCalls(sim.entries, from).some((c) => c.m === 'imuControl' && c.on), 'capteur ouvert pendant un guidage');
    check(!new RegExp(reEsc(TXT.testWait)).test(await phoneText(host)), 'le téléphone lance le test pendant un guidage');
    // texte de l'équipe du téléphone (décision du 15/11, hors PRD) : arrêter d'abord le guidage
    await phoneWait(host, /Arrête d’abord le guidage en cours, puis recommence\./, 6_000, '« Arrête d’abord le guidage en cours, puis recommence. »');
    check(sim.last?.screen === 'guide', `les lunettes quittent le guidage : ${show(sim.last)}`);
    return { screen: sim.last, shot: false };
  });
}

/* ------------------------------ s130remind : rappel d'un message important (§ 6.2) ------------------------------ */

/** Lance le guidage vers la place Fontainas dans le simulateur, puis l'horloge juste avant le départ à pied. */
async function simGuideToLeave(ctx: Ctx130, preset: string): Promise<{ s: Screen; at: number; from: number }> {
  const sim = ctx.sim();
  const host = ctx.host;
  host.reset();
  await sim.launch(ctx.hostUrl({ ...START, ...ctx.preset(preset) }));
  await pushDevice(ctx, { batteryLevel: 80 });
  await host.imu(REST, 0.01);
  await simOpenFavorite(sim, FONTAINAS);
  await sim.input('click');
  await sim.waitScreen((x) => x.screen === 'guide', 15_000, 'écran du guidage');
  const j = await simTrip(host);
  // l'horloge simulée 20 s avant l'heure de partir, la position (place de l'Ange) poussée pour le recalcul ; « Où tu en
  // es » effacé : l'écran calme ; puis l'heure de partir : « Partir maintenant »
  const fix = { lat: PLACES.placeAnge.lat, lon: PLACES.placeAnge.lon, accuracy: 6 };
  await host.eval(`window.__quaiClock.set(${j.leaveAt - 20_000})`);
  await host.eval(`window.__quaiPushFix(${JSON.stringify({ ...fix, at: j.leaveAt - 20_000 })})`);
  await sleep(600);
  await sim.drain();
  if (sim.last?.screen === 'guide' && sim.last.lines.some((l) => l.trim())) {
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'guide' && !x.title && x.lines.every((l) => !l.trim()), 8_000, 'écran calme avant l’heure de partir');
  }
  await sim.drain();
  const from = sim.entries.length;
  await host.eval(`window.__quaiClock.set(${j.leaveAt + 1_000})`);
  await host.eval(`window.__quaiPushFix(${JSON.stringify({ ...fix, at: j.leaveAt + 1_000 })})`);
  const s = await sim.waitScreen((x) => x.screen === 'guide' && O.matches(x.lines[0], 'Partir maintenant'), 10_000, '« Partir maintenant » (message important)');
  return { s, at: Date.now(), from };
}

/** Pages entières envoyées depuis `from` (rebuildPageContainer noté par l'hôte simulé). */
function rebuilds(sim: Sim, from: number): number {
  return hostCalls(sim.entries, from).filter((c) => c.m === 'rebuildPageContainer').length;
}

/**
 * Lignes du mode test du rappel (contrôleur du guidage, 1.3.0) depuis `from` : `QUAI_REMIND <sorte> <n>` (suivie de la
 * même page QUAI_SCREEN), `QUAI_SEEN <sorte>`, `QUAI_IMU on|off`.
 */
function guideNotes(sim: Sim, from: number): { remind: { kind: string; n: number; i: number }[]; seen: string[]; imu: string[] } {
  const out = { remind: [] as { kind: string; n: number; i: number }[], seen: [] as string[], imu: [] as string[] };
  sim.entries.slice(from).forEach((e, k) => {
    const r = /^QUAI_REMIND (\S+) (\d+)$/.exec(e.message);
    if (r) out.remind.push({ kind: r[1], n: Number(r[2]), i: from + k });
    const v = /^QUAI_SEEN (\S+)$/.exec(e.message);
    if (v) out.seen.push(v[1]);
    const m = /^QUAI_IMU (on|off)$/.exec(e.message);
    if (m) out.imu.push(m[1]);
  });
  return out;
}
/**
 * Le renvoi d'un rappel (entrée `i`, QUAI_REMIND) : la page QUAI_SCREEN qui suit est celle qui était affichée juste
 * avant (même titre, mêmes lignes), du même moment (`moment.id` du premier affichage). Le contenu d'un moment peut
 * avoir changé depuis son premier affichage (« Si tu le rates » quand la marge tombe à 1 min) : le rappel renvoie le
 * message tel qu'il est.
 */
function samePageAfter(sim: Sim, i: number, first: Screen): boolean {
  const parse = (m: string): (Screen & { moment?: { id?: string } }) | null => {
    try {
      return JSON.parse(m.slice(12)) as Screen & { moment?: { id?: string } };
    } catch {
      return null;
    }
  };
  const before = sim.entries
    .slice(0, i)
    .reverse()
    .map((e) => (e.message.startsWith('QUAI_SCREEN ') ? parse(e.message) : null))
    .find((x) => x?.screen === 'guide');
  const nextE = sim.entries.slice(i + 1).find((e) => e.message.startsWith('QUAI_SCREEN '));
  const next = nextE ? parse(nextE.message) : null;
  const id = (first as Screen & { moment?: { id?: string } }).moment?.id;
  return !!before && !!next && next.screen === 'guide' && next.title === before.title && JSON.stringify(next.lines) === JSON.stringify(before.lines) && (!id || next.moment?.id === id);
}

async function s130remind(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  const host = ctx.host;
  const keepFix = async (n: number) => host.eval(`window.__quaiPushFix(${JSON.stringify({ lat: PLACES.placeAnge.lat, lon: PLACES.placeAnge.lon, accuracy: 6 })})`).catch(() => n);
  await ctx.scene('noRT');
  try {
    let t0 = 0;
    let from = 0;
    let first: Screen | undefined;
    await ctx.step('message-important', async () => {
      // sans temps réel : pas de voie modifiée, « Partir maintenant » seul à l'heure de partir (réglage « alert » absent)
      const x = await simGuideToLeave(ctx, 'p/1210.json');
      t0 = x.at;
      from = sim.entries.length;
      first = x.s;
      const kind = field<{ kind?: string } | undefined>(x.s, 'moment')?.kind ?? 'leave';
      check(IMPORTANT.has(kind), `« Partir maintenant » journalisé comme moment « ${kind} » (messages importants : ${[...IMPORTANT].join(', ')})`);
      await guideShot(ctx, 'message-important', x.s, true);
      return { screen: x.s, shot: false };
    });
    await ctx.step('rappel-45-s', async () => {
      check(first, 'message important absent');
      // ni effacé ni vu : renvoyé en page entière au bout de 45 s (QUAI_REMIND leave 1, puis la même page)
      while (Date.now() - t0 < 52_000 && !guideNotes(sim, from).remind.length) {
        await sleep(2_000);
        await keepFix(0);
        await sim.drain();
      }
      const dt = (Date.now() - t0) / 1000;
      const r = guideNotes(sim, from).remind;
      check(r.length === 1 && r[0].kind === 'leave' && r[0].n === 1, `1er rappel attendu vers 45 s (« QUAI_REMIND leave 1 ») : ${JSON.stringify(r)} à ${Math.round(dt)} s`);
      check(dt >= 40, `rappel trop tôt (${Math.round(dt)} s au lieu de 45 s)`);
      check(samePageAfter(sim, r[0].i, first), 'le rappel ne renvoie pas la même page (QUAI_SCREEN identique attendu après QUAI_REMIND)');
      check(rebuilds(sim, from) >= 1, 'rappel sans page entière (aucun rebuildPageContainer vu par l’hôte)');
      return { screen: sim.last, shot: false };
    });
    await ctx.step('deux-rappels-au-plus', async () => {
      // 2e rappel 45 s plus tard ; jamais de 3e (3 envois en tout), tant que le moment dure (3 min)
      while (Date.now() - t0 < 142_000) {
        await sleep(3_000);
        await keepFix(0);
        await sim.drain();
      }
      const r = guideNotes(sim, from).remind;
      check(JSON.stringify(r.map((x) => [x.kind, x.n])) === JSON.stringify([['leave', 1], ['leave', 2]]), `2 rappels au plus, 45 s d’écart : ${JSON.stringify(r.map((x) => [x.kind, x.n]))} en ${Math.round((Date.now() - t0) / 1000)} s`);
      check(r.every((x) => samePageAfter(sim, x.i, first!)), 'un rappel ne renvoie pas la même page');
      check(rebuilds(sim, from) >= 2, `pages entières : ${rebuilds(sim, from)} pour 2 rappels`);
      const j = (await host.storage('quai.journal')) ?? '';
      check(/"remind"/.test(j), 'journal : les rappels ne sont pas notés (PRD-1.3.0 § 6.2, § 6.4)');
      await sim.input('click');
      const e = await sim.waitScreen((x) => x.screen === 'guide' && !x.title && x.lines.every((l) => !l.trim()), 8_000, 'écran vide après le toucher');
      return { screen: e, shot: false };
    });
    await ctx.step('vu-tete-levee', async () => {
      // mouvement « lever la tête » appris : capteur ouvert (200 ms) pendant l'attente (QUAI_IMU on) ; la tête levée 0,6 s
      // au-delà du repos appris + 60 % de l'écart (contrôle technique : headUp.rest, la référence) : vu (QUAI_SEEN leave),
      // capteur fermé (QUAI_IMU off), aucun rappel
      const x = await simGuideToLeave(ctx, 'p/130seen.json');
      await waitCall(sim, x.from, (c) => c.m === 'imuControl' && c.on === true && c.pace === 200, 5_000, 'capteur ouvert à 200 ms pendant que le message attend');
      check(guideNotes(sim, x.from).imu[0] === 'on', `QUAI_IMU on attendu : ${JSON.stringify(guideNotes(sim, x.from).imu)}`);
      await sleep(1_200);
      await host.imu(HEAD_UP, 0.01);
      await sleep(1_500);
      await host.imu(REST, 0.01);
      await waitCall(sim, x.from, (c) => c.m === 'imuControl' && c.on === false, 4_000, 'capteur fermé dès que le message est vu');
      const n = guideNotes(sim, x.from);
      check(n.seen.includes('leave') && n.imu.includes('off'), `« vu » et capteur fermé attendus : QUAI_SEEN ${JSON.stringify(n.seen)}, QUAI_IMU ${JSON.stringify(n.imu)}`);
      while (Date.now() - x.at < 52_000) {
        await sleep(3_000);
        await keepFix(0);
      }
      await sim.drain();
      check(!guideNotes(sim, x.from).remind.length, `rappel alors que le message a été vu : ${JSON.stringify(guideNotes(sim, x.from).remind)}`);
      const j = (await host.storage('quai.journal')) ?? '';
      check(/"seen"/.test(j), 'journal : « vu » pas noté');
      return { screen: sim.last, shot: false };
    });
    await ctx.step('dashboard-aucun-rappel', async () => {
      // en levant la tête, le Dashboard : aucun rappel, capteur jamais ouvert ; le message reste affiché
      const x = await simGuideToLeave(ctx, 'p/130dash.json');
      while (Date.now() - x.at < 52_000) {
        await sleep(3_000);
        await keepFix(0);
      }
      await sim.drain();
      const n = guideNotes(sim, x.from);
      check(!n.remind.length && !n.imu.includes('on'), `rappel ou capteur avec « dashboard » : ${JSON.stringify(n)}`);
      check(!hostCalls(sim.entries, x.from).some((c) => c.m === 'imuControl' && c.on), 'capteur ouvert avec « dashboard »');
      check(O.matches(sim.last?.lines[0], 'Partir maintenant'), `le message reste affiché : ${show(sim.last)}`);
      return { screen: sim.last, shot: false };
    });
  } finally {
    await ctx.scene('base');
  }
}

/* ------------------------------ s130check : vérification au départ, batterie basse (§ 6.3) ------------------------------ */

async function s130check(ctx: Ctx130): Promise<void> {
  const sim = ctx.sim();
  const host = ctx.host;
  await ctx.step('batterie-basse', async () => {
    host.reset();
    await sim.launch(ctx.hostUrl({ ...START, ...ctx.preset('p/1210.json') }));
    await pushDevice(ctx, { batteryLevel: 12 });
    const steps = await simOpenFavorite(sim, FONTAINAS);
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'guide', 15_000, 'écran du guidage');
    // le moment « check » : une ligne par problème (au plus deux), fin 20 s ou un toucher ; « Où tu en es » d'abord
    let s: Screen | undefined;
    for (let k = 0; k < 4 && !s; k++) {
      try {
        s = await sim.waitScreen((x) => x.screen === 'guide' && x.lines.some((l) => same(l, TXT.battery(12))), 12_000, `« ${TXT.battery(12)} »`);
      } catch {
        // un autre moment (voie modifiée, « Où tu en es ») : l'effacer
        await sim.input('click');
      }
    }
    check(s, `« ${TXT.battery(12)} » jamais affiché au lancement (batterie des lunettes à 12 %)`);
    check(!s.lines.slice(0, -1).some((l) => /^(Pas de position|Position perdue)/.test(O.norm(l))), `seulement la batterie : ${show(s)}`);
    momentCommon(s, steps.title);
    await guideShot(ctx, 'batterie-basse', s, false);
    return { screen: s, shot: false };
  });
  await ctx.step('carte-en-cours', async () => {
    // la carte « En cours » du téléphone montre la même ligne
    await phoneGo(host, '#/');
    await phoneWait(host, /En cours[\s\S]*Lunettes : 12 % de batterie/, 10_000, `carte « En cours » avec « ${TXT.battery(12)} »`);
    const lines = await host.eval<string[]>(`(() => { ${NORM_JS} return [...document.querySelectorAll('.now-check')].map((e) => n(e.textContent)); })()`);
    check(lines.some((l) => same(l, TXT.battery(12))), `ligne de la vérification dans la carte « En cours » (.now-check) : ${JSON.stringify(lines)}`);
    return {};
  });
  await ctx.step('toucher-efface', async () => {
    await sim.input('click');
    const e = await sim.waitScreen((x) => x.screen === 'guide' && !x.title && x.lines.every((l) => !l.trim()), 8_000, 'écran vide après le toucher');
    const j = (await host.storage('quai.journal')) ?? '';
    check(/"battery"|batterie/i.test(j), 'journal : batterie au départ pas notée (PRD-1.3.0 § 6.4)');
    return { screen: e, shot: false };
  });
  await ctx.step('jamais-devant-une-action', async () => {
    // lancé à l'heure de partir, batterie basse : « Partir maintenant » d'abord (et la voie modifiée, plus prioritaire),
    // la vérification seulement après (PRIO : check après leave)
    host.reset();
    await sim.launch(ctx.hostUrl({ ...START, mockNow: '2026-11-10T07:33:05+01:00', ...ctx.preset('p/1210.json') }));
    await pushDevice(ctx, { batteryLevel: 12 });
    await simOpenFavorite(sim, FONTAINAS);
    await sim.drain();
    const fromId = sim.screens.at(-1)?.id ?? -1;
    await sim.input('click');
    const kindOf = (x: Screen): string => field<{ kind?: string } | null>(x, 'moment')?.kind ?? (field(x, 'show') === 'where' ? 'where' : x.lines.some((l) => l.trim()) ? '?' : 'vide');
    const t0 = Date.now();
    let taps = 0;
    while (Date.now() - t0 < 40_000) {
      await sleep(700);
      await sim.drain();
      const cur = sim.last;
      if (!cur || cur.screen !== 'guide') continue;
      const k = kindOf(cur);
      if (k === 'check') break;
      // un moment (ou « Où tu en es ») : l'effacer, comme une personne qui l'a lu
      if (k !== 'vide' && taps < 6) {
        await sim.input('click');
        taps++;
      }
    }
    const seq = sim.screens.filter((x) => x.id > fromId && x.screen === 'guide').map(kindOf).filter((k, i, a) => i === 0 || a[i - 1] !== k);
    const firstLeave = seq.indexOf('leave');
    const firstCheck = seq.indexOf('check');
    check(firstLeave >= 0, `« Partir maintenant » jamais affiché : ${JSON.stringify(seq)}`);
    check(firstCheck > firstLeave, `vérification ${firstCheck < 0 ? 'jamais montrée après l’action' : 'montrée devant « Partir maintenant »'} (écrans du guidage : ${JSON.stringify(seq)}, ${taps} touchers)`);
    return { screen: sim.last, shot: false };
  });
}

/* ------------------------------ s130journal : journal de trajet (§ 6.4) ------------------------------ */

/** Écarts de confidentialité d'une valeur du journal : clés interdites, nombres et textes qui ressemblent à des coordonnées. */
export function journalPrivacyIssues(value: unknown, pushed: LatLon[] = [], addresses: string[] = []): string[] {
  const bad: string[] = [];
  const keys = new Set(['lat', 'lon', 'lng', 'latitude', 'longitude', 'address']);
  const visit = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.has(k.toLowerCase()) ? bad.push(`clé « ${k} » (${path})`) : visit(x, `${path}.${k}`));
    else if (typeof v === 'number' && !Number.isInteger(v) && ((v > 49 && v < 52) || (v > 2 && v < 7)) && String(v).split('.')[1]?.length >= 3) bad.push(`nombre ${v} qui ressemble à une coordonnée (${path})`);
    else if (typeof v === 'string') {
      if (/\b(49|5[01])[.,]\d{3,}\b|\b[2-6][.,]\d{4,}\b/.test(v)) bad.push(`texte avec une coordonnée « ${v} » (${path})`);
      for (const a of addresses) if (v.includes(a)) bad.push(`adresse « ${a} » (${path})`);
      if (/\b\d{4} [A-ZÉ][a-zé]+/.test(v) && /,/.test(v)) bad.push(`texte qui ressemble à une adresse « ${v} » (${path})`);
    }
  };
  visit(value, 'journal');
  const flat = JSON.stringify(value);
  for (const p of pushed) for (const c of [p.lat, p.lon]) if (flat.includes(c.toFixed(4))) bad.push(`coordonnée poussée ${c.toFixed(4)} retrouvée`);
  return [...new Set(bad)].slice(0, 8);
}

async function s130journal(ctx: Ctx130): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    const pushed: LatLon[] = [];
    const tr = NAMUR_FONTAINAS;
    let j!: O.OJourney;
    await wstep(
      r,
      'trajet-guide',
      async () => {
        await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
        const s = await webOpenFavorite(r, FONTAINAS);
        await gesture(r, 'tap');
        await waitGuide(r, 'écran du guidage', isGuide, 15_000);
        j = (await webFollowed(r))!.journey;
        // « Partir maintenant » à l'heure de partir, effacé ; la marche, 6 min de positions (résumé toutes les 5 min)
        for (let t = j.leaveAt - 30_000; t <= j.leaveAt + 6 * 60_000; t += 20_000) {
          await goTo(r, tr, t);
          pushed.push(pointAt(tr.points, t));
          const cur = r.page.lastScreen();
          if (cur && isGuide(cur) && !isEmpty(cur)) await gesture(r, 'tap');
        }
        // arrêter le guidage (menu de l'appui long)
        await gesture(r, 'long');
        await waitGuide(r, 'menu', (x) => x.screen === 'menu');
        await gesture(r, 'tap');
        await waitGuide(r, 'accueil', (x) => x.screen === 'home');
        return { screen: s };
      },
      { critical: true },
    );
    await wstep(r, 'journal-stocke', async () => {
      const raw = await page.eval<string | null>(`localStorage.getItem('quai.journal')`);
      check(raw, 'quai.journal absent du stockage du téléphone (PRD-1.3.0 § 6.4)');
      check(raw.length <= 60_000, `journal de ${raw.length} octets (60 ko au plus)`);
      const parsed = JSON.parse(raw) as unknown;
      const trips = (Array.isArray(parsed) ? parsed : ((parsed as { trips?: unknown[] }).trips ?? [])) as { title?: string; kind?: string; end?: string; events?: { k: string }[] }[];
      check(trips.length >= 1 && trips.length <= 10, `trajets du journal : ${trips.length} (1 à 10)`);
      const t = trips.find((x) => x.title === FONTAINAS);
      check(t && t.kind === 'trip' && t.end === 'stopped', `trajet « ${FONTAINAS} » arrêté attendu : ${JSON.stringify(trips.map((x) => [x.title, x.kind, x.end]))}`);
      const kinds = new Set((t.events ?? []).map((e) => e.k));
      for (const k of ['start', 'moment', 'clear', 'end']) check(kinds.has(k), `événement « ${k} » absent du journal : ${JSON.stringify([...kinds])}`);
      const bad = journalPrivacyIssues(parsed, pushed, ['Place Fontainas, 1000 Bruxelles', 'Grand-Place, 1000 Bruxelles', 'Korenmarkt, 9000 Gent']);
      check(!bad.length, `le journal contient des coordonnées ou une adresse (PRD-1.3.0 § 6.4, § 10) : ${bad.join(' ; ')}`);
      return {};
    });
    await wstep(r, 'journal-telephone', async () => {
      // « Réglages », « Données », carte « Journal des trajets » : le trajet, son texte, « Copier », « Effacer le journal »
      await page.eval(`(document.querySelector('#w-tab-reglages')?.click(), location.hash = '#/donnees', true)`);
      await page.waitFor(`(document.querySelector('main') || document.body).innerText.includes(${JSON.stringify(TXT.journalCard)})`, 10_000, `carte « ${TXT.journalCard} »`);
      // une rangée par trajet (.journal-row : titre, date, durée, fin) ; toucher l'un : son texte (.journal-text)
      const rows = await page.eval<string[]>(`[...document.querySelectorAll('.journal-row')].map((r) => r.textContent.replace(/[\\u00a0\\u202f]/g, ' ').trim())`);
      check(rows.length >= 1 && rows.some((r) => r.includes(FONTAINAS)), `rangée du trajet « ${FONTAINAS} » dans « ${TXT.journalCard} » (.journal-row) : ${JSON.stringify(rows)}`);
      const clicked = await page.eval<boolean>(`(() => { const r = [...document.querySelectorAll('.journal-row')].find((x) => x.textContent.includes(${JSON.stringify(FONTAINAS)})); if (!r) return false; (r.querySelector('button, a, summary') || r).click(); return true; })()`);
      if (!clicked) await page.clickText(FONTAINAS, 'body', 'button,a,[role=button],li,summary');
      const text = await page.waitFor<string>(`(() => { const e = document.querySelector('.journal-text'); const t = (e ? (e.value || e.innerText || e.textContent) : (document.querySelector('main') || document.body).innerText).replace(/[\\u00a0\\u202f]/g, ' '); return /Journal Quai 1\\.3\\.0, trajet/.test(t) ? t : ''; })()`, 10_000, 'texte du journal (.journal-text)');
      check(/Journal Quai 1\.3\.0, trajet « Place Fontainas », 10\/11\/2026/.test(text), `en-tête « Journal Quai 1.3.0, trajet « ${FONTAINAS} », 10/11/2026 » absent : « ${text.slice(0, 300)} »`);
      check(/(^|\n)\s*07:3\d:\d\d Partir maintenant affiché\s*($|\n)/.test(text), `ligne « 07:3x:xx Partir maintenant affiché » absente (une ligne par événement, heures de Bruxelles) : « ${text.slice(0, 800)} »`);
      const bad = journalPrivacyIssues(text, pushed, ['Place Fontainas, 1000 Bruxelles']);
      check(!bad.length, `texte du journal : ${bad.join(' ; ')}`);
      for (const b of [TXT.journalCopy, TXT.journalClear]) check(await page.eval<boolean>(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(b)})`), `bouton « ${b} » absent`);
      return {};
    });
    await wstep(r, 'journal-efface', async () => {
      await page.clickText(TXT.journalClear, 'body', 'button');
      // une confirmation éventuelle dans la page
      await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Effacer|Oui, effacer|Confirmer)$/.test(x.textContent.trim())); b && b.click(); return true; })()`);
      await page.waitFor(`(() => { const raw = localStorage.getItem('quai.journal'); if (!raw) return true; const p = JSON.parse(raw); const t = Array.isArray(p) ? p : (p.trips || []); return t.length === 0; })()`, 8_000, 'journal effacé');
      return {};
    });
  }, VIEWPORT);
}

/* ------------------------------ Liste ------------------------------ */

/** Scénarios 1.3.0, dans l'ordre du rapport (préfixe s130). */
export function scenarios130(ctx: Ctx130): [string, string, () => Promise<void>][] {
  return [
    ['s130action', '1.3.0 (simulateur Even Hub) : ligne d’action « ▶ Y aller » au plus clair, aides « △▽ étapes   double : retour », un autre trajet, le toucher lance le guidage', () => s130action(ctx)],
    ['s130actionweb', '1.3.0 (Quai Web) : « ▶ Retour au guidage » (menu « Voir tout le trajet »), réglage éteint : « ▶ Suivre ce trajet » puis « ▶ Trajet suivi »', () => s130actionWeb(ctx)],
    ['s130up', '1.3.0 (simulateur Even Hub) : ▲ sur la première rangée de « Autres trajets » : le trajet proposé à sa dernière page', () => s130up(ctx)],
    ['s130fav', '1.3.0 (simulateur Even Hub) : favoris en accordéon, le détail sous le favori du curseur, refermé au suivant, toujours entier à l’écran', () => s130fav(ctx)],
    ['s130board', '1.3.0 (simulateur Even Hub) : « toucher : où descendre » sur un tableau et sur une ligne à son arrêt', () => s130board(ctx)],
    ['s130offmap', '1.3.0 (Quai Web) : hors de Belgique, marche vers la gare de Luxembourg : « Hors de Belgique », aucun virage, « Où tu en es » à vol d’oiseau', () => s130offmap(ctx)],
    ['s130screen', '1.3.0 (simulateur Even Hub, hôte simulé) : test de l’écran des lunettes, visible, tête levée (mouvement appris), Dashboard, rien, arrêt, Quai fermé, refusé pendant un guidage', () => s130screen(ctx)],
    ['s130remind', '1.3.0 (simulateur Even Hub, hôte simulé) : message important rappelé à 45 s, 2 rappels au plus, vu en levant la tête, aucun rappel avec le Dashboard', () => s130remind(ctx)],
    ['s130check', '1.3.0 (simulateur Even Hub, hôte simulé) : vérification au départ, « Lunettes : 12 % de batterie », carte « En cours », jamais devant une action', () => s130check(ctx)],
    ['s130journal', '1.3.0 (Quai Web) : journal de trajet, jamais de coordonnées ni d’adresse, son texte sur le téléphone, effacé', () => s130journal(ctx)],
  ];
}

/** Identifiants des scénarios 1.3.0 (commande de l'intégrateur : `npm run sim -- --only 's130*'`). */
export const S130_IDS = ['s130action', 's130actionweb', 's130up', 's130fav', 's130board', 's130offmap', 's130screen', 's130remind', 's130check', 's130journal'];
