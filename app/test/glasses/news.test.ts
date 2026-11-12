/**
 * Quai 1.2.3, message « Quai 1.2.3 » (docs/v1.2.3/PRD-1.2.3 § 4 ; CA-123.4) : une seule fois après la mise à jour,
 * jamais après une installation neuve ; mêmes lignes sur Quai Web. Depuis la 1.2.2 : les trois lignes de la 1.2.3 ;
 * depuis une version antérieure (la 1.2.1 installée directement en 1.2.3, la 1.2.0, la 1.1, la 1.0) : aussi les
 * nouveautés de la 1.2.2 (gares et lignes sur l'accueil, arrêts favoris rangés sans perte, « Aller à… » dans Favoris,
 * suivi sur demande), sur le même écran. La version de l'appli est fixée à 1.2.3 (la publication la passe à 1.2.3).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.3' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS, geometry } from '../../src/glasses/layout';
import { NEWS_LINES, NEWS_LINES_122, NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, nb, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-12', 7, 31);
const NEWS_123 = ['Tableaux complets : tous les départs des 2 heures à venir.', 'Touche un départ : ses arrêts jusqu’au terminus.', 'Bus, tram, métro : ajoute une ligne ou un arrêt.'];
const NEWS_122 = ['Nouveau : tes gares et tes lignes sur l’accueil.', 'Tes arrêts favoris y sont rangés, rien n’est perdu.', 'Aller à… a rejoint Favoris.', 'Un trajet n’est suivi que si tu le demandes.'];
const TAP = 'toucher : continuer';

async function open(seenVersion: string, kv = createKV(memoryBackend()), web = false) {
  return setup({ now: NOW, web, kv, settings: settingsWith([PLACES.bureau], { seenVersion }), core: (now) => stubCore(now) });
}

describe('CA-123.4 : message « Quai 1.2.3 »', () => {
  it('depuis la 1.2.2 : une fois, les trois lignes de la 1.2.3 ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    expect(NEWS_SINCE).toBe('1.2.3');
    const kv = createKV(memoryBackend());
    const a = await open('1.2.2', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.3' });
    expect(a.last().lines).toEqual([...NEWS_123, TAP]);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.2.3');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.2.3')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.2.1 (installée directement en 1.2.3), la 1.2.0, la 1.1 et la 1.0 : aussi les nouveautés de la 1.2.2, sur le même écran', async () => {
    for (const seen of ['1.2.1', '1.2.0', '1.1.0', '1.0.3']) {
      const h = await open(seen);
      expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.3', lines: [...NEWS_123, ...NEWS_122, TAP] });
      await h.gesture('tap');
      expect((await h.until((s) => s.screen === 'home')).screen).toBe('home');
      expect(h.settings.get().seenVersion).toBe('1.2.3');
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : mêmes lignes', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.2.3')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.3');
    fresh.c.stop();
    const seen = await open('1.2.3');
    expect(seen.screens().some((s) => s.title === 'Quai 1.2.3')).toBe(false);
    seen.c.stop();
    for (const [v, want] of [
      ['1.2.2', NEWS_123],
      ['1.2.1', [...NEWS_123, ...NEWS_122]],
    ] as const) {
      const web = await open(v, undefined, true);
      expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.3', lines: [...want, TAP] });
      web.c.stop();
    }
  });

  it('textes : deux constantes, tutoiement, espace insécable devant « : », sans tiret long ; chaque ligne et le tout tiennent sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.3');
    expect(newsLines('1.2.2')).toEqual([...NEWS_LINES]);
    expect(newsLines('1.2.1')).toEqual([...NEWS_LINES, ...NEWS_LINES_122]);
    expect(newsLines('')).toEqual([...NEWS_LINES]);
    expect(NEWS_LINES.map(nb)).toEqual(NEWS_123);
    expect(NEWS_LINES_122.map(nb)).toEqual(NEWS_122);
    for (const l of [...NEWS_LINES, ...NEWS_LINES_122]) {
      expect(l).not.toMatch(/ :|—|vous\b/i);
      // une ligne des lunettes chacune : jamais coupée en deux
      expect(textWidth(l)).toBeLessThanOrEqual(WIDTHS.full);
    }
    const ctx = { now: NOW, settings: settingsWith([]) };
    // les 7 lignes tiennent sur un écran (8 places sous le titre), l'aide en dessous
    const all = newsView(ctx, newsLines('1.2.1'));
    expect(all.items.length).toBeLessThanOrEqual(geometry(all).capacity);
    expect(lines(all)).toEqual([...NEWS_123, ...NEWS_122, TAP]);
    expect(lines(newsView(ctx, newsLines('1.2.2')))).toEqual([...NEWS_123, TAP]);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.1')).items).toEqual(newsView(ctx, newsLines('1.2.1')).items);
  });
});
