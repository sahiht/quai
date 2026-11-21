/**
 * 1.2.10 : cas du simulateur de bout en bout (tests/e2e/sim/s1210.ts, fixtures du mardi 10/11/2026) rejoués sur le
 * moteur : place de l'Ange (Namur) à pied, IC de 07:44 (voie 6 au lieu de 4) jusqu'à Bruxelles-Nord, 2 min à pied,
 * tram 3 de 08:44 (sans temps réel) jusqu'à la Bourse, à pied jusqu'à la place Fontainas. Lieux publics seulement.
 * Les positions arrivent comme dans Quai Web : l'horloge de l'appli avance, puis les positions de la trace sont
 * données (les plus anciennes en premier, jusqu'à 70 s plus tôt).
 */
import { describe, expect, it } from 'vitest';
import type { Journey, LatLon, Leg } from '../../src/core/api';
import { guideStep, newGuideMemory, replanJourney, rideOnJourney, type GuideInput } from '../../src/core/guide';
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
function replay(j = s1210Journey(), extra: Partial<GuideInput> = {}) {
  let mem: GuideMemory = newGuideMemory();
  const fixes: GuideFix[] = [];
  let last!: GuideState;
  let journey = j;
  let more = extra;
  /** genres des moments montrés, dans l'ordre */
  const seen: string[] = [];
  const at = (now: number, pts: [number, LatLon, number, number?][] = []): GuideState => {
    const one = () => {
      const r = guideStep({ kind: 'trip', journey, title: 'Place Fontainas', now, fixes: fixes.filter((f) => now - f.at <= 300_000 && f.at <= now), settings: settings(), startedAt: T('07:20'), origin: P.ange, ...more }, mem);
      mem = r.mem;
      last = r.state;
      if (r.state.moment && seen[seen.length - 1] !== r.state.moment.kind) seen.push(r.state.moment.kind);
    };
    if (!pts.length) one();
    for (const [t, p, speed, accuracy] of pts) {
      fixes.push({ lat: p.lat, lon: p.lon, at: t, accuracy: accuracy ?? 8, speed });
      one();
    }
    return last;
  };
  /** le contrôleur adopte un nouveau trajet (la mémoire continue) */
  const use = (j2: Journey, extra2: Partial<GuideInput> = {}) => {
    journey = j2;
    more = extra2;
  };
  return { at, use, seen, mem: () => mem as GuideMemory & { boarded?: { leg: number }; alighted?: { leg: number } } };
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

describe('s1210 : arrêt dépassé à Bruxelles-Nord (l’IC repart vers Bruxelles-Central)', () => {
  it('« Tu as passé Bruxelles-Nord » dès que la position est à plus de 300 m au-delà, en s’éloignant, même si le train tourne après la gare', () => {
    const g = replay();
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    g.at(T('08:41:30'), [[T('08:41:30'), lerp(P.schuman, P.nord, 240 / 270), 8.9]]);
    // à quai à Bruxelles-Nord (immobile : la descente peut sembler faite), puis le train repart vers Bruxelles-Central
    g.at(T('08:43'), [[T('08:42'), P.nord, 0], [T('08:43'), P.nord, 0]]);
    g.at(T('08:44'), [[T('08:43:30'), lerp(P.nord, P.central, 0.1), 5.6], [T('08:44'), lerp(P.nord, P.central, 0.2), 5.6]]);
    expect(g.mem().boarded?.leg).not.toBe(3);
    const s = g.at(T('08:45'), [[T('08:44:30'), lerp(P.nord, P.central, 0.3), 5.6], [T('08:45'), lerp(P.nord, P.central, 0.4), 5.6]]);
    expect(s.moment).toMatchObject({ kind: 'passed', passed: N('Bruxelles-Nord') });
    expect(s.replan).toMatchObject({ reason: 'passed' });
  });

  it('arrêts suivants de l’IC connus (lus par le contrôleur) : « Descends à Bruxelles-Central, 08:48 », nouveau trajet depuis Bruxelles-Central à 08:48, jamais depuis la position dans le train', () => {
    const central = { name: N('Bruxelles-Central', 'Brussel-Centraal'), sched: T('08:46'), est: T('08:48'), areaId: 'sncb:8813003', lat: P.central.lat, lon: P.central.lon, platform: '3' };
    const midi = { name: N('Bruxelles-Midi', 'Brussel-Zuid'), sched: T('08:52'), est: T('08:54'), areaId: 'sncb:8814001' };
    const g = replay(s1210Journey(), { beyondByLeg: { 1: [central, midi], 3: [{ name: N('Lemonnier'), sched: T('08:51'), est: T('08:51'), areaId: 'stib:6364' }] } });
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    g.at(T('08:41:30'), [[T('08:41:30'), lerp(P.schuman, P.nord, 240 / 270), 8.9]]);
    g.at(T('08:43'), [[T('08:42'), P.nord, 0], [T('08:43'), P.nord, 0]]);
    g.at(T('08:44'), [[T('08:43:30'), lerp(P.nord, P.central, 0.1), 5.6], [T('08:44'), lerp(P.nord, P.central, 0.2), 5.6]]);
    const s = g.at(T('08:45'), [[T('08:44:30'), lerp(P.nord, P.central, 0.3), 5.6], [T('08:45'), lerp(P.nord, P.central, 0.4), 5.6]]);
    expect(s.moment).toMatchObject({ kind: 'passed', passed: N('Bruxelles-Nord'), getOff: N('Bruxelles-Central', 'Brussel-Centraal'), at: T('08:48') });
    expect(s.replan).toEqual({ from: { lat: P.central.lat, lon: P.central.lon, areaId: 'sncb:8813003', name: N('Bruxelles-Central', 'Brussel-Centraal') }, reason: 'passed', at: T('08:48') });
  });

  it('arrêts suivants connus : le nouveau trajet garde l’IC jusqu’à Bruxelles-Central ; « Descends au prochain arrêt » la dernière minute, puis la marche ; jamais « Partir maintenant » dans le train', () => {
    const central = { name: N('Bruxelles-Central', 'Brussel-Centraal'), sched: T('08:46'), est: T('08:48'), areaId: 'sncb:8813003', lat: P.central.lat, lon: P.central.lon, platform: '3' };
    const midi = { name: N('Bruxelles-Midi', 'Brussel-Zuid'), sched: T('08:52'), est: T('08:54'), areaId: 'sncb:8814001' };
    const j = s1210Journey();
    const beyondByLeg = { 1: [central, midi] };
    const g = replay(j, { beyondByLeg });
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    g.at(T('08:41:30'), [[T('08:41:30'), lerp(P.schuman, P.nord, 240 / 270), 8.9]]);
    g.at(T('08:43'), [[T('08:42'), P.nord, 0], [T('08:43'), P.nord, 0]]);
    g.at(T('08:44'), [[T('08:43:30'), lerp(P.nord, P.central, 0.1), 5.6], [T('08:44'), lerp(P.nord, P.central, 0.2), 5.6]]);
    const s = g.at(T('08:45'), [[T('08:44:30'), lerp(P.nord, P.central, 0.3), 5.6], [T('08:45'), lerp(P.nord, P.central, 0.4), 5.6]]);
    expect(s.replan).toMatchObject({ reason: 'passed', from: { areaId: 'sncb:8813003' }, at: T('08:48') });
    // nouveau trajet trouvé depuis Bruxelles-Central à 08:48 : 13 min à pied jusqu'à la place Fontainas
    const fresh: Journey = { id: 'jcentral', legs: [walk(end('Bruxelles-Central', P.central, 'sncb:8813003'), end('Place Fontainas', P.fontainas), T('08:48'), 13)], dep: T('08:48'), arr: T('09:01'), leaveAt: T('08:48'), transfers: 0, rt: true, alerts: [] };
    const j2 = replanJourney(j, fresh, T('08:45:05'), beyondByLeg);
    expect(j2.legs.map((l) => l.kind)).toEqual(['walk', 'ride', 'walk']);
    expect(j2.legs[1]).toMatchObject({ tripId: 'ic2112', schedDep: T('07:42'), dep: T('07:44'), to: { name: N('Bruxelles-Central', 'Brussel-Centraal'), areaId: 'sncb:8813003' }, arr: T('08:48'), schedArr: T('08:46') });
    expect(j2.legs[1].stops?.map((x) => x.name.fr)).toEqual(['Namur', 'Gembloux', 'Ottignies', 'Bruxelles-Luxembourg', 'Bruxelles-Schuman', 'Bruxelles-Nord', 'Bruxelles-Central']);
    expect(j2).toMatchObject({ arr: T('09:01'), dep: j.dep, transfers: 0 });
    // adopté par le contrôleur (les arrêts suivants repartent de rien avec le nouveau trajet) : toujours à bord de l'IC
    g.use(j2);
    let t = g.at(T('08:45:05'), [[T('08:45:05'), lerp(P.nord, P.central, 0.45), 5.6]]);
    expect(t.phase).toMatchObject({ kind: 'ride', leg: 1 });
    expect(g.mem().boarded?.leg).toBe(1);
    expect(t.moment).toMatchObject({ kind: 'passed', passed: N('Bruxelles-Nord'), getOff: N('Bruxelles-Central', 'Brussel-Centraal'), at: T('08:48'), arr: T('09:01') });
    expect(t.replan).toBeUndefined();
    expect(g.at(T('08:46'), [[T('08:46'), lerp(P.nord, P.central, 0.6), 5.6]]).moment?.kind).toBe('passed');
    // la dernière minute : « Descends au prochain arrêt », Bruxelles-Central 08:48, ensuite 13 min à pied
    t = g.at(T('08:47:05'), [[T('08:47:05'), lerp(P.nord, P.central, 0.85), 5.6]]);
    expect(t.moment).toMatchObject({ kind: 'alight', leg: 1, stop: N('Bruxelles-Central', 'Brussel-Centraal'), at: T('08:48'), then: { kind: 'walk', min: 13, last: true } });
    // descente à Bruxelles-Central, puis à pied vers la place Fontainas
    g.at(T('08:48:20'), [[T('08:48'), P.central, 0], [T('08:48:20'), P.central, 0.4]]);
    expect(g.mem().alighted?.leg).toBe(1);
    t = g.at(T('08:49:30'), [[T('08:49:30'), lerp(P.central, P.fontainas, 0.12), 1.3]]);
    expect(t.phase).toEqual({ kind: 'walk', leg: 2 });
    expect(g.seen).not.toContain('leave');
    // 1.3.1 (B17, P7) : après la descente, la marche jusqu'à la place Fontainas (« 13 min à pied », l'arrivée)
    expect(g.seen.slice(-3)).toEqual(['passed', 'alight', 'walk']);
  });

  it('« j’y descends » (genre ride), Bruxelles-Nord dépassé, arrêts suivants connus : le même IC jusqu’à Bruxelles-Central, « Descends au prochain arrêt » la dernière minute, puis « Tu y es »', () => {
    const central = { name: N('Bruxelles-Central', 'Brussel-Centraal'), sched: T('08:46'), est: T('08:48'), areaId: 'sncb:8813003', lat: P.central.lat, lon: P.central.lon };
    const midi = { name: N('Bruxelles-Midi', 'Brussel-Zuid'), sched: T('08:52'), est: T('08:54'), areaId: 'sncb:8814001' };
    const ic = s1210Journey().legs[1];
    const j: Journey = { id: 'jride', legs: [ic], dep: ic.dep, arr: ic.arr, leaveAt: ic.dep, transfers: 0, rt: true, alerts: [] };
    const g = replay(j, { kind: 'ride', title: 'Vers Bruxelles-Nord', beyond: [central, midi] });
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    g.at(T('08:41:30'), [[T('08:41:30'), lerp(P.schuman, P.nord, 240 / 270), 8.9]]);
    // à quai à Bruxelles-Nord (immobile : la descente semble faite, « Tu y es »), puis le train repart : resté à bord
    expect(g.at(T('08:43'), [[T('08:42'), P.nord, 0], [T('08:43'), P.nord, 0]]).moment?.kind).toBe('arrived');
    expect(g.at(T('08:44'), [[T('08:43:30'), lerp(P.nord, P.central, 0.1), 5.6], [T('08:44'), lerp(P.nord, P.central, 0.2), 5.6]]).phase).toMatchObject({ kind: 'ride', leg: 0 });
    const s = g.at(T('08:45'), [[T('08:44:30'), lerp(P.nord, P.central, 0.3), 5.6], [T('08:45'), lerp(P.nord, P.central, 0.4), 5.6]]);
    expect(s.ended).toBe(false);
    expect(s.moment).toMatchObject({ kind: 'passed', passed: N('Bruxelles-Nord'), getOff: N('Bruxelles-Central', 'Brussel-Centraal'), at: T('08:48') });
    // rien à chercher : le contrôleur prolonge le même véhicule jusqu'à l'arrêt suivant
    expect(s.replan).toEqual({ from: { lat: P.central.lat, lon: P.central.lon, areaId: 'sncb:8813003', name: N('Bruxelles-Central', 'Brussel-Centraal') }, reason: 'passed', at: T('08:48') });
    const kept = rideOnJourney(j, [central, midi], s.replan!.from, T('08:45:05'));
    expect(kept?.journey.legs).toHaveLength(1);
    expect(kept?.journey.legs[0]).toMatchObject({ tripId: 'ic2112', from: { name: N('Namur') }, to: { name: N('Bruxelles-Central', 'Brussel-Centraal') }, arr: T('08:48') });
    expect(kept?.journey.arr).toBe(T('08:48'));
    expect(kept?.beyond.map((x) => x.name.fr)).toEqual(['Bruxelles-Midi']);
    g.use(kept!.journey, { kind: 'ride', title: 'Vers Bruxelles-Central', beyond: kept!.beyond });
    let t = g.at(T('08:45:05'), [[T('08:45:05'), lerp(P.nord, P.central, 0.45), 5.6]]);
    expect(t.phase).toMatchObject({ kind: 'ride', leg: 0 });
    expect(t.moment).toMatchObject({ kind: 'passed', getOff: N('Bruxelles-Central', 'Brussel-Centraal'), at: T('08:48') });
    expect(t.moment).not.toHaveProperty('arr');
    expect(t.replan).toBeUndefined();
    t = g.at(T('08:47:05'), [[T('08:47:05'), lerp(P.nord, P.central, 0.85), 5.6]]);
    expect(t.moment).toMatchObject({ kind: 'alight', leg: 0, stop: N('Bruxelles-Central', 'Brussel-Centraal'), at: T('08:48'), then: { kind: 'none' } });
    t = g.at(T('08:48:20'), [[T('08:48'), P.central, 0], [T('08:48:20'), P.central, 0.4]]);
    expect(t.moment).toMatchObject({ kind: 'arrived', title: 'Vers Bruxelles-Central' });
  });

  it('arrêts suivants d’une autre étape seulement (beyondByLeg) : ignorés', () => {
    const central = { name: N('Bruxelles-Central'), sched: T('08:46'), est: T('08:48'), areaId: 'sncb:8813003', lat: P.central.lat, lon: P.central.lon };
    const g = replay(s1210Journey(), { beyondByLeg: { 3: [central] } });
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    g.at(T('08:43'), [[T('08:42'), P.nord, 0], [T('08:43'), P.nord, 0]]);
    g.at(T('08:44'), [[T('08:43:30'), lerp(P.nord, P.central, 0.1), 5.6], [T('08:44'), lerp(P.nord, P.central, 0.2), 5.6]]);
    const s = g.at(T('08:45'), [[T('08:44:30'), lerp(P.nord, P.central, 0.3), 5.6], [T('08:45'), lerp(P.nord, P.central, 0.4), 5.6]]);
    expect(s.moment).toMatchObject({ kind: 'passed', getOff: { fr: '', nl: '' } });
    expect(s.replan?.from.areaId).toBeUndefined();
  });

  it('« j’y descends » (genre ride) : immobile à quai à Bruxelles-Nord puis emporté par l’IC : le guidage ne finit pas sur « Tu y es », « Tu as passé Bruxelles-Nord »', () => {
    const ic = s1210Journey().legs[1];
    const j: Journey = { id: 'jride', legs: [ic], dep: ic.dep, arr: ic.arr, leaveAt: ic.dep, transfers: 0, rt: true, alerts: [] };
    const g = replay(j, { kind: 'ride', title: 'Vers Bruxelles-Nord', beyond: [{ name: N('Bruxelles-Central'), sched: T('08:46'), est: T('08:48'), areaId: 'sncb:8813003' }] });
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    g.at(T('08:41:30'), [[T('08:41:30'), lerp(P.schuman, P.nord, 240 / 270), 8.9]]);
    // l'arrêt en gare ressemble à la descente : « Tu y es »
    expect(g.at(T('08:43'), [[T('08:42'), P.nord, 0], [T('08:43'), P.nord, 0]]).moment?.kind).toBe('arrived');
    // le train repart avec la personne : pas arrivé, toujours à bord
    expect(g.at(T('08:44'), [[T('08:43:30'), lerp(P.nord, P.central, 0.1), 5.6], [T('08:44'), lerp(P.nord, P.central, 0.2), 5.6]]).phase).toMatchObject({ kind: 'ride', leg: 0 });
    const s = g.at(T('08:45'), [[T('08:44:30'), lerp(P.nord, P.central, 0.3), 5.6], [T('08:45'), lerp(P.nord, P.central, 0.4), 5.6]]);
    expect(s.ended).toBe(false);
    expect(s.moment).toMatchObject({ kind: 'passed', passed: N('Bruxelles-Nord'), getOff: N('Bruxelles-Central'), at: T('08:48') });
    // l'arrêt suivant sans position : seulement « Descends à … » (rien à chercher, comme avant)
    expect(s.replan).toBeUndefined();
  });

  it('IC en retard encore avant Bruxelles-Nord après son heure, à plus de 300 m : pas « Tu as passé »', () => {
    const g = replay();
    g.at(T('07:46'), [[T('07:45:30'), lerp(P.namur, P.gembloux, 90 / 780), 19.7], [T('07:46'), lerp(P.namur, P.gembloux, 120 / 780), 19.7]]);
    // 08:43 : 4 min de retard, le train arrive de Schuman (à 800 m puis 600 m de la gare)
    g.at(T('08:43'), [[T('08:42:30'), lerp(P.schuman, P.nord, 0.62), 8], [T('08:43'), lerp(P.schuman, P.nord, 0.7), 8]]);
    const s = g.at(T('08:43:30'), [[T('08:43:30'), lerp(P.schuman, P.nord, 0.78), 8]]);
    expect(s.moment?.kind).not.toBe('passed');
    expect(s.replan).toBeUndefined();
  });
});
