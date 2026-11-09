import type { Mode } from '../../shared/types.ts';

/** Ordre d'importance des modes (mode principal d'une zone, tri des lignes). */
export const MODE_RANK: Mode[] = ['train', 'metro', 'tram', 'bus'];
export const MODE_BIT: Record<Mode, number> = { train: 1, metro: 2, tram: 4, bus: 8 };

/**
 * route_type GTFS -> mode. Types de base 0 tram, 1 métro, 2 train, 3 bus ; types étendus 100-117 train,
 * 400-405 métro, 700-716 bus, 900-906 tram. Hors liste : rapprochements raisonnables, bus par défaut.
 */
export function modeOf(routeType: number): Mode {
  const t = Number.isFinite(routeType) ? Math.trunc(routeType) : 3;
  if (t === 0) return 'tram';
  if (t === 1) return 'metro';
  if (t === 2) return 'train';
  if (t === 3) return 'bus';
  if (t >= 100 && t <= 117) return 'train';
  if (t >= 400 && t <= 405) return 'metro';
  if (t >= 700 && t <= 716) return 'bus';
  if (t >= 900 && t <= 906) return 'tram';
  if (t === 5) return 'tram'; // tramway à câble
  if (t === 12) return 'metro'; // monorail
  if (t >= 200 && t <= 209) return 'bus'; // autocars
  if (t === 11 || t === 800) return 'bus'; // trolleybus
  if (t === 1400) return 'tram'; // funiculaire
  return 'bus';
}

export function modesFromMask(mask: number): Mode[] {
  return MODE_RANK.filter((m) => mask & MODE_BIT[m]);
}

/** Comparaison « naturelle » des noms de ligne : '2' < '10' < 'IC' < 'S1' < 'S10'. */
export function compareLines(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}
