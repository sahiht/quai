/**
 * Message des nouveautés : une seule fois après la mise à jour, jamais après une installation neuve ; mêmes lignes sur
 * Quai Web (l'onglet Réglages au lieu du téléphone). 1.2.10 (PRD-1.2.10 § 7) : le contrôleur le montre à qui a vu la 1.2.9
 * ou avant (NEWS_SINCE) ; son titre et ses lignes viennent des écrans (NEWS_TITLE, newsLines), vérifiés ici sur le
 * parcours du contrôleur sans en recopier le texte. La version de l'appli est fixée à 1.2.10 (celle de la publication).
 * Les textes de la 1.2.9 et d'avant restent vérifiés par le dernier test (écrans).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.10' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS, geometry } from '../../src/glasses/layout';
import { NEWS_LINES, NEWS_LINES_125, NEWS_LINES_128, NEWS_LINES_129, NEWS_MAX, NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-14', 7, 31);
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

describe('PRD-1.2.10 § 7 : message des nouveautés (contrôleur)', () => {
  it('depuis la 1.2.9 : une fois ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    expect(NEWS_SINCE).toBe('1.2.10');
    const kv = createKV(memoryBackend());
    const a = await open('1.2.9', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: NEWS_TITLE });
    expect(a.last().lines).toEqual([...newsLines('1.2.9').map(nb), TAP]);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.2.10');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === NEWS_TITLE)).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.2.8 et avant : les lignes selon la version vue, sur un seul écran', async () => {
    for (const seen of ['1.2.8', '1.2.7', '1.2.6', '1.2.5', '1.2.4', '1.2.3', '1.2.2', '1.2.1', '1.2.0', '1.1.0', '1.0.3']) {
      const h = await open(seen);
      expect(h.last(), seen).toMatchObject({ screen: 'message', title: NEWS_TITLE, lines: [...newsLines(seen).map(nb), TAP] });
      await h.gesture('tap');
      expect((await h.until((s) => s.screen === 'home')).screen).toBe('home');
      expect(h.settings.get().seenVersion).toBe('1.2.10');
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : l’onglet Réglages au lieu du téléphone', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === NEWS_TITLE)).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.10');
    fresh.c.stop();
    const seen = await open('1.2.10');
    expect(seen.screens().some((s) => s.title === NEWS_TITLE)).toBe(false);
    seen.c.stop();
    for (const v of ['1.2.9', '1.2.3']) {
      const web = await open(v, undefined, true);
      expect(web.last()).toMatchObject({ screen: 'message', title: NEWS_TITLE, lines: [...newsLines(v, true).map(nb), TAP] });
      web.c.stop();
    }
  });

  it('textes : constantes, tutoiement, espace insécable devant « : », sans tiret long ; chaque ligne et le tout tiennent sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.9');
    expect(newsLines('1.2.8')).toEqual([...NEWS_LINES_129]);
    expect(newsLines('1.2.7')).toEqual([...NEWS_LINES_129, ...NEWS_LINES_128]);
    expect(newsLines('1.2.5')).toEqual([...NEWS_LINES_129, ...NEWS_LINES_128]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES_129, ...NEWS_LINES_128]);
    expect(newsLines('')).toEqual([...NEWS_LINES_129]);
    expect(NEWS_LINES_129.map(nb)).toEqual(NEWS_129);
    expect(NEWS_LINES_128.map(nb)).toEqual(NEWS_128);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_126);
    expect(NEWS_LINES_125.map(nb)).toEqual(NEWS_125);
    expect(newsLines('1.2.8', true).map(nb)).toEqual(NEWS_129_WEB);
    for (const l of [...NEWS_LINES_129, ...newsLines('1.2.8', true), ...NEWS_LINES_128, ...NEWS_LINES, ...NEWS_LINES_125]) {
      expect(l).not.toMatch(/ :|—|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    // les lignes tiennent sur un écran (NEWS_MAX places sous le titre), l'aide en dessous
    const all = newsView(ctx, newsLines('1.2.1'));
    expect(geometry(all).capacity).toBeGreaterThanOrEqual(NEWS_MAX);
    expect(all.items.length).toBeLessThanOrEqual(geometry(all).capacity);
    expect(lines(all)).toEqual([...NEWS_129, ...NEWS_128, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.8')))).toEqual([...NEWS_129, TAP]);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.1')).items).toEqual(newsView(ctx, newsLines('1.2.1')).items);
  });
});
