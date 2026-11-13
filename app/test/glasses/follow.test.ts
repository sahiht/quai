/**
 * Quai 1.2.2, trajet suivi seulement sur demande (docs/v1.2.2/PRD-1.2.2.md § 6 ; CA-122.7) : ouvrir un favori, une
 * adresse ou un trajet ouvert d'office ne le suit pas ; « Suivre ce trajet » le suit (la 1re proposition comprise) ;
 * l'écran le dit (« Suivi » sur la ligne du titre), même sans l'aide des gestes ; sur le trajet suivi, toucher propose
 * « Ne plus suivre » ; un trajet gardé par la 1.2.1 (sans la marque `explicit`) n'est pas « En cours ».
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey } from '../../src/core/api';
import { TRIP_KEY, parseTrip } from '../../src/glasses/controller';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { MIN, PLACES, at, journey, nb, settingsWith, setup, stubCore, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 7, 31);

/** Trajet vers un lieu : 5 min à pied, bus W, 4 min à pied ; départ conseillé `leave`, arrivée `arr`. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5, to: 'Merbraine' }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Merbraine', to: 'Bruxelles Midi', head: 'Bruxelles Midi' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
}
function answers(fav: Favorite, now: number): FavoriteAnswer | undefined {
  const j = fav.id === 'fav-bureau' ? door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN) : fav.id === 'fav-mama' ? door('j-mama', NOW + 10 * MIN, NOW + 80 * MIN) : undefined;
  return j ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now } : undefined;
}
const steps = (s: Screen) => s.screen === 'steps' && s.page !== undefined;
const homeReady = (s: Screen) => s.screen === 'home' && s.shown?.length === 2 && !s.lines.some((l) => / …$/.test(l));
const open = (patch = {}, kv = createKV(memoryBackend())) =>
  setup({ now: NOW, kv, settings: settingsWith([PLACES.bureau, PLACES.mama], { seenVersion: '1.2.5', ...patch }), core: (now) => stubCore(now, { answers }) });

describe('CA-122.7 : un trajet n’est suivi que sur demande', () => {
  it('ouvrir un favori ne le suit pas : « Suivre ce trajet » ; au départ, pas de « En cours » ni de « Dans le train »', async () => {
    const h = await open();
    await h.until(homeReady);
    await h.gesture('tap');
    const s = await h.until(steps);
    expect(nb(s.title)).toBe('Vers le bureau : 07:33 → 08:46   Suivre ce trajet');
    expect(s).toMatchObject({ followed: false, sel: -1 });
    expect(s.lines.at(-1)).toBe('△▽ étapes   toucher : suivre ce trajet   double : retour');
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

  it('« Suivre ce trajet » le suit : « Trajet suivi : Bus W 07:38 », « Suivi » sur la ligne du titre, puis « En cours »', async () => {
    const h = await open();
    await h.until(homeReady);
    await h.gesture('tap');
    await h.until(steps);
    await h.gesture('tap');
    expect(nb(h.last().lines.at(-1)!)).toBe('Trajet suivi : Bus W 07:38');
    expect(h.last()).toMatchObject({ followed: true, sel: 0 });
    expect(nb(h.last().title)).toBe('Vers le bureau : 07:33 → 08:46   Suivi');
    const saved = JSON.parse((await h.kv.get(TRIP_KEY))!) as { explicit?: boolean; favoriteId?: string };
    expect(saved).toMatchObject({ explicit: true, favoriteId: 'fav-bureau' });
    h.advance(3_000);
    await h.c.render();
    expect(h.last().lines.at(-1)).toBe('△▽ étapes   toucher : ne plus suivre   double : retour');
    // l'heure du départ : « En cours » sur l'accueil, et le favori du trajet n'y est pas répété
    h.advance(3 * MIN);
    await h.gesture('double');
    const home = await h.until((x) => x.screen === 'home' && x.lines[0].startsWith('En cours'));
    expect(home.lines.slice(0, 3)).toEqual(['En cours : vers le bureau   W 07:38', 'Favoris   2', 'Mama   dans 6 min → 08:51']);
    h.c.stop();
  });

  it('sur le trajet suivi, toucher propose « Ne plus suivre » ; un second toucher arrête le suivi', async () => {
    const h = await open();
    await h.until(homeReady);
    await h.gesture('tap');
    await h.until(steps);
    await h.gesture('tap');
    h.advance(3_000);
    await h.gesture('tap');
    const menu = await h.until((x) => x.screen === 'followed');
    expect(nb(menu.title)).toBe('Vers le bureau : trajet suivi');
    expect(menu.lines).toEqual(['Ne plus suivre', 'Arrêts : Bus W vers Bruxelles Midi', '△▽ choisir   toucher : valider   double : retour']);
    expect(menu.sel).toBe(0);
    // double toucher : rien ne change
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'steps', followed: true });
    await h.gesture('tap', 'tap');
    expect(h.last()).toMatchObject({ screen: 'steps', followed: false });
    expect(h.last().lines.at(-1)).toBe('Suivi arrêté');
    expect(nb(h.last().title)).toMatch(/   Suivre ce trajet$/);
    expect(h.c.followed).toBeNull();
    await h.settle();
    expect(await h.kv.get(TRIP_KEY)).toBeFalsy();
    h.c.stop();
  });

  it('le détail du véhicule (« Dans le train » de la 1.2.1) reste à portée : « Arrêts : … » ; double toucher : les étapes', async () => {
    const h = await open();
    await h.until(homeReady);
    await h.gesture('tap');
    await h.until(steps);
    await h.gesture('tap');
    h.advance(3_000);
    await h.gesture('tap');
    await h.until((x) => x.screen === 'followed');
    await h.gesture('down', 'tap');
    expect((await h.until((x) => x.screen === 'train')).title).toBe('Bus W vers Bruxelles Midi');
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'steps', followed: true });
    h.c.stop();
  });

  it('sans aide des gestes (réglage), l’état reste dit sur la ligne du titre', async () => {
    const h = await open({ display: { ...settingsWith([]).display, gestureHints: false } });
    await h.until(homeReady);
    await h.gesture('tap');
    const s = await h.until(steps);
    expect(nb(s.title)).toMatch(/   Suivre ce trajet$/);
    expect(s.lines.some((l) => l.startsWith('△▽'))).toBe(false);
    await h.gesture('tap');
    expect(nb(h.last().title)).toMatch(/   Suivi$/);
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
    expect(nb(s.title)).toMatch(/^Vers le bureau : .*   Suivre ce trajet$/);
    expect(h.c.followed).toBeNull();
    h.c.stop();
  });

  it('le bouton « Lunettes » du téléphone reste une demande : le trajet est suivi, marqué `explicit`', async () => {
    const h = await open();
    await h.until(homeReady);
    const j = door('j-phone', NOW + 2 * MIN, NOW + 75 * MIN);
    expect(nb(await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, favoriteId: 'fav-bureau', result: { journeys: [j] }, index: 0 }))).toBe('Affiché dans les lunettes : Bus W 07:38.');
    const s = await h.until(steps);
    expect(s).toMatchObject({ followed: true });
    expect(nb(s.title)).toMatch(/   Suivi$/);
    await h.settle();
    expect(JSON.parse((await h.kv.get(TRIP_KEY))!).explicit).toBe(true);
    h.c.stop();
  });
});
