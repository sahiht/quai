/** Textes courts d'un trajet (journal, rapport). */
import type { ONet } from './net';
import type { OTrip } from './search';

export function hm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function shortName(net: ONet | null, id: string): string {
  if (id === 'O' || id === 'D' || !net) return id;
  const i = net.idx.get(id);
  return i === undefined ? id : net.names[i].fr || net.names[i].nl || id;
}

const OPN: Record<string, string> = { stib: 'STIB', delijn: 'De Lijn', tec: 'TEC', sncb: 'SNCB' };

/** « TEC 36 07:49 Côté du Collège → Vallée Bailly 07:51 ; à pied 4 ; IC 08:01 … ». */
export function legsText(net: ONet | null, t: OTrip): string {
  return t.legs
    .map((l) => {
      if (l.kind === 'walk') return `à pied ${l.walk}`;
      const name = l.op === 'sncb' ? `${l.line}` : `${OPN[l.op ?? ''] ?? l.op} ${l.line}`;
      return `${name} ${hm(l.dep)} ${shortName(net, l.from)} → ${shortName(net, l.to)} ${hm(l.arr)}`;
    })
    .join(' ; ');
}

/** « 07:49 → 08:31, 2 ch., marche 4+3 (max 4) ». */
export function tripLine(t: OTrip): string {
  return `${hm(t.dep)} → ${hm(t.arr)}, ${t.transfers} ch., marche ${t.walks.join('+') || '0'} (max ${t.lw})`;
}

/** Lignes empruntées : « TEC 36 + IC + STIB 2 ». */
export function linesOf(t: OTrip): string {
  const r = t.legs.filter((l) => l.kind === 'ride');
  if (!r.length) return 'à pied';
  return r.map((l) => (l.op === 'sncb' ? l.line : `${OPN[l.op ?? ''] ?? l.op} ${l.line}`)).join(' + ');
}
