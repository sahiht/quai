/**
 * Quai 1.2.2, trajet suivi seulement sur demande (docs/v1.2.2/PRD-1.2.2.md § 6 ; CA-122.7) : ouvrir un favori, une
 * adresse ou un trajet ouvert d'office ne le suit pas ; un trajet gardé par la 1.2.1 (sans la marque `explicit`) n'est
 * pas « En cours ». 1.2.10 (docs/v1.2.10/PRD-1.2.10.md § 3.1, § 3.4, § 5) : « Suivre ce trajet » devient « y aller »
 * (toucher : intention goGuide, le guidage porte le trajet suivi) ; arrêter passe par l'appui long (« Arrêter le
 * guidage ») : l'écran du trajet guidé n'a plus d'action au toucher. Le lancement du guidage est éprouvé avec le
 * contrôleur (équipe C2).
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey } from '../../src/core/api';
import { TRIP_KEY, parseTrip } from '../../src/glasses/controller';
import { stepsPage, tapIntent } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { MIN, PLACES, at, journey, nb, settingsWith, setup, stubCore, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 31);

/** Trajet vers un lieu : 5 min à pied, bus W, 4 min à pied ; départ conseillé `leave`, arrivée `arr`. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5, to: 'Merbraine' }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Merbraine', to: 'Bruxelles Midi', head: 'Bruxelles Midi' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
}
function answers(fav: Favorite, now: number): FavoriteAnswer | undefined {
  const j = fav.id === 'fav-bureau' ? door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN) : fav.id === 'fav-ecole' ? door('j-ecole', NOW + 10 * MIN, NOW + 80 * MIN) : undefined;
  return j ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now } : undefined;
}
const steps = (s: Screen) => s.screen === 'steps' && s.page !== undefined;
const homeReady = (s: Screen) => s.screen === 'home' && s.shown?.length === 2 && !s.lines.some((l) => / …$/.test(l));
const open = (patch = {}, kv = createKV(memoryBackend())) =>
  setup({ now: NOW, kv, settings: settingsWith([PLACES.bureau, PLACES.ecole], { seenVersion: '1.3.1', ...patch }), core: (now) => stubCore(now, { answers }) });
const HINT_GO = '△▽ étapes   double : retour';

describe('CA-122.7 : un trajet n’est suivi que sur demande', () => {
  it('ouvrir un favori ne le suit pas : « Suivre ce trajet » ; au départ, pas de « En cours » ni de « Dans le train »', async () => {
    const h = await open();
    await h.until(homeReady);
    // 1.3.1 (PRD-1.3.1 § 8) : de « Autour de moi », « Favoris », puis le premier favori
    await h.gesture('down', 'down', 'tap');
    const s = await h.until(steps);
    expect(nb(s.title)).toBe('Bureau');
    expect(s).toMatchObject({ followed: false, sel: -1 });
    expect(s.lines[0]).toBe('Départ 07:33, dans 2 min   arrivée 08:46');
    expect(s.lines.at(-1)).toBe(HINT_GO);
    expect(h.c.followed).toBeNull();
    // l'heure du départ passe : rien ne se met à suivre tout seul
    h.advance(10 * MIN);
    await h.c.refreshCurrent();
    expect(h.screens().some((x) => x.screen === 'train')).toBe(false);
    await h.gesture('double');
    const home = await h.until((x) => x.screen === 'home');
    expect(home.lines[0]).not.toMatch(/^En cours/);
    expect(await h.kv.get(TRIP_KEY)).toBeNull();
    h.c.stop();
  });

  it('toucher sur l’écran du trajet : « y aller » (goGuide) ; trajet guidé : retour au guidage ; suivi sans guidage : « Ne plus suivre »', () => {
    const j = door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN);
    const c = { now: NOW, settings: settingsWith([PLACES.bureau]) };
    const open1 = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, c);
    expect(tapIntent(open1, 0)).toEqual({ kind: 'goGuide' });
    expect(open1.titleRight).toBeUndefined();
    const guided = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, { ...c, guidedJourneyId: 'j-bureau' });
    expect(tapIntent(guided, 0)).toEqual({ kind: 'resume' });
    expect(guided.mark).toBe(0);
    expect(guided.log).toMatchObject({ followed: true });
    const off = { ...c, guidedJourneyId: 'j-bureau', settings: settingsWith([PLACES.bureau], { display: { ...settingsWith([]).display, guide: false } }) };
    const followed = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, off);
    expect(tapIntent(followed, 0)).toEqual({ kind: 'open', route: { screen: 'followed' } });
    expect(nb(followed.hints)).toBe('△▽ étapes   double : retour');
  });

  it('sans aide des gestes (réglage) : aucune aide, le toucher lance toujours le guidage', async () => {
    const h = await open({ display: { ...settingsWith([]).display, gestureHints: false } });
    await h.until(homeReady);
    // 1.3.1 (§ 8) : de « Autour de moi », « Favoris », puis le premier favori
    await h.gesture('down', 'down', 'tap');
    const s = await h.until(steps);
    expect(nb(s.title)).toBe('Bureau');
    expect(s.lines.some((l) => l.startsWith('△▽'))).toBe(false);
    const c = { now: NOW, settings: settingsWith([PLACES.bureau], { display: { ...settingsWith([]).display, gestureHints: false } }) };
    const v = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [door('j', NOW + 2 * MIN, NOW + 75 * MIN)], index: 0, fresh: true }, c);
    expect(v.hints).toBe('');
    expect(v.tap).toEqual({ kind: 'goGuide' });
    h.c.stop();
  });

  it('un trajet gardé par la 1.2.1, sans la marque `explicit`, n’est pas « En cours » ; avec, il est repris', async () => {
    const j = door('j-old', NOW - 10 * MIN, NOW + 60 * MIN);
    const old = { v: 1, journey: j, title: 'Vers le bureau', favoriteId: 'fav-bureau', origin: { lat: 50.6, lon: 4.3 }, startedAt: NOW - 20 * MIN, leaveAt0: j.leaveAt, journeys: [j], index: 0, key: 'k-old' };
    expect(parseTrip(old)).toBeNull();
    const kv = createKV(memoryBackend());
    await kv.set(TRIP_KEY, JSON.stringify(old));
    const a = await open({}, kv);
    const s = await a.until((x) => x.screen === 'home' && x.lines.some((l) => l.startsWith('Autour de moi')));
    expect(s.lines[0]).not.toMatch(/^En cours/);
    expect(a.c.followed).toBeNull();
    a.c.stop();
    // le même, suivi sur demande par la 1.2.2 : repris à la réouverture
    await kv.set(TRIP_KEY, JSON.stringify({ ...old, explicit: true }));
    const b = await open({}, kv);
    const st = await b.until((x) => x.screen === 'steps' || x.screen === 'train');
    expect(st.lines.at(-1)).toBe('Trajet en cours : vers le bureau');
    expect(b.c.followed?.journey.id).toBe('j-old');
    b.c.stop();
  });

  it('« Toujours ouvrir le favori en tête » : ses étapes, pas suivies', async () => {
    const h = await open({ display: { ...settingsWith([]).display, opening: 'firstFavorite' } });
    const s = await h.until(steps);
    expect(s).toMatchObject({ followed: false });
    expect(nb(s.title)).toBe('Bureau');
    expect(s.lines.at(-1)).toBe(HINT_GO);
    expect(h.c.followed).toBeNull();
    h.c.stop();
  });

  it('le bouton « Lunettes » du téléphone reste une demande : le trajet est suivi, marqué `explicit`', async () => {
    const h = await open();
    await h.until(homeReady);
    const j = door('j-phone', NOW + 2 * MIN, NOW + 75 * MIN);
    expect(nb(await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, favoriteId: 'fav-bureau', result: { journeys: [j] }, index: 0 }))).toBe('Affiché dans les lunettes : Bus W 07:38.');
    const s = await h.until(steps);
    // suivi (guidé, écran calme allumé par défaut) : toucher revient au guidage
    expect(s).toMatchObject({ followed: true, sel: 0 });
    expect(nb(s.title)).toBe('Bureau');
    expect(s.lines.at(-1)).toBe('△▽ étapes   double : retour');
    await h.settle();
    expect(JSON.parse((await h.kv.get(TRIP_KEY))!).explicit).toBe(true);
    h.c.stop();
  });
});
