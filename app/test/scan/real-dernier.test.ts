/**
 * 1.3.1 (PRD-1.3.1 § 14, R3) : balayage de toutes les zones d'une publication de nuit (SNCB, STIB, De Lijn, TEC) pour
 * « , dernier » d'après l'horaire. Pour chaque départ marqué (scheduleLast), un contrôle indépendant relit les départs
 * bruts de la zone : aucun départ de la même ligne (tous les trains SNCB ensemble) dans le même sens (même destination,
 * ou une zone suivante commune) entre lui et 04:00 qui suit, même minute comprise (même ligne et même destination à la
 * même minute : le même départ), quel que soit son jour de service ; toute cette fenêtre dans les jours publiés. Puis
 * les tableaux (buildBoards, horaire seul) à 22:30 le premier jour, à 00:30 et à 03:30 dans la nuit : un départ marqué n'a aucun
 * départ du même sens après lui avant demain dans son tableau ; dans les lunettes, la marque se lit en entier et tout
 * tient au pixel. Enfin les trains (trains/{date}.json), comme l'écran du trajet : chaque voyage à chacune de ses gares
 * de montée du premier jour, la marque des trains (trainLegLast) comparée au contrôle indépendant sur le fichier de la
 * zone de la gare.
 *
 * Contrôle du 20/11 : 04:00 n'est pas une coupure pour une ligne qui roule. Le contrôle indépendant refuse aussi une
 * marque quand le départ suivant du même sens, après 04:00, part moins de 2 h plus tard (N62 de De Lijn, toute la nuit),
 * et, pour un départ d'avant 04:00 écrit sur le jour qui commence (« 03:48 », pas « 27:48 »), quand ce suivant est aussi
 * proche ou plus proche que le précédent ou qu'aucun ne le précède (premier bus du matin). Les variantes d'un numéro (« 20a » et « 20b », « 27 » et « 27/ ») sont une seule ligne.
 * Tableaux aussi à 03:30 ; tous les tableaux marqués passent dans les lunettes : la destination devant « , dernier »
 * n'est jamais coupée au milieu d'un mot (test/scan/cuts.ts). Coût du calcul des marques par zone, mesuré.
 *
 * Erreurs (le test échoue) : une marque quand un départ de la même ligne et du même sens suit, une marque hors des jours
 * publiés, une marque contredite dans un tableau, une marque coupée ou une rangée qui dépasse, une exception. Mesuré et
 * écrit dans le journal : départs, départs marqués par réseau, tableaux, exemples, accord des trains avec les zones.
 *
 * Décision du propriétaire du 20/11 à 21:58 (« est-ce que l'usager peut le prendre ou pas ») : pour les tableaux, la
 * famille d'un numéro (mêmes chiffres, lettres devant ou derrière : « 70 » et « X70 », « 10 » et « N10 ») est une seule
 * ligne. Pour l'écran du trajet, chaque étape possible est relue : chaque départ d'une zone vers chacune des zones où
 * son véhicule s'arrête ensuite (bus, tram, métro : destinationLastFlags), chaque train du premier jour de chaque gare
 * de montée vers chaque gare de descente (trainLegLast avec la descente). Une étape marquée n'a aucun départ plus tard,
 * avant demain, de n'importe quelle ligne, dont le véhicule s'arrête aussi à la descente. Comptées : les étapes
 * marquées, celles que le tableau ne marque pas (un express suit, il ne s'arrête pas à la descente) et les étapes non
 * marquées alors que le tableau marque leur départ (une autre ligne va encore à la descente).
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data) ; sans lui, ignoré.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta, Op, TrainsDay } from '../../../shared/types';
import { prepareArea, type PreparedArea } from '../../src/core/areas';
import { buildBoards, destinationLastFlags, lastWays, scheduleLast, scheduleLastFlags, trainLegLast } from '../../src/core/boards';
import type { RealtimeClient } from '../../src/core/realtime';
import { headKey } from '../../src/core/rtmerge';
import { addDays } from '../../src/core/freshness';
import { indexDay } from '../../src/core/trains';
import { brusselsParts, gtfsTime, hhmm, serviceDayBase } from '../../src/core/util';
import { layoutPage } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { boardView, type ViewCtx } from '../../src/glasses/views';
import { overflowing, settingsWith } from '../glasses/helpers';
import { pageCuts } from './cuts';

const DIR = process.env.QUAI_SCAN_DATA;
const OPS: Op[] = ['sncb', 'stib', 'delijn', 'tec'];
const MIN = 60_000;

/**
 * Ligne du contrôle : tous les trains SNCB ensemble, ses bus à part ; ailleurs la famille du numéro : les chiffres, sans
 * les lettres devant ni les lettres ou la barre derrière, sans zéro de tête (« 70 », « X70 », « 70a » : une ligne) ; une
 * ligne sans chiffre, ou à plusieurs nombres, reste elle-même.
 */
const lineOf = (op: Op, mode: string, line: string): string => {
  if (op === 'sncb' && mode === 'train') return 'sncb train';
  const key = String(line).replace(/\s+/g, '').toLowerCase();
  const numbers = key.match(/\d+/g) ?? [];
  const around = key.split(/\d+/);
  const family = numbers.length === 1 && /^[a-z]*$/.test(around[0]) && /^[a-z/]*$/.test(around[1]);
  return `${op} ${family ? String(Number(numbers[0])) : key}`;
};
const HOUR = 60 * MIN;

/** 04:00 (heure belge) qui suit `t` : début de « demain ». */
function demain(t: number): number {
  const p = brusselsParts(t);
  return gtfsTime(p.h < 4 ? p.date : addDays(p.date, 1), 240);
}

/** Relais muet : l'horaire seul. */
const NO_RT = {
  trips: async () => ({ map: new Map(), error: false }),
  stib: async () => ({ map: new Map(), error: false }),
} as unknown as RealtimeClient;

/** Toutes les pages d'une vue (liste qui défile par page). */
function pagesOf(v: GlassesView): PageSpec[] {
  const out: PageSpec[] = [];
  for (let top = 0; top < Math.max(1, v.items.length); ) {
    const p = layoutPage(v, { sel: top, top });
    out.push(p);
    top += Math.max(1, p.visible);
  }
  return out;
}

const pct = (n: number, d: number): string => `${String(d ? Math.round((1000 * n) / d) / 10 : 0).replace('.', ',')} %`;

describe.skipIf(!DIR)('1.3.1 R3 : balayage de « , dernier » d’après l’horaire (QUAI_SCAN_DATA)', () => {
  it('jamais « dernier » quand un départ de la même ligne et du même sens suit avant demain ; tableaux et trains', { timeout: 3_600_000 }, async () => {
    const dir = DIR!;
    const t0 = Date.now();
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Meta;
    const dates = meta.serviceDates;
    const from = gtfsTime(dates[0], 240);
    // jours publiés consécutifs : jusqu'au début du jour qui suit le dernier
    const lastDay = dates[1] === addDays(dates[0], 1) ? dates[1] : dates[0];
    const to = serviceDayBase(addDays(lastDay, 1));
    const errors: string[] = [];
    const err = (msg: string): void => {
      if (errors.length < 40) errors.push(msg);
    };
    const settings = settingsWith([], { seenVersion: '1.3.1' });
    const stats = new Map<Op, { areas: number; deps: number; window: number; marked: number; evening: number; boards: number; boardsMarked: number; rows: number; views: number; cutWord: number; ms: number; worst: number; worstName: string; biggest: number; biggestMs: number; boardMs: number; boardName: string }>();
    const examples = new Map<Op, string[]>();
    const preps = new Map<string, PreparedArea>();
    const at = [gtfsTime(dates[0], 22 * 60 + 30), gtfsTime(dates[0], 24 * 60 + 30), gtfsTime(dates[0], 27 * 60 + 30)];
    let followed = 0;
    const trip = new Map<Op, { legs: number; marked: number; notBoard: number; boardOnly: number; ms: number }>();

    for (const op of OPS) {
      const s = { areas: 0, deps: 0, window: 0, marked: 0, evening: 0, boards: 0, boardsMarked: 0, rows: 0, views: 0, cutWord: 0, ms: 0, worst: 0, worstName: '', biggest: 0, biggestMs: 0, boardMs: 0, boardName: '' };
      stats.set(op, s);
      const ex: string[] = [];
      examples.set(op, ex);
      const files = (await readdir(join(dir, 'areas', op))).filter((f) => f.endsWith('.json')).sort();
      for (const name of files) {
        let f: AreaFile;
        try {
          f = JSON.parse(await readFile(join(dir, 'areas', op, name), 'utf8')) as AreaFile;
        } catch (e) {
          err(`${op}/${name} : illisible (${(e as Error).message})`);
          continue;
        }
        s.areas++;
        try {
          const prep = prepareArea(f, meta);
          if (op === 'sncb') preps.set(f.id, prep);
          // coût du calcul des marques d'une zone (une fois par zone et par publication, puis gardé)
          const c0 = performance.now();
          const flags = scheduleLastFlags(prep);
          const cost = performance.now() - c0;
          s.ms += cost;
          if (cost > s.worst) [s.worst, s.worstName] = [cost, `${f.n.fr}, ${f.deps.length} départs`];
          if (f.deps.length > s.biggest) [s.biggest, s.biggestMs] = [f.deps.length, cost];
          // départs bruts, relus sans les tableaux préparés : instant, ligne, destination, zones suivantes
          const raw = f.deps.map((d) => {
            const p = f.patterns[d[2]];
            return { t: gtfsTime(dates[d[0]], d[1]), line: lineOf(op, p.mode, p.line), head: headKey(p.head?.fr ?? ''), next: new Set(p.next.map(([z]) => z)), pl: p.line, day: d[0], min: d[1] };
          });
          const byLine = new Map<string, number[]>();
          raw.forEach((r, i) => {
            if (!byLine.has(r.line)) byLine.set(r.line, []);
            byLine.get(r.line)!.push(i);
          });
          s.deps += raw.length;
          raw.forEach((r, i) => {
            const end = demain(r.t);
            if (r.t >= from && end <= to) s.window++;
            if (!flags[i]) return;
            s.marked++;
            const h = brusselsParts(r.t).h;
            if (h >= 20 || h < 4) s.evening++;
            if (r.t < from || end > to) err(`${f.n.fr} (${f.id}) : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} à ${hhmm(r.t)} marqué hors des jours publiés`);
            // le précédent (depuis 04:00 du premier jour) et le suivant de demain (04:00 ou après), même ligne, même sens
            let before = -Infinity;
            let after = Infinity;
            let followed = false;
            for (const k of byLine.get(r.line) ?? []) {
              if (k === i) continue;
              const o = raw[k];
              const sameWay = o.head === r.head || [...o.next].some((z) => r.next.has(z));
              if (!sameWay) continue;
              if (o.t === r.t && o.head === r.head && o.pl === r.pl) continue; // le même départ (doublon)
              if (o.t < r.t) {
                if (o.t >= from) before = Math.max(before, o.t);
                continue;
              }
              if (o.t >= end) {
                after = Math.min(after, o.t);
                continue;
              }
              if (!followed) err(`${f.n.fr} (${f.id}) : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} à ${hhmm(r.t)} (jour ${r.day}) marqué, suivi de ${o.pl} vers ${f.patterns[f.deps[k][2]].head.fr} à ${hhmm(o.t)}`);
              followed = true;
            }
            // 04:00 n'est pas une coupure pour une ligne qui roule : pas de marque quand le suivant part moins de 2 h
            // après, ni, avant 04:00, quand il est aussi proche que le précédent (premier départ du matin)
            if (Number.isFinite(after)) {
              const what = `${f.n.fr} (${f.id}) : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} à ${hhmm(r.t)} marqué`;
              if (after - r.t < 2 * HOUR) err(`${what}, le suivant du même sens à ${hhmm(after)} (moins de 2 h après)`);
              else if (r.min < 24 * 60 && end - r.t <= 4 * HOUR && after - r.t <= r.t - before) err(`${what} : premier départ du matin (suivant à ${hhmm(after)}, précédent ${Number.isFinite(before) ? `à ${hhmm(before)}` : 'aucun'})`);
            }
            if (ex.length < 6 && f.deps[i][0] === 0 && (ex.length < 3 || r.t >= gtfsTime(dates[0], 22 * 60))) ex.push(`${f.n.fr} : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} ${hhmm(r.t)}`);
          });
          // écran du trajet (bus, tram, métro) : chaque départ vers chaque zone où son véhicule s'arrête ensuite
          if (op !== 'sncb') {
            const tr = trip.get(op) ?? { legs: 0, marked: 0, notBoard: 0, boardOnly: 0, ms: 0 };
            trip.set(op, tr);
            const ways = lastWays(prep);
            const byZone = new Map<string, number[]>();
            raw.forEach((r, i) => {
              for (const z of r.next) {
                const list = byZone.get(z);
                if (list) list.push(i);
                else byZone.set(z, [i]);
              }
            });
            const keys = new Map<string, { zone: string; way: number }>();
            f.patterns.forEach((p, pi) => p.next.forEach(([z]) => keys.set(`${ways[pi]}|${z}`, { zone: z, way: ways[pi] })));
            for (const { zone, way } of keys.values()) {
              const d0 = performance.now();
              const fl = destinationLastFlags(prep, zone, way);
              tr.ms += performance.now() - d0;
              const serving = byZone.get(zone) ?? [];
              for (const i of serving) {
                if (ways[f.deps[i][2]] !== way) continue;
                const r = raw[i];
                const end = demain(r.t);
                if (r.t >= from && end <= to) tr.legs++;
                if (!fl[i]) {
                  if (flags[i]) tr.boardOnly++;
                  continue;
                }
                tr.marked++;
                if (!flags[i]) tr.notBoard++;
                const what = `étape ${f.n.fr} (${f.id}) vers ${zone} : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} à ${hhmm(r.t)} marquée`;
                if (r.t < from || end > to) err(`${what} hors des jours publiés`);
                let before = -Infinity;
                let after = Infinity;
                let taken = -1;
                for (const k of serving) {
                  const o = raw[k];
                  if (k === i || (o.t === r.t && o.head === r.head && o.pl === r.pl)) continue;
                  if (o.t < r.t) {
                    if (o.t >= from) before = Math.max(before, o.t);
                  } else if (o.t >= end) after = Math.min(after, o.t);
                  else taken = k;
                }
                if (taken >= 0) err(`${what}, mais ${raw[taken].pl} vers ${f.patterns[f.deps[taken][2]].head.fr} à ${hhmm(raw[taken].t)} y va encore`);
                if (Number.isFinite(after) && (after - r.t < 2 * HOUR || (r.min < 24 * 60 && end - r.t <= 4 * HOUR && after - r.t <= r.t - before))) err(`${what}, le suivant à ${hhmm(after)} (ligne qui roule ou premier du matin)`);
              }
            }
          }
          // tableaux, horaire seul : 22:30 le premier jour et 00:30 dans la nuit
          if (flags.some((x) => x === 1)) {
            for (const now of at) {
              const b0 = performance.now();
              const [b] = await buildBoards([{ prep, limit: 40 }], NO_RT, now);
              const bms = performance.now() - b0;
              if (b.departures.length >= 40 && bms > s.boardMs) [s.boardMs, s.boardName] = [bms, f.n.fr];
              s.boards++;
              const deps = b.departures;
              const marks = deps.filter((d) => d.last);
              if (!marks.length) continue;
              s.boardsMarked++;
              for (const d of marks) {
                const line = lineOf(op, d.mode, d.line);
                const pat = f.patterns.findIndex((p) => p.line === d.line && headKey(p.head.fr) === headKey(d.head.fr));
                const next = new Set((f.patterns[pat]?.next ?? []).map(([z]) => z));
                const end = demain(d.sched);
                const after = deps.find((e) => {
                  if (e === d || e.cancelled || lineOf(op, e.mode, e.line) !== line || e.est < d.est || e.est >= end) return false;
                  if (e.sched === d.sched && e.line === d.line && headKey(e.head.fr) === headKey(d.head.fr)) return false;
                  const ep = f.patterns.find((p) => p.line === e.line && headKey(p.head.fr) === headKey(e.head.fr));
                  return headKey(e.head.fr) === headKey(d.head.fr) || (ep?.next ?? []).some(([z]) => next.has(z));
                });
                if (after) err(`${f.n.fr} (${f.id}) à ${hhmm(now)} : ${d.line} vers ${d.head.fr} ${hhmm(d.est)} marqué, puis ${after.line} vers ${after.head.fr} ${hhmm(after.est)} dans le tableau`);
              }
              // dans les lunettes, tous les tableaux marqués : la marque se lit en entier, tout tient au pixel, et la
              // destination devant « , dernier » n'est jamais coupée au milieu d'un mot
              const v = boardView(b, { now, settings } as ViewCtx, { kept: false });
              s.views++;
              for (const p of pagesOf(v)) {
                const bad = overflowing(p);
                if (bad.length) err(`${f.n.fr} (${f.id}) à ${hhmm(now)} : ${bad[0]}`);
                const shown = p.lines.filter((l) => l.includes(', dernier'));
                s.rows += shown.length;
                for (const c of pageCuts(v, p)) {
                  if (!c.line.includes(', dernier')) continue;
                  if (c.kind === 'word') s.cutWord++;
                  else err(`${f.n.fr} (${f.id}) à ${hhmm(now)} : rangée marquée coupée (${c.kind}) : « ${c.line} »`);
                }
              }
              const total = v.items.filter((it) => it.bTail === ', dernier').length;
              const seen = pagesOf(v).reduce((n, p) => n + p.lines.filter((l) => l.includes(', dernier')).length, 0);
              if (seen !== total) err(`${f.n.fr} (${f.id}) à ${hhmm(now)} : ${total} marque(s), ${seen} lue(s) en entier dans les lunettes`);
            }
          }
        } catch (e) {
          err(`${op}/${name} : ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`);
        }
      }
    }

    // trains, comme l'écran du trajet : chaque voyage du premier jour à chacune de ses gares de montée
    const days = (
      await Promise.all(
        dates.slice(0, 2).map(async (d) => {
          try {
            return indexDay(JSON.parse(await readFile(join(dir, `trains/${d}.json`), 'utf8')) as TrainsDay);
          } catch {
            return null;
          }
        }),
      )
    ).filter((d): d is NonNullable<typeof d> => d !== null);
    // contrôle indépendant sur les trains eux-mêmes : départs d'une gare (deux jours), ligne (trains ensemble, bus SNCB à
    // part), destination, gares suivantes où l'on peut descendre
    const byStation = new Map<string, { t: number; m: number; line: string; cat: string; head: string; next: Set<string> }[]>();
    const trainDeps = (station: string) => {
      let list = byStation.get(station);
      if (list) return list;
      list = [];
      for (const d of days)
        for (const tr of d.file.trips)
          tr.s.forEach((x, p) => {
            if (d.file.stations[x[0]]?.id !== station || x[2] < 0) return;
            const next = new Set(tr.s.slice(p + 1).filter((y) => y[1] >= 0).map((y) => d.file.stations[y[0]]?.id ?? '').filter((id) => id && id !== station));
            if (!next.size) return;
            list!.push({ t: d.base + x[2] * MIN, m: x[2], line: /^bus$/i.test(tr.cat) ? 'bus' : 'train', cat: tr.cat, head: headKey(tr.head.fr), next });
          });
      byStation.set(station, list);
      return list;
    };
    let trainsChecked = 0;
    let legs = 0;
    let legMarked = 0;
    let agree = 0;
    let onlyTrains = 0;
    let onlyArea = 0;
    let noArea = 0;
    const diffEx: string[] = [];
    const d0 = days.find((d) => d.file.date === dates[0]);
    for (const trip of d0?.file.trips ?? []) {
      trip.s.forEach((x, p) => {
        if (x[2] < 0 || p >= trip.s.length - 1) return;
        const station = d0!.file.stations[x[0]];
        if (!station) return;
        const schedDep = d0!.base + x[2] * MIN;
        const mine = trainLegLast(days, { op: 'sncb', from: { name: station.n, lat: station.lat, lon: station.lon, areaId: station.id }, tripId: trip.id, schedDep });
        legs++;
        if (mine) {
          legMarked++;
          trainsChecked++;
          const line = /^bus$/i.test(trip.cat) ? 'bus' : 'train';
          const head = headKey(trip.head.fr);
          const next = new Set(trip.s.slice(p + 1).filter((y) => y[1] >= 0).map((y) => d0!.file.stations[y[0]]?.id ?? '').filter((id) => id && id !== station.id));
          const end = demain(schedDep);
          const other = trainDeps(station.id).find((o) => {
            if (o.line !== line || o.t < schedDep || o.t >= end) return false;
            if (o.t === schedDep && o.cat === trip.cat && o.head === head) return false; // le même départ (doublon compris)
            return o.head === head || [...o.next].some((z) => next.has(z));
          });
          if (schedDep < from || end > to) err(`train ${trip.cat} vers ${trip.head.fr} à ${station.n.fr} ${hhmm(schedDep)} : marqué hors des jours publiés`);
          if (other) err(`train ${trip.cat} vers ${trip.head.fr} à ${station.n.fr} ${hhmm(schedDep)} : marqué, suivi d'un ${other.cat} à ${hhmm(other.t)} (trains)`);
          // comme pour les zones : le suivant de demain à moins de 2 h, ou le premier train du matin avant 04:00
          let before = -Infinity;
          let after = Infinity;
          for (const o of trainDeps(station.id)) {
            if (o.line !== line || !(o.head === head || [...o.next].some((z) => next.has(z)))) continue;
            if (o.t < schedDep && o.t >= from) before = Math.max(before, o.t);
            if (o.t >= end) after = Math.min(after, o.t);
          }
          if (Number.isFinite(after) && (after - schedDep < 2 * HOUR || (x[2] < 24 * 60 && end - schedDep <= 4 * HOUR && after - schedDep <= schedDep - before)))
            err(`train ${trip.cat} vers ${trip.head.fr} à ${station.n.fr} ${hhmm(schedDep)} : marqué, le suivant à ${hhmm(after)} (ligne qui roule ou premier du matin)`);
        }
        const prep = preps.get(station.id);
        const di = prep ? prep.file.deps.findIndex((d, i) => d[4] === trip.id && Math.abs(prep.times[i] - schedDep) <= 30_000) : -1;
        if (!prep || di < 0) {
          noArea++;
          return;
        }
        const area = scheduleLast(prep, di);
        if (area === mine) agree++;
        else if (mine) {
          onlyTrains++;
          if (diffEx.length < 6) diffEx.push(`${station.n.fr} : ${trip.cat} vers ${trip.head.fr} ${hhmm(schedDep)} (trains : dernier ; zone : non)`);
        } else {
          onlyArea++;
          if (diffEx.length < 6) diffEx.push(`${station.n.fr} : ${trip.cat} vers ${trip.head.fr} ${hhmm(schedDep)} (zone : dernier ; trains : non)`);
        }
        // l'étape marquée : le contrôle indépendant sur les départs bruts de la zone de la gare
        if (mine) {
          const f = prep.file;
          const me = f.patterns[f.deps[di][2]];
          const next = new Set(me.next.map(([z]) => z));
          const end = demain(schedDep);
          const follower = f.deps.find((d, i) => {
            const p = f.patterns[d[2]];
            const t = prep.times[i];
            if (i === di || t < schedDep || t >= end || lineOf('sncb', p.mode, p.line) !== lineOf('sncb', me.mode, me.line)) return false;
            if (t === schedDep && p.line === me.line && headKey(p.head.fr) === headKey(me.head.fr)) return false;
            return headKey(p.head.fr) === headKey(me.head.fr) || p.next.some(([z]) => next.has(z));
          });
          if (follower) err(`train ${trip.cat} vers ${trip.head.fr} à ${station.n.fr} ${hhmm(schedDep)} : marqué, suivi de ${f.patterns[follower[2]].line} vers ${f.patterns[follower[2]].head.fr}`);
          followed++;
        }
      });
    }

    // écran du trajet en train : chaque train du premier jour, de chaque gare de montée vers chaque gare de descente,
    // par couple de gares (le calcul d'un couple est gardé)
    const pairs = new Map<string, { station: string; dest: string; legs: { id: string; cat: string; head: string; t: number; m: number; plain: boolean }[] }>();
    for (const tr of d0?.file.trips ?? []) {
      tr.s.forEach((x, p) => {
        const station = d0!.file.stations[x[0]]?.id;
        if (x[2] < 0 || !station) return;
        const schedDep = d0!.base + x[2] * MIN;
        const plain = trainLegLast(days, { op: 'sncb', from: { name: { fr: '', nl: '' }, lat: 0, lon: 0, areaId: station }, tripId: tr.id, schedDep });
        const seen = new Set<string>();
        for (const y of tr.s.slice(p + 1)) {
          const dest = d0!.file.stations[y[0]]?.id;
          if (y[1] < 0 || !dest || dest === station || seen.has(dest)) continue;
          seen.add(dest);
          const key = `${station}>${dest}`;
          let g = pairs.get(key);
          if (!g) pairs.set(key, (g = { station, dest, legs: [] }));
          g.legs.push({ id: tr.id, cat: tr.cat, head: headKey(tr.head.fr), t: schedDep, m: x[2], plain });
        }
      });
    }
    const tt = { legs: 0, marked: 0, notBoard: 0, boardOnly: 0, ms: 0 };
    const nameOf = new Map((d0?.file.stations ?? []).map((st) => [st.id, st.n.fr] as const));
    for (const g of pairs.values()) {
      const serving = trainDeps(g.station).filter((o) => o.next.has(g.dest));
      for (const leg of g.legs) {
        const end = demain(leg.t);
        const m0 = performance.now();
        const mine = trainLegLast(days, { op: 'sncb', from: { name: { fr: '', nl: '' }, lat: 0, lon: 0, areaId: g.station }, to: { name: { fr: '', nl: '' }, lat: 0, lon: 0, areaId: g.dest }, tripId: leg.id, schedDep: leg.t });
        tt.ms += performance.now() - m0;
        tt.legs++;
        if (!mine) {
          if (leg.plain) tt.boardOnly++;
          continue;
        }
        tt.marked++;
        if (!leg.plain) tt.notBoard++;
        const what = `étape en train ${nameOf.get(g.station)} vers ${nameOf.get(g.dest)} : ${leg.cat} de ${hhmm(leg.t)} marquée`;
        if (leg.t < from || end > to) err(`${what} hors des jours publiés`);
        let before = -Infinity;
        let after = Infinity;
        let taken: (typeof serving)[number] | undefined;
        for (const o of serving) {
          if (o.t === leg.t && o.cat === leg.cat && o.head === leg.head) continue;
          if (o.t < leg.t) {
            if (o.t >= from) before = Math.max(before, o.t);
          } else if (o.t >= end) after = Math.min(after, o.t);
          else taken = o;
        }
        if (taken) err(`${what}, mais un ${taken.cat} de ${hhmm(taken.t)} y va encore`);
        if (Number.isFinite(after) && (after - leg.t < 2 * HOUR || (leg.m < 24 * 60 && end - leg.t <= 4 * HOUR && after - leg.t <= leg.t - before))) err(`${what}, le suivant à ${hhmm(after)} (ligne qui roule ou premier du matin)`);
      }
    }

    const lines: string[] = [];
    lines.push(`Balayage de « , dernier » (${dates.join(', ')}, horaire seul) en ${Math.round((Date.now() - t0) / 1000)} s.`);
    for (const op of OPS) {
      const s = stats.get(op)!;
      lines.push(
        `${op} : ${s.areas} zones, ${s.deps} départs, ${s.window} dans la fenêtre des jours publiés, ${s.marked} marqués « dernier » (${pct(s.marked, s.window)}), dont ${s.evening} le soir et la nuit (20:00 à 04:00) ; tableaux à 22:30, 00:30 et 03:30 : ${s.boards} calculés, ${s.boardsMarked} avec une marque, ${s.views} vus dans les lunettes (${s.rows} rangées marquées, ${s.cutWord} avec la destination coupée au mot, 0 au milieu d'un mot) ; calcul des marques : ${Math.round(s.ms)} ms pour toutes les zones, au pire ${s.worst.toFixed(1)} ms (${s.worstName}), la zone la plus chargée (${s.biggest} départs) ${s.biggestMs.toFixed(1)} ms ; tableau de 40 départs le plus lent : ${s.boardMs.toFixed(1)} ms (${s.boardName}). Ex. : ${(examples.get(op) ?? []).join(' | ')}`,
      );
    }
    lines.push(
      `Trains (écran du trajet), ${dates[0]} : ${legs} montées, ${legMarked} marquées « dernier » (${pct(legMarked, legs)}), ${trainsChecked} contrôlées sur les trains eux-mêmes, ${followed} sur la zone de la gare ; accord avec la zone : ${agree} sur ${legs - noArea} (${pct(agree, legs - noArea)}), dernier selon les trains seulement : ${onlyTrains}, selon la zone seulement : ${onlyArea}, gare sans zone ou sans ce départ : ${noArea}.${diffEx.length ? ` Ex. : ${diffEx.join(' | ')}` : ''}`,
    );
    lines.push('Écran du trajet, d’après l’arrêt de descente (décision du 20/11 à 21:58) : étapes possibles (un départ, une descente), marquées « dernier », dont non marquées au tableau (un départ du même sens suit, mais ne s’arrête pas à la descente), et étapes non marquées alors que le tableau marque leur départ (une autre ligne va encore à la descente) :');
    for (const op of OPS) {
      const x = op === 'sncb' ? tt : trip.get(op);
      if (x) lines.push(`${op} : ${x.legs} étapes, ${x.marked} marquées (${pct(x.marked, x.legs)}), dont ${x.notBoard} non marquées au tableau ; ${x.boardOnly} non marquées alors que le tableau marque ; calcul ${Math.round(x.ms)} ms.`);
    }
    lines.push(errors.length ? `Erreurs : ${errors.length}. ${errors.slice(0, 20).join(' | ')}` : 'Aucune erreur.');
    process.stdout.write(`${lines.join('\n')}\n`);
    expect(errors).toEqual([]);
  });
});
