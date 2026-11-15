/**
 * 1.2.10 : cadence du graphe piéton (pipeline/src/walk/weekly.ts, cli.ts) et étapes du flux « Données de nuit » :
 * extrait téléchargé au plus une fois par semaine (MD5 contrôlé), tuiles de la semaine d'avant gardées en cas
 * d'échec, échange interrompu rattrapé, publication dans les données de la nuit avec la licence ODbL, jamais bloquant.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/walk/cli.ts';
import { downloadExtract, isoWeek, publishWalk, readTiles, weeklyWalk, type WeeklyOptions } from '../src/walk/weekly.ts';
import { cleanupTempDirs, ROOT_DIR, tempDir } from './helpers.ts';
import { ll, osmXml, writePbf, writeXml } from './walk-helpers.ts';

afterAll(cleanupTempDirs);

const URL_PBF = 'https://download.example/europe/belgium-latest.osm.pbf';
const quiet = () => undefined;

/** Petit extrait PBF : une rue et un escalier près de Bruxelles-Central. */
function extract(): Buffer {
  const pts = [ll(0, 0), ll(0, 250), ll(150, 250)];
  return writePbf(
    pts.map(([lat, lon], i) => ({ id: 10 + i, lat, lon })),
    [{ id: 1, refs: [10, 11], tags: { highway: 'pedestrian', name: 'Rue Neuve' } }, { id: 2, refs: [11, 12], tags: { highway: 'steps' } }],
    { timestamp: 1_762_900_000 },
  );
}

/** Faux serveur Geofabrik : extrait et empreinte MD5, compte des téléchargements. */
function geofabrik(body: Buffer = extract(), o: { md5?: string; status?: number } = {}) {
  const s = { downloads: 0, md5calls: 0, status: o.status ?? 200 };
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('.md5')) {
      s.md5calls++;
      return new Response(`${o.md5 ?? createHash('md5').update(body).digest('hex')}  belgium-latest.osm.pbf\n`, { status: 200 });
    }
    s.downloads++;
    if (s.status !== 200) return new Response('indisponible', { status: s.status });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { s, fetchImpl };
}

const opts = (cacheDir: string, fetchImpl: typeof fetch, date: string, extra: Partial<WeeklyOptions> = {}): WeeklyOptions => ({
  cacheDir, url: URL_PBF, fetchImpl, now: () => new Date(`${date}T01:30:00Z`), log: quiet, retries: 0, backoffMs: [0], ...extra,
});

describe('semaine ISO', () => {
  it('lundi au dimanche, années à 53 semaines', () => {
    expect(isoWeek('2026-11-09')).toBe('2026-W46');
    expect(isoWeek('2026-11-15')).toBe('2026-W46');
    expect(isoWeek('2026-11-16')).toBe('2026-W47');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2027-01-04')).toBe('2027-W01');
    expect(isoWeek('2025-12-29')).toBe('2026-W01');
  });
});

describe('graphe de la semaine', () => {
  it('cache vide : téléchargement, MD5, construction, échange ; l’extrait n’est plus gardé ensuite', async () => {
    const cache = tempDir('quai-walk-cache-');
    const g = geofabrik();
    const r = await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-10'));
    expect(r.state).toBe('built');
    expect(g.s.downloads).toBe(1);
    expect(g.s.md5calls).toBe(1);
    const idx = await readTiles(join(cache, 'tiles'));
    expect(idx?.version).toBe('2025-11-11');
    expect(idx?.builtAt).toBe('2026-11-10T01:30:00.000Z');
    expect(JSON.parse(readFileSync(join(cache, 'extract.json'), 'utf8'))).toMatchObject({ v: 1, week: '2026-W46', date: '2026-11-10' });
    expect(existsSync(join(cache, 'extract.osm.pbf'))).toBe(false);
    expect(existsSync(join(cache, 'next'))).toBe(false);
    expect(existsSync(join(cache, 'tiles.old'))).toBe(false);
  });

  it('même semaine : rien à faire (aucun téléchargement) ; semaine suivante : refait', async () => {
    const cache = tempDir('quai-walk-cache-');
    const g = geofabrik();
    await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-10'));
    const again = await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-15'));
    expect(again.state).toBe('fresh');
    expect(g.s.downloads).toBe(1);
    const next = await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-16'));
    expect(next.state).toBe('built');
    expect(g.s.downloads).toBe(2);
    expect((await readTiles(join(cache, 'tiles')))?.builtAt).toBe('2026-11-16T01:30:00.000Z');
  });

  it('portail en panne : échec, tuiles de la semaine d’avant intactes ; nouvel essai la nuit suivante', async () => {
    const cache = tempDir('quai-walk-cache-');
    const ok = geofabrik();
    await weeklyWalk(opts(cache, ok.fetchImpl, '2026-11-10'));
    const before = readdirSync(join(cache, 'tiles')).map((f) => readFileSync(join(cache, 'tiles', f), 'utf8'));
    const down = geofabrik(extract(), { status: 503 });
    const r = await weeklyWalk(opts(cache, down.fetchImpl, '2026-11-17'));
    expect(r).toMatchObject({ state: 'failed', message: expect.stringContaining('HTTP 503') });
    expect(readdirSync(join(cache, 'tiles')).map((f) => readFileSync(join(cache, 'tiles', f), 'utf8'))).toEqual(before);
    down.s.status = 200;
    expect((await weeklyWalk(opts(cache, down.fetchImpl, '2026-11-18'))).state).toBe('built');
  });

  it('MD5 différent : extrait rejeté, rien de gardé', async () => {
    const cache = tempDir('quai-walk-cache-');
    const g = geofabrik(extract(), { md5: '0'.repeat(32) });
    const r = await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-10'));
    expect(r).toMatchObject({ state: 'failed', message: expect.stringContaining('MD5') });
    expect(existsSync(join(cache, 'extract.osm.pbf'))).toBe(false);
    expect(existsSync(join(cache, 'extract.json'))).toBe(false);
    expect(existsSync(join(cache, 'tiles'))).toBe(false);
  });

  it('extrait illisible : échec, gardé pour la nuit suivante sans nouveau téléchargement la même semaine', async () => {
    const cache = tempDir('quai-walk-cache-');
    const g = geofabrik(Buffer.from('pas un fichier PBF'));
    expect((await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-10'))).state).toBe('failed');
    expect(existsSync(join(cache, 'extract.osm.pbf'))).toBe(true);
    expect((await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-11'))).state).toBe('failed');
    expect(g.s.downloads).toBe(1);
    // extrait de la semaine retiré du cache : pas de second téléchargement la même semaine…
    rmSync(join(cache, 'extract.osm.pbf'));
    const r = await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-12'));
    expect(r).toMatchObject({ state: 'failed', message: expect.stringContaining('déjà téléchargé cette semaine') });
    expect(g.s.downloads).toBe(1);
    // … sauf pour la vérification d'une branche (lancée à la main)
    const fixed = geofabrik();
    expect((await weeklyWalk(opts(cache, fixed.fetchImpl, '2026-11-12', { force: true }))).state).toBe('built');
    expect(fixed.s.downloads).toBe(1);
  });

  it('vérification (force) : graphe refait même si les tuiles de la semaine existent, extrait de la semaine repris', async () => {
    const cache = tempDir('quai-walk-cache-');
    const g = geofabrik(Buffer.from('pas un fichier PBF'));
    await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-10'));
    // l'extrait de la semaine est dans le cache (construction ratée) : la vérification le reprend sans télécharger
    writeFileSync(join(cache, 'extract.osm.pbf'), extract());
    const info = JSON.parse(readFileSync(join(cache, 'extract.json'), 'utf8'));
    writeFileSync(join(cache, 'extract.json'), JSON.stringify({ ...info, bytes: extract().length }));
    const r = await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-11', { force: true }));
    expect(r.state).toBe('built');
    expect(g.s.downloads).toBe(1);
  });

  it('échange interrompu (tiles absent, tiles.old présent) : rattrapé à la nuit suivante', async () => {
    const cache = tempDir('quai-walk-cache-');
    const g = geofabrik();
    await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-10'));
    renameSync(join(cache, 'tiles'), join(cache, 'tiles.old'));
    expect((await weeklyWalk(opts(cache, g.fetchImpl, '2026-11-11'))).state).toBe('fresh');
    const data = tempDir('quai-walk-data-');
    writeFileSync(join(data, 'LICENSE-DATA.txt'), 'GTFS\n');
    expect((await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-11T02:00:00Z'), log: quiet })).published).toBe(true);
    expect(existsSync(join(data, 'walk', 'index.json'))).toBe(true);
  });
});

describe('publication dans les données de la nuit', () => {
  async function ready(date = '2026-11-10'): Promise<string> {
    const cache = tempDir('quai-walk-cache-');
    await weeklyWalk(opts(cache, geofabrik().fetchImpl, date));
    return cache;
  }

  it('tuiles et index copiés (index en dernier), licence ODbL ajoutée une seule fois, taille journalisée', async () => {
    const cache = await ready();
    const data = tempDir('quai-walk-data-');
    writeFileSync(join(data, 'LICENSE-DATA.txt'), 'Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0.\n');
    const logs: string[] = [];
    const r = await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-10T02:00:00Z'), log: (m) => logs.push(m) });
    expect(r).toMatchObject({ published: true, tiles: 1 });
    expect(readdirSync(join(data, 'walk')).sort()).toEqual(readdirSync(join(cache, 'tiles')).sort());
    await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-10T02:00:00Z'), log: quiet });
    const lic = readFileSync(join(data, 'LICENSE-DATA.txt'), 'utf8');
    expect(lic.startsWith('Données : SNCB')).toBe(true);
    expect(lic.match(/Chemins à pied \(dossier walk\/\)/g)).toHaveLength(1);
    expect(lic).toContain('© les contributeurs d’OpenStreetMap, licence ODbL 1.0');
    expect(lic).toContain('données OpenStreetMap du 2025-11-11');
    expect(lic).not.toMatch(/[\u2013\u2014]/);
    expect(logs.join('\n')).toMatch(/Chemins à pied publiés : 1 tuiles, [\d,]+ Mo \(budget 80,0 Mo\)/);
  });

  it('aucune tuile, tuiles trop vieilles ou incomplètes : rien de publié (chemin droit dans l’appli), jamais d’erreur', async () => {
    const data = tempDir('quai-walk-data-');
    mkdirSync(join(data, 'walk'));
    writeFileSync(join(data, 'walk', 'vieux.json'), '{}');
    const none = await publishWalk({ cacheDir: tempDir('quai-walk-cache-'), dataDir: data, log: quiet });
    expect(none).toMatchObject({ published: false, message: expect.stringContaining('chemin droit') });
    expect(existsSync(join(data, 'walk'))).toBe(false);
    const cache = await ready('2026-08-01');
    const old = await publishWalk({ cacheDir: cache, dataDir: data, now: () => new Date('2026-11-10T02:00:00Z'), log: quiet });
    expect(old).toMatchObject({ published: false, message: expect.stringContaining('trop anciennes') });
    const fresh = await ready();
    rmSync(join(fresh, 'tiles', readdirSync(join(fresh, 'tiles')).find((f) => f !== 'index.json') as string));
    const broken = await publishWalk({ cacheDir: fresh, dataDir: data, now: () => new Date('2026-11-10T02:00:00Z'), log: quiet });
    expect(broken.published).toBe(false);
    expect(existsSync(join(data, 'walk'))).toBe(false);
  });
});

describe('ligne de commande', () => {
  it('build, publish ; arguments manquants : code 2 ; avertissements GitHub en français, jamais bloquants', async () => {
    const dir = tempDir('quai-walk-cli-');
    const input = writeXml(dir, 'mini.osm', osmXml({ 1: ll(0, 0), 2: ll(0, 300) }, [{ id: 1, nodes: [1, 2], tags: { highway: 'footway' } }]));
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);
    expect(await main(['build', '--input', input, '--out', join(dir, 'walk')], {}, log)).toBe(0);
    expect(existsSync(join(dir, 'walk', 'index.json'))).toBe(true);
    expect(await main(['build', '--input', input], {}, log)).toBe(2);
    expect(await main(['weekly'], {}, log)).toBe(2);
    expect(await main(['publish', '--cache', join(dir, 'rien')], {}, log)).toBe(2);
    expect(await main(['autre'], {}, log)).toBe(2);
    logs.length = 0;
    expect(await main(['publish', '--cache', join(dir, 'rien'), '--data', join(dir, 'data')], { GITHUB_ACTIONS: 'true' }, log)).toBe(0);
    expect(logs[0]).toMatch(/^::warning title=Chemins à pied::aucune tuile prête/);
    expect(await main(['build', '--input', join(dir, 'absent.osm'), '--out', join(dir, 'x')], {}, log)).toBe(1);
  });
});

describe('extrait local, sans réseau (QUAI_WALK_OSM)', () => {
  it('extrait des fixtures : data/walk construit, licence avec la source locale ; sans extrait : code 2 ; illisible : code 1', async () => {
    const data = tempDir('quai-walk-local-');
    writeFileSync(join(data, 'LICENSE-DATA.txt'), 'GTFS\n');
    const logs: string[] = [];
    const osm = join(ROOT_DIR, 'fixtures', 'pipeline', 'osm', 'namur-bruxelles.osm');
    expect(await main(['local', '--data', data], { QUAI_WALK_OSM: osm }, (m) => logs.push(m))).toBe(0);
    const idx = await readTiles(join(data, 'walk'));
    expect(idx).toMatchObject({ version: '2026-11-08', source: 'OpenStreetMap, extrait local namur-bruxelles.osm', tiles: 5 });
    const lic = readFileSync(join(data, 'LICENSE-DATA.txt'), 'utf8');
    expect(lic).toContain('OpenStreetMap, extrait local namur-bruxelles.osm, données OpenStreetMap du 2026-11-08');
    expect(await main(['local', '--data', data, '--input', osm], {}, (m) => logs.push(m))).toBe(0);
    expect(readFileSync(join(data, 'LICENSE-DATA.txt'), 'utf8').match(/Chemins à pied \(dossier walk\/\)/g)).toHaveLength(1);
    expect(await main(['local', '--data', data], {}, (m) => logs.push(m))).toBe(2);
    const bad = writeXml(data, 'vide.osm', osmXml({ 1: ll(0, 0), 2: ll(0, 10) }, [{ id: 1, nodes: [1, 2], tags: { highway: 'motorway' } }]));
    expect(await main(['local', '--data', data, '--input', bad], { GITHUB_ACTIONS: 'true' }, (m) => logs.push(m))).toBe(1);
    expect(logs[logs.length - 1]).toMatch(/^::warning title=Chemins à pied::extrait local inutilisable/);
    expect(existsSync(join(data, 'walk'))).toBe(false);
  });
});

describe('flux « Données de nuit » (nightly.yml)', () => {
  interface Step { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; 'continue-on-error'?: boolean; 'timeout-minutes'?: number; 'working-directory'?: string; with?: Record<string, unknown> }
  const text = readFileSync(join(ROOT_DIR, '.github', 'workflows', 'nightly.yml'), 'utf8');
  const steps = (parse(text) as { jobs: { build: { steps: Step[] } } }).jobs.build.steps;
  const i = (pred: (s: Step) => boolean) => steps.findIndex(pred);

  it('graphe de la semaine puis publication, entre les données et la sauvegarde du cache, jamais bloquants', () => {
    const data = i((s) => s.id === 'data');
    const walk = i((s) => s.id === 'walk');
    const pub = i((s) => s.name === 'Publier les chemins à pied (site/data/walk)');
    const save = i((s) => s.uses === 'actions/cache/save@v6');
    expect(data).toBeGreaterThanOrEqual(0);
    expect(walk).toBeGreaterThan(data);
    expect(pub).toBeGreaterThan(walk);
    expect(save).toBeGreaterThan(pub);
    expect(steps[walk]).toMatchObject({
      name: 'Graphe piéton OpenStreetMap (une fois par semaine)',
      if: "${{ !cancelled() && steps.data.outcome == 'success' }}",
      'continue-on-error': true,
      'working-directory': 'pipeline',
      run: 'node --experimental-strip-types src/walk/cli.ts weekly --cache ../gtfs-cache/walk --stops ../site/data',
      env: { QUAI_WALK_FORCE: "${{ inputs.verification && '1' || '' }}" },
    });
    // 1.2.10 (vérification du 15/11) : l'extrait de Belgique peut demander plus de 12 min ; téléchargement repris, délai
    // total de 40 min, puis la construction : l'étape a 60 min, la tâche de nuit assez pour tout (données comprises)
    expect(steps[walk]['timeout-minutes']).toBe(60);
    const job = (parse(text) as { jobs: { build: { 'timeout-minutes': number } } }).jobs.build;
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(120);
    expect(steps[pub]).toMatchObject({
      if: "${{ !cancelled() && steps.data.outcome == 'success' }}",
      'continue-on-error': true,
      'working-directory': 'pipeline',
      run: 'node --experimental-strip-types src/walk/cli.ts publish --cache ../gtfs-cache/walk --data ../site/data',
    });
    // cache des nuits : le dossier gtfs-cache contient walk/ (extrait et tuiles)
    expect(steps[save].with?.path).toBe('gtfs-cache');
  });

  it('balayage des chemins à pied après Quai Web, avant l’envoi, sans bloquer', () => {
    const scan = i((s) => s.name === 'Balayer les chemins à pied');
    expect(steps[scan]).toMatchObject({
      if: "${{ steps.webapp.outcome == 'success' }}",
      'continue-on-error': true,
      'working-directory': 'app',
      env: { QUAI_SCAN_DATA: '../site/data' },
      run: 'npx vitest run test/core/walk-scan',
    });
    expect(scan).toBeGreaterThan(i((s) => s.id === 'webapp'));
    expect(scan).toBeLessThan(i((s) => s.uses === 'actions/upload-pages-artifact@v5'));
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('1.2.10 : téléchargement de l’extrait repris là où il s’est arrêté (vérification du 15/11)', () => {
  const body = Buffer.from(Array.from({ length: 50_000 }, (_, i) => (i * 7) % 251));
  const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
  /** Flux qui livre `first`, puis se coupe (l'erreur vient après la lecture du morceau, comme une vraie coupure). */
  const cutStream = (first: Buffer) => {
    let n = 0;
    return new ReadableStream<Uint8Array>({
      pull(c) {
        if (n++ === 0) c.enqueue(new Uint8Array(first));
        else c.error(new Error('connexion coupée'));
      },
    });
  };
  /** Portail : coupe la 1re réponse après `cut` octets ; reprend avec « Range » si « If-Range » vaut son ETag. */
  function portal(o: { cut: number; etag?: string; changed?: Buffer }) {
    const calls: { range?: string; ifRange?: string }[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ range: h.get('range') ?? undefined, ifRange: h.get('if-range') ?? undefined });
      const etag = o.etag ?? '"v1"';
      const range = /^bytes=(\d+)-$/.exec(h.get('range') ?? '');
      if (calls.length === 1) {
        const stream = cutStream(body.subarray(0, o.cut));
        return new Response(stream, { status: 200, headers: { etag, 'content-length': String(body.length) } });
      }
      if (o.changed) return new Response(new Uint8Array(o.changed), { status: 200, headers: { etag: '"v2"', 'content-length': String(o.changed.length) } });
      if (range && h.get('if-range') === etag) {
        const from = Number(range[1]);
        const rest = body.subarray(from);
        return new Response(new Uint8Array(rest), { status: 206, headers: { etag, 'content-range': `bytes ${from}-${body.length - 1}/${body.length}`, 'content-length': String(rest.length) } });
      }
      return new Response(new Uint8Array(body), { status: 200, headers: { etag, 'content-length': String(body.length) } });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('coupure : le 2e essai reprend au même octet (Range, If-Range) ; fichier entier, MD5 juste, rien qui traîne', async () => {
    const dir = tempDir('walk-dl');
    const dest = join(dir, 'extract.osm.pbf');
    const p = portal({ cut: 20_000 });
    const logs: string[] = [];
    const got = await downloadExtract(URL_PBF, dest, { fetchImpl: p.fetchImpl, retries: 2, backoffMs: [0], log: (m) => logs.push(m), progressBytes: 10_000 });
    expect(got).toEqual({ bytes: body.length, md5: md5(body) });
    expect(readFileSync(dest).equals(body)).toBe(true);
    expect(p.calls).toEqual([{}, { range: 'bytes=20000-', ifRange: '"v1"' }]);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(existsSync(`${dest}.part.json`)).toBe(false);
    expect(logs.some((l) => l.includes('gardés pour la reprise'))).toBe(true);
    expect(logs.some((l) => /reprise à/.test(l))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/[\u2013\u2014]/);
  });

  it('fichier du portail changé entre deux essais : renvoyé en entier, tout recommence, MD5 du nouveau fichier', async () => {
    const dir = tempDir('walk-dl');
    const dest = join(dir, 'extract.osm.pbf');
    const changed = Buffer.from(body.subarray(0, 30_000).map((x) => 255 - x));
    const p = portal({ cut: 20_000, changed });
    const got = await downloadExtract(URL_PBF, dest, { fetchImpl: p.fetchImpl, retries: 2, backoffMs: [0], log: quiet });
    expect(got).toEqual({ bytes: changed.length, md5: md5(changed) });
    expect(readFileSync(dest).equals(changed)).toBe(true);
  });

  it('sans ETag ni Last-Modified : pas de reprise possible, le morceau ne sert pas ; délai total épuisé : erreur en français', async () => {
    const dir = tempDir('walk-dl');
    const dest = join(dir, 'extract.osm.pbf');
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response(cutStream(body.subarray(0, 1000)), { status: 200 });
    }) as typeof fetch;
    await expect(downloadExtract(URL_PBF, dest, { fetchImpl, retries: 1, backoffMs: [0], log: quiet })).rejects.toThrow(/^téléchargement de l'extrait impossible/);
    expect(n).toBe(2);
    expect(existsSync(dest)).toBe(false);
    await expect(downloadExtract(URL_PBF, dest, { fetchImpl, retries: 3, backoffMs: [0], log: quiet, timeoutMs: 0 })).rejects.toThrow(/délai global dépassé/);
  });

  it('panne réseau : la cause est au journal (« fetch failed : ECONNREFUSED »)', async () => {
    const dir = tempDir('walk-dl');
    const dest = join(dir, 'extract.osm.pbf');
    const logs: string[] = [];
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    }) as typeof fetch;
    await expect(downloadExtract(URL_PBF, dest, { fetchImpl, retries: 0, backoffMs: [0], log: (m) => logs.push(m) })).rejects.toThrow('fetch failed : ECONNREFUSED');
    expect(logs[0]).toContain('essai 1 échoué (fetch failed : ECONNREFUSED)');
  });

  it('réponse plus courte qu’annoncé : extrait tronqué, jamais renommé comme complet', async () => {
    const dir = tempDir('walk-dl');
    const dest = join(dir, 'extract.osm.pbf');
    const fetchImpl = (async () => new Response(new Uint8Array(body.subarray(0, 100)), { status: 200, headers: { 'content-length': String(body.length) } })) as typeof fetch;
    await expect(downloadExtract(URL_PBF, dest, { fetchImpl, retries: 0, backoffMs: [0], log: quiet })).rejects.toThrow(/tronqué|impossible/);
    expect(existsSync(dest)).toBe(false);
  });
});
