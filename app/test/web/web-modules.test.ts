/**
 * Quai Web : modules sans DOM réel (canvas, gestes, port, position, stockage, écran allumé), avec des doubles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTextWidth } from '@evenrealities/pretext';
import { layoutPage } from '../../src/glasses/layout';
import { boardView, messageView } from '../../src/glasses/views';
import type { ContainerSpec, GlassesView } from '../../src/glasses/types';
import { advance, BASELINE, describeContainers, drawContainers, glyphPositions, LEVEL_ALPHA } from '../../src/web/display';
import { classifyPress, keyBelongsToFocus, keyToGesture, TapSequencer } from '../../src/web/gestures';
import { createWebLocation, locationText, MANUAL_KEY } from '../../src/web/location';
import { createWebGlassesPort } from '../../src/web/port';
import { CACHE_PREFIX, clearCache, webStorageBackend } from '../../src/web/storage';
import { screenWakeLock } from '../../src/web/wakelock';
import { createKV } from '../../src/platform/kv';
import { loadSettings, saveSettings } from '../../src/settings';
import type { HubSignal } from '../../src/glasses/gestures';
import { defaults } from '../ui/helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('écran des lunettes dessiné dans un canvas', () => {
  it('abscisses des caractères identiques au micrologiciel (crénage compris)', () => {
    for (const line of ['Gare du Nord, tram (STIB)', 'T3   Churchill   2 min', 'AVAWTo', '▲▼ départs   toucher : ★ favori', '           12:10']) {
      const pos = glyphPositions(line);
      const cps = [...line];
      expect(pos).toHaveLength(cps.length);
      expect(pos[0]).toBe(0);
      for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeGreaterThanOrEqual(pos[i - 1]);
      // le dernier caractère finit exactement à la largeur mesurée par pretext
      expect(pos[pos.length - 1] + advance(cps[cps.length - 1].codePointAt(0)!)).toBe(getTextWidth(line));
    }
  });

  it('dessin : fond noir, chaque caractère à sa place, symboles en vecteur, luminosité par conteneur', () => {
    const calls: { op: string; args: unknown[]; alpha: number }[] = [];
    let alpha = 1;
    const ctx = {
      font: '',
      fillStyle: '' as string,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      get globalAlpha() {
        return alpha;
      },
      set globalAlpha(v: number) {
        alpha = v;
      },
      save: () => calls.push({ op: 'save', args: [], alpha }),
      restore: () => calls.push({ op: 'restore', args: [], alpha }),
      fillRect: (...a: unknown[]) => calls.push({ op: 'fillRect', args: a, alpha }),
      fillText: (...a: unknown[]) => calls.push({ op: 'fillText', args: a, alpha }),
      measureText: (t: string) => ({ width: t === 'W' ? 30 : 8 }) as TextMetrics,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      translate: (...a: unknown[]) => calls.push({ op: 'translate', args: a, alpha }),
      scale: (...a: unknown[]) => calls.push({ op: 'scale', args: a, alpha }),
      moveTo: () => undefined,
      lineTo: () => undefined,
      closePath: () => undefined,
      fill: () => calls.push({ op: 'fill', args: [], alpha }),
    };
    const cs: ContainerSpec[] = [
      { id: 1, name: 'title', x: 28, y: 3, w: 300, h: 27, content: 'Wa', level: 4, capture: true },
      { id: 4, name: 'cursor', x: 4, y: 33, w: 22, h: 27, content: '▶', level: 4, capture: false },
      { id: 8, name: 'foot', x: 28, y: 258, w: 544, h: 27, content: 'ab', level: 2, capture: false },
    ];
    drawContainers(ctx, cs);
    expect(calls[1]).toMatchObject({ op: 'fillRect', args: [0, 0, 576, 288] });
    const texts = calls.filter((c) => c.op === 'fillText');
    // « W » plus large que dans les lunettes : resserré (scale), dessiné à l'origine translatée
    const wScale = calls.find((c) => c.op === 'scale');
    expect(wScale?.args[0]).toBeCloseTo(advance('W'.codePointAt(0)!) / 30, 5);
    expect(calls.find((c) => c.op === 'translate')?.args).toEqual([28, 3 + BASELINE]);
    // « a » plus étroit : centré dans sa largeur
    const a = texts.find((t) => t.args[0] === 'a' && t.alpha === 1);
    expect(a?.args[1]).toBeCloseTo(28 + glyphPositions('Wa')[1] + (advance('a'.codePointAt(0)!) - 8) / 2, 5);
    // ▶ : triangle, jamais un caractère (pas d'émoji)
    expect(texts.some((t) => t.args[0] === '▶')).toBe(false);
    expect(calls.some((c) => c.op === 'fill')).toBe(true);
    // pied d'écran (aides) : niveau 2, plus discret
    expect(texts.filter((t) => t.args[0] === 'b').map((t) => t.alpha)).toEqual([LEVEL_ALPHA[2]]);
    expect(LEVEL_ALPHA[4]).toBe(1);
    expect(LEVEL_ALPHA[3]).toBeCloseTo(230 / 255, 1);
    expect(LEVEL_ALPHA[2]).toBeCloseTo(197 / 255, 1);
  });

  it('texte lisible pour les lecteurs d’écran : titre, heure, lignes, aides ; départs sans curseur (M6.2)', () => {
    const v = boardView(
      {
        area: { id: 'stib:6357F', op: 'stib', n: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 0, lon: 0, modes: ['tram'], lines: ['3'] },
        departures: [{ op: 'stib', mode: 'tram', line: '3', head: { fr: 'Churchill', nl: 'Churchill' }, sched: 0, est: 120_000, rt: true, delayMin: 0, cancelled: false }],
        anyPlanned: false,
        rtErrors: [],
        updatedAt: 0,
      },
      { now: 0, settings: defaults() },
      { kept: false },
    );
    const text = describeContainers(layoutPage(v, { sel: 0, top: 0 }).containers);
    expect(text).toContain('Gare du Nord, tram (STIB)');
    expect(text).toContain('T3, Churchill, 2 min');
    expect(text).not.toContain('sélection');
    expect(text).toContain('départs');
    // une liste à curseur dit la ligne choisie (liste écrite ici : les textes des écrans des lunettes changent)
    const list: GlassesView = { screen: 'favorites', layout: 'menu', title: 'Favoris', clock: '07:31', items: [{ a: 'Ajouter un favori' }, { a: 'Autre adresse', c: 'sur le téléphone' }], hints: '' };
    const menu = describeContainers(layoutPage(list, { sel: 1, top: 0 }).containers);
    expect(menu).toContain('sélection : Autre adresse, sur le téléphone');
  });
});

describe('gestes de Quai Web', () => {
  it('glisser vertical, toucher, ou rien', () => {
    expect(classifyPress(0, -60, 200)).toBe('up');
    expect(classifyPress(5, 45, 200)).toBe('down');
    expect(classifyPress(3, 4, 150)).toBe('tap');
    expect(classifyPress(80, 30, 200)).toBeNull(); // horizontal
    expect(classifyPress(2, 2, 2000)).toBeNull(); // appui long
    expect(classifyPress(0, 20, 200)).toBeNull(); // trop court pour glisser, trop long pour toucher
  });

  it('toucher simple après un court délai, double toucher si un second toucher suit', () => {
    vi.useFakeTimers();
    const got: string[] = [];
    const t = new TapSequencer((g) => got.push(g), 300);
    t.press();
    vi.advanceTimersByTime(299);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual(['tap']);
    t.press();
    vi.advanceTimersByTime(120);
    t.press();
    expect(got).toEqual(['tap', 'double']);
    vi.advanceTimersByTime(1000);
    expect(got).toEqual(['tap', 'double']);
  });

  it('clavier : ↑ ↓, Entrée = toucher, Échap et Retour arrière = double toucher ; les champs et boutons gardent leurs touches', () => {
    expect(['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace', 'a'].map(keyToGesture)).toEqual(['up', 'down', 'tap', 'double', 'double', null]);
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, getAttribute: (n: string) => (extra[n] as string) ?? null, closest: () => (extra.gesture ? {} : null), isContentEditable: !!extra.editable });
    expect(keyBelongsToFocus(el('INPUT'), 'Backspace')).toBe(true);
    expect(keyBelongsToFocus(el('TEXTAREA'), 'Enter')).toBe(true);
    expect(keyBelongsToFocus(el('BUTTON'), 'Enter')).toBe(true);
    expect(keyBelongsToFocus(el('DIV', { role: 'switch' }), 'Enter')).toBe(true);
    expect(keyBelongsToFocus(el('DIV', { editable: true }), 'Backspace')).toBe(true);
    expect(keyBelongsToFocus(el('CANVAS'), 'Enter')).toBe(false);
    expect(keyBelongsToFocus(el('BODY'), 'ArrowDown')).toBe(false);
    expect(keyBelongsToFocus(el('H1'), 'Escape')).toBe(false);
    // bouton de geste : Entrée l'active, les flèches restent des gestes
    expect(keyBelongsToFocus(el('BUTTON', { gesture: true }), 'Enter')).toBe(true);
    expect(keyBelongsToFocus(el('BUTTON', { gesture: true }), 'ArrowDown')).toBe(false);
    expect(keyBelongsToFocus(null, 'Enter')).toBe(false);
  });
});

describe('port des lunettes de Quai Web', () => {
  it('page, reconstruction, mise à jour d’un conteneur, signaux', async () => {
    const painted: number[] = [];
    const port = createWebGlassesPort({ paint: (cs) => painted.push(cs.length) });
    const page = layoutPage(messageView('Quai', ['Chargement…'], { now: 0, settings: defaults() }), { sel: 0, top: 0 });
    expect(await port.start(page.containers)).toBe(true);
    const title = page.containers[0];
    await port.upgrade({ ...title, content: 'Autre', level: 2 }, { content: true, level: false });
    expect(port.containers()[0]).toMatchObject({ content: 'Autre', level: title.level });
    await port.upgrade({ ...title, content: 'Autre', level: 2 }, { content: true, level: true });
    expect(port.containers()[0].level).toBe(2);
    expect(painted).toEqual([8, 8, 8]);
    const got: HubSignal[] = [];
    const off = port.onSignal((s) => got.push(s));
    port.emit({ kind: 'gesture', gesture: 'down' });
    off();
    port.emit({ kind: 'gesture', gesture: 'up' });
    expect(got).toEqual([{ kind: 'gesture', gesture: 'down' }]);
    await expect(port.exit(1)).resolves.toBeUndefined();
  });
});

function fakeStore(limit = Infinity) {
  const m = new Map<string, string>();
  const size = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = m.get(k);
      m.set(k, v);
      if (size() > limit) {
        if (before === undefined) m.delete(k);
        else m.set(k, before);
        throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      }
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('position de Quai Web', () => {
  type Ok = (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void;
  type Err = (e: { code: number }) => void;
  const geo = (answer: (ok: Ok, err: Err) => void) => ({ getCurrentPosition: (ok: Ok, err: Err) => answer(ok, err) });
  const now = () => 1_000;

  it('position du navigateur : précision dans le texte', async () => {
    const loc = createWebLocation(now, { geo: geo((ok) => ok({ coords: { latitude: 50.86, longitude: 4.359, accuracy: 23 } })), secure: true, store: null, permissions: null });
    const states: string[] = [];
    loc.subscribe((s) => states.push(s.kind));
    expect(await loc.current(100)).toMatchObject({ lat: 50.86, lon: 4.359, source: 'browser' });
    expect(states).toEqual(['pending', 'gps']);
    expect(locationText(loc.state())).toBe('Position du navigateur, précise à 20 m.');
    expect(loc.last()).toMatchObject({ lat: 50.86 });
  });

  it('refusée : message clair, aucune position ; puis endroit choisi, gardé dans le navigateur', async () => {
    const store = fakeStore();
    const loc = createWebLocation(now, { geo: geo((_, err) => err({ code: 1 })), secure: true, store, permissions: null });
    expect(await loc.current(100)).toBeNull();
    expect(loc.state().kind).toBe('denied');
    expect(locationText(loc.state())).toMatch(/^Position refusée par le navigateur\. .*Ou choisis une adresse ou un arrêt ci-dessous\.$/);
    loc.setManual({ lat: 50.86004, lon: 4.36017, label: 'Gare du Nord (tram STIB)' });
    expect(await loc.current()).toMatchObject({ lat: 50.86004, source: 'manual' });
    expect(locationText(loc.state())).toBe('Position choisie : Gare du Nord (tram STIB). Gardée dans ce navigateur.');
    expect(JSON.parse(store.getItem(MANUAL_KEY)!)).toEqual({ lat: 50.86004, lon: 4.36017, label: 'Gare du Nord (tram STIB)' });
    // nouvelle visite : l'arrêt choisi est repris
    const again = createWebLocation(now, { geo: geo((_, err) => err({ code: 1 })), secure: true, store, permissions: null });
    expect(again.state()).toEqual({ kind: 'manual', label: 'Gare du Nord (tram STIB)' });
    expect(again.last()).toMatchObject({ lat: 50.86004, source: 'manual' });
    again.setManual(null);
    expect(store.getItem(MANUAL_KEY)).toBeNull();
  });

  it('délai dépassé, pas d’https, pas d’API : états distincts ; mode test : position simulée', async () => {
    vi.useFakeTimers();
    const slow = createWebLocation(now, { geo: geo(() => undefined), secure: true, store: null, permissions: null });
    const p = slow.current(100);
    vi.advanceTimersByTime(700);
    expect(await p).toBeNull();
    expect(slow.state().kind).toBe('unavailable');
    vi.useRealTimers();
    expect((await createWebLocation(now, { geo: geo(() => undefined), secure: false, store: null, permissions: null }).current(10)) ?? 'aucune').toBe('aucune');
    const insecure = createWebLocation(now, { geo: null, secure: false, store: null, permissions: null });
    await insecure.current(10);
    expect(locationText(insecure.state())).toMatch(/https/);
    const none = createWebLocation(now, { geo: null, secure: true, store: null, permissions: null });
    await none.current(10);
    expect(none.state().kind).toBe('unsupported');
    const mock = createWebLocation(now, { geo: null, secure: true, store: null, permissions: null });
    mock.useMock(50.4655, 4.859);
    expect(await mock.current()).toMatchObject({ lat: 50.4655, source: 'mock' });
  });

  it('permission déjà refusée : dit tout de suite, sans attendre de demande', async () => {
    const loc = createWebLocation(now, { geo: geo(() => undefined), secure: true, store: null, permissions: { query: async () => ({ state: 'denied' }) } });
    await new Promise((r) => setTimeout(r, 0));
    expect(loc.state().kind).toBe('denied');
  });

  it('aucun texte avec un tiret cadratin ; « une adresse ou un arrêt » partout (PRD-1.2 § 3) ; espaces insécables', () => {
    for (const kind of ['idle', 'pending', 'denied', 'unavailable', 'insecure', 'unsupported', 'mock'] as const) expect(locationText({ kind })).not.toMatch(/[—–]/);
    expect(locationText({ kind: 'unavailable' })).toBe('Position indisponible pour l’instant (pas de signal ou délai dépassé). Choisis une adresse ou un arrêt ci-dessous, ou réessaie.');
    expect(locationText({ kind: 'insecure' })).toBe('La position du navigateur demande une adresse en https. Choisis une adresse ou un arrêt ci-dessous.');
    expect(locationText({ kind: 'unsupported' })).toBe('Ce navigateur ne donne pas la position. Choisis une adresse ou un arrêt ci-dessous.');
    expect(locationText({ kind: 'gps', accuracy: 1500 })).toBe('Position du navigateur très approximative\u00a0: choisis une adresse ou un arrêt pour plus de précision.');
    expect(locationText({ kind: 'manual', label: 'Rue de Fer 25' })).toBe('Position choisie\u00a0: Rue de Fer 25. Gardée dans ce navigateur.');
    for (const kind of ['idle', 'pending', 'denied', 'unavailable', 'insecure', 'unsupported', 'mock'] as const) expect(locationText({ kind }), kind).not.toMatch(/ [:;!?]/);
  });
});

describe('stockage de Quai Web (localStorage)', () => {
  it('réglages enregistrés et relus (nouvelle visite)', async () => {
    const store = fakeStore();
    const s = { ...defaults(), lang: 'nl' as const };
    await saveSettings(createKV(webStorageBackend(store)), s);
    expect((await loadSettings(createKV(webStorageBackend(store)))).lang).toBe('nl');
  });

  it('stockage plein : le cache des horaires est vidé pour que les réglages passent', async () => {
    const store = fakeStore(2000);
    const be = webStorageBackend(store);
    await be.set(`${CACHE_PREFIX}slot.1`, 'x'.repeat(1500));
    expect(store.getItem(`${CACHE_PREFIX}slot.1`)).not.toBeNull();
    await be.set('quai.settings', 'y'.repeat(900));
    expect(store.getItem('quai.settings')).toHaveLength(900);
    expect(store.getItem(`${CACHE_PREFIX}slot.1`)).toBeNull();
    // un cache trop gros ne chasse jamais les réglages : il reste en mémoire pour la visite
    await be.set(`${CACHE_PREFIX}slot.2`, 'z'.repeat(1500));
    expect(store.getItem('quai.settings')).toHaveLength(900);
    expect(await be.get(`${CACHE_PREFIX}slot.2`)).toHaveLength(1500);
    expect(clearCache(store)).toBe(0);
  });

  it('sans localStorage (navigation privée stricte) : en mémoire pour la visite', async () => {
    const be = webStorageBackend(null);
    await be.set('quai.settings', '{"v":1}');
    expect(await be.get('quai.settings')).toBe('{"v":1}');
    await be.set('quai.settings', '');
    expect(await be.get('quai.settings')).toBeNull();
  });
});

describe('écran gardé allumé (Screen Wake Lock)', () => {
  it('pris quand la vue Lunettes est visible, relâché sinon, repris au retour sur la page', async () => {
    const listeners: (() => void)[] = [];
    const doc = { visibilityState: 'visible', addEventListener: (_: string, cb: () => void) => listeners.push(cb) };
    let requests = 0;
    const sentinels: { released: boolean; release(): Promise<void> }[] = [];
    const nav = {
      wakeLock: {
        request: async () => {
          requests++;
          const s = { released: false, release: async () => void (s.released = true) };
          sentinels.push(s);
          return s;
        },
      },
    };
    const lock = screenWakeLock(nav, doc);
    lock.set(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(requests).toBe(1);
    expect(lock.held).toBe(true);
    // page cachée : le navigateur relâche ; au retour, on redemande
    sentinels[0].released = true;
    doc.visibilityState = 'hidden';
    listeners.forEach((l) => l());
    doc.visibilityState = 'visible';
    listeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r, 0));
    expect(requests).toBe(2);
    lock.set(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(sentinels[1].released).toBe(true);
    expect(lock.held).toBe(false);
  });

  it('sans l’API ou en cas de refus : aucune erreur', async () => {
    const doc = { visibilityState: 'visible', addEventListener: () => undefined };
    expect(() => screenWakeLock({}, doc).set(true)).not.toThrow();
    const refus = screenWakeLock({ wakeLock: { request: async () => Promise.reject(new Error('NotAllowedError')) } }, doc);
    refus.set(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(refus.held).toBe(false);
  });
});
