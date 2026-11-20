// @vitest-environment happy-dom
/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 7), ce qui restait hors des lunettes après le contrôle du sujet « apostrophes » :
 * la rubrique « Position » de Quai Web (« Position choisie : Braine-l’Alleud (gare SNCB) », le libellé enregistré ne
 * change pas), le « Journal des trajets » (titre, texte ouvert, nom lu ; « Copier » rend le journal tel quel), et une
 * preuve côté DOM : avec des noms à apostrophe partout (gare, arrêt, ligne, favori, trajet en cours, journal, position),
 * aucune apostrophe droite dans le texte des pages ni dans ce que lit un lecteur d'écran. Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Journey, LinePick, StationPick } from '../../src/core/api';
import type { GuideStatus } from '../../src/core/guide-types';
import type { JournalTrip, TripJournal } from '../../src/core/journal-types';
import type { LineFollow } from '../../src/core/linerun';
import { dataScreen } from '../../src/phone/screens/data';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { picksScreen, resetKnownLines } from '../../src/phone/screens/picks';
import { searchScreen } from '../../src/phone/screens/search';
import { createWebLocation, locationText, MANUAL_KEY } from '../../src/web/location';
import { positionCard } from '../../src/web/position';
import { at, button, defaults, harness, mount, textOf, until, withGuide } from './helpers';
import { rideLeg, walkLeg } from './trips';

beforeEach(() => {
  resetAnswers();
  resetKnownLines();
});
afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

const N = (fr: string, nl = fr) => ({ fr, nl });
const BRAINE: StationPick = { id: 'g-braine', areaId: 'sncb:8814001', name: N("Braine-l'Alleud", 'Eigenbrakel'), lat: 50.6834, lon: 4.3711 };
const NAMUR: StationPick = { id: 'g-namur', areaId: 'sncb:8863008', name: N('Namur', 'Namen'), lat: 50.468, lon: 4.862 };
const PDA: LinePick = { id: 's-pda', areaId: 'stib:8032', op: 'stib', name: N("Porte d'Anderlecht", 'Anderlechtsepoort'), lat: 50.8436, lon: 4.3417 };
const W: LineFollow = { id: 'f-w', op: 'tec', mode: 'bus', line: 'W', routes: ['tec:W-MIDI'], ends: [N("Braine-l'Alleud Gare"), N('Bruxelles Midi', 'Brussel Zuid')] };

/**
 * Ce qu'une page montre ou fait lire avec une apostrophe droite : le texte de chaque élément sans enfant, les noms lus
 * (aria-label, title, alt), les textes d'attente et la valeur des champs. Vide : la preuve demandée par le contrôle.
 */
function straight(root: ParentNode = document.body): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (!el.children.length && (el.textContent ?? '').includes("'")) out.push(`texte : ${el.textContent}`);
    for (const a of ['aria-label', 'title', 'alt', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v?.includes("'")) out.push(`${a} : ${v}`);
    }
    const value = (el as HTMLInputElement).value;
    if (typeof value === 'string' && value.includes("'")) out.push(`valeur : ${value}`);
  }
  // et rien n'a échappé entre deux éléments
  if (!out.length && (root.textContent ?? '').includes("'")) out.push(`texte de la page : ${root.textContent}`);
  return out;
}

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const refused = { getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }) };

const TRIPS: JournalTrip[] = [
  { id: 'j2', kind: 'trip', title: "Vers Braine-l'Alleud", startedAt: at(8, 2), endedAt: at(8, 25), end: 'done', events: [] },
  { id: 'j1', kind: 'trip', title: 'Vers Namur', startedAt: at(6, 50), endedAt: at(7, 55), end: 'ended', events: [] },
];
const JOURNAL_TEXT = "Journal Quai 1.3.1, trajet « Vers Braine-l'Alleud », 20/11/2026\n08:02:10 Partir maintenant affiché\n08:21:40 Descendre à Braine-l'Alleud affiché";
function fakeJournal(): TripJournal {
  return { begin: () => 'nouveau', add: () => undefined, end: () => undefined, list: () => [...TRIPS], text: (id: string) => (id === 'j2' ? JOURNAL_TEXT : 'Journal Quai 1.3.1, trajet « Vers Namur »'), clear: () => undefined } as unknown as TripJournal;
}
const journalBox = (el: HTMLElement): HTMLElement => [...el.querySelectorAll<HTMLElement>('section')].find((x) => textOf(x.querySelector('h2')) === 'Journal des trajets')!;

describe('§ 7, Quai Web : rubrique « Position »', () => {
  it('« Position choisie : Braine-l’Alleud (gare SNCB) » ; le libellé gardé dans le navigateur ne change pas', async () => {
    expect(locationText({ kind: 'manual', label: "Braine-l'Alleud (gare SNCB)" })).toBe('Position choisie : Braine-l’Alleud (gare SNCB). Gardée dans ce navigateur.');
    // un libellé sans apostrophe : inchangé
    expect(locationText({ kind: 'manual', label: 'Namur (gare SNCB)' })).toBe('Position choisie : Namur (gare SNCB). Gardée dans ce navigateur.');
    const hz = harness({ settings: defaults() });
    const store = memStore();
    const loc = createWebLocation(() => 1_000, { geo: refused, secure: true, store, permissions: null });
    await loc.current(100);
    const card = mount(positionCard({ location: loc, core: hz.ctx.core, settings: hz.settings, changed: () => undefined, id: 'w-pos', now: () => 42 }));
    loc.setManual({ lat: BRAINE.lat, lon: BRAINE.lon, label: "Braine-l'Alleud (gare SNCB)" });
    expect(textOf(card.querySelector('.w-pos-status'))).toBe('Position choisie : Braine-l’Alleud (gare SNCB). Gardée dans ce navigateur.');
    expect(straight()).toEqual([]);
    // enregistré tel quel (comparaisons et rechargement inchangés), relu : affiché avec « ’ »
    expect(JSON.parse(store.getItem(MANUAL_KEY)!)).toEqual({ lat: BRAINE.lat, lon: BRAINE.lon, label: "Braine-l'Alleud (gare SNCB)" });
    const again = createWebLocation(() => 2_000, { geo: refused, secure: true, store, permissions: null });
    expect(again.state()).toEqual({ kind: 'manual', label: "Braine-l'Alleud (gare SNCB)" });
    expect(locationText(again.state())).toContain('Braine-l’Alleud (gare SNCB)');
  });
});

describe('§ 7, téléphone : « Journal des trajets »', () => {
  it('le titre, le texte ouvert et le nom lu avec « ’ » ; « Copier » rend le journal tel quel', async () => {
    const hz = harness({ settings: defaults() });
    const j = fakeJournal();
    hz.ctx.journal = () => j;
    const box = journalBox(mount(dataScreen(hz.ctx)));
    expect([...box.querySelectorAll('.journal-row .t1')].map((x) => textOf(x))).toEqual(['Vers Braine-l’Alleud', 'Vers Namur']);
    box.querySelector<HTMLButtonElement>('.journal-row')!.click();
    const open = box.querySelector<HTMLElement>('.journal-text')!;
    expect(open.getAttribute('aria-label')).toBe('Journal du trajet « Vers Braine-l’Alleud »');
    expect([...open.querySelectorAll('.jl')].map((x) => x.textContent)).toEqual(JOURNAL_TEXT.replace(/'/g, '’').split('\n'));
    expect(straight(box)).toEqual([]);
    // « Copier » : le texte du journal, sans retouche
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s: string) => void copied.push(s) } });
    button(box, 'Copier').click();
    await until(() => copied.length === 1);
    expect(copied).toEqual([JOURNAL_TEXT]);
  });
});

describe('§ 7, preuve côté DOM : aucune apostrophe droite dans une page pour des noms à apostrophe', () => {
  const settings = () =>
    defaults({
      stations: [BRAINE],
      lines: [PDA],
      follows: [W],
      favorites: [{ kind: 'trip', id: 'fav-b', from: { type: 'area', areaId: NAMUR.areaId, op: 'sncb', name: NAMUR.name, lat: NAMUR.lat, lon: NAMUR.lon }, to: { type: 'area', areaId: BRAINE.areaId, op: 'sncb', name: BRAINE.name, lat: BRAINE.lat, lon: BRAINE.lon }, propose: 'never' }],
    });
  const STATUS: GuideStatus = { kind: 'trip', title: "Braine-l'Alleud", arr: at(8, 54), now: "IC vers Braine-l'Alleud", guided: true };

  it('la sonde voit une apostrophe droite dans un texte, un nom lu ou un champ (elle ne passe pas à vide)', () => {
    const p = document.createElement('p');
    p.textContent = "Braine-l'Alleud";
    const b = document.createElement('button');
    b.setAttribute('aria-label', "Retirer Porte d'Anderlecht");
    const i = document.createElement('input');
    i.value = "Porte d'Anderlecht";
    document.body.replaceChildren(p, b, i);
    expect(straight()).toEqual(["texte : Braine-l'Alleud", "aria-label : Retirer Porte d'Anderlecht", "valeur : Porte d'Anderlecht"]);
  });

  it('accueil (rubriques, favori, carte « En cours ») du téléphone et de Quai Web', () => {
    for (const web of [false, true]) {
      const hz = harness({ settings: settings(), web });
      withGuide(hz.glasses, STATUS);
      const el = mount(homeScreen(hz.ctx));
      // les noms sont bien dans la page, avec « ’ »
      expect(el.textContent).toContain('Braine-l’Alleud');
      expect(el.textContent).toContain('Porte d’Anderlecht');
      expect(straight(), web ? 'Quai Web' : 'téléphone').toEqual([]);
    }
  });

  it('« Gares », « Arrêts », « Lignes » (détail ouvert, question du retrait) et « Mes favoris »', () => {
    const hz = harness({ settings: settings() });
    for (const kind of ['stations', 'lines', 'follows'] as const) {
      const el = mount(picksScreen(hz.ctx, kind));
      expect(el.textContent, kind).toMatch(/Braine-l’Alleud|Porte d’Anderlecht/);
      el.querySelector<HTMLButtonElement>('.pick-head')?.click();
      el.querySelector<HTMLButtonElement>('[data-act="remove"]')?.click();
      expect(straight(), kind).toEqual([]);
    }
    const fav = mount(favoritesScreen(hz.ctx));
    expect(textOf(fav.querySelector('.list .t1'))).toBe('Namur → Braine-l’Alleud');
    expect(straight(), 'Mes favoris').toEqual([]);
    // les réglages gardent les noms des données
    const st = hz.settings.get();
    expect([st.stations[0].name.fr, st.lines[0].name.fr, st.follows![0].ends![0].fr]).toEqual(["Braine-l'Alleud", "Porte d'Anderlecht", "Braine-l'Alleud Gare"]);
  });

  it('résultat d’une recherche (titre, champs, carte) et « Données » avec le journal ouvert', async () => {
    const T0 = at(16, 40);
    const min = (n: number) => n * 60_000;
    const legs = [walkLeg(T0, 7), rideLeg(T0 + min(7), T0 + min(40), 'IC', "Braine-l'Alleud", 'Bruxelles-Midi'), walkLeg(T0 + min(40), 4)];
    const journey: Journey = { id: 'j', legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: legs[0].dep, transfers: 0, rt: false, alerts: [], label: 'short' };
    const area = (id: string, fr: string) => ({ id, op: 'sncb' as const, n: N(fr), lat: 50.68, lon: 4.37, modes: ['train' as const], lines: ['IC'] });
    const hz = harness({
      now: T0 - min(5),
      settings: defaults(),
      params: 'de=sncb:8814001&vers=sncb:8814118',
      core: (c) => ({ ...c, route: async () => ({ journeys: [journey] }), board: async (id: string) => ({ ...(await c.board('sncb:8863008', { limit: 1 })), area: id === 'sncb:8814001' ? area(id, "Braine-l'Alleud") : area(id, "Braine-l'Alleud-Ouest") }) }),
    });
    const el = mount(searchScreen(hz.ctx));
    await until(() => el.querySelectorAll('.result').length === 1);
    expect(textOf(el.querySelector('.res-title h2'))).toBe('Braine-l’Alleud → Braine-l’Alleud-Ouest');
    expect(straight(), 'recherche').toEqual([]);

    const data = harness({ settings: defaults() });
    data.ctx.journal = () => fakeJournal();
    const page = mount(dataScreen(data.ctx));
    journalBox(page).querySelector<HTMLButtonElement>('.journal-row')!.click();
    expect(page.textContent).toContain('Descendre à Braine-l’Alleud affiché');
    expect(straight(), 'Données').toEqual([]);
  });
});
