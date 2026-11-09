/** Configuration de la commande build-data : arguments, variables d'environnement, sources des flux. */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { Op } from '../../shared/types.ts';
import { addDays, brusselsDate, isIsoDate } from './dates.ts';
import type { Target } from './download.ts';

export const OPS: Op[] = ['sncb', 'stib', 'delijn', 'tec'];
export const OP_LABEL: Record<Op, string> = { sncb: 'SNCB', stib: 'STIB', delijn: 'De Lijn', tec: 'TEC' };
export const SLUG: Record<Op, string> = { sncb: 'nmbssncb', stib: 'stibmivb', delijn: 'delijn', tec: 'tec' };
export const DEFAULT_BMC_BASE = 'https://api-management-opendata-production.azure-api.net';
export const DELIJN_FALLBACK = 'https://opendata-discovery-gtfs-static.api.production.belgianmobility.io/api/gtfs/feed/delijn/static';
export const TEC_FALLBACK = 'https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip';

/**
 * Adresse de repli effective. QUAI_DELIJN_FALLBACK et QUAI_TEC_FALLBACK servent uniquement aux tests de bout en bout,
 * qui ne doivent pas dépendre d'Internet (sur les machines de GitHub, les vrais replis sont joignables).
 */
const fallbackUrl = (envName: string, def: string) => (process.env[envName] ?? '').trim() || def;

export class ConfigError extends Error {}

export type Source =
  | { kind: 'file'; path: string }
  | { kind: 'download'; targets: Target[] }
  | { kind: 'missing'; reason: string };

/** Adresses du GTFS statique d'un opérateur : portail BMC, puis replis (De Lijn : autre hôte BMC ; TEC : site du TEC, sans clé). */
export function staticTargets(op: Op, base: string): Target[] {
  const b = base.replace(/\/+$/, '');
  const targets: Target[] = [{ url: `${b}/api/gtfs/feed/${SLUG[op]}/static`, withKey: true, label: `${OP_LABEL[op]}, portail BMC` }];
  if (op === 'delijn') targets.push({ url: fallbackUrl('QUAI_DELIJN_FALLBACK', DELIJN_FALLBACK), withKey: true, label: 'De Lijn, repli BMC' });
  if (op === 'tec') targets.push({ url: fallbackUrl('QUAI_TEC_FALLBACK', TEC_FALLBACK), withKey: false, label: 'TEC, repli opendata.tec-wl.be' });
  return targets;
}

/** QUAI_SOURCES « sncb=a.zip,stib=b.zip » -> chemins absolus (relatifs au dossier d'appel). */
export function parseSourcesEnv(value: string, cwd: string): Partial<Record<Op, string>> {
  const out: Partial<Record<Op, string>> = {};
  for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    const op = (eq > 0 ? part.slice(0, eq) : '').trim().toLowerCase() as Op;
    const path = eq > 0 ? part.slice(eq + 1).trim() : '';
    if (!OPS.includes(op) || !path) {
      throw new ConfigError(`QUAI_SOURCES : entrée invalide « ${part} » (attendu : sncb=chemin.zip,stib=...,delijn=...,tec=...)`);
    }
    out[op] = resolve(cwd, path);
  }
  return out;
}

export interface Config {
  out: string;
  site?: string;
  /** Dossier des GTFS gardés (repli si le portail ne répond pas une nuit), voir src/cache.ts. */
  cacheDir?: string;
  dates: string[];
  key?: string;
  base: string;
  sources: Record<Op, Source>;
}

export const USAGE = `Usage : npm run build-data -- --out <dossier> [--site <dossier>] [--cache-dir <dossier>]

  --cache-dir   garde le GTFS de chaque réseau après une préparation réussie ; si le portail ne répond pas
                une nuit (ou livre un flux sans voyage), reprend le GTFS gardé s'il a au plus 7 jours

Variables d'environnement :
  BMC_KEY       clé du portail Belgian Mobility Company (obligatoire sauf avec QUAI_SOURCES)
  BMC_BASE      adresse du portail (défaut ${DEFAULT_BMC_BASE})
  QUAI_DATE     date de service du jour 0, AAAA-MM-JJ (défaut : aujourd'hui à Bruxelles)
  QUAI_SOURCES  zips locaux, ex. sncb=a.zip,stib=b.zip,delijn=c.zip,tec=d.zip (opérateur absent = ignoré)`;

/** Lit arguments et environnement ; ConfigError (message en français) si incohérent. */
export function loadConfig(argv: string[], env: NodeJS.ProcessEnv, now: Date = new Date()): Config {
  let values: { out?: string; site?: string; 'cache-dir'?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { out: { type: 'string' }, site: { type: 'string' }, 'cache-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    throw new ConfigError(`arguments invalides (${(e as Error).message})\n${USAGE}`);
  }
  if (values.help) throw new ConfigError(USAGE);
  if (!values.out) throw new ConfigError(`--out <dossier> est obligatoire\n${USAGE}`);
  const cwd = env.INIT_CWD || process.cwd();

  const date0 = env.QUAI_DATE?.trim() || brusselsDate(now);
  if (!isIsoDate(date0)) throw new ConfigError(`QUAI_DATE invalide « ${env.QUAI_DATE} » (format attendu : AAAA-MM-JJ)`);
  const dates = [date0, addDays(date0, 1)];

  const base = env.BMC_BASE?.trim() || DEFAULT_BMC_BASE;
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocole');
  } catch {
    throw new ConfigError(`BMC_BASE invalide « ${base} »`);
  }

  const key = env.BMC_KEY?.trim() || undefined;
  const local = env.QUAI_SOURCES?.trim();
  const sources = {} as Record<Op, Source>;
  if (local) {
    const files = parseSourcesEnv(local, cwd);
    for (const op of OPS) {
      const path = files[op];
      sources[op] = path ? { kind: 'file', path } : { kind: 'missing', reason: 'source non fournie dans QUAI_SOURCES' };
    }
  } else {
    if (!key) {
      throw new ConfigError('la variable BMC_KEY est absente : clé gratuite du portail Belgian Mobility Company (ou QUAI_SOURCES pour des zips locaux)');
    }
    for (const op of OPS) sources[op] = { kind: 'download', targets: staticTargets(op, base) };
  }

  return {
    out: resolve(cwd, values.out),
    site: values.site ? resolve(cwd, values.site) : undefined,
    cacheDir: values['cache-dir'] ? resolve(cwd, values['cache-dir']) : undefined,
    dates,
    key,
    base,
    sources,
  };
}
