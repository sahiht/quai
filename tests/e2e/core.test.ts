/**
 * Bout en bout sans interface : vrai cœur (createCore) + vraies données (pipeline sur les zips de fixtures,
 * servies par serve-data) + vrai relais (npm run dev) branché sur le faux portail BMC (npm run mock-bmc).
 * Oracle : fixtures/README.md (scénarios 1, 2, 3, correspondance, jour férié, après minuit), scènes base et noRT.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCore, dataFreshness } from '../../app/src/core/index';
import type { Core, Departure, Favorite, FavoriteStop, Journey, Leg, Settings } from '../../app/src/core/api';
import { migrateSettings } from '../../app/src/settings';
import { areaLabel, displayName, hhmm, lineLabel, minutesUntil } from '../../app/src/core/util';
import { buildFixtureData, memoryKV, ROOT, startDataServer, startStack, type Proc, type Stack } from './lib/stack';

/**
 * Réglages de la 1.0 (preset.json) lus par la 1.2.2 : migrés en v4, le lieu « Bureau » fusionné avec « Vers le
 * bureau », les arrêts favoris rangés dans les gares et les lignes (PRD-1.2.2 § 5).
 */
const RAW = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', 'preset.json'), 'utf8')) as { favorites: { id: string; kind: string }[] };
const PRESET: Settings = migrateSettings(RAW);
/** Les mêmes réglages lus par la 1.2.1 (arrêts favoris compris) : le cœur répond toujours à un arrêt favori. */
const LEGACY: Settings = {
  ...PRESET,
  favorites: [
    ...RAW.favorites
      .map((r) => PRESET.favorites.find((f) => f.id === r.id) ?? (r.kind === 'stop' ? (r as unknown as FavoriteStop) : undefined))
      .filter((f): f is Favorite => f !== undefined),
    ...PRESET.favorites.filter((f) => !RAW.favorites.some((r) => r.id === f.id)),
  ],
};
const MAISON = { lat: 50.4655, lon: 4.859 };
const S2_POS = { lat: 50.86, lon: 4.359 };
const CENTRAL = { lat: 50.8454, lon: 4.3571 };
const EM_DASH = '\u2014';
const EN_DASH = '\u2013';
const T = (hm: string, day = '2026-11-10') => Date.parse(`${day}T${hm}:00+01:00`);

let stack: Stack;
const coreAt = (now: number): Core =>
  createCore({ dataBase: `${stack.data.url}/`, relayBase: `${stack.relay.url}/`, now: () => now, storage: memoryKV(), fetch });

/** Texte d'un départ comme dans les maquettes : « T3 Churchill 2 min », « 232 Vilvorde ~5 min ». */
const depText = (d: Departure, now: number) => `${lineLabel(d.mode, d.line)} ${displayName(d.head, 'fr')} ${d.rt ? '' : '~'}${minutesUntil(d.est, now)} min`;
const rides = (j: Journey) => j.legs.filter((l): l is Leg & { kind: 'ride' } => l.kind === 'ride');
const walks = (j: Journey) => j.legs.filter((l) => l.kind === 'walk');

/**
 * Aucun texte visible avec un tiret cadratin ou demi-cadratin ; textes d'alerte et de suggestion ≤ 48 caractères ;
 * 1.1 (DECISIONS § 6) : espace insécable (U+00A0) devant « : ; ! ? » et entre un nombre et son unité, jamais une
 * espace ordinaire.
 */
function checkTexts(...texts: (string | undefined)[]): void {
  for (const t of texts) {
    if (t === undefined) continue;
    expect(t.includes(EM_DASH), `tiret cadratin dans « ${t} »`).toBe(false);
    expect(t.includes(EN_DASH), `tiret demi-cadratin dans « ${t} »`).toBe(false);
    expect(t.length, `« ${t} » dépasse 48 caractères`).toBeLessThanOrEqual(48);
    expect(t, `espace ordinaire devant une ponctuation haute dans « ${t} »`).not.toMatch(/ [:;!?]/);
    expect(t, `espace ordinaire entre un nombre et son unité dans « ${t} »`).not.toMatch(/\d (min|h|km|m)\b/);
  }
}

/** Pas deux fois le même départ (même voyage, même heure, même ligne et destination). */
function noDuplicates(deps: Departure[]): void {
  const keys = deps.map((d) => `${d.op}|${d.line}|${d.head.fr}|${d.sched}|${d.tripId ?? ''}|${d.stopId ?? ''}`);
  expect(new Set(keys).size, `départs en double : ${JSON.stringify(keys)}`).toBe(keys.length);
}

/**
 * Pas deux propositions identiques : même identité = mêmes véhicules (trip_id, sans la date, car un même trip_id
 * circule chaque jour) montés et quittés aux mêmes zones. Toutes partent dans les 23 h suivant `after`.
 */
function distinctJourneys(js: Journey[], after?: number): void {
  const identity = js.map((j) => rides(j).map((l) => `${l.op}/${l.tripId ?? `${l.line}>${l.head?.fr}@${hhmm(l.schedDep)}`}/${l.from.areaId}/${l.to.areaId}`).join('+'));
  expect(new Set(identity).size, `propositions en double : ${JSON.stringify(js.map((j) => `${hhmm(j.dep)} ${identity[js.indexOf(j)]}`))}`).toBe(identity.length);
  expect(new Set(js.map((j) => j.id)).size).toBe(js.length);
  if (after !== undefined) for (const j of js) expect(j.dep - after, `départ à plus de 23 h : ${new Date(j.dep).toISOString()}`).toBeLessThanOrEqual(23 * 3_600_000);
}

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});

for (const scene of ['base', 'noRT'] as const) {
  const rt = scene === 'base';
  describe(`scène ${scene}`, () => {
    beforeAll(async () => {
      await stack.scene(scene);
    });

    describe('scénario 1 : 2026-11-10 07:31, Maison (Namur)', () => {
      const now = T('07:31');

      it('accueil : suggestion du favori fav-bureau (matin)', async () => {
        const s = await coreAt(now).suggest(MAISON, PRESET);
        expect(s).not.toBeNull();
        expect(s!.kind).toBe('favoriteTrip');
        expect(s!.favoriteId).toBe('fav-bureau');
        expect(s!.autoOpen).toBe(false);
        if (rt) {
          // l'IC a +2 min et part voie 6 (départ estimé 07:44, partir à 07:35)
          expect(s!.title).toBe('Pour le bureau\u00a0: IC 07:42 +2, voie 6');
          expect(s!.subtitle).toBe('partir à 07:35, 7\u00a0min à pied');
        } else {
          expect(s!.title).toBe('Pour le bureau\u00a0: IC 07:42, voie 4');
          expect(s!.subtitle).toBe('partir à 07:33, 7\u00a0min à pied');
        }
        checkTexts(s!.title, s!.subtitle);
      });

      it('autour de moi (500 m) : Namur Place Léopold, Namur, Namur Gare', async () => {
        const list = await coreAt(now).nearby(MAISON.lat, MAISON.lon, 500);
        expect(list.map((n) => areaLabel(n.area, 'fr'))).toEqual(['Namur Place Léopold, bus TEC', 'Namur, train', 'Namur Gare, bus TEC']);
        expect(list.map((n) => n.area.id)).toEqual(['tec:N509aaa', 'sncb:8863008', 'tec:N508aga']);
        const [a, b, c] = list.map((n) => n.distanceM);
        expect(Math.abs(a - 150)).toBeLessThanOrEqual(10);
        expect(Math.abs(b - 420)).toBeLessThanOrEqual(10);
        expect(Math.abs(c - 430)).toBeLessThanOrEqual(10);
        for (const n of list) expect(n.distanceM % 10).toBe(0); // arrondi à 10 m
        const train = list[1].next!;
        expect(train.line).toBe('IC');
        expect(hhmm(train.sched)).toBe('07:42');
        expect(train.rt).toBe(rt);
        if (rt) expect([train.newPlatform, train.delayMin]).toEqual(['6', 2]);
        for (const n of list) if (n.next) expect(n.next.rt).toBe(rt && n.next.tripId !== 'N5-0730'); // N5-0730 hors flux TEC
      });

      it('Aller à… Bureau, 1re proposition (1.2.2) : marche 7, IC 07:42 jusqu’à Bruxelles-Nord, T3, marche 9', async () => {
        const js = await coreAt(now).plan({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, PRESET, MAISON);
        expect(js.length).toBeGreaterThanOrEqual(1);
        expect(js.length).toBeLessThanOrEqual(3);
        // l'IC de 08:42 circule les deux jours (DAILY) : jamais deux fois le même trajet, jamais celui du lendemain
        distinctJourneys(js, now);
        expect(js.every((j) => new Date(j.dep).toISOString().startsWith('2026-11-10'))).toBe(true);
        // ordre d'affichage du PRD-1.2.1 § 1.4 (la proposition 1, puis Plus tôt, Moins de marche, Sans changement ou
        // Moins de changements, À pied, Le suivant, Plus tard)
        const ORDER = ['short', 'earlier', 'lesswalk', 'none', 'none', 'walk', 'next', 'later'];
        const rank = (l: Journey['label']) => (l === 'fewer' ? 3 : ORDER.indexOf(l ?? ''));
        for (let i = 1; i < js.length; i++) expect(rank(js[i].label)).toBeGreaterThanOrEqual(rank(js[i - 1].label));
        const j = js[0];
        // 1.2.2 (PRD-1.2.2 § 7, coût = arrivée + 3 × la marche de trop + 1 par changement) : même IC, même arrivée que le
        // direct, mais le T3 depuis Bruxelles-Nord garde chaque marche sous les 10 min réglées ; le direct et ses 12 min
        // à pied marchent 2 min de trop : jamais « Sans changement » ; ensuite les trajets suivants
        expect(j.label).toBe('short');
        expect(js.map((x) => x.label)).not.toContain('none');
        expect(js.slice(1).every((x) => x.label === 'next' || x.label === 'later')).toBe(true);
        expect(js.some((x) => x.legs.some((l) => l.kind === 'walk' && (l.walkMin ?? 0) > PRESET.maxWalkMin))).toBe(false);
        expect(j.legs.map((l) => l.kind)).toEqual(['walk', 'ride', 'walk', 'ride', 'walk']);
        const [w1, ic, w2, tram, w3] = j.legs;
        expect([w1.walkMin, w2.walkMin, w3.walkMin]).toEqual([7, 2, 9]);
        expect([ic.cat, ic.from.areaId, ic.to.areaId, displayName(ic.head!, 'fr')]).toEqual(['IC', 'sncb:8863008', 'sncb:8812005', 'Bruxelles-Midi']);
        expect([tram.op, tram.line, hhmm(tram.dep), tram.to.name.fr]).toEqual(['stib', '3', '08:44', 'Bourse']);
        expect(hhmm(ic.schedDep)).toBe('07:42');
        expect(ic.platform).toBe('4');
        expect(hhmm(ic.schedArr)).toBe('08:40');
        expect(hhmm(j.arr)).toBe('08:58');
        if (rt) {
          expect([hhmm(ic.dep), ic.newPlatform, ic.delayMin, ic.rt]).toEqual(['07:44', '6', 2, true]);
          expect(hhmm(ic.arr)).toBe('08:42');
          expect(hhmm(j.leaveAt)).toBe('07:35');
          expect(j.alerts[0]?.text).toBe('! Voie modifiée\u00a0: l’IC part de la voie 6');
        } else {
          expect([hhmm(ic.dep), ic.newPlatform, ic.delayMin, ic.rt]).toEqual(['07:42', undefined, 0, false]);
          expect(hhmm(ic.arr)).toBe('08:40');
          expect(hhmm(j.leaveAt)).toBe('07:33');
          expect(j.alerts.filter((a) => a.kind === 'platform')).toEqual([]);
          expect(j.rt).toBe(false);
        }
        for (const x of js) checkTexts(...x.alerts.map((a) => a.text));
      });

      it('étapes : rafraîchissement à 07:37, alerte de voie en tête (base) ; aucun « ~ » perdu (noRT)', async () => {
        const [j] = await coreAt(now).plan({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, PRESET, MAISON);
        const later = T('07:37');
        const r = await coreAt(later).refresh(j, PRESET);
        expect(r.id).toBe(j.id); // identifiant stable
        const ic = rides(r)[0];
        if (rt) {
          expect(r.alerts[0]?.text).toBe('! Voie modifiée\u00a0: l’IC part de la voie 6');
          expect(r.alerts.map((a) => a.kind)).toContain('leave'); // 07:37 ≥ partir à 07:35
          expect(hhmm(ic.dep)).toBe('07:44');
        } else {
          expect(r.alerts.filter((a) => a.kind === 'platform')).toEqual([]);
          expect(ic.rt).toBe(false);
        }
        checkTexts(...r.alerts.map((a) => a.text));
      });
    });

    describe('scénario 2 : 2026-11-10 12:10, près de la gare du Nord', () => {
      const now = T('12:10');
      const fav = LEGACY.favorites.find((f) => f.id === 'fav-gdn')!;

      it('ouverture : fav-gdn (à moins de 300 m) s’ouvre seul, départs filtrés T3, T3, T4', async () => {
        // réglages de la 1.2.1 : l'arrêt favori « près » s'ouvre par suggest()
        const s = await coreAt(now).suggest(S2_POS, LEGACY);
        expect(s?.kind).toBe('favoriteStop');
        expect(s?.favoriteId).toBe('fav-gdn');
        expect(s?.autoOpen).toBe(true);
        checkTexts(s?.title, s?.subtitle);
        // 1.2.2 : migré en tram 3 et tram 4 « près » de la rubrique Bus, tram, métro (ouverts par les lunettes)
        expect(PRESET.lines.filter((l) => l.areaId === 'stib:6357F').map((l) => `${l.line} ${l.near}`)).toEqual(['3 true', '4 true']);
        expect((await coreAt(now).suggest(S2_POS, PRESET))?.kind).not.toBe('favoriteStop');
        const b = await coreAt(now).board('stib:6357F', { limit: PRESET.display.depsPerStop, filter: fav.kind === 'stop' ? fav.filter : undefined });
        const tilde = rt ? '' : '~';
        expect(b.departures.map((d) => depText(d, now))).toEqual(
          ['T3 Churchill 2 min', 'T4 Stalle (P) 5 min', 'T3 Esplanade 6 min', 'T3 Churchill 10 min', 'T4 Stalle (P) 13 min'].map((x) => x.replace(/(\d+ min)$/, `${tilde}$1`)),
        );
        expect(b.departures.every((d) => d.rt === rt)).toBe(true);
        expect(b.anyPlanned).toBe(!rt);
        expect(b.rtErrors).toEqual(rt ? [] : ['stib']);
        noDuplicates(b.departures);
      });

      it('autour de moi : 4 zones dans l’ordre, avec leur prochain départ', async () => {
        const list = await coreAt(now).nearby(S2_POS.lat, S2_POS.lon, 500);
        expect(list.map((n) => areaLabel(n.area, 'fr'))).toEqual(['Gare du Nord, tram', 'Bruxelles-Nord, train', 'Bruxelles-Nord, bus De Lijn', 'Rogier, métro']);
        const want = [80, 160, 200, 340];
        list.forEach((n, i) => expect(Math.abs(n.distanceM - want[i]), `${n.area.id} à ${n.distanceM} m`).toBeLessThanOrEqual(10));
        const [gdn, nord, dl, rogier] = list.map((n) => n.next!);
        expect(depText(gdn, now)).toBe(`T3 Churchill ${rt ? '' : '~'}2 min`);
        expect([nord.line, hhmm(nord.sched), nord.platform, nord.newPlatform, nord.rt]).toEqual(['IC', '12:22', '9', undefined, rt]);
        expect(depText(dl, now)).toBe('232 Vilvorde ~5 min');
        expect([lineLabel(rogier.mode, rogier.line), minutesUntil(rogier.est, now), rogier.rt]).toEqual(['M2', 3, rt]);
      });

      it('Bruxelles-Nord, bus De Lijn : 232 ~5, 460 10 (+2), 270 ~12, 232 20, 232 36 (+1)', async () => {
        const b = await coreAt(now).board('delijn:308611', { limit: 5 });
        noDuplicates(b.departures);
        const got = b.departures.map((d) => `${depText(d, now)}${d.delayMin ? ` (+${d.delayMin})` : ''}`);
        if (rt) expect(got).toEqual(['232 Vilvorde ~5 min', '460 Meise 10 min (+2)', '270 Kortenberg ~12 min', '232 Vilvorde 20 min', '232 Vilvorde 36 min (+1)']);
        else expect(got).toEqual(['232 Vilvorde ~5 min', '460 Meise ~8 min', '270 Kortenberg ~12 min', '232 Vilvorde ~20 min', '232 Vilvorde ~35 min']);
        expect(b.anyPlanned).toBe(true);
        expect(b.rtErrors).toEqual(rt ? [] : ['delijn']);
      });

      it('Bruxelles-Nord, train : IC 12:22 voie 9 à l’heure, IC 12:30 voie 12 ~, S1 12:34 supprimé', async () => {
        for (const limit of [3, 5, 8]) {
          const b = await coreAt(now).board('sncb:8812005', { limit });
          noDuplicates(b.departures);
          const [a, c, s1] = b.departures;
          expect([a.line, hhmm(a.sched), a.platform, displayName(a.head, 'fr'), a.rt, a.delayMin, a.cancelled]).toEqual(['IC', '12:22', '9', 'Anvers-Central', rt, 0, false]);
          expect([c.line, hhmm(c.sched), c.platform, c.rt]).toEqual(['IC', '12:30', '12', false]);
          expect([s1.line, hhmm(s1.sched), s1.cancelled]).toEqual(['S1', '12:34', rt]);
          expect(b.departures.filter((d) => hhmm(d.sched) === '12:22').length).toBe(1);
        }
        // grande limite : le tableau s'arrête à +23 h, l'IC 12:22 du lendemain n'apparaît pas une seconde fois
        const big = await coreAt(now).board('sncb:8812005', { limit: 30 });
        noDuplicates(big.departures);
        expect(big.departures.filter((d) => d.tripId === '88____:007::8814001:8821006:5:1258:20261231').length).toBe(1);
        for (const d of big.departures) {
          expect(d.sched - now).toBeLessThanOrEqual(23 * 3_600_000);
          if (d.sched - now > 6 * 3_600_000) expect([d.rt, d.est], `${d.line} ${hhmm(d.sched)} du lendemain`).toEqual([false, d.sched]);
        }
      });

      it('le soir à 23:00 : l’IC 12:22 du lendemain est annoncé une seule fois, en horaire prévu', async () => {
        const at = T('23:00');
        const b = await coreAt(at).board('sncb:8812005', { limit: 30 });
        noDuplicates(b.departures);
        const ic = b.departures.filter((d) => d.tripId === '88____:007::8814001:8821006:5:1258:20261231');
        expect(ic.length).toBe(1);
        expect([ic[0].sched, ic[0].est, ic[0].rt]).toEqual([T('12:22', '2026-11-11'), T('12:22', '2026-11-11'), false]);
        // l'IC 2199 de 00:01 (même jour de service) garde son temps réel éventuel et vient en tête
        expect(hhmm(b.departures[0].sched)).toBe('00:01');
      });
    });

    describe('scénario 3 : 2026-11-10 13:55, Bruxelles-Central', () => {
      const now = T('13:55');

      it('recherche « Gand » : gares d’abord, puis Korenmarkt, puis l’arrêt de tram homonyme de la gare', async () => {
        const res = await coreAt(now).search('Gand', CENTRAL);
        const got = res.map((r) => `${displayName(r.n, 'fr')} (${r.kindLabel})`);
        const want = ['Gand-Saint-Pierre (gare SNCB)', 'Gand-Dampoort (gare SNCB)', 'Korenmarkt, Gand (tram De Lijn)', 'Gand-Saint-Pierre (tram De Lijn)'];
        // ordre relatif de l'oracle respecté (d'autres arrêts « Gand » peuvent s'intercaler)
        const pos = want.map((w) => got.indexOf(w));
        expect(pos.every((p) => p >= 0), `résultats : ${JSON.stringify(got)}`).toBe(true);
        expect([...pos].sort((x, y) => x - y)).toEqual(pos);
        expect(pos.slice(0, 2)).toEqual([0, 1]);
        expect(got[got.length - 1]).toBe('Gand-Saint-Pierre (tram De Lijn)');
        expect(res.length).toBeLessThanOrEqual(20);
        expect(await coreAt(now).search('G')).toEqual([]);
      });

      it('trains Bruxelles-Central → Gand-Saint-Pierre dès 13:55', async () => {
        const js = await coreAt(now).trains('sncb:8813003', 'sncb:8892007', now, 3);
        distinctJourneys(js, now);
        const got = js.map((j) => {
          const l = rides(j)[0];
          return `${hhmm(l.schedDep)} → ${hhmm(l.arr)} voie ${l.newPlatform ?? l.platform}${l.delayMin ? ` +${l.delayMin} min` : ''}${j.transfers ? ' corresp.' : ''}`;
        });
        if (rt) expect(got).toEqual(['14:10 → 14:39 voie 4', '14:22 → 14:56 voie 6 +3 min', '14:40 → 15:09 voie 4']);
        else expect(got).toEqual(['14:10 → 14:39 voie 4', '14:22 → 14:53 voie 6', '14:40 → 15:09 voie 4']);
        expect(js.every((j) => j.rt === rt)).toBe(true);
      });

      it('arrivée à Gand-Saint-Pierre : tram 1 vers Korenmarkt à 14:44 (à l’heure) et 14:53 (+1)', async () => {
        const at = T('14:36');
        const b = await coreAt(at).board('delijn:200553', { limit: 8, filter: [{ line: '1', head: 'korenmarkt' }] });
        noDuplicates(b.departures);
        // l'écran d'arrivée ne garde que les départs après l'arrivée du train (14:39)
        const after = b.departures.filter((d) => d.est >= T('14:39'));
        const got = after.slice(0, 2).map((d) => `${hhmm(d.est)}${d.delayMin ? ` (+${d.delayMin})` : ''}${d.rt ? '' : ' ~'}`);
        expect(got).toEqual(rt ? ['14:44', '14:53 (+1)'] : ['14:44 ~', '14:52 ~']);
        expect(b.departures.every((d) => displayName(d.head, 'fr') === 'Korenmarkt' && d.mode === 'tram')).toBe(true);
      });
    });

    describe('correspondance, jour férié, après minuit', () => {
      it('Namur → Gand-Saint-Pierre à 07:31 : IC 07:42, changement à Bruxelles-Central ou -Nord, IC vers Bruges, arrivée 09:29', async () => {
        const now = T('07:31');
        const js = await coreAt(now).trains('sncb:8863008', 'sncb:8892007', now, 3);
        distinctJourneys(js, now);
        const j = js[0];
        expect(j.transfers).toBe(1);
        const [a, b] = rides(j);
        expect([a.cat, hhmm(a.schedDep), a.from.areaId]).toEqual(['IC', '07:42', 'sncb:8863008']);
        expect(['sncb:8813003', 'sncb:8812005']).toContain(a.to.areaId);
        expect(b.from.areaId).toBe(a.to.areaId);
        expect(b.schedDep - a.schedArr).toBeGreaterThanOrEqual(4 * 60_000);
        expect([b.cat, displayName(b.head!, 'fr'), b.to.areaId, hhmm(b.schedArr)]).toEqual(['IC', 'Bruges', 'sncb:8892007', '09:29']);
        expect(hhmm(j.arr)).toBe('09:29');
      });

      it('2026-11-11 (férié) à Namur : seuls l’IC 08:42 (DAILY) et l’IC 09:42 (HOLI)', async () => {
        const now = T('05:00', '2026-11-11');
        const b = await coreAt(now).board('sncb:8863008', { limit: 8 });
        expect(b.departures.map((d) => `${d.line} ${hhmm(d.sched)}`)).toEqual(['IC 08:42', 'IC 09:42']);
        expect(b.departures.map((d) => d.tripId)).toEqual(['88____:007::8863008:8814001:10:952:20261231', '88____:007::8863008:8814001:10:1052:20261231']);
        const js = await coreAt(now).trains('sncb:8863008', 'sncb:8813003', now, 3);
        expect(js.map((j) => hhmm(j.dep))).toEqual(['08:42', '09:42']);
        // calendrier WEEK retiré partout : pas de ligne 270 De Lijn ni 51 TEC ce jour-là
        const dl = await coreAt(T('12:10', '2026-11-11')).board('delijn:308611', { limit: 8 });
        expect(dl.departures.some((d) => d.line === '270')).toBe(false);
        const tec = await coreAt(T('12:00', '2026-11-11')).board('tec:N508aga', { limit: 8 });
        expect(tec.departures.some((d) => d.line === '51')).toBe(false);
        expect(tec.departures.length).toBeGreaterThan(0);
      });

      it('2026-11-11 12:10 : un flux resté sur la veille (heures absolues du 10/11) ne déplace ni ne masque l’IC 12:22', async () => {
        const now = T('12:10', '2026-11-11');
        const b = await coreAt(now).board('sncb:8812005', { limit: 5 });
        noDuplicates(b.departures);
        const ic = b.departures.find((d) => d.tripId === '88____:007::8814001:8821006:5:1258:20261231');
        expect(ic, JSON.stringify(b.departures.map((d) => `${d.line} ${hhmm(d.sched)}`))).toBeDefined();
        expect([hhmm(ic!.sched), hhmm(ic!.est), ic!.rt, ic!.delayMin]).toEqual(['12:22', '12:22', false, 0]);
        expect(b.departures.some((d) => d.line === 'S1')).toBe(false); // S1 : WEEK, retiré le jour férié
      });

      it('après minuit (2026-11-11 00:00) : IC 2199 à Bruxelles-Nord à 00:01, bus TEC 4 à 00:10', async () => {
        const now = T('00:00', '2026-11-11');
        const b = await coreAt(now).board('sncb:8812005', { limit: 3 });
        const first = b.departures[0];
        expect([first.line, hhmm(first.sched), first.platform, displayName(first.head, 'fr')]).toEqual(['IC', '00:01', '9', 'Anvers-Central']);
        expect(first.sched).toBe(Date.parse('2026-11-11T00:01:00+01:00'));
        expect(first.tripId).toBe('88____:007::8814001:8821006:5:2436:20261231');
        const tec = await coreAt(now).board('tec:N508aga', { limit: 3 });
        expect(`${tec.departures[0].line} ${displayName(tec.departures[0].head, 'fr')} ${hhmm(tec.departures[0].sched)}`).toBe('4 Jambes 00:10');
        // la veille à 23:58, le même train est déjà annoncé
        const eve = await coreAt(T('23:58')).board('sncb:8812005', { limit: 3 });
        expect(eve.departures.map((d) => `${d.line} ${hhmm(d.sched)}`)).toContain('IC 00:01');
      });
    });
  });
}

describe('fonctions transversales', () => {
  beforeAll(async () => {
    await stack.scene('base');
  });

  it('linesAt(Gare du Nord) : T3 Churchill, T3 Esplanade, T4 Stalle (P), filtres compatibles avec preset.json', async () => {
    const lines = await coreAt(T('12:10')).linesAt('stib:6357F');
    expect(lines.map((l) => `${lineLabel(l.mode, l.line)} ${displayName(l.head, 'fr')}`)).toEqual(['T3 Churchill', 'T3 Esplanade', 'T4 Stalle (P)']);
    expect(lines.map((l) => l.filter)).toEqual([
      { line: '3', head: 'churchill' },
      { line: '3', head: 'esplanade' },
      { line: '4', head: 'stalle p' },
    ]);
    const fav = LEGACY.favorites.find((f) => f.id === 'fav-gdn');
    expect(fav?.kind === 'stop' ? fav.filter : null).toEqual(lines.map((l) => l.filter));
  });

  it('1.2.2 : lignes par numéro, arrêts et passages par sens, sur les données du pipeline et le vrai relais (CA-122.4)', async () => {
    const now = T('12:10');
    const core = coreAt(now);
    const [t3] = await core.findLines('3', S2_POS);
    expect(t3).toMatchObject({ op: 'stib', mode: 'tram', line: '3', routes: ['stib:3'], nearest: { areaId: 'stib:6357F' } });
    expect(t3.ends.map((n) => n.fr)).toEqual(['Churchill', 'Esplanade']);
    expect((await core.findLines('W')).map((m) => `${m.op} ${m.line} ${m.ends.map((n) => n.fr).join(' ↔ ')}`)).toEqual(['tec W Braine-l’Alleud Gare ↔ Bruxelles Midi']);
    const [w] = await core.findLines('w');
    expect((await core.lineStops(w)).map((x) => x.areaId)).toEqual(['tec:Bbrlgar1', 'tec:Bwategl1', 'tec:Bbxlmid1']);
    // tram 3 à Gare du Nord : deux sens, en temps réel STIB (scène base)
    const b = await core.lineBoard('stib:6357F', '3');
    expect(b).toMatchObject({ state: 'ok', op: 'stib', mode: 'tram', line: '3', anyPlanned: false, rtErrors: [] });
    expect(b.directions.map((d) => `${displayName(d.head, 'fr')} : ${d.departures.map((x) => `${hhmm(x.est)}${x.rt ? '' : '~'}`).join(', ')}`)).toEqual([
      'Churchill : 12:12, 12:20',
      'Esplanade : 12:16, 12:24',
    ]);
    checkTexts(...b.directions.map((d) => d.head.fr));
    // bus W à Waterloo Eglise : deux sens ; ligne absente et arrêt inconnu : introuvable
    const wb = await coreAt(T('07:31')).lineBoard('tec:Bwategl1', 'W');
    expect(wb.directions.map((d) => d.head.fr)).toEqual(['Bruxelles Midi', 'Braine-l’Alleud Gare']);
    expect(wb.directions.every((d) => d.departures.length === 2)).toBe(true);
    expect((await core.lineBoard('stib:6357F', 'W')).state).toBe('missing');
    expect((await core.lineBoard('stib:404', '3')).state).toBe('missing');
  });

  it('trains Namur → Gand-Saint-Pierre : une correspondance, au moins 4 min en gare', async () => {
    const now = T('07:31');
    const js = await coreAt(now).trains('sncb:8863008', 'sncb:8892007', now, 3);
    expect(js.length).toBeGreaterThan(0);
    for (const j of js) {
      expect(j.transfers).toBeLessThanOrEqual(1);
      const r = rides(j);
      if (r.length === 2) expect(r[1].schedDep - r[0].schedArr).toBeGreaterThanOrEqual(4 * 60_000);
      expect(r[0].dep).toBeGreaterThanOrEqual(now);
    }
  });

  it('Maison → Maison (et « ici » → Maison depuis la maison) : aucun trajet', async () => {
    const now = T('07:31');
    for (const from of [{ type: 'place', placeId: 'maison' }, { type: 'here' }] as const) {
      const js = await coreAt(now).plan(from, { type: 'place', placeId: 'maison' }, now, PRESET, MAISON);
      expect(js, `depuis ${from.type}`).toEqual([]);
    }
    // à 90 m de la maison : toujours le même lieu (moins de 100 m)
    expect(await coreAt(now).plan({ type: 'here' }, { type: 'place', placeId: 'maison' }, now, PRESET, { lat: MAISON.lat + 0.0008, lon: MAISON.lon })).toEqual([]);
    expect(await coreAt(now).trains('sncb:8863008', 'sncb:8863008', now, 3)).toEqual([]);
  });

  it('destination à distance de marche : jamais plus tard qu’à pied (1.2.2 : la marche seule concourt avec les autres trajets)', async () => {
    const now = T('12:10');
    const rogier = { type: 'area', areaId: 'stib:6359', op: 'stib', name: { fr: 'Rogier', nl: 'Rogier' }, lat: 50.856925, lon: 4.358875 } as const;
    const js = await coreAt(now).plan({ type: 'here' }, rogier, now, PRESET, S2_POS);
    expect(js.length).toBeGreaterThanOrEqual(1);
    expect(js.length).toBeLessThanOrEqual(3);
    expect(js[0].label).toBe('short');
    // 6 min à pied (arrivée 12:16) ; le T3 de 12:12 à Gare du Nord, à 2 min, arrive à 12:14 : il passe d'abord
    expect(js[0].arr).toBeLessThanOrEqual(T('12:16'));
    expect(js[0].transfers).toBe(0);
    for (const j of js) for (const l of j.legs) if (l.kind === 'walk') expect(l.walkMin).toBeLessThanOrEqual(PRESET.maxWalkMin);
  });

  it('jamais un véhicule plus lent que la marche : Bruxelles-Central → Bureau (12 min à pied)', async () => {
    const now = T('13:55');
    const from = { type: 'area', areaId: 'sncb:8813003', op: 'sncb', name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: CENTRAL.lat, lon: CENTRAL.lon } as const;
    const js = await coreAt(now).plan(from, { type: 'place', placeId: 'fav-bureau' }, now, PRESET);
    expect(js.length).toBeGreaterThanOrEqual(1);
    const walkArr = now + 12 * 60_000;
    for (const j of js) expect(j.arr, `proposition ${hhmm(j.dep)} → ${hhmm(j.arr)}`).toBeLessThanOrEqual(walkArr);
  });

  it('health() relaie /api/health du relais (sources et données)', async () => {
    const h = await coreAt(T('12:10')).health();
    expect(typeof h.ok).toBe('boolean');
    expect(Object.keys(h.sources).sort()).toEqual(['delijn', 'sncb', 'stib', 'tec']);
    expect(h.data?.feeds?.sncb.ok).toBe(true);
  });
});

describe('horaires périmés (dernière publication le 2026-11-01)', () => {
  let stale: { dir: string; server: Proc };
  beforeAll(async () => {
    const { dir } = await buildFixtureData({ date: '2026-11-01' });
    stale = { dir, server: await startDataServer(dir) };
  });
  afterAll(async () => {
    await stale?.server.stop();
  });

  it('dataFreshness signale des horaires périmés et le cœur n’affiche plus aucun départ', async () => {
    const now = T('12:10');
    const core = createCore({ dataBase: stale.server.url, relayBase: stack.relay.url, now: () => now, storage: memoryKV(), fetch });
    const meta = await core.init(); // init() n'échoue pas sur des horaires périmés
    expect(meta.serviceDates).toEqual(['2026-11-01', '2026-11-02']);
    const f = dataFreshness(meta, now);
    expect(f.ok).toBe(false);
    expect(f.message).toBe('Horaires périmés\u00a0: mise à jour arrêtée le 02/11');
    checkTexts(f.message);
    // âge compté depuis meta.generatedAt, l'heure réelle où les données de test ont été préparées
    // (pas forcément avant 12:10 le 10/11 : on ne compare donc pas à zéro)
    expect(f.ageHours).toBe(Math.round(((now - Date.parse(meta.generatedAt)) / 3_600_000) * 10) / 10);
    const b = await core.board('stib:6357F', { limit: 5 });
    expect(b.departures).toEqual([]);
    expect(b.area.id).toBe('stib:6357F');
    const near = await core.nearby(S2_POS.lat, S2_POS.lon, 500);
    expect(near.length).toBe(4);
    expect(near.every((n) => n.next === undefined)).toBe(true);
    expect(await core.trains('sncb:8813003', 'sncb:8892007', now, 3)).toEqual([]);
    expect(await core.plan({ type: 'here' }, { type: 'place', placeId: 'fav-bureau' }, now, PRESET, MAISON)).toEqual([]);
    expect(await core.suggest(S2_POS, PRESET)).toBeNull();
  });

  it('date du téléphone avant la publication : message dédié', () => {
    const meta = { v: 1, generatedAt: '2026-11-09T01:15:00Z', timezone: 'Europe/Brussels', serviceDates: ['2026-11-10', '2026-11-11'], tile: { lat: 0.02, lon: 0.03 }, feeds: {} } as never;
    const f = dataFreshness(meta, T('12:00', '2026-11-08'));
    expect(f.ok).toBe(false);
    expect(f.message).toBe('Horaires du 10/11\u00a0: vérifie la date du téléphone');
    // avant 04:00, la date de la veille couvre encore la nuit
    expect(dataFreshness(meta, T('03:30', '2026-11-12')).ok).toBe(true);
    expect(dataFreshness(meta, T('04:30', '2026-11-12')).ok).toBe(false);
  });
});
