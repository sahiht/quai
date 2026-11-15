/**
 * Quai 1.2.10, contrôleur (PRD-1.2.10 § 3.2 à 3.4, § 3.9) : l'écran calme du guidage. Ce qu'il montre (le moment du
 * moteur, « Où tu en es », rien), le toucher (afficher, effacer, terminer), le double toucher (l'accueil, le guidage
 * continue), l'appui long et le menu (système dans l'appli Even, écran rendu par Quai dans Quai Web), l'arrêt ; le rendu
 * (textes mis à jour sans reconstruire, image changée : reconstruction puis dessin, dessin raté : le texte suffit).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/guide', async () => (await import('./controller-guide-doubles')).guideModule);
vi.mock('../../src/glasses/guide-views', async () => (await import('./controller-guide-doubles')).viewsModule);

import type { Favorite, FavoriteAnswer } from '../../src/core/api';
import type { Moment } from '../../src/core/guide-types';
import { TRIP_KEY } from '../../src/glasses/controller';
import type { ImageSpec, Intent } from '../../src/glasses/types';
import { engine, moment, views } from './controller-guide-doubles';
import { NOW, cleanupKit, door, guideSetup, type Kit, type KitOptions } from './controller-guide-kit';
import { MIN, PLACES, nb, settingsWith } from './helpers';

const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined =>
  fav.id === 'fav-bureau' ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door('j-bureau', NOW + 2 * MIN, NOW + 75 * MIN)] }, updatedAt: now } : undefined;
const settings = () => settingsWith([PLACES.bureau], { seenVersion: '1.3.0' });
const homeReady = (s: { screen: string; lines: string[] }) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));
const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const screensOf = (h: Kit) => h.c.state.nav.stack.map((f) => f.route.screen);

/** Le moment que le moteur double rend, modifiable pendant le test (null : écran vide). */
let current: Moment | null = null;

/** Guidage lancé par le bouton « Y aller » (Bureau) ; « Où tu en es » laissé s'effacer si `quiet`. */
async function guided(o: Partial<KitOptions> = {}, quiet = true): Promise<Kit> {
  const h = await guideSetup({ settings: settings(), stub: { answers }, ...o });
  await h.until(homeReady);
  await h.c.goFavorite('fav-bureau');
  await h.settle();
  if (quiet) await h.settle(15_500);
  return h;
}

/** Le moteur rend `m` au prochain calcul (toucher, minuterie, position, temps réel). */
async function show(h: Kit, m: Moment | null): Promise<void> {
  current = m;
  await h.c.refreshCurrent();
  await h.settle();
}

beforeEach(() => {
  engine.reset();
  views.reset();
  current = null;
  engine.script = () => ({ moment: current });
});
afterEach(() => cleanupKit());

describe('PRD-1.2.10 § 3.2, § 3.3 : ce que montre l’écran du guidage', () => {
  it('vide par défaut ; toucher : « Où tu en es » 30 s, puis vide de nouveau ; toucher sur « Où tu en es » : effacé', async () => {
    const h = await guided();
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'empty', lines: [] });
    await h.gesture('tap');
    expect(h.last().show).toBe('where');
    await h.settle(29_000);
    expect(h.last().show).toBe('where');
    await h.settle(1_500);
    expect(h.last().show).toBe('empty');
    await h.gesture('tap');
    expect(h.last().show).toBe('where');
    await h.gesture('tap');
    expect(h.last().show).toBe('empty');
  });

  it('un moment passe avant « Où tu en es » ; toucher : effacé (dismissMoment), il ne revient pas ; Quai relance pour la suite', async () => {
    const h = await guided();
    await h.gesture('tap');
    expect(h.last().show).toBe('where');
    await show(h, moment('board', 'board:j-bureau:1', NOW, NOW + 30 * MIN, { vehicle: { line: 'W' } }));
    expect(h.last()).toMatchObject({ show: 'moment', moment: 'board:j-bureau:1' });
    await h.gesture('tap');
    expect(engine.dismissed).toEqual(['board:j-bureau:1']);
    expect(h.c.followed!.guide!.mem.dismissed).toEqual(['board:j-bureau:1']);
    // effacé : écran vide, pas « Où tu en es » qui revient
    expect(h.last().show).toBe('empty');
    await h.settle(61_000);
    expect(h.last().show).toBe('empty');
    // le moment suivant paraît
    await show(h, moment('nextStop', 'nextStop:j-bureau:1:3', NOW, NOW + 90 * MIN));
    expect(h.last()).toMatchObject({ show: 'moment', moment: 'nextStop:j-bureau:1:3' });
  });

  it('un moment qui finit seul laisse l’écran vide (pas « Où tu en es »)', async () => {
    const h = await guided({}, false);
    expect(h.last().show).toBe('where');
    await show(h, moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 30 * MIN, { turn: 'left', distM: 40 }));
    expect(h.last().show).toBe('moment');
    await show(h, null);
    expect(h.last().show).toBe('empty');
  });

  it('« Tu y es » : toucher termine le guidage et le suivi ; retour à l’accueil, sans message', async () => {
    engine.script = (input) => ({ location: 'high', moment: current });
    const h = await guided();
    const w = h.watching();
    expect(w).toBeDefined();
    await show(h, moment('arrived', 'arrived:j-bureau', NOW, NOW + 2 * MIN, { title: 'Vers le bureau', at: NOW, diffMin: 0 }));
    expect(h.last()).toMatchObject({ show: 'moment', moment: 'arrived:j-bureau' });
    await h.gesture('tap');
    expect(h.c.followed).toBeNull();
    expect(engine.dismissed).toEqual([]);
    expect(w!.stopped).toBe(true);
    expect(screensOf(h)).toEqual(['home']);
    const home = await h.until((s) => s.screen === 'home');
    expect(home.title).toBe('Quai');
    expect(home.lines.some((l) => l.startsWith('En cours'))).toBe(false);
    expect(await h.kv.get(TRIP_KEY)).toBeFalsy();
  });

  it('le guidage fini par le moteur (« Tu y es » + 2 min) : l’écran du guidage laisse place à l’accueil', async () => {
    const h = await guided();
    current = null;
    engine.script = (input) => ({ ended: input.now >= NOW + 20 * MIN });
    await h.settle(20 * MIN);
    expect(h.c.followed).toBeNull();
    expect(screensOf(h)).toEqual(['home']);
    expect(h.last().screen).toBe('home');
  });
});

describe('PRD-1.2.10 § 3.2, § 3.9 : rendu de l’écran du guidage', () => {
  it('appli Even : chaque page du guidage porte le menu système (deux choix) ; l’accueil, non', async () => {
    const h = await guided();
    const b = h.lastBuild()!;
    expect(b.extra?.menu).toEqual([
      { id: 1, label: 'Arrêter le guidage' },
      { id: 2, label: 'Voir tout le trajet' },
    ]);
    await h.gesture('double');
    expect(h.last().screen).toBe('home');
    expect(h.lastBuild()!.extra).toBeUndefined();
  });

  it('Quai Web : pas de menu système (l’appui long ouvre l’écran du menu)', async () => {
    const h = await guided({ web: true });
    expect(h.last().screen).toBe('guide');
    expect(h.lastBuild()!.extra?.menu).toBeUndefined();
  });

  it('image : reconstruction puis dessin ; chiffres qui bougent : mise à jour ; autre image dans le même conteneur : dessin seul', async () => {
    const h = await guided();
    let n = h.calls.length;
    await show(h, moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 30 * MIN, { turn: 'left', distM: 40 }));
    const a = h.since(n);
    expect(a.map((x) => x.op)).toEqual(['rebuild', 'paint']);
    expect(a[0].extra?.images).toEqual([expect.objectContaining({ id: 9, image: { kind: 'turn', turn: 'left' } })]);
    expect((a[1].arg as ImageSpec).image).toEqual({ kind: 'turn', turn: 'left' });
    // la distance change, l'image non
    n = h.calls.length;
    await show(h, moment('turn', 'turn:j-bureau:0:1', NOW, NOW + 30 * MIN, { turn: 'left', distM: 20 }));
    const b = h.since(n);
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((x) => x.op === 'upgrade')).toBe(true);
    expect(h.last().lines).toContain('dans 20 m');
    // autre image dans le même conteneur (autre virage) : textes mis à jour, puis l'image dessinée, sans reconstruction
    n = h.calls.length;
    await show(h, moment('turn', 'turn:j-bureau:0:2', NOW, NOW + 30 * MIN, { turn: 'right', distM: 40 }));
    const c = h.since(n);
    expect(c.some((x) => x.op === 'rebuild')).toBe(false);
    expect(c.at(-1)).toMatchObject({ op: 'paint', arg: expect.objectContaining({ id: 9, image: { kind: 'turn', turn: 'right' } }) });
    expect(c.filter((x) => x.op === 'paint')).toHaveLength(1);
    // plus d'image : reconstruction, aucun dessin
    n = h.calls.length;
    await show(h, null);
    expect(h.since(n).map((x) => x.op)).toEqual(['rebuild']);
  });

  it('une image qui ne part pas : le texte reste (journal QUAI_IMAGE), pas de nouvel essai sans reconstruction', async () => {
    const h = await guided({ paint: () => false });
    await show(h, moment('board', 'board:j-bureau:1', NOW, NOW + 30 * MIN));
    expect(h.logs).toContain('QUAI_IMAGE guide-img non dessinée');
    expect(h.last()).toMatchObject({ show: 'moment', lines: expect.arrayContaining(['board board:j-bureau:1']) });
    const n = h.calls.length;
    await h.c.render();
    expect(h.since(n).filter((x) => x.op === 'paint')).toHaveLength(0);
  });

  it('un dessin qui lève, ou une plateforme sans dessin : le guidage continue', async () => {
    const a = await guided({ paint: () => Promise.reject(new Error('sendFailed')) });
    await show(a, moment('board', 'board:j-bureau:1', NOW, NOW + 30 * MIN));
    expect(a.logs).toContain('QUAI_IMAGE guide-img non dessinée');
    expect(a.last().show).toBe('moment');
    cleanupKit();
    engine.reset();
    engine.script = () => ({ moment: current });
    const b = await guided({ paint: null });
    await show(b, moment('board', 'board:j-bureau:2', NOW, NOW + 30 * MIN));
    expect(b.lastBuild()!.extra?.images).toHaveLength(1);
    expect(b.calls.some((x) => x.op === 'paint')).toBe(false);
    expect(b.last().show).toBe('moment');
  });

  it('le guidage ne rend rien quand un autre écran est affiché', async () => {
    const h = await guided();
    await h.gesture('double');
    expect(h.last().screen).toBe('home');
    const n = views.calls.length;
    await show(h, moment('board', 'board:j-bureau:1', NOW, NOW + 30 * MIN));
    expect(views.calls.length).toBe(n);
    expect(h.last().screen).toBe('home');
  });
});

describe('PRD-1.2.10 § 3.4 : gestes et menu', () => {
  it('double toucher : l’accueil, le guidage continue ; « En cours » rouvre l’écran du guidage (« Où tu en es »)', async () => {
    engine.script = () => ({ location: 'high', moment: current });
    const h = await guided();
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home']);
    expect(h.c.followed?.guide).toBeDefined();
    expect(h.watching()).toBeDefined();
    const home = await h.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('En cours')));
    expect(home.lines.some((l) => nb(l).startsWith('En cours : vers le bureau'))).toBe(true);
    await intent(h, { kind: 'resume' });
    await h.settle();
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'where' });
    await h.settle(15_500);
    expect(h.last()).toMatchObject({ screen: 'guide', show: 'empty' });
  });

  it('réglage allumé : l’écran du guidage remplace les écrans automatiques de la 1.2.9 (pas de « Dans le train » au départ)', async () => {
    const h = await guided();
    await h.emit({ kind: 'menu', id: 2 });
    expect(screensOf(h)).toEqual(['home', 'guide', 'steps']);
    // le bus W part à 07:38 : la 1.2.9 ouvrait « Dans le train » sur l'écran du trajet suivi
    await h.settle(10 * MIN);
    await h.c.refreshCurrent();
    await h.settle();
    expect(screensOf(h)).toEqual(['home', 'guide', 'steps']);
    expect(h.screens().some((s) => s.screen === 'train' || s.screen === 'arrival')).toBe(false);
  });

  it('glisser sur l’écran du guidage : rien', async () => {
    const h = await guided();
    const n = h.calls.length;
    await h.gesture('up', 'down');
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.since(n)).toEqual([]);
    expect(h.logs).toContain('QUAI_GESTURE up sans effet sur guide');
  });

  it('Quai Web : appui long, l’écran du menu ; double toucher : retour au guidage ; ailleurs, l’appui long ne fait rien', async () => {
    const h = await guided({ web: true });
    await h.gesture('long');
    expect(screensOf(h)).toEqual(['home', 'guide', 'menu']);
    expect(h.last()).toMatchObject({ screen: 'menu', lines: ['Arrêter le guidage', 'Voir tout le trajet', '△▽ choisir   toucher : choisir   double : retour'] });
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home', 'guide']);
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home']);
    await h.gesture('long');
    expect(screensOf(h)).toEqual(['home']);
  });

  it('Quai Web, choix 1 : « Arrêter le guidage » : fin immédiate, « Guidage arrêté » sur l’accueil', async () => {
    engine.script = () => ({ location: 'high', moment: current });
    const h = await guided({ web: true });
    const w = h.watching()!;
    await h.gesture('long', 'tap');
    expect(h.c.followed).toBeNull();
    expect(w.stopped).toBe(true);
    expect(screensOf(h)).toEqual(['home']);
    // sur l'accueil, le message prend la ligne du titre
    expect(nb(h.last().title)).toBe('Guidage arrêté');
    expect(await h.kv.get(TRIP_KEY)).toBeFalsy();
  });

  it('Quai Web, choix 2 : « Voir tout le trajet » : l’écran du trajet guidé (sans « y aller ») ; double toucher : le guidage', async () => {
    const h = await guided({ web: true });
    await h.gesture('long', 'down', 'tap');
    expect(screensOf(h)).toEqual(['home', 'guide', 'steps']);
    const s = await h.until((x) => x.screen === 'steps' && x.page !== undefined);
    expect(s.followed).toBe(true);
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.last().screen).toBe('guide');
  });

  it('appli Even : menu système, choix 2 puis choix 1 (signaux `menu`) ; choix inconnu : rien', async () => {
    const h = await guided();
    await h.emit({ kind: 'menu', id: 2 });
    expect(screensOf(h)).toEqual(['home', 'guide', 'steps']);
    await h.gesture('double');
    expect(screensOf(h)).toEqual(['home', 'guide']);
    await h.emit({ kind: 'menu', id: 7 });
    expect(screensOf(h)).toEqual(['home', 'guide']);
    expect(h.c.followed).not.toBeNull();
    await h.emit({ kind: 'menu', id: 1 });
    expect(h.c.followed).toBeNull();
    expect(screensOf(h)).toEqual(['home']);
    expect(nb(h.last().title)).toBe('Guidage arrêté');
    // plus de guidage : un choix tardif ne fait rien
    await h.emit({ kind: 'menu', id: 2 });
    expect(screensOf(h)).toEqual(['home']);
  });

  it('menu resté ouvert après la fin du guidage : un choix le ferme', async () => {
    const h = await guided({ web: true });
    await h.gesture('long');
    await h.c.stopGuide();
    await h.settle();
    expect(h.c.followed).toBeNull();
    // l'écran du menu sans guidage ne reste pas (l'accueil)
    expect(screensOf(h)).toEqual(['home']);
  });

  it('« Arrêter le guidage » du téléphone : sur l’écran du guidage, l’accueil ; ailleurs, l’écran reste, avec le message', async () => {
    const a = await guided();
    await a.c.stopGuide();
    await a.settle();
    expect(screensOf(a)).toEqual(['home']);
    expect(nb(a.last().title)).toBe('Guidage arrêté');
    cleanupKit();
    engine.reset();
    engine.script = () => ({ moment: current });
    const b = await guided();
    await b.gesture('double');
    await intent(b, { kind: 'open', route: { screen: 'nearby' } });
    await b.until((s) => s.screen === 'nearby' && s.lines.length > 2);
    await b.c.stopGuide();
    await b.settle();
    expect(screensOf(b)).toEqual(['home', 'nearby']);
    expect(nb(b.last().lines.at(-1)!)).toBe('Guidage arrêté');
    // sans trajet suivi : rien
    await b.c.stopGuide();
    expect(b.c.followed).toBeNull();
  });

  it('toucher l’écran du guidage hors guidage, ou un autre écran : guideTap ne fait rien', async () => {
    const h = await guideSetup({ settings: settings(), stub: { answers } });
    await h.until(homeReady);
    await intent(h, { kind: 'guideTap' });
    expect(h.last().screen).toBe('home');
    await h.c.goFavorite('fav-bureau');
    await h.settle(16_000);
    await h.gesture('double');
    await intent(h, { kind: 'guideTap' });
    expect(h.c.followed?.guide?.mem.dismissed).toEqual([]);
    expect(h.last().screen).toBe('home');
  });
});
