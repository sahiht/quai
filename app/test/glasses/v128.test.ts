/**
 * Quai 1.2.8 (docs/v1.2.8/PRD-1.2.8.md) : tout le trajet d'un train, et la note « ~ horaire prévu » dite seulement sous
 * une page qui montre un « ~ ». Gares publiques, le 10/11.
 */
import { describe, expect, it } from 'vitest';
import type { DepartureStops } from '../../src/core/api';
import { textWidth } from '../../src/glasses/font';
import { NOTE_PLANNED } from '../../src/glasses/format';
import { LAYOUTS, geometry, layoutPage, segRow } from '../../src/glasses/layout';
import type { GlassesView } from '../../src/glasses/types';
import { boardView, lineRunView, stopsView, type ViewCtx } from '../../src/glasses/views';
import { at, boardOf, container, lines, nb, page, settingsWith, trainAt, trainRunOf } from './helpers';

const NOW = at('2026-11-10', 8, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (now = NOW): ViewCtx => ({ now, settings: settingsWith([]) });
const ic = trainAt(NOW, 40, { line: 'IC', head: N('Liège-Guillemins'), platform: '11', tripId: 't-ic' });
const route = { screen: 'stops' as const, areaId: 'sncb:8812005', dep: ic };

/** Un IC Bruxelles-Midi → Liège-Guillemins vu de Bruxelles-Nord (rang 2), temps réel, à l'heure. */
const run = (now = NOW): DepartureStops =>
  trainRunOf(
    ic,
    now,
    [
      ['Bruxelles-Midi', 30, { platform: '15' }],
      ['Bruxelles-Central', 35, { platform: '3' }],
      ['Bruxelles-Nord', 40, { platform: '11' }],
      ['Louvain', 62, { platform: '9' }],
      ['Liège-Guillemins', 98, { platform: '5' }],
    ],
    2,
  );

describe('1.2.8 : tout le trajet d’un train', () => {
  it('avant son départ : aucune gare quittée, aucun ●, pas de ligne du haut ; le curseur sur la gare du tableau', () => {
    const v = stopsView(route, run(), ctx());
    expect(v.top).toBeUndefined();
    expect(v.log).toMatchObject({ stops: 5, gare: 2, vehicle: -1, passed: 0 });
    // la gare d'avant au-dessus du curseur ; au-delà d'une heure, l'heure (« à 09:02 »)
    expect(lines(v)).toEqual([
      '○ Bruxelles-Central voie 3   dans 35 min',
      '○ Bruxelles-Nord voie 11   dans 40 min',
      '○ Louvain voie 9   à 09:02',
      '○ Liège-Guillemins voie 5   à 09:38',
      '△▽ gares   toucher : départs   double : retour',
    ]);
    expect(page(v).sel).toBe(2);
    expect(nb(layoutPage(v, { sel: 0, top: 0 }).lines[0])).toBe('○ Bruxelles-Midi voie 15   dans 30 min');
  });

  it('en route : le ● suit le train (temps réel), les gares quittées passent en pâle ; au terminus, plus de ●', () => {
    const s = run();
    // 08:33 : le train a quitté Bruxelles-Midi (08:30), il arrive à Bruxelles-Central
    const v = stopsView(route, s, ctx(at('2026-11-10', 8, 33)));
    expect(nb(v.top?.text ?? '')).toBe('● : le train arrive');
    // la gare qu'il vient de quitter (en pâle, son heure), le ●, puis le curseur sur Bruxelles-Nord
    expect(lines(v).slice(0, 4)).toEqual(['● : le train arrive', '○ Bruxelles-Midi voie 15   08:30', '● Bruxelles-Central voie 3   dans 2 min', '○ Bruxelles-Nord voie 11   dans 7 min']);
    expect(page(v).sel).toBe(2);
    // au terminus : toutes quittées, tout en pâle, aucun ●
    const end = stopsView(route, s, ctx(at('2026-11-10', 9, 40)));
    expect(end.top).toBeUndefined();
    expect(end.log).toMatchObject({ vehicle: -1, passed: 5 });
    const p = page(end);
    expect(container(p, 'colA').content.trim()).toBe('');
    expect(container(p, 'colC').content.trim()).toBe('');
    expect(nb(container(p, 'colB').content)).toContain('Liège-Guillemins voie 5');
  });

  it('un train qui arrive de plus loin : son ● sur la même page que le curseur, la gare d’avant lui au-dessus', () => {
    const names = ['Ostende', 'Bruges', 'Gand-Saint-Pierre', 'Alost', 'Bruxelles-Nord', 'Bruxelles-Central', 'Bruxelles-Midi', 'Louvain', 'Liège-Guillemins'];
    const far = trainRunOf(ic, NOW, names.map((n, i): [string, number] => [n, -50 + i * 12]), 6);
    // 08:00 : quittées jusqu'à Bruxelles-Nord (07:58) ; il arrive à Bruxelles-Central (08:10) ; le curseur sur Bruxelles-Midi
    const v = stopsView(route, far, ctx());
    expect(v.log).toMatchObject({ gare: 6, vehicle: 5 });
    const p = page(v);
    expect(p.sel).toBe(6);
    const rows = p.lines.map(nb);
    expect(rows.some((l) => l.startsWith('● Bruxelles-Central'))).toBe(true);
    expect(rows.some((l) => l.startsWith('○ Bruxelles-Nord'))).toBe(true);
    // plus loin (07:20, il a quitté Ostende, il arrive à Bruges) : Ostende ne tient plus avec le curseur, le ● oui
    const early = stopsView(route, far, ctx(at('2026-11-10', 7, 20)));
    expect(early.log).toMatchObject({ vehicle: 1 });
    expect(page(early).lines.map(nb).slice(0, 2)).toEqual(['● : le train arrive', '● Bruges   dans 2 min']);
    expect(page(early).sel).toBe(6);
    // plus loin encore (07:05, il n'a pas quitté Ostende) : aucun ●, la gare d'avant au-dessus du curseur
    const before = stopsView(route, far, ctx(at('2026-11-10', 7, 5)));
    expect(before.log).toMatchObject({ vehicle: -1 });
    expect(page(before).lines.map(nb)[0]).toBe('○ Bruxelles-Central   dans 65 min'.replace('dans 65 min', 'à 08:10'));
  });

  it('les noms longs : la voie et le passage tiennent, rien ne dépasse (coupé « … » au pire, jamais le passage)', () => {
    const long = trainRunOf(
      ic,
      NOW,
      [
        ['Bruxelles-Aéroport-Zaventem', 30, { platform: '3' }],
        ['Bruxelles-Nord', 40, { platform: '11', newPlatform: '12' }],
        ['Marchienne-au-Pont Bifurcation de la Sambre', 58, { platform: '12a' }],
      ],
      1,
    );
    const ls = lines(stopsView(route, long, ctx()));
    expect(ls[0]).toBe('○ Bruxelles-Aéroport-Zaventem voie 3   dans 30 min');
    expect(ls[1]).toBe('○ Bruxelles-Nord voie 12 !   dans 40 min');
    expect(ls[2]).toMatch(/^○ Marchienne-au-Pont Bifurcation.*…? {3}dans 58 min$/);
  });
});

describe('1.2.8 : la note « ~ » sous une page qui en montre un', () => {
  it('rangée pâle à droite (segRow, rightPale) : à la même place que la colonne c, dans la colonne b', () => {
    const def = LAYOUTS.lines;
    const bright = segRow([{ t: '○', hi: true }, { t: 'Namur', hi: true }], 0, '07:44', def);
    const pale = segRow([{ t: '○' }, { t: 'Namur' }], 0, '07:44', def, true);
    expect(pale.c).toBe('');
    const endBright = def.c.x + textWidth(bright.c);
    const startPale = def.b.x + textWidth(pale.b) - textWidth('07:44');
    expect(Math.abs(def.b.x + textWidth(pale.b) - endBright)).toBeLessThanOrEqual(3);
    expect(startPale).toBeGreaterThan(def.b.x + textWidth('○ Namur'));
    expect(pale.log).toBe(bright.log);
  });

  it('toute la ligne : pas de note sous une page sans « ~ », la note sous la page qui en a ; la ligne reste réservée', () => {
    // 12 arrêts : les 7 premiers en temps réel, les suivants à l'horaire prévu
    const stops = Array.from({ length: 12 }, (_, i) => ({
      areaId: `stib:${i}`,
      name: N(`Arrêt ${i + 1}`),
      next: [{ t: NOW + (i + 2) * 60_000, rt: i < 7 }],
    }));
    const runL = { op: 'stib', mode: 'tram', line: '3', dir: 0, heads: [N('Churchill')], stops, state: 'ok', rtError: false } as unknown as Parameters<typeof lineRunView>[2];
    const follow = { id: 'f-stib-3', op: 'stib', mode: 'tram', line: '3', routes: ['stib:3'], ends: [N('Churchill')] } as unknown as Parameters<typeof lineRunView>[1];
    const v = lineRunView({ screen: 'lineRun', follow: 'f-stib-3', dir: 0 }, follow, runL, ctx());
    expect(v.note).toBeUndefined();
    expect(v.notePlanned).toBe(NOTE_PLANNED);
    expect(geometry(v).noteLine).toBe(true);
    const first = page(v);
    expect(first.lines.map(nb)).not.toContain(NOTE_PLANNED);
    expect(first.lines.some((l) => l.includes('~'))).toBe(false);
    const g = geometry(v);
    const second = layoutPage(v, { sel: 11, top: 11 - g.capacity + 1 });
    expect(second.lines.some((l) => l.includes('~'))).toBe(true);
    expect(second.lines.map(nb)).toContain(NOTE_PLANNED);
  });

  it('tableau d’une gare : même règle ; le temps réel en panne, toujours sa note', () => {
    const deps = Array.from({ length: 10 }, (_, i) => trainAt(NOW, 5 + i * 8, { line: 'IC', head: N('Namur'), rt: i < 6, tripId: `t-${i}` }));
    const b = boardOf('sncb:8812005', 'Bruxelles-Nord', deps);
    const v: GlassesView = boardView(b, ctx(), { kept: false });
    expect(v.notePlanned).toBe(NOTE_PLANNED);
    expect(page(v).lines.map(nb)).not.toContain(NOTE_PLANNED);
    const g = geometry(v);
    expect(layoutPage(v, { sel: 10, top: 10 - g.capacity + 1 }).lines.map(nb)).toContain(NOTE_PLANNED);
    const down = boardView({ ...b, rtErrors: ['sncb'] }, ctx(), { kept: false });
    expect(down.note).toMatch(/^Temps réel indisponible/);
  });
});
