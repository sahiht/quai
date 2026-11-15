// @vitest-environment happy-dom
/**
 * 1.2.10 (PRD-1.2.10 § 3.4, § 3.9) : Quai Web et la plateforme navigateur : images du guidage dessinées pixel pour
 * pixel (les mêmes que dans les lunettes), lisibles par les tests et décrites en mots ; bouton « Appui long », touche
 * L et doigt gardé sur l'écran : geste `long`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderImage } from '../../src/glasses/images';
import type { HubSignal } from '../../src/glasses/gestures';
import type { Gesture } from '../../src/glasses/nav';
import type { ContainerSpec, ImageSpec } from '../../src/glasses/types';
import { createBrowserPlatform } from '../../src/platform/browser';
import { describeContainers, drawImages, GlassesCanvas, GREEN, imageRGBA, withCanvasImages, type PaintedImage } from '../../src/web/display';
import { attachKeyboard, attachScreenGestures, DOUBLE_TAP_MS, GESTURES, keyBelongsToFocus, keyToGesture, LONG_PRESS_MS, type Timers } from '../../src/web/gestures';
import { createWebGlassesPort } from '../../src/web/port';
import { mountShell } from '../../src/web/shell';

afterEach(() => document.body.replaceChildren());

const CS: ContainerSpec[] = [
  { id: 1, name: 'title', x: 28, y: 3, w: 400, h: 27, content: 'Bureau', level: 2, capture: true },
  { id: 3, name: 'colA', x: 196, y: 60, w: 352, h: 81, content: 'à gauche dans 40 m', level: 4, capture: false },
];
const TURN: ImageSpec = { id: 20, name: 'img-turn', x: 28, y: 33, w: 144, h: 144, image: { kind: 'turn', turn: 'left' } };
const SIGN: ImageSpec = { id: 21, name: 'img-sign', x: 28, y: 33, w: 144, h: 144, image: { kind: 'sign', label: 'bus', value: '6' } };

/** Faux minuteurs : avancer le temps à la main. */
function fakeTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) {
      due.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clear(id) {
      due.delete(id as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

function pointer(el: HTMLElement, type: string, x: number, y: number, t: number, id = 1): void {
  const e = new Event(type);
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: y }, timeStamp: { value: t }, pointerId: { value: id }, pointerType: { value: 'touch' }, button: { value: 0 } });
  el.dispatchEvent(e);
}

describe('images dessinées dans l’écran de Quai Web', () => {
  it('pixel pour pixel : vert des lunettes, opacité niveau × 17 ; bandes horizontales sans canvas hors écran', () => {
    const px = renderImage(SIGN);
    const rgba = imageRGBA(px);
    expect(rgba.length).toBe(px.length * 4);
    for (let i = 0; i < px.length; i += 97) expect(Array.from(rgba.subarray(i * 4, i * 4 + 4))).toEqual([0x33, 0xff, 0x66, px[i] * 17]);
    // repli par bandes : le dessin reconstitue exactement les niveaux, dans le conteneur, sur fond noir
    const grid = new Float64Array(576 * 288).fill(-1);
    let alpha = 1;
    let fill = '';
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      fillRect: (x: number, y: number, w: number, h: number) => {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy * 576 + xx] = fill === '#000' ? 0 : alpha * 15;
      },
      get globalAlpha() {
        return alpha;
      },
      set globalAlpha(v: number) {
        alpha = v;
      },
      get fillStyle() {
        return fill;
      },
      set fillStyle(v: string) {
        fill = v;
      },
    };
    drawImages(ctx as never, [{ spec: SIGN, pixels: px }]);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 144; x++) expect(Math.round(grid[(SIGN.y + y) * 576 + SIGN.x + x])).toBe(px[y * 144 + x]);
    expect(grid[0]).toBe(-1);
    expect(grid[(SIGN.y + 144) * 576 + SIGN.x]).toBe(-1);
    // conteneur créé mais rien de dessiné : rien (comme sur les G2) ; pixels de mauvaise taille : rien
    const calls: unknown[] = [];
    drawImages({ ...ctx, fillRect: (...a: unknown[]) => calls.push(a) } as never, [
      { spec: TURN, pixels: null },
      { spec: TURN, pixels: new Uint8Array(10) },
    ]);
    expect(calls).toEqual([]);
    expect(GREEN).toBe('#33ff66');
  });

  it('GlassesCanvas : nouvelle page avec ses conteneurs d’image vides, image dessinée, texte mis à jour sans les perdre', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const seen: (readonly PaintedImage[])[] = [];
    const screen = new GlassesCanvas(canvas, (_cs, imgs) => seen.push(imgs.map((i) => ({ ...i }))), false);
    screen.paint(CS, [TURN]);
    expect(screen.images).toEqual([{ spec: TURN, pixels: null }]);
    expect(JSON.parse(canvas.dataset.images!)).toEqual([{ id: 20, name: 'img-turn', x: 28, y: 33, w: 144, h: 144, image: { kind: 'turn', turn: 'left' }, drawn: false }]);
    expect(canvas.hasAttribute('aria-description')).toBe(false);
    expect(screen.paintImage(TURN)).toBe(true);
    expect(Array.from(screen.images[0].pixels!)).toEqual(Array.from(renderImage(TURN)));
    expect(JSON.parse(canvas.dataset.images!)[0].drawn).toBe(true);
    expect(canvas.getAttribute('aria-description')).toBe('flèche à gauche');
    // autre conteneur, autre nom ou autre taille : refusé
    expect(screen.paintImage(SIGN)).toBe(false);
    expect(screen.paintImage({ ...TURN, name: 'autre' })).toBe(false);
    expect(screen.paintImage({ ...TURN, w: 100 })).toBe(false);
    // texte mis à jour (textContainerUpgrade) : l'image reste
    screen.paint([{ ...CS[0], content: 'Bureau 08:12' }, CS[1]]);
    expect(screen.images[0].pixels).not.toBeNull();
    // nouvelle page sans image : plus rien
    screen.paint(CS, []);
    expect(screen.images).toEqual([]);
    expect(canvas.dataset.images).toBe('[]');
    expect(seen.map((s) => s.length)).toEqual([1, 1, 1, 0]);
    expect(seen[1][0].pixels).not.toBeNull();
  });

  it('mêmes règles que l’appli Even : une image hors des limites du SDK n’existe pas ici non plus', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const canvas = document.createElement('canvas');
    const screen = new GlassesCanvas(canvas, undefined, false);
    screen.paint(CS, [{ ...TURN, w: 300 }, { ...SIGN, name: 'title' }, SIGN]);
    expect(screen.images.map((i) => i.spec.name)).toEqual(['img-sign']);
    expect(screen.paintImage({ ...TURN, w: 300 })).toBe(false);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const p = createBrowserPlatform(() => 0, mount);
    await p.glasses.rebuild(CS, { images: [{ ...TURN, h: 200 }, SIGN] });
    expect([...mount.querySelectorAll<HTMLCanvasElement>('canvas.g-img')].map((c) => c.dataset.name)).toEqual(['img-sign']);
    expect(await p.glasses.paint!({ ...TURN, h: 200 })).toBe(false);
    warn.mockRestore();
  });

  it('port de Quai Web avec images (web/main.ts) : page, image dessinée, texte mis à jour sans la perdre, page suivante sans image', async () => {
    const canvas = document.createElement('canvas');
    const screen = new GlassesCanvas(canvas, undefined, false);
    const port = withCanvasImages(createWebGlassesPort(screen), screen);
    expect(await port.start(CS, { images: [TURN] })).toBe(true);
    expect(screen.images.map((i) => [i.spec.name, i.pixels])).toEqual([['img-turn', null]]);
    expect(await port.paint!(TURN)).toBe(true);
    expect(Array.from(screen.images[0].pixels!)).toEqual(Array.from(renderImage(TURN)));
    await port.upgrade({ ...CS[1], content: 'à gauche dans 30 m' }, { content: true, level: false });
    expect(screen.images[0].pixels).not.toBeNull();
    expect(port.containers()[1].content).toBe('à gauche dans 30 m');
    expect(await port.rebuild(CS, { images: [SIGN] })).toBe(true);
    expect(await port.paint!(TURN)).toBe(false);
    expect(await port.paint!(SIGN)).toBe(true);
    await port.rebuild(CS);
    expect(screen.images).toEqual([]);
    // le reste du port est celui de web/port.ts : signaux
    const got: HubSignal[] = [];
    port.onSignal((s) => got.push(s));
    port.emit({ kind: 'gesture', gesture: 'long' });
    expect(got).toEqual([{ kind: 'gesture', gesture: 'long' }]);
  });

  it('texte lisible : l’image dessinée est dite (« image : flèche à gauche »), pas un conteneur vide', () => {
    const text = describeContainers(CS, [
      { spec: TURN, pixels: renderImage(TURN) },
      { spec: SIGN, pixels: null },
    ]);
    expect(text).toContain('image : flèche à gauche');
    expect(text).not.toContain('panneau');
    expect(describeContainers(CS)).not.toContain('image');
  });
});

describe('appui long sur Quai Web', () => {
  it('bouton « Appui long » à côté de « Toucher » et « Double toucher », data-g="long" comme les autres', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shell = mountShell(host, 'lunettes');
    const buttons = [...shell.gestures.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['▲', '▼', 'Toucher', 'Double toucher', 'Appui long']);
    expect(buttons.map((b) => b.dataset.g)).toEqual(['up', 'down', 'tap', 'double', 'long']);
    expect(buttons[4].className).toBe('w-g w-g-long');
    // câblage de web/main.ts : chaque bouton data-g dont le geste est connu envoie son geste, une fois par clic
    const got: Gesture[] = [];
    shell.gestures.querySelectorAll<HTMLButtonElement>('button[data-g]').forEach((b) => {
      const g = b.dataset.g as Gesture;
      if (GESTURES.includes(g)) b.addEventListener('click', () => got.push(g));
    });
    buttons[4].click();
    buttons[2].click();
    expect(got).toEqual(['long', 'tap']);
    // aide : typographie française, espace insécable devant les deux-points
    const help = shell.root.querySelector('.w-help')!.textContent ?? '';
    expect(help).toContain('Appui long\u00a0: garde le doigt posé.');
    expect(help).toContain('L = appui long.');
    expect(help).not.toMatch(/ [:;!?]/);
    expect(help).not.toMatch(/[—–]/);
  });

  it('doigt gardé 600 ms sans bouger : appui long, et le relâcher ne fait rien de plus ; un toucher reste un toucher', () => {
    const el = document.createElement('div');
    const timers = fakeTimers();
    const got: Gesture[] = [];
    const off = attachScreenGestures(el, (g) => got.push(g), timers);
    pointer(el, 'pointerdown', 100, 100, 0);
    timers.advance(LONG_PRESS_MS - 1);
    expect(got).toEqual([]);
    timers.advance(1);
    expect(got).toEqual(['long']);
    pointer(el, 'pointerup', 101, 101, 900);
    timers.advance(DOUBLE_TAP_MS * 2);
    expect(got).toEqual(['long']);
    // toucher bref : un toucher (après le délai du double toucher), pas d'appui long
    pointer(el, 'pointerdown', 100, 100, 2000);
    timers.advance(100);
    pointer(el, 'pointerup', 100, 100, 2100);
    timers.advance(LONG_PRESS_MS + DOUBLE_TAP_MS);
    expect(got).toEqual(['long', 'tap']);
    // doigt qui glisse : pas d'appui long, un glisser
    pointer(el, 'pointerdown', 100, 100, 5000);
    pointer(el, 'pointermove', 100, 140, 5100);
    timers.advance(LONG_PRESS_MS * 2);
    pointer(el, 'pointerup', 100, 160, 5900);
    expect(got).toEqual(['long', 'tap', 'down']);
    // gestes retirés : plus rien
    off();
    pointer(el, 'pointerdown', 100, 100, 9000);
    timers.advance(LONG_PRESS_MS);
    expect(got).toHaveLength(3);
  });

  it('touche L : appui long ; un champ garde sa touche ; un bouton de geste garde Entrée, pas les flèches', () => {
    expect(keyToGesture('l')).toBe('long');
    expect(keyToGesture('L')).toBe('long');
    const inGestureBar = { tagName: 'BUTTON', getAttribute: () => null, closest: (sel: string) => (sel === '[data-g]' ? {} : null) };
    expect(keyBelongsToFocus(inGestureBar, 'Enter')).toBe(true);
    expect(keyBelongsToFocus(inGestureBar, 'ArrowDown')).toBe(false);
    const got: Gesture[] = [];
    const off = attachKeyboard(window, (g) => got.push(g), () => true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
    off();
    expect(got).toEqual(['long']);
  });
});

describe('plateforme navigateur (développement) : images et appui long', () => {
  it('images de la page dessinées pixel pour pixel dans l’émulateur, gardées au fil des mises à jour du texte', async () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const p = createBrowserPlatform(() => 0, mount);
    const screen = mount.querySelector<HTMLElement>('.g-screen')!;
    expect(await p.glasses.rebuild(CS, { images: [TURN, SIGN], menu: [{ id: 1, label: 'Arrêter le guidage' }] })).toBe(true);
    const imgs = () => [...screen.querySelectorAll<HTMLCanvasElement>('canvas.g-img')];
    expect(imgs().map((c) => [c.dataset.name, c.dataset.drawn, c.width, c.height])).toEqual([
      ['img-turn', '0', 144, 144],
      ['img-sign', '0', 144, 144],
    ]);
    expect(await p.glasses.paint!(SIGN)).toBe(true);
    expect(imgs()[1].dataset.drawn).toBe('1');
    expect(imgs()[1].getAttribute('aria-label')).toBe('panneau bus 6');
    expect(JSON.parse(imgs()[1].dataset.image!)).toEqual(SIGN.image);
    expect(imgs()[1].style.left).toBe('28px');
    expect(await p.glasses.paint!({ ...TURN, id: 99 })).toBe(false);
    await p.glasses.upgrade({ ...CS[1], content: 'à gauche dans 30 m' }, { content: true, level: false });
    expect(imgs()[1].dataset.drawn).toBe('1');
    await p.glasses.rebuild(CS);
    expect(imgs()).toHaveLength(0);
    expect(typeof p.location.watch).toBe('function');
  });

  it('bouton « Appui long » et touche L : geste `long`', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const p = createBrowserPlatform(() => 0, mount);
    const got: HubSignal[] = [];
    p.glasses.onSignal((s) => got.push(s));
    const b = [...mount.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent === 'Appui long')!;
    b.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L' }));
    expect(got).toEqual([
      { kind: 'gesture', gesture: 'long' },
      { kind: 'gesture', gesture: 'long' },
    ]);
    vi.restoreAllMocks();
  });
});
