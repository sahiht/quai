/**
 * Quai 1.3.1, R1 (docs/v1.3.1/PRD-1.3.1.md § 14, docs/v1.3.1/experts/06-rd.md) : la bonne sortie du métro. Après
 * « Descends à Bourse », l'écran de la marche (B17) ajoute une 3e ligne pâle « Sortie : Boulevard Anspach ».
 *  - choix de la sortie (core/exits.ts) : arrêt STIB sous terre seulement, vers la suite du chemin, jamais pour une
 *    correspondance sous terre ni vers un train ;
 *  - moteur (core/guide.ts) : le moment de la marche porte la sortie donnée par le contrôleur ;
 *  - écran (glasses/exit-line.ts, guide-views.ts) : texte exact, pâle, au pixel, nom coupé au mot ; pareil dans Quai Web ;
 *  - contrôleur : fichier des sorties lu une fois, rien d'affiché ni d'erreur s'il manque ; rien d'envoyé.
 * Lieux publics seulement (stations, places et rues du centre de Bruxelles).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Core, Endpoint, Journey, Leg } from '../../src/core/api';
import { exitByLegOf } from '../../src/core/exits';
import { dismissMoment } from '../../src/core/guide';
import type { GuideState, Moment, WhereAmI } from '../../src/core/guide-types';
import type { ExitsFile } from '../../src/core/walk/exits-format';
import { EXIT_HEAD, exitLineText } from '../../src/glasses/exit-line';
import { textWidth } from '../../src/glasses/font';
import { guideView } from '../../src/glasses/guide-views';
import { GUIDE } from '../../src/glasses/layout';
import type { Intent } from '../../src/glasses/types';
import type { ViewCtx } from '../../src/glasses/views';
import { at, guide, journeyOf, MIN, N, rideLeg, step, stop, walkLeg } from '../core/guide-fixtures';
import { cleanupKit, guideSetup, type Kit } from './controller-guide-kit';
import { container, nb, overflowing, page, rowsOf, settingsWith } from './helpers';

/* ------------------------------ Lieux et sorties (publics) ------------------------------ */

const ROGIER = stop('Rogier', { lat: 50.8553, lon: 4.3583 }, 'stib:rogier');
const PLACE_ROGIER = stop('Place Charles Rogier', { lat: 50.8558, lon: 4.3589 });
const BROUCKERE = stop('De Brouckère', { lat: 50.8505, lon: 4.3525 }, 'stib:brouckere');
const BOURSE = stop('Bourse', { lat: 50.848, lon: 4.3492 }, 'stib:bourse');
const FONTAINAS = stop('Place Fontainas', { lat: 50.8452, lon: 4.3466 });
const SAINTE_CATHERINE = stop('Place Sainte-Catherine', { lat: 50.8507, lon: 4.3478 });
const BOURSE_BUS = stop('Bourse', { lat: 50.8493, lon: 4.3479 }, 'stib:bourse-bus');
const GRAND_PLACE = stop('Grand-Place', { lat: 50.8467, lon: 4.3525 });
const CENTRAL = stop('Bruxelles-Central', { lat: 50.8455, lon: 4.3571 }, 'sncb:8813003');
const NORD = stop('Bruxelles-Nord', { lat: 50.8603, lon: 4.3617 }, 'sncb:8812005');
const ARTS_LOI = stop('Arts-Loi', { lat: 50.8455, lon: 4.3691 }, 'stib:artsloi');
const SCHUMAN = stop('Schuman', { lat: 50.8432, lon: 4.3817 }, 'stib:schuman');

/** Fichier des sorties d'essai : Bourse (prémétro, quai 8362), De Brouckère (8292), Arts-Loi (8032 et 8042). */
const EXITS: ExitsFile = {
  v: 1,
  version: '2026-11-19',
  builtAt: '2026-11-20T01:30:00.000Z',
  source: 'OpenStreetMap, extrait Geofabrik belgium-latest.osm.pbf',
  licence: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)',
  attribution: '© les contributeurs d’OpenStreetMap',
  stops: {
    // la plus proche du quai d'abord : au nord la rue Paul Devaux, au sud le boulevard Anspach
    '8362': { s: 'Bourse', x: [['Rue Paul Devaux', 50.8487, 4.3497, 35], ['Rue Jules Van Praet', 50.849, 4.3484, 50], ['Boulevard Anspach', 50.8474, 4.3489, 60]] },
    '8292': { s: 'De Brouckère', x: [['Place De Brouckère', 50.8512, 4.3529, 40]] },
    '8032': { s: 'Arts-Loi', x: [['Rue de la Loi', 50.8456, 4.3686, 45], ['Avenue des Arts', 50.8451, 4.3693, 70]] },
    '8042': { s: 'Arts-Loi', x: [['Avenue des Arts', 50.8451, 4.3693, 40]] },
  },
};

const tram4 = (toStop?: string, extra: Partial<Leg> = {}): Leg => ({
  ...rideLeg({ op: 'stib', mode: 'tram', line: '4', head: 'Stalle', stops: [{ p: ROGIER, t: at('08:10') }, { p: BROUCKERE, t: at('08:12') }, { p: BOURSE, t: at('08:14') }] }),
  fromStop: '8472',
  ...(toStop ? { toStop } : {}),
  ...extra,
});
/** Place Rogier à pied, tram 4 (prémétro) de Rogier à Bourse, puis à pied jusqu'à `dest`. */
const trip = (dest = FONTAINAS, ride = tram4('8362'), id = 'jr1'): Journey => journeyOf([walkLeg(PLACE_ROGIER, ROGIER, at('08:06'), 4), ride, walkLeg(BOURSE, dest, ride.arr, 5)], id, at('08:06'));

/* ------------------------------ Choix de la sortie ------------------------------ */

describe('R1 : choix de la sortie (core/exits.ts)', () => {
  it('descente à un arrêt STIB sous terre, puis à pied : la sortie vers la destination de la marche', () => {
    // vers le sud (place Fontainas) : le boulevard Anspach, pas la sortie la plus proche du quai
    expect(exitByLegOf(trip(FONTAINAS), EXITS)).toEqual({ 2: 'Boulevard Anspach' });
    // vers le nord-ouest (place Sainte-Catherine) : la rue Jules Van Praet ; vers l'est (Grand-Place) : la rue Paul Devaux… ou le boulevard
    expect(exitByLegOf(trip(SAINTE_CATHERINE), EXITS)).toEqual({ 2: 'Rue Jules Van Praet' });
    // numéro d'arrêt avec sa lettre (« 8362F ») : le même quai
    expect(exitByLegOf(trip(FONTAINAS, tram4('8362F')), EXITS)).toEqual({ 2: 'Boulevard Anspach' });
    // jamais pour la première marche (avant de monter)
    expect(Object.keys(exitByLegOf(trip(), EXITS) ?? {})).toEqual(['2']);
  });

  it('rien si l’arrêt n’est pas sous terre, n’a pas de sortie connue, n’est pas de la STIB, ou si le fichier manque', () => {
    // arrêt de surface ou inconnu du fichier, arrêt physique inconnu
    expect(exitByLegOf(trip(FONTAINAS, tram4('5001')), EXITS)).toBeUndefined();
    expect(exitByLegOf(trip(FONTAINAS, tram4(undefined)), EXITS)).toBeUndefined();
    // autre réseau, même numéro d'arrêt
    expect(exitByLegOf(trip(FONTAINAS, tram4('8362', { op: 'delijn' })), EXITS)).toBeUndefined();
    expect(exitByLegOf(trip(FONTAINAS, tram4('8362', { op: 'tec' })), EXITS)).toBeUndefined();
    expect(exitByLegOf(trip(FONTAINAS, tram4('8362', { op: 'sncb' })), EXITS)).toBeUndefined();
    // fichier absent
    expect(exitByLegOf(trip(), null)).toBeUndefined();
    expect(exitByLegOf(trip(), undefined)).toBeUndefined();
    expect(exitByLegOf(trip(), { ...EXITS, stops: {} })).toBeUndefined();
    // véhicule supprimé : pas de descente
    expect(exitByLegOf(trip(FONTAINAS, tram4('8362', { cancelled: true })), EXITS)).toBeUndefined();
  });

  it('correspondance : une sortie vers un arrêt de surface ; rien vers un autre quai sous terre ni vers un train', () => {
    const t4 = tram4('8362');
    const then = (walkTo: typeof BOURSE, next: Leg, last = FONTAINAS): Journey =>
      journeyOf([walkLeg(PLACE_ROGIER, ROGIER, at('08:06'), 4), t4, walkLeg(BOURSE, walkTo, t4.arr, 3), next, walkLeg(next.to as typeof BOURSE, last, next.arr, 4)], 'jr2', at('08:06'));
    // bus en surface, au nord-ouest de la station : on sort, du côté de l'arrêt
    const bus = { ...rideLeg({ op: 'stib', mode: 'bus', line: '86', head: 'Machtens', stops: [{ p: BOURSE_BUS, t: at('08:20') }, { p: SAINTE_CATHERINE, t: at('08:23') }] }), fromStop: '1009', toStop: '1010' };
    expect(exitByLegOf(then(BOURSE_BUS, bus), EXITS)).toEqual({ 2: 'Rue Jules Van Praet' });
    // métro ou prémétro pris à un quai sous terre (dans le fichier) : on ne sort pas
    const m1 = { ...rideLeg({ op: 'stib', mode: 'metro', line: '1', head: 'Stockel', stops: [{ p: BROUCKERE, t: at('08:20') }, { p: ARTS_LOI, t: at('08:25') }] }), fromStop: '8292', toStop: '8032' };
    const viaBrouckere = journeyOf([walkLeg(PLACE_ROGIER, ROGIER, at('08:06'), 4), tram4('8292'), walkLeg(BROUCKERE, BROUCKERE, at('08:14'), 3), m1, walkLeg(ARTS_LOI, CENTRAL, m1.arr, 9)], 'jr3', at('08:06'));
    // … mais à la descente du métro 1 à Arts-Loi, dernière marche : la sortie
    expect(exitByLegOf(viaBrouckere, EXITS)).toEqual({ 4: 'Rue de la Loi' });
    // train ensuite : la gare se rejoint par ses couloirs, aucune sortie
    const ic = rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Anvers-Central', stops: [{ p: CENTRAL, t: at('08:30'), platform: '3' }, { p: NORD, t: at('08:34') }] });
    expect(exitByLegOf(then(CENTRAL, ic, PLACE_ROGIER), EXITS)).toBeUndefined();
  });
});

/* ------------------------------ Moteur ------------------------------ */

const walkOf = (s: GuideState): Extract<Moment, { kind: 'walk' }> => {
  expect(s.moment?.kind).toBe('walk');
  return s.moment as Extract<Moment, { kind: 'walk' }>;
};

describe('R1 : le moment de la marche après la descente porte la sortie (core/guide.ts)', () => {
  it('sortie donnée pour ce rang de marche : dans le moment ; sinon absente', () => {
    const j = trip();
    const run = (exitByLeg?: Record<number, string>) => {
      const r = guide(j, { origin: PLACE_ROGIER, ...(exitByLeg ? { exitByLeg } : {}) });
      step(r, at('08:12:30'));
      // sans position : « Descends à Bourse » d'abord, puis la marche
      let s = step(r, at('08:14:10'));
      for (let t = at('08:14:20'); s.moment?.kind !== 'walk' && t < at('08:19'); t += 10_000) {
        if (s.moment) r.mem = dismissMoment(r.mem, s.moment.id, t);
        s = step(r, t);
      }
      return walkOf(s);
    };
    expect(run(exitByLegOf(j, EXITS))).toMatchObject({ id: 'walk:jr1:2', leg: 2, final: true, exit: 'Boulevard Anspach' });
    expect(run()).not.toHaveProperty('exit');
    // une sortie connue pour une autre marche ne se montre pas ici
    expect(run({ 4: 'Rue de la Loi' })).not.toHaveProperty('exit');
  });
});

/* ------------------------------ Écran ------------------------------ */

const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: at('08:14'), settings: settingsWith([]), ...patch });
const WHERE: WhereAmI = { title: 'Place Fontainas', arr: at('08:19'), rt: true, chain: [{ label: 'à pied', state: 'done' }, { label: 'tram 4', state: 'done' }, { label: 'à pied', state: 'now' }] };
const walkM = (p: Partial<Extract<Moment, { kind: 'walk' }>> = {}): Moment => ({
  since: at('08:14'), until: at('08:17'), leg: 2, id: 'walk:jr1:2', kind: 'walk', walkMin: 5, toward: N('Place Fontainas'), final: true, arr: at('08:19'), ...p,
});
const HINT = 'toucher : masquer   appui long : arrêter';

/** Page de l'écran de la marche, après contrôle : rien ne dépasse, ni tiret long ni tiret moyen. */
function screen(m: Moment, c: ViewCtx = ctx()) {
  const state: GuideState = { kind: 'trip', journeyId: 'jr1', phase: { kind: 'walk', leg: 2 }, moment: m, where: WHERE, location: 'high', wakeAt: at('08:15'), ended: false };
  const p = page(guideView(state, 'moment', trip(), c));
  expect(overflowing(p)).toEqual([]);
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[–—]/);
  return { p, raw: p.lines, lines: p.lines.map(nb), pale: rowsOf(container(p, 'colC')), hi: rowsOf(container(p, 'colA')), norm: rowsOf(container(p, 'colB')) };
}

/** Noms de sortie vus dans la mesure du 20/11 sur les données belges (run 44798744102), le plus long compris. */
const REAL_NAMES = [
  'Boulevard Anspach', 'Rue Jules Van Praet', 'Place De Brouckère', 'Avenue de la Toison d\'Or', 'Boulevard du Jardin Botanique', 'Rue du Champ de la Couronne',
  'Square Émile Vander Bruggen', 'Rue de l\'Hôtel des Monnaies', 'Avenue de la Porte de Hal', 'Avenue Impératrice Charlotte', 'Rue Théophile De Baisieux',
  'Avenue Herrmann-Debroux', 'Boulevard de Smet de Naeyer', 'Cours Paul-Henri Spaak', 'Quai au Bois à Brûler', 'Rue Jean-Baptiste Serkeyn', 'Esplanade de l\'Europe',
  'Allée Adrienne Gommers & Anne-Marie van Oost-de-Gerlache',
];

describe('R1 : la ligne « Sortie : … » de l’écran de la marche', () => {
  it('3e ligne pâle, texte exact « Sortie : Boulevard Anspach » (espace insécable, 232 px), sous la marche et l’arrivée', () => {
    const s = screen(walkM({ exit: 'Boulevard Anspach' }));
    expect(s.lines).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', 'Sortie : Boulevard Anspach', HINT]);
    expect(s.raw[2]).toBe('Sortie\u00a0: Boulevard Anspach');
    expect(textWidth(s.raw[2])).toBe(232);
    expect(s.pale[2]).toBe('Sortie : Boulevard Anspach');
    expect([...s.hi, ...s.norm].join('\n')).not.toMatch(/Sortie/);
    expect(s.hi[0]).toBe('5 min à pied jusqu’à la place Fontainas');
    expect(s.norm[1]).toBe('arrivée 08:19');
    // avant un bus en surface : sous la ligne du véhicule
    const bus = screen(walkM({ final: false, arr: undefined, toward: N('Bourse'), walkMin: 3, vehicle: { op: 'stib', mode: 'bus', line: '86' }, depAt: at('08:20'), rt: true, exit: 'Rue Jules Van Praet' }));
    expect(bus.lines).toEqual(['3 min à pied jusqu’à l’arrêt Bourse', 'bus 86 à 08:20', 'Sortie : Rue Jules Van Praet', HINT]);
  });

  it('sans sortie : l’écran de la marche est celui d’avant (deux lignes)', () => {
    expect(screen(walkM()).lines).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', HINT]);
    expect(screen(walkM({ exit: '' })).lines).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', HINT]);
    expect(screen(walkM({ exit: '   ' })).lines).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', HINT]);
  });

  it('apostrophe typographique à l’affichage (le fichier garde l’apostrophe droite d’OpenStreetMap)', () => {
    expect(screen(walkM({ exit: 'Avenue de la Toison d\'Or' })).lines[2]).toBe('Sortie : Avenue de la Toison d’Or');
    expect(screen(walkM({ exit: 'Esplanade de l\'Europe' })).lines[2]).toBe('Sortie : Esplanade de l’Europe');
  });

  it('tient au pixel : chaque nom vu sur les données belges, le plus long coupé entre deux mots, jamais après un mot de liaison', () => {
    for (const name of REAL_NAMES) {
      const s = screen(walkM({ exit: name }));
      const line = s.raw[2];
      expect(textWidth(line)).toBeLessThanOrEqual(GUIDE.TEXT_W);
      expect(line.startsWith(EXIT_HEAD)).toBe(true);
      const shown = line.slice(EXIT_HEAD.length);
      const full = name.replace(/'/g, '’');
      if (shown !== full) {
        // coupé : des mots entiers du nom, puis « … »
        expect(shown.endsWith('…')).toBe(true);
        const head = shown.slice(0, -1);
        expect(full.startsWith(`${head} `)).toBe(true);
        expect(head).not.toMatch(/(?:^| )(?:&|et|de|du|des|la|le|les|au|aux|à|van)$/);
      }
    }
    // la plus longue sortie des données : coupée après le nom de la première personne, sans « & » au bout
    expect(screen(walkM({ exit: REAL_NAMES[REAL_NAMES.length - 1] })).lines[2]).toBe('Sortie : Allée Adrienne Gommers…');
    // tous les autres noms tiennent en entier
    for (const name of REAL_NAMES.slice(0, -1)) expect(screen(walkM({ exit: name })).lines[2]).toBe(`Sortie : ${name.replace(/'/g, '’')}`);
  });

  it('coupe du nom (exitLineText) : mots entiers, mot de liaison retiré, rien faute de place', () => {
    const w = (t: string) => textWidth(t);
    expect(exitLineText('Boulevard Anspach', 400)).toBe('Sortie\u00a0: Boulevard Anspach');
    expect(exitLineText('Boulevard Anspach', w('Sortie\u00a0: Boulevard Anspach'))).toBe('Sortie\u00a0: Boulevard Anspach');
    expect(exitLineText('Boulevard Anspach', w('Sortie\u00a0: Boulevard Anspach') - 1)).toBe('Sortie\u00a0: Boulevard…');
    expect(exitLineText('Rue de la Loi', w('Sortie\u00a0: Rue de la Loi') - 1)).toBe('Sortie\u00a0: Rue…');
    expect(exitLineText('Avenue Herrmann-Debroux', w('Sortie\u00a0: Avenue Herrmann-Debroux') - 1)).toBe('Sortie\u00a0: Avenue…');
    expect(exitLineText('Allée Adrienne Gommers & Anne-Marie van Oost-de-Gerlache', w('Sortie\u00a0: Allée Adrienne Gommers & Anne-Marie van…'))).toBe('Sortie\u00a0: Allée Adrienne Gommers & Anne-Marie…');
    // pas de place pour un mot entier du nom : aucune ligne (jamais « Sortie : … » ni un mot coupé)
    expect(exitLineText('Boulevard Anspach', w('Sortie\u00a0: Boul'))).toBe('');
    expect(exitLineText('Boulevard Anspach', 0)).toBe('');
    expect(exitLineText('', 400)).toBe('');
    expect(exitLineText(undefined, 400)).toBe('');
  });

  it('Quai Web : la même ligne, au même endroit', () => {
    const glasses = screen(walkM({ exit: 'Boulevard Anspach' }));
    const web = screen(walkM({ exit: 'Boulevard Anspach' }), ctx({ web: true }));
    expect(web.lines.slice(0, 3)).toEqual(glasses.lines.slice(0, 3));
    expect(web.pale[2]).toBe('Sortie : Boulevard Anspach');
  });
});

/* ------------------------------ Contrôleur ------------------------------ */

const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const DEST: Endpoint = { type: 'address', label: 'Place Fontainas', lat: FONTAINAS.lat, lon: FONTAINAS.lon };

/** Guidage du trajet lancé à 08:00 depuis l'écran du trajet, sans position (le moteur suit l'heure). */
async function launched(core: (now: () => number) => Partial<Core>, o: { web?: boolean; journey?: Journey } = {}): Promise<Kit> {
  const h = await guideSetup({ now: at('08:00'), settings: settingsWith([], { seenVersion: '1.3.1', display: { ...settingsWith([]).display, guide: true } }), pos: null, coreExtra: core, ...(o.web ? { web: true } : {}) });
  await h.c.show({ screen: 'steps', key: 'k-r1', label: '', title: 'Place Fontainas', journeys: [o.journey ?? trip()], index: 0, from: { type: 'here' } as Endpoint, to: DEST });
  await h.settle();
  await intent(h, { kind: 'goGuide' });
  await h.settle();
  expect(h.c.followed?.guide?.kind).toBe('trip');
  return h;
}

/** Identifiant du moment montré, d'après le journal de l'écran (vraies vues : { kind, id }). */
const momentId = (s: { moment?: unknown }): string => (s.moment as { id?: string } | null | undefined)?.id ?? '';

/** Avance jusqu'à la descente à Bourse (08:14) et rend l'écran de la marche. */
async function afterAlight(h: Kit) {
  await h.settle(at('08:14:10') - h.clock.now());
  // « Descends à Bourse » d'abord : masqué d'un toucher (affiché depuis 2 s), la marche suit
  for (let i = 0; i < 20 && !momentId(h.last()).startsWith('walk:'); i++) {
    await h.settle(2_000);
    if (h.last().show === 'moment' && momentId(h.last()).startsWith('alight:')) await h.gesture('tap');
  }
  return h.last();
}

afterEach(cleanupKit);

describe('R1 : contrôleur, du fichier des sorties à l’écran de la marche', () => {
  it('fichier lu une seule fois au lancement ; après la descente à Bourse : « Sortie : Boulevard Anspach »', async () => {
    let asked = 0;
    const h = await launched(() => ({
      walkExits: async () => {
        asked++;
        return EXITS;
      },
    }));
    expect(asked).toBe(1);
    const s = await afterAlight(h);
    expect(momentId(s)).toBe('walk:jr1:2');
    expect(s.lines.map(nb)).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', 'Sortie : Boulevard Anspach', HINT]);
    expect(asked).toBe(1);
  });

  it('sans toucher : la marche et sa sortie paraissent quand « Descends à » s’efface seul, 2 min après l’arrivée (sous terre, sans position)', async () => {
    const h = await launched(() => ({ walkExits: async () => EXITS }));
    await h.settle(at('08:15:50') - h.clock.now());
    expect(momentId(h.last())).toBe('alight:jr1:1');
    expect(h.last().lines.join('\n')).not.toMatch(/Sortie/);
    await h.settle(20_000);
    expect(momentId(h.last())).toBe('walk:jr1:2');
    expect(nb(h.last().lines[2])).toBe('Sortie : Boulevard Anspach');
  });

  it('Quai Web : la même ligne', async () => {
    const h = await launched(() => ({ walkExits: async () => EXITS }), { web: true });
    const s = await afterAlight(h);
    expect(s.lines.map(nb).slice(0, 3)).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', 'Sortie : Boulevard Anspach']);
  });

  it('fichier absent, illisible ou cœur sans sorties : l’écran de la marche sans ligne « Sortie », aucune erreur ; nouvel essai 10 min plus tard au plus tôt', async () => {
    for (const walkExits of [async () => null, async () => Promise.reject(new Error('réseau')), undefined]) {
      let asked = 0;
      const h = await launched(() =>
        walkExits
          ? {
              walkExits: () => {
                asked++;
                return walkExits();
              },
            }
          : {},
      );
      expect(asked).toBe(walkExits ? 1 : 0);
      // 08:00 → 08:09 : pas de nouvelle lecture ; après 08:10 : une seule
      await h.settle(9 * MIN);
      expect(asked).toBe(walkExits ? 1 : 0);
      await h.settle(2 * MIN);
      expect(asked).toBe(walkExits ? 2 : 0);
      const s = await afterAlight(h);
      expect(s.lines.map(nb)).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', HINT]);
      expect(h.screens().some((x) => x.screen === 'error')).toBe(false);
      cleanupKit();
    }
  });

  it('arrêt de surface ou autre réseau : rien, même avec le fichier', async () => {
    for (const ride of [tram4('5001'), tram4('8362', { op: 'delijn' })]) {
      const h = await launched(() => ({ walkExits: async () => EXITS }), { journey: trip(FONTAINAS, ride) });
      const s = await afterAlight(h);
      expect(s.lines.map(nb)).toEqual(['5 min à pied jusqu’à la place Fontainas', 'arrivée 08:19', HINT]);
      cleanupKit();
    }
  });
});
