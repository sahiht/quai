/**
 * 1.2.10 (PRD-1.2.10 § 3.8) : graphe piéton refait au plus une fois par semaine, dans le cache des nuits
 * (gtfs-cache/walk, gardé par actions/cache) :
 *
 *   tiles/          tuiles prêtes à publier (index.json écrit en dernier)
 *   extract.json    fiche du dernier téléchargement de l'extrait (semaine ISO, octets, MD5)
 *   extract.osm.pbf extrait Geofabrik, gardé seulement tant que les tuiles de sa semaine n'ont pas été construites
 *   exits.json      1.3.1 (R1) : sorties du métro faites avec le même extrait (exits.ts), publiées en data/exits.json
 *   exits-try.json  1.3.1 (finitions) : pour quelles tuiles les sorties ont déjà été essayées (voir plus bas)
 *
 * Chaque nuit : tuiles de la semaine déjà là → rien ; sinon extrait de la semaine (téléchargé une seule fois par
 * semaine, contrôle MD5) → construction dans next/ → échange (tiles devient tiles.old, next devient tiles). Un échec
 * ne touche jamais aux tuiles de la semaine précédente. La publication (publishWalk) copie les tuiles dans les
 * données de la nuit ; sans tuiles, rien n'est publié et l'appli retombe sur le chemin droit.
 *
 * 1.3.1 (finitions du 21/11, contrôle de R1, remarque 4) : les sorties dès la première nuit. Des tuiles de la semaine
 * sans sorties publiables (fichier absent, d'une autre forme ou d'une autre version : des tuiles faites par la 1.3.0,
 * qui ne faisait pas de sorties) seraient restées sans sorties jusqu'à 7 jours. La nuit refait alors les tuiles et les
 * sorties, par le même chemin que chaque semaine (l'extrait n'est plus dans le cache : il est téléchargé une fois de
 * plus cette semaine-là). Une seule fois : avant de commencer, exits-try.json note les tuiles concernées, et chaque
 * construction y note les siennes ; pour des tuiles déjà notées, la nuit ne refait rien, que l'essai ait réussi ou
 * non. Un rattrapage raté garde les tuiles de la semaine et ne laisse aucun extrait dans le cache ; les sorties
 * viennent alors avec les tuiles de la semaine suivante.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { isWalkIndex, type WalkIndex } from '../../../app/src/core/walk/format.ts';
import { addDays, brusselsDate } from '../dates.ts';
import { EXITS_FILE, isExitsFile } from '../../../app/src/core/walk/exits-format.ts';
import { buildWalk, sizeLine } from './build.ts';
import { writeExits } from './exits.ts';
import { PbfFile } from './pbf.ts';
import { ATTRIBUTION, BUDGET_BYTES, MAX_TILE_BYTES } from './tiles.ts';

export const GEOFABRIK_URL = 'https://download.geofabrik.de/europe/belgium-latest.osm.pbf';
/** Tuiles plus vieilles que cela : plus publiées (le chemin droit vaut mieux que des rues d'il y a deux mois). */
export const MAX_AGE_DAYS = 60;

/** Fiche des sorties déjà essayées, dans le cache. */
export const EXITS_TRY_FILE = 'exits-try.json';
/**
 * Forme de exits.json que cette version sait faire (le `v` accepté par isExitsFile). À augmenter avec lui : les
 * tuiles déjà notées pour l'ancienne forme sont alors refaites une fois avec leurs sorties.
 */
export const EXITS_FORMAT = 1;

/** Sorties déjà essayées pour les tuiles construites à `builtAt`, dans la forme `format`. */
export interface ExitsTry {
  v: 1;
  format: number;
  builtAt: string;
  date: string;
  /** vrai si les sorties ont été écrites ; absent tant que l'essai est en cours ou s'il a échoué */
  ok?: boolean;
}

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
  /** délai total du téléchargement, tous essais compris (reprise comprise) */
  timeoutMs?: number;
  stallMs?: number;
  retries?: number;
  backoffMs?: number[];
  log?: (m: string) => void;
  /** journal de progression tous les N octets (64 Mo par défaut) */
  progressBytes?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mo1 = (b: number) => `${(b / 1e6).toFixed(0)} Mo`;

/** Fiche du morceau déjà reçu (`<dest>.part.json`) : de quoi reprendre au même octet, sur le même fichier du portail. */
interface PartInfo {
  v: 1;
  url: string;
  etag?: string;
  lastModified?: string;
}

async function readPart(part: string, url: string): Promise<{ size: number; info: PartInfo } | null> {
  const info = (await readJson(`${part}.json`)) as PartInfo | null;
  if (!info || info.v !== 1 || info.url !== url || (!info.etag && !info.lastModified)) return null;
  const s = await stat(part).catch(() => null);
  return s && s.size > 0 ? { size: s.size, info } : null;
}

async function dropPart(part: string): Promise<void> {
  await rm(part, { force: true }).catch(() => undefined);
  await rm(`${part}.json`, { force: true }).catch(() => undefined);
}

/** MD5 des octets déjà reçus (reprise) : lu par morceaux, jamais tout en mémoire. */
async function hashFile(path: string, hash: ReturnType<typeof createHash>): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
}

/**
 * Télécharge `url` dans `dest` (écrit à côté dans `<dest>.part`, puis renommé) ; renvoie octets et MD5. Erreur en
 * français. 1.2.10 (vérification du 15/11 : extrait de Belgique trop lent pour un seul essai de 12 min) : un essai
 * interrompu laisse son morceau ; l'essai suivant reprend au même octet (« Range » et « If-Range » : si le fichier du
 * portail a changé entre-temps, il est renvoyé en entier et tout recommence). Délai total pour tous les essais ;
 * progression journalisée (octets, débit).
 */
export async function downloadExtract(url: string, dest: string, o: DownloadOpts = {}): Promise<{ bytes: number; md5: string }> {
  const doFetch = o.fetchImpl ?? fetch;
  const log = o.log ?? (() => undefined);
  const retries = o.retries ?? 4;
  const backoff = o.backoffMs ?? [10_000, 30_000, 60_000];
  const every = o.progressBytes ?? 64 * 1024 * 1024;
  const deadline = Date.now() + (o.timeoutMs ?? 40 * 60_000);
  const part = `${dest}.part`;
  let last = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    const left = deadline - Date.now();
    if (left <= 0) {
      last = last || 'délai global dépassé';
      break;
    }
    const ctrl = new AbortController();
    const overall = setTimeout(() => ctrl.abort(new Error('délai global dépassé')), left);
    let stall: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => ctrl.abort(new Error('aucune donnée reçue')), o.stallMs ?? 60_000);
    };
    let out: ReturnType<typeof createWriteStream> | undefined;
    try {
      arm();
      const have = await readPart(part, url);
      const headers: Record<string, string> = { 'User-Agent': 'quai-pipeline/1.0 (+donnees ouvertes)' };
      if (have) {
        headers.Range = `bytes=${have.size}-`;
        headers['If-Range'] = have.info.etag ?? have.info.lastModified ?? '';
      }
      const res = await doFetch(url, { headers, signal: ctrl.signal });
      if (res.status === 416) {
        // morceau inutilisable (plus long que le fichier du portail) : tout recommence à l'essai suivant
        await res.body?.cancel().catch(() => undefined);
        await dropPart(part);
        throw new Error('reprise refusée (HTTP 416)');
      }
      if (!(res.status === 200 || res.status === 206) || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${res.status}`);
      }
      const hash = createHash('md5');
      let from = 0;
      if (res.status === 206 && have) {
        const m = /^bytes (\d+)-/i.exec(res.headers.get('content-range') ?? '');
        if (!m || Number(m[1]) !== have.size) {
          await res.body.cancel().catch(() => undefined);
          await dropPart(part);
          throw new Error('reprise incohérente (Content-Range)');
        }
        from = have.size;
        await hashFile(part, hash);
        log(`Chemins à pied : reprise à ${mo1(from)}`);
      } else if (res.status === 206) {
        // morceau demandé sans reprise : réponse inattendue
        await res.body.cancel().catch(() => undefined);
        throw new Error('réponse partielle inattendue (HTTP 206)');
      } else {
        // fichier entier : nouveau départ, et de quoi reprendre au même octet si l'essai est interrompu
        const etag = res.headers.get('etag') ?? undefined;
        const lastModified = res.headers.get('last-modified') ?? undefined;
        await dropPart(part);
        if (etag || lastModified) await writeFile(`${part}.json`, JSON.stringify({ v: 1, url, etag, lastModified } satisfies PartInfo));
      }
      const total = from + Number(res.headers.get('content-length') ?? 0);
      out = createWriteStream(part, { flags: from ? 'a' : 'w' });
      const t0 = Date.now();
      let bytes = from;
      let next = from + every;
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        arm();
        bytes += chunk.length;
        hash.update(chunk);
        if (!out.write(chunk)) await once(out, 'drain');
        if (bytes >= next) {
          next += every;
          const rate = (bytes - from) / Math.max(1, (Date.now() - t0) / 1000);
          log(`Chemins à pied : ${mo1(bytes)}${total > from ? ` sur ${mo1(total)}` : ''} reçus (${(rate / 1e6).toFixed(1).replace('.', ',')} Mo/s)`);
        }
      }
      out.end();
      await once(out, 'close');
      out = undefined;
      if (!bytes) throw new Error('réponse vide');
      if (total > from && bytes !== total) throw new Error(`extrait tronqué (${bytes} octets sur ${total})`);
      await rename(part, dest);
      await rm(`${part}.json`, { force: true }).catch(() => undefined);
      return { bytes, md5: hash.digest('hex') };
    } catch (e) {
      if (out) {
        out.end();
        await once(out, 'close').catch(() => undefined);
      }
      // cause réseau sous « fetch failed » (refus, délai de connexion, nom introuvable) : utile au journal
      const cause = (e as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
      const detail = cause ? String(cause.code ?? cause.message ?? '') : '';
      const reason = ctrl.signal.aborted
        ? String((ctrl.signal.reason as Error)?.message ?? 'interrompu')
        : e instanceof Error
          ? `${e.message}${detail ? ` : ${detail}` : ''}`
          : String(e);
      last = reason;
      const kept = await stat(part).catch(() => null);
      log(`Chemins à pied : téléchargement de l'extrait, essai ${attempt + 1} échoué (${reason})${kept?.size ? `, ${mo1(kept.size)} gardés pour la reprise` : ''}`);
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
  /** 1.3.1 : vrai quand la nuit a refait (ou voulu refaire) des tuiles de la semaine pour avoir leurs sorties */
  catchUp?: boolean;
}

/**
 * 1.3.1 (finitions) : pourquoi les tuiles `idx` du cache n'ont pas de sorties publiables (la même règle que
 * publishExits) ; null si elles en ont. Ne lève jamais.
 */
export async function exitsGap(cacheDir: string, idx: WalkIndex): Promise<string | null> {
  const raw = await readJson(join(cacheDir, EXITS_FILE));
  if (!raw) return 'fichier des sorties absent';
  if (!isExitsFile(raw)) return 'fichier des sorties d’une autre forme';
  if (raw.version !== idx.version) return `sorties du ${raw.version}, tuiles du ${idx.version}`;
  return null;
}

/** Les sorties ont-elles déjà été essayées pour ces tuiles, dans la forme d'aujourd'hui ? */
async function exitsTried(cacheDir: string, idx: WalkIndex): Promise<boolean> {
  const t = (await readJson(join(cacheDir, EXITS_TRY_FILE))) as ExitsTry | null;
  return !!t && t.v === 1 && t.format === EXITS_FORMAT && t.builtAt === idx.builtAt;
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
  const tryFile = join(o.cacheDir, EXITS_TRY_FILE);
  let catchUp = false;
  try {
    await mkdir(o.cacheDir, { recursive: true });
    const current = (await readTiles(tilesDir)) ?? (await readTiles(join(o.cacheDir, 'tiles.old')));
    if (current && !o.force && isoWeek(brusselsDate(new Date(current.builtAt))) === week) {
      const ready = `tuiles de la semaine déjà prêtes (données OSM du ${current.version})`;
      const gap = await exitsGap(o.cacheDir, current);
      if (!gap) return { state: 'fresh', message: ready, index: current };
      if (await exitsTried(o.cacheDir, current)) {
        return { state: 'fresh', message: `${ready} ; sorties du métro déjà essayées pour ces tuiles (${gap}) : prochain essai avec les tuiles de la semaine prochaine`, index: current };
      }
      // 1.3.1 : tuiles de la semaine sans sorties publiables → refaites une fois avec leurs sorties. La fiche est
      // écrite avant tout le reste : quoi qu'il arrive ensuite, les nuits suivantes ne recommencent pas.
      await writeFile(tryFile, JSON.stringify({ v: 1, format: EXITS_FORMAT, builtAt: current.builtAt, date: today } satisfies ExitsTry));
      catchUp = true;
      log(`Chemins à pied : tuiles de la semaine sans sorties du métro (${gap}) : tuiles et sorties refaites une fois, cette nuit seulement`);
    }
    // extrait de la semaine : téléchargé au plus une fois par semaine
    const known = (await readJson(info)) as ExtractInfo | null;
    let have = false;
    if (known && known.v === 1 && known.week === week) {
      const s = await stat(pbf).catch(() => null);
      have = !!s && s.size === known.bytes;
      // nuits ordinaires : jamais deux téléchargements la même semaine ; la vérification (lancée à la main) le peut,
      // et le rattrapage des sorties aussi, une fois (l'extrait de la semaine n'est plus gardé après la construction)
      if (!have && !o.force && !catchUp) return { state: 'failed', message: `extrait déjà téléchargé cette semaine (${known.date}) mais absent du cache : nouvel essai la semaine prochaine` };
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
    // échange : il reste toujours un jeu de tuiles valide (tiles ou tiles.old) jusqu'à ce que les nouvelles soient en place
    const old = join(o.cacheDir, 'tiles.old');
    if (await readTiles(tilesDir)) {
      await rm(old, { recursive: true, force: true });
      await rename(tilesDir, old);
    } else {
      await rm(tilesDir, { recursive: true, force: true });
    }
    await rename(next, tilesDir);
    await rm(old, { recursive: true, force: true });
    // 1.3.1 (R1) : sorties du métro avec le même extrait et les mêmes tuiles (exits.json, à côté des tuiles) ; un échec
    // ne touche ni aux tuiles ni à la nuit : la publication garde alors les sorties de la même version, sinon aucune
    const ex = await writeExits({ pbf, tilesDir, out: join(o.cacheDir, EXITS_FILE), version: r.built.index.version, builtAt: r.built.index.builtAt });
    log(`Chemins à pied : ${ex.message}`);
    // sorties essayées pour ces tuiles-ci (réussies ou non) : la nuit suivante ne les refait pas
    const tried: ExitsTry = { v: 1, format: EXITS_FORMAT, builtAt: r.built.index.builtAt, date: today, ...(ex.ok ? { ok: true } : {}) };
    await writeFile(tryFile, JSON.stringify(tried)).catch(() => undefined);
    await rm(pbf, { force: true });
    const what = catchUp ? 'tuiles et sorties du métro refaites (rattrapage, une seule fois)' : 'tuiles construites';
    return { state: 'built', message: `${what} en ${Math.round(r.ms / 1000)} s : ${sizeLine(r.built)}`, index: r.built.index, ...(catchUp ? { catchUp } : {}) };
  } catch (e) {
    await rm(join(o.cacheDir, 'next'), { recursive: true, force: true }).catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    if (!catchUp) return { state: 'failed', message };
    // rattrapage raté : il ne sera pas rejoué, son extrait (entier ou en morceau) ne sert donc plus à rien dans le cache
    await rm(pbf, { force: true }).catch(() => undefined);
    await dropPart(`${pbf}.part`);
    return { state: 'failed', message: `rattrapage des sorties du métro raté (${message}) : tuiles de la semaine gardées, sorties avec les tuiles de la semaine prochaine`, catchUp };
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
Base de données dérivée (${idx.source}, données OpenStreetMap du ${idx.version}) : voies praticables à pied,
carrefours, géométrie simplifiée (environ 2 m), noms de rue, marches, sens uniques à pied.
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

/**
 * Sans réseau : tuiles construites depuis un extrait local (.osm ou .osm.pbf ; tests de bout en bout sur les données
 * des fixtures, QUAI_WALK_OSM) directement dans dataDir/walk, licence ajoutée comme pour la publication de nuit.
 */
export async function localWalk(o: { input: string; dataDir: string; log?: (m: string) => void; now?: () => Date }): Promise<PublishResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const out = join(o.dataDir, 'walk');
  try {
    const r = await buildWalk({ input: o.input, out, stopsDir: o.dataDir, log, now: o.now, source: `OpenStreetMap, extrait local ${basename(o.input)}` });
    const licence = join(o.dataDir, 'LICENSE-DATA.txt');
    const had = await readFile(licence, 'utf8').catch(() => '');
    if (!had.includes(LICENSE_MARK)) await appendFile(licence, licenseSection(r.built.index), 'utf8');
    log(`Chemins à pied (extrait local) : ${sizeLine(r.built)}`);
    return { published: true, message: 'publié', tiles: r.built.stats.tiles, bytes: r.built.stats.bytes };
  } catch (e) {
    await rm(out, { recursive: true, force: true }).catch(() => undefined);
    return { published: false, message: `extrait local inutilisable (${e instanceof Error ? e.message : String(e)}) : chemins à pied absents` };
  }
}

/**
 * 1.3.1 (R1) : sorties du métro du cache (exits.json) copiées en data/exits.json, seulement si elles sont de la même
 * version que les tuiles publiées ; sinon aucun fichier (l'appli ne montre alors aucune sortie). Ne lève jamais.
 */
export async function publishExits(cacheDir: string, dataDir: string, version: string): Promise<string> {
  const dest = join(dataDir, EXITS_FILE);
  try {
    await rm(dest, { force: true });
    const raw = (await readJson(join(cacheDir, EXITS_FILE))) as unknown;
    if (!raw) return 'sorties du métro absentes du cache (faites avec les tuiles de la semaine)';
    if (!isExitsFile(raw)) return 'sorties du métro illisibles : non publiées';
    if (raw.version !== version) return `sorties du métro du ${raw.version}, tuiles du ${version} : non publiées`;
    await writeFile(dest, JSON.stringify(raw), 'utf8');
    return `sorties du métro publiées : ${Object.keys(raw.stops).length} arrêts STIB sous terre (${EXITS_FILE})`;
  } catch (e) {
    await rm(dest, { force: true }).catch(() => undefined);
    return `sorties du métro non publiées (${e instanceof Error ? e.message : String(e)})`;
  }
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
    log(`Chemins à pied : ${await publishExits(o.cacheDir, o.dataDir, idx.version)}`);
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
