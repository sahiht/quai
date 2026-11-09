/**
 * Quai, contrôle qualité : bout en bout dans le simulateur Even Hub avec le VRAI cœur, les vraies données
 * (pipeline sur les zips de fixtures) et le vrai relais (sur le faux portail BMC).
 *
 *   cd tests/e2e && npm run sim            (tout, environ 8 min)
 *   npm run sim -- --only s1,s2            (scénarios choisis : s1 s1fast s1noRT s2 s2live s3 s3fast firstrun stale errors exit polish phone)
 *
 * Captures : tests/e2e/screens/<scénario>-<étape>.png ; rapport : tests/e2e/out/sim-report.json.
 * Port d'automatisation : 9931 (option --port), pour ne pas gêner un autre simulateur sur 9898.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, buildFixtureData, ROOT, run, startDataServer, startStack, type Stack } from '../lib/stack';
import { litPixels, Sim, startStatic, type Screen } from '../lib/sim';

const E2E = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SHOTS = join(E2E, 'screens');
const OUT = join(E2E, 'out');
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = new Set((opt('only') ?? '').split(',').filter(Boolean));
const PORT = Number(opt('port') ?? 9931);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const S1 = { mockLat: '50.4655', mockLon: '4.859', mockNow: '2026-11-10T07:31:00+01:00' };
const S2 = { mockLat: '50.86', mockLon: '4.359', mockNow: '2026-11-10T12:10:00+01:00' };
const S3 = { mockLat: '50.8454', mockLon: '4.3571', mockNow: '2026-11-10T13:55:00+01:00' };

interface StepResult {
  scenario: string;
  step: string;
  ok: boolean;
  error?: string;
  screen?: Screen;
  shot?: string;
  ms: number;
}
const results: StepResult[] = [];
const notes: string[] = [];

class Check extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Check(msg);
}
const has = (s: Screen, re: RegExp) => s.lines.some((l) => re.test(l));
const show = (s: Screen) => `${s.screen} « ${s.title} » ${s.clock ?? ''}\n      ${s.lines.join('\n      ')}`;
/** Écran chargé : plus de « … » d'attente en bout de ligne (« Aller à… » est un libellé). */
const loaded = (s: Screen) => !s.lines.some((l) => (l.endsWith('…') && l !== 'Aller à…') || /^Chargement|^Recherche|^Calcul/.test(l));
const is = (screen: string, extra: (s: Screen) => boolean = () => true) => (s: Screen) => s.screen === screen && extra(s);

let stack: Stack;
let web: { url: string; close(): Promise<void> };
let sim: Sim;

function pageUrl(params: Record<string, string | undefined>, hash = '', bases = { data: stack.data.url, relay: stack.relay.url }): string {
  const u = new URL(`${web.url}/index.html`);
  u.searchParams.set('e2e', '1');
  u.searchParams.set('data', bases.data);
  u.searchParams.set('relay', bases.relay);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString() + hash;
}
const withPreset = (p: Record<string, string>) => ({ ...p, reset: '1', preset: `${web.url}/preset.json` });

let scenario = '';
async function step(name: string, fn: () => Promise<{ screen?: Screen; shot?: boolean } | void>): Promise<void> {
  const t0 = Date.now();
  const r: StepResult = { scenario, step: name, ok: true, ms: 0 };
  try {
    const out = (await fn()) ?? {};
    if (out.screen) r.screen = out.screen;
    if (out.screen && out.shot !== false) {
      const { file, lit } = await sim.shot(`${scenario}-${name}`);
      r.shot = file.slice(E2E.length + 1);
      check(lit > 0, `capture ${name} : écran noir`);
    }
    console.log(`  ✓ ${scenario}-${name}${r.screen ? `\n      ${show(r.screen)}` : ''}`);
  } catch (e) {
    r.ok = false;
    r.error = (e as Error).message;
    r.screen = sim?.last;
    console.log(`  ✗ ${scenario}-${name} : ${r.error}${r.screen ? `\n      dernier écran : ${show(r.screen)}` : ''}`);
    try {
      await sim.shot(`${scenario}-${name}-ECHEC`);
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
  try {
    await fn();
  } catch (e) {
    results.push({ scenario, step: 'scénario', ok: false, error: (e as Error).message, ms: 0 });
    console.log(`  ✗ ${id} interrompu : ${(e as Error).message}`);
  }
  const errs = sim.errors().filter((e) => !/favicon/i.test(e.message));
  if (errs.length) notes.push(`${id} : erreurs console : ${errs.map((e) => e.message.slice(0, 160)).join(' | ')}`);
  await sim.stop();
}

/* ------------------------------ Scénarios ------------------------------ */

async function s1(): Promise<void> {
  await sim.launch(pageUrl(withPreset(S1)));
  await step('home', async () => {
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil chargé');
    check(s.lines[0] === 'Pour le bureau : IC 07:42 +2, voie 6', `suggestion : « ${s.lines[0]} »`);
    check(s.lines[1] === 'partir à 07:35, 7 min à pied', `sous-titre : « ${s.lines[1]} »`);
    check(has(s, /^Autour de moi\s+3 arrêts$/), 'Autour de moi 3 arrêts');
    check(has(s, /^Mes favoris\s+5$/), 'Mes favoris 5');
    check(has(s, /^Aller à…$/), 'Aller à…');
    check(s.title === 'Quai' && s.clock === '07:31', `titre/heure ${s.title} ${s.clock}`);
    return { screen: s };
  });
  await step('steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', loaded), 15_000, 'étapes');
    check(/^Vers le bureau\s?: 07:35 ▶ 09:00$/.test(s.title), `titre « ${s.title} »`);
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte en tête : « ${s.lines[0]} »`);
    check(has(s, /^07:35\s+Partir à pied vers la gare\s+7 min$/), 'Partir à pied 07:35, 7 min');
    check(has(s, /IC vers Bruxelles-Midi, voie 6/) && has(s, /\+2 min/), 'IC vers Bruxelles-Midi, voie 6, +2 min');
    check(has(s, /^08:48\s+Descendre à Bruxelles-Central$/), 'Descendre à Bruxelles-Central 08:48');
    check(has(s, /^09:00\s+Arrivée au bureau, à pied\s+12 min$/), 'Arrivée au bureau 09:00, 12 min');
    return { screen: s };
  });
  await step('nearby', async () => {
    await sim.input('double_click');
    await sim.waitScreen(is('home', loaded), 10_000, 'retour accueil');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('nearby', loaded), 15_000, 'autour de moi');
    check(/^Namur Place Léopold, bus TEC\s+150 m\s+5 /.test(s.lines[0] ?? ''), `1re zone « ${s.lines[0]} »`);
    check(/^Namur, train\s+420 m\s+IC 07:42 \+2 v\.6 !$/.test(s.lines[1] ?? ''), `2e zone « ${s.lines[1]} » (voie modifiée coupée ?)`);
    check(/^Namur Gare, bus TEC\s+430 m\s+/.test(s.lines[2] ?? ''), `3e zone « ${s.lines[2]} »`);
    return { screen: s };
  });
  await step('places', async () => {
    await sim.input('double_click');
    await sim.waitScreen(is('home', loaded), 10_000, 'retour accueil');
    await sim.select(3);
    await sim.input('click');
    const s = await sim.waitScreen(is('places', (x) => loaded(x) && x.lines.some((l) => /^Bureau\s+\S/.test(l))), 20_000, 'Aller à… chargé');
    check(s.lines[0] === 'Maison   ici', `« ${s.lines[0]} » (déjà à la maison)`);
    check(/^Bureau\s+arrivée 09:00$/.test(s.lines[1] ?? ''), `« ${s.lines[1]} »`);
    return { screen: s };
  });
  await step('journeys', async () => {
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('journeys', loaded), 20_000, 'propositions');
    check(s.lines.length >= 2, 'au moins une proposition');
    check(/07:35|07:44/.test(s.lines[0]) && /09:00/.test(s.lines[0]), `1re proposition « ${s.lines[0]} »`);
    const props = s.lines.filter((l) => /^\d\d:\d\d/.test(l));
    check(new Set(props).size === props.length, `propositions en double : ${JSON.stringify(props)}`);
    return { screen: s };
  });
  await step('journey-steps', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('steps', loaded), 15_000, 'étapes de la 1re proposition');
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte « ${s.lines[0]} »`);
    return { screen: s };
  });
}

async function s1noRT(): Promise<void> {
  await stack.scene('noRT');
  try {
    await sim.launch(pageUrl(withPreset(S1)));
    await step('home', async () => {
      const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
      check(s.lines[0] === 'Pour le bureau : IC 07:42, voie 4', `suggestion « ${s.lines[0]} »`);
      check(s.lines[1] === 'partir à 07:33, 7 min à pied', `sous-titre « ${s.lines[1]} »`);
      return { screen: s };
    });
    await step('steps', async () => {
      await sim.input('click');
      const s = await sim.waitScreen(is('steps', loaded), 15_000, 'étapes');
      check(!has(s, /Voie modifiée/), 'pas d’alerte de voie sans temps réel');
      check(/^Vers le bureau\s?: 07:33 ▶ 08:58$/.test(s.title), `titre « ${s.title} »`);
      check(has(s, /^07:33\s+Partir à pied vers la gare\s+7 min$/), 'Partir à pied 07:33');
      check(has(s, /~|horaire prévu|Pas de réseau/), 'horaire prévu signalé (~)');
      return { screen: s };
    });
    await step('nearby', async () => {
      await sim.input('double_click');
      await sim.waitScreen(is('home', loaded), 10_000, 'accueil');
      await sim.select(1);
      await sim.input('click');
      const s = await sim.waitScreen(is('nearby', loaded), 15_000, 'autour de moi');
      check(/^Namur, train\s+420 m\s+IC ~07:42 v\.4$/.test(s.lines[1] ?? ''), `train en horaire prévu « ${s.lines[1]} »`);
      check(has(s, /horaire prévu|Pas de réseau/), 'note ~');
      return { screen: s };
    });
  } finally {
    await stack.scene('base');
  }
}

async function s1fast(): Promise<void> {
  await sim.launch(pageUrl({ ...withPreset(S1), mockSpeed: '30' }));
  await step('steps-0737', async () => {
    await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    await sim.input('click', 200);
    const s = await sim.waitScreen(is('steps', (x) => (x.clock ?? '') >= '07:37' && x.lines[0]?.startsWith('!')), 40_000, 'étapes à 07:37');
    check(s.lines[0] === '! Voie modifiée : l’IC part de la voie 6', `alerte « ${s.lines[0]} »`);
    check(has(s, /Partir à pied vers la gare\s+en cours/) || has(s, /Partir maintenant/), 'marche en cours');
    return { screen: s };
  });
  await step('train-0805', async () => {
    const s = await sim.waitScreen(is('train', (x) => (x.clock ?? '') >= '08:05'), 100_000, 'dans le train à 08:05');
    check(/^IC vers Bruxelles-Midi, \+2 min$/.test(s.title), `titre « ${s.title} »`);
    check(has(s, /^Gembloux\s+07:57\s+passé$/), 'Gembloux 07:57 passé');
    check(has(s, /^Ottignies\s+08:11\s+prochain$/), 'Ottignies 08:11 prochain');
    check(has(s, /^Bruxelles-Central\s+08:48\s+descente$/), 'Bruxelles-Central 08:48 descente');
    return { screen: s };
  });
}

async function s2(): Promise<void> {
  await sim.launch(pageUrl(withPreset(S2)));
  await step('board-gdn', async () => {
    const s = await sim.waitScreen(is('board', loaded), 15_000, 'favori proche ouvert seul');
    check(s.title === 'Gare du Nord, tram (STIB)', `titre « ${s.title} »`);
    const want = [/^T3\s+Churchill\s+[12] min$/, /^T4\s+Stalle\s+[45] min$/, /^T3\s+Esplanade\s+[56] min$/, /^T3\s+Churchill\s+(9|10) min$/, /^T4\s+Stalle\s+1[23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `départ ${i + 1} « ${s.lines[i]} » ≠ ${re}`));
    check(!has(s, /~/), 'tous en temps réel');
    return { screen: s };
  });
  await step('home', async () => {
    await sim.input('double_click');
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    check(s.lines[0] === 'Près de Bruxelles-Nord', `« ${s.lines[0]} »`);
    check(has(s, /^Autour de moi\s+4 arrêts$/), 'Autour de moi 4 arrêts');
    return { screen: s };
  });
  await step('nearby', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('nearby', loaded), 15_000, 'autour de moi');
    const want = [/^Gare du Nord, tram\s+80 m\s+T3 [12] min$/, /^Bruxelles-Nord, train\s+160 m\s+IC 12:22 v\.9$/, /^Bruxelles-Nord, bus De Lijn\s+200 m\s+232 ~[45] min$/, /^Rogier, métro\s+340 m\s+M2 [23] min$/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `zone ${i + 1} « ${s.lines[i]} » ≠ ${re}`));
    check(has(s, /^~ horaire prévu, sans temps réel$/), 'note ~');
    return { screen: s };
  });
  await step('board-delijn', async () => {
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /De Lijn/.test(x.title)), 15_000, 'tableau De Lijn');
    check(/^Bruxelles-Nord, bus \(De Lijn\)$/.test(s.title), `titre « ${s.title} »`);
    const want = [/^232\s+Vilvorde\s+~[45] min$/, /^460\s+Meise\s+(9|10) min/, /^270\s+Kortenberg\s+~1[12] min$/, /^232\s+Vilvorde\s+(19|20) min$/, /^232\s+Vilvorde\s+3[56] min/];
    want.forEach((re, i) => check(re.test(s.lines[i] ?? ''), `départ ${i + 1} « ${s.lines[i]} » ≠ ${re}`));
    check(has(s, /^~ horaire prévu, sans temps réel$/), 'note ~');
    return { screen: s };
  });
  await step('favorite-toggle', async () => {
    await sim.input('click', 300);
    const off = await sim.waitScreen((x) => x.lines.some((l) => /Retiré des favoris/.test(l)) || /Retiré des favoris/.test(x.title), 8_000, 'toast retiré');
    await sim.shot(`${scenario}-favorite-removed`);
    await sim.input('click', 300);
    await sim.waitScreen((x) => x.lines.some((l) => /Ajouté aux favoris/.test(l)) || /Ajouté aux favoris/.test(x.title), 8_000, 'toast ajouté');
    return { screen: off, shot: false };
  });
  await step('board-train', async () => {
    await sim.input('double_click');
    await sim.waitScreen(is('nearby'), 10_000, 'autour de moi');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'tableau train');
    check(/^IC\s.*12:22\s+voie 9/.test(s.lines[0] ?? ''), `1er départ « ${s.lines[0]} »`);
    check(/^IC\s.*~12:30\s+voie 12/.test(s.lines[1] ?? ''), `2e départ « ${s.lines[1]} »`);
    check(/^S1\s.*12:34\s+SUPPRIMÉ/.test(s.lines[2] ?? ''), `3e départ « ${s.lines[2]} »`);
    check(s.lines.filter((l) => /12:22/.test(l)).length === 1, 'IC 12:22 une seule fois');
    return { screen: s };
  });
  await step('favorites', async () => {
    await sim.input('double_click');
    await sim.waitScreen(is('nearby'), 10_000, 'autour de moi');
    await sim.input('double_click');
    await sim.waitScreen(is('home', loaded), 10_000, 'accueil');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 20_000, 'favoris chargés');
    check(s.lines.filter((l) => !/^▲▼|toucher/.test(l)).length >= 5, '5 favoris');
    return { screen: s };
  });
}

/** Rafraîchissement 30 s (passage en noRT pendant l'affichage), puis 2 minutes sans geste. */
async function s2live(): Promise<void> {
  await sim.launch(pageUrl(withPreset(S2)));
  try {
    await step('board-train-base', async () => {
      await sim.waitScreen(is('board', loaded), 15_000, 'favori ouvert');
      await sim.input('double_click');
      await sim.waitScreen(is('home', loaded), 10_000, 'accueil');
      await sim.select(0);
      await sim.input('click');
      await sim.waitScreen(is('nearby', loaded), 15_000, 'autour de moi');
      await sim.select(1);
      await sim.input('click');
      const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'tableau train');
      check(/^IC\s+12:22\s+voie 9/.test(s.lines[0] ?? '') || /^IC\s.*\s12:22\s+voie 9/.test(s.lines[0] ?? ''), `IC 12:22 temps réel « ${s.lines[0]} »`);
      check(has(s, /SUPPRIMÉ/), 'S1 supprimé (temps réel)');
      return { screen: s };
    });
    await step('refresh-to-noRT', async () => {
      const t0 = Date.now();
      await stack.scene('noRT');
      const s = await sim.waitScreen(is('board', (x) => /~12:22/.test(x.lines[0] ?? '') && !x.lines.some((l) => /SUPPRIMÉ/.test(l))), 45_000, '« ~ » après le rafraîchissement');
      const ms = Date.now() - t0;
      notes.push(`s2live : passage en noRT visible après ${(ms / 1000).toFixed(1)} s (rafraîchissement toutes les 30 s)`);
      check(ms <= 36_000, `rafraîchissement trop lent (${ms} ms) : un cycle de 30 s au plus attendu`);
      return { screen: s };
    });
    await step('refresh-back-to-base', async () => {
      await stack.scene('base');
      const s = await sim.waitScreen(is('board', (x) => /SUPPRIMÉ/.test(x.lines.join('|')) && !/~12:22/.test(x.lines[0] ?? '')), 50_000, 'retour du temps réel');
      return { screen: s };
    });
    await step('idle-2min', async () => {
      const before = sim.last!;
      const clocks = new Set<string>();
      const t0 = Date.now();
      while (Date.now() - t0 < 120_000) {
        await sleep(5_000);
        await sim.drain();
        for (const x of sim.screens) if (x.clock) clocks.add(x.clock);
      }
      await sim.input('down', 300);
      const moved = await sim.waitScreen((x) => x.screen === 'board' && x.sel !== before.sel, 5_000, 'réaction au geste après 2 min');
      await sim.input('double_click', 300);
      const back = await sim.waitScreen(is('nearby'), 5_000, 'retour après 2 min');
      notes.push(`s2live : horloge affichée pendant l'attente : ${[...clocks].sort().join(', ')}`);
      check(clocks.size >= 3, `l'heure n'avance pas pendant l'attente (${[...clocks].join(', ')})`);
      void moved;
      return { screen: back };
    });
  } finally {
    await stack.scene('base');
  }
}

async function s3(): Promise<void> {
  await sim.launch(pageUrl(withPreset(S3)));
  await step('home', async () => {
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    return { screen: s };
  });
  await step('trip', async () => {
    await sim.select(1);
    await sim.input('click');
    await sim.waitScreen(is('favorites', loaded), 20_000, 'favoris');
    await sim.select(2);
    await sim.input('click');
    const s = await sim.waitScreen(is('trip', loaded), 15_000, 'trains A ▶ B');
    check(s.title === 'Bruxelles-Central ▶ Gand-Saint-Pierre', `titre « ${s.title} »`);
    check(/^14:10\s+voie 4, arrivée 14:39\s+à l’heure$/.test(s.lines[0] ?? ''), `1er train « ${s.lines[0]} »`);
    check(/^14:22\s+voie 6, arrivée 14:56\s+\+3 min$/.test(s.lines[1] ?? ''), `2e train « ${s.lines[1]} »`);
    check(/^14:40\s+voie 4, arrivée 15:09\s+à l’heure$/.test(s.lines[2] ?? ''), `3e train « ${s.lines[2]} »`);
    return { screen: s };
  });
  await step('train-detail', async () => {
    await sim.input('click');
    const s = await sim.waitScreen(is('train', loaded), 15_000, 'détail du train');
    check(has(s, /Gand-Saint-Pierre/), 'Gand-Saint-Pierre dans le détail');
    return { screen: s };
  });
}

async function s3fast(): Promise<void> {
  await sim.launch(pageUrl({ ...withPreset(S3), mockNow: '2026-11-10T14:05:00+01:00', mockSpeed: '30' }));
  await step('arrival', async () => {
    await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    await sim.select(1);
    await sim.input('click', 250);
    await sim.waitScreen(is('favorites'), 15_000, 'favoris');
    await sim.select(2);
    await sim.input('click', 250);
    await sim.waitScreen(is('trip'), 15_000, 'trains');
    const s = await sim.waitScreen(is('arrival', (x) => loaded(x) && x.lines.some((l) => /^Tram 1/.test(l))), 100_000, 'aide à l’arrivée');
    check(s.title === 'Arrivée à Gand-Saint-Pierre', `titre « ${s.title} »`);
    check(has(s, /^Dans \d+ min\. Ensuite, devant la gare\s?:$/), 'Dans n min. Ensuite, devant la gare :');
    check(s.lines.filter((l) => /^Tram 1\s+Korenmarkt\s+\d+ min/.test(l)).length >= 2, 'deux trams 1 vers Korenmarkt');
    return { screen: s };
  });
}

async function firstRun(): Promise<void> {
  const frames: { t: number; lit: number }[] = [];
  let tPing = 0;
  await sim.launch(pageUrl({ ...S2, reset: '1' }), {
    waitReady: false,
    onPing: async () => {
      tPing = Date.now();
      while (Date.now() - tPing < 6_000) {
        try {
          frames.push({ t: Date.now() - tPing, lit: litPixels(await sim.rawShot()).lit });
        } catch {
          frames.push({ t: Date.now() - tPing, lit: -1 });
        }
        await sleep(100);
      }
    },
  });
  await step('no-black-screen', async () => {
    const firstLit = frames.findIndex((f) => f.lit > 0);
    check(firstLit >= 0, 'aucune image affichée pendant 6 s');
    const blankAfter = frames.slice(firstLit).filter((f) => f.lit <= 0);
    notes.push(`firstrun : 1re image après ${frames[firstLit].t} ms ; ${frames.length} captures ; ${blankAfter.length} capture(s) vide(s) ensuite`);
    check(blankAfter.length === 0, `écran noir après le premier affichage (${blankAfter.map((f) => `${f.t} ms`).join(', ')})`);
    const s = await sim.waitScreen(is('message', (x) => x.lines.some((l) => /^Bienvenue/.test(l))), 20_000, 'premier lancement');
    return { screen: s };
  });
  await step('continue', async () => {
    await sim.input('click');
    const s = await sim.waitScreen((x) => x.screen !== 'message' || !x.lines.some((l) => /^Bienvenue/.test(l)), 15_000, 'après « continuer »');
    return { screen: s };
  });
}

async function stale(): Promise<void> {
  const { dir } = await buildFixtureData({ date: '2026-11-01' });
  const old = await startDataServer(dir);
  try {
    await sim.launch(pageUrl(withPreset(S2), '', { data: old.url, relay: stack.relay.url }));
    await step('home', async () => {
      const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
      check(s.lines[0] === 'Horaires périmés : mise à jour arrêtée le 02/11', `« ${s.lines[0]} »`);
      return { screen: s };
    });
    await step('board', async () => {
      await sim.select(1);
      await sim.input('click');
      await sim.waitScreen(is('favorites', loaded), 15_000, 'favoris');
      await sim.select(1); // Gare du Nord (STIB)
      await sim.input('click');
      const s = await sim.waitScreen((x) => x.screen !== 'favorites' && loaded(x), 15_000, 'tableau périmé');
      check(/Gare du Nord/.test(s.title), `titre « ${s.title} »`);
      check(s.lines[0] === 'Horaires périmés : mise à jour arrêtée le 02/11', `message de fraîcheur attendu : « ${s.lines[0]} »`);
      check(!s.lines.some((l) => /\d+ min$/.test(l)), `aucun départ avec des horaires périmés : ${JSON.stringify(s.lines)}`);
      return { screen: s };
    });
  } finally {
    await old.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function errors(): Promise<void> {
  await sim.launch(pageUrl(withPreset(S2), '', { data: 'http://127.0.0.1:9', relay: stack.relay.url }));
  await step('data-down', async () => {
    const s = await sim.waitScreen((x) => x.screen === 'message' && loaded(x), 30_000, 'message d’erreur');
    check(s.lines.some((l) => /[a-zé]/.test(l)) && !s.lines.some((l) => /error|undefined|null|TypeError/i.test(l)), `message lisible : ${JSON.stringify(s.lines)}`);
    check(!s.lines.join(' ').includes('\u2014'), 'pas de tiret cadratin');
    return { screen: s };
  });
  await sim.launch(pageUrl(withPreset(S2), '', { data: stack.data.url, relay: 'http://127.0.0.1:9' }));
  await step('relay-down', async () => {
    const s = await sim.waitScreen(is('board', loaded), 30_000, 'tableau sans relais');
    check(s.lines.slice(0, 5).every((l) => /~\d+ min$/.test(l)), `tout en horaire prévu : ${JSON.stringify(s.lines)}`);
    check(has(s, /^~ horaire prévu, sans temps réel$|Pas de réseau/), 'note ~');
    return { screen: s };
  });
  await sim.launch(pageUrl({ ...withPreset(S2), mockLat: '50.1', mockLon: '5.2' }));
  await step('nearby-empty', async () => {
    await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Autour de moi'), 15_000, 'aucun arrêt');
    check(/^Aucun arrêt dans un rayon de 500 m$/.test(s.lines[0] ?? ''), `« ${s.lines[0]} »`);
    return { screen: s };
  });
}

/** 23:30 : départs du lendemain dits « demain » ; STIB sans « (P) » ; message de favori non reporté ; déjà à la maison. */
async function polish(): Promise<void> {
  await sim.launch(pageUrl(withPreset({ ...S2, mockNow: '2026-11-10T23:30:00+01:00' })));
  await step('board-gdn-late', async () => {
    const s = await sim.waitScreen(is('board', loaded), 15_000, 'favori proche ouvert');
    check(s.lines.slice(0, 3).every((l) => /^T[34]\s+demain, (Churchill|Esplanade|Stalle)\s+~\d\d:\d\d$/.test(l)), `départs du lendemain : ${JSON.stringify(s.lines)}`);
    check(!s.lines.some((l) => /\(P\)/.test(l)), 'Stalle sans (P)');
    return { screen: s };
  });
  await step('toast-not-carried', async () => {
    await sim.input('click', 300);
    await sim.waitScreen((x) => x.lines.some((l) => /Retiré des favoris/.test(l)), 6_000, 'favori retiré');
    await sim.input('double_click', 300);
    const s = await sim.waitScreen(is('home', loaded), 8_000, 'accueil');
    check(!s.lines.some((l) => /★/.test(l)), `message de favori reporté sur l’accueil : ${JSON.stringify(s.lines)}`);
    return { screen: s };
  });
  await step('nearby-late', async () => {
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('nearby', loaded), 15_000, 'autour de moi');
    check(/^Bruxelles-Nord, train\s+160 m\s+IC ~?demain 00:01$/.test(s.lines[1] ?? ''), `train du lendemain : « ${s.lines[1]} »`);
    return { screen: s };
  });
  await step('board-train-late', async () => {
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('board', (x) => loaded(x) && /train/.test(x.title)), 15_000, 'tableau train');
    check(/^IC\s+demain, Anvers-Central\s+~?00:01\s+voie 9$/.test(s.lines[0] ?? ''), `« ${s.lines[0]} »`);
    check(s.lines.slice(0, 5).filter((l) => /^(IC|S1)/.test(l)).every((l) => /demain, /.test(l)), 'tous les départs marqués « demain »');
    return { screen: s };
  });
  await step('favorites-late', async () => {
    await sim.input('double_click');
    await sim.waitScreen(is('nearby'), 8_000, 'autour de moi');
    await sim.input('double_click');
    await sim.waitScreen(is('home', loaded), 8_000, 'accueil');
    await sim.select(1);
    await sim.input('click');
    const s = await sim.waitScreen(is('favorites', loaded), 20_000, 'favoris');
    check(has(s, /^Namur \(SNCB\)\s+IC ~demain 08:42$/), `Namur demain : ${JSON.stringify(s.lines)}`);
    check(has(s, /^Bruxelles-Central ▶ Gand-Saint-Pierre\s+IC ~demain \d\d:\d\d$/), `trajet du lendemain : ${JSON.stringify(s.lines)}`);
    return { screen: s };
  });
  await sim.launch(pageUrl(withPreset(S1)));
  await step('already-home', async () => {
    await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    await sim.select(3);
    await sim.input('click');
    await sim.waitScreen(is('places', (x) => loaded(x) && x.lines[0] === 'Maison   ici'), 20_000, 'Aller à…');
    await sim.select(0);
    await sim.input('click');
    const s = await sim.waitScreen(is('message', (x) => x.title === 'Vers la maison'), 15_000, 'déjà à la maison');
    check(s.lines[0] === 'Tu es déjà à la maison.', `« ${s.lines[0]} »`);
    return { screen: s };
  });
  // écran Données du téléphone : un réseau repris du GTFS gardé d'une nuit précédente
  const copy = mkdtempSync(join(tmpdir(), 'quai-sim-cached-'));
  cpSync(stack.dataDir, copy, { recursive: true });
  const meta = JSON.parse(readFileSync(join(copy, 'meta.json'), 'utf8')) as { feeds: Record<string, Record<string, unknown>> };
  meta.feeds.delijn.cachedFrom = '2026-11-08';
  writeFileSync(join(copy, 'meta.json'), JSON.stringify(meta));
  const served = await startDataServer(copy);
  try {
    await step('phone-data-cached', async () => {
      await sim.launch(pageUrl(withPreset(S2), '#/donnees', { data: served.url, relay: stack.relay.url }));
      await sleep(2_500);
      const file = await sim.webviewShot(`${scenario}-phone-data-cached`);
      return { shot: false, screen: { screen: 'phone', title: 'donnees', lines: [file.slice(E2E.length + 1)] } };
    });
    await step('phone-favorite-edit', async () => {
      await sim.launch(pageUrl(withPreset(S2), '#/favoris/fav-gdn'));
      await sleep(2_500);
      const file = await sim.webviewShot(`${scenario}-phone-favorite-edit`);
      return { shot: false, screen: { screen: 'phone', title: 'favori', lines: [file.slice(E2E.length + 1)] } };
    });
  } finally {
    await served.stop();
    rmSync(copy, { recursive: true, force: true });
  }
}

async function exitPath(): Promise<void> {
  await sim.launch(pageUrl(withPreset(S3)));
  await step('home-double-tap', async () => {
    const s = await sim.waitScreen(is('home', loaded), 15_000, 'accueil');
    await sim.shot(`${scenario}-before`);
    const mark = sim.out.join('').length;
    await sim.input('double_click', 2_500);
    const after = sim.out.join('').slice(mark);
    check(/ShutDownPageContainer/.test(after), 'shutDownPageContainer non appelé après le double toucher');
    const lit = litPixels(await sim.rawShot()).lit;
    notes.push(`exit : ShutDownPageContainer reçu par le simulateur ; écran ensuite : ${lit} pixels allumés`);
    return { screen: s, shot: false };
  });
}

async function phone(): Promise<void> {
  const shots: [string, Record<string, string>, string][] = [
    ['onboarding', { ...S3, reset: '1' }, '#/'],
    ['home', withPreset(S3), '#/'],
    ['places', withPreset(S1), '#/lieux'],
    ['favorites', withPreset(S3), '#/favoris'],
    ['favorite-edit', withPreset(S2), '#/favoris/fav-gdn'],
    ['display', withPreset(S2), '#/affichage'],
    ['alerts', withPreset(S1), '#/alertes'],
    ['data', withPreset(S2), '#/donnees'],
    ['search', withPreset(S3), '#/recherche?q=Gand'],
    ['search-results', withPreset(S3), '#/recherche?de=sncb:8813003&vers=sncb:8892007'],
  ];
  for (const [name, params, hash] of shots) {
    await step(name, async () => {
      await sim.launch(pageUrl(params, hash));
      await sleep(name.startsWith('search') ? 3_500 : 2_500);
      const file = await sim.webviewShot(`${scenario}-${name}`);
      return { shot: false, screen: { screen: 'phone', title: name, lines: [file.slice(E2E.length + 1)] } };
    });
  }
}

/* ------------------------------ Lancement ------------------------------ */

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
  web = await startStatic(dist, { '/preset.json': join(ROOT, 'fixtures', 'app', 'preset.json') });
  sim = new Sim(PORT, SHOTS);
  console.log(`Données ${stack.data.url} ; relais ${stack.relay.url} ; appli ${web.url} ; simulateur :${PORT}`);
  const t0 = Date.now();
  try {
    await runScenario('s1', 'le matin, aller au bureau (scène base)', s1);
    await runScenario('s1noRT', 'le matin, portail injoignable (scène noRT)', s1noRT);
    await runScenario('s1fast', 'le matin en accéléré : voie modifiée puis dans le train', s1fast);
    await runScenario('s2', 'en ville, autour de moi', s2);
    await runScenario('s2live', 'rafraîchissement 30 s et 2 minutes sans geste', s2live);
    await runScenario('s3', 'recherche improvisée : trains A ▶ B', s3);
    await runScenario('s3fast', 'arrivée à Gand en accéléré', s3fast);
    await runScenario('firstrun', 'premier lancement, jamais d’écran noir', firstRun);
    await runScenario('stale', 'horaires périmés', stale);
    await runScenario('errors', 'données ou relais injoignables, aucun arrêt', errors);
    await runScenario('exit', 'double toucher sur l’accueil', exitPath);
    await runScenario('polish', 'lendemain, STIB sans (P), message de favori, déjà sur place, repli des données', polish);
    await runScenario('phone', 'pages du téléphone (captures)', phone);
  } finally {
    await sim.stop();
    await web.close();
    writeFileSync(join(OUT, 'sim-servers.log'), stack.logs());
    await stack.stop();
    rmSync(tmp, { recursive: true, force: true });
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
