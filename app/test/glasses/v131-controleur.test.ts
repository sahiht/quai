/**
 * Quai 1.3.1, pôle Guidage, contrôleur (docs/v1.3.1/PRD-1.3.1.md § 12) : A1 (les six messages importants ramènent
 * l'écran du guidage), A7 (un toucher ne masque qu'un message affiché depuis 1,5 s), B10 (menu de l'appui long : « Voir
 * tout le trajet », « Voir les arrêts », « Arrêter le guidage » en dernier), B16 et A3 (départ suivant donné au moteur :
 * GuideInput.nextByLeg). Le moteur et les écrans du guidage sont les doubles de controller-guide-doubles.ts. Lieux
 * publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Board, Departure, Favorite, FavoriteAnswer, Journey, LineFilter } from '../../src/core/api';
import type { GuideState, Moment } from '../../src/core/guide-types';
import { GlassesController, TAP_MASK_AFTER_MS, nextOfFirst } from '../../src/glasses/controller';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { engine, moment, views } from './controller-guide-doubles';
import { NOW, cleanupKit, door, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, boardOf, dep, journey, settingsWith } from './helpers';

const N = (fr: string) => ({ fr, nl: fr });
const settings = (guide = true) => settingsWith([PLACES.bureau], { seenVersion: '1.3.1', display: { ...settingsWith([]).display, guide } });
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
const screensOf = (h: Kit) => h.c.state.nav.stack.map((f) => f.route.screen);

/** Les trajets proposés pour le favori « Bureau » (le premier est guidé). */
let plan: Journey[] = [];
const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: plan }, updatedAt: now } : undefined;

/** Le moment et l'étape que le moteur double rend, modifiables pendant le test. */
let current: Moment | null = null;
let phase: GuideState['phase'] = { kind: 'before', leg: 0 };

async function guided(o: Partial<KitOptions> = {}, quiet = true): Promise<Kit> {
  const h = await guideSetup({ settings: settings(), ...o, stub: { answers, ...o.stub } });
  await h.until(homeReady);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  if (quiet) await h.settle(15_500);
  return h;
}

async function show(h: Kit, m: Moment | null): Promise<void> {
  current = m;
  await h.c.refreshCurrent();
  await h.settle();
}

beforeEach(() => {
  engine.reset();
  views.reset();
  current = null;
  phase = { kind: 'before', leg: 0 };
  plan = [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)];
  engine.script = () => ({ moment: current, phase });
});
afterEach(() => cleanupKit());

const board = () => moment('board', 'board:j-bureau:1', NOW, NOW + 30 * MIN, { vehicle: { line: 'W' } });
const alight = () => moment('alight', 'alight:j-bureau:1', NOW, NOW + 30 * MIN);

describe('1.3.1, A1 (E2) : les six messages importants ramènent l’écran du guidage', () => {
  it('depuis l’accueil : « monter » ramène le guidage (l’accueil dessous) ; double toucher : l’accueil, le même message ne ramène plus ; le suivant, oui', async () => {
    const h = await guided();
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home']);
    await show(h, board());
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'board:j-bureau:1' });
    expect(h.logs).toContain('QUAI_GUIDE retour à l’écran du guidage depuis home : board');
    // l'accueil choisi : le même message, encore là, ne le ramène pas
    await h.gesture('double');
    await h.c.refreshCurrent();
    await h.settle(61_000);
    expect(screensOf(h)).toEqual(['home']);
    // « Descends au prochain arrêt » : de nouveau
    await show(h, alight());
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'alight:j-bureau:1' });
  });

  it('chacun des six (partir, monter, voie modifiée, descendre, imprévu, arrêt dépassé) ; virage, prochain arrêt, « Tu y es », vérification : non', async () => {
    const h = await guided();
    const kinds: [Moment['kind'], boolean][] = [
      ['turn', false],
      ['nextStop', false],
      ['arrived', false],
      ['check', false],
      ['walk', false],
      ['offMap', false],
      ['leave', true],
      ['board', true],
      ['platform', true],
      ['alight', true],
      ['replan', true],
      ['passed', true],
    ];
    for (const [kind, back] of kinds) {
      await h.gesture('double');
      expect(screensOf(h)).toEqual(['home']);
      await show(h, moment(kind, `${kind}:j-bureau:x`, NOW, NOW + 90 * MIN));
      expect(screensOf(h), kind).toEqual(back ? ['home', 'guide'] : ['home']);
    }
  });

  it('depuis l’écran du trajet (« Voir tout le trajet ») et depuis « Dans le train » (« Voir les arrêts ») : le guidage', async () => {
    phase = { kind: 'ride', leg: 1, next: 1 };
    const h = await guided();
    await h.emit({ kind: 'menu', id: 2 });
    expect(screensOf(h)).toEqual(['home', 'guide', 'steps']);
    await show(h, alight());
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment' });
    await h.gesture('double');
    await show(h, null);
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    await h.emit({ kind: 'menu', id: 3 });
    expect(screensOf(h)).toEqual(['home', 'guide', 'train']);
    await show(h, moment('passed', 'passed:j-bureau:1', NOW, NOW + 3 * MIN));
    expect(screensOf(h)).toEqual(['home', 'guide']);
  });

  it('Quai Web : depuis l’écran du menu, le guidage ; réglage « Me guider » éteint : rien ne change d’écran', async () => {
    const h = await guided({ web: true });
    await h.gesture('long');
    expect(screensOf(h)).toEqual(['home', 'guide', 'menu']);
    await show(h, board());
    expect(screensOf(h)).toEqual(['home', 'guide']);
    cleanupKit();
    views.reset();
    // contrôle qualité : le message de la première moitié ne doit pas déjà être là au lancement (il serait compté avant
    // la mesure de `before`, et le test passerait sans la condition du réglage)
    current = null;
    const off = await guided({ settings: settings(false) });
    const before = screensOf(off);
    expect(before).toEqual(['home']);
    await show(off, board());
    expect(screensOf(off)).toEqual(before);
    expect(views.calls.filter((c) => c.show === 'moment')).toEqual([]);
  });

  it('contrôle qualité : instantané repris (téléphone verrouillé, nouvelle WebView), après ou avant le démarrage : le message arrivé pendant la reprise ramène le guidage sur l’écran repris', async () => {
    const a = await guided();
    await a.gesture('double');
    expect(screensOf(a)).toEqual(['home']);
    const snap = JSON.parse(JSON.stringify(a.c.snapshot()));
    cleanupKit();
    // reprise après le démarrage de la nouvelle WebView (__restoreState appelé une fois le contrôleur prêt)
    const b = await guideSetup({ settings: settings(), stub: { answers }, kv: createKV(memoryBackend()) });
    current = board();
    b.c.restore(snap);
    await b.settle(100);
    expect(screensOf(b)).toEqual(['home', 'guide']);
    expect(b.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'board:j-bureau:1' });
    cleanupKit();
    // reprise avant le démarrage (main.ts : restore, puis start)
    current = null;
    const start = GlassesController.prototype.start;
    const spy = vi.spyOn(GlassesController.prototype, 'start').mockImplementationOnce(async function (this: GlassesController) {
      current = alight();
      this.restore(snap);
      return start.call(this);
    });
    const c = await guideSetup({ settings: settings(), stub: { answers }, kv: createKV(memoryBackend()) });
    spy.mockRestore();
    await c.settle(100);
    expect(screensOf(c)).toEqual(['home', 'guide']);
    expect(c.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'alight:j-bureau:1' });
    expect(c.logs).toContain('QUAI_GUIDE retour à l’écran du guidage depuis home : alight');
    expect(c.logs.filter((l) => l.startsWith('QUAI_GUIDE retour'))).toHaveLength(1);
  });
});

describe('1.3.1, A7 (E3) : un toucher ne masque qu’un message affiché depuis au moins 1,5 s', () => {
  it('toucher aussitôt : rien (le message reste, pas masqué) ; 1,5 s après : masqué', async () => {
    expect(TAP_MASK_AFTER_MS).toBe(1_500);
    const h = await guided();
    await show(h, board());
    await h.gesture('tap');
    expect(engine.dismissed).toEqual([]);
    expect(h.last()).toMatchObject({ show: 'moment', moment: 'board:j-bureau:1' });
    expect(h.logs).toContain('QUAI_GESTURE toucher sans effet : board affiché depuis moins de 1,5 s');
    await h.settle(1_500);
    await h.gesture('tap');
    expect(engine.dismissed).toEqual(['board:j-bureau:1']);
    expect(h.last().show).toBe('empty');
  });

  it('« Où tu en es » à l’écran, « Descends » arrive juste avant le toucher : « Descends » reste (pas masqué sans être lu), « Où tu en es » part', async () => {
    const h = await guided();
    await h.gesture('tap');
    expect(h.last().show).toBe('where');
    // le moteur a déjà « Descends » quand le toucher arrive (pas encore affiché)
    current = alight();
    await h.gesture('tap');
    expect(engine.dismissed).toEqual([]);
    expect(h.last()).toMatchObject({ show: 'moment', moment: 'alight:j-bureau:1' });
    // vu, puis masqué
    await h.settle(1_600);
    await h.gesture('tap');
    expect(engine.dismissed).toEqual(['alight:j-bureau:1']);
    expect(h.last().show).toBe('empty');
  });

  it('« Tu y es » touché trop tôt : le guidage continue ; 1,5 s après : terminé', async () => {
    const h = await guided();
    await show(h, moment('arrived', 'arrived:j-bureau', NOW, NOW + 2 * MIN, { title: 'Vers le bureau', at: NOW, diffMin: 0 }));
    await h.gesture('tap');
    expect(h.c.followed).not.toBeNull();
    await h.settle(1_500);
    await h.gesture('tap');
    expect(h.c.followed).toBeNull();
  });

  it('un rappel (page renvoyée) ne remet pas l’attente à zéro', async () => {
    const h = await guided();
    await show(h, board());
    await h.settle(1_500);
    await h.c.render(true);
    await h.settle();
    await h.gesture('tap');
    expect(engine.dismissed).toEqual(['board:j-bureau:1']);
  });
});

describe('1.3.1, B10 (E4) : menu de l’appui long', () => {
  it('appli Even : « Voir les arrêts » ouvre « Dans le train » du véhicule en cours ; double toucher : le guidage', async () => {
    phase = { kind: 'ride', leg: 1, next: 1 };
    const h = await guided();
    expect(h.lastBuild()!.extra?.menu?.map((m) => m.label)).toEqual(['Voir tout le trajet', 'Voir les arrêts', 'Arrêter le guidage']);
    await h.emit({ kind: 'menu', id: 3 });
    expect(screensOf(h)).toEqual(['home', 'guide', 'train']);
    const r = h.c.state.nav.stack[2].route as { screen: 'train'; leg: number; journey: Journey };
    expect(r.leg).toBe(1);
    expect(r.journey.id).toBe('j-bureau');
    const s = await h.until((x) => x.screen === 'train');
    expect(s.screen).toBe('train');
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home', 'guide']);
  });

  it('en marchant vers l’arrêt : le véhicule à prendre ; Quai Web : 2e choix, « Dans le train » à la place du menu', async () => {
    phase = { kind: 'walk', leg: 0 };
    const h = await guided({ web: true });
    await h.gesture('long');
    expect(h.last().lines.slice(0, 3)).toEqual(['Voir tout le trajet', 'Voir les arrêts', 'Arrêter le guidage']);
    await h.gesture('down', 'tap');
    expect(screensOf(h)).toEqual(['home', 'guide', 'train']);
    expect((h.c.state.nav.stack[2].route as { leg: number }).leg).toBe(1);
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home', 'guide']);
  });

  it('trajet à pied seul : pas de « Voir les arrêts » (menu système et écran du menu) ; le choix 3 ne fait rien', async () => {
    plan = [journey('j-pied', [{ walk: 25, to: 'Bureau' }])];
    const h = await guided();
    expect(h.lastBuild()!.extra?.menu?.map((m) => m.id)).toEqual([2, 1]);
    await h.emit({ kind: 'menu', id: 3 });
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.logs).toContain('QUAI_GESTURE voir les arrêts sans véhicule');
    cleanupKit();
    const w = await guided({ web: true });
    await w.gesture('long');
    expect(w.last().lines.slice(0, 2)).toEqual(['Voir tout le trajet', 'Arrêter le guidage']);
  });
});

describe('1.3.1, B16 (U4) et A3 (I1) : le départ suivant donné au moteur (GuideInput.nextByLeg)', () => {
  /** Bus W jusqu'à Gare Centrale (arrivée +20), 1 min à pied, tram 3 à +22 : très juste. */
  function tight(): Journey {
    const j = journey('j-juste', [
      { walk: 3, to: 'Merbraine' },
      { ride: 'W', mode: 'bus', dep: NOW + 5 * MIN, arr: NOW + 20 * MIN, from: 'Merbraine', to: 'Gare Centrale', head: 'Bruxelles Midi' },
      { walk: 1, to: 'Gare Centrale' },
      { ride: '3', mode: 'tram', dep: NOW + 22 * MIN, arr: NOW + 40 * MIN, from: 'Gare Centrale', to: 'Churchill', head: 'Churchill' },
      { walk: 4 },
    ]);
    j.legs[3].from.areaId = 'stib:1180';
    j.legs[3].op = 'stib';
    return j;
  }
  const tramBoard = () =>
    boardOf('stib:1180', 'Gare Centrale', [
      dep(NOW, 22, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') }),
      dep(NOW, 26, { op: 'stib', mode: 'tram', line: '4', head: N('Stalle') }),
      dep(NOW, 31, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), rt: false }),
      dep(NOW, 29, { op: 'stib', mode: 'tram', line: '3', head: N('Esplanade') }),
    ]);

  it('correspondance très juste : le tableau de son arrêt lu une fois ; le suivant de la même ligne, même destination', async () => {
    plan = [tight()];
    engine.tight = [3];
    const calls: string[] = [];
    const h = await guided({ stub: { calls, board: (id) => (id === 'stib:1180' ? tramBoard() : undefined) } });
    await h.settle(2 * MIN);
    expect(calls.filter((c) => c === 'board:stib:1180')).toHaveLength(1);
    const input = engine.last().input;
    expect(input.nextByLeg?.[3]).toEqual({ vehicle: { op: 'stib', mode: 'tram', line: '3' }, depAt: NOW + 31 * MIN, rt: false });
  });

  /**
   * Contrôle qualité (B16, remarque 3) : un arrêt chargé, comme le tableau du cœur : seulement les départs du filtre
   * demandé (ligne, et destination par son nom français ou néerlandais), puis les `limit` premiers.
   */
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
  function busyBoard(id: string, name: string, all: Departure[], asked: (LineFilter[] | undefined)[]) {
    return (areaId: string, _now: number, opts?: { limit?: number; horizonMin?: number }): Board | undefined => {
      if (areaId !== id) return undefined;
      const filter = (opts as { filter?: LineFilter[] } | undefined)?.filter;
      asked.push(filter);
      const ok = (d: Departure) => !filter?.length || filter.some((f) => f.line === d.line && [d.head.fr, d.head.nl].some((h) => norm(h) === norm(f.head)));
      return boardOf(id, name, all.filter(ok).sort((a, b) => a.est - b.est).slice(0, opts?.limit ?? 40));
    };
  }
  /** 70 départs d'autres lignes dans les 14 premières minutes, avant la correspondance et la suivante. */
  const crowd = (op: Departure['op'], mode: Departure['mode']): Departure[] =>
    Array.from({ length: 70 }, (_, i) => dep(NOW, 1 + Math.floor(i / 5), { op, mode, line: String(90 + (i % 5)), head: N(`Terminus ${i % 5}`) }));

  it('arrêt chargé (plus de 40 départs avant le suivant) : le tableau est lu pour la seule ligne de la correspondance, le suivant trouvé', async () => {
    plan = [tight()];
    engine.tight = [3];
    const asked: (LineFilter[] | undefined)[] = [];
    const all = [...crowd('stib', 'bus'), dep(NOW, 22, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') }), dep(NOW, 29, { op: 'stib', mode: 'tram', line: '3', head: N('Esplanade') }), dep(NOW, 34, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') })];
    await guided({ stub: { board: busyBoard('stib:1180', 'Gare Centrale', all, asked) } });
    expect(asked).toEqual([[{ line: '3', head: 'Churchill' }]]);
    expect(engine.last().input.nextByLeg?.[3]).toEqual({ vehicle: { op: 'stib', mode: 'tram', line: '3' }, depAt: NOW + 34 * MIN, rt: true });
  });

  it('De Lijn : la destination demandée sous ses deux noms (« Gare d’Alost », « Aalst Station ») ; trouvée même écrite en néerlandais seul', async () => {
    const j = tight();
    const l = j.legs[3];
    Object.assign(l, { op: 'delijn', mode: 'bus', line: '58', head: { fr: 'Gare d’Alost', nl: 'Aalst Station' } });
    l.from.areaId = 'delijn:200001';
    plan = [j];
    engine.tight = [3];
    const asked: (LineFilter[] | undefined)[] = [];
    const aalst = { fr: 'Aalst Station', nl: 'Aalst Station' };
    const all = [...crowd('delijn', 'bus'), dep(NOW, 22, { op: 'delijn', mode: 'bus', line: '58', head: aalst }), dep(NOW, 52, { op: 'delijn', mode: 'bus', line: '58', head: aalst, rt: false })];
    await guided({ stub: { board: busyBoard('delijn:200001', 'Gare Centrale', all, asked) } });
    expect(asked).toEqual([[{ line: '58', head: 'Gare d’Alost' }, { line: '58', head: 'Aalst Station' }]]);
    expect(engine.last().input.nextByLeg?.[3]).toEqual({ vehicle: { op: 'delijn', mode: 'bus', line: '58' }, depAt: NOW + 52 * MIN, rt: false });
  });

  it('pas très juste : aucune requête de plus ; très juste mais dans plus d’une heure : pas encore', async () => {
    plan = [tight()];
    const calls: string[] = [];
    const h = await guided({ stub: { calls, board: (id) => (id === 'stib:1180' ? tramBoard() : undefined) } });
    await h.settle(MIN);
    expect(calls.filter((c) => c.startsWith('board:'))).toEqual([]);
    expect(engine.last().input.nextByLeg?.[3]).toBeUndefined();
    cleanupKit();
    engine.reset();
    engine.script = () => ({ moment: current, phase });
    const later = tight();
    for (const l of later.legs) {
      l.dep += 2 * 60 * MIN;
      l.arr += 2 * 60 * MIN;
      l.schedDep += 2 * 60 * MIN;
      l.schedArr += 2 * 60 * MIN;
    }
    later.dep += 2 * 60 * MIN;
    later.arr += 2 * 60 * MIN;
    later.leaveAt += 2 * 60 * MIN;
    plan = [later];
    engine.tight = [3];
    const calls2: string[] = [];
    const g = await guided({ stub: { calls: calls2, board: () => undefined } });
    await g.settle(MIN);
    expect(calls2.filter((c) => c.startsWith('board:'))).toEqual([]);
  });

  it('contrôle qualité : ligne à l’heure, tableau lu une heure avant : le passage suivant, une heure après la correspondance ; une autre ligne vers la même destination ne compte pas', async () => {
    // bus 4 jusqu'à Monument Gramme (arrivée +56), 1 min à pied, bus 6 à +58 : très juste ; le bus 6 suivant à +118
    const j = journey('j-heure', [
      { walk: 3, to: 'Place Général Leman' },
      { ride: '4', mode: 'bus', dep: NOW + 41 * MIN, arr: NOW + 56 * MIN, from: 'Place Général Leman', to: 'Monument Gramme', head: 'Monument Gramme' },
      { walk: 1, to: 'Monument Gramme' },
      { ride: '6', mode: 'bus', dep: NOW + 58 * MIN, arr: NOW + 70 * MIN, from: 'Monument Gramme', to: 'Gare des Guillemins', head: 'Gare des Guillemins' },
      { walk: 4 },
    ]);
    j.legs[3].from.areaId = 'tec:gramme';
    plan = [j];
    engine.tight = [3];
    const calls: string[] = [];
    const guillemins = N('Gare des Guillemins');
    // comme le cœur (core/boards.ts, withinUntil) : seulement les départs de l'horizon demandé
    const hourly = (now: number, horizonMin = 120) =>
      boardOf('tec:gramme', 'Monument Gramme', [
        dep(NOW, 58, { line: '6', head: guillemins }),
        dep(NOW, 70, { line: '9', head: guillemins }),
        dep(NOW, 118, { line: '6', head: guillemins, rt: false }),
      ].filter((d) => d.est <= now + horizonMin * MIN));
    const h = await guided({ stub: { calls, board: (id, now, o) => (id === 'tec:gramme' ? hourly(now, o?.horizonMin) : undefined) } });
    await h.settle(MIN);
    expect(calls.filter((c) => c === 'board:tec:gramme')).toHaveLength(1);
    expect(engine.last().input.nextByLeg?.[3]).toEqual({ vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: NOW + 118 * MIN, rt: false });
  });

  it('premier véhicule : le plus tôt des autres trajets proposés depuis le même arrêt', async () => {
    plan = [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN), door('j-plus-tard', NOW + 22 * MIN, NOW + 95 * MIN), door('j-suivant', NOW + 12 * MIN, NOW + 85 * MIN)];
    const h = await guided();
    expect(h.c.followed?.journey.id).toBe('j-bureau');
    const input = engine.last().input;
    // bus W des autres trajets : départs à +17 et +27 (5 min de marche avant) ; le plus tôt
    expect(input.nextByLeg?.[1]).toMatchObject({ vehicle: { op: 'tec', mode: 'bus', line: 'W' }, depAt: NOW + 17 * MIN, rt: true });
  });

  it('nextOfFirst : même arrêt seulement, plus tard seulement, rien de supprimé', () => {
    const a = door('a', NOW, NOW + 60 * MIN);
    const b = door('b', NOW + 10 * MIN, NOW + 70 * MIN);
    const c = door('c', NOW + 5 * MIN, NOW + 65 * MIN);
    c.legs[1].cancelled = true;
    const d = door('d', NOW + 3 * MIN, NOW + 63 * MIN);
    d.legs[1].from = { ...d.legs[1].from, name: N('Autre arrêt') };
    expect(nextOfFirst(a, [a, b, c, d])).toEqual({ leg: 1, next: { vehicle: { op: 'tec', mode: 'bus', line: 'W' }, depAt: NOW + 15 * MIN, rt: true } });
    expect(nextOfFirst(a, [a])).toBeUndefined();
    expect(nextOfFirst(b, [a, b])).toBeUndefined();
  });
});
