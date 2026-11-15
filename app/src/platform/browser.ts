/**
 * Repli « navigateur » pour le développement sans lunettes : les conteneurs sont dessinés dans un
 * émulateur 576 × 288 sur la page, avec les gestes au clavier (↑ ↓ Entrée Retour arrière) et à la souris.
 *
 * 1.2.10 : images du guidage dessinées pixel pour pixel (les mêmes que dans les lunettes), bouton « Appui long » et
 * touche L (geste `long` : le menu du guidage est rendu par Quai, il n'y a pas de menu système ici), positions
 * continues par watchPosition.
 */
import type { HubSignal } from '../glasses/gestures';
import type { Gesture } from '../glasses/nav';
import { describeImage, renderImage } from '../glasses/images';
import type { ContainerSpec, ImageSpec } from '../glasses/types';
import { imageRGBA, type PaintedImage } from '../web/display';
import { createKV, localStorageBackend } from './kv';
import { deviceLocation } from './location';
import { pageImages } from './page';
import type { GlassesPort, Platform } from './types';

const LEVEL_OPACITY = [0.28, 0.42, 0.6, 0.8, 1];

/** Dessine des conteneurs dans un élément (aussi utilisé par l'aperçu des réglages) ; 1.2.10 : puis les images. */
export function paintContainers(screen: HTMLElement, cs: ContainerSpec[], images: readonly PaintedImage[] = []): void {
  screen.replaceChildren();
  for (const c of cs) {
    const el = document.createElement('div');
    el.className = 'g-box';
    el.dataset.name = c.name;
    el.style.cssText = `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;opacity:${LEVEL_OPACITY[c.level] ?? 1}`;
    el.textContent = c.content;
    screen.appendChild(el);
  }
  for (const im of images) screen.appendChild(imageElement(im));
}

/**
 * 1.2.10 : conteneur d'image : un canvas à la taille des lunettes, pixels mêmes des lunettes (agrandis sans lissage),
 * fond noir quand l'image est dessinée ; data-image et aria-label disent ce qu'il montre.
 */
export function imageElement(im: PaintedImage): HTMLCanvasElement {
  const { spec, pixels } = im;
  const c = document.createElement('canvas');
  c.className = 'g-img';
  c.width = spec.w;
  c.height = spec.h;
  c.dataset.name = spec.name;
  c.dataset.image = JSON.stringify(spec.image);
  c.dataset.drawn = pixels ? '1' : '0';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', pixels ? describeImage(spec.image) : 'image vide');
  c.style.cssText = `position:absolute;left:${spec.x}px;top:${spec.y}px;width:${spec.w}px;height:${spec.h}px;image-rendering:pixelated${pixels ? ';background:#000' : ''}`;
  if (pixels) {
    try {
      const ctx = c.getContext('2d');
      if (ctx && typeof ctx.createImageData === 'function') {
        const data = ctx.createImageData(spec.w, spec.h);
        data.data.set(imageRGBA(pixels));
        ctx.putImageData(data, 0, 0);
      }
    } catch {
      /* pas de canvas (tests) : l'élément dit quand même ce qu'il montre */
    }
  }
  return c;
}

function emulator(mount: HTMLElement): { port: GlassesPort; screen: HTMLElement } {
  const wrap = document.createElement('section');
  wrap.className = 'g-emu';
  wrap.setAttribute('aria-label', 'Aperçu des lunettes (navigateur)');
  wrap.innerHTML = `
    <p class="g-emu-title">Lunettes, aperçu dans le navigateur</p>
    <div class="g-screen-wrap"><div class="g-screen" role="img" aria-label="Écran des lunettes"></div></div>
    <div class="g-emu-buttons">
      <button type="button" data-g="up" aria-label="Glisser vers le haut">▲</button>
      <button type="button" data-g="down" aria-label="Glisser vers le bas">▼</button>
      <button type="button" data-g="tap">Toucher</button>
      <button type="button" data-g="double">Double toucher</button>
      <button type="button" data-g="long">Appui long</button>
    </div>`;
  mount.appendChild(wrap);
  const screen = wrap.querySelector<HTMLElement>('.g-screen')!;
  const listeners = new Set<(s: HubSignal) => void>();
  const emit = (s: HubSignal): void => listeners.forEach((l) => l(s));
  wrap.querySelectorAll<HTMLButtonElement>('button[data-g]').forEach((b) => b.addEventListener('click', () => emit({ kind: 'gesture', gesture: b.dataset.g as Gesture })));
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
    const map: Record<string, Gesture> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', Backspace: 'double', Escape: 'double', l: 'long', L: 'long' };
    const g = map[e.key];
    if (g) {
      e.preventDefault();
      emit({ kind: 'gesture', gesture: g });
    }
  });
  let current: ContainerSpec[] = [];
  let images: PaintedImage[] = [];
  const page = (cs: ContainerSpec[], extra?: { images?: ImageSpec[] }): boolean => {
    current = cs.map((c) => ({ ...c }));
    images = pageImages(current, extra?.images).map((spec) => ({ spec: { ...spec }, pixels: null }));
    paintContainers(screen, current, images);
    return true;
  };
  const port: GlassesPort = {
    async start(cs, extra) {
      return page(cs, extra);
    },
    async rebuild(cs, extra) {
      return page(cs, extra);
    },
    async paint(img) {
      const i = images.findIndex((x) => x.spec.id === img.id && x.spec.name === img.name && x.spec.w === img.w && x.spec.h === img.h);
      if (i < 0) return false;
      images[i] = { spec: { ...img }, pixels: renderImage(img) };
      paintContainers(screen, current, images);
      return true;
    },
    async upgrade(c) {
      current = current.map((x) => (x.id === c.id ? { ...c } : x));
      paintContainers(screen, current, images);
      return true;
    },
    onSignal(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async exit(mode) {
      if (mode === 1 && !window.confirm('Quitter Quai ?')) return;
      emit({ kind: 'exit', abnormal: false });
    },
  };
  return { port, screen };
}

export function createBrowserPlatform(now: () => number, mount: HTMLElement): Platform {
  const { port } = emulator(mount);
  return {
    kind: 'browser',
    glasses: port,
    kv: createKV(localStorageBackend()),
    location: deviceLocation(null, now),
    closeWebView() {
      document.querySelector('.g-emu')?.remove();
    },
  };
}
