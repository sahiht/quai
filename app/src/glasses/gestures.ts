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
 *
 * 1.2.10 (PRD-1.2.10 § 3.4 et § 3.7) :
 *  - menu système de l'appui long : menuItemClickEvent.itemID → signal `menu` (MenuItem.id) ;
 *  - appui long (9) et relâchement (10) : le système ouvre lui-même son menu, où Quai ajoute ses choix (menuObject) ;
 *    ils ne deviennent pas un geste (le geste `long` vient du bouton « Appui long » de Quai Web) ;
 *  - état des lunettes (onDeviceStatusChanged) : signal `device`, seulement quand la connexion ou le port changent ;
 *  - doublons du micrologiciel (even-g2-notes, page-lifecycle) : un événement système répété 50 à 100 ms plus tard ;
 *  - boîte de sortie (shutDownPageContainer(1)) : 4 quand elle s'affiche, 5 si l'on répond « Non », 7 si « Oui ».
 *
 * 1.3.0 (PRD-1.3.0 § 6.2, § 6.3) :
 *  - mesure du capteur de mouvement (sysEvent de type 8, IMU_DATA_REPORT, ou sans type, avec imuData) : signal `imu`,
 *    jamais un geste, même avec une enveloppe voisine sans type ; une mesure dont une coordonnée manque ou n'est pas un
 *    nombre est écartée ; les mesures ne passent pas par le dédoublonnage (SignalDedup) ;
 *  - état des lunettes : batterie (entier de 1 à 100) et charge, lunettes connectées seulement ; un changement de
 *    batterie ou de charge fait aussi un signal `device` (connexion et port inchangés : à comparer avant d'agir).
 */
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { Gesture } from './nav';

export type HubSignal =
  | { kind: 'gesture'; gesture: Gesture }
  | { kind: 'foreground' }
  | { kind: 'background' }
  | { kind: 'exit'; abnormal: boolean }
  /** 1.2.10 : choix du menu système de l'appui long (menuItemClickEvent), identifiant MenuItem.id. */
  | { kind: 'menu'; id: number }
  /** 1.2.10 : lunettes reconnectées ou remises (onDeviceStatusChanged) : la page est reconstruite. */
  /**
   * 1.3.0 (PRD-1.3.0 § 6.3) : `battery` : batterie des lunettes, 0 à 100, si l'hôte la donne (en pratique un entier de 1 à
   * 100, lunettes connectées seulement ; absente : inconnue) ; `charging` : en charge, si l'hôte le dit (lunettes
   * connectées seulement). Un signal arrive aussi quand seules la batterie ou la charge changent.
   */
  | { kind: 'device'; connected: boolean; wearing?: boolean; battery?: number; charging?: boolean }
  /**
   * 1.3.0 (PRD-1.3.0 § 6.2) : mesure du capteur de mouvement des lunettes (imuControl ouvert), valeurs brutes ; `at` :
   * heure de réception (horloge de l'appli, en ms, comme Fix.at). Jamais un geste ; aucune n'est gardée.
   */
  | { kind: 'imu'; x: number; y: number; z: number; at: number };

const CLICK = 0;
const SCROLL_TOP = 1;
const SCROLL_BOTTOM = 2;
const DOUBLE = 3;
const FG_ENTER = 4;
const FG_EXIT = 5;
const ABNORMAL_EXIT = 6;
const SYSTEM_EXIT = 7;
/** 1.2.10 : début et fin d'un appui long (SDK 0.0.14+). */
const LONG_PRESS = 9;
const LONG_RELEASE = 10;
/** 1.3.0 : mesure du capteur de mouvement (OsEventTypeList.IMU_DATA_REPORT). */
const IMU_DATA = 8;

/** Type d'un envoi : CLICK par défaut, uniquement si l'enveloppe existe. */
function typeOf(env?: { eventType?: number | string }): number | null {
  if (!env) return null;
  const t = env.eventType;
  if (t === undefined || t === null || t === '') return CLICK;
  const n = typeof t === 'number' ? t : Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 1.2.10 : identifiant d'un choix du menu (uint32 non nul, comme l'exige le SDK), ou null. */
export function menuItemId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 0xffff_ffff ? n : null;
}

/** 1.3.0 : coordonnée d'une mesure du capteur : nombre fini (le SDK convertit déjà les textes numériques), sinon null. */
function axis(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * 1.3.0 (PRD-1.3.0 § 6.2) : mesure du capteur de mouvement (imuData du SDK) → signal `imu` reçu à `at` ; null si elle
 * manque ou si une coordonnée manque ou n'est pas un nombre (une coordonnée absente n'est pas prise pour 0 : un faux 0
 * ferait croire à un grand mouvement).
 */
export function readImu(data: unknown, at: number): HubSignal | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { x?: unknown; y?: unknown; z?: unknown };
  const x = axis(d.x);
  const y = axis(d.y);
  const z = axis(d.z);
  return x === null || y === null || z === null ? null : { kind: 'imu', x, y, z, at };
}

/**
 * Traduit un événement du SDK en signal (ou null si sans intérêt : audio, appui long…). 1.3.0 : `at`, heure de
 * réception (horloge de l'appli), datée sur les mesures du capteur de mouvement.
 */
export function readHubEvent(e: EvenHubEvent, at: number = Date.now()): HubSignal | null {
  // 1.2.10 : un choix du menu système (il n'arrive jamais avec un geste)
  if (e.menuItemClickEvent) {
    const id = menuItemId(e.menuItemClickEvent.itemID);
    return id === null ? null : { kind: 'menu', id };
  }
  const sys = typeOf(e.sysEvent);
  const text = typeOf(e.textEvent);
  const list = typeOf(e.listEvent);
  // 1.2.10 : l'appui long appartient au menu système ; une enveloppe voisine sans type ne doit pas en faire un toucher.
  if ([sys, text, list].some((t) => t === LONG_PRESS || t === LONG_RELEASE)) return null;
  // 1.3.0 : mesure du capteur de mouvement (type 8 ; le SDK laisse parfois le type vide, avec imuData) : jamais un geste,
  // même invalide ou avec une enveloppe voisine sans type
  if (sys === IMU_DATA || (sys === CLICK && e.sysEvent?.imuData != null)) return readImu(e.sysEvent?.imuData, at);
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

/* ------------------------------ 1.2.10 : état des lunettes ------------------------------ */

/**
 * État des lunettes tel que Quai s'en sert (DeviceStatus du SDK : connectType, isWearing ; 1.3.0 : batteryLevel,
 * isCharging).
 */
export interface DeviceState {
  connected: boolean;
  wearing?: boolean;
  /** 1.3.0 : batterie, entier de 1 à 100, lunettes connectées seulement (absente : inconnue) */
  battery?: number;
  /** 1.3.0 : en charge, lunettes connectées seulement */
  charging?: boolean;
}

/**
 * 1.3.0 (PRD-1.3.0 § 6.3) : batterie lue dans DeviceStatus.batteryLevel : entier de 1 à 100, ou undefined (inconnue).
 * 0 compte comme inconnue : le SDK met 0 quand l'hôte ne donne pas la batterie (DeviceStatus.fromJson), et des lunettes
 * à 0 % sont éteintes ; une valeur hors de 0 à 100 aussi.
 */
export function readBattery(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const b = Math.round(n);
  return b >= 1 && b <= 100 ? b : undefined;
}

/**
 * Lecture défensive d'un DeviceStatus (« connected » seulement compte comme connecté) ; null si illisible. 1.3.0 :
 * batterie et charge seulement si les lunettes sont connectées (sinon l'hôte garde une valeur ancienne ou par défaut).
 */
export function readDeviceStatus(s: unknown): DeviceState | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as { connectType?: unknown; isWearing?: unknown; batteryLevel?: unknown; isCharging?: unknown };
  if (typeof o.connectType !== 'string') return null;
  const connected = o.connectType === 'connected';
  const d: DeviceState = { connected };
  if (typeof o.isWearing === 'boolean') d.wearing = o.isWearing;
  if (connected) {
    const battery = readBattery(o.batteryLevel);
    if (battery !== undefined) d.battery = battery;
    if (typeof o.isCharging === 'boolean') d.charging = o.isCharging;
  }
  return d;
}

/**
 * Signal `device` dédoublonné : l'hôte pousse le même état plusieurs fois ; seul un changement en fait un signal. Le
 * premier état reçu passe (au pire une reconstruction de trop, jamais une de moins). 1.3.0 (PRD-1.3.0 § 6.3) : un
 * changement de batterie (au pour cent près) ou de charge fait aussi un signal, pour que le contrôleur ait toujours la
 * batterie du moment ; la connexion et le port y sont inchangés (le contrôleur compare avant de reconstruire la page).
 */
export class DeviceSignals {
  private last: string | null = null;

  next(status: unknown): HubSignal | null {
    const d = readDeviceStatus(status);
    if (!d) return null;
    const key = `${d.connected}|${d.wearing ?? ''}|${d.battery ?? ''}|${d.charging ?? ''}`;
    if (key === this.last) return null;
    this.last = key;
    return { kind: 'device', ...d };
  }
}

/* ------------------------------ 1.2.10 : doublons et boîte de sortie ------------------------------ */

/** Le micrologiciel répète un événement système 50 à 100 ms plus tard (even-g2-notes) : fenêtre de dédoublonnage. */
export const SIGNAL_DUPLICATE_MS = 600;

/**
 * Doublons des signaux du cycle de vie (premier plan, arrière-plan, sortie) et du menu. Un signal identique au précédent
 * de même famille, moins de `windowMs` après lui, est écarté ; une vraie suite (arrière-plan puis premier plan, même
 * rapprochés) passe toujours. Les gestes ont leur propre anti-rebond (GestureFilter, dans le contrôleur). 1.3.0 : les
 * mesures du capteur (`imu`, 10 par seconde) passent toujours, sans rien changer à la mémoire des autres familles.
 */
export class SignalDedup {
  private lastSys: { key: string; t: number } | null = null;
  private lastMenu: { id: number; t: number } | null = null;

  constructor(private readonly windowMs = SIGNAL_DUPLICATE_MS) {}

  accept(s: HubSignal, t: number): boolean {
    switch (s.kind) {
      case 'gesture':
      case 'device':
      case 'imu':
        return true;
      case 'menu': {
        if (this.lastMenu && this.lastMenu.id === s.id && t - this.lastMenu.t < this.windowMs) return false;
        this.lastMenu = { id: s.id, t };
        return true;
      }
      default: {
        const key = s.kind === 'exit' ? `exit:${s.abnormal}` : s.kind;
        if (this.lastSys && this.lastSys.key === key && t - this.lastSys.t < this.windowMs) return false;
        this.lastSys = { key, t };
        return true;
      }
    }
  }
}

/** Délai d'apparition de la boîte de sortie après shutDownPageContainer(1) (elle vient en 100 ms environ). */
export const EXIT_DIALOG_WAIT_MS = 30_000;

/**
 * Boîte de sortie (even-g2-notes, page-lifecycle) : après shutDownPageContainer(1), l'hôte envoie 4 quand la boîte
 * s'affiche (la page est déjà effacée : la reconstruire), 5 si l'on répond « Non » (Quai continue : ce n'est pas un
 * passage en arrière-plan) et 7 si « Oui ». Le 5 de la boîte devient donc `foreground` ; hors de la boîte, rien ne change.
 */
export class ExitDialog {
  private armedAt = -Infinity;
  private shown = false;

  constructor(private readonly waitMs = EXIT_DIALOG_WAIT_MS) {}

  /** À appeler au moment de demander la boîte de sortie. */
  arm(t: number): void {
    this.armedAt = t;
    this.shown = false;
  }

  /** Vrai entre la demande et la réponse. */
  pending(t: number): boolean {
    return this.shown || t - this.armedAt < this.waitMs;
  }

  map(s: HubSignal, t: number): HubSignal {
    if (s.kind !== 'foreground' && s.kind !== 'background' && s.kind !== 'exit') return s;
    if (!this.pending(t)) return s;
    if (s.kind === 'foreground') {
      this.shown = true;
      return s;
    }
    const answered = s.kind === 'background' && this.shown;
    this.armedAt = -Infinity;
    this.shown = false;
    // « Non » : Quai reste au premier plan, la page (effacée par la boîte) est reconstruite
    return answered ? { kind: 'foreground' } : s;
  }
}

/* ------------------------------ Anti-rebond des gestes ------------------------------ */

/** Délais de l'anti-rebond (ms). */
export interface DebounceConfig {
  tapDuplicateMs: number;
  doubleDuplicateMs: number;
  /** 1.2.10 : appui long répété ; absent : comme un toucher (tapDuplicateMs). */
  longDuplicateMs?: number;
  tapCooldownMs: number;
  scrollSameDirMs: number;
  scrollDirChangeMs: number;
  scrollAfterTapMs: number;
  scrollAfterRenderMs: number;
}

/** 1.2.10 : appui long répété de près (bouton « Appui long » cliqué deux fois de suite). */
export const LONG_DUPLICATE_MS = 600;

export const DEBOUNCE: DebounceConfig = {
  tapDuplicateMs: 90,
  doubleDuplicateMs: 140,
  longDuplicateMs: LONG_DUPLICATE_MS,
  tapCooldownMs: 220,
  scrollSameDirMs: 350,
  scrollDirChangeMs: 50,
  scrollAfterTapMs: 110,
  scrollAfterRenderMs: 80,
};

type TapKind = 'tap' | 'double' | 'long';

/** Filtre les doublons et les glissements parasites (G2 : événements répétés, défilement après mise à jour). */
export class GestureFilter {
  private lastTap = -Infinity;
  private lastTapKind: TapKind | null = null;
  private lastScroll = -Infinity;
  private lastScrollDir: 'up' | 'down' | null = null;
  private renderUntil = -Infinity;
  /** Raison du dernier geste écarté, pour le journal du mode test (geste « perdu » dans le simulateur). */
  rejected: 'doublon' | 'après un toucher' | 'après un rendu' | 'défilement trop rapproché' | '' = '';

  constructor(private cfg: DebounceConfig = DEBOUNCE) {}

  /** À appeler au début et à la fin de chaque mise à jour de l'affichage. */
  notifyRender(t: number): void {
    this.renderUntil = Math.max(this.renderUntil, t + this.cfg.scrollAfterRenderMs);
  }

  accept(g: Gesture, t: number): boolean {
    // Toucher, double toucher et (1.2.10) appui long : un même geste répété de près est un doublon ; un autre geste de
    // cette famille juste après est écarté aussi (le relâchement d'un appui long ne fait pas un toucher).
    if (g === 'tap' || g === 'double' || g === 'long') {
      const elapsed = t - this.lastTap;
      const dup = g === 'double' ? this.cfg.doubleDuplicateMs : g === 'long' ? (this.cfg.longDuplicateMs ?? this.cfg.tapDuplicateMs) : this.cfg.tapDuplicateMs;
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
