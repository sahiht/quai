/**
 * 1.2.10 (PRD-1.2.10 § 9.2) : invariants du moteur du guidage sur 300 trajets tirés au hasard (graine fixe, donc
 * reproductible) : retards, temps réel absent, voie modifiée, supprimé, arrêts sans position, positions bruitées,
 * imprécises, absentes ou en retard sur l'horaire, touchers qui effacent, mémoire relue en JSON (redémarrage).
 * Contrôle technique : ce que les scénarios écrits à la main ne couvrent pas une à une.
 */
import { describe, expect, it } from 'vitest';
import { dismissMoment, guideStep } from '../../src/core/guide';
import type { GuideFix, GuideMemory } from '../../src/core/guide-types';
import { at, fix, guide, lerp, MIN, offset, P, prdTrip, SEC, settings, step, type TripOpts } from './guide-fixtures';

/** Générateur pseudo-aléatoire (congruentiel linéaire), graine fixe. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Lieux du trajet du PRD et heures de passage prévues (la personne suit le trajet, avec un retard éventuel). */
const PATH = [P.avroy, P.gramme, P.leman, P.guilleminsBus, P.guillemins, P.ans, P.louvain, P.nord, P.central, P.gareCentrale, P.porteNamur, P.flagey, P.etangs];
const TIMES = ['07:00', '07:10', '07:16', '07:20', '07:25', '07:37', '08:05', '08:22', '08:27', '08:33', '08:39', '08:48', '08:54'].map((x) => at(x));

function positionAt(t: number) {
  if (t <= TIMES[0]) return PATH[0];
  for (let i = 1; i < TIMES.length; i++) if (t <= TIMES[i]) return lerp(PATH[i - 1], PATH[i], (t - TIMES[i - 1]) / (TIMES[i] - TIMES[i - 1]));
  return PATH[PATH.length - 1];
}

describe('moteur du guidage : invariants sur 300 trajets tirés au hasard', () => {
  it('jamais d’erreur ; réveil dans les 60 s ; un moment effacé ne revient pas ; réglage éteint : rien ; fin toujours, position coupée ; relecture JSON identique', () => {
    const rnd = prng(20261115);
    const problems: string[] = [];
    for (let run = 0; run < 300; run++) {
      const opts: TripOpts = {
        bus6Delay: rnd() < 0.3 ? Math.floor(rnd() * 12) : 0,
        bus6Rt: rnd() < 0.8,
        icDelay: rnd() < 0.3 ? Math.floor(rnd() * 20) : 0,
        icNewPlatform: rnd() < 0.2 ? '6' : undefined,
        icCancelled: rnd() < 0.1,
        bus71Delay: rnd() < 0.3 ? Math.floor(rnd() * 10) : 0,
        noStopPoints: rnd() < 0.2,
      };
      const guided = rnd() < 0.85;
      const r = guide(prdTrip(opts), { settings: settings(guided) });
      const lag = rnd() < 0.3 ? rnd() * 10 * MIN : 0;
      const noFix = rnd() < 0.2;
      let t = at('06:50') + Math.floor(rnd() * 20) * MIN;
      const dismissed = new Set<string>();
      let ended = false;
      const say = (m: string) => problems.push(`trajet ${run} (${JSON.stringify(opts)}, guidé ${guided}, retard ${Math.round(lag / MIN)} min, sans position ${noFix}) : ${m}`);
      for (let k = 0; k < 2000 && !ended && t < at('10:30'); k++) {
        t += Math.floor((rnd() < 0.5 ? 2 : 30) * SEC * (0.5 + rnd()));
        let f: GuideFix | undefined;
        if (!noFix && rnd() < 0.9) {
          const q = offset(positionAt(t - lag), (rnd() - 0.5) * 40, (rnd() - 0.5) * 40);
          f = fix(q, t - Math.floor(rnd() * 3 * SEC), { accuracy: rnd() < 0.1 ? 150 : 5 + rnd() * 20, ...(rnd() < 0.5 ? {} : { speed: rnd() * 15 }) });
        }
        // redémarrage (page rechargée) : la mémoire relue depuis son JSON
        if (rnd() < 0.02) r.mem = JSON.parse(JSON.stringify(r.mem)) as GuideMemory;
        let s;
        try {
          s = step(r, t, f);
        } catch (e) {
          say(`erreur ${(e as Error).message}`);
          break;
        }
        if (!(s.wakeAt > t) || s.wakeAt > t + 60 * SEC) say(`réveil dans ${(s.wakeAt - t) / SEC} s`);
        if (s.moment) {
          if (dismissed.has(s.moment.id)) say(`moment effacé revenu : ${s.moment.id}`);
          if (!guided) say(`moment sans guidage : ${s.moment.id}`);
          if (s.moment.since > t) say(`moment commencé dans le futur : ${s.moment.id}`);
          if (rnd() < 0.1) {
            dismissed.add(s.moment.id);
            r.mem = dismissMoment(r.mem, s.moment.id, t);
          }
        }
        if (!guided && (s.location === 'high' || s.replan || s.needRoute)) say(`réglage éteint : position ${s.location}, recalcul ${!!s.replan}, chemin ${!!s.needRoute}`);
        if (s.ended) {
          ended = true;
          if (s.location !== 'off') say(`fini avec la position ${s.location}`);
        }
        if (rnd() < 0.01) {
          const input = { ...(r.input as object), journey: r.j, now: t, fixes: [...r.fixes] } as Parameters<typeof guideStep>[0];
          const a = guideStep(input, r.mem);
          const b = guideStep(input, JSON.parse(JSON.stringify(r.mem)) as GuideMemory);
          if (JSON.stringify(a.state) !== JSON.stringify(b.state) || JSON.stringify(a.mem) !== JSON.stringify(b.mem)) say('relecture JSON différente');
        }
      }
      if (!ended) say('jamais fini');
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});
