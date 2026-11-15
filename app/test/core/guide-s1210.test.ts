/**
 * 1.2.10 : cas du simulateur de bout en bout (tests/e2e/sim/s1210.ts, fixtures du mardi 10/11/2026) rejoués sur le
 * moteur : place de l'Ange (Namur) à pied, IC de 07:44 (voie 6 au lieu de 4) jusqu'à Bruxelles-Nord, 2 min à pied,
 * tram 3 de 08:44 (sans temps réel) jusqu'à la Bourse, à pied jusqu'à la place Fontainas. Lieux publics seulement.
 * Les positions arrivent comme dans Quai Web : l'horloge de l'appli avance, puis les positions de la trace sont
 * données (les plus anciennes en premier, jusqu'à 70 s plus tôt).
 */
import { describe, expect, it } from 'vitest';
import type { Journey, LatLon, Leg } from '../../src/core/api';
import { guideStep, newGuideMemory } from '../../src/core/guide';
import type { GuideFix, GuideMemory, GuideState } from '../../src/core/guide-types';
import { settings } from './guide-fixtures';

const T = (h: string) => Date.parse(`2026-11-10T${h.length === 5 ? `${h}:00` : h}+01:00`);
const N = (fr: string, nl = fr) => ({ fr, nl });
/** Mêmes coordonnées que fixtures/network.json et tests/e2e/traces/traces.ts. */
const P = {
  ange: { lat: 50.4641, lon: 4.8656 },
  namur: { lat: 50.4685, lon: 4.8625 },
  voie6: { lat: 50.4687, lon: 4.8622 },
  gembloux: { lat: 50.5707, lon: 4.6913 },
  ottignies: { lat: 50.6727, lon: 4.5694 },
  lux: { lat: 50.8388, lon: 4.3732 },
  schuman: { lat: 50.8433, lon: 4.3804 },
  nord: { lat: 50.8605, lon: 4.3612 },
  central: { lat: 50.8454, lon: 4.3571 },
  gdn: { lat: 50.86, lon: 4.36014 },
  rogier: { lat: 50.85695, lon: 4.35895 },
  brouckere: { lat: 50.851, lon: 4.3524 },
  bourse: { lat: 50.8483, lon: 4.3497 },
  fontainas: { lat: 50.8443, lon: 4.3466 },
} satisfies Record<string, LatLon>;

const end = (name: string, p: LatLon, areaId?: string) => ({ name: N(name), lat: p.lat, lon: p.lon, ...(areaId ? { areaId } : {}) });
const call = (name: string, p: LatLon, sched: string, delayMin: number, areaId: string) => ({ name: N(name), sched: T(sched), est: T(sched) + delayMin * 60_000, lat: p.lat, lon: p.lon, areaId });
const walk = (from: Leg['from'], to: Leg['from'], dep: number, min: number): Leg => ({ kind: 'walk', from, to, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });

export function s1210Journey(): Journey {
  const ic: Leg = {
    kind: 'ride', from: end('Namur', P.namur, 'sncb:8863008'), to: end('Bruxelles-Nord', P.nord, 'sncb:8812005'), dep: T('07:44'), arr: T('08:42'), schedDep: T('07:42'), schedArr: T('08:40'),
    op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruxelles-Midi', 'Brussel-Zuid'), rt: true, delayMin: 2, cancelled: false, tripId: 'ic2112', platform: '4', newPlatform: '6',
    stops: [
      call('Namur', P.namur, '07:42', 2, 'sncb:8863008'), call('Gembloux', P.gembloux, '07:55', 2, 'sncb:8874005'), call('Ottignies', P.ottignies, '08:09', 2, 'sncb:8811601'),
      call('Bruxelles-Luxembourg', P.lux, '08:31', 2, 'sncb:8811304'), call('Bruxelles-Schuman', P.schuman, '08:35', 2, 'sncb:8811916'), call('Bruxelles-Nord', P.nord, '08:40', 2, 'sncb:8812005'),
    ],
  };
  const tram: Leg = {
    kind: 'ride', from: end('Gare du Nord', P.gdn, 'stib:6357'), to: end('Bourse', P.bourse, 'stib:6362'), dep: T('08:44'), arr: T('08:49'), schedDep: T('08:44'), schedArr: T('08:49'),
    op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), rt: false, delayMin: 0, cancelled: false, tripId: 'tram3-0832',
    stops: [call('Gare du Nord', P.gdn, '08:44', 0, 'stib:6357'), call('Rogier', P.rogier, '08:46', 0, 'stib:6359'), call('De Brouckère', P.brouckere, '08:48', 0, 'stib:6361'), call('Bourse', P.bourse, '08:49', 0, 'stib:6362')],
  };
  const legs: Leg[] = [
    walk(end('Place de l’Ange', P.ange), ic.from, T('07:33'), 9),
    ic,
    walk(ic.to, tram.from, T('08:42'), 2),
    tram,
    walk(tram.to, end('Place Fontainas', P.fontainas), T('08:49'), 9),
  ];
  return { id: 'js1210', legs, dep: T('07:33'), arr: T('08:58'), leaveAt: T('07:33'), transfers: 1, rt: false, alerts: [] };
}

const lerp = (a: LatLon, b: LatLon, f: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });

/** Guidage rejoué : `at(now, positions)` avance l'horloge puis donne les positions une à une (le moteur à chaque fois). */
function replay(j = s1210Journey()) {
  let mem: GuideMemory = newGuideMemory();
  const fixes: GuideFix[] = [];
  let last!: GuideState;
  const at = (now: number, pts: [number, LatLon, number, number?][] = []): GuideState => {
    const one = () => {
      const r = guideStep({ kind: 'trip', journey: j, title: 'Place Fontainas', now, fixes: fixes.filter((f) => now - f.at <= 300_000 && f.at <= now), settings: settings(), startedAt: T('07:20'), origin: P.ange }, mem);
      mem = r.mem;
      last = r.state;
    };
    if (!pts.length) one();
    for (const [t, p, speed, accuracy] of pts) {
      fixes.push({ lat: p.lat, lon: p.lon, at: t, accuracy: accuracy ?? 8, speed });
      one();
    }
    return last;
  };
  return { at, mem: () => mem as GuideMemory & { boarded?: { leg: number }; alighted?: { leg: number } } };
}

describe('s1210 : correspondance très juste à Bruxelles-Nord (IC puis tram 3)', () => {
  it('positions traitées en retard : la descente de l’IC est constatée, « monter » le tram 3 paraît, puis montée et descente du tram', () => {
    const g = replay();
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    expect(g.mem().boarded?.leg).toBe(1);
    expect(g.at(T('08:38:05'), [[T('08:38'), lerp(P.schuman, P.nord, 30 / 270), 8.9]]).moment?.kind).toBe('alight');
    // 08:42:10 : les positions de 08:41 (encore dans l'IC, près de la ligne du tram) arrivent après l'heure d'arrivée de l'IC
    let s = g.at(T('08:42:10'), [
      [T('08:41'), lerp(P.schuman, P.nord, 210 / 270), 8.9],
      [T('08:41:30'), lerp(P.schuman, P.nord, 240 / 270), 8.9],
      [T('08:42'), P.nord, 0],
      [T('08:42:10'), P.nord, 1.3],
    ]);
    expect(g.mem().boarded?.leg).toBe(1);
    expect(g.mem().alighted?.leg).toBe(1);
    expect(s.moment?.kind).not.toBe('alight');
    // vers l'arrêt du tram, puis à l'arrêt : « monter » le tram 3 de 08:44
    s = g.at(T('08:42:50'), [[T('08:42:50'), { lat: 50.8602, lon: 4.3607 }, 1.3]]);
    expect(s.phase).toEqual({ kind: 'wait', leg: 3 });
    expect(s.moment).toMatchObject({ kind: 'board', leg: 3, depAt: T('08:44') });
    expect(g.at(T('08:43:40'), [[T('08:43:30'), P.gdn, 0], [T('08:43:40'), P.gdn, 0]]).moment?.kind).toBe('board');
    // dans le tram (après Rogier) : montée constatée ; à la sortie de De Brouckère, « Descends » ; à la Bourse, descendu
    g.at(T('08:47:20'), [[T('08:47'), lerp(P.rogier, P.brouckere, 60 / 120), 6.7], [T('08:47:20'), lerp(P.rogier, P.brouckere, 80 / 120), 6.7]]);
    expect(g.mem().boarded?.leg).toBe(3);
    s = g.at(T('08:48:30'), [[T('08:48:20'), lerp(P.brouckere, P.bourse, 20 / 60), 5], [T('08:48:30'), lerp(P.brouckere, P.bourse, 30 / 60), 5]]);
    expect(s.moment).toMatchObject({ kind: 'alight', leg: 3, stop: N('Bourse') });
    g.at(T('08:49:10'), [[T('08:49:10'), P.bourse, 1.3]]);
    expect(g.mem().alighted?.leg).toBe(3);
  });
});
