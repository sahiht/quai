/**
 * 1.2.10 : chemins à pied, en ligne de commande (lancé par le flux « Données de nuit », depuis pipeline/) :
 *
 *   node --experimental-strip-types src/walk/cli.ts build --input <extrait .osm.pbf ou .osm> --out <dossier> [--stops <données>]
 *   node --experimental-strip-types src/walk/cli.ts weekly --cache <dossier> [--stops <données>] [--url <adresse>] [--force]
 *   node --experimental-strip-types src/walk/cli.ts publish --cache <dossier> --data <données>
 *
 * weekly : tuiles de la semaine dans le cache (extrait Geofabrik téléchargé au plus une fois par semaine) ; code 1 en
 * cas d'échec (les tuiles d'avant restent). publish : copie dans les données de la nuit ; toujours code 0 (sans
 * tuiles, l'appli retombe sur le chemin droit). QUAI_WALK_FORCE=1 : comme --force.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWalk, sizeLine } from './build.ts';
import { publishWalk, weeklyWalk } from './weekly.ts';

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
  log('Usage : cli.ts build|weekly|publish (voir l’en-tête de pipeline/src/walk/cli.ts)');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
