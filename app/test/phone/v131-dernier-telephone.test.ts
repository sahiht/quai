// @vitest-environment happy-dom
/**
 * 1.3.1 (R3, PRD-1.3.1 § 15 ; contrôle usager final, remarque 2) : sur les cartes de la recherche du téléphone,
 * « dernier » (le mot des lunettes, plus « dernier passage ») avec la règle de l'écran du trajet des lunettes, par la
 * même fonction (core/boards.ts, tripLegLast) : pas de marque quand un autre trajet de la même liste part plus tard
 * avant demain ; un train avec une voie porte la marque comme les autres véhicules.
 * Lieux publics seulement (Flagey, Bruxelles-Nord, De Brouckère).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Journey, Leg } from '../../src/core/api';
import { tripLegLast } from '../../src/core/boards';
import { LAST_MARK } from '../../src/glasses/format';
import { stepsPage, type ViewCtx } from '../../src/glasses/views';
import { rideDetail, searchScreen } from '../../src/phone/screens/search';
import { PLACES, page, settingsWith } from '../glasses/helpers';
import { at, defaults, harness, mount, plain, textOf, until } from './helpers';
import { rideLeg, walkLeg } from './trips';

const min = (n: number): number => n * 60_000;
const DAY = 24 * 60 * min(1);
const journey = (id: string, legs: Leg[]): Journey => ({
  id, legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr, leaveAt: legs[0].dep, transfers: Math.max(0, legs.filter((l) => l.kind === 'ride').length - 1), rt: true, alerts: [],
});
/** Tram 81 de Flagey à `dep`, 12 min de trajet, 4 min de marche avant et après ; `last` : la marque du cœur. */
const tram = (id: string, dep: number, extra: Partial<Leg> = {}): Journey =>
  journey(id, [walkLeg(dep - min(4), 4), { ...rideLeg(dep, dep + min(12), 'tram 81', 'Flagey', 'Montgomery'), rt: true, ...extra }, walkLeg(dep + min(12), 4)]);
const ic = (id: string, dep: number, extra: Partial<Leg> = {}): Journey =>
  journey(id, [{ ...rideLeg(dep, dep + min(40), 'IC', 'Bruxelles-Nord', 'Namur'), rt: true, platform: '9', ...extra }]);
const T = at(23, 40);

afterEach(() => {
  document.body.replaceChildren();
});

describe('téléphone, carte de la recherche : « dernier », le mot et la règle des lunettes', () => {
  it('rien ne suit : « T81 à Flagey, à l’heure, dernier » (plus « dernier passage »)', () => {
    const j = tram('a', T, { last: true });
    expect(plain(rideDetail(j, 'fr', [j]))).toBe('T81 à Flagey, à l’heure, dernier');
    // la liste par défaut : le trajet seul
    expect(plain(rideDetail(j, 'fr'))).toBe('T81 à Flagey, à l’heure, dernier');
    expect(rideDetail(j, 'fr')).not.toContain('passage');
    // le mot est celui des lunettes, pas une copie
    expect(rideDetail(j, 'fr').endsWith(LAST_MARK)).toBe(true);
    // sans la marque du cœur : rien
    expect(plain(rideDetail(tram('b', T), 'fr'))).toBe('T81 à Flagey, à l’heure');
    // sans temps réel, en retard : la marque après l'état
    expect(plain(rideDetail(tram('c', T, { last: true, rt: false }), 'fr'))).toBe('T81 à Flagey, horaire prévu, sans temps réel, dernier');
    expect(plain(rideDetail(tram('d', T, { last: true, delayMin: 3 }), 'fr'))).toBe('T81 à Flagey, retard de 3 min annoncé, dernier');
  });

  it('un trajet plus tardif dans la même liste, avant demain : pas de marque (la personne peut encore le prendre)', () => {
    const j = tram('a', T, { last: true });
    // un bus d'un autre réseau 20 min plus tard, puis un autre après minuit (avant 04:00)
    const bus = journey('bus', [{ ...rideLeg(T + min(20), T + min(45), 'bus 71', 'Flagey', 'De Brouckère'), rt: true }]);
    const night = journey('nuit', [{ ...rideLeg(T + min(95), T + min(120), 'bus 71', 'Flagey', 'De Brouckère'), rt: true }]);
    expect(plain(rideDetail(j, 'fr', [j, bus]))).toBe('T81 à Flagey, à l’heure');
    expect(plain(rideDetail(j, 'fr', [j, night]))).toBe('T81 à Flagey, à l’heure');
    // le plus tardif garde sa propre marque
    const lastBus = journey('bus', [{ ...rideLeg(T + min(20), T + min(45), 'bus 71', 'Flagey', 'De Brouckère'), rt: true, last: true }]);
    expect(plain(rideDetail(lastBus, 'fr', [j, lastBus]))).toBe('71 à Flagey, à l’heure, dernier');
  });

  it('ce qui ne retire pas la marque : un trajet plus tôt, à la même minute, à pied, supprimé, seulement demain, ou le même trajet relu', () => {
    const j = tram('a', T, { last: true });
    const marked = 'T81 à Flagey, à l’heure, dernier';
    const other = (id: string, dep: number, extra: Partial<Leg> = {}) => journey(id, [{ ...rideLeg(dep, dep + min(25), 'bus 71', 'Flagey', 'De Brouckère'), rt: true, ...extra }]);
    expect(plain(rideDetail(j, 'fr', [other('tot', T - min(10)), j]))).toBe(marked);
    expect(plain(rideDetail(j, 'fr', [j, other('meme', T)]))).toBe(marked);
    expect(plain(rideDetail(j, 'fr', [j, journey('pied', [walkLeg(T + min(5), 50)])]))).toBe(marked);
    expect(plain(rideDetail(j, 'fr', [j, other('suppr', T + min(20), { cancelled: true })]))).toBe(marked);
    // demain : 04:00 ou après (le premier du matin)
    expect(plain(rideDetail(j, 'fr', [j, other('demain', at(4, 0) + DAY)]))).toBe(marked);
    expect(plain(rideDetail(j, 'fr', [j, other('nuit', at(3, 59) + DAY)]))).toBe('T81 à Flagey, à l’heure');
    expect(plain(rideDetail(j, 'fr', [j, { ...tram('a', T + min(30)) }]))).toBe(marked);
  });

  it('un train avec une voie porte la marque comme les autres : « Voie 9 à Bruxelles-Nord, à l’heure, dernier » ; jamais un véhicule supprimé', () => {
    const j = ic('ic', T, { last: true });
    expect(plain(rideDetail(j, 'fr', [j]))).toBe('Voie 9 à Bruxelles-Nord, à l’heure, dernier');
    expect(plain(rideDetail(ic('ic2', T, { last: true, platform: undefined }), 'fr'))).toBe('IC à Bruxelles-Nord, à l’heure, dernier');
    expect(plain(rideDetail(ic('ic3', T, { last: true, platform: '9', newPlatform: '7' }), 'fr'))).toBe('Voie 7 à Bruxelles-Nord, à l’heure, dernier');
    // un train plus tard dans la liste : pas de marque, avec ou sans voie
    expect(plain(rideDetail(j, 'fr', [j, ic('plus-tard', T + min(30))]))).toBe('Voie 9 à Bruxelles-Nord, à l’heure');
    // supprimé : jamais « dernier »
    expect(plain(rideDetail(ic('ic4', T, { last: true, cancelled: true }), 'fr'))).toBe('Voie 9 à Bruxelles-Nord, supprimé');
    expect(plain(rideDetail(tram('x', T, { last: true, cancelled: true }), 'fr'))).toBe('T81 à Flagey, supprimé');
    // sans véhicule
    expect(rideDetail(journey('pied', [walkLeg(T, 20)]), 'fr')).toBe('À pied, sans transport');
  });

  it('la même règle que l’écran du trajet des lunettes, par la même fonction : mêmes réponses sur les mêmes listes', () => {
    const j = tram('a', T, { last: true });
    const later = tram('b', T + min(20));
    const ctx: ViewCtx = { now: T - min(10), settings: settingsWith([PLACES.bureau]) };
    const glasses = (list: Journey[]) => page(stepsPage({ title: 'Montgomery', label: '' }, { journeys: list, index: 0, fresh: true }, ctx)).lines.some((l) => l.includes(LAST_MARK));
    for (const list of [[j], [j, later], [j, tram('c', T - min(10))], [j, tram('d', at(4, 0) + DAY)]]) {
      const phone = rideDetail(j, 'fr', list).endsWith(LAST_MARK);
      expect(phone, list.map((x) => x.id).join(' ')).toBe(tripLegLast(j.legs[1], j, list));
      expect(phone, list.map((x) => x.id).join(' ')).toBe(glasses(list));
    }
  });

  it('à l’écran : la carte lit les autres cartes de la même recherche (marque absente au-dessus d’un trajet plus tardif, présente sur le dernier)', async () => {
    const first = tram('a', T, { last: true });
    const second = tram('b', T + min(20), { last: true });
    const area = (id: string, fr: string) => ({ id, op: 'stib' as const, n: { fr, nl: fr }, lat: 50.8274, lon: 4.3723, modes: ['tram' as const], lines: ['81'] });
    const show = async (journeys: Journey[]) => {
      document.body.replaceChildren();
      const hz = harness({
        now: T - min(15),
        settings: defaults(),
        params: 'de=stib:3517&vers=stib:5252',
        core: (c) => ({ ...c, route: async () => ({ journeys }), board: async (id: string) => ({ ...(await c.board('sncb:8863008', { limit: 1 })), area: id === 'stib:3517' ? area(id, 'Flagey') : area(id, 'Montgomery') }) }),
      });
      const el = mount(searchScreen(hz.ctx));
      await until(() => el.querySelectorAll('.result').length === journeys.length);
      return [...el.querySelectorAll('.result')].map((c) => textOf(c.querySelector('.det')));
    };
    expect(await show([first, second])).toEqual(['T81 à Flagey, à l’heure', 'T81 à Flagey, à l’heure, dernier']);
    expect(await show([first])).toEqual(['T81 à Flagey, à l’heure, dernier']);
  });
});
