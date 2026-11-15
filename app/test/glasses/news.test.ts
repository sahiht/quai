/**
 * Quai 1.2.10, message « Quai 1.2.10 » (docs/v1.2.10/PRD-1.2.10 § 7) : une seule fois après la mise à jour, jamais après
 * une installation neuve ; mêmes lignes sur Quai Web (aucun mot n'y change). Depuis la 1.2.9 : les trois lignes de la
 * 1.2.10 ; depuis la 1.2.8 ou avant : aussi les trois lignes de la 1.2.9 (celles d'avant ne tiennent plus sur l'écran :
 * une version entière ou rien). La version de l'appli est fixée à 1.2.10 ; le seuil du message (NEWS_SINCE) est celui
 * du contrôleur : les cas qui en dépendent le lisent.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.10' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS, geometry } from '../../src/glasses/layout';
import { NEWS_LINES, NEWS_LINES_125, NEWS_LINES_128, NEWS_LINES_129, NEWS_LINES_1210, NEWS_LINES_1210_WEB, NEWS_MAX, NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { compareVersions } from '../../src/version';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-14', 7, 31);
const NEWS_1210 = ['Y aller : guidé de porte à porte, écran calme.', 'Train ou bus déjà pris : « j’y descends ».', 'Favoris : une ligne chacun, le détail en bas.'];
const NEWS_129 = ['« imminent » : seulement d’après le temps réel.', 'Téléphone : l’accueil reprend celui des lunettes.', 'Réglages : tout derrière un seul bouton.'];
const NEWS_129_WEB = ['« imminent » : seulement d’après le temps réel.', 'Onglet Réglages : il reprend l’accueil des lunettes.', 'Réglages : tout derrière un seul bouton.'];
const NEWS_128 = ['Un train : tout son trajet, gares d’avant comprises.', 'Chaque gare : sa voie et dans combien de temps.', '● : là où le train arrive, d’après le temps réel.'];
const NEWS_126 = [
  'Arrêts et lignes de bus, tram, métro, séparés.',
  'Une ligne : tout son parcours, l’attente à chaque arrêt.',
  'Dans les deux sens, sans choisir d’arrêt.',
  'Tes lignes gardées y sont déjà.',
];
const NEWS_125 = ['Étapes : l’heure d’arrivée si tu rates ton départ.', 'Pluie prévue : dite sur la marche concernée.', 'Dans le véhicule : ta progression jusqu’à la descente.'];
const TAP = 'toucher : continuer';

async function open(seenVersion: string, kv = createKV(memoryBackend()), web = false) {
  return setup({ now: NOW, web, kv, settings: settingsWith([PLACES.bureau], { seenVersion }), core: (now) => stubCore(now) });
}

describe('PRD-1.2.10 § 7 : message « Quai 1.2.10 »', () => {
  it('depuis la 1.2.8 : une fois, les lignes de la 1.2.10 puis celles de la 1.2.9 ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    const kv = createKV(memoryBackend());
    const a = await open('1.2.8', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.10' });
    expect(a.last().lines).toEqual([...NEWS_1210, ...NEWS_129, TAP]);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.2.10');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.2.10')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.2.9 : les trois lignes de la 1.2.10 seules, dès que le seuil du contrôleur est la 1.2.10', async () => {
    const h = await open('1.2.9');
    if (compareVersions('1.2.9', NEWS_SINCE) < 0) expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.10', lines: [...NEWS_1210, TAP] });
    else expect(h.screens().some((s) => s.title === 'Quai 1.2.10')).toBe(false);
    h.c.stop();
  });

  it('depuis la 1.2.7 et avant : la 1.2.10 et la 1.2.9, sur le même écran ; les autres n’y tiennent plus', async () => {
    for (const seen of ['1.2.7', '1.2.5', '1.2.1', '1.0.3']) {
      const h = await open(seen);
      expect(h.last(), seen).toMatchObject({ screen: 'message', title: 'Quai 1.2.10', lines: [...NEWS_1210, ...NEWS_129, TAP] });
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : mêmes lignes de la 1.2.10, l’onglet Réglages dans celles de la 1.2.9', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.2.10')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.10');
    fresh.c.stop();
    const seen = await open('1.2.10');
    expect(seen.screens().some((s) => s.title === 'Quai 1.2.10')).toBe(false);
    seen.c.stop();
    const web = await open('1.2.8', undefined, true);
    expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.10', lines: [...NEWS_1210, ...NEWS_129_WEB, TAP] });
    web.c.stop();
  });

  it('textes : constantes, tutoiement, espaces insécables, sans tiret long ; chaque ligne et le tout tiennent sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.10');
    expect(newsLines('1.2.9')).toEqual([...NEWS_LINES_1210]);
    expect(newsLines('1.2.8')).toEqual([...NEWS_LINES_1210, ...NEWS_LINES_129]);
    expect(newsLines('1.2.7')).toEqual([...NEWS_LINES_1210, ...NEWS_LINES_129]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES_1210, ...NEWS_LINES_129]);
    expect(newsLines('')).toEqual([...NEWS_LINES_1210]);
    expect(newsLines('1.2.9', true)).toEqual([...NEWS_LINES_1210_WEB]);
    expect(newsLines('1.2.8', true).map(nb)).toEqual([...NEWS_1210, ...NEWS_129_WEB]);
    expect(NEWS_LINES_1210.map(nb)).toEqual(NEWS_1210);
    expect(NEWS_LINES_129.map(nb)).toEqual(NEWS_129);
    expect(NEWS_LINES_128.map(nb)).toEqual(NEWS_128);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_126);
    expect(NEWS_LINES_125.map(nb)).toEqual(NEWS_125);
    // « : » précédé d'une espace insécable ; dans les guillemets aussi
    expect(NEWS_LINES_1210[1]).toBe('Train ou bus déjà pris\u00a0: «\u00a0j’y descends\u00a0».');
    for (const l of [...NEWS_LINES_1210, ...NEWS_LINES_129, ...newsLines('1.2.8', true), ...NEWS_LINES_128, ...NEWS_LINES, ...NEWS_LINES_125]) {
      expect(l).not.toMatch(/ :|[\u2013\u2014]|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    const all = newsView(ctx, newsLines('1.2.1'));
    expect(geometry(all).capacity).toBeGreaterThanOrEqual(NEWS_MAX);
    expect(all.items.length).toBeLessThanOrEqual(geometry(all).capacity);
    expect(lines(all)).toEqual([...NEWS_1210, ...NEWS_129, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.9')))).toEqual([...NEWS_1210, TAP]);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.9')).items).toEqual(newsView(ctx, newsLines('1.2.9')).items);
  });
});
