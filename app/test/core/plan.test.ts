/**
 * Trajets porte à porte (plan = route().journeys en 1.1) : scénario 1 Maison → Bureau, lignes urbaines directes,
 * ligne urbaine avant ou après le train, extrémités. Les propositions sont dans l'ordre d'affichage (PRD § 4.3).
 */
import { describe, expect, it } from 'vitest';
import type { FavoritePlace, Journey, Settings } from '../../src/core/api';
import { distanceM, hhmm, lineLabel, localDate, walkMinutes } from '../../src/core/util';
import { makeEnv } from './support/env';
import { at } from './support/network';

/** Réglages avec un favori lieu de plus (1.2 : un lieu est un favori, PRD-1.2 § 2.1). */
const withPlace = (s: Settings, id: string, label: string, lat: number, lon: number): Settings => ({
  ...s,
  favorites: [...s.favorites, { kind: 'place', id, label, lat, lon, propose: 'never' } satisfies FavoritePlace],
});

const MAISON = { lat: 50.4655, lon: 4.859 };
/** Textes comparés sans les espaces insécables (typographie française, core/text.ts). */
const nb = (s: string | undefined) => (s ?? '').replace(/\u00A0/g, ' ');

export function steps(j: Journey): string[] {
  return j.legs.map((l) =>
    l.kind === 'walk'
      ? `${hhmm(l.dep)} marche ${l.walkMin} min → ${l.to.name.fr}`
      : `${hhmm(l.dep)} ${l.cat ?? lineLabel(l.mode ?? 'bus', l.line ?? '')} ${l.from.name.fr} → ${l.to.name.fr} ${hhmm(l.arr)}${l.newPlatform ? ` voie ${l.newPlatform}` : l.platform ? ` voie ${l.platform}` : ''}${l.delayMin ? ` +${l.delayMin}` : ''}`,
  );
}

describe('plan : scénario 1, Maison → Bureau à 07:31', () => {
  it('sans temps réel : marche 7, IC 07:42 voie 4, Bruxelles-Nord 08:40, T3, marche 9, arrivée 08:58 ; le direct ensuite', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-10T07:31'), preset, MAISON);
    expect(js.length).toBeGreaterThanOrEqual(1);
    expect(js.length).toBeLessThanOrEqual(3);
    const j = js[0];
    // 1.2.1 (le moins de marche d'abord) : même IC et même arrivée que le direct, mais le T3 depuis Bruxelles-Nord
    // garde chaque marche sous les 10 min réglées (palier 0) ; le direct (12 min à pied, palier 1) suit
    expect(steps(j)).toEqual([
      '07:33 marche 7 min → Namur',
      '07:42 IC Namur → Bruxelles-Nord 08:40 voie 4',
      '08:40 marche 2 min → Gare du Nord',
      '08:44 T3 Gare du Nord → Bourse 08:49',
      '08:49 marche 9 min → Bureau',
    ]);
    expect(hhmm(j.leaveAt)).toBe('07:33');
    expect(hhmm(j.dep)).toBe('07:33');
    expect(hhmm(j.arr)).toBe('08:58');
    expect(j.transfers).toBe(1);
    expect(j.rt).toBe(false);
    expect(j.legs[1]).toMatchObject({ cat: 'IC', num: '2112', head: { fr: 'Bruxelles-Midi' } });
    expect(j.legs[0].from.name.fr).toBe('Ma position');
    // propositions étiquetées : la proposition 1, le direct « Sans changement » (même arrivée), puis le suivant
    expect(js.map((x) => x.label)).toEqual(['short', 'none', 'next']);
    expect(steps(js[1])).toEqual(['07:33 marche 7 min → Namur', '07:42 IC Namur → Bruxelles-Central 08:46 voie 4', '08:46 marche 12 min → Bureau']);
    expect(hhmm(js[1].arr)).toBe('08:58');
    expect(js[2].dep).toBeGreaterThan(js[0].dep);
  });

  it('avec temps réel : IC 07:44 voie 6, Bruxelles-Nord 08:42, T3 08:44, arrivée 08:58, alerte de voie en tête', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-10T07:31'), preset, MAISON);
    const j = js[0];
    // 1.2.1 : avec 2 min de retard, le T3 de 08:44 reste attrapable ; le direct (09:00, palier plus haut, plus tard)
    // n'est plus proposé
    expect(steps(j)).toEqual([
      '07:35 marche 7 min → Namur',
      '07:44 IC Namur → Bruxelles-Nord 08:42 voie 6 +2',
      '08:42 marche 2 min → Gare du Nord',
      '08:44 T3 Gare du Nord → Bourse 08:49',
      '08:49 marche 9 min → Bureau',
    ]);
    expect(hhmm(j.leaveAt)).toBe('07:35');
    expect(hhmm(j.arr)).toBe('08:58');
    expect({ ...j.alerts[0], text: nb(j.alerts[0]?.text) }).toMatchObject({ kind: 'platform', text: '! Voie modifiée : l’IC part de la voie 6' });
    expect(j.legs[1].stops?.map((s) => `${s.name.fr} ${hhmm(s.est)}`)).toEqual([
      'Namur 07:44',
      'Gembloux 07:57',
      'Ottignies 08:11',
      'Bruxelles-Luxembourg 08:33',
      'Bruxelles-Schuman 08:37',
      'Bruxelles-Nord 08:42',
    ]);
    expect(js.some((x) => x.label === 'none')).toBe(false);
  });

  it('extrémités : lieu inconnu (erreur lisible), position absente (aucun trajet, route : noPosition)', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    await expect(core.plan({ type: 'here' }, { type: 'place', placeId: 'nulle-part' }, at('2026-11-10T07:31'), preset, MAISON)).rejects.toThrow('Lieu introuvable');
    expect(await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-10T07:31'), preset)).toEqual([]);
    expect(await core.route({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-10T07:31'), preset)).toEqual({ journeys: [], empty: 'noPosition' });
  });

  it('gare → gare (favori fav-gand) : les trains, sans marche', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    const fav = preset.favorites.find((f) => f.id === 'fav-gand');
    if (fav?.kind !== 'trip') throw new Error('preset');
    const js = await core.plan(fav.from, fav.to, at('2026-11-10T13:55'), preset);
    expect(js.map((j) => steps(j).join(' | '))).toEqual([
      '14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 voie 4',
      '14:25 IC Bruxelles-Central → Gand-Saint-Pierre 14:56 voie 6 +3',
      '14:40 IC Bruxelles-Central → Gand-Saint-Pierre 15:09 voie 4',
    ]);
    expect(js.map((j) => j.label)).toEqual(['short', 'next', 'next']);
    expect(hhmm(js[0].leaveAt)).toBe('14:08');
  });
});

describe('plan : lignes urbaines', () => {
  it('ligne directe : de la gare du Nord (position) à la Bourse (lieu) en T3/T4', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T12:10' });
    const settings = withPlace(preset, 'bourse', 'Bourse', 50.8483, 4.3497);
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bourse' }, at('2026-11-10T12:10'), settings, { lat: 50.86, lon: 4.359 });
    expect(js.length).toBeGreaterThan(0);
    const j = js[0];
    const ride = j.legs.find((l) => l.kind === 'ride');
    expect(ride).toMatchObject({ op: 'stib', to: { areaId: 'stib:6362' } });
    expect(['3', '4']).toContain(ride?.line);
    expect(ride?.rt).toBe(true);
    expect(j.legs[0]).toMatchObject({ kind: 'walk', walkMin: 2 });
    // le lieu est à l'arrêt même (moins de 25 m) : pas de marche à la fin
    expect(j.legs[j.legs.length - 1]).toMatchObject({ kind: 'ride', to: { areaId: 'stib:6362' } });
    // premier tram en direct : T3 Churchill 12:12 → Bourse 12:17 (temps réel STIB du point 6357)
    expect(steps(j)[1]).toBe('12:12 T3 Gare du Nord → Bourse 12:17');
    expect(ride).toMatchObject({ fromStop: '6357', toStop: '6362' });
    expect(ride?.stops?.map((s) => s.name.fr)).toEqual(['Gare du Nord', 'Rogier', 'De Brouckere', 'Bourse']);
  });

  it('train puis ligne urbaine quand la gare d’arrivée est trop loin à pied', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const settings = withPlace({ ...preset, maxWalkMin: 5 }, 'bourse', 'Bourse', 50.8483, 4.3497);
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bourse' }, at('2026-11-10T07:31'), settings, MAISON);
    const withTram = js.find((j) => j.legs.some((l) => l.kind === 'ride' && l.op === 'stib'));
    expect(withTram, JSON.stringify(js.map(steps))).toBeDefined();
    if (!withTram) return;
    expect(steps(withTram)).toEqual([
      '07:33 marche 7 min → Namur',
      '07:42 IC Namur → Bruxelles-Nord 08:40 voie 4',
      '08:40 marche 2 min → Gare du Nord',
      '08:44 T3 Gare du Nord → Bourse 08:49',
    ]);
    expect(withTram.transfers).toBe(1);
    expect(withTram.label).toBe('short');
    expect(hhmm(withTram.arr)).toBe('08:49');
  });

  it('ligne urbaine pour rejoindre une gare trop loin à pied, puis le train', async () => {
    // Depuis la Bourse, marche maximale 5 min : Bruxelles-Central est à 10 min (palier 1 : 5 min de plus que la
    // préférence), le T4 rejoint Bruxelles-Midi pour le même IC vers Gand : même arrivée, il passe d'abord.
    const { core, preset } = makeEnv({ now: '2026-11-10T13:30', scene: 'noRT' });
    const settings = withPlace({ ...preset, maxWalkMin: 5 }, 'gand', 'Gand', 51.0359, 3.7107);
    const bourse = { lat: 50.8483, lon: 4.3497 };
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'gand' }, at('2026-11-10T13:30'), settings, bourse);
    expect(steps(js[0])).toEqual(['14:04 T4 Bourse → Gare du Midi 14:09', '14:09 marche 1 min → Bruxelles-Midi', '14:14 IC Bruxelles-Midi → Gand-Saint-Pierre 14:39 voie 12']);
    expect(js[0]).toMatchObject({ label: 'short', transfers: 1 });
    // la marche de 10 min jusqu'à Bruxelles-Central pour le même IC : sans changement, même arrivée (PRD-1.2 § 1.3)
    expect(js[1]).toMatchObject({ label: 'none', reason: 'Sans changement\u00A0: à pied 10\u00A0min' });
    expect(steps(js[1])).toEqual(['13:58 marche 10 min → Bruxelles-Central', '14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 voie 4']);
  });
});

/** Identité d'un trajet : voyages + zones de montée et de descente (sans la date). */
const identity = (j: Journey) =>
  j.legs
    .filter((l) => l.kind === 'ride')
    .map((l) => `${l.tripId ?? `${l.line}@${hhmm(l.schedDep)}`}:${l.from.areaId}>${l.to.areaId}`)
    .join('|');

describe('plan : régression « propositions en double »', () => {
  it('scénario 1 : une seule proposition par train (l’IC 08:42 du 10 et du 11 ne sont pas deux propositions)', async () => {
    for (const scene of ['noRT', 'base'] as const) {
      const { core, preset } = makeEnv({ now: '2026-11-10T07:31', scene });
      const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-10T07:31'), preset, MAISON);
      expect(new Set(js.map(identity)).size).toBe(js.length);
      expect(js.every((j) => j.dep < at('2026-11-10T07:31') + 23 * 3_600_000)).toBe(true);
      // 1.2.1 : un même train peut servir deux propositions distinctes (avec le T3 et direct), jamais deux fois le même
      // trajet ; noRT : le direct « Sans changement » ; base : il arrive 2 min plus tard, l'IC 08:42 direct « Plus tard »
      expect(js.map((j) => `${localDate(j.dep)} ${hhmm(j.legs[1].schedDep)} ${j.label}`)).toEqual(
        scene === 'noRT'
          ? ['2026-11-10 07:42 short', '2026-11-10 07:42 none', '2026-11-10 08:42 next']
          : ['2026-11-10 07:42 short', '2026-11-10 08:42 next', '2026-11-10 08:42 later'],
      );
    }
  });
});

describe('plan : régression « train pour aller à pied »', () => {
  const near = (s: Settings, lat: number, lon: number): Settings => withPlace(s, 'proche', 'Proche', lat, lon);

  it('départ et arrivée au même endroit (ou à moins de 300 m) : aucun trajet (route : here)', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    expect(await core.plan({ type: 'here' }, { type: 'place', placeId: 'maison' }, at('2026-11-10T07:31'), preset, MAISON)).toEqual([]);
    const s = near(preset, 50.4659, 4.8594);
    expect(await core.plan({ type: 'here' }, { type: 'place', placeId: 'proche' }, at('2026-11-10T07:31'), s, MAISON)).toEqual([]);
    const fav = preset.favorites.find((f) => f.id === 'fav-gand');
    if (fav?.kind !== 'trip') throw new Error('preset');
    expect(await core.plan(fav.from, fav.from, at('2026-11-10T13:55'), preset)).toEqual([]);
  });

  it('destination à distance de marche : une seule étape à pied, aucun véhicule', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T07:31' });
    const s = near(preset, 50.4685, 4.8625); // la gare de Namur, à 7 min
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'proche' }, at('2026-11-10T07:31'), s, MAISON);
    expect(js).toHaveLength(1);
    expect(js[0].legs).toHaveLength(1);
    expect(js[0].legs[0]).toMatchObject({ kind: 'walk', walkMin: 7, to: { name: { fr: 'Proche' } } });
    expect(js[0]).toMatchObject({ transfers: 0, rt: true, alerts: [], label: 'short' });
    expect(js[0].reason).toBe('Le plus court\u00A0: à pied, 7\u00A0min');
    expect([hhmm(js[0].dep), hhmm(js[0].arr), hhmm(js[0].leaveAt)]).toEqual(['07:31', '07:38', '07:31']);
    // refresh() garde la marche telle quelle
    const r = await core.refresh(js[0], s);
    expect(r.legs).toHaveLength(1);
    expect(r.id).toBe(js[0].id);
  });

  it('marche au-delà de maxWalkMin mais plus rapide que tout véhicule : la marche seule (pas de train vers Midi)', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T13:55' });
    const central = { lat: 50.8454, lon: 4.3571 };
    const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, at('2026-11-10T13:55'), preset, central);
    expect(js.map(steps)).toEqual([['13:55 marche 12 min → Bureau']]);
    const s = await core.suggest(central, { ...preset, favorites: [{ kind: 'trip', id: 'f', from: { type: 'here' }, to: { type: 'place', placeId: 'bureau' }, label: 'bureau', propose: 'never' }], display: { ...preset.display, opening: 'firstFavorite' } });
    expect([nb(s?.title), nb(s?.subtitle)]).toEqual(['Pour le bureau : à pied, 12 min', 'arrivée à 14:07']);
  });

  it('jamais un véhicule plus lent que la marche directe', async () => {
    const { core, preset } = makeEnv({ now: '2026-11-10T12:10' });
    const cases: [number, number, number, number][] = [
      [50.86, 4.359, 50.8483, 4.3497], // gare du Nord → Bourse (19 min à pied)
      [50.8569, 4.35889, 50.8357, 4.3363], // Rogier → Midi
      [50.8454, 4.3571, 50.8605, 4.3612], // Central → Nord
      [50.4655, 4.859, 50.4685, 4.8625], // Maison → gare de Namur
    ];
    for (const [a, b, c, d] of cases) {
      const s = withPlace({ ...preset, maxWalkMin: 5 }, 'x', 'X', c, d);
      const after = at('2026-11-10T12:10');
      const walk = walkMinutes(distanceM({ lat: a, lon: b }, { lat: c, lon: d }));
      const js = await core.plan({ type: 'here' }, { type: 'place', placeId: 'x' }, after, s, { lat: a, lon: b });
      expect(js.length, `${a},${b} → ${c},${d}`).toBeGreaterThan(0);
      for (const j of js) {
        if (j.legs.some((l) => l.kind === 'ride')) expect(j.legs[j.legs.length - 1].schedArr, steps(j).join(' | ')).toBeLessThanOrEqual(after + walk * 60_000);
      }
    }
  });
});

