import { describe, expect, it } from 'vitest';
import type { Departure } from '../../src/core/api';
import {
  atLabel,
  distanceText,
  durationText,
  minutesText,
  nextText,
  platformText,
  stopsCount,
  towards,
  trainCell,
  transfersText,
  withArticle,
} from '../../src/glasses/format';
import { at } from './helpers';

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

describe('mise en forme', () => {
  it('minutes d’attente, signe ~ et SUPPRIMÉ', () => {
    expect(minutesText(dep({}), now, true)).toBe('2 min');
    expect(minutesText(dep({ rt: false }), now, true)).toBe('~2 min');
    expect(minutesText(dep({ rt: false }), now, false)).toBe('2 min');
    expect(minutesText(dep({ cancelled: true }), now, true)).toBe('SUPPRIMÉ');
    expect(minutesText(dep({ est: at(13, 45) }), now, true)).toBe('13:45');
    expect(minutesText(dep({ est: at(12, 9) }), now, true)).toBe('0 min');
  });

  it('colonne des trains : heure, retard, voie', () => {
    const t = dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(12, 22), est: at(12, 22), platform: '9' });
    expect(trainCell(t, true)).toBe('12:22  voie 9');
    expect(trainCell({ ...t, rt: false, sched: at(12, 30), platform: '12' }, true)).toBe('~12:30  voie 12');
    expect(trainCell({ ...t, delayMin: 4, newPlatform: '11' }, true)).toBe('12:22 +4  voie 11 !');
    expect(trainCell({ ...t, cancelled: true, sched: at(12, 34) }, true)).toBe('12:34  SUPPRIMÉ');
  });

  it('prochain départ dans Autour de moi (maquette Visite2)', () => {
    expect(nextText(dep({}), now, true)).toBe('T3 2 min');
    expect(nextText(dep({ op: 'delijn', mode: 'bus', line: '232', rt: false, est: at(12, 14) }), now, true)).toBe('232 ~4 min');
    expect(nextText(dep({ op: 'stib', mode: 'metro', line: '2', est: at(12, 13) }), now, true)).toBe('M2 3 min');
    expect(nextText(dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(12, 22), est: at(12, 22), platform: '9' }), now, true)).toBe('IC 12:22 v.9');
    expect(nextText(undefined, now, true)).toBe('');
  });

  it('distances arrondies à 10 m, durées, correspondances', () => {
    expect(distanceText(82)).toBe('80 m');
    expect(distanceText(164.9)).toBe('160 m');
    expect(distanceText(1234)).toBe('1,2 km');
    expect(durationText(46)).toBe('46 min');
    expect(durationText(64)).toBe('1 h 04');
    expect(transfersText(0)).toBe('direct');
    expect(transfersText(1)).toBe('1 changement');
    expect(transfersText(2)).toBe('2 changements');
    expect(stopsCount(3)).toBe('3 arrêts');
    expect(stopsCount(1)).toBe('1 arrêt');
    expect(stopsCount(0)).toBe('aucun arrêt');
    expect(stopsCount(undefined)).toBe('…');
  });

  it('voies et articles', () => {
    expect(platformText('4', undefined)).toBe('voie 4');
    expect(platformText('4', '6')).toBe('voie 6 !');
    expect(platformText('9', undefined, true)).toBe('v.9');
    expect(platformText(undefined, undefined)).toBe('');
    expect(withArticle('bureau')).toBe('le bureau');
    expect(withArticle('Maison')).toBe('la maison');
    expect(withArticle('Gand-Saint-Pierre')).toBe('Gand-Saint-Pierre');
    expect(towards('bureau')).toBe('Vers le bureau');
    expect(atLabel('bureau')).toBe('au bureau');
    expect(atLabel('Maison')).toBe('à la maison');
    expect(atLabel('école')).toBe('à l’école');
    expect(atLabel('Gand-Saint-Pierre')).toBe('à Gand-Saint-Pierre');
  });
});

describe('lendemain et destinations STIB (polissage)', () => {
  // le 2026-11-10 à 23:30 : un départ du 11/11 est « demain »
  const late = at(23, 30);
  const tomorrow = (hh: number, mm: number) => at(hh, mm) + 86_400_000;

  it('dayWord : aujourd’hui rien, demain « demain », au-delà « le jj/mm »', async () => {
    const { dayWord } = await import('../../src/glasses/format');
    expect(dayWord(at(23, 55), late)).toBe('');
    expect(dayWord(tomorrow(0, 1), late)).toBe('demain');
    expect(dayWord(tomorrow(8, 42) + 86_400_000, late)).toBe('le 12/11');
    expect(dayWord(at(12, 0), late)).toBe('');
  });

  it('prochain départ du lendemain : forme courte sans voie, compte à rebours gardé sous 60 min', () => {
    const ic = dep({ op: 'sncb', mode: 'train', line: 'IC', sched: tomorrow(8, 42), est: tomorrow(8, 42), rt: false, platform: '12' });
    expect(nextText(ic, late, true)).toBe('IC ~demain 08:42');
    expect(nextText(dep({ op: 'delijn', mode: 'bus', line: '232', est: tomorrow(6, 0), rt: false }), late, true)).toBe('232 ~demain 06:00');
    expect(nextText(dep({ op: 'tec', mode: 'bus', line: '4', est: tomorrow(0, 10), rt: false }), late, true)).toBe('4 ~40 min');
    expect(nextText(dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(23, 52), est: at(23, 52), platform: '9' }), late, true)).toBe('IC 23:52 v.9');
  });

  it('destinations STIB sans « (P) », les autres inchangées', async () => {
    const { headText } = await import('../../src/glasses/format');
    expect(headText({ fr: 'Stalle (P)', nl: 'Stalle (P)' }, 'fr', 'stib')).toBe('Stalle');
    expect(headText({ fr: 'Stalle (P)', nl: 'Stalle (P)' }, 'nl', 'stib')).toBe('Stalle');
    expect(headText({ fr: 'Kraainem (P)', nl: 'Kraainem (P)' }, 'fr', 'delijn')).toBe('Kraainem (P)');
    expect(headText({ fr: 'Churchill', nl: 'Churchill' }, 'fr', 'stib')).toBe('Churchill');
  });
});
