/**
 * Contrôleur des lunettes avec le faux cœur, une horloge simulée et un faux port SDK qui enregistre les appels :
 * démarrage sans écran noir, mises à jour sans reconstruction, gestes des critères d'acceptation du PRD 1.1
 * (CA-M1.x, CA-M2.x, CA-M6.x, CA-S2.x), trajet suivi et en cours, GlassesApi, arrière-plan.
 *
 * 1.2.1 (docs/v1.2.1/PRD-1.2.1.md) : sur l'accueil, « Favoris » (ou « En cours ») puis les favoris en retrait ; à
 * l'ouverture, le curseur est sur le premier favori montré (sur « En cours » s'il y est) : un toucher l'ouvre, ▲ mène
 * à « Favoris ». L'aide des gestes de l'accueil ne se montre que les 7 premiers jours : les réglages de
 * démonstration (version déjà vue) sont ceux d'un utilisateur de longue date, sans aide sur l'accueil. Sur un trajet,
 * ▼ fait défiler les étapes, puis ouvre « Autres trajets ». Classement du faux cœur (PRD-1.2.2 § 7) : à S1, la
 * proposition 1 vers le bureau est l'IC jusqu'à Bruxelles-Nord puis le tram 3 (arrivée 08:58), puis deux « Le suivant ».
 *
 * 1.2.2 (docs/v1.2.2/PRD-1.2.2.md, REVUE-USAGE.md) : réglages de la 1.1 migrés en v4 (favoris Bureau, Vers
 * Gand-Saint-Pierre et Maison ; « Gares » : Namur ; « Bus, tram, métro » : tram 3 et tram 4 à Gare du Nord, « près »,
 * et Bruxelles-Nord De Lijn, toutes les lignes) ; l'accueil finit par « Autour de moi », « Gares » et « Bus, tram,
 * métro » (§ 1.1), « Aller à… » a rejoint « Favoris » (§ 1.2) ; ouvrir un trajet ne le fait plus suivre : « Suivre ce
 * trajet » d'un toucher, ou le bouton « Lunettes » du téléphone (§ 6) ; à Gare du Nord (S2), « Bus, tram, métro »
 * s'ouvre d'office sur le tram 3 (ligne « près », REVUE-USAGE n° 4).
 */
import { describe, expect, it, vi } from 'vitest';

// Message « Quai 1.2.8 » (PRD-1.2.8 § 4) : la version de l'appli est fixée à 1.2.8 (celle de la publication).
vi.mock('../../src/version', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/version')>()), APP_VERSION: '1.2.8' }));
import type { Core, Journey, JourneyLabel, Leg } from '../../src/core/api';
import { textWidth } from '../../src/glasses/font';
import { layoutPage, geometry, WIDTHS } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import { NEWS_LINES, NEWS_LINES_128, stepsPage, type StepsData } from '../../src/glasses/views';
import { QuaiError } from '../../src/core/errors';
import { TRIP_KEY, parseTrip, tripPhase } from '../../src/glasses/controller';
import type { ContainerSpec } from '../../src/glasses/types';
import { APP_VERSION } from '../../src/version';
import { at, defaults, fakeCore, nb, overflowing, preset, preset11, setupController, type Screen } from './helpers';

const fakeCoreFor = (now: () => number) => fakeCore(now);

/** Accueil prêt : réponses des favoris, nombre d'arrêts et prochains départs des rubriques arrivés (plus de « … »). */
const homeReady = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => /   …$/.test(l)) && s.lines.some((l) => l.startsWith('Autour de moi   ') && !l.endsWith('…'));
const stepsReady = (s: Screen) => s.screen === 'steps' && s.page !== undefined;
const listReady = (s: Screen) => s.screen === 'favorites' && !s.lines.some((l) => /   …$/.test(l));
/** « Bus, tram, métro » prête : les passages de chaque ligne arrivés. */
const linesReady = (s: Screen) => s.screen === 'lines' && s.lines.length > 2 && !s.lines.some((l) => l.endsWith('…'));
const boardReady = (s: Screen) => s.screen === 'board' && s.lines.length > 2;
const followsReady = (s: Screen) => s.screen === 'follows' && s.lines.length > 1 && !s.lines.some((l) => l.endsWith('…'));
/** 1.2.6 (PRD-1.2.6 § 1) : les trois rubriques du préréglage (Namur ; Bruxelles-Nord De Lijn ; tram 3 et tram 4). */
const SECTIONS = ['Gares de train   1 gare', 'Arrêts de bus, tram, métro   1 arrêt', 'Lignes de bus, tram, métro   2 lignes'];

/** Titre logué d'un trajet : la ligne du titre, puis son état à droite (PRD-1.2.2 § 6). */
const FOLLOW = '   Suivre ce trajet';
const FOLLOWED = '   Suivi';
const HINT_FOLLOWED = '△▽ étapes   toucher : ne plus suivre   double : retour';
const HINT_FOLLOW = '△▽ étapes   toucher : suivre ce trajet   double : retour';

/** Ouvre le favori sous le curseur et le fait suivre (« Suivre ce trajet »), puis laisse passer le message. */
async function openAndFollow(h: Awaited<ReturnType<typeof setupController>>): Promise<Screen> {
  await h.gesture('tap');
  await h.until(stepsReady);
  await h.gesture('tap');
  expect(h.last().followed).toBe(true);
  h.advance(3_000);
  await h.c.render();
  return h.last();
}

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
    // nouvelle installation : l'aide des gestes de l'accueil (7 premiers jours) dit « double : quitter »
    const { c, last, gesture, until, rec, closeWebView } = await setupController({ settings: { ...preset11(), seenVersion: '' } });
    expect((await until(homeReady)).lines.at(-1)).toBe('△▽ choisir   toucher : ouvrir   double : quitter');
    await gesture('tap');
    expect(nb((await until(stepsReady)).title)).toBe(`Vers le bureau : 07:35 → 08:58${FOLLOW}`);
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
    // 1.2.2 (REVUE-USAGE n° 10) : « Pas de connexion aux horaires », une ligne des lunettes
    expect(last()).toMatchObject({ screen: 'message', lines: ['Pas de connexion aux horaires : nouvel essai dans 30 s', 'toucher : réessayer   double : quitter'] });
    await c.refreshCurrent();
    expect(last().lines[0]).toBe('Pas de connexion aux horaires : nouvel essai dans 30 s');
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
    await until(boardReady);
    await gesture('double');
    await until(homeReady);
    // du premier favori : le suivant, puis « Autour de moi »
    await gesture('down', 'down', 'tap');
    await until((s) => s.screen === 'nearby' && s.lines.length > 2);
    expect(last().lines).toContain('~ horaire prévu, sans temps réel');
    expect(last().lines.at(-1)).toBe('△▽ arrêt   toucher : départs   double : retour');
    await settings.update((s) => ({ ...s, display: { ...s.display, markPlanned: false, gestureHints: false } }));
    await settle(60);
    expect(last().screen).toBe('nearby');
    expect(last().lines.some((l) => l.includes('~'))).toBe(false);
    expect(last().lines.some((l) => l.startsWith('△▽'))).toBe(false);
    c.stop();
  });
});

describe('M1 : favoris « réponse directe » ; accueil de la 1.2.2', () => {
  it('CA-M1.1, CA-121.5, CA-122.1 et CA-126.1 : S1 sans temps réel : « Favoris », favoris sur une ligne, les trois rubriques, aucun pied', async () => {
    const { c, until } = await setupController({ flags: { noRt: true } });
    const s = await until(homeReady);
    expect(s.lines).toEqual([
      // sans « ~ » sur l'accueil, qui n'en affiche pas
      'Temps réel indisponible : horaires prévus',
      'Favoris   3',
      'Bureau   dans 2 min → 08:58',
      'Vers Gand-Saint-Pierre   07:40 → 08:09',
      '',
      'Autour de moi   3 arrêts',
      ...SECTIONS,
    ]);
    // ordre intelligent, Maison (tu y es) en fin de liste et jamais sur l'accueil
    expect(s.order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    expect(s.lines.join(' ')).not.toMatch(/Aller à/);
    c.stop();
  });

  it('CA-M1.2 et CA-M1.9 : S1 temps réel ; les trois rubriques toujours à l’écran, même avec la ligne du haut', async () => {
    const a = await setupController();
    const s = await a.until(homeReady);
    expect(s.lines).toEqual(['Favoris   3', 'Bureau   dans 4 min → 08:58', 'Vers Gand-Saint-Pierre   07:40 → 08:09', '', 'Autour de moi   3 arrêts', ...SECTIONS]);
    a.c.stop();
    // horaires périmés : la ligne du haut prend une ligne ; rien ne passe sous le bord
    const b = await setupController({ flags: { stale: true, noRt: true } });
    const st = await b.until(homeReady);
    expect(st.lines[0]).toMatch(/^Horaires périmés : mise à jour arrêtée le /);
    expect(st.lines[1]).toBe('Favoris   3');
    expect(st.lines.slice(-5)).toEqual(['', 'Autour de moi   3 arrêts', ...SECTIONS]);
    // du premier favori (curseur à l'ouverture) jusqu'à « Lignes de bus, tram, métro »
    expect(st.sel).toBe(1);
    await b.gesture('down', 'down', 'down', 'down', 'down');
    expect(b.last().sel).toBe(6);
    expect(b.last().lines.at(-1)).toBe('Lignes de bus, tram, métro   2 lignes');
    b.c.stop();
  });

  it('CA-M1.3, REVUE-USAGE n° 4 et CA-126.4 : S2, à Gare du Nord, les départs de l’arrêt repère du tram 3 s’ouvrent seuls ; TT : l’accueil ; T sur « Favoris » : la liste', async () => {
    const { c, last, gesture, until } = await setupController({ scenario: 's2' });
    // 1.2.6 : tram 3 et tram 4 gardés à Gare du Nord (1.2.1, « près ») sont suivis, l'arrêt en repère : à moins de
    // 300 m, ses départs s'ouvrent d'office, comme l'arrêt favori d'avant
    const board = await until(boardReady);
    expect(board.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(board.lines.slice(0, 3)).toEqual(['★ garder une ligne', 'T3   Churchill   2 min', 'T4   Stalle   5 min']);
    expect(board.sel).toBe(1);
    await gesture('double');
    const home = await until(homeReady);
    expect(home.lines).toEqual(['Favoris   3', 'Bureau   maintenant → 12:26', 'Vers Gand-Saint-Pierre   14:10 → 14:39', '', 'Autour de moi   4 arrêts', ...SECTIONS]);
    expect(home.lines.some((l) => l.startsWith('Près de'))).toBe(false);
    // curseur sur le premier favori ; ▲ : « Favoris »
    expect(home.sel).toBe(1);
    await gesture('up', 'tap');
    const list = await until(listReady);
    expect(list.title).toBe('Favoris');
    expect(list.order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    // la ligne de l'accueil, puis le détail
    expect(list.lines.slice(0, 2)).toEqual(['Bureau   maintenant → 12:26', 'tram 3 12:12, direct']);
    expect(last().lines.at(-1)).toBe('△▽ choisir   toucher : ouvrir   double : retour');
    c.stop();
  });

  it('CA-M1.4 : S3, « Vers Gand-Saint-Pierre » en tête', async () => {
    const { c, until } = await setupController({ scenario: 's3' });
    const s = await until(homeReady);
    expect(s.lines.slice(0, 3)).toEqual(['Favoris   3', 'Vers Gand-Saint-Pierre   dans 13 min → 14:39', 'Bureau   maintenant → 14:07']);
    expect(s.order?.[0]).toBe('fav-gand');
    c.stop();
  });

  it('CA-M1.5 : au bureau, « tu y es » : jamais sur l’accueil (règle 5), en fin de liste ; T : « Tu es déjà au bureau. »', async () => {
    const { c, last, gesture, until, settle } = await setupController({ pos: { lat: 50.8441, lon: 4.3474 } });
    const home = await until(homeReady);
    expect(home.lines.some((l) => l.startsWith('Bureau'))).toBe(false);
    await gesture('up', 'tap');
    const list = await until(listReady);
    expect(list.title).toBe('Favoris');
    const pos = list.order!.indexOf('fav-bureau');
    expect(pos).toBeGreaterThanOrEqual(list.order!.length - 2);
    for (let k = 0; k < pos; k++) c.onGesture('down');
    await settle();
    const shown = last();
    const i = shown.lines.indexOf('Bureau   tu y es');
    expect(i).toBeGreaterThanOrEqual(0);
    // le favori n'a pas de 2e ligne
    expect(shown.lines[i + 1] === undefined || !/^IC |^à pied/.test(shown.lines[i + 1])).toBe(true);
    await gesture('tap');
    expect(await until((s) => s.screen === 'message')).toMatchObject({ title: 'Vers le bureau', lines: ['Tu es déjà au bureau.', 'double toucher : retour'] });
    expect(last().screen).toBe('message');
    c.stop();
  });

  it('CA-M1.6 : l’ordre de la liste reste figé pendant 2 min de rafraîchissements, les heures changent', async () => {
    const { c, gesture, until, flags, advance, last } = await setupController({ flags: { noRt: true } });
    await until(homeReady);
    // « Favoris » : la liste de tous les favoris
    await gesture('up', 'tap');
    const first = await until(listReady);
    expect(first).toMatchObject({ screen: 'favorites', title: 'Favoris' });
    expect(first.order).toHaveLength(3);
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

  it('CA-M1.8 : sans position, « sans position » ; les trois rubriques : leur contenu ; T sur le trajet : « Position indisponible. »', async () => {
    const { c, gesture, until } = await setupController({ pos: null });
    const s = await until(homeReady);
    expect(s.lines).toEqual([
      'Favoris   3',
      'Bureau   sans position',
      'Vers Gand-Saint-Pierre   07:40 → 08:09',
      'Maison   sans position',
      '',
      'Autour de moi   sans position',
      ...SECTIONS,
    ]);
    await gesture('tap');
    expect((await until((x) => x.screen === 'message')).lines.slice(0, 2)).toEqual(['Position indisponible.', 'Autorise la position pour Quai dans l’appli Even.']);
    c.stop();
  });

  it('accueil sans favori (CA-S1.3) : « Ajouter un favori » ouvre « Favoris », où « Ajouter un favori » dit comment faire', async () => {
    const { c, gesture, until } = await setupController({ settings: { ...preset11(), favorites: [] } });
    const s = await until((x) => x.screen === 'home' && !x.lines.some((l) => l.endsWith('…')));
    expect(s.lines).toEqual(['Près de Namur', 'Ajouter un favori', '', 'Autour de moi   3 arrêts', ...SECTIONS]);
    await gesture('tap');
    expect((await until((x) => x.screen === 'favorites')).lines).toEqual(['Ajouter un favori   sur le téléphone', 'Autre adresse   sur le téléphone', '△▽ choisir   toucher : ouvrir   double : retour']);
    await gesture('tap');
    expect((await until((x) => x.screen === 'message')).lines).toEqual(['Aucun favori pour l’instant.', 'Ajoute Maison ou Bureau sur le téléphone.', 'double toucher : retour']);
    c.stop();
  });

  it('« Accueil sans favoris » : « Près de … », « Favoris   3 » sans favori dessous, ouvre toute la liste dans l’ordre intelligent', async () => {
    const s = preset11();
    s.display.opening = 'home';
    const { c, gesture, until } = await setupController({ settings: s });
    const home = await until((x) => x.screen === 'home' && x.lines.some((l) => l.startsWith('Autour de moi   3')) && !x.lines.some((l) => l.endsWith('…')));
    expect(home.lines).toEqual(['Près de Namur', 'Favoris   3', '', 'Autour de moi   3 arrêts', ...SECTIONS]);
    await gesture('tap');
    const list = await until(listReady);
    expect(list.title).toBe('Favoris');
    expect(list.order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    c.stop();
  });

  it('« Toujours ouvrir le favori en tête » : les étapes du 1er favori, pas suivies (CA-122.7)', async () => {
    const s = preset11();
    s.display.opening = 'firstFavorite';
    const { c, until } = await setupController({ settings: s });
    const st = await until(stepsReady);
    expect(st).toMatchObject({ page: 1, followed: false });
    expect(nb(st.title)).toBe(`Vers le bureau : 07:35 → 08:58${FOLLOW}`);
    expect(c.followed).toBeNull();
    c.stop();
  });

  it('CA-122.1 à CA-122.4, CA-126.2 et CA-126.3 : « Lignes… » : le tram 3 entier, ses passages à un arrêt, tous les départs de l’arrêt ; « Arrêts… » et « Gares de train » : leur tableau', async () => {
    const { c, gesture, until, last } = await setupController({ scenario: 's2' });
    await until(boardReady);
    await gesture('double');
    await until(homeReady);
    // « Lignes de bus, tram, métro » : un sens par rangée, sans attente (du premier favori : 5 fois ▼)
    await gesture('down', 'down', 'down', 'down', 'down', 'tap');
    const f = await until(followsReady);
    expect(f.title).toBe('Lignes de bus, tram, métro');
    expect(f.lines).toEqual(['Tram 3 vers Churchill', 'Tram 3 vers Esplanade', 'Tram 4 vers Stalle', '△▽ choisir   toucher : la ligne   double : retour']);
    // toucher : toute la ligne dans ce sens, le curseur sur l'arrêt le plus proche (à 80 m), le prochain passage en clair ;
    // 1.2.7 : ● seulement d'après le temps réel (ici, l'horaire prévu : aucun ●, pas de ligne du haut)
    await gesture('tap');
    const run = await until((x) => x.screen === 'lineRun' && x.lines.length > 3);
    expect(run.title).toBe('Tram 3 vers Churchill');
    expect(run.sel).toBe(1);
    expect(run.lines.slice(0, 2)).toEqual(['○ Esplanade   dans ~6 min', '○ Gare du Nord à 80 m   dans ~2 min']);
    expect(run.lines.at(-1)).toBe('△▽ arrêts   toucher : passages   double : retour');
    // toucher l'arrêt : les passages du tram 3 à Gare du Nord, dans les deux sens (4 chacun), puis tous les départs
    await gesture('tap');
    const d = await until((x) => x.screen === 'line' && x.lines.length > 3);
    expect(d.title).toBe('Tram 3 · Gare du Nord');
    // 1.2.3 : curseur sur le premier passage ; toucher un passage : ses arrêts (PRD-1.2.3 § 2)
    expect(d.sel).toBe(0);
    expect(d.lines.filter((l) => l.startsWith('vers ')).sort()).toEqual(['vers Churchill', 'vers Esplanade']);
    expect(d.lines.at(-1)).toBe('△▽ passages   toucher : arrêts   double : retour');
    for (let i = 0; i < 9; i++) await gesture('down');
    expect(last().lines).toContain('Tous les départs de l’arrêt');
    await gesture('tap');
    const b = await until(boardReady);
    expect(b.title).toBe('Gare du Nord, tram (STIB) ★');
    expect(b.lines[0]).toBe('★ garder une ligne');
    expect(b.lines.at(-1)).toBe('△▽ départs   toucher : arrêts   double : retour');
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'line', title: 'Tram 3 · Gare du Nord' });
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'lineRun', title: 'Tram 3 vers Churchill', sel: 1 });
    await gesture('double', 'double');
    // retour à l'accueil, le curseur sur « Lignes… » ; ▲ : « Arrêts… » : Bruxelles-Nord (De Lijn, toutes les lignes)
    expect((await until(homeReady)).sel).toBe(6);
    await gesture('up', 'tap');
    const stops = await until(linesReady);
    expect(stops.title).toBe('Arrêts de bus, tram, métro');
    expect(stops.lines[0]).toBe('Bruxelles-Nord');
    await gesture('tap');
    expect((await until((x) => x.screen === 'board' && x.title.startsWith('Bruxelles-Nord'))).title).toBe('Bruxelles-Nord, bus (De Lijn) ★');
    await gesture('double', 'double');
    // « Gares de train » : Namur ; toucher, son tableau
    expect((await until(homeReady)).sel).toBe(5);
    await gesture('up', 'tap');
    const st = await until((x) => x.screen === 'stations' && !x.lines.some((l) => l.endsWith('…')));
    expect(st).toMatchObject({ title: 'Gares de train', lines: ['Namur   IC 12:42 voie 4', '△▽ choisir   toucher : départs   double : retour'] });
    await gesture('tap');
    const namur = await until((x) => x.screen === 'board' && x.lines.length > 2);
    expect(namur.title).toBe('Namur, train (SNCB) ★');
    expect(namur.lines[0]).toBe('★ retirer la gare');
    expect(namur.lines.at(-1)).toBe('△▽ départs   toucher : arrêts   double : retour');
    await gesture('double');
    expect(last().screen).toBe('stations');
    c.stop();
  });
});

describe('M2 : un toucher, le trajet ; ▼ la suite, puis les autres trajets (1.2.1) ; suivi sur demande (1.2.2)', () => {
  it('CA-M2.1, CA-M2.3 et CA-122.7 : un favori ouvert n’est pas suivi ; « Suivre ce trajet » le suit ; T : « Ne plus suivre », « Arrêts : … » ; TT : même page', async () => {
    const h = await setupController();
    const { c, gesture, until, last } = h;
    await until(homeReady);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(s).toMatchObject({ page: 1, pages: 3, label: 'short', followed: false, sel: -1 });
    expect(nb(s.title)).toBe(`Vers le bureau : 07:35 → 08:58${FOLLOW}`);
    expect(s.lines).toEqual([
      '! Voie modifiée : l’IC part de la voie 6',
      '07:35   Partir à pied vers la gare (7 min)   dans 4 min',
      'Namur',
      '07:42   IC vers Bruxelles-Midi, voie 6   +2 min',
      '08:42   Descendre à Bruxelles-Nord',
      '08:42   À pied vers Gare du Nord (2 min)',
      // 1.2.5 (PRD-1.2.5 § 2) : l'IC a 2 min de retard, 2 min à pied, le tram à 08:44 : aucune marge
      '~08:44   Tram 3 vers Churchill   très juste',
      '▽ suite du trajet : 2 étapes',
      HINT_FOLLOW,
    ]);
    expect(c.followed).toBeNull();
    // toucher : « Suivre ce trajet » ; « Suivi » sur la ligne du titre, « ▶ » sur la 1re étape
    await gesture('tap');
    expect(last()).toMatchObject({ followed: true, sel: 0 });
    expect(nb(last().title)).toBe(`Vers le bureau : 07:35 → 08:58${FOLLOWED}`);
    expect(nb(last().lines.at(-1)!)).toBe('Trajet suivi : IC 07:42');
    h.advance(3_000);
    await c.render();
    expect(last().lines.at(-1)).toBe(HINT_FOLLOWED);
    // toucher : « Ne plus suivre », puis le détail du train (« Dans le train ») ; double toucher : la même page
    await gesture('tap');
    const menu = await until((x) => x.screen === 'followed');
    expect(nb(menu.title)).toBe('Vers le bureau : trajet suivi');
    expect(menu.lines).toEqual(['Ne plus suivre', 'Arrêts : IC vers Bruxelles-Midi, +2 min', '△▽ choisir   toucher : valider   double : retour']);
    await gesture('down', 'tap');
    expect(last()).toMatchObject({ screen: 'train', title: 'IC vers Bruxelles-Midi, +2 min' });
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'steps', page: 1, followed: true });
    c.stop();
  });

  it('CA-M2.2 et CA-121.4 : ▼ fait défiler les étapes, puis ouvre « Autres trajets » ; toucher, double toucher ; trajet suivi inchangé', async () => {
    const h = await setupController({ flags: { noRt: true } });
    const { c, gesture, until, last } = h;
    await until(homeReady);
    const p1 = await openAndFollow(h);
    // 1.2.5 (PRD-1.2.5 § 1) : départ à pied à 07:33 (sans temps réel), dans 2 min : « Si tu le rates » (l'IC suivant de
    // Namur, « Le suivant ») à la place de la raison
    expect(p1.lines[0]).toBe('Si tu le rates : arrivée 09:57, 59 min plus tard');
    expect(p1.lines.at(-2)).toBe('▽ suite du trajet : 2 étapes');
    // ▼ : la suite du même trajet, jamais un autre
    await gesture('down');
    expect(last()).toMatchObject({ page: 1, followed: true, title: p1.title });
    expect(last().lines.slice(-2)).toEqual(['Fin du trajet. ▽ 2 autres trajets', HINT_FOLLOWED]);
    // ▼ au bout : « Autres trajets »
    await gesture('down');
    const list = await until((s) => s.screen === 'others');
    expect(list.title).toBe('Vers le bureau : autres trajets');
    expect(list.lines).toEqual(['Le suivant   08:33 → 09:57', 'IC + tram 4, à pied 7 + 2 + 9 min', 'Plus tard   09:33 → 10:58', 'IC + tram 3, à pied 7 + 2 + 9 min', '△▽ choisir   toucher : voir   double : retour']);
    // toucher : la 2e entrée, non suivie
    await gesture('down', 'tap');
    const p3 = await until((s) => stepsReady(s) && s.page === 3);
    expect(p3).toMatchObject({ label: 'later', followed: false, sel: -1 });
    expect(nb(p3.title)).toBe(`Vers le bureau : 09:33 → 10:58${FOLLOW}`);
    expect(p3.lines[0]).toBe('Plus tard : 1 changement, départ 09:33');
    expect(p3.lines).toContain('~09:42   IC vers Bruxelles-Midi, voie 4');
    expect(p3.lines.at(-1)).toBe(HINT_FOLLOW);
    // double toucher : la liste, puis les étapes du 1er trajet, à leur fin
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'others', sel: 1 });
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'steps', page: 1, followed: true });
    expect(last().lines.at(-2)).toBe('Fin du trajet. ▽ 2 autres trajets');
    expect(c.followed?.journey.legs.find((l) => l.kind === 'ride')?.schedDep).toBe(at(7, 42));
    c.stop();
  });

  it('CA-M2.4 et CA-122.2 : « Favoris », T sur « Bureau » : les étapes directement, jamais « journeys » ; suivi : rattaché au lieu', async () => {
    const h = await setupController();
    const { c, gesture, until, screens } = h;
    await until(homeReady);
    await gesture('up', 'tap');
    const list = await until(listReady);
    expect(list.lines.slice(0, 2)).toEqual(['Bureau   dans 4 min → 08:58', 'IC 07:42 +2 voie 6 !, 1 changement']);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(s).toMatchObject({ page: 1, followed: false });
    expect(nb(s.title)).toBe(`Vers le bureau : 07:35 → 08:58${FOLLOW}`);
    expect(screens().some((x) => ['journeys', 'trip', 'places'].includes(x.screen))).toBe(false);
    // Le trajet suivi est rattaché au favori lieu : « ★ garder ce trajet » dira qu'il y est déjà.
    await gesture('tap');
    expect(c.followed?.favoriteId).toBe('fav-bureau');
    c.stop();
  });

  it('CA-S4.1 et CA-122.2 : une adresse récente dans « Favoris », sous « Adresses récentes », T : ses étapes ; effacées, elles disparaissent (CA-S4.2)', async () => {
    const s = preset11();
    // un lieu public (PRD-1.2.2, règle de confidentialité)
    s.recent = [{ label: 'Korenmarkt, 9000 Gent', lat: 51.0547, lon: 3.7217, at: 1 }];
    const { c, gesture, until, settings } = await setupController({ scenario: 's3', settings: s });
    await until(homeReady);
    await gesture('up', 'tap');
    await until(listReady);
    // Vers Gand-Saint-Pierre, Bureau, Maison, puis l'adresse, sous la ligne pâle (jamais sous le curseur)
    await gesture('down', 'down', 'down');
    const list = await until((x) => listReady(x) && x.lines.includes('ADRESSES RÉCENTES'));
    // la réponse au format de l'accueil (départ conseillé et arrivée)
    expect(list.lines.slice(-4)).toEqual(['ADRESSES RÉCENTES', 'Korenmarkt   dans 13 min → 14:55', 'Autre adresse   sur le téléphone', '△▽ choisir   toucher : ouvrir   double : retour']);
    await gesture('tap');
    const st = await until(stepsReady);
    expect(st).toMatchObject({ page: 1, followed: false, label: 'short' });
    expect(nb(st.title)).toBe(`Vers Korenmarkt : 14:10 → 14:55${FOLLOW}`);
    expect(st.lines).toContain('14:39   À pied vers l’arrêt du tram (1 min)');
    await gesture('double');
    await settings.update((x) => ({ ...x, recent: [] }));
    const after = await until((x) => x.screen === 'favorites' && !x.lines.includes('ADRESSES RÉCENTES'));
    expect(after.lines.some((l) => l.startsWith('Korenmarkt'))).toBe(false);
    c.stop();
  });

  it('« Favoris » : Maison depuis la maison, « Tu es déjà à la maison. » ; « Autre adresse » : un message', async () => {
    const { c, gesture, until, last } = await setupController();
    await until(homeReady);
    await gesture('up', 'tap');
    const list = await until(listReady);
    expect(list.lines).toContain('Maison   tu y es');
    // Bureau, Vers Gand-Saint-Pierre, puis Maison
    await gesture('down', 'down', 'tap');
    expect(await until((s) => s.screen === 'message')).toMatchObject({ title: 'Vers la maison', lines: ['Tu es déjà à la maison.', 'double toucher : retour'] });
    await gesture('double', 'down', 'tap');
    expect(last().lines.at(-1)).toBe('Tape l’adresse dans Quai, sur le téléphone');
    c.stop();
  });

  it('CA-M2.5 : S3, Gand-Saint-Pierre suivi : « Dans le train » à 14:10, aide à l’arrivée à 14:36', async () => {
    const h = await setupController({ scenario: 's3' });
    const { c, gesture, until, last, goTo } = h;
    await until(homeReady);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(nb(s.title)).toBe(`Vers Gand-Saint-Pierre : 14:10 → 14:39${FOLLOW}`);
    expect(s.lines.slice(0, 4)).toEqual(['Le plus court : direct', '14:10   IC vers Bruges, voie 4   dans 15 min', 'depuis Bruxelles-Central', '14:39   Arrivée à Gand-Saint-Pierre']);
    expect(s.lines).toContain('Fin du trajet. ▽ 2 autres trajets');
    await gesture('tap');
    goTo(at(14, 10, 20));
    await c.refreshCurrent();
    expect(last()).toMatchObject({ screen: 'train', title: 'IC vers Bruges' });
    goTo(at(14, 36, 20));
    await c.refreshCurrent();
    expect(last()).toMatchObject({ screen: 'arrival', title: 'Arrivée à Gand-Saint-Pierre' });
    c.stop();
  });

  it('CA-M2.6 : téléphone, 2e carte (bouton « Lunettes ») : page 2 suivie, message ; pas « dans le train » du 14:10, mais du 14:22', async () => {
    const h = await setupController({ scenario: 's3' });
    await h.until(homeReady);
    const s = preset11();
    const fav = s.favorites.find((f) => f.id === 'fav-gand')!;
    if (fav.kind !== 'trip') throw new Error('fav-gand');
    const result = await h.core.route(fav.from, fav.to, h.clock.now(), s, { lat: 50.8454, lon: 4.3571 });
    const msg = await h.c.showTrip({ title: 'Vers Gand-Saint-Pierre', from: fav.from, to: fav.to, result, index: 1 });
    expect(nb(msg)).toBe('Affiché dans les lunettes : IC 14:22, voie 6.');
    const st = await h.until(stepsReady);
    expect(st).toMatchObject({ page: 2, followed: true });
    expect(nb(st.title)).toBe(`Vers Gand-Saint-Pierre : 14:25 → 14:56${FOLLOWED}`);
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

  it('CA-M2.7 : trajet entièrement à pied, rien à suivre, T ne fait rien', async () => {
    const { c, gesture, until, last } = await setupController({ pos: { lat: 50.848, lon: 4.352 }, now: at(10, 0) });
    const home = await until(homeReady);
    // à pied : on part quand on veut, l'arrivée suit
    expect(home.lines.slice(0, 2)).toEqual(['Favoris   3', 'Bureau   maintenant → 10:09']);
    await gesture('tap');
    const s = await until(stepsReady);
    expect(nb(s.title)).toBe('Vers le bureau : 10:00 → 10:09');
    expect(s.lines[0]).toBe('Le plus court : à pied, 9 min');
    expect(s.lines.slice(1, 3)).toEqual(['10:00   Partir à pied (9 min)   en cours', '10:09   Arrivée au bureau']);
    expect(s.lines.slice(-2)).toEqual(['Fin du trajet. Pas d’autre trajet pour l’instant', '△▽ étapes   double : retour']);
    await gesture('tap');
    expect(last()).toEqual(s);
    expect(c.followed).toBeNull();
    c.stop();
  });

  it('CA-M2.8 : une autre proposition affichée à 07:42 : l’écran passe « dans le train » de l’IC suivi ; T sur une autre proposition la fait suivre', async () => {
    const a = await setupController({ flags: { noRt: true } });
    await a.until(homeReady);
    await openAndFollow(a);
    // au bout des étapes, « Autres trajets », puis « Le suivant »
    await a.gesture('down', 'down');
    await a.until((s) => s.screen === 'others');
    await a.gesture('down', 'tap');
    expect(a.last()).toMatchObject({ page: 3, followed: false });
    a.goTo(at(7, 42, 20));
    await a.c.refreshCurrent();
    expect(a.last()).toMatchObject({ screen: 'train', title: 'IC vers Bruxelles-Midi' });
    // 1.2.5 (PRD-1.2.5 § 7) : la ligne de progression en haut, train compris
    expect(a.last().lines[0]).toMatch(/^[●◎○─…]+ {3}descente dans \d+ arrêts$/);
    expect(a.last().lines[1]).toMatch(/^Namur   ~07:42/);
    // retour : les étapes du trajet suivi (la liste et l'autre proposition ont été quittées)
    await a.gesture('double');
    expect(a.last()).toMatchObject({ screen: 'steps', page: 1, followed: true });
    a.c.stop();

    // sans rien suivre : la 2e entrée de la liste (l'IC de 09:42), puis toucher : elle est suivie ; à 07:42, rien ne se passe
    const b = await setupController({ flags: { noRt: true } });
    await b.until(homeReady);
    await b.gesture('tap');
    await b.until(stepsReady);
    await b.gesture('down', 'down');
    await b.until((s) => s.screen === 'others');
    await b.gesture('down', 'tap', 'tap');
    expect(b.last()).toMatchObject({ page: 3, followed: true });
    expect(nb(b.last().lines.at(-1)!)).toBe('Trajet suivi : IC 09:42');
    expect(b.c.followed?.journey.legs.find((l) => l.kind === 'ride')?.schedDep).toBe(at(9, 42));
    await b.gesture('double', 'double');
    expect(b.last()).toMatchObject({ screen: 'steps', page: 1, followed: false });
    b.goTo(at(7, 42, 20));
    await b.c.refreshCurrent();
    expect(b.last().screen).toBe('steps');
    b.c.stop();
  });
});

describe('M6 : sans mauvaise surprise', () => {
  /** « Gares » puis Namur : le tableau de la gare gardée (« ★ » dans le titre). */
  const openNamur = async (h: Awaited<ReturnType<typeof setupController>>) => {
    await h.until(homeReady);
    // du premier favori : le suivant, « Autour de moi », puis « Gares »
    await h.gesture('down', 'down', 'down', 'tap');
    await h.until((x) => x.screen === 'stations' && !x.lines.some((l) => l.endsWith('…')));
    await h.gesture('tap');
    return h.until((x) => x.screen === 'board' && x.lines.length > 2);
  };

  it('CA-M6.1, CA-M6.2 et REVUE-USAGE n° 3 : ★ d’une gare : retrait annulable dans les 5 s, à l’identique ; ensuite, un nouvel ajout en fin de « Gares »', async () => {
    const h = await setupController();
    const { c, gesture, last, settings, advance } = h;
    const namur = await openNamur(h);
    expect(namur.title).toBe('Namur, train (SNCB) ★');
    // 1.2.3 : la ligne ★ en tête du tableau complet, le curseur sur le premier départ
    expect(namur).toMatchObject({ sel: 1 });
    expect(namur.lines[0]).toBe('★ retirer la gare');
    const before = structuredClone(settings.get().stations);
    await gesture('up', 'tap');
    expect(last().lines.at(-1)).toBe('★ Retirée. Toucher encore : annuler');
    expect(last().title).toBe('Namur, train (SNCB)');
    expect(settings.get().stations.some((p) => p.id === 'fav-namur')).toBe(false);
    advance(4_000);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Gare rétablie');
    expect(last().title).toBe('Namur, train (SNCB) ★');
    expect(settings.get().stations).toEqual(before);
    // retrait, puis toucher après 6 s : la gare revient en fin de « Gares », sous un nouvel identifiant
    await gesture('tap');
    advance(6_000);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Ajoutée à tes gares');
    const stations = settings.get().stations;
    expect(stations.at(-1)).toMatchObject({ areaId: 'sncb:8863008', name: { fr: 'Namur' } });
    expect(stations.some((p) => p.id === 'fav-namur')).toBe(false);
    // jamais d'arrêt favori (PRD-1.2.2 § 4)
    expect(settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
    // 1.2.3 : ▼ va au premier départ (le curseur reste sur la ligne ★ après ses touchers)
    expect(last().sel).toBe(0);
    await gesture('down');
    expect(last().sel).toBe(1);
    c.stop();
  });

  it('REVUE-USAGE n° 3 et CA-126.4 : deux lignes suivies au même arrêt (tram 3 et tram 4 à Gare du Nord) : « garder une ligne » retire, rétablit et ajoute chacune la sienne', async () => {
    const { c, gesture, until, last, settings, advance } = await setupController({ scenario: 's2' });
    // ouverts d'office : les départs de Gare du Nord, l'arrêt repère ; ★ : « Gare du Nord : garder une ligne »
    expect((await until(boardReady)).title).toBe('Gare du Nord, tram (STIB) ★');
    const ids = () => settings.get().follows?.map((p) => `${p.id} ${p.line} ${p.via?.areaId}`);
    const before = ids();
    expect(before).toEqual(['f-fav-gdn-3 3 stib:6357F', 'f-fav-gdn-4 4 stib:6357F']);
    await gesture('up', 'tap');
    const keep = await until((x) => x.screen === 'keepLine' && x.lines.length > 2);
    expect(nb(keep.title)).toBe('Gare du Nord : garder une ligne');
    expect(keep.lines).toEqual(['tram 3   ★', 'tram 4   ★', '△▽ choisir   toucher : ★ garder ou retirer   double : retour']);
    // le tram 4 : retiré seul (la ligne entière), le tram 3 reste ; l'arrêt De Lijn aussi
    await gesture('down', 'tap');
    expect(last().lines.slice(0, 2)).toEqual(['tram 3   ★', 'tram 4']);
    expect(last().lines.at(-1)).toBe('★ Retirée. Toucher encore : annuler');
    expect(ids()).toEqual(['f-fav-gdn-3 3 stib:6357F']);
    expect(settings.get().lines.map((p) => p.id)).toEqual(['fav-dl-nord']);
    advance(2_000);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Ligne rétablie');
    expect(ids()).toEqual(before);
    // retirée de nouveau, puis touchée après les 5 s : ajoutée, la ligne entière, cet arrêt en repère
    await gesture('tap');
    advance(6_000);
    await gesture('tap');
    expect(last().lines.at(-1)).toBe('★ Ajoutée aux lignes');
    expect(last().lines.slice(0, 2)).toEqual(['tram 3   ★', 'tram 4   ★']);
    expect(ids()?.[0]).toBe('f-fav-gdn-3 3 stib:6357F');
    expect(ids()?.[1]).toMatch(/^fl-\S+ 4 stib:6357F$/);
    expect(settings.get().follows?.[1]).toMatchObject({ op: 'stib', mode: 'tram', line: '4' });
    // double toucher : les départs, toujours « ★ »
    await gesture('double');
    expect(last()).toMatchObject({ screen: 'board', title: 'Gare du Nord, tram (STIB) ★' });
    expect(settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
    c.stop();
  });

  it('le message de retrait ne suit pas sur l’écran suivant, et ne s’annule plus après un changement d’écran', async () => {
    const h = await setupController();
    const { c, gesture, until, last, settings } = h;
    await openNamur(h);
    await gesture('up', 'tap', 'double');
    // Namur était la seule gare : « Gares » vide dit où en choisir
    const st = await until((x) => x.screen === 'stations');
    expect(st.lines).toEqual(['Choisis tes gares dans Quai, sur le téléphone.', 'double toucher : retour']);
    expect(last().lines).not.toContain('★ Retirée. Toucher encore : annuler');
    await gesture('double');
    const home = await until((x) => x.screen === 'home' && x.lines.includes('Gares de train   à choisir'));
    // 1.2.1 : pas de pied sur l'accueil (aide des gestes passée) : la dernière ligne reste « Lignes… »
    expect(home.lines.at(-1)).toBe('Lignes de bus, tram, métro   2 lignes');
    expect(settings.get().stations).toEqual([]);
    c.stop();
  });

  it('CA-M6.3 : trajet en cours sur l’accueil, puis repris à la réouverture près d’Ottignies', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await openAndFollow(a);
    a.goTo(at(7, 36));
    await a.c.refreshCurrent();
    await a.gesture('double');
    const home = await a.until(homeReady);
    // REVUE-USAGE n° 1 et n° 8 : « En cours » remplace la ligne de son favori ; le train, son heure et sa voie
    expect(home.lines.slice(0, 3)).toEqual(['En cours : vers le bureau   IC 07:42 +2 voie 6 !', 'Favoris   3', 'Vers Gand-Saint-Pierre   07:40 → 08:09']);
    // T sur « En cours » : le trajet, à l'écran qui correspond à l'heure
    await a.gesture('up', 'tap');
    expect(a.last()).toMatchObject({ screen: 'steps', followed: true, page: 1 });
    await a.gesture('double', 'double');
    a.c.onSignal({ kind: 'exit', abnormal: false });
    await a.settle();
    expect(parseTrip(await a.kv.get(TRIP_KEY))).toMatchObject({ title: 'Vers le bureau', explicit: true });

    const b = await setupController({ kv: a.kv, now: at(8, 5), pos: { lat: 50.6727, lon: 4.5694 } });
    const s = await b.until((x) => x.screen === 'train');
    expect(s.title).toBe('IC vers Bruxelles-Midi, +2 min');
    expect(s.lines.at(-1)).toBe('Trajet en cours : vers le bureau');
    // TT : les étapes, puis l'accueil où « En cours » reste (descente de l'IC à Bruxelles-Nord, puis le tram 4)
    await b.gesture('double');
    expect(b.last()).toMatchObject({ screen: 'steps', followed: true });
    await b.gesture('double');
    expect((await b.until(homeReady)).lines[0]).toBe('En cours : vers le bureau   descente 08:42');
    b.c.stop();
  });

  it('CA-M6.4 : TT avant l’heure de départ, rouvert à 07:50 (toujours à la maison) : l’accueil sans « En cours »', async () => {
    const a = await setupController();
    await a.until(homeReady);
    expect((await openAndFollow(a)).followed).toBe(true);
    a.goTo(at(7, 32));
    await a.gesture('double');
    a.c.stop();
    await a.settle();
    const b = await setupController({ kv: a.kv, now: at(7, 50) });
    const s = await b.until(homeReady);
    expect(s.lines[0]).not.toMatch(/^En cours/);
    expect(await b.kv.get(TRIP_KEY)).toBeFalsy();
    b.c.stop();
  });

  it('CA-M6.5 et CA-M6.6 : parti sans l’utilisateur, ou arrivé depuis plus de 5 min : plus de trajet en cours', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await openAndFollow(a);
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
    // 09:10 (arrivée 08:58 plus 5 min, passée), au bureau
    await a.kv.set(TRIP_KEY, saved!);
    const d = await setupController({ kv: a.kv, now: at(9, 10), pos: { lat: 50.8441, lon: 4.3474 } });
    expect((await d.until(homeReady)).lines[0]).not.toMatch(/^En cours/);
    d.c.stop();
    // 08:52, descendu du tram 3 à Bourse, en ville : en cours, « arrivée 08:58 » (il reste la marche)
    await a.kv.set(TRIP_KEY, saved!);
    const e = await setupController({ kv: a.kv, now: at(8, 52), pos: { lat: 50.8454, lon: 4.3571 } });
    const st = await e.until((x) => x.screen === 'steps');
    expect(st.lines.at(-1)).toBe('Trajet en cours : vers le bureau');
    await e.gesture('double');
    expect((await e.until(homeReady)).lines[0]).toBe('En cours : vers le bureau   arrivée 08:58');
    e.c.stop();
  });

  it('un toucher sur un autre favori pendant un trajet en cours ne change pas le trajet suivi (R2)', async () => {
    const h = await setupController();
    const { c, gesture, until, goTo, last } = h;
    await until(homeReady);
    await openAndFollow(h);
    goTo(at(7, 36));
    await c.refreshCurrent();
    const followed = c.followed?.journey.id;
    await gesture('double');
    const home = await until(homeReady);
    expect(home.lines[0]).toMatch(/^En cours/);
    // « Favoris » (sous « En cours ») puis Gand-Saint-Pierre (de gare à gare)
    await gesture('up', 'up', 'down', 'tap');
    const list = await until(listReady);
    const k = list.order!.indexOf('fav-gand');
    for (let i = 0; i < k; i++) c.onGesture('down');
    await gesture('tap');
    const s = await until(stepsReady);
    // « Suivre ce trajet » couperait la destination : « Suivre », le titre entier
    expect(nb(s.title)).toBe('Vers Gand-Saint-Pierre : 07:40 → 08:09   Suivre');
    expect(s.followed).toBe(false);
    expect(s.lines.at(-1)).toBe(HINT_FOLLOW);
    expect(c.followed?.journey.id).toBe(followed);
    // toucher : on le suit (geste explicite)
    await gesture('tap');
    expect(last()).toMatchObject({ followed: true });
    expect(c.followed?.journey.id).not.toBe(followed);
    c.stop();
  });

  it('REVUE-USAGE n° 1 : le favori du trajet en cours n’est pas répété sur l’accueil ; dans « Favoris », il rouvre ce trajet', async () => {
    const h = await setupController();
    const { c, gesture, until, goTo, last } = h;
    await until(homeReady);
    await openAndFollow(h);
    goTo(at(7, 36));
    await c.refreshCurrent();
    const id = c.followed?.journey.id;
    await gesture('double');
    const home = await until(homeReady);
    expect(home.lines.some((l) => l.startsWith('Bureau'))).toBe(false);
    // « Favoris » : le favori du bureau, sa réponse d'un nouveau départ (l'IC de 07:42 est pris), mais le toucher
    // rouvre le trajet en cours
    await gesture('up', 'down', 'tap');
    const list = await until(listReady);
    expect(list.lines[0]).toBe('Bureau   08:33 → 09:57');
    await gesture('tap');
    expect(last()).toMatchObject({ screen: 'steps', followed: true });
    expect(nb(last().title)).toBe(`Vers le bureau : 07:35 → 08:58${FOLLOWED}`);
    expect(c.followed?.journey.id).toBe(id);
    c.stop();
  });

  it('instantané d’arrière-plan : la pile et le trajet suivi passent à la nouvelle WebView', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await openAndFollow(a);
    // au bout des étapes, « Autres trajets », puis sa 1re entrée
    await a.gesture('down', 'down');
    await a.until((s) => s.screen === 'others');
    await a.gesture('tap');
    await a.until((s) => s.screen === 'steps' && s.page === 2);
    const snap = JSON.stringify(a.c.snapshot());
    a.c.stop();
    const b = await setupController({ now: at(7, 33) });
    b.c.restore(snap);
    const s = await b.until((x) => x.screen === 'steps' && x.page === 2);
    expect(s.followed).toBe(false);
    expect(b.c.followed?.title).toBe('Vers le bureau');
    // la pile suit : la liste, puis le trajet suivi
    await b.gesture('double');
    expect(b.last().screen).toBe('others');
    await b.gesture('double');
    expect(b.last()).toMatchObject({ page: 1, followed: true });
    b.c.stop();
  });
});

describe('état d’arrière-plan : instantané pris au mauvais moment (revue)', () => {
  it('instantané vide pendant « Chargement… » ; la nouvelle WebView lit quai.trip et reprend le trajet en cours', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await openAndFollow(a);
    a.goTo(at(7, 38));
    await a.c.refreshCurrent();
    a.c.stop();
    await a.settle();
    // Réouverture à 07:50 près d'Ottignies ; le téléphone se verrouille pendant le démarrage (init lente).
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const b = await setupController({
      kv: a.kv,
      now: at(7, 50),
      pos: { lat: 50.6727, lon: 4.5694 },
      wrap: (core) => Object.assign(Object.create(core) as Core, { init: async () => (await slow, core.init()) }),
      noWait: true,
    });
    expect(b.last()).toMatchObject({ screen: 'message', lines: ['Chargement…'] });
    expect(b.c.snapshot()).toEqual({});
    const snap = JSON.stringify(b.c.snapshot());
    b.c.stop();
    release();
    // restauration avant le démarrage, comme __restoreState dans la nouvelle WebView
    const e = await setupController({ kv: a.kv, now: at(7, 50), pos: { lat: 50.6727, lon: 4.5694 }, beforeStart: (c) => c.restore(snap) });
    const s = await e.until((x) => x.screen === 'train');
    expect(s.lines.at(-1)).toBe('Trajet en cours : vers le bureau');
    expect(e.c.followed?.title).toBe('Vers le bureau');
    e.c.stop();
  });

  it('un écran de chargement ou d’erreur n’est jamais restauré ; trip: null ignoré si le trajet n’avait pas été lu', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await openAndFollow(a);
    a.goTo(at(7, 38));
    await a.c.refreshCurrent();
    a.c.stop();
    await a.settle();
    const loading = { v: 2, nav: { stack: [{ route: { screen: 'message', kind: 'loading', title: 'Quai', lines: ['Chargement…'] }, sel: 0, top: 0 }] }, trip: null };
    const error = { v: 2, nav: { stack: [{ route: { screen: 'message', kind: 'error', title: 'Quai', lines: ['Pas de connexion aux horaires'] }, sel: 0, top: 0 }] }, trip: null };
    for (const snap of [loading, error]) {
      const b = await setupController({ kv: a.kv, now: at(7, 50), pos: { lat: 50.6727, lon: 4.5694 }, beforeStart: (c) => c.restore(JSON.stringify(snap)) });
      const s = await b.until((x) => x.screen === 'train');
      expect(s.title).toBe('IC vers Bruxelles-Midi, +2 min');
      expect(b.c.followed).not.toBeNull();
      b.c.stop();
    }
    // erreur au lancement : l'instantané ne garde ni l'écran d'erreur ni un trajet non lu
    const fail = (core: Core): Core => Object.assign(Object.create(core) as Core, { init: () => Promise.reject(new QuaiError('dataUnreachable')) });
    const f = await setupController({ kv: a.kv, wrap: fail });
    const snap = f.c.snapshot();
    expect(snap.tripRead).toBeUndefined();
    expect(snap.trip).toBeUndefined();
    f.c.stop();
  });

  it('« Dans le train » ne revient pas après restauration quand on était revenu aux étapes (autoDone)', async () => {
    const a = await setupController();
    await a.until(homeReady);
    await openAndFollow(a);
    a.location.set({ lat: 50.6727, lon: 4.5694 });
    a.goTo(at(8, 5));
    await a.c.refreshCurrent();
    await a.until((x) => x.screen === 'train');
    await a.gesture('double');
    expect((await a.until((x) => x.screen === 'steps')).followed).toBe(true);
    const snap = JSON.stringify(a.c.snapshot());
    a.c.stop();
    const b = await setupController({ kv: a.kv, now: at(8, 5), pos: { lat: 50.6727, lon: 4.5694 }, beforeStart: (c) => c.restore(snap) });
    await b.until((x) => x.screen === 'steps');
    await b.c.refreshCurrent();
    await b.settle(60);
    expect(b.screens().some((x) => x.screen === 'train')).toBe(false);
    expect(b.last().screen).toBe('steps');
    b.c.stop();
  });
});

describe('« Moins de marche » (1.1.1, CA-MW.6, CA-MW.12) avec « Le plus court » de la 1.2', () => {
  const N = (fr: string) => ({ fr, nl: fr });
  const NB = '\u00a0';
  const walk = (from: string, to: string, dep: number, min: number): Leg => ({ kind: 'walk', from: { name: N(from), lat: 0, lon: 0 }, to: { name: N(to), lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
  const ride = (p: Partial<Leg> & Pick<Leg, 'dep' | 'arr'>): Leg => ({
    kind: 'ride', from: { name: N('Namur'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Central'), lat: 0, lon: 0 },
    schedDep: p.dep, schedArr: p.arr, op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruxelles-Midi'), platform: '4', rt: false, delayMin: 0, cancelled: false, ...p,
  });
  const journey = (id: string, label: JourneyLabel, reason: string, legs: Leg[], leaveAt: number): Journey => ({
    id, label, reason, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt, transfers: Math.max(0, legs.filter((l) => l.kind === 'ride').length - 1), rt: false, alerts: [],
  });
  /** CA-MW.6, scène noRT : Maison (S1) vers « Saint-Géry » (50.8470, 4.3480). */
  const proposals = (): Journey[] => [
    journey('short', 'short', `Le plus court${NB}: direct, à pied 7 + 11${NB}min`, [walk('Ma position', 'Namur', at(7, 35), 7), ride({ dep: at(7, 42), arr: at(8, 46) }), walk('Bruxelles-Central', 'Saint-Géry', at(8, 46), 11)], at(7, 33)),
    journey('lesswalk', 'lesswalk', `Moins de marche${NB}: 1 changement, à pied 7 + 2 + 4${NB}min`, [
      walk('Ma position', 'Namur', at(7, 35), 7),
      ride({ dep: at(7, 42), arr: at(8, 40), to: { name: N('Bruxelles-Nord'), lat: 0, lon: 0 } }),
      walk('Bruxelles-Nord', 'Gare du Nord', at(8, 40), 2),
      ride({ dep: at(8, 44), arr: at(8, 49), from: { name: N('Gare du Nord'), lat: 0, lon: 0 }, to: { name: N('Bourse'), lat: 0, lon: 0 }, op: 'stib', mode: 'tram', line: '3', cat: undefined, head: N('Churchill'), platform: undefined }),
      walk('Bourse', 'Saint-Géry', at(8, 49), 4),
    ], at(7, 33)),
    journey('next', 'next', `Le suivant${NB}: même trajet, 1${NB}h plus tard`, [walk('Ma position', 'Namur', at(8, 35), 7), ride({ dep: at(8, 42), arr: at(9, 46) }), walk('Bruxelles-Central', 'Saint-Géry', at(9, 46), 11)], at(8, 33)),
  ];
  const fits = (s: Screen) => {
    for (const l of [s.title, ...s.lines]) {
      expect(textWidth(l), l).toBeLessThanOrEqual(WIDTHS.full);
      expect(l.includes('…'), l).toBe(false);
    }
  };

  it('page 1 : « Fin du trajet. ▽ 2 autres trajets » ; « Autres trajets » : « Moins de marche » et sa raison ; sa page : étiquette, raison, journal lesswalk ; « Trajet suivi : IC 07:42 »', async () => {
    const h = await setupController({ flags: { noRt: true } });
    await h.until(homeReady);
    const to = { type: 'address' as const, label: 'Saint-Géry, 1000 Bruxelles', lat: 50.847, lon: 4.348 };
    const msg = await h.c.showTrip({ title: 'Vers Saint-Géry', from: { type: 'here' }, to, result: { journeys: proposals() }, index: 0 });
    expect(msg).toBe(`Affiché dans les lunettes${NB}: IC 07:42, voie 4.`);
    const p1 = await h.until(stepsReady);
    // le bouton « Lunettes » du téléphone est une demande : le trajet est suivi (PRD-1.2.2 § 6)
    expect(p1).toMatchObject({ page: 1, pages: 3, label: 'short', followed: true });
    expect(nb(p1.title)).toBe(`Vers Saint-Géry : 07:33 → 08:57${FOLLOWED}`);
    // 1.2.5 : départ à pied dans 2 min : « Si tu le rates » (l'IC de 08:42 de Namur, « Le suivant ») ; la raison est gardée
    expect(p1.lines[0]).toBe('Si tu le rates : arrivée 09:57, 1 h plus tard');
    expect(h.c.followed?.journey.reason).toBe(`Le plus court${NB}: direct, à pied 7 + 11${NB}min`);
    expect(p1.lines.at(-2)).toBe('Fin du trajet. ▽ 2 autres trajets');
    fits(p1);
    // ▼ au bout : « Autres trajets » ; en 2e ligne, les moyens, puis le pourquoi (comparé à la proposition 1) ou les marches
    await h.gesture('down');
    const list = await h.until((s) => s.screen === 'others');
    expect(list.lines).toEqual(['Moins de marche   07:33 → 08:53', 'IC + tram 3, 4 min plus tôt, moins de marche', 'Le suivant   08:33 → 09:57', 'IC, à pied 7 + 11 min', '△▽ choisir   toucher : voir   double : retour']);
    fits(list);
    await h.gesture('tap');
    const p2 = await h.until((s) => s.screen === 'steps' && s.page === 2);
    expect(p2).toMatchObject({ page: 2, pages: 3, label: 'lesswalk', followed: false });
    expect(nb(p2.title)).toBe(`Vers Saint-Géry : 07:33 → 08:53${FOLLOW}`);
    // 1.2.5 : départ dans 2 min : « Si tu le rates » (l'IC de 08:42 de Namur) ; la raison était dans la liste ; la
    // correspondance du tram, 2 min après la marche, montre sa marge
    expect(p2.lines[0]).toBe('Si tu le rates : arrivée 09:57, 1 h 04 plus tard');
    expect(p2.lines).toContain('08:40   À pied vers Gare du Nord (2 min)');
    expect(p2.lines).toContain('~08:44   Tram 3 vers Churchill   marge 2 min');
    // 7 étapes, la 1re sur 2 lignes (1.2.4), pour 6 lignes : ▼ montre les dernières, du même trajet
    expect(p2.lines.at(-2)).toBe('▽ suite du trajet : 2 étapes');
    expect(p2.lines.at(-1)).toBe('△▽ étapes   toucher : suivre ce trajet   double : retour');
    fits(p2);
    await h.gesture('down');
    expect(h.last()).toMatchObject({ page: 2, label: 'lesswalk' });
    expect(h.last().lines).toContain('08:53   Arrivée à Saint-Géry (4 min à pied)');
    expect(h.last().lines.at(-2)).toBe('Fin du trajet. ▽ autres trajets');
    fits(h.last());
    await h.gesture('tap');
    expect(h.last()).toMatchObject({ page: 2, label: 'lesswalk', followed: true });
    expect(nb(h.last().lines.at(-1)!)).toBe('Trajet suivi : IC 07:42');
    expect(h.c.followed?.journey.id).toBe('lesswalk');
    h.c.stop();
  });

  it('CA-MW.12 et CA-3.2 : les raisons les plus longues tiennent au pixel, sans « … »', () => {
    const s = preset11();
    const [short, lesswalk] = proposals();
    lesswalk.reason = `Moins de marche${NB}: 2 changements, à pied 12 + 13 + 14${NB}min`;
    // PRD-1.2 § 1.3 : la plus longue des raisons de la 1.2, 538 px
    const fewer: Journey = { ...lesswalk, id: 'fewer', label: 'fewer', reason: `Moins de changements${NB}: 1 changement, à pied 12 + 13 + 14${NB}min` };
    const cases: [StepsData, string][] = [
      [{ journeys: [short, lesswalk], index: 1, fresh: true }, 'Moins de marche : 2 changements, à pied 12 + 13 + 14 min'],
      [{ journeys: [short, lesswalk], index: 0, followedId: 'short', fresh: true }, 'Le plus court : direct, à pied 7 + 11 min'],
      [{ journeys: [short, fewer], index: 1, fresh: true }, 'Moins de changements : 1 changement, à pied 12 + 13 + 14 min'],
    ];
    for (const [d, top] of cases) {
      const v = stepsPage({ title: 'Vers Saint-Géry', label: '' }, d, { now: at(7, 31), settings: s });
      const p = layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, geometry(v).capacity));
      expect(overflowing(p)).toEqual([]);
      expect(nb(p.lines[0])).toBe(top);
      for (const l of [p.title, ...p.lines]) {
        expect(textWidth(l), l).toBeLessThanOrEqual(WIDTHS.full);
        expect(l.includes('…'), l).toBe(false);
      }
    }
  });
});

describe('S2 : message « Quai 1.2.8 », GlassesApi', () => {
  it('PRD-1.2.8 § 4 (et CA-126.7, CA-3.2, CA-S2.2, CA-M7.1) : « Quai 1.2.8 » une seule fois après la mise à jour depuis la 1.0, avec les nouveautés de la 1.2.6 (7 lignes) ; T mène à l’accueil', async () => {
    const a = await setupController({ settings: preset(), keepSeen: true });
    expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.8' });
    expect(a.last().lines).toEqual([
      'Un train : tout son trajet, gares d’avant comprises.',
      'Chaque gare : sa voie et dans combien de temps.',
      '● : là où le train arrive, d’après le temps réel.',
      'Arrêts et lignes de bus, tram, métro, séparés.',
      'Une ligne : tout son parcours, l’attente à chaque arrêt.',
      'Dans les deux sens, sans choisir d’arrêt.',
      'Tes lignes gardées y sont déjà.',
      'toucher : continuer',
    ]);
    for (const l of [a.last().title, ...a.last().lines]) expect(textWidth(l), l).toBeLessThanOrEqual(WIDTHS.full);
    await a.gesture('tap');
    expect((await a.until(homeReady)).screen).toBe('home');
    await a.settle();
    expect(a.settings.get().seenVersion).toBe(APP_VERSION);
    a.c.stop();
    const b = await setupController({ settings: a.settings.get(), keepSeen: true });
    expect((await b.until(homeReady)).screen).toBe('home');
    expect(b.screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
    b.c.stop();
  });

  it('« Quai 1.2.8 » depuis la 1.1, la 1.2.0 à la 1.2.5 : avec la 1.2.6 ; depuis la 1.2.6 et la 1.2.7 : la 1.2.8 seule ; une seule fois ; jamais avec la version vue 1.2.8', async () => {
    expect(preset11().seenVersion).toBe('1.1.0');
    for (const seen of ['1.1.0', '1.2.0', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7']) {
      const a = await setupController({ settings: { ...preset11(), seenVersion: seen }, keepSeen: true });
      expect(a.last()).toMatchObject({ screen: 'message', title: 'Quai 1.2.8' });
      const want = seen === '1.2.6' || seen === '1.2.7' ? NEWS_LINES_128 : [...NEWS_LINES_128, ...NEWS_LINES];
      expect(a.last().lines).toEqual([...want.map(nb), 'toucher : continuer']);
      await a.gesture('tap');
      await a.until(homeReady);
      await a.settle();
      a.c.stop();
      const b = await setupController({ settings: a.settings.get(), keepSeen: true });
      await b.until(homeReady);
      expect(b.screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
      b.c.stop();
    }
    const d = await setupController({ settings: { ...preset11(), seenVersion: '1.2.8' }, keepSeen: true });
    await d.until(homeReady);
    expect(d.screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
    d.c.stop();
  });

  it('nouvelle installation : bienvenue, jamais « Quai 1.2.8 » ; la version vue est écrite', async () => {
    const { c, last, gesture, until, settings, settle, screens } = await setupController({ settings: defaults({ onboarded: false }) });
    await settle();
    expect(last()).toMatchObject({ screen: 'message', title: 'Quai' });
    expect(last().lines[0]).toBe('Bienvenue dans Quai !');
    expect(last().lines.at(-1)).toBe('toucher : continuer   double : quitter');
    expect(settings.get().seenVersion).toBe(APP_VERSION);
    await gesture('tap');
    expect((await until((s) => s.screen === 'home')).screen).toBe('home');
    expect(screens().some((s) => s.title === 'Quai 1.2.8')).toBe(false);
    c.stop();
  });

  it('showBoard : les départs de l’arrêt, message court ; « ★ » si une de ses lignes est gardée', async () => {
    const { c, until } = await setupController({ scenario: 's2' });
    await until(linesReady);
    const msg = await c.showBoard('delijn:308611');
    expect(nb(msg)).toBe('Affiché dans les lunettes : départs de Bruxelles-Nord.');
    expect((await until((s) => s.screen === 'board' && s.title.startsWith('Bruxelles-Nord'))).title).toBe('Bruxelles-Nord, bus (De Lijn) ★');
    expect(nb(await c.showBoard('stib:6359'))).toBe('Affiché dans les lunettes : départs de Rogier.');
    expect((await until((s) => s.title.startsWith('Rogier'))).title).toBe('Rogier, métro et tram (STIB)');
    expect(nb(await c.showBoard('sncb:8863008'))).toBe('Affiché dans les lunettes : départs de Namur.');
    expect((await until((s) => s.screen === 'board' && s.title.startsWith('Namur,'))).title).toBe('Namur, train (SNCB) ★');
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
    expect(await showTrip(ctx, { title: 'Vers Gand-Saint-Pierre', from: fav.from, to: fav.to, favoriteId: fav.id, result, index: 1 })).toEqual({ text: 'Affiché dans les lunettes : IC 14:22, voie 6.', ok: true });
    expect((await h.until((x) => x.screen === 'steps' && x.page === 2)).followed).toBe(true);
    expect(await showBoard(ctx, 'stib:6357F')).toEqual({ text: 'Affiché dans les lunettes : départs de Gare du Nord.', ok: true });
    expect((await h.until((x) => x.screen === 'board')).title).toBe('Gare du Nord, tram (STIB) ★');
    expect(shown).toBe(2);
    h.c.stop();
  });

  it('showTrip avec des propositions anciennes : recalcul depuis les mêmes extrémités, jamais « Dans le train » d’un train parti', async () => {
    const h = await setupController();
    await h.until(homeReady);
    const s = preset11();
    const to = { type: 'place' as const, placeId: 'fav-bureau' };
    const old = await h.core.route({ type: 'here' }, to, h.clock.now(), s, { lat: 50.4655, lon: 4.859 });
    // le téléphone envoie à 08:10 le plan calculé à 07:31 (IC de 07:42 parti)
    h.goTo(at(8, 10));
    const msg = await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to, favoriteId: 'fav-bureau', result: old, index: 0 });
    expect(msg).toBe('Affiché dans les lunettes\u00a0: IC 08:42, voie 4.');
    const st = await h.until(stepsReady);
    // recalcul : l'IC de 08:42 jusqu'à Bruxelles-Nord, puis le tram, arrivée 09:57
    expect(st).toMatchObject({ page: 1, followed: true });
    expect(nb(st.title)).toBe(`Vers le bureau : 08:33 → 09:57${FOLLOWED}`);
    expect(h.c.followed?.journey.legs.find((l) => l.kind === 'ride')?.schedDep).toBe(at(8, 42));
    // le suivi automatique ne passe pas « dans le train » de l'IC de 07:42, parti
    await h.c.refreshCurrent();
    expect(h.last().screen).toBe('steps');
    expect(h.screens().some((x) => x.screen === 'train')).toBe(false);
    h.c.stop();
  });

  it('showTrip sans trajet attrapable ni recalcul possible : message court, rien n’est affiché ni suivi', async () => {
    const empty = (core: Core): Core => Object.assign(Object.create(core) as Core, { route: async () => ({ journeys: [], empty: 'noTrip' as const }) });
    const h = await setupController({ wrap: empty });
    await h.until(homeReady);
    const s = preset11();
    const to = { type: 'place' as const, placeId: 'fav-bureau' };
    const old = await h.core.route({ type: 'here' }, to, h.clock.now(), s, { lat: 50.4655, lon: 4.859 });
    expect(old.journeys).toHaveLength(0);
    const plan = await fakeCoreFor(h.clock.now).route({ type: 'here' }, to, h.clock.now(), s, { lat: 50.4655, lon: 4.859 });
    h.goTo(at(8, 10));
    const before = h.last();
    expect(await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to, result: plan, index: 0 })).toBe('Aucun trajet trouvé pour l’instant.');
    expect(h.last().screen).toBe(before.screen);
    expect(h.c.followed).toBeNull();
    h.c.stop();
  });

  it('showTrip : trajet à pied, message « à pied »', async () => {
    const h = await setupController({ pos: { lat: 50.848, lon: 4.352 }, now: at(10, 0) });
    await h.until(homeReady);
    const result = await h.core.route({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, h.clock.now(), preset11(), { lat: 50.848, lon: 4.352 });
    expect(await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, result, index: 0 })).toBe('Affiché dans les lunettes : à pied, 9 min.');
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

  it('lecture défensive de quai.trip ; 1.2.2 : sans la marque `explicit` (1.1, 1.2.1), jamais repris (CA-122.7)', () => {
    expect(parseTrip('')).toBeNull();
    expect(parseTrip('pas du json')).toBeNull();
    expect(parseTrip({ v: 2 })).toBeNull();
    expect(parseTrip({ v: 1, journey: j(1, 2, 0), title: 'Vers le bureau', leaveAt0: 0, startedAt: 0 })).toBeNull();
    expect(parseTrip({ v: 1, explicit: 'oui', journey: j(1, 2, 0), title: 'Vers le bureau', leaveAt0: 0, startedAt: 0 })).toBeNull();
    const t = parseTrip({ v: 1, explicit: true, journey: j(1, 2, 0), title: 'Vers le bureau', leaveAt0: 0, startedAt: 0 });
    expect(t).toMatchObject({ title: 'Vers le bureau', index: 0, key: 'trip-x', explicit: true });
    expect(t?.journeys).toHaveLength(1);
  });
});

describe('1.2 : lieux dans les favoris, « Le plus court » (PRD-1.2 § 2.3, CA-2.2) ; réglages de la 1.1 migrés (PRD-1.2.2 § 5)', () => {
  const NB = ' ';
  const s3 = { lat: 50.8454, lon: 4.3571 };
  /** S3 : jusqu'à l'aide à l'arrivée de Gand-Saint-Pierre (« Dans le train » à 14:10, arrivée à 14:36). */
  const toArrival = async (h: Awaited<ReturnType<typeof setupController>>) => {
    await h.until(stepsReady);
    h.goTo(at(14, 10, 20));
    await h.c.refreshCurrent();
    h.goTo(at(14, 36, 20));
    await h.c.refreshCurrent();
    expect(h.last()).toMatchObject({ screen: 'arrival', title: 'Arrivée à Gand-Saint-Pierre' });
  };
  const gandTrip = () => {
    const f = preset11().favorites.find((x) => x.id === 'fav-gand')!;
    if (f.kind !== 'trip' || f.to.type !== 'area') throw new Error('fav-gand');
    return { ...f, to: f.to };
  };

  it('CA-2.2, CA-122.6 et CA-126.4 : S1, réglages de la 1.1 : lieux et trajet fixe dans « Favoris », Namur dans « Gares de train », l’arrêt De Lijn dans « Arrêts… », tram 3 et tram 4 dans « Lignes… »', async () => {
    const s = preset11();
    expect(s.favorites.map((f) => [f.id, f.kind])).toEqual([['fav-bureau', 'place'], ['fav-gand', 'trip'], ['fav-maison', 'place']]);
    expect(s.stations.map((p) => p.id)).toEqual(['fav-namur']);
    expect(s.lines.map((p) => [p.id, p.line ?? ''])).toEqual([['fav-dl-nord', '']]);
    expect(s.follows?.map((p) => [p.id, p.line])).toEqual([['f-fav-gdn-3', '3'], ['f-fav-gdn-4', '4']]);
    const { c, gesture, until, last, settle } = await setupController({ flags: { noRt: true } });
    const home = await until(homeReady);
    expect(home.order?.[0]).toBe('fav-bureau');
    // le lieu sous son nom, « Bureau » (la ligne 0 est « Temps réel indisponible… »)
    expect(home.lines.slice(1, 3)).toEqual(['Favoris   3', 'Bureau   dans 2 min → 08:58']);
    // « Arrêts… » : l'arrêt De Lijn et ses départs (curseur sur le premier favori : 4 fois ▼) ; « Lignes… » : tram 3 et
    // tram 4, un sens par rangée
    await gesture('down', 'down', 'down', 'down', 'tap');
    const stops = await until(linesReady);
    expect(stops.lines[0]).toBe('Bruxelles-Nord');
    await gesture('double', 'down', 'tap');
    const follows = await until(followsReady);
    expect(follows.lines.filter((l) => l.startsWith('Tram 3 vers '))).toHaveLength(2);
    expect(follows.lines.filter((l) => l.startsWith('Tram 4 vers '))).toHaveLength(1);
    // « Favoris » : le lieu « Maison » comme le trajet « Ma position → maison » de la 1.1, en fin de liste
    await gesture('double', 'up', 'up', 'up', 'up', 'up', 'up', 'tap');
    const list = await until(listReady);
    expect(list.order).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    for (let i = 0; i < 2; i++) c.onGesture('down');
    await settle();
    expect(last().lines).toContain('Maison   tu y es');
    await gesture('tap');
    expect(last()).toMatchObject({ screen: 'message', title: 'Vers la maison', lines: ['Tu es déjà à la maison.', 'double toucher : retour'] });
    c.stop();
  });

  it('« ★ garder ce trajet » : parti de « Ma position », un lieu (l’arrêt d’arrivée) ; une seconde fois, « Déjà dans les favoris »', async () => {
    const h = await setupController({ scenario: 's3' });
    await h.until(homeReady);
    const gand = gandTrip();
    const result = await h.core.route({ type: 'here' }, gand.to, h.clock.now(), h.settings.get(), s3);
    await h.c.showTrip({ title: 'Vers Gand-Saint-Pierre', from: { type: 'here' }, to: gand.to, result, index: 0 });
    await toArrival(h);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Trajet ajouté aux favoris');
    expect(h.settings.get().favorites).toHaveLength(4);
    expect(h.settings.get().favorites.at(-1)).toMatchObject({ kind: 'place', label: 'Gand-Saint-Pierre', src: 'stop', areaId: gand.to.areaId, address: 'Près de Gand-Saint-Pierre', propose: 'never' });
    expect(h.settings.get().favorites.some((f) => f.kind === 'trip' && f.from.type === 'here')).toBe(false);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Déjà dans les favoris');
    expect(h.settings.get().favorites).toHaveLength(4);
    h.c.stop();
  });

  it('« ★ garder ce trajet » : de gare à gare, hors favoris, un trajet fixe ; le trajet d’un favori : « Déjà dans les favoris »', async () => {
    const gand = gandTrip();
    const base = preset11();
    const h = await setupController({ scenario: 's3', settings: { ...base, favorites: base.favorites.filter((f) => f.id !== 'fav-gand') } });
    await h.until(homeReady);
    const result = await h.core.route(gand.from, gand.to, h.clock.now(), h.settings.get(), s3);
    await h.c.showTrip({ title: 'Vers Gand-Saint-Pierre', from: gand.from, to: gand.to, result, index: 0 });
    await toArrival(h);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Trajet ajouté aux favoris');
    expect(h.settings.get().favorites.at(-1)).toMatchObject({ kind: 'trip', from: { type: 'area', areaId: gand.from.type === 'area' ? gand.from.areaId : '' }, to: { type: 'area', areaId: gand.to.areaId }, propose: 'never' });
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Déjà dans les favoris');
    expect(h.settings.get().favorites).toHaveLength(3);
    h.c.stop();
    // le favori « Vers Gand-Saint-Pierre » ouvert depuis l'accueil (le curseur y est), puis suivi : rien n'est ajouté
    const f = await setupController({ scenario: 's3' });
    await f.until(homeReady);
    await f.gesture('tap');
    await f.until(stepsReady);
    await f.gesture('tap');
    await toArrival(f);
    await f.gesture('tap');
    expect(f.last().lines.at(-1)).toBe('★ Déjà dans les favoris');
    expect(f.settings.get().favorites).toHaveLength(3);
    f.c.stop();
  });

  it('quai.trip avec les étiquettes de la 1.1 (« simple », « fast ») : relues par labelOf, la raison suit', () => {
    const leg = { kind: 'ride' as const, from: { name: { fr: 'A', nl: 'A' }, lat: 0, lon: 0 }, to: { name: { fr: 'B', nl: 'B' }, lat: 0, lon: 0 }, dep: 1, arr: 2, schedDep: 1, schedArr: 2 };
    const j = (id: string, label: string, reason: string) => ({ id, label, reason, legs: [leg], dep: 1, arr: 2, leaveAt: 0, transfers: 0, rt: false, alerts: [] });
    const t = parseTrip({
      v: 1, explicit: true, title: 'Vers le bureau', leaveAt0: 0, startedAt: 0, index: 0, key: 'k',
      journey: j('a', 'simple', `Le plus simple${NB}: direct`),
      journeys: [j('a', 'simple', `Le plus simple${NB}: direct`), j('b', 'fast', `Le plus rapide${NB}: 1 changement, à pied 19 + 3${NB}min`), j('c', 'next', `Le suivant${NB}: même trajet, 1${NB}h plus tard`), j('d', 'autre', 'Autre')],
    })!;
    expect([t.journey.label, t.journey.reason]).toEqual(['short', `Le plus court${NB}: direct`]);
    expect(t.journeys.map((x) => [x.label, x.reason])).toEqual([
      ['short', `Le plus court${NB}: direct`],
      ['earlier', `Plus tôt${NB}: 1 changement, à pied 19 + 3${NB}min`],
      ['next', `Le suivant${NB}: même trajet, 1${NB}h plus tard`],
      [undefined, 'Autre'],
    ]);
  });

  it('CA-122.7 : un trajet en cours écrit par la 1.1 ou la 1.2.1 (sans demande) n’est pas repris ; suivi sur demande, il l’est, avec « Le plus court »', async () => {
    // sans l'alerte « Partir maintenant », la ligne du haut montre la raison
    const p = preset11();
    const settings = { ...p, alerts: { ...p.alerts, leave: false } };
    const a = await setupController({ flags: { noRt: true }, settings });
    await a.until(homeReady);
    await openAndFollow(a);
    a.goTo(at(7, 36));
    await a.c.refreshCurrent();
    a.c.stop();
    await a.settle();
    const saved = JSON.parse((await a.kv.get(TRIP_KEY))!) as { journey: Journey; journeys: Journey[]; explicit?: boolean };
    expect(saved.journey.label).toBe('short');
    expect(saved.explicit).toBe(true);
    // le même trajet, tel que la 1.1 l'a écrit (anciennes étiquettes, sans la marque `explicit`) : pas « En cours »
    const old = (x: Journey) => ({ ...x, label: x.label === 'short' ? 'simple' : x.label, reason: x.reason?.replace(/^Le plus court/, 'Le plus simple') });
    const { explicit: _explicit, ...v11 } = saved;
    await a.kv.set(TRIP_KEY, JSON.stringify({ ...v11, journey: old(saved.journey), journeys: saved.journeys.map(old) }));
    const b = await setupController({ kv: a.kv, now: at(7, 36), flags: { noRt: true }, settings });
    expect((await b.until(homeReady)).lines[0]).not.toMatch(/^En cours/);
    expect(b.c.followed).toBeNull();
    b.c.stop();
    // demandé (marque `explicit`), avec les anciennes étiquettes : repris, relu « Le plus court »
    await a.kv.set(TRIP_KEY, JSON.stringify({ ...saved, journey: old(saved.journey), journeys: saved.journeys.map(old) }));
    const d = await setupController({ kv: a.kv, now: at(7, 36), flags: { noRt: true }, settings });
    const st = await d.until(stepsReady);
    expect(st).toMatchObject({ page: 1, label: 'short', followed: true });
    // 1.2.5 : parti à 07:35, l'IC pas encore : « Si tu le rates » en haut ; la raison relue « Le plus court »
    expect(st.lines[0]).toBe('Si tu le rates : arrivée 09:57, 59 min plus tard');
    expect(nb(d.c.followed?.journey.reason ?? '')).toBe('Le plus court : 1 changement, à pied 7 + 2 + 9 min');
    expect(d.c.followed?.journeys.map((j) => j.label)).toEqual(['short', 'next', 'later']);
    expect(st.lines.at(-2)).toBe('▽ suite du trajet : 2 étapes');
    expect(st.lines.join('\n')).not.toMatch(/simple|undefined/);
    d.c.stop();
  });
});
