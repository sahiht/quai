/**
 * 1.2.2 (PRD-1.2.2 CA-122.4) : lignes par numéro et passages par sens sur des instantanés réels publiés par le
 * pipeline, à la demande seulement (comme test/core/routing/real.test.ts) :
 *
 *   QUAI_REAL=/home/claude/real-data-11/data,/home/claude/real-data-13/data npx vitest run test/core/linepicks-real.test.ts
 *
 * Un ou plusieurs dossiers (séparés par des virgules) ; chaque contrôle tourne si un instantané couvre son jour :
 * 11/11 (jour férié) et 12/11 (instantané du 11), 13/11 et samedi 14/11 (instantané du 13). Relais en panne : horaires
 * prévus. Positions : celles des arrêts publics eux-mêmes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile, AreaSummary, Meta, TileFile } from '../../../shared/types';
import type { Core, LineBoard, PickPlace } from '../../src/core/api';
import { gtfsTime, hhmm } from '../../src/core/util';
import { makeEnv, type TestEnv } from './support/env';

const DIRS = (process.env.QUAI_REAL ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((d) => d && existsSync(join(d, 'meta.json')));
const metaOf = (d: string) => JSON.parse(readFileSync(join(d, 'meta.json'), 'utf8')) as Meta;
/** Instantané qui couvre ce jour (avec des fichiers de ligne). */
const snapFor = (day: string) => DIRS.find((d) => metaOf(d).lines && metaOf(d).serviceDates.includes(day));
const has = (...days: string[]) => days.every((d) => !!snapFor(d));

const COLLEGE = 'tec:tec:s-brainelalleudctducollge'; // Braine-l'Alleud Côté du Collège
const MERBRAINE = 'tec:tec:s-brainelalleudmerbraine';
const envAt = (day: string, h: number, m: number): TestEnv => makeEnv({ now: gtfsTime(day, h * 60 + m), scene: 'noRT', dataDir: snapFor(day)! });
const areaFile = (dir: string, id: string) => JSON.parse(readFileSync(join(dir, 'areas', 'tec', `${id.slice(4).replace(/[^A-Za-z0-9_-]/g, '_')}.json`), 'utf8')) as AreaFile;
const view = (b: LineBoard) =>
  b.directions.map((d) => `${d.head.fr} : ${d.departures.map((x) => `${hhmm(x.sched)}${x.partial ? ` jusqu'à ${x.head.fr}` : x.head.fr !== d.head.fr ? ` (${x.head.fr})` : ''}`).join(', ')}`);

/** Invariants d'un tableau de ligne (CA-122.4) : 3 sens au plus, `per` passages triés, aucun passage en double. */
function checkBoard(b: LineBoard, per: number): void {
  expect(b.directions.length).toBeLessThanOrEqual(3);
  const seen = new Set<string>();
  for (const d of b.directions) {
    expect(d.departures.length).toBeLessThanOrEqual(per);
    for (let i = 1; i < d.departures.length; i++) expect(d.departures[i].est).toBeGreaterThanOrEqual(d.departures[i - 1].est);
    for (const x of d.departures) {
      const k = `${x.tripId ?? ''}|${x.sched}|${x.head.fr}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      if (x.partial) expect(x.head.fr).not.toBe(d.head.fr);
    }
  }
  expect(b.state).toBe(b.directions.some((d) => d.departures.length) ? 'ok' : b.state === 'missing' ? 'missing' : 'none');
}

describe.skipIf(!has('2026-11-12'))('données réelles du 12/11 (instantané du 11)', () => {
  it('CA-122.4 : le 36 à Côté du Collège a deux sens, et le passage de 07:49 s’arrête à Vallée Bailly', async () => {
    const { core } = envAt('2026-11-12', 7, 32);
    const b = await core.lineBoard(COLLEGE, '36', { perDirection: 4 });
    console.log(`12/11 07:32, 36 à Côté du Collège :\n  ${view(b).join('\n  ')}`);
    expect(b).toMatchObject({ state: 'ok', op: 'tec', mode: 'bus', line: '36' });
    expect(b.directions.map((d) => d.head.fr)).toEqual(['Wavre, Gare', "Braine-l'Alleud, Gare"]);
    expect(view(b)).toEqual(['Wavre, Gare : 07:41, 08:13, 08:40, 09:40', "Braine-l'Alleud, Gare : 07:49 jusqu'à Braine-l’Alleud Vallée Bailly, 07:54, 08:11, 09:11"]);
    // deux passages par défaut, le partiel compris
    const two = await core.lineBoard(COLLEGE, '36');
    expect(two.directions.map((d) => d.departures.map((x) => `${hhmm(x.sched)}${x.partial ? '*' : ''}`))).toEqual([
      ['07:41', '08:13'],
      ['07:49*', '07:54'],
    ]);
    checkBoard(b, 4);
  });

  it('le soir, le sens garde son nom « Wavre, Gare » ; les voyages vers Lasne Village, qui s’arrêtent avant, sont partiels', async () => {
    const { core } = envAt('2026-11-12', 20, 0);
    const b = await core.lineBoard(COLLEGE, '36', { perDirection: 4 });
    console.log(`12/11 20:00, 36 à Côté du Collège :\n  ${view(b).join('\n  ')}`);
    expect(view(b)).toEqual([
      "Wavre, Gare : 20:40 jusqu'à Lasne Village (Rue de l'Eglise), 21:40 jusqu'à Lasne Village (Rue de l'Eglise)",
      "Braine-l'Alleud, Gare : 20:20, 21:20",
    ]);
    checkBoard(b, 4);
  });

  it('le W à Merbraine : Bruxelles Midi et Braine-l’Alleud Gare', async () => {
    const { core } = envAt('2026-11-12', 7, 32);
    const b = await core.lineBoard(MERBRAINE, 'W');
    console.log(`12/11 07:32, W à Merbraine :\n  ${view(b).join('\n  ')}`);
    expect(b.directions.map((d) => d.head.fr)).toEqual(['Bruxelles Midi', "Braine-l'Alleud, Gare"]);
    expect(b.directions.every((d) => d.departures.length === 2)).toBe(true);
    checkBoard(b, 2);
  });

  it('findLines(« w ») près de Côté du Collège : le W du Brabant wallon d’abord ; ses arrêts du côté de Merbraine d’abord', async () => {
    const env = envAt('2026-11-12', 7, 32);
    const a = areaFile(snapFor('2026-11-12')!, COLLEGE);
    const near = { lat: a.lat, lon: a.lon };
    const t0 = performance.now();
    const ws = await env.core.findLines('w', near);
    const ms = performance.now() - t0;
    const files = env.server.calls.filter((u) => u.includes('/lines/')).length;
    console.log(`findLines('w') : ${ws.map((m) => `${m.op} ${m.line} [${m.ends.map((e) => e.fr).join(' ↔ ')}] ${m.nearest?.distanceM} m`).join(' | ')} (${files} fichiers, ${ms.toFixed(0)} ms)`);
    expect(ws[0]).toMatchObject({ op: 'tec', mode: 'bus', line: 'W', routes: ['tec:B0536-23747'], nearest: { areaId: COLLEGE } });
    expect(ws[0].ends.map((e) => e.fr)).toEqual(["Braine-l'Alleud, Gare", 'Bruxelles Midi']);
    expect(ws.length).toBeGreaterThanOrEqual(2); // le W de Tournai, plus loin
    expect(ws[1].nearest!.distanceM).toBeGreaterThan(50_000);
    expect(files).toBeLessThanOrEqual(17);
    const stops = await env.core.lineStops(ws[0], near);
    console.log(`lineStops : ${stops.slice(0, 6).map((s) => `${s.name.fr} ${s.distanceM} m`).join(' ; ')} (${stops.length} arrêts)`);
    expect(stops[0].areaId).toBe(COLLEGE);
    expect(stops.slice(0, 5).map((s) => s.areaId)).toContain(MERBRAINE);
    expect(stops.every((s, i) => i === 0 || (s.distanceM ?? 0) >= (stops[i - 1].distanceM ?? 0))).toBe(true);
    // sans position : dans l'ordre de la ligne, de Braine-l'Alleud à Bruxelles
    const plain = await env.core.lineStops(ws[0]);
    expect(plain.map((s) => s.areaId)).toEqual(expect.arrayContaining([COLLEGE, MERBRAINE]));
    expect(plain.every((s) => s.distanceM === undefined)).toBe(true);
  });

  it('findLines : numéros courants (36, 1, 71, 95), 8 lignes au plus, fichiers lus bornés', async () => {
    const env = envAt('2026-11-12', 7, 32);
    for (const q of ['36', '1', '71', '95']) {
      const before = env.server.calls.length;
      const r = await env.core.findLines(q, { lat: 50.8454, lon: 4.3571 }); // gare de Bruxelles-Central
      const files = env.server.calls.slice(before).filter((u) => u.includes('/lines/') && !u.endsWith('index.json')).length;
      console.log(`findLines('${q}') : ${r.map((m) => `${m.op} ${m.mode} ${m.line} [${m.ends.map((e) => e.fr).join(' ↔ ')}] ${m.nearest?.distanceM} m`).join(' | ')} (${files} fichiers)`);
      expect(r.length).toBeGreaterThan(0);
      expect(r.length).toBeLessThanOrEqual(8);
      expect(files).toBeLessThanOrEqual(16);
      for (const m of r) expect(m.mode).not.toBe('train');
      expect(r.every((m, i) => i === 0 || m.nearest!.distanceM >= r[i - 1].nearest!.distanceM)).toBe(true);
    }
  });
});

describe.skipIf(!has('2026-11-11'))('données réelles du 11/11, jour férié', () => {
  it('le 36 à Côté du Collège : horaire du dimanche, deux sens, aucun partiel', async () => {
    const { core } = envAt('2026-11-11', 7, 32);
    const b = await core.lineBoard(COLLEGE, '36');
    console.log(`11/11 07:32, 36 à Côté du Collège :\n  ${view(b).join('\n  ')}`);
    expect(view(b)).toEqual(['Wavre, Gare : 07:40, 09:40', "Braine-l'Alleud, Gare : 09:17, 11:17"]);
  });
});

describe.skipIf(!has('2026-11-13', '2026-11-14'))('données réelles des 13/11 et 14/11 (instantané du 13)', () => {
  it('vendredi 13/11 : même service qu’un jeudi, le passage de 07:49 s’arrête à Vallée Bailly', async () => {
    const { core } = envAt('2026-11-13', 7, 32);
    const b = await core.lineBoard(COLLEGE, '36');
    console.log(`13/11 07:32, 36 à Côté du Collège :\n  ${view(b).join('\n  ')}`);
    expect(view(b)).toEqual(['Wavre, Gare : 07:41, 08:13', "Braine-l'Alleud, Gare : 07:49 jusqu'à Braine-l’Alleud Vallée Bailly, 07:54"]);
  });

  it('samedi 14/11 : deux sens, aucun partiel ; le W à Merbraine a ses deux sens', async () => {
    const { core } = envAt('2026-11-14', 7, 32);
    const b = await core.lineBoard(COLLEGE, '36');
    console.log(`14/11 07:32, 36 à Côté du Collège :\n  ${view(b).join('\n  ')}`);
    expect(view(b)).toEqual(['Wavre, Gare : 07:40, 08:40', "Braine-l'Alleud, Gare : 08:17, 09:17"]);
    const w = await core.lineBoard(MERBRAINE, 'W');
    console.log(`14/11 07:32, W à Merbraine :\n  ${view(w).join('\n  ')}`);
    expect(w.directions.map((d) => d.head.fr)).toEqual(['Bruxelles Midi', "Braine-l'Alleud, Gare"]);
  });
});

/**
 * Fichier de zone tel que le publierait un instantané dont les deux jours n'ont que le service du jour `idx` (week-end,
 * jour férié) : les motifs ne viennent que des départs publiés (pipeline/src/feed.ts), ceux des autres lignes disparaissent.
 */
function onlyDay(file: AreaFile, idx: number): AreaFile {
  const deps = file.deps.filter((d) => d[0] === idx);
  const used = [...new Set(deps.map((d) => d[2]))].sort((a, b) => a - b);
  const to = new Map(used.map((pi, i) => [pi, i]));
  return { ...file, patterns: used.map((pi) => file.patterns[pi]), deps: deps.map((d) => d.map((x, i) => (i === 2 ? to.get(d[2])! : x)) as typeof d) };
}

describe('revue 1.2.2 : ligne sans service les jours publiés (11/11 férié, samedi 14/11)', () => {
  for (const day of ['2026-11-11', '2026-11-14']) {
    it.skipIf(!has(day))(`${day} : 39, 57 et 58 à Côté du Collège : aucun passage (none), jamais « introuvable »`, async () => {
      const dir = snapFor(day)!;
      const idx = metaOf(dir).serviceDates.indexOf(day);
      const file = areaFile(dir, COLLEGE);
      const env = envAt(day, 7, 32);
      // fichier publié : les motifs viennent aussi de l'autre jour publié
      for (const line of ['39', '57', '58']) expect((await env.core.lineBoard(COLLEGE, line)).state).not.toBe('missing');
      // publication de deux jours sans ces lignes : la zone existe, aucun motif de la ligne
      const only = onlyDay(file, idx);
      const lines = new Set(only.patterns.map((p) => p.line));
      expect(['39', '57', '58'].filter((l) => lines.has(l))).toEqual([]);
      const key = `areas/tec/${COLLEGE.slice(4).replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
      const weekend = envAt(day, 7, 32);
      weekend.server.memFiles.set(key, JSON.stringify(only));
      const states: string[] = [];
      for (const line of ['39', '57', '58', '36']) {
        const b = await weekend.core.lineBoard(COLLEGE, line);
        states.push(`${line} ${b.state}`);
        checkBoard(b, 2);
      }
      console.log(`${day} 07:32, Côté du Collège, deux jours sans 39, 57, 58 : ${states.join(', ')}`);
      expect(states).toEqual(['39 none', '57 none', '58 none', '36 ok']);
      expect(await weekend.core.lineBoard(COLLEGE, '39')).toMatchObject({ directions: [], area: { id: COLLEGE }, line: '39' });
    });
  }
});

/** Résumés des zones d'un instantané (tuiles). */
function summaries(dir: string): Map<string, AreaSummary> {
  const out = new Map<string, AreaSummary>();
  for (const f of readdirSync(join(dir, 'tiles'))) for (const a of (JSON.parse(readFileSync(join(dir, 'tiles', f), 'utf8')) as TileFile).areas) out.set(a.id, a);
  return out;
}

describe.skipIf(!has('2026-11-12', '2026-11-13'))('revue 1.2.2 : gares et lignes choisies sur l’instantané du 11, lues sur celui du 13', () => {
  it('identifiants disparus : retrouvés par `aka` (movedTo) avec la position du choix ; les autres, missing sans exception', async () => {
    const before = summaries(snapFor('2026-11-12')!);
    const after = summaries(snapFor('2026-11-13')!);
    const gone = [...before.values()].filter((a) => !after.has(a.id));
    const akaOf = new Map<string, string>();
    for (const a of after.values()) for (const old of a.aka ?? []) akaOf.set(old, a.id);
    const dir13 = snapFor('2026-11-13')!;
    const fileOf = (id: string) => join(dir13, 'areas', id.slice(0, id.indexOf(':')), `${id.slice(id.indexOf(':') + 1).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
    const env = envAt('2026-11-13', 8, 0);
    const out = { idle: 0, aka: 0, name: 0, missing: 0 };
    for (const a of gone) {
      const near: PickPlace = { lat: a.lat, lon: a.lon, name: a.n };
      const line = a.lines[0] ?? '';
      const lb = await env.core.lineBoard(a.id, line, { near });
      const b = await env.core.board(a.id, { limit: 2, near });
      if (existsSync(fileOf(a.id))) {
        // zone toujours publiée, sans départ les deux jours (absente des tuiles) : la même, aucun passage
        expect(lb).toMatchObject({ state: 'none', area: { id: a.id } });
        expect([lb.movedTo, b.movedTo, b.missing]).toEqual([undefined, undefined, undefined]);
        out.idle++;
      } else if (akaOf.has(a.id)) {
        expect(lb).toMatchObject({ movedTo: akaOf.get(a.id), area: { id: akaOf.get(a.id) } });
        expect(lb.state).not.toBe('missing');
        expect(b.movedTo).toBe(akaOf.get(a.id));
        out.aka++;
      } else if (lb.movedTo) {
        // même réseau, même nom, 150 m au plus
        const to = after.get(lb.movedTo)!;
        expect(to.op).toBe(a.op);
        expect(b.movedTo).toBe(lb.movedTo);
        out.name++;
      } else {
        expect(lb).toMatchObject({ state: 'missing', directions: [] });
        expect(b).toMatchObject({ missing: true, departures: [] });
        out.missing++;
      }
    }
    console.log(
      `11 → 13 : ${gone.length} zones absentes des tuiles du 13 ; sans départ ces deux jours ${out.idle} ; retrouvées par aka ${out.aka}, par nom et position ${out.name} ; introuvables ${out.missing}`,
    );
    expect(out.aka).toBe(gone.filter((a) => akaOf.has(a.id) && !existsSync(fileOf(a.id))).length);
    // Louise (STIB) : stib:52 du 11 est devenu stib:1087 le 13
    const louise = before.get('stib:52');
    if (louise && akaOf.get('stib:52') === 'stib:1087') {
      const lb = await envAt('2026-11-13', 8, 0).core.lineBoard('stib:52', '2', { near: { lat: louise.lat, lon: louise.lon, name: louise.n } });
      console.log(`13/11 08:00, métro 2 à Louise (choisi sur stib:52) : movedTo ${lb.movedTo}, ${view(lb).join(' | ')}`);
      expect(lb).toMatchObject({ state: 'ok', movedTo: 'stib:1087' });
    }
  }, 300_000);
});

/** Toutes les lignes d'un échantillon de zones : jamais d'exception, invariants tenus, sens comptés. */
async function sweep(core: Core, dir: string, every: number): Promise<{ boards: number; dirs: Record<number, number>; partial: number }> {
  const out = { boards: 0, dirs: {} as Record<number, number>, partial: 0 };
  for (const op of ['stib', 'delijn', 'tec']) {
    const files = readdirSync(join(dir, 'areas', op)).filter((_, i) => i % every === 0);
    for (const f of files) {
      const a = JSON.parse(readFileSync(join(dir, 'areas', op, f), 'utf8')) as AreaFile;
      for (const line of [...new Set(a.patterns.map((p) => p.line))]) {
        const b = await core.lineBoard(a.id, line, { perDirection: 3 });
        checkBoard(b, 3);
        expect(b.state).not.toBe('missing');
        out.boards++;
        out.dirs[b.directions.length] = (out.dirs[b.directions.length] ?? 0) + 1;
        out.partial += b.directions.flatMap((d) => d.departures).filter((x) => x.partial).length;
      }
    }
  }
  return out;
}

describe.skipIf(!DIRS.length)('données réelles : tous les instantanés, échantillon de zones', () => {
  it('lineBoard sur toutes les lignes de 1 zone sur 40 : invariants tenus', async () => {
    for (const dir of DIRS) {
      const m = metaOf(dir);
      for (const day of m.serviceDates) {
        const env = makeEnv({ now: gtfsTime(day, 8 * 60), scene: 'noRT', dataDir: dir });
        const r = await sweep(env.core, dir, 40);
        console.log(`${day} 08:00 : ${r.boards} tableaux de ligne, sens ${JSON.stringify(r.dirs)}, ${r.partial} passages partiels`);
        expect(r.boards).toBeGreaterThan(100);
      }
    }
  }, 600_000);
});
