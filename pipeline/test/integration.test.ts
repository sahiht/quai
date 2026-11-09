/**
 * Intégration : les 4 zips de fixtures/pipeline/gtfs, QUAI_DATE = 2026-11-10, résultats attendus de fixtures/README.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AreaFile, Meta, Op, SearchFile, TileFile, TrainsDay } from '../../shared/types.ts';
import { tileKey } from '../../shared/types.ts';
import { matchesQuery, searchKey, searchWords } from '../../shared/names.ts';
import { buildData } from '../src/build.ts';
import type { BuildResult } from '../src/build.ts';
import { OPS } from '../src/config.ts';
import { distanceM } from '../src/areas.ts';
import { expandTrips, loadNetwork } from '../../fixtures/pipeline/make-gtfs.ts';
import { ServiceCalendar } from '../src/calendar.ts';
import { cleanupTempDirs, FIXTURE_ZIPS, tempDir } from './helpers.ts';

const DATES = ['2026-11-10', '2026-11-11'];
let out = '';
let site = '';
let result: BuildResult;
const logs: string[] = [];

const read = <T>(rel: string): T => JSON.parse(readFileSync(join(out, rel), 'utf8')) as T;
const areaFile = (id: string): AreaFile => {
  const [op, key] = id.split(':');
  return read<AreaFile>(`areas/${op}/${key.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
};

function listFiles(dir: string): string[] {
  const res: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) res.push(...listFiles(p));
    else res.push(p);
  }
  return res;
}

/** Zones à moins de r mètres d'un point, en lisant les tuiles qui couvrent le cercle. */
function nearby(lat: number, lon: number, r: number) {
  const dLat = r / 111_195 + 1e-9;
  const dLon = r / (111_195 * Math.cos((lat * Math.PI) / 180)) + 1e-9;
  const keys = new Set<string>();
  for (let y = lat - dLat; y <= lat + dLat + 0.02; y += 0.02) {
    for (let x = lon - dLon; x <= lon + dLon + 0.03; x += 0.03) keys.add(tileKey(Math.min(y, lat + dLat), Math.min(x, lon + dLon)));
  }
  const found: { id: string; d: number; modes: string[] }[] = [];
  for (const k of keys) {
    let tile: TileFile;
    try {
      tile = read<TileFile>(`tiles/${k}.json`);
    } catch {
      continue;
    }
    for (const a of tile.areas) {
      const d = distanceM(lat, lon, a.lat, a.lon);
      if (d <= r) found.push({ id: a.id, d, modes: a.modes });
    }
  }
  return { tiles: [...keys], found: found.sort((a, b) => a.d - b.d) };
}

beforeAll(async () => {
  const dir = tempDir();
  out = join(dir, 'site', 'data');
  site = join(dir, 'site');
  result = await buildData({
    out, site, dates: DATES,
    sources: Object.fromEntries(OPS.map((op) => [op, { kind: 'file', path: join(FIXTURE_ZIPS, `${op}.zip`) }])) as Parameters<typeof buildData>[0]['sources'],
    log: (m) => logs.push(m),
  });
});

afterAll(cleanupTempDirs);

describe('meta.json', () => {
  it('format, dates de service, tuiles, réseaux', () => {
    const meta = read<Meta>('meta.json');
    expect(meta).toMatchObject({ v: 1, timezone: 'Europe/Brussels', serviceDates: DATES, tile: { lat: 0.02, lon: 0.03 } });
    expect(new Date(meta.generatedAt).toISOString()).toBe(meta.generatedAt);
    expect(Object.keys(meta.feeds).sort()).toEqual(['delijn', 'sncb', 'stib', 'tec']);
    expect(meta.feeds.sncb).toEqual({ ok: true, areas: 14, trips: 11, feedVersion: '2026-11-09.sncb' });
    expect(meta.feeds.stib).toMatchObject({ ok: true, areas: 10, feedVersion: '20261109' });
    expect(meta.feeds.delijn).toMatchObject({ ok: true, areas: 7, feedVersion: 'DL-2026-11-09' });
    expect(meta.feeds.tec).toMatchObject({ ok: true, areas: 5, feedVersion: 'TEC-20261109' });
    expect(result.anyOk).toBe(true);
  });

  it('nombre de voyages = voyages de network.json actifs l’un des deux jours', () => {
    const net = loadNetwork();
    const cal = new ServiceCalendar(DATES);
    for (const [id, c] of Object.entries(net.calendars)) {
      cal.addCalendar(id, c.days.split('').map((x) => x === '1'), c.start.replace(/-/g, ''), c.end.replace(/-/g, ''));
      for (const d of c.remove ?? []) cal.addException(id, d.replace(/-/g, ''), 2);
      for (const d of c.add ?? []) cal.addException(id, d.replace(/-/g, ''), 1);
    }
    const meta = read<Meta>('meta.json');
    for (const op of OPS) {
      const expected = expandTrips(net, op).filter((t) => cal.mask(t.service)).length;
      expect(meta.feeds[op].trips, op).toBe(expected);
    }
  });

  it('meta.json est écrit en dernier', () => {
    const metaTime = statSync(join(out, 'meta.json')).mtimeMs;
    for (const f of listFiles(out)) expect(statSync(f).mtimeMs).toBeLessThanOrEqual(metaTime);
  });
});

describe('zones', () => {
  it('identifiants et noms attendus', () => {
    const expected: Record<string, object> = {
      'sncb:8812005': { fr: 'Bruxelles-Nord', nl: 'Brussel-Noord' },
      'sncb:8813003': { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' },
      'sncb:8863008': { fr: 'Namur', nl: 'Namen' },
      'sncb:8892007': { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters', l: 'nl' },
      'sncb:8893120': { fr: 'Gand-Dampoort', nl: 'Gent-Dampoort', l: 'nl' },
      'stib:6357F': { fr: 'Gare du Nord', nl: 'Noordstation' },
      'stib:6359': { fr: 'Rogier', nl: 'Rogier' },
      'stib:6364': { fr: 'Gare du Midi', nl: 'Zuidstation' },
      'delijn:308611': { fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' },
      'delijn:200553': { fr: 'Gand-Saint-Pierre', nl: 'Gent Sint-Pietersstation', l: 'nl' },
      'delijn:200101': { fr: 'Korenmarkt, Gand', nl: 'Gent Korenmarkt', l: 'nl' },
      'tec:N508aga': { fr: 'Namur Gare', nl: 'Namur Gare' },
      'tec:N509aaa': { fr: 'Namur Place Léopold', nl: 'Namur Place Léopold' },
    };
    for (const [id, n] of Object.entries(expected)) expect(areaFile(id).n, id).toEqual(n);
    expect(areaFile('stib:6357F')).toMatchObject({ lat: 50.86004, lon: 4.36017 });
    expect(areaFile('delijn:308611')).toMatchObject({ lat: 50.86183, lon: 4.35906 });
    expect(areaFile('sncb:8892007')).toMatchObject({ lat: 51.0359, lon: 3.7107 });
  });

  it('quais : SNCB (platform_code), De Lijn (perron), TEC (quai) ; rt STIB numérique', () => {
    expect(areaFile('sncb:8863008').stops).toEqual([
      { id: '8863008', rt: '8863008' },
      { id: '8863008_4', platform: '4', rt: '8863008_4' },
      { id: '8863008_5', platform: '5', rt: '8863008_5' },
      { id: '8863008_6', platform: '6', rt: '8863008_6' },
    ]);
    expect(areaFile('delijn:308611').stops).toEqual([
      { id: '308611', platform: '4', rt: '308611' },
      { id: '308613', platform: '6', rt: '308613' },
    ]);
    expect(areaFile('tec:N508aga').stops).toEqual([
      { id: 'N508aga', platform: 'A', rt: 'N508aga' },
      { id: 'N508agb', platform: 'B', rt: 'N508agb' },
    ]);
    expect(areaFile('stib:6357F').stops).toEqual([{ id: '6357F', rt: '6357' }, { id: '6358', rt: '6358' }]);
  });

  it('modes et lignes des résumés', () => {
    const tile = read<TileFile>(`tiles/${tileKey(50.86, 4.359)}.json`);
    const by = Object.fromEntries(tile.areas.map((a) => [a.id, a]));
    expect(by['stib:6357F']).toMatchObject({ modes: ['tram'], lines: ['3', '4'] });
    expect(by['sncb:8812005']).toMatchObject({ modes: ['train'], lines: ['IC', 'S1'] });
    expect(by['delijn:308611']).toMatchObject({ modes: ['bus'], lines: ['232', '270', '460'] });
    const south = read<TileFile>(`tiles/${tileKey(50.8569, 4.35888)}.json`);
    expect(south.areas.find((a) => a.id === 'stib:6359')).toMatchObject({ modes: ['metro', 'tram'], lines: ['2', '6', '3', '4'] });
  });
});

describe('scénarios de fixtures/README.md', () => {
  it('scénario 1 : 3 zones à moins de 500 m de Maison', () => {
    const { found } = nearby(50.4655, 4.859, 500);
    expect(found.map((f) => f.id)).toEqual(['tec:N509aaa', 'sncb:8863008', 'tec:N508aga']);
    expect(Math.round(found[0].d / 10) * 10).toBe(150);
    expect(Math.round(found[1].d / 10) * 10).toBe(420);
    expect(Math.round(found[2].d / 10) * 10).toBe(430);
  });

  it('scénario 2 : les tuiles du rayon contiennent les 4 zones proches, dans l’ordre attendu', () => {
    const { tiles, found } = nearby(50.86, 4.359, 500);
    expect(tiles).toContain('2543_145');
    expect(found.map((f) => f.id)).toEqual(['stib:6357F', 'sncb:8812005', 'delijn:308611', 'stib:6359']);
    expect(found.map((f) => Math.round(f.d / 10) * 10)).toEqual([80, 160, 200, 340]);
    // la tuile de la position contient les trois premières ; Rogier est dans la tuile voisine (limite 50,86)
    const own = read<TileFile>(`tiles/${tileKey(50.86, 4.359)}.json`).areas.map((a) => a.id);
    expect(own).toEqual(expect.arrayContaining(['stib:6357F', 'sncb:8812005', 'delijn:308611']));
    expect(read<TileFile>('tiles/2542_145.json').areas.map((a) => a.id)).toContain('stib:6359');
  });

  it('scénario 2 : Gare du Nord, T3 à 12:12, motif suivant Rogier à +2, départs filtrés', () => {
    const g = areaFile('stib:6357F');
    const at1212 = g.deps.filter((d) => d[0] === 0 && d[1] === 732);
    expect(at1212).toHaveLength(1);
    const p = g.patterns[at1212[0][2]];
    expect(p).toMatchObject({ line: '3', mode: 'tram', route: '3', head: { fr: 'Churchill', nl: 'Churchill' } });
    expect(p.next).toContainEqual(['stib:6359', 2]);
    const next5 = g.deps.filter((d) => d[0] === 0 && d[1] >= 730).slice(0, 5)
      .map((d) => `${g.patterns[d[2]].line} ${g.patterns[d[2]].head.fr} ${d[1] - 730}`);
    expect(next5).toEqual(['3 Churchill 2', '4 Stalle (P) 5', '3 Esplanade 6', '3 Churchill 10', '4 Stalle (P) 13']);
  });

  it('scénario 2 : Bruxelles-Nord De Lijn et SNCB après 12:10', () => {
    const dl = areaFile('delijn:308611');
    const dlNext = dl.deps.filter((d) => d[0] === 0 && d[1] >= 730).slice(0, 5)
      .map((d) => `${dl.patterns[d[2]].line} ${dl.patterns[d[2]].head.fr} ${d[1] - 730} ${d[4]} quai ${dl.stops[d[3]].platform}`);
    expect(dlNext).toEqual([
      '232 Vilvorde 5 702321215 quai 4', '460 Meise 8 704601218 quai 6', '270 Kortenberg 12 702701222 quai 4',
      '232 Vilvorde 20 702321230 quai 4', '232 Vilvorde 35 702321245 quai 4',
    ]);
    const nord = areaFile('sncb:8812005');
    const sn = nord.deps.filter((d) => d[0] === 0 && d[1] >= 730).slice(0, 3)
      .map((d) => `${nord.patterns[d[2]].line} ${d[1]} voie ${nord.stops[d[3]].platform} ${nord.patterns[d[2]].head.fr}`);
    expect(sn).toEqual(['IC 742 voie 9 Anvers-Central', 'IC 750 voie 12 Anvers-Central', 'S1 754 voie 3 Nivelles']);
  });

  it('jour férié : le 2026-11-11 à Namur, seuls l’IC 08:42 et l’IC 09:42', () => {
    const n = areaFile('sncb:8863008');
    expect(n.deps.filter((d) => d[0] === 1).map((d) => d[1])).toEqual([522, 582]);
    expect(n.deps.filter((d) => d[0] === 0).map((d) => d[1])).toEqual([462, 522]);
  });

  it('après minuit : IC 2199 à 24:01 (1441) à Bruxelles-Nord, bus TEC 4 à 24:10', () => {
    const nord = areaFile('sncb:8812005');
    const ic = nord.deps.filter((d) => d[4] === '88____:007::8814001:8821006:5:2436:20261231');
    expect(ic.map((d) => [d[0], d[1]])).toEqual([[0, 1441], [1, 1441]]);
    const tec = areaFile('tec:N508aga');
    const night = tec.deps.filter((d) => d[4] === 'N4-2410');
    expect(night.map((d) => [d[0], d[1], tec.patterns[d[2]].line, tec.stops[d[3]].platform])).toEqual([[0, 1450, '4', 'A'], [1, 1450, '4', 'A']]);
  });

  it('STIB : trip_id vide dans tous les départs ; autres réseaux : trip_id renseigné', () => {
    for (const f of readdirSync(join(out, 'areas/stib'))) {
      const a = read<AreaFile>(`areas/stib/${f}`);
      for (const d of a.deps) expect(d[4]).toBe('');
    }
    for (const op of ['sncb', 'delijn', 'tec']) {
      for (const f of readdirSync(join(out, `areas/${op}`))) {
        for (const d of read<AreaFile>(`areas/${op}/${f}`).deps) expect(d[4]).not.toBe('');
      }
    }
  });

  it('scénario 3 : recherche « Gand » dans search/ga.json', () => {
    const file = read<SearchFile>(`search/${searchKey('Gand')}.json`);
    const hits = file.items.filter((i) => matchesQuery('Gand', i.n.fr, i.n.nl)).map((i) => `${i.id} ${i.n.fr}`);
    expect(hits).toEqual(expect.arrayContaining([
      'sncb:8892007 Gand-Saint-Pierre', 'sncb:8893120 Gand-Dampoort', 'delijn:200101 Korenmarkt, Gand', 'delijn:200553 Gand-Saint-Pierre',
    ]));
    // « Gent Flanders Expo » (frName : « Flanders Expo, Gand ») répond aussi à « Gand »
    expect(hits).toContain('delijn:200900 Flanders Expo, Gand');
    expect(hits.slice(0, 2)).toEqual(['sncb:8893120 Gand-Dampoort', 'sncb:8892007 Gand-Saint-Pierre']); // gares d'abord
  });

  it('scénario 3 : trains Bruxelles-Central -> Gand-Saint-Pierre après 13:55', () => {
    const t = read<TrainsDay>('trains/2026-11-10.json');
    const idx = (id: string) => t.stations.findIndex((s) => s.id === id);
    const from = idx('sncb:8813003');
    const to = idx('sncb:8892007');
    const rides = t.trips.flatMap((trip) => {
      const a = trip.s.find((s) => s[0] === from);
      const b = trip.s.find((s) => s[0] === to);
      return a && b && a[4] < b[4] && a[2] >= 835 ? [`${trip.num} ${a[2]} -> ${b[1]} voie ${a[3]}`] : [];
    });
    expect(rides).toEqual(['1510 850 -> 879 voie 4', '1810 862 -> 893 voie 6', '1511 880 -> 909 voie 4']);
  });

  it('fichier de trains : IC 1810 avec ses quais, gares = zones SNCB', () => {
    const t = read<TrainsDay>('trains/2026-11-10.json');
    expect(t).toMatchObject({ v: 1, date: '2026-11-10' });
    const ic = t.trips.find((x) => x.num === '1810');
    expect(ic).toMatchObject({ id: '88____:007::8812005:8821006:7:1552:20261231', cat: 'IC', head: { fr: 'Anvers-Central', nl: 'Antwerpen-Centraal', l: 'nl' } });
    expect(ic?.s.map((s) => [t.stations[s[0]].id, s[1], s[2], s[3], s[4]])).toEqual([
      ['sncb:8812005', 858, 858, '12', 1], ['sncb:8813003', 862, 862, '6', 2], ['sncb:8814001', 866, 866, '12', 3],
      ['sncb:8892007', 893, 893, '9', 4], ['sncb:8893120', 901, 901, '2', 5], ['sncb:8821006', 952, 952, '22', 6],
    ]);
    const ic2112 = t.trips.find((x) => x.num === '2112');
    expect(ic2112?.s[5]).toEqual([t.stations.findIndex((s) => s.id === 'sncb:8812005'), 520, 521, '11', 6]);
    const holiday = read<TrainsDay>('trains/2026-11-11.json');
    expect(holiday.trips.map((x) => x.num).sort()).toEqual(['1510', '1511', '1810', '2113', '2192', '2199', '2312', '2412']);
    expect(t.trips.map((x) => x.num).sort()).toEqual(['1508', '1510', '1511', '1810', '1987', '2112', '2113', '2199', '2312', '2412']);
  });
});

describe('cohérence de tous les fichiers', () => {
  it('JSON valide et compact partout, aucun tiret cadratin', () => {
    for (const f of listFiles(out).filter((p) => p.endsWith('.json'))) {
      const text = readFileSync(f, 'utf8');
      expect(() => JSON.parse(text), relative(out, f)).not.toThrow();
      expect(text.includes('\n'), relative(out, f)).toBe(false);
      expect(text.includes('\u2014'), relative(out, f)).toBe(false);
    }
  });

  it('aucun fichier ne référence une zone absente ; index et tris valides', () => {
    const ids = new Set<string>();
    for (const op of OPS) for (const f of readdirSync(join(out, `areas/${op}`))) ids.add(read<AreaFile>(`areas/${op}/${f}`).id);
    expect(ids.size).toBe(36);
    for (const f of readdirSync(join(out, 'tiles'))) {
      const tile = read<TileFile>(`tiles/${f}`);
      for (const a of tile.areas) {
        expect(ids.has(a.id), a.id).toBe(true);
        expect(`${tileKey(a.lat, a.lon)}.json`).toBe(f);
        expect(a.lines.length).toBeLessThanOrEqual(12);
        expect(a.modes.length).toBeGreaterThan(0);
      }
    }
    for (const id of ids) {
      const a = areaFile(id);
      expect(a.id).toBe(id);
      for (const p of a.patterns) {
        expect(p.next.length).toBeLessThanOrEqual(60);
        for (const [nid, min] of p.next) {
          expect(ids.has(nid), `${id} -> ${nid}`).toBe(true);
          expect(min).toBeGreaterThanOrEqual(0);
        }
      }
      let prev = -1;
      for (const d of a.deps) {
        expect(d[2]).toBeLessThan(a.patterns.length);
        expect(d[3]).toBeLessThan(a.stops.length);
        const key = d[0] * 100000 + d[1];
        expect(key).toBeGreaterThanOrEqual(prev);
        prev = key;
      }
    }
    for (const f of readdirSync(join(out, 'search'))) {
      const k = f.replace('.json', '');
      expect(k).toMatch(/^[a-z0-9]{2}$/);
      for (const item of read<SearchFile>(`search/${f}`).items) {
        expect(ids.has(item.id)).toBe(true);
        expect(searchWords(item.n.fr, item.n.nl).map(searchKey)).toContain(k);
      }
    }
    for (const date of DATES) {
      const t = read<TrainsDay>(`trains/${date}.json`);
      for (const s of t.stations) expect(ids.has(s.id), s.id).toBe(true);
      for (const trip of t.trips) for (const s of trip.s) expect(s[0]).toBeLessThan(t.stations.length);
    }
  });

  it('chaque zone est trouvable par la recherche sous chacun de ses mots', () => {
    for (const op of OPS) {
      for (const f of readdirSync(join(out, `areas/${op}`))) {
        const a = read<AreaFile>(`areas/${op}/${f}`);
        for (const w of searchWords(a.n.fr, a.n.nl)) {
          expect(read<SearchFile>(`search/${searchKey(w)}.json`).items.some((i) => i.id === a.id), `${a.id} ${w}`).toBe(true);
        }
      }
    }
  });

  it('licence et page d’état', () => {
    const lic = readFileSync(join(out, 'LICENSE-DATA.txt'), 'utf8');
    expect(lic).toContain('Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0');
    expect(lic).toContain('https://creativecommons.org/licenses/by/4.0/');
    const html = readFileSync(join(site, 'index.html'), 'utf8');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Données&nbsp;: SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0');
    expect(html).toContain('mardi 10 novembre 2026');
    expect(html).toContain('href="data/meta.json"');
    expect(html).toMatch(/Données générées le .*2026/);
    expect(html).not.toContain('\u2014');
    for (const label of ['SNCB', 'STIB', 'De Lijn', 'TEC']) expect(html).toContain(`<th scope="row">${label}</th>`);
  });

  it('journal sans tiret cadratin', () => {
    expect(logs.length).toBeGreaterThan(4);
    for (const l of logs) expect(l.includes('\u2014')).toBe(false);
  });
});

describe('reproductibilité', () => {
  it('deux exécutions donnent les mêmes fichiers (hors date de génération)', async () => {
    const out2 = join(tempDir(), 'data');
    await buildData({
      out: out2, dates: DATES, log: () => undefined,
      sources: Object.fromEntries(OPS.map((op: Op) => [op, { kind: 'file', path: join(FIXTURE_ZIPS, `${op}.zip`) }])) as Parameters<typeof buildData>[0]['sources'],
    });
    const a = listFiles(out).map((f) => relative(out, f)).filter((f) => f !== 'meta.json' && f !== 'LICENSE-DATA.txt').sort();
    const b = listFiles(out2).map((f) => relative(out2, f)).filter((f) => f !== 'meta.json' && f !== 'LICENSE-DATA.txt').sort();
    expect(b).toEqual(a);
    for (const f of a) expect(readFileSync(join(out2, f), 'utf8'), f).toBe(readFileSync(join(out, f), 'utf8'));
  });
});
