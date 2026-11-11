/**
 * Favoris « réponse directe » (PRD M1) au niveau du cœur : ordre intelligent (M1.4) et réponses (M1.5), sur les
 * fixtures et le préréglage 1.1 (fixtures/app/preset-1.1.json).
 * CA-M1.1, M1.3, M1.4, M1.5, M1.6, M1.8 pour la partie cœur ; les textes affichés sont testés par les lunettes.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaSummary, TileFile } from '../../../shared/types';
import type { Favorite, FavoriteAnswer, FavoriteStop, Settings } from '../../src/core/api';
import { answerTime, favoriteTitle, isLastAnswer, orderFavorites, relocateAmong } from '../../src/core/favorites';
import { hhmm } from '../../src/core/util';
import { validateSettings } from '../../src/settings';
import { makeEnv, type Scene } from './support/env';
import { CORE_DATA_DIR, readJson, REPO_DIR, at } from './support/network';

const PRESET_11 = validateSettings(readJson(join(REPO_DIR, 'fixtures', 'app', 'preset-1.1.json')));
const POS = {
  s1: { lat: 50.4655, lon: 4.859 },
  s2: { lat: 50.86, lon: 4.359 },
  s3: { lat: 50.8454, lon: 4.3571 },
  bureau: { lat: 50.8441, lon: 4.3474 },
};

async function answers(now: string, here: { lat: number; lon: number } | null, scene: Scene = 'base', settings: Settings = PRESET_11) {
  const env = makeEnv({ now, scene });
  const last = new Map<string, FavoriteAnswer>();
  for (const f of settings.favorites) last.set(f.id, await env.core.answer(f, here, settings));
  return { env, last, order: env.core.orderFavorites(here, settings, last) };
}
const ids = (o: { favoriteId: string }[]) => o.map((r) => r.favoriteId);

describe('ordre intelligent (M1.4)', () => {
  it('le préréglage 1.1 est du v2 valide (A.2) : préréglage 1.0 plus fav-maison « Le soir », en dernier', () => {
    expect(PRESET_11.favorites.map((f) => f.id)).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-namur', 'fav-dl-nord', 'fav-maison']);
    expect(PRESET_11.favorites[5]).toMatchObject({ kind: 'trip', from: { type: 'here' }, to: { type: 'place', placeId: 'maison' }, label: 'maison', propose: 'evening' });
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
    expect(j.label).toBe('simple');
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
    const mine: Settings = { ...PRESET_11, display: { ...PRESET_11.display, favOrder: 'mine' } };
    const order = orderFavorites(POS.s2, mine, at('2026-11-10T12:10'));
    expect(ids(order)).toEqual(PRESET_11.favorites.map((f) => f.id));
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
    const t = (f: Favorite) => (f.kind === 'trip' ? favoriteTitle(f, PRESET_11) : '');
    expect(PRESET_11.favorites.filter((f) => f.kind === 'trip').map(t)).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
    expect(favoriteTitle({ kind: 'trip', id: 'x', from: { type: 'here' }, to: { type: 'address', label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225 }, propose: 'never' }, PRESET_11)).toBe('Vers Veldstraat 1');
  });
});

describe('réponses des favoris (M1.5)', () => {
  it('CA-M1.1 S1 noRT : proposition 1 = IC de 07:42 avec la marche, partir à 07:33, arrivée 08:58 ; étiquette et raison', async () => {
    const { last } = await answers('2026-11-10T07:31', POS.s1, 'noRT');
    const a = last.get('fav-bureau')!;
    expect(a.state).toBe('ok');
    const j = a.plan!.journeys[0];
    expect(j.label).toBe('simple');
    expect(j.reason).toBe('Le plus simple : direct, à pied 7 + 12 min');
    expect(hhmm(j.leaveAt)).toBe('07:33');
    expect(hhmm(j.arr)).toBe('08:58');
    const ride = j.legs.find((l) => l.kind === 'ride')!;
    expect(ride).toMatchObject({ cat: 'IC', platform: '4' });
    expect(hhmm(ride.dep)).toBe('07:42');
  });

  it('CA-M1.2 S1 base : +2 min et voie 6 dans la réponse', async () => {
    const { last } = await answers('2026-11-10T07:31', POS.s1, 'base');
    const ride = last.get('fav-bureau')!.plan!.journeys[0].legs.find((l) => l.kind === 'ride')!;
    expect(ride).toMatchObject({ delayMin: 2, newPlatform: '6', rt: true });
    expect(hhmm(last.get('fav-bureau')!.plan!.journeys[0].arr)).toBe('09:00');
  });

  it('gare de départ à distance de marche : la marche jusqu’à la gare est comprise', async () => {
    const env = makeEnv({ now: '2026-11-10T13:50' });
    // à 400 m de Bruxelles-Central : 7 min à pied
    const a = await env.core.answer(PRESET_11.favorites[2], { lat: 50.8454, lon: 4.3628 }, PRESET_11);
    expect(a.fromStation).toBeUndefined();
    const j = a.plan!.journeys[0];
    expect(j.legs[0]).toMatchObject({ kind: 'walk', walkMin: 7, to: { areaId: 'sncb:8813003' } });
    expect(hhmm(j.leaveAt)).toBe('14:01'); // 14:10 - 7 min - 2 min de marge
    expect(j.reason).toBe('Le plus simple : direct, à pied 7 min');
  });

  it('arrêt favori : départs filtrés ; zone fusionnée retrouvée par `aka`, puis par nom et position ; sinon introuvable', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    const gdn = PRESET_11.favorites[1] as FavoriteStop;
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

  it('aucun trajet trouvé : state « none », en fin de liste', () => {
    const none: FavoriteAnswer = { favoriteId: 'fav-gand', kind: 'trip', state: 'none', plan: { journeys: [], empty: 'noTrip' }, updatedAt: 0 };
    const order = orderFavorites(POS.s2, PRESET_11, at('2026-11-10T12:10'), new Map([['fav-gand', none]]));
    expect(order.at(-1)).toMatchObject({ favoriteId: 'fav-gand', rule: 5 });
  });
});
