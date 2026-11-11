/**
 * Quai Web : même contrôleur et mêmes écrans que les lunettes, avec les différences du web :
 * pas de sortie (message), gestes sans anti-rebond matériel, textes qui renvoient à l'onglet Réglages,
 * « Autre lieu » qui ouvre la recherche, position changée tout de suite (arrêt choisi).
 */
import { describe, expect, it, vi } from 'vitest';
import { GlassesController, WEB_EXIT_HINT } from '../../src/glasses/controller';
import type { HubSignal } from '../../src/glasses/gestures';
import { firstRunView, favoritesView, placesView } from '../../src/glasses/views';
import { createClock } from '../../src/platform/clock';
import { createKV, memoryBackend } from '../../src/platform/kv';
import type { Fix, GlassesPort, LocationPort, Platform } from '../../src/platform/types';
import { SettingsStore } from '../../src/settings';
import { dataFreshness } from '../../src/dev/fake-core';
import { textWidth } from '../../src/glasses/font';
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
  const settings = new SettingsStore(kv, { ...preset11(), onboarded: opts.onboarded ?? true, display: { ...preset11().display, opening: 'home' } });
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
  it('double toucher sur l’accueil : pas de sortie, un message court', async () => {
    const { c, exits, last, settle } = await setup();
    expect(last().screen).toBe('home');
    c.onSignal({ kind: 'gesture', gesture: 'double' });
    await settle();
    expect(exits).toEqual([]);
    expect(last().lines.at(-1)).toBe(WEB_EXIT_HINT);
    expect(textWidth(WEB_EXIT_HINT)).toBeLessThan(544);
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

  it('Aller à… « Autre adresse » ouvre la recherche dans l’onglet Réglages', async () => {
    const { c, last, settle, opened } = await setup();
    await c.replaceRoute({ screen: 'places' });
    await settle();
    expect(last().screen).toBe('places');
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
    expect(v.items.map((i) => i.a.replace(/\u00a0/g, ' '))).toEqual(['Bienvenue dans Quai !', 'Termine les réglages dans l’onglet Réglages :', 'position, langue et tes lieux, en une minute.']);
    expect(v.hints).toBe('toucher : continuer');
    expect(firstRunView({ ...ctx(), web: false }).hints).toMatch(/quitter/);
  });

  it('favoris et lieux : renvoient à l’onglet Réglages', () => {
    expect(favoritesView({}, ctx()).items.map((i) => i.a)).toEqual(['Aucun favori pour l’instant.', 'Ouvre un arrêt dans Autour de moi et touche-le,', 'ou ajoute un trajet dans l’onglet Réglages.']);
    const p = placesView({}, ctx());
    expect(p.items.map((i) => [i.a, i.c])).toEqual([
      ['Aucun lieu enregistré', 'dans Réglages'],
      ['Autre adresse', 'dans Réglages'],
    ]);
    expect(p.items.map((i) => i.action)).toEqual([
      { kind: 'phone', hash: '#/lieux/nouveau', text: 'Ajoute Maison ou Bureau dans l’onglet Réglages' },
      { kind: 'phone', hash: '#/recherche', text: 'Tape l’adresse dans l’onglet Réglages' },
    ]);
    // appli Even : inchangé
    expect(placesView({}, { ...ctx(), web: false }).items.map((i) => i.c)).toEqual(['sur le téléphone', 'sur le téléphone']);
  });
});
