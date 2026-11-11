/**
 * Préparation complète des données : pour chaque opérateur, obtention du zip (fichier local ou téléchargement)
 * puis traitement ; un échec n'arrête pas les autres. Écrit tiles/, areas/, search/, trains/, puis (1.1) les
 * fichiers de ligne lines/{op}/, lines/index.json et linetiles/, LICENSE-DATA.txt, puis meta.json EN DERNIER
 * (un lecteur ne voit jamais un meta.json qui annonce des fichiers absents).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AreaSummary, Meta, Op, SearchFile, TileFile, TrainsDay } from '../../shared/types.ts';
import { tileKey } from '../../shared/types.ts';
import { searchKey, searchWords } from '../../shared/names.ts';
import { OP_LABEL, OPS } from './config.ts';
import type { Source } from './config.ts';
import { ddmm, readCached, storeCached } from './cache.ts';
import { CsvError } from './csv.ts';
import { brusselsDate } from './dates.ts';
import { DownloadError, downloadFeed, maskSecrets } from './download.ts';
import type { DownloadOptions } from './download.ts';
import { FeedError, processFeed } from './feed.ts';
import type { FeedResult } from './feed.ts';
import { buildLineOutputs } from './lines.ts';
import type { LineData } from './lines.ts';
import { MODE_RANK } from './modes.ts';
import { RefNames } from './naming.ts';
import { mb } from './report.ts';
import { licenseText, statusPage } from './site.ts';
import { JsonWriter } from './writer.ts';
import { ZipError } from './zip.ts';

export const TILE = { lat: 0.02, lon: 0.03 };

export interface BuildOptions {
  out: string;
  site?: string;
  dates: string[];
  key?: string;
  sources: Record<Op, Source>;
  log?: (msg: string) => void;
  /** Dossier des GTFS gardés (option --cache-dir) : repli quand le flux de la nuit est inutilisable. */
  cacheDir?: string;
  /** Réglages du téléchargement (tests : attentes courtes, fetch simulé). */
  download?: Partial<Omit<DownloadOptions, 'targets' | 'dest' | 'key'>>;
  now?: () => Date;
}

export interface BuildResult {
  meta: Meta;
  /** Au moins un opérateur a réussi. */
  anyOk: boolean;
  results: Partial<Record<Op, FeedResult>>;
  files: number;
  bytes: number;
}

/** Message d'erreur en français, sans secret. */
export function errorMessage(e: unknown, secrets: (string | undefined)[]): string {
  let msg: string;
  if (e instanceof DownloadError || e instanceof FeedError || e instanceof ZipError || e instanceof CsvError) msg = e.message;
  else if (e instanceof Error) msg = `erreur inattendue (${e.message})`;
  else msg = `erreur inattendue (${String(e)})`;
  return maskSecrets(msg, secrets).replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** Vide les sorties d'une exécution précédente (meta.json d'abord). */
async function prepareOut(out: string): Promise<void> {
  await mkdir(out, { recursive: true });
  await rm(join(out, 'meta.json'), { force: true });
  for (const d of ['tiles', 'areas', 'search', 'trains', 'lines', 'linetiles']) await rm(join(out, d), { recursive: true, force: true });
  await rm(join(out, 'LICENSE-DATA.txt'), { force: true });
}

function mainRank(modes: string[]): number {
  const r = MODE_RANK.findIndex((m) => modes.includes(m));
  return r < 0 ? MODE_RANK.length : r;
}

/**
 * 1.1 : écrit lines/{op}/{routeKey}.json, linetiles/{ty}_{tx}.json et lines/index.json, et journalise leur taille
 * (brute et gzip niveau 6, comme GitHub Pages). Renvoie Meta.lines.
 */
export async function writeLineFiles(writer: JsonWriter, lineData: LineData[], stations: { id: string; lat: number; lon: number }[],
  generatedAt: string, say: (m: string) => void): Promise<NonNullable<Meta['lines']>> {
  const out = buildLineOutputs(lineData, stations, generatedAt);
  for (const w of out.warnings) say(`Fichiers de ligne : attention, ${w}`);
  const sizes = new Map<string, { n: number; raw: number; gz: number }>();
  const put = async (group: string, rel: string, data: unknown) => {
    const buf = Buffer.from(JSON.stringify(data), 'utf8');
    const g = sizes.get(group) ?? { n: 0, raw: 0, gz: 0 };
    g.n++;
    g.raw += buf.length;
    g.gz += gzipSync(buf, { level: 6 }).length;
    sizes.set(group, g);
    await writer.writeBuffer(rel, buf);
  };
  for (const { path, file } of out.files) await put(file.op, path, file);
  for (const [k, t] of out.tiles) await put('linetiles', `linetiles/${k}.json`, t);
  await put('index', 'lines/index.json', out.index);
  await writer.flush();
  const sum = (keys: string[]) => keys.reduce((s, k) => {
    const g = sizes.get(k);
    return g ? { n: s.n + g.n, raw: s.raw + g.raw, gz: s.gz + g.gz } : s;
  }, { n: 0, raw: 0, gz: 0 });
  const all = sum(['stib', 'delijn', 'tec']);
  const byOp = (['stib', 'delijn', 'tec'] as const).filter((op) => sizes.has(op)).map((op) => `${OP_LABEL[op]} ${sizes.get(op)?.n}`).join(', ');
  const tiles = sum(['linetiles']);
  const index = sum(['index']);
  say(`Fichiers de ligne : ${all.n} lignes${byOp ? ` (${byOp})` : ''}, ${mb(all.raw)} bruts, ${mb(all.gz)} en gzip ; `
    + `index ${mb(index.raw)} (${mb(index.gz)} en gzip) ; ${tiles.n} tuiles de lignes, ${mb(tiles.raw)} (${mb(tiles.gz)} en gzip)`);
  return { files: out.files.length, ops: out.ops, conn: out.index.conn };
}

export async function buildData(o: BuildOptions): Promise<BuildResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const secrets = [o.key];
  const say = (m: string) => log(maskSecrets(m, secrets));
  await prepareOut(o.out);
  const writer = new JsonWriter(o.out);
  const tmp = await mkdtemp(join(tmpdir(), 'quai-gtfs-'));

  // téléchargements lancés tous ensemble (réseau), traitements ensuite un par un (mémoire)
  const obtained = new Map<Op, Promise<{ path?: string; error?: string }>>();
  for (const op of OPS) {
    const src = o.sources[op];
    if (src.kind === 'file') obtained.set(op, Promise.resolve({ path: src.path }));
    else if (src.kind === 'missing') obtained.set(op, Promise.resolve({ error: src.reason }));
    else {
      const dest = join(tmp, `${op}.zip`);
      say(`${OP_LABEL[op]} : téléchargement...`);
      obtained.set(op, downloadFeed({ ...o.download, targets: src.targets, dest, key: o.key, log: say })
        .then((r) => {
          say(`${OP_LABEL[op]} : ${(r.bytes / 1048576).toFixed(1).replace('.', ',')} Mo reçus (${r.target.label}, ${(r.ms / 1000).toFixed(1).replace('.', ',')} s)`);
          return { path: dest };
        })
        .catch((e: unknown) => ({ error: errorMessage(e, secrets) })));
    }
  }

  const feeds = {} as Meta['feeds'];
  const results: Partial<Record<Op, FeedResult>> = {};
  const summaries: AreaSummary[] = [];
  /** Zones sans aucun départ : fichier de zone écrit, mais absentes des tuiles et de la recherche (S5). */
  const idle = new Set<string>();
  const lineData: LineData[] = [];
  /** Noms traduits des zones SNCB et STIB, pour les noms français De Lijn (traitée ensuite). */
  const refNames = new RefNames();
  let trains: TrainsDay[] | undefined;
  const at = o.now ? o.now() : new Date();
  const today = brusselsDate(at);

  /** Traite un zip ; un flux sans aucun voyage sur les deux journées est une erreur (le repli reste possible). */
  const prepare = async (op: Op, zipPath: string): Promise<FeedResult> => {
    try {
      const r = await processFeed({ op, zipPath, dates: o.dates, writer, log: say, refNames: op === 'delijn' ? refNames : undefined });
      await writer.flush();
      if (r.trips === 0) throw new FeedError(`aucun voyage les ${o.dates.map(ddmm).join(' et ')}`);
      return r;
    } catch (e) {
      await writer.flush().catch(() => undefined);
      // fichiers de zone déjà écrits pour ce réseau : inutiles (aucune tuile ne les annonce), on les retire
      await rm(join(o.out, 'areas', op), { recursive: true, force: true }).catch(() => undefined);
      throw e;
    }
  };
  const accept = (op: Op, r: FeedResult, cachedFrom?: string): void => {
    results[op] = r;
    for (const a of r.areas) summaries.push(a);
    for (const id of r.idle) idle.add(id);
    if (r.lines) lineData.push(...r.lines);
    if (op === 'sncb' || op === 'stib') for (const a of r.areas) refNames.add(a.n, a.lat, a.lon);
    if (r.trains) trains = r.trains;
    feeds[op] = { ok: true, areas: r.areas.length, trips: r.trips, ...(r.feedVersion ? { feedVersion: r.feedVersion } : {}), ...(cachedFrom ? { cachedFrom } : {}) };
  };

  try {
    for (const op of OPS) {
      const src = o.sources[op];
      const got = await (obtained.get(op) as Promise<{ path?: string; error?: string }>);
      let failure = got.error ?? 'source indisponible';
      if (got.path) {
        try {
          say(`${OP_LABEL[op]} : traitement...`);
          const r = await prepare(op, got.path);
          accept(op, r);
          if (o.cacheDir && src.kind === 'download') {
            // gardé seulement après une préparation réussie : un flux cassé ne remplace jamais le bon
            await storeCached(o.cacheDir, op, got.path, { date: today, savedAt: at.toISOString(), feedVersion: r.feedVersion })
              .then(() => say(`${OP_LABEL[op]} : GTFS gardé pour les nuits suivantes`))
              .catch((e: unknown) => say(`${OP_LABEL[op]} : GTFS non gardé (${errorMessage(e, secrets)})`));
          }
          continue;
        } catch (e) {
          failure = errorMessage(e, secrets);
        } finally {
          if (src.kind === 'download') await rm(got.path, { force: true }).catch(() => undefined);
        }
      }
      // repli : GTFS gardé d'une nuit précédente (au plus CACHE_MAX_AGE_DAYS jours)
      if (o.cacheDir) {
        const c = await readCached(o.cacheDir, op, today);
        if ('path' in c) {
          try {
            say(`${OP_LABEL[op]} : ${failure} ; repli sur le GTFS gardé du ${ddmm(c.entry.date)}`);
            accept(op, await prepare(op, c.path), c.entry.date);
            continue;
          } catch (e) {
            failure = `${failure} ; GTFS gardé du ${ddmm(c.entry.date)} inutilisable (${errorMessage(e, secrets)})`;
          }
        } else if (src.kind === 'download') {
          failure = `${failure} ; pas de repli (${c.reason})`;
        }
      }
      feeds[op] = { ok: false, error: maskSecrets(failure, secrets).slice(0, 500), areas: 0, trips: 0 };
      say(`${OP_LABEL[op]} : en erreur, ${feeds[op].error}`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }

  /* tuiles et recherche : zones qui ont au moins un départ */
  const listed = summaries.filter((a) => !idle.has(a.id));
  if (idle.size) say(`${idle.size} zone(s) sans aucun départ, absentes des tuiles et de la recherche`);
  const tiles = new Map<string, AreaSummary[]>();
  for (const a of listed) {
    const k = tileKey(a.lat, a.lon, TILE);
    const list = tiles.get(k);
    if (list) list.push(a);
    else tiles.set(k, [a]);
  }
  for (const [k, areas] of tiles) {
    areas.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const file: TileFile = { v: 1, areas };
    await writer.write(`tiles/${k}.json`, file);
  }

  /* recherche */
  const search = new Map<string, SearchFile['items']>();
  for (const a of listed) {
    const keys = new Set(searchWords(a.n.fr, a.n.nl).map(searchKey).filter((k) => /^[a-z0-9]{2}$/.test(k)));
    const item = { id: a.id, op: a.op, n: a.n, modes: a.modes, lat: a.lat, lon: a.lon };
    for (const k of keys) {
      const list = search.get(k);
      if (list) list.push(item);
      else search.set(k, [item]);
    }
  }
  for (const [k, items] of search) {
    items.sort((x, y) => mainRank(x.modes) - mainRank(y.modes) || x.n.fr.localeCompare(y.n.fr, 'fr') || (x.id < y.id ? -1 : 1));
    const file: SearchFile = { v: 1, items };
    await writer.write(`search/${k}.json`, file);
  }

  /* trains du jour (fichiers vides si la SNCB est en erreur) */
  for (let d = 0; d < o.dates.length; d++) {
    const file: TrainsDay = trains?.[d] ?? { v: 1, date: o.dates[d], stations: [], trips: [] };
    await writer.write(`trains/${o.dates[d]}.json`, file);
  }
  await writer.flush();

  /* 1.1 : fichiers de ligne (même generatedAt que meta.json) ; en cas d'échec, aucun fichier de ligne */
  const generatedAt = (o.now ? o.now() : new Date()).toISOString();
  let lines: Meta['lines'];
  if (OPS.some((op) => feeds[op].ok)) {
    try {
      const stations = summaries.filter((a) => a.op === 'sncb').map((a) => ({ id: a.id, lat: a.lat, lon: a.lon }));
      lines = await writeLineFiles(writer, lineData, stations, generatedAt, say);
    } catch (e) {
      say(`Fichiers de ligne : en erreur (${errorMessage(e, secrets)}) ; pas de fichiers de ligne cette nuit`);
      await writer.flush().catch(() => undefined);
      for (const d of ['lines', 'linetiles']) await rm(join(o.out, d), { recursive: true, force: true }).catch(() => undefined);
      lines = undefined;
    }
  }
  lineData.length = 0;

  const meta: Meta = {
    v: 1,
    generatedAt,
    timezone: 'Europe/Brussels',
    serviceDates: o.dates,
    tile: TILE,
    feeds,
    ...(lines ? { lines } : {}),
  };
  const license = licenseText(meta);
  await writeFile(join(o.out, 'LICENSE-DATA.txt'), license, 'utf8');
  const metaJson = JSON.stringify(meta);
  await writeFile(join(o.out, 'meta.json'), metaJson, 'utf8'); // en dernier
  if (o.site) {
    await mkdir(o.site, { recursive: true });
    const rel = relative(o.site, o.out).split(/[\\/]/).join('/') || '.';
    await writeFile(join(o.site, 'index.html'), statusPage(meta, rel), 'utf8');
  }
  return {
    meta,
    anyOk: OPS.some((op) => feeds[op].ok),
    results,
    files: writer.files + 2,
    bytes: writer.bytes + Buffer.byteLength(license) + Buffer.byteLength(metaJson),
  };
}
