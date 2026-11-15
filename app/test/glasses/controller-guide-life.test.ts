/**
 * Quai 1.2.10, contrôleur (PRD-1.2.10 § 3.7, § 4.3) : cycle de vie du guidage. Premier plan quitté : le guidage continue
 * (positions, minuterie, temps réel), seul l'affichage attend ; retour : la page du moment présent reconstruite. Boîte de
 * sortie (événements inversés, even-g2-notes), événements en double, lunettes reconnectées. Persistance (quai.trip au plus
 * toutes les 5 s, trajets gardés par la 1.2.9, guidage illisible), reprise après suspension ou page rechargée sans rejouer
 * les moments passés. Carte « En cours » du téléphone (guideStatus, onGuide).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Favorite, FavoriteAnswer, Journey, KV } from '../../src/core/api';
import type { GuideState, GuideStatus, Moment } from '../../src/core/guide-types';
import { TRIP_KEY, parseTrip, type FollowedTrip } from '../../src/glasses/controller';
import type { Intent } from '../../src/glasses/types';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { engine, moment, views, type Script } from './controller-guide-doubles';
import { NOW, SPOTS, cleanupKit, door, guideSetup, walkRouteOf, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, settingsWith } from './helpers';

const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)] }, updatedAt: now } : undefined;
const settings = (patch: Record<string, unknown> = {}) => settingsWith([PLACES.bureau], { seenVersion: '1.2.10', ...patch });
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const screensOf = (h: Kit) => h.c.state.nav.stack.map((f) => f.route.screen);

/** Stockage qui compte les écritures du trajet suivi. */
function countingKV(): KV & { tripWrites: string[] } {
  const kv = createKV(memoryBackend());
  const tripWrites: string[] = [];
  return {
    tripWrites,
    get: (k) => kv.get(k),
    set: (k, v) => {
      if (k === TRIP_KEY) tripWrites.push(v);
      return kv.set(k, v);
    },
  };
}

let out: Partial<GuideState> = {};
let cur: Moment | null = null;

async function guided(o: Partial<KitOptions> = {}, quiet = true): Promise<Kit> {
  const h = await guideSetup({ settings: settings(), stub: { answers }, ...o });
  await h.until(homeReady);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  if (quiet) await h.settle(15_500);
  return h;
}

beforeEach(() => {
  engine.reset();
  views.reset();
  out = {};
  cur = null;
  engine.script = (() => ({ ...out, moment: cur })) as Script;
});
afterEach(() => cleanupKit());

describe('PRD-1.2.10 § 3.7 : premier plan quitté, puis revenu', () => {
  it('le guidage continue (positions, minuterie, temps réel), rien n’est envoyé aux lunettes ; au retour, la page du moment présent est reconstruite', async () => {
    let refreshed = 0;
    out = { location: 'high' };
    const h = await guided({ coreExtra: () => ({ refresh: async (j: Journey) => (refreshed++, j) }) });
    const w = h.watching()!;
    await h.emit({ kind: 'background' });
    const n = h.calls.length;
    const steps = engine.calls.length;
    const r0 = refreshed;
    // une position, la minuterie, le temps réel : le moteur tourne
    await h.push(SPOTS.merbraine);
    expect(engine.calls.length).toBe(steps + 1);
    cur = moment('board', 'board:j-bureau:1', NOW, NOW + 60 * MIN);
    await h.settle(61_000);
    expect(engine.calls.length).toBeGreaterThan(steps + 1);
    expect(refreshed).toBeGreaterThan(r0);
    expect(w.stopped).toBe(false);
    // l'affichage attend
    expect(h.since(n)).toEqual([]);
    await h.emit({ kind: 'foreground' });
    const back = h.since(n);
    expect(back[0].op).toBe('rebuild');
    expect(back[1]).toMatchObject({ op: 'paint' });
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'board:j-bureau:1' });
  });

  it('reprise après une longue suspension : état recalculé, un moment déjà fini n’est pas montré', async () => {
    const h = await guided();
    const t0 = h.clock.now();
    engine.script = (input) => ({ moment: input.now > t0 + 2 * MIN && input.now < t0 + 5 * MIN ? moment('leave', 'leave:j-bureau', t0 + 2 * MIN, t0 + 5 * MIN) : null });
    await h.emit({ kind: 'background' });
    const n = h.calls.length;
    await h.settle(10 * MIN);
    expect(h.since(n)).toEqual([]);
    await h.emit({ kind: 'foreground' });
    expect(h.since(n)[0].op).toBe('rebuild');
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'empty' });
    expect(h.screens().some((s) => s.moment === 'leave:j-bureau')).toBe(false);
  });

  it('événements de cycle de vie en double (moins de 600 ms) : une seule reconstruction', async () => {
    const h = await guided();
    await h.emit({ kind: 'background' });
    await h.emit({ kind: 'background' });
    const n = h.calls.length;
    await h.emit({ kind: 'foreground' });
    await h.emit({ kind: 'foreground' });
    expect(h.since(n).filter((x) => x.op === 'rebuild')).toHaveLength(1);
    // plus tard, un nouveau passage compte de nouveau
    await h.settle(700);
    await h.emit({ kind: 'background' });
    await h.settle(700);
    const k = h.calls.length;
    await h.emit({ kind: 'foreground' });
    expect(h.since(k).filter((x) => x.op === 'rebuild')).toHaveLength(1);
  });
});

describe('even-g2-notes : boîte de sortie (événements inversés)', () => {
  it('« Non » : FOREGROUND_EXIT ne met pas l’appli en arrière-plan ; la page est reconstruite et suit le guidage', async () => {
    const h = await guided();
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home']);
    await h.gesture('double');
    expect(h.calls.at(-1)).toEqual({ op: 'exit', arg: 1 });
    let n = h.calls.length;
    // la boîte paraît : l'hôte a effacé la page, elle est reconstruite
    await h.emit({ kind: 'foreground' });
    expect(h.since(n).map((x) => x.op)).toContain('rebuild');
    n = h.calls.length;
    await h.emit({ kind: 'background' });
    expect(h.since(n).map((x) => x.op)).toContain('rebuild');
    // toujours au premier plan : « En cours » rouvre le guidage, qui s'affiche
    await intent(h, { kind: 'resume' });
    await h.settle();
    expect(h.last()).toMatchObject({ screen: 'guide' });
    cur = moment('board', 'board:j-bureau:1', NOW, NOW + 60 * MIN);
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment' });
  });

  it('« Oui » : SYSTEM_EXIT arrête tout (positions continues comprises) et ferme la page', async () => {
    out = { location: 'high' };
    const h = await guided();
    const w = h.watching()!;
    await h.gesture('double', 'double');
    await h.emit({ kind: 'foreground' });
    await h.emit({ kind: 'exit', abnormal: false });
    expect(h.closeWebView).toHaveBeenCalledTimes(1);
    expect(w.stopped).toBe(true);
    const n = engine.calls.length;
    await h.settle(120_000);
    expect(engine.calls.length).toBe(n);
  });

  it('pas de boîte dans les 3 s : un FOREGROUND_EXIT ensuite est un vrai passage en arrière-plan', async () => {
    const h = await guided();
    await h.gesture('double', 'double');
    await h.settle(3_500);
    await h.emit({ kind: 'background' });
    const n = h.calls.length;
    cur = moment('board', 'board:j-bureau:1', NOW, NOW + 60 * MIN);
    await h.settle(61_000);
    expect(h.since(n)).toEqual([]);
  });
});

describe('PRD-1.2.10 § 3.7 : lunettes reconnectées', () => {
  it('reconnectées (ou remises) : la page est reconstruite, images comprises ; un signal sans changement : rien', async () => {
    cur = moment('board', 'board:j-bureau:1', NOW, NOW + 60 * MIN);
    const h = await guided();
    let n = h.calls.length;
    // premier signal : la page est reconstruite une fois
    await h.emit({ kind: 'device', connected: true });
    expect(h.since(n).map((x) => x.op)).toEqual(['rebuild', 'paint']);
    n = h.calls.length;
    await h.emit({ kind: 'device', connected: true });
    expect(h.since(n)).toEqual([]);
    await h.emit({ kind: 'device', connected: false });
    expect(h.since(n)).toEqual([]);
    await h.emit({ kind: 'device', connected: true, wearing: true });
    expect(h.since(n).map((x) => x.op)).toEqual(['rebuild', 'paint']);
    n = h.calls.length;
    await h.emit({ kind: 'device', connected: true, wearing: false });
    await h.emit({ kind: 'device', connected: true, wearing: true });
    expect(h.since(n).map((x) => x.op)).toEqual(['rebuild', 'paint']);
    // en arrière-plan : la reconstruction attend le retour au premier plan
    await h.emit({ kind: 'device', connected: false });
    await h.emit({ kind: 'background' });
    n = h.calls.length;
    await h.emit({ kind: 'device', connected: true });
    expect(h.since(n)).toEqual([]);
  });
});

describe('PRD-1.2.10 § 3.7 : persistance et reprise', () => {
  it('quai.trip porte le guidage (genre, mémoire, chemin à pied) ; enregistré tout de suite au lancement, puis au plus toutes les 5 s', async () => {
    const kv = countingKV();
    out = { location: 'high' };
    const h = await guided({ kv, walkRoute: async (from, to) => walkRouteOf(from, to) }, false);
    expect(kv.tripWrites.length).toBeGreaterThanOrEqual(1);
    expect(parseTrip(kv.tripWrites[0])?.guide?.kind).toBe('trip');
    out = { location: 'high', needRoute: { leg: 0, from: SPOTS.flagey, to: SPOTS.merbraine } };
    await h.c.refreshCurrent();
    await h.settle();
    out = { location: 'high' };
    const saved = parseTrip(await h.kv.get(TRIP_KEY))!;
    expect(saved.guide).toMatchObject({ kind: 'trip', mem: { v: 1 }, walk: { leg: 0, journeyId: 'j-bureau', route: { source: 'osm' } } });
    // des moments à la suite (mémoire du moteur) : au plus une écriture toutes les 5 s
    const k = kv.tripWrites.length;
    for (let i = 0; i < 10; i++) {
      cur = moment('turn', `turn:j-bureau:0:${i}`, NOW, NOW + 60 * MIN, { turn: 'left', distM: 30 });
      await h.push(SPOTS.flagey);
      await h.settle(400);
    }
    expect(kv.tripWrites.length - k).toBeLessThanOrEqual(1);
    await h.settle(5_000);
    expect(kv.tripWrites.length - k).toBeLessThanOrEqual(2);
    const shown = Object.keys(parseTrip(kv.tripWrites.at(-1))!.guide!.mem.shown);
    expect(shown).toContain('turn:j-bureau:0:9');
  });

  it('arrêt de la page : un enregistrement en attente est fait tout de suite', async () => {
    const kv = countingKV();
    const h = await guided({ kv });
    cur = moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 60 * MIN, { turn: 'left', distM: 30 });
    await h.c.refreshCurrent();
    await h.settle(100);
    cur = moment('turn', 'turn:j-bureau:0:2', NOW, NOW + 60 * MIN, { turn: 'right', distM: 30 });
    await h.c.refreshCurrent();
    await h.settle(100);
    h.c.stop();
    await h.settle(10);
    expect(Object.keys(parseTrip(kv.tripWrites.at(-1))!.guide!.mem.shown)).toContain('turn:j-bureau:0:2');
  });

  it('page rechargée (téléphone verrouillé, Android) : le guidage reprend sur son écran, « Où tu en es » ; un moment effacé ne revient pas', async () => {
    const kv = createKV(memoryBackend());
    cur = moment('board', 'board:j-bureau:1', NOW, NOW + 60 * MIN);
    out = { location: 'high' };
    const a = await guided({ kv });
    expect(a.last().show).toBe('moment');
    await a.gesture('tap');
    expect(a.last().show).toBe('empty');
    await a.settle(6_000);
    a.c.stop();
    cleanupKit();
    engine.calls = [];
    // 10 min plus tard, dans le bus (loin du départ : la règle « pas parti » de la 1.2.x ne s'applique pas)
    const b = await guideSetup({ now: NOW + 10 * MIN, settings: settings(), stub: { answers }, kv, pos: SPOTS.central });
    await b.settle();
    expect(screensOf(b)).toEqual(['home', 'guide']);
    expect(b.last()).toMatchObject({ screen: 'guide', show: 'where' });
    expect(engine.calls[0].mem.dismissed).toEqual(['board:j-bureau:1']);
    expect(engine.calls[0].input.now).toBeGreaterThanOrEqual(NOW + 10 * MIN);
    // pas de message « Trajet en cours » sur l'écran calme ; positions continues reprises
    expect(b.last().lines.some((l) => l.startsWith('Trajet en cours'))).toBe(false);
    expect(b.watching()?.opts.accuracy).toBe('high');
    await b.settle(16_000);
    expect(b.last().show).toBe('empty');
  });

  it('état d’arrière-plan (instantané) : l’écran du guidage et son trajet sont repris ; le menu de Quai Web, non', async () => {
    const a = await guided({ web: true });
    await a.gesture('long');
    expect(screensOf(a)).toEqual(['home', 'guide', 'menu']);
    const snap = JSON.parse(JSON.stringify(a.c.snapshot()));
    a.c.stop();
    cleanupKit();
    const b = await guideSetup({ settings: settings(), stub: { answers }, web: true, kv: createKV(memoryBackend()) });
    b.c.restore(snap);
    await b.settle(100);
    expect(b.c.followed?.guide?.kind).toBe('trip');
    expect(screensOf(b)).toEqual(['home', 'guide']);
    expect(b.last().screen).toBe('guide');
  });

  it('trajet gardé par la 1.2.9 (sans guidage) : toujours suivi, pas guidé ; « En cours » ouvre ses étapes, « Dans le train » de la 1.2.9', async () => {
    const kv = createKV(memoryBackend());
    const j = door('j-129', NOW - 10 * MIN, NOW + 60 * MIN);
    const old = { v: 1, explicit: true, journey: j, title: 'Vers le bureau', favoriteId: 'fav-bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, origin: SPOTS.flagey, startedAt: NOW - 20 * MIN, leaveAt0: j.leaveAt, journeys: [j], index: 0, key: 'k-129' };
    await kv.set(TRIP_KEY, JSON.stringify(old));
    const h = await guideSetup({ settings: settings(), stub: { answers }, kv });
    await h.settle(200);
    expect(h.c.followed).toMatchObject({ journey: { id: 'j-129' }, key: 'k-129' });
    expect(h.c.followed!.guide).toBeUndefined();
    expect(engine.calls.every((c) => c.input.journey.id === 'j-129')).toBe(true);
    // ouverture : le trajet en cours, à l'écran de l'heure (dans le bus : « Dans le train »)
    expect(screensOf(h)).toEqual(['home', 'steps', 'train']);
    expect(h.watches).toHaveLength(0);
    expect(h.c.guideStatus()).toMatchObject({ kind: 'trip', title: 'Vers le bureau', guided: false });
  });

  it('guidage illisible : le trajet reste suivi sans guidage ; mémoire illisible : neuve ; chemin illisible : écarté', () => {
    const j = door('j-x', NOW, NOW + 60 * MIN);
    const base = { v: 1, explicit: true, journey: j, title: 'Vers le bureau', startedAt: NOW, leaveAt0: j.leaveAt, journeys: [j], index: 0, key: 'k' };
    expect(parseTrip(JSON.stringify({ ...base, guide: { kind: 'bateau' } }))?.guide).toBeUndefined();
    expect(parseTrip(JSON.stringify({ ...base, guide: 'oui' }))).toMatchObject({ journey: { id: 'j-x' } });
    const t = parseTrip(JSON.stringify({ ...base, guide: { kind: 'ride', mem: { v: 2 }, walk: { leg: 0, journeyId: 'j-x', route: { coords: [{ lat: 1 }] } } } }))!;
    expect(t.guide).toEqual({ kind: 'ride', mem: { v: 1, dismissed: [], shown: {} } });
    const route = walkRouteOf(SPOTS.flagey, SPOTS.merbraine);
    // la mémoire du moteur est gardée telle quelle, ses champs internes compris ; arrêts après la descente relus
    const mem = { v: 1, dismissed: ['a'], shown: { a: 1 }, jid: 'j-x', re: { reason: 'missed', jid: 'j-x', at: NOW } };
    const beyond = [{ name: { fr: 'Fragnée', nl: 'Fragnée' }, areaId: 'tec:Fragnee', sched: NOW, est: NOW }];
    const ok = parseTrip(JSON.stringify({ ...base, guide: { kind: 'ride', mem, walk: { leg: 0, journeyId: 'j-x', route, at: NOW }, beyond } }))!;
    expect(ok.guide).toEqual({ kind: 'ride', mem, walk: { leg: 0, journeyId: 'j-x', route, at: NOW }, beyond });
    const bad = parseTrip(JSON.stringify({ ...base, guide: { kind: 'trip', mem: { v: 1, dismissed: [], shown: {} }, beyond: [{ name: 'Fragnée' }] } }))!;
    expect(bad.guide?.beyond).toBeUndefined();
    // 1.2.9 : un trajet sans `guide` est relu tel quel
    const plain: FollowedTrip | null = parseTrip(JSON.stringify(base));
    expect(plain && 'guide' in plain).toBe(false);
  });
});

describe('PRD-1.2.10 § 4.3 : carte « En cours » du téléphone', () => {
  it('guideStatus : rien sans trajet suivi ; pendant un guidage : genre, titre, arrivée, « Maintenant » (guideNowText), guidé', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    expect(h.c.guideStatus()).toBeNull();
    out = { phase: { kind: 'walk', leg: 0 } };
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(h.c.guideStatus()).toEqual({ kind: 'trip', title: 'Vers le bureau', arr: NOW + 75 * MIN, now: 'walk j-bureau', guided: true });
    await h.settings.update((s) => ({ ...s, display: { ...s.display, guide: false } }));
    await h.settle();
    expect(h.c.guideStatus()?.guided).toBe(false);
  });

  it('onGuide : prévenu à chaque changement (lancement, étape, réglage, fin), jamais deux fois le même état ; désabonnement', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    const got: (GuideStatus | null)[] = [];
    const bad = vi.fn(() => {
      throw new Error('carte en panne');
    });
    const off = h.c.onGuide((s) => got.push(s));
    h.c.onGuide(bad);
    out = { phase: { kind: 'before', leg: 0 } };
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: 'Vers le bureau', now: 'before j-bureau', guided: true });
    await h.settle(61_000);
    expect(got).toHaveLength(1);
    out = { phase: { kind: 'walk', leg: 0 } };
    await h.c.refreshCurrent();
    await h.settle();
    expect(got.at(-1)?.now).toBe('walk j-bureau');
    await h.settings.update((s) => ({ ...s, display: { ...s.display, guide: false } }));
    await h.settle();
    expect(got.at(-1)?.guided).toBe(false);
    const n = got.length;
    await h.c.stopGuide();
    expect(got.length).toBe(n + 1);
    expect(got.at(-1)).toBeNull();
    expect(bad).toHaveBeenCalled();
    off();
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(got.length).toBe(n + 1);
  });

  it('trajet suivi sans guidage (bouton « Lunettes ») : « Maintenant » quand même, non guidé', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    const j = door('j-l', NOW + 5 * MIN, NOW + 60 * MIN);
    await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, result: { journeys: [j] }, index: 0 });
    await h.settle();
    expect(h.c.guideStatus()).toEqual({ kind: 'trip', title: 'Vers le bureau', arr: NOW + 60 * MIN, now: 'before j-l', guided: false });
  });
});
