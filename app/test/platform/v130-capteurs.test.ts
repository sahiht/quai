/**
 * 1.3.0 (PRD-1.3.0 § 6.2, § 6.3, § 10) : capteur de mouvement et état des lunettes.
 *  - appli Even (faux pont) : imu() → imuControl avec l'allure du SDK la plus proche, refus de l'hôte, fermeture toujours
 *    sûre, mesures en signal `imu` (seulement quand on les attend), mesures invalides écartées, batterie et charge dans
 *    `device`, robustesse à 100 ms (rien ne s'accumule), traces du SDK sans une ligne par mesure ;
 *  - lecture des événements avec les vrais modèles du SDK 0.0.16 (evenHubEventFromJson, DeviceStatus.fromJson) ;
 *  - Quai Web : pas de capteur, pas de batterie (le navigateur de développement : test/web/v130-sans-capteur.test.ts) ;
 *  - garde-fou pour la fusion : le contrôleur ne rend rien et n'écrit rien pour une mesure ou une batterie qui change.
 */
import { createHook } from 'node:async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceStatus,
  ImageRawDataUpdateResult,
  ImuReportPace,
  StartUpPageCreateResult,
  evenHubEventFromJson,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { ExitDialog, GestureFilter, readBattery, readDeviceStatus, readHubEvent, readImu, SignalDedup, type HubSignal } from '../../src/glasses/gestures';
import type { ContainerSpec } from '../../src/glasses/types';
import { evenGlassesPort, IMU_PACES, IMU_STRAY_CLOSE_MS, imuPace, isSdkImuLog, quietImuLogs, type EvenBridge } from '../../src/platform/even';
import { SerialQueue } from '../../src/platform/queue';
import { APP_VERSION } from '../../src/version';
import { withCanvasImages } from '../../src/web/display';
import { createWebGlassesPort } from '../../src/web/port';
import { at, settingsWith, setup } from '../glasses/helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Horloge de l'appli au début des scénarios (15/11/2026, 10:00 à Bruxelles). */
const WALL0 = at('2026-11-15', 10, 0);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Événement tel que le SDK le donne à onEvenHubEvent (vrai décodage du SDK 0.0.16). */
const sdkSys = (jsonData: Record<string, unknown>): EvenHubEvent => evenHubEventFromJson({ type: 'sysEvent', jsonData });
const imuEvent = (x: number, y: number, z: number): EvenHubEvent => sdkSys({ eventType: 8, imuData: { x, y, z } });

interface FakeOptions {
  /** réponse de l'hôte à imuControl ; null : le pont n'a pas imuControl */
  imu?: ((on: boolean, pace?: number) => unknown) | null;
  imuDelayMs?: number;
}

/** Faux pont : garde les appels d'imuControl et d'affichage ; l'hôte pousse ses événements par `hub` et `device`. */
function fakeBridge(o: FakeOptions = {}) {
  let hub: ((e: EvenHubEvent) => void) | null = null;
  let device: ((s: unknown) => void) | null = null;
  const imuCalls: unknown[][] = [];
  const display: string[] = [];
  const raw: Record<string, unknown> = {
    createStartUpPageContainer: vi.fn(async () => (display.push('start'), StartUpPageCreateResult.success)),
    rebuildPageContainer: vi.fn(async () => (display.push('rebuild'), true)),
    textContainerUpgrade: vi.fn(async () => (display.push('upgrade'), true)),
    updateImageRawData: vi.fn(async () => (display.push('image'), ImageRawDataUpdateResult.success)),
    onEvenHubEvent: vi.fn((cb: (e: EvenHubEvent) => void) => {
      hub = cb;
      return () => (hub = null);
    }),
    onDeviceStatusChanged: vi.fn((cb: (s: unknown) => void) => {
      device = cb;
      return () => (device = null);
    }),
    shutDownPageContainer: vi.fn(async () => true),
  };
  if (o.imu !== null) {
    raw.imuControl = vi.fn(async (...args: unknown[]) => {
      imuCalls.push(args);
      if (o.imuDelayMs) await new Promise((r) => setTimeout(r, o.imuDelayMs));
      return o.imu ? o.imu(args[0] as boolean, args[1] as number | undefined) : true;
    });
  }
  return {
    bridge: raw as unknown as EvenBridge,
    raw,
    imuCalls,
    display,
    hub: (e: EvenHubEvent | Record<string, unknown>) => hub?.(e as EvenHubEvent),
    device: (s: unknown) => device?.(s),
  };
}

/** Port de l'appli Even : horloge des signaux `t` et horloge de l'appli `wall` qui avancent ensemble. */
function evenPort(o: FakeOptions = {}) {
  const f = fakeBridge(o);
  let t = 1000;
  let wall = WALL0;
  const queue = new SerialQueue();
  const port = evenGlassesPort(f.bridge, queue, () => t, () => wall);
  const got: HubSignal[] = [];
  port.onSignal((s) => got.push(s));
  const closes = () => f.imuCalls.filter((c) => c[0] === false).length;
  return {
    f,
    port,
    queue,
    got,
    closes,
    tick: (ms: number) => {
      t += ms;
      wall += ms;
    },
    wall: () => wall,
  };
}

/* ------------------------------ imu() : imuControl du SDK ------------------------------ */

describe('imu() : imuControl(isOpen, ImuReportPace) du SDK 0.0.16', () => {
  it('allure choisie : la valeur permise la plus proche (100 à 1000, par 100), la plus lente à égale distance', () => {
    // noms exacts de l'énumération du SDK installé
    expect(IMU_PACES).toEqual([ImuReportPace.P100, ImuReportPace.P200, ImuReportPace.P300, ImuReportPace.P400, ImuReportPace.P500, ImuReportPace.P600, ImuReportPace.P700, ImuReportPace.P800, ImuReportPace.P900, ImuReportPace.P1000]);
    expect(IMU_PACES).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    const cases: [number | undefined, ImuReportPace][] = [
      [100, ImuReportPace.P100],
      [200, ImuReportPace.P200],
      [149, ImuReportPace.P100],
      [150, ImuReportPace.P200],
      [240, ImuReportPace.P200],
      [251, ImuReportPace.P300],
      [960, ImuReportPace.P1000],
      [1000, ImuReportPace.P1000],
      [5000, ImuReportPace.P1000],
      [40, ImuReportPace.P100],
      [0, ImuReportPace.P100],
      [-300, ImuReportPace.P100],
      [undefined, ImuReportPace.P100],
      [Number.NaN, ImuReportPace.P100],
      [Number.POSITIVE_INFINITY, ImuReportPace.P100],
    ];
    for (const [ms, pace] of cases) expect(imuPace(ms), `paceMs ${ms}`).toBe(pace);
  });

  it('ouvrir : l’allure choisie part à l’hôte (le SDK l’enverrait telle quelle) ; vrai si l’hôte accepte ; chaque ouverture est transmise', async () => {
    const { f, port } = evenPort();
    expect(await port.imu!(true, 100)).toBe(true);
    expect(await port.imu!(true, 240)).toBe(true);
    expect(await port.imu!(true)).toBe(true);
    expect(await port.imu!(true, 150)).toBe(true);
    expect(f.imuCalls).toEqual([
      [true, 100],
      [true, 200],
      [true, 100],
      [true, 200],
    ]);
  });

  it('refus de l’hôte (faux, autre chose que vrai, exception, silence) : faux, jamais d’exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const answer of [false, 0, 1, 'true', {}, null, undefined]) {
      const { port } = evenPort({ imu: () => answer });
      await expect(port.imu!(true, 100), `réponse ${JSON.stringify(answer)}`).resolves.toBe(false);
    }
    const thrower = evenPort({
      imu: () => {
        throw new Error('canal coupé');
      },
    });
    await expect(thrower.port.imu!(true, 200)).resolves.toBe(false);
    await expect(thrower.port.imu!(false)).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    // hôte muet : délai de la file (4 s), faux
    vi.useFakeTimers();
    const mute = evenPort({ imu: () => new Promise(() => undefined) });
    const pending = mute.port.imu!(true, 100);
    await vi.advanceTimersByTimeAsync(4100);
    expect(await pending).toBe(false);
  });

  it('pont sans imuControl : faux pour ouvrir comme pour fermer, sans exception ni appel', async () => {
    const { f, port, got } = evenPort({ imu: null });
    expect(await port.imu!(true, 100)).toBe(false);
    expect(await port.imu!(false)).toBe(false);
    expect(await port.imu!(false)).toBe(false);
    f.hub(imuEvent(1, 2, 3));
    expect(got).toEqual([]);
    expect(f.imuCalls).toEqual([]);
  });

  it('ouverture refusée : aucune mesure ne passe, et le capteur (peut-être ouvert quand même) est refermé une fois', async () => {
    const { f, port, got } = evenPort({ imu: (on) => !on });
    expect(await port.imu!(true, 100)).toBe(false);
    f.hub(imuEvent(1, 2, 3));
    f.hub(imuEvent(1, 2, 4));
    await flush();
    expect(got).toEqual([]);
    expect(f.imuCalls).toEqual([[true, 100], [false]]);
  });
});

describe('imu(false) : fermer est toujours sûr', () => {
  it('sans avoir ouvert, deux fois de suite, deux fois en même temps : vrai, une seule fermeture envoyée à chaque fois', async () => {
    const { f, port } = evenPort();
    // jamais ouvert : rien n'est envoyé
    expect(await port.imu!(false)).toBe(true);
    expect(f.imuCalls).toEqual([]);
    expect(await port.imu!(true, 100)).toBe(true);
    expect(await port.imu!(false)).toBe(true);
    // déjà fermé : rien n'est envoyé
    expect(await port.imu!(false)).toBe(true);
    expect(f.imuCalls).toEqual([[true, 100], [false]]);
    // deux fermetures en même temps : une seule part, même réponse pour les deux
    expect(await port.imu!(true, 200)).toBe(true);
    expect(await Promise.all([port.imu!(false), port.imu!(false)])).toEqual([true, true]);
    expect(f.imuCalls).toEqual([[true, 100], [false], [true, 200], [false]]);
  });

  it('fermeture refusée ou en échec : faux sans exception ; un nouvel appel réessaie, puis plus rien une fois fermé', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let close: 'non' | 'exception' | 'oui' = 'non';
    const { f, port } = evenPort({
      imu: (on) => {
        if (on) return true;
        if (close === 'exception') throw new Error('canal coupé');
        return close === 'oui';
      },
    });
    expect(await port.imu!(true, 100)).toBe(true);
    expect(await port.imu!(false)).toBe(false);
    close = 'exception';
    await expect(port.imu!(false)).resolves.toBe(false);
    close = 'oui';
    expect(await port.imu!(false)).toBe(true);
    expect(await port.imu!(false)).toBe(true);
    expect(f.imuCalls).toEqual([[true, 100], [false], [false], [false]]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ouvrir, fermer, rouvrir sans attendre : la dernière demande gagne et la fermeture suivante part bien', async () => {
    const { f, port, got } = evenPort({ imuDelayMs: 3 });
    expect(await Promise.all([port.imu!(true, 100), port.imu!(false), port.imu!(true, 200)])).toEqual([true, true, true]);
    // ouvert (dernière demande) : les mesures passent
    f.hub(imuEvent(0.1, 0.2, 9.7));
    expect(got).toHaveLength(1);
    // la fermeture du milieu, confirmée après la réouverture, ne fait pas croire le capteur fermé
    expect(await port.imu!(false)).toBe(true);
    expect(f.imuCalls).toEqual([[true, 100], [false], [true, 200], [false]]);
    f.hub(imuEvent(0.1, 0.2, 9.7));
    expect(got).toHaveLength(1);
  });

  it('l’ordre d’envoi suit l’ordre des appels, dans la file du pont, avec l’affichage', async () => {
    const { f, port } = evenPort();
    const cs: ContainerSpec[] = [{ id: 1, name: 'title', x: 28, y: 3, w: 300, h: 27, content: 'Test de l’écran', level: 4, capture: true }];
    const order: string[] = [];
    (f.raw.rebuildPageContainer as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push('rebuild'), true));
    (f.raw.imuControl as ReturnType<typeof vi.fn>).mockImplementation(async (on: boolean) => (order.push(on ? 'open' : 'close'), true));
    await Promise.all([port.rebuild(cs), port.imu!(true, 100), port.rebuild(cs), port.imu!(false)]);
    expect(order).toEqual(['rebuild', 'open', 'rebuild', 'close']);
  });
});

/* ------------------------------ Mesures : signal imu ------------------------------ */

describe('mesures du capteur : Sys_ItemEvent.imuData → signal imu', () => {
  it('conversion (vrais modèles du SDK) : x, y, z et l’heure de réception ; clés protobuf, textes numériques, type vide', () => {
    const t = WALL0 + 1234;
    expect(readHubEvent(imuEvent(0.12, -9.81, 1.5), t)).toEqual({ kind: 'imu', x: 0.12, y: -9.81, z: 1.5, at: t });
    expect(readHubEvent(sdkSys({ Event_Type: 8, IMU_Data: { x: 1, y: 0, z: -2 } }), t)).toEqual({ kind: 'imu', x: 1, y: 0, z: -2, at: t });
    expect(readHubEvent(evenHubEventFromJson({ type: 'sys_event', data: { event_type: 8, imu_data: { x: 3, y: 4, z: 5 } } }), t)).toEqual({ kind: 'imu', x: 3, y: 4, z: 5, at: t });
    // le SDK convertit les textes numériques et laisse alors le type vide : toujours une mesure, jamais un toucher
    expect(readHubEvent(sdkSys({ eventType: '8', imuData: { x: '1.5', y: '2', z: '-3' } }), t)).toEqual({ kind: 'imu', x: 1.5, y: 2, z: -3, at: t });
    expect(readHubEvent(sdkSys({ imuData: { x: 1, y: 2, z: 3 } }), t)).toEqual({ kind: 'imu', x: 1, y: 2, z: 3, at: t });
    // une enveloppe voisine sans type n'en fait pas un toucher
    expect(readHubEvent({ sysEvent: { eventType: 8, imuData: { x: 1, y: 2, z: 3 } }, textEvent: { containerID: 1 } } as never, t)).toEqual({ kind: 'imu', x: 1, y: 2, z: 3, at: t });
    // sans heure donnée : l'heure du moment
    const s = readHubEvent(imuEvent(1, 2, 3));
    expect(s?.kind).toBe('imu');
    expect(Math.abs((s as { at: number }).at - Date.now())).toBeLessThan(5000);
    // les autres événements ne changent pas
    expect(readHubEvent(sdkSys({ eventSource: 1 }), t)).toEqual({ kind: 'gesture', gesture: 'tap' });
    expect(readHubEvent(sdkSys({ eventType: 3 }), t)).toEqual({ kind: 'gesture', gesture: 'double' });
    expect(readHubEvent(sdkSys({ eventType: 4 }), t)).toEqual({ kind: 'foreground' });
  });

  it('mesure invalide (coordonnée manquante ou pas un nombre, imuData vide, absent ou pas un objet) : écartée, jamais un geste', () => {
    for (const jsonData of [
      { eventType: 8, imuData: { y: 2, z: 3 } },
      { eventType: 8, imuData: { x: 'abc', y: 2, z: 3 } },
      { eventType: 8, imuData: { x: 1, y: 2 } },
      { eventType: 8, imuData: {} },
      { eventType: 8, imuData: null },
      { eventType: 8 },
      { imuData: {} },
    ]) expect(readHubEvent(sdkSys(jsonData), 0), JSON.stringify(jsonData)).toBeNull();
    // autre hôte, objets bruts
    for (const imuData of [{ x: Number.NaN, y: 1, z: 1 }, { x: Number.POSITIVE_INFINITY, y: 1, z: 1 }, { x: 1, y: null, z: 1 }, { x: 1, y: ' ', z: 1 }, 5, 'x', [1, 2, 3]]) {
      expect(readHubEvent({ sysEvent: { eventType: 8, imuData } } as never, 0), JSON.stringify(imuData)).toBeNull();
      expect(readHubEvent({ sysEvent: { imuData }, textEvent: { containerID: 1 } } as never, 0)).not.toEqual({ kind: 'gesture', gesture: 'tap' });
    }
    expect(readImu(undefined, 0)).toBeNull();
    expect(readImu({ x: 0, y: 0, z: 0 }, 7)).toEqual({ kind: 'imu', x: 0, y: 0, z: 0, at: 7 });
  });

  it('par la plateforme : capteur ouvert, chaque mesure valide devient un signal daté par l’horloge de l’appli ; les invalides sont écartées', async () => {
    const { f, port, got, tick, wall } = evenPort();
    expect(await port.imu!(true, 100)).toBe(true);
    tick(100);
    f.hub(imuEvent(0.1, -9.8, 0.4));
    tick(100);
    f.hub(sdkSys({ eventType: 8, imuData: { y: -9.8, z: 0.4 } }));
    f.hub(sdkSys({ eventType: 8 }));
    tick(100);
    f.hub(sdkSys({ Event_Type: 8, IMU_Data: { x: 0.2, y: -9.7, z: 0.5 } }));
    expect(got).toEqual([
      { kind: 'imu', x: 0.1, y: -9.8, z: 0.4, at: WALL0 + 100 },
      { kind: 'imu', x: 0.2, y: -9.7, z: 0.5, at: wall() },
    ]);
    // fermé : les mesures encore en vol ne passent plus
    expect(await port.imu!(false)).toBe(true);
    f.hub(imuEvent(0.3, -9.6, 0.6));
    expect(got).toHaveLength(2);
  });

  it('jamais par le dédoublonnage ni la boîte de sortie : les mesures ne changent rien aux doublons des autres signaux', async () => {
    const d = new SignalDedup();
    const m: HubSignal = { kind: 'imu', x: 1, y: 2, z: 3, at: 0 };
    for (let i = 0; i < 20; i++) expect(d.accept(m, 1000 + i)).toBe(true);
    // arrière-plan, mesure, doublon de l'arrière-plan 80 ms plus tard : le doublon reste écarté
    expect(d.accept({ kind: 'background' }, 2000)).toBe(true);
    expect(d.accept(m, 2040)).toBe(true);
    expect(d.accept({ kind: 'background' }, 2080)).toBe(false);
    const x = new ExitDialog();
    x.arm(0);
    expect(x.map(m, 10)).toBe(m);
    expect(x.pending(10)).toBe(true);
    // par la plateforme : les mesures ne passent ni par le dédoublonnage ni par la boîte de sortie
    const accept = vi.spyOn(SignalDedup.prototype, 'accept');
    const map = vi.spyOn(ExitDialog.prototype, 'map');
    const { f, port, got, tick } = evenPort();
    await port.imu!(true, 100);
    f.hub(sdkSys({ eventType: 5 }));
    tick(40);
    f.hub(imuEvent(1, 2, 3));
    tick(40);
    f.hub(sdkSys({ eventType: 5 }));
    tick(40);
    f.hub(imuEvent(1, 2, 3));
    expect(got.map((s) => s.kind)).toEqual(['background', 'imu', 'imu']);
    expect(accept.mock.calls.map(([s]) => s.kind)).toEqual(['background', 'background']);
    expect(map.mock.calls.map(([s]) => s.kind)).toEqual(['background']);
  });
});

/* ------------------------------ État des lunettes : batterie et port ------------------------------ */

describe('état des lunettes : batterie et port dans le signal device', () => {
  it('lecture : batterie (entier de 1 à 100) et charge des lunettes connectées ; port et connexion comme en 1.2.10', () => {
    expect(readDeviceStatus({ sn: 'G2', connectType: 'connected', isWearing: true, batteryLevel: 63, isCharging: false, isInCase: false })).toEqual({ connected: true, wearing: true, battery: 63, charging: false });
    expect(readDeviceStatus({ connectType: 'connected', batteryLevel: 42.6, isCharging: true })).toEqual({ connected: true, battery: 43, charging: true });
    expect(readDeviceStatus({ connectType: 'connected', batteryLevel: '42' })).toEqual({ connected: true, battery: 42 });
    expect(readDeviceStatus({ connectType: 'connected', batteryLevel: 100.4 })).toEqual({ connected: true, battery: 100 });
    expect(readDeviceStatus({ connectType: 'connected', batteryLevel: 1 })).toEqual({ connected: true, battery: 1 });
    // 0 (valeur par défaut du SDK), hors de 0 à 100, pas un nombre : inconnue
    for (const bad of [0, 0.4, -5, 101, 255, Number.NaN, null, '', 'plein', undefined, {}]) {
      expect(readBattery(bad), JSON.stringify(bad)).toBeUndefined();
      expect(readDeviceStatus({ connectType: 'connected', batteryLevel: bad })).toEqual({ connected: true });
    }
    // lunettes pas connectées : ni batterie ni charge (valeur ancienne ou par défaut de l'hôte) ; le port reste lu
    expect(readDeviceStatus({ connectType: 'disconnected', isWearing: false, batteryLevel: 50, isCharging: true })).toEqual({ connected: false, wearing: false });
    for (const c of ['none', 'connecting', 'disconnected', 'connectionFailed']) expect(readDeviceStatus({ connectType: c, batteryLevel: 80 })).toEqual({ connected: false });
    expect(readDeviceStatus({ batteryLevel: 80 })).toBeNull();
  });

  it('état venu du vrai SDK : sans batterie, DeviceStatus.fromJson met 0, lu comme inconnue (jamais « 0 % ») ; avec batterie, lue', () => {
    const none = DeviceStatus.fromJson({ sn: 'G2', connectType: 'connected', isWearing: true });
    expect(none.batteryLevel).toBe(0);
    expect(readDeviceStatus(none)).toEqual({ connected: true, wearing: true, charging: false });
    expect(readDeviceStatus(DeviceStatus.fromJson({ sn: 'G2', connectType: 'connected', isWearing: true, batteryLevel: 12, isCharging: false }))).toEqual({ connected: true, wearing: true, battery: 12, charging: false });
    expect(readDeviceStatus(DeviceStatus.fromJson({ sn: 'G2', connectType: 'disconnected', batteryLevel: 12 }))).toEqual({ connected: false, wearing: false });
  });

  it('par la plateforme : batterie et port dans `device` ; un changement de batterie ou de charge fait un signal, le même état répété aucun', () => {
    const { f, got } = evenPort();
    const push = (p: Record<string, unknown>) => f.device(DeviceStatus.fromJson({ sn: 'G2', connectType: 'connected', isWearing: true, isCharging: false, ...p }));
    push({ batteryLevel: 80 });
    push({ batteryLevel: 80 });
    push({ batteryLevel: 19.6 });
    push({ batteryLevel: 19.8 });
    push({ batteryLevel: 19, isCharging: true });
    push({ batteryLevel: 19, isCharging: true, isWearing: false });
    push({ batteryLevel: 19, connectType: 'disconnected', isWearing: false });
    push({ batteryLevel: 19, connectType: 'connected', isWearing: true });
    expect(got).toEqual([
      { kind: 'device', connected: true, wearing: true, battery: 80, charging: false },
      { kind: 'device', connected: true, wearing: true, battery: 20, charging: false },
      { kind: 'device', connected: true, wearing: true, battery: 19, charging: true },
      { kind: 'device', connected: true, wearing: false, battery: 19, charging: true },
      { kind: 'device', connected: false, wearing: false },
      { kind: 'device', connected: true, wearing: true, battery: 19, charging: false },
    ]);
  });
});

/* ------------------------------ Quai Web : pas de lunettes ------------------------------ */

describe('Quai Web : sans lunettes, ni capteur ni batterie', () => {
  it('imu rend faux (ouvrir comme fermer, deux fois), aussi à travers les images du canvas ; aucun signal device ni imu', async () => {
    const painted: number[] = [];
    const web = createWebGlassesPort({ paint: (cs) => void painted.push(cs.length) });
    const got: HubSignal[] = [];
    web.onSignal((s) => got.push(s));
    expect(await web.imu!(true, 100)).toBe(false);
    expect(await web.imu!(true)).toBe(false);
    expect(await web.imu!(false)).toBe(false);
    expect(await web.imu!(false)).toBe(false);
    const port = withCanvasImages(web, { setImages: () => undefined, paintImage: () => true });
    expect(await port.imu!(true, 200)).toBe(false);
    expect(await port.imu!(false)).toBe(false);
    // le reste du port ne change pas
    const cs: ContainerSpec[] = [{ id: 1, name: 'title', x: 28, y: 3, w: 300, h: 27, content: 'Quai', level: 4, capture: true }];
    expect(await port.start(cs)).toBe(true);
    expect(await port.rebuild(cs)).toBe(true);
    web.emit({ kind: 'gesture', gesture: 'tap' });
    expect(got).toEqual([{ kind: 'gesture', gesture: 'tap' }]);
    expect(painted).toEqual([1, 1]);
  });
});

/* ------------------------------ Robustesse à 100 ms ------------------------------ */

describe('robustesse : capteur à 100 ms, 10 mesures par seconde', () => {
  it('10 minutes de mesures : chacune livrée tout de suite ; ni file, ni minuterie, ni promesse, ni trace, ni affichage par mesure', async () => {
    vi.useFakeTimers();
    const { f, port, queue, got, tick } = evenPort();
    const opened = port.imu!(true, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(await opened).toBe(true);
    const run = vi.spyOn(queue, 'run');
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k));
    const timers = vi.getTimerCount();
    // promesses créées pendant les mesures (la boucle est synchrone : rien d'autre ne tourne)
    let promises = 0;
    const hook = createHook({
      init(_id, type) {
        if (type === 'PROMISE') promises++;
      },
    });
    const N = 6000;
    hook.enable();
    for (let i = 0; i < N; i++) {
      tick(100);
      f.hub({ sysEvent: { eventType: 8, imuData: { x: Math.sin(i / 50), y: -9.81, z: 0.5 } } });
      // livrée pendant l'appel même : aucun saut asynchrone par mesure
      if (got.length !== i + 1) break;
      if (i % 500 === 0 && (queue.size !== 0 || vi.getTimerCount() !== timers)) break;
    }
    hook.disable();
    expect(got).toHaveLength(N);
    expect(promises).toBe(0);
    expect(got[N - 1]).toEqual({ kind: 'imu', x: Math.sin((N - 1) / 50), y: -9.81, z: 0.5, at: WALL0 + N * 100 });
    expect(queue.size).toBe(0);
    expect(vi.getTimerCount()).toBe(timers);
    expect(run).not.toHaveBeenCalled();
    for (const c of consoles) expect(c).not.toHaveBeenCalled();
    expect(f.display).toEqual([]);
    expect(f.imuCalls).toEqual([[true, 100]]);
  });

  it('un abonné qui lève sur chaque mesure : les autres reçoivent tout, une seule trace (pas 10 par seconde)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { f, port, got, tick } = evenPort();
    port.onSignal(() => {
      throw new Error('boum');
    });
    await port.imu!(true, 100);
    for (let i = 0; i < 50; i++) f.hub(imuEvent(i, 0, 0));
    expect(got).toHaveLength(50);
    expect(err).toHaveBeenCalledTimes(1);
    // les autres signaux gardent leur trace à chaque erreur, comme en 1.2.10
    f.hub({ menuItemClickEvent: { itemID: 1 } });
    tick(1000);
    f.hub({ menuItemClickEvent: { itemID: 2 } });
    expect(got.slice(50)).toEqual([
      { kind: 'menu', id: 1 },
      { kind: 'menu', id: 2 },
    ]);
    expect(err).toHaveBeenCalledTimes(3);
  });

  it('page rechargée pendant que le capteur était ouvert : mesures écartées, une seule fermeture ; mesures en vol après une fermeture : aucune autre', async () => {
    const { f, port, got, tick, closes } = evenPort();
    // personne n'a ouvert le capteur dans cette page, l'hôte envoie quand même des mesures
    for (let i = 0; i < 3; i++) {
      tick(100);
      f.hub(imuEvent(1, 2, 3));
    }
    await flush();
    expect(got).toEqual([]);
    expect(closes()).toBe(1);
    // quelques mesures encore en vol juste après : rien de plus
    for (let i = 0; i < 5; i++) {
      tick(100);
      f.hub(imuEvent(1, 2, 3));
      await flush();
    }
    expect(closes()).toBe(1);
    // ouvert par le contrôleur : les mesures passent ; fermé : celles en vol sont écartées sans nouvelle fermeture
    expect(await port.imu!(true, 200)).toBe(true);
    f.hub(imuEvent(4, 5, 6));
    expect(got).toEqual([{ kind: 'imu', x: 4, y: 5, z: 6, at: expect.any(Number) }]);
    expect(await port.imu!(false)).toBe(true);
    for (let i = 0; i < 5; i++) {
      tick(100);
      f.hub(imuEvent(1, 2, 3));
      await flush();
    }
    expect(got).toHaveLength(1);
    expect(closes()).toBe(2);
  });

  it('hôte qui ignore la fermeture et continue : une fermeture au plus par IMU_STRAY_CLOSE_MS, jamais une par mesure', async () => {
    const { f, got, tick, closes, queue } = evenPort();
    const SECONDS = 10;
    let maxQueue = 0;
    for (let i = 0; i < SECONDS * 10; i++) {
      tick(100);
      f.hub(imuEvent(1, 2, 3));
      maxQueue = Math.max(maxQueue, queue.size);
      await flush();
    }
    expect(got).toEqual([]);
    expect(closes()).toBeGreaterThanOrEqual(2);
    expect(closes()).toBeLessThanOrEqual(Math.ceil((SECONDS * 1000) / IMU_STRAY_CLOSE_MS));
    expect(maxQueue).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------ Traces du SDK ------------------------------ */

describe('traces du SDK : pas une ligne de console par mesure', () => {
  it('les lignes du SDK qui portent une mesure sont écartées ; toutes les autres passent, dans l’ordre ; installé une seule fois', () => {
    const seen: unknown[][] = [];
    const c = { log: (...a: unknown[]) => void seen.push(a) };
    quietImuLogs(c);
    const first = c.log;
    quietImuLogs(c);
    expect(c.log).toBe(first);
    // forme observée avec le SDK 0.0.16 : console.log('[EvenAppBridge] EvenHub event:', événement)
    c.log('[EvenAppBridge] EvenHub event:', imuEvent(0.1, 0.2, 9.7));
    c.log('[EvenAppBridge] EvenHub event:', sdkSys({ eventType: 8 }));
    const tap = sdkSys({ eventSource: 1 });
    c.log('[EvenAppBridge] EvenHub event:', tap);
    const status = DeviceStatus.fromJson({ sn: 'G2', connectType: 'connected', batteryLevel: 50 });
    c.log('[EvenAppBridge] Device status changed:', status);
    c.log('QUAI_SCREEN {"screen":"home"}');
    c.log('[Quai] autre trace', { sysEvent: { imuData: { x: 1 } } });
    c.log();
    expect(seen).toEqual([['[EvenAppBridge] EvenHub event:', tap], ['[EvenAppBridge] Device status changed:', status], ['QUAI_SCREEN {"screen":"home"}'], ['[Quai] autre trace', { sysEvent: { imuData: { x: 1 } } }], []]);
    expect(isSdkImuLog(['[EvenAppBridge] EvenHub event:', { jsonData: {}, sysEvent: { imuData: { x: 1, y: 2, z: 3 } } }])).toBe(true);
    expect(isSdkImuLog(['[EvenAppBridge] EvenHub event:', null, 3, 'x'])).toBe(false);
  });
});

/* ------------------------------ Garde-fou pour la fusion : le contrôleur ------------------------------ */

describe('garde-fou pour la fusion : le contrôleur et les signaux imu et device', () => {
  it('100 mesures et des changements de batterie seuls : aucun rendu, aucun anti-rebond des gestes, pas une trace par mesure', async () => {
    const h = await setup({ now: WALL0, settings: settingsWith([], { seenVersion: APP_VERSION }) });
    // premier état des lunettes (1.2.10 : il peut reconstruire la page une fois)
    h.emit({ kind: 'device', connected: true, wearing: true, battery: 80, charging: false });
    await h.settle(60);
    const calls = h.calls.length;
    const logs = h.logs.length;
    const debounce = vi.spyOn(GestureFilter.prototype, 'accept');
    for (let i = 0; i < 100; i++) h.emit({ kind: 'imu', x: 0.01 * i, y: -9.8, z: 0.3, at: WALL0 + i * 100 });
    expect(debounce).not.toHaveBeenCalled();
    h.emit({ kind: 'device', connected: true, wearing: true, battery: 79, charging: false });
    h.emit({ kind: 'device', connected: true, wearing: true, battery: 79, charging: true });
    h.emit({ kind: 'device', connected: true, wearing: true, battery: 15, charging: true });
    await h.settle(60);
    expect(h.calls.slice(calls)).toEqual([]);
    expect(h.logs.length - logs).toBeLessThan(4);
    h.c.stop();
  });
});
