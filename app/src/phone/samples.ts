/**
 * Données d'exemple des aperçus (maquettes Config4 et Config5) : midi près de la gare du Nord,
 * et le trajet du matin vers le bureau avec changement de voie. Rendu par les vraies vues des lunettes.
 */
import type { Departure, Journey, NearbyItem, Settings } from '../core/api';
import { gtfsTime } from '../core/util';
import type { AreaSummary, Mode, Names, Op } from '../../../shared/types';
import { nearbyView, stepsView } from '../glasses/views';
import type { GlassesView } from '../glasses/types';

const DAY = '2026-11-10';
const at = (hh: number, mm: number): number => gtfsTime(DAY, hh * 60 + mm);
export const SAMPLE_NOW = at(12, 10);

const area = (id: string, op: Op, fr: string, nl: string, modes: Mode[], lat: number, lon: number): AreaSummary => ({ id, op, n: { fr, nl }, lat, lon, modes, lines: [] });
const dep = (op: Op, mode: Mode, line: string, head: Names, t: number, rt: boolean, platform?: string): Departure => ({ op, mode, line, head, sched: t, est: t, rt, delayMin: 0, cancelled: false, platform });

export const SAMPLE_NEARBY: NearbyItem[] = [
  { area: area('stib:6357F', 'stib', 'Gare du Nord', 'Noordstation', ['tram'], 50.86, 4.36), distanceM: 80, walkMin: 2, next: dep('stib', 'tram', '3', { fr: 'Churchill', nl: 'Churchill' }, at(12, 12), true) },
  { area: area('sncb:8812005', 'sncb', 'Bruxelles-Nord', 'Brussel-Noord', ['train'], 50.8605, 4.3612), distanceM: 150, walkMin: 3, next: dep('sncb', 'train', 'IC', { fr: 'Anvers-Central', nl: 'Antwerpen-Centraal' }, at(12, 22), true, '9') },
  { area: area('delijn:308611', 'delijn', 'Bruxelles-Nord', 'Brussel Noordstation', ['bus'], 50.8618, 4.359), distanceM: 200, walkMin: 4, next: dep('delijn', 'bus', '232', { fr: 'Vilvorde', nl: 'Vilvoorde' }, at(12, 14), false) },
  { area: area('stib:6359', 'stib', 'Rogier', 'Rogier', ['metro', 'tram'], 50.857, 4.359), distanceM: 350, walkMin: 6, next: dep('stib', 'metro', '2', { fr: 'Simonis (Elisabeth)', nl: 'Simonis (Elisabeth)' }, at(12, 13), true) },
];

/** Aperçu « Autour de moi » selon les réglages (rayon, aides, signe ~). */
export function displayPreview(settings: Settings): GlassesView {
  const list = SAMPLE_NEARBY.filter((n) => n.distanceM <= settings.display.radiusM);
  return nearbyView(list, { now: SAMPLE_NOW, settings });
}

const n = (fr: string, nl = fr): Names => ({ fr, nl });

/** Trajet d'exemple vers le bureau ; alerte choisie selon les réglages. */
export function alertsPreview(settings: Settings): GlassesView {
  const now = at(7, 37);
  const a = settings.alerts;
  const text = a.platform
    ? '! Voie modifiée : l’IC part de la voie 6'
    : a.delay && 2 >= a.delayMin
      ? '! IC 07:42 : +2 min'
      : a.leave
        ? 'Partir maintenant : 7 min à pied'
        : undefined;
  const j: Journey = {
    id: 'exemple',
    dep: at(7, 33),
    arr: at(9, 0),
    leaveAt: at(7, 33),
    transfers: 0,
    rt: true,
    alerts: text ? [{ kind: 'platform', text, at: now }] : [],
    legs: [
      { kind: 'walk', from: { name: n('Maison'), lat: 0, lon: 0 }, to: { name: n('Namur', 'Namen'), lat: 0, lon: 0 }, dep: at(7, 35), arr: at(7, 42), schedDep: at(7, 35), schedArr: at(7, 42), walkMin: 7 },
      {
        kind: 'ride',
        from: { name: n('Namur', 'Namen'), lat: 0, lon: 0 },
        to: { name: n('Bruxelles-Central', 'Brussel-Centraal'), lat: 0, lon: 0 },
        dep: at(7, 44),
        arr: at(8, 48),
        schedDep: at(7, 42),
        schedArr: at(8, 46),
        op: 'sncb',
        mode: 'train',
        line: 'IC',
        cat: 'IC',
        head: n('Bruxelles-Midi', 'Brussel-Zuid'),
        platform: '4',
        newPlatform: a.platform ? '6' : undefined,
        rt: true,
        delayMin: 2,
      },
      { kind: 'walk', from: { name: n('Bruxelles-Central'), lat: 0, lon: 0 }, to: { name: n('Bureau'), lat: 0, lon: 0 }, dep: at(8, 48), arr: at(9, 0), schedDep: at(8, 46), schedArr: at(8, 58), walkMin: 12 },
    ],
  };
  return stepsView({ screen: 'steps', journey: j, label: 'bureau', leaveAt0: at(7, 33) }, j, { now, settings });
}
