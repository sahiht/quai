/**
 * Conformité aux résultats attendus de fixtures/README.md (trois scénarios, correspondance, férié, après minuit),
 * sur deux jeux de données statiques servis par un faux fetch :
 *  - les fixtures du cœur (app/test/fixtures/core/data), toujours ;
 *  - la vraie sortie du pipeline sur les fixtures (.data/fixture-data, équipe données), si elle existe.
 * Temps réel : réponses du relais tirées de la section realtime de network.json.
 */
import { describe, expect, it } from 'vitest';
import type { Board, Journey, Settings } from '../../src/core/api';
import { areaLabel, hhmm, lineLabel, minutesUntil } from '../../src/core/util';
import { FakeServer, makeEnv, type Scene } from './support/env';
import { CORE_DATA_DIR, exists, PIPELINE_DATA_DIR, at } from './support/network';
import { join } from 'node:path';

const MAISON = { lat: 50.4655, lon: 4.859 };
const NORD = { lat: 50.86, lon: 4.359 };
const CENTRAL = { lat: 50.8454, lon: 4.3571 };

const urban = (b: Board, now: number) =>
  b.departures.map((d) => `${lineLabel(d.mode, d.line)} ${d.head.fr} ${d.rt ? '' : '~'}${minutesUntil(d.est, now)} min${d.delayMin ? ` (+${d.delayMin})` : ''}`);

const steps = (j: Journey) =>
  j.legs.map((l) => (l.kind === 'walk' ? `marche ${l.walkMin}` : `${l.cat ?? l.line} ${hhmm(l.dep)} voie ${l.newPlatform ?? l.platform} → ${l.to.name.fr} ${hhmm(l.arr)}`));

function suite(label: string, dataDir: string) {
  const env = (now: string, scene: Scene = 'base') => makeEnv({ now, scene, server: new FakeServer(dataDir) });

  describe(label, () => {
    describe('scénario 1 : 2026-11-10 07:31, Maison', () => {
      it('accueil : suggestion du favori fav-bureau (noRT puis base)', async () => {
        const a = env('2026-11-10T07:31', 'noRT');
        const s = await a.core.suggest(MAISON, a.preset);
        expect([s?.favoriteId, s?.title, s?.subtitle]).toEqual(['fav-bureau', 'Pour le bureau\u00a0: IC 07:42, voie 4', 'partir à 07:33, 7\u00a0min à pied']);
        const b = env('2026-11-10T07:31');
        const t = await b.core.suggest(MAISON, b.preset);
        expect([t?.title, t?.subtitle]).toEqual(['Pour le bureau\u00a0: IC 07:42 +2, voie 6', 'partir à 07:35, 7\u00a0min à pied']);
      });

      it('autour de moi (500 m) : 3 zones', async () => {
        const { core } = env('2026-11-10T07:31');
        const items = await core.nearby(MAISON.lat, MAISON.lon, 500);
        expect(items.map((x) => `${areaLabel(x.area, 'fr')} ${x.distanceM} m`)).toEqual([
          'Namur Place Léopold, bus TEC 150 m',
          'Namur, train 420 m',
          'Namur Gare, bus TEC 430 m',
        ]);
      });

      it('aller au bureau : 1re proposition, puis étapes avec l’alerte de voie', async () => {
        const a = env('2026-11-10T07:31', 'noRT');
        const j = (await a.core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, a.clock.t, a.preset, MAISON))[0];
        expect(steps(j)).toEqual(['marche 7', 'IC 07:42 voie 4 → Bruxelles-Central 08:46', 'marche 12']);
        expect([hhmm(j.leaveAt), hhmm(j.arr)]).toEqual(['07:33', '08:58']);
        const b = env('2026-11-10T07:31');
        const k = (await b.core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, b.clock.t, b.preset, MAISON))[0];
        expect(steps(k)).toEqual(['marche 7', 'IC 07:44 voie 6 → Bruxelles-Central 08:48', 'marche 12']);
        expect(hhmm(k.arr)).toBe('09:00');
        expect(k.alerts[0].text).toBe('! Voie modifiée\u00a0: l’IC part de la voie 6');
        // étapes rafraîchies en chemin
        b.clock.set('2026-11-10T07:37');
        const r = await b.core.refresh(j, b.preset);
        expect(r.alerts[0].text).toBe('! Voie modifiée\u00a0: l’IC part de la voie 6');
        expect([hhmm(r.dep), hhmm(r.arr)]).toEqual(['07:33', '09:00']);
      });
    });

    describe('scénario 2 : 2026-11-10 12:10, près de la gare du Nord', () => {
      it('ouverture : fav-gdn s’ouvre seul, départs filtrés en direct', async () => {
        const { core, preset, clock } = env('2026-11-10T12:10');
        const s = await core.suggest(NORD, preset);
        expect(s).toMatchObject({ favoriteId: 'fav-gdn', autoOpen: true });
        expect(urban(s?.board as Board, clock.t)).toEqual(['T3 Churchill 2 min', 'T4 Stalle (P) 5 min', 'T3 Esplanade 6 min', 'T3 Churchill 10 min', 'T4 Stalle (P) 13 min']);
      });

      it('autour de moi : 4 zones dans l’ordre avec le prochain départ', async () => {
        const { core, clock } = env('2026-11-10T12:10');
        const items = await core.nearby(NORD.lat, NORD.lon, 500);
        expect(
          items.map((x) => {
            const n = x.next;
            const next = !n ? '' : n.mode === 'train' ? `${n.line} ${hhmm(n.sched)} v.${n.platform}` : `${lineLabel(n.mode, n.line)} ${n.rt ? '' : '~'}${minutesUntil(n.est, clock.t)} min`;
            return `${areaLabel(x.area, 'fr')} ${x.distanceM} m ${next}`;
          }),
        ).toEqual([
          'Gare du Nord, tram 80 m T3 2 min',
          'Bruxelles-Nord, train 160 m IC 12:22 v.9',
          'Bruxelles-Nord, bus De Lijn 200 m 232 ~5 min',
          'Rogier, métro 340 m M2 3 min',
        ]);
      });

      it('Bruxelles-Nord, bus De Lijn et train', async () => {
        const { core, clock } = env('2026-11-10T12:10');
        expect(urban(await core.board('delijn:308611', { limit: 5 }), clock.t)).toEqual([
          '232 Vilvorde ~5 min',
          '460 Meise 10 min (+2)',
          '270 Kortenberg ~12 min',
          '232 Vilvorde 20 min',
          '232 Vilvorde 36 min (+1)',
        ]);
        const t = await core.board('sncb:8812005', { limit: 3 });
        expect(t.departures.map((d) => `${d.line} ${hhmm(d.sched)} v.${d.platform} ${d.head.fr} ${d.cancelled ? 'SUPPRIMÉ' : d.rt ? 'rt' : '~'}`)).toEqual([
          'IC 12:22 v.9 Anvers-Central rt',
          'IC 12:30 v.12 Anvers-Central ~',
          'S1 12:34 v.3 Nivelles SUPPRIMÉ',
        ]);
      });

      it('scène noRT : tout en horaire prévu (~)', async () => {
        const { core } = env('2026-11-10T12:10', 'noRT');
        const items = await core.nearby(NORD.lat, NORD.lon, 500);
        expect(items.every((x) => x.next && !x.next.rt)).toBe(true);
      });
    });

    describe('scénario 3 : 2026-11-10 13:55, Bruxelles-Central', () => {
      it('recherche « Gand »', async () => {
        const { core } = env('2026-11-10T13:55');
        const r = await core.search('Gand', CENTRAL);
        expect(r.slice(0, 3).map((x) => `${x.n.fr} (${x.kindLabel})`)).toEqual(['Gand-Saint-Pierre (gare SNCB)', 'Gand-Dampoort (gare SNCB)', 'Korenmarkt, Gand (tram De Lijn)']);
        expect(r.map((x) => `${x.n.fr} (${x.kindLabel})`)).toContain('Gand-Saint-Pierre (tram De Lijn)');
      });

      it('trains vers Gand-Saint-Pierre', async () => {
        const { core, clock } = env('2026-11-10T13:55');
        const js = await core.trains('sncb:8813003', 'sncb:8892007', clock.t);
        expect(js.map((j) => `${hhmm(j.legs[0].schedDep)} → ${hhmm(j.arr)} voie ${j.legs[0].platform} ${j.legs[0].delayMin ? `+${j.legs[0].delayMin} min` : 'à l’heure'}`)).toEqual([
          '14:10 → 14:39 voie 4 à l’heure',
          '14:22 → 14:56 voie 6 +3 min',
          '14:40 → 15:09 voie 4 à l’heure',
        ]);
      });

      it('à l’arrivée (14:39) : tram 1 vers Korenmarkt à 14:44 (à l’heure) et 14:53 (+1)', async () => {
        const { core } = env('2026-11-10T14:39');
        const b = await core.board('delijn:200553', { limit: 2, filter: [{ line: '1', head: 'korenmarkt' }] });
        expect(b.departures.map((d) => `${lineLabel(d.mode, d.line)} ${d.head.fr} ${hhmm(d.est)} ${d.rt ? 'rt' : '~'} +${d.delayMin}`)).toEqual([
          'T1 Korenmarkt 14:44 rt +0',
          'T1 Korenmarkt 14:53 rt +1',
        ]);
      });
    });

    it('correspondance : Namur → Gand-Saint-Pierre à 07:31, arrivée 09:29', async () => {
      const { core, clock } = env('2026-11-10T07:31', 'noRT');
      const j = (await core.trains('sncb:8863008', 'sncb:8892007', clock.t))[0];
      expect(hhmm(j.legs[0].schedDep)).toBe('07:42');
      expect(j.transfers).toBe(1);
      expect(['Bruxelles-Central', 'Bruxelles-Nord']).toContain(j.legs[0].to.name.fr);
      expect(j.legs[1].head?.fr).toBe('Bruges');
      expect(hhmm(j.arr)).toBe('09:29');
    });

    it('jour férié : le 2026-11-11 à Namur, seuls l’IC 08:42 et l’IC 09:42', async () => {
      const { core } = env('2026-11-11T05:00', 'noRT');
      const b = await core.board('sncb:8863008');
      expect(b.departures.map((d) => `${d.line} ${hhmm(d.sched)}`)).toEqual(['IC 08:42', 'IC 09:42']);
    });

    it('après minuit : IC 2199 à Bruxelles-Nord à 00:01 ; bus TEC 4 à 00:10', async () => {
      const { core } = env('2026-11-10T23:50', 'noRT');
      const t = await core.board('sncb:8812005', { limit: 1 });
      expect(t.departures[0].sched).toBe(at('2026-11-11T00:01'));
      const b = await core.board('tec:N508aga', { limit: 8 });
      expect(b.departures.find((d) => d.line === '4' && d.sched === at('2026-11-11T00:10'))).toBeDefined();
    });

    it('régressions : aucun doublon (tableau de 20, autour de moi, trains, plan) et la marche quand elle suffit', async () => {
      const { core, preset, clock } = env('2026-11-10T12:10');
      const b = await core.board('sncb:8812005', { limit: 20 });
      expect(new Set(b.departures.map((d) => `${d.tripId}#${d.stopSeq}`)).size).toBe(b.departures.length);
      expect(b.departures.filter((d) => hhmm(d.sched) === '12:22')).toHaveLength(1);
      const near = await core.nearby(NORD.lat, NORD.lon, 800);
      expect(new Set(near.map((x) => x.area.id)).size).toBe(near.length);
      const ts = await core.trains('sncb:8813003', 'sncb:8892007', clock.t, 10);
      expect(new Set(ts.map((j) => j.legs.map((l) => `${l.tripId}:${l.from.areaId}>${l.to.areaId}`).join('|'))).size).toBe(ts.length);
      expect(ts).toHaveLength(3);
      const m = env('2026-11-10T07:31');
      const js = await m.core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, m.clock.t, m.preset, MAISON);
      expect(js.map((j) => hhmm(j.leaveAt))).toEqual(['07:35', '08:33']);
      expect(await m.core.plan({ type: 'here' }, { type: 'place', placeId: 'maison' }, m.clock.t, m.preset, MAISON)).toEqual([]);
      const walk = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, clock.t, preset, CENTRAL);
      expect(walk.map((j) => j.legs.map((l) => l.kind).join('+'))).toEqual(['walk']);
    });

    it('réglages de démonstration : tous les favoris se résolvent', async () => {
      const { core, preset } = env('2026-11-10T12:10');
      for (const f of preset.favorites) {
        if (f.kind === 'stop') expect((await core.board(f.areaId, { filter: f.filter })).departures.length, f.id).toBeGreaterThan(0);
        else if (f.from.type !== 'here') expect((await core.plan(f.from, f.to, at('2026-11-10T13:55'), preset as Settings)).length, f.id).toBeGreaterThan(0);
      }
    });
  });
}

suite('fixtures du cœur', CORE_DATA_DIR);

const pipelineReady = exists(join(PIPELINE_DATA_DIR, 'meta.json'));
describe.skipIf(!pipelineReady)('sortie réelle du pipeline (.data/fixture-data)', () => {
  suite('pipeline', PIPELINE_DATA_DIR);
});
