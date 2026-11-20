/**
 * Quai 1.3.1, pôle Guidage : l'écran calme vu du contrôleur (docs/v1.3.1/PRD-1.3.1.md § 1, § 12 B9, E1). Les vrais écrans
 * du guidage (glasses/guide-views.ts) avec le moteur double (controller-guide-doubles.ts) : « · · · » au pied en marchant,
 * la ligne de progression à bord ; rien n'est envoyé aux lunettes à cause d'eux (ni l'heure, ni le titre, ni une position
 * de plus), sauf au passage d'un arrêt : une seule mise à jour, celle du pied. Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);

import type { Departure, Favorite, FavoriteAnswer, Journey, Stopover } from '../../src/core/api';
import type { JournalEvent, TripJournal } from '../../src/core/journal-types';
import type { ControllerDeps } from '../../src/glasses/controller';
import type { GuideState, Moment, WhereAmI } from '../../src/core/guide-types';
import type { ContainerSpec } from '../../src/glasses/types';
import { engine, moment } from './controller-guide-doubles';
import { NOW, SPOTS, busStops, cleanupKit, door, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, dep, journey, nb, settingsWith } from './helpers';

const N = (fr: string) => ({ fr, nl: fr });
const settings = (gestureHints = true) => settingsWith([PLACES.bureau], { seenVersion: '1.3.0', display: { ...settingsWith([]).display, gestureHints } });
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));

/** Trajet guidé : 5 min à pied jusqu'à Merbraine, bus W avec ses six arrêts connus, 4 min à pied. */
function trip(): Journey {
  const j = door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN);
  const r = j.legs[1];
  const names = ['Merbraine', 'Place Communale', 'Rhode-Saint-Genèse', 'Uccle-Calevoet', 'Uccle-Stalle', 'Bruxelles Midi'];
  r.stops = names.map((n, i): Stopover => ({ name: N(n), sched: r.dep + i * 12 * MIN, est: r.dep + i * 12 * MIN }));
  r.arr = r.stops[5].est;
  r.schedArr = r.arr;
  return j;
}

let plan: Journey[] = [];
const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: plan }, updatedAt: now } : undefined;

/** Ce que le moteur double rend : l'étape (à bord : le prochain arrêt `next`) et le moment. */
let phase: GuideState['phase'] = { kind: 'walk', leg: 0 };
let current: Moment | null = null;

function rideWhere(next: number): NonNullable<WhereAmI['ride']> {
  const r = plan[0].legs[1];
  const stops = r.stops!;
  return { vehicle: { op: 'tec', mode: 'bus', line: 'W' }, head: N('Bruxelles Midi'), total: stops.length, next, nextStop: stops[next].name, nextAt: stops[next].est, alight: r.to.name, alightAt: r.arr, stopsToAlight: stops.length - next, rt: true };
}

async function guided(o: Partial<KitOptions> = {}): Promise<Kit> {
  const h = await guideSetup({ settings: settings(), stub: { answers }, ...o });
  await h.until(homeReady);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  // « Où tu en es » du lancement (15 s), puis l'écran calme
  await h.settle(15_500);
  return h;
}

/** Les envois aux lunettes depuis le rang `from` (pages, mises à jour, dessins). */
const sends = (h: Kit, from: number) => h.since(from).filter((c) => c.op === 'start' || c.op === 'rebuild' || c.op === 'upgrade' || c.op === 'paint');
const foot = (h: Kit): ContainerSpec => h.sent().find((c) => c.name === 'foot')!;

beforeEach(() => {
  engine.reset();
  plan = [trip()];
  phase = { kind: 'walk', leg: 0 };
  current = null;
  engine.script = () => ({ phase, moment: current, location: 'high', ...(phase.kind === 'ride' ? { where: { title: 'Bureau', arr: plan[0].arr, rt: true, chain: [], ride: rideWhere(phase.next) } } : {}) });
});
afterEach(() => cleanupKit());

describe('1.3.1, point 1 et B9 : l’écran calme du guidage, vu du contrôleur', () => {
  it('en marchant : « · · · » au pied, au plus pâle, centrés, sans titre ni heure ; positions et minutes passent : rien n’est envoyé', async () => {
    const h = await guided();
    const s = h.last();
    expect(s).toMatchObject({ screen: 'guide', show: 'empty', title: '', clock: '' });
    expect(s.lines.map(nb)).toEqual(['· · ·']);
    const f = foot(h);
    expect(f.level).toBe(2);
    expect(f.content.trim()).toBe('· · ·');
    // centré : des espaces de tête mesurées
    expect(f.content.startsWith(' ')).toBe(true);
    const n = h.calls.length;
    // 3 min de marche : une position toutes les 2 s, les minutes changent, le moteur recalcule
    for (let i = 0; i < 90; i++) {
      await h.push(SPOTS.merbraine, { speed: 1.3 });
      await h.settle(1_995);
    }
    expect(sends(h, n)).toEqual([]);
  });

  it('à bord : la progression remplace les points ; une seule mise à jour (le pied) au passage d’un arrêt, rien entre deux', async () => {
    phase = { kind: 'ride', leg: 1, next: 1 };
    const h = await guided();
    expect(nb(foot(h).content).trim()).toBe('●─◎─○─○─○─○   descente dans 5 arrêts');
    expect(h.last().lines.map(nb)).toEqual(['●─◎─○─○─○─○   descente dans 5 arrêts']);
    let n = h.calls.length;
    // 2 min entre deux arrêts : positions toutes les 2 s, recalculs à l'heure
    for (let i = 0; i < 60; i++) {
      await h.push(SPOTS.central, { speed: 12 });
      await h.settle(1_995);
    }
    expect(sends(h, n)).toEqual([]);
    // l'arrêt passé : la ligne avance, une mise à jour, celle du pied (ni page reconstruite, ni dessin)
    phase = { kind: 'ride', leg: 1, next: 2 };
    n = h.calls.length;
    await h.push(SPOTS.central, { speed: 12 });
    const out = sends(h, n);
    expect(out.map((c) => c.op)).toEqual(['upgrade']);
    expect((out[0].arg as ContainerSpec).name).toBe('foot');
    expect(nb(foot(h).content).trim()).toBe('●─●─◎─○─○─○   descente dans 4 arrêts');
    // sans position, à l'heure : rien jusqu'au prochain changement
    n = h.calls.length;
    await h.settle(5 * MIN);
    expect(sends(h, n)).toEqual([]);
  });

  it('« Descends au prochain arrêt » masqué : « descente au prochain arrêt » au pied', async () => {
    phase = { kind: 'ride', leg: 1, next: 5 };
    current = moment('alight', 'alight:j-bureau:1', NOW, NOW + 90 * MIN, { stop: N('Bruxelles Midi'), at: NOW + 70 * MIN, rt: true, then: { kind: 'walk', min: 4, toward: N('Bureau'), last: true } });
    const h = await guided();
    expect(h.last()).toMatchObject({ show: 'moment', moment: { kind: 'alight', id: 'alight:j-bureau:1' } });
    await h.settle(1_500);
    await h.gesture('tap');
    expect(h.last()).toMatchObject({ show: 'empty', title: '', clock: '' });
    expect(nb(foot(h).content).trim()).toBe('●─●─●─●─●─◎   descente au prochain arrêt');
  });

  it('aides des gestes éteintes : les points restent (ce n’est pas une aide) ; un moment ou « Où tu en es » les remplace', async () => {
    const h = await guided({ settings: settings(false) });
    expect(h.last().lines.map(nb)).toEqual(['· · ·']);
    await h.gesture('tap');
    expect(h.last().show).toBe('where');
    expect(h.last().lines.map(nb)).not.toContain('· · ·');
    current = moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 30 * MIN, { turn: 'left', distM: 40, toward: N('Merbraine'), final: false });
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.last().show).toBe('moment');
    expect(h.last().lines.map(nb)).not.toContain('· · ·');
    current = null;
    await h.c.refreshCurrent();
    await h.settle();
    expect(h.last().lines.map(nb)).toEqual(['· · ·']);
  });

  it('Quai Web : les mêmes points ; hors guidage, jamais', async () => {
    const h = await guided({ web: true });
    expect(h.last().lines.map(nb)).toEqual(['· · ·']);
    await h.gesture('double');
    const home = await h.until((x) => x.screen === 'home');
    expect(home.lines.map(nb)).not.toContain('· · ·');
  });

  it('trajet à pied seul : le menu envoyé et le journal QUAI_SCREEN n’ont que deux choix, sans « Voir les arrêts » (remarque 6)', async () => {
    plan = [journey('j-pied', [{ walk: 25, to: 'Bureau' }])];
    const h = await guided();
    expect(h.lastBuild()!.extra?.menu?.map((m) => m.label)).toEqual(['Voir tout le trajet', 'Arrêter le guidage']);
    expect((h.last() as unknown as { menu: { label: string }[] }).menu.map((m) => m.label)).toEqual(['Voir tout le trajet', 'Arrêter le guidage']);
    cleanupKit();
    plan = [trip()];
    const g = await guided();
    expect((g.last() as unknown as { menu: { label: string }[] }).menu.map((m) => m.label)).toEqual(['Voir tout le trajet', 'Voir les arrêts', 'Arrêter le guidage']);
  });

  it('« j’y descends » : « Jusqu’à … » sur l’écran, sur la carte « En cours » du téléphone et au journal (§ 12) ; le trajet suivi garde son nom', async () => {
    const bus = (now: number): Departure => dep(now, 4, { op: 'tec', mode: 'bus', line: '6', head: { fr: 'Gare des Guillemins', nl: 'Gare des Guillemins' }, tripId: 't6' });
    const trips: { title: string; kind: string; events: JournalEvent[] }[] = [];
    const journal: TripJournal = {
      begin(meta) {
        trips.push({ ...meta, events: [] });
        return `t${trips.length}`;
      },
      add: () => undefined,
      end: () => undefined,
      list: () => [],
      text: () => '',
      clear: () => undefined,
    };
    engine.script = () => ({ phase: { kind: 'ride', leg: 0, next: 1 }, moment: null, location: 'medium' });
    const h = await guideSetup({
      settings: settings(),
      stub: { departureStops: (_a, _d, now) => busStops(now), board: (id, now) => (id === 'tec:MonumentGramme' ? { area: { id, op: 'tec', n: N('Monument Gramme'), lat: 50.8, lon: 4.3, modes: ['bus'], lines: ['6'] }, departures: [bus(now)], anyPlanned: false, rtErrors: [], updatedAt: now } : undefined) },
    });
    (h.c as unknown as { d: ControllerDeps }).d.journal = journal;
    await h.c.show({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: bus(NOW) });
    await h.until((s) => typeof (s as { stops?: unknown }).stops === 'number');
    await (h.c as unknown as { runIntent(i: { kind: 'alight'; index: number }): Promise<void> }).runIntent({ kind: 'alight', index: 2 });
    await h.settle();
    expect(h.c.followed).toMatchObject({ title: 'Vers Gare des Guillemins', guide: { kind: 'ride' } });
    // l'écran : « Guidage en cours », puis « Jusqu’à … » ; le moteur, la carte « En cours » et le journal : le même titre
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where', title: 'Guidage en cours' });
    expect(h.last().lines[0]).toBe('Jusqu’à Gare des Guillemins');
    expect(engine.last().input.title).toBe('Jusqu’à Gare des Guillemins');
    expect(h.c.guideStatus()).toMatchObject({ kind: 'ride', title: 'Jusqu’à Gare des Guillemins' });
    expect(trips).toEqual([{ title: 'Jusqu’à Gare des Guillemins', kind: 'ride', at: expect.any(Number), events: [] }]);
  });
});
