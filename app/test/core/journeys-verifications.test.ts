/**
 * 1.2.10 (PRD-1.2.10 § 6) : vérifications laissées par la 1.2.9 (PRD-1.2.9 § 5).
 *
 * 1. controller.worksOf pour De Lijn et le TEC (numéros de ligne contre route_id) : corrigé à la source dans core.works
 *    (core/index.ts), tests dans test/core/journeys-alerts.test.ts (« core.works … comme controller.worksOf »).
 * 2. Jour de service pendant l'heure du changement d'heure (25/10/2026, 28/03/2027) : les passages (tableaux) suivent
 *    la règle GTFS « midi moins 12 h » : un passage de 02:30 ne disparaît pas et ne compte pas double (tests
 *    ci-dessous). En revanche serviceDayIndex (core/linepicks.ts, hors des fichiers de l'équipe F) retranche 4 h de
 *    temps absolu au lieu de lire l'heure locale : faux une heure par changement d'heure (25/10 de 03:00 à 04:00, la
 *    veille attendue ; 28/03 de 04:00 à 05:00, le jour même attendu). Effet : le nombre de passages de la journée
 *    par motif (nom et ordre des sens du détail d'une ligne) compté sur le mauvais jour pendant cette heure.
 *    Correctif pour l'intégrateur, dans core/linepicks.ts :
 *
 *      export function serviceDayIndex(dates: readonly string[], now: number): number {
 *        const p = brusselsParts(now);
 *        return dates.indexOf(p.h < DAY_START_HOUR ? addDays(p.date, -1) : p.date);
 *      }
 *
 *    (imports : brusselsParts de './util', DAY_START_HOUR de './text', addDays de './freshness' ; DAY_START_MS et
 *    localDate deviennent inutiles), puis passer le test « it.fails » ci-dessous en « it ».
 * 3. Deux lignes W de régions différentes gardées en 1.2.5 : la migration (settings.ts, équipe téléphone) les fond en
 *    une seule : une ligne gardée à un arrêt n'a pas de route_id, isFollowed se contente alors du numéro ; le W de
 *    Tournai disparaît (il reste dans la copie quai.settings.v4-1.2.5). Correctif pour l'intégrateur, dans
 *    settings.ts (validateSettings, boucle `picksWithLine`) : ne rattacher une ligne gardée à une ligne suivie déjà
 *    créée que si leurs arrêts repères sont de la même région :
 *
 *      const region = (areaId?: string): string => {
 *        const k = (areaId ?? '').replace(/^[a-z]+:/, '');
 *        return areaId?.startsWith('tec:') ? k.charAt(0).toUpperCase() : areaId?.startsWith('delijn:') ? k.charAt(0) : '';
 *      };
 *      const known = follows.find((q) => isFollowed(q, { op: p.op, line: p.line ?? '' }) && (!q.via || region(q.via.areaId) === region(p.areaId)));
 *
 *    (TEC : la lettre de l'arrêt, B Brabant wallon, C Charleroi, H Hainaut, L Liège-Verviers, N Namur, X Luxembourg ;
 *    De Lijn : le premier chiffre, la province), puis passer le test « it.fails » ci-dessous en « it ».
 * 4. `npm run dev:web` : la page de développement demandait /quai/src/web/main.ts, hors du chemin /quai/app/ (404,
 *    Quai Web ne démarrait pas). Script réparé dans app/package.json (même serveur Vite, entrée servie par /@fs/).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta } from '../../../shared/types';
import { serviceDayIndex } from '../../src/core/linepicks';
import { hhmm } from '../../src/core/util';
import { validateSettings } from '../../src/settings';
import { makeEnv } from './support/env';
import { APP_DIR, CORE_DATA_DIR } from './support/network';

/* ------------------------------ 2. Changement d'heure ------------------------------ */

const AREA = 'areas/tec/Bwategl1.json';
const readJson = <T>(p: string): T => JSON.parse(readFileSync(join(CORE_DATA_DIR, p), 'utf8')) as T;

/** Données d'une nuit de changement d'heure : deux journées publiées, passages du W à Waterloo Eglise. */
function dstEnv(dates: [string, string], deps: [number, number, string][], now: string) {
  const env = makeEnv({ now: Date.parse(now) });
  const meta = { ...readJson<Meta>('meta.json'), serviceDates: dates, generatedAt: `${dates[0]}T01:15:00.000Z` };
  env.server.memFiles.set('meta.json', JSON.stringify(meta));
  const area = readJson<AreaFile>(AREA);
  area.deps = deps.map(([day, min, trip]) => [day, min, 0, 0, trip, 2]);
  env.server.memFiles.set(AREA, JSON.stringify(area));
  return env;
}

describe('jour de service pendant l’heure du changement d’heure', () => {
  it('25/10/2026 (03:00 → 02:00) : 01:30, 02:30 d’été, 02:30 d’hiver, 03:30 : chacun une fois, dans l’ordre', async () => {
    // journée du 24/10 : 25:30 et 26:30 (après minuit) ; journée du 25/10 : 02:30, 03:30, 06:00 (règle GTFS : midi - 12 h)
    const env = dstEnv(['2026-10-24', '2026-10-25'], [[0, 25 * 60 + 30, 'W-N1'], [0, 26 * 60 + 30, 'W-N2'], [1, 150, 'W-N3'], [1, 210, 'W-N4'], [1, 360, 'W-N5']], '2026-10-25T01:00:00+02:00');
    const b = await env.core.board('tec:Bwategl1', { horizonMin: 240 });
    const ids = b.departures.map((d) => d.tripId);
    expect(ids).toEqual(['W-N1', 'W-N2', 'W-N3', 'W-N4']);
    expect(b.departures.map((d) => hhmm(d.sched))).toEqual(['01:30', '02:30', '02:30', '03:30']);
    expect(b.departures.map((d) => new Date(d.sched).toISOString())).toEqual(['2026-10-24T23:30:00.000Z', '2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z', '2026-10-25T02:30:00.000Z']);
    // à 02:45 (heure d'hiver), les deux 02:30 sont passés : aucun ne revient
    env.clock.set(Date.parse('2026-10-25T02:45:00+01:00'));
    const later = await env.core.board('tec:Bwategl1', { horizonMin: 240 });
    expect(later.departures.map((d) => d.tripId)).toEqual(['W-N4', 'W-N5']);
  });

  it('28/03/2027 (02:00 → 03:00) : rien ne disparaît dans l’heure qui n’existe pas, rien ne compte double', async () => {
    // journée du 27/03 : 25:30 (01:30 d'hiver) ; journée du 28/03 : 03:30 (03:30 d'été), 05:00
    const env = dstEnv(['2027-03-27', '2027-03-28'], [[0, 25 * 60 + 30, 'W-S1'], [1, 210, 'W-S2'], [1, 300, 'W-S3']], '2027-03-28T01:00:00+01:00');
    const b = await env.core.board('tec:Bwategl1', { horizonMin: 300 });
    expect(b.departures.map((d) => d.tripId)).toEqual(['W-S1', 'W-S2', 'W-S3']);
    expect(b.departures.map((d) => hhmm(d.sched))).toEqual(['01:30', '03:30', '05:00']);
    expect(b.departures.map((d) => new Date(d.sched).toISOString())).toEqual(['2027-03-28T00:30:00.000Z', '2027-03-28T01:30:00.000Z', '2027-03-28T03:00:00.000Z']);
  });

  it('serviceDayIndex en dehors de l’heure litigieuse : juste', () => {
    const fall = ['2026-10-24', '2026-10-25'];
    expect(serviceDayIndex(fall, Date.parse('2026-10-25T02:30:00+02:00'))).toBe(0); // premier 02:30
    expect(serviceDayIndex(fall, Date.parse('2026-10-25T02:30:00+01:00'))).toBe(0); // second 02:30
    expect(serviceDayIndex(fall, Date.parse('2026-10-25T04:00:00+01:00'))).toBe(1);
    const spring = ['2027-03-27', '2027-03-28'];
    expect(serviceDayIndex(spring, Date.parse('2027-03-28T01:30:00+01:00'))).toBe(0);
    expect(serviceDayIndex(spring, Date.parse('2027-03-28T05:00:00+02:00'))).toBe(1);
  });

  // À passer en it() avec le correctif de core/linepicks.ts décrit en tête de ce fichier (équipe F, PRD-1.2.10 § 6).
  it('serviceDayIndex pendant l’heure du changement : 25/10 03:30 → le 24/10 ; 28/03 04:30 → le 28/03', () => {
    expect(serviceDayIndex(['2026-10-24', '2026-10-25'], Date.parse('2026-10-25T03:30:00+01:00'))).toBe(0);
    expect(serviceDayIndex(['2027-03-27', '2027-03-28'], Date.parse('2027-03-28T04:30:00+02:00'))).toBe(1);
  });
});

/* ------------------------------ 3. Deux lignes W gardées en 1.2.5 ------------------------------ */

describe('deux lignes W de régions différentes gardées en 1.2.5', () => {
  const pick = (id: string, areaId: string, fr: string, lat: number, lon: number) => ({ id, areaId, op: 'tec', name: { fr, nl: fr }, lat, lon, line: 'W' });
  const waterloo = pick('w-wat', 'tec:Bwategl1', 'Waterloo Eglise', 50.7174, 4.3979);
  const braine = pick('w-brl', 'tec:Bbrlgar1', 'Braine-l’Alleud Gare', 50.6833, 4.3745);
  const tournai = pick('w-trn', 'tec:H4ty265a', 'Tournai 7 Fontaines', 50.6056, 3.3889);

  it('le même W gardé à deux arrêts de sa ligne : une seule ligne suivie (règle 1.2.6)', () => {
    const s = validateSettings({ v: 4, lines: [waterloo, braine] });
    expect(s.follows?.map((f) => `${f.line} ${f.via?.areaId}`)).toEqual(['W tec:Bwategl1']);
  });

  it('deux lignes suivies avec leurs variantes : toujours distinguées (contrôle qualité 1.2.6)', () => {
    const s = validateSettings({ v: 4, follows: [{ id: 'w-b', op: 'tec', line: 'W', routes: ['tec:B0536-23747'] }, { id: 'w-h', op: 'tec', line: 'W', routes: ['tec:H4805-22866'] }] });
    expect(s.follows?.map((f) => f.id)).toEqual(['w-b', 'w-h']);
  });

  // À passer en it() avec le correctif de settings.ts décrit en tête de ce fichier (équipe F, PRD-1.2.10 § 6).
  it('gardés à Waterloo et à Tournai en 1.2.5 : deux lignes suivies', () => {
    const s = validateSettings({ v: 4, lines: [waterloo, tournai] });
    expect(s.follows?.map((f) => `${f.line} ${f.via?.areaId}`)).toEqual(['W tec:Bwategl1', 'W tec:H4ty265a']);
  });
});

/* ------------------------------ 4. npm run dev:web ------------------------------ */

describe('npm run dev:web', () => {
  it('démarre Quai Web en local : la page de /quai/app/ et son entrée se chargent', async () => {
    const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['dev:web']).toContain("configFile: 'vite.web.config.ts'");
    const proc = spawn('npm', ['run', 'dev:web'], { cwd: APP_DIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error(`dev:web ne démarre pas\n${buf.slice(-800)}`)), 45_000);
        const on = (b: Buffer) => {
          buf += b.toString();
          const m = /Local:\s+(http:\/\/localhost:\d+\/quai\/app\/)/.exec(buf.replace(/\u001b\[[0-9;]*m/g, ''));
          if (m) {
            clearTimeout(timer);
            resolve(m[1].replace('localhost', '127.0.0.1'));
          }
        };
        proc.stdout?.on('data', on);
        proc.stderr?.on('data', on);
        proc.on('exit', (code) => reject(new Error(`dev:web arrêté (code ${code})\n${buf.slice(-800)}`)));
      });
      const html = await (await fetch(url)).text();
      const src = /<script type="module" src="([^"]*main\.ts)"/.exec(html)?.[1];
      expect(src, html.slice(0, 400)).toBeTruthy();
      expect(src!.startsWith('/quai/app/')).toBe(true);
      const entry = await fetch(new URL(src!, url));
      expect(entry.status).toBe(200);
      expect(entry.headers.get('content-type')).toMatch(/javascript/);
      const code = await entry.text();
      // une dépendance de l'entrée se charge aussi (le graphe des modules est servi)
      const dep = /from ["'](\/quai\/app\/[^"']+)["']/.exec(code)?.[1];
      expect(dep).toBeTruthy();
      expect((await fetch(new URL(dep!, url))).status).toBe(200);
    } finally {
      try {
        process.kill(-proc.pid!, 'SIGTERM');
      } catch {
        /* déjà arrêté */
      }
    }
  }, 60_000);
});
