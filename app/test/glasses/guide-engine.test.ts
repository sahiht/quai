/**
 * Quai 1.2.10 : les écrans du guidage sur de vrais états du moteur (core/guide.ts, équipe A) : le trajet du PRD
 * (à pied, bus 6, IC, bus 71, à pied), minute par minute à l'heure seule, puis la première marche avec des positions et
 * son chemin (virages), un retard qui casse la correspondance, et la descente. Chaque page : rien ne dépasse, aucun
 * texte vide ou technique (« undefined », « NaN »), jamais « dans 0 arrêts » ni « marge -2 min », jamais de tiret long.
 * Lieux publics seulement.
 */
import { describe, expect, it } from 'vitest';
import type { GuideState } from '../../src/core/guide-types';
import { guideView, type GuideShow } from '../../src/glasses/guide-views';
import type { ViewCtx } from '../../src/glasses/views';
import { MIN, P, at as atHm, firstWalkRoute, fix, guide, prdTrip, step, toward } from '../core/guide-fixtures';
import { nb, overflowing, page, settingsWith } from './helpers';

const MAIN_FIRST: Record<string, RegExp> = {
  leave: /^Partir maintenant$/,
  // 1.3.1 (B12, L4) : « À gauche dans 30 m », « Tram 3 dans ~1 min »
  turn: /^(À |Légèrement|Franchement|Tout droit|Fais demi-tour)/,
  board: /^(Bus |Tram |Métro |IC |S\d|L |P )/,
  platform: /^Voie modifiée$/,
  nextStop: /^Prochain arrêt : /,
  alight: /^Descends au prochain arrêt$/,
  // 1.3.1 (A3, I1) : véhicule raté sans temps réel, resté à l'arrêt : le nouveau trajet d'abord
  replan: /^(Ton |Correspondance ratée : |Nouveau trajet : |Prochain : )/,
  passed: /^Tu as passé /,
  arrived: /^Tu y es$/,
  // 1.3.1 (B17, P7) : la marche après une descente
  walk: /^\d+ min à pied jusqu/,
};

/** Page d'un état : contrôlée, ses lignes (espaces insécables remises). */
function render(s: GuideState, show: GuideShow, j: Parameters<typeof guideView>[2], now: number): string[] {
  const ctx: ViewCtx = { now, settings: settingsWith([]) };
  const p = page(guideView(s, show, j, ctx));
  const bad = overflowing(p);
  if (bad.length) throw new Error(`${show} ${s.moment?.kind ?? ''} : ${bad.join('\n')}`);
  const lines = p.lines.map(nb);
  for (const l of [nb(p.title), ...lines]) {
    expect(l, l).not.toMatch(/undefined|NaN|null|\[object|dans 0 arrêt|marge -|[–—]/);
    expect(l.trim(), `${show} ${s.moment?.kind}`).not.toBe('');
  }
  return lines;
}

describe('écrans du guidage sur les états du moteur', () => {
  it('le trajet du PRD à l’heure seule : chaque moment et « Où tu en es » se lisent, l’action en tête', () => {
    const j = prdTrip();
    const r = guide(j);
    const seen = new Map<string, string[]>();
    for (let t = atHm('06:58'); t <= atHm('09:05'); t += MIN) {
      const s = step(r, t);
      const where = render(s, 'where', j, t);
      expect(where.at(-1)).toBe('toucher : masquer   appui long : arrêter');
      if (!s.moment) continue;
      const lines = render(s, 'moment', j, t);
      expect(lines[0], s.moment.kind).toMatch(MAIN_FIRST[s.moment.kind]);
      if (!seen.has(s.moment.kind)) seen.set(s.moment.kind, lines);
    }
    // à l'heure seule : partir, monter, prochain arrêt, descendre, arriver
    expect([...seen.keys()]).toEqual(expect.arrayContaining(['leave', 'board', 'alight', 'arrived']));
    expect(seen.get('leave')?.slice(0, 3)).toEqual(['Partir maintenant', '5 min à pied jusqu’à Monument Gramme', 'bus 6 à 07:12']);
    expect(seen.get('arrived')?.[0]).toBe('Tu y es');
  });

  it('la première marche avec positions et chemin : « à droite dans … m », la rue pâle ; puis le bus', () => {
    const j = prdTrip();
    const r = guide(j, { walk: { leg: 0, route: firstWalkRoute() } });
    const turns: string[][] = [];
    // départ du Parc d'Avroy à 07:05, 80 m par minute environ (marche de 5 min sur 800 m : un peu vite)
    const a = P.avroy;
    let t = atHm('07:05');
    for (let m = 0; m <= 260; m += 20) {
      const s = step(r, t, fix(toward(a, { lat: a.lat - 0.01, lon: a.lon }, m), t, { speed: 1.4, heading: 180 }));
      if (s.moment?.kind === 'turn') turns.push(render(s, 'moment', j, t));
      t += 15_000;
    }
    expect(turns.length).toBeGreaterThan(0);
    expect(turns[0][0]).toMatch(/^À droite (dans \d+ m|maintenant)$/);
    expect(turns[0][1]).toBe('Boulevard d’Avroy');
  });

  it('retard qui casse la correspondance, voie modifiée, train supprimé, et « j’y descends » : les pages se lisent', () => {
    const kinds = new Set<string>();
    for (const o of [{ bus6Delay: 9 }, { icNewPlatform: '6' }, { icCancelled: true }, { bus6Rt: false, icDelay: 4 }]) {
      const late = prdTrip(o);
      const r = guide(late);
      for (let t = atHm('07:00'); t <= atHm('08:00'); t += MIN) {
        const s = step(r, t);
        render(s, 'where', late, t);
        if (!s.moment) continue;
        const lines = render(s, 'moment', late, t);
        expect(lines[0], s.moment.kind).toMatch(MAIN_FIRST[s.moment.kind]);
        kinds.add(s.moment.kind);
      }
    }
    expect([...kinds]).toEqual(expect.arrayContaining(['platform', 'replan']));
    const j = prdTrip();
    const ride = guide(j, { kind: 'ride', title: 'Vers Bruxelles-Central' });
    for (let t = atHm('07:20'); t <= atHm('08:40'); t += 2 * MIN) {
      const s = step(ride, t);
      const lines = render(s, 'where', j, t);
      if (s.phase.kind === 'ride') expect(lines.join('\n')).not.toMatch(/^arrivée /m);
      if (s.moment) render(s, 'moment', j, t);
    }
  });
});
