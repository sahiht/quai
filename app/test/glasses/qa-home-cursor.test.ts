/**
 * Contrôle qualité 1.2.1 (simulateur, scénarios s1run et s1stay) : la ligne « En cours » qui paraît en tête de
 * l'accueil ne fait plus tomber le curseur sur « Favoris ». En 1.2.0, les favoris commençaient à la 1re ligne : revenu
 * à l'accueil après avoir lancé un trajet, le curseur était sur « En cours » et un toucher reprenait le trajet. En
 * 1.2.1, « Favoris » occupe la 1re ligne : le curseur gardait son rang et tombait sur « Favoris » (un toucher ouvrait
 * la liste de tous les favoris au lieu du trajet), au retour comme quand « En cours » paraissait sous les yeux.
 * 1.2.2 : un trajet n'est suivi que sur demande (« Suivre ce trajet ») ; « En cours » remplace la ligne de son favori
 * (REVUE-USAGE n° 1) : le curseur qui était sur ce favori passe sur « En cours », et y revient à la fin du trajet.
 */
import { describe, expect, it } from 'vitest';
import type { Favorite, FavoriteAnswer, Journey } from '../../src/core/api';
import { MIN, PLACES, at, journey, settingsWith, setup, stubCore, type Screen } from './helpers';

const NOW = at('2026-11-12', 20, 47);

/** Trajet vers un lieu : 5 min à pied, bus W, 4 min à pied ; départ conseillé `leave`, arrivée `arr`. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5 }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Arrêt', to: 'Gare' }, { walk: 4 }], { label: 'short', reason: 'Le plus court : direct, à pied 5 + 4 min' });
}

/** Bureau : départ conseillé `bureauIn` minutes après le début du test ; Mama : 10 min. */
function answers(bureauIn: number) {
  return (fav: Favorite, now: number): FavoriteAnswer | undefined => {
    const j = fav.id === 'fav-bureau' ? door('j-bureau', NOW + bureauIn * MIN, NOW + (bureauIn + 47) * MIN) : fav.id === 'fav-mama' ? door('j-mama', NOW + 10 * MIN, NOW + 71 * MIN) : undefined;
    return j ? { favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now } : undefined;
  };
}

/** Ligne de l'élément sous le curseur (lignes de l'accueil sans la ligne vide ni l'aide des gestes). */
const selected = (s: Screen): string => s.lines.filter((l) => l !== '' && !l.startsWith('▲▼'))[s.sel];
const ready = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l));

/** Ouvre le trajet du bureau depuis l'accueil et le suit (1.2.2 : un toucher de plus, « Suivre ce trajet »). */
async function followBureau(h: Awaited<ReturnType<typeof setup>>): Promise<void> {
  await h.gesture('tap');
  await h.until((s) => s.screen === 'steps' && s.page !== undefined);
  await h.gesture('tap');
  await h.until((s) => s.screen === 'steps' && s.followed === true);
}

describe('accueil : le curseur ne tombe jamais sur « Favoris » quand « En cours » paraît', () => {
  it('retour à l’accueil après avoir suivi un trajet : le curseur sur « En cours », un toucher reprend le trajet', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau, PLACES.mama]), core: (now) => stubCore(now, { answers: answers(0) }) });
    const home = await h.until((s) => ready(s) && s.shown?.length === 2);
    expect(selected(home)).toMatch(/^Bureau {3}maintenant → /);
    await followBureau(h);
    await h.gesture('double');
    const back = await h.until((s) => ready(s) && s.lines[0].startsWith('En cours'));
    // « En cours » remplace la ligne du bureau : pas de « Bureau » dessous
    expect(back.lines.slice(0, 3)).toEqual(['En cours : vers le bureau   W 20:52', 'Favoris   2', 'Mama   dans 10 min → 21:58']);
    expect(selected(back)).toBe('En cours : vers le bureau   W 20:52');
    // un toucher reprend le trajet, pas la liste de tous les favoris
    await h.gesture('tap');
    expect(await h.until((s) => s.screen !== 'home')).toMatchObject({ screen: 'steps', followed: true });
    h.c.stop();
  });

  it('« En cours » paraît pendant qu’on regarde l’accueil, puis disparaît : le curseur suit la ligne qui remplace la sienne', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau, PLACES.mama]), core: (now) => stubCore(now, { answers: answers(4) }) });
    await h.until((s) => ready(s) && s.shown?.length === 2);
    await followBureau(h);
    await h.gesture('double');
    // le trajet suivi ne part que dans 4 min : pas encore « En cours » ; le curseur sur « Bureau »
    const before = await h.until((s) => ready(s) && s.shown?.length === 2);
    expect(before.lines[0]).toBe('Favoris   2');
    expect(selected(before)).toMatch(/^Bureau {3}/);
    // le trajet commence : « En cours » paraît en tête et prend la place de « Bureau », le curseur avec
    h.advance(5 * MIN);
    await h.c.refreshCurrent();
    const running = await h.until((s) => ready(s) && s.lines[0].startsWith('En cours'));
    expect(selected(running)).toMatch(/^En cours : vers le bureau/);
    expect(running.lines.some((l) => l.startsWith('Bureau'))).toBe(false);
    // le curseur descend sur « Bus, tram, métro », puis le trajet prend fin (arrivée plus 5 min) : il y reste
    for (let i = 0; i < 6 && !selected(h.last()).startsWith('Bus, tram, métro'); i++) await h.gesture('down');
    expect(selected(h.last())).toMatch(/^Bus, tram, métro/);
    h.advance(60 * MIN);
    await h.c.refreshCurrent();
    const ended = await h.until((s) => s.screen === 'home' && !s.lines[0].startsWith('En cours') && s.lines.some((l) => l.startsWith('Bus, tram, métro')));
    expect(selected(ended)).toMatch(/^Bus, tram, métro/);
    h.c.stop();
  });

  it('le curseur sur « En cours » à la fin du trajet : il passe sur le favori qui reprend sa ligne, jamais sur « Favoris »', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau, PLACES.mama]), core: (now) => stubCore(now, { answers: answers(0) }) });
    await h.until((s) => ready(s) && s.shown?.length === 2);
    await followBureau(h);
    await h.gesture('double');
    const running = await h.until((s) => ready(s) && s.lines[0].startsWith('En cours'));
    expect(selected(running)).toMatch(/^En cours/);
    h.advance(60 * MIN);
    await h.c.refreshCurrent();
    // (la réponse du bureau se recalcule : « … » le temps du calcul)
    const ended = await h.until((s) => s.screen === 'home' && !s.lines[0].startsWith('En cours') && s.lines.some((l) => l.startsWith('Bureau')));
    expect(selected(ended)).toMatch(/^Bureau {3}/);
    h.c.stop();
  });
});
