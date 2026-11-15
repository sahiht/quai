/**
 * Quai 1.3.0, contrôleur du guidage (PRD-1.3.0 § 6.2 à 6.4) : rappel des messages importants (45 s, 90 s, puis plus
 * rien ; arrêté par un toucher, un nouveau moment, la fin du moment ; aucun en headUp ou dashboard), « vu » par le
 * capteur de mouvement (ouvert seulement pendant l'attente, toujours refermé), batterie des lunettes donnée au moteur,
 * problèmes de la vérification dans la carte « En cours », journal du trajet sans coordonnées ni adresse.
 *
 * D'abord la logique pure de glasses/reminder.ts (minuteries à la main), puis le contrôleur avec le banc du guidage
 * (controller-guide-kit.ts) et les doubles du moteur et des écrans (controller-guide-doubles.ts, plus le vrai
 * checkLines). Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/glasses/guide-views')>();
  return { ...(await import('./controller-guide-doubles')).viewsModule, checkLines: real.checkLines };
});

import type { Core, Endpoint, Favorite, FavoriteAnswer, Journey, LatLon, Settings } from '../../src/core/api';
import type { GuideMemory, GuideState, GuideStatus, Moment } from '../../src/core/guide-types';
import type { JournalEvent, TripJournal } from '../../src/core/journal-types';
import { TRIP_KEY, parseTrip, type ControllerDeps } from '../../src/glasses/controller';
import type { Route } from '../../src/glasses/types';
import {
  ADDRESS_TITLE,
  HeadUpWatch,
  IMPORTANT,
  MomentReminder,
  REMIND,
  journalTitle,
  positionsSummary,
  remindPlan,
  type HeadUp,
  type ImuSample,
  type ReminderNote,
} from '../../src/glasses/reminder';
import { engine, moment, views } from './controller-guide-doubles';
import { NOW, SPOTS, cleanupKit, door, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, settingsWith } from './helpers';

const SEC = 1_000;
const HEAD: HeadUp = { axis: 'y', sign: -1, delta: 0.5 };
const flush = () => new Promise<void>((r) => setImmediate(r));

/* ------------------------------ Logique pure (reminder.ts) ------------------------------ */

/** Minuteries à la main : `advance` déclenche dans l'ordre celles qui sont dues. */
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
    pending: () => q.filter((e) => !e.dead).length,
  };
}

function reminderKit(display: Partial<Settings['display']> = {}, imuAnswer: boolean | 'none' = true) {
  const timers = manualTimers();
  const sent: [string, number][] = [];
  const notes: ReminderNote[] = [];
  const imu: { on: boolean; pace?: number }[] = [];
  let onScreen = true;
  const r = new MomentReminder({
    later: (fn, ms) => timers.later(fn, ms),
    display: () => display as Settings['display'],
    ...(imuAnswer === 'none'
      ? {}
      : {
          imu: async (on: boolean, pace?: number) => {
            imu.push(pace === undefined ? { on } : { on, pace });
            return imuAnswer;
          },
        }),
    resend: (m, n) => {
      if (!onScreen) return false;
      sent.push([m.id, n]);
      return true;
    },
    note: (e) => notes.push(e),
  });
  return { r, timers, sent, notes, imu, hide: () => (onScreen = false) };
}

const BOARD = { kind: 'board', id: 'board:j1:1' } as const;

/** Mesures du capteur toutes les 200 ms à partir de `t0` : la tête au repos, puis les valeurs données sur l'axe y. */
function samples(t0: number, ys: number[]): ImuSample[] {
  return ys.map((y, i) => ({ x: 0.1, y, z: 0.98, at: t0 + i * 200 }));
}
const REST = [0.02, -0.01, 0];

describe('reminder.ts : ce que permet le résultat du test de l’écran', () => {
  it('visible ou pas encore testé : rappels ; headUp ou dashboard : aucun ; capteur seulement avec les rappels et un mouvement appris', () => {
    expect(remindPlan({})).toEqual({ remind: true, headUp: null });
    expect(remindPlan({ alert: 'visible' })).toEqual({ remind: true, headUp: null });
    expect(remindPlan({ alert: 'visible', headUp: HEAD })).toEqual({ remind: true, headUp: HEAD });
    expect(remindPlan({ headUp: HEAD })).toEqual({ remind: true, headUp: HEAD });
    expect(remindPlan({ alert: 'headUp', headUp: HEAD })).toEqual({ remind: false, headUp: null });
    expect(remindPlan({ alert: 'dashboard', headUp: HEAD })).toEqual({ remind: false, headUp: null });
    // mouvement illisible : rappels à l'heure seulement
    expect(remindPlan({ headUp: { axis: 'w', sign: 1, delta: 1 } as unknown as HeadUp }).headUp).toBeNull();
    expect(remindPlan({ headUp: { axis: 'x', sign: 1, delta: 0 } }).headUp).toBeNull();
    expect([...IMPORTANT].sort()).toEqual(['alight', 'board', 'leave', 'passed', 'platform', 'replan']);
    expect(REMIND).toMatchObject({ everyMs: 45_000, max: 2, imuPaceMs: 200, restMs: 400, ratio: 0.6, holdMs: 600 });
  });
});

describe('reminder.ts : « vu », la tête levée', () => {
  const feed = (w: HeadUpWatch, ss: ImuSample[]) => ss.map((s) => w.feed(s));

  it('référence : la médiane des 0,4 premières secondes ; plus de 60 % de l’écart, dans son sens, tenu 0,6 s', () => {
    const w = new HeadUpWatch(HEAD);
    // repos (une mesure aberrante n'y change rien : médiane), puis la tête levée (y descend de 0,35 > 0,6 × 0,5)
    const got = feed(w, samples(1000, [0.02, 0.9, 0, -0.35, -0.36, -0.34, -0.35, -0.35]));
    // 1000, 1200, 1400 : repos ; 1600 : début ; 2200 : 0,6 s tenue
    expect(got).toEqual([false, false, false, false, false, false, true, true]);
  });

  it('pas vu : mauvais sens, écart trop petit, tenue interrompue', () => {
    expect(feed(new HeadUpWatch(HEAD), samples(0, [...REST, 0.4, 0.4, 0.4, 0.4, 0.4])).some(Boolean)).toBe(false);
    expect(feed(new HeadUpWatch(HEAD), samples(0, [...REST, -0.29, -0.29, -0.29, -0.29, -0.29])).some(Boolean)).toBe(false);
    // levée 0,4 s, baissée, relevée : la tenue repart de zéro
    const w = new HeadUpWatch(HEAD);
    expect(feed(w, samples(0, [...REST, -0.4, -0.4, -0.4, 0, -0.4, -0.4, -0.4])).some(Boolean)).toBe(false);
    expect(w.feed({ x: 0, y: -0.4, z: 1, at: 2000 })).toBe(true);
    // autre axe, autre sens
    expect(feed(new HeadUpWatch({ axis: 'x', sign: 1, delta: 2 }), [0, 200, 400, 600, 800, 1000, 1200].map((at, i) => ({ x: i < 3 ? 0 : 1.3, y: 0, z: 0, at }))).at(-1)).toBe(true);
  });
});

describe('reminder.ts : rappel des messages importants', () => {
  it('45 s, puis 90 s, puis plus rien ; l’attente finit 45 s après le dernier rappel', () => {
    const k = reminderKit();
    k.r.shown(BOARD);
    k.timers.advance(44_999);
    expect(k.sent).toEqual([]);
    k.timers.advance(1);
    expect(k.sent).toEqual([[BOARD.id, 1]]);
    k.timers.advance(45_000);
    expect(k.sent).toEqual([
      [BOARD.id, 1],
      [BOARD.id, 2],
    ]);
    expect(k.r.waiting).toMatchObject({ id: BOARD.id, n: 2 });
    k.timers.advance(45_000);
    expect(k.r.waiting).toBeNull();
    k.timers.advance(30 * MIN);
    expect(k.sent).toHaveLength(2);
    expect(k.timers.pending()).toBe(0);
    // le même moment de nouveau affiché : pas de nouvelle attente
    k.r.shown(BOARD);
    k.timers.advance(5 * MIN);
    expect(k.sent).toHaveLength(2);
    expect(k.notes.filter((n) => n.k === 'remind')).toEqual([
      { k: 'remind', m: BOARD, n: 1 },
      { k: 'remind', m: BOARD, n: 2 },
    ]);
  });

  it('un toucher, un nouveau moment, la fin du moment, un message plus à l’écran arrêtent les rappels', () => {
    const a = reminderKit();
    a.r.shown(BOARD);
    a.timers.advance(20 * SEC);
    a.r.touch();
    a.timers.advance(5 * MIN);
    expect(a.sent).toEqual([]);

    const b = reminderKit();
    b.r.shown(BOARD);
    b.timers.advance(30 * SEC);
    b.r.shown({ kind: 'alight', id: 'alight:j1:1' });
    b.timers.advance(15 * SEC);
    expect(b.sent).toEqual([]);
    // le nouveau message important a sa propre attente
    b.timers.advance(30 * SEC);
    expect(b.sent).toEqual([['alight:j1:1', 1]]);

    const c = reminderKit();
    c.r.shown(BOARD);
    c.timers.advance(30 * SEC);
    c.r.shown(null);
    c.timers.advance(5 * MIN);
    expect(c.sent).toEqual([]);

    const d = reminderKit();
    d.r.shown(BOARD);
    d.hide();
    d.timers.advance(5 * MIN);
    expect(d.sent).toEqual([]);
    expect(d.r.waiting).toBeNull();
  });

  it('headUp, dashboard : aucun rappel ; turn, nextStop, check, offMap, arrived : aucun rappel', () => {
    for (const alert of ['headUp', 'dashboard'] as const) {
      const k = reminderKit({ alert, headUp: HEAD });
      k.r.shown(BOARD);
      k.timers.advance(5 * MIN);
      expect(k.sent).toEqual([]);
      expect(k.imu).toEqual([]);
    }
    const k = reminderKit({ alert: 'visible', headUp: HEAD });
    for (const kind of ['turn', 'nextStop', 'check', 'offMap', 'arrived'] as const) k.r.shown({ kind, id: `${kind}:j1` });
    k.timers.advance(5 * MIN);
    expect(k.sent).toEqual([]);
    expect(k.imu).toEqual([]);
  });

  it('test de l’écran refait pendant l’attente (headUp) : le rappel suivant ne part pas', () => {
    const display: Partial<Settings['display']> = {};
    const k = reminderKit(display);
    k.r.shown(BOARD);
    k.timers.advance(45 * SEC);
    expect(k.sent).toHaveLength(1);
    display.alert = 'headUp';
    k.timers.advance(45 * SEC);
    expect(k.sent).toHaveLength(1);
    expect(k.r.waiting).toBeNull();
  });

  it('premier plan quitté : rien ne part, capteur fermé ; au retour, l’attente reprend (45 s, rappels restants)', () => {
    const k = reminderKit({ headUp: HEAD });
    k.r.shown(BOARD);
    k.timers.advance(50 * SEC);
    expect(k.sent).toHaveLength(1);
    k.r.suspend();
    expect(k.imu.map((c) => c.on)).toEqual([true, false]);
    k.timers.advance(5 * MIN);
    expect(k.sent).toHaveLength(1);
    k.r.shown(BOARD);
    expect(k.imu.map((c) => c.on)).toEqual([true, false, true]);
    k.timers.advance(45 * SEC);
    expect(k.sent).toEqual([
      [BOARD.id, 1],
      [BOARD.id, 2],
    ]);
    k.r.end();
    expect(k.imu.map((c) => c.on)).toEqual([true, false, true, false]);
  });
});

describe('reminder.ts : capteur de mouvement', () => {
  it('ouvert (200 ms) pendant l’attente d’un message important ; vu : fermé, plus de rappel', () => {
    const k = reminderKit({ headUp: HEAD });
    k.r.shown(BOARD);
    expect(k.imu).toEqual([{ on: true, pace: 200 }]);
    for (const s of samples(5000, [...REST, -0.4, -0.4, -0.4, -0.4])) k.r.sample(s);
    expect(k.notes).toContainEqual({ k: 'seen', m: BOARD });
    expect(k.imu).toEqual([{ on: true, pace: 200 }, { on: false }]);
    k.timers.advance(5 * MIN);
    expect(k.sent).toEqual([]);
    // une mesure de plus (le test de l'écran, une mesure en retard) : sans effet
    k.r.sample({ x: 0, y: -1, z: 0, at: 9000 });
    expect(k.imu).toHaveLength(2);
  });

  it('sans attente d’un message important : rien n’est envoyé au capteur (ni ouverture, ni fermeture)', () => {
    const k = reminderKit({ headUp: HEAD });
    k.r.shown(null);
    k.r.touch();
    k.r.suspend();
    k.r.sample({ x: 0, y: -1, z: 0, at: 0 });
    k.r.end();
    k.r.shown({ kind: 'turn', id: 'turn:j1:0:1' });
    k.r.shown(null);
    k.r.end();
    expect(k.imu).toEqual([]);
    // ouvert par lui : fermé une seule fois, même si on le lui redemande
    k.r.shown(BOARD);
    k.r.touch();
    k.r.end();
    k.r.suspend();
    expect(k.imu.map((c) => c.on)).toEqual([true, false]);
  });

  it('mesure sans instant lisible : l’horloge de l’appli la remplace', () => {
    let clock = 0;
    const seen: ReminderNote[] = [];
    const r = new MomentReminder({ later: () => () => undefined, now: () => clock, display: () => ({ headUp: HEAD }), imu: async () => true, resend: () => true, note: (e) => seen.push(e) });
    r.shown(BOARD);
    for (const y of [...REST, -0.4, -0.4, -0.4, -0.4]) {
      r.sample({ x: 0, y, z: 1, at: Number.NaN });
      clock += 200;
    }
    expect(seen).toContainEqual({ k: 'seen', m: BOARD });
  });

  it('sans mouvement appris, sans capteur ou capteur refusé : rappels à l’heure seulement ; une ouverture, une fermeture', async () => {
    const none = reminderKit({});
    none.r.shown(BOARD);
    expect(none.imu).toEqual([]);
    none.timers.advance(45 * SEC);
    expect(none.sent).toHaveLength(1);

    const absent = reminderKit({ headUp: HEAD }, 'none');
    absent.r.shown(BOARD);
    absent.timers.advance(90 * SEC);
    expect(absent.sent).toHaveLength(2);
    expect(absent.notes.some((n) => n.k === 'imu')).toBe(false);

    const refused = reminderKit({ headUp: HEAD }, false);
    refused.r.shown(BOARD);
    await flush();
    // une mesure arrivée quand même ne compte pas
    for (const s of samples(0, [...REST, -0.4, -0.4, -0.4, -0.4])) refused.r.sample(s);
    refused.timers.advance(90 * SEC);
    expect(refused.sent).toHaveLength(2);
    refused.timers.advance(45 * SEC);
    expect(refused.imu.map((c) => c.on)).toEqual([true, false]);
  });
});

describe('reminder.ts : journal (résumé des positions, titre)', () => {
  it('positions : nombre, précision médiane, plus long trou (bords de la fenêtre compris)', () => {
    const from = 1_000_000;
    expect(positionsSummary([from + 10 * SEC, from + 20 * SEC, from + 200 * SEC], [5, 30, 8], from, from + 300 * SEC)).toEqual({ n: 3, acc: 8, gap: 180 });
    expect(positionsSummary([], [], from, from + 300 * SEC)).toEqual({ n: 0, gap: 300 });
    expect(positionsSummary([from + 1 * SEC, from + 299 * SEC], [4, 6], from, from + 300 * SEC)).toEqual({ n: 2, acc: 5, gap: 298 });
  });

  it('titre : celui de l’écran, sauf un trajet vers une adresse', () => {
    expect(journalTitle('Bureau', { type: 'place' })).toBe('Bureau');
    expect(journalTitle('Vers Gare des Guillemins')).toBe('Vers Gare des Guillemins');
    expect(journalTitle('Place Flagey 1', { type: 'address', label: 'Place Flagey 1, 1050 Ixelles' })).toBe(ADDRESS_TITLE);
    expect(journalTitle('Sport', { type: 'address', label: 'Place Flagey 1, 1050 Ixelles' })).toBe('Sport');
  });
});

/* ------------------------------ Contrôleur ------------------------------ */

const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)] }, updatedAt: now } : undefined;
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
const depsOf = (h: Kit): ControllerDeps => (h.c as unknown as { d: ControllerDeps }).d;

/** Ce que le moteur double rend, modifiable pendant le test (une fonction : selon l'entrée et la mémoire). */
let out: Partial<GuideState> | ((input: { now: number; journey: Journey }, mem: GuideMemory) => Partial<GuideState> & { mem?: GuideMemory }) = {};

/** Réglages d'affichage du test de l'écran (alert, headUp) : gardés tels quels (la migration des réglages est à l'équipe F). */
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
  const trips: { id: string; title: string; kind: 'trip' | 'ride'; at: number; events: JournalEvent[]; end?: string; endedAt?: number }[] = [];
  const journal: TripJournal = {
    begin(meta) {
      const id = `t${trips.length + 1}`;
      trips.push({ id, ...meta, events: [] });
      return id;
    },
    add(id, e) {
      trips.find((t) => t.id === id)?.events.push(structuredClone(e));
    },
    end(id, end, at) {
      const t = trips.find((x) => x.id === id);
      if (t) Object.assign(t, { end, endedAt: at });
    },
    list: () => [],
    text: () => '',
    clear: () => undefined,
  };
  const kinds = (i = 0) => trips[i]?.events.map((e) => e.k) ?? [];
  const of = (k: string, i = 0) => trips[i]?.events.filter((e) => e.k === k) ?? [];
  return { journal, trips, kinds, of };
}

interface GuidedOpts {
  display?: Partial<Settings['display']>;
  /** capteur des lunettes : vrai ou faux (réponse de l'hôte), 'none' (absent, défaut) */
  imu?: boolean | 'none';
  journal?: ReturnType<typeof memoryJournal>;
  kit?: Partial<KitOptions>;
  /** avant le lancement (signaux de l'hôte, réglages) */
  before?: (h: Kit) => Promise<void>;
}

/** Guidage lancé par le bouton « Y aller » (Bureau), « Où tu en es » laissé s'effacer. */
async function guided(o: GuidedOpts = {}) {
  const h = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers }, ...o.kit });
  if (o.display) withDisplay(h, o.display);
  const imu: { on: boolean; pace?: number }[] = [];
  const port = depsOf(h).platform.glasses;
  if (o.imu !== undefined && o.imu !== 'none') {
    const answer = o.imu;
    port.imu = async (on, pace) => {
      imu.push(pace === undefined ? { on } : { on, pace });
      return answer;
    };
  }
  if (o.journal) depsOf(h).journal = o.journal.journal;
  await h.until(homeReady);
  await o.before?.(h);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  await h.settle(15_500);
  return { h, imu };
}

/** Le moteur rend `o` au prochain calcul (rafraîchissement du trajet suivi). */
async function says(h: Kit, o: typeof out): Promise<void> {
  out = o;
  await h.c.refreshCurrent();
  await h.settle();
}

const boardM = (id = 'board:j-bureau:1') => moment('board', id, NOW, NOW + 60 * MIN, { vehicle: { line: 'W' } });
const reminds = (h: Kit) => h.logs.filter((l) => l.startsWith('QUAI_REMIND '));
const imuOn = (calls: { on: boolean }[]) => calls.map((c) => c.on);
async function lift(h: Kit, t0 = 50_000): Promise<void> {
  for (const s of samples(t0, [...REST, -0.4, -0.4, -0.4, -0.4])) await h.emit({ kind: 'imu', ...s });
}

beforeEach(() => {
  engine.reset();
  views.reset();
  out = {};
  engine.script = ((input, mem) => (typeof out === 'function' ? out(input, mem) : out)) as typeof engine.script;
});
afterEach(() => cleanupKit());

describe('PRD-1.3.0 § 6.2 : rappel des messages importants', () => {
  it('pas vu au bout de 45 s : la page entière renvoyée (même contenu, images comprises), à 45 s et 90 s, puis plus rien', async () => {
    const { h } = await guided();
    await says(h, { moment: boardM() });
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'board:j-bureau:1' });
    const first = h.last();
    const n0 = h.calls.length;
    await h.settle(44_000);
    expect(h.since(n0).filter((c) => c.op === 'rebuild')).toHaveLength(0);
    expect(reminds(h)).toEqual([]);
    await h.settle(1_500);
    // rappel 1 : reconstruction de la page (comme un premier affichage), image redessinée
    const r1 = h.since(n0);
    expect(r1.filter((c) => c.op === 'rebuild')).toHaveLength(1);
    expect(r1.filter((c) => c.op === 'paint').length).toBeGreaterThanOrEqual(1);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'board:j-bureau:1', lines: first.lines });
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
    await h.settle(45_000);
    expect(h.since(n0).filter((c) => c.op === 'rebuild')).toHaveLength(2);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1', 'QUAI_REMIND board 2']);
    // 3 envois en tout : plus rien ensuite, tant que le moment dure
    await h.settle(10 * MIN);
    expect(h.since(n0).filter((c) => c.op === 'rebuild')).toHaveLength(2);
    expect(reminds(h)).toHaveLength(2);
    expect(h.last().moment).toBe('board:j-bureau:1');
  });

  it('un toucher (effacé ou non), un nouveau moment ou la fin du moment arrêtent les rappels', async () => {
    const { h } = await guided();
    // effacé d'un toucher
    await says(h, { moment: boardM('board:a') });
    await h.settle(20_000);
    await h.gesture('tap');
    expect(engine.dismissed).toEqual(['board:a']);
    await h.settle(2 * MIN);
    expect(reminds(h)).toEqual([]);
    // glisser sur le message (il reste affiché) : vu aussi
    await says(h, { moment: boardM('board:b') });
    await h.settle(20_000);
    await h.gesture('down');
    expect(h.last().moment).toBe('board:b');
    await h.settle(2 * MIN);
    expect(reminds(h)).toEqual([]);
    // un nouveau moment : l'ancien n'est pas rappelé ; le nouveau (important) a son attente
    await says(h, { moment: moment('platform', 'platform:c', NOW, NOW + 60 * MIN, { platform: '6' }) });
    await h.settle(30_000);
    await says(h, { moment: moment('alight', 'alight:d', NOW, NOW + 60 * MIN) });
    await h.settle(20_000);
    expect(reminds(h)).toEqual([]);
    await h.settle(26_000);
    expect(reminds(h)).toEqual(['QUAI_REMIND alight 1']);
    // la fin du moment
    await says(h, { moment: boardM('board:e') });
    await h.settle(30_000);
    await says(h, { moment: null });
    await h.settle(2 * MIN);
    expect(reminds(h)).toEqual(['QUAI_REMIND alight 1']);
  });

  it('headUp ou dashboard : aucun rappel, aucun capteur ; visible : rappels', async () => {
    for (const alert of ['headUp', 'dashboard'] as const) {
      const { h, imu } = await guided({ display: { alert, headUp: HEAD }, imu: true });
      await says(h, { moment: boardM() });
      const n0 = h.calls.length;
      await h.settle(3 * MIN);
      expect(h.since(n0).filter((c) => c.op === 'rebuild')).toHaveLength(0);
      expect(reminds(h)).toEqual([]);
      expect(imu).toEqual([]);
      // le message reste affiché comme en 1.2.10
      expect(h.last().moment).toBe('board:j-bureau:1');
    }
    const { h } = await guided({ display: { alert: 'visible' } });
    await says(h, { moment: boardM() });
    await h.settle(46_000);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
  });

  it('aucun rappel pour offMap, check, turn, nextStop, arrived', async () => {
    const { h } = await guided();
    const quiet: Moment[] = [
      moment('offMap', 'offMap:j-bureau:0', NOW, NOW + 60 * MIN, { walkMin: 6 }),
      moment('check', 'check:j-bureau', NOW, NOW + 60 * MIN, { issues: [{ kind: 'battery', level: 12 }] }),
      moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 60 * MIN, { turn: 'left', distM: 40 }),
      moment('nextStop', 'nextStop:j-bureau:1:3', NOW, NOW + 60 * MIN),
      moment('arrived', 'arrived:j-bureau', NOW, NOW + 60 * MIN, { title: 'Bureau', at: NOW, diffMin: 0 }),
    ];
    for (const m of quiet) {
      await says(h, { moment: m });
      expect(h.last().moment).toBe(m.id);
      await h.settle(100_000);
    }
    expect(reminds(h)).toEqual([]);
  });
});

describe('PRD-1.3.0 § 6.2 : « vu » par le capteur de mouvement', () => {
  it('mouvement appris : capteur ouvert (200 ms) pendant l’attente ; la tête levée 0,6 s : vu, capteur fermé, pas de rappel', async () => {
    const { h, imu } = await guided({ display: { headUp: HEAD }, imu: true });
    expect(imu).toEqual([]);
    await says(h, { moment: boardM() });
    expect(imu).toEqual([{ on: true, pace: 200 }]);
    await h.settle(10_000);
    await lift(h);
    expect(h.logs).toContain('QUAI_SEEN board');
    expect(imu).toEqual([{ on: true, pace: 200 }, { on: false }]);
    await h.settle(3 * MIN);
    expect(reminds(h)).toEqual([]);
    // les mesures n'apparaissent nulle part dans les lignes du mode test
    expect(h.logs.filter((l) => /-0\.4|0\.98/.test(l))).toEqual([]);
  });

  it('pas vu (mauvais sens) : rappels à l’heure ; capteur fermé 45 s après le dernier rappel', async () => {
    const { h, imu } = await guided({ display: { alert: 'visible', headUp: HEAD }, imu: true });
    await says(h, { moment: boardM() });
    for (const s of samples(1000, [...REST, 0.4, 0.4, 0.4, 0.4, 0.4])) await h.emit({ kind: 'imu', ...s });
    await h.settle(46_000);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
    expect(imuOn(imu)).toEqual([true]);
    await h.settle(45_000);
    expect(reminds(h)).toHaveLength(2);
    await h.settle(45_000);
    expect(imuOn(imu)).toEqual([true, false]);
  });

  it('capteur absent ou refusé par l’hôte : rappels à l’heure seulement', async () => {
    for (const o of [{ imu: 'none' as const }, { imu: false }]) {
      const { h, imu } = await guided({ display: { headUp: HEAD }, ...o });
      await says(h, { moment: boardM() });
      await lift(h, 2_000);
      await h.settle(91_000);
      expect(reminds(h)).toEqual(['QUAI_REMIND board 1', 'QUAI_REMIND board 2']);
      expect(h.logs).not.toContain('QUAI_SEEN board');
      // refusé : la fermeture suit quand même l'ouverture demandée
      await h.settle(46_000);
      expect(imuOn(imu)).toEqual(o.imu === false ? [true, false] : []);
    }
  });

  const closers: [string, (h: Kit) => Promise<void>][] = [
    ['vu', (h) => lift(h)],
    ['effacé d’un toucher', (h) => h.gesture('tap')],
    ['un nouveau moment', (h) => says(h, { moment: moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 60 * MIN, { turn: 'left', distM: 40 }) })],
    ['la fin du moment', (h) => says(h, { moment: null })],
    ['premier plan quitté', (h) => h.emit({ kind: 'background' })],
    ['lunettes ôtées', (h) => h.emit({ kind: 'device', connected: true, wearing: false })],
    ['lunettes déconnectées', (h) => h.emit({ kind: 'device', connected: false })],
    ['double toucher (accueil)', (h) => h.gesture('double')],
    ['guidage arrêté', (h) => h.c.stopGuide()],
    ['fin du guidage par le moteur', (h) => says(h, { ended: true })],
    ['contrôleur arrêté (sortie)', async (h) => h.c.stop()],
    ['fin de l’attente', (h) => h.settle(136_000)],
  ];
  for (const [name, close] of closers) {
    it(`capteur toujours refermé : ${name}`, async () => {
      const { h, imu } = await guided({ display: { headUp: HEAD }, imu: true });
      await says(h, { moment: boardM() });
      expect(imuOn(imu)).toEqual([true]);
      await close(h);
      await h.settle();
      expect(imuOn(imu)).toEqual([true, false]);
    });
  }

  it('hors d’un guidage : aucun appel au capteur, quels que soient les écrans rendus', async () => {
    const h = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers } });
    withDisplay(h, { headUp: HEAD });
    const imu: boolean[] = [];
    depsOf(h).platform.glasses.imu = async (on) => {
      imu.push(on);
      return true;
    };
    await h.until(homeReady);
    const routes: Route[] = [{ screen: 'favorites' }, { screen: 'stations' }, { screen: 'message', kind: 'info', title: 'Quai', lines: ['Test'] }, { screen: 'home' }];
    for (const route of routes) {
      await h.c.show(route);
      await h.settle(2_000);
    }
    await h.emit({ kind: 'background' });
    await h.emit({ kind: 'foreground' });
    await h.emit({ kind: 'device', connected: false });
    await h.emit({ kind: 'device', connected: true, wearing: true });
    await h.emit({ kind: 'imu', x: 0, y: -1, z: 0, at: 1 });
    await h.settle(3 * MIN);
    h.c.stop();
    expect(imu).toEqual([]);
  });

  it('pendant un guidage : seuls les messages importants ouvrent le capteur ; les autres écrans n’envoient rien', async () => {
    const { h, imu } = await guided({ display: { headUp: HEAD }, imu: true });
    await says(h, { moment: moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 60 * MIN, { turn: 'left', distM: 40 }) });
    await h.gesture('double');
    await h.c.show({ screen: 'favorites' });
    await h.settle(2_000);
    expect(imu).toEqual([]);
    // de retour sur le guidage, un message important : une ouverture ; l'accueil : une fermeture, puis plus rien
    await h.c.show({ screen: 'guide' });
    await says(h, { moment: boardM() });
    expect(imuOn(imu)).toEqual([true]);
    await h.gesture('double');
    expect(imuOn(imu)).toEqual([true, false]);
    await h.c.show({ screen: 'stations' });
    await h.settle(2 * MIN);
    await h.emit({ kind: 'background' });
    await h.emit({ kind: 'foreground' });
    await h.c.stopGuide();
    h.c.stop();
    expect(imuOn(imu)).toEqual([true, false]);
  });

  it('lunettes reconnectées : capteur rouvert si le message attend encore, l’attente reprend', async () => {
    const { h, imu } = await guided({ display: { headUp: HEAD }, imu: true, before: (k) => k.emit({ kind: 'device', connected: true, wearing: true, battery: 80 }) });
    await says(h, { moment: boardM() });
    await h.settle(10_000);
    await h.emit({ kind: 'device', connected: false });
    expect(imuOn(imu)).toEqual([true, false]);
    await h.settle(2 * MIN);
    expect(reminds(h)).toEqual([]);
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 80 });
    expect(imuOn(imu)).toEqual([true, false, true]);
    await h.settle(46_000);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
    // le message n'attend plus (vu) : une nouvelle reconnexion ne rouvre rien
    await lift(h, 400_000);
    await h.emit({ kind: 'device', connected: false });
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 80 });
    expect(imuOn(imu)).toEqual([true, false, true, false]);
  });

  it('Quai Web : aucun rappel, aucun capteur (l’écran dessiné est toujours visible) ; le journal note le message', async () => {
    const jr = memoryJournal();
    const { h, imu } = await guided({ kit: { web: true }, display: { alert: 'visible', headUp: HEAD }, imu: true, journal: jr });
    await says(h, { moment: boardM() });
    expect(h.last()).toMatchObject({ screen: 'guide', moment: 'board:j-bureau:1' });
    const n0 = h.calls.length;
    await h.settle(5 * MIN);
    expect(reminds(h)).toEqual([]);
    expect(h.since(n0).filter((c) => c.op === 'rebuild')).toHaveLength(0);
    expect(imu).toEqual([]);
    expect(jr.of('moment').map((e) => e.d)).toEqual([{ m: 'board', id: 'board:j-bureau:1' }]);
    expect(jr.of('remind')).toEqual([]);
  });

  it('premier plan quitté puis revenu : capteur rouvert, l’attente reprend 45 s après le retour', async () => {
    const { h, imu } = await guided({ display: { headUp: HEAD }, imu: true });
    await says(h, { moment: boardM() });
    await h.settle(10_000);
    await h.emit({ kind: 'background' });
    await h.settle(2 * MIN);
    expect(reminds(h)).toEqual([]);
    await h.emit({ kind: 'foreground' });
    await h.settle(100);
    expect(imuOn(imu)).toEqual([true, false, true]);
    await h.settle(44_000);
    expect(reminds(h)).toEqual([]);
    await h.settle(1_500);
    expect(reminds(h)).toEqual(['QUAI_REMIND board 1']);
  });
});

describe('PRD-1.3.0 § 6.3 : batterie des lunettes et vérification', () => {
  it('la dernière batterie du signal `device` est donnée au moteur (GuideInput.battery), tout de suite', async () => {
    const { h } = await guided();
    expect(engine.last().input.battery).toBeUndefined();
    const n = engine.calls.length;
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 15 });
    expect(engine.calls.length).toBeGreaterThan(n);
    expect(engine.last().input.battery).toBe(15);
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 40 });
    expect(engine.last().input.battery).toBe(40);
    // absente : inconnue, l'ancienne valeur n'est pas gardée (le moteur recalculé tout de suite)
    const m = engine.calls.length;
    await h.emit({ kind: 'device', connected: true, wearing: true });
    expect(engine.calls.length).toBeGreaterThan(m);
    expect(engine.last().input.battery).toBeUndefined();
    await says(h, {});
    expect('battery' in engine.last().input).toBe(false);
    // 0 du SDK : inconnue aussi ; une valeur entière de 1 à 100
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 37.6 });
    expect(engine.last().input.battery).toBe(38);
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 0 });
    expect(engine.last().input.battery).toBeUndefined();
  });

  it('signal `device` avec seulement la batterie changée : ni page reconstruite, ni « lunettes » dans le journal', async () => {
    const jr = memoryJournal();
    const { h } = await guided({ journal: jr, before: (k) => k.emit({ kind: 'device', connected: true, wearing: true, battery: 50 }) });
    await says(h, { moment: boardM() });
    const n0 = h.calls.length;
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 49 });
    await h.emit({ kind: 'device', connected: true, wearing: true, battery: 48 });
    expect(engine.last().input.battery).toBe(48);
    expect(h.since(n0).filter((c) => c.op === 'rebuild')).toHaveLength(0);
    expect(jr.of('glasses')).toEqual([]);
    // la batterie du journal reste celle du départ
    expect(jr.of('battery').map((e) => e.d)).toEqual([{ level: 50 }]);
  });

  it('connue avant le lancement : le moteur l’a dès le premier calcul', async () => {
    const { h } = await guided({ before: (k) => k.emit({ kind: 'device', connected: true, wearing: true, battery: 12 }) });
    const first = engine.calls.find((c) => c.input.journey.id === 'j-bureau');
    expect(first?.input.battery).toBe(12);
    expect(h.c.followed?.guide).toBeDefined();
  });

  it('carte « En cours » : les problèmes de la vérification (checkLines) tant qu’ils existent ; onGuide prévenu', async () => {
    const { h } = await guided();
    const seen: (GuideStatus | null)[] = [];
    h.c.onGuide((s) => seen.push(s));
    expect(h.c.guideStatus()?.check).toBeUndefined();
    await says(h, { issues: [{ kind: 'battery', level: 12 }], moment: moment('check', 'check:j-bureau', NOW, NOW + 20 * SEC, { issues: [{ kind: 'battery', level: 12 }] }) });
    expect(h.c.guideStatus()?.check).toEqual(['Lunettes : 12 % de batterie']);
    expect(seen.at(-1)?.check).toEqual(['Lunettes : 12 % de batterie']);
    // le moment check s'affiche comme les autres (sans rappel)
    expect(h.last()).toMatchObject({ show: 'moment', moment: 'check:j-bureau' });
    // deux au plus
    await says(h, { issues: [{ kind: 'noPosition' }, { kind: 'battery', level: 12 }, { kind: 'positionLost', minutes: 3 }] });
    expect(h.c.guideStatus()?.check).toEqual(['Pas de position : guidage à l’heure', 'Lunettes : 12 % de batterie']);
    expect(seen.at(-1)?.check).toHaveLength(2);
    const before = seen.length;
    await says(h, {});
    expect(h.c.guideStatus()?.check).toBeUndefined();
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)?.check).toBeUndefined();
    await h.settle(2 * MIN);
    expect(reminds(h)).toEqual([]);
  });
});

describe('PRD-1.3.0 § 6.4 : journal du trajet', () => {
  const nord = { lat: 50.8605, lon: 4.3615 };
  function routing(list: (now: number) => Journey[]) {
    return (now: () => number): Partial<Core> => ({
      async route(_from: Endpoint, _to: Endpoint, _after: number, _s: unknown, _here?: LatLon | null) {
        const journeys = list(now());
        return journeys.length ? { journeys } : { journeys, empty: 'noTrip' as const };
      },
    });
  }

  it('début, moments, rappel, vu, effacé, montée, descente, recalcul, arrêt dépassé, vérification, premier plan, lunettes, positions, arrivée, fin', async () => {
    const jr = memoryJournal();
    const { h } = await guided({
      journal: jr,
      display: { headUp: HEAD },
      imu: true,
      kit: { coreExtra: routing(() => []) },
      before: (k) => k.emit({ kind: 'device', connected: true, wearing: true, battery: 64 }),
    });
    expect(jr.trips).toHaveLength(1);
    expect(jr.trips[0]).toMatchObject({ id: 't1', title: 'Bureau', kind: 'trip' });
    expect(jr.trips[0].events.slice(0, 2)).toEqual([
      { t: expect.any(Number), k: 'start', d: { title: 'Bureau', kind: 'trip' } },
      { t: expect.any(Number), k: 'battery', d: { level: 64 } },
    ]);
    // l'identifiant du journal est gardé avec le guidage (repris à la réouverture)
    expect(parseTrip(await h.kv.get(TRIP_KEY))?.guide?.journal).toBe('t1');
    // un message affiché, rappelé, puis vu
    await says(h, { moment: boardM(), location: 'high' });
    await h.settle(46_000);
    await lift(h);
    expect(jr.of('moment')).toEqual([{ t: expect.any(Number), k: 'moment', d: { m: 'board', id: 'board:j-bureau:1' } }]);
    expect(jr.of('remind').map((e) => e.d)).toEqual([{ m: 'board', n: 1 }]);
    expect(jr.of('seen').map((e) => e.d)).toEqual([{ m: 'board' }]);
    // un autre, effacé d'un toucher
    await says(h, { moment: moment('platform', 'platform:j-bureau:1', NOW, NOW + 60 * MIN, { platform: '6' }), location: 'high' });
    await h.gesture('tap');
    expect(jr.of('clear').map((e) => e.d)).toEqual([{ m: 'platform' }]);
    // montée et descente constatées par la position (mémoire du moteur), arrêt dépassé
    const boarded = { leg: 1, at: NOW + 6 * MIN };
    await says(h, (_i, mem) => ({ location: 'high', mem: { ...mem, boarded } }));
    await says(h, (_i, mem) => ({ location: 'high', mem: { ...mem, boarded } }));
    expect(jr.of('boarded').map((e) => e.d)).toEqual([{ line: 'W', mode: 'bus' }]);
    await says(h, (_i, mem) => ({ location: 'high', mem: { ...mem, alighted: { leg: 1, at: NOW + 40 * MIN } } }));
    expect(jr.of('alighted').map((e) => e.d)).toEqual([{ stop: 'Bruxelles Midi' }]);
    await says(h, { location: 'high', moment: moment('passed', 'passed:j-bureau:1', NOW, NOW + 60 * MIN, { passed: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, getOff: { fr: 'Bruxelles-Midi', nl: 'Brussel-Zuid' }, at: NOW }) });
    expect(jr.of('passed').map((e) => e.d)).toEqual([{ stop: 'Bruxelles-Central' }]);
    // recalcul (rien trouvé)
    await says(h, { location: 'high', replan: { from: { ...nord, areaId: 'sncb:8812005' }, reason: 'missed', at: NOW + 30 * MIN } });
    await h.settle();
    expect(jr.of('replan').map((e) => e.d)).toEqual([{ reason: 'missed', found: false }]);
    // vérification : les problèmes, une fois tant qu'ils ne changent pas
    await says(h, { location: 'high', issues: [{ kind: 'positionLost', minutes: 3 }] });
    await says(h, { location: 'high', issues: [{ kind: 'positionLost', minutes: 3 }] });
    expect(jr.of('check').map((e) => e.d)).toEqual([{ issues: 'Position perdue depuis 3 min' }]);
    // premier plan quitté, revenu ; lunettes déconnectées, reconnectées
    await h.emit({ kind: 'background' });
    await h.emit({ kind: 'foreground' });
    await h.emit({ kind: 'device', connected: false });
    await h.emit({ kind: 'device', connected: true, wearing: true });
    expect(jr.of('fg').map((e) => e.d)).toEqual([{ on: false }, { on: true }]);
    expect(jr.of('glasses').map((e) => e.d)).toEqual([{ connected: false }, { connected: true }]);
    // positions : résumé toutes les 5 min (nombre, précision médiane, plus long trou), sans coordonnées
    await h.push(SPOTS.merbraine, { accuracy: 6 });
    await h.settle(20_000);
    await h.push(SPOTS.merbraine, { accuracy: 10 });
    await h.settle(5 * MIN);
    const pos = jr.of('positions');
    expect(pos.length).toBeGreaterThanOrEqual(1);
    for (const p of pos) expect(Object.keys(p.d ?? {}).sort()).toEqual(expect.arrayContaining(['gap', 'n']));
    expect(pos.some((p) => (p.d?.n as number) >= 2 && typeof p.d?.acc === 'number')).toBe(true);
    // arrivée, puis « Tu y es » touché : fin (done)
    const arrived = moment('arrived', 'arrived:j-bureau', NOW, NOW + 60 * MIN, { title: 'Bureau', at: NOW, diffMin: 0 });
    await says(h, { phase: { kind: 'arrived' }, moment: arrived });
    expect(jr.of('arrived')).toHaveLength(1);
    await h.gesture('tap');
    expect(h.c.followed).toBeNull();
    expect(jr.trips[0]).toMatchObject({ end: 'done', endedAt: expect.any(Number) });
    expect(jr.kinds().at(-1)).toBe('end');
    expect(jr.of('end').map((e) => e.d)).toEqual([{ end: 'done' }]);
    // toutes les sortes du contrat, et jamais de coordonnées, d'adresse ni de mesure du capteur
    expect(new Set(jr.kinds())).toEqual(
      new Set(['start', 'battery', 'moment', 'remind', 'seen', 'clear', 'boarded', 'alighted', 'passed', 'replan', 'check', 'fg', 'glasses', 'positions', 'arrived', 'end']),
    );
    const text = JSON.stringify(jr.trips);
    expect(text).not.toMatch(/"(lat|lon|lng|latitude|longitude|address|coords|x|y|z)"/);
    for (const v of [SPOTS.merbraine.lat, SPOTS.merbraine.lon, nord.lat, nord.lon, PLACES.bureau.kind === 'place' ? PLACES.bureau.lat : 0]) expect(text).not.toContain(String(v));
    expect(text).not.toMatch(/\b5\d\.\d{3}|\b4\.\d{3}/);
  });

  it('fin : arrêté (stopped), remplacé par un nouveau guidage (replaced), donnée par le moteur (ended)', async () => {
    const jr = memoryJournal();
    const { h } = await guided({ journal: jr });
    await h.c.stopGuide();
    expect(jr.trips[0]).toMatchObject({ end: 'stopped' });
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(jr.trips[1]).toMatchObject({ title: 'Bureau', kind: 'trip' });
    expect(jr.trips[1].end).toBeUndefined();
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(jr.trips[1]).toMatchObject({ end: 'replaced' });
    expect(jr.of('end', 1).map((e) => e.d)).toEqual([{ end: 'replaced' }]);
    await says(h, { ended: true });
    expect(jr.trips[2]).toMatchObject({ end: 'ended' });
    // chaque trajet n'a qu'une fin
    for (let i = 0; i < 3; i++) expect(jr.of('end', i)).toHaveLength(1);
  });

  it('repris à la réouverture : le même trajet du journal continue', async () => {
    const jr = memoryJournal();
    const { h } = await guided({ journal: jr });
    const kv = h.kv;
    const now = h.clock.now();
    h.c.stop();
    const h2 = await guideSetup({ settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }), stub: { answers }, kv, now: now + 10 * SEC });
    depsOf(h2).journal = jr.journal;
    expect(h2.c.followed?.guide?.journal).toBe('t1');
    await says(h2, { moment: boardM() });
    expect(jr.trips).toHaveLength(1);
    expect(jr.of('moment').map((e) => e.d)).toEqual([{ m: 'board', id: 'board:j-bureau:1' }]);
    await h2.c.stopGuide();
    expect(jr.trips[0]).toMatchObject({ end: 'stopped' });
  });

  it('sans journal : rien n’est noté, le guidage n’en garde aucun identifiant', async () => {
    const { h } = await guided();
    await says(h, { moment: boardM() });
    await h.settle(46_000);
    expect(h.c.followed?.guide?.journal).toBeUndefined();
    expect(parseTrip(await h.kv.get(TRIP_KEY))?.guide?.journal).toBeUndefined();
    expect(await h.kv.get('quai.journal')).toBeFalsy();
    await h.c.stopGuide();
  });

  it('trajet vers une adresse : le journal ne garde pas l’adresse dans le titre', async () => {
    const jr = memoryJournal();
    const h = await guideSetup({ settings: settingsWith([], { seenVersion: '1.3.0' }), stub: { plan: (now) => [door('j-adr', now + 2 * MIN, now + 40 * MIN)] } });
    depsOf(h).journal = jr.journal;
    await h.until((s) => s.screen === 'home');
    const to: Endpoint = { type: 'address', label: 'Place Flagey 18, 1050 Ixelles', lat: SPOTS.flagey.lat, lon: SPOTS.flagey.lon };
    await (h.c as unknown as { goTo(k: string, to: Endpoint, label: string): Promise<void> }).goTo('r1', to, 'Place Flagey 18');
    await h.until((s) => s.screen === 'steps' && s.lines.length > 0);
    await (h.c as unknown as { runIntent(i: { kind: 'goGuide' }): Promise<void> }).runIntent({ kind: 'goGuide' });
    await h.settle();
    expect(h.c.followed?.guide).toBeDefined();
    expect(jr.trips[0]?.title).toBe(ADDRESS_TITLE);
    expect(JSON.stringify(jr.trips)).not.toContain('Flagey');
  });
});
