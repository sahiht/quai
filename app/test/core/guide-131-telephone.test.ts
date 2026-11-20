/**
 * 1.3.1 (pôle Guidage) : carte « En cours » du téléphone (texte écrit par core/guide.ts) : « Maintenant : à pied vers
 * l’arrêt Flagey » (PRD-1.3.1 § 4, U3), « Ensuite : partir à 07:05 » avant le départ (L5, GuideStatus.then), noms avec
 * l'apostrophe typographique (§ 7). Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { GuideState } from '../../src/core/guide-types';
import { guideNowText, guideStatusOf } from '../../src/core/guide';
import { guideNowLine } from '../../src/phone/text';
import { at, journeyOf, N, prdTrip, rideLeg, S, stop, P, walkLeg } from './guide-fixtures';

const NB = ' ';

describe('1.3.1 : carte « En cours » du téléphone', () => {
  const j = prdTrip();
  const st = (phase: GuideState['phase']): GuideState => ({ kind: 'trip', journeyId: j.id, phase, moment: null, where: { title: 'Bureau', arr: j.arr, rt: true, chain: [] }, location: 'off', wakeAt: 0, ended: false });

  it('à pied vers un arrêt : son nom (« à pied vers l’arrêt Monument Gramme »), plus « l’arrêt du bus 6 » ; train : inchangé', () => {
    expect(guideNowText(st({ kind: 'walk', leg: 0 }), j, 'fr')).toBe('à pied vers l’arrêt Monument Gramme');
    expect(guideNowText(st({ kind: 'walk', leg: 4 }), j, 'fr')).toBe('à pied vers l’arrêt Gare Centrale');
    expect(guideNowText(st({ kind: 'walk', leg: 2 }), j, 'fr')).toBe('à pied vers la voie 3');
    expect(guideNowLine(guideStatusOf(st({ kind: 'walk', leg: 0 }), j, 'Bureau', true, 'fr'))).toBe(`Maintenant${NB}: à pied vers l’arrêt Monument Gramme`);
  });

  it('un arrêt sans nom (données incomplètes) : le véhicule, comme avant ; un nom avec apostrophe : « ’ »', () => {
    const bus = (from: ReturnType<typeof stop>) => rideLeg({ op: 'tec', mode: 'bus', line: '6', head: "Braine-l'Alleud", stops: [{ p: from, t: at('07:12') }, { p: S.leman, t: at('07:16') }] });
    const noName = journeyOf([walkLeg(S.avroy, stop('', P.gramme), at('07:05'), 5), bus(stop('', P.gramme))], 'jn', at('07:05'));
    expect(guideNowText(st({ kind: 'walk', leg: 0 }), noName, 'fr')).toBe('à pied vers l’arrêt du bus 6');
    const quote = journeyOf([walkLeg(S.avroy, stop("Braine-l'Alleud, Gare", P.gramme), at('07:05'), 5), bus(stop("Braine-l'Alleud, Gare", P.gramme))], 'jq', at('07:05'));
    expect(guideNowText(st({ kind: 'walk', leg: 0 }), quote, 'fr')).toBe('à pied vers l’arrêt Braine-l’Alleud, Gare');
    expect(guideNowText(st({ kind: 'wait', leg: 1 }), quote, 'fr')).toBe('bus 6 vers Braine-l’Alleud');
    expect(N('x')).toEqual({ fr: 'x', nl: 'x' });
  });

  it('avant le départ : « Ensuite : partir à 07:05 » (then) ; ensuite : « Maintenant : … » (pas de then)', () => {
    const before = guideStatusOf(st({ kind: 'before', leg: 0 }), j, 'Bureau', true, 'fr');
    expect(before).toEqual({ kind: 'trip', title: 'Bureau', arr: at('08:54'), now: 'partir à 07:05', guided: true, then: true });
    expect(guideNowLine(before)).toBe(`Ensuite${NB}: partir à 07:05`);
    const walk = guideStatusOf(st({ kind: 'walk', leg: 0 }), j, 'Bureau', true, 'fr');
    expect(walk.then).toBeUndefined();
    const ride = guideStatusOf(st({ kind: 'ride', leg: 1, next: 1 }), j, 'Bureau', false, 'fr');
    expect(ride.then).toBeUndefined();
    expect(guideNowLine(ride)).toBe(`Maintenant${NB}: bus 6 vers Gare des Guillemins`);
    // rien à dire : pas de ligne, même avant le départ
    expect(guideNowLine({ now: '', then: true })).toBe('');
  });
});
