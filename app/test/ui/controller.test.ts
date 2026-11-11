/**
 * Contrôleur des lunettes avec le faux cœur 1.1, une horloge simulée et un faux port SDK qui enregistre les appels :
 * démarrage sans écran noir, mises à jour sans reconstruction, gestes des critères d'acceptation du PRD 1.1
 * (CA-M1.x, CA-M2.x, CA-M6.x, CA-S2.x), trajet suivi et en cours, GlassesApi, arrière-plan.
 */
import { describe, expect, it } from 'vitest';
import type { Core } from '../../src/core/api';
import { QuaiError } from '../../src/core/errors';
import { TRIP_KEY, parseTrip, tripPhase } from '../../src/glasses/controller';
import type { ContainerSpec } from '../../src/glasses/types';
import { at, defaults, preset, preset11, setupController, type Screen } from './helpers';

const homeReady = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => /   …$/.test(l)) && s.lines.some((l) => l.startsWith('Autour de moi   ') && !l.endsWith('…'));
const stepsReady = (s: Screen) => s.screen === 'steps' && s.page !== undefined;
const listReady = (s: Screen) => s.screen === 'favorites' && !s.lines.some((l) => /   …$/.test(l));

describe('contrôleur des lunettes : démarrage, rendu, sortie', () => {
  it('démarre par une page de chargement puis l’accueil (jamais d’écran noir)', async () => {
    const { rec, logs, screens, c, until } = await setupController();
    expect(rec.calls[0].op).toBe('start');
    expect(rec.calls.filter((x) => x.op === 'start')).toHaveLength(1);
    expect(screens()[0]).toMatchObject({ screen: 'message', lines: ['Chargement…'] });
    expect(logs).toContain('QUAI_READY');
    expect((await until(homeReady)).screen).toBe('home');
    c.stop();
  });

  it('mises à jour sans clignotement : textContainerUpgrade pour les changements de texte', async () => {
    const { rec, c, settle, until } = await setupController();
    await until(homeReady);
    await settle();
    const before = rec.calls.length;
    c.onGesture('down');
    await settle();
    const after = rec.calls.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((x) => x.op === 'upgrade')).toBe(true);
    expect((after[0].arg as ContainerSpec).name).toBe('cursor');
    c.stop();
  });

  it('toucher ouvre, double toucher revient, puis demande la sortie système (« double : quitter »)', async () => {
    const { c, last, gesture, until, rec, closeWebView } = await setupController();
    expect((await until(homeReady)).lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir   double : quitter');
    await gesture('tap');
    expect((await until(stepsReady)).title).toBe('Vers le bureau : 07:35 → 09:00');
    await gesture('double');
    expect(last().screen).toBe('home');
    await gesture('double');
    expect(rec.calls.at(-1)).toEqual({ op: 'exit', arg: 1 });
    // Annulation : l'appli reste active. Confirmation : SYSTEM_EXIT_EVENT → arrêt et fermeture de la page.
    c.onSignal({ kind: 'exit', abnormal: false });
    expect(closeWebView).toHaveBeenCalledTimes(1);
    const n = rec.calls.length;
    await c.render();
    expect(rec.calls.length).toBe(n);
  });

  it('appli non configurée : message, pas d’écran noir', async () => {
    const { last, c } = await setupController({ configured: false });
    expect(last().lines[0]).toBe('Quai n’est pas encore configuré.');
    expect(last().lines.at(-1)).toBe('double toucher : quitter');
    c.stop();
  });

  it('CA-M8.7 : horaires injoignables au lancement, nouvel essai toutes les 30 s (et au toucher)', async () => {
    let fail = true;
    const flaky = (core: Core): Core => Object.assign(Object.create(core) as Core, { init: () => (fail ? Promise.reject(new QuaiError('dataUnreachable')) : core.init()) });
    const { c, last, until, gesture } = await setupController({ wrap: flaky });
    expect(last()).toMatchObject({ screen: 'message', lines: ['Horaires injoignables : nouvel essai dans 30 s', 'toucher : réessayer   double : quitter'] });
    await c.refreshCurrent();
    expect(last().lines[0]).toBe('Horaires injoignables : nouvel essai dans 30 s');
    fail = false;
    await gesture('tap');
    expect((await until(homeReady)).screen).toBe('home');
    c.stop();
  });

  it('CA-M8.6 (lancement) : le serveur répond sans le fichier, « vérifie la publication de cette nuit »', async () => {
    const missing = (core: Core): Core => Object.assign(Object.create(core) as Core, { init: () => Promise.reject(new QuaiError('dataUnavailable')) });
    const { last, c } = await setupController({ wrap: missing });
    expect(last().lines[0]).toBe('Données indisponibles : vérifie la publication de cette nuit');
    c.stop();
  });

  it('arrière-plan : pause puis reprise avec reconstruction de la page', async () => {
    const { c, rec, settle, until } = await setupController();
    await until(homeReady);
    c.onSignal({ kind: 'background' });
    const n = rec.calls.length;
    await c.refreshCurrent();
    expect(rec.calls.length).toBe(n);
    c.onSignal({ kind: 'foreground' });
    await settle();
    await settle();
    expect(rec.calls.slice(n).some((x) => x.op === 'rebuild')).toBe(true);
    c.stop();
  });

  it('réglages modifiés sur le téléphone : l’écran suit tout de suite', async () => {
    const { c, last, gesture, until, settings, settle } = await setupController({ scenario: 's2' });
    await until((s) => s.screen === 'board');
    await gesture('double');
    await until(homeReady);
    await gesture('down', 'down', 'tap');
    await until((s) => s.screen === 'nearby' && s.lines.length > 2);
    expect(last().lines).toContain('~ horaire prévu, sans temps réel');
    expect(last().lines.at(-1)).toBe('▲▼ arrêt   toucher : départs   double : retour');
    await settings.update((s) => ({ ...s, display: { ...s.display, markPlanned: false, gestureHints: false } }));
    await settle(60);
    expect(last().screen).toBe('nearby');
    expect(last().lines.some((l) => l.includes('~'))).toBe(false);
    expect(last().lines.some((l) => l.startsWith('▲▼'))).toBe(false);
    c.stop();
  });
});

describe('M1 : favoris « réponse directe »', () => {
  it('CA-M1.1 : S1 sans temps réel, accueil, ordre, note, ligne du haut', async () => {
    const { c, until } = await setupController({ flags: { noRt: true } });
    const s = await until(homeReady);
    expect(s.lines).toEqual([
      'Temps réel indisponible : horaires prévus ~',
      'Vers le bureau   partir dans 2 min',
      'IC à ~07:42, voie 4, direct, arrivée 08:58',
      'Namur, train   IC ~07:42 v.4',
      'vers Bruxelles-Midi, puis ~08:42',
      'Autour de moi   3 arrêts',
      'Autres favoris   4',
      '~ horaire prévu, sans temps réel',
      '▲▼ choisir   toucher : ouvrir   double : quitter',
    ]);
    expect(s.order?.slice(0, 2)).toEqual(['fav-bureau', 'fav-namur']);
    c.stop();
  });

  it('CA-M1.2 et CA-M1.9 : S1 temps réel ; « Aller à… » atteint par ▼ quand la ligne du haut et la note prennent la place', async () => {
    const a = await setupController();
    const s = await a.until(homeReady);
    expect(s.lines.slice(0, 4)).toEqual(['Vers le bureau   partir dans 4 min', 'IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00', 'Namur, train   IC 07:42 +2 v.6 !', 'vers Bruxelles-Midi, puis 08:42']);
    expect(s.lines).toContain('Aller à…');
    a.c.stop();
    const b = await setupController({ flags: { stale: true, noRt: true } });
    const st = await b.until(homeReady);
    expect(st.lines[0]).toMatch(/^Horaires périmés : mise à jour arrêtée le /);
    expect(st.lines).not.toContain('Aller à…');
    expect(st.lines).toContain('Autres favoris   4');
    await b.gesture('down', 'down', 'down', 'down');
    expect(b.last().lines).toContain('Aller à…');
    expect(b.last().sel).toBe(4);
    b.c.stop();
  });

  it('CA-M1.3 : S2, l’arrêt favori s’ouvre seul ; TT : l’accueil ; ▼ ▼ ▼ T : « Autres favoris »', async () => {
    const { c, last, gesture, until } = await setupController({ scenario: 's2' });
    const board = await until((s) => s.screen === 'board');
    expect(board.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(board.lines[0]).toBe('T3   Churchill   2 min');
    await gesture('double');
    const home = await until(homeReady);
    expect(home.lines.slice(0, 4)).toEqual(['Gare du Nord, tram   T3 2 min', 'vers Churchill, puis T4 Stalle 5 min', 'Bruxelles-Nord, bus De Lijn   232 ~5 min', 'vers Vilvorde, puis 460 Meise 10 min']);
    expect(home.lines.some((l) => l.startsWith('Près de'))).toBe(false);
    await gesture('down', 'down', 'down', 'tap');
    const list = await until(listReady);
    expect(list.title).toBe('Autres favoris');
    expect(list.order).toEqual(['fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    expect(list.lines.slice(2, 4)).toEqual(['Vers Gand-Saint-Pierre   départ 14:10', 'IC voie 4 à Bruxelles-Central, arrivée 14:39']);
    expect(last().lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir   double : retour');
    c.stop();
  });

  it('CA-M1.4 : S3, « Vers Gand-Saint-Pierre » en tête', async () => {
    const { c, until } = await setupController({ scenario: 's3' });
    const s = await until(homeReady);
    expect(s.lines.slice(0, 2)).toEqual(['Vers Gand-Saint-Pierre   partir dans 13 min', 'IC à 14:10, voie 4, direct, arrivée 14:39']);
    expect(s.order?.[0]).toBe('fav-gand');
    c.stop();
  });

  it('CA-M1.5 : au bureau, « tu y es » en fin de liste ; T : « Tu es déjà au bureau. »', async () => {
    const { c, last, gesture, until } = await setupController({ pos: { lat: 50.8441, lon: 4.3474 } });
    await until(homeReady);
    await gesture('down', 'down', 'down', 'tap');
    const list = await until(listReady);
    const i = list.lines.indexOf('Vers le bureau   tu y es');
    expect(i).toBeGreaterThan(0);
    expect(list.order?.indexOf('fav-bureau')).toBeGreaterThanOrEqual((list.order?.length ?? 0) - 2);
    // le favori n'a pas de 2e ligne
    expect(list.lines[i + 1] === undefined || !/^IC |^à pied/.test(list.lines[i + 1])).toBe(true);
    const pos = list.order!.indexOf('fav-bureau');
    for (let k = 0; k < pos; k++) c.onGesture('down');
    await gesture('tap');
    expect(await until((s) => s.screen === 'message')).toMatchObject({ title: 'Vers le bureau', lines: ['Tu es déjà au bureau.', 'double toucher : retour'] });
    expect(last().screen).toBe('message');
    c.stop();
  });

  it('CA-M1.6 : l’ordre de la liste reste figé pendant 2 min de rafraîchissements, les heures changent', async () => {
    const { c, gesture, until, flags, advance, last } = await setupController({ flags: { noRt: true } });
    await until(homeReady);
    await gesture('down', 'down', 'down', 'tap');
    const first = await until(listReady);
    flags.noRt = false;
    const seen = new Set<string>();
    for (let k = 0; k < 4; k++) {
      advance(30_000);
      await c.refreshCurrent();
      await until(listReady);
      expect(last().order).toEqual(first.order);
      seen.add(last().lines.join('|'));
    }
    expect(seen.has(first.lines.join('|'))).toBe(false);
    c.stop();
  });

  it('CA-M1.8 : sans position, « sans position » ; T sur le trajet : « Position indisponible. »', async () => {
    const { c, gesture, until } = await setupController({ pos: null });
    const s = await until(homeReady);
    expect(s.lines[0]).toBe('Vers le bureau   sans position');
    expect(s.lines).toContain('Autour de moi   sans position');
    await gesture('tap');
    expect((await until((x) => x.screen === 'message')).lines.slice(0, 2)).toEqual(['Position indisponible.', 'Autorise la position pour Quai dans l’appli Even.']);
    c.stop();
  });

  it('accueil sans favori (CA-S1.3) : « Ajouter un favori » ouvre la liste vide', async () => {
    const { c, gesture, until } = await setupController({ settings: { ...preset11(), favorites: [] } });
    const s = await until((x) => x.screen === 'home' && !x.lines.some((l) => l.endsWith('…') && l !== 'Aller à…'));
    expect(s.lines.slice(1)).toEqual(['Ajouter un favori', 'Autour de moi   3 arrêts', 'Aller à…', '▲▼ choisir   toucher : ouvrir   double : quitter']);
    expect(s.lines[0]).toBe('Près de Namur');
    await gesture('tap');
    expect((await until((x) => x.screen === 'message')).lines).toEqual(['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', 'ou ajoute un trajet sur le téléphone.', 'double toucher : retour']);
    c.stop();
  });

  it('« Accueil sans favoris » : « Près de … », « Mes favoris   6 » ouvre toute la liste dans l’ordre intelligent', async () => {
    const s = preset11();
    s.display.opening = 'home';
    const { c, gesture, until } = await setupController({ settings: s });
    const home = await until((x) => x.screen === 'home' && x.lines.some((l) => l.startsWith('Autour de moi   3')));
    expect(home.lines.slice(0, 4)).toEqual(['Près de Namur', 'Autour de moi   3 arrêts', 'Mes favoris   6', 'Aller à…']);
    await gesture('down', 'tap');
    const list = await until(listReady);
    expect(list.title).toBe('Mes favoris');
    expect(list.order).toEqual(['fav-bureau', 'fav-namur', 'fav-gdn', 'fav-gand', 'fav-dl-nord', 'fav-maison']);
    c.stop();
  });

  it('« Toujours ouvrir le favori en tête » : les étapes du 1er favori, suivi', async () => {
    const s = preset11();
    s.display.opening = 'firstFavorite';
    const { c, until } = await setupController({ settings: s });
    const st = await until(stepsReady);
    expect(st).toMatchObject({ title: 'Vers le bureau : 07:35 → 09:00', page: 1, followed: true });
    c.stop();
  });
});

describe('M2 : un toucher, le trajet ; un glissement, un autre trajet', () => {
  it('CA-M2.1 et CA-M2.3 : étapes du trajet suivi ; T : « Dans le train » ; TT : même page', async () => {
    const { c, gesture, until, last } = await setupController();
    await until(homeReady);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(s).toMatchObject({ page: 1, pages: 3, label: 'simple', followed: true, title: 'Vers le bureau : 07:35 → 09:00', sel: 0 });
    expect(s.lines).toEqual([
      '! Voie modifiée : l’IC part de la voie 6',
      '07:35   Partir à pied vers la gare (7 min)   dans 4 min',
      '07:42   IC vers Bruxelles-Midi, voie 6   +2 min',
      '08:48   Descendre à Bruxelles-Central',
      '09:00   Arrivée au bureau (12 min à pied)',
      '▼ Le suivant : 08:33 → 09:58',
      '▲▼ autre trajet   toucher : détail   double : retour',
    ]);
    await gesture('tap');
    expect(last()).toMatchObject({ screen: 'train', title: 'IC vers Bruxelles-Midi, +2 min' });
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'steps', page: 1 });
    c.stop();
  });

  it('CA-M2.2 : ▼ ▼ ▼ ▲ ▲ : pages, étiquettes, trajet suivi inchangé', async () => {
    const { c, gesture, until, last } = await setupController({ flags: { noRt: true } });
    await until(homeReady);
    await gesture('tap');
    expect((await until(stepsReady)).lines[0]).toBe('Le plus simple : direct, à pied 7 + 12 min');
    await gesture('down');
    expect(last()).toMatchObject({ page: 2, label: 'next', followed: false, title: 'Vers le bureau : 08:33 → 09:58', sel: -1 });
    expect(last().lines[0]).toBe('Le suivant : même trajet, 1 h plus tard');
    expect(last().lines).toContain('~08:42   IC vers Bruxelles-Midi, voie 4');
    expect(last().lines.slice(-2)).toEqual(['▼ Le suivant : 09:33 → 10:58', '▲▼ autre trajet   toucher : suivre ce trajet   double : retour']);
    await gesture('down');
    expect(last()).toMatchObject({ page: 3 });
    expect(last().lines).toContain('▲ trajet précédent');
    const n = last();
    // ▼ de plus : même page, même trajet suivi ; « Pas d’autre trajet pour l’instant » dit en message court (DECISIONS § 7)
    await gesture('down');
    expect(last()).toMatchObject({ page: 3, title: n.title, followed: false });
    expect(last().lines.slice(0, -1)).toEqual(n.lines.slice(0, -1));
    expect(last().lines.at(-1)).toBe('Pas d’autre trajet pour l’instant');
    await gesture('up', 'up');
    expect(last()).toMatchObject({ page: 1, followed: true });
    expect(c.followed?.journey.legs.find((l) => l.kind === 'ride')?.schedDep).toBe(at(7, 42));
    c.stop();
  });

  it('CA-M2.4 : « Aller à… », T sur « Bureau » : les étapes directement, jamais « journeys »', async () => {
    const { c, gesture, until, screens } = await setupController();
    await until(homeReady);
    await gesture('down', 'down', 'down', 'down', 'tap');
    const places = await until((s) => s.screen === 'places' && s.lines.some((l) => l.startsWith('Bureau   arrivée')));
    expect(places.lines).toEqual(['Maison   ici', 'Bureau   arrivée 09:00', 'Autre adresse   sur le téléphone', '▲▼ choisir   toucher : trajet   double : retour']);
    await gesture('down', 'tap');
    const s = await until(stepsReady);
    expect(s).toMatchObject({ title: 'Vers le bureau : 07:35 → 09:00', page: 1, followed: true });
    expect(screens().some((x) => x.screen === 'journeys' || x.screen === 'trip')).toBe(false);
    c.stop();
  });

  it('CA-S4.1 : une adresse récente dans « Aller à… », T : ses étapes ; effacées, elles disparaissent (CA-S4.2)', async () => {
    const s = preset11();
    s.recent = [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }];
    const { c, gesture, until, settings } = await setupController({ scenario: 's3', settings: s });
    await until(homeReady);
    await gesture('down', 'down', 'down', 'down', 'tap');
    const places = await until((x) => x.screen === 'places' && x.lines.some((l) => l.startsWith('Veldstraat 1   arrivée')));
    expect(places.lines).toEqual(['Maison   arrivée 18:23', 'Bureau   12 min à pied', 'Veldstraat 1   arrivée 14:57', 'Autre adresse   sur le téléphone', '▲▼ choisir   toucher : trajet   double : retour']);
    await gesture('down', 'down', 'tap');
    const st = await until(stepsReady);
    expect(st).toMatchObject({ title: 'Vers Veldstraat 1 : 14:10 → 14:57', page: 1, followed: true, label: 'simple' });
    expect(st.lines).toContain('14:39   À pied vers l’arrêt du tram (1 min)');
    await gesture('double');
    await settings.update((x) => ({ ...x, recent: [] }));
    const after = await until((x) => x.screen === 'places' && !x.lines.some((l) => l.endsWith('…')));
    expect(after.lines.some((l) => l.startsWith('Veldstraat'))).toBe(false);
    c.stop();
  });

  it('Aller à… : Maison depuis la maison, « Tu es déjà à la maison. » ; « Autre adresse » : un message', async () => {
    const { c, gesture, until, last } = await setupController();
    await until(homeReady);
    await gesture('down', 'down', 'down', 'down', 'tap');
    await until((s) => s.screen === 'places' && s.lines[0] === 'Maison   ici');
    await gesture('tap');
    expect(await until((s) => s.screen === 'message')).toMatchObject({ title: 'Vers la maison', lines: ['Tu es déjà à la maison.', 'double toucher : retour'] });
    await gesture('double', 'down', 'down', 'tap');
    expect(last().lines.at(-1)).toBe('Tape l’adresse dans Quai, sur le téléphone');
    c.stop();
  });

  it('CA-M2.5 : S3, Gand-Saint-Pierre : « Dans le train » à 14:10, aide à l’arrivée à 14:36', async () => {
    const { c, gesture, until, last, goTo } = await setupController({ scenario: 's3' });
    await until(homeReady);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(s.title).toBe('Vers Gand-Saint-Pierre : 14:10 → 14:39');
    expect(s.lines.slice(0, 3)).toEqual(['Le plus simple : direct', '14:10   IC vers Bruges, voie 4   dans 15 min', '14:39   Arrivée à Gand-Saint-Pierre']);
    expect(s.lines).toContain('▼ Le suivant : 14:25 → 14:56');
    goTo(at(14, 10, 20));
    await c.refreshCurrent();
    expect(last()).toMatchObject({ screen: 'train', title: 'IC vers Bruges' });
    goTo(at(14, 36, 20));
    await c.refreshCurrent();
    expect(last()).toMatchObject({ screen: 'arrival', title: 'Arrivée à Gand-Saint-Pierre' });
    c.stop();
  });

  it('CA-M2.6 : téléphone, 2e carte : page 2 suivie, message ; pas « dans le train » du 14:10, mais du 14:22', async () => {
    const h = await setupController({ scenario: 's3' });
    await h.until(homeReady);
    const s = preset11();
    const fav = s.favorites.find((f) => f.id === 'fav-gand')!;
    if (fav.kind !== 'trip') throw new Error('fav-gand');
    const result = await h.core.route(fav.from, fav.to, h.clock.now(), s, { lat: 50.8454, lon: 4.3571 });
    const msg = await h.c.showTrip({ title: 'Vers Gand-Saint-Pierre', from: fav.from, to: fav.to, result, index: 1 });
    expect(msg).toBe('Affiché dans les lunettes : IC 14:22, voie 6.');
    const st = await h.until(stepsReady);
    expect(st).toMatchObject({ page: 2, followed: true, title: 'Vers Gand-Saint-Pierre : 14:25 → 14:56' });
    h.goTo(at(14, 10, 30));
    await h.c.refreshCurrent();
    expect(h.last()).toMatchObject({ screen: 'steps', page: 2 });
    h.goTo(at(14, 25, 30));
    await h.c.refreshCurrent();
    expect(h.last()).toMatchObject({ screen: 'train', title: 'IC vers Anvers-Central, +3 min' });
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'steps', page: 2, followed: true });
    await h.gesture('double');
    expect(h.last().screen).toBe('home');
    h.c.stop();
  });

  it('CA-M2.7 : trajet entièrement à pied, T ne fait rien', async () => {
    const { c, gesture, until, last } = await setupController({ pos: { lat: 50.848, lon: 4.352 }, now: at(10, 0) });
    const home = await until(homeReady);
    expect(home.lines.slice(0, 2)).toEqual(['Vers le bureau   à pied 9 min', 'à pied, arrivée 10:09']);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(s.lines[0]).toBe('Le plus simple : à pied, 9 min');
    expect(s.lines.slice(1, 3)).toEqual(['10:00   Partir à pied (9 min)   en cours', '10:09   Arrivée au bureau']);
    expect(s.lines.at(-1)).toBe('▲▼ autre trajet   double : retour');
    await gesture('tap');
    expect(last()).toEqual(s);
    c.stop();
  });

  it('CA-M2.8 : page 2 affichée à 07:42, l’écran passe « dans le train » de l’IC de 07:42 ; T sur la page 2 la fait suivre', async () => {
    const a = await setupController({ flags: { noRt: true } });
    await a.until(homeReady);
    await a.gesture('tap');
    await a.until(stepsReady);
    await a.gesture('down');
    expect(a.last()).toMatchObject({ page: 2, followed: false });
    a.goTo(at(7, 42, 20));
    await a.c.refreshCurrent();
    expect(a.last()).toMatchObject({ screen: 'train', title: 'IC vers Bruxelles-Midi' });
    expect(a.last().lines[0]).toMatch(/^Namur   ~07:42/);
    await a.gesture('double');
    expect(a.last()).toMatchObject({ screen: 'steps', page: 1, followed: true });
    a.c.stop();

    const b = await setupController({ flags: { noRt: true } });
    await b.until(homeReady);
    await b.gesture('tap');
    await b.until(stepsReady);
    await b.gesture('down', 'tap');
    expect(b.last()).toMatchObject({ page: 2, followed: true });
    expect(b.last().lines.at(-1)).toBe('Trajet suivi : IC 08:42');
    expect(b.c.followed?.journey.legs.find((l) => l.kind === 'ride')?.schedDep).toBe(at(8, 42));
    // la page 1 n'est plus suivie ; à 07:42, rien ne se passe
    await b.gesture('up');
    expect(b.last()).toMatchObject({ page: 1, followed: false });
    b.goTo(at(7, 42, 20));
    await b.c.refreshCurrent();
    expect(b.last().screen).toBe('steps');
    b.c.stop();
  });
});

describe('M6 : sans mauvaise surprise', () => {
  it('CA-M6.1 et CA-M6.2 : retrait annulable dans les 5 s, à l’identique ; ensuite, nouvel ajout « Jamais »', async () => {
    const { c, gesture, until, last, settings, advance } = await setupController({ scenario: 's2' });
    await until((s) => s.screen === 'board');
    const before = structuredClone(settings.get().favorites);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Retiré. Toucher encore : annuler');
    expect(last().title).toBe('Gare du Nord, tram (STIB)');
    expect(settings.get().favorites.some((f) => f.id === 'fav-gdn')).toBe(false);
    advance(4_000);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Favori rétabli');
    expect(last().title).toBe('Gare du Nord, tram (STIB) ★');
    expect(settings.get().favorites).toEqual(before);
    // retrait, puis toucher après 6 s : nouveau favori « Jamais », en fin de liste
    await gesture('tap');
    advance(6_000);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Ajouté aux favoris');
    const favs = settings.get().favorites;
    expect(favs.at(-1)).toMatchObject({ kind: 'stop', areaId: 'stib:6357F', propose: 'never' });
    expect(favs.some((f) => f.id === 'fav-gdn')).toBe(false);
    // ▲▼ ne déplacent aucun curseur
    const s = last();
    await gesture('down', 'up');
    expect(last().sel).toBe(-1);
    expect(last().lines.slice(0, 5)).toEqual(s.lines.slice(0, 5));
    c.stop();
  });

  it('le message de retrait ne suit pas sur l’écran suivant, et ne s’annule plus après un changement d’écran', async () => {
    const { c, gesture, until, last, settings } = await setupController({ scenario: 's2' });
    await until((s) => s.screen === 'board');
    await gesture('tap', 'double');
    await until(homeReady);
    expect(last().lines).not.toContain('★ Retiré. Toucher encore : annuler');
    expect(last().lines.at(-1)).toBe('▲▼ choisir   toucher : ouvrir   double : quitter');
    expect(settings.get().favorites.some((f) => f.id === 'fav-gdn')).toBe(false);
    c.stop();
  });

  it('CA-M6.3 : trajet en cours sur l’accueil, puis repris à la réouverture près d’Ottignies', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await a.gesture('tap');
    await a.until(stepsReady);
    a.goTo(at(7, 36));
    await a.c.refreshCurrent();
    await a.gesture('double');
    const home = await a.until(homeReady);
    expect(home.lines[0]).toBe('En cours : vers le bureau   IC 07:44, voie 6');
    // T sur « En cours » : le trajet, à l'écran qui correspond à l'heure
    await a.gesture('tap');
    expect(a.last()).toMatchObject({ screen: 'steps', followed: true, page: 1 });
    await a.gesture('double', 'double');
    a.c.onSignal({ kind: 'exit', abnormal: false });
    await a.settle();
    expect(parseTrip(await a.kv.get(TRIP_KEY))?.title).toBe('Vers le bureau');

    const b = await setupController({ kv: a.kv, now: at(8, 5), pos: { lat: 50.6727, lon: 4.5694 } });
    const s = await b.until((x) => x.screen === 'train');
    expect(s.title).toBe('IC vers Bruxelles-Midi, +2 min');
    expect(s.lines.at(-1)).toBe('Trajet en cours : vers le bureau');
    // TT : les étapes, puis l'accueil où « En cours » reste
    await b.gesture('double');
    expect(b.last()).toMatchObject({ screen: 'steps', followed: true });
    await b.gesture('double');
    expect((await b.until(homeReady)).lines[0]).toBe('En cours : vers le bureau   descente 08:48');
    b.c.stop();
  });

  it('CA-M6.4 : TT avant l’heure de départ, rouvert à 07:50 (toujours à la maison) : l’accueil sans « En cours »', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await a.gesture('tap');
    await a.until(stepsReady);
    a.goTo(at(7, 32));
    await a.gesture('double');
    a.c.stop();
    await a.settle();
    const b = await setupController({ kv: a.kv, now: at(7, 50) });
    const s = await b.until(homeReady);
    expect(s.lines[0]).not.toMatch(/^En cours/);
    expect(await b.kv.get(TRIP_KEY)).toBeNull();
    b.c.stop();
  });

  it('CA-M6.5 et CA-M6.6 : parti sans l’utilisateur, ou arrivé depuis plus de 5 min : plus de trajet en cours', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await a.gesture('tap');
    await a.until(stepsReady);
    a.goTo(at(7, 36));
    await a.c.refreshCurrent();
    a.c.stop();
    await a.settle();
    const saved = await a.kv.get(TRIP_KEY);
    expect(saved).toBeTruthy();
    // 07:50, toujours à la maison : l'IC de 07:44 est parti sans l'utilisateur
    const b = await setupController({ kv: a.kv, now: at(7, 50) });
    expect((await b.until(homeReady)).lines[0]).not.toMatch(/^En cours/);
    b.c.stop();
    // 09:10 (arrivée 09:00 plus 5 min), au bureau
    await a.kv.set(TRIP_KEY, saved!);
    const d = await setupController({ kv: a.kv, now: at(9, 10), pos: { lat: 50.8441, lon: 4.3474 } });
    expect((await d.until(homeReady)).lines[0]).not.toMatch(/^En cours/);
    d.c.stop();
    // 08:52, en train près de Bruxelles-Central : en cours, « arrivée 09:00 » après la descente
    await a.kv.set(TRIP_KEY, saved!);
    const e = await setupController({ kv: a.kv, now: at(8, 52), pos: { lat: 50.8454, lon: 4.3571 } });
    const st = await e.until((x) => x.screen === 'steps');
    expect(st.lines.at(-1)).toBe('Trajet en cours : vers le bureau');
    await e.gesture('double');
    expect((await e.until(homeReady)).lines[0]).toBe('En cours : vers le bureau   arrivée 09:00');
    e.c.stop();
  });

  it('un toucher sur un autre favori pendant un trajet en cours ne change pas le trajet suivi (R2)', async () => {
    const { c, gesture, until, goTo, last } = await setupController();
    await until(homeReady);
    await gesture('tap');
    await until(stepsReady);
    goTo(at(7, 36));
    await c.refreshCurrent();
    const followed = c.followed?.journey.id;
    await gesture('double');
    await until(homeReady);
    // « Autres favoris » puis Gand-Saint-Pierre (de gare à gare)
    await gesture('down', 'down', 'down', 'down', 'tap');
    const list = await until(listReady);
    const k = list.order!.indexOf('fav-gand');
    for (let i = 0; i < k; i++) c.onGesture('down');
    await gesture('tap');
    const s = await until(stepsReady);
    expect(s.title).toMatch(/^Vers Gand-Saint-Pierre/);
    expect(s.followed).toBe(false);
    expect(s.lines.at(-1)).toBe('▲▼ autre trajet   toucher : suivre ce trajet   double : retour');
    expect(c.followed?.journey.id).toBe(followed);
    // toucher : on le suit (geste explicite)
    await gesture('tap');
    expect(last()).toMatchObject({ followed: true });
    expect(c.followed?.journey.id).not.toBe(followed);
    c.stop();
  });

  it('le favori du trajet en cours rouvre ce trajet', async () => {
    const { c, gesture, until, goTo, last } = await setupController();
    await until(homeReady);
    await gesture('tap');
    await until(stepsReady);
    goTo(at(7, 36));
    await c.refreshCurrent();
    const id = c.followed?.journey.id;
    await gesture('double');
    await until(homeReady);
    await gesture('down', 'tap');
    expect(last()).toMatchObject({ screen: 'steps', followed: true, title: 'Vers le bureau : 07:35 → 09:00' });
    expect(c.followed?.journey.id).toBe(id);
    c.stop();
  });

  it('instantané d’arrière-plan : la pile et le trajet suivi passent à la nouvelle WebView', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await a.gesture('tap');
    await a.until(stepsReady);
    await a.gesture('down');
    const snap = JSON.stringify(a.c.snapshot());
    a.c.stop();
    const b = await setupController({ now: at(7, 33) });
    b.c.restore(snap);
    const s = await b.until((x) => x.screen === 'steps' && x.page === 2);
    expect(s.followed).toBe(false);
    expect(b.c.followed?.title).toBe('Vers le bureau');
    await b.gesture('up');
    expect(b.last()).toMatchObject({ page: 1, followed: true });
    b.c.stop();
  });
});

describe('S2 : message « Quai 1.1 », GlassesApi', () => {
  it('CA-S2.2 et CA-M7.1 : « Quai 1.1 » une seule fois après la mise à jour ; T mène à l’accueil', async () => {
    const a = await setupController({ settings: preset() });
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.1' });
    expect(a.last().lines).toEqual(['Nouveau : tes favoris donnent la réponse.', 'Toucher un favori : le trajet, étape par étape.', 'Sur un trajet, ▼ : un autre trajet.', 'Les adresses se tapent sur le téléphone.', 'toucher : continuer']);
    await a.gesture('tap');
    expect((await a.until(homeReady)).screen).toBe('home');
    await a.settle();
    expect(a.settings.get().seenVersion).toBe('1.1.0');
    a.c.stop();
    const b = await setupController({ settings: a.settings.get() });
    expect((await b.until(homeReady)).screen).toBe('home');
    expect(b.screens().some((s) => s.title === 'Quai 1.1')).toBe(false);
    b.c.stop();
  });

  it('nouvelle installation : bienvenue, jamais « Quai 1.1 » ; la version vue est écrite', async () => {
    const { c, last, gesture, until, settings, settle } = await setupController({ settings: defaults({ onboarded: false }) });
    await settle();
    expect(last()).toMatchObject({ screen: 'message', title: 'Quai' });
    expect(last().lines[0]).toBe('Bienvenue dans Quai !');
    expect(last().lines.at(-1)).toBe('toucher : continuer   double : quitter');
    expect(settings.get().seenVersion).toBe('1.1.0');
    await gesture('tap');
    expect((await until((s) => s.screen === 'home')).screen).toBe('home');
    c.stop();
  });

  it('showBoard : les départs de l’arrêt, message court', async () => {
    const { c, until } = await setupController({ scenario: 's2' });
    await until((s) => s.screen === 'board');
    const msg = await c.showBoard('delijn:308611');
    expect(msg).toBe('Affiché dans les lunettes : départs de Bruxelles-Nord.');
    expect((await until((s) => s.screen === 'board' && s.title.startsWith('Bruxelles-Nord'))).title).toBe('Bruxelles-Nord, bus (De Lijn) ★');
    expect(await c.showBoard('stib:6359')).toBe('Affiché dans les lunettes : départs de Rogier.');
    expect((await until((s) => s.title.startsWith('Rogier'))).title).toBe('Rogier, métro et tram (STIB)');
    c.stop();
  });

  it('GlassesApi par l’adaptateur du téléphone (glasses-link) : trajet suivi et départs, message rendu', async () => {
    const { showBoard, showTrip } = await import('../../src/phone/glasses-link');
    const h = await setupController({ scenario: 's3' });
    let shown = 0;
    const ctx = { glasses: () => h.c, showGlasses: () => void shown++ } as unknown as Parameters<typeof showTrip>[0];
    const s = preset11();
    const fav = s.favorites.find((f) => f.id === 'fav-gand')!;
    if (fav.kind !== 'trip') throw new Error('fav-gand');
    const result = await h.core.route(fav.from, fav.to, h.clock.now(), s, { lat: 50.8454, lon: 4.3571 });
    expect(await showTrip(ctx, { title: 'Vers Gand-Saint-Pierre', from: fav.from, to: fav.to, favoriteId: fav.id, result, index: 1 })).toEqual({ text: 'Affiché dans les lunettes\u00a0: IC 14:22, voie 6.', ok: true });
    expect((await h.until((x) => x.screen === 'steps' && x.page === 2)).followed).toBe(true);
    const gdn = s.favorites.find((f) => f.id === 'fav-gdn');
    expect(await showBoard(ctx, 'stib:6357F', gdn?.kind === 'stop' ? gdn.filter : undefined)).toEqual({ text: 'Affiché dans les lunettes\u00a0: départs de Gare du Nord.', ok: true });
    expect((await h.until((x) => x.screen === 'board')).title).toBe('Gare du Nord, tram (STIB) ★');
    expect(shown).toBe(2);
    h.c.stop();
  });

  it('showTrip : trajet à pied, message « à pied »', async () => {
    const h = await setupController({ pos: { lat: 50.848, lon: 4.352 }, now: at(10, 0) });
    await h.until(homeReady);
    const result = await h.core.route({ type: 'here' }, { type: 'place', placeId: 'bureau' }, h.clock.now(), preset11(), { lat: 50.848, lon: 4.352 });
    expect(await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, result, index: 0 })).toBe('Affiché dans les lunettes : à pied, 9 min.');
    expect((await h.until(stepsReady)).followed).toBe(true);
    h.c.stop();
  });
});

describe('trajet suivi : règles de fin (M6.3)', () => {
  const j = (dep: number, arr: number, leaveAt: number) => ({
    id: 'x', dep: leaveAt, arr, leaveAt, transfers: 0, rt: true, alerts: [],
    legs: [{ kind: 'ride' as const, from: { name: { fr: 'A', nl: 'A' }, lat: 50.4655, lon: 4.859 }, to: { name: { fr: 'B', nl: 'B' }, lat: 50.8, lon: 4.3 }, dep, arr, schedDep: dep, schedArr: arr }],
  });
  const origin = { lat: 50.4655, lon: 4.859 };
  const trip = { leaveAt0: at(7, 33), origin };

  it('avant le départ à pied, en cours, fini à l’arrivée plus 5 min ou si l’on n’est pas parti', () => {
    const jj = j(at(7, 42), at(9, 0), at(7, 33));
    expect(tripPhase(trip, jj, at(7, 31), null)).toBe('before');
    expect(tripPhase(trip, jj, at(7, 33), null)).toBe('running');
    expect(tripPhase(trip, jj, at(9, 4), null)).toBe('running');
    expect(tripPhase(trip, jj, at(9, 5), null)).toBe('ended');
    // après le départ du véhicule, une position prise depuis, à moins de 300 m du départ
    expect(tripPhase(trip, jj, at(7, 50), { ...origin, at: at(7, 50) })).toBe('ended');
    // position ancienne (avant le départ) : on ne conclut pas
    expect(tripPhase(trip, jj, at(7, 50), { ...origin, at: at(7, 40) })).toBe('running');
    expect(tripPhase(trip, jj, at(7, 50), { lat: 50.5, lon: 4.8, at: at(7, 50) })).toBe('running');
  });

  it('lecture défensive de quai.trip', () => {
    expect(parseTrip('')).toBeNull();
    expect(parseTrip('pas du json')).toBeNull();
    expect(parseTrip({ v: 2 })).toBeNull();
    const t = parseTrip({ v: 1, journey: j(1, 2, 0), title: 'Vers le bureau', leaveAt0: 0, startedAt: 0 });
    expect(t).toMatchObject({ title: 'Vers le bureau', index: 0, key: 'trip-x' });
    expect(t?.journeys).toHaveLength(1);
  });
});
