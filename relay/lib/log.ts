/**
 * Journaux du relais. Chaque ligne passe par scrub() : la clé BMC, l'adresse SNCB_RT_URL (qui peut contenir
 * un jeton) et les chaînes de requête des adresses sont masquées. Ne jamais journaliser d'en-têtes de requête.
 */
import type { Env } from './config.js';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type LogSink = Pick<Console, 'log' | 'warn' | 'error'>;

/** Chaînes à ne jamais écrire : la clé BMC, la clé Google (inutilisée en 1.1) et tout ou partie de SNCB_RT_URL. */
export function secretsFrom(env: Env): string[] {
  const out: string[] = [];
  const key = (env.BMC_KEY ?? '').trim();
  if (key) out.push(key);
  const google = (env.GOOGLE_GEOCODING_KEY ?? '').trim();
  if (google) out.push(google);
  const direct = (env.SNCB_RT_URL ?? '').trim();
  if (direct) {
    out.push(direct);
    try {
      const u = new URL(direct);
      if (u.username || u.password) {
        const user = decodeURIComponent(u.username);
        const pass = decodeURIComponent(u.password);
        out.push(user, pass, Buffer.from(`${user}:${pass}`).toString('base64'));
        u.username = '';
        u.password = '';
        out.push(u.href);
      }
      if (u.search.length > 1) out.push(u.search.slice(1));
      if (u.pathname.length > 1) out.push(u.pathname);
    } catch {
      /* adresse invalide : masquée telle quelle */
    }
  }
  return out;
}

export function scrub(text: string, secrets: readonly string[]): string {
  let t = String(text);
  for (const s of [...secrets].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) {
    t = t.split(s).join('***');
  }
  // chaînes de requête et identifiants dans les adresses
  t = t.replace(/(https?:\/\/)[^\s/@"'<>]+@/gi, '$1***@');
  t = t.replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1?***');
  return t;
}

export function createLogger(env: Env, sink: LogSink = console): Logger {
  const line = (message: string) => `[relais] ${scrub(message, secretsFrom(env))}`;
  return {
    info: (m) => sink.log(line(m)),
    warn: (m) => sink.warn(line(m)),
    error: (m) => sink.error(line(m)),
  };
}

/** Message d'une erreur quelconque, sur une ligne (à passer ensuite par le logger, qui masque). */
export function errorText(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as Error & { cause?: unknown }).cause;
    const code = cause && typeof cause === 'object' && 'code' in cause ? ` [${String((cause as { code: unknown }).code)}]` : '';
    return `${e.name}: ${e.message}${code}`.replace(/\s+/g, ' ');
  }
  return String(e).replace(/\s+/g, ' ');
}
