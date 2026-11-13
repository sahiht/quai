/**
 * 1.2.6 (PRD-1.2.6 § 9) : balayage de toutes les lignes de bus, tram et métro d'une publication de nuit, par le calcul
 * des lunettes. Chaque ligne est retrouvée par son numéro, comme l'ajout du téléphone (findLines, autour de son premier
 * arrêt) ; puis ses sens (deux, ou un pour une boucle) et leurs terminus (liste « Lignes »), toute la ligne dans chaque
 * sens à 08:00 le premier jour publié, sans temps réel (lineRun), et leurs rangées dans les lunettes, page par page.
 *
 * Erreurs (le test échoue) : une ligne sans sens ou sans terminus, un sens introuvable ou de moins de 2 arrêts, une
 * rangée qui dépasse, une exception. Le reste est mesuré et écrit dans le journal : boucles, longueur des lignes,
 * arrêts des branches secondaires non montrés (limite connue, PRD-1.2.6 § 3), rangées coupées (« … »), sens sans
 * passage à 08:00, couleurs publiées.
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data), par le workflow « Données
 * de nuit » ; sans lui, ignoré.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineFile, LineIndex, Meta, Names } from '../../../shared/types';
import type { LineMatch } from '../../src/core/api';
import { completeFollow, lineHeadsIn, lineRunIn, type LineFollow } from '../../src/core/linerun';
import { findLinesIn, linePath, loadLineFiles, opposite, type EndPattern, type LineData } from '../../src/core/linepicks';
import { gtfsTime } from '../../src/core/util';
import { textWidth } from '../../src/glasses/font';
import { layoutPage } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { followsView, lineRunView, type ViewCtx } from '../../src/glasses/views';
import { container, overflowing, rowsOf, settingsWith } from '../glasses/helpers';

const DIR = process.env.QUAI_SCAN_DATA;

/** Données de la nuit lues sur le disque, chaque fichier une fois. */
function diskSource(dir: string, meta: Meta): LineData {
  const cache = new Map<string, Promise<unknown>>();
  const read = (path: string): Promise<unknown> => {
    let p = cache.get(path);
    if (!p) {
      p = readFile(join(dir, path), 'utf8').then(
        (t) => JSON.parse(t) as unknown,
        () => null,
      );
      cache.set(path, p);
    }
    return p;
  };
  return {
    meta,
    json: async <T>(path: string, valid: (x: unknown) => x is T): Promise<T | null> => {
      const x = await read(path);
      return x !== null && valid(x) ? x : null;
    },
  };
}

/** Rangées de mots (colonnes a et b) qui finissent avant le texte de droite (colonne c), et dans l'écran sans lui. */
function wordsOverlap(p: PageSpec): string[] {
  const c = p.containers.find((x) => x.name === 'colC');
  const right = c ? rowsOf(c) : [];
  const bad: string[] = [];
  for (const name of ['colA', 'colB']) {
    const k = p.containers.find((x) => x.name === name);
    if (!k) continue;
    rowsOf(k).forEach((row, i) => {
      const r = right[i] ?? '';
      const start = c && r.trim() ? c.x + textWidth(r) - textWidth(r.trimStart()) : k.x + k.w;
      if (row.trim() && k.x + textWidth(row.trimEnd()) >= start) bad.push(`« ${row.trim()} » touche « ${r.trim()} »`);
    });
  }
  return bad;
}

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

interface Pat {
  areas: string[];
  trips: number;
  end: EndPattern;
}

/** Motifs d'une ligne, regroupés par sens comme core/linerun.ts (directionsOf) : le plus servi, puis l'opposé. */
function branchesOf(files: readonly LineFile[]): { missing: number; trips: number; total: number }[] {
  const pats: Pat[] = [];
  for (const file of files)
    for (const p of file.pats ?? []) {
      const n = p.a?.length ?? 0;
      const a = file.areas[p.a?.[0] ?? -1];
      const b = file.areas[p.a?.[n - 1] ?? -1];
      if (n < 2 || !a || !b) continue;
      const trips = p.t?.length ?? 0;
      pats.push({ areas: p.a.map((i) => file.areas[i]?.[0] ?? ''), trips, end: { head: p.head, from: { lat: a[1], lon: a[2] }, to: { lat: b[1], lon: b[2] }, trips } });
    }
  if (!pats.length) return [];
  const byTrips = [...pats].sort((x, y) => y.trips - x.trips || y.areas.length - x.areas.length);
  const m1 = byTrips.find((x) => opposite(x.end, byTrips[0].end));
  const groups: Pat[][] = m1 ? [[], []] : [[]];
  for (const x of pats) groups[m1 && opposite(x.end, byTrips[0].end) ? 1 : 0].push(x);
  return groups
    .filter((g) => g.length)
    .map((g) => {
      const main = [...g].sort((x, y) => y.trips - x.trips || y.areas.length - x.areas.length)[0];
      const shown = new Set(main.areas);
      const hidden = new Set<string>();
      let trips = 0;
      for (const x of g) {
        const out = x.areas.filter((a) => !shown.has(a));
        out.forEach((a) => hidden.add(a));
        if (out.length) trips += x.trips;
      }
      return { missing: hidden.size, trips, total: g.reduce((s, x) => s + x.trips, 0) };
    });
}

const pct = (n: number, d: number): string => `${String(d ? Math.round((1000 * n) / d) / 10 : 0).replace('.', ',')} %`;
const fr = (n: Names): string => n.fr;

describe.skipIf(!DIR)('1.2.6 : balayage des lignes de bus, tram et métro (QUAI_SCAN_DATA)', () => {
  it('chaque ligne : ses sens, leurs terminus, toute la ligne, ses rangées dans les lunettes', async () => {
    const dir = DIR!;
    const t0 = Date.now();
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Meta;
    const index = JSON.parse(await readFile(join(dir, 'lines/index.json'), 'utf8')) as LineIndex;
    const src = diskSource(dir, meta);
    const anyFile = (x: unknown): x is LineFile => !!x && typeof x === 'object' && 'pats' in x;
    const now = gtfsTime(meta.serviceDates[0], 8 * 60);
    const ctx: ViewCtx = { now, settings: settingsWith([], { seenVersion: '1.2.6' }) };

    const errors: string[] = [];
    const covered = new Set<string>();
    const matches: LineMatch[] = [];
    let lost = 0;
    for (const [key, line, mode] of index.lines) {
      if (mode === 'train' || covered.has(key)) continue;
      const path = linePath(key);
      const file = path ? await src.json(path, anyFile) : null;
      const first = file?.areas[0];
      const ms = await findLinesIn(src, line, first ? { lat: first[1], lon: first[2] } : null);
      for (const m of ms) {
        if (m.routes.some((r) => covered.has(r))) continue;
        m.routes.forEach((r) => covered.add(r));
        matches.push(m);
      }
      if (!covered.has(key)) {
        lost++;
        covered.add(key);
      }
    }

    const byOp = new Map<string, number>();
    const stopsCount: number[] = [];
    let loops = 0;
    let runs = 0;
    let quiet = 0;
    let rowsF = 0;
    let cutF = 0;
    let rowsR = 0;
    let cutR = 0;
    let branchDirs = 0;
    let branchTrips = 0;
    let allTrips = 0;
    let colored = 0;
    const cutSamples: string[] = [];
    const branchSamples: string[] = [];
    for (const m of matches) {
      const name = `${m.op} ${m.line} (${m.ends.map(fr).join(' ↔ ')})`;
      byOp.set(m.op, (byOp.get(m.op) ?? 0) + 1);
      if (m.color) colored++;
      try {
        const f: LineFollow = completeFollow({ id: 'scan', op: m.op as LineFollow['op'], line: m.line, routes: [] }, m);
        const heads = await lineHeadsIn(src, f);
        if (!heads.length) {
          errors.push(`${name} : aucun sens`);
          continue;
        }
        if (heads.some((h) => !h.fr.trim())) errors.push(`${name} : terminus sans nom`);
        if (heads.length === 1) loops++;
        // liste « Lignes » : un sens par rangée
        const fv = followsView([{ follow: f, mode: m.mode, heads }], ctx);
        for (const p of pagesOf(fv)) {
          const bad = [...overflowing(p), ...wordsOverlap(p)];
          if (bad.length) errors.push(`${name}, Lignes : ${bad.join(' ; ')}`);
          for (const l of p.lines.slice(0, p.visible)) {
            rowsF++;
            if (l.includes('…')) {
              cutF++;
              if (cutSamples.length < 6) cutSamples.push(`Lignes : ${l}`);
            }
          }
        }
        for (const [dir, b] of branchesOf(await loadLineFiles(src, f.routes)).entries()) {
          allTrips += b.total;
          if (!b.missing) continue;
          branchDirs++;
          branchTrips += b.trips;
          if (branchSamples.length < 6) branchSamples.push(`${name}, sens ${dir + 1} : ${b.missing} arrêt(s), ${pct(b.trips, b.total)} des voyages`);
        }
        for (let dir = 0; dir < heads.length; dir++) {
          const run = await lineRunIn(src, null, f, dir, now, null);
          runs++;
          if (run.state !== 'ok' || run.stops.length < 2) {
            errors.push(`${name}, vers ${fr(heads[dir])} : ${run.state === 'ok' ? `${run.stops.length} arrêt` : 'introuvable'}`);
            continue;
          }
          stopsCount.push(run.stops.length);
          if (run.stops.every((s) => !s.next.length)) quiet++;
          const v = lineRunView({ screen: 'lineRun', follow: f.id, dir }, f, run, ctx);
          for (const p of pagesOf(v)) {
            const bad = [...overflowing(p), ...wordsOverlap(p)];
            if (bad.length) errors.push(`${name}, vers ${fr(heads[dir])} : ${bad.join(' ; ')}`);
            for (const l of p.lines) {
              if (!/^[●○↔] /.test(l)) continue;
              rowsR++;
              if (l.includes('…')) {
                cutR++;
                if (cutSamples.length < 12) cutSamples.push(`Toute la ligne : ${l}`);
              }
            }
          }
        }
      } catch (e) {
        errors.push(`${name} : ${(e as Error).message}`);
      }
    }

    stopsCount.sort((a, b) => a - b);
    const med = stopsCount[Math.floor(stopsCount.length / 2)] ?? 0;
    const report = [
      `Balayage des lignes (${meta.serviceDates[0]}, 08:00, sans temps réel) : ${matches.length} lignes (${[...byOp].map(([op, n]) => `${op} ${n}`).join(', ')}), ${covered.size} fichiers, ${lost} fichier(s) non retrouvé(s) par leur numéro, ${Math.round((Date.now() - t0) / 1000)} s.`,
      `Sens : ${matches.length - loops} lignes à deux sens, ${loops} à un seul (boucle ou sens unique) ; ${runs} sens ouverts, de ${stopsCount[0] ?? 0} à ${stopsCount.at(-1) ?? 0} arrêts (médiane ${med}), ${stopsCount.filter((n) => n > 30).length} de plus de 30 arrêts ; ${quiet} sans passage à venir à 08:00.`,
      `Branches : ${branchDirs} sens dont des arrêts de motifs secondaires ne sont pas montrés, ${pct(branchTrips, allTrips)} des voyages.${branchSamples.length ? ` Ex. : ${branchSamples.join(' | ')}` : ''}`,
      `Rangées coupées (« … ») : Lignes ${cutF}/${rowsF} (${pct(cutF, rowsF)}), toute la ligne ${cutR}/${rowsR} (${pct(cutR, rowsR)}).${cutSamples.length ? ` Ex. : ${cutSamples.join(' | ')}` : ''}`,
      `Couleurs publiées : ${colored}/${matches.length} lignes (${pct(colored, matches.length)}).`,
      errors.length ? `Erreurs : ${errors.length}. ${errors.slice(0, 20).join(' | ')}` : 'Aucune erreur.',
    ];
    process.stdout.write(`\n${report.join('\n')}\n`);
    if (errors.length) process.stdout.write(`::warning title=Balayage des lignes::${errors.length} erreur(s) : ${errors.slice(0, 5).join(' | ')}\n`);
    expect(matches.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, 1_800_000);
});
