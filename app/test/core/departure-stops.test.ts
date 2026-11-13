/**
 * 1.2.3 (PRD-1.2.3 § 1, § 2) : tableau complet (board avec `horizonMin`) et arrêts d'un départ (departureStops) du
 * vrai cœur sur les fixtures (createCore). Données réelles : test/core/departure-stops-real.test.ts (QUAI_REAL).
 */
import { describe, expect, it } from 'vitest';
import type { Departure, DepartureStops } from '../../src/core/api';
import { QuaiError } from '../../src/core/errors';
import { trainProgress } from '../../src/core/stopcalls';
import { hhmm } from '../../src/core/util';
import { makeEnv } from './support/env';

const IC_0742 = '88____:007::8863008:8814001:10:852:20261231';
const dep = (d: Departure) => `${d.line} ${hhmm(d.sched)}${d.rt ? (d.delayMin ? `+${d.delayMin}` : '') : '~'}${d.cancelled ? ' supprimé' : ''}`;
const calls = (s: DepartureStops) =>
  s.stops.map((x) => `${hhmm(x.sched)} ${x.name.fr}${x.cancelled ? ' supprimé' : x.rt ? (x.delayMin ? ` +${x.delayMin}` : '') : ' ~'}${x.platform ? ` v${x.platform}` : ''}${x.newPlatform ? `→${x.newPlatform}` : ''}`);

describe('board avec horizonMin : tous les départs de l’horizon', () => {
  it('2 h : tous les départs, dans l’ordre, 40 au plus par défaut, `limit` plafond ; sans horizonMin, comme avant', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:31' });
    const gdn = await core.board('stib:6357F', { horizonMin: 120 });
    expect(gdn.departures).toHaveLength(40);
    expect(gdn.departures.every((d, i) => i === 0 || d.est >= gdn.departures[i - 1].est)).toBe(true);
    const nord = await core.board('delijn:308611', { horizonMin: 120, limit: 40 });
    expect(nord.departures.length).toBe(17);
    expect(nord.departures.every((d) => d.est <= Date.parse('2026-11-10T09:31:00+01:00'))).toBe(true);
    expect((await core.board('delijn:308611', { horizonMin: 120, limit: 5 })).departures).toHaveLength(5);
    expect((await core.board('delijn:308611', { horizonMin: 30 })).departures.map(dep)).toEqual(['232 07:30~', '232 07:45~', '460 07:48~', '270 07:52~', '232 08:00~']);
    expect((await core.board('stib:6357F')).departures).toHaveLength(8);
    expect((await core.board('sncb:8863008', { horizonMin: 120 })).departures.map(dep)).toEqual(['IC 07:42+2', 'IC 08:42~']);
  });

  it('rien dans l’horizon : le prochain départ, même plus tard ; un supprimé reste à sa place', async () => {
    // 04:00 : rien avant 06:00 à Namur (fixtures : premier IC à 07:42)
    const env = makeEnv({ now: '2026-11-10T04:00' });
    expect((await env.core.board('sncb:8863008', { horizonMin: 120 })).departures.map((d) => `${d.line} ${hhmm(d.sched)}`)).toEqual(['IC 07:42']);
    const day = makeEnv({ now: '2026-11-10T07:31' });
    day.server.relay.rt.sncb.trips['88____:007::8863008:8814001:10:952:20261231'] = { cancelled: true, u: [] };
    // l'IC de 08:42 n'a pas encore de temps réel (6 h au plus) : supprimé à son heure
    expect((await day.core.board('sncb:8863008', { horizonMin: 120 })).departures.map(dep)).toEqual(['IC 07:42+2', 'IC 08:42 supprimé']);
  });
});

describe('departureStops : les arrêts d’un départ jusqu’au terminus', () => {
  it('train : voies, retard gare par gare, voie modifiée, arrêt sauté, jusqu’au terminus', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.relay.rt.sncb.trips[IC_0742] = {
      u: [
        [1, '8863008_6', 120, null, 0],
        [5, '8811916_2', null, null, 1],
        [7, '8813003_5', 240, null, 0],
        [8, '8814001_15', 300, null, 0],
      ],
    };
    const [ic] = (await env.core.board('sncb:8863008', { horizonMin: 120 })).departures;
    const s = await env.core.departureStops('sncb:8863008', ic);
    expect(s).toMatchObject({ state: 'ok', op: 'sncb', mode: 'train', line: 'IC', head: { fr: 'Bruxelles-Midi' }, anyPlanned: false });
    expect(calls(s)).toEqual([
      '07:42 Namur +2 v4→6',
      '07:55 Gembloux +2 v1',
      '08:09 Ottignies +2 v2',
      '08:31 Bruxelles-Luxembourg +2 v1',
      '08:35 Bruxelles-Schuman supprimé v2',
      '08:40 Bruxelles-Nord +2 v11',
      '08:46 Bruxelles-Central +4 v3→5',
      '08:52 Bruxelles-Midi +5 v15',
    ]);
    expect(s.stops[0]).toMatchObject({ areaId: 'sncb:8863008', sched: ic.sched, est: ic.est, delayMin: 2 });
    expect(s.stops[4]).toMatchObject({ areaId: 'sncb:8811916', cancelled: true, est: s.stops[4].sched, delayMin: 0 });
    // l'IC suivant : sans temps réel, horaire prévu (« ~ »)
    const next = (await env.core.board('sncb:8863008', { horizonMin: 120 })).departures[1];
    const n = await env.core.departureStops('sncb:8863008', next);
    expect(n.anyPlanned).toBe(true);
    expect(calls(n).slice(0, 2)).toEqual(['08:42 Namur ~ v5', '08:55 Gembloux ~ v1']);
    expect(s.at).toBe(0);
    // 1.2.8 : depuis une gare du parcours, tout le trajet : les gares d'avant à leur heure de départ, puis cette gare
    const lux = (await env.core.board('sncb:8811304', { limit: 1 })).departures[0];
    const fromLux = await env.core.departureStops('sncb:8811304', lux);
    expect(fromLux.at).toBe(3);
    expect(calls(fromLux)).toEqual(calls(s));
    expect(fromLux.stops[3]).toMatchObject({ areaId: 'sncb:8811304', sched: lux.sched, est: lux.est });
    // le départ estimé de chaque gare (l'arrivée au terminus) : Bruxelles-Nord arrive 08:40, repart 08:41 (+2)
    // (Bruxelles-Schuman, supprimé : son heure prévue, 08:35)
    expect(fromLux.stops.map((x) => hhmm(x.leave!))).toEqual(['07:44', '07:57', '08:11', '08:33', '08:35', '08:43', '08:50', '08:57']);
  });

  it('1.2.8 : où en est le train (trainProgress) : gares quittées d’après le temps réel, ● seulement avec lui', async () => {
    const at = (hm: string) => Date.parse(`2026-11-10T${hm}:00+01:00`);
    const env = makeEnv({ now: '2026-11-10T08:00' });
    env.server.relay.rt.sncb.trips[IC_0742] = { u: [[1, '8863008_6', 120, null, 0], [5, '8811916_2', null, null, 1]] };
    const ic = (await env.core.board('sncb:8812005', { horizonMin: 120 })).departures.find((d) => d.line === 'IC' && d.rt)!;
    const s = await env.core.departureStops('sncb:8812005', ic);
    expect(s.at).toBe(5);
    // 08:00 : Namur (07:44) et Gembloux (07:57) quittés ; le train arrive à Ottignies (● : il vient du temps réel)
    expect(trainProgress(s.stops, at('08:00'))).toEqual({ passed: [true, true, false, false, false, false, false, false], vehicle: 2 });
    // à quai à Ottignies (arrivée 08:11, départ 08:11 : rien entre les deux) puis entre Ottignies et Luxembourg
    expect(trainProgress(s.stops, at('08:12')).vehicle).toBe(3);
    // Bruxelles-Schuman est supprimé : de Luxembourg (08:33), le train va à Bruxelles-Nord
    expect(trainProgress(s.stops, at('08:34'))).toEqual({ passed: [true, true, true, true, false, false, false, false], vehicle: 5 });
    // un arrêt supprimé entre la dernière gare quittée et le ● reste à venir : on ne sait pas s'il l'a dépassé
    expect(trainProgress(s.stops, at('08:38')).passed.slice(3, 6)).toEqual([true, false, false]);
    // l'heure prévue d'un arrêt supprimé ne fait pas passer le train : 15 min de retard, il n'a pas quitté A à 08:10
    const synth = [
      { est: at('07:50'), leave: at('07:50'), rt: true },
      { est: at('08:15'), leave: at('08:15'), rt: true },
      { est: at('08:05'), leave: at('08:05'), rt: true, cancelled: true },
      { est: at('08:25'), leave: at('08:25'), rt: true },
    ];
    expect(trainProgress(synth, at('08:10'))).toEqual({ passed: [true, false, false, false], vehicle: 1 });
    // avant son départ et après son terminus : aucun ●
    expect(trainProgress(s.stops, at('07:30')).vehicle).toBe(-1);
    expect(trainProgress(s.stops, at('09:30'))).toEqual({ passed: s.stops.map(() => true), vehicle: -1 });
    // sans temps réel : les gares passées d'après l'horaire, jamais de ●
    const planned = s.stops.map((x) => ({ ...x, rt: false }));
    expect(trainProgress(planned, at('08:00'))).toEqual({ passed: [true, true, false, false, false, false, false, false], vehicle: -1 });
    // un temps réel incohérent (une gare d'avant plus tard que la suivante) ne fait jamais reculer le train
    const odd = s.stops.map((x, i) => (i === 1 ? { ...x, leave: at('08:30') } : x));
    expect(trainProgress(odd, at('08:12')).passed.slice(0, 4)).toEqual([true, true, true, false]);
  });

  it('revue : heures du relais (départ en gare, arrivée au terminus) : un train à l’heure n’a pas de retard, un retard est exact', async () => {
    // Bruxelles-Nord : arrivée 08:40, départ 08:41 ; le relais donne l'heure du départ quand il existe
    const s = (hm: string) => Date.parse(`2026-11-10T${hm}:00+01:00`) / 1000;
    const onTime = makeEnv({ now: '2026-11-10T07:31' });
    onTime.server.relay.rt.sncb.trips[IC_0742] = {
      u: [
        [1, '8863008_4', 0, s('07:42'), 0],
        [6, '8812005_11', 0, s('08:41'), 0],
        [8, '8814001_15', 0, s('08:52'), 0],
      ],
    };
    const [ic] = (await onTime.core.board('sncb:8863008', { limit: 1 })).departures;
    const a = await onTime.core.departureStops('sncb:8863008', ic);
    expect(calls(a)).toEqual([
      '07:42 Namur v4',
      '07:55 Gembloux v1',
      '08:09 Ottignies v2',
      '08:31 Bruxelles-Luxembourg v1',
      '08:35 Bruxelles-Schuman v2',
      '08:40 Bruxelles-Nord v11',
      '08:46 Bruxelles-Central v3',
      '08:52 Bruxelles-Midi v15',
    ]);
    expect(a.stops.every((x) => x.rt && x.delayMin === 0 && x.est === x.sched)).toBe(true);
    // le trajet qui descend à Bruxelles-Nord arrive à 08:40, à l'heure, comme ses arrêts
    const [j] = await onTime.core.trains('sncb:8863008', 'sncb:8812005', Date.parse('2026-11-10T07:31:00+01:00'), 1);
    expect([hhmm(j.legs[0].arr), j.legs[0].stops!.every((x) => x.est === x.sched)]).toEqual(['08:40', true]);

    // retard réel : +3 au départ de Bruxelles-Nord (08:44), propagé ; +4 à l'arrivée au terminus (heure d'arrivée seule)
    const late = makeEnv({ now: '2026-11-10T07:31' });
    late.server.relay.rt.sncb.trips[IC_0742] = {
      u: [
        [6, '8812005_11', 180, s('08:44'), 0],
        [8, '8814001_15', 240, s('08:56'), 0],
      ],
    };
    const [d] = (await late.core.board('sncb:8863008', { limit: 1 })).departures;
    const b = await late.core.departureStops('sncb:8863008', d);
    expect(calls(b).slice(4)).toEqual(['08:35 Bruxelles-Schuman v2', '08:40 Bruxelles-Nord +3 v11', '08:46 Bruxelles-Central +3 v3', '08:52 Bruxelles-Midi +4 v15']);
    expect(b.stops.slice(5).map((x) => hhmm(x.est))).toEqual(['08:43', '08:49', '08:56']);
    const [k] = await late.core.trains('sncb:8863008', 'sncb:8812005', Date.parse('2026-11-10T07:31:00+01:00'), 1);
    expect(hhmm(k.legs[0].arr)).toBe('08:43');
  });

  it('voyage supprimé : chaque arrêt supprimé ; relais en panne : horaire prévu', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    env.server.relay.rt.sncb.trips[IC_0742] = { cancelled: true, u: [] };
    const [ic] = (await env.core.board('sncb:8863008', { limit: 1 })).departures;
    expect(ic.cancelled).toBe(true);
    const s = await env.core.departureStops('sncb:8863008', ic);
    expect(s.stops.every((x) => x.cancelled && x.est === x.sched)).toBe(true);
    const down = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const [d] = (await down.core.board('sncb:8863008', { limit: 1 })).departures;
    const p = await down.core.departureStops('sncb:8863008', d);
    expect(p.anyPlanned).toBe(true);
    expect(p.stops.every((x) => !x.rt && x.est === x.sched && !x.cancelled)).toBe(true);
    expect(p.stops.map((x) => x.name.fr).at(-1)).toBe('Bruxelles-Midi');
  });

  it('tram STIB : temps réel au départ, heures suivantes décalées ; plus loin, horaire prévu', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    const board = (await core.board('stib:6357F', { horizonMin: 60 })).departures;
    const live = board.find((d) => d.line === '3' && d.rt && d.head.fr === 'Churchill')!;
    const s = await core.departureStops('stib:6357F', live);
    expect(s).toMatchObject({ state: 'ok', op: 'stib', mode: 'tram', line: '3', head: { fr: 'Churchill' }, anyPlanned: false });
    expect(calls(s)).toEqual(['12:12 Gare du Nord', '12:14 Rogier', '12:16 De Brouckere', '12:17 Bourse', '12:22 Gare du Midi', '12:37 Churchill']);
    const planned = board.find((d) => d.line === '4' && !d.rt)!;
    const p = await core.departureStops('stib:6357F', planned);
    expect(p.anyPlanned).toBe(true);
    expect(p.stops.map((x) => x.name.fr)).toEqual(['Gare du Nord', 'Rogier', 'De Brouckere', 'Bourse', 'Gare du Midi', 'Stalle']);
    expect(p.stops.every((x) => !x.rt)).toBe(true);
  });

  it('revue : passage STIB limité (destination absente des motifs) : la ligne depuis cet arrêt, coupée à sa destination', async () => {
    const { core } = makeEnv({ now: '2026-11-10T12:10' });
    const t3 = (await core.board('stib:6357F', { horizonMin: 60 })).departures.find((d) => d.line === '3' && d.head.fr === 'Churchill')!;
    // destination sur le parcours : jusqu'à elle
    const midi = await core.departureStops('stib:6357F', { ...t3, head: { fr: 'Gare du Midi', nl: 'Zuidstation' } });
    expect(midi).toMatchObject({ state: 'ok', head: { fr: 'Gare du Midi' } });
    expect(midi.stops.map((x) => x.name.fr)).toEqual(['Gare du Nord', 'Rogier', 'De Brouckere', 'Bourse', 'Gare du Midi']);
    // destination hors du parcours connu : tout le parcours, jamais « n'est plus dans les horaires »
    const albert = await core.departureStops('stib:6357F', { ...t3, head: { fr: 'Albert', nl: 'Albert' } });
    expect(albert.stops.map((x) => x.name.fr).at(-1)).toBe('Churchill');
    // l'autre quai de Gare du Nord : le sens Esplanade
    const other = await core.departureStops('stib:6357F', { ...t3, stopId: '6358', head: { fr: 'Heysel', nl: 'Heizel' } });
    expect(other.stops.map((x) => x.name.fr)).toEqual(['Gare du Nord', 'Esplanade']);
    // ligne absente de cet arrêt : disparu
    expect((await core.departureStops('stib:6357F', { ...t3, line: '4', stopId: '6358', head: { fr: 'Albert', nl: 'Albert' } })).state).toBe('missing');
  });

  it('bus TEC : retard connu au départ, arrêts suivants décalés ; bus De Lijn : horaire prévu et quai', async () => {
    const { core } = makeEnv({ now: '2026-11-10T07:45' });
    const five = (await core.board('tec:N509aaa', { horizonMin: 30 })).departures.find((d) => d.line === '5' && d.rt)!;
    expect(dep(five)).toBe('5 07:50+3');
    const s = await core.departureStops('tec:N509aaa', five);
    expect(calls(s)).toEqual(['07:50 Namur Place Léopold +3', '07:54 Namur Gare +3', '08:05 Bouge Église +3']);
    expect(s.stops.map((x) => hhmm(x.est))).toEqual(['07:53', '07:57', '08:08']);
    const dl = (await core.board('delijn:308611', { horizonMin: 30 })).departures.find((d) => d.line === '270')!;
    expect(calls(await core.departureStops('delijn:308611', dl))).toEqual(['07:52 Bruxelles-Nord ~ v4', '08:27 Gare de Kortenberg ~']);
  });

  it('voyage disparu, autre zone, zone inconnue : missing sans exception ; serveur injoignable : erreur', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const [ic] = (await env.core.board('sncb:8863008', { limit: 1 })).departures;
    expect(await env.core.departureStops('sncb:8863008', { ...ic, tripId: 'disparu' })).toMatchObject({ state: 'missing', stops: [], line: 'IC', anyPlanned: false });
    expect((await env.core.departureStops('sncb:8874005', ic)).state).toBe('missing');
    expect((await env.core.departureStops('sncb:404', ic)).state).toBe('missing');
    const tram = { op: 'stib', mode: 'tram', line: '99', head: { fr: 'Nulle part', nl: 'Nergens' }, sched: ic.sched, est: ic.sched, rt: false, delayMin: 0, cancelled: false } as Departure;
    expect((await env.core.departureStops('stib:6357F', tram)).state).toBe('missing');
    const fresh = makeEnv({ now: '2026-11-10T07:31' });
    const [d] = (await fresh.core.board('tec:Bwategl1', { limit: 1 })).departures;
    fresh.server.networkDown = true;
    // fichier de ligne pas encore lu : l'erreur réseau remonte
    await expect(fresh.core.departureStops('tec:Bwategl1', d)).rejects.toBeInstanceOf(QuaiError);
  });
});
