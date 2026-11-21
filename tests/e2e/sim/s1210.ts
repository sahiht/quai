/**
 * Quai 1.2.10 « Y aller » : scénarios de bout en bout du simulateur (préfixe s1210), écrits contre le PRD
 * (docs/v1.2.10/PRD-1.2.10.md § 2, § 3, § 5, § 7) avant l'assemblage des équipes.
 *
 *  - Lunettes dans le simulateur Even Hub (horloge simulée, vraies captures 576 × 288) : favoris d'une ligne chacun et
 *    détail du favori choisi en bas (§ 2), écran du trajet (§ 5), nouveautés 1.2.10 depuis la 1.2.9 (§ 7).
 *  - Quai Web dans Chrome (canvas 576 × 288 converti au format du simulateur, positions poussées par
 *    `window.__quaiPushFix`, horloge pilotée par `window.__quaiClock.set`) : « y aller », chaque moment du § 3.2 le long
 *    d'une trace (partir, virage, voie modifiée, à l'arrêt, prochain arrêt, descente, correspondance, tu y es),
 *    « où tu en es » au toucher (à pied, à la gare, à bord), effacer, imprévus (véhicule raté, arrêt dépassé, sans
 *    position), menu de l'appui long (« Arrêter le guidage », « Voir tout le trajet »), double toucher et « En cours »,
 *    « j'y descends » depuis les arrêts d'un départ, réglage « Me guider » éteint, premier plan quitté puis revenu.
 *
 * Déterminisme : horloge et positions simulées (traces de tests/e2e/traces/, lieux publics), données des fixtures,
 * aucune donnée réseau nouvelle. Chaque échec dit l'écran, le texte attendu et le texte vu.
 * Captures : tests/e2e/screens/s1210-<étape>.png.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Screen, Sim } from '../lib/sim';
import { pointAt, type Trace, type TracePoint } from '../traces/geo';
import { NAMUR_FONTAINAS, NAMUR_IMPRECISE, NAMUR_MISSED, NAMUR_PASSED, PLACES, RIDE_CENTRAL, toFix } from '../traces/traces';
import type { GlassesScreen, Page } from './cdp';
import * as O from './guide-oracle';
import { canvasToShot, checkCalmPixels, checkGuidePixels, litCount, type GuideShot } from './guide-pixels';
import { accordionLines, checkPixels, cursorRowText, truncatedLines } from './pixels';

/** Ce que run-sim.ts prête aux scénarios 1.2.10 (mêmes serveurs, mêmes rapports). */
export interface Ctx {
  appVersion: string;
  shots: string;
  notes: string[];
  scenario(): string;
  record(r: { scenario: string; step: string; ok: boolean; error?: string; screen?: unknown; shot?: string; ms: number }): void;
  /** Adresse de la page (appli construite pour l'appli Even, ou Quai Web) avec les paramètres du mode test. */
  pageUrl(params: Record<string, string | undefined>, web: boolean): string;
  /** Paramètres d'un préréglage servi avec l'appli (`reset=1&preset=…`). */
  preset(file: string): Record<string, string>;
  withChrome(fn: (page: Page) => Promise<void>, viewport?: { width: number; height: number; dpr: number; mobile: boolean }): Promise<void>;
  sim: () => Sim;
  step(name: string, fn: () => Promise<{ screen?: Screen; shot?: boolean; pixels?: boolean } | void>): Promise<void>;
  /**
   * 1.3.0 : attentes de la spécification 1.3.0 (`--spec 1.3.0`, après la fusion) : ligne d'action et aides de l'écran du
   * trajet (PRD-1.3.0 § 1), favoris en accordéon (§ 7), message « Quai 1.3.0 » (§ 9). Absent : celles de la 1.2.10.
   */
  v130?: boolean;
  /**
   * 1.3.1 : attentes de docs/v1.3.1/PRD-1.3.1.md (« masquer », « Où tu en es », trois points, menu de l'appui long,
   * textes du guidage, accueil dans l'ordre du § 8) ; l'oracle (guide-oracle.ts, `useSpec`) suit la même spécification.
   */
  v131?: boolean;
}

/** 1.3.0 (PRD-1.3.0 § 1) : aides de l'écran du trajet, le « toucher : … » passé dans la ligne d'action au-dessus. */
export const STEPS_130 = { hints: '△▽ étapes   double : retour', go: '▶ Y aller', guided: '▶ Retour au guidage', follow: '▶ Suivre ce trajet', followed: '▶ Trajet suivi' } as const;
/**
 * Aide (et, 1.3.0, ligne d'action juste au-dessus) de l'écran du trajet : `go` pas encore guidé (« y aller »),
 * `guided` trajet guidé. Rend l'écart, ou null.
 */
export function stepsHintIssue(ctx: Pick<Ctx, 'v130'>, s: { lines: string[] }, kind: 'go' | 'guided'): string | null {
  const h = s.lines[s.lines.length - 1];
  if (!ctx.v130) {
    const want = kind === 'go' ? O.HINTS.stepsGo : O.HINTS.stepsGuided;
    return O.matches(h, want) ? null : `aide « ${h} » au lieu de « ${want} » (PRD-1.2.10 § 5)`;
  }
  const act = s.lines[s.lines.length - 2];
  const want = STEPS_130[kind];
  if (!O.matches(h, STEPS_130.hints)) return `aide « ${h} » au lieu de « ${STEPS_130.hints} » (PRD-1.3.0 § 1)`;
  return O.matches(act, want) ? null : `ligne d’action « ${act} » au lieu de « ${want} », juste au-dessus des aides (PRD-1.3.0 § 1)`;
}

class Check extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Check(msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hint = (s: { lines: string[] }) => s.lines[s.lines.length - 1];
const show = (s: GlassesScreen | undefined) => (s ? `${s.screen} « ${s.title} » ${s.clock ?? ''} ${JSON.stringify(s.lines)}` : 'aucun écran');

/** Départ des scénarios : place de l'Ange à Namur, mardi 10/11/2026 à 07:20 (lieu public, PRD § 8). */
const START = { mockLat: String(PLACES.placeAnge.lat), mockLon: String(PLACES.placeAnge.lon), mockNow: '2026-11-10T07:20:00+01:00' };
/** Sur le quai de la voie 6 à Namur, 07:38 (« j'y descends »). */
const ON_PLATFORM = { mockLat: String(PLACES.namurVoie6.lat), mockLon: String(PLACES.namurVoie6.lon), mockNow: '2026-11-10T07:38:00+01:00' };
const T = (hhmmss: string) => Date.parse(`2026-11-10T${hhmmss.length === 5 ? `${hhmmss}:00` : hhmmss}+01:00`);
/** Titre du favori de la place Fontainas (nom du lieu, PRD § 3.2 : « Bureau »). */
const FONTAINAS = 'Place Fontainas';
/** Message « Quai 1.2.10 » des lunettes (PRD § 7 ; formulations finales de l'équipe des écrans : à reporter ici). */
export const NEWS_1210_TITLE = 'Quai 1.2.10';
export const NEWS_1210 = ['Y aller : guidé de porte à porte, écran calme.', 'Train ou bus déjà pris : « j’y descends ».', 'Favoris : une ligne chacun, le détail en bas.'];
/**
 * 1.3.0 (PRD-1.3.0 § 9 ; app/src/glasses/views.ts NEWS_LINES_130, formulations finales de l'équipe des écrans) : la
 * ligne « ▶ Y aller » et ▲ pour revenir ; les favoris en accordéon ; le test de l'écran et le rappel des messages. Pour
 * qui vient d'avant la 1.2.10, ensuite les deux premières lignes de la 1.2.10 (« le détail en bas » n'est plus vrai).
 */
export const NEWS_130_TITLE = 'Quai 1.3.0';
/**
 * 1.3.1 (PRD-1.3.1 § 9, décision du 21/11 ; app/src/glasses/views.ts NEWS_LINES_131) : la 1.3.1 a son message : les
 * trois points, la sortie du métro, « dernier », l'heure de partir. Pour qui vient d'avant la 1.3.0, ensuite les trois
 * lignes de la 1.3.0 ; celles de la 1.2.10 ne tiennent plus (une version entière ou rien, 8 lignes au plus).
 */
export const NEWS_131_TITLE = 'Quai 1.3.1';
export const NEWS_131 = ['Guidage : trois points, Quai te suit, rien à faire.', 'Métro : la sortie à prendre après la descente.', '« dernier » : plus rien à prendre après celui-ci.', 'Heure de partir : calculée sur le vrai chemin à pied.'];
export const NEWS_130 = ['Trajet : ligne « ▶ Y aller », ▲ revient des autres trajets.', 'Favoris : le détail s’ouvre sous le favori choisi.', 'Test de l’écran sur le téléphone ; message pas vu rappelé.'];
/** Rangée de « Favoris » au format de l'accueil (PRD-1.2.10 § 2), « ! » après le nom d'un trajet qui a un souci. */
const FAV_ROW = /^\S.*?( !)? {3}(dans \d+ min → \d\d:\d\d|maintenant → \d\d:\d\d|\d\d:\d\d → \d\d:\d\d|tu y es|aucun trajet|sur le téléphone|…)$/;

/* ------------------------------ Quai Web : pilote ------------------------------ */

/** Canvas des lunettes à 576 × 288 exactement (densité 1) : la capture se lit pixel pour pixel. */
const CANVAS_CSS = '.w-canvas{width:576px !important;height:288px !important;max-width:none !important;max-height:none !important}';
const VIEWPORT = { width: 1280, height: 1000, dpr: 1, mobile: false };

interface Run {
  ctx: Ctx;
  page: Page;
  /** rang du premier écran journalisé de l'étape en cours */
  mark: number;
  /** étape essentielle en échec (lancement du guidage) : les suivantes ne sont pas jouées, le rapport dit pourquoi */
  blocked?: string;
}

async function openWeb(r: Run, params: Record<string, string | undefined>): Promise<GlassesScreen> {
  await r.page.goto(r.ctx.pageUrl(params, true));
  await r.page.addStyle(CANVAS_CSS);
  await r.page.eval(`(document.querySelector('#w-tab-lunettes')?.click(), true)`).catch(() => undefined);
  return r.page.waitScreen((s) => s.screen === 'home' && !s.lines.some((l) => /…$|^Chargement/.test(l)), 30_000, 'accueil des lunettes (Quai Web)');
}

/** Geste par la barre de Quai Web ; `long` : bouton « Appui long » (PRD § 3.4, § 4.7). */
async function gesture(r: Run, g: 'up' | 'down' | 'tap' | 'double' | 'long'): Promise<void> {
  r.mark = r.page.screens().length;
  const ok = await r.page.eval<boolean>(`(() => { const b = document.querySelector('.w-gestures button[data-g="${g}"]'); if (!b) return false; b.click(); return true; })()`);
  check(ok, g === 'long' ? 'crochet manquant : bouton « Appui long » (data-g="long") dans la barre des gestes de Quai Web (PRD § 3.4, § 4.7 ; équipe B)' : `bouton du geste ${g} introuvable dans Quai Web`);
  await sleep(450);
}

/**
 * Horloge simulée : `window.__quaiClock.set(epochMs)` (crochet demandé, mode e2e) ; à défaut `__restoreState({ clock })`
 * de l'appli Even. Sans l'un ni l'autre, échec explicite.
 */
async function setNow(r: Run, t: number): Promise<void> {
  const how = await r.page.eval<string>(`(() => {
    const c = window.__quaiClock;
    if (c && typeof c.set === 'function') { c.set(${t}); return 'clock'; }
    if (typeof window.__restoreState === 'function') { window.__restoreState({ clock: { now: ${t} } }); return 'restore'; }
    return 'none';
  })()`);
  check(how !== 'none', `crochet manquant : window.__quaiClock.set(epochMs) (horloge simulée du mode e2e, Quai Web ; voir tests/e2e/README.md, 1.2.10) pour aller à ${O.hm(t)}`);
}

/** Position poussée vers les flux du guidage (`window.__quaiPushFix`, équipe B). */
async function push(r: Run, p: TracePoint): Promise<void> {
  const ok = await r.page.eval<string>(`(() => { if (typeof window.__quaiPushFix !== 'function') return 'absent'; return window.__quaiPushFix(${JSON.stringify(toFix(p))}) ? 'pris' : 'refusé'; })()`);
  check(ok !== 'absent', 'crochet manquant : window.__quaiPushFix({ lat, lon, accuracy, speed, heading, at }) en mode e2e (équipe B, PRD § 10)');
  check(ok === 'pris', `position refusée par window.__quaiPushFix (${p.lat}, ${p.lon} à ${O.hm(p.at)}) : aucun flux de position en service ?`);
}

/** Va à l'instant `t` et y pousse la position de la trace (le moteur se recalcule à chaque position, PRD § 3.7). */
async function goTo(r: Run, trace: Trace | null, t: number, keepMark = true): Promise<void> {
  if (!keepMark) r.mark = r.page.screens().length;
  await setNow(r, t);
  if (trace) {
    // positions intermédiaires depuis le dernier instant (montée constatée par la vitesse, chemin suivi)
    const pts = trace.points.filter((p) => p.at <= t).slice(-4);
    for (const p of pts) await push(r, p);
    const last = pointAt(trace.points, t);
    await push(r, { ...last, at: t });
  }
  await sleep(350);
}

/** Trajet suivi (clé quai.trip) : le trajet guidé, son titre. */
async function followed(r: Run): Promise<{ journey: O.OJourney; title: string; guide?: { kind?: string; beyondByLeg?: { legs?: Record<string, NonNullable<O.OLeg['stops']>> } } } | null> {
  const raw = await r.page.eval<string | null>(`localStorage.getItem('quai.trip')`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { journey: O.OJourney; title: string; guide?: { kind?: string; beyondByLeg?: { legs?: Record<string, NonNullable<O.OLeg['stops']>> } } };
  } catch {
    return null;
  }
}

/** Attend un écran du guidage, journalisé depuis le dernier geste ou instant, qui vérifie `pred`. */
async function waitGuide(r: Run, label: string, pred: (s: GlassesScreen) => boolean, timeout = 10_000): Promise<GlassesScreen> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const all = r.page.screens();
    for (let i = all.length - 1; i >= r.mark && i >= 0; i--) if (pred(all[i])) return all[i];
    await sleep(120);
  }
  const all = r.page.screens();
  const guides = all.slice(r.mark).filter((s) => s.screen === 'guide');
  throw new Check(`délai dépassé en attendant ${label} ; dernier écran : ${show(all.at(-1))}${guides.length ? ` ; écrans du guidage vus : ${guides.slice(-3).map(show).join(' | ')}` : ''}`);
}

const isGuide = (s: GlassesScreen) => s.screen === 'guide';
/**
 * « Si tu le rates » (règle 1.2.5) : 4e ligne du moment « leave » quand la marge est d'une minute ou moins ; l'écart
 * (« , 30 min plus tard ») tombe quand la ligne ne tient pas à côté de l'image (guide-views.ts, missFit) : les deux
 * formes, la longue seulement si elle tient (contrôle au pixel).
 */
const RATES = /^Si tu le rates : arrivée \d\d:\d\d(, \d+ min plus tard)?$/;
/**
 * Écran calme du guidage (« effacer » de la 1.2.10, « masquer » de la 1.3.1) : rien jusqu'à la 1.3.0 ; 1.3.1 (PRD-1.3.1
 * § 1, B9) : seulement « · · · », ou à bord la ligne de progression.
 */
const isEmpty = (s: GlassesScreen) =>
  s.screen === 'guide' && !s.title && s.lines.every((l) => !l.trim() || (O.SPEC.v131 && (O.matches(l, O.T131.dots) || O.PROGRESS_RE.test(O.norm(l)))));
/** 1.3.1 (A7, E3) : un toucher ne masque qu'un message affiché depuis au moins 1,5 s (horloge de Quai, ici à vitesse 1). */
const maskWait = () => (O.SPEC.v131 ? sleep(1_600) : Promise.resolve());
const momentOf = (s: GlassesScreen) => (typeof s.moment === 'string' ? s.moment : undefined);

/** Capture du canvas de Quai Web, convertie au format du simulateur. */
async function canvasShot(r: Run): Promise<Buffer> {
  const b64 = await r.page.eval<string>(`(() => { const c = document.querySelector('.w-canvas'); return c ? c.toDataURL('image/png').split(',')[1] : ''; })()`);
  check(b64, 'canvas des lunettes de Quai Web introuvable (.w-canvas)');
  return canvasToShot(Buffer.from(b64, 'base64'));
}

type ShotKind = { kind: 'guide'; image: boolean } | { kind: 'empty' } | { kind: 'layout' } | { kind: 'menu' } | { kind: 'capture' };

/** Étape Quai Web : capture du canvas contrôlée au pixel, résultat dans le rapport commun. */
async function gstep(r: Run, name: string, fn: () => Promise<{ screen?: GlassesScreen; shot?: ShotKind } | void>, opts: { critical?: boolean } = {}): Promise<void> {
  const t0 = Date.now();
  const res: Parameters<Ctx['record']>[0] = { scenario: r.ctx.scenario(), step: name, ok: true, ms: 0 };
  const file = join(r.ctx.shots, `s1210-${name}.png`);
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
      let bad: string[] = [];
      if (out.shot.kind === 'empty') {
        const n = litCount(buf);
        // 1.3.1 (PRD-1.3.1 § 1) : l'écran calme d'un guidage montre « · · · », au plus pâle, en bas au centre (B9 : à bord, la progression)
        if (O.SPEC.v131) bad = checkCalmPixels(buf, s.lines.some((l) => O.PROGRESS_RE.test(O.norm(l))) ? 'progress' : 'dots').bad;
        else if (n) bad = [`écran calme attendu (aucun pixel allumé), ${n} pixels allumés`];
      } else if (out.shot.kind === 'capture') {
        // capture seulement (l'écran est contrôlé au pixel ailleurs) : jamais un écran noir
        if (!litCount(buf)) bad = ['écran noir'];
      } else if (out.shot.kind === 'layout' || out.shot.kind === 'menu') {
        // écrans à gabarit (accueil, trajet, arrêts, menu de l'appui long) : le contrôle des colonnes de layout.ts, avec
        // 6 px de marge (canvas : la police du système déborde de 1 à 4 px l'avance des G2 aux extrémités)
        bad = litCount(buf) ? checkPixels(buf, s, { tol: 6 }) : ['écran noir'];
      } else bad = checkGuidePixels(buf, s as unknown as GuideShot, { image: out.shot.kind === 'guide' && out.shot.image, tol: 5 });
      // une capture en échec au pixel garde le nom -ECHEC (jamais livrée sous le nom de l'étape)
      const target = bad.length ? join(r.ctx.shots, `s1210-${name}-ECHEC.png`) : file;
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
      writeFileSync(join(r.ctx.shots, `s1210-${name}-ECHEC.png`), await canvasShot(r));
    } catch {
      /* page fermée */
    }
  }
  res.ms = Date.now() - t0;
  r.ctx.record(res);
}

/** Contrôles communs d'un écran du guidage avec un moment : titre du trajet, heure, aide, typographie, rien de coupé. */
function momentCommon(s: GlassesScreen, title: string, wantHint: string = O.HINTS.moment): void {
  check(O.norm(s.title).startsWith(O.norm(title)), `titre « ${s.title} » au lieu du titre du trajet « ${title} » (PRD § 3.2)`);
  check(/^\d\d:\d\d$/.test(s.clock ?? ''), `heure à droite du titre absente (« ${s.clock ?? ''} »)`);
  check(O.matches(hint(s), wantHint), `aide « ${hint(s)} » au lieu de « ${wantHint} »`);
  const cut = truncatedLines(s);
  check(!cut.length, `lignes coupées par « … » : ${JSON.stringify(cut)}`);
  const typo = O.typographyIssues([s.title, ...s.lines]);
  check(!typo.length, typo.join(' ; '));
}

/** 1.3.1 (PRD-1.3.1 § 3, § 12) : « Où tu en es », écarts au PRD dits en clair (guide-oracle.ts, whereIssues131). */
function whereOk131(s: GlassesScreen, w: O.Where131, label: string): void {
  const bad = O.whereIssues131(s, w);
  check(!bad.length, `${label} :\n        ${bad.join('\n        ')}\n      écran vu : ${show(s)}`);
}

/** Lignes du moment (sans l'aide) comparées à l'oracle ; `extra` : lignes permises en plus, après les attendues. */
function expectLines(s: GlassesScreen, want: O.Want[], label: string, extra: O.Want[] = []): void {
  const body = s.lines.slice(0, -1);
  const bad = O.compareLines(body, want);
  for (const l of body.slice(want.length)) if (!extra.some((w) => O.matches(l, w))) bad.push(`ligne en trop « ${O.norm(l)} »`);
  check(!bad.length, `${label} :\n        ${bad.join('\n        ')}\n      écran vu : ${show(s)}`);
}

/** Attend le moment dont la 1re ligne vérifie `first`, puis compare tout. */
async function moment(r: Run, label: string, first: O.Want, timeout = 10_000): Promise<GlassesScreen> {
  return waitGuide(r, `écran « ${label} » (1re ligne ${O.showWant(first)})`, (s) => isGuide(s) && O.matches(s.lines[0], first), timeout);
}

/** Toucher sur un moment ou « où tu en es » : écran vide (PRD § 3.4). */
async function dismiss(r: Run, label: string): Promise<GlassesScreen> {
  await maskWait();
  await gesture(r, 'tap');
  return waitGuide(r, `écran vide après le toucher (${label})`, isEmpty);
}

/** « y aller » depuis l'accueil : favori de la place Fontainas, écran du trajet, toucher. */
async function goFontainas(r: Run): Promise<GlassesScreen> {
  const home = r.page.lastScreen()!;
  // « Favoris   7 » en tête (1.3.1, PRD-1.3.1 § 8 : sous « Autour de moi »), puis le favori de la place Fontainas dans la liste
  check(home.lines.some((l) => /^Favoris {3}\d+$/.test(l)), `accueil : « Favoris   n » attendu, vu ${JSON.stringify(home.lines)}`);
  await selectHome(r, /^Favoris {3}\d+$/);
  await gesture(r, 'tap');
  const favs = await waitGuideAny(r, 'Favoris', (s) => s.screen === 'favorites' && !s.lines.some((l) => /…$/.test(l)), 15_000);
  // « ! » après le nom d'un favori dont le trajet a un souci (voie modifiée, PRD § 2)
  const k = favs.lines.findIndex((l) => new RegExp(`^${FONTAINAS}( !)?( {3}|$)`).test(l));
  check(k >= 0, `favori « ${FONTAINAS} » absent de Favoris : ${JSON.stringify(favs.lines)}`);
  for (let i = 0; i < 10 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
  await gesture(r, 'tap');
  return waitGuideAny(r, 'écran du trajet', (s) => s.screen === 'steps' && !s.lines.some((l) => /^Calcul|…$/.test(l)), 20_000);
}

/** Rang d'un élément de l'accueil (sans la ligne du haut, la ligne vide, le jour férié ni l'aide), puis curseur dessus. */
async function selectHome(r: Run, re: RegExp): Promise<void> {
  const items = (s: GlassesScreen) => s.lines.filter((l, i) => l !== '' && !/^△▽ |^Jour férié/.test(l) && !(i === 0 && /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/.test(l)));
  const k = items(r.page.lastScreen()!).findIndex((l) => re.test(l));
  check(k >= 0, `élément ${re} absent de l’accueil : ${show(r.page.lastScreen())}`);
  for (let i = 0; i < 12 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
  check(r.page.lastScreen()?.sel === k, `curseur pas arrivé sur ${re} (sel ${r.page.lastScreen()?.sel}, attendu ${k})`);
}

async function waitGuideAny(r: Run, label: string, pred: (s: GlassesScreen) => boolean, timeout = 10_000): Promise<GlassesScreen> {
  return waitGuide(r, label, pred, timeout);
}

/** Lance le guidage (« y aller ») et rend le trajet guidé. */
async function launch(r: Run): Promise<{ j: O.OJourney; title: string; where?: GlassesScreen; opening?: string }> {
  const steps = await goFontainas(r);
  const bad = stepsHintIssue(r.ctx, steps, 'go');
  check(!bad, `écran du trajet : ${bad}`);
  const mark = r.page.screens().length;
  await gesture(r, 'tap');
  // § 3.1 : l'écran du guidage s'ouvre sur « Où tu en es » (journal : show « where »), le premier écran après le toucher
  await waitGuide(r, '« Où tu en es » au lancement (PRD § 3.1)', (s) => isGuide(s) && (s.show === 'where' || O.matches(s.title, O.T131.whereTitle)), 15_000).catch(() => undefined);
  const after = r.page.screens().slice(mark).filter(isGuide);
  const where = after.find((s) => s.show === 'where');
  check(after.length, `aucun écran du guidage après « y aller » (PRD § 3.1)`);
  const opening = where ? undefined : `l’écran du guidage ne s’ouvre pas sur « Où tu en es » (PRD § 3.1) : ${after.slice(0, 2).map(show).join(' | ')}`;
  // PRD § 3.1 (mis à jour) : un moment déjà dû passe avant « Où tu en es » ; noté pour le rapport, pas un écart
  if (opening && after[0]?.show === 'moment') r.ctx.notes.push(`${r.ctx.scenario()} : ouverture sur un moment déjà dû : ${show(after[0])}`);
  else if (opening) r.ctx.notes.push(`${r.ctx.scenario()} : ${opening}`);
  const ft = await followed(r);
  check(ft?.journey?.legs?.length, `trajet suivi absent de quai.trip après « y aller » (PRD § 3.1)`);
  // titre des écrans du guidage : le nom du trajet, celui de l'écran du trajet (« Bureau », PRD § 3.2)
  return { j: ft.journey, title: steps.title, where, opening };
}

const rideLeg = (j: O.OJourney, k = 0) => O.rides(j)[k];
const stopIndex = (l: O.OLeg, name: string) => (l.stops ?? []).findIndex((s) => s.name.fr === name);

/* ------------------------------ Scénario principal : de bout en bout ------------------------------ */

async function s1210go(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    const tr = NAMUR_FONTAINAS;
    let j!: O.OJourney;
    let title = FONTAINAS;
    await gstep(r, 'accueil', async () => {
      const h = await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      return { screen: h, shot: { kind: 'layout' } };
    });
    await gstep(r, 'guide-ou-tu-en-es', async () => {
      const x = await launch(r);
      j = x.j;
      title = x.title;
      // PRD § 3.1 (mis à jour) : un moment déjà dû (voie modifiée, « monter », nouveau trajet) passe avant « Où tu en es »
      const first = r.page.screens().filter(isGuide).find((g) => g.show === 'where' || g.show === 'moment');
      if (first && first.show === 'moment') {
        const l = j.legs[rideLeg(j)];
        check(O.matches(first.lines[0], 'Voie modifiée'), `moment dû au lancement : « Voie modifiée » attendu (IC voie 6 au lieu de 4), vu ${show(first)}`);
        expectLines(first, O.platformLines(l), 'moment dû au lancement (§ 3.1, platform)');
        momentCommon(first, title);
        return { screen: first };
      }
      check(x.where, x.opening ?? '« Où tu en es » absent au lancement');
      const w = x.where;
      check(w.lines.length >= 3, `« Où tu en es » : ${show(w)}`);
      if (ctx.v131) {
        // 1.3.1 (PRD-1.3.1 § 3, § 12) : « Guidage en cours », « Jusqu’à … », « Ensuite : partir à 07:33 », la marche
        const bad = O.whereIssues131(w, O.where131(j, title, 'before'));
        check(!bad.length, `« Où tu en es » au lancement (PRD-1.3.1 § 3, § 12) :\n        ${bad.join('\n        ')}\n      écran vu : ${show(w)}`);
        return { screen: w };
      }
      // § 3.3 : à pied (avant le départ) ; la chaîne commence par la marche de départ
      const chain = O.chainLabels(j);
      check(chain[0] === 'à pied' && chain.length === O.rides(j).length + 1, `chaîne attendue « ${chain.join(' ─ ')} » (trajet ${j.legs.map((l) => (l.kind === 'walk' ? 'marche' : O.vehicle(l))).join(', ')})`);
      expectLines(w, [new RegExp(`^[◎○] à pied ─ ○ ${chain.slice(1).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ─ ○ ')}$`), ...O.whereWalkLines(j, 0, title, 0).slice(1)], '« Où tu en es » à pied (§ 3.3)');
      momentCommon(w, title);
      // capture : au toucher sur l'écran vide (étape suivante), « Où tu en es » reste 30 s
      return { screen: w };
    });
    if (!j) r.blocked = 'aucun trajet guidé après « y aller »';
    await gstep(r, 'guide-efface', async () => {
      // toucher : effacer ; l'écran reste vide (§ 3.2). Une voie modifiée connue d'avance peut paraître d'abord.
      // 1.3.1 : « masquer », seulement après 1,5 s d'affichage (A7) ; l'écran calme montre « · · · » (§ 1)
      await maskWait();
      await gesture(r, 'tap');
      let s = await waitGuide(r, 'écran vide ou « Voie modifiée »', (x) => isEmpty(x) || (isGuide(x) && O.matches(x.lines[0], 'Voie modifiée')));
      if (!isEmpty(s)) {
        const l = j.legs[rideLeg(j)];
        expectLines(s, O.platformLines(l), '« Voie modifiée » (§ 3.2, platform)');
        momentCommon(s, title);
        ctx.notes.push(`s1210go : « Voie modifiée » montré avant le départ (${JSON.stringify(s.lines)})`);
        s = await dismiss(r, 'Voie modifiée');
      }
      return { screen: s, shot: { kind: 'empty' } };
    });
    await gstep(r, 'guide-ou-tu-en-es-toucher', async () => {
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » au toucher (§ 3.3)', (s) => isGuide(s) && s.show === 'where');
      if (ctx.v131) whereOk131(w, O.where131(j, title, 'before'), '« Où tu en es » au toucher, avant de partir (PRD-1.3.1 § 3, § 12)');
      else {
        expectLines(w, O.whereWalkLines(j, 0, title, 0).map((x, i) => (i === 0 ? /^[◎○] à pied ─ / : x)), '« Où tu en es » au toucher (§ 3.3)');
        momentCommon(w, title);
      }
      return { screen: w, shot: { kind: 'guide', image: !!(w.images as unknown[] | undefined)?.length } };
    });
    await gstep(r, 'guide-partir', async () => {
      await dismiss(r, '« Où tu en es »');
      await goTo(r, tr, j.leaveAt + 5_000);
      const s = await moment(r, 'Partir maintenant', 'Partir maintenant', 12_000);
      expectLines(s, O.leaveLines(j, title, j.leaveAt + 5_000), '« Partir maintenant » (§ 3.2, leave)', [RATES]);
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: true } };
    });
    await gstep(r, 'guide-partir-efface', async () => {
      await dismiss(r, 'Partir maintenant');
      // un moment effacé ne revient pas (§ 3.2) : même instant, même position
      await goTo(r, tr, j.leaveAt + 20_000);
      await sleep(800);
      const back = r.page.screens().slice(r.mark).find((x) => isGuide(x) && O.matches(x.lines[0], 'Partir maintenant'));
      check(!back, `« Partir maintenant » revenu après « effacer » : ${show(back)}`);
    });
    let turnSeenAt = 0;
    await gstep(r, 'guide-virage', async () => {
      // § 3.8 : virages seulement avec un vrai chemin (tuiles piétonnes data/walk/ des données de test)
      const t0 = T('07:31');
      let seen: GlassesScreen | undefined;
      for (let t = t0; t <= T('07:40:30') && !seen; t += 10_000) {
        turnSeenAt = t;
        await goTo(r, tr, t);
        seen = r.page.screens().slice(r.mark).find((x) => isGuide(x) && O.turnRe().test(O.norm(x.lines[0])));
      }
      // 1.3.1 (A6) : la trace suit les rues du chemin : jamais « Fais demi-tour » à qui marche vers la gare
      if (ctx.v131) {
        const uturn = r.page.screens().slice(r.mark).find((x) => isGuide(x) && O.matches(x.lines[0], O.T131.uturn));
        check(!uturn, `« Fais demi-tour » sur une marche qui suit le chemin, vers la gare (A6 : seulement à contresens) : ${show(uturn)}`);
      }
      check(seen, 'aucun virage annoncé sur la marche de la place de l’Ange à la gare de Namur : il faut un vrai chemin à pied (tuiles piétonnes data/walk/ dans les données de test, équipe D) ; sans elles, chemin droit sans virage (§ 3.8)');
      const m = /dans (\d+) m$/.exec(O.norm(seen.lines[0]));
      if (m) check(+m[1] < 100 ? +m[1] % 10 === 0 : +m[1] % 50 === 0, `distance « ${seen.lines[0]} » : par 10 m sous 100 m, sinon par 50 m (§ 3.2)`);
      check(seen.lines.length >= 3 && /^vers |^[A-ZÉÈ]/.test(O.norm(seen.lines[1])), `2e ligne pâle : nom de la rue ou « vers … » (§ 3.2) : ${show(seen)}`);
      momentCommon(seen, title);
      return { screen: seen, shot: { kind: 'guide', image: true } };
    });
    await gstep(r, 'guide-ou-tu-en-es-a-pied', async () => {
      // après le virage (jamais en arrière dans le temps : en 1.3.1 un message ne se masque qu'affiché depuis 1,5 s, A7),
      // encore à plus de 200 m de la gare (plus près, le moteur dit « À la gare de Namur »)
      await goTo(r, tr, Math.max(T('07:36:05'), turnSeenAt + 5_000));
      // un virage peut être affiché : l'effacer d'abord
      const cur = r.page.lastScreen();
      if (cur && isGuide(cur) && !isEmpty(cur)) await dismiss(r, 'moment en cours');
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » à pied', (s) => isGuide(s) && s.lines.some((l) => /^À pied vers /.test(O.norm(l))));
      if (ctx.v131) whereOk131(w, O.where131(j, title, 'walk', rideLeg(j, 0)), '« Où tu en es » à pied (PRD-1.3.1 § 3, § 4, § 12)');
      else {
        expectLines(w, O.whereWalkLines(j, 0, title, 0), '« Où tu en es » à pied (§ 3.3)');
        momentCommon(w, title);
      }
      return { screen: w, shot: { kind: 'guide', image: !!(w.images as unknown[] | undefined)?.length } };
    });
    let ic = -1;
    await gstep(r, 'guide-a-l-arret', async () => {
      ic = rideLeg(j, 0);
      const cur0 = r.page.lastScreen();
      if (cur0 && isGuide(cur0) && !isEmpty(cur0)) await dismiss(r, '« Où tu en es » à pied');
      // à 60 m de la gare, départ dans 15 min ou moins : « board » (§ 3.2), voie modifiée au plus clair
      let s: GlassesScreen | undefined;
      for (let t = T('07:40'); t <= T('07:43:30') && !s; t += 10_000) {
        await goTo(r, tr, t);
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && O.matches(x.lines[0], O.boardLines(j, ic, t)[0]));
      }
      check(s, `moment « board » de l’${O.vehicle(j.legs[ic])} jamais affiché en arrivant à la gare : dernier écran ${show(r.page.lastScreen())}`);
      const want = O.boardLines(j, ic, T('07:41'));
      expectLines(s, want, '« À l’arrêt » / monter (§ 3.2, board)');
      if (want.includes('voie modifiée')) check(s.lines.some((l) => O.norm(l) === 'voie modifiée' || O.norm(l).endsWith(', voie modifiée')), `« voie modifiée » absent du moment « board » : ${show(s)}`);
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: true } };
    });
    await gstep(r, 'guide-ou-tu-en-es-a-la-gare', async () => {
      await goTo(r, tr, T('07:42:05'));
      await dismiss(r, 'board');
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » à la gare', (s) => isGuide(s) && s.lines.some((l) => /^À (la gare de|l’arrêt) /.test(O.norm(l))));
      if (ctx.v131) whereOk131(w, O.where131(j, title, 'wait', ic), '« Où tu en es » à la gare (PRD-1.3.1 § 3, § 12)');
      else {
        expectLines(w, O.whereWaitLines(j, ic, 1), '« Où tu en es » à la gare (§ 3.3)');
        momentCommon(w, title);
      }
      return { screen: w, shot: { kind: 'guide', image: !!(w.images as unknown[] | undefined)?.length } };
    });
    await gstep(r, 'guide-prochain-arret', async () => {
      const cur0 = r.page.lastScreen();
      if (cur0 && isGuide(cur0) && !isEmpty(cur0)) await dismiss(r, '« Où tu en es » à la gare');
      const l = j.legs[ic];
      const k = stopIndex(l, 'Gembloux');
      check(k > 0, `Gembloux absent des arrêts de l’IC : ${JSON.stringify(l.stops?.map((s) => s.name.fr))}`);
      for (const t of [T('07:44:10'), T('07:48'), T('07:52'), T('07:56:05')]) await goTo(r, tr, t);
      const s = await moment(r, 'Prochain arrêt', `Prochain arrêt : Gembloux`, 8_000);
      expectLines(s, O.nextStopLines(l, k), '« Prochain arrêt » (§ 3.2, nextStop)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
    await gstep(r, 'guide-ou-tu-en-es-a-bord', async () => {
      await goTo(r, tr, T('08:00:05'));
      const cur = r.page.lastScreen();
      if (cur && isGuide(cur) && !isEmpty(cur)) await dismiss(r, 'moment en cours');
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » à bord', (s) => isGuide(s) && s.lines.some((x) => /^Prochain arrêt : /.test(O.norm(x))));
      const l = j.legs[ic];
      if (ctx.v131) whereOk131(w, O.where131(j, title, 'ride', ic, stopIndex(l, 'Ottignies')), '« Où tu en es » à bord (PRD-1.3.1 § 3, § 12)');
      else {
        expectLines(w, O.whereRideLines(j, ic, stopIndex(l, 'Ottignies'), 1, 'trip'), '« Où tu en es » à bord (§ 3.3)');
        momentCommon(w, title);
      }
      return { screen: w, shot: { kind: 'guide', image: !!(w.images as unknown[] | undefined)?.length } };
    });
    await gstep(r, 'guide-prochain-arret-regle', async () => {
      const cur0 = r.page.lastScreen();
      if (cur0 && isGuide(cur0) && !isEmpty(cur0)) await dismiss(r, '« Où tu en es » à bord');
      // au plus un « Prochain arrêt » toutes les 10 min, jamais dans les 5 min avant la descente (§ 3.2)
      const l = j.legs[ic];
      const seen: string[] = [];
      for (let t = T('08:05'); t <= T('08:37:20'); t += 60_000) {
        await goTo(r, tr, t);
        const s = r.page.lastScreen();
        if (s && isGuide(s) && /^Prochain arrêt : /.test(O.norm(s.lines[0]))) {
          const name = O.norm(s.lines[0]).slice('Prochain arrêt : '.length);
          if (!seen.includes(name)) {
            seen.push(name);
            expectLines(s, O.nextStopLines(l, stopIndex(l, name)), `« Prochain arrêt : ${name} »`);
          }
        }
      }
      check(!seen.includes('Bruxelles-Schuman'), `« Prochain arrêt : Bruxelles-Schuman » montré dans les 5 min avant la descente ou moins de 10 min après le précédent (${seen.join(', ')})`);
      check(seen.includes('Ottignies'), `« Prochain arrêt : Ottignies » attendu vers 08:10 (vus : ${seen.join(', ') || 'aucun'})`);
    });
    await gstep(r, 'guide-descente', async () => {
      await goTo(r, tr, T('08:38:05'));
      const s = await moment(r, 'Descends au prochain arrêt', 'Descends au prochain arrêt', 8_000);
      expectLines(s, O.alightLines(j, ic), '« Descends au prochain arrêt » (§ 3.2, alight)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
    let tram = -1;
    await gstep(r, 'guide-correspondance', async () => {
      tram = rideLeg(j, 1);
      check(tram !== undefined, `trajet sans 2e véhicule : ${j.legs.map((l) => l.kind).join(', ')}`);
      let s: GlassesScreen | undefined;
      for (let t = T('08:42:10'); t <= T('08:44:20') && !s; t += 10_000) {
        await goTo(r, tr, t);
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && (O.SPEC.v131 ? /^(Tram|Bus|Métro|Bus SNCB) \S+ (dans ~?\d+ min|imminent|à ~?\d\d:\d\d)$/ : /^(dans ~?\d+ min|imminent|à ~?\d\d:\d\d)$/).test(O.norm(x.lines[0])));
      }
      check(s, `moment « board » du ${O.vehicle(j.legs[tram])} jamais affiché à la correspondance : ${show(r.page.lastScreen())}`);
      if (ctx.v131) {
        // 1.3.1 (B12 : « Tram 3 dans ~1 min » ; § 12 : « 2 min à pied → Gare du Nord, très juste » ; B16 : correspondance très
        // juste, « Si tu le rates : tram 3 à 08:51 », le suivant de la même ligne au même arrêt, s'il est connu)
        const tight = (O.connectionMargin(j, tram) ?? 99) <= 1;
        expectLines(s, O.boardLines(j, tram, T('08:43:30')), 'correspondance : monter dans le tram (PRD-1.3.1 B12, § 12)', [O.boardMissedLine(j.legs[tram])]);
        if (tight && !s.lines.some((l) => O.boardMissedLine(j.legs[tram]).test(O.norm(l)))) ctx.notes.push(`s1210go : correspondance très juste sans « Si tu le rates : ${O.vehicle(j.legs[tram])} à … » (B16 : seulement si le suivant est connu) : ${show(s)}`);
      } else expectLines(s, O.boardLines(j, tram, T('08:43:30')), 'correspondance : monter dans le tram (§ 3.2, board)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: true } };
    });
    await gstep(r, 'guide-descente-tram', async () => {
      // le PRD attend que le tram quitte l'arrêt d'avant la descente (De Brouckère, 08:48) : une position après son départ
      for (const t of [T('08:44:40'), T('08:46'), T('08:48:05'), T('08:48:25'), T('08:48:40')]) await goTo(r, tr, t);
      const s = await moment(r, 'Descends au prochain arrêt (tram)', 'Descends au prochain arrêt', 8_000);
      expectLines(s, O.alightLines(j, tram), '« Descends au prochain arrêt » (tram, ensuite : à pied)');
      momentCommon(s, title);
    });
    await gstep(r, 'guide-tu-y-es', async () => {
      let s: GlassesScreen | undefined;
      for (let t = T('08:49:10'); t <= T('08:58') && !s; t += 20_000) {
        await goTo(r, tr, t);
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && O.matches(x.lines[0], 'Tu y es'));
      }
      check(s, `« Tu y es » jamais affiché à 50 m de la place Fontainas : ${show(r.page.lastScreen())}`);
      const m = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, (\\d\\d):(\\d\\d), (à l’heure|(\\d+) min de retard|(\\d+) min d’avance)$`).exec(O.norm(s.lines[1]));
      check(m, `2e ligne « ${s.lines[1]} » au lieu de « ${title}, HH:MM, à l’heure / n min de retard / n min d’avance » (§ 3.2)`);
      momentCommon(s, title, O.HINTS.arrived);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
    await gstep(r, 'guide-terminer', async () => {
      await maskWait();
      await gesture(r, 'tap');
      const h = await waitGuide(r, 'accueil après « toucher : terminer » (§ 3.4)', (s) => s.screen === 'home');
      check(!/^En cours/.test(h.lines[0] ?? ''), `« En cours » encore sur l’accueil après la fin du guidage : ${show(h)}`);
      check(!(await followed(r)), 'trajet encore suivi (quai.trip) après « Tu y es » et « terminer »');
      return { screen: h };
    });
  }, VIEWPORT);
}

/* ------------------------------ Imprévus ------------------------------ */

async function s1210missed(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await gstep(r, 'guide-vehicule-rate', async () => {
      await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      const { j, title } = await launch(r);
      const ic = j.legs[rideLeg(j)];
      for (let t = T('07:31'); t <= T('07:43:50'); t += 60_000) await goTo(r, NAMUR_MISSED, t);
      // encore à l'arrêt 2 min après le départ : nouveau trajet depuis là (§ 3.2, replan)
      for (const t of [ic.dep + 60_000, ic.dep + 125_000, ic.dep + 150_000]) await goTo(r, NAMUR_MISSED, t);
      const s = await waitGuide(r, '« Ton IC … est parti » (replan)', (x) => isGuide(x) && /^Ton .+ est parti$/.test(O.norm(x.lines[0])), 15_000);
      const after = await followed(r);
      const next = after && after.journey.id !== j.id ? after.journey : null;
      expectLines(s, O.replanMissedLines(ic, next, j.arr), 'véhicule raté (§ 3.2, replan ; § 3.6)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
  }, VIEWPORT);
}

async function s1210passed(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    let title = FONTAINAS;
    await gstep(r, 'guide-arret-depasse', async () => {
      await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      const go = await launch(r);
      const j = go.j;
      title = go.title;
      const ic = j.legs[rideLeg(j)];
      for (let t = T('07:31'); t <= T('08:43'); t += 60_000) await goTo(r, NAMUR_PASSED, t);
      // arrêts de l'IC après la descente : lus par le guidage au début de l'étape à bord et gardés avec lui, par étape
      // (quai.trip, guide.beyondByLeg) le temps de l'étape (décision du 15/11), pas dans les arrêts de l'étape
      const onBoard = await followed(r);
      const kept = [...(ic.stops ?? []), ...(onBoard?.guide?.beyondByLeg?.legs?.[String(rideLeg(j))] ?? [])];
      const central = kept.find((x) => x.name.fr === 'Bruxelles-Central');
      check(central, `Bruxelles-Central absent des arrêts de l’IC et des arrêts suivants gardés par le guidage : ${JSON.stringify(kept.map((x) => x.name.fr))}`);
      for (const t of [T('08:44'), T('08:45'), T('08:45:30')]) await goTo(r, NAMUR_PASSED, t);
      const s = await waitGuide(r, '« Tu as passé Bruxelles-Nord » (passed)', (x) => isGuide(x) && /^Tu as passé /.test(O.norm(x.lines[0])), 15_000);
      const after = await followed(r);
      const newArr = after && after.journey.id !== j.id ? after.journey.arr : undefined;
      expectLines(s, O.passedLines(ic.to.name.fr, 'Bruxelles-Central', central.est, ic.rt, newArr), 'arrêt dépassé (§ 3.2, passed ; § 3.6)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
    await gstep(r, 'guide-arret-depasse-descendre', async () => {
      // le nouveau trajet garde l'IC jusqu'à Bruxelles-Central (décision du 15/11) : la suite d'un trajet normal,
      // « Descends au prochain arrêt » la dernière minute, puis la marche ; jamais « Partir maintenant » dans le train
      const j2 = (await followed(r))?.journey;
      const k = j2 ? j2.legs.findIndex((l) => l.kind === 'ride' && l.to.name.fr === 'Bruxelles-Central') : -1;
      check(j2 && k >= 0, `le nouveau trajet ne garde pas l’IC jusqu’à Bruxelles-Central : ${JSON.stringify(j2?.legs.map((l) => `${l.kind} ${l.from.name.fr} → ${l.to.name.fr}`))}`);
      const last = j2.legs[k].arr - 55_000;
      for (const t of [T('08:46'), T('08:46:30'), last]) await goTo(r, NAMUR_PASSED, t, t !== T('08:46'));
      const s = await moment(r, 'Descends au prochain arrêt (IC gardé jusqu’à Bruxelles-Central)', 'Descends au prochain arrêt');
      expectLines(s, O.alightLines(j2, k), '« Descends au prochain arrêt » de l’IC gardé (§ 3.6)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
    await gstep(r, 'guide-arret-depasse-a-pied', async () => {
      // descente à Bruxelles-Central, puis à pied vers la place Fontainas : jamais « Partir maintenant »
      for (const t of [T('08:48:20'), T('08:49:20'), T('08:50:20')]) await goTo(r, NAMUR_PASSED, t, t !== T('08:48:20'));
      const seen = r.page.screens().slice(r.mark).filter(isGuide);
      const bad = seen.find((x) => /^Partir maintenant/.test(O.norm(x.lines[0])));
      check(!bad, `« Partir maintenant » après l’arrêt dépassé : ${show(bad)}`);
      return { screen: seen.at(-1) ?? r.page.screens().at(-1) };
    });
  }, VIEWPORT);
}

async function s1210nofix(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    let j!: O.OJourney;
    let title = FONTAINAS;
    await gstep(r, 'guide-sans-position-partir', async () => {
      await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      ({ j, title } = await launch(r));
      await dismiss(r, '« Où tu en es »');
      await goTo(r, NAMUR_IMPRECISE, j.leaveAt + 5_000);
      const s = await moment(r, 'Partir maintenant (sans position)', 'Partir maintenant');
      expectLines(s, O.leaveLines(j, title, j.leaveAt + 5_000), '« Partir maintenant » sans position (§ 3.2)', [RATES]);
      return { screen: s };
    }, { critical: true });
    await gstep(r, 'guide-sans-position-monter', async () => {
      // sans position : « board » à l'heure d'arrivée de la marche ; jamais de virage ni de véhicule raté (§ 3.2)
      const ic = rideLeg(j);
      const walkEnd = j.legs[ic - 1]?.arr ?? j.legs[ic].dep;
      for (let t = j.leaveAt + 60_000; t < walkEnd; t += 60_000) {
        await goTo(r, NAMUR_IMPRECISE, t);
        const bad = r.page.screens().slice(r.mark).find((x) => isGuide(x) && /(à gauche|à droite|demi-tour)/.test(O.norm(x.lines[0])));
        check(!bad, `virage annoncé sans position utilisable (précision 150 m) : ${show(bad)}`);
      }
      await goTo(r, NAMUR_IMPRECISE, walkEnd + 5_000);
      const s = await moment(r, 'monter (sans position)', O.boardLines(j, ic, walkEnd + 5_000)[0]);
      expectLines(s, O.boardLines(j, ic, walkEnd + 5_000).filter((w) => w !== 'voie modifiée'), '« board » sans position', ['voie modifiée']);
      // immobile au départ, positions imprécises : jamais « est parti » (pas de véhicule raté sans position)
      await goTo(r, NAMUR_IMPRECISE, j.legs[ic].dep + 150_000);
      const missed = r.page.screens().slice(r.mark).find((x) => isGuide(x) && /est parti$/.test(O.norm(x.lines[0])));
      check(!missed, `véhicule raté annoncé sans position utilisable : ${show(missed)}`);
      return { screen: s };
    });
  }, VIEWPORT);
}

/* ------------------------------ Menu, arrêt, double toucher ------------------------------ */

/** Curseur du menu de Quai Web sur le choix `label` (1.3.0 : « Arrêter le guidage » en tête ; 1.3.1 : en dernier, B10). */
async function menuChoose(r: Run, label: string): Promise<void> {
  const m = r.page.lastScreen()!;
  const k = m.lines.findIndex((l) => O.norm(l).endsWith(label));
  check(m.screen === 'menu' && k >= 0, `choix « ${label} » absent du menu : ${show(m)}`);
  for (let i = 0; i < 6 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
  check(r.page.lastScreen()?.sel === k, `curseur du menu pas arrivé sur « ${label} » (sel ${r.page.lastScreen()?.sel})`);
}

async function s1210menu(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await gstep(r, 'menu', async () => {
      await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      await launch(r);
      await gesture(r, 'long');
      const m = await waitGuide(r, 'menu de l’appui long (§ 3.4)', (s) => s.screen === 'menu');
      const items = m.lines.filter((l) => O.MENU.some((x) => O.norm(l).endsWith(x)));
      // 1.3.1 (B10, E4) : « Voir tout le trajet », « Voir les arrêts », « Arrêter le guidage » en dernier
      check(items.length === O.MENU.length && O.MENU.every((x, i) => O.norm(items[i]).endsWith(x)), `menu : « ${O.MENU.join(' », « ')} » attendus dans cet ordre, vu ${JSON.stringify(m.lines)}`);
      return { screen: m, shot: { kind: 'menu' } };
    }, { critical: true });
    await gstep(r, 'menu-voir-tout-le-trajet', async () => {
      await menuChoose(r, 'Voir tout le trajet');
      await gesture(r, 'tap');
      const s = await waitGuide(r, '« Voir tout le trajet » : l’écran du trajet guidé (§ 3.4, § 5)', (x) => x.screen === 'steps');
      const bad = stepsHintIssue(ctx, s, 'guided');
      check(!bad, `${bad} (trajet déjà guidé, § 5 et arbitrage de l’intégrateur)`);
      await gesture(r, 'double');
      await waitGuide(r, 'retour au guidage par double toucher (§ 3.4)', isGuide);
      // l'écran du trajet est contrôlé au pixel dans le simulateur (s1210sim, s1) ; sur le canvas, capture seulement
      return { screen: s, shot: { kind: 'capture' } };
    });
    await gstep(r, 'guide-double-toucher-en-cours', async () => {
      await gesture(r, 'double');
      const h = await waitGuide(r, 'accueil, guidage continué (§ 3.4)', (s) => s.screen === 'home');
      check(/^En cours/.test(O.norm(h.lines[0])), `« En cours » en tête de l’accueil pendant le guidage : ${show(h)}`);
      for (let i = 0; i < 4 && r.page.lastScreen()?.sel !== 0; i++) await gesture(r, 'up');
      await gesture(r, 'tap');
      await waitGuide(r, '« En cours » rouvre l’écran du guidage', isGuide);
      return { screen: h };
    });
    await gstep(r, 'menu-arreter', async () => {
      await gesture(r, 'long');
      await waitGuide(r, 'menu', (s) => s.screen === 'menu');
      await menuChoose(r, 'Arrêter le guidage');
      await gesture(r, 'tap');
      const h = await waitGuide(r, 'accueil après « Arrêter le guidage » (§ 3.4)', (s) => s.screen === 'home');
      // le toast prend la place du titre de l'accueil (app/test/glasses/controller-guide-screen.test.ts)
      const toast = r.page.screens().slice(r.mark).some((s) => O.norm(s.title) === O.TOASTS.stopped || s.lines.some((l) => O.norm(l).includes(O.TOASTS.stopped)));
      check(toast, `toast « ${O.TOASTS.stopped} » absent après l’arrêt (titre de l’accueil, § 3.4) : ${r.page.screens().slice(r.mark).map(show).join(' | ')}`);
      check(!(await followed(r)), 'trajet encore suivi après « Arrêter le guidage »');
      return { screen: h };
    });
  }, VIEWPORT);
}

/* ------------------------------ « J'y descends » ------------------------------ */

async function s1210ride(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    let title = 'Vers Bruxelles-Central';
    await gstep(r, 'jy-descends-arrets', async () => {
      const h = await openWeb(r, { ...ON_PLATFORM, ...ctx.preset('p/1210.json') });
      // « Gares de train » (Namur), son tableau, l'IC de 07:42, ses arrêts
      await selectHome(r, /^Gares de train {3}/);
      await gesture(r, 'tap');
      await waitGuide(r, '« Gares de train »', (s) => s.screen === 'stations' || s.screen === 'board', 15_000);
      if (r.page.lastScreen()?.screen === 'stations') await gesture(r, 'tap');
      const b = await waitGuide(r, 'tableau de Namur', (s) => s.screen === 'board' && s.lines.some((l) => /^IC {3}/.test(l) || /IC/.test(l)), 15_000);
      const icRow = b.lines.findIndex((l) => /\bIC\b/.test(l) && /07:42/.test(l));
      check(icRow >= 0, `IC de 07:42 absent du tableau de Namur : ${show(b)}`);
      for (let i = 0; i < 12 && r.page.lastScreen()?.sel !== icRow; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < icRow ? 'down' : 'up');
      await gesture(r, 'tap');
      const st = await waitGuide(r, 'arrêts de l’IC (§ 3.1)', (s) => (s.screen === 'stops' || s.screen === 'trainRun') && s.lines.length > 3, 15_000);
      check(O.matches(hint(st), O.HINTS.stopsAlight), `aide « ${hint(st)} » au lieu de « ${O.HINTS.stopsAlight} » (§ 3.1${ctx.v131 ? ', PRD-1.3.1 § 6' : ''})`);
      // 1.3.1 (PRD-1.3.1 § 6) : sur un arrêt après la montée, « ▶ Me guider jusqu'à cet arrêt » juste au-dessus des aides
      if (ctx.v131 && (st.sel ?? 0) > ((st as unknown as { gare?: number }).gare ?? 0)) {
        const act = st.lines[st.lines.length - 2];
        check(O.matches(act, O.T131.stopsAction) || /^▶ Me guider jusqu’à \S/.test(O.norm(act)), `ligne d’action « ${O.T131.stopsAction} » attendue au-dessus des aides (PRD-1.3.1 § 6) : ${show(st)}`);
      }
      return { screen: st, shot: { kind: 'layout' } };
    }, { critical: true });
    await gstep(r, 'jy-descends-montee-sans-action', async () => {
      // l'arrêt de la montée (Namur) : pâle et sans action (§ 3.1)
      const st = r.page.lastScreen()!;
      const namur = st.lines.findIndex((l) => /\bNamur\b/.test(l));
      if (namur >= 0) {
        for (let i = 0; i < 12 && r.page.lastScreen()?.sel !== namur; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < namur ? 'down' : 'up');
        if (r.page.lastScreen()?.sel === namur) {
          await gesture(r, 'tap');
          await sleep(900);
          const moved = r.page.screens().slice(r.mark).filter((x) => x.screen !== st.screen || x.title !== st.title);
          check(!moved.length, `toucher l’arrêt de la montée a changé d’écran (il doit être pâle et sans action, § 3.1) : ${moved.map(show).join(' | ')}`);
        }
      }
    });
    await gstep(r, 'jy-descends', async () => {
      // ▼ jusqu'à Bruxelles-Central (1.3.1 : la ligne d'action prend une rangée, l'arrêt peut être sur la page suivante)
      for (let i = 0; i < 14 && !/Bruxelles-Central/.test(cursorRowText(r.page.lastScreen()!) ?? ''); i++) await gesture(r, 'down');
      const st = r.page.lastScreen()!;
      check(/Bruxelles-Central/.test(cursorRowText(st) ?? ''), `curseur jamais sur Bruxelles-Central dans les arrêts : ${show(st)}`);
      if (ctx.v131) check(O.matches(st.lines[st.lines.length - 2], '▶ Me guider jusqu’à Bruxelles-Central') || O.matches(st.lines[st.lines.length - 2], O.T131.stopsAction), `ligne d’action sur Bruxelles-Central (PRD-1.3.1 § 6, B11) : ${show(st)}`);
      await gesture(r, 'tap');
      const w = await waitGuide(r, 'guidage « j’y descends » ouvert sur « Où tu en es » (§ 3.1)', (s) => isGuide(s) && s.lines.length > 2, 15_000);
      const ft = await followed(r);
      check(ft?.guide?.kind === 'ride' || ft?.journey?.legs?.length === 1, `genre « ride » attendu pour « j’y descends » (quai.trip : ${JSON.stringify(ft?.guide ?? null)})`);
      title = ft?.title ?? title;
      // 1.3.1 (§ 12) : « Jusqu'à … » est aussi le titre de « j'y descends » (écran du guidage, carte « En cours », journal)
      if (ctx.v131) title = title.replace(/^Vers /, 'Jusqu’à ');
      if (ctx.v131 && O.matches(w.title, O.T131.whereTitle)) {
        // 1.3.1 (§ 12) : « Où tu en es » d'un « j'y descends » : « Jusqu’à Bruxelles-Central », « Quai te dit quand descendre », pas de chaîne
        const j = ft!.journey;
        const l = j.legs[rideLeg(j)];
        whereOk131(w, O.whereRide131(j, title, Math.max(1, (l.stops ?? []).findIndex((x) => x.est > Date.parse('2026-11-10T07:38:00+01:00')))), '« Où tu en es » de « j’y descends » (PRD-1.3.1 § 12)');
      } else check(O.norm(w.title).startsWith(O.norm(title)), `titre « ${w.title} » (« ${title} » attendu, § 3.2)`);
      // genre ride : seulement le véhicule ; pas de marche dans la chaîne
      check(!w.lines.some((l) => /à pied/.test(O.norm(l))), `« Où tu en es » d’un « j’y descends » sans marche : ${show(w)}`);
      return { screen: w, shot: { kind: 'guide', image: false } };
    }, { critical: true });
    await gstep(r, 'jy-descends-descente', async () => {
      const ft = await followed(r);
      const j = ft!.journey;
      const ic = rideLeg(j);
      for (let t = T('07:44:10'); t <= T('08:43:30'); t += 120_000) await goTo(r, RIDE_CENTRAL, t);
      // pas avant 4 min de l'arrivée (08:48) : après le départ de Bruxelles-Nord, à 08:44
      for (const t of [T('08:43:40'), T('08:44:10'), T('08:44:40')]) await goTo(r, RIDE_CENTRAL, t);
      const s = await moment(r, 'Descends au prochain arrêt (ride)', 'Descends au prochain arrêt', 10_000);
      expectLines(s, ['Descends au prochain arrêt', `Bruxelles-Central, ${(j.legs[ic].rt ? '' : '~') + O.hm(j.legs[ic].arr)}`], '« j’y descends » : descente (§ 3.2, alight, genre ride)');
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: false } };
    });
    await gstep(r, 'jy-descends-tu-y-es', async () => {
      for (const t of [T('08:48:10'), T('08:49:10'), T('08:50'), T('08:50:30'), T('08:51')]) await goTo(r, RIDE_CENTRAL, t);
      const s = await moment(r, 'Tu y es (ride)', 'Tu y es', 10_000);
      momentCommon(s, title, O.HINTS.arrived);
      return { screen: s };
    });
  }, VIEWPORT);
}

/* ------------------------------ Réglage éteint, premier plan ------------------------------ */

async function s1210off(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await gstep(r, 'reglage-eteint', async () => {
      await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      // « Me guider pendant un trajet » éteint (PRD § 3.5, § 4.1), puis réouverture
      await page.eval(`(() => { const s = JSON.parse(localStorage.getItem('quai.settings')); s.display = { ...s.display, guide: false }; localStorage.setItem('quai.settings', JSON.stringify(s)); return true; })()`);
      await openWeb(r, { ...START });
      const steps = await goFontainas(r);
      check(steps.screen === 'steps', 'écran du trajet');
      await gesture(r, 'tap');
      await sleep(1200);
      const after = r.page.screens().slice(r.mark);
      check(after.some((s) => s.lines.some((l) => O.norm(l).startsWith(O.TOASTS.followed))), `toast « ${O.TOASTS.followed} » attendu (§ 3.5), vus : ${after.map(show).join(' | ')}`);
      check(!after.some(isGuide), `écran du guidage ouvert alors que « Me guider » est éteint : ${after.filter(isGuide).map(show).join(' | ')}`);
      // le temps passe, la personne marche, monte, descend : aucun écran ne change seul
      const before = r.page.lastScreen();
      r.mark = r.page.screens().length;
      for (const t of [T('07:31:05'), T('07:36'), T('07:41'), T('07:44:10'), T('07:56:05'), T('08:38:05')]) await goTo(r, NAMUR_FONTAINAS, t);
      const moved = r.page.screens().slice(r.mark).filter((s) => s.screen !== before?.screen || (s.screen !== 'steps' && s.screen !== 'home'));
      check(!moved.length, `écran changé seul avec « Me guider » éteint (§ 3.5) : ${moved.map(show).join(' | ')}`);
      for (let i = 0; i < 4 && r.page.lastScreen()?.screen !== 'home'; i++) await gesture(r, 'double');
      const h = r.page.lastScreen()?.screen === 'home' ? r.page.lastScreen()! : await waitGuide(r, 'accueil avec « En cours »', (s) => s.screen === 'home');
      check(/^En cours/.test(O.norm(h.lines[0])), `« En cours » en tête de l’accueil (§ 3.5) : ${show(h)}`);
      await gesture(r, 'tap');
      const s = await waitGuide(r, '« En cours » ouvre l’écran du trajet (§ 3.5)', (x) => x.screen === 'steps');
      return { screen: s };
    });
  }, VIEWPORT);
}

async function s1210fg(ctx: Ctx): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await gstep(r, 'premier-plan-revenu', async () => {
      await openWeb(r, { ...START, ...ctx.preset('p/1210.json') });
      const { j, title } = await launch(r);
      await dismiss(r, '« Où tu en es »');
      await goTo(r, NAMUR_FONTAINAS, T('07:36:05'));
      const cur = r.page.lastScreen();
      if (cur && isGuide(cur) && !isEmpty(cur)) await dismiss(r, 'moment en cours');
      // premier plan quitté (FOREGROUND_EXIT ; Quai Web : page cachée) : le guidage calcule, l'affichage attend (§ 3.7)
      const vis = (hidden: boolean) => page.eval(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${hidden ? 'hidden' : 'visible'}' }); document.dispatchEvent(new Event('visibilitychange')); return true; })()`);
      await vis(true);
      // (la trace suit les rues, 700 m : à 60 m de la gare vers 07:41:50, une minute plus tard que l'ancienne trace en biais)
      for (const t of [T('07:40'), T('07:41'), T('07:42:05')]) await goTo(r, NAMUR_FONTAINAS, t);
      r.mark = r.page.screens().length;
      await vis(false);
      const ic = rideLeg(j);
      const s = await waitGuide(r, 'page du moment présent reconstruite au retour (§ 3.7)', (x) => isGuide(x) && O.matches(x.lines[0], O.boardLines(j, ic, T('07:42:05'))[0]), 10_000);
      momentCommon(s, title);
      return { screen: s, shot: { kind: 'guide', image: true } };
    });
  }, VIEWPORT);
}

/* ------------------------------ Simulateur Even Hub : favoris, trajet, nouveautés ------------------------------ */

async function s1210sim(ctx: Ctx): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, false));
  await ctx.step('favoris', async () => {
    const h = await sim.waitScreen((s) => s.screen === 'home' && !s.lines.some((l) => /…$|^Chargement/.test(l)), 25_000, 'accueil');
    // 1.3.1 (PRD-1.3.1 § 8) : « Favoris   7 » sous « Autour de moi » ; avant : en tête de l'accueil
    const fi = h.lines.filter((l) => l !== '').findIndex((l) => /^Favoris {3}7$/.test(l));
    check(fi === (ctx.v131 ? 1 : 0), `« Favoris   7 » ${ctx.v131 ? 'sous « Autour de moi »' : 'en tête de l’accueil'} : ${JSON.stringify(h.lines)}`);
    await sim.select(fi);
    await sim.input('click');
    const f = await sim.waitScreen((s) => s.screen === 'favorites' && !s.lines.some((l) => /…$/.test(l)), 20_000, 'Favoris');
    const detail = (f as unknown as Record<string, unknown>).detail;
    if (ctx.v130) {
      // 1.3.0 (PRD-1.3.0 § 7) : une rangée par favori, la rangée du curseur ouverte sur 1 ou 2 lignes pâles en retrait,
      // plus de ligne du détail en bas
      const open = accordionLines(f);
      const rows = f.lines.slice(0, -1).filter((l) => !open.includes(l) && l !== 'ADRESSES RÉCENTES');
      const bad = rows.filter((l) => !FAV_ROW.test(l));
      check(!bad.length, `rangées des favoris au format de l’accueil : ${JSON.stringify(bad)} dans ${JSON.stringify(f.lines)}`);
      check(detail === undefined, `champ « detail » encore journalisé (la ligne du détail en bas disparaît, PRD-1.3.0 § 7) : « ${String(detail)} »`);
      check(open.length === 2 && f.lines[1] === open[0] && f.lines[2] === open[1], `accordéon sous « ${FONTAINAS} » (curseur) : 2 lignes attendues juste dessous, vu ${JSON.stringify(f.lines)}`);
      if (ctx.v131) {
        // 1.3.1 (PRD-1.3.1 § 4) : la gare où monter, puis le premier véhicule et son heure, puis les changements
        check(/^à pied \d+ min → Namur$/.test(O.norm(open[0])), `1re ligne de l’accordéon « ${open[0]} » au lieu de « à pied 9 min → Namur » (PRD-1.3.1 § 4)`);
        check(/^IC (~?07:4[24]|07:42 \+2)( voie 6 !| voie 6 au lieu de 4)?(, 1 changement( : tram 3)?)?$/.test(O.norm(open[1])), `2e ligne « ${open[1]} » au lieu de « IC 07:42 +2 voie 6 au lieu de 4, 1 changement : tram 3 » (PRD-1.3.1 § 4)`);
      } else {
        check(/^à pied \d+ min, puis IC ~?07:4[24]( \+2)? voie 6 !$/.test(O.norm(open[0])), `1re ligne de l’accordéon « ${open[0]} » au lieu de « à pied 9 min, puis IC ~07:42 voie 6 ! » (PRD-1.3.0 § 7)`);
        check(/^voie 6 au lieu de 4\b.*\b1 changement : tram 3$/.test(O.norm(open[1])), `2e ligne « ${open[1]} » : le souci en tête (« voie 6 au lieu de 4 »), puis « 1 changement : tram 3 » (PRD-1.3.0 § 7)`);
      }
      return { screen: f };
    }
    // § 2 : une rangée par favori (7 à l'écran), le détail du favori choisi en bas, au-dessus des aides
    const rows = f.lines.slice(0, 7);
    const bad = rows.filter((l) => !FAV_ROW.test(l));
    check(!bad.length, `rangées des favoris au format de l’accueil (§ 2) : ${JSON.stringify(bad)} dans ${JSON.stringify(f.lines)}`);
    check(f.lines.length >= 9, `7 favoris, la ligne du détail et l’aide sur un écran (§ 2, capacité 7) : ${JSON.stringify(f.lines)}`);
    const det = O.norm(typeof detail === 'string' ? detail : f.lines[f.lines.length - 2]);
    check(det === 'IC 07:42 +2 voie 6 !, 1 changement', `détail du favori « ${FONTAINAS} » en bas : « ${det} » au lieu de « IC 07:42 +2 voie 6 !, 1 changement » (§ 2, favoriteDetail)`);
    return { screen: f };
  });
  await ctx.step('favoris-detail-suit-le-curseur', async () => {
    const before = sim.last!;
    await sim.select((before.sel ?? 0) + 1);
    const s = await sim.waitScreen((x) => x.screen === 'favorites' && x.sel !== before.sel, 8_000, 'curseur sur le favori suivant');
    if (ctx.v130) {
      // 1.3.0 (PRD-1.3.0 § 7) : le détail du premier se referme, celui du suivant s'ouvre juste sous lui
      const was = accordionLines(before);
      const open = accordionLines(s);
      check(!was.some((l) => s.lines.includes(l) && !open.includes(l)), `accordéon du favori quitté resté ouvert après ▼ : ${JSON.stringify(s.lines)}`);
      const k = s.lines.findIndex((l) => open.includes(l));
      check(!open.length || (k >= 2 && FAV_ROW.test(s.lines[k - 1]) && s.lines[k - 1] !== before.lines[0]), `accordéon ouvert ailleurs que sous le favori du curseur : ${JSON.stringify(s.lines)}`);
    } else check(s.lines[s.lines.length - 2] !== before.lines[before.lines.length - 2], `ligne du détail inchangée après ▼ (§ 2 : le détail du favori sous le curseur) : ${JSON.stringify(s.lines)}`);
    await sim.select(0);
    return { screen: s };
  });
  await ctx.step('trajet', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'steps' && !x.lines.some((l) => /^Calcul|…$/.test(l)), 20_000, 'écran du trajet');
    // § 5 : titre = nom du trajet, heure à droite ; ligne du haut ; une rangée par étape ; aides
    check(s.title === FONTAINAS, `titre « ${s.title} » au lieu de « ${FONTAINAS} » (§ 5)`);
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6' || /^Départ \d\d:\d\d, dans \d+ min {3}arrivée ~?\d\d:\d\d$/.test(s.lines[0] ?? ''), `ligne du haut « ${s.lines[0]} » (§ 5 : « Départ 07:05, dans 3 min   arrivée 08:54 », ou l’alerte du trajet)`);
    // 1.3.0 : la ligne d'action prend place juste au-dessus des aides (PRD-1.3.0 § 1)
    const rows = s.lines.slice(1, ctx.v130 ? -3 : -2);
    // 1.3.1 (PRD-1.3.1 § 4) : une marche vers un véhicule nomme l'arrêt où monter (« à pied 7 min → Flagey ») ; B14 : la
    // dernière porte l'heure d'arrivée à droite
    const re = /^~?\d\d:\d\d (à pied \d+ min(?: → .+?)?(, pluie)?|(Bus|Tram|Métro|IC|S\d+|L|P|Bus SNCB)\b.*? → .+?)( {3}(~?\d\d:\d\d|marge \d+ min|très juste|SUPPRIMÉ))?$/;
    const bad = rows.filter((l) => l && !re.test(l) && !/^Fin du trajet\.|^▽ /.test(l));
    check(!bad.length, `rangées d’étapes (§ 5 : « 07:12   Bus 6 → Gare des Guillemins   07:20 », « à pied 5 min ») : ${JSON.stringify(bad)}`);
    check(rows.some((l) => /^~?07:4[24] IC voie 6 ! → Bruxelles-Nord {3}08:42$/.test(l)), `rangée de l’IC « 07:44 IC voie 6 ! → Bruxelles-Nord   08:42 » (voie modifiée, § 5) : ${JSON.stringify(rows)}`);
    const bad2 = stepsHintIssue(ctx, s, 'go');
    check(!bad2, bad2 ?? '');
    return { screen: s };
  });
  await ctx.step('guide-ou-tu-en-es-simulateur', async () => {
    // simulateur Even Hub : « y aller », « Où tu en es » dessiné par le vrai simulateur (contrôle au pixel du guidage)
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'guide' && x.lines.length > 2, 15_000, '« Où tu en es » au lancement');
    const shot = await sim.rawShot();
    writeFileSync(join(ctx.shots, 's1210-simulateur-ou-tu-en-es.png'), shot);
    const bad = checkGuidePixels(shot, s as unknown as GuideShot, { image: false });
    check(!bad.length, `contrôle au pixel (simulateur) :\n        ${bad.join('\n        ')}`);
    return { screen: s, shot: false };
  });
  await ctx.step('guide-menu-systeme', async () => {
    // appui long dans l'appli Even : menu système avec les 2 choix du guidage (menuObject, SDK 0.0.14+)
    await sim.input('long_press' as never);
    await sleep(600);
    await sim.input('long_press_release' as never);
    await sleep(600);
    await sim.drain();
    const logged = sim.screens.filter((x) => x.screen === 'guide').map((x) => (x as unknown as { menu?: { id: number; label: string }[] }).menu).find(Boolean);
    // 1.3.1 (B10) : trois choix dans l'ordre du PRD (les identifiants restent ceux du contrôleur)
    const menuOk = logged ? (ctx.v131 ? JSON.stringify(logged.map((m) => m.label)) === JSON.stringify(O.MENU) : JSON.stringify(logged.map((m) => [m.id, m.label])) === JSON.stringify([[1, O.MENU[0]], [2, O.MENU[1]]])) : /Arrêter le guidage/.test(sim.out.join(''));
    check(menuOk, `menu système de l’appui long : choix ${JSON.stringify(logged ?? null)} au lieu de ${JSON.stringify(O.MENU)} (QUAI_SCREEN \`menu\` des pages du guidage, § 3.4${ctx.v131 ? ', PRD-1.3.1 B10' : ''})`);
  });
}

async function s1210news(ctx: Ctx): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...START, ...ctx.preset('p/1210news.json') }, false));
  await ctx.step('nouveautes', async () => {
    if (ctx.v130) {
      // 1.3.0 (PRD-1.3.0 § 9) : depuis la 1.2.9, « Quai 1.3.0 » : ses trois lignes, puis celles de la 1.2.10 (une version
      // entière ou rien, 8 lignes au plus). 1.3.1 (PRD-1.3.1 § 9, décision du 21/11) : « Quai 1.3.1 » : ses quatre
      // lignes, puis les trois de la 1.3.0 ; les deux de la 1.2.10 ne tiennent plus
      const title = ctx.v131 ? NEWS_131_TITLE : NEWS_130_TITLE;
      const s = await sim.waitScreen((x) => x.screen === 'message' && x.title === title, 20_000, `message « ${title} »`);
      const body = s.lines.slice(0, -1).map(O.norm);
      const want = ctx.v131 ? [...NEWS_131, ...NEWS_130] : [...NEWS_130, ...NEWS_1210.slice(0, 2)];
      check(JSON.stringify(body) === JSON.stringify(want), `lignes du message « ${title} » depuis la 1.2.9 : ${JSON.stringify(body)} au lieu de ${JSON.stringify(want)}`);
      const typo = O.typographyIssues([s.title, ...s.lines]);
      check(!typo.length, typo.join(' ; '));
      return { screen: s };
    }
    // 1.3.0 : app.json déjà en 1.3.0 avant la fusion, le message reste « Quai 1.2.10 » tant que les écrans de la 1.3.0
    // ne sont pas fusionnés : la version doit seulement être au moins 1.2.10
    const v = ctx.appVersion.split('.').map(Number);
    check(v[0] > 1 || (v[0] === 1 && (v[1] > 2 || (v[1] === 2 && (v[2] ?? 0) >= 10))), `app.json en ${ctx.appVersion} : la montée de version 1.2.10 manque (message « ${NEWS_1210_TITLE} » impossible)`);
    const s = await sim.waitScreen((x) => x.screen === 'message' && x.title === NEWS_1210_TITLE, 20_000, `message « ${NEWS_1210_TITLE} »`);
    const body = s.lines.slice(0, -1);
    check(JSON.stringify(body.slice(0, 3)) === JSON.stringify(NEWS_1210), `lignes du message (§ 7) : ${JSON.stringify(body)} au lieu de ${JSON.stringify(NEWS_1210)}`);
    return { screen: s };
  });
}

/** Scénarios 1.2.10, dans l'ordre du rapport. */
export function scenarios1210(ctx: Ctx): [string, string, () => Promise<void>][] {
  return [
    ['s1210sim', '1.2.10 (simulateur Even Hub) : favoris d’une ligne chacun et détail en bas, écran du trajet, « Où tu en es » au pixel, menu système de l’appui long', () => s1210sim(ctx)],
    ['s1210go', '1.2.10 (Quai Web) : « y aller » de la place de l’Ange (Namur) à la place Fontainas, chaque moment, « où tu en es », effacer, tu y es', () => s1210go(ctx)],
    ['s1210missed', '1.2.10 (Quai Web) : véhicule raté, nouveau trajet', () => s1210missed(ctx)],
    ['s1210passed', '1.2.10 (Quai Web) : arrêt dépassé', () => s1210passed(ctx)],
    ['s1210nofix', '1.2.10 (Quai Web) : sans position utilisable (à l’heure seule)', () => s1210nofix(ctx)],
    ['s1210menu', '1.2.10 (Quai Web) : appui long, « Voir tout le trajet », double toucher et « En cours », « Arrêter le guidage »', () => s1210menu(ctx)],
    ['s1210ride', '1.2.10 (Quai Web) : « j’y descends » depuis les arrêts d’un départ', () => s1210ride(ctx)],
    ['s1210off', '1.2.10 (Quai Web) : « Me guider pendant un trajet » éteint', () => s1210off(ctx)],
    ['s1210fg', '1.2.10 (Quai Web) : premier plan quitté puis revenu', () => s1210fg(ctx)],
    ['s1210news', `1.2.10 (simulateur Even Hub) : message « ${ctx.v131 ? NEWS_131_TITLE : ctx.v130 ? NEWS_130_TITLE : NEWS_1210_TITLE} » depuis la 1.2.9`, () => s1210news(ctx)],
  ];
}

/** Liste des scénarios 1.2.10 (commande unique de l'intégrateur). */
export const S1210_IDS = ['s1210sim', 's1210go', 's1210missed', 's1210passed', 's1210nofix', 's1210menu', 's1210ride', 's1210off', 's1210fg', 's1210news'];
