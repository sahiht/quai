/**
 * Résolution des services (calendar.txt + calendar_dates.txt) pour les dates de service couvertes.
 * mask(service) : bit i = service actif le jour dates[i].
 */
import { gtfsDate, weekdayIndex } from './dates.ts';

const DAY_COLUMNS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export { DAY_COLUMNS };

export class ServiceCalendar {
  readonly dates: string[];
  private readonly gtfs: string[];
  private readonly weekdays: number[];
  private readonly base = new Map<string, number>();
  private readonly added = new Map<string, number>();
  private readonly removed = new Map<string, number>();

  constructor(dates: string[]) {
    this.dates = dates;
    this.gtfs = dates.map(gtfsDate);
    this.weekdays = dates.map(weekdayIndex);
  }

  /** Ligne de calendar.txt : days[0..6] = lundi..dimanche, start/end au format YYYYMMDD. */
  addCalendar(serviceId: string, days: boolean[], start: string, end: string): void {
    let m = this.base.get(serviceId) ?? 0;
    for (let i = 0; i < this.gtfs.length; i++) {
      const d = this.gtfs[i];
      if ((!start || d >= start) && (!end || d <= end) && days[this.weekdays[i]]) m |= 1 << i;
    }
    this.base.set(serviceId, m);
  }

  /** Ligne de calendar_dates.txt : type 1 = ajouté, 2 = retiré. */
  addException(serviceId: string, date: string, type: number): void {
    const i = this.gtfs.indexOf(date);
    if (i < 0) return;
    const map = type === 1 ? this.added : type === 2 ? this.removed : null;
    if (!map) return;
    map.set(serviceId, (map.get(serviceId) ?? 0) | (1 << i));
  }

  /** Masque des jours actifs (0 = inactif sur toutes les dates couvertes). Un retrait l'emporte sur un ajout. */
  mask(serviceId: string): number {
    return ((this.base.get(serviceId) ?? 0) | (this.added.get(serviceId) ?? 0)) & ~(this.removed.get(serviceId) ?? 0);
  }

  /** Nombre de services actifs au moins un jour. */
  activeCount(): number {
    const ids = new Set([...this.base.keys(), ...this.added.keys()]);
    let n = 0;
    for (const id of ids) if (this.mask(id)) n++;
    return n;
  }
}
