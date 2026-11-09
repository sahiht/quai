/**
 * Test de charge (long) : lancé seulement avec QUAI_LOAD=1 (ou npm run load-test pour le rapport complet).
 */
import { describe, expect, it } from 'vitest';
import { runLoad } from './load/run-load.ts';

describe.runIf(process.env.QUAI_LOAD === '1')('test de charge', () => {
  it('au moins 1,5 million de lignes stop_times, mémoire maximale < 2,5 Go', async () => {
    const r = await runLoad(Number(process.env.QUAI_LOAD_COPIES ?? 400));
    console.log(`charge : ${r.feed.stopTimes} lignes, ${r.feed.activeStopTimes} actives, ${r.seconds.toFixed(1)} s, ${r.peakRssMB} Mo, ${r.outFiles} fichiers, ${r.outMB.toFixed(1)} Mo`);
    expect(r.exitCode).toBe(0);
    expect(r.feed.stopTimes).toBeGreaterThanOrEqual(1_500_000);
    expect(r.peakRssMB).toBeLessThan(2500);
  }, 600_000);
});
