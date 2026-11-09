/**
 * Téléchargement des GTFS statiques : plusieurs adresses (portail BMC puis replis), nouvelles tentatives avec
 * attente croissante, délai maximal global et délai sans données, redirections suivies à la main (la clé n'est
 * envoyée qu'à l'origine qui la demande), contrôle que le contenu est bien un zip. La clé n'apparaît jamais
 * dans un message : tout texte d'erreur passe par maskSecrets().
 */
import { createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { once } from 'node:events';

export interface Target {
  url: string;
  /** Envoyer la clé BMC (en-têtes bmc-partner-key et Ocp-Apim-Subscription-Key). */
  withKey: boolean;
  /** Libellé lisible pour les messages (« portail BMC », « repli TEC »). */
  label: string;
}

export interface DownloadOptions {
  targets: Target[];
  dest: string;
  key?: string;
  /** Nouvelles tentatives par adresse après un premier échec (défaut 3). */
  retries?: number;
  /** Attentes avant chaque nouvelle tentative, en ms (défaut 2 s, 8 s, 20 s). */
  backoffMs?: number[];
  /** Durée maximale d'un essai complet, en ms (défaut 15 min). */
  timeoutMs?: number;
  /** Durée maximale sans recevoir de données, en ms (défaut 60 s). */
  stallMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export class DownloadError extends Error {}

class AttemptError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

/** Remplace toute occurrence d'un secret (et de ses formes encodées) par « *** ». */
export function maskSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = String(text);
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    for (const form of new Set([s, encodeURIComponent(s)])) out = out.split(form).join('***');
  }
  return out;
}

export function keyHeaders(key: string): Record<string, string> {
  return { 'bmc-partner-key': key, 'Ocp-Apim-Subscription-Key': key };
}

function httpMessage(status: number): string {
  if (status === 401 || status === 403) return `HTTP ${status}, clé refusée ou abonnement manquant`;
  if (status === 404) return `HTTP ${status}, flux introuvable`;
  if (status === 429) return `HTTP ${status}, trop de requêtes`;
  if (status >= 500) return `HTTP ${status}, erreur du serveur`;
  return `HTTP ${status}`;
}

function networkMessage(e: unknown): string {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError') return 'délai dépassé';
  const code = err?.cause?.code ?? err?.code;
  return code ? `erreur réseau (${code})` : 'erreur réseau';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function isZip(path: string): Promise<boolean> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    return bytesRead === 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5) && (buf[3] === 4 || buf[3] === 6);
  } finally {
    await fh.close();
  }
}

/** Un essai : requête (redirections comprises) puis écriture du corps dans dest. Renvoie le nombre d'octets. */
async function attempt(t: Target, o: DownloadOptions): Promise<number> {
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const stallMs = o.stallMs ?? 60_000;
  const ctrl = new AbortController();
  const overall = setTimeout(() => ctrl.abort(new DOMException('délai global dépassé', 'TimeoutError')), timeoutMs);
  let stall: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(() => ctrl.abort(new DOMException('aucune donnée reçue', 'TimeoutError')), stallMs);
  };
  try {
    const origin = new URL(t.url).origin;
    let url = t.url;
    let res: Response | undefined;
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = { 'User-Agent': 'quai-pipeline/1.0 (+donnees ouvertes)', Accept: 'application/zip, application/octet-stream, */*' };
      if (t.withKey && o.key && new URL(url).origin === origin) Object.assign(headers, keyHeaders(o.key));
      arm();
      try {
        res = await doFetch(url, { headers, redirect: 'manual', signal: ctrl.signal });
      } catch (e) {
        throw new AttemptError(networkMessage(ctrl.signal.aborted ? ctrl.signal.reason : e), true);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= (o.maxRedirects ?? 5)) throw new AttemptError('trop de redirections', false);
        url = new URL(res.headers.get('location') as string, url).toString();
        continue;
      }
      break;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const s = res.status;
      throw new AttemptError(httpMessage(s), s === 408 || s === 429 || s >= 500);
    }
    if (!res.body) throw new AttemptError('réponse vide', true);
    const out = createWriteStream(o.dest);
    let bytes = 0;
    try {
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        arm();
        bytes += chunk.length;
        if (!out.write(chunk)) await once(out, 'drain');
      }
      out.end();
      await once(out, 'close');
    } catch (e) {
      out.destroy();
      throw new AttemptError(networkMessage(ctrl.signal.aborted ? ctrl.signal.reason : e), true);
    }
    if (bytes === 0) throw new AttemptError('réponse vide', true);
    if (!(await isZip(o.dest))) throw new AttemptError("le contenu reçu n'est pas une archive zip", true);
    return bytes;
  } finally {
    clearTimeout(overall);
    if (stall) clearTimeout(stall);
  }
}

/** Télécharge le premier flux disponible parmi les adresses ; erreur DownloadError (en français, sans secret) sinon. */
export async function downloadFeed(o: DownloadOptions): Promise<{ target: Target; bytes: number; ms: number }> {
  const retries = o.retries ?? 3;
  const backoff = o.backoffMs ?? [2000, 8000, 20000];
  const log = o.log ?? (() => undefined);
  const failures: string[] = [];
  for (const t of o.targets) {
    let last = '';
    for (let i = 0; i <= retries; i++) {
      if (i > 0) await sleep(backoff[Math.min(i - 1, backoff.length - 1)] ?? 0);
      const t0 = Date.now();
      try {
        const bytes = await attempt(t, o);
        return { target: t, bytes, ms: Date.now() - t0 };
      } catch (e) {
        await rm(o.dest, { force: true }).catch(() => undefined);
        const retryable = e instanceof AttemptError ? e.retryable : true;
        last = maskSecrets(e instanceof Error ? e.message : String(e), [o.key]);
        log(`${t.label} : essai ${i + 1} échoué (${last})${retryable && i < retries ? ', nouvel essai' : ''}`);
        if (!retryable) break;
      }
    }
    failures.push(`${t.label} : ${last}`);
  }
  throw new DownloadError(maskSecrets(`téléchargement impossible (${failures.join(' ; ')})`, [o.key]));
}
