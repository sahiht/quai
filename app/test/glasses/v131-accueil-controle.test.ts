/**
 * Quai 1.3.1, contrôle indépendant de l'accueil des lunettes (docs/v1.3.1/PRD-1.3.1.md § 8 et § 12 : B15, B20) :
 *  - les 16 combinaisons des cas qui ajoutent une ligne (aide des gestes, trajet suivi, jour férié, ligne du haut), dans
 *    les lunettes et dans Quai Web, avec un favori à souci au nom long : rien ne dépasse, la liste ne défile jamais, la
 *    rangée du curseur entière ;
 *  - le curseur d'un accueil pas encore touché quand « En cours » paraît puis disparaît ;
 *  - B20 pendant le chargement (réponses qui arrivent une à une) : jamais « tu y es » ni « aucun trajet », un favori du
 *    soir jamais sur « … », aucune ligne qui part puis revient ;
 *  - B20 sur un accueil déjà touché (règle 5 figée) : un favori ajouté dont la réponse est « aucun trajet » ou « demain »
 *    ne chasse pas les favoris du soir.
 * Gares, arrêts et lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Endpoint, Favorite, FavoriteAnswer, Journey, StationPick } from '../../src/core/api';
import { LINE_H } from '../../src/glasses/font';
import { geometry, layoutPage } from '../../src/glasses/layout';
import { effectiveFrame } from '../../src/glasses/nav';
import { homeView, type FavoriteEntry, type HomeData, type ViewCtx } from '../../src/glasses/views';
import { LINES, MIN, PLACES, STATIONS, at, boardOf, container, journey, overflowing, settingsWith, setup, stubCore, trainAt, type Screen } from './helpers';

const DAY = '2026-11-12';
const NOW = at(DAY, 20, 47);
/** 11 novembre : jour férié (horaires du dimanche). */
const HOLIDAY = at('2026-11-11', 7, 31);
const NIGHT = at(DAY, 22, 40);
const TOMORROW = '2026-11-13';

/** Trajet vers un lieu : 5 min à pied, bus W, 4 min à pied. */
function door(id: string, leave: number, arr: number): Journey {
  return journey(id, [{ walk: 5 }, { ride: 'W', mode: 'bus', dep: leave + 5 * MIN, arr: arr - 4 * MIN, from: 'Braine-l’Alleud Merbraine', to: 'Bruxelles-Midi' }, { walk: 4 }], { label: 'short', reason: 'Le plus court' });
}
const ok = (fav: Favorite, j: Journey, now: number): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now });
const here = (fav: Favorite, now: number): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'here', plan: { journeys: [], empty: 'here' }, updatedAt: now });
const none = (fav: Favorite, now: number): FavoriteAnswer => ({ favoriteId: fav.id, kind: 'trip', state: 'none', plan: { journeys: [] }, updatedAt: now });
const area = (p: StationPick): Endpoint => ({ type: 'area', areaId: p.areaId, op: 'sncb', name: p.name, lat: p.lat, lon: p.lon });

/* ------------------------------ Les 16 combinaisons, au pixel ------------------------------ */

describe('contrôle 1.3.1, § 8 : les 16 combinaisons des cas qui ajoutent une ligne, lunettes et Quai Web', () => {
  /** Un lieu public au nom long, à souci (travaux) : « … ! » puis la réponse entière. */
  const long: Favorite = { kind: 'place', id: 'fav-long', label: 'Bibliothèque communale de Woluwe-Saint-Lambert', lat: 50.84, lon: 4.42, propose: 'never' };
  const favs = [long, PLACES.parc, PLACES.ecole, PLACES.bureau];
  const entries = (now: number, next: string): FavoriteEntry[] => [
    { fav: long, answer: ok(long, { ...door('j-long', at(next, 5, 52), at(next, 6, 46)), alerts: [{ kind: 'works', text: 'Travaux : ligne 124', at: now }] }, now) },
    { fav: PLACES.parc, answer: ok(PLACES.parc, door('j-parc', now + 4 * MIN, now + 71 * MIN), now) },
    { fav: PLACES.ecole, answer: ok(PLACES.ecole, door('j-ecole', now + 20 * MIN, now + 50 * MIN), now) },
  ];
  const rubrics = { stations: [STATIONS.braine], lines: [LINES.gdnAll], follows: [{ id: 'f-t3', op: 'stib' as const, mode: 'tram' as const, line: '3', routes: [] }] };
  const running = { title: 'Vers la bibliothèque communale de Woluwe-Saint-Lambert', next: 'IC 08:01 +12 voie 13 !', favoriteId: 'fav-bureau' };

  for (let m = 0; m < 16; m++) {
    const help = !!(m & 1);
    const run = !!(m & 2);
    const holiday = !!(m & 4);
    const top = !!(m & 8);
    const name = [help && 'aide des gestes', run && 'trajet suivi', holiday && 'jour férié', top && 'ligne du haut'].filter(Boolean).join(', ') || 'jour ordinaire';
    it(`${name} : rien ne dépasse, la liste ne défile jamais, la rangée du curseur entière`, () => {
      const now = holiday ? HOLIDAY : NOW;
      const d: HomeData = { favorites: entries(now, holiday ? DAY : TOMORROW), nearbyCount: 9, gestureHelp: help, ...(run ? { running } : {}), ...(top ? { notice: 'Horaires de demain pas encore publiés' } : {}) };
      for (const web of [false, true]) {
        const ctx: ViewCtx = { now, settings: settingsWith(favs, rubrics), ...(web ? { web: true } : {}) };
        const v = homeView(d, ctx);
        const g = geometry(v);
        const tag = `${name}${web ? ' (Quai Web)' : ''}`;
        // l'ordre du § 8, quel que soit le cas : « En cours », « Autour de moi », « Favoris », ses favoris, les rubriques
        const kinds = v.items.map((i) => (i.action?.kind === 'open' ? i.action.route.screen : i.action?.kind));
        const n = kinds.filter((k) => k === 'openFavorite').length;
        expect(kinds, tag).toEqual([...(run ? ['resume'] : []), 'nearby', 'favorites', ...Array<string>(n).fill('openFavorite'), 'stations', 'follows', 'lines']);
        // toutes les rangées (la ligne vide comprise) tiennent dans la liste : jamais de défilement
        const rows = v.items.length + v.items.filter((i) => i.gap).length;
        expect(rows, tag).toBeLessThanOrEqual(g.capacity);
        expect(v.initialSel, tag).toBe(0);
        for (let sel = 0; sel < v.items.length; sel++) {
          const p = layoutPage(v, effectiveFrame({ route: { screen: 'home' }, sel, top: 0, fresh: false }, v, g.capacity));
          expect(overflowing(p), `${tag}, rangée ${sel}`).toEqual([]);
          expect([p.top, p.visible, p.sel], `${tag}, rangée ${sel}`).toEqual([0, v.items.length, sel]);
          const cursor = container(p, 'cursor');
          const row = cursor.content.split('\n').indexOf('▶');
          expect(row, `${tag}, rangée ${sel}`).toBe(sel + v.items.slice(0, sel + 1).filter((i) => i.gap).length);
          // la rangée du curseur finit au-dessus du pied (aide des gestes, jour férié), la liste aussi
          expect(cursor.y + (row + 1) * LINE_H, `${tag}, rangée ${sel}`).toBeLessThanOrEqual(g.footY);
          for (const c of ['colA', 'colB', 'colC'].map((x) => container(p, x))) expect(c.y + c.content.split('\n').length * LINE_H, `${tag}, ${c.name}`).toBeLessThanOrEqual(g.footY);
          // le favori à souci, quand il est montré : le nom coupé au mot, « ! » et la réponse entiers
          const fav = p.lines.find((l) => l.startsWith('Bibliothèque'));
          if (n) expect(fav, tag).toMatch(/^Bibliothèque communale(?: de)?… ! {3}demain 05:52 → 06:46$/);
        }
      }
    });
  }
});

/* ------------------------------ Le contrôleur ------------------------------ */

const board = (id: string, n: number) => (id === STATIONS.braine.areaId ? boardOf(id, 'Braine-l’Alleud', [trainAt(n, 20), trainAt(n, 50)]) : undefined);
const ready = (s: Screen) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l)) && s.lines.includes('Autour de moi   9 arrêts');
/** Ligne de l'élément sous le curseur (accueil sans ligne du haut : sans la ligne vide ni l'aide des gestes). */
const selected = (s: Screen): string => s.lines.filter((l) => l !== '' && !l.startsWith('△▽'))[s.sel];

describe('contrôle 1.3.1, § 8 : le curseur d’un accueil pas encore touché quand « En cours » paraît puis disparaît', () => {
  it('« En cours » paraît en tête : le curseur dessus (un toucher reprend le trajet) ; à la fin du trajet : « Autour de moi »', async () => {
    const answers = (fav: Favorite, now: number): FavoriteAnswer | undefined => (fav.id === 'fav-bureau' ? ok(fav, door('j-bureau', NOW + 4 * MIN, NOW + 52 * MIN), now) : fav.id === 'fav-ecole' ? ok(fav, door('j-ecole', now + 10 * MIN, now + 71 * MIN), now) : undefined);
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau, PLACES.ecole], { seenVersion: '1.3.1' }), core: (now) => stubCore(now, { answers }) });
    await h.until((s) => ready(s) && s.shown?.length === 2);
    // suivi par le bouton « Lunettes » du téléphone, puis retour à l'accueil sans y toucher : le trajet part dans 4 min
    await h.c.showTrip({ title: 'Vers le bureau', from: { type: 'here' }, to: { type: 'place', placeId: 'fav-bureau' }, favoriteId: 'fav-bureau', result: { journeys: [door('j-bureau', NOW + 4 * MIN, NOW + 52 * MIN)] }, index: 0 });
    await h.until((s) => s.screen === 'steps' && s.followed === true);
    await h.gesture('double');
    const before = await h.until((s) => ready(s) && s.shown?.length === 2);
    expect(selected(before)).toBe('Autour de moi   9 arrêts');
    // le trajet commence : « En cours » en tête, le curseur dessus
    h.advance(5 * MIN);
    await h.c.refreshCurrent();
    const running = await h.until((s) => ready(s) && s.lines[0].startsWith('En cours'));
    expect(running.lines.slice(1, 3)).toEqual(['Autour de moi   9 arrêts', 'Favoris   2']);
    expect(selected(running)).toMatch(/^En cours : vers le bureau/);
    // fin du trajet : la première rangée redevient « Autour de moi », le curseur y est
    h.advance(60 * MIN);
    await h.c.refreshCurrent();
    const ended = await h.until((s) => s.screen === 'home' && !s.lines[0].startsWith('En cours') && s.lines.some((l) => l.startsWith('Arrêts de bus')));
    expect(ended.lines[0]).toBe('Autour de moi   9 arrêts');
    expect(ended.sel).toBe(0);
    h.c.stop();
  });
});

describe('contrôle 1.3.1, B20 : les favoris du soir pendant le chargement et sur un accueil déjà touché', () => {
  const toNamur: Favorite = { kind: 'trip', id: 'fav-namur', from: area(STATIONS.braine), to: area(STATIONS.namur), propose: 'never' };
  const toNord: Favorite = { kind: 'trip', id: 'fav-nord', from: area(STATIONS.namur), to: area(STATIONS.nord), propose: 'never' };
  const FAVS = [PLACES.bureau, PLACES.parc, PLACES.ecole, toNamur, toNord, PLACES.maison];
  const S = settingsWith(FAVS, { seenVersion: '1.3.1', stations: [STATIONS.braine], lines: [LINES.w] });
  const tomorrow = (fav: Favorite, now: number): FavoriteAnswer => ok(fav, door(`j-${fav.id}`, at(TOMORROW, 5, 52), at(TOMORROW, 6, 46)), now);
  /** À 22:40 : Maison « tu y es », Bureau « aucun trajet », les autres demain ; `soon` part encore ce soir (23:10). */
  const night = (soon?: string) => (fav: Favorite, now: number): FavoriteAnswer =>
    fav.id === 'fav-maison' ? here(fav, now) : fav.id === 'fav-bureau' ? none(fav, now) : fav.id === soon ? ok(fav, door(`j-${fav.id}`, NIGHT + 30 * MIN, NIGHT + 78 * MIN), now) : tomorrow(fav, now);
  /** Faux cœur dont la réponse de chaque favori arrive après son délai (ms réelles), dans le désordre. */
  const slow = (answers: (fav: Favorite, now: number) => FavoriteAnswer, delay: Record<string, number>) => (now: () => number) => {
    const core = stubCore(now, { answers, board });
    const answer = core.answer.bind(core);
    return Object.assign(core, {
      async answer(fav: Favorite, pos: Parameters<typeof answer>[1], s: Parameters<typeof answer>[2]) {
        await new Promise((r) => setTimeout(r, delay[fav.id] ?? 0));
        return answer(fav, pos, s);
      },
    });
  };
  /** Les accueils affichés pendant le chargement : jamais « tu y es » ni « aucun trajet », un « demain » jamais repris, aucune ligne qui revient. */
  function calm(screens: Screen[]): void {
    const homes = screens.filter((s) => s.screen === 'home');
    const gone = new Set<string>();
    let prev: string[] = [];
    for (const s of homes) {
      expect(s.lines.join('\n'), JSON.stringify(s.lines)).not.toMatch(/tu y es|aucun trajet/);
      const shown = s.shown ?? [];
      for (const id of shown) expect(gone.has(id), `${id} revient : ${JSON.stringify(homes.map((x) => x.shown))}`).toBe(false);
      for (const id of prev) if (!shown.includes(id)) gone.add(id);
      prev = shown;
    }
    // un favori du soir une fois montré avec « demain » ne repasse jamais par « … »
    const said = new Set<string>();
    for (const s of homes) {
      for (const l of s.lines) {
        const name = /^(.+?) {3}(demain .+|…)$/.exec(l);
        if (!name) continue;
        if (name[2] === '…') expect(said.has(name[1]), `${name[1]} : « … » après « demain » : ${JSON.stringify(homes.map((x) => x.lines))}`).toBe(false);
        else said.add(name[1]);
      }
    }
  }

  for (const [name, delay] of [
    ['dans l’ordre', { 'fav-bureau': 20, 'fav-parc': 60, 'fav-ecole': 100, 'fav-namur': 140, 'fav-nord': 180, 'fav-maison': 220 }],
    ['à l’envers', { 'fav-bureau': 220, 'fav-parc': 180, 'fav-ecole': 140, 'fav-namur': 100, 'fav-nord': 60, 'fav-maison': 20 }],
    ['mêlées', { 'fav-bureau': 120, 'fav-parc': 20, 'fav-ecole': 200, 'fav-namur': 60, 'fav-nord': 160, 'fav-maison': 90 }],
  ] as [string, Record<string, number>][]) {
    it(`réponses qui arrivent une à une, ${name} : aucune ligne ne part puis revient ; à la fin, les 3 premiers « demain »`, async () => {
      const h = await setup({ now: NIGHT, settings: S, core: slow(night(), delay) });
      const s = await h.until((x) => ready(x) && x.shown?.length === 3 && x.lines.filter((l) => l.includes('demain 05:52')).length === 3);
      await h.settle(300);
      expect(h.last().lines).toEqual(s.lines);
      expect(s.shown).toEqual(['fav-parc', 'fav-ecole', 'fav-namur']);
      expect(s.sel).toBe(0);
      calm(h.screens());
      h.c.stop();
    });

    it(`un favori part encore ce soir, réponses ${name} : ceux de demain s’effacent une fois pour toutes, lui seul à la fin`, async () => {
      const h = await setup({ now: NIGHT, settings: S, core: slow(night('fav-namur'), delay) });
      const s = await h.until((x) => ready(x) && x.shown?.length === 1 && x.lines.some((l) => l.startsWith('Vers Namur   23:10')));
      await h.settle(300);
      expect(h.last().shown).toEqual(['fav-namur']);
      expect(s.lines.some((l) => l.includes('demain'))).toBe(false);
      calm(h.screens());
      h.c.stop();
    });
  }

  it('accueil déjà touché, un favori ajouté sur le téléphone sans trajet ce soir (« aucun trajet », « demain ») : les favoris du soir restent', async () => {
    const zoo: Favorite = { kind: 'place', id: 'fav-zoo', label: 'Zoo', lat: 51.2166, lon: 4.4233, propose: 'never' };
    let zooAnswer: (fav: Favorite, now: number) => FavoriteAnswer = none;
    const answers = (fav: Favorite, now: number): FavoriteAnswer => (fav.id === 'fav-zoo' ? zooAnswer(fav, now) : night()(fav, now));
    const h = await setup({ now: NIGHT, settings: S, core: (now) => stubCore(now, { answers, board }) });
    await h.until((x) => ready(x) && x.shown?.length === 3 && x.lines.some((l) => l.startsWith('Vers Namur')));
    // l'accueil est touché : ▼ puis ▲ (la règle 5 est figée)
    await h.gesture('down', 'down');
    expect(selected(h.last())).toMatch(/^Parc {3}demain/);
    const evening = ['Parc   demain 05:52 → 06:46', 'École   demain 05:52 → 06:46'];
    // le zoo ajouté en tête sur le téléphone : sa réponse (« aucun trajet ») ne dit pas qu'il peut partir ce soir
    await h.settings.update((x) => ({ ...x, favorites: [zoo, ...x.favorites] }));
    const added = await h.until((x) => ready(x) && x.lines.some((l) => l.startsWith('Zoo   ')));
    await h.settle(150);
    expect(h.last().lines.filter((l) => l.includes('demain'))).toEqual(evening);
    expect(added.lines).toContain('Favoris   7');
    // le curseur est resté sur Parc
    expect(selected(h.last())).toMatch(/^Parc {3}demain/);
    // sa réponse recalculée : demain lui aussi ; les favoris du soir toujours là
    zooAnswer = tomorrow;
    await h.c.refreshCurrent(true);
    await h.until((x) => ready(x) && x.lines.includes('Zoo   demain 05:52 → 06:46'));
    await h.settle(150);
    expect(h.last().lines.filter((l) => l.includes('demain'))).toEqual(['Zoo   demain 05:52 → 06:46', ...evening]);
    // puis un trajet ce soir (23:10) : lui seul, la règle de la 1.2.1
    zooAnswer = (fav, now) => ok(fav, door('j-zoo', NIGHT + 30 * MIN, NIGHT + 78 * MIN), now);
    await h.c.refreshCurrent(true);
    const soon = await h.until((x) => ready(x) && x.lines.includes('Zoo   23:10 → 23:58'));
    await h.settle(150);
    expect(h.last().shown).toEqual(['fav-zoo']);
    expect(soon.lines.some((l) => l.includes('demain'))).toBe(false);
    h.c.stop();
  });
  it('remarque 4 du contrôle : accueil touché, laissé affiché jusqu’au matin, le cœur ne recalcule plus : un favori du soir dépassé (« … ») quitte l’accueil', async () => {
    // École garde un trajet plus tard (06:30) ; Parc et Namur partaient à 05:52
    let down = false;
    const answers = (fav: Favorite, now: number): FavoriteAnswer => {
      if (down) throw new Error('pas de réseau');
      return fav.id === 'fav-ecole' ? ok(fav, door('j-ecole', at(TOMORROW, 6, 30), at(TOMORROW, 7, 10)), now) : night()(fav, now);
    };
    const h = await setup({ now: NIGHT, settings: S, core: (now) => stubCore(now, { answers, board }) });
    await h.until((x) => ready(x) && x.shown?.length === 3 && x.lines.some((l) => l.startsWith('Vers Namur')));
    await h.gesture('down', 'down');
    expect(h.last().shown).toEqual(['fav-parc', 'fav-ecole', 'fav-namur']);
    // le lendemain à 05:53 : les départs de 05:52 sont passés, les réponses ne se recalculent plus
    down = true;
    h.advance(at(TOMORROW, 5, 53) - NIGHT);
    await h.c.refreshCurrent(true);
    await h.settle(150);
    const morning = h.last();
    expect(morning.screen).toBe('home');
    // seul le favori dont la réponse montre encore un trajet reste ; jamais une ligne « … » d'un favori du soir
    expect(morning.shown).toEqual(['fav-ecole']);
    expect(morning.lines.some((l) => /^(Parc|Vers Namur) /.test(l))).toBe(false);
    expect(morning.lines.some((l) => l.startsWith('École   06:30'))).toBe(true);
    h.c.stop();
  });
});
