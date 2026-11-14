/**
 * Quai 1.2.9 (docs/v1.2.9/PRD-1.2.9.md § 1) : « imminent » réservé au temps réel. Un passage ou un départ à moins d'une
 * minute : avec le temps réel, « imminent » ; sur l'horaire prévu, « dans ~1 min » en clair, « ~1 min » ou « ~1 » en
 * forme courte ; « SUPPRIMÉ » toujours d'abord ; la note « ~ horaire prévu » sous la page qui montre une de ces rangées.
 * Arrêts et gares publics, le 10/11.
 */
import { describe, expect, it } from 'vitest';
import type { NearbyItem } from '../../src/core/api';
import type { LineRun } from '../../src/core/linerun';
import { NOTE_PLANNED } from '../../src/glasses/format';
import { geometry, layoutPage } from '../../src/glasses/layout';
import { boardView, lineRunView, lineView, nearbyView, stopsView, type ViewCtx } from '../../src/glasses/views';
import { at, boardOf, dep, lineBoardOf, lines, nb, page, settingsWith, trainAt, trainRunOf } from './helpers';

const NOW = at('2026-11-10', 8, 0);
const SEC = 1000;
const MIN = 60 * SEC;
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (markPlanned = true): ViewCtx => {
  const settings = settingsWith([]);
  settings.display.markPlanned = markPlanned;
  return { now: NOW, settings };
};
/** Un bus W dans `s` secondes (négatif : à peine passé), temps réel ou horaire prévu. */
const w = (s: number, rt: boolean, p = {}) => dep(NOW, s / 60, { rt, ...p });

describe('1.2.9 : tableau d’un arrêt (colonne des minutes)', () => {
  it('temps réel « imminent » ; horaire prévu « ~1 min », à peine passé aussi ; supprimé d’abord ; note sous la page', () => {
    const b = boardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', [w(-40, false), w(10, true), w(30, false, { cancelled: true }), w(50, false), w(5 * 60, true)]);
    const v = boardView(b, ctx(), { kept: false });
    expect(lines(v).slice(0, 7)).toEqual([
      '★ garder une ligne',
      'W   Bruxelles Midi   ~1 min',
      'W   Bruxelles Midi   imminent',
      'W   Bruxelles Midi   SUPPRIMÉ',
      'W   Bruxelles Midi   ~1 min',
      'W   Bruxelles Midi   5 min',
      NOTE_PLANNED,
    ]);
    expect(v.items.slice(1).map((it) => !!it.planned)).toEqual([true, false, false, true, false]);
    // sans le « ~ » (réglage) : « 1 min », jamais « imminent » ; pas de note
    const off = lines(boardView(b, ctx(false), { kept: false }));
    expect(off.slice(1, 5)).toEqual(['W   Bruxelles Midi   1 min', 'W   Bruxelles Midi   imminent', 'W   Bruxelles Midi   SUPPRIMÉ', 'W   Bruxelles Midi   1 min']);
    expect(off).not.toContain(NOTE_PLANNED);
  });

  it('la seule rangée prévue est à moins d’une minute : la note s’affiche sous sa page, pas sous les autres', () => {
    // avant la 1.2.9, cette rangée disait « imminent », sans « ~ » : la page ne disait pas qu'elle était prévue
    const deps = [w(20, false), ...Array.from({ length: 12 }, (_, i) => w((i + 2) * 60, true))];
    const v = boardView(boardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', deps), ctx(), { kept: false });
    expect(v.notePlanned).toBe(NOTE_PLANNED);
    const first = page(v).lines.map(nb);
    expect(first[1]).toBe('W   Bruxelles Midi   ~1 min');
    expect(first).toContain(NOTE_PLANNED);
    const g = geometry(v);
    const last = layoutPage(v, { sel: 13, top: 13 - g.capacity + 1 }).lines.map(nb);
    expect(last.some((l) => l.includes('~'))).toBe(false);
    expect(last).not.toContain(NOTE_PLANNED);
  });
});

describe('1.2.9 : Autour de moi', () => {
  it('« W imminent » en temps réel, « W ~1 min » sur l’horaire prévu, avec la note', () => {
    const item = (rt: boolean): NearbyItem => ({ area: { id: 'tec:Bbrlmer1', op: 'tec', n: N('Braine-l’Alleud Merbraine'), lat: 50.68, lon: 4.39, modes: ['bus'], lines: ['W'] }, distanceM: 80, walkMin: 1, next: w(25, rt) });
    const planned = lines(nearbyView([item(false)], ctx()));
    expect(planned[0]).toMatch(/ {3}W ~1 min$/);
    expect(planned).toContain(NOTE_PLANNED);
    const live = lines(nearbyView([item(true)], ctx()));
    expect(live[0]).toMatch(/ {3}W imminent$/);
    expect(live).not.toContain(NOTE_PLANNED);
  });
});

describe('1.2.9 : toute la ligne et tout le trajet d’un train (en clair)', () => {
  const follow = { id: 'f-stib-3', op: 'stib', mode: 'tram', line: '3', routes: ['stib:3'], ends: [N('Churchill')] } as unknown as Parameters<typeof lineRunView>[1];
  const run = (rt: boolean): LineRun => ({
    op: 'stib',
    mode: 'tram',
    line: '3',
    dir: 0,
    heads: [N('Churchill')],
    rtError: false,
    state: 'ok',
    stops: [
      { areaId: 'stib:a', name: N('Gare du Nord'), lat: 0, lon: 0, next: [{ t: NOW + 20 * SEC, rt }] },
      { areaId: 'stib:b', name: N('Rogier'), lat: 0, lon: 0, next: [{ t: NOW + 3 * MIN, rt: true }] },
      { areaId: 'stib:c', name: N('Botanique'), lat: 0, lon: 0, next: [{ t: NOW + 5 * MIN, rt: true }] },
    ],
  });

  it('toute la ligne : « imminent » en temps réel ; « dans ~1 min » sur l’horaire prévu, et la note sous la page', () => {
    const route = { screen: 'lineRun' as const, follow: 'f-stib-3', dir: 0 };
    const planned = lineRunView(route, follow, run(false), ctx());
    expect(lines(planned).slice(0, 3)).toEqual(['○ Gare du Nord   dans ~1 min', '○ Rogier   dans 3 min', '○ Botanique   dans 5 min']);
    expect(planned.items[0].planned).toBe(true);
    expect(lines(planned)).toContain(NOTE_PLANNED);
    const live = lineRunView(route, follow, run(true), ctx());
    expect(lines(live)[0]).toBe('○ Gare du Nord   imminent');
    expect(lines(live)).not.toContain(NOTE_PLANNED);
    // sans le « ~ » (réglage) : « dans 1 min »
    expect(lines(lineRunView(route, follow, run(false), ctx(false)))[0]).toBe('○ Gare du Nord   dans 1 min');
  });

  it('tout le trajet d’un train : « dans ~1 min » sur l’horaire prévu, « imminent » en temps réel ; supprimé d’abord', () => {
    const ic = trainAt(NOW, 1, { line: 'IC', head: N('Liège-Guillemins'), platform: '11', tripId: 't-ic' });
    const route = { screen: 'stops' as const, areaId: 'sncb:8812005', dep: ic };
    const calls = (rt: boolean, cancelled = false): Parameters<typeof trainRunOf>[2] => [
      ['Bruxelles-Nord', 0.5, { platform: '11', rt, cancelled }],
      ['Louvain', 22, { platform: '9', rt }],
      ['Liège-Guillemins', 58, { platform: '5', rt }],
    ];
    const planned = stopsView(route, trainRunOf(ic, NOW, calls(false), 0), ctx());
    expect(lines(planned)[0]).toBe('○ Bruxelles-Nord voie 11   dans ~1 min');
    expect(planned.items[0].planned).toBe(true);
    expect(lines(planned)).toContain(NOTE_PLANNED);
    const live = stopsView(route, trainRunOf(ic, NOW, calls(true), 0), ctx());
    expect(lines(live)[0]).toBe('○ Bruxelles-Nord voie 11   imminent');
    expect(lines(stopsView(route, trainRunOf(ic, NOW, calls(false, true), 0), ctx()))[0]).toBe('○ Bruxelles-Nord   SUPPRIMÉ');
  });
});

describe('1.2.9 : détail d’une ligne à son arrêt (en clair)', () => {
  it('« imminent » en temps réel ; « dans 1 min » sur l’horaire prévu, le « ~ » devant l’heure ; supprimé d’abord ; la note', () => {
    const gare = N('Braine-l’Alleud Gare');
    const b = lineBoardOf('tec:Bbrlmer1', 'Braine-l’Alleud Merbraine', 'W', [
      { head: 'Bruxelles Midi', departures: [w(15, true), w(12 * 60, true)] },
      { head: 'Braine-l’Alleud Gare', departures: [w(-20, false, { head: gare }), w(40, false, { head: gare, cancelled: true }), w(20 * 60, false, { head: gare })] },
    ]);
    const route = { screen: 'line' as const, areaId: 'tec:Bbrlmer1', op: 'tec' as const, line: 'W', name: N('Braine-l’Alleud Merbraine') };
    const v = lineView(route, b, ctx());
    expect(lines(v).slice(0, 6)).toEqual([
      'vers Bruxelles Midi',
      '08:00   imminent',
      '08:12   dans 12 min',
      'vers Braine-l’Alleud Gare',
      '~07:59   dans 1 min',
      '08:00   SUPPRIMÉ',
    ]);
    expect(lines(v)).toContain(NOTE_PLANNED);
    // sans le « ~ » (réglage) : « dans 1 min »
    expect(lines(lineView(route, b, ctx(false)))[4]).toBe('07:59   dans 1 min');
  });
});
