import { describe, expect, it } from 'vitest';
import type { Departure, FavoriteAnswer, Journey, Leg } from '../../src/core/api';
import {
  MENU_RIGHT_PX,
  atLabel,
  atTitle,
  departText,
  departureRightText,
  boardTitle,
  dayWord,
  distanceText,
  durationText,
  headText,
  leaveText,
  lowerFirst,
  minutesText,
  modesText,
  nextText,
  platformText,
  runningNext,
  shownMessage,
  stopAnswerLine,
  stopsCount,
  towards,
  trainCell,
  transfersText,
  tripAnswerLine,
  tripSecondLine,
  tripShort,
  vehicleName,
} from '../../src/glasses/format';
import { textWidth } from '../../src/glasses/font';
import { at, nb, preset11 } from './helpers';

const dep = (p: Partial<Departure>): Departure => ({
  op: 'stib',
  mode: 'tram',
  line: '3',
  head: { fr: 'Churchill', nl: 'Churchill' },
  sched: at(12, 12),
  est: at(12, 12),
  rt: true,
  delayMin: 0,
  cancelled: false,
  ...p,
});
const now = at(12, 10);
const N = (fr: string, nl = fr) => ({ fr, nl });

/** Trajet du bureau (S1) : marche 7 min, IC 07:42, marche 12 min. */
function bureau(p: { delay?: number; newPlatform?: string; rt?: boolean } = {}): Journey {
  const d = (p.delay ?? 0) * 60_000;
  const walk = (from: string, to: string, dep: number, min: number): Leg => ({ kind: 'walk', from: { name: N(from), lat: 0, lon: 0 }, to: { name: N(to), lat: 0, lon: 0 }, dep, arr: dep + min * 60_000, schedDep: dep, schedArr: dep + min * 60_000, walkMin: min });
  const ride: Leg = {
    kind: 'ride', from: { name: N('Namur'), lat: 50.4685, lon: 4.8625, areaId: 'sncb:8863008' }, to: { name: N('Bruxelles-Central'), lat: 50.8454, lon: 4.3571, areaId: 'sncb:8813003' },
    dep: at(7, 42) + d, arr: at(8, 46) + d, schedDep: at(7, 42), schedArr: at(8, 46), op: 'sncb', mode: 'train', line: 'IC', cat: 'IC', head: N('Bruxelles-Midi'),
    platform: '4', newPlatform: p.newPlatform, rt: p.rt ?? true, delayMin: p.delay ?? 0, cancelled: false,
  };
  const legs = [walk('Ma position', 'Namur', at(7, 35) + d, 7), ride, walk('Bruxelles-Central', 'Bureau', at(8, 46) + d, 12)];
  return { id: 'j1', legs, dep: legs[0].dep, arr: at(8, 58) + d, leaveAt: at(7, 33) + d, transfers: 0, rt: p.rt ?? true, alerts: [], label: 'short' };
}

describe('mise en forme', () => {
  it('minutes d’attente, « imminent », signe ~ et SUPPRIMÉ (S6)', () => {
    expect(nb(minutesText(dep({}), now, true))).toBe('2 min');
    expect(nb(minutesText(dep({ rt: false }), now, true))).toBe('~2 min');
    expect(nb(minutesText(dep({ rt: false }), now, false))).toBe('2 min');
    expect(minutesText(dep({ cancelled: true }), now, true)).toBe('SUPPRIMÉ');
    expect(minutesText(dep({ est: at(13, 45) }), now, true)).toBe('13:45');
    expect(minutesText(dep({ est: at(13, 45), rt: false }), now, true)).toBe('~13:45');
    expect(minutesText(dep({ est: at(12, 9) }), now, true)).toBe('imminent');
    expect(minutesText(dep({ est: at(12, 10, 40) }), now, true)).toBe('imminent');
  });

  it('1.2.9 : « imminent » réservé au temps réel ; horaire prévu à moins d’une minute : « ~1 min » ; SUPPRIMÉ d’abord', () => {
    const soon = at(12, 10, 40);
    // temps réel : inchangé, réglage « ~ » ou non
    expect(minutesText(dep({ est: soon }), now, true)).toBe('imminent');
    expect(minutesText(dep({ est: soon }), now, false)).toBe('imminent');
    // horaire prévu : le même « ~ » que les autres horaires prévus ; sans le « ~ » (accueil, réglage) : « 1 min »
    expect(nb(minutesText(dep({ est: soon, rt: false }), now, true))).toBe('~1 min');
    expect(nb(minutesText(dep({ est: soon, rt: false }), now, false))).toBe('1 min');
    // horaire prévu à peine passé (gardé 30 à 60 s par les listes) : « ~1 min » aussi, jamais « imminent » ni « ~0 min »
    expect(nb(minutesText(dep({ est: at(12, 9, 30), rt: false }), now, true))).toBe('~1 min');
    // une minute pleine : comme avant
    expect(nb(minutesText(dep({ est: at(12, 11, 30), rt: false }), now, true))).toBe('~1 min');
    // supprimé : toujours d'abord, temps réel ou non
    expect(minutesText(dep({ est: soon, rt: false, cancelled: true }), now, true)).toBe('SUPPRIMÉ');
    expect(minutesText(dep({ est: soon, cancelled: true }), now, true)).toBe('SUPPRIMÉ');
    // Autour de moi et arrêts favoris (nextText), l'accueil sans « ~ » (departureRightText)
    expect(nextText(dep({ est: soon }), now, true)).toBe('T3 imminent');
    expect(nb(nextText(dep({ op: 'delijn', mode: 'bus', line: '232', est: soon, rt: false }), now, true))).toBe('232 ~1 min');
    expect(nb(departureRightText(dep({ est: soon, rt: false }), now).text)).toBe('T3 1 min');
    expect(departureRightText(dep({ est: soon }), now).text).toBe('T3 imminent');
  });

  it('1.2.9 : réponse d’un arrêt favori (lunettes et téléphone) : « ~1 min » sur l’horaire prévu, le « ~ » signalé', () => {
    const s = preset11();
    expect(s.display.markPlanned).toBe(true);
    // T3 dans 20 s, T4 dans 50 s
    const board = (rt: boolean): FavoriteAnswer => ({
      favoriteId: 'fav-gdn', kind: 'stop', state: 'ok', updatedAt: now,
      board: {
        area: { id: 'stib:6357F', op: 'stib', n: N('Gare du Nord'), lat: 0, lon: 0, modes: ['tram'], lines: ['3', '4'] },
        departures: [dep({ sched: at(12, 10, 20), est: at(12, 10, 20), rt }), dep({ line: '4', head: N('Stalle'), sched: at(12, 10, 50), est: at(12, 10, 50), rt })],
        anyPlanned: !rt, rtErrors: [], updatedAt: now,
      },
    });
    const planned = stopAnswerLine(board(false), now, s);
    expect([nb(planned.right), nb(planned.second ?? ''), planned.planned]).toEqual(['T3 ~1 min', 'vers Churchill, puis T4 Stalle ~1 min', true]);
    const live = stopAnswerLine(board(true), now, s);
    expect([live.right, nb(live.second ?? ''), live.planned]).toEqual(['T3 imminent', 'vers Churchill, puis T4 Stalle imminent', false]);
  });

  it('colonne des trains : heure, retard, voie', () => {
    const t = dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(12, 22), est: at(12, 22), platform: '9' });
    expect(trainCell(t, true)).toBe('12:22  voie 9');
    expect(trainCell({ ...t, rt: false, sched: at(12, 30), platform: '12' }, true)).toBe('~12:30  voie 12');
    expect(nb(trainCell({ ...t, delayMin: 4, newPlatform: '11' }, true))).toBe('12:22 +4  voie 11 !');
    expect(trainCell({ ...t, cancelled: true, sched: at(12, 34) }, true)).toBe('12:34  SUPPRIMÉ');
  });

  it('prochain départ dans Autour de moi et sur un arrêt favori (format 1.0)', () => {
    expect(nb(nextText(dep({}), now, true))).toBe('T3 2 min');
    expect(nb(nextText(dep({ op: 'delijn', mode: 'bus', line: '232', rt: false, est: at(12, 14) }), now, true))).toBe('232 ~4 min');
    expect(nb(nextText(dep({ op: 'stib', mode: 'metro', line: '2', est: at(12, 13) }), now, true))).toBe('M2 3 min');
    expect(nextText(dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(12, 22), est: at(12, 22), platform: '9' }), now, true)).toBe('IC 12:22 v.9');
    expect(nb(nextText(dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(7, 42), est: at(7, 44), delayMin: 2, platform: '4', newPlatform: '6' }), at(7, 31), true))).toBe('IC 07:42 +2 v.6 !');
    expect(nextText(dep({ est: at(12, 10, 30) }), now, true)).toBe('T3 imminent');
    expect(nextText(undefined, now, true)).toBe('');
  });

  it('distances, durées, correspondances (espace insécable avant l’unité)', () => {
    expect(distanceText(82)).toBe('80 m');
    expect(nb(distanceText(164.9))).toBe('160 m');
    expect(nb(distanceText(1234))).toBe('1,2 km');
    expect(nb(durationText(46))).toBe('46 min');
    expect(nb(durationText(64))).toBe('1 h 04');
    expect(transfersText(0)).toBe('direct');
    expect(transfersText(1)).toBe('1 changement');
    expect(transfersText(2)).toBe('2 changements');
    expect(stopsCount(3)).toBe('3 arrêts');
    expect(stopsCount(1)).toBe('1 arrêt');
    expect(stopsCount(0)).toBe('aucun arrêt');
    expect(stopsCount(undefined)).toBe('…');
  });

  it('voies, véhicules, destinations (vers() du cœur)', () => {
    expect(platformText('4', undefined)).toBe('voie 4');
    expect(nb(platformText('4', '6'))).toBe('voie 6 !');
    expect(platformText('9', undefined, true)).toBe('v.9');
    expect(platformText(undefined, undefined)).toBe('');
    expect(vehicleName({ mode: 'bus', line: '232' })).toBe('Bus 232');
    expect(vehicleName({ mode: 'bus', line: 'W' })).toBe('Bus W');
    expect(vehicleName({ mode: 'tram', line: '4' })).toBe('T4');
    expect(vehicleName({ mode: 'metro', line: '2' })).toBe('M2');
    expect(vehicleName({ mode: 'train', line: 'IC', cat: 'IC' })).toBe('IC');
    expect(towards('bureau')).toBe('Vers le bureau');
    expect(towards('maison')).toBe('Vers la maison');
    expect(towards('Gand-Saint-Pierre')).toBe('Vers Gand-Saint-Pierre');
    expect(towards('Veldstraat 1')).toBe('Vers Veldstraat 1');
    expect(atLabel('bureau')).toBe('au bureau');
    expect(atLabel('maison')).toBe('à la maison');
    expect(atLabel('école')).toBe('à l’école');
    expect(atLabel('Gand-Saint-Pierre')).toBe('à Gand-Saint-Pierre');
    expect(atTitle('Vers chez Karim')).toBe('chez Karim');
    expect(atTitle('Vers Veldstraat 1')).toBe('à Veldstraat 1');
    expect(lowerFirst('Vers le bureau')).toBe('vers le bureau');
  });

  it('titre des départs : modes d’une zone fusionnée (M8.3)', () => {
    expect(modesText(['tram'])).toBe('tram');
    expect(modesText(['bus', 'tram'])).toBe('tram et bus');
    expect(modesText(['bus', 'metro', 'tram'])).toBe('métro, tram et bus');
    expect(boardTitle({ n: N('Gare du Nord'), op: 'stib', modes: ['tram', 'bus'] }, 'fr')).toBe('Gare du Nord, tram et bus (STIB)');
    expect(boardTitle({ n: N('Rogier'), op: 'stib', modes: ['metro', 'tram'] }, 'fr')).toBe('Rogier, métro et tram (STIB)');
  });
});

describe('favoris « réponse directe » (L1)', () => {
  const s = preset11();

  it('quand partir : dans {n} min (1 à 15), maintenant, à {HH:MM}, demain {HH:MM}', () => {
    expect(nb(leaveText(at(7, 33), at(7, 31)))).toBe('partir dans 2 min');
    expect(nb(leaveText(at(7, 46), at(7, 31)))).toBe('partir dans 15 min');
    expect(leaveText(at(7, 47), at(7, 31))).toBe('partir à 07:47');
    expect(leaveText(at(7, 31, 40), at(7, 31))).toBe('partir maintenant');
    expect(leaveText(at(7, 30), at(7, 31))).toBe('partir maintenant');
    expect(leaveText(at(6, 20) + 86_400_000, at(23, 50))).toBe('partir demain 06:20');
    // « demain » jamais avant 04:00 (S6)
    expect(leaveText(at(0, 20) + 86_400_000, at(23, 50))).toBe('partir à 00:20');
  });

  it('2e ligne d’un trajet favori : exemples du PRD, et raccourcie si trop longue (§ 6.0)', () => {
    expect(nb(tripSecondLine(bureau({ rt: false }), at(7, 31), true).text)).toBe('IC à ~07:42, voie 4, direct, arrivée 08:58');
    expect(nb(tripSecondLine(bureau({ delay: 2, newPlatform: '6' }), at(7, 31), true).text)).toBe('IC à 07:42 (+2 min), voie 6 !, direct, arrivée 09:00');
    // trop long : sans « direct, », puis « v. », puis « … »
    expect(nb(tripSecondLine(bureau({ delay: 2, newPlatform: '6' }), at(7, 31), true, 400).text)).toBe('IC à 07:42 (+2 min), voie 6 !, arrivée 09:00');
    expect(nb(tripSecondLine(bureau({ delay: 2, newPlatform: '6' }), at(7, 31), true, 345).text)).toBe('IC à 07:42 (+2 min), v.6 !, arrivée 09:00');
    const cut = tripSecondLine(bureau({ delay: 2, newPlatform: '6' }), at(7, 31), true, 200).text;
    expect(cut.endsWith('…')).toBe(true);
    expect(textWidth(cut)).toBeLessThanOrEqual(200);
  });

  it('réponse d’un trajet favori selon son état', () => {
    const ok = (j: Journey, extra: Partial<FavoriteAnswer> = {}): FavoriteAnswer => ({ favoriteId: 'fav-bureau', kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: at(7, 31), ...extra });
    const l = tripAnswerLine(ok(bureau({ rt: false })), at(7, 31), s);
    expect([nb(l.right), nb(l.second ?? '')]).toEqual(['partir dans 2 min', 'IC à ~07:42, voie 4, direct, arrivée 08:58']);
    expect(l.planned).toBe(true);
    expect(tripAnswerLine(undefined, at(7, 31), s)).toEqual({ right: '…', planned: false, two: true });
    expect(tripAnswerLine({ favoriteId: 'x', kind: 'trip', state: 'here', updatedAt: 0 }, at(7, 31), s)).toEqual({ right: 'tu y es', planned: false });
    expect(tripAnswerLine({ favoriteId: 'x', kind: 'trip', state: 'none', updatedAt: 0 }, at(7, 31), s).right).toBe('aucun trajet');
    expect(tripAnswerLine({ favoriteId: 'x', kind: 'trip', state: 'noPosition', updatedAt: 0 }, at(7, 31), s).right).toBe('sans position');
    // réponse ancienne : le train est parti, on attend la nouvelle réponse
    expect(tripAnswerLine(ok(bureau()), at(7, 40), s).right).toBe('…');
    // gare de départ hors de portée à pied
    const train = bureau().legs[1];
    const station: Journey = { id: 'g', legs: [{ ...train, from: { ...train.from, name: N('Bruxelles-Central') }, schedDep: at(14, 10), dep: at(14, 10), arr: at(14, 39) }], dep: at(14, 10), arr: at(14, 39), leaveAt: at(14, 8), transfers: 0, rt: true, alerts: [] };
    const fs = tripAnswerLine(ok(station, { fromStation: true }), at(12, 10), s);
    expect([fs.right, fs.second]).toEqual(['départ 14:10', 'IC voie 4 à Bruxelles-Central, arrivée 14:39']);
    // à pied
    const walk: Journey = { id: 'w', legs: [bureau().legs[0]], dep: at(23, 46), arr: at(23, 55), leaveAt: at(23, 46), transfers: 0, rt: true, alerts: [] };
    const w = tripAnswerLine(ok(walk), at(23, 46), s);
    expect([nb(w.right), w.second]).toEqual(['à pied 9 min', 'à pied, arrivée 23:55']);
  });

  it('« départ … » d’un favori de gare à gare : sans « ~ », puis sans le retard, avant de couper (revue)', () => {
    const late = at(23, 30);
    const tomorrow = at(6, 15) + 86_400_000;
    expect(textWidth('départ demain ~06:15')).toBeGreaterThan(MENU_RIGHT_PX);
    expect(departText(tomorrow, late, true, '')).toBe('départ demain 06:15');
    expect(nb(departText(tomorrow, late, false, ' (+5\u00a0min)'))).toBe('départ demain 06:15');
    expect(nb(departText(at(14, 10), at(12, 10), false, ' (+3\u00a0min)'))).toBe('départ 14:10 (+3 min)');
    expect(departText(at(14, 10), at(12, 10), true, '')).toBe('départ ~14:10');
    for (const t of [departText(tomorrow, late, true, ' (+12\u00a0min)'), departText(at(23, 58), late, true, ' (+12\u00a0min)')]) {
      expect(textWidth(t)).toBeLessThanOrEqual(MENU_RIGHT_PX);
      expect(t.endsWith('…')).toBe(false);
    }
    // dans la réponse : le « ~ » retiré n'appelle plus la note
    const train = bureau({ rt: false }).legs[1];
    const station: Journey = { id: 'g', legs: [{ ...train, schedDep: tomorrow, dep: tomorrow, arr: tomorrow + 29 * 60_000 }], dep: tomorrow, arr: tomorrow + 29 * 60_000, leaveAt: tomorrow, transfers: 0, rt: false, alerts: [] };
    const l = tripAnswerLine({ favoriteId: 'fav-gand', kind: 'trip', state: 'ok', fromStation: true, plan: { journeys: [station] }, updatedAt: late }, late, s);
    expect([l.right, l.planned]).toEqual(['départ demain 06:15', false]);
  });

  it('réponse d’un arrêt favori : prochain départ et « vers …, puis … »', () => {
    const board = (departures: Departure[]): FavoriteAnswer => ({
      favoriteId: 'fav-gdn', kind: 'stop', state: departures.length ? 'ok' : 'none', updatedAt: now,
      board: { area: { id: 'stib:6357F', op: 'stib', n: N('Gare du Nord'), lat: 0, lon: 0, modes: ['tram'], lines: ['3', '4'] }, departures, anyPlanned: false, rtErrors: [], updatedAt: now },
    });
    const t = stopAnswerLine(board([dep({}), dep({ line: '4', head: N('Stalle (P)'), est: at(12, 15), sched: at(12, 15) })]), now, s);
    expect([nb(t.right), nb(t.second ?? '')]).toEqual(['T3 2 min', 'vers Churchill, puis T4 Stalle 5 min']);
    const ic = (h: number, m: number, rt: boolean) => dep({ op: 'sncb', mode: 'train', line: 'IC', head: N('Bruxelles-Midi'), sched: at(h, m), est: at(h, m), rt, platform: '4' });
    const tr = stopAnswerLine(board([ic(7, 42, false), ic(8, 42, false)]), at(7, 31), s);
    expect([tr.right, tr.second]).toEqual(['IC ~07:42 v.4', 'vers Bruxelles-Midi, puis ~08:42']);
    expect(tr.planned).toBe(true);
    expect(stopAnswerLine(board([]), now, s).second).toBe('aucun départ dans les prochaines heures');
    expect(nb(stopAnswerLine({ favoriteId: 'x', kind: 'stop', state: 'missing', updatedAt: 0 }, now, s).second ?? '')).toBe('introuvable : modifie-le sur le téléphone');
    expect(stopAnswerLine(board([dep({ last: true })]), now, s).tail).toBe(', dernier');
  });

  it('trajet en cours : étape suivante, messages', () => {
    const j = bureau({ delay: 2, newPlatform: '6' });
    // 1.2.2 (REVUE-USAGE n° 8) : comme sur les départs de sa gare, heure prévue, retard, voie modifiée « ! »
    expect(nb(runningNext(j, at(7, 36)))).toBe('IC 07:42 +2 voie 6 !');
    expect(runningNext(j, at(8, 5))).toBe('descente 08:48');
    expect(runningNext(j, at(8, 52))).toBe('arrivée 09:00');
    const cancelled = { ...j, legs: j.legs.map((l) => (l.kind === 'ride' ? { ...l, cancelled: true } : l)) };
    expect(runningNext(cancelled, at(7, 36))).toBe('IC 07:42 SUPPRIMÉ');
    expect(tripShort(j, at(7, 31))).toBe('IC 07:42');
    expect(nb(shownMessage(j, at(7, 31)))).toBe('Affiché dans les lunettes : IC 07:42, voie 6.');
    const walk: Journey = { ...j, legs: [j.legs[0]], arr: j.legs[0].arr };
    expect(nb(shownMessage(walk, at(7, 31)))).toBe('Affiché dans les lunettes : à pied, 7 min.');
  });
});

describe('lendemain et destinations STIB', () => {
  // le 2026-11-10 à 23:30 : un départ du 11/11 est « demain » à partir de 04:00 (S6)
  const late = at(23, 30);
  const tomorrow = (hh: number, mm: number) => at(hh, mm) + 86_400_000;

  it('dayWord : « demain » jamais avant 04:00, « le jj/mm » au-delà', () => {
    expect(dayWord(at(23, 55), late)).toBe('');
    expect(dayWord(tomorrow(0, 1), late)).toBe('');
    expect(dayWord(tomorrow(6, 2), late)).toBe('demain');
    expect(dayWord(tomorrow(8, 42) + 86_400_000, late)).toBe('le 12/11');
    expect(dayWord(at(12, 0), late)).toBe('');
  });

  it('prochain départ du lendemain : forme courte sans voie, compte à rebours gardé sous 60 min', () => {
    const ic = dep({ op: 'sncb', mode: 'train', line: 'IC', sched: tomorrow(8, 42), est: tomorrow(8, 42), rt: false, platform: '12' });
    expect(nextText(ic, late, true)).toBe('IC ~demain 08:42');
    expect(nextText(dep({ op: 'delijn', mode: 'bus', line: '232', est: tomorrow(6, 0), rt: false }), late, true)).toBe('232 ~demain 06:00');
    expect(nb(nextText(dep({ op: 'tec', mode: 'bus', line: '4', est: tomorrow(0, 10), rt: false }), late, true))).toBe('4 ~40 min');
    // CA-S6.4 : un train à 00:01 s'affiche sans « demain »
    expect(nextText(dep({ op: 'sncb', mode: 'train', line: 'IC', sched: tomorrow(0, 1), est: tomorrow(0, 1), platform: '9' }), late, true)).toBe('IC 00:01 v.9');
  });

  it('destinations STIB sans « (P) », les autres inchangées', () => {
    expect(headText({ fr: 'Stalle (P)', nl: 'Stalle (P)' }, 'fr', 'stib')).toBe('Stalle');
    expect(headText({ fr: 'Stalle (P)', nl: 'Stalle (P)' }, 'nl', 'stib')).toBe('Stalle');
    expect(headText({ fr: 'Kraainem (P)', nl: 'Kraainem (P)' }, 'fr', 'delijn')).toBe('Kraainem (P)');
    expect(headText({ fr: 'Churchill', nl: 'Churchill' }, 'fr', 'stib')).toBe('Churchill');
  });
});
