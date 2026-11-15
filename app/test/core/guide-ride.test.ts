/**
 * 1.2.10 « J'y descends » (genre ride) : rideJourney, guidage d'un seul véhicule (attente, à bord, raté, dépassé,
 * descente constatée) ; un seul arrêt ; trajet à pied seul ; texte « Maintenant : … » du téléphone.
 */
import { describe, expect, it } from 'vitest';
import type { Departure, DepartureStops, Journey } from '../../src/core/api';
import type { GuideState, Moment } from '../../src/core/guide-types';
import { guideNowText, guideStatusOf, rideJourney } from '../../src/core/guide';
import { at, fix, guide, journeyOf, kindOf, MIN, N, offset, P, prdTrip, rideLeg, route, S, step, toward, walkLeg } from './guide-fixtures';

const m = <K extends Moment['kind']>(mo: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(mo?.kind).toBe(kind);
  return mo as Extract<Moment, { kind: K }>;
};

const pontAvroy = offset(P.guilleminsBus, 0, -600);
const call = (areaId: string, name: string, hm: string, extra: Partial<DepartureStops['stops'][number]> = {}) => ({ areaId, name: N(name), sched: at(hm), est: at(hm), rt: true, delayMin: 0, ...extra });

const dep6 = (hm = '07:12'): Departure => ({ op: 'tec', mode: 'bus', line: '6', head: N('Gare des Guillemins'), sched: at(hm), est: at(hm), rt: true, delayMin: 0, cancelled: false, tripId: `T6-${hm}`, stopId: 'LGgram1', stopSeq: 4 });
const ds6 = (shift = 0): DepartureStops => {
  const c = (areaId: string, name: string, hm: string) => ({ areaId, name: N(name), sched: at(hm) + shift * MIN, est: at(hm) + shift * MIN, rt: true, delayMin: 0 });
  return {
    op: 'tec', mode: 'bus', line: '6', head: N('Gare des Guillemins'), anyPlanned: false, state: 'ok',
    stops: [c('tec:LGgram', 'Monument Gramme', '07:12'), c('tec:LGlema', 'Place Général Leman', '07:16'), c('tec:LGguil', 'Gare des Guillemins', '07:20'), c('tec:LGpava', 'Pont d’Avroy', '07:24')],
  };
};
const coords6 = [P.gramme, P.leman, P.guilleminsBus, pontAvroy];

const depIc: Departure = { op: 'sncb', mode: 'train', line: 'IC', head: N('Ostende', 'Oostende'), sched: at('07:30'), est: at('07:32'), rt: true, delayMin: 2, cancelled: false, platform: '3', newPlatform: '6', tripId: 'IC1234', stopSeq: 7 };
const dsIc: DepartureStops = {
  op: 'sncb', mode: 'train', line: 'IC', head: N('Ostende', 'Oostende'), at: 1, anyPlanned: false, state: 'ok',
  stops: [
    call('sncb:8841525', 'Liège-Saint-Lambert', '07:24', { est: at('07:26'), delayMin: 2, platform: '2' }),
    call('sncb:8841004', 'Liège-Guillemins', '07:30', { est: at('07:32'), delayMin: 2, platform: '3', newPlatform: '6' }),
    call('sncb:8841202', 'Ans', '07:37', { est: at('07:39'), delayMin: 2, leave: at('07:40') }),
    call('sncb:8833001', 'Louvain', '08:05', { est: at('08:06'), delayMin: 1, cancelled: true }),
    call('sncb:8812005', 'Bruxelles-Nord', '08:22', { est: at('08:23'), delayMin: 1 }),
    call('sncb:8813003', 'Bruxelles-Central', '08:27', { est: at('08:28'), delayMin: 1 }),
  ],
};

const rideRun = (j: Journey, o: Parameters<typeof guide>[1] = {}) => guide(j, { kind: 'ride', title: 'Vers Gare des Guillemins', origin: P.gramme, startedAt: at('06:50'), ...o });

describe('rideJourney', () => {
  it('un bus du tableau jusqu’à l’arrêt touché : une étape, ses arrêts, son voyage', () => {
    const j = rideJourney(dep6(), ds6(), 0, 2);
    expect(j.legs).toHaveLength(1);
    const l = j.legs[0];
    expect(l).toMatchObject({ kind: 'ride', op: 'tec', mode: 'bus', line: '6', head: N('Gare des Guillemins'), dep: at('07:12'), arr: at('07:20'), schedDep: at('07:12'), schedArr: at('07:20'), tripId: 'T6-07:12', fromStop: 'LGgram1', fromSeq: 4, rt: true, delayMin: 0, cancelled: false });
    expect(l.from).toEqual({ name: N('Monument Gramme'), lat: 0, lon: 0, areaId: 'tec:LGgram' });
    expect(l.to.name).toEqual(N('Gare des Guillemins'));
    expect(l.stops?.map((s) => s.name.fr)).toEqual(['Monument Gramme', 'Place Général Leman', 'Gare des Guillemins']);
    expect(l.cat).toBeUndefined();
    expect(j).toMatchObject({ dep: at('07:12'), arr: at('07:20'), leaveAt: at('07:12'), transfers: 0, rt: true, alerts: [] });
  });

  it('identifiant stable ; autre arrêt de descente, autre trajet', () => {
    expect(rideJourney(dep6(), ds6(), 0, 2).id).toBe(rideJourney(dep6(), ds6(), 0, 2).id);
    expect(rideJourney(dep6(), ds6(), 0, 3).id).not.toBe(rideJourney(dep6(), ds6(), 0, 2).id);
  });

  it('positions des arrêts : sur l’étape et chaque arrêt', () => {
    const l = rideJourney(dep6(), ds6(), 0, 2, coords6).legs[0];
    expect(l.from).toMatchObject({ lat: P.gramme.lat, lon: P.gramme.lon });
    expect(l.to).toMatchObject({ lat: P.guilleminsBus.lat, lon: P.guilleminsBus.lon });
    expect(l.stops?.[1]).toMatchObject({ lat: P.leman.lat, lon: P.leman.lon });
  });

  it('train de tout son trajet (1.2.8) : depuis la gare du tableau, voie modifiée, gare supprimée sautée', () => {
    const l = rideJourney(depIc, dsIc, 1, 5).legs[0];
    expect(l).toMatchObject({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', dep: at('07:32'), schedDep: at('07:30'), arr: at('08:28'), schedArr: at('08:27'), platform: '3', newPlatform: '6', fromSeq: 7, delayMin: 2, tripId: 'IC1234' });
    expect(l.stops?.map((s) => s.name.fr)).toEqual(['Liège-Guillemins', 'Ans', 'Bruxelles-Nord', 'Bruxelles-Central']);
    expect(l.stops?.[0].platform).toBe('6');
  });

  it('montée à une gare après celle du tableau : son départ estimé, ni voyage ni quai du tableau', () => {
    const l = rideJourney(depIc, dsIc, 2, 5).legs[0];
    expect(l.dep).toBe(at('07:40'));
    expect(l.fromSeq).toBeUndefined();
    expect(l.fromStop).toBeUndefined();
    expect(l.from.name.fr).toBe('Ans');
  });

  it('rangs hors limites ramenés dans la liste', () => {
    const a = rideJourney(dep6(), ds6(), 3, 1).legs[0];
    expect([a.from.name.fr, a.to.name.fr]).toEqual(['Gare des Guillemins', 'Pont d’Avroy']);
    const b = rideJourney(dep6(), ds6(), -1, 99).legs[0];
    expect([b.from.name.fr, b.to.name.fr]).toEqual(['Monument Gramme', 'Pont d’Avroy']);
  });
});

describe('genre ride : « J’y descends »', () => {
  it('à l’arrêt : « Monter » 15 min avant, jamais « Partir », chaîne d’un seul véhicule, aucun chemin', () => {
    const r = rideRun(rideJourney(dep6(), ds6(), 0, 2, coords6));
    let s = step(r, at('06:56'), fix(P.gramme, at('06:56')));
    expect(s.phase).toEqual({ kind: 'wait', leg: 0 });
    expect(s.moment).toBeNull();
    s = step(r, at('06:57'), fix(P.gramme, at('06:57')));
    expect(m(s.moment, 'board')).toMatchObject({ depAt: at('07:12'), stopsToAlight: 2 });
    expect(s.where.chain).toEqual([{ label: 'bus 6', state: 'now' }]);
    expect(s.needRoute).toBeUndefined();
    expect(s.kind).toBe('ride');
  });

  it('à bord sans position : « Descends » (ensuite rien), puis « Tu y es » et la fin', () => {
    const r = rideRun(rideJourney(dep6(), ds6(), 0, 2));
    const al = m(step(r, at('07:16:30')).moment, 'alight');
    expect(al.then).toEqual({ kind: 'none' });
    const s = step(r, at('07:20'));
    expect(s.phase).toEqual({ kind: 'arrived' });
    expect(kindOf(s)).toBe('alight');
    expect(m(step(r, at('07:22')).moment, 'arrived')).toMatchObject({ title: 'Vers Gare des Guillemins', at: at('07:20'), diffMin: 0 });
    expect(step(r, at('07:23:59')).ended).toBe(false);
    expect(step(r, at('07:24')).ended).toBe(true);
  });

  it('descente constatée : « Tu y es » tout de suite, à l’heure de la descente', () => {
    const r = rideRun(rideJourney(dep6(), ds6(), 0, 2, coords6));
    step(r, at('07:12:20'), fix(toward(P.gramme, P.leman, 150), at('07:12:20'), { speed: 8 }));
    expect(r.mem.boarded?.leg).toBe(0);
    const s = step(r, at('07:19:50'), fix(offset(P.guilleminsBus, 10, 0), at('07:19:50'), { speed: 0.4 }));
    expect(s.phase).toEqual({ kind: 'arrived' });
    expect(m(s.moment, 'arrived')).toMatchObject({ at: at('07:19:50'), diffMin: 0 });
  });

  it('raté (temps réel) : « Ton bus 6 de 07:12 est parti », puis « Prochain : bus 6 à 07:24 »', () => {
    const r = rideRun(rideJourney(dep6(), ds6(), 0, 2, coords6));
    step(r, at('07:10'), fix(P.gramme, at('07:10')));
    const s = step(r, at('07:14:30'), fix(P.gramme, at('07:14:30')));
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed', lost: { depAt: at('07:12') } });
    expect(s.replan).toMatchObject({ reason: 'missed', from: { areaId: 'tec:LGgram' } });
    r.j = rideJourney(dep6('07:24'), ds6(12), 0, 2, coords6);
    const t = step(r, at('07:14:40'), fix(P.gramme, at('07:14:40')));
    expect(m(t.moment, 'replan')).toMatchObject({ next: { vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('07:24') }, arr: at('07:32'), laterMin: 12 });
    expect(t.replan).toBeUndefined();
  });

  it('arrêt dépassé : « Tu as passé Gare des Guillemins », « Descends à Pont d’Avroy », sans recalcul', () => {
    const r = rideRun(rideJourney(dep6(), ds6(), 0, 2, coords6), { beyond: [{ name: N('Pont d’Avroy'), sched: at('07:24'), est: at('07:24') }] });
    step(r, at('07:12:20'), fix(toward(P.gramme, P.leman, 150), at('07:12:20'), { speed: 8 }));
    const past = (d: number) => toward(P.leman, P.guilleminsBus, 424 + d);
    step(r, at('07:21'), fix(past(350), at('07:21'), { speed: 8 }));
    const s = step(r, at('07:21:20'), fix(past(450), at('07:21:20'), { speed: 8 }));
    expect(s.phase).toMatchObject({ kind: 'ride', leg: 0 });
    expect(m(s.moment, 'passed')).toMatchObject({ passed: N('Gare des Guillemins'), getOff: N('Pont d’Avroy'), at: at('07:24') });
    expect(s.replan).toBeUndefined();
  });

  it('supprimé : recalcul demandé (le contrôleur cherche le suivant au tableau)', () => {
    const d = { ...dep6(), cancelled: true };
    const r = rideRun(rideJourney(d, ds6(), 0, 2));
    const s = step(r, at('07:00'));
    expect(s.replan).toMatchObject({ reason: 'cancelled' });
    expect(m(s.moment, 'replan').reason).toBe('cancelled');
  });
});

describe('un seul arrêt, trajet à pied seul', () => {
  it('un seul arrêt (bus) : « Descends » 30 s après le départ', () => {
    const one = rideLeg({ op: 'tec', mode: 'bus', line: '6', head: 'Gare des Guillemins', stops: [{ p: S.gramme, t: at('07:12') }, { p: S.leman, t: at('07:14') }] });
    const r = rideRun(journeyOf([one], 'j1'));
    expect(step(r, at('07:12:20')).moment).toBeNull();
    const al = m(step(r, at('07:12:30')).moment, 'alight');
    expect(al).toMatchObject({ stop: N('Place Général Leman'), at: at('07:14') });
  });

  it('un seul arrêt (train direct de 25 min) : pas avant 4 min de l’arrivée, aucun « Prochain arrêt »', () => {
    const ic = rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Liège-Guillemins', stops: [{ p: S.central, t: at('09:00') }, { p: S.guillemins, t: at('09:25') }] });
    const r = rideRun(journeyOf([ic], 'jd'));
    for (const t of ['09:01', '09:10', '09:20:59']) expect(step(r, at(t)).moment).toBeNull();
    expect(kindOf(step(r, at('09:21')))).toBe('alight');
  });

  it('à pied seul : avant, « Partir maintenant » sans véhicule, virage final, « Tu y es » à 50 m (1 min d’avance)', () => {
    const q = offset(P.flagey, 0, -200);
    const rt = route([P.flagey, q, P.etangs], [{ at: 1, turn: 'left' }]);
    const j = journeyOf([walkLeg(S.flagey, S.etangs, at('10:00'), 6)], 'jw', at('10:00'));
    const r = guide(j, { origin: P.flagey, startedAt: at('09:45'), walk: { leg: 0, route: rt } });
    expect(step(r, at('09:49')).location).toBe('off');
    let s = step(r, at('09:50'));
    expect(s).toMatchObject({ phase: { kind: 'before', leg: 0 }, location: 'medium' });
    expect(s.where.walk).toMatchObject({ toKind: 'dest', toward: N('Étangs d’Ixelles'), remainingMin: 6 });
    expect(s.where.walk?.vehicle).toBeUndefined();
    s = step(r, at('10:00'));
    const lv = m(s.moment, 'leave');
    expect(lv).toMatchObject({ walkMin: 6, toward: N('Étangs d’Ixelles') });
    expect(lv.vehicle).toBeUndefined();
    expect(lv.tight).toBeUndefined();
    expect(s.where.chain).toEqual([{ label: 'à pied', state: 'now' }]);
    s = step(r, at('10:02'), fix(offset(P.flagey, 0, -175), at('10:02')));
    expect(m(s.moment, 'turn')).toMatchObject({ turn: 'left', final: true });
    s = step(r, at('10:05'), fix(offset(P.etangs, 0, 30), at('10:05')));
    expect(s.phase).toEqual({ kind: 'arrived' });
    expect(m(s.moment, 'arrived')).toMatchObject({ at: at('10:05'), diffMin: -1 });
    expect(s.where.chain).toEqual([{ label: 'à pied', state: 'done' }]);
    expect(step(r, at('10:07')).ended).toBe(true);
  });

  it('à pied seul sans position : « Tu y es » à l’heure d’arrivée', () => {
    const j = journeyOf([walkLeg(S.flagey, S.etangs, at('10:00'), 6)], 'jw', at('10:00'));
    const r = guide(j, { origin: P.flagey, startedAt: at('09:45') });
    expect(step(r, at('10:05:59')).phase.kind).toBe('walk');
    expect(m(step(r, at('10:06')).moment, 'arrived')).toMatchObject({ at: at('10:06'), diffMin: 0 });
  });
});

describe('téléphone : « Maintenant : … »', () => {
  const j = prdTrip();
  const st = (phase: GuideState['phase']): GuideState => ({ kind: 'trip', journeyId: j.id, phase, moment: null, where: { title: 'Bureau', arr: j.arr, rt: true, chain: [] }, location: 'off', wakeAt: 0, ended: false });

  it('chaque étape du trajet du PRD', () => {
    expect(guideNowText(st({ kind: 'before', leg: 0 }), j, 'fr')).toBe('partir à 07:05');
    expect(guideNowText(st({ kind: 'walk', leg: 0 }), j, 'fr')).toBe('à pied vers l’arrêt du bus 6');
    expect(guideNowText(st({ kind: 'wait', leg: 1 }), j, 'fr')).toBe('bus 6 vers Gare des Guillemins');
    expect(guideNowText(st({ kind: 'ride', leg: 1, next: 1 }), j, 'fr')).toBe('bus 6 vers Gare des Guillemins');
    expect(guideNowText(st({ kind: 'walk', leg: 2 }), j, 'fr')).toBe('à pied vers la voie 3');
    expect(guideNowText(st({ kind: 'wait', leg: 3 }), j, 'fr')).toBe('IC vers Ostende, voie 3');
    expect(guideNowText(st({ kind: 'ride', leg: 3, next: 2 }), j, 'fr')).toBe('IC vers Ostende');
    expect(guideNowText(st({ kind: 'walk', leg: 6 }), j, 'fr')).toBe('à pied, arrivée 08:54');
    expect(guideNowText(st({ kind: 'arrived' }), j, 'fr')).toBe('tu y es');
    expect(guideNowText(st({ kind: 'ended' }), j, 'fr')).toBe('trajet terminé');
  });

  it('à pied vers une gare, avant un train, destination STIB sans « (P) », néerlandais, bus SNCB', () => {
    const toStation = journeyOf([walkLeg(S.avroy, S.guillemins, at('07:15'), 9), IC_ONLY()], 'jt', at('07:15'));
    expect(guideNowText(st({ kind: 'walk', leg: 0 }), toStation, 'fr')).toBe('à pied vers Liège-Guillemins');
    const fromStation = journeyOf([IC_ONLY()], 'js');
    expect(guideNowText(st({ kind: 'before', leg: 0 }), fromStation, 'fr')).toBe('IC à 07:30');
    expect(guideNowText(st({ kind: 'ride', leg: 0, next: 1 }), fromStation, 'nl')).toBe('IC vers Oostende');
    const tram = rideLeg({ op: 'stib', mode: 'tram', line: '4', head: 'Stalle (P)', stops: [{ p: S.gareCentrale, t: at('09:00') }, { p: S.porteNamur, t: at('09:06') }] });
    expect(guideNowText(st({ kind: 'ride', leg: 0, next: 1 }), journeyOf([tram], 'jtr'), 'fr')).toBe('tram 4 vers Stalle');
    const bus = rideLeg({ op: 'sncb', mode: 'bus', line: 'BUS', cat: 'BUS', head: 'Landen', stops: [{ p: S.louvain, t: at('09:00') }, { p: S.ans, t: at('09:40') }] });
    expect(guideNowText(st({ kind: 'wait', leg: 0 }), journeyOf([bus], 'jb'), 'fr')).toBe('bus SNCB vers Landen');
  });

  it('carte « En cours »', () => {
    expect(guideStatusOf(st({ kind: 'ride', leg: 1, next: 1 }), j, 'Bureau', true, 'fr')).toEqual({ kind: 'trip', title: 'Bureau', arr: at('08:54'), now: 'bus 6 vers Gare des Guillemins', guided: true });
  });

  it('carte « En cours », dernière marche : « à pied vers le bureau », jamais l’arrivée répétée de la ligne du dessus', () => {
    expect(guideStatusOf(st({ kind: 'walk', leg: 6 }), j, 'Bureau', true, 'fr').now).toBe('à pied vers le bureau');
    expect(guideStatusOf(st({ kind: 'walk', leg: 6 }), j, 'Gand-Saint-Pierre', true, 'fr').now).toBe('à pied vers Gand-Saint-Pierre');
    expect(guideStatusOf(st({ kind: 'walk', leg: 6 }), j, 'Vers chez Karim', true, 'fr').now).toBe('à pied vers chez Karim');
    for (const t of ['Bureau', 'Gand-Saint-Pierre']) expect(guideStatusOf(st({ kind: 'walk', leg: 6 }), j, t, true, 'fr').now).not.toMatch(/arrivée/);
  });
});

function IC_ONLY() {
  return rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Ostende', 'Oostende'), platform: '3', stops: [{ p: S.guillemins, t: at('07:30'), platform: '3' }, { p: { name: N('Ostende', 'Oostende'), lat: 51.228, lon: 2.925 }, t: at('09:15') }] });
}
