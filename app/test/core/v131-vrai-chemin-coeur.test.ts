/**
 * Quai 1.3.1, décision du propriétaire du 20/11 à 21:59 : « 7h12 partout ». L'heure de partir, les minutes de la première
 * marche et la marge sont celles du vrai chemin à pied, portées par le trajet lui-même (core/firstwalk.ts). Ici le vrai
 * cœur (calcul des trajets, favoris, temps réel, tuiles piétonnes au vrai format) sur le mini-réseau commun : une règle
 * par test. Les écrans (lunettes, téléphone, guidage) : test/glasses/v131-vrai-chemin.test.ts et
 * test/phone/v131-vrai-chemin.test.ts. Scène : vrai-chemin-scene.ts (arrêt Esplanade, tram 3 de 07:20, la Bourse).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Core, FavoritePlace, FavoriteTrip, Journey, LatLon, Leg, Settings } from '../../src/core/api';
import { FIRST_WALK, FirstWalks } from '../../src/core/firstwalk';
import { createCore } from '../../src/core/index';
import { hhmm } from '../../src/core/util';
import { DATA_BASE, FakeServer, MemoryKV, RELAY_BASE } from './support/env';
import { at, BOURSE, ESPLANADE, MIN, offset, scene, settle, START, TILE, VERSION, type PathKind } from './vrai-chemin-scene';

const TO = { type: 'place' as const, placeId: 'bourse' };
const HERE = { type: 'here' as const };

/** Un cœur à l'heure `hm` (horloge réglable). */
function world(path: PathKind | null, hm: string, patch: Partial<Settings> = {}) {
  const sc = scene(path);
  const clock = { t: at(hm) };
  const core = sc.core(() => clock.t);
  const s = sc.settings(patch);
  const route = (c: Core = core, here = START) => c.route(HERE, TO, clock.t, s, here);
  return { sc, clock, core, s, route };
}

/** Ce que les écrans lisent d'un trajet. */
const read = (j: Journey) => ({
  leave: hhmm(j.leaveAt),
  walk: j.legs[0].walkMin,
  est: j.legs[0].walkEst,
  walkAt: `${hhmm(j.legs[0].dep)}-${hhmm(j.legs[0].arr)}`,
  ride: `${j.legs[1].line} ${hhmm(j.legs[1].dep)}`,
  margin: Math.round((j.legs[1].dep - j.leaveAt) / MIN) - (j.legs[0].walkMin ?? 0),
});

afterEach(() => vi.restoreAllMocks());

describe('l’exemple du propriétaire : 3 min estimées, vrai chemin de 446 m (6 min), tram à 07:20', () => {
  it('sans tuiles piétonnes : l’estimation, exactement la 1.3.0 (partir à 07:15, 3 min, aucun champ nouveau)', async () => {
    const w = world(null, '07:10');
    const r = await w.route();
    expect(read(r.journeys[0])).toEqual({ leave: '07:15', walk: 3, est: undefined, walkAt: '07:15-07:18', ride: '3 07:20', margin: 2 });
    expect(r.journeys.every((j) => j.legs.every((l) => !('walkEst' in l)))).toBe(true);
    // rien d'autre qu'une demande de l'index des chemins à pied (absent : 404), aucune tuile
    expect(w.sc.walkCalls()).toEqual(['walk/index.json']);
  });

  it('avec le vrai chemin : partir à 07:12, 6 min à pied (estimation gardée : 3), la marche de 07:12 à 07:18, la marge du réglage (2 min)', async () => {
    const w = world('long', '07:10');
    const r = await w.route();
    expect(read(r.journeys[0])).toEqual({ leave: '07:12', walk: 6, est: 3, walkAt: '07:12-07:18', ride: '3 07:20', margin: 2 });
    expect(hhmm(r.journeys[0].dep)).toBe('07:12');
    // les propositions suivantes partent du même endroit vers le même arrêt : même chemin, même correction
    expect(r.journeys.slice(1).map((j) => read(j).walk)).toEqual(r.journeys.slice(1).map(() => 6));
    // le reste du trajet est celui de l'estimation, à l'identique (arrivée, véhicules, dernière marche : règle 7)
    const base = (await world(null, '07:10').route()).journeys;
    expect(r.journeys.map((j) => j.id)).toEqual(base.map((j) => j.id));
    expect(r.journeys.map((j) => j.label)).toEqual(base.map((j) => j.label));
    r.journeys.forEach((j, i) => {
      expect(j.legs.slice(1)).toEqual(base[i].legs.slice(1));
      expect(j.arr).toBe(base[i].arr);
    });
  });

  it('une seule source : route, favori (answer), refresh, firstWalk et suggestion disent 07:12 ; appliquée deux fois, la correction ne s’empile pas', async () => {
    const w = world('long', '07:10');
    const j = (await w.route()).journeys[0];
    const a = await w.core.answer(BOURSE, START, w.s);
    expect(read(a.plan!.journeys[0])).toMatchObject({ leave: '07:12', walk: 6, est: 3 });
    const again = await w.core.refresh(j, w.s);
    expect(read(again)).toMatchObject({ leave: '07:12', walk: 6, est: 3, walkAt: '07:12-07:18' });
    expect(read(await w.core.refresh(again, w.s, { followed: true }))).toMatchObject({ leave: '07:12', walk: 6, est: 3 });
    expect(w.core.firstWalk!(again, w.s)).toBe(again);
    // un plan mémorisé du favori (temps réel seul, 30 s plus tard) : toujours 07:12
    w.clock.t += 30_000;
    expect(read((await w.core.answer(BOURSE, START, w.s)).plan!.journeys[0])).toMatchObject({ leave: '07:12', walk: 6, est: 3 });
  });
});

describe('contrôle : la pluie suit les vraies minutes, pareil dans la recherche et dans le favori', () => {
  /** Grille du relais : pluie partout, pendant 6 h (format de core/weather.ts). */
  const wet = (now: number) => ({
    lat0: 49.5,
    lon0: 2.55,
    step: 0.25,
    rows: 9,
    cols: 16,
    t0: Math.floor(now / 900_000) * 900 + 900,
    h0: Math.floor(now / 3_600_000) * 3600 + 3600,
    rain: Array.from({ length: 144 }, () => Array<number>(24).fill(10)),
    prob: Array.from({ length: 144 }, () => Array<number>(7).fill(100)),
    fetchedAt: '2026-11-10T06:00:00Z',
  });
  const rains = (j: Journey) => `${j.legs[0].walkMin} min${j.legs[0].rain ? ', pluie' : ''}`;

  it('3 min estimées (pas de marque sous 5 min), 6 min par le vrai chemin : marche sous la pluie, dans route() comme dans le favori ; sans tuiles : comme en 1.3.0', async () => {
    const w = world('long', '07:10');
    w.sc.server.overrides.set('/api/weather', () => new Response(JSON.stringify(wet(w.clock.t)), { status: 200 }));
    expect(rains((await w.route()).journeys[0])).toBe('6 min, pluie');
    expect(rains((await w.core.answer(BOURSE, START, w.s)).plan!.journeys[0])).toBe('6 min, pluie');
    const base = world(null, '07:10');
    base.sc.server.overrides.set('/api/weather', () => new Response(JSON.stringify(wet(base.clock.t)), { status: 200 }));
    expect(rains((await base.route()).journeys[0])).toBe('3 min');
    expect(rains((await base.core.answer(BOURSE, START, base.s)).plan!.journeys[0])).toBe('3 min');
  });
});

describe('règle 3 : personne n’attend le chemin', () => {
  it('tuile lente : le trajet sort tout de suite avec l’estimation (0,1 s d’attente au plus) ; chemin connu : un signal, puis 07:12 partout, une seule fois', async () => {
    const w = world('long', '07:10');
    w.sc.hold();
    let news = 0;
    w.core.onFirstWalk!(() => news++);
    const t0 = performance.now();
    const r0 = await w.route();
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(read(r0.journeys[0])).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
    // refresh et favori pendant que la tuile charge : l'estimation, sans rien demander de plus
    expect(read(await w.core.refresh(r0.journeys[0], w.s))).toMatchObject({ leave: '07:15', walk: 3 });
    expect(read((await w.core.answer(BOURSE, START, w.s)).plan!.journeys[0])).toMatchObject({ leave: '07:15', walk: 3 });
    expect(w.core.firstWalk!(r0.journeys[0], w.s)).toBe(r0.journeys[0]);
    expect(news).toBe(0);
    expect(w.sc.walkCalls().filter((u) => u.includes(TILE))).toHaveLength(1);
    // la tuile arrive
    w.sc.release();
    await settle(60);
    expect(news).toBe(1);
    const fixed = w.core.firstWalk!(r0.journeys[0], w.s);
    expect(read(fixed)).toMatchObject({ leave: '07:12', walk: 6, est: 3, walkAt: '07:12-07:18' });
    expect(read(await w.core.refresh(r0.journeys[0], w.s))).toMatchObject({ leave: '07:12', walk: 6 });
    expect(read((await w.core.answer(BOURSE, START, w.s)).plan!.journeys[0])).toMatchObject({ leave: '07:12', walk: 6 });
    expect(read((await w.route()).journeys[0])).toMatchObject({ leave: '07:12', walk: 6 });
    // l'heure ne recule jamais ensuite, et rien ne saute une deuxième fois
    await settle(60);
    expect(news).toBe(1);
    expect(read(await w.core.refresh(fixed, w.s))).toMatchObject({ leave: '07:12', walk: 6 });
  });

  it('contrôle : tuile qui ne répond pas : seul le premier appel attend 0,1 s ; les trajets, favoris et rafraîchissements suivants sortent sans attendre, avec l’estimation', async () => {
    const w = world('long', '07:10');
    w.sc.hold();
    const r0 = await w.route();
    // 12 appels pendant que la tuile charge : avec 0,1 s d'attente par appel, ils prendraient plus de 1,2 s
    const t0 = performance.now();
    for (let i = 0; i < 4; i++) {
      expect(read((await w.route()).journeys[0])).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
      expect(read((await w.core.answer(BOURSE, START, w.s)).plan!.journeys[0])).toMatchObject({ leave: '07:15', walk: 3 });
      expect(read(await w.core.refresh(r0.journeys[0], w.s))).toMatchObject({ leave: '07:15', walk: 3 });
    }
    expect(performance.now() - t0).toBeLessThan(900);
    expect(w.sc.walkCalls().filter((u) => u.includes(TILE))).toHaveLength(1);
    // la tuile arrive enfin : 07:12, comme si elle n'avait pas tardé
    w.sc.release();
    await settle(60);
    expect(read((await w.route()).journeys[0])).toMatchObject({ leave: '07:12', walk: 6, est: 3 });
  });

  it('contrôle : l’attente se compte depuis le début du calcul du chemin (0,1 s), pas depuis chaque appel', async () => {
    const mono = { t: 0 };
    let done: (() => void) | undefined;
    const fw = new FirstWalks(() => new Promise((r) => (done = () => r(null))), { now: () => at('07:10'), mono: () => mono.t });
    const legs = (await world(null, '07:10').route()).journeys[0].legs;
    const state = (p: Promise<void>, ms: number) => Promise.race([p.then(() => 'rendu'), new Promise<string>((r) => setTimeout(() => r('attend'), ms))]);
    // rien en cours : tout de suite
    expect(await state(fw.settle(), 20)).toBe('rendu');
    fw.ask([{ legs }], {});
    // calcul commencé à l'instant : on l'attend (ici plus de 30 ms), 0,1 s au plus
    const first = fw.settle();
    expect(await state(first, 30)).toBe('attend');
    expect(await state(first, 400)).toBe('rendu');
    // 60 ms après le début du calcul : il reste 40 ms à attendre, pas 100
    mono.t = 60;
    const t0 = performance.now();
    await fw.settle();
    expect(performance.now() - t0).toBeLessThan(95);
    // 0,1 s après le début du calcul : plus personne n'attend, tant que la tuile charge
    mono.t = 100;
    expect(await state(fw.settle(), 20)).toBe('rendu');
    mono.t = 20_000;
    expect(await state(fw.settle(), 20)).toBe('rendu');
    done?.();
  });

  it('réseau coupé pour la tuile : l’estimation partout ; pas redemandée avant 2 min ; puis le chemin, et 07:12', async () => {
    const w = world('long', '07:10');
    w.sc.fail(true);
    const r0 = await w.route();
    expect(read(r0.journeys[0])).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
    const tiles = () => w.sc.walkCalls().filter((u) => u.includes(TILE)).length;
    const n = tiles();
    w.clock.t += 60_000;
    expect(read(await w.core.refresh(r0.journeys[0], w.s))).toMatchObject({ leave: '07:15', walk: 3 });
    expect(tiles()).toBe(n);
    // le réseau revient ; 2 min après l'échec, le rafraîchissement du trajet redemande le chemin
    w.sc.fail(false);
    w.clock.t += FIRST_WALK.retryMs;
    const again = await w.core.refresh(r0.journeys[0], w.s);
    expect(tiles()).toBeGreaterThan(n);
    expect(read(again)).toMatchObject({ leave: '07:12', walk: 6, est: 3 });
  });

  it('pas de vrai chemin (aucune voie à 100 m du départ : chemin droit) ou chemin pas plus long : rien ne change', async () => {
    for (const kind of ['elsewhere', 'short'] as const) {
      const w = world(kind, '07:10');
      const r = await w.route();
      await settle();
      expect(read(r.journeys[0]), kind).toEqual({ leave: '07:15', walk: 3, est: undefined, walkAt: '07:15-07:18', ride: '3 07:20', margin: 2 });
      expect(read(await w.core.refresh(r.journeys[0], w.s)), kind).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
      expect(r).toEqual(await world(null, '07:10').route());
    }
  });

  it('un chemin connu ne vaut que pour son départ (40 m) : parti de 60 m plus loin, un autre chemin est demandé', async () => {
    const w = world('long', '07:10');
    await w.route();
    const n = w.sc.walkCalls().length;
    // à 20 m : le même chemin sert (aucune demande, aucune tuile), la correction est là tout de suite
    const near = await w.route(w.core, offset(START, 0, -20));
    expect(near.journeys[0].legs[0].walkEst).toBeDefined();
    expect(w.sc.walkCalls()).toHaveLength(n);
    // jamais plus tard que l'estimation, quel que soit le point de départ
    for (const j of near.journeys) expect(j.legs[0].walkMin!).toBeGreaterThanOrEqual(j.legs[0].walkEst!);
    expect(near.journeys[0].legs[0]).toMatchObject({ walkMin: 6, walkEst: 4 });
    // à 60 m (240 m de l'arrêt, 4 min estimées) : le chemin de 07:12 ne sert pas ; celui d'ici est calculé (60 m jusqu'à
    // la rue, puis les 446 m : 7 min), dans les tuiles déjà en mémoire
    const far = await w.route(w.core, offset(START, 0, -60));
    expect(far.journeys[0].legs[0]).toMatchObject({ walkMin: 7, walkEst: 4 });
    expect(w.sc.walkCalls()).toHaveLength(n);
  });
});

describe('règles 1 et 2 : jamais plus tard, 5 min d’avance au plus', () => {
  it('vrai chemin plus court que l’estimation (130 m tout droit, 2 min pour 3 estimées) : l’heure de partir ne recule pas', async () => {
    const sc = scene('short');
    const clock = { t: at('07:10') };
    const core = sc.core(() => clock.t);
    const s = sc.settings();
    const here = offset(ESPLANADE, 0, -130);
    const j = (await core.route(HERE, TO, clock.t, s, here)).journeys[0];
    await settle();
    expect(read(j)).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
    expect(read(await core.refresh(j, s))).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
  });

  it('vrai chemin de 1 000 m (13 min pour 3 estimées) : 5 min d’avance, pas 10 (partir à 07:10) ; noté au journal technique, rien à l’écran', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = world('huge', '07:05');
    const r = await w.route();
    const j = r.journeys.find((x) => hhmm(x.legs[1].dep) === '07:20')!;
    expect(read(j)).toMatchObject({ leave: '07:10', walk: 8, est: 3, walkAt: '07:10-07:18', margin: 2 });
    // appliquée encore (refresh, firstWalk) : toujours 8 min, jamais 13
    expect(read(await w.core.refresh(j, w.s))).toMatchObject({ leave: '07:10', walk: 8, est: 3 });
    expect(w.core.firstWalk!(j, w.s)).toBe(j);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((t) => t.includes('première marche'));
    expect(lines).toEqual(['[Quai] première marche : vrai chemin de 13 min pour 3 min prévues, avance limitée à 5 min']);
    // rien à l'écran : aucune alerte du trajet n'en parle
    expect(JSON.stringify(r.journeys.map((x) => x.alerts))).not.toMatch(/chemin|limit/);
  });
});

describe('règles 4 et 5 : heure déjà passée, classement', () => {
  it('07:13 : il fallait partir à 07:12 ; le trajet reste le premier, heure de partir passée, encore attrapable (comme en 1.3.0 dans la marge)', async () => {
    const w = world('long', '07:13');
    const r = await w.route();
    expect(read(r.journeys[0])).toMatchObject({ leave: '07:12', walk: 6, ride: '3 07:20' });
    // l'alerte « partir » de la 1.3.0, avec les vraies minutes
    expect(r.journeys[0].alerts.map((a) => a.kind)).toContain('leave');
    expect(r.journeys[0].alerts.find((a) => a.kind === 'leave')!.text).toContain('6');
  });

  it('07:15 : le tram de 07:20 ne peut plus être attrapé par le vrai chemin (6 min) : comme un départ raté, le suivant vient à sa place (07:28, partir à 07:20)', async () => {
    // la 1.3.0 (estimation) le propose encore : « partir maintenant », pour un tram qu'on rate
    const old = await world(null, '07:15').route();
    expect(read(old.journeys[0])).toMatchObject({ leave: '07:15', walk: 3, ride: '3 07:20' });
    const w = world('long', '07:15');
    const r = await w.route();
    expect(read(r.journeys[0])).toMatchObject({ leave: '07:20', walk: 6, ride: '3 07:28' });
    expect(r.journeys.some((j) => hhmm(j.legs[1].dep) === '07:20')).toBe(false);
    // les propositions restantes sont celles de l'estimation, dans le même ordre, sans le départ raté
    const kept = old.journeys.slice(1).map((j) => j.id);
    expect(r.journeys.map((j) => j.id).slice(0, kept.length)).toEqual(kept);
    // le favori dit la même chose
    expect(read((await w.core.answer(BOURSE, START, w.s)).plan!.journeys[0])).toMatchObject({ leave: '07:20', ride: '3 07:28' });
  });

  it('chemin connu trop tard (07:15, tuile lente) : le trajet montré garde sa place et dit 07:12 (heure passée) ; un nouveau calcul donne le suivant', async () => {
    const w = world('long', '07:15');
    w.sc.hold();
    const r0 = await w.route();
    expect(read(r0.journeys[0])).toMatchObject({ leave: '07:15', ride: '3 07:20' });
    w.sc.release();
    await settle(60);
    // le trajet déjà à l'écran : même trajet, heure de partir passée (l'écran du trajet le garde, comme en 1.3.0)
    const shown = await w.core.refresh(r0.journeys[0], w.s);
    expect(shown.id).toBe(r0.journeys[0].id);
    expect(read(shown)).toMatchObject({ leave: '07:12', walk: 6, ride: '3 07:20', walkAt: '07:12-07:18' });
    // le favori (plan mémorisé) : son premier véhicule n'est plus attrapable, il est recalculé : le suivant
    const a = await w.core.answer(BOURSE, START, w.s);
    expect(read(a.plan!.journeys[0])).toMatchObject({ ride: '3 07:28', leave: '07:20' });
  });

  it('le classement ne dépend pas des chemins connus : mêmes propositions, même ordre, mêmes étiquettes qu’avec l’estimation, à chaque minute de 07:00 à 07:30', async () => {
    const known = scene('long');
    const none = scene(null);
    const clock = { t: at('07:00') };
    const a = known.core(() => clock.t);
    const b = none.core(() => clock.t);
    const s = known.settings();
    let dropped = 0;
    for (let t = at('07:00'); t <= at('07:30'); t += MIN) {
      clock.t = t;
      const ra = (await a.route(HERE, TO, t, s, START)).journeys;
      const rb = (await b.route(HERE, TO, t, s, START)).journeys;
      const hm = hhmm(t);
      // un départ que l'estimation croit attrapable et que le vrai chemin (3 min de plus) dit raté : écarté, rien d'autre
      const lost = rb.filter((j) => j.legs[1].dep - 6 * MIN < t);
      dropped += lost.length;
      const kept = rb.filter((j) => !lost.includes(j)).map((j) => j.id);
      expect(ra.map((j) => j.id).slice(0, kept.length), hm).toEqual(kept);
      for (const j of ra) {
        expect(j.legs[1].dep - (j.legs[0].walkMin ?? 0) * MIN, hm).toBeGreaterThanOrEqual(t);
        expect(j.leaveAt, hm).toBeLessThanOrEqual(rb.find((x) => x.id === j.id)?.leaveAt ?? Infinity);
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });
});

describe('contrôle : deux gardes que les tests ne tenaient pas (mutation)', () => {
  it('décidé une fois par trajet : un autre chemin connu ensuite, plus près du départ et plus long, ne fait pas sauter l’heure une deuxième fois', async () => {
    // chemins donnés à la main : 446 m (6 min) depuis un point à 35 m du départ, 560 m (7 min) depuis un point à 10 m
    const far = offset(START, -35, 0);
    const near = offset(START, 10, 0);
    const lengths = new Map<string, number>([[`${far.lat},${far.lon}`, 446], [`${near.lat},${near.lon}`, 560]]);
    const fw = new FirstWalks(
      async (from, to) => ({ source: 'osm', lengthM: lengths.get(`${from.lat},${from.lon}`) ?? 0, from, to, coords: [from, to], maneuvers: [], at: 0 }) as never,
      { now: () => at('07:10') },
    );
    const base = (await world(null, '07:10').route()).journeys[0].legs;
    const from = (p: LatLon): Leg[] => base.map((l, i) => (i === 0 ? { ...l, from: { ...l.from, ...p }, to: { ...l.to } } : { ...l }));
    fw.ask([{ legs: from(far) }], {});
    await fw.settle();
    // le trajet parti du départ prend le chemin connu à 35 m : 6 min pour 3 estimées
    const legs = from(START);
    expect(fw.apply(legs, {})).toBe(3);
    expect(legs[0]).toMatchObject({ walkMin: 6, walkEst: 3 });
    // un second chemin est connu, à 10 m du départ : 7 min ; un nouveau trajet le prend…
    fw.ask([{ legs: from(near) }], {});
    await fw.settle();
    const fresh = from(START);
    fw.apply(fresh, {});
    expect(fresh[0]).toMatchObject({ walkMin: 7, walkEst: 3 });
    // … le trajet déjà décidé ne bouge plus : toujours 6 min, la même heure de partir
    const dep = legs[0].dep;
    expect(fw.apply(legs, {})).toBe(0);
    expect(fw.extra(legs, {})).toBe(0);
    expect(legs[0]).toMatchObject({ walkMin: 6, walkEst: 3, dep });
  });

  it('calcul des trajets : un premier départ impossible par le vrai chemin donne exactement la liste de la 1.3.0 une fois ce départ parti (gare du Nord, trams 3 et 4 vers la Bourse)', async () => {
    // extrait de test du dépôt (walk-data/fixtures) ; départ à 150 m à l'est de la rue du Progrès : l'arrêt Rogier est à
    // 5 min d'après l'estimation, à plus de 10 min par le vrai chemin (5 min d'avance, le plafond)
    const dir = join(__dirname, 'walk-data', 'fixtures');
    const here = offset({ lat: 50.8582, lon: 4.36 }, 150, 0);
    const bourse: FavoritePlace = { ...BOURSE };
    const central: FavoritePlace = { kind: 'place', id: 'central', label: 'Gare Centrale', lat: 50.8454, lon: 4.3571, propose: 'never' };
    const make = (tiles: boolean) => {
      const server = new FakeServer();
      server.scene = 'noRT';
      if (tiles) for (const f of ['index', '2542_144', '2542_145', '2543_145']) server.overrides.set(`/quai/data/walk/${f}.json`, () => new Response(readFileSync(join(dir, `${f}.json`), 'utf8'), { status: 200 }));
      const clock = { t: at('09:00') };
      const core = createCore({ dataBase: DATA_BASE, relayBase: RELAY_BASE, now: () => clock.t, storage: new MemoryKV(), fetch: server.fetch });
      const s = { ...scene(null).settings(), favorites: [bourse, central] };
      const list = async (hm: string, to: string = 'bourse') => {
        clock.t = at(hm);
        return (await core.route(HERE, { type: 'place', placeId: to }, clock.t, s, here)).journeys.map((j) => `${j.label} ${j.legs[1].line} ${hhmm(j.legs[1].dep)}`);
      };
      return { list, core };
    };
    const est = make(false);
    const real = make(true);
    // vers la gare Centrale à 08:20 : le tram 4 de 08:25 est hors de portée ; le train de 08:41, qui arrive avant le tram
    // suivant, reste proposé, comme en 1.3.0 une fois ce tram parti (c'est le rôle de outOfReach dans le moteur : sans
    // lui, les « suivants » seraient ceux du tram raté et le train disparaîtrait de la liste)
    expect(await est.list('08:20', 'central')).toEqual(['short 4 08:25', 'next IC 08:41', 'later IC 08:56']);
    const missed2 = await est.list('08:21', 'central');
    expect(missed2).toEqual(['short 3 08:30', 'next IC 08:41', 'later 3 08:46']);
    expect(await real.list('08:20', 'central')).toEqual(missed2);
    // 09:00 d'après l'estimation : le tram 4 de 09:05 (partir à 08:58) ; 09:01 : il est parti, le tram 3 de 09:10 vient
    expect(await est.list('09:00')).toEqual(['short 4 09:05', 'next 4 09:13', 'later 4 09:21']);
    const missed = await est.list('09:01');
    expect(missed).toEqual(['short 3 09:10', 'next 3 09:18', 'later 3 09:26']);
    // 09:00 avec le vrai chemin : le tram de 09:05 ne peut plus être attrapé : la même liste qu'après un départ raté,
    // dès le premier calcul (le chemin est connu pendant le calcul), sans réordonner ensuite
    expect(await real.list('09:00')).toEqual(missed);
    expect(await real.list('09:00')).toEqual(missed);
  });
});

describe('règle 6 : « Éviter les escaliers »', () => {
  it('le chemin est celui du réglage : par l’escalier (180 m) rien ne change ; sans marches (446 m), partir à 07:12', async () => {
    const off = world('stairs', '07:10');
    expect(read((await off.route()).journeys[0])).toMatchObject({ leave: '07:15', walk: 3, est: undefined });
    const on = world('stairs', '07:10', { avoidSteps: true });
    expect(read((await on.route()).journeys[0])).toMatchObject({ leave: '07:12', walk: 6, est: 3 });
    // même cœur, réglage changé en route : chaque réglage a son chemin
    const j = (await off.route()).journeys[0];
    const turned = await off.core.refresh(j, { ...off.s, avoidSteps: true });
    await settle();
    expect(read(await off.core.refresh(turned, { ...off.s, avoidSteps: true }))).toMatchObject({ leave: '07:12', walk: 6 });
  });

  it('contrôle : le réglage change : le favori et la recherche disent la même heure tout de suite, dans les deux sens (jamais le chemin de l’autre réglage)', async () => {
    const w = world('stairs', '07:10');
    const on = { ...w.s, avoidSteps: true };
    const both = async (s: Settings) => [read((await w.core.answer(BOURSE, START, s)).plan!.journeys[0]), read((await w.core.route(HERE, TO, w.clock.t, s, START)).journeys[0])].map((x) => `${x.leave}, ${x.walk} min`);
    // éteint : par l'escalier (180 m)
    expect(await both(w.s)).toEqual(['07:15, 3 min', '07:15, 3 min']);
    // allumé : sans marches (446 m)
    expect(await both(on)).toEqual(['07:12, 6 min', '07:12, 6 min']);
    // éteint de nouveau, 30 s plus tard : le favori ne garde pas les 6 min du chemin sans marches
    w.clock.t += 30_000;
    expect(await both(w.s)).toEqual(['07:15, 3 min', '07:15, 3 min']);
    expect(await both(on)).toEqual(['07:12, 6 min', '07:12, 6 min']);
  });
});

describe('règle 7 : seulement la première marche', () => {
  it('favori de gare à gare, à pied jusqu’à la gare : la marche position → gare suit son vrai chemin ; les marches suivantes gardent leurs minutes', async () => {
    // de l'arrêt Esplanade (tram 3) vers la Bourse, en partant de 180 m au sud : la marche position → arrêt est la première
    const fav: FavoriteTrip = { kind: 'trip', id: 'fav-esplanade', from: { type: 'area', areaId: 'stib:6380', op: 'stib', name: { fr: 'Esplanade', nl: 'Esplanade' }, lat: ESPLANADE.lat, lon: ESPLANADE.lon }, to: { type: 'area', areaId: 'stib:6362', op: 'stib', name: { fr: 'Bourse', nl: 'Beurs' }, lat: 50.8483, lon: 4.3497 }, label: 'Bourse', propose: 'never' };
    const base = world(null, '07:10');
    const a0 = await base.core.answer(fav, START, base.s);
    expect(read(a0.plan!.journeys[0])).toMatchObject({ leave: '07:15', walk: 3, ride: '3 07:20' });
    const w = world('long', '07:10');
    const a = await w.core.answer(fav, START, w.s);
    expect(read(a.plan!.journeys[0])).toMatchObject({ leave: '07:12', walk: 6, est: 3, ride: '3 07:20' });
    expect(a.plan!.journeys[0].legs.slice(1)).toEqual(a0.plan!.journeys[0].legs.slice(1));
    // 07:15 : le tram de 07:20 n'est plus attrapable par le vrai chemin : le suivant
    w.clock.t = at('07:15');
    const later = await w.core.answer(fav, START, w.s);
    expect(read(later.plan!.journeys[0])).toMatchObject({ ride: '3 07:28', leave: '07:20', walk: 6 });
  });
});

describe('règles 8 et 9 : réseau et coût', () => {
  it('en plus de la 1.3.0 : l’index des chemins à pied et les tuiles du quartier, une fois ; jamais la position ; rien vers le relais', async () => {
    const w = world('long', '07:10');
    const base = world(null, '07:10');
    await w.route();
    await base.route();
    const rest = (calls: string[]) => calls.filter((u) => !u.includes('/walk/')).sort();
    // mêmes demandes qu'avec l'estimation, plus les chemins à pied
    expect(rest(w.sc.server.calls)).toEqual(rest(base.sc.server.calls));
    const walk = w.sc.walkCalls();
    expect(walk[0]).toBe('walk/index.json');
    expect(walk.filter((u) => u === 'walk/index.json')).toHaveLength(1);
    // tuiles : celle du quartier et ses voisines du cadre (départ, arrêt, 300 m de marge), demandées par leur clé
    const tiles = [...new Set(walk.slice(1))];
    expect(tiles).toContain(`walk/${TILE}.json?v=${VERSION}`);
    expect(tiles.length).toBeLessThanOrEqual(4);
    for (const u of w.sc.server.calls) {
      expect(u).not.toContain(String(START.lat).slice(0, 7));
      expect(u).not.toContain(String(START.lon).slice(0, 6));
    }
    // ensuite : accueil (favori), rafraîchissements, nouveau calcul 5 min plus tard : plus aucune demande de chemin
    const n = walk.length;
    await w.core.answer(BOURSE, START, w.s);
    for (let i = 0; i < 10; i++) {
      w.clock.t += 30_000;
      const a = await w.core.answer(BOURSE, START, w.s);
      await w.core.refresh(a.plan!.journeys[0], w.s);
    }
    expect(w.sc.walkCalls().slice(n).filter((u) => u.includes(TILE))).toEqual([]);
  });

  it('coût : un chemin calculé par arrêt de départ (3 propositions du même arrêt : 1 calcul), quelques millisecondes ; le calcul des trajets ne ralentit pas', async () => {
    const time = async (path: PathKind | null) => {
      const w = world(path, '07:10');
      await w.route();
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        w.clock.t += 1000;
        await w.route();
        await w.core.answer(BOURSE, START, w.s);
      }
      return (performance.now() - t0) / 20;
    };
    const without = await time(null);
    const withWalk = await time('long');
    // même ordre de grandeur (le chemin est en mémoire : aucune attente) ; borne large pour une machine chargée
    expect(withWalk).toBeLessThan(without * 3 + 50);
    console.info(`[mesure] route + favori : ${without.toFixed(1)} ms sans chemins, ${withWalk.toFixed(1)} ms avec`);
  });
});
