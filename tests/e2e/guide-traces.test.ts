/**
 * 1.2.10 « Y aller » : contrôle des traces de positions (tests/e2e/traces/) et de l'oracle des textes du guidage
 * (sim/guide-oracle.ts) utilisés par les scénarios s1210 du simulateur. Rapide, sans serveur.
 */
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { bearing, distM } from './traces/geo';
import { LIEGE_FLAGEY, NAMUR_FONTAINAS, NAMUR_IMPRECISE, NAMUR_MISSED, NAMUR_PASSED, RIDE_CENTRAL, TRACES } from './traces/traces';
import * as O from './sim/guide-oracle';
import { canvasToShot, checkGuidePixels, litCount } from './sim/guide-pixels';

const all = Object.values(TRACES);

describe('traces 1.2.10 : réalistes', () => {
  it('instants croissants, vitesse et cap cohérents avec les positions', () => {
    for (const t of all) {
      expect(t.points.length, t.id).toBeGreaterThan(20);
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        expect(b.at, `${t.id} n° ${i}`).toBeGreaterThan(a.at);
        const v = distM(a, b) / ((b.at - a.at) / 1000);
        // jamais plus vite qu'un IC (45 m/s), à pied jamais plus de 2 m/s
        expect(v, `${t.id} n° ${i} (${b.phase})`).toBeLessThan(b.phase === 'walk' && a.phase === 'walk' ? 2 : 45);
        if (b.speed > 0.5 && b.heading !== undefined && distM(a, b) > 5) {
          const d = Math.abs(((bearing(a, b) - b.heading + 540) % 360) - 180);
          expect(d, `${t.id} n° ${i} : cap ${b.heading} pour un déplacement au ${Math.round(bearing(a, b))}`).toBeLessThan(25);
        }
        expect(b.accuracy).toBeGreaterThan(0);
      }
    }
  });

  it('marche à 1,3 m/s, à bord jusqu’à l’arrêt suivant à l’heure, arrêts sans cap', () => {
    const walkPts = NAMUR_FONTAINAS.points.filter((p) => p.phase === 'walk' && p.speed > 0);
    expect(walkPts.every((p) => p.speed === 1.3)).toBe(true);
    const stopped = NAMUR_FONTAINAS.points.filter((p) => p.speed === 0);
    expect(stopped.every((p) => p.heading === undefined)).toBe(true);
    const gembloux = NAMUR_FONTAINAS.points.find((p) => p.mark === 'Gembloux')!;
    expect(new Date(gembloux.at).toISOString()).toBe('2026-11-10T06:57:00.000Z');
  });

  it('imprévus : raté (encore sur le quai après le départ), dépassé (au-delà de Bruxelles-Nord), imprécis (150 m)', () => {
    const nord = { lat: 50.8605, lon: 4.3612 };
    const late = NAMUR_MISSED.points.filter((p) => p.at >= Date.parse('2026-11-10T07:46:00+01:00'));
    expect(late.length).toBeGreaterThan(5);
    expect(late.every((p) => p.speed === 0 && distM(p, { lat: 50.4687, lon: 4.8622 }) < 5)).toBe(true);
    const after = NAMUR_PASSED.points.find((p) => p.at === Date.parse('2026-11-10T08:45:30+01:00'))!;
    expect(distM(after, nord)).toBeGreaterThan(300);
    expect(NAMUR_IMPRECISE.points.every((p) => p.accuracy > 75)).toBe(true);
    expect(RIDE_CENTRAL.points[0].phase).toBe('wait');
  });

  it('confidentialité : lieux publics seulement, jamais une adresse personnelle (PRD § 8)', () => {
    for (const t of all) {
      expect(t.places.length, t.id).toBeGreaterThan(1);
      for (const p of t.places) expect(p, t.id).toMatch(/^(Place|Gare|Bruxelles|Bourse|Parc|Monument|Ans|Louvain|Flagey|Étangs|Gare Centrale)/);
      // aucune adresse (numéro de rue) dans les traces : des places, des gares et des arrêts seulement
      expect(JSON.stringify(t.places)).not.toMatch(/\d+,? (rue|avenue|chemin|chaussée|boulevard)|(rue|avenue|chemin|chaussée|boulevard) [^"]* \d+/i);
    }
    // jamais la position « Maison » des fixtures (50.4655, 4.8590) : aucun point à moins de 150 m
    for (const t of all) expect(t.points.every((p) => distM(p, { lat: 50.4655, lon: 4.859 }) > 150), t.id).toBe(true);
  });

  it('l’exemple du PRD aux heures du PRD : bus 6 à 07:12, Guillemins à 07:20, IC à 07:30, bus 71 à 08:34, arrivée vers 08:54', () => {
    const at = (m: string) => new Date(LIEGE_FLAGEY.points.find((p) => p.mark === m)!.at + 3_600_000).toISOString().slice(11, 16);
    expect(at('Monument Gramme')).toBe('07:12');
    expect(at('Gare des Guillemins')).toBe('07:20');
    expect(at('Liège-Guillemins')).toBe('07:30');
    expect(at('Gare Centrale')).toBe('08:34');
    const end = LIEGE_FLAGEY.points.at(-1)!;
    expect(new Date(end.at + 3_600_000).toISOString().slice(11, 16)).toBe('08:54');
  });
});

/** Trajet type (forme de FollowedTrip.journey) : marche, IC voie 6 au lieu de 4, marche, tram 3, marche. */
const t = (hm: string) => Date.parse(`2026-11-10T${hm}:00+01:00`);
const N = (fr: string) => ({ fr });
const J: O.OJourney = {
  id: 'j1',
  dep: t('07:33'),
  arr: t('08:58'),
  leaveAt: t('07:33'),
  rt: false,
  legs: [
    { kind: 'walk', from: { name: N('Place de l’Ange'), lat: 0, lon: 0 }, to: { name: N('Namur'), lat: 0, lon: 0 }, dep: t('07:33'), arr: t('07:42'), schedDep: t('07:33'), schedArr: t('07:42'), walkMin: 9 },
    {
      kind: 'ride', from: { name: N('Namur'), lat: 0, lon: 0 }, to: { name: N('Bruxelles-Nord'), lat: 0, lon: 0 }, dep: t('07:44'), arr: t('08:42'), schedDep: t('07:42'), schedArr: t('08:40'),
      op: 'sncb', mode: 'train', cat: 'IC', head: N('Bruxelles-Midi'), platform: '4', newPlatform: '6', rt: true,
      stops: ['Namur', 'Gembloux', 'Ottignies', 'Bruxelles-Luxembourg', 'Bruxelles-Schuman', 'Bruxelles-Nord'].map((n, i) => ({ name: N(n), sched: t('07:42') + i * 600_000, est: t('07:44') + i * 600_000 })),
    },
    { kind: 'walk', from: { name: N('Bruxelles-Nord'), lat: 0, lon: 0 }, to: { name: N('Gare du Nord'), lat: 0, lon: 0 }, dep: t('08:42'), arr: t('08:44'), schedDep: t('08:42'), schedArr: t('08:44'), walkMin: 2 },
    {
      kind: 'ride', from: { name: N('Gare du Nord'), lat: 0, lon: 0 }, to: { name: N('Bourse'), lat: 0, lon: 0 }, dep: t('08:44'), arr: t('08:49'), schedDep: t('08:44'), schedArr: t('08:49'),
      op: 'stib', mode: 'tram', line: '3', head: N('Churchill'), rt: false,
      stops: ['Gare du Nord', 'Rogier', 'De Brouckère', 'Bourse'].map((n) => ({ name: N(n), sched: t('08:44'), est: t('08:44') })),
    },
    { kind: 'walk', from: { name: N('Bourse'), lat: 0, lon: 0 }, to: { name: N('Place Fontainas'), lat: 0, lon: 0 }, dep: t('08:49'), arr: t('08:58'), schedDep: t('08:49'), schedArr: t('08:58'), walkMin: 9 },
  ],
};

describe('oracle des textes du guidage (PRD § 3.2, § 3.3)', () => {
  it('moments : partir, voie modifiée, monter, prochain arrêt, descente, tu y es', () => {
    const leave = O.leaveLines(J, 'Place Fontainas', t('07:30'));
    expect(leave.slice(0, 2)).toEqual(['Partir maintenant', '9 min à pied jusqu’à la gare de Namur']);
    expect(O.matches('IC à 07:44, très juste', leave[2])).toBe(false);
    expect(leave[2]).toBe('IC à 07:44');
    expect(O.platformLines(J.legs[1])).toEqual(['Voie modifiée', 'IC à 07:44, voie 6 au lieu de 4']);
    const board = O.boardLines(J, 1, t('07:41'));
    expect(board.slice(0, 3)).toEqual(['IC à 07:44, voie 6 !', 'vers Bruxelles-Midi', 'descente dans 5 arrêts']);
    expect(O.boardSign(J.legs[1])).toEqual({ label: 'voie', value: '6' });
    expect(O.boardSign(J.legs[3])).toEqual({ label: 'tram', value: '3' });
    expect(O.nextStopLines(J.legs[1], 1)).toEqual(['Prochain arrêt : Gembloux', 'descente dans 5 arrêts, à Bruxelles-Nord']);
    expect(O.alightLines(J, 1)).toEqual(['Descends au prochain arrêt', 'Bruxelles-Nord, 08:42', 'ensuite : tram 3 à ~08:44']);
    expect(O.alightLines(J, 3)).toEqual(['Descends au prochain arrêt', 'Bourse, ~08:49', 'ensuite : 9 min à pied']);
    expect(O.arrivedLines('Place Fontainas', t('08:58'), t('08:58'))).toEqual(['Tu y es', 'Place Fontainas, 08:58, à l’heure']);
    expect(O.arrivedLines('Place Fontainas', t('09:01'), t('08:58'))[1]).toBe('Place Fontainas, 09:01, 3 min de retard');
    expect(O.passedLines('Bruxelles-Nord', 'Bruxelles-Central', t('08:48'), true, t('09:01'))).toEqual(['Tu as passé Bruxelles-Nord', 'Descends à Bruxelles-Central, 08:48', 'nouveau trajet : arrivée 09:01']);
  });

  it('« Où tu en es » : chaîne, à pied, à la gare', () => {
    expect(O.chainLine(J, 1)).toBe('● à pied ─ ◎ IC ─ ○ tram 3');
    const w = O.whereWalkLines(J, 0, 'Place Fontainas', 0);
    expect(O.matches('À pied vers la voie 6', w[1]) && O.matches('À pied vers la gare de Namur', w[1])).toBe(true);
    expect(O.matches('IC à 07:44, marge 2 min', w[3])).toBe(true);
    expect(w[4]).toBe('arrivée ~08:58');
    const g = O.whereWaitLines(J, 1, 1);
    expect(g[1]).toBe('À la gare de Namur');
    expect(O.matches('IC dans 3 min, vers Bruxelles-Midi', g[2])).toBe(true);
    expect(O.matches('voie 6 !', g[3]) && O.matches('voie 6', g[3])).toBe(true);
  });

  it('typographie : ni tiret long ni moyen, ni guillemet droit, ni conseil', () => {
    expect(O.typographyIssues(['Partir maintenant', 'IC à 07:44'])).toEqual([]);
    expect(O.typographyIssues(['Partir — vite', 'presse le pas'])).toHaveLength(2);
    expect(O.matches('j\'y descends', 'j’y descends')).toBe(true);
  });
});

describe('contrôle au pixel du guidage', () => {
  it('écran calme : une capture sans pixel allumé passe, la conversion du canvas garde le vert dans l’alpha', () => {
    const black = new PNG({ width: 576, height: 288 });
    for (let i = 0; i < black.data.length; i += 4) black.data[i + 3] = 255; // noir opaque du canvas
    const shot = canvasToShot(PNG.sync.write(black));
    expect(litCount(shot)).toBe(0);
    // un pixel vert hors de toute ligne journalisée : signalé
    const one = new PNG({ width: 576, height: 288 });
    one.data[(200 * 576 + 300) * 4 + 1] = 255;
    one.data[(200 * 576 + 300) * 4 + 3] = 255;
    const bad = checkGuidePixels(canvasToShot(PNG.sync.write(one)), { screen: 'guide', title: '', lines: [] }, { image: false });
    expect(bad.join(' ')).toMatch(/hors des lignes/);
    // une image attendue mais absente : signalée
    expect(checkGuidePixels(shot, { screen: 'guide', title: '', lines: [] }, { image: true }).join(' ')).toMatch(/image attendue/);
  });
});
