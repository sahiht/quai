/**
 * Client du relais temps réel (RELAY_BASE) : /api/rt, /api/stib, /api/alerts, /api/health.
 * Cache 20 s par voyage et par point d'arrêt ; une source en échec est signalée (`error`)
 * et l'appelant retombe sur l'horaire prévu.
 */
import type { AlertsResponse, HealthResponse, Names, Op, RtResponse } from '../../../shared/types';
import { normalizeId } from '../../../shared/types';
import { normalizeForSearch } from '../../../shared/names';
import { brusselsParts, tzOffsetMs } from './util';
import { chunks, getText, safeJson, type FetchLike } from './net';

export type RtUpdate = RtResponse['trips'][string]['u'][number];
export interface RtTrip {
  cancelled?: boolean;
  u: RtUpdate[];
}
/** Passages STIB à un point d'arrêt (heures en epoch ms). */
export interface StibEntry {
  line: string;
  /** Destination telle que donnée par la STIB (peut être vide). */
  dest: Names;
  times: number[];
  /** Message de l'opérateur à montrer (travaux, déviation), hors mentions reconnues ci-dessous. */
  msg?: string;
  /** « Temps théorique » : heure prévue par la STIB, pas un passage suivi en direct. */
  planned?: boolean;
  /** « Dernier passage » de la ligne à cet arrêt. */
  last?: boolean;
  /** « Ne pas embarquer » : véhicule qui termine ici, jamais montré. */
  noBoarding?: boolean;
}

export interface StibMessageKind {
  planned: boolean;
  last: boolean;
  noBoarding: boolean;
}

const STIB_PLANNED = /\btheor(?:i|e)/;
const STIB_NO_BOARDING = /\b(?:ne pas (?:embarquer|monter)|pas d embarquement|ne montez pas|niet (?:instappen|opstappen)|do not board|no boarding)\b/;
const STIB_LAST =
  /\b(?:dernier|derniere) (?:passage|depart|vehicule|tram|bus|metro)\b|\blaatste (?:doorgang|passage|vertrek|doortocht|rit|tram|bus|metro)\b|\blast (?:departure|passage|vehicle|service|tram|bus|metro)\b/;

/**
 * Mentions de service des passages STIB (vues dans les vraies réponses WaitingTimes), en français, néerlandais
 * ou anglais, sans casse ni accents : « Temps théorique », « Ne pas embarquer », « Dernier passage ».
 * null : message ordinaire (travaux, déviation…), à montrer tel quel.
 */
export function stibMessageKind(text: string | undefined): StibMessageKind | null {
  const k = normalizeForSearch(text ?? '');
  if (!k) return null;
  const kind = { planned: STIB_PLANNED.test(k), last: STIB_LAST.test(k), noBoarding: STIB_NO_BOARDING.test(k) };
  return kind.planned || kind.last || kind.noBoarding ? kind : null;
}

/** Range un message dans une entrée : mention reconnue (drapeaux) ou message à montrer (`msg`). */
function applyStibMessage(entry: StibEntry, text: string | undefined): StibEntry {
  const kind = stibMessageKind(text);
  if (!kind) {
    if (text) entry.msg = text;
    return entry;
  }
  if (kind.planned) entry.planned = true;
  if (kind.last) entry.last = true;
  if (kind.noBoarding) entry.noBoarding = true;
  return entry;
}
export type AlertItem = AlertsResponse['alerts'][number];

const RT_TTL = 20_000;
const ERROR_TTL = 15_000;
const ALERT_TTL = 60_000;
const RT_TIMEOUT = 8_000;
const MAX_TRIPS = 60;
const MAX_POINTS = 30;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export class RealtimeClient {
  private readonly tripCache = new Map<string, { at: number; v: RtTrip | null }>();
  private readonly stibCache = new Map<string, { at: number; v: StibEntry[] | null }>();
  private readonly alertCache = new Map<string, { at: number; v: AlertItem[] }>();
  private readonly errorAt = new Map<string, number>();

  constructor(
    private readonly base: string,
    private readonly fetchFn: FetchLike,
    private readonly now: () => number,
  ) {}

  /** Mises à jour des voyages demandés (absent du flux = null). `error` : la source n'a pas répondu. */
  async trips(op: Op, ids: readonly string[]): Promise<{ map: Map<string, RtTrip | null>; error: boolean }> {
    const now = this.now();
    const map = new Map<string, RtTrip | null>();
    const missing: string[] = [];
    for (const raw of new Set(ids)) {
      if (!raw) continue;
      const id = normalizeId(raw);
      const c = this.tripCache.get(`${op}|${id}`);
      if (c && now - c.at < RT_TTL && now >= c.at) map.set(id, c.v);
      else missing.push(id);
    }
    if (!missing.length) return { map, error: false };
    if (this.recentError(op, now)) return { map, error: true };
    for (const part of chunks(missing, MAX_TRIPS)) {
      try {
        const body = await this.getJson(`/api/rt?op=${op}&trips=${part.map(encodeURIComponent).join(',')}`);
        const got = parseRt(body);
        for (const id of part) {
          const v = got.get(id) ?? null;
          this.tripCache.set(`${op}|${id}`, { at: now, v });
          map.set(id, v);
        }
      } catch {
        this.errorAt.set(op, now);
        return { map, error: true };
      }
    }
    this.prune(this.tripCache, now);
    return { map, error: false };
  }

  /** Passages STIB par point d'arrêt (pointid numérique). */
  async stib(points: readonly string[]): Promise<{ map: Map<string, StibEntry[] | null>; error: boolean }> {
    const now = this.now();
    const map = new Map<string, StibEntry[] | null>();
    const missing: string[] = [];
    for (const raw of new Set(points)) {
      const pid = stibPoint(raw);
      if (!pid) continue;
      const c = this.stibCache.get(pid);
      if (c && now - c.at < RT_TTL && now >= c.at) map.set(pid, c.v);
      else missing.push(pid);
    }
    if (!missing.length) return { map, error: false };
    if (this.recentError('stib', now)) return { map, error: true };
    for (const part of chunks(missing, MAX_POINTS)) {
      try {
        const body = await this.getJson(`/api/stib?points=${part.join(',')}`);
        const got = parseStib(body, now);
        for (const pid of part) {
          const v = got.get(pid) ?? null;
          this.stibCache.set(pid, { at: now, v });
          map.set(pid, v);
        }
      } catch {
        this.errorAt.set('stib', now);
        return { map, error: true };
      }
    }
    this.prune(this.stibCache, now);
    return { map, error: false };
  }

  /** Alertes d'un opérateur GTFS-RT (null si la source est en erreur). */
  async alerts(op: Op, routes: readonly string[], stops: readonly string[]): Promise<AlertItem[] | null> {
    const now = this.now();
    const r = [...new Set(routes.filter(Boolean))].sort();
    const s = [...new Set(stops.filter(Boolean))].sort();
    const key = `${op}|${r.join(',')}|${s.join(',')}`;
    const c = this.alertCache.get(key);
    if (c && now - c.at < ALERT_TTL && now >= c.at) return c.v;
    try {
      const q = [`op=${op}`];
      if (r.length) q.push(`routes=${r.map(encodeURIComponent).join(',')}`);
      if (s.length) q.push(`stops=${s.map(encodeURIComponent).join(',')}`);
      const body = await this.getJson(`/api/alerts?${q.join('&')}`);
      const v = parseAlerts(body);
      if (this.alertCache.size > 200) this.alertCache.clear();
      this.alertCache.set(key, { at: now, v });
      return v;
    } catch {
      return null;
    }
  }

  async health(): Promise<HealthResponse> {
    try {
      const body = await this.getJson('/api/health');
      if (isObj(body) && typeof body.ok === 'boolean' && isObj(body.sources)) return body as unknown as HealthResponse;
      throw new Error('réponse invalide');
    } catch {
      const down = { ok: false, error: 'Relais injoignable' };
      return {
        ok: false,
        time: new Date(this.now()).toISOString(),
        sources: { sncb: { ...down }, stib: { ...down }, delijn: { ...down }, tec: { ...down } },
      };
    }
  }

  private recentError(key: string, now: number): boolean {
    const at = this.errorAt.get(key);
    return at !== undefined && now >= at && now - at < ERROR_TTL;
  }

  private prune<V>(cache: Map<string, { at: number; v: V }>, now: number): void {
    if (cache.size < 2000) return;
    for (const [k, c] of cache) if (now - c.at >= RT_TTL) cache.delete(k);
  }

  /**
   * Le relais envoie « Cache-Control: public, s-maxage=20, stale-while-revalidate=40 » pour le CDN ; une WebView
   * ignore s-maxage mais applique stale-while-revalidate et rendrait la réponse précédente (un cycle de 30 s de
   * retard). Le cœur gère son propre cache (RT_TTL) : pas de cache HTTP pour le temps réel.
   */
  private async getJson(path: string): Promise<unknown> {
    const r = await getText(this.fetchFn, `${this.base}${path}`, RT_TIMEOUT, true);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const body = safeJson(r.text);
    if (body === undefined) throw new Error('JSON invalide');
    if (isObj(body) && typeof body.error === 'string' && body.error) throw new Error(body.error);
    return body;
  }
}

/** pointid STIB : identifiant numérique nu (« 5153F » → « 5153 »). */
export function stibPoint(id: string): string {
  return normalizeId(String(id ?? '').trim()).replace(/[A-Za-z]+$/, '');
}

const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);

export function parseRt(body: unknown): Map<string, RtTrip> {
  if (!isObj(body) || !isObj(body.trips)) throw new Error('réponse /api/rt invalide');
  const out = new Map<string, RtTrip>();
  for (const [rawId, t] of Object.entries(body.trips)) {
    if (!isObj(t)) continue;
    const u: RtUpdate[] = [];
    if (Array.isArray(t.u)) {
      for (const x of t.u) {
        if (!Array.isArray(x) || x.length < 2) continue;
        const seq = numOrNull(x[0]);
        u.push([seq, normalizeId(String(x[1] ?? '')), numOrNull(x[2]), numOrNull(x[3]), x[4] === 1 || x[4] === true ? 1 : 0]);
      }
    }
    const trip: RtTrip = { u };
    if (t.cancelled === true) trip.cancelled = true;
    out.set(normalizeId(rawId), trip);
  }
  return out;
}

function namesOf(x: unknown): Names {
  if (typeof x === 'string') return { fr: x, nl: x };
  if (isObj(x)) {
    const fr = typeof x.fr === 'string' ? x.fr : '';
    const nl = typeof x.nl === 'string' ? x.nl : '';
    return { fr: fr || nl, nl: nl || fr };
  }
  return { fr: '', nl: '' };
}

function textOf(x: unknown): string | undefined {
  if (typeof x === 'string') return x.trim() || undefined;
  if (isObj(x)) {
    for (const k of ['fr', 'nl', 'en']) {
      const v = x[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return undefined;
}

/**
 * Heure STIB : ISO 8601 (cas réel), « HH:MM » à l'heure belge (fixtures) ou epoch (s ou ms).
 */
export function parseStibTime(x: unknown, now: number): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x > 1e12 ? x : x * 1000;
  if (typeof x !== 'string') return null;
  const s = x.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const p = brusselsParts(now);
    const guess = Date.UTC(p.y, p.mo - 1, p.d, Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
    let t = guess - tzOffsetMs(guess);
    t = guess - tzOffsetMs(t);
    if (t < now - 12 * 3_600_000) t += 86_400_000;
    else if (t > now + 12 * 3_600_000) t -= 86_400_000;
    return t;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * Réponse /api/stib. Le relais regroupe les passages par ligne, destination et message : `msg` vaut pour toutes
 * les heures de l'entrée. Des passages bruts (`times` en objets avec leur propre `message`) sont aussi acceptés :
 * une entrée par message. Les mentions de service (« Temps théorique », « Ne pas embarquer », « Dernier passage »)
 * deviennent des drapeaux et ne sont jamais montrées comme un message de l'opérateur.
 */
export function parseStib(body: unknown, now: number): Map<string, StibEntry[]> {
  if (!isObj(body) || !isObj(body.points)) throw new Error('réponse /api/stib invalide');
  const out = new Map<string, StibEntry[]>();
  for (const [rawPid, list] of Object.entries(body.points)) {
    const pid = stibPoint(rawPid);
    if (!Array.isArray(list)) continue;
    const entries: StibEntry[] = [];
    for (const e of list) {
      if (!isObj(e)) continue;
      let times: unknown = e.times;
      if (typeof times === 'string') times = safeJson(times);
      if (!Array.isArray(times)) continue;
      const line = String(e.line ?? e.lineId ?? '').trim();
      if (!line) continue;
      const dest = namesOf(e.dest ?? e.destination);
      const groupMsg = textOf(e.msg ?? e.message);
      const byMsg = new Map<string, number[]>();
      for (const t of times) {
        const ms = parseStibTime(isObj(t) ? t.expectedArrivalTime : t, now);
        if (ms === null) continue;
        const own = isObj(t) ? textOf(t.message ?? t.msg) : undefined;
        const key = own ?? groupMsg ?? '';
        const arr = byMsg.get(key);
        if (arr) arr.push(ms);
        else byMsg.set(key, [ms]);
      }
      if (!byMsg.size) byMsg.set(groupMsg ?? '', []);
      for (const [msg, ms] of byMsg) entries.push(applyStibMessage({ line, dest: { ...dest }, times: ms.sort((a, b) => a - b) }, msg || undefined));
    }
    out.set(pid, [...(out.get(pid) ?? []), ...entries]);
  }
  return out;
}

function parseAlerts(body: unknown): AlertItem[] {
  if (!isObj(body) || !Array.isArray(body.alerts)) throw new Error('réponse /api/alerts invalide');
  const out: AlertItem[] = [];
  for (const a of body.alerts) {
    if (!isObj(a)) continue;
    const header: AlertItem['header'] = {};
    if (isObj(a.header)) {
      for (const k of ['fr', 'nl', 'en', 'de'] as const) {
        const v = a.header[k];
        if (typeof v === 'string' && v.trim()) header[k] = v.trim();
      }
    }
    const active: [number, number][] = [];
    if (Array.isArray(a.active)) {
      for (const r of a.active) if (Array.isArray(r)) active.push([numOrNull(r[0]) ?? 0, numOrNull(r[1]) ?? 0]);
    }
    out.push({
      id: String(a.id ?? ''),
      routes: Array.isArray(a.routes) ? a.routes.map((x) => normalizeId(String(x))) : [],
      stops: Array.isArray(a.stops) ? a.stops.map((x) => normalizeId(String(x))) : [],
      header,
      active,
    });
  }
  return out;
}
