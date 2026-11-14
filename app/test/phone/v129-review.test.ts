// @vitest-environment happy-dom
/**
 * Quai 1.2.9, relecture avant publication : un champ d'adresse quitté avant la fin du délai (écran changé) n'envoie
 * plus de recherche d'adresse et ne dessine plus rien (la minuterie partait quand même, et pouvait lever une erreur
 * quand la page n'existait plus).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GEO_DELAY_MS, placeField } from '../../src/phone/field';
import { defaults, harness, mount, settle, sleep, type } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('1.2.9 : champ d’adresse quitté', () => {
  it('quitté avant le délai : pas de recherche d’adresse ; resté : une seule', async () => {
    const hz = harness({ settings: defaults() });
    const geo = vi.spyOn(hz.core, 'geocode');
    const f = placeField(hz.ctx, { id: 'f', label: 'Arrivée', here: true, places: true, recent: true, onPick: () => undefined });
    mount(f.el);
    type(f.input, 'gand');
    document.body.replaceChildren();
    await sleep(GEO_DELAY_MS + 60);
    await settle();
    expect(geo).not.toHaveBeenCalled();
    const g = placeField(hz.ctx, { id: 'g', label: 'Arrivée', here: true, places: true, recent: true, onPick: () => undefined });
    mount(g.el);
    type(g.input, 'gand');
    await sleep(GEO_DELAY_MS + 60);
    await settle();
    expect(geo).toHaveBeenCalledTimes(1);
  });
});

describe('1.2.9 : bannière « Nouveau » de Quai Web', () => {
  it('l’onglet Réglages, jamais « le téléphone » ; l’appli Even : le téléphone', async () => {
    const { newsState, NEWS_SINCE } = await import('../../src/phone/app');
    const web = newsState('1.2.8', NEWS_SINCE, '1.2.9', true).lines;
    expect(web).toHaveLength(3);
    expect(web.some((l) => /téléphone/.test(l))).toBe(false);
    expect(web[1]).toMatch(/^L’onglet Réglages reprend l’accueil des lunettes/);
    expect(newsState('1.2.8', NEWS_SINCE, '1.2.9').lines[1]).toMatch(/^L’accueil du téléphone/);
  });
});

describe('1.2.9 (relecture) : accueil du téléphone', () => {
  it('la carte des rubriques suit une gare gardée ou retirée ailleurs (★ des lunettes, Quai Web côte à côte)', async () => {
    const { harness: hz0, mount: mount0, defaults: d0, textOf } = await import('./helpers');
    const { homeScreen } = await import('../../src/phone/screens/home');
    const hz = hz0({ settings: d0() });
    const el = mount0(homeScreen(hz.ctx));
    await new Promise((r) => setTimeout(r, 0));
    const gares = () => [...el.querySelectorAll<HTMLAnchorElement>('.mirror .nav-row')].find((a) => /Gares/.test(textOf(a.querySelector('.t1'))))!;
    expect(textOf(gares().querySelector('.count'))).toBe('à choisir');
    await hz.settings.update((s) => ({ ...s, stations: [{ id: 'g-namur', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 }] }));
    expect(textOf(gares().querySelector('.count'))).toBe('1 gare');
    expect(gares().getAttribute('href')).toBe('#/gares');
    await hz.settings.update((s) => ({ ...s, stations: [] }));
    expect(textOf(gares().querySelector('.count'))).toBe('à choisir');
    // l'accueil quitté : elle ne suit plus
    document.body.replaceChildren();
    await hz.settings.update((s) => ({ ...s, stations: [{ id: 'g-namur', areaId: 'sncb:8863008', name: { fr: 'Namur', nl: 'Namen' }, lat: 50.4685, lon: 4.8625 }] }));
    expect(textOf(gares().querySelector('.count'))).toBe('à choisir');
  });

  it('au-delà de 3 favoris, « Voir les 2 autres favoris » les montre avec leur bouton « Lunettes »', async () => {
    const { harness: hz0, mount: mount0, preset11, textOf } = await import('./helpers');
    const { homeScreen } = await import('../../src/phone/screens/home');
    const base = preset11();
    const extra = (id: string, label: string) => ({ ...base.favorites.find((f) => f.kind === 'place' && f.id === 'fav-bureau')!, id, label }) as (typeof base.favorites)[number];
    const hz = hz0({ settings: { ...base, favorites: [...base.favorites, extra('fav-ecole', 'École'), extra('fav-sport', 'Sport')] } });
    const el = mount0(homeScreen(hz.ctx));
    expect(el.querySelectorAll('.fav-row')).toHaveLength(3);
    const more = el.querySelector<HTMLButtonElement>('.more-favs')!;
    expect(textOf(more)).toBe('Voir les 2 autres favoris');
    more.click();
    const rows = [...el.querySelectorAll('.fav-row')];
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.querySelector('button'))).toBe(true);
    expect(el.querySelector('.more-favs')).toBeNull();
    expect(document.activeElement).toBe(rows[3].querySelector('button'));
  });

  it('« Voir les 2 autres favoris » touché pendant le premier calcul : leurs réponses suivent, sans attendre le rafraîchissement de 30 s (bout en bout s129)', async () => {
    const { harness: hz0, mount: mount0, preset11, textOf, until } = await import('./helpers');
    const { homeScreen, resetAnswers } = await import('../../src/phone/screens/home');
    resetAnswers();
    const base = preset11();
    const extra = (id: string, label: string) => ({ ...base.favorites.find((f) => f.kind === 'place' && f.id === 'fav-bureau')!, id, label }) as (typeof base.favorites)[number];
    // les réponses attendent `release` : le premier calcul est encore en cours au toucher
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const hz = hz0({
      settings: { ...base, favorites: [...base.favorites, extra('fav-ecole', 'École'), extra('fav-sport', 'Sport')] },
      core: (c) => ({
        ...c,
        answer: async (...a: Parameters<typeof c.answer>) => {
          await gate;
          return c.answer(...a);
        },
      }),
    });
    const el = mount0(homeScreen(hz.ctx));
    await new Promise((r) => setTimeout(r, 0));
    el.querySelector<HTMLButtonElement>('.more-favs')!.click();
    release();
    const answers = () => [...el.querySelectorAll('.fav-row .answer')].map((a) => textOf(a));
    await until(() => answers().length === 5 && answers().every((t) => t !== '…'), 3000);
    expect(answers()).toHaveLength(5);
  });

  it('Affichage : ouvert depuis l’accueil, retour « Accueil » ; depuis Réglages, retour « Réglages » ; espaces insécables du rayon', async () => {
    const { harness: hz0, mount: mount0, defaults: d0, textOf } = await import('./helpers');
    const { displayScreen } = await import('../../src/phone/screens/display');
    const fromHome = hz0({ settings: d0(), params: 'retour=accueil' });
    const a = mount0(displayScreen(fromHome.ctx));
    expect(textOf(a.querySelector('.back'))).toBe('Accueil');
    document.body.replaceChildren();
    const fromSettings = hz0({ settings: d0() });
    const b = mount0(displayScreen(fromSettings.ctx));
    expect(textOf(b.querySelector('.back'))).toBe('Réglages');
    expect(b.textContent).toMatch(/Rayon de «[  ]Autour de moi[  ]»/);
  });
});

describe('1.2.9 (relecture) : lignes reprises de la 1.2.5 sur l’accueil', () => {
  it('l’accueil les complète lui-même : « Tram 3, Tram 4 », sans attendre l’écran « Lignes »', async () => {
    const { harness: hz0, mount: mount0, preset11, SCENARIO, textOf, until } = await import('./helpers');
    const { homeScreen } = await import('../../src/phone/screens/home');
    // les lignes déjà cherchées par un test précédent (même module) : oubliées
    (await import('../../src/phone/screens/picks')).resetKnownLines();
    const hz = hz0({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const el = mount0(homeScreen(hz.ctx));
    const lignes = () => [...el.querySelectorAll<HTMLAnchorElement>('.mirror .nav-row')].find((a) => /Lignes/.test(textOf(a.querySelector('.t1'))))!;
    await until(() => (hz.settings.get().follows ?? []).every((f) => f.routes.length > 0));
    await until(() => /Tram 3, Tram 4$/.test(lignes().getAttribute('aria-label') ?? ''));
    expect(textOf(lignes().querySelector('.count'))).toBe('2 lignes');
  });
});
