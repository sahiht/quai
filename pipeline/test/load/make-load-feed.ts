/**
 * Flux GTFS synthétique pour le test de charge : copies décalées des motifs de fixtures/network.json
 * (gabarits STIB, De Lijn, TEC), réunies dans un seul flux, comme un gros réseau régional.
 * Comme dans un vrai flux de plusieurs mois, seule une partie des voyages circule les deux jours couverts.
 */
import { writeFileSync } from 'node:fs';
import { makeZip } from '../../../fixtures/pipeline/zip.ts';
import { expandTrips, loadNetwork } from '../../../fixtures/pipeline/make-gtfs.ts';
import type { FixtureOp } from '../../../fixtures/pipeline/make-gtfs.ts';

/** Services : 4 sur 10 actifs le 2026-11-10 ou le 2026-11-11, les autres hors période. */
const SERVICES = ['DAILY', 'WEEK', 'HOLI', 'SAT', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const ACTIVE = new Set(['DAILY', 'WEEK', 'HOLI']);

export interface LoadFeedInfo { copies: number; stopTimes: number; activeStopTimes: number; trips: number; stops: number; bytes: number }

export function makeLoadFeed(copies: number, path: string): LoadFeedInfo {
  const net = loadNetwork();
  const ops: FixtureOp[] = ['stib', 'delijn', 'tec'];
  const base = ops.map((op) => ({ op, trips: expandTrips(net, op), stops: (net.ops[op] as { stops: { id: string; name: string; lat: number; lon: number }[] }).stops, routes: (net.ops[op] as { routes: { id: string; short: string; type: number }[] }).routes }));
  const stops: string[] = ['stop_id,stop_name,stop_lat,stop_lon'];
  const routes: string[] = ['route_id,route_short_name,route_long_name,route_type'];
  const trips: string[] = ['route_id,service_id,trip_id,trip_headsign,direction_id'];
  const st: string[] = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  let stopTimes = 0;
  let activeStopTimes = 0;
  let nTrips = 0;
  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  for (let c = 0; c < copies; c++) {
    // grille de copies sur la Belgique (environ 3 km entre deux copies)
    const dLat = (c % 40) * 0.03 - 0.6;
    const dLon = Math.floor(c / 40) * 0.045 - 0.8;
    for (const b of base) {
      for (const s of b.stops) stops.push(`${b.op}${s.id}_${c},${s.name} ${c},${(s.lat + dLat).toFixed(5)},${(s.lon + dLon).toFixed(5)}`);
      for (const r of b.routes) routes.push(`${b.op}${r.id}_${c},${r.short},Ligne ${r.short},${r.type}`);
      b.trips.forEach((trip, k) => {
        const service = SERVICES[(c + k) % SERVICES.length];
        const active = ACTIVE.has(service);
        trips.push(`${b.op}${trip.route}_${c},${service},${trip.id}_${c},${trip.head},${k % 2}`);
        nTrips++;
        trip.stops.forEach((s, i) => {
          st.push(`${trip.id}_${c},${t(s.arr)},${t(s.dep)},${b.op}${s.stop}_${c},${i + 1}`);
          stopTimes++;
          if (active) activeStopTimes++;
        });
      });
    }
  }
  const files = [
    { name: 'agency.txt', data: 'agency_id,agency_name,agency_url,agency_timezone\nL,Charge,https://example.org,Europe/Brussels\n' },
    { name: 'calendar.txt', data: 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
      + 'DAILY,1,1,1,1,1,1,1,20261101,20261231\nWEEK,1,1,1,1,1,0,0,20261101,20261231\nHOLI,0,0,0,0,0,0,0,20261101,20261231\nSAT,0,0,0,0,0,1,0,20261101,20261231\n'
      + ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((p, i) => `${p},1,1,1,1,1,1,1,2026${String(i + 1).padStart(2, '0')}01,2026${String(i + 1).padStart(2, '0')}28`).join('\n') + '\n' },
    { name: 'calendar_dates.txt', data: 'service_id,date,exception_type\nWEEK,20261111,2\nHOLI,20261111,1\n' },
    { name: 'stops.txt', data: stops.join('\n') + '\n' },
    { name: 'routes.txt', data: routes.join('\n') + '\n' },
    { name: 'trips.txt', data: trips.join('\n') + '\n' },
    { name: 'stop_times.txt', data: st.join('\n') + '\n' },
  ];
  const zip = makeZip(files, 1);
  writeFileSync(path, zip);
  return { copies, stopTimes, activeStopTimes, trips: nTrips, stops: stops.length - 1, bytes: zip.length };
}
