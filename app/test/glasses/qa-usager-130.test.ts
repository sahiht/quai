/**
 * Quai 1.3.0, contrôle usager (docs/v1.3.0/PRD-1.3.0.md) : ce que la personne voit, par les vraies vues et la vraie mise
 * en page, pour les remarques corrigées pendant le contrôle.
 *  - § 6.3 sur Quai Web : la position y est souvent choisie à la main (le guidage ne la suit pas) et il n'y a pas
 *    d'appli Even : « Pas de position : Quai suit l’horaire » (1.3.1, L3) seul, jamais le conseil de l'appli Even ; sur les lunettes,
 *    le conseil reste (texte du PRD).
 *  - § 9 : la 3e ligne du message « Quai 1.3.0 » dit quels messages sont rappelés (ceux qui ne sont pas vus).
 * Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { Journey } from '../../src/core/api';
import type { CheckIssue, GuideState, Moment, WhereAmI } from '../../src/core/guide-types';
import { GUIDE_TEXT, guideView } from '../../src/glasses/guide-views';
import { newsLines, newsView, type ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, at, container, journey, lines, nb, overflowing, page, rowsOf, settingsWith } from './helpers';

const DAY = '2026-11-15';
const NOW = at(DAY, 7, 31);
const T = (hh: number, mm: number) => at(DAY, hh, mm);
const ctx = (patch: Partial<ViewCtx> = {}): ViewCtx => ({ now: NOW, settings: settingsWith([PLACES.bureau]), ...patch });

/** Marche jusqu'à la gare de Namur, IC jusqu'à Bruxelles-Central, marche. */
const J: Journey = journey('jq', [
  { walk: 9, to: 'Namur' },
  { ride: 'IC', mode: 'train', dep: T(7, 42), arr: T(8, 42), from: 'Namur', to: 'Bruxelles-Central', platform: '6' },
  { walk: 9 },
]);
const WHERE: WhereAmI = { title: 'Place Fontainas', arr: T(8, 51), rt: true, chain: [{ label: 'à pied', state: 'now' }], walk: { toKind: 'station', toward: { fr: 'Namur', nl: 'Namen' }, remainingMin: 9 } } as unknown as WhereAmI;
const state = (moment: Moment): GuideState => ({ kind: 'trip', journeyId: 'jq', phase: { kind: 'walk', leg: 0 }, moment, where: WHERE, location: 'high', wakeAt: NOW + MIN, ended: false });
const check = (issues: CheckIssue[]): Moment => ({ since: NOW, until: NOW + 20_000, leg: 0, id: 'check:noPosition', kind: 'check', issues });

function shown(m: Moment, c: ViewCtx): { lines: string[]; pale: string[] } {
  const p = page(guideView(state(m), 'moment', J, c));
  expect(overflowing(p)).toEqual([]);
  return { lines: p.lines.map(nb), pale: rowsOf(container(p, 'colC')).filter((l) => l.trim()) };
}

describe('contrôle usager 1.3.0 : vérification au départ sur Quai Web (PRD-1.3.0 § 6.3)', () => {
  it('lunettes : « Pas de position : Quai suit l’horaire » et, pâle, le conseil de l’appli Even (texte du PRD)', () => {
    const s = shown(check([{ kind: 'noPosition' }]), ctx());
    expect(s.lines).toEqual(['Pas de position : Quai suit l’horaire', 'Position « Toujours » pour l’appli Even, sur le téléphone', 'toucher : masquer   appui long : arrêter']);
    expect(s.pale).toEqual([nb(GUIDE_TEXT.checkNoPosition)]);
  });

  it('Quai Web (position choisie à la main, pas d’appli Even) : la ligne seule, jamais « appli Even »', () => {
    const s = shown(check([{ kind: 'noPosition' }]), ctx({ web: true }));
    expect(s.lines).toEqual(['Pas de position : Quai suit l’horaire', 'toucher : masquer   appui long : arrêter']);
    expect(s.lines.join('\n')).not.toMatch(/appli Even/);
    // les autres problèmes gardent leur explication, qui vaut aussi sur Quai Web
    const lost = shown(check([{ kind: 'noPosition' }, { kind: 'positionLost', minutes: 3 }]), ctx({ web: true }));
    expect(lost.lines).toEqual(['Pas de position : Quai suit l’horaire', 'Position perdue depuis 3 min', 'Quai suit l’horaire en attendant', 'toucher : masquer   appui long : arrêter']);
  });
});

describe('contrôle usager 1.3.0 : message « Quai 1.3.0 » des lunettes (PRD-1.3.0 § 9)', () => {
  it('la 3e ligne dit quels messages sont rappelés : un message pas vu ; au pixel, avec ses insécables', () => {
    const l = lines(newsView(ctx(), newsLines('1.2.10')));
    expect(l[2]).toBe('Test de l’écran sur le téléphone ; message pas vu rappelé.');
    expect(newsLines('1.2.10')[2]).toMatch(/téléphone ; message pas vu rappelé\.$/);
    // Quai Web : ni test de l'écran ni rappel, sa 3e ligne ne change pas
    expect(newsLines('1.2.10', true)[2]).not.toMatch(/rappel/);
  });
});
