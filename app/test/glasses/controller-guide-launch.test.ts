/**
 * Quai 1.2.10, contrôleur (PRD-1.2.10 § 3.1, § 3.5, § 4.2) : lancer le guidage de trois façons (« y aller » sur l'écran
 * du trajet, « j'y descends » dans les arrêts d'un départ, bouton « Y aller » du téléphone), un nouveau guidage qui
 * remplace l'ancien, et le réglage « Me guider pendant un trajet » éteint (suivi sans message ni écran automatique).
 * Les intentions sont celles que donnent les écrans (goGuide, alight) ; moteur et écrans du guidage : doubles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Departure, Favorite, FavoriteAnswer, Journey } from '../../src/core/api';
import { GUIDE_TEXT, TRIP_KEY, parseTrip } from '../../src/glasses/controller';
import type { Intent } from '../../src/glasses/types';
import { engine, moment, views } from './controller-guide-doubles';
import { NOW, busStops, cleanupKit, door, guideSetup, type Kit } from './controller-guide-kit';
import { MIN, PLACES, dep, nb, settingsWith } from './helpers';

const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN), door('j-bureau-2', NOW + 12 * MIN, NOW + 85 * MIN)] }, updatedAt: now } : undefined;

const settings = (patch: Record<string, unknown> = {}) => settingsWith([PLACES.bureau, PLACES.ecole], { seenVersion: '1.2.10', ...patch });
const off = () => settings({ display: { ...settingsWith([]).display, guide: false } });

/** L'intention telle que l'écran la donne (toucher sur l'écran du trajet, sur un arrêt). */
const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
/** Arrêts d'un départ chargés (le journal de l'écran compte ses arrêts). */
const stopsReady = (s: object) => typeof (s as { stops?: unknown }).stops === 'number';

/** Accueil, puis l'écran du trajet du premier favori (Bureau). */
async function openSteps(h: Kit) {
  await h.until(homeReady);
  await h.gesture('tap');
  return h.until((s) => s.screen === 'steps' && s.page !== undefined);
}

beforeEach(() => {
  engine.reset();
  views.reset();
});
afterEach(() => cleanupKit());

describe('PRD-1.2.10 § 3.1 : « y aller » sur l’écran du trajet', () => {
  it('la proposition affichée devient le trajet suivi et guidé ; l’écran du guidage s’ouvre sur « Où tu en es », effacé seul au bout de 15 s', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await openSteps(h);
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    const t = h.c.followed!;
    expect(t).toMatchObject({ explicit: true, title: 'Vers le bureau', favoriteId: 'fav-bureau', journey: { id: 'j-bureau' }, guide: { kind: 'trip', mem: { v: 1, dismissed: [] } } });
    expect(t.journeys.map((j) => j.id)).toEqual(['j-bureau', 'j-bureau-2']);
    expect(h.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
    // le moteur reçoit le trajet, son titre, le genre, l'heure du lancement, la position de départ et les réglages
    const input = engine.last().input;
    expect(input).toMatchObject({ kind: 'trip', title: 'Vers le bureau', journey: { id: 'j-bureau' } });
    expect(input.startedAt).toBeGreaterThanOrEqual(NOW);
    expect(input.origin).toBeDefined();
    expect(input.settings.v).toBe(4);
    // l'écran du guidage connaît le trajet guidé (ViewCtx.guidedJourneyId)
    expect(views.calls.at(-1)).toMatchObject({ show: 'where', journeyId: 'j-bureau', guided: 'j-bureau' });
    // gardé tout de suite (quai.trip), avec le guidage
    const saved = parseTrip(await h.kv.get(TRIP_KEY));
    expect(saved?.guide?.kind).toBe('trip');
    await h.settle(14_000);
    expect(h.last().show).toBe('where');
    await h.settle(1_200);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'empty' });
  });

  it('un moment dès le lancement passe avant « Où tu en es » (« Partir maintenant » si l’heure de partir est passée)', async () => {
    engine.script = (input) => ({ moment: moment('leave', `leave:${input.journey.id}`, input.now, input.now + 3 * MIN, { walkMin: 5, toward: { fr: 'Merbraine', nl: 'Merbraine' } }) });
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await openSteps(h);
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'moment', moment: 'leave:j-bureau' });
  });

  it('déjà guidé : « y aller » rouvre l’écran du guidage sans relancer (la mémoire du moteur reste)', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await openSteps(h);
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    const started = h.c.followed!.startedAt;
    const mem = h.c.followed!.guide!.mem;
    await h.gesture('double');
    expect(h.last().screen).toBe('home');
    await h.gesture('tap');
    await h.until((s) => s.screen === 'steps' || s.screen === 'guide');
    // le favori du trajet en cours rouvre directement le guidage
    expect(h.last().screen).toBe('guide');
    await h.gesture('double');
    await h.c.show({ screen: 'steps', key: h.c.followed!.key, label: '', title: 'Vers le bureau', journeys: h.c.followed!.journeys, index: 0 });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    expect(h.c.followed!.startedAt).toBe(started);
    expect(h.c.followed!.guide!.mem).toEqual(mem);
    expect(h.last().screen).toBe('guide');
  });

  it('proposition plus attrapable (le bus est parti) : propositions recalculées, la première est guidée', async () => {
    const late = door('j-late', NOW - 20 * MIN, NOW + 50 * MIN);
    const h = await guideSetup({ settings: settings(), stub: { plan: (now) => [door('j-fresh', now + 3 * MIN, now + 70 * MIN)] } });
    await h.c.show({ screen: 'steps', key: 'k-late', label: '', title: 'Vers le bureau', journeys: [late], index: 0, from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' } });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    expect(h.c.followed).toMatchObject({ journey: { id: 'j-fresh' }, guide: { kind: 'trip' } });
    expect(h.c.followed!.key).not.toBe('k-late');
  });

  it('« y aller » hors de l’écran d’un trajet, ou sans proposition : rien', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    await intent(h, { kind: 'goGuide' });
    await h.c.show({ screen: 'steps', key: 'k0', label: '', title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' } });
    await intent(h, { kind: 'goGuide' });
    expect(h.c.followed).toBeNull();
  });
});

describe('PRD-1.2.10 § 3.1 : « j’y descends » dans les arrêts d’un départ', () => {
  const bus = (now: number): Departure => dep(now, 4, { op: 'tec', mode: 'bus', line: '6', head: { fr: 'Gare des Guillemins', nl: 'Gare des Guillemins' }, tripId: 't6' });

  async function openStops(h: Kit) {
    const d = bus(NOW);
    await h.c.show({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: d });
    await h.until(stopsReady);
    return d;
  }

  it('le véhicule seul est guidé jusqu’à l’arrêt touché (rang dans les arrêts du départ) ; titre « Vers … »', async () => {
    const h = await guideSetup({ settings: settings(), stub: { departureStops: (_a, _d, now) => busStops(now), board: (id, now) => (id === 'tec:MonumentGramme' ? { area: { id, op: 'tec', n: { fr: 'Monument Gramme', nl: 'Monument Gramme' }, lat: 50.8, lon: 4.3, modes: ['bus'], lines: ['6'] }, departures: [bus(now)], anyPlanned: false, rtErrors: [], updatedAt: now } : undefined) } });
    await openStops(h);
    await intent(h, { kind: 'alight', index: 2 });
    await h.settle();
    expect(engine.rides).toHaveLength(1);
    expect(engine.rides[0]).toMatchObject({ board: 0, alight: 2, dep: { line: '6', tripId: 't6' } });
    const t = h.c.followed!;
    expect(t).toMatchObject({ title: 'Vers Gare des Guillemins', guide: { kind: 'ride' }, journey: { id: expect.stringMatching(/^ride:6:/) } });
    // la position de départ n'est pas celle du moment (on peut être déjà à bord) : arrêt de montée sans coordonnées
    expect(t.origin).toBeUndefined();
    expect(engine.last().input).toMatchObject({ kind: 'ride', title: 'Vers Gare des Guillemins' });
    expect(h.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
  });

  it('l’arrêt de la montée, un arrêt d’avant, un arrêt supprimé ou hors de la liste : rien', async () => {
    const h = await guideSetup({
      settings: settings(),
      stub: {
        departureStops: (_a, _d, now) => {
          const s = busStops(now);
          s.stops[3] = { ...s.stops[3], cancelled: true };
          return s;
        },
      },
    });
    await openStops(h);
    for (const index of [0, -1, 3, 9, 1.5]) await intent(h, { kind: 'alight', index });
    expect(engine.rides).toHaveLength(0);
    expect(h.c.followed).toBeNull();
    expect(h.logs.filter((l) => l.startsWith('QUAI_GESTURE j\'y descends sans effet')).length).toBe(5);
  });

  it('train : la gare du tableau est `at` dans tout son trajet ; les gares d’avant ne comptent pas', async () => {
    const train = (now: number): Departure => dep(now, 6, { op: 'sncb', mode: 'train', line: 'IC', head: { fr: 'Liège-Guillemins', nl: 'Luik-Guillemins' }, platform: '3' });
    const run = (now: number) => {
      const s = busStops(now);
      return { ...s, op: 'sncb' as const, mode: 'train' as const, line: 'IC', at: 1 };
    };
    const h = await guideSetup({ settings: settings(), stub: { departureStops: (_a, _d, now) => run(now) } });
    await h.c.show({ screen: 'stops', areaId: 'sncb:8814001', dep: train(NOW) });
    await h.until(stopsReady);
    await intent(h, { kind: 'alight', index: 1 });
    expect(engine.rides).toHaveLength(0);
    await intent(h, { kind: 'alight', index: 3 });
    await h.settle();
    expect(engine.rides[0]).toMatchObject({ board: 1, alight: 3 });
  });

  it('hors des arrêts d’un départ, ou arrêts pas encore chargés : rien', async () => {
    const h = await guideSetup({ settings: settings(), coreExtra: () => ({ departureStops: () => new Promise<never>(() => {}) }) });
    await h.until(homeReady);
    await intent(h, { kind: 'alight', index: 2 });
    await h.c.show({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: bus(NOW) });
    await intent(h, { kind: 'alight', index: 2 });
    expect(h.c.followed).toBeNull();
  });
});

describe('PRD-1.2.10 § 4.2 : bouton « Y aller » du téléphone (goFavorite)', () => {
  it('calcule le trajet du favori, le guide et ouvre l’écran du guidage ; message « Guidage lancé sur les lunettes »', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    const msg = await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(msg).toBe(GUIDE_TEXT.launched);
    expect(msg).toBe('Guidage lancé sur les lunettes');
    expect(h.c.followed).toMatchObject({ favoriteId: 'fav-bureau', title: 'Vers le bureau', journey: { id: 'j-bureau' }, guide: { kind: 'trip' }, from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' } });
    expect(h.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
  });

  it('réponse fraîche et attrapable : reprise telle quelle (pas de nouveau calcul)', async () => {
    let asked = 0;
    const counting = (fav: Favorite, now: number) => {
      asked++;
      return answers(fav, now);
    };
    const h = await guideSetup({ settings: settings(), stub: { answers: counting } });
    await h.until(homeReady);
    await h.settle(500);
    const before = asked;
    expect(before).toBeGreaterThan(0);
    await h.c.goFavorite('fav-bureau');
    expect(asked).toBe(before);
    expect(h.c.followed?.journey.id).toBe('j-bureau');
  });

  it('erreurs : favori inconnu, arrêt sans trajet, déjà sur place, sans position, aucun trajet, réseau', async () => {
    const stop: Favorite = { kind: 'stop', id: 'fav-arret', areaId: 'sncb:8814266', op: 'sncb', name: { fr: 'Braine-l’Alleud', nl: 'Eigenbrakel' }, lat: 50.68, lon: 4.37, propose: 'never' };
    let mode: 'here' | 'none' | 'noPosition' | 'down' = 'none';
    const ans = (fav: Favorite, now: number): FavoriteAnswer | undefined => {
      if (mode === 'down') throw new Error('Pas de réseau');
      return { favoriteId: fav.id, kind: 'trip', state: mode === 'none' ? 'none' : mode, plan: { journeys: [] }, updatedAt: now };
    };
    const h = await guideSetup({ settings: settingsWith([PLACES.bureau, stop], { seenVersion: '1.2.10' }), stub: { answers: ans }, pos: null });
    expect(await h.c.goFavorite('nope')).toBe(GUIDE_TEXT.noFavorite);
    // un arrêt favori d'avant la 1.2.2 est rangé dans « Gares » par les réglages : il n'est plus un favori
    expect(await h.c.goFavorite('fav-arret')).toBe(GUIDE_TEXT.noFavorite);
    // un lieu part de « Ma position » : sans position, rien à calculer
    expect(nb(await h.c.goFavorite('fav-bureau'))).toBe('Position inconnue : active la localisation');
    h.location.set({ lat: 50.8454, lon: 4.3571 });
    mode = 'noPosition';
    expect(nb(await h.c.goFavorite('fav-bureau'))).toBe('Position inconnue : active la localisation');
    mode = 'none';
    expect(await h.c.goFavorite('fav-bureau')).toBe(GUIDE_TEXT.noTrip);
    mode = 'down';
    expect(await h.c.goFavorite('fav-bureau')).toBe('Pas de réseau');
    mode = 'here';
    expect(nb(await h.c.goFavorite('fav-bureau'))).toBe('Tu es déjà au bureau.');
    // la réponse « tu y es » encore fraîche suffit
    expect(nb(await h.c.goFavorite('fav-bureau'))).toBe('Tu es déjà au bureau.');
    expect(h.c.followed).toBeNull();
  });
});

describe('PRD-1.2.10 § 3.1 : un nouveau guidage remplace le précédent', () => {
  it('nouvelle mémoire, ancien chemin et anciennes positions continues oubliés ; « où tu en es » de nouveau', async () => {
    engine.script = (input) => ({ location: input.kind === 'trip' ? 'high' : 'medium' });
    const h = await guideSetup({ settings: settings(), stub: { answers, departureStops: (_a, _d, now) => busStops(now) } });
    await openSteps(h);
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    const first = h.watching();
    expect(first?.opts.accuracy).toBe('high');
    await h.c.show({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: dep(NOW, 4, { op: 'tec', mode: 'bus', line: '6', head: { fr: 'Gare des Guillemins', nl: 'Gare des Guillemins' } }) });
    await h.until(stopsReady);
    await intent(h, { kind: 'alight', index: 1 });
    await h.settle();
    expect(h.c.followed).toMatchObject({ guide: { kind: 'ride', mem: { dismissed: [] } }, title: 'Vers Place Général Leman' });
    expect(first?.stopped).toBe(true);
    expect(h.watching()?.opts.accuracy).toBe('medium');
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
  });

  it('le bouton « Lunettes » du téléphone (trajet suivi sans guidage) remplace aussi un guidage', async () => {
    engine.script = () => ({ location: 'high' });
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    expect(h.watching()).toBeDefined();
    const j: Journey = door('j-other', NOW + 5 * MIN, NOW + 60 * MIN);
    await h.c.showTrip({ title: 'Vers l’école', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-ecole' }, result: { journeys: [j] }, index: 0 });
    await h.settle();
    expect(h.c.followed).toMatchObject({ journey: { id: 'j-other' } });
    expect(h.c.followed!.guide).toBeUndefined();
    expect(h.watching()).toBeUndefined();
    expect(h.last().screen).toBe('steps');
  });
});

describe('PRD-1.2.10 § 3.5 : réglage « Me guider pendant un trajet » éteint', () => {
  it('« y aller » fait suivre le trajet : « Trajet suivi », l’écran ne change pas, aucune position continue', async () => {
    engine.script = () => ({ location: 'high', moment: moment('board', 'board:x', NOW, NOW + 10 * MIN) });
    const h = await guideSetup({ settings: off(), stub: { answers } });
    await openSteps(h);
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    expect(h.c.followed?.guide?.kind).toBe('trip');
    expect(h.last().screen).toBe('steps');
    expect(nb(h.last().lines.at(-1)!)).toBe('Trajet suivi');
    expect(h.watches).toHaveLength(0);
    expect(views.calls).toHaveLength(0);
  });

  it('aucun écran ne change seul : pas de « Dans le train » au départ du bus ; « En cours » ouvre l’écran du trajet', async () => {
    const h = await guideSetup({ settings: off(), stub: { answers } });
    await openSteps(h);
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    // le bus part : 1.2.9 ouvrait « Dans le train » ; ici rien
    await h.settle(9 * MIN);
    await h.c.refreshCurrent();
    expect(h.screens().some((s) => s.screen === 'train' || s.screen === 'guide')).toBe(false);
    await h.gesture('double');
    const home = await h.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('En cours')));
    const i = home.lines.findIndex((l) => l.startsWith('En cours'));
    expect(i).toBeGreaterThanOrEqual(0);
    await intent(h, { kind: 'resume' });
    await h.settle();
    expect(h.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'steps']);
  });

  it('bouton « Y aller » : suivi, message « Trajet suivi sur les lunettes », l’écran des lunettes reste', async () => {
    const h = await guideSetup({ settings: off(), stub: { answers } });
    await h.until(homeReady);
    expect(await h.c.goFavorite('fav-bureau')).toBe(GUIDE_TEXT.followedPhone);
    await h.settle();
    expect(h.c.followed?.guide?.kind).toBe('trip');
    expect(h.last().screen).toBe('home');
  });

  it('réglage éteint pendant un guidage : l’écran du guidage laisse place à l’écran du trajet, positions arrêtées ; rallumé : elles reprennent', async () => {
    engine.script = () => ({ location: 'high' });
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    await h.c.goFavorite('fav-bureau');
    await h.settle();
    const w = h.watching();
    expect(w).toBeDefined();
    await h.settings.update((s) => ({ ...s, display: { ...s.display, guide: false } }));
    await h.settle(100);
    expect(w?.stopped).toBe(true);
    expect(h.c.state.nav.stack.map((f) => f.route.screen)).toEqual(['home', 'steps']);
    expect(h.last().screen).toBe('steps');
    await h.settings.update((s) => ({ ...s, display: { ...s.display, guide: true } }));
    await h.settle(100);
    expect(h.watching()?.opts.accuracy).toBe('high');
    // l'écran ne change pas seul ; « En cours » rouvre le guidage
    expect(h.last().screen).toBe('steps');
  });
});
