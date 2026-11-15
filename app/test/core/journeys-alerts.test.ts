/**
 * 1.2.10 (PRD-1.2.10 § 6) : alertes d'un trajet et des tableaux par le vrai cœur (relais simulé) : la demande au relais
 * (lignes, arrêts, heures) et le tri des alertes rendues. Constat du 14/11 : « Travaux : Binche | Travaux réfection rue
 * Zéphir… » sur un trajet Waterloo → Bruxelles (le W).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AreaFile } from '../../../shared/types';
import type { FeedAlert } from '../../src/core/alerts';
import type { Journey, Leg, Settings } from '../../src/core/api';
import { legScope } from '../../src/core/journeys';
import { CORE_DATA_DIR } from './support/network';
import { makeEnv, type TestEnv } from './support/env';

const nb = (s: string | undefined) => (s ?? '').replace(/\u00A0/g, ' ');
const N = (fr: string, nl = fr) => ({ fr, nl });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const sec = (ms: number) => Math.floor(ms / 1000);

/** Alertes réelles du TEC (12/11/2026, voir test/core/alerts.test.ts), rendues par le relais 1.2.10. */
function tecAlerts(t: number): FeedAlert[] {
  const open: [number, number][] = [[sec(t) - 86_400, sec(t) + 10 * 86_400]];
  return [
    {
      id: 'binche',
      routes: [],
      stops: [],
      global: true,
      cause: 'CONSTRUCTION',
      effect: 'DETOUR',
      header: { fr: 'Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44' },
      desc: { fr: 'En raison des travaux, la ligne E44 est déviée sans arrêt perturbé.' },
      active: open,
    },
    { id: 'seraing', routes: [], stops: [], global: true, cause: 'ACCIDENT', effect: 'OTHER_EFFECT', header: { fr: 'Seraing | Accident | Ligne 111' }, active: open },
    { id: 'w-route', routes: ['B0536-23747'], stops: [], cause: 'CONSTRUCTION', effect: 'DETOUR', header: { fr: 'Rhode-Saint-Genèse | Travaux | Ligne W' }, active: open },
    { id: 'w-eglise', routes: [], stops: ['Bwategl1'], cause: 'CONSTRUCTION', effect: 'STOP_MOVED', header: { fr: 'Waterloo | Travaux | Lignes W et 36' }, active: open },
    { id: 'w-eglise-autre-sens', routes: [], stops: ['Bwategl2'], cause: 'CONSTRUCTION', effect: 'STOP_MOVED', header: { fr: 'Waterloo | Travaux | Ligne W' }, active: open },
    { id: 'plus-tard', routes: ['B0536-23747'], stops: [], cause: 'CONSTRUCTION', effect: 'NO_SERVICE', header: { fr: 'Waterloo | Travaux | Ligne W' }, active: [[sec(t) + 5 * 3600, sec(t) + 8 * 3600]] },
  ];
}

/** Relais simulé : les alertes données, filtrées comme le vrai relais (lignes, arrêts, tout le réseau, période). */
function serveAlerts(env: TestEnv, list: FeedAlert[], seen: URL[]): void {
  env.server.overrides.set('/api/alerts', (url) => {
    seen.push(url);
    const q = url.searchParams;
    const routes = (q.get('routes') ?? '').split(',').filter(Boolean);
    const stops = (q.get('stops') ?? '').split(',').filter(Boolean);
    const nowS = sec(env.clock.t);
    const until = q.get('until') ? Number(q.get('until')) : nowS;
    const active = (a: { active: [number, number][] }) => !a.active.length || a.active.some(([s, e]) => (!s || s <= until) && (!e || nowS <= e));
    const alerts = list.filter((a) => active(a) && (a.global || (!routes.length && !stops.length) || a.routes.some((r) => routes.includes(r)) || a.stops.some((s) => stops.includes(s))));
    return json({ op: q.get('op'), fetchedAt: new Date(env.clock.t).toISOString(), alerts });
  });
}

function wLeg(t: number, stops = true): Leg {
  return {
    kind: 'ride',
    from: { name: N('Waterloo Eglise'), lat: 50.7176, lon: 4.3995, areaId: 'tec:Bwategl1' },
    to: { name: N('Bruxelles Midi', 'Brussel Zuid'), lat: 50.8357, lon: 4.3364, areaId: 'tec:Bbxlmid1' },
    dep: t + 10 * 60_000,
    arr: t + 50 * 60_000,
    schedDep: t + 10 * 60_000,
    schedArr: t + 50 * 60_000,
    op: 'tec',
    mode: 'bus',
    line: 'W',
    head: N('Bruxelles Midi', 'Brussel Zuid'),
    fromStop: 'Bwategl1',
    toStop: 'Bbxlmid1',
    ...(stops
      ? {
          stops: [
            { name: N('Waterloo Eglise'), areaId: 'tec:Bwategl1', sched: t + 10 * 60_000, est: t + 10 * 60_000 },
            { name: N('Rhode-Saint-Genese Avenue du Manoir', 'Sint-Genesius-Rode Ridderhoflaan'), areaId: 'tec:Brsgman1', sched: t + 25 * 60_000, est: t + 25 * 60_000 },
            { name: N('Bruxelles Midi', 'Brussel Zuid'), areaId: 'tec:Bbxlmid1', sched: t + 50 * 60_000, est: t + 50 * 60_000 },
          ],
        }
      : {}),
    rt: false,
    delayMin: 0,
    cancelled: false,
  };
}

const journeyOf = (legs: Leg[]): Journey => ({ id: 'w', legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: legs[0].dep, transfers: 0, rt: false, alerts: [] });
const worksOnly = (env: TestEnv): Settings => ({ ...env.preset, alerts: { ...env.preset.alerts, works: true, platform: false, delay: false, cancel: false, leave: false } });

describe('trajet Waterloo → Bruxelles (le W) : seulement ses alertes, mises en forme', () => {
  it('ni Binche ni Seraing ; la déviation de la ligne W et l’arrêt déplacé à la montée, rédigés', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const seen: URL[] = [];
    serveAlerts(env, tecAlerts(env.clock.t), seen);
    const j = await env.core.refresh(journeyOf([wLeg(env.clock.t)]), worksOnly(env));
    const texts = j.alerts.filter((a) => a.kind === 'works').map((a) => nb(a.text));
    expect(texts).toEqual(['Travaux : déviation à Rhode-Saint-Genèse', 'Travaux : arrêt Waterloo Eglise déplacé']);
    expect(texts.join(' ')).not.toMatch(/Binche|Seraing|\|/);
    // l'autre quai de la zone (autre sens) ne concerne pas ce trajet : seulement l'arrêt physique de montée
    expect(j.alerts.some((a) => a.text.includes('Ligne W et 36'))).toBe(false);
    // la demande : le route_id de la ligne W, l'arrêt de montée, l'arrêt traversé, l'arrêt de descente, la fin du trajet
    const q = seen[0].searchParams;
    expect(q.get('op')).toBe('tec');
    expect(q.get('routes')).toBe('B0536-23747');
    expect(q.get('stops')?.split(',').sort()).toEqual(['Bbxlmid1', 'Brsgman1', 'Bwategl1']);
    expect(Number(q.get('until'))).toBeGreaterThanOrEqual(sec(env.clock.t + 50 * 60_000));
    for (const a of j.alerts) {
      expect(a.text.length).toBeLessThanOrEqual(48);
      expect(a.text).not.toMatch(/[|\u2013\u2014]/);
    }
  });

  it('ses heures : une coupure prévue dans 5 h ne concerne pas le W de 07:30, elle concerne celui de 12:30', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const seen: URL[] = [];
    serveAlerts(env, tecAlerts(env.clock.t), seen);
    const morning = await env.core.refresh(journeyOf([wLeg(env.clock.t)]), worksOnly(env));
    expect(morning.alerts.some((a) => nb(a.text).includes('service interrompu'))).toBe(false);
    const later = await env.core.refresh(journeyOf([wLeg(env.clock.t + 5 * 3_600_000)]), worksOnly(env));
    expect(later.alerts.map((a) => nb(a.text))).toContain('Travaux : service interrompu à Waterloo');
  });

  it('réglage « Travaux » éteint : aucune demande au relais', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const seen: URL[] = [];
    serveAlerts(env, tecAlerts(env.clock.t), seen);
    const off: Settings = { ...env.preset, alerts: { ...env.preset.alerts, works: false } };
    const j = await env.core.refresh(journeyOf([wLeg(env.clock.t)]), off);
    expect(j.alerts.some((a) => a.kind === 'works')).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('relais en erreur : aucune alerte travaux, le reste du trajet suit', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    env.server.failing.add('tec');
    const j = await env.core.refresh(journeyOf([wLeg(env.clock.t)]), worksOnly(env));
    expect(j.alerts).toEqual([]);
  });

  it('périmètre d’une étape : arrêts physiques de montée et de descente, arrêts traversés, route_id de sa ligne', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const scope = await legScope(wLeg(env.clock.t), { area: async () => null });
    expect(scope).toMatchObject({ op: 'tec', lines: ['W'], routes: [] });
    expect(scope?.stops).toEqual([
      { id: 'Bwategl1', name: 'Waterloo Eglise', end: true },
      { id: 'Bbxlmid1', name: 'Bruxelles Midi', end: true },
      { id: 'Brsgman1', name: 'Rhode-Saint-Genese Avenue du Manoir', end: false },
    ]);
    // un train : ses gares, la première et la dernière où l'on monte et descend
    const t = env.clock.t;
    const ic: Leg = {
      kind: 'ride',
      from: { name: N('Namur'), lat: 50.468, lon: 4.862, areaId: 'sncb:8863008' },
      to: { name: N('Bruxelles-Central', 'Brussel-Centraal'), lat: 50.845, lon: 4.357, areaId: 'sncb:8813003' },
      dep: t,
      arr: t + 3_600_000,
      schedDep: t,
      schedArr: t + 3_600_000,
      op: 'sncb',
      mode: 'train',
      line: 'IC',
      cat: 'IC',
      stops: [
        { name: N('Namur'), areaId: 'sncb:8863008', sched: t, est: t },
        { name: N('Ottignies'), areaId: 'sncb:8811601', sched: t + 1_800_000, est: t + 1_800_000 },
        { name: N('Bruxelles-Central', 'Brussel-Centraal'), areaId: 'sncb:8813003', sched: t + 3_600_000, est: t + 3_600_000 },
      ],
    };
    expect((await legScope(ic, { area: async () => null }))?.stops.map((s) => `${s.id}${s.end ? '' : ' (traversée)'}`)).toEqual(['8863008', '8811601 (traversée)', '8813003']);
    expect(await legScope({ ...ic, kind: 'walk' }, { area: async () => null })).toBeNull();
  });
});

describe('core.works (tableaux et détail d’une ligne des lunettes) : numéros de ligne et zone, comme controller.worksOf', () => {
  it('TEC : la zone et le numéro « W » donnent le route_id et les arrêts ; Binche écarté', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const seen: URL[] = [];
    serveAlerts(env, tecAlerts(env.clock.t), seen);
    // controller.worksOf(board.op, [board.line], board.area.id) (détail d'une ligne)
    const texts = (await env.core.works('tec', ['W'], ['tec:Bwategl1'])).map(nb);
    // un tableau : tous les quais de la zone (les deux sens), chacun rédigé une fois
    expect(texts).toEqual(['Travaux : déviation à Rhode-Saint-Genèse', 'Travaux : arrêt Waterloo Eglise déplacé']);
    const q = seen[0].searchParams;
    expect(q.get('routes')).toBe('B0536-23747');
    expect(q.get('stops')?.split(',').sort()).toEqual(['Bwategl1', 'Bwategl2']);
    // pour un tableau, chaque texte laisse la place du « ! » (46 caractères au plus)
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(46);
  });

  it('1.2.9 : avant, « W » partait comme route_id et l’identifiant de la zone comme arrêt : seules les alertes de tout le réseau revenaient', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const seen: URL[] = [];
    serveAlerts(env, tecAlerts(env.clock.t), seen);
    await env.core.works('tec', ['W'], ['tec:Bwategl1']);
    const q = seen[0].searchParams;
    expect(q.get('routes')).not.toContain('W,');
    expect(q.get('routes')?.split(',')).not.toContain('W');
    expect(q.get('stops')).not.toContain('tec:');
  });

  it('De Lijn : numéro de ligne et zone convertis (route_id du fichier de zone, arrêts de la zone)', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    // vrais identifiants De Lijn (13/11) : le route_id n'est pas le numéro (« 30232 » pour le 232) ; les fixtures avaient
    // route_id = numéro, ce qui cachait l'écart de controller.worksOf (PRD-1.2.9 § 5)
    const path = 'areas/delijn/308611.json';
    const f = JSON.parse(readFileSync(join(CORE_DATA_DIR, path), 'utf8')) as AreaFile;
    for (const p of f.patterns) p.route = `30${p.line}0`;
    env.server.memFiles.set(path, JSON.stringify(f));
    const seen: URL[] = [];
    const t = env.clock.t;
    env.server.overrides.set('/api/alerts', (url) => {
      seen.push(url);
      const routes = (url.searchParams.get('routes') ?? '').split(',');
      const all: FeedAlert[] = [
        { id: 'quai', routes: [], stops: ['308613'], cause: 'CONSTRUCTION', effect: 'STOP_MOVED', header: { nl: 'Werken: halte verplaatst' }, active: [[sec(t) - 60, sec(t) + 3600]] },
        { id: 'lijn', routes: ['302320'], stops: [], cause: 'CONSTRUCTION', effect: 'DETOUR', header: { nl: 'Lijn 232 omgeleid' }, active: [] },
      ];
      return json({ op: 'delijn', fetchedAt: '', alerts: all.filter((a) => a.stops.length || a.routes.some((r) => routes.includes(r))) });
    });
    const texts = (await env.core.works('delijn', ['232'], ['delijn:308611'])).map(nb);
    expect(texts).toEqual(['Travaux : arrêt Bruxelles-Nord déplacé', 'Travaux : déviation']);
    const q = seen[0].searchParams;
    expect(q.get('routes')).toBe('302320');
    expect(q.get('stops')?.split(',').sort()).toEqual(['308611', '308613']);
    // une autre ligne de la zone : ni son route_id ni la déviation du 232
    seen.length = 0;
    expect((await env.core.works('delijn', ['460'], ['delijn:308611'])).map(nb)).toEqual(['Travaux : arrêt Bruxelles-Nord déplacé']);
    expect(seen[0].searchParams.get('routes')).toBe('304600');
  });

  it('SNCB : la zone d’une gare donne ses quais ; l’alerte d’Ottignies rédigée', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    expect((await env.core.works('sncb', ['IC'], ['sncb:8811601'])).map(nb)).toEqual(['Travaux : retards possibles à Ottignies']);
    expect(await env.core.works('sncb', ['IC'], ['sncb:8863008'])).toEqual([]);
  });

  it('STIB : la zone donne ses points d’arrêt, le message de la ligne demandée seulement', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    expect((await env.core.works('stib', ['2'], ['stib:6359'])).map(nb)).toEqual(['Travaux : arrêt Botanique non desservi']);
    expect(await env.core.works('stib', ['6'], ['stib:6359'])).toEqual([]);
    expect((await env.core.works('stib', ['3', '2'], ['stib:6359'])).map(nb)).toEqual(['Travaux : arrêt Botanique non desservi']);
  });
});
