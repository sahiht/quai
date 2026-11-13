/**
 * 1.2.6 (PRD-1.2.6 § 9) : balayage de toutes les lignes de bus, tram et métro d'une publication de nuit, par le calcul
 * des lunettes. Chaque ligne est retrouvée par son numéro, comme l'ajout du téléphone (findLines, autour de son premier
 * arrêt) ; puis ses sens et leurs terminus (liste « Lignes » : un sens par rangée, un par morceau pour une ligne en
 * morceaux), leurs arrêts (lineDirections : ceux du motif le plus servi, puis ceux des variantes à leur place), toute
 * la ligne dans chaque sens à 08:00 le premier jour publié, sans temps réel (lineRun), et leurs rangées dans les
 * lunettes, page par page.
 *
 * Erreurs (le test échoue) : une ligne sans sens ou sans terminus, des rangées « Lignes » qui ne correspondent pas aux
 * sens calculés, un arrêt d'un motif absent de la liste de son sens, un « autre sens » hors de la ligne ou du même
 * sens géographique, un sens introuvable ou de moins de 2 arrêts, une rangée qui dépasse, une exception. Le reste est
 * mesuré et écrit dans le journal : rangées par ligne (lignes en morceaux), motifs dont l'ordre n'est pas respecté par
 * la liste, arrêts de variante (◇), sens sans « autre sens », longueur des lignes, rangées coupées (« … »), sens sans
 * passage à 08:00, couleurs publiées et contraste des pastilles.
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data), par le workflow « Données
 * de nuit » ; sans lui, ignoré. QUAI_SCAN_DETAIL (« stib:3, tec:W ») : ces lignes détaillées dans le bilan.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineFile, LineIndex, Meta, Names } from '../../../shared/types';
import type { LineMatch } from '../../src/core/api';
import { completeFollow, lineDirectionsIn, lineHeadsIn, lineRunIn, type LineDirection, type LineFollow } from '../../src/core/linerun';
import { findLinesIn, lineKey, linePath, loadLineFiles, type LineData } from '../../src/core/linepicks';
import { gtfsTime } from '../../src/core/util';
import { textWidth } from '../../src/glasses/font';
import { layoutPage } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { followsView, lineRunView, type ViewCtx } from '../../src/glasses/views';
import { BADGE_CONTRAST, badgeColors, contrastRatio } from '../../src/phone/badges';
import { overflowing, rowsOf, settingsWith } from '../glasses/helpers';

const DIR = process.env.QUAI_SCAN_DATA;
/** Lignes détaillées dans le bilan (« stib:3, tec:W ») : sens, terminus, arrêts, arrêts de variante, autre sens. */
const DETAIL = new Set(
  (process.env.QUAI_SCAN_DETAIL ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [op, ...line] = x.split(':');
      return `${op.toLowerCase()}:${lineKey(line.join(':'))}`;
    }),
);

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

/** Arrêts d'un motif, chacun à sa première occurrence (le retour au premier arrêt d'une boucle ne compte pas). */
const firstOccurrences = (areas: readonly string[]): string[] => [...new Set(areas)];

/**
 * Un sens tel que les lunettes le montrent : arrêts de ses motifs absents de sa liste (cachés), et motifs dont les
 * arrêts n'apparaissent pas dans l'ordre de la liste.
 */
function checkDirection(d: LineDirection): { hidden: string[]; disordered: { areas: string[]; trips: number }[] } {
  const at = new Map<string, number>();
  d.stops.forEach((s, i) => {
    if (!at.has(s.areaId)) at.set(s.areaId, i);
  });
  const hidden = new Set<string>();
  const disordered: { areas: string[]; trips: number }[] = [];
  for (const p of d.patterns) {
    let prev = -1;
    let ordered = true;
    for (const a of firstOccurrences(p.areas)) {
      const i = at.get(a);
      if (i === undefined) {
        hidden.add(a);
        continue;
      }
      if (i <= prev) ordered = false;
      prev = i;
    }
    if (!ordered) disordered.push(p);
  }
  return { hidden: [...hidden], disordered };
}

const pct = (n: number, d: number): string => `${String(d ? Math.round((1000 * n) / d) / 10 : 0).replace('.', ',')} %`;
const fr = (n: Names): string => n.fr;

describe.skipIf(!DIR)('1.2.6 : balayage des lignes de bus, tram et métro (QUAI_SCAN_DATA)', () => {
  it('chaque ligne : ses sens, leurs terminus, leurs arrêts, toute la ligne, ses rangées dans les lunettes', async () => {
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
    const lost: string[] = [];
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
        lost.push(`${key} (« ${line} »)`);
        covered.add(key);
      }
    }

    const byOp = new Map<string, number>();
    const stopsCount: number[] = [];
    /** Rangées « Lignes » par ligne : 1, 2, 3 et plus. */
    const rows = [0, 0, 0];
    const pieces: string[] = [];
    let runs = 0;
    let quiet = 0;
    let rowsF = 0;
    let cutF = 0;
    let rowsR = 0;
    let cutR = 0;
    let dirsAll = 0;
    let hiddenDirs = 0;
    let patsAll = 0;
    let tripsAll = 0;
    let disorderedPats = 0;
    let disorderedTrips = 0;
    const disorderedSamples: string[] = [];
    let branchDirs = 0;
    let branchStops = 0;
    let shownStops = 0;
    const branchSamples: string[] = [];
    let noOther = 0;
    let viaLines = 0;
    const namedVia: string[] = [];
    let holeRuns = 0;
    let spineHoleRuns = 0;
    const holeSamples: string[] = [];
    const noOtherSamples: string[] = [];
    let colored = 0;
    const palette = new Map<string, Map<string, number>>();
    const weak: string[] = [];
    let replaced = 0;
    const detail: string[] = [];
    const cutSamples: string[] = [];
    for (const m of matches) {
      const name = `${m.op} ${m.line} (${m.ends.map(fr).join(' ↔ ')})`;
      byOp.set(m.op, (byOp.get(m.op) ?? 0) + 1);
      if (m.color) {
        colored++;
        const c = badgeColors(m.color, m.text);
        const per = palette.get(m.op) ?? new Map<string, number>();
        per.set(`${c.b}/${c.t}`, (per.get(`${c.b}/${c.t}`) ?? 0) + 1);
        palette.set(m.op, per);
        const r = contrastRatio(c.b, c.t);
        if (r < BADGE_CONTRAST) weak.push(`${m.op} ${m.line} ${c.b}/${c.t} ${r.toFixed(1).replace('.', ',')}`);
        if (m.text && c.t !== m.text) replaced++;
      }
      const wanted = DETAIL.has(`${m.op}:${lineKey(m.line)}`);
      try {
        const f: LineFollow = completeFollow({ id: 'scan', op: m.op as LineFollow['op'], line: m.line, routes: [] }, m);
        const heads = await lineHeadsIn(src, f);
        if (!heads.length) {
          errors.push(`${name} : aucun sens`);
          continue;
        }
        if (heads.some((h) => !h.fr.trim())) errors.push(`${name} : terminus sans nom`);
        rows[Math.min(heads.length, 3) - 1]++;
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

        // les sens et leurs arrêts, tels que les lunettes les montrent
        const dirs = await lineDirectionsIn(src, f);
        const files = await loadLineFiles(src, f.routes);
        const names = new Map(files.flatMap((x) => x.areas.map((a) => [a[0], a[3].fr] as const)));
        const nameOf = (a: string): string => names.get(a) ?? a;
        if (dirs.length !== heads.length || dirs.some((d, i) => headsDiffer(d.head, heads[i]))) {
          errors.push(`${name} : rangées « Lignes » (${heads.map(fr).join(', ')}) ≠ sens calculés (${dirs.map((d) => fr(d.head)).join(', ')})`);
        }
        if (dirs.length >= 3 && pieces.length < 8) pieces.push(`${name} : ${dirs.map((d) => fr(d.head)).join(', ')}`);
        // 1.2.7 : deux rangées « Lignes » au même nom (une boucle dans les deux sens) : jamais
        const seenHeads = new Set<string>();
        for (const d of dirs) {
          const k = fr(d.head).toLowerCase();
          if (seenHeads.has(k)) errors.push(`${name} : deux sens nommés « ${fr(d.head)} »`);
          seenHeads.add(k);
        }
        if (dirs.some((d) => / par /.test(fr(d.head))) && namedVia.length < 8) namedVia.push(`${name} : ${dirs.map((d) => fr(d.head)).join(', ')}`);
        if (dirs.some((d) => / par /.test(fr(d.head)))) viaLines++;
        if (wanted) detail.push(`${name} : ${f.routes.length} variante(s), ${dirs.length} sens (${dirs.map((d) => fr(d.head)).join(', ')})`);
        dirs.forEach((d, i) => {
          dirsAll++;
          const head = fr(d.head);
          const { hidden, disordered } = checkDirection(d);
          const trips = d.patterns.reduce((s, p) => s + p.trips, 0);
          patsAll += d.patterns.length;
          tripsAll += trips;
          if (hidden.length) {
            hiddenDirs++;
            errors.push(`${name}, vers ${head} : ${hidden.length} arrêt(s) d'un motif absent(s) de la liste (${hidden.slice(0, 4).map(nameOf).join(', ')})`);
          }
          if (disordered.length) {
            disorderedPats += disordered.length;
            disorderedTrips += disordered.reduce((s, p) => s + p.trips, 0);
            if (disorderedSamples.length < 6) disorderedSamples.push(`${name}, vers ${head} : ${disordered.length} motif(s), ${pct(disordered.reduce((s, p) => s + p.trips, 0), trips)} des voyages`);
          }
          const branch = d.stops.filter((s) => s.branch);
          shownStops += d.stops.length;
          if (branch.length) {
            branchDirs++;
            branchStops += branch.length;
            if (branchSamples.length < 6) branchSamples.push(`${name}, vers ${head} : ${branch.length}/${d.stops.length}`);
          }
          if (d.other !== undefined && (d.other < 0 || d.other >= dirs.length || d.other === i || dirs[d.other].group === d.group)) {
            errors.push(`${name}, vers ${head} : autre sens ${d.other} invalide (${dirs.length} sens, groupe ${d.group})`);
          }
          if (dirs.length >= 2 && d.other === undefined) {
            noOther++;
            if (noOtherSamples.length < 6) noOtherSamples.push(`${name}, vers ${head}`);
          }
          if (wanted) {
            const first = d.stops[0]?.areaId ?? '';
            const last = d.stops.at(-1)?.areaId ?? '';
            detail.push(
              `  sens ${i + 1} vers ${head} (groupe ${d.group}, ${d.other !== undefined ? `autre sens : vers ${fr(dirs[d.other].head)}` : 'sans autre sens'}) : ${d.stops.length} arrêts, de ${nameOf(first)} à ${nameOf(last)} (${d.stops.slice(0, 6).map((x) => nameOf(x.areaId)).join(', ')}…) ; ${d.patterns.length} motif(s) ; ${branch.length ? `${branch.length} arrêt(s) de variante : ${branch.slice(0, 10).map((s) => nameOf(s.areaId)).join(', ')}` : 'aucun arrêt de variante'}${hidden.length ? ` ; ${hidden.length} caché(s)` : ''}${disordered.length ? ` ; ${disordered.length} motif(s) hors de l'ordre` : ''}`,
            );
          }
        });

        for (let dir = 0; dir < heads.length; dir++) {
          const run = await lineRunIn(src, null, f, dir, now, null);
          runs++;
          if (run.state !== 'ok' || run.stops.length < 2) {
            errors.push(`${name}, vers ${fr(heads[dir])} : ${run.state === 'ok' ? `${run.stops.length} arrêt` : 'introuvable'}`);
            continue;
          }
          stopsCount.push(run.stops.length);
          if (run.stops.every((s) => !s.next.length)) quiet++;
          // 1.2.7 : un arrêt sans passage au milieu d'une ligne qui roule (un arrêt affiché deux fois, mal rattaché)
          else {
            const firstOn = run.stops.findIndex((x) => x.next.length);
            const lastOn = run.stops.length - 1 - [...run.stops].reverse().findIndex((x) => x.next.length);
            const holes = run.stops.filter((x, k) => k > firstOn && k < lastOn && !x.next.length);
            const spine = holes.filter((x) => !x.branch);
            if (holes.length) holeRuns++;
            if (spine.length) {
              spineHoleRuns++;
              if (holeSamples.length < 8) holeSamples.push(`${name}, vers ${fr(heads[dir])} : ${spine.length} (${spine.slice(0, 3).map((x) => x.name.fr).join(', ')})`);
            }
          }
          if (wanted) detail.push(`  vers ${fr(heads[dir])} à 08:00 : ${run.stops.filter((x) => x.next.length).length}/${run.stops.length} arrêts avec un passage à venir`);
          const v = lineRunView({ screen: 'lineRun', follow: f.id, dir }, f, run, ctx);
          for (const p of pagesOf(v)) {
            const bad = [...overflowing(p), ...wordsOverlap(p)];
            if (bad.length) errors.push(`${name}, vers ${fr(heads[dir])} : ${bad.join(' ; ')}`);
            for (const l of p.lines) {
              if (!/^[●○◆◇↔] /.test(l)) continue;
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
      `Balayage des lignes (${meta.serviceDates[0]}, 08:00, sans temps réel) : ${matches.length} lignes (${[...byOp].map(([op, n]) => `${op} ${n}`).join(', ')}), ${covered.size} fichiers, ${lost.length} fichier(s) non retrouvé(s) par leur numéro${lost.length ? ` (${lost.slice(0, 6).join(', ')})` : ''}, ${Math.round((Date.now() - t0) / 1000)} s.`,
      `Rangées « Lignes » par ligne : 1 (boucle ou sens unique) ${rows[0]}, 2 ${rows[1]}, 3 et plus (ligne en morceaux) ${rows[2]}.${pieces.length ? ` Ex. : ${pieces.join(' | ')}` : ''}`,
      `Sens au même terminus, nommés par où ils passent : ${viaLines} ligne(s).${namedVia.length ? ` Ex. : ${namedVia.join(' | ')}` : ''}`,
      `Arrêts sans passage au milieu d'une ligne qui roule à 08:00 (d'ici la fin du lendemain) : ${holeRuns} sens, dont ${spineHoleRuns} avec un arrêt du motif principal (hors variantes).${holeSamples.length ? ` Ex. : ${holeSamples.join(' | ')}` : ''}`,
      `Sens : ${runs} ouverts, de ${stopsCount[0] ?? 0} à ${stopsCount.at(-1) ?? 0} arrêts (médiane ${med}), ${stopsCount.filter((n) => n > 30).length} de plus de 30 arrêts ; ${quiet} sans passage à venir à 08:00 ; ${noOther} sans « autre sens » sur une ligne d'au moins 2 sens${noOtherSamples.length ? ` (${noOtherSamples.join(' | ')})` : ''}.`,
      `Arrêts des motifs : ${hiddenDirs} sens sur ${dirsAll} avec un arrêt absent de la liste ; ${disorderedPats} motif(s) sur ${patsAll} hors de l'ordre de la liste, ${pct(disorderedTrips, tripsAll)} des voyages${disorderedSamples.length ? ` (${disorderedSamples.join(' | ')})` : ''}.`,
      `Arrêts de variante (◇) : ${branchDirs} sens sur ${dirsAll}, ${branchStops} arrêts sur ${shownStops} montrés (${pct(branchStops, shownStops)}).${branchSamples.length ? ` Ex. : ${branchSamples.join(' | ')}` : ''}`,
      `Rangées coupées (« … ») : Lignes ${cutF}/${rowsF} (${pct(cutF, rowsF)}), toute la ligne ${cutR}/${rowsR} (${pct(cutR, rowsR)}).${cutSamples.length ? ` Ex. : ${cutSamples.join(' | ')}` : ''}`,
      `Couleurs publiées : ${colored}/${matches.length} lignes (${pct(colored, matches.length)}) ; ${[...palette]
        .map(([op, per]) => `${op} ${per.size} pastille(s) différente(s), surtout ${[...per].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([c, n]) => `${c} ×${n}`).join(', ')}`)
        .join(' ; ')}. Texte de l'opérateur remplacé (contraste sous 3:1) : ${replaced} ; contraste du numéro encore sous 3:1 : ${weak.length}${weak.length ? ` (${weak.slice(0, 8).join(', ')})` : ''}.`,
      ...(detail.length ? ['Lignes détaillées :', ...detail] : []),
      errors.length ? `Erreurs : ${errors.length}. ${errors.slice(0, 20).join(' | ')}` : 'Aucune erreur.',
    ];
    process.stdout.write(`\n${report.join('\n')}\n`);
    if (errors.length) process.stdout.write(`::warning title=Balayage des lignes::${errors.length} erreur(s) : ${errors.slice(0, 5).join(' | ')}\n`);
    expect(matches.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  }, 1_800_000);
});

/** Deux terminus différents (nom français ou néerlandais). */
function headsDiffer(a: Names, b: Names | undefined): boolean {
  return !b || a.fr !== b.fr || a.nl !== b.nl;
}
