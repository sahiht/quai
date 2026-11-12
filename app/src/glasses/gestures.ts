/**
 * Lecture des événements du SDK et anti-rebond des gestes.
 *
 * Routage vérifié dans le simulateur 0.9.5 avec un conteneur texte de capture :
 *  - glisser haut  → textEvent.eventType = 1 (SCROLL_TOP_EVENT)
 *  - glisser bas   → textEvent.eventType = 2 (SCROLL_BOTTOM_EVENT)
 *  - toucher       → sysEvent sans eventType (CLICK_EVENT = 0, omis par protobuf)
 *  - double toucher→ sysEvent.eventType = 3
 *  - cycle de vie  → sysEvent 4 (premier plan), 5 (arrière-plan), 6 (sortie anormale), 7 (sortie système)
 * Les délais d'anti-rebond reprennent ceux réglés sur le matériel G2 (boîte à outils even-toolkit).
 */
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { Gesture } from './nav';

export type HubSignal =
  | { kind: 'gesture'; gesture: Gesture }
  | { kind: 'foreground' }
  | { kind: 'background' }
  | { kind: 'exit'; abnormal: boolean };

const CLICK = 0;
const SCROLL_TOP = 1;
const SCROLL_BOTTOM = 2;
const DOUBLE = 3;
const FG_ENTER = 4;
const FG_EXIT = 5;
const ABNORMAL_EXIT = 6;
const SYSTEM_EXIT = 7;

/** Type d'un envoi : CLICK par défaut, uniquement si l'enveloppe existe. */
function typeOf(env?: { eventType?: number | string }): number | null {
  if (!env) return null;
  const t = env.eventType;
  if (t === undefined || t === null || t === '') return CLICK;
  const n = typeof t === 'number' ? t : Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Traduit un événement du SDK en signal (ou null si sans intérêt : audio, IMU, menu…). */
export function readHubEvent(e: EvenHubEvent): HubSignal | null {
  const sys = typeOf(e.sysEvent);
  const text = typeOf(e.textEvent);
  const list = typeOf(e.listEvent);
  // Ordre : types explicites d'abord, CLICK (valeur par défaut) en dernier.
  if (sys === DOUBLE || text === DOUBLE || list === DOUBLE) return { kind: 'gesture', gesture: 'double' };
  if (sys === SYSTEM_EXIT) return { kind: 'exit', abnormal: false };
  if (sys === ABNORMAL_EXIT) return { kind: 'exit', abnormal: true };
  if (sys === FG_ENTER) return { kind: 'foreground' };
  if (sys === FG_EXIT) return { kind: 'background' };
  if (text === SCROLL_TOP || sys === SCROLL_TOP || list === SCROLL_TOP) return { kind: 'gesture', gesture: 'up' };
  if (text === SCROLL_BOTTOM || sys === SCROLL_BOTTOM || list === SCROLL_BOTTOM) return { kind: 'gesture', gesture: 'down' };
  if (sys === CLICK || text === CLICK || list === CLICK) {
    if (e.sysEvent?.imuData) return null;
    return { kind: 'gesture', gesture: 'tap' };
  }
  return null;
}

export const DEBOUNCE = {
  tapDuplicateMs: 90,
  doubleDuplicateMs: 140,
  tapCooldownMs: 220,
  scrollSameDirMs: 350,
  scrollDirChangeMs: 50,
  scrollAfterTapMs: 110,
  scrollAfterRenderMs: 80,
};

/** Filtre les doublons et les glissements parasites (G2 : événements répétés, défilement après mise à jour). */
export class GestureFilter {
  private lastTap = -Infinity;
  private lastTapKind: 'tap' | 'double' | null = null;
  private lastScroll = -Infinity;
  private lastScrollDir: 'up' | 'down' | null = null;
  private renderUntil = -Infinity;
  /** Raison du dernier geste écarté, pour le journal du mode test (geste « perdu » dans le simulateur). */
  rejected: 'doublon' | 'après un toucher' | 'après un rendu' | 'défilement trop rapproché' | '' = '';

  constructor(private cfg = DEBOUNCE) {}

  /** À appeler au début et à la fin de chaque mise à jour de l'affichage. */
  notifyRender(t: number): void {
    this.renderUntil = Math.max(this.renderUntil, t + this.cfg.scrollAfterRenderMs);
  }

  accept(g: Gesture, t: number): boolean {
    if (g === 'tap' || g === 'double') {
      const elapsed = t - this.lastTap;
      const dup = g === 'double' ? this.cfg.doubleDuplicateMs : this.cfg.tapDuplicateMs;
      if (g === this.lastTapKind && elapsed < dup) return this.reject('doublon');
      if (this.lastTapKind !== null && elapsed < this.cfg.tapCooldownMs) return this.reject('après un toucher');
      this.lastTap = t;
      this.lastTapKind = g;
      return true;
    }
    if (t - this.lastTap < this.cfg.scrollAfterTapMs) return this.reject('après un toucher');
    if (t < this.renderUntil) return this.reject('après un rendu');
    const elapsed = t - this.lastScroll;
    const limit = g === this.lastScrollDir ? this.cfg.scrollSameDirMs : this.cfg.scrollDirChangeMs;
    if (elapsed < limit) return this.reject('défilement trop rapproché');
    this.lastScroll = t;
    this.lastScrollDir = g;
    return true;
  }

  private reject(why: Exclude<GestureFilter['rejected'], ''>): false {
    this.rejected = why;
    return false;
  }
}
