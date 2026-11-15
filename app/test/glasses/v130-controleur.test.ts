/**
 * Quai 1.3.0, contrôleur des écrans (équipe C2, docs/v1.3.0/PRD-1.3.0.md) :
 *  - § 2 : ▲ sur la première rangée de « Autres trajets » revient au trajet proposé, sur sa dernière page ;
 *  - § 8 : les « … » des favoris (constat du 15/11 sur Quai Web reproduit : position choisie à la main égale au lieu d'un
 *    favori, trois favoris restés « … ») : une seule file, 3 calculs à la fois au plus, dans l'ordre de l'écran, « tu y
 *    es » tout de suite, jamais de « … » figé (calcul lent, erreur, réponse dépassée) ;
 *  - § 6.1 : test de l'écran des lunettes (attente, page envoyée, question, résultat, annulation, capteur refermé) ;
 *  - § 1 : le toucher de l'écran du trajet fait ce que dit sa ligne d'action, dans chaque cas.
 * Lieux publics seulement. En attendant la fusion avec les équipes A (`edgeUp` sur « Autres trajets ») et B (la
 * navigation rend `edge` vers le haut), ce fichier les ajoute par-dessus les vrais modules (sans effet une fois fusionnés).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/glasses/views', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/glasses/views')>();
  return { ...m, othersView: (...a: Parameters<typeof m.othersView>) => ({ ...m.othersView(...a), edgeUp: true }) };
});
vi.mock('../../src/glasses/nav', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/glasses/nav')>();
  return {
    ...m,
    handleGesture: (...a: Parameters<typeof m.handleGesture>) => {
      const out = m.handleGesture(...a);
      const edgeUp = a[1] === 'up' && (a[2] as { edgeUp?: boolean }).edgeUp && out.effect.kind === 'none';
      return edgeUp ? { state: out.state, effect: { kind: 'edge' as const, dir: 'up' as const } } : out;
    },
  };
});

import type { DisplayTestState, Favorite, FavoriteAnswer, Journey, LatLon, Settings } from '../../src/core/api';
import { TEST_ASK_MS, TEST_IMU_MS, TEST_SENT_MS, TEST_WAIT_MS, type ControllerDeps } from '../../src/glasses/controller';
import { HEADUP_REST_MIN, HeadUpLearner } from '../../src/glasses/headup';
import { current } from '../../src/glasses/nav';
import { MENU_IDS, type ContainerSpec, type StepsRoute } from '../../src/glasses/types';
import { MAISON, MIN, PLACES, at, journey, nb, settingsWith } from './helpers';
import { DAY, NOW, SPOTS, cleanupKit, door, guideSetup, type KitOptions } from './controller-guide-kit';

afterEach(cleanupKit);

/** Banc : celui du guidage, plus le capteur de mouvement, les réglages enregistrés et l'état du test de l'écran. */
async function kit(o: KitOptions & { imu?: boolean | null }) {
  const k = await guideSetup(o);
  const port = (k.c as unknown as { d: ControllerDeps }).d.platform.glasses;
  const imuCalls: [boolean, number | undefined][] = [];
  if (o.imu !== null) {
    port.imu = async (on, pace) => {
      imuCalls.push([on, pace]);
      return o.imu ?? true;
    };
  }
  // réglages tels que le contrôleur les enregistre (avant la normalisation de settings.ts, équipe F)
  const saved: Settings['display'][] = [];
  const set = k.settings.set.bind(k.settings);
  k.settings.set = (next: Settings) => {
    saved.push(structuredClone(next.display));
    return set(next);
  };
  const states: DisplayTestState[] = [];
  k.c.onDisplayTest((s) => states.push(s));
  return { ...k, imuCalls, saved, states };
}

const T = (hh: number, mm: number) => at(DAY, hh, mm);
const ready = (s: { screen: string; lines: string[] }) => s.screen === 'favorites' && !s.lines.some((l) => / …$/.test(nb(l)));
const lineOf = (lines: string[], name: string) => nb(lines.find((l) => nb(l).startsWith(`${name}   `)) ?? '');

/* ------------------------------ § 2 : ▲ pour revenir des autres trajets ------------------------------ */

/** Un trajet de 9 étapes (deux pages) et deux autres propositions, entre des arrêts publics. */
function longTrip(id: string, start: number): Journey {
  const m = (k: number) => start + k * MIN;
  return journey(
    id,
    [
      { walk: 5, to: 'Merbraine' },
      { ride: 'W', mode: 'bus', dep: m(5), arr: m(14), from: 'Merbraine', to: 'Braine-l’Alleud', head: 'Braine-l’Alleud' },
      { walk: 3, to: 'Braine-l’Alleud' },
      { ride: 'IC', mode: 'train', dep: m(20), arr: m(40), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '3' },
      { walk: 2, to: 'Gare Centrale' },
      { ride: '1', mode: 'metro', dep: m(45), arr: m(49), from: 'Gare Centrale', to: 'Schuman', head: 'Stockel' },
      { walk: 2, to: 'Schuman' },
      { ride: '81', mode: 'tram', dep: m(53), arr: m(60), from: 'Schuman', to: 'Flagey', head: 'Marius Renard' },
      { walk: 3 },
    ],
    { label: 'short', reason: 'Le plus court' },
  );
}

describe('§ 2 : ▲ sur la première rangée de « Autres trajets »', () => {
  it('revient au trajet proposé, là où il était : sa dernière page, « Fin du trajet »', async () => {
    const plan = (now: number) => [longTrip('j1', now + 5 * MIN), door('j2', now + 9 * MIN, now + 80 * MIN), door('j3', now + 20 * MIN, now + 95 * MIN)];
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { plan } });
    await k.until((s) => s.screen === 'home' && s.lines.some((l) => nb(l).startsWith('Bureau')));
    await k.gesture('tap');
    await k.until((s) => s.screen === 'steps' && s.page === 1);
    // ▼ jusqu'au bout des étapes, puis « Autres trajets »
    let end = k.last();
    for (let i = 0; i < 6 && k.last().screen === 'steps'; i++) {
      end = k.last();
      await k.gesture('down');
    }
    expect(k.last().screen).toBe('others');
    expect(end.lines.some((l) => nb(l).startsWith('Fin du trajet.'))).toBe(true);
    const below = k.c.state.nav.stack.at(-2)!;
    expect(below.top).toBeGreaterThan(0);
    // ▲ sur la première rangée : le trajet proposé, sur la même page qu'avant
    await k.gesture('up');
    const back = k.last();
    expect(back.screen).toBe('steps');
    expect(back.lines).toEqual(end.lines);
    expect(current(k.c.state.nav).top).toBe(below.top);
  });

  it('pas de trajet proposé dessous (écran repris) : ▲ ne fait rien', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    const journeys = [door('j1', NOW + 4 * MIN, NOW + 70 * MIN), door('j2', NOW + 9 * MIN, NOW + 80 * MIN), door('j3', NOW + 20 * MIN, NOW + 95 * MIN)];
    k.c.restore({ v: 2, nav: { stack: [{ route: { screen: 'home' }, sel: 0, top: 0 }, { route: { screen: 'others', title: 'Bureau', journeys, index: 0 }, sel: 0, top: 0, fresh: true }] } });
    await k.until((s) => s.screen === 'others');
    await k.gesture('up');
    expect(k.last().screen).toBe('others');
    expect(k.c.state.nav.stack).toHaveLength(2);
  });
});

/* ------------------------------ § 8 : les « … » des favoris ------------------------------ */

/**
 * Cœur lent qui calcule un favori à la fois (un calcul de trajet occupe le navigateur de Quai Web), `ms` chacun ; « tu y
 * es » sans calcul (le cœur le dit avant de calculer). Il compte les calculs en cours et leur plus grand nombre.
 */
function slowCore(ms: number) {
  let busy: Promise<unknown> = Promise.resolve();
  const inflight = new Set<string>();
  const o = { calls: [] as string[], inflight, max: 0 };
  const answer = (fav: Favorite, here: LatLon | null, now: () => number): Promise<FavoriteAnswer> => {
    const p = fav as Extract<Favorite, { kind: 'place' }>;
    if (here && Math.abs(here.lat - p.lat) < 0.002 && Math.abs(here.lon - p.lon) < 0.003) return Promise.resolve({ favoriteId: fav.id, kind: 'trip', state: 'here', plan: { journeys: [], empty: 'here' }, updatedAt: now() });
    o.calls.push(fav.id);
    inflight.add(fav.id);
    o.max = Math.max(o.max, inflight.size);
    const run = busy.then(
      () =>
        new Promise<FavoriteAnswer>((r) =>
          setTimeout(() => {
            inflight.delete(fav.id);
            r({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door(`j-${fav.id}`, now() + 6 * MIN, now() + 50 * MIN)] }, updatedAt: now() });
          }, ms),
        ),
    );
    busy = run;
    return run;
  };
  return { o, coreExtra: (now: () => number) => ({ answer: (f: Favorite, here: LatLon | null) => answer(f, here, now) }) };
}

describe('§ 8 : chaque favori reçoit sa réponse, « … » seulement pendant le calcul', () => {
  it('constat du 15/11 (Quai Web, position choisie sur le lieu « Maison », cœur lent) : plus aucun « … » figé', async () => {
    const core = slowCore(12_000);
    const k = await kit({ web: true, pos: SPOTS.central, settings: settingsWith([PLACES.maison, PLACES.bureau, PLACES.ecole, PLACES.parc], { seenVersion: '1.3.0' }), coreExtra: core.coreExtra });
    await k.until((s) => s.screen === 'home');
    await k.settle(60_000);
    // la position choisie à la main : le lieu du favori « Maison » ; puis « Favoris »
    k.location.set(MAISON);
    await k.c.relocate();
    await k.c.replaceRoute({ screen: 'favorites' });
    await k.settle(2_000);
    expect(lineOf(k.last().lines, 'Maison')).toBe('Maison   tu y es');
    // avant : « Bureau … », « École … », « Parc … » pour toujours (calculs abandonnés au bout de 20 s, demandes empilées)
    await k.settle(58_000);
    for (let t = 60; t <= 240; t += 5) {
      const s = k.last();
      expect(ready(s), `${t} s : ${s.lines.join(' | ')}`).toBe(true);
      expect(['Bureau', 'École', 'Parc'].map((n) => lineOf(s.lines, n))).toEqual(['Bureau', 'École', 'Parc'].map((n) => expect.stringMatching(new RegExp(`^${n}   dans \\d+ min → \\d\\d:\\d\\d$`))));
      expect(lineOf(s.lines, 'Maison')).toBe('Maison   tu y es');
      await k.settle(5_000);
    }
    // jamais plus de 3 calculs à la fois, et jamais un calcul pour « tu y es »
    expect(core.o.max).toBeLessThanOrEqual(3);
  });

  it('à l’ouverture de « Favoris » : dans l’ordre de l’écran, 3 calculs à la fois au plus', async () => {
    // A et B au plus tôt, C et E le matin (créneau) : à 07:31, l'écran les range C, E, A, B, D, F
    const p = (id: string, label: string, lat: number, lon: number, propose: 'never' | 'morning' = 'never') => ({ kind: 'place', id, label, lat, lon, propose }) as Favorite;
    const favs = [p('A', 'Flagey', 50.8275, 4.3722), p('B', 'Merode', 50.8384, 4.3998), p('C', 'Schuman', 50.8429, 4.3807, 'morning'), p('D', 'Louise', 50.8366, 4.3542), p('E', 'Bourse', 50.8483, 4.3497, 'morning'), p('F', 'Rogier', 50.8556, 4.3586)];
    const calls: string[] = [];
    let running = 0;
    let max = 0;
    const gates: (() => void)[] = [];
    const k = await kit({
      settings: settingsWith(favs, { seenVersion: '1.3.0', display: { ...settingsWith([]).display, opening: 'home' } }),
      coreExtra: (now) => ({
        answer: (fav: Favorite) => {
          calls.push(fav.id);
          max = Math.max(max, ++running);
          return new Promise<FavoriteAnswer>((r) =>
            gates.push(() => {
              running--;
              r({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door(`j-${fav.id}`, now() + 6 * MIN, now() + 50 * MIN)] }, updatedAt: now() });
            }),
          );
        },
      }),
    });
    await k.until((s) => s.screen === 'home');
    // accueil sans favoris : les réponses se préparent sans presser, dans l'ordre du téléphone (A, B, C d'abord)
    expect(calls).toEqual(['A', 'B', 'C']);
    await k.c.replaceRoute({ screen: 'favorites' });
    await k.settle(50);
    expect(k.last().order).toEqual(['C', 'E', 'A', 'B', 'D', 'F']);
    // chaque réponse arrive : la suivante part, dans l'ordre de l'écran (E, D, F), jamais plus de 3 à la fois
    for (let i = 0; i < 6; i++) {
      gates.shift()?.();
      await k.settle(50);
    }
    expect(calls).toEqual(['A', 'B', 'C', 'E', 'D', 'F']);
    expect(max).toBe(3);
    expect(ready(k.last())).toBe(true);
  });

  it('erreur du calcul, même sans promesse : nouvel essai quelques secondes après, jamais un « … » oublié', async () => {
    let n = 0;
    const k = await kit({
      settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }),
      coreExtra: (now) => ({
        answer: (fav: Favorite): Promise<FavoriteAnswer> => {
          n++;
          // le premier calcul lève tout de suite (sans promesse), le deuxième rejette
          if (n === 1) throw new Error('données illisibles');
          if (n === 2) return Promise.reject(new Error('pas de réseau'));
          return Promise.resolve({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-b', now() + 6 * MIN, now() + 50 * MIN)] }, updatedAt: now() });
        },
      }),
    });
    await k.until((s) => s.screen === 'home');
    await k.c.replaceRoute({ screen: 'favorites' });
    await k.settle(100);
    expect(lineOf(k.last().lines, 'Bureau')).toBe('Bureau   …');
    // 5 s puis 15 s : la réponse, bien avant le rafraîchissement de 30 s
    await k.settle(5_100);
    expect(n).toBe(2);
    await k.settle(15_100);
    expect(n).toBe(3);
    expect(lineOf(k.last().lines, 'Bureau')).toMatch(/^Bureau   dans \d+ min → /);
  });

  it('une réponse qui devient « … » (premier véhicule parti) est recalculée aussitôt, pas au rafraîchissement suivant', async () => {
    // partir à 07:32:35 (5 min de marche, bus W à 07:37:35) : attrapable jusqu'à 07:33:05 (30 s de grâce)
    const leave = NOW + 95_000;
    let n = 0;
    const k = await kit({
      settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }),
      coreExtra: (now) => ({
        answer: async (fav: Favorite): Promise<FavoriteAnswer> => {
          n++;
          // le cœur propose ce bus tant qu'on peut l'attraper, puis le suivant
          const j = now() <= leave + 30_000 ? door('j-1', leave, leave + 45 * MIN) : door('j-2', now() + 10 * MIN, now() + 60 * MIN);
          return { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now() };
        },
      }),
    });
    await k.until((s) => s.screen === 'home');
    await k.c.replaceRoute({ screen: 'favorites' });
    // 07:33:04 : réponse recalculée à 07:33:00 (rafraîchissement de 30 s), encore le premier bus
    await k.settle(124_000);
    expect(lineOf(k.last().lines, 'Bureau')).toMatch(/^Bureau   .*→ /);
    const before = n;
    // 07:33:05 : il devient « … » ; recalcul tout de suite, pas au rafraîchissement de 07:33:30
    await k.settle(3_000);
    expect(n).toBeGreaterThan(before);
    expect(lineOf(k.last().lines, 'Bureau')).toMatch(/^Bureau   dans 10 min → /);
  });
});

/* ------------------------------ § 6.1 : test de l'écran des lunettes ------------------------------ */

/** Mesure du capteur (repos : la tête droite, un peu de bruit ; `dy` : la tête levée). */
const imu = (i: number, dy = 0) => ({ kind: 'imu' as const, x: 0.1 + (i % 2) * 0.02, y: 9.7 + ((i * 7) % 5) * 0.01 + dy, z: 0.3 - (i % 3) * 0.01, at: NOW + i * TEST_IMU_MS });
const pageText = (cs: ContainerSpec[]) => cs.map((c) => nb(c.content)).join('\n');

describe('§ 6.1 : test de l’écran des lunettes', () => {
  it('visible : attente sans rien envoyer (pas même l’heure), page entière, un toucher, résultat enregistré, écran d’avant', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    // 07:31:30 : la minute change pendant l'attente
    await k.settle(30_000);
    const home = k.last();
    const s0 = await k.c.displayTest({ kind: 'start' });
    expect(s0).toEqual({ step: 'wait', left: 45 });
    await k.settle(10);
    expect(k.last().screen).toBe('displayTest');
    expect(k.lastBuild()?.op).toBe('rebuild');
    expect(k.imuCalls).toEqual([[true, TEST_IMU_MS]]);
    const from = k.calls.length;
    await k.settle(TEST_WAIT_MS - 200);
    // compte à rebours chaque seconde pour le téléphone ; rien n'est parti vers les lunettes
    const lefts = k.states.filter((s) => s.step === 'wait').map((s) => s.left);
    expect(lefts.slice(0, 3)).toEqual([45, 44, 43]);
    expect(lefts.at(-1)).toBe(1);
    expect(k.since(from)).toEqual([]);
    // un toucher pendant l'attente ne compte pas
    await k.gesture('tap');
    expect(k.states.at(-1)?.step).toBe('wait');
    // 45 s : nouvelle page entière (« Touche une fois les lunettes »), 15 s pour la toucher
    await k.settle(300);
    expect(k.states.at(-1)).toEqual({ step: 'sent', left: TEST_SENT_MS / 1000 });
    expect(k.since(from).map((c) => c.op)).toEqual(['rebuild']);
    expect(pageText(k.sent())).toContain('Touche une fois les lunettes');
    await k.gesture('tap');
    expect(k.states.at(-1)).toEqual({ step: 'done', result: 'visible', learned: false });
    expect(k.saved.at(-1)?.alert).toBe('visible');
    expect(k.imuCalls.at(-1)).toEqual([false, undefined]);
    // l'écran d'avant, page entière
    await k.settle(50);
    expect(k.last().screen).toBe('home');
    expect(k.last().lines).toEqual(home.lines);
    expect(k.lastBuild()?.op).toBe('rebuild');
  });

  it('question, « Le test de Quai » : headUp, et le mouvement « lever la tête » appris (axe, sens, écart)', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    await k.c.displayTest({ kind: 'start' });
    await k.settle(10);
    for (let i = 0; i < 40; i++) k.c.onSignal(imu(i));
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS);
    expect(k.states.at(-1)).toEqual({ step: 'ask' });
    expect(pageText(k.sent())).toContain('Réponds sur le téléphone');
    // la tête levée : y monte de 2,5 et reste ; x bouge un peu ; aucune mesure ne fait de rendu ni de journal
    const calls = k.calls.length;
    const logs = k.logs.length;
    for (let i = 0; i < 20; i++) k.c.onSignal({ ...imu(i, i < 5 ? 0 : 2.5), x: 0.3 });
    expect(k.calls.length).toBe(calls);
    expect(k.logs.length).toBe(logs);
    const done = await k.c.displayTest({ kind: 'answer', answer: 'quai' });
    expect(done).toEqual({ step: 'done', result: 'headUp', learned: true });
    const d = k.saved.at(-1)!;
    expect(d.alert).toBe('headUp');
    expect(d.headUp).toMatchObject({ axis: 'y', sign: 1 });
    expect(d.headUp!.delta).toBeGreaterThan(2.4);
    expect(d.headUp!.delta).toBeLessThan(2.6);
    expect(k.imuCalls.at(-1)?.[0]).toBe(false);
  });

  it('« Le Dashboard » sans mouvement net : dashboard, headUp laissé tel quel ; « Rien » : aucun résultat', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    const headUp0 = k.settings.get().display.headUp;
    await k.c.displayTest({ kind: 'start' });
    await k.settle(10);
    for (let i = 0; i < 40; i++) k.c.onSignal(imu(i));
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS);
    // un écart à peine plus grand que le bruit : pas appris
    for (let i = 0; i < 20; i++) k.c.onSignal(imu(i, 0.02));
    expect(await k.c.displayTest({ kind: 'answer', answer: 'dashboard' })).toEqual({ step: 'done', result: 'dashboard', learned: false });
    expect(k.saved.at(-1)?.alert).toBe('dashboard');
    expect(k.saved.at(-1)?.headUp).toEqual(headUp0);
    // « Rien » : rien d'enregistré
    const saved = k.saved.length;
    await k.c.displayTest({ kind: 'start' });
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS + 10);
    expect(await k.c.displayTest({ kind: 'answer', answer: 'nothing' })).toEqual({ step: 'done', learned: false });
    expect(k.saved.length).toBe(saved);
    expect(k.imuCalls.filter(([on]) => on).length).toBe(k.imuCalls.filter(([on]) => !on).length);
  });

  it('arrêter à tout moment ; question sans réponse : fin au bout de 2 min ; capteur toujours refermé', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    const home = k.last();
    await k.c.displayTest({ kind: 'start' });
    await k.settle(5_000);
    expect(await k.c.displayTest({ kind: 'cancel' })).toEqual({ step: 'idle' });
    expect(k.imuCalls).toEqual([[true, TEST_IMU_MS], [false, undefined]]);
    await k.settle(50);
    expect(k.last().lines).toEqual(home.lines);
    // plus rien ne tourne : pas d'étape suivante
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS);
    expect(k.states.at(-1)).toEqual({ step: 'idle' });
    // question restée sans réponse
    await k.c.displayTest({ kind: 'start' });
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS + 10);
    expect(k.states.at(-1)?.step).toBe('ask');
    await k.settle(TEST_ASK_MS);
    expect(k.states.at(-1)).toEqual({ step: 'idle' });
    expect(k.imuCalls.at(-1)).toEqual([false, undefined]);
  });

  it('Quai fermé sur les lunettes, arrière-plan ou lunettes déconnectées : « closed », capteur refermé ; Quai Web : pas de test', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    // arrière-plan pendant l'attente : arrêté
    await k.c.displayTest({ kind: 'start' });
    await k.settle(1_000);
    await k.emit({ kind: 'background' });
    expect(k.states.at(-1)).toEqual({ step: 'idle', error: 'closed' });
    expect(k.imuCalls.at(-1)).toEqual([false, undefined]);
    // Quai pas au premier plan : le test ne démarre pas
    expect(await k.c.displayTest({ kind: 'start' })).toEqual({ step: 'idle', error: 'closed' });
    await k.emit({ kind: 'foreground' });
    // lunettes déconnectées pendant la page envoyée : arrêté ; tant qu'elles le sont : ne démarre pas
    await k.c.displayTest({ kind: 'start' });
    await k.settle(TEST_WAIT_MS + 1_000);
    expect(k.states.at(-1)?.step).toBe('sent');
    await k.emit({ kind: 'device', connected: false });
    expect(k.states.at(-1)).toEqual({ step: 'idle', error: 'closed' });
    expect(await k.c.displayTest({ kind: 'start' })).toEqual({ step: 'idle', error: 'closed' });
    expect(k.imuCalls.filter(([on]) => on).length).toBe(k.imuCalls.filter(([on]) => !on).length);
    // Quai Web
    const w = await kit({ web: true, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await w.until((s) => s.screen === 'home');
    expect(await w.c.displayTest({ kind: 'start' })).toEqual({ step: 'idle' });
    await w.settle(1_000);
    expect(w.imuCalls).toEqual([]);
    expect(w.last().screen).toBe('home');
  });

  it('hôte sans capteur ou qui le refuse : le test se fait, sans apprendre le mouvement', async () => {
    const k = await kit({ imu: false, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await k.until((s) => s.screen === 'home');
    await k.c.displayTest({ kind: 'start' });
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS + 10);
    expect(await k.c.displayTest({ kind: 'answer', answer: 'quai' })).toEqual({ step: 'done', result: 'headUp', learned: false });
    expect(k.saved.at(-1)?.alert).toBe('headUp');
    const n = await kit({ imu: null, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) });
    await n.until((s) => s.screen === 'home');
    await n.c.displayTest({ kind: 'start' });
    await n.settle(TEST_WAIT_MS + 10);
    await n.gesture('double');
    expect(n.states.at(-1)).toEqual({ step: 'done', result: 'visible', learned: false });
  });
});

describe('§ 6.1 : headup.ts, le mouvement « lever la tête »', () => {
  const rest = (l: HeadUpLearner, n = 30) => {
    for (let i = 0; i < n; i++) l.rest({ x: 0.1 + (i % 2) * 0.02, y: 9.7 + ((i * 7) % 5) * 0.01, z: 0.3 - (i % 3) * 0.01 });
  };
  it('l’axe qui change le plus, son sens et son écart, tenu sur 3 mesures', () => {
    const l = new HeadUpLearner();
    rest(l);
    for (let i = 0; i < 6; i++) l.move({ x: 0.11, y: 9.72, z: 0.3 - 1.2 });
    expect(l.result()).toMatchObject({ axis: 'z', sign: -1 });
    expect(l.result()!.delta).toBeCloseTo(1.2, 1);
  });
  it('un pic isolé, un écart sous trois fois le bruit, un repos trop court : rien d’appris', () => {
    const spike = new HeadUpLearner();
    rest(spike);
    spike.move({ x: 0.1, y: 14, z: 0.3 });
    spike.move({ x: 0.1, y: 9.72, z: 0.3 });
    spike.move({ x: 0.1, y: 14, z: 0.3 });
    expect(spike.result()).toBeNull();
    const small = new HeadUpLearner();
    rest(small);
    const noise = small.noise('y');
    for (let i = 0; i < 5; i++) small.move({ x: 0.11, y: 9.72 + 2.5 * noise, z: 0.29 });
    expect(small.result()).toBeNull();
    const short = new HeadUpLearner();
    rest(short, HEADUP_REST_MIN - 1);
    for (let i = 0; i < 5; i++) short.move({ x: 0.1, y: 12, z: 0.3 });
    expect(short.result()).toBeNull();
  });
});

/* ------------------------------ § 1 : la ligne d'action dit vrai ------------------------------ */

describe('§ 1 : le toucher de l’écran du trajet fait ce que dit sa ligne d’action', () => {
  const plan = (now: number) => [door('j1', now + 4 * MIN, now + 70 * MIN), door('j2', now + 9 * MIN, now + 80 * MIN)];
  const open = async (k: Awaited<ReturnType<typeof kit>>) => {
    await k.until((s) => s.screen === 'home' && s.lines.some((l) => nb(l).startsWith('Bureau')));
    await k.gesture('tap');
    return k.until((s) => s.screen === 'steps' && s.page === 1);
  };

  it('« ▶ Y aller » (pas encore guidé) : le guidage ; « ▶ Retour au guidage » (guidé) : l’écran du guidage', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { plan } });
    await open(k);
    await k.gesture('tap');
    expect(k.last().screen).toBe('guide');
    expect(k.c.followed?.guide?.kind).toBe('trip');
    // « Voir tout le trajet » : l'écran du trajet guidé ; toucher : retour au guidage
    k.c.onSignal({ kind: 'menu', id: MENU_IDS.allSteps });
    await k.until((s) => s.screen === 'steps');
    await k.gesture('tap');
    expect(k.last().screen).toBe('guide');
  });

  it('trajet suivi pas encore guidé (bouton « Lunettes »), réglage allumé : le toucher le guide', async () => {
    const k = await kit({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { plan } });
    await open(k);
    const r = current(k.c.state.nav).route as StepsRoute;
    await k.c.showTrip({ title: r.title!, from: r.from!, to: r.to!, favoriteId: 'fav-bureau', result: { journeys: r.journeys! }, index: 0 });
    await k.until((s) => s.screen === 'steps' && s.followed === true);
    expect(k.c.followed?.guide).toBeUndefined();
    // avant : son écran du trajet rouvert par-dessus lui-même, jamais de guidage
    await k.gesture('tap');
    expect(k.last().screen).toBe('guide');
    expect(k.c.followed?.guide?.kind).toBe('trip');
    expect(k.c.followed?.journey.id).toBe('j1');
  });

  it('réglage éteint : « ▶ Suivre ce trajet » le fait suivre, puis « ▶ Trajet suivi » ouvre son écran', async () => {
    const off = settingsWith([PLACES.bureau], { seenVersion: '1.3.0' });
    off.display.guide = false;
    const k = await kit({ settings: off, stub: { plan } });
    await open(k);
    await k.gesture('tap');
    expect(k.c.followed?.journey.id).toBe('j1');
    expect(k.last().screen).toBe('steps');
    expect(nb(k.last().lines.join('\n'))).toContain('Trajet suivi');
    await k.gesture('tap');
    expect(k.last().screen).toBe('followed');
  });
});

void T;
