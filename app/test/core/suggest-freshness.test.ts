/**
 * Suggestion à l'ouverture (trois scénarios avec fixtures/app/preset.json) et fraîcheur des horaires.
 */
import { describe, expect, it } from 'vitest';
import type { Meta } from '../../../shared/types';
import type { Settings } from '../../src/core/api';
import { dataFreshness } from '../../src/core/index';
import { hhmm } from '../../src/core/util';
import { makeEnv } from './support/env';
import { at } from './support/network';

const POS = {
  s1: { lat: 50.4655, lon: 4.859 },
  s2: { lat: 50.86, lon: 4.359 },
  s3: { lat: 50.8454, lon: 4.3571 },
};

describe('suggest', () => {
  it('scénario 1, scène noRT : « Pour le bureau : IC 07:42, voie 4 » / « partir à 07:33, 7 min à pied »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const s = await core.suggest(POS.s1, preset);
    expect(s).toMatchObject({
      kind: 'favoriteTrip',
      favoriteId: 'fav-bureau',
      autoOpen: false,
      title: 'Pour le bureau : IC 07:42, voie 4',
      subtitle: 'partir à 07:33, 7 min à pied',
    });
    expect(hhmm(s?.journey?.arr ?? 0)).toBe('08:58');
  });

  it('scénario 1, scène base : retard et voie en direct, départ recalculé', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const s = await core.suggest(POS.s1, preset);
    expect(s?.title).toBe('Pour le bureau : IC 07:42 +2, voie 6');
    expect(s?.subtitle).toBe('partir à 07:35, 7 min à pied');
    expect(s?.journey?.alerts[0]?.text).toBe('! Voie modifiée : l’IC part de la voie 6');
  });

  it('scénario 2 : le favori « à moins de 300 m » s’ouvre seul, départs filtrés en direct', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T12:10' });
    const s = await core.suggest(POS.s2, preset);
    expect(s).toMatchObject({ kind: 'favoriteStop', favoriteId: 'fav-gdn', autoOpen: true, title: 'Gare du Nord : T3 Churchill 2 min', subtitle: 'puis T4 Stalle 5 min' });
    expect(s?.board?.departures).toHaveLength(5);
    expect(s?.board?.anyPlanned).toBe(false);
  });

  it('scénario 3 (13:55, Bruxelles-Central) : rien à proposer', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    expect(await core.suggest(POS.s3, preset)).toBeNull();
  });

  it('réglage d’ouverture : accueil → rien ; premier favori → ouvert directement', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    expect(await core.suggest(POS.s1, { ...preset, display: { ...preset.display, opening: 'home' } })).toBeNull();
    const first = await core.suggest(POS.s1, { ...preset, display: { ...preset.display, opening: 'firstFavorite' } });
    expect(first).toMatchObject({ favoriteId: 'fav-bureau', autoOpen: true, title: 'Pour le bureau : IC 07:42, voie 4' });
  });

  it('soir : favori « soir » ; sans libellé, le lieu en minuscules ; sans position, pas de trajet « ici »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T16:00', scene: 'noRT' });
    const evening: Settings = {
      ...preset,
      places: [...preset.places, { id: 'maison-bxl', label: 'Maison', lat: 50.8483, lon: 4.3497 }],
      favorites: [
        { kind: 'trip', id: 'fav-namur', from: { type: 'here' }, to: { type: 'place', placeId: 'maison' }, propose: 'evening' },
        { kind: 'trip', id: 'fav-retour', from: { type: 'here' }, to: { type: 'place', placeId: 'maison-bxl' }, propose: 'evening' },
        { kind: 'stop', id: 'fav-dl', areaId: 'delijn:308611', op: 'delijn', name: { fr: 'Bruxelles-Nord', nl: 'Brussel Noordstation', l: 'nl' }, lat: 50.86183, lon: 4.35906, propose: 'evening' },
      ],
    };
    // sans position : les trajets « ici » sont ignorés, l'arrêt favori est proposé
    const s = await core.suggest(null, evening);
    expect(s).toMatchObject({ favoriteId: 'fav-dl', autoOpen: false, title: 'Bruxelles-Nord : 232 Vilvorde ~0 min' });
    const nl = await core.suggest(null, { ...evening, lang: 'nl' });
    expect(nl?.title).toBe('Brussel Noordstation : 232 Vilvoorde ~0 min');
    // depuis la gare du Nord : pas de train vers Namur dans le mini-réseau, le tram vers la « maison » de Bruxelles
    const fromNorth = await core.suggest(POS.s2, evening);
    expect(fromNorth?.favoriteId).toBe('fav-retour');
    expect(fromNorth?.title).toMatch(/^Pour la maison : T[34] 16:0\d$/);
    expect(fromNorth?.subtitle).toMatch(/^partir à 16:0\d, 2 min à pied$/);
    for (const x of [s, nl, fromNorth]) {
      expect((x?.title ?? '').length).toBeLessThanOrEqual(48);
      expect((x?.subtitle ?? '').length).toBeLessThanOrEqual(48);
    }
  });

  it('libellé : « Bureau » saisi comme le lieu enregistré devient « Pour le bureau »', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const favs = preset.favorites.map((f) => (f.id === 'fav-bureau' && f.kind === 'trip' ? { ...f, label: 'Bureau' } : f));
    expect((await core.suggest(POS.s1, { ...preset, favorites: favs }))?.title).toBe('Pour le bureau : IC 07:42, voie 4');
    const noLabel = preset.favorites.map((f) => (f.id === 'fav-bureau' && f.kind === 'trip' ? { ...f, label: undefined } : f));
    expect((await core.suggest(POS.s1, { ...preset, favorites: noLabel }))?.title).toBe('Pour le bureau : IC 07:42, voie 4');
  });

  it('matin ou soir : rien si le premier départ est à plus de 3 heures', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T16:00', scene: 'noRT' });
    const late: Settings = {
      ...preset,
      favorites: [{ kind: 'trip', id: 'fav-x', from: { type: 'place', placeId: 'maison' }, to: { type: 'place', placeId: 'bureau' }, propose: 'evening' }],
    };
    // prochain train Namur → Bruxelles : demain 08:42
    expect(await core.suggest(POS.s1, late)).toBeNull();
  });
});

describe('dataFreshness', () => {
  const meta = (dates: string[], generatedAt = '2026-11-10T01:15:00.000Z'): Meta => ({
    v: 1,
    generatedAt,
    timezone: 'Europe/Brussels',
    serviceDates: dates,
    tile: { lat: 0.02, lon: 0.03 },
    feeds: {
      sncb: { ok: true, areas: 1, trips: 1 },
      stib: { ok: true, areas: 1, trips: 1 },
      delijn: { ok: true, areas: 1, trips: 1 },
      tec: { ok: true, areas: 1, trips: 1 },
    },
  });
  const m = meta(['2026-11-10', '2026-11-11']);

  it('date du jour couverte : ok', () => {
    expect(dataFreshness(m, at('2026-11-10T07:31'))).toEqual({ ok: true, ageHours: 5.3 });
  });

  it('lendemain : encore couvert, mais signale une mise à jour de nuit en retard après 06:00', () => {
    expect(dataFreshness(m, at('2026-11-11T03:00'))).toEqual({ ok: true, ageHours: 24.8 });
    const late = dataFreshness(m, at('2026-11-11T09:00'));
    expect(late.ok).toBe(true);
    expect(late.message).toBe('Horaires d’hier : mise à jour de nuit en retard');
  });

  it('tôt le matin (avant 04:00) : la date de la veille couvre encore la nuit', () => {
    expect(dataFreshness(m, at('2026-11-12T01:30')).ok).toBe(true);
    expect(dataFreshness(m, at('2026-11-12T04:30')).ok).toBe(false);
  });

  it('date non couverte : périmé, message court en français', () => {
    const f = dataFreshness(m, at('2026-11-13T10:00'));
    expect(f.ok).toBe(false);
    expect(f.ageHours).toBe(79.8);
    expect(f.message).toBe('Horaires périmés : mise à jour arrêtée le 11/11');
    const future = dataFreshness(meta(['2026-11-12', '2026-11-13']), at('2026-11-10T10:00'));
    expect(future).toMatchObject({ ok: false, message: 'Horaires du 12/11 : vérifie la date du téléphone' });
    const empty = dataFreshness(meta([]), at('2026-11-10T10:00'));
    expect(empty.ok).toBe(false);
    for (const x of [f, future, empty, dataFreshness(m, at('2026-11-11T09:00'))]) {
      expect((x.message ?? '').length).toBeLessThanOrEqual(48);
      expect(x.message).not.toContain('—');
    }
  });

  it('cœur : init() résout même périmé ; départs et trajets vides, sans exception', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-13T10:00' });
    const got = await core.init();
    expect(got.serviceDates).toEqual(['2026-11-10', '2026-11-11']);
    expect(dataFreshness(got, at('2026-11-13T10:00')).ok).toBe(false);
    const b = await core.board('stib:6357F');
    expect(b).toMatchObject({ departures: [], anyPlanned: false, rtErrors: [] });
    expect(b.area.n.fr).toBe('Gare du Nord');
    const unknown = await core.board('stib:0000');
    expect(unknown.departures).toEqual([]);
    const near = await core.nearby(50.86, 4.359, 500);
    expect(near.map((x) => x.area.id)).toEqual(['stib:6357F', 'sncb:8812005', 'delijn:308611', 'stib:6359']);
    expect(near.every((x) => x.next === undefined)).toBe(true);
    expect(await core.trains('sncb:8813003', 'sncb:8892007', at('2026-11-13T10:00'))).toEqual([]);
    expect(await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-13T10:00'), preset, POS.s1)).toEqual([]);
    expect(await core.suggest(POS.s2, preset)).toBeNull();
  });
});
