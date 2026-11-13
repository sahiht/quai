/**
 * Quai 1.2.5, message « Quai 1.2.5 » (docs/v1.2.5/PRD-1.2.5 § 8 ; CA-125.8) : une seule fois après la mise à jour,
 * jamais après une installation neuve ; mêmes lignes sur Quai Web. Depuis la 1.2.4 : les quatre lignes de la 1.2.5 ;
 * depuis une version antérieure : aussi les deux lignes de la 1.2.4, sur le même écran (6 lignes, l'écran en tient 8).
 * Les nouveautés plus anciennes ne sont plus dites. La version de l'appli est fixée à 1.2.5 (celle de la publication).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.5' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS, geometry } from '../../src/glasses/layout';
import { NEWS_LINES, NEWS_LINES_124, NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-13', 7, 31);
const NEWS_125 = [
  'Étapes : l’heure d’arrivée si tu rates ton départ.',
  'Pluie prévue : dite sur la marche concernée.',
  'Dans le véhicule : ta progression jusqu’à la descente.',
  'Bus, tram, métro : les lignes en clair, un départ par ligne.',
];
const NEWS_124 = ['Étapes : l’arrêt ou la gare où aller, en entier.', 'Bus, tram, métro : arrêts et lignes séparés.'];
const TAP = 'toucher : continuer';

async function open(seenVersion: string, kv = createKV(memoryBackend()), web = false) {
  return setup({ now: NOW, web, kv, settings: settingsWith([PLACES.bureau], { seenVersion }), core: (now) => stubCore(now) });
}

describe('CA-125.8 : message « Quai 1.2.5 »', () => {
  it('depuis la 1.2.4 : une fois, les quatre lignes de la 1.2.5 ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    expect(NEWS_SINCE).toBe('1.2.5');
    const kv = createKV(memoryBackend());
    const a = await open('1.2.4', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.5' });
    expect(a.last().lines).toEqual([...NEWS_125, TAP]);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.2.5');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.2.5')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.2.3, la 1.2.2, la 1.2.1, la 1.2.0, la 1.1 et la 1.0 : aussi la 1.2.4, sur le même écran', async () => {
    for (const seen of ['1.2.3', '1.2.2', '1.2.1', '1.2.0', '1.1.0', '1.0.3']) {
      const h = await open(seen);
      expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.5', lines: [...NEWS_125, ...NEWS_124, TAP] });
      await h.gesture('tap');
      expect((await h.until((s) => s.screen === 'home')).screen).toBe('home');
      expect(h.settings.get().seenVersion).toBe('1.2.5');
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : mêmes lignes', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.2.5')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.5');
    fresh.c.stop();
    const seen = await open('1.2.5');
    expect(seen.screens().some((s) => s.title === 'Quai 1.2.5')).toBe(false);
    seen.c.stop();
    for (const [v, want] of [
      ['1.2.4', NEWS_125],
      ['1.2.3', [...NEWS_125, ...NEWS_124]],
    ] as const) {
      const web = await open(v, undefined, true);
      expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.5', lines: [...want, TAP] });
      web.c.stop();
    }
  });

  it('textes : constantes, tutoiement, espace insécable devant « : », sans tiret long ; chaque ligne et le tout tiennent sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.5');
    expect(newsLines('1.2.4')).toEqual([...NEWS_LINES]);
    expect(newsLines('1.2.3')).toEqual([...NEWS_LINES, ...NEWS_LINES_124]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES, ...NEWS_LINES_124]);
    expect(newsLines('')).toEqual([...NEWS_LINES]);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_125);
    expect(NEWS_LINES_124.map(nb)).toEqual(NEWS_124);
    for (const l of [...NEWS_LINES, ...NEWS_LINES_124]) {
      expect(l).not.toMatch(/ :|—|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    // les 6 lignes tiennent sur un écran (8 places sous le titre), l'aide en dessous
    const all = newsView(ctx, newsLines('1.2.1'));
    expect(all.items.length).toBeLessThanOrEqual(geometry(all).capacity);
    expect(lines(all)).toEqual([...NEWS_125, ...NEWS_124, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.4')))).toEqual([...NEWS_125, TAP]);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.1')).items).toEqual(newsView(ctx, newsLines('1.2.1')).items);
  });
});
