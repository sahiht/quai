/**
 * Quai 1.2.5 (docs/v1.2.5/PRD-1.2.5.md § 6) : reprise d'un état gardé (téléphone verrouillé, nouvelle WebView) sans
 * attendre la position : la position gardée sert tout de suite, la nouvelle la remplace quand elle arrive ; sans état
 * gardé, le démarrage attend la position (5 s au plus), comme avant. Réglage « Pluie pendant la marche » relu.
 */
import { describe, expect, it } from 'vitest';
import type { Core, Journey, Meta, Settings } from '../../src/core/api';
import type { Fix } from '../../src/platform/types';
import { validateSettings } from '../../src/settings';
import { at, defaults, movableLocation, setupController, type Screen } from './helpers';

/** Position qui ne répond qu'au signal du test. */
function gatedLocation(now: () => number) {
  const base = movableLocation(now, { lat: 50.4655, lon: 4.859 });
  let open: (f: Fix | null) => void = () => undefined;
  let pending: Promise<Fix | null> | null = null;
  const loc = {
    ...base,
    current: () => (pending ??= new Promise<Fix | null>((r) => (open = r))),
  };
  return { loc, release: (f: Fix | null) => open(f) };
}

const stepsReady = (s: Screen) => s.screen === 'steps' && s.page !== undefined;

describe('PRD-1.2.5 § 6 : reprise sans attendre la position', () => {
  it('état gardé : l’écran revient tout de suite ; la position arrivée ensuite remplace la gardée', async () => {
    const a = await setupController();
    await a.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('Bureau')));
    await a.gesture('tap');
    await a.until(stepsReady);
    const snap = a.c.snapshot();
    expect(snap.here).toMatchObject({ lat: 50.4655, lon: 4.859 });
    a.c.stop();

    const clockNow = () => at(7, 33);
    const g = gatedLocation(clockNow);
    const b = await setupController({ kv: a.kv, now: at(7, 33), location: g.loc, noWait: true, beforeStart: (c) => c.restore(JSON.stringify(snap)) });
    const s = await b.until(stepsReady);
    expect(s).toMatchObject({ screen: 'steps', page: 1 });
    // la position du téléphone arrive : elle remplace la gardée
    g.release({ lat: 50.47, lon: 4.86, accuracy: 5, at: at(7, 33), source: 'mock' });
    await b.settle();
    expect(b.c.snapshot().here).toMatchObject({ lat: 50.47, lon: 4.86 });
    b.c.stop();
  });

  it('état gardé sur l’accueil : la position arrivée loin de la gardée (plus de 30 m) recalcule l’accueil tout de suite', async () => {
    const a = await setupController();
    await a.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('Bureau')));
    const snap = a.c.snapshot();
    a.c.stop();
    const g = gatedLocation(() => at(7, 32));
    const b = await setupController({ kv: a.kv, now: at(7, 32), location: g.loc, noWait: true, beforeStart: (c) => c.restore(JSON.stringify(snap)) });
    const home = await b.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('Autour de moi')));
    const before = home.lines.find((l) => l.startsWith('Autour de moi'));
    // Bruxelles-Nord au lieu de Namur : « Autour de moi » et l'ordre des favoris (accueil pas encore touché) suivent
    g.release({ lat: 50.86, lon: 4.359, accuracy: 5, at: at(7, 32), source: 'mock' });
    const after = await b.until((s) => s.screen === 'home' && s.lines.find((l) => l.startsWith('Autour de moi')) !== before);
    expect(after.lines.find((l) => l.startsWith('Autour de moi'))).not.toBe(before);
    expect(b.c.snapshot().here).toMatchObject({ lat: 50.86, lon: 4.359 });
    b.c.stop();
  });

  it('état gardé dont la position a plus de 2 min : on attend la nouvelle (5 s au plus), comme sans état gardé', async () => {
    const a = await setupController();
    await a.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('Bureau')));
    await a.gesture('tap');
    await a.until(stepsReady);
    // position gardée prise 11 min avant l'instantané (l'horloge de l'instantané revient avec lui)
    const snap = { ...a.c.snapshot(), here: { lat: 50.4655, lon: 4.859, accuracy: 5, at: at(7, 20), source: 'mock' } };
    a.c.stop();
    const g = gatedLocation(() => at(7, 31));
    const b = await setupController({ kv: a.kv, now: at(7, 31), location: g.loc, noWait: true, beforeStart: (c) => c.restore(JSON.stringify(snap)) });
    await b.settle(150);
    expect(b.screens().some((s) => s.screen === 'steps')).toBe(false);
    g.release({ lat: 50.4655, lon: 4.859, accuracy: 5, at: at(7, 31), source: 'mock' });
    expect((await b.until(stepsReady)).screen).toBe('steps');
    b.c.stop();
  });

  it('sans état gardé : le démarrage attend la position, comme avant', async () => {
    const g = gatedLocation(() => at(7, 31));
    const b = await setupController({ location: g.loc, noWait: true });
    await b.settle(150);
    expect(b.screens().some((s) => s.screen === 'home')).toBe(false);
    g.release({ lat: 50.4655, lon: 4.859, accuracy: 5, at: at(7, 31), source: 'mock' });
    expect((await b.until((s) => s.screen === 'home')).screen).toBe('home');
    b.c.stop();
  });
});

describe('PRD-1.2.5 § 6 : publication adoptée après le lancement (copie servie au bout de 4 s, puis le réseau)', () => {
  it('le bandeau de fraîcheur et l’écran Données suivent la publication du cœur, tout de suite', async () => {
    let tell: ((gen: string) => void) | undefined;
    let live: Meta | null = null;
    const b = await setupController({
      wrap: (core) =>
        new Proxy(core, {
          get(target, prop) {
            if (prop === 'meta') return live;
            if (prop === 'onGeneration') return (cb: (gen: string) => void) => void (tell = cb);
            if (prop === 'init')
              return async () => {
                const m = await target.init();
                // la copie enregistrée : la publication du 07/11
                live = { ...m, generatedAt: '2026-11-07T02:12:00.000Z', serviceDates: ['2026-11-07', '2026-11-08'] };
                return live;
              };
            const v = Reflect.get(target, prop, target) as unknown;
            return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
          },
        }),
    });
    const stale = await b.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('Autour de moi')));
    expect(stale.lines[0]).toMatch(/^Horaires périmés : mise à jour arrêtée le 07\/11/);
    expect(b.c.freshness?.ok).toBe(false);
    // la réponse du réseau arrive : le cœur adopte la publication du jour et prévient
    live = { ...live!, generatedAt: '2026-11-10T02:12:00.000Z', serviceDates: ['2026-11-10', '2026-11-11'] };
    tell?.(live.generatedAt);
    const fresh = await b.until((s) => s.screen === 'home' && !s.lines[0].startsWith('Horaires'));
    expect(fresh.lines[0]).not.toMatch(/^Horaires/);
    expect(b.c.freshness?.ok).toBe(true);
    expect(b.c.currentMeta?.generatedAt).toBe('2026-11-10T02:12:00.000Z');
    b.c.stop();
  });
});

describe('PRD-1.2.5 § 1 : « Si tu le rates » sur des trajets de repli à jour', () => {
  /** Cœur dont refresh() note les trajets rafraîchis. */
  const spying = (seen: string[]) => (core: Core): Core =>
    new Proxy(core, {
      get(target, prop) {
        if (prop === 'refresh') return (j: Journey, s: Settings, o?: { followed?: boolean }) => (seen.push(j.id), target.refresh(j, s, o));
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });

  it('dans sa fenêtre (5 min avant de partir) : les étapes rafraîchissent aussi les autres propositions ; avant : la montrée seule', async () => {
    for (const [now, all] of [
      [at(7, 31), true],
      [at(7, 20), false],
    ] as const) {
      const seen: string[] = [];
      const b = await setupController({ now, wrap: spying(seen) });
      await b.until((s) => s.screen === 'home' && s.lines.some((l) => l.startsWith('Bureau')));
      await b.gesture('tap');
      await b.until(stepsReady);
      seen.length = 0;
      await b.c.refreshCurrent();
      const ids = new Set(seen);
      if (all) expect(ids.size).toBeGreaterThan(1);
      else expect(ids.size).toBe(1);
      b.c.stop();
    }
  });
});

describe('PRD-1.2.5 § 3 : réglage « Pluie pendant la marche »', () => {
  it('allumé par défaut ; « false » gardé ; une valeur illisible : allumé', () => {
    expect(defaults().display.rain).toBe(true);
    expect(validateSettings({ ...defaults(), display: { ...defaults().display, rain: false } }).display.rain).toBe(false);
    expect(validateSettings({ ...defaults(), display: { ...defaults().display, rain: 'oui' as unknown as boolean } }).display.rain).toBe(true);
    const { rain: _rain, ...old } = defaults().display;
    expect(validateSettings({ ...defaults(), display: old as never }).display.rain).toBe(true);
  });
});
