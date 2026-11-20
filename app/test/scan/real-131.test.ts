/**
 * 1.3.1 (PRD-1.3.1 § 4, § 6, § 7, § 10, § 12) : balayage des vrais noms d'arrêts et de gares dans les rangées où la 1.3.1
 * les ajoute : l'écran du trajet (« 16:40  à pied 7 min → Flagey », la correspondance « à pied 2 min → Gare du Midi »),
 * l'accordéon d'un favori (« à pied 7 min → Flagey »), la ligne d'action des arrêts d'un départ et du trajet d'un train
 * (« ▶ Me guider jusqu'à … »), les écrans du guidage (« À pied vers l'arrêt Flagey », « ensuite : 7 min à pied →
 * Flagey », « 2 min à pied → Gare du Nord, très juste », « vers l'arrêt Flagey » d'un virage sans rue, « N min à pied
 * jusqu'à l'arrêt … » au départ et après une descente, « Ensuite : descente à … » et « Prochain arrêt : … » à bord).
 *
 * Mesures (barrière du PRD § 10) : rangées coupées au milieu d'un mot (0 exigé), rangées affichées avec une apostrophe
 * droite (0 exigé, § 7 : tout nom des données avec « ’ »), rien qui dépasse ; chaque rangée attendue présente (la
 * nouveauté est là : sinon, rien n'est mesuré). La coupe est jugée sur le nom lui-même, pas sur le texte de l'élément
 * (que les écrans du guidage ont déjà coupé) : le texte avant « … » finit par un début du nom ; coupé entre deux
 * lettres ou deux chiffres du nom, c'est au milieu d'un mot ; aucun début du nom : le nom a disparu (« introuvable »).
 *
 * Noms : chaque arrêt et chaque gare des données assez long pour être coupé (150 px et plus) et chaque nom qui a une
 * apostrophe droite. Lancé seulement avec QUAI_SCAN_DATA (comme les autres balayages) ; QUAI_SCAN_LIMIT : au plus N
 * noms (les plus longs d'abord), pour un essai. Écrit par le pôle Qualité ; les écrans du guidage dépendent du pôle
 * Guidage (mots du § 12), les listes du pôle Écrans.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LineFile, LineIndex, Meta, Names, TrainsDay } from '../../../shared/types';
import type { Journey } from '../../src/core/api';
import type { GuideState, Moment, WhereAmI } from '../../src/core/guide-types';
import { linePath } from '../../src/core/linepicks';
import { apos } from '../../src/core/typo';
import { gtfsTime } from '../../src/core/util';
import { textWidth, truncate } from '../../src/glasses/font';
import { guideView } from '../../src/glasses/guide-views';
import { layoutPage } from '../../src/glasses/layout';
import type { PageSpec } from '../../src/glasses/types';
import { favoritesView, stepsPage, stopsView, trainRunView, type ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, dep, journey, overflowing, page, settingsWith, stopsOf, trainRunOf } from '../glasses/helpers';
import { isWordChar, straightApostrophes } from './cuts';

const DIR = process.env.QUAI_SCAN_DATA;
const LIMIT = Number(process.env.QUAI_SCAN_LIMIT ?? 0);
/** Un nom plus court tient dans toute rangée (comme le balayage des noms de la 1.3.0). */
const MIN_PX = 150;
const NBSP = /[  ]/g;
/** Le nom tel que l'écran l'écrit : apostrophe typographique, caractères sûrs de la police, espaces ordinaires. */
const shown = (s: string): string => truncate(apos(s), Number.MAX_SAFE_INTEGER).replace(NBSP, ' ');
const nb = (t: string): string => t.replace(NBSP, ' ');

/**
 * Coupe d'un nom dans une rangée : `word` au mot (ou après le nom) ; `mid` au milieu d'un mot ; `first` dans le premier
 * mot du nom, trop long pour la place (coupé au caractère faute d'autre issue, compté à part comme en 1.3.0) ; `double`
 * coupé deux fois (« …… » : ce qui suivait le nom, une heure par exemple, perdu) ; `gone` le nom a disparu de la rangée.
 */
type NameCut = 'word' | 'mid' | 'first' | 'double' | 'gone';

/**
 * Coupes de rangées qui montrent (un début de) `name` : pour chaque « … » collé, le texte qui le précède finit-il par un
 * début du nom (le plus long) ? Oui : coupé au milieu d'un mot si ce début s'arrête entre deux lettres ou chiffres du
 * nom (dans son premier mot : `first`) ; « … » juste après « … » : `double` ; aucun début du nom : `gone`.
 */
export function nameCuts(lines: readonly string[], name: string, want: RegExp): { line: string; kind: NameCut }[] {
  const n = shown(name);
  const out: { line: string; kind: NameCut }[] = [];
  for (const raw of lines) {
    const line = nb(raw);
    if (!want.test(line)) continue;
    for (let k = line.indexOf('…'); k >= 0; k = line.indexOf('…', k + 1)) {
      const before = line.slice(0, k);
      if (!before.trim() || /\s$/.test(before)) continue;
      if (before.endsWith('…')) {
        out.push({ line: raw, kind: 'double' });
        continue;
      }
      let j = 0;
      for (let len = Math.min(n.length, before.length); len > 0 && !j; len--) if (before.endsWith(n.slice(0, len))) j = len;
      if (!j) {
        out.push({ line: raw, kind: 'gone' });
        continue;
      }
      const inWord = j < n.length && isWordChar(n[j - 1]) && isWordChar(n[j]);
      out.push({ line: raw, kind: !inWord ? 'word' : /[\s\-/’']/.test(n.slice(0, j)) ? 'mid' : 'first' });
    }
  }
  return out;
}

/** État du guidage construit à la main (le moteur décide quoi, les écrans comment : seul « comment » est balayé ici). */
function state(journeyId: string, where: WhereAmI, moment: Moment | null, phase: GuideState['phase']): GuideState {
  return { kind: 'trip', journeyId, phase, moment, where, location: 'high', wakeAt: 0, ended: false };
}

describe.skipIf(!DIR)('1.3.1 : balayage des noms ajoutés aux rangées des lunettes (QUAI_SCAN_DATA)', () => {
  it('chaque nom long ou à apostrophe, dans chaque rangée qui le nomme : présente, coupée au mot, sans apostrophe droite', async () => {
    const dir = DIR!;
    const t0 = Date.now();
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Meta;
    const index = JSON.parse(await readFile(join(dir, 'lines/index.json'), 'utf8')) as LineIndex;
    const trains = JSON.parse(await readFile(join(dir, `trains/${meta.serviceDates[0]}.json`), 'utf8')) as TrainsDay;

    // les noms d'arrêts et de gares (fr et nl), comme le balayage des noms de la 1.3.0
    const names = new Set<string>();
    const add = (n: Names | undefined): void => {
      for (const s of [n?.fr, n?.nl]) if (s && s.trim()) names.add(s.trim());
    };
    const seen = new Set<string>();
    for (const [key] of index.lines) {
      const path = linePath(key);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      try {
        const file = JSON.parse(await readFile(join(dir, path), 'utf8')) as LineFile;
        for (const a of file.areas ?? []) add(a[3]);
      } catch {
        /* fichier de ligne illisible : compté par le balayage des lignes */
      }
    }
    for (const s of trains.stations) add(s.n);
    let list = [...names].filter((s) => textWidth(s) >= MIN_PX || s.includes("'")).sort((a, b) => textWidth(b) - textWidth(a));
    if (LIMIT > 0) list = list.slice(0, LIMIT);

    const now = gtfsTime(meta.serviceDates[0], 8 * 60);
    const ctx: ViewCtx = { now, settings: settingsWith([PLACES.bureau], { seenVersion: '1.3.0' }) };
    const N = (s: string): Names => ({ fr: s, nl: s });
    const errors: string[] = [];
    const err = (msg: string): void => {
      if (errors.length < 40) errors.push(msg);
    };
    const tally = { rows: 0, views: 0, cut: 0, mid: 0, first: 0, double: 0, gone: 0, straight: 0, samples: [] as string[], firstSamples: [] as string[], straightSamples: [] as string[] };
    /** Rangées qui nomment le nom attendues par écran (`want`), présentes au moins une fois par nom. */
    const missing = new Map<string, number>();

    /** Une page : rien ne dépasse, apostrophes droites, coupes du nom dans les rangées `want`, la rangée présente. */
    const check = (label: string, name: string, p: PageSpec, want: RegExp): void => {
      tally.views++;
      const bad = overflowing(p);
      if (bad.length) err(`${label}, ${name} : ${bad[0]}`);
      for (const r of straightApostrophes(p)) {
        tally.straight++;
        if (tally.straightSamples.length < 8) tally.straightSamples.push(`${label} : ${nb(r)}`);
      }
      const rows = p.lines.map(nb).filter((l) => want.test(l));
      if (!rows.length) missing.set(label, (missing.get(label) ?? 0) + 1);
      tally.rows += rows.length;
      for (const c of nameCuts(p.lines, name, want)) {
        tally.cut++;
        if (c.kind === 'word') continue;
        tally[c.kind]++;
        if (c.kind === 'first') {
          if (tally.firstSamples.length < 4) tally.firstSamples.push(`${label} : ${nb(c.line)}`);
          continue;
        }
        if (tally.samples.length < 12) tally.samples.push(`${c.kind === 'mid' ? 'au milieu d’un mot' : c.kind === 'double' ? 'coupé deux fois' : 'nom disparu'} : ${label} (« ${name} ») : ${nb(c.line)}`);
      }
    };

    for (const name of list) {
      try {
        // écran du trajet : marche vers l'arrêt du bus, correspondance à pied vers le même nom, dernière marche
        const j: Journey = journey('scan', [
          { walk: 7, to: name },
          { ride: '163b', mode: 'bus', dep: now + 10 * MIN, arr: now + 30 * MIN, from: name, to: 'Wavre', head: 'Wavre' },
          { walk: 2, to: name },
          { ride: '3', mode: 'tram', dep: now + 34 * MIN, arr: now + 44 * MIN, from: name, to: 'Bourse', head: 'Churchill' },
          { walk: 5 },
        ]);
        const sv = stepsPage({ title: 'Vers le bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, ctx);
        const sp = page(sv);
        check('Écran du trajet, marche vers l’arrêt', name, sp, /à pied 7 min → /);
        check('Écran du trajet, correspondance', name, sp, /à pied 2 min → /);

        // accordéon d'un favori : la 1re ligne nomme l'arrêt où monter
        const fav = { fav: PLACES.bureau, answer: { favoriteId: PLACES.bureau.id, kind: 'trip' as const, state: 'ok' as const, plan: { journeys: [j] }, updatedAt: now } };
        const fv = favoritesView({ entries: [fav] }, ctx);
        check('Accordéon d’un favori', name, page(fv), /^à pied 7 min → /);

        // arrêts d'un départ et trajet d'un train : la ligne d'action de l'arrêt du curseur
        const ds = stopsOf({ op: 'tec', mode: 'bus', line: '163b', head: N('Wavre') }, now, [['Wavre Gare', 1], ['Arrêt', 4], [name, 9]]);
        // le premier arrêt est en haut (la montée) ; le curseur sur le 2e de la liste : l'arrêt balayé
        const stv = stopsView({ screen: 'stops', areaId: 'tec:scan', dep: dep(now, 1) }, ds, ctx);
        check('Arrêts d’un départ, ligne d’action', name, layoutPage(stv, { sel: 1, top: 0 }), /^▶ Me guider jusqu’à /);
        const tr = trainRunOf({ op: 'sncb', mode: 'train', line: 'IC', head: N('Namur') }, now, [['Namur', 2, { platform: '4' }], ['Gembloux', 20, { platform: '1' }], [name, 40, { platform: '3' }]], 0);
        const trv = trainRunView(tr, ctx);
        check('Trajet d’un train, ligne d’action', name, layoutPage(trv, { sel: 2, top: 0 }), /^▶ Me guider jusqu’à /);

        // écrans du guidage
        const vehicle = { op: 'stib' as const, mode: 'bus' as const, line: '6' };
        const chain: WhereAmI['chain'] = [
          { label: 'à pied', state: 'now' },
          { label: 'bus 163b', state: 'next' },
          { label: 'tram 3', state: 'next' },
        ];
        const base: WhereAmI = { title: 'Vers le bureau', arr: now + 50 * MIN, rt: true, chain };
        const g = (label: string, s: GuideState, show: 'moment' | 'where', want: RegExp): void => {
          check(label, name, page(guideView(s, show, j, ctx)), want);
        };
        // « Où tu en es » à pied (§ 4) : « À pied vers l'arrêt Flagey »
        g('Où tu en es, à pied', state('scan', { ...base, walk: { toward: N(name), toKind: 'stop', remainingM: 450, remainingMin: 6, vehicle, depAt: now + 10 * MIN, rt: true, marginMin: 4 } }, null, { kind: 'walk', leg: 0 }), 'where', /^À pied vers l’arrêt /);
        // « Partir maintenant » (1.2.10, gardé) : « 7 min à pied jusqu'à l'arrêt Flagey »
        g('Partir maintenant', state('scan', base, { id: 'leave:scan', since: now, until: now + 3 * MIN, kind: 'leave', leg: 0, walkMin: 7, toward: N(name), vehicle, depAt: now + 10 * MIN, rt: true, marginMin: 3 } as Moment, { kind: 'before', leg: 0 }), 'moment', /^7 min à pied jusqu’/);
        // « monter » d'une correspondance (§ 12, conflit réglé) : « 2 min à pied → Gare du Nord, très juste »
        g('Monter, correspondance', state('scan', base, { id: 'board:scan', since: now, until: now + 3 * MIN, kind: 'board', leg: 3, vehicle: { op: 'stib', mode: 'tram', line: '3' }, depAt: now + 34 * MIN, rt: true, head: N('Churchill'), walkMin: 2, marginMin: 1, alight: N('Bourse'), stopsToAlight: 3, stop: N(name) } as Moment, { kind: 'walk', leg: 2 }), 'moment', /^2 min à pied /);
        // « Descends au prochain arrêt » (§ 4) : « ensuite : 2 min à pied → Flagey »
        g('Descente, ensuite', state('scan', base, { id: 'alight:scan', since: now, until: now + 3 * MIN, kind: 'alight', leg: 1, stop: N('Wavre'), at: now + 30 * MIN, rt: true, then: { kind: 'ride', vehicle: { op: 'stib', mode: 'tram', line: '3' }, depAt: now + 34 * MIN, rt: true, walkMin: 2, from: N(name) } } as Moment, { kind: 'ride', leg: 1, next: 1 }), 'moment', /^ensuite : /i);
        // virage sans rue (L2, U3) : « vers l'arrêt Flagey »
        g('Virage sans rue', state('scan', base, { id: 'turn:scan', since: now, until: now + MIN, kind: 'turn', leg: 0, turn: 'left', distM: 30, toward: N(name), final: false } as Moment, { kind: 'walk', leg: 0 }), 'moment', /^vers l’arrêt /);
        // à bord (§ 12) : « Ensuite : descente à Flagey, 08:42 », « Prochain arrêt : Flagey, 08:11 »
        const ride: WhereAmI['ride'] = { vehicle, head: N('Wavre'), total: 6, next: 2, nextStop: N(name), nextAt: now + 20 * MIN, alight: N(name), alightAt: now + 30 * MIN, stopsToAlight: 4, rt: true };
        g('Où tu en es, à bord, descente', state('scan', { ...base, ride }, null, { kind: 'ride', leg: 1, next: 2 }), 'where', /^(Ensuite : descente à|descente : )/);
        g('Où tu en es, à bord, arrêt suivant', state('scan', { ...base, ride: { ...ride, alight: N('Wavre') } }, null, { kind: 'ride', leg: 1, next: 2 }), 'where', /^Prochain arrêt : /);
        // B17 (P7) : la marche après une descente : « 2 min à pied jusqu'à l'arrêt Flagey »
        g('Marche après la descente', state('scan', base, { id: 'walk:scan', since: now, until: now + 3 * MIN, kind: 'walk', leg: 2, walkMin: 2, toward: N(name), final: false, vehicle: { op: 'stib', mode: 'tram', line: '3' }, depAt: now + 34 * MIN, rt: true } as Moment, { kind: 'walk', leg: 2 }), 'moment', /^2 min à pied jusqu’/);
      } catch (e) {
        err(`${name} : ${(e as Error).message}`);
      }
    }

    const report = [
      `Balayage des noms ajoutés (1.3.1, ${meta.serviceDates[0]}) : ${list.length} noms (150 px et plus, ou avec une apostrophe droite), ${tally.views} pages, ${tally.rows} rangées qui les nomment, ${Math.round((Date.now() - t0) / 1000)} s.`,
      `Rangées coupées : ${tally.cut} ; au milieu d'un mot (0 exigé) : ${tally.mid} ; coupées deux fois, « …… » (0 exigé) : ${tally.double} ; nom disparu (0 exigé) : ${tally.gone}.${tally.samples.length ? ` Ex. : ${tally.samples.join(' | ')}` : ''}`,
      `Premier mot du nom seul trop long pour la place (coupé au caractère faute d'autre issue, compté à part comme en 1.3.0) : ${tally.first}.${tally.firstSamples.length ? ` Ex. : ${tally.firstSamples.join(' | ')}` : ''}`,
      `Rangées affichées avec une apostrophe droite (0 exigé) : ${tally.straight}.${tally.straightSamples.length ? ` Ex. : ${tally.straightSamples.join(' | ')}` : ''}`,
      `Rangées attendues absentes (la nouveauté manque : rien de mesuré là) : ${missing.size ? [...missing].map(([l, n]) => `${l} (${n} noms)`).join(', ') : 'aucune'}.`,
      errors.length ? `Erreurs :\n  ${errors.join('\n  ')}` : 'Aucune erreur.',
    ];
    process.stdout.write(`\n${report.join('\n')}\n`);
    expect(list.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(tally.mid).toBe(0);
    expect(tally.double).toBe(0);
    expect(tally.gone).toBe(0);
    expect(tally.straight).toBe(0);
    expect([...missing.keys()]).toEqual([]);
  }, 1_800_000);
});
