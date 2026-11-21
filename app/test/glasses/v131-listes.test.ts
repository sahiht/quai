/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 12) : B21, « Gares de train » en accordéon : sous la gare du curseur, pâles et
 * en retrait, la direction de son prochain train (« vers Bruxelles-Midi »), puis le train d'après (« puis IC vers
 * Liège-Guillemins, 07:54 voie 4 »), lus dans les départs déjà chargés ; les autres gares restent fermées. L6 : les
 * listes dont le toucher ouvre le même tableau ont la même aide (« △▽ choisir   toucher : départs   double : retour » :
 * « Autour de moi », « Gares », « Arrêts ») ; « Lignes » : « toucher : parcours ». Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, StationPick } from '../../src/core/api';
import { textWidth } from '../../src/glasses/font';
import { EXPAND_PX, HINTS, fitName, stationDetail } from '../../src/glasses/format';
import { geometry, layoutPage, WIDTHS, type DetailItem } from '../../src/glasses/layout';
import { effectiveFrame, handleGesture, initNav } from '../../src/glasses/nav';
import { stationsView, type StationRow, type ViewCtx } from '../../src/glasses/views';
import { MIN, STATIONS, at, boardOf, container, lines, nb, overflowing, settingsWith, setup, stubCore, trainAt } from './helpers';

const NOW = at('2026-11-20', 7, 30);
const N = (fr: string, nl = fr) => ({ fr, nl });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const pick = (id: string, name: string): StationPick => ({ id, areaId: `sncb:${id}`, name: N(name), lat: 50.8, lon: 4.3 });
const s1 = trainAt(NOW, 12, { line: 'S1', head: N('Bruxelles-Midi', 'Brussel-Zuid'), platform: '1' });
const ic = trainAt(NOW, 24, { line: 'IC', head: N('Liège-Guillemins', 'Luik-Guillemins'), platform: '4' });
const texts = (next: Departure | undefined, after: Departure | undefined, c: ViewCtx = ctx()) => stationDetail(next, after, NOW, c.settings).map((l) => nb(l.text));

describe('PRD-1.3.1 § 12, B21 : « Gares de train » en accordéon', () => {
  it('la direction du prochain train, puis le train d’après : « puis IC vers Liège-Guillemins, 07:54 voie 4 »', () => {
    expect(texts(s1, ic)).toEqual(['vers Bruxelles-Midi', 'puis IC vers Liège-Guillemins, 07:54 voie 4']);
    // pas de train d'après : la direction seule ; pas de prochain train : rien
    expect(texts(s1, undefined)).toEqual(['vers Bruxelles-Midi']);
    expect(texts(undefined, ic)).toEqual([]);
    // la langue des noms (réglage)
    expect(texts(s1, ic, ctx({ settings: settingsWith([], { lang: 'nl' }) }))).toEqual(['vers Brussel-Zuid', 'puis IC vers Luik-Guillemins, 07:54 voie 4']);
  });

  it('le train d’après : « ~ » sans temps réel (planned), retard, voie modifiée, supprimé, un autre jour', () => {
    const planned = stationDetail(s1, { ...ic, rt: false }, NOW, settingsWith([]));
    expect(planned[1]).toEqual({ text: 'puis IC vers Liège-Guillemins, ~07:54 voie 4', planned: true });
    // sans le « ~ » du réglage : rien de prévu à signaler
    expect(stationDetail(s1, { ...ic, rt: false }, NOW, settingsWith([], { display: { ...settingsWith([]).display, markPlanned: false } }))[1]).toEqual({ text: 'puis IC vers Liège-Guillemins, 07:54 voie 4' });
    expect(texts(s1, { ...ic, delayMin: 3, est: ic.est + 3 * MIN, newPlatform: '6' })[1]).toBe('puis IC vers Liège-Guillemins, 07:54 +3 voie 6 !');
    expect(texts(s1, { ...ic, cancelled: true })[1]).toBe('puis IC vers Liège-Guillemins, 07:54 supprimé');
    const tomorrow = trainAt(NOW, 24 * 60 - 98, { line: 'IC', head: N('Namur'), platform: '2' });
    expect(texts(s1, tomorrow)[1]).toBe('puis IC vers Namur, demain 05:52 voie 2');
  });

  it('un nom trop long est coupé au mot ; l’heure et la voie ne le sont jamais ; tout tient au pixel', () => {
    const long = N('Bruxelles-Aéroport-Zaventem Brussels Airport Terminal Arrivées Départs Niveau Moins Un');
    const t = texts({ ...s1, head: long }, { ...ic, head: long, delayMin: 12, est: ic.est + 12 * MIN, platform: '12', newPlatform: '12a' });
    for (const x of t) expect(textWidth(x)).toBeLessThanOrEqual(EXPAND_PX);
    expect(t[0]).toMatch(/^vers Bruxelles-Aéroport-Zaventem .*…$/);
    // le nom coupé au mot ou après un morceau entier (« Bruxelles-Aéroport-… »), l'heure, le retard et la voie entiers
    expect(t[1]).toMatch(/^puis IC vers Bruxelles-.*…, 07:54 \+12 voie 12a !$/);
    const shown = t[1].replace(/^puis IC vers /, '').replace(/…, 07:54 \+12 voie 12a !$/, '');
    expect(long.fr.startsWith(shown)).toBe(true);
    expect([' ', '-'].includes(long.fr.charAt(shown.length)) || shown.endsWith('-')).toBe(true);
  });

  it('le crénage aux jonctions ne fait jamais dépasser la ligne : la fin (heure, voie) n’est jamais recoupée par la mise en page', () => {
    // vrai nom du balayage : les trois parties tiennent séparément (522 px), le texte entier fait 523 px
    const tail = `, 08:37 +12 voie 12a${'\u00a0'}!`;
    for (const name of ['Kortenaken Krawatenstraat', 'Brussels Airport-Zaventem', 'Lavaux-Sainte-Anne Eglise']) {
      const t = fitName('puis IC vers ', name, tail, EXPAND_PX);
      expect(textWidth(t), t).toBeLessThanOrEqual(EXPAND_PX);
      expect(t.endsWith(`…${tail}`), t).toBe(true);
    }
  });

  it('« Gares » : la gare du curseur s’ouvre, pâle et en retrait ; ▼ : elle se ferme et la suivante s’ouvre ; rien ne dépasse', () => {
    const rows: StationRow[] = [
      { pick: pick('a', 'Braine-l’Alleud'), next: s1, after: ic, state: 'ok' },
      { pick: pick('b', 'Ottignies'), next: ic, state: 'ok' },
      { pick: pick('c', 'Namur'), state: 'none' },
    ];
    const v = stationsView(rows, ctx());
    expect(v.accordion).toBe(true);
    expect((v.items as DetailItem[]).map((i) => i.expand?.length ?? 0)).toEqual([2, 1, 0]);
    expect(lines(v)).toEqual(['Braine-l’Alleud   S1 07:42 voie 1', 'vers Bruxelles-Midi', 'puis IC vers Liège-Guillemins, 07:54 voie 4', 'Ottignies   IC 07:54 voie 4', 'Namur   aucun train', HINTS.stations.replace(/ /g, ' ')]);
    const p = layoutPage(v, { sel: 0, top: 0 });
    expect(overflowing(p)).toEqual([]);
    // pâles (colonne b, niveau 2) et en retrait, comme l'accordéon de « Favoris »
    const colB = container(p, 'colB');
    expect(colB.level).toBe(2);
    const row = colB.content.split('\n')[1];
    expect(colB.x + textWidth(row) - textWidth(row.trimStart())).toBeGreaterThanOrEqual(28 + 19);
    // ▼ : la gare suivante s'ouvre (sa direction), la première se ferme
    const g = geometry(v);
    const next = handleGesture(initNav({ screen: 'stations' }), 'down', v, g.capacity).state;
    const q = layoutPage(v, effectiveFrame(next.stack[0], v, g.capacity));
    expect(q.lines.map(nb)).toEqual(['Braine-l’Alleud   S1 07:42 voie 1', 'Ottignies   IC 07:54 voie 4', 'vers Liège-Guillemins', 'Namur   aucun train', nb(HINTS.stations)]);
    expect(q.sel).toBe(1);
  });

  it('le « ~ » du train d’après demande la note « ~ horaire prévu » ; en calcul, introuvable, aucun train : rien ne s’ouvre', () => {
    const v = stationsView([{ pick: pick('a', 'Namur'), next: s1, after: { ...ic, rt: false }, state: 'ok' }], ctx());
    // contrôle 1.3.1 : la note suit ce qui est à l'écran (notePlanned) : dite sous la gare ouverte et son « ~ »
    expect(v.note).toBeUndefined();
    expect(lines(v).slice(-2)).toEqual(['~ horaire prévu, sans temps réel', nb(HINTS.stations)]);
    const quiet = stationsView([{ pick: pick('a', 'Namur') }, { pick: pick('b', 'Gembloux'), state: 'missing' }, { pick: pick('c', 'Wavre'), state: 'none' }], ctx());
    expect((quiet.items as DetailItem[]).every((i) => !i.expand)).toBe(true);
    // un prochain train déjà parti (réponse vieille de plus de 30 s) : ni rangée ni accordéon jusqu'au rafraîchissement
    const gone = stationsView([{ pick: pick('a', 'Namur'), next: trainAt(NOW, -2), after: ic, state: 'ok' }], ctx());
    expect((gone.items[0] as DetailItem).expand).toBeUndefined();
  });

  it('contrôleur : le train d’après vient des départs déjà lus (3 au plus), sans requête de plus', async () => {
    const calls: string[] = [];
    const boards = (id: string, now: number): Board | undefined =>
      id === STATIONS.braine.areaId ? boardOf(id, 'Braine-l’Alleud', [trainAt(now, 11, { head: N('Bruxelles-Midi') }), trainAt(now, 26, { line: 'S1', head: N('Nivelles'), platform: '3' }), trainAt(now, 41)]) : undefined;
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.1', stations: [STATIONS.braine] }), core: (now) => stubCore(now, { board: boards, calls }) });
    await h.until((x) => x.screen === 'home');
    calls.length = 0;
    await h.c.replaceRoute({ screen: 'stations' });
    const s = await h.until((x) => x.screen === 'stations' && x.lines.length > 2 && !x.lines.some((l) => / …$/.test(l)));
    expect(s.lines.slice(0, 3)).toEqual(['Braine-l’Alleud   IC 07:41 voie 1', 'vers Bruxelles-Midi', 'puis S1 vers Nivelles, 07:56 voie 3']);
    expect(calls.filter((c) => c.startsWith('board:'))).toEqual([`board:${STATIONS.braine.areaId}`]);
    h.c.stop();
  });
});

describe('PRD-1.3.1 § 12, L6 : aides des listes identiques pour le même geste', () => {
  it('« Autour de moi », « Gares » et « Arrêts » : « △▽ choisir   toucher : départs   double : retour » ; « Lignes » : « toucher : parcours »', () => {
    const same = '△▽ choisir   toucher : départs   double : retour';
    expect([HINTS.nearby, HINTS.stations, HINTS.lines].map(nb)).toEqual([same, same, same]);
    expect(nb(HINTS.follows)).toBe('△▽ choisir   toucher : parcours   double : retour');
    // au pixel (404 px et 414 px mesurés par l'expert langage), espaces insécables devant « : »
    for (const h of [HINTS.nearby, HINTS.follows]) {
      expect(textWidth(h)).toBeLessThanOrEqual(WIDTHS.full);
      expect(h).not.toMatch(/ :/);
    }
    expect(textWidth(HINTS.nearby)).toBe(404);
    expect(textWidth(HINTS.follows)).toBe(414);
  });
});
