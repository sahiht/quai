/**
 * Quai 1.2.9 : la note « ~ horaire prévu » seulement sous une page qui montre un « ~ », aussi dans le détail d'une
 * ligne et les arrêts d'un départ de bus, tram ou métro (règle de la 1.2.8 pour toute la ligne, les tableaux et le
 * trajet d'un train) ; dans le détail d'une ligne, un passage prévu à moins d'une minute ne répète pas le « ~ » déjà
 * devant son heure.
 */
import { describe, expect, it } from 'vitest';
import type { DepartureStops, StopCall } from '../../src/core/api';
import { NOTE_PLANNED } from '../../src/glasses/format';
import { geometry, layoutPage } from '../../src/glasses/layout';
import type { GlassesView } from '../../src/glasses/types';
import { lineView, stopsView, type ViewCtx } from '../../src/glasses/views';
import { at, dep, lineBoardOf, nb, settingsWith } from './helpers';

const NOW = at('2026-11-10', 8, 0);
const N = (fr: string) => ({ fr, nl: fr });
const MIN = 60_000;
const ctx = (): ViewCtx => ({ now: NOW, settings: settingsWith([]) });

/** Chaque cadre possible de la liste : un « ~ » à l'écran (hors note) et la note dite ou non. */
function frames(v: GlassesView): { top: number; tilde: boolean; note: boolean }[] {
  const out: { top: number; tilde: boolean; note: boolean }[] = [];
  const last = Math.max(0, v.items.length - geometry(v).capacity);
  for (let top = 0; top <= last; top++) {
    const shown = layoutPage(v, { sel: top, top }).lines.map(nb);
    const note = shown.includes(NOTE_PLANNED);
    out.push({ top, note, tilde: shown.some((l) => l !== NOTE_PLANNED && l.includes('~')) });
  }
  return out;
}

describe('1.2.9 : la note « ~ » sous une page qui en montre un', () => {
  it('détail d’une ligne : deux sens en temps réel, le troisième à l’horaire prévu', () => {
    const rt = (head: string, from: number) => [0, 6, 12, 18].map((k) => dep(NOW, from + k, { head: N(head) }));
    const planned = [4, 11, 19, 27].map((m) => dep(NOW, m, { head: N('Waterloo Eglise'), rt: false }));
    const b = lineBoardOf('tec:Bbxlmid1', 'Bruxelles Midi', 'W', [
      { head: 'Braine-l’Alleud Gare', departures: rt('Braine-l’Alleud Gare', 3) },
      { head: 'Bruxelles Midi', departures: rt('Bruxelles Midi', 5) },
      { head: 'Waterloo Eglise', departures: planned },
    ]);
    const v = lineView({ screen: 'line', areaId: 'tec:Bbxlmid1', op: 'tec', line: 'W', name: N('Bruxelles Midi') }, b, ctx());
    const all = frames(v);
    expect(all.some((f) => !f.tilde)).toBe(true);
    expect(all.some((f) => f.tilde)).toBe(true);
    for (const f of all) expect({ top: f.top, note: f.note }).toEqual({ top: f.top, note: f.tilde });
    expect(geometry(v).noteLine).toBe(true);
  });

  it('arrêts d’un départ de tram : temps réel sur les premiers arrêts, horaire prévu ensuite', () => {
    const stop = (i: number, rtKnown: boolean): StopCall => ({ areaId: `stib:${1000 + i}`, name: N(`Arrêt ${i + 1}`), sched: NOW + (2 + i * 2) * MIN, est: NOW + (2 + i * 2) * MIN, rt: rtKnown, delayMin: 0 });
    const stops = Array.from({ length: 18 }, (_, i) => stop(i, i < 10));
    const ds: DepartureStops = { op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), stops, anyPlanned: true, state: 'ok' };
    const route = { screen: 'stops' as const, areaId: 'stib:1000', dep: dep(NOW, 2, { op: 'stib', mode: 'tram', line: '3', head: N('Churchill') }) };
    const v = stopsView(route, ds, ctx());
    const all = frames(v);
    expect(all.some((f) => !f.tilde)).toBe(true);
    for (const f of all) expect({ top: f.top, note: f.note }).toEqual({ top: f.top, note: f.tilde });
    // l'arrêt du haut à l'horaire prévu : son « ~ » est sur toutes les pages, la note aussi
    const allPlanned: DepartureStops = { ...ds, stops: stops.map((s) => ({ ...s, rt: false })) };
    for (const f of frames(stopsView(route, allPlanned, ctx()))) expect(f.note).toBe(true);
  });
});

describe('1.2.9 : détail d’une ligne, passage à moins d’une minute', () => {
  it('horaire prévu : « ~ » devant l’heure, « dans 1 min » sans second « ~ » ; temps réel : « imminent »', () => {
    const b = lineBoardOf('tec:Bbxlmid1', 'Bruxelles Midi', 'W', [
      { head: 'Braine-l’Alleud Gare', departures: [dep(NOW, 0.5, { rt: false, head: N('Braine-l’Alleud Gare') }), dep(NOW, 9, { rt: false, head: N('Braine-l’Alleud Gare') })] },
      { head: 'Bruxelles Midi', departures: [dep(NOW, 0.5, { head: N('Bruxelles Midi') })] },
    ]);
    const v = lineView({ screen: 'line', areaId: 'tec:Bbxlmid1', op: 'tec', line: 'W', name: N('Bruxelles Midi') }, b, ctx());
    const [soonPlanned, later, soonRt] = v.items;
    expect(soonPlanned.bLead).toMatch(/^~/);
    expect(nb(soonPlanned.c ?? '')).toBe('dans 1 min');
    expect(nb(later.c ?? '')).toBe('dans 9 min');
    expect(soonRt.c).toBe('imminent');
  });
});
