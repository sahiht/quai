/**
 * Quai 1.2.10, contrôle qualité usager : défauts trouvés en parcourant les écrans et les parcours avec le vrai
 * contrôleur, le vrai moteur et les vraies vues du guidage. Lieux publics seulement (gares et arrêts de Liège et de
 * Bruxelles).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Endpoint, LatLon } from '../../src/core/api';
import type { GuideState } from '../../src/core/guide-types';
import { textWidth } from '../../src/glasses/font';
import { guideView } from '../../src/glasses/guide-views';
import { layoutPage } from '../../src/glasses/layout';
import type { Intent } from '../../src/glasses/types';
import { stopsView } from '../../src/glasses/views';
import { P, at, firstWalkRoute, prdTrip } from '../core/guide-fixtures';
import { cleanupKit, guideSetup, type Kit } from './controller-guide-kit';
import { dep, nb, page, settingsWith, stopsOf } from './helpers';

const intent = (h: Kit, i: Intent) => (h.c as unknown as { runIntent(i: Intent): Promise<void> }).runIntent(i);
const settings = () => settingsWith([], { seenVersion: '1.3.0' });
const ETANGS: Endpoint = { type: 'address', label: 'Étangs d’Ixelles', lat: P.etangs.lat, lon: P.etangs.lon };

afterEach(() => cleanupKit());

describe('chemins à pied : jamais de boucle de demandes', () => {
  it('un chemin qui ne mène pas où le moteur l’attend : deux marches qui se le disputent ne bloquent pas l’appli', async () => {
    // Le contrôleur ne garde qu'un chemin à la fois. Descendu du train à Bruxelles-Central, le moteur demande la marche
    // vers l'arrêt du bus 71 (étape 4) ; avec ce chemin il se croit à l'arrêt et demande la dernière marche (étape 6) ;
    // sans le chemin de l'étape 4, il se croit encore en marche et le redemande... Une réponse immédiate du cœur
    // relançait aussitôt la demande suivante : boucle sans fin, appli figée. Ici le cœur rend toujours le même chemin
    // (celui de Liège), la boucle se voit au nombre de demandes ; au-delà de 50, le cœur échoue (la boucle s'arrête).
    let asked = 0;
    const walkRoute = async (_from: LatLon, _to: LatLon) => {
      asked++;
      if (asked > 50) throw new Error('trop de demandes');
      return firstWalkRoute();
    };
    const h = await guideSetup({ settings: settings(), pos: P.central, now: at('08:26:30'), walkRoute });
    await h.c.show({ screen: 'steps', key: 'k-prd', label: '', title: 'Bureau', journeys: [prdTrip()], index: 0, from: { type: 'here' } as Endpoint, to: ETANGS });
    await h.settle();
    await intent(h, { kind: 'goGuide' });
    await h.settle();
    const before = asked;
    for (let k = 0; k < 3; k++) {
      await h.settle(10_000);
      h.location.set(P.central);
      await h.push(P.central, { speed: 1 });
    }
    // au plus une demande par étape toutes les 10 s : quelques demandes en 30 s, jamais une rafale
    expect(asked - before).toBeLessThanOrEqual(8);
    expect(h.last().screen).toBe('guide');
  });
});

/** Les noms les plus longs des vraies données (data/tiles du 12/11). */
const LONG = ['Comines/komen Chaussée de Wervicq/Werviksesteenweg', 'Genk Ziekenhuis Oost-Limburg huisartsenwachtpost'];

/** Un titre coupé finit par « … » juste après un mot entier du texte d'origine (ou après une barre, un trait d'union). */
function cutAtWord(shown: string, full: string): boolean {
  if (!shown.endsWith('…')) return nb(shown) === nb(full);
  const head = nb(shown.slice(0, -1));
  if (/[-/’']$/.test(head)) return nb(full).startsWith(head);
  return new RegExp(`^${head.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\s|,|$)`).test(nb(full));
}

describe('PRD-1.2.10 § 1, principe 7 : un titre trop long est coupé au mot, jamais au milieu d’un mot', () => {
  const ctx = { now: at('07:10'), settings: settingsWith([]) };

  it('titre du guidage « j’y descends » (« Vers » et l’arrêt touché)', () => {
    const j = prdTrip();
    for (const name of LONG) {
      const title = `Vers ${name}`;
      const st: GuideState = {
        kind: 'ride', journeyId: j.id, phase: { kind: 'wait', leg: 1 }, location: 'off', wakeAt: Infinity, ended: false,
        moment: { kind: 'alight', id: 'a', since: 0, until: 1, leg: 1, stop: { fr: name, nl: name }, at: at('07:20'), rt: true, then: { kind: 'none' } },
        where: { title, arr: at('08:54'), rt: true, chain: [] },
      };
      const p = layoutPage(guideView(st, 'moment', j, ctx), { sel: -1, top: 0 });
      expect(textWidth(p.title)).toBeLessThan(textWidth(title));
      expect(cutAtWord(p.title, title), `« ${p.title} »`).toBe(true);
      const title2 = layoutPage(guideView(st, 'where', j, ctx), { sel: -1, top: 0 }).title;
      expect(cutAtWord(title2, title), `« ${title2} »`).toBe(true);
    }
  });

  it('titre des arrêts d’un départ (« j’y descends »), aussi un autre jour (« , demain » jamais coupé)', () => {
    for (const name of LONG) {
      const d = dep(at('07:10'), 4, { op: 'tec', mode: 'bus', line: '163b4', head: { fr: name, nl: name } });
      for (const day of [0, 1]) {
        const now = at('07:10') - day * 24 * 60 * 60_000;
        const ds = stopsOf(d, at('07:10'), [['Monument Gramme', 4], ['Place Général Leman', 7], [name, 12]]);
        const p = page(stopsView({ screen: 'stops', areaId: 'tec:MonumentGramme', dep: d }, ds, { now, settings: settingsWith([]) }));
        const tail = day ? ', demain' : '';
        const full = `Bus 163b4 vers ${name}`;
        expect(p.title.endsWith(tail)).toBe(true);
        expect(cutAtWord(p.title.slice(0, p.title.length - tail.length), full), `« ${p.title} »`).toBe(true);
      }
    }
  });
});
