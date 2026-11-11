/**
 * Quai : fonctions pour la configuration de build et le manifeste app.json.
 * Utilisé par scripts/configure.mjs, scripts/check-configured.mjs et les tests.
 * Seule lecture de fichier : la version, prise dans app.json (voir APP_VERSION).
 */
import { readFileSync } from 'node:fs';

export const PACKAGE_ID = 'com.quai.transports';
export const APP_NAME = 'Quai';
export const SDK_VERSION = '0.0.16';
export const EDITION = '202601';

/**
 * Version lue dans un app.json (chaîne brute, à valider avec checkVersion), ou `fallback`
 * si le fichier est absent ou illisible.
 */
export function readManifestVersion(file, fallback = '1.0.0') {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')).version;
    return typeof v === 'string' ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Version de l'appli : celle de app.json, seul endroit à modifier pour publier une nouvelle version.
 * `npm run configure` la conserve (elle n'est plus remise à une valeur figée dans ce script).
 */
export const APP_VERSION = readManifestVersion(new URL('../app.json', import.meta.url));

export const NETWORK_DESC =
  'Télécharge les horaires préparés chaque nuit (GitHub Pages, par zones d’environ 2 km) ' +
  'et, depuis ton relais personnel, le temps réel (retards, voies, suppressions) et les adresses : ' +
  'seul le texte tapé est envoyé, jamais la position.';
export const LOCATION_DESC =
  'Trouve les arrêts proches et propose le bon trajet. La position exacte reste sur le téléphone : ' +
  'l’appli ne télécharge que les horaires de ta zone (environ 2 km) et n’envoie jamais ta position au relais.';

/** Erreur de configuration, message en français destiné à l'utilisateur. */
export class ConfigError extends Error {}

/** Vérifie la forme x.y.z exigée par Even Hub (sans « v » ni suffixe). Lève ConfigError sinon. */
export function checkVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ConfigError(
      `La version de app.json doit avoir la forme x.y.z, par exemple 1.0.1 (reçu « ${String(version)} »).`,
    );
  }
  return version;
}

/**
 * Valide une base d'URL : https uniquement, pas de / final, pas de paramètres ni d'ancre.
 * Renvoie la valeur nettoyée (espaces retirés). Lève ConfigError sinon.
 */
export function normalizeBase(name, value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new ConfigError(`${name} est vide : indiquez une adresse https, sans / final.`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} n’est pas une adresse valide : « ${raw} ».`);
  }
  if (url.protocol !== 'https:') {
    throw new ConfigError(`${name} doit commencer par https:// (reçu « ${raw} »).`);
  }
  if (url.username || url.password) {
    throw new ConfigError(`${name} ne doit pas contenir d’identifiants.`);
  }
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new ConfigError(`${name} ne doit pas contenir de paramètres (?) ni d’ancre (#).`);
  }
  if (raw.endsWith('/')) {
    throw new ConfigError(`${name} ne doit pas se terminer par « / » (reçu « ${raw} »).`);
  }
  return raw;
}

/** Origine (schéma + hôte + port) d'une base validée. */
export function originOf(base) {
  return new URL(base).origin;
}

/** Liste blanche réseau : les origines des deux bases, sans doublon, dans l'ordre. */
export function whitelistFor(cfg) {
  const out = [];
  for (const base of [cfg.dataBase, cfg.relayBase]) {
    if (!base) continue;
    const o = originOf(base);
    if (!out.includes(o)) out.push(o);
  }
  return out;
}

/**
 * Manifeste app.json complet (règles du skill build-and-deploy et du CLI evenhub 0.2).
 * cfg = { dataBase, relayBase } validés, ou null pour un manifeste non configuré (liste blanche vide).
 */
export function buildManifest(cfg) {
  return {
    package_id: PACKAGE_ID,
    edition: EDITION,
    name: APP_NAME,
    version: APP_VERSION,
    min_sdk_version: SDK_VERSION,
    entrypoint: 'index.html',
    permissions: [
      { name: 'network', desc: NETWORK_DESC, whitelist: cfg ? whitelistFor(cfg) : [] },
      { name: 'location', desc: LOCATION_DESC },
    ],
    supported_languages: ['fr'],
  };
}

/** Contenu de src/generated/config.ts. */
export function configModule(cfg) {
  const lines = [
    '// Fichier généré par `npm run configure` (scripts/configure.mjs). Ne pas modifier à la main.',
    '// Valeurs non secrètes : adresses publiques des données (GitHub Pages) et du relais (Vercel).',
    `export const DATA_BASE = ${JSON.stringify(cfg ? cfg.dataBase : '')};`,
    `export const RELAY_BASE = ${JSON.stringify(cfg ? cfg.relayBase : '')};`,
    `export const CONFIGURED = ${cfg ? 'true' : 'false'};`,
    '',
  ];
  return lines.join('\n');
}

const DOMAINS_START = '<!-- quai:domaines:debut -->';
const DOMAINS_END = '<!-- quai:domaines:fin -->';

/** Remplace la liste des domaines dans store/privacy.md (entre les marqueurs). */
export function privacyWithDomains(markdown, cfg) {
  const start = markdown.indexOf(DOMAINS_START);
  const end = markdown.indexOf(DOMAINS_END);
  if (start < 0 || end < start) return markdown;
  const body = cfg
    ? [
        `- Horaires (fichiers statiques) : ${originOf(cfg.dataBase)}`,
        `- Temps réel et adresses (relais personnel) : ${originOf(cfg.relayBase)}`,
      ].join('\n')
    : [
        '- Horaires (fichiers statiques) : adresse GitHub Pages, remplie par `npm run configure`',
        '- Temps réel et adresses (relais personnel) : adresse Vercel, remplie par `npm run configure`',
      ].join('\n');
  return markdown.slice(0, start + DOMAINS_START.length) + '\n' + body + '\n' + markdown.slice(end);
}

/**
 * Lit la configuration depuis l'environnement (et des arguments --data= / --relay= éventuels).
 * Lève ConfigError avec un message clair si une valeur manque ou est invalide.
 */
export function readConfig(env, argv = []) {
  const arg = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const data = arg('data') ?? env.QUAI_DATA_BASE;
  const relay = arg('relay') ?? env.QUAI_RELAY_BASE;
  const missing = [];
  if (!data || !String(data).trim()) missing.push('QUAI_DATA_BASE');
  if (!relay || !String(relay).trim()) missing.push('QUAI_RELAY_BASE');
  if (missing.length) {
    throw new ConfigError(
      `Variable${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''} : ${missing.join(', ')}. ` +
        'Exemple : QUAI_DATA_BASE=https://moi.github.io/quai/data QUAI_RELAY_BASE=https://quai-relais.vercel.app npm run configure',
    );
  }
  return {
    dataBase: normalizeBase('QUAI_DATA_BASE', data),
    relayBase: normalizeBase('QUAI_RELAY_BASE', relay),
  };
}

/** Vrai si un manifeste lu sur disque est configuré (deux origines https dans la liste blanche). */
export function isConfiguredManifest(manifest) {
  const net = Array.isArray(manifest?.permissions) ? manifest.permissions.find((p) => p?.name === 'network') : undefined;
  const wl = Array.isArray(net?.whitelist) ? net.whitelist : [];
  return wl.length >= 1 && wl.every((u) => typeof u === 'string' && u.startsWith('https://'));
}
