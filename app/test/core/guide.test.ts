/**
 * 1.2.10 « Y aller » : moteur du guidage (PRD-1.2.10 § 3, § 9.2). Trajet du PRD : à pied jusqu'à Monument Gramme,
 * bus 6 jusqu'à Gare des Guillemins, IC 07:30 voie 3 jusqu'à Bruxelles-Central par Ans, Louvain et Bruxelles-Nord, à
 * pied, bus 71 jusqu'à Flagey, à pied jusqu'aux étangs d'Ixelles. Heure seule, positions, temps réel, imprévus.
 */
import { describe, expect, it } from 'vitest';
import type { Moment } from '../../src/core/guide-types';
import { dismissMoment, GUIDE, guideStep, newGuideMemory, replanJourney, replanNone, type GuideInput } from '../../src/core/guide';
import {
  at,
  BUS6,
  fix,
  firstWalkRoute,
  guide,
  IC,
  journeyOf,
  kindOf,
  MIN,
  N,
  offset,
  P,
  prdTrip,
  rideLeg,
  route,
  S,
  SEC,
  settings,
  step,
  toward,
  walkLeg,
} from './guide-fixtures';

const m = <K extends Moment['kind']>(mo: Moment | null, kind: K): Extract<Moment, { kind: K }> => {
  expect(mo?.kind).toBe(kind);
  return mo as Extract<Moment, { kind: K }>;
};

describe('seuils du guidage', () => {
  it('reprend les seuils du PRD', () => {
    expect(GUIDE).toMatchObject({ turnM: 40, turnAfterM: 10, stopM: 60, passedM: 300, accuracyM: 75, freshMs: 60_000, arrivedM: 50, leaveM: 40 });
    expect(GUIDE.boardAheadMs).toBe(15 * MIN);
    expect(GUIDE.wakeMaxMs).toBe(60_000);
  });

  it('mémoire neuve', () => {
    expect(newGuideMemory()).toEqual({ v: 1, dismissed: [], shown: {} });
  });
});

describe('heure seule (sans position), trajet complet', () => {
  it('avant de partir : écran vide, « où tu en es » à pied, position coupée, chemin demandé', () => {
    const r = guide(prdTrip());
    const s = step(r, at('06:40'));
    expect(s.phase).toEqual({ kind: 'before', leg: 0 });
    expect(s.moment).toBeNull();
    expect(s.location).toBe('off');
    expect(s.ended).toBe(false);
    expect(s.where.walk).toMatchObject({ toward: N('Monument Gramme'), toKind: 'stop', remainingMin: 5, depAt: at('07:12'), marginMin: 27 });
    expect(s.where.walk?.vehicle).toEqual({ op: 'tec', mode: 'bus', line: '6' });
    expect(s.where.chain).toEqual([
      { label: 'à pied', state: 'next' },
      { label: 'bus 6', state: 'next' },
      { label: 'IC', state: 'next' },
      { label: 'bus 71', state: 'next' },
    ]);
    expect(s.needRoute).toEqual({ leg: 0, from: P.avroy, to: P.gramme });
    expect(s.wakeAt).toBe(at('06:41'));
    expect(s.where).toMatchObject({ title: 'Bureau', arr: at('08:54'), rt: true });
  });

  it('« où tu en es » à pied : temps réel du véhicule visé (bus 6), pas celui du trajet entier', () => {
    const j = prdTrip();
    j.legs[5] = { ...j.legs[5], rt: false };
    j.rt = false;
    const s = step(guide(j), at('07:00'));
    expect(s.where.rt).toBe(false);
    expect(s.where.walk).toMatchObject({ vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('07:12'), rt: true });
    const s2 = step(guide(prdTrip({ bus6Rt: false })), at('07:00'));
    expect(s2.where.walk?.rt).toBe(false);
  });

  it('10 min avant de partir : position moyenne', () => {
    const r = guide(prdTrip());
    expect(step(r, at('06:54')).location).toBe('off');
    expect(step(r, at('06:55')).location).toBe('medium');
  });

  it('à l’heure de partir : « Partir maintenant », 5 min à pied, bus 6 à 07:12, marge 2 min', () => {
    const r = guide(prdTrip());
    step(r, at('07:04'));
    const s = step(r, at('07:05'));
    expect(s.phase).toEqual({ kind: 'walk', leg: 0 });
    const mo = m(s.moment, 'leave');
    expect(mo).toMatchObject({ id: 'leave:jprd', since: at('07:05'), until: at('07:08'), walkMin: 5, toward: N('Monument Gramme'), depAt: at('07:12'), rt: true, marginMin: 2, leg: 0 });
    expect(mo.vehicle).toEqual({ op: 'tec', mode: 'bus', line: '6' });
    expect(mo.tight).toBeUndefined();
    expect(s.location).toBe('high');
    expect(s.where.chain[0]).toEqual({ label: 'à pied', state: 'now' });
  });

  it('« Partir maintenant » avec 2 min de marge : pas « très juste » une seconde après (marge exacte, 60 s au plus)', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    expect(m(step(r, at('07:05:01')).moment, 'leave').tight).toBeUndefined();
    expect(m(step(r, at('07:05:59')).moment, 'leave').tight).toBeUndefined();
    const late = m(step(r, at('07:06')).moment, 'leave');
    expect(late.tight).toBe(true);
    expect(late.marginMin).toBe(1);
  });

  it('« Partir maintenant » finit 3 min après et ne revient pas', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    expect(kindOf(step(r, at('07:07:59')))).toBe('leave');
    expect(step(r, at('07:08')).moment).toBeNull();
    expect(r.mem.dismissed).toContain('leave:jprd');
    expect(step(r, at('07:09')).moment).toBeNull();
  });

  it('guidage lancé après l’heure de partir : tout de suite, « très juste » et « Si tu le rates »', () => {
    const r = guide(prdTrip(), { startedAt: at('07:07'), missed: { arr: at('09:24'), laterMin: 30 } });
    const mo = m(step(r, at('07:07')).moment, 'leave');
    expect(mo).toMatchObject({ since: at('07:07'), until: at('07:10'), marginMin: 0, tight: true, missed: { arr: at('09:24'), laterMin: 30 } });
  });

  it('effacé d’un toucher : ne revient pas', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:05'));
    r.mem = dismissMoment(r.mem, s.moment!.id, at('07:05:10'));
    expect(step(r, at('07:05:20')).moment).toBeNull();
    expect(step(r, at('07:06')).moment).toBeNull();
  });

  it('fin de la marche : à l’arrêt, « Monter » : bus 6 vers Gare des Guillemins, descente dans 2 arrêts', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    const s = step(r, at('07:10'));
    expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    const mo = m(s.moment, 'board');
    expect(mo).toMatchObject({ id: 'board:jprd:1:', leg: 1, head: N('Gare des Guillemins'), depAt: at('07:12'), rt: true, alight: N('Gare des Guillemins'), stopsToAlight: 2, until: at('07:13') });
    expect(mo.vehicle).toEqual({ op: 'tec', mode: 'bus', line: '6' });
    expect(mo.walkMin).toBeUndefined();
    expect(mo.marginMin).toBeUndefined();
    expect(mo.platform).toBeUndefined();
    expect(s.where.wait).toMatchObject({ stop: N('Monument Gramme'), depAt: at('07:12'), rt: true });
    expect(s.where.chain.map((x) => x.state)).toEqual(['done', 'now', 'next', 'next']);
    expect(s.location).toBe('high');
  });

  it('« Monter » reste jusqu’au départ + 1 min, même parti d’après l’heure', () => {
    const r = guide(prdTrip());
    step(r, at('07:10'));
    const s = step(r, at('07:12:30'));
    expect(s.phase.kind).toBe('ride');
    expect(kindOf(s)).toBe('board');
    expect(step(r, at('07:13')).moment).toBeNull();
  });

  it('à bord : « où tu en es » avec le prochain arrêt, position moyenne', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:14'));
    expect(s.phase).toEqual({ kind: 'ride', leg: 1, next: 1 });
    expect(s.where.ride).toMatchObject({ total: 3, next: 1, nextStop: N('Place Général Leman'), nextAt: at('07:16'), alight: N('Gare des Guillemins'), alightAt: at('07:20'), stopsToAlight: 2, rt: true });
    expect(s.where.ride?.head).toEqual(N('Gare des Guillemins'));
    expect(s.location).toBe('medium');
    expect(s.moment).toBeNull();
  });

  it('« Descends au prochain arrêt » : 30 s après l’arrêt d’avant, ensuite voie 3, IC à 07:30', () => {
    const r = guide(prdTrip());
    expect(step(r, at('07:16:15')).moment).toBeNull();
    const s = step(r, at('07:16:30'));
    const mo = m(s.moment, 'alight');
    expect(mo).toMatchObject({ id: 'alight:jprd:1', stop: N('Gare des Guillemins'), at: at('07:20'), rt: true, until: at('07:22') });
    expect(mo.then).toEqual({ kind: 'ride', vehicle: { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' }, depAt: at('07:30'), rt: true, platform: '3', walkMin: 3 });
    expect(s.location).toBe('high');
  });

  it('« Descends » reste jusqu’à l’arrivée + 2 min, puis la marche vers la voie 3', () => {
    const r = guide(prdTrip());
    step(r, at('07:16:30'));
    const s = step(r, at('07:21'));
    expect(s.phase).toEqual({ kind: 'walk', leg: 2 });
    expect(kindOf(s)).toBe('alight');
    expect(s.where.walk).toMatchObject({ toward: N('Liège-Guillemins'), toKind: 'platform', remainingMin: 2, depAt: at('07:30'), marginMin: 7 });
    expect(s.where.chain.map((x) => x.state)).toEqual(['done', 'done', 'now', 'next']);
    expect(step(r, at('07:22')).moment).toBeNull();
  });

  it('IC : « Monter » à la fin de la marche, voie 3, marge 7 min, descente dans 4 arrêts', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:23'));
    expect(s.phase).toEqual({ kind: 'wait', leg: 3 });
    const mo = m(s.moment, 'board');
    expect(mo).toMatchObject({ id: 'board:jprd:3:3', platform: '3', depAt: at('07:30'), marginMin: 7, stopsToAlight: 4, alight: N('Bruxelles-Central', 'Brussel-Centraal') });
    expect(mo.walkMin).toBeUndefined();
    expect(mo.platformChanged).toBeUndefined();
    expect(s.where.wait).toMatchObject({ platform: '3', stop: N('Liège-Guillemins') });
  });

  it('IC : « Prochain arrêt » 1 min avant Ans et Louvain, jamais dans les 5 min avant « Descends »', () => {
    const r = guide(prdTrip());
    const ans = m(step(r, at('07:36')).moment, 'nextStop');
    expect(ans).toMatchObject({ id: 'nextStop:jprd:3:1', stop: N('Ans'), at: at('07:37'), stopsToAlight: 4, alight: N('Bruxelles-Central', 'Brussel-Centraal'), until: at('07:39') });
    expect(r.mem.lastNextStopAt).toBe(at('07:36'));
    expect(kindOf(step(r, at('07:38')))).toBe('nextStop');
    expect(step(r, at('07:39')).moment).toBeNull();
    // exemple du PRD : « Prochain arrêt : Louvain » ; « descente dans 3 arrêts, à Bruxelles-Central » (Louvain,
    // Bruxelles-Nord, Bruxelles-Central) ; le même compte que « Où tu en es » au même instant
    const s4 = step(r, at('08:04'));
    const lou = m(s4.moment, 'nextStop');
    expect(lou).toMatchObject({ stop: N('Louvain', 'Leuven'), stopsToAlight: 3 });
    expect(s4.where.ride).toMatchObject({ nextStop: N('Louvain', 'Leuven'), stopsToAlight: 3 });
    expect(step(r, at('08:07')).moment).toBeNull();
    // Bruxelles-Nord (08:22) : dans les 5 min avant « Descends » (08:23)
    expect(step(r, at('08:21')).moment).toBeNull();
    expect(step(r, at('08:22:30')).moment).toBeNull();
    const al = m(step(r, at('08:23')).moment, 'alight');
    expect(al.then).toEqual({ kind: 'ride', vehicle: { op: 'stib', mode: 'bus', line: '71' }, depAt: at('08:34'), rt: true, walkMin: 3 });
  });

  it('« Prochain arrêt » : au plus un toutes les 10 min', () => {
    const t0 = at('09:00');
    const names = ['Bruxelles-Nord', 'Schaerbeek', 'Haren', 'Diegem', 'Zaventem', 'Nossegem', 'Kortenberg', 'Louvain'];
    const pts = names.map((n, i) => ({ p: { name: N(n), lat: 50.85 + i * 0.005, lon: 4.36 + i * 0.03 }, t: t0 + i * 4 * MIN }));
    const train = rideLeg({ op: 'sncb', mode: 'train', line: 'S2', cat: 'S2', head: 'Louvain', stops: pts });
    const r = guide(journeyOf([train], 'js2'), { origin: undefined });
    const seen: string[] = [];
    for (let t = t0 - 10 * MIN; t <= t0 + 28 * MIN; t += 30 * SEC) {
      const s = step(r, t);
      if (s.moment && !seen.includes(s.moment.id)) seen.push(s.moment.id);
    }
    // 09:03 (Schaerbeek) puis 09:13 (Diegem, 10 min après, encore dans sa fenêtre) ; Haren et Nossegem trop près du
    // précédent ; Kortenberg dans les 5 min avant « Descends »
    expect(seen).toEqual(['board:js2:0:', 'nextStop:js2:0:1', 'nextStop:js2:0:3', 'alight:js2:0']);
    expect(r.mem.shown['nextStop:js2:0:3']).toBe(t0 + 13 * MIN);
  });

  it('dernier véhicule : « Descends », ensuite 6 min à pied, puis « Tu y es » et la fin', () => {
    const r = guide(prdTrip());
    const al = m(step(r, at('08:44')).moment, 'alight');
    expect(al.then).toEqual({ kind: 'walk', min: 6, toward: N('Étangs d’Ixelles'), last: true });
    expect(step(r, at('08:43:59')).moment?.kind).toBe('alight'); // déjà montré : reste
    const s = step(r, at('08:54'));
    expect(s.phase).toEqual({ kind: 'arrived' });
    expect(m(s.moment, 'arrived')).toMatchObject({ id: 'arrived:jprd', title: 'Bureau', at: at('08:54'), diffMin: 0, until: at('08:56') });
    expect(s.location).toBe('off');
    expect(s.where.chain.every((x) => x.state === 'done')).toBe(true);
    expect(step(r, at('08:55')).ended).toBe(false);
    const e = step(r, at('08:56'));
    expect(e).toMatchObject({ ended: true, phase: { kind: 'ended' }, moment: null, location: 'off' });
    expect(e.needRoute).toBeUndefined();
  });

  it('« Tu y es » avec 3 min de retard (bus 71 en retard)', () => {
    const r = guide(prdTrip({ bus71Delay: 3 }));
    expect(m(step(r, at('08:57')).moment, 'arrived')).toMatchObject({ at: at('08:57'), diffMin: 3 });
  });

  it('fin au plus tard 5 min après l’arrivée (règle 1.2.x)', () => {
    const r = guide(prdTrip());
    expect(step(r, at('08:58:59')).ended).toBe(false);
    expect(step(r, at('08:59')).ended).toBe(true);
  });
});

describe('positions', () => {
  it('marche commencée avant l’heure : pas de « Partir maintenant »', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:03'), fix(offset(P.avroy, 0, -50), at('07:03')));
    expect(s.phase).toEqual({ kind: 'walk', leg: 0 });
    step(r, at('07:04:30'), fix(offset(P.avroy, 0, -120), at('07:04:30')));
    expect(step(r, at('07:05'), fix(offset(P.avroy, 0, -130), at('07:05'))).moment).toBeNull();
  });

  it('« Partir maintenant » finit quand la marche commence (40 m) et ne revient pas', () => {
    const r = guide(prdTrip());
    expect(kindOf(step(r, at('07:05')))).toBe('leave');
    expect(step(r, at('07:06'), fix(offset(P.avroy, 0, -45), at('07:06'))).moment).toBeNull();
    expect(r.mem.dismissed).toContain('leave:jprd');
    expect(step(r, at('07:07'), fix(offset(P.avroy, 0, -10), at('07:07'))).moment).toBeNull();
  });

  it('virages : à 40 m, « maintenant », fini 10 m après, puis le suivant avec le nom de la rue', () => {
    const rt = firstWalkRoute();
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    const b = rt.coords[1];
    const c = rt.coords[2];
    expect(step(r, at('07:06'), fix(offset(P.avroy, 0, -150), at('07:06'))).moment).toBeNull();
    const t1 = m(step(r, at('07:06:20'), fix(offset(P.avroy, 0, -165), at('07:06:20'))).moment, 'turn');
    expect(t1).toMatchObject({ id: 'turn:jprd:0:0:1', turn: 'right', street: 'Boulevard d’Avroy', toward: N('Monument Gramme'), final: false, leg: 0, until: at('07:07:20') });
    expect(t1.distM).toBeGreaterThanOrEqual(34);
    expect(t1.distM).toBeLessThanOrEqual(36);
    expect(m(step(r, at('07:06:40'), fix(offset(b, -5, 0), at('07:06:40'))).moment, 'turn').distM).toBe(0);
    expect(step(r, at('07:06:50'), fix(offset(b, -12, 0), at('07:06:50'))).moment).toBeNull();
    expect(r.mem.dismissed).toContain('turn:jprd:0:0:1');
    expect(step(r, at('07:09'), fix(offset(c, 80, 0), at('07:09'))).moment).toBeNull();
    const t2 = m(step(r, at('07:10'), fix(offset(c, 32, 0), at('07:10'))).moment, 'turn');
    expect(t2).toMatchObject({ id: 'turn:jprd:0:1:1', turn: 'right', street: 'Rue Darchis' });
    expect(t2.distM).toBeGreaterThanOrEqual(31);
    expect(t2.distM).toBeLessThanOrEqual(33);
  });

  it('virage : 15 s à la vitesse de marche si elle dépasse 40 m', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: firstWalkRoute() } });
    expect(step(r, at('07:06'), fix(offset(P.avroy, 0, -145), at('07:06'))).moment).toBeNull();
    const t = m(step(r, at('07:06:02'), fix(offset(P.avroy, 0, -146), at('07:06:02'), { speed: 4.2 })).moment, 'turn');
    expect(t.distM).toBe(54);
  });

  it('virage effacé : ne revient pas avant le virage', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: firstWalkRoute() } });
    const s = step(r, at('07:06:20'), fix(offset(P.avroy, 0, -165), at('07:06:20')));
    r.mem = dismissMoment(r.mem, s.moment!.id, at('07:06:21'));
    expect(step(r, at('07:06:30'), fix(offset(P.avroy, 0, -180), at('07:06:30'))).moment).toBeNull();
  });

  it('dernière marche : virage vers la destination (final)', () => {
    const q = offset(P.flagey, 0, -200);
    const rt = route([P.flagey, q, P.etangs], [{ at: 1, turn: 'slightLeft', street: 'Avenue du Général de Gaulle' }]);
    const r = guide(prdTrip(), { walk: { leg: 6, route: rt } });
    const s = step(r, at('08:50'), fix(offset(P.flagey, 0, -170), at('08:50')));
    expect(s.phase).toEqual({ kind: 'walk', leg: 6 });
    expect(m(s.moment, 'turn')).toMatchObject({ turn: 'slightLeft', final: true, toward: N('Étangs d’Ixelles') });
    expect(s.where.walk).toMatchObject({ toKind: 'dest' });
  });

  it('chemin droit : aucun virage, direction de l’arrêt par rapport au cap', () => {
    const rt = route([P.avroy, P.gramme], [], 'straight');
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    step(r, at('07:06'), fix(offset(P.avroy, -100, 0), at('07:06')));
    const s = step(r, at('07:06:10'), fix(offset(P.avroy, -110, 0), at('07:06:10'), { heading: 180 }));
    expect(s.moment).toBeNull();
    expect(s.where.walk?.bearingDeg).toBe(90);
    expect(s.where.walk?.next).toBeUndefined();
  });

  it('hors du chemin plus de 30 m pendant 10 s : nouveau chemin demandé, aucun virage, aucun message', () => {
    const rt = firstWalkRoute();
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    const off = (n: number) => offset(P.avroy, 60, -150 - n);
    step(r, at('07:06:00'), fix(off(0), at('07:06:00')));
    let s = step(r, at('07:06:05'), fix(off(5), at('07:06:05')));
    expect(s.needRoute).toBeUndefined();
    s = step(r, at('07:06:10'), fix(off(10), at('07:06:10')));
    expect(s.needRoute).toEqual({ leg: 0, from: { lat: off(10).lat, lon: off(10).lon }, to: P.gramme });
    expect(s.moment).toBeNull();
  });

  it('chemin de la marche en cours demandé une fois ; à bord, celui de la marche suivante', () => {
    const r = guide(prdTrip(), { walk: { leg: 0, route: firstWalkRoute() } });
    expect(step(r, at('06:40')).needRoute).toBeUndefined();
    const s = step(r, at('07:14'));
    expect(s.needRoute).toEqual({ leg: 2, from: { lat: P.guilleminsBus.lat, lon: P.guilleminsBus.lon }, to: { lat: P.guillemins.lat, lon: P.guillemins.lon } });
  });

  it('« où tu en es » en marchant : reste, minutes, marge et prochain virage', () => {
    const rt = firstWalkRoute();
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    const s = step(r, at('07:07'), fix(offset(rt.coords[1], -100, 0), at('07:07')));
    const w = s.where.walk!;
    expect(w.remainingM).toBeGreaterThan(495);
    expect(w.remainingM).toBeLessThan(510);
    expect(w.remainingMin).toBe(7);
    expect(w.marginMin).toBe(-2);
    expect(w.next?.turn).toBe('right');
    expect(w.next?.distM).toBeGreaterThan(295);
    expect(w.next?.distM).toBeLessThan(310);
  });

  it('à 60 m de l’arrêt avant l’heure : « Monter » tout de suite (départ dans 4 min)', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:08'), fix(offset(P.gramme, 30, 0), at('07:08')));
    expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    expect(kindOf(s)).toBe('board');
  });

  it('à l’arrêt très tôt : « Monter » seulement 15 min avant le départ', () => {
    const r = guide(prdTrip(), { startedAt: at('06:30') });
    let s = step(r, at('06:50'), fix(P.gramme, at('06:50')));
    expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    expect(s.moment).toBeNull();
    expect(s.location).toBe('medium');
    s = step(r, at('06:57'), fix(P.gramme, at('06:57')));
    expect(kindOf(s)).toBe('board');
    expect(s.location).toBe('high');
  });

  it('montée constatée (vitesse le long du trajet) : « Monter » s’efface, à bord', () => {
    const r = guide(prdTrip());
    step(r, at('07:10'), fix(P.gramme, at('07:10')));
    expect(kindOf(step(r, at('07:11:50'), fix(P.gramme, at('07:11:50'))))).toBe('board');
    const s = step(r, at('07:12:20'), fix(toward(P.gramme, P.leman, 150), at('07:12:20'), { speed: 8 }));
    expect(r.mem.boarded).toEqual({ leg: 1, at: at('07:12:20') });
    expect(s.phase).toMatchObject({ kind: 'ride', leg: 1 });
    expect(s.moment).toBeNull();
  });

  it('descente constatée : « Descends » s’efface ; à la gare, correspondance : 3 min à pied jusqu’au quai, marge 6 min', () => {
    const r = guide(prdTrip());
    step(r, at('07:12:20'), fix(toward(P.gramme, P.leman, 150), at('07:12:20'), { speed: 8 }));
    expect(kindOf(step(r, at('07:16:40'), fix(toward(P.leman, P.guilleminsBus, 200), at('07:16:40'), { speed: 7 })))).toBe('alight');
    const s = step(r, at('07:19:40'), fix(offset(P.guilleminsBus, 0, 30), at('07:19:40'), { speed: 0.8 }));
    expect(r.mem.alighted).toEqual({ leg: 1, at: at('07:19:40') });
    expect(s.moment).toBeNull();
    const b = step(r, at('07:21'), fix(offset(P.guillemins, 0, 20), at('07:21'), { speed: 1.2 }));
    expect(b.phase).toEqual({ kind: 'wait', leg: 3 });
    expect(m(b.moment, 'board')).toMatchObject({ walkMin: 3, marginMin: 6, platform: '3' });
  });

  it('« Descends » quand le véhicule quitte l’arrêt d’avant (position), avant l’heure estimée + 30 s', () => {
    const r = guide(prdTrip());
    step(r, at('07:12:20'), fix(toward(P.gramme, P.leman, 150), at('07:12:20'), { speed: 8 }));
    expect(step(r, at('07:15:50'), fix(toward(P.leman, P.guilleminsBus, 150), at('07:15:50'), { speed: 7 })).moment).toBeNull(); // pas avant 4 min de l'arrivée
    expect(kindOf(step(r, at('07:16:05'), fix(toward(P.leman, P.guilleminsBus, 160), at('07:16:05'), { speed: 7 })))).toBe('alight');
  });

  it('bus en retard sans temps réel : la position décide de « Descends », qui reste jusqu’à la descente', () => {
    const r = guide(prdTrip({ bus6Rt: false }));
    step(r, at('07:12:20'), fix(toward(P.gramme, P.leman, 150), at('07:12:20'), { speed: 8 }));
    let s = step(r, at('07:16:40'), fix(toward(P.gramme, P.leman, 400), at('07:16:40'), { speed: 6 }));
    expect(s.moment).toBeNull();
    expect(s.where.ride?.next).toBe(1);
    s = step(r, at('07:19'), fix(toward(P.leman, P.guilleminsBus, 150), at('07:19'), { speed: 7 }));
    expect(kindOf(s)).toBe('alight');
    s = step(r, at('07:22:30'), fix(toward(P.leman, P.guilleminsBus, 250), at('07:22:30'), { speed: 5 }));
    expect(s.phase).toMatchObject({ kind: 'ride', leg: 1 });
    expect(kindOf(s)).toBe('alight');
    s = step(r, at('07:23:10'), fix(offset(P.guilleminsBus, 0, 10), at('07:23:10'), { speed: 0.5 }));
    expect(r.mem.alighted?.leg).toBe(1);
    expect(kindOf(s)).not.toBe('alight');
  });

  it('positions trop imprécises (sous terre) ou trop vieilles : tout à l’heure, aucun virage', () => {
    const rt = firstWalkRoute();
    const r = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    step(r, at('07:05'));
    const s = step(r, at('07:06:20'), fix(offset(P.avroy, 0, -165), at('07:06:20'), { accuracy: 120 }));
    expect(kindOf(s)).toBe('leave');
    const r2 = guide(prdTrip(), { walk: { leg: 0, route: rt } });
    step(r2, at('07:04'));
    expect(kindOf(step(r2, at('07:06:30'), fix(offset(P.avroy, 0, -165), at('07:05:20'))))).toBe('leave');
  });

  it('pas parti (règle 1.2.x) : encore au point de départ 3 min après le départ du bus', () => {
    const r = guide(prdTrip());
    expect(step(r, at('07:14:30'), fix(P.avroy, at('07:14:30'))).ended).toBe(false);
    const s = step(r, at('07:15:30'), fix(P.avroy, at('07:15:30')));
    expect(s).toMatchObject({ ended: true, location: 'off', moment: null });
  });

  it('parti attendre à l’arrêt (lancé à 250 m) : un bus sans temps réel en retard ne fait pas « pas parti » ; raté à 10 min', () => {
    const origin = offset(P.gramme, 250, 0);
    const r = guide(prdTrip({ bus6Rt: false }), { origin, startedAt: at('07:00') });
    step(r, at('07:00'), fix(origin, at('07:00')));
    expect(step(r, at('07:08'), fix(P.gramme, at('07:08'))).phase).toEqual({ kind: 'wait', leg: 1 });
    for (const hm of ['07:15:30', '07:18', '07:21']) {
      const s = step(r, at(hm), fix(P.gramme, at(hm)));
      expect(s.ended, hm).toBe(false);
      expect(s.phase, hm).toEqual({ kind: 'wait', leg: 1 });
    }
    // toujours à l'arrêt 10 min après l'heure (sans temps réel) : « Ton bus 6 de 07:12 est parti », nouveau trajet
    const s = step(r, at('07:22:30'), fix(P.gramme, at('07:22:30')));
    expect(s.ended).toBe(false);
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'missed' });
    // revenu au point de lancement : la règle s'applique de nouveau
    const r2 = guide(prdTrip({ bus6Rt: false }), { origin, startedAt: at('07:00') });
    step(r2, at('07:08'), fix(P.gramme, at('07:08')));
    expect(step(r2, at('07:15:30'), fix(origin, at('07:15:30'))).ended).toBe(true);
  });

  it('précision demandée : à bord avant la descente high, sinon medium ; au loin medium', () => {
    const r = guide(prdTrip());
    expect(step(r, at('07:14')).location).toBe('medium');
    expect(step(r, at('07:17')).location).toBe('high');
    expect(step(r, at('07:40')).location).toBe('medium');
    expect(step(r, at('08:23')).location).toBe('high');
  });
});

describe('arrêt dépassé', () => {
  // à l'arrêt Gare Centrale (correspondance), puis dans le bus 71
  const ride71 = (r: ReturnType<typeof guide>) => {
    step(r, at('08:33:30'), fix(P.gareCentrale, at('08:33:30'), { speed: 0 }));
    return step(r, at('08:35'), fix(toward(P.gareCentrale, P.porteNamur, 200), at('08:35'), { speed: 8 }));
  };
  const beyond = (m2: number) => toward(P.porteNamur, P.flagey, 1389 + m2);

  it('plus de 300 m au-delà de Flagey, en s’éloignant, après son heure : « Tu as passé Flagey », nouveau trajet demandé', () => {
    const r = guide(prdTrip());
    ride71(r);
    step(r, at('08:49'), fix(beyond(350), at('08:49')));
    const s = step(r, at('08:49:20'), fix(beyond(450), at('08:49:20')));
    const mo = m(s.moment, 'passed');
    expect(mo).toMatchObject({ id: 'passed:jprd:5', passed: N('Flagey'), leg: 5, until: at('08:52:20') });
    expect(mo.getOff).toEqual({ fr: '', nl: '' });
    expect(mo.arr).toBeUndefined();
    expect(s.replan).toEqual({ from: { lat: beyond(450).lat, lon: beyond(450).lon }, reason: 'passed', at: at('08:49:20') });
  });

  it('pas dépassé : à 250 m, avant l’heure, ou en revenant vers l’arrêt', () => {
    const r = guide(prdTrip());
    ride71(r);
    step(r, at('08:49'), fix(beyond(150), at('08:49')));
    expect(step(r, at('08:49:20'), fix(beyond(250), at('08:49:20'))).moment?.kind).not.toBe('passed');
    const r2 = guide(prdTrip());
    ride71(r2);
    step(r2, at('08:46'), fix(beyond(350), at('08:46')));
    expect(step(r2, at('08:46:20'), fix(beyond(450), at('08:46:20'))).moment?.kind).not.toBe('passed');
    const r3 = guide(prdTrip());
    ride71(r3);
    step(r3, at('08:49'), fix(beyond(600), at('08:49')));
    expect(step(r3, at('08:49:20'), fix(beyond(450), at('08:49:20'))).moment?.kind).not.toBe('passed');
  });

  it('avec les arrêts suivants du véhicule : « Descends à Cimetière d’Ixelles, 08:52 »', () => {
    const r = guide(prdTrip(), { beyond: [{ name: N('Cimetière d’Ixelles'), sched: at('08:52'), est: at('08:52') }] });
    ride71(r);
    step(r, at('08:49'), fix(beyond(350), at('08:49')));
    expect(m(step(r, at('08:49:20'), fix(beyond(450), at('08:49:20'))).moment, 'passed')).toMatchObject({ getOff: N('Cimetière d’Ixelles'), at: at('08:52') });
  });

  it('« Tu as passé » passe devant « Descends », puis le nouveau trajet donne l’arrivée', () => {
    const r = guide(prdTrip());
    ride71(r);
    expect(kindOf(step(r, at('08:47'), fix(toward(P.porteNamur, P.flagey, 1000), at('08:47'), { speed: 7 })))).toBe('alight');
    step(r, at('08:49'), fix(beyond(350), at('08:49')));
    expect(kindOf(step(r, at('08:49:20'), fix(beyond(450), at('08:49:20'))))).toBe('passed');
    const cim = { name: N('Cimetière d’Ixelles'), ...offset(P.flagey, 300, -900), areaId: 'stib:3520' };
    const back = rideLeg({ op: 'stib', mode: 'bus', line: '71', head: 'De Brouckère', stops: [{ p: cim, t: at('08:55') }, { p: S.flagey, t: at('09:00') }] });
    r.j = journeyOf([back, walkLeg(S.flagey, S.etangs, at('09:00'), 6)], 'jre1');
    const s = step(r, at('08:50'), fix(beyond(700), at('08:50')));
    expect(m(s.moment, 'passed')).toMatchObject({ id: 'passed:jprd:5', getOff: N('Cimetière d’Ixelles'), at: at('08:55'), arr: at('09:06') });
    expect(s.replan).toBeUndefined();
    expect(s.journeyId).toBe('jre1');
  });

  it('nouveau trajet cherché depuis la position (il commence par une marche depuis « Ma position ») : jamais « Descends à Ma position »', () => {
    const r = guide(prdTrip());
    ride71(r);
    step(r, at('08:49'), fix(beyond(350), at('08:49')));
    expect(kindOf(step(r, at('08:49:20'), fix(beyond(450), at('08:49:20'))))).toBe('passed');
    // le cœur part de { type: 'here' } : première étape à pied depuis « Ma position » (sans zone)
    const here = { name: N('Ma position', 'Mijn positie'), ...beyond(450) };
    const cim = { name: N('Cimetière d’Ixelles'), ...offset(P.flagey, 300, -900), areaId: 'stib:3520' };
    const back = rideLeg({ op: 'stib', mode: 'bus', line: '71', head: 'De Brouckère', stops: [{ p: cim, t: at('08:55') }, { p: S.flagey, t: at('09:00') }] });
    r.j = journeyOf([walkLeg(here, cim, at('08:51'), 4), back, walkLeg(S.flagey, S.etangs, at('09:00'), 6)], 'jre2');
    const mo = m(step(r, at('08:50'), fix(beyond(700), at('08:50'))).moment, 'passed');
    expect(mo.getOff).toEqual({ fr: '', nl: '' });
    expect(mo.arr).toBe(at('09:06'));
  });
});

describe('véhicule raté', () => {
  it('encore à l’arrêt 2 min après le départ (temps réel) : « Ton bus 6 de 07:12 est parti », recalcul depuis l’arrêt', () => {
    const r = guide(prdTrip());
    step(r, at('07:10'), fix(P.gramme, at('07:10')));
    expect(step(r, at('07:13:50'), fix(P.gramme, at('07:13:50'))).replan).toBeUndefined();
    const s = step(r, at('07:14:30'), fix(P.gramme, at('07:14:30')));
    expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    expect(m(s.moment, 'replan')).toMatchObject({ id: 'replan:jprd:missed:1', reason: 'missed', lost: { vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('07:12') }, until: at('07:15:30') });
    expect(s.replan).toEqual({ from: { lat: P.gramme.lat, lon: P.gramme.lon, areaId: 'tec:LGgram', name: N('Monument Gramme') }, reason: 'missed', at: at('07:14:30') });
  });

  it('sans temps réel : pas avant 10 min (un bus en retard n’est pas « parti »)', () => {
    const r = guide(prdTrip({ bus6Rt: false }));
    step(r, at('07:10'), fix(P.gramme, at('07:10')));
    const s = step(r, at('07:14:30'), fix(P.gramme, at('07:14:30')));
    expect(s.replan).toBeUndefined();
    expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    expect(step(r, at('07:21:50'), fix(P.gramme, at('07:21:50'))).replan).toBeUndefined();
    expect(step(r, at('07:22:10'), fix(P.gramme, at('07:22:10'))).replan?.reason).toBe('missed');
  });

  it('loin de l’arrêt après le départ : pas de « raté » (supposé à bord)', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:14:30'), fix(offset(P.gramme, -500, 0), at('07:14:30')));
    expect(s.replan).toBeUndefined();
    expect(s.phase.kind).toBe('ride');
  });

  it('nouveau trajet adopté : « Nouveau trajet : bus 6 à 07:24 », arrivée 30 min plus tard, puis le guidage le suit', () => {
    const r = guide(prdTrip());
    step(r, at('07:14:30'), fix(P.gramme, at('07:14:30')));
    const b6 = rideLeg({ op: 'tec', mode: 'bus', line: '6', head: 'Gare des Guillemins', stops: [{ p: S.gramme, t: at('07:24') }, { p: S.leman, t: at('07:28') }, { p: S.guilleminsBus, t: at('07:32') }] });
    const ic = rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Ostende', platform: '3', stops: [{ p: S.guillemins, t: at('08:02'), platform: '3' }, { p: S.central, t: at('08:59') }] });
    const b71 = rideLeg({ op: 'stib', mode: 'bus', line: '71', head: 'Delta', stops: [{ p: S.gareCentrale, t: at('09:04') }, { p: S.flagey, t: at('09:18') }] });
    r.j = journeyOf([b6, walkLeg(S.guilleminsBus, S.guillemins, at('07:32'), 3), ic, walkLeg(S.central, S.gareCentrale, at('08:59'), 3), b71, walkLeg(S.flagey, S.etangs, at('09:18'), 6)], 'jnew');
    const s = step(r, at('07:14:40'), fix(P.gramme, at('07:14:40')));
    const mo = m(s.moment, 'replan');
    expect(mo).toMatchObject({ id: 'replan:jprd:missed:1:jnew', reason: 'missed', next: { vehicle: { op: 'tec', mode: 'bus', line: '6' }, depAt: at('07:24') }, arr: at('09:24'), laterMin: 30, until: at('07:15:40') });
    expect(s.replan).toBeUndefined();
    expect(s.journeyId).toBe('jnew');
    expect(s.phase).toEqual({ kind: 'wait', leg: 0 });
    // puis le nouveau trajet : bus de 07:24 dans moins de 15 min, « Monter »
    expect(step(r, at('07:15:39'), fix(P.gramme, at('07:15:39'))).moment?.kind).toBe('replan');
    expect(step(r, at('07:15:40'), fix(P.gramme, at('07:15:40'))).moment?.id).toBe('board:jnew:0:');
  });

  it('aucun autre trajet : « Pas d’autre trajet trouvé » 60 s, plus de demande, le guidage continue', () => {
    const r = guide(prdTrip());
    step(r, at('07:14:30'), fix(P.gramme, at('07:14:30')));
    r.mem = replanNone(r.mem, at('07:14:35'));
    const s = step(r, at('07:14:40'), fix(P.gramme, at('07:14:40')));
    expect(m(s.moment, 'replan')).toMatchObject({ id: 'replan:jprd:missed:1:none', none: true, until: at('07:15:35') });
    expect(s.replan).toBeUndefined();
    const t = step(r, at('07:15:40'), fix(P.gramme, at('07:15:40')));
    expect(t.moment).toBeNull();
    expect(t.replan).toBeUndefined();
    expect(t.ended).toBe(false);
  });
});

describe('temps réel : retards, correspondance, suppression, voie', () => {
  it('un retard qui ne casse rien : aucun message', () => {
    const r = guide(prdTrip({ bus6Delay: 2 }));
    const s = step(r, at('07:15'));
    expect(s.replan).toBeUndefined();
    expect(s.moment).toBeNull();
    expect(s.where.ride?.alightAt).toBe(at('07:22'));
  });

  it('correspondance devenue impossible (bus 6 +9 min) : « Correspondance ratée : IC de 07:30 », recalcul depuis la descente', () => {
    const r = guide(prdTrip({ bus6Delay: 9 }));
    const s = step(r, at('07:25'));
    expect(s.phase).toMatchObject({ kind: 'ride', leg: 1 });
    expect(m(s.moment, 'replan')).toMatchObject({ id: 'replan:jprd:late:3', reason: 'late', lost: { vehicle: { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' }, depAt: at('07:30') } });
    expect(s.replan).toEqual({ from: { lat: P.guilleminsBus.lat, lon: P.guilleminsBus.lon, areaId: 'tec:LGguil', name: N('Gare des Guillemins') }, reason: 'missed', at: at('07:29') });
  });

  it('correspondance impossible connue en attendant le bus : recalcul depuis l’arrêt, maintenant', () => {
    const r = guide(prdTrip({ bus6Delay: 9 }));
    const s = step(r, at('07:15'));
    expect(s.phase).toEqual({ kind: 'wait', leg: 1 });
    expect(s.replan).toEqual({ from: { lat: P.gramme.lat, lon: P.gramme.lon, areaId: 'tec:LGgram', name: N('Monument Gramme') }, reason: 'missed', at: at('07:15') });
  });

  it('correspondance ratée à bord : replanJourney garde le bus 6 ; « Nouveau trajet : IC 08:02 », puis « Descends » du bus 6', () => {
    const old = prdTrip({ bus6Delay: 9 });
    const r = guide(old);
    step(r, at('07:21:20'), fix(toward(P.gramme, P.leman, 150), at('07:21:20'), { speed: 8 }));
    expect(r.mem.boarded?.leg).toBe(1);
    const s = step(r, at('07:22'), fix(toward(P.gramme, P.leman, 400), at('07:22'), { speed: 7 }));
    expect(s.replan).toMatchObject({ reason: 'missed', at: at('07:29'), from: { areaId: 'tec:LGguil' } });
    const ic2 = rideLeg({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: 'Ostende', platform: '3', stops: [{ p: S.guillemins, t: at('08:02'), platform: '3' }, { p: S.central, t: at('08:59') }] });
    const b71 = rideLeg({ op: 'stib', mode: 'bus', line: '71', head: 'Delta', stops: [{ p: S.gareCentrale, t: at('09:04') }, { p: S.flagey, t: at('09:18') }] });
    const fresh = journeyOf([walkLeg(S.guilleminsBus, S.guillemins, at('07:29'), 3), ic2, walkLeg(S.central, S.gareCentrale, at('08:59'), 3), b71, walkLeg(S.flagey, S.etangs, at('09:18'), 6)], 'jfresh');
    const j2 = replanJourney(old, fresh, at('07:22:10'));
    expect(j2.legs.slice(0, 2)).toEqual(old.legs.slice(0, 2));
    expect(j2.legs).toHaveLength(7);
    expect(j2).toMatchObject({ dep: old.dep, leaveAt: old.leaveAt, arr: at('09:24'), transfers: 2 });
    expect(j2.id).not.toBe(old.id);
    r.j = j2;
    const t = step(r, at('07:22:20'), fix(toward(P.gramme, P.leman, 500), at('07:22:20'), { speed: 7 }));
    expect(t.phase).toMatchObject({ kind: 'ride', leg: 1 });
    expect(r.mem.boarded).toEqual({ leg: 1, at: at('07:21:20') });
    expect(m(t.moment, 'replan')).toMatchObject({ reason: 'late', next: { vehicle: { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' }, depAt: at('08:02'), platform: '3' }, arr: at('09:24'), laterMin: 30 });
    expect(t.replan).toBeUndefined();
    expect(t.where.chain.map((x) => `${x.label}:${x.state}`)).toEqual(['à pied:done', 'bus 6:now', 'IC:next', 'bus 71:next']);
    expect(kindOf(step(r, at('07:25:40'), fix(toward(P.leman, P.guilleminsBus, 150), at('07:25:40'), { speed: 7 })))).toBe('alight');
  });

  it('replanJourney : pas dans un véhicule de l’ancien trajet, le nouveau tel quel', () => {
    const old = prdTrip();
    const fresh = journeyOf([BUS6()], 'jx');
    expect(replanJourney(old, fresh, at('07:14:40'))).toBe(fresh);
    const empty = { ...fresh, id: 'jvide', legs: [] };
    expect(replanJourney(old, empty, at('07:14:40'))).toBe(empty);
  });

  it('cause disparue avant le nouveau trajet (temps réel revu) : demande et message retirés', () => {
    const r = guide(prdTrip({ bus6Delay: 9 }));
    expect(step(r, at('07:15')).replan).toBeDefined();
    r.j = prdTrip({ bus6Delay: 2 });
    const s = step(r, at('07:15:20'));
    expect(s.replan).toBeUndefined();
    expect(s.moment).toBeNull();
  });

  it('retard gardé (temps réel coupé) : ne casse pas la correspondance', () => {
    const r = guide(prdTrip({ bus6Delay: 9, bus6RtKept: true }));
    expect(step(r, at('07:15')).replan).toBeUndefined();
  });

  it('IC supprimé : recalcul tout de suite, même en marchant ; jamais « Monter » dans un supprimé', () => {
    const r = guide(prdTrip({ icCancelled: true }));
    const s = step(r, at('07:06'));
    expect(m(s.moment, 'replan')).toMatchObject({ reason: 'cancelled', id: 'replan:jprd:cancelled:3' });
    expect(s.replan).toEqual({ from: { lat: P.gramme.lat, lon: P.gramme.lon, areaId: 'tec:LGgram', name: N('Monument Gramme') }, reason: 'cancelled', at: at('07:06') });
    r.mem = replanNone(r.mem, at('07:06:05'));
    const b = step(r, at('07:23'));
    expect(b.phase).toEqual({ kind: 'wait', leg: 3 });
    expect(b.moment?.kind).not.toBe('board');
  });

  it('voie modifiée avant la gare : « Voie modifiée : IC à 07:30, voie 6 au lieu de 4 », 2 min', () => {
    const r = guide(prdTrip({ icPlatform: '4', icNewPlatform: '6' }));
    const mo = m(step(r, at('07:14')).moment, 'platform');
    expect(mo).toMatchObject({ id: 'platform:jprd:3:6', platform: '6', was: '4', depAt: at('07:30'), vehicle: { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' }, until: at('07:16') });
    expect(kindOf(step(r, at('07:15:59')))).toBe('platform');
    expect(step(r, at('07:16')).moment).toBeNull();
    const b = m(step(r, at('07:23')).moment, 'board');
    expect(b).toMatchObject({ id: 'board:jprd:3:6', platform: '6', platformChanged: true });
    expect(step(r, at('07:23:10')).where.wait).toMatchObject({ platform: '6', platformChanged: true });
  });

  it('voie modifiée pendant « Monter » : nouvel id, « Monter » revient même effacé', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:23'));
    expect(s.moment?.id).toBe('board:jprd:3:3');
    r.mem = dismissMoment(r.mem, s.moment!.id, at('07:23:05'));
    expect(step(r, at('07:24')).moment).toBeNull();
    r.j = prdTrip({ icNewPlatform: '5' });
    const t = m(step(r, at('07:25')).moment, 'board');
    expect(t).toMatchObject({ id: 'board:jprd:3:5', platform: '5', platformChanged: true });
  });

  it('« Monter » avec la nouvelle voie effacé : pas de « Voie modifiée » en plus', () => {
    const r = guide(prdTrip({ icPlatform: '4', icNewPlatform: '6' }));
    const s = step(r, at('07:23'));
    r.mem = dismissMoment(r.mem, s.moment!.id, at('07:23:05'));
    expect(step(r, at('07:23:30')).moment).toBeNull();
  });

  it('quai d’un bus : jamais de « voie » ni de « Voie modifiée »', () => {
    const b6 = { ...BUS6(), platform: 'A', newPlatform: 'B' };
    const j = prdTrip();
    const r = guide(journeyOf([j.legs[0], b6, ...j.legs.slice(2)], 'jquai', at('07:05')));
    expect(step(r, at('07:06')).moment?.kind).toBe('leave');
    const b = m(step(r, at('07:10')).moment, 'board');
    expect(b.platform).toBeUndefined();
    expect(b.platformChanged).toBeUndefined();
    expect(b.id).toBe('board:jquai:1:B');
  });

  it('un seul moment à la fois : « recalcul » passe devant « Monter »', () => {
    const r = guide(prdTrip({ icCancelled: true }));
    const s = step(r, at('07:10'));
    expect(kindOf(s)).toBe('replan');
    expect(kindOf(step(r, at('07:11:01')))).toBe('board');
  });
});

describe('réglage « Me guider pendant un trajet » éteint', () => {
  it('jamais de message ; étape et « où tu en es » justes', () => {
    const r = guide(prdTrip(), { settings: settings(false) });
    const seen = ['07:05', '07:10', '07:16:30', '07:23', '07:36', '08:23', '08:54'].map((t) => step(r, at(t)));
    expect(seen.map((s) => s.moment)).toEqual([null, null, null, null, null, null, null]);
    expect(seen.map((s) => s.phase.kind)).toEqual(['walk', 'wait', 'ride', 'wait', 'ride', 'ride', 'arrived']);
    expect(seen[2].where.ride?.stopsToAlight).toBe(1);
    expect(r.mem.dismissed).toEqual([]);
    expect(r.mem.shown).toEqual({});
  });

  it('aucun recalcul ni chemin demandé, jamais la plus haute précision', () => {
    const r = guide(prdTrip({ icCancelled: true }), { settings: settings(false) });
    const s = step(r, at('07:06'));
    expect(s.replan).toBeUndefined();
    expect(s.needRoute).toBeUndefined();
    expect(s.location).toBe('medium');
    expect(step(r, at('07:17')).location).toBe('medium');
  });

  it('fin 2 min après l’arrivée', () => {
    const r = guide(prdTrip(), { settings: settings(false) });
    expect(step(r, at('08:54')).phase.kind).toBe('arrived');
    expect(step(r, at('08:55:59')).ended).toBe(false);
    expect(step(r, at('08:56')).ended).toBe(true);
  });
});

describe('reprise après suspension (téléphone verrouillé)', () => {
  it('reprise à 07:25 : ni « Partir », ni « Monter » ni « Descends » du bus 6 rejoués ; « Monter » dans l’IC', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    const s = step(r, at('07:25'));
    expect(s.phase).toEqual({ kind: 'wait', leg: 3 });
    expect(s.moment?.id).toBe('board:jprd:3:3');
    expect(r.mem.dismissed).toContain('leave:jprd');
    expect(Object.keys(r.mem.shown).sort()).toEqual(['board:jprd:3:3', 'leave:jprd']);
  });

  it('reprise pendant « Descends » : montré (encore utile)', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    expect(kindOf(step(r, at('07:17')))).toBe('alight');
  });

  it('un moment effacé avant la suspension n’est pas rejoué', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:23'));
    r.mem = dismissMoment(r.mem, s.moment!.id, at('07:23:10'));
    expect(step(r, at('07:27')).moment).toBeNull();
  });

  it('mémoire gardée en JSON : même état', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    step(r, at('07:06'), fix(offset(P.avroy, 0, -60), at('07:06')));
    const kept = JSON.parse(JSON.stringify(r.mem));
    const a = guideStep({ ...(r.input as GuideInput), journey: r.j, now: at('07:10'), fixes: [] }, r.mem);
    const b = guideStep({ ...(r.input as GuideInput), journey: r.j, now: at('07:10'), fixes: [] }, kept);
    expect(b).toEqual(a);
  });
});

describe('contrat du moteur', () => {
  it('pur et déterministe : la mémoire d’entrée ne change pas', () => {
    const r = guide(prdTrip());
    step(r, at('07:05'));
    const frozen = JSON.parse(JSON.stringify(r.mem));
    const deep = (o: unknown): unknown => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(deep);
        Object.freeze(o);
      }
      return o;
    };
    deep(r.mem);
    const input = { ...(r.input as GuideInput), journey: r.j, now: at('07:12:30'), fixes: [fix(P.gramme, at('07:12:20'))] };
    const a = guideStep(input, r.mem);
    const b = guideStep(input, r.mem);
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(r.mem))).toEqual(frozen);
  });

  it('dismissMoment : nouvelle mémoire, idempotent', () => {
    const m0 = newGuideMemory();
    const m1 = dismissMoment(m0, 'leave:j1', 1000);
    expect(m0.dismissed).toEqual([]);
    expect(m1.dismissed).toEqual(['leave:j1']);
    expect(m1.shown['leave:j1']).toBe(1000);
    const m2 = dismissMoment(m1, 'leave:j1', 2000);
    expect(m2.dismissed).toEqual(['leave:j1']);
    expect(m2.shown['leave:j1']).toBe(1000);
  });

  it('mémoire abîmée ou partielle tolérée', () => {
    const s = guideStep({ kind: 'trip', journey: prdTrip(), title: 'Bureau', now: at('07:05'), fixes: [], settings: settings(), startedAt: at('06:30') }, { v: 1 } as never);
    expect(s.state.moment?.kind).toBe('leave');
    expect(s.mem.dismissed).toEqual([]);
  });

  it('réveil : au plus 60 s, au prochain changement s’il vient plus tôt, toujours après maintenant', () => {
    const r = guide(prdTrip());
    expect(step(r, at('07:04:40')).wakeAt).toBe(at('07:05'));
    expect(step(r, at('06:40')).wakeAt).toBe(at('06:41'));
    for (const t of ['07:05', '07:12', '07:16:30', '08:27', '08:54', '08:56']) {
      const s = step(r, at(t));
      expect(s.wakeAt).toBeGreaterThan(at(t));
      expect(s.wakeAt).toBeLessThanOrEqual(at(t) + 60_000);
    }
  });

  it('compte à rebours de « Monter » : réveil à la minute qui change', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:10:20'));
    expect(kindOf(s)).toBe('board');
    expect(s.wakeAt).toBe(at('07:11'));
  });

  it('mémoire bornée : les moments d’autres trajets partent d’abord', () => {
    const big = newGuideMemory();
    for (let i = 0; i < 500; i++) big.shown[`turn:jold:0:${i}:1`] = i;
    big.dismissed = Array.from({ length: 300 }, (_, i) => `turn:jold:0:${i}:1`);
    const out = guideStep({ kind: 'trip', journey: prdTrip(), title: 'Bureau', now: at('07:05'), fixes: [], settings: settings(), startedAt: at('06:30') }, big);
    expect(Object.keys(out.mem.shown)).toEqual(['leave:jprd']);
    expect(out.mem.dismissed).toEqual([]);
    expect(out.state.moment?.id).toBe('leave:jprd');
  });

  it('positions mal formées ou futures ignorées', () => {
    const r = guide(prdTrip());
    const s = step(r, at('07:06'), [{ lat: Number.NaN, lon: 5.5, at: at('07:06') }, fix(offset(P.avroy, 0, -60), at('07:09'))]);
    expect(kindOf(s)).toBe('leave');
  });

  it('IC sans positions des gares : tout à l’heure', () => {
    const r = guide(prdTrip({ noStopPoints: true }));
    step(r, at('07:31'), fix(P.guillemins, at('07:31')));
    expect(step(r, at('08:22:40'), fix(P.nord, at('08:22:40'), { speed: 0 })).moment?.kind).not.toBe('alight');
    expect(kindOf(step(r, at('08:23')))).toBe('alight');
    expect(IC({ noStopPoints: true }).stops?.[1].lat).toBeUndefined();
    expect(BUS6().stops?.[1].lat).toBe(P.leman.lat);
  });
});
