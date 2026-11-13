/**
 * Quai 1.2.5, côté lunettes (docs/v1.2.5/PRD-1.2.5.md) : « Si tu le rates » (§ 1), marge des correspondances (§ 2),
 * pluie prévue sur les marches (§ 3), « Bus, tram, métro » en mots clairs et pâles (§ 4), ligne de progression dans le
 * véhicule et retards gardés (§ 5, § 7), caractères de sens d'écriture retirés (§ 9). Trajets construits à la main au
 * 13/11, à partir de 07:31.
 */
import { describe, expect, it } from 'vitest';
import type { Journey, Leg } from '../../src/core/api';
import { glyphSafe, missingGlyphs, textWidth } from '../../src/glasses/font';
import { MARGIN_SHOWN_MAX, NOTE_RT_KEPT, PROGRESS_MAX, alightWords, marginText, missText, progressLine } from '../../src/glasses/format';
import { GEO, LAYOUTS, WIDTHS, layoutPage, segRow } from '../../src/glasses/layout';
import { describeContainers } from '../../src/web/display';
import { MISS_WINDOW_MIN, linesView, missLine, otherDetail, stepsPage, trainView, type ViewCtx } from '../../src/glasses/views';
import { LINES, MIN, at, container, dep, journey, lineBoardOf, lines, nb, page, rowsOf, settingsWith } from './helpers';

const DAY = '2026-11-13';
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const NOW = T(7, 31);
const ctx = (now = NOW, patch = {}): ViewCtx => ({ now, settings: settingsWith([], patch) });
const top = (j: Journey, journeys: Journey[], now = NOW): string => nb(lines(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: journeys.indexOf(j), fresh: true }, ctx(now)))[0]);

/** Le plus court : à pied 5 min, bus 36 à Maison Arrêt (07:43), à pied 4 min, IC à Braine-l'Alleud (08:01). */
const j1 = journey(
  'j1',
  [
    { walk: 5, to: 'Maison Arrêt' },
    { ride: '36', mode: 'bus', dep: T(7, 43), arr: T(7, 55), from: 'Maison Arrêt', to: 'Braine-l’Alleud', head: 'Rixensart' },
    { walk: 4, to: 'Braine-l’Alleud' },
    { ride: 'IC', mode: 'train', dep: T(8, 1), arr: T(8, 24), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '3' },
    { walk: 2 },
  ],
  { label: 'short', reason: 'Le plus court : 1 changement, à pied 5 + 4 + 2 min' },
);
/** Plus tôt : 19 min à pied jusqu'à la gare, l'IC de 07:55. */
const j2 = journey('j2', [{ walk: 19, to: 'Braine-l’Alleud' }, { ride: 'IC', mode: 'train', dep: T(7, 55), arr: T(8, 17), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '1' }, { walk: 3 }], {
  label: 'earlier',
  reason: 'Plus tôt de 6 min, mais 19 min à pied',
});
/** Le suivant : le même trajet 30 min plus tard. */
const j3 = journey(
  'j3',
  [
    { walk: 5, to: 'Maison Arrêt' },
    { ride: '36', mode: 'bus', dep: T(8, 13), arr: T(8, 25), from: 'Maison Arrêt', to: 'Braine-l’Alleud', head: 'Rixensart' },
    { walk: 4, to: 'Braine-l’Alleud' },
    { ride: 'IC', mode: 'train', dep: T(8, 31), arr: T(8, 54), from: 'Braine-l’Alleud', to: 'Bruxelles-Central', head: 'Liers', platform: '3' },
    { walk: 2 },
  ],
  { label: 'next', reason: 'Le suivant : même trajet, 30 min plus tard' },
);
const ALL = [j1, j2, j3];

/** Trajet d'un tram depuis l'arrêt X (départ `d`, arrivée `a`), à bord dès le départ, puis une suite éventuelle. */
const tramFrom = (id: string, d: number, a: number, then: Parameters<typeof journey>[1] = []): Journey =>
  journey(id, [{ ride: '3', mode: 'tram', dep: d, arr: a, from: 'Gare du Nord', to: 'Bourse', head: 'Churchill' }, ...then], { reason: `Raison de ${id}` });

const withRain = (j: Journey, ...walks: number[]): Journey => ({ ...j, legs: j.legs.map((l, i) => (walks.includes(i) ? { ...l, rain: true } : l)) });

describe('PRD-1.2.5 § 1 : « Si tu le rates »', () => {
  it('5 min au plus avant de partir, et jusqu’au départ du premier véhicule ; sinon la raison', () => {
    expect(MISS_WINDOW_MIN).toBe(5);
    // départ à pied à 07:38 : à 07:32, encore la raison ; à 07:33, « Si tu le rates »
    expect(top(j1, ALL, T(7, 32))).toBe('Le plus court : 1 changement, à pied 5 + 4 + 2 min');
    expect(top(j1, ALL, T(7, 33))).toBe('Si tu le rates : arrivée 08:56, 30 min plus tard');
    // en marchant vers l'arrêt, avant le bus : encore
    expect(top(j1, ALL, T(7, 42))).toBe('Si tu le rates : arrivée 08:56, 30 min plus tard');
    // le bus est parti : la raison revient
    expect(top(j1, ALL, T(7, 43))).toBe('Le plus court : 1 changement, à pied 5 + 4 + 2 min');
  });

  it('raté à l’arrêt : les trajets qui repartent du même arrêt plus tard, jamais d’un autre ; un autre trajet peut y passer', () => {
    // le bus 36 raté à Maison Arrêt : seul « Le suivant » en repart (« Plus tôt » part de la gare, à 19 min à pied)
    expect(nb(missLine(j1, ALL, j1.leaveAt, T(7, 34))!)).toBe('Si tu le rates : arrivée 08:56, 30 min plus tard');
    // l'IC de 07:55 raté à Braine-l'Alleud : l'IC de 08:01 du premier trajet y passe, arrivée 08:26
    expect(nb(missLine(j2, ALL, j2.leaveAt, T(7, 31))!)).toBe('Si tu le rates : arrivée 08:26, 6 min plus tard');
    // rien n'en repart : rien (la raison reste)
    expect(missLine(j3, ALL, j3.leaveAt, T(8, 6))).toBeNull();
    expect(top(j3, ALL, T(8, 6))).toBe('Le suivant : même trajet, 30 min plus tard');
  });

  it('même nom : même arrêt jusqu’à 400 m (distance réelle, diagonale comprise), au-delà un autre', () => {
    const a = tramFrom('a', T(7, 35), T(8, 0));
    const moved = (id: string, dLat: number, dLon: number): Journey => {
      const x = tramFrom(id, T(7, 45), T(8, 10));
      const r = x.legs[0];
      x.legs[0] = { ...r, from: { ...r.from, lat: r.from.lat + dLat, lon: r.from.lon + dLon } };
      return x;
    };
    // 278 m au nord : le même arrêt
    expect(nb(missLine(a, [a, moved('near', 0.0025, 0)], a.leaveAt, NOW)!)).toBe('Si tu le rates : arrivée 08:10, 10 min plus tard');
    // 334 m au nord et 317 m à l'est (460 m) : un autre arrêt
    expect(missLine(a, [a, moved('far', 0.003, 0.0045)], a.leaveAt, NOW)).toBeNull();
  });

  it('même heure d’arrivée ; arrivée plus tôt par un autre trajet : « pas plus tard » ; à bord dès le départ', () => {
    const a = tramFrom('a', T(7, 35), T(8, 0));
    const same = tramFrom('same', T(7, 40), T(8, 0));
    const sooner = tramFrom('sooner', T(7, 40), T(7, 58));
    expect(nb(missLine(a, [a, same], a.leaveAt, NOW)!)).toBe('Si tu le rates : même heure d’arrivée');
    expect(nb(missLine(a, [a, same, sooner], a.leaveAt, NOW)!)).toBe('Si tu le rates : arrivée 07:58, pas plus tard');
    expect(nb(missText(T(7, 58), -2, NOW))).toBe('Si tu le rates : arrivée 07:58, pas plus tard');
    expect(nb(missText(T(9, 0), 60, NOW))).toBe('Si tu le rates : arrivée 09:00, 1 h plus tard');
    expect(nb(missText(T(9, 32), 92, NOW))).toBe('Si tu le rates : arrivée 09:32, 1 h 32 plus tard');
    // passé minuit : le jour est dit, et la durée en heures
    const late = at('2026-11-13', 23, 40);
    expect(nb(missText(at('2026-11-14', 6, 30), 452, late))).toBe('Si tu le rates : arrivée demain 06:30, 7 h 32 plus tard');
    // la nuit (avant le début de journée de l'appli) : pas de « demain », comme partout ailleurs
    expect(nb(missText(at('2026-11-14', 0, 20), 30, late))).toBe('Si tu le rates : arrivée 00:20, 30 min plus tard');
    // à bord dès le départ (07:35) : la fenêtre part du départ du tram
    expect(missLine(a, [a, same], a.leaveAt, T(7, 29))).toBeNull();
    expect(missLine(a, [a, same], a.leaveAt, T(7, 30))).not.toBeNull();
  });

  it('premier véhicule supprimé : l’alerte, jamais « Si tu le rates » ; un trajet de repli supprimé plus loin ne compte pas', () => {
    const a = tramFrom('a', T(7, 35), T(8, 0));
    const later = tramFrom('later', T(7, 40), T(8, 5));
    const cancelled: Journey = { ...a, legs: a.legs.map((l) => (l.kind === 'ride' ? { ...l, cancelled: true } : l)), alerts: [{ kind: 'cancel', text: '! Supprimé : le tram 3 de 07:35', at: NOW }] };
    expect(missLine(cancelled, [cancelled, later], cancelled.leaveAt, NOW)).toBeNull();
    expect(top(cancelled, [cancelled, later])).toBe('! Supprimé : le tram 3 de 07:35');
    // l'alerte passe toujours avant « Si tu le rates »
    const alerted: Journey = { ...a, alerts: [{ kind: 'platform', text: '! Voie modifiée', at: NOW }] };
    expect(top(alerted, [alerted, later])).toBe('! Voie modifiée');
    // le repli : le tram de 07:40 puis un bus supprimé : son arrivée ne vaut plus
    const broken = tramFrom('broken', T(7, 40), T(7, 50), [{ ride: '95', mode: 'bus', dep: T(7, 52), arr: T(7, 58), from: 'Bourse', to: 'Flagey', head: 'Wiener' }]);
    broken.legs[1] = { ...broken.legs[1], cancelled: true };
    expect(missLine(a, [a, broken], a.leaveAt, NOW)).toBeNull();
    expect(nb(missLine(a, [a, broken, later], a.leaveAt, NOW)!)).toBe('Si tu le rates : arrivée 08:05, 5 min plus tard');
  });

  it('textes : une ligne des lunettes, espace insécable devant « : »', () => {
    const late = at('2026-11-13', 23, 40);
    for (const t of [missText(T(23, 59), 1439, NOW), missText(T(8, 0), 0, NOW), missText(T(8, 0), -59, NOW), missText(at('2026-11-14', 23, 59), 1459, late), missText(at('2026-11-14', 6, 30), -1, late)]) {
      expect(t).toMatch(/^Si tu le rates : /);
      expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.full);
    }
  });
});

describe('PRD-1.2.5 § 2 : marge d’une correspondance de 5 min ou moins', () => {
  const state = (j: Journey, now: number, needle: RegExp): string => {
    const row = lines(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, ctx(now)), 0).find((l) => needle.test(nb(l)));
    if (!row) throw new Error(`étape ${needle} absente`);
    return nb(row);
  };
  const shift = (j: Journey, legIndex: number, deltaMin: number): Journey => ({
    ...j,
    legs: j.legs.map((l, i) => (i === legIndex ? { ...l, dep: l.dep + deltaMin * MIN, arr: l.arr + deltaMin * MIN, schedDep: l.schedDep + deltaMin * MIN, schedArr: l.schedArr + deltaMin * MIN } : l)),
  });

  it('« marge 2 min » sur l’étape du véhicule ; jamais sur le premier véhicule ; plus de 5 min : rien', () => {
    expect(MARGIN_SHOWN_MAX).toBe(5);
    // bus jusqu'à 07:55, 4 min à pied, l'IC à 08:01 : 2 min de marge
    expect(state(j1, NOW, /^08:01 /)).toBe('08:01   IC vers Liers, voie 3   marge 2 min');
    expect(state(j1, NOW, /^07:43 /)).toBe('07:43   Bus 36 vers Rixensart');
    // l'IC 5 min plus tard : 7 min de marge, rien
    expect(state(shift(j1, 3, 5), NOW, /^08:06 /)).toBe('08:06   IC vers Liers, voie 3');
    // 3 min plus tard : 5 min de marge, dite
    expect(state(shift(j1, 3, 3), NOW, /^08:04 /)).toBe('08:04   IC vers Liers, voie 3   marge 5 min');
  });

  it('« très juste » sans marge (ou en retard) ; « en cours » une fois dedans ; « SUPPRIMÉ » d’abord', () => {
    expect(marginText(0)).toBe('très juste');
    expect(marginText(-3)).toBe('très juste');
    expect(nb(marginText(4))).toBe('marge 4 min');
    // le bus arrive 2 min plus tard (07:57) : 4 min de marche, l'IC à 08:01 : 0 min
    const late: Journey = { ...j1, legs: j1.legs.map((l, i) => (i === 1 ? { ...l, arr: l.arr + 2 * MIN, delayMin: 2 } : i === 2 ? { ...l, dep: l.dep + 2 * MIN, arr: l.arr + 2 * MIN } : l)) };
    expect(state(late, NOW, /^08:01 /)).toBe('08:01   IC vers Liers, voie 3   très juste');
    // dans l'IC : « en cours »
    expect(state(j1, T(8, 5), /^08:01 /)).toBe('08:01   IC vers Liers, voie 3   en cours');
    const gone: Journey = { ...j1, legs: j1.legs.map((l, i) => (i === 3 ? { ...l, cancelled: true } : l)) };
    expect(state(gone, NOW, /^08:01 /)).toBe('08:01   IC vers Liers, voie 3   SUPPRIMÉ');
  });

  it('retard du véhicule : « +3 min » (l’heure de la ligne est la prévue) ; aucune marge : « très juste » quand même', () => {
    // l'IC a 3 min de retard (08:04 au lieu de 08:01), la marche finit à 07:59 : son retard, comme la 1.2.4
    const delayed: Journey = { ...j1, legs: j1.legs.map((l, i) => (i === 3 ? { ...l, dep: l.dep + 3 * MIN, arr: l.arr + 3 * MIN, delayMin: 3 } : l)) };
    expect(state(delayed, NOW, /^08:01 /)).toBe('08:01   IC vers Liers, voie 3   +3 min');
    // le bus a 6 min de retard (arrivée 08:01, à pied jusqu'à 08:05), l'IC 1 min (08:02) : « très juste » passe avant
    const both: Journey = {
      ...j1,
      legs: j1.legs.map((l, i) =>
        i === 1 ? { ...l, dep: l.dep + 6 * MIN, arr: l.arr + 6 * MIN, delayMin: 6 } : i === 2 ? { ...l, dep: l.dep + 6 * MIN, arr: l.arr + 6 * MIN } : i === 3 ? { ...l, dep: l.dep + MIN, arr: l.arr + MIN, delayMin: 1 } : l,
      ),
    };
    expect(state(both, NOW, /^08:01 {3}IC/)).toBe('08:01   IC vers Liers, voie 3   très juste');
    expect(state(both, NOW, /^07:43 /)).toBe('07:43   Bus 36 vers Rixensart   +6 min');
  });
});

describe('PRD-1.2.5 § 3 : pluie prévue sur les marches de 5 min ou plus', () => {
  const stepLines = (j: Journey, journeys = [j], now = NOW) => lines(stepsPage({ title: 'Vers le bureau', label: '' }, { journeys, index: journeys.indexOf(j), fresh: true }, ctx(now))).map(nb);

  it('« (5 min, pluie) » au départ à pied, « (2 min à pied) » sans : la marche de 4 min n’en dit jamais rien', () => {
    const wet = withRain(j1, 0, 2, 4);
    const l = stepLines(wet, [wet], T(7, 20));
    expect(l).toContain('07:38   Partir à pied vers l’arrêt (5 min, pluie)   dans 18 min');
    // la marche de 4 min et celle de 2 min : trop courtes pour la pluie, même marquées
    expect(l).toContain('07:55   À pied vers la gare (4 min)');
    for (const x of l) expect(textWidth(x)).toBeLessThanOrEqual(WIDTHS.full);
  });

  it('arrivée à pied, trajet tout à pied ; jamais sans marque du cœur', () => {
    const end = journey('e', [{ ride: '3', mode: 'tram', dep: T(7, 40), arr: T(7, 50), from: 'Gare du Nord', to: 'Bourse', head: 'Churchill' }, { walk: 6 }]);
    const wetEnd = withRain(end, 1);
    expect(stepLines(wetEnd)).toContain('07:56   Arrivée au bureau (6 min à pied, pluie)');
    expect(stepLines(end)).toContain('07:56   Arrivée au bureau (6 min à pied)');
    const walk: Journey = { id: 'w', legs: [{ kind: 'walk', from: { name: { fr: 'Ici', nl: 'Ici' }, lat: 50.8, lon: 4.3 }, to: { name: { fr: 'Bureau', nl: 'Bureau' }, lat: 50.8, lon: 4.3 }, dep: T(7, 40), arr: T(7, 52), schedDep: T(7, 40), schedArr: T(7, 52), walkMin: 12, rain: true }], dep: T(7, 40), arr: T(7, 52), leaveAt: T(7, 40), transfers: 0, rt: true, alerts: [] };
    expect(stepLines(walk).some((x) => /^07:40   Partir à pied \(12 min, pluie\)/.test(x))).toBe(true);
    // « Autres trajets » : à pied tout du long, sous la pluie
    expect(nb(otherDetail(walk, [j1, walk]))).toBe('à pied, 12 min sous la pluie');
    expect(nb(otherDetail({ ...walk, legs: [{ ...walk.legs[0], rain: undefined }] }, [j1, walk]))).toBe('à pied, 12 min');
  });

  it('« Autres trajets » : « mais 19 min à pied sous la pluie », « moins de marche sous la pluie »', () => {
    const wet2 = withRain(j2, 0);
    expect(nb(otherDetail(wet2, [j1, wet2]))).toBe('IC, 6 min plus tôt, mais 19 min à pied sous la pluie');
    expect(nb(otherDetail(j2, [j1, j2]))).toBe('IC, 6 min plus tôt, mais 19 min à pied');
    // le premier trajet marche sous la pluie : l'autre en marche moins
    const lesswalk = { ...j1, id: 'lw', label: 'lesswalk' as const };
    expect(nb(otherDetail(lesswalk, [wet2, lesswalk]))).toBe('bus 36 + IC, 6 min plus tard, moins de marche sous la pluie');
    // sans étiquette : les marches, et la pluie
    const plain = { ...withRain(j3, 0), label: undefined };
    expect(nb(otherDetail(plain, [j1, plain]))).toBe('bus 36 + IC, à pied 5 + 4 + 2 min sous la pluie');
    for (const t of [otherDetail(wet2, [j1, wet2]), otherDetail(lesswalk, [wet2, lesswalk]), otherDetail(plain, [j1, plain])]) expect(textWidth(t)).toBeLessThanOrEqual(WIDTHS.full);
  });
});

describe('PRD-1.2.5 § 4 : « Bus, tram, métro » en mots clairs et pâles', () => {
  const board = (now: number) =>
    lineBoardOf(LINES.w.areaId, 'Braine-l’Alleud Merbraine', 'W', [
      { head: 'Bruxelles Midi', departures: [dep(now, 20), dep(now, 37, { rt: false })] },
      { head: 'Braine-l’Alleud Gare', departures: [dep(now, 11)] },
    ]);

  it('la ligne et sa destination au plus clair (colonne a), « vers » et l’arrêt pâles (colonne b), les passages à droite', () => {
    const v = linesView([{ pick: LINES.w, board: board(NOW) }], ctx(NOW, { lines: [LINES.w] }));
    const p = page(v);
    expect(p.lines.map(nb).slice(0, 4)).toEqual(['LIGNES', 'Bus W vers Bruxelles Midi   20 · ~37 min', 'Bus W vers Braine-l’Alleud Gare   11 min', 'Braine-l’Alleud Merbraine']);
    // Quai Web, lecteurs d'écran : les mots dans l'ordre de l'écran, pas colonne par colonne
    const said = nb(describeContainers(p.containers));
    expect(said).toContain('sélection : Bus W vers Bruxelles Midi, 20 · ~37 min');
    expect(said).toContain('Bus W vers Braine-l’Alleud Gare, 11 min. Braine-l’Alleud Merbraine');
    const a = rowsOf(container(p, 'colA'));
    const b = rowsOf(container(p, 'colB'));
    const c = rowsOf(container(p, 'colC'));
    expect(container(p, 'colA').level).toBe(4);
    expect(container(p, 'colB').level).toBe(2);
    expect(container(p, 'colC').level).toBe(4);
    // rangée 1 (la 0 est l'intitulé « LIGNES ») : « Bus W » et « Bruxelles Midi » clairs, « vers » pâle, au pixel
    expect(a[1].trim().split(/ {2,}/)).toEqual(['Bus W', 'Bruxelles Midi']);
    expect(b[1].trim()).toBe('vers');
    expect(c[1].trim()).toBe('20 · ~37 min');
    // « vers » commence après « Bus W » et deux espaces (le W déborde de sa chasse) ; la destination après « vers »
    const xVers = textWidth(b[1].match(/^ */)![0]);
    const xDest = textWidth(a[1].slice(0, a[1].indexOf('Bruxelles')));
    expect(xVers).toBeGreaterThanOrEqual(textWidth('Bus W') + 8);
    expect(xDest).toBeGreaterThanOrEqual(xVers + textWidth('vers') + 4);
    // l'arrêt : pâle, en retrait, rien de clair sur sa rangée
    expect(b[3].trim()).toBe('Braine-l’Alleud Merbraine');
    expect((a[3] ?? '').trim()).toBe('');
  });

  it('segRow : destination trop longue coupée, jamais les passages ; chaque conteneur tient', () => {
    const r = segRow([{ t: 'Bus W', hi: true }, { t: 'vers' }, { t: 'Louvain-la-Neuve Place des Sciences par le chemin des écoliers', hi: true }], 0, 'demain ~05:32', LAYOUTS.lines);
    expect(r.log).toMatch(/^Bus W vers Louvain-la-Neuve .*…   demain ~05:32$/);
    expect(r.c.trim()).toBe('demain ~05:32');
    // la destination coupée s'arrête avant la colonne des passages
    const right = LAYOUTS.lines.c.x + (LAYOUTS.lines.c.w ?? 0) - textWidth(r.c.trim());
    expect(LAYOUTS.lines.a.x + textWidth(r.a)).toBeLessThan(right);
    // sans texte à droite : toute la largeur
    const wide = segRow([{ t: 'Tram 3', hi: true }, { t: 'vers' }, { t: 'Churchill', hi: true }], 20, undefined, LAYOUTS.lines);
    expect(wide).toMatchObject({ c: '', log: 'Tram 3 vers Churchill' });
    expect(wide.a.startsWith('    ')).toBe(true);
  });

  it('segRow, balayage au pixel (vraie police) : les mots finissent toujours 10 px avant les passages, ou au bord sûr sans eux', () => {
    const def = LAYOUTS.lines;
    const vehicles = ['Bus W', 'Bus 36', 'Bus 365a', 'Bus M', 'Tram 81', 'Tram 3', 'Tram 7', 'Métro 2', 'Métro 1', 'Bus 1', 'Bus 820', 'Bus WW'];
    const heads = [
      'Churchill',
      'Bruxelles Midi',
      'Louvain-la-Neuve Gare des Bus',
      'Waterloo Chaussée de Bruxelles',
      'Montgomery Square Montgomery',
      'Simonis (Elisabeth)',
      'Braine-l’Alleud Merbraine',
      'Woluwe-Saint-Lambert Hôpital Saint-Luc',
      'Wavre',
      'Gare de Mons Rue des Wallons',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
      'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii',
    ];
    const rights = [undefined, '1 min', 'imminent', 'imminent · 9 min', 'SUPPRIMÉ', 'demain ~05:32', '20 · ~37 min', '12 · 45 min', '~06:04', 'demain ~23:59'];
    let n = 0;
    for (const v of vehicles)
      for (const h of heads)
        for (const r of rights)
          for (const indent of [0, def.subIndent ?? 0]) {
            const row = segRow([{ t: v, hi: true }, { t: 'vers' }, { t: h, hi: true }], indent, r, def);
            const end = Math.max(row.a ? def.a.x + textWidth(row.a) : 0, row.b ? def.b.x + textWidth(row.b) : 0);
            const what = `${v} vers ${h} | ${r ?? '-'} | retrait ${indent}`;
            if (r) {
              expect(nb(row.c.trim()), what).toBe(r);
              const start = def.c.x + textWidth(row.c) - textWidth(row.c.trim());
              expect(start - end, what).toBeGreaterThanOrEqual(def.gap ?? 0);
              expect(def.c.x + textWidth(row.c), what).toBeLessThanOrEqual(GEO.X_END - GEO.SAFETY);
            } else expect(end, what).toBeLessThanOrEqual(GEO.X_END - GEO.SAFETY);
            // le véhicule et « vers » restent entiers ; seule la destination est coupée
            expect(nb(row.log).startsWith(`${v} vers `), what).toBe(true);
            n++;
          }
    expect(n).toBe(vehicles.length * heads.length * rights.length * 2);
  });

  it('arrêt : son nom pâle, ses deux prochains départs dessous, un par ligne ; sans départ : « aucun passage » ; en attente : « … »', () => {
    const stop = { ...LINES.gdnAll };
    const deps = [
      { ...dep(NOW, 1, { line: '3', head: { fr: 'Churchill', nl: 'Churchill' } }), op: 'stib' as const, mode: 'tram' as const },
      { ...dep(NOW, 4, { line: '4', head: { fr: 'Stalle (P)', nl: 'Stalle (P)' } }), op: 'stib' as const, mode: 'tram' as const },
      { ...dep(NOW, 6, { line: '3', head: { fr: 'Esplanade', nl: 'Esplanade' } }), op: 'stib' as const, mode: 'tram' as const },
    ];
    const v = linesView([{ pick: stop, stop: { areaId: stop.areaId, name: stop.name, departures: deps, anyPlanned: false, rtErrors: [] } as never }], ctx(NOW, { lines: [stop] }));
    const p = page(v);
    expect(p.lines.map(nb).slice(0, 4)).toEqual(['ARRÊTS', 'Gare du Nord', 'Tram 3 vers Churchill   1 min', 'Tram 4 vers Stalle   4 min']);
    // le nom de l'arrêt pâle (colonne b), rien de clair sur sa rangée
    expect(rowsOf(container(p, 'colB'))[1].trim()).toBe('Gare du Nord');
    expect((rowsOf(container(p, 'colA'))[1] ?? '').trim()).toBe('');
    const none = linesView([{ pick: stop, stop: { areaId: stop.areaId, name: stop.name, departures: [], anyPlanned: false, rtErrors: [] } as never }], ctx(NOW, { lines: [stop] }));
    expect(lines(none).slice(0, 3)).toEqual(['ARRÊTS', 'Gare du Nord', 'aucun passage dans les prochaines heures']);
    const wait = linesView([{ pick: stop }], ctx(NOW, { lines: [stop] }));
    expect(lines(wait).slice(0, 3)).toEqual(['ARRÊTS', 'Gare du Nord', '…']);
    const lost = linesView([{ pick: stop, missing: true }], ctx(NOW, { lines: [stop] }));
    expect(lines(lost).slice(0, 3)).toEqual(['ARRÊTS', 'Gare du Nord', 'introuvable : modifie-le sur le téléphone']);
  });
});

describe('PRD-1.2.5 § 7 : ligne de progression dans le véhicule', () => {
  it('cercles pleins passés, cerclé le prochain, vides à venir ; plus de 7 arrêts : « … » ; toujours une ligne', () => {
    expect(progressLine(2, 0)).toBe('◎─○');
    expect(progressLine(5, 2)).toBe('●─●─◎─○─○');
    expect(PROGRESS_MAX).toBe(7);
    expect(progressLine(7, 6)).toBe('●─●─●─●─●─●─◎');
    // 12 arrêts, descente proche : le début remplacé par « … »
    expect(progressLine(12, 9)).toBe('…─●─●─●─◎─○─○');
    expect(progressLine(12, 11)).toBe('…─●─●─●─●─●─◎');
    // 12 arrêts, descente lointaine : le milieu remplacé par « … », la descente en dernier
    expect(progressLine(12, 1)).toBe('●─◎─○─○─○─…─○');
    expect(progressLine(12, 0)).toBe('◎─○─○─○─○─…─○');
    // des arrêts passés cachés avant le précédent : « … » en tête aussi (jamais d'arrêts qui disparaissent sans marque)
    expect(progressLine(12, 2)).toBe('…─●─◎─○─○─…─○');
    expect(progressLine(12, 4)).toBe('…─●─◎─○─○─…─○');
    expect(alightWords(1)).toBe('descente au prochain arrêt');
    expect(alightWords(4)).toBe('descente dans 4 arrêts');
    for (let n = 2; n <= 40; n++) {
      for (let k = 0; k < n; k++) {
        const line = progressLine(n, k);
        const t = `${line}   ${alightWords(Math.max(1, n - Math.max(1, k)))}`;
        expect(missingGlyphs(t), t).toEqual([]);
        expect(textWidth(t), t).toBeLessThanOrEqual(WIDTHS.full);
        // 7 signes au plus ; le prochain arrêt et la descente toujours là ; un arrêt passé caché : « … » en tête
        const signs = line.split('─');
        expect(signs.length, line).toBeLessThanOrEqual(PROGRESS_MAX);
        expect(signs.filter((x) => x === '◎').length, line).toBe(1);
        expect(signs.at(-1), line).toBe(k === n - 1 ? '◎' : '○');
        const passedShown = signs.filter((x) => x === '●').length;
        if (passedShown < k) expect(signs[0], line).toBe('…');
      }
    }
  });

  it('temps réel coupé : « Temps réel coupé : derniers retards connus ~ » ; relais muet sans retard gardé : la note habituelle', () => {
    const N = (fr: string) => ({ fr, nl: fr });
    const stop = (fr: string, t: number) => ({ name: N(fr), sched: t, est: t + 3 * MIN });
    const ic: Leg = {
      kind: 'ride', from: { name: N('Namur'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Nord'), lat: 0, lon: 0 },
      dep: T(7, 45), arr: T(8, 45), schedDep: T(7, 42), schedArr: T(8, 42), op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruxelles-Midi'), rt: false, delayMin: 3, rtKept: true,
      stops: [stop('Namur', T(7, 42)), stop('Gembloux', T(7, 57)), stop('Ottignies', T(8, 11)), stop('Bruxelles-Nord', T(8, 42))],
    };
    const j: Journey = { id: 'k', legs: [ic], dep: ic.dep, arr: ic.arr, leaveAt: ic.dep, transfers: 0, rt: false, alerts: [] };
    const v = trainView(j, 0, { ...ctx(T(8, 5)), rt: 'down' });
    expect(v.note).toBe(NOTE_RT_KEPT);
    expect(nb(v.note!)).toBe('Temps réel coupé : derniers retards connus ~');
    expect(nb(v.title)).toBe('IC vers Bruxelles-Midi, +3 min');
    expect(lines(v).map(nb)).toContain('Ottignies   ~08:14   prochain');
    const none = trainView({ ...j, legs: [{ ...ic, rtKept: undefined, delayMin: 0 }] }, 0, { ...ctx(T(8, 5)), rt: 'down' });
    expect(nb(none.note ?? '')).toBe('Temps réel indisponible : horaires prévus ~');
    expect(trainView({ ...j, legs: [{ ...ic, rtKept: undefined }] }, 0, ctx(T(8, 5))).note).toBeUndefined();
    // un véhicule en direct : pas de note, même quand le flux d'un autre opérateur est en panne
    const live = trainView({ ...j, legs: [{ ...ic, rtKept: undefined, rt: true }] }, 0, { ...ctx(T(8, 5)), rt: 'down' });
    expect(live.note).toBeUndefined();
    expect(lines(live).map(nb)).toContain('Ottignies   08:14   prochain');
  });

  it('véhicule supprimé : pas de ligne de progression (le titre dit « SUPPRIMÉ »)', () => {
    const N = (fr: string) => ({ fr, nl: fr });
    const stop = (fr: string, t: number) => ({ name: N(fr), sched: t, est: t });
    const ic: Leg = {
      kind: 'ride', from: { name: N('Namur'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Nord'), lat: 0, lon: 0 },
      dep: T(7, 42), arr: T(8, 42), schedDep: T(7, 42), schedArr: T(8, 42), op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruxelles-Midi'), rt: true,
      stops: [stop('Namur', T(7, 42)), stop('Gembloux', T(7, 57)), stop('Ottignies', T(8, 11)), stop('Bruxelles-Nord', T(8, 42))],
    };
    const j: Journey = { id: 'c', legs: [ic], dep: ic.dep, arr: ic.arr, leaveAt: ic.dep, transfers: 0, rt: true, alerts: [] };
    expect(trainView(j, 0, ctx(T(7, 35))).top?.text).toMatch(/^◎─○─○─○ {3}descente dans 3 arrêts$/);
    const gone = trainView({ ...j, legs: [{ ...ic, cancelled: true }] }, 0, ctx(T(7, 35)));
    expect(nb(gone.title)).toBe('IC vers Bruxelles-Midi, SUPPRIMÉ');
    expect(gone.top).toBeUndefined();
  });
});

describe('PRD-1.2.5 § 9 : caractères invisibles de sens d’écriture', () => {
  it('retirés à l’affichage (jamais « ? ») et sans largeur', () => {
    const marked = '‎Gare⁩ du ‮Nord‬‏';
    expect(glyphSafe(marked)).toBe('Gare du Nord');
    expect(missingGlyphs(glyphSafe(marked))).toEqual([]);
    expect(textWidth(marked)).toBe(textWidth('Gare du Nord'));
    // un titre qui en contient se met en page comme sans
    const v = linesView([{ pick: { ...LINES.w, name: { fr: '⁦Merbraine⁩', nl: 'Merbraine' } } }], ctx(NOW, { lines: [LINES.w] }));
    expect(layoutPage(v, { sel: 0, top: 0 }).lines.map(nb)[1]).toBe('Bus W · Merbraine');
  });
});
