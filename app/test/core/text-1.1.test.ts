/**
 * Textes 1.1 du cœur (PRD S6, § 6.1) : « imminent » (1.2.9 : avec le temps réel seulement), heure au-delà de 60 min avec
 * « ~ » devant l'heure, « demain » jamais avant 04:00, « Vers … » (article de la 1.0), adresse courte. CA-S6.1, CA-S6.2
 * (cas synthétique), CA-S6.4.
 */
import { describe, expect, it } from 'vitest';
import type { Departure } from '../../src/core/api';
import { departureSummary, NB, shortAddress, timeText, vers, waitText } from '../../src/core/text';
import { gtfsTime } from '../../src/core/util';

const at = (hh: number, mm: number, day = 0, ss = 0) => gtfsTime('2026-11-10', hh * 60 + mm) + day * 86_400_000 + ss * 1000;

describe('S6 : attentes et heures', () => {
  it('CA-S6.1 : « imminent » à moins d’une minute ; minutes avec espace insécable', () => {
    const now = at(12, 10);
    expect(waitText(at(12, 10, 0, 59), now)).toBe('imminent');
    expect(waitText(at(12, 9, 0, 40), now)).toBe('imminent'); // déjà passé de quelques secondes
    expect(waitText(at(12, 11), now)).toBe(`1${NB}min`);
    expect(waitText(at(12, 15), now, true)).toBe(`~5${NB}min`);
    expect(waitText(at(13, 9, 0, 59), now)).toBe(`59${NB}min`);
  });

  it('1.2.9 : « imminent » réservé au temps réel ; horaire prévu à moins d’une minute : « ~1 min »', () => {
    const now = at(12, 10);
    // temps réel : inchangé
    expect(waitText(at(12, 10, 0, 30), now, false, true)).toBe('imminent');
    // horaire prévu signalé (« ~ ») : jamais « imminent », le même « ~ » que les autres horaires prévus
    expect(waitText(at(12, 10, 0, 30), now, true)).toBe(`~1${NB}min`);
    expect(waitText(at(12, 10, 0, 30), now, true, false)).toBe(`~1${NB}min`);
    // horaire prévu sans le « ~ » (réglage) : « 1 min », toujours pas « imminent »
    expect(waitText(at(12, 10, 0, 30), now, false, false)).toBe(`1${NB}min`);
    // horaire prévu à peine passé (les listes le gardent encore un moment) : « ~1 min » aussi
    expect(waitText(at(12, 9, 0, 40), now, true)).toBe(`~1${NB}min`);
    // une minute pleine ou plus : comme avant
    expect(waitText(at(12, 11, 0, 30), now, true)).toBe(`~1${NB}min`);
    expect(waitText(at(12, 12), now, true)).toBe(`~2${NB}min`);
    // résumé d'un départ (suggestions) : d'après le temps réel du départ, pas seulement d'après le « ~ » montré
    const bus = (rt: boolean, est = at(12, 10, 0, 20)): Departure => ({ op: 'delijn', mode: 'bus', line: '232', head: { fr: 'Vilvorde', nl: 'Vilvoorde' }, sched: est, est, rt, delayMin: 0, cancelled: false });
    expect(departureSummary(bus(true), now, 'fr', true)).toBe('232 Vilvorde imminent');
    expect(departureSummary(bus(false), now, 'fr', true)).toBe(`232 Vilvorde ~1${NB}min`);
    expect(departureSummary(bus(false), now, 'fr', false)).toBe(`232 Vilvorde 1${NB}min`);
    expect(departureSummary(bus(true), now, 'fr', false)).toBe('232 Vilvorde imminent');
    // supprimé : toujours d'abord
    expect(departureSummary({ ...bus(false), cancelled: true }, now, 'fr', true)).toBe('232 Vilvorde supprimé');
  });

  it('CA-S6.2 : au-delà de 60 min, une heure, « ~ » devant l’heure (jamais « ~298 min »)', () => {
    const now = at(0, 20, 1);
    expect(waitText(at(5, 18, 1), now, true)).toBe('~05:18');
    expect(waitText(at(13, 10), at(12, 10))).toBe('13:10');
    const m5: Departure = { op: 'stib', mode: 'metro', line: '5', head: { fr: 'Erasme', nl: 'Erasmus' }, sched: at(5, 18, 1), est: at(5, 18, 1), rt: false, delayMin: 0, cancelled: false };
    expect(departureSummary(m5, now, 'fr', true)).toBe('M5 Erasme ~05:18');
    expect(departureSummary(m5, now, 'fr', false)).toBe('M5 Erasme 05:18');
  });

  it('CA-S6.4 et « demain » : pas avant 04:00 du lendemain ; « demain ~06:02 »', () => {
    const late = at(23, 30);
    expect(timeText(at(0, 1, 1), late)).toBe('00:01');
    expect(timeText(at(6, 2, 1), late, true)).toBe('demain ~06:02');
    expect(waitText(at(6, 2, 1), late, true)).toBe('demain ~06:02');
    expect(timeText(at(8, 0, 2), late)).toBe('le 12/11 08:00');
  });
});

describe('§ 6.1 : « Vers … » et adresse courte', () => {
  it('vers() garde les articles de la 1.0', () => {
    expect(vers('bureau')).toBe('Vers le bureau');
    expect(vers('maison')).toBe('Vers la maison');
    expect(vers('école')).toBe('Vers l’école');
    expect(vers('chez Karim')).toBe('Vers chez Karim');
    expect(vers('Gand-Saint-Pierre')).toBe('Vers Gand-Saint-Pierre');
    expect(vers('Veldstraat 1')).toBe('Vers Veldstraat 1');
    expect(vers('')).toBe('Trajet');
  });

  it('shortAddress : avant la première virgule', () => {
    expect(shortAddress('Veldstraat 1, 9000 Gent')).toBe('Veldstraat 1');
    expect(shortAddress('Rue Neuve, 1000 Bruxelles')).toBe('Rue Neuve');
    expect(shortAddress('Namur')).toBe('Namur');
  });
});

describe('1.2.2 : bus de remplacement de la SNCB, « bus SNCB » dans les phrases', () => {
  it('libellés, résumés, départs et alertes ; un train garde sa catégorie et sa voie', async () => {
    const { vehicleLabel, vehicleLabelStart, rideSummary, cancelAlert, delayAlert, platformAlert } = await import('../../src/core/text');
    const now = at(7, 30);
    const bus = { op: 'sncb' as const, mode: 'bus' as const, line: 'BUS', cat: 'BUS' };
    // étape d'un trajet (mode bus), étape lue d'une version antérieure (mode train, catégorie BUS), départ d'une gare
    for (const x of [bus, { ...bus, mode: 'train' as const }, { op: 'sncb' as const, mode: 'bus' as const, line: 'BUS' }]) {
      expect(vehicleLabel(x)).toBe('bus SNCB');
      expect(vehicleLabelStart(x)).toBe('Bus SNCB');
    }
    expect([vehicleLabel({ op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' }), vehicleLabelStart({ op: 'tec', mode: 'bus', line: 'W' })]).toEqual(['IC', 'W']);
    const leg = {
      kind: 'ride' as const,
      ...bus,
      from: { name: { fr: 'Remicourt', nl: 'Remicourt' }, lat: 50.68, lon: 5.32 },
      to: { name: { fr: 'Landen', nl: 'Landen' }, lat: 50.75, lon: 5.08 },
      dep: at(7, 44),
      arr: at(8, 10),
      schedDep: at(7, 42),
      schedArr: at(8, 8),
      delayMin: 2,
      platform: '2',
    };
    expect(rideSummary(leg, now)).toBe('bus SNCB 07:44');
    expect(rideSummary({ ...leg, mode: 'train' }, now)).toBe('bus SNCB 07:44');
    expect(rideSummary({ ...leg, mode: 'train', line: 'IC', cat: 'IC' }, now)).toBe('IC 07:42 +2, voie 2');
    const d: Departure = { op: 'sncb', mode: 'bus', line: 'BUS', head: { fr: 'Landen', nl: 'Landen' }, sched: at(7, 35), est: at(7, 35), rt: false, delayMin: 0, cancelled: false };
    expect(departureSummary(d, now, 'fr', true)).toBe(`bus SNCB Landen ~5${NB}min`);
    expect(cancelAlert(vehicleLabelStart(leg), '07:42')).toBe('! Bus SNCB 07:42 supprimé');
    expect(delayAlert(vehicleLabelStart(leg), '07:42', 6)).toBe(`! Bus SNCB 07:42${NB}: +6${NB}min`);
    expect(platformAlert(vehicleLabel(leg), '3')).toBe(`! Voie modifiée${NB}: le bus SNCB part de la voie 3`);
  });
});
