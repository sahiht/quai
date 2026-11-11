/**
 * Corrections issues du contrôle qualité dans le simulateur (1.1) : heures prévues jamais coupées dans les colonnes
 * d'heure (« ~08:44 »), message d'une page des étapes non reporté sur une autre page.
 */
import { describe, expect, it } from 'vitest';
import { textWidth } from '../../src/glasses/font';
import { layoutPage, WIDTHS } from '../../src/glasses/layout';
import type { Core, Departure, Journey } from '../../src/core/api';
import { QuaiError } from '../../src/core/errors';
import { tripPhase } from '../../src/glasses/controller';
import type { GlassesView, Item } from '../../src/glasses/types';
import { HINTS, trainCell } from '../../src/glasses/format';
import { nb, overflowing, setupController } from './helpers';

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

describe('colonnes d’heure (étapes, « Dans le train »)', () => {
  it('toute heure prévue « ~HH:MM » tient dans la colonne d’heure (« ~08:44 » = 69 px)', () => {
    const tooWide: string[] = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) if (textWidth(`~${hhmm(h, m)}`) > WIDTHS.stepsTime) tooWide.push(`~${hhmm(h, m)}`);
    expect(tooWide).toEqual([]);
    expect(WIDTHS.stepsText).toBe(342);
  });

  it('étapes : « ~08:44 » affichée en entier, texte et état intacts', () => {
    const items: Item[] = [
      { a: '~08:44', b: 'T3 vers Churchill', c: 'dans 12 min' },
      { a: '08:48', b: 'Descendre à De Brouckere' },
    ];
    const v: GlassesView = { screen: 'steps', layout: 'steps', title: 'Vers Rue Neuve 1 : 07:33 → 08:51', clock: '07:31', items, hints: HINTS.steps, scroll: true, reserveNote: true, top: { text: 'Le plus rapide : 5 min plus tôt, 1 changement' } };
    const p = layoutPage(v, { sel: 0, top: 0 });
    const colA = p.containers.find((c) => c.name === 'colA')!.content.split('\n');
    expect(colA[0]).toBe('~08:44');
    expect(nb(p.lines[1])).toBe('~08:44   T3 vers Churchill   dans 12 min');
    expect(overflowing(p)).toEqual([]);
  });

  it('« Dans le train » : « ~08:44 » affichée en entier', () => {
    const items: Item[] = [
      { a: 'Bruxelles-Nord', b: '~08:40', c: 'passé' },
      { a: 'Gare du Nord', b: '~08:44', c: 'prochain' },
    ];
    const v: GlassesView = { screen: 'train', layout: 'train', title: 'T3 vers Churchill', clock: '08:41', items, hints: HINTS.train };
    const p = layoutPage(v, { sel: 1, top: 0 });
    expect(p.containers.find((c) => c.name === 'colB')!.content.split('\n')[1]).toBe('~08:44');
    expect(overflowing(p)).toEqual([]);
  });
});

describe('horaires injoignables au lancement (M8.6)', () => {
  it('le téléphone réussit le démarrage du cœur le premier : les lunettes quittent quand même l’écran d’erreur', async () => {
    let fail = true;
    const flaky = (core: Core): Core => Object.assign(Object.create(core) as Core, { init: () => (fail ? Promise.reject(new QuaiError('dataUnreachable')) : core.init()) });
    const t = await setupController({ wrap: flaky, scenario: 's1' });
    expect(nb(t.last().lines[0])).toBe('Horaires injoignables : nouvel essai dans 30 s');
    fail = false;
    // l'accueil du téléphone demande le cœur (ctx.core() → ensureInit) avant le nouvel essai des lunettes
    await t.c.ensureInit();
    expect(t.c.error).toBeNull();
    await t.c.refreshCurrent();
    const s = await t.until((x) => x.screen !== 'message');
    expect(s.screen).toBe('home');
    t.c.stop();
  });

  it('même chose avec « toucher : réessayer »', async () => {
    let fail = true;
    const flaky = (core: Core): Core => Object.assign(Object.create(core) as Core, { init: () => (fail ? Promise.reject(new QuaiError('dataUnreachable')) : core.init()) });
    const t = await setupController({ wrap: flaky, scenario: 's1' });
    fail = false;
    await t.c.ensureInit();
    await t.gesture('tap');
    const s = await t.until((x) => x.screen !== 'message');
    expect(s.screen).toBe('home');
    t.c.stop();
  });
});

describe('trajet suivi depuis la gare (M6.3)', () => {
  const dep = Date.parse('2026-11-10T14:10:00+01:00');
  const station = { lat: 50.8454, lon: 4.3571 };
  const arr = dep + 29 * 60_000;
  const j = {
    id: 'g', dep, arr, leaveAt: dep - 2 * 60_000, transfers: 0, rt: true, alerts: [],
    legs: [{ kind: 'ride' as const, from: { name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, ...station }, to: { name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters' }, lat: 51.0359, lon: 3.7107 }, dep, arr, schedDep: dep, schedArr: arr }],
  } as unknown as Journey;
  const trip = { leaveAt0: dep - 2 * 60_000, origin: station };

  it('une position prise juste après le départ, encore dans la gare, ne met pas fin au trajet', () => {
    expect(tripPhase(trip, j, dep + 40_000, { ...station, at: dep + 30_000 })).toBe('running');
    expect(tripPhase(trip, j, dep + 2 * 60_000, { ...station, at: dep + 2 * 60_000 })).toBe('running');
  });

  it('toujours sur le quai 3 min après le départ : le train est parti sans l’utilisateur', () => {
    expect(tripPhase(trip, j, dep + 4 * 60_000, { ...station, at: dep + 4 * 60_000 })).toBe('ended');
    expect(tripPhase(trip, j, dep + 4 * 60_000, { lat: 50.9, lon: 4.1, at: dep + 4 * 60_000 })).toBe('running');
  });
});

describe('départs des trains pendant une panne du temps réel', () => {
  it('suppression gardée (temps réel absent) : « 12:34  SUPPRIMÉ » en entier, sans « ~ »', () => {
    const at = Date.parse('2026-11-10T12:34:00+01:00');
    const d = { line: 'S1', mode: 'train', op: 'sncb', head: { fr: 'Nivelles', nl: 'Nijvel' }, sched: at, est: at, rt: false, cancelled: true, platform: '5' } as unknown as Departure;
    expect(trainCell(d, true)).toBe('12:34  SUPPRIMÉ');
    const v: GlassesView = { screen: 'board', layout: 'boardTrain', title: 'Bruxelles-Nord, train (SNCB)', clock: '12:11', items: [{ a: 'S1', b: 'Nivelles', c: trainCell(d, true) }], hints: HINTS.board, reserveNote: true, note: 'Temps réel indisponible : horaires prévus ~' };
    const p = layoutPage(v, { sel: 0, top: 0 });
    expect(nb(p.lines[0])).toBe('S1   Nivelles   12:34  SUPPRIMÉ');
    expect(overflowing(p)).toEqual([]);
    // un départ prévu garde son « ~ »
    expect(trainCell({ ...d, cancelled: false }, true)).toBe('~12:34  voie 5');
  });
});

describe('étapes : un message ne passe pas d’une page à l’autre', () => {
  it('« Pas d’autre trajet pour l’instant » (▼ sur la dernière page) disparaît avec ▲', async () => {
    const t = await setupController({ scenario: 's1' });
    await t.until((s) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l)));
    await t.gesture('tap');
    await t.until((s) => s.screen === 'steps' && s.page === 1);
    const pages = t.last().pages ?? 1;
    expect(pages).toBeGreaterThan(1);
    for (let i = 1; i < pages; i++) await t.gesture('down');
    expect(t.last().page).toBe(pages);
    await t.gesture('down');
    expect(nb(t.last().lines.at(-1)!)).toBe('Pas d’autre trajet pour l’instant');
    await t.gesture('up');
    const s = await t.until((x) => x.page === pages - 1);
    expect(s.page).toBe(pages - 1);
    expect(s.lines).not.toContain('Pas d’autre trajet pour l’instant');
    expect(nb(s.lines.at(-1)!)).toMatch(/^▲▼ autre trajet {3}toucher : /);
  });

  it('« Trajet suivi : … » reste sur sa page : ▲ montre l’aide de la page précédente', async () => {
    const t = await setupController({ scenario: 's1' });
    await t.until((s) => s.screen === 'home' && !s.lines.some((l) => / …$/.test(l)));
    await t.gesture('tap');
    await t.until((s) => s.screen === 'steps' && s.page === 1);
    await t.gesture('down', 'tap');
    expect(nb(t.last().lines.at(-1)!)).toMatch(/^Trajet suivi : /);
    expect(t.last().followed).toBe(true);
    await t.gesture('up');
    const s = await t.until((x) => x.page === 1);
    expect(s.followed).toBe(false);
    expect(nb(s.lines.at(-1)!)).toBe(nb(HINTS.stepsOther));
  });
});
