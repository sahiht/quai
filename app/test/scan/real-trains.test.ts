/**
 * 1.2.8 (PRD-1.2.8 § 5) : balayage de tous les trains d'une publication de nuit, par le calcul des lunettes. Pour chaque
 * voyage du premier jour publié : tout son trajet (trainStopCalls) vu de sa première gare, d'une gare du milieu et de
 * sa dernière gare de montée, 5 minutes avant le départ de cette gare, sans temps réel ; ses rangées dans les lunettes,
 * page par page. Puis, avec un temps réel simulé (3 min de retard partout), le train entre deux gares : un seul ●, sur
 * la gare où il arrive, les gares d'avant quittées.
 *
 * Erreurs (le test échoue) : la gare de montée absente ou mal placée, des heures qui reculent, une rangée qui dépasse,
 * une rangée qui ne dit pas la gare, le curseur hors de l'écran, un ● faux ou absent avec le temps réel, une exception.
 * Mesuré et écrit dans le journal : voyages, gares par voyage, gares d'avant, voies connues, rangées coupées (« … »),
 * noms les plus longs.
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data), par le workflow « Données
 * de nuit » ; sans lui, ignoré.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Meta, TrainsDay } from '../../../shared/types';
import type { DepartureStops, StopCall } from '../../src/core/api';
import { trainProgress, trainStopCalls } from '../../src/core/stopcalls';
import { indexDay } from '../../src/core/trains';
import { textWidth } from '../../src/glasses/font';
import { effectiveFrame, initNav } from '../../src/glasses/nav';
import { geometry, layoutPage } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { trainRunView, type ViewCtx } from '../../src/glasses/views';
import { overflowing, settingsWith } from '../glasses/helpers';

const DIR = process.env.QUAI_SCAN_DATA;
const MIN = 60_000;

/** Toutes les pages d'une vue (liste qui défile par page) : chaque rangée contrôlée une fois au moins. */
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
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe.skipIf(!DIR)('1.2.8 : balayage des trains (QUAI_SCAN_DATA)', () => {
  it('chaque voyage : tout son trajet vu de trois gares, ses rangées dans les lunettes, le ● d’après un temps réel simulé', async () => {
    const dir = DIR!;
    const t0 = Date.now();
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Meta;
    const date = meta.serviceDates[0];
    const file = JSON.parse(await readFile(join(dir, `trains/${date}.json`), 'utf8')) as TrainsDay;
    const day = indexDay(file);
    const settings = settingsWith([], { seenVersion: '1.2.9' });

    const errors: string[] = [];
    const lengths: number[] = [];
    let views = 0;
    let rows = 0;
    let cut = 0;
    let withBefore = 0;
    let calls = 0;
    let platforms = 0;
    let live = 0;
    const cutEx: string[] = [];
    const longest: { name: string; w: number }[] = [];
    const err = (msg: string): void => {
      if (errors.length < 40) errors.push(msg);
    };

    file.trips.forEach((trip, ti) => {
      const s = trip.s;
      const label = `${trip.cat}${trip.num ? ` ${trip.num}` : ''} vers ${trip.head.fr} (${trip.id})`;
      const boarding = s.map((x, i) => (x[2] >= 0 ? i : -1)).filter((i) => i >= 0 && i < s.length - 1);
      if (!boarding.length) return;
      const picks = [...new Set([boarding[0], boarding[Math.floor(boarding.length / 2)], boarding[boarding.length - 1]])];
      for (const i of picks) {
        try {
          const { stops, at } = trainStopCalls(file, day, ti, i);
          const here = file.stations[s[i][0]];
          if (stops[at]?.areaId !== here?.id) err(`${label} : la gare de montée ${here?.n.fr} n'est pas au rang ${at}`);
          for (let k = 1; k < stops.length; k++) if (stops[k].sched < stops[k - 1].sched) err(`${label} : heure qui recule à ${stops[k].name.fr}`);
          if (i === picks[0]) {
            lengths.push(stops.length);
            calls += stops.length;
            platforms += stops.filter((c) => c.platform).length;
          }
          if (at > 0) withBefore++;
          const ds: DepartureStops = { op: 'sncb', mode: 'train', line: trip.cat, head: trip.head, stops, anyPlanned: true, state: 'ok', at };
          const now = stops[at].sched - 5 * MIN;
          const ctx: ViewCtx = { now, settings };
          const v = trainRunView(ds, ctx);
          views++;
          // à l'ouverture, le curseur sur la gare de montée, à l'écran
          const g = geometry(v);
          const f = effectiveFrame(initNav({ screen: 'home' }).stack[0], v, g.capacity);
          if (f.sel !== at || f.top > at || at >= f.top + g.capacity) err(`${label} : curseur ${f.sel} (haut ${f.top}) au lieu de ${at}`);
          for (const p of pagesOf(v)) {
            const bad = overflowing(p);
            if (bad.length) err(`${label} : ${bad[0]}`);
            const list = p.lines.filter((l) => /^[○●] /.test(l));
            rows += list.length;
            for (const l of list) {
              if (l.includes('…')) {
                cut++;
                if (cutEx.length < 8) cutEx.push(l.replace(/ /g, ' '));
              }
            }
          }
          for (const c of stops) {
            const w = textWidth(c.name.fr);
            if (longest.length < 5 || w > longest[longest.length - 1].w) {
              if (!longest.some((x) => x.name === c.name.fr)) longest.push({ name: c.name.fr, w });
              longest.sort((a, b) => b.w - a.w);
              longest.length = Math.min(longest.length, 5);
            }
          }
        } catch (e) {
          err(`${label} depuis le rang ${i} : ${(e as Error).message}`);
        }
      }
      // temps réel simulé (3 min de retard partout) : entre deux gares desservies, un seul ●, sur celle où il arrive ;
      // vu d'une gare 3 gares plus loin (le train arrive vers toi) : le ● sur la page du curseur
      const last = boarding[boarding.length - 1];
      const { stops, at: lastAt } = trainStopCalls(file, day, ti, last);
      if (stops.length >= 3) {
        const late: StopCall[] = stops.map((c) => ({ ...c, rt: true, est: c.est + 3 * MIN, leave: (c.leave ?? c.est) + 3 * MIN, delayMin: 3 }));
        const k = Math.max(1, lastAt - 3);
        const now = Math.floor(((late[k - 1].leave ?? late[k - 1].est) + (late[k].leave ?? late[k].est)) / 2);
        if ((late[k - 1].leave ?? 0) < now && now < (late[k].leave ?? 0)) {
          live++;
          const p = trainProgress(late, now);
          if (p.vehicle !== k) err(`${label} : ● au rang ${p.vehicle} au lieu de ${k}`);
          if (p.passed.filter(Boolean).length !== k) err(`${label} : ${p.passed.filter(Boolean).length} gares quittées au lieu de ${k}`);
          const v = trainRunView({ op: 'sncb', mode: 'train', line: trip.cat, head: trip.head, stops: late, anyPlanned: false, state: 'ok', at: lastAt }, { now, settings });
          const page = layoutPage(v, effectiveFrame(initNav({ screen: 'home' }).stack[0], v, geometry(v).capacity));
          if (!page.lines.some((l) => l.startsWith('● ') && !l.includes(': le train'))) err(`${label} : le ● n'est pas sur la page du curseur`);
          if (page.sel !== lastAt) err(`${label} : curseur ${page.sel} au lieu de ${lastAt}`);
        }
      }
    });

    const lines = [
      `Balayage des trains (${date}, sans temps réel, 5 min avant le départ) : ${file.trips.length} voyages, ${views} trajets vus de leur première gare, d'une gare du milieu et de la dernière, ${Math.round((Date.now() - t0) / 1000)} s.`,
      `Gares par voyage : de ${Math.min(...lengths)} à ${Math.max(...lengths)} (médiane ${median(lengths)}) ; trajets avec des gares d'avant : ${withBefore} sur ${views} ; voies connues : ${pct(platforms, calls)} des arrêts.`,
      `Rangées coupées (« … ») : ${cut}/${rows} (${pct(cut, rows)}).${cutEx.length ? ` Ex. : ${cutEx.join(' | ')}` : ''}`,
      `Noms les plus longs : ${longest.map((x) => `${x.name} (${x.w} px)`).join(', ')}.`,
      `Temps réel simulé (+3 min, le train entre deux gares, vu de 3 gares plus loin) : ${live} voyages, un seul ●, sur la gare où il arrive, à l'écran avec le curseur.`,
      errors.length ? `Erreurs :\n  ${errors.join('\n  ')}` : 'Aucune erreur.',
    ];
    process.stdout.write(`\n${lines.join('\n')}\n`);
    if (errors.length) process.stdout.write(`::warning title=Balayage des trains::${errors.length} erreur(s) : ${errors.slice(0, 5).join(' | ')}\n`);
    expect(errors).toEqual([]);
  }, 600_000);
});
