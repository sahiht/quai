/**
 * Le vrai moteur de Quai (computeRoute de routing/engine.ts) sur un instantané lu sur disque, sans temps réel
 * (refresh = identité, comme le contrôle « réseau complet » de app/test/core/routing/real.test.ts). Propositions et
 * candidats (debug.cands) convertis au format commun OTrip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, engine, MIN, rankMod } from './quai';
import { finish, type OLeg, type OTrip } from './search';

export interface Endpoint {
  type: 'area' | 'address';
  areaId?: string;
  op?: string;
  name?: { fr: string; nl: string };
  label?: string;
  lat: number;
  lon: number;
}

export interface EProposal extends OTrip {
  label: string;
  reason: string;
  /** Heure de départ affichée (marche et marge « partir » comprises), minutes depuis base0. */
  shownDep: number;
  id: string;
}

export interface EngineResult {
  proposals: EProposal[];
  cands: OTrip[];
  mode: string;
  empty?: string;
  ms: number;
  net?: unknown;
}

const sources = new Map<string, unknown>();

function sourceOf(dir: string) {
  let s = sources.get(dir);
  if (s) return s;
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const cache = new Map<string, unknown>();
  const read = (p: string) => {
    if (cache.has(p)) return cache.get(p);
    let v: unknown = null;
    try {
      v = JSON.parse(readFileSync(join(dir, p), 'utf8'));
    } catch {
      v = null;
    }
    cache.set(p, v);
    return v;
  };
  s = {
    meta,
    tile: async (k: string) => read(`tiles/${k}.json`),
    json: async (p: string, valid: (x: unknown) => boolean) => {
      const v = read(p);
      return valid(v) ? v : null;
    },
    trains: async (d: string) => read(`trains/${d}.json`),
  };
  sources.set(dir, s);
  return s;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Trajet du moteur au format commun (heures prévues, minutes depuis base0). */
export function fromJourney(j: any, base0: number): OTrip {
  const legs: OLeg[] = [];
  const n = j.legs.length;
  const waits: number[] = [];
  let prev: any = null;
  let walk = 0;
  let uu = 0;
  j.legs.forEach((l: any, i: number) => {
    if (l.kind === 'walk') {
      walk += l.walkMin ?? 0;
      legs.push({
        kind: 'walk',
        from: i === 0 ? 'O' : (l.from.areaId ?? 'O'),
        to: i === n - 1 ? 'D' : (l.to.areaId ?? 'D'),
        dep: (l.schedDep - base0) / MIN,
        arr: (l.schedArr - base0) / MIN,
        walk: Math.round(l.walkMin ?? 0),
      });
      return;
    }
    const urban = l.op !== 'sncb';
    if (prev) {
      waits.push((l.schedDep - prev.schedArr) / MIN - walk);
      if (prev.op !== 'sncb' && urban) uu++;
    }
    legs.push({
      kind: 'ride',
      from: l.from.areaId ?? '',
      to: l.to.areaId ?? '',
      dep: (l.schedDep - base0) / MIN,
      arr: (l.schedArr - base0) / MIN,
      op: l.op,
      mode: l.mode,
      line: l.op === 'sncb' ? (l.cat ?? l.line ?? '') : (l.line ?? ''),
      head: l.head?.fr ?? '',
      tripId: l.tripId ?? '',
      urban,
    });
    prev = l;
    walk = 0;
  });
  const t = finish('engine', legs, waits, uu, false);
  // contrôle : même lecture que le classement de Quai (itemOf)
  const it = rankMod.itemOf(j);
  if (Math.abs(it.dep - (t.dep + base0 / MIN)) > 0.01 || Math.abs(it.arr - (t.arr + base0 / MIN)) > 0.01 || it.transfers !== t.transfers)
    throw new Error(`lecture du trajet ${j.id} : ${it.dep - base0 / MIN}/${t.dep} ${it.arr - base0 / MIN}/${t.arr}`);
  return t;
}

export async function runEngine(dir: string, from: Endpoint, to: Endpoint, atMs: number, maxWalkMin: number, base0: number): Promise<EngineResult> {
  const source = sourceOf(dir);
  const settings = { ...api.DEFAULT_SETTINGS, onboarded: true, maxWalkMin };
  const debug = { cands: [] as any[], raw: [] as any[], files: 0, computeMs: 0, mode: 'lines' };
  const t0 = performance.now();
  const r = await engine.computeRoute(from, to, atMs, settings, null, { source, now: () => atMs, refresh: async (js: unknown[]) => js }, debug);
  const ms = Math.round(performance.now() - t0);
  const proposals: EProposal[] = r.journeys.map((j: any) => ({
    ...fromJourney(j, base0),
    label: j.label,
    reason: String(j.reason ?? '').replace(/ /g, ' '),
    shownDep: (j.dep - base0) / MIN,
    id: j.id,
  }));
  const cands = (debug.cands ?? []).map((j: any) => fromJourney(j, base0));
  return { proposals, cands, mode: debug.mode, empty: r.empty, ms, net: (debug as any).net };
}
