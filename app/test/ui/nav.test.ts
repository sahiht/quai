import { describe, expect, it } from 'vitest';
import { evenHubEventFromJson } from '@evenrealities/even_hub_sdk';
import { current, handleGesture, initNav, parseNav, push, serializeNav, setSelection, type NavState } from '../../src/glasses/nav';
import { DEBOUNCE, GestureFilter, readHubEvent } from '../../src/glasses/gestures';
import type { GlassesView, Item } from '../../src/glasses/types';

const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ a: `Élément ${i}`, action: { kind: 'open', route: { screen: 'nearby' } } }));
const view = (n = 4, patch: Partial<GlassesView> = {}): GlassesView => ({ screen: 'home', layout: 'menu', title: 'Quai', clock: '07:31', items: items(n), hints: '', ...patch });

describe('machine d’états des gestes', () => {
  it('glisser haut/bas déplace la sélection, bornée aux extrémités', () => {
    let s: NavState = initNav({ screen: 'home' });
    const v = view(3);
    let r = handleGesture(s, 'up', v, 7);
    expect(current(r.state).sel).toBe(0);
    expect(r.effect.kind).toBe('none');
    s = r.state;
    for (const expected of [1, 2, 2]) {
      r = handleGesture(s, 'down', v, 7);
      s = r.state;
      expect(current(s).sel).toBe(expected);
    }
    expect(r.effect.kind).toBe('none');
    r = handleGesture(s, 'up', v, 7);
    expect(current(r.state).sel).toBe(1);
    expect(r.effect.kind).toBe('render');
  });

  it('toucher ouvre l’élément sélectionné', () => {
    const s = setSelection(initNav({ screen: 'home' }), 2, 0);
    const v = view(3);
    v.items[2].action = { kind: 'open', route: { screen: 'stations' } };
    const r = handleGesture(s, 'tap', v, 7);
    expect(r.effect).toEqual({ kind: 'intent', intent: { kind: 'open', route: { screen: 'stations' } } });
  });

  it('double toucher : retour, puis sortie depuis la racine', () => {
    let s = push(initNav({ screen: 'home' }), { screen: 'nearby' });
    let r = handleGesture(s, 'double', view(), 7);
    expect(r.effect.kind).toBe('back');
    s = r.state;
    expect(current(s).route.screen).toBe('home');
    r = handleGesture(s, 'double', view(), 7);
    expect(r.effect.kind).toBe('exit');
    expect(r.state).toBe(s);
  });

  it('écran de message : pas de sélection, toucher = action de l’écran', () => {
    const s = initNav({ screen: 'message', kind: 'firstRun', title: 'Quai', lines: [] });
    const v = view(3, { layout: 'message', screen: 'message', tap: { kind: 'continue' } });
    expect(handleGesture(s, 'down', v, 7).effect.kind).toBe('none');
    expect(handleGesture(s, 'tap', v, 7).effect).toEqual({ kind: 'intent', intent: { kind: 'continue' } });
  });

  it('sélection initiale proposée par la vue (prochain arrêt)', () => {
    const s = initNav({ screen: 'home' });
    const v = view(7, { initialSel: 2, initialTop: 1 });
    const r = handleGesture(s, 'down', v, 4);
    expect(current(r.state).sel).toBe(3);
    expect(current(r.state).fresh).toBe(false);
  });

  it('défilement : la fenêtre suit la sélection', () => {
    let s = initNav({ screen: 'home' });
    const v = view(10);
    for (let i = 0; i < 8; i++) s = handleGesture(s, 'down', v, 4).state;
    expect(current(s).sel).toBe(8);
    expect(current(s).top).toBe(5);
  });

  it('écran sans curseur (étapes, départs) : ▲▼ font défiler, puis « edge » au bout ; toucher = action de l’écran', () => {
    const rows = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ a: `Étape ${i}` }));
    const v = view(8, { layout: 'steps', screen: 'steps', items: rows(8), scroll: true, tap: { kind: 'follow' } });
    let s: NavState = initNav({ screen: 'home' });
    let r = handleGesture(s, 'down', v, 6);
    expect(r.effect.kind).toBe('render');
    expect(current(r.state).top).toBe(2);
    s = r.state;
    r = handleGesture(s, 'down', v, 6);
    expect(r.effect).toEqual({ kind: 'edge', dir: 'down' });
    r = handleGesture(s, 'up', v, 6);
    expect(r.effect.kind).toBe('render');
    expect(current(r.state).top).toBe(0);
    expect(handleGesture(r.state, 'up', v, 6).effect).toEqual({ kind: 'edge', dir: 'up' });
    expect(handleGesture(s, 'tap', v, 6).effect).toEqual({ kind: 'intent', intent: { kind: 'follow' } });
    // tout tient : chaque glissement est un « edge »
    const short = { ...v, items: rows(3) };
    expect(handleGesture(initNav({ screen: 'home' }), 'down', short, 6).effect).toEqual({ kind: 'edge', dir: 'down' });
    // départs sans action d'élément : le toucher reste celui de l'écran
    const board = view(3, { layout: 'board', screen: 'board', items: rows(3), scroll: true, tap: { kind: 'toggleStation' } });
    expect(handleGesture(initNav({ screen: 'home' }), 'tap', board, 6).effect).toEqual({ kind: 'intent', intent: { kind: 'toggleStation' } });
  });

  it('instantané sérialisable pour l’arrière-plan', () => {
    const s = push(initNav({ screen: 'home' }), { screen: 'board', areaId: 'stib:6357F', filter: [{ line: '3', head: 'churchill' }] });
    const back = parseNav(serializeNav(s));
    expect(back).toEqual(s);
    expect(parseNav('{"stack":[]}')).toBeNull();
    expect(parseNav('pas du json')).toBeNull();
    expect(parseNav({ stack: [{ route: {} }] })).toBeNull();
    // écrans de la 1.0 retirés en 1.1 (Q6) : ôtés de la pile
    const old = { stack: [{ route: { screen: 'home' }, sel: 0, top: 0 }, { route: { screen: 'journeys', label: 'Bureau' }, sel: 1, top: 0 }] };
    expect(parseNav(old)?.stack.map((f) => f.route.screen)).toEqual(['home']);
    expect(parseNav({ stack: [{ route: { screen: 'trip' }, sel: 0, top: 0 }] })).toBeNull();
    // 1.2.2 : « Aller à… » de la 1.2.1 et « Autres favoris » de la 1.2.0 : « Favoris »
    expect(parseNav({ stack: [{ route: { screen: 'home' }, sel: 0, top: 0 }, { route: { screen: 'places' }, sel: 3, top: 1 }] })?.stack[1]).toEqual({ route: { screen: 'favorites' }, sel: 3, top: 1, fresh: false });
    expect(parseNav({ stack: [{ route: { screen: 'favorites', exclude: ['a'] }, sel: 0, top: 0 }] })?.stack[0].route).toEqual({ screen: 'favorites' });
    // les écrans de la 1.2.2 passent d'une WebView à l'autre
    const s122 = push(push(initNav({ screen: 'home' }), { screen: 'lines' }), { screen: 'line', areaId: 'tec:Bbrlmer1', op: 'tec', line: 'W', name: { fr: 'Merbraine', nl: 'Merbraine' } });
    expect(parseNav(serializeNav(s122))).toEqual(s122);
  });
});

describe('événements du SDK (formats relevés dans le simulateur)', () => {
  const ev = (type: string, jsonData: Record<string, unknown>) => evenHubEventFromJson({ type, jsonData });

  it('gestes et cycle de vie', () => {
    expect(readHubEvent(ev('textEvent', { containerID: 1, containerName: 'title', eventType: 1 }))).toEqual({ kind: 'gesture', gesture: 'up' });
    expect(readHubEvent(ev('textEvent', { containerID: 1, containerName: 'title', eventType: 2 }))).toEqual({ kind: 'gesture', gesture: 'down' });
    expect(readHubEvent(ev('sysEvent', { eventSource: 1 }))).toEqual({ kind: 'gesture', gesture: 'tap' });
    expect(readHubEvent(ev('sysEvent', { eventType: 3, eventSource: 1 }))).toEqual({ kind: 'gesture', gesture: 'double' });
    expect(readHubEvent(ev('sysEvent', { eventType: 4 }))).toEqual({ kind: 'foreground' });
    expect(readHubEvent(ev('sysEvent', { eventType: 5 }))).toEqual({ kind: 'background' });
    expect(readHubEvent(ev('sysEvent', { eventType: 6 }))).toEqual({ kind: 'exit', abnormal: true });
    expect(readHubEvent(ev('sysEvent', { eventType: 7 }))).toEqual({ kind: 'exit', abnormal: false });
    expect(readHubEvent(ev('listEvent', { containerID: 2 }))).toEqual({ kind: 'gesture', gesture: 'tap' });
    expect(readHubEvent({})).toBeNull();
    expect(readHubEvent(ev('sysEvent', { eventType: 8, imuData: { x: 1 } }))).toBeNull();
  });

  it('anti-rebond des gestes', () => {
    const f = new GestureFilter();
    expect(f.accept('tap', 1000)).toBe(true);
    expect(f.accept('tap', 1050)).toBe(false);
    expect(f.accept('double', 1100)).toBe(false);
    expect(f.accept('double', 1300)).toBe(true);
    expect(f.accept('down', 1350)).toBe(false);
    expect(f.accept('down', 2000)).toBe(true);
    expect(f.accept('down', 2000 + DEBOUNCE.scrollSameDirMs - 1)).toBe(false);
    expect(f.accept('down', 2000 + DEBOUNCE.scrollSameDirMs)).toBe(true);
    expect(f.accept('up', 2000 + DEBOUNCE.scrollSameDirMs + DEBOUNCE.scrollDirChangeMs)).toBe(true);
    f.notifyRender(5000);
    expect(f.accept('up', 5040)).toBe(false);
    expect(f.accept('up', 5100)).toBe(true);
  });
});
