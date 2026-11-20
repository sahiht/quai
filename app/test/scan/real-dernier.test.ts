/**
 * 1.3.1 (PRD-1.3.1 § 14, R3) : balayage de toutes les zones d'une publication de nuit (SNCB, STIB, De Lijn, TEC) pour
 * « , dernier » d'après l'horaire. Pour chaque départ marqué (scheduleLast), un contrôle indépendant relit les départs
 * bruts de la zone : aucun départ de la même ligne (tous les trains SNCB ensemble) dans le même sens (même destination,
 * ou une zone suivante commune) entre lui et 04:00 qui suit, même minute comprise (même ligne et même destination à la
 * même minute : le même départ), quel que soit son jour de service ; toute cette fenêtre dans les jours publiés. Puis
 * les tableaux (buildBoards, horaire seul) à 22:30 le premier jour et à 00:30 dans la nuit : un départ marqué n'a aucun
 * départ du même sens après lui avant demain dans son tableau ; dans les lunettes, la marque se lit en entier et tout
 * tient au pixel. Enfin les trains (trains/{date}.json), comme l'écran du trajet : chaque voyage à chacune de ses gares
 * de montée du premier jour, la marque des trains (trainLegLast) comparée au contrôle indépendant sur le fichier de la
 * zone de la gare.
 *
 * Erreurs (le test échoue) : une marque quand un départ de la même ligne et du même sens suit, une marque hors des jours
 * publiés, une marque contredite dans un tableau, une marque coupée ou une rangée qui dépasse, une exception. Mesuré et
 * écrit dans le journal : départs, départs marqués par réseau, tableaux, exemples, accord des trains avec les zones.
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data) ; sans lui, ignoré.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile, Meta, Op, TrainsDay } from '../../../shared/types';
import { prepareArea, type PreparedArea } from '../../src/core/areas';
import { buildBoards, scheduleLast, scheduleLastFlags, trainLegLast } from '../../src/core/boards';
import type { RealtimeClient } from '../../src/core/realtime';
import { headKey } from '../../src/core/rtmerge';
import { addDays } from '../../src/core/freshness';
import { indexDay } from '../../src/core/trains';
import { brusselsParts, gtfsTime, hhmm, serviceDayBase } from '../../src/core/util';
import { layoutPage } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { boardView, type ViewCtx } from '../../src/glasses/views';
import { overflowing, settingsWith } from '../glasses/helpers';

const DIR = process.env.QUAI_SCAN_DATA;
const OPS: Op[] = ['sncb', 'stib', 'delijn', 'tec'];
const MIN = 60_000;

/** Ligne du contrôle : tous les trains SNCB ensemble, ses bus à part ; ailleurs le numéro sans casse ni zéro de tête. */
const lineOf = (op: Op, mode: string, line: string): string =>
  op === 'sncb' && mode === 'train' ? 'sncb train' : `${op} ${String(line).replace(/\s+/g, '').toLowerCase().replace(/^0+(?=.)/, '')}`;

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
  it('jamais « dernier » quand un départ de la même ligne et du même sens suit avant demain ; tableaux et trains', { timeout: 1_800_000 }, async () => {
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
    const stats = new Map<Op, { areas: number; deps: number; window: number; marked: number; evening: number; boards: number; boardsMarked: number; rows: number; views: number }>();
    const examples = new Map<Op, string[]>();
    const preps = new Map<string, PreparedArea>();
    const at = [gtfsTime(dates[0], 22 * 60 + 30), gtfsTime(dates[0], 24 * 60 + 30)];
    let followed = 0;

    for (const op of OPS) {
      const s = { areas: 0, deps: 0, window: 0, marked: 0, evening: 0, boards: 0, boardsMarked: 0, rows: 0, views: 0 };
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
          const flags = scheduleLastFlags(prep);
          // départs bruts, relus sans les tableaux préparés : instant, ligne, destination, zones suivantes
          const raw = f.deps.map((d) => {
            const p = f.patterns[d[2]];
            return { t: gtfsTime(dates[d[0]], d[1]), line: lineOf(op, p.mode, p.line), head: headKey(p.head?.fr ?? ''), next: new Set(p.next.map(([z]) => z)), pl: p.line, day: d[0] };
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
            for (const k of byLine.get(r.line) ?? []) {
              if (k === i) continue;
              const o = raw[k];
              if (o.t < r.t || o.t >= end) continue;
              const sameWay = o.head === r.head || [...o.next].some((z) => r.next.has(z));
              if (!sameWay) continue;
              if (o.t === r.t && o.head === r.head && o.pl === r.pl) continue; // le même départ (doublon)
              err(`${f.n.fr} (${f.id}) : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} à ${hhmm(r.t)} (jour ${r.day}) marqué, suivi de ${o.pl} vers ${f.patterns[f.deps[k][2]].head.fr} à ${hhmm(o.t)}`);
              break;
            }
            if (ex.length < 6 && f.deps[i][0] === 0 && (ex.length < 3 || r.t >= gtfsTime(dates[0], 22 * 60))) ex.push(`${f.n.fr} : ${r.pl} vers ${f.patterns[f.deps[i][2]].head.fr} ${hhmm(r.t)}`);
          });
          // tableaux, horaire seul : 22:30 le premier jour et 00:30 dans la nuit
          if (flags.some((x) => x === 1)) {
            for (const now of at) {
              const [b] = await buildBoards([{ prep, limit: 40 }], NO_RT, now);
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
              // dans les lunettes : la marque se lit en entier, tout tient au pixel (un tableau sur dix, et tous ceux des gares)
              if (op !== 'sncb' && s.boardsMarked % 10 !== 1) continue;
              const v = boardView(b, { now, settings } as ViewCtx, { kept: false });
              s.views++;
              for (const p of pagesOf(v)) {
                const bad = overflowing(p);
                if (bad.length) err(`${f.n.fr} (${f.id}) à ${hhmm(now)} : ${bad[0]}`);
                const shown = p.lines.filter((l) => l.includes(', dernier'));
                s.rows += shown.length;
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
    const byStation = new Map<string, { t: number; line: string; cat: string; head: string; next: Set<string> }[]>();
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
            list!.push({ t: d.base + x[2] * MIN, line: /^bus$/i.test(tr.cat) ? 'bus' : 'train', cat: tr.cat, head: headKey(tr.head.fr), next });
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

    const lines: string[] = [];
    lines.push(`Balayage de « , dernier » (${dates.join(', ')}, horaire seul) en ${Math.round((Date.now() - t0) / 1000)} s.`);
    for (const op of OPS) {
      const s = stats.get(op)!;
      lines.push(
        `${op} : ${s.areas} zones, ${s.deps} départs, ${s.window} dans la fenêtre des jours publiés, ${s.marked} marqués « dernier » (${pct(s.marked, s.window)}), dont ${s.evening} le soir et la nuit (20:00 à 04:00) ; tableaux à 22:30 et 00:30 : ${s.boards} calculés, ${s.boardsMarked} avec une marque, ${s.views} vus dans les lunettes (${s.rows} rangées marquées). Ex. : ${(examples.get(op) ?? []).join(' | ')}`,
      );
    }
    lines.push(
      `Trains (écran du trajet), ${dates[0]} : ${legs} montées, ${legMarked} marquées « dernier » (${pct(legMarked, legs)}), ${trainsChecked} contrôlées sur les trains eux-mêmes, ${followed} sur la zone de la gare ; accord avec la zone : ${agree} sur ${legs - noArea} (${pct(agree, legs - noArea)}), dernier selon les trains seulement : ${onlyTrains}, selon la zone seulement : ${onlyArea}, gare sans zone ou sans ce départ : ${noArea}.${diffEx.length ? ` Ex. : ${diffEx.join(' | ')}` : ''}`,
    );
    lines.push(errors.length ? `Erreurs : ${errors.length}. ${errors.slice(0, 20).join(' | ')}` : 'Aucune erreur.');
    process.stdout.write(`${lines.join('\n')}\n`);
    expect(errors).toEqual([]);
  });
});
