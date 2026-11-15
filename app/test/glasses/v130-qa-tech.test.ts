/**
 * Quai 1.3.0, contrôle technique indépendant (docs/v1.3.0/PRD-1.3.0.md § 6.1, § 6.2, § 14) : cycle de vie du test de
 * l'écran et du rappel des messages quand Quai passe en arrière-plan ou que les lunettes se déconnectent. Chaque test
 * échoue sans la correction qu'il accompagne. Lieux publics seulement.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DisplayTestState, Favorite, FavoriteAnswer, Settings } from '../../src/core/api';
import { TEST_SENT_MS, TEST_WAIT_MS, type ControllerDeps } from '../../src/glasses/controller';
import { MIN, PLACES, nb, settingsWith } from './helpers';
import { cleanupKit, door, guideSetup, type KitOptions } from './controller-guide-kit';

afterEach(cleanupKit);

/** Banc du guidage, plus le capteur de mouvement et l'état du test de l'écran. */
async function kit(o: KitOptions) {
  const k = await guideSetup(o);
  const port = (k.c as unknown as { d: ControllerDeps }).d.platform.glasses;
  const imuCalls: [boolean, number | undefined][] = [];
  port.imu = async (on, pace) => {
    imuCalls.push([on, pace]);
    return true;
  };
  const states: DisplayTestState[] = [];
  k.c.onDisplayTest?.((s) => states.push(s));
  return { ...k, imuCalls, states };
}

const settings = (): Settings => settingsWith([PLACES.bureau], { seenVersion: '1.3.0' });

describe('test de l’écran : Quai quitté ou lunettes déconnectées pendant le test', () => {
  it('arrière-plan pendant l’attente ou la page envoyée : test arrêté, rien n’est envoyé aux lunettes avant le retour', async () => {
    for (const at of [1_000, TEST_WAIT_MS + 1_000]) {
      const k = await kit({ settings: settings() });
      await k.until((s) => s.screen === 'home');
      await k.c.displayTest({ kind: 'start' });
      await k.settle(at);
      expect(k.states.at(-1)?.step).toBe(at < TEST_WAIT_MS ? 'wait' : 'sent');
      const from = k.calls.length;
      await k.emit({ kind: 'background' });
      expect(k.states.at(-1)).toEqual({ step: 'idle', error: 'closed' });
      expect(k.imuCalls.at(-1)).toEqual([false, undefined]);
      // Quai n'est plus affiché dans les lunettes : aucune page ne part (en 1.2.10, jamais d'envoi en arrière-plan)
      await k.settle(TEST_SENT_MS);
      expect(k.since(from)).toEqual([]);
      // au retour : l'écran d'avant, page entière
      await k.emit({ kind: 'foreground' });
      expect(k.since(from).map((c) => c.op)[0]).toBe('rebuild');
      expect(k.last().screen).toBe('home');
    }
  });

  it('lunettes déconnectées pendant l’attente : test arrêté, rien n’est envoyé à des lunettes absentes ; reconnectées : l’écran d’avant', async () => {
    const k = await kit({ settings: settings() });
    await k.until((s) => s.screen === 'home');
    await k.emit({ kind: 'device', connected: true, wearing: true });
    await k.c.displayTest({ kind: 'start' });
    await k.settle(2_000);
    const from = k.calls.length;
    await k.emit({ kind: 'device', connected: false });
    expect(k.states.at(-1)).toEqual({ step: 'idle', error: 'closed' });
    await k.settle(5_000);
    expect(k.since(from)).toEqual([]);
    await k.emit({ kind: 'device', connected: true, wearing: true });
    expect(k.since(from).map((c) => c.op)[0]).toBe('rebuild');
    expect(k.last().screen).toBe('home');
  });

  it('question en cours, Quai en arrière-plan, lunettes déconnectées puis reconnectées : le capteur ne rouvre qu’au premier plan', async () => {
    const k = await kit({ settings: settings() });
    await k.until((s) => s.screen === 'home');
    await k.emit({ kind: 'device', connected: true, wearing: true });
    await k.c.displayTest({ kind: 'start' });
    await k.settle(TEST_WAIT_MS + TEST_SENT_MS + 10);
    expect(k.states.at(-1)).toEqual({ step: 'ask' });
    await k.emit({ kind: 'background' });
    expect(k.imuCalls.at(-1)).toEqual([false, undefined]);
    const n = k.imuCalls.length;
    await k.emit({ kind: 'device', connected: false });
    await k.emit({ kind: 'device', connected: true, wearing: true });
    // toujours en arrière-plan : le capteur reste fermé (une fermeture de plus est sans frais)
    expect(k.imuCalls.slice(n).filter(([on]) => on)).toEqual([]);
    await k.emit({ kind: 'foreground' });
    expect(k.imuCalls.slice(n).filter(([on]) => on)).toEqual([[true, 100]]);
    expect(k.states.at(-1)).toEqual({ step: 'ask' });
    expect(k.last().screen).toBe('displayTest');
    await k.c.displayTest({ kind: 'cancel' });
    expect(k.imuCalls.at(-1)).toEqual([false, undefined]);
  });
});

describe('favoris : un calcul qui ne répond jamais ne bloque pas les autres (PRD-1.3.0 § 8, § 14)', () => {
  it('trois calculs restés sans réponse : leur place est rendue au bout de 60 s, le quatrième favori reçoit sa réponse, les trois sont refaits', async () => {
    const hung = new Set(['fav-bureau', 'fav-ecole', 'fav-parc']);
    const calls: string[] = [];
    const lineOf = (lines: string[], name: string) => nb(lines.find((l) => nb(l).startsWith(`${name}   `)) ?? '');
    const k = await kit({
      settings: settingsWith([PLACES.bureau, PLACES.ecole, PLACES.parc, PLACES.maison], { seenVersion: '1.3.0' }),
      pos: { lat: 50.8454, lon: 4.3571 },
      coreExtra: (now) => ({
        answer: (fav: Favorite): Promise<FavoriteAnswer> => {
          calls.push(fav.id);
          // premier calcul de trois favoris : le cœur ne répond jamais (promesse pendante)
          if (hung.delete(fav.id)) return new Promise<FavoriteAnswer>(() => undefined);
          return Promise.resolve({ favoriteId: fav.id, kind: 'trip', state: 'ok', plan: { journeys: [door(`j-${fav.id}`, now() + 6 * MIN, now() + 50 * MIN)] }, updatedAt: now() });
        },
      }),
    });
    await k.until((s) => s.screen === 'home');
    await k.c.replaceRoute({ screen: 'favorites' });
    await k.settle(1_000);
    // les trois places sont prises par les calculs sans réponse : « Maison » attend
    expect(calls.slice(0, 3).sort()).toEqual(['fav-bureau', 'fav-ecole', 'fav-parc']);
    expect(lineOf(k.last().lines, 'Maison')).toBe('Maison   …');
    // 60 s : les places sont rendues ; « Maison » est calculé, les trois autres refaits (leur réponse arrive)
    await k.settle(61_000);
    for (const name of ['Maison', 'Bureau', 'École', 'Parc']) expect(lineOf(k.last().lines, name), name).toMatch(new RegExp(`^${name}   dans \\d+ min → `));
    expect(calls.filter((id) => id === 'fav-maison').length).toBeGreaterThanOrEqual(1);
  });
});
