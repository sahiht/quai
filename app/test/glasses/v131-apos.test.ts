/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 7) : un nom venu des données (arrêt, gare, destination, ligne) s'affiche dans
 * les lunettes (et dans Quai Web, qui dessine les mêmes conteneurs) avec l'apostrophe typographique « ’ »
 * (« Braine-l’Alleud ») : titre, rangées, ligne du haut, pied, message temporaire, écrans du guidage ; le journal de la
 * page dit la même chose. Chaque mesure se fait sur le texte affiché. Seulement à l'affichage : les données des vues,
 * des routes et des réglages gardent le nom tel quel (comparaisons, recherches, réglages enregistrés). Lieux publics.
 */
import { describe, expect, it } from 'vitest';
import type { StationPick } from '../../src/core/api';
import { apos } from '../../src/core/typo';
import { glyphSafe, textWidth, truncate } from '../../src/glasses/font';
import { layoutPage, truncateWords } from '../../src/glasses/layout';
import type { GlassesView, PageSpec } from '../../src/glasses/types';
import { boardView, messageView, stationsView, stopsView, type ViewCtx } from '../../src/glasses/views';
import { straightApostrophes } from '../scan/cuts';
import { at, boardOf, dep, nb, overflowing, page, settingsWith, stopsOf, trainAt } from './helpers';

const NOW = at('2026-11-20', 8, 0);
const N = (fr: string) => ({ fr, nl: fr });
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([]), ...patch });
/** Tout ce que la page montre ou journalise. */
const shown = (p: PageSpec): string[] => [p.title, ...p.lines, ...p.containers.map((c) => c.content)];

describe('PRD-1.3.1 § 7 : apostrophe typographique dans les lunettes', () => {
  it('tableau d’une gare : le titre, la destination, la ligne du haut, le pied ; jamais d’apostrophe droite', () => {
    const b = boardOf('sncb:8814266', "Braine-l'Alleud", [trainAt(NOW, 7, { head: N("Braine-l'Alleud"), msg: "Travaux à Braine-l'Alleud" })], {
      area: { id: 'sncb:8814266', op: 'sncb', n: N("Braine-l'Alleud"), lat: 50.68, lon: 4.37, modes: ['train'], lines: [] },
    });
    const v = boardView(b, ctx(), { kept: false });
    // la vue garde le nom tel que les données le donnent
    expect(v.items[1].b).toBe("Braine-l'Alleud");
    const p = page(v);
    expect(straightApostrophes(p)).toEqual([]);
    expect(shown(p).join('\n')).not.toContain("'");
    expect(p.title).toMatch(/^Braine-l’Alleud, train/);
    expect(p.lines[0]).toBe('! Travaux à Braine-l’Alleud');
    expect(p.lines.some((l) => l.includes('Braine-l’Alleud'))).toBe(true);
    expect(overflowing(p)).toEqual([]);
  });

  it('« Gares » : la rangée affichée avec « ’ », la route et le choix enregistré gardent le nom des données', () => {
    const pick: StationPick = { id: 'g1', areaId: 'sncb:8814266', name: N("Braine-l'Alleud"), lat: 50.68, lon: 4.37 };
    const before = structuredClone(pick);
    const v = stationsView([{ pick, next: trainAt(NOW, 7), state: 'ok' }], ctx());
    const p = page(v);
    expect(p.lines[0]).toMatch(/^Braine-l’Alleud   /);
    expect(straightApostrophes(p)).toEqual([]);
    // seulement à l'affichage : la route du toucher et le choix ne changent pas
    expect(v.items[0].action).toMatchObject({ kind: 'open', route: { screen: 'board', name: N("Braine-l'Alleud") } });
    expect(pick).toEqual(before);
  });

  it('arrêts d’un départ : l’arrêt du haut, les rangées et « ▶ Me guider jusqu’à … » ; message temporaire aussi', () => {
    const d = dep(NOW, 4, { op: 'tec', mode: 'bus', line: '36', head: N("Braine-l'Alleud Gare") });
    const v = stopsView({ screen: 'stops', areaId: 'tec:x', dep: d }, stopsOf(d, NOW, [["Ophain Chaussée d'Ophain", 4], ["Braine-l'Alleud Gare", 12]]), ctx());
    const p = layoutPage(v, { sel: 0, top: 0 }, { toast: "★ Déjà dans tes gares : Braine-l'Alleud" });
    expect(straightApostrophes(p)).toEqual([]);
    expect(p.title).toBe('Bus 36 vers Braine-l’Alleud Gare');
    expect(p.lines).toContain('▶ Me guider jusqu’à Braine-l’Alleud Gare');
    expect(nb(p.lines.at(-1)!)).toBe('★ Déjà dans tes gares : Braine-l’Alleud');
  });

  it('écrans du guidage (gabarit « guide ») : les conteneurs aussi', () => {
    const v: GlassesView = { ...messageView("Vers Braine-l'Alleud", [], ctx()), layout: 'guide', screen: 'guide', items: [{ a: "Descends à Braine-l'Alleud" }, { a: '', b: "puis 3 min à pied → Rue de l'Église" }], hints: '' };
    const p = layoutPage(v, { sel: -1, top: 0 });
    expect(straightApostrophes(p)).toEqual([]);
    expect(p.lines.map(nb)).toEqual(['Descends à Braine-l’Alleud', 'puis 3 min à pied → Rue de l’Église']);
  });

  it("les mesures se font sur le texte affiché : « ’ » (5 px) et non « ' » (4 px) ; une coupe au mot garde « ’ »", () => {
    expect(glyphSafe("l'Alleud")).toBe('l’Alleud');
    expect(textWidth("Braine-l'Alleud")).toBe(textWidth('Braine-l’Alleud'));
    expect(truncate("Braine-l'Alleud", 1000)).toBe('Braine-l’Alleud');
    // un nom coupé après son apostrophe (morceau entier d'un nom composé) : « ’ », jamais « ' »
    const cut = truncateWords("Sint-Job-in-'t-Goor Sluisvijfbaan", textWidth('Sint-Job-in-’t-Goor…') + 2);
    expect(cut).toBe('Sint-Job-in-’t-Goor…');
    // la fonction commune : rien ne change sans apostrophe droite
    expect(apos('Bruxelles-Central')).toBe('Bruxelles-Central');
  });

  it("le balayage les compte : une page qui garderait « ' » serait signalée", () => {
    const p: PageSpec = { containers: [{ id: 5, name: 'colA', x: 28, y: 60, w: 100, h: 27, content: "Braine-l'Alleud", level: 4, capture: false }], lines: ['Braine-l’Alleud'], screen: 'board', title: 'Quai', clock: '08:00', top: 0, visible: 1, sel: 0 };
    expect(straightApostrophes(p)).toEqual(["Braine-l'Alleud"]);
  });
});
