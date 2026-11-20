/**
 * Quai 1.3.1 : scénarios de bout en bout du simulateur (préfixe s131), écrits d'après docs/v1.3.1/PRD-1.3.1.md seul (§ 1
 * à § 8, § 12 : A1 à A8, B9 à B21, C) et les notes des experts (docs/v1.3.1/experts/), avant la fusion des pôles : les
 * textes exacts du PRD sont des chaînes (sim/guide-oracle.ts, T131) ; là où le PRD laisse la forme aux équipes, des
 * motifs, et chaque échec dit le texte du PRD, celui de l'écran et le point du PRD.
 *
 *  - Simulateur Even Hub (vraies captures 576 × 288, contrôle au pixel) : accueil (§ 8, B15, L6), écran du trajet et
 *    accordéons (§ 4, B14, B21), arrêts d'un départ (§ 6), accueil du soir (B20), apostrophes des données (§ 7).
 *  - Quai Web dans Chrome (positions poussées, horloge pilotée, comme les s1210 et s130) : écran calme et trois points
 *    (§ 1, B9), « masquer » (§ 2), toucher trop tôt (A7), messages importants qui ramènent l'écran du guidage (A1), menu
 *    de l'appui long (B10), marche après la descente (B17), arrêt retenu (B11), bus raté en marchant (A2), sans temps
 *    réel (A3), demi-tour (A6), sous terre (A8, L3), pluie au départ (B19), téléphone et onglet Réglages (§ 4, § 7, § 8,
 *    L2, L5, L7, L8, U3).
 *
 * Joués avec les attentes 1.3.1 (`npm run sim -- --only 's131*'`, défaut de run-sim.ts après la fusion). Lieux publics
 * seulement (places, gares, arrêts). Captures : tests/e2e/screens/<scénario>-<étape>.png.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFeeds, feedZip, loadNetwork } from '../../../fixtures/pipeline/make-gtfs';
import type { Screen, Sim } from '../lib/sim';
import { buildFixtureData, buildWalkTiles, GTFS } from '../lib/stack';
import { joinTrace, pointAt, stay, walk, type LatLon, type Trace, type TracePoint } from '../traces/geo';
import { NAMUR_FONTAINAS, PLACES, toFix } from '../traces/traces';
import type { GlassesScreen, Page } from './cdp';
import * as O from './guide-oracle';
import { canvasToShot, checkCalmPixels, checkGuidePixels, litCount, type GuideShot } from './guide-pixels';
import { accordionLines, alphaIn, checkPixels, cursorRowText, HOME_INDENT, levels, truncatedLines } from './pixels';
import type { Ctx130 } from './s130';

/** Ce que run-sim.ts prête aux scénarios 1.3.1 (les mêmes services que les s130). */
export type Ctx131 = Ctx130;

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
const N = O.norm;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TXT = O.T131;

/* ------------------------------ Situations (lieux publics) ------------------------------ */

/** Place de l'Ange à Namur, mardi 10/11/2026 à 07:20 (comme les s1210 et s130). */
const START = { mockLat: String(PLACES.placeAnge.lat), mockLon: String(PLACES.placeAnge.lon), mockNow: '2026-11-10T07:20:00+01:00' };
/** Sur le quai de la voie 6 à Namur, 07:38 (« j'y descends », arrêts de l'IC de 07:42). */
const ON_PLATFORM = { mockLat: String(PLACES.namurVoie6.lat), mockLon: String(PLACES.namurVoie6.lon), mockNow: '2026-11-10T07:38:00+01:00' };
/** Waterloo, chaussée de Bruxelles (scénario 4 des fixtures), 07:31. */
const WAT = { mockLat: '50.7175', mockLon: '4.399', mockNow: '2026-11-10T07:31:00+01:00' };
/** Namur, place de l'Ange, 23:30 : plus aucun trajet dans les 3 h (B20, U8). */
const LATE = { ...START, mockNow: '2026-11-10T23:30:00+01:00' };
const FONTAINAS = 'Place Fontainas';
/** Gare du Nord (Bruxelles, scénario 2 des fixtures), 12:10. */
const GDN = { lat: 50.86, lon: 4.359 };
const S2_GDN = { mockLat: String(GDN.lat), mockLon: String(GDN.lon), mockNow: '2026-11-10T12:10:00+01:00' };

/** Préréglages des s131 (écrits par run-sim.ts dans p/), d'après celui de la 1.2.10. */
export function presets131(base: { p1210: Record<string, unknown> }): Record<string, unknown> {
  const p = base.p1210 as { favorites: { kind: string; id: string }[]; places: unknown[] };
  return {
    // § 9 : qui vient de la 1.3.0 ne voit aucun message des nouveautés (NEWS_SINCE reste 1.3.0)
    '131from130.json': { ...base.p1210, seenVersion: '1.3.0' },
    // U3 (c) : un trajet qui commence à pied vers un arrêt de métro (Rogier), vers le boulevard du Centenaire (Heysel)
    '131centenaire.json': {
      ...base.p1210,
      places: [{ id: 'centenaire', label: 'Boulevard du Centenaire', lat: 50.8915, lon: 4.334, address: 'Boulevard du Centenaire 1, 1020 Bruxelles', src: 'address' }],
      favorites: [{ kind: 'trip', id: 'fav-centenaire', from: { type: 'here' }, to: { type: 'place', placeId: 'centenaire' }, label: 'Boulevard du Centenaire', propose: 'never' }],
      recent: [],
    },
    // § 7 : la gare de Braine-l'Alleud (nom des données avec une apostrophe droite) gardée dans « Gares de train »
    '131apos.json': {
      ...base.p1210,
      favorites: [...p.favorites.filter((f) => f.kind !== 'stop'), { kind: 'stop', id: 'fav-braine', areaId: 'sncb:8814209', op: 'sncb', name: { fr: "Braine-l'Alleud", nl: 'Eigenbrakel' }, lat: BRAINE.lat, lon: BRAINE.lon, propose: 'never' }, { kind: 'stop', id: 'fav-waterloo', areaId: 'sncb:8814266', op: 'sncb', name: { fr: 'Waterloo', nl: 'Waterloo' }, lat: 50.7154, lon: 4.3835, propose: 'never' }],
    },
  };
}

/* ------------------------------ Données : apostrophes (§ 7) ------------------------------ */

/** Gare de Braine-l'Alleud (SNCB 8814209), sur la ligne 124 entre Nivelles et Waterloo. */
const BRAINE = { lat: 50.6834, lon: 4.3717 };

/**
 * Données des fixtures avec la gare de Braine-l'Alleud, écrite comme dans les vraies données de la SNCB (apostrophe droite,
 * « Braine-l'Alleud ») : les S1 de Nivelles y passent 9 min avant Waterloo, et un S1 de Bruxelles-Midi y finit (destination
 * « Braine-l'Alleud ») : à Waterloo à 07:31, le tableau et tout le trajet d'un train montrent le nom des données.
 */
async function aposData(ctx: Ctx131): Promise<string> {
  const net = loadNetwork();
  const sncb = net.ops.sncb;
  sncb.stations.push({ uic: '8814209', name: "Braine-l'Alleud", fr: "Braine-l'Alleud", nl: 'Eigenbrakel', lat: BRAINE.lat, lon: BRAINE.lon, platforms: ['1', '2'] });
  // les S1 de Nivelles vers Bruxelles-Nord : Braine-l'Alleud 6 min avant Waterloo (les heures de Waterloo ne changent pas)
  for (const t of sncb.trips) {
    if (t.route !== 'S1') continue;
    const k = t.st.findIndex((x) => x[0].startsWith('8814266'));
    if (k <= 0) continue;
    const [h, m] = t.st[k][1].split(':').map(Number);
    const at = h * 60 + m - 6;
    t.st.splice(k, 0, [`8814209_1`, `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`]);
  }
  // un S1 de Bruxelles-Midi vers Braine-l'Alleud : Waterloo à 07:52 (voie 2), terminus à 07:58
  sncb.trips.push({ id: '88____:046::8814001:8814209:4:758:20261231', route: 'S1', service: 'DAILY', num: '1968', head: "Braine-l'Alleud", st: [['8814001_6', '07:32'], ['8814266_2', '07:52'], ['8814209_2', '07:58']] });
  const tmp = mkdtempSync(join(tmpdir(), 'quai-s131-apos-'));
  writeFileSync(join(tmp, 'sncb.zip'), feedZip(buildFeeds(net).sncb));
  const sources = ['sncb', 'stib', 'delijn', 'tec'].map((op) => `${op}=${op === 'sncb' ? join(tmp, 'sncb.zip') : join(GTFS, `${op}.zip`)}`).join(',');
  const { dir } = await buildFixtureData({ sources, out: join(tmp, 'data') });
  await buildWalkTiles(dir);
  return ctx.serveData(dir);
}

/* ------------------------------ Simulateur : aides ------------------------------ */

async function lastOrWait(sim: Sim, pred: (s: Screen) => boolean, timeout: number, label: string): Promise<Screen> {
  await sim.drain();
  if (sim.last && pred(sim.last)) return sim.last;
  return sim.waitScreen(pred, timeout, label);
}
const homeLoaded = (s: Screen) => s.screen === 'home' && loaded(s) && s.lines.some((l) => /^Autour de moi {3}/.test(l));
async function simHome(sim: Sim, timeout = 25_000): Promise<Screen> {
  return lastOrWait(sim, homeLoaded, timeout, 'accueil chargé');
}
/** Double toucher jusqu'à l'accueil, un écran à la fois (jamais sur l'accueil : il quitterait Quai). */
async function simBackHome(sim: Sim): Promise<Screen> {
  for (let i = 0; i < 6; i++) {
    await sim.drain();
    if (sim.last?.screen === 'home') return simHome(sim);
    await sim.input('double_click', 300);
    await sim.waitScreen(() => true, 8_000, 'écran d’avant (double toucher)');
  }
  return simHome(sim);
}

/** Lignes des éléments de l'accueil, dans l'ordre de `sel` : sans la ligne du haut, la ligne vide, le jour férié ni l'aide. */
const TOP_HOME = /^(Temps réel indisponible|Pas de réseau|Horaires |Près de |! )/;
function homeItems(s: { lines: string[] }): string[] {
  const l = [...s.lines];
  if (TOP_HOME.test(l[0] ?? '')) l.shift();
  return l.filter((x) => x !== '' && !/^Jour férié/.test(x) && !/^△▽ /.test(x));
}
async function simSelectHome(sim: Sim, re: RegExp): Promise<number> {
  const k = homeItems(sim.last!).findIndex((x) => re.test(x));
  check(k >= 0, `élément ${re} absent de l’accueil : ${show(sim.last)}`);
  await sim.select(k);
  return k;
}

/** Rubriques de l'accueil 1.3.1 (§ 8) et leur rang parmi les éléments ; les favoris entre « Favoris » et « Gares de train ». */
const SECTION_RE = [/^Autour de moi {3}/, /^(Favoris {3}\d+|Ajouter un favori)( {3}|$)/, /^Gares de train {3}/, /^Lignes de bus, tram, métro {3}/, /^Arrêts de bus, tram, métro {3}/];
/**
 * § 8 : l'ordre de l'accueil (Autour de moi ; Favoris et ses favoris ; Gares ; Lignes ; Arrêts), au plus une ligne
 * vide entre deux éléments ; rend les rangs (sel) des cinq rubriques et les favoris montrés.
 */
export function homeOrderIssues(s: { lines: string[] }): { bad: string[]; at: number[]; favs: string[] } {
  const items = homeItems(s);
  const at = SECTION_RE.map((re) => items.findIndex((x) => re.test(x)));
  const bad: string[] = [];
  const names = TXT.home;
  at.forEach((k, i) => {
    if (k < 0) bad.push(`« ${names[i]} » absent de l’accueil`);
  });
  const running = /^En cours/.test(items[0] ?? '') ? 1 : 0;
  if (!bad.length) {
    if (at[0] !== running) bad.push(`« Autour de moi » en ${at[0] + 1}e place au lieu de la première${running ? ' (sous « En cours »)' : ''} (PRD-1.3.1 § 8)`);
    for (let i = 1; i < 5; i++) if (at[i] <= at[i - 1]) bad.push(`« ${names[i]} » avant « ${names[i - 1]} » (ordre du PRD-1.3.1 § 8 : ${names.join(' ; ')})`);
    if (at[3] !== at[2] + 1 || at[4] !== at[3] + 1) bad.push(`« Gares de train », « Lignes … » et « Arrêts … » à la suite (§ 8) : ${JSON.stringify(items)}`);
    if (at[1] !== at[0] + 1) bad.push(`« Favoris » juste après « Autour de moi » (§ 8) : ${JSON.stringify(items)}`);
  }
  const favs = at[1] >= 0 && at[2] > at[1] ? items.slice(at[1] + 1, at[2]) : [];
  const blanks = s.lines.map((l, i) => (l === '' ? i : -1)).filter((i) => i >= 0);
  if (blanks.length > 1) bad.push(`${blanks.length} lignes vides sur l’accueil (une au plus) : ${JSON.stringify(s.lines)}`);
  if (blanks.some((i) => i === 0 || i === s.lines.length - 1)) bad.push(`ligne vide en tête ou en fin de l’accueil : ${JSON.stringify(s.lines)}`);
  const cut = truncatedLines(s as Screen);
  if (cut.length) bad.push(`lignes coupées : ${JSON.stringify(cut)}`);
  return { bad, at, favs };
}

/** Ligne d'action (juste au-dessus des aides) d'un écran, si elle commence par « ▶ ». */
const actionOf = (s: { lines: string[] }): string | undefined => {
  const l = s.lines[s.lines.length - 2];
  return l !== undefined && /^▶ /.test(l) ? l : undefined;
};

/** Capture du simulateur : alpha de la bande dont le libellé est `label` (« ligne d’action », « aide », « ligne 2 »…). */
async function bandAlpha(sim: Sim, s: Screen, label: string): Promise<number> {
  await sleep(300);
  const png = await sim.rawShot();
  const b = levels(png, s).find((l) => l.label === label);
  check(b, `bande « ${label} » introuvable sur la capture (bandes : ${levels(png, s).map((l) => l.label).join(', ')})`);
  return b.alpha;
}

/** Contrôles communs d'une liste : aide exacte, rien de coupé au milieu d'un mot, typographie (jamais d'apostrophe droite). */
function listCommon(s: Screen | GlassesScreen, wantHint: string, label: string): void {
  check(O.matches(hint(s), wantHint), `${label} : aide « ${N(hint(s))} » au lieu de « ${wantHint} »`);
  const cut = truncatedLines(s as Screen);
  check(!cut.length, `${label} : lignes coupées par « … » : ${JSON.stringify(cut)}`);
  const typo = O.typographyIssues([s.title, ...s.lines]);
  check(!typo.length, `${label} : ${typo.join(' ; ')}`);
}

/* ------------------------------ Quai Web : aides (comme sim/s1210.ts et sim/s130.ts) ------------------------------ */

const CANVAS_CSS = '.w-canvas{width:576px !important;height:288px !important;max-width:none !important;max-height:none !important}';
const VIEWPORT = { width: 1280, height: 1000, dpr: 1, mobile: false };
interface Run {
  ctx: Ctx131;
  page: Page;
  mark: number;
  blocked?: string;
}
const isGuide = (s: GlassesScreen) => s.screen === 'guide';
/** Écran calme d'un guidage (1.3.1) : sans titre, seulement « · · · » ou, à bord, la ligne de progression (B9). */
const calmLines = (s: GlassesScreen) => s.lines.filter((l) => l.trim());
const isCalm = (s: GlassesScreen) => isGuide(s) && !s.title && calmLines(s).every((l) => O.matches(l, TXT.dots) || O.PROGRESS_RE.test(N(l)));
const isDots = (s: GlassesScreen) => isCalm(s) && calmLines(s).length === 1 && O.matches(calmLines(s)[0], TXT.dots);
const isProgress = (s: GlassesScreen) => isCalm(s) && calmLines(s).length === 1 && O.PROGRESS_RE.test(N(calmLines(s)[0]));
const isWhere = (s: GlassesScreen) => isGuide(s) && (s.show === 'where' || O.matches(s.title, TXT.whereTitle));
const momentKind = (s: GlassesScreen) => (s.moment && typeof s.moment === 'object' ? String((s.moment as { kind?: unknown }).kind ?? '') : '');
const IMPORTANT = new Set(['leave', 'board', 'platform', 'alight', 'replan', 'passed']);

async function openWeb(r: Run, url: string): Promise<GlassesScreen> {
  await r.page.goto(url);
  await r.page.addStyle(CANVAS_CSS);
  await r.page.eval(`(document.querySelector('#w-tab-lunettes')?.click(), true)`).catch(() => undefined);
  return r.page.waitScreen((s) => s.screen === 'home' && !s.lines.some((l) => /…$|^Chargement/.test(l)), 30_000, 'accueil des lunettes (Quai Web)');
}
async function gesture(r: Run, g: 'up' | 'down' | 'tap' | 'double' | 'long', pause = 450): Promise<void> {
  r.mark = r.page.screens().length;
  const ok = await r.page.eval<boolean>(`(() => { const b = document.querySelector('.w-gestures button[data-g="${g}"]'); if (!b) return false; b.click(); return true; })()`);
  check(ok, `bouton du geste ${g} introuvable dans Quai Web`);
  await sleep(pause);
}
async function setNow(r: Run, t: number): Promise<void> {
  const ok = await r.page.eval<boolean>(`(() => { const c = window.__quaiClock; if (!c || typeof c.set !== 'function') return false; return c.set(${t}); })()`);
  check(ok, 'crochet manquant : window.__quaiClock.set (mode e2e)');
}
async function push(r: Run, p: TracePoint): Promise<void> {
  const ok = await r.page.eval<string>(`(() => { if (typeof window.__quaiPushFix !== 'function') return 'absent'; return window.__quaiPushFix(${JSON.stringify(toFix(p))}) ? 'pris' : 'refusé'; })()`);
  check(ok === 'pris', `position ${ok === 'absent' ? 'impossible à pousser (window.__quaiPushFix absent)' : 'refusée'} (${p.lat}, ${p.lon})`);
}
/** Va à l'instant `t` et y pousse la position de la trace (sans trace : l'heure seule, aucune position). */
async function goTo(r: Run, trace: Trace | null, t: number, keepMark = true): Promise<void> {
  if (!keepMark) r.mark = r.page.screens().length;
  await setNow(r, t);
  if (trace) {
    for (const p of trace.points.filter((x) => x.at <= t).slice(-3)) await push(r, p);
    await push(r, { ...pointAt(trace.points, t), at: t });
  }
  await sleep(350);
}
async function waitGuide(r: Run, label: string, pred: (s: GlassesScreen) => boolean, timeout = 10_000): Promise<GlassesScreen> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const all = r.page.screens();
    for (let i = all.length - 1; i >= r.mark && i >= 0; i--) if (pred(all[i])) return all[i];
    await sleep(120);
  }
  const all = r.page.screens();
  const guides = all.slice(r.mark).filter(isGuide);
  throw new Check(`délai dépassé en attendant ${label} ; dernier écran : ${show(all.at(-1))}${guides.length ? ` ; écrans du guidage vus : ${guides.slice(-3).map(show).join(' | ')}` : ''}`);
}
async function webFollowed(r: Run): Promise<{ journey: O.OJourney; title: string; guide?: { kind?: string } } | null> {
  const raw = await r.page.eval<string | null>(`localStorage.getItem('quai.trip')`);
  return raw ? (JSON.parse(raw) as { journey: O.OJourney; title: string; guide?: { kind?: string } }) : null;
}
/** Rang d'un élément de l'accueil de Quai Web, puis curseur dessus. */
async function webSelectHome(r: Run, re: RegExp): Promise<void> {
  const k = homeItems(r.page.lastScreen()!).findIndex((l) => re.test(l));
  check(k >= 0, `élément ${re} absent de l’accueil : ${show(r.page.lastScreen())}`);
  for (let i = 0; i < 12 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
  check(r.page.lastScreen()?.sel === k, `curseur pas arrivé sur ${re} (sel ${r.page.lastScreen()?.sel}, attendu ${k})`);
}
async function webSelectRow(r: Run, k: number): Promise<void> {
  for (let i = 0; i < 16 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
  check(r.page.lastScreen()?.sel === k, `curseur pas arrivé au rang ${k} (sel ${r.page.lastScreen()?.sel})`);
}
/** Depuis l'accueil de Quai Web : « Favoris », le favori `name`, son écran du trajet. */
async function webOpenFavorite(r: Run, name: string): Promise<GlassesScreen> {
  await webSelectHome(r, /^Favoris {3}\d+$/);
  await gesture(r, 'tap');
  const f = await waitGuide(r, '« Favoris »', (s) => s.screen === 'favorites' && loaded(s), 20_000);
  const open = accordionLines(f as unknown as Screen);
  const rows = f.lines.slice(0, -1).filter((l) => !open.includes(l) && l !== 'ADRESSES RÉCENTES');
  const k = rows.findIndex((l) => l.startsWith(`${name}   `) || l.startsWith(`${name} !   `));
  check(k >= 0, `favori « ${name} » absent : ${JSON.stringify(f.lines)}`);
  await webSelectRow(r, k);
  await gesture(r, 'tap');
  return waitGuide(r, `écran du trajet « ${name} »`, (s) => s.screen === 'steps' && loaded(s), 20_000);
}
/** « ▶ Y aller » sur le favori de la place Fontainas : le guidage, son trajet (quai.trip) et le premier écran du guidage. */
async function webLaunch(r: Run): Promise<{ j: O.OJourney; title: string; first: GlassesScreen }> {
  const steps = await webOpenFavorite(r, FONTAINAS);
  check(O.matches(actionOf(steps), '▶ Y aller'), `ligne d’action « ▶ Y aller » attendue (PRD-1.3.0 § 1) : ${show(steps)}`);
  await gesture(r, 'tap');
  const first = await waitGuide(r, 'écran du guidage au lancement', (s) => isGuide(s) && !!s.title, 15_000);
  let ft = await webFollowed(r);
  for (let k = 0; k < 20 && !ft?.journey?.legs?.length; k++) {
    await sleep(200);
    ft = await webFollowed(r);
  }
  check(ft?.journey?.legs?.length, 'trajet suivi absent de quai.trip après « ▶ Y aller »');
  return { j: ft.journey, title: steps.title, first };
}
/** Toucher sur un écran du guidage qui montre quelque chose : l'écran calme revient (1.3.1 : les trois points). */
async function webMask(r: Run, label: string): Promise<GlassesScreen> {
  await gesture(r, 'tap');
  return waitGuide(r, `écran calme après le toucher (${label})`, isCalm);
}
async function canvasShot(r: Run): Promise<Buffer> {
  const b64 = await r.page.eval<string>(`(() => { const c = document.querySelector('.w-canvas'); return c ? c.toDataURL('image/png').split(',')[1] : ''; })()`);
  check(b64, 'canvas des lunettes de Quai Web introuvable');
  return canvasToShot(Buffer.from(b64, 'base64'));
}

/** Contrôle d'une capture du canvas : gabarits (layout), guidage (avec ou sans image), écran calme (points, progression). */
type WShot = 'layout' | 'guide' | 'guideImage' | 'dots' | 'progress' | 'capture';
async function wstep(r: Run, name: string, fn: () => Promise<{ screen?: GlassesScreen; shot?: WShot } | void>, opts: { critical?: boolean } = {}): Promise<void> {
  const t0 = Date.now();
  const res: Parameters<Ctx131['record']>[0] = { scenario: r.ctx.scenario(), step: name, ok: true, ms: 0 };
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
      let buf = await canvasShot(r);
      const s = out.screen;
      const issues = (b: Buffer): string[] =>
        out.shot === 'dots' || out.shot === 'progress'
          ? checkCalmPixels(b, out.shot, { paleMax: 197 }).bad
          : out.shot === 'capture'
            ? litCount(b)
              ? []
              : ['écran noir']
            : out.shot === 'layout'
              ? litCount(b)
                ? checkPixels(b, s, { tol: 6 })
                : ['écran noir']
              : checkGuidePixels(b, s as unknown as GuideShot, { image: out.shot === 'guideImage', tol: 5 });
      let bad = issues(buf);
      for (let k = 0; bad.length && k < 3; k++) {
        await sleep(300);
        buf = await canvasShot(r);
        bad = issues(buf);
      }
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

/** Contrôles communs d'un moment du guidage (1.3.1) : titre du trajet, heure, « masquer », rien de coupé, typographie. */
function momentCommon(s: GlassesScreen, title: string, wantHint: string = TXT.guideHints): void {
  check(N(s.title).startsWith(N(title)), `titre « ${s.title} » au lieu du titre du trajet « ${title} »`);
  check(/^\d\d:\d\d$/.test(s.clock ?? ''), `heure à droite du titre absente (« ${s.clock ?? ''} »)`);
  check(O.matches(hint(s), wantHint), `aide « ${N(hint(s))} » au lieu de « ${wantHint} » (PRD-1.3.1 § 2)`);
  const cut = truncatedLines(s as unknown as Screen);
  check(!cut.length, `lignes coupées par « … » : ${JSON.stringify(cut)}`);
  const typo = O.typographyIssues([s.title, ...s.lines]);
  check(!typo.length, typo.join(' ; '));
}
/** « Où tu en es » de la 1.3.1 : écarts au PRD (§ 3, § 12), dits en clair. */
function whereOk(s: GlassesScreen, w: O.Where131, label: string): void {
  const bad = O.whereIssues131(s, w);
  check(!bad.length, `${label} :\n        ${bad.join('\n        ')}\n      écran vu : ${show(s)}`);
}

/** Relief de l'accueil (PRD-1.2.1 § 4.4, gardé) : rubriques au plus clair à la marge, favoris pâles en retrait. */
async function homeRelief(sim: Sim, s: Screen, favs: string[]): Promise<void> {
  await sleep(300);
  const png = await sim.rawShot();
  const bad: string[] = [];
  for (const l of levels(png, s).filter((x) => x.label.startsWith('ligne'))) {
    if (favs.includes(l.text)) {
      if (l.alpha !== 197) bad.push(`favori « ${l.text} » : alpha ${l.alpha} au lieu de 197 (niveau 2)`);
      if (l.x0 < 28 + HOME_INDENT - 1) bad.push(`favori « ${l.text} » : commence à x = ${l.x0}, sans le retrait de ${HOME_INDENT} px`);
    } else if (SECTION_RE.some((re) => re.test(l.text))) {
      if (l.alpha !== 255) bad.push(`« ${l.text} » : alpha ${l.alpha} au lieu de 255 (niveau 4)`);
      if (l.x0 > 30) bad.push(`« ${l.text} » : commence à x = ${l.x0} au lieu de la marge (28)`);
    }
  }
  check(!bad.length, `relief de l’accueil :\n        ${bad.join('\n        ')}`);
}

/* ------------------------------ s131accueil : accueil (§ 8, § 9, B15, L6) ------------------------------ */

async function s131accueil(ctx: Ctx131): Promise<void> {
  const sim = ctx.sim();
  // § 9 : qui vient de la 1.3.0 n'a aucun message des nouveautés (NEWS_SINCE reste 1.3.0) : l'accueil directement
  await sim.launch(ctx.pageUrl({ ...START, ...ctx.preset('p/131from130.json') }, false));
  await ctx.step('accueil', async () => {
    const s = await simHome(sim);
    // la page « Chargement… » du lancement est aussi un écran `message` : ce n'est pas un message des nouveautés
    const news = sim.screens.filter((x) => x.screen === 'message' && !(x.lines.length === 1 && /^Chargement/.test(x.lines[0])));
    check(!news.length, `message à l’ouverture pour qui vient de la 1.3.0 (PRD-1.3.1 § 9 : pas de message des nouveautés) : ${news.map(show).join(' | ')}`);
    const { bad, at, favs } = homeOrderIssues(s);
    check(!bad.length, `accueil (PRD-1.3.1 § 8) :\n        ${bad.join('\n        ')}\n      vu : ${JSON.stringify(s.lines)}`);
    check(s.sel === at[0], `curseur sur « Autour de moi » à l’ouverture de Quai (sel ${s.sel}, « Autour de moi » au rang ${at[0]} ; PRD-1.3.1 § 8)`);
    check(favs.length >= 1 && favs.length <= 3, `1 à 3 favoris sous « Favoris » : ${JSON.stringify(favs)}`);
    // B15 (U2) : le « ! » d'un favori dont le trajet a un souci (ici la voie modifiée de l'IC), jamais pour un simple retard
    check(favs.some((l) => /^Place Fontainas ! {3}/.test(l)), `« Place Fontainas ! » attendu sur l’accueil (B15 : IC voie 6 au lieu de 4) : ${JSON.stringify(favs)}`);
    await homeRelief(sim, s, favs);
    return { screen: s };
  });
  await ctx.step('autour-de-moi', async () => {
    // le curseur est sur « Autour de moi » : un toucher l'ouvre, sans geste avant (§ 8 : « on peut bouger facilement »)
    await sim.input('click');
    const s = await sim.waitScreen((x) => (x.screen === 'nearby' && loaded(x)) || (x.screen === 'message' && x.title === 'Autour de moi'), 15_000, '« Autour de moi »');
    check(s.screen === 'nearby', `« Autour de moi » : liste des arrêts attendue : ${show(s)}`);
    // L6 : même aide pour le même geste (Arrêts, Gares, Autour de moi : le tableau des départs)
    listCommon(s, TXT.listDepartures, '« Autour de moi » (L6)');
    return { screen: s, pixels: false };
  });
  await ctx.step('gares-accordeon', async () => {
    await simBackHome(sim);
    await simSelectHome(sim, /^Gares de train {3}/);
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'stations' && loaded(x), 15_000, '« Gares de train »');
    listCommon(s, TXT.listDepartures, '« Gares de train »');
    // B21 (U7) : en accordéon, sous la gare du curseur (Namur) : la direction du prochain train, puis le suivant
    const open = accordionLines(s);
    check(open.length === 2, `B21 : 2 lignes ouvertes sous la gare du curseur attendues (« vers Bruxelles-Midi », « puis IC vers …, 08:42 voie 5 »), vu ${JSON.stringify(s.lines)}`);
    const k = s.lines.indexOf(open[0]);
    check(k === (s.sel ?? 0) + 1 && /^Namur {3}/.test(s.lines[k - 1] ?? ''), `accordéon pas collé sous la gare du curseur (Namur) : ${JSON.stringify(s.lines)}`);
    check(/^vers Bruxelles-Midi$/.test(N(open[0])), `1re ligne « ${open[0]} » au lieu de « vers Bruxelles-Midi » (B21, U7)`);
    check(/^puis IC vers Bruxelles-Midi, ~?08:42( voie 5)?$/.test(N(open[1])), `2e ligne « ${open[1]} » au lieu de « puis IC vers Bruxelles-Midi, 08:42 voie 5 » (B21, U7 : le train suivant)`);
    return { screen: s };
  });
  await ctx.step('lignes', async () => {
    await simBackHome(sim);
    await simSelectHome(sim, /^Lignes de bus, tram, métro {3}/);
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'follows' && loaded(x), 15_000, '« Lignes de bus, tram, métro »');
    // L6 : « toucher : parcours » (le parcours de la ligne) au lieu de « toucher : la ligne »
    listCommon(s, TXT.listLines, '« Lignes » (L6)');
    return { screen: s };
  });
  await ctx.step('arrets', async () => {
    await simBackHome(sim);
    await simSelectHome(sim, /^Arrêts de bus, tram, métro {3}/);
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'lines' && loaded(x), 15_000, '« Arrêts de bus, tram, métro »');
    // L6 : « toucher : départs » comme « Gares » et « Autour de moi » (le même tableau), au lieu de « toucher : ouvrir »
    listCommon(s, TXT.listDepartures, '« Arrêts » (L6)');
    return { screen: s };
  });
  await ctx.step('accueil-en-cours', async () => {
    // § 8 : les cas qui ajoutent une ligne gardent leur règle : un guidage en cours met « En cours » en tête, curseur dessus
    await simBackHome(sim);
    await simSelectHome(sim, /^Favoris {3}\d+$/);
    await sim.input('click');
    const f = await sim.waitScreen((x) => x.screen === 'favorites' && loaded(x), 20_000, '« Favoris »');
    const open = accordionLines(f);
    const k = f.lines.slice(0, -1).filter((l) => !open.includes(l) && l !== 'ADRESSES RÉCENTES').findIndex((l) => /^Place Fontainas( !)? {3}/.test(l));
    await sim.select(k);
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'steps' && loaded(x), 20_000, 'écran du trajet');
    await sim.input('click');
    await sim.waitScreen((x) => x.screen === 'guide' && !!x.title, 15_000, 'guidage lancé');
    await sim.input('double_click', 300);
    let s = await sim.waitScreen((x) => x.screen === 'home' || x.screen === 'steps', 10_000, 'écran d’avant le guidage');
    if (s.screen === 'steps') {
      await sim.input('double_click', 300);
      s = await sim.waitScreen((x) => x.screen === 'home', 10_000, 'accueil');
    }
    s = await simHome(sim);
    const items = homeItems(s);
    check(/^En cours/.test(items[0] ?? ''), `« En cours » en tête de l’accueil pendant le guidage : ${JSON.stringify(s.lines)}`);
    const { bad } = homeOrderIssues(s);
    check(!bad.length, `accueil avec « En cours » (§ 8) :\n        ${bad.join('\n        ')}`);
    check(s.sel === 0, `curseur sur « En cours » (règle gardée, PRD-1.3.1 § 8) : sel ${s.sel}`);
    return { screen: s };
  });
}

/* ------------------------------ s131trajet : nom de l'arrêt où l'on marche (§ 4, B14) ------------------------------ */

async function s131trajet(ctx: Ctx131): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, false));
  await ctx.step('favoris-accordeon', async () => {
    await simHome(sim);
    await simSelectHome(sim, /^Favoris {3}\d+$/);
    await sim.input('click');
    const f = await sim.waitScreen((x) => x.screen === 'favorites' && loaded(x), 25_000, '« Favoris » calculés');
    check(f.sel === 0 && /^Place Fontainas( !)? {3}/.test(f.lines[0] ?? ''), `curseur sur « Place Fontainas » : ${show(f)}`);
    const open = accordionLines(f);
    check(open.length >= 1 && open.length <= 2 && f.lines[1] === open[0], `accordéon sous « Place Fontainas » : ${JSON.stringify(f.lines)}`);
    // § 4 : la 1re ligne nomme l'arrêt (ici la gare) où monter ; la 2e garde le premier véhicule et son heure, puis les
    // changements s'ils tiennent (« bus W ~11:49, 1 changement : métro 2 », sinon « …, 1 changement », sinon « bus W ~11:49 »)
    check(/^à pied \d+ min → Namur$/.test(N(open[0])), `1re ligne de l’accordéon « ${open[0]} » au lieu de « à pied 9 min → Namur » (PRD-1.3.1 § 4)`);
    // le souci reste avec le véhicule (PRD-1.3.0 § 7) : « voie 6 ! » ou « voie 6 au lieu de 4 »
    check(open.length === 2 && /^IC (~?07:4[24]|07:42 \+2)( voie 6 !| voie 6 au lieu de 4)?(, 1 changement( : tram 3)?)?$/.test(N(open[1])), `2e ligne de l’accordéon « ${open[1] ?? ''} » au lieu de « IC 07:42 +2 voie 6 au lieu de 4, 1 changement : tram 3 » (ou plus court ; PRD-1.3.1 § 4)`);
    return { screen: f };
  });
  await ctx.step('trajet', async () => {
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'steps' && loaded(x), 20_000, 'écran du trajet');
    const rows = s.lines.map(N);
    const want: [RegExp, string][] = [
      [/^~?07:3\d à pied \d+ min → Namur$/, '« 07:35  à pied 9 min → Namur » (§ 4 : la gare où monter)'],
      [/^~?07:4[24] IC voie 6 ! → Bruxelles-Nord {3}08:42$/, '« 07:44  IC voie 6 ! → Bruxelles-Nord   08:42 » (inchangé)'],
      [/^~?08:4\d à pied 2 min → Gare du Nord$/, '« 08:42  à pied 2 min → Gare du Nord » (§ 4 : l’arrêt du véhicule suivant)'],
      [/^~?08:4\d Tram 3 → Bourse {3}(très juste|marge \d+ min)$/, '« 08:44  Tram 3 → Bourse   très juste » (inchangé)'],
      [/^~?08:4\d à pied 9 min(, pluie)? {3}~?08:5\d$/, '« 08:49  à pied 9 min, pluie   08:58 » (§ 4 : dernière marche inchangée ; B14 : l’arrivée à droite)'],
    ];
    const bad = want.filter(([re]) => !rows.some((l) => re.test(l))).map(([, w]) => w);
    check(!bad.length, `écran du trajet, rangées attendues absentes :\n        ${bad.join('\n        ')}\n      vu : ${JSON.stringify(s.lines)}`);
    // dernière marche (après le tram) : jamais de « → » (la destination n'est pas un arrêt)
    const last = [...s.lines].reverse().find((l) => /^~?\d\d:\d\d à pied \d+ min/.test(N(l)))!;
    check(last && !/→/.test(last), `la dernière marche ne nomme pas d’arrêt (§ 4 : inchangée) : ${JSON.stringify(s.lines)}`);
    // B14 (U1) : l'heure d'arrivée de la dernière marche, pâle (niveau 2)
    await sleep(300);
    const png = await sim.rawShot();
    const a = alphaIn(png, s, last, 576 - 90, 576);
    check(a > 0 && a <= 197, `B14 : l’arrivée « ${last.split('   ').pop()} » de la dernière marche : alpha ${a} au lieu du niveau pâle (197 au plus)`);
    const typo = O.typographyIssues([s.title, ...s.lines]);
    check(!typo.length, typo.join(' ; '));
    return { screen: s };
  });
}

/* ------------------------------ s131arrets : « ▶ Me guider jusqu'à cet arrêt » (§ 6) ------------------------------ */

/** § 6 : sur un arrêt après la montée, la ligne d'action au plus clair juste au-dessus des aides ; avant : aucune. */
function stopsActionIssues(s: Screen, actionable: boolean): string[] {
  const bad: string[] = [];
  if (!O.matches(hint(s), TXT.stopsHints)) bad.push(`aides « ${N(hint(s))} » au lieu de « ${TXT.stopsHints} » (PRD-1.3.1 § 6)`);
  const act = actionOf(s);
  if (actionable && !(act && (O.matches(act, TXT.stopsAction) || /^▶ Me guider jusqu’à \S/.test(N(act))))) bad.push(`ligne d’action « ${TXT.stopsAction} » absente au-dessus des aides (§ 6) : ${JSON.stringify(s.lines.slice(-3))}`);
  if (!actionable && act) bad.push(`ligne d’action « ${act} » sur un arrêt où le toucher ne lance rien (§ 6 : avant la montée, gare quittée)`);
  if (s.lines.slice(0, -2).some((l) => /^▶ /.test(l))) bad.push(`une seule ligne d’action : ${JSON.stringify(s.lines)}`);
  return bad;
}

async function s131arrets(ctx: Ctx131): Promise<void> {
  const sim = ctx.sim();
  // bus, tram, métro : le tram 3 à la Gare du Nord, 12:10 (scénario 2 des fixtures : ses départs s'ouvrent seuls, l'arrêt
  // repère des lignes suivies ; sinon par « Autour de moi »)
  await sim.launch(ctx.pageUrl({ mockLat: '50.86', mockLon: '4.359', mockNow: '2026-11-10T12:10:00+01:00', ...ctx.preset('p/1210.json') }, false));
  await ctx.step('tram-ligne-d-action', async () => {
    const isBoard = (x: Screen) => x.screen === 'board' && loaded(x) && x.lines.some((l) => /^T3 {3}Churchill/.test(l));
    let b = await lastOrWait(sim, (x) => isBoard(x) || homeLoaded(x), 30_000, 'tableau de la Gare du Nord ou accueil');
    if (!isBoard(b)) {
      await simSelectHome(sim, /^Autour de moi {3}/);
      await sim.input('click');
      const near = await sim.waitScreen((x) => x.screen === 'nearby' && loaded(x), 15_000, '« Autour de moi »');
      const k = near.lines.findIndex((l) => /^Gare du Nord, tram/.test(l));
      check(k >= 0, `« Gare du Nord, tram » absent d’« Autour de moi » : ${show(near)}`);
      await sim.select(k);
      await sim.input('click');
      b = await sim.waitScreen(isBoard, 15_000, 'tableau de la Gare du Nord (tram)');
    }
    const t3 = b.lines.findIndex((l) => /^T3 {3}Churchill/.test(l));
    await sim.select(t3);
    await sim.input('click');
    // l'arrêt de la montée (Gare du Nord) est la ligne du haut, jamais sous le curseur : le curseur sur le premier arrêt
    // après la montée (Rogier), où le toucher lance « j'y descends » : la ligne d'action, au plus clair (§ 6)
    const s = await sim.waitScreen((x) => x.screen === 'stops' && loaded(x), 15_000, 'arrêts du tram 3');
    check(/Gare du Nord$/.test(N(s.lines[0] ?? '')) && /Rogier$/.test(N(cursorRowText(s) ?? '')), `arrêts du tram 3 : Gare du Nord en haut, curseur sur Rogier : ${show(s)}`);
    const bad = stopsActionIssues(s, true);
    check(!bad.length, bad.join(' ; '));
    const a = await bandAlpha(sim, s, 'ligne d’action');
    check(a === 255, `ligne d’action au niveau ${a} (alpha) au lieu du plus clair (255) (§ 6 : comme « ▶ Y aller »)`);
    return { screen: s };
  });
  await ctx.step('tram-une-rangee-de-moins', async () => {
    // la ligne prend une rangée à la liste (§ 6) : au bas de la page, ▼ passe à la page suivante ; la ligne suit le curseur
    const first = sim.last!;
    const rows = first.lines.length - 3;
    await sim.select(rows - 1);
    const s = await sim.waitScreen((x) => x.screen === 'stops' && x.sel === rows - 1, 8_000, '▼ : dernier arrêt de la page');
    const name = N(cursorRowText(s) ?? '').split('   ').pop() ?? '';
    check(name && O.matches(actionOf(s), `▶ Me guider jusqu’à ${name}`) || O.matches(actionOf(s), TXT.stopsAction), `la ligne d’action suit le curseur (« ▶ Me guider jusqu’à ${name} ») : ${show(s)}`);
    check(s.lines.length === first.lines.length, `même nombre de rangées quelle que soit la rangée du curseur : ${s.lines.length} au lieu de ${first.lines.length}`);
    return { screen: s };
  });
  await ctx.step('train-arrets', async () => {
    // train : tout le trajet de l'IC de 07:42 depuis le quai de Namur (07:38) ; Namur, la gare de la montée : sans action
    await sim.launch(ctx.pageUrl({ ...ON_PLATFORM, ...ctx.preset('p/1210.json') }, false));
    await simHome(sim);
    await simSelectHome(sim, /^Gares de train {3}/);
    await sim.input('click');
    let s = await sim.waitScreen((x) => (x.screen === 'stations' || x.screen === 'board') && loaded(x), 15_000, '« Gares de train »');
    if (s.screen === 'stations') {
      await sim.input('click');
      s = await sim.waitScreen((x) => x.screen === 'board' && loaded(x), 15_000, 'tableau de Namur');
    }
    const ic = s.lines.findIndex((l) => /\bIC\b/.test(l) && /07:42/.test(l));
    check(ic >= 0, `IC de 07:42 absent du tableau de Namur : ${show(s)}`);
    await sim.select(ic);
    await sim.input('click');
    const run = await sim.waitScreen((x) => (x.screen === 'trainRun' || x.screen === 'stops') && loaded(x) && x.lines.length > 3, 15_000, 'tout le trajet de l’IC');
    const gare = field<number>(run, 'gare') ?? 0;
    await sim.select(gare);
    const at = await lastOrWait(sim, (x) => x.screen === run.screen && x.sel === gare, 8_000, 'curseur sur Namur');
    const bad = stopsActionIssues(at, false);
    check(!bad.length, `gare de la montée (Namur) : ${bad.join(' ; ')}`);
    return { screen: at };
  });
  await ctx.step('train-ligne-d-action', async () => {
    const cur = sim.last!;
    const gare = field<number>(cur, 'gare') ?? 0;
    await sim.select(gare + 1);
    const s = await sim.waitScreen((x) => x.screen === cur.screen && x.sel === gare + 1, 8_000, '▼ : Gembloux');
    const bad = stopsActionIssues(s, true);
    check(!bad.length, `Gembloux : ${bad.join(' ; ')}`);
    return { screen: s };
  });
  await ctx.step('train-me-guider', async () => {
    // le toucher lance « j'y descends » (inchangé) : l'écran du guidage
    // ▼ jusqu'à Bruxelles-Central (la ligne d'action prend une rangée : l'arrêt peut être sur la page suivante)
    for (let i = 0; i < 12 && !/Bruxelles-Central/.test(cursorRowText(sim.last!) ?? ''); i++) {
      await sim.input('down');
      await sleep(250);
      await sim.drain();
    }
    const s = sim.last!;
    check(/Bruxelles-Central/.test(cursorRowText(s) ?? ''), `curseur jamais sur Bruxelles-Central : ${show(s)}`);
    const bad = stopsActionIssues(s, true);
    check(!bad.length, `Bruxelles-Central : ${bad.join(' ; ')}`);
    await sim.input('click');
    const g = await sim.waitScreen((x) => x.screen === 'guide' && !!x.title, 15_000, 'guidage « j’y descends »');
    return { screen: g, shot: false };
  });
}

/* ------------------------------ s131soir : l'accueil du soir (B20) ------------------------------ */

async function s131soir(ctx: Ctx131): Promise<void> {
  const sim = ctx.sim();
  await sim.launch(ctx.pageUrl({ ...LATE, ...ctx.preset('p/1210.json') }, false));
  await ctx.step('accueil-du-soir', async () => {
    const s = await simHome(sim, 40_000);
    const { bad, favs } = homeOrderIssues(s);
    check(!bad.length, `accueil (PRD-1.3.1 § 8) :\n        ${bad.join('\n        ')}`);
    // B20 (U8) : aucun trajet dans les 3 h : jusqu'à 3 favoris quand même, avec « demain 05:52 → 06:46 »
    check(favs.length >= 1 && favs.length <= 3, `B20 : 1 à 3 favoris sous « Favoris » le soir, vu ${JSON.stringify(favs)} dans ${JSON.stringify(s.lines)}`);
    const tomorrow = favs.filter((l) => / {3}demain \d\d:\d\d → \d\d:\d\d$/.test(N(l)));
    check(tomorrow.length === favs.length, `B20 : chaque favori montré avec « demain HH:MM → HH:MM » : ${JSON.stringify(favs)}`);
    return { screen: s };
  });
}

/* ------------------------------ s131apos : apostrophes des données (§ 7) ------------------------------ */

async function s131apos(ctx: Ctx131): Promise<void> {
  const sim = ctx.sim();
  let data = '';
  await ctx.step('donnees', async () => {
    data = await aposData(ctx);
  });
  if (!data) return;
  await sim.launch(ctx.pageUrlWith({ ...WAT, ...ctx.preset('p/131apos.json') }, false, data));
  await ctx.step('gares', async () => {
    await simHome(sim, 40_000);
    await simSelectHome(sim, /^Gares de train {3}/);
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen === 'stations' && loaded(x) && x.lines.some((l) => /Braine/.test(l)), 15_000, '« Gares de train » avec Braine-l’Alleud');
    // § 7 : le nom des données (« Braine-l'Alleud ») avec l'apostrophe typographique ; le réglage enregistré ne change pas
    check(s.lines.some((l) => l.startsWith('Braine-l’Alleud')), `« Braine-l’Alleud » (apostrophe typographique) attendu : ${show(s)}`);
    const typo = O.typographyIssues([s.title, ...s.lines]);
    check(!typo.length, `${typo.join(' ; ')} (PRD-1.3.1 § 7)`);
    const raw = (await ctx.host.storage('quai.settings').catch(() => null)) ?? '';
    if (raw) check(raw.includes("Braine-l'Alleud"), 'réglage enregistré modifié : le nom gardé doit rester tel quel (§ 7 : seulement à l’affichage)');
    return { screen: s };
  });
  await ctx.step('tableau-waterloo', async () => {
    const cur = sim.last!;
    // B21 : les lignes ouvertes sous la gare du curseur ne sont pas des rangées (le rang se compte sans elles)
    const open = accordionLines(cur);
    const k = cur.lines.filter((l) => !open.includes(l)).findIndex((l) => /^Waterloo {3}/.test(l));
    check(k >= 0, `Waterloo absent de « Gares de train » : ${show(cur)}`);
    await sim.select(k);
    await sim.input('click');
    const b = await sim.waitScreen((x) => x.screen === 'board' && loaded(x) && x.lines.some((l) => /Braine/.test(l)), 15_000, 'tableau de Waterloo avec le S1 vers Braine-l’Alleud');
    check(b.lines.some((l) => /Braine-l’Alleud/.test(l)), `destination « Braine-l’Alleud » (apostrophe typographique) attendue sur le tableau : ${show(b)}`);
    const typo = O.typographyIssues([b.title, ...b.lines]);
    check(!typo.length, `${typo.join(' ; ')} (PRD-1.3.1 § 7)`);
    return { screen: b };
  });
  await ctx.step('trajet-du-train', async () => {
    // tout le trajet d'un S1 de Nivelles : Braine-l'Alleud, gare d'avant, avec l'apostrophe typographique
    const cur = sim.last!;
    const k = cur.lines.findIndex((l) => /\bS1\b/.test(l) && /Bruxelles-Nord/.test(l));
    check(k >= 0, `S1 vers Bruxelles-Nord absent du tableau de Waterloo : ${show(cur)}`);
    await sim.select(k);
    await sim.input('click');
    const s = await sim.waitScreen((x) => (x.screen === 'trainRun' || x.screen === 'stops') && loaded(x), 15_000, 'tout le trajet du S1');
    check(s.lines.some((l) => /Braine-l’Alleud/.test(l)), `gare « Braine-l’Alleud » attendue dans tout le trajet du S1 : ${show(s)}`);
    const typo = O.typographyIssues([s.title, ...s.lines]);
    check(!typo.length, `${typo.join(' ; ')} (PRD-1.3.1 § 7)`);
    return { screen: s };
  });
}

/* ------------------------------ Traces des s131 (lieux publics : Namur, place de l'Ange, gare) ------------------------------ */

/** Rues entre la place de l'Ange et la gare de Namur (les mêmes que la trace NAMUR_FONTAINAS). */
const WALK_NAMUR: LatLon[] = [PLACES.placeAnge, { lat: 50.4655, lon: 4.8642 }, { lat: 50.4672, lon: 4.8631 }, { lat: 50.4683, lon: 4.8627 }, PLACES.namurVoie6];

/**
 * A2 (P1) : parti trop tard : sur la place jusqu'à 07:41:30, puis à pied (1,2 m/s) vers la gare ; l'IC part à 07:44
 * (temps réel) quand on est encore à plus de 300 m ; on continue à marcher jusqu'à la gare. À 07:45:40 on est encore à
 * 250 m de la gare : le moteur compte « à la gare » à 200 m (GUIDE.atStationM, règle de la 1.2.10 gardée) ; partie à
 * 07:39:40, la première trace y était déjà à 105 m et l'écran disait, à raison, « À la gare de Namur ».
 */
const LATE_WALK: Trace = {
  id: 's131-late-walk',
  label: 'Place de l’Ange (Namur) : départ à pied à 07:41:40, l’IC de 07:44 part pendant la marche',
  places: ['Place de l’Ange, Namur', 'Gare de Namur'],
  points: joinTrace(stay(PLACES.placeAnge, T('07:20'), T('07:41:30'), { phase: 'stay', accuracy: 6 }), walk(WALK_NAMUR, T('07:41:40'), { speed: 1.2 }), stay(PLACES.namurVoie6, T('07:50:30'), T('07:57'))),
};

/**
 * A6 (P3) : part dans le bon sens, puis fait demi-tour après une centaine de mètres et marche 40 m dans le sens contraire
 * du chemin (`turnAt` : l'instant du demi-tour), avant de repartir dans le bon sens.
 */
function uturnTrace(leaveAt: number): { trace: Trace; turnAt: number } {
  const go = walk(WALK_NAMUR.slice(0, 2), leaveAt + 10_000, { speed: 1.3 });
  const turnAt = go[go.length - 1].at + 2_000;
  const back = walk([WALK_NAMUR[1], { lat: 50.4651, lon: 4.8646 }], turnAt, { speed: 1.3 });
  const again = walk([{ lat: 50.4651, lon: 4.8646 }, ...WALK_NAMUR.slice(1)], back[back.length - 1].at + 3_000, { speed: 1.3 });
  return {
    trace: { id: 's131-uturn', label: 'Place de l’Ange → vers la gare, demi-tour, puis la gare', places: ['Place de l’Ange, Namur', 'Gare de Namur'], points: joinTrace(stay(PLACES.placeAnge, T('07:20'), leaveAt, { phase: 'stay', accuracy: 6 }), go, back, again) },
    turnAt,
  };
}

/** A3 (I1) : sans temps réel, sur le quai à 07:40 et encore à 08:30 (l'IC de 07:42 en retard, ou raté). */
const PLATFORM_LONG: Trace = {
  id: 's131-platform',
  label: 'Place de l’Ange → gare de Namur, puis sur le quai jusqu’à 08:30',
  places: ['Place de l’Ange, Namur', 'Gare de Namur'],
  points: joinTrace(stay(PLACES.placeAnge, T('07:20'), T('07:31:50'), { phase: 'stay', accuracy: 6 }), walk(WALK_NAMUR, T('07:32')), stay(PLACES.namurVoie6, T('07:39:30'), T('08:30'))),
};

/** Moment dont la 1re ligne vérifie `first`, journalisé depuis le dernier geste ou instant. */
async function momentWeb(r: Run, label: string, first: O.Want, timeout = 10_000): Promise<GlassesScreen> {
  return waitGuide(r, `« ${label} » (1re ligne ${O.showWant(first)})`, (s) => isGuide(s) && O.matches(s.lines[0], first), timeout);
}
/** Le long de la trace, de `from` à `to` par pas de `stepMs` ; chaque moment affiché est masqué s'il est là depuis 1,5 s. */
async function walkThrough(r: Run, trace: Trace, from: number, to: number, stepMs: number, mask = true): Promise<GlassesScreen[]> {
  const seen: GlassesScreen[] = [];
  for (let t = from; t <= to; t += stepMs) {
    const n0 = r.page.screens().length;
    await goTo(r, trace, t);
    seen.push(...r.page.screens().slice(n0).filter(isGuide));
    const cur = r.page.lastScreen();
    if (mask && cur && isGuide(cur) && !isCalm(cur)) {
      await sleep(1_600);
      await gesture(r, 'tap');
      await sleep(200);
    }
  }
  return seen;
}
/** Lignes d'un moment (sans l'aide) comparées à l'oracle, `extra` : lignes permises en plus, après. */
function expectLines(s: GlassesScreen, want: O.Want[], label: string, extra: O.Want[] = []): void {
  const body = s.lines.slice(0, -1);
  const bad = O.compareLines(body, want);
  for (const l of body.slice(want.length)) if (!extra.some((w) => O.matches(l, w))) bad.push(`ligne en trop « ${N(l)} »`);
  check(!bad.length, `${label} :\n        ${bad.join('\n        ')}\n      écran vu : ${show(s)}`);
}

/* ------------------------------ s131calme : écran calme, masquer, retour de l'écran du guidage (§ 1, § 2, A1, A7, B9, B10, B17) ------------------------------ */

async function s131calme(ctx: Ctx131): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    const tr = NAMUR_FONTAINAS;
    let j!: O.OJourney;
    let title = FONTAINAS;
    let ic = -1;
    let launched: GlassesScreen[] = [];
    await wstep(r, 'lancement', async () => {
      await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
      const x = await webLaunch(r);
      j = x.j;
      title = x.title;
      ic = j.legs.findIndex((l) => l.kind === 'ride');
      launched = r.page.screens().slice(r.mark).filter(isGuide);
      return { screen: x.first };
    }, { critical: true });
    await wstep(r, 'ou-tu-en-es-au-lancement', async () => {
      // § 3 : « Où tu en es » au lancement ; un moment déjà dû (la voie modifiée de l'IC) peut passer d'abord : masqué,
      // puis un toucher sur l'écran calme rouvre « Où tu en es »
      let w = launched.find(isWhere);
      if (!w) {
        const first = r.page.lastScreen()!;
        check(isGuide(first) && first.show === 'moment', `au lancement, ni « Où tu en es » ni un moment déjà dû : ${show(first)}`);
        ctx.notes.push(`s131calme : moment déjà dû au lancement avant « Où tu en es » : ${show(first)}`);
        await sleep(1_600);
        await webMask(r, 'moment dû au lancement');
        await gesture(r, 'tap');
        w = await waitGuide(r, '« Où tu en es » au toucher', isWhere);
      }
      whereOk(w, O.where131(j, title, 'before'), '« Où tu en es » avant de partir (PRD-1.3.1 § 3, § 12)');
      return { screen: w, shot: 'guide' };
    });
    await wstep(r, 'calme-trois-points', async () => {
      // § 2 : « toucher : masquer » ; § 1 : l'écran calme d'un guidage montre « · · · », au plus pâle, en bas au centre
      await sleep(1_600);
      const cur = r.page.lastScreen();
      const s = cur && isCalm(cur) ? cur : await webMask(r, '« Où tu en es »');
      check(isDots(s), `écran calme : « ${TXT.dots} » seul attendu (PRD-1.3.1 § 1) : ${show(s)}`);
      return { screen: s, shot: 'dots' };
    });
    await wstep(r, 'calme-fixe', async () => {
      // § 1 : fixes, jamais animés ; rien ne change à l'écran tant qu'il n'y a rien à faire (l'heure avance de 2 min)
      const a = await canvasShot(r);
      const n0 = r.page.screens().length;
      await goTo(r, tr, T('07:21'));
      await sleep(2_500);
      await goTo(r, tr, T('07:22'));
      await sleep(2_500);
      const b = await canvasShot(r);
      const fresh = r.page.screens().slice(n0).filter(isGuide);
      check(!fresh.some((x) => !isDots(x)), `l’écran calme a changé sans rien à faire : ${fresh.map(show).join(' | ')}`);
      check(Buffer.compare(a, b) === 0, 'les trois points ont changé entre deux captures, 5 s et 2 min plus tard (§ 1 : fixes, jamais animés)');
      ctx.notes.push(`s131calme : écran calme journalisé ${fresh.length} fois en 2 min sans rien à faire (positions poussées)`);
    });
    await wstep(r, 'toucher-trop-tot', async () => {
      // A7 (E3) : un toucher ne masque qu'un message affiché depuis au moins 1,5 s
      await goTo(r, tr, j.leaveAt + 5_000, false);
      const s = await momentWeb(r, 'Partir maintenant', 'Partir maintenant', 12_000);
      const t0 = Date.now();
      await gesture(r, 'tap', 200);
      const early = Date.now() - t0;
      await sleep(700);
      check(early < 1_300, `essai impossible : toucher envoyé ${early} ms après l’affichage`);
      const after = r.page.screens().slice(r.mark).filter(isGuide);
      check(!after.some(isCalm), `« Partir maintenant » masqué par un toucher ${early} ms après son affichage (A7 : 1,5 s au moins) : ${after.map(show).join(' | ')}`);
      check(O.matches(r.page.lastScreen()?.lines[0], 'Partir maintenant'), `« Partir maintenant » doit rester après un toucher trop tôt (A7) : ${show(r.page.lastScreen())}`);
      // A4 (P4) : « très juste » seulement quand le moteur le dit ; B13 (U6) : « IC 07:42 +2 »
      expectLines(s, O.leaveLines(j, title, j.leaveAt + 5_000), '« Partir maintenant » (A4, B13)', [O.RATES, TXT.rain]);
      momentCommon(s, title);
      return { screen: s, shot: 'guideImage' };
    });
    await wstep(r, 'masquer-apres-1-5-s', async () => {
      await sleep(1_200);
      const s = await webMask(r, 'Partir maintenant (après 1,5 s)');
      check(isDots(s), `après « masquer », les trois points reviennent (§ 1) : ${show(s)}`);
      return { screen: s, shot: 'dots' };
    });
    await wstep(r, 'retour-de-l-ecran-du-guidage', async () => {
      // A1 (E2) : hors de l'écran du guidage (accueil), un virage ne le ramène pas ; « monter » (message important) oui
      await gesture(r, 'double');
      const h = await waitGuide(r, 'accueil pendant le guidage', (s) => s.screen === 'home');
      check(/^En cours/.test(N(h.lines[0])), `« En cours » en tête de l’accueil pendant le guidage : ${show(h)}`);
      r.mark = r.page.screens().length;
      for (let t = T('07:34'); t <= T('07:39:40'); t += 20_000) await goTo(r, tr, t);
      const early = r.page.screens().slice(r.mark).filter(isGuide);
      check(!early.length, `l’écran du guidage est revenu pendant la marche (virage ou rien d’important ; A1 : seulement partir, monter, voie modifiée, descendre, imprévu, arrêt dépassé) : ${early.map(show).join(' | ')}`);
      let back: GlassesScreen | undefined;
      for (let t = T('07:40'); t <= T('07:43:30') && !back; t += 10_000) {
        await goTo(r, tr, t);
        back = r.page.screens().slice(r.mark).find((x) => isGuide(x) && IMPORTANT.has(momentKind(x)));
      }
      check(back, `« monter » (message important) n’a pas ramené l’écran du guidage depuis l’accueil (A1) : dernier écran ${show(r.page.lastScreen())}`);
      check(momentKind(back) === 'board' || momentKind(back) === 'platform', `moment ramené : « ${momentKind(back)} » (monter ou voie modifiée attendu) : ${show(back)}`);
      momentCommon(back, title);
      return { screen: back, shot: 'guideImage' };
    });
    await wstep(r, 'a-bord-progression', async () => {
      // B9 (E1) : à bord, l'écran calme montre la ligne de progression à la place des trois points (même place, même niveau)
      await walkThrough(r, tr, T('07:42:05'), T('08:00:05'), 60_000);
      const cur = r.page.lastScreen()!;
      if (!isCalm(cur)) {
        await sleep(1_600);
        await webMask(r, 'moment à bord');
      }
      const s = await waitGuide(r, 'écran calme à bord', isCalm);
      check(isProgress(s), `à bord, l’écran calme montre la progression « ●─●─◎─○ descente dans N arrêts » à la place des trois points (B9) : ${show(s)}`);
      return { screen: s, shot: 'progress' };
    });
    await wstep(r, 'ou-tu-en-es-a-bord', async () => {
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » à bord', isWhere);
      const l = j.legs[ic];
      const k = (l.stops ?? []).findIndex((x) => x.name.fr === 'Ottignies');
      whereOk(w, O.where131(j, title, 'ride', ic, k), '« Où tu en es » à bord (§ 3, § 12, B9 : la progression ne s’efface jamais)');
      return { screen: w, shot: 'guide' };
    });
    await wstep(r, 'menu-voir-les-arrets', async () => {
      // B10 (E4) : « Voir tout le trajet », « Voir les arrêts », « Arrêter le guidage » en dernier
      await gesture(r, 'long');
      const m = await waitGuide(r, 'menu de l’appui long', (s) => s.screen === 'menu');
      const items = m.lines.filter((l) => TXT.menu.some((x) => N(l).endsWith(x)));
      check(JSON.stringify(items.map((l) => TXT.menu.find((x) => N(l).endsWith(x)))) === JSON.stringify(TXT.menu), `menu : « ${TXT.menu.join(' », « ')} » attendus dans cet ordre (B10), vu ${JSON.stringify(m.lines)}`);
      const k = m.lines.findIndex((l) => N(l).endsWith('Voir les arrêts'));
      for (let i = 0; i < 6 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
      await gesture(r, 'tap');
      const s = await waitGuide(r, '« Voir les arrêts » : les arrêts du véhicule en cours', (x) => x.screen === 'train' || x.screen === 'trainRun' || x.screen === 'stops');
      check(s.lines.some((l) => /^[●◎○─…]+ /.test(N(l))) || s.lines.some((l) => /Bruxelles-Nord/.test(l)), `« Voir les arrêts » : « Dans le train » de l’IC avec sa progression (B10, E4) : ${show(s)}`);
      await gesture(r, 'double');
      await waitGuide(r, 'double toucher : retour au guidage', isGuide);
      return { screen: s, shot: 'capture' };
    });
    await wstep(r, 'marche-apres-la-descente', async () => {
      // B17 (P7) : après la descente du tram (la Bourse), la marche suivante comme « Partir maintenant » :
      // « 9 min à pied jusqu'à la place Fontainas », puis « arrivée 08:58 » ; jusqu'à 40 m de marche
      await walkThrough(r, tr, T('08:01'), T('08:48:40'), 60_000);
      r.mark = r.page.screens().length;
      let s: GlassesScreen | undefined;
      for (let t = T('08:49:05'); t <= T('08:50:30') && !s; t += 10_000) {
        await goTo(r, tr, t);
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && (momentKind(x) === 'walk' || /^\d+ min à pied jusqu’/.test(N(x.lines[0]))));
      }
      check(s, `B17 : après la descente du tram à la Bourse, pas de moment « N min à pied jusqu’à la place Fontainas » : ${show(r.page.lastScreen())}`);
      check(/^\d+ min à pied jusqu’à la place Fontainas$/.test(N(s.lines[0])), `1re ligne « ${s.lines[0]} » au lieu de « 9 min à pied jusqu’à la place Fontainas » (B17)`);
      check(/^arrivée ~?08:5\d$/.test(N(s.lines[1])), `2e ligne « ${s.lines[1]} » au lieu de « arrivée 08:58 » (B17)`);
      momentCommon(s, title);
      return { screen: s, shot: 'guideImage' };
    });
    await wstep(r, 'ou-tu-en-es-derniere-marche', async () => {
      await goTo(r, tr, T('08:52'));
      const cur = r.page.lastScreen()!;
      if (!isCalm(cur)) {
        await sleep(1_600);
        await webMask(r, 'moment de la dernière marche');
      }
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » sur la dernière marche', isWhere);
      whereOk(w, O.where131(j, title, 'last'), '« Où tu en es » sur la dernière marche (§ 3, § 12 : « Ensuite : arrivée … »)');
      return { screen: w, shot: 'guide' };
    });
    await wstep(r, 'pas-de-points-hors-du-guidage', async () => {
      // § 1 : pas en dehors d'un guidage ; « Arrêter le guidage » est le dernier choix du menu (B10)
      await gesture(r, 'long');
      const m = await waitGuide(r, 'menu', (s) => s.screen === 'menu');
      const k = m.lines.findIndex((l) => N(l).endsWith('Arrêter le guidage'));
      for (let i = 0; i < 6 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
      await gesture(r, 'tap');
      const h = await waitGuide(r, 'accueil après « Arrêter le guidage »', (s) => s.screen === 'home');
      await sleep(800);
      const after = r.page.screens().slice(r.mark);
      check(!after.some((s) => s.lines.some((l) => O.matches(l, TXT.dots))), `« ${TXT.dots} » hors d’un guidage (§ 1) : ${after.map(show).join(' | ')}`);
      check(!(await webFollowed(r)), 'trajet encore suivi après « Arrêter le guidage »');
      return { screen: h, shot: 'layout' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s131memo : l'arrêt retenu (§ 6, B11) ------------------------------ */

async function s131memo(ctx: Ctx131): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    /** Gares de train, tableau de Namur, IC de 07:42, tout son trajet. */
    const openIcStops = async (): Promise<GlassesScreen> => {
      await webSelectHome(r, /^Gares de train {3}/);
      await gesture(r, 'tap');
      await waitGuide(r, '« Gares de train »', (s) => (s.screen === 'stations' || s.screen === 'board') && loaded(s), 15_000);
      if (r.page.lastScreen()?.screen === 'stations') await gesture(r, 'tap');
      const b = await waitGuide(r, 'tableau de Namur', (s) => s.screen === 'board' && loaded(s) && s.lines.some((l) => /\bIC\b/.test(l)), 15_000);
      const k = b.lines.findIndex((l) => /\bIC\b/.test(l) && /07:42/.test(l));
      check(k >= 0, `IC de 07:42 absent du tableau de Namur : ${show(b)}`);
      await webSelectRow(r, k);
      await gesture(r, 'tap');
      return waitGuide(r, 'tout le trajet de l’IC', (s) => (s.screen === 'trainRun' || s.screen === 'stops') && loaded(s) && s.lines.length > 3, 15_000);
    };
    await wstep(r, 'arrets-de-l-ic', async () => {
      await openWeb(r, ctx.pageUrl({ ...ON_PLATFORM, ...ctx.preset('p/1210.json') }, true));
      const st = await openIcStops();
      const bad = stopsActionIssues(st as unknown as Screen, (st.sel ?? 0) > (field<number>(st, 'gare') ?? 0));
      check(!bad.length, bad.join(' ; '));
      return { screen: st, shot: 'layout' };
    }, { critical: true });
    await wstep(r, 'jy-descends-bruxelles-central', async () => {
      for (let i = 0; i < 12 && !/Bruxelles-Central/.test(cursorRowText(r.page.lastScreen()!) ?? ''); i++) await gesture(r, 'down');
      const s = r.page.lastScreen()!;
      check(/Bruxelles-Central/.test(cursorRowText(s) ?? ''), `curseur jamais sur Bruxelles-Central : ${show(s)}`);
      const bad = stopsActionIssues(s as unknown as Screen, true);
      check(!bad.length, bad.join(' ; '));
      await gesture(r, 'tap');
      const g = await waitGuide(r, 'guidage « j’y descends »', (x) => isGuide(x) && !!x.title, 15_000);
      const ft = await webFollowed(r);
      check(ft?.guide?.kind === 'ride' || ft?.journey?.legs?.length === 1, `« j’y descends » attendu (genre ride) : ${JSON.stringify(ft?.guide ?? null)}`);
      return { screen: g };
    }, { critical: true });
    await wstep(r, 'arreter-puis-rouvrir', async () => {
      await gesture(r, 'long');
      const m = await waitGuide(r, 'menu', (s) => s.screen === 'menu');
      const k = m.lines.findIndex((l) => N(l).endsWith('Arrêter le guidage'));
      check(k >= 0, `« Arrêter le guidage » absent du menu : ${show(m)}`);
      for (let i = 0; i < 6 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
      await gesture(r, 'tap');
      await waitGuide(r, 'accueil', (s) => s.screen === 'home' && loaded(s), 15_000);
      // B11 (I2) : la liste s'ouvre sur l'arrêt retenu (le plus récent choisi avec « j'y descends » pour cette ligne), et la
      // ligne d'action dit son nom : « ▶ Me guider jusqu’à Bruxelles-Central »
      const st = await openIcStops();
      const at = cursorRowText(st) ?? '';
      check(/Bruxelles-Central/.test(at), `B11 : la liste ne s’ouvre pas sur l’arrêt retenu (Bruxelles-Central) : curseur sur « ${at} » (${show(st)})`);
      check(O.matches(actionOf(st), '▶ Me guider jusqu’à Bruxelles-Central'), `B11 : ligne d’action « ${actionOf(st) ?? '(aucune)'} » au lieu de « ▶ Me guider jusqu’à Bruxelles-Central »`);
      check(O.matches(hint(st), TXT.stopsHints), `aides « ${N(hint(st))} » au lieu de « ${TXT.stopsHints} » (§ 6)`);
      return { screen: st, shot: 'layout' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s131rate : bus raté en marchant (A2) ------------------------------ */

async function s131rate(ctx: Ctx131): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    let j!: O.OJourney;
    let title = FONTAINAS;
    await wstep(r, 'a-pied-pendant-le-depart', async () => {
      await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
      ({ j, title } = await webLaunch(r));
      const icDep = j.legs[j.legs.findIndex((l) => l.kind === 'ride')].dep;
      await walkThrough(r, LATE_WALK, T('07:31'), T('07:41:30'), 60_000);
      r.mark = r.page.screens().length;
      // l'IC part (07:44) pendant la marche : on reste « à pied » tant qu'on marche vers la gare (A2, P1)
      const seen = await walkThrough(r, LATE_WALK, T('07:42'), icDep + 100_000, 20_000, false);
      const ride = seen.find((s) => s.lines.some((l) => /^(Prochain arrêt|Descends|Ensuite : descente)/.test(N(l))) || O.PROGRESS_RE.test(N(s.lines.find((l) => l.trim()) ?? '')));
      check(!ride, `A2 : passé « à bord » alors qu’on marche encore vers la gare : ${show(ride)}`);
      const stopped = r.page.screens().slice(r.mark).find((s) => s.screen === 'home');
      check(!stopped, `A2 : le guidage s’est arrêté sans un mot (règle « pas parti ») : ${show(stopped)}`);
      const cur = r.page.lastScreen()!;
      if (!isCalm(cur) && isGuide(cur)) {
        await sleep(1_600);
        await webMask(r, 'moment en cours');
      }
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » en marchant', isWhere);
      check(w.lines.some((l) => /^À pied vers /.test(N(l))), `A2 : « Où tu en es » doit dire « À pied vers … » pendant la marche : ${show(w)}`);
      return { screen: w, shot: 'guide' };
    }, { critical: true });
    await wstep(r, 'ton-ic-est-parti', async () => {
      // quand le véhicule est parti (2 min après, temps réel) : « Ton IC de 07:44 est parti », le nouveau trajet depuis là où on est
      const icDep = j.legs[j.legs.findIndex((l) => l.kind === 'ride')].dep;
      r.mark = r.page.screens().length;
      // le message vient d'abord seul (le nouveau trajet se calcule), puis avec « Nouveau trajet : … » : on attend le second
      const gone = (x: GlassesScreen) => isGuide(x) && /^Ton IC de \d\d:\d\d est parti$/.test(N(x.lines[0]));
      const withNew = (x: GlassesScreen) => gone(x) && x.lines.some((l) => /^Nouveau trajet : /.test(N(l)));
      let s: GlassesScreen | undefined;
      for (let t = icDep + 110_000; t <= icDep + 240_000 && !s; t += 15_000) {
        await goTo(r, LATE_WALK, t);
        s = r.page.screens().slice(r.mark).find(withNew);
      }
      const alone = r.page.screens().slice(r.mark).find(gone);
      check(alone, `A2 : « Ton IC … est parti » jamais affiché après le départ de l’IC : ${show(r.page.lastScreen())}`);
      check(s, `« Nouveau trajet : IC à 08:42, voie 5 » jamais venu sous « Ton IC … est parti » (A2, B12) : ${show(alone)}`);
      check(s.lines.some((l) => /^Nouveau trajet : IC à ~?08:42(, voie 5)?$/.test(N(l))), `« Nouveau trajet : IC à 08:42, voie 5 » attendu (A2, B12) : ${show(s)}`);
      momentCommon(s, title);
      return { screen: s, shot: 'guide' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s131sansrt : sans temps réel, le véhicule gardé (A3) ------------------------------ */

async function s131sansrt(ctx: Ctx131): Promise<void> {
  await ctx.scene('noRT');
  try {
    await ctx.withChrome(async (page) => {
      const r: Run = { ctx, page, mark: 0 };
      let j!: O.OJourney;
      let title = FONTAINAS;
      await wstep(r, 'sur-le-quai-l-heure-passee', async () => {
        await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
        ({ j, title } = await webLaunch(r));
        const l = j.legs[j.legs.findIndex((x) => x.kind === 'ride')];
        check(!l.rt, `scène sans temps réel attendue : ${JSON.stringify({ rt: l.rt })}`);
        await walkThrough(r, PLATFORM_LONG, T('07:31'), T('07:41'), 60_000);
        // A3 (I1) : l'heure passée de 11 min, toujours sur le quai : pas encore « est parti » (gardé jusqu'à 15 min avant le suivant)
        r.mark = r.page.screens().length;
        await walkThrough(r, PLATFORM_LONG, T('07:42'), T('07:54'), 60_000);
        const gone = r.page.screens().slice(r.mark).find((x) => isGuide(x) && (/est parti$/.test(N(x.lines[0])) || /^Nouveau trajet/.test(N(x.lines[0]))));
        check(!gone, `A3 : sans temps réel, l’IC de 07:42 donné pour parti ou remplacé 12 min après son heure (gardé jusqu’à 15 min avant le suivant) : ${show(gone)}`);
        const cur = r.page.lastScreen()!;
        if (!isCalm(cur) && isGuide(cur)) {
          await sleep(1_600);
          await webMask(r, 'moment en cours');
        }
        await gesture(r, 'tap');
        const w = await waitGuide(r, '« Où tu en es » sur le quai, l’heure passée', isWhere);
        // « Ensuite : IC à ~07:42 » (plus jamais « dans ~1 min » une fois l'heure passée) ; pâle « Si tu le rates : arrivée … »
        check(w.lines.some((l) => /^Ensuite : IC à ~07:42(, voie \S+( !)?)?$/.test(N(l))), `A3 : « Ensuite : IC à ~07:42 » attendu : ${show(w)}`);
        check(!w.lines.some((l) => /dans ~?\d+ min/.test(N(l))), `A3 : jamais « dans ~1 min » une fois l’heure passée : ${show(w)}`);
        check(w.lines.some((l) => O.RATES.test(N(l))), `A3 : ligne « Si tu le rates : arrivée HH:MM, N min plus tard » attendue : ${show(w)}`);
        return { screen: w, shot: 'guide' };
      }, { critical: true });
      await wstep(r, 'nouveau-trajet-sans-est-parti', async () => {
        // resté sur le quai jusqu'à 15 min avant le suivant (08:42 - 15 = 08:27) : « Nouveau trajet : … » sans « est parti »
        r.mark = r.page.screens().length;
        let s: GlassesScreen | undefined;
        for (let t = T('08:20'); t <= T('08:30') && !s; t += 30_000) {
          await goTo(r, PLATFORM_LONG, t);
          s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && x.lines.some((l) => /^Nouveau trajet : /.test(N(l))));
        }
        check(s, `A3 : « Nouveau trajet : … » jamais affiché avant 08:30 (15 min avant l’IC de 08:42) : ${show(r.page.lastScreen())}`);
        check(!s.lines.some((l) => /est parti/.test(N(l))), `A3 : sans temps réel, resté sur le quai : « Nouveau trajet » sans « est parti » : ${show(s)}`);
        const early = r.page.screens().slice(r.mark).find((x) => isGuide(x) && x.lines.some((l) => /^Nouveau trajet : /.test(N(l))));
        check(early && (early.clock ?? '') >= '08:2', `A3 : nouveau trajet avant 08:20 : ${show(early)}`);
        momentCommon(s, title);
        return { screen: s, shot: 'guide' };
      });
    }, VIEWPORT);
  } finally {
    await ctx.scene('base');
  }
}

/* ------------------------------ s131demitour : « Fais demi-tour » (A6) ------------------------------ */

async function s131demitour(ctx: Ctx131): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await wstep(r, 'fais-demi-tour', async () => {
      await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
      const { j, title } = await webLaunch(r);
      const { trace: tr, turnAt } = uturnTrace(j.leaveAt);
      await walkThrough(r, tr, T('07:21'), j.leaveAt + 20_000, 60_000);
      r.mark = r.page.screens().length;
      let s: GlassesScreen | undefined;
      const seen: GlassesScreen[] = [];
      for (let t = j.leaveAt + 20_000; t <= turnAt + 45_000 && !s; t += 4_000) {
        const n0 = r.page.screens().length;
        await goTo(r, tr, t);
        seen.push(...r.page.screens().slice(n0).filter(isGuide));
        s = seen.find((x) => O.matches(x.lines[0], TXT.uturn));
      }
      check(s, `A6 : « ${TXT.uturn} » jamais affiché après 40 m dans le sens contraire du chemin : ${seen.slice(-3).map(show).join(' | ') || show(r.page.lastScreen())}`);
      check(/^vers (l’arrêt |la gare de |la voie )\S/.test(N(s.lines[1])), `2e ligne pâle « ${s.lines[1]} » au lieu de « vers la gare de Namur » / « vers l’arrêt X » (A6, P3)`);
      check(Array.isArray(s.images) && (s.images as unknown[]).length === 1, `A6 : la flèche du demi-tour attendue à gauche : ${JSON.stringify(s.images)}`);
      momentCommon(s, title);
      return { screen: s, shot: 'guideImage' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s131sousterre : positions perdues (A8, L3) ------------------------------ */

async function s131sousterre(ctx: Ctx131): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    const tr = NAMUR_FONTAINAS;
    let title = FONTAINAS;
    await wstep(r, 'position-perdue-avant-de-partir', async () => {
      await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
      let j!: O.OJourney;
      ({ title, j } = await webLaunch(r));
      // avant de partir, plus aucune position depuis 3 min : « Position perdue depuis 3 min » et, pâle, L3. La position
      // n'est demandée (et écoutée) que 10 min avant de partir (PRD-1.2.10 ; § 6.3 de la 1.3.0 : « alors que la phase en
      // demande et qu'il y en avait ») : des positions de 10 à 9 min avant l'heure de partir, puis plus aucune
      const need = j.leaveAt - 10 * 60_000;
      await walkThrough(r, tr, T('07:20:20'), need - 20_000, 20_000);
      // Mode test : un saut de l'horloge recalcule le moteur sans toucher au flux de position (controller.ts, listenClock) ;
      // dans la vraie vie le même pas ouvre le flux. Ici un geste le fait : « Où tu en es », masqué après 1,5 s.
      await goTo(r, null, need + 2_000);
      await gesture(r, 'tap');
      await waitGuide(r, '« Où tu en es » (position demandée)', isWhere);
      await sleep(1_600);
      await webMask(r, '« Où tu en es »');
      await walkThrough(r, tr, need + 20_000, need + 60_000, 20_000);
      r.mark = r.page.screens().length;
      const none = r.page.screens().find((x) => isGuide(x) && x.lines.some((l) => /^Pas de position/.test(N(l))));
      check(!none, `« Pas de position » alors que des positions arrivent depuis que le guidage en demande : ${show(none)}`);
      let s: GlassesScreen | undefined;
      let lostAt = 0;
      for (let t = need + 80_000; t <= j.leaveAt - 60_000 && !s; t += 20_000) {
        lostAt = t;
        await goTo(r, null, t);
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && x.lines.some((l) => /^Position perdue depuis \d+ min$/.test(N(l))));
      }
      check(s, `« Position perdue depuis 3 min » jamais affiché avant de partir (jusqu’à ${O.hm(j.leaveAt - 60_000)}), sans position depuis ${O.hm(need + 60_000)} (PRD-1.3.0 § 6.3, gardé avant de partir par A8) : ${show(r.page.lastScreen())} ; écrans vus : ${r.page.screens().slice(r.mark).filter(isGuide).slice(-8).map(show).join(' | ')}`);
      check(lostAt >= need + 60_000 + 3 * 60_000 - 20_000 && lostAt <= need + 60_000 + 4 * 60_000, `« Position perdue » à ${O.hm(lostAt)} : attendu 3 min après la dernière position (${O.hm(need + 60_000)})`);
      check(s.lines.some((l) => /^Position perdue depuis 3 min$/.test(N(l))), `« Position perdue depuis 3 min » attendu : ${show(s)}`);
      check(s.lines.some((l) => O.matches(l, TXT.lostPale)), `ligne pâle « ${TXT.lostPale} » attendue sous « Position perdue » (L3) : ${show(s)}`);
      check(!s.lines.some((l) => /guidage à l’heure/.test(N(l))), `« guidage à l’heure » remplacé par « Quai suit l’horaire » (L3) : ${show(s)}`);
      momentCommon(s, title);
      return { screen: s, shot: 'guide' };
    });
    await wstep(r, 'sous-terre-a-bord', async () => {
      // A8 (I4) : à bord, aucune position pendant 8 min (tunnel) : aucun message de position
      await walkThrough(r, tr, T('07:27'), T('07:50'), 60_000);
      r.mark = r.page.screens().length;
      for (let t = T('07:51'); t <= T('07:59'); t += 30_000) await goTo(r, null, t);
      const bad = r.page.screens().slice(r.mark).find((x) => isGuide(x) && x.lines.some((l) => /^(Position perdue|Pas de position)/.test(N(l))));
      check(!bad, `A8 : message de position à bord (sous terre, le journal note le trou, rien à l’écran) : ${show(bad)}`);
      return { screen: r.page.lastScreen() };
    });
  }, VIEWPORT);
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await wstep(r, 'pas-de-position', async () => {
      // L3 : aucune position depuis le lancement (jamais poussée), un trajet qui commence à pied : 30 s après que le
      // guidage en demande (10 min avant de partir), « Pas de position : Quai suit l'horaire » (Quai Web : sans le
      // conseil de l'appli Even). D'une gare à une gare, rien : on y attend à l'arrêt, puis à bord (A8).
      // Aucun geste d'ici là : en mode test, le flux de position ne s'ouvre pas sur un saut de l'horloge (listenClock),
      // donc la position simulée du lancement n'est jamais donnée au guidage : c'est le cas « aucune position ».
      await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
      const { j, title } = await webLaunch(r);
      r.mark = r.page.screens().length;
      let s: GlassesScreen | undefined;
      for (let t = T('07:20:30'); t <= j.leaveAt - 2 * 60_000 && !s; t += 20_000) {
        await goTo(r, null, t);
        s = r.page.screens().slice(r.mark).find((x) => isGuide(x) && x.lines.some((l) => /^Pas de position/.test(N(l))));
      }
      check(s, `« ${TXT.noPosition} » jamais affiché sans position, jusqu’à ${O.hm(j.leaveAt - 2 * 60_000)} (départ à ${O.hm(j.leaveAt)}, position demandée 10 min avant, vérification 30 s après) : ${show(r.page.lastScreen())}`);
      check(s.lines.some((l) => O.matches(l, TXT.noPosition)), `« ${TXT.noPosition} » attendu (L3) : ${show(s)}`);
      check(!s.lines.some((l) => /guidage à l’heure/.test(N(l))), `« guidage à l’heure » remplacé par « Quai suit l’horaire » (L3) : ${show(s)}`);
      momentCommon(s, title);
      return { screen: s, shot: 'guide' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s131pluie : « pluie prévue » sur « Partir maintenant » (B19) ------------------------------ */

/**
 * Gare de Bruxelles-Central (scénario 3 des fixtures), 08:46 : vers la place Fontainas, 10 min à pied (aucun tram par là
 * dans les fixtures), sous la pluie du faux Open-Meteo (Bruxelles, 08:45 à 09:00).
 */
const CENTRAL = { lat: 50.8454, lon: 4.3571 };
const RAIN_START = { mockLat: String(CENTRAL.lat), mockLon: String(CENTRAL.lon), mockNow: '2026-11-10T08:46:00+01:00' };

async function s131pluie(ctx: Ctx131): Promise<void> {
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await wstep(r, 'partir-sous-la-pluie', async () => {
      await openWeb(r, ctx.pageUrl({ ...RAIN_START, ...ctx.preset('p/1210.json') }, true));
      const n0 = r.page.screens().length;
      const { j, title } = await webLaunch(r);
      check(j.legs[0]?.kind === 'walk', `essai impossible : le trajet ne commence pas à pied (${j.legs.map((l) => l.kind).join(', ')})`);
      check(j.legs[0].rain, `essai impossible : la première marche du trajet ne porte pas la pluie (faux Open-Meteo : 08:45 à 09:00 sur Bruxelles), trajet ${JSON.stringify(j.legs.map((l) => [l.kind, O.hm(l.dep), O.hm(l.arr), l.rain ?? false]))}`);
      const stay0 = { id: 's131-central', label: 'Gare de Bruxelles-Central', places: ['Bruxelles-Central'], points: stay(CENTRAL, T('08:46'), T('09:10'), { phase: 'stay', accuracy: 6 }) } as Trace;
      // l'heure de partir est déjà là au lancement : « Partir maintenant » peut venir avant la première position poussée
      await goTo(r, stay0, Math.max(j.leaveAt, T('08:46')) + 5_000);
      r.mark = n0;
      const s = await momentWeb(r, 'Partir maintenant', 'Partir maintenant', 12_000);
      // B19 (I5) : « pluie prévue », 4e ligne pâle, quand la première marche porte la pluie
      check(s.lines.some((l) => O.matches(l, TXT.rain)), `« ${TXT.rain} » absent de « Partir maintenant » alors que la première marche est sous la pluie (B19) : ${show(s)}`);
      momentCommon(s, title);
      return { screen: s, shot: 'guideImage' };
    });
  }, VIEWPORT);
}

/* ------------------------------ s131tel : téléphone et onglet Réglages (§ 4, § 8, L2, L5, L7, L8, U3) ------------------------------ */

const NORM_JS = `const n = (s) => (s ?? '').replace(/[\\u00a0\\u202f]/g, ' ').replace(/'/g, '’').replace(/\\s+/g, ' ').trim();`;
const NO_EMU = '#glasses-emulator{display:none !important}';
/** Étape du téléphone (Chrome) : capture de la page (390 × 844), résultat dans le rapport commun. */
async function tstep(ctx: Ctx131, page: Page, name: string, fn: () => Promise<{ shot?: boolean; glasses?: GlassesScreen } | void>): Promise<void> {
  const t0 = Date.now();
  const res: Parameters<Ctx131['record']>[0] = { scenario: ctx.scenario(), step: name, ok: true, ms: 0 };
  try {
    const out = (await fn()) ?? {};
    if (out.glasses) res.screen = out.glasses;
    if (out.shot) {
      await page.addStyle(NO_EMU);
      await page.eval(`(window.scrollTo(0, 0), true)`);
      const file = join(ctx.shots, `${res.scenario}-${name}.png`);
      await page.screenshot(file);
      res.shot = file.slice(file.indexOf('tests/e2e/') + 10);
    }
    console.log(`  ✓ ${res.scenario}-${name}`);
  } catch (e) {
    res.ok = false;
    res.error = (e as Error).message;
    console.log(`  ✗ ${res.scenario}-${name} : ${res.error}`);
    try {
      await page.screenshot(join(ctx.shots, `${res.scenario}-${name}-ECHEC.png`));
    } catch {
      /* page fermée */
    }
  }
  res.ms = Date.now() - t0;
  ctx.record(res);
}
async function pageText(page: Page, selector = 'main'): Promise<string> {
  return page.eval<string>(`(() => { ${NORM_JS} return n((document.querySelector(${JSON.stringify(selector)}) || document.body).innerText); })()`);
}
async function pageWait(page: Page, re: RegExp, timeout: number, label: string, selector = 'main'): Promise<string> {
  const t0 = Date.now();
  let t = '';
  while (Date.now() - t0 < timeout) {
    t = await pageText(page, selector);
    if (re.test(t)) return t;
    await sleep(300);
  }
  throw new Check(`téléphone : délai dépassé en attendant ${label} ; texte vu : « ${t.slice(0, 700)} »`);
}

async function s131tel(ctx: Ctx131): Promise<void> {
  // téléphone : la page de l'appli Even dans Chrome (390 × 844), réglages « Maison » et « Bureau » (lieux publics)
  await ctx.withChrome(async (page) => {
    await tstep(ctx, page, 'accueil-du-telephone', async () => {
      await page.goto(ctx.pageUrl({ mockLat: '50.4655', mockLon: '4.859', mockNow: '2026-11-10T07:31:00+01:00', ...ctx.preset('p/nice.json') }, false) + '#/');
      await page.waitFor(`!!document.querySelector('.mirror-sec .fav-card')`, 15_000, 'accueil du téléphone (« Dans tes lunettes »)');
      // § 8 : même ordre que les lunettes ; « Où vas-tu ? » reste en haut du téléphone
      const titles = await page.eval<string[]>(`(() => { ${NORM_JS} return [...document.querySelectorAll('.mirror .nav-row')].map((a) => n(a.querySelector('.t1')?.textContent)); })()`);
      check(JSON.stringify(titles) === JSON.stringify(TXT.home), `rubriques de l’accueil du téléphone ${JSON.stringify(titles)} au lieu de ${JSON.stringify(TXT.home)} (PRD-1.3.1 § 8)`);
      const t = await pageText(page);
      const where = t.indexOf('Où vas-tu');
      check(where >= 0 && where < t.indexOf(TXT.home[0]), `« Où vas-tu ? » en haut du téléphone, avant les rubriques (§ 8) : « ${t.slice(0, 300)} »`);
      // L7 : les mêmes noms que les lunettes (« Bureau », pas « Vers le bureau »)
      await page.waitFor(`(() => { const a = [...document.querySelectorAll('.fav-card .fav-row .answer')]; return a.length >= 2 && a.every((x) => x.textContent && !x.textContent.endsWith('…')); })()`, 25_000, 'réponses des favoris');
      const names = await page.eval<string[]>(`(() => { ${NORM_JS} return [...document.querySelectorAll('.fav-card .fav-row .t1')].map((r) => n(r.textContent)); })()`);
      // (un trajet fixe entre deux gares s'appelle « Vers Gand-Saint-Pierre » sur les lunettes aussi : seul le lieu change)
      check(names.some((x) => /^Bureau( !)?$/.test(x)) && names.some((x) => /^Maison( !)?$/.test(x)) && !names.some((x) => /^Vers (le bureau|la maison)/i.test(x)), `noms des favoris du téléphone ${JSON.stringify(names)} : « Bureau » et « Maison » comme sur les lunettes (L7)`);
      // B15 (U2) : le « ! » d'un favori dont le trajet a un souci (voie modifiée de l'IC), aussi sur l'accueil du téléphone
      const rows = await page.eval<string[]>(`(() => { ${NORM_JS} return [...document.querySelectorAll('.fav-card .fav-row')].map((r) => n(r.innerText)); })()`);
      check(rows.some((x) => /Bureau\s*!/.test(x)), `« Bureau ! » attendu sur l’accueil du téléphone (B15 : voie modifiée de l’IC) : ${JSON.stringify(rows)}`);
      check(!/'/.test(await page.eval<string>(`document.querySelector('main')?.innerText ?? ''`)), 'apostrophe droite affichée sur l’accueil du téléphone (PRD-1.3.1 § 7)');
      return { shot: true };
    });
    await tstep(ctx, page, 'reglage-me-guider', async () => {
      await page.eval(`(location.hash = '#/reglages', true)`);
      const t = await pageWait(page, /Me guider pendant un trajet/, 10_000, 'Réglages');
      // L2 : l'aide du réglage dit les trois points
      check(t.includes(N(TXT.guideSetting)), `aide du réglage « Me guider pendant un trajet » : « ${TXT.guideSetting} » attendue (L2) ; texte vu : « ${t.slice(0, 900)} »`);
      return { shot: true };
    });
  });
  // Quai Web : l'onglet Lunettes et l'onglet Réglages (la page du téléphone) côte à côte
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    let j!: O.OJourney;
    await wstep(r, 'quai-web-autre-adresse', async () => {
      await openWeb(r, ctx.pageUrl({ ...START, ...ctx.preset('p/1210.json') }, true));
      await webSelectHome(r, /^Favoris {3}\d+$/);
      await gesture(r, 'tap');
      await waitGuide(r, '« Favoris »', (s) => s.screen === 'favorites' && loaded(s), 20_000);
      // ▼ jusqu'à « Autre adresse », la dernière rangée (la liste défile)
      for (let i = 0; i < 20 && !r.page.lastScreen()!.lines.some((l) => /^Autre adresse {3}/.test(N(l))); i++) await gesture(r, 'down');
      const s = r.page.lastScreen()!;
      const row = s.lines.find((l) => /^Autre adresse {3}/.test(N(l)));
      // L8 : « dans l'onglet Réglages » (« dans Réglages » désignait deux endroits)
      check(row && O.matches(row, 'Autre adresse   dans l’onglet Réglages'), `« Autre adresse   dans l’onglet Réglages » attendu (L8) : ${show(s)}`);
      return { screen: s, shot: 'layout' };
    });
    await wstep(r, 'carte-en-cours-avant-de-partir', async () => {
      await gesture(r, 'double');
      await waitGuide(r, 'accueil', (s) => s.screen === 'home', 10_000);
      ({ j } = await webLaunch(r));
      // L5 : avant le départ, la carte « En cours » dit ce qui vient : « Ensuite : partir à 07:33 »
      await page.eval(`(document.querySelector('#w-tab-reglages')?.click(), location.hash = '#/', true)`);
      const t = await pageWait(page, /En cours/, 10_000, 'carte « En cours »');
      check(new RegExp(`Ensuite : partir à ${esc(O.hm(j.leaveAt))}`).test(t), `carte « En cours » : « Ensuite : partir à ${O.hm(j.leaveAt)} » attendu avant le départ (L5) ; texte vu : « ${t.slice(0, 500)} »`);
      check(!/Maintenant : partir à/.test(t), `« Maintenant : partir à … » remplacé par « Ensuite : … » (L5) : « ${t.slice(0, 500)} »`);
      return {};
    }, { critical: true });
    await wstep(r, 'arreter', async () => {
      await page.eval(`(document.querySelector('#w-tab-lunettes')?.click(), true)`);
      await gesture(r, 'long');
      const m = await waitGuide(r, 'menu', (x) => x.screen === 'menu');
      const k = m.lines.findIndex((l) => N(l).endsWith('Arrêter le guidage'));
      check(k >= 0, `« Arrêter le guidage » absent du menu : ${show(m)}`);
      for (let i = 0; i < 6 && r.page.lastScreen()?.sel !== k; i++) await gesture(r, (r.page.lastScreen()?.sel ?? 0) < k ? 'down' : 'up');
      await gesture(r, 'tap');
      return { screen: await waitGuide(r, 'accueil', (x) => x.screen === 'home') };
    });
  }, VIEWPORT);
  // U3 (c), L2 : à pied vers un arrêt de bus, tram ou métro, la carte « En cours » le nomme. Gare du Nord (12:10, scénario
  // 2 des fixtures) vers le boulevard du Centenaire (Heysel) : 6 min à pied jusqu'à Rogier, métro 6 (CA-M5.2)
  await ctx.withChrome(async (page) => {
    const r: Run = { ctx, page, mark: 0 };
    await wstep(r, 'carte-en-cours-a-pied-vers-l-arret', async () => {
      await openWeb(r, ctx.pageUrl({ ...S2_GDN, ...ctx.preset('p/131centenaire.json') }, true));
      await webSelectHome(r, /^Favoris {3}\d+$/);
      await gesture(r, 'tap');
      await waitGuide(r, '« Favoris »', (x) => x.screen === 'favorites' && loaded(x), 20_000);
      await gesture(r, 'tap');
      const steps = await waitGuide(r, 'écran du trajet vers le boulevard du Centenaire', (x) => x.screen === 'steps' && loaded(x), 20_000);
      check(steps.lines.some((l) => /à pied \d+ min → Rogier/.test(N(l))), `trajet par Rogier attendu (« à pied 6 min → Rogier », § 4) : ${show(steps)}`);
      await gesture(r, 'tap');
      await waitGuide(r, 'guidage', (x) => isGuide(x) && !!x.title, 15_000);
      const ft = await webFollowed(r);
      check(ft?.journey?.legs?.[0]?.kind === 'walk', `le trajet guidé commence à pied : ${JSON.stringify(ft?.journey?.legs?.map((l) => l.kind))}`);
      const j = ft!.journey;
      const tr: Trace = { id: 's131-rogier', label: 'Gare du Nord → Rogier (à pied)', places: ['Gare du Nord', 'Rogier'], points: joinTrace(stay(GDN, T('12:10'), j.leaveAt, { phase: 'stay', accuracy: 6 }), walk([GDN, { lat: 50.8585, lon: 4.3592 }, PLACES.rogier], j.leaveAt + 10_000, { speed: 1.3 })) };
      await walkThrough(r, tr, T('12:10:30'), j.leaveAt + 70_000, 30_000);
      // § 4 : « Où tu en es » à pied : « À pied vers l'arrêt Rogier » (le nom, plus « l'arrêt du métro 6 »)
      const cur = r.page.lastScreen()!;
      if (!isCalm(cur)) {
        await sleep(1_600);
        await webMask(r, 'moment en cours');
      }
      await gesture(r, 'tap');
      const w = await waitGuide(r, '« Où tu en es » à pied vers Rogier', isWhere);
      check(w.lines.some((l) => O.matches(l, 'À pied vers l’arrêt Rogier')), `« Où tu en es » : « À pied vers l’arrêt Rogier » attendu (PRD-1.3.1 § 4) : ${show(w)}`);
      await page.eval(`(document.querySelector('#w-tab-reglages')?.click(), location.hash = '#/', true)`);
      const txt = await pageWait(page, /En cours/, 10_000, 'carte « En cours »');
      check(/Maintenant : à pied vers l’arrêt Rogier/.test(txt), `carte « En cours » : « Maintenant : à pied vers l’arrêt Rogier » attendu (U3, L2 : le nom de l’arrêt, plus « l’arrêt du métro 6 ») ; texte vu : « ${txt.slice(0, 500)} »`);
      return {};
    });
  }, VIEWPORT);
}

/* ------------------------------ Liste ------------------------------ */

export function scenarios131(ctx: Ctx131): [string, string, () => Promise<void>][] {
  return [
    ['s131accueil', '1.3.1 (simulateur Even Hub) : accueil dans l’ordre (Autour de moi, Favoris, Gares, Lignes, Arrêts), curseur sur « Autour de moi », « ! » d’un favori, pas de message depuis la 1.3.0, aides des listes, Gares en accordéon, « En cours »', () => s131accueil(ctx)],
    ['s131trajet', '1.3.1 (simulateur Even Hub) : « à pied 9 min → Namur » dans les favoris et l’écran du trajet, la correspondance nommée, l’arrivée sur la dernière marche', () => s131trajet(ctx)],
    ['s131arrets', '1.3.1 (simulateur Even Hub) : « ▶ Me guider jusqu’à cet arrêt » au plus clair sur un arrêt après la montée (tram, train), aucune sur l’arrêt de la montée, aides « △▽ arrêts   double : retour »', () => s131arrets(ctx)],
    ['s131soir', '1.3.1 (simulateur Even Hub) : le soir, l’accueil montre les favoris avec « demain »', () => s131soir(ctx)],
    ['s131apos', '1.3.1 (simulateur Even Hub) : « Braine-l’Alleud » des données avec l’apostrophe typographique (gares, tableau, trajet d’un train)', () => s131apos(ctx)],
    ['s131calme', '1.3.1 (Quai Web) : « Où tu en es » (Guidage en cours, Jusqu’à, Ensuite), trois points sur l’écran calme, « masquer », toucher trop tôt, retour de l’écran du guidage, progression à bord, menu, marche après la descente', () => s131calme(ctx)],
    ['s131memo', '1.3.1 (Quai Web) : « ▶ Me guider jusqu’à Bruxelles-Central », l’arrêt retenu après « j’y descends »', () => s131memo(ctx)],
    ['s131rate', '1.3.1 (Quai Web) : l’IC part pendant la marche : « à pied » tant qu’on marche, puis « Ton IC … est parti » et le nouveau trajet', () => s131rate(ctx)],
    ['s131sansrt', '1.3.1 (Quai Web) : sans temps réel, l’IC gardé jusqu’à 15 min avant le suivant, « Ensuite : IC à ~07:42 », « Si tu le rates », puis « Nouveau trajet » sans « est parti »', () => s131sansrt(ctx)],
    ['s131demitour', '1.3.1 (Quai Web) : « Fais demi-tour » après 40 m dans le sens contraire du chemin', () => s131demitour(ctx)],
    ['s131sousterre', '1.3.1 (Quai Web) : « Position perdue » avant de partir avec « Quai suit l’horaire en attendant », rien à bord sous terre, « Pas de position : Quai suit l’horaire »', () => s131sousterre(ctx)],
    ['s131pluie', '1.3.1 (Quai Web) : « pluie prévue » sur « Partir maintenant » quand la première marche est sous la pluie', () => s131pluie(ctx)],
    ['s131tel', '1.3.1 (téléphone et onglet Réglages) : ordre de l’accueil, « Bureau », « ! », aide de « Me guider », « dans l’onglet Réglages », carte « En cours » (« Ensuite : partir à … », « à pied vers l’arrêt Gare du Nord »)', () => s131tel(ctx)],
  ];
}

/** Identifiants des scénarios 1.3.1 (commande de l'intégrateur : `npm run sim -- --only 's131*'`). */
export const S131_IDS = ['s131accueil', 's131trajet', 's131arrets', 's131soir', 's131apos', 's131calme', 's131memo', 's131rate', 's131sansrt', 's131demitour', 's131sousterre', 's131pluie', 's131tel'];
