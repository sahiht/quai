import { describe, expect, it } from 'vitest';
import { ServiceCalendar } from '../src/calendar.ts';
import { addDays, brusselsDate, gtfsDate, isIsoDate, parseGtfsTime, weekdayIndex } from '../src/dates.ts';

const WEEKDAYS = [true, true, true, true, true, false, false];
const ALL = [true, true, true, true, true, true, true];
const NONE = [false, false, false, false, false, false, false];

describe('dates', () => {
  it('jour de la semaine (0 = lundi)', () => {
    expect(weekdayIndex('2026-11-09')).toBe(0); // lundi
    expect(weekdayIndex('2026-11-10')).toBe(1); // mardi
    expect(weekdayIndex('2026-11-11')).toBe(2); // mercredi (férié)
    expect(weekdayIndex('2026-11-15')).toBe(6); // dimanche
  });

  it('ajout de jours, y compris aux changements d’heure et de mois', () => {
    expect(addDays('2026-11-10', 1)).toBe('2026-11-11');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('date belge du jour : après minuit à Bruxelles, même si UTC est encore la veille', () => {
    expect(brusselsDate(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10');
    expect(brusselsDate(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
    expect(brusselsDate(new Date('2026-11-10T01:15:00Z'))).toBe('2026-11-10');
  });

  it('validation et format GTFS', () => {
    expect(isIsoDate('2026-11-10')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('20261110')).toBe(false);
    expect(gtfsDate('2026-11-10')).toBe('20261110');
  });

  it('heures GTFS, au-delà de 24:00 et sans zéro initial', () => {
    expect(parseGtfsTime('07:42:00')).toBe(462);
    expect(parseGtfsTime('7:42:00')).toBe(462);
    expect(parseGtfsTime('24:01:00')).toBe(1441);
    expect(parseGtfsTime('25:10:59')).toBe(1510);
    expect(parseGtfsTime(' 08:05:30')).toBe(485);
    expect(parseGtfsTime('08:05')).toBe(485);
    expect(parseGtfsTime('')).toBe(-1);
    expect(parseGtfsTime('8h05')).toBe(-1);
    expect(parseGtfsTime('08:75:00')).toBe(-1);
  });
});

describe('ServiceCalendar', () => {
  const dates = ['2026-11-10', '2026-11-11'];

  it('jour férié du 2026-11-11 : WEEK retiré, HOLI ajouté, DAILY inchangé', () => {
    const c = new ServiceCalendar(dates);
    c.addCalendar('WEEK', WEEKDAYS, '20261101', '20261231');
    c.addCalendar('DAILY', ALL, '20261101', '20261231');
    c.addCalendar('HOLI', NONE, '20261101', '20261231');
    c.addException('WEEK', '20261111', 2);
    c.addException('HOLI', '20261111', 1);
    expect(c.mask('WEEK')).toBe(0b01);
    expect(c.mask('DAILY')).toBe(0b11);
    expect(c.mask('HOLI')).toBe(0b10);
    expect(c.mask('INCONNU')).toBe(0);
    expect(c.activeCount()).toBe(3);
  });

  it('respecte les jours de la semaine et la période de validité', () => {
    const c = new ServiceCalendar(['2026-11-14', '2026-11-15']); // samedi, dimanche
    c.addCalendar('WE', [false, false, false, false, false, true, false], '20261101', '20261231');
    c.addCalendar('OLD', ALL, '20260101', '20261031');
    c.addCalendar('FROM15', ALL, '20261115', '20261231');
    expect(c.mask('WE')).toBe(0b01);
    expect(c.mask('OLD')).toBe(0);
    expect(c.mask('FROM15')).toBe(0b10);
  });

  it('fonctionne avec calendar_dates.txt seul et ignore les autres dates', () => {
    const c = new ServiceCalendar(dates);
    c.addException('S1', '20261110', 1);
    c.addException('S1', '20261201', 1);
    c.addException('S2', '20261111', 1);
    expect(c.mask('S1')).toBe(0b01);
    expect(c.mask('S2')).toBe(0b10);
  });

  it('un retrait l’emporte sur un ajout le même jour, types inconnus ignorés', () => {
    const c = new ServiceCalendar(dates);
    c.addException('X', '20261110', 1);
    c.addException('X', '20261110', 2);
    c.addException('Y', '20261110', 3);
    expect(c.mask('X')).toBe(0);
    expect(c.mask('Y')).toBe(0);
  });
});
