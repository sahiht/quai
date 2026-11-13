/**
 * Quai 1.2.8, message « Quai 1.2.8 » (docs/v1.2.8/PRD-1.2.8 § 4) : une seule fois après la mise à jour, jamais après une
 * installation neuve ; mêmes lignes sur Quai Web. Depuis la 1.2.7 ou la 1.2.6 : les trois lignes de la 1.2.8 ; depuis la
 * 1.2.5 : aussi les quatre lignes de la 1.2.6 ; depuis une version antérieure, de même (celles de la 1.2.5 ne tiennent
 * plus sur l'écran : une version entière ou rien). La version de l'appli est fixée à 1.2.8 (celle de la publication).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.8' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS, geometry } from '../../src/glasses/layout';
import { NEWS_LINES, NEWS_LINES_125, NEWS_LINES_128, NEWS_MAX, NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-14', 7, 31);
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

describe('PRD-1.2.8 § 4 : message « Quai 1.2.8 »', () => {
  it('depuis la 1.2.7 et la 1.2.6 : une fois, les trois lignes de la 1.2.8 ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    expect(NEWS_SINCE).toBe('1.2.8');
    for (const seen of ['1.2.7', '1.2.6']) {
      const kv = createKV(memoryBackend());
      const a = await open(seen, kv);
      expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.8' });
      expect(a.last().lines).toEqual([...NEWS_128, TAP]);
      await a.gesture('tap');
      expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
      expect(a.settings.get().seenVersion).toBe('1.2.8');
      a.c.stop();
      const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
      expect(b.screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
      expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
      b.c.stop();
    }
  });

  it('depuis la 1.2.5 et avant : aussi la 1.2.6, sur le même écran ; la 1.2.5 n’y tient plus', async () => {
    for (const seen of ['1.2.5', '1.2.4', '1.2.3', '1.2.2', '1.2.1', '1.2.0', '1.1.0', '1.0.3']) {
      const h = await open(seen);
      expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.8', lines: [...NEWS_128, ...NEWS_126, TAP] });
      await h.gesture('tap');
      expect((await h.until((s) => s.screen === 'home')).screen).toBe('home');
      expect(h.settings.get().seenVersion).toBe('1.2.8');
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : mêmes lignes', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.8');
    fresh.c.stop();
    const seen = await open('1.2.8');
    expect(seen.screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
    seen.c.stop();
    for (const [v, want] of [
      ['1.2.7', NEWS_128],
      ['1.2.3', [...NEWS_128, ...NEWS_126]],
    ] as const) {
      const web = await open(v, undefined, true);
      expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.8', lines: [...want, TAP] });
      web.c.stop();
    }
  });

  it('textes : constantes, tutoiement, espace insécable devant « : », sans tiret long ; chaque ligne et le tout tiennent sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.8');
    expect(newsLines('1.2.7')).toEqual([...NEWS_LINES_128]);
    expect(newsLines('1.2.6')).toEqual([...NEWS_LINES_128]);
    expect(newsLines('1.2.5')).toEqual([...NEWS_LINES_128, ...NEWS_LINES]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES_128, ...NEWS_LINES]);
    expect(newsLines('')).toEqual([...NEWS_LINES_128]);
    expect(NEWS_LINES_128.map(nb)).toEqual(NEWS_128);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_126);
    expect(NEWS_LINES_125.map(nb)).toEqual(NEWS_125);
    for (const l of [...NEWS_LINES_128, ...NEWS_LINES, ...NEWS_LINES_125]) {
      expect(l).not.toMatch(/ :|—|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    // les lignes tiennent sur un écran (NEWS_MAX places sous le titre), l'aide en dessous
    const all = newsView(ctx, newsLines('1.2.1'));
    expect(geometry(all).capacity).toBeGreaterThanOrEqual(NEWS_MAX);
    expect(all.items.length).toBeLessThanOrEqual(geometry(all).capacity);
    expect(lines(all)).toEqual([...NEWS_128, ...NEWS_126, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.7')))).toEqual([...NEWS_128, TAP]);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.1')).items).toEqual(newsView(ctx, newsLines('1.2.1')).items);
  });
});
