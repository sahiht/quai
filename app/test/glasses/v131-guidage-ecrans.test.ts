/**
 * Quai 1.3.1, écrans du guidage (docs/v1.3.1/PRD-1.3.1.md § 1 à § 4 et § 12 ; notes des experts E1, L1 à L4, U3, U4, U6,
 * P4, P6, P7, I1, I5) : les trois petits points de l'écran calme et, à bord, la ligne de progression à leur place ;
 * « masquer » ; « Où tu en es » avec les mots du § 12 ; le nom de l'arrêt où l'on marche ; « très juste » seulement quand
 * le moteur le dit ; « Tram 3 dans ~1 min », « À gauche dans 30 m », « IC 07:42 +2 » ; « Si tu le rates » au moment de
 * monter ; la marche après la descente ; deux virages ensemble ; « pluie prévue » ; « Quai suit l'horaire ». Par les
 * vraies vues et la vraie mise en page, au pixel, sur des états construits et sur de vrais états du moteur.
 * Lieux publics seulement (gares, arrêts, places).
 */
import { describe, expect, it } from 'vitest';
import type { Journey, KV, Stopover } from '../../src/core/api';
import type { GuideState, Moment, VehicleRef, WhereAmI } from '../../src/core/guide-types';
import { createJournal, JOURNAL_KEY, JOURNAL_MOMENT_WORDS } from '../../src/core/journal';
import { textWidth } from '../../src/glasses/font';
import { HINTS, alightWords, progressLine } from '../../src/glasses/format';
import { GUIDE_MENU, GUIDE_TEXT, checkLines, fitWhere, guideTitleText, guideView, thenText, untilLine, walkToStopText, type GuideShow } from '../../src/glasses/guide-views';
import { GUIDE, LAYOUTS, shapeKey } from '../../src/glasses/layout';
import type { ContainerSpec, GlassesView, PageSpec } from '../../src/glasses/types';
import type { ViewCtx } from '../../src/glasses/views';
import * as G from '../core/guide-fixtures';
import { MIN, PLACES, at, container, journey, nb, overflowing, page, rowsOf, settingsWith } from './helpers';

const DAY = '2026-11-20';
const T = (hh: number, mm: number, ss = 0) => at(DAY, hh, mm, ss);
const NOW = T(7, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([PLACES.bureau]), ...patch });

const BUS71: VehicleRef = { op: 'stib', mode: 'bus', line: '71' };
const TRAM3: VehicleRef = { op: 'stib', mode: 'tram', line: '3' };
const METRO2: VehicleRef = { op: 'stib', mode: 'metro', line: '2' };
const IC: VehicleRef = { op: 'sncb', mode: 'train', line: 'IC', cat: 'IC' };

const stops = (list: [string, number][]): Stopover[] => list.map(([name, t]) => ({ name: N(name), sched: t, est: t, lat: 50.84, lon: 4.36 }));

/** À pied jusqu'à l'arrêt Flagey, bus 71 jusqu'à Gare Centrale (arrêts connus), à pied, IC voie 5, à pied, tram 3, à pied. */
function bxl(): Journey {
  const j = journey('j131', [
    { walk: 7, to: 'Flagey' },
    { ride: '71', mode: 'bus', dep: T(7, 12), arr: T(7, 26), from: 'Flagey', to: 'Gare Centrale', head: 'De Brouckère' },
    { walk: 3, to: 'Bruxelles-Central' },
    { ride: 'IC', mode: 'train', dep: T(7, 35), arr: T(7, 40), from: 'Bruxelles-Central', to: 'Bruxelles-Nord', platform: '5' },
    { walk: 2, to: 'Gare du Nord' },
    { ride: '3', mode: 'tram', dep: T(7, 44), arr: T(7, 52), from: 'Gare du Nord', to: 'Churchill', head: 'Churchill' },
    { walk: 4 },
  ]);
  j.legs[1].stops = stops([['Flagey', T(7, 12)], ['Porte de Namur', T(7, 21)], ['Gare Centrale', T(7, 26)]]);
  return j;
}
const J = bxl();

/** À pied jusqu'à la gare de Namur, IC voie 6 jusqu'à Bruxelles-Nord (six gares connues), à pied jusqu'à la place Fontainas. */
const NAMUR_IC = (): Journey => {
  const j = journey('jn', [
    { walk: 9, to: 'Namur' },
    { ride: 'IC', mode: 'train', dep: T(7, 42), arr: T(8, 42), from: 'Namur', to: 'Bruxelles-Nord', platform: '6', head: 'Bruxelles-Midi' },
    { walk: 16 },
  ]);
  j.legs[1].stops = stops([
    ['Namur', T(7, 42)],
    ['Gembloux', T(7, 58)],
    ['Ottignies', T(8, 11)],
    ['Bruxelles-Luxembourg', T(8, 30)],
    ['Bruxelles-Central', T(8, 38)],
    ['Bruxelles-Nord', T(8, 42)],
  ]);
  return j;
};
const JN = NAMUR_IC();

const CHAIN: WhereAmI['chain'] = [
  { label: 'à pied', state: 'now' },
  { label: 'bus 71', state: 'next' },
  { label: 'IC', state: 'next' },
  { label: 'tram 3', state: 'next' },
];
const WHERE: WhereAmI = {
  title: 'Bureau',
  arr: T(7, 56),
  rt: true,
  chain: CHAIN,
  walk: { toward: N('Flagey'), toKind: 'stop', remainingM: 520, remainingMin: 7, vehicle: BUS71, depAt: T(7, 12), rt: true, marginMin: 1 },
};
/** Le train de Namur à bord : six gares, la prochaine Ottignies, descente à Bruxelles-Nord. */
const IC_RIDE: NonNullable<WhereAmI['ride']> = {
  vehicle: IC, head: N('Bruxelles-Midi'), total: 6, next: 2, nextStop: N('Ottignies'), nextAt: T(8, 11), alight: N('Bruxelles-Nord'), alightAt: T(8, 42), stopsToAlight: 4, rt: true,
};

function state(p: Partial<GuideState> = {}): GuideState {
  return { kind: 'trip', journeyId: 'j131', phase: { kind: 'walk', leg: 0 }, moment: null, where: WHERE, location: 'high', wakeAt: NOW + MIN, ended: false, ...p };
}
const onBoard = (p: Partial<GuideState> = {}, ride: Partial<NonNullable<WhereAmI['ride']>> = {}): GuideState =>
  state({ journeyId: 'jn', phase: { kind: 'ride', leg: 1, next: ride.next ?? 2 }, where: { title: 'Place Fontainas', arr: T(8, 58), rt: false, chain: [{ label: 'à pied', state: 'done' }, { label: 'IC', state: 'now' }], ride: { ...IC_RIDE, ...ride } }, ...p });

const base = { since: NOW, until: NOW + 120_000, leg: 0 };
const leave = (p: Partial<Extract<Moment, { kind: 'leave' }>> = {}): Moment => ({ ...base, id: 'leave:j131', kind: 'leave', walkMin: 7, toward: N('Flagey'), vehicle: BUS71, depAt: T(7, 12), rt: true, marginMin: 3, ...p });
const turn = (p: Partial<Extract<Moment, { kind: 'turn' }>> = {}): Moment => ({ ...base, id: 'turn:j131:0:1', kind: 'turn', turn: 'left', distM: 30, toward: N('Flagey'), final: false, ...p });
const board = (p: Partial<Extract<Moment, { kind: 'board' }>> = {}): Moment => ({
  ...base, leg: 5, id: 'board:j131:5', kind: 'board', vehicle: TRAM3, head: N('Churchill'), depAt: NOW + 40_000, rt: false, alight: N('Churchill'), stopsToAlight: 6, ...p,
});
const alight = (then: Extract<Moment, { kind: 'alight' }>['then'], p: Partial<Extract<Moment, { kind: 'alight' }>> = {}): Moment => ({ ...base, leg: 1, id: 'alight:j131:1', kind: 'alight', stop: N('Gare Centrale'), at: T(7, 26), rt: true, then, ...p });
const walkM = (p: Partial<Extract<Moment, { kind: 'walk' }>> = {}): Moment => ({ ...base, leg: 4, id: 'walk:j131:4', kind: 'walk', walkMin: 3, toward: N('Gare Centrale'), final: false, vehicle: BUS71, depAt: T(8, 34), rt: true, ...p });

const HINT = 'toucher : masquer   appui long : arrêter';

/** Vue et page d'un état, après contrôle : rien ne dépasse, jamais de tiret long ni moyen. */
function shown(s: GuideState, show: GuideShow = 'moment', j: Journey = J, c: ViewCtx = ctx()): { v: GlassesView; p: PageSpec; lines: string[] } {
  const v = guideView(s, show, j, c);
  const p = page(v);
  const bad = overflowing(p);
  if (bad.length) throw new Error(bad.join('\n'));
  for (const l of [p.title, ...p.lines]) expect(l).not.toMatch(/[–—]/);
  return { v, p, lines: p.lines.map(nb) };
}
const moment = (m: Moment, s: Partial<GuideState> = {}, j: Journey = J, c: ViewCtx = ctx()) => shown(state({ moment: m, ...s }), 'moment', j, c);
const where = (s: GuideState, j: Journey = J, c: ViewCtx = ctx()) => shown(s, 'where', j, c);
const calm = (s: GuideState, j: Journey = J, c: ViewCtx = ctx()) => shown(s, 'empty', j, c);
const levels = (p: PageSpec) => ({ hi: rowsOf(container(p, 'colA')), norm: rowsOf(container(p, 'colB')), pale: rowsOf(container(p, 'colC')) });

/** Le pied d'une page : son texte (sans les espaces de tête), le milieu de ce texte sur l'écran (px), son conteneur. */
function footOf(p: PageSpec): { text: string; mid: number; c: ContainerSpec } {
  const c = container(p, 'foot');
  const lead = /^[  ]*/.exec(c.content)![0];
  const text = c.content.slice(lead.length);
  return { text: nb(text), mid: c.x + textWidth(lead) + textWidth(text) / 2, c };
}

/* ------------------------------ § 1, B9 : l'écran calme ------------------------------ */

describe('PRD-1.3.1 § 1, B9 (E1) : trois petits points sur l’écran calme, la progression à bord', () => {
  it('« · · · » au pied, en bas au centre, au plus pâle ; ni titre, ni heure, ni texte, ni image ; à pied, à l’arrêt, avant de partir', () => {
    const states = [
      state(),
      state({ phase: { kind: 'before', leg: 0 } }),
      state({ phase: { kind: 'wait', leg: 1 }, where: { ...WHERE, walk: undefined, wait: { stop: N('Flagey'), vehicle: BUS71, head: N('De Brouckère'), depAt: T(7, 12), rt: true } } }),
    ];
    for (const s of states) {
      const { v, p, lines } = calm(s);
      expect(v).toMatchObject({ screen: 'guide', layout: 'guide', title: '', clock: '', items: [], tap: { kind: 'guideTap' } });
      expect(v.images).toBeUndefined();
      expect(lines).toEqual(['· · ·']);
      expect(p.title).toBe('');
      for (const c of p.containers) if (c.name !== 'foot') expect(c.content.trim(), c.name).toBe('');
      const f = footOf(p);
      expect(f.text).toBe(GUIDE_TEXT.dots);
      // en bas : la dernière rangée de l'écran ; au centre : le milieu de l'écran (288 px), à une espace près
      expect(f.c.y + f.c.h).toBe(288 - 3);
      expect(Math.abs(f.mid - 288)).toBeLessThanOrEqual(3);
      // au plus pâle : le niveau des textes pâles du guidage, aucun conteneur de la page plus pâle
      expect(f.c.level).toBe(LAYOUTS.guide.c.level);
      expect(Math.min(...p.containers.map((c) => c.level))).toBe(f.c.level);
      // le menu de l'appui long reste (sa liste est celle du guidage)
      expect(p.menu).toEqual(GUIDE_MENU);
    }
  });

  it('aussi sans les aides des gestes (ce n’est pas une aide) et dans Quai Web', () => {
    const off = ctx();
    off.settings.display.gestureHints = false;
    expect(calm(state(), J, off).lines).toEqual(['· · ·']);
    expect(calm(state(), J, ctx({ web: true })).lines).toEqual(['· · ·']);
  });

  it('à bord, arrêts connus : la progression à leur place (même place, même niveau, même forme de page : rien à reconstruire)', () => {
    const dots = calm(state());
    const ride = calm(onBoard(), JN);
    const f = footOf(ride.p);
    expect(f.text).toBe('●─●─◎─○─○─○   descente dans 4 arrêts');
    // E1 : 436 px pour six arrêts
    expect(textWidth(f.text)).toBe(436);
    expect(Math.abs(f.mid - 288)).toBeLessThanOrEqual(3);
    expect(f.c).toMatchObject({ x: footOf(dots.p).c.x, y: footOf(dots.p).c.y, h: footOf(dots.p).c.h, level: footOf(dots.p).c.level });
    expect(shapeKey(ride.p)).toBe(shapeKey(dots.p));
    expect(ride.v).toMatchObject({ title: '', clock: '', items: [] });
    // le bus 71 (trois arrêts connus) : « ●─◎─○   descente dans 2 arrêts »
    expect(footOf(calm(state({ phase: { kind: 'ride', leg: 1, next: 1 }, where: { ...WHERE, walk: undefined, ride: { vehicle: BUS71, total: 3, next: 1, nextStop: N('Porte de Namur'), nextAt: T(7, 21), alight: N('Gare Centrale'), alightAt: T(7, 26), stopsToAlight: 2, rt: true } } })).p).text).toBe(
      '●─◎─○   descente dans 2 arrêts',
    );
  });

  it('« Descends au prochain arrêt » masqué : « descente au prochain arrêt » ; arrêts inconnus : les points', () => {
    const last = calm(onBoard({}, { next: 5, nextStop: N('Bruxelles-Nord'), nextAt: T(8, 42), stopsToAlight: 1 }), JN);
    expect(footOf(last.p).text).toBe('●─●─●─●─●─◎   descente au prochain arrêt');
    // le même train sans la liste de ses gares (le moteur n'en a que deux, la montée et la descente) : les points
    const unknown = NAMUR_IC();
    delete unknown.legs[1].stops;
    expect(calm(onBoard({}, { total: 2, next: 1, stopsToAlight: 1 }), unknown).lines).toEqual(['· · ·']);
  });

  it('rien ne change d’une minute à l’autre (aucun envoi pour eux) ; la progression change seulement au passage d’un arrêt', () => {
    const at1 = calm(onBoard(), JN, ctx({ now: T(8, 0) })).p;
    const at2 = calm(onBoard(), JN, ctx({ now: T(8, 6) })).p;
    expect(at2.containers).toEqual(at1.containers);
    expect(calm(state(), J, ctx({ now: T(7, 1) })).p.containers).toEqual(calm(state(), J, ctx({ now: T(7, 9) })).p.containers);
    // Ottignies passé : un arrêt de moins, même forme de page
    const next = calm(onBoard({}, { next: 3, nextStop: N('Bruxelles-Luxembourg'), nextAt: T(8, 30), stopsToAlight: 3 }), JN, ctx({ now: T(8, 12) })).p;
    expect(footOf(next).text).toBe('●─●─●─◎─○─○   descente dans 3 arrêts');
    expect(shapeKey(next)).toBe(shapeKey(at1));
  });

  it('un moment ou « Où tu en es » prend toute la place : pas de points ; quand il est masqué ou fini, les points reviennent', () => {
    const m = shown(state({ moment: turn() }), 'moment');
    const w = where(state());
    for (const l of [...m.lines, ...w.lines]) expect(l).not.toMatch(/· · ·|^●─/);
    expect(m.lines.at(-1)).toBe(HINT);
    expect(w.lines.at(-1)).toBe(HINT);
    // le moteur n'a plus de moment (fini) : la page calme, avec ses points
    expect(shown(state({ moment: null }), 'moment').lines).toEqual(['· · ·']);
  });

  it('au pixel : chaque progression tient sur sa rangée et reste centrée (2 à 60 arrêts, chaque arrêt suivant)', () => {
    for (let total = 2; total <= 60; total++) {
      const j = NAMUR_IC();
      j.legs[1].stops = Array.from({ length: total }, (_, i) => ({ name: N(i % 2 ? 'Ottignies' : 'Gembloux'), sched: T(7, 42) + i * MIN, est: T(7, 42) + i * MIN }));
      for (let next = 1; next < total; next++) {
        const { p } = calm(onBoard({}, { total, next, stopsToAlight: total - next }), j);
        const f = footOf(p);
        expect(f.text).toBe(`${progressLine(total, next)}   ${alightWords(total - next)}`);
        expect(textWidth(f.c.content)).toBeLessThanOrEqual(GUIDE.FULL_W);
        expect(Math.abs(f.mid - 288), `${total} ${next}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

/* ------------------------------ § 2 : masquer ------------------------------ */

describe('PRD-1.3.1 § 2 : « masquer » au lieu de « effacer »', () => {
  it('aide des moments et de « Où tu en es » : « toucher : masquer   appui long : arrêter », insécables devant « : »', () => {
    expect(HINTS.guide).toBe('toucher : masquer   appui long : arrêter');
    expect(moment(leave()).lines.at(-1)).toBe(HINT);
    expect(where(state()).lines.at(-1)).toBe(HINT);
    for (const l of [...moment(leave()).lines, ...where(state()).lines]) expect(l).not.toMatch(/effac/);
  });

  it('journal : « masqué d’un toucher » ; la marche après la descente se dit « À pied »', async () => {
    const data = new Map<string, string>();
    const kv: KV = { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
    const j = await createJournal(kv);
    const t0 = Date.UTC(2026, 10, 20, 7, 0, 0);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: t0 });
    j.add(id, { t: t0 + 1_000, k: 'moment', d: { m: 'leave', id: 'leave:j131' } });
    j.add(id, { t: t0 + 9_000, k: 'clear', d: { m: 'leave' } });
    j.add(id, { t: t0 + 60_000, k: 'moment', d: { m: 'walk', id: 'walk:j131:4' } });
    const text = j.text(id);
    expect(text).toContain('08:00:09 Partir maintenant masqué d’un toucher');
    expect(text).toContain('08:01:00 À pied affiché');
    expect(text).not.toMatch(/effac/);
    expect(JOURNAL_MOMENT_WORDS.walk).toBe('À pied');
    expect(JOURNAL_KEY).toBeTruthy();
  });
});

/* ------------------------------ § 3, § 12 : Où tu en es ------------------------------ */

describe('PRD-1.3.1 § 3 et § 12 (L1, E1) : « Où tu en es »', () => {
  it('avant de partir : « Ensuite : partir à 07:33 », « 9 min à pied jusqu’à la gare de Namur », le train et sa voie, la chaîne, l’arrivée', () => {
    const s = state({
      journeyId: 'jn',
      phase: { kind: 'before', leg: 0 },
      where: { title: 'Place Fontainas', arr: T(8, 58), rt: true, chain: [{ label: 'à pied', state: 'now' }, { label: 'IC', state: 'next' }], walk: { toward: N('Namur'), toKind: 'station', remainingMin: 9, vehicle: IC, depAt: T(7, 42), rt: true } },
    });
    const { v, p, lines } = where(s, JN);
    expect(nb(p.title)).toBe('Guidage en cours');
    expect(v.clock).toBe('07:00');
    expect(lines).toEqual(['Jusqu’à la place Fontainas', 'Ensuite : partir à 07:33', '9 min à pied jusqu’à la gare de Namur', 'IC à 07:42, voie 6', '◎ à pied ─ ○ IC', 'arrivée 08:58', HINT]);
    const lv = levels(p);
    // le prochain geste et son heure au plus clair, juste sous la destination
    expect(lv.hi[1]).toBe('Ensuite : partir à 07:33');
    expect(lv.norm[0]).toBe('Jusqu’à la place Fontainas');
    // vers un arrêt : son nom
    expect(where(state({ phase: { kind: 'before', leg: 0 }, where: { ...WHERE, walk: { ...WHERE.walk!, remainingM: undefined } } })).lines.slice(0, 4)).toEqual([
      'Jusqu’au bureau',
      'Ensuite : partir à 07:05',
      '7 min à pied jusqu’à l’arrêt Flagey',
      'bus 71 à 07:12',
    ]);
  });

  it('en marchant : « Ensuite : bus 71 à 07:12 », « À pied vers l’arrêt Flagey » ; train : « vers la voie 5 » ; dernière marche : « Ensuite : arrivée ~07:56 »', () => {
    expect(where(state()).lines).toEqual(['Jusqu’au bureau', 'Ensuite : bus 71 à 07:12', 'À pied vers l’arrêt Flagey', '520 m, 7 min', '◎ à pied ─ ○ bus 71 ─ ○ IC ─ ○ tram 3', 'arrivée 07:56', HINT]);
    const platform = where(state({ phase: { kind: 'walk', leg: 2 }, where: { ...WHERE, walk: { toward: N('Bruxelles-Central'), toKind: 'platform', remainingM: 180, remainingMin: 3, vehicle: IC, depAt: T(7, 35), rt: true } } }));
    expect(platform.lines.slice(1, 4)).toEqual(['Ensuite : IC à 07:35', 'À pied vers la voie 5', '180 m, 3 min']);
    const last = where(state({ phase: { kind: 'walk', leg: 6 }, where: { ...WHERE, rt: false, walk: { toward: N('Bureau'), toKind: 'dest', remainingM: 300, remainingMin: 4 } } }));
    expect(last.lines).toEqual(['Jusqu’au bureau', 'Ensuite : arrivée ~07:56', 'À pied, 300 m, 4 min', '◎ à pied ─ ○ bus 71 ─ ○ IC ─ ○ tram 3', HINT]);
  });

  it('à l’arrêt : l’heure, jamais « dans ~1 min » ; I1 (A3) : l’heure passée sans temps réel, « Si tu le rates : … » pâle', () => {
    const bus = where(state({ phase: { kind: 'wait', leg: 1 }, where: { ...WHERE, walk: undefined, wait: { stop: N('Flagey'), vehicle: BUS71, head: N('De Brouckère'), depAt: T(7, 1), rt: false } } }));
    expect(bus.lines).toEqual(['Jusqu’au bureau', 'Ensuite : bus 71 à ~07:01', 'À l’arrêt Flagey', 'vers De Brouckère', '◎ à pied ─ ○ bus 71 ─ ○ IC ─ ○ tram 3', 'arrivée 07:56', HINT]);
    const late = where(
      state({ journeyId: 'jn', phase: { kind: 'wait', leg: 1 }, where: { title: 'Place Fontainas', arr: T(8, 58), rt: false, chain: [{ label: 'à pied', state: 'done' }, { label: 'IC', state: 'now' }], wait: { stop: N('Namur'), vehicle: IC, head: N('Bruxelles-Midi'), depAt: T(7, 42), rt: false, platform: '6', missed: { arr: T(9, 57), laterMin: 59 } } } }),
      JN,
      ctx({ now: T(7, 50) }),
    );
    expect(late.lines).toEqual(['Jusqu’à la place Fontainas', 'Ensuite : IC à ~07:42, voie 6', 'À la gare de Namur', 'vers Bruxelles-Midi', 'Si tu le rates : arrivée 09:57, 59 min plus tard', '● à pied ─ ◎ IC', 'arrivée ~08:58', HINT]);
    expect(levels(late.p).pale[4]).toBe('Si tu le rates : arrivée 09:57, 59 min plus tard');
    for (const l of [...bus.lines, ...late.lines]) expect(l).not.toMatch(/dans ~?\d|imminent/);
  });

  it('à bord : « Ensuite : descente à Bruxelles-Nord, 08:42 », la progression, « Prochain arrêt : Ottignies, 08:11 », la chaîne, l’arrivée, dans cet ordre', () => {
    const { p, lines } = where(onBoard(), JN);
    expect(lines).toEqual(['Jusqu’à la place Fontainas', 'Ensuite : descente à Bruxelles-Nord, 08:42', '●─●─◎─○─○─○ descente dans 4 arrêts', 'Prochain arrêt : Ottignies, 08:11', '● à pied ─ ◎ IC', 'arrivée ~08:58', HINT]);
    const lv = levels(p);
    expect(lv.hi[1]).toBe('Ensuite : descente à Bruxelles-Nord, 08:42');
    expect(lv.norm[3]).toBe('Prochain arrêt : Ottignies, 08:11');
    // la rangée « descente : X, HH:MM » de la 1.2.10 est retirée (E1), la descente dite une fois
    expect(lines.filter((l) => l.includes('Bruxelles-Nord'))).toHaveLength(1);
  });

  it('« j’y descends » : « Jusqu’à Bruxelles-Nord », « Quai te dit quand descendre », sans chaîne ; à bord, ni arrivée ni second nom ; titre des moments « Jusqu’à … »', () => {
    const ride = (p: Partial<GuideState>) => state({ kind: 'ride', journeyId: 'jn', where: { title: 'Vers Bruxelles-Nord', arr: T(8, 42), rt: true, chain: [{ label: 'IC', state: 'now' }] }, ...p });
    const board1 = where(ride({ phase: { kind: 'ride', leg: 1, next: 2 }, where: { title: 'Vers Bruxelles-Nord', arr: T(8, 42), rt: true, chain: [{ label: 'IC', state: 'now' }], ride: IC_RIDE } }), JN);
    expect(board1.lines).toEqual(['Jusqu’à Bruxelles-Nord', 'Ensuite : descente à 08:42', '●─●─◎─○─○─○ descente dans 4 arrêts', 'Prochain arrêt : Ottignies, 08:11', 'Quai te dit quand descendre', HINT]);
    expect(levels(board1.p).pale[4]).toBe('Quai te dit quand descendre');
    const wait = where(ride({ phase: { kind: 'wait', leg: 1 }, where: { title: 'Vers Bruxelles-Nord', arr: T(8, 42), rt: true, chain: [{ label: 'IC', state: 'now' }], wait: { stop: N('Namur'), vehicle: IC, head: N('Bruxelles-Midi'), depAt: T(7, 42), rt: true, platform: '6' } } }), JN);
    expect(wait.lines).toEqual(['Jusqu’à Bruxelles-Nord', 'Ensuite : IC à 07:42, voie 6', 'À la gare de Namur', 'vers Bruxelles-Midi', 'Quai te dit quand descendre', 'arrivée 08:42', HINT]);
    // titre des moments : « Jusqu’à … » (le contrôleur peut le donner tout fait : même résultat)
    const al = alight({ kind: 'none' }, { stop: N('Bruxelles-Nord'), at: T(8, 42) });
    expect(nb(shown(ride({ moment: al }), 'moment', JN).p.title)).toBe('Jusqu’à Bruxelles-Nord');
    expect(guideTitleText('Vers Bruxelles-Nord', 'ride')).toBe('Jusqu’à Bruxelles-Nord');
    expect(guideTitleText('Jusqu’à Bruxelles-Nord', 'ride')).toBe('Jusqu’à Bruxelles-Nord');
    expect(guideTitleText('Bureau', 'trip')).toBe('Bureau');
    // « Tu y es » garde le nom de l'arrêt, que le titre dise « Vers … » ou « Jusqu’à … »
    const done: Moment = { ...base, id: 'arrived:jn', kind: 'arrived', title: 'Jusqu’à Bruxelles-Nord', at: T(8, 42), diffMin: 0 };
    expect(shown(ride({ moment: done, where: { title: 'Jusqu’à Bruxelles-Nord', arr: T(8, 42), rt: true, chain: [] } }), 'moment', JN).lines[1]).toBe('Bruxelles-Nord, 08:42, à l’heure');
  });

  it('la destination : « Jusqu’au bureau », « Jusqu’à la place Fontainas », « Jusqu’à Bruxelles-Central », « Jusqu’à la maison »', () => {
    expect(untilLine('Bureau')).toBe('Jusqu’au bureau');
    expect(untilLine('Place Fontainas')).toBe('Jusqu’à la place Fontainas');
    expect(untilLine('Vers Bruxelles-Central')).toBe('Jusqu’à Bruxelles-Central');
    expect(untilLine('Vers la maison')).toBe('Jusqu’à la maison');
    expect(untilLine('Gare de Namur')).toBe('Jusqu’à la gare de Namur');
  });

  it('chaque chose une seule fois : un seul « Ensuite », jamais de marge ni « Prochain : », aucune rangée répétée', () => {
    const screens = [
      where(state()).lines,
      where(state({ phase: { kind: 'before', leg: 0 } })).lines,
      where(onBoard(), JN).lines,
      where(onBoard({}, { next: 5, nextStop: N('Bruxelles-Nord'), nextAt: T(8, 42), stopsToAlight: 1 }), JN).lines,
      where(state({ phase: { kind: 'wait', leg: 1 }, where: { ...WHERE, walk: undefined, wait: { stop: N('Flagey'), vehicle: BUS71, head: N('De Brouckère'), depAt: T(7, 12), rt: true } } })).lines,
    ];
    for (const lines of screens) {
      expect(lines.filter((l) => l.startsWith('Ensuite : ')), lines.join(' | ')).toHaveLength(1);
      expect(new Set(lines).size).toBe(lines.length);
      for (const l of lines) expect(l).not.toMatch(/marge|^Prochain : |^descente : |c’est ta descente/);
    }
    // le prochain arrêt est la descente : son nom une seule fois, pas de « Prochain arrêt »
    expect(screens[3].filter((l) => l.includes('Bruxelles-Nord'))).toHaveLength(1);
    expect(screens[3].some((l) => l.startsWith('Prochain arrêt'))).toBe(false);
  });

  it('ce qui ne tient pas s’efface dans cet ordre : l’arrivée, puis la chaîne, puis l’arrêt suivant ; la progression jamais', () => {
    const rows = [{ k: 'jusqu' }, { k: 'ensuite' }, { k: 'progression' }, { k: 'arrêt suivant', drop: 3 }, { k: 'chaîne', drop: 2 }, { k: 'arrivée', drop: 1 }];
    const keys = (max: number) => fitWhere(rows, max).map((r) => r.k);
    expect(keys(8)).toEqual(['jusqu', 'ensuite', 'progression', 'arrêt suivant', 'chaîne', 'arrivée']);
    expect(keys(5)).toEqual(['jusqu', 'ensuite', 'progression', 'arrêt suivant', 'chaîne']);
    expect(keys(4)).toEqual(['jusqu', 'ensuite', 'progression', 'arrêt suivant']);
    expect(keys(3)).toEqual(['jusqu', 'ensuite', 'progression']);
    // l'ordre d'effacement ne dépend pas de la place : une arrivée dite plus haut part quand même la première
    expect(fitWhere([{ k: 'arrivée', drop: 1 }, { k: 'progression' }, { k: 'chaîne', drop: 2 }], 2).map((r) => r.k)).toEqual(['progression', 'chaîne']);
  });
});

/* ------------------------------ § 4 : le nom de l'arrêt ------------------------------ */

describe('PRD-1.3.1 § 4 et § 12 (U3, L2) : le nom de l’arrêt où l’on marche', () => {
  it('virage sans rue : « vers l’arrêt Flagey » ; sans nom connu : « vers l’arrêt du bus 71 » ; train : la voie', () => {
    expect(moment(turn()).lines).toEqual(['À gauche dans 30 m', 'vers l’arrêt Flagey', HINT]);
    const noName = bxl();
    noName.legs[1].from.name = N('');
    expect(moment(turn({ toward: N('') }), {}, noName).lines[1]).toBe('vers l’arrêt du bus 71');
    expect(moment(turn({ leg: 2, toward: N('Bruxelles-Central') })).lines[1]).toBe('vers la voie 5');
    expect(moment(turn({ leg: 6, final: true, toward: N('Bureau') })).lines[1]).toBe('vers le bureau');
  });

  it('« Descends » : « ensuite : 7 min à pied → Flagey » ; sans marche, le véhicule et son heure', () => {
    const al = moment(alight({ kind: 'ride', vehicle: BUS71, depAt: T(7, 40), rt: true, walkMin: 7, from: N('Flagey') }));
    expect(al.lines).toEqual(['Descends au prochain arrêt', 'Gare Centrale, 07:26', 'ensuite : 7 min à pied → Flagey', HINT]);
    expect(levels(al.p).pale[2]).toBe('ensuite : 7 min à pied → Flagey');
    expect(moment(alight({ kind: 'ride', vehicle: TRAM3, depAt: T(7, 44), rt: true, walkMin: 0, from: N('Gare du Nord') })).lines[2]).toBe('ensuite : tram 3 à 07:44');
    expect(moment(alight({ kind: 'ride', vehicle: IC, depAt: T(7, 35), rt: true, platform: '5', walkMin: 0, from: N('Bruxelles-Central') })).lines[2]).toBe('ensuite : voie 5, IC à 07:35');
    // l'arrêt inconnu (moteur d'avant) : comme en 1.2.10
    expect(moment(alight({ kind: 'ride', vehicle: BUS71, depAt: T(7, 40), rt: true, walkMin: 7 })).lines[2]).toBe('ensuite : bus 71 à 07:40');
    expect(nb(thenText({ kind: 'walk', min: 5, toward: N('Bureau'), last: true }, ctx()))).toBe('ensuite : 5 min à pied');
  });

  it('« monter » d’une correspondance : « 2 min à pied → Gare du Nord, très juste » si le nom tient (coupé au mot), sinon « jusqu’à l’arrêt » ; la fin jamais coupée', () => {
    const corr = moment(board({ walkMin: 2, marginMin: 0, stop: N('Gare du Nord') }));
    expect(corr.lines).toEqual(['Tram 3 dans ~1 min', 'vers Churchill', '2 min à pied → Gare du Nord, très juste', HINT]);
    expect(levels(corr.p).pale[2]).toBe('2 min à pied → Gare du Nord, très juste');
    expect(moment(board({ walkMin: 2, marginMin: 6, stop: N('Gare du Nord') })).lines[2]).toBe('2 min à pied → Gare du Nord, marge 6 min');
    expect(moment(board({ vehicle: IC, depAt: T(7, 35), rt: true, platform: '3', head: N('Bruxelles-Midi'), walkMin: 3, marginMin: 4, stop: N('Namur') })).lines[2]).toBe('3 min à pied → Namur, marge 4 min');
    // un nom qui ne tient pas : coupé au mot (ici après le trait d'union), la marge entière
    expect(moment(board({ vehicle: IC, depAt: T(7, 35), rt: true, platform: '5', head: N('Liège-Guillemins'), walkMin: 3, marginMin: 4, stop: N('Bruxelles-Central') })).lines[2]).toBe('3 min à pied → Bruxelles-…, marge 4 min');
    // sans nom : « jusqu’à l’arrêt » (bus, tram, métro), « jusqu’au quai » (train), comme en 1.2.10
    expect(moment(board({ walkMin: 2, marginMin: 0 })).lines[2]).toBe('2 min à pied jusqu’à l’arrêt, très juste');
    // le nom coupé au mot si la place manque, « , très juste » toujours entier ; sans place pour un mot : « jusqu’à l’arrêt »
    const head = textWidth('2 min à pied → ');
    const tail = textWidth(', très juste');
    expect(nb(walkToStopText(2, 'Gare du Nord', false, ', très juste', head + tail + textWidth('Gare du…') + 1))).toBe('2 min à pied → Gare du…, très juste');
    expect(nb(walkToStopText(2, 'Bruxelles-Aéroport-Zaventem', false, ', très juste', head + tail + 40))).toBe('2 min à pied jusqu’à l’arrêt, très juste');
    expect(nb(walkToStopText(3, 'Bruxelles-Aéroport-Zaventem', true, ', marge 4 min', head + textWidth(', marge 4 min') + 40))).toBe('3 min à pied jusqu’au quai, marge 4 min');
  });
});

/* ------------------------------ A4, B12, B13 ------------------------------ */

describe('A4 (P4), B12 (E5, L4), B13 (U6) : les mots des moments', () => {
  it('A4 : « très juste » au départ seulement quand le moteur le dit (`tight`), jamais d’après la marge arrondie', () => {
    expect(moment(leave({ marginMin: 1 })).lines[2]).toBe('bus 71 à 07:12');
    expect(moment(leave({ marginMin: -2 })).lines[2]).toBe('bus 71 à 07:12');
    expect(moment(leave({ marginMin: 1, tight: false })).lines[2]).toBe('bus 71 à 07:12');
    const tight = moment(leave({ marginMin: 1, tight: true, missed: { arr: T(8, 26), laterMin: 30 } }));
    // (« Si tu le rates » sans l'écart quand il ne tient pas à côté de l'image : règle 1.2.10)
    expect(tight.lines).toEqual(['Partir maintenant', '7 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:12, très juste', 'Si tu le rates : arrivée 08:26', HINT]);
  });

  it('B12 : « Tram 3 dans ~1 min », « Tram 3 à ~07:12 », « Tram 3 imminent » ; « À gauche dans 30 m » ; « Nouveau trajet : IC à 08:42, voie 5 »', () => {
    expect(moment(board()).lines[0]).toBe('Tram 3 dans ~1 min');
    expect(moment(board({ depAt: T(7, 12) })).lines[0]).toBe('Tram 3 à ~07:12');
    expect(moment(board({ depAt: NOW + 20_000, rt: true })).lines[0]).toBe('Tram 3 imminent');
    expect(moment(board({ vehicle: METRO2, depAt: NOW + 3 * MIN, rt: true })).lines[0]).toBe('Métro 2 dans 3 min');
    expect(moment(board({ vehicle: { op: 'sncb', mode: 'bus', line: 'BUS' }, depAt: NOW + 3 * MIN, rt: true })).lines[0]).toBe('Bus SNCB dans 3 min');
    const t = moment(turn());
    expect(t.lines[0]).toBe('À gauche dans 30 m');
    expect(levels(t.p).hi[0]).toBe('À gauche dans 30 m');
    expect(moment(turn({ turn: 'straight', distM: 60 })).lines[0]).toBe('Tout droit dans 60 m');
    const rp: Moment = { ...base, id: 'replan:j131', kind: 'replan', reason: 'missed', lost: { vehicle: IC, depAt: T(7, 42) }, next: { vehicle: IC, depAt: T(8, 42), platform: '5' }, arr: T(9, 57), laterMin: 59 };
    expect(moment(rp).lines).toEqual(['Ton IC de 07:42 est parti', 'Nouveau trajet : IC à 08:42, voie 5', 'arrivée 09:57, 59 min plus tard', HINT]);
    // A3 (I1) : sans temps réel, resté sur le quai, rien ne dit que le train est passé : le nouveau trajet d'abord
    const planned = moment({ ...rp, planned: true });
    expect(planned.lines).toEqual(['Nouveau trajet : IC à 08:42, voie 5', 'arrivée 09:57, 59 min plus tard', HINT]);
    expect(levels(planned.p).hi[0]).toBe('Nouveau trajet : IC à 08:42, voie 5');
  });

  it('B13 : un train en retard s’écrit « IC 07:42 +2 » partout dans le guidage ; un bus, jamais', () => {
    expect(moment(leave({ toward: N('Namur'), vehicle: IC, depAt: T(7, 44), sched: T(7, 42) }), {}, JN).lines[2]).toBe('IC 07:42 +2');
    const b = moment(board({ vehicle: IC, depAt: T(7, 44), sched: T(7, 42), rt: true, platform: '6', platformChanged: true, head: N('Bruxelles-Midi') }));
    expect(b.lines[0]).toBe('IC 07:42 +2, voie 6 !');
    expect(moment({ ...base, id: 'platform:jn:1:6', kind: 'platform', vehicle: IC, depAt: T(7, 44), sched: T(7, 42), platform: '6', was: '4' }).lines[1]).toBe('IC 07:42 +2, voie 6 au lieu de 4');
    expect(moment(alight({ kind: 'ride', vehicle: IC, depAt: T(7, 37), sched: T(7, 35), rt: true, platform: '5', walkMin: 0 })).lines[2]).toBe('ensuite : voie 5, IC 07:35 +2');
    expect(moment({ ...base, id: 'replan:jn', kind: 'replan', reason: 'cancelled', lost: { vehicle: IC, depAt: T(7, 42) }, next: { vehicle: IC, depAt: T(8, 45), sched: T(8, 42), platform: '5' }, arr: T(10, 0), laterMin: 62 }).lines[1]).toBe(
      'Nouveau trajet : IC 08:42 +3, voie 5',
    );
    expect(moment(walkM({ toward: N('Bruxelles-Central'), vehicle: IC, depAt: T(8, 45), sched: T(8, 42), platform: '5' })).lines[1]).toBe('IC 08:42 +3');
    const w = where(state({ phase: { kind: 'walk', leg: 2 }, where: { ...WHERE, walk: { toward: N('Bruxelles-Central'), toKind: 'platform', remainingM: 180, remainingMin: 3, vehicle: IC, depAt: T(7, 37), sched: T(7, 35), rt: true } } }));
    expect(w.lines[1]).toBe('Ensuite : IC 07:35 +2');
    const wt = where(state({ journeyId: 'jn', phase: { kind: 'wait', leg: 1 }, where: { ...WHERE, walk: undefined, wait: { stop: N('Namur'), vehicle: IC, head: N('Bruxelles-Midi'), depAt: T(7, 44), sched: T(7, 42), rt: true, platform: '6' } } }), JN);
    expect(wt.lines[1]).toBe('Ensuite : IC 07:42 +2, voie 6');
    // un bus en retard garde son heure estimée
    expect(moment(leave({ depAt: T(7, 14), sched: T(7, 12) })).lines[2]).toBe('bus 71 à 07:14');
  });
});

/* ------------------------------ B16 à B19, L3 ------------------------------ */

describe('B16 (U4), B17 (P7), B18 (P6), B19 (I5), L3', () => {
  it('B16 : « ensuite : tram 3 à ~08:44, très juste » ; au moment de monter, pâle « Si tu le rates : tram 3 à 08:51 » ; quatre rangées au plus', () => {
    const c = ctx({ now: T(8, 43) });
    const al = moment(alight({ kind: 'ride', vehicle: TRAM3, depAt: T(8, 44), rt: false, walkMin: 2, from: N('Gare du Nord'), tight: true }), {}, J, c);
    expect(al.lines[2]).toBe('ensuite : tram 3 à ~08:44, très juste');
    const b = moment(board({ depAt: T(8, 44) + 30_000, walkMin: 2, marginMin: 0, stop: N('Gare du Nord'), ifMissed: { vehicle: TRAM3, depAt: T(8, 51), rt: true } }), {}, J, c);
    expect(b.lines).toEqual(['Tram 3 dans ~1 min', 'vers Churchill', '2 min à pied → Gare du Nord, très juste', 'Si tu le rates : tram 3 à 08:51', HINT]);
    expect(levels(b.p).pale[3]).toBe('Si tu le rates : tram 3 à 08:51');
    const a = container(b.p, 'colA');
    expect(a.h).toBe(4 * 27);
    expect(a.y >= GUIDE.IMG_Y && a.y + a.h <= GUIDE.IMG_Y + GUIDE.IMG_H).toBe(true);
    // le suivant sans temps réel : « ~ » ; sans `ifMissed` : rien
    expect(moment(board({ ifMissed: { vehicle: TRAM3, depAt: T(7, 9), rt: false } })).lines.at(-2)).toBe('Si tu le rates : tram 3 à ~07:09');
    expect(moment(board()).lines.join('\n')).not.toMatch(/Si tu le rates/);
  });

  it('B17 : la marche après la descente, comme « Partir maintenant » : « 3 min à pied jusqu’à l’arrêt Gare Centrale », « bus 71 à 08:34 » ; dernière marche : l’arrivée', () => {
    const w = moment(walkM());
    expect(w.lines).toEqual(['3 min à pied jusqu’à l’arrêt Gare Centrale', 'bus 71 à 08:34', HINT]);
    expect(levels(w.p).hi[0]).toBe('3 min à pied jusqu’à l’arrêt Gare Centrale');
    expect(levels(w.p).norm[1]).toBe('bus 71 à 08:34');
    expect(w.v.images?.[0].image).toEqual({ kind: 'sign', label: 'à pied', value: '3', foot: 'min' });
    expect(w.v.log).toMatchObject({ show: 'moment', moment: { kind: 'walk', id: 'walk:j131:4' } });
    expect(moment(walkM({ walkMin: 13, toward: N('Bureau'), final: true, vehicle: undefined, depAt: undefined, arr: T(9, 1) })).lines).toEqual(['13 min à pied jusqu’au bureau', 'arrivée 09:01', HINT]);
    // un train : la voie (« Où tu en es » dit « À pied vers la voie 5 ») ; sans voie, la gare
    expect(moment(walkM({ toward: N('Bruxelles-Central'), vehicle: IC, depAt: T(8, 42), platform: '5' })).lines.slice(0, 2)).toEqual(['3 min à pied jusqu’à la voie 5', 'IC à 08:42']);
    expect(moment(walkM({ toward: N('Namur'), vehicle: IC, depAt: T(8, 42) })).lines[0]).toBe('3 min à pied jusqu’à la gare de Namur');
    expect(moment(walkM({ rt: false })).lines[1]).toBe('bus 71 à ~08:34');
  });

  it('B18 : deux virages proches annoncés ensemble : « À droite dans 40 m », « puis à gauche », la rue', () => {
    const t = moment(turn({ turn: 'right', distM: 40, then: 'left', street: 'Boulevard d’Avroy' }));
    expect(t.lines).toEqual(['À droite dans 40 m', 'puis à gauche', 'Boulevard d’Avroy', HINT]);
    expect(levels(t.p).hi[0]).toBe('À droite dans 40 m');
    expect(levels(t.p).norm[1]).toBe('puis à gauche');
    expect(levels(t.p).pale[2]).toBe('Boulevard d’Avroy');
    expect(t.v.images?.[0].image).toEqual({ kind: 'turn', turn: 'right' });
    expect(moment(turn({ then: 'slightRight' })).lines).toEqual(['À gauche dans 30 m', 'puis légèrement à droite', 'vers l’arrêt Flagey', HINT]);
  });

  it('B19 : « pluie prévue », 4e ligne pâle de « Partir maintenant », si la première marche se fait sous la pluie (5 min ou plus)', () => {
    const rainy = bxl();
    rainy.legs[0].rain = true;
    const r = moment(leave(), {}, rainy);
    expect(r.lines).toEqual(['Partir maintenant', '7 min à pied jusqu’à l’arrêt Flagey', 'bus 71 à 07:12', 'pluie prévue', HINT]);
    expect(levels(r.p).pale[3]).toBe('pluie prévue');
    expect(r.v.items).toHaveLength(4);
    // pas de pluie, ou une marche trop courte pour compter : rien
    expect(moment(leave()).lines).not.toContain('pluie prévue');
    const short = journey('js', [{ walk: 4, to: 'Flagey' }, { ride: '71', mode: 'bus', dep: T(7, 12), arr: T(7, 26), from: 'Flagey', to: 'Gare Centrale' }, { walk: 2 }]);
    short.legs[0].rain = true;
    expect(moment(leave({ walkMin: 4 }), {}, short).lines).not.toContain('pluie prévue');
    // très juste : « Si tu le rates » passe avant (quatre rangées au plus)
    expect(moment(leave({ tight: true, missed: { arr: T(8, 26), laterMin: 30 } }), {}, rainy).lines[3]).toBe('Si tu le rates : arrivée 08:26');
  });

  it('L3 : « Pas de position : Quai suit l’horaire », pâle « Quai suit l’horaire en attendant »', () => {
    expect(checkLines([{ kind: 'noPosition' }]).map(nb)).toEqual(['Pas de position : Quai suit l’horaire']);
    expect(textWidth(checkLines([{ kind: 'noPosition' }])[0])).toBeLessThanOrEqual(GUIDE.FULL_W);
    const lost = moment({ ...base, id: 'check:j131', kind: 'check', issues: [{ kind: 'positionLost', minutes: 3 }] });
    expect(lost.lines).toEqual(['Position perdue depuis 3 min', 'Quai suit l’horaire en attendant', HINT]);
    expect(levels(lost.p).pale[1]).toBe('Quai suit l’horaire en attendant');
    for (const l of [...lost.lines, ...checkLines([{ kind: 'noPosition' }, { kind: 'positionLost', minutes: 2 }])]) expect(l).not.toMatch(/guidage à l’heure/);
  });
});

/* ------------------------------ Vrais états du moteur ------------------------------ */

describe('sur de vrais états du moteur (trajet du PRD : Parc d’Avroy, bus 6, IC, bus 71, étangs d’Ixelles)', () => {
  const view = (s: GuideState, show: GuideShow, j: Journey, now: number) => shown(s, show, j, { now, settings: settingsWith([]) });

  it('minute par minute : points à pied et à l’arrêt, progression à bord ; la page calme ne change qu’au passage d’un arrêt', () => {
    const j = G.prdTrip();
    const r = G.guide(j);
    let prev: { key: string; containers: ContainerSpec[] } | null = null;
    const feet = new Map<string, string>();
    for (let t = G.at('06:58'); t <= G.at('08:50'); t += MIN) {
      const s = G.step(r, t);
      const { p } = view(s, 'empty', j, t);
      const f = footOf(p);
      expect(Math.abs(f.mid - 288)).toBeLessThanOrEqual(3);
      const key = s.phase.kind === 'ride' ? `ride:${s.phase.leg}:${s.phase.next}` : s.phase.kind === 'arrived' || s.phase.kind === 'ended' ? s.phase.kind : `${s.phase.kind}:${s.phase.leg}`;
      if (s.phase.kind !== 'ride') expect(f.text, `${key} ${new Date(t).toISOString()}`).toBe('· · ·');
      // même étape, même arrêt suivant : exactement la même page (rien à envoyer, ni l'heure ni le titre)
      if (prev && prev.key === key) expect(p.containers).toEqual(prev.containers);
      prev = { key, containers: p.containers };
      feet.set(key, f.text);
    }
    expect(feet.get('ride:3:2')).toBe('●─●─◎─○─○   descente dans 3 arrêts');
    expect(feet.get('ride:3:3')).toBe('●─●─●─◎─○   descente dans 2 arrêts');
    expect(feet.get('ride:1:1')).toBe('●─◎─○   descente dans 2 arrêts');
  });

  it('« Où tu en es » avant de partir et dans le train ; « ensuite : 3 min à pied → Gare Centrale » ; A4 au départ ; B13 à la gare', () => {
    const j = G.prdTrip();
    const r = G.guide(j);
    const before = view(G.step(r, G.at('07:00')), 'where', j, G.at('07:00'));
    expect(nb(before.p.title)).toBe('Guidage en cours');
    expect(before.lines.slice(0, 4)).toEqual(['Jusqu’au bureau', 'Ensuite : partir à 07:05', '5 min à pied jusqu’à l’arrêt Monument Gramme', 'bus 6 à 07:12']);
    expect(before.lines.slice(-2)).toEqual(['arrivée 08:54', HINT]);
    const onIc = view(G.step(r, G.at('07:45')), 'where', j, G.at('07:45'));
    expect(onIc.lines.slice(0, 4)).toEqual(['Jusqu’au bureau', 'Ensuite : descente à Bruxelles-Central, 08:27', '●─●─◎─○─○ descente dans 3 arrêts', 'Prochain arrêt : Louvain, 08:05']);
    // descente du train : l'arrêt du bus 71, à pied (PRD-1.3.1 § 4)
    const al = G.step(r, G.at('08:23'));
    expect(al.moment?.kind).toBe('alight');
    expect(view(al, 'moment', j, G.at('08:23')).lines[2]).toBe('ensuite : 3 min à pied → Gare Centrale');
    // A4 (P4) : lancé 30 s après l'heure de partir, marge arrondie à 1 min, pas très juste pour le moteur : rien
    const late = G.guide(G.prdTrip(), { startedAt: G.at('07:05:30') });
    const lv = G.step(late, G.at('07:05:30'));
    expect(lv.moment).toMatchObject({ kind: 'leave', marginMin: 1 });
    expect(lv.moment?.kind === 'leave' && lv.moment.tight).toBeFalsy();
    // (« l’arrêt » ne tient pas à côté de l'image : « jusqu’à Monument Gramme », règle 1.2.10)
    expect(view(lv, 'moment', j, G.at('07:05:30')).lines.slice(0, 3)).toEqual(['Partir maintenant', '5 min à pied jusqu’à Monument Gramme', 'bus 6 à 07:12']);
    // B13 : à la gare, l'IC en retard de 2 min, comme sur le quai
    const ic2 = G.prdTrip({ icDelay: 2 });
    const r2 = G.guide(ic2);
    const st = G.step(r2, G.at('07:22'), G.fix(G.P.guillemins, G.at('07:22')));
    expect(view(st, 'moment', ic2, G.at('07:22')).lines[0]).toBe('IC 07:30 +2, voie 3');
    expect(view(st, 'where', ic2, G.at('07:22')).lines[1]).toBe('Ensuite : IC 07:30 +2, voie 3');
  });

  it('B19 sur l’état du moteur ; « j’y descends » : « Jusqu’à Bruxelles-Central », « Quai te dit quand descendre », la progression au calme', () => {
    const rainy = G.prdTrip();
    rainy.legs[0].rain = true;
    const r = G.guide(rainy);
    const s = G.step(r, G.at('07:05'));
    expect(s.moment?.kind).toBe('leave');
    expect(view(s, 'moment', rainy, G.at('07:05')).lines[3]).toBe('pluie prévue');
    const one = G.journeyOf([G.IC()], 'jic');
    const ride = G.guide(one, { kind: 'ride', title: 'Vers Bruxelles-Central' });
    const st = G.step(ride, G.at('07:45'));
    expect(view(st, 'where', one, G.at('07:45')).lines).toEqual([
      'Jusqu’à Bruxelles-Central',
      'Ensuite : descente à 08:27',
      '●─●─◎─○─○ descente dans 3 arrêts',
      'Prochain arrêt : Louvain, 08:05',
      'Quai te dit quand descendre',
      HINT,
    ]);
    expect(footOf(view(st, 'empty', one, G.at('07:45')).p).text).toBe('●─●─◎─○─○   descente dans 3 arrêts');
  });
});

/* ------------------------------ Au pixel, vraies données ------------------------------ */

/** Les noms les plus longs des vraies données (data/tiles, publication du 12/11), en pixels. */
const LONG = [
  'Comines/komen Chaussée de Wervicq/Werviksesteenweg', // 494 px
  'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost', // 454 px
  'Begraafplaats van Molenbeek',
  'Bruxelles-Aéroport-Zaventem',
  'Antwerpen-Noorderdokken',
];
const LONG_BUS: VehicleRef = { op: 'tec', mode: 'bus', line: '163b4' };

/**
 * Une ligne coupée l'est dans le nom, au mot : juste avant « … », un début du nom qui finit par un mot entier (suivi d'une
 * espace dans le nom) ou par un morceau entier d'un nom composé (trait d'union, barre, apostrophe).
 */
function cutOk(line: string, name: string): boolean {
  const i = line.indexOf('…');
  // la progression et la chaîne mettent « … » à la place d'arrêts ou d'étapes cachés : ce n'est pas une coupe
  if (i < 0 || line.includes('─')) return true;
  const head = line.slice(0, i);
  for (let k = name.length - 1; k > 0; k--) {
    const part = name.slice(0, k);
    if (head.endsWith(part) && (name[k] === ' ' ? !part.endsWith(' ') : /[-/’']$/.test(part))) return true;
  }
  return false;
}

describe('au pixel, avec les noms les plus longs des vraies données', () => {
  it('nouveaux textes : rien ne dépasse, noms coupés au mot, jamais l’action, la fin d’une marche de correspondance jamais coupée', () => {
    for (const name of LONG) {
      const pages = [
        moment(walkM({ toward: N(name), vehicle: LONG_BUS })),
        moment(walkM({ toward: N(name), vehicle: IC, platform: undefined })),
        moment(board({ vehicle: LONG_BUS, head: N(name), walkMin: 12, marginMin: 0, stop: N(name), ifMissed: { vehicle: LONG_BUS, depAt: T(7, 30), rt: false } })),
        moment(board({ vehicle: IC, head: N(name), depAt: T(23, 44), sched: T(23, 2), rt: true, platform: '12a', platformChanged: true, walkMin: 12, marginMin: 5, stop: N(name) })),
        moment(alight({ kind: 'ride', vehicle: LONG_BUS, depAt: T(7, 40), rt: false, walkMin: 12, from: N(name) }, { stop: N(name) })),
        moment(turn({ then: 'sharpRight', street: name })),
        moment(turn({ then: 'slightLeft', toward: N(name) })),
        where(state({ phase: { kind: 'before', leg: 0 }, where: { ...WHERE, title: name, walk: { ...WHERE.walk!, toward: N(name), vehicle: LONG_BUS } } })),
        where(state({ where: { ...WHERE, title: name, walk: { ...WHERE.walk!, toward: N(name), vehicle: LONG_BUS } } })),
        where(state({ kind: 'ride', phase: { kind: 'wait', leg: 1 }, where: { title: `Vers ${name}`, arr: T(8, 42), rt: false, chain: [], wait: { stop: N(name), vehicle: LONG_BUS, head: N(name), depAt: T(6, 50), rt: false, missed: { arr: T(23, 59), laterMin: 452 } } } })),
        where(onBoard({ where: { title: name, arr: T(8, 58), rt: false, chain: CHAIN, ride: { ...IC_RIDE, nextStop: N(name), alight: N(name), total: 40, next: 12, stopsToAlight: 28 } } }), JN),
      ];
      for (const { v, lines } of pages) {
        for (const l of lines) expect(cutOk(l, name), `« ${l} »`).toBe(true);
        if (v.images?.length) expect(v.items.length).toBeLessThanOrEqual(GUIDE.MAX_LINES);
      }
      // la marche de correspondance garde sa fin ; « Si tu le rates » au moment de monter tient entier
      expect(pages[2].lines[2]).toMatch(/, très juste$/);
      expect(pages[2].lines[3]).toBe('Si tu le rates : bus 163b4 à ~07:30');
      expect(pages[3].lines[0]).toBe('IC 23:02 +42, voie 12a !');
      expect(pages[3].lines[2]).toMatch(/, marge 5 min$/);
      // l'action d'un virage n'est jamais coupée
      expect(pages[5].lines[0]).toBe('À gauche dans 30 m');
      // la progression reste, même avec les noms les plus longs
      expect(pages[10].lines.some((l) => /descente dans 28 arrêts$/.test(l))).toBe(true);
    }
  });
});
