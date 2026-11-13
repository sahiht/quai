/**
 * STIB WaitingTimes (pas de GTFS-RT) : construction de la requête et lecture souple des réponses.
 * Formes acceptées : objet Opendatasoft { total_count, results: [...] } (ou records[].fields), ou tableau nu ;
 * passingtimes en chaîne JSON ou en tableau ; destination objet { fr, nl } ou chaîne ; message chaîne ou { fr, nl }.
 * Les destinations sont rendues telles quelles (l'appli les met en forme).
 */
import type { Names } from './shared/types.js';
import { UpstreamError } from './upstream.js';
import { parseTime, toBrusselsIso } from './time.js';
import { withoutBidi } from './gtfsrt.js';

export interface StibGroup { line: string; dest: Names; times: string[]; msg?: string }

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** where=pointid="5153" or pointid="5154" (les pointid ont été vérifiés : chiffres seulement). */
export function buildWhere(points: readonly string[]): string {
  return points.map((p) => `pointid="${p}"`).join(' or ');
}

export function stibQuery(points: readonly string[], limit: number, offset: number): string {
  return `where=${encodeURIComponent(buildWhere(points))}&limit=${limit}&offset=${offset}`;
}

function unwrap(r: unknown): Obj | null {
  if (!isObj(r)) return null;
  if (isObj(r.fields)) return r.fields;
  if (isObj(r.record) && isObj(r.record.fields)) return r.record.fields;
  return r;
}

export function extractRows(body: unknown): { rows: Obj[]; total: number | null } {
  const list = Array.isArray(body) ? body
    : isObj(body) && Array.isArray(body.results) ? body.results
    : isObj(body) && Array.isArray(body.records) ? body.records
    : null;
  if (!list) throw new UpstreamError('Réponse STIB inattendue', 'WaitingTimes : format de réponse inconnu');
  const total = isObj(body) && typeof body.total_count === 'number' ? body.total_count
    : isObj(body) && typeof body.nhits === 'number' ? body.nhits
    : null;
  return { rows: list.map(unwrap).filter((r): r is Obj => r !== null), total };
}

function passingTimes(v: unknown): Obj[] {
  let x = v;
  for (let i = 0; i < 2 && typeof x === 'string'; i++) {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  if (Array.isArray(x)) return x.filter(isObj);
  return isObj(x) ? [x] : [];
}

function names(d: unknown): Names {
  if (typeof d === 'string') {
    const s = d.trim();
    return { fr: s, nl: s };
  }
  if (isObj(d)) {
    const fr = str(d.fr ?? d.FR), nl = str(d.nl ?? d.NL);
    return { fr: fr || nl, nl: nl || fr };
  }
  return { fr: '', nl: '' };
}

function message(m: unknown): string | undefined {
  const raw = typeof m === 'string' ? m : isObj(m) ? str(m.fr) || str(m.nl) || str(m.en) : '';
  // 1.2.5 : sans les caractères invisibles de sens d'écriture (voir gtfsrt.ts, withoutBidi)
  const s = withoutBidi(raw).trim();
  return s || undefined;
}

/**
 * Regroupe par arrêt, puis par ligne + destination + message ; heures triées, en ISO avec le décalage de Bruxelles.
 * Le message vaut donc pour toutes les heures de son groupe : un passage « Temps théorique », « Ne pas embarquer »
 * ou « Dernier passage » n'est jamais mélangé aux autres passages de la même ligne (l'appli les traite à part).
 * Seuls les arrêts demandés sont gardés ; chacun est présent dans le résultat (liste vide si rien).
 */
export function groupWaitingTimes(rows: readonly Obj[], points: readonly string[]): Map<string, StibGroup[]> {
  const wanted = new Set(points);
  const acc = new Map<string, Map<string, { line: string; dest: Names; times: Set<number>; msg?: string }>>();
  for (const p of points) acc.set(p, new Map());
  for (const row of rows) {
    const point = str(row.pointid ?? row.pointId ?? row.point_id);
    if (!wanted.has(point)) continue;
    const rowLine = str(row.lineid ?? row.lineId ?? row.line_id);
    const groups = acc.get(point)!;
    for (const pt of passingTimes(row.passingtimes ?? row.passingTimes ?? row.passing_times)) {
      const line = str(pt.lineId ?? pt.lineid ?? pt.line) || rowLine;
      if (!line) continue;
      const t = parseTime(pt.expectedArrivalTime ?? pt.expectedarrivaltime ?? pt.expected_arrival_time);
      const dest = names(pt.destination);
      const msg = message(pt.message);
      const key = `${line}\u0001${dest.fr}\u0001${dest.nl}\u0001${msg ?? ''}`;
      let g = groups.get(key);
      if (!g) {
        g = { line, dest, times: new Set() };
        if (msg) g.msg = msg;
        groups.set(key, g);
      }
      if (t != null) g.times.add(t);
    }
  }
  const out = new Map<string, StibGroup[]>();
  for (const [point, groups] of acc) {
    const list = [...groups.values()]
      .filter((g) => g.times.size > 0)
      .map((g) => ({ g, sorted: [...g.times].sort((a, b) => a - b) }))
      .sort((a, b) => a.sorted[0] - b.sorted[0] || a.g.line.localeCompare(b.g.line, 'fr', { numeric: true }))
      .map(({ g, sorted }) => {
        const item: StibGroup = { line: g.line, dest: g.dest, times: sorted.map(toBrusselsIso) };
        if (g.msg) item.msg = g.msg;
        return item;
      });
    out.set(point, list);
  }
  return out;
}
