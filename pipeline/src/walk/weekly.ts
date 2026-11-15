/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : graphe piéton refait au plus une fois par semaine, dans le cache des nuits
 * (gtfs-cache/walk, gardé par actions/cache) :
 *
 *   tiles/          tuiles prêtes à publier (index.json écrit en dernier)
 *   extract.json    fiche du dernier téléchargement de l'extrait (semaine ISO, octets, MD5)
 *   extract.osm.pbf extrait Geofabrik, gardé seulement tant que les tuiles de sa semaine n'ont pas été construites
 *
 * Chaque nuit : tuiles de la semaine déjà là → rien ; sinon extrait de la semaine (téléchargé une seule fois par
 * semaine, contrôle MD5) → construction dans next/ → échange (tiles devient tiles.old, next devient tiles). Un échec
 * ne touche jamais aux tuiles de la semaine précédente. La publication (publishWalk) copie les tuiles dans les
 * données de la nuit ; sans tuiles, rien n'est publié et l'appli retombe sur le chemin droit.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join } from 'node:path';
import { isWalkIndex, type WalkIndex } from '../../../app/src/core/walk/format.ts';
import { addDays, brusselsDate } from '../dates.ts';
import { buildWalk, sizeLine } from './build.ts';
import { PbfFile } from './pbf.ts';
import { ATTRIBUTION, BUDGET_BYTES, MAX_TILE_BYTES } from './tiles.ts';

export const GEOFABRIK_URL = 'https://download.geofabrik.de/europe/belgium-latest.osm.pbf';
/** Tuiles plus vieilles que cela : plus publiées (le chemin droit vaut mieux que des rues d'il y a deux mois). */
export const MAX_AGE_DAYS = 60;

export interface ExtractInfo {
  v: 1;
  week: string;
  date: string;
  bytes: number;
  md5?: string;
}

/** Semaine ISO 8601 d'une date « AAAA-MM-JJ » : « 2026-W46 ». */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Index des tuiles d'un dossier, s'il est valide et complet (autant de tuiles que l'index en annonce). */
export async function readTiles(dir: string): Promise<WalkIndex | null> {
  const idx = await readJson(join(dir, 'index.json'));
  if (!isWalkIndex(idx)) return null;
  try {
    const n = (await readdir(dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').length;
    return n === idx.tiles ? idx : null;
  } catch {
    return null;
  }
}

export interface DownloadOpts {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  stallMs?: number;
  retries?: number;
  backoffMs?: number[];
  log?: (m: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Télécharge `url` dans `dest` (écrit à côté puis renommé) ; renvoie octets et MD5. Erreur en français. */
export async function downloadExtract(url: string, dest: string, o: DownloadOpts = {}): Promise<{ bytes: number; md5: string }> {
  const doFetch = o.fetchImpl ?? fetch;
  const log = o.log ?? (() => undefined);
  const retries = o.retries ?? 2;
  const backoff = o.backoffMs ?? [10_000, 30_000];
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    const ctrl = new AbortController();
    const overall = setTimeout(() => ctrl.abort(new Error('délai global dépassé')), o.timeoutMs ?? 12 * 60_000);
    let stall: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => ctrl.abort(new Error('aucune donnée reçue')), o.stallMs ?? 60_000);
    };
    const part = `${dest}.part`;
    try {
      arm();
      const res = await doFetch(url, { headers: { 'User-Agent': 'quai-pipeline/1.0 (+donnees ouvertes)' }, signal: ctrl.signal });
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${res.status}`);
      }
      const hash = createHash('md5');
      const out = createWriteStream(part);
      let bytes = 0;
      try {
        for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
          arm();
          bytes += chunk.length;
          hash.update(chunk);
          if (!out.write(chunk)) await once(out, 'drain');
        }
        out.end();
        await once(out, 'close');
      } catch (e) {
        out.destroy();
        throw e;
      }
      if (!bytes) throw new Error('réponse vide');
      await rename(part, dest);
      return { bytes, md5: hash.digest('hex') };
    } catch (e) {
      await rm(part, { force: true }).catch(() => undefined);
      const reason = ctrl.signal.aborted ? String((ctrl.signal.reason as Error)?.message ?? 'interrompu') : e instanceof Error ? e.message : String(e);
      last = reason;
      log(`Chemins à pied : téléchargement de l'extrait, essai ${attempt + 1} échoué (${reason})`);
    } finally {
      clearTimeout(overall);
      if (stall) clearTimeout(stall);
    }
  }
  throw new Error(`téléchargement de l'extrait impossible (${last})`);
}

/** MD5 publié à côté de l'extrait (« <empreinte>  belgium-latest.osm.pbf ») ; null s'il est introuvable. */
export async function publishedMd5(url: string, o: DownloadOpts = {}): Promise<string | null> {
  try {
    const res = await (o.fetchImpl ?? fetch)(`${url}.md5`, { headers: { 'User-Agent': 'quai-pipeline/1.0 (+donnees ouvertes)' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const m = /^([0-9a-f]{32})\b/i.exec((await res.text()).trim());
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface WeeklyOptions extends DownloadOpts {
  cacheDir: string;
  stopsDir?: string;
  url?: string;
  /** reconstruire même si les tuiles de la semaine existent (branche de vérification) ; l'extrait de la semaine resert */
  force?: boolean;
  now?: () => Date;
}

export interface WeeklyResult {
  state: 'fresh' | 'built' | 'failed';
  message: string;
  index?: WalkIndex;
}

/** Étape de nuit : tuiles de la semaine (voir l'en-tête). Ne lève jamais. */
export async function weeklyWalk(o: WeeklyOptions): Promise<WeeklyResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const now = o.now ? o.now() : new Date();
  const today = brusselsDate(now);
  const week = isoWeek(today);
  const tilesDir = join(o.cacheDir, 'tiles');
  const pbf = join(o.cacheDir, 'extract.osm.pbf');
  const info = join(o.cacheDir, 'extract.json');
  try {
    await mkdir(o.cacheDir, { recursive: true });
    const current = (await readTiles(tilesDir)) ?? (await readTiles(join(o.cacheDir, 'tiles.old')));
    if (current && !o.force && isoWeek(brusselsDate(new Date(current.builtAt))) === week) {
      return { state: 'fresh', message: `tuiles de la semaine déjà prêtes (données OSM du ${current.version})`, index: current };
    }
    // extrait de la semaine : téléchargé au plus une fois par semaine
    const known = (await readJson(info)) as ExtractInfo | null;
    let have = false;
    if (known && known.v === 1 && known.week === week) {
      const s = await stat(pbf).catch(() => null);
      have = !!s && s.size === known.bytes;
      if (!have) return { state: 'failed', message: `extrait déjà téléchargé cette semaine (${known.date}) mais absent du cache : nouvel essai la semaine prochaine` };
    }
    if (!have) {
      const url = o.url ?? GEOFABRIK_URL;
      log(`Chemins à pied : téléchargement de ${url}`);
      const t0 = Date.now();
      const got = await downloadExtract(url, pbf, o);
      const expected = await publishedMd5(url, o);
      if (expected && expected !== got.md5) {
        await rm(pbf, { force: true });
        throw new Error('extrait reçu incomplet (empreinte MD5 différente)');
      }
      const rec: ExtractInfo = { v: 1, week, date: today, bytes: got.bytes, md5: got.md5 };
      await writeFile(info, JSON.stringify(rec));
      log(`Chemins à pied : extrait reçu, ${(got.bytes / 1e6).toFixed(1).replace('.', ',')} Mo en ${Math.round((Date.now() - t0) / 1000)} s${expected ? ', MD5 vérifié' : ', MD5 non publié'}`);
    }
    // contrôle rapide du fichier (en-tête PBF lisible)
    new PbfFile(pbf).close();
    const next = join(o.cacheDir, 'next');
    const r = await buildWalk({ input: pbf, out: next, stopsDir: o.stopsDir, log, now: () => now });
    // échange : les anciennes tuiles ne disparaissent qu'une fois les nouvelles en place
    const old = join(o.cacheDir, 'tiles.old');
    await rm(old, { recursive: true, force: true });
    if (await readTiles(tilesDir)) await rename(tilesDir, old);
    else await rm(tilesDir, { recursive: true, force: true });
    await rename(next, tilesDir);
    await rm(old, { recursive: true, force: true });
    await rm(pbf, { force: true });
    return { state: 'built', message: `tuiles construites en ${Math.round(r.ms / 1000)} s : ${sizeLine(r.built)}`, index: r.built.index };
  } catch (e) {
    await rm(join(o.cacheDir, 'next'), { recursive: true, force: true }).catch(() => undefined);
    return { state: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

export interface PublishResult {
  published: boolean;
  message: string;
  tiles?: number;
  bytes?: number;
}

const LICENSE_MARK = 'Chemins à pied (dossier walk/)';

export function licenseSection(idx: WalkIndex): string {
  return `
${LICENSE_MARK} : ${ATTRIBUTION}, licence ODbL 1.0 (Open Database License,
https://opendatacommons.org/licenses/odbl/1-0/ ; https://www.openstreetmap.org/copyright).
Base de données dérivée de l'extrait Geofabrik belgium-latest.osm.pbf (données OpenStreetMap du ${idx.version}) :
voies praticables à pied, carrefours, géométrie simplifiée (environ 2 m), noms de rue, marches, sens uniques à pied.
Elle est diffusée sous la même licence (ODbL 1.0).
`;
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(p);
    else if (e.isFile()) total += (await stat(p)).size;
  }
  return total;
}

/** Copie les tuiles du cache dans les données de la nuit (dataDir/walk) et complète LICENSE-DATA.txt. Ne lève jamais. */
export async function publishWalk(o: { cacheDir: string; dataDir: string; now?: () => Date; log?: (m: string) => void }): Promise<PublishResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const today = brusselsDate(o.now ? o.now() : new Date());
  const out = join(o.dataDir, 'walk');
  try {
    await rm(out, { recursive: true, force: true });
    let src = join(o.cacheDir, 'tiles');
    let idx = await readTiles(src);
    if (!idx) {
      // échange interrompu la nuit d'avant : les tuiles précédentes sont restées dans tiles.old
      src = join(o.cacheDir, 'tiles.old');
      idx = await readTiles(src);
    }
    if (!idx) return { published: false, message: 'aucune tuile prête : chemins à pied non publiés cette nuit (l’appli retombe sur le chemin droit)' };
    const built = brusselsDate(new Date(idx.builtAt));
    if (built < addDays(today, -MAX_AGE_DAYS)) {
      return { published: false, message: `tuiles du ${built} trop anciennes (plus de ${MAX_AGE_DAYS} jours) : chemins à pied non publiés` };
    }
    await mkdir(out, { recursive: true });
    const files = (await readdir(src)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
    for (const f of files) await copyFile(join(src, f), join(out, f));
    await copyFile(join(src, 'index.json'), join(out, 'index.json'));
    const licence = join(o.dataDir, 'LICENSE-DATA.txt');
    const had = await readFile(licence, 'utf8').catch(() => '');
    if (!had.includes(LICENSE_MARK)) await appendFile(licence, licenseSection(idx), 'utf8');
    const bytes = await dirBytes(out);
    const total = await dirBytes(o.dataDir);
    const mo = (b: number) => `${(b / 1e6).toFixed(1).replace('.', ',')} Mo`;
    log(`Chemins à pied publiés : ${files.length} tuiles, ${mo(bytes)} (budget ${mo(BUDGET_BYTES)}), plus grosse ${Math.round(idx.maxTileBytes / 1000)} ko (budget ${MAX_TILE_BYTES / 1000} ko), données OSM du ${idx.version}`);
    log(`Données de la nuit avec les chemins à pied : ${mo(total)}`);
    return { published: true, message: 'publié', tiles: files.length, bytes };
  } catch (e) {
    await rm(out, { recursive: true, force: true }).catch(() => undefined);
    return { published: false, message: `publication impossible (${e instanceof Error ? e.message : String(e)}) : chemins à pied absents cette nuit` };
  }
}
