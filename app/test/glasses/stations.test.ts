/**
 * Quai 1.2.2, « Gares » (docs/v1.2.2/PRD-1.2.2.md § 2 ; CA-122.3) et ★ des départs d'une gare (REVUE-USAGE n° 3) :
 * les gares choisies dans leur ordre, leur prochain train à droite, « aucun train » ; toucher : le tableau, double
 * toucher : retour ; rafraîchi comme les tableaux. ★ garde ou retire la gare dans « Gares », annulable 5 s, jamais un
 * arrêt favori. Ouverture d'office à moins de 300 m (`near`) et alerte travaux (REVUE-USAGE n° 4).
 */
import { describe, expect, it } from 'vitest';
import type { Board, Core } from '../../src/core/api';
import { stationsView, type ViewCtx } from '../../src/glasses/views';
import { MIN, PLACES, STATIONS, at, boardOf, lines, nb, settingsWith, setup, stubCore, trainAt, type Screen } from './helpers';
import { LIMITS } from '../../src/settings';

const NOW = at('2026-11-12', 7, 31);
const ctx = (patch = {}): ViewCtx => ({ now: NOW, settings: settingsWith([], { stations: [STATIONS.braine, STATIONS.nord, STATIONS.namur], ...patch }) });

/** Braine-l'Alleud : IC dans 11 min voie 1 ; Bruxelles-Nord : S1 en retard et voie modifiée ; Namur : rien. */
function boards(id: string, now: number): Board | undefined {
  if (id === STATIONS.braine.areaId) return boardOf(id, 'Braine-l’Alleud', [trainAt(now, 11), trainAt(now, 41)]);
  if (id === STATIONS.nord.areaId) return boardOf(id, 'Bruxelles-Nord', [trainAt(now, 24, { line: 'S1', delayMin: 3, est: now + 27 * MIN, newPlatform: '12' })]);
  if (id === STATIONS.namur.areaId) return boardOf(id, 'Namur', []);
  return undefined;
}

const stationsReady = (s: Screen) => s.screen === 'stations' && !s.lines.some((l) => / …$/.test(l));

describe('CA-122.3 : « Gares »', () => {
  it('les gares dans leur ordre, le prochain train à droite, « aucun train » ; toucher : le tableau ; double toucher : « Gares »', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.2', stations: [STATIONS.braine, STATIONS.nord, STATIONS.namur] }), core: (now) => stubCore(now, { board: boards }) });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'stations' });
    const s = await h.until(stationsReady);
    expect(s.title).toBe('Gares');
    expect(s.lines).toEqual(['Braine-l’Alleud   IC 07:42 voie 1', 'Bruxelles-Nord   S1 07:55 +3 voie 12 !', 'Namur   aucun train', '▲▼ choisir   toucher : départs   double : retour']);
    await h.gesture('down', 'tap');
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    expect(b.title).toBe('Bruxelles-Nord, train (SNCB) ★');
    await h.gesture('double');
    expect(h.last()).toMatchObject({ screen: 'stations', sel: 1 });
    h.c.stop();
  });

  it('revue : gare introuvable : « introuvable » (accueil, « Gares »), jamais « … » ; retrouvée sous un autre identifiant : le choix suit', async () => {
    // identifiant inconnu sans zone de ce nom autour (faux cœur : missing) ; identifiant inconnu, même nom à 150 m : movedTo
    const lost = { ...STATIONS.nord, id: 'st-lost', areaId: 'sncb:0000001', name: { fr: 'Gare supprimée', nl: 'Gare supprimée' } };
    const moved = { ...STATIONS.nord, areaId: 'sncb:0000002' };
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.2', stations: [lost, moved] }), core: (now) => stubCore(now) });
    const home = await h.until((x) => x.screen === 'home' && x.lines.some((l) => /^Gares {3}[^…]+$/.test(l)));
    expect(home.lines.find((l) => l.startsWith('Gares'))).toBe('Gares   introuvable');
    await h.c.replaceRoute({ screen: 'stations' });
    const s = await h.until(stationsReady);
    expect(s.lines[0]).toBe('Gare supprimée   introuvable');
    expect(s.lines[1]).toMatch(/^Bruxelles-Nord {3}\S/);
    expect(s.lines[1]).not.toMatch(/introuvable|…/);
    await h.until(() => h.settings.get().stations[1]?.areaId === STATIONS.nord.areaId);
    expect(h.settings.get().stations.map((p) => [p.id, p.areaId])).toEqual([
      ['st-lost', 'sncb:0000001'],
      ['st-nord', STATIONS.nord.areaId],
    ]);
    h.c.stop();
  });

  it('rafraîchi toutes les 30 s comme les tableaux : les heures suivent, sans « … » qui revient', async () => {
    let late = 0;
    const h = await setup({
      now: NOW,
      settings: settingsWith([], { seenVersion: '1.2.2', stations: [STATIONS.braine] }),
      core: (now) => stubCore(now, { board: (id, n) => (id === STATIONS.braine.areaId ? boardOf(id, 'Braine-l’Alleud', [trainAt(NOW, 11, { delayMin: late, est: NOW + (11 + late) * MIN })]) : undefined) }),
    });
    await h.until((x) => x.screen === 'home');
    await h.c.replaceRoute({ screen: 'stations' });
    expect((await h.until(stationsReady)).lines[0]).toBe('Braine-l’Alleud   IC 07:42 voie 1');
    await h.settle(50);
    late = 4;
    h.advance(30_000);
    await h.c.refreshCurrent();
    expect((await h.until((x) => x.lines[0]?.includes('+4'))).lines[0]).toBe('Braine-l’Alleud   IC 07:42 +4 voie 1');
    expect(h.screens().filter((x) => x.screen === 'stations').slice(1).every((x) => !x.lines[0].endsWith('…'))).toBe(true);
    h.c.stop();
  });

  it('vue : « … » pendant le calcul, « ~ » et la note sans temps réel, gare introuvable ; rubrique vide : où les choisir', () => {
    const v = stationsView([{ pick: STATIONS.braine }, { pick: STATIONS.nord, state: 'missing' }, { pick: STATIONS.namur, next: trainAt(NOW, 11, { rt: false }) }], ctx());
    expect(lines(v)).toEqual(['Braine-l’Alleud   …', 'Bruxelles-Nord   introuvable', 'Namur   IC ~07:42 voie 1', '~ horaire prévu, sans temps réel', '▲▼ choisir   toucher : départs   double : retour']);
    expect(lines(stationsView([], ctx()))).toEqual(['Choisis tes gares dans Quai, sur le téléphone.', 'double toucher : retour']);
    const web = stationsView([], { ...ctx(), web: true });
    expect(lines(web)[0]).toBe('Choisis tes gares dans l’onglet Réglages.');
    expect(web.tap).toEqual({ kind: 'phone', hash: '#/gares/ajouter', text: 'Choisis tes gares dans l’onglet Réglages' });
  });
});

describe('REVUE-USAGE n° 3 : ★ des départs d’une gare', () => {
  it('garder, retirer, annuler dans les 5 s à l’identique, rajouter après ; jamais d’arrêt favori', async () => {
    const h = await setup({ now: NOW, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.2', stations: [STATIONS.nord, { ...STATIONS.braine, near: true }] }), core: (now) => stubCore(now, { board: boards }) });
    await h.until((x) => x.screen === 'home');
    const before = structuredClone(h.settings.get().stations);
    await h.c.show({ screen: 'board', areaId: STATIONS.braine.areaId, name: STATIONS.braine.name });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    expect(b.title).toBe('Braine-l’Alleud, train (SNCB) ★');
    expect(b.lines.at(-1)).toBe('▲▼ départs   toucher : ★ retirer la gare   double : retour');
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Retirée. Toucher encore : annuler');
    expect(h.last().title).toBe('Braine-l’Alleud, train (SNCB)');
    expect(h.settings.get().stations.map((p) => p.id)).toEqual(['st-nord']);
    h.advance(4_000);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Gare rétablie');
    // à l'identique : même identifiant, même place, `near` compris
    expect(h.settings.get().stations).toEqual(before);
    // retrait, puis toucher après 6 s : la gare revient en fin de liste, nouvelle
    await h.gesture('tap');
    h.advance(6_000);
    await h.gesture('tap');
    expect(h.last().lines.at(-1)).toBe('★ Ajoutée à tes gares');
    expect(h.settings.get().stations.map((p) => p.areaId)).toEqual([STATIONS.nord.areaId, STATIONS.braine.areaId]);
    expect(h.settings.get().favorites.some((f) => f.kind === 'stop')).toBe(false);
    h.c.stop();
  });

  it('une gare de plus que la limite (32) : « Déjà 32 gares : retires-en une sur le téléphone » ; hors de « Gares » : « ★ garder la gare »', async () => {
    const eight = Array.from({ length: LIMITS.stations }, (_, i) => ({ ...STATIONS.nord, id: `st-${i}`, areaId: `sncb:8812${String(100 + i).padStart(3, '0')}` }));
    const h = await setup({ now: NOW, settings: settingsWith([], { seenVersion: '1.2.2', stations: eight }), core: (now) => stubCore(now, { board: boards }) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: STATIONS.braine.areaId, name: STATIONS.braine.name });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    expect(b.lines.at(-1)).toBe('▲▼ départs   toucher : ★ garder la gare   double : retour');
    await h.gesture('tap');
    expect(nb(h.last().lines.at(-1)!)).toBe(`Déjà ${LIMITS.stations} gares : retires-en une sur le téléphone`);
    expect(h.settings.get().stations).toHaveLength(LIMITS.stations);
    h.c.stop();
  });
});

describe('REVUE-USAGE n° 4 : migration sans perte, côté lunettes', () => {
  it('gare `near` à moins de 300 m : ses départs s’ouvrent d’office ; double toucher : l’accueil', async () => {
    const pos = { lat: STATIONS.braine.lat + 0.001, lon: STATIONS.braine.lon };
    const h = await setup({ now: NOW, pos, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.2', stations: [STATIONS.nord, { ...STATIONS.braine, near: true }] }), core: (now) => stubCore(now, { board: boards }) });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    expect(b.title).toBe('Braine-l’Alleud, train (SNCB) ★');
    await h.gesture('double');
    expect((await h.until((x) => x.screen === 'home')).screen).toBe('home');
    h.c.stop();
    // sans `near`, ou à plus de 300 m : l'accueil
    const far = await setup({ now: NOW, pos, settings: settingsWith([PLACES.bureau], { seenVersion: '1.2.2', stations: [STATIONS.braine] }), core: (now) => stubCore(now, { board: boards }) });
    expect((await far.until((x) => x.screen === 'home')).screen).toBe('home');
    far.c.stop();
  });

  it('« Travaux et déviations » sur les départs d’une gare gardée, comme pour un arrêt favori de la 1.2.1', async () => {
    const works = (core: Core): Core => Object.assign(Object.create(core) as Core, { works: async () => ['Travaux : pas de train entre Braine-l’Alleud et Nivelles'] });
    const settings = settingsWith([], { seenVersion: '1.2.2', stations: [STATIONS.braine] });
    settings.alerts.works = true;
    const h = await setup({ now: NOW, settings, core: (now) => works(stubCore(now, { board: boards })) });
    await h.until((x) => x.screen === 'home');
    await h.c.show({ screen: 'board', areaId: STATIONS.braine.areaId, name: STATIONS.braine.name });
    const b = await h.until((x) => x.screen === 'board' && x.lines.length > 1);
    expect(b.lines[0]).toBe('! Travaux : pas de train entre Braine-l’Alleud et Nivelles');
    // une gare qui n'est pas gardée : pas d'alerte
    await h.c.show({ screen: 'board', areaId: STATIONS.nord.areaId, name: STATIONS.nord.name });
    const n = await h.until((x) => x.screen === 'board' && x.title.startsWith('Bruxelles-Nord') && x.lines.length > 1);
    expect(n.lines[0]).not.toMatch(/^!/);
    h.c.stop();
  });
});
