/**
 * Requêtes vers les sources (portail BMC, flux SNCB direct, site de données) avec délai maximal.
 * Les messages destinés aux clients sont en français, sans adresse ni clé ; le détail technique va au journal.
 */
import type { Ctx } from './context.js';
import { USER_AGENT, readConfig, type Source } from './config.js';
import { errorText } from './log.js';

export const MISSING_KEY = 'Clé BMC_KEY absente sur le relais';

export class UpstreamError extends Error {
  readonly userMessage: string;
  readonly status?: number;
  constructor(userMessage: string, detail: string, status?: number) {
    super(detail);
    this.name = 'UpstreamError';
    this.userMessage = userMessage;
    this.status = status;
  }
}

export class MissingKeyError extends UpstreamError {
  constructor(label: string) {
    super(MISSING_KEY, `${label} : BMC_KEY absente, requête non envoyée`);
    this.name = 'MissingKeyError';
  }
}

const OF: Record<Source['kind'], string> = { bmc: 'du portail', 'sncb-direct': 'du flux SNCB', data: 'du site de données', weather: 'd’Open-Meteo' };
const NAME: Record<Source['kind'], string> = { bmc: 'Portail', 'sncb-direct': 'Flux SNCB', data: 'Site de données', weather: 'Open-Meteo' };

export function httpMessage(status: number, src: Source): string {
  if (src.kind === 'bmc' && (status === 401 || status === 403)) return `Clé refusée par le portail (HTTP ${status})`;
  if (status === 429) return `Trop de requêtes, limite ${OF[src.kind]} atteinte (HTTP 429)`;
  return `Réponse HTTP ${status} ${OF[src.kind]}`;
}

const seconds = (ms: number) => String(ms / 1000).replace('.', ',');

export function timeoutError(src: Source, shownMs: number): UpstreamError {
  return new UpstreamError(`Délai dépassé (${seconds(shownMs)} s)`, `${src.label} : délai dépassé (${shownMs} ms)`);
}

function failure(e: unknown, src: Source, shownMs: number): UpstreamError {
  if (e instanceof UpstreamError) return e;
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'TimeoutError' || name === 'AbortError') return timeoutError(src, shownMs);
  const text = errorText(e);
  // fetch de Node (undici) : « TypeError: fetch failed », le motif (« unexpected redirect ») est dans cause.message
  const cause = e && typeof e === 'object' && 'cause' in e ? (e as { cause?: unknown }).cause : undefined;
  const why = cause instanceof Error ? cause.message : '';
  if (/redirect/i.test(text) || /redirect/i.test(why)) return new UpstreamError(`Redirection refusée ${OF[src.kind]}`, `${src.label} : redirection refusée (${text})`);
  return new UpstreamError(`${NAME[src.kind]} injoignable`, `${src.label} : ${text}`);
}

interface Opened { res: Response; t0: number }

/** `shownMs` : délai annoncé dans le message d'erreur (budget total quand une requête en enchaîne plusieurs). */
async function open(ctx: Ctx, src: Source, timeoutMs: number, accept: string, shownMs = timeoutMs): Promise<Opened> {
  const headers: Record<string, string> = { Accept: accept, 'User-Agent': USER_AGENT };
  if (src.auth) {
    const { key } = readConfig(ctx.env);
    if (!key) throw new MissingKeyError(src.label);
    headers['bmc-partner-key'] = key;
    headers['Ocp-Apim-Subscription-Key'] = key;
  }
  let target: URL;
  try {
    target = new URL(src.url);
  } catch {
    throw new UpstreamError('Adresse de la source invalide', `${src.label} : adresse invalide`);
  }
  if (!src.auth && (target.username || target.password)) {
    // fetch refuse les adresses avec identifiants (https://user:pass@...) : on les passe en en-tête Basic.
    headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`).toString('base64')}`;
    target.username = '';
    target.password = '';
  }
  const t0 = performance.now();
  let res: Response;
  try {
    // Jamais de redirection avec la clé : elle partirait vers un autre serveur.
    res = await ctx.fetch(target.href, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: src.auth ? 'error' : 'follow' });
  } catch (e) {
    throw failure(e, src, shownMs);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new UpstreamError(httpMessage(res.status, src), `${src.label} : HTTP ${res.status}`, res.status);
  }
  return { res, t0 };
}

export interface Fetched<T> { data: T; ms: number; bytes: number }

export async function fetchBytes(ctx: Ctx, src: Source, timeoutMs: number): Promise<Fetched<Uint8Array>> {
  const { res, t0 } = await open(ctx, src, timeoutMs, 'application/x-protobuf, application/octet-stream;q=0.9, */*;q=0.1');
  try {
    const data = new Uint8Array(await res.arrayBuffer());
    return { data, ms: Math.round(performance.now() - t0), bytes: data.byteLength };
  } catch (e) {
    throw failure(e, src, timeoutMs);
  }
}

export async function fetchJson(ctx: Ctx, src: Source, timeoutMs: number, shownMs = timeoutMs): Promise<Fetched<unknown>> {
  const { res, t0 } = await open(ctx, src, timeoutMs, 'application/json', shownMs);
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw failure(e, src, shownMs);
  }
  try {
    return { data: JSON.parse(text) as unknown, ms: Math.round(performance.now() - t0), bytes: text.length };
  } catch {
    throw new UpstreamError(`Réponse illisible ${OF[src.kind]} (JSON invalide)`, `${src.label} : JSON invalide (${text.length} caractères)`);
  }
}

/** Sonde rapide : attend seulement le statut et les en-têtes, sans télécharger le flux. */
export async function probe(ctx: Ctx, src: Source, timeoutMs: number): Promise<{ ms: number }> {
  const { res, t0 } = await open(ctx, src, timeoutMs, '*/*');
  const ms = Math.round(performance.now() - t0);
  await res.body?.cancel().catch(() => undefined);
  return { ms };
}
