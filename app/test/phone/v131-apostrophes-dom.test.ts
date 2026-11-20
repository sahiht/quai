// @vitest-environment happy-dom
/**
 * Quai 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 7), ce qui restait hors des lunettes après le contrôle du sujet « apostrophes » :
 * la rubrique « Position » de Quai Web (« Position choisie : Braine-l’Alleud (gare SNCB) », le libellé enregistré ne
 * change pas), le « Journal des trajets » (titre, texte ouvert, nom lu ; « Copier » rend le journal tel quel), et une
 * preuve côté DOM : avec des noms à apostrophe partout (gare, arrêt, ligne, favori, trajet en cours, journal, position),
 * aucune apostrophe droite dans le texte des pages ni dans ce que lit un lecteur d'écran. Lieux publics seulement.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Core, Departure, FavoriteAnswer, Journey, Leg, LinePick, StationPick } from '../../src/core/api';
import type { GeocodeResult } from '../../../shared/types';
import type { GuideStatus } from '../../src/core/guide-types';
import type { JournalTrip, TripJournal } from '../../src/core/journal-types';
import type { LineFollow } from '../../src/core/linerun';
import { troubleText } from '../../src/glasses/format';
import { favoriteTrouble } from '../../src/glasses/views';
import { placeField, type FieldChoice } from '../../src/phone/field';
import { dataScreen } from '../../src/phone/screens/data';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { homeFavoriteTrouble, homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { picksScreen, resetKnownLines } from '../../src/phone/screens/picks';
import { searchScreen, shownLabel } from '../../src/phone/screens/search';
import { endpointText } from '../../src/phone/text';
import { createWebLocation, locationText, MANUAL_KEY } from '../../src/web/location';
import { positionCard } from '../../src/web/position';
import { at, button, defaults, harness, mount, preset11, SCENARIO, textOf, type, until, withGuide } from './helpers';
import { rideLeg, trip, walkLeg } from './trips';

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

/* ------------------------------ Adresses (décision du directeur, 20/11) ------------------------------ */

describe('§ 7, adresses : « ’ » à l’affichage aussi, jamais dans une valeur gardée ni dans ce qui part vers le service d’adresses', () => {
  const EGLISE = "Rue de l'Église 5, 1000 Bruxelles";
  const result: GeocodeResult = { label: EGLISE, lat: 50.8503, lon: 4.3517, kind: 'adresse', source: 'bru', score: 1 };
  const withGeo = (asked: string[], searched: string[] = []) => (c: Core): Core => ({
    ...c,
    search: async (q, near) => (searched.push(q), c.search(q, near)),
    geocode: async (q) => (asked.push(q), { results: /glise/i.test(q) ? [result] : [] }),
  });

  it('champ unique : la proposition et le texte choisi avec « ’ » ; le choix rendu et l’adresse récente gardent « \' »', async () => {
    const asked: string[] = [];
    const hz = harness({ settings: defaults(), core: withGeo(asked) });
    const picks: FieldChoice[] = [];
    const f = placeField(hz.ctx, { id: 'f', label: 'Arrivée', recent: true, onPick: (c) => picks.push(c) });
    mount(f.el);
    type(f.input, "rue de l'eglise 5");
    await until(() => [...f.list.querySelectorAll('.s1')].some((x) => textOf(x) === 'Rue de l’Église 5, 1000 Bruxelles'), 3000);
    // la recherche tapée avec « ' » part telle quelle
    expect(asked).toEqual(["rue de l'eglise 5"]);
    expect(straight(f.list)).toEqual([]);
    [...f.list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b.querySelector('.s1')).startsWith('Rue de l’Église'))!.click();
    expect(f.input.value).toBe('Rue de l’Église 5, 1000 Bruxelles');
    expect(picks[0]).toMatchObject({ kind: 'address', label: EGLISE, lat: 50.8503, lon: 4.3517 });
  });

  it('un texte repris d’un champ que Quai a rempli (« ’ ») : le service d’adresses reçoit « \' », et l’adresse est retrouvée', async () => {
    const asked: string[] = [];
    const searched: string[] = [];
    const hz = harness({ settings: defaults(), core: withGeo(asked, searched) });
    const f = placeField(hz.ctx, { id: 'f', label: 'Arrivée', onPick: () => undefined });
    mount(f.el);
    type(f.input, 'Rue de l’Église 5');
    await until(() => [...f.list.querySelectorAll('.s1')].some((x) => textOf(x) === 'Rue de l’Église 5, 1000 Bruxelles'), 3000);
    expect(asked).toEqual(["Rue de l'Église 5"]);
    for (const q of asked) expect(q).not.toContain('’');
  });

  it('« Mes favoris » (adresses récentes, trajet fixe vers une adresse), titre et champs de la recherche : aucune « \' » ; réglages inchangés', async () => {
    const to = { type: 'address' as const, label: EGLISE, lat: 50.8503, lon: 4.3517 };
    const s = defaults({
      favorites: [{ kind: 'trip', id: 'fav-e', from: { type: 'area', areaId: NAMUR.areaId, op: 'sncb', name: NAMUR.name, lat: NAMUR.lat, lon: NAMUR.lon }, to, propose: 'never' }],
      recent: [{ label: EGLISE, lat: 50.8503, lon: 4.3517, at: 1 }],
    });
    expect(endpointText(to, s)).toBe('Rue de l’Église 5, 1000 Bruxelles');
    const hz = harness({ settings: s });
    const before = JSON.stringify(hz.settings.get());
    const fav = mount(favoritesScreen(hz.ctx));
    expect(textOf(fav.querySelector('.list .t1'))).toBe('Namur → Rue de l’Église 5, 1000 Bruxelles');
    expect([...fav.querySelectorAll('#recents ~ ul li, section[aria-labelledby="recents"] li')].map((x) => textOf(x))).toContain('Rue de l’Église 5, 1000 Bruxelles');
    expect(straight(), 'Mes favoris').toEqual([]);
    mount(homeScreen(hz.ctx));
    expect(straight(), 'accueil').toEqual([]);
    expect(shownLabel({ kind: 'address', label: EGLISE, lat: 50.8503, lon: 4.3517 })).toBe('Rue de l’Église 5, 1000 Bruxelles');
    // rien n'a changé dans les réglages : l'adresse gardée a toujours son apostrophe droite
    expect(JSON.stringify(hz.settings.get())).toBe(before);
    expect(hz.settings.get().recent[0].label).toBe(EGLISE);
  });
});

/* ------------------------------ B15 : le souci d'un favori dit en mots ------------------------------ */

describe('§ 12, B15 (contrôle du téléphone) : le souci d’un favori se lit, avec les mots des lunettes', () => {
  const now = at(7, 31);
  const base = (): Journey => trip('short', at(7, 35), [5, [at(7, 42), at(8, 20), 'IC'], 8]);
  const answer = (j: Journey): FavoriteAnswer => ({ favoriteId: 'fav-bureau', kind: 'trip', state: 'ok', plan: { journeys: [j] }, updatedAt: now });
  const withRide = (patch: Partial<Leg>): Journey => {
    const j = base();
    j.legs[1] = { ...j.legs[1], ...patch };
    return j;
  };
  const works = (): Journey => ({ ...base(), alerts: [{ kind: 'works', text: "! Travaux : arrêt Porte d'Anderlecht déplacé", at: now }] });

  it('exactement les mots de troubleText (lunettes), aucun mot nouveau ; un retard seul, à l’heure, en calcul : rien', () => {
    const cases: [Journey, string][] = [
      [withRide({ cancelled: true }), 'IC supprimé'],
      [withRide({ platform: '4', newPlatform: '6' }), 'voie 6 au lieu de 4'],
      [withRide({ newPlatform: '6' }), 'voie modifiée'],
      [works(), 'Travaux : arrêt Porte d’Anderlecht déplacé'],
    ];
    for (const [j, words] of cases) {
      expect(homeFavoriteTrouble(answer(j), now)).toBe(words);
      // les mots des lunettes, à l'apostrophe typographique près
      expect(homeFavoriteTrouble(answer(j), now)).toBe(troubleText(j).replace(/'/g, '’'));
      expect(favoriteTrouble(answer(j), now)).toBe(true);
    }
    expect(homeFavoriteTrouble(answer(withRide({ delayMin: 7, rt: true })), now)).toBe('');
    expect(homeFavoriteTrouble(answer(base()), now)).toBe('');
    expect(homeFavoriteTrouble(undefined, now)).toBe('');
    // un arrêt favori : son prochain départ, les mêmes mots
    const d = (patch: Partial<Departure>): Departure => ({ op: 'stib', mode: 'tram', line: '81', head: N('Montgomery'), sched: now + 4 * 60_000, est: now + 4 * 60_000, rt: true, delayMin: 0, cancelled: false, ...patch });
    const stop = (dep: Departure): FavoriteAnswer => ({ favoriteId: 'fav-stop', kind: 'stop', state: 'ok', board: { area: { id: PDA.areaId, op: 'stib', n: PDA.name, lat: PDA.lat, lon: PDA.lon, modes: ['tram'], lines: ['81'] }, departures: [dep] } as FavoriteAnswer['board'], updatedAt: now });
    expect(homeFavoriteTrouble(stop(d({ cancelled: true })), now)).toBe('tram 81 supprimé');
    expect(homeFavoriteTrouble(stop(d({ platform: '2', newPlatform: '3' })), now)).toBe('voie 3 au lieu de 2');
    expect(homeFavoriteTrouble(stop(d({})), now)).toBe('');
  });

  it('à l’écran : un texte caché juste après le nom, qui part avec le souci ; le nom, le « ! » et le nom des boutons ne changent pas', async () => {
    let current = answer(withRide({ cancelled: true }));
    const hz = harness({ settings: preset11(), now, here: SCENARIO.s1, flags: { noRt: true }, core: (c) => ({ ...c, answer: async (f, here, st) => (f.id === 'fav-bureau' ? { ...current, updatedAt: now } : c.answer(f, here, st)) }) });
    withGuide(hz.glasses);
    mount(homeScreen(hz.ctx));
    const row = () => [...document.querySelectorAll<HTMLElement>('.fav-card .fav-row')].find((r) => textOf(r.querySelector('.t1')).startsWith('Bureau'))!;
    const said = () => row().querySelector<HTMLElement>('.fav-trouble')!;
    await until(() => row().querySelector('.t1')!.textContent === 'Bureau\u00a0!');
    expect(said().textContent).toBe('IC supprimé');
    expect([said().hidden, said().classList.contains('sr-only')]).toEqual([false, true]);
    // juste après le nom, avant la réponse : lu dans cet ordre
    expect([...row().querySelector('.txt')!.children].map((c) => c.className)).toEqual(['t1', 'sr-only fav-trouble', 't2 answer']);
    const labels = [...row().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Afficher Bureau dans les lunettes', 'Y aller\u00a0: Bureau']);
    // les autres favoris, sans souci : rien à lire en plus
    for (const r of document.querySelectorAll<HTMLElement>('.fav-card .fav-row')) if (r !== row()) expect(r.querySelector<HTMLElement>('.fav-trouble')!.hidden).toBe(true);
    // plus de souci au calcul suivant (ici, l'accueil rouvert) : le texte part avec le « ! »
    current = answer(base());
    mount(homeScreen(hz.ctx));
    await until(() => row().querySelector('.t1')!.textContent === 'Bureau' && said().hidden);
    expect(said().textContent).toBe('');
  });
});
