/**
 * refresh() : temps réel réappliqué, heure de départ conseillée recalculée, alertes rédigées (≤ 48 caractères),
 * étiquette et raison gardées (1.1). Temps réel des bus, trams et métros : test/core/routing/rt.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AreaFile } from '../../../shared/types';
import type { Alert, Journey, Leg, Settings } from '../../src/core/api';
import { forLabel, withArticle } from '../../src/core/text';
import { hhmm } from '../../src/core/util';
import { makeEnv, type TestEnv } from './support/env';
import { CORE_DATA_DIR } from './support/network';

const MAISON = { lat: 50.4655, lon: 4.859 };
/** Textes comparés sans les espaces insécables (typographie française des alertes, core/text.ts). */
const nb = (s: string | undefined) => (s ?? '').replace(/\u00A0/g, ' ');
const plainAlert = (a: Alert | undefined) => (a ? { ...a, text: nb(a.text) } : a);
const IC_0742 = '88____:007::8863008:8814001:10:852:20261231';

async function morning(env: TestEnv, settings?: Settings): Promise<Journey> {
  const s = settings ?? env.preset;
  const js = await env.core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, env.clock.t, s, MAISON);
  return js[0];
}

describe('refresh : scénario 1 (voie modifiée en chemin)', () => {
  it('plan sans temps réel à 07:31, puis à 07:37 la voie change : alerte en tête, heures recalculées', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31', scene: 'noRT' });
    const j0 = await morning(env);
    expect(hhmm(j0.dep)).toBe('07:33');
    expect(j0.alerts).toEqual([]);

    env.clock.set('2026-11-10T07:37');
    env.server.scene = 'base';
    const j1 = await env.core.refresh(j0, env.preset);
    expect(j1.id).toBe(j0.id);
    expect(plainAlert(j1.alerts[0])).toEqual({ kind: 'platform', text: '! Voie modifiée : l’IC part de la voie 6', at: env.clock.t });
    // la marche déjà commencée garde son heure ; le reste suit le retard de 2 min (1.2.1 : la proposition 1 descend à
    // Bruxelles-Nord pour le T3 de 08:44, encore attrapable, et arrive toujours à 08:58)
    expect(hhmm(j1.legs[0].dep)).toBe('07:33');
    expect(hhmm(j1.dep)).toBe('07:33');
    expect(hhmm(j1.legs[1].dep)).toBe('07:44');
    expect(hhmm(j1.legs[1].arr)).toBe('08:42');
    expect(hhmm(j1.arr)).toBe('08:58');
    expect(hhmm(j1.leaveAt)).toBe('07:35');
    expect(j1.legs[1]).toMatchObject({ rt: true, delayMin: 2, newPlatform: '6', platform: '4' });
    // départ conseillé dépassé et train pas encore parti : « Partir maintenant », après l'alerte de voie
    expect(j1.alerts.map((a) => a.kind)).toEqual(['platform', 'leave']);
    expect(nb(j1.alerts[1].text)).toBe('Partir maintenant : 7 min à pied');
    // « Dans le train » : arrêts avec heures corrigées
    expect(j1.legs[1].stops?.slice(1, 4).map((s) => `${s.name.fr} ${hhmm(s.est)}`)).toEqual(['Gembloux 07:57', 'Ottignies 08:11', 'Bruxelles-Luxembourg 08:33']);
  });

  it('marche pas encore commencée : départ conseillé et marche décalés avec le retard', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20', scene: 'noRT' });
    const j0 = await morning(env);
    env.server.scene = 'base';
    env.clock.advance(30_000); // rafraîchissement suivant (l'erreur de la source reste en cache 15 s)
    const j1 = await env.core.refresh(j0, env.preset);
    expect(hhmm(j1.legs[0].dep)).toBe('07:35');
    expect(hhmm(j1.leaveAt)).toBe('07:35');
    expect(j1.alerts.map((a) => a.kind)).toEqual(['platform']);
  });

  it('source en erreur au rafraîchissement : voie modifiée connue gardée 15 min (M8.5) ; 1.2.5 : le dernier retard connu aussi, « ~ »', async () => {
    const env = makeEnv({ now: '2026-11-10T07:31' });
    const j0 = await morning(env);
    expect(j0.legs[1].newPlatform).toBe('6');
    env.server.scene = 'noRT';
    env.clock.advance(30_000);
    const j1 = await env.core.refresh(j0, env.preset, { followed: true });
    // PRD-1.2.5 § 5 : trajet suivi : le retard de 2 min connu il y a 30 s reste dit, pas en direct (rt false), rtKept
    expect(j1.legs[1]).toMatchObject({ rt: false, delayMin: 2, newPlatform: '6', rtKept: true });
    expect(hhmm(j1.legs[1].dep)).toBe('07:44');
    expect(j1.rt).toBe(false);
    expect(plainAlert(j1.alerts[0])).toMatchObject({ kind: 'platform', text: '! Voie modifiée : l’IC part de la voie 6' });
    // un autre trajet : la voie gardée, l'horaire prévu (M8.5, comme en 1.2.4)
    const o1 = await env.core.refresh(j0, env.preset);
    expect(o1.legs[1]).toMatchObject({ rt: false, delayMin: 0, newPlatform: '6' });
    expect(hhmm(o1.legs[1].dep)).toBe('07:42');
    expect(plainAlert(o1.alerts[0])).toMatchObject({ kind: 'platform', text: '! Voie modifiée : l’IC part de la voie 6' });
    // au-delà de 15 min : plus rien de connu, horaire et voie prévus
    env.clock.advance(16 * 60_000);
    const j2 = await env.core.refresh(j0, env.preset, { followed: true });
    expect(j2.legs[1]).toMatchObject({ rt: false, delayMin: 0 });
    expect(j2.legs[1].newPlatform).toBeUndefined();
    expect(j2.alerts.some((a) => a.kind === 'platform')).toBe(false);
  });
});

describe('alertes', () => {
  it('retard ≥ delayMin : « ! IC 07:42 : +7 min » ; en dessous : rien', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    env.server.relay.rt.sncb.trips[IC_0742] = { u: [[1, '8863008_4', 420, null, 0]] };
    // 1.2.2 : la proposition 1 (IC puis T3) perd sa correspondance et porte aussi « ! Correspondance recalculée » ;
    // l'IC direct (12 min à pied, au-delà de la marche maximale) n'est plus proposé (PRD-1.2.2 § 7.3) ; rafraîchie,
    // la proposition 1 ne garde que l'alerte de retard
    const js = await env.core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, env.clock.t, env.preset, MAISON);
    expect(js[0].alerts.map((a) => nb(a.text))).toEqual(['! Correspondance recalculée', '! IC 07:42 : +7 min']);
    expect(js.some((x) => x.label === 'none')).toBe(false);
    const j = js[0];
    expect((await env.core.refresh(j, env.preset)).alerts.map((a) => nb(a.text))).toEqual(['! IC 07:42 : +7 min']);
    const lenient: Settings = { ...env.preset, alerts: { ...env.preset.alerts, delayMin: 10 } };
    expect((await env.core.refresh(j, lenient)).alerts).toEqual([]);
  });

  it('suppression : jamais proposée (PRD § 4.2) ; sur le trajet affiché, « ! IC 07:42 supprimé », étiquette gardée', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const j0 = await morning(env);
    expect(j0).toMatchObject({ label: 'short' });
    env.server.relay.rt.sncb.trips[IC_0742] = { cancelled: true, u: [] };
    env.clock.advance(21_000); // au-delà du cache du temps réel (20 s)
    const j1 = await env.core.refresh(j0, env.preset);
    expect(j1.alerts.map((a) => nb(a.text))).toEqual(['! IC 07:42 supprimé']);
    expect([j1.id, j1.label, j1.reason]).toEqual([j0.id, j0.label, j0.reason]);
    const js = await env.core.plan({ type: 'here' }, { type: 'place', placeId: 'bureau' }, env.clock.t, env.preset, MAISON);
    expect(js.some((j) => j.legs.some((l) => l.cancelled))).toBe(false);
    expect(js.map((j) => hhmm(j.legs[1].schedDep))).toEqual(['08:42']);
    expect(js[0].label).toBe('short');
  });

  it('réglages : chaque alerte se désactive', async () => {
    const env = makeEnv({ now: '2026-11-10T07:37' });
    const off: Settings = { ...env.preset, alerts: { ...env.preset.alerts, platform: false, leave: false } };
    const j = await morning(env, off);
    expect(j.alerts).toEqual([]);
  });

  it('travaux (si activés) : « Travaux à Ottignies… » sur le trajet qui passe par Ottignies', async () => {
    const env = makeEnv({ now: '2026-11-10T07:20' });
    const works: Settings = { ...env.preset, alerts: { ...env.preset.alerts, works: true, platform: false } };
    const j = await morning(env, works);
    expect(j.alerts).toHaveLength(1);
    expect(j.alerts[0].kind).toBe('works');
    expect(nb(j.alerts[0].text)).toBe('Travaux à Ottignies : quelques minutes de retar…');
    expect((await morning(env)).alerts.some((a) => a.kind === 'works')).toBe(false);
  });

  it('works() : textes actifs par ligne ou arrêt ; STIB : messages WaitingTimes ; erreur : vide', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    expect(await env.core.works('tec', ['N51'], [])).toEqual(['Ligne 51 déviée rue de Fer']);
    expect(await env.core.works('tec', ['N4'], ['N508aga'])).toEqual([]);
    expect(await env.core.works('sncb', [], ['8811601'])).toEqual(['Travaux à Ottignies : quelques minutes de retard possibles']);
    expect(await env.core.works('stib', ['2'], ['8041'])).toEqual(['Travaux : arrêt Botanique non desservi']);
    env.clock.set('2026-11-21T12:00');
    expect(await env.core.works('tec', ['N51'], [])).toEqual([]);
    env.server.scene = 'noRT';
    env.clock.set('2026-11-10T12:30');
    expect(await env.core.works('sncb', [], ['8811601'])).toEqual([]);
  });

  it('textes : élision, 48 caractères au plus, sans tiret cadratin', async () => {
    expect(withArticle('IC')).toBe('l’IC');
    expect(withArticle('S1')).toBe('le S1');
    expect(withArticle('EUR')).toBe('l’EUR');
    expect(forLabel('bureau')).toBe('Pour le bureau');
    expect(forLabel('maison')).toBe('Pour la maison');
    expect(forLabel('école')).toBe('Pour l’école');
    expect(forLabel('Gand-Saint-Pierre')).toBe('Vers Gand-Saint-Pierre');
    expect(forLabel('chez Karim')).toBe('Vers chez Karim');

    const env = makeEnv({ now: '2026-11-10T12:00' });
    // S1 12:34 de Bruxelles-Nord : voie modifiée, puis retard, puis suppression
    const s1 = '88____:046::8812005:8883006:4:1315:20261231';
    const all: Settings = { ...env.preset, alerts: { ...env.preset.alerts, works: true, delayMin: 1 } };
    env.server.relay.rt.sncb.trips[s1] = { u: [[1, '8812005_11', 900, null, 0]] };
    let js = await env.core.trains('sncb:8812005', 'sncb:8883006', env.clock.t, 1);
    let j = await env.core.refresh(js[0], all);
    expect(j.alerts.map((a) => nb(a.text))).toEqual(['! Voie modifiée : le S1 part de la voie 11', '! S1 12:34 : +15 min']);
    env.server.relay.rt.sncb.trips[s1] = { cancelled: true, u: [] };
    env.clock.advance(21_000);
    js = await env.core.trains('sncb:8812005', 'sncb:8883006', env.clock.t, 1);
    j = await env.core.refresh(js[0], all);
    expect(j.alerts.map((a) => nb(a.text))).toEqual(['! S1 12:34 supprimé']);
    for (const a of [...j.alerts, ...js.flatMap((x) => x.alerts)]) {
      expect(a.text.length).toBeLessThanOrEqual(48);
      expect(a.text).not.toContain('—');
    }
  });
});

describe('1.2.9 : travaux STIB d’un trajet, route_id différent du numéro de ligne', () => {
  it('le message WaitingTimes du métro 2 pris à Rogier, jamais celui du tram 4', async () => {
    const env = makeEnv({ now: '2026-11-10T12:10' });
    // données réelles du 13/11 (lines/index.json) : à la STIB, le route_id n'est pas le numéro (métro 2 : « 4 », tram 4 : « 5 ») ;
    // les fixtures avaient route_id = numéro, ce qui cachait l'écart
    const REAL_ROUTE: Record<string, string> = { '2': '4', '4': '5' };
    const realRoutes = (path: string): AreaFile => {
      const f = JSON.parse(readFileSync(join(CORE_DATA_DIR, path), 'utf8')) as AreaFile;
      for (const p of f.patterns) p.route = REAL_ROUTE[p.line] ?? p.route;
      env.server.memFiles.set(path, JSON.stringify(f));
      return f;
    };
    const rogier = realRoutes('areas/stib/6359.json');
    realRoutes('areas/stib/6364.json');
    // un message du tram 4 au quai de Rogier (WaitingTimes : lineId = numéro de ligne)
    env.server.relay.stib.points['6359'] = [{ line: '4', dest: { fr: 'STALLE (P)', nl: 'STALLE (P)' }, times: ['2026-11-10T12:15:00+01:00'], msg: 'Tram 4 : arrêt Rogier déplacé' }] as never;
    const t = env.clock.t;
    const N = (fr: string) => ({ fr, nl: fr });
    const ride: Leg = {
      kind: 'ride',
      from: { name: N('Rogier'), lat: rogier.lat, lon: rogier.lon, areaId: 'stib:6359' },
      to: { name: N('Gare du Midi'), lat: 50.8357, lon: 4.3364, areaId: 'stib:6364' },
      dep: t + 4 * 60_000,
      arr: t + 14 * 60_000,
      schedDep: t + 4 * 60_000,
      schedArr: t + 14 * 60_000,
      op: 'stib',
      mode: 'metro',
      line: '2',
      head: N('Gare du Midi'),
      rt: false,
      delayMin: 0,
      cancelled: false,
    };
    const j: Journey = { id: 'm2', legs: [ride], dep: ride.dep, arr: ride.arr, leaveAt: ride.dep, transfers: 0, rt: false, alerts: [] };
    const settings: Settings = { ...env.preset, alerts: { ...env.preset.alerts, works: true, leave: false, platform: false, delay: false, cancel: false } };
    const r = await env.core.refresh(j, settings);
    const works = r.alerts.filter((a) => a.kind === 'works').map((a) => nb(a.text));
    expect(works.some((w) => w.includes('Botanique'))).toBe(true);
    expect(works.some((w) => w.includes('Tram 4'))).toBe(false);
  });
});
