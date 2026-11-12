/**
 * Quai Web : même contrôleur et mêmes écrans que les lunettes, avec les différences du web :
 * pas de sortie (1.2.1 : sans message, PRD-1.2.1 § 4.5), gestes sans anti-rebond matériel, textes qui renvoient à
 * l'onglet Réglages, « Autre adresse » (1.2.2 : en fin de « Favoris », PRD-1.2.2 § 1.2) qui ouvre la recherche,
 * position changée tout de suite (endroit choisi). Les ancres #/gares et #/lignes ouvertes par les lunettes :
 * test/phone/app.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { GlassesController } from '../../src/glasses/controller';
import type { HubSignal } from '../../src/glasses/gestures';
import { firstRunView, favoritesView } from '../../src/glasses/views';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix, GlassesPort, LocationPort, Platform } from '../../src/platform/types';
import { SettingsStore } from '../../src/settings';
import { APP_VERSION } from '../../src/version';
import { dataFreshness } from '../../src/dev/fake-core';
import { defaults, fakeCore, preset11, SCENARIO } from '../ui/helpers';

function movableLocation(fix: Fix | null): LocationPort & { set(f: Fix | null): void } {
  let cur = fix;
  return { current: async () => cur, last: () => cur, set: (f) => (cur = f) };
}

async function setup(opts: { web?: boolean; onboarded?: boolean; here?: Fix | null } = {}) {
  const sc = SCENARIO.s2;
  let t = 0;
  const clock = createClock({ mockNow: sc.now, perfNow: () => t });
  const exits: number[] = [];
  let listener: ((s: HubSignal) => void) | null = null;
  const port: GlassesPort = {
    start: async () => true,
    rebuild: async () => true,
    upgrade: async () => true,
    onSignal: (cb) => ((listener = cb), () => (listener = null)),
    exit: async (m) => void exits.push(m),
  };
  const loc = movableLocation(opts.here === undefined ? { lat: sc.lat, lon: sc.lon, at: 0, source: 'mock' } : opts.here);
  const kv = createKV(memoryBackend());
  const platform: Platform = { kind: 'web', glasses: port, kv, location: loc, closeWebView: vi.fn() };
  // version déjà vue : pas de message « Quai 1.2 » à l'ouverture (préréglage de la 1.1)
  const settings = new SettingsStore(kv, { ...preset11(), onboarded: opts.onboarded ?? true, seenVersion: APP_VERSION, display: { ...preset11().display, opening: 'home' } });
  const logs: string[] = [];
  const opened: string[] = [];
  const c = new GlassesController({
    platform,
    core: fakeCore(clock.now),
    settings,
    clock,
    configured: true,
    freshness: dataFreshness,
    e2e: true,
    log: (l) => logs.push(l),
    web: opts.web ?? true,
    openPhone: (h) => opened.push(h),
  });
  await c.start();
  const settle = () => new Promise((r) => setTimeout(r, 30));
  await settle();
  const last = () => JSON.parse(logs.filter((l) => l.startsWith('QUAI_SCREEN ')).at(-1)!.slice(12)) as { screen: string; title: string; lines: string[]; sel: number };
  return { c, exits, last, settle, loc, opened, emit: (s: HubSignal) => listener?.(s), advance: (ms: number) => (t += ms), settings };
}

describe('contrôleur en mode web', () => {
  it('double toucher sur l’accueil : pas de sortie, et plus de message en pied (PRD-1.2.1 § 4.5)', async () => {
    const { c, exits, last, settle } = await setup();
    const home = last();
    expect(home.screen).toBe('home');
    c.onSignal({ kind: 'gesture', gesture: 'double' });
    await settle();
    expect(exits).toEqual([]);
    // l'accueil reste tel quel : ni « Sur le web, ferme simplement l’onglet », ni autre ligne de pied
    expect(last()).toEqual(home);
    expect(last().lines.join('\n')).not.toMatch(/ferme simplement/);
    c.stop();
  });

  it('appli Even inchangée : double toucher sur l’accueil = boîte de sortie système', async () => {
    const { c, exits, settle } = await setup({ web: false });
    c.onSignal({ kind: 'gesture', gesture: 'double' });
    await settle();
    expect(exits).toEqual([1]);
    c.stop();
  });

  it('boutons et clavier : chaque appui compte (pas l’anti-rebond du pavé des G2)', async () => {
    const pause = () => new Promise((r) => setTimeout(r, 90));
    const { c, last, settle } = await setup();
    c.onSignal({ kind: 'gesture', gesture: 'down' });
    await pause();
    c.onSignal({ kind: 'gesture', gesture: 'down' });
    await settle();
    expect(last().sel).toBe(2);
    c.stop();
    // appli Even : deux glissements dans le même sens à moins de 350 ms = un seul (doublons du pavé)
    const even = await setup({ web: false });
    even.c.onSignal({ kind: 'gesture', gesture: 'down' });
    await pause();
    even.c.onSignal({ kind: 'gesture', gesture: 'down' });
    await even.settle();
    expect(even.last().sel).toBe(1);
    even.c.stop();
  });

  it('position choisie ou perdue : appliquée tout de suite (sans attendre 30 s)', async () => {
    const { c, last, settle, loc } = await setup({ here: null });
    const around = () => last().lines.find((l) => l.startsWith('Autour de moi'));
    expect(around()).toBe('Autour de moi   sans position');
    loc.set({ lat: SCENARIO.s2.lat, lon: SCENARIO.s2.lon, at: 0, source: 'manual' });
    await c.relocate();
    await settle();
    expect(around()).toMatch(/^Autour de moi {3}\d+ arrêts?$/);
    loc.set(null);
    await c.relocate();
    await settle();
    expect(around()).toBe('Autour de moi   sans position');
    c.stop();
  });

  it('« Favoris », « Autre adresse » ouvre la recherche dans l’onglet Réglages (PRD-1.2.2 § 1.2)', async () => {
    const { c, last, settle, opened } = await setup();
    await c.replaceRoute({ screen: 'favorites' });
    await settle();
    expect(last().screen).toBe('favorites');
    const idx = last().lines.findIndex((l) => l.startsWith('Autre adresse'));
    expect(last().lines[idx]).toBe('Autre adresse   dans Réglages');
    for (let i = 0; i < idx; i++) c.onGesture('down');
    await settle();
    c.onGesture('tap');
    await settle();
    expect(opened).toEqual(['#/recherche']);
    c.stop();
  });
});

describe('écrans des lunettes en mode web', () => {
  const ctx = (patch = {}) => ({ now: SCENARIO.s2.now, settings: defaults(patch), web: true });

  it('premier lancement : réglages dans l’onglet Réglages, rien à quitter', () => {
    const v = firstRunView(ctx());
    expect(v.items.map((i) => i.a).join(' ')).toContain('l’onglet Réglages');
    expect(v.items.map((i) => i.a).join(' ')).not.toMatch(/Even Hub|téléphone/);
    expect(v.items.map((i) => i.a.replace(/\u00a0/g, ' '))).toEqual(['Bienvenue dans Quai !', 'Termine les réglages dans l’onglet Réglages :', 'position, langue et tes favoris, en une minute.']);
    expect(v.hints).toBe('toucher : continuer');
    expect(firstRunView({ ...ctx(), web: false }).hints).toMatch(/quitter/);
  });

  it('« Favoris » vide : renvoie à l’onglet Réglages, jamais au téléphone ; ce qui s’ouvre dans Réglages a son ancre', () => {
    const texts = (v: ReturnType<typeof favoritesView>) => v.items.flatMap((i) => [i.a, i.b, i.c, i.action?.kind === 'phone' ? i.action.text : '']).filter(Boolean).join(' ').replace(/\u00a0/g, ' ');
    const web = favoritesView({}, ctx());
    expect(texts(web)).toMatch(/Réglages/);
    expect(texts(web)).not.toMatch(/téléphone|Even Hub/);
    for (const i of web.items) if (i.action?.kind === 'phone') expect(['#/favoris/nouveau', '#/recherche']).toContain(i.action.hash);
    // appli Even : le téléphone
    expect(texts(favoritesView({}, { ...ctx(), web: false }))).toMatch(/téléphone/);
  });
});
