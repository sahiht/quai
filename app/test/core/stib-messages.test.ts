/**
 * Détails du temps réel STIB vus dans les vraies réponses WaitingTimes (version 1.0.1) :
 * « Temps théorique » (horaire prévu), « Ne pas embarquer » (véhicule qui termine ici), « Dernier passage »,
 * destinations vides (complétées par les horaires statiques).
 */
import { describe, expect, it } from 'vitest';
import type { Board, Departure, Settings } from '../../src/core/api';
import { DEFAULT_SETTINGS } from '../../src/core/api';
import { patternForLine } from '../../src/core/boards';
import { parseStib, stibMessageKind } from '../../src/core/realtime';
import { hhmm, lineLabel, minutesUntil } from '../../src/core/util';
import { prepareArea } from '../../src/core/areas';
import type { AreaFile, Meta } from '../../../shared/types';
import { layoutPage } from '../../src/glasses/layout';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import { geometry } from '../../src/glasses/layout';
import { boardView, nearbyView } from '../../src/glasses/views';
import { rideDetail } from '../../src/phone/screens/search';
import { makeEnv } from './support/env';
import { at, CORE_DATA_DIR, readJson } from './support/network';
import { join } from 'node:path';

const NOW = '2026-11-10T12:10';
const T = (hm: string) => `2026-11-10T${hm}:00+01:00`;
const EMPTY = { fr: '', nl: '' };
const fmt = (b: Board, now: number) =>
  b.departures.map((d: Departure) => `${lineLabel(d.mode, d.line)} ${d.head.fr} ${d.rt ? '' : '~'}${minutesUntil(d.est, now)} min${d.last ? ' (dernier)' : ''}`);

const settings = (): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), onboarded: true });
/** Lignes affichées dans les lunettes pour une vue (mêmes conteneurs que l'appareil). */
const glassesLines = (v: ReturnType<typeof boardView>) => {
  const g = geometry(v);
  return layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, g.capacity)).lines.map((l) => l.replace(/ /g, ' '));
};

describe('mentions de service STIB (français, néerlandais, anglais)', () => {
  it('reconnaît « Temps théorique », « Ne pas embarquer », « Dernier passage » sans casse ni accents', () => {
    expect(stibMessageKind('Temps théorique')).toEqual({ planned: true, last: false, noBoarding: false });
    expect(stibMessageKind('TEMPS THEORIQUE')).toMatchObject({ planned: true });
    expect(stibMessageKind('Theoretische tijd')).toMatchObject({ planned: true });
    expect(stibMessageKind('Theoretical time')).toMatchObject({ planned: true });
    expect(stibMessageKind('Ne pas embarquer')).toEqual({ planned: false, last: false, noBoarding: true });
    expect(stibMessageKind('NIET INSTAPPEN')).toMatchObject({ noBoarding: true });
    expect(stibMessageKind('Do not board')).toMatchObject({ noBoarding: true });
    expect(stibMessageKind('Dernier passage')).toEqual({ planned: false, last: true, noBoarding: false });
    expect(stibMessageKind('DERNIER DEPART')).toMatchObject({ last: true });
    expect(stibMessageKind('Laatste doorgang')).toMatchObject({ last: true });
    expect(stibMessageKind('Last departure')).toMatchObject({ last: true });
    expect(stibMessageKind('Travaux : arrêt Botanique non desservi')).toBeNull();
    expect(stibMessageKind('')).toBeNull();
    expect(stibMessageKind(undefined)).toBeNull();
  });

  it('/api/stib : les mentions deviennent des drapeaux, jamais un message affiché ; passages bruts séparés par message', () => {
    const now = at('2026-11-10T12:10');
    const m = parseStib(
      {
        fetchedAt: '',
        points: {
          '6357': [
            { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:30')], msg: 'Temps théorique' },
            { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:40')], msg: 'Dernier passage' },
            { line: '4', dest: EMPTY, times: [T('12:15')], msg: 'Ne pas embarquer' },
            { line: '2', dest: { fr: 'GARE DU MIDI', nl: 'ZUIDSTATION' }, times: [T('12:14')], msg: 'Travaux' },
            {
              line: '7',
              dest: { fr: 'HEYSEL', nl: 'HEIZEL' },
              times: [
                { expectedArrivalTime: T('12:21') },
                { expectedArrivalTime: T('12:29'), message: { fr: 'Temps théorique', nl: 'Theoretische tijd' } },
              ],
            },
          ],
        },
      },
      now,
    );
    expect(m.get('6357')).toEqual([
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [at('2026-11-10T12:30')], planned: true },
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [at('2026-11-10T12:40')], last: true },
      { line: '4', dest: EMPTY, times: [at('2026-11-10T12:15')], noBoarding: true },
      { line: '2', dest: { fr: 'GARE DU MIDI', nl: 'ZUIDSTATION' }, times: [at('2026-11-10T12:14')], msg: 'Travaux' },
      { line: '7', dest: { fr: 'HEYSEL', nl: 'HEIZEL' }, times: [at('2026-11-10T12:21')] },
      { line: '7', dest: { fr: 'HEYSEL', nl: 'HEIZEL' }, times: [at('2026-11-10T12:29')], planned: true },
    ]);
  });
});

describe('tableaux STIB : mentions de service', () => {
  it('« Temps théorique » : horaire prévu (~), sans ligne d’alerte, et il remplace le départ statique du même motif', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6357'] = [
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')] },
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:21')], msg: 'Temps théorique' },
    ];
    const b = await env.core.board('stib:6357F', { limit: 4, filter: [{ line: '3', head: 'churchill' }] });
    expect(fmt(b, env.clock.t)).toEqual(['T3 Churchill 2 min', 'T3 Churchill ~11 min', 'T3 Churchill ~18 min', 'T3 Churchill ~26 min']);
    expect(b.departures.every((d) => d.msg === undefined)).toBe(true);
    expect(b.anyPlanned).toBe(true);
    const v = boardView(b, { now: env.clock.t, settings: settings() }, { kept: false });
    expect(v.top).toBeUndefined();
    expect(glassesLines(v)).toContain('T3   Churchill   ~11 min');
    expect(v.note).toBe('~ horaire prévu, sans temps réel');
  });

  it('« Ne pas embarquer » : le passage disparaît des tableaux et des prochains départs, les horaires prévus restent', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6357'] = [{ line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: [T('12:11')], msg: 'Ne pas embarquer' }];
    const b = await env.core.board('stib:6357F', { limit: 3, filter: [{ line: '4', head: 'stalle p' }] });
    // 12:11 (« Ne pas embarquer ») absent ; les départs prévus 12:15, 12:23, 12:31 restent (~)
    expect(fmt(b, env.clock.t)).toEqual(['T4 Stalle (P) ~5 min', 'T4 Stalle (P) ~13 min', 'T4 Stalle (P) ~21 min']);
    const near = await env.core.nearby(50.86, 4.359, 100);
    const gdn = near.find((n) => n.area.id === 'stib:6357F');
    expect(gdn?.next && hhmm(gdn.next.est)).not.toBe('12:11');
  });

  it('« Dernier passage » : gardé, marqué « dernier » dans les lunettes (tableau et Autour de moi)', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6357'] = [
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')], msg: 'Dernier passage' },
      { line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: [T('12:15')] },
    ];
    const b = await env.core.board('stib:6357F', { limit: 3, filter: [{ line: '3', head: 'churchill' }, { line: '4', head: 'stalle p' }] });
    expect(fmt(b, env.clock.t).slice(0, 2)).toEqual(['T3 Churchill 2 min (dernier)', 'T4 Stalle (P) 5 min']);
    const ctx = { now: env.clock.t, settings: settings() };
    const lines = glassesLines(boardView(b, ctx, { kept: false }));
    expect(lines).toContain('T3   Churchill, dernier   2 min');
    expect(lines).toContain('T4   Stalle   5 min');
    const near = await env.core.nearby(50.86, 4.359, 100);
    const nv = nearbyView(near.filter((n) => n.area.id === 'stib:6357F'), ctx);
    expect(glassesLines(nv)[0]).toMatch(/^Gare du Nord, tram {3}\d+ m {3}T3 2 min, dernier$/);
  });

  it('« dernier » jamais coupé : la destination est raccourcie avant la marque', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6357'] = [{ line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')], msg: 'Dernier passage' }];
    const b = await env.core.board('stib:6357F', { limit: 1, filter: [{ line: '3', head: 'churchill' }] });
    b.departures[0].head = { fr: 'Une destination vraiment très longue pour la colonne', nl: 'x' };
    // 1.2.3 : la ligne « ★ » est en tête du tableau, le départ ensuite
    const lines = glassesLines(boardView(b, { now: env.clock.t, settings: settings() }, { kept: false }));
    expect(lines.find((l) => l.startsWith('T3'))).toMatch(/^T3 {3}Une destination vraiment.*…, dernier {3}2 min$/);
  });
});

describe('tableaux STIB : destination vide', () => {
  const meta = readJson<Meta>(join(CORE_DATA_DIR, 'meta.json'));
  const prep = prepareArea(readJson<AreaFile>(join(CORE_DATA_DIR, 'areas', 'stib', '6357F.json')), meta);

  it('patternForLine : départ prévu le plus proche, sinon direction la plus fréquente à l’arrêt, puis dans la zone', () => {
    const head = (pi: number) => (pi >= 0 ? prep.file.patterns[pi].head.fr : '');
    expect(head(patternForLine(prep, 0, '3', at('2026-11-10T12:13')))).toBe('Churchill');
    expect(head(patternForLine(prep, 0, '4', at('2026-11-10T12:13')))).toBe('Stalle (P)');
    expect(head(patternForLine(prep, 1, '3', at('2026-11-10T12:13')))).toBe('Esplanade');
    // à 03:00, aucun départ à moins de 2 h : la direction la plus fréquente de la ligne à cet arrêt
    expect(head(patternForLine(prep, 0, '3', at('2026-11-10T03:00')))).toBe('Churchill');
    // ligne absente de cet arrêt mais présente dans la zone
    expect(head(patternForLine(prep, 1, '4', at('2026-11-10T12:13')))).toBe('Stalle (P)');
    expect(patternForLine(prep, 0, '99', at('2026-11-10T12:13'))).toBe(-1);
  });

  it('jamais de destination vide : complétée par l’horaire statique, sinon le passage est ignoré', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6357'] = [
      { line: '3', dest: EMPTY, times: [T('12:13')] },
      { line: '4', dest: EMPTY, times: [T('12:16')], msg: 'Dernier passage' },
      { line: '99', dest: EMPTY, times: [T('12:14')] },
    ];
    env.server.relay.stib.points['6358'] = [{ line: '3', dest: { fr: '', nl: ' ' }, times: [T('12:17')] }];
    const b = await env.core.board('stib:6357F', { limit: 6 });
    const live = b.departures.filter((d) => d.rt);
    expect(live.map((d) => `${lineLabel(d.mode, d.line)} ${d.head.fr} ${hhmm(d.est)}${d.last ? ' dernier' : ''}`)).toEqual([
      'T3 Churchill 12:13',
      'T4 Stalle (P) 12:16 dernier',
      'T3 Esplanade 12:17',
    ]);
    expect(b.departures.every((d) => d.head.fr.trim() && d.head.nl.trim())).toBe(true);
    expect(b.departures.some((d) => d.line === '99')).toBe(false);
    // le passage complété remplace bien le départ prévu de son motif (pas de doublon T3 Churchill 12:12)
    expect(b.departures.filter((d) => d.line === '3' && d.head.fr === 'Churchill' && hhmm(d.est) === '12:12')).toHaveLength(0);
  });
});

describe('trajets porte à porte : étape STIB', () => {
  const bourse = (preset: Settings): Settings => ({ ...preset, favorites: [...preset.favorites, { kind: 'place', id: 'bourse', label: 'Bourse', lat: 50.8483, lon: 4.3497, propose: 'never' }] });
  const plan = async (points: Record<string, unknown[]>) => {
    const env = makeEnv({ now: NOW });
    Object.assign(env.server.relay.stib.points, points);
    const js = await env.core.plan({ type: 'here' }, { type: 'place', placeId: 'bourse' }, at('2026-11-10T12:10'), bourse(env.preset), { lat: 50.86, lon: 4.359 });
    return js.map((j) => j.legs.find((l) => l.kind === 'ride' && l.op === 'stib')).filter((l) => !!l);
  };

  it('« Dernier passage » : l’étape le garde, et le téléphone l’écrit dans le détail', async () => {
    const rides = await plan({ '6357': [{ line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')], msg: 'Dernier passage' }] });
    const t3 = rides.find((l) => l.line === '3' && hhmm(l.schedDep) === '12:12');
    expect(t3).toMatchObject({ rt: true, last: true });
    const j = { id: 'x', legs: [t3!], dep: t3!.dep, arr: t3!.arr, leaveAt: t3!.dep, transfers: 0, rt: true, alerts: [] };
    expect(rideDetail(j, 'fr')).toBe('T3 à Gare du Nord, à l’heure, dernier passage');
  });

  it('« Temps théorique » : l’étape reste en horaire prévu ; « Ne pas embarquer » : ignoré', async () => {
    const planned = await plan({ '6357': [{ line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')], msg: 'Temps théorique' }] });
    expect(planned.find((l) => l.line === '3' && hhmm(l.schedDep) === '12:12')).toMatchObject({ rt: false });
    const gone = await plan({ '6357': [{ line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')], msg: 'Ne pas embarquer' }] });
    const t3 = gone.find((l) => l.line === '3' && hhmm(l.schedDep) === '12:12');
    expect(t3?.rt).toBe(false);
    expect(t3?.last).toBeUndefined();
  });
});

describe('travaux STIB (alertes des favoris)', () => {
  it('les mentions de service ne sont jamais rendues comme des travaux', async () => {
    const env = makeEnv({ now: NOW });
    env.server.relay.stib.points['6357'] = [
      { line: '3', dest: { fr: 'CHURCHILL', nl: 'CHURCHILL' }, times: [T('12:12')], msg: 'Temps théorique' },
      { line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: [T('12:15')], msg: 'Dernier passage' },
      { line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: [T('12:23')], msg: 'Travaux : arrêt Yser non desservi' },
    ];
    expect(await env.core.works('stib', [], ['6357F'])).toEqual(['Travaux : arrêt Yser non desservi']);
  });
});
