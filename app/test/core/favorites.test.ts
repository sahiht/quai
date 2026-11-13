/**
 * Favoris « réponse directe » (PRD M1) au niveau du cœur : ordre intelligent (M1.4) et réponses (M1.5), sur les
 * fixtures et le préréglage 1.1 (fixtures/app/preset-1.1.json).
 * CA-M1.1, M1.3, M1.4, M1.5, M1.6, M1.8 pour la partie cœur ; les textes affichés sont testés par les lunettes.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaSummary, TileFile } from '../../../shared/types';
import type { Favorite, FavoriteAnswer, FavoritePlace, FavoriteStop, FavoriteTrip, Journey, Settings } from '../../src/core/api';
import { answerFavorite, answerTime, favoriteTitle, isLastAnswer, orderFavorites, relocateAmong, type AnswerEnv, type PlanMemo } from '../../src/core/favorites';
import { netOf } from '../../src/core/routing/repair';
import { distanceM, hhmm, walkMinutes } from '../../src/core/util';
import { validateSettings } from '../../src/settings';
import { makeEnv, type Scene } from './support/env';
import { CORE_DATA_DIR, readJson, REPO_DIR, at } from './support/network';

const RAW_11 = readJson<{ favorites: { id: string; kind: string }[] }>(join(REPO_DIR, 'fixtures', 'app', 'preset-1.1.json'));
const PRESET_11 = validateSettings(RAW_11);
/**
 * 1.2.2 : les arrêts favoris quittent les favoris (réglages v4, PRD-1.2.2 § 5) ; l'ordre intelligent et les réponses
 * d'un arrêt favori restent pour des données d'une version antérieure : le préréglage 1.1 tel que la 1.2.1 le lisait,
 * arrêts compris, à leur place.
 */
const LEGACY_11: Settings = {
  ...PRESET_11,
  favorites: RAW_11.favorites
    .map((r) => PRESET_11.favorites.find((f) => f.id === r.id) ?? (r.kind === 'stop' ? (r as unknown as FavoriteStop) : undefined))
    .filter((f): f is Favorite => f !== undefined),
};
const POS = {
  s1: { lat: 50.4655, lon: 4.859 },
  s2: { lat: 50.86, lon: 4.359 },
  s3: { lat: 50.8454, lon: 4.3571 },
  bureau: { lat: 50.8441, lon: 4.3474 },
};

async function answers(now: string, here: { lat: number; lon: number } | null, scene: Scene = 'base', settings: Settings = LEGACY_11) {
  const env = makeEnv({ now, scene });
  const last = new Map<string, FavoriteAnswer>();
  for (const f of settings.favorites) last.set(f.id, await env.core.answer(f, here, settings));
  return { env, last, order: env.core.orderFavorites(here, settings, last) };
}
const ids = (o: { favoriteId: string }[]) => o.map((r) => r.favoriteId);

describe('ordre intelligent (M1.4)', () => {
  it('le préréglage 1.1 est du v2 valide (A.2) : préréglage 1.0 plus fav-maison « Le soir », en dernier', () => {
    expect(LEGACY_11.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-namur', 'fav-dl-nord', 'fav-maison']);
    // 1.2 : migré (PRD-1.2 § 2.4) : « Ma position → Maison » est devenu le lieu « Maison »
    expect(LEGACY_11.favorites[5]).toMatchObject({ kind: 'place', id: 'fav-maison', label: 'Maison', propose: 'evening' });
    // 1.2.2 (réglages v4) : les arrêts sont rangés dans les gares et les lignes
    expect(PRESET_11.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    expect(PRESET_11.stations.map((x) => x.id)).toEqual(['fav-namur']);
    expect(PRESET_11.lines.map((x) => x.id)).toEqual(['fav-dl-nord']);
    // 1.2.6 : tram 3 et tram 4 gardés à « Gare du Nord » sont des lignes suivies
    expect(PRESET_11.follows?.map((x) => x.id)).toEqual(['f-fav-gdn-3', 'f-fav-gdn-4']);
  });

  it('1.2.2 : réglages v4 sans arrêt favori : bureau (créneau), Gand, maison en fin (« tu y es »)', async () => {
    const { order } = await answers('2026-11-10T07:31', POS.s1, 'noRT', PRESET_11);
    expect(ids(order)).toEqual(['fav-bureau', 'fav-gand', 'fav-maison']);
    expect(order.map((r) => r.rule)).toEqual([2, 4, 5]);
  });

  it('CA-M1.1 S1 : bureau (créneau), Namur (utilisable d’ici), le reste, maison en fin (« tu y es »)', async () => {
    const { order } = await answers('2026-11-10T07:31', POS.s1, 'noRT');
    expect(ids(order)).toEqual(['fav-bureau', 'fav-namur', 'fav-gdn', 'fav-gand', 'fav-dl-nord', 'fav-maison']);
    expect(order.map((r) => r.rule)).toEqual([2, 3, 4, 4, 4, 5]);
  });

  it('CA-M1.3 S2 : arrêts tout près (du plus proche au plus loin), puis bureau, le reste, maison (rien dans les 3 h) en fin', async () => {
    const { order, last } = await answers('2026-11-10T12:10', POS.s2);
    expect(ids(order)).toEqual(['fav-gdn', 'fav-dl-nord', 'fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    expect(order[0].distanceM).toBeLessThan(order[1].distanceM ?? 0);
    // la maison de Namur : l'IC du soir, au-delà de 3 h, reste une réponse (« partir à … »)
    const maison = last.get('fav-maison')!;
    expect(maison.state).toBe('ok');
    expect(isLastAnswer(maison, at('2026-11-10T12:10'))).toBe(true);
    // « Autres favoris » : fav-gand de gare à gare, gare hors de portée à pied → heures du train (« départ 14:10 »)
    const gand = last.get('fav-gand')!;
    expect(gand).toMatchObject({ state: 'ok', fromStation: true });
    const first = gand.plan!.journeys[0];
    expect(first.legs[0].kind).toBe('ride');
    expect(hhmm(first.legs[0].dep)).toBe('14:10');
    expect(hhmm(first.arr)).toBe('14:39');
    expect(hhmm(answerTime(gand)!)).toBe('14:10');
  });

  it('CA-M1.4 S3 : le trajet à départ fixe tout près vient en tête, partir à 14:08 pour l’IC de 14:10', async () => {
    const { order, last } = await answers('2026-11-10T13:55', POS.s3);
    expect(order[0]).toMatchObject({ favoriteId: 'fav-gand', rule: 1 });
    const gand = last.get('fav-gand')!;
    expect(gand.fromStation).toBeUndefined();
    const j = gand.plan!.journeys[0];
    expect(j.label).toBe('short');
    expect(j.legs[0].kind).toBe('ride'); // déjà à la gare : pas d'étape à pied
    expect(hhmm(j.leaveAt)).toBe('14:08');
    expect(hhmm(j.arr)).toBe('14:39');
  });

  it('CA-M1.5 position du Bureau : « tu y es », en fin de liste', async () => {
    const { order, last } = await answers('2026-11-10T07:31', POS.bureau);
    expect(last.get('fav-bureau')).toMatchObject({ state: 'here', plan: { journeys: [], empty: 'here' } });
    expect(order.find((r) => r.favoriteId === 'fav-bureau')?.rule).toBe(5);
    expect(ids(order).slice(-2)).toContain('fav-bureau');
  });

  it('CA-M1.6 : l’ordre ne dépend pas du passage de la scène noRT à base', async () => {
    const a = await answers('2026-11-10T07:31', POS.s1, 'noRT');
    const b = await answers('2026-11-10T07:31', POS.s1, 'base');
    expect(ids(a.order)).toEqual(ids(b.order));
    // les heures, elles, changent : +2 min sur l'IC de 07:42
    expect(hhmm(a.last.get('fav-bureau')!.plan!.journeys[0].leaveAt)).toBe('07:33');
    expect(hhmm(b.last.get('fav-bureau')!.plan!.journeys[0].leaveAt)).toBe('07:35');
  });

  it('CA-M1.8 sans position : règles 2, 4 et 5 seulement ; trajets depuis « Ma position » : noPosition', async () => {
    const { order, last } = await answers('2026-11-10T07:31', null);
    expect(order.map((r) => r.rule).every((r) => r === 2 || r === 4 || r === 5)).toBe(true);
    expect(order[0]).toMatchObject({ favoriteId: 'fav-bureau', rule: 2 });
    expect(last.get('fav-bureau')?.state).toBe('noPosition');
    expect(last.get('fav-maison')?.state).toBe('noPosition');
    expect(last.get('fav-gdn')?.state).toBe('ok'); // arrêts favoris : leurs départs
  });

  it('« Dans mon ordre » : l’ordre du téléphone, sauf la règle 5 (CA-S3.2)', () => {
    const mine: Settings = { ...LEGACY_11, display: { ...LEGACY_11.display, favOrder: 'mine' } };
    const order = orderFavorites(POS.s2, mine, at('2026-11-10T12:10'));
    expect(ids(order)).toEqual(LEGACY_11.favorites.map((f) => f.id));
    const atHome = orderFavorites(POS.s1, mine, at('2026-11-10T07:31'));
    expect(ids(atHome).at(-1)).toBe('fav-maison');
    expect(atHome.slice(0, -1).every((r) => r.rule === 4)).toBe(true);
  });

  it('égalité : l’ordre du téléphone ; le soir, « Vers la maison » passe en tête', () => {
    const order = orderFavorites(POS.bureau, PRESET_11, at('2026-11-10T17:30'));
    expect(order[0]).toMatchObject({ favoriteId: 'fav-maison', rule: 2 });
    expect(order.at(-1)).toMatchObject({ favoriteId: 'fav-bureau', rule: 5 });
  });

  it('titre d’un trajet favori : article de la 1.0', () => {
    const t = (f: Favorite) => (f.kind !== 'stop' ? favoriteTitle(f, PRESET_11) : '');
    expect(PRESET_11.favorites.filter((f) => f.kind !== 'stop').map(t)).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
    expect(favoriteTitle({ kind: 'trip', id: 'x', from: { type: 'area', areaId: 'sncb:8813003', op: 'sncb', name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 50.8454, lon: 4.3571 }, to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 }, propose: 'never' }, PRESET_11)).toBe('Vers Veldstraat 1');
  });

  it('1.2 : titre d’un lieu : article de la 1.0 pour un nom commun, sinon le nom tel quel (PRD-1.2 § 2.1)', () => {
    const place = (label: string): FavoritePlace => ({ kind: 'place', id: 'p', label, lat: 50.85, lon: 4.35, propose: 'never' });
    const titles = ['Bureau', 'Maison', 'École', 'Salle de sport', 'Chez Karim', 'Mon bureau', 'Le bureau', 'Veldstraat 1', 'Gand-Saint-Pierre', 'Namur', 'La Louvière', 'Rue Neuve 1'].map((n) => favoriteTitle(place(n), PRESET_11));
    expect(titles).toEqual(['Vers le bureau', 'Vers la maison', 'Vers l’école', 'Vers la salle de sport', 'Vers chez Karim', 'Vers mon bureau', 'Vers le bureau', 'Vers Veldstraat 1', 'Vers Gand-Saint-Pierre', 'Vers Namur', 'Vers La Louvière', 'Vers Rue Neuve 1']);
    // destination d'une recherche : lieu, adresse, arrêt
    expect(favoriteTitle({ type: 'place', placeId: 'fav-bureau' }, PRESET_11)).toBe('Vers le bureau');
    expect(favoriteTitle({ type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 }, PRESET_11)).toBe('Vers Veldstraat 1');
    expect(favoriteTitle({ type: 'area', areaId: 'sncb:8892007', op: 'sncb', name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters' }, lat: 51.0359, lon: 3.7107 }, PRESET_11)).toBe('Vers Gand-Saint-Pierre');
  });
});

describe('réponses des favoris (M1.5)', () => {
  it('CA-M1.1 S1 noRT : proposition 1 = IC de 07:42 avec la marche, partir à 07:33, arrivée 08:58 ; étiquette et raison', async () => {
    const { last } = await answers('2026-11-10T07:31', POS.s1, 'noRT');
    const a = last.get('fav-bureau')!;
    // 1.2 : fav-bureau est un lieu ; sa réponse est celle du trajet « Ma position → lieu »
    expect(PRESET_11.favorites[0].kind).toBe('place');
    expect(a).toMatchObject({ kind: 'trip', state: 'ok' });
    const j = a.plan!.journeys[0];
    expect(j.label).toBe('short');
    // 1.2.2 (PRD-1.2.2 § 7) : même IC et même arrivée, le T3 depuis Bruxelles-Nord garde chaque marche sous les
    // 10 min réglées ; l'IC direct puis 12 min à pied n'est plus proposé (« Sans changement » jamais avec plus de marche
    // de trop) ; puis le suivant
    expect(j.reason).toBe('Le plus court : 1 changement, à pied 7 + 2 + 9 min');
    expect(hhmm(j.leaveAt)).toBe('07:33');
    expect(hhmm(j.arr)).toBe('08:58');
    const ride = j.legs.find((l) => l.kind === 'ride')!;
    expect(ride).toMatchObject({ cat: 'IC', platform: '4' });
    expect(hhmm(ride.dep)).toBe('07:42');
    // puis « Le suivant » (l'IC d'une heure plus tard ; le tram de Bruxelles-Nord suit les garde-fous de core/routing/rank.ts)
    const next = a.plan!.journeys[1];
    expect(next.label).toBe('next');
    expect(next.reason).toMatch(/^Le suivant\u00a0: /);
    expect(hhmm(next.legs.find((l) => l.kind === 'ride')!.dep)).toBe('08:42');
  });

  it('CA-M1.2 S1 base : +2 min et voie 6 dans la réponse', async () => {
    const { last } = await answers('2026-11-10T07:31', POS.s1, 'base');
    const ride = last.get('fav-bureau')!.plan!.journeys[0].legs.find((l) => l.kind === 'ride')!;
    expect(ride).toMatchObject({ delayMin: 2, newPlatform: '6', rt: true });
    // 1.2.1 : l'IC (+2) arrive à Bruxelles-Nord à 08:42, le T3 de 08:44 reste attrapable : arrivée 08:58
    expect(hhmm(last.get('fav-bureau')!.plan!.journeys[0].arr)).toBe('08:58');
  });

  it('gare de départ à distance de marche : la marche jusqu’à la gare est comprise', async () => {
    const env = makeEnv({ now: '2026-11-10T13:50' });
    // à 400 m de Bruxelles-Central : 7 min à pied
    const a = await env.core.answer(PRESET_11.favorites.find((f) => f.id === 'fav-gand')!, { lat: 50.8454, lon: 4.3628 }, PRESET_11);
    expect(a.fromStation).toBeUndefined();
    const j = a.plan!.journeys[0];
    expect(j.legs[0]).toMatchObject({ kind: 'walk', walkMin: 7, to: { areaId: 'sncb:8813003' } });
    expect(hhmm(j.leaveAt)).toBe('14:01'); // 14:10 - 7 min - 2 min de marge
    expect(j.reason).toBe('Le plus court : direct, à pied 7 min');
  });

  it('arrêt favori : départs filtrés ; zone fusionnée retrouvée par `aka`, puis par nom et position ; sinon introuvable', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    const gdn = LEGACY_11.favorites[1] as FavoriteStop;
    const ok = await env.core.answer(gdn, POS.s2, PRESET_11);
    expect(ok.state).toBe('ok');
    expect(ok.movedTo).toBeUndefined();
    expect(ok.board?.departures.map((d) => d.line)).toEqual(['3', '4', '3', '3', '4']);

    // zone renommée par la fusion du pipeline : l'ancien identifiant est dans `aka` de la nouvelle zone (tuile)
    const tileKey = '2543_145';
    const tile = readJson<TileFile>(join(CORE_DATA_DIR, 'tiles', `${tileKey}.json`));
    const merged: TileFile = { v: 1, areas: tile.areas.map((a): AreaSummary => (a.id === 'stib:6357F' ? { ...a, aka: ['stib:6358', 'stib:1082'] } : a)) };
    env.server.memFiles.set(`tiles/${tileKey}.json`, JSON.stringify(merged));
    const viaAka = await env.core.answer({ ...gdn, areaId: 'stib:1082' }, POS.s2, PRESET_11);
    expect(viaAka.state).toBe('ok');
    expect(viaAka.movedTo?.id).toBe('stib:6357F');
    // ensuite, board() accepte l'ancien identifiant
    expect((await env.core.board('stib:1082', { limit: 2 })).area.id).toBe('stib:6357F');

    // favori de démonstration absent des données réelles : même nom, moins de 150 m (CA-M8.3)
    const byName = await env.core.answer({ ...gdn, areaId: 'stib:64' }, POS.s2, PRESET_11);
    expect(byName.movedTo?.id).toBe('stib:6357F');
    expect(byName.board?.departures.length).toBeGreaterThan(0);

    const missing = await env.core.answer({ ...gdn, areaId: 'stib:999999', name: { fr: 'Arrêt disparu', nl: 'Weg' } }, POS.s2, PRESET_11);
    expect(missing).toMatchObject({ state: 'missing', kind: 'stop' });
  });

  it('relocateAmong : `aka` d’abord, puis même opérateur, même nom, moins de 150 m, le plus proche', () => {
    const fav = { areaId: 'tec:old', op: 'tec' as const, name: { fr: 'La Hulpe Gare', nl: 'La Hulpe Gare' }, lat: 50.7303, lon: 4.4848 };
    const A = (id: string, fr: string, lat: number, lon: number, aka?: string[]): AreaSummary => ({ id, op: 'tec', n: { fr, nl: fr }, lat, lon, modes: ['bus'], lines: [], ...(aka ? { aka } : {}) });
    expect(relocateAmong(fav, [A('tec:a', 'La Hulpe Gare', 50.7304, 4.4849), A('tec:b', 'Autre', 50.74, 4.49, ['tec:old'])])?.id).toBe('tec:b');
    expect(relocateAmong(fav, [A('tec:far', 'La Hulpe Gare', 50.7330, 4.4848), A('tec:near', 'LA HULPE gare', 50.7305, 4.4848)])?.id).toBe('tec:near');
    expect(relocateAmong(fav, [A('tec:far', 'La Hulpe Gare', 50.7330, 4.4848)])).toBeNull(); // 300 m
    expect(relocateAmong(fav, [{ ...A('stib:x', 'La Hulpe Gare', 50.7303, 4.4848), op: 'stib' }])).toBeNull();
  });

  it('gare de départ → adresse : une seule marche jusqu’à l’arrêt de montée, le tram 1 de 14:36 attrapé (marges 2 et 0)', async () => {
    const fav: FavoriteTrip = {
      kind: 'trip',
      id: 'f-gand',
      propose: 'never',
      from: { type: 'area', areaId: 'sncb:8892007', op: 'sncb', name: { fr: 'Gand-Saint-Pierre', nl: 'Gent-Sint-Pieters' }, lat: 51.0359, lon: 3.7107 },
      to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0535, lon: 3.7225 },
    };
    const here = { lat: 51.04, lon: 3.7107 };
    for (const margin of [2, 0]) {
      const env = makeEnv({ now: '2026-11-10T14:20', scene: 'noRT' });
      const s: Settings = { ...PRESET_11, alerts: { ...PRESET_11.alerts, leaveBeforeMin: margin } };
      const a = await env.core.answer(fav, here, s);
      expect(a.state).toBe('ok');
      for (const j of a.plan!.journeys) {
        const i = j.legs.findIndex((l) => l.kind === 'ride');
        const ride = j.legs[i];
        // avant le premier véhicule : une seule marche, de la position à l'arrêt de montée
        expect(i).toBe(1);
        expect(j.legs[0]).toMatchObject({ kind: 'walk', from: { name: { fr: 'Ma position' } }, to: { lat: ride.from.lat, lon: ride.from.lon } });
        const w = j.legs[0].walkMin! * 60_000;
        expect(j.leaveAt).toBe(ride.dep - w - margin * 60_000);
        expect(j.legs[0].arr).toBeLessThanOrEqual(ride.dep);
      }
      const first = a.plan!.journeys[0];
      expect(hhmm(first.legs[1].dep)).toBe('14:36');
      expect(first.reason).toBe(`Le plus court\u00a0: direct, à pied ${first.legs[0].walkMin} + 3\u00a0min`);
    }
  });

  it('arrêt de départ → adresse proche : les propositions partent de la position ; la marche seule de 17 min n’arrive pas plus tôt (1.2.2)', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10', scene: 'noRT' });
    const fav: FavoriteTrip = {
      kind: 'trip',
      id: 'f-sj',
      propose: 'never',
      from: { type: 'area', areaId: 'stib:6357F', op: 'stib', name: { fr: 'Gare du Nord', nl: 'Noordstation' }, lat: 50.86004, lon: 4.36017 },
      to: { type: 'address', label: 'Rue X 1, 1210 Saint-Josse', lat: 50.8555, lon: 4.3602 },
    };
    const here = { lat: 50.8645, lon: 4.3602 };
    const a = await env.core.answer(fav, here, PRESET_11);
    expect(a.state).toBe('ok');
    // 1.2.2 (PRD-1.2.2 § 7) : plus de raccourci « marche seule » ; 17 min à pied (7 de trop) arrivent à 12:27, le T3
    // depuis la gare du Nord (9 + 3 min à pied) à 12:25 : la marche seule n'est pas proposée
    expect(walkMinutes(distanceM(here, fav.to as { lat: number; lon: number }))).toBe(17);
    const js = a.plan!.journeys;
    expect(js.every((j) => j.legs.some((l) => l.kind === 'ride'))).toBe(true);
    expect(js[0].legs[0]).toMatchObject({ kind: 'walk', from: { name: { fr: 'Ma position' } }, walkMin: 9 });
    expect(js[0].legs[js[0].legs.length - 1]).toMatchObject({ kind: 'walk', to: { lat: 50.8555, lon: 4.3602 } });
    expect(hhmm(js[0].arr)).toBe('12:25');
  });

  it('identifiants des propositions gardés (mémoire du réseau pour le recalcul d’une correspondance)', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const meta = await env.core.init();
    const gand = PRESET_11.favorites.find((f) => f.id === 'fav-gand') as FavoriteTrip;
    const here = { lat: 50.848, lon: 4.3571 }; // à 300 m de Bruxelles-Central : marche ajoutée
    const a = await env.core.answer(gand, here, PRESET_11);
    expect(a.plan!.journeys[0].legs[0]).toMatchObject({ kind: 'walk', from: { name: { fr: 'Ma position' } } });
    for (const j of a.plan!.journeys) {
      expect(j.id).not.toContain('~');
      expect(netOf(meta.generatedAt, j.id)).toBeTruthy();
    }
  });

  it('plan mémorisé : temps réel seul pendant 5 min ; nouveau calcul après 5 min, à 100 m, à une nouvelle génération, quand la 1re proposition ne tient plus', async () => {
    let t = at('2026-11-10T08:00');
    let gen = 'G1';
    let routes = 0;
    let delayMin = 0;
    let cancelled = false;
    let none = false;
    const Q = 15 * 60_000;
    const W = 5 * 60_000;
    const stop = { name: { fr: 'Arrêt', nl: 'Halte' }, lat: 50.8, lon: 4.3 };
    const dest = { name: { fr: 'Bureau', nl: 'Bureau' }, lat: 50.9, lon: 4.4 };
    const journey = (dep: number): Journey => ({
      id: `j${dep}`,
      legs: [
        { kind: 'walk', from: stop, to: stop, dep: dep - W, arr: dep, schedDep: dep - W, schedArr: dep, walkMin: 5 },
        { kind: 'ride', from: stop, to: dest, dep, arr: dep + Q, schedDep: dep, schedArr: dep + Q, op: 'stib', mode: 'tram', line: '3', tripId: `t${dep}` },
      ],
      dep: dep - W,
      arr: dep + Q,
      leaveAt: dep - W,
      transfers: 0,
      rt: false,
      alerts: [],
      label: 'short',
      reason: 'Le plus court : direct, à pied 5 min',
    });
    const env: AnswerEnv = {
      now: () => t,
      board: () => Promise.reject(new Error('inutile')),
      // tram toutes les 15 min ; le premier attrapable après 5 min de marche
      route: async (_from, _to, after) => {
        routes++;
        return none ? { journeys: [], empty: 'noTrip' } : { journeys: [journey(Math.ceil((after + W) / Q) * Q)] };
      },
      relocate: async () => null,
      // temps réel : retard ou suppression du tram
      refresh: async (js) =>
        js.map((j) => ({ ...j, legs: j.legs.map((l) => (l.kind === 'ride' ? { ...l, dep: l.schedDep + delayMin * 60_000, arr: l.schedArr + delayMin * 60_000, cancelled } : l)) })),
      generation: async () => gen,
      plans: new Map<string, PlanMemo>(),
    };
    const fav: FavoriteTrip = { kind: 'trip', id: 'f', propose: 'never', from: { type: 'here' }, to: { type: 'address', label: 'Bureau', lat: 50.9, lon: 4.4 } };
    const here = { lat: 50.8, lon: 4.3 };
    const near = { lat: 50.8004, lon: 4.3 }; // 45 m
    const far = { lat: 50.8015, lon: 4.3 }; // 167 m
    const ask = async (when: string | number, pos = here) => {
      t = typeof when === 'number' ? when : at(when);
      return answerFavorite(fav, pos, PRESET_11, env);
    };
    const firstRide = (a: FavoriteAnswer) => hhmm(a.plan!.journeys[0].legs[1].dep);
    expect(firstRide(await ask('2026-11-10T08:00'))).toBe('08:15');
    expect(routes).toBe(1);
    // moins de 5 min, moins de 100 m : temps réel seul
    expect(firstRide(await ask('2026-11-10T08:03', near))).toBe('08:15');
    expect(routes).toBe(1);
    // 5 min : nouveau calcul
    await ask('2026-11-10T08:05');
    expect(routes).toBe(2);
    // nouvelle génération de données
    gen = 'G2';
    await ask('2026-11-10T08:06');
    expect(routes).toBe(3);
    // position déplacée de plus de 100 m
    await ask('2026-11-10T08:07', far);
    expect(routes).toBe(4);
    await ask('2026-11-10T08:08', far);
    expect(routes).toBe(4);
    // tram de 08:15 plus attrapable (5 min de marche) : le suivant
    expect(firstRide(await ask(at('2026-11-10T08:10') + 31_000, far))).toBe('08:30');
    expect(routes).toBe(5);
    await ask('2026-11-10T08:25', far);
    expect(routes).toBe(6);
    // à 08:26, le tram de 08:30 ne s'attrape plus à l'heure prévue (5 min de marche), mais il a 3 min de retard :
    // toujours proposé, sans nouveau calcul
    delayMin = 3;
    const late = await ask('2026-11-10T08:26', far);
    expect(routes).toBe(6);
    expect(late.plan!.journeys[0].legs[1]).toMatchObject({ schedDep: at('2026-11-10T08:30'), dep: at('2026-11-10T08:33') });
    expect(late.updatedAt).toBe(at('2026-11-10T08:26'));
    // supprimé : nouveau calcul
    cancelled = true;
    await ask('2026-11-10T08:27', far);
    expect(routes).toBe(7);
    // rien trouvé : gardé 5 min aussi
    cancelled = false;
    none = true;
    await ask('2026-11-10T08:40', far);
    expect(routes).toBe(8);
    expect((await ask('2026-11-10T08:43', far)).state).toBe('none');
    expect(routes).toBe(8);
  });

  it('plan mémorisé : une 2e proposition supprimée impose un nouveau calcul (jamais affichée)', async () => {
    let t = at('2026-11-10T08:00');
    let routes = 0;
    let cancelSecond = false;
    const Q = 15 * 60_000;
    const stop = { name: { fr: 'Arrêt', nl: 'Halte' }, lat: 50.8, lon: 4.3 };
    const dest = { name: { fr: 'Bureau', nl: 'Bureau' }, lat: 50.9, lon: 4.4 };
    const journey = (dep: number, label: Journey['label']): Journey => ({
      id: `j${dep}`,
      legs: [{ kind: 'ride', from: stop, to: dest, dep, arr: dep + Q, schedDep: dep, schedArr: dep + Q, op: 'stib', mode: 'tram', line: '3', tripId: `t${dep}` }],
      dep, arr: dep + Q, leaveAt: dep, transfers: 0, rt: false, alerts: [], label, reason: 'Le plus court : direct',
    });
    const second = at('2026-11-10T08:30');
    const env: AnswerEnv = {
      now: () => t,
      board: () => Promise.reject(new Error('inutile')),
      route: async () => {
        routes++;
        return { journeys: [journey(at('2026-11-10T08:15'), 'short'), journey(second, 'next')] };
      },
      relocate: async () => null,
      refresh: async (js) => js.map((j) => ({ ...j, legs: j.legs.map((l) => ({ ...l, cancelled: cancelSecond && l.schedDep === second })) })),
      generation: async () => 'G1',
      plans: new Map<string, PlanMemo>(),
    };
    const fav: FavoriteTrip = { kind: 'trip', id: 'f2', propose: 'never', from: { type: 'here' }, to: { type: 'address', label: 'Bureau', lat: 50.9, lon: 4.4 } };
    const here = { lat: 50.8, lon: 4.3 };
    await answerFavorite(fav, here, PRESET_11, env);
    expect(routes).toBe(1);
    t = at('2026-11-10T08:01');
    await answerFavorite(fav, here, PRESET_11, env);
    expect(routes).toBe(1);
    cancelSecond = true;
    t = at('2026-11-10T08:02');
    await answerFavorite(fav, here, PRESET_11, env);
    expect(routes).toBe(2);
  });

  it('plan mémorisé sur les fixtures : l’IC de 14:22 en retard (+3) reste proposé à 14:23, sans nouveau calcul ni téléchargement', async () => {
    const env = makeEnv({ now: '2026-11-10T14:19', scene: 'base' });
    const gand = PRESET_11.favorites.find((f) => f.id === 'fav-gand')!;
    const here = POS.s3; // Bruxelles-Central
    const a = await env.core.answer(gand, here, PRESET_11);
    const ride = (x: FavoriteAnswer) => x.plan!.journeys[0].legs.find((l) => l.kind === 'ride')!;
    expect(ride(a)).toMatchObject({ cat: 'IC', delayMin: 3 });
    expect(hhmm(ride(a).schedDep)).toBe('14:22');
    const data = () => env.server.count((u) => u.includes('/quai/data/'));
    const before = data();
    env.clock.set('2026-11-10T14:23');
    const b = await env.core.answer(gand, here, PRESET_11);
    expect(hhmm(ride(b).schedDep)).toBe('14:22');
    expect(hhmm(ride(b).dep)).toBe('14:25');
    expect(b.updatedAt).toBe(at('2026-11-10T14:23'));
    expect(data()).toBe(before);
  });

  it('aucun trajet trouvé : state « none », en fin de liste', () => {
    const none: FavoriteAnswer = { favoriteId: 'fav-gand', kind: 'trip', state: 'none', plan: { journeys: [], empty: 'noTrip' }, updatedAt: 0 };
    const order = orderFavorites(POS.s2, PRESET_11, at('2026-11-10T12:10'), new Map([['fav-gand', none]]));
    expect(order.at(-1)).toMatchObject({ favoriteId: 'fav-gand', rule: 5 });
  });
});
