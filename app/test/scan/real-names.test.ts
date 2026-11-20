/**
 * 1.3.0 (PRD-1.3.0 § 5, § 11.3) : balayage des vrais noms d'une publication de nuit (arrêts et destinations des lignes
 * de bus, tram et métro ; gares et destinations des trains, en français et en néerlandais) dans chaque rangée qui coupe
 * un nom : tableau d'un arrêt (avec « , dernier »), tableau d'une gare (« demain, », retard, voie modifiée,
 * « SUPPRIMÉ »), arrêts d'un départ (et l'arrêt du haut), passages d'une ligne (« vers … », « jusqu'à … »), « Lignes »,
 * toute la ligne (« à 80 m »), tout le trajet d'un train (la voie entière). Chaque nom assez long pour être coupé
 * quelque part (150 px et plus) passe par le calcul des lunettes, avec des départs construits autour de lui.
 *
 * Erreurs (le test échoue) : une rangée coupée au milieu d'un mot, une coupe dont le texte entier est introuvable, une
 * heure, un état ou une voie coupés ou absents, une rangée qui dépasse, une exception. Mesuré et écrit dans le journal :
 * noms, rangées coupées, premier mot seul trop long (coupé au caractère faute d'autre issue), noms les plus longs.
 *
 * Lancé seulement avec QUAI_SCAN_DATA (dossier des données de la nuit, ex. ../site/data), comme les autres balayages du
 * workflow « Données de nuit » ; sans lui, ignoré.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineFile, LineIndex, Meta, Names, TrainsDay } from '../../../shared/types';
import type { LineFollow, LineRun } from '../../src/core/linerun';
import { linePath } from '../../src/core/linepicks';
import { gtfsTime } from '../../src/core/util';
import { textWidth } from '../../src/glasses/font';
import type { GlassesView } from '../../src/glasses/types';
import { boardView, favoritesView, followsView, lineRunView, lineView, stationsView, stepsPage, stopsView, trainRunView, type ViewCtx } from '../../src/glasses/views';
import { PLACES, boardOf, dep, journey, lineBoardOf, overflowing, page, settingsWith, stopsOf, trainAt, trainRunOf } from '../glasses/helpers';
import { newTally, pageCuts, tally } from './cuts';

const DIR = process.env.QUAI_SCAN_DATA;
const MIN = 60_000;
/** Un nom plus court tient dans toute rangée (la plus étroite laisse plus de 200 px au nom). */
const MIN_PX = 150;
const nb = (t: string): string => t.replace(/[\u00a0\u202f]/g, ' ');

describe.skipIf(!DIR)('1.3.0 : balayage des vrais noms dans les rangées des lunettes (QUAI_SCAN_DATA)', () => {
  it('chaque nom long, dans chaque rangée qui le coupe : au mot, jamais au milieu d’un mot ; heures, état, voies entiers', async () => {
    const dir = DIR!;
    const t0 = Date.now();
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Meta;
    const index = JSON.parse(await readFile(join(dir, 'lines/index.json'), 'utf8')) as LineIndex;
    const trains = JSON.parse(await readFile(join(dir, `trains/${meta.serviceDates[0]}.json`), 'utf8')) as TrainsDay;

    // les noms : arrêts et destinations des lignes, gares et destinations des trains, chaque langue
    const stops = new Set<string>();
    const heads = new Set<string>();
    const add = (set: Set<string>, n: Names | undefined): void => {
      for (const s of [n?.fr, n?.nl]) if (s && s.trim()) set.add(s.trim());
    };
    const seen = new Set<string>();
    for (const [key] of index.lines) {
      const path = linePath(key);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      let file: LineFile | null = null;
      try {
        file = JSON.parse(await readFile(join(dir, path), 'utf8')) as LineFile;
      } catch {
        continue;
      }
      for (const a of file.areas ?? []) add(stops, a[3]);
      for (const p of file.pats ?? []) add(heads, p.head);
    }
    for (const s of trains.stations) add(stops, s.n);
    for (const t of trains.trips) add(heads, t.head);
    const long = (set: Set<string>) => [...set].filter((s) => textWidth(s) >= MIN_PX);
    const longStops = long(stops);
    const longHeads = long(heads);

    const now = gtfsTime(meta.serviceDates[0], 8 * 60);
    const ctx: ViewCtx = { now, settings: settingsWith([], { seenVersion: '1.2.9' }) };
    const N = (s: string): Names => ({ fr: s, nl: s });
    const errors: string[] = [];
    const err = (msg: string): void => {
      if (errors.length < 40) errors.push(msg);
    };
    const words = newTally();
    let views = 0;
    let rows = 0;
    /** Une vue : rien ne dépasse, ses coupes comptées, ses textes protégés présents (motifs sur les rangées). */
    const check = (label: string, v: GlassesView, kept: RegExp[]): void => {
      views++;
      const p = page(v);
      const bad = overflowing(p);
      if (bad.length) err(`${label} : ${bad[0]}`);
      tally(words, pageCuts(v, p), label, p);
      const ls = p.lines.map(nb);
      rows += p.visible;
      for (const re of kept) if (!ls.some((l) => re.test(l))) err(`${label} : rien ne finit par ${re.source} (${ls.slice(0, 4).join(' | ')})`);
    };
    const follow: LineFollow = { id: 'scan', op: 'tec', mode: 'bus', line: '163b', routes: [] };

    for (const name of longHeads) {
      try {
        // tableau d'un arrêt : la destination, « , dernier », l'attente
        check(`Tableau d'un arrêt, vers ${name}`, boardView(boardOf('tec:scan', 'Arrêt', [dep(now, 5, { head: N(name), line: '163b' }), dep(now, 9, { head: N(name), line: '163b', last: true })]), ctx, { kept: false }), [/   5 min$/, /, dernier   9 min$/]);
        // tableau d'une gare : « demain, » et la destination ; l'heure, le retard, la voie modifiée, « SUPPRIMÉ »
        check(
          `Tableau d'une gare, vers ${name}`,
          boardView(boardOf('sncb:scan', 'Gare', [trainAt(now, 11, { head: N(name), platform: '12', newPlatform: '12', delayMin: 12, est: now + 23 * MIN }), trainAt(now, 24 * 60, { head: N(name), cancelled: true })]), ctx, { kept: false }),
          [/ \+12  voie 12 !$/, /  SUPPRIMÉ$/],
        );
        // passages d'une ligne : « vers … » (retard) et « jusqu'à … » (passage partiel), l'attente entière
        const lb = lineBoardOf('tec:scan', 'Arrêt', '163b', [{ head: 'Wavre', departures: [dep(now, 4, { head: N(name), line: '163b', delayMin: 3, est: now + 7 * MIN }), dep(now, 9, { head: N(name), line: '163b', partial: true })] }]);
        check(`Passages d'une ligne, vers ${name}`, lineView({ screen: 'line', areaId: 'tec:scan', op: 'tec', line: '163b', name: N('Arrêt') }, lb, ctx), [/dans 7 min$/, /dans 9 min$/]);
        // « Lignes » : un sens par rangée
        check(`Lignes, vers ${name}`, followsView([{ follow, mode: 'bus', heads: [N(name), N('Wavre')] }], ctx), []);
        // 1.3.1 (B21) : « Gares de train » en accordéon : la direction, puis le train d'après, son heure, son retard et sa
        // voie modifiée entiers
        const station = { id: 'scan', areaId: 'sncb:scan', name: N('Gare'), lat: 50.8, lon: 4.3 };
        const after = trainAt(now, 37, { head: N(name), platform: '12', newPlatform: '12a', delayMin: 12, est: now + 49 * MIN });
        check(`Gares, vers ${name}`, stationsView([{ pick: station, next: trainAt(now, 7, { head: N(name) }), after, state: 'ok' }], ctx), [/^vers /, /, 08:37 \+12 voie 12a !$/]);
      } catch (e) {
        err(`${name} : ${(e as Error).message}`);
      }
    }

    for (const name of longStops) {
      try {
        // arrêts d'un départ : l'arrêt du haut, un arrêt supprimé, un arrêt en retard
        const ds = stopsOf({ op: 'tec', mode: 'bus', line: '163b', head: N('Wavre') }, now, [[name, 1], [name, 5, { cancelled: true }], [name, 9, { delayMin: 3 }]]);
        check(`Arrêts d'un départ, ${name}`, stopsView({ screen: 'stops', areaId: 'tec:scan', dep: dep(now, 1) }, ds, ctx), [/   SUPPRIMÉ$/, /^\d\d:\d\d \+3   /]);
        // toute la ligne : l'arrêt, « à 80 m » quand c'est le plus proche, le prochain passage entier
        const run: LineRun = {
          op: 'tec', mode: 'bus', line: '163b', heads: [N('Wavre')], dir: 0, rtError: false, state: 'ok',
          stops: [0, 1].map((i) => ({ areaId: `tec:scan${i}`, name: N(name), lat: 50.8, lon: 4.3, next: [{ t: now + (5 + i) * MIN, rt: true }] })),
          nearest: { index: 1, distanceM: 80 },
        };
        check(`Toute la ligne, ${name}`, lineRunView({ screen: 'lineRun', follow: 'scan', dir: 0 }, follow, run, ctx), [/^○ .*   dans 5 min$/, /^○ .*   dans 6 min$/]);
        // tout le trajet d'un train : la gare, la voie modifiée entière, le passage ou « SUPPRIMÉ »
        const tr = trainRunOf({ op: 'sncb', mode: 'train', line: 'IC', head: N('Namur') }, now, [['Namur', 2, { platform: '4' }], [name, 30, { platform: '12a', newPlatform: '12b' }], [name, 60, { cancelled: true }]], 0);
        check(`Tout le trajet d'un train, ${name}`, trainRunView(tr, ctx), [/ voie 12b !   dans 30 min$/, /   SUPPRIMÉ$/]);
      } catch (e) {
        err(`${name} : ${(e as Error).message}`);
      }
    }

    // 1.3.1 (PRD-1.3.1 § 7) : chaque nom des données qui a une apostrophe droite (« Braine-l'Alleud ») : dans les écrans
    // ci-dessus, la liste « Gares », l'écran du trajet (marche vers l'arrêt, véhicule, « depuis … ») et l'accordéon
    // d'un favori ; aucune rangée affichée ne garde l'apostrophe droite
    const withApos = [...new Set([...stops, ...heads])].filter((n) => n.includes("'"));
    for (const name of withApos) {
      try {
        check(`Tableau d'un arrêt, vers ${name}`, boardView(boardOf('tec:scan', 'Arrêt', [dep(now, 5, { head: N(name), line: '163b' })]), ctx, { kept: false }), []);
        const ds = stopsOf({ op: 'tec', mode: 'bus', line: '163b', head: N(name) }, now, [['Wavre', 1], [name, 5], [name, 9]]);
        check(`Arrêts d'un départ, ${name}`, stopsView({ screen: 'stops', areaId: 'tec:scan', dep: dep(now, 1) }, ds, ctx), []);
        const tr = trainRunOf({ op: 'sncb', mode: 'train', line: 'IC', head: N(name) }, now, [['Namur', 2, { platform: '4' }], [name, 30, { platform: '3' }]], 0);
        check(`Tout le trajet d'un train, ${name}`, trainRunView(tr, ctx), []);
        check(`Gares, ${name}`, stationsView([{ pick: { id: 'scan', areaId: 'sncb:scan', name: N(name), lat: 50.8, lon: 4.3 }, next: trainAt(now, 7, { head: N(name) }), state: 'ok' }], ctx), []);
        const j = journey('scan', [
          { walk: 6, to: name },
          { ride: '163b', mode: 'bus', dep: now + 10 * MIN, arr: now + 30 * MIN, from: name, to: name, head: name },
          { walk: 3 },
        ]);
        check(`Écran du trajet, ${name}`, stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, ctx), []);
        const aboard = journey('scan2', [{ ride: 'IC', mode: 'train', dep: now + 10 * MIN, arr: now + 40 * MIN, from: name, to: 'Namur', platform: '2' }]);
        check(`Écran du trajet à bord, ${name}`, stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [aboard], index: 0, fresh: true }, ctx), []);
        const fav = { fav: PLACES.bureau, answer: { favoriteId: PLACES.bureau.id, kind: 'trip' as const, state: 'ok' as const, plan: { journeys: [j] }, updatedAt: now } };
        check(`Accordéon d'un favori, ${name}`, favoritesView({ entries: [fav] }, { ...ctx, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.9' }) }), []);
      } catch (e) {
        err(`${name} : ${(e as Error).message}`);
      }
    }

    const top = [...longStops, ...longHeads].sort((a, b) => textWidth(b) - textWidth(a)).slice(0, 5);
    const report = [
      `Balayage des vrais noms (${meta.serviceDates[0]}) : ${stops.size} noms d'arrêts et de gares, ${heads.size} destinations ; ${longStops.length} + ${longHeads.length} de ${MIN_PX} px et plus, dans ${views} vues (${rows} rangées), ${Math.round((Date.now() - t0) / 1000)} s.`,
      `Rangées coupées : ${words.cut} ; au milieu d'un mot (0 exigé) : ${words.mid} ; premier mot seul trop long (coupé au caractère) : ${words.first} ; coupes introuvables : ${words.unknown}.${words.samples.length ? ` Ex. : ${words.samples.join(' | ')}` : ''}`,
      `Noms à apostrophe droite : ${withApos.length} ; rangées affichées avec une apostrophe droite (1.3.1, 0 exigé) : ${words.straight}.${words.straightSamples.length ? ` Ex. : ${words.straightSamples.join(' | ')}` : ''}`,
      `Noms les plus longs : ${top.map((s) => `${s} (${textWidth(s)} px)`).join(', ')}.`,
      errors.length ? `Erreurs :\n  ${errors.join('\n  ')}` : 'Aucune erreur.',
    ];
    process.stdout.write(`\n${report.join('\n')}\n`);
    if (errors.length || words.mid) process.stdout.write(`::warning title=Balayage des noms::${errors.length} erreur(s), ${words.mid} rangée(s) coupée(s) au milieu d'un mot\n`);
    expect(views).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(words.mid).toBe(0);
    expect(words.unknown).toBe(0);
    // 1.3.1 (PRD-1.3.1 § 7) : aucune apostrophe droite affichée, et il y en avait dans les données
    expect(withApos.length).toBeGreaterThan(0);
    expect(words.straight).toBe(0);
  }, 1_200_000);
});
