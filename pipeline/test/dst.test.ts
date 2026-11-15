/**
 * 1.2.10 (PRD-1.2.10 § 6, vérification laissée par la 1.2.9) : nuits du changement d'heure, 25/10/2026 (03:00 → 02:00)
 * et 28/03/2027 (02:00 → 03:00). Le pipeline ne fait que du calcul de calendrier (dates de service, heures GTFS en
 * minutes) : aucune heure n'est convertie en instant ici, l'appli applique la règle GTFS « midi moins 12 h »
 * (app/test/core/journeys-verifications.test.ts). Ces tests vérifient qu'aucune date ni aucun passage ne glisse.
 */
import { describe, expect, it } from 'vitest';
import { ServiceCalendar } from '../src/calendar.ts';
import { loadConfig } from '../src/config.ts';
import { addDays, brusselsDate, parseGtfsTime, weekdayIndex } from '../src/dates.ts';

/** Heure de la publication de nuit : cron « 15 1 * * * » (UTC) du workflow nightly.yml. */
const nightly = (date: string) => new Date(`${date}T01:15:00Z`);
const config = (now: Date) => loadConfig(['--out', '/tmp/quai-dst-test'], { QUAI_SOURCES: 'sncb=a.zip' }, now);

describe('changement d’heure : dates de service et heures GTFS', () => {
  it('publication de nuit : journées du jour et du lendemain, sans glissement (02:15 d’hiver, 03:15 d’été)', () => {
    expect(brusselsDate(nightly('2026-10-25'))).toBe('2026-10-25');
    expect(config(nightly('2026-10-25')).dates).toEqual(['2026-10-25', '2026-10-26']);
    expect(brusselsDate(nightly('2027-03-28'))).toBe('2027-03-28');
    expect(config(nightly('2027-03-28')).dates).toEqual(['2027-03-28', '2027-03-29']);
    // la veille au soir, encore à l'heure d'été (23:59 locale) / d'hiver
    expect(brusselsDate(new Date('2026-10-24T21:59:00Z'))).toBe('2026-10-24');
    expect(brusselsDate(new Date('2027-03-27T22:59:00Z'))).toBe('2027-03-27');
  });

  it('jours calendaires : un jour de 25 h ou de 23 h reste un jour (dimanche, colonne sunday)', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2027-03-28', -1)).toBe('2027-03-27');
    expect(weekdayIndex('2026-10-25')).toBe(6);
    expect(weekdayIndex('2027-03-28')).toBe(6);
    const cal = new ServiceCalendar(['2026-10-24', '2026-10-25']);
    cal.addCalendar('dimanche', [false, false, false, false, false, false, true], '20260101', '20261231');
    cal.addCalendar('samedi', [false, false, false, false, false, true, false], '20260101', '20261231');
    expect([cal.mask('samedi'), cal.mask('dimanche')]).toEqual([0b01, 0b10]);
  });

  it('un passage de 02:30 garde ses minutes : 26:30 de la veille et 02:30 du jour restent deux passages distincts', () => {
    expect(parseGtfsTime('26:30:00')).toBe(26 * 60 + 30);
    expect(parseGtfsTime('02:30:00')).toBe(150);
    expect(parseGtfsTime('2:30:00')).toBe(150);
    expect(parseGtfsTime('25:30')).toBe(25 * 60 + 30);
  });
});
