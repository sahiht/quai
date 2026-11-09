/**
 * npm run build-data -- --out <dossier> [--site <dossier>]
 * Code de sortie : 0 si au moins un réseau a réussi, 1 si tous ont échoué, 2 si la configuration est invalide.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildData } from './build.ts';
import { ConfigError, OP_LABEL, OPS, loadConfig } from './config.ts';
import { maskSecrets } from './download.ts';
import { formatReport, sizeReport } from './report.ts';

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  let cfg;
  try {
    cfg = loadConfig(argv, env);
  } catch (e) {
    console.error(e instanceof ConfigError ? `Erreur : ${e.message}` : `Erreur : ${(e as Error).message}`);
    return 2;
  }
  const t0 = Date.now();
  console.log(`Quai, préparation des données : journées ${cfg.dates.join(' et ')}, sortie ${cfg.out}`);
  try {
    const r = await buildData({ out: cfg.out, site: cfg.site, cacheDir: cfg.cacheDir, dates: cfg.dates, key: cfg.key, sources: cfg.sources });
    console.log('');
    for (const op of OPS) {
      const f = r.meta.feeds[op];
      console.log(f.ok
        ? `${OP_LABEL[op].padEnd(8)} OK      ${f.areas} zones, ${f.trips} voyages${f.feedVersion ? `, version ${f.feedVersion}` : ''}${f.cachedFrom ? `, GTFS gardé du ${f.cachedFrom}` : ''}`
        : `${OP_LABEL[op].padEnd(8)} ERREUR  ${f.error}`);
    }
    console.log('');
    const report = await sizeReport(cfg.out);
    for (const line of formatReport(report)) console.log(line);
    const totalMB = report.bytes / 1048576;
    if (totalMB > 400) {
      const msg = totalMB > 1000
        ? `données de ${Math.round(totalMB)} Mo : au-delà de la limite de 1 Go de GitHub Pages, la publication risque d'échouer`
        : `données de ${Math.round(totalMB)} Mo : au-delà de l'objectif de 400 Mo (limite GitHub Pages : 1 Go)`;
      console.log(env.GITHUB_ACTIONS === 'true' ? `::warning title=Taille des données::${msg}` : `Attention : ${msg}`);
    }
    const rssMB = Math.round(process.resourceUsage().maxRSS / 1024);
    console.log(`Durée : ${((Date.now() - t0) / 1000).toFixed(1).replace('.', ',')} s ; mémoire maximale : ${rssMB} Mo`);
    if (cfg.site) console.log(`Page d'état : ${resolve(cfg.site, 'index.html')}`);
    if (!r.anyOk) {
      console.error('Erreur : aucun réseau n\'a pu être préparé (les données publiées la veille restent en ligne).');
      return 1;
    }
    return 0;
  } catch (e) {
    console.error(`Erreur : ${maskSecrets((e as Error).message ?? String(e), [cfg.key])}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
