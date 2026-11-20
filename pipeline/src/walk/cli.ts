/**
 * 1.2.10 : chemins à pied, en ligne de commande (lancé par le flux « Données de nuit », depuis pipeline/) :
 *
 *   node --experimental-strip-types src/walk/cli.ts build --input <extrait .osm.pbf ou .osm> --out <dossier> [--stops <données>]
 *   node --experimental-strip-types src/walk/cli.ts weekly --cache <dossier> [--stops <données>] [--url <adresse>] [--force]
 *   node --experimental-strip-types src/walk/cli.ts publish --cache <dossier> --data <données>
 *   node --experimental-strip-types src/walk/cli.ts local --data <données> [--input <extrait>]
 *   node --experimental-strip-types src/walk/cli.ts exits --tiles <tuiles> --input <extrait .osm.pbf> [--stops <données>] [--url <adresse>] [--key ref:STIB_MIVB]
 *
 * weekly : tuiles de la semaine dans le cache (extrait Geofabrik téléchargé au plus une fois par semaine) ; code 1 en
 * cas d'échec (les tuiles d'avant restent). publish : copie dans les données de la nuit ; toujours code 0 (sans
 * tuiles, l'appli retombe sur le chemin droit). QUAI_WALK_FORCE=1 : comme --force.
 * local : sans réseau, tuiles construites depuis un extrait local (--input, sinon la variable QUAI_WALK_OSM) dans
 * <données>/walk, licence comprise ; tests de bout en bout : fixtures/pipeline/osm/namur-bruxelles.osm. Code 1 si
 * l'extrait est inutilisable.
 * exits (1.3.1, PRD-1.3.1 § 14, R1 ; branche de vérification seulement) : arrêts STIB sous terre d'OpenStreetMap et
 * sorties nommées par les couloirs, sur les tuiles piétonnes (exits.ts) ; bilan dans le journal, rien n'est écrit.
 * Extrait absent : téléchargé à cet endroit (--url, sinon Geofabrik), MD5 contrôlé. Code 1 si la mesure échoue.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWalk, sizeLine } from './build.ts';
import { exitReport, isUnderStop, loadExitGraph, officialMetroStations, readStibFeatures, STIB_KEY } from './exits.ts';
import { downloadExtract, GEOFABRIK_URL, localWalk, publishedMd5, publishWalk, weeklyWalk } from './weekly.ts';

/** Message d'une commande du journal GitHub (« % », retours à la ligne). */
const ghEscape = (m: string) => m.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function args(argv: string[]): { cmd: string; opts: Record<string, string | true> } {
  const [cmd = '', ...rest] = argv;
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`argument inattendu : ${a}`);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[a.slice(2)] = next;
      i++;
    } else opts[a.slice(2)] = true;
  }
  return { cmd, opts };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, log: (m: string) => void = (m) => console.log(m)): Promise<number> {
  const ci = env.GITHUB_ACTIONS === 'true';
  const warn = (m: string) => log(ci ? `::warning title=Chemins à pied::${m}` : `Attention : ${m}`);
  let parsed;
  try {
    parsed = args(argv);
  } catch (e) {
    log(`Erreur : ${(e as Error).message}`);
    return 2;
  }
  const { cmd, opts } = parsed;
  const str = (k: string) => (typeof opts[k] === 'string' ? resolve(opts[k] as string) : undefined);
  if (cmd === 'build') {
    const input = str('input');
    const out = str('out');
    if (!input || !out) {
      log('Erreur : --input et --out sont obligatoires');
      return 2;
    }
    try {
      const r = await buildWalk({ input, out, stopsDir: str('stops'), log });
      log(`Chemins à pied : ${sizeLine(r.built)} en ${(r.ms / 1000).toFixed(1).replace('.', ',')} s`);
      return 0;
    } catch (e) {
      log(`Erreur : ${(e as Error).message}`);
      return 1;
    }
  }
  if (cmd === 'weekly') {
    const cacheDir = str('cache');
    if (!cacheDir) {
      log('Erreur : --cache est obligatoire');
      return 2;
    }
    const force = opts.force === true || env.QUAI_WALK_FORCE === '1';
    const r = await weeklyWalk({ cacheDir, stopsDir: str('stops'), url: typeof opts.url === 'string' ? opts.url : undefined, force, log });
    if (r.state === 'failed') {
      warn(`graphe piéton non refait cette nuit (${r.message}) ; les tuiles d'avant restent publiées s'il y en a`);
      return 1;
    }
    log(`Chemins à pied : ${r.message}`);
    return 0;
  }
  if (cmd === 'publish') {
    const cacheDir = str('cache');
    const dataDir = str('data');
    if (!cacheDir || !dataDir) {
      log('Erreur : --cache et --data sont obligatoires');
      return 2;
    }
    const r = await publishWalk({ cacheDir, dataDir, log });
    if (!r.published) warn(r.message);
    return 0;
  }
  if (cmd === 'local') {
    const dataDir = str('data');
    const input = str('input') ?? (env.QUAI_WALK_OSM ? resolve(env.QUAI_WALK_OSM) : undefined);
    if (!dataDir || !input) {
      log('Erreur : --data et un extrait (--input ou la variable QUAI_WALK_OSM) sont obligatoires');
      return 2;
    }
    const r = await localWalk({ input, dataDir, log });
    if (!r.published) {
      warn(r.message);
      return 1;
    }
    return 0;
  }
  if (cmd === 'exits') {
    const tilesDir = str('tiles');
    const input = str('input');
    if (!tilesDir || !input) {
      log('Erreur : --tiles et --input sont obligatoires');
      return 2;
    }
    const key = typeof opts.key === 'string' ? opts.key : STIB_KEY;
    try {
      const t0 = Date.now();
      if (!existsSync(input)) {
        const url = typeof opts.url === 'string' ? opts.url : GEOFABRIK_URL;
        log(`Sorties du métro : téléchargement de ${url}`);
        const got = await downloadExtract(url, input, { log });
        const expected = await publishedMd5(url);
        if (expected && expected !== got.md5) throw new Error('extrait reçu incomplet (empreinte MD5 différente)');
        log(`Sorties du métro : extrait reçu, ${(got.bytes / 1e6).toFixed(1).replace('.', ',')} Mo en ${Math.round((Date.now() - t0) / 1000)} s${expected ? ', MD5 vérifié' : ''}`);
      }
      const t1 = Date.now();
      const { features, timestamp } = readStibFeatures(input, key);
      const graph = await loadExitGraph(tilesDir, features.filter(isUnderStop));
      if (!graph) {
        log(`Erreur : pas de tuiles piétonnes lisibles dans ${tilesDir}`);
        return 1;
      }
      const stopsDir = str('stops');
      const stations = stopsDir ? await officialMetroStations(stopsDir) : null;
      const osmDate = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : undefined;
      const r = exitReport(graph, features, stations, { key, ...(osmDate ? { osmDate } : {}) });
      for (const l of r.lines) log(l);
      log(`Sorties du métro : mesure en ${Math.round((Date.now() - t1) / 1000)} s`);
      if (ci) {
        const main = r.lines.find((l) => l.includes('sortie nommée par les couloirs'));
        const off = r.lines.find((l) => l.includes('données officielles'));
        for (const l of [main, off]) if (l) log(`::notice title=Sorties du métro (R1)::${ghEscape(l)}`);
      }
      return 0;
    } catch (e) {
      log(`Erreur : ${(e as Error).message}`);
      return 1;
    }
  }
  log('Usage : cli.ts build|weekly|publish|local|exits (voir l’en-tête de pipeline/src/walk/cli.ts)');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
