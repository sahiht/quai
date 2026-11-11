/**
 * Textes de suggestion du cœur (ligne d'ouverture de l'accueil) : heure du lendemain dite « demain »,
 * destinations STIB sans « (P) » (affichage seulement).
 */
import { describe, expect, it } from 'vitest';
import type { Departure, Leg } from '../../src/core/api';
import { dayWord, departureSummary, NB, rideSummary } from '../../src/core/text';
import { gtfsTime } from '../../src/core/util';

const at = (hh: number, mm: number, day = 0) => gtfsTime('2026-11-10', hh * 60 + mm) + day * 86_400_000;
const late = at(23, 30);
const dep = (p: Partial<Departure>): Departure => ({ op: 'stib', mode: 'tram', line: '4', head: { fr: 'Stalle (P)', nl: 'Stalle (P)' }, sched: at(23, 35), est: at(23, 35), rt: true, delayMin: 0, cancelled: false, ...p });

describe('textes du cœur : lendemain et destinations STIB', () => {
  it('dayWord : « demain » jamais avant 04:00 du lendemain (S6, CA-S6.4)', () => {
    expect(dayWord(at(23, 59), late)).toBe('');
    expect(dayWord(at(0, 1, 1), late)).toBe('');
    expect(dayWord(at(3, 59, 1), late)).toBe('');
    expect(dayWord(at(4, 0, 1), late)).toBe('demain');
    expect(dayWord(at(8, 0, 2), late)).toBe('le 12/11');
    expect(dayWord(at(6, 0, 1), at(0, 20, 1))).toBe('');
  });

  it('départ d’un arrêt : « T4 Stalle 5 min », lendemain au-delà d’une heure « demain ~06:07 » (S6)', () => {
    expect(departureSummary(dep({}), late, 'fr', true)).toBe(`T4 Stalle 5${NB}min`);
    expect(departureSummary(dep({ est: at(6, 7, 1), sched: at(6, 7, 1), rt: false }), late, 'fr', true)).toBe('T4 Stalle demain ~06:07');
    expect(departureSummary(dep({ op: 'sncb', mode: 'train', line: 'IC', sched: at(8, 42, 1), est: at(8, 42, 1), rt: false, platform: '5' }), late, 'fr', true)).toBe('IC demain 08:42, voie 5');
    expect(departureSummary(dep({ op: 'delijn', mode: 'bus', line: '232', head: { fr: 'Kraainem (P)', nl: 'Kraainem (P)' } }), late, 'fr', true)).toBe(`232 Kraainem (P) 5${NB}min`);
  });

  it('trajet : « IC demain 07:42, voie 4 » quand le premier véhicule part demain', () => {
    const leg = { kind: 'ride', mode: 'train', cat: 'IC', line: 'IC', schedDep: at(7, 42, 1), dep: at(7, 42, 1), platform: '4', delayMin: 0, cancelled: false } as Leg;
    expect(rideSummary(leg, late)).toBe('IC demain 07:42, voie 4');
    expect(rideSummary({ ...leg, schedDep: at(23, 52), dep: at(23, 52) }, late)).toBe('IC 23:52, voie 4');
    expect(rideSummary(leg)).toBe('IC 07:42, voie 4'); // sans « maintenant » : inchangé
  });
});
