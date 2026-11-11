/**
 * Quai 1.2.1, message « Quai 1.2.1 » (docs/v1.2.1/PRD-1.2.1.md § 6, CA-121.8) : une seule fois après la mise à jour,
 * jamais après une installation neuve ; depuis une version antérieure à la 1.2.0, la ligne des lieux en plus ; mêmes
 * lignes sur Quai Web. La version de l'appli est fixée à 1.2.1 (main la passe à 1.2.1 avec la release).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.1' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-12', 7, 31);
const NEWS = ['Nouveau : le moins de marche d’abord.', 'Sur un trajet, ▼ : la suite, puis les autres trajets.', 'Accueil plus simple : tes favoris en tête.'];
const PLACES_LINE = 'Tes lieux sont maintenant dans tes favoris.';

async function open(seenVersion: string, kv = createKV(memoryBackend()), web = false) {
  return setup({ now: NOW, web, kv, settings: settingsWith([PLACES.bureau], { seenVersion }), core: (now) => stubCore(now) });
}

describe('CA-121.8 : message « Quai 1.2.1 »', () => {
  it('depuis la 1.2.0 : une fois, trois lignes ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    expect(NEWS_SINCE).toBe('1.2.1');
    const kv = createKV(memoryBackend());
    const a = await open('1.2.0', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.1' });
    expect(a.last().lines).toEqual([...NEWS, 'toucher : continuer']);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.2.1');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.2.1')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.1 (ou la 1.0) : la ligne des lieux en plus', async () => {
    for (const seen of ['1.1.0', '1.0.3']) {
      const h = await open(seen);
      expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.1' });
      expect(h.last().lines).toEqual([...NEWS, PLACES_LINE, 'toucher : continuer']);
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : mêmes lignes', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.2.1')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.1');
    fresh.c.stop();
    const seen = await open('1.2.1');
    expect(seen.screens().some((s) => s.title === 'Quai 1.2.1')).toBe(false);
    seen.c.stop();
    const web = await open('1.2.0', undefined, true);
    expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.1', lines: [...NEWS, 'toucher : continuer'] });
    web.c.stop();
  });

  it('textes : tutoiement, espace insécable devant « : », sans tiret long ; tout tient sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.1');
    expect(newsLines('1.2.0').map((l) => l.replace(/ /g, ' '))).toEqual(NEWS);
    expect(newsLines('1.1.0')).toHaveLength(4);
    expect(newsLines()).toHaveLength(3);
    for (const l of newsLines('1.0.0')) expect(l).not.toMatch(/ :|—/);
    const ctx = { now: NOW, settings: settingsWith([]) };
    expect(lines(newsView(ctx, newsLines('1.1.0')))).toEqual([...NEWS, PLACES_LINE, 'toucher : continuer']);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.0')).items).toEqual(newsView(ctx, newsLines('1.2.0')).items);
  });
});
