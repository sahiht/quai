/**
 * Cache des GTFS (option --cache-dir) : après une préparation réussie d'un réseau téléchargé, son zip est gardé
 * avec une petite fiche JSON (date du téléchargement). Si, une nuit suivante, le portail ne répond pas ou livre
 * un flux inutilisable (illisible, sans voyage sur les deux journées), le pipeline reprend le zip gardé s'il a
 * au plus CACHE_MAX_AGE_DAYS jours : le réseau reste dans l'appli, avec meta.feeds[op].cachedFrom.
 */
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Op } from '../../shared/types.ts';
import { isIsoDate } from './dates.ts';

export const CACHE_MAX_AGE_DAYS = 7;

export interface CacheEntry {
  v: 1;
  op: Op;
  /** Date du téléchargement à Bruxelles, AAAA-MM-JJ. */
  date: string;
  /** Instant du téléchargement (ISO 8601). */
  savedAt: string;
  bytes: number;
  feedVersion?: string;
}

const zipOf = (dir: string, op: Op) => join(dir, `${op}.zip`);
const infoOf = (dir: string, op: Op) => join(dir, `${op}.json`);

/** « 2026-11-12 » -> « 12/11 ». */
export const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Nombre de jours de `from` à `to` (dates AAAA-MM-JJ). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Garde le zip d'un réseau : zip puis fiche, chacun écrit à côté puis renommé (jamais de fiche sans zip complet). */
export async function storeCached(dir: string, op: Op, zipPath: string, info: { date: string; savedAt: string; feedVersion?: string }): Promise<CacheEntry> {
  await mkdir(dir, { recursive: true });
  const zip = zipOf(dir, op);
  await copyFile(zipPath, `${zip}.tmp`);
  const bytes = (await stat(`${zip}.tmp`)).size;
  await rename(`${zip}.tmp`, zip);
  const entry: CacheEntry = { v: 1, op, date: info.date, savedAt: info.savedAt, bytes, ...(info.feedVersion ? { feedVersion: info.feedVersion } : {}) };
  await writeFile(`${infoOf(dir, op)}.tmp`, JSON.stringify(entry));
  await rename(`${infoOf(dir, op)}.tmp`, infoOf(dir, op));
  return entry;
}

/** Zip gardé utilisable le jour `today` (au plus `maxAgeDays` jours), sinon la raison (en français). */
export async function readCached(dir: string, op: Op, today: string, maxAgeDays = CACHE_MAX_AGE_DAYS): Promise<{ path: string; entry: CacheEntry } | { reason: string }> {
  let text: string;
  try {
    text = await readFile(infoOf(dir, op), 'utf8');
  } catch {
    return { reason: 'aucun flux gardé' };
  }
  let entry: CacheEntry;
  try {
    entry = JSON.parse(text) as CacheEntry;
  } catch {
    return { reason: 'fiche du flux gardé illisible' };
  }
  if (!entry || entry.v !== 1 || entry.op !== op || !isIsoDate(String(entry.date))) return { reason: 'fiche du flux gardé illisible' };
  try {
    const s = await stat(zipOf(dir, op));
    if (!s.isFile() || s.size !== entry.bytes) return { reason: 'zip gardé incomplet' };
  } catch {
    return { reason: 'zip gardé absent' };
  }
  const age = daysBetween(entry.date, today);
  if (age > maxAgeDays) return { reason: `flux gardé du ${ddmm(entry.date)} trop ancien (plus de ${maxAgeDays} jours)` };
  return { path: zipOf(dir, op), entry };
}
