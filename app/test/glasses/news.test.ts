/**
 * Quai 1.2.2, message « Quai 1.2.2 » (docs/v1.2.2/PRD-1.2.2.md § 9, textes de REVUE-USAGE n° 4 et n° 2, suivi sur
 * demande § 6) : une seule fois après la mise à jour depuis la 1.2.1, la 1.2.0 ou la 1.1, jamais après une installation
 * neuve ; mêmes lignes sur Quai Web. Les lignes sont dans une seule constante (NEWS_LINES). La version de l'appli est
 * fixée à 1.2.2 (main la passe à 1.2.2 avec la release).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.2' }));

import { NEWS_SINCE } from '../../src/glasses/controller';
import { NEWS_LINES, NEWS_TITLE, newsLines, newsView } from '../../src/glasses/views';
import { createKV, memoryBackend } from '../../src/platform/kv';
import { PLACES, at, lines, settingsWith, setup, stubCore } from './helpers';

const NOW = at('2026-11-12', 7, 31);
const NEWS = ['Nouveau : tes gares et tes lignes sur l’accueil.', 'Tes arrêts favoris y sont rangés, rien n’est perdu.', 'Aller à… a rejoint Favoris.', 'Un trajet n’est suivi que si tu le demandes.'];

async function open(seenVersion: string, kv = createKV(memoryBackend()), web = false) {
  return setup({ now: NOW, web, kv, settings: settingsWith([PLACES.bureau], { seenVersion }), core: (now) => stubCore(now) });
}

describe('message « Quai 1.2.2 »', () => {
  it('depuis la 1.2.1 : une fois, quatre lignes ; toucher mène à l’accueil ; jamais à la réouverture', async () => {
    expect(NEWS_SINCE).toBe('1.2.2');
    const kv = createKV(memoryBackend());
    const a = await open('1.2.1', kv);
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.2' });
    expect(a.last().lines).toEqual([...NEWS, 'toucher : continuer']);
    await a.gesture('tap');
    expect((await a.until((s) => s.screen === 'home')).screen).toBe('home');
    expect(a.settings.get().seenVersion).toBe('1.2.2');
    a.c.stop();
    const b = await setup({ now: NOW + 3_600_000, kv, settings: a.settings.get(), core: (now) => stubCore(now) });
    expect(b.screens().some((s) => s.title === 'Quai 1.2.2')).toBe(false);
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });

  it('depuis la 1.2.0 et la 1.1 : les mêmes lignes', async () => {
    for (const seen of ['1.2.0', '1.1.0']) {
      const h = await open(seen);
      expect(h.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.2', lines: [...NEWS, 'toucher : continuer'] });
      h.c.stop();
    }
  });

  it('installation neuve ou version déjà vue : jamais ; Quai Web : mêmes lignes', async () => {
    const fresh = await open('');
    expect(fresh.screens().some((s) => s.title === 'Quai 1.2.2')).toBe(false);
    expect(fresh.settings.get().seenVersion).toBe('1.2.2');
    fresh.c.stop();
    const seen = await open('1.2.2');
    expect(seen.screens().some((s) => s.title === 'Quai 1.2.2')).toBe(false);
    seen.c.stop();
    const web = await open('1.2.1', undefined, true);
    expect(web.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.2', lines: [...NEWS, 'toucher : continuer'] });
    web.c.stop();
  });

  it('textes : une seule constante, tutoiement, espace insécable devant « : », sans tiret long ; tout tient sur l’écran', () => {
    expect(NEWS_TITLE).toBe('Quai 1.2.2');
    expect(newsLines('1.2.1')).toEqual([...NEWS_LINES]);
    expect(newsLines('1.0.3')).toEqual([...NEWS_LINES]);
    expect(NEWS_LINES.map((l) => l.replace(/ /g, ' '))).toEqual(NEWS);
    for (const l of NEWS_LINES) expect(l).not.toMatch(/ :|—|tes lieux/i);
    const ctx = { now: NOW, settings: settingsWith([]) };
    expect(lines(newsView(ctx, newsLines('1.2.1')))).toEqual([...NEWS, 'toucher : continuer']);
    expect(newsView({ ...ctx, web: true }, newsLines('1.2.1')).items).toEqual(newsView(ctx, newsLines('1.2.1')).items);
  });
});
