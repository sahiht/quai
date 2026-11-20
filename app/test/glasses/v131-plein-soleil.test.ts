// @vitest-environment happy-dom
/**
 * Quai 1.3.1 (PRD-1.3.1 § 14, R5) : réglage « Plein soleil ».
 *
 * - Un seul point de réglage (glasses/layout.ts : SUN_LEVEL, sunLevel, inSun, LayoutOptions.sun) : chaque niveau pâle
 *   monte d'un cran, jusqu'à 3 ; le niveau 4 reste seul au plus clair.
 * - Pages : liste des arrêts d'un bus (ligne d'action dans le conteneur du curseur, élargi), écran du trajet (ligne
 *   d'action dans la colonne a), page du guidage, « Favoris » avec son filet et un message : seuls le titre, le curseur
 *   et la ligne d'action (et ce qui était déjà au plus clair) restent à 4 ; rien d'autre ne dépasse 3 ; textes, places,
 *   images et menu inchangés. L'écart : un cran au moins (textColor du SDK, opacité de Quai Web).
 * - Réglages (settings.ts), contrôleur (le changement de réglage met les niveaux à jour sur les lunettes), téléphone
 *   (interrupteur dans Affichage, l'aperçu le suit).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type DepartureStops, type Settings } from '../../src/core/api';
import { container as byName } from './helpers';
import { layoutPage, SUN_LEVEL, sunLevel, type DetailItem } from '../../src/glasses/layout';
import { stepsPage, stopsView, type ViewCtx } from '../../src/glasses/views';
import type { Brightness, ContainerSpec, GlassesView, PageSpec } from '../../src/glasses/types';
import { BORDER_COLOR, toTextProperty } from '../../src/platform/even';
import { LEVEL_ALPHA } from '../../src/web/display';
import { displayScreen } from '../../src/phone/screens/display';
import { validateSettings } from '../../src/settings';
import { at, dep, journey, nb, settingsWith, setup, stopsOf } from './helpers';
import { defaults, harness, mount, textOf, until } from '../phone/helpers';

const DAY = '2026-11-20';
const NOW = at(DAY, 8, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
const LEVELS: Brightness[] = [0, 1, 2, 3, 4];

/** La même page, « Plein soleil » éteint puis allumé : tout est égal sauf les niveaux, chacun passé par SUN_LEVEL. */
function both(v: GlassesView, sel = 0, toast?: string): { off: PageSpec; on: PageSpec } {
  const off = layoutPage(v, { sel, top: 0 }, { toast });
  const on = layoutPage(v, { sel, top: 0 }, { toast, sun: true });
  const strip = (p: PageSpec) => ({ ...p, containers: p.containers.map(({ level: _l, border, ...c }) => ({ ...c, ...(border ? { border: { width: border.width } } : {}) })) });
  expect(strip(on)).toEqual(strip(off));
  on.containers.forEach((c, i) => {
    expect(c.level).toBe(SUN_LEVEL[off.containers[i].level]);
    if (c.border) expect(c.border.level).toBe(SUN_LEVEL[off.containers[i].border!.level]);
  });
  // réglage éteint (absent ou faux) : la page de toujours
  expect(layoutPage(v, { sel, top: 0 }, { toast, sun: false })).toEqual(off);
  return { off, on };
}
const at4 = (p: PageSpec) => p.containers.filter((c) => c.level === 4).map((c) => c.name);
const below = (p: PageSpec) => p.containers.filter((c) => c.level < 4);

describe('R5 : un seul point de réglage (layout.ts)', () => {
  it('les niveaux pâles montent d’un cran, jusqu’à 3 ; 4 reste seul au plus clair ; éteint, rien ne change', () => {
    expect(SUN_LEVEL).toEqual({ 0: 1, 1: 2, 2: 3, 3: 3, 4: 4 });
    for (const l of LEVELS) {
      expect(sunLevel(l, false)).toBe(l);
      expect(sunLevel(l, true)).toBeGreaterThanOrEqual(l);
      if (l < 4) expect(sunLevel(l, true)).toBeLessThanOrEqual(3);
      if (l < 3) expect(sunLevel(l, true)).toBe(l + 1);
    }
    expect(sunLevel(4, true)).toBe(4);
  });
});

describe('R5 : pages en plein soleil', () => {
  it('arrêts d’un bus : la ligne d’action dans le conteneur du curseur (élargi) et le titre restent seuls à 4 ; le reste, de 2 ou 3, passe à 3', () => {
    const b71 = dep(NOW, 6, { op: 'stib', mode: 'bus', line: '71', head: N('De Brouckère') });
    const stops: DepartureStops = stopsOf(b71, NOW, [['Flagey', 6], ['Germoir', 8], ['Fernand Cocq', 10], ['Gare Centrale', 17], ['De Brouckère', 20]]);
    const v = stopsView({ screen: 'stops' as const, areaId: 'stib:Flagey', dep: b71 }, stops, ctx());
    expect(v.cursorAction).toBe(true);
    const { off, on } = both(v, 2);
    expect(nb(byName(on, 'cursor').content.split('\n').at(-1)!.trim())).toBe('▶ Me guider jusqu’à Gare Centrale');
    expect(at4(on)).toEqual(['title', 'cursor']);
    expect(at4(on)).toEqual(at4(off));
    expect(below(on).every((c) => c.level === 3)).toBe(true);
    // le pied (aides) était pâle : un cran plus clair
    expect([byName(off, 'foot').level, byName(on, 'foot').level]).toEqual([2, 3]);
  });

  it('écran du trajet : « ▶ Y aller » dans la colonne a, au plus clair ; l’arrêt de descente et la marche (pâles) passent à 3', () => {
    const T = (hh: number, mm: number) => at(DAY, hh, mm);
    const j = journey('j1', [{ walk: 6, to: 'Flagey' }, { ride: '71', mode: 'bus', dep: T(8, 12), arr: T(8, 24), from: 'Flagey', to: 'Gare Centrale', head: 'De Brouckère' }, { walk: 3 }]);
    const v = stepsPage({ title: 'Bureau', label: '' }, { journeys: [j], index: 0, fresh: true }, ctx());
    expect(v.action).toBe('▶ Y aller');
    const { off, on } = both(v);
    expect(nb(byName(on, 'colA').content.split('\n').at(-1)!)).toBe('▶ Y aller');
    expect(byName(on, 'colA').level).toBe(4);
    // au plus clair, comme sans le réglage : titre, curseur, colonne a (heures et ligne d'action), colonne c (attente)
    expect(at4(on)).toEqual(at4(off));
    expect(at4(on)).toEqual(['title', 'cursor', 'colA', 'colC']);
    expect(Math.max(...below(on).map((c) => c.level))).toBe(3);
    expect([byName(off, 'colB').level, byName(on, 'colB').level]).toEqual([2, 3]);
  });

  it('page du guidage : l’action (colonne a) reste seule au plus clair ; titre, heure et texte pâle à 3 ; image et menu inchangés', () => {
    const v: GlassesView = {
      screen: 'guide',
      layout: 'guide',
      title: 'Bureau',
      clock: '08:05',
      items: [{ a: 'Partir maintenant' }, { a: '', b: '5 min à pied jusqu’à l’arrêt Flagey' }, { a: '', c: 'bus 71 à 08:12' }],
      hints: 'toucher : masquer',
      images: [{ id: 9, name: 'guide-image', x: 28, y: 60, w: 144, h: 144, image: { kind: 'sign', label: 'à pied', value: '5', foot: 'min' } }],
      menu: [{ id: 1, label: 'Arrêter le guidage' }],
    };
    const { off, on } = both(v);
    expect(at4(on)).toEqual(at4(off));
    expect(at4(on)).toEqual(['cursor', 'colA']);
    expect(byName(on, 'colA').content).toBe('Partir maintenant');
    expect(['title', 'clock', 'colB', 'colC', 'foot'].map((n) => [byName(off, n).level, byName(on, n).level])).toEqual([
      [2, 3],
      [2, 3],
      [3, 3],
      [2, 3],
      [2, 3],
    ]);
    expect(on.images).toEqual(off.images);
    expect(on.menu).toEqual(off.menu);
  });

  it('« Favoris » : le filet (bordure pâle) monte aussi d’un cran ; un message au plus clair le reste', () => {
    const items: DetailItem[] = [
      { a: 'Gare', c: '08:12', detail: 'Bruxelles-Central' },
      { a: 'Flagey', c: '08:15', detail: 'Place Flagey' },
    ];
    const v: GlassesView = { screen: 'favorites', layout: 'favorites', title: 'Favoris', clock: '08:00', items, hints: 'toucher : ouvrir' };
    const { off, on } = both(v, 0, '★ Ajouté aux favoris');
    const filet = (p: PageSpec): ContainerSpec => p.containers.find((c) => c.border)!;
    expect([filet(off).border!.level, filet(on).border!.level]).toEqual([2, 3]);
    expect([byName(off, 'foot').level, byName(on, 'foot').level]).toEqual([4, 4]);
  });

  it('l’écart : un cran au moins entre le plus clair et tout le reste (3 contre 4), tel que le rendent les lunettes et Quai Web', () => {
    // SDK : textColor = niveau (0 à 4) ; bordure : couleur de BORDER_COLOR ; Quai Web : opacité de LEVEL_ALPHA
    const b71 = dep(NOW, 6, { op: 'stib', mode: 'bus', line: '71', head: N('De Brouckère') });
    const v = stopsView({ screen: 'stops' as const, areaId: 'stib:Flagey', dep: b71 }, stopsOf(b71, NOW, [['Flagey', 6], ['Germoir', 8], ['Gare Centrale', 17]]), ctx());
    const { on } = both(v, 1);
    for (const c of on.containers) expect(toTextProperty(c).textColor).toBe(c.level);
    const hi = Math.min(...on.containers.filter((c) => ['cursor', 'title'].includes(c.name)).map((c) => toTextProperty(c).textColor!));
    const rest = Math.max(...below(on).map((c) => toTextProperty(c).textColor!));
    expect(hi - rest).toBeGreaterThanOrEqual(1);
    // Quai Web : 1 contre 0,9 d'opacité (0,77 pour le texte pâle sans le réglage) ; bordure du filet 10 au lieu de 6
    expect(LEVEL_ALPHA[4] - LEVEL_ALPHA[SUN_LEVEL[3]]).toBeGreaterThan(0);
    expect(LEVEL_ALPHA[SUN_LEVEL[2]]).toBeGreaterThan(LEVEL_ALPHA[2]);
    expect(BORDER_COLOR[SUN_LEVEL[2]]).toBeGreaterThan(BORDER_COLOR[2]);
  });
});

describe('R5 : réglage enregistré (settings.ts)', () => {
  it('éteint par défaut, seul true est gardé ; anciens réglages lus sans perte', () => {
    const s = validateSettings({});
    expect('sun' in s.display).toBe(false);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, sun: true } }).display.sun).toBe(true);
    for (const bad of [false, 'true', 1, null, 'oui']) expect('sun' in validateSettings({ ...DEFAULT_SETTINGS, display: { ...DEFAULT_SETTINGS.display, sun: bad } }).display).toBe(false);
    const old: Settings = validateSettings({ ...DEFAULT_SETTINGS, onboarded: true, display: { ...DEFAULT_SETTINGS.display, radiusM: 800, guide: false, alert: 'visible' } });
    expect(validateSettings(JSON.parse(JSON.stringify(old)))).toEqual(old);
    const on = { ...old, display: { ...old.display, sun: true } };
    expect(validateSettings(JSON.parse(JSON.stringify(on)))).toEqual(on);
  });
});

describe('R5 : les lunettes suivent le réglage (contrôleur)', () => {
  it('allumé sur le téléphone : les niveaux de la page changent aussitôt ; éteint : ceux d’avant', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.3.0' }) });
    await h.until((s) => s.screen === 'home');
    const before = h.sent().map((c) => [c.name, c.level] as const);
    expect(before.some(([, l]) => l === 2)).toBe(true);
    await h.settings.update((x) => ({ ...x, display: { ...x.display, sun: true } }));
    await h.settle(80);
    expect(h.sent().map((c) => [c.name, c.level])).toEqual(before.map(([n, l]) => [n, SUN_LEVEL[l]]));
    await h.settings.update((x) => ({ ...x, display: { ...x.display, sun: false } }));
    await h.settle(80);
    expect(h.sent().map((c) => [c.name, c.level])).toEqual(before);
  });
});

describe('R5 : interrupteur « Plein soleil » (Réglages, Affichage)', () => {
  afterEach(() => document.body.replaceChildren());
  const sunRow = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.switch-row')].find((r) => textOf(r.querySelector('.c1')) === 'Plein soleil')!;
  /** Opacités des conteneurs de l'aperçu (niveaux 0 à 4 : 0,28, 0,42, 0,6, 0,8, 1). */
  const opacities = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.preview .g-screen > div')].map((d) => d.style.opacity);

  it('dans « Sur tous les écrans », après la pluie, avec sa ligne pâle ; éteint par défaut ; un toucher l’enregistre, l’aperçu suit', async () => {
    const hz = harness({ settings: defaults() });
    const el = mount(displayScreen(hz.ctx));
    const group = [...el.querySelectorAll<HTMLElement>('section.group')].find((g) => textOf(g.querySelector('h2')) === 'Sur tous les écrans')!;
    const names = [...group.querySelectorAll('.switch-row .c1')].map((c) => textOf(c));
    expect(names.slice(-2)).toEqual(['Pluie pendant la marche', 'Plein soleil']);
    const row = sunRow(el);
    expect(textOf(row.querySelector('.c2'))).toBe('Le texte pâle devient plus clair.');
    expect(row.textContent).not.toMatch(/[—–']/);
    const input = row.querySelector<HTMLInputElement>('input')!;
    expect([input.getAttribute('role'), input.checked]).toEqual(['switch', false]);
    // aperçu de l'accueil des lunettes : du texte pâle (0,6) sans le réglage
    expect(opacities(el)).toContain('0.6');
    input.click();
    await until(() => hz.settings.get().display.sun === true && !opacities(el).includes('0.6'));
    expect(opacities(el)).toContain('0.8');
    expect(opacities(el)).toContain('1');
    await hz.settings.flush();
    expect(JSON.parse(hz.kv.data.get('quai.settings')!).display.sun).toBe(true);
    // un écran rouvert le montre allumé ; éteint, le champ disparaît
    const again = sunRow(mount(displayScreen(hz.ctx))).querySelector<HTMLInputElement>('input')!;
    expect(again.checked).toBe(true);
    again.click();
    await until(() => !('sun' in hz.settings.get().display));
    expect(hz.settings.get()).toEqual(defaults());
  });
});
