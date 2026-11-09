/**
 * Repli « navigateur » pour le développement sans lunettes : les conteneurs sont dessinés dans un
 * émulateur 576 × 288 sur la page, avec les gestes au clavier (↑ ↓ Entrée Retour arrière) et à la souris.
 */
import type { HubSignal } from '../glasses/gestures';
import type { ContainerSpec } from '../glasses/types';
import { createKV, localStorageBackend } from './kv';
import { deviceLocation } from './location';
import type { GlassesPort, Platform } from './types';

const LEVEL_OPACITY = [0.28, 0.42, 0.6, 0.8, 1];

/** Dessine des conteneurs dans un élément (aussi utilisé par l'aperçu des réglages). */
export function paintContainers(screen: HTMLElement, cs: ContainerSpec[]): void {
  screen.replaceChildren();
  for (const c of cs) {
    const el = document.createElement('div');
    el.className = 'g-box';
    el.dataset.name = c.name;
    el.style.cssText = `left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;opacity:${LEVEL_OPACITY[c.level] ?? 1}`;
    el.textContent = c.content;
    screen.appendChild(el);
  }
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
    </div>`;
  mount.appendChild(wrap);
  const screen = wrap.querySelector<HTMLElement>('.g-screen')!;
  const listeners = new Set<(s: HubSignal) => void>();
  const emit = (s: HubSignal): void => listeners.forEach((l) => l(s));
  wrap.querySelectorAll<HTMLButtonElement>('button[data-g]').forEach((b) =>
    b.addEventListener('click', () => emit({ kind: 'gesture', gesture: b.dataset.g as 'up' | 'down' | 'tap' | 'double' })),
  );
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
    const map: Record<string, 'up' | 'down' | 'tap' | 'double'> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', Backspace: 'double', Escape: 'double' };
    const g = map[e.key];
    if (g) {
      e.preventDefault();
      emit({ kind: 'gesture', gesture: g });
    }
  });
  let current: ContainerSpec[] = [];
  const port: GlassesPort = {
    async start(cs) {
      current = cs.map((c) => ({ ...c }));
      paintContainers(screen, current);
      return true;
    },
    async rebuild(cs) {
      current = cs.map((c) => ({ ...c }));
      paintContainers(screen, current);
      return true;
    },
    async upgrade(c) {
      current = current.map((x) => (x.id === c.id ? { ...c } : x));
      paintContainers(screen, current);
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
