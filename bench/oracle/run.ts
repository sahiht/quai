/**
 * Banc interne de cohérence : oracle exhaustif, vrai moteur de QUAI_ROOT (marche maximale 5 et 10), contrôles, règles
 * candidates. Écrit bench/out/internal.json (contrôle hors échantillon : internal-holdout.json ; avec --tag x :
 * internal-x.json, internal-holdout-x.json).
 *
 *   cd bench/oracle && QUAI_ROOT=/home/claude/quai-122 npx tsx run.ts [--holdout] [--only t01,A] [--quick] [--tag x]
 *
 * 1.2.2 : F0 = les propositions du moteur mesuré (la 1.2.2 avec QUAI_ROOT sur ce dépôt) ; F0* = son classement
 * (rank.ts) rejoué sur l'ensemble complet ; F5 = la règle retenue, écrite dans rules.ts sans le code du moteur.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, dominatesShown, type CheckResult, type Shown } from './checks';
import { hm, legsText, linesOf } from './describe';
import { runEngine, type EngineResult, type Endpoint } from './engine-run';
import { loadNet, type ONet, type Pt } from './net';
import { QUAI_ROOT, util } from './quai';
import { admissible, byArr, costF1, F0star, F1, F2, F3, F4, F5, type Ctx } from './rules';
import { paretoDominates, search, walkOnly, type OTrip } from './search';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, '..', 'trips.json');
const OUT = join(HERE, '..', 'out');
const SNAP13 = process.env.QUAI_SNAP13 ?? '/home/claude/real-data-13/data';
const SNAP11 = process.env.QUAI_SNAP11 ?? '/home/claude/real-data-11/data';
const WALKS = [5, 10];

interface Spec {
  area?: string;
  point?: string;
  name: string;
  lat: number;
  lon: number;
}
interface Case {
  id: string;
  snap: string;
  trip: string;
  moment: string;
  at: string;
  from: Spec;
  to: Spec;
  tags: string[];
  owner?: 'A' | 'B' | 'C';
}

const bench = JSON.parse(readFileSync(BENCH, 'utf8')) as { moments: { id: string; label: string; at: string }[]; trips: { id: string; from: Spec; to: Spec; tags: string[] }[] };
const BRAINE: Spec = { point: 'Braine-l’Alleud Côté du Collège (arrêt)', name: 'Braine-l’Alleud Côté du Collège', lat: 50.68634, lon: 4.39427 };
const SCHAERBEEK: Spec = { point: 'Schaerbeek Gare (arrêt STIB)', name: 'Schaerbeek Gare (STIB)', lat: 50.87755, lon: 4.37966 };
const MADOU: Spec = { point: 'Madou (arrêt STIB)', name: 'Madou (STIB)', lat: 50.84969, lon: 4.36949 };
const OWNER: Case[] = [
  { id: 'A', owner: 'A', snap: SNAP11, trip: 'A', moment: 'mer-1942', at: '2026-11-11T19:42:00+01:00', from: BRAINE, to: SCHAERBEEK, tags: ['propriétaire', 'férié'] },
  { id: 'B', owner: 'B', snap: SNAP11, trip: 'B', moment: 'jeu-0731', at: '2026-11-12T07:31:00+01:00', from: BRAINE, to: MADOU, tags: ['propriétaire'] },
  { id: 'C', owner: 'C', snap: SNAP11, trip: 'C', moment: 'mer-1330', at: '2026-11-11T13:30:00+01:00', from: BRAINE, to: MADOU, tags: ['propriétaire', 'férié'] },
];
const args = process.argv.slice(2);
/** Contrôle hors échantillon (--holdout) : les 50 trajets sur l'autre instantané, jeudi 12/11 08:15 et férié 11/11 15:00. */
const HOLDOUT = [
  { id: 'jeu-0815', at: '2026-11-12T08:15:00+01:00' },
  { id: 'fer-1500', at: '2026-11-11T15:00:00+01:00' },
];
const holdout = args.includes('--holdout');
const CASES: Case[] = holdout
  ? bench.trips.flatMap((t) => HOLDOUT.map((m) => ({ id: `${t.id}@${m.id}`, snap: SNAP11, trip: t.id, moment: m.id, at: m.at, from: t.from, to: t.to, tags: t.tags })))
  : [...bench.trips.flatMap((t) => bench.moments.map((m) => ({ id: `${t.id}@${m.id}`, snap: SNAP13, trip: t.id, moment: m.id, at: m.at, from: t.from, to: t.to, tags: t.tags }))), ...OWNER];

const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const quick = args.includes('--quick');
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : '';

const endpoint = (s: Spec): Endpoint =>
  s.area ? { type: 'area', areaId: s.area, op: s.area.split(':')[0], name: { fr: s.name, nl: s.name }, lat: s.lat, lon: s.lon } : { type: 'address', label: s.name, lat: s.lat, lon: s.lon };
const pt = (s: Spec): Pt => ({ lat: s.lat, lon: s.lon, ...(s.area ? { areaId: s.area } : {}) });

/** Trajet compact pour le JSON et le rapport. */
function compact(net: ONet, t: OTrip, T: number, extra: Record<string, unknown> = {}) {
  return {
    src: t.src,
    dep: hm(t.dep),
    arr: hm(t.arr),
    depMin: t.dep - T,
    arrMin: t.arr - T,
    walks: t.walks,
    lw: t.lw,
    tw: t.tw,
    tr: t.transfers,
    waits: t.waits,
    lines: linesOf(t),
    legs: legsText(net, t),
    key: t.key,
    ...(t.outsideEngineRadius ? { outsideEngineRadius: true } : {}),
    ...extra,
  };
}

/* ---------- attentes du propriétaire (cas A, B, C) ---------- */
const rides = (t: OTrip) => t.legs.filter((l) => l.kind === 'ride');
const isMetro = (l: OTrip['legs'][number]) => l.op === 'stib' && (l.line === '2' || l.line === '6');
const bus36Rixensart = (t: OTrip) => rides(t).some((l) => l.op === 'tec' && l.line === '36' && /rixensart/i.test(`${l.head ?? ''}`));
function ownerOk(c: Case, shown: Shown[], net: ONet): { ok: boolean; why: string } {
  const p = shown[0];
  if (!p) return { ok: false, why: 'aucune proposition' };
  const r = rides(p);
  if (c.owner === 'A') {
    const firstWalk = p.legs[0]?.kind === 'walk' ? (p.legs[0].walk ?? 0) : 0;
    // 1.2.2 : la longue marche jusqu'à la gare (22 min, IC) seulement en « Plus tôt »
    const longOther = shown.slice(1).filter((s) => s.lw >= 15 && s.label !== 'earlier');
    const ok = r.length > 0 && r[0].op === 'tec' && firstWalk < 15 && p.lw < 15 && !longOther.length;
    return { ok, why: ok ? 'bus puis train, sans longue marche ; la longue marche seulement en « Plus tôt »' : `proposition 1 : ${linesOf(p)}, marche ${p.walks.join('+')}${longOther.length ? ` ; longue marche en « ${longOther[0].label} »` : ''}` };
  }
  if (c.owner === 'B') {
    const ok = r.length === 3 && r[0].op === 'tec' && r[0].line === '36' && !bus36Rixensart(p) && r[1].op === 'sncb' && r[1].line === 'IC' && hm(r[1].dep) === '08:01' && isMetro(r[2]);
    return { ok, why: ok ? 'bus 36, IC 08:01, métro' : `proposition 1 : ${legsText(net, p)}` };
  }
  const no36 = !shown.some(bus36Rixensart);
  const ok = r.length === 2 && r[0].op === 'tec' && r[0].line === 'W' && isMetro(r[1]) && no36;
  return { ok, why: ok ? 'bus W, métro' : `proposition 1 : ${legsText(net, p)}${no36 ? '' : ' ; bus 36 vers Rixensart proposé'}` };
}

/* ---------- règles ---------- */
interface RuleSpec {
  id: string;
  name: string;
  run: (pool: OTrip[], c: Ctx, eng: EngineResult) => Shown[];
  /** U : oracle ∪ moteur ; Ug : idem avec le garde-fou « jamais plus lent que la marche seule » ; E : candidats du
   *  moteur seuls ; F0 : propositions du moteur. */
  pool: 'U' | 'Ug' | 'E' | 'F0';
}
const later = (e: EngineResult, c: Ctx) => e.cands.filter((x) => x.dep > c.T + 60);
const RULES: RuleSpec[] = [
  { id: 'F0', name: '1.2.1 telle que livrée (moteur)', pool: 'F0', run: () => [] },
  { id: 'F0*', name: 'règle 1.2.1 (rank.ts) rejouée sur oracle ∪ moteur', pool: 'U', run: (p, c, e) => F0star(p, c, later(e, c)) },
  { id: 'F0*g', name: 'règle 1.2.1 rejouée, avec le garde-fou « jamais plus lent que la marche »', pool: 'Ug', run: (p, c, e) => F0star(p, c, later(e, c)) },
];
for (const wWalk of [1, 1.5, 2])
  for (const p of [3, 5, 8])
    for (const wWait of [0, 0.5]) RULES.push({ id: `F1(${wWalk},${p},${wWait})`, name: `F1 w_marche ${wWalk}, p ${p}, w_attente ${wWait}`, pool: 'U', run: (pool, c) => F1(pool, c, { wWalk, p, wWait }) });
for (const X of [10, 15, 20]) RULES.push({ id: `F2(${X})`, name: `F2 X = ${X} min`, pool: 'U', run: (pool, c) => F2(pool, c, X) });
for (const X of [10, 15, 20, 30]) RULES.push({ id: `F3(${X})`, name: `F3 (paliers) X = ${X} min`, pool: 'U', run: (pool, c) => F3(pool, c, X) });
for (const lambda of [1.5, 2, 3, 4])
  for (const p of [0, 1, 3, 5]) RULES.push({ id: `F4(${lambda},${p})`, name: `F4 λ ${lambda}, p ${p}`, pool: 'U', run: (pool, c) => F4(pool, c, lambda, p) });
// 1.2.2 : la règle retenue (F4(3,1) et ses autres propositions, gardes), sans le code du moteur
RULES.push({ id: 'F5', name: 'règle 1.2.2 (F4 λ 3, p 1, autres propositions et gardes), écrite dans rules.ts', pool: 'U', run: (pool, c, e) => F5(pool, c, later(e, c)) });
RULES.push({ id: 'F5/moteur', name: 'règle 1.2.2 sur les seuls candidats du moteur', pool: 'E', run: (pool, c, e) => F5(pool, c, later(e, c)) });
// avec le garde-fou « jamais plus lent que la marche seule » du moteur
for (const id of ['F3(15)', 'F3(20)', 'F4(3,0)', 'F4(3,1)', 'F1(2,5,0)']) {
  const base = RULES.find((r) => r.id === id)!;
  RULES.push({ id: `${id}g`, name: `${base.name}, avec le garde-fou « jamais plus lent que la marche »`, pool: 'Ug', run: base.run });
}
// sur les seuls candidats du moteur (remplacement direct de rank.ts, recherche inchangée)
RULES.push({ id: 'F0*/moteur', name: 'règle 1.2.1 rejouée sur les candidats du moteur', pool: 'E', run: (p, c, e) => F0star(p, c, later(e, c)) });
for (const X of [15, 20]) RULES.push({ id: `F2(${X})/moteur`, name: `F2 X = ${X} min, candidats du moteur`, pool: 'E', run: (pool, c) => F2(pool, c, X) });
for (const X of [15, 20, 30]) RULES.push({ id: `F3(${X})/moteur`, name: `F3 X = ${X} min, candidats du moteur`, pool: 'E', run: (pool, c) => F3(pool, c, X) });
RULES.push({ id: 'F1(2,5,0)/moteur', name: 'F1 (2 ; 5 ; 0), candidats du moteur', pool: 'E', run: (pool, c) => F1(pool, c, { wWalk: 2, p: 5, wWait: 0 }) });
for (const [lambda, p] of [[3, 0], [3, 1], [2, 0]]) RULES.push({ id: `F4(${lambda},${p})/moteur`, name: `F4 λ ${lambda}, p ${p}, candidats du moteur`, pool: 'E', run: (pool, c) => F4(pool, c, lambda, p) });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const t0 = performance.now();
  const results: unknown[] = [];
  const validation = { cases: 0, earliestOk: 0, earliestBetter: 0, earliestWorse: [] as string[], engineCands: 0, covered: 0, uncovered: [] as string[] };
  const list = CASES.filter((c) => !only || only.some((o) => c.id === o || c.trip === o)).slice(0, quick ? 6 : undefined);
  for (const c of list) {
    const net = loadNet(c.snap);
    const atMs = Date.parse(c.at);
    const T = Math.round((atMs - net.base0) / 60_000);
    const O = pt(c.from);
    const D = pt(c.to);
    const direct = util.walkMinutes(util.distanceM(O, D)) as number;
    const or = search(net, O, D, T);
    const oracle = or.trips;
    const perWalk: Record<string, unknown> = {};
    for (const M of WALKS) {
      const eng = await runEngine(c.snap, endpoint(c.from), endpoint(c.to), atMs, M, net.base0);
      const ctx: Ctx = { T, M, direct, base0: net.base0 };
      // validation de l'oracle : arrivée la plus tôt et couverture des candidats du moteur (départ dans l'heure,
      // garde-fous du produit)
      const engIn = eng.cands.filter((x) => x.rides > 0 && x.dep >= T && x.dep <= T + 60 && x.maxWait <= 60 && x.uu <= 1);
      const orIn = oracle.filter((x) => x.rides > 0);
      if (M === WALKS[0] || true) {
        validation.cases++;
        if (engIn.length) {
          const ea = Math.min(...engIn.map((x) => x.arr));
          const oa = orIn.length ? Math.min(...orIn.map((x) => x.arr)) : Infinity;
          if (oa <= ea) validation.earliestOk++;
          if (oa < ea) validation.earliestBetter++;
          if (oa > ea) validation.earliestWorse.push(`${c.id} M${M} : oracle ${hm(oa)} moteur ${hm(ea)}`);
        } else validation.earliestOk++;
        for (const x of engIn) {
          validation.engineCands++;
          if (oracle.some((y) => paretoDominates(y, x))) validation.covered++;
          else if (validation.uncovered.length < 40) validation.uncovered.push(`${c.id} M${M} : ${legsText(net, x)} (${hm(x.dep)} → ${hm(x.arr)}, marche ${x.walks.join('+')})`);
        }
      }
      // la marche seule (30 min au plus) concourt toujours, même quand un trajet de l'oracle la domine
      const walk = walkOnly(T, direct);
      const U = admissible([...oracle, ...eng.cands, walk], ctx);
      const Ug = admissible([...oracle, ...eng.cands, walk], ctx, true);
      const Epool = admissible([...eng.cands, walk], ctx);
      const Eu = [...U].sort(byArr)[0];
      const rules: Record<string, unknown> = {};
      for (const r of RULES) {
        const shown: Shown[] = r.pool === 'F0' ? eng.proposals : r.run(r.pool === 'U' ? U : r.pool === 'Ug' ? Ug : Epool, ctx, eng);
        const chk: CheckResult = check(shown, oracle, M);
        // garde 1.2.2 sur chaque proposition : aucune dominée par un trajet de l'oracle ni par la marche seule
        const beaten = shown
          .map((s) => ({ s, by: [...oracle, walk].find((x) => x.key !== s.key && dominatesShown(x, s)) }))
          .filter((x) => x.by);
        const p = shown[0];
        const f1 = /^F1\(([\d.]+),([\d.]+),([\d.]+)\)/.exec(r.id);
        rules[r.id] = {
          p1: p ? compact(net, p, T, { label: p.label, ...(p.reason ? { reason: p.reason } : {}) }) : null,
          alts: shown.slice(1).map((s) => compact(net, s, T, { label: s.label, ...(s.reason ? { reason: s.reason } : {}) })),
          extra: p && Eu ? p.arr - Eu.arr : null,
          slowerThanWalk: !!p && p.rides > 0 && direct <= 30 && p.arr > T + direct + 5,
          lw: p?.lw ?? null,
          tw: p?.tw ?? null,
          tr: p?.transfers ?? null,
          cost: p && f1 ? costF1(p, { wWalk: Number(f1[1]), p: Number(f1[2]), wWait: Number(f1[3]) }) - T : undefined,
          check: { ...chk, findings: chk.findings.map((f) => ({ kind: f.kind, detail: f.detail, other: f.other ? compact(net, f.other, T) : undefined })) },
          beaten: beaten.map((x) => ({ shown: compact(net, x.s, T, { label: x.s.label }), by: compact(net, x.by as OTrip, T) })),
          owner: c.owner ? ownerOk(c, shown, net) : undefined,
        };
      }
      perWalk[`M${M}`] = {
        engine: {
          mode: eng.mode,
          empty: eng.empty,
          ms: eng.ms,
          net: eng.net,
          proposals: eng.proposals.map((p) => compact(net, p, T, { label: p.label, reason: p.reason, shownDep: hm(p.shownDep) })),
          cands: eng.cands.map((x) => compact(net, x, T)),
        },
        earliest: Eu ? compact(net, Eu, T) : null,
        poolU: U.length,
        poolUg: Ug.length,
        poolE: Epool.length,
        rules,
      };
    }
    results.push({
      id: c.id,
      trip: c.trip,
      moment: c.moment,
      at: c.at,
      snap: c.snap,
      owner: c.owner,
      tags: c.tags,
      from: c.from,
      to: c.to,
      T: hm(T),
      direct,
      oracle: { stats: or.stats, trips: oracle.map((x) => compact(net, x, T)) },
      ...perWalk,
    });
    const f0 = (perWalk.M5 as { rules: Record<string, { p1: { dep: string; arr: string; lines: string; walks: number[] } | null; check: CheckResult }> }).rules.F0;
    console.log(
      `${c.id.padEnd(16)} oracle ${String(oracle.length).padStart(3)} trajets ${String(or.stats.ms).padStart(5)} ms | M5 F0 ${f0.p1 ? `${f0.p1.dep}→${f0.p1.arr} ${f0.p1.lines} (${f0.p1.walks.join('+')})` : '-'}${f0.check.dominated ? ' DOMINÉE' : ''}${f0.check.absurdWalk ? ' MARCHE' : ''}${f0.check.missed ? ' OUBLI' : ''}${f0.check.labelIssues.length ? ' ÉTIQUETTE' : ''}`,
    );
  }
  const out = {
    v: 1,
    generatedAt: new Date().toISOString(),
    quaiRoot: QUAI_ROOT,
    snapshots: { bench: SNAP13, owner: SNAP11 },
    walks: WALKS,
    rules: RULES.map((r) => ({ id: r.id, name: r.name, pool: r.pool })),
    validation,
    seconds: Math.round((performance.now() - t0) / 1000),
    cases: results,
  };
  const suffix = tag ? `-${tag}` : '';
  const file = join(OUT, only || quick ? `internal-partial${suffix}.json` : holdout ? `internal-holdout${suffix}.json` : `internal${suffix}.json`);
  writeFileSync(file, JSON.stringify(out));
  console.log(`\n${list.length} cas en ${out.seconds} s → ${file}`);
  console.log('validation', { ...validation, uncovered: validation.uncovered.slice(0, 10), earliestWorse: validation.earliestWorse.slice(0, 10) });
}

await main();
