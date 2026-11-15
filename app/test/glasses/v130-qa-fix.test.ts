/**
 * Quai 1.3.0, corrections du contrôle technique (contrôleur des lunettes) :
 *  - point 1 : le journal des trajets arrive après le démarrage (attachJournal) ; un guidage lancé avant n'y est pas noté,
 *    un guidage repris y continue ;
 *  - point 4 : l'état des rappels (rappels faits, vu, touché, rappels épuisés) est gardé avec le guidage (quai.trip) et
 *    repris à la réouverture de Quai : un message n'est jamais rappelé de nouveau ;
 *  - point 5 : « vu » mesuré par rapport à la position de repos apprise (Settings.display.headUp.rest), un mouvement
 *    sans elle n'est pas utilisé ; plancher du bruit du repos dans l'apprentissage (headup.ts).
 * Logique pure de glasses/reminder.ts (minuteries à la main), puis le contrôleur avec le banc du guidage
 * (controller-guide-kit.ts) et les doubles du moteur et des écrans. Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/glasses/guide-views')>();
  return { ...(await import('./controller-guide-doubles')).viewsModule, checkLines: real.checkLines };
});

import type { Favorite, FavoriteAnswer, Journey, Settings } from '../../src/core/api';
import type { GuideMemory, GuideState } from '../../src/core/guide-types';
import type { JournalEvent, TripJournal } from '../../src/core/journal-types';
import { TRIP_KEY, parseTrip, type ControllerDeps } from '../../src/glasses/controller';
import { HEADUP_NOISE_FLOOR, HEADUP_REST_MIN, HeadUpLearner } from '../../src/glasses/headup';
import { HeadUpWatch, MomentReminder, REMIND, REMIND_MEMO_MAX, readRemindMemo, remindPlan, type HeadUpRest, type ImuSample, type RemindMemo } from '../../src/glasses/reminder';
import { validateSettings } from '../../src/settings';
import { engine, moment, views } from './controller-guide-doubles';
import { NOW, cleanupKit, door, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, settingsWith } from './helpers';

const SEC = 1_000;
/** Mouvement appris : l'axe y descend de 0,5 quand la tête se lève ; repos (la tête droite) à 0. */
const HEAD: HeadUpRest = { axis: 'y', sign: -1, delta: 0.5, rest: 0 };

/* ------------------------------ Logique pure (reminder.ts) ------------------------------ */

function manualTimers() {
  let t = 0;
  const q: { at: number; fn: () => void; dead: boolean }[] = [];
  return {
    later(fn: () => void, ms: number): () => void {
      const e = { at: t + ms, fn, dead: false };
      q.push(e);
      return () => {
        e.dead = true;
      };
    },
    advance(ms: number): void {
      const end = t + ms;
      for (;;) {
        const due = q.filter((e) => !e.dead && e.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at;
        due.dead = true;
        due.fn();
      }
      t = end;
    },
  };
}

function reminderKit(display: Partial<Settings['display']> = {}) {
  const timers = manualTimers();
  const sent: [string, number][] = [];
  const kept: RemindMemo[][] = [];
  const imu: boolean[] = [];
  const r = new MomentReminder({
    later: (fn, ms) => timers.later(fn, ms),
    display: () => display as Settings['display'],
    imu: async (on) => {
      imu.push(on);
      return true;
    },
    resend: (m, n) => {
      sent.push([m.id, n]);
      return true;
    },
    keep: (memo) => kept.push(memo),
  });
  return { r, timers, sent, kept, imu };
}

const BOARD = { kind: 'board', id: 'board:j1:1' } as const;
const ALIGHT = { kind: 'alight', id: 'alight:j1:1' } as const;

describe('point 4 : reminder.ts, l’état des rappels gardé et repris', () => {
  it('donné à chaque changement : rappel fait (n), attente finie (vu, touché, rappels épuisés, remplacé) ; jamais à l’arrêt', () => {
    const k = reminderKit();
    k.r.shown(BOARD);
    expect(k.kept).toEqual([]);
    k.timers.advance(REMIND.everyMs);
    expect(k.kept.at(-1)).toEqual([{ id: BOARD.id, n: 1 }]);
    k.timers.advance(REMIND.everyMs);
    expect(k.kept.at(-1)).toEqual([{ id: BOARD.id, n: 2 }]);
    // rappels épuisés (45 s après le dernier) : fini
    k.timers.advance(REMIND.everyMs);
    expect(k.kept.at(-1)).toEqual([{ id: BOARD.id, n: 2, done: true }]);
    // touché
    k.r.shown(ALIGHT);
    k.r.touch();
    expect(k.kept.at(-1)).toEqual([
      { id: BOARD.id, n: 2, done: true },
      { id: ALIGHT.id, n: 0, done: true },
    ]);
    // arrêt du contrôleur (page fermée), guidage qui continue : rien n'est donné, rien n'est marqué fini
    const k2 = reminderKit();
    k2.r.shown(BOARD);
    k2.timers.advance(REMIND.everyMs);
    const n = k2.kept.length;
    k2.r.end();
    expect(k2.kept).toHaveLength(n);
    expect(k2.kept.at(-1)).toEqual([{ id: BOARD.id, n: 1 }]);
    // headUp ou dashboard : pas de rappel pour ce message, c'est gardé aussi
    const k3 = reminderKit({ alert: 'dashboard' });
    k3.r.shown(BOARD);
    expect(k3.kept.at(-1)).toEqual([{ id: BOARD.id, n: 0, done: true }]);
  });

  it('repris : un moment fini ne recommence pas ; un moment rappelé une fois n’a plus qu’un rappel ; deux fois, plus aucun', () => {
    const done = reminderKit();
    done.r.resume([{ id: BOARD.id, n: 1, done: true }]);
    done.r.shown(BOARD);
    done.timers.advance(5 * MIN);
    expect(done.sent).toEqual([]);
    expect(done.r.waiting).toBeNull();

    const once = reminderKit();
    once.r.resume([{ id: BOARD.id, n: 1 }]);
    once.r.shown(BOARD);
    expect(once.r.waiting).toMatchObject({ id: BOARD.id, n: 1 });
    once.timers.advance(5 * MIN);
    expect(once.sent).toEqual([[BOARD.id, 2]]);

    const twice = reminderKit();
    twice.r.resume([{ id: BOARD.id, n: 2 }]);
    twice.r.shown(BOARD);
    twice.timers.advance(5 * MIN);
    expect(twice.sent).toEqual([]);
    expect(twice.kept.at(-1)).toEqual([{ id: BOARD.id, n: 2, done: true }]);

    // reprise pendant une attente du même moment : le plus avancé l'emporte
    const live = reminderKit();
    live.r.shown(BOARD);
    live.r.resume([{ id: BOARD.id, n: 0, done: true }]);
    expect(live.r.waiting).toBeNull();
    live.timers.advance(5 * MIN);
    expect(live.sent).toEqual([]);
  });

  it('les 12 moments les plus récents ; lecture défensive de ce qui est gardé', () => {
    const k = reminderKit({ alert: 'headUp' });
    for (let i = 1; i <= 15; i++) k.r.shown({ kind: 'board', id: `board:j1:${i}` });
    const memo = k.r.memory();
    expect(REMIND_MEMO_MAX).toBe(12);
    expect(memo.map((m) => m.id)).toEqual(Array.from({ length: 12 }, (_, i) => `board:j1:${i + 4}`));
    expect(readRemindMemo('x')).toEqual([]);
    expect(readRemindMemo([null, 3, { id: '' }, { id: 'a', n: 9 }, { id: 'a', n: 1 }, { id: 'b', n: -2, done: 'oui' }, { id: 'c', n: 1.6, done: true }, { id: 'x'.repeat(81) }])).toEqual([
      { id: 'a', n: 2 },
      { id: 'b', n: 0 },
      { id: 'c', n: 2, done: true },
    ]);
  });
});

/* ------------------------------ Contrôleur ------------------------------ */

const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)] }, updatedAt: now } : undefined;
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
const depsOf = (h: Kit): ControllerDeps => (h.c as unknown as { d: ControllerDeps }).d;

/** Ce que le moteur double rend, modifiable pendant le test. */
let out: Partial<GuideState> | ((input: { now: number; journey: Journey }, mem: GuideMemory) => Partial<GuideState> & { mem?: GuideMemory }) = {};

/** Réglages d'affichage du test de l'écran (alert, headUp), gardés tels quels. */
function withDisplay(h: Kit, extra: Partial<Settings['display']>): void {
  const base = h.settings.get.bind(h.settings);
  let memo: { b: Settings; out: Settings } | null = null;
  h.settings.get = () => {
    const b = base();
    if (memo?.b !== b) memo = { b, out: { ...b, display: { ...b.display, ...extra } } };
    return memo.out;
  };
}

/** Journal en mémoire : ce que le contrôleur écrit, tel quel. */
function memoryJournal() {
  const trips: { id: string; title: string; kind: 'trip' | 'ride'; at: number; events: JournalEvent[]; end?: string }[] = [];
  const journal: TripJournal = {
    begin(meta) {
      const id = `t${trips.length + 1}`;
      trips.push({ id, ...meta, events: [] });
      return id;
    },
    add(id, e) {
      trips.find((t) => t.id === id)?.events.push(structuredClone(e));
    },
    end(id, end) {
      const t = trips.find((x) => x.id === id);
      if (t) t.end = end;
    },
    list: () => [],
    text: () => '',
    clear: () => undefined,
  };
  const of = (k: string, i = 0) => trips[i]?.events.filter((e) => e.k === k) ?? [];
  return { journal, trips, of };
}

interface GuidedOpts {
  display?: Partial<Settings['display']>;
  imu?: boolean;
  journal?: ReturnType<typeof memoryJournal>;
  kit?: Partial<KitOptions>;
}

/** Guidage lancé par le bouton « Y aller » (Bureau), « Où tu en es » laissé s'effacer. */
async function guided(o: GuidedOpts = {}) {
  const h = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers }, ...o.kit });
  const imu = plug(h, o);
  await h.until(homeReady);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  await h.settle(15_500);
  return { h, imu };
}

/** Réglages d'affichage, capteur et journal d'un banc. */
function plug(h: Kit, o: GuidedOpts): boolean[] {
  if (o.display) withDisplay(h, o.display);
  const imu: boolean[] = [];
  if (o.imu !== undefined) {
    const answer = o.imu;
    depsOf(h).platform.glasses.imu = async (on) => {
      imu.push(on);
      return answer;
    };
  }
  if (o.journal) depsOf(h).journal = o.journal.journal;
  return imu;
}

/** Quai rouvert (WebView relancée) 10 s plus tard sur le même stockage : le moteur rend encore `o`. */
async function reopen(h: Kit, o: GuidedOpts = {}, state: typeof out = out) {
  const kv = h.kv;
  const now = h.clock.now();
  out = state;
  const h2 = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers }, kv, now: now + 10 * SEC });
  const imu = plug(h2, o);
  await h2.settle();
  return { h2, imu };
}

/** Le moteur rend `o` au prochain calcul (rafraîchissement du trajet suivi). */
async function says(h: Kit, o: typeof out): Promise<void> {
  out = o;
  await h.c.refreshCurrent();
  await h.settle();
}

const boardM = (id = 'board:j-bureau:1') => moment('board', id, NOW, NOW + 60 * MIN, { vehicle: { line: 'W' } });
const reminds = (h: Kit) => h.logs.filter((l) => l.startsWith('QUAI_REMIND '));
const savedRemind = async (h: Kit) => parseTrip(await h.kv.get(TRIP_KEY))?.guide?.remind;

/** Mesures du capteur toutes les 200 ms à partir de `t0`, sur l'axe y. */
function samples(t0: number, ys: number[]): ImuSample[] {
  return ys.map((y, i) => ({ x: 0.1, y, z: 0.98, at: t0 + i * 200 }));
}

beforeEach(() => {
  engine.reset();
  views.reset();
  out = {};
  engine.script = ((input, mem) => (typeof out === 'function' ? out(input, mem) : out)) as typeof engine.script;
});
afterEach(() => cleanupKit());

describe('point 1 : le journal arrive après le démarrage (attachJournal)', () => {
  it('un guidage lancé avant n’est pas noté ; un guidage lancé après l’est (début, batterie, moments, fin)', async () => {
    const jr = memoryJournal();
    const { h } = await guided();
    expect(h.c.followed?.guide?.journal).toBeUndefined();
    h.c.attachJournal(jr.journal);
    await says(h, { moment: boardM() });
    // lancé avant le journal : jamais noté (accepté)
    expect(jr.trips).toEqual([]);
    await h.c.stopGuide();
    expect(jr.trips).toEqual([]);
    out = {};
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    await says(h, { moment: boardM('board:j-bureau:2') });
    expect(jr.trips).toHaveLength(1);
    expect(jr.trips[0]).toMatchObject({ id: 't1', title: 'Bureau', kind: 'trip' });
    expect(h.c.followed?.guide?.journal).toBe('t1');
    expect(jr.of('moment').map((e) => e.d)).toEqual([{ m: 'board', id: 'board:j-bureau:2' }]);
    await h.c.stopGuide();
    expect(jr.trips[0].end).toBe('stopped');
  });

  it('guidage repris après une réouverture (identifiant gardé) : il continue dans son trajet dès le journal reçu', async () => {
    const jr = memoryJournal();
    const { h } = await guided({ journal: jr });
    expect(h.c.followed?.guide?.journal).toBe('t1');
    const { h2 } = await reopen(h, {}, { moment: boardM() });
    // pas encore de journal : rien n'est noté, le guidage continue
    expect(h2.last()).toMatchObject({ screen: 'guide', moment: 'board:j-bureau:1' });
    expect(jr.of('moment')).toEqual([]);
    h2.c.attachJournal(jr.journal);
    await says(h2, { moment: moment('platform', 'platform:j-bureau:1', NOW, NOW + 60 * MIN, { platform: '6' }) });
    expect(jr.trips).toHaveLength(1);
    expect(jr.of('moment').map((e) => e.d)).toEqual([{ m: 'platform', id: 'platform:j-bureau:1' }]);
    await h2.c.stopGuide();
    expect(jr.trips[0].end).toBe('stopped');
  });

  it('le premier journal reçu reste ; contrôleur arrêté : plus rien n’est reçu', async () => {
    const a = memoryJournal();
    const b = memoryJournal();
    const h = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers } });
    h.c.attachJournal(a.journal);
    h.c.attachJournal(b.journal);
    expect(depsOf(h).journal).toBe(a.journal);
    const h2 = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers } });
    h2.c.stop();
    h2.c.attachJournal(b.journal);
    expect(depsOf(h2).journal).toBeUndefined();
  });
});

describe('point 4 : rappels après une réouverture de Quai', () => {
  it('rappelé une fois, Quai rouvert : seul le rappel restant part, 45 s après la réouverture, puis plus rien', async () => {
    const { h } = await guided();
    await says(h, { moment: boardM() });
    await h.settle(45_500);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
    // gardé avec le guidage dans les 5 s (comme la mémoire du moteur), sans attendre l'arrêt de la page
    await h.settle(5_500);
    expect(await savedRemind(h)).toEqual([{ id: 'board:j-bureau:1', n: 1 }]);
    // sans la correction : rappels 1 et 2 de nouveau (4 envois en tout)
    const { h2 } = await reopen(h);
    expect(h2.last()).toMatchObject({ screen: 'guide', moment: 'board:j-bureau:1' });
    await h2.settle(44_000);
    expect(reminds(h2)).toEqual([]);
    await h2.settle(1_500);
    expect(reminds(h2)).toEqual(['QUAI_REMIND board 2']);
    await h2.settle(10 * MIN);
    expect(reminds(h2)).toEqual(['QUAI_REMIND board 2']);
    expect(await savedRemind(h2)).toEqual([{ id: 'board:j-bureau:1', n: 2, done: true }]);
  });

  it('déjà rappelé deux fois, déjà vu ou déjà touché : plus aucun rappel après la réouverture', async () => {
    // rappels épuisés
    const a = await guided();
    await says(a.h, { moment: boardM() });
    await a.h.settle(3 * MIN);
    expect(reminds(a.h)).toEqual(['QUAI_REMIND board 1', 'QUAI_REMIND board 2']);
    const ra = await reopen(a.h);
    await ra.h2.settle(5 * MIN);
    expect(reminds(ra.h2)).toEqual([]);

    // vu (la tête levée au-delà du repos appris)
    const b = await guided({ display: { headUp: HEAD }, imu: true });
    await says(b.h, { moment: boardM() });
    await b.h.settle(10_000);
    for (const s of samples(50_000, [0, 0, 0, -0.4, -0.4, -0.4, -0.4])) await b.h.emit({ kind: 'imu', ...s });
    expect(b.h.logs).toContain('QUAI_SEEN board');
    const rb = await reopen(b.h, { display: { headUp: HEAD }, imu: true });
    await rb.h2.settle(5 * MIN);
    expect(reminds(rb.h2)).toEqual([]);
    // le capteur ne rouvre pas pour un message déjà vu
    expect(rb.imu).toEqual([]);

    // touché (glisser : le message reste affiché, il ne revient pas dans la mémoire du moteur)
    const c = await guided();
    await says(c.h, { moment: boardM() });
    await c.h.settle(20_000);
    await c.h.gesture('down');
    expect(c.h.last().moment).toBe('board:j-bureau:1');
    const rc = await reopen(c.h);
    expect(rc.h2.last().moment).toBe('board:j-bureau:1');
    await rc.h2.settle(5 * MIN);
    expect(reminds(rc.h2)).toEqual([]);
  });

  it('jamais rappelé avant la réouverture : l’attente reprend (45 s, deux rappels), comme avant', async () => {
    const { h } = await guided();
    await says(h, { moment: boardM() });
    await h.settle(20_000);
    const { h2 } = await reopen(h);
    await h2.settle(3 * MIN);
    expect(reminds(h2)).toEqual(['QUAI_REMIND board 1', 'QUAI_REMIND board 2']);
  });

  it('reprise d’un état d’arrière-plan (__restoreState) : l’état des rappels voyage avec le trajet suivi', async () => {
    const { h } = await guided();
    await says(h, { moment: boardM() });
    await h.settle(45_500);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
    // instantané pris tout de suite (avant l'enregistrement différé) ; nouvelle WebView au stockage vide
    const snap = JSON.stringify(h.c.snapshot());
    const h2 = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers }, now: h.clock.now() + 5 * SEC });
    h2.c.restore(snap);
    await h2.settle();
    expect(h2.c.followed?.guide?.remind).toEqual([{ id: 'board:j-bureau:1', n: 1 }]);
    await h2.settle(3 * MIN);
    expect(reminds(h2)).toEqual(['QUAI_REMIND board 2']);
  });

  it('nouveau trajet (recalcul) : l’état des rappels reste avec le guidage ; un nouveau guidage repart de rien', async () => {
    const coreExtra = (now: () => number) => ({ route: async () => ({ journeys: [door('j-new', now() + 4 * MIN, now() + 60 * MIN)] }) });
    const { h } = await guided({ kit: { coreExtra } });
    await says(h, { moment: boardM() });
    await h.settle(45_500);
    expect(h.c.followed!.guide!.remind).toEqual([{ id: 'board:j-bureau:1', n: 1 }]);
    const replan = { from: { lat: 50.8605, lon: 4.3615, areaId: 'sncb:8812005', name: { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' } }, reason: 'missed' as const, at: NOW + 3 * MIN };
    await says(h, (input) => (input.journey.id === 'j-bureau' ? { moment: boardM(), replan } : {}));
    expect(h.c.followed?.journey.id).toBe('j-new');
    // enregistré avec le nouveau trajet (une réouverture juste après le retrouve)
    expect((await savedRemind(h))?.[0]).toMatchObject({ id: 'board:j-bureau:1', n: 1 });
    // un nouveau guidage repart de rien
    out = {};
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(h.c.followed?.guide?.remind).toBeUndefined();
  });
});

/* ------------------------------ Point 5 : « vu » par rapport au repos appris ------------------------------ */

describe('point 5 : reminder.ts, « vu » au-delà du repos appris', () => {
  const feed = (w: HeadUpWatch, ss: ImuSample[]) => ss.map((s) => w.feed(s));

  it('une tête baissée vers le téléphone au moment du message, qui se redresse : pas vu ; levée au-delà du repos + 60 % : vu', () => {
    // sans la correction : la référence était la tête au message (y = 0,5, baissée) ; revenir au repos (0) faisait un
    // mouvement de 0,5 > 0,6 × 0,5 dans le bon sens : compté comme vu
    const w = new HeadUpWatch(HEAD);
    expect(feed(w, samples(0, [0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.1, -0.1, -0.1, -0.1])).some(Boolean)).toBe(false);
    // puis vraiment levée (y = -0,35 < 0 - 0,3), tenue 0,6 s
    expect(feed(w, samples(4000, [-0.35, -0.35, -0.35, -0.35]))).toEqual([false, false, false, true]);
  });

  it('la tête déjà levée au moment du message : vu dès 0,6 s (elle voit l’écran) ; au repos ou baissée : jamais', () => {
    expect(feed(new HeadUpWatch(HEAD), samples(0, [-0.4, -0.4, -0.4, -0.4]))).toEqual([false, false, false, true]);
    expect(feed(new HeadUpWatch(HEAD), samples(0, Array.from({ length: 20 }, () => 0))).some(Boolean)).toBe(false);
    expect(feed(new HeadUpWatch(HEAD), samples(0, Array.from({ length: 20 }, () => 0.6))).some(Boolean)).toBe(false);
    // repos ailleurs que zéro (pesanteur sur l'axe) : la référence suit le repos appris
    const g: HeadUpRest = { axis: 'z', sign: 1, delta: 3, rest: 9.7 };
    const z = (v: number, at: number): ImuSample => ({ x: 0, y: 0, z: v, at });
    expect(feed(new HeadUpWatch(g), [0, 200, 400, 600].map((at) => z(11.4, at)))).toEqual([false, false, false, false]);
    expect(feed(new HeadUpWatch(g), [0, 200, 400, 600].map((at) => z(11.6, at)))).toEqual([false, false, false, true]);
  });

  it('un mouvement sans position de repos (test fait avant) n’est pas utilisé : rappels à l’heure', () => {
    expect(remindPlan({ headUp: { axis: 'y', sign: -1, delta: 0.5 } }).headUp).toBeNull();
    expect(remindPlan({ headUp: { axis: 'y', sign: -1, delta: 0.5, rest: Number.NaN } }).headUp).toBeNull();
    expect(remindPlan({ headUp: HEAD }).headUp).toEqual(HEAD);
  });

  it('réglages : `rest` validé au chargement comme les autres champs (nombre fini gardé, sinon retiré)', () => {
    const disp = (headUp: unknown) => validateSettings({ v: 4, display: { headUp } }).display.headUp;
    expect(disp({ axis: 'y', sign: -1, delta: 0.5, rest: 9.72 })).toEqual({ axis: 'y', sign: -1, delta: 0.5, rest: 9.72 });
    expect(disp({ axis: 'y', sign: -1, delta: 0.5, rest: 0 })).toEqual({ axis: 'y', sign: -1, delta: 0.5, rest: 0 });
    expect(disp({ axis: 'z', sign: 1, delta: 2, rest: -3.5 })).toEqual({ axis: 'z', sign: 1, delta: 2, rest: -3.5 });
    for (const rest of [Number.NaN, Number.POSITIVE_INFINITY, '9.7', null, {}]) expect(disp({ axis: 'y', sign: -1, delta: 0.5, rest })).toEqual({ axis: 'y', sign: -1, delta: 0.5 });
    expect(disp({ axis: 'y', sign: -1, delta: 0.5 })).toEqual({ axis: 'y', sign: -1, delta: 0.5 });
    expect(disp({ axis: 'w', sign: -1, delta: 0.5, rest: 0 })).toBeUndefined();
    // relu tel quel (enregistré puis relu)
    const once = validateSettings({ v: 4, display: { alert: 'visible', headUp: { axis: 'x', sign: 1, delta: 1.2, rest: 0.4 } } });
    expect(validateSettings(JSON.parse(JSON.stringify(once))).display).toMatchObject({ alert: 'visible', headUp: { axis: 'x', sign: 1, delta: 1.2, rest: 0.4 } });
  });
});

describe('point 5 : headup.ts, la position de repos apprise et le plancher du bruit', () => {
  const T = 100;
  /** Repos de l'attente : `n` mesures, données par `at(i)`. */
  const learnerOf = (rest: (i: number) => { x: number; y: number; z: number }, n = 30) => {
    const l = new HeadUpLearner();
    for (let i = 0; i < n; i++) l.rest(rest(i));
    return l;
  };
  /** Question : segments [valeur ajoutée au repos sur `axis`, nombre de mesures], la dernière à `end` (la réponse). */
  const ask = (l: HeadUpLearner, base: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z', segs: [number, number][], end = 120_000) => {
    const n = segs.reduce((t, [, c]) => t + c, 0);
    let k = 0;
    for (const [dv, c] of segs) for (let j = 0; j < c; j++, k++) l.move({ ...base, [axis]: base[axis] + dv, at: end - (n - 1 - k) * T });
    return l.result(end);
  };

  it('le mouvement appris garde la position de repos sur son axe (moyenne de l’attente)', () => {
    const noisy = (i: number) => ({ x: 0.1 + (i % 2) * 0.02, y: 9.7 + ((i * 7) % 5) * 0.01, z: 0.3 - (i % 3) * 0.01 });
    const l = learnerOf(noisy);
    const r = ask(l, { x: 0.1, y: 9.72, z: 0.3 }, 'y', [[0, 5], [2.5, 10], [0, 5], [-4, 12]]);
    expect(r).toMatchObject({ axis: 'y', sign: 1 });
    expect(r!.rest).toBeCloseTo(9.72, 2);
    expect(r!.delta).toBeCloseTo(2.5, 1);
  });

  it('capteur sans aucun bruit (accéléromètre, mesures arrondies) : un écart minuscule n’est plus appris ; un vrai mouvement l’est', () => {
    const still = () => ({ x: 0.1, y: 9.7, z: 0.3 });
    const base = still();
    expect(learnerOf(still).noise('y')).toBe(0);
    // sans le plancher : bruit nul, seuil nul, ce mouvement de 0,01 (0,06°) était appris, puis tout frémissement comptait
    // comme vu
    expect(ask(learnerOf(still), base, 'y', [[0.01, 10], [-0.01, 12]])).toBeNull();
    // juste sous le plancher (3 × 2 % de la pesanteur, ≈ 0,58), puis juste au-dessus
    const scale = Math.hypot(0.1, 9.7, 0.3);
    const floor = 3 * HEADUP_NOISE_FLOOR * scale;
    expect(ask(learnerOf(still), base, 'y', [[floor * 0.95, 10], [-4, 12]])).toBeNull();
    expect(ask(learnerOf(still), base, 'y', [[floor * 1.05, 10], [-4, 12]])).toMatchObject({ axis: 'y', sign: 1, rest: 9.7 });
    // un vrai mouvement (la tête levée de 2,5, baissée de 4 vers le téléphone)
    const r = ask(learnerOf(still), base, 'y', [[0, 5], [2.5, 10], [0, 5], [-4, 12]]);
    expect(r).toEqual({ axis: 'y', sign: 1, delta: 2.5, rest: 9.7 });
  });

  it('angles comptés depuis la tête droite, sans bruit : le plancher suit la posture téléphone (6 % de son angle)', () => {
    const zero = () => ({ x: 0, y: 0, z: 0 });
    const base = zero();
    // tête baissée de 30° vers le téléphone : plancher 3 × 2 % × 30 = 1,8 ; levée de 1° : rien ; de 10° : appris
    expect(ask(learnerOf(zero), base, 'y', [[1, 10], [-30, 12]])).toBeNull();
    expect(ask(learnerOf(zero), base, 'y', [[10, 10], [-30, 12]])).toEqual({ axis: 'y', sign: 1, delta: 10, rest: 0 });
    expect(HEADUP_REST_MIN).toBe(10);
  });
});

describe('point 5 : le contrôleur, « vu » par rapport au repos appris', () => {
  it('message arrivé tête baissée : se redresser ne compte pas ; lever la tête au-delà du repos, si ; mouvement sans repos : pas de capteur', async () => {
    const { h, imu } = await guided({ display: { headUp: HEAD }, imu: true });
    await says(h, { moment: boardM() });
    expect(imu).toEqual([true]);
    await h.settle(5_000);
    // la tête baissée vers le téléphone (y = 0,5), puis redressée (0) pendant 3 s
    for (const s of samples(50_000, [0.5, 0.5, 0.5, ...Array.from({ length: 15 }, () => 0)])) await h.emit({ kind: 'imu', ...s });
    expect(h.logs).not.toContain('QUAI_SEEN board');
    // levée au-delà du repos + 60 % de l'écart
    for (const s of samples(60_000, [-0.4, -0.4, -0.4, -0.4])) await h.emit({ kind: 'imu', ...s });
    expect(h.logs).toContain('QUAI_SEEN board');
    expect(imu).toEqual([true, false]);

    // mouvement appris avant la correction (sans position de repos) : pas de capteur, rappels à l'heure
    const old = await guided({ display: { headUp: { axis: 'y', sign: -1, delta: 0.5 } }, imu: true });
    await says(old.h, { moment: boardM() });
    await old.h.settle(46_000);
    expect(old.imu).toEqual([]);
    expect(reminds(old.h)).toEqual(['QUAI_REMIND board 1']);
  });
});
