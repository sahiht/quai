/**
 * 1.2.10 : plateforme de l'appli Even avec un faux pont : conteneurs d'image et menu système dans les pages, envoi des
 * images en série (PNG gris), échecs sans erreur, signaux du menu et des lunettes, doublons, boîte de sortie, flux de
 * positions du SDK.
 */
import { describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { AppLocationAccuracy, ImageRawDataUpdateResult, StartUpPageCreateResult, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { renderImage } from '../../src/glasses/images';
import type { ContainerSpec, ImageSpec, MenuItem } from '../../src/glasses/types';
import { MENU_IDS } from '../../src/glasses/types';
import type { HubSignal } from '../../src/glasses/gestures';
import { evenGlassesPort, evenLocationSource, menuLabel, pageImages, pageMenu, PAGE_LIMITS, type EvenBridge } from '../../src/platform/even';
import { SerialQueue } from '../../src/platform/queue';

const text = (id: number, name: string, capture = false): ContainerSpec => ({ id, name, x: 28, y: 3 + id * 27, w: 300, h: 27, content: name, level: 4, capture });
const CS: ContainerSpec[] = [text(1, 'title', true), text(2, 'clock'), text(3, 'colA'), text(4, 'colB'), text(5, 'foot')];
const img = (id: number, name: string, image: ImageSpec['image'] = { kind: 'turn', turn: 'left' }, w = 144, h = 144): ImageSpec => ({ id, name, x: 28, y: 33, w, h, image });
const MENU: MenuItem[] = [
  { id: MENU_IDS.stopGuide, label: 'Arrêter le guidage' },
  { id: MENU_IDS.allSteps, label: 'Voir tout le trajet' },
];
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Faux pont : enregistre les appels ; un seul appel d'image à la fois est vérifié. */
function fakeBridge(opts: { imageResult?: () => ImageRawDataUpdateResult | Promise<ImageRawDataUpdateResult>; rebuild?: () => boolean; startResult?: StartUpPageCreateResult; imageDelayMs?: number } = {}) {
  const calls: { op: string; arg: unknown }[] = [];
  let hub: ((e: EvenHubEvent) => void) | null = null;
  let device: ((s: unknown) => void) | null = null;
  let inImage = 0;
  let maxInImage = 0;
  const bridge = {
    createStartUpPageContainer: vi.fn(async (c: unknown) => {
      calls.push({ op: 'start', arg: JSON.parse(JSON.stringify(c)) });
      return opts.startResult ?? StartUpPageCreateResult.success;
    }),
    rebuildPageContainer: vi.fn(async (c: unknown) => {
      calls.push({ op: 'rebuild', arg: JSON.parse(JSON.stringify(c)) });
      return opts.rebuild ? opts.rebuild() : true;
    }),
    textContainerUpgrade: vi.fn(async () => true),
    updateImageRawData: vi.fn(async (d: { containerID?: number; containerName?: string; imageData?: unknown }) => {
      inImage++;
      maxInImage = Math.max(maxInImage, inImage);
      calls.push({ op: 'image', arg: { id: d.containerID, name: d.containerName, data: d.imageData } });
      await new Promise((r) => setTimeout(r, opts.imageDelayMs ?? 1));
      inImage--;
      return opts.imageResult ? opts.imageResult() : ImageRawDataUpdateResult.success;
    }),
    onEvenHubEvent: vi.fn((cb: (e: EvenHubEvent) => void) => {
      hub = cb;
      return () => {
        hub = null;
      };
    }),
    onDeviceStatusChanged: vi.fn((cb: (s: unknown) => void) => {
      device = cb;
      return () => {
        device = null;
      };
    }),
    shutDownPageContainer: vi.fn(async () => true),
  };
  return {
    bridge: bridge as unknown as EvenBridge,
    raw: bridge,
    calls,
    hub: (e: Record<string, unknown>) => hub?.(e as EvenHubEvent),
    device: (s: unknown) => device?.(s),
    subscribed: () => !!hub && !!device,
    maxConcurrentImages: () => maxInImage,
  };
}

/** PNG reçu par le faux pont → niveaux 0..15 (filtre Up défait). */
function pngLevels(data: number[], w: number, h: number): number[] {
  const png = Uint8Array.from(data);
  expect(Array.from(png.subarray(1, 4), (c) => String.fromCharCode(c)).join('')).toBe('PNG');
  const len = new DataView(png.buffer).getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + len));
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push((raw[y * (w + 1) + 1 + x] + (y ? out[(y - 1) * w + x] : 0)) & 0xff);
  return out.map((v) => v / 17);
}

describe('pages : conteneurs d’image et menu système (SDK 0.0.14+)', () => {
  it('start et rebuild : textes, images (imageObject), menu (menuObject), nombre total de conteneurs', async () => {
    const f = fakeBridge();
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    expect(await port.start(CS, { images: [img(20, 'img-turn')], menu: MENU })).toBe(true);
    const start = f.calls[0].arg as Record<string, unknown>;
    expect(start.containerTotalNum).toBe(6);
    expect((start.textObject as unknown[]).length).toBe(5);
    expect(start.imageObject).toEqual([expect.objectContaining({ xPosition: 28, yPosition: 33, width: 144, height: 144, containerID: 20, containerName: 'img-turn' })]);
    expect(start.menuObject).toEqual({ menuItems: [expect.objectContaining({ itemID: 1, itemName: 'Arrêter le guidage' }), expect.objectContaining({ itemID: 2, itemName: 'Voir tout le trajet' })] });
    // page sans extra : ni image ni menu (la reconstruction sans menuObject efface le menu de Quai)
    expect(await port.rebuild(CS)).toBe(true);
    const plain = f.calls[1].arg as Record<string, unknown>;
    expect(plain.containerTotalNum).toBe(5);
    expect(plain).not.toHaveProperty('imageObject');
    expect(plain).not.toHaveProperty('menuObject');
    expect(await port.rebuild(CS, { images: [], menu: [] })).toBe(true);
    expect(f.calls[2].arg).not.toHaveProperty('menuObject');
  });

  it('images hors des limites du SDK écartées (la page reste valide) ; 4 au plus ; 12 conteneurs au plus', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = pageImages(CS, [
      img(20, 'a'),
      img(21, 'big', undefined, 300, 144),
      img(22, 'tall', undefined, 144, 145),
      img(23, 'tiny', undefined, 19, 40),
      { ...img(24, 'out'), x: 500 },
      img(1, 'sameid'),
      img(25, 'title'),
      img(26, 'nom-beaucoup-trop-long'),
      img(20, 'dup'),
      img(27, 'b'),
      img(28, 'c'),
      img(29, 'd'),
      img(30, 'e'),
    ]);
    expect(ok.map((i) => i.name)).toEqual(['a', 'b', 'c', 'd']);
    const eight = Array.from({ length: 8 }, (_, i) => text(i + 1, `t${i}`));
    expect(pageImages(eight, [img(20, 'a'), img(21, 'b'), img(22, 'c'), img(23, 'd')])).toHaveLength(PAGE_LIMITS.containers - 8);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('menu : identifiants uint32 non nuls et uniques, libellé de 32 octets au plus (coupé avec « … »), 10 choix au plus', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(menuLabel('Arrêter le guidage')).toBe('Arrêter le guidage');
    const long = menuLabel('Voir tout le trajet guidé jusqu’à l’arrivée');
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(32);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('Voir tout le trajet')).toBe(true);
    const items = pageMenu([{ id: 0, label: 'zéro' }, { id: 1, label: 'un' }, { id: 1, label: 'doublon' }, { id: -2, label: 'négatif' }, { id: 1.5, label: 'demi' }, { id: 3, label: '  ' }, ...Array.from({ length: 12 }, (_, i) => ({ id: 10 + i, label: `choix ${i}` }))]);
    expect(items[0]).toEqual({ id: 1, label: 'un' });
    expect(items).toHaveLength(PAGE_LIMITS.menuItems);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    warn.mockRestore();
  });

  it('page refusée par l’hôte : faux, et ses images ne partent pas', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fakeBridge({ startResult: StartUpPageCreateResult.invalid, rebuild: () => false });
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    expect(await port.start(CS, { images: [img(20, 'i')] })).toBe(false);
    expect(await port.paint!(img(20, 'i'))).toBe(false);
    expect(await port.rebuild(CS, { images: [img(20, 'i')] })).toBe(false);
    expect(await port.paint!(img(20, 'i'))).toBe(false);
    expect(f.calls.filter((c) => c.op === 'image')).toHaveLength(0);
    err.mockRestore();
  });
});

describe('paint : updateImageRawData, une image à la fois', () => {
  it('envoie l’image rendue en PNG gris dans son conteneur (relue au pixel près)', async () => {
    const f = fakeBridge();
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    const sign = img(21, 'img-sign', { kind: 'sign', label: 'bus', value: '6' });
    await port.rebuild(CS, { images: [sign] });
    expect(await port.paint!(sign)).toBe(true);
    const sent = f.calls.find((c) => c.op === 'image')!.arg as { id: number; name: string; data: number[] };
    expect([sent.id, sent.name]).toEqual([21, 'img-sign']);
    expect(pngLevels(sent.data, 144, 144)).toEqual(Array.from(renderImage(sign)));
  });

  it('jamais deux envois en même temps, dans l’ordre des appels, même demandés ensemble', async () => {
    const f = fakeBridge({ imageDelayMs: 5 });
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    const a = img(20, 'a', { kind: 'turn', turn: 'left' });
    const b = { ...img(21, 'b', { kind: 'sign', label: 'voie', value: '3' }), x: 300 };
    const c = { ...img(22, 'c', { kind: 'bearing', deg: 40 }), x: 430, w: 140 };
    await port.rebuild(CS, { images: [a, b, c] });
    const results = await Promise.all([port.paint!(a), port.paint!(b), port.paint!(c), port.upgrade(CS[1], { content: true, level: false })]);
    expect(results).toEqual([true, true, true, true]);
    expect(f.maxConcurrentImages()).toBe(1);
    expect(f.calls.filter((x) => x.op === 'image').map((x) => (x.arg as { name: string }).name)).toEqual(['a', 'b', 'c']);
  });

  it('même image déjà envoyée depuis la dernière page : rien ne repart ; nouvelle page : elle repart', async () => {
    const f = fakeBridge();
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    const a = img(20, 'a', { kind: 'turn', turn: 'right' });
    await port.rebuild(CS, { images: [a] });
    expect(await port.paint!(a)).toBe(true);
    expect(await port.paint!({ ...a })).toBe(true);
    expect(f.raw.updateImageRawData).toHaveBeenCalledTimes(1);
    // autre contenu dans le même conteneur : envoyé
    expect(await port.paint!({ ...a, image: { kind: 'turn', turn: 'left' } })).toBe(true);
    expect(f.raw.updateImageRawData).toHaveBeenCalledTimes(2);
    // page reconstruite (conteneurs recréés vides) : renvoyée
    await port.rebuild(CS, { images: [a] });
    expect(await port.paint!({ ...a, image: { kind: 'turn', turn: 'left' } })).toBe(true);
    expect(f.raw.updateImageRawData).toHaveBeenCalledTimes(3);
  });

  it('conteneur absent de la page, autre nom ou autre taille : faux, sans appel', async () => {
    const f = fakeBridge();
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    await port.rebuild(CS, { images: [img(20, 'a')] });
    expect(await port.paint!(img(99, 'a'))).toBe(false);
    expect(await port.paint!(img(20, 'autre'))).toBe(false);
    expect(await port.paint!(img(20, 'a', undefined, 100, 100))).toBe(false);
    await port.rebuild(CS);
    expect(await port.paint!(img(20, 'a'))).toBe(false);
    expect(f.raw.updateImageRawData).not.toHaveBeenCalled();
  });

  it('page changée avant l’envoi : l’image de l’ancienne page ne part pas', async () => {
    const f = fakeBridge();
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    const a = img(20, 'a');
    void port.rebuild(CS, { images: [a] });
    const p = port.paint!(a);
    void port.rebuild(CS, { images: [{ ...a, image: { kind: 'turn', turn: 'uturn' } }] });
    expect(await p).toBe(false);
    expect(f.raw.updateImageRawData).not.toHaveBeenCalled();
  });

  it('échec de l’hôte (sendFailed, exception, délai dépassé) : faux, jamais d’erreur, nouvel essai possible', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let mode: 'fail' | 'throw' | 'ok' = 'fail';
    const f = fakeBridge({
      imageResult: () => {
        if (mode === 'throw') throw new Error('canal coupé');
        return mode === 'fail' ? ImageRawDataUpdateResult.sendFailed : ImageRawDataUpdateResult.success;
      },
    });
    const port = evenGlassesPort(f.bridge, new SerialQueue());
    const a = img(20, 'a');
    await port.rebuild(CS, { images: [a] });
    expect(await port.paint!(a)).toBe(false);
    mode = 'throw';
    await expect(port.paint!(a)).resolves.toBe(false);
    mode = 'ok';
    expect(await port.paint!(a)).toBe(true);
    expect(f.raw.updateImageRawData).toHaveBeenCalledTimes(3);
    // hôte muet : délai de 5 s, faux
    vi.useFakeTimers();
    const slow = fakeBridge({ imageResult: () => new Promise(() => undefined) });
    const sp = evenGlassesPort(slow.bridge, new SerialQueue());
    void sp.rebuild(CS, { images: [a] });
    const pending = sp.paint!(a);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(await pending).toBe(false);
    vi.useRealTimers();
    warn.mockRestore();
  });
});

describe('signaux : menu, lunettes, doublons, boîte de sortie', () => {
  function setup() {
    const f = fakeBridge();
    let t = 1000;
    const port = evenGlassesPort(f.bridge, new SerialQueue(), () => t);
    const got: HubSignal[] = [];
    const off = port.onSignal((s) => got.push(s));
    return { f, port, got, off, at: (ms: number) => (t = ms) };
  }

  it('choix du menu système → `menu` ; doublon du choix écarté', () => {
    const { f, got, at } = setup();
    f.hub({ menuItemClickEvent: { itemID: MENU_IDS.stopGuide } });
    at(1050);
    f.hub({ menuItemClickEvent: { itemID: MENU_IDS.stopGuide } });
    at(5000);
    f.hub({ menuItemClickEvent: { itemID: MENU_IDS.allSteps } });
    expect(got).toEqual([
      { kind: 'menu', id: 1 },
      { kind: 'menu', id: 2 },
    ]);
  });

  it('lunettes : seulement les changements (connexion, port ; 1.3.0 : batterie) ; le même état répété : rien', () => {
    const { f, got } = setup();
    f.device({ connectType: 'connected', isWearing: true, batteryLevel: 90 });
    f.device({ connectType: 'connected', isWearing: true, batteryLevel: 89 });
    f.device({ connectType: 'connected', isWearing: true, batteryLevel: 89 });
    f.device({ connectType: 'disconnected', isWearing: true });
    f.device({ connectType: 'connected', isWearing: true });
    // 1.3.0 (PRD-1.3.0 § 6.3) : la batterie est dans le signal ; son changement en fait un
    expect(got).toEqual([
      { kind: 'device', connected: true, wearing: true, battery: 90 },
      { kind: 'device', connected: true, wearing: true, battery: 89 },
      { kind: 'device', connected: false, wearing: true },
      { kind: 'device', connected: true, wearing: true },
    ]);
  });

  it('doublon du micrologiciel (50 à 100 ms) écarté ; gestes transmis tels quels (anti-rebond du contrôleur)', () => {
    const { f, got, at } = setup();
    f.hub({ sysEvent: { eventType: 5 } });
    at(1080);
    f.hub({ sysEvent: { eventType: 5 } });
    at(4000);
    f.hub({ sysEvent: { eventType: 4 } });
    at(4060);
    f.hub({ sysEvent: { eventType: 4 } });
    f.hub({ sysEvent: { eventSource: 1 } });
    f.hub({ sysEvent: { eventSource: 1 } });
    f.hub({ sysEvent: { eventType: 9 } });
    expect(got).toEqual([{ kind: 'background' }, { kind: 'foreground' }, { kind: 'gesture', gesture: 'tap' }, { kind: 'gesture', gesture: 'tap' }]);
  });

  it('boîte de sortie : « Non » (4 puis 5) arrive comme deux `foreground` ; « Oui » (7) comme la sortie', async () => {
    const { f, port, got, at } = setup();
    await port.exit(1);
    expect(f.raw.shutDownPageContainer).toHaveBeenCalledWith(1);
    at(1100);
    f.hub({ sysEvent: { eventType: 4 } });
    at(6000);
    f.hub({ sysEvent: { eventType: 5 } });
    // ensuite, un vrai passage en arrière-plan
    at(20_000);
    f.hub({ sysEvent: { eventType: 5 } });
    at(30_000);
    await port.exit(1);
    at(30_100);
    f.hub({ sysEvent: { eventType: 4 } });
    at(31_000);
    f.hub({ sysEvent: { eventType: 7 } });
    expect(got).toEqual([{ kind: 'foreground' }, { kind: 'foreground' }, { kind: 'background' }, { kind: 'foreground' }, { kind: 'exit', abnormal: false }]);
  });

  it('plusieurs abonnés, un seul abonnement au pont ; retiré avec le dernier abonné', () => {
    const { f, port, got, off } = setup();
    const other: HubSignal[] = [];
    const off2 = port.onSignal((s) => other.push(s));
    expect(f.raw.onEvenHubEvent).toHaveBeenCalledTimes(1);
    f.hub({ menuItemClickEvent: { itemID: 2 } });
    expect(got).toEqual([{ kind: 'menu', id: 2 }]);
    expect(other).toEqual([{ kind: 'menu', id: 2 }]);
    off();
    expect(f.subscribed()).toBe(true);
    off2();
    expect(f.subscribed()).toBe(false);
  });

  it('un abonné qui lève n’empêche pas les autres', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = fakeBridge();
    const port = evenGlassesPort(f.bridge, new SerialQueue(), () => 0);
    const got: HubSignal[] = [];
    port.onSignal(() => {
      throw new Error('boum');
    });
    port.onSignal((s) => got.push(s));
    f.hub({ menuItemClickEvent: { itemID: 1 } });
    expect(got).toEqual([{ kind: 'menu', id: 1 }]);
    err.mockRestore();
  });
});

describe('positions continues du SDK', () => {
  it('startAppLocationUpdates : précision du SDK, intervalle, distanceFilter ; stop et abonnement', async () => {
    const calls: unknown[] = [];
    const bridge = {
      getAppLocation: vi.fn(async (o: unknown) => (calls.push(['get', o]), { latitude: 50.62, longitude: 5.57, accuracy: 8 })),
      startAppLocationUpdates: vi.fn(async (o: unknown) => (calls.push(['start', o]), true)),
      stopAppLocationUpdates: vi.fn(async () => (calls.push(['stop']), true)),
      onAppLocationChanged: vi.fn(() => () => undefined),
    };
    const src = evenLocationSource(bridge as never);
    await src.getAppLocation({ timeoutMs: 5000 });
    await src.startUpdates!({ accuracy: 'medium', intervalMs: 30_000, distanceFilter: 0 });
    await src.startUpdates!({ accuracy: 'high', intervalMs: 2000, distanceFilter: 0 });
    await src.stopUpdates!();
    src.onUpdate!(() => undefined);
    expect(calls).toEqual([
      ['get', { accuracy: AppLocationAccuracy.High, timeoutMs: 5000 }],
      ['start', { accuracy: AppLocationAccuracy.Medium, intervalMs: 30_000, distanceFilter: 0 }],
      ['start', { accuracy: AppLocationAccuracy.High, intervalMs: 2000, distanceFilter: 0 }],
      ['stop'],
    ]);
    expect(bridge.onAppLocationChanged).toHaveBeenCalledTimes(1);
    await tick();
  });
});
