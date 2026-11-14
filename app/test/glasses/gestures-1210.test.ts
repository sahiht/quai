/**
 * 1.2.10 (PRD-1.2.10 § 3.4, § 3.7) : signaux du menu système et de l'état des lunettes, doublons du micrologiciel,
 * boîte de sortie aux événements inversés, anti-rebond de l'appui long.
 */
import { describe, expect, it } from 'vitest';
import { evenHubEventFromJson } from '@evenrealities/even_hub_sdk';
import {
  DEBOUNCE,
  DeviceSignals,
  EXIT_DIALOG_WAIT_MS,
  ExitDialog,
  GestureFilter,
  LONG_DUPLICATE_MS,
  menuItemId,
  readDeviceStatus,
  readHubEvent,
  SIGNAL_DUPLICATE_MS,
  SignalDedup,
  type HubSignal,
} from '../../src/glasses/gestures';

const ev = (type: string, jsonData: Record<string, unknown>) => evenHubEventFromJson({ type, jsonData });

describe('menu système (menuItemClickEvent, SDK 0.0.14+)', () => {
  it('un choix du menu devient le signal `menu` avec son identifiant', () => {
    expect(readHubEvent(ev('menuItemClickEvent', { itemID: 1 }))).toEqual({ kind: 'menu', id: 1 });
    expect(readHubEvent(ev('menuItemClickEvent', { itemID: 2 }))).toEqual({ kind: 'menu', id: 2 });
    // clé protobuf et nombre en texte acceptés par le SDK
    expect(readHubEvent(ev('menuItemClickEvent', { Item_ID: '2' }))).toEqual({ kind: 'menu', id: 2 });
    expect(readHubEvent({ menuItemClickEvent: { itemID: 7 } } as never)).toEqual({ kind: 'menu', id: 7 });
  });

  it('identifiant absent, nul, négatif, fractionnaire ou hors uint32 : rien', () => {
    expect(readHubEvent({ menuItemClickEvent: {} } as never)).toBeNull();
    for (const bad of [0, -1, 1.5, 2 ** 32, Number.NaN, '', 'x', null]) expect(menuItemId(bad)).toBeNull();
    expect(menuItemId(0xffff_ffff)).toBe(0xffff_ffff);
    expect(menuItemId(' 3 ')).toBe(3);
  });

  it('appui long (9) et relâchement (10) : laissés au menu système, jamais un toucher', () => {
    expect(readHubEvent(ev('sysEvent', { eventType: 9, eventSource: 1 }))).toBeNull();
    expect(readHubEvent(ev('sysEvent', { eventType: 10, eventSource: 1 }))).toBeNull();
    expect(readHubEvent(ev('textEvent', { containerID: 1, eventType: 9 }))).toBeNull();
    expect(readHubEvent(ev('listEvent', { containerID: 1, eventType: 10 }))).toBeNull();
    // une enveloppe voisine sans type (CLICK par défaut) ne transforme pas l'appui long en toucher
    expect(readHubEvent({ sysEvent: { eventType: 9 }, textEvent: { containerID: 1 } } as never)).toBeNull();
    // les gestes ordinaires restent lus comme avant
    expect(readHubEvent(ev('sysEvent', { eventSource: 1 }))).toEqual({ kind: 'gesture', gesture: 'tap' });
    expect(readHubEvent(ev('sysEvent', { eventType: 3 }))).toEqual({ kind: 'gesture', gesture: 'double' });
  });
});

describe('état des lunettes (onDeviceStatusChanged)', () => {
  it('lecture : « connected » seulement compte comme connecté ; port lu s’il est donné', () => {
    expect(readDeviceStatus({ sn: 'x', connectType: 'connected', isWearing: true, batteryLevel: 80 })).toEqual({ connected: true, wearing: true });
    expect(readDeviceStatus({ connectType: 'connecting' })).toEqual({ connected: false });
    expect(readDeviceStatus({ connectType: 'disconnected', isWearing: false })).toEqual({ connected: false, wearing: false });
    expect(readDeviceStatus({ connectType: 'connectionFailed' })).toEqual({ connected: false });
    expect(readDeviceStatus(null)).toBeNull();
    expect(readDeviceStatus('connected')).toBeNull();
    expect(readDeviceStatus({ isWearing: true })).toBeNull();
  });

  it('dédoublonné : batterie et charge seules ne font aucun signal ; chaque vrai changement en fait un', () => {
    const d = new DeviceSignals();
    const seen: (HubSignal | null)[] = [];
    const push = (s: unknown) => seen.push(d.next(s));
    push({ connectType: 'connected', isWearing: true, batteryLevel: 80 });
    push({ connectType: 'connected', isWearing: true, batteryLevel: 79 });
    push({ connectType: 'connected', isWearing: true, batteryLevel: 79, isCharging: true });
    push({ connectType: 'disconnected', isWearing: true });
    push({ connectType: 'connecting', isWearing: true });
    push({ connectType: 'connected', isWearing: true });
    push({ connectType: 'connected', isWearing: false });
    push({ connectType: 'connected', isWearing: true });
    push({ bad: 1 });
    expect(seen).toEqual([
      { kind: 'device', connected: true, wearing: true },
      null,
      null,
      { kind: 'device', connected: false, wearing: true },
      null,
      { kind: 'device', connected: true, wearing: true },
      { kind: 'device', connected: true, wearing: false },
      { kind: 'device', connected: true, wearing: true },
      null,
    ]);
  });
});

describe('doublons du micrologiciel (événement système répété 50 à 100 ms plus tard)', () => {
  it('cycle de vie : le doublon est écarté, une vraie suite passe toujours', () => {
    const d = new SignalDedup();
    const fg: HubSignal = { kind: 'foreground' };
    const bg: HubSignal = { kind: 'background' };
    expect(d.accept(bg, 1000)).toBe(true);
    expect(d.accept(bg, 1070)).toBe(false);
    expect(d.accept(fg, 1300)).toBe(true);
    expect(d.accept(fg, 1380)).toBe(false);
    // arrière-plan puis premier plan très rapprochés (une notification passe) : les deux passent
    expect(d.accept(bg, 1500)).toBe(true);
    expect(d.accept(fg, 1520)).toBe(true);
    // le même signal bien plus tard : un nouvel événement
    expect(d.accept(fg, 1520 + SIGNAL_DUPLICATE_MS)).toBe(true);
    // sorties : doublon écarté ; une sortie anormale n'est pas le doublon d'une sortie système
    expect(d.accept({ kind: 'exit', abnormal: false }, 9000)).toBe(true);
    expect(d.accept({ kind: 'exit', abnormal: false }, 9050)).toBe(false);
    expect(d.accept({ kind: 'exit', abnormal: true }, 9060)).toBe(true);
  });

  it('menu : le même choix répété de près est un doublon ; un autre choix passe ; gestes et lunettes jamais filtrés ici', () => {
    const d = new SignalDedup();
    expect(d.accept({ kind: 'menu', id: 1 }, 0)).toBe(true);
    expect(d.accept({ kind: 'menu', id: 1 }, 80)).toBe(false);
    expect(d.accept({ kind: 'menu', id: 2 }, 100)).toBe(true);
    expect(d.accept({ kind: 'menu', id: 1 }, 200)).toBe(true);
    expect(d.accept({ kind: 'menu', id: 1 }, 200 + SIGNAL_DUPLICATE_MS)).toBe(true);
    for (let t = 0; t < 5; t++) expect(d.accept({ kind: 'gesture', gesture: 'tap' }, 1000 + t)).toBe(true);
    expect(d.accept({ kind: 'device', connected: true }, 2000)).toBe(true);
    expect(d.accept({ kind: 'device', connected: true }, 2001)).toBe(true);
    // la fenêtre ne s'allonge pas avec les doublons (pas d'écart en chaîne d'un vrai choix)
    const e = new SignalDedup(600);
    expect(e.accept({ kind: 'menu', id: 1 }, 0)).toBe(true);
    expect(e.accept({ kind: 'menu', id: 1 }, 400)).toBe(false);
    expect(e.accept({ kind: 'menu', id: 1 }, 700)).toBe(true);
  });
});

describe('boîte de sortie (shutDownPageContainer(1)) : événements inversés', () => {
  it('« Non » : 4 à l’affichage puis 5 à la réponse, les deux arrivent comme `foreground`', () => {
    const x = new ExitDialog();
    x.arm(1000);
    expect(x.pending(1000)).toBe(true);
    expect(x.map({ kind: 'foreground' }, 1100)).toEqual({ kind: 'foreground' });
    // l'utilisateur prend son temps : la boîte reste ouverte au-delà du délai d'apparition
    expect(x.pending(1100 + EXIT_DIALOG_WAIT_MS * 2)).toBe(true);
    expect(x.map({ kind: 'background' }, 1100 + EXIT_DIALOG_WAIT_MS * 2)).toEqual({ kind: 'foreground' });
    // réponse donnée : la suite a de nouveau son sens normal
    expect(x.pending(1100 + EXIT_DIALOG_WAIT_MS * 2 + 1)).toBe(false);
    expect(x.map({ kind: 'background' }, 200_000)).toEqual({ kind: 'background' });
  });

  it('« Oui » : la sortie passe ; gestes, menu et lunettes ne sont jamais touchés', () => {
    const x = new ExitDialog();
    x.arm(0);
    expect(x.map({ kind: 'gesture', gesture: 'tap' }, 10)).toEqual({ kind: 'gesture', gesture: 'tap' });
    expect(x.map({ kind: 'menu', id: 1 }, 10)).toEqual({ kind: 'menu', id: 1 });
    expect(x.map({ kind: 'device', connected: true }, 10)).toEqual({ kind: 'device', connected: true });
    expect(x.map({ kind: 'foreground' }, 100)).toEqual({ kind: 'foreground' });
    expect(x.map({ kind: 'exit', abnormal: false }, 3000)).toEqual({ kind: 'exit', abnormal: false });
    expect(x.pending(3001)).toBe(false);
  });

  it('boîte jamais apparue : un vrai passage en arrière-plan reste un passage en arrière-plan', () => {
    const x = new ExitDialog();
    x.arm(0);
    expect(x.map({ kind: 'background' }, 50)).toEqual({ kind: 'background' });
    expect(x.map({ kind: 'background' }, 60)).toEqual({ kind: 'background' });
    const y = new ExitDialog();
    y.arm(0);
    // délai d'apparition dépassé : la demande est oubliée
    expect(y.pending(EXIT_DIALOG_WAIT_MS)).toBe(false);
    expect(y.map({ kind: 'foreground' }, EXIT_DIALOG_WAIT_MS)).toEqual({ kind: 'foreground' });
    expect(y.map({ kind: 'background' }, EXIT_DIALOG_WAIT_MS + 10)).toEqual({ kind: 'background' });
    // sans demande, rien ne change
    expect(new ExitDialog().map({ kind: 'background' }, 5)).toEqual({ kind: 'background' });
  });
});

describe('anti-rebond de l’appui long (Quai Web)', () => {
  it('le même appui long répété de près est un doublon ; un toucher juste après est écarté', () => {
    const f = new GestureFilter();
    expect(f.accept('long', 1000)).toBe(true);
    expect(f.accept('long', 1000 + LONG_DUPLICATE_MS - 1)).toBe(false);
    expect(f.rejected).toBe('doublon');
    expect(f.accept('long', 1000 + LONG_DUPLICATE_MS)).toBe(true);
    const t0 = 1000 + LONG_DUPLICATE_MS;
    expect(f.accept('tap', t0 + 50)).toBe(false);
    expect(f.rejected).toBe('après un toucher');
    expect(f.accept('tap', t0 + DEBOUNCE.tapCooldownMs)).toBe(true);
  });

  it('un appui long juste après un toucher ou un double toucher est écarté ; plus tard il passe', () => {
    const f = new GestureFilter();
    expect(f.accept('tap', 0)).toBe(true);
    expect(f.accept('long', 100)).toBe(false);
    expect(f.rejected).toBe('après un toucher');
    expect(f.accept('long', DEBOUNCE.tapCooldownMs)).toBe(true);
    expect(f.accept('double', DEBOUNCE.tapCooldownMs + 10)).toBe(false);
    expect(f.accept('double', DEBOUNCE.tapCooldownMs * 2)).toBe(true);
    expect(f.accept('long', DEBOUNCE.tapCooldownMs * 2 + 100)).toBe(false);
    expect(f.accept('long', DEBOUNCE.tapCooldownMs * 3)).toBe(true);
  });

  it('un glissement juste après un appui long est écarté comme après un toucher', () => {
    const f = new GestureFilter();
    expect(f.accept('long', 0)).toBe(true);
    expect(f.accept('down', DEBOUNCE.scrollAfterTapMs - 1)).toBe(false);
    expect(f.rejected).toBe('après un toucher');
    expect(f.accept('down', DEBOUNCE.scrollAfterTapMs)).toBe(true);
  });

  it('premier appui long sans geste avant : accepté tout de suite ; réglage sans délai propre : celui du toucher', () => {
    expect(new GestureFilter().accept('long', 0)).toBe(true);
    // Quai Web (WEB_DEBOUNCE du contrôleur, sans longDuplicateMs) : pas de doublon des boutons
    const web = new GestureFilter({ ...DEBOUNCE, longDuplicateMs: undefined, tapDuplicateMs: 0, tapCooldownMs: 0 });
    expect(web.accept('long', 0)).toBe(true);
    expect(web.accept('long', 1)).toBe(true);
  });
});
